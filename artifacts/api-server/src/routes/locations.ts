import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { liveLocationsTable, locationLogsTable, ridesTable, ordersTable } from "@workspace/db/schema";
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
import { emitRiderLocation, emitCustomerLocation, emitRiderForVendor } from "../lib/socketio.js";

const router: IRouter = Router();

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

router.post("/update", async (req, res) => {
  /* Strict JWT auth — userId and role MUST come from the verified JWT.
     Body identity fields (userId, role) are ignored to prevent IDOR/role-spoofing. */
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

  const { latitude, longitude, accuracy, speed, heading, batteryLevel, action } = req.body;
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

  /* ── GPS Tracking gate ── */
  if (settings["security_gps_tracking"] === "off" && effectiveRole === "rider") {
    res.status(403).json({ error: "GPS tracking is currently disabled by admin." });
    return;
  }

  /* ── GPS Accuracy check ── */
  if (accuracy !== undefined) {
    const minAccuracyMeters = parseInt(settings["security_gps_accuracy"] ?? "50", 10);
    if (parseFloat(accuracy) > minAccuracyMeters) {
      req.log?.warn?.({ userId, accuracy }, "GPS accuracy below threshold");
    }
  }

  let isSpoofed = false;

  /* ── Single DB lookup for both spoof detection and distance throttling (riders only) ── */
  const needsSpoofCheck = settings["security_spoof_detection"] === "on" && effectiveRole === "rider";
  const minDistanceMeters = parseInt(settings["gps_min_distance_meters"] ?? "25", 10);
  const needsDistanceCheck = effectiveRole === "rider" && minDistanceMeters > 0;

  if (needsSpoofCheck || needsDistanceCheck) {
    const [prev] = await db
      .select()
      .from(liveLocationsTable)
      .where(eq(liveLocationsTable.userId, userId))
      .limit(1);

    if (prev) {
      const prevLat = parseFloat(String(prev.latitude));
      const prevLon = parseFloat(String(prev.longitude));

      /* GPS Spoof Detection */
      if (needsSpoofCheck) {
        const maxSpeedKmh = parseInt(settings["security_max_speed_kmh"] ?? "150", 10);
        const { spoofed, speedKmh } = detectGPSSpoof(prevLat, prevLon, prev.updatedAt, lat, lon, maxSpeedKmh);
        if (spoofed) {
          isSpoofed = true;
          addSecurityEvent({
            type: "gps_spoof_detected",
            ip,
            userId,
            details: `GPS spoof detected: speed ${speedKmh.toFixed(1)} km/h exceeds limit of ${parseInt(settings["security_max_speed_kmh"] ?? "150", 10)} km/h`,
            severity: "high",
          });
          res.status(400).json({
            error: "GPS location rejected: movement speed is physically impossible. Please disable mock location apps.",
            detectedSpeedKmh: Math.round(speedKmh),
            maxAllowedKmh: parseInt(settings["security_max_speed_kmh"] ?? "150", 10),
          });
          return;
        }
      }

      /* Distance Throttling */
      if (needsDistanceCheck) {
        const dist = distanceMeters(prevLat, prevLon, lat, lon);
        if (dist < minDistanceMeters) {
          res.json({ success: true, skipped: true, reason: "distance_threshold", updatedAt: new Date().toISOString() });
          return;
        }
      }
    }
  }

  const now = new Date();

  /* ── Write to location_logs ── */
  await db.insert(locationLogsTable).values({
    id: generateId(),
    userId,
    role: effectiveRole,
    latitude: lat.toString(),
    longitude: lon.toString(),
    accuracy: accuracy !== undefined ? parseFloat(accuracy) : null,
    speed: speed !== undefined ? parseFloat(speed) : null,
    heading: heading !== undefined ? parseFloat(heading) : null,
    batteryLevel: batteryLevel !== undefined ? parseFloat(batteryLevel) : null,
    isSpoofed,
    createdAt: now,
  });

  /* ── Update live_locations ── */
  await db.insert(liveLocationsTable).values({
    userId,
    latitude: lat.toString(),
    longitude: lon.toString(),
    role: effectiveRole,
    action: action ?? null,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: liveLocationsTable.userId,
    set: {
      latitude: lat.toString(),
      longitude: lon.toString(),
      action: action ?? null,
      updatedAt: now,
    },
  });

  const updatedAt = now.toISOString();

  /* ── Broadcast via Socket.io ── */
  if (effectiveRole === "rider") {
    /* Derive rideId and vendorId from DB — never trust client-supplied values
       to prevent unauthorized injection into arbitrary ride:{rideId} rooms. */
    let serverRideId: string | null = null;
    let serverVendorId: string | null = null;
    let serverOrderId: string | null = null;
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
    } catch {}
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
    } catch {}

    emitRiderLocation({
      userId,
      latitude: lat,
      longitude: lon,
      accuracy: accuracy !== undefined ? parseFloat(accuracy) : undefined,
      speed: speed !== undefined ? parseFloat(speed) : undefined,
      heading: heading !== undefined ? parseFloat(heading) : undefined,
      batteryLevel: batteryLevel !== undefined ? parseFloat(batteryLevel) : undefined,
      action: action ?? null,
      rideId: serverRideId,
      vendorId: serverVendorId,
      orderId: serverOrderId,
      updatedAt,
    });
  } else if (effectiveRole === "customer") {
    emitCustomerLocation({ userId, latitude: lat, longitude: lon, updatedAt });
  }

  res.json({ success: true, updatedAt });
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
