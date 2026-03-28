const BASE = `/api`;

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

async function attemptTokenRefresh(): Promise<boolean> {
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
    if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
    if (data.refreshToken) localStorage.setItem(REFRESH_KEY, data.refreshToken);
    return true;
  } catch {
    return false;
  }
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
      /* 403 from role/ban denial — revoke local session and force relogin */
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
  sendOtp:      (phone: string) => apiFetch("/auth/send-otp", { method: "POST", body: JSON.stringify({ phone }) }),
  verifyOtp:    (phone: string, otp: string) => apiFetch("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, otp }) }),
  sendEmailOtp: (email: string) => apiFetch("/auth/send-email-otp", { method: "POST", body: JSON.stringify({ email }) }),
  verifyEmailOtp:(email: string, otp: string) => apiFetch("/auth/verify-email-otp", { method: "POST", body: JSON.stringify({ email, otp }) }),
  loginUsername:(username: string, password: string) => apiFetch("/auth/login/username", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout:       (refreshToken?: string) => apiFetch("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }).finally(clearTokens),
  refreshToken: () => attemptTokenRefresh(),

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
  updateProfile: (data: any) => apiFetch("/vendor/profile", { method: "PATCH", body: JSON.stringify(data) }),

  /* Store management */
  getStore:      () => apiFetch("/vendor/store"),
  updateStore:   (data: any) => apiFetch("/vendor/store", { method: "PATCH", body: JSON.stringify(data) }),

  /* Stats & Analytics */
  getStats:      () => apiFetch("/vendor/stats"),
  getAnalytics:  (days?: number) => apiFetch(`/vendor/analytics${days ? `?days=${days}` : ""}`),

  /* Orders */
  getOrders:     (status?: string) => apiFetch(`/vendor/orders${status ? `?status=${status}` : ""}`),
  updateOrder:   (id: string, status: string) => apiFetch(`/vendor/orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),

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
  togglePromo:   (id: string) => apiFetch(`/vendor/promos/${id}/toggle`, { method: "PATCH", body: "{}" }),
  deletePromo:   (id: string) => apiFetch(`/vendor/promos/${id}`, { method: "DELETE" }),

  /* Wallet */
  getWallet:      () => apiFetch("/vendor/wallet/transactions"),
  withdrawWallet: (data: { amount: number; bankName: string; accountNumber: string; accountTitle: string; note?: string }) =>
    apiFetch("/vendor/wallet/withdraw", { method: "POST", body: JSON.stringify(data) }),

  /* Notifications */
  getNotifications:  () => apiFetch("/vendor/notifications"),
  markAllRead:       () => apiFetch("/vendor/notifications/read-all", { method: "PATCH", body: "{}" }),

  /* Settings */
  getSettings:    () => apiFetch("/settings"),
  updateSettings: (data: Record<string, unknown>) => apiFetch("/settings", { method: "PUT", body: JSON.stringify(data) }),
};
