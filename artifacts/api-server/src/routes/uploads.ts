import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { sendSuccess, sendCreated, sendError, sendNotFound, sendValidationError } from "../lib/response.js";

const router: IRouter = Router();

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/jpg"];

const prescriptionRefMap = new Map<string, string>();

async function ensureDir() {
  await mkdir(UPLOADS_DIR, { recursive: true });
}

router.post("/", async (req, res) => {
  try {
    const { file, filename, mimeType } = req.body;

    if (!file) {
      sendValidationError(res, "No file data provided");
      return;
    }

    const mime = mimeType || "image/jpeg";
    if (!ALLOWED_TYPES.includes(mime)) {
      sendValidationError(res, "Only JPEG, PNG, and WebP images are allowed");
      return;
    }

    const base64Data = file.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    if (buffer.length > MAX_FILE_SIZE) {
      sendValidationError(res, "File too large. Maximum 5MB allowed");
      return;
    }

    const ext = mime === "image/png" ? ".png" : mime === "image/webp" ? ".webp" : ".jpg";
    const uniqueName = `${Date.now()}_${randomUUID().slice(0, 8)}${ext}`;

    await ensureDir();
    await writeFile(path.join(UPLOADS_DIR, uniqueName), buffer);

    const url = `/api/uploads/${uniqueName}`;

    sendCreated(res, {
      url,
      filename: filename || uniqueName,
      size: buffer.length,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    sendError(res, msg);
  }
});

router.post("/prescription", async (req, res) => {
  try {
    const { file, mimeType, refId } = req.body;

    if (!file) {
      sendValidationError(res, "No file data provided");
      return;
    }

    if (!refId || typeof refId !== "string") {
      sendValidationError(res, "refId is required");
      return;
    }

    const mime = mimeType || "image/jpeg";
    if (!ALLOWED_TYPES.includes(mime)) {
      sendValidationError(res, "Only JPEG, PNG, and WebP images are allowed");
      return;
    }

    const base64Data = file.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    if (buffer.length > MAX_FILE_SIZE) {
      sendValidationError(res, "File too large. Maximum 5MB allowed");
      return;
    }

    const ext = mime === "image/png" ? ".png" : mime === "image/webp" ? ".webp" : ".jpg";
    const uniqueName = `rx_${Date.now()}_${randomUUID().slice(0, 8)}${ext}`;

    await ensureDir();
    await writeFile(path.join(UPLOADS_DIR, uniqueName), buffer);

    const url = `/api/uploads/${uniqueName}`;
    prescriptionRefMap.set(refId, url);

    setTimeout(() => prescriptionRefMap.delete(refId), 60 * 60 * 1000);

    sendCreated(res, { url, refId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    sendError(res, msg);
  }
});

router.get("/prescription/resolve/:refId", (req, res) => {
  const url = prescriptionRefMap.get(req.params.refId!);
  if (url) {
    sendSuccess(res, { url });
  } else {
    sendNotFound(res, "Reference not found or expired");
  }
});

export { prescriptionRefMap };

export default router;
