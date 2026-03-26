import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetcher } from "@/lib/api";

const REFETCH_INTERVAL = 30_000;

// Auth
export const useAdminLogin = () => {
  return useMutation({
    mutationFn: (secret: string) =>
      fetcher("/auth", {
        method: "POST",
        body: JSON.stringify({ secret }),
      }),
  });
};

// Dashboard Stats
export const useStats = () => {
  return useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => fetcher("/stats"),
    refetchInterval: REFETCH_INTERVAL,
  });
};

// Users
export const useUsers = () => {
  return useQuery({
    queryKey: ["admin-users"],
    queryFn: () => fetcher("/users"),
    refetchInterval: REFETCH_INTERVAL,
  });
};

export const useUpdateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; role?: string; isActive?: boolean; walletBalance?: string | number }) =>
      fetcher(`/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-transactions"] });
    },
  });
};

export const useWalletTopup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amount, description }: { id: string; amount: number; description?: string }) =>
      fetcher(`/users/${id}/wallet-topup`, {
        method: "POST",
        body: JSON.stringify({ amount, description }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    },
  });
};

// Orders
export const useOrders = () => {
  return useQuery({
    queryKey: ["admin-orders"],
    queryFn: () => fetcher("/orders"),
    refetchInterval: REFETCH_INTERVAL,
  });
};

export const useUpdateOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      fetcher(`/orders/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders-enriched"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    },
  });
};

// Rides
export const useRides = () => {
  return useQuery({
    queryKey: ["admin-rides"],
    queryFn: () => fetcher("/rides"),
    refetchInterval: REFETCH_INTERVAL,
  });
};

export const useUpdateRide = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, riderName, riderPhone }: { id: string; status: string; riderName?: string; riderPhone?: string }) =>
      fetcher(`/rides/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, riderName, riderPhone }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-rides"] });
      queryClient.invalidateQueries({ queryKey: ["admin-rides-enriched"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    },
  });
};

// Pharmacy Orders
export const usePharmacyOrders = () => {
  return useQuery({
    queryKey: ["admin-pharmacy"],
    queryFn: () => fetcher("/pharmacy-enriched"),
    refetchInterval: REFETCH_INTERVAL,
  });
};

export const useUpdatePharmacyOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      fetcher(`/pharmacy-orders/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-pharmacy"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    },
  });
};

// Parcel Bookings
export const useParcelBookings = () => {
  return useQuery({
    queryKey: ["admin-parcel"],
    queryFn: () => fetcher("/parcel-enriched"),
    refetchInterval: REFETCH_INTERVAL,
  });
};

export const useUpdateParcelBooking = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      fetcher(`/parcel-bookings/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-parcel"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    },
  });
};

// Delete User
export const useDeleteUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetcher(`/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    },
  });
};

// User Activity
export const useUserActivity = (userId: string | null) => {
  return useQuery({
    queryKey: ["admin-user-activity", userId],
    queryFn: () => fetcher(`/users/${userId}/activity`),
    enabled: !!userId,
  });
};

// Products
export const useProducts = () => {
  return useQuery({
    queryKey: ["admin-products"],
    queryFn: () => fetcher("/products"),
    refetchInterval: REFETCH_INTERVAL,
  });
};

export const useCreateProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) =>
      fetcher("/products", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    },
  });
};

export const useUpdateProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) =>
      fetcher(`/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-products"] }),
  });
};

export const useDeleteProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetcher(`/products/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    },
  });
};

// Broadcast
export const useBroadcast = () => {
  return useMutation({
    mutationFn: (data: any) =>
      fetcher("/broadcast", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  });
};

// Transactions (enriched with user names)
export const useTransactions = () => {
  return useQuery({
    queryKey: ["admin-transactions"],
    queryFn: () => fetcher("/transactions-enriched"),
    refetchInterval: REFETCH_INTERVAL,
  });
};

// Enriched endpoints (orders + user info)
export const useOrdersEnriched = () => {
  return useQuery({
    queryKey: ["admin-orders-enriched"],
    queryFn: () => fetcher("/orders-enriched"),
    refetchInterval: REFETCH_INTERVAL,
  });
};

export const useRidesEnriched = () => {
  return useQuery({
    queryKey: ["admin-rides-enriched"],
    queryFn: () => fetcher("/rides-enriched"),
    refetchInterval: REFETCH_INTERVAL,
  });
};

// Platform Settings
export const usePlatformSettings = () => {
  return useQuery({
    queryKey: ["admin-platform-settings"],
    queryFn: () => fetcher("/platform-settings"),
  });
};

export const useUpdatePlatformSettings = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: Array<{ key: string; value: string }>) =>
      fetcher("/platform-settings", {
        method: "PUT",
        body: JSON.stringify({ settings }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-platform-settings"] }),
  });
};

/* ── Vendors ── */
export const useVendors = () =>
  useQuery({ queryKey: ["admin-vendors"], queryFn: () => fetcher("/vendors"), refetchInterval: REFETCH_INTERVAL });

export const useUpdateVendorStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) => fetcher(`/vendors/${id}/status`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-vendors"] }),
  });
};

export const useVendorPayout = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amount, description }: { id: string; amount: number; description?: string }) =>
      fetcher(`/vendors/${id}/payout`, { method: "POST", body: JSON.stringify({ amount, description }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-vendors"] }); qc.invalidateQueries({ queryKey: ["admin-transactions"] }); },
  });
};

export const useVendorCredit = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amount, description }: { id: string; amount: number; description?: string }) =>
      fetcher(`/vendors/${id}/credit`, { method: "POST", body: JSON.stringify({ amount, description }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-vendors"] }); qc.invalidateQueries({ queryKey: ["admin-transactions"] }); },
  });
};

/* ── Riders ── */
export const useRiders = () =>
  useQuery({ queryKey: ["admin-riders"], queryFn: () => fetcher("/riders"), refetchInterval: REFETCH_INTERVAL });

export const useUpdateRiderStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) => fetcher(`/riders/${id}/status`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-riders"] }),
  });
};

export const useRiderPayout = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amount, description }: { id: string; amount: number; description?: string }) =>
      fetcher(`/riders/${id}/payout`, { method: "POST", body: JSON.stringify({ amount, description }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-riders"] }); qc.invalidateQueries({ queryKey: ["admin-transactions"] }); },
  });
};

export const useRiderBonus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amount, description }: { id: string; amount: number; description?: string }) =>
      fetcher(`/riders/${id}/bonus`, { method: "POST", body: JSON.stringify({ amount, description }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-riders"] }); qc.invalidateQueries({ queryKey: ["admin-transactions"] }); },
  });
};

/* ── Promo Codes ── */
export const usePromoCodes = () =>
  useQuery({ queryKey: ["admin-promo-codes"], queryFn: () => fetcher("/promo-codes"), refetchInterval: REFETCH_INTERVAL });

export const useCreatePromoCode = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => fetcher("/promo-codes", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-promo-codes"] }),
  });
};

export const useUpdatePromoCode = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) => fetcher(`/promo-codes/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-promo-codes"] }),
  });
};

export const useDeletePromoCode = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetcher(`/promo-codes/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-promo-codes"] }),
  });
};
