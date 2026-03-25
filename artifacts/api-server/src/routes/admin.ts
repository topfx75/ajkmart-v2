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
  platformSettingsTable,
} from "@workspace/db/schema";
import { eq, desc, count, sum } from "drizzle-orm";
import { generateId } from "../lib/id.js";

/* ── Default Platform Settings ── */
export const DEFAULT_PLATFORM_SETTINGS = [
  /* Delivery */
  { key: "delivery_fee_mart",      value: "80",   label: "Mart Delivery Fee (Rs.)",       category: "delivery" },
  { key: "delivery_fee_food",      value: "60",   label: "Food Delivery Fee (Rs.)",        category: "delivery" },
  { key: "delivery_fee_pharmacy",  value: "50",   label: "Pharmacy Delivery Fee (Rs.)",    category: "delivery" },
  { key: "delivery_fee_parcel",    value: "100",  label: "Parcel Base Delivery Fee (Rs.)", category: "delivery" },
  { key: "free_delivery_above",    value: "1000", label: "Free Delivery Above (Rs.)",      category: "delivery" },
  /* Rides */
  { key: "ride_bike_base_fare",    value: "15",   label: "Bike Base Fare (Rs.)",           category: "rides" },
  { key: "ride_bike_per_km",       value: "8",    label: "Bike Per KM Rate (Rs.)",         category: "rides" },
  { key: "ride_car_base_fare",     value: "25",   label: "Car Base Fare (Rs.)",            category: "rides" },
  { key: "ride_car_per_km",        value: "12",   label: "Car Per KM Rate (Rs.)",          category: "rides" },
  /* Finance */
  { key: "platform_commission_pct",value: "10",   label: "Platform Commission (%)",        category: "finance" },
  /* Orders */
  { key: "min_order_amount",       value: "100",  label: "Minimum Order Amount (Rs.)",     category: "orders" },
  { key: "max_cod_amount",         value: "5000", label: "Max COD Order Amount (Rs.)",     category: "orders" },
  /* General */
  { key: "app_name",               value: "AJKMart", label: "App Name",                   category: "general" },
  { key: "support_phone",          value: "03001234567", label: "Support Phone Number",    category: "general" },
  { key: "app_status",             value: "active", label: "App Status (active/maintenance)", category: "general" },
  /* Customer Role Settings */
  { key: "customer_wallet_max",    value: "50000", label: "Max Wallet Balance (Rs.)",      category: "customer" },
  { key: "customer_min_topup",     value: "100",   label: "Min Wallet Top-Up (Rs.)",       category: "customer" },
  { key: "customer_min_withdrawal",value: "200",   label: "Min Wallet Withdrawal (Rs.)",   category: "customer" },
  { key: "customer_referral_bonus",value: "100",   label: "Referral Bonus (Rs.)",          category: "customer" },
  { key: "customer_loyalty_pts",   value: "5",     label: "Loyalty Points Per Rs.100",     category: "customer" },
  { key: "customer_max_orders_day",value: "10",    label: "Max Orders Per Day",            category: "customer" },
  /* Rider Role Settings */
  { key: "rider_keep_pct",         value: "80",    label: "Rider Earnings % (of fare)",    category: "rider" },
  { key: "rider_acceptance_km",    value: "5",     label: "Acceptance Radius (KM)",        category: "rider" },
  { key: "rider_max_deliveries",   value: "3",     label: "Max Active Deliveries",         category: "rider" },
  { key: "rider_bonus_per_trip",   value: "0",     label: "Bonus Per Trip (Rs.)",          category: "rider" },
  { key: "rider_min_payout",       value: "500",   label: "Minimum Payout (Rs.)",          category: "rider" },
  { key: "rider_cash_allowed",     value: "on",    label: "Allow Cash Payments",           category: "rider" },
  /* Vendor Role Settings */
  { key: "vendor_commission_pct",  value: "15",    label: "Vendor Platform Commission (%)",category: "vendor" },
  { key: "vendor_min_order",       value: "100",   label: "Vendor Minimum Order (Rs.)",    category: "vendor" },
  { key: "vendor_max_items",       value: "100",   label: "Max Menu Items Per Vendor",     category: "vendor" },
  { key: "vendor_settlement_days", value: "7",     label: "Payout Settlement Days",        category: "vendor" },
  { key: "vendor_auto_approve",    value: "off",   label: "Auto-Approve New Vendors",      category: "vendor" },
  /* App Feature Toggles */
  { key: "feature_mart",           value: "on",    label: "Mart (Grocery) Service",        category: "features" },
  { key: "feature_food",           value: "on",    label: "Food Delivery Service",         category: "features" },
  { key: "feature_rides",          value: "on",    label: "Taxi & Bike Booking",           category: "features" },
  { key: "feature_pharmacy",       value: "on",    label: "Pharmacy Service",              category: "features" },
  { key: "feature_parcel",         value: "on",    label: "Parcel Delivery Service",       category: "features" },
  { key: "feature_wallet",         value: "on",    label: "Digital Wallet",                category: "features" },
  { key: "feature_referral",       value: "on",    label: "Referral Program",              category: "features" },
  { key: "feature_new_users",      value: "on",    label: "New User Registration",         category: "features" },
];

