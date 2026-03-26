import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { notificationsTable, pharmacyOrdersTable, usersTable, walletTransactionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getPlatformSettings } from "./admin.js";

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

router.get("/", async (req, res) => {
  const userId = req.query["userId"] as string;
  if (!userId) {
    res.status(400).json({ error: "userId required" });
    return;
  }
  const orders = await db
    .select()
    .from(pharmacyOrdersTable)
    .where(eq(pharmacyOrdersTable.userId, userId))
    .orderBy(pharmacyOrdersTable.createdAt);
  res.json({ orders: orders.map(mapOrder).reverse(), total: orders.length });
});

router.get("/:id", async (req, res) => {
  const [order] = await db
    .select()
    .from(pharmacyOrdersTable)
    .where(eq(pharmacyOrdersTable.id, req.params["id"]!))
    .limit(1);
  if (!order) {
    res.status(404).json({ error: "Pharmacy order not found" });
    return;
  }
  res.json(mapOrder(order));
});

router.post("/", async (req, res) => {
  const { userId, items, prescriptionNote, deliveryAddress, contactPhone, paymentMethod } = req.body;
  if (!userId || !items || !deliveryAddress || !contactPhone || !paymentMethod) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const s = await getPlatformSettings();

  // Feature flag check
  const pharmacyEnabled = (s["feature_pharmacy"] ?? "on") === "on";
  if (!pharmacyEnabled) {
    res.status(503).json({ error: "Pharmacy service is currently disabled" }); return;
  }

  const total = (items as { price: number; quantity: number }[]).reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  if (total <= 0) {
    res.status(400).json({ error: "Order total must be greater than 0" }); return;
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

        const newBalance = (balance - total).toFixed(2);
        await tx.update(usersTable).set({ walletBalance: newBalance }).where(eq(usersTable.id, userId));
        await tx.insert(walletTransactionsTable).values({
          id: generateId(),
          userId,
          type: "debit",
          amount: total.toFixed(2),
          description: "Pharmacy order payment",
        });

        const [newOrder] = await tx.insert(pharmacyOrdersTable).values({
          id: generateId(),
          userId,
          items,
          prescriptionNote: prescriptionNote || null,
          deliveryAddress,
          contactPhone,
          total: total.toFixed(2),
          paymentMethod,
          status: "pending",
          estimatedTime: "25-40 min",
        }).returning();
        return newOrder!;
      });

      await db.insert(notificationsTable).values({
        id: generateId(),
        userId,
        title: "Pharmacy Order Placed",
        body: `Aapka pharmacy order place ho gaya. Rs. ${total} — Estimated: 25-40 min`,
        type: "pharmacy",
        icon: "medical-outline",
        link: `/(tabs)/orders`,
      }).catch(() => {});

      res.status(201).json(mapOrder(order));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
    return;
  }

  // Cash / other payments
  const [order] = await db.insert(pharmacyOrdersTable).values({
    id: generateId(),
    userId,
    items,
    prescriptionNote: prescriptionNote || null,
    deliveryAddress,
    contactPhone,
    total: total.toFixed(2),
    paymentMethod,
    status: "pending",
    estimatedTime: "25-40 min",
  }).returning();

  await db.insert(notificationsTable).values({
    id: generateId(),
    userId,
    title: "Pharmacy Order Placed",
    body: `Aapka pharmacy order place ho gaya. Rs. ${total} — Estimated: 25-40 min`,
    type: "pharmacy",
    icon: "medical-outline",
    link: `/(tabs)/orders`,
  }).catch(() => {});

  res.status(201).json(mapOrder(order!));
});

router.patch("/:id/status", async (req, res) => {
  const { status } = req.body;
  const [order] = await db
    .update(pharmacyOrdersTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(pharmacyOrdersTable.id, req.params["id"]!))
    .returning();
  if (!order) {
    res.status(404).json({ error: "Pharmacy order not found" });
    return;
  }
  res.json(mapOrder(order));
});

export default router;
