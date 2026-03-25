import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetcher } from "@/lib/api";

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
  });
};

// Users
export const useUsers = () => {
  return useQuery({
    queryKey: ["admin-users"],
    queryFn: () => fetcher("/users"),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  });
};

// Orders
export const useOrders = () => {
  return useQuery({
    queryKey: ["admin-orders"],
    queryFn: () => fetcher("/orders"),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-orders"] }),
  });
};

// Rides
export const useRides = () => {
  return useQuery({
    queryKey: ["admin-rides"],
    queryFn: () => fetcher("/rides"),
  });
};

export const useUpdateRide = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      fetcher(`/rides/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-rides"] }),
  });
};

// Pharmacy Orders
export const usePharmacyOrders = () => {
  return useQuery({
    queryKey: ["admin-pharmacy"],
    queryFn: () => fetcher("/pharmacy-orders"),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-pharmacy"] }),
  });
};

// Parcel Bookings
export const useParcelBookings = () => {
  return useQuery({
    queryKey: ["admin-parcel"],
    queryFn: () => fetcher("/parcel-bookings"),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-parcel"] }),
  });
};

// Products
export const useProducts = () => {
  return useQuery({
    queryKey: ["admin-products"],
    queryFn: () => fetcher("/products"),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-products"] }),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-products"] }),
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

// Transactions
export const useTransactions = () => {
  return useQuery({
    queryKey: ["admin-transactions"],
    queryFn: () => fetcher("/transactions"),
  });
};
