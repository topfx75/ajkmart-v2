import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable, ordersTable, rideBidsTable, ridesTable, riderPenaltiesTable, walletTransactionsTable, notificationsTable, liveLocationsTable, reviewsTable } from "@workspace/db/schema";
import { eq, desc, and, or, sql, count, sum, avg, gte, isNull, type InferSelectModel } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getPlatformSettings } from "./admin.js";
import { verifyUserJwt, getCachedSettings, detectGPSSpoof, addSecurityEvent, getClientIp } from "../middleware/security.js";
import { z } from "zod";

const router: IRouter = Router();

const safeNum = (v: any, def = 0) => { const n = parseFloat(String(v ?? def)); return isNaN(n) ? def : n; };

const onlineSchema = z.object({ isOnline: z.boolean() });

const profileSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  cnic: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  emergencyContact: z.string().optional(),
  vehicleType: z.string().optional(),
  vehiclePlate: z.string().optional(),
  vehicleRegNo: z.string().optional(),
  drivingLicense: z.string().optional(),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  bankAccountTitle: z.string().optional(),
  avatar: z.string().optional(),
});

const MAX_PROOF_PHOTO_BYTES = 5 * 1024 * 1024;
const orderStatusSchema = z.object({
  status: z.enum(["out_for_delivery", "picked_up", "delivered", "cancelled"]),
  proofPhoto: z.string()
    .refine(v => v.startsWith("data:image/"), "proofPhoto must be a base64 data URI (data:image/...)")
    .refine(v => v.length <= MAX_PROOF_PHOTO_BYTES, "proofPhoto exceeds 5 MB limit")
    .optional(),
});

const rideStatusSchema = z.object({
  status: z.enum(["arrived", "in_transit", "completed", "cancelled"]),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

const RIDE_STATUS_TRANSITIONS: Record<string, string[]> = {
  accepted:   ["arrived", "cancelled"],
  arrived:    ["in_transit", "cancelled"],
  in_transit: ["completed", "cancelled"],
};

const counterSchema = z.object({
  counterFare: z.number().positive(),
  note: z.string().optional(),
});

const withdrawSchema = z.object({
  amount: z.number().positive(),
  bankName: z.string().min(1),
  accountNumber: z.string().min(1),
  accountTitle: z.string().min(1),
  paymentMethod: z.string().optional(),
  note: z.string().optional(),
});

const depositSchema = z.object({
  amount: z.number().min(100),
  paymentMethod: z.string().min(1),
  transactionId: z.string().min(1),
  accountNumber: z.string().optional(),
  note: z.string().optional(),
});

const codRemitSchema = z.object({
  amount: z.number().positive(),
  paymentMethod: z.string().min(1),
  accountNumber: z.string().min(1),
  transactionId: z.string().optional(),
  note: z.string().optional(),
});

const idParamSchema = z.object({ id: z.string().min(1, "ID is required") });

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().optional(),
});

/* ── Auth Middleware ── */
async function riderAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  const tokenHeader = req.headers["x-auth-token"] as string | undefined;
  const raw = tokenHeader || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

  if (!raw) { res.status(401).json({ error: "Authentication required" }); return; }

  const payload = verifyUserJwt(raw);
  if (!payload) { res.status(401).json({ error: "Invalid or expired session. Please log in again." }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }
  if (!user.isActive && !(user.isRestricted || (user.cancelCount ?? 0) > 0)) {
    res.status(403).json({ error: "Account is inactive" }); return;
  }
  if (user.isBanned) { res.status(403).json({ error: "Account is banned" }); return; }

  /* Enforce rider role — check BOTH the JWT claim and the DB roles field */
  const dbRoles = (user.roles || user.role || "").split(",").map((r: string) => r.trim());
  const jwtRoles = (payload.roles || payload.role || "").split(",").map((r: string) => r.trim());
  if (!dbRoles.includes("rider") || !jwtRoles.includes("rider")) {
    res.status(403).json({ error: "Access denied. This portal is for riders only." }); return;
  }

  req.riderId = user.id;
  req.riderUser = user;
  next();
}

router.use(riderAuth);

/* ── GET /rider/me — Profile ── */
router.get("/me", async (req, res) => {
  const user = req.riderUser!;
  const riderId = user.id;
  const today = new Date(); today.setHours(0,0,0,0);

  const s = await getPlatformSettings();
  const riderKeepPct = parseFloat(s["rider_keep_pct"] ?? "80") / 100;

  const [
    ordersTodayStats, ordersAllStats,
    ridesTodayStats,  ridesAllStats,
  ] = await Promise.all([
    db.select({ c: count(), s: sum(ordersTable.total) }).from(ordersTable)
      .where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"), gte(ordersTable.createdAt, today))),
    db.select({ c: count(), s: sum(ordersTable.total) }).from(ordersTable)
      .where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"))),
    db.select({ c: count(), s: sum(ridesTable.fare) }).from(ridesTable)
      .where(and(eq(ridesTable.riderId, riderId), eq(ridesTable.status, "completed"), gte(ridesTable.createdAt, today))),
    db.select({ c: count(), s: sum(ridesTable.fare) }).from(ridesTable)
      .where(and(eq(ridesTable.riderId, riderId), eq(ridesTable.status, "completed"))),
  ]);

  const deliveriesToday = (ordersTodayStats[0]?.c ?? 0) + (ridesTodayStats[0]?.c ?? 0);
  const earningsToday   = (safeNum(ordersTodayStats[0]?.s) + safeNum(ridesTodayStats[0]?.s)) * riderKeepPct;
  const totalDeliveries = (ordersAllStats[0]?.c ?? 0) + (ridesAllStats[0]?.c ?? 0);
  const totalEarnings   = (safeNum(ordersAllStats[0]?.s) + safeNum(ridesAllStats[0]?.s)) * riderKeepPct;

  const [ratingRow] = await db.select({ avg: avg(reviewsTable.rating) }).from(reviewsTable).where(eq(reviewsTable.riderId, riderId));
  const avgRating = ratingRow?.avg ? parseFloat(parseFloat(String(ratingRow.avg)).toFixed(1)) : null;

  res.json({
    id: user.id, phone: user.phone, name: user.name, email: user.email,
    avatar: user.avatar, isOnline: user.isOnline,
    isRestricted: user.isRestricted ?? (!user.isActive && (user.cancelCount ?? 0) > 0),
    walletBalance: safeNum(user.walletBalance),
    cnic: user.cnic, address: user.address, city: user.city,
    emergencyContact: user.emergencyContact,
    vehicleType: user.vehicleType, vehiclePlate: user.vehiclePlate,
    vehicleRegNo: user.vehicleRegNo, drivingLicense: user.drivingLicense,
    bankName: user.bankName, bankAccount: user.bankAccount, bankAccountTitle: user.bankAccountTitle,
    twoFactorEnabled: !!user.totpEnabled,
    lastLoginAt: user.lastLoginAt, createdAt: user.createdAt,
    stats: {
      deliveriesToday,
      earningsToday:   parseFloat(earningsToday.toFixed(2)),
      totalDeliveries,
      totalEarnings:   parseFloat(totalEarnings.toFixed(2)),
      rating: avgRating,
    },
  });
});

/* ── PATCH /rider/online — Toggle online status ── */
router.patch("/online", async (req, res) => {
  const parsed = onlineSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" }); return; }
  const riderId = req.riderId!;
  const { isOnline } = parsed.data;
  await db.update(usersTable).set({ isOnline: !!isOnline, updatedAt: new Date() }).where(eq(usersTable.id, riderId));
  res.json({ success: true, isOnline: !!isOnline });
});

/* ── PATCH /rider/profile — Update profile ── */
router.patch("/profile", async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" }); return; }
  const riderId = req.riderId!;
  const { name, email, cnic, address, city, emergencyContact, vehicleType, vehiclePlate, vehicleRegNo, drivingLicense, bankName, bankAccount, bankAccountTitle, avatar } = parsed.data;
  const updates: any = { updatedAt: new Date() };
  if (name             !== undefined) updates.name             = name;
  if (email            !== undefined) updates.email            = email;
  if (cnic             !== undefined) updates.cnic             = cnic;
  if (address          !== undefined) updates.address          = address;
  if (city             !== undefined) updates.city             = city;
  if (emergencyContact !== undefined) updates.emergencyContact = emergencyContact;
  if (vehicleType      !== undefined) updates.vehicleType      = vehicleType;
  if (vehiclePlate     !== undefined) updates.vehiclePlate     = vehiclePlate;
  if (vehicleRegNo     !== undefined) updates.vehicleRegNo     = vehicleRegNo;
  if (drivingLicense   !== undefined) updates.drivingLicense   = drivingLicense;
  if (bankName         !== undefined) updates.bankName         = bankName;
  if (bankAccount      !== undefined) updates.bankAccount      = bankAccount;
  if (bankAccountTitle !== undefined) updates.bankAccountTitle = bankAccountTitle;
  if (avatar           !== undefined) {
    if (avatar && !avatar.startsWith("/api/uploads/")) {
      res.status(400).json({ error: "Avatar must be an uploaded file URL" });
      return;
    }
    updates.avatar = avatar;
  }
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, riderId)).returning();
  res.json({
    id: user.id, name: user.name, phone: user.phone, email: user.email,
    avatar: user.avatar,
    role: user.role, isOnline: user.isOnline, walletBalance: safeNum(user.walletBalance),
    cnic: user.cnic, address: user.address, city: user.city,
    emergencyContact: user.emergencyContact,
    vehicleType: user.vehicleType, vehiclePlate: user.vehiclePlate,
    vehicleRegNo: user.vehicleRegNo, drivingLicense: user.drivingLicense,
    bankName: user.bankName, bankAccount: user.bankAccount, bankAccountTitle: user.bankAccountTitle,
    createdAt: user.createdAt, lastLoginAt: user.lastLoginAt,
  });
});

