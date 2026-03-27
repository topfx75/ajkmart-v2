const BASE = `/api`;

const TOKEN_KEY   = "ajkmart_rider_token";
const REFRESH_KEY = "ajkmart_rider_refresh_token";

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
  localStorage.removeItem("rider_token");
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
  checkAvailable:(data: { phone?: string; email?: string; username?: string }) => apiFetch("/auth/check-available", { method: "POST", body: JSON.stringify(data) }),
  logout:       (refreshToken?: string) => apiFetch("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }).finally(clearTokens),
  refreshToken: () => attemptTokenRefresh(),

  /* Token helpers */
  storeTokens: (token: string, refreshToken?: string) => {
    localStorage.setItem(TOKEN_KEY, token);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
    localStorage.removeItem("rider_token");
  },
  clearTokens,
  getToken,
  getRefreshToken,

  /* Rider */
  getMe:        () => apiFetch("/rider/me"),
  setOnline:    (isOnline: boolean) => apiFetch("/rider/online", { method: "PATCH", body: JSON.stringify({ isOnline }) }),
  updateProfile:(data: any) => apiFetch("/rider/profile", { method: "PATCH", body: JSON.stringify(data) }),
  getRequests:  () => apiFetch("/rider/requests"),
  getActive:    () => apiFetch("/rider/active"),
  acceptOrder:  (id: string) => apiFetch(`/rider/orders/${id}/accept`, { method: "POST", body: "{}" }),
  updateOrder:  (id: string, status: string) => apiFetch(`/rider/orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  acceptRide:   (id: string) => apiFetch(`/rider/rides/${id}/accept`, { method: "POST", body: "{}" }),
  updateRide:   (id: string, status: string) => apiFetch(`/rider/rides/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  counterRide:  (id: string, data: { counterFare: number; note?: string }) => apiFetch(`/rider/rides/${id}/counter`, { method: "POST", body: JSON.stringify(data) }),
  rejectOffer:  (id: string) => apiFetch(`/rider/rides/${id}/reject-offer`, { method: "POST", body: "{}" }),
  getHistory:   () => apiFetch("/rider/history"),
  getEarnings:  () => apiFetch("/rider/earnings"),

  /* Wallet */
  getWallet:      () => apiFetch("/rider/wallet/transactions"),
  withdrawWallet: (data: { amount: number; bankName: string; accountNumber: string; accountTitle: string; paymentMethod?: string; note?: string }) =>
    apiFetch("/rider/wallet/withdraw", { method: "POST", body: JSON.stringify(data) }),

  /* COD Remittance */
  getCodSummary:       () => apiFetch("/rider/cod-summary"),
  submitCodRemittance: (data: { amount: number; paymentMethod: string; accountNumber: string; transactionId?: string; note?: string }) =>
    apiFetch("/rider/cod/remit", { method: "POST", body: JSON.stringify(data) }),

  /* Notifications */
  getNotifications: () => apiFetch("/rider/notifications"),
  markAllRead:      () => apiFetch("/rider/notifications/read-all", { method: "PATCH", body: "{}" }),
};
