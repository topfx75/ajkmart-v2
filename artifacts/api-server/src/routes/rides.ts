import { logger } from "../lib/logger.js";
import { canonicalizePhone } from "@workspace/phone-utils";
import { isInServiceZone } from "../lib/geofence.js";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  liveLocationsTable, notificationsTable, rideBidsTable,
  rideServiceTypesTable, ridesTable, rideRatingsTable,
  usersTable, riderProfilesTable, walletTransactionsTable,
  popularLocationsTable, rideEventLogsTable, rideNotifiedRidersTable,
  rideMessagesTable,
} from "@workspace/db/schema";
import { and, asc, eq, ne, sql, or, isNull, gte, count } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "../lib/id.js";
import { ensureDefaultRideServices, ensureDefaultLocations, getPlatformSettings, adminAuth } from "./admin.js";
import { customerAuth, riderAuth } from "../middleware/security.js";
import { loadRide, requireRideState, requireRideOwner } from "../middleware/ride-guards.js";
import { getIO, emitRideMessage } from "../lib/socketio.js";
import { sendSuccess, sendCreated, sendError, sendErrorWithData, sendNotFound, sendForbidden, sendValidationError } from "../lib/response.js";

function broadcastWalletUpdate(userId: string, newBalance: number) {
  const io = getIO();
  if (!io) return;
  io.to(`user:${userId}`).emit("wallet:update", { balance: newBalance });
}
import { t, type TranslationKey } from "@workspace/i18n";
import { getUserLanguage } from "../lib/getUserLanguage.js";
import { emitRiderNewRequest, emitRideDispatchUpdate, emitRideOtp } from "../lib/socketio.js";
import { emitRideUpdate, onRideUpdate } from "../lib/rideEvents.js";
import { sendPushToUser, sendPushToUsers } from "../lib/webpush.js";
import rateLimit from "express-rate-limit";

const router: IRouter = Router();

/* ── Rate limiters ─────────────────────────────────────────────────────── */
const bargainLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many bargain requests. Please wait a minute before trying again." },
  validate: { xForwardedForHeader: false },
});

/** Book-ride limiter: 5 booking attempts per user per minute.
 *  IMPORTANT: this must be mounted AFTER customerAuth so req.customerId is set
 *  when keyGenerator runs. Placing it before auth would collapse all requests
 *  into a single shared "anonymous" bucket, enabling DoS against all customers. */
const bookRideLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.customerId ?? "anonymous",
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many booking requests. Please wait a minute before trying again." },
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});

/** Cancel-ride limiter: 3 cancellation attempts per user per minute.
 *  Same ordering rule: mount AFTER customerAuth. */
const cancelRideLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  keyGenerator: (req) => req.customerId ?? "anonymous",
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many cancellation requests. Please wait a minute." },
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});

/** Fare-estimate limiter: 30 estimate calls per IP per minute */
const estimateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many fare estimate requests. Please wait a moment." },
  validate: { xForwardedForHeader: false },
});

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, "").trim();

const coordinateSchema = z.number().min(-180).max(180);
const latitudeSchema = z.number().min(-90).max(90);

function toNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

const MAX_FARE = 100_000;

const bookRideSchema = z.object({
  type: z.string().min(1),
  pickupAddress: z.string().min(1).max(300).transform(stripHtml),
  dropAddress: z.string().min(1).max(300).transform(stripHtml),
  pickupLat: z.preprocess(toNumber, latitudeSchema),
  pickupLng: z.preprocess(toNumber, coordinateSchema),
  dropLat: z.preprocess(toNumber, latitudeSchema),
  dropLng: z.preprocess(toNumber, coordinateSchema),
  paymentMethod: z.string().min(1),
  offeredFare: z.preprocess((v) => (v != null && v !== "" ? Number(v) : undefined), z.number().positive().max(MAX_FARE).optional()),
  bargainNote: z.string().max(500).transform(stripHtml).optional(),
  /* ── Parcel delivery fields ── */
  isParcel: z.boolean().optional().default(false),
  receiverName: z.string().max(200).transform(stripHtml).optional(),
  receiverPhone: z.string().max(20).transform(v => canonicalizePhone(v) ?? "").pipe(z.string().regex(/^92\d{10}$/, "Receiver phone must be a valid Pakistani mobile number (e.g. 03001234567)")).optional(),
  packageType: z.string().max(100).transform(stripHtml).optional(),
  /* ── Scheduled ride ── */
  isScheduled: z.boolean().optional().default(false),
  scheduledAt: z.string().datetime().optional(),
  /* ── Multi-stop ── */
  stops: z.array(z.object({
    address: z.string().max(500),
    lat: z.preprocess(toNumber, latitudeSchema),
    lng: z.preprocess(toNumber, coordinateSchema),
    order: z.number().int(),
  })).max(5).optional(),
  /* ── Pool / shared ride ── */
  isPoolRide: z.boolean().optional().default(false),
});

const cancelRideSchema = z.object({
  reason: z.string().max(200).optional(),
});

const acceptBidSchema = z.object({
  bidId: z.string().min(1),
});

const customerCounterSchema = z.object({
  offeredFare: z.preprocess(toNumber, z.number().positive().max(MAX_FARE)),
  note: z.string().max(300).transform(stripHtml).optional(),
});

const rateRideSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().max(1000).transform(stripHtml).optional(),
});

const estimateSchema = z.object({
  pickupLat: z.preprocess(toNumber, latitudeSchema),
  pickupLng: z.preprocess(toNumber, coordinateSchema),
  dropLat: z.preprocess(toNumber, latitudeSchema),
  dropLng: z.preprocess(toNumber, coordinateSchema),
  type: z.string().min(1).optional(),
});

const eventLogSchema = z.object({
  event: z.string().min(1),
  lat: z.preprocess(toNumber, latitudeSchema.optional()),
  lng: z.preprocess(toNumber, coordinateSchema.optional()),
  notes: z.string().max(1000).optional(),
});

/** In-memory cache of all active service keys from the DB.
 *  Populated lazily on first call and refreshed every 5 minutes. */
let _serviceKeysCache: Set<string> | null = null;
let _serviceKeysCacheAt = 0;
const SERVICE_KEYS_TTL_MS = 5 * 60_000;

async function getServiceKeys(): Promise<Set<string>> {
  if (_serviceKeysCache && Date.now() - _serviceKeysCacheAt < SERVICE_KEYS_TTL_MS) {
    return _serviceKeysCache;
  }
  const rows = await db.select({ key: rideServiceTypesTable.key }).from(rideServiceTypesTable);
  _serviceKeysCache = new Set(rows.map(r => r.key.toLowerCase()));
  _serviceKeysCacheAt = Date.now();
  return _serviceKeysCache;
}

/** Normalize a raw vehicle/service type string to a canonical slug.
 *  Handles the hardcoded built-in aliases AND any admin-defined service keys
 *  that exist in the DB (e.g. "premium_sedan", "minivan"). */
async function normalizeVehicleType(raw: string | null | undefined): Promise<string> {
  const serviceKeys = await getServiceKeys();
  return normalizeVehicleTypeSync(raw, serviceKeys);
}

/**
 * Normalize a raw vehicle/service type string to a canonical slug.
 * Matching is case-insensitive and strips separators (spaces, underscores,
 * hyphens) so "Motorcycle", "motor cycle", "Motor_Cycle", "motor-cycle"
 * all correctly resolve to "bike".
 *
 * Strategy:
 * 1. Lowercase the input.
 * 2. Produce a `slug` (separators → underscores) used as the return value and
 *    for DB key matching.
 * 3. Produce a `words` array (split on separators) to match multi-word aliases
 *    in a separator-agnostic way (e.g. ["motor","cycle"] → "motorcycle").
 * 4. Match against hardcoded aliases, then DB service keys (same slug form).
 */
function normalizeVehicleTypeSync(raw: string | null | undefined, serviceKeys: Set<string>): string {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return "";
  /* slug: collapse all separator chars to a single underscore */
  const slug = v.replace(/[\s_\-]+/g, "_").replace(/[^a-z0-9_]/g, "").replace(/_+/g, "_").replace(/^_|_$/g, "");
  /* words: individual tokens after splitting on separators */
  const words = slug.split("_").filter(Boolean);
  const wordSet = new Set(words);

  /* Hardcoded alias matching — check slug, individual words, and multi-word combinations */
  const isMotorcycle = slug === "motorcycle" || wordSet.has("motorcycle") || wordSet.has("motorbike") ||
    (wordSet.has("motor") && (wordSet.has("cycle") || wordSet.has("bike")));
  const isBike = slug === "bike" || wordSet.has("bike");
  if (isBike || isMotorcycle) return "bike";

  if (slug === "car") return "car";

  const isRickshaw = slug === "rickshaw" || wordSet.has("rickshaw") || wordSet.has("qingqi");
  if (isRickshaw) return "rickshaw";

  if (slug === "van") return "van";
  if (slug === "daba") return "daba";
  if (slug === "bicycle") return "bicycle";
  if (slug === "on_foot" || (wordSet.has("on") && wordSet.has("foot"))) return "on_foot";

  /* DB service key matching:
     - Try exact raw lowercased form
     - Try slug form
     - Try normalizing each DB key to slug form and comparing */
  if (serviceKeys.has(v)) return v;
  if (serviceKeys.has(slug)) return slug;
  for (const key of serviceKeys) {
    const keySlug = key.replace(/[\s_\-]+/g, "_").replace(/[^a-z0-9_]/g, "").replace(/_+/g, "_").replace(/^_|_$/g, "");
    if (keySlug === slug) return key;
  }
  return slug || v;
}

/** Notify eligible riders within the given radius for a ride request.
 *  Returns the number of new riders notified in this phase. */
async function notifyRidersInRadius(
  rideId: string,
  ride: { userId: string; type: string | null; pickupAddress: string; dropAddress: string; fare: string | null; status: string; dispatchedAt: Date | null },
  pickupLat: number,
  pickupLng: number,
  radiusKm: number,
  avgSpeed: number,
  serviceKeys: Set<string>,
): Promise<number> {
  const ttlCutoff = new Date(Date.now() - 5 * 60 * 1000);

  const onlineRiders = await db.select({
    userId: liveLocationsTable.userId,
    latitude: liveLocationsTable.latitude,
    longitude: liveLocationsTable.longitude,
    vehicleType: riderProfilesTable.vehicleType,
  }).from(liveLocationsTable)
    .innerJoin(usersTable, eq(liveLocationsTable.userId, usersTable.id))
    .leftJoin(riderProfilesTable, eq(liveLocationsTable.userId, riderProfilesTable.userId))
    .where(and(
      eq(liveLocationsTable.role, "rider"),
      gte(liveLocationsTable.updatedAt, ttlCutoff),
      eq(usersTable.isActive, true),
      eq(usersTable.isBanned, false),
      eq(usersTable.isRestricted, false),
    ));

  const [alreadyNotified, busyRiders] = await Promise.all([
    db.select({ riderId: rideNotifiedRidersTable.riderId })
      .from(rideNotifiedRidersTable)
      .where(eq(rideNotifiedRidersTable.rideId, rideId)),
    db.select({ riderId: ridesTable.riderId })
      .from(ridesTable)
      .where(sql`${ridesTable.riderId} IS NOT NULL AND ${ridesTable.status} IN ('accepted', 'arrived', 'in_transit')`),
  ]);
  const alreadySet = new Set(alreadyNotified.map(r => r.riderId));
  const busySet = new Set(busyRiders.map(r => r.riderId));

  const rideVt = ride.type ? normalizeVehicleTypeSync(ride.type, serviceKeys) : null;
  let notifiedCount = 0;

  for (const r of onlineRiders) {
    if (alreadySet.has(r.userId)) continue;
    if (busySet.has(r.userId)) continue;
    if (rideVt) {
      const riderVt = normalizeVehicleTypeSync(r.vehicleType, serviceKeys);
      if (!riderVt || riderVt !== rideVt) continue;
    }
    const rLat = parseFloat(String(r.latitude));
    const rLng = parseFloat(String(r.longitude));
    if (!Number.isFinite(rLat) || !Number.isFinite(rLng)) continue;
    const dist = calcDistance(pickupLat, pickupLng, rLat, rLng);
    if (dist > radiusKm) continue;

    const etaMin = Math.max(1, Math.round((dist / avgSpeed) * 60));
    const fareStr = parseFloat(ride.fare ?? "0").toFixed(0);
    const riderLang = await getUserLanguage(r.userId);
    const titleKey = ride.status === "bargaining" ? "notifRideBargaining" : "notifRideRequest";
    const bodyStr = t("notifRideRequestBody", riderLang)
      .replace("{from}", ride.pickupAddress)
      .replace("{to}", ride.dropAddress)
      .replace("{fare}", fareStr)
      .replace("{dist}", dist.toFixed(1))
      .replace("{eta}", String(etaMin));

    await db.insert(notificationsTable).values({
      id: generateId(), userId: r.userId,
      title: `${t(titleKey, riderLang)} 🚗`,
      body: bodyStr,
      type: "ride", icon: "car-outline", link: `/ride/${rideId}`,
    }).catch(() => {});

    await db.insert(rideNotifiedRidersTable).values({
      id: generateId(),
      rideId,
      riderId: r.userId,
    }).catch(() => {});

    emitRiderNewRequest(r.userId, {
      type: "ride",
      requestId: rideId,
      summary: `${ride.pickupAddress} → ${ride.dropAddress}`,
    });

    sendPushToUser(r.userId, {
      title: "🚗 New Ride Request",
      body: `${ride.pickupAddress} → ${ride.dropAddress} · Rs. ${fareStr}`,
      tag: `ride-request-${rideId}`,
      data: { rideId },
    }).catch(() => {});

    notifiedCount++;
  }

  return notifiedCount;
}

