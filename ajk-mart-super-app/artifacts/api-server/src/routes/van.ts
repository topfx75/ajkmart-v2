import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq, sql, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  vanRoutesTable, vanVehiclesTable, vanSchedulesTable, vanBookingsTable,
  usersTable, notificationsTable, walletTransactionsTable,
} from "@workspace/db/schema";
import { generateId } from "../lib/id.js";
import { customerAuth, riderAuth } from "../middleware/security.js";
import { adminAuth } from "./admin.js";
import {
  sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden,
} from "../lib/response.js";
import { logger } from "../lib/logger.js";

const router = Router();

/* ═══════════════════════════════════════════════════════════════
   Helper: get confirmed seat count for a schedule on a date
═══════════════════════════════════════════════════════════════ */
async function getBookedSeats(scheduleId: string, travelDate: string): Promise<number[]> {
  const bookings = await db.select({ seatNumbers: vanBookingsTable.seatNumbers })
    .from(vanBookingsTable)
    .where(and(
      eq(vanBookingsTable.scheduleId, scheduleId),
      eq(vanBookingsTable.travelDate, travelDate),
      sql`status NOT IN ('cancelled')`,
    ));
  const booked: number[] = [];
  for (const b of bookings) {
    const seats = Array.isArray(b.seatNumbers) ? (b.seatNumbers as number[]) : [];
    booked.push(...seats);
  }
  return booked;
}

/* ═══════════════════════════════════════════════════════════════
   PUBLIC — Customer endpoints
═══════════════════════════════════════════════════════════════ */

/* GET /api/van/routes  — list all active routes */
router.get("/routes", async (_req, res) => {
  try {
    const routes = await db.select().from(vanRoutesTable)
      .where(eq(vanRoutesTable.isActive, true))
      .orderBy(asc(vanRoutesTable.sortOrder), asc(vanRoutesTable.name));
    sendSuccess(res, routes);
  } catch (e) {
    logger.error({ err: e }, "[van] list routes error");
    sendError(res, "Could not load routes.", 500);
  }
});

/* GET /api/van/routes/:id  — route detail with schedules */
router.get("/routes/:id", async (req, res) => {
  try {
    const [route] = await db.select().from(vanRoutesTable).where(eq(vanRoutesTable.id, req.params["id"]!)).limit(1);
    if (!route) { sendNotFound(res, "Route not found."); return; }

    const schedules = await db.select({
      id: vanSchedulesTable.id,
      routeId: vanSchedulesTable.routeId,
      vehicleId: vanSchedulesTable.vehicleId,
      departureTime: vanSchedulesTable.departureTime,
      returnTime: vanSchedulesTable.returnTime,
      daysOfWeek: vanSchedulesTable.daysOfWeek,
      isActive: vanSchedulesTable.isActive,
      totalSeats: vanVehiclesTable.totalSeats,
      vehiclePlate: vanVehiclesTable.plateNumber,
      vehicleModel: vanVehiclesTable.model,
    })
      .from(vanSchedulesTable)
      .leftJoin(vanVehiclesTable, eq(vanSchedulesTable.vehicleId, vanVehiclesTable.id))
      .where(and(eq(vanSchedulesTable.routeId, route.id), eq(vanSchedulesTable.isActive, true)));

    sendSuccess(res, { ...route, schedules });
  } catch (e) {
    logger.error({ err: e }, "[van] get route error");
    sendError(res, "Could not load route.", 500);
  }
});