export async function getPlatformSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(platformSettingsTable);
  if (rows.length === 0) {
    await db.insert(platformSettingsTable).values(DEFAULT_PLATFORM_SETTINGS).onConflictDoNothing();
    return Object.fromEntries(DEFAULT_PLATFORM_SETTINGS.map(s => [s.key, s.value]));
  }
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

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

/* ── helpers ── */
async function sendUserNotification(userId: string, title: string, body: string, type: string, icon: string) {
  await db.insert(notificationsTable).values({
    id: generateId(),
    userId,
    title,
    body,
    type,
    icon,
  }).catch(() => {});
}

const ORDER_NOTIFICATIONS: Record<string, { title: string; body: string; icon: string }> = {
  confirmed:         { title: "Order Confirmed! ✅", body: "Your order has been confirmed and is being prepared.", icon: "checkmark-circle-outline" },
  preparing:         { title: "Order Being Prepared 🍳", body: "The vendor is now preparing your order.", icon: "restaurant-outline" },
  out_for_delivery:  { title: "On the Way! 🚴", body: "Your order is out for delivery. Track your rider.", icon: "bicycle-outline" },
  delivered:         { title: "Order Delivered! 🎉", body: "Your order has been delivered. Enjoy!", icon: "bag-check-outline" },
  cancelled:         { title: "Order Cancelled ❌", body: "Your order has been cancelled by the store.", icon: "close-circle-outline" },
};

const RIDE_NOTIFICATIONS: Record<string, { title: string; body: string; icon: string }> = {
  accepted:    { title: "Driver Found! 🚗", body: "A driver has accepted your ride. They are on the way.", icon: "car-outline" },
  arrived:     { title: "Driver Arrived! 📍", body: "Your driver has arrived at the pickup location.", icon: "location-outline" },
  in_transit:  { title: "Ride Started 🛣️", body: "Your ride is now in progress. Sit back and relax.", icon: "navigate-outline" },
  completed:   { title: "Ride Completed! ⭐", body: "Your ride has been completed. Thanks for choosing AJKMart!", icon: "star-outline" },
  cancelled:   { title: "Ride Cancelled ❌", body: "Your ride has been cancelled.", icon: "close-circle-outline" },
};

const PHARMACY_NOTIFICATIONS: Record<string, { title: string; body: string; icon: string }> = {
  confirmed:        { title: "Pharmacy Order Confirmed ✅", body: "Your medicine order has been confirmed.", icon: "checkmark-circle-outline" },
  preparing:        { title: "Medicines Being Packed 💊", body: "Your medicines are being prepared for delivery.", icon: "medical-outline" },
  out_for_delivery: { title: "Medicines On the Way! 🚴", body: "Your medicines are out for delivery.", icon: "bicycle-outline" },
  delivered:        { title: "Medicines Delivered! 💊", body: "Your pharmacy order has been delivered.", icon: "bag-check-outline" },
  cancelled:        { title: "Order Cancelled ❌", body: "Your pharmacy order has been cancelled.", icon: "close-circle-outline" },
};