/**
 * Progressive dispatch: select the search radius based on how long the ride
 * has been searching and notify eligible riders within that radius.
 *
 * Phase selection (elapsed since dispatchedAt / createdAt):
 *   0 – 30 s  → 2 km
 *   30 – 90 s → 5 km
 *   90 s +    → 10 km
 *
 * This function is non-blocking — it returns immediately after notifying
 * the current phase's riders.  The dispatch engine calls it every 10 s so
 * the radius expands naturally over time without sleeping inside this call.
 * The engine is responsible for expiry / no_riders transitions.
 */
async function broadcastRide(rideId: string) {
  try {
    const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
    if (!ride || ride.riderId) return;
    if (!["searching", "bargaining"].includes(ride.status)) return;

    const s = await getPlatformSettings();
    const avgSpeed = parseFloat(s["dispatch_avg_speed_kmh"] ?? "25");

    const pickupLat = parseFloat(ride.pickupLat ?? "");
    const pickupLng = parseFloat(ride.pickupLng ?? "");
    if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) {
      logger.error(`[broadcast] Ride ${rideId} has invalid coordinates — skipping dispatch`);
      return;
    }

    const now = Date.now();
    if (!ride.dispatchedAt) {
      await db.update(ridesTable).set({
        dispatchedAt: new Date(now),
        updatedAt: new Date(now),
      }).where(and(eq(ridesTable.id, rideId), isNull(ridesTable.riderId)));
    }

    const dispatchOrigin = ride.dispatchedAt ? ride.dispatchedAt.getTime() : now;
    const elapsedSec = (now - dispatchOrigin) / 1000;

    /* Select radius for this cycle based on elapsed time */
    let radiusKm: number;
    if (elapsedSec < 30) {
      radiusKm = 2;
    } else if (elapsedSec < 90) {
      radiusKm = 5;
    } else {
      radiusKm = 10;
    }

    const serviceKeys = await getServiceKeys();

    const notified = await notifyRidersInRadius(
      rideId, ride, pickupLat, pickupLng,
      radiusKm, avgSpeed, serviceKeys,
    );

    logger.info(`[broadcast] Ride ${rideId} elapsed=${elapsedSec.toFixed(0)}s radius=${radiusKm}km — notified ${notified} rider(s)`);

    emitRideDispatchUpdate({
      rideId,
      action: "SEARCHING",
      status: "searching",
      radiusKm,
    });

  } catch (err) {
    logger.error(`[broadcast] Error for ride ${rideId}:`, err);
  }
}

async function cleanupNotifiedRiders(rideId: string) {
  await db.delete(rideNotifiedRidersTable)
    .where(eq(rideNotifiedRidersTable.rideId, rideId))
    .catch(() => {});
}

class RideApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus: number = 422,
  ) {
    super(message);
    this.name = "RideApiError";
  }
}

function calcDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!isFinite(lat1) || !isFinite(lng1) || !isFinite(lat2) || !isFinite(lng2)) {
    throw new RideApiError("Invalid coordinates: all values must be finite numbers", "INVALID_COORDINATES", 422);
  }
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Generates a random 4-digit OTP string (1000–9999) */
function generateOtp(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/**
 * Returns road distance in km using the configured routing provider.
 * Provider priority: locationiq → google → mapbox → haversine (no multiplier).
 * The haversine fallback is plain straight-line distance with no multiplier —
 * it is only used as a last resort when no routing API is configured or reachable.
 */
async function getRoadDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): Promise<{ distanceKm: number; durationSeconds: number; source: "locationiq" | "google" | "mapbox" | "osrm" | "haversine" }> {
  const haversine = calcDistance(lat1, lng1, lat2, lng2);

  let s: Record<string, string>;
  try {
    s = await getPlatformSettings();
  } catch {
    s = {};
  }

  const routingProvider = s["routing_engine"] ?? s["routing_api_provider"] ?? "osrm";

  try {
    if (routingProvider === "locationiq") {
      const locationiqKey = s["locationiq_api_key"];
      if (!locationiqKey) return buildHaversineFallback(haversine);
      const url = `https://us1.locationiq.com/v1/directions/driving/${lng1},${lat1};${lng2},${lat2}?key=${locationiqKey}&overview=false&steps=false`;
      const raw  = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data = await raw.json() as { code?: string; routes?: Array<{ distance: number; duration: number }> };
      if (data.routes?.length) {
        return {
          distanceKm:      Math.round(data.routes[0]!.distance / 100) / 10,
          durationSeconds: Math.round(data.routes[0]!.duration),
          source: "locationiq",
        };
      }
      return buildHaversineFallback(haversine);
    }

    if (routingProvider === "google") {
      const googleKey = s["google_maps_api_key"] ?? s["maps_api_key"];
      if (!googleKey) return buildHaversineFallback(haversine);
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${lat1},${lng1}&destination=${lat2},${lng2}&mode=driving&key=${googleKey}`;
      const raw  = await fetch(url, { signal: AbortSignal.timeout(4000) });
      const data = await raw.json() as { status?: string; routes?: Array<{ legs: Array<{ distance: { value: number }; duration: { value: number } }> }> };
      if (data.status === "OK" && data.routes?.length) {
        const leg = data.routes[0]!.legs[0]!;
        return {
          distanceKm:      Math.round(leg.distance.value / 100) / 10,
          durationSeconds: leg.duration.value,
          source: "google",
        };
      }
      return buildHaversineFallback(haversine);
    }

    if (routingProvider === "mapbox") {
      const mapboxKey = s["mapbox_api_key"];
      if (!mapboxKey) return buildHaversineFallback(haversine);
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${lng1},${lat1};${lng2},${lat2}?access_token=${mapboxKey}&overview=false`;
      const raw  = await fetch(url, { signal: AbortSignal.timeout(4000) });
      const data = await raw.json() as { routes?: Array<{ distance: number; duration: number }> };
      if (data.routes?.length) {
        return {
          distanceKm:      Math.round(data.routes[0]!.distance / 100) / 10,
          durationSeconds: Math.round(data.routes[0]!.duration),
          source: "mapbox",
        };
      }
      return buildHaversineFallback(haversine);
    }

    if (routingProvider === "osrm") {
      /* OSRM — open-source routing engine, no API key required.
       * Uses the configurable base URL (defaults to public demo server).
       * Format: /route/v1/driving/{lng1},{lat1};{lng2},{lat2} */
      const osrmBase = (s["osrm_base_url"]?.trim() || "https://router.project-osrm.org").replace(/\/$/, "");
      const url = `${osrmBase}/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false&steps=false`;
      const raw  = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const data = await raw.json() as { code?: string; routes?: Array<{ distance: number; duration: number }> };
      if (data.code === "Ok" && data.routes?.length) {
        return {
          distanceKm:      Math.round(data.routes[0]!.distance / 100) / 10,
          durationSeconds: Math.round(data.routes[0]!.duration),
          source: "osrm",
        };
      }
      return buildHaversineFallback(haversine);
    }

    return buildHaversineFallback(haversine);
  } catch {
    return buildHaversineFallback(haversine);
  }
}

/**
 * Plain haversine fallback — no terrain multiplier applied.
 * Used only when no routing API is configured or reachable.
 */
function buildHaversineFallback(
  haversineKm: number,
): { distanceKm: number; durationSeconds: number; source: "osrm" | "haversine" } {
  return { distanceKm: haversineKm, durationSeconds: Math.round((haversineKm / 45) * 3600), source: "haversine" };
}

/**
 * Maps a runtime ride service key (e.g. "bike", "car", "rickshaw", "daba") to
 * the Maps Management fare category key (e.g. "ride", "delivery", "parcel").
 *
 * The Maps Management admin UI exposes three coarse-grained categories:
 *   - "ride"     → all passenger/transport service types (bike, car, rickshaw, daba, …)
 *   - "delivery" → food delivery, mart, package delivery service types
 *   - "parcel"   → parcel/courier service types
 *
 * Service keys that match an exact category name ("delivery", "parcel") map to
 * themselves. All others default to "ride".
 */
function mapServiceTypeToFareCategory(type: string): string {
  const t = type.toLowerCase();
  if (t === "delivery" || t.startsWith("delivery_")) return "delivery";
  if (t === "parcel"   || t.startsWith("parcel_"))   return "parcel";
  return "ride";
}

async function calcFare(distance: number, type: string, durationMinutes = 0): Promise<{ baseFare: number; gstAmount: number; total: number; minFare: number }> {
  if (!isFinite(distance) || distance < 0) {
    throw new RideApiError("Invalid distance: must be a non-negative number", "INVALID_DISTANCE", 422);
  }
  if (!type || typeof type !== "string") {
    throw new RideApiError("Invalid service type: must be a non-empty string", "INVALID_SERVICE_TYPE", 422);
  }

  const s = await getPlatformSettings();

  let baseRate: number, perKm: number, minFare: number, perMinuteRate: number;

  /* Maps Management fare keys take priority over legacy keys and the DB table.
   * The Maps Management UI uses coarse-grained category keys (fare_ride_*, fare_delivery_*,
   * fare_parcel_*) that cover groups of runtime service types (bike/car → "ride", etc.).
   * We check the category key first, then an exact-match key, then legacy keys. */
  const fareCategory = mapServiceTypeToFareCategory(type);
  const mapsBase = s[`fare_${fareCategory}_base_fare`];
  const mapsKm   = s[`fare_${fareCategory}_per_km_rate`];
  const psBase   = s[`ride_${type}_base_fare`];
  const psKm     = s[`ride_${type}_per_km`];
  const psMin    = s[`ride_${type}_min_fare`];
  const psPerMinute = s[`ride_${type}_per_minute_rate`];

  if (mapsBase !== undefined && mapsKm !== undefined) {
    /* Maps Management section values — preferred */
    baseRate      = parseFloat(mapsBase);
    perKm         = parseFloat(mapsKm);
    minFare       = psMin !== undefined ? parseFloat(psMin) : Math.round(parseFloat(mapsBase) * 0.8);
    perMinuteRate = psPerMinute !== undefined ? parseFloat(psPerMinute) : 0;
  } else if (psBase !== undefined && psKm !== undefined && psMin !== undefined) {
    /* Legacy platform-settings ride_{type}_* keys */
    baseRate      = parseFloat(psBase);
    perKm         = parseFloat(psKm);
    minFare       = parseFloat(psMin);
    perMinuteRate = psPerMinute !== undefined ? parseFloat(psPerMinute) : 0;
  } else {
    /* Fall back to the per-service-type DB record */
    const [svc] = await db.select().from(rideServiceTypesTable).where(eq(rideServiceTypesTable.key, type)).limit(1);
    if (!svc) {
      throw new RideApiError(`Unknown ride service type: '${type}'`, "UNKNOWN_SERVICE_TYPE", 422);
    }
    baseRate      = parseFloat(svc.baseFare      ?? "15");
    perKm         = parseFloat(svc.perKm         ?? "8");
    perMinuteRate = parseFloat(svc.perMinuteRate ?? "0");
    minFare       = parseFloat(svc.minFare       ?? "50");
  }

  if (!isFinite(baseRate) || !isFinite(perKm) || !isFinite(minFare)) {
    throw new RideApiError("Fare configuration is invalid for this service type", "INVALID_FARE_CONFIG", 500);
  }

  const safeDuration    = isFinite(durationMinutes) && durationMinutes >= 0 ? durationMinutes : 0;
  const safePerMin      = isFinite(perMinuteRate) && perMinuteRate >= 0 ? perMinuteRate : 0;

  /* Maps Management also exposes per-category surge multipliers (fare_{category}_surge_mult).
   * When set, those take precedence over the global ride_surge_enabled/ride_surge_multiplier. */
  const mapsSurgeMult = s[`fare_${fareCategory}_surge_mult`];
  let surgeMultiplier: number;
  if (mapsSurgeMult !== undefined) {
    const parsed = parseFloat(mapsSurgeMult);
    surgeMultiplier = isFinite(parsed) && parsed > 0 ? parsed : 1;
  } else {
    const surgeEnabled = (s["ride_surge_enabled"] ?? "off") === "on";
    surgeMultiplier = surgeEnabled ? parseFloat(s["ride_surge_multiplier"] ?? "1.5") : 1;
  }

  /* New formula: Base + (Actual_KM × PerKM) + (Total_Minutes × PerMinuteRate) */
  const raw      = Math.round(baseRate + distance * perKm + safeDuration * safePerMin);
  const baseFare = Math.round(Math.max(minFare, raw) * surgeMultiplier);
  const gstEnabled = (s["finance_gst_enabled"] ?? "off") === "on";
  const gstPct     = parseFloat(s["finance_gst_pct"] ?? "17");
  const gstAmount  = gstEnabled ? Math.round((baseFare * gstPct) / 100) : 0;
  const total      = baseFare + gstAmount;
  return { baseFare, gstAmount, total, minFare };
}

