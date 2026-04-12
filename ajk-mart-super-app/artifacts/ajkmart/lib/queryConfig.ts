import { type DefaultOptions } from "@tanstack/react-query";

/**
 * Shared React Query defaults optimized for slow and Edge networks.
 *
 * - networkMode: 'offlineFirst' — always serve cached data before network.
 * - staleTime: 3 min — avoid unnecessary refetches on slow connections.
 * - retry: 3 — tolerate transient connectivity failures.
 * - retryDelay: exponential backoff capped at 30 s.
 * - refetchOnReconnect: true — refresh stale data when connectivity returns.
 * - refetchOnWindowFocus: false — avoid redundant fetches on tab switch.
 */
export const slowNetworkQueryDefaults: DefaultOptions = {
  queries: {
    networkMode: "offlineFirst",
    retry: 3,
    retryDelay: (attempt: number) => Math.min(1500 * Math.pow(2, attempt - 1), 30_000),
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    staleTime: 3 * 60_000,
  },
};
