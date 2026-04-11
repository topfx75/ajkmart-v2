import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "http";
import { logger } from "./logger.js";
import { verifyUserJwt, verifyAdminJwt } from "../middleware/security.js";
import { db } from "@workspace/db";
import { ridesTable, ordersTable, parcelBookingsTable, pharmacyOrdersTable, liveLocationsTable, usersTable, locationHistoryTable } from "@workspace/db/schema";
import { eq, or, and, sql, lt, lte } from "drizzle-orm";

/* ── Server-side GPS broadcast throttle: max 1 emit per rider per 1500ms ── */
const RIDER_LOC_THROTTLE_MS = 1500;
const _riderLocLastEmit = new Map<string, number>();

let _io: SocketIOServer | null = null;

/* ── Per-connection verified-session cache ────────────────────────────────
   JWT verification is CPU-expensive (HMAC-SHA256).  Within a single socket
   connection the token never changes, so we cache the decoded payload keyed
   by socket ID and clear the entry on disconnect.
   Value shape: { payload: JwtPayload | null } — null means the token was
   invalid; we store that too so we never retry a known-bad token.          */
type CachedSession = { userId: string; role?: string; roles?: string[] } | null;
const _sessionCache = new Map<string, CachedSession>();

function getCachedSession(socketId: string, token: string | null): CachedSession {
  if (_sessionCache.has(socketId)) return _sessionCache.get(socketId)!;
  if (!token) {
    _sessionCache.set(socketId, null);
    return null;
  }
  const payload = verifyUserJwt(token);
  const session: CachedSession = payload?.userId
    ? { userId: payload.userId, role: payload.role, roles: payload.roles }
    : null;
  _sessionCache.set(socketId, session);
  return session;
}

/**
 * Pending ride-room buffers: while a socket is in the async authorization
 * window for a ride room, outbound rider:location payloads destined for that
 * room are buffered here so they are not silently dropped.
 * Key: `${socketId}::${roomName}` → array of payloads to replay.
 */
const _pendingRideJoins = new Map<string, unknown[]>();

function bufferKey(socketId: string, room: string): string {
  return `${socketId}::${room}`;
}

