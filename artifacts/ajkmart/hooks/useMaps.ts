import { useEffect, useRef, useState } from "react";

const API = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/maps`;

export interface MapPrediction {
  placeId:       string;
  description:   string;
  mainText:      string;
  secondaryText?: string;
  lat?: number;
  lng?: number;
}

export interface DirectionsResult {
  distanceKm:      number;
  distanceText:    string;
  durationSeconds: number;
  durationText:    string;
  polyline:        string | null;
  source:          "google" | "fallback";
}

export interface GeocodeResult {
  lat:              number;
  lng:              number;
  formattedAddress: string;
  source:           "google" | "fallback";
}

/* ─── Live autocomplete hook (debounced) ─── */
export function useMapsAutocomplete(query: string, debounceMs = 300) {
  const [predictions, setPredictions] = useState<MapPrediction[]>([]);
  const [loading,     setLoading]     = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);

    if (!query.trim()) {
      setLoading(false);
      /* Show all AJK fallback locations when empty */
      fetch(`${API}/autocomplete?input=`)
        .then(r => r.json())
        .then(d => setPredictions(d.predictions ?? []))
        .catch(() => setPredictions([]));
      return;
    }

    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`${API}/autocomplete?input=${encodeURIComponent(query)}`);
        const d = await r.json();
        setPredictions(d.predictions ?? []);
      } catch {
        setPredictions([]);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query]);

  return { predictions, loading };
}

/* ─── Resolve a prediction's lat/lng (from inline coords or API geocode) ─── */
export async function resolveLocation(prediction: MapPrediction): Promise<{ lat: number; lng: number; address: string }> {
  if (prediction.lat !== undefined && prediction.lng !== undefined) {
    return { lat: prediction.lat, lng: prediction.lng, address: prediction.description };
  }
  try {
    const r = await fetch(`${API}/geocode?place_id=${encodeURIComponent(prediction.placeId)}`);
    const d: GeocodeResult = await r.json();
    return { lat: d.lat, lng: d.lng, address: d.formattedAddress };
  } catch {
    return { lat: 0, lng: 0, address: prediction.description };
  }
}

/* ─── Get directions between two coordinates ─── */
export async function getDirections(
  oLat: number, oLng: number, dLat: number, dLng: number,
  mode: "driving" | "bicycling" = "driving",
): Promise<DirectionsResult | null> {
  try {
    const url = `${API}/directions?origin_lat=${oLat}&origin_lng=${oLng}&dest_lat=${dLat}&dest_lng=${dLng}&mode=${mode}`;
    const r = await fetch(url);
    return await r.json();
  } catch {
    return null;
  }
}

/* ─── Google Static Map URL (only works when key is configured) ─── */
export function staticMapUrl(
  markers: Array<{ lat: number; lng: number; color?: string }>,
  opts: { width?: number; height?: number; zoom?: number } = {},
): string {
  const { width = 600, height = 280, zoom = 11 } = opts;
  const center = markers[0] ? `${markers[0].lat},${markers[0].lng}` : "34.37,73.47";
  const markerParams = markers.map((m, i) => {
    const color = m.color ?? (i === 0 ? "green" : "red");
    return `markers=color:${color}%7C${m.lat},${m.lng}`;
  }).join("&");
  return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/maps/static?center=${center}&zoom=${zoom}&size=${width}x${height}&${markerParams}`;
}
