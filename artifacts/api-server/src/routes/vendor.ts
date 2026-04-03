import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { usersTable, ordersTable, productsTable, promoCodesTable, walletTransactionsTable, notificationsTable, reviewsTable, liveLocationsTable } from "@workspace/db/schema";
import { eq, desc, and, sql, count, sum, gte, or, ilike, isNull, avg } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getPlatformSettings } from "./admin.js";
import { requireRole } from "../middleware/security.js";
import { t } from "@workspace/i18n";
import { getUserLanguage } from "../lib/getUserLanguage.js";
import { getIO, emitRiderNewRequest } from "../lib/socketio.js";
import { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden, sendValidationError } from "../lib/response.js";

const router: IRouter = Router();

/* ── Auth: replaced duplicated vendorAuth with the shared requireRole factory ── */
router.use(requireRole("vendor", { vendorApprovalCheck: true }));

function safeNum(v: any, def = 0) { return parseFloat(String(v ?? def)) || def; }
function formatUser(user: any) {
  return {
    id: user.id, phone: user.phone, name: user.name, email: user.email,
    username: user.username,
    avatar: user.avatar,
    storeName: user.storeName, storeCategory: user.storeCategory,
    storeBanner: user.storeBanner, storeDescription: user.storeDescription,
    storeHours: user.storeHours ? (typeof user.storeHours === "string" ? (() => { try { return JSON.parse(user.storeHours); } catch { return null; } })() : user.storeHours) : null,
    storeAnnouncement: user.storeAnnouncement,
    storeMinOrder: safeNum(user.storeMinOrder),
    storeDeliveryTime: user.storeDeliveryTime,
    storeIsOpen: user.storeIsOpen ?? true,
    walletBalance: safeNum(user.walletBalance),
    cnic: user.cnic, address: user.address, city: user.city, area: user.area,
    bankName: user.bankName, bankAccount: user.bankAccount, bankAccountTitle: user.bankAccountTitle,
    businessType: user.businessType,
    accountLevel: user.accountLevel, kycStatus: user.kycStatus,
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
  sendSuccess(res, {
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
  const updates: Record<string, unknown> = { updatedAt: new Date() };
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
  sendSuccess(res, formatUser(user));
});

/* ── GET /vendor/store ── */
router.get("/store", async (req, res) => {
  const user = req.vendorUser!;
  sendSuccess(res, formatUser(user));
});

/* ── PATCH /vendor/store ── */
router.patch("/store", async (req, res) => {
  const vendorId = req.vendorId!;
  const body = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const fields = ["storeName","storeCategory","storeBanner","storeDescription","storeAnnouncement","storeDeliveryTime","storeIsOpen","storeMinOrder"];
  for (const f of fields) {
    if (body[f] !== undefined) updates[f] = body[f];
  }
  if (body.storeHours !== undefined) updates.storeHours = typeof body.storeHours === "string" ? body.storeHours : JSON.stringify(body.storeHours);
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, vendorId)).returning();
  sendSuccess(res, formatUser(user));
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
  sendSuccess(res, {
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
  sendSuccess(res, { orders: orders.map(row => ({ ...row.order, total: safeNum(row.order.total), riderName: row.riderName ?? undefined, riderPhone: row.riderPhone ?? undefined })) });
});

/* ── PATCH /vendor/orders/:id/status ── */
router.patch("/orders/:id/status", async (req, res) => {
  const vendorId = req.vendorId!;
  const { status } = req.body;
  const validStatuses = ["confirmed","preparing","ready","cancelled"];
  if (!validStatuses.includes(status)) { sendValidationError(res, "Invalid status"); return; }
  const [order] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, req.params["id"]!), eq(ordersTable.vendorId, vendorId))).limit(1);
  if (!order) { sendNotFound(res, "Order not found"); return; }

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
    sendValidationError(res, `Cannot change order from "${order.status}" to "${status}". Allowed: ${allowed.join(", ") || "none"}.`);
    return;
  }

  const orderId = req.params["id"]!;
  const custLang = await getUserLanguage(order.userId);
  const msgs: Record<string, { title: string; body: string }> = {
    confirmed: { title: t("notifOrderConfirmed", custLang) + " ✅", body: t("notifOrderConfirmedBody", custLang) },
    preparing: { title: t("notifOrderPreparing", custLang) + " 🍳",  body: t("notifOrderPreparingBody", custLang) },
    ready:     { title: t("notifOrderReady", custLang) + " 📦",    body: t("notifOrderReadyBody", custLang) },
    cancelled: { title: t("notifOrderCancelled", custLang) + " ❌", body: t("notifOrderCancelledBody", custLang) },
  };

  let updated: typeof order;

  if (status === "cancelled" && order.paymentMethod === "wallet") {
    /* Atomic: status update + wallet credit + refund stamp in one tx.
       WHERE refunded_at IS NULL guard prevents double-credit under concurrent requests. */
    const refundAmt = safeNum(order.total);
    const now = new Date();
    const txResult = await db.transaction(async (tx) => {
      const result = await tx.update(ordersTable)
        .set({ status, refundedAt: now, refundedAmount: refundAmt.toFixed(2), paymentStatus: "refunded", updatedAt: now })
        .where(and(eq(ordersTable.id, orderId), eq(ordersTable.vendorId, vendorId), isNull(ordersTable.refundedAt)))
        .returning();
      if (result.length === 0) throw new Error("ALREADY_REFUNDED");
      await tx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance + ${refundAmt}`, updatedAt: now })
        .where(eq(usersTable.id, order.userId));
      await tx.insert(walletTransactionsTable).values({
        id: generateId(), userId: order.userId, type: "credit",
        amount: refundAmt.toFixed(2),
        description: `Refund — Order #${orderId.slice(-6).toUpperCase()} cancelled by store`,
      });
      return result[0];
    }).catch((err: Error) => {
      if (err.message === "ALREADY_REFUNDED") return null;
      throw err;
    });
    if (!txResult) { sendError(res, "Order has already been refunded", 409); return; }
    updated = txResult;
    await db.insert(notificationsTable).values({ id: generateId(), userId: order.userId, title: t("notifRefundProcessed", custLang) + " 💰", body: t("notifRefundProcessedBody", custLang).replace("{amount}", refundAmt.toFixed(0)), type: "wallet", icon: "wallet-outline" }).catch(() => {});
  } else {
    /* Non-wallet or non-cancel: plain status update — vendorId in WHERE closes TOCTOU window */
    const [result] = await db.update(ordersTable)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(ordersTable.id, orderId), eq(ordersTable.vendorId, vendorId)))
      .returning();
    if (!result) { sendNotFound(res, "Order not found"); return; }
    updated = result;
  }

  if (msgs[status]) {
    await db.insert(notificationsTable).values({ id: generateId(), userId: order.userId, title: msgs[status]!.title, body: msgs[status]!.body, type: "order", icon: "bag-outline" }).catch(()=>{});
  }

  const io = getIO();
  if (io) {
    const mapped = { ...updated, total: safeNum(updated.total) };
    io.to("admin-fleet").emit("order:update", mapped);
    io.to(`vendor:${vendorId}`).emit("order:update", mapped);
    if (updated.riderId) io.to(`rider:${updated.riderId}`).emit("order:update", mapped);
  }

  if (status === "ready" && !updated.riderId) {
    (async () => {
      try {
        const onlineRiders = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(and(
            eq(usersTable.role, "rider"),
            eq(usersTable.isOnline, true),
          ));
        for (const { id: riderId } of onlineRiders) {
          emitRiderNewRequest(riderId, { type: "order_ready", requestId: orderId, summary: `Order ready for pickup` });
        }
      } catch {}
    })();
  }

  sendSuccess(res, { ...updated, total: safeNum(updated.total) });
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
  sendSuccess(res, { products: products.map(p => ({ ...p, price: safeNum(p.price), originalPrice: p.originalPrice ? safeNum(p.originalPrice) : null, rating: safeNum(p.rating, 4.0) })) });
});

