import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { notificationsTable, parcelBookingsTable, usersTable, walletTransactionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getPlatformSettings } from "./admin.js";
import { customerAuth, riderAuth } from "../middleware/security.js";

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
  const userId = (req as any).customerId as string;
  const bookings = await db
    .select()
    .from(parcelBookingsTable)
    .where(eq(parcelBookingsTable.userId, userId))
    .orderBy(parcelBookingsTable.createdAt);
  res.json({ bookings: bookings.map(mapBooking).reverse(), total: bookings.length });
});

router.get("/:id", customerAuth, async (req, res) => {
  const userId = (req as any).customerId as string;
  const [booking] = await db
    .select()
    .from(parcelBookingsTable)
    .where(eq(parcelBookingsTable.id, req.params["id"]!))
    .limit(1);
  if (!booking) {
    res.status(404).json({ error: "Parcel booking not found" });
    return;
  }
  if (booking.userId !== userId) { res.status(403).json({ error: "Access denied" }); return; }
  res.json(mapBooking(booking));
});

router.post("/", customerAuth, async (req, res) => {
  const userId = (req as any).customerId as string;
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

    try {
      const booking = await db.transaction(async (tx) => {
        const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
        if (!user) throw new Error("User not found");

        const balance = parseFloat(user.walletBalance ?? "0");
        if (balance < totalFare) throw new Error(`Insufficient wallet balance. Balance: Rs. ${balance.toFixed(0)}, Required: Rs. ${totalFare}`);

        const newBalance = (balance - totalFare).toFixed(2);
        await tx.update(usersTable).set({ walletBalance: newBalance }).where(eq(usersTable.id, userId));
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

router.patch("/:id/status", riderAuth, async (req, res) => {
  const riderId = (req as any).riderId as string;
  const { status } = req.body;
  const updateData: Partial<typeof parcelBookingsTable.$inferInsert> = { status, riderId, updatedAt: new Date() };
  const [booking] = await db
    .update(parcelBookingsTable)
    .set(updateData)
    .where(eq(parcelBookingsTable.id, req.params["id"]!))
    .returning();
  if (!booking) {
    res.status(404).json({ error: "Parcel booking not found" });
    return;
  }
  res.json(mapBooking(booking));
});

export default router;