/* GET /api/van/schedules/:id/availability?date=YYYY-MM-DD */
router.get("/schedules/:id/availability", async (req, res) => {
  try {
    const scheduleId = req.params["id"]!;
    const date = String(req.query["date"] ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      sendError(res, "date query param required (YYYY-MM-DD).", 400); return;
    }

    const [schedule] = await db.select({
      id: vanSchedulesTable.id,
      routeId: vanSchedulesTable.routeId,
      daysOfWeek: vanSchedulesTable.daysOfWeek,
      departureTime: vanSchedulesTable.departureTime,
      returnTime: vanSchedulesTable.returnTime,
      isActive: vanSchedulesTable.isActive,
      totalSeats: vanVehiclesTable.totalSeats,
      vehiclePlate: vanVehiclesTable.plateNumber,
      vehicleModel: vanVehiclesTable.model,
    })
      .from(vanSchedulesTable)
      .leftJoin(vanVehiclesTable, eq(vanSchedulesTable.vehicleId, vanVehiclesTable.id))
      .where(eq(vanSchedulesTable.id, scheduleId))
      .limit(1);

    if (!schedule || !schedule.isActive) { sendNotFound(res, "Schedule not found."); return; }

    /* Check day-of-week availability */
    const reqDate = new Date(date + "T00:00:00");
    const dayOfWeek = reqDate.getDay() === 0 ? 7 : reqDate.getDay(); // 1=Mon…7=Sun
    const daysArr = Array.isArray(schedule.daysOfWeek) ? (schedule.daysOfWeek as number[]) : [];
    if (!daysArr.includes(dayOfWeek)) {
      sendSuccess(res, { scheduleId, date, available: false, reason: "not_running_this_day", bookedSeats: [], totalSeats: schedule.totalSeats ?? 12 });
      return;
    }

    const bookedSeats = await getBookedSeats(scheduleId, date);
    const totalSeats = schedule.totalSeats ?? 12;
    const availableSeats = totalSeats - bookedSeats.length;
    sendSuccess(res, {
      scheduleId, date, available: availableSeats > 0,
      bookedSeats, availableSeats, totalSeats,
      departureTime: schedule.departureTime,
      returnTime: schedule.returnTime,
      vehiclePlate: schedule.vehiclePlate,
      vehicleModel: schedule.vehicleModel,
    });
  } catch (e) {
    logger.error({ err: e }, "[van] availability error");
    sendError(res, "Could not check availability.", 500);
  }
});

/* ═══════════════════════════════════════════════════════════════
   CUSTOMER — authenticated booking endpoints
═══════════════════════════════════════════════════════════════ */

const bookVanSchema = z.object({
  scheduleId:     z.string().min(1),
  travelDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "travelDate must be YYYY-MM-DD"),
  seatNumbers:    z.array(z.number().int().min(1)).min(1).max(6),
  paymentMethod:  z.enum(["cash", "wallet"]).default("cash"),
  passengerName:  z.string().max(80).optional(),
  passengerPhone: z.string().max(20).optional(),
});

