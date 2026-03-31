import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { ordersTable, usersTable, walletTransactionsTable, promoCodesTable, productsTable, liveLocationsTable, notificationsTable } from "@workspace/db/schema";
import { eq, and, gte, count, desc, SQL, sql, inArray } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getPlatformSettings } from "./admin.js";
import { addSecurityEvent, getClientIp, getCachedSettings, customerAuth, idorGuard } from "../middleware/security.js";
import { getIO } from "../lib/socketio.js";

const router: IRouter = Router();

const idempotencyCache = new Map<string, any>();
const IDEMPOTENCY_TTL_MS = 5 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of idempotencyCache) {
    if (now - val._ts > IDEMPOTENCY_TTL_MS) idempotencyCache.delete(key);
  }
}, 60_000);

function broadcastNewOrder(order: ReturnType<typeof mapOrder>, vendorId?: string | null) {
  const io = getIO();
  if (!io) return;
  io.to("admin-fleet").emit("order:new", order);
  if (vendorId) {
    io.to(`vendor:${vendorId}`).emit("order:new", order);
  }
}

function broadcastOrderUpdate(order: ReturnType<typeof mapOrder>, vendorId?: string | null) {
  const io = getIO();
  if (!io) return;
  io.to("admin-fleet").emit("order:update", order);
  if (vendorId) {
    io.to(`vendor:${vendorId}`).emit("order:update", order);
  }
  if (order.riderId) {
    io.to(`rider:${order.riderId}`).emit("order:update", order);
  }
}

function broadcastWalletUpdate(userId: string, newBalance: number) {
  const io = getIO();
  if (!io) return;
  io.to(`user:${userId}`).emit("wallet:update", { balance: newBalance });
}

