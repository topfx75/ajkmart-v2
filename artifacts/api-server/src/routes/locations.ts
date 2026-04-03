import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { liveLocationsTable, locationLogsTable, ridesTable, ordersTable, usersTable } from "@workspace/db/schema";
import { eq, and, gte, lte, asc, or, desc } from "drizzle-orm";
import {
  getCachedSettings,
  detectGPSSpoof,
  addSecurityEvent,
  getClientIp,
  verifyUserJwt,
  customerAuth,
} from "../middleware/security.js";
import { generateId } from "../lib/id.js";
import { emitRiderLocation, emitCustomerLocation, emitRiderForVendor, getIO } from "../lib/socketio.js";
import { sendSuccess, sendError, sendNotFound, sendForbidden, sendUnauthorized, sendValidationError } from "../lib/response.js";

const router: IRouter = Router();

/* Per-rider GPS violation counter (in-memory, resets on server restart) */
const gpsViolationCounts = new Map<string, { count: number; lastAt: number }>();

/* Haversine distance in meters */
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* Haversine speed in km/h */
function speedKmh(lat1: number, lon1: number, t1: Date, lat2: number, lon2: number, t2: Date): number {
  const distM = distanceMeters(lat1, lon1, lat2, lon2);
  const secs = (t2.getTime() - t1.getTime()) / 1000;
  if (secs <= 0) return 0;
  return (distM / 1000) / (secs / 3600);
}

