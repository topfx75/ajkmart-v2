import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable, ordersTable, productsTable, promoCodesTable, walletTransactionsTable, notificationsTable } from "@workspace/db/schema";
import { eq, desc, and, sql, count, sum, gte, or, ilike, isNull } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getPlatformSettings } from "./admin.js";
import { verifyUserJwt, writeAuthAuditLog, getClientIp } from "../middleware/security.js";

const router: IRouter = Router();

/* ── Auth Middleware ── */
async function vendorAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  const tokenHeader = req.headers["x-auth-token"] as string | undefined;
  const raw = tokenHeader || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
  const ip = getClientIp(req);

  if (!raw) { res.status(401).json({ error: "Authentication required" }); return; }

  const payload = verifyUserJwt(raw);
  if (!payload) {
    writeAuthAuditLog("auth_denied_invalid_token", { ip, metadata: { url: req.url, role: "vendor" } });
    res.status(401).json({ error: "Invalid or expired session. Please log in again." }); return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }
  if (!user.isActive) {
    writeAuthAuditLog("auth_denied_inactive", { userId: user.id, ip, metadata: { url: req.url, role: "vendor" } });
    res.status(403).json({ error: "Account suspended by admin" }); return;
  }
  if (user.isBanned) {
    writeAuthAuditLog("auth_denied_banned", { userId: user.id, ip, metadata: { url: req.url, role: "vendor" } });
    res.status(403).json({ error: "Account is banned" }); return;
  }

  /* Token version check — invalidates access JWTs on logout/ban/role change */
  if (typeof payload.tokenVersion === "number" && payload.tokenVersion !== (user.tokenVersion ?? 0)) {
    writeAuthAuditLog("auth_denied_token_revoked", { userId: user.id, ip, metadata: { url: req.url, role: "vendor" } });
    res.status(401).json({ error: "Session revoked. Please log in again." }); return;
  }

  /* Enforce vendor role from the authoritative DB field */
  const dbRoles = (user.roles || user.role || "").split(",").map((r: string) => r.trim());
  if (!dbRoles.includes("vendor")) {
    writeAuthAuditLog("auth_denied_role", { userId: user.id, ip, metadata: { required: "vendor", actual: user.roles, url: req.url } });
    res.status(403).json({ error: "Access denied. Vendor role required." }); return;
  }

  req.vendorId = user.id;
  req.vendorUser = user;
  next();
}
router.use(vendorAuth);

