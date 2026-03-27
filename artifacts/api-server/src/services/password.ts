import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";

const SALT_LENGTH = 16;
const KEY_LENGTH  = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const derived = scryptSync(password, salt, KEY_LENGTH);
    const storedBuf = Buffer.from(hash, "hex");
    if (derived.length !== storedBuf.length) return false;
    return timingSafeEqual(derived, storedBuf);
  } catch {
    return false;
  }
}

export function validatePasswordStrength(password: string): { ok: boolean; message: string } {
  if (password.length < 8) return { ok: false, message: "Password must be at least 8 characters" };
  if (!/[A-Z]/.test(password) && !/[0-9]/.test(password) && !/[^A-Za-z]/.test(password)) {
    return { ok: false, message: "Password should contain at least one uppercase letter, number, or special character" };
  }
  return { ok: true, message: "ok" };
}

export function generateSecureOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/* Simple hash for token generation (non-crypto-sensitive) */
export function makeTokenHash(value: string): string {
  return createHash("sha256").update(value + process.env.JWT_SECRET || "ajkmart-secret-2024").digest("hex").slice(0, 32);
}