/* ── Haversine distance (km) ── */
function calcDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── GET /rider/requests — Available orders + rides (incl. bargaining, with own bid info + distance/ETA) ── */
/* InDrive-style broadcast: ALL nearby riders within admin radius see every open ride.
   First to accept wins via atomic WHERE riderId IS NULL. */
router.get("/requests", async (req, res) => {
  const riderId = req.riderId!;
  const s = await getPlatformSettings();
  const avgSpeed = parseFloat(s["dispatch_avg_speed_kmh"] ?? "25");
  const radiusKm = parseFloat(s["dispatch_min_radius_km"] ?? "5");

  const [orders, rides, myBids, riderLoc] = await Promise.all([
    db.select().from(ordersTable)
      .where(or(eq(ordersTable.status, "confirmed"), eq(ordersTable.status, "preparing")))
      .orderBy(desc(ordersTable.createdAt)).limit(20),
    db.select().from(ridesTable)
      .where(and(
        or(eq(ridesTable.status, "searching"), eq(ridesTable.status, "bargaining")),
        isNull(ridesTable.riderId),
      ))
      .orderBy(desc(ridesTable.createdAt)).limit(30),
    db.select().from(rideBidsTable)
      .where(and(eq(rideBidsTable.riderId, riderId), eq(rideBidsTable.status, "pending"))),
    db.select().from(liveLocationsTable)
      .where(eq(liveLocationsTable.userId, riderId)).limit(1),
  ]);

  const myBidMap = new Map<string, (typeof myBids)[0]>(myBids.map(b => [b.rideId, b]));
  const rLoc = riderLoc[0] ? { lat: parseFloat(String(riderLoc[0].latitude)), lng: parseFloat(String(riderLoc[0].longitude)) } : null;

  const filteredRides = rides
    .map(r => {
      let riderDistanceKm: number | null = null;
      let riderEtaMin: number | null = null;
      if (rLoc && r.pickupLat && r.pickupLng) {
        riderDistanceKm = Math.round(calcDistance(rLoc.lat, rLoc.lng, parseFloat(r.pickupLat), parseFloat(r.pickupLng)) * 10) / 10;
        riderEtaMin = Math.max(1, Math.round((riderDistanceKm / avgSpeed) * 60));
      }
      return {
        ...r,
        fare:          safeNum(r.fare),
        distance:      safeNum(r.distance),
        offeredFare:   r.offeredFare ? safeNum(r.offeredFare) : null,
        counterFare:   r.counterFare ? safeNum(r.counterFare) : null,
        bargainRounds: r.bargainRounds ?? 0,
        riderDistanceKm,
        riderEtaMin,
        myBid: myBidMap.has(r.id) ? {
          id:   myBidMap.get(r.id)!.id,
          fare: safeNum(myBidMap.get(r.id)!.fare),
          note: myBidMap.get(r.id)!.note,
        } : null,
      };
    })
    .filter(r => {
      if (r.riderDistanceKm === null) return true;
      return r.riderDistanceKm <= radiusKm;
    })
    .sort((a, b) => (a.riderDistanceKm ?? 999) - (b.riderDistanceKm ?? 999));

  res.json({
    orders: orders.map(o => ({ ...o, total: safeNum(o.total) })),
    rides: filteredRides,
  });
});

/* ── GET /rider/active — Current active delivery ── */
router.get("/active", async (req, res) => {
  const riderId = req.riderId!;
  const [order, ride] = await Promise.all([
    db.select().from(ordersTable).where(and(eq(ordersTable.riderId, riderId), or(eq(ordersTable.status, "out_for_delivery"), eq(ordersTable.status, "picked_up")))).orderBy(desc(ordersTable.updatedAt)).limit(1),
    db.select().from(ridesTable).where(and(eq(ridesTable.riderId, riderId), or(eq(ridesTable.status, "accepted"), eq(ridesTable.status, "arrived"), eq(ridesTable.status, "in_transit")))).orderBy(desc(ridesTable.updatedAt)).limit(1),
  ]);

  // Enrich with customer name/phone so rider can call the customer
  let enrichedRide = null;
  if (ride[0]) {
    const [customer] = await db.select({ name: usersTable.name, phone: usersTable.phone })
      .from(usersTable).where(eq(usersTable.id, ride[0].userId)).limit(1);
    enrichedRide = {
      ...ride[0],
      fare: safeNum(ride[0].fare),
      distance: safeNum(ride[0].distance),
      customerName:  customer?.name  || null,
      customerPhone: customer?.phone || null,
    };
  }

  let enrichedOrder = null;
  if (order[0]) {
    const promises: [Promise<any>, Promise<any>] = [
      db.select({ name: usersTable.name, phone: usersTable.phone })
        .from(usersTable).where(eq(usersTable.id, order[0].userId)).limit(1),
      order[0].vendorId
        ? db.select({ storeName: usersTable.storeName, phone: usersTable.phone })
            .from(usersTable).where(eq(usersTable.id, order[0].vendorId)).limit(1)
        : Promise.resolve([]),
    ];
    const [customerRows, vendorRows] = await Promise.all(promises);
    const customer = customerRows[0];
    const vendor   = vendorRows[0];
    enrichedOrder = {
      ...order[0],
      total: safeNum(order[0].total),
      customerName:  customer?.name  || null,
      customerPhone: customer?.phone || null,
      vendorStoreName:  vendor?.storeName  || null,
      vendorPhone:      vendor?.phone      || null,
    };
  }

  res.json({ order: enrichedOrder, ride: enrichedRide });
});

/* ── POST /rider/orders/:id/accept — Accept an order ──
   Uses WHERE riderId IS NULL to prevent two riders accepting the same order (race condition) */
router.post("/orders/:id/accept", async (req, res) => {
  const paramParsed = idParamSchema.safeParse(req.params);
  if (!paramParsed.success) { res.status(400).json({ error: "Invalid order ID" }); return; }
  const riderId   = req.riderId!;
  const riderUser = req.riderUser!;
  const orderId   = paramParsed.data.id;

  if (riderUser.isRestricted) {
    res.status(403).json({ error: "Your account is restricted. You cannot accept new orders. Contact support for assistance." }); return;
  }

  const s = await getPlatformSettings();

  /* ── Load target order first (needed for cash/COD checks) ── */
  const [targetOrder] = await db.select({ paymentMethod: ordersTable.paymentMethod })
    .from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);

  /* ── Cash-order gate: admin can restrict riders from taking cash orders ── */
  const cashAllowed = (s["rider_cash_allowed"] ?? "on") === "on";
  if (!cashAllowed) {
    if (targetOrder?.paymentMethod === "cash" || targetOrder?.paymentMethod === "cod") {
      res.status(403).json({ error: "Cash-on-delivery orders are currently not available for riders." }); return;
    }
  }

  /* ── Minimum wallet balance gate for cash/COD orders ── */
  const isCashOrder = targetOrder?.paymentMethod === "cash" || targetOrder?.paymentMethod === "cod";
  if (isCashOrder) {
    const minBalance = parseFloat(s["rider_min_balance"] ?? "0");
    if (minBalance > 0) {
      const [riderRow] = await db.select({ walletBalance: usersTable.walletBalance })
        .from(usersTable).where(eq(usersTable.id, riderId)).limit(1);
      const currentBal = safeNum(riderRow?.walletBalance);
      if (currentBal < minBalance) {
        res.status(403).json({
          error: `Minimum wallet balance required for cash orders is Rs. ${minBalance}. Your balance: Rs. ${currentBal.toFixed(0)}. Please top up your wallet to accept cash orders.`,
          code: "BELOW_MIN_BALANCE",
          required: minBalance,
          current: currentBal,
        }); return;
      }
    }
  }

  // Check max simultaneous deliveries limit
  const maxDeliveries = parseInt(s["rider_max_deliveries"] ?? "3");
  const [activeOrders, activeRides] = await Promise.all([
    db.select({ c: count() }).from(ordersTable).where(and(eq(ordersTable.riderId, riderId), or(eq(ordersTable.status, "out_for_delivery"), eq(ordersTable.status, "picked_up")))),
    db.select({ c: count() }).from(ridesTable).where(and(eq(ridesTable.riderId, riderId), or(eq(ridesTable.status, "accepted"), eq(ridesTable.status, "arrived"), eq(ridesTable.status, "in_transit")))),
  ]);
  const activeCount = (activeOrders[0]?.c ?? 0) + (activeRides[0]?.c ?? 0);
  if (activeCount >= maxDeliveries) {
    res.status(429).json({ error: `Maximum ${maxDeliveries} active deliveries allowed. Complete a current delivery first.` }); return;
  }

  // Atomic accept: only succeeds if riderId is still NULL in DB
  const [updated] = await db
    .update(ordersTable)
    .set({ riderId, status: "out_for_delivery", updatedAt: new Date() })
    .where(and(eq(ordersTable.id, orderId), isNull(ordersTable.riderId)))
    .returning();

  if (!updated) {
    // Either not found OR already taken by another rider
    const [existing] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
    if (!existing) { res.status(404).json({ error: "Order not found" }); return; }
    res.status(409).json({ error: "Order already taken by another rider" }); return;
  }

  await db.insert(notificationsTable).values({
    id: generateId(), userId: updated.userId,
    title: "Rider on the Way! 🚴",
    body: "Your order has been picked up. Rider is on the way!",
    type: "order", icon: "bicycle-outline",
  }).catch((err: Error) => { console.error("[rider] background op failed:", err.message); });

  res.json({ ...updated, total: safeNum(updated.total) });
});