const PARCEL_NOTIFICATIONS: Record<string, { title: string; body: string; icon: string }> = {
  accepted:    { title: "Rider Assigned! 📦", body: "A rider has been assigned to deliver your parcel.", icon: "person-outline" },
  in_transit:  { title: "Parcel In Transit 🚚", body: "Your parcel is on the way to the destination.", icon: "cube-outline" },
  completed:   { title: "Parcel Delivered! ✅", body: "Your parcel has been delivered successfully.", icon: "checkmark-circle-outline" },
  cancelled:   { title: "Booking Cancelled ❌", body: "Your parcel booking has been cancelled.", icon: "close-circle-outline" },
};

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
      updatedAt: o.updatedAt.toISOString(),
    })),
    recentRides: recentRides.map(r => ({
      ...r,
      fare: parseFloat(r.fare),
      distance: parseFloat(r.distance),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
});

/* ── Users ── */
router.get("/users", async (_req, res) => {
  const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));
  res.json({
    users: users.map(u => ({
      ...u,
      walletBalance: parseFloat(u.walletBalance ?? "0"),
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
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
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(usersTable.id, req.params["id"]!))
    .returning();

  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ ...user, walletBalance: parseFloat(user.walletBalance ?? "0") });
});

/* ── Wallet Top-up ── */
router.post("/users/:id/wallet-topup", async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ error: "Valid amount is required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.params["id"]!));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const currentBalance = parseFloat(user.walletBalance ?? "0");
  const newBalance = currentBalance + Number(amount);

  const [updatedUser] = await db
    .update(usersTable)
    .set({ walletBalance: String(newBalance), updatedAt: new Date() })
    .where(eq(usersTable.id, req.params["id"]!))
    .returning();

  await db.insert(walletTransactionsTable).values({
    id: generateId(),
    userId: req.params["id"]!,
    type: "credit",
    amount: String(amount),
    description: description || `Admin top-up: Rs. ${amount}`,
    reference: "admin_topup",
  });

  await sendUserNotification(
    req.params["id"]!,
    "Wallet Topped Up! 💰",
    `Rs. ${amount} has been added to your AJKMart wallet.`,
    "system",
    "wallet-outline"
  );

  res.json({
    success: true,
    newBalance,
    user: { ...updatedUser!, walletBalance: newBalance },
  });
});