/* ── JWT helpers ── */
function extractBearerToken(header: string | string[] | undefined): string | null {
  const h = Array.isArray(header) ? header[0] : header;
  if (!h) return null;
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

function getTokenFromHandshake(
  headers: Record<string, string | string[] | undefined>,
  auth: Record<string, unknown>,
): string | null {
  return (
    extractBearerToken(headers["authorization"]) ??
    (typeof auth["token"] === "string" ? auth["token"] : null)
  );
}

/* ── Room authorization ── */

function isAuthorizedForAdminFleet(
  headers: Record<string, string | string[] | undefined>,
  query: Record<string, unknown>,
  auth: Record<string, unknown>,
): boolean {
  const candidates: Array<string | undefined> = [
    query["adminToken"] as string | undefined,
    auth["adminToken"] as string | undefined,
    Array.isArray(headers["x-admin-token"]) ? headers["x-admin-token"][0] : headers["x-admin-token"] as string | undefined,
  ];
  for (const token of candidates) {
    if (token && verifyAdminJwt(token)) return true;
  }
  const bearer = extractBearerToken(headers["authorization"]);
  if (bearer) {
    const payload = verifyUserJwt(bearer);
    if (payload && (payload.role === "admin" || payload.roles?.includes("admin"))) return true;
  }
  return false;
}

function isAuthorizedForVendorRoom(
  vendorId: string,
  socketId: string,
  headers: Record<string, string | string[] | undefined>,
  auth: Record<string, unknown>,
): boolean {
  const bearer = getTokenFromHandshake(headers, auth);
  const session = getCachedSession(socketId, bearer);
  if (!session) return false;
  return session.userId === vendorId && session.role === "vendor";
}

/** Verify user is a participant of an order (customer or assigned rider) */
async function isAuthorizedForOrderRoom(
  orderId: string,
  headers: Record<string, string | string[] | undefined>,
  auth: Record<string, unknown>,
): Promise<boolean> {
  const bearer = getTokenFromHandshake(headers, auth);
  if (!bearer) return false;
  const payload = verifyUserJwt(bearer);
  if (!payload) return false;
  const userId = payload.userId;

  try {
    /* Check mart/food orders */
    const [order] = await db
      .select({ userId: ordersTable.userId, riderId: ordersTable.riderId })
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .limit(1);
    if (order && (order.userId === userId || order.riderId === userId)) return true;

    /* Check parcel bookings */
    const [parcel] = await db
      .select({ userId: parcelBookingsTable.userId, riderId: parcelBookingsTable.riderId })
      .from(parcelBookingsTable)
      .where(eq(parcelBookingsTable.id, orderId))
      .limit(1);
    if (parcel && (parcel.userId === userId || parcel.riderId === userId)) return true;

    /* Check pharmacy orders */
    const [pharmacy] = await db
      .select({ userId: pharmacyOrdersTable.userId, riderId: pharmacyOrdersTable.riderId })
      .from(pharmacyOrdersTable)
      .where(eq(pharmacyOrdersTable.id, orderId))
      .limit(1);
    if (pharmacy && (pharmacy.userId === userId || pharmacy.riderId === userId)) return true;
  } catch {
    /* DB failure → deny */
  }

  return false;
}

/** Verify user is a participant of the ride (customer, assigned rider, or active order rider/vendor) */
async function isAuthorizedForRideRoom(
  rideId: string,
  headers: Record<string, string | string[] | undefined>,
  auth: Record<string, unknown>,
): Promise<boolean> {
  const bearer = getTokenFromHandshake(headers, auth);
  if (!bearer) return false;
  const payload = verifyUserJwt(bearer);
  if (!payload) return false;
  const userId = payload.userId;

  try {
    /* Check ride table: booking customer (userId) or assigned rider */
    const [ride] = await db
      .select({ userId: ridesTable.userId, riderId: ridesTable.riderId })
      .from(ridesTable)
      .where(eq(ridesTable.id, rideId))
      .limit(1);

    if (ride) {
      if (ride.userId === userId || ride.riderId === userId) return true;
    }

    /* Check orders table: rider or vendor for delivery orders that share this ride context */
    const [order] = await db
      .select({ riderId: ordersTable.riderId, vendorId: ordersTable.vendorId })
      .from(ordersTable)
      .where(and(
        eq(ordersTable.id, rideId),
        or(
          eq(ordersTable.riderId, userId),
          eq(ordersTable.vendorId, userId),
        ),
      ))
      .limit(1);

    if (order) return true;
  } catch {
    /* DB failure → deny */
  }

  return false;
}

export function initSocketIO(httpServer: HttpServer): SocketIOServer {
  const isDev = process.env.NODE_ENV !== "production";
  _io = new SocketIOServer(httpServer, {
    cors: {
      origin: isDev ? "*" : (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean),
      methods: ["GET", "POST"],
      credentials: !isDev,
    },
    path: "/api/socket.io",
    transports: ["polling", "websocket"],
  });

  _io.on("connection", (socket) => {
    const headers = socket.handshake.headers as Record<string, string | string[] | undefined>;
    const query = socket.handshake.query as Record<string, unknown>;
    const auth = (socket.handshake.auth ?? {}) as Record<string, unknown>;

    /* Auto-join non-ride rooms from the connection query string (synchronous auth) */
    const rooms = query["rooms"] as string | undefined;
    if (rooms) {
      const roomList = rooms.split(",").map(r => r.trim()).filter(Boolean);
      for (const room of roomList) {
        if (room === "admin-fleet") {
          if (isAuthorizedForAdminFleet(headers, query, auth)) {
            socket.join(room);
          } else {
            logger.debug({ socketId: socket.id, room }, "Socket denied admin-fleet (unauthorized)");
          }
        } else if (room.startsWith("vendor:")) {
          const vendorId = room.slice("vendor:".length);
          if (isAuthorizedForVendorRoom(vendorId, socket.id, headers, auth)) {
            socket.join(room);
          } else {
            logger.debug({ socketId: socket.id, room }, "Socket denied vendor room (unauthorized)");
          }
        } else if (room.startsWith("ride:")) {
          /* Ride rooms require async DB lookup — buffer outbound emits during authorization */
          const rideId = room.slice("ride:".length);
          const key = bufferKey(socket.id, room);
          _pendingRideJoins.set(key, []);
          isAuthorizedForRideRoom(rideId, headers, auth).then(ok => {
            const buffered = _pendingRideJoins.get(key) ?? [];
            _pendingRideJoins.delete(key);
            if (ok) {
              socket.join(room);
              for (const payload of buffered) {
                socket.emit("rider:location", payload);
              }
            } else {
              logger.debug({ socketId: socket.id, room }, "Socket denied ride room (not a participant)");
            }
          }).catch(() => { _pendingRideJoins.delete(key); });
        } else if (room.startsWith("order:")) {
          const orderId = room.slice("order:".length);
          isAuthorizedForOrderRoom(orderId, headers, auth).then(ok => {
            if (ok) {
              socket.join(room);
            } else {
              logger.debug({ socketId: socket.id, room }, "Socket denied order room (not a participant)");
            }
          }).catch(() => {});
        }
      }
    }

    /* Auto-join personal rooms for all authenticated users.
       Also primes the session cache for this connection. */
    const userToken = getTokenFromHandshake(headers, auth);
    const cachedSession = getCachedSession(socket.id, userToken);
    if (cachedSession?.userId) {
      socket.join(`rider:${cachedSession.userId}`);
      socket.join(`user:${cachedSession.userId}`);
    }

    /* Heartbeat: rider sends rider:heartbeat with batteryLevel, isOnline status is kept alive.
       Server relays the heartbeat to admin-fleet AND persists batteryLevel, lastSeen, lastActive,
       and isOnline to DB — all fire-and-forget so the socket never blocks. */
    socket.on("rider:heartbeat", (payload: { batteryLevel?: number; isOnline?: boolean }) => {
      try {
        const riderPay = cachedSession;
        if (!riderPay?.userId || riderPay.role !== "rider") return;
        const batteryLevel = typeof payload?.batteryLevel === "number" ? payload.batteryLevel : null;
        const isOnline = payload?.isOnline !== false;
        const now = new Date();

        /* 1. Update live_locations: battery level + lastSeen timestamp */
        db.update(liveLocationsTable)
          .set({ batteryLevel: batteryLevel ?? undefined, lastSeen: now, updatedAt: now })
          .where(eq(liveLocationsTable.userId, riderPay.userId))
          .catch(() => {});

        /* 2. Update users: isOnline flag + lastActive timestamp so the ghost-rider
              cleanup timer correctly uses lastActive as the freshness signal. */
        db.update(usersTable)
          .set({ isOnline, lastActive: now, updatedAt: now })
          .where(eq(usersTable.id, riderPay.userId))
          .catch(() => {});

        _io!.to("admin-fleet").emit("rider:heartbeat", {
          userId: riderPay.userId,
          batteryLevel,
          isOnline,
          sentAt: now.toISOString(),
        });
      } catch (err) {
        logger.error({ err, socketId: socket.id }, "rider:heartbeat handler error");
      }
    });

    /* SOS relay: rider sends rider:sos event, server broadcasts to admin-fleet */
    socket.on("rider:sos", (payload: { latitude?: number; longitude?: number; rideId?: string | null }) => {
      try {
        /* Use cached session — no redundant JWT verification */
        if (!cachedSession?.userId || cachedSession.role !== "rider") return;
        if (typeof payload?.latitude !== "number" || typeof payload?.longitude !== "number") return;
        /* Rebroadcast to admin-fleet with enriched payload */
        _io!.to("admin-fleet").emit("rider:sos", {
          userId: cachedSession.userId,
          name: "Rider",
          phone: null,
          latitude: payload.latitude,
          longitude: payload.longitude,
          rideId: payload.rideId ?? null,
          sentAt: new Date().toISOString(),
        });
      } catch (err) {
        logger.error({ err, socketId: socket.id }, "rider:sos handler error");
      }
    });

    /* Admin chat relay: admin sends message to specific rider */
    socket.on("admin:chat", (payload: { riderId: string; message: string }) => {
      try {
        if (!payload?.riderId || typeof payload.message !== "string") return;
        /* Only allow admins to send chat messages */
        if (!isAuthorizedForAdminFleet(headers, query, auth)) return;
        _io!.to(`rider:${payload.riderId}`).emit("admin:chat", {
          message: payload.message,
          sentAt: new Date().toISOString(),
          from: "admin",
        });
      } catch (err) {
        logger.error({ err, socketId: socket.id }, "admin:chat handler error");
      }
    });

    /* Rider reply chat relay: rider sends message back to admin */
    socket.on("rider:chat", (payload: { message: string }) => {
      try {
        /* Use cached session — no redundant JWT verification */
        if (!cachedSession?.userId || cachedSession.role !== "rider") return;
        if (typeof payload?.message !== "string" || !payload.message.trim()) return;
        /* Broadcast the rider's reply to all admin-fleet clients */
        _io!.to("admin-fleet").emit("rider:chat", {
          userId: cachedSession.userId,
          message: payload.message.trim(),
          sentAt: new Date().toISOString(),
          from: "rider",
        });
      } catch (err) {
        logger.error({ err, socketId: socket.id }, "rider:chat handler error");
      }
    });


    /* Join event: client can request additional rooms after connect */
    socket.on("join", (room: string) => {
      try {
        if (typeof room !== "string") return;

        if (room === "admin-fleet") {
          if (isAuthorizedForAdminFleet(headers, query, auth)) {
            socket.join(room);
            logger.debug({ socketId: socket.id, room }, "Socket joined admin-fleet");
          } else {
            logger.debug({ socketId: socket.id, room }, "Socket join denied admin-fleet (unauthorized)");
          }
        } else if (room.startsWith("vendor:")) {
          const vendorId = room.slice("vendor:".length);
          if (isAuthorizedForVendorRoom(vendorId, socket.id, headers, auth)) {
            socket.join(room);
            logger.debug({ socketId: socket.id, room }, "Socket joined vendor room");
          } else {
            logger.debug({ socketId: socket.id, room }, "Socket join denied vendor room (unauthorized)");
          }
        } else if (room.startsWith("ride:")) {
          const rideId = room.slice("ride:".length);
          const key = bufferKey(socket.id, room);
          _pendingRideJoins.set(key, []);
          isAuthorizedForRideRoom(rideId, headers, auth).then(ok => {
            const buffered = _pendingRideJoins.get(key) ?? [];
            _pendingRideJoins.delete(key);
            if (ok) {
              socket.join(room);
              for (const payload of buffered) {
                socket.emit("rider:location", payload);
              }
              logger.debug({ socketId: socket.id, room }, "Socket joined ride room");
            } else {
              logger.debug({ socketId: socket.id, room }, "Socket join denied ride room (not a participant)");
            }
          }).catch(() => { _pendingRideJoins.delete(key); });
        } else if (room.startsWith("order:")) {
          const orderId = room.slice("order:".length);
          isAuthorizedForOrderRoom(orderId, headers, auth).then(ok => {
            if (ok) {
              socket.join(room);
              logger.debug({ socketId: socket.id, room }, "Socket joined order room");
            } else {
              logger.debug({ socketId: socket.id, room }, "Socket join denied order room (not a participant)");
            }
          }).catch(() => {});
        }
      } catch (err) {
        logger.error({ err, socketId: socket.id, room }, "join handler error");
      }
    });

    socket.on("leave", (room: string) => {
      try {
        socket.leave(room);
      } catch (err) {
        logger.error({ err, socketId: socket.id, room }, "leave handler error");
      }
    });

    socket.on("disconnect", () => {
      try {
        /* Clean up any pending ride-room buffers for this socket */
        const prefix = `${socket.id}::`;
        for (const key of _pendingRideJoins.keys()) {
          if (key.startsWith(prefix)) _pendingRideJoins.delete(key);
        }

        /* Evict session cache entry — no longer needed after disconnect */
        _sessionCache.delete(socket.id);

        /* Use the already-resolved session (cached from connection handshake) */
        if (cachedSession?.userId && cachedSession.role === "rider") {
          const riderId = cachedSession.userId;
          const deleteWithRetry = (attempt: number) => {
            db.delete(liveLocationsTable)
              .where(eq(liveLocationsTable.userId, riderId))
              .catch((err) => {
                if (attempt < 3) {
                  setTimeout(() => deleteWithRetry(attempt + 1), 1000 * attempt);
                } else {
                  logger.warn({ err, riderId }, "Failed to clean up stale live_location on disconnect after retries");
                }
              });
          };
          deleteWithRetry(1);
          _riderLocLastEmit.delete(riderId);
        }

        logger.debug({ socketId: socket.id }, "Socket disconnected");
      } catch (err) {
        logger.error({ err, socketId: socket.id }, "disconnect handler error");
      }
    });
  });

  /* ── Ghost Rider Expiry: runs every 5 minutes ─────────────────────────────
     1. Finds riders whose last heartbeat/location update is older than 5 min.
     2. Emits rider:offline to admin-fleet for each (before deleting from DB).
     3. Sets users.is_online = false so the DB stays consistent.
     4. Deletes from live_locations to remove ghost markers from the map.
  ── */
  const STALE_LOC_TTL_MS = 5 * 60 * 1000;
  setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - STALE_LOC_TTL_MS);

      /* Step 1: Find stale rider entries before deleting */
      const staleRiders = await db
        .select({ userId: liveLocationsTable.userId, batteryLevel: liveLocationsTable.batteryLevel })
        .from(liveLocationsTable)
        .where(lt(liveLocationsTable.updatedAt, cutoff));

      if (staleRiders.length === 0) return;

      const now = new Date().toISOString();

      /* Step 2: Emit rider:offline for each stale rider to admin-fleet */
      for (const rider of staleRiders) {
        _io?.to("admin-fleet").emit("rider:offline", {
          userId: rider.userId,
          isOnline: false,
          reason: "heartbeat_timeout",
          updatedAt: now,
        });
        /* Clean per-rider throttle map to release memory */
        _riderLocLastEmit.delete(rider.userId);
      }

      /* Step 3: Mark users.is_online = false AND clear lastActive in DB for all stale riders.
         Clearing lastActive prevents stale timestamps from causing false "recently active"
         readings in the Admin Panel after a rider drops off without a clean disconnect. */
      const staleIds = staleRiders.map(r => r.userId);
      await db
        .update(usersTable)
        .set({ isOnline: false, lastActive: null, updatedAt: new Date() })
        .where(sql`${usersTable.id} = ANY(ARRAY[${sql.join(staleIds.map(id => sql`${id}`), sql`, `)}]::text[])`);

      /* Step 4: Delete stale rows from live_locations */
      const result = await db
        .delete(liveLocationsTable)
        .where(lt(liveLocationsTable.updatedAt, cutoff));

      if (result.rowCount && result.rowCount > 0) {
        logger.info({ cleaned: result.rowCount, riders: staleIds }, "Ghost rider cleanup: removed stale live_locations and emitted rider:offline");
      }
    } catch (err) {
      logger.warn({ err }, "Ghost rider cleanup failed");
    }
  }, STALE_LOC_TTL_MS);

  /* ── Weekly location_history cleanup: runs every Sunday at midnight (server local time) ──
     Uses a 1-hour polling interval that checks day-of-week (0=Sunday) and hour (0 = midnight).
     Deletes all location_history rows older than 60 days to keep the table lightweight.
     A _lastCleanupRun guard ensures it fires at most once per Sunday even if the interval
     drifts slightly across the midnight boundary. */
  let _lastHistoryCleanup = 0;
  const HISTORY_RETENTION_DAYS = 60;

  setInterval(async () => {
    const now = new Date();
    const isSundayMidnight = now.getDay() === 0 && now.getHours() === 0;
    if (!isSundayMidnight) return;

    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (_lastHistoryCleanup >= todayMidnight) return;
    _lastHistoryCleanup = todayMidnight;

    try {
      const cutoff = new Date(Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const result = await db
        .delete(locationHistoryTable)
        .where(lte(locationHistoryTable.createdAt, cutoff));
      logger.info(
        { deleted: result.rowCount ?? 0, olderThanDays: HISTORY_RETENTION_DAYS },
        "[cron] location_history weekly cleanup complete",
      );
    } catch (err) {
      logger.warn({ err }, "[cron] location_history weekly cleanup failed");
    }
  }, 60 * 60 * 1000);

  logger.info("Socket.io initialized");
  return _io;
}