function safeNum(v: any, def = 0) { return parseFloat(String(v ?? def)) || def; }
function formatUser(user: any) {
  return {
    id: user.id, phone: user.phone, name: user.name, email: user.email,
    avatar: user.avatar,
    storeName: user.storeName, storeCategory: user.storeCategory,
    storeBanner: user.storeBanner, storeDescription: user.storeDescription,
    storeHours: user.storeHours ? (typeof user.storeHours === "string" ? (() => { try { return JSON.parse(user.storeHours); } catch { return null; } })() : user.storeHours) : null,
    storeAnnouncement: user.storeAnnouncement,
    storeMinOrder: safeNum(user.storeMinOrder),
    storeDeliveryTime: user.storeDeliveryTime,
    storeIsOpen: user.storeIsOpen ?? true,
    walletBalance: safeNum(user.walletBalance),
    // Extended profile
    cnic: user.cnic, address: user.address, city: user.city,
    bankName: user.bankName, bankAccount: user.bankAccount, bankAccountTitle: user.bankAccountTitle,
    businessType: user.businessType,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

/* ── GET /vendor/me ── */
router.get("/me", async (req, res) => {
  const user = req.vendorUser!;
  const vendorId = user.id;
  const today = new Date(); today.setHours(0,0,0,0);

  const s = await getPlatformSettings();
  const vendorShare = 1 - (parseFloat(s["vendor_commission_pct"] ?? "15") / 100);

  const [todayOrders, todayRev, totalOrders, totalRev] = await Promise.all([
    db.select({ c: count() }).from(ordersTable).where(and(eq(ordersTable.vendorId, vendorId), gte(ordersTable.createdAt, today))),
    db.select({ s: sum(ordersTable.total) }).from(ordersTable).where(and(eq(ordersTable.vendorId, vendorId), gte(ordersTable.createdAt, today), or(eq(ordersTable.status, "delivered"), eq(ordersTable.status, "completed")))),
    db.select({ c: count() }).from(ordersTable).where(eq(ordersTable.vendorId, vendorId)),
    db.select({ s: sum(ordersTable.total) }).from(ordersTable).where(and(eq(ordersTable.vendorId, vendorId), or(eq(ordersTable.status, "delivered"), eq(ordersTable.status, "completed")))),
  ]);
  res.json({
    ...formatUser(user),
    stats: {
      todayOrders:  todayOrders[0]?.c ?? 0,
      todayRevenue: parseFloat((safeNum(todayRev[0]?.s) * vendorShare).toFixed(2)),
      totalOrders:  totalOrders[0]?.c ?? 0,
      totalRevenue: parseFloat((safeNum(totalRev[0]?.s) * vendorShare).toFixed(2)),
    },
  });
});

/* ── PATCH /vendor/profile ── */
router.patch("/profile", async (req, res) => {
  const vendorId = req.vendorId!;
  const { name, email, cnic, address, city, bankName, bankAccount, bankAccountTitle, businessType } = req.body;
  const updates: any = { updatedAt: new Date() };
  if (name             !== undefined) updates.name             = name;
  if (email            !== undefined) updates.email            = email;
  if (cnic             !== undefined) updates.cnic             = cnic;
  if (address          !== undefined) updates.address          = address;
  if (city             !== undefined) updates.city             = city;
  if (bankName         !== undefined) updates.bankName         = bankName;
  if (bankAccount      !== undefined) updates.bankAccount      = bankAccount;
  if (bankAccountTitle !== undefined) updates.bankAccountTitle = bankAccountTitle;
  if (businessType     !== undefined) updates.businessType     = businessType;
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, vendorId)).returning();
  res.json(formatUser(user));
});

/* ── GET /vendor/store ── */
router.get("/store", async (req, res) => {
  const user = req.vendorUser!;
  res.json(formatUser(user));
});

/* ── PATCH /vendor/store ── */
router.patch("/store", async (req, res) => {
  const vendorId = req.vendorId!;
  const body = req.body;
  const updates: any = { updatedAt: new Date() };
  const fields = ["storeName","storeCategory","storeBanner","storeDescription","storeAnnouncement","storeDeliveryTime","storeIsOpen","storeMinOrder"];
  for (const f of fields) {
    if (body[f] !== undefined) updates[f] = body[f];
  }
  if (body.storeHours !== undefined) updates.storeHours = typeof body.storeHours === "string" ? body.storeHours : JSON.stringify(body.storeHours);
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, vendorId)).returning();
  res.json(formatUser(user));
});

/* ── GET /vendor/stats ── */
router.get("/stats", async (req, res) => {
  const vendorId = req.vendorId!;
  const today = new Date(); today.setHours(0,0,0,0);
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(today); monthAgo.setDate(monthAgo.getDate() - 30);

  const s = await getPlatformSettings();
  const vendorShare = 1 - (parseFloat(s["vendor_commission_pct"] ?? "15") / 100);

  const [tData, wData, mData, pending, lowStock] = await Promise.all([
    db.select({ c: count(), s: sum(ordersTable.total) }).from(ordersTable).where(and(eq(ordersTable.vendorId, vendorId), gte(ordersTable.createdAt, today))),
    db.select({ c: count(), s: sum(ordersTable.total) }).from(ordersTable).where(and(eq(ordersTable.vendorId, vendorId), gte(ordersTable.createdAt, weekAgo))),
    db.select({ c: count(), s: sum(ordersTable.total) }).from(ordersTable).where(and(eq(ordersTable.vendorId, vendorId), gte(ordersTable.createdAt, monthAgo))),
    db.select({ c: count() }).from(ordersTable).where(and(eq(ordersTable.vendorId, vendorId), eq(ordersTable.status, "pending"))),
    db.select({ c: count() }).from(productsTable).where(and(eq(productsTable.vendorId, vendorId), sql`stock IS NOT NULL AND stock < 10 AND stock > 0`)),
  ]);
  res.json({
    today:    { orders: tData[0]?.c??0, revenue: parseFloat((safeNum(tData[0]?.s)*vendorShare).toFixed(2)) },
    week:     { orders: wData[0]?.c??0, revenue: parseFloat((safeNum(wData[0]?.s)*vendorShare).toFixed(2)) },
    month:    { orders: mData[0]?.c??0, revenue: parseFloat((safeNum(mData[0]?.s)*vendorShare).toFixed(2)) },
    pending:  pending[0]?.c ?? 0,
    lowStock: lowStock[0]?.c ?? 0,
  });
});

