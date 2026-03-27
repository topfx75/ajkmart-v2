import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { notificationsTable, pharmacyOrdersTable, usersTable, walletTransactionsTable } from "@workspace/db/schema";
import { eq, sql, and, gte } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getPlatformSettings } from "./admin.js";
import { customerAuth, riderAuth } from "../middleware/security.js";

const router: IRouter = Router();

function mapOrder(o: typeof pharmacyOrdersTable.$inferSelect) {
  return {
    id: o.id,
    userId: o.userId,
    items: o.items as object[],
    prescriptionNote: o.prescriptionNote,
    deliveryAddress: o.deliveryAddress,
    contactPhone: o.contactPhone,
    total: parseFloat(o.total),
    paymentMethod: o.paymentMethod,
    status: o.status,
    estimatedTime: o.estimatedTime,
    createdAt: o.createdAt.toISOString(),
  };
}

router.get("/", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const orders = await db
    .select()
    .from(pharmacyOrdersTable)
    .where(eq(pharmacyOrdersTable.userId, userId))
    .orderBy(pharmacyOrdersTable.createdAt);
  res.json({ orders: orders.map(mapOrder).reverse(), total: orders.length });
});

router.get("/:id", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const [order] = await db
    .select()
    .from(pharmacyOrdersTable)
    .where(eq(pharmacyOrdersTable.id, String(req.params["id"])))
    .limit(1);
  if (!order) {
    res.status(404).json({ error: "Pharmacy order not found" });
    return;
  }
  if (order.userId !== userId) { res.status(403).json({ error: "Access denied" }); return; }
  res.json(mapOrder(order));
});

