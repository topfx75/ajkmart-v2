import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  usersTable,
  gpsSpoofAlertsTable,
  ordersTable,
  vanSchedulesTable,
  vanBookingsTable,
  vanRoutesTable,
  vanVehiclesTable,
} from "@workspace/db/schema";
import { eq, desc, and, gte, lte, sql, or, asc, isNotNull, count } from "drizzle-orm";
import {
  generateId, addAuditEntry, getClientIp,
  type AdminRequest, logger,
} from "../admin-shared.js";
import { getCachedSettings } from "../../middleware/security.js";
import { getIO } from "../../lib/socketio.js";
import { resetGpsViolationCount } from "../locations.js";
import { sendSuccess, sendError, sendNotFound, sendValidationError } from "../../lib/response.js";
import { validateBody, validateQuery, validateParams } from "../../middleware/validate.js";

const idParamSchema = z.object({ id: z.string().min(1) }).strip();
const riderIdParamSchema = z.object({ riderId: z.string().min(1) }).strip();

const patchGpsAlertSchema = z.object({
  resolved: z.boolean().optional(),
  resetViolations: z.boolean().optional(),
}).strip();

const patchCodVerificationSchema = z.object({
  codVerified: z.enum(["verified", "flagged", "pending"], {
    errorMap: () => ({ message: "codVerified must be 'verified', 'flagged', or 'pending'" }),
  }),
}).strip();

const gpsAlertsQuerySchema = z.object({
  riderId: z.string().optional(),
  resolved: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
}).strip();

const codVerificationsQuerySchema = z.object({
  status: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
}).strip();

const router = Router();

/* ═══════════════════════════════════════════════════════════════
   GPS SPOOFING ALERTS
═══════════════════════════════════════════════════════════════ */