/* ── GET /vendor/orders ── */
router.get("/orders", async (req, res) => {
  const vendorId = req.vendorId!;
  const status = req.query["status"] as string | undefined;
  const conditions: any[] = [eq(ordersTable.vendorId, vendorId)];
  if (status && status !== "all") {
    if (status === "new") conditions.push(or(eq(ordersTable.status, "pending"), eq(ordersTable.status, "confirmed")));
    else if (status === "active") conditions.push(or(eq(ordersTable.status, "preparing"), eq(ordersTable.status, "ready"), eq(ordersTable.status, "picked_up"), eq(ordersTable.status, "out_for_delivery")));
    else conditions.push(eq(ordersTable.status, status));
  }
  const orders = await db.select({
    order: ordersTable,
    riderName: usersTable.name,
    riderPhone: usersTable.phone,
  }).from(ordersTable)
    .leftJoin(usersTable, eq(ordersTable.riderId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(ordersTable.createdAt))
    .limit(100);
  res.json({ orders: orders.map(row => ({ ...row.order, total: safeNum(row.order.total), riderName: row.riderName ?? undefined, riderPhone: row.riderPhone ?? undefined })) });
});

/* ── PATCH /vendor/orders/:id/status ── */
router.patch("/orders/:id/status", async (req, res) => {
  const vendorId = req.vendorId!;
  const { status } = req.body;
  const validStatuses = ["confirmed","preparing","ready","cancelled"];
  if (!validStatuses.includes(status)) { res.status(400).json({ error: "Invalid status" }); return; }
  const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, req.params["id"]!), eq(ordersTable.vendorId, vendorId))).limit(1);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const ALLOWED_TRANSITIONS: Record<string, string[]> = {
    pending:   ["confirmed", "cancelled"],
    confirmed: ["preparing", "cancelled"],
    preparing: ["ready", "cancelled"],
    ready:     [],
    delivered: [],
    cancelled: [],
    completed: [],
  };
  const allowed = ALLOWED_TRANSITIONS[order.status] || [];
  if (!allowed.includes(status)) {
    res.status(400).json({ error: `Cannot change order from "${order.status}" to "${status}". Allowed: ${allowed.join(", ") || "none"}.` });
    return;
  }

  /* Include vendorId in UPDATE WHERE to close the TOCTOU window between SELECT and UPDATE */
  const [updated] = await db.update(ordersTable).set({ status, updatedAt: new Date() }).where(and(eq(ordersTable.id, req.params["id"]!), eq(ordersTable.vendorId, vendorId))).returning();
  const msgs: Record<string, { title: string; body: string }> = {
    confirmed: { title: "Order Confirmed! ✅", body: "Your order has been accepted by the store." },
    preparing: { title: "Being Prepared 🍳",  body: "The store is preparing your order now." },
    ready:     { title: "Order Ready! 📦",    body: "Your order is ready and waiting for pickup." },
    cancelled: { title: "Order Cancelled ❌", body: "Your order was cancelled by the store." },
  };
  if (msgs[status]) {
    await db.insert(notificationsTable).values({ id: generateId(), userId: order.userId, title: msgs[status]!.title, body: msgs[status]!.body, type: "order", icon: "bag-outline" }).catch(()=>{});
  }
  // Wallet refund for cancellations — wrapped in transaction (atomic)
  if (status === "cancelled" && order.paymentMethod === "wallet") {
    const refundAmt = safeNum(order.total);
    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ walletBalance: sql`wallet_balance + ${refundAmt}`, updatedAt: new Date() }).where(eq(usersTable.id, order.userId));
      await tx.insert(walletTransactionsTable).values({ id: generateId(), userId: order.userId, type: "credit", amount: refundAmt.toFixed(2), description: `Refund — Order #${order.id.slice(-6).toUpperCase()} cancelled by store` });
    }).catch(() => {});
    await db.insert(notificationsTable).values({ id: generateId(), userId: order.userId, title: "Refund Processed 💰", body: `Rs. ${refundAmt} refunded to your wallet — Order #${order.id.slice(-6).toUpperCase()}`, type: "wallet", icon: "wallet-outline" }).catch(() => {});
  }
  res.json({ ...updated, total: safeNum(updated.total) });
});

