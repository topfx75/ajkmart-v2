const rawDomain = process.env.EXPO_PUBLIC_DOMAIN?.trim() ?? "";

function normalizeDomain(value: string): string {
  return value.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

const normalizedDomain = normalizeDomain(rawDomain);
const expoOrigin = rawDomain
  ? rawDomain.startsWith("http://") || rawDomain.startsWith("https://")
    ? rawDomain.replace(/\/+$/, "")
    : normalizedDomain.startsWith("localhost") || normalizedDomain.startsWith("127.")
      ? `http://${normalizedDomain}`
      : `https://${normalizedDomain}`
  : "";

const devFallbackOrigin = __DEV__ ? "http://localhost:3000" : "";
const apiOrigin = expoOrigin || devFallbackOrigin;

if (!apiOrigin && __DEV__) {
  console.error(
    "[API] FATAL: EXPO_PUBLIC_DOMAIN is not set. All API calls will fail. " +
    "In local development, set EXPO_PUBLIC_DOMAIN or start the app with a local API origin."
  );
}

export const EXPO_ORIGIN = apiOrigin;
export const API_ORIGIN = apiOrigin;
export const API_BASE = apiOrigin ? `${apiOrigin}/api` : "";

export function unwrapApiResponse<T = any>(json: unknown): T {
  if (json != null && typeof json === "object" && (json as any).success === true && "data" in json) {
    return (json as any).data as T;
  }
  return json as T;
}
