import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, ordersTable, walletTransactionsTable, ridesTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { customerAuth } from "../middleware/security.js";

const router: IRouter = Router();

router.use(customerAuth);

router.get("/profile", async (req, res) => {
  const userId = req.customerId!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({
    id: user.id,
    phone: user.phone,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    walletBalance: parseFloat(user.walletBalance ?? "0"),
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
  });
});

router.get("/:id/debt", async (req, res) => {
  const userId = req.customerId!;
  if (req.params["id"] !== userId) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const [user] = await db.select({ cancellationDebt: usersTable.cancellationDebt }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ debtBalance: parseFloat(user.cancellationDebt ?? "0") });
});

router.post("/export-data", async (req, res) => {
  const userId = req.customerId!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const [orders, rides, walletHistory] = await Promise.all([
    db.select().from(ordersTable).where(eq(ordersTable.userId, userId)).orderBy(desc(ordersTable.createdAt)),
    db.select().from(ridesTable).where(eq(ridesTable.userId, userId)).orderBy(desc(ridesTable.createdAt)),
    db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.userId, userId)).orderBy(desc(walletTransactionsTable.createdAt)),
  ]);

  const exportData = {
    exportedAt: new Date().toISOString(),
    profile: {
      id: user.id,
      phone: user.phone,
      name: user.name,
      email: user.email,
      city: user.city,
      address: user.address,
      cnic: user.cnic,
      walletBalance: parseFloat(user.walletBalance ?? "0"),
      createdAt: user.createdAt.toISOString(),
    },
    orders: orders.map(o => ({
      id: o.id,
      type: o.type,
      status: o.status,
      total: parseFloat(o.total),
      paymentMethod: o.paymentMethod,
      deliveryAddress: o.deliveryAddress,
      items: o.items,
      createdAt: o.createdAt.toISOString(),
    })),
    rides: rides.map(r => ({
      id: r.id,
      type: r.type,
      status: r.status,
      pickupAddress: r.pickupAddress,
      dropoffAddress: r.dropoffAddress,
      fare: parseFloat(r.fare),
      paymentMethod: r.paymentMethod,
      createdAt: r.createdAt.toISOString(),
    })),
    walletHistory: walletHistory.map(t => ({
      id: t.id,
      type: t.type,
      amount: parseFloat(t.amount),
      description: t.description,
      createdAt: t.createdAt.toISOString(),
    })),
  };

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="ajkmart-data-export-${userId.slice(-8)}.json"`);
  res.json({ success: true, data: exportData });
});

router.put("/profile", async (req, res) => {
  const userId = req.customerId!;
  const { userId: _ignored, name, email, avatar, cnic, city, address } = req.body;
  const updates: any = { updatedAt: new Date() };
  if (name    !== undefined) updates.name    = name;
  if (email   !== undefined) updates.email   = email;
  if (avatar  !== undefined) updates.avatar  = avatar;
  if (cnic    !== undefined) updates.cnic    = cnic;
  if (city    !== undefined) updates.city    = city;
  if (address !== undefined) updates.address = address;
  await db.update(usersTable).set(updates).where(eq(usersTable.id, userId));
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({
    id: user.id,
    phone: user.phone,
    name: user.name,
    email: user.email,
    role: user.role,
    roles: user.roles,
    avatar: user.avatar,
    walletBalance: parseFloat(user.walletBalance ?? "0"),
    isActive: user.isActive,
    cnic: user.cnic,
    city: user.city,
    address: user.address,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString(),
  });
});

export default router;