/* ── GET /vendor/products ── */
router.get("/products", async (req, res) => {
  const vendorId = req.vendorId!;
  const q = req.query["q"] as string | undefined;
  const cat = req.query["category"] as string | undefined;
  const conditions: any[] = [eq(productsTable.vendorId, vendorId)];
  if (q) conditions.push(ilike(productsTable.name, `%${q}%`));
  if (cat && cat !== "all") conditions.push(eq(productsTable.category, cat));
  const products = await db.select().from(productsTable).where(and(...conditions)).orderBy(desc(productsTable.createdAt));
  res.json({ products: products.map(p => ({ ...p, price: safeNum(p.price), originalPrice: p.originalPrice ? safeNum(p.originalPrice) : null, rating: safeNum(p.rating, 4.0) })) });
});

/* ── POST /vendor/products ── Add single product ── */
router.post("/products", async (req, res) => {
  const vendorId = req.vendorId!;
  const user = req.vendorUser!;
  const body = req.body;
  if (!body.name || !body.price) { res.status(400).json({ error: "name and price required" }); return; }
  if (!isFinite(Number(body.price)) || Number(body.price) <= 0) {
    res.status(400).json({ error: "Price must be a positive number" }); return;
  }

  // Enforce max items limit
  const s = await getPlatformSettings();
  const maxItems = parseInt(s["vendor_max_items"] ?? "100");
  const [countRow] = await db.select({ c: count() }).from(productsTable).where(eq(productsTable.vendorId, vendorId));
  if ((countRow?.c ?? 0) >= maxItems) {
    res.status(400).json({ error: `Product limit reached. Maximum ${maxItems} items allowed per vendor.` }); return;
  }

  const [product] = await db.insert(productsTable).values({
    id: generateId(), vendorId, vendorName: user.storeName || user.name,
    name: body.name, description: body.description || null,
    price: String(body.price), originalPrice: body.originalPrice ? String(body.originalPrice) : null,
    category: body.category || "general", type: body.type || "mart",
    image: body.image || null, inStock: body.inStock !== false,
    stock: body.stock ? Number(body.stock) : null,
    unit: body.unit || null, deliveryTime: body.deliveryTime || null,
  }).returning();
  res.status(201).json({ ...product, price: safeNum(product.price) });
});