/* ── Cancellation penalty helper ── */
async function handleCancelPenalty(riderId: string): Promise<{ dailyCancels: number; penaltyApplied: number; restricted: boolean }> {
  const s = await getPlatformSettings();
  const limit = parseInt(s["rider_cancel_limit_daily"] ?? "3", 10);
  const penaltyAmt = parseFloat(s["rider_cancel_penalty_amount"] ?? "50");
  const restrictEnabled = (s["rider_cancel_restrict_enabled"] ?? "on") === "on";

  const today = new Date(); today.setHours(0, 0, 0, 0);

  const [countRow] = await db.select({ c: count() })
    .from(walletTransactionsTable)
    .where(and(
      eq(walletTransactionsTable.userId, riderId),
      eq(walletTransactionsTable.type, "cancel_penalty"),
      gte(walletTransactionsTable.createdAt, today),
    ));
  const dailyCancels = (countRow?.c ?? 0) + 1;

  let penaltyApplied = 0;
  let restricted = false;

  await db.insert(walletTransactionsTable).values({
    id: generateId(), userId: riderId, type: "cancel_penalty",
    amount: "0",
    description: `Cancellation #${dailyCancels} today`,
    reference: `cancel:${Date.now()}`,
  });

  await db.update(usersTable)
    .set({ cancelCount: sql`cancel_count + 1`, updatedAt: new Date() })
    .where(eq(usersTable.id, riderId));

  if (dailyCancels > limit) {
    penaltyApplied = penaltyAmt;
    await db.transaction(async (tx) => {
      await tx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance - ${penaltyAmt}`, updatedAt: new Date() })
        .where(eq(usersTable.id, riderId));
      await tx.insert(walletTransactionsTable).values({
        id: generateId(), userId: riderId, type: "cancel_penalty",
        amount: penaltyAmt.toFixed(2),
        description: `Excessive cancellation penalty (${dailyCancels}/${limit} today) — Rs. ${penaltyAmt} deducted`,
        reference: `cancel_penalty:${Date.now()}`,
      });
      await tx.insert(riderPenaltiesTable).values({
        id: generateId(), riderId, type: "cancel",
        amount: penaltyAmt.toFixed(2),
        reason: `Excessive cancellation (${dailyCancels}/${limit} today)`,
      });
    });

    if (restrictEnabled) {
      await db.update(usersTable)
        .set({ isRestricted: true, updatedAt: new Date() })
        .where(eq(usersTable.id, riderId));
      restricted = true;
    }

    await db.insert(notificationsTable).values({
      id: generateId(), userId: riderId,
      title: restricted ? "Account Restricted ⚠️" : "Cancellation Penalty ⚠️",
      body: restricted
        ? `You cancelled ${dailyCancels} times today (limit: ${limit}). Rs. ${penaltyAmt} penalty applied and your account has been restricted. Contact support to re-activate.`
        : `You cancelled ${dailyCancels} times today (limit: ${limit}). Rs. ${penaltyAmt} penalty applied.`,
      type: "system", icon: "alert-circle-outline",
    }).catch(() => {});
  } else if (dailyCancels === limit) {
    await db.insert(notificationsTable).values({
      id: generateId(), userId: riderId,
      title: "Cancellation Warning ⚠️",
      body: `You have cancelled ${dailyCancels}/${limit} times today. Next cancellation will incur a Rs. ${penaltyAmt} penalty and possible account restriction.`,
      type: "system", icon: "alert-circle-outline",
    }).catch(() => {});
  }

  return { dailyCancels, penaltyApplied, restricted };
}

/* ── GET /rider/cancel-stats — Rider's cancellation stats for today ── */
router.get("/cancel-stats", async (req, res) => {
  const riderId = req.riderId!;
  const s = await getPlatformSettings();
  const limit = parseInt(s["rider_cancel_limit_daily"] ?? "3", 10);
  const penaltyAmt = parseFloat(s["rider_cancel_penalty_amount"] ?? "50");

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [countRow] = await db.select({ c: count() })
    .from(walletTransactionsTable)
    .where(and(
      eq(walletTransactionsTable.userId, riderId),
      eq(walletTransactionsTable.type, "cancel_penalty"),
      gte(walletTransactionsTable.createdAt, today),
    ));

  res.json({
    dailyCancels: countRow?.c ?? 0,
    dailyLimit: limit,
    penaltyAmount: penaltyAmt,
    remaining: Math.max(0, limit - (countRow?.c ?? 0)),
  });
});

/* ── PATCH /rider/orders/:id/status — Update order status (delivered) ── */
router.patch("/orders/:id/status", async (req, res) => {
  const parsed = orderStatusSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid status" }); return; }
  const riderId = req.riderId!;
  const { status, proofPhoto } = parsed.data;

  const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, req.params["id"]!), eq(ordersTable.riderId, riderId))).limit(1);
  if (!order) { res.status(404).json({ error: "Order not found or not yours" }); return; }

  /* ── Rider Cancel: clear riderId + reset to preparing so another rider can pick it up ── */
  if (status === "cancelled") {
    const penalty = await handleCancelPenalty(riderId);

    const [cancelled] = await db.update(ordersTable)
      .set({ riderId: null, status: "preparing", updatedAt: new Date() })
      .where(and(eq(ordersTable.id, req.params["id"]!), eq(ordersTable.riderId, riderId)))
      .returning();
    await db.insert(notificationsTable).values({
      id: generateId(), userId: order.userId,
      title: "Rider Change 🔄", body: "Your rider had to cancel. We're finding a new rider for you.",
      type: "order", icon: "refresh-outline",
    }).catch((err: Error) => { console.error("[rider] background op failed:", err.message); });
    res.json({
      ...cancelled, total: safeNum(cancelled?.total || 0), status: "cancelled_by_rider",
      cancelPenalty: penalty,
    }); return;
  }

  /* Include riderId in WHERE to close the TOCTOU window — only the assigned rider can advance status */
  const updateData: Record<string, any> = { status, updatedAt: new Date() };
  if (status === "delivered" && proofPhoto) {
    updateData.proofPhotoUrl = proofPhoto;
  }
  const [updated] = await db.update(ordersTable).set(updateData).where(and(eq(ordersTable.id, req.params["id"]!), eq(ordersTable.riderId, riderId))).returning();

  if (status === "delivered") {
    const s = await getPlatformSettings();
    const riderKeepPct = parseFloat(s["rider_keep_pct"] ?? "80") / 100;
    const platformFeePct = 1 - riderKeepPct;
    const bonusPerTrip = parseFloat(s["rider_bonus_per_trip"] ?? "0");
    const orderTotal = safeNum(order.total);
    const isCash = order.paymentMethod === "cash" || order.paymentMethod === "cod";

    if (isCash) {
      /* ── CASH ORDER: record cash collection + deduct platform fee from wallet (atomic) ── */
      const platformFee = parseFloat((orderTotal * platformFeePct).toFixed(2));
      const riderShare  = parseFloat((orderTotal - platformFee).toFixed(2));
      await db.transaction(async (tx) => {
        /* 1. Cash-collection ledger: rider physically collected full amount in cash */
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId: riderId, type: "cash_collection",
          amount: orderTotal.toFixed(2),
          description: `Cash collected — Order #${order.id.slice(-6).toUpperCase()} (Rs. ${orderTotal.toFixed(0)} total)`,
          reference: `order:${order.id}`,
          paymentMethod: "cash",
        });
        /* 2. Platform fee deduction from wallet (commission) */
        await tx.update(usersTable)
          .set({ walletBalance: sql`wallet_balance - ${platformFee}`, updatedAt: new Date() })
          .where(eq(usersTable.id, riderId));
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId: riderId, type: "platform_fee",
          amount: platformFee.toFixed(2),
          description: `Platform fee (${Math.round(platformFeePct * 100)}%) — Cash Order #${order.id.slice(-6).toUpperCase()} · Rider keeps Rs. ${riderShare}`,
          reference: `order:${order.id}`,
        });
        /* Bonus still applies for cash orders */
        if (bonusPerTrip > 0) {
          await tx.update(usersTable).set({ walletBalance: sql`wallet_balance + ${bonusPerTrip}`, updatedAt: new Date() }).where(eq(usersTable.id, riderId));
          await tx.insert(walletTransactionsTable).values({
            id: generateId(), userId: riderId, type: "bonus",
            amount: bonusPerTrip.toFixed(2),
            description: `Per-trip bonus — Order #${order.id.slice(-6).toUpperCase()}`,
          });
        }
      });
      await db.insert(notificationsTable).values({
        id: generateId(), userId: riderId,
        title: "Cash Delivery Completed", body: `Rs. ${platformFee} platform fee deducted from wallet. Cash collected: Rs. ${orderTotal.toFixed(0)}.`,
        type: "wallet", icon: "wallet-outline",
      }).catch((e: Error) => console.error("[rider] notif insert failed:", e.message));
    } else {
      /* ── WALLET/ONLINE ORDER: credit rider's share (atomic) ── */
      const earnings = parseFloat((orderTotal * riderKeepPct).toFixed(2));
      const totalCredit = parseFloat((earnings + bonusPerTrip).toFixed(2));
      await db.transaction(async (tx) => {
        await tx.update(usersTable).set({ walletBalance: sql`wallet_balance + ${totalCredit}`, updatedAt: new Date() }).where(eq(usersTable.id, riderId));
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId: riderId, type: "credit",
          amount: earnings.toFixed(2),
          description: `Delivery earnings — Order #${order.id.slice(-6).toUpperCase()} (${Math.round(riderKeepPct * 100)}%)`,
        });
        if (bonusPerTrip > 0) {
          await tx.insert(walletTransactionsTable).values({
            id: generateId(), userId: riderId, type: "bonus",
            amount: bonusPerTrip.toFixed(2),
            description: `Per-trip bonus — Order #${order.id.slice(-6).toUpperCase()}`,
          });
        }
      });
      await db.insert(notificationsTable).values({
        id: generateId(), userId: riderId,
        title: "Delivery Earning Credited", body: `Rs. ${earnings} wallet mein add ho gaya!`,
        type: "wallet", icon: "wallet-outline",
      }).catch((e: Error) => console.error("[rider] notif insert failed:", e.message));
    }

    await db.insert(notificationsTable).values({
      id: generateId(), userId: order.userId,
      title: "Order Delivered! 🎉", body: "Your order has been delivered. Enjoy!",
      type: "order", icon: "bag-check-outline",
    }).catch(e => console.error("customer notif insert failed:", e));

    /* ── Customer loyalty points (customer_loyalty_enabled + customer_loyalty_pts) ── */
    const loyaltyEnabled = (s["customer_loyalty_enabled"] ?? "on") === "on";
    if (loyaltyEnabled && order.userId) {
      const loyaltyPtsPerHundred = parseFloat(s["customer_loyalty_pts"] ?? "5");
      const orderTotal = safeNum(order.total);
      const loyaltyPts = Math.floor((orderTotal / 100) * loyaltyPtsPerHundred);
      if (loyaltyPts > 0) {
        /* Store loyalty points as wallet bonus (1 pt = Re 1 equivalent) */
        await db.update(usersTable)
          .set({ walletBalance: sql`wallet_balance + ${loyaltyPts}`, updatedAt: new Date() })
          .where(eq(usersTable.id, order.userId))
          .catch((err: Error) => { console.error("[rider] background op failed:", err.message); });
        await db.insert(walletTransactionsTable).values({
          id: generateId(), userId: order.userId, type: "loyalty",
          amount: loyaltyPts.toFixed(2),
          description: `Loyalty points (${loyaltyPtsPerHundred} pts/Rs.100) — Order #${order.id.slice(-6).toUpperCase()}`,
        }).catch((err: Error) => { console.error("[rider] background op failed:", err.message); });
        await db.insert(notificationsTable).values({
          id: generateId(), userId: order.userId,
          title: "Loyalty Points Earned! ⭐", body: `+${loyaltyPts} loyalty points added for your order!`,
          type: "wallet", icon: "star-outline",
        }).catch((err: Error) => { console.error("[rider] background op failed:", err.message); });
      }
    }

    /* ── Finance cashback credit to customer ── */
    const cashbackEnabled = (s["finance_cashback_enabled"] ?? "off") === "on";
    if (cashbackEnabled && order.userId) {
      const cashbackPct    = parseFloat(s["finance_cashback_pct"]    ?? "2") / 100;
      const cashbackMaxRs  = parseFloat(s["finance_cashback_max_rs"] ?? "100");
      const orderTotal     = safeNum(order.total);
      const rawCashback    = parseFloat((orderTotal * cashbackPct).toFixed(2));
      const cashbackAmt    = Math.min(rawCashback, cashbackMaxRs);
      if (cashbackAmt > 0) {
        await db.update(usersTable)
          .set({ walletBalance: sql`wallet_balance + ${cashbackAmt}`, updatedAt: new Date() })
          .where(eq(usersTable.id, order.userId))
          .catch((err: Error) => { console.error("[rider] background op failed:", err.message); });
        await db.insert(walletTransactionsTable).values({
          id: generateId(), userId: order.userId, type: "cashback",
          amount: cashbackAmt.toFixed(2),
          description: `Cashback ${Math.round(cashbackPct * 100)}% — Order #${order.id.slice(-6).toUpperCase()}`,
        }).catch((err: Error) => { console.error("[rider] background op failed:", err.message); });
        await db.insert(notificationsTable).values({
          id: generateId(), userId: order.userId,
          title: "Cashback Credited! 🎁", body: `Rs. ${cashbackAmt} cashback added to your wallet!`,
          type: "wallet", icon: "wallet-outline",
        }).catch((err: Error) => { console.error("[rider] background op failed:", err.message); });
      }
    }
  }

  res.json({ ...updated, total: safeNum(updated.total) });
});

