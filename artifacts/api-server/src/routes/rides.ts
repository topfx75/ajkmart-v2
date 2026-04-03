import { logger } from "../lib/logger.js";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  liveLocationsTable, notificationsTable, rideBidsTable,
  rideServiceTypesTable, ridesTable, rideRatingsTable,
  usersTable, walletTransactionsTable,
  popularLocationsTable, rideEventLogsTable, rideNotifiedRidersTable,
} from "@workspace/db/schema";
import { and, asc, eq, ne, sql, or, isNull, gte, count } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "../lib/id.js";
import { ensureDefaultRideServices, ensureDefaultLocations, getPlatformSettings, adminAuth } from "./admin.js";
import { customerAuth, riderAuth } from "../middleware/security.js";
import { loadRide, requireRideState, requireRideOwner } from "../middleware/ride-guards.js";
import { getIO } from "../lib/socketio.js";

function broadcastWalletUpdate(userId: string, newBalance: number) {
  const io = getIO();
  if (!io) return;
  io.to(`user:${userId}`).emit("wallet:update", { balance: newBalance });
}
import { t, type TranslationKey } from "@workspace/i18n";
import { getUserLanguage } from "../lib/getUserLanguage.js";
import { emitRiderNewRequest, emitRideDispatchUpdate, emitRideOtp } from "../lib/socketio.js";
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

const coordinateSchema = z.number().min(-180).max(180);
const latitudeSchema = z.number().min(-90).max(90);

function toNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

const bookRideSchema = z.object({
  type: z.string().min(1),
  pickupAddress: z.string().min(1),
  dropAddress: z.string().min(1),
  pickupLat: z.preprocess(toNumber, latitudeSchema),
  pickupLng: z.preprocess(toNumber, coordinateSchema),
  dropLat: z.preprocess(toNumber, latitudeSchema),
  dropLng: z.preprocess(toNumber, coordinateSchema),
  paymentMethod: z.string().min(1),
  offeredFare: z.preprocess((v) => (v != null && v !== "" ? Number(v) : undefined), z.number().positive().optional()),
  bargainNote: z.string().max(500).optional(),
  /* ── Parcel delivery fields ── */
  isParcel: z.boolean().optional().default(false),
  receiverName: z.string().max(200).optional(),
  receiverPhone: z.string().max(20).optional(),
  packageType: z.string().max(100).optional(),
});

const cancelRideSchema = z.object({
  reason: z.string().max(200).optional(),
});

const acceptBidSchema = z.object({
  bidId: z.string().min(1),
});

const customerCounterSchema = z.object({
  offeredFare: z.preprocess(toNumber, z.number().positive()),
  note: z.string().max(500).optional(),
});

const rateRideSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
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
  lat: z.number().optional(),
  lng: z.number().optional(),
  notes: z.string().max(1000).optional(),
});

function normalizeVehicleType(raw: string | null | undefined): string {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return "";
  if (v === "bike" || v.startsWith("bike") || v.includes("motorcycle")) return "bike";
  if (v === "car") return "car";
  if (v === "rickshaw" || v.includes("rickshaw") || v.includes("qingqi")) return "rickshaw";
  if (v === "van") return "van";
  if (v === "daba") return "daba";
  if (v === "bicycle") return "bicycle";
  if (v === "on_foot" || v === "on foot") return "on_foot";
  return v;
}