/* ── POST /vendor/products ── Add single product ── */
router.post("/products", async (req, res) => {
  const vendorId = req.vendorId!;
  const user = req.vendorUser!;
  const body = req.body;
  if (!body.name || !body.price) { sendValidationError(res, "name and price required"); return; }
  if (!isFinite(Number(body.price)) || Number(body.price) <= 0) {
    sendValidationError(res, "Price must be a positive number"); return;
  }

  const s = await getPlatformSettings();
  const maxItems = parseInt(s["vendor_max_items"] ?? "100");
  const [countRow] = await db.select({ c: count() }).from(productsTable).where(eq(productsTable.vendorId, vendorId));
  if ((countRow?.c ?? 0) >= maxItems) {
    sendValidationError(res, `Product limit reached. Maximum ${maxItems} items allowed per vendor.`); return;
  }

  const [product] = await db.insert(productsTable).values({
    id: generateId(), vendorId, vendorName: user.storeName || user.name,
    name: body.name, description: body.description || null,
    price: String(body.price), originalPrice: body.originalPrice ? String(body.originalPrice) : null,
    category: body.category || "general", type: body.type || "mart",
    image: body.image || null, inStock: false,
    stock: body.stock ? Number(body.stock) : null,
    unit: body.unit || null, deliveryTime: body.deliveryTime || null,
    approvalStatus: "pending",
  }).returning();
  sendCreated(res, { ...product, price: safeNum(product.price) });
});