const toISO = (v: unknown) => v ? (v instanceof Date ? v.toISOString() : v) : null;
function formatRide(r: Record<string, unknown>) {
  return {
    ...r,
    fare:          parseFloat(String(r.fare         ?? "0")),
    distance:      parseFloat(String(r.distance     ?? "0")),
    offeredFare:   r.offeredFare  ? parseFloat(String(r.offeredFare))  : null,
    counterFare:   r.counterFare  ? parseFloat(String(r.counterFare))  : null,
    bargainRounds: r.bargainRounds ?? 0,
    pickupLat:     r.pickupLat  != null ? parseFloat(String(r.pickupLat))  : null,
    pickupLng:     r.pickupLng  != null ? parseFloat(String(r.pickupLng))  : null,
    dropLat:       r.dropLat    != null ? parseFloat(String(r.dropLat))    : null,
    dropLng:       r.dropLng    != null ? parseFloat(String(r.dropLng))    : null,
    createdAt:     toISO(r.createdAt),
    updatedAt:     toISO(r.updatedAt),
    acceptedAt:    toISO(r.acceptedAt),
    arrivedAt:     toISO(r.arrivedAt),
    startedAt:     toISO(r.startedAt),
    completedAt:   toISO(r.completedAt),
    cancelledAt:   toISO(r.cancelledAt),
    tripOtp:       r.tripOtp  ?? null,
    otpVerified:   r.otpVerified ?? false,
    isParcel:      r.isParcel ?? false,
    receiverName:  r.receiverName  ?? null,
    receiverPhone: r.receiverPhone ?? null,
    packageType:   r.packageType   ?? null,
    /* broadcastExpiresAt lets the client drive its negotiation countdown
       from the server clock rather than a locally-drifting counter. */
    broadcastExpiresAt: toISO(r.expiresAt),
  };
}

router.get("/services", async (_req, res) => {
  await ensureDefaultRideServices();
  const services = await db.select().from(rideServiceTypesTable)
    .where(eq(rideServiceTypesTable.isEnabled, true))
    .orderBy(asc(rideServiceTypesTable.sortOrder));
  sendSuccess(res, {
    services: services.map(s => ({
      id:              s.id,
      key:             s.key,
      name:            s.name,
      nameUrdu:        s.nameUrdu,
      icon:            s.icon,
      description:     s.description,
      color:           s.color,
      baseFare:        parseFloat(s.baseFare       ?? "0"),
      perKm:           parseFloat(s.perKm         ?? "0"),
      perMinuteRate:   parseFloat(s.perMinuteRate ?? "0"),
      minFare:         parseFloat(s.minFare       ?? "0"),
      maxPassengers:   s.maxPassengers,
      allowBargaining: s.allowBargaining,
      sortOrder:       s.sortOrder,
    })),
  });
});

router.get("/stops", async (_req, res) => {
  try { await ensureDefaultLocations(); } catch (err) {
    logger.warn("[rides] ensureDefaultLocations() failed — stops endpoint will serve whatever is currently in the DB:", (err as Error)?.message ?? err);
  }
  const locs = await db.select().from(popularLocationsTable)
    .where(eq(popularLocationsTable.isActive, true))
    .orderBy(asc(popularLocationsTable.sortOrder));
  sendSuccess(res, {
    locations: locs.map(l => ({
      id: l.id, name: l.name, nameUrdu: l.nameUrdu,
      lat: parseFloat(String(l.lat)), lng: parseFloat(String(l.lng)),
      category: l.category, icon: l.icon,
    })),
  });
});

router.post("/estimate", estimateLimiter, async (req, res) => {
  const parsed = estimateSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    sendError(res, msg, 422); return;
  }
  const { pickupLat, pickupLng, dropLat, dropLng, type } = parsed.data;
  try {
    const serviceType = type || "bike";
    const { distanceKm, durationSeconds, source } = await getRoadDistanceKm(pickupLat, pickupLng, dropLat, dropLng);
    const s = await getPlatformSettings();

    /* Enforce max-radius in the estimate response as well, so the client gets
     * early feedback before attempting a full booking.
     * Use the Maps Management category key (fare_ride_*, etc.) via the category mapping. */
    const estimateFareCategory = mapServiceTypeToFareCategory(serviceType);
    const maxRadiusSetting = s[`fare_${estimateFareCategory}_max_radius_km`] ?? s["ride_max_radius_km"];
    if (maxRadiusSetting !== undefined) {
      const maxRadius = parseFloat(maxRadiusSetting);
      if (isFinite(maxRadius) && maxRadius > 0 && distanceKm > maxRadius) {
        sendErrorWithData(res, `This ride exceeds the maximum allowed distance of ${maxRadius} km for this service type`, { code: "DISTANCE_EXCEEDS_MAX_RADIUS", distanceKm, maxRadiusKm: maxRadius }, 422); return;
      }
    }

    const durationMin = Math.round(durationSeconds / 60);
    const { baseFare, gstAmount, total } = await calcFare(distanceKm, serviceType, durationMin);
    const duration = `${durationMin} min`;
    const bargainEnabled = (s["ride_bargaining_enabled"] ?? "on") === "on";
    const bargainMinPct  = parseFloat(s["ride_bargaining_min_pct"] ?? "70");
    const minOffer       = Math.ceil(total * (bargainMinPct / 100));
    sendSuccess(res, {
      distance:    Math.round(distanceKm * 10) / 10,
      baseFare,
      gstAmount,
      fare:        total,
      duration,
      durationSeconds,
      distanceSource: source,
      type:        serviceType,
      bargainEnabled,
      minOffer,
    });
  } catch (e: unknown) {
    const status = e instanceof RideApiError ? e.httpStatus : 422;
    const code = e instanceof RideApiError ? e.code : "ESTIMATE_FAILED";
    sendErrorWithData(res, (e as Error).message, { code }, status);
  }
});