/* GET /admin/gps-alerts — list GPS spoofing alerts (filterable) */
router.get("/gps-alerts", validateQuery(gpsAlertsQuerySchema), async (req, res) => {
  try {
    const riderId = req.query["riderId"] as string | undefined;
    const resolved = req.query["resolved"] as string | undefined;
    const dateFrom = req.query["dateFrom"] as string | undefined;
    const dateTo = req.query["dateTo"] as string | undefined;
    const page = Math.max(1, parseInt(req.query["page"] as string || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query["limit"] as string || "50", 10)));
    const offset = (page - 1) * limit;

    const conditions: ReturnType<typeof and>[] = [];
    if (riderId) conditions.push(eq(gpsSpoofAlertsTable.riderId, riderId));
    if (resolved === "true") conditions.push(eq(gpsSpoofAlertsTable.resolved, true));
    if (resolved === "false") conditions.push(eq(gpsSpoofAlertsTable.resolved, false));
    if (dateFrom) conditions.push(gte(gpsSpoofAlertsTable.createdAt, new Date(dateFrom)));
    if (dateTo) conditions.push(lte(gpsSpoofAlertsTable.createdAt, new Date(dateTo)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [alerts, [totalRow]] = await Promise.all([
      db.select({
        id: gpsSpoofAlertsTable.id,
        riderId: gpsSpoofAlertsTable.riderId,
        riderName: usersTable.name,
        riderPhone: usersTable.phone,
        latitude: gpsSpoofAlertsTable.latitude,
        longitude: gpsSpoofAlertsTable.longitude,
        violationType: gpsSpoofAlertsTable.violationType,
        reason: gpsSpoofAlertsTable.reason,
        violationCount: gpsSpoofAlertsTable.violationCount,
        autoOffline: gpsSpoofAlertsTable.autoOffline,
        resolved: gpsSpoofAlertsTable.resolved,
        resolvedAt: gpsSpoofAlertsTable.resolvedAt,
        resolvedBy: gpsSpoofAlertsTable.resolvedBy,
        createdAt: gpsSpoofAlertsTable.createdAt,
      })
        .from(gpsSpoofAlertsTable)
        .leftJoin(usersTable, eq(gpsSpoofAlertsTable.riderId, usersTable.id))
        .where(whereClause)
        .orderBy(desc(gpsSpoofAlertsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() })
        .from(gpsSpoofAlertsTable)
        .where(whereClause),
    ]);

    sendSuccess(res, { alerts, total: Number(totalRow?.total ?? 0), page, limit });
  } catch (e) {
    logger.error({ err: e }, "[admin/gps-alerts] list error");
    sendError(res, "Failed to load GPS alerts.", 500);
  }
});

/* GET /admin/gps-alerts/rider/:riderId — alerts for a specific rider */
router.get("/gps-alerts/rider/:riderId", validateParams(riderIdParamSchema), async (req, res) => {
  try {
    const { riderId } = req.params as { riderId: string };
    const alerts = await db.select()
      .from(gpsSpoofAlertsTable)
      .where(eq(gpsSpoofAlertsTable.riderId, riderId))
      .orderBy(desc(gpsSpoofAlertsTable.createdAt))
      .limit(50);
    sendSuccess(res, alerts);
  } catch (e) {
    logger.error({ err: e }, "[admin/gps-alerts] rider history error");
    sendError(res, "Failed to load rider GPS alerts.", 500);
  }
});

/* PATCH /admin/gps-alerts/:id — resolve an alert or reset violation count */
router.patch("/gps-alerts/:id", validateParams(idParamSchema), validateBody(patchGpsAlertSchema), async (req, res) => {
  const adminReq = req as AdminRequest;
  try {
    const { id } = req.params as { id: string };
    const { resolved, resetViolations } = req.body as {
      resolved?: boolean;
      resetViolations?: boolean;
    };

    const [alert] = await db.select().from(gpsSpoofAlertsTable)
      .where(eq(gpsSpoofAlertsTable.id, id)).limit(1);
    if (!alert) { sendNotFound(res, "Alert not found."); return; }

    const updates: Record<string, unknown> = {};
    if (resolved === true) {
      updates["resolved"] = true;
      updates["resolvedAt"] = new Date();
      updates["resolvedBy"] = adminReq.adminId ?? "admin";
    } else if (resolved === false) {
      updates["resolved"] = false;
      updates["resolvedAt"] = null;
      updates["resolvedBy"] = null;
    }

    if (Object.keys(updates).length > 0) {
      await db.update(gpsSpoofAlertsTable).set(updates).where(eq(gpsSpoofAlertsTable.id, id));
    }

    addAuditEntry({
      action: "gps_alert_update",
      ip: getClientIp(req),
      adminId: adminReq.adminId,
      details: `GPS alert ${id} updated: resolved=${resolved}`,
      result: "success",
    });

    sendSuccess(res, { success: true });
  } catch (e) {
    logger.error({ err: e }, "[admin/gps-alerts] patch error");
    sendError(res, "Failed to update alert.", 500);
  }
});

/* PATCH /admin/gps-alerts/rider/:riderId/reset-violations — reset violation count for a rider */
router.patch("/gps-alerts/rider/:riderId/reset-violations", validateParams(riderIdParamSchema), async (req, res) => {
  const adminReq = req as AdminRequest;
  try {
    const { riderId } = req.params as { riderId: string };

    await db.update(gpsSpoofAlertsTable)
      .set({ resolved: true, resolvedAt: new Date(), resolvedBy: adminReq.adminId ?? "admin" })
      .where(and(
        eq(gpsSpoofAlertsTable.riderId, riderId),
        eq(gpsSpoofAlertsTable.resolved, false),
      ));

    /* Also clear the in-memory counter so the rider is no longer at risk of
       being auto-offlined based on stale pre-reset strikes. */
    resetGpsViolationCount(riderId);

    addAuditEntry({
      action: "gps_violations_reset",
      ip: getClientIp(req),
      adminId: adminReq.adminId,
      details: `GPS violations reset for rider ${riderId} (in-memory counter cleared)`,
      result: "success",
    });

    sendSuccess(res, { success: true, message: "Violation count reset." });
  } catch (e) {
    logger.error({ err: e }, "[admin/gps-alerts] reset violations error");
    sendError(res, "Failed to reset violations.", 500);
  }
});

/* ═══════════════════════════════════════════════════════════════
   VAN BOARDING MONITOR
═══════════════════════════════════════════════════════════════ */

/* GET /admin/van-boarding — today's schedules with passenger boarding progress */
router.get("/van-boarding", async (_req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0]!;
    const todayDow = new Date().getDay() === 0 ? 7 : new Date().getDay();

    const schedules = await db.select({
      id: vanSchedulesTable.id,
      routeId: vanSchedulesTable.routeId,
      routeName: vanRoutesTable.name,
      routeFrom: vanRoutesTable.fromAddress,
      routeTo: vanRoutesTable.toAddress,
      departureTime: vanSchedulesTable.departureTime,
      returnTime: vanSchedulesTable.returnTime,
      daysOfWeek: vanSchedulesTable.daysOfWeek,
      totalSeats: vanVehiclesTable.totalSeats,
      vehiclePlate: vanVehiclesTable.plateNumber,
      driverName: usersTable.name,
      driverPhone: usersTable.phone,
      driverId: vanSchedulesTable.driverId,
    })
      .from(vanSchedulesTable)
      .leftJoin(vanRoutesTable, eq(vanSchedulesTable.routeId, vanRoutesTable.id))
      .leftJoin(vanVehiclesTable, eq(vanSchedulesTable.vehicleId, vanVehiclesTable.id))
      .leftJoin(usersTable, eq(vanSchedulesTable.driverId, usersTable.id))
      .where(eq(vanSchedulesTable.isActive, true));

    const todaySchedules = schedules.filter(s => {
      const days = Array.isArray(s.daysOfWeek) ? (s.daysOfWeek as number[]) : [];
      return days.includes(todayDow);
    });

    const enriched = await Promise.all(todaySchedules.map(async (s) => {
      const bookings = await db.select({
        id: vanBookingsTable.id,
        passengerName: vanBookingsTable.passengerName,
        passengerPhone: vanBookingsTable.passengerPhone,
        seatNumbers: vanBookingsTable.seatNumbers,
        status: vanBookingsTable.status,
        boardedAt: vanBookingsTable.boardedAt,
        completedAt: vanBookingsTable.completedAt,
        paymentMethod: vanBookingsTable.paymentMethod,
        fare: vanBookingsTable.fare,
        userName: usersTable.name,
        userPhone: usersTable.phone,
      })
        .from(vanBookingsTable)
        .leftJoin(usersTable, eq(vanBookingsTable.userId, usersTable.id))
        .where(and(
          eq(vanBookingsTable.scheduleId, s.id),
          eq(vanBookingsTable.travelDate, today),
          sql`${vanBookingsTable.status} NOT IN ('cancelled')`,
        ))
        .orderBy(asc(vanBookingsTable.createdAt));

      const confirmedCount = bookings.filter(b => b.status === "confirmed").length;
      const boardedCount = bookings.filter(b => b.status === "boarded").length;
      const completedCount = bookings.filter(b => b.status === "completed").length;
      const totalBooked = bookings.length;

      return {
        ...s,
        date: today,
        totalBooked,
        confirmedCount,
        boardedCount,
        completedCount,
        passengers: bookings.map(b => ({
          ...b,
          displayName: b.passengerName || b.userName || "Unknown",
          displayPhone: b.passengerPhone || b.userPhone || null,
        })),
      };
    }));

    sendSuccess(res, enriched);
  } catch (e) {
    logger.error({ err: e }, "[admin/van-boarding] error");
    sendError(res, "Failed to load van boarding data.", 500);
  }
});