/* ── POST /rider/rides/:id/accept — Accept a ride ──
   Uses WHERE riderId IS NULL to prevent two riders accepting same ride (race condition) */
router.post("/rides/:id/accept", async (req, res) => {
  const paramParsed = idParamSchema.safeParse(req.params);
  if (!paramParsed.success) { res.status(400).json({ error: "Invalid ride ID" }); return; }
  const riderId   = req.riderId!;
  const riderUser = req.riderUser!;
  const rideId    = paramParsed.data.id;

  if (riderUser.isRestricted) {
    res.status(403).json({ error: "Your account is restricted. You cannot accept new rides. Contact support for assistance." }); return;
  }

  // Check max simultaneous deliveries limit
  const s = await getPlatformSettings();
  const maxDeliveries = parseInt(s["rider_max_deliveries"] ?? "3");
  const [activeOrders, activeRides] = await Promise.all([
    db.select({ c: count() }).from(ordersTable).where(and(eq(ordersTable.riderId, riderId), or(eq(ordersTable.status, "out_for_delivery"), eq(ordersTable.status, "picked_up")))),
    db.select({ c: count() }).from(ridesTable).where(and(eq(ridesTable.riderId, riderId), or(eq(ridesTable.status, "accepted"), eq(ridesTable.status, "arrived"), eq(ridesTable.status, "in_transit")))),
  ]);
  const activeCount = (activeOrders[0]?.c ?? 0) + (activeRides[0]?.c ?? 0);
  if (activeCount >= maxDeliveries) {
    res.status(429).json({ error: `Maximum ${maxDeliveries} active deliveries allowed. Complete a current delivery first.` }); return;
  }

  /* Check if this is a bargaining ride — load it first */
  const [targetRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
  if (!targetRide) { res.status(404).json({ error: "Ride not found" }); return; }

  /* ── Minimum wallet balance gate for cash rides ── */
  if (targetRide.paymentMethod === "cash") {
    const minBalance = parseFloat(s["rider_min_balance"] ?? "0");
    if (minBalance > 0) {
      const [riderRow] = await db.select({ walletBalance: usersTable.walletBalance })
        .from(usersTable).where(eq(usersTable.id, riderId)).limit(1);
      const currentBal = safeNum(riderRow?.walletBalance);
      if (currentBal < minBalance) {
        res.status(403).json({
          error: `Minimum wallet balance required for cash rides is Rs. ${minBalance}. Your balance: Rs. ${currentBal.toFixed(0)}. Please top up your wallet first.`,
          code: "BELOW_MIN_BALANCE",
          required: minBalance,
          current: currentBal,
        }); return;
      }
    }
  }

  /* For bargaining rides, rider accepts the customer's offered fare */
  const isBargaining = targetRide.status === "bargaining";
  const agreedFare   = isBargaining
    ? (targetRide.offeredFare ?? targetRide.fare)
    : targetRide.fare;

  /* Pre-flight balance check for bargaining + wallet — fail fast before touching the DB.
     The actual deduction happens AFTER the atomic accept to prevent double-charging:
     if two riders race, only the winner should pay; loser's wallet stays untouched. */
  if (isBargaining && targetRide.paymentMethod === "wallet") {
    const fareAmt = safeNum(agreedFare);
    const [customer] = await db.select({ walletBalance: usersTable.walletBalance })
      .from(usersTable).where(eq(usersTable.id, targetRide.userId)).limit(1);
    if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
    if (safeNum(customer.walletBalance) < fareAmt) {
      res.status(400).json({ error: "Customer has insufficient wallet balance" }); return;
    }
  }

  /* Atomic accept: only succeeds if riderId is still NULL in the DB.
     Wallet deduction happens inside the same transaction so it's all-or-nothing:
     the losing rider gets a 409 with their money completely untouched. */
  const acceptedAt = new Date();
  const fareAmt    = safeNum(agreedFare);

  let updated: typeof ridesTable.$inferSelect | undefined;
  try {
    updated = await db.transaction(async (tx) => {
      const [accepted] = await tx
        .update(ridesTable)
        .set({
          riderId,
          riderName: riderUser.name || "Rider",
          riderPhone: riderUser.phone,
          status: "accepted",
          fare: isBargaining ? fareAmt.toFixed(2) : targetRide.fare,
          bargainStatus: isBargaining ? "agreed" : targetRide.bargainStatus,
          acceptedAt,
          updatedAt: acceptedAt,
        })
        .where(and(eq(ridesTable.id, rideId), isNull(ridesTable.riderId)))
        .returning();

      if (!accepted) return undefined; // another rider won the race

      /* Deduct wallet only if this rider won the accept race */
      if (isBargaining && targetRide.paymentMethod === "wallet") {
        /* DB floor guard — prevents negative balance under concurrent ride accepts */
        const [walletDeducted] = await tx.update(usersTable)
          .set({ walletBalance: sql`wallet_balance - ${fareAmt}`, updatedAt: new Date() })
          .where(and(eq(usersTable.id, targetRide.userId), gte(usersTable.walletBalance, fareAmt.toFixed(2))))
          .returning({ id: usersTable.id });
        if (!walletDeducted) throw new Error("Insufficient wallet balance for ride payment.");
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId: targetRide.userId, type: "debit",
          amount: fareAmt.toFixed(2),
          description: `Ride payment (bargained) — #${targetRide.id.slice(-6).toUpperCase()}`,
        });
      }
      return accepted;
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("Insufficient wallet balance")) {
      res.status(402).json({ error: msg, code: "INSUFFICIENT_WALLET" }); return;
    }
    console.error("[rider] ride accept transaction failed:", msg);
    res.status(500).json({ error: "Failed to accept ride. Please try again." }); return;
  }

  if (!updated) {
    res.status(409).json({ error: "Ride already taken by another rider" }); return;
  }

  /* Reject any pending bids on this ride (InDrive multi-bid cleanup) */
  await db.update(rideBidsTable)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(eq(rideBidsTable.rideId, rideId), eq(rideBidsTable.status, "pending")));

  await db.insert(notificationsTable).values({
    id: generateId(), userId: updated.userId,
    title: "Rider Assigned! 🚗",
    body: isBargaining
      ? `${riderUser.name || "Your rider"} ne Rs. ${safeNum(agreedFare).toFixed(0)} par offer accept kar liya!`
      : `${riderUser.name || "Your rider"} is coming to pick you up.`,
    type: "ride", icon: updated.type === "bike" ? "bicycle-outline" : "car-outline",
  }).catch((err: Error) => { console.error("[rider] background op failed:", err.message); });

  res.json({ ...updated, fare: safeNum(updated.fare), distance: safeNum(updated.distance) });
});

