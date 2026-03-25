import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  ordersTable,
  ridesTable,
  pharmacyOrdersTable,
  parcelBookingsTable,
  productsTable,
  walletTransactionsTable,
  notificationsTable,
} from "@workspace/db/schema";
import { eq, desc, count, sum, sql } from "drizzle-orm";
import { generateId } from "../lib/id.js";

const router: IRouter = Router();

const ADMIN_SECRET = process.env.ADMIN_SECRET || "ajkmart-admin-2025";

function adminAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers["x-admin-secret"] || req.query["secret"];
  if (auth !== ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized. Invalid admin secret." });
    return;
  }
  next();
}

/* ── Auth check ── */
router.post("/auth", (req, res) => {
  const { secret } = req.body;
  if (secret === ADMIN_SECRET) {
    res.json({ success: true, token: ADMIN_SECRET });
  } else {
    res.status(401).json({ error: "Invalid admin password" });
  }
});

router.use(adminAuth);

/* ── Dashboard Stats ── */
router.get("/stats", async (_req, res) => {
  const [userCount] = await db.select({ count: count() }).from(usersTable);
  const [orderCount] = await db.select({ count: count() }).from(ordersTable);
  const [rideCount] = await db.select({ count: count() }).from(ridesTable);
  const [pharmCount] = await db.select({ count: count() }).from(pharmacyOrdersTable);
  const [parcelCount] = await db.select({ count: count() }).from(parcelBookingsTable);
  const [productCount] = await db.select({ count: count() }).from(productsTable);

  const [totalRevenue] = await db
    .select({ total: sum(ordersTable.total) })
    .from(ordersTable)
    .where(eq(ordersTable.status, "delivered"));

  const [rideRevenue] = await db
    .select({ total: sum(ridesTable.fare) })
    .from(ridesTable)
    .where(eq(ridesTable.status, "completed"));

  const [pharmRevenue] = await db
    .select({ total: sum(pharmacyOrdersTable.total) })
    .from(pharmacyOrdersTable)
    .where(eq(pharmacyOrdersTable.status, "delivered"));

  const recentOrders = await db
    .select()
    .from(ordersTable)
    .orderBy(desc(ordersTable.createdAt))
    .limit(5);

  const recentRides = await db
    .select()
    .from(ridesTable)
    .orderBy(desc(ridesTable.createdAt))
    .limit(5);

  res.json({
    users: userCount!.count,
    orders: orderCount!.count,
    rides: rideCount!.count,
    pharmacyOrders: pharmCount!.count,
    parcelBookings: parcelCount!.count,
    products: productCount!.count,
    revenue: {
      orders: parseFloat(totalRevenue!.total ?? "0"),
      rides: parseFloat(rideRevenue!.total ?? "0"),
      pharmacy: parseFloat(pharmRevenue!.total ?? "0"),
      total:
        parseFloat(totalRevenue!.total ?? "0") +
        parseFloat(rideRevenue!.total ?? "0") +
        parseFloat(pharmRevenue!.total ?? "0"),
    },
    recentOrders: recentOrders.map(o => ({
      ...o,
      total: parseFloat(String(o.total)),
      createdAt: o.createdAt.toISOString(),
    })),
    recentRides: recentRides.map(r => ({
      ...r,
      fare: parseFloat(r.fare),
      distance: parseFloat(r.distance),
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

/* ── Users ── */
router.get("/users", async (req, res) => {
  const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));
  res.json({
    users: users.map(u => ({
      ...u,
      walletBalance: parseFloat(u.walletBalance ?? "0"),
      createdAt: u.createdAt.toISOString(),
    })),
    total: users.length,
  });
});

router.patch("/users/:id", async (req, res) => {
  const { role, isActive, walletBalance } = req.body;
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (role !== undefined) updates.role = role;
  if (isActive !== undefined) updates.isActive = isActive;
  if (walletBalance !== undefined) updates.walletBalance = String(walletBalance);

  const [user] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, req.params["id"]!))
    .returning();

  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ ...user, walletBalance: parseFloat(user.walletBalance ?? "0") });
});

/* ── All Orders ── */
router.get("/orders", async (req, res) => {
  const { status, type, limit: lim } = req.query;
  let query = db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt)).$dynamic();

  const orders = await query.limit(Number(lim) || 100);
  const filtered = orders
    .filter(o => !status || o.status === status)
    .filter(o => !type || o.type === type);

  res.json({
    orders: filtered.map(o => ({
      ...o,
      total: parseFloat(String(o.total)),
      createdAt: o.createdAt.toISOString(),
    })),
    total: filtered.length,
  });
});

router.patch("/orders/:id/status", async (req, res) => {
  const { status } = req.body;
  const [order] = await db
    .update(ordersTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(ordersTable.id, req.params["id"]!))
    .returning();
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  res.json({ ...order, total: parseFloat(String(order.total)) });
});

/* ── All Rides ── */
router.get("/rides", async (_req, res) => {
  const rides = await db.select().from(ridesTable).orderBy(desc(ridesTable.createdAt)).limit(100);
  res.json({
    rides: rides.map(r => ({
      ...r,
      fare: parseFloat(r.fare),
      distance: parseFloat(r.distance),
      createdAt: r.createdAt.toISOString(),
    })),
    total: rides.length,
  });
});

