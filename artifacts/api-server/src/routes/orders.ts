import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { ordersTable, usersTable, walletTransactionsTable, promoCodesTable, productsTable, liveLocationsTable, notificationsTable } from "@workspace/db/schema";
import { eq, and, gte, count, desc, SQL, sql, inArray } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getPlatformSettings } from "./admin.js";
import { addSecurityEvent, addAuditEntry, getClientIp, getCachedSettings, customerAuth, idorGuard } from "../middleware/security.js";
import { getIO, emitRiderNewRequest } from "../lib/socketio.js";
import { calcDeliveryFee, calcGst, calcCodFee } from "../lib/fees.js";
import { isInServiceZone } from "../lib/geofence.js";
import { checkDeliveryEligibility } from "../lib/delivery-access.js";
import { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden, sendValidationError, sendErrorWithData } from "../lib/response.js";

const router: IRouter = Router();

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, "").trim();

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
  /* Push status change to the customer in real-time so the app reflects
     admin/vendor updates instantly without waiting for the 10-second poll. */
  if (order.userId) {
    io.to(`user:${order.userId}`).emit("order:update", order);
  }
  /* Also emit to the order-specific room so open order-detail screens
     that joined order:{id} receive live status updates. */
  io.to(`order:${order.id}`).emit("order:update", order);
}

function broadcastWalletUpdate(userId: string, newBalance: number) {
  const io = getIO();
  if (!io) return;
  io.to(`user:${userId}`).emit("wallet:update", { balance: newBalance });
}

/**
 * After a new order is created, find all online riders (recently active within 10 min)
 * and push a socket event so their Home screen invalidates the requests query immediately.
 * This is fire-and-forget — never throws, never blocks the response.
 */
async function notifyOnlineRidersOfOrder(orderId: string, orderType: string): Promise<void> {
  try {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    /* Filter strictly to riders (role='rider') who are marked online — prevents
       non-rider accounts (customers, vendors, service providers) from receiving
       rider:new-request events, avoiding cross-role metadata leakage. */
    const onlineRiders = await db
      .select({ userId: liveLocationsTable.userId })
      .from(liveLocationsTable)
      .innerJoin(usersTable, eq(liveLocationsTable.userId, usersTable.id))
      .where(and(
        eq(liveLocationsTable.role, "rider"),
        eq(usersTable.role, "rider"),
        eq(usersTable.isOnline, true),
        gte(liveLocationsTable.updatedAt, tenMinAgo),
      ));
    for (const { userId } of onlineRiders) {
      /* Retry up to 3 times with exponential backoff (200 ms, 400 ms, 800 ms).
         Socket emissions are best-effort — we log and give up after all retries. */
      let lastErr: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          emitRiderNewRequest(userId, { type: "order", requestId: orderId, summary: orderType });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          console.error(`[notifyRiders] Attempt ${attempt}/3 failed for rider ${userId}, order ${orderId}:`, err);
          if (attempt < 3) {
            await new Promise(r => setTimeout(r, 200 * attempt));
          }
        }
      }
      if (lastErr) {
        console.error(`[notifyRiders] All 3 attempts exhausted for rider ${userId}, order ${orderId}. Rider will not receive real-time notification.`);
      }
    }
  } catch (err) {
    console.error(`[notifyRiders] Failed to query online riders for order ${orderId}:`, err);
  }
}


