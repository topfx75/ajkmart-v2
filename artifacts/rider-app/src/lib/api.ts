const BASE = `/api`;

const TOKEN_KEY   = "ajkmart_rider_token";
const REFRESH_KEY = "ajkmart_rider_refresh_token";

/* ── Secure token storage ──────────────────────────────────────────────────────
   Access tokens are short-lived (15 min) so we store them in sessionStorage —
   they are cleared when the tab closes and are not accessible cross-tab.
   Refresh tokens have a longer lifetime; we use localStorage for persistence
   across sessions but rely on server-side revocation for security.

   Separate in-memory variables are used per token class so that storage-restricted
   environments (incognito strict mode, cross-origin iframes) cannot accidentally
   mix access and refresh tokens. */

let _inMemoryAccessToken   = "";
let _inMemoryRefreshToken  = "";

/* Access token helpers — sessionStorage */
function sessionGet(): string {
  try { return sessionStorage.getItem(TOKEN_KEY) ?? ""; } catch { return _inMemoryAccessToken; }
}
function sessionSet(value: string): void {
  try { sessionStorage.setItem(TOKEN_KEY, value); } catch { _inMemoryAccessToken = value; }
}
function sessionRemove(): void {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { _inMemoryAccessToken = ""; }
}

/* Refresh token helpers — localStorage */
function localGet(): string {
  try { return localStorage.getItem(REFRESH_KEY) ?? ""; } catch { return _inMemoryRefreshToken; }
}
function localSet(value: string): void {
  try { localStorage.setItem(REFRESH_KEY, value); } catch { _inMemoryRefreshToken = value; }
}
function localRemove(): void {
  try { localStorage.removeItem(REFRESH_KEY); } catch { _inMemoryRefreshToken = ""; }
}

/* Read the access token — check sessionStorage first, fall back to localStorage
   for sessions that were stored under the legacy scheme (pre-sessionStorage migration).
   On first successful read from localStorage the token is immediately migrated.
   Scans ALL localStorage keys that match rider auth patterns so that tokens written
   by any prior version of the app (regardless of key name) are picked up and cleaned. */
function getToken(): string {
  const fromSession = sessionGet();
  if (fromSession) return fromSession;

  /* Legacy migration: scan every localStorage key that looks like a rider access token.
     The REFRESH_KEY is explicitly skipped — it must stay in localStorage for persistence. */
  try {
    let legacy = "";
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key === REFRESH_KEY) continue;
      if (key.startsWith("rider_") || key.startsWith("ajkmart_rider")) {
        keysToRemove.push(key);
        /* Use the first non-empty value found as the token to migrate */
        if (!legacy) legacy = localStorage.getItem(key) ?? "";
      }
    }
    if (legacy) {
      sessionSet(legacy);
    }
    /* Remove all matched legacy keys regardless of whether a token was found */
    keysToRemove.forEach(k => { try { localStorage.removeItem(k); } catch {} });
    if (legacy) return legacy;
  } catch {}
  return "";
}

function getRefreshToken(): string {
  return localGet();
}

/* Sweep localStorage for any stale rider auth keys from older app versions.
   Removes every key that looks like a rider access token (matches "rider_" or
   "ajkmart_rider" prefix) but is NOT the current refresh-token key, which is
   intentionally kept in localStorage for cross-session persistence. */
function sweepLegacyTokens(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key === REFRESH_KEY) continue;
      if (key.startsWith("rider_") || key.startsWith("ajkmart_rider")) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => { try { localStorage.removeItem(k); } catch {} });
  } catch {}
}

/* Run a one-time sweep at module initialisation to evict any stale legacy
   tokens that prior app versions may have left behind. */
sweepLegacyTokens();

function clearTokens(): void {
  sessionRemove();
  localRemove();
  /* Erase all known legacy keys AND any additional pattern-matching keys */
  sweepLegacyTokens();
  _inMemoryAccessToken  = "";
  _inMemoryRefreshToken = "";
}

/* ── Module-level logout callback ─────────────────────────────────────────────
   The auth context registers this callback at mount time. Using a module-level
   reference avoids coupling to React's event system and guarantees the logout
   fires regardless of which component is mounted or whether the CustomEvent
   listener has been attached yet. */
let _logoutCallback: (() => void) | null = null;

export function registerLogoutCallback(fn: () => void): () => void {
  _logoutCallback = fn;
  return () => { if (_logoutCallback === fn) _logoutCallback = null; };
}