/* ═══════════════════════════════════════════════════════════════
   COD PHOTO VERIFICATION
═══════════════════════════════════════════════════════════════ */

/* GET /admin/cod-verifications — list COD orders above platform threshold with proof photos */
router.get("/cod-verifications", validateQuery(codVerificationsQuerySchema), async (req, res) => {
  try {
    const status = req.query["status"] as string | undefined;
    const dateFrom = req.query["dateFrom"] as string | undefined;
    const dateTo = req.query["dateTo"] as string | undefined;
    const page = Math.max(1, parseInt(req.query["page"] as string || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query["limit"] as string || "50", 10)));
    const offset = (page - 1) * limit;

    /* Read the configured COD verification threshold from platform settings.
       Only orders at or above this amount are subject to photo verification review.
       Fallback to 0 (all COD orders) if not configured. */
    const s = await getCachedSettings();
    const codThreshold = parseFloat(s["cod_verification_threshold"] ?? "0");

    /* Include COD orders that have either a proof photo or a dedicated COD photo.
       Also enforce the platform's cod_verification_threshold so the admin only
       reviews orders that triggered verification in the first place. */
    const conditions: ReturnType<typeof and>[] = [
      eq(ordersTable.paymentMethod, "cod"),
      or(isNotNull(ordersTable.proofPhotoUrl), isNotNull(ordersTable.codPhotoUrl))!,
    ];

    if (codThreshold > 0) {
      conditions.push(gte(ordersTable.total, String(codThreshold)));
    }

    if (status === "verified") conditions.push(eq(ordersTable.codVerified, "verified"));
    else if (status === "flagged") conditions.push(eq(ordersTable.codVerified, "flagged"));
    else if (status === "pending") conditions.push(
      or(sql`${ordersTable.codVerified} IS NULL`, eq(ordersTable.codVerified, "pending"))!
    );

    if (dateFrom) conditions.push(gte(ordersTable.createdAt, new Date(dateFrom)));
    if (dateTo) conditions.push(lte(ordersTable.createdAt, new Date(dateTo)));

    const whereClause = and(...conditions);

    const [orders, [totalRow]] = await Promise.all([
      db.select({
        id: ordersTable.id,
        userId: ordersTable.userId,
        riderId: ordersTable.riderId,
        riderName: ordersTable.riderName,
        riderPhone: ordersTable.riderPhone,
        total: ordersTable.total,
        paymentMethod: ordersTable.paymentMethod,
        status: ordersTable.status,
        proofPhotoUrl: ordersTable.proofPhotoUrl,
        codPhotoUrl: ordersTable.codPhotoUrl,
        codVerified: ordersTable.codVerified,
        deliveryAddress: ordersTable.deliveryAddress,
        createdAt: ordersTable.createdAt,
        updatedAt: ordersTable.updatedAt,
      })
        .from(ordersTable)
        .where(whereClause)
        .orderBy(desc(ordersTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(ordersTable).where(whereClause),
    ]);

    sendSuccess(res, {
      orders: orders.map(o => ({
        ...o,
        total: parseFloat(String(o.total)),
      })),
      total: Number(totalRow?.total ?? 0),
      page,
      limit,
    });
  } catch (e) {
    logger.error({ err: e }, "[admin/cod-verifications] list error");
    sendError(res, "Failed to load COD verifications.", 500);
  }
});

/* PATCH /admin/cod-verifications/:id — set verified/flagged status */
router.patch("/cod-verifications/:id", validateParams(idParamSchema), validateBody(patchCodVerificationSchema), async (req, res) => {
  const adminReq = req as AdminRequest;
  try {
    const { id } = req.params as { id: string };
    const { codVerified } = req.body as { codVerified?: string };

    if (!codVerified || !["verified", "flagged", "pending"].includes(codVerified)) {
      sendValidationError(res, "codVerified must be 'verified', 'flagged', or 'pending'");
      return;
    }

    const [order] = await db.select({ id: ordersTable.id })
      .from(ordersTable).where(eq(ordersTable.id, id)).limit(1);
    if (!order) { sendNotFound(res, "Order not found."); return; }

    await db.update(ordersTable)
      .set({ codVerified, updatedAt: new Date() })
      .where(eq(ordersTable.id, id));

    addAuditEntry({
      action: "cod_verification_update",
      ip: getClientIp(req),
      adminId: adminReq.adminId,
      details: `Order ${id} COD verification set to: ${codVerified}`,
      result: "success",
    });

    sendSuccess(res, { success: true, codVerified });
  } catch (e) {
    logger.error({ err: e }, "[admin/cod-verifications] patch error");
    sendError(res, "Failed to update COD verification.", 500);
  }
});

/* ═══════════════════════════════════════════════════════════════
   RIDER SILENCE MODE
═══════════════════════════════════════════════════════════════ */

/* GET /admin/riders/silence-mode — list riders currently in silence mode */
router.get("/riders/silence-mode", async (_req, res) => {
  try {
    const riders = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      phone: usersTable.phone,
      isOnline: usersTable.isOnline,
      silenceMode: usersTable.silenceMode,
      silenceModeUntil: usersTable.silenceModeUntil,
      lastActive: usersTable.lastActive,
    })
      .from(usersTable)
      .where(and(
        eq(usersTable.role, "rider"),
        eq(usersTable.silenceMode, true),
      ))
      .orderBy(desc(usersTable.lastActive));

    sendSuccess(res, riders);
  } catch (e) {
    logger.error({ err: e }, "[admin/silence-mode] list error");
    sendError(res, "Failed to load silence mode riders.", 500);
  }
});

