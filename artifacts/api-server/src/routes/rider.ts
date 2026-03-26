import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable, ordersTable, ridesTable, walletTransactionsTable, notificationsTable } from "@workspace/db/schema";
import { eq, desc, and, or, sql, count, sum, gte } from "drizzle-orm";
import { generateId } from "../lib/id.js";

const router: IRouter = Router();

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

  const [deliveriesToday, earningsToday, totalDeliveries, totalEarnings] = await Promise.all([
    db.select({ c: count() }).from(ordersTable).where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"), gte(ordersTable.createdAt, today))),
    db.select({ s: sum(ordersTable.total) }).from(ordersTable).where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"), gte(ordersTable.createdAt, today))),
    db.select({ c: count() }).from(ordersTable).where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"))),
    db.select({ s: sum(ordersTable.total) }).from(ordersTable).where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"))),
  ]);

  res.json({
    id: user.id, phone: user.phone, name: user.name, email: user.email,
    avatar: user.avatar, isOnline: user.isOnline,
    walletBalance: parseFloat(user.walletBalance ?? "0"),
    stats: {
      deliveriesToday: deliveriesToday[0]?.c ?? 0,
      earningsToday: parseFloat(String(earningsToday[0]?.s ?? "0")) * 0.8,
      totalDeliveries: totalDeliveries[0]?.c ?? 0,
      totalEarnings: parseFloat(String(totalEarnings[0]?.s ?? "0")) * 0.8,
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
  const { name, email } = req.body;
  const updates: any = { updatedAt: new Date() };
  if (name)  updates.name  = name;
  if (email) updates.email = email;
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, riderId)).returning();
  res.json({ id: user.id, name: user.name, phone: user.phone, email: user.email });
});

/* ── GET /rider/requests — Available orders to pick up ── */
router.get("/requests", async (req, res) => {
  const riderId = (req as any).riderId;
  const [orders, rides] = await Promise.all([
    db.select().from(ordersTable)
      .where(or(eq(ordersTable.status, "confirmed"), eq(ordersTable.status, "preparing")))
      .orderBy(desc(ordersTable.createdAt)).limit(20),
    db.select().from(ridesTable)
      .where(eq(ridesTable.status, "searching"))
      .orderBy(desc(ridesTable.createdAt)).limit(20),
  ]);
  res.json({
    orders: orders.map(o => ({ ...o, total: parseFloat(String(o.total)) })),
    rides: rides.map(r => ({ ...r, fare: parseFloat(String(r.fare)), distance: parseFloat(String(r.distance)) })),
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
    order: order[0] ? { ...order[0], total: parseFloat(String(order[0].total)) } : null,
    ride:  ride[0]  ? { ...ride[0], fare: parseFloat(String(ride[0].fare)), distance: parseFloat(String(ride[0].distance)) } : null,
  });
});

/* ── POST /rider/orders/:id/accept — Accept an order ── */
router.post("/orders/:id/accept", async (req, res) => {
  const riderId = (req as any).riderId;
  const riderUser = (req as any).riderUser;
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, req.params["id"]!)).limit(1);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (order.riderId) { res.status(409).json({ error: "Order already taken by another rider" }); return; }
  const [updated] = await db.update(ordersTable).set({
    riderId, status: "out_for_delivery", updatedAt: new Date(),
  }).where(eq(ordersTable.id, req.params["id"]!)).returning();
  await db.insert(notificationsTable).values({ id: generateId(), userId: order.userId, title: "Rider on the Way! 🚴", body: "Your order has been picked up. Rider is on the way!", type: "order", icon: "bicycle-outline" }).catch(() => {});
  res.json({ ...updated, total: parseFloat(String(updated.total)) });
});

