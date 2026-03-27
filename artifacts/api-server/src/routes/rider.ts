import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable, ordersTable, rideBidsTable, ridesTable, walletTransactionsTable, notificationsTable } from "@workspace/db/schema";
import { eq, desc, and, or, sql, count, sum, gte, isNull } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getPlatformSettings } from "./admin.js";
import { verifyUserJwt } from "../middleware/security.js";

const router: IRouter = Router();

const safeNum = (v: any, def = 0) => { const n = parseFloat(String(v ?? def)); return isNaN(n) ? def : n; };

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
  if (!user.isActive) { res.status(403).json({ error: "Account is inactive" }); return; }
  if (user.isBanned) { res.status(403).json({ error: "Account is banned" }); return; }

  /* Enforce rider role — check BOTH the JWT claim and the DB roles field */
  const dbRoles = (user.roles || user.role || "").split(",").map((r: string) => r.trim());
  const jwtRoles = (payload.roles || payload.role || "").split(",").map((r: string) => r.trim());
  if (!dbRoles.includes("rider") || !jwtRoles.includes("rider")) {
    res.status(403).json({ error: "Access denied. This portal is for riders only." }); return;
  }

  (req as any).riderId = user.id;
  (req as any).riderUser = user;
  next();
}

router.use(riderAuth);

/* ── GET /rider/me — Profile ── */
router.get("/me", async (req, res) => {
  const user = (req as any).riderUser;
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

  res.json({
    id: user.id, phone: user.phone, name: user.name, email: user.email,
    avatar: user.avatar, isOnline: user.isOnline,
    walletBalance: safeNum(user.walletBalance),
    cnic: user.cnic, address: user.address, city: user.city,
    emergencyContact: user.emergencyContact,
    vehicleType: user.vehicleType, vehiclePlate: user.vehiclePlate,
    bankName: user.bankName, bankAccount: user.bankAccount, bankAccountTitle: user.bankAccountTitle,
    lastLoginAt: user.lastLoginAt, createdAt: user.createdAt,
    stats: {
      deliveriesToday,
      earningsToday:   parseFloat(earningsToday.toFixed(2)),
      totalDeliveries,
      totalEarnings:   parseFloat(totalEarnings.toFixed(2)),
    },
  });
});

/* ── PATCH /rider/online — Toggle online status ── */
router.patch("/online", async (req, res) => {
  const riderId = (req as any).riderId;
  const { isOnline } = req.body;
  await db.update(usersTable).set({ isOnline: !!isOnline, updatedAt: new Date() }).where(eq(usersTable.id, riderId));
  res.json({ success: true, isOnline: !!isOnline });
});

/* ── PATCH /rider/profile — Update profile ── */
router.patch("/profile", async (req, res) => {
  const riderId = (req as any).riderId;
  const { name, email, cnic, address, city, emergencyContact, vehicleType, vehiclePlate, bankName, bankAccount, bankAccountTitle } = req.body;
  const updates: any = { updatedAt: new Date() };
  if (name             !== undefined) updates.name             = name;
  if (email            !== undefined) updates.email            = email;
  if (cnic             !== undefined) updates.cnic             = cnic;
  if (address          !== undefined) updates.address          = address;
  if (city             !== undefined) updates.city             = city;
  if (emergencyContact !== undefined) updates.emergencyContact = emergencyContact;
  if (vehicleType      !== undefined) updates.vehicleType      = vehicleType;
  if (vehiclePlate     !== undefined) updates.vehiclePlate     = vehiclePlate;
  if (bankName         !== undefined) updates.bankName         = bankName;
  if (bankAccount      !== undefined) updates.bankAccount      = bankAccount;
  if (bankAccountTitle !== undefined) updates.bankAccountTitle = bankAccountTitle;
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, riderId)).returning();
  res.json({
    id: user.id, name: user.name, phone: user.phone, email: user.email,
    role: user.role, isOnline: user.isOnline, walletBalance: safeNum(user.walletBalance),
    cnic: user.cnic, address: user.address, city: user.city,
    emergencyContact: user.emergencyContact,
    vehicleType: user.vehicleType, vehiclePlate: user.vehiclePlate,
    bankName: user.bankName, bankAccount: user.bankAccount, bankAccountTitle: user.bankAccountTitle,
    createdAt: user.createdAt, lastLoginAt: user.lastLoginAt,
  });
});

