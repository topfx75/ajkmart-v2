import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { liveLocationsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  getCachedSettings,
  detectGPSSpoof,
  addSecurityEvent,
  getClientIp,
  verifyUserJwt,
} from "../middleware/security.js";

const router: IRouter = Router();

router.post("/update", async (req, res) => {
  /* Prefer userId from a valid JWT; fall back to body for riders/vendors that send their own token */
  let userId: string | undefined = req.body.userId;
  const authHeader = req.headers.authorization ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const payload = verifyUserJwt(authHeader.slice(7));
    if (payload?.sub) userId = payload.sub;
  }

  const { latitude, longitude, role, accuracy } = req.body;
  if (!userId || !latitude || !longitude) {
    res.status(400).json({ error: "Authentication required (or userId, latitude and longitude are required)" });
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

  /* ── GPS Tracking gate (fail-fast before any DB work) ── */
  if (settings["security_gps_tracking"] === "off" && role === "rider") {
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

  /* ── GPS Spoof Detection (riders only — uses previous stored location) ── */
  if (settings["security_spoof_detection"] === "on" && role === "rider") {
    const maxSpeedKmh = parseInt(settings["security_max_speed_kmh"] ?? "150", 10);

    const [prev] = await db
      .select()
      .from(liveLocationsTable)
      .where(eq(liveLocationsTable.userId, userId))
      .limit(1);

    if (prev) {
      const prevLat = parseFloat(String(prev.latitude));
      const prevLon = parseFloat(String(prev.longitude));
      const prevTime = prev.updatedAt;

      const { spoofed, speedKmh } = detectGPSSpoof(prevLat, prevLon, prevTime, lat, lon, maxSpeedKmh);

      if (spoofed) {
        addSecurityEvent({
          type: "gps_spoof_detected",
          ip,
          userId,
          details: `GPS spoof detected: speed ${speedKmh.toFixed(1)} km/h exceeds limit of ${maxSpeedKmh} km/h`,
          severity: "high",
        });
        res.status(400).json({
          error: "GPS location rejected: movement speed is physically impossible. Please disable mock location apps.",
          detectedSpeedKmh: Math.round(speedKmh),
          maxAllowedKmh: maxSpeedKmh,
        });
        return;
      }
    }
  }

  /* ── Geofence mode (stub — requires polygon config) ── */
  if (settings["security_geo_fence"] === "on") {
    /* Strict geofence would reject lat/lon outside allowed boundary polygon.
       Requires a configured boundary — aspirational without polygon data. */
  }

  const action: string | null = req.body.action ?? null;

  await db.insert(liveLocationsTable).values({
    userId,
    latitude:  lat.toString(),
    longitude: lon.toString(),
    role:      role || "customer",
    action,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: liveLocationsTable.userId,
    set: {
      latitude:  lat.toString(),
      longitude: lon.toString(),
      action,
      updatedAt: new Date(),
    },
  });

  res.json({ success: true, updatedAt: new Date().toISOString() });
});

/* ── GET /locations/:userId — fetch current location ── */
router.get("/:userId", async (req, res) => {
  const settings = await getCachedSettings();
  if ((settings["feature_live_tracking"] ?? "on") === "off") {
    res.status(503).json({ error: "Live GPS tracking is currently disabled." });
    return;
  }
  const [loc] = await db
    .select()
    .from(liveLocationsTable)
    .where(eq(liveLocationsTable.userId, req.params["userId"]!))
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
