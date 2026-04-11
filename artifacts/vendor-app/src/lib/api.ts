const BASE = import.meta.env.VITE_CAPACITOR === "true" && import.meta.env.VITE_API_BASE_URL
  ? `${(import.meta.env.VITE_API_BASE_URL as string).replace(/\/+$/, "")}/api`
  : `/api`;

const TOKEN_KEY   = "ajkmart_vendor_token";
const REFRESH_KEY = "ajkmart_vendor_refresh_token";

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY) || "";
}

function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  /* Also clear legacy key if it exists */
  localStorage.removeItem("vendor_token");
}

/* ── Module-level logout callback ─────────────────────────────────────────────
   The auth context registers this callback at mount time so apiFetch can
   trigger a logout directly without relying on CustomEvent alone. */
let _logoutCallback: (() => void) | null = null;

export function registerLogoutCallback(fn: () => void): () => void {
  _logoutCallback = fn;
  return () => { if (_logoutCallback === fn) _logoutCallback = null; };
}

function triggerLogout(reason: string) {
  clearTokens();
  if (_logoutCallback) _logoutCallback();
  try { window.dispatchEvent(new CustomEvent("ajkmart:logout", { detail: { reason } })); } catch {}
}

type RefreshResult = "refreshed" | "auth_failed" | "transient";

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
      /* 5xx / network-level: transient — keep tokens, retry */
      if (res.status >= 500) return "transient";
      /* 401/403: refresh token is invalid — must re-authenticate */
      clearTokens();
      return "auth_failed";
    }
    const data = await res.json();
    if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
    if (data.refreshToken) localStorage.setItem(REFRESH_KEY, data.refreshToken);
    return "refreshed";
  } catch {
    /* Network errors (offline, timeout) are transient */
    return "transient";
  }
}

export async function apiFetch(path: string, opts: RequestInit = {}, _retryBudget = 2): Promise<any> {
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
  } catch (networkErr: unknown) {
    clearTimeout(timeoutId);
    /* Rethrow AbortError unchanged so callers can detect request cancellation */
    if (networkErr instanceof Error && networkErr.name === "AbortError") throw networkErr;
    /* Network-level failure (offline, timeout) — never log out for this */
    throw Object.assign(new Error("Network error. Please check your connection and try again."), { status: 0, transient: true });
  } finally {
    clearTimeout(timeoutId);
  }

  if (res.status === 401 && token && _retryBudget > 0) {
    const refreshResult = await attemptTokenRefresh();
    if (refreshResult === "refreshed") {
      return apiFetch(path, opts, _retryBudget - 1);
    }
    if (refreshResult === "transient" && _retryBudget > 1) {
      await new Promise((r) => setTimeout(r, 800));
      return apiFetch(path, opts, _retryBudget - 1);
    }
    if (refreshResult === "transient") {
      throw Object.assign(new Error("Connection issue. Please check your network and try again."), { status: 0, transient: true });
    }
    const currentToken = getToken();
    if (currentToken && currentToken !== token) {
      return apiFetch(path, opts, _retryBudget - 1);
    }
    triggerLogout("session_expired");
    const err = await res.json().catch(() => ({ error: "Session expired" }));
    throw Object.assign(new Error(err.error || "Session expired. Please log in again."), { status: 401 });
  }

  if (!res.ok) {
    if (res.status === 403) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      if (err.pendingApproval) {
        throw Object.assign(new Error(err.error || "Pending approval"), { status: 403, pendingApproval: true });
      }
      if (err.rejected) {
        throw Object.assign(new Error(err.error || "Application rejected"), { status: 403, rejected: true, approvalNote: err.approvalNote });
      }
      const msg = err.error || "";
      /* code may live at top level OR inside err.data (sendErrorWithData envelope) */
      const code = err.code || (err.data as Record<string, unknown> | undefined)?.code as string || "";
      /* APPROVAL_PENDING and APPROVAL_REJECTED are NOT auth failures — do not force logout */
      const AUTH_DENY_CODES = ["AUTH_REQUIRED", "ROLE_DENIED", "TOKEN_INVALID", "TOKEN_EXPIRED", "ACCOUNT_BANNED"];
      const AUTH_DENY_PHRASES = ["access denied", "forbidden", "unauthorized", "authentication required", "token invalid", "token expired"];
      const isAuthDenial =
        AUTH_DENY_CODES.includes(code) ||
        AUTH_DENY_PHRASES.some(p => msg.toLowerCase().startsWith(p));
      if (isAuthDenial) {
        triggerLogout("access_denied");
      }
      throw Object.assign(new Error(msg || "Access denied"), { status: 403, code });
    }
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  const json = await res.json();
  return json.data !== undefined ? json.data : json;
}