/* ── PATCH /rider/orders/:id/status — Update order status ── */
router.patch("/orders/:id/status", async (req, res) => {
  const riderId = (req as any).riderId;
  const { status } = req.body;
  const validStatuses = ["out_for_delivery", "delivered"];
  if (!validStatuses.includes(status)) { res.status(400).json({ error: "Invalid status" }); return; }
  const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, req.params["id"]!), eq(ordersTable.riderId, riderId))).limit(1);
  if (!order) { res.status(404).json({ error: "Order not found or not yours" }); return; }
  const [updated] = await db.update(ordersTable).set({ status, updatedAt: new Date() }).where(eq(ordersTable.id, req.params["id"]!)).returning();
  if (status === "delivered") {
    const earnings = parseFloat(String(order.total)) * 0.8;
    await db.update(usersTable).set({ walletBalance: sql`wallet_balance + ${earnings}`, updatedAt: new Date() }).where(eq(usersTable.id, riderId));
    await db.insert(walletTransactionsTable).values({ id: generateId(), userId: riderId, type: "credit", amount: String(earnings.toFixed(2)), description: `Delivery earnings — Order #${order.id.slice(-6).toUpperCase()}` }).catch(() => {});
    await db.insert(notificationsTable).values({ id: generateId(), userId: order.userId, title: "Order Delivered! 🎉", body: "Your order has been delivered. Enjoy!", type: "order", icon: "bag-check-outline" }).catch(() => {});
  }
  res.json({ ...updated, total: parseFloat(String(updated.total)) });
});

/* ── POST /rider/rides/:id/accept — Accept a ride ── */
router.post("/rides/:id/accept", async (req, res) => {
  const riderId = (req as any).riderId;
  const riderUser = (req as any).riderUser;
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, req.params["id"]!)).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }
  if (ride.riderId) { res.status(409).json({ error: "Ride already taken" }); return; }
  const [updated] = await db.update(ridesTable).set({
    riderId, riderName: riderUser.name || "Rider", riderPhone: riderUser.phone, status: "ongoing", updatedAt: new Date(),
  }).where(eq(ridesTable.id, req.params["id"]!)).returning();
  await db.insert(notificationsTable).values({ id: generateId(), userId: ride.userId, title: "Rider Assigned! 🚗", body: `${riderUser.name || "Your rider"} is coming to pick you up.`, type: "ride", icon: "car-outline" }).catch(() => {});
  res.json({ ...updated, fare: parseFloat(String(updated.fare)), distance: parseFloat(String(updated.distance)) });
});

/* ── PATCH /rider/rides/:id/status — Update ride status ── */
router.patch("/rides/:id/status", async (req, res) => {
  const riderId = (req as any).riderId;
  const { status } = req.body;
  if (!["ongoing", "completed", "cancelled"].includes(status)) { res.status(400).json({ error: "Invalid status" }); return; }
  const [ride] = await db.select().from(ridesTable).where(and(eq(ridesTable.id, req.params["id"]!), eq(ridesTable.riderId, riderId))).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found or not yours" }); return; }
  const [updated] = await db.update(ridesTable).set({ status, updatedAt: new Date() }).where(eq(ridesTable.id, req.params["id"]!)).returning();
  if (status === "completed") {
    const earnings = parseFloat(String(ride.fare)) * 0.8;
    await db.update(usersTable).set({ walletBalance: sql`wallet_balance + ${earnings}`, updatedAt: new Date() }).where(eq(usersTable.id, riderId));
    await db.insert(walletTransactionsTable).values({ id: generateId(), userId: riderId, type: "credit", amount: String(earnings.toFixed(2)), description: `Ride earnings — #${ride.id.slice(-6).toUpperCase()}` }).catch(() => {});
    await db.insert(notificationsTable).values({ id: generateId(), userId: ride.userId, title: "Ride Completed! ✅", body: "Thanks for riding with AJKMart. Rate your experience!", type: "ride", icon: "checkmark-circle-outline" }).catch(() => {});
  }
  res.json({ ...updated, fare: parseFloat(String(updated.fare)), distance: parseFloat(String(updated.distance)) });
});

