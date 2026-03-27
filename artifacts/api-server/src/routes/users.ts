import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
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