/* ── GET /rider/requests — Available orders + rides (incl. bargaining, with own bid info) ── */
router.get("/requests", async (req, res) => {
  const riderId = (req as any).riderId;
  const [orders, rides, myBids] = await Promise.all([
    db.select().from(ordersTable)
      .where(or(eq(ordersTable.status, "confirmed"), eq(ordersTable.status, "preparing")))
      .orderBy(desc(ordersTable.createdAt)).limit(20),
    /* Show searching rides + bargaining rides (unassigned, open to all) */
    db.select().from(ridesTable)
      .where(and(
        or(eq(ridesTable.status, "searching"), eq(ridesTable.status, "bargaining")),
        isNull(ridesTable.riderId),
      ))
      .orderBy(desc(ridesTable.createdAt)).limit(30),
    /* Fetch this rider's own bids on bargaining rides */
    db.select().from(rideBidsTable)
      .where(and(eq(rideBidsTable.riderId, riderId), eq(rideBidsTable.status, "pending"))),
  ]);

  /* Map each bid by rideId for quick lookup */
  const myBidMap = new Map<string, (typeof myBids)[0]>(myBids.map(b => [b.rideId, b]));

  res.json({
    orders: orders.map(o => ({ ...o, total: safeNum(o.total) })),
    rides:  rides.map(r => ({
      ...r,
      fare:          safeNum(r.fare),
      distance:      safeNum(r.distance),
      offeredFare:   r.offeredFare ? safeNum(r.offeredFare) : null,
      counterFare:   r.counterFare ? safeNum(r.counterFare) : null,
      bargainRounds: r.bargainRounds ?? 0,
      /* InDrive: include this rider's pending bid (if any) so UI can show "Bid Submitted" */
      myBid: myBidMap.has(r.id) ? {
        id:   myBidMap.get(r.id)!.id,
        fare: safeNum(myBidMap.get(r.id)!.fare),
        note: myBidMap.get(r.id)!.note,
      } : null,
    })),
  });
});

/* ── GET /rider/active — Current active delivery ── */
router.get("/active", async (req, res) => {
  const riderId = (req as any).riderId;
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
  const riderId   = (req as any).riderId;
  const orderId   = req.params["id"]!;

  const s = await getPlatformSettings();

  /* ── Cash-order gate: admin can restrict riders from taking cash orders ── */
  const cashAllowed = (s["rider_cash_allowed"] ?? "on") === "on";
  if (!cashAllowed) {
    const [targetOrder] = await db.select({ paymentMethod: ordersTable.paymentMethod })
      .from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
    if (targetOrder?.paymentMethod === "cash") {
      res.status(403).json({ error: "Cash-on-delivery orders are currently not available for riders." }); return;
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
  }).catch(() => {});

  res.json({ ...updated, total: safeNum(updated.total) });
});

