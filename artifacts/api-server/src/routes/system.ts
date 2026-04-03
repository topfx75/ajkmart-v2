import { Router, type IRouter } from "express";
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
  flashDealsTable,
  promoCodesTable,
  adminAccountsTable,
  reviewsTable,
  savedAddressesTable,
  userSettingsTable,
  liveLocationsTable,
  systemSnapshotsTable,
} from "@workspace/db/schema";
import { count, lt, eq } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { invalidateSettingsCache } from "../middleware/security.js";
import { adminAuth } from "./admin.js";
import { sendSuccess, sendError, sendNotFound } from "../lib/response.js";

const DEMO_WALLET_BALANCE = "1000";
const UNDO_WINDOW_MS      = 30 * 60 * 1000; // 30 minutes

/* ── Table registry — maps snapshot key → drizzle table ref ── */
const TABLE_MAP: Record<string, any> = {
  users:                usersTable,
  orders:               ordersTable,
  rides:                ridesTable,
  pharmacy_orders:      pharmacyOrdersTable,
  parcel_bookings:      parcelBookingsTable,
  products:             productsTable,
  wallet_transactions:  walletTransactionsTable,
  notifications:        notificationsTable,
  reviews:              reviewsTable,
  promo_codes:          promoCodesTable,
  flash_deals:          flashDealsTable,
  platform_settings:    platformSettingsTable,
  saved_addresses:      savedAddressesTable,
  user_settings:        userSettingsTable,
  live_locations:       liveLocationsTable,
};

const router: IRouter = Router();

/* ── Admin auth guard — uses the same JWT/secret middleware as the rest of admin routes ── */
router.use(adminAuth);

/* ── Auto-purge expired snapshots on every request ── */
router.use(async (_req, _res, next) => {
  try { await db.delete(systemSnapshotsTable).where(lt(systemSnapshotsTable.expiresAt, new Date())); } catch {}
  next();
});

/* ─────────────────────────────────────────────────────────────────────────────
   SNAPSHOT HELPER — serializes specified table rows to a DB snapshot row
───────────────────────────────────────────────────────────────────────────── */
async function snapshotBefore(label: string, actionId: string, tableKeys: string[]) {
  const tables: Record<string, any[]> = {};
  for (const key of tableKeys) {
    const ref = TABLE_MAP[key];
    if (ref) tables[key] = await db.select().from(ref);
  }
  const id        = generateId();
  const expiresAt = new Date(Date.now() + UNDO_WINDOW_MS);
  await db.insert(systemSnapshotsTable).values({
    id,
    label,
    actionId,
    tablesJson: JSON.stringify(tables),
    expiresAt,
  });
  return { snapshotId: id, expiresAt: expiresAt.toISOString() };
}

/* ─────────────────────────────────────────────────────────────────────────────
   RESTORE HELPER — restores rows from a tables map into the DB
───────────────────────────────────────────────────────────────────────────── */
async function restoreTables(tables: Record<string, any[]>) {
  const restored: Record<string, number> = {};
  const errors: string[] = [];

  for (const [key, rows] of Object.entries(tables)) {
    const ref = TABLE_MAP[key];
    if (!ref || !Array.isArray(rows)) continue;
    try {
      await db.delete(ref);
      if (rows.length > 0) {
        const cleaned = rows.map((r: Record<string, unknown>) => {
          const out: Record<string, unknown> = { ...r };
          if (out.createdAt) out.createdAt = new Date(out.createdAt);
          if (out.updatedAt) out.updatedAt = new Date(out.updatedAt);
          if (out.expiresAt) out.expiresAt = new Date(out.expiresAt);
          if (out.otpExpiry) out.otpExpiry = new Date(out.otpExpiry);
          if (out.scheduledFor) out.scheduledFor = new Date(out.scheduledFor);
          return out;
        });
        for (const row of cleaned) {
          try { await db.insert(ref).values(row); } catch {}
        }
      }
      restored[key] = rows.length;
    } catch (e: unknown) {
      errors.push(`${key}: ${(e as Error).message}`);
    }
  }
  return { restored, errors };
}