function mapOrder(o: typeof ordersTable.$inferSelect, deliveryFee?: number, gstAmount?: number, codFee?: number) {
  return {
    id: o.id,
    userId: o.userId,
    type: o.type,
    items: o.items as object[],
    status: o.status,
    total: parseFloat(o.total),
    deliveryFee: deliveryFee ?? 0,
    gstAmount: gstAmount ?? 0,
    codFee: codFee ?? 0,
    deliveryAddress: o.deliveryAddress,
    paymentMethod: o.paymentMethod,
    riderId: o.riderId,
    estimatedTime: o.estimatedTime,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

/* ── Promo code helper ─────────────────────────────────────────────────────── */
async function validatePromoCode(code: string, orderTotal: number, orderType: string): Promise<{
  valid: boolean; discount: number; discountType: "pct" | "flat" | null; error?: string;
  promoId?: string; maxDiscount?: number | null;
}> {
  const [promo] = await db.select().from(promoCodesTable)
    .where(eq(promoCodesTable.code, code.toUpperCase().trim())).limit(1);

  if (!promo)                                          return { valid: false, discount: 0, discountType: null, error: "Yeh promo code exist nahi karta." };
  if (!promo.isActive)                                 return { valid: false, discount: 0, discountType: null, error: "Yeh promo code active nahi hai." };
  if (promo.expiresAt && new Date() > promo.expiresAt) return { valid: false, discount: 0, discountType: null, error: "Yeh promo code expire ho gaya hai." };
  if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit)
    return { valid: false, discount: 0, discountType: null, error: "Yeh promo code apni limit reach kar chuka hai." };
  if (promo.minOrderAmount && orderTotal < parseFloat(String(promo.minOrderAmount)))
    return { valid: false, discount: 0, discountType: null, error: `Minimum order Rs. ${promo.minOrderAmount} hona chahiye is code ke liye.` };
  const ORDER_TYPE_ALIASES: Record<string, string[]> = {
    mart: ["mart", "grocery", "ajkmart"],
    grocery: ["grocery", "mart", "ajkmart"],
    ride: ["ride", "rides", "taxi"],
    school: ["school", "school_bus", "schoolbus"],
    parcel: ["parcel", "delivery", "courier"],
  };
  const normalizedType = orderType.toLowerCase().trim();
  const normalizedAppliesTo = (promo.appliesTo ?? "all").toLowerCase().trim();
  const typeAliases = ORDER_TYPE_ALIASES[normalizedType] ?? [normalizedType];
  const appliesToAliases = ORDER_TYPE_ALIASES[normalizedAppliesTo] ?? [normalizedAppliesTo];
  const typeMatches = normalizedAppliesTo === "all"
    || typeAliases.includes(normalizedAppliesTo)
    || appliesToAliases.includes(normalizedType);
  if (!typeMatches)
    return { valid: false, discount: 0, discountType: null, error: `Yeh code sirf ${promo.appliesTo} orders ke liye hai.` };

  let discount = 0;
  let discountType: "pct" | "flat" = "flat";
  if (promo.discountPct) {
    discountType = "pct";
    discount = Math.round(orderTotal * parseFloat(String(promo.discountPct)) / 100);
    if (promo.maxDiscount) discount = Math.min(discount, parseFloat(String(promo.maxDiscount)));
  } else if (promo.discountFlat) {
    discount = parseFloat(String(promo.discountFlat));
  }
  discount = Math.min(discount, orderTotal);
  return { valid: true, discount, discountType, promoId: promo.id, maxDiscount: promo.maxDiscount ? parseFloat(String(promo.maxDiscount)) : null };
}

/* ── POST /orders/validate-cart — Validate cart items against DB ── */
router.post("/validate-cart", async (req, res) => {
  const { items } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    res.json({ valid: true, items: [], removed: [], priceChanges: [] });
    return;
  }

  const productIds = items.map((it: any) => it.productId).filter(Boolean);
  if (productIds.length === 0) {
    res.json({ valid: true, items, removed: [], priceChanges: [] });
    return;
  }

  const dbProducts = await db.select({
    id: productsTable.id,
    price: productsTable.price,
    inStock: productsTable.inStock,
    name: productsTable.name,
  }).from(productsTable).where(inArray(productsTable.id, productIds));

  const productMap = new Map(dbProducts.map(p => [p.id, p]));
  const removed: string[] = [];
  const priceChanges: { productId: string; name: string; oldPrice: number; newPrice: number }[] = [];
  const validItems: any[] = [];

  for (const item of items) {
    const dbProduct = productMap.get(item.productId);
    if (!dbProduct || dbProduct.inStock === false) {
      removed.push(item.name || item.productId);
      continue;
    }
    const dbPrice = parseFloat(dbProduct.price);
    if (Math.abs(dbPrice - Number(item.price)) > 0.01) {
      priceChanges.push({ productId: item.productId, name: dbProduct.name || item.name, oldPrice: item.price, newPrice: dbPrice });
      validItems.push({ ...item, price: dbPrice });
    } else {
      validItems.push(item);
    }
  }

  res.json({
    valid: removed.length === 0 && priceChanges.length === 0,
    items: validItems,
    removed,
    priceChanges,
  });
});

/* ── GET /orders/validate-promo?code=&total=&type= ───────────────────────── */
router.get("/validate-promo", customerAuth, async (req, res) => {
  const code  = String(req.query["code"]  || "").trim();
  const total = parseFloat(String(req.query["total"] || "0"));
  const type  = String(req.query["type"]  || "mart");
  if (!code) { res.status(400).json({ valid: false, error: "code required" }); return; }
  const result = await validatePromoCode(code, total, type);
  res.json(result);
});

/* ── GET /orders?status=&page=&limit= ───────────────────────────────────── */
router.get("/", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const status = req.query["status"] as string;
  const page   = Math.max(1, parseInt(String(req.query["page"]  || "1"), 10));
  const limit  = Math.min(50, Math.max(1, parseInt(String(req.query["limit"] || "20"), 10)));
  const offset = (page - 1) * limit;

  const conditions: SQL[] = [eq(ordersTable.userId, userId)];
  if (status) conditions.push(eq(ordersTable.status, status));

  const [countRow] = await db.select({ total: count() }).from(ordersTable).where(and(...conditions));
  const total = countRow?.total ?? 0;

  const orders = await db.select().from(ordersTable)
    .where(and(...conditions))
    .orderBy(desc(ordersTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({
    orders: orders.map(o => mapOrder(o)),
    total,
    page,
    limit,
    hasMore: offset + orders.length < total,
  });
});

/* ── GET /orders/:id ──────────────────────────────────────────────────────── */
router.get("/:id", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, String(req.params["id"]))).limit(1);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (idorGuard(res, order.userId, userId)) return;
  res.json(mapOrder(order));
});

