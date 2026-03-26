import { Router, type IRouter } from "express";
import { getPlatformSettings } from "./admin.js";

const router: IRouter = Router();

const GOOGLE_BASE = "https://maps.googleapis.com/maps/api";

/* ─── Helper: resolve API key + check feature gate ─── */
async function getKey(): Promise<{
  key: string | null;
  enabled: boolean;
  autocomplete: boolean;
  geocoding: boolean;
  distanceMatrix: boolean;
}> {
  const s = await getPlatformSettings();
  const enabled = (s["integration_maps"] ?? "off") === "on";
  const key     = s["maps_api_key"] ?? "";
  return {
    key:            key.trim() || null,
    enabled,
    autocomplete:   (s["maps_places_autocomplete"] ?? "on") === "on",
    geocoding:      (s["maps_geocoding"]           ?? "on") === "on",
    distanceMatrix: (s["maps_distance_matrix"]     ?? "on") === "on",
  };
}

/* ─── AJK Fallback locations (used when Maps key not configured) ─── */
const AJK_FALLBACK = [
  { placeId: "ajk_muzaffarabad",  description: "Muzaffarabad Chowk, Muzaffarabad, AJK",  mainText: "Muzaffarabad Chowk",  lat: 34.3697, lng: 73.4716 },
  { placeId: "ajk_mirpur",        description: "Mirpur City Centre, Mirpur, AJK",         mainText: "Mirpur City Centre",  lat: 33.1413, lng: 73.7508 },
  { placeId: "ajk_rawalakot",     description: "Rawalakot Bazar, Rawalakot, AJK",         mainText: "Rawalakot Bazar",     lat: 33.8572, lng: 73.7613 },
  { placeId: "ajk_bagh",          description: "Bagh City, Bagh, AJK",                    mainText: "Bagh City",           lat: 33.9732, lng: 73.7729 },
  { placeId: "ajk_kotli",         description: "Kotli Main Chowk, Kotli, AJK",            mainText: "Kotli Main Chowk",    lat: 33.5152, lng: 73.9019 },
  { placeId: "ajk_bhimber",       description: "Bhimber, Mirpur, AJK",                    mainText: "Bhimber",             lat: 32.9755, lng: 74.0727 },
  { placeId: "ajk_poonch",        description: "Poonch City, Poonch, AJK",                mainText: "Poonch City",         lat: 33.7700, lng: 74.0954 },
  { placeId: "ajk_neelum",        description: "Neelum Valley, Neelum, AJK",              mainText: "Neelum Valley",       lat: 34.5689, lng: 73.8765 },
  { placeId: "ajk_hattian",       description: "Hattian Bala, Hattian, AJK",              mainText: "Hattian Bala",        lat: 34.0523, lng: 73.8265 },
  { placeId: "ajk_sudhnoti",      description: "Sudhnoti, Sudhnoti, AJK",                 mainText: "Sudhnoti",            lat: 33.7457, lng: 73.6920 },
  { placeId: "ajk_haveli",        description: "Haveli, Haveli, AJK",                     mainText: "Haveli",              lat: 33.6667, lng: 73.9500 },
  { placeId: "ajk_airport",       description: "Airport Rawalakot, Rawalakot, AJK",       mainText: "Airport Rawalakot",   lat: 33.8489, lng: 73.7978 },
  { placeId: "ajk_university",    description: "AJK University, Muzaffarabad, AJK",       mainText: "AJK University",      lat: 34.3601, lng: 73.5088 },
  { placeId: "ajk_cmh",           description: "CMH Muzaffarabad, Muzaffarabad, AJK",     mainText: "CMH Muzaffarabad",    lat: 34.3660, lng: 73.4780 },
  { placeId: "ajk_pallandri",     description: "Pallandri, Sudhnoti, AJK",                mainText: "Pallandri",           lat: 33.7124, lng: 73.9294 },
];

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ══════════════════════════════════════════════════════════
   GET /api/maps/autocomplete?input=TEXT[&lat=LAT&lng=LNG]
   Returns place suggestions for a search query.
   Falls back to AJK city list if Maps not configured.
══════════════════════════════════════════════════════════ */
router.get("/autocomplete", async (req, res) => {
  const input = String(req.query.input ?? "").trim();
  if (!input) { res.json({ predictions: AJK_FALLBACK, source: "fallback" }); return; }

  const { key, enabled, autocomplete } = await getKey();

  if (!enabled || !key || !autocomplete) {
    const filtered = input
      ? AJK_FALLBACK.filter(l => l.description.toLowerCase().includes(input.toLowerCase()))
      : AJK_FALLBACK;
    res.json({ predictions: filtered, source: "fallback" });
    return;
  }

  try {
    const lat = req.query.lat ? `&location=${req.query.lat},${req.query.lng}&radius=50000` : "";
    const url = `${GOOGLE_BASE}/place/autocomplete/json?input=${encodeURIComponent(input)}${lat}&components=country:pk&language=en&key=${key}`;
    const raw = await fetch(url);
    const data = await raw.json() as any;

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      const filtered = AJK_FALLBACK.filter(l => l.description.toLowerCase().includes(input.toLowerCase()));
      res.json({ predictions: filtered, source: "fallback", googleStatus: data.status });
      return;
    }

    const predictions = (data.predictions ?? []).map((p: any) => ({
      placeId:       p.place_id,
      description:   p.description,
      mainText:      p.structured_formatting?.main_text ?? p.description,
      secondaryText: p.structured_formatting?.secondary_text ?? "",
    }));

    res.json({ predictions, source: "google" });
  } catch (err) {
    const filtered = AJK_FALLBACK.filter(l => l.description.toLowerCase().includes(input.toLowerCase()));
    res.json({ predictions: filtered, source: "fallback" });
  }
});

