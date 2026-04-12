import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { popularLocationsTable, mapApiUsageLogTable, platformSettingsTable, serviceZonesTable } from "@workspace/db/schema";
import { eq, asc, and, sql, desc } from "drizzle-orm";
import { getPlatformSettings, adminAuth } from "./admin.js";
import { invalidatePlatformSettingsCache } from "./admin-shared.js";
import { sendSuccess, sendError, sendNotFound, sendValidationError } from "../lib/response.js";
import { generateId } from "../lib/id.js";

const router: IRouter = Router();

/** Escape HTML special chars to prevent XSS when injecting user-supplied strings into HTML */
function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * JSON-serialize a value for safe injection inside a <script> block.
 * Replaces "</" with "<\/" to prevent "</script>" from closing the block early.
 */
function safeJson(val: unknown): string {
  return JSON.stringify(val).replace(/<\//g, "<\\/");
}

const GOOGLE_BASE = "https://maps.googleapis.com/maps/api";

/* ── Reverse-geocode LRU cache: keyed by "lat,lng" rounded to 4 decimal places
   (~11m precision), so minor coordinate drift reuses the cached result.
   TTL and max size are read dynamically from platform_settings so the admin can tune
   them live from the Maps Management UI without a server restart. ── */
interface RevGeoCache { address: string; ts: number }
const _revGeoCache = new Map<string, RevGeoCache>();

/* Default limits (used when settings unavailable) */
const REV_GEO_TTL_MS_DEFAULT = 10 * 60_000;
const REV_GEO_MAX_DEFAULT    = 200;

/* Dynamic read from platform_settings (safe bounds: 1–1440 min, 10–5000 entries) */
async function getRevGeoCacheConfig(): Promise<{ ttlMs: number; maxSize: number }> {
  try {
    const s = await getPlatformSettings() as Record<string, string>;
    const ttlMin  = Math.max(1,  Math.min(1440, parseInt(s["geocode_cache_ttl_min"]  ?? "10",  10)));
    const maxSize = Math.max(10, Math.min(5000, parseInt(s["geocode_cache_max_size"] ?? "200", 10)));
    return { ttlMs: ttlMin * 60_000, maxSize };
  } catch {
    return { ttlMs: REV_GEO_TTL_MS_DEFAULT, maxSize: REV_GEO_MAX_DEFAULT };
  }
}

function revGeoCacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

async function revGeoCacheGet(lat: number, lng: number): Promise<string | null> {
  const key   = revGeoCacheKey(lat, lng);
  const entry = _revGeoCache.get(key);
  if (!entry) return null;
  const { ttlMs } = await getRevGeoCacheConfig();
  if (Date.now() - entry.ts > ttlMs) { _revGeoCache.delete(key); return null; }
  return entry.address;
}

async function revGeoCacheSet(lat: number, lng: number, address: string): Promise<void> {
  const { maxSize } = await getRevGeoCacheConfig();
  if (_revGeoCache.size >= maxSize) {
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
function extractStreetAddress(result: { address_components?: Array<{ long_name: string; types: string[] }>; formatted_address?: string }): string {
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


interface LocationIQResult {
  place_id?: string;
  osm_id?: string;
  display_name?: string;
  lat: string;
  lon: string;
  address?: { road?: string; suburb?: string; village?: string; city?: string; town?: string; county?: string; country?: string };
}

interface GooglePlaceAutocompleteResponse {
  status?: string;
  predictions?: Array<{
    place_id?: string;
    description?: string;
    structured_formatting?: { main_text?: string; secondary_text?: string };
  }>;
}

interface GoogleGeocodeResponse {
  status?: string;
  results?: Array<{
    formatted_address?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
    address_components?: Array<{ long_name: string; types: string[] }>;
  }>;
}


interface OSRMRoute {
  distance: number;
  duration: number;
  geometry?: unknown;
}
interface OSRMDirectionsResponse {
  code?: string;
  routes?: OSRMRoute[];
}
interface MapboxRoute {
  distance: number;
  duration: number;
  geometry?: unknown;
}
interface MapboxDirectionsResponse {
  routes?: MapboxRoute[];
}


interface GoogleDirectionsResponse {
  status?: string;
  routes?: Array<{
    legs: Array<{
      distance: { value: number; text: string };
      duration: { value: number; text: string };
    }>;
    overview_polyline?: { points?: string };
  }>;
}

/* ─── Helper: resolve API key + check feature gate ─── */
async function getKey(): Promise<{
  key: string | null;
  enabled: boolean;
  autocomplete: boolean;
  geocoding: boolean;
  distanceMatrix: boolean;
  provider: string;
  locationiqKey: string | null;
}> {
  const s = await getPlatformSettings();
  const enabled = (s["integration_maps"] ?? "off") === "on";
  /* map_search_provider is the Maps Management key for the search/geocoding provider.
   * Fall back to map_provider_primary (tile/render provider) and then to legacy keys. */
  const provider = s["map_search_provider"] ?? s["map_provider_primary"] ?? s["map_provider"] ?? "osm";
  /* Read new multi-provider key first, fall back to legacy key for backward compatibility */
  const key = s["google_maps_api_key"] ?? s["maps_api_key"] ?? "";
  const liqKey = s["locationiq_api_key"] ?? "";
  return {
    key:            key.trim() || null,
    enabled,
    autocomplete:   (s["maps_places_autocomplete"] ?? "on") === "on",
    geocoding:      (s["maps_geocoding"]           ?? "on") === "on",
    provider,
    locationiqKey:  liqKey.trim() || null,
    distanceMatrix: (s["maps_distance_matrix"]     ?? "on") === "on",
  };
}

/* ─── Minimal hardcoded bootstrap fallback (only used when DB unavailable) ─── */
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

/* ─── Load service_zones from DB as map-search locations ───────────────────
   Returns zone records shaped like AJK_FALLBACK entries.
   Falls back to empty array if DB is unavailable.                          ── */
async function getServiceZoneFallbacks(): Promise<typeof AJK_FALLBACK> {
  try {
    const rows = await db
      .select({ id: serviceZonesTable.id, name: serviceZonesTable.name, city: serviceZonesTable.city, lat: serviceZonesTable.lat, lng: serviceZonesTable.lng })
      .from(serviceZonesTable)
      .where(eq(serviceZonesTable.isActive, true))
      .orderBy(asc(serviceZonesTable.city), asc(serviceZonesTable.name));
    return rows.map(r => ({
      placeId:     `zone_${r.id}`,
      description: `${r.name}, ${r.city}`,
      mainText:    r.name,
      lat:         parseFloat(String(r.lat)),
      lng:         parseFloat(String(r.lng)),
    }));
  } catch {
    return [];
  }
}

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
/* ── Build combined fallback list:
     Priority: popular_locations (admin-curated) → service_zones (DB) → hardcoded AJK_FALLBACK
   This ensures the list is driven by the DB — admin edits take effect without code changes. ── */
async function getFallbackPredictions(input: string) {
  const query = input.toLowerCase();

  /* 1. Admin-managed popular locations from DB */
  let popLocs: typeof AJK_FALLBACK = [];
  try {
    const rows = await db.select().from(popularLocationsTable)
      .where(eq(popularLocationsTable.isActive, true))
      .orderBy(asc(popularLocationsTable.sortOrder));
    popLocs = rows.map(l => ({
      placeId:     `pop_${l.id}`,
      description: l.nameUrdu ? `${l.name} — ${l.nameUrdu}` : l.name,
      mainText:    l.name,
      lat:         parseFloat(String(l.lat)),
      lng:         parseFloat(String(l.lng)),
    }));
  } catch { /* DB unavailable */ }

  /* 2. Service zones from DB (city-level) */
  const zoneLocs = await getServiceZoneFallbacks();

  /* 3. Merge: popular_locations first, then zone fallbacks, then hardcoded as last resort */
  const popIds  = new Set(popLocs.map(l => l.description.toLowerCase()));
  const zoneIds = new Set(zoneLocs.map(l => l.description.toLowerCase()));

  const filteredZones    = zoneLocs.filter(l => !popIds.has(l.description.toLowerCase()));
  const filteredHardcode = AJK_FALLBACK.filter(l => !popIds.has(l.description.toLowerCase()) && !zoneIds.has(l.description.toLowerCase()));
  const combined = [...popLocs, ...filteredZones, ...filteredHardcode];

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

  const { key, enabled, autocomplete, provider: configuredProvider, locationiqKey } = await getKey();

  const useLocationIQ = enabled && configuredProvider === "locationiq" && locationiqKey && autocomplete;
  const useGoogle     = enabled && configuredProvider !== "locationiq" && key && autocomplete;

  if (!useLocationIQ && !useGoogle) {
    const filtered = await getFallbackPredictions(input);
    res.json({ predictions: filtered, source: "fallback" });
    return;
  }

  if (useLocationIQ) {
    try {
      const parsedLat = parseFloat(String(req.query.lat ?? ""));
      const parsedLng = parseFloat(String(req.query.lng ?? ""));
      const latParam = !isNaN(parsedLat) && !isNaN(parsedLng) ? `&viewbox=${parsedLng - 0.5},${parsedLat - 0.5},${parsedLng + 0.5},${parsedLat + 0.5}&bounded=1` : "";
      const liqUrl = `https://us1.locationiq.com/v1/autocomplete?key=${locationiqKey}&q=${encodeURIComponent(input)}&countrycodes=pk&limit=5${latParam}`;
      const liqRaw = await fetch(liqUrl, { signal: AbortSignal.timeout(8000) });
      if (!liqRaw.ok) {
        const filtered = await getFallbackPredictions(input);
        res.json({ predictions: filtered, source: "fallback" });
        return;
      }
      const results = await liqRaw.json() as LocationIQResult[];
      const predictions = (Array.isArray(results) ? results : []).map((r) => ({
        placeId:       r.place_id ?? r.osm_id ?? "",
        description:   r.display_name ?? "",
        mainText:      (r.display_name ?? "").split(",")[0] ?? "",
        secondaryText: (r.display_name ?? "").split(",").slice(1).join(",").trim() ?? "",
      }));
      void trackMapUsage("locationiq", "autocomplete");
      res.json({ predictions, source: "locationiq" });
    } catch {
      const filtered = await getFallbackPredictions(input);
      res.json({ predictions: filtered, source: "fallback" });
    }
    return;
  }

  try {
    const lat = req.query.lat ? `&location=${req.query.lat},${req.query.lng}&radius=50000` : "";
    const url = `${GOOGLE_BASE}/place/autocomplete/json?input=${encodeURIComponent(input)}${lat}&components=country:pk&language=en&key=${key}`;
    const raw = await fetch(url);
    const data = await raw.json() as GooglePlaceAutocompleteResponse;

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      const filtered = AJK_FALLBACK.filter(l => l.description.toLowerCase().includes(input.toLowerCase()));
      res.json({ predictions: filtered, source: "fallback", googleStatus: data.status });
      return;
    }

    const predictions = (data.predictions ?? []).map((p) => ({
      placeId:       p.place_id,
      description:   p.description,
      mainText:      p.structured_formatting?.main_text ?? p.description,
      secondaryText: p.structured_formatting?.secondary_text ?? "",
    }));

    void trackMapUsage("google", "autocomplete");
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

  /* Resolve service zone by placeId (zone_{id}) — returned by autocomplete fallback */
  if (placeId.startsWith("zone_")) {
    const id = placeId.slice(5);
    try {
      const [row] = await db
        .select({ name: serviceZonesTable.name, city: serviceZonesTable.city, lat: serviceZonesTable.lat, lng: serviceZonesTable.lng })
        .from(serviceZonesTable)
        .where(and(eq(serviceZonesTable.id, id), eq(serviceZonesTable.isActive, true)))
        .limit(1);
      if (row) {
        res.json({
          lat:              parseFloat(String(row.lat)),
          lng:              parseFloat(String(row.lng)),
          formattedAddress: `${row.name}, ${row.city}`,
          source:           "fallback",
        });
        return;
      }
    } catch { /* fall through */ }
  }

  const { key, enabled, geocoding, provider: configuredProvider, locationiqKey } = await getKey();

  /* Helper: try Nominatim forward geocode for a text address query */
  async function nominatimForwardGeocode(query: string) {
    const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=1`;
    const nomRaw = await fetch(nomUrl, { headers: { "User-Agent": "AJKMart-Server/1.0" } });
    if (!nomRaw.ok) return null;
    const results = await nomRaw.json() as LocationIQResult[];
    if (!Array.isArray(results) || !results.length) return null;
    const r = results[0];
    return { lat: parseFloat(r.lat), lng: parseFloat(r.lon), formattedAddress: r.display_name as string };
  }

  /* Helper: try LocationIQ forward geocode */
  async function locationiqForwardGeocode(query: string, liqKey: string) {
    const liqUrl = `https://us1.locationiq.com/v1/search?key=${liqKey}&q=${encodeURIComponent(query)}&format=json&limit=1`;
    const liqRaw = await fetch(liqUrl, { signal: AbortSignal.timeout(8000) });
    if (!liqRaw.ok) return null;
    const results = await liqRaw.json() as LocationIQResult[];
    if (!Array.isArray(results) || !results.length) return null;
    const r = results[0];
    return { lat: parseFloat(r.lat), lng: parseFloat(r.lon), formattedAddress: r.display_name as string };
  }

  const useLocationIQ = enabled && configuredProvider === "locationiq" && locationiqKey && geocoding;
  const useGoogle     = enabled && configuredProvider !== "locationiq" && key && geocoding;

  if (!useLocationIQ && !useGoogle) {
    const query = (placeId || address).toLowerCase();
    const loc = AJK_FALLBACK.find(l =>
      l.placeId === query || l.description.toLowerCase().includes(query) || l.mainText.toLowerCase().includes(query)
    );
    if (loc) { res.json({ lat: loc.lat, lng: loc.lng, formattedAddress: loc.description, source: "fallback" }); return; }

    if (address) {
      try {
        const nom = await nominatimForwardGeocode(address);
        if (nom) { res.json({ ...nom, source: "nominatim" }); return; }
      } catch { /* Nominatim unavailable */ }
    }

    res.status(503).json({ error: "Maps not configured and location not found in local list." });
    return;
  }

  if (useLocationIQ) {
    try {
      const query = address || placeId;
      const result = await locationiqForwardGeocode(query, locationiqKey!);
      if (result) {
        void trackMapUsage("locationiq", "geocode");
        res.json({ ...result, source: "locationiq" });
        return;
      }
      if (address) {
        try {
          const nom = await nominatimForwardGeocode(address);
          if (nom) { void trackMapUsage("osm", "geocode"); res.json({ ...nom, source: "nominatim" }); return; }
        } catch { /* Nominatim unavailable */ }
      }
      res.status(404).json({ error: "Location not found" });
    } catch {
      if (address) {
        try {
          const nom = await nominatimForwardGeocode(address);
          if (nom) { void trackMapUsage("osm", "geocode"); res.json({ ...nom, source: "nominatim" }); return; }
        } catch { /* Nominatim unavailable */ }
      }
      res.status(500).json({ error: "Maps geocode request failed" });
    }
    return;
  }

  try {
    const param = placeId ? `place_id=${encodeURIComponent(placeId)}` : `address=${encodeURIComponent(address)}`;
    const url   = `${GOOGLE_BASE}/geocode/json?${param}&key=${key}`;
    const raw   = await fetch(url);
    const data  = await raw.json() as GoogleGeocodeResponse;

    if (data.status !== "OK" || !data.results?.length) {
      if (address) {
        try {
          const nom = await nominatimForwardGeocode(address);
          if (nom) { res.json({ ...nom, source: "nominatim" }); return; }
        } catch { /* Nominatim unavailable */ }
      }
      res.status(404).json({ error: "Location not found", googleStatus: data.status });
      return;
    }

    const result = data.results[0];
    void trackMapUsage("google", "geocode");
    res.json({
      lat:              result?.geometry?.location?.lat,
      lng:              result?.geometry?.location?.lng,
      formattedAddress: result?.formatted_address,
      source:           "google",
    });
  } catch (err) {
    if (address) {
      try {
        const nom = await nominatimForwardGeocode(address);
        if (nom) { void trackMapUsage("osm", "geocode"); res.json({ ...nom, source: "nominatim" }); return; }
      } catch { /* Nominatim unavailable */ }
    }
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
  const cached = await revGeoCacheGet(lat, lng);
  if (cached) {
    res.json({ address: cached, source: "cache" }); return;
  }

  const { key, enabled, geocoding, provider: configuredProvider, locationiqKey } = await getKey();

  /* Helper: Nominatim reverse geocode for lat/lng */
  async function nominatimReverseGeocode(rlat: number, rlng: number): Promise<string | null> {
    const nomUrl = `https://nominatim.openstreetmap.org/reverse?lat=${rlat}&lon=${rlng}&format=json&addressdetails=1`;
    const nomRaw = await fetch(nomUrl, { headers: { "User-Agent": "AJKMart-Server/1.0" } });
    if (!nomRaw.ok) return null;
    const nomData = await nomRaw.json() as Record<string, unknown>;
    if (!nomData?.display_name) return null;
    const addr = nomData.address as LocationIQResult["address"];
    const parts: string[] = [];
    if (addr?.road) parts.push(addr.road);
    else if (addr?.suburb) parts.push(addr.suburb);
    else if (addr?.village) parts.push(addr.village);
    if (addr?.city || addr?.town || addr?.county) parts.push(addr.city ?? addr.town ?? addr.county ?? "");
    return parts.length ? parts.join(", ") : String(nomData.display_name);
  }

  /* Helper: LocationIQ reverse geocode */
  async function locationiqReverseGeocode(rlat: number, rlng: number, liqKey: string): Promise<{ address: string; formattedAddress: string } | null> {
    const liqUrl = `https://us1.locationiq.com/v1/reverse?key=${liqKey}&lat=${rlat}&lon=${rlng}&format=json&addressdetails=1`;
    const liqRaw = await fetch(liqUrl, { signal: AbortSignal.timeout(8000) });
    if (!liqRaw.ok) return null;
    const liqData = await liqRaw.json() as LocationIQResult;
    if (!liqData?.display_name) return null;
    const addr = liqData.address;
    const parts: string[] = [];
    if (addr?.road) parts.push(addr.road);
    else if (addr?.suburb) parts.push(addr.suburb);
    else if (addr?.village) parts.push(addr.village);
    if (addr?.city || addr?.town || addr?.county) parts.push(addr.city ?? addr.town ?? addr.county ?? "");
    const address = parts.length ? parts.join(", ") : (liqData.display_name ?? "");
    return { address, formattedAddress: liqData.display_name ?? "" };
  }

  /* Helper: fallback to nearest AJK location */
  function ajkFallback(): string {
    let closest = AJK_FALLBACK[0]!;
    let closestDist = Infinity;
    for (const loc of AJK_FALLBACK) {
      const d = haversineKm(lat, lng, loc.lat, loc.lng);
      if (d < closestDist) { closestDist = d; closest = loc; }
    }
    return closest.description;
  }

  const useLocationIQ = enabled && configuredProvider === "locationiq" && locationiqKey && geocoding;
  const useGoogle     = enabled && configuredProvider !== "locationiq" && key && geocoding;

  if (!useLocationIQ && !useGoogle) {
    try {
      const nomUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
      const nomRaw = await fetch(nomUrl, { headers: { "User-Agent": "AJKMart-Server/1.0" } });
      if (nomRaw.ok) {
        const nomData = await nomRaw.json() as Record<string, unknown>;
        if (nomData?.display_name) {
          const addr = nomData.address as LocationIQResult["address"];
          const parts: string[] = [];
          if (addr?.road) parts.push(addr.road);
          else if (addr?.suburb) parts.push(addr.suburb);
          else if (addr?.village) parts.push(addr.village);
          if (addr?.city || addr?.town || addr?.county) parts.push(addr.city ?? addr.town ?? addr.county ?? "");
          const address = parts.length ? parts.join(", ") : String(nomData.display_name);
          await revGeoCacheSet(lat, lng, address);
          void trackMapUsage("osm", "reverse-geocode");
          res.json({ address, formattedAddress: nomData.display_name, source: "nominatim" }); return;
        }
      }
    } catch { /* Nominatim unavailable */ }

    const address = ajkFallback();
    await revGeoCacheSet(lat, lng, address);
    res.json({ address, source: "fallback" }); return;
  }

  if (useLocationIQ) {
    try {
      const result = await locationiqReverseGeocode(lat, lng, locationiqKey!);
      if (result) {
        await revGeoCacheSet(lat, lng, result.address);
        void trackMapUsage("locationiq", "reverse-geocode");
        res.json({ address: result.address, formattedAddress: result.formattedAddress, source: "locationiq" });
        return;
      }
      try {
        const nomAddr = await nominatimReverseGeocode(lat, lng);
        if (nomAddr) {
          await revGeoCacheSet(lat, lng, nomAddr);
          void trackMapUsage("osm", "reverse-geocode");
          res.json({ address: nomAddr, source: "nominatim" }); return;
        }
      } catch { /* Nominatim unavailable */ }
      const address = ajkFallback();
      await revGeoCacheSet(lat, lng, address);
      res.json({ address, source: "fallback" });
    } catch {
      try {
        const nomAddr = await nominatimReverseGeocode(lat, lng);
        if (nomAddr) {
          await revGeoCacheSet(lat, lng, nomAddr);
          void trackMapUsage("osm", "reverse-geocode");
          res.json({ address: nomAddr, source: "nominatim" }); return;
        }
      } catch { /* Nominatim also unavailable */ }
      const address = ajkFallback();
      await revGeoCacheSet(lat, lng, address);
      res.json({ address, source: "fallback" });
    }
    return;
  }

  try {
    const url  = `${GOOGLE_BASE}/geocode/json?latlng=${lat},${lng}&language=en&key=${key}`;
    const raw  = await fetch(url);
    const data = await raw.json() as GoogleGeocodeResponse;

    if (data.status !== "OK" || !data.results?.length) {
      try {
        const nomAddr = await nominatimReverseGeocode(lat, lng);
        if (nomAddr) {
          await revGeoCacheSet(lat, lng, nomAddr);
          void trackMapUsage("osm", "reverse-geocode");
          res.json({ address: nomAddr, source: "nominatim" }); return;
        }
      } catch { /* Nominatim unavailable */ }
      res.status(404).json({ error: "Address not found", googleStatus: data.status }); return;
    }

    const result = data.results![0];
    const address = extractStreetAddress(result);
    await revGeoCacheSet(lat, lng, address);
    void trackMapUsage("google", "reverse-geocode");
    res.json({ address, formattedAddress: result?.formatted_address, source: "google" });
  } catch {
    try {
      const nomAddr = await nominatimReverseGeocode(lat, lng);
      if (nomAddr) {
        await revGeoCacheSet(lat, lng, nomAddr);
        void trackMapUsage("osm", "reverse-geocode");
        res.json({ address: nomAddr, source: "nominatim" }); return;
      }
    } catch { /* Nominatim also unavailable */ }
    res.status(500).json({ error: "Reverse geocode request failed" });
  }
});

/* ══════════════════════════════════════════════════════════
   GET /api/maps/directions
     ?origin_lat=&origin_lng=&dest_lat=&dest_lng=
     &mode=driving|bicycling  (default: driving)
   Returns distance, duration and encoded polyline.
   Honors the admin-configured routing_engine setting:
     • osrm    — Open Source Routing Machine (free, no key required)
     • google  — Google Directions API (requires maps_api_key)
     • mapbox  — Mapbox Directions API (requires mapbox_api_key)
   Falls back to Haversine + speed estimate when no engine is available.
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

  /* Read routing engine from platform settings */
  const settings = await getPlatformSettings() as Record<string, string>;
  const routingEngine = settings["routing_engine"] ?? settings["routing_api_provider"] ?? "osrm";

  /* Haversine fallback payload helper */
  function haversineFallback(source: string) {
    const km  = Math.round(haversineKm(oLat, oLng, dLat, dLng) * 10) / 10;
    const avg = mode === "bicycling" ? 25 : 45;
    const min = Math.round((km / avg) * 60);
    return { distanceKm: km, distanceText: `${km} km`, durationSeconds: min * 60, durationText: `${min} min`, polyline: null, source };
  }

  /* ── OSRM (Open Source Routing Machine) — free, no key required ── */
  if (routingEngine === "osrm") {
    try {
      const osrmMode = mode === "bicycling" ? "cycling" : "driving";
      const url = `https://router.project-osrm.org/route/v1/${osrmMode}/${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=geojson`;
      const raw  = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const data = await raw.json() as OSRMDirectionsResponse;
      if (data?.code !== "Ok" || !data?.routes?.length) {
        res.json(haversineFallback("fallback")); return;
      }
      const route  = data.routes![0];
      const distKm = Math.round(route.distance / 100) / 10;
      const minEst = Math.round(route.duration / 60);
      void trackMapUsage("osm", "directions");
      res.json({
        distanceKm:      distKm,
        distanceText:    `${distKm} km`,
        durationSeconds: Math.round(route.duration),
        durationText:    `${minEst} min`,
        polyline:        null,
        geojson:         route.geometry ?? null,
        source:          "osrm",
      });
    } catch {
      res.json(haversineFallback("fallback"));
    }
    return;
  }

  /* ── Mapbox Directions API ── */
  if (routingEngine === "mapbox") {
    const mapboxToken = settings["mapbox_api_key"] ?? "";
    if (!mapboxToken) { res.json(haversineFallback("fallback")); return; }
    try {
      const mbMode = mode === "bicycling" ? "cycling" : "driving";
      const url = `https://api.mapbox.com/directions/v5/mapbox/${mbMode}/${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=geojson&access_token=${mapboxToken}`;
      const raw  = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const data = await raw.json() as MapboxDirectionsResponse;
      if (!data?.routes?.length) { res.json(haversineFallback("fallback")); return; }
      const route  = data.routes![0];
      const distKm = Math.round(route.distance / 100) / 10;
      const minEst = Math.round(route.duration / 60);
      void trackMapUsage("mapbox", "directions");
      res.json({
        distanceKm:      distKm,
        distanceText:    `${distKm} km`,
        durationSeconds: Math.round(route.duration),
        durationText:    `${minEst} min`,
        polyline:        null,
        geojson:         route.geometry ?? null,
        source:          "mapbox",
      });
    } catch {
      res.json(haversineFallback("fallback"));
    }
    return;
  }

  /* ── Google Directions API (default for routing_engine=google or legacy path) ── */
  const { key, enabled, distanceMatrix } = await getKey();

  if (!enabled || !key || !distanceMatrix) {
    res.json(haversineFallback("fallback")); return;
  }

  try {
    const url = `${GOOGLE_BASE}/directions/json?origin=${oLat},${oLng}&destination=${dLat},${dLng}&mode=${mode}&key=${key}`;
    const raw  = await fetch(url);
    const data = await raw.json() as GoogleDirectionsResponse;

    if (data.status !== "OK" || !data.routes?.length) {
      res.json({ ...haversineFallback("fallback"), googleStatus: data.status }); return;
    }

    const leg = data.routes![0].legs[0];
    void trackMapUsage("google", "directions");
    res.json({
      distanceKm:      Math.round(leg.distance.value / 100) / 10,
      distanceText:    leg.distance.text,
      durationSeconds: leg.duration.value,
      durationText:    leg.duration.text,
      polyline:        data.routes![0].overview_polyline?.points ?? null,
      source:          "google",
    });
  } catch {
    res.json(haversineFallback("fallback"));
  }
});

/* ══════════════════════════════════════════════════════════
   GET /api/maps/status
   Returns whether Maps is configured and active.
══════════════════════════════════════════════════════════ */
router.get("/status", async (_req, res) => {
  const { key, enabled, provider, locationiqKey } = await getKey();
  const providerKeyConfigured = provider === "locationiq" ? !!locationiqKey : !!key;
  res.json({
    mapsEnabled:     enabled,
    keyConfigured:   providerKeyConfigured,
    apisAvailable:   ["autocomplete", "directions", "geocode"],
    fallbackActive:  !enabled || !providerKeyConfigured,
  });
});

/* ── GET /api/maps/config — Securely serves map provider config to frontend clients.
   API keys are fetched from platform_settings (DB-managed) and returned at request
   time so they never appear in frontend build artifacts or source code.
   This endpoint is intentionally public (no auth) because map API keys are
   domain-restricted by the provider and must be available on page load.
   Rate limiting is enforced by the global API rate limiter.

   Optional query param ?app=customer|rider|vendor|admin scopes the returned
   token to only the effective provider for that app (reduces over-exposure).
   When ?app is absent the token for the global primary provider is returned.
── */
router.get("/config", async (req, res) => {
  const settings = await getPlatformSettings();
  const s = settings as Record<string, string>;

  /* Primary provider: new multi-provider schema (fallback to legacy map_provider) */
  const mapProvider       = s["map_provider_primary"] ?? s["map_provider"] ?? "osm";
  const secondaryProvider = s["map_provider_secondary"] ?? "osm";
  const failoverEnabled   = (s["map_failover_enabled"] ?? "on") === "on";

  const mapboxToken  = s["mapbox_api_key"]      ?? "";
  const googleKey    = s["google_maps_api_key"] ?? s["maps_api_key"] ?? "";
  const searchProvider   = s["map_search_provider"] ?? s["search_api_provider"] ?? "locationiq";
  const locationIqKey    = s["locationiq_api_key"]  ?? "";
  const routingEngine    = s["routing_engine"] ?? s["routing_api_provider"] ?? "osrm";

  /* Helper: resolve token for a given provider — only returned for that provider */
  const tokenFor = (prov: string) => prov === "mapbox" ? mapboxToken : prov === "google" ? googleKey : prov === "locationiq" ? locationIqKey : "";

  /* Per-app provider overrides */
  const appOverrideKeys: Record<string, string> = {
    customer: s["map_app_override_customer"] ?? "primary",
    rider:    s["map_app_override_rider"]    ?? "primary",
    vendor:   s["map_app_override_vendor"]   ?? "primary",
    admin:    s["map_app_override_admin"]    ?? "primary",
  };

  /* Resolve actual provider for a given override value */
  const resolveAppProvider = (override: string): string => {
    if (override === "primary")   return mapProvider;
    if (override === "secondary") return secondaryProvider;
    if (["osm", "mapbox", "google", "locationiq"].includes(override)) return override;
    return mapProvider;
  };

  /* If ?app is specified, only return the token for that app's effective provider.
     This prevents unnecessarily exposing all provider keys to every client. */
  const reqApp = String(req.query.app ?? "").toLowerCase();
  const validApps = ["customer", "rider", "vendor", "admin"];
  const scopedApp = validApps.includes(reqApp) ? reqApp : null;

  const primaryToken   = tokenFor(mapProvider);

  /* searchToken: only the token for the configured search provider */
  const searchToken = searchProvider === "locationiq" ? locationIqKey : (searchProvider === "google" ? googleKey : "");

  /* Geocode cache config */
  const rawTtl  = parseInt(s["geocode_cache_ttl_min"]  ?? "10",  10);
  const rawSize = parseInt(s["geocode_cache_max_size"] ?? "200", 10);
  const geocodeCacheTtlMin  = Number.isFinite(rawTtl)  ? Math.max(1, Math.min(1440, rawTtl))  : 10;
  const geocodeCacheMaxSize = Number.isFinite(rawSize) ? Math.max(10, Math.min(5000, rawSize)) : 200;

  /* Build per-app overrides — token only included for the scoped app or all if no scope */
  const buildAppOverrides = () => {
    const result: Record<string, { provider: string; token: string; override: string }> = {};
    for (const app of validApps) {
      const override = appOverrideKeys[app];
      const provider = resolveAppProvider(override);
      /* Return token only for the scoped app, or for all if no scope (admin-panel use) */
      const token = (scopedApp === null || scopedApp === app) ? tokenFor(provider) : "";
      result[app] = { provider, token, override };
    }
    return result;
  };

  res.json({
    /* Canonical schema keys (required contract) */
    primary:          mapProvider,
    primaryToken,
    secondary:        secondaryProvider,
    /* secondaryToken is returned because DynamicTileLayer needs it for client-side failover.
       Both primary and secondary keys are domain-restricted by the provider. */
    secondaryToken:   tokenFor(secondaryProvider),
    failoverEnabled,

    /* Backward-compatible aliases for existing consumers */
    provider:          mapProvider,
    token:             primaryToken,
    secondaryProvider,

    /* Per-app overrides — tokens scoped to requesting app when ?app= is provided */
    appOverrides:      buildAppOverrides(),

    /* Routing */
    routingEngine,
    routingProvider:   routingEngine,   /* backward-compat alias */

    /* Search/autocomplete */
    searchProvider,
    searchToken,

    /* Per-provider health/status — no tokens in this block */
    providers: {
      osm:        { enabled: (s["osm_enabled"]          ?? "on")  === "on", role: s["map_provider_role_osm"]        ?? "primary",  lastTested: s["map_last_tested_osm"]        ?? null, testStatus: s["map_test_status_osm"]        ?? "unknown" },
      mapbox:     { enabled: (s["mapbox_enabled"]        ?? "off") === "on", role: s["map_provider_role_mapbox"]     ?? "disabled", lastTested: s["map_last_tested_mapbox"]     ?? null, testStatus: s["map_test_status_mapbox"]     ?? "unknown" },
      google:     { enabled: (s["google_maps_enabled"]   ?? "off") === "on", role: s["map_provider_role_google"]     ?? "disabled", lastTested: s["map_last_tested_google"]     ?? null, testStatus: s["map_test_status_google"]     ?? "unknown" },
      locationiq: { enabled: (s["locationiq_enabled"]    ?? "off") === "on", role: s["map_provider_role_locationiq"] ?? "disabled", lastTested: s["map_last_tested_locationiq"] ?? null, testStatus: s["map_test_status_locationiq"] ?? "unknown" },
    },

    /* General */
    enabled:           s["integration_maps"] !== "off",
    defaultLat:        parseFloat(s["map_default_lat"] || "33.7294"),
    defaultLng:        parseFloat(s["map_default_lng"] || "73.3872"),

    /* Geocoding cache (admin-tunable live via platform_settings) */
    geocodeCacheTtlMin,
    geocodeCacheMaxSize,
    geocodeCacheCurrentSize: _revGeoCache.size,
  });
});

/* ══════════════════════════════════════════════════════════
   GET /api/maps/picker
   Serves a full-screen interactive Leaflet map for pin-drop
   location selection. Used by the customer app via iframe.
   Query params:
     lat   - initial latitude  (default: 33.73)
     lng   - initial longitude (default: 73.39)
     zoom  - initial zoom      (default: 13)
     label - label shown in toolbar (e.g. "Pickup" / "Drop-off")
     lang  - "en" | "ur"
══════════════════════════════════════════════════════════ */
router.get("/picker", (req, res) => {
  const lat   = parseFloat(String(req.query.lat  ?? "33.7294"));
  const lng   = parseFloat(String(req.query.lng  ?? "73.3872"));
  const zoom  = parseInt(String(req.query.zoom   ?? "15"), 10);
  const label = String(req.query.label ?? "Location");
  const lang  = String(req.query.lang  ?? "en");

  const isUrdu = lang === "ur";
  const labelEsc = escHtml(label);
  const t = {
    title:       isUrdu ? `${labelEsc} چنیں` : `Select ${labelEsc}`,
    searchPH:    isUrdu ? "جگہ تلاش کریں..." : "Search location...",
    centerHint:  isUrdu ? "مرکز پر مقام منتخب ہوگا" : "Move map to position the pin",
    myLocation:  isUrdu ? "میری جگہ" : "My Location",
    confirm:     isUrdu ? "مقام تصدیق کریں ✓" : "Confirm Location ✓",
    loading:     isUrdu ? "مقام لوڈ ہو رہا ہے..." : "Fetching address...",
    gpsError:    isUrdu ? "GPS دستیاب نہیں" : "GPS unavailable",
    accuracy:    isUrdu ? "درستگی" : "Accuracy",
  };

  const html = `<!DOCTYPE html>
<html lang="${isUrdu ? "ur" : "en"}" dir="${isUrdu ? "rtl" : "ltr"}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
  <title>${t.title}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{height:100%;overflow:hidden}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f0f2f5;display:flex;flex-direction:column;height:100dvh}
    /* ── Toolbar ── */
    #toolbar{background:#fff;padding:10px 12px 8px;z-index:1001;box-shadow:0 2px 10px rgba(0,0,0,.1);flex-shrink:0}
    #titlebar{display:flex;align-items:center;gap:8px;margin-bottom:8px}
    #pin-icon{font-size:18px}
    #titlebar h2{font-size:15px;font-weight:700;color:#111827;flex:1;letter-spacing:-.2px}
    /* ── Search ── */
    #search-wrap{position:relative}
    #search-inner{display:flex;align-items:center;background:#f3f4f6;border-radius:10px;padding:0 10px;gap:6px;border:1.5px solid transparent;transition:border-color .2s,background .2s}
    #search-inner:focus-within{background:#fff;border-color:#3b82f6}
    #search-icon{font-size:14px;color:#6b7280;flex-shrink:0}
    #search{flex:1;border:none;background:none;padding:9px 0;font-size:14px;outline:none;color:#111827}
    #search::placeholder{color:#9ca3af}
    #search-clear{background:none;border:none;cursor:pointer;color:#9ca3af;font-size:15px;padding:2px;display:none;flex-shrink:0}
    #search-clear:hover{color:#374151}
    #suggestions{background:#fff;border:1px solid #e5e7eb;border-radius:12px;max-height:180px;overflow-y:auto;position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:2000;display:none;box-shadow:0 8px 24px rgba(0,0,0,.12)}
    .sug-item{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;cursor:pointer;transition:background .15s;border-bottom:1px solid #f3f4f6}
    .sug-item:last-child{border-bottom:none}
    .sug-item:hover,.sug-item:active{background:#eff6ff}
    .sug-dot{width:6px;height:6px;border-radius:50%;background:#3b82f6;margin-top:5px;flex-shrink:0}
    .sug-texts{flex:1;min-width:0}
    .sug-main{font-size:13px;font-weight:600;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sug-sub{font-size:11px;color:#6b7280;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    /* ── Map wrapper: relative so crosshair is positioned correctly ── */
    #map-wrap{flex:1;position:relative;overflow:hidden}
    #map{width:100%;height:100%}
    /* ── Centre crosshair ── */
    #crosshair{position:absolute;left:50%;top:50%;transform:translate(-50%,-100%);z-index:500;pointer-events:none;transition:transform .15s ease}
    #crosshair.dragging{transform:translate(-50%,-108%) scale(1.12)}
    #crosshair svg{filter:drop-shadow(0 3px 6px rgba(0,0,0,.35))}
    /* ── Bottom bar ── */
    #bottom{background:#fff;padding:10px 12px;z-index:1001;box-shadow:0 -2px 10px rgba(0,0,0,.08);flex-shrink:0}
    #addr-row{display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;min-height:36px}
    #addr-icon{font-size:16px;margin-top:1px;flex-shrink:0}
    #addr-texts{flex:1;min-width:0}
    #addr-main{font-size:13px;font-weight:600;color:#111827;line-height:1.3;word-break:break-word}
    #addr-sub{font-size:11px;color:#6b7280;margin-top:2px}
    #addr-accuracy{font-size:11px;color:#059669;margin-top:2px;display:none}
    #btn-row{display:flex;gap:8px;padding-bottom:env(safe-area-inset-bottom,0px)}
    #btn-locate{flex:0 0 auto;padding:11px 14px;background:#f3f4f6;border:none;border-radius:12px;cursor:pointer;font-size:13px;color:#374151;font-weight:600;transition:background .15s;display:flex;align-items:center;gap:5px}
    #btn-locate:active{background:#e5e7eb}
    #btn-locate.loading{opacity:.6;pointer-events:none}
    #btn-confirm{flex:1;padding:12px;background:#3b82f6;border:none;border-radius:12px;color:#fff;font-size:14px;font-weight:700;cursor:pointer;transition:background .15s}
    #btn-confirm:active:not(:disabled){background:#2563eb}
    #btn-confirm:disabled{background:#d1d5db;color:#9ca3af;cursor:not-allowed}
    .leaflet-control-attribution{display:none!important}
    .leaflet-control-zoom{border-radius:10px!important;border:none!important;box-shadow:0 2px 8px rgba(0,0,0,.15)!important}
    .leaflet-control-zoom a{border-radius:8px!important;font-size:16px!important}
  </style>
</head>
<body>
<div id="toolbar">
  <div id="titlebar">
    <span id="pin-icon">📍</span>
    <h2>${t.title}</h2>
  </div>
  <div id="search-wrap">
    <div id="search-inner">
      <span id="search-icon">🔍</span>
      <input id="search" type="text" placeholder="${t.searchPH}" autocomplete="off" inputmode="search"/>
      <button id="search-clear" aria-label="Clear">✕</button>
    </div>
    <div id="suggestions"></div>
  </div>
</div>

<div id="map-wrap">
  <div id="map"></div>
  <!-- Fixed centre crosshair: map pans underneath, pin stays centred -->
  <div id="crosshair">
    <svg width="36" height="44" viewBox="0 0 36 44" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="18" cy="18" r="17" fill="#3b82f6" stroke="white" stroke-width="2.5"/>
      <circle cx="18" cy="18" r="7" fill="white"/>
      <!-- Pointer tip -->
      <path d="M18 35 L12 24 Q18 28 24 24 Z" fill="#3b82f6"/>
    </svg>
  </div>
</div>

<div id="bottom">
  <div id="addr-row">
    <span id="addr-icon">🏠</span>
    <div id="addr-texts">
      <div id="addr-main">${t.loading}</div>
      <div id="addr-sub">${t.centerHint}</div>
      <div id="addr-accuracy"></div>
    </div>
  </div>
  <div id="btn-row">
    <button id="btn-locate" aria-label="${t.myLocation}">
      <span id="locate-icon">📡</span>
      <span>${t.myLocation}</span>
    </button>
    <button id="btn-confirm" disabled>${t.confirm}</button>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js"></script>
<script>
  const INITIAL_LAT  = ${isNaN(lat)  ? 33.7294 : lat};
  const INITIAL_LNG  = ${isNaN(lng)  ? 73.3872 : lng};
  const INITIAL_ZOOM = ${isNaN(zoom) ? 15 : Math.max(10, Math.min(19, zoom))};
  const API_BASE     = window.location.origin;
  const IS_RTL       = ${isUrdu};
  const STR_LOADING  = '${t.loading}';
  const STR_ACCURACY = '${t.accuracy}';
  const STR_GPS_ERR  = '${t.gpsError}';

  /* ── Map init ── */
  const map = L.map('map', { zoomControl: true, attributionControl: false }).setView([INITIAL_LAT, INITIAL_LNG], INITIAL_ZOOM);

  /* ── Dynamic tile provider: load from server config ── */
  let tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  fetch(API_BASE + '/api/maps/config?app=picker')
    .then(r => r.json())
    .then(d => {
      const cfg = d?.data ?? d;
      const prov = cfg?.provider ?? 'osm';
      const tok  = cfg?.token ?? '';
      let url = null;
      if (prov === 'mapbox' && tok) {
        url = 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=' + tok;
      } else if (prov === 'google' && tok) {
        url = 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&key=' + tok;
      } else if (prov === 'locationiq' && tok) {
        url = 'https://tiles.locationiq.com/v3/streets/r/{z}/{x}/{y}.png?key=' + tok;
      }
      if (url) {
        map.removeLayer(tileLayer);
        tileLayer = L.tileLayer(url, { maxZoom: 19 }).addTo(map);
      }
    })
    .catch(() => {});

  /* ── State ── */
  let currentLat = INITIAL_LAT;
  let currentLng = INITIAL_LNG;
  let currentAddress = '';
  let addrTimer = null;
  let accuracyCircle = null;
  let isDragging = false;

  /* ── DOM refs ── */
  const addrMain   = document.getElementById('addr-main');
  const addrSub    = document.getElementById('addr-sub');
  const addrAcc    = document.getElementById('addr-accuracy');
  const confirmBtn = document.getElementById('btn-confirm');
  const crosshair  = document.getElementById('crosshair');
  const locateBtn  = document.getElementById('btn-locate');
  const locateIcon = document.getElementById('locate-icon');

  /* ── Crosshair drag feedback ── */
  map.on('movestart', () => {
    isDragging = true;
    crosshair.classList.add('dragging');
  });
  map.on('moveend', () => {
    isDragging = false;
    crosshair.classList.remove('dragging');
    const c = map.getCenter();
    currentLat = c.lat;
    currentLng = c.lng;
    scheduleReverseGeocode(c.lat, c.lng);
  });

  /* ── Reverse geocode ── */
  function setAddressLoading() {
    addrMain.textContent = STR_LOADING;
    confirmBtn.disabled = true;
  }

  async function reverseGeocode(lat, lng) {
    setAddressLoading();
    try {
      const r = await fetch(API_BASE + '/api/maps/reverse-geocode?lat=' + lat + '&lng=' + lng);
      const d = await r.json();
      currentAddress = d.address || d.formattedAddress || (lat.toFixed(6) + ', ' + lng.toFixed(6));
    } catch {
      currentAddress = lat.toFixed(6) + ', ' + lng.toFixed(6);
    }
    addrMain.textContent = currentAddress;
    confirmBtn.disabled = false;
  }

  function scheduleReverseGeocode(lat, lng) {
    if (addrTimer) clearTimeout(addrTimer);
    addrTimer = setTimeout(() => reverseGeocode(lat, lng), 500);
  }

  /* Initial geocode */
  scheduleReverseGeocode(INITIAL_LAT, INITIAL_LNG);

  /* ── Confirm button ── */
  confirmBtn.addEventListener('click', () => {
    const payload = { type: 'MAP_PICKER_CONFIRM', lat: currentLat, lng: currentLng, address: currentAddress };
    try { window.parent.postMessage(payload, '*'); } catch {}
    try { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload)); } catch {}
  });

  /* ── My Location (GPS) ── */
  locateBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      addrMain.textContent = STR_GPS_ERR;
      return;
    }
    locateBtn.classList.add('loading');
    locateIcon.textContent = '⏳';
    navigator.geolocation.getCurrentPosition(
      pos => {
        locateBtn.classList.remove('loading');
        locateIcon.textContent = '📡';
        const { latitude: lt, longitude: lg, accuracy } = pos.coords;
        map.setView([lt, lg], 17, { animate: true });

        /* Show accuracy circle */
        if (accuracyCircle) map.removeLayer(accuracyCircle);
        if (accuracy && accuracy < 2000) {
          accuracyCircle = L.circle([lt, lg], {
            radius: accuracy,
            color: '#3b82f6', fillColor: '#93c5fd',
            fillOpacity: 0.2, weight: 1.5
          }).addTo(map);
          const accText = accuracy < 1000
            ? Math.round(accuracy) + ' m'
            : (accuracy / 1000).toFixed(1) + ' km';
          addrAcc.textContent = STR_ACCURACY + ': ±' + accText;
          addrAcc.style.display = 'block';
        } else {
          addrAcc.style.display = 'none';
        }

        currentLat = lt; currentLng = lg;
        scheduleReverseGeocode(lt, lg);
      },
      err => {
        locateBtn.classList.remove('loading');
        locateIcon.textContent = '📡';
        addrMain.textContent = STR_GPS_ERR;
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });

  /* ── Search autocomplete ── */
  const searchEl  = document.getElementById('search');
  const clearEl   = document.getElementById('search-clear');
  const sugEl     = document.getElementById('suggestions');
  let searchTimer = null;

  function hideSuggestions() { sugEl.style.display = 'none'; }
  function showSuggestions() { if (sugEl.children.length) sugEl.style.display = 'block'; }

  searchEl.addEventListener('input', () => {
    const q = searchEl.value.trim();
    clearEl.style.display = q ? 'block' : 'none';
    if (searchTimer) clearTimeout(searchTimer);
    if (!q) { hideSuggestions(); return; }
    searchTimer = setTimeout(async () => {
      try {
        const r = await fetch(API_BASE + '/api/maps/autocomplete?input=' + encodeURIComponent(q));
        const d = await r.json();
        const preds = d.predictions || [];
        if (!preds.length) { hideSuggestions(); return; }
        sugEl.innerHTML = preds.slice(0, 8).map(p => {
          const pid  = encodeURIComponent(p.placeId  || '');
          const lat  = p.lat  || '';
          const lng  = p.lng  || '';
          const desc = encodeURIComponent(p.description || p.mainText || '');
          const escStr = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
          const main = escStr(p.mainText || p.description || '');
          const sub  = escStr(p.secondaryText || '');
          return '<div class="sug-item" data-lat="'+lat+'" data-lng="'+lng+'" data-pid="'+pid+'" data-desc="'+desc+'">'
            + '<div class="sug-dot"></div>'
            + '<div class="sug-texts">'
            + '<div class="sug-main">'+main+'</div>'
            + (sub ? '<div class="sug-sub">'+sub+'</div>' : '')
            + '</div></div>';
        }).join('');
        showSuggestions();
      } catch { hideSuggestions(); }
    }, 300);
  });

  clearEl.addEventListener('click', () => {
    searchEl.value = '';
    clearEl.style.display = 'none';
    hideSuggestions();
    searchEl.focus();
  });

  sugEl.addEventListener('click', async e => {
    const el = e.target.closest('.sug-item');
    if (!el) return;
    hideSuggestions();
    searchEl.value = '';
    clearEl.style.display = 'none';

    let lt = parseFloat(el.dataset.lat || '');
    let lg = parseFloat(el.dataset.lng || '');
    const desc = decodeURIComponent(el.dataset.desc || '');

    if (!lt || !lg) {
      try {
        const pid = decodeURIComponent(el.dataset.pid || '');
        const r = await fetch(API_BASE + '/api/maps/geocode?place_id=' + encodeURIComponent(pid));
        const d = await r.json();
        lt = d.lat; lg = d.lng;
      } catch { return; }
    }
    if (!lt || !lg) return;

    /* Remove accuracy circle when jumping to a search result */
    if (accuracyCircle) { map.removeLayer(accuracyCircle); accuracyCircle = null; }
    addrAcc.style.display = 'none';

    map.setView([lt, lg], 17, { animate: true });
    currentLat = lt; currentLng = lg;
    currentAddress = desc;
    addrMain.textContent = desc;
    confirmBtn.disabled = false;
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#search-wrap')) hideSuggestions();
  });

  /* ── Keyboard: close suggestions on Escape ── */
  searchEl.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideSuggestions();
  });
</script>
</body></html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Content-Security-Policy", "default-src 'self' https: data: 'unsafe-inline' 'unsafe-eval'");
  res.send(html);
});

/* ══════════════════════════════════════════════════════════
   LIVE TRACKING VIEW
   GET /api/maps/live-track
   Params:
     orderId - order/ride/parcel ID
     type    - "order" | "ride" | "parcel" | "pharmacy"
     token   - bearer token (for polling the tracking API)
     destLat, destLng  - destination coordinates
     destLabel         - destination label
     lang    - "en" | "ur"
   Returns a full-page Leaflet HTML map that polls for live rider
   position and smoothly animates the marker on every update.
══════════════════════════════════════════════════════════ */
router.get("/live-track", (req, res) => {
  const { orderId, type = "order", token = "", destLat, destLng, destLabel = "Destination", lang = "en" } = req.query as Record<string, string>;
  const isUrdu = lang === "ur";
  const destLabelEsc = escHtml(destLabel);

  const dLat = destLat ? parseFloat(destLat) : null;
  const dLng = destLng ? parseFloat(destLng) : null;

  const trackPath = type === "ride" ? `rides/${orderId}/track`
    : type === "parcel" ? `orders/${orderId}/track`
    : type === "pharmacy" ? `pharmacy-orders/${orderId}/track`
    : `orders/${orderId}/track`;

  const t = {
    waiting:     isUrdu ? "ڈرائیور کی جگہ کا انتظار..." : "Waiting for driver location...",
    onWay:       isUrdu ? "آپ کی طرف آ رہا ہے" : "On the way to you",
    arrived:     isUrdu ? "پہنچ گیا" : "Arrived",
    offline:     isUrdu ? "آف لائن" : "Offline",
    unavailable: isUrdu ? "ٹریکنگ دستیاب نہیں" : "Tracking unavailable",
    destination: isUrdu ? "منزل" : destLabelEsc,
    rider:       isUrdu ? "ڈرائیور" : "Driver",
  };

  const html = `<!DOCTYPE html>
<html lang="${isUrdu ? "ur" : "en"}" dir="${isUrdu ? "rtl" : "ltr"}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
  <title>Live Tracking</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{height:100%;background:#0f172a;overflow:hidden}
    #map{width:100%;height:100%}
    .leaflet-control-attribution{display:none!important}
    .leaflet-control-zoom{border-radius:10px!important;border:none!important;box-shadow:0 2px 8px rgba(0,0,0,.3)!important}
    /* Rider marker pulse animation */
    .rider-pulse{width:40px;height:40px;position:relative}
    .rider-pulse .dot{width:20px;height:20px;background:#3b82f6;border:3px solid #fff;border-radius:50%;position:absolute;top:10px;left:10px;box-shadow:0 2px 6px rgba(59,130,246,.6)}
    .rider-pulse .ring{width:40px;height:40px;border:3px solid #3b82f6;border-radius:50%;position:absolute;top:0;left:0;animation:pulse 1.8s ease-out infinite;opacity:0}
    @keyframes pulse{0%{transform:scale(.4);opacity:.8}100%{transform:scale(1.4);opacity:0}}
    /* Destination marker */
    .dest-marker{width:36px;height:44px;position:relative}
    .dest-marker svg{width:36px;height:44px;filter:drop-shadow(0 2px 5px rgba(0,0,0,.4))}
    /* Status overlay */
    #status-bar{position:fixed;bottom:0;left:0;right:0;z-index:1000;background:rgba(15,23,42,.92);backdrop-filter:blur(8px);padding:12px 16px;padding-bottom:calc(env(safe-area-inset-bottom,0px) + 12px);display:flex;align-items:center;gap:10px}
    #status-dot{width:10px;height:10px;border-radius:50%;background:#22c55e;flex-shrink:0;animation:blink 1.5s ease-in-out infinite}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
    #status-dot.waiting{background:#f59e0b;animation:none}
    #status-dot.offline{background:#ef4444;animation:none}
    #status-text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#e2e8f0;font-weight:600;flex:1}
    #accuracy-text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#64748b}
  </style>
</head>
<body>
<div id="map"></div>
<div id="status-bar">
  <div id="status-dot" class="waiting"></div>
  <span id="status-text">${t.waiting}</span>
  <span id="accuracy-text"></span>
</div>
<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js"></script>
<script>
  const ORDER_ID    = ${safeJson(orderId || "")};
  const TRACK_PATH  = ${safeJson(trackPath)};
  const TOKEN       = ${safeJson(token)};
  const DEST_LAT    = ${dLat !== null ? dLat : "null"};
  const DEST_LNG    = ${dLng !== null ? dLng : "null"};
  const DEST_LABEL  = ${safeJson(destLabel)};
  const API_BASE    = window.location.origin;
  const POLL_MS     = 6000;

  /* ── Map init (default to destination or Pakistan center) ── */
  const initLat = DEST_LAT || 33.7294, initLng = DEST_LNG || 73.3872;
  const map = L.map('map', { zoomControl: true, attributionControl: false })
    .setView([initLat, initLng], 14);

  /* ── Tile provider from config ── */
  let tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  fetch(API_BASE + '/api/maps/config?app=tracking')
    .then(r => r.json())
    .then(d => {
      const cfg = d?.data ?? d;
      const prov = cfg?.provider ?? 'osm';
      const tok  = cfg?.token ?? '';
      let url = null;
      if (prov === 'mapbox' && tok)
        url = 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=' + tok;
      else if (prov === 'google' && tok)
        url = 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&key=' + tok;
      else if (prov === 'locationiq' && tok)
        url = 'https://tiles.locationiq.com/v3/streets/r/{z}/{x}/{y}.png?key=' + tok;
      if (url) { map.removeLayer(tileLayer); tileLayer = L.tileLayer(url, { maxZoom: 19 }).addTo(map); }
    }).catch(() => {});

  /* ── Destination marker ── */
  const destIcon = L.divIcon({
    html: '<div class="dest-marker"><svg viewBox="0 0 36 44" fill="none"><circle cx="18" cy="18" r="17" fill="#ef4444" stroke="white" stroke-width="2.5"/><circle cx="18" cy="18" r="7" fill="white"/><path d="M18 35 L12 24 Q18 28 24 24 Z" fill="#ef4444"/></svg></div>',
    iconSize: [36, 44], iconAnchor: [18, 44], className: ''
  });
  let destMarker = null;
  if (DEST_LAT && DEST_LNG) {
    destMarker = L.marker([DEST_LAT, DEST_LNG], { icon: destIcon })
      .bindPopup('<b>' + DEST_LABEL + '</b>', { closeButton: false })
      .addTo(map);
  }

  /* ── Rider marker (pulse animation) ── */
  const riderIcon = L.divIcon({
    html: '<div class="rider-pulse"><div class="ring"></div><div class="dot"></div></div>',
    iconSize: [40, 40], iconAnchor: [20, 20], className: ''
  });
  let riderMarker = null;
  let hasFirstFix = false;

  const statusDot  = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const accText    = document.getElementById('accuracy-text');

  function setStatus(state, text, acc) {
    statusDot.className = state;
    statusText.textContent = text;
    accText.textContent = acc || '';
  }

  /* ── Smooth marker animation ── */
  function animateMarkerTo(marker, targetLat, targetLng, steps) {
    const start = marker.getLatLng();
    const dLat = (targetLat - start.lat) / steps;
    const dLng = (targetLng - start.lng) / steps;
    let i = 0;
    function step() {
      if (i++ >= steps) return;
      marker.setLatLng([start.lat + dLat * i, start.lng + dLng * i]);
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ── Poll tracking API ── */
  async function poll() {
    if (!ORDER_ID || !TRACK_PATH) { setStatus('offline', '${t.unavailable}', ''); return; }
    try {
      const r = await fetch(API_BASE + '/api/' + TRACK_PATH, {
        headers: TOKEN ? { 'Authorization': 'Bearer ' + TOKEN } : {}
      });
      if (!r.ok) throw new Error('fetch');
      const d = await r.json();
      const data = d?.data ?? d;
      const lat = typeof data.riderLat === 'number' ? data.riderLat : null;
      const lng = typeof data.riderLng === 'number' ? data.riderLng : null;
      if (lat === null || lng === null) {
        setStatus('waiting', '${t.waiting}', '');
        return;
      }
      setStatus('', '${t.onWay}', data.accuracy ? '±' + Math.round(data.accuracy) + 'm' : '');
      if (!riderMarker) {
        riderMarker = L.marker([lat, lng], { icon: riderIcon }).addTo(map);
        if (!hasFirstFix) {
          hasFirstFix = true;
          const bounds = [];
          if (destMarker) bounds.push(destMarker.getLatLng());
          bounds.push([lat, lng]);
          if (bounds.length > 1) {
            map.fitBounds(L.latLngBounds(bounds), { padding: [48, 48], maxZoom: 16, animate: true });
          } else {
            map.setView([lat, lng], 16, { animate: true });
          }
        }
      } else {
        animateMarkerTo(riderMarker, lat, lng, 30);
        if (!hasFirstFix) { map.setView([lat, lng], 16, { animate: true }); hasFirstFix = true; }
      }
      /* Notify parent frame with new position */
      try { window.parent.postMessage({ type: 'RIDER_LOCATION', lat, lng }, '*'); } catch {}
      try { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'RIDER_LOCATION', lat, lng })); } catch {}
    } catch {
      setStatus('offline', '${t.unavailable}', '');
    }
  }

  /* ── Listen for postMessage updates from parent (socket relay) ── */
  window.addEventListener('message', e => {
    try {
      const msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (msg?.type === 'RIDER_UPDATE' && typeof msg.lat === 'number' && typeof msg.lng === 'number') {
        if (!riderMarker) {
          riderMarker = L.marker([msg.lat, msg.lng], { icon: riderIcon }).addTo(map);
          hasFirstFix = true;
          const bounds = destMarker ? [[msg.lat, msg.lng], destMarker.getLatLng()] : [[msg.lat, msg.lng]];
          if (destMarker) map.fitBounds(L.latLngBounds(bounds), { padding: [48, 48], maxZoom: 16, animate: true });
          else map.setView([msg.lat, msg.lng], 16, { animate: true });
        } else {
          animateMarkerTo(riderMarker, msg.lat, msg.lng, 30);
        }
        setStatus('', '${t.onWay}', '');
        try { window.dispatchEvent(new CustomEvent('riderUpdateForPolyline', { detail: { lat: msg.lat, lng: msg.lng } })); } catch {}
      }
    } catch {}
  });

  /* ── Route polyline ── */
  let routeLayer = null;
  let lastPolylineRiderLat = null;
  let lastPolylineRiderLng = null;

  function haversineDist(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function fetchAndDrawRoute(rLat, rLng) {
    if (DEST_LAT == null || DEST_LNG == null) return;
    if (lastPolylineRiderLat != null && haversineDist(rLat, rLng, lastPolylineRiderLat, lastPolylineRiderLng) < 50) return;
    lastPolylineRiderLat = rLat;
    lastPolylineRiderLng = rLng;
    try {
      const r = await fetch(API_BASE + '/api/maps/directions?origin_lat=' + rLat + '&origin_lng=' + rLng + '&dest_lat=' + DEST_LAT + '&dest_lng=' + DEST_LNG + '&mode=driving', {
        headers: TOKEN ? { 'Authorization': 'Bearer ' + TOKEN } : {}
      });
      if (!r.ok) return;
      const d = await r.json();
      const geo = d?.geometry ?? d?.data?.geometry ?? null;
      if (!geo) return;
      if (routeLayer) { map.removeLayer(routeLayer); }
      routeLayer = L.geoJSON(geo, { style: { color: '#3b82f6', weight: 4, opacity: 0.7 } }).addTo(map);
    } catch {}
  }

  async function pollAndRoute() {
    await poll();
    if (riderMarker) {
      const ll = riderMarker.getLatLng();
      fetchAndDrawRoute(ll.lat, ll.lng);
    }
  }

  pollAndRoute();
  setInterval(pollAndRoute, POLL_MS);

  window.addEventListener('riderUpdateForPolyline', function(e) {
    if (e.detail && typeof e.detail.lat === 'number' && typeof e.detail.lng === 'number') fetchAndDrawRoute(e.detail.lat, e.detail.lng);
  });
</script>
</body></html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Content-Security-Policy", "default-src 'self' https: data: 'unsafe-inline' 'unsafe-eval'");
  res.send(html);
});

/* ══════════════════════════════════════════════════════════
   USAGE TRACKING — increments the map_api_usage_log counter
   Called by geocode, reverse-geocode, directions, autocomplete handlers.
   Silently swallows errors so tracking failures never break API responses.
══════════════════════════════════════════════════════════ */
export async function trackMapUsage(provider: string, endpointType: string): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    /* Upsert: increment count if row exists, insert with count=1 if not */
    await db.execute(sql`
      INSERT INTO map_api_usage_log (provider, endpoint_type, count, date)
      VALUES (${provider}, ${endpointType}, 1, ${today})
      ON CONFLICT (provider, endpoint_type, date)
      DO UPDATE SET count = map_api_usage_log.count + 1, updated_at = NOW()
    `);
  } catch { /* silent — usage tracking must not break API */ }
}

/* ══════════════════════════════════════════════════════════
   ADMIN MAPS SUB-ROUTER
   Exposed at TWO paths for full contract coverage:
     • /api/maps/admin/*  (primary, via mapsRouter)
     • /api/admin/maps/*  (alias, mounted separately in routes/index.ts)
   All handlers require admin auth.
══════════════════════════════════════════════════════════ */

export const adminMapsRouter: IRouter = Router();

/* ── POST /test
   Pings the real provider API and returns { ok, latencyMs, error? }
   Body: { provider: "osm"|"mapbox"|"google"|"locationiq", key?: string }
   ── */
async function handleMapsTest(req: import("express").Request, res: import("express").Response): Promise<void> {
  const { provider, key: keyOverride } = req.body as { provider?: string; key?: string };
  if (!provider || !["osm", "mapbox", "google", "locationiq"].includes(provider)) {
    sendValidationError(res, "provider must be 'osm', 'mapbox', 'google', or 'locationiq'"); return;
  }

  const settings = await getPlatformSettings();
  const s = settings as Record<string, string>;

  const mapboxToken    = keyOverride ?? (provider === "mapbox" ? (s["mapbox_api_key"] ?? "") : "");
  const googleKey      = keyOverride ?? (provider === "google"  ? (s["google_maps_api_key"] ?? s["maps_api_key"] ?? "") : "");
  const locationiqKey  = keyOverride ?? (provider === "locationiq" ? (s["locationiq_api_key"] ?? "") : "");

  const start = Date.now();
  let ok = false;
  let error: string | undefined;

  try {
    if (provider === "osm") {
      /* Ping Nominatim with a lightweight lookup */
      const r = await fetch("https://nominatim.openstreetmap.org/search?q=Muzaffarabad&format=json&limit=1", {
        headers: { "User-Agent": "AJKMart-Admin-Test/1.0" },
        signal: AbortSignal.timeout(8000),
      });
      ok = r.ok;
      if (!r.ok) error = `HTTP ${r.status}`;

    } else if (provider === "mapbox") {
      if (!mapboxToken) { sendError(res, "Mapbox token is not configured", 422); return; }
      /* Ping the Mapbox styles endpoint — lightweight, returns 200 if token is valid */
      const r = await fetch(
        `https://api.mapbox.com/styles/v1/mapbox/streets-v12?access_token=${mapboxToken}`,
        { signal: AbortSignal.timeout(8000) }
      );
      ok = r.ok;
      if (!r.ok) {
        const ct = r.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          const body = await r.json().catch(() => ({})) as Record<string, unknown>;
          error = String(body?.message ?? `HTTP ${r.status}`);
        } else {
          error = `HTTP ${r.status}`;
        }
      }

    } else if (provider === "google") {
      if (!googleKey) { sendError(res, "Google Maps API key is not configured", 422); return; }
      /* Ping the Geocoding API with a minimal query */
      const r = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=Muzaffarabad&key=${googleKey}`,
        { signal: AbortSignal.timeout(8000) }
      );
      const ct = r.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        ok = false;
        error = `Unexpected response from Google Maps API (HTTP ${r.status}, content-type: ${ct.split(";")[0]?.trim() ?? "unknown"})`;
      } else {
        const data = await r.json() as Record<string, unknown>;
        ok = data?.status === "OK" || data?.status === "ZERO_RESULTS";
        if (!ok) error = String(data?.error_message ?? data?.status ?? `HTTP ${r.status}`);
      }

    } else if (provider === "locationiq") {
      if (!locationiqKey) { sendError(res, "LocationIQ API key is not configured", 422); return; }
      const r = await fetch(
        `https://us1.locationiq.com/v1/search?key=${locationiqKey}&q=Muzaffarabad&format=json&limit=1`,
        { signal: AbortSignal.timeout(8000) }
      );
      ok = r.ok;
      if (!r.ok) {
        const ct = r.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          const body = await r.json().catch(() => ({})) as Record<string, unknown>;
          error = String(body?.error ?? `HTTP ${r.status}`);
        } else {
          error = `HTTP ${r.status}`;
        }
      }
    }
  } catch (e: unknown) {
    ok = false;
    error = (e instanceof Error ? e.message : undefined) ?? "Request timed out";
  }

  const latencyMs = Date.now() - start;

  /* Persist test result to platform_settings — use upsert so the row is created
     if it doesn't exist yet (UPDATE alone would silently no-op on missing keys) */
  const now = new Date().toISOString();
  try {
    const lastTestedKey  = `map_last_tested_${provider}`;
    const testStatusKey  = `map_test_status_${provider}`;
    const statusValue    = ok ? "ok" : "fail";
    await db.insert(platformSettingsTable)
      .values({ key: lastTestedKey, value: now, label: lastTestedKey, category: "maps", updatedAt: new Date() })
      .onConflictDoUpdate({ target: platformSettingsTable.key, set: { value: now, updatedAt: new Date() } });
    await db.insert(platformSettingsTable)
      .values({ key: testStatusKey, value: statusValue, label: testStatusKey, category: "maps", updatedAt: new Date() })
      .onConflictDoUpdate({ target: platformSettingsTable.key, set: { value: statusValue, updatedAt: new Date() } });
    /* Bust the settings cache so the next /api/maps/config call returns fresh test status */
    invalidatePlatformSettingsCache();
  } catch { /* ignore persistence errors */ }

  sendSuccess(res, { ok, latencyMs, provider, error, testedAt: now });
}