/* ── POST /vendor/products/bulk ── Bulk add products ── */
router.post("/products/bulk", async (req, res) => {
  const vendorId = req.vendorId!;
  const user = req.vendorUser!;
  const { products } = req.body;
  if (!Array.isArray(products) || products.length === 0) { res.status(400).json({ error: "products array required" }); return; }
  if (products.length > 50) { res.status(400).json({ error: "Max 50 products at a time" }); return; }

  // Enforce max items limit (check current count + new items)
  const s2 = await getPlatformSettings();
  const maxItems2 = parseInt(s2["vendor_max_items"] ?? "100");
  const [countRow2] = await db.select({ c: count() }).from(productsTable).where(eq(productsTable.vendorId, vendorId));
  const currentCount = countRow2?.c ?? 0;
  if (currentCount + products.length > maxItems2) {
    res.status(400).json({ error: `Product limit exceeded. You have ${currentCount}/${maxItems2} items. Can only add ${Math.max(0, maxItems2 - currentCount)} more.` }); return;
  }
  const invalid = products.filter(p => !p.name || !p.price || !isFinite(Number(p.price)) || Number(p.price) <= 0);
  if (invalid.length > 0) { res.status(400).json({ error: `${invalid.length} product(s) missing name, or have an invalid/non-positive price` }); return; }
  const inserted = await db.insert(productsTable).values(
    products.map(p => ({
      id: generateId(), vendorId, vendorName: user.storeName || user.name,
      name: p.name, description: p.description || null,
      price: String(p.price), originalPrice: p.originalPrice ? String(p.originalPrice) : null,
      category: p.category || "general", type: p.type || "mart",
      image: p.image || null, inStock: p.inStock !== false,
      stock: p.stock ? Number(p.stock) : null, unit: p.unit || null,
    }))
  ).returning();
  res.status(201).json({ inserted: inserted.length, products: inserted.map(p => ({ ...p, price: safeNum(p.price) })) });
});

/* ── PATCH /vendor/products/:id ── Update product ── */
router.patch("/products/:id", async (req, res) => {
  const vendorId = req.vendorId!;
  const body = req.body;
  const updates: any = { updatedAt: new Date() };
  const fields = ["name","description","category","type","unit","deliveryTime"];
  for (const f of fields) if (body[f] !== undefined) updates[f] = body[f];
  if (body.price !== undefined) {
    if (!isFinite(Number(body.price)) || Number(body.price) <= 0) {
      res.status(400).json({ error: "Price must be a positive number" }); return;
    }
    updates.price = String(body.price);
  }
  if (body.originalPrice !== undefined) updates.originalPrice = body.originalPrice ? String(body.originalPrice) : null;
  if (body.inStock     !== undefined) updates.inStock      = body.inStock;
  if (body.stock       !== undefined) updates.stock        = body.stock !== null ? Number(body.stock) : null;
  if (body.image       !== undefined) updates.image        = body.image;
  const [product] = await db.update(productsTable).set(updates).where(and(eq(productsTable.id, req.params["id"]!), eq(productsTable.vendorId, vendorId))).returning();
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  res.json({ ...product, price: safeNum(product.price) });
});

/* ── DELETE /vendor/products/:id ── */
router.delete("/products/:id", async (req, res) => {
  const vendorId = req.vendorId!;
  const [del] = await db.delete(productsTable).where(and(eq(productsTable.id, req.params["id"]!), eq(productsTable.vendorId, vendorId))).returning();
  if (!del) { res.status(404).json({ error: "Product not found" }); return; }
  res.json({ success: true });
});

/* ── GET /vendor/promos ── Vendor promo codes ── */
router.get("/promos", async (req, res) => {
  const vendorId = req.vendorId!;
  const promos = await db.select().from(promoCodesTable).where(eq(promoCodesTable.vendorId, vendorId)).orderBy(desc(promoCodesTable.createdAt));
  res.json({ promos: promos.map(p => ({ ...p, discountPct: safeNum(p.discountPct), discountFlat: safeNum(p.discountFlat), minOrderAmount: safeNum(p.minOrderAmount) })) });
});

/* ── POST /vendor/promos ── Create promo ── */
router.post("/promos", async (req, res) => {
  const vendorId = req.vendorId!;
  const body = req.body;
  if (!body.code || (!body.discountPct && !body.discountFlat)) {
    res.status(400).json({ error: "code + discount (% or flat) required" }); return;
  }
  // Check if promos are enabled by admin
  const sp = await getPlatformSettings();
  if ((sp["vendor_promo_enabled"] ?? "on") !== "on") {
    res.status(403).json({ error: "Promo code creation is currently disabled by admin." }); return;
  }
  // Check if code already exists
  const [existing] = await db.select({ id: promoCodesTable.id }).from(promoCodesTable).where(eq(promoCodesTable.code, body.code.toUpperCase())).limit(1);
  if (existing) { res.status(400).json({ error: "Promo code already exists" }); return; }
  const [promo] = await db.insert(promoCodesTable).values({
    id: generateId(), code: body.code.toUpperCase().trim(),
    description: body.description || null,
    discountPct: body.discountPct ? String(body.discountPct) : null,
    discountFlat: body.discountFlat ? String(body.discountFlat) : null,
    minOrderAmount: String(body.minOrderAmount || 0),
    maxDiscount: body.maxDiscount ? String(body.maxDiscount) : null,
    usageLimit: body.usageLimit ? Number(body.usageLimit) : null,
    appliesTo: body.appliesTo || "all",
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    vendorId, isActive: true,
  }).returning();
  res.status(201).json({ ...promo, discountPct: safeNum(promo.discountPct), discountFlat: safeNum(promo.discountFlat) });
});

