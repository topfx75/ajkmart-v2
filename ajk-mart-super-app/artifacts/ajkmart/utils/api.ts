const domain = process.env.EXPO_PUBLIC_DOMAIN;
if (!domain && __DEV__) {
  console.error(
    "[API] FATAL: EXPO_PUBLIC_DOMAIN is not set. All API calls will fail. " +
    "Set this environment variable to your Replit dev domain before building."
  );
}
export const API_BASE = domain ? `https://${domain}/api` : "";

export function unwrapApiResponse<T = any>(json: unknown): T {
  if (json != null && typeof json === "object" && (json as any).success === true && "data" in json) {
    return (json as any).data as T;
  }
  return json as T;
}