/* ── PATCH /rider/rides/:id/status — Update ride status (completed/cancelled) ── */
router.patch("/rides/:id/status", async (req, res) => {
  const parsed = rideStatusSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid status" }); return; }
  const riderId = req.riderId!;
  const { status, lat, lng } = parsed.data;

  const [ride] = await db.select().from(ridesTable).where(and(eq(ridesTable.id, req.params["id"]!), eq(ridesTable.riderId, riderId))).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found or not yours" }); return; }

  /* ── State Machine: enforce valid transitions ── */
  const allowed = RIDE_STATUS_TRANSITIONS[ride.status];
  if (!allowed || !allowed.includes(status)) {
    res.status(400).json({ error: `Cannot transition from "${ride.status}" to "${status}". Allowed: ${(allowed || []).join(", ") || "none"}` }); return;
  }

  /* ── Proximity check: "arrived" requires rider to be near pickup ── */
  if (status === "arrived" && ride.pickupLat && ride.pickupLng) {
    const s = await getPlatformSettings();
    const proximityM = parseFloat(s["dispatch_ride_start_proximity_m"] ?? "500");

    /* Prefer server-stored live location (trusted) over client-supplied coords */
    let riderLat: number | undefined;
    let riderLng: number | undefined;
    const [storedLoc] = await db.select().from(liveLocationsTable).where(eq(liveLocationsTable.userId, riderId)).limit(1);
    if (storedLoc) {
      riderLat = parseFloat(storedLoc.latitude);
      riderLng = parseFloat(storedLoc.longitude);
    } else if (lat != null && lng != null) {
      riderLat = lat;
      riderLng = lng;
    }

    if (riderLat == null || riderLng == null) {
      res.status(400).json({ error: "Unable to verify your location. Please enable GPS and try again." }); return;
    }

    const distKm = calcDistance(riderLat, riderLng, parseFloat(ride.pickupLat), parseFloat(ride.pickupLng));
    if (distKm * 1000 > proximityM) {
      res.status(400).json({ error: `You must be within ${proximityM}m of the pickup location to mark arrived. Current distance: ${(distKm * 1000).toFixed(0)}m` }); return;
    }
  }

  /* Include riderId in WHERE to close TOCTOU between ownership check and update */
  const [updated] = await db.update(ridesTable).set({ status, updatedAt: new Date() }).where(and(eq(ridesTable.id, req.params["id"]!), eq(ridesTable.riderId, riderId))).returning();

  if (status === "completed") {
    const s = await getPlatformSettings();
    const riderKeepPct = parseFloat(s["rider_keep_pct"] ?? "80") / 100;
    const platformFeePct = 1 - riderKeepPct;
    const bonusPerTrip = parseFloat(s["rider_bonus_per_trip"] ?? "0");
    const fareAmt = safeNum(ride.fare);
    const isCashRide = ride.paymentMethod === "cash";

    if (isCashRide) {
      /* ── CASH RIDE: record cash collection + deduct platform fee from wallet (atomic) ── */
      const platformFee = parseFloat((fareAmt * platformFeePct).toFixed(2));
      const riderShare  = parseFloat((fareAmt - platformFee).toFixed(2));
      await db.transaction(async (tx) => {
        /* 1. Cash-collection ledger: rider physically collected full fare in cash */
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId: riderId, type: "cash_collection",
          amount: fareAmt.toFixed(2),
          description: `Cash collected — Ride #${ride.id.slice(-6).toUpperCase()} (Rs. ${fareAmt.toFixed(0)} total)`,
          reference: `ride:${ride.id}`,
          paymentMethod: "cash",
        });
        /* 2. Platform fee deduction: commission paid from wallet */
        await tx.update(usersTable)
          .set({ walletBalance: sql`wallet_balance - ${platformFee}`, updatedAt: new Date() })
          .where(eq(usersTable.id, riderId));
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId: riderId, type: "platform_fee",
          amount: platformFee.toFixed(2),
          description: `Platform fee (${Math.round(platformFeePct * 100)}%) — Cash Ride #${ride.id.slice(-6).toUpperCase()} · Rider keeps Rs. ${riderShare}`,
          reference: `ride:${ride.id}`,
        });
        if (bonusPerTrip > 0) {
          await tx.update(usersTable).set({ walletBalance: sql`wallet_balance + ${bonusPerTrip}`, updatedAt: new Date() }).where(eq(usersTable.id, riderId));
          await tx.insert(walletTransactionsTable).values({
            id: generateId(), userId: riderId, type: "bonus",
            amount: bonusPerTrip.toFixed(2),
            description: `Per-trip bonus — Ride #${ride.id.slice(-6).toUpperCase()}`,
          });
        }
      });
      await db.insert(notificationsTable).values({
        id: generateId(), userId: riderId,
        title: "Cash Ride Completed", body: `Rs. ${platformFee} platform fee deducted from wallet. Cash collected: Rs. ${fareAmt.toFixed(0)}.`,
        type: "wallet", icon: "wallet-outline",
      }).catch((e: Error) => console.error("[rider] notif insert failed:", e.message));
    } else {
      /* ── WALLET RIDE: credit rider's share (atomic) ── */
      const earnings = parseFloat((fareAmt * riderKeepPct).toFixed(2));
      const totalCredit = parseFloat((earnings + bonusPerTrip).toFixed(2));
      await db.transaction(async (tx) => {
        await tx.update(usersTable).set({ walletBalance: sql`wallet_balance + ${totalCredit}`, updatedAt: new Date() }).where(eq(usersTable.id, riderId));
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId: riderId, type: "credit",
          amount: earnings.toFixed(2),
          description: `Ride earnings — #${ride.id.slice(-6).toUpperCase()} (${Math.round(riderKeepPct * 100)}%)`,
        });
        if (bonusPerTrip > 0) {
          await tx.insert(walletTransactionsTable).values({
            id: generateId(), userId: riderId, type: "bonus",
            amount: bonusPerTrip.toFixed(2),
            description: `Per-trip bonus — Ride #${ride.id.slice(-6).toUpperCase()}`,
          });
        }
      });
      await db.insert(notificationsTable).values({
        id: generateId(), userId: riderId,
        title: "Ride Earning Credited", body: `Rs. ${earnings} wallet mein add ho gaya!`,
        type: "wallet", icon: "wallet-outline",
      }).catch(e => console.error("notif insert failed:", e));
    }

    await db.insert(notificationsTable).values({
      id: generateId(), userId: ride.userId,
      title: "Ride Completed! ✅", body: "Thanks for riding with AJKMart. Rate your experience!",
      type: "ride", icon: "checkmark-circle-outline",
    }).catch(e => console.error("customer notif insert failed:", e));
  }

  res.json({ ...updated, fare: safeNum(updated.fare), distance: safeNum(updated.distance) });
});

/* ── POST /rider/rides/:id/counter — Rider submits a bid on a bargaining ride (InDrive multi-bid) ── */
router.post("/rides/:id/counter", async (req, res) => {
  const parsed = counterSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || "counterFare required" }); return; }
  const riderId   = req.riderId!;
  const riderUser = req.riderUser!;
  const rideId    = req.params["id"]!;
  const { counterFare, note } = parsed.data;

  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }
  if (ride.status !== "bargaining") {
    res.status(400).json({ error: "This ride is not in bargaining state" }); return;
  }

  const parsedCounter = safeNum(counterFare);
  const platformFare  = safeNum(ride.fare);
  const offeredAmt    = safeNum(ride.offeredFare ?? 0);

  if (parsedCounter > platformFare) {
    res.status(400).json({ error: `Counter offer cannot exceed platform fare (Rs. ${platformFare.toFixed(0)})` }); return;
  }
  if (parsedCounter <= offeredAmt) {
    res.status(400).json({ error: `Counter offer must be higher than customer's offer (Rs. ${offeredAmt.toFixed(0)})` }); return;
  }

  const MAX_BIDS_PER_RIDER_PER_RIDE = 3;

  let bid: InferSelectModel<typeof rideBidsTable> | undefined;
  let isFirstBid = false;
  try {
    const result = await db.transaction(async (tx) => {
      const [lockedRide] = await tx.select({ id: ridesTable.id, status: ridesTable.status })
        .from(ridesTable)
        .where(eq(ridesTable.id, rideId))
        .for("update");

      if (!lockedRide || !["searching", "bargaining"].includes(lockedRide.status)) {
        throw Object.assign(new Error("Ride is no longer accepting bids"), { statusCode: 409 });
      }

      const [bidCountRow] = await tx.select({ c: count() })
        .from(rideBidsTable)
        .where(and(eq(rideBidsTable.rideId, rideId), eq(rideBidsTable.riderId, riderId)));
      const totalBids = bidCountRow?.c ?? 0;

      const [existingBid] = await tx.select({ id: rideBidsTable.id })
        .from(rideBidsTable)
        .where(and(eq(rideBidsTable.rideId, rideId), eq(rideBidsTable.riderId, riderId), eq(rideBidsTable.status, "pending")))
        .limit(1);

      if (!existingBid && totalBids >= MAX_BIDS_PER_RIDER_PER_RIDE) {
        throw Object.assign(new Error(`Maximum ${MAX_BIDS_PER_RIDER_PER_RIDE} bids per ride allowed. You have already submitted ${totalBids} bids on this ride.`), { statusCode: 429 });
      }

      if (existingBid) {
        const [updated] = await tx.update(rideBidsTable)
          .set({ fare: parsedCounter.toFixed(2), note: note ?? null, updatedAt: new Date() })
          .where(and(eq(rideBidsTable.id, existingBid.id), eq(rideBidsTable.riderId, riderId)))
          .returning();
        isFirstBid = false;
        return updated;
      } else {
        const [inserted] = await tx.insert(rideBidsTable).values({
          id:         generateId(),
          rideId,
          riderId,
          riderName:  riderUser.name || "Rider",
          riderPhone: riderUser.phone ?? null,
          fare:       parsedCounter.toFixed(2),
          note:       note ?? null,
          status:     "pending",
        }).returning();
        isFirstBid = true;
        return inserted;
      }
    });
    bid = result;
  } catch (e: unknown) {
    const err = e as { statusCode?: number; message?: string };
    const status = err.statusCode ?? 400;
    res.status(status).json({ error: err.message ?? "Bid failed" });
    return;
  }

  if (isFirstBid) {
    await db.insert(notificationsTable).values({
      id: generateId(), userId: ride.userId,
      title: "Naya Bid Aaya! 💬",
      body: `${riderUser.name || "Ek rider"} ne Rs. ${parsedCounter.toFixed(0)} ka bid diya. Dekhein aur choose karein!`,
      type: "ride", icon: "chatbubble-outline", link: "/ride",
    }).catch((err: Error) => { console.error("[rider] background op failed:", err.message); });
  }

  res.json({ success: true, bid: { ...bid, fare: safeNum(bid!.fare) } });
});