router.patch("/rides/:id/status", async (req, res) => {
  const { status } = req.body;
  const [ride] = await db
    .update(ridesTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(ridesTable.id, req.params["id"]!))
    .returning();
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }
  res.json({ ...ride, fare: parseFloat(ride.fare) });
});

/* ── Pharmacy Orders ── */
router.get("/pharmacy-orders", async (_req, res) => {
  const orders = await db
    .select()
    .from(pharmacyOrdersTable)
    .orderBy(desc(pharmacyOrdersTable.createdAt))
    .limit(100);
  res.json({
    orders: orders.map(o => ({
      ...o,
      total: parseFloat(o.total),
      createdAt: o.createdAt.toISOString(),
    })),
    total: orders.length,
  });
});

router.patch("/pharmacy-orders/:id/status", async (req, res) => {
  const { status } = req.body;
  const [order] = await db
    .update(pharmacyOrdersTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(pharmacyOrdersTable.id, req.params["id"]!))
    .returning();
  if (!order) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...order, total: parseFloat(order.total) });
});

/* ── Parcel Bookings ── */
router.get("/parcel-bookings", async (_req, res) => {
  const bookings = await db
    .select()
    .from(parcelBookingsTable)
    .orderBy(desc(parcelBookingsTable.createdAt))
    .limit(100);
  res.json({
    bookings: bookings.map(b => ({
      ...b,
      fare: parseFloat(b.fare),
      createdAt: b.createdAt.toISOString(),
    })),
    total: bookings.length,
  });
});

router.patch("/parcel-bookings/:id/status", async (req, res) => {
  const { status } = req.body;
  const [booking] = await db
    .update(parcelBookingsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(parcelBookingsTable.id, req.params["id"]!))
    .returning();
  if (!booking) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...booking, fare: parseFloat(booking.fare) });
});

/* ── Products ── */
router.get("/products", async (_req, res) => {
  const products = await db.select().from(productsTable).orderBy(desc(productsTable.createdAt));
  res.json({
    products: products.map(p => ({
      ...p,
      price: parseFloat(p.price),
      originalPrice: p.originalPrice ? parseFloat(p.originalPrice) : null,
      rating: p.rating ? parseFloat(p.rating) : null,
      createdAt: p.createdAt.toISOString(),
    })),
    total: products.length,
  });
});

router.post("/products", async (req, res) => {
  const { name, description, price, originalPrice, category, type, unit, vendorName, inStock, deliveryTime } = req.body;
  const [product] = await db.insert(productsTable).values({
    id: generateId(),
    name,
    description: description || null,
    price: String(price),
    originalPrice: originalPrice ? String(originalPrice) : null,
    category,
    type: type || "mart",
    vendorId: "ajkmart_system",
    vendorName: vendorName || "AJKMart Store",
    unit: unit || null,
    inStock: inStock !== false,
    deliveryTime: deliveryTime || "30-45 min",
    rating: "4.5",
    reviewCount: 0,
  }).returning();
  res.status(201).json({ ...product!, price: parseFloat(product!.price) });
});

router.patch("/products/:id", async (req, res) => {
  const { name, description, price, originalPrice, category, unit, inStock, vendorName, deliveryTime } = req.body;
  const updates: Partial<typeof productsTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (price !== undefined) updates.price = String(price);
  if (originalPrice !== undefined) updates.originalPrice = originalPrice ? String(originalPrice) : null;
  if (category !== undefined) updates.category = category;
  if (unit !== undefined) updates.unit = unit;
  if (inStock !== undefined) updates.inStock = inStock;
  if (vendorName !== undefined) updates.vendorName = vendorName;
  if (deliveryTime !== undefined) updates.deliveryTime = deliveryTime;

  const [product] = await db
    .update(productsTable)
    .set(updates)
    .where(eq(productsTable.id, req.params["id"]!))
    .returning();
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  res.json({ ...product, price: parseFloat(product.price) });
});

router.delete("/products/:id", async (req, res) => {
  await db.delete(productsTable).where(eq(productsTable.id, req.params["id"]!));
  res.json({ success: true });
});

/* ── Broadcast Notification ── */
router.post("/broadcast", async (req, res) => {
  const { title, body, type = "system", icon = "notifications-outline" } = req.body;
  if (!title || !body) { res.status(400).json({ error: "title and body required" }); return; }

  const users = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.isActive, true));
  let sent = 0;
  for (const user of users) {
    await db.insert(notificationsTable).values({
      id: generateId(),
      userId: user.id,
      title,
      body,
      type,
      icon,
    }).catch(() => {});
    sent++;
  }
  res.json({ success: true, sent });
});

/* ── Wallet Transactions ── */
router.get("/transactions", async (_req, res) => {
  const transactions = await db
    .select()
    .from(walletTransactionsTable)
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(200);
  res.json({
    transactions: transactions.map(t => ({
      ...t,
      amount: parseFloat(t.amount),
      createdAt: t.createdAt.toISOString(),
    })),
    total: transactions.length,
  });
});

export default router;