/* ── PATCH /rider/orders/:id/status — Update order status (delivered) ── */
router.patch("/orders/:id/status", async (req, res) => {
  const riderId = (req as any).riderId;
  const { status } = req.body;
  const validStatuses = ["out_for_delivery", "delivered", "cancelled"];
  if (!validStatuses.includes(status)) { res.status(400).json({ error: "Invalid status" }); return; }

  const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, req.params["id"]!), eq(ordersTable.riderId, riderId))).limit(1);
  if (!order) { res.status(404).json({ error: "Order not found or not yours" }); return; }

  /* ── Rider Cancel: clear riderId + reset to preparing so another rider can pick it up ── */
  if (status === "cancelled") {
    /* Include riderId in WHERE to close TOCTOU window — only this rider can release their own assignment */
    const [cancelled] = await db.update(ordersTable)
      .set({ riderId: null, status: "preparing", updatedAt: new Date() })
      .where(and(eq(ordersTable.id, req.params["id"]!), eq(ordersTable.riderId, riderId)))
      .returning();
    await db.insert(notificationsTable).values({
      id: generateId(), userId: order.userId,
      title: "Rider Change 🔄", body: "Your rider had to cancel. We're finding a new rider for you.",
      type: "order", icon: "refresh-outline",
    }).catch(() => {});
    res.json({ ...cancelled, total: safeNum(cancelled?.total || 0), status: "cancelled_by_rider" }); return;
  }

  /* Include riderId in WHERE to close the TOCTOU window — only the assigned rider can advance status */
  const [updated] = await db.update(ordersTable).set({ status, updatedAt: new Date() }).where(and(eq(ordersTable.id, req.params["id"]!), eq(ordersTable.riderId, riderId))).returning();

  if (status === "delivered") {
    const s = await getPlatformSettings();
    const riderKeepPct = parseFloat(s["rider_keep_pct"] ?? "80") / 100;
    const bonusPerTrip = parseFloat(s["rider_bonus_per_trip"] ?? "0");
    const earnings = parseFloat((safeNum(order.total) * riderKeepPct).toFixed(2));
    const totalCredit = parseFloat((earnings + bonusPerTrip).toFixed(2));

    // Credit rider earnings + bonus
    await db.update(usersTable).set({ walletBalance: sql`wallet_balance + ${totalCredit}`, updatedAt: new Date() }).where(eq(usersTable.id, riderId));
    await db.insert(walletTransactionsTable).values({
      id: generateId(), userId: riderId, type: "credit",
      amount: earnings.toFixed(2),
      description: `Delivery earnings — Order #${order.id.slice(-6).toUpperCase()} (${Math.round(riderKeepPct * 100)}%)`,
    }).catch(() => {});
    if (bonusPerTrip > 0) {
      await db.insert(walletTransactionsTable).values({
        id: generateId(), userId: riderId, type: "bonus",
        amount: bonusPerTrip.toFixed(2),
        description: `Per-trip bonus — Order #${order.id.slice(-6).toUpperCase()}`,
      }).catch(() => {});
    }
    await db.insert(notificationsTable).values({
      id: generateId(), userId: order.userId,
      title: "Order Delivered! 🎉", body: "Your order has been delivered. Enjoy!",
      type: "order", icon: "bag-check-outline",
    }).catch(() => {});
    await db.insert(notificationsTable).values({
      id: generateId(), userId: riderId,
      title: "Delivery Earning Credited 💰", body: `Rs. ${earnings} wallet mein add ho gaya!`,
      type: "wallet", icon: "wallet-outline",
    }).catch(() => {});

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
          .catch(() => {});
        await db.insert(walletTransactionsTable).values({
          id: generateId(), userId: order.userId, type: "loyalty",
          amount: loyaltyPts.toFixed(2),
          description: `Loyalty points (${loyaltyPtsPerHundred} pts/Rs.100) — Order #${order.id.slice(-6).toUpperCase()}`,
        }).catch(() => {});
        await db.insert(notificationsTable).values({
          id: generateId(), userId: order.userId,
          title: "Loyalty Points Earned! ⭐", body: `+${loyaltyPts} loyalty points added for your order!`,
          type: "wallet", icon: "star-outline",
        }).catch(() => {});
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
          .catch(() => {});
        await db.insert(walletTransactionsTable).values({
          id: generateId(), userId: order.userId, type: "cashback",
          amount: cashbackAmt.toFixed(2),
          description: `Cashback ${Math.round(cashbackPct * 100)}% — Order #${order.id.slice(-6).toUpperCase()}`,
        }).catch(() => {});
        await db.insert(notificationsTable).values({
          id: generateId(), userId: order.userId,
          title: "Cashback Credited! 🎁", body: `Rs. ${cashbackAmt} cashback added to your wallet!`,
          type: "wallet", icon: "wallet-outline",
        }).catch(() => {});
      }
    }
  }

  res.json({ ...updated, total: safeNum(updated.total) });
});

/* ── POST /rider/rides/:id/accept — Accept a ride ──
   Uses WHERE riderId IS NULL to prevent two riders accepting same ride (race condition) */