function triggerLogout(reason: string) {
  clearTokens();
  if (_logoutCallback) {
    _logoutCallback();
  }
  /* Also dispatch CustomEvent for components that still listen to it */
  try {
    window.dispatchEvent(new CustomEvent("ajkmart:logout", { detail: { reason } }));
  } catch {}
}

let _refreshPromise: Promise<boolean> | null = null;

async function attemptTokenRefresh(): Promise<boolean> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = _doRefresh();
  try { return await _refreshPromise; } finally { _refreshPromise = null; }
}

async function _doRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      clearTokens();
      return false;
    }
    const data = await res.json();
    if (data.token) {
      sessionSet(data.token);
      /* Sweep all legacy rider keys — broader than two hardcoded names */
      sweepLegacyTokens();
    }
    if (data.refreshToken) localSet(data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

interface ApiEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  code?: string;
}

export async function apiFetch(path: string, opts: RequestInit = {}, _retry = true): Promise<any> {
  const token = getToken();
  const isFormData = opts.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers as Record<string, string> || {}),
  };

  /* Build a combined signal: always include a 30s timeout, plus any caller-provided signal */
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), 30000);
  const externalSignal = opts.signal as AbortSignal | undefined;
  const signal: AbortSignal = externalSignal
    ? (typeof AbortSignal.any === "function"
        ? AbortSignal.any([timeoutController.signal, externalSignal])
        : externalSignal)
    : timeoutController.signal;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...opts, headers, signal });
  } finally {
    clearTimeout(timeoutId);
  }

  if (res.status === 401 && _retry) {
    const refreshed = await attemptTokenRefresh();
    if (refreshed) {
      return apiFetch(path, opts, false);
    }
    triggerLogout("session_expired");
    const err = await res.json().catch(() => ({ error: "Session expired" }));
    throw Object.assign(new Error(err.error || "Session expired. Please log in again."), { status: 401 });
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    /* 403 handling:
       - Auth/role denials (missing token, wrong role) trigger logout so the rider is
         sent to the login screen rather than seeing a cryptic error.
       - Business-rule 403s (withdrawals paused, feature disabled, etc.) must NOT
         trigger logout — the rider is still authenticated, just blocked by a policy.
       We use the backend's `code` field as the reliable machine-readable signal.
       When `code` is absent we fall back to a short allowlist of auth-specific phrases
       that the Express riderAuth/customerAuth/adminAuth middleware uses verbatim. */
    if (res.status === 403) {
      const msg = err.error || "";
      const code = err.code || "";
      const AUTH_DENY_CODES = ["AUTH_REQUIRED", "ROLE_DENIED", "TOKEN_INVALID", "TOKEN_EXPIRED"];
      const AUTH_DENY_PHRASES = ["access denied", "forbidden", "unauthorized", "authentication required", "token invalid", "token expired"];
      const isAuthDenial =
        AUTH_DENY_CODES.includes(code) ||
        AUTH_DENY_PHRASES.some(p => msg.toLowerCase().startsWith(p));
      if (isAuthDenial) {
        triggerLogout("access_denied");
      }
      throw Object.assign(new Error(msg || "Access denied"), { status: 403, code });
    }
    const error = new Error(err.error || "Request failed");
    Object.assign(error, { responseData: err, status: res.status });
    throw error;
  }
  const json = await res.json() as ApiEnvelope;
  return json.data !== undefined ? json.data : json;
}

