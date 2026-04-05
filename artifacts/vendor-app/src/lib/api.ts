const BASE = import.meta.env.VITE_CAPACITOR === "true" && import.meta.env.VITE_API_BASE_URL
  ? `${(import.meta.env.VITE_API_BASE_URL as string).replace(/\/+$/, "")}/api`
  : `${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/api`;

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

let _refreshing: Promise<boolean> | null = null;

async function attemptTokenRefresh(): Promise<boolean> {
  if (_refreshing) return _refreshing;
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  _refreshing = (async () => {
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
      if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
      if (data.refreshToken) localStorage.setItem(REFRESH_KEY, data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      _refreshing = null;
    }
  })();
  return _refreshing;
}

export async function apiFetch(path: string, opts: RequestInit = {}, _retry = true): Promise<any> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers as Record<string, string> || {}),
  };
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });

  if (res.status === 401 && _retry) {
    const refreshed = await attemptTokenRefresh();
    if (refreshed) {
      return apiFetch(path, opts, false);
    }
    clearTokens();
    window.dispatchEvent(new CustomEvent("ajkmart:logout", { detail: { reason: "session_expired" } }));
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
      clearTokens();
      window.dispatchEvent(new CustomEvent("ajkmart:logout", { detail: { reason: "access_denied" } }));
      throw Object.assign(new Error(err.error || "Access denied"), { status: 403 });
    }
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export const api = {
  /* Auth */
  sendOtp:      (phone: string, preferredChannel?: string) => apiFetch("/auth/send-otp", { method: "POST", body: JSON.stringify({ phone, ...(preferredChannel ? { preferredChannel } : {}) }) }),
  verifyOtp:    (phone: string, otp: string, deviceFingerprint?: string) => apiFetch("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, otp, ...(deviceFingerprint ? { deviceFingerprint } : {}) }) }),
  sendEmailOtp: (email: string) => apiFetch("/auth/send-email-otp", { method: "POST", body: JSON.stringify({ email }) }),
  verifyEmailOtp:(email: string, otp: string, deviceFingerprint?: string) => apiFetch("/auth/verify-email-otp", { method: "POST", body: JSON.stringify({ email, otp, ...(deviceFingerprint ? { deviceFingerprint } : {}) }) }),
  loginUsername:(identifier: string, password: string, deviceFingerprint?: string) => apiFetch("/auth/login", { method: "POST", body: JSON.stringify({ identifier, password, ...(deviceFingerprint ? { deviceFingerprint } : {}) }) }),
  forgotPassword:(data: { phone?: string; email?: string; identifier?: string }) => apiFetch("/auth/forgot-password", { method: "POST", body: JSON.stringify(data) }),
  resetPassword:(data: { phone?: string; email?: string; identifier?: string; otp: string; newPassword: string; totpCode?: string }) => apiFetch("/auth/reset-password", { method: "POST", body: JSON.stringify(data) }),
  logout:       (refreshToken?: string) => apiFetch("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }).finally(clearTokens),
  refreshToken: () => attemptTokenRefresh(),
  checkAvailable: (data: { phone?: string; email?: string; username?: string }, signal?: AbortSignal) =>
    apiFetch("/auth/check-available", { method: "POST", body: JSON.stringify(data), signal }),
  vendorRegister: (data: { phone: string; storeName: string; storeCategory?: string; name?: string; cnic?: string; address?: string; city?: string; bankName?: string; bankAccount?: string; bankAccountTitle?: string; username?: string }) =>
    apiFetch("/auth/vendor-register", { method: "POST", body: JSON.stringify(data) }),
  socialGoogle: (data: { idToken: string }) =>
    apiFetch("/auth/social/google", { method: "POST", body: JSON.stringify(data) }),
  socialFacebook: (data: { accessToken: string }) =>
    apiFetch("/auth/social/facebook", { method: "POST", body: JSON.stringify(data) }),
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

  /* Profile */
  getMe:         () => apiFetch("/vendor/me"),
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

  /* Settings */
  getSettings:    () => apiFetch("/settings"),
  updateSettings: (data: Record<string, unknown>) => apiFetch("/settings", { method: "PUT", body: JSON.stringify(data) }),
};
