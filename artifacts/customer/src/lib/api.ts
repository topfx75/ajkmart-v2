const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") + "/api";

function getToken(): string | null {
  return localStorage.getItem("customer_token");
}
function setToken(t: string) {
  localStorage.setItem("customer_token", t);
}
function clearToken() {
  localStorage.removeItem("customer_token");
}

async function apiFetch(path: string, opts: RequestInit = {}): Promise<any> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
  return body;
}

export const api = {
  getToken,
  setToken,
  clearToken,

  checkIdentifier: (phone: string) =>
    apiFetch("/auth/check-identifier", { method: "POST", body: JSON.stringify({ phone, role: "customer" }) }),

  sendOtp: (phone: string) =>
    apiFetch("/auth/send-otp", { method: "POST", body: JSON.stringify({ phone, role: "customer" }) }),

  verifyOtp: (phone: string, otp: string) =>
    apiFetch("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, otp, role: "customer" }) }),

  getMe: () => apiFetch("/auth/me"),

  /* ── Profile ── */
  getProfile: () => apiFetch("/users/profile"),

  updateProfile: (data: { name?: string; email?: string; cnic?: string; city?: string; address?: string }) =>
    apiFetch("/users/profile", { method: "PUT", body: JSON.stringify(data) }),

  uploadAvatar: async (file: File): Promise<{ avatarUrl: string }> => {
    const token = getToken();
    const form = new FormData();
    form.append("avatar", file);
    const res = await fetch(`${BASE}/users/avatar`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Avatar upload failed");
    return body;
  },

  /* ── Settings ── */
  getSettings: () => apiFetch("/settings"),

  updateSettings: (data: Partial<{
    language: string;
    notifOrders: boolean;
    notifWallet: boolean;
    notifDeals: boolean;
    notifRides: boolean;
    darkMode: boolean;
  }>) => apiFetch("/settings", { method: "PUT", body: JSON.stringify(data) }),

  /* ── Security ── */
  setPassword: (password: string, currentPassword?: string) =>
    apiFetch("/auth/set-password", {
      method: "POST",
      body: JSON.stringify({ password, ...(currentPassword ? { currentPassword } : {}) }),
    }),

  /* ── Platform config (public) ── */
  getPlatformConfig: () => apiFetch("/platform-config"),

  /* ── Rides ── */
  estimate: (data: {
    pickupLat: number; pickupLng: number;
    dropLat: number; dropLng: number;
    type?: string;
  }) => apiFetch("/rides/estimate", { method: "POST", body: JSON.stringify(data) }),

  bookRide: (data: {
    pickupLat: number; pickupLng: number; pickupAddress: string;
    dropLat: number; dropLng: number; dropAddress: string;
    type?: string;
    fare: number;
    paymentMethod: string;
    isBargaining?: boolean;
    offeredFare?: number;
    isParcel?: boolean;
    receiverName?: string;
    receiverPhone?: string;
    packageType?: string;
  }) => apiFetch("/rides", { method: "POST", body: JSON.stringify(data) }),

  getMyRides: () => apiFetch("/rides"),

  getRide: (id: string) => apiFetch(`/rides/${id}`),

  cancelRide: (id: string) =>
    apiFetch(`/rides/${id}/cancel`, { method: "PATCH", body: JSON.stringify({ reason: "customer_cancelled" }) }),

  acceptBid: (id: string, bidId: string) =>
    apiFetch(`/rides/${id}/accept-bid`, { method: "PATCH", body: JSON.stringify({ bidId }) }),

  counterOffer: (id: string, offeredFare: number) =>
    apiFetch(`/rides/${id}/customer-counter`, { method: "PATCH", body: JSON.stringify({ offeredFare }) }),

  rateRide: (id: string, stars: number, comment?: string) =>
    apiFetch(`/rides/${id}/rate`, { method: "POST", body: JSON.stringify({ stars, comment }) }),

  geocode: async (query: string): Promise<{ lat: number; lng: number; display_name: string }[]> => {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
    const data = await res.json();
    return data.map((d: any) => ({ lat: parseFloat(d.lat), lng: parseFloat(d.lon), display_name: d.display_name }));
  },

  reverseGeocode: async (lat: number, lng: number): Promise<string> => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
      const data = await res.json();
      return data.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } catch {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  },
};