/* Process a single location update — shared between /update and /batch */
async function processLocationUpdate(opts: {
  userId: string;
  effectiveRole: string;
  lat: number;
  lon: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  batteryLevel?: number;
  mockProvider?: boolean;
  action?: string | null;
  ip: string;
  settings: Record<string, string>;
  now: Date;
}): Promise<{ skip: boolean; spoofed: boolean; autoOffline: boolean; skipReason?: string }> {
  const { userId, effectiveRole, lat, lon, ip, settings, now } = opts;

  let isSpoofed = false;

  const needsSpoofCheck = settings["security_spoof_detection"] === "on" && effectiveRole === "rider";
  const minDistanceMeters = parseInt(settings["gps_min_distance_meters"] ?? "25", 10);
  const needsDistanceCheck = effectiveRole === "rider" && minDistanceMeters > 0;
  const MAX_SPEED_KMH = 300;

  let autoOffline = false;

  /* ── mockProvider + emulator-signature checks ALWAYS run (even on first ping, no prev needed) ── */
  if (needsSpoofCheck) {
    const mockFlagged = opts.mockProvider === true;

    /* Emulator signature detection: known emulator default coordinates + impossible accuracy.
       These checks do NOT require a previous location — they apply on every ping including first. */
    const isEmulatorCoord = (
      /* Android emulator default: Googleplex, Mountain View */
      (Math.abs(lat - 37.4219983) < 0.0001 && Math.abs(lon - (-122.084)) < 0.0001) ||
      /* Genymotion default: Paris */
      (Math.abs(lat - 48.8534) < 0.0001 && Math.abs(lon - 2.3488) < 0.0001) ||
      /* BlueStacks default: San Francisco */
      (Math.abs(lat - 37.3861) < 0.0001 && Math.abs(lon - (-122.0839)) < 0.0001) ||
      /* Exact 0,0 origin (equator/prime meridian — impossible for a real moving rider) */
      (lat === 0 && lon === 0) ||
      /* Exactly round integer coordinates with 0 accuracy — simulator signature */
      (opts.accuracy === 0 && Number.isInteger(lat) && Number.isInteger(lon))
    );
    const emulatorFlagged = isEmulatorCoord;

    if (mockFlagged || emulatorFlagged) {
      isSpoofed = true;
      const reason = emulatorFlagged
        ? "Emulator signature detected — known fake GPS coordinates"
        : "Mock GPS provider detected";

      addSecurityEvent({
        type: "gps_spoof_detected",
        ip,
        userId,
        details: `GPS spoof: ${reason}`,
        severity: "high",
      });

      const existing = gpsViolationCounts.get(userId);
      const newCount = (existing?.count ?? 0) + 1;
      gpsViolationCounts.set(userId, { count: newCount, lastAt: Date.now() });

      if (newCount >= 3) {
        gpsViolationCounts.delete(userId);
        try {
          await db.update(usersTable)
            .set({ isOnline: false, updatedAt: now })
            .where(eq(usersTable.id, userId));
          autoOffline = true;
          const io = getIO();
          if (io) {
            io.to("admin-fleet").emit("rider:spoof-alert", {
              userId, reason, autoOffline: true, sentAt: now.toISOString(),
            });
          }
        } catch {}
      }

      return { skip: true, spoofed: true, autoOffline };
    }
  }

  if (needsSpoofCheck || needsDistanceCheck) {
    const [prev] = await db
      .select()
      .from(liveLocationsTable)
      .where(eq(liveLocationsTable.userId, userId))
      .limit(1);

    if (prev) {
      const prevLat = parseFloat(String(prev.latitude));
      const prevLon = parseFloat(String(prev.longitude));

      /* GPS Spoof Detection: speed > configurable max (default 300 km/h) */
      if (needsSpoofCheck) {
        const configMaxSpeed = parseInt(settings["security_max_speed_kmh"] ?? "150", 10);
        const effectiveMaxSpeed = Math.max(configMaxSpeed, MAX_SPEED_KMH);
        const { spoofed, speedKmh: detectedSpeedKmh } = detectGPSSpoof(prevLat, prevLon, prev.updatedAt, lat, lon, effectiveMaxSpeed);

        if (spoofed) {
          isSpoofed = true;
          const reason = `Speed ${detectedSpeedKmh.toFixed(1)} km/h exceeds ${effectiveMaxSpeed} km/h`;

          addSecurityEvent({
            type: "gps_spoof_detected",
            ip,
            userId,
            details: `GPS spoof: ${reason}`,
            severity: "high",
          });

          /* Track consecutive violations */
          const existing = gpsViolationCounts.get(userId);
          const newCount = (existing?.count ?? 0) + 1;
          gpsViolationCounts.set(userId, { count: newCount, lastAt: Date.now() });

          /* After 3 consecutive violations: auto-set offline + alert admin */
          if (newCount >= 3) {
            gpsViolationCounts.delete(userId);
            try {
              await db.update(usersTable)
                .set({ isOnline: false, updatedAt: now })
                .where(eq(usersTable.id, userId));
              autoOffline = true;
              /* Emit alert to admin-fleet */
              const io = getIO();
              if (io) {
                io.to("admin-fleet").emit("rider:spoof-alert", {
                  userId,
                  reason,
                  autoOffline: true,
                  sentAt: now.toISOString(),
                });
              }
            } catch {}
          }

          return { skip: true, spoofed: true, autoOffline };
        }

        /* Clear violation count on valid ping */
        if (gpsViolationCounts.has(userId)) {
          gpsViolationCounts.delete(userId);
        }
      }

      /* Distance Throttling */
      if (needsDistanceCheck) {
        const dist = distanceMeters(prevLat, prevLon, lat, lon);
        if (dist < minDistanceMeters) {
          return { skip: true, spoofed: false, autoOffline: false, skipReason: "distance_threshold" };
        }
      }
    }
  }

  /* Write to location_logs */
  await db.insert(locationLogsTable).values({
    id: generateId(),
    userId,
    role: effectiveRole,
    latitude: lat.toString(),
    longitude: lon.toString(),
    accuracy: opts.accuracy !== undefined ? opts.accuracy : null,
    speed: opts.speed !== undefined ? opts.speed : null,
    heading: opts.heading !== undefined ? opts.heading : null,
    batteryLevel: opts.batteryLevel !== undefined ? opts.batteryLevel : null,
    isSpoofed,
    createdAt: now,
  });

  /* Update live_locations */
  await db.insert(liveLocationsTable).values({
    userId,
    latitude: lat.toString(),
    longitude: lon.toString(),
    role: effectiveRole,
    action: opts.action ?? null,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: liveLocationsTable.userId,
    set: {
      latitude: lat.toString(),
      longitude: lon.toString(),
      role: effectiveRole,
      action: opts.action ?? null,
      updatedAt: now,
    },
  });

  return { skip: false, spoofed: false, autoOffline: false };
}

