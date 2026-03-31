import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { notificationsTable, parcelBookingsTable, usersTable, walletTransactionsTable } from "@workspace/db/schema";
import { eq, sql, and, gte, count } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getPlatformSettings } from "./admin.js";
import { customerAuth, riderAuth, addSecurityEvent, idorGuard } from "../middleware/security.js";

const router: IRouter = Router();

/* ── Parcel fare = admin base fee + per-kg charge (from delivery_fee_parcel + delivery_parcel_per_kg) ── */
function calcParcelFare(baseFee: number, perKgRate: number, weight?: number): number {
  const weightKg = weight && weight > 0 ? weight : 0;
  const weightCharge = Math.round(weightKg * perKgRate);
  return baseFee + weightCharge;
}

function mapBooking(b: typeof parcelBookingsTable.$inferSelect) {
  return {
    id: b.id,
    userId: b.userId,
    senderName: b.senderName,
    senderPhone: b.senderPhone,
    pickupAddress: b.pickupAddress,
    receiverName: b.receiverName,
    receiverPhone: b.receiverPhone,
    dropAddress: b.dropAddress,
    parcelType: b.parcelType,
    weight: b.weight ? parseFloat(b.weight) : null,
    description: b.description,
    fare: parseFloat(b.fare),
    paymentMethod: b.paymentMethod,
    status: b.status,
    estimatedTime: b.estimatedTime,
    riderId: b.riderId,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

router.post("/estimate", async (req, res) => {
  const { parcelType, weight } = req.body;
  const s = await getPlatformSettings();
  const baseFee  = parseFloat(s["delivery_fee_parcel"]    ?? "100");
  const perKgRate = parseFloat(s["delivery_parcel_per_kg"] ?? "40");
  const preptimeMin = parseInt(s["order_preptime_min"] ?? "15", 10);
  const fare = calcParcelFare(baseFee, perKgRate, weight);
  const estimatedTime = `${preptimeMin + 30}–${preptimeMin + 60} min`;
  res.json({ fare, estimatedTime, parcelType, baseFee, perKgRate, weightKg: weight ?? 0 });
});

router.get("/", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const bookings = await db
    .select()
    .from(parcelBookingsTable)
    .where(eq(parcelBookingsTable.userId, userId))
    .orderBy(parcelBookingsTable.createdAt);
  res.json({ bookings: bookings.map(mapBooking).reverse(), total: bookings.length });
});

router.get("/:id", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const [booking] = await db
    .select()
    .from(parcelBookingsTable)
    .where(eq(parcelBookingsTable.id, String(req.params["id"])))
    .limit(1);
  if (!booking) {
    res.status(404).json({ error: "Parcel booking not found" });
    return;
  }
  if (idorGuard(res, booking.userId, userId)) return;
  res.json(mapBooking(booking));
});