/* ── PATCH /vendor/promos/:id/toggle ── */
router.patch("/promos/:id/toggle", async (req, res) => {
  const vendorId = req.vendorId!;
  const [promo] = await db.select().from(promoCodesTable).where(and(eq(promoCodesTable.id, req.params["id"]!), eq(promoCodesTable.vendorId, vendorId))).limit(1);
  if (!promo) { res.status(404).json({ error: "Promo not found" }); return; }
  const [updated] = await db.update(promoCodesTable).set({ isActive: !promo.isActive }).where(eq(promoCodesTable.id, promo.id)).returning();
  res.json(updated);
});

/* ── DELETE /vendor/promos/:id ── */
router.delete("/promos/:id", async (req, res) => {
  const vendorId = req.vendorId!;
  await db.delete(promoCodesTable).where(and(eq(promoCodesTable.id, req.params["id"]!), eq(promoCodesTable.vendorId, vendorId)));
  res.json({ success: true });
});

/* ── GET /vendor/wallet/transactions ── */
router.get("/wallet/transactions", async (req, res) => {
  const vendorId = req.vendorId!;
  const limit = Math.min(parseInt(String(req.query["limit"] || "50")), 100);
  const txns = await db.select().from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.userId, vendorId))
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(limit);
  const user = req.vendorUser!;
  res.json({
    balance: safeNum(user.walletBalance),
    transactions: txns.map(t => ({
      ...t,
      amount: safeNum(t.amount),
    })),
  });
});

