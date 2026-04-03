import { Router } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  walletTransactionsTable,
  notificationsTable,
  ordersTable, pharmacyOrdersTable, parcelBookingsTable, ridesTable,
} from "@workspace/db/schema";
import { eq, desc, count, sum, and, gte, lte, sql, or, ilike, asc, isNull, isNotNull, avg, ne } from "drizzle-orm";
import {
  stripUser, generateId, getUserLanguage, t,
  getPlatformSettings, adminAuth, getAdminSecret,
  sendUserNotification, logger,
  ORDER_NOTIF_KEYS, RIDE_NOTIF_KEYS, PHARMACY_NOTIF_KEYS, PARCEL_NOTIF_KEYS,
  checkAdminLoginLockout, recordAdminLoginFailure, resetAdminLoginAttempts,
  addAuditEntry, addSecurityEvent, getClientIp,
  signAdminJwt, verifyAdminJwt, invalidateSettingsCache, getCachedSettings,
  ADMIN_TOKEN_TTL_HRS, verifyTotpToken, verifyAdminSecret,
  ensureDefaultRideServices, ensureDefaultLocations, formatSvc,
  type AdminRequest, revokeAllUserSessions,
} from "../admin-shared.js";
import { sendSuccess, sendError, sendNotFound, sendValidationError, sendErrorWithData } from "../../lib/response.js";

const router = Router();
router.get("/orders", async (req, res) => {
  const { status, type, limit: lim } = req.query;
  const orders = await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt)).limit(Number(lim) || 200);

  const filtered = orders
    .filter(o => !status || o.status === status)
    .filter(o => !type || o.type === type);

  sendSuccess(res, {
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
  const orderId = req.params["id"]!;

  /* For wallet-paid → cancelled: do status update + wallet refund in ONE transaction */
  const [preOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
  if (!preOrder) { sendNotFound(res, "Order not found"); return; }

  let order = preOrder;

  const NON_CANCELLABLE_STATUSES = ["delivered", "completed"];
  if (status === "cancelled" && NON_CANCELLABLE_STATUSES.includes(preOrder.status)) {
    sendValidationError(res, `Cannot cancel an order that is already ${preOrder.status}.`); return;
  }

  if (status === "cancelled" && preOrder.paymentMethod === "wallet" && !preOrder.refundedAt) {
    const refundAmt = parseFloat(String(preOrder.total));
    const now = new Date();
    /* Atomic: status update + wallet credit + refund stamp in one transaction.
       Guard: WHERE refunded_at IS NULL prevents double-credit under concurrency.
       If the conditional update returns 0 rows, we throw to roll back the transaction. */
    const txResult = await db.transaction(async (tx) => {
      const result = await tx.update(ordersTable)
        .set({ status, refundedAt: now, refundedAmount: refundAmt.toFixed(2), paymentStatus: "refunded", updatedAt: now })
        .where(and(eq(ordersTable.id, orderId), isNull(ordersTable.refundedAt)))
        .returning();
      if (result.length === 0) {
        /* Already refunded (concurrent request won) — throw to roll back entire tx */
        throw new Error("ALREADY_REFUNDED");
      }
      await tx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance + ${refundAmt}`, updatedAt: now })
        .where(eq(usersTable.id, preOrder.userId));
      await tx.insert(walletTransactionsTable).values({
        id: generateId(), userId: preOrder.userId, type: "credit",
        amount: refundAmt.toFixed(2),
        description: `Refund — Order #${orderId.slice(-6).toUpperCase()} cancelled by admin`,
      });
      return result[0];
    }).catch((err: Error) => {
      if (err.message === "ALREADY_REFUNDED") return null;
      throw err;
    });
    if (!txResult) { sendError(res, "Order has already been refunded", 409); return; }
    order = txResult;
    /* Notifications after successful commit */
    await sendUserNotification(preOrder.userId, "Order Refund 💰", `Rs. ${refundAmt.toFixed(0)} aapki wallet mein refund ho gaya — Order #${orderId.slice(-6).toUpperCase()}`, "mart", "wallet-outline");
  } else {
    /* Non-wallet or non-cancel: plain status update */
    const [updated] = await db.update(ordersTable)
      .set({ status, updatedAt: new Date() })
      .where(eq(ordersTable.id, orderId))
      .returning();
    if (!updated) { sendNotFound(res, "Order not found"); return; }
    order = updated;
  }

  const notifKeys = ORDER_NOTIF_KEYS[status];
  if (notifKeys) {
    const orderUserLang = await getUserLanguage(order.userId);
    await sendUserNotification(order.userId, t(notifKeys.titleKey, orderUserLang), t(notifKeys.bodyKey, orderUserLang), "mart", notifKeys.icon);
  }

  // NOTE: Wallet is already debited when order is PLACED (orders.ts).
  // Do NOT deduct again here. Only credit the rider's share on delivery.

  if (status === "delivered") {
    const total = parseFloat(String(order.total));
    const riderKeepPct = parseFloat((await getPlatformSettings())["rider_keep_pct"] ?? "80") / 100;
    const riderEarning = parseFloat((total * riderKeepPct).toFixed(2));
    // Credit assigned rider's wallet earnings
    if (order.riderId) {
      const [rider] = await db.select().from(usersTable).where(eq(usersTable.id, order.riderId));
      if (rider) {
        const riderNewBal = (parseFloat(rider.walletBalance ?? "0") + riderEarning).toFixed(2);
        await db.update(usersTable).set({ walletBalance: riderNewBal, updatedAt: new Date() }).where(eq(usersTable.id, rider.id));
        await db.insert(walletTransactionsTable).values({
          id: generateId(), userId: rider.id, type: "credit",
          amount: String(riderEarning),
          description: `Delivery earnings — Order #${order.id.slice(-6).toUpperCase()} (${Math.round(riderKeepPct * 100)}%)`,
        });
      }
    }
  }

  sendSuccess(res, { ...order, total: parseFloat(String(order.total)) });
});