router.post("/", customerAuth, bookRideLimiter, async (req, res) => {
  const parsed = bookRideSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    sendError(res, msg, 422); return;
  }

  const userId = req.customerId!;
  const {
    type, pickupAddress, dropAddress,
    pickupLat, pickupLng, dropLat, dropLng,
    paymentMethod, offeredFare, bargainNote,
    isParcel, receiverName, receiverPhone, packageType,
    isScheduled, scheduledAt, stops, isPoolRide,
  } = parsed.data;

  /* Validate scheduled ride time */
  let scheduledAtDate: Date | undefined;
  if (isScheduled && scheduledAt) {
    scheduledAtDate = new Date(scheduledAt);
    const minAdvanceMs = 5 * 60_000;
    if (scheduledAtDate.getTime() - Date.now() < minAdvanceMs) {
      sendError(res, "Scheduled ride must be at least 5 minutes in the future.", 400); return;
    }
    const maxAdvanceDays = 7;
    if (scheduledAtDate.getTime() - Date.now() > maxAdvanceDays * 24 * 60 * 60 * 1000) {
      sendError(res, "Scheduled ride cannot be more than 7 days in advance.", 400); return;
    }
  }

  const existingActive = await db.select({ id: ridesTable.id, status: ridesTable.status })
    .from(ridesTable)
    .where(and(eq(ridesTable.userId, userId), sql`status IN ('searching', 'bargaining', 'accepted', 'arrived', 'in_transit')`))
    .limit(1);
  if (existingActive.length > 0) {
    sendErrorWithData(res, "Aapki ek ride pehle se active hai. Naye ride ke liye pehle wali complete ya cancel karein.", {
      activeRideId: existingActive[0]!.id,
      activeRideStatus: existingActive[0]!.status,
    }, 409);
    return;
  }

  const s = await getPlatformSettings();

  if ((s["app_status"] ?? "active") === "maintenance") {
    const mainKey = (s["security_maintenance_key"] ?? "").trim();
    const bypass  = ((req.headers["x-maintenance-key"] as string) ?? "").trim();
    if (!mainKey || bypass !== mainKey) {
      sendError(res, s["content_maintenance_msg"] ?? "We're performing scheduled maintenance. Back soon!", 503); return;
    }
  }

  const ridesEnabled = (s["feature_rides"] ?? "on") === "on";
  if (!ridesEnabled) { sendError(res, "Ride booking is currently disabled", 503); return; }

  /* ── Geofence: check pickup + drop coords are inside a configured service zone ── */
  if ((s["security_geo_fence"] ?? "off") === "on") {
    const pickupCheck = await isInServiceZone(pickupLat, pickupLng, "rides");
    if (!pickupCheck.allowed) {
      sendError(res, "Pickup location is outside our service area. We currently only operate in configured service zones.", 422); return;
    }
    const dropCheck = await isInServiceZone(dropLat, dropLng, "rides");
    if (!dropCheck.allowed) {
      sendError(res, "Drop location is outside our service area. We currently only operate in configured service zones.", 422); return;
    }
  }

  if (Math.abs(pickupLat - dropLat) < 0.0001 && Math.abs(pickupLng - dropLng) < 0.0001) {
    sendValidationError(res, "Pickup and drop locations cannot be the same"); return;
  }

  let distance: number;
  let baseFare: number, gstAmount: number, platformFare: number, serviceMinFare: number;
  try {
    const routeResult = await getRoadDistanceKm(pickupLat, pickupLng, dropLat, dropLng);
    distance = routeResult.distanceKm;

    /* Enforce max-radius from Maps Management (fare_{category}_max_radius_km).
     * Prevents bookings where the road distance exceeds the configured service area limit.
     * Uses the Maps Management category key via mapServiceTypeToFareCategory. */
    const bookingFareCategory = mapServiceTypeToFareCategory(type);
    const maxRadiusSetting = s[`fare_${bookingFareCategory}_max_radius_km`] ?? s["ride_max_radius_km"];
    if (maxRadiusSetting !== undefined) {
      const maxRadius = parseFloat(maxRadiusSetting);
      if (isFinite(maxRadius) && maxRadius > 0 && distance > maxRadius) {
        sendErrorWithData(res, `This ride exceeds the maximum allowed distance of ${maxRadius} km for this service type`, { code: "DISTANCE_EXCEEDS_MAX_RADIUS", distanceKm: distance, maxRadiusKm: maxRadius }, 422); return;
      }
    }

    const durationMin = Math.round(routeResult.durationSeconds / 60);
    const fareResult = await calcFare(distance, type, durationMin);
    baseFare = fareResult.baseFare;
    gstAmount = fareResult.gstAmount;
    platformFare = fareResult.total;
    serviceMinFare = fareResult.minFare;
  } catch (e: unknown) {
    const status = e instanceof RideApiError ? e.httpStatus : 422;
    const code = e instanceof RideApiError ? e.code : "FARE_CALCULATION_FAILED";
    sendErrorWithData(res, (e as Error).message, { code }, status); return;
  }

  const bargainEnabled  = (s["ride_bargaining_enabled"] ?? "on") === "on";
  const bargainMinPct   = parseFloat(s["ride_bargaining_min_pct"] ?? "70");

  let isBargaining = false;
  let validatedOffer = 0;

  if (offeredFare !== undefined && bargainEnabled) {
    validatedOffer = offeredFare;
    /* Reject fares above the configurable maximum */
    if (validatedOffer > MAX_FARE) {
      sendErrorWithData(res, `Offered fare cannot exceed Rs. ${MAX_FARE}`, { code: "FARE_TOO_HIGH" }, 422); return;
    }
    /* Enforce absolute service min_fare — no offer can go below this regardless of bargaining percentage */
    if (serviceMinFare > 0 && validatedOffer < serviceMinFare) {
      sendErrorWithData(res, `Offered fare cannot be lower than the minimum fare of Rs. ${serviceMinFare.toFixed(0)} for this service`, { code: "FARE_BELOW_MIN" }, 422); return;
    }
    /* Enforce bargaining percentage floor (e.g. 70% of platform fare) */
    const minOffer = Math.ceil(platformFare * (bargainMinPct / 100));
    if (validatedOffer < minOffer) {
      sendErrorWithData(res, `Minimum offer allowed is Rs. ${minOffer} (${bargainMinPct}% of platform fare)`, { code: "FARE_OUT_OF_RANGE" }, 422); return;
    }
    isBargaining = validatedOffer < platformFare;
  }

  const minOnline = parseFloat(s["payment_min_online"] ?? "50");
  const maxOnline = parseFloat(s["payment_max_online"] ?? "100000");
  const effectiveFare = isBargaining ? validatedOffer : platformFare;
  if (paymentMethod === "wallet" && (effectiveFare < minOnline || effectiveFare > maxOnline)) {
    sendValidationError(res, `Wallet payment must be between Rs. ${minOnline} and Rs. ${maxOnline}`); return;
  }

  if (paymentMethod === "wallet") {
    const [wUser] = await db.select({ blockedServices: usersTable.blockedServices }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (wUser && (wUser.blockedServices || "").split(",").map(sv => sv.trim()).includes("wallet")) {
      sendForbidden(res, "wallet_frozen", "Your wallet has been temporarily frozen. Contact support."); return;
    }
  }

  if (paymentMethod === "cash") {
    const riderCashAllowed = (s["rider_cash_allowed"] ?? "on") === "on";
    if (!riderCashAllowed) {
      sendValidationError(res, "Cash payment is currently not available for rides. Please use wallet."); return;
    }
  }

  const rideStatus = isBargaining ? "bargaining" : "searching";
  const fareToCharge = isBargaining ? validatedOffer : platformFare;
  const fareToStore  = platformFare.toFixed(2);

  const POOL_RADIUS_DEG = 0.005;
  const MAX_POOL_SIZE = 3;
  const POOL_WINDOW_MIN = 20;

  try {
    let rideRecord: typeof ridesTable.$inferSelect;

    if (paymentMethod === "wallet" && !isBargaining) {
      const walletEnabled = (s["feature_wallet"] ?? "on") === "on";
      if (!walletEnabled) { sendValidationError(res, "Wallet payments are currently disabled"); return; }

      rideRecord = await db.transaction(async (tx) => {
        /* Lock the user row first — this serializes ALL concurrent booking attempts
           for the same user. Without this lock, two simultaneous requests can both
           pass the active-ride check (SELECT ... FOR UPDATE only locks existing rows;
           it cannot prevent a concurrent INSERT when the result set is empty). */
        await tx.select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .for("update")
          .limit(1);

        /* Now check for active ride — safe because user row is locked above */
        const [activeConflict] = await tx.select({ id: ridesTable.id, status: ridesTable.status })
          .from(ridesTable)
          .where(and(eq(ridesTable.userId, userId), sql`status IN ('searching', 'bargaining', 'accepted', 'arrived', 'in_transit')`))
          .limit(1);
        if (activeConflict) {
          throw new RideApiError("Aapki ek ride pehle se active hai. Naye ride ke liye pehle wali complete ya cancel karein.", "ACTIVE_RIDE_EXISTS", 409);
        }

        /* Debt check — inside lock so no concurrent booking can sneak past */
        const [lockedUser] = await tx.select({ cancellationDebt: usersTable.cancellationDebt })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1);
        const debtAmt = parseFloat(lockedUser?.cancellationDebt ?? "0");
        if (debtAmt > 0) {
          throw new RideApiError(
            `You have an outstanding cancellation fee debt of Rs. ${debtAmt.toFixed(0)}. Please clear your debt before booking a new ride.`,
            "DEBT_OUTSTANDING", 402,
          );
        }

        const [deducted] = await tx.update(usersTable)
          .set({ walletBalance: sql`wallet_balance - ${fareToCharge.toFixed(2)}` })
          .where(and(eq(usersTable.id, userId), gte(usersTable.walletBalance, fareToCharge.toFixed(2))))
          .returning({ id: usersTable.id, walletBalance: usersTable.walletBalance });
        if (!deducted) throw new RideApiError(`Insufficient wallet balance. Required: Rs. ${fareToCharge.toFixed(0)}`, "INSUFFICIENT_BALANCE", 402);
        // NOTE: ride.id is unknown at this point; we patch the reference after insertion
        const rideId = generateId();
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId, type: "debit",
          amount: fareToCharge.toFixed(2),
          description: `${type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ")} ride payment`,
          reference: `ride:${rideId}`,
        });
        let resolvedPoolGroupId: string | undefined;
        if (isPoolRide && !isScheduled) {
          const windowStart = new Date(Date.now() - POOL_WINDOW_MIN * 60_000);
          const existingPools = await tx.select({ poolGroupId: ridesTable.poolGroupId, id: ridesTable.id })
            .from(ridesTable)
            .where(and(
              eq(ridesTable.isPoolRide, true), eq(ridesTable.type, type),
              sql`status IN ('searching', 'bargaining')`, sql`pool_group_id IS NOT NULL`,
              sql`created_at >= ${windowStart.toISOString()}`,
              sql`ABS(CAST(pickup_lat AS FLOAT) - ${pickupLat}) < ${POOL_RADIUS_DEG}`,
              sql`ABS(CAST(pickup_lng AS FLOAT) - ${pickupLng}) < ${POOL_RADIUS_DEG}`,
              sql`ABS(CAST(drop_lat AS FLOAT) - ${dropLat}) < ${POOL_RADIUS_DEG}`,
              sql`ABS(CAST(drop_lng AS FLOAT) - ${dropLng}) < ${POOL_RADIUS_DEG}`,
            )).for("update").limit(10);
          if (existingPools.length > 0) {
            const groupIds = [...new Set(existingPools.map(r => r.poolGroupId).filter(Boolean))] as string[];
            for (const gid of groupIds) {
              const [countRow] = await tx.select({ c: count() }).from(ridesTable)
                .where(and(eq(ridesTable.poolGroupId, gid), sql`status IN ('searching', 'bargaining')`));
              if ((countRow?.c ?? 0) < MAX_POOL_SIZE) { resolvedPoolGroupId = gid; break; }
            }
          }
          if (!resolvedPoolGroupId) resolvedPoolGroupId = generateId();
        }

        const scheduledStatus = isScheduled ? "scheduled" : rideStatus;
        const [ride] = await tx.insert(ridesTable).values({
          id: rideId, userId, type, status: scheduledStatus,
          pickupAddress, dropAddress,
          pickupLat: String(pickupLat), pickupLng: String(pickupLng),
          dropLat: String(dropLat), dropLng: String(dropLng),
          fare: fareToStore, distance: (Math.round(distance * 10) / 10).toString(), paymentMethod,
          offeredFare: null, counterFare: null, bargainStatus: null, bargainRounds: 0,
          isParcel: isParcel ?? false,
          receiverName: receiverName || null,
          receiverPhone: receiverPhone || null,
          packageType: packageType || null,
          isScheduled: isScheduled ?? false,
          scheduledAt: scheduledAtDate ?? null,
          stops: stops ? stops : null,
          isPoolRide: isPoolRide ?? false,
          poolGroupId: resolvedPoolGroupId ?? null,
        }).returning();
        return ride!;
      });
    } else {
      rideRecord = await db.transaction(async (tx) => {
        await tx.select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .for("update")
          .limit(1);

        const [activeConflict] = await tx.select({ id: ridesTable.id })
          .from(ridesTable)
          .where(and(eq(ridesTable.userId, userId), sql`status IN ('searching', 'bargaining', 'accepted', 'arrived', 'in_transit')`))
          .limit(1);
        if (activeConflict) {
          throw new RideApiError("Aapki ek ride pehle se active hai. Naye ride ke liye pehle wali complete ya cancel karein.", "ACTIVE_RIDE_EXISTS", 409);
        }

        const [lockedUser] = await tx.select({ cancellationDebt: usersTable.cancellationDebt, walletBalance: usersTable.walletBalance })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1);
        const debtAmt = parseFloat(lockedUser?.cancellationDebt ?? "0");
        if (debtAmt > 0) {
          throw new RideApiError(
            `You have an outstanding cancellation fee debt of Rs. ${debtAmt.toFixed(0)}. Please clear your debt before booking a new ride.`,
            "DEBT_OUTSTANDING", 402,
          );
        }

        const rideId = generateId();

        if (paymentMethod === "wallet" && isBargaining) {
          const balance = parseFloat(lockedUser?.walletBalance ?? "0");
          if (balance < fareToCharge) {
            throw new RideApiError(`Insufficient wallet balance. Required: Rs. ${fareToCharge.toFixed(0)}, Available: Rs. ${balance.toFixed(0)}`, "INSUFFICIENT_BALANCE", 402);
          }
          const walletEnabled = (s["feature_wallet"] ?? "on") === "on";
          if (!walletEnabled) throw new RideApiError("Wallet payments are currently disabled", "WALLET_DISABLED", 503);
          const [reserved] = await tx.update(usersTable)
            .set({ walletBalance: sql`wallet_balance - ${fareToCharge.toFixed(2)}` })
            .where(and(eq(usersTable.id, userId), gte(usersTable.walletBalance, fareToCharge.toFixed(2))))
            .returning({ id: usersTable.id });
          if (!reserved) throw new RideApiError(`Insufficient wallet balance. Required: Rs. ${fareToCharge.toFixed(0)}`, "INSUFFICIENT_BALANCE", 402);
          await tx.insert(walletTransactionsTable).values({
            id: generateId(), userId, type: "debit",
            amount: fareToCharge.toFixed(2),
            description: `${type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ")} ride reservation (bargain)`,
            reference: `ride:${rideId}`,
          });
        }

        let resolvedPoolGroupId: string | undefined;
        if (isPoolRide && !isBargaining && !isScheduled) {
          const windowStart = new Date(Date.now() - POOL_WINDOW_MIN * 60_000);
          const existingPools = await tx.select({ poolGroupId: ridesTable.poolGroupId, id: ridesTable.id })
            .from(ridesTable)
            .where(and(
              eq(ridesTable.isPoolRide, true), eq(ridesTable.type, type),
              sql`status IN ('searching', 'bargaining')`, sql`pool_group_id IS NOT NULL`,
              sql`created_at >= ${windowStart.toISOString()}`,
              sql`ABS(CAST(pickup_lat AS FLOAT) - ${pickupLat}) < ${POOL_RADIUS_DEG}`,
              sql`ABS(CAST(pickup_lng AS FLOAT) - ${pickupLng}) < ${POOL_RADIUS_DEG}`,
              sql`ABS(CAST(drop_lat AS FLOAT) - ${dropLat}) < ${POOL_RADIUS_DEG}`,
              sql`ABS(CAST(drop_lng AS FLOAT) - ${dropLng}) < ${POOL_RADIUS_DEG}`,
            )).for("update").limit(10);
          if (existingPools.length > 0) {
            const groupIds = [...new Set(existingPools.map(r => r.poolGroupId).filter(Boolean))] as string[];
            for (const gid of groupIds) {
              const [countRow] = await tx.select({ c: count() }).from(ridesTable)
                .where(and(eq(ridesTable.poolGroupId, gid), sql`status IN ('searching', 'bargaining')`));
              if ((countRow?.c ?? 0) < MAX_POOL_SIZE) { resolvedPoolGroupId = gid; break; }
            }
          }
          if (!resolvedPoolGroupId) resolvedPoolGroupId = generateId();
        }

        const scheduledStatus2 = isScheduled ? "scheduled" : rideStatus;
        const [ride] = await tx.insert(ridesTable).values({
          id: rideId, userId, type, status: scheduledStatus2,
          pickupAddress, dropAddress,
          pickupLat: String(pickupLat), pickupLng: String(pickupLng),
          dropLat: String(dropLat), dropLng: String(dropLng),
          fare: fareToStore, distance: (Math.round(distance * 10) / 10).toString(), paymentMethod,
          offeredFare:   isBargaining ? validatedOffer.toFixed(2) : null,
          counterFare:   null,
          bargainStatus: isBargaining ? "customer_offered" : null,
          bargainRounds: isBargaining ? 1 : 0,
          bargainNote:   bargainNote || null,
          isParcel: isParcel ?? false,
          receiverName: receiverName || null,
          receiverPhone: receiverPhone || null,
          packageType: packageType || null,
          isScheduled: isScheduled ?? false,
          scheduledAt: scheduledAtDate ?? null,
          stops: stops ? stops : null,
          isPoolRide: isPoolRide ?? false,
          poolGroupId: resolvedPoolGroupId ?? null,
        }).returning();
        return ride!;
      });
    }

    const bookLang = await getUserLanguage(userId);
    const bookTitle = isBargaining
      ? t("notifRideOfferSent", bookLang) + " 💬"
      : t("notifRideBooked", bookLang);
    const bookBody = isBargaining
      ? t("notifRideOfferBody", bookLang).replace("{fare}", String(validatedOffer))
      : t("notifRideBookedBody", bookLang).replace("{fare}", fareToCharge.toFixed(0));
    await db.insert(notificationsTable).values({
      id: generateId(), userId,
      title: bookTitle,
      body: bookBody,
      type: "ride", icon: ({ bike: "bicycle-outline", car: "car-outline", rickshaw: "car-outline", daba: "bus-outline", school_shift: "bus-outline" } as Record<string, string>)[type] ?? "car-outline", link: `/ride`,
    }).catch(() => {});

    if (rideRecord && !isScheduled) {
      broadcastRide(rideRecord.id);
      emitRideDispatchUpdate({ rideId: rideRecord.id, action: "new", status: rideRecord.status });
      emitRideUpdate(rideRecord.id);
    } else if (rideRecord && isScheduled) {
      emitRideDispatchUpdate({ rideId: rideRecord.id, action: "new", status: "scheduled" });
      emitRideUpdate(rideRecord.id);
    }

    sendCreated(res, {
      ...formatRide(rideRecord),
      baseFare, gstAmount,
      platformFare, effectiveFare: fareToCharge,
      isBargaining,
      isScheduled: !!isScheduled,
      scheduledAt: scheduledAtDate?.toISOString() ?? null,
    });
  } catch (e: unknown) {
    const status = e instanceof RideApiError ? e.httpStatus : 400;
    const code = e instanceof RideApiError ? e.code : "BOOKING_FAILED";
    sendErrorWithData(res, (e as Error).message, { code }, status);
  }
});