/* ── POST /rider/rides/:id/reject-offer — Rider dismisses a bargaining ride (local dismiss, no DB lock) ── */
router.post("/rides/:id/reject-offer", async (req, res) => {
  /* InDrive model: riders don't lock the ride anymore, so "rejection" is purely a local dismiss.
     If this rider had submitted a pending bid, we cancel it. */
  const riderId = req.riderId!;
  const rideId  = req.params["id"]!;

  /* Cancel any pending bid this rider submitted */
  await db.update(rideBidsTable)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(eq(rideBidsTable.rideId, rideId), eq(rideBidsTable.riderId, riderId), eq(rideBidsTable.status, "pending")));

  res.json({ success: true, message: "Ride dismissed" });
});

/* ── GET /rider/history — Delivery history ── */
router.get("/history", async (req, res) => {
  const riderId = req.riderId!;
  const s = await getPlatformSettings();
  const riderKeepPct = parseFloat(s["rider_keep_pct"] ?? "80") / 100;

  const [orders, rides] = await Promise.all([
    db.select().from(ordersTable).where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"))).orderBy(desc(ordersTable.updatedAt)).limit(10),
    db.select().from(ridesTable).where(and(eq(ridesTable.riderId, riderId), or(eq(ridesTable.status, "completed"), eq(ridesTable.status, "cancelled")))).orderBy(desc(ridesTable.updatedAt)).limit(10),
  ]);

  const combined = [
    ...orders.map(o => ({ kind: "order" as const, id: o.id, status: o.status, amount: safeNum(o.total), earnings: parseFloat((safeNum(o.total) * riderKeepPct).toFixed(2)), address: o.deliveryAddress, type: o.type, createdAt: o.createdAt })),
    ...rides.map(r => ({ kind: "ride" as const, id: r.id, status: r.status, amount: safeNum(r.fare), earnings: parseFloat((safeNum(r.fare) * riderKeepPct).toFixed(2)), address: r.dropAddress, type: r.type, createdAt: r.createdAt })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({ history: combined });
});

/* ── GET /rider/reviews — Reviews received by this rider ── */
router.get("/reviews", async (req, res) => {
  const riderId = req.riderId!;

  const [statsRow] = await db
    .select({ total: count(), avgRating: avg(reviewsTable.rating) })
    .from(reviewsTable)
    .where(eq(reviewsTable.riderId, riderId));

  const total = statsRow?.total ?? 0;
  const avgRating = statsRow?.avgRating ? parseFloat(parseFloat(statsRow.avgRating).toFixed(1)) : null;

  const rows = await db
    .select({
      id: reviewsTable.id,
      orderId: reviewsTable.orderId,
      rating: reviewsTable.rating,
      comment: reviewsTable.comment,
      orderType: reviewsTable.orderType,
      createdAt: reviewsTable.createdAt,
      customerName: usersTable.name,
    })
    .from(reviewsTable)
    .leftJoin(usersTable, eq(reviewsTable.userId, usersTable.id))
    .where(eq(reviewsTable.riderId, riderId))
    .orderBy(desc(reviewsTable.createdAt))
    .limit(20);

  res.json({ reviews: rows, avgRating, total });
});

/* ── GET /rider/earnings — Earnings summary ── */
router.get("/earnings", async (req, res) => {
  const riderId = req.riderId!;
  const today = new Date(); today.setHours(0,0,0,0);
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(today); monthAgo.setDate(monthAgo.getDate() - 30);

  const s = await getPlatformSettings();
  const riderKeepPct = parseFloat(s["rider_keep_pct"] ?? "80") / 100;

  const [todayOrders, weekOrders, monthOrders, todayRides, weekRides, monthRides] = await Promise.all([
    db.select({ s: sum(ordersTable.total), c: count() }).from(ordersTable).where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"), gte(ordersTable.updatedAt, today))),
    db.select({ s: sum(ordersTable.total), c: count() }).from(ordersTable).where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"), gte(ordersTable.updatedAt, weekAgo))),
    db.select({ s: sum(ordersTable.total), c: count() }).from(ordersTable).where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"), gte(ordersTable.updatedAt, monthAgo))),
    db.select({ s: sum(ridesTable.fare),   c: count() }).from(ridesTable).where(and(eq(ridesTable.riderId, riderId), eq(ridesTable.status, "completed"), gte(ridesTable.updatedAt, today))),
    db.select({ s: sum(ridesTable.fare),   c: count() }).from(ridesTable).where(and(eq(ridesTable.riderId, riderId), eq(ridesTable.status, "completed"), gte(ridesTable.updatedAt, weekAgo))),
    db.select({ s: sum(ridesTable.fare),   c: count() }).from(ridesTable).where(and(eq(ridesTable.riderId, riderId), eq(ridesTable.status, "completed"), gte(ridesTable.updatedAt, monthAgo))),
  ]);

  const todayTotal = (safeNum(todayOrders[0]?.s) + safeNum(todayRides[0]?.s)) * riderKeepPct;
  const weekTotal  = (safeNum(weekOrders[0]?.s)  + safeNum(weekRides[0]?.s))  * riderKeepPct;
  const monthTotal = (safeNum(monthOrders[0]?.s) + safeNum(monthRides[0]?.s)) * riderKeepPct;

  res.json({
    today:  { earnings: parseFloat(todayTotal.toFixed(2)), deliveries: (todayOrders[0]?.c ?? 0) + (todayRides[0]?.c ?? 0) },
    week:   { earnings: parseFloat(weekTotal.toFixed(2)),  deliveries: (weekOrders[0]?.c  ?? 0) + (weekRides[0]?.c  ?? 0) },
    month:  { earnings: parseFloat(monthTotal.toFixed(2)), deliveries: (monthOrders[0]?.c ?? 0) + (monthRides[0]?.c ?? 0) },
  });
});

/* ── GET /rider/wallet/transactions ── */
router.get("/wallet/transactions", async (req, res) => {
  const riderId = req.riderId!;
  const user = req.riderUser!;
  const limit = Math.min(parseInt(String(req.query["limit"] || "50")), 100);
  const txns = await db.select().from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.userId, riderId))
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(limit);
  res.json({
    balance: safeNum(user.walletBalance),
    transactions: txns.map(t => ({ ...t, amount: safeNum(t.amount) })),
  });
});