router.post("/rides/:id/accept", async (req, res) => {
  const riderId   = (req as any).riderId;
  const riderUser = (req as any).riderUser;
  const rideId    = req.params["id"]!;

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
  } catch {
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
  }).catch(() => {});

  res.json({ ...updated, fare: safeNum(updated.fare), distance: safeNum(updated.distance) });
});

/* ── PATCH /rider/rides/:id/status — Update ride status (completed/cancelled) ── */
router.patch("/rides/:id/status", async (req, res) => {
  const riderId = (req as any).riderId;
  const { status } = req.body;
  if (!["arrived", "in_transit", "completed", "cancelled"].includes(status)) { res.status(400).json({ error: "Invalid status" }); return; }

  const [ride] = await db.select().from(ridesTable).where(and(eq(ridesTable.id, req.params["id"]!), eq(ridesTable.riderId, riderId))).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found or not yours" }); return; }

  /* Include riderId in WHERE to close TOCTOU between ownership check and update */
  const [updated] = await db.update(ridesTable).set({ status, updatedAt: new Date() }).where(and(eq(ridesTable.id, req.params["id"]!), eq(ridesTable.riderId, riderId))).returning();

  if (status === "completed") {
    const s = await getPlatformSettings();
    const riderKeepPct = parseFloat(s["rider_keep_pct"] ?? "80") / 100;
    const bonusPerTrip = parseFloat(s["rider_bonus_per_trip"] ?? "0");
    const earnings = parseFloat((safeNum(ride.fare) * riderKeepPct).toFixed(2));
    const totalCredit = parseFloat((earnings + bonusPerTrip).toFixed(2));

    await db.update(usersTable).set({ walletBalance: sql`wallet_balance + ${totalCredit}`, updatedAt: new Date() }).where(eq(usersTable.id, riderId));
    await db.insert(walletTransactionsTable).values({
      id: generateId(), userId: riderId, type: "credit",
      amount: earnings.toFixed(2),
      description: `Ride earnings — #${ride.id.slice(-6).toUpperCase()} (${Math.round(riderKeepPct * 100)}%)`,
    }).catch(() => {});
    if (bonusPerTrip > 0) {
      await db.insert(walletTransactionsTable).values({
        id: generateId(), userId: riderId, type: "bonus",
        amount: bonusPerTrip.toFixed(2),
        description: `Per-trip bonus — Ride #${ride.id.slice(-6).toUpperCase()}`,
      }).catch(() => {});
    }
    await db.insert(notificationsTable).values({
      id: generateId(), userId: ride.userId,
      title: "Ride Completed! ✅", body: "Thanks for riding with AJKMart. Rate your experience!",
      type: "ride", icon: "checkmark-circle-outline",
    }).catch(() => {});
    await db.insert(notificationsTable).values({
      id: generateId(), userId: riderId,
      title: "Ride Earning Credited 💰", body: `Rs. ${earnings} wallet mein add ho gaya!`,
      type: "wallet", icon: "wallet-outline",
    }).catch(() => {});
  }

  res.json({ ...updated, fare: safeNum(updated.fare), distance: safeNum(updated.distance) });
});