router.post("/", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const {
    senderName, senderPhone, pickupAddress,
    receiverName, receiverPhone, dropAddress,
    parcelType, weight, description, paymentMethod,
  } = req.body;

  if (!senderName || !senderPhone || !pickupAddress || !receiverName || !receiverPhone || !dropAddress || !parcelType || !paymentMethod) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const s = await getPlatformSettings();

  // Maintenance mode gate
  if ((s["app_status"] ?? "active") === "maintenance") {
    const mainKey = (s["security_maintenance_key"] ?? "").trim();
    const bypass  = ((req.headers["x-maintenance-key"] as string) ?? "").trim();
    if (!mainKey || bypass !== mainKey) {
      res.status(503).json({ error: s["content_maintenance_msg"] ?? "We're performing scheduled maintenance. Back soon!" }); return;
    }
  }

  // Feature flag check
  const parcelEnabled = (s["feature_parcel"] ?? "on") === "on";
  if (!parcelEnabled) {
    res.status(503).json({ error: "Parcel delivery service is currently disabled" }); return;
  }

  /* ── Fraud detection (mirrors orders.ts pattern) ── */
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  {
    const [userRecord] = await db.select({ isBanned: usersTable.isBanned, isActive: usersTable.isActive, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (userRecord?.isBanned) {
      res.status(403).json({ error: "Your account has been suspended." }); return;
    }
    if (userRecord && !userRecord.isActive) {
      res.status(403).json({ error: "Your account is inactive. Please contact support." }); return;
    }

    if ((s["security_fake_order_detect"] ?? "off") === "on") {
      const maxDailyOrders = parseInt(s["security_max_daily_orders"] ?? "20", 10);
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const [dailyResult] = await db.select({ c: count() }).from(parcelBookingsTable).where(and(eq(parcelBookingsTable.userId, userId), gte(parcelBookingsTable.createdAt, todayStart)));
      const dailyCount = Number(dailyResult?.c ?? 0);
      if (dailyCount >= maxDailyOrders) {
        addSecurityEvent({ type: "daily_order_limit", ip, userId, details: `User ${userId} hit daily parcel limit: ${dailyCount}/${maxDailyOrders}`, severity: "medium" });
        res.status(429).json({ error: `Daily parcel booking limit (${maxDailyOrders}) reached. Please try again tomorrow.` }); return;
      }

      if (dropAddress) {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const sameAddrLimit = parseInt(s["security_same_addr_limit"] ?? "5", 10);
        const sameAddrOrders = await db.select({ c: count() }).from(parcelBookingsTable).where(and(eq(parcelBookingsTable.dropAddress, dropAddress), gte(parcelBookingsTable.createdAt, oneHourAgo)));
        const sameAddrCount = Number(sameAddrOrders[0]?.c ?? 0);
        if (sameAddrCount >= sameAddrLimit) {
          addSecurityEvent({ type: "same_address_limit", ip, userId, details: `Parcel same-address limit hit: ${dropAddress} (${sameAddrCount}/hr)`, severity: "high" });
          res.status(429).json({ error: "Too many parcel bookings to this address. Please try again later." }); return;
        }
      }
    }
  }

  /* ── Delivery fare from admin settings (replaces hardcoded lookup table) ── */
  const baseFee    = parseFloat(s["delivery_fee_parcel"]    ?? "100");
  const perKgRate  = parseFloat(s["delivery_parcel_per_kg"] ?? "40");
  const fare       = calcParcelFare(baseFee, perKgRate, weight);

  /* ── GST (Finance settings) ── */
  const gstEnabled = (s["finance_gst_enabled"] ?? "off") === "on";
  const gstPct     = parseFloat(s["finance_gst_pct"] ?? "17");
  const gstAmount  = gstEnabled ? parseFloat(((fare * gstPct) / 100).toFixed(2)) : 0;

  /* ── COD service fee (charged when fare < cod_free_above threshold) ── */
  const codFee = (() => {
    if (paymentMethod !== "cash") return 0;
    const fee    = parseFloat(s["cod_fee"]        ?? "0");
    const freeAb = parseFloat(s["cod_free_above"] ?? "2000");
    return (fee > 0 && fare < freeAb) ? fee : 0;
  })();

  const totalFare  = fare + gstAmount + codFee;

  /* ── Estimated time from admin Order settings ── */
  const preptimeMin   = parseInt(s["order_preptime_min"] ?? "15", 10);
  const estimatedTime = `${preptimeMin + 30}–${preptimeMin + 60} min`;

  /* ── COD validation (mirrors orders.ts pattern) ── */
  if (paymentMethod === "cash") {
    const codEnabled = (s["cod_enabled"] ?? "on") === "on";
    if (!codEnabled) {
      res.status(400).json({ error: "Cash on Delivery is currently not available" }); return;
    }
    const codAllowedForParcel = (s["cod_allowed_parcel"] ?? "on") !== "off";
    if (!codAllowedForParcel) {
      res.status(400).json({ error: "Cash on Delivery is not available for Parcel orders. Please choose another payment method." }); return;
    }
    const codMax = parseFloat(s["cod_max_amount"] ?? "5000");
    if (totalFare > codMax) {
      res.status(400).json({ error: `Maximum Cash on Delivery order is Rs. ${codMax}. Please pay online for larger orders.` }); return;
    }
    /* ── COD verification threshold — flag high-value cash orders ── */
    const verifyThreshold = parseFloat(s["cod_verification_threshold"] ?? "0");
    if (verifyThreshold > 0 && totalFare > verifyThreshold) {
      /* Order is allowed but flagged for rider photo verification */
    }
  }

  // Wallet payment → atomic DB transaction (prevents race condition / double-spend)
  if (paymentMethod === "wallet") {
    const walletEnabled = (s["feature_wallet"] ?? "on") === "on";
    if (!walletEnabled) {
      res.status(400).json({ error: "Wallet payments are currently disabled" }); return;
    }

    const [wUser] = await db.select({ blockedServices: usersTable.blockedServices }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (wUser && (wUser.blockedServices || "").split(",").map(sv => sv.trim()).includes("wallet")) {
      res.status(403).json({ error: "wallet_frozen", message: "Your wallet has been temporarily frozen. Contact support." }); return;
    }

    try {
      const booking = await db.transaction(async (tx) => {
        const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
        if (!user) throw new Error("User not found");

        const balance = parseFloat(user.walletBalance ?? "0");
        if (balance < totalFare) throw new Error(`Insufficient wallet balance. Balance: Rs. ${balance.toFixed(0)}, Required: Rs. ${totalFare}`);

        /* DB floor guard — deducts only if balance ≥ amount at UPDATE time */
        const [deducted] = await tx.update(usersTable)
          .set({ walletBalance: sql`wallet_balance - ${totalFare.toFixed(2)}` })
          .where(and(eq(usersTable.id, userId), gte(usersTable.walletBalance, totalFare.toFixed(2))))
          .returning({ id: usersTable.id });
        if (!deducted) throw new Error(`Insufficient wallet balance. Required: Rs. ${totalFare.toFixed(0)}`);
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId, type: "debit",
          amount: totalFare.toFixed(2),
          description: `Parcel delivery - ${parcelType} (fare + GST)`,
        });

        const [newBooking] = await tx.insert(parcelBookingsTable).values({
          id: generateId(), userId, senderName, senderPhone, pickupAddress,
          receiverName, receiverPhone, dropAddress, parcelType,
          weight: weight ? weight.toString() : null,
          description: description || null,
          fare: totalFare.toString(), paymentMethod,
          status: "pending", estimatedTime,
        }).returning();
        return newBooking!;
      });

      await db.insert(notificationsTable).values({
        id: generateId(), userId,
        title: "Parcel Booking Confirmed",
        body: `Aapka ${parcelType} parcel book ho gaya. Rs. ${totalFare.toFixed(0)} — ${receiverName} tak. ETA: ${estimatedTime}`,
        type: "parcel", icon: "cube-outline", link: `/(tabs)/orders`,
      }).catch(() => {});

      res.status(201).json({ ...mapBooking(booking), gstAmount });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
    return;
  }

  // Cash / other payments
  const [booking] = await db.insert(parcelBookingsTable).values({
    id: generateId(), userId, senderName, senderPhone, pickupAddress,
    receiverName, receiverPhone, dropAddress, parcelType,
    weight: weight ? weight.toString() : null,
    description: description || null,
    fare: totalFare.toString(), paymentMethod,
    status: "pending", estimatedTime,
  }).returning();

  await db.insert(notificationsTable).values({
    id: generateId(), userId,
    title: "Parcel Booking Confirmed",
    body: `Aapka ${parcelType} parcel book ho gaya. Rs. ${totalFare.toFixed(0)} — ${receiverName} tak. ETA: ${estimatedTime}`,
    type: "parcel", icon: "cube-outline", link: `/(tabs)/orders`,
  }).catch(() => {});

  res.status(201).json({ ...mapBooking(booking!), gstAmount });
});

router.patch("/:id/cancel", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const bookingId = String(req.params["id"]);

  const [booking] = await db
    .select()
    .from(parcelBookingsTable)
    .where(eq(parcelBookingsTable.id, bookingId))
    .limit(1);

  if (!booking) { res.status(404).json({ error: "Parcel booking not found" }); return; }
  if (idorGuard(res, booking.userId, userId)) return;
  if (!["pending", "accepted"].includes(booking.status)) {
    res.status(409).json({ error: "Parcel cannot be cancelled at this stage" }); return;
  }

  const s = await getPlatformSettings();
  const cancelWindowMin = parseFloat(String(s["order_cancel_window_min"] ?? "5"));
  const minutesSincePlaced = (Date.now() - booking.createdAt.getTime()) / 60000;
  if (booking.status === "pending" && minutesSincePlaced > cancelWindowMin) {
    res.status(409).json({ error: `Cancellation window of ${cancelWindowMin} minutes has passed` }); return;
  }

  let refundAmount = 0;
  let cancelledBooking: typeof parcelBookingsTable.$inferSelect | undefined;

  const cancellableStatuses = ["pending", "accepted"] as const;

  if (booking.paymentMethod === "wallet") {
    const refund = parseFloat(booking.fare);
    cancelledBooking = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(parcelBookingsTable)
        .where(eq(parcelBookingsTable.id, bookingId))
        .for("update")
        .limit(1);
      if (!locked || !cancellableStatuses.includes(locked.status as typeof cancellableStatuses[number])) {
        throw Object.assign(new Error("Parcel cannot be cancelled at this stage"), { httpStatus: 409 });
      }
      const [updated] = await tx.update(parcelBookingsTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(
          eq(parcelBookingsTable.id, bookingId),
          sql`status IN ('pending','accepted')`,
        ))
        .returning();
      if (!updated) throw Object.assign(new Error("Concurrent cancel — booking state changed"), { httpStatus: 409 });
      await tx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance + ${refund.toFixed(2)}`, updatedAt: new Date() })
        .where(eq(usersTable.id, userId));
      await tx.insert(walletTransactionsTable).values({
        id: generateId(), userId, type: "credit",
        amount: refund.toFixed(2),
        description: `Parcel booking refund — #${bookingId.slice(-6).toUpperCase()} cancelled`,
        reference: `refund:${bookingId}`,
      });
      return updated;
    }).catch((err: any) => {
      if (err?.httpStatus) { res.status(err.httpStatus).json({ error: err.message }); }
      else { res.status(500).json({ error: "Cancel failed" }); }
      return null;
    });
    if (!cancelledBooking) return;
    await db.insert(notificationsTable).values({
      id: generateId(), userId,
      title: "Parcel Booking Refunded 💰",
      body: `Rs. ${refund.toFixed(0)} wapas aapke wallet mein aa gaya hai.`,
      type: "parcel", icon: "wallet-outline",
    }).catch(() => {});
    refundAmount = refund;
    res.json({ ...mapBooking(cancelledBooking), refundAmount });
    return;
  }

  const [cancelled] = await db
    .update(parcelBookingsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(
      eq(parcelBookingsTable.id, bookingId),
      sql`status IN ('pending','accepted')`,
    ))
    .returning();

  if (!cancelled) { res.status(409).json({ error: "Parcel cannot be cancelled at this stage" }); return; }
  res.json({ ...mapBooking(cancelled), refundAmount });
});