/* ── POST /rider/wallet/withdraw — Atomic withdrawal (prevents race condition) ── */
router.post("/wallet/withdraw", async (req, res) => {
  const parsed = withdrawSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" }); return; }
  const riderId = req.riderId!;
  const { amount, accountTitle, accountNumber, bankName, paymentMethod, note } = parsed.data;
  const amt = amount;

  const s = await getPlatformSettings();
  const withdrawalEnabled = (s["rider_withdrawal_enabled"] ?? "on") === "on";
  const minPayout = parseFloat(s["rider_min_payout"] ?? "500");
  const maxPayout = parseFloat(s["rider_max_payout"] ?? "50000");

  if (!withdrawalEnabled) { res.status(403).json({ error: "Withdrawals are currently paused by admin. Please try again later." }); return; }
  if (!amt || amt <= 0)  { res.status(400).json({ error: "Valid amount required" }); return; }
  if (amt < minPayout)   { res.status(400).json({ error: `Minimum withdrawal is Rs. ${minPayout}` }); return; }
  if (amt > maxPayout)   { res.status(400).json({ error: `Maximum single withdrawal is Rs. ${maxPayout}` }); return; }
  if (!accountTitle || !accountNumber || !bankName) {
    res.status(400).json({ error: "Account title, number and bank name are required" }); return;
  }

  try {
    const txId = generateId();
    const result = await db.transaction(async (tx) => {
      const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, riderId)).limit(1);
      if (!user) throw new Error("User not found");

      const balance = safeNum(user.walletBalance);
      if (amt > balance) throw new Error(`Insufficient balance. Available: Rs. ${balance}`);

      /* DB floor guard — prevents negative balance if two withdrawals clear pre-flight simultaneously */
      const [deducted] = await tx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance - ${amt}`, updatedAt: new Date() })
        .where(and(eq(usersTable.id, riderId), gte(usersTable.walletBalance, amt.toFixed(2))))
        .returning({ id: usersTable.id });
      if (!deducted) throw new Error(`Insufficient balance. Please try again.`);
      await tx.insert(walletTransactionsTable).values({
        id: txId, userId: riderId, type: "debit",
        amount: amt.toFixed(2),
        description: `Withdrawal — ${bankName} · ${accountNumber} · ${accountTitle}${note ? ` · ${note}` : ""}`,
        reference: "pending",
        paymentMethod: paymentMethod || bankName,
      });
      return balance - amt;
    });

    await db.insert(notificationsTable).values({
      id: generateId(), userId: riderId,
      title: "Withdrawal Requested ✅",
      body: `Rs. ${amt} withdrawal submitted. Admin will process within 24-48 hours.`,
      type: "wallet", icon: "cash-outline",
    }).catch((err: Error) => { console.error("[rider] background op failed:", err.message); });

    res.json({ success: true, newBalance: parseFloat(result.toFixed(2)), amount: amt, txId });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* ── GET /rider/cod-summary — COD balance + remittance history ── */
router.get("/cod-summary", async (req, res) => {
  const riderId = req.riderId!;
  const [codAgg, verifiedAgg, remittances] = await Promise.all([
    db.select({ total: sum(ordersTable.total), count: count() }).from(ordersTable)
      .where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"), eq(ordersTable.paymentMethod, "cod"))),
    db.select({ total: sum(walletTransactionsTable.amount) }).from(walletTransactionsTable)
      .where(and(eq(walletTransactionsTable.userId, riderId), eq(walletTransactionsTable.type, "cod_remittance"), sql`reference LIKE 'verified:%'`)),
    db.select().from(walletTransactionsTable)
      .where(and(eq(walletTransactionsTable.userId, riderId), eq(walletTransactionsTable.type, "cod_remittance")))
      .orderBy(desc(walletTransactionsTable.createdAt)).limit(30),
  ]);
  const totalCollected = safeNum(codAgg[0]?.total);
  const totalVerified  = safeNum(verifiedAgg[0]?.total);
  res.json({
    totalCollected,
    totalVerified,
    netOwed:       Math.max(0, totalCollected - totalVerified),
    codOrderCount: Number(codAgg[0]?.count ?? 0),
    remittances:   remittances.map(r => ({ ...r, amount: safeNum(r.amount) })),
  });
});

/* ── POST /rider/cod/remit — Submit a COD remittance ── */
router.post("/cod/remit", async (req, res) => {
  const parsed = codRemitSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" }); return; }
  const riderId = req.riderId!;
  const { amount, paymentMethod, accountNumber, transactionId, note } = parsed.data;
  const amt = amount;

  /* Build explicit allowlist of currently-enabled payment methods */
  const s = await getPlatformSettings();
  const PAYMENT_METHOD_SETTING: Record<string, string> = {
    jazzcash: "jazzcash_enabled", easypaisa: "easypaisa_enabled", bank: "bank_enabled",
  };
  const enabledMethods = Object.entries(PAYMENT_METHOD_SETTING)
    .filter(([, settingKey]) => (s[settingKey] ?? "off") === "on")
    .map(([key]) => key);
  const methodKey = paymentMethod.toLowerCase().replace(/\s+/g, "");
  if (enabledMethods.length > 0 && !enabledMethods.includes(methodKey)) {
    res.status(400).json({ error: `Payment method '${paymentMethod}' is not enabled. Available: ${enabledMethods.join(", ")}.` }); return;
  }
  const txId = generateId();
  await db.insert(walletTransactionsTable).values({
    id: txId, userId: riderId, type: "cod_remittance",
    amount: amt.toFixed(2),
    description: `COD Remittance — ${paymentMethod} · ${accountNumber}${transactionId ? ` · TxID: ${transactionId}` : ""}${note ? ` · ${note}` : ""}`,
    reference: "pending",
    paymentMethod,
  });
  await db.insert(notificationsTable).values({
    id: generateId(), userId: riderId,
    title: "COD Remittance Submitted ✅",
    body: `Rs. ${amt} COD remittance submitted. Admin 24 hours mein verify karega.`,
    type: "wallet", icon: "cash-outline",
  }).catch((err: Error) => { console.error("[rider] background op failed:", err.message); });
  res.json({ success: true, txId, amount: amt });
});

/* ── GET /rider/notifications ── */
router.get("/notifications", async (req, res) => {
  const riderId = req.riderId!;
  const notifs = await db.select().from(notificationsTable)
    .where(eq(notificationsTable.userId, riderId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(30);
  res.json({ notifications: notifs, unread: notifs.filter((n: any) => !n.isRead).length });
});

/* ── PATCH /rider/notifications/read-all ── */
router.patch("/notifications/read-all", async (req, res) => {
  const riderId = req.riderId!;
  await db.update(notificationsTable).set({ isRead: true }).where(eq(notificationsTable.userId, riderId));
  res.json({ success: true });
});

/* ── PATCH /rider/notifications/:id/read ── */
router.patch("/notifications/:id/read", async (req, res) => {
  try {
    const riderId = req.riderId!;
    const { id } = req.params;
    if (!id || typeof id !== "string") {
      return res.status(400).json({ error: "Invalid notification id" });
    }
    const result = await db.update(notificationsTable).set({ isRead: true }).where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, riderId)));
    const rowCount = (result as any)?.rowCount ?? (result as any)?.changes ?? 1;
    if (rowCount === 0) {
      return res.status(404).json({ error: "Notification not found" });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("Failed to mark notification read:", err);
    return res.status(500).json({ error: "Failed to mark notification as read" });
  }
});

/* ── GET /rider/wallet/min-balance — Returns min balance config ── */
router.get("/wallet/min-balance", async (req, res) => {
  const riderId = req.riderId!;
  const s = await getPlatformSettings();
  const minBalance = parseFloat(s["rider_min_balance"] ?? "0");
  const depositEnabled = (s["rider_deposit_enabled"] ?? "on") === "on";
  const [user] = await db.select({ walletBalance: usersTable.walletBalance }).from(usersTable).where(eq(usersTable.id, riderId)).limit(1);
  const currentBalance = safeNum(user?.walletBalance);
  res.json({
    minBalance,
    depositEnabled,
    currentBalance,
    isBelowMin: minBalance > 0 && currentBalance < minBalance,
    shortfall: minBalance > 0 ? Math.max(0, minBalance - currentBalance) : 0,
  });
});

/* ── POST /rider/wallet/deposit — Submit a manual deposit request ── */
router.post("/wallet/deposit", async (req, res) => {
  const parsed = depositSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" }); return; }
  const riderId = req.riderId!;
  const { amount, paymentMethod, accountNumber, transactionId, note } = parsed.data;
  const amt = amount;

  const s = await getPlatformSettings();
  const depositEnabled = (s["rider_deposit_enabled"] ?? "on") === "on";

  if (!depositEnabled) {
    res.status(403).json({ error: "Deposits are currently disabled by admin. Please contact support." }); return;
  }
  if (!amt || amt <= 0) { res.status(400).json({ error: "Valid amount required" }); return; }
  if (amt < 100) { res.status(400).json({ error: "Minimum deposit is Rs. 100" }); return; }
  if (!paymentMethod) { res.status(400).json({ error: "Payment method required" }); return; }
  if (!transactionId?.trim()) { res.status(400).json({ error: "Transaction ID is required for verification" }); return; }

  /* Build explicit allowlist of currently-enabled payment methods */
  const PAYMENT_METHOD_SETTING: Record<string, string> = {
    jazzcash: "jazzcash_enabled", easypaisa: "easypaisa_enabled", bank: "bank_enabled",
  };
  const enabledMethods = Object.entries(PAYMENT_METHOD_SETTING)
    .filter(([, settingKey]) => (s[settingKey] ?? "off") === "on")
    .map(([key]) => key);
  const methodKey = paymentMethod.toLowerCase().replace(/\s+/g, "");
  if (enabledMethods.length > 0 && !enabledMethods.includes(methodKey)) {
    res.status(400).json({ error: `Payment method '${paymentMethod}' is not enabled. Available: ${enabledMethods.join(", ")}.` }); return;
  }

  const txId = generateId();
  await db.insert(walletTransactionsTable).values({
    id: txId, userId: riderId, type: "deposit",
    amount: amt.toFixed(2),
    description: `Wallet Deposit — ${paymentMethod}${accountNumber ? ` · From: ${accountNumber}` : ""}${transactionId ? ` · TxID: ${transactionId}` : ""}${note ? ` · ${note}` : ""}`,
    reference: "pending",
    paymentMethod,
  });

  await db.insert(notificationsTable).values({
    id: generateId(), userId: riderId,
    title: "Deposit Request Submitted ✅",
    body: `Rs. ${amt} deposit request mein hai. Admin 24 hours mein verify karke wallet credit karega.`,
    type: "wallet", icon: "wallet-outline",
  }).catch(e => console.error("deposit notif insert failed:", e));

  res.json({ success: true, txId, amount: amt });
});

/* ── PATCH /rider/location — GPS heartbeat: rider sends periodic location updates ── */
router.patch("/location", async (req, res) => {
  const parsed = locationSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid location data" }); return; }
  const riderId = req.riderId!;
  const { latitude, longitude, accuracy } = parsed.data;

  const settings = await getCachedSettings();

  if (settings["security_gps_tracking"] === "off") {
    res.status(403).json({ error: "GPS tracking is currently disabled by admin." }); return;
  }

  if (accuracy !== undefined) {
    const minAccuracyMeters = parseInt(settings["security_gps_accuracy"] ?? "50", 10);
    if (accuracy > minAccuracyMeters) {
      console.warn(`[rider/location] Rider ${riderId} GPS accuracy ${accuracy}m exceeds threshold ${minAccuracyMeters}m`);
    }
  }

  if (settings["security_spoof_detection"] === "on") {
    const maxSpeedKmh = parseInt(settings["security_max_speed_kmh"] ?? "150", 10);
    const [prev] = await db.select().from(liveLocationsTable).where(eq(liveLocationsTable.userId, riderId)).limit(1);
    if (prev) {
      const prevLat = parseFloat(String(prev.latitude));
      const prevLon = parseFloat(String(prev.longitude));
      const { spoofed, speedKmh } = detectGPSSpoof(prevLat, prevLon, prev.updatedAt, latitude, longitude, maxSpeedKmh);
      if (spoofed) {
        const ip = getClientIp(req);
        addSecurityEvent({
          type: "gps_spoof_detected", ip, userId: riderId,
          details: `GPS spoof detected: speed ${speedKmh.toFixed(1)} km/h exceeds limit of ${maxSpeedKmh} km/h`,
          severity: "high",
        });
        res.status(422).json({
          error: "GPS location rejected: movement speed is physically impossible. Please disable mock location apps.",
          code: "GPS_SPOOF_DETECTED",
          detectedSpeedKmh: Math.round(speedKmh),
          maxAllowedKmh: maxSpeedKmh,
        }); return;
      }
    }
  }

  await db.insert(liveLocationsTable).values({
    userId: riderId,
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    role: "rider",
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: liveLocationsTable.userId,
    set: {
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      updatedAt: new Date(),
    },
  });

  res.json({ success: true, updatedAt: new Date().toISOString() });
});

/* ── POST /rider/rides/:id/ignore — Rider ignores a ride request (broadcast model) ──
   Any nearby rider can ignore a ride. Tracks ignore count and applies penalty if threshold exceeded. */
router.post("/rides/:id/ignore", async (req, res) => {
  const riderId = req.riderId!;
  const rideId  = req.params["id"]!;

  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }

  if (!["searching", "bargaining"].includes(ride.status)) {
    res.status(400).json({ error: "This ride is no longer available" }); return;
  }

  const s = await getPlatformSettings();
  const ignoreThreshold = parseInt(s["dispatch_ignore_threshold"] ?? "10", 10);
  const ignorePenaltyAmt = parseFloat(s["dispatch_ignore_penalty"] ?? "25");

  await db.update(usersTable)
    .set({ ignoreCount: sql`ignore_count + 1`, updatedAt: new Date() })
    .where(eq(usersTable.id, riderId));

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [countRow] = await db.select({ c: count() })
    .from(riderPenaltiesTable)
    .where(and(
      eq(riderPenaltiesTable.riderId, riderId),
      eq(riderPenaltiesTable.type, "ignore"),
      gte(riderPenaltiesTable.createdAt, today),
    ));
  const dailyIgnores = (countRow?.c ?? 0) + 1;

  let penaltyApplied = 0;
  if (dailyIgnores > ignoreThreshold) {
    penaltyApplied = ignorePenaltyAmt;
    await db.transaction(async (tx) => {
      await tx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance - ${ignorePenaltyAmt}`, updatedAt: new Date() })
        .where(eq(usersTable.id, riderId));
      await tx.insert(walletTransactionsTable).values({
        id: generateId(), userId: riderId, type: "ignore_penalty",
        amount: ignorePenaltyAmt.toFixed(2),
        description: `Ignore penalty (${dailyIgnores}/${ignoreThreshold} today) — Rs. ${ignorePenaltyAmt}`,
        reference: `ignore_penalty:${Date.now()}`,
      });
    });
    await db.insert(notificationsTable).values({
      id: generateId(), userId: riderId,
      title: "Ignore Penalty ⚠️",
      body: `You ignored ${dailyIgnores} rides today (limit: ${ignoreThreshold}). Rs. ${ignorePenaltyAmt} penalty applied.`,
      type: "system", icon: "alert-circle-outline",
    }).catch(() => {});
  }

  await db.insert(riderPenaltiesTable).values({
    id: generateId(), riderId, type: "ignore",
    amount: penaltyApplied > 0 ? ignorePenaltyAmt.toFixed(2) : "0",
    reason: `Ignored ride ${rideId.slice(-6).toUpperCase()} (${dailyIgnores} today)`,
  });

  res.json({ success: true, dailyIgnores, threshold: ignoreThreshold, penaltyApplied });
});