router.post("/orders/:id/refund", async (req, res) => {
  const { amount, reason } = req.body;
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, req.params["id"]!)).limit(1);
  if (!order) { sendNotFound(res, "Order not found"); return; }

  /* Only allow refunds for terminal orders */
  if (order.status !== "delivered" && order.status !== "cancelled") {
    sendValidationError(res, "Refund only allowed for delivered or cancelled orders"); return;
  }

  /* Only wallet-paid orders can be wallet-refunded */
  if (order.paymentMethod !== "wallet") {
    sendValidationError(res, "Refund only applies to wallet-paid orders"); return;
  }

  /* Fast-path: pre-check before entering transaction */
  if (order.refundedAt) {
    sendErrorWithData(res, "Order has already been refunded", {
      refundedAt: order.refundedAt,
      refundedAmount: order.refundedAmount ? parseFloat(String(order.refundedAmount)) : null,
    }, 409);
    return;
  }

  /* Validate refund amount — reject invalid/negative instead of silently defaulting */
  const maxRefund = parseFloat(String(order.total));
  const parsedAmount = amount !== undefined && amount !== null && amount !== ""
    ? parseFloat(String(amount))
    : NaN;
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    sendValidationError(res, "amount must be a positive number"); return;
  }
  const refundAmt = Math.min(parsedAmount, maxRefund);
  if (refundAmt <= 0) { sendValidationError(res, "Refund amount must be positive"); return; }

  const now = new Date();
  let alreadyRefunded = false;

  await db.transaction(async (tx) => {
    /* Atomic idempotency: only stamp refunded_at if it is still NULL.
       The WHERE clause with IS NULL means only one concurrent request will get rowCount > 0. */
    const updated = await tx.update(ordersTable)
      .set({ refundedAt: now, refundedAmount: refundAmt.toFixed(2), paymentStatus: "refunded", updatedAt: now })
      .where(and(eq(ordersTable.id, order.id), isNull(ordersTable.refundedAt)))
      .returning({ id: ordersTable.id });

    if (updated.length === 0) {
      /* Another concurrent request beat us to the refund — abort */
      alreadyRefunded = true;
      return;
    }

    /* Credit customer wallet only if we successfully stamped the order */
    await tx.update(usersTable)
      .set({ walletBalance: sql`wallet_balance + ${refundAmt}`, updatedAt: now })
      .where(eq(usersTable.id, order.userId));

    await tx.insert(walletTransactionsTable).values({
      id: generateId(),
      userId: order.userId,
      type: "credit",
      amount: refundAmt.toFixed(2),
      description: `Admin refund — Order #${order.id.slice(-6).toUpperCase()}${reason ? `. ${reason}` : ""}`,
    });
  });

  if (alreadyRefunded) {
    sendError(res, "Order has already been refunded", 409); return;
  }

  await sendUserNotification(
    order.userId,
    "Order Refund 💰",
    `Rs. ${refundAmt.toFixed(0)} aapki wallet mein refund ho gaya — Order #${order.id.slice(-6).toUpperCase()}`,
    "mart",
    "wallet-outline"
  );

  sendSuccess(res, { success: true, refundedAmount: refundAmt, orderId: order.id });
});
router.get("/pharmacy-orders", async (_req, res) => {
  const orders = await db
    .select()
    .from(pharmacyOrdersTable)
    .orderBy(desc(pharmacyOrdersTable.createdAt))
    .limit(200);
  sendSuccess(res, {
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
  if (!order) { sendNotFound(res, "Not found"); return; }

  const pharmNotifKeys = PHARMACY_NOTIF_KEYS[status];
  if (pharmNotifKeys) {
    const pharmUserLang = await getUserLanguage(order.userId);
    await sendUserNotification(order.userId, t(pharmNotifKeys.titleKey, pharmUserLang), t(pharmNotifKeys.bodyKey, pharmUserLang), "pharmacy", pharmNotifKeys.icon);
  }

  // Wallet refund on cancellation (atomic)
  if (status === "cancelled" && order.paymentMethod === "wallet") {
    const refundAmt = parseFloat(order.total);
    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ walletBalance: sql`wallet_balance + ${refundAmt}`, updatedAt: new Date() }).where(eq(usersTable.id, order.userId));
      await tx.insert(walletTransactionsTable).values({ id: generateId(), userId: order.userId, type: "credit", amount: refundAmt.toFixed(2), description: `Refund — Pharmacy Order #${order.id.slice(-6).toUpperCase()} cancelled` });
    }).catch(() => {});
    const pharmRefundLang = await getUserLanguage(order.userId);
    await sendUserNotification(order.userId, t("notifPharmacyRefund", pharmRefundLang), t("notifPharmacyRefundBody", pharmRefundLang).replace("{amount}", refundAmt.toFixed(0)), "pharmacy", "wallet-outline");
  }

  sendSuccess(res, { ...order, total: parseFloat(order.total) });
});