/* ── GET /orders/:id/track — Live rider location for active food/mart orders ── */
router.get("/:id/track", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const [order] = await db
    .select({ id: ordersTable.id, userId: ordersTable.userId, riderId: ordersTable.riderId, status: ordersTable.status })
    .from(ordersTable)
    .where(eq(ordersTable.id, String(req.params["id"])))
    .limit(1);

  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (order.userId !== userId) { res.status(403).json({ error: "Access denied" }); return; }

  const TRACKABLE = ["picked_up", "out_for_delivery", "in_transit"];
  let riderLat: number | null = null;
  let riderLng: number | null = null;
  let riderLocAge: number | null = null;

  if (order.riderId && TRACKABLE.includes(order.status)) {
    const [loc] = await db
      .select()
      .from(liveLocationsTable)
      .where(eq(liveLocationsTable.userId, order.riderId))
      .limit(1);
    if (loc) {
      riderLat     = parseFloat(String(loc.latitude));
      riderLng     = parseFloat(String(loc.longitude));
      riderLocAge  = Math.floor((Date.now() - new Date(loc.updatedAt).getTime()) / 1000);
    }
  }

  res.json({
    id: order.id,
    status: order.status,
    riderId: order.riderId,
    riderLat,
    riderLng,
    riderLocAge,
    trackable: TRACKABLE.includes(order.status),
  });
});