/* POST /api/van/bookings — book seats */
router.post("/bookings", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const parsed = bookVanSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    sendError(res, msg, 422); return;
  }
  const { scheduleId, travelDate, seatNumbers, paymentMethod, passengerName, passengerPhone } = parsed.data;

  try {
    /* Validate travel date is today or future */
    const todayStr = new Date().toISOString().split("T")[0]!;
    if (travelDate < todayStr) {
      sendError(res, "Travel date cannot be in the past.", 400); return;
    }

    /* Load schedule */
    const [schedule] = await db.select({
      id: vanSchedulesTable.id,
      routeId: vanSchedulesTable.routeId,
      daysOfWeek: vanSchedulesTable.daysOfWeek,
      isActive: vanSchedulesTable.isActive,
      vehicleId: vanSchedulesTable.vehicleId,
      totalSeats: vanVehiclesTable.totalSeats,
    })
      .from(vanSchedulesTable)
      .leftJoin(vanVehiclesTable, eq(vanSchedulesTable.vehicleId, vanVehiclesTable.id))
      .where(eq(vanSchedulesTable.id, scheduleId))
      .limit(1);

    if (!schedule || !schedule.isActive) {
      sendError(res, "Schedule not found or inactive.", 404); return;
    }

    /* Validate day of week */
    const reqDate = new Date(travelDate + "T00:00:00");
    const dayOfWeek = reqDate.getDay() === 0 ? 7 : reqDate.getDay();
    const daysArr = Array.isArray(schedule.daysOfWeek) ? (schedule.daysOfWeek as number[]) : [];
    if (!daysArr.includes(dayOfWeek)) {
      sendError(res, "Van does not operate on this day.", 400); return;
    }

    /* Load route for fare */
    const [route] = await db.select().from(vanRoutesTable).where(eq(vanRoutesTable.id, schedule.routeId)).limit(1);
    if (!route) { sendError(res, "Route not found.", 404); return; }

    const totalSeats = schedule.totalSeats ?? 12;
    const farePerSeat = parseFloat(String(route.farePerSeat));
    const totalFare = farePerSeat * seatNumbers.length;

    /* Check seat conflicts inside a transaction */
    const booking = await db.transaction(async (tx) => {
      const bookedSeats = await getBookedSeats(scheduleId, travelDate);
      const conflict = seatNumbers.filter(s => bookedSeats.includes(s));
      if (conflict.length > 0) {
        throw new Error(`Seat(s) ${conflict.join(", ")} already booked.`);
      }
      if (bookedSeats.length + seatNumbers.length > totalSeats) {
        throw new Error("Not enough seats available.");
      }
      /* Validate seat numbers are valid */
      for (const s of seatNumbers) {
        if (s < 1 || s > totalSeats) throw new Error(`Seat ${s} is out of range (1-${totalSeats}).`);
      }

      /* Wallet payment: debit before creating booking */
      if (paymentMethod === "wallet") {
        const [userRow] = await tx.select({ walletBalance: usersTable.walletBalance })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .for("update")
          .limit(1);
        const balance = parseFloat(String(userRow?.walletBalance ?? "0"));
        if (balance < totalFare) {
          throw new Error(`Insufficient wallet balance. Required: Rs ${totalFare.toFixed(0)}, Available: Rs ${balance.toFixed(0)}.`);
        }
        await tx.update(usersTable)
          .set({ walletBalance: String(balance - totalFare), updatedAt: new Date() })
          .where(eq(usersTable.id, userId));
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId, type: "debit",
          amount: totalFare.toFixed(2),
          description: `Van seat booking – ${route.name} (${seatNumbers.length} seat${seatNumbers.length > 1 ? "s" : ""})`,
          reference: `van:pending`,
          createdAt: new Date(),
        });
      }

      const bookingId = generateId();
      const [newBooking] = await tx.insert(vanBookingsTable).values({
        id: bookingId,
        userId,
        scheduleId,
        routeId: route.id,
        seatNumbers,
        travelDate,
        status: "confirmed",
        fare: totalFare.toFixed(2),
        paymentMethod,
        passengerName: passengerName || null,
        passengerPhone: passengerPhone || null,
      }).returning();

      /* Fix wallet reference with booking ID */
      if (paymentMethod === "wallet") {
        await tx.update(walletTransactionsTable)
          .set({ reference: `van:${bookingId}` })
          .where(and(eq(walletTransactionsTable.userId, userId), eq(walletTransactionsTable.reference, "van:pending")));
      }

      return newBooking!;
    });

    /* Notification */
    await db.insert(notificationsTable).values({
      id: generateId(), userId,
      title: "Van Seat Confirmed",
      body: `${seatNumbers.length} seat${seatNumbers.length > 1 ? "s" : ""} booked on ${route.name} for ${travelDate}. Seats: ${seatNumbers.join(", ")}.`,
      type: "van", icon: "bus-outline", link: `/van/bookings`,
    }).catch(() => {});

    sendCreated(res, { ...booking, routeName: route.name, farePerSeat, totalFare });
  } catch (e) {
    logger.error({ err: e }, "[van] book seats error");
    sendError(res, (e as Error).message || "Booking failed.", 400);
  }
});

/* GET /api/van/bookings — customer's own bookings */
router.get("/bookings", customerAuth, async (req, res) => {
  try {
    const userId = req.customerId!;
    const bookings = await db.select({
      id: vanBookingsTable.id,
      scheduleId: vanBookingsTable.scheduleId,
      routeId: vanBookingsTable.routeId,
      seatNumbers: vanBookingsTable.seatNumbers,
      travelDate: vanBookingsTable.travelDate,
      status: vanBookingsTable.status,
      fare: vanBookingsTable.fare,
      paymentMethod: vanBookingsTable.paymentMethod,
      passengerName: vanBookingsTable.passengerName,
      passengerPhone: vanBookingsTable.passengerPhone,
      boardedAt: vanBookingsTable.boardedAt,
      completedAt: vanBookingsTable.completedAt,
      cancelledAt: vanBookingsTable.cancelledAt,
      createdAt: vanBookingsTable.createdAt,
      routeName: vanRoutesTable.name,
      routeFrom: vanRoutesTable.fromAddress,
      routeTo: vanRoutesTable.toAddress,
      departureTime: vanSchedulesTable.departureTime,
    })
      .from(vanBookingsTable)
      .leftJoin(vanRoutesTable, eq(vanBookingsTable.routeId, vanRoutesTable.id))
      .leftJoin(vanSchedulesTable, eq(vanBookingsTable.scheduleId, vanSchedulesTable.id))
      .where(eq(vanBookingsTable.userId, userId))
      .orderBy(desc(vanBookingsTable.createdAt));
    sendSuccess(res, bookings);
  } catch (e) {
    logger.error({ err: e }, "[van] list bookings error");
    sendError(res, "Could not load bookings.", 500);
  }
});