function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
    paymentStatus: o.paymentStatus ?? "pending",
    refundStatus: o.refundedAt ? "refunded"
      : o.paymentStatus === "refund_approved" ? "approved"
      : o.paymentStatus === "refund_requested" ? "requested"
      : null,
    riderId: o.riderId,
    riderName: o.riderName ?? null,
    riderPhone: o.riderPhone ?? null,
    vendorId: o.vendorId ?? null,
    estimatedTime: o.estimatedTime,
    customerLat: o.customerLat ? parseFloat(o.customerLat) : null,
    customerLng: o.customerLng ? parseFloat(o.customerLng) : null,
    gpsAccuracy: o.gpsAccuracy ?? null,
    gpsMismatch: o.gpsMismatch ?? false,
    deliveryLat: o.deliveryLat ? parseFloat(o.deliveryLat) : null,
    deliveryLng: o.deliveryLng ? parseFloat(o.deliveryLng) : null,
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
    sendSuccess(res, { valid: true, items: [], removed: [], priceChanges: [] });
    return;
  }

  const productIds = items.map((it: Record<string, unknown>) => it.productId).filter(Boolean);
  if (productIds.length === 0) {
    sendSuccess(res, { valid: true, items, removed: [], priceChanges: [] });
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
  const validItems: unknown[] = [];

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

  sendSuccess(res, {
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
  if (!code) { sendValidationError(res, "code required"); return; }
  const result = await validatePromoCode(code, total, type);
  sendSuccess(res, result);
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

  sendSuccess(res, {
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
  if (!order) { sendNotFound(res, "Order not found"); return; }
  if (idorGuard(res, order.userId, userId)) return;
  const s = await getCachedSettings();
  const orderItems = (order.items ?? []) as { price: number; quantity: number }[];
  const itemsTotal = orderItems.reduce((sum, it) => sum + (Number(it.price) * Number(it.quantity)), 0);
  const deliveryFee = calcDeliveryFee(s, order.type, itemsTotal);
  const gstAmount   = calcGst(s, itemsTotal);
  const codFee      = calcCodFee(s, order.paymentMethod, itemsTotal + deliveryFee + gstAmount);

  /* Fetch vendor display name so the order detail screen can show it */
  let vendorName: string | null = null;
  if (order.vendorId) {
    const [vendor] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, order.vendorId))
      .limit(1);
    vendorName = vendor?.name ?? null;
  }

  sendSuccess(res, { ...mapOrder(order, deliveryFee, gstAmount, codFee), vendorName });
});

/* ── GET /orders/:id/track — Live rider location for active food/mart orders ── */
router.get("/:id/track", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const [order] = await db
    .select({
      id: ordersTable.id,
      userId: ordersTable.userId,
      riderId: ordersTable.riderId,
      riderName: ordersTable.riderName,
      riderPhone: ordersTable.riderPhone,
      status: ordersTable.status,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, String(req.params["id"])))
    .limit(1);

  if (!order) { sendNotFound(res, "Order not found"); return; }
  if (order.userId !== userId) { sendForbidden(res, "Access denied"); return; }

  /* Include all statuses where a rider may be en-route so parcel/ride
     orders in "accepted"/"arrived" state also return live coordinates. */
  const TRACKABLE = ["picked_up", "out_for_delivery", "in_transit", "accepted", "arrived"];
  let riderLat: number | null = null;
  let riderLng: number | null = null;
  let riderLocAge: number | null = null;

  let riderName = order.riderName ?? null;
  let riderPhone = order.riderPhone ?? null;

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

    /* Fall back to users table if riderName/riderPhone not stored directly on order */
    if (!riderName || !riderPhone) {
      const [riderUser] = await db
        .select({ name: usersTable.name, phone: usersTable.phone })
        .from(usersTable)
        .where(eq(usersTable.id, order.riderId))
        .limit(1);
      riderName  = riderName  ?? riderUser?.name  ?? null;
      riderPhone = riderPhone ?? riderUser?.phone ?? null;
    }
  }

  sendSuccess(res, {
    id: order.id,
    status: order.status,
    riderId: order.riderId,
    riderName,
    riderPhone,
    riderLat,
    riderLng,
    riderLocAge,
    trackable: TRACKABLE.includes(order.status),
  });
});