router.post("/", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const { items, prescriptionNote, deliveryAddress, contactPhone, paymentMethod } = req.body;
  if (!items || !deliveryAddress || !contactPhone || !paymentMethod) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const s = await getPlatformSettings();

  // Maintenance mode gate
  if ((s["app_status"] ?? "active") === "maintenance") {
    const mainKey = (s["security_maintenance_key"] ?? "").trim();
    const bypass  = ((req.headers["x-maintenance-key"] as string) ?? "").trim();
    if (!mainKey || bypass !== mainKey) {
      res.status(503).json({ error: s["content_maintenance_msg"] ?? "We're performing scheduled maintenance. Back soon!" }); return;
    }
  }

  // Feature flag check
  const pharmacyEnabled = (s["feature_pharmacy"] ?? "on") === "on";
  if (!pharmacyEnabled) {
    res.status(503).json({ error: "Pharmacy service is currently disabled" }); return;
  }

  /* Per-item validation — prevents negative-price injection */
  const badItem = (items as any[]).find(
    (it) => !Number.isFinite(Number(it.price)) || Number(it.price) <= 0 ||
            !Number.isFinite(Number(it.quantity)) || Number(it.quantity) <= 0,
  );
  if (badItem) {
    res.status(400).json({ error: "Each item must have a valid positive price and quantity" }); return;
  }

  const itemsTotal = (items as { price: number; quantity: number }[]).reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  if (itemsTotal <= 0) {
    res.status(400).json({ error: "Order total must be greater than 0" }); return;
  }

  /* ── Min order check ── */
  const minOrder = parseFloat(s["min_order_amount"] ?? "100");
  if (itemsTotal < minOrder) {
    res.status(400).json({ error: `Minimum order amount is Rs. ${minOrder}` }); return;
  }

  /* ── Delivery fee (delivery_fee_pharmacy) with free threshold ── */
  const baseFee      = parseFloat(s["delivery_fee_pharmacy"] ?? "50");
  const freeEnabled  = (s["delivery_free_enabled"] ?? "on") === "on";
  const freeAbove    = parseFloat(s["free_delivery_above"] ?? "1000");
  const deliveryFee  = (freeEnabled && itemsTotal >= freeAbove) ? 0 : baseFee;

  /* ── GST (Finance settings) ── */
  const gstEnabled = (s["finance_gst_enabled"] ?? "off") === "on";
  const gstPct     = parseFloat(s["finance_gst_pct"] ?? "17");
  const gstAmount  = gstEnabled ? parseFloat(((itemsTotal * gstPct) / 100).toFixed(2)) : 0;

  /* ── COD service fee (charged when total < cod_free_above threshold) ── */
  const codFee = (() => {
    if (paymentMethod !== "cash") return 0;
    const fee    = parseFloat(s["cod_fee"]        ?? "0");
    const freeAb = parseFloat(s["cod_free_above"] ?? "2000");
    return (fee > 0 && itemsTotal < freeAb) ? fee : 0;
  })();

  const total = itemsTotal + deliveryFee + gstAmount + codFee;

  /* ── Estimated time from admin Order settings ── */
  const preptimeMin   = parseInt(s["order_preptime_min"] ?? "15", 10);
  const estimatedTime = `${preptimeMin}–${preptimeMin + 25} min`;

  /* ── COD validation (mirrors orders.ts pattern) ── */
  if (paymentMethod === "cash") {
    const codEnabled = (s["cod_enabled"] ?? "on") === "on";
    if (!codEnabled) {
      res.status(400).json({ error: "Cash on Delivery is currently not available" }); return;
    }
    const codAllowedForPharmacy = (s["cod_allowed_pharmacy"] ?? "on") !== "off";
    if (!codAllowedForPharmacy) {
      res.status(400).json({ error: "Cash on Delivery is not available for Pharmacy orders. Please choose another payment method." }); return;
    }
    const codMax = parseFloat(s["cod_max_amount"] ?? "5000");
    if (total > codMax) {
      res.status(400).json({ error: `Maximum Cash on Delivery order is Rs. ${codMax}. Please pay online for larger orders.` }); return;
    }
    /* ── COD verification threshold — flag high-value cash orders ── */
    const verifyThreshold = parseFloat(s["cod_verification_threshold"] ?? "0");
    if (verifyThreshold > 0 && total > verifyThreshold) {
      /* Order is allowed but flagged for rider photo verification */
    }
  }

  // Wallet payment → atomic DB transaction (prevents race condition / double-spend)
  if (paymentMethod === "wallet") {
    const walletEnabled = (s["feature_wallet"] ?? "on") === "on";
    if (!walletEnabled) {
      res.status(400).json({ error: "Wallet payments are currently disabled" }); return;
    }

    try {
      const order = await db.transaction(async (tx) => {
        const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
        if (!user) throw new Error("User not found");

        const balance = parseFloat(user.walletBalance ?? "0");
        if (balance < total) throw new Error(`Insufficient wallet balance. Balance: Rs. ${balance.toFixed(0)}, Required: Rs. ${total.toFixed(0)}`);

        /* DB floor guard — deducts only if balance ≥ amount at UPDATE time */
        const [deducted] = await tx.update(usersTable)
          .set({ walletBalance: sql`wallet_balance - ${total.toFixed(2)}` })
          .where(and(eq(usersTable.id, userId), gte(usersTable.walletBalance, total.toFixed(2))))
          .returning({ id: usersTable.id });
        if (!deducted) throw new Error(`Insufficient wallet balance. Required: Rs. ${total.toFixed(0)}`);
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId, type: "debit",
          amount: total.toFixed(2),
          description: "Pharmacy order payment (items + delivery + GST)",
        });

        const [newOrder] = await tx.insert(pharmacyOrdersTable).values({
          id: generateId(), userId, items,
          prescriptionNote: prescriptionNote || null,
          deliveryAddress, contactPhone,
          total: total.toFixed(2), paymentMethod,
          status: "pending", estimatedTime,
        }).returning();
        return newOrder!;
      });

      await db.insert(notificationsTable).values({
        id: generateId(), userId,
        title: "Pharmacy Order Placed",
        body: `Aapka pharmacy order place ho gaya. Rs. ${total.toFixed(0)} (items + Rs. ${deliveryFee} delivery) — ETA: ${estimatedTime}`,
        type: "pharmacy", icon: "medical-outline", link: `/(tabs)/orders`,
      }).catch(() => {});

      res.status(201).json({ ...mapOrder(order), deliveryFee, gstAmount });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
    return;
  }

  // Cash / other payments
  const [order] = await db.insert(pharmacyOrdersTable).values({
    id: generateId(), userId, items,
    prescriptionNote: prescriptionNote || null,
    deliveryAddress, contactPhone,
    total: total.toFixed(2), paymentMethod,
    status: "pending", estimatedTime,
  }).returning();

  await db.insert(notificationsTable).values({
    id: generateId(), userId,
    title: "Pharmacy Order Placed",
    body: `Aapka pharmacy order place ho gaya. Rs. ${total.toFixed(0)} (items + Rs. ${deliveryFee} delivery) — ETA: ${estimatedTime}`,
    type: "pharmacy", icon: "medical-outline", link: `/(tabs)/orders`,
  }).catch(() => {});

  res.status(201).json({ ...mapOrder(order!), deliveryFee, gstAmount });
});

router.patch("/:id/status", riderAuth, async (req, res) => {
  const { status } = req.body;

  /* Whitelist: prevent arbitrary string injection into the status column */
  const ALLOWED_STATUSES = ["accepted", "picked_up", "in_transit", "delivered", "cancelled"] as const;
  if (!ALLOWED_STATUSES.includes(status)) {
    res.status(400).json({ error: `Invalid status. Allowed: ${ALLOWED_STATUSES.join(", ")}` });
    return;
  }

  const [order] = await db
    .update(pharmacyOrdersTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(pharmacyOrdersTable.id, String(req.params["id"])))
    .returning();
  if (!order) {
    res.status(404).json({ error: "Pharmacy order not found" });
    return;
  }
  res.json(mapOrder(order));
});

export default router;
