const BASE = `/api`;

function getToken() {
  return localStorage.getItem("rider_token") || "";
}

export async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers as Record<string, string> || {}),
  };
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export const api = {
  sendOtp:  (phone: string) => apiFetch("/auth/send-otp", { method: "POST", body: JSON.stringify({ phone }) }),
  verifyOtp:(phone: string, otp: string) => apiFetch("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, otp }) }),

  getMe:       () => apiFetch("/rider/me"),
  setOnline:   (isOnline: boolean) => apiFetch("/rider/online", { method: "PATCH", body: JSON.stringify({ isOnline }) }),
  updateProfile:(data: any) => apiFetch("/rider/profile", { method: "PATCH", body: JSON.stringify(data) }),
  getRequests: () => apiFetch("/rider/requests"),
  getActive:   () => apiFetch("/rider/active"),
  acceptOrder: (id: string) => apiFetch(`/rider/orders/${id}/accept`, { method: "POST", body: "{}" }),
  updateOrder: (id: string, status: string) => apiFetch(`/rider/orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  acceptRide:  (id: string) => apiFetch(`/rider/rides/${id}/accept`, { method: "POST", body: "{}" }),
  updateRide:  (id: string, status: string) => apiFetch(`/rider/rides/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  getHistory:  () => apiFetch("/rider/history"),
  getEarnings: () => apiFetch("/rider/earnings"),

  // Wallet
  getWallet:      () => apiFetch("/rider/wallet/transactions"),
  withdrawWallet: (data: { amount: number; bankName: string; accountNumber: string; accountTitle: string; note?: string }) =>
    apiFetch("/rider/wallet/withdraw", { method: "POST", body: JSON.stringify(data) }),

  // Notifications
  getNotifications:  () => apiFetch("/rider/notifications"),
  markAllRead:       () => apiFetch("/rider/notifications/read-all", { method: "PATCH", body: "{}" }),
};
