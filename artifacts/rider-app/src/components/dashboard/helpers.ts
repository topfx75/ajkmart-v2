export function formatCurrency(n: number, currencySymbol = "Rs."): string {
  if (!Number.isFinite(n)) return `${currencySymbol} 0`;
  const rounded = Math.round(n);
  const prefix = rounded < 0 ? "-" : "";
  return `${prefix}${currencySymbol} ${Math.abs(rounded).toLocaleString()}`;
}

export function timeAgo(d: string | Date): string {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (diff < 0) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function buildMapsDeepLink(
  lat: number | null | undefined,
  lng: number | null | undefined,
  address?: string | null,
): string {
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(ua))
      return `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`;
    if (/Android/i.test(ua)) return `geo:${lat},${lng}?q=${lat},${lng}`;
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  }
  if (address)
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  return "#";
}

export const SVC_NAMES: Record<string, string> = {
  bike: "Bike",
  car: "Car",
  rickshaw: "Rickshaw",
  daba: "Daba / Van",
  school_shift: "School Shift",
};

export const ACCEPT_TIMEOUT_SEC = 90;