/* ─────────────────────────────────────────────────────────────────────────────
   DEMO PRODUCT DATA
───────────────────────────────────────────────────────────────────────────── */
const MART_PRODUCTS = [
  { name: "Basmati Rice 5kg",        price: 980,  originalPrice: 1200, category: "fruits",    unit: "5kg bag",    inStock: true,  description: "Premium long-grain basmati rice" },
  { name: "Doodh (Fresh Milk) 1L",   price: 140,  originalPrice: null, category: "dairy",     unit: "1 litre",    inStock: true,  description: "Fresh pasteurized milk" },
  { name: "Anday (Eggs) 12pc",       price: 320,  originalPrice: 350,  category: "dairy",     unit: "12 pieces",  inStock: true,  description: "Farm fresh eggs" },
  { name: "Aata (Wheat Flour) 10kg", price: 1100, originalPrice: 1350, category: "bakery",    unit: "10kg bag",   inStock: true,  description: "Chakki fresh atta" },
  { name: "Desi Ghee 1kg",           price: 1800, originalPrice: 2100, category: "dairy",     unit: "1kg tin",    inStock: true,  description: "Pure desi ghee" },
  { name: "Cooking Oil 5L",          price: 1650, originalPrice: 1900, category: "household", unit: "5 litre",    inStock: true,  description: "Refined sunflower oil" },
  { name: "Pyaz (Onion) 1kg",        price: 80,   originalPrice: 100,  category: "fruits",    unit: "1kg",        inStock: true,  description: "Fresh onions" },
  { name: "Tamatar (Tomato) 1kg",    price: 120,  originalPrice: 150,  category: "fruits",    unit: "1kg",        inStock: true,  description: "Fresh red tomatoes" },
  { name: "Aaloo (Potato) 5kg",      price: 350,  originalPrice: 400,  category: "fruits",    unit: "5kg bag",    inStock: true,  description: "Fresh potatoes" },
  { name: "Zeera (Cumin) 100g",      price: 180,  originalPrice: 220,  category: "spices",    unit: "100g",       inStock: true,  description: "Whole cumin seeds" },
  { name: "Haldi (Turmeric) 200g",   price: 120,  originalPrice: 150,  category: "spices",    unit: "200g",       inStock: true,  description: "Pure turmeric powder" },
  { name: "Dahi (Yogurt) 500g",      price: 130,  originalPrice: null, category: "dairy",     unit: "500g",       inStock: true,  description: "Fresh plain yogurt" },
  { name: "Murgh (Chicken) 1kg",     price: 520,  originalPrice: 600,  category: "meat",      unit: "1kg",        inStock: true,  description: "Fresh broiler chicken" },
  { name: "Gosht (Beef) 1kg",        price: 1100, originalPrice: 1250, category: "meat",      unit: "1kg",        inStock: true,  description: "Fresh beef" },
  { name: "Ketchup Sauce 500g",      price: 180,  originalPrice: 220,  category: "packaged",  unit: "500g",       inStock: true,  description: "Tomato ketchup" },
  { name: "Surf Excel 1kg",          price: 280,  originalPrice: 320,  category: "household", unit: "1kg",        inStock: true,  description: "Washing powder" },
  { name: "Soap Lifebuoy 6pc",       price: 280,  originalPrice: null, category: "household", unit: "6 bars",     inStock: true,  description: "Antibacterial soap" },
  { name: "Tea Tapal 450g",          price: 360,  originalPrice: 420,  category: "beverages", unit: "450g",       inStock: true,  description: "Premium tea dust" },
  { name: "Pepsi 1.5L",             price: 150,  originalPrice: null, category: "beverages", unit: "1.5 litre",  inStock: true,  description: "Cold drink" },
  { name: "Biscuits Parle-G 800g",   price: 220,  originalPrice: 260,  category: "packaged",  unit: "800g",       inStock: true,  description: "Glucose biscuits" },
  { name: "Bread Bran 400g",         price: 90,   originalPrice: null, category: "bakery",    unit: "400g loaf",  inStock: true,  description: "Fresh bran bread" },
  { name: "Shampoo Head&Shoulders",  price: 380,  originalPrice: 450,  category: "household", unit: "200ml",      inStock: true,  description: "Anti-dandruff shampoo" },
  { name: "Lemon 1kg",               price: 160,  originalPrice: 200,  category: "fruits",    unit: "1kg",        inStock: true,  description: "Fresh lemons" },
  { name: "Palak (Spinach) 500g",    price: 60,   originalPrice: null, category: "fruits",    unit: "500g",       inStock: true,  description: "Fresh spinach" },
  { name: "Sugar 1kg",               price: 130,  originalPrice: 155,  category: "bakery",    unit: "1kg",        inStock: true,  description: "Refined white sugar" },
];