/* ── Parcel Bookings ── */
router.get("/parcel-bookings", async (_req, res) => {
  const bookings = await db
    .select()
    .from(parcelBookingsTable)
    .orderBy(desc(parcelBookingsTable.createdAt))
    .limit(200);
  sendSuccess(res, {
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
  if (!booking) { sendNotFound(res, "Not found"); return; }

  const parcelNotifKeys = PARCEL_NOTIF_KEYS[status];
  if (parcelNotifKeys) {
    const parcelUserLang = await getUserLanguage(booking.userId);
    await sendUserNotification(booking.userId, t(parcelNotifKeys.titleKey, parcelUserLang), t(parcelNotifKeys.bodyKey, parcelUserLang), "parcel", parcelNotifKeys.icon);
  }

  // Wallet refund on cancellation (atomic)
  if (status === "cancelled" && booking.paymentMethod === "wallet") {
    const refundAmt = parseFloat(booking.fare);
    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ walletBalance: sql`wallet_balance + ${refundAmt}`, updatedAt: new Date() }).where(eq(usersTable.id, booking.userId));
      await tx.insert(walletTransactionsTable).values({ id: generateId(), userId: booking.userId, type: "credit", amount: refundAmt.toFixed(2), description: `Refund — Parcel Booking #${booking.id.slice(-6).toUpperCase()} cancelled` });
    }).catch(() => {});
    const parcelRefundLang = await getUserLanguage(booking.userId);
    await sendUserNotification(booking.userId, t("notifParcelRefund", parcelRefundLang), t("notifParcelRefundBody", parcelRefundLang).replace("{amount}", refundAmt.toFixed(0)), "parcel", "wallet-outline");
  }

  sendSuccess(res, { ...booking, fare: parseFloat(booking.fare) });
});
router.get("/pharmacy-enriched", async (_req, res) => {
  const orders = await db.select().from(pharmacyOrdersTable).orderBy(desc(pharmacyOrdersTable.createdAt)).limit(200);
  const users = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone }).from(usersTable);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  sendSuccess(res, {
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
  sendSuccess(res, {
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

  sendSuccess(res, { transactions: enriched, total: transactions.length, totalCredit, totalDebit });
});

/* ── Delete User ── */
router.get("/orders-enriched", async (_req, res) => {
  const orders = await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt)).limit(200);
  const users = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone }).from(usersTable);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  sendSuccess(res, {
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
  const [rides, users, bidCounts] = await Promise.all([
    db.select().from(ridesTable).orderBy(desc(ridesTable.createdAt)).limit(200),
    db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone }).from(usersTable),
    /* Count bids per ride for bargaining transparency */
    db.select({ rideId: rideBidsTable.rideId, total: count(rideBidsTable.id) })
      .from(rideBidsTable)
      .groupBy(rideBidsTable.rideId),
  ]);
  const userMap    = Object.fromEntries(users.map(u => [u.id, u]));
  const bidCountMap = Object.fromEntries(bidCounts.map(b => [b.rideId, Number(b.total)]));
  sendSuccess(res, {
    rides: rides.map(r => ({
      ...r,
      fare:        parseFloat(r.fare),
      distance:    parseFloat(r.distance),
      offeredFare: r.offeredFare ? parseFloat(r.offeredFare) : null,
      counterFare: r.counterFare ? parseFloat(r.counterFare) : null,
      createdAt:   r.createdAt.toISOString(),
      updatedAt:   r.updatedAt.toISOString(),
      userName:    userMap[r.userId]?.name  || null,
      userPhone:   userMap[r.userId]?.phone || null,
      totalBids:   bidCountMap[r.id] ?? 0,
    })),
    total: rides.length,
  });
});