/* ── GET /usage
   Returns daily and monthly call counts per provider/endpoint.
   ── */
async function handleMapsUsage(_req: import("express").Request, res: import("express").Response): Promise<void> {
  try {
    const rows = await db.select().from(mapApiUsageLogTable).orderBy(mapApiUsageLogTable.date, mapApiUsageLogTable.provider);

    /* Group into daily (last 30 days) and monthly summaries */
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const daily = rows.filter(r => r.date >= thirtyDaysAgo);

    /* Build per-day aggregated data suitable for a Recharts bar chart */
    const byDay: Record<string, Record<string, number>> = {};
    for (const row of daily) {
      const d = row.date;
      if (!byDay[d]) byDay[d] = {};
      byDay[d]![row.provider] = (byDay[d]![row.provider] ?? 0) + row.count;
    }
    const dailyChart = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }));

    /* Monthly totals */
    const monthKey = now.toISOString().slice(0, 7);
    const monthly  = rows.filter(r => r.date.startsWith(monthKey));
    const monthlyByProvider: Record<string, Record<string, number>> = {};
    for (const row of monthly) {
      if (!monthlyByProvider[row.provider]) monthlyByProvider[row.provider] = {};
      monthlyByProvider[row.provider]![row.endpointType] = (monthlyByProvider[row.provider]![row.endpointType] ?? 0) + row.count;
    }

    /* Cost estimates (approximate published pricing, USD per 1000 calls) */
    const COST_PER_1K: Record<string, Record<string, number>> = {
      google:     { geocode: 5, directions: 5, autocomplete: 2.83, "reverse-geocode": 5 },
      mapbox:     { geocode: 0.75, directions: 1, autocomplete: 0.75, "reverse-geocode": 0.75 },
      osm:        { geocode: 0, directions: 0, autocomplete: 0, "reverse-geocode": 0 },
      locationiq: { geocode: 0.50, directions: 0, autocomplete: 0.50, "reverse-geocode": 0.50 },
    };

    const costEstimates: Record<string, number> = {};
    for (const [prov, endpoints] of Object.entries(monthlyByProvider)) {
      let cost = 0;
      const provCosts = COST_PER_1K[prov] ?? {};
      for (const [ep, cnt] of Object.entries(endpoints)) {
        cost += ((provCosts[ep] ?? 0) * cnt) / 1000;
      }
      costEstimates[prov] = Math.round(cost * 100) / 100;
    }

    sendSuccess(res, {
      dailyChart,
      monthlyByProvider,
      costEstimates,
      totalRows: rows.length,
    });
  } catch (e: unknown) {
    sendError(res, (e instanceof Error ? e.message : undefined) ?? "Failed to fetch usage data", 500);
  }
}