/* ── POST /orders ─────────────────────────────────────────────────────────── */
router.post("/", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const { type, items, deliveryAddress, paymentMethod } = req.body;
  const ip = getClientIp(req);

  const idempotencyKey = typeof req.headers["x-idempotency-key"] === "string"
    ? req.headers["x-idempotency-key"].trim()
    : typeof req.body?.idempotencyKey === "string"
    ? req.body.idempotencyKey.trim() : null;
  if (idempotencyKey) {
    const cached = idempotencyCache.get(`${userId}:${idempotencyKey}`);
    if (cached) {
      res.status(200).json(cached);
      return;
    }
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "items (array) required" }); return;
  }

  /* Per-item validation — prevents negative-price injection that could
     reduce the order total below what the customer is actually owed */
  const badItem = (items as any[]).find(
    (it) => !Number.isFinite(Number(it.price)) || Number(it.price) <= 0 ||
            !Number.isFinite(Number(it.quantity)) || Number(it.quantity) <= 0,
  );
  if (badItem) {
    res.status(400).json({ error: "Each item must have a valid positive price and quantity" }); return;
  }

  /* ── Server-side price verification — every item must have a productId ── */
  const missingProductId = (items as any[]).find((it: any) => !it.productId);
  if (missingProductId) {
    res.status(400).json({ error: "Each item must include a valid productId" }); return;
  }

  const productIds = (items as any[]).map((it: any) => it.productId);
  {
    const dbProducts = await db.select({
      id: productsTable.id,
      price: productsTable.price,
      inStock: productsTable.inStock,
      name: productsTable.name,
    }).from(productsTable).where(inArray(productsTable.id, productIds));

    const productMap = new Map(dbProducts.map(p => [p.id, p]));

    const unavailable: string[] = [];
    const priceChanges: string[] = [];

    for (const item of items as any[]) {
      const dbProduct = productMap.get(item.productId);
      if (!dbProduct) {
        unavailable.push(item.name || item.productId);
        continue;
      }
      if (dbProduct.inStock === false) {
        unavailable.push(dbProduct.name || item.productId);
        continue;
      }
      const dbPrice = parseFloat(dbProduct.price);
      if (Math.abs(dbPrice - Number(item.price)) > 0.01) {
        priceChanges.push(`${dbProduct.name}: Rs.${item.price} → Rs.${dbPrice}`);
        item.price = dbPrice;
      }
    }

    if (unavailable.length > 0) {
      res.status(400).json({
        error: `The following items are no longer available: ${unavailable.join(", ")}. Please remove them from your cart.`,
        unavailableItems: unavailable,
      });
      return;
    }

    if (priceChanges.length > 0) {
      res.status(409).json({
        error: `Prices have changed for some items: ${priceChanges.join("; ")}. Please review your cart.`,
        priceChanges,
      });
      return;
    }
  }  /* end price verification block */

  const itemsTotal = items.reduce(
    (sum: number, item: { price: number; quantity: number }) => sum + (item.price * item.quantity),
    0
  );

  if (itemsTotal <= 0) {
    res.status(400).json({ error: "Order total must be greater than 0" }); return;
  }

  /* ── Load platform settings once ── */
  const s = await getCachedSettings();

  /* ── 1st gate: service feature flags (fail-fast before any calculation) ── */
  if (type === "mart" && (s["feature_mart"] ?? "on") === "off") {
    res.status(503).json({ error: "Mart grocery service is currently unavailable. Please try again later." }); return;
  }
  if (type === "food" && (s["feature_food"] ?? "on") === "off") {
    res.status(503).json({ error: "Food delivery service is currently unavailable. Please try again later." }); return;
  }
  /* app_status maintenance gate */
  if ((s["app_status"] ?? "active") === "maintenance") {
    const mainKey = (s["security_maintenance_key"] ?? "").trim();
    const bypass  = ((req.headers["x-maintenance-key"] as string) ?? "").trim();
    if (!mainKey || bypass !== mainKey) {
      res.status(503).json({ error: s["content_maintenance_msg"] ?? "We're performing scheduled maintenance. Back soon!" }); return;
    }
  }

  /* ── Order rule checks ── */
  const minOrder = parseFloat(s["min_order_amount"] ?? "100");
  const vendorMinOrder = parseFloat(s["vendor_min_order"] ?? "100");
  const effectiveMinOrder = Math.max(minOrder, vendorMinOrder);
  if (itemsTotal < effectiveMinOrder) {
    res.status(400).json({ error: `Minimum order amount is Rs. ${effectiveMinOrder}` }); return;
  }

  const maxCart = parseFloat(s["order_max_cart_value"] ?? "50000");
  if (itemsTotal > maxCart) {
    res.status(400).json({ error: `Cart value cannot exceed Rs. ${maxCart}. Please split into multiple orders.` }); return;
  }

  /* ── Scheduled order gate ── */
  const scheduleEnabled = (s["order_schedule_enabled"] ?? "off") === "on";
  if (req.body.scheduledAt && !scheduleEnabled) {
    res.status(400).json({ error: "Scheduled orders are not available at this time." }); return;
  }

  /* ── Delivery fee calculation (from admin Delivery settings) ── */
  const feeMap: Record<string, string> = {
    mart:     "delivery_fee_mart",
    food:     "delivery_fee_food",
    pharmacy: "delivery_fee_pharmacy",
    parcel:   "delivery_fee_parcel",
  };
  const feeKey = feeMap[type] ?? "delivery_fee_mart";
  const baseFee = parseFloat(s[feeKey] ?? "80");

  /* Parcel: add per-kg fee if weight provided */
  const parcelPerKg  = parseFloat(s["delivery_parcel_per_kg"] ?? "40");
  const itemWeight   = type === "parcel" ? items.reduce((sum: number, it: any) => sum + (parseFloat(it.weightKg ?? "0")), 0) : 0;
  const rawDelivery  = baseFee + (type === "parcel" ? itemWeight * parcelPerKg : 0);

  /* Free delivery override */
  const freeEnabled = (s["delivery_free_enabled"] ?? "on") === "on";
  const freeAbove   = parseFloat(s["free_delivery_above"] ?? "1000");
  const deliveryFee = (freeEnabled && itemsTotal >= freeAbove) ? 0 : rawDelivery;

  /* ── GST (Finance settings) ── */
  const gstEnabled = (s["finance_gst_enabled"] ?? "off") === "on";
  const gstPct     = parseFloat(s["finance_gst_pct"] ?? "17");
  const gstAmount  = gstEnabled ? parseFloat(((itemsTotal * gstPct) / 100).toFixed(2)) : 0;

  /* ── COD service fee (cod_fee charged when total < cod_free_above threshold) ── */
  const codFee = (() => {
    if (paymentMethod !== "cash") return 0;
    const fee       = parseFloat(s["cod_fee"]        ?? "0");
    const freeAb    = parseFloat(s["cod_free_above"] ?? "2000");
    return (fee > 0 && itemsTotal < freeAb) ? fee : 0;
  })();

  let promoDiscount = 0;
  let promoId: string | null = null;
  const promoCode = req.body.promoCode as string | undefined;
  if (promoCode) {
    const promoResult = await validatePromoCode(promoCode, itemsTotal, type ?? "mart");
    if (!promoResult.valid) {
      res.status(400).json({ error: promoResult.error ?? "Invalid promo code" }); return;
    }
    promoDiscount = promoResult.discount;
    promoId = promoResult.promoId ?? null;
  }

  const total = Math.max(0, itemsTotal + deliveryFee + gstAmount + codFee - promoDiscount);

  /* ── Prep time from admin Order settings ── */
  const preptimeMin = parseInt(s["order_preptime_min"] ?? "15", 10);
  const estimatedTime = `${preptimeMin}–${preptimeMin + 20} min`;

  /* ── Fetch user for fraud checks ── */
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  /* ── Banned/inactive check ── */
  if (user.isBanned) {
    res.status(403).json({ error: "Your account has been suspended. You cannot place orders." }); return;
  }
  if (!user.isActive) {
    res.status(403).json({ error: "Your account is inactive. Please contact support." }); return;
  }

  /* ── Customer daily order cap (always enforced from Customer Settings) ── */
  const custMaxPerDay = parseInt(s["customer_max_orders_day"] ?? "20", 10);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [custDailyResult] = await db
    .select({ c: count() })
    .from(ordersTable)
    .where(and(eq(ordersTable.userId, userId), gte(ordersTable.createdAt, todayStart)));
  const custDailyCount = Number(custDailyResult?.c ?? 0);
  if (custDailyCount >= custMaxPerDay) {
    res.status(429).json({ error: `Aaj ke liye order limit (${custMaxPerDay} orders) reach ho gayi. Kal dobara try karein.` }); return;
  }

  /* ── Fake order / fraud detection ── */
  if (s["security_fake_order_detect"] === "on") {
    /* Max daily orders — security override (uses security_max_daily_orders) */
    const maxDailyOrders = parseInt(s["security_max_daily_orders"] ?? "20", 10);
    if (custDailyCount >= maxDailyOrders) {
      addSecurityEvent({ type: "daily_order_limit", ip, userId, details: `User ${userId} hit daily order limit: ${custDailyCount}/${maxDailyOrders}`, severity: "medium" });
      res.status(429).json({ error: `Daily order limit reached (${maxDailyOrders} orders per day). Please try again tomorrow.` }); return;
    }

    /* New account order limit (first 7 days) */
    const newAcctLimit = parseInt(s["security_new_acct_limit"] ?? "3", 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (user.createdAt > sevenDaysAgo) {
      const [totalOrdersResult] = await db
        .select({ c: count() })
        .from(ordersTable)
        .where(eq(ordersTable.userId, userId));
      const totalOrders = Number(totalOrdersResult?.c ?? 0);
      if (totalOrders >= newAcctLimit) {
        addSecurityEvent({ type: "new_account_limit", ip, userId, details: `New account ${userId} hit order limit: ${totalOrders}/${newAcctLimit}`, severity: "medium" });
        res.status(429).json({ error: `New accounts are limited to ${newAcctLimit} orders in the first 7 days. Please contact support if you need assistance.` }); return;
      }
    }

    /* Same address hourly limit */
    if (deliveryAddress) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const sameAddrLimit = parseInt(s["security_same_addr_limit"] ?? "5", 10);
      const sameAddrOrders = await db
        .select()
        .from(ordersTable)
        .where(and(eq(ordersTable.deliveryAddress, deliveryAddress), gte(ordersTable.createdAt, oneHourAgo)));
      if (sameAddrOrders.length >= sameAddrLimit) {
        addSecurityEvent({ type: "same_address_limit", ip, userId, details: `Same address limit hit: ${deliveryAddress} (${sameAddrOrders.length} orders/hr)`, severity: "high" });
        res.status(429).json({ error: `Too many orders to the same address. Please try again later.` }); return;
      }
    }
  }

  /* ── COD validation ── */
  if (paymentMethod === "cash") {
    const codEnabled = (s["cod_enabled"] ?? "on") === "on";
    if (!codEnabled) {
      res.status(400).json({ error: "Cash on Delivery is currently not available" }); return;
    }

    /* ── Per-service COD flag ── */
    const serviceKey = `cod_allowed_${type}` as const;
    const codAllowedForService = (s[serviceKey] ?? "on") !== "off";
    if (!codAllowedForService) {
      const label = type === "mart" ? "Mart" : type === "food" ? "Food" : type === "pharmacy" ? "Pharmacy" : "Parcel";
      res.status(400).json({ error: `Cash on Delivery is not available for ${label} orders. Please choose another payment method.` }); return;
    }

    const codMax = parseFloat(s["cod_max_amount"] ?? "5000");
    if (total > codMax) {
      res.status(400).json({ error: `Maximum Cash on Delivery order is Rs. ${codMax}. Please pay online for larger orders.` }); return;
    }

    /* ── COD verification threshold ── */
    const verifyThreshold = parseFloat(s["cod_verification_threshold"] ?? "0");
    if (verifyThreshold > 0 && total > verifyThreshold) {
      /* Mark order as requiring COD verification — stored in notes field or status;
         for now we allow the order but flag it (could block in future). */
    }
  }

  /* ── Online payment min/max limits (JazzCash, EasyPaisa, Bank Transfer) ── */
  const onlineMethods = ["jazzcash", "easypaisa", "bank"];
  if (onlineMethods.includes(paymentMethod)) {
    const payMinOnline = parseFloat(s["payment_min_online"] ?? "50");
    const payMaxOnline = parseFloat(s["payment_max_online"] ?? "100000");
    if (total < payMinOnline) {
      res.status(400).json({ error: `Minimum online payment is Rs. ${payMinOnline}` }); return;
    }
    if (total > payMaxOnline) {
      res.status(400).json({ error: `Maximum online payment is Rs. ${payMaxOnline}. Please split your order or use another method.` }); return;
    }
  }

  /* ── Wallet payment: deduct on placement ── */
  if (paymentMethod === "wallet") {
    const walletEnabled = (s["feature_wallet"] ?? "on") === "on";
    if (!walletEnabled) {
      res.status(400).json({ error: "Wallet payments are currently disabled" }); return;
    }

    const [walletUser] = await db.select({ blockedServices: usersTable.blockedServices }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (walletUser && (walletUser.blockedServices || "").split(",").map(s2 => s2.trim()).includes("wallet")) {
      res.status(403).json({ error: "wallet_frozen", message: "Your wallet has been temporarily frozen. Contact support." }); return;
    }

    try {
      const order = await db.transaction(async (tx) => {
        const [freshUser] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
        if (!freshUser) throw new Error("User not found");

        const balance = parseFloat(freshUser.walletBalance ?? "0");
        if (balance < total) throw new Error(`Insufficient wallet balance. Balance: Rs. ${balance.toFixed(0)}, Required: Rs. ${total.toFixed(0)}`);

        /* DB floor guard — deducts only if balance ≥ amount at UPDATE time,
           eliminating negative-balance race even when pre-flight checks pass concurrently */
        const [deducted] = await tx.update(usersTable)
          .set({ walletBalance: sql`wallet_balance - ${total.toFixed(2)}` })
          .where(and(eq(usersTable.id, userId), gte(usersTable.walletBalance, total.toFixed(2))))
          .returning({ id: usersTable.id });
        if (!deducted) throw new Error(`Insufficient wallet balance. Required: Rs. ${total.toFixed(0)}`);
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId, type: "debit",
          amount: total.toFixed(2),
          description: `Order payment (${type || "mart"}) — Rs. ${total.toFixed(0)}`,
        });

        const [newOrder] = await tx.insert(ordersTable).values({
          id: generateId(), userId, type, items,
          status: "pending", total: total.toFixed(2),
          deliveryAddress, paymentMethod,
          estimatedTime,
        }).returning();
        if (promoId) {
          await tx.update(promoCodesTable)
            .set({ usedCount: sql`${promoCodesTable.usedCount} + 1` })
            .where(eq(promoCodesTable.id, promoId))
            .catch(() => {});
        }
        return newOrder!;
      });
      const mapped = { ...mapOrder(order, deliveryFee, gstAmount, codFee), promoDiscount };
      broadcastNewOrder(mapped, (order as any).vendorId);

      const [updatedUser] = await db.select({ walletBalance: usersTable.walletBalance }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (updatedUser) broadcastWalletUpdate(userId, parseFloat(updatedUser.walletBalance ?? "0"));

      res.status(201).json(mapped);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
    return;
  }

  /* ── Cash / JazzCash / EasyPaisa / Bank ── */
  const [order] = await db.insert(ordersTable).values({
    id: generateId(), userId, type, items,
    status: "pending", total: total.toFixed(2),
    deliveryAddress, paymentMethod,
    estimatedTime,
  }).returning();
  if (promoId) {
    await db.update(promoCodesTable)
      .set({ usedCount: sql`${promoCodesTable.usedCount} + 1` })
      .where(eq(promoCodesTable.id, promoId))
      .catch(() => {});
  }
  const mapped = { ...mapOrder(order!, deliveryFee, gstAmount, codFee), promoDiscount };
  broadcastNewOrder(mapped, (order as any).vendorId);
  if (idempotencyKey) {
    idempotencyCache.set(`${userId}:${idempotencyKey}`, { ...mapped, _ts: Date.now() });
  }
  res.status(201).json(mapped);
});