/* PATCH /admin/riders/:id/silence-mode — force-disable silence mode for a rider */
router.patch("/riders/:id/silence-mode", validateParams(idParamSchema), async (req, res) => {
  const adminReq = req as AdminRequest;
  try {
    const { id } = req.params as { id: string };

    const [rider] = await db.select({ id: usersTable.id, silenceMode: usersTable.silenceMode })
      .from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!rider) { sendNotFound(res, "Rider not found."); return; }

    await db.update(usersTable)
      .set({ silenceMode: false, silenceModeUntil: null, updatedAt: new Date() })
      .where(eq(usersTable.id, id));

    const io = getIO();
    if (io) {
      io.to(`rider:${id}`).emit("admin:force-silence-off", {
        message: "Admin has disabled your silence mode.",
        sentAt: new Date().toISOString(),
      });
    }

    addAuditEntry({
      action: "rider_silence_mode_disabled",
      ip: getClientIp(req),
      adminId: adminReq.adminId,
      details: `Silence mode force-disabled for rider ${id}`,
      result: "success",
    });

    sendSuccess(res, { success: true, silenceMode: false });
  } catch (e) {
    logger.error({ err: e }, "[admin/silence-mode] patch error");
    sendError(res, "Failed to update silence mode.", 500);
  }
});

