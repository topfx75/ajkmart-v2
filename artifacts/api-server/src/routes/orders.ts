import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { ordersTable, usersTable, walletTransactionsTable } from "@workspace/db/schema";
import { eq, and, gte, count, SQL } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getPlatformSettings } from "./admin.js";
import { addSecurityEvent, getClientIp, getCachedSettings } from "../middleware/security.js";

const router: IRouter = Router();

function mapOrder(o: typeof ordersTable.$inferSelect) {
  return {
    id: o.id,
    userId: o.userId,
    type: o.type,
    items: o.items as object[],
    status: o.status,
    total: parseFloat(o.total),
    deliveryAddress: o.deliveryAddress,
    paymentMethod: o.paymentMethod,
    riderId: o.riderId,
    estimatedTime: o.estimatedTime,
    createdAt: o.createdAt.toISOString(),
  };
}

/* ── GET /orders?userId=&status= ─────────────────────────────────────────── */
router.get("/", async (req, res) => {
  const userId = req.query["userId"] as string;
  const status = req.query["status"] as string;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }

  const conditions: SQL[] = [eq(ordersTable.userId, userId)];
  if (status) conditions.push(eq(ordersTable.status, status));
  const orders = await db.select().from(ordersTable).where(and(...conditions));
  res.json({ orders: orders.map(mapOrder), total: orders.length });
});

/* ── GET /orders/:id ──────────────────────────────────────────────────────── */
router.get("/:id", async (req, res) => {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, req.params["id"]!)).limit(1);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  res.json(mapOrder(order));
});

/* ── POST /orders ─────────────────────────────────────────────────────────── */
router.post("/", async (req, res) => {
  const { userId, type, items, deliveryAddress, paymentMethod } = req.body;
  const ip = getClientIp(req);

  if (!userId || !items || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "userId, items (array) required" }); return;
  }

  const total = items.reduce(
    (sum: number, item: { price: number; quantity: number }) => sum + (item.price * item.quantity),
    0
  );

  if (total <= 0) {
    res.status(400).json({ error: "Order total must be greater than 0" }); return;
  }

  /* ── Platform settings & fraud detection ── */
  const s = await getCachedSettings();
  const minOrder = parseFloat(s["min_order_amount"] ?? "100");

  if (total < minOrder) {
    res.status(400).json({ error: `Minimum order amount is Rs. ${minOrder}` }); return;
  }

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
    const codMax = parseFloat(s["cod_max_amount"] ?? "5000");
    if (total > codMax) {
      res.status(400).json({ error: `Maximum Cash on Delivery order is Rs. ${codMax}. Please pay online for larger orders.` }); return;
    }
  }

  /* ── Wallet payment: deduct on placement ── */
  if (paymentMethod === "wallet") {
    const walletEnabled = (s["feature_wallet"] ?? "on") === "on";
    if (!walletEnabled) {
      res.status(400).json({ error: "Wallet payments are currently disabled" }); return;
    }

    try {
      const order = await db.transaction(async (tx) => {
        const [freshUser] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
        if (!freshUser) throw new Error("User not found");

        const balance = parseFloat(freshUser.walletBalance ?? "0");
        if (balance < total) throw new Error(`Insufficient wallet balance. Balance: Rs. ${balance.toFixed(0)}, Required: Rs. ${total.toFixed(0)}`);

        const newBalance = (balance - total).toFixed(2);
        await tx.update(usersTable).set({ walletBalance: newBalance }).where(eq(usersTable.id, userId));
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId, type: "debit",
          amount: total.toFixed(2),
          description: `Order payment (${type || "mart"}) — Rs. ${total.toFixed(0)}`,
        });

        const [newOrder] = await tx.insert(ordersTable).values({
          id: generateId(), userId, type, items,
          status: "pending", total: total.toFixed(2),
          deliveryAddress, paymentMethod,
          estimatedTime: "30-45 min",
        }).returning();
        return newOrder!;
      });
      res.status(201).json(mapOrder(order));
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
    estimatedTime: "30-45 min",
  }).returning();
  res.status(201).json(mapOrder(order!));
});

/* ── PATCH /orders/:id ────────────────────────────────────────────────────── */
router.patch("/:id", async (req, res) => {
  const { status, riderId } = req.body;
  const updateData: Partial<typeof ordersTable.$inferInsert> = { status, updatedAt: new Date() };
  if (riderId) updateData.riderId = riderId;

  const [order] = await db.update(ordersTable)
    .set(updateData)
    .where(eq(ordersTable.id, req.params["id"]!))
    .returning();
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  res.json(mapOrder(order));
});

export default router;