/* ── POST /vendor/products/bulk ── Bulk add products ── */
router.post("/products/bulk", async (req, res) => {
  const vendorId = req.vendorId!;
  const user = req.vendorUser!;
  const { products } = req.body;
  if (!Array.isArray(products) || products.length === 0) { sendValidationError(res, "products array required"); return; }
  if (products.length > 50) { sendValidationError(res, "Max 50 products at a time"); return; }

  const s2 = await getPlatformSettings();
  const maxItems2 = parseInt(s2["vendor_max_items"] ?? "100");
  const [countRow2] = await db.select({ c: count() }).from(productsTable).where(eq(productsTable.vendorId, vendorId));
  const currentCount = countRow2?.c ?? 0;
  if (currentCount + products.length > maxItems2) {
    sendValidationError(res, `Product limit exceeded. You have ${currentCount}/${maxItems2} items. Can only add ${Math.max(0, maxItems2 - currentCount)} more.`); return;
  }
  const invalid = products.filter(p => !p.name || !p.price || !isFinite(Number(p.price)) || Number(p.price) <= 0);
  if (invalid.length > 0) { sendValidationError(res, `${invalid.length} product(s) missing name, or have an invalid/non-positive price`); return; }
  const inserted = await db.insert(productsTable).values(
    products.map(p => ({
      id: generateId(), vendorId, vendorName: user.storeName || user.name,
      name: p.name, description: p.description || null,
      price: String(p.price), originalPrice: p.originalPrice ? String(p.originalPrice) : null,
      category: p.category || "general", type: p.type || "mart",
      image: p.image || null, inStock: false,
      stock: p.stock ? Number(p.stock) : null, unit: p.unit || null,
      approvalStatus: "pending",
    }))
  ).returning();
  sendCreated(res, { inserted: inserted.length, products: inserted.map(p => ({ ...p, price: safeNum(p.price) })) });
});

/* ── PATCH /vendor/products/:id ── Update product ── */
router.patch("/products/:id", async (req, res) => {
  const vendorId = req.vendorId!;
  const body = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const fields = ["name","description","category","type","unit","deliveryTime"];
  for (const f of fields) if (body[f] !== undefined) updates[f] = body[f];
  if (body.price !== undefined) {
    if (!isFinite(Number(body.price)) || Number(body.price) <= 0) {
      sendValidationError(res, "Price must be a positive number"); return;
    }
    updates.price = String(body.price);
  }
  if (body.originalPrice !== undefined) updates.originalPrice = body.originalPrice ? String(body.originalPrice) : null;
  if (body.inStock     !== undefined) updates.inStock      = body.inStock;
  if (body.stock       !== undefined) updates.stock        = body.stock !== null ? Number(body.stock) : null;
  if (body.image       !== undefined) updates.image        = body.image;
  const [product] = await db.update(productsTable).set(updates).where(and(eq(productsTable.id, req.params["id"]!), eq(productsTable.vendorId, vendorId))).returning();
  if (!product) { sendNotFound(res, "Product not found"); return; }
  sendSuccess(res, { ...product, price: safeNum(product.price) });
});