router.patch("/:id/cancel", customerAuth, cancelRideLimiter, requireRideState(["searching", "bargaining", "accepted", "arrived"]), requireRideOwner("userId"), async (req, res) => {
  const userId = req.customerId!;
  const ride = req.ride!;
  const cancelParsed = cancelRideSchema.safeParse(req.body ?? {});
  if (!cancelParsed.success) {
    const msg = cancelParsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    sendError(res, msg, 422); return;
  }
  const cancelReason = cancelParsed.data.reason ?? null;

  await cleanupNotifiedRiders(String(req.params["id"]));
  const s = await getPlatformSettings();
  const cancelFee = parseFloat(s["ride_cancellation_fee"] ?? "30");
  const riderAssigned = ["accepted", "arrived", "in_transit"].includes(ride.status);

  let actualCancelFee = 0;
  let cancelFeeAsDebt = false;

  // Determine if a wallet debit was actually made for this ride.
  // All wallet-paid rides (direct booking and bargain accept-bid) record
  // a debit with reference "ride:<id>" — check that authoritatively.
  let walletNetDebit = 0;
  if (ride.paymentMethod === "wallet") {
    const rideRef = `ride:${ride.id}`;
    const txns = await db.select({ type: walletTransactionsTable.type, amount: walletTransactionsTable.amount })
      .from(walletTransactionsTable)
      .where(and(
        eq(walletTransactionsTable.userId, userId),
        eq(walletTransactionsTable.reference, rideRef),
      ));
    for (const t of txns) {
      const amt = parseFloat(t.amount);
      if (t.type === "debit") walletNetDebit += amt;
      else if (t.type === "credit") walletNetDebit -= amt;
    }
  }

  const cancelResult = await db.transaction(async (tx) => {
    const [upd] = await tx.update(ridesTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(ridesTable.id, String(req.params["id"])), eq(ridesTable.userId, userId)))
      .returning();

    await tx.update(rideBidsTable)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(and(eq(rideBidsTable.rideId, String(req.params["id"])), eq(rideBidsTable.status, "pending")));

    if (walletNetDebit > 0) {
      await tx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance + ${walletNetDebit.toFixed(2)}`, updatedAt: new Date() })
        .where(eq(usersTable.id, userId));
      await tx.insert(walletTransactionsTable).values({
        id: generateId(), userId, type: "credit", amount: walletNetDebit.toFixed(2),
        description: `Ride refund — #${ride.id.slice(-6).toUpperCase()} cancelled`,
        reference: `ride:${ride.id}`,
      });
    }

    if (riderAssigned && cancelFee > 0) {
      const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (user) {
        const balance = parseFloat(user.walletBalance ?? "0");
        if (balance >= cancelFee) {
          const [feeDeducted] = await tx.update(usersTable)
            .set({ walletBalance: sql`wallet_balance - ${cancelFee.toFixed(2)}` })
            .where(and(eq(usersTable.id, userId), gte(usersTable.walletBalance, cancelFee.toFixed(2))))
            .returning({ id: usersTable.id });
          if (feeDeducted) {
            actualCancelFee = cancelFee;
            await tx.insert(walletTransactionsTable).values({
              id: generateId(), userId, type: "debit",
              amount: cancelFee.toFixed(2),
              description: `Ride cancellation fee — #${ride.id.slice(-6).toUpperCase()}`,
            });
          } else {
            cancelFeeAsDebt = true;
          }
        } else if (balance > 0) {
          actualCancelFee = balance;
          cancelFeeAsDebt = true;
          await tx.update(usersTable)
            .set({ walletBalance: "0" })
            .where(eq(usersTable.id, userId));
          await tx.insert(walletTransactionsTable).values({
            id: generateId(), userId, type: "debit",
            amount: balance.toFixed(2),
            description: `Ride cancellation fee (partial, Rs.${(cancelFee - balance).toFixed(0)} as debt) — #${ride.id.slice(-6).toUpperCase()}`,
          });
        } else {
          cancelFeeAsDebt = true;
        }
      }
    }

    if (cancelFeeAsDebt) {
      const remainingDebt = cancelFee - actualCancelFee;
      await tx.update(usersTable)
        .set({ cancellationDebt: sql`cancellation_debt + ${remainingDebt}`, updatedAt: new Date() })
        .where(eq(usersTable.id, userId));
    }

    return upd;
  });

  const [postCancelUser] = await db.select({ walletBalance: usersTable.walletBalance }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (postCancelUser) broadcastWalletUpdate(userId, parseFloat(postCancelUser.walletBalance ?? "0"));

  const cancelLang = await getUserLanguage(userId);
  if (walletNetDebit > 0) {
    const refundAmt = walletNetDebit;
    await db.insert(notificationsTable).values({
      id: generateId(), userId,
      title: t("notifWalletCredited", cancelLang) + " 💰",
      body: actualCancelFee > 0
        ? t("notifRideRefundWithFeeBody", cancelLang).replace("{refund}", refundAmt.toFixed(0)).replace("{fee}", String(actualCancelFee))
        : t("notifRideRefundBody", cancelLang).replace("{refund}", refundAmt.toFixed(0)),
      type: "ride", icon: "wallet-outline",
    }).catch(() => {});
  } else if (ride.status === "bargaining" || ride.bargainStatus === "customer_offered") {
    await db.insert(notificationsTable).values({
      id: generateId(), userId,
      title: t("notifRideOfferSent", cancelLang),
      body: t("notifRideCancelledBody", cancelLang),
      type: "ride", icon: "close-circle-outline",
    }).catch(() => {});
  } else {
    await db.insert(notificationsTable).values({
      id: generateId(), userId,
      title: t("notifRideCancelled", cancelLang),
      body: riderAssigned && cancelFee > 0
        ? (cancelFeeAsDebt
            ? t("notifRideCancelledFeeDebtBody" as TranslationKey, cancelLang).replace("{fee}", String(cancelFee))
            : t("notifRideCancelledFeeBody" as TranslationKey, cancelLang).replace("{fee}", String(cancelFee)))
        : t("notifRideCancelledBody", cancelLang),
      type: "ride", icon: "close-circle-outline",
    }).catch(() => {});
  }

  if (cancelReason) {
    req.log?.info({ rideId: ride.id, cancelReason }, "Ride cancelled with reason");
  }

  emitRideDispatchUpdate({ rideId: ride.id, action: "cancel", status: "cancelled" });
  emitRideUpdate(ride.id);
  sendSuccess(res, {
    ...formatRide(cancelResult!),
    cancellationFee: actualCancelFee,
    cancelFeeAsDebt,
    cancelReason,
  });
});

router.patch("/:id/accept-bid", customerAuth, async (req, res) => {
  const parsed = acceptBidSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, "bidId required"); return;
  }

  const userId = req.customerId!;
  const { bidId } = parsed.data;
  const rideId = String(req.params["id"]);

  // Block users who accumulated cancellation debt from accepting bids (mirrors the booking check)
  const [debtUserBid] = await db.select({ cancellationDebt: usersTable.cancellationDebt })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const bidDebt = parseFloat(debtUserBid?.cancellationDebt ?? "0");
  if (bidDebt > 0) {
    sendErrorWithData(res, `You have an outstanding cancellation fee debt of Rs. ${bidDebt.toFixed(0)}. Please clear your debt before accepting a ride.`, { debtAmount: bidDebt }, 402);
    return;
  }

  let updated: { rideUpdate: typeof ridesTable.$inferSelect; bid: typeof rideBidsTable.$inferSelect };
  try {
    updated = await db.transaction(async (tx) => {
      const [ride] = await tx.select().from(ridesTable)
        .where(eq(ridesTable.id, rideId))
        .for("update")
        .limit(1);

      if (!ride) throw new RideApiError("Ride not found", "RIDE_NOT_FOUND", 404);
      if (ride.userId !== userId) throw new RideApiError("Not your ride", "RIDE_ACCESS_DENIED", 403);
      if (ride.status !== "bargaining") throw new RideApiError("Ride is not in bargaining state", "RIDE_NOT_BARGAINING", 400);

      const [bid] = await tx.select().from(rideBidsTable)
        .where(and(
          eq(rideBidsTable.id, bidId),
          eq(rideBidsTable.rideId, rideId),
          eq(rideBidsTable.status, "pending"),
          gte(rideBidsTable.expiresAt, new Date()),
        ))
        .limit(1);
      if (!bid) throw new RideApiError("Bid has expired or is no longer pending", "BID_EXPIRED_OR_NOT_FOUND", 404);

      const agreedFare = parseFloat(bid.fare);

      if (ride.paymentMethod === "wallet") {
        const rideRef = `ride:${rideId}`;
        const [existingDebit] = await tx.select({ id: walletTransactionsTable.id, amount: walletTransactionsTable.amount })
          .from(walletTransactionsTable)
          .where(and(
            eq(walletTransactionsTable.userId, userId),
            eq(walletTransactionsTable.type, "debit"),
            eq(walletTransactionsTable.reference, rideRef),
          )).limit(1);

        if (existingDebit) {
          const reservedAmt = parseFloat(existingDebit.amount);
          if (agreedFare > reservedAmt) {
            const diff = agreedFare - reservedAmt;
            const [topUp] = await tx.update(usersTable)
              .set({ walletBalance: sql`wallet_balance - ${diff.toFixed(2)}` })
              .where(and(eq(usersTable.id, userId), gte(usersTable.walletBalance, diff.toFixed(2))))
              .returning({ id: usersTable.id });
            if (!topUp) throw new RideApiError(`Insufficient wallet balance. Need additional Rs. ${diff.toFixed(0)}`, "INSUFFICIENT_BALANCE", 402);
            await tx.insert(walletTransactionsTable).values({
              id: generateId(), userId, type: "debit", amount: diff.toFixed(2),
              description: `Ride fare adjustment (bargained) — #${rideId.slice(-6).toUpperCase()}`,
              reference: rideRef,
            });
          } else if (agreedFare < reservedAmt) {
            const refund = reservedAmt - agreedFare;
            await tx.update(usersTable)
              .set({ walletBalance: sql`wallet_balance + ${refund.toFixed(2)}` })
              .where(eq(usersTable.id, userId));
            await tx.insert(walletTransactionsTable).values({
              id: generateId(), userId, type: "credit", amount: refund.toFixed(2),
              description: `Fare difference refund (bargained) — #${rideId.slice(-6).toUpperCase()}`,
              reference: rideRef,
            });
          }
        } else {
          const [deducted] = await tx.update(usersTable)
            .set({ walletBalance: sql`wallet_balance - ${agreedFare.toFixed(2)}` })
            .where(and(eq(usersTable.id, userId), gte(usersTable.walletBalance, agreedFare.toFixed(2))))
            .returning({ id: usersTable.id });
          if (!deducted) throw new RideApiError(`Insufficient wallet balance. Need Rs. ${agreedFare.toFixed(0)}`, "INSUFFICIENT_BALANCE", 402);
          await tx.insert(walletTransactionsTable).values({
            id: generateId(), userId, type: "debit", amount: agreedFare.toFixed(2),
            description: `Ride payment (bargained) — #${rideId.slice(-6).toUpperCase()}`,
            reference: rideRef,
          });
        }
      }

      const [rideUpdate] = await tx.update(ridesTable)
        .set({
          status:        "accepted",
          riderId:       bid.riderId,
          riderName:     bid.riderName,
          riderPhone:    bid.riderPhone,
          fare:          agreedFare.toFixed(2),
          counterFare:   agreedFare.toFixed(2),
          bargainStatus: "agreed",
          acceptedAt:    new Date(),
          updatedAt:     new Date(),
        })
        .where(and(eq(ridesTable.id, rideId), eq(ridesTable.userId, userId), eq(ridesTable.status, "bargaining")))
        .returning();

      if (!rideUpdate) throw new RideApiError("Ride is no longer available for acceptance", "RIDE_UNAVAILABLE", 409);

      const bidUpdateResult = await tx.update(rideBidsTable)
        .set({ status: "accepted", updatedAt: new Date() })
        .where(and(eq(rideBidsTable.id, bidId), eq(rideBidsTable.status, "pending")))
        .returning();

      if (bidUpdateResult.length === 0) throw new RideApiError("Bid is no longer available", "BID_UNAVAILABLE", 409);

      await tx.update(rideBidsTable)
        .set({ status: "rejected", updatedAt: new Date() })
        .where(and(eq(rideBidsTable.rideId, rideId), eq(rideBidsTable.status, "pending"), ne(rideBidsTable.id, bidId)));

      return { rideUpdate, bid };
    });
  } catch (e: unknown) {
    const status = e instanceof RideApiError ? e.httpStatus : 400;
    const code = e instanceof RideApiError ? e.code : "ACCEPT_BID_FAILED";
    if (!(e instanceof RideApiError)) {
      logger.error({ err: e, rideId, bidId }, "[accept-bid] unexpected error during bid acceptance transaction");
    }
    sendErrorWithData(res, (e as Error).message, { code }, status);
    return;
  }

  const { rideUpdate, bid } = updated;
  const agreedFare = parseFloat(bid.fare);

  /* Generate OTP for trip start and persist it */
  const otp = generateOtp();
  await db.update(ridesTable).set({ tripOtp: otp, updatedAt: new Date() }).where(eq(ridesTable.id, rideUpdate!.id)).catch(() => {});
  emitRideOtp(rideUpdate!.userId, rideUpdate!.id, otp);

  const bidLang = await getUserLanguage(bid.riderId);
  await db.insert(notificationsTable).values({
    id: generateId(), userId: bid.riderId,
    title: t("notifRideAccepted", bidLang) + " 🎉",
    body: t("notifRideAcceptedBody", bidLang).replace("{fare}", agreedFare.toFixed(0)),
    type: "ride", icon: "checkmark-circle-outline",
  }).catch(() => {});
  sendPushToUser(bid.riderId, {
    title: "Offer Accepted! 🎉",
    body: `Your offer of Rs. ${agreedFare.toFixed(0)} was accepted. Head to the pickup point now.`,
    tag: `offer-accepted-${rideUpdate!.id}`,
    data: { rideId: rideUpdate!.id },
  }).catch(() => {});

  emitRideDispatchUpdate({ rideId: rideUpdate!.id, action: "accepted", status: "accepted" });
  emitRideUpdate(rideUpdate!.id);
  sendSuccess(res, { ...formatRide(rideUpdate!), agreedFare, tripOtp: otp });
});