/* ── GET /rider/history — Delivery history ── */
router.get("/history", async (req, res) => {
  const riderId = (req as any).riderId;
  const page = parseInt(String(req.query["page"] || "1"));
  const limit = 20;
  const offset = (page - 1) * limit;

  const [orders, rides] = await Promise.all([
    db.select().from(ordersTable).where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"))).orderBy(desc(ordersTable.updatedAt)).limit(limit / 2),
    db.select().from(ridesTable).where(and(eq(ridesTable.riderId, riderId), or(eq(ridesTable.status, "completed"), eq(ridesTable.status, "cancelled")))).orderBy(desc(ridesTable.updatedAt)).limit(limit / 2),
  ]);

  const combined = [
    ...orders.map(o => ({ kind: "order" as const, id: o.id, status: o.status, amount: parseFloat(String(o.total)), earnings: parseFloat(String(o.total)) * 0.8, address: o.deliveryAddress, type: o.type, createdAt: o.createdAt })),
    ...rides.map(r => ({ kind: "ride" as const, id: r.id, status: r.status, amount: parseFloat(String(r.fare)), earnings: parseFloat(String(r.fare)) * 0.8, address: r.dropAddress, type: r.type, createdAt: r.createdAt })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({ history: combined });
});

/* ── GET /rider/earnings — Earnings summary ── */
router.get("/earnings", async (req, res) => {
  const riderId = (req as any).riderId;
  const today = new Date(); today.setHours(0,0,0,0);
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(today); monthAgo.setDate(monthAgo.getDate() - 30);

  const [todayOrders, weekOrders, monthOrders, todayRides, weekRides] = await Promise.all([
    db.select({ s: sum(ordersTable.total), c: count() }).from(ordersTable).where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"), gte(ordersTable.updatedAt, today))),
    db.select({ s: sum(ordersTable.total), c: count() }).from(ordersTable).where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"), gte(ordersTable.updatedAt, weekAgo))),
    db.select({ s: sum(ordersTable.total), c: count() }).from(ordersTable).where(and(eq(ordersTable.riderId, riderId), eq(ordersTable.status, "delivered"), gte(ordersTable.updatedAt, monthAgo))),
    db.select({ s: sum(ridesTable.fare), c: count() }).from(ridesTable).where(and(eq(ridesTable.riderId, riderId), eq(ridesTable.status, "completed"), gte(ridesTable.updatedAt, today))),
    db.select({ s: sum(ridesTable.fare), c: count() }).from(ridesTable).where(and(eq(ridesTable.riderId, riderId), eq(ridesTable.status, "completed"), gte(ridesTable.updatedAt, weekAgo))),
  ]);

  const todayTotal = (parseFloat(String(todayOrders[0]?.s??0)) + parseFloat(String(todayRides[0]?.s??0))) * 0.8;
  const weekTotal  = (parseFloat(String(weekOrders[0]?.s??0)) + parseFloat(String(weekRides[0]?.s??0))) * 0.8;
  const monthTotal = parseFloat(String(monthOrders[0]?.s??0)) * 0.8;

  res.json({
    today:  { earnings: todayTotal, deliveries: (todayOrders[0]?.c??0) + (todayRides[0]?.c??0) },
    week:   { earnings: weekTotal,  deliveries: (weekOrders[0]?.c??0) + (weekRides[0]?.c??0) },
    month:  { earnings: monthTotal, deliveries: monthOrders[0]?.c??0 },
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
  const safeNum = (v: any) => v ? parseFloat(String(v)) : 0;
  res.json({
    balance: safeNum(user.walletBalance),
    transactions: txns.map(t => ({ ...t, amount: safeNum(t.amount) })),
  });
});

/* ── POST /rider/wallet/withdraw ── */
router.post("/wallet/withdraw", async (req, res) => {
  const riderId = (req as any).riderId;
  const user = (req as any).riderUser;
  const { amount, accountTitle, accountNumber, bankName, note } = req.body;
  const safeNum = (v: any) => v ? parseFloat(String(v)) : 0;
  const amt = safeNum(amount);
  if (!amt || amt <= 0)  { res.status(400).json({ error: "Valid amount required" }); return; }
  if (amt < 500)         { res.status(400).json({ error: "Minimum withdrawal is Rs. 500" }); return; }
  const balance = safeNum(user.walletBalance);
  if (amt > balance)     { res.status(400).json({ error: `Insufficient balance. Available: Rs. ${balance}` }); return; }
  if (!accountTitle || !accountNumber || !bankName) {
    res.status(400).json({ error: "Account title, number and bank name are required" }); return;
  }
  await db.update(usersTable).set({ walletBalance: sql`wallet_balance - ${amt}`, updatedAt: new Date() }).where(eq(usersTable.id, riderId));
  await db.insert(walletTransactionsTable).values({
    id: generateId(), userId: riderId, type: "debit", amount: String(amt.toFixed(2)),
    description: `Withdrawal — ${bankName} · ${accountNumber} · ${accountTitle}${note ? ` · ${note}` : ""}`,
  });
  await db.insert(notificationsTable).values({
    id: generateId(), userId: riderId, title: "Withdrawal Requested ✅",
    body: `Rs. ${amt} withdrawal submitted. Admin will process within 24-48 hours.`, type: "wallet", icon: "cash-outline",
  }).catch(() => {});
  res.json({ success: true, newBalance: balance - amt, amount: amt });
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