/* ── PATCH /orders/:id/cancel — customer cancel only ────────────────────── */
router.patch("/:id/cancel", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 200) : null;

  const [existingOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, String(req.params["id"]))).limit(1);
  if (!existingOrder) { res.status(404).json({ error: "Order not found" }); return; }

  /* Only the order owner can cancel */
  if (existingOrder.userId !== userId) {
    res.status(403).json({ error: "You cannot cancel another user's order." }); return;
  }

  /* Enforce cancel window */
  const s = await getCachedSettings();
  const cancelWindowMin = parseInt(s["order_cancel_window_min"] ?? "5", 10);
  const ageMs = Date.now() - new Date(existingOrder.createdAt).getTime();
  const ageMin = ageMs / 60_000;
  if (ageMin > cancelWindowMin) {
    res.status(400).json({
      error: `Orders can only be cancelled within ${cancelWindowMin} minutes of placement. Please contact support.`,
    }); return;
  }

  /* Only pending/confirmed orders can be customer-cancelled */
  if (!["pending", "confirmed"].includes(existingOrder.status)) {
    res.status(400).json({ error: "This order can no longer be cancelled." }); return;
  }

  const isWallet = existingOrder.paymentMethod === "wallet";
  const refundAmount = isWallet ? parseFloat(String(existingOrder.total)) : 0;

  try {
    const order = await db.transaction(async (tx) => {
      const [cancelled] = await tx.update(ordersTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(
          eq(ordersTable.id, String(req.params["id"])),
          eq(ordersTable.userId, userId),
          inArray(ordersTable.status, ["pending", "confirmed"]),
        ))
        .returning();
      if (!cancelled) throw new Error("Order already cancelled or no longer cancellable");

      if (isWallet && refundAmount > 0) {
        await tx.update(usersTable)
          .set({ walletBalance: sql`wallet_balance + ${refundAmount.toFixed(2)}` })
          .where(eq(usersTable.id, userId));
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId, type: "credit",
          amount: refundAmount.toFixed(2),
          description: `Refund for cancelled order #${cancelled.id.slice(-6).toUpperCase()}`,
          reference: `refund:${cancelled.id}`,
        });
      }

      return cancelled;
    });

    if (isWallet && refundAmount > 0) {
      const [updatedUser] = await db.select({ walletBalance: usersTable.walletBalance }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (updatedUser) broadcastWalletUpdate(userId, parseFloat(updatedUser.walletBalance ?? "0"));
    }

    broadcastOrderUpdate(mapOrder(order), (order as any).vendorId);

    if (reason) {
      req.log?.info({ orderId: order.id, reason }, "Order cancelled with reason");
    }

    res.json({
      ...mapOrder(order),
      refundAmount,
      refundMethod: isWallet ? "wallet" : null,
      cancelReason: reason,
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message || "Could not cancel order" });
  }
});

export default router;