/* ── POST /rider/rides/:id/counter — Rider submits a bid on a bargaining ride (InDrive multi-bid) ── */
router.post("/rides/:id/counter", async (req, res) => {
  const riderId   = (req as any).riderId;
  const riderUser = (req as any).riderUser;
  const rideId    = req.params["id"]!;
  const { counterFare, note } = req.body;

  if (!counterFare) { res.status(400).json({ error: "counterFare required" }); return; }

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

  /* Upsert: update existing pending bid OR insert new one */
  const [existingBid] = await db.select({ id: rideBidsTable.id })
    .from(rideBidsTable)
    .where(and(eq(rideBidsTable.rideId, rideId), eq(rideBidsTable.riderId, riderId), eq(rideBidsTable.status, "pending")))
    .limit(1);

  let bid;
  if (existingBid) {
    /* Update existing bid — include riderId in WHERE to close TOCTOU */
    const [b] = await db.update(rideBidsTable)
      .set({ fare: parsedCounter.toFixed(2), note: note ?? null, updatedAt: new Date() })
      .where(and(eq(rideBidsTable.id, existingBid.id), eq(rideBidsTable.riderId, riderId)))
      .returning();
    bid = b;
  } else {
    /* Insert fresh bid */
    const [b] = await db.insert(rideBidsTable).values({
      id:         generateId(),
      rideId,
      riderId,
      riderName:  riderUser.name || "Rider",
      riderPhone: riderUser.phone ?? null,
      fare:       parsedCounter.toFixed(2),
      note:       note ?? null,
      status:     "pending",
    }).returning();
    bid = b;
  }

  /* Notify customer that a new bid has come in (only on first bid from this rider) */
  if (!existingBid) {
    await db.insert(notificationsTable).values({
      id: generateId(), userId: ride.userId,
      title: "Naya Bid Aaya! 💬",
      body: `${riderUser.name || "Ek rider"} ne Rs. ${parsedCounter.toFixed(0)} ka bid diya. Dekhein aur choose karein!`,
      type: "ride", icon: "chatbubble-outline", link: "/ride",
    }).catch(() => {});
  }

  res.json({ success: true, bid: { ...bid, fare: safeNum(bid!.fare) } });
});

/* ── POST /rider/rides/:id/reject-offer — Rider dismisses a bargaining ride (local dismiss, no DB lock) ── */
router.post("/rides/:id/reject-offer", async (req, res) => {
  /* InDrive model: riders don't lock the ride anymore, so "rejection" is purely a local dismiss.
     If this rider had submitted a pending bid, we cancel it. */
  const riderId = (req as any).riderId;
  const rideId  = req.params["id"]!;

  /* Cancel any pending bid this rider submitted */
  await db.update(rideBidsTable)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(eq(rideBidsTable.rideId, rideId), eq(rideBidsTable.riderId, riderId), eq(rideBidsTable.status, "pending")));

  res.json({ success: true, message: "Ride dismissed" });
});

/* ── GET /rider/history — Delivery history ── */
router.get("/history", async (req, res) => {
  const riderId = (req as any).riderId;
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

/* ── GET /rider/earnings — Earnings summary ── */
router.get("/earnings", async (req, res) => {
  const riderId = (req as any).riderId;
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
  const riderId = (req as any).riderId;
  const user = (req as any).riderUser;
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
  const riderId = (req as any).riderId;
  const { amount, accountTitle, accountNumber, bankName, paymentMethod, note } = req.body;
  const amt = safeNum(amount);

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
    }).catch(() => {});

    res.json({ success: true, newBalance: parseFloat(result.toFixed(2)), amount: amt, txId });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* ── GET /rider/cod-summary — COD balance + remittance history ── */
router.get("/cod-summary", async (req, res) => {
  const riderId = (req as any).riderId;
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
  const riderId = (req as any).riderId;
  const { amount, paymentMethod, accountNumber, transactionId, note } = req.body;
  const amt = safeNum(amount);
  if (!amt || amt <= 0) { res.status(400).json({ error: "Valid amount required" }); return; }
  if (!paymentMethod)   { res.status(400).json({ error: "Payment method required" }); return; }
  if (!accountNumber)   { res.status(400).json({ error: "Account / transaction reference required" }); return; }
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
  }).catch(() => {});
  res.json({ success: true, txId, amount: amt });
});

/* ── GET /rider/notifications ── */
router.get("/notifications", async (req, res) => {
  const riderId = (req as any).riderId;
  const notifs = await db.select().from(notificationsTable)
    .where(eq(notificationsTable.userId, riderId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(30);
  res.json({ notifications: notifs, unread: notifs.filter((n: any) => !n.isRead).length });
});

/* ── PATCH /rider/notifications/read-all ── */
router.patch("/notifications/read-all", async (req, res) => {
  const riderId = (req as any).riderId;
  await db.update(notificationsTable).set({ isRead: true }).where(eq(notificationsTable.userId, riderId));
  res.json({ success: true });
});

export default router;