/* ── All Orders ── */
router.get("/orders", async (req, res) => {
  const { status, type, limit: lim } = req.query;
  const orders = await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt)).limit(Number(lim) || 200);

  const filtered = orders
    .filter(o => !status || o.status === status)
    .filter(o => !type || o.type === type);

  res.json({
    orders: filtered.map(o => ({
      ...o,
      total: parseFloat(String(o.total)),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
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

  const notif = ORDER_NOTIFICATIONS[status];
  if (notif) {
    await sendUserNotification(order.userId, notif.title, notif.body, "mart", notif.icon);
  }

  if (status === "delivered") {
    const total = parseFloat(String(order.total));
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, order.userId));
    if (user && order.paymentMethod === "wallet") {
      const newBal = Math.max(0, parseFloat(user.walletBalance ?? "0") - total);
      await db.update(usersTable).set({ walletBalance: String(newBal), updatedAt: new Date() }).where(eq(usersTable.id, user.id));
      await db.insert(walletTransactionsTable).values({
        id: generateId(), userId: user.id, type: "debit",
        amount: String(total), description: `Order payment #${order.id.slice(-6).toUpperCase()}`, reference: order.id,
      });
    }
  }

  res.json({ ...order, total: parseFloat(String(order.total)) });
});

/* ── All Rides ── */
router.get("/rides", async (_req, res) => {
  const rides = await db.select().from(ridesTable).orderBy(desc(ridesTable.createdAt)).limit(200);
  res.json({
    rides: rides.map(r => ({
      ...r,
      fare: parseFloat(r.fare),
      distance: parseFloat(r.distance),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    total: rides.length,
  });
});

router.patch("/rides/:id/status", async (req, res) => {
  const { status, riderName, riderPhone } = req.body;
  const updateData: any = { status, updatedAt: new Date() };
  if (riderName) updateData.riderName = riderName;
  if (riderPhone) updateData.riderPhone = riderPhone;

  const [ride] = await db
    .update(ridesTable)
    .set(updateData)
    .where(eq(ridesTable.id, req.params["id"]!))
    .returning();
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }

  const notif = RIDE_NOTIFICATIONS[status];
  if (notif) {
    await sendUserNotification(ride.userId, notif.title, notif.body, "ride", notif.icon);
  }

  if (status === "completed") {
    const fare = parseFloat(ride.fare);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, ride.userId));
    if (user && ride.paymentMethod === "wallet") {
      const newBal = Math.max(0, parseFloat(user.walletBalance ?? "0") - fare);
      await db.update(usersTable).set({ walletBalance: String(newBal), updatedAt: new Date() }).where(eq(usersTable.id, user.id));
      await db.insert(walletTransactionsTable).values({
        id: generateId(), userId: user.id, type: "debit",
        amount: String(fare), description: `Ride payment #${ride.id.slice(-6).toUpperCase()}`, reference: ride.id,
      });
    }
  }

  res.json({ ...ride, fare: parseFloat(ride.fare), distance: parseFloat(ride.distance) });
});

/* ── Pharmacy Orders ── */
router.get("/pharmacy-orders", async (_req, res) => {
  const orders = await db
    .select()
    .from(pharmacyOrdersTable)
    .orderBy(desc(pharmacyOrdersTable.createdAt))
    .limit(200);
  res.json({
    orders: orders.map(o => ({
      ...o,
      total: parseFloat(o.total),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
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

  const notif = PHARMACY_NOTIFICATIONS[status];
  if (notif) {
    await sendUserNotification(order.userId, notif.title, notif.body, "pharmacy", notif.icon);
  }

  res.json({ ...order, total: parseFloat(order.total) });
});

/* ── Parcel Bookings ── */
router.get("/parcel-bookings", async (_req, res) => {
  const bookings = await db
    .select()
    .from(parcelBookingsTable)
    .orderBy(desc(parcelBookingsTable.createdAt))
    .limit(200);
  res.json({
    bookings: bookings.map(b => ({
      ...b,
      fare: parseFloat(b.fare),
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
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

  const notif = PARCEL_NOTIFICATIONS[status];
  if (notif) {
    await sendUserNotification(booking.userId, notif.title, notif.body, "parcel", notif.icon);
  }

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
  const { name, description, price, originalPrice, category, type, unit, vendorName, inStock, deliveryTime, image } = req.body;
  if (!name || !price || !category) {
    res.status(400).json({ error: "name, price, and category are required" });
    return;
  }
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
    image: image || null,
  }).returning();
  res.status(201).json({ ...product!, price: parseFloat(product!.price) });
});

router.patch("/products/:id", async (req, res) => {
  const { name, description, price, originalPrice, category, unit, inStock, vendorName, deliveryTime, image } = req.body;
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
  if (image !== undefined) updates.image = image;

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

  const totalCredit = transactions.filter(t => t.type === "credit").reduce((s, t) => s + parseFloat(t.amount), 0);
  const totalDebit = transactions.filter(t => t.type === "debit").reduce((s, t) => s + parseFloat(t.amount), 0);

  res.json({
    transactions: transactions.map(t => ({
      ...t,
      amount: parseFloat(t.amount),
      createdAt: t.createdAt.toISOString(),
    })),
    total: transactions.length,
    totalCredit,
    totalDebit,
  });
});

/* ── Platform Settings ── */
router.get("/platform-settings", async (_req, res) => {
  let rows = await db.select().from(platformSettingsTable);
  if (rows.length === 0) {
    await db.insert(platformSettingsTable).values(DEFAULT_PLATFORM_SETTINGS).onConflictDoNothing();
    rows = await db.select().from(platformSettingsTable);
  }
  const grouped: Record<string, any[]> = {};
  for (const row of rows) {
    if (!grouped[row.category]) grouped[row.category] = [];
    grouped[row.category]!.push({ key: row.key, value: row.value, label: row.label, updatedAt: row.updatedAt.toISOString() });
  }
  res.json({ settings: rows.map(r => ({ ...r, updatedAt: r.updatedAt.toISOString() })), grouped });
});

router.put("/platform-settings", async (req, res) => {
  const { settings } = req.body as { settings: Array<{ key: string; value: string }> };
  if (!Array.isArray(settings)) { res.status(400).json({ error: "settings array required" }); return; }
  for (const { key, value } of settings) {
    await db
      .update(platformSettingsTable)
      .set({ value: String(value), updatedAt: new Date() })
      .where(eq(platformSettingsTable.key, key));
  }
  const rows = await db.select().from(platformSettingsTable);
  res.json({ success: true, settings: rows.map(r => ({ ...r, updatedAt: r.updatedAt.toISOString() })) });
});

router.patch("/platform-settings/:key", async (req, res) => {
  const { value } = req.body;
  const [row] = await db
    .update(platformSettingsTable)
    .set({ value: String(value), updatedAt: new Date() })
    .where(eq(platformSettingsTable.key, req.params["key"]!))
    .returning();
  if (!row) { res.status(404).json({ error: "Setting not found" }); return; }
  res.json({ ...row, updatedAt: row.updatedAt.toISOString() });
});

/* ── Pharmacy Orders Enriched ── */
router.get("/pharmacy-enriched", async (_req, res) => {
  const orders = await db.select().from(pharmacyOrdersTable).orderBy(desc(pharmacyOrdersTable.createdAt)).limit(200);
  const users = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone }).from(usersTable);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  res.json({
    orders: orders.map(o => ({
      ...o,
      total: parseFloat(String(o.total)),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
      userName: userMap[o.userId]?.name || null,
      userPhone: userMap[o.userId]?.phone || null,
    })),
    total: orders.length,
  });
});

/* ── Parcel Bookings Enriched ── */
router.get("/parcel-enriched", async (_req, res) => {
  const bookings = await db.select().from(parcelBookingsTable).orderBy(desc(parcelBookingsTable.createdAt)).limit(200);
  const users = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone }).from(usersTable);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  res.json({
    bookings: bookings.map(b => ({
      ...b,
      fare: parseFloat(b.fare),
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
      userName: userMap[b.userId]?.name || null,
      userPhone: userMap[b.userId]?.phone || null,
    })),
    total: bookings.length,
  });
});

/* ── Transactions Enriched ── */
router.get("/transactions-enriched", async (_req, res) => {
  const transactions = await db.select().from(walletTransactionsTable).orderBy(desc(walletTransactionsTable.createdAt)).limit(300);
  const users = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone }).from(usersTable);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));

  const enriched = transactions.map(t => ({
    ...t,
    amount: parseFloat(t.amount),
    createdAt: t.createdAt.toISOString(),
    userName: userMap[t.userId]?.name || null,
    userPhone: userMap[t.userId]?.phone || null,
  }));

  const totalCredit = enriched.filter(t => t.type === "credit").reduce((s, t) => s + t.amount, 0);
  const totalDebit = enriched.filter(t => t.type === "debit").reduce((s, t) => s + t.amount, 0);

  res.json({ transactions: enriched, total: transactions.length, totalCredit, totalDebit });
});

/* ── Delete User ── */
router.delete("/users/:id", async (req, res) => {
  await db.delete(usersTable).where(eq(usersTable.id, req.params["id"]!));
  res.json({ success: true });
});

/* ── User Activity (orders + rides summary) ── */
router.get("/users/:id/activity", async (req, res) => {
  const uid = req.params["id"]!;
  const orders = await db.select().from(ordersTable).where(eq(ordersTable.userId, uid)).orderBy(desc(ordersTable.createdAt)).limit(10);
  const rides = await db.select().from(ridesTable).where(eq(ridesTable.userId, uid)).orderBy(desc(ridesTable.createdAt)).limit(10);
  const pharmacy = await db.select().from(pharmacyOrdersTable).where(eq(pharmacyOrdersTable.userId, uid)).orderBy(desc(pharmacyOrdersTable.createdAt)).limit(5);
  const parcels = await db.select().from(parcelBookingsTable).where(eq(parcelBookingsTable.userId, uid)).orderBy(desc(parcelBookingsTable.createdAt)).limit(5);
  const txns = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.userId, uid)).orderBy(desc(walletTransactionsTable.createdAt)).limit(10);
  res.json({
    orders: orders.map(o => ({ ...o, total: parseFloat(String(o.total)), createdAt: o.createdAt.toISOString(), updatedAt: o.updatedAt.toISOString() })),
    rides: rides.map(r => ({ ...r, fare: parseFloat(r.fare), distance: parseFloat(r.distance), createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })),
    pharmacy: pharmacy.map(p => ({ ...p, total: parseFloat(String(p.total)), createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() })),
    parcels: parcels.map(p => ({ ...p, fare: parseFloat(p.fare), createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() })),
    transactions: txns.map(t => ({ ...t, amount: parseFloat(t.amount), createdAt: t.createdAt.toISOString() })),
  });
});

/* ── Overview with user enrichment (orders + user info) ── */
router.get("/orders-enriched", async (_req, res) => {
  const orders = await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt)).limit(200);
  const users = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone }).from(usersTable);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  res.json({
    orders: orders.map(o => ({
      ...o,
      total: parseFloat(String(o.total)),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
      userName: userMap[o.userId]?.name || null,
      userPhone: userMap[o.userId]?.phone || null,
    })),
    total: orders.length,
  });
});

router.get("/rides-enriched", async (_req, res) => {
  const rides = await db.select().from(ridesTable).orderBy(desc(ridesTable.createdAt)).limit(200);
  const users = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone }).from(usersTable);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  res.json({
    rides: rides.map(r => ({
      ...r,
      fare: parseFloat(r.fare),
      distance: parseFloat(r.distance),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      userName: userMap[r.userId]?.name || null,
      userPhone: userMap[r.userId]?.phone || null,
    })),
    total: rides.length,
  });
});

export default router;