/* PATCH /api/van/bookings/:id/cancel — cancel a booking */
router.patch("/bookings/:id/cancel", customerAuth, async (req, res) => {
  try {
    const userId = req.customerId!;
    const bookingId = req.params["id"]!;
    const reason = String(req.body?.reason ?? "customer_cancelled");

    const [booking] = await db.select().from(vanBookingsTable)
      .where(and(eq(vanBookingsTable.id, bookingId), eq(vanBookingsTable.userId, userId)))
      .limit(1);

    if (!booking) { sendNotFound(res, "Booking not found."); return; }
    if (booking.status === "cancelled") { sendError(res, "Booking already cancelled.", 400); return; }
    if (booking.status === "completed") { sendError(res, "Cannot cancel a completed booking.", 400); return; }

    /* Must be > 1 hour before travel date+time */
    const [schedule] = await db.select({ departureTime: vanSchedulesTable.departureTime })
      .from(vanSchedulesTable).where(eq(vanSchedulesTable.id, booking.scheduleId)).limit(1);
    const departureDateTime = new Date(`${booking.travelDate}T${schedule?.departureTime ?? "00:00"}:00`);
    if (departureDateTime.getTime() - Date.now() < 60 * 60_000) {
      sendError(res, "Cannot cancel less than 1 hour before departure.", 400); return;
    }

    await db.transaction(async (tx) => {
      await tx.update(vanBookingsTable)
        .set({ status: "cancelled", cancelledAt: new Date(), cancellationReason: reason, updatedAt: new Date() })
        .where(eq(vanBookingsTable.id, bookingId));

      /* Refund wallet payment */
      if (booking.paymentMethod === "wallet") {
        const [userRow] = await tx.select({ walletBalance: usersTable.walletBalance })
          .from(usersTable).where(eq(usersTable.id, userId)).for("update").limit(1);
        const bal = parseFloat(String(userRow?.walletBalance ?? "0"));
        const refund = parseFloat(String(booking.fare));
        await tx.update(usersTable)
          .set({ walletBalance: String(bal + refund), updatedAt: new Date() })
          .where(eq(usersTable.id, userId));
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId, type: "credit",
          amount: refund.toFixed(2),
          description: `Van booking refund – cancelled`,
          reference: `van_refund:${bookingId}`,
          createdAt: new Date(),
        });
      }
    });

    sendSuccess(res, { message: "Booking cancelled successfully." });
  } catch (e) {
    logger.error({ err: e }, "[van] cancel booking error");
    sendError(res, (e as Error).message || "Cancellation failed.", 400);
  }
});

/* ═══════════════════════════════════════════════════════════════
   RIDER (Van Driver) endpoints
═══════════════════════════════════════════════════════════════ */

/* GET /api/van/driver/today  — today's schedule for this driver */
router.get("/driver/today", riderAuth, async (req, res) => {
  try {
    const driverId = req.riderId!;
    const today = new Date().toISOString().split("T")[0]!;
    const todayDow = new Date().getDay() === 0 ? 7 : new Date().getDay();

    const schedules = await db.select({
      id: vanSchedulesTable.id,
      routeId: vanSchedulesTable.routeId,
      departureTime: vanSchedulesTable.departureTime,
      returnTime: vanSchedulesTable.returnTime,
      daysOfWeek: vanSchedulesTable.daysOfWeek,
      routeName: vanRoutesTable.name,
      routeFrom: vanRoutesTable.fromAddress,
      routeTo: vanRoutesTable.toAddress,
      totalSeats: vanVehiclesTable.totalSeats,
      vehiclePlate: vanVehiclesTable.plateNumber,
    })
      .from(vanSchedulesTable)
      .leftJoin(vanRoutesTable, eq(vanSchedulesTable.routeId, vanRoutesTable.id))
      .leftJoin(vanVehiclesTable, eq(vanSchedulesTable.vehicleId, vanVehiclesTable.id))
      .where(and(
        eq(vanSchedulesTable.driverId, driverId),
        eq(vanSchedulesTable.isActive, true),
      ));

    const todaySchedules = schedules.filter(s => {
      const days = Array.isArray(s.daysOfWeek) ? (s.daysOfWeek as number[]) : [];
      return days.includes(todayDow);
    });

    /* Add booking counts */
    const enriched = await Promise.all(todaySchedules.map(async (s) => {
      const bookedSeats = await getBookedSeats(s.id, today);
      return { ...s, date: today, bookedCount: bookedSeats.length, bookedSeats };
    }));

    sendSuccess(res, enriched);
  } catch (e) {
    logger.error({ err: e }, "[van] driver today error");
    sendError(res, "Could not load today's schedule.", 500);
  }
});