const FOOD_PRODUCTS = [
  { name: "Biryani (Full)",        price: 850,  originalPrice: 1000, category: "biryani",  unit: "serves 4",   inStock: true,  description: "Aromatic basmati biryani",          vendorName: "Biryani House AJK",  deliveryTime: "30-40 min", rating: 4.8 },
  { name: "Chicken Karahi",        price: 750,  originalPrice: 900,  category: "desi",     unit: "serves 3-4", inStock: true,  description: "Spicy chicken karahi",               vendorName: "Desi Dhaba",         deliveryTime: "25-35 min", rating: 4.7 },
  { name: "Seekh Kebab Plate",     price: 350,  originalPrice: 450,  category: "bbq",      unit: "6 pieces",   inStock: true,  description: "Juicy seekh kebabs with naan",       vendorName: "BBQ Tonight",        deliveryTime: "20-30 min", rating: 4.6 },
  { name: "Pizza (Large)",         price: 1200, originalPrice: 1450, category: "pizza",    unit: "12 inch",    inStock: true,  description: "Loaded cheese pizza",                vendorName: "Pizza Point",        deliveryTime: "30-45 min", rating: 4.5 },
  { name: "Burger Meal",           price: 480,  originalPrice: 600,  category: "burger",   unit: "meal + fries",inStock: true, description: "Crispy chicken burger with fries",   vendorName: "Burger Palace",      deliveryTime: "20-25 min", rating: 4.4 },
  { name: "Chowmein Noodles",      price: 280,  originalPrice: null, category: "chinese",  unit: "1 plate",    inStock: true,  description: "Stir-fried noodles with veggies",    vendorName: "Golden Dragon",      deliveryTime: "15-25 min", rating: 4.3 },
  { name: "Paratha (4pcs)",        price: 140,  originalPrice: null, category: "breakfast",unit: "4 pieces",   inStock: true,  description: "Crispy aloo paratha with achar",     vendorName: "Breakfast Corner",   deliveryTime: "15-20 min", rating: 4.5 },
  { name: "Halwa Puri",            price: 220,  originalPrice: 280,  category: "breakfast",unit: "1 plate",    inStock: true,  description: "Traditional halwa puri breakfast",   vendorName: "Breakfast Corner",   deliveryTime: "20-30 min", rating: 4.7 },
  { name: "Daal Makhani",          price: 320,  originalPrice: 400,  category: "desi",     unit: "serves 2",   inStock: true,  description: "Slow-cooked black lentils",          vendorName: "Desi Dhaba",         deliveryTime: "25-30 min", rating: 4.6 },
  { name: "Nihari",                price: 650,  originalPrice: 800,  category: "desi",     unit: "serves 2",   inStock: true,  description: "Slow-cooked beef nihari",            vendorName: "Nihari Lovers",      deliveryTime: "30-40 min", rating: 4.9 },
  { name: "Zinger Burger",         price: 380,  originalPrice: 450,  category: "burger",   unit: "1 burger",   inStock: true,  description: "Spicy zinger burger",                vendorName: "Burger Palace",      deliveryTime: "20-25 min", rating: 4.4 },
  { name: "Fruit Chaat",           price: 180,  originalPrice: null, category: "snacks",   unit: "1 bowl",     inStock: true,  description: "Fresh fruit chaat with masala",      vendorName: "Fresh Bites",        deliveryTime: "10-15 min", rating: 4.3 },
  { name: "Lassi (Meethi)",        price: 120,  originalPrice: 150,  category: "beverages",unit: "400ml",      inStock: true,  description: "Sweet mango lassi",                  vendorName: "Fresh Bites",        deliveryTime: "10-15 min", rating: 4.5 },
];

