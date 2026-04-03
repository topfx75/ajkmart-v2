import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { popularLocationsTable } from "@workspace/db/schema";
import { eq, asc } from "drizzle-orm";
import { getPlatformSettings } from "./admin.js";
import { sendSuccess, sendError, sendNotFound, sendValidationError } from "../lib/response.js";

const router: IRouter = Router();

const GOOGLE_BASE = "https://maps.googleapis.com/maps/api";

/* ── Reverse-geocode LRU cache: keyed by "lat,lng" rounded to 4 decimal places
   (~11m precision), so minor coordinate drift reuses the cached result.
   Max 200 entries; TTL 10 minutes. ── */
interface RevGeoCache { address: string; ts: number }
const _revGeoCache = new Map<string, RevGeoCache>();
const REV_GEO_TTL_MS = 10 * 60_000;
const REV_GEO_MAX    = 200;

function revGeoCacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function revGeoCacheGet(lat: number, lng: number): string | null {
  const key   = revGeoCacheKey(lat, lng);
  const entry = _revGeoCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > REV_GEO_TTL_MS) { _revGeoCache.delete(key); return null; }
  return entry.address;
}

function revGeoCacheSet(lat: number, lng: number, address: string): void {
  if (_revGeoCache.size >= REV_GEO_MAX) {
    /* Evict the oldest entry */
    const firstKey = _revGeoCache.keys().next().value;
    if (firstKey) _revGeoCache.delete(firstKey);
  }
  _revGeoCache.set(revGeoCacheKey(lat, lng), { address, ts: Date.now() });
}

/**
 * Extract the highest-precision (street-level) address component from a
 * Google Geocoding result.  Priority order:
 *   route (street name) → sublocality_level_1 → locality → formatted_address
 */
function extractStreetAddress(result: any): string {
  const components: Array<{ long_name: string; types: string[] }> =
    result.address_components ?? [];

  const find = (...types: string[]) =>
    components.find((c) => types.some((t) => c.types.includes(t)))?.long_name;

  const streetNumber = find("street_number") ?? "";
  const route        = find("route") ?? "";
  const sublocality  = find("sublocality_level_1", "sublocality") ?? "";
  const locality     = find("locality") ?? "";

  if (route) {
    const parts = [streetNumber, route, sublocality || locality].filter(Boolean);
    return parts.join(", ");
  }
  if (sublocality) return sublocality + (locality ? `, ${locality}` : "");
  if (locality) return locality;
  return result.formatted_address ?? "";
}

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
/* ── Build combined fallback list: hardcoded AJK + admin-managed popular locations ── */
async function getFallbackPredictions(input: string) {
  const query = input.toLowerCase();

  /* Admin-managed popular locations from DB */
  let dbLocs: typeof AJK_FALLBACK = [];
  try {
    const rows = await db.select().from(popularLocationsTable)
      .where(eq(popularLocationsTable.isActive, true))
      .orderBy(asc(popularLocationsTable.sortOrder));
    dbLocs = rows.map(l => ({
      placeId:     `pop_${l.id}`,
      description: l.nameUrdu ? `${l.name} — ${l.nameUrdu}` : l.name,
      mainText:    l.name,
      lat:         parseFloat(String(l.lat)),
      lng:         parseFloat(String(l.lng)),
    }));
  } catch { /* DB unavailable — use hardcoded only */ }

  /* Merge: DB locations first (admin-curated), then hardcoded as backup */
  const dbIds = new Set(dbLocs.map(l => l.description.toLowerCase()));
  const hardcoded = AJK_FALLBACK.filter(l => !dbIds.has(l.description.toLowerCase()));
  const combined = [...dbLocs, ...hardcoded];

  if (!input) return combined;
  return combined.filter(l =>
    l.description.toLowerCase().includes(query) || l.mainText.toLowerCase().includes(query)
  );
}