/* ── DELETE /vendor/products/:id ── */
router.delete("/products/:id", async (req, res) => {
  const vendorId = req.vendorId!;
  const [del] = await db.delete(productsTable).where(and(eq(productsTable.id, req.params["id"]!), eq(productsTable.vendorId, vendorId))).returning();
  if (!del) { sendNotFound(res, "Product not found"); return; }
  sendSuccess(res);
});

/* ── GET /vendor/promos ── Vendor promo codes ── */
router.get("/promos", async (req, res) => {
  const vendorId = req.vendorId!;
  const promos = await db.select().from(promoCodesTable).where(eq(promoCodesTable.vendorId, vendorId)).orderBy(desc(promoCodesTable.createdAt));
  sendSuccess(res, { promos: promos.map(p => ({ ...p, discountPct: safeNum(p.discountPct), discountFlat: safeNum(p.discountFlat), minOrderAmount: safeNum(p.minOrderAmount) })) });
});

/* ── POST /vendor/promos ── Create promo ── */
router.post("/promos", async (req, res) => {
  const vendorId = req.vendorId!;
  const body = req.body;
  if (!body.code || (!body.discountPct && !body.discountFlat)) {
    sendValidationError(res, "code + discount (% or flat) required"); return;
  }
  const sp = await getPlatformSettings();
  if ((sp["vendor_promo_enabled"] ?? "on") !== "on") {
    sendForbidden(res, "Promo code creation is currently disabled by admin."); return;
  }
  const [existing] = await db.select({ id: promoCodesTable.id }).from(promoCodesTable).where(eq(promoCodesTable.code, body.code.toUpperCase())).limit(1);
  if (existing) { sendValidationError(res, "Promo code already exists"); return; }
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
  sendCreated(res, { ...promo, discountPct: safeNum(promo.discountPct), discountFlat: safeNum(promo.discountFlat) });
});

/* ── PATCH /vendor/promos/:id/toggle ── */
router.patch("/promos/:id/toggle", async (req, res) => {
  const vendorId = req.vendorId!;
  const [promo] = await db.select().from(promoCodesTable).where(and(eq(promoCodesTable.id, req.params["id"]!), eq(promoCodesTable.vendorId, vendorId))).limit(1);
  if (!promo) { sendNotFound(res, "Promo not found"); return; }
  const [updated] = await db.update(promoCodesTable).set({ isActive: !promo.isActive }).where(eq(promoCodesTable.id, promo.id)).returning();
  sendSuccess(res, updated);
});

