import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable, ordersTable, ridesTable, walletTransactionsTable, notificationsTable } from "@workspace/db/schema";
import { eq, desc, and, or, sql, count, sum, gte, isNull } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getPlatformSettings } from "./admin.js";

const router: IRouter = Router();

const safeNum = (v: any, def = 0) => { const n = parseFloat(String(v ?? def)); return isNaN(n) ? def : n; };

/* ── Auth Middleware ── */
async function riderAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing token" }); return;
  }
  try {
    const token = authHeader.slice(7);
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const [userId] = decoded.split(":");
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId!)).limit(1);
    if (!user) { res.status(401).json({ error: "User not found" }); return; }
    if (!user.isActive) { res.status(403).json({ error: "Account is inactive" }); return; }
    if (user.isBanned) { res.status(403).json({ error: "Account is banned" }); return; }
    const roles = (user.roles || user.role || "").split(",").map(r => r.trim());
    if (!roles.includes("rider")) {
      res.status(403).json({ error: "Access denied. This portal is for riders only." }); return;
    }
    (req as any).riderId = user.id;
    (req as any).riderUser = user;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

router.use(riderAuth);

/* ── GET /rider/me — Profile ── */
router.get("/me", async (req, res) => {
  const user = (req as any).riderUser;
  const riderId = user.id;
  const today = new Date(); today.setHours(0,0,0,0);

  const s = await getPlatformSettings();
  const riderKeepPct = parseFloat(s["rider_keep_pct"] ?? "80") / 100;

  const [deliveriesToday, earningsToday, totalDeliveries, totalEarnings] = await Promise.all([
    db.select({ c: count() }).from(ordersTable).where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"), gte(ordersTable.createdAt, today))),
    db.select({ s: sum(ordersTable.total) }).from(ordersTable).where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"), gte(ordersTable.createdAt, today))),
    db.select({ c: count() }).from(ordersTable).where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"))),
    db.select({ s: sum(ordersTable.total) }).from(ordersTable).where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"))),
  ]);

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
      deliveriesToday: deliveriesToday[0]?.c ?? 0,
      earningsToday:   safeNum(earningsToday[0]?.s)  * riderKeepPct,
      totalDeliveries: totalDeliveries[0]?.c ?? 0,
      totalEarnings:   safeNum(totalEarnings[0]?.s)  * riderKeepPct,
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

/* ── GET /rider/requests — Available orders to pick up ── */
router.get("/requests", async (req, res) => {
  const [orders, rides] = await Promise.all([
    db.select().from(ordersTable)
      .where(or(eq(ordersTable.status, "confirmed"), eq(ordersTable.status, "preparing")))
      .orderBy(desc(ordersTable.createdAt)).limit(20),
    db.select().from(ridesTable)
      .where(eq(ridesTable.status, "searching"))
      .orderBy(desc(ridesTable.createdAt)).limit(20),
  ]);
  res.json({
    orders: orders.map(o => ({ ...o, total: safeNum(o.total) })),
    rides:  rides.map(r => ({ ...r, fare: safeNum(r.fare), distance: safeNum(r.distance) })),
  });
});

/* ── GET /rider/active — Current active delivery ── */
router.get("/active", async (req, res) => {
  const riderId = (req as any).riderId;
  const [order, ride] = await Promise.all([
    db.select().from(ordersTable).where(and(eq(ordersTable.riderId, riderId), or(eq(ordersTable.status, "out_for_delivery"), eq(ordersTable.status, "picked_up")))).orderBy(desc(ordersTable.updatedAt)).limit(1),
    db.select().from(ridesTable).where(and(eq(ridesTable.riderId, riderId), eq(ridesTable.status, "ongoing"))).orderBy(desc(ridesTable.updatedAt)).limit(1),
  ]);
  res.json({
    order: order[0] ? { ...order[0], total: safeNum(order[0].total) } : null,
    ride:  ride[0]  ? { ...ride[0], fare: safeNum(ride[0].fare), distance: safeNum(ride[0].distance) } : null,
  });
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
    db.select({ c: count() }).from(ridesTable).where(and(eq(ridesTable.riderId, riderId), eq(ridesTable.status, "ongoing"))),
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
  const validStatuses = ["out_for_delivery", "delivered"];
  if (!validStatuses.includes(status)) { res.status(400).json({ error: "Invalid status" }); return; }

  const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, req.params["id"]!), eq(ordersTable.riderId, riderId))).limit(1);
  if (!order) { res.status(404).json({ error: "Order not found or not yours" }); return; }

  const [updated] = await db.update(ordersTable).set({ status, updatedAt: new Date() }).where(eq(ordersTable.id, req.params["id"]!)).returning();

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
    db.select({ c: count() }).from(ridesTable).where(and(eq(ridesTable.riderId, riderId), eq(ridesTable.status, "ongoing"))),
  ]);
  const activeCount = (activeOrders[0]?.c ?? 0) + (activeRides[0]?.c ?? 0);
  if (activeCount >= maxDeliveries) {
    res.status(429).json({ error: `Maximum ${maxDeliveries} active deliveries allowed. Complete a current delivery first.` }); return;
  }

  // Atomic accept: only succeeds if riderId is still NULL
  const [updated] = await db
    .update(ridesTable)
    .set({ riderId, riderName: riderUser.name || "Rider", riderPhone: riderUser.phone, status: "ongoing", updatedAt: new Date() })
    .where(and(eq(ridesTable.id, rideId), isNull(ridesTable.riderId)))
    .returning();

  if (!updated) {
    const [existing] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
    if (!existing) { res.status(404).json({ error: "Ride not found" }); return; }
    res.status(409).json({ error: "Ride already taken by another rider" }); return;
  }

  await db.insert(notificationsTable).values({
    id: generateId(), userId: updated.userId,
    title: "Rider Assigned! 🚗",
    body: `${riderUser.name || "Your rider"} is coming to pick you up.`,
    type: "ride", icon: "car-outline",
  }).catch(() => {});

  res.json({ ...updated, fare: safeNum(updated.fare), distance: safeNum(updated.distance) });
});