router.patch("/:id/customer-counter", bargainLimiter, customerAuth, requireRideState(["bargaining"]), requireRideOwner("userId"), async (req, res) => {
  const parsed = customerCounterSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    sendError(res, msg, 422); return;
  }

  const ride = req.ride!;
  const rideId = ride.id;
  const userId = req.customerId!;
  const { offeredFare: newOffer, note } = parsed.data;

  const s = await getPlatformSettings();
  const bargainMinPct = parseFloat(s["ride_bargaining_min_pct"] ?? "70");
  const platformFare  = parseFloat(ride.fare);

  /* Enforce absolute service min_fare floor (matches booking + rider-counter logic). */
  const psMin = s[`ride_${ride.type}_min_fare`];
  let serviceMinFare = psMin ? parseFloat(psMin) : 0;
  if (!serviceMinFare || !isFinite(serviceMinFare)) {
    const [svc] = await db.select({ minFare: rideServiceTypesTable.minFare })
      .from(rideServiceTypesTable).where(eq(rideServiceTypesTable.key, ride.type)).limit(1);
    serviceMinFare = svc ? parseFloat(svc.minFare ?? "0") : 0;
  }
  if (serviceMinFare > 0 && newOffer < serviceMinFare) {
    sendErrorWithData(res, `Offered fare cannot be lower than the minimum fare of Rs. ${serviceMinFare.toFixed(0)} for this service`, { code: "FARE_BELOW_MIN" }, 422); return;
  }

  const minOffer = Math.ceil(platformFare * (bargainMinPct / 100));
  if (newOffer < minOffer) {
    sendErrorWithData(res, `Minimum offer is Rs. ${minOffer} (${bargainMinPct}% of platform fare)`, { code: "FARE_OUT_OF_RANGE" }, 422); return;
  }

  await db.update(rideBidsTable)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(eq(rideBidsTable.rideId, rideId), eq(rideBidsTable.status, "pending")));

  const currentRounds = ride.bargainRounds ?? 0;
  const [updated] = await db.update(ridesTable)
    .set({
      offeredFare:   newOffer.toFixed(2),
      counterFare:   null,
      bargainStatus: "customer_offered",
      bargainRounds: currentRounds + 1,
      bargainNote:   note || ride.bargainNote,
      status:        "bargaining",
      riderId:       null,
      riderName:     null,
      riderPhone:    null,
      updatedAt:     new Date(),
    })
    .where(and(eq(ridesTable.id, rideId), eq(ridesTable.userId, userId)))
    .returning();

  emitRideUpdate(rideId);
  sendSuccess(res, formatRide(updated!));
});

router.get("/history", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const rides = await db.select().from(ridesTable)
    .where(and(
      eq(ridesTable.userId, userId),
      sql`status IN ('completed', 'cancelled', 'dropped_off')`
    ))
    .orderBy(ridesTable.createdAt);

  const formatted = await Promise.all(rides.map(async (r) => {
    const base = formatRide(r);
    let fareBreakdown: { baseFare: number; gstAmount: number } | null = null;
    if (r.distance && r.type) {
      try {
        const computed = await calcFare(parseFloat(String(r.distance)), r.type);
        fareBreakdown = { baseFare: computed.baseFare, gstAmount: computed.gstAmount };
      } catch {
        /* Non-critical: fare breakdown enrichment — omitted if calc fails */
      }
    }
    return { ...base, fareBreakdown };
  }));

  sendSuccess(res, {
    rides: formatted.reverse(),
    total: formatted.length,
  });
});

router.get("/", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const statusFilter = req.query["status"] as string | undefined;

  const baseQuery = db.select().from(ridesTable);
  const rides = await (statusFilter === "active"
    ? baseQuery.where(and(eq(ridesTable.userId, userId), sql`status IN ('searching', 'bargaining', 'accepted', 'arrived', 'in_transit')`))
    : baseQuery.where(eq(ridesTable.userId, userId)).orderBy(ridesTable.createdAt)
  );

  const formatted = await Promise.all(rides.map(async (r) => {
    const base = formatRide(r);
    let fareBreakdown: { baseFare: number; gstAmount: number } | null = null;
    if (r.distance && r.type && ["completed", "dropped_off"].includes(r.status) && statusFilter !== "active") {
      try {
        const computed = await calcFare(parseFloat(String(r.distance)), r.type);
        fareBreakdown = { baseFare: computed.baseFare, gstAmount: computed.gstAmount };
      } catch {
        /* Non-critical: fare breakdown enrichment on list view — omitted if calc fails */
      }
    }
    return { ...base, fareBreakdown };
  }));

  const result = statusFilter === "active" ? formatted : formatted.reverse();
  sendSuccess(res, {
    rides: result,
    total: result.length,
  });
});

router.get("/payment-methods", async (_req, res) => {
  const s = await getPlatformSettings();
  const rideAllowed = (newKey: string, legacyKey: string, legacyDefault: string): boolean => {
    if (s[newKey] !== undefined) return s[newKey] === "on";
    return (s[legacyKey] ?? legacyDefault) === "on";
  };
  const methods: { key: string; label: string; enabled: boolean }[] = [
    { key: "cash",      label: "Cash",      enabled: rideAllowed("cod_allowed_rides", "ride_payment_cash", "on") && (s["cod_enabled"] ?? "on") === "on" && (s["rider_cash_allowed"] ?? "on") === "on" },
    { key: "wallet",    label: "Wallet",     enabled: rideAllowed("wallet_allowed_rides", "ride_payment_wallet", "on") && (s["feature_wallet"] ?? "on") === "on" },
    { key: "jazzcash",  label: "JazzCash",   enabled: rideAllowed("jazzcash_allowed_rides", "ride_payment_jazzcash", "off") && (s["jazzcash_enabled"] ?? "off") === "on" },
    { key: "easypaisa", label: "EasyPaisa",  enabled: rideAllowed("easypaisa_allowed_rides", "ride_payment_easypaisa", "off") && (s["easypaisa_enabled"] ?? "off") === "on" },
  ];
  sendSuccess(res, { methods: methods.filter(m => m.enabled) });
});

/* ── Pool group detail ── */
router.get("/pool/:groupId", customerAuth, async (req, res) => {
  const groupId = String(req.params["groupId"]);
  const rides = await db.select({
    id: ridesTable.id, userId: ridesTable.userId,
    pickupAddress: ridesTable.pickupAddress, dropAddress: ridesTable.dropAddress,
    status: ridesTable.status, fare: ridesTable.fare, paymentMethod: ridesTable.paymentMethod,
    stops: ridesTable.stops, createdAt: ridesTable.createdAt,
  }).from(ridesTable).where(eq(ridesTable.poolGroupId, groupId)).orderBy(ridesTable.createdAt);
  sendSuccess(res, { groupId, rides, passengerCount: rides.length });
});

/* ── SSE: max concurrent streams per ride ── */
const _sseCounts = new Map<string, number>();
const SSE_MAX_PER_RIDE = 5;
const SSE_HEARTBEAT_MS = 25_000;

/**
 * Build the full ride payload that matches the GET /:id response shape —
 * including pending bids (with vehicle + rating enrichment), live rider
 * location, rider average rating, and fare breakdown.
 * Used by both the REST endpoint and the SSE stream.
 */
async function buildRideSSEPayload(rideId: string): Promise<Record<string, unknown> | null> {
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
  if (!ride) return null;

  let riderName = ride.riderName;
  let riderPhone = ride.riderPhone;
  if (ride.riderId && !riderName) {
    const [riderUser] = await db.select({ name: usersTable.name, phone: usersTable.phone })
      .from(usersTable).where(eq(usersTable.id, ride.riderId)).limit(1);
    riderName  = riderUser?.name  || null;
    riderPhone = riderUser?.phone || null;
  }

  const bids = ride.status === "bargaining"
    ? await db.select().from(rideBidsTable)
        .where(and(
          eq(rideBidsTable.rideId, rideId),
          eq(rideBidsTable.status, "pending"),
          gte(rideBidsTable.expiresAt, new Date()),
        ))
        .orderBy(rideBidsTable.createdAt)
    : [];

  const formattedBids = await Promise.all(bids.map(async (b) => {
    const [riderUser] = await db.select({
      vehiclePlate: usersTable.vehiclePlate,
      vehicleType:  riderProfilesTable.vehicleType,
    }).from(usersTable)
      .leftJoin(riderProfilesTable, eq(usersTable.id, riderProfilesTable.userId))
      .where(eq(usersTable.id, b.riderId)).limit(1);

    const ratingRows = await db.select({
      starsAvg: sql<string>`AVG(stars)`,
      total:    sql<string>`COUNT(*)`,
    }).from(rideRatingsTable).where(eq(rideRatingsTable.riderId, b.riderId));

    const ratingAvg  = ratingRows[0]?.starsAvg ? Math.round(parseFloat(ratingRows[0].starsAvg) * 10) / 10 : null;
    const totalRides = ratingRows[0]?.total ? parseInt(ratingRows[0].total, 10) : 0;

    return {
      ...b,
      fare:         parseFloat(b.fare),
      vehiclePlate: riderUser?.vehiclePlate ?? null,
      vehicleType:  riderUser?.vehicleType  ?? null,
      ratingAvg,
      totalRides,
      expiresAt:  b.expiresAt instanceof Date ? b.expiresAt.toISOString() : b.expiresAt,
      createdAt: b.createdAt instanceof Date ? b.createdAt.toISOString() : b.createdAt,
      updatedAt: b.updatedAt instanceof Date ? b.updatedAt.toISOString() : b.updatedAt,
    };
  }));

  let riderLat: number | null = null;
  let riderLng: number | null = null;
  let riderLocAge: number | null = null;
  let riderAvgRating: number | null = null;
  const ACTIVE_STATUSES = ["accepted", "arrived", "in_transit"];
  if (ride.riderId) {
    if (ACTIVE_STATUSES.includes(ride.status)) {
      const [loc] = await db.select().from(liveLocationsTable)
        .where(eq(liveLocationsTable.userId, ride.riderId)).limit(1);
      if (loc) {
        riderLat    = parseFloat(String(loc.latitude));
        riderLng    = parseFloat(String(loc.longitude));
        riderLocAge = Math.floor((Date.now() - new Date(loc.updatedAt).getTime()) / 1000);
      }
    }
    const ratingRows = await db.select({ starsAvg: sql<string>`AVG(stars)` })
      .from(rideRatingsTable).where(eq(rideRatingsTable.riderId, ride.riderId));
    riderAvgRating = ratingRows[0]?.starsAvg ? Math.round(parseFloat(ratingRows[0].starsAvg) * 10) / 10 : null;
  }

  let fareBreakdown: { baseFare: number; gstAmount: number } | null = null;
  if (ride.distance && ride.type) {
    try {
      const computed = await calcFare(parseFloat(String(ride.distance)), ride.type);
      fareBreakdown = { baseFare: computed.baseFare, gstAmount: computed.gstAmount };
    } catch {
      /* Non-critical: fare breakdown enrichment on ride detail — omitted if calc fails */
    }
  }

  return { ...formatRide(ride as Record<string, unknown>), riderName, riderPhone, bids: formattedBids, riderLat, riderLng, riderLocAge, riderAvgRating, fareBreakdown };
}

router.get("/:id/stream", customerAuth, async (req, res) => {
  const callerId = req.customerId!;
  const rideId = String(req.params["id"]);

  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
  if (!ride) { sendNotFound(res, "Ride not found"); return; }

  /* Allow ride owner (customer) or assigned rider — same as GET /:id */
  const isOwner         = ride.userId  === callerId;
  const isAssignedRider = ride.riderId === callerId;
  if (!isOwner && !isAssignedRider) { sendForbidden(res, "Access denied — not your ride"); return; }

  const current = _sseCounts.get(rideId) ?? 0;
  if (current >= SSE_MAX_PER_RIDE) {
    res.status(429).json({ error: "Too many concurrent streams for this ride" });
    return;
  }
  _sseCounts.set(rideId, current + 1);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  /* Hoist mutable references so cleanup() is safe to call from anywhere,
     including during the very first pushUpdate() before heartbeat/unsub are set. */
  let cleaned = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let unsubscribeFn: (() => void) | null = null;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    if (unsubscribeFn   !== null) unsubscribeFn();
    const n = _sseCounts.get(rideId) ?? 1;
    if (n <= 1) _sseCounts.delete(rideId);
    else _sseCounts.set(rideId, n - 1);
  };

  const pushUpdate = async () => {
    try {
      const payload = await buildRideSSEPayload(rideId);
      if (!payload) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      const status = payload["status"] as string | undefined;
      if (status === "completed" || status === "cancelled") {
        cleanup();
        res.end();
      }
    } catch (err) {
      logger.warn({ err, rideId }, "SSE ride: failed to push update");
    }
  };

  req.on("close", cleanup);

  /* Send current state immediately, then wire up updates + heartbeat.
     Guard against terminal-state on first connect: if pushUpdate() already
     called cleanup() (ride was completed/cancelled before connect), skip
     subscription and timer so no resources are leaked. */
  await pushUpdate();
  if (cleaned) return;
  unsubscribeFn  = onRideUpdate(rideId, () => { pushUpdate().catch(() => {}); });
  heartbeatTimer = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { /* intentionally ignored — client may have disconnected before cleanup fires */ }
  }, SSE_HEARTBEAT_MS);
});

