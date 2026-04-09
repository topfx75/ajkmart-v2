const BASE = import.meta.env.VITE_CAPACITOR === "true" && import.meta.env.VITE_API_BASE_URL
  ? `${(import.meta.env.VITE_API_BASE_URL as string).replace(/\/+$/, "")}/api`
  : `/api`;

const TOKEN_KEY   = "ajkmart_rider_token";
const REFRESH_KEY = "ajkmart_rider_refresh_token";

/* ── Secure token storage ──────────────────────────────────────────────────────
   Access tokens are stored in localStorage so that closing a tab mid-trip does
   not force a full re-login — the rider can reopen the browser and the active
   trip screen rehydrates automatically via the existing refresh-token flow.
   Refresh tokens also live in localStorage for cross-session persistence.
   Server-side revocation (tokenVersion) is the primary security boundary.

   Separate in-memory variables are used per token class so that storage-restricted
   environments (incognito strict mode, cross-origin iframes) cannot accidentally
   mix access and refresh tokens. */

let _inMemoryAccessToken   = "";
let _inMemoryRefreshToken  = "";

/* Access token helpers — localStorage (persists across tab close / mid-trip reopen) */
function sessionGet(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return _inMemoryAccessToken; }
}
function sessionSet(value: string): void {
  try { localStorage.setItem(TOKEN_KEY, value); } catch { _inMemoryAccessToken = value; }
}
function sessionRemove(): void {
  try { localStorage.removeItem(TOKEN_KEY); } catch { _inMemoryAccessToken = ""; }
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

/* Read the access token from localStorage (current scheme) or scan for legacy keys. */
function getToken(): string {
  return sessionGet();
}

function getRefreshToken(): string {
  return localGet();
}

/* Sweep localStorage for any stale rider auth keys from older app versions.
   Removes every key that looks like a rider access token (matches "rider_" or
   "ajkmart_rider" prefix) but is NOT the current access-token key or refresh-token key,
   which are intentionally kept in localStorage for mid-trip rehydration. */
function sweepLegacyTokens(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key === TOKEN_KEY || key === REFRESH_KEY) continue;
      if (key.startsWith("rider_") || key.startsWith("ajkmart_rider")) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => { try { localStorage.removeItem(k); } catch {} });
  } catch {}
}

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

let _refreshPromise: Promise<RefreshResult> | null = null;

async function attemptTokenRefresh(): Promise<RefreshResult> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = _doRefresh();
  try {
    const result = await _refreshPromise;
    return result;
  } finally {
    _refreshPromise = null;
  }
}

type RefreshResult = "refreshed" | "auth_failed" | "transient";

async function _doRefresh(): Promise<RefreshResult> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return "auth_failed";
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      /* 5xx / network-level: transient, keep tokens, let apiFetch retry */
      if (res.status >= 500) return "transient";
      /* 401 / 403: refresh token is invalid — must re-authenticate */
      clearTokens();
      return "auth_failed";
    }
    const data = await res.json();
    if (data.token) {
      sessionSet(data.token);
      sweepLegacyTokens();
    }
    if (data.refreshToken) localSet(data.refreshToken);
    return "refreshed";
  } catch {
    /* Network errors (offline, timeout) are transient */
    return "transient";
  }
}


interface ApiEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  code?: string;
}

/** Typed shape returned by GET /rider/requests (includes serverTime envelope field) */
export interface RiderRequestsResponse {
  orders: any[];
  rides: any[];
  /** ISO timestamp from the server at response time — used to offset AcceptCountdown */
  _serverTime: string | null;
}