/* Broadcast rider location via Socket.io */
async function broadcastRiderLocation(userId: string, lat: number, lon: number, opts: {
  accuracy?: number;
  speed?: number;
  heading?: number;
  batteryLevel?: number;
  action?: string | null;
  updatedAt: string;
}) {
  let serverRideId: string | null = null;
  let serverVendorId: string | null = null;
  let serverOrderId: string | null = null;
  let vehicleType: string | null = null;
  let currentTripId: string | null = null;

  /* Fetch rider's vehicle type from users table (for map markers) */
  try {
    const [rider] = await db.select({ vehicleType: usersTable.vehicleType })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    vehicleType = rider?.vehicleType ?? null;
  } catch {}

  /* Find active ride (for currentTripId) */
  try {
    const [activeRide] = await db.select({ id: ridesTable.id })
      .from(ridesTable)
      .where(and(
        eq(ridesTable.riderId, userId),
        or(
          eq(ridesTable.status, "accepted"),
          eq(ridesTable.status, "arrived"),
          eq(ridesTable.status, "in_transit"),
          eq(ridesTable.status, "picked_up"),
          eq(ridesTable.status, "in_progress"),
        ),
      ))
      .orderBy(desc(ridesTable.updatedAt))
      .limit(1);
    serverRideId = activeRide?.id ?? null;
    currentTripId = serverRideId;
  } catch {}

  /* Find active order if no ride trip */
  try {
    const [activeOrder] = await db.select({ id: ordersTable.id, vendorId: ordersTable.vendorId })
      .from(ordersTable)
      .where(and(
        eq(ordersTable.riderId, userId),
        or(eq(ordersTable.status, "out_for_delivery"), eq(ordersTable.status, "picked_up")),
      ))
      .limit(1);
    serverVendorId = activeOrder?.vendorId ?? null;
    serverOrderId = activeOrder?.id ?? null;
    if (!currentTripId && serverOrderId) currentTripId = serverOrderId;
  } catch {}

  emitRiderLocation({
    userId,
    latitude: lat,
    longitude: lon,
    accuracy: opts.accuracy,
    speed: opts.speed,
    heading: opts.heading,
    batteryLevel: opts.batteryLevel,
    action: opts.action ?? null,
    rideId: serverRideId,
    vendorId: serverVendorId,
    orderId: serverOrderId,
    vehicleType,
    currentTripId,
    updatedAt: opts.updatedAt,
  });
}

router.post("/update", async (req, res) => {
  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const jwtPayload = verifyUserJwt(authHeader.slice(7));
  if (!jwtPayload?.userId) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  const userId = jwtPayload.userId;
  const effectiveRole = jwtPayload.role || "customer";

  const { latitude, longitude, accuracy, speed, heading, batteryLevel, action, mockProvider } = req.body;
  if (latitude == null || longitude == null) {
    res.status(400).json({ error: "latitude and longitude are required" });
    return;
  }

  const ip = getClientIp(req);
  const lat = parseFloat(latitude);
  const lon = parseFloat(longitude);

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    res.status(400).json({ error: "Invalid latitude or longitude values" });
    return;
  }

  const settings = await getCachedSettings();

  if (settings["security_gps_tracking"] === "off" && effectiveRole === "rider") {
    res.status(403).json({ error: "GPS tracking is currently disabled by admin." });
    return;
  }

  if (accuracy !== undefined) {
    const minAccuracyMeters = parseInt(settings["security_gps_accuracy"] ?? "50", 10);
    if (parseFloat(accuracy) > minAccuracyMeters) {
      req.log?.warn?.({ userId, accuracy }, "GPS accuracy below threshold");
    }
  }

  const now = new Date();
  const result = await processLocationUpdate({
    userId, effectiveRole, lat, lon,
    accuracy: accuracy !== undefined ? parseFloat(accuracy) : undefined,
    speed: speed !== undefined ? parseFloat(speed) : undefined,
    heading: heading !== undefined ? parseFloat(heading) : undefined,
    batteryLevel: batteryLevel !== undefined ? parseFloat(batteryLevel) : undefined,
    mockProvider: mockProvider === true || mockProvider === "true",
    action: action ?? null,
    ip, settings, now,
  });

  if (result.skip) {
    if (result.spoofed) {
      res.status(400).json({
        error: "GPS location rejected: movement speed is physically impossible or mock GPS detected. Please disable mock location apps.",
        autoOffline: result.autoOffline,
      });
      return;
    }
    res.json({ success: true, skipped: true, reason: result.skipReason, updatedAt: now.toISOString() });
    return;
  }

  const updatedAt = now.toISOString();

  if (effectiveRole === "rider") {
    await broadcastRiderLocation(userId, lat, lon, {
      accuracy: accuracy !== undefined ? parseFloat(accuracy) : undefined,
      speed: speed !== undefined ? parseFloat(speed) : undefined,
      heading: heading !== undefined ? parseFloat(heading) : undefined,
      batteryLevel: batteryLevel !== undefined ? parseFloat(batteryLevel) : undefined,
      action: action ?? null,
      updatedAt,
    });
  } else if (effectiveRole === "customer") {
    emitCustomerLocation({ userId, latitude: lat, longitude: lon, updatedAt });
  }

  res.json({ success: true, updatedAt });
});