/* ── POST /cache/clear
   Flushes the in-process reverse-geocode LRU cache.
   ── */
async function handleMapsCacheClear(_req: import("express").Request, res: import("express").Response): Promise<void> {
  const before = _revGeoCache.size;
  _revGeoCache.clear();
  sendSuccess(res, { cleared: before, cacheSize: 0 });
}

/* ══════════════════════════════════════════════════════════
   GET /api/maps/static?center=LAT,LNG&zoom=N&size=WxH&markers=color:green|LAT,LNG
   Returns a static map image using OpenStreetMap tiles (no API key required).
   Falls back to a redirect to staticmap.openstreetmap.de if tile stitching fails.
══════════════════════════════════════════════════════════ */
router.get("/static", async (req, res) => {
  const centerParam = String(req.query["center"] ?? "34.37,73.47");
  const zoomParam   = parseInt(String(req.query["zoom"] ?? "13"), 10);
  const sizeParam   = String(req.query["size"] ?? "600x280");

  const [centerLat, centerLng] = centerParam.split(",").map(Number);
  const zoom = Math.max(1, Math.min(19, isNaN(zoomParam) ? 13 : zoomParam));
  const [widthStr, heightStr] = sizeParam.split("x");
  const width  = Math.min(1280, Math.max(100, parseInt(widthStr  ?? "600", 10)));
  const height = Math.min(1280, Math.max(100, parseInt(heightStr ?? "280", 10)));

  const lat = isNaN(centerLat) ? 34.37 : centerLat;
  const lng = isNaN(centerLng) ? 73.47 : centerLng;

  /* Parse markers: supports multiple &markers=color:COLOR|LAT,LNG params */
  const rawMarkers = Array.isArray(req.query["markers"])
    ? req.query["markers"] as string[]
    : req.query["markers"] ? [req.query["markers"] as string] : [];

  /* Helper: lat/lng → OSM tile x/y */
  function lngToTileX(lngDeg: number, z: number): number {
    return Math.floor((lngDeg + 180) / 360 * Math.pow(2, z));
  }
  function latToTileY(latDeg: number, z: number): number {
    const latRad = latDeg * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, z));
  }
  /* Tile pixel offset: given a lat/lng, return pixel offset within tiled canvas */
  function latLngToPixel(latDeg: number, lngDeg: number, z: number, originTileX: number, originTileY: number): { x: number; y: number } {
    const n = Math.pow(2, z);
    const x = ((lngDeg + 180) / 360 * n - originTileX) * 256;
    const latRad = latDeg * Math.PI / 180;
    const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n - originTileY) * 256;
    return { x, y };
  }

  try {
    /* Use sharp for image composition if available, else fall back to redirect */
    let sharpModule: typeof import("sharp") | null = null;
    try {
      sharpModule = await import("sharp");
    } catch {
      sharpModule = null;
    }
    const sharp = sharpModule;
    if (!sharp) throw new Error("sharp not available");

    /* Determine tile range to cover the requested canvas size */
    const centerTileX = lngToTileX(lng, zoom);
    const centerTileY = latToTileY(lat, zoom);

    const tilesWide = Math.ceil(width  / 256) + 3;
    const tilesHigh = Math.ceil(height / 256) + 3;
    const startTileX = centerTileX - Math.floor(tilesWide / 2);
    const startTileY = centerTileY - Math.floor(tilesHigh / 2);

    /* Center pixel offset within the composed tile canvas */
    const centerPixel = latLngToPixel(lat, lng, zoom, startTileX, startTileY);
    const offsetX = Math.max(0, Math.round(centerPixel.x - width  / 2));
    const offsetY = Math.max(0, Math.round(centerPixel.y - height / 2));

    const tileCount = Math.pow(2, zoom);

    /* Collect tile coordinates */
    const tileJobs: Array<{ tx: number; ty: number; normTx: number; normTy: number; pxX: number; pxY: number }> = [];
    for (let ty = startTileY; ty < startTileY + tilesHigh; ty++) {
      for (let tx = startTileX; tx < startTileX + tilesWide; tx++) {
        const normTx = ((tx % tileCount) + tileCount) % tileCount;
        const normTy = ((ty % tileCount) + tileCount) % tileCount;
        const pxX = (tx - startTileX) * 256;
        const pxY = (ty - startTileY) * 256;
        tileJobs.push({ tx, ty, normTx, normTy, pxX, pxY });
      }
    }

    /* Fetch tiles with concurrency limit of 9 to respect OSM tile server limits */
    const CONCURRENCY = 9;
    const tiles: Array<{ x: number; y: number; buf: Buffer | null }> = [];
    for (let i = 0; i < tileJobs.length; i += CONCURRENCY) {
      const batch = tileJobs.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(job => {
        const url = `https://tile.openstreetmap.org/${zoom}/${job.normTx}/${job.normTy}.png`;
        return fetch(url, { headers: { "User-Agent": "AJKMart-Server/1.0" }, signal: AbortSignal.timeout(6000) })
          .then(r => r.ok ? r.arrayBuffer() : null)
          .then(ab => ({ x: job.pxX, y: job.pxY, buf: ab ? Buffer.from(ab) : null }))
          .catch(() => ({ x: job.pxX, y: job.pxY, buf: null }));
      }));
      tiles.push(...results);
    }

    const canvasW = tilesWide * 256 + 256;
    const canvasH = tilesHigh * 256 + 256;

    /* Build blank canvas and composite tiles */
    let canvas = sharp.default({ create: { width: canvasW, height: canvasH, channels: 3, background: { r: 242, g: 239, b: 233 } } }).png();

    const composites: import("sharp").OverlayOptions[] = tiles
      .filter(t => t.buf !== null)
      .map(t => ({ input: t.buf!, top: t.y, left: t.x }));

    /* Draw marker circles via SVG overlay */
    const markerOverlays: import("sharp").OverlayOptions[] = [];
    for (const markerStr of rawMarkers) {
      const parts = markerStr.split("|");
      const coordPart = parts[parts.length - 1] ?? "";
      const [mLatStr, mLngStr] = coordPart.split(",");
      const mLat = parseFloat(mLatStr ?? "");
      const mLng = parseFloat(mLngStr ?? "");
      if (isNaN(mLat) || isNaN(mLng)) continue;
      const colorPart = parts.find(p => p.startsWith("color:"))?.replace("color:", "") ?? "red";
      const colorMap: Record<string, string> = { red: "#e53e3e", green: "#38a169", blue: "#3182ce", orange: "#dd6b20", purple: "#805ad5" };
      const fillColor = colorMap[colorPart] ?? colorPart;
      const px = latLngToPixel(mLat, mLng, zoom, startTileX, startTileY);
      const cx = Math.round(px.x);
      const cy = Math.round(px.y);
      const r = 10;
      const markerLeft = cx - r - 2;
      const markerTop  = cy - r - 2;
      /* Skip markers outside the canvas bounds */
      if (markerLeft < 0 || markerTop < 0 || markerLeft + r * 2 + 4 > canvasW || markerTop + r * 2 + 4 > canvasH) continue;
      const svg = `<svg width="${r * 2 + 4}" height="${r * 2 + 4}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${r + 2}" cy="${r + 2}" r="${r}" fill="${escHtml(fillColor)}" stroke="white" stroke-width="2"/>
      </svg>`;
      markerOverlays.push({ input: Buffer.from(svg), top: markerTop, left: markerLeft });
    }

    const allComposites = [...composites, ...markerOverlays];

    /* Composite tiles + markers into a raw buffer first, then crop.
       In sharp v0.34 chaining .composite().extract() fails when there are
       multiple overlays; doing two separate sharp operations avoids that. */
    const { data: rawData, info: rawInfo } = await canvas
      .composite(allComposites)
      .raw()
      .toBuffer({ resolveWithObject: true });

    const finalBuf = await sharp.default(rawData, { raw: { width: rawInfo.width, height: rawInfo.height, channels: rawInfo.channels as 1 | 2 | 3 | 4 } })
      .extract({ left: offsetX, top: offsetY, width, height })
      .jpeg({ quality: 85 })
      .toBuffer();

    void trackMapUsage("osm", "static");
    res.set("Content-Type", "image/jpeg");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(finalBuf);
  } catch (staticErr) {
    /* Log the error for debugging, then fallback */
    console.error("[maps/static] Tile stitch failed:", (staticErr as Error)?.message ?? staticErr);
    /* Fallback: redirect to staticmap.openstreetmap.de */
    const markerQuery = rawMarkers.map(m => {
      const parts = m.split("|");
      const coord = parts[parts.length - 1] ?? "";
      return `markers=${encodeURIComponent(coord)}`;
    }).join("&");
    const fallbackUrl = `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=${zoom}&size=${width}x${height}${markerQuery ? `&${markerQuery}` : ""}`;
    res.redirect(302, fallbackUrl);
  }
});

/* Register on the main maps router: /api/maps/admin/* */
router.post("/admin/test",        adminAuth, handleMapsTest);
router.get("/admin/usage",        adminAuth, handleMapsUsage);
router.post("/admin/cache/clear", adminAuth, handleMapsCacheClear);

/* Register on the dedicated admin sub-router: /api/admin/maps/* */
adminMapsRouter.post("/test",        adminAuth, handleMapsTest);
adminMapsRouter.get("/usage",        adminAuth, handleMapsUsage);
adminMapsRouter.post("/cache/clear", adminAuth, handleMapsCacheClear);

export default router;