/* ── POST /vendor/wallet/withdraw ── Atomic Withdrawal Request ── */
router.post("/wallet/withdraw", async (req, res) => {
  const vendorId = req.vendorId!;
  const { amount, accountTitle, accountNumber, bankName, note } = req.body;
  const amt = safeNum(amount);

  // Check admin settings for withdrawal rules
  const sw = await getPlatformSettings();
  if ((sw["vendor_withdrawal_enabled"] ?? "on") !== "on") {
    res.status(403).json({ error: "Withdrawal requests are temporarily disabled by admin. Please try again later." }); return;
  }
  const minPayout = parseFloat(sw["vendor_min_payout"] ?? "500");
  const maxPayout = parseFloat(sw["vendor_max_payout"] ?? "50000");

  if (!amt || amt <= 0) { res.status(400).json({ error: "Valid amount required" }); return; }
  if (amt < minPayout) { res.status(400).json({ error: `Minimum withdrawal is Rs. ${minPayout}` }); return; }
  if (amt > maxPayout) { res.status(400).json({ error: `Maximum single withdrawal is Rs. ${maxPayout}` }); return; }
  if (!accountTitle || !accountNumber || !bankName) {
    res.status(400).json({ error: "Account title, number, and bank name are required" }); return;
  }

  // Atomic transaction — prevents race condition / overdraw
  try {
    const result = await db.transaction(async (tx) => {
      const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, vendorId)).limit(1);
      if (!user) throw new Error("User not found");

      const balance = safeNum(user.walletBalance);
      if (amt > balance) throw new Error(`Insufficient balance. Available: Rs. ${balance}`);

      /* DB-level floor guard in WHERE — prevents negative balance even when two
         concurrent withdrawal requests both pass the pre-flight check above.
         Same pattern applied to all other deduction sites in Pass 17. */
      const [debited] = await tx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance - ${amt}`, updatedAt: new Date() })
        .where(and(eq(usersTable.id, vendorId), gte(usersTable.walletBalance, String(amt))))
        .returning({ id: usersTable.id });
      if (!debited) throw new Error("Insufficient balance — please refresh and try again.");

      await tx.insert(walletTransactionsTable).values({
        id: generateId(), userId: vendorId, type: "debit",
        amount: amt.toFixed(2),
        description: `Withdrawal request — ${bankName} · ${accountNumber} · ${accountTitle}${note ? ` · Note: ${note}` : ""}`,
      });
      return balance - amt;
    });

    await db.insert(notificationsTable).values({
      id: generateId(), userId: vendorId, title: "Withdrawal Requested ✅",
      body: `Rs. ${amt} withdrawal requested. Admin will process within 24-48 hours.`, type: "wallet", icon: "cash-outline",
    }).catch(() => {});

    res.json({ success: true, newBalance: parseFloat(result.toFixed(2)), amount: amt });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* ── GET /vendor/notifications ── */
router.get("/notifications", async (req, res) => {
  const vendorId = req.vendorId!;
  const notifs = await db.select().from(notificationsTable)
    .where(eq(notificationsTable.userId, vendorId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(30);
  res.json({ notifications: notifs, unread: notifs.filter((n: any) => !n.isRead).length });
});

/* ── PATCH /vendor/notifications/read-all ── */
router.patch("/notifications/read-all", async (req, res) => {
  const vendorId = req.vendorId!;
  await db.update(notificationsTable).set({ isRead: true }).where(eq(notificationsTable.userId, vendorId));
  res.json({ success: true });
});

/* ── GET /vendor/analytics ── ── */
router.get("/analytics", async (req, res) => {
  const vendorId = req.vendorId!;
  const days = parseInt(String(req.query["days"] || "7"));
  const since = new Date(); since.setDate(since.getDate() - days); since.setHours(0,0,0,0);
  const s = await getPlatformSettings();
  const vendorShare = 1 - (parseFloat(s["vendor_commission_pct"] ?? "15") / 100);

  const [revenueData, topProductsRaw, ordersByStatusRaw] = await Promise.all([
    db.select({ c: count(), s: sum(ordersTable.total), date: sql<string>`DATE(${ordersTable.createdAt})` }).from(ordersTable)
      .where(and(eq(ordersTable.vendorId, vendorId), gte(ordersTable.createdAt, since))).groupBy(sql`DATE(${ordersTable.createdAt})`).orderBy(sql`DATE(${ordersTable.createdAt})`),
    db.select({ id: productsTable.id, name: productsTable.name, orderCount: count() }).from(ordersTable)
      .innerJoin(productsTable, sql`${ordersTable.items}::text LIKE '%' || ${productsTable.id} || '%'`)
      .where(eq(ordersTable.vendorId, vendorId)).groupBy(productsTable.id, productsTable.name).orderBy(desc(count())).limit(5).catch(() => []),
    db.select({ status: ordersTable.status, c: count() }).from(ordersTable).where(and(eq(ordersTable.vendorId, vendorId), gte(ordersTable.createdAt, since))).groupBy(ordersTable.status),
  ]);

  const daily = revenueData.map(d => ({
    date: d.date,
    orders: d.c ?? 0,
    revenue: parseFloat((safeNum(d.s) * vendorShare).toFixed(2)),
  }));

  const totalOrders = daily.reduce((sum, d) => sum + d.orders, 0);
  const totalRevenue = daily.reduce((sum, d) => sum + d.revenue, 0);

  const byStatus: Record<string, number> = {};
  for (const row of ordersByStatusRaw) {
    byStatus[row.status] = row.c ?? 0;
  }

  const topProducts = topProductsRaw.map(p => ({
    productId: p.id,
    name: p.name,
    orders: Number(p.orderCount) || 0,
    revenue: 0,
  }));

  res.json({
    summary: { totalOrders, totalRevenue },
    daily,
    topProducts,
    byStatus,
    period: days,
  });
});

export default router;