async function reseedProducts(): Promise<{ mart: number; food: number }> {
  await db.delete(productsTable);
  let mart = 0, food = 0;
  for (const p of MART_PRODUCTS) {
    await db.insert(productsTable).values({
      id: generateId(), name: p.name, description: p.description,
      price: p.price.toString(), originalPrice: p.originalPrice ? p.originalPrice.toString() : null,
      category: p.category, type: "mart", vendorId: "ajkmart_system", vendorName: "AJKMart Store",
      unit: p.unit, inStock: p.inStock,
      rating: (3.8 + Math.random() * 1.1).toFixed(1),
      reviewCount: Math.floor(Math.random() * 200) + 10,
    });
    mart++;
  }
  for (const p of FOOD_PRODUCTS) {
    await db.insert(productsTable).values({
      id: generateId(), name: p.name, description: p.description,
      price: p.price.toString(), originalPrice: p.originalPrice ? p.originalPrice.toString() : null,
      category: p.category, type: "food", vendorId: "ajkmart_system", unit: p.unit,
      inStock: p.inStock, rating: (p.rating || 4.5).toString(),
      reviewCount: Math.floor(Math.random() * 500) + 50,
      vendorName: p.vendorName || "Restaurant AJK",
      deliveryTime: p.deliveryTime || "25-35 min",
    });
    food++;
  }
  return { mart, food };
}

/* ═══════════════════════════════════════════════════════════════════════════
   READ ENDPOINTS
═══════════════════════════════════════════════════════════════════════════ */

/* GET /admin/system/stats */
router.get("/stats", async (_req, res) => {
  const [users]         = await db.select({ c: count() }).from(usersTable);
  const [orders]        = await db.select({ c: count() }).from(ordersTable);
  const [rides]         = await db.select({ c: count() }).from(ridesTable);
  const [pharmacy]      = await db.select({ c: count() }).from(pharmacyOrdersTable);
  const [parcel]        = await db.select({ c: count() }).from(parcelBookingsTable);
  const [products]      = await db.select({ c: count() }).from(productsTable);
  const [walletTx]      = await db.select({ c: count() }).from(walletTransactionsTable);
  const [notifications] = await db.select({ c: count() }).from(notificationsTable);
  const [reviews]       = await db.select({ c: count() }).from(reviewsTable);
  const [promos]        = await db.select({ c: count() }).from(promoCodesTable);
  const [flashDeals]    = await db.select({ c: count() }).from(flashDealsTable);
  const [adminAccounts] = await db.select({ c: count() }).from(adminAccountsTable);
  const [settings]      = await db.select({ c: count() }).from(platformSettingsTable);
  const [savedAddr]     = await db.select({ c: count() }).from(savedAddressesTable);

  res.json({
    stats: {
      users:          Number(users?.c  ?? 0),
      orders:         Number(orders?.c ?? 0),
      rides:          Number(rides?.c  ?? 0),
      pharmacy:       Number(pharmacy?.c  ?? 0),
      parcel:         Number(parcel?.c    ?? 0),
      products:       Number(products?.c  ?? 0),
      walletTx:       Number(walletTx?.c  ?? 0),
      notifications:  Number(notifications?.c ?? 0),
      reviews:        Number(reviews?.c   ?? 0),
      promos:         Number(promos?.c    ?? 0),
      flashDeals:     Number(flashDeals?.c ?? 0),
      adminAccounts:  Number(adminAccounts?.c ?? 0),
      settings:       Number(settings?.c  ?? 0),
      savedAddresses: Number(savedAddr?.c ?? 0),
    },
    generatedAt: new Date().toISOString(),
  });
});