export async function apiFetch(path: string, opts: RequestInit = {}, _retryBudget = 2, _returnEnvelope = false): Promise<any> {
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

  if (res.status === 401 && token && _retryBudget > 0) {
    const refreshResult = await attemptTokenRefresh();
    if (refreshResult === "refreshed") {
      return apiFetch(path, opts, _retryBudget - 1, _returnEnvelope);
    }
    if (refreshResult === "transient" && _retryBudget > 1) {
      await new Promise((r) => setTimeout(r, 800));
      return apiFetch(path, opts, _retryBudget - 1, _returnEnvelope);
    }
    if (refreshResult === "transient") {
      throw Object.assign(new Error("Connection issue. Please check your network and try again."), { status: 0, transient: true });
    }
    const currentToken = getToken();
    if (currentToken && currentToken !== token) {
      return apiFetch(path, opts, _retryBudget - 1, _returnEnvelope);
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
      /* code and rejectionReason may live at top level OR inside err.data (sendErrorWithData envelope) */
      const code = err.code || (err.data as Record<string, unknown> | undefined)?.code as string || "";
      const rejectionReason = err.rejectionReason ?? (err.data as Record<string, unknown> | undefined)?.rejectionReason ?? null;
      const approvalStatus = err.approvalStatus ?? (err.data as Record<string, unknown> | undefined)?.approvalStatus ?? null;
      /* APPROVAL_PENDING and APPROVAL_REJECTED are NOT auth failures — do not force logout */
      const AUTH_DENY_CODES = ["AUTH_REQUIRED", "ROLE_DENIED", "TOKEN_INVALID", "TOKEN_EXPIRED", "ACCOUNT_BANNED"];
      const AUTH_DENY_PHRASES = ["access denied", "forbidden", "unauthorized", "authentication required", "token invalid", "token expired"];
      const isAuthDenial =
        AUTH_DENY_CODES.includes(code) ||
        AUTH_DENY_PHRASES.some(p => msg.toLowerCase().startsWith(p));
      if (isAuthDenial) {
        triggerLogout("access_denied");
      }
      throw Object.assign(new Error(msg || "Access denied"), { status: 403, code, rejectionReason, approvalStatus });
    }
    const error = new Error(err.error || "Request failed");
    Object.assign(error, { responseData: err, status: res.status });
    throw error;
  }
  const json = await res.json() as ApiEnvelope;
  /* When returnEnvelope is true, the caller receives the full JSON envelope
     (e.g. to read top-level fields like serverTime alongside data). */
  if (_returnEnvelope) return json;
  return json.data !== undefined ? json.data : json;
}

export const api = {
  /* Auth */
  sendOtp:      (phone: string, captchaToken?: string, preferredChannel?: string) => apiFetch("/auth/send-otp", { method: "POST", body: JSON.stringify({ phone, captchaToken, ...(preferredChannel ? { preferredChannel } : {}) }) }),
  verifyOtp:    (phone: string, otp: string, deviceFingerprint?: string, captchaToken?: string) => apiFetch("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, otp, role: "rider", deviceFingerprint, captchaToken }) }),
  sendEmailOtp: (email: string, captchaToken?: string) => apiFetch("/auth/send-email-otp", { method: "POST", body: JSON.stringify({ email, captchaToken }) }),
  verifyEmailOtp:(email: string, otp: string, deviceFingerprint?: string, captchaToken?: string) => apiFetch("/auth/verify-email-otp", { method: "POST", body: JSON.stringify({ email, otp, role: "rider", deviceFingerprint, captchaToken }) }),
  loginUsername:(identifier: string, password: string, captchaToken?: string, deviceFingerprint?: string) => apiFetch("/auth/login", { method: "POST", body: JSON.stringify({ identifier, password, role: "rider", captchaToken, deviceFingerprint }) }),
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
  /* Multipart/form-data upload — avoids large base64 payload; used for delivery proof.
     Calls /uploads/proof which is gated by riderAuth and handles multipart parsing. */
  uploadProof: (file: File) => {
    const form = new FormData();
    form.append("file", file, file.name || "proof.jpg");
    form.append("purpose", "delivery_proof");
    return apiFetch("/uploads/proof", { method: "POST", body: form });
  },
  forgotPassword: (data: { method: "phone" | "email"; phone?: string; email?: string; captchaToken?: string }) =>
    apiFetch("/auth/forgot-password", { method: "POST", body: JSON.stringify(data) }),
  resetPassword: (data: { phone?: string; email?: string; otp: string; newPassword: string; totpCode?: string; captchaToken?: string }) =>
    apiFetch("/auth/reset-password", { method: "POST", body: JSON.stringify(data) }),
  socialGoogle: (data: { idToken: string }) =>
    apiFetch("/auth/social/google", { method: "POST", body: JSON.stringify({ ...data, role: "rider" }) }),
  socialFacebook: (data: { accessToken: string }) =>
    apiFetch("/auth/social/facebook", { method: "POST", body: JSON.stringify({ ...data, role: "rider" }) }),
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
  getRequests:  (): Promise<RiderRequestsResponse> =>
    apiFetch("/rider/requests", {}, 2, true).then((env: ApiEnvelope<{ orders: any[]; rides: any[] }> & { serverTime?: string }) => {
      const payload = env.data ?? { orders: [], rides: [] };
      return {
        orders: payload.orders ?? [],
        rides: payload.rides ?? [],
        _serverTime: env.serverTime ?? null,
      };
    }),
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