/* GET /api/van/driver/schedules/:scheduleId/date/:date/passengers — passenger list */
router.get("/driver/schedules/:scheduleId/date/:date/passengers", riderAuth, async (req, res) => {
  try {
    const driverId = req.riderId!;
    const { scheduleId, date } = req.params as { scheduleId: string; date: string };

    /* Verify this schedule belongs to this driver */
    const [schedule] = await db.select().from(vanSchedulesTable)
      .where(and(eq(vanSchedulesTable.id, scheduleId), eq(vanSchedulesTable.driverId, driverId)))
      .limit(1);
    if (!schedule) { sendForbidden(res, "Not your schedule."); return; }

    const bookings = await db.select({
      id: vanBookingsTable.id,
      seatNumbers: vanBookingsTable.seatNumbers,
      status: vanBookingsTable.status,
      passengerName: vanBookingsTable.passengerName,
      passengerPhone: vanBookingsTable.passengerPhone,
      paymentMethod: vanBookingsTable.paymentMethod,
      fare: vanBookingsTable.fare,
      boardedAt: vanBookingsTable.boardedAt,
      userName: usersTable.name,
      userPhone: usersTable.phone,
    })
      .from(vanBookingsTable)
      .leftJoin(usersTable, eq(vanBookingsTable.userId, usersTable.id))
      .where(and(
        eq(vanBookingsTable.scheduleId, scheduleId),
        eq(vanBookingsTable.travelDate, date),
        sql`${vanBookingsTable.status} NOT IN ('cancelled')`,
      ))
      .orderBy(asc(vanBookingsTable.createdAt));

    sendSuccess(res, bookings);
  } catch (e) {
    logger.error({ err: e }, "[van] driver passengers error");
    sendError(res, "Could not load passengers.", 500);
  }
});

/* PATCH /api/van/driver/bookings/:id/board — mark passenger as boarded */
router.patch("/driver/bookings/:id/board", riderAuth, async (req, res) => {
  try {
    const driverId = req.riderId!;
    const bookingId = req.params["id"]!;

    /* Verify booking's schedule belongs to this driver */
    const [booking] = await db.select({ id: vanBookingsTable.id, scheduleId: vanBookingsTable.scheduleId, status: vanBookingsTable.status })
      .from(vanBookingsTable).where(eq(vanBookingsTable.id, bookingId)).limit(1);
    if (!booking) { sendNotFound(res, "Booking not found."); return; }

    const [schedule] = await db.select({ driverId: vanSchedulesTable.driverId })
      .from(vanSchedulesTable).where(eq(vanSchedulesTable.id, booking.scheduleId)).limit(1);
    if (schedule?.driverId !== driverId) { sendForbidden(res, "Not authorized."); return; }

    if (booking.status !== "confirmed") { sendError(res, "Booking is not in confirmed state.", 400); return; }

    await db.update(vanBookingsTable)
      .set({ status: "boarded", boardedAt: new Date(), updatedAt: new Date() })
      .where(eq(vanBookingsTable.id, bookingId));
    sendSuccess(res, { message: "Passenger marked as boarded." });
  } catch (e) {
    logger.error({ err: e }, "[van] board passenger error");
    sendError(res, "Failed to mark passenger.", 500);
  }
});

/* PATCH /api/van/driver/schedules/:scheduleId/date/:date/complete — complete trip */
router.patch("/driver/schedules/:scheduleId/date/:date/complete", riderAuth, async (req, res) => {
  try {
    const driverId = req.riderId!;
    const { scheduleId, date } = req.params as { scheduleId: string; date: string };

    const [schedule] = await db.select({ driverId: vanSchedulesTable.driverId })
      .from(vanSchedulesTable).where(eq(vanSchedulesTable.id, scheduleId)).limit(1);
    if (schedule?.driverId !== driverId) { sendForbidden(res, "Not authorized."); return; }

    await db.update(vanBookingsTable)
      .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(vanBookingsTable.scheduleId, scheduleId),
        eq(vanBookingsTable.travelDate, date),
        sql`${vanBookingsTable.status} NOT IN ('cancelled', 'completed')`,
      ));

    sendSuccess(res, { message: "Trip completed." });
  } catch (e) {
    logger.error({ err: e }, "[van] complete trip error");
    sendError(res, "Failed to complete trip.", 500);
  }
});