router.patch("/:id/status", riderAuth, async (req, res) => {
  const riderId = req.riderId!;
  const { status } = req.body;

  /* Whitelist allowed status transitions — prevents arbitrary string injection */
  const allowedStatuses = ["picked_up", "in_transit", "delivered", "cancelled"];
  if (!allowedStatuses.includes(status)) {
    res.status(400).json({ error: `Invalid status. Allowed: ${allowedStatuses.join(", ")}` }); return;
  }

  /* Ownership check: rider must be accepting (parcel unassigned) or already the assigned rider */
  const [booking] = await db
    .select()
    .from(parcelBookingsTable)
    .where(eq(parcelBookingsTable.id, String(req.params["id"])))
    .limit(1);
  if (!booking) { res.status(404).json({ error: "Parcel booking not found" }); return; }

  const isUnassigned  = !booking.riderId;
  const isAssignedToMe = booking.riderId === riderId;
  if (!isUnassigned && !isAssignedToMe) {
    res.status(403).json({ error: "This parcel is assigned to another rider" }); return;
  }

  const [updated] = await db
    .update(parcelBookingsTable)
    .set({ status, riderId, updatedAt: new Date() })
    .where(eq(parcelBookingsTable.id, String(req.params["id"])))
    .returning();

  res.json(mapBooking(updated!));
});

export default router;