/* ── POST /locations/batch — Replay queued GPS pings from IndexedDB (offline mode) ──
   Accepts an array of pings sorted by timestamp. Each ping is replayed in order.
   Spoofed pings are rejected silently (logged but not included in response). */
router.post("/batch", async (req, res) => {
  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const jwtPayload = verifyUserJwt(authHeader.slice(7));
  if (!jwtPayload?.userId) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  const userId = jwtPayload.userId;
  const effectiveRole = jwtPayload.role || "rider";

  const { pings } = req.body;
  if (!Array.isArray(pings) || pings.length === 0) {
    res.status(400).json({ error: "pings must be a non-empty array" });
    return;
  }
  if (pings.length > 500) {
    res.status(400).json({ error: "Maximum 500 pings per batch" });
    return;
  }

  const settings = await getCachedSettings();

  /* Enforce GPS tracking gate — same as /locations/update */
  if (settings["security_gps_tracking"] === "off" && effectiveRole === "rider") {
    res.status(403).json({ error: "GPS tracking is currently disabled by admin." });
    return;
  }
  const ip = getClientIp(req);
  let processed = 0;
  let skipped = 0;
  let lastUpdatedAt = new Date().toISOString();
  let lastValidPing: typeof pings[0] | null = null;
  let lastValidLat = 0;
  let lastValidLon = 0;

  /* Sort by timestamp to replay in chronological order */
  const sorted = [...pings].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta - tb;
  });

  for (const ping of sorted) {
    const lat = parseFloat(ping.latitude);
    const lon = parseFloat(ping.longitude);
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) { skipped++; continue; }

    const now = ping.timestamp ? new Date(ping.timestamp) : new Date();
    const result = await processLocationUpdate({
      userId, effectiveRole, lat, lon,
      accuracy: ping.accuracy !== undefined ? parseFloat(ping.accuracy) : undefined,
      speed: ping.speed !== undefined ? parseFloat(ping.speed) : undefined,
      heading: ping.heading !== undefined ? parseFloat(ping.heading) : undefined,
      batteryLevel: ping.batteryLevel !== undefined ? parseFloat(ping.batteryLevel) : undefined,
      mockProvider: ping.mockProvider === true,
      action: ping.action ?? null,
      ip, settings, now,
    });

    if (result.skip) { skipped++; continue; }
    processed++;
    lastUpdatedAt = now.toISOString();
    lastValidPing = ping;
    lastValidLat = lat;
    lastValidLon = lon;
  }

  /* Broadcast the final valid position to admin fleet after the loop */
  if (processed > 0 && lastValidPing !== null && effectiveRole === "rider") {
    await broadcastRiderLocation(userId, lastValidLat, lastValidLon, {
      accuracy: lastValidPing.accuracy !== undefined ? parseFloat(lastValidPing.accuracy) : undefined,
      speed: lastValidPing.speed !== undefined ? parseFloat(lastValidPing.speed) : undefined,
      heading: lastValidPing.heading !== undefined ? parseFloat(lastValidPing.heading) : undefined,
      batteryLevel: lastValidPing.batteryLevel !== undefined ? parseFloat(lastValidPing.batteryLevel) : undefined,
      action: lastValidPing.action ?? null,
      updatedAt: lastUpdatedAt,
    });
  }

  res.json({ success: true, processed, skipped, lastUpdatedAt });
});

/* ── DELETE /locations/clear — clear authenticated user's live location on logout ── */
router.delete("/clear", async (req, res) => {
  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const jwtPayload = verifyUserJwt(authHeader.slice(7));
  if (!jwtPayload?.userId) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  const userId = jwtPayload.userId;

  await db.delete(liveLocationsTable).where(eq(liveLocationsTable.userId, userId));
  res.json({ success: true });
});

/* ── GET /locations/:userId — fetch current location (auth required) ── */
router.get("/:userId", customerAuth, async (req, res) => {
  const settings = await getCachedSettings();
  if ((settings["feature_live_tracking"] ?? "on") === "off") {
    res.status(503).json({ error: "Live GPS tracking is currently disabled." });
    return;
  }
  const [loc] = await db
    .select()
    .from(liveLocationsTable)
    .where(eq(liveLocationsTable.userId, String(req.params["userId"])))
    .limit(1);
  if (!loc) { res.status(404).json({ error: "Location not found" }); return; }
  res.json({
    userId: loc.userId,
    latitude: parseFloat(String(loc.latitude)),
    longitude: parseFloat(String(loc.longitude)),
    role: loc.role,
    updatedAt: loc.updatedAt.toISOString(),
  });
});

export default router;