/* ═══════════════════════════════════════════════════════════════
   ADMIN — van management endpoints
═══════════════════════════════════════════════════════════════ */

/* GET /api/van/admin/routes */
router.get("/admin/routes", adminAuth, async (_req, res) => {
  try {
    const routes = await db.select().from(vanRoutesTable).orderBy(asc(vanRoutesTable.sortOrder), asc(vanRoutesTable.name));
    sendSuccess(res, routes);
  } catch (e) { sendError(res, "Failed to load routes.", 500); }
});

const routeSchema = z.object({
  name:            z.string().min(1).max(100),
  nameUrdu:        z.string().max(100).optional(),
  fromAddress:     z.string().min(1).max(200),
  fromAddressUrdu: z.string().max(200).optional(),
  fromLat:         z.number().optional(),
  fromLng:         z.number().optional(),
  toAddress:       z.string().min(1).max(200),
  toAddressUrdu:   z.string().max(200).optional(),
  toLat:           z.number().optional(),
  toLng:           z.number().optional(),
  distanceKm:      z.number().optional(),
  durationMin:     z.number().int().optional(),
  farePerSeat:     z.number().min(1),
  notes:           z.string().max(500).optional(),
  isActive:        z.boolean().optional(),
  sortOrder:       z.number().int().optional(),
});

/* POST /api/van/admin/routes */
router.post("/admin/routes", adminAuth, async (req, res) => {
  const p = routeSchema.safeParse(req.body ?? {});
  if (!p.success) { sendError(res, p.error.issues.map(i => i.message).join("; "), 422); return; }
  try {
    const [route] = await db.insert(vanRoutesTable).values({
      id: generateId(), ...p.data,
      farePerSeat: String(p.data.farePerSeat),
      distanceKm: p.data.distanceKm ? String(p.data.distanceKm) : null,
      fromLat: p.data.fromLat ? String(p.data.fromLat) : null,
      fromLng: p.data.fromLng ? String(p.data.fromLng) : null,
      toLat: p.data.toLat ? String(p.data.toLat) : null,
      toLng: p.data.toLng ? String(p.data.toLng) : null,
    }).returning();
    sendCreated(res, route);
  } catch (e) { logger.error({ err: e }); sendError(res, "Failed to create route.", 500); }
});

/* PATCH /api/van/admin/routes/:id */
router.patch("/admin/routes/:id", adminAuth, async (req, res) => {
  const p = routeSchema.partial().safeParse(req.body ?? {});
  if (!p.success) { sendError(res, p.error.issues.map(i => i.message).join("; "), 422); return; }
  try {
    const updates: Record<string, unknown> = { ...p.data, updatedAt: new Date() };
    if (p.data.farePerSeat !== undefined) updates["farePerSeat"] = String(p.data.farePerSeat);
    if (p.data.distanceKm !== undefined) updates["distanceKm"] = String(p.data.distanceKm);
    if (p.data.fromLat !== undefined) updates["fromLat"] = String(p.data.fromLat);
    if (p.data.fromLng !== undefined) updates["fromLng"] = String(p.data.fromLng);
    if (p.data.toLat !== undefined) updates["toLat"] = String(p.data.toLat);
    if (p.data.toLng !== undefined) updates["toLng"] = String(p.data.toLng);
    const [route] = await db.update(vanRoutesTable).set(updates).where(eq(vanRoutesTable.id, req.params["id"]!)).returning();
    if (!route) { sendNotFound(res, "Route not found."); return; }
    sendSuccess(res, route);
  } catch (e) { logger.error({ err: e }); sendError(res, "Failed to update route.", 500); }
});

/* DELETE /api/van/admin/routes/:id  (soft delete) */
router.delete("/admin/routes/:id", adminAuth, async (req, res) => {
  try {
    await db.update(vanRoutesTable).set({ isActive: false, updatedAt: new Date() }).where(eq(vanRoutesTable.id, req.params["id"]!));
    sendSuccess(res, { message: "Route deactivated." });
  } catch (e) { sendError(res, "Failed to deactivate route.", 500); }
});