export const api = {
  /* Auth */
  sendOtp:      (phone: string, preferredChannel?: string, mode?: "login" | "register") => apiFetch("/auth/send-otp", { method: "POST", body: JSON.stringify({ phone, role: "vendor", ...(preferredChannel ? { preferredChannel } : {}), ...(mode ? { mode } : {}) }) }),
  verifyOtp:    (phone: string, otp: string, deviceFingerprint?: string, role?: string) => apiFetch("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, otp, ...(role ? { role } : {}), ...(deviceFingerprint ? { deviceFingerprint } : {}) }) }),
  sendEmailOtp: (email: string) => apiFetch("/auth/send-email-otp", { method: "POST", body: JSON.stringify({ email }) }),
  verifyEmailOtp:(email: string, otp: string, deviceFingerprint?: string) => apiFetch("/auth/verify-email-otp", { method: "POST", body: JSON.stringify({ email, otp, role: "vendor", ...(deviceFingerprint ? { deviceFingerprint } : {}) }) }),
  loginUsername:(identifier: string, password: string, deviceFingerprint?: string) => apiFetch("/auth/login", { method: "POST", body: JSON.stringify({ identifier, password, role: "vendor", ...(deviceFingerprint ? { deviceFingerprint } : {}) }) }),
  forgotPassword:(data: { phone?: string; email?: string; identifier?: string }) => apiFetch("/auth/forgot-password", { method: "POST", body: JSON.stringify(data) }),
  resetPassword:(data: { phone?: string; email?: string; identifier?: string; otp: string; newPassword: string; totpCode?: string }) => apiFetch("/auth/reset-password", { method: "POST", body: JSON.stringify(data) }),
  logout:       (refreshToken?: string) => apiFetch("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }).finally(clearTokens),
  refreshToken: () => attemptTokenRefresh(),
  checkAvailable: (data: { phone?: string; email?: string; username?: string }, signal?: AbortSignal) =>
    apiFetch("/auth/check-available", { method: "POST", body: JSON.stringify(data), signal }),
  vendorRegister: (data: { phone: string; storeName: string; storeCategory?: string; name?: string; cnic?: string; address?: string; city?: string; bankName?: string; bankAccount?: string; bankAccountTitle?: string; username?: string }) =>
    apiFetch("/auth/vendor-register", { method: "POST", body: JSON.stringify(data) }),
  socialGoogle: (data: { idToken: string }) =>
    apiFetch("/auth/social/google", { method: "POST", body: JSON.stringify({ ...data, role: "vendor" }) }),
  socialFacebook: (data: { accessToken: string }) =>
    apiFetch("/auth/social/facebook", { method: "POST", body: JSON.stringify({ ...data, role: "vendor" }) }),
  magicLinkSend: (email: string) =>
    apiFetch("/auth/magic-link/send", { method: "POST", body: JSON.stringify({ email }) }),
  magicLinkVerify: (data: { token: string }) =>
    apiFetch("/auth/magic-link/verify", { method: "POST", body: JSON.stringify(data) }),

  /* Token helpers */
  storeTokens: (token: string, refreshToken?: string) => {
    localStorage.setItem(TOKEN_KEY, token);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
    localStorage.removeItem("vendor_token");
  },
  clearTokens,
  getToken,
  getRefreshToken,
  registerLogoutCallback,

  /* Profile */
  getMe:         (signal?: AbortSignal) => apiFetch("/vendor/me", signal ? { signal } : {}),
  updateProfile: (data: Record<string, string | undefined>) => apiFetch("/vendor/profile", { method: "PATCH", body: JSON.stringify(data) }),

  /* Store management */
  getStore:      () => apiFetch("/vendor/store"),
  updateStore:   (data: any) => apiFetch("/vendor/store", { method: "PATCH", body: JSON.stringify(data) }),

  /* Stats & Analytics */
  getStats:      () => apiFetch("/vendor/stats"),
  getAnalytics:  (days?: number) => apiFetch(`/vendor/analytics${days ? `?days=${days}` : ""}`),

  /* Orders */
  getOrders:     (status?: string) => apiFetch(`/vendor/orders${status ? `?status=${status}` : ""}`),
  updateOrder:   (id: string, status: string, reason?: string) => apiFetch(`/vendor/orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status, ...(reason ? { reason } : {}) }) }),

  /* Products */
  getProducts:   (q?: string, category?: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category && category !== "all") params.set("category", category);
    const qs = params.toString();
    return apiFetch(`/vendor/products${qs ? `?${qs}` : ""}`);
  },
  createProduct:  (data: any) => apiFetch("/vendor/products", { method: "POST", body: JSON.stringify(data) }),
  bulkAddProducts:(products: any[]) => apiFetch("/vendor/products/bulk", { method: "POST", body: JSON.stringify({ products }) }),
  updateProduct:  (id: string, data: any) => apiFetch(`/vendor/products/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteProduct:  (id: string) => apiFetch(`/vendor/products/${id}`, { method: "DELETE" }),

  /* Promos */
  getPromos:     () => apiFetch("/vendor/promos"),
  createPromo:   (data: any) => apiFetch("/vendor/promos", { method: "POST", body: JSON.stringify(data) }),
  updatePromo:   (id: string, data: any) => apiFetch(`/vendor/promos/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  togglePromo:   (id: string) => apiFetch(`/vendor/promos/${id}/toggle`, { method: "PATCH", body: "{}" }),
  deletePromo:   (id: string) => apiFetch(`/vendor/promos/${id}`, { method: "DELETE" }),

  /* Reviews */
  getReviews:    (vendorId: string) => apiFetch(`/reviews/vendor/${vendorId}`),
  getVendorReviews: (params?: { page?: number; limit?: number; stars?: string; sort?: string }) => {
    const q = new URLSearchParams();
    if (params?.page)  q.set("page",  String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.stars) q.set("stars", params.stars);
    if (params?.sort)  q.set("sort",  params.sort);
    return apiFetch(`/vendor/reviews?${q.toString()}`);
  },
  getPublicReviews:    (vendorId: string) => apiFetch(`/reviews/vendor/${vendorId}`),
  postVendorReply:     (reviewId: string, reply: string) => apiFetch(`/reviews/${reviewId}/vendor-reply`, { method: "POST", body: JSON.stringify({ reply }) }),
  updateVendorReply:   (reviewId: string, reply: string) => apiFetch(`/reviews/${reviewId}/vendor-reply`, { method: "PUT", body: JSON.stringify({ reply }) }),
  deleteVendorReply:   (reviewId: string) => apiFetch(`/reviews/${reviewId}/vendor-reply`, { method: "DELETE" }),

  /* Wallet */
  getWallet:      () => apiFetch("/vendor/wallet/transactions"),
  withdrawWallet: (data: { amount: number; bankName: string; accountNumber: string; accountTitle: string; note?: string }) =>
    apiFetch("/vendor/wallet/withdraw", { method: "POST", body: JSON.stringify(data) }),

  /* Image Upload */
  uploadImage: async (file: File): Promise<{ url: string }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const result = await apiFetch("/uploads", {
            method: "POST",
            body: JSON.stringify({
              file: reader.result as string,
              filename: file.name,
              mimeType: file.type,
            }),
          });
          resolve({ url: result.url });
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  },

  /* Delivery Access */
  getDeliveryAccessStatus: () => apiFetch("/vendor/delivery-access/status"),
  requestDeliveryAccess:   (data: { serviceType?: string; reason?: string }) => apiFetch("/vendor/delivery-access/request", { method: "POST", body: JSON.stringify(data) }),

  /* Notifications */
  getNotifications:  () => apiFetch("/vendor/notifications"),
  markAllRead:       () => apiFetch("/vendor/notifications/read-all", { method: "PATCH", body: "{}" }),
  markNotificationRead: (id: string) => apiFetch(`/vendor/notifications/${id}/read`, { method: "PATCH", body: "{}" }),

  /* Platform config (public) */
  getPlatformConfig: () => apiFetch("/platform-config"),

  /* Settings — admin-only; keep for completeness but not called by vendor flows */
  getSettings:    () => apiFetch("/settings"),
  updateSettings: (data: Record<string, unknown>) => apiFetch("/settings", { method: "PUT", body: JSON.stringify(data) }),
};