router.get("/:id", customerAuth, async (req, res) => {
  const callerId = req.customerId!;

  const rideId = String(req.params["id"]);
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
  if (!ride) { sendNotFound(res, "Ride not found"); return; }

  const isCustomer = ride.userId  === callerId;
  const isRider    = ride.riderId === callerId;
  if (!isCustomer && !isRider) {
    sendForbidden(res, "Access denied — not your ride"); return;
  }

  let riderName = ride.riderName;
  let riderPhone = ride.riderPhone;
  if (ride.riderId && !riderName) {
    const [riderUser] = await db.select({ name: usersTable.name, phone: usersTable.phone })
      .from(usersTable).where(eq(usersTable.id, ride.riderId)).limit(1);
    riderName  = riderUser?.name  || null;
    riderPhone = riderUser?.phone || null;
  }

  const bids = ride.status === "bargaining"
    ? await db.select().from(rideBidsTable)
        .where(and(
          eq(rideBidsTable.rideId, rideId),
          eq(rideBidsTable.status, "pending"),
          gte(rideBidsTable.expiresAt, new Date()),
        ))
        .orderBy(rideBidsTable.createdAt)
    : [];

  const formattedBids = await Promise.all(bids.map(async (b) => {
    const [riderUser] = await db.select({
      vehiclePlate: usersTable.vehiclePlate,
      vehicleType:  riderProfilesTable.vehicleType,
    }).from(usersTable)
      .leftJoin(riderProfilesTable, eq(usersTable.id, riderProfilesTable.userId))
      .where(eq(usersTable.id, b.riderId)).limit(1);

    const ratingRows = await db.select({
      starsAvg: sql<string>`AVG(stars)`,
      total:    sql<string>`COUNT(*)`,
    }).from(rideRatingsTable).where(eq(rideRatingsTable.riderId, b.riderId));

    const ratingAvg = ratingRows[0]?.starsAvg ? Math.round(parseFloat(ratingRows[0].starsAvg) * 10) / 10 : null;
    const totalRides = ratingRows[0]?.total ? parseInt(ratingRows[0].total, 10) : 0;

    return {
      ...b,
      fare:         parseFloat(b.fare),
      vehiclePlate: riderUser?.vehiclePlate ?? null,
      vehicleType:  riderUser?.vehicleType  ?? null,
      ratingAvg,
      totalRides,
      expiresAt:  b.expiresAt instanceof Date ? b.expiresAt.toISOString() : b.expiresAt,
      createdAt: b.createdAt instanceof Date ? b.createdAt.toISOString() : b.createdAt,
      updatedAt: b.updatedAt instanceof Date ? b.updatedAt.toISOString() : b.updatedAt,
    };
  }));

  let riderLat: number | null = null;
  let riderLng: number | null = null;
  let riderLocAge: number | null = null;
  let riderAvgRating: number | null = null;
  const ACTIVE_STATUSES = ["accepted", "arrived", "in_transit"];
  if (ride.riderId) {
    if (ACTIVE_STATUSES.includes(ride.status)) {
      const [loc] = await db
        .select()
        .from(liveLocationsTable)
        .where(eq(liveLocationsTable.userId, ride.riderId))
        .limit(1);
      if (loc) {
        riderLat    = parseFloat(String(loc.latitude));
        riderLng    = parseFloat(String(loc.longitude));
        riderLocAge = Math.floor((Date.now() - new Date(loc.updatedAt).getTime()) / 1000);
      }
    }
    const ratingRows = await db.select({
      starsAvg: sql<string>`AVG(stars)`,
    }).from(rideRatingsTable).where(eq(rideRatingsTable.riderId, ride.riderId));
    riderAvgRating = ratingRows[0]?.starsAvg ? Math.round(parseFloat(ratingRows[0].starsAvg) * 10) / 10 : null;
  }

  let fareBreakdown: { baseFare: number; gstAmount: number } | null = null;
  if (ride.distance && ride.type) {
    try {
      const computed = await calcFare(parseFloat(String(ride.distance)), ride.type);
      fareBreakdown = { baseFare: computed.baseFare, gstAmount: computed.gstAmount };
    } catch {
      /* Non-critical: fare breakdown enrichment on rider ride detail — omitted if calc fails */
    }
  }

  sendSuccess(res, { ...formatRide(ride), riderName, riderPhone, bids: formattedBids, riderLat, riderLng, riderLocAge, riderAvgRating, fareBreakdown });
});

router.get("/:id/track", customerAuth, async (req, res) => {
  const callerId = req.customerId!;

  const rideId = String(req.params["id"]);
  const [ride] = await db.select({
    id: ridesTable.id, status: ridesTable.status, riderId: ridesTable.riderId,
    userId: ridesTable.userId, pickupLat: ridesTable.pickupLat, pickupLng: ridesTable.pickupLng,
    dropLat: ridesTable.dropLat, dropLng: ridesTable.dropLng,
    pickupAddress: ridesTable.pickupAddress, dropAddress: ridesTable.dropAddress,
  }).from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);

  if (!ride) { sendNotFound(res, "Ride not found"); return; }
  if (ride.userId !== callerId && ride.riderId !== callerId) {
    sendForbidden(res, "Access denied — not your ride"); return;
  }

  let riderLat: number | null = null;
  let riderLng: number | null = null;
  let riderLocAge: number | null = null;
  let etaMinutes: number | null = null;

  // "Active trip" statuses: accepted (rider on way to pickup), arrived, in_transit (en route to drop)
  const TRACKABLE = ["accepted", "arrived", "in_transit"];
  if (ride.riderId && TRACKABLE.includes(ride.status)) {
    const [loc] = await db.select()
      .from(liveLocationsTable)
      .where(eq(liveLocationsTable.userId, ride.riderId))
      .limit(1);
    if (loc) {
      riderLat    = parseFloat(String(loc.latitude));
      riderLng    = parseFloat(String(loc.longitude));
      riderLocAge = Math.floor((Date.now() - new Date(loc.updatedAt).getTime()) / 1000);

      // Compute ETA: distance from rider to next destination / average speed
      const s = await getPlatformSettings();
      const avgSpeedKmh = parseFloat(s["dispatch_avg_speed_kmh"] ?? "25");
      const destinationLat = ride.status === "in_transit"
        ? (ride.dropLat  ? parseFloat(ride.dropLat)  : null)
        : (ride.pickupLat ? parseFloat(ride.pickupLat) : null);
      const destinationLng = ride.status === "in_transit"
        ? (ride.dropLng  ? parseFloat(ride.dropLng)  : null)
        : (ride.pickupLng ? parseFloat(ride.pickupLng) : null);

      if (destinationLat !== null && destinationLng !== null && avgSpeedKmh > 0) {
        try {
          const distKm = calcDistance(riderLat, riderLng, destinationLat, destinationLng);
          etaMinutes = Math.max(1, Math.round((distKm / avgSpeedKmh) * 60));
        } catch {
          etaMinutes = null;
        }
      }
    }
  }

  const dropLat  = ride.dropLat  ? parseFloat(ride.dropLat)  : null;
  const dropLng  = ride.dropLng  ? parseFloat(ride.dropLng)  : null;
  const pickLat  = ride.pickupLat ? parseFloat(ride.pickupLat) : null;
  const pickLng  = ride.pickupLng ? parseFloat(ride.pickupLng) : null;

  sendSuccess(res, {
    id: ride.id,
    status: ride.status,
    riderId: ride.riderId,
    pickupLat:     pickLat,
    pickupLng:     pickLng,
    dropLat:       dropLat,
    dropLng:       dropLng,
    pickupAddress: ride.pickupAddress,
    dropAddress:   ride.dropAddress,
    riderLat,
    riderLng,
    riderLocAge,
    etaMinutes,
    trackable: TRACKABLE.includes(ride.status),
  });
});

router.post("/:id/event-log", riderAuth, loadRide(), requireRideOwner("riderId"), async (req, res) => {
  const parsed = eventLogSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error.issues[0]?.message || "event is required");
    return;
  }

  const ride = req.ride!;
  const rideId = ride.id;
  const riderId = req.riderId!;
  const { event, lat, lng, notes } = parsed.data;

  const id = generateId();
  await db.insert(rideEventLogsTable).values({
    id,
    rideId,
    riderId,
    event,
    lat:  lat  != null ? String(lat)  : null,
    lng:  lng  != null ? String(lng)  : null,
    notes: notes ?? null,
    createdAt: new Date(),
  });

  sendSuccess(res, { id });
});

router.get("/:id/event-logs", adminAuth, async (req, res) => {
  const logs = await db.select().from(rideEventLogsTable)
    .where(eq(rideEventLogsTable.rideId, String(req.params["id"])))
    .orderBy(asc(rideEventLogsTable.createdAt));

  const formatted = logs.map(l => ({
    id:        l.id,
    rideId:    l.rideId,
    riderId:   l.riderId,
    event:     l.event,
    lat:       l.lat  != null ? parseFloat(String(l.lat))  : null,
    lng:       l.lng  != null ? parseFloat(String(l.lng))  : null,
    notes:     l.notes,
    createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : l.createdAt,
  }));

  sendSuccess(res, { logs: formatted, total: formatted.length });
});

router.post("/:id/rate", customerAuth, requireRideState(["completed"]), requireRideOwner("userId"), async (req, res) => {
  const parsed = rateRideSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, parsed.error.issues[0]?.message || "stars must be between 1 and 5", 422); return;
  }

  const ride = req.ride!;
  const userId = req.customerId!;
  const rideId = ride.id;
  const { stars, comment } = parsed.data;

  if (!ride.riderId) { sendValidationError(res, "No rider assigned"); return; }

  /* Explicit self-rating guard: customer cannot be the same person as the rider */
  if (ride.riderId === userId) {
    sendForbidden(res, "You cannot rate yourself.");
    return;
  }

  const existing = await db.select({ id: rideRatingsTable.id }).from(rideRatingsTable).where(eq(rideRatingsTable.rideId, rideId)).limit(1);
  if (existing.length > 0) { sendError(res, "Already rated", 409); return; }

  const [rating] = await db.insert(rideRatingsTable).values({
    id: generateId(),
    rideId,
    customerId: userId,
    riderId: ride.riderId,
    stars,
    comment: comment || null,
  }).returning();

  const ratingLang = await getUserLanguage(ride.riderId);
  await db.insert(notificationsTable).values({
    id: generateId(), userId: ride.riderId,
    title: `${stars} ${t("rating", ratingLang)} ⭐`,
    body: comment ? `${stars} ${t("rating", ratingLang)}: "${comment}"` : `${t("rateRider", ratingLang)}: ${stars} ⭐`,
    type: "ride", icon: "star-outline",
  }).catch(() => {});

  sendSuccess(res, { rating });
});

router.get("/:id/status", customerAuth, loadRide(), requireRideOwner("userId"), async (req, res) => {
  const ride = req.ride!;
  const rideId = ride.id;

  const attempts = (ride.dispatchAttempts as string[] | null) || [];
  const hasRating = await db.select({ id: rideRatingsTable.id }).from(rideRatingsTable).where(eq(rideRatingsTable.rideId, rideId)).limit(1);

  sendSuccess(res, {
    id: ride.id,
    status: ride.status,
    riderId: ride.riderId,
    riderName: ride.riderName,
    riderPhone: ride.riderPhone,
    dispatchedRiderId: ride.dispatchedRiderId,
    dispatchLoopCount: ride.dispatchLoopCount ?? 0,
    dispatchAttempts: attempts.length,
    expiresAt: ride.expiresAt ? (ride.expiresAt instanceof Date ? ride.expiresAt.toISOString() : ride.expiresAt) : null,
    fare: parseFloat(ride.fare),
    distance: parseFloat(ride.distance),
    hasRating: hasRating.length > 0,
  });
});

router.get("/:id/dispatch-status", customerAuth, loadRide(), requireRideOwner("userId"), async (req, res) => {
  const ride = req.ride!;
  const rideId = ride.id;

  const s = await getPlatformSettings();
  const totalTimeoutSec = parseInt(s["dispatch_broadcast_timeout_sec"] ?? s["dispatch_request_timeout_sec"] ?? "120", 10);

  const [notifiedRow] = await db.select({ c: count() })
    .from(rideNotifiedRidersTable)
    .where(eq(rideNotifiedRidersTable.rideId, rideId));
  const notifiedCount = notifiedRow?.c ?? 0;

  const createdMs = new Date(ride.createdAt!).getTime();
  const elapsedSec = Math.round((Date.now() - createdMs) / 1000);
  const remainingSec = Math.max(0, totalTimeoutSec - elapsedSec);

  const maxLoops = parseInt(s["dispatch_max_loops"] ?? "3", 10);

  sendSuccess(res, {
    status: ride.status,
    notifiedRiders: notifiedCount,
    elapsedSec,
    remainingSec,
    totalTimeoutSec,
    attemptCount: notifiedCount,
    dispatchLoopCount: ride.dispatchLoopCount ?? 0,
    maxLoops,
  });
});