export function getIO(): SocketIOServer | null {
  return _io;
}

export function emitRiderLocation(payload: {
  userId: string;
  name?: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  batteryLevel?: number;
  action?: string | null;
  rideId?: string | null;
  vendorId?: string | null;
  orderId?: string | null;
  vehicleType?: string | null;
  currentTripId?: string | null;
  updatedAt: string;
}) {
  if (!_io) return;

  /* ── Server-side broadcast throttle: max 1 emit per rider per RIDER_LOC_THROTTLE_MS ──
     Prevents downstream clients (Admin Panel, Rider App) from receiving
     rapid-fire updates that cause map flicker. */
  const now = Date.now();
  const last = _riderLocLastEmit.get(payload.userId) ?? 0;
  if (now - last < RIDER_LOC_THROTTLE_MS) return;
  _riderLocLastEmit.set(payload.userId, now);

  _io.to("admin-fleet").emit("rider:location", payload);
  if (payload.rideId) {
    const room = `ride:${payload.rideId}`;
    _io.to(room).emit("rider:location", payload);
    /* Feed any sockets still pending authorization for this ride room */
    for (const [key, buf] of _pendingRideJoins) {
      if (key.endsWith(`::${room}`)) {
        buf.push(payload);
      }
    }
  }
  if (payload.vendorId) {
    _io.to(`vendor:${payload.vendorId}`).emit("rider:location", payload);
  }
  if (payload.orderId) {
    _io.to(`order:${payload.orderId}`).emit("rider:location", payload);
  }
}

