/**
 * Canonical Pakistani mobile phone number utilities.
 *
 * This is a pure, dependency-free module importable by any package —
 * including the API server — without pulling in React or browser APIs.
 *
 * The same logic is re-exported by @workspace/auth-utils for frontend packages.
 */

/**
 * Normalizes a Pakistani mobile number to 12-digit international format: `92xxxxxxxxxx`
 * (country code + 10-digit mobile number, no leading zero, no `+`).
 *
 * Accepts all common formats:
 *   - 03001234567   (local with zero)
 *   - 3001234567    (bare 10-digit)
 *   - +923001234567 (E.164)
 *   - 923001234567  (country code without +)
 */
export function canonicalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-()+]/g, "");
  const e164Match = cleaned.match(/^(?:\+?92)(3\d{9})$/);
  if (e164Match) return `92${e164Match[1]!}`;
  const localMatch = cleaned.match(/^0(3\d{9})$/);
  if (localMatch) return `92${localMatch[1]!}`;
  const bareMatch = cleaned.match(/^(3\d{9})$/);
  if (bareMatch) return `92${bareMatch[1]!}`;
  return null;
}

/**
 * Returns the number in local `03xxxxxxxxx` format (with leading zero)
 * suitable for SMS gateway calls.
 */
export function formatPhoneForApi(phone: string): string {
  const canonical = canonicalizePhone(phone);
  if (canonical && canonical.startsWith("92") && canonical.length === 12) return `0${canonical.slice(2)}`;
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) return digits;
  if (digits.startsWith("92")) return `0${digits.slice(2)}`;
  return `0${digits}`;
}

/** Returns true iff the input normalizes to a valid 12-digit Pakistani mobile. */
export function isValidPhone(phone: string): boolean {
  const canonical = canonicalizePhone(phone);
  return canonical !== null;
}