/** Revoke all active refresh tokens and bump tokenVersion for a user — immediate session invalidation. */
async function revokeAllUserSessions(userId: string): Promise<void> {
  await db.update(usersTable)
    .set({ tokenVersion: sql`token_version + 1` })
    .where(eq(usersTable.id, userId));
  await db.delete(refreshTokensTable)
    .where(eq(refreshTokensTable.userId, userId));
}

/* ── User Security Management ── */
router.patch("/orders/:id/assign-rider", async (req, res) => {
  const { riderId } = req.body as { riderId?: string };
  let riderName: string | null = null;
  let riderPhone: string | null = null;
  if (riderId) {
    const [rider] = await db.select({ name: usersTable.name, phone: usersTable.phone }).from(usersTable).where(eq(usersTable.id, riderId));
    riderName = rider?.name ?? null;
    riderPhone = rider?.phone ?? null;
  }
  const [order] = await db.update(ordersTable)
    .set({ riderId: riderId || null, riderName, riderPhone, updatedAt: new Date() })
    .where(eq(ordersTable.id, req.params["id"]!))
    .returning();
  if (!order) { sendNotFound(res, "Order not found"); return; }
  addAuditEntry({ action: "order_rider_assigned", ip: getClientIp(req), adminId: (req as AdminRequest).adminId, details: `Rider ${riderName ?? riderId ?? "unassigned"} assigned to order ${req.params["id"]}`, result: "success" });
  sendSuccess(res, { success: true, order: { ...order, total: parseFloat(String(order.total)), riderName, riderPhone } });
});

/* ── PATCH /admin/vendors/:id/commission — set per-vendor commission override ── */

export default router;