export function emitRiderForVendor(vendorId: string, payload: {
  userId: string;
  latitude: number;
  longitude: number;
  updatedAt: string;
}) {
  if (!_io) return;
  _io.to(`vendor:${vendorId}`).emit("rider:location", payload);
}

export function emitCustomerLocation(payload: {
  userId: string;
  latitude: number;
  longitude: number;
  updatedAt: string;
}) {
  if (!_io) return;
  _io.to("admin-fleet").emit("customer:location", payload);
}

export function emitRiderSOS(payload: {
  userId: string;
  name: string;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  rideId?: string | null;
  sentAt: string;
}) {
  if (!_io) return;
  _io.to("admin-fleet").emit("rider:sos", payload);
}

export function emitAdminChatReply(riderId: string, payload: {
  message: string;
  sentAt: string;
  from: "admin";
}) {
  if (!_io) return;
  _io.to(`rider:${riderId}`).emit("admin:chat", payload);
}

export function emitRiderStatus(payload: {
  userId: string;
  isOnline: boolean;
  name?: string;
  batteryLevel?: number | null;
  updatedAt: string;
}) {
  if (!_io) return;
  _io.to("admin-fleet").emit("rider:status", payload);
}

/**
 * Push a `rider:new-request` event directly to a specific rider's socket room
 * so their Home screen refreshes instantly (no need to wait for polling interval).
 * Payload mirrors what the rider needs to surface the notification UI.
 */