/* GET /admin/system/snapshots — list active (non-expired) snapshots */
router.get("/snapshots", async (_req, res) => {
  const rows = await db.select({
    id:        systemSnapshotsTable.id,
    label:     systemSnapshotsTable.label,
    actionId:  systemSnapshotsTable.actionId,
    createdAt: systemSnapshotsTable.createdAt,
    expiresAt: systemSnapshotsTable.expiresAt,
  }).from(systemSnapshotsTable);

  res.json({
    snapshots: rows.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
    })),
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   ACTION ENDPOINTS — each snapshots first, then executes
═══════════════════════════════════════════════════════════════════════════ */

/* POST /admin/system/reset-demo */
router.post("/reset-demo", async (_req, res) => {
  const snap = await snapshotBefore("Reset Demo Content", "reset-demo", [
    "orders", "rides", "pharmacy_orders", "parcel_bookings",
    "wallet_transactions", "reviews", "notifications", "flash_deals",
    "products", "users",
  ]);

  await db.delete(ordersTable);
  await db.delete(ridesTable);
  await db.delete(pharmacyOrdersTable);
  await db.delete(parcelBookingsTable);
  await db.delete(walletTransactionsTable);
  await db.delete(reviewsTable);
  await db.delete(notificationsTable);
  await db.delete(liveLocationsTable);
  await db.delete(flashDealsTable);
  await db.update(usersTable).set({ walletBalance: DEMO_WALLET_BALANCE });
  const { mart, food } = await reseedProducts();

  res.json({
    success: true,
    message: "Demo content reset. Transactional data cleared, products reseeded.",
    reseeded: { mart_products: mart, food_products: food },
    walletReset: `All wallets reset to Rs. ${DEMO_WALLET_BALANCE}`,
    ...snap,
  });
});

/* POST /admin/system/reset-transactional */
router.post("/reset-transactional", async (_req, res) => {
  const snap = await snapshotBefore("Clear Transactional Data", "reset-transactional", [
    "orders", "rides", "pharmacy_orders", "parcel_bookings",
    "wallet_transactions", "reviews", "notifications", "flash_deals",
  ]);

  await db.delete(ordersTable);
  await db.delete(ridesTable);
  await db.delete(pharmacyOrdersTable);
  await db.delete(parcelBookingsTable);
  await db.delete(walletTransactionsTable);
  await db.delete(reviewsTable);
  await db.delete(notificationsTable);
  await db.delete(liveLocationsTable);
  await db.delete(flashDealsTable);

  res.json({
    success: true,
    message: "All transactional data cleared. Users, products and settings preserved.",
    ...snap,
  });
});

/* POST /admin/system/reset-products */
router.post("/reset-products", async (_req, res) => {
  const snap = await snapshotBefore("Reseed Products", "reset-products", ["products"]);
  const { mart, food } = await reseedProducts();
  res.json({
    success: true,
    message: `Products reseeded: ${mart} mart + ${food} food items.`,
    seeded: { mart, food },
    ...snap,
  });
});

/* POST /admin/system/reset-all */
router.post("/reset-all", async (_req, res) => {
  const snap = await snapshotBefore("Full Database Reset", "reset-all", [
    "users", "orders", "rides", "pharmacy_orders", "parcel_bookings",
    "wallet_transactions", "reviews", "notifications", "flash_deals",
    "promo_codes", "saved_addresses", "user_settings", "products",
  ]);

  await db.delete(ordersTable);
  await db.delete(ridesTable);
  await db.delete(pharmacyOrdersTable);
  await db.delete(parcelBookingsTable);
  await db.delete(walletTransactionsTable);
  await db.delete(reviewsTable);
  await db.delete(notificationsTable);
  await db.delete(liveLocationsTable);
  await db.delete(flashDealsTable);
  await db.delete(promoCodesTable);
  await db.delete(savedAddressesTable);
  await db.delete(userSettingsTable);
  await db.delete(usersTable);
  const { mart, food } = await reseedProducts();

  res.json({
    success: true,
    message: "Full database reset complete. Platform settings and admin accounts preserved.",
    preserved: ["platform_settings", "admin_accounts"],
    reseeded: { mart_products: mart, food_products: food },
    ...snap,
  });
});

/* POST /admin/system/reset-settings */
router.post("/reset-settings", async (_req, res) => {
  const snap = await snapshotBefore("Reset Platform Settings", "reset-settings", ["platform_settings"]);
  await db.delete(platformSettingsTable);
  invalidateSettingsCache();
  res.json({
    success: true,
    message: "All platform settings deleted. Settings will be reseeded to defaults on next admin panel visit.",
    ...snap,
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   UNDO ENDPOINT
═══════════════════════════════════════════════════════════════════════════ */

/* POST /admin/system/undo/:id */
router.post("/undo/:id", async (req, res) => {
  const { id } = req.params;
  const [snapshot] = await db.select().from(systemSnapshotsTable).where(eq(systemSnapshotsTable.id, id));

  if (!snapshot) {
    res.status(404).json({ error: "Snapshot not found. It may have already expired or been dismissed." });
    return;
  }
  if (new Date() > snapshot.expiresAt) {
    await db.delete(systemSnapshotsTable).where(eq(systemSnapshotsTable.id, id));
    res.status(410).json({ error: "Undo window has expired. This action is now permanent." });
    return;
  }

  let tables: Record<string, any[]>;
  try {
    tables = JSON.parse(snapshot.tablesJson);
  } catch {
    res.status(500).json({ error: "Snapshot data is corrupted." });
    return;
  }

  const { restored, errors } = await restoreTables(tables);

  if (snapshot.actionId === "reset-settings") {
    invalidateSettingsCache();
  }

  await db.delete(systemSnapshotsTable).where(eq(systemSnapshotsTable.id, id));

  res.json({
    success: errors.length === 0,
    message: errors.length === 0
      ? `Undo complete. "${snapshot.label}" has been reversed.`
      : `Undo completed with ${errors.length} error(s).`,
    restored,
    errors: errors.length > 0 ? errors : undefined,
  });
});

/* DELETE /admin/system/snapshots/:id — dismiss (discard undo without restoring) */
router.delete("/snapshots/:id", async (req, res) => {
  const { id } = req.params;
  await db.delete(systemSnapshotsTable).where(eq(systemSnapshotsTable.id, id));
  res.json({ success: true, message: "Snapshot dismissed. The action is now permanent." });
});

/* ═══════════════════════════════════════════════════════════════════════════
   BACKUP / RESTORE
═══════════════════════════════════════════════════════════════════════════ */

/* GET /admin/system/backup */
router.get("/backup", async (_req, res) => {
  const [
    users, orders, rides, pharmacy, parcel, products,
    walletTx, notifications, reviews, promos, flashDeals,
    settings, savedAddr, userSettings,
  ] = await Promise.all([
    db.select().from(usersTable),
    db.select().from(ordersTable),
    db.select().from(ridesTable),
    db.select().from(pharmacyOrdersTable),
    db.select().from(parcelBookingsTable),
    db.select().from(productsTable),
    db.select().from(walletTransactionsTable),
    db.select().from(notificationsTable),
    db.select().from(reviewsTable),
    db.select().from(promoCodesTable),
    db.select().from(flashDealsTable),
    db.select().from(platformSettingsTable),
    db.select().from(savedAddressesTable),
    db.select().from(userSettingsTable),
  ]);

  const backup = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    platform: "AJKMart",
    tables: {
      users:               users.map(u => ({ ...u, otpCode: undefined, otpExpiry: undefined })),
      orders,              rides,
      pharmacy_orders:     pharmacy,
      parcel_bookings:     parcel,
      products,
      wallet_transactions: walletTx,
      notifications,       reviews,
      promo_codes:         promos,
      flash_deals:         flashDeals,
      platform_settings:   settings,
      saved_addresses:     savedAddr,
      user_settings:       userSettings,
    },
    counts: {
      users: users.length, orders: orders.length, rides: rides.length,
      pharmacy_orders: pharmacy.length, parcel_bookings: parcel.length,
      products: products.length, wallet_transactions: walletTx.length,
      notifications: notifications.length, reviews: reviews.length,
      promo_codes: promos.length, flash_deals: flashDeals.length,
      platform_settings: settings.length, saved_addresses: savedAddr.length,
      user_settings: userSettings.length,
    },
  };

  const filename = `ajkmart-backup-${new Date().toISOString().split("T")[0]}.json`;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.json(backup);
});

/* POST /admin/system/restore */
router.post("/restore", async (req, res) => {
  const body = req.body as any;
  if (!body?.tables) {
    res.status(400).json({ error: "Invalid backup format. Expected { tables: { ... } }." });
    return;
  }

  const snap = await snapshotBefore("Import Restore", "restore", Object.keys(TABLE_MAP));
  const { restored, errors } = await restoreTables(body.tables);

  res.json({
    success: errors.length === 0,
    message: errors.length === 0
      ? "Database restored successfully from backup."
      : `Restore completed with ${errors.length} error(s).`,
    restored,
    errors: errors.length > 0 ? errors : undefined,
    ...snap,
  });
});

export default router;