/* ── DELETE /vendor/promos/:id ── */
router.delete("/promos/:id", async (req, res) => {
  const vendorId = req.vendorId!;
  await db.delete(promoCodesTable).where(and(eq(promoCodesTable.id, req.params["id"]!), eq(promoCodesTable.vendorId, vendorId)));
  sendSuccess(res);
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
  sendSuccess(res, {
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

  const sw = await getPlatformSettings();
  if ((sw["vendor_withdrawal_enabled"] ?? "on") !== "on") {
    sendForbidden(res, "Withdrawal requests are temporarily disabled by admin. Please try again later."); return;
  }
  const minPayout = parseFloat(sw["vendor_min_payout"] ?? "500");
  const maxPayout = parseFloat(sw["vendor_max_payout"] ?? "50000");

  if (!amt || amt <= 0) { sendValidationError(res, "Valid amount required"); return; }
  if (amt < minPayout) { sendValidationError(res, `Minimum withdrawal is Rs. ${minPayout}`); return; }
  if (amt > maxPayout) { sendValidationError(res, `Maximum single withdrawal is Rs. ${maxPayout}`); return; }
  if (!accountTitle || !accountNumber || !bankName) {
    sendValidationError(res, "Account title, number, and bank name are required"); return;
  }

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

    const wdLang = await getUserLanguage(vendorId);
    await db.insert(notificationsTable).values({
      id: generateId(), userId: vendorId,
      title: t("notifVendorWithdrawal", wdLang),
      body: t("notifVendorWithdrawalBody", wdLang).replace("{amount}", String(amt)),
      type: "wallet", icon: "cash-outline",
    }).catch(() => {});

    sendSuccess(res, { newBalance: parseFloat(result.toFixed(2)), amount: amt });
  } catch (e: unknown) {
    sendValidationError(res, (e as Error).message);
  }
});

/* ── GET /vendor/notifications ── */
router.get("/notifications", async (req, res) => {
  const vendorId = req.vendorId!;
  const notifs = await db.select().from(notificationsTable)
    .where(eq(notificationsTable.userId, vendorId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(30);
  sendSuccess(res, { notifications: notifs, unread: notifs.filter((n: Record<string, unknown>) => !n.isRead).length });
});

/* ── PATCH /vendor/notifications/read-all ── */
router.patch("/notifications/read-all", async (req, res) => {
  const vendorId = req.vendorId!;
  await db.update(notificationsTable).set({ isRead: true }).where(eq(notificationsTable.userId, vendorId));
  sendSuccess(res);
});

/* ── PATCH /vendor/notifications/:id/read ── */
router.patch("/notifications/:id/read", async (req, res) => {
  const vendorId = req.vendorId!;
  await db.update(notificationsTable).set({ isRead: true }).where(and(eq(notificationsTable.id, req.params.id), eq(notificationsTable.userId, vendorId)));
  sendSuccess(res);
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

  sendSuccess(res, {
    summary: { totalOrders, totalRevenue },
    daily,
    topProducts,
    byStatus,
    period: days,
  });
});

/* ── GET /vendor/reviews — all reviews for this vendor (authenticated) ── */
router.get("/reviews", async (req, res) => {
  const vendorId = req.vendorId!;
  const page  = Math.max(1, parseInt(String(req.query["page"]  || "1")));
  const limit = Math.min(parseInt(String(req.query["limit"] || "20")), 100);
  const offset = (page - 1) * limit;
  const starsFilter = req.query["stars"] as string | undefined;
  const sort = req.query["sort"] as string || "newest";

  const conditions: any[] = [eq(reviewsTable.vendorId, vendorId), eq(reviewsTable.hidden, false), isNull(reviewsTable.deletedAt)];
  if (starsFilter) conditions.push(eq(reviewsTable.rating, parseInt(starsFilter)));

  const [statsRow] = await db
    .select({ total: count(), avgRating: avg(reviewsTable.rating) })
    .from(reviewsTable)
    .where(and(eq(reviewsTable.vendorId, vendorId), eq(reviewsTable.hidden, false), isNull(reviewsTable.deletedAt)));

  const totalCount = statsRow?.total ?? 0;
  const avgRating  = statsRow?.avgRating ? parseFloat(parseFloat(statsRow.avgRating).toFixed(1)) : null;

  /* Star breakdown */
  const breakdown = await db
    .select({ rating: reviewsTable.rating, cnt: count() })
    .from(reviewsTable)
    .where(and(eq(reviewsTable.vendorId, vendorId), eq(reviewsTable.hidden, false), isNull(reviewsTable.deletedAt)))
    .groupBy(reviewsTable.rating);
  const starBreakdown: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of breakdown) starBreakdown[row.rating] = row.cnt;

  const rows = await db
    .select({
      id: reviewsTable.id,
      orderId: reviewsTable.orderId,
      rating: reviewsTable.rating,
      comment: reviewsTable.comment,
      orderType: reviewsTable.orderType,
      createdAt: reviewsTable.createdAt,
      status: reviewsTable.status,
      vendorReply: reviewsTable.vendorReply,
      vendorRepliedAt: reviewsTable.vendorRepliedAt,
      customerName: usersTable.name,
    })
    .from(reviewsTable)
    .leftJoin(usersTable, eq(reviewsTable.userId, usersTable.id))
    .where(and(...conditions))
    .orderBy(sort === "oldest" ? reviewsTable.createdAt : desc(reviewsTable.createdAt))
    .limit(limit)
    .offset(offset);

  /* Mask customer names: first name + last initial */
  const masked = rows.map(r => ({
    ...r,
    customerName: r.customerName
      ? (() => {
          const parts = r.customerName.trim().split(/\s+/);
          return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
        })()
      : "Customer",
  }));

  sendSuccess(res, {
    reviews: masked,
    total: totalCount,
    avgRating,
    starBreakdown,
    page,
    limit,
    pages: Math.ceil(totalCount / limit),
  });
});

/* ── Haversine distance helper ───────────────────────────────────────── */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── GET /vendor/orders/available-riders ─────────────────────────────────
   Returns online riders sorted by distance from a given lat/lng.
   Query: lat, lng, maxKm (default 10)
──────────────────────────────────────────────────────────────────────── */
router.get("/orders/available-riders", requireRole("vendor"), async (req, res) => {
  const lat = parseFloat(String(req.query["lat"] ?? ""));
  const lng = parseFloat(String(req.query["lng"] ?? ""));
  const maxKm = parseFloat(String(req.query["maxKm"] ?? "10"));

  const riders = await db
    .select({
      id: usersTable.id, name: usersTable.name, phone: usersTable.phone,
      vehicleType: usersTable.vehicleType, walletBalance: usersTable.walletBalance,
      lat: liveLocationsTable.latitude, lng: liveLocationsTable.longitude,
    })
    .from(usersTable)
    .innerJoin(liveLocationsTable, eq(usersTable.id, liveLocationsTable.userId))
    .where(and(eq(usersTable.role, "rider"), eq(usersTable.isOnline, true)));

  const withDist = riders
    .map(r => {
      const dist = (!isNaN(lat) && !isNaN(lng))
        ? haversineKm(lat, lng, parseFloat(r.lat), parseFloat(r.lng))
        : 99999;
      return { ...r, distKm: Math.round(dist * 10) / 10, lat: parseFloat(r.lat), lng: parseFloat(r.lng) };
    })
    .filter(r => r.distKm <= maxKm)
    .sort((a, b) => a.distKm - b.distKm);

  sendSuccess(res, { riders: withDist });
});

/* ── POST /vendor/orders/:id/assign-rider ────────────────────────────────
   Body: { riderId }
──────────────────────────────────────────────────────────────────────── */
router.post("/orders/:id/assign-rider", requireRole("vendor"), async (req, res) => {
  const orderId = req.params["id"]!;
  const vendorId = req.vendorId!;
  const { riderId } = req.body as { riderId?: string };
  if (!riderId) { sendValidationError(res, "riderId required"); return; }

  const [rider] = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, isOnline: usersTable.isOnline })
    .from(usersTable).where(and(eq(usersTable.id, riderId), eq(usersTable.role, "rider"))).limit(1);
  if (!rider) { sendNotFound(res, "Rider not found"); return; }
  if (!rider.isOnline) { sendError(res, "Rider is currently offline", 400); return; }

  const [updated] = await db.update(ordersTable)
    .set({ riderId: rider.id, riderName: rider.name, riderPhone: rider.phone, assignedRiderId: rider.id, assignedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(ordersTable.id, orderId),
      eq(ordersTable.vendorId, vendorId),
      isNull(ordersTable.riderId),
      or(eq(ordersTable.status, "confirmed"), eq(ordersTable.status, "preparing"), eq(ordersTable.status, "ready")),
    ))
    .returning();
  if (!updated) {
    const [order] = await db.select({ id: ordersTable.id, riderId: ordersTable.riderId, status: ordersTable.status, vendorId: ordersTable.vendorId })
      .from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
    if (!order) { sendNotFound(res, "Order not found"); return; }
    if (order.vendorId !== vendorId) { sendForbidden(res, "This order does not belong to your store"); return; }
    if (order.riderId) { sendError(res, "Order already has a rider assigned", 409); return; }
    sendError(res, `Order cannot be assigned in '${order.status}' status`, 400); return;
  }

  await db.insert(notificationsTable).values({
    id: generateId(), userId: rider.id,
    title: "📦 New Delivery Assigned",
    body: `You have been assigned a delivery order #${orderId.slice(-6).toUpperCase()}. Head to the vendor.`,
    type: "order", icon: "bicycle-outline",
  }).catch(() => {});

  const io = getIO();
  if (io) io.to(`user:${rider.id}`).emit("order:assigned", { orderId });

  sendSuccess(res, { riderId: rider.id, riderName: rider.name });
});

