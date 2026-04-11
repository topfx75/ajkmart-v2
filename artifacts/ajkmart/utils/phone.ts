/**
 * Normalizes a Pakistani phone number to canonical 12-digit format: `92xxxxxxxxxx`
 * (country code + 10-digit mobile number, no leading zero, no `+`).
 *
 * Accepted inputs:
 *   03001234567   →  923001234567  (local format with leading zero)
 *   3001234567    →  923001234567  (bare 10-digit)
 *   +923001234567 →  923001234567  (E.164 with plus)
 *   923001234567  →  923001234567  (already canonical)
 *
 * Returns the cleaned string as-is if it does not match any known pattern.
 */
export function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[\s\-()]/g, "");
  if (/^\+?92(3\d{9})$/.test(cleaned)) {
    const match = cleaned.match(/^\+?92(3\d{9})$/);
    return `92${match![1]!}`;
  }
  if (/^0(3\d{9})$/.test(cleaned)) {
    const match = cleaned.match(/^0(3\d{9})$/);
    return `92${match![1]!}`;
  }
  if (/^(3\d{9})$/.test(cleaned)) {
    return `92${cleaned}`;
  }
  return cleaned;
}

/**
 * Returns true if the raw input represents a valid Pakistani mobile number
 * that normalizes to a 12-digit `92xxxxxxxxxx` string.
 */
export function isValidPakistaniPhone(raw: string): boolean {
  return /^92\d{10}$/.test(normalizePhone(raw));
}