router.post("/:id/retry", customerAuth, requireRideState(["no_riders", "expired", "bargaining", "searching"]), requireRideOwner("userId"), async (req, res) => {
  const ride = req.ride!;
  const rideId = ride.id;

  await cleanupNotifiedRiders(rideId);

  await db.update(ridesTable).set({
    status: "searching",
    dispatchedRiderId: null,
    dispatchAttempts: [],
    dispatchLoopCount: 0,
    dispatchedAt: null,
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(ridesTable.id, rideId));

  broadcastRide(rideId);
  emitRideUpdate(rideId);

  sendSuccess(res, undefined, "Dispatch restarted");
});

const DISPATCH_INTERVAL_MS = 10_000;
const WATCHDOG_INTERVAL_MS = 30_000;
const WATCHDOG_STALE_THRESHOLD_MS = 60_000;

let dispatchCycleRunning = false;
let lastCycleCompletedAt: number | null = null;
let lastCycleDurationMs: number | null = null;
let engineStartedAt: number | null = null;

router.get("/dispatch/health", adminAuth, async (_req, res) => {
  try {
    const pendingCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(ridesTable)
      .where(and(
        or(eq(ridesTable.status, "searching"), eq(ridesTable.status, "bargaining")),
        isNull(ridesTable.riderId),
      ))
      .then((rows) => Number(rows[0]?.count ?? 0));

    const now = Date.now();
    const msSinceLastCycle = lastCycleCompletedAt !== null ? now - lastCycleCompletedAt : null;
    const referenceTime = lastCycleCompletedAt ?? engineStartedAt;
    const msSinceLastActivity = referenceTime !== null ? now - referenceTime : null;
    const alive = engineStartedAt !== null && msSinceLastActivity !== null && msSinceLastActivity <= WATCHDOG_STALE_THRESHOLD_MS;

    return sendSuccess(res, {
      alive,
      cycleRunning: dispatchCycleRunning,
      lastCycleAt: lastCycleCompletedAt !== null ? new Date(lastCycleCompletedAt).toISOString() : null,
      msSinceLastCycle,
      msSinceLastActivity,
      lastCycleDurationMs,
      pendingRides: pendingCount,
    });
  } catch (err) {
    logger.error({ err }, "[dispatch-health] error");
    return res.status(500).json({ error: "Failed to fetch dispatch health" });
  }
});

async function runDispatchCycle() {
  if (dispatchCycleRunning) return;
  dispatchCycleRunning = true;
  const cycleStartedAt = Date.now();
  try {
    const s = await getPlatformSettings();
    const totalTimeoutSec = parseInt(s["dispatch_broadcast_timeout_sec"] ?? s["dispatch_request_timeout_sec"] ?? "120", 10);

    const pendingRides = await db.select().from(ridesTable)
      .where(and(
        or(eq(ridesTable.status, "searching"), eq(ridesTable.status, "bargaining")),
        isNull(ridesTable.riderId),
      ))
      .orderBy(asc(ridesTable.createdAt))
      .limit(50);

    if (pendingRides.length === 0) {
      await db.delete(rideNotifiedRidersTable)
        .where(sql`ride_id NOT IN (SELECT id FROM rides WHERE status IN ('searching', 'bargaining') AND rider_id IS NULL)`)
        .catch(() => {});
      return;
    }

    await db.delete(rideNotifiedRidersTable)
      .where(sql`ride_id NOT IN (SELECT id FROM rides WHERE status IN ('searching', 'bargaining') AND rider_id IS NULL)`)
      .catch(() => {});

    /* Progressive dispatch timing:
     *   Phase 1 (0–30s):  2 km radius
     *   Phase 2 (30–90s): 5 km radius
     *   Phase 3 (90s+):  10 km radius
     * Rides should not be marked expired until the full dispatch sequence
     * has had a chance to complete (at least 90s for phase-3 to start,
     * plus a reasonable acceptance window). MAX_DISPATCH_ROUNDS drives the
     * no_riders terminal state; expired is a safety net for truly stale rides.
     */
    const DISPATCH_ROUND_INTERVAL_SEC = 45;
    const MAX_DISPATCH_ROUNDS = 3;
    /* Minimum seconds before expired can fire: must be > full dispatch window */
    const MIN_EXPIRED_AFTER_SEC = MAX_DISPATCH_ROUNDS * DISPATCH_ROUND_INTERVAL_SEC; // 135s

    for (const ride of pendingRides) {
      try {
        const createdMs = new Date(ride.createdAt!).getTime();
        const elapsedSec = (Date.now() - createdMs) / 1000;

        const currentRound = Math.floor(elapsedSec / DISPATCH_ROUND_INTERVAL_SEC);
        const loopCount = ride.dispatchLoopCount ?? 0;

        /* ── Terminal: no_riders after full progressive dispatch ── */
        if (currentRound >= MAX_DISPATCH_ROUNDS) {
          await db.transaction(async (tx) => {
            const [upd] = await tx.update(ridesTable)
              .set({ status: "no_riders", updatedAt: new Date() })
              .where(and(eq(ridesTable.id, ride.id), isNull(ridesTable.riderId)))
              .returning({ id: ridesTable.id });
            if (!upd) return;

            if (ride.paymentMethod === "wallet") {
              const rideRef = `ride:${ride.id}`;
              const txns = await tx.select({ type: walletTransactionsTable.type, amount: walletTransactionsTable.amount })
                .from(walletTransactionsTable)
                .where(and(
                  eq(walletTransactionsTable.userId, ride.userId),
                  eq(walletTransactionsTable.reference, rideRef),
                ));
              let netDebit = 0;
              for (const t of txns) {
                const a = parseFloat(t.amount);
                if (t.type === "debit") netDebit += a; else if (t.type === "credit") netDebit -= a;
              }
              if (netDebit > 0) {
                await tx.update(usersTable)
                  .set({ walletBalance: sql`wallet_balance + ${netDebit.toFixed(2)}`, updatedAt: new Date() })
                  .where(eq(usersTable.id, ride.userId));
                await tx.insert(walletTransactionsTable).values({
                  id: generateId(), userId: ride.userId, type: "credit",
                  amount: netDebit.toFixed(2),
                  description: `No riders found — auto-refund #${ride.id.slice(-6).toUpperCase()}`,
                  reference: rideRef,
                });
              }
            }
          });
          const noRiderLang = await getUserLanguage(ride.userId);
          await db.insert(notificationsTable).values({
            id: generateId(), userId: ride.userId,
            title: t("noRequests", noRiderLang),
            body: t("searching_driver", noRiderLang),
            type: "ride", icon: "close-circle-outline",
          }).catch(() => {});
          emitRideUpdate(ride.id);
          await cleanupNotifiedRiders(ride.id);
          continue;
        }

        /* ── Safety net: expired for rides stuck beyond totalTimeoutSec
         *  This only fires AFTER the full dispatch sequence (MIN_EXPIRED_AFTER_SEC)
         *  so rides always get all progressive phases before expiry. ── */
        if (elapsedSec > Math.max(totalTimeoutSec, MIN_EXPIRED_AFTER_SEC)) {
          await db.transaction(async (tx) => {
            const [upd] = await tx.update(ridesTable)
              .set({ status: "expired", updatedAt: new Date() })
              .where(and(eq(ridesTable.id, ride.id), isNull(ridesTable.riderId)))
              .returning({ id: ridesTable.id });
            if (!upd) return;

            if (ride.paymentMethod === "wallet") {
              const rideRef = `ride:${ride.id}`;
              const txns = await tx.select({ type: walletTransactionsTable.type, amount: walletTransactionsTable.amount })
                .from(walletTransactionsTable)
                .where(and(
                  eq(walletTransactionsTable.userId, ride.userId),
                  eq(walletTransactionsTable.reference, rideRef),
                ));
              let netDebit = 0;
              for (const t of txns) {
                const a = parseFloat(t.amount);
                if (t.type === "debit") netDebit += a; else if (t.type === "credit") netDebit -= a;
              }
              if (netDebit > 0) {
                await tx.update(usersTable)
                  .set({ walletBalance: sql`wallet_balance + ${netDebit.toFixed(2)}`, updatedAt: new Date() })
                  .where(eq(usersTable.id, ride.userId));
                await tx.insert(walletTransactionsTable).values({
                  id: generateId(), userId: ride.userId, type: "credit",
                  amount: netDebit.toFixed(2),
                  description: `Ride expired — auto-refund #${ride.id.slice(-6).toUpperCase()}`,
                  reference: rideRef,
                });
              }
            }
          });

          const expLang = await getUserLanguage(ride.userId);
          await db.insert(notificationsTable).values({
            id: generateId(),
            userId: ride.userId,
            title: t("searching", expLang),
            body: t("noRequests", expLang),
            type: "ride",
            icon: "close-circle-outline",
          }).catch(() => {});

          emitRideUpdate(ride.id);
          await cleanupNotifiedRiders(ride.id);
          continue;
        }

        if (currentRound > loopCount) {
          // New round started — do NOT clear notified riders.
          // broadcastRide already skips riders in rideNotifiedRidersTable,
          // so new rounds naturally reach only newly-online/unnotified riders.
          await db.update(ridesTable)
            .set({ dispatchLoopCount: currentRound, updatedAt: new Date() })
            .where(and(eq(ridesTable.id, ride.id), isNull(ridesTable.riderId)));
        }

        await broadcastRide(ride.id);
      } catch (rideErr) {
        const errMsg = rideErr instanceof Error ? rideErr.message : String(rideErr);
        const errStack = rideErr instanceof Error ? rideErr.stack : undefined;
        logger.error({ rideId: ride.id, err: errMsg, stack: errStack }, `[dispatch-engine] Error processing ride ${ride.id}`);
      }
    }
  } catch (err) {
    logger.error("[dispatch-engine] cycle error:", err);
  } finally {
    lastCycleCompletedAt = Date.now();
    lastCycleDurationMs = lastCycleCompletedAt - cycleStartedAt;
    dispatchCycleRunning = false;
  }
}

let dispatchInterval: ReturnType<typeof setInterval> | null = null;
let watchdogInterval: ReturnType<typeof setInterval> | null = null;

function runWatchdog() {
  const now = Date.now();
  const referenceTime = lastCycleCompletedAt ?? engineStartedAt;
  if (referenceTime === null) {
    return;
  }
  const msSinceLastActivity = now - referenceTime;
  if (msSinceLastActivity > WATCHDOG_STALE_THRESHOLD_MS) {
    logger.fatal(
      {
        msSinceLastActivity,
        lastCycleCompletedAt: lastCycleCompletedAt !== null ? new Date(lastCycleCompletedAt).toISOString() : null,
        engineStartedAt: engineStartedAt !== null ? new Date(engineStartedAt).toISOString() : null,
        noCycleEverCompleted: lastCycleCompletedAt === null,
      },
      "[dispatch-engine] WATCHDOG: engine has not completed a cycle in over 60s — resetting lock and triggering emergency cycle"
    );
    dispatchCycleRunning = false;
    runDispatchCycle().catch((e) =>
      logger.error({ err: e }, "[dispatch-engine] WATCHDOG: emergency cycle failed")
    );
  }
}

export function startDispatchEngine() {
  if (dispatchInterval) return;
  engineStartedAt = Date.now();
  dispatchInterval = setInterval(runDispatchCycle, DISPATCH_INTERVAL_MS);
  watchdogInterval = setInterval(runWatchdog, WATCHDOG_INTERVAL_MS);
  logger.info("[dispatch-engine] started (every 10s, watchdog every 30s)");
  runDispatchCycle();
}

/* ── Scheduled ride dispatcher: runs every minute and broadcasts scheduled rides
   that fall within the next 15 minutes so riders can accept them in advance. ── */
export async function dispatchScheduledRides(): Promise<void> {
  try {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 15 * 60_000);
    const readyRides = await db.select({ id: ridesTable.id })
      .from(ridesTable)
      .where(and(
        eq(ridesTable.status, "scheduled"),
        sql`scheduled_at IS NOT NULL`,
        sql`scheduled_at <= ${windowEnd.toISOString()}`,
        sql`scheduled_at >= ${now.toISOString()}`,
      ));
    for (const ride of readyRides) {
      await db.update(ridesTable)
        .set({ status: "searching", updatedAt: new Date() })
        .where(and(eq(ridesTable.id, ride.id), eq(ridesTable.status, "scheduled")));
      broadcastRide(ride.id);
      emitRideDispatchUpdate({ rideId: ride.id, action: "scheduled_dispatch", status: "searching" });
      emitRideUpdate(ride.id);
      logger.info({ rideId: ride.id }, "[scheduled-dispatch] ride activated");
    }
  } catch (e) {
    logger.error({ err: e }, "[scheduled-dispatch] error");
  }
}

/* ══════════════════════════════════════════════════════
   In-App Ride Chat
══════════════════════════════════════════════════════ */

const chatMessageSchema = z.object({
  body: z.string().min(1, "Message body required").max(500, "Message too long").transform(stripHtml),
});

router.post("/:id/messages", async (req, res) => {
  const rideId = req.params["id"]!;
  let senderRole: "customer" | "rider";
  let senderId: string;

  if (req.customerId) {
    senderRole = "customer";
    senderId = req.customerId;
  } else if (req.riderId) {
    senderRole = "rider";
    senderId = req.riderId;
  } else {
    sendForbidden(res, "Authentication required");
    return;
  }

  const parsed = chatMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error.issues[0]?.message ?? "Invalid message");
    return;
  }

  const [ride] = await db.select({ id: ridesTable.id, userId: ridesTable.userId, riderId: ridesTable.riderId, status: ridesTable.status })
    .from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);

  if (!ride) { sendNotFound(res, "Ride not found"); return; }

  const isParticipant =
    (senderRole === "customer" && ride.userId === senderId) ||
    (senderRole === "rider" && ride.riderId === senderId);
  if (!isParticipant) { sendForbidden(res, "Not a participant of this ride"); return; }

  const activeStatuses = ["accepted", "arrived", "in_transit"];
  if (!activeStatuses.includes(ride.status)) {
    sendValidationError(res, "Chat is only available during active rides");
    return;
  }

  const id = generateId();
  const [msg] = await db.insert(rideMessagesTable).values({
    id,
    rideId,
    senderRole,
    senderId,
    body: parsed.data.body,
  }).returning();

  const payload = {
    id: msg!.id,
    rideId: msg!.rideId,
    senderRole: msg!.senderRole,
    senderId: msg!.senderId,
    body: msg!.body,
    createdAt: msg!.createdAt.toISOString(),
  };

  emitRideMessage(rideId, payload);
  sendCreated(res, payload);
});

router.get("/:id/messages", async (req, res) => {
  const rideId = req.params["id"]!;
  let senderId: string | null = null;

  if (req.customerId) senderId = req.customerId;
  else if (req.riderId) senderId = req.riderId;

  if (!senderId) { sendForbidden(res, "Authentication required"); return; }

  const [ride] = await db.select({ id: ridesTable.id, userId: ridesTable.userId, riderId: ridesTable.riderId })
    .from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);

  if (!ride) { sendNotFound(res, "Ride not found"); return; }

  const isParticipant = ride.userId === senderId || ride.riderId === senderId;
  if (!isParticipant) { sendForbidden(res, "Not a participant of this ride"); return; }

  const messages = await db.select().from(rideMessagesTable)
    .where(eq(rideMessagesTable.rideId, rideId))
    .orderBy(asc(rideMessagesTable.createdAt))
    .limit(50);

  sendSuccess(res, {
    messages: messages.map(m => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

export default router;