/* POST /admin/riders/:id/toggle-online — force a rider online or offline */
router.post("/riders/:id/toggle-online", validateParams(idParamSchema), async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const [rider] = await db.select({ id: usersTable.id, isOnline: usersTable.isOnline, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!rider) { sendNotFound(res, "Rider not found"); return; }
    const roles = (rider.role || "").split(",").map((r: string) => r.trim());
    const isRider = roles.includes("rider") || roles.includes("riders");
    if (!isRider) { sendValidationError(res, "User is not a rider"); return; }
    const newOnline = !rider.isOnline;
    await db.update(usersTable).set({ isOnline: newOnline, updatedAt: new Date() }).where(eq(usersTable.id, id));
    addAuditEntry({
      action: "rider_online_toggle",
      ip: getClientIp(req),
      adminId: (req as AdminRequest).adminId,
      details: `Rider ${id} toggled to ${newOnline ? "online" : "offline"} by admin`,
      result: "success",
    });
    const io = getIO();
    if (io) {
      io.to(`rider:${id}`).emit("admin:online-status", { isOnline: newOnline, updatedAt: new Date().toISOString() });
    }
    sendSuccess(res, { isOnline: newOnline });
  } catch (e) {
    logger.error({ err: e }, "[admin/riders] toggle-online error");
    sendError(res, "Failed to toggle rider online status.", 500);
  }
});

export default router;
