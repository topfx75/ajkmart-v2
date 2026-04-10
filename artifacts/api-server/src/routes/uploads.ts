import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import rateLimit from "express-rate-limit";
import { sendSuccess, sendCreated, sendError, sendNotFound, sendValidationError, sendTooManyRequests } from "../lib/response.js";
import { customerAuth, riderAuth, getClientIp } from "../middleware/security.js";
import { imageUpload, validateImageBuffer, validateBase64Image, handleMulterError, isUploadValidationError } from "../lib/upload-validator.js";

const router: IRouter = Router();

/* ── Upload rate limiter factory: 10 uploads per user per 15 minutes ─────
   Must be mounted AFTER customerAuth / riderAuth so the authenticated user
   ID is available in keyGenerator. Keying by user ID + route path (not raw
   IP) gives each endpoint its own independent 10-request quota per user,
   ensuring legitimate users on shared IPs are not affected by others. */
function makeUploadRateLimiter(routeKey: string) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyGenerator: (req) => `${routeKey}:${req.customerId ?? req.riderId ?? "anonymous"}`,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      sendTooManyRequests(res, 15 * 60);
    },
    validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
  });
}

const uploadLimiter       = makeUploadRateLimiter("upload");
const proofUploadLimiter  = makeUploadRateLimiter("proof");
const rxUploadLimiter     = makeUploadRateLimiter("prescription");

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

const prescriptionRefMap = new Map<string, { url: string; customerId: string }>();

async function ensureDir() {
  await mkdir(UPLOADS_DIR, { recursive: true });
}

/* ── Multer instance for multipart/form-data (memory storage) ── */
const upload = imageUpload;

/* ── Helper: save a buffer and return the public URL ── */
async function saveBuffer(buffer: Buffer, prefix: string, mimeType: string): Promise<string> {
  const ext = mimeType === "image/png" ? ".png" : mimeType === "image/webp" ? ".webp" : ".jpg";
  const uniqueName = `${prefix}_${Date.now()}_${randomUUID().slice(0, 8)}${ext}`;
  await ensureDir();
  await writeFile(path.join(UPLOADS_DIR, uniqueName), buffer);
  return `/api/uploads/${uniqueName}`;
}

/* ── POST /uploads — JSON base64 upload (customers / super-app) ── */
router.post("/", customerAuth, uploadLimiter, async (req, res) => {
  try {
    const { file, filename } = req.body;

    if (!file) {
      sendValidationError(res, "No file data provided");
      return;
    }

    const { buffer, mime } = validateBase64Image(file, "File");

    const url = await saveBuffer(buffer, "upload", mime);

    sendCreated(res, {
      url,
      filename: filename || path.basename(url),
      size: buffer.length,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    if (isUploadValidationError(e)) {
      sendValidationError(res, msg);
      return;
    }
    sendError(res, msg);
  }
});

/* ── POST /uploads/proof — multipart/form-data delivery-proof upload (riders) ──
   Uses riderAuth so rider JWTs are accepted.
   File field name: "file"; optional field "purpose" for auditing.
   Enforces same 5MB / allowed-type limits as the JSON route.
*/
router.post(
  "/proof",
  riderAuth,
  proofUploadLimiter,
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      handleMulterError(err, req, res, next);
    });
  },
  async (req, res) => {
    try {
      if (!req.file) {
        sendValidationError(res, "No file uploaded");
        return;
      }

      const { mimetype, buffer, originalname } = req.file;

      validateImageBuffer(buffer, mimetype, "File");

      const url = await saveBuffer(buffer, "proof", mimetype);

      sendCreated(res, {
        url,
        filename: originalname || path.basename(url),
        size: buffer.length,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      if (isUploadValidationError(e)) {
        sendValidationError(res, msg);
        return;
      }
      sendError(res, msg);
    }
  },
);

/* ── POST /uploads/prescription — base64 prescription upload (customers) ── */
router.post("/prescription", customerAuth, rxUploadLimiter, async (req, res) => {
  try {
    const { file, refId } = req.body;

    if (!file) {
      sendValidationError(res, "No file data provided");
      return;
    }

    if (!refId || typeof refId !== "string") {
      sendValidationError(res, "refId is required");
      return;
    }

    const { buffer, mime } = validateBase64Image(file, "File");

    const url = await saveBuffer(buffer, "rx", mime);
    const customerId = req.customerId!;
    prescriptionRefMap.set(refId, { url, customerId });

    setTimeout(() => prescriptionRefMap.delete(refId), 60 * 60 * 1000);

    sendCreated(res, { url, refId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    if (isUploadValidationError(e)) {
      sendValidationError(res, msg);
      return;
    }
    sendError(res, msg);
  }
});

router.get("/prescription/resolve/:refId", customerAuth, (req, res) => {
  const entry = prescriptionRefMap.get(req.params.refId!);
  if (!entry) {
    sendNotFound(res, "Reference not found or expired");
    return;
  }
  if (entry.customerId !== req.customerId) {
    res.status(403).json({ success: false, error: "Access denied" });
    return;
  }
  sendSuccess(res, { url: entry.url });
});

/* ── POST /uploads/pre-registration — unauthenticated document upload ─────
   Allows riders (and other new users) to upload KYC documents before their
   account is created. No JWT is required, but:
     • Strict IP-based rate limiting (20 requests per IP per 15 minutes)
     • Image-only validation (MIME + magic-byte check via validateBase64Image)
     • 5 MB per-image size cap (enforced inside validateBase64Image)
   Authenticated uploads should continue to use POST /uploads.              */
const preRegistrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => getClientIp(req),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    sendTooManyRequests(res, 15 * 60);
  },
  validate: { xForwardedForHeader: false },
});

router.post("/pre-registration", preRegistrationLimiter, async (req, res) => {
  try {
    const { file, filename } = req.body;

    if (!file) {
      sendValidationError(res, "No file data provided");
      return;
    }

    const { buffer, mime } = validateBase64Image(file, "File");

    const url = await saveBuffer(buffer, "prereg", mime);

    sendCreated(res, {
      url,
      filename: filename || path.basename(url),
      size: buffer.length,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    if (isUploadValidationError(e)) {
      sendValidationError(res, msg);
      return;
    }
    sendError(res, msg);
  }
});

export { prescriptionRefMap };

export default router;