/* ── POST /vendor/orders/:id/auto-assign ─────────────────────────────────
   Finds the nearest online rider and assigns automatically.
   Body: { vendorLat?, vendorLng? }
──────────────────────────────────────────────────────────────────────── */
router.post("/orders/:id/auto-assign", requireRole("vendor"), async (req, res) => {
  const orderId  = req.params["id"]!;
  const vendorId = req.vendorId!;
  const { vendorLat, vendorLng } = req.body as { vendorLat?: number; vendorLng?: number };

  const riders = await db
    .select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, lat: liveLocationsTable.latitude, lng: liveLocationsTable.longitude })
    .from(usersTable)
    .innerJoin(liveLocationsTable, eq(usersTable.id, liveLocationsTable.userId))
    .where(and(eq(usersTable.role, "rider"), eq(usersTable.isOnline, true)));

  if (riders.length === 0) { sendNotFound(res, "No riders online"); return; }

  let nearest = riders[0]!;
  if (vendorLat != null && vendorLng != null) {
    let minDist = Infinity;
    for (const r of riders) {
      const rLat = parseFloat(r.lat);
      const rLng = parseFloat(r.lng);
      if (isNaN(rLat) || isNaN(rLng)) continue;
      const d = haversineKm(vendorLat, vendorLng, rLat, rLng);
      if (d < minDist) { minDist = d; nearest = r; }
    }
  }

  const [updated] = await db.update(ordersTable)
    .set({ riderId: nearest.id, riderName: nearest.name, riderPhone: nearest.phone, assignedRiderId: nearest.id, assignedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(ordersTable.id, orderId),
      eq(ordersTable.vendorId, vendorId),
      isNull(ordersTable.riderId),
      or(eq(ordersTable.status, "confirmed"), eq(ordersTable.status, "preparing"), eq(ordersTable.status, "ready")),
    ))
    .returning();
  if (!updated) {
    const [order] = await db.select({ id: ordersTable.id, riderId: ordersTable.riderId, status: ordersTable.status, vendorId: ordersTable.vendorId })
      .from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
    if (!order) { sendNotFound(res, "Order not found"); return; }
    if (order.vendorId !== vendorId) { sendForbidden(res, "This order does not belong to your store"); return; }
    if (order.riderId) { sendError(res, "Order already has a rider assigned", 409); return; }
    sendError(res, `Order cannot be auto-assigned in '${order.status}' status`, 400); return;
  }

  await db.insert(notificationsTable).values({
    id: generateId(), userId: nearest.id,
    title: "📦 New Delivery Assigned (Auto)",
    body: `Order #${orderId.slice(-6).toUpperCase()} has been auto-assigned to you. Head to the vendor!`,
    type: "order", icon: "bicycle-outline",
  }).catch(() => {});

  const io = getIO();
  if (io) io.to(`user:${nearest.id}`).emit("order:assigned", { orderId });

  sendSuccess(res, { riderId: nearest.id, riderName: nearest.name });
});

export default router;