router.get("/autocomplete", async (req, res) => {
  const input = String(req.query.input ?? "").trim();
  if (!input) {
    const all = await getFallbackPredictions("");
    res.json({ predictions: all, source: "fallback" });
    return;
  }

  const { key, enabled, autocomplete } = await getKey();

  if (!enabled || !key || !autocomplete) {
    const filtered = await getFallbackPredictions(input);
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

    const predictions = (data.predictions ?? []).map((p: Record<string, unknown>) => {
      const sf = p["structured_formatting"] as Record<string, string> | undefined;
      return {
        placeId:       p["place_id"],
        description:   p["description"],
        mainText:      sf?.["main_text"] ?? p["description"],
        secondaryText: sf?.["secondary_text"] ?? "",
      };
    });

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

  /* Resolve from hardcoded fallback list by placeId */
  if (placeId.startsWith("ajk_")) {
    const loc = AJK_FALLBACK.find(l => l.placeId === placeId);
    if (loc) { res.json({ lat: loc.lat, lng: loc.lng, formattedAddress: loc.description, source: "fallback" }); return; }
  }

  /* Resolve admin-managed popular location by placeId (pop_{id}) */
  if (placeId.startsWith("pop_")) {
    const id = placeId.slice(4);
    try {
      const [row] = await db.select().from(popularLocationsTable)
        .where(eq(popularLocationsTable.id, id)).limit(1);
      if (row) {
        res.json({
          lat: parseFloat(String(row.lat)), lng: parseFloat(String(row.lng)),
          formattedAddress: row.name, source: "fallback",
        });
        return;
      }
    } catch { /* fall through */ }
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
   GET /api/maps/reverse-geocode?lat=LAT&lng=LNG
   Converts lat/lng to a street-level address.
   Uses street-level component extraction + in-process cache to avoid
   redundant API calls on minor coordinate drift.
══════════════════════════════════════════════════════════ */
router.get("/reverse-geocode", async (req, res) => {
  const lat = parseFloat(String(req.query.lat ?? ""));
  const lng = parseFloat(String(req.query.lng ?? ""));

  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({ error: "lat and lng are required" }); return;
  }

  /* Cache hit — avoid redundant API call */
  const cached = revGeoCacheGet(lat, lng);
  if (cached) {
    res.json({ address: cached, source: "cache" }); return;
  }

  const { key, enabled, geocoding } = await getKey();

  if (!enabled || !key || !geocoding) {
    /* Closest AJK fallback location */
    let closest = AJK_FALLBACK[0]!;
    let closestDist = Infinity;
    for (const loc of AJK_FALLBACK) {
      const d = haversineKm(lat, lng, loc.lat, loc.lng);
      if (d < closestDist) { closestDist = d; closest = loc; }
    }
    const address = closest.description;
    revGeoCacheSet(lat, lng, address);
    res.json({ address, source: "fallback" }); return;
  }

  try {
    const url  = `${GOOGLE_BASE}/geocode/json?latlng=${lat},${lng}&language=en&key=${key}`;
    const raw  = await fetch(url);
    const data = await raw.json() as any;

    if (data.status !== "OK" || !data.results?.length) {
      res.status(404).json({ error: "Address not found", googleStatus: data.status }); return;
    }

    const address = extractStreetAddress(data.results[0]);
    revGeoCacheSet(lat, lng, address);
    res.json({ address, formattedAddress: data.results[0].formatted_address, source: "google" });
  } catch {
    res.status(500).json({ error: "Reverse geocode request failed" });
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

/* ── GET /api/maps/config — Securely serves map provider config to frontend clients.
   API keys are fetched from platform_settings (DB-managed) and returned at request
   time so they never appear in frontend build artifacts or source code.
   This endpoint is intentionally public (no auth) because map API keys are
   domain-restricted by the provider and must be available on page load.
   Rate limiting is enforced by the global API rate limiter. ── */
router.get("/config", async (_req, res) => {
  const settings = await getPlatformSettings();
  const s = settings as Record<string, string>;

  /* Primary provider: new key map_provider_primary (fallback to legacy map_provider) */
  const mapProvider      = s["map_provider_primary"] ?? s["map_provider"] ?? "osm";  /* osm | mapbox | google */
  /* Secondary provider used as failover when primary tile layer fails */
  const secondaryProvider = s["map_provider_secondary"] ?? "osm";                    /* osm | mapbox | google */

  const mapboxToken      = s["mapbox_api_key"]       ?? "";
  /* New key google_maps_api_key takes priority over legacy maps_api_key */
  const googleKey        = s["google_maps_api_key"]  ?? s["maps_api_key"] ?? "";
  const searchProvider   = s["search_api_provider"]  ?? "google";                    /* google | locationiq */
  const locationIqKey    = s["locationiq_api_key"]   ?? "";
  const routingProvider  = s["routing_api_provider"] ?? "mapbox";                    /* mapbox | google */

  /* Return the appropriate token for the active map provider, never all keys at once */
  const activeToken = mapProvider === "mapbox" ? mapboxToken
                    : mapProvider === "google"  ? googleKey
                    : "";

  /* Secondary token — needed if secondary provider is mapbox or google */
  const secondaryToken = secondaryProvider === "mapbox" ? mapboxToken
                       : secondaryProvider === "google"  ? googleKey
                       : "";

  /* Search token is separate from map visual provider */
  const searchToken = searchProvider === "locationiq" ? locationIqKey
                    : googleKey; /* google search uses same key as google maps */

  res.json({
    provider:          mapProvider,        /* Which tile/SDK to use for the map visual */
    token:             activeToken,        /* API key / access token for the active provider */
    secondaryProvider,                     /* Failover provider if primary tile fails */
    secondaryToken,                        /* API key for the failover provider */
    searchProvider,                        /* Which API to use for address search/autocomplete */
    searchToken,                           /* API key for the search provider */
    routingProvider,                       /* Which API to use for route calculation */
    enabled:           s["integration_maps"] !== "off",
    defaultLat:        parseFloat(s["map_default_lat"] || "33.7294"),
    defaultLng:        parseFloat(s["map_default_lng"] || "73.3872"),
  });
});

export default router;