/* GET /api/van/admin/vehicles */
router.get("/admin/vehicles", adminAuth, async (_req, res) => {
  try {
    const vehicles = await db.select({
      id: vanVehiclesTable.id,
      plateNumber: vanVehiclesTable.plateNumber,
      model: vanVehiclesTable.model,
      totalSeats: vanVehiclesTable.totalSeats,
      isActive: vanVehiclesTable.isActive,
      driverId: vanVehiclesTable.driverId,
      driverName: usersTable.name,
      driverPhone: usersTable.phone,
      createdAt: vanVehiclesTable.createdAt,
    })
      .from(vanVehiclesTable)
      .leftJoin(usersTable, eq(vanVehiclesTable.driverId, usersTable.id))
      .orderBy(desc(vanVehiclesTable.createdAt));
    sendSuccess(res, vehicles);
  } catch (e) { sendError(res, "Failed to load vehicles.", 500); }
});

const vehicleSchema = z.object({
  plateNumber: z.string().min(1).max(20),
  model:       z.string().max(50).optional(),
  totalSeats:  z.number().int().min(1).max(50).optional(),
  driverId:    z.string().optional().nullable(),
  isActive:    z.boolean().optional(),
});

/* POST /api/van/admin/vehicles */
router.post("/admin/vehicles", adminAuth, async (req, res) => {
  const p = vehicleSchema.safeParse(req.body ?? {});
  if (!p.success) { sendError(res, p.error.issues.map(i => i.message).join("; "), 422); return; }
  try {
    const [vehicle] = await db.insert(vanVehiclesTable).values({ id: generateId(), ...p.data }).returning();
    sendCreated(res, vehicle);
  } catch (e) { sendError(res, "Failed to create vehicle.", 500); }
});

/* PATCH /api/van/admin/vehicles/:id */
router.patch("/admin/vehicles/:id", adminAuth, async (req, res) => {
  const p = vehicleSchema.partial().safeParse(req.body ?? {});
  if (!p.success) { sendError(res, p.error.issues.map(i => i.message).join("; "), 422); return; }
  try {
    const [vehicle] = await db.update(vanVehiclesTable)
      .set({ ...p.data, updatedAt: new Date() })
      .where(eq(vanVehiclesTable.id, req.params["id"]!)).returning();
    if (!vehicle) { sendNotFound(res, "Vehicle not found."); return; }
    sendSuccess(res, vehicle);
  } catch (e) { sendError(res, "Failed to update vehicle.", 500); }
});

/* GET /api/van/admin/schedules */
router.get("/admin/schedules", adminAuth, async (_req, res) => {
  try {
    const schedules = await db.select({
      id: vanSchedulesTable.id,
      routeId: vanSchedulesTable.routeId,
      vehicleId: vanSchedulesTable.vehicleId,
      driverId: vanSchedulesTable.driverId,
      departureTime: vanSchedulesTable.departureTime,
      returnTime: vanSchedulesTable.returnTime,
      daysOfWeek: vanSchedulesTable.daysOfWeek,
      isActive: vanSchedulesTable.isActive,
      routeName: vanRoutesTable.name,
      vehiclePlate: vanVehiclesTable.plateNumber,
      driverName: usersTable.name,
    })
      .from(vanSchedulesTable)
      .leftJoin(vanRoutesTable, eq(vanSchedulesTable.routeId, vanRoutesTable.id))
      .leftJoin(vanVehiclesTable, eq(vanSchedulesTable.vehicleId, vanVehiclesTable.id))
      .leftJoin(usersTable, eq(vanSchedulesTable.driverId, usersTable.id))
      .orderBy(asc(vanSchedulesTable.departureTime));
    sendSuccess(res, schedules);
  } catch (e) { sendError(res, "Failed to load schedules.", 500); }
});

const scheduleSchema = z.object({
  routeId:       z.string().min(1),
  vehicleId:     z.string().optional().nullable(),
  driverId:      z.string().optional().nullable(),
  departureTime: z.string().regex(/^\d{2}:\d{2}$/, "departureTime must be HH:MM"),
  returnTime:    z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  daysOfWeek:    z.array(z.number().int().min(1).max(7)).min(1).optional(),
  isActive:      z.boolean().optional(),
});

/* POST /api/van/admin/schedules */
router.post("/admin/schedules", adminAuth, async (req, res) => {
  const p = scheduleSchema.safeParse(req.body ?? {});
  if (!p.success) { sendError(res, p.error.issues.map(i => i.message).join("; "), 422); return; }
  try {
    const [schedule] = await db.insert(vanSchedulesTable).values({ id: generateId(), ...p.data }).returning();
    sendCreated(res, schedule);
  } catch (e) { sendError(res, "Failed to create schedule.", 500); }
});