export function emitRiderNewRequest(riderId: string, payload: {
  type: "order" | "ride" | "parcel" | "order_ready";
  requestId: string;
  summary?: string;
}) {
  if (!_io) return;
  _io.to(`rider:${riderId}`).emit("rider:new-request", payload);
}

/* ── SOS lifecycle events ── broadcast to all admin-fleet sessions ── */

export type SosAlertPayload = {
  id: string;
  userId: string;
  title: string;
  body: string;
  link: string | null | undefined;
  sosStatus: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  acknowledgedByName: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolvedByName: string | null;
  resolutionNotes: string | null;
  createdAt: string;
};

export function emitSosNew(payload: SosAlertPayload) {
  if (!_io) return;
  _io.to("admin-fleet").emit("sos:new", payload);
}

export function emitSosAcknowledged(payload: SosAlertPayload) {
  if (!_io) return;
  _io.to("admin-fleet").emit("sos:acknowledged", payload);
}

export function emitSosResolved(payload: SosAlertPayload) {
  if (!_io) return;
  _io.to("admin-fleet").emit("sos:resolved", payload);
}

export function emitRideDispatchUpdate(payload: {
  rideId: string;
  action: string;
  status: string;
  radiusKm?: number;
}) {
  if (!_io) return;
  _io.to("admin-fleet").emit("ride:dispatch-update", payload);
}

export function emitRideOtp(customerId: string, rideId: string, otp: string) {
  if (!_io) return;
  /* Emit to both user room and ride room so customer web + mobile can receive it */
  _io.to(`user:${customerId}`).to(`ride:${rideId}`).emit("ride:otp", { rideId, otp });
}