/* ── GET /rider/wallet/deposits — Deposit history ── */
router.get("/wallet/deposits", async (req, res) => {
  const riderId = req.riderId!;
  const deposits = await db.select().from(walletTransactionsTable)
    .where(and(eq(walletTransactionsTable.userId, riderId), eq(walletTransactionsTable.type, "deposit")))
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(20);
  res.json({ deposits: deposits.map(d => ({ ...d, amount: safeNum(d.amount) })) });
});

/* ── Ignore penalty helper ── */
async function handleIgnorePenalty(riderId: string): Promise<{ dailyIgnores: number; penaltyApplied: number; restricted: boolean }> {
  const s = await getPlatformSettings();
  const limit = parseInt(s["rider_ignore_limit_daily"] ?? "5", 10);
  const penaltyAmt = parseFloat(s["rider_ignore_penalty_amount"] ?? "30");
  const restrictEnabled = (s["rider_ignore_restrict_enabled"] ?? "off") === "on";

  const today = new Date(); today.setHours(0, 0, 0, 0);

  const [countRow] = await db.select({ c: count() })
    .from(riderPenaltiesTable)
    .where(and(
      eq(riderPenaltiesTable.riderId, riderId),
      eq(riderPenaltiesTable.type, "ignore"),
      gte(riderPenaltiesTable.createdAt, today),
    ));
  const dailyIgnores = (countRow?.c ?? 0) + 1;

  let penaltyApplied = 0;
  let restricted = false;

  await db.insert(riderPenaltiesTable).values({
    id: generateId(), riderId, type: "ignore",
    amount: "0",
    reason: `Ignore #${dailyIgnores} today`,
  });

  if (dailyIgnores > limit) {
    penaltyApplied = penaltyAmt;
    await db.transaction(async (tx) => {
      await tx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance - ${penaltyAmt}`, updatedAt: new Date() })
        .where(eq(usersTable.id, riderId));
      await tx.insert(riderPenaltiesTable).values({
        id: generateId(), riderId, type: "ignore_penalty",
        amount: penaltyAmt.toFixed(2),
        reason: `Excessive ignore penalty (${dailyIgnores}/${limit} today) — Rs. ${penaltyAmt} deducted`,
      });
    });

    if (restrictEnabled) {
      await db.update(usersTable)
        .set({ isRestricted: true, updatedAt: new Date() })
        .where(eq(usersTable.id, riderId));
      restricted = true;
    }

    await db.insert(notificationsTable).values({
      id: generateId(), userId: riderId,
      title: restricted ? "Account Restricted ⚠️" : "Ignore Penalty ⚠️",
      body: restricted
        ? `Aapne aaj ${dailyIgnores} requests ignore ki (limit: ${limit}). Rs. ${penaltyAmt} penalty aur account restrict ho gaya. Support se contact karein.`
        : `Aapne aaj ${dailyIgnores} requests ignore ki (limit: ${limit}). Rs. ${penaltyAmt} penalty lagai gayi.`,
      type: "system", icon: "alert-circle-outline",
    }).catch(() => {});
  } else if (dailyIgnores === limit) {
    await db.insert(notificationsTable).values({
      id: generateId(), userId: riderId,
      title: "Ignore Warning ⚠️",
      body: `Aapne aaj ${dailyIgnores}/${limit} requests ignore ki. Agla ignore Rs. ${penaltyAmt} penalty aur account restriction ka sabab ban sakta hai.`,
      type: "system", icon: "alert-circle-outline",
    }).catch(() => {});
  }

  return { dailyIgnores, penaltyApplied, restricted };
}

/* ── POST /rider/rides/:id/ignore — Rider ignores a ride request ── */
router.post("/rides/:id/ignore", async (req, res) => {
  const riderId = req.riderId!;
  const rideId = req.params["id"]!;

  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }
  if (!["searching", "bargaining"].includes(ride.status)) {
    res.status(400).json({ error: "Ride is no longer available" }); return;
  }

  const penalty = await handleIgnorePenalty(riderId);

  res.json({
    success: true,
    rideId,
    ignorePenalty: penalty,
  });
});

/* ── GET /rider/ignore-stats — Rider's ignore stats for today ── */
router.get("/ignore-stats", async (req, res) => {
  const riderId = req.riderId!;
  const s = await getPlatformSettings();
  const limit = parseInt(s["rider_ignore_limit_daily"] ?? "5", 10);
  const penaltyAmt = parseFloat(s["rider_ignore_penalty_amount"] ?? "30");

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [countRow] = await db.select({ c: count() })
    .from(riderPenaltiesTable)
    .where(and(
      eq(riderPenaltiesTable.riderId, riderId),
      eq(riderPenaltiesTable.type, "ignore"),
      gte(riderPenaltiesTable.createdAt, today),
    ));

  res.json({
    dailyIgnores: countRow?.c ?? 0,
    dailyLimit: limit,
    penaltyAmount: penaltyAmt,
    remaining: Math.max(0, limit - (countRow?.c ?? 0)),
  });
});

/* ── GET /rider/penalty-history — Rider's penalty history ── */
router.get("/penalty-history", async (req, res) => {
  const riderId = req.riderId!;
  const penalties = await db.select().from(riderPenaltiesTable)
    .where(eq(riderPenaltiesTable.riderId, riderId))
    .orderBy(desc(riderPenaltiesTable.createdAt))
    .limit(50);
  res.json({
    penalties: penalties.map(p => ({
      ...p,
      amount: safeNum(p.amount),
      createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
    })),
  });
});

export default router;