/* PATCH /api/van/admin/schedules/:id */
router.patch("/admin/schedules/:id", adminAuth, async (req, res) => {
  const p = scheduleSchema.partial().safeParse(req.body ?? {});
  if (!p.success) { sendError(res, p.error.issues.map(i => i.message).join("; "), 422); return; }
  try {
    const [schedule] = await db.update(vanSchedulesTable)
      .set({ ...p.data, updatedAt: new Date() })
      .where(eq(vanSchedulesTable.id, req.params["id"]!)).returning();
    if (!schedule) { sendNotFound(res, "Schedule not found."); return; }
    sendSuccess(res, schedule);
  } catch (e) { sendError(res, "Failed to update schedule.", 500); }
});

/* DELETE /api/van/admin/schedules/:id */
router.delete("/admin/schedules/:id", adminAuth, async (req, res) => {
  try {
    await db.update(vanSchedulesTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(vanSchedulesTable.id, req.params["id"]!));
    sendSuccess(res, { message: "Schedule deactivated." });
  } catch (e) { sendError(res, "Failed to deactivate schedule.", 500); }
});

/* GET /api/van/admin/bookings?date=&routeId=&status= */
router.get("/admin/bookings", adminAuth, async (req, res) => {
  try {
    const dateFilter = req.query["date"] ? String(req.query["date"]) : null;
    const routeFilter = req.query["routeId"] ? String(req.query["routeId"]) : null;
    const statusFilter = req.query["status"] ? String(req.query["status"]) : null;

    const conditions = [];
    if (dateFilter) conditions.push(eq(vanBookingsTable.travelDate, dateFilter));
    if (routeFilter) conditions.push(eq(vanBookingsTable.routeId, routeFilter));
    if (statusFilter) conditions.push(sql`${vanBookingsTable.status} = ${statusFilter}`);

    const bookings = await db.select({
      id: vanBookingsTable.id,
      userId: vanBookingsTable.userId,
      scheduleId: vanBookingsTable.scheduleId,
      seatNumbers: vanBookingsTable.seatNumbers,
      travelDate: vanBookingsTable.travelDate,
      status: vanBookingsTable.status,
      fare: vanBookingsTable.fare,
      paymentMethod: vanBookingsTable.paymentMethod,
      passengerName: vanBookingsTable.passengerName,
      passengerPhone: vanBookingsTable.passengerPhone,
      boardedAt: vanBookingsTable.boardedAt,
      completedAt: vanBookingsTable.completedAt,
      cancelledAt: vanBookingsTable.cancelledAt,
      createdAt: vanBookingsTable.createdAt,
      routeName: vanRoutesTable.name,
      routeFrom: vanRoutesTable.fromAddress,
      routeTo: vanRoutesTable.toAddress,
      departureTime: vanSchedulesTable.departureTime,
      userName: usersTable.name,
      userPhone: usersTable.phone,
    })
      .from(vanBookingsTable)
      .leftJoin(vanRoutesTable, eq(vanBookingsTable.routeId, vanRoutesTable.id))
      .leftJoin(vanSchedulesTable, eq(vanBookingsTable.scheduleId, vanSchedulesTable.id))
      .leftJoin(usersTable, eq(vanBookingsTable.userId, usersTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(vanBookingsTable.createdAt))
      .limit(200);
    sendSuccess(res, bookings);
  } catch (e) { logger.error({ err: e }); sendError(res, "Failed to load bookings.", 500); }
});

/* PATCH /api/van/admin/bookings/:id/status */
router.patch("/admin/bookings/:id/status", adminAuth, async (req, res) => {
  const p = z.object({ status: z.enum(["confirmed", "boarded", "completed", "cancelled"]) }).safeParse(req.body ?? {});
  if (!p.success) { sendError(res, "Invalid status.", 422); return; }
  try {
    const [booking] = await db.update(vanBookingsTable)
      .set({ status: p.data.status, updatedAt: new Date() })
      .where(eq(vanBookingsTable.id, req.params["id"]!)).returning();
    if (!booking) { sendNotFound(res, "Booking not found."); return; }
    sendSuccess(res, booking);
  } catch (e) { sendError(res, "Failed to update status.", 500); }
});

export default router;
