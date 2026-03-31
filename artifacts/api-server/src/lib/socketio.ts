import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "http";
import { logger } from "./logger.js";
import { verifyUserJwt, verifyAdminJwt } from "../middleware/security.js";
import { db } from "@workspace/db";
import { ridesTable, ordersTable, parcelBookingsTable, pharmacyOrdersTable } from "@workspace/db/schema";
import { eq, or, and } from "drizzle-orm";

let _io: SocketIOServer | null = null;

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
  headers: Record<string, string | string[] | undefined>,
  auth: Record<string, unknown>,
): boolean {
  const bearer = getTokenFromHandshake(headers, auth);
  if (!bearer) return false;
  const payload = verifyUserJwt(bearer);
  if (!payload) return false;
  return payload.userId === vendorId && payload.role === "vendor";
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
  _io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
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
          if (isAuthorizedForVendorRoom(vendorId, headers, auth)) {
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

    /* Allow riders to join their personal room rider:{userId} to receive admin chat */
    const userToken = getTokenFromHandshake(headers, auth);
    if (userToken) {
      const userPayload = verifyUserJwt(userToken);
      if (userPayload?.userId) {
        socket.join(`rider:${userPayload.userId}`);
      }
    }

    /* SOS relay: rider sends rider:sos event, server broadcasts to admin-fleet */
    socket.on("rider:sos", (payload: { latitude?: number; longitude?: number; rideId?: string | null }) => {
      if (!userToken) return;
      const sosPay = verifyUserJwt(userToken);
      if (!sosPay?.userId) return;
      /* Only riders (role === "rider") may emit SOS */
      if (sosPay.role !== "rider") return;
      if (typeof payload?.latitude !== "number" || typeof payload?.longitude !== "number") return;
      /* Rebroadcast to admin-fleet with enriched payload */
      _io!.to("admin-fleet").emit("rider:sos", {
        userId: sosPay.userId,
        name: "Rider",
        phone: null,
        latitude: payload.latitude,
        longitude: payload.longitude,
        rideId: payload.rideId ?? null,
        sentAt: new Date().toISOString(),
      });
    });

    /* Admin chat relay: admin sends message to specific rider */
    socket.on("admin:chat", (payload: { riderId: string; message: string }) => {
      if (!payload?.riderId || typeof payload.message !== "string") return;
      /* Only allow admins to send chat messages */
      if (!isAuthorizedForAdminFleet(headers, query, auth)) return;
      _io!.to(`rider:${payload.riderId}`).emit("admin:chat", {
        message: payload.message,
        sentAt: new Date().toISOString(),
        from: "admin",
      });
    });

    /* Rider reply chat relay: rider sends message back to admin */
    socket.on("rider:chat", (payload: { message: string }) => {
      if (!userToken) return;
      const riderPay = verifyUserJwt(userToken);
      if (!riderPay?.userId || riderPay.role !== "rider") return;
      if (typeof payload?.message !== "string" || !payload.message.trim()) return;
      /* Broadcast the rider's reply to all admin-fleet clients */
      _io!.to("admin-fleet").emit("rider:chat", {
        userId: riderPay.userId,
        message: payload.message.trim(),
        sentAt: new Date().toISOString(),
        from: "rider",
      });
    });

    /* Join event: client can request additional rooms after connect */
    socket.on("join", (room: string) => {
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
        if (isAuthorizedForVendorRoom(vendorId, headers, auth)) {
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
    });

    socket.on("leave", (room: string) => {
      socket.leave(room);
    });

    socket.on("disconnect", () => {
      /* Clean up any pending ride-room buffers for this socket */
      const prefix = `${socket.id}::`;
      for (const key of _pendingRideJoins.keys()) {
        if (key.startsWith(prefix)) _pendingRideJoins.delete(key);
      }
      logger.debug({ socketId: socket.id }, "Socket disconnected");
    });
  });

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
  updatedAt: string;
}) {
  if (!_io) return;
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

