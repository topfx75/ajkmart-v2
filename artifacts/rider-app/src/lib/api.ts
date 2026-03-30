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
  const isFormData = opts.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
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
    const err = await res.json().catch(() => ({ error: res.statusText }));
    /* 403 only triggers logout when the server signals an auth/role denial, NOT for
       business-rule rejections (e.g. "insufficient balance" or "deposits disabled").
       We distinguish by checking the error message — auth denials say "Access denied"
       or "Unauthorized" while business-rule 403s carry a descriptive message. */
    if (res.status === 403) {
      const msg = err.error || "";
      const isAuthDenial = msg.toLowerCase() === "access denied" || msg.toLowerCase() === "forbidden";
      if (isAuthDenial) {
        clearTokens();
        window.dispatchEvent(new CustomEvent("ajkmart:logout", { detail: { reason: "access_denied" } }));
      }
      throw Object.assign(new Error(msg || "Access denied"), { status: 403 });
    }
    const error = new Error(err.error || "Request failed");
    Object.assign(error, { responseData: err, status: res.status });
    throw error;
  }
  return res.json();
}

export const api = {
  /* Auth */
  sendOtp:      (phone: string, captchaToken?: string) => apiFetch("/auth/send-otp", { method: "POST", body: JSON.stringify({ phone, captchaToken }) }),
  verifyOtp:    (phone: string, otp: string, deviceFingerprint?: string, captchaToken?: string) => apiFetch("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, otp, deviceFingerprint, captchaToken }) }),
  sendEmailOtp: (email: string, captchaToken?: string) => apiFetch("/auth/send-email-otp", { method: "POST", body: JSON.stringify({ email, captchaToken }) }),
  verifyEmailOtp:(email: string, otp: string, deviceFingerprint?: string, captchaToken?: string) => apiFetch("/auth/verify-email-otp", { method: "POST", body: JSON.stringify({ email, otp, deviceFingerprint, captchaToken }) }),
  loginUsername:(username: string, password: string, captchaToken?: string, deviceFingerprint?: string) => apiFetch("/auth/login/username", { method: "POST", body: JSON.stringify({ username, password, captchaToken, deviceFingerprint }) }),
  checkAvailable:(data: { phone?: string; email?: string; username?: string }) => apiFetch("/auth/check-available", { method: "POST", body: JSON.stringify(data) }),
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
  updateOrder:  (id: string, status: string, proofPhoto?: string) => apiFetch(`/rider/orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status, ...(proofPhoto ? { proofPhoto } : {}) }) }),
  acceptRide:   (id: string) => apiFetch(`/rider/rides/${id}/accept`, { method: "POST", body: "{}" }),
  updateRide:   (id: string, status: string, loc?: { lat: number; lng: number }) => apiFetch(`/rider/rides/${id}/status`, { method: "PATCH", body: JSON.stringify({ status, ...(loc || {}) }) }),
  counterRide:  (id: string, data: { counterFare: number; note?: string }) => apiFetch(`/rider/rides/${id}/counter`, { method: "POST", body: JSON.stringify(data) }),
  rejectOffer:  (id: string) => apiFetch(`/rider/rides/${id}/reject-offer`, { method: "POST", body: "{}" }),
  ignoreRide:   (id: string) => apiFetch(`/rider/rides/${id}/ignore`, { method: "POST", body: "{}" }),
  getCancelStats: () => apiFetch("/rider/cancel-stats"),
  getHistory:   () => apiFetch("/rider/history"),
  getEarnings:  () => apiFetch("/rider/earnings"),
  getMyReviews: () => apiFetch("/rider/reviews"),

  /* Location */
  updateLocation: (data: { latitude: number; longitude: number; accuracy?: number }) => apiFetch("/rider/location", { method: "PATCH", body: JSON.stringify(data) }),

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