/* ── PATCH /rider/rides/:id/status — Update ride status (completed/cancelled) ── */
router.patch("/rides/:id/status", async (req, res) => {
  const riderId = (req as any).riderId;
  const { status } = req.body;
  if (!["ongoing", "completed", "cancelled"].includes(status)) { res.status(400).json({ error: "Invalid status" }); return; }

  const [ride] = await db.select().from(ridesTable).where(and(eq(ridesTable.id, req.params["id"]!), eq(ridesTable.riderId, riderId))).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found or not yours" }); return; }

  const [updated] = await db.update(ridesTable).set({ status, updatedAt: new Date() }).where(eq(ridesTable.id, req.params["id"]!)).returning();

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

  const [todayOrders, weekOrders, monthOrders, todayRides, weekRides] = await Promise.all([
    db.select({ s: sum(ordersTable.total), c: count() }).from(ordersTable).where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"), gte(ordersTable.updatedAt, today))),
    db.select({ s: sum(ordersTable.total), c: count() }).from(ordersTable).where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"), gte(ordersTable.updatedAt, weekAgo))),
    db.select({ s: sum(ordersTable.total), c: count() }).from(ordersTable).where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"), gte(ordersTable.updatedAt, monthAgo))),
    db.select({ s: sum(ridesTable.fare), c: count() }).from(ridesTable).where(and(eq(ridesTable.riderId, riderId), eq(ridesTable.status, "completed"), gte(ridesTable.updatedAt, today))),
    db.select({ s: sum(ridesTable.fare), c: count() }).from(ridesTable).where(and(eq(ridesTable.riderId, riderId), eq(ridesTable.status, "completed"), gte(ridesTable.updatedAt, weekAgo))),
  ]);

  const todayTotal = (safeNum(todayOrders[0]?.s) + safeNum(todayRides[0]?.s)) * riderKeepPct;
  const weekTotal  = (safeNum(weekOrders[0]?.s)  + safeNum(weekRides[0]?.s))  * riderKeepPct;
  const monthTotal =  safeNum(monthOrders[0]?.s)                               * riderKeepPct;

  res.json({
    today:  { earnings: parseFloat(todayTotal.toFixed(2)), deliveries: (todayOrders[0]?.c ?? 0) + (todayRides[0]?.c ?? 0) },
    week:   { earnings: parseFloat(weekTotal.toFixed(2)),  deliveries: (weekOrders[0]?.c  ?? 0) + (weekRides[0]?.c  ?? 0) },
    month:  { earnings: parseFloat(monthTotal.toFixed(2)), deliveries: monthOrders[0]?.c ?? 0 },
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
  const { amount, accountTitle, accountNumber, bankName, note } = req.body;
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
    const result = await db.transaction(async (tx) => {
      const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, riderId)).limit(1);
      if (!user) throw new Error("User not found");

      const balance = safeNum(user.walletBalance);
      if (amt > balance) throw new Error(`Insufficient balance. Available: Rs. ${balance}`);

      await tx.update(usersTable).set({ walletBalance: sql`wallet_balance - ${amt}`, updatedAt: new Date() }).where(eq(usersTable.id, riderId));
      await tx.insert(walletTransactionsTable).values({
        id: generateId(), userId: riderId, type: "debit",
        amount: amt.toFixed(2),
        description: `Withdrawal — ${bankName} · ${accountNumber} · ${accountTitle}${note ? ` · ${note}` : ""}`,
      });
      return balance - amt;
    });

    await db.insert(notificationsTable).values({
      id: generateId(), userId: riderId,
      title: "Withdrawal Requested ✅",
      body: `Rs. ${amt} withdrawal submitted. Admin will process within 24-48 hours.`,
      type: "wallet", icon: "cash-outline",
    }).catch(() => {});

    res.json({ success: true, newBalance: parseFloat(result.toFixed(2)), amount: amt });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
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