/* ══════════════════════════════════════════════════════════
   GET /api/maps/geocode?place_id=ID  OR  ?address=TEXT
   Resolves a place ID or address to lat/lng.
   Falls back to AJK_FALLBACK lookup by placeId.
══════════════════════════════════════════════════════════ */
router.get("/geocode", async (req, res) => {
  const placeId = String(req.query.place_id ?? "").trim();
  const address = String(req.query.address ?? "").trim();

  /* Resolve from fallback list by placeId */
  if (placeId.startsWith("ajk_")) {
    const loc = AJK_FALLBACK.find(l => l.placeId === placeId);
    if (loc) { res.json({ lat: loc.lat, lng: loc.lng, formattedAddress: loc.description, source: "fallback" }); return; }
  }

  const { key, enabled, geocoding } = await getKey();

  if (!enabled || !key || !geocoding) {
    /* Best-effort text match from fallback */
    const query = (placeId || address).toLowerCase();
    const loc = AJK_FALLBACK.find(l =>
      l.placeId === query || l.description.toLowerCase().includes(query) || l.mainText.toLowerCase().includes(query)
    );
    if (loc) { res.json({ lat: loc.lat, lng: loc.lng, formattedAddress: loc.description, source: "fallback" }); return; }
    res.status(503).json({ error: "Maps not configured. Set maps_api_key in admin Integrations." });
    return;
  }

  try {
    const param = placeId ? `place_id=${encodeURIComponent(placeId)}` : `address=${encodeURIComponent(address)}`;
    const url   = `${GOOGLE_BASE}/geocode/json?${param}&key=${key}`;
    const raw   = await fetch(url);
    const data  = await raw.json() as any;

    if (data.status !== "OK" || !data.results?.length) {
      res.status(404).json({ error: "Location not found", googleStatus: data.status });
      return;
    }

    const result = data.results[0];
    res.json({
      lat:              result.geometry.location.lat,
      lng:              result.geometry.location.lng,
      formattedAddress: result.formatted_address,
      source:           "google",
    });
  } catch (err) {
    res.status(500).json({ error: "Maps geocode request failed" });
  }
});

/* ══════════════════════════════════════════════════════════
   GET /api/maps/directions
     ?origin_lat=&origin_lng=&dest_lat=&dest_lng=
     &mode=driving|bicycling  (default: driving)
   Returns distance, duration and encoded polyline.
   Falls back to Haversine + fixed speed estimate.
══════════════════════════════════════════════════════════ */
router.get("/directions", async (req, res) => {
  const oLat = parseFloat(String(req.query.origin_lat ?? ""));
  const oLng = parseFloat(String(req.query.origin_lng ?? ""));
  const dLat = parseFloat(String(req.query.dest_lat   ?? ""));
  const dLng = parseFloat(String(req.query.dest_lng   ?? ""));
  const mode = String(req.query.mode ?? "driving");

  if ([oLat, oLng, dLat, dLng].some(isNaN)) {
    res.status(400).json({ error: "origin_lat, origin_lng, dest_lat, dest_lng are required" });
    return;
  }

  const { key, enabled, distanceMatrix } = await getKey();

  if (!enabled || !key || !distanceMatrix) {
    const km  = Math.round(haversineKm(oLat, oLng, dLat, dLng) * 10) / 10;
    const avg = mode === "bicycling" ? 25 : 45;
    const min = Math.round((km / avg) * 60);
    res.json({
      distanceKm:      km,
      distanceText:    `${km} km`,
      durationSeconds: min * 60,
      durationText:    `${min} min`,
      polyline:        null,
      source:          "fallback",
    });
    return;
  }

  try {
    const url = `${GOOGLE_BASE}/directions/json?origin=${oLat},${oLng}&destination=${dLat},${dLng}&mode=${mode}&key=${key}`;
    const raw  = await fetch(url);
    const data = await raw.json() as any;

    if (data.status !== "OK" || !data.routes?.length) {
      const km  = Math.round(haversineKm(oLat, oLng, dLat, dLng) * 10) / 10;
      const avg = mode === "bicycling" ? 25 : 45;
      const min = Math.round((km / avg) * 60);
      res.json({
        distanceKm:      km,
        distanceText:    `${km} km`,
        durationSeconds: min * 60,
        durationText:    `${min} min`,
        polyline:        null,
        source:          "fallback",
        googleStatus:    data.status,
      });
      return;
    }

    const leg = data.routes[0].legs[0];
    res.json({
      distanceKm:      Math.round(leg.distance.value / 100) / 10,
      distanceText:    leg.distance.text,
      durationSeconds: leg.duration.value,
      durationText:    leg.duration.text,
      polyline:        data.routes[0].overview_polyline?.points ?? null,
      source:          "google",
    });
  } catch (err) {
    const km  = Math.round(haversineKm(oLat, oLng, dLat, dLng) * 10) / 10;
    const avg = mode === "bicycling" ? 25 : 45;
    const min = Math.round((km / avg) * 60);
    res.json({
      distanceKm: km, distanceText: `${km} km`,
      durationSeconds: min * 60, durationText: `${min} min`,
      polyline: null, source: "fallback",
    });
  }
});

/* ══════════════════════════════════════════════════════════
   GET /api/maps/status
   Returns whether Maps is configured and active.
══════════════════════════════════════════════════════════ */
router.get("/status", async (_req, res) => {
  const { key, enabled } = await getKey();
  res.json({
    mapsEnabled:     enabled,
    keyConfigured:   !!key,
    apisAvailable:   ["autocomplete", "directions", "geocode"],
    fallbackActive:  !enabled || !key,
  });
});

export default router;