export const api = {
  /* Auth */
  sendOtp:      (phone: string, captchaToken?: string, preferredChannel?: string) => apiFetch("/auth/send-otp", { method: "POST", body: JSON.stringify({ phone, captchaToken, ...(preferredChannel ? { preferredChannel } : {}) }) }),
  verifyOtp:    (phone: string, otp: string, deviceFingerprint?: string, captchaToken?: string) => apiFetch("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, otp, deviceFingerprint, captchaToken }) }),
  sendEmailOtp: (email: string, captchaToken?: string) => apiFetch("/auth/send-email-otp", { method: "POST", body: JSON.stringify({ email, captchaToken }) }),
  verifyEmailOtp:(email: string, otp: string, deviceFingerprint?: string, captchaToken?: string) => apiFetch("/auth/verify-email-otp", { method: "POST", body: JSON.stringify({ email, otp, deviceFingerprint, captchaToken }) }),
  loginUsername:(identifier: string, password: string, captchaToken?: string, deviceFingerprint?: string) => apiFetch("/auth/login", { method: "POST", body: JSON.stringify({ identifier, password, captchaToken, deviceFingerprint }) }),
  checkAvailable:(data: { phone?: string; email?: string; username?: string }, signal?: AbortSignal) => apiFetch("/auth/check-available", { method: "POST", body: JSON.stringify(data), ...(signal ? { signal } : {}) }),
  logout:       (refreshToken?: string) => apiFetch("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }).finally(clearTokens),
  refreshToken: () => attemptTokenRefresh(),

  registerRider: (data: {
    name: string; phone: string; email: string; cnic: string; vehicleType: string;
    vehicleRegistration: string; drivingLicense: string; password: string;
    captchaToken?: string; username?: string;
    address?: string; city?: string; emergencyContact?: string;
    vehiclePlate?: string; vehiclePhoto?: string; documents?: string;
  }) =>
    apiFetch("/auth/register", { method: "POST", body: JSON.stringify({ ...data, role: "rider", vehicleRegNo: data.vehicleRegistration }) }),
  emailRegisterRider: (data: {
    name: string; phone: string; email: string; cnic: string; vehicleType: string;
    vehicleRegistration: string; drivingLicense: string; password: string;
    captchaToken?: string; username?: string;
    address?: string; city?: string; emergencyContact?: string;
    vehiclePlate?: string; vehiclePhoto?: string; documents?: string;
  }) =>
    apiFetch("/auth/email-register", { method: "POST", body: JSON.stringify({ ...data, role: "rider" }) }),
  uploadFile: (data: { file: string; filename?: string; mimeType?: string }) =>
    apiFetch("/uploads", { method: "POST", body: JSON.stringify(data) }),
  forgotPassword: (data: { method: "phone" | "email"; phone?: string; email?: string; captchaToken?: string }) =>
    apiFetch("/auth/forgot-password", { method: "POST", body: JSON.stringify(data) }),
  resetPassword: (data: { phone?: string; email?: string; otp: string; newPassword: string; totpCode?: string; captchaToken?: string }) =>
    apiFetch("/auth/reset-password", { method: "POST", body: JSON.stringify(data) }),
  socialGoogle: (data: { idToken: string }) =>
    apiFetch("/auth/social/google", { method: "POST", body: JSON.stringify(data) }),
  socialFacebook: (data: { accessToken: string }) =>
    apiFetch("/auth/social/facebook", { method: "POST", body: JSON.stringify(data) }),
  magicLinkVerify: (data: { token: string }) =>
    apiFetch("/auth/magic-link/verify", { method: "POST", body: JSON.stringify(data) }),
  twoFactorSetup: () =>
    apiFetch("/auth/2fa/setup"),
  twoFactorEnable: (data: { code: string }) =>
    apiFetch("/auth/2fa/verify-setup", { method: "POST", body: JSON.stringify(data) }),
  twoFactorVerify: (data: { code: string; tempToken?: string; deviceFingerprint?: string; trustDevice?: boolean }) =>
    apiFetch("/auth/2fa/verify", { method: "POST", body: JSON.stringify(data) }),
  twoFactorRecovery: (data: { backupCode: string; tempToken?: string; deviceFingerprint?: string }) =>
    apiFetch("/auth/2fa/recovery", { method: "POST", body: JSON.stringify(data) }),
  twoFactorDisable: (data: { code: string }) =>
    apiFetch("/auth/2fa/disable", { method: "POST", body: JSON.stringify(data) }),
  sendMagicLink: (email: string) =>
    apiFetch("/auth/magic-link/send", { method: "POST", body: JSON.stringify({ email }) }),

  /* Token helpers */
  storeTokens: (token: string, refreshToken?: string) => {
    /* Store access token in sessionStorage; refresh token in localStorage */
    sessionSet(token);
    if (refreshToken) localSet(refreshToken);
    /* Sweep all stale legacy rider access keys from localStorage */
    sweepLegacyTokens();
  },
  clearTokens,
  getToken,
  getRefreshToken,
  registerLogoutCallback,

  /* Rider */
  getMe:        (signal?: AbortSignal) => apiFetch("/rider/me", signal ? { signal } : {}),
  setOnline:    (isOnline: boolean) => apiFetch("/rider/online", { method: "PATCH", body: JSON.stringify({ isOnline }) }),
  updateProfile:(data: any) => apiFetch("/rider/profile", { method: "PATCH", body: JSON.stringify(data) }),
  getRequests:  () => apiFetch("/rider/requests"),
  getActive:    () => apiFetch("/rider/active"),
  acceptOrder:  (id: string) => apiFetch(`/rider/orders/${id}/accept`, { method: "POST", body: "{}" }),
  rejectOrder:  (id: string, reason?: string) => apiFetch(`/rider/orders/${id}/reject`, { method: "POST", body: JSON.stringify({ reason: reason || "not_interested" }) }),
  updateOrder:  (id: string, status: string, proofPhoto?: string) => apiFetch(`/rider/orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status, ...(proofPhoto ? { proofPhoto } : {}) }) }),
  acceptRide:   (id: string) => apiFetch(`/rider/rides/${id}/accept`, { method: "POST", body: "{}" }),
  updateRide:   (id: string, status: string, loc?: { lat: number; lng: number }) => apiFetch(`/rider/rides/${id}/status`, { method: "PATCH", body: JSON.stringify({ status, ...(loc || {}) }) }),
  verifyRideOtp:(id: string, otp: string) => apiFetch(`/rider/rides/${id}/verify-otp`, { method: "POST", body: JSON.stringify({ otp }) }),
  counterRide:  (id: string, data: { counterFare: number; note?: string }) => apiFetch(`/rider/rides/${id}/counter`, { method: "POST", body: JSON.stringify(data) }),
  rejectOffer:  (id: string) => apiFetch(`/rider/rides/${id}/reject-offer`, { method: "POST", body: "{}" }),
  ignoreRide:   (id: string) => apiFetch(`/rider/rides/${id}/ignore`, { method: "POST", body: "{}" }),
  getCancelStats: () => apiFetch("/rider/cancel-stats"),
  getIgnoreStats: () => apiFetch("/rider/ignore-stats"),
  getPenaltyHistory: () => apiFetch("/rider/penalty-history"),
  getHistory:   () => apiFetch("/rider/history"),
  getEarnings:  () => apiFetch("/rider/earnings"),
  getMyReviews: () => apiFetch("/rider/reviews"),

  /* Location */
  updateLocation: (data: { latitude: number; longitude: number; accuracy?: number; speed?: number; heading?: number; batteryLevel?: number; mockProvider?: boolean; rideId?: string }) => apiFetch("/rider/location", { method: "PATCH", body: JSON.stringify(data) }),
  batchLocation: (pings: Array<{ timestamp: string; latitude: number; longitude: number; accuracy?: number; speed?: number; heading?: number; batteryLevel?: number; mockProvider?: boolean; action?: string | null }>) =>
    apiFetch("/rider/location/batch", { method: "POST", body: JSON.stringify({ locations: pings }) }),

  /* Wallet */
  getWallet:      () => apiFetch("/rider/wallet/transactions"),
  getMinBalance:  () => apiFetch("/rider/wallet/min-balance"),
  withdrawWallet: (data: { amount: number; bankName: string; accountNumber: string; accountTitle: string; paymentMethod?: string; note?: string }) =>
    apiFetch("/rider/wallet/withdraw", { method: "POST", body: JSON.stringify(data) }),
  submitDeposit:  (data: { amount: number; paymentMethod: string; transactionId: string; accountNumber?: string; note?: string }) =>
    apiFetch("/rider/wallet/deposit", { method: "POST", body: JSON.stringify(data) }),
  getDeposits:    () => apiFetch("/rider/wallet/deposits"),

  /* COD Remittance */
  getCodSummary:       () => apiFetch("/rider/cod-summary"),
  submitCodRemittance: (data: { amount: number; paymentMethod: string; accountNumber: string; transactionId?: string; note?: string }) =>
    apiFetch("/rider/cod/remit", { method: "POST", body: JSON.stringify(data) }),

  /* Notifications */
  getNotifications: () => apiFetch("/rider/notifications"),
  markAllRead:      () => apiFetch("/rider/notifications/read-all", { method: "PATCH", body: "{}" }),
  markOneRead:      (id: string) => apiFetch(`/rider/notifications/${id}/read`, { method: "PATCH", body: "{}" }),

  /* Settings */
  getSettings:    () => apiFetch("/settings"),
  updateSettings: (data: Record<string, unknown>) => apiFetch("/settings", { method: "PUT", body: JSON.stringify(data) }),
};