async function broadcastRide(rideId: string) {
  try {
    const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
    if (!ride || ride.riderId) return;
    if (!["searching", "bargaining"].includes(ride.status)) return;

    const s = await getPlatformSettings();
    const radiusKm = parseFloat(s["dispatch_min_radius_km"] ?? "5");
    const avgSpeed = parseFloat(s["dispatch_avg_speed_kmh"] ?? "25");

    const pickupLat = parseFloat(ride.pickupLat ?? "");
    const pickupLng = parseFloat(ride.pickupLng ?? "");
    if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) {
      logger.error(`[broadcast] Ride ${rideId} has invalid coordinates — skipping dispatch`);
      return;
    }

    const onlineRiders = await db.select({
      userId: liveLocationsTable.userId,
      latitude: liveLocationsTable.latitude,
      longitude: liveLocationsTable.longitude,
    }).from(liveLocationsTable)
      .where(and(
        eq(liveLocationsTable.role, "rider"),
        gte(liveLocationsTable.updatedAt, new Date(Date.now() - 5 * 60 * 1000)),
      ));

    const alreadyNotified = await db.select({ riderId: rideNotifiedRidersTable.riderId })
      .from(rideNotifiedRidersTable)
      .where(eq(rideNotifiedRidersTable.rideId, rideId));
    const alreadySet = new Set(alreadyNotified.map(r => r.riderId));

    let notifiedCount = 0;

    for (const r of onlineRiders) {
      if (alreadySet.has(r.userId)) continue;
      const rLat = parseFloat(String(r.latitude));
      const rLng = parseFloat(String(r.longitude));
      if (!Number.isFinite(rLat) || !Number.isFinite(rLng)) continue;
      const dist = calcDistance(pickupLat, pickupLng, rLat, rLng);
      if (dist > radiusKm) continue;

      const [user] = await db.select({ isActive: usersTable.isActive, isBanned: usersTable.isBanned, isRestricted: usersTable.isRestricted, vehicleType: usersTable.vehicleType })
        .from(usersTable).where(eq(usersTable.id, r.userId)).limit(1);
      if (!user || !user.isActive || user.isBanned || user.isRestricted) continue;
      if (ride.type) {
        const rideVt = normalizeVehicleType(ride.type);
        const riderVt = normalizeVehicleType(user.vehicleType);
        if (!riderVt || riderVt !== rideVt) continue;
      }

      const activeRiderRides = await db.select({ id: ridesTable.id })
        .from(ridesTable)
        .where(and(eq(ridesTable.riderId, r.userId), sql`status IN ('accepted', 'arrived', 'in_transit')`))
        .limit(1);
      if (activeRiderRides.length > 0) continue;

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

    if (notifiedCount === 0 && alreadySet.size === 0) {
      logger.warn(`[broadcast] NO_RIDERS_AVAILABLE for ride ${rideId} — no eligible riders within ${radiusKm}km`);
      await db.insert(notificationsTable).values({
        id: generateId(), userId: ride.userId,
        title: "No riders available",
        body: "No riders are currently available in your area. We'll keep searching — you'll be notified as soon as a rider accepts.",
        type: "ride", icon: "car-outline", link: `/ride/${rideId}`,
      }).catch(() => {});
      emitRideDispatchUpdate({
        rideId,
        action: "NO_RIDERS_AVAILABLE",
        status: "searching",
      });
    }

    await db.update(ridesTable).set({
      dispatchedAt: ride.dispatchedAt ?? new Date(),
      updatedAt: new Date(),
    }).where(and(eq(ridesTable.id, rideId), isNull(ridesTable.riderId)));

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
 * Falls back to haversine if no API key is available or the call fails.
 */
async function getRoadDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): Promise<{ distanceKm: number; durationSeconds: number; source: "google" | "mapbox" | "haversine" }> {
  const haversine = calcDistance(lat1, lng1, lat2, lng2);
  const haversineFallback = { distanceKm: haversine, durationSeconds: Math.round((haversine / 45) * 3600), source: "haversine" as const };

  try {
    const s = await getPlatformSettings();
    const routingProvider = s["routing_api_provider"] ?? "google";

    if (routingProvider === "google") {
      const googleKey = s["maps_api_key"];
      if (!googleKey) return haversineFallback;
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${lat1},${lng1}&destination=${lat2},${lng2}&mode=driving&key=${googleKey}`;
      const raw  = await fetch(url, { signal: AbortSignal.timeout(4000) });
      const data = await raw.json() as any;
      if (data.status === "OK" && data.routes?.length) {
        const leg = data.routes[0].legs[0];
        return {
          distanceKm:      Math.round(leg.distance.value / 100) / 10,
          durationSeconds: leg.duration.value,
          source: "google",
        };
      }
    }

    if (routingProvider === "mapbox") {
      const mapboxKey = s["mapbox_api_key"];
      if (!mapboxKey) return haversineFallback;
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${lng1},${lat1};${lng2},${lat2}?access_token=${mapboxKey}&overview=false`;
      const raw  = await fetch(url, { signal: AbortSignal.timeout(4000) });
      const data = await raw.json() as any;
      if (data.routes?.length) {
        return {
          distanceKm:      Math.round(data.routes[0].distance / 100) / 10,
          durationSeconds: Math.round(data.routes[0].duration),
          source: "mapbox",
        };
      }
    }
  } catch {
    /* Network error — fall through to haversine */
  }

  return haversineFallback;
}

async function calcFare(distance: number, type: string): Promise<{ baseFare: number; gstAmount: number; total: number }> {
  if (!isFinite(distance) || distance < 0) {
    throw new RideApiError("Invalid distance: must be a non-negative number", "INVALID_DISTANCE", 422);
  }
  if (!type || typeof type !== "string") {
    throw new RideApiError("Invalid service type: must be a non-empty string", "INVALID_SERVICE_TYPE", 422);
  }

  const s = await getPlatformSettings();

  let baseRate: number, perKm: number, minFare: number;
  const psBase = s[`ride_${type}_base_fare`];
  const psKm   = s[`ride_${type}_per_km`];
  const psMin  = s[`ride_${type}_min_fare`];

  if (psBase !== undefined && psKm !== undefined && psMin !== undefined) {
    baseRate = parseFloat(psBase);
    perKm    = parseFloat(psKm);
    minFare  = parseFloat(psMin);
  } else {
    const [svc] = await db.select().from(rideServiceTypesTable).where(eq(rideServiceTypesTable.key, type)).limit(1);
    if (!svc) {
      throw new RideApiError(`Unknown ride service type: '${type}'`, "UNKNOWN_SERVICE_TYPE", 422);
    }
    baseRate = parseFloat(svc.baseFare  ?? "15");
    perKm    = parseFloat(svc.perKm     ?? "8");
    minFare  = parseFloat(svc.minFare   ?? "50");
  }

  if (!isFinite(baseRate) || !isFinite(perKm) || !isFinite(minFare)) {
    throw new RideApiError("Fare configuration is invalid for this service type", "INVALID_FARE_CONFIG", 500);
  }

  const surgeEnabled    = (s["ride_surge_enabled"] ?? "off") === "on";
  const surgeMultiplier = surgeEnabled ? parseFloat(s["ride_surge_multiplier"] ?? "1.5") : 1;
  const raw      = Math.round(baseRate + distance * perKm);
  const baseFare = Math.round(Math.max(minFare, raw) * surgeMultiplier);
  const gstEnabled = (s["finance_gst_enabled"] ?? "off") === "on";
  const gstPct     = parseFloat(s["finance_gst_pct"] ?? "17");
  const gstAmount  = gstEnabled ? parseFloat(((baseFare * gstPct) / 100).toFixed(2)) : 0;
  return { baseFare, gstAmount, total: baseFare + gstAmount };
}

const toISO = (v: unknown) => v ? (v instanceof Date ? v.toISOString() : v) : null;
function formatRide(r: Record<string, unknown>) {
  return {
    ...r,
    fare:          parseFloat(r.fare         ?? "0"),
    distance:      parseFloat(r.distance     ?? "0"),
    offeredFare:   r.offeredFare  ? parseFloat(r.offeredFare)  : null,
    counterFare:   r.counterFare  ? parseFloat(r.counterFare)  : null,
    bargainRounds: r.bargainRounds ?? 0,
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
  };
}

router.get("/services", async (_req, res) => {
  await ensureDefaultRideServices();
  const services = await db.select().from(rideServiceTypesTable)
    .where(eq(rideServiceTypesTable.isEnabled, true))
    .orderBy(asc(rideServiceTypesTable.sortOrder));
  res.json({
    services: services.map(s => ({
      id:              s.id,
      key:             s.key,
      name:            s.name,
      nameUrdu:        s.nameUrdu,
      icon:            s.icon,
      description:     s.description,
      color:           s.color,
      baseFare:        parseFloat(s.baseFare   ?? "0"),
      perKm:           parseFloat(s.perKm      ?? "0"),
      minFare:         parseFloat(s.minFare    ?? "0"),
      maxPassengers:   s.maxPassengers,
      allowBargaining: s.allowBargaining,
      sortOrder:       s.sortOrder,
    })),
  });
});

router.get("/stops", async (_req, res) => {
  try { await ensureDefaultLocations(); } catch {}
  const locs = await db.select().from(popularLocationsTable)
    .where(eq(popularLocationsTable.isActive, true))
    .orderBy(asc(popularLocationsTable.sortOrder));
  res.json({
    locations: locs.map(l => ({
      id: l.id, name: l.name, nameUrdu: l.nameUrdu,
      lat: parseFloat(String(l.lat)), lng: parseFloat(String(l.lng)),
      category: l.category, icon: l.icon,
    })),
  });
});

router.post("/estimate", async (req, res) => {
  const parsed = estimateSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    res.status(422).json({ error: msg }); return;
  }
  const { pickupLat, pickupLng, dropLat, dropLng, type } = parsed.data;
  try {
    const serviceType = type || "bike";
    const { distanceKm, durationSeconds, source } = await getRoadDistanceKm(pickupLat, pickupLng, dropLat, dropLng);
    const { baseFare, gstAmount, total } = await calcFare(distanceKm, serviceType);
    const s = await getPlatformSettings();
    const durationMin = Math.round(durationSeconds / 60);
    const duration = `${durationMin} min`;
    const bargainEnabled = (s["ride_bargaining_enabled"] ?? "on") === "on";
    const bargainMinPct  = parseFloat(s["ride_bargaining_min_pct"] ?? "70");
    const minOffer       = Math.ceil(total * (bargainMinPct / 100));
    res.json({
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
    res.status(status).json({ error: e.message, code });
  }
});

router.post("/", customerAuth, async (req, res) => {
  const parsed = bookRideSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    res.status(422).json({ error: msg }); return;
  }

  const userId = req.customerId!;
  const {
    type, pickupAddress, dropAddress,
    pickupLat, pickupLng, dropLat, dropLng,
    paymentMethod, offeredFare, bargainNote,
    isParcel, receiverName, receiverPhone, packageType,
  } = parsed.data;

  const existingActive = await db.select({ id: ridesTable.id, status: ridesTable.status })
    .from(ridesTable)
    .where(and(eq(ridesTable.userId, userId), sql`status IN ('searching', 'bargaining', 'accepted', 'arrived', 'in_transit')`))
    .limit(1);
  if (existingActive.length > 0) {
    res.status(409).json({
      error: "Aapki ek ride pehle se active hai. Naye ride ke liye pehle wali complete ya cancel karein.",
      activeRideId: existingActive[0]!.id,
      activeRideStatus: existingActive[0]!.status,
    });
    return;
  }

  const [debtUser] = await db.select({ cancellationDebt: usersTable.cancellationDebt })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  const debtAmount = parseFloat(debtUser?.cancellationDebt ?? "0");
  if (debtAmount > 0) {
    res.status(402).json({
      error: `You have an outstanding cancellation fee debt of Rs. ${debtAmount.toFixed(0)}. Please clear your debt before booking a new ride.`,
      debtAmount,
    });
    return;
  }

  const s = await getPlatformSettings();

  if ((s["app_status"] ?? "active") === "maintenance") {
    const mainKey = (s["security_maintenance_key"] ?? "").trim();
    const bypass  = ((req.headers["x-maintenance-key"] as string) ?? "").trim();
    if (!mainKey || bypass !== mainKey) {
      res.status(503).json({ error: s["content_maintenance_msg"] ?? "We're performing scheduled maintenance. Back soon!" }); return;
    }
  }

  const ridesEnabled = (s["feature_rides"] ?? "on") === "on";
  if (!ridesEnabled) { res.status(503).json({ error: "Ride booking is currently disabled" }); return; }

  let distance: number;
  let baseFare: number, gstAmount: number, platformFare: number;
  try {
    const routeResult = await getRoadDistanceKm(pickupLat, pickupLng, dropLat, dropLng);
    distance = routeResult.distanceKm;
    const fareResult = await calcFare(distance, type);
    baseFare = fareResult.baseFare;
    gstAmount = fareResult.gstAmount;
    platformFare = fareResult.total;
  } catch (e: unknown) {
    const status = e instanceof RideApiError ? e.httpStatus : 422;
    const code = e instanceof RideApiError ? e.code : "FARE_CALCULATION_FAILED";
    res.status(status).json({ error: e.message, code }); return;
  }

  const bargainEnabled  = (s["ride_bargaining_enabled"] ?? "on") === "on";
  const bargainMinPct   = parseFloat(s["ride_bargaining_min_pct"] ?? "70");

  let isBargaining = false;
  let validatedOffer = 0;

  if (offeredFare !== undefined && bargainEnabled) {
    validatedOffer = offeredFare;
    const minOffer = Math.ceil(platformFare * (bargainMinPct / 100));
    if (validatedOffer < minOffer) {
      res.status(400).json({ error: `Minimum offer allowed is Rs. ${minOffer} (${bargainMinPct}% of platform fare)`, code: "FARE_OUT_OF_RANGE" }); return;
    }
    isBargaining = validatedOffer < platformFare;
  }

  const minOnline = parseFloat(s["payment_min_online"] ?? "50");
  const maxOnline = parseFloat(s["payment_max_online"] ?? "100000");
  const effectiveFare = isBargaining ? validatedOffer : platformFare;
  if (paymentMethod === "wallet" && (effectiveFare < minOnline || effectiveFare > maxOnline)) {
    res.status(400).json({ error: `Wallet payment must be between Rs. ${minOnline} and Rs. ${maxOnline}` }); return;
  }

  if (paymentMethod === "wallet") {
    const [wUser] = await db.select({ blockedServices: usersTable.blockedServices }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (wUser && (wUser.blockedServices || "").split(",").map(sv => sv.trim()).includes("wallet")) {
      res.status(403).json({ error: "wallet_frozen", message: "Your wallet has been temporarily frozen. Contact support." }); return;
    }
  }

  if (paymentMethod === "cash") {
    const riderCashAllowed = (s["rider_cash_allowed"] ?? "on") === "on";
    if (!riderCashAllowed) {
      res.status(400).json({ error: "Cash payment is currently not available for rides. Please use wallet." }); return;
    }
  }

  const rideStatus = isBargaining ? "bargaining" : "searching";
  const fareToCharge = isBargaining ? validatedOffer : platformFare;
  const fareToStore  = platformFare.toFixed(2);

  try {
    let rideRecord: typeof ridesTable.$inferSelect;

    if (paymentMethod === "wallet" && !isBargaining) {
      const walletEnabled = (s["feature_wallet"] ?? "on") === "on";
      if (!walletEnabled) { res.status(400).json({ error: "Wallet payments are currently disabled" }); return; }

      rideRecord = await db.transaction(async (tx) => {
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
        const [ride] = await tx.insert(ridesTable).values({
          id: rideId, userId, type, status: rideStatus,
          pickupAddress, dropAddress,
          pickupLat: String(pickupLat), pickupLng: String(pickupLng),
          dropLat: String(dropLat), dropLng: String(dropLng),
          fare: fareToStore, distance: (Math.round(distance * 10) / 10).toString(), paymentMethod,
          offeredFare: null, counterFare: null, bargainStatus: null, bargainRounds: 0,
          isParcel: isParcel ?? false,
          receiverName: receiverName || null,
          receiverPhone: receiverPhone || null,
          packageType: packageType || null,
        }).returning();
        return ride!;
      });
    } else {
      const [ride] = await db.insert(ridesTable).values({
        id: generateId(), userId, type, status: rideStatus,
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
      }).returning();
      rideRecord = ride!;
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

    if (rideRecord) {
      broadcastRide(rideRecord.id);
      emitRideDispatchUpdate({ rideId: rideRecord.id, action: "new", status: rideRecord.status });
    }

    res.status(201).json({
      ...formatRide(rideRecord),
      baseFare, gstAmount,
      platformFare, effectiveFare: fareToCharge,
      isBargaining,
    });
  } catch (e: unknown) {
    const status = e instanceof RideApiError ? e.httpStatus : 400;
    const code = e instanceof RideApiError ? e.code : "BOOKING_FAILED";
    res.status(status).json({ error: e.message, code });
  }
});

router.patch("/:id/cancel", customerAuth, requireRideState(["searching", "bargaining", "accepted", "arrived"]), requireRideOwner("userId"), async (req, res) => {
  const userId = req.customerId!;
  const ride = req.ride!;
  const cancelParsed = cancelRideSchema.safeParse(req.body ?? {});
  if (!cancelParsed.success) {
    const msg = cancelParsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    res.status(422).json({ error: msg }); return;
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
  let fareWasCharged = false;
  if (ride.paymentMethod === "wallet") {
    const rideRef = `ride:${ride.id}`;
    const [debitTx] = await db.select({ id: walletTransactionsTable.id })
      .from(walletTransactionsTable)
      .where(and(
        eq(walletTransactionsTable.userId, userId),
        eq(walletTransactionsTable.type, "debit"),
        eq(walletTransactionsTable.reference, rideRef),
      ))
      .limit(1);
    fareWasCharged = !!debitTx;
  }

  const cancelResult = await db.transaction(async (tx) => {
    const [upd] = await tx.update(ridesTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(ridesTable.id, String(req.params["id"])), eq(ridesTable.userId, userId)))
      .returning();

    await tx.update(rideBidsTable)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(and(eq(rideBidsTable.rideId, String(req.params["id"])), eq(rideBidsTable.status, "pending")));

    // Credit the fare refund FIRST so the balance includes it when we later
    // calculate how much of the cancellation fee the user can cover.
    if (fareWasCharged) {
      const refundAmt = parseFloat(ride.fare);
      await tx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance + ${refundAmt}`, updatedAt: new Date() })
        .where(eq(usersTable.id, userId));
      await tx.insert(walletTransactionsTable).values({
        id: generateId(), userId, type: "credit", amount: refundAmt.toFixed(2),
        description: `Ride refund — #${ride.id.slice(-6).toUpperCase()} cancelled`,
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
  if (fareWasCharged) {
    const refundAmt = parseFloat(ride.fare);
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
  res.json({
    ...formatRide(cancelResult!),
    cancellationFee: actualCancelFee,
    cancelFeeAsDebt,
    cancelReason,
  });
});

router.patch("/:id/accept-bid", customerAuth, async (req, res) => {
  const parsed = acceptBidSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "bidId required" }); return;
  }

  const userId = req.customerId!;
  const { bidId } = parsed.data;
  const rideId = String(req.params["id"]);

  // Block users who accumulated cancellation debt from accepting bids (mirrors the booking check)
  const [debtUserBid] = await db.select({ cancellationDebt: usersTable.cancellationDebt })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const bidDebt = parseFloat(debtUserBid?.cancellationDebt ?? "0");
  if (bidDebt > 0) {
    res.status(402).json({
      error: `You have an outstanding cancellation fee debt of Rs. ${bidDebt.toFixed(0)}. Please clear your debt before accepting a ride.`,
      debtAmount: bidDebt,
    });
    return;
  }

  let updated: any;
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
        .where(and(eq(rideBidsTable.id, bidId), eq(rideBidsTable.rideId, rideId), eq(rideBidsTable.status, "pending")))
        .limit(1);
      if (!bid) throw new RideApiError("Bid not found or no longer pending", "BID_NOT_FOUND", 404);

      const agreedFare = parseFloat(bid.fare);

      if (ride.paymentMethod === "wallet") {
        const [deducted] = await tx.update(usersTable)
          .set({ walletBalance: sql`wallet_balance - ${agreedFare.toFixed(2)}` })
          .where(and(eq(usersTable.id, userId), gte(usersTable.walletBalance, agreedFare.toFixed(2))))
          .returning({ id: usersTable.id });
        if (!deducted) throw new RideApiError(`Insufficient wallet balance. Need Rs. ${agreedFare.toFixed(0)}`, "INSUFFICIENT_BALANCE", 402);
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId, type: "debit", amount: agreedFare.toFixed(2),
          description: `Ride payment (bargained) — #${rideId.slice(-6).toUpperCase()}`,
          reference: `ride:${rideId}`,
        });
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
    res.status(status).json({ error: e.message, code });
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
  res.json({ ...formatRide(rideUpdate!), agreedFare, tripOtp: otp });
});

router.patch("/:id/customer-counter", bargainLimiter, customerAuth, requireRideState(["bargaining"]), requireRideOwner("userId"), async (req, res) => {
  const parsed = customerCounterSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    res.status(422).json({ error: msg }); return;
  }

  const ride = req.ride!;
  const rideId = ride.id;
  const userId = req.customerId!;
  const { offeredFare: newOffer, note } = parsed.data;

  const s = await getPlatformSettings();
  const bargainMinPct = parseFloat(s["ride_bargaining_min_pct"] ?? "70");
  const platformFare  = parseFloat(ride.fare);
  const minOffer      = Math.ceil(platformFare * (bargainMinPct / 100));
  if (newOffer < minOffer) {
    res.status(400).json({ error: `Minimum offer is Rs. ${minOffer}` }); return;
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

  res.json(formatRide(updated!));
});

router.get("/", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const rides = await db.select().from(ridesTable).where(eq(ridesTable.userId, userId)).orderBy(ridesTable.createdAt);
  const formatted = await Promise.all(rides.map(async (r) => {
    const base = formatRide(r);
    let fareBreakdown: { baseFare: number; gstAmount: number } | null = null;
    if (r.distance && r.type && ["completed", "dropped_off"].includes(r.status)) {
      try {
        const computed = await calcFare(parseFloat(String(r.distance)), r.type);
        fareBreakdown = { baseFare: computed.baseFare, gstAmount: computed.gstAmount };
      } catch {}
    }
    return { ...base, fareBreakdown };
  }));
  res.json({
    rides: formatted.reverse(),
    total: rides.length,
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
  res.json({ methods: methods.filter(m => m.enabled) });
});

router.get("/:id", customerAuth, async (req, res) => {
  const callerId = req.customerId!;

  const rideId = String(req.params["id"]);
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }

  const isCustomer = ride.userId  === callerId;
  const isRider    = ride.riderId === callerId;
  if (!isCustomer && !isRider) {
    res.status(403).json({ error: "Access denied — not your ride" }); return;
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
        .where(and(eq(rideBidsTable.rideId, rideId), eq(rideBidsTable.status, "pending")))
        .orderBy(rideBidsTable.createdAt)
    : [];

  const formattedBids = await Promise.all(bids.map(async (b) => {
    const [riderUser] = await db.select({
      vehiclePlate: usersTable.vehiclePlate,
      vehicleType:  usersTable.vehicleType,
    }).from(usersTable).where(eq(usersTable.id, b.riderId)).limit(1);

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
    } catch {}
  }

  res.json({ ...formatRide(ride), riderName, riderPhone, bids: formattedBids, riderLat, riderLng, riderLocAge, riderAvgRating, fareBreakdown });
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

  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }
  if (ride.userId !== callerId && ride.riderId !== callerId) {
    res.status(403).json({ error: "Access denied — not your ride" }); return;
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

  res.json({
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
    res.status(400).json({ error: parsed.error.issues[0]?.message || "event is required" });
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

  res.json({ success: true, id });
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

  res.json({ logs: formatted, total: formatted.length });
});

router.post("/:id/rate", customerAuth, requireRideState(["completed"]), requireRideOwner("userId"), async (req, res) => {
  const parsed = rateRideSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: parsed.error.issues[0]?.message || "stars must be between 1 and 5" }); return;
  }

  const ride = req.ride!;
  const userId = req.customerId!;
  const rideId = ride.id;
  const { stars, comment } = parsed.data;

  if (!ride.riderId) { res.status(400).json({ error: "No rider assigned" }); return; }

  /* Explicit self-rating guard: customer cannot be the same person as the rider */
  if (ride.riderId === userId) {
    res.status(403).json({ error: "You cannot rate yourself." });
    return;
  }

  const existing = await db.select({ id: rideRatingsTable.id }).from(rideRatingsTable).where(eq(rideRatingsTable.rideId, rideId)).limit(1);
  if (existing.length > 0) { res.status(409).json({ error: "Already rated" }); return; }

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

  res.json({ success: true, rating });
});

router.get("/:id/status", customerAuth, loadRide(), requireRideOwner("userId"), async (req, res) => {
  const ride = req.ride!;
  const rideId = ride.id;

  const attempts = (ride.dispatchAttempts as string[] | null) || [];
  const hasRating = await db.select({ id: rideRatingsTable.id }).from(rideRatingsTable).where(eq(rideRatingsTable.rideId, rideId)).limit(1);

  res.json({
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

  res.json({
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

  res.json({ success: true, message: "Dispatch restarted" });
});

let dispatchCycleRunning = false;
async function runDispatchCycle() {
  if (dispatchCycleRunning) return;
  dispatchCycleRunning = true;
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

    const DISPATCH_ROUND_INTERVAL_SEC = 45;
    const MAX_DISPATCH_ROUNDS = 3;

    for (const ride of pendingRides) {
      try {
        const createdMs = new Date(ride.createdAt!).getTime();
        const elapsedSec = (Date.now() - createdMs) / 1000;

        if (elapsedSec > totalTimeoutSec) {
          await db.transaction(async (tx) => {
            const [upd] = await tx.update(ridesTable)
              .set({ status: "expired", updatedAt: new Date() })
              .where(and(eq(ridesTable.id, ride.id), isNull(ridesTable.riderId)))
              .returning({ id: ridesTable.id });
            if (!upd) return;

            if (ride.paymentMethod === "wallet") {
              const rideRef = `ride:${ride.id}`;
              const [debitTx] = await tx.select({ id: walletTransactionsTable.id })
                .from(walletTransactionsTable)
                .where(and(
                  eq(walletTransactionsTable.userId, ride.userId),
                  eq(walletTransactionsTable.type, "debit"),
                  eq(walletTransactionsTable.reference, rideRef),
                )).limit(1);
              if (debitTx) {
                const refundAmt = parseFloat(ride.fare!);
                await tx.update(usersTable)
                  .set({ walletBalance: sql`wallet_balance + ${refundAmt}`, updatedAt: new Date() })
                  .where(eq(usersTable.id, ride.userId));
                await tx.insert(walletTransactionsTable).values({
                  id: generateId(), userId: ride.userId, type: "credit",
                  amount: refundAmt.toFixed(2),
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

          await cleanupNotifiedRiders(ride.id);
          continue;
        }

        // Dispatch in rounds: each round lasts DISPATCH_ROUND_INTERVAL_SEC seconds.
        // After MAX_DISPATCH_ROUNDS rounds with no acceptance, mark no_riders and stop.
        const currentRound = Math.floor(elapsedSec / DISPATCH_ROUND_INTERVAL_SEC);
        const loopCount = ride.dispatchLoopCount ?? 0;

        if (currentRound >= MAX_DISPATCH_ROUNDS) {
          await db.transaction(async (tx) => {
            const [upd] = await tx.update(ridesTable)
              .set({ status: "no_riders", updatedAt: new Date() })
              .where(and(eq(ridesTable.id, ride.id), isNull(ridesTable.riderId)))
              .returning({ id: ridesTable.id });
            if (!upd) return;

            if (ride.paymentMethod === "wallet") {
              const rideRef = `ride:${ride.id}`;
              const [debitTx] = await tx.select({ id: walletTransactionsTable.id })
                .from(walletTransactionsTable)
                .where(and(
                  eq(walletTransactionsTable.userId, ride.userId),
                  eq(walletTransactionsTable.type, "debit"),
                  eq(walletTransactionsTable.reference, rideRef),
                )).limit(1);
              if (debitTx) {
                const refundAmt = parseFloat(ride.fare!);
                await tx.update(usersTable)
                  .set({ walletBalance: sql`wallet_balance + ${refundAmt}`, updatedAt: new Date() })
                  .where(eq(usersTable.id, ride.userId));
                await tx.insert(walletTransactionsTable).values({
                  id: generateId(), userId: ride.userId, type: "credit",
                  amount: refundAmt.toFixed(2),
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
        logger.error(`[dispatch-engine] Error processing ride ${ride.id}:`, rideErr);
      }
    }
  } catch (err) {
    logger.error("[dispatch-engine] cycle error:", err);
  } finally {
    dispatchCycleRunning = false;
  }
}

let dispatchInterval: ReturnType<typeof setInterval> | null = null;
export function startDispatchEngine() {
  if (dispatchInterval) return;
  dispatchInterval = setInterval(runDispatchCycle, 10_000);
  logger.info("[dispatch-engine] started (every 10s)");
  runDispatchCycle();
}

export default router;