/* ── POST /orders ─────────────────────────────────────────────────────────── */
router.post("/", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const { type, items, paymentMethod, deliveryLat, deliveryLng, customerLat: rawCustLat, customerLng: rawCustLng, gpsAccuracy: rawGpsAcc } = req.body;
  const deliveryAddress = typeof req.body.deliveryAddress === "string" ? stripHtml(req.body.deliveryAddress) : req.body.deliveryAddress;
  const ip = getClientIp(req);

  const idempotencyKey = typeof req.headers["x-idempotency-key"] === "string"
    ? req.headers["x-idempotency-key"].trim()
    : typeof req.body?.idempotencyKey === "string"
    ? req.body.idempotencyKey.trim() : null;
  if (idempotencyKey) {
    const cached = idempotencyCache.get(`${userId}:${idempotencyKey}`);
    if (cached) {
      sendSuccess(res, cached);
      return;
    }
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    sendValidationError(res, "items (array) required"); return;
  }

  /* Per-item validation — prevents negative-price injection that could
     reduce the order total below what the customer is actually owed */
  const badItem = (items as Array<Record<string, unknown>>).find(
    (it) => !Number.isFinite(Number(it.price)) || Number(it.price) <= 0 ||
            !Number.isFinite(Number(it.quantity)) || Number(it.quantity) <= 0,
  );
  if (badItem) {
    sendValidationError(res, "Each item must have a valid positive price and quantity"); return;
  }

  /* ── Server-side price verification — every item must have a productId ── */
  const missingProductId = (items as Array<Record<string, unknown>>).find((it: Record<string, unknown>) => !it.productId);
  if (missingProductId) {
    sendValidationError(res, "Each item must include a valid productId"); return;
  }

  const productIds = (items as Array<Record<string, unknown>>).map((it: Record<string, unknown>) => it.productId);
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
      sendErrorWithData(res, `The following items are no longer available: ${unavailable.join(", ")}. Please remove them from your cart.`, { unavailableItems: unavailable }, 400);
      return;
    }

    if (priceChanges.length > 0) {
      sendErrorWithData(res, `Prices have changed for some items: ${priceChanges.join("; ")}. Please review your cart.`, { priceChanges }, 409);
      return;
    }
  }  /* end price verification block */

  const itemsTotal = items.reduce(
    (sum: number, item: { price: number; quantity: number }) => sum + (item.price * item.quantity),
    0
  );

  if (itemsTotal <= 0) {
    sendValidationError(res, "Order total must be greater than 0"); return;
  }

  /* ── Load platform settings once ── */
  const s = await getCachedSettings();

  /* ── Geofence: check delivery coordinates if provided ── */
  if ((s["security_geo_fence"] ?? "off") === "on" && deliveryLat != null && deliveryLng != null) {
    const dLat = parseFloat(String(deliveryLat));
    const dLng = parseFloat(String(deliveryLng));
    if (Number.isFinite(dLat) && Number.isFinite(dLng)) {
      const zoneCheck = await isInServiceZone(dLat, dLng, "orders");
      if (!zoneCheck.allowed) {
        sendError(res, "Delivery address is outside our service area. We currently only operate in configured service zones.", 422); return;
      }
    }
  }

  /* ── 1st gate: service feature flags (fail-fast before any calculation) ── */
  if (type === "mart" && (s["feature_mart"] ?? "on") === "off") {
    sendError(res, "Mart grocery service is currently unavailable. Please try again later.", 503); return;
  }
  if (type === "food" && (s["feature_food"] ?? "on") === "off") {
    sendError(res, "Food delivery service is currently unavailable. Please try again later.", 503); return;
  }
  /* app_status maintenance gate */
  if ((s["app_status"] ?? "active") === "maintenance") {
    const mainKey = (s["security_maintenance_key"] ?? "").trim();
    const bypass  = ((req.headers["x-maintenance-key"] as string) ?? "").trim();
    if (!mainKey || bypass !== mainKey) {
      sendError(res, s["content_maintenance_msg"] ?? "We're performing scheduled maintenance. Back soon!", 503); return;
    }
  }

  /* ── Resolve vendorId from first product if not provided ── */
  let resolvedVendorId = (req.body.vendorId as string | undefined) || null;
  if (!resolvedVendorId && items.length > 0) {
    try {
      const firstProductId = items[0].productId;
      if (firstProductId) {
        const [prod] = await db.select({ vendorId: productsTable.vendorId })
          .from(productsTable)
          .where(eq(productsTable.id, firstProductId))
          .limit(1);
        resolvedVendorId = prod?.vendorId ?? null;
      }
    } catch (err) {
      console.warn(`[orders] Failed to resolve vendorId from product for user ${userId}:`, err);
    }
  }

  /* ── Delivery access eligibility ── */
  if (paymentMethod !== "pickup") {
    const eligibility = await checkDeliveryEligibility(userId, resolvedVendorId, type ?? "mart");
    if (!eligibility.eligible) {
      const reason = eligibility.reason === "store_not_whitelisted"
        ? "Delivery is not available for this store. Please choose self-pickup."
        : eligibility.reason === "user_not_whitelisted"
        ? "Delivery is not available for your account. Please choose self-pickup."
        : "Delivery is not available. Please choose self-pickup.";
      res.status(403).json({
        success: false,
        error: reason,
        reasonCode: "delivery_not_eligible",
        detailCode: eligibility.reason,
      });
      return;
    }
  }

  /* ── Order rule checks ── */
  const minOrder = parseFloat(s["min_order_amount"] ?? "100");
  const vendorMinOrder = parseFloat(s["vendor_min_order"] ?? "100");
  const effectiveMinOrder = Math.max(minOrder, vendorMinOrder);
  if (itemsTotal < effectiveMinOrder) {
    sendValidationError(res, `Minimum order amount is Rs. ${effectiveMinOrder}`); return;
  }

  const maxCart = parseFloat(s["order_max_cart_value"] ?? "50000");
  if (itemsTotal > maxCart) {
    sendValidationError(res, `Cart value cannot exceed Rs. ${maxCart}. Please split into multiple orders.`); return;
  }

  /* ── Scheduled order gate ── */
  const scheduleEnabled = (s["order_schedule_enabled"] ?? "off") === "on";
  if (req.body.scheduledAt && !scheduleEnabled) {
    sendValidationError(res, "Scheduled orders are not available at this time."); return;
  }

  /* ── Delivery fee, GST, COD fee — via shared utility (see lib/fees.ts) ── */
  const itemWeight  = type === "parcel"
    ? items.reduce((sum: number, it: any) => sum + parseFloat(it.weightKg ?? "0"), 0)
    : 0;
  const deliveryFee = calcDeliveryFee(s, type, itemsTotal, itemWeight);
  const gstAmount   = calcGst(s, itemsTotal);
  const codFee      = calcCodFee(s, paymentMethod, itemsTotal + deliveryFee + gstAmount);

  let promoDiscount = 0;
  let promoId: string | null = null;
  const promoCode = req.body.promoCode as string | undefined;
  if (promoCode) {
    const promoResult = await validatePromoCode(promoCode, itemsTotal, type ?? "mart");
    if (!promoResult.valid) {
      sendValidationError(res, promoResult.error ?? "Invalid promo code"); return;
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
  if (!user) { sendNotFound(res, "User not found"); return; }

  /* ── Banned/inactive check ── */
  if (user.isBanned) {
    sendForbidden(res, "Your account has been suspended. You cannot place orders."); return;
  }
  if (!user.isActive) {
    sendForbidden(res, "Your account is inactive. Please contact support."); return;
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
    sendError(res, `Aaj ke liye order limit (${custMaxPerDay} orders) reach ho gayi. Kal dobara try karein.`, 429); return;
  }

  /* ── Fake order / fraud detection ── */
  if (s["security_fake_order_detect"] === "on") {
    /* Max daily orders — security override (uses security_max_daily_orders) */
    const maxDailyOrders = parseInt(s["security_max_daily_orders"] ?? "20", 10);
    if (custDailyCount >= maxDailyOrders) {
      addSecurityEvent({ type: "daily_order_limit", ip, userId, details: `User ${userId} hit daily order limit: ${custDailyCount}/${maxDailyOrders}`, severity: "medium" });
      sendError(res, `Daily order limit reached (${maxDailyOrders} orders per day). Please try again tomorrow.`, 429); return;
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
        sendError(res, `New accounts are limited to ${newAcctLimit} orders in the first 7 days. Please contact support if you need assistance.`, 429); return;
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
        sendError(res, `Too many orders to the same address. Please try again later.`, 429); return;
      }
    }
  }

  /* ── GPS fraud-stamp: compare device GPS to selected delivery address coords ── */
  const gpsEnabled = (s["order_gps_capture_enabled"] ?? "off") === "on";
  const custLat = gpsEnabled && rawCustLat != null ? parseFloat(String(rawCustLat)) : NaN;
  const custLng = gpsEnabled && rawCustLng != null ? parseFloat(String(rawCustLng)) : NaN;
  const custAcc = rawGpsAcc != null ? parseFloat(String(rawGpsAcc)) : null;
  const hasCustGps = Number.isFinite(custLat) && Number.isFinite(custLng)
    && custLat >= -90 && custLat <= 90 && custLng >= -180 && custLng <= 180;

  let resolvedDeliveryLat = deliveryLat != null ? parseFloat(String(deliveryLat)) : NaN;
  let resolvedDeliveryLng = deliveryLng != null ? parseFloat(String(deliveryLng)) : NaN;
  if ((!Number.isFinite(resolvedDeliveryLat) || !Number.isFinite(resolvedDeliveryLng)) && deliveryAddress && hasCustGps) {
    try {
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(deliveryAddress)}&format=json&limit=1`,
        { headers: { "User-Agent": "AJKMart/1.0" }, signal: AbortSignal.timeout(3000) },
      );
      const geoData = await geoRes.json();
      if (Array.isArray(geoData) && geoData.length > 0) {
        const gLat = parseFloat(geoData[0].lat);
        const gLng = parseFloat(geoData[0].lon);
        if (Number.isFinite(gLat) && Number.isFinite(gLng)) {
          resolvedDeliveryLat = gLat;
          resolvedDeliveryLng = gLng;
        }
      }
    } catch (err) {
      console.warn(`[orders] Geocoding delivery address failed (user ${userId}); coordinates will be omitted from order:`, err);
    }
  }

  const hasResolvedDelivery = Number.isFinite(resolvedDeliveryLat) && Number.isFinite(resolvedDeliveryLng)
    && resolvedDeliveryLat >= -90 && resolvedDeliveryLat <= 90
    && resolvedDeliveryLng >= -180 && resolvedDeliveryLng <= 180;

  let gpsMismatch = false;
  if (hasCustGps && hasResolvedDelivery) {
    const thresholdM = Math.max(100, parseFloat(s["gps_mismatch_threshold_m"] ?? "500") || 500);
    const dist = haversineMetres(custLat, custLng, resolvedDeliveryLat, resolvedDeliveryLng);
    if (dist > thresholdM) gpsMismatch = true;
  }
  const gpsInsert = {
    ...(hasCustGps ? { customerLat: custLat.toFixed(7), customerLng: custLng.toFixed(7), gpsAccuracy: custAcc, gpsMismatch } : {}),
    ...(hasResolvedDelivery ? { deliveryLat: resolvedDeliveryLat.toFixed(7), deliveryLng: resolvedDeliveryLng.toFixed(7) } : {}),
  };

  /* ── COD validation ── */
  if (paymentMethod === "cash") {
    const codEnabled = (s["cod_enabled"] ?? "on") === "on";
    if (!codEnabled) {
      sendValidationError(res, "Cash on Delivery is currently not available"); return;
    }

    /* ── Per-service COD flag ── */
    const serviceKey = `cod_allowed_${type}` as const;
    const codAllowedForService = (s[serviceKey] ?? "on") !== "off";
    if (!codAllowedForService) {
      const label = type === "mart" ? "Mart" : type === "food" ? "Food" : type === "pharmacy" ? "Pharmacy" : "Parcel";
      sendValidationError(res, `Cash on Delivery is not available for ${label} orders. Please choose another payment method.`); return;
    }

    const codMax = parseFloat(s["cod_max_amount"] ?? "5000");
    if (total > codMax) {
      sendValidationError(res, `Maximum Cash on Delivery order is Rs. ${codMax}. Please pay online for larger orders.`); return;
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
      sendValidationError(res, `Minimum online payment is Rs. ${payMinOnline}`); return;
    }
    if (total > payMaxOnline) {
      sendValidationError(res, `Maximum online payment is Rs. ${payMaxOnline}. Please split your order or use another method.`); return;
    }
  }

  /* ── Wallet payment: deduct on placement ── */
  if (paymentMethod === "wallet") {
    const walletEnabled = (s["feature_wallet"] ?? "on") === "on";
    if (!walletEnabled) {
      sendValidationError(res, "Wallet payments are currently disabled"); return;
    }

    const [walletUser] = await db.select({ blockedServices: usersTable.blockedServices }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (walletUser && (walletUser.blockedServices || "").split(",").map(s2 => s2.trim()).includes("wallet")) {
      sendForbidden(res, "wallet_frozen", "Your wallet has been temporarily frozen. Contact support."); return;
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
          ...gpsInsert,
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

      /* ── Emit new-order to admin/vendor IMMEDIATELY after DB commit ── */
      broadcastNewOrder(mapped, (order as any).vendorId);

      /* ── Two-Way ACK: confirm order receipt back to the customer ── */
      const io = getIO();
      if (io) io.to(`user:${userId}`).emit("order:ack", { orderId: order.id, status: "pending", createdAt: order.createdAt.toISOString() });

      /* ── Broadcast updated wallet balance to all customer devices ── */
      const [updatedUser] = await db.select({ walletBalance: usersTable.walletBalance }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (updatedUser) {
        const newBalance = parseFloat(updatedUser.walletBalance ?? "0");
        broadcastWalletUpdate(userId, newBalance);
        if (io) io.to(`user:${userId}`).emit("wallet:balance", { balance: newBalance });
      }

      sendCreated(res, mapped);
      notifyOnlineRidersOfOrder(order.id, type || "mart").catch(() => {});
    } catch (e: unknown) {
      sendValidationError(res, (e as Error).message);
    }
    return;
  }

  /* ── Cash / JazzCash / EasyPaisa / Bank — wrapped in try/catch to prevent unhandled rejections ── */
  try {
    const [order] = await db.transaction(async (tx) => {
      const [newOrder] = await tx.insert(ordersTable).values({
        id: generateId(), userId, type, items,
        status: "pending", total: total.toFixed(2),
        deliveryAddress, paymentMethod,
        estimatedTime,
        ...gpsInsert,
      }).returning();
      if (promoId) {
        await tx.update(promoCodesTable)
          .set({ usedCount: sql`${promoCodesTable.usedCount} + 1` })
          .where(eq(promoCodesTable.id, promoId));
      }
      return [newOrder];
    });
    const mapped = { ...mapOrder(order!, deliveryFee, gstAmount, codFee), promoDiscount };

    /* ── Emit to admin IMMEDIATELY after DB commit (Task 7: <500ms latency) ── */
    broadcastNewOrder(mapped, (order as any)?.vendorId);

    /* ── Two-Way ACK for non-wallet orders ── */
    const io = getIO();
    if (io) io.to(`user:${userId}`).emit("order:ack", { orderId: order!.id, status: "pending", createdAt: order!.createdAt.toISOString() });

    if (idempotencyKey) {
      idempotencyCache.set(`${userId}:${idempotencyKey}`, { ...mapped, _ts: Date.now() });
    }
    sendCreated(res, mapped);
    notifyOnlineRidersOfOrder(order!.id, type || "mart").catch(() => {});
  } catch (e: unknown) {
    sendError(res, "Order could not be created. Please try again.", 500);
  }
});

/* ── PATCH /orders/:id/cancel — customer cancel only ────────────────────── */
router.patch("/:id/cancel", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 200) : null;

  const [existingOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, String(req.params["id"]))).limit(1);
  if (!existingOrder) { sendNotFound(res, "Order not found"); return; }

  /* Only the order owner can cancel */
  if (existingOrder.userId !== userId) {
    sendForbidden(res, "You cannot cancel another user's order."); return;
  }

  /* Enforce cancel window */
  const s = await getCachedSettings();
  const cancelWindowMin = parseInt(s["order_cancel_window_min"] ?? "5", 10);
  const ageMs = Date.now() - new Date(existingOrder.createdAt).getTime();
  const ageMin = ageMs / 60_000;
  if (ageMin > cancelWindowMin) {
    sendValidationError(res, `Orders can only be cancelled within ${cancelWindowMin} minutes of placement. Please contact support.`); return;
  }

  /* Only pending/confirmed orders can be customer-cancelled */
  if (!["pending", "confirmed"].includes(existingOrder.status)) {
    sendValidationError(res, "This order can no longer be cancelled."); return;
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

    addAuditEntry({
      action: "order_cancel",
      ip: getClientIp(req),
      details: `Customer [${userId}] cancelled order ${order.id}${reason ? ` — reason: ${reason}` : ""}${isWallet && refundAmount > 0 ? ` (refunded Rs.${refundAmount.toFixed(0)})` : ""}`,
      result: "success",
    });

    if (reason) {
      req.log?.info({ orderId: order.id, reason }, "Order cancelled with reason");
    }

    sendSuccess(res, {
      ...mapOrder(order),
      refundAmount,
      refundMethod: isWallet ? "wallet" : null,
      cancelReason: reason,
    });
  } catch (e: unknown) {
    sendValidationError(res, (e as Error).message || "Could not cancel order");
  }
});

router.post("/:id/refund-request", customerAuth, async (req, res) => {
  const orderId = req.params.id;
  const userId = req.customerId!;

  try {
    const [order] = await db.select().from(ordersTable)
      .where(and(eq(ordersTable.id, orderId), eq(ordersTable.userId, userId)))
      .limit(1);

    if (!order) { sendNotFound(res, "Order not found"); return; }

    if (!["delivered", "completed"].includes(order.status)) {
      sendValidationError(res, "Refund can only be requested for delivered orders");
      return;
    }

    if (order.paymentMethod === "cod" || order.paymentMethod === "cash") {
      sendValidationError(res, "Cash orders are not eligible for refund");
      return;
    }

    if (order.paymentStatus === "refund_requested" || order.refundedAt) {
      sendValidationError(res, "Refund has already been requested for this order");
      return;
    }

    const now = new Date();
    await db.update(ordersTable)
      .set({ paymentStatus: "refund_requested", updatedAt: now })
      .where(eq(ordersTable.id, orderId));

    const updatedOrder = { ...order, paymentStatus: "refund_requested" as typeof order.paymentStatus };
    broadcastOrderUpdate(mapOrder(updatedOrder), order.vendorId);

    sendSuccess(res, { refundStatus: "requested" }, "Refund request submitted");
  } catch (e: unknown) {
    sendError(res, (e as Error).message || "Could not process refund request", 500);
  }
});

export default router;
