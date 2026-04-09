import multer from "multer";
import type { Request, Response, NextFunction } from "express";
import { sendValidationError } from "./response.js";

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
export const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5 MB
export const MAX_UPLOAD_BASE64_LEN = Math.ceil(MAX_UPLOAD_SIZE * (4 / 3));

/** Typed error thrown by this module; always produces an HTTP 400 response. */
export class UploadValidationError extends Error {
  readonly statusCode = 400 as const;
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

/** Type guard: is the value an UploadValidationError? */
export function isUploadValidationError(err: unknown): err is UploadValidationError {
  return err instanceof UploadValidationError;
}

/**
 * Normalise MIME alias: treat "image/jpg" identically to "image/jpeg".
 * All internal comparisons use the canonical form.
 */
function normaliseMime(mime: string): string {
  return mime === "image/jpg" ? "image/jpeg" : mime;
}

/**
 * Detect the real MIME type from the first bytes of a buffer.
 *
 * JPEG: FF D8 FF
 * PNG:  89 50 4E 47 0D 0A 1A 0A  (full 8-byte signature)
 * WebP: RIFF at bytes 0-3 AND WEBP at bytes 8-11.
 *       Both conditions are required to prevent raw RIFF containers
 *       (AVI, WAV, etc.) from being misidentified as WebP.
 *
 * Returns null when no known signature is matched.
 */
export function detectMimeFromBuffer(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Validate a binary buffer that arrived via multipart upload.
 * Throws UploadValidationError (statusCode 400) on failure.
 *
 * @param buf      Raw file buffer
 * @param claimed  MIME type claimed by the client / multer
 * @param label    Human-readable field name for error messages
 */
export function validateImageBuffer(buf: Buffer, claimed: string, label = "File"): void {
  if (buf.length > MAX_UPLOAD_SIZE) {
    throw new UploadValidationError(`${label}: File too large. Maximum 5 MB allowed`);
  }

  const actual = detectMimeFromBuffer(buf);
  if (!actual) {
    throw new UploadValidationError(
      `${label}: File appears corrupted or is not a valid image`,
    );
  }

  if (normaliseMime(actual) !== normaliseMime(claimed)) {
    throw new UploadValidationError(
      `${label}: Image content does not match its declared type`,
    );
  }
}

/**
 * Validate a base64 data-URI image (JSON body uploads).
 * Checks:
 *   1. Data-URI format is valid and MIME is in the allowlist
 *   2. Decoded size is within the 5 MB cap
 *   3. Magic bytes match the claimed MIME type
 *
 * Throws UploadValidationError on failure.
 *
 * @param dataUri  Full data-URI string (e.g. "data:image/jpeg;base64,…")
 * @param label    Human-readable field name for error messages
 * @returns        { buffer, mime } on success, where mime is the canonical form
 */
export function validateBase64Image(
  dataUri: string,
  label = "File",
): { buffer: Buffer; mime: string } {
  const match = dataUri.match(/^data:(image\/[\w]+);base64,(.+)$/);
  if (!match) {
    throw new UploadValidationError(`${label}: Invalid image data`);
  }

  const claimed = match[1]!;
  if (!ALLOWED_IMAGE_TYPES.includes(claimed)) {
    throw new UploadValidationError(
      `${label}: Only JPEG, PNG, or WebP images are allowed`,
    );
  }

  const base64Payload = match[2]!;
  if (base64Payload.length > MAX_UPLOAD_BASE64_LEN) {
    throw new UploadValidationError(`${label}: Image too large. Maximum 5 MB allowed`);
  }

  const buffer = Buffer.from(base64Payload, "base64");

  if (buffer.length > MAX_UPLOAD_SIZE) {
    throw new UploadValidationError(`${label}: Image too large. Maximum 5 MB allowed`);
  }

  validateImageBuffer(buffer, claimed, label);

  return { buffer, mime: normaliseMime(claimed) };
}

/**
 * Pre-configured multer instance with:
 *   - Memory storage (so callers can run magic-byte checks before disk writes)
 *   - 5 MB hard size limit
 *   - MIME-type allowlist enforced in fileFilter
 *
 * After multer runs, pass the buffer through `validateImageBuffer` to complete
 * magic-byte verification before writing to disk.
 */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new UploadValidationError("Only JPEG, PNG, and WebP images are allowed"));
    }
  },
});

/**
 * Express middleware-compatible error handler for multer upload errors.
 *
 * Maps known upload-related errors to clean 400 validation responses:
 *   - MulterError: always a client-side violation (size/field limits, etc.)
 *   - UploadValidationError: thrown by this module's validators
 *
 * All other errors are forwarded to the next error handler so unexpected
 * server-side faults are not silently masked as client 400s.
 */
export function handleMulterError(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      sendValidationError(res, "File too large. Maximum 5 MB allowed");
      return;
    }
    sendValidationError(res, err.message);
    return;
  }
  if (isUploadValidationError(err)) {
    sendValidationError(res, err.message);
    return;
  }
  next(err);
}
