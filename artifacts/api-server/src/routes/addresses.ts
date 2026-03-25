import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { savedAddressesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { generateId } from "../lib/id.js";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  const userId = req.query["userId"] as string;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }
  const addresses = await db.select().from(savedAddressesTable)
    .where(eq(savedAddressesTable.userId, userId))
    .orderBy(savedAddressesTable.createdAt);
  res.json({ addresses: addresses.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })) });
});

router.post("/", async (req, res) => {
  const { userId, label, address, city, icon, isDefault } = req.body;
  if (!userId || !label || !address) { res.status(400).json({ error: "userId, label, address required" }); return; }
  if (isDefault) {
    await db.update(savedAddressesTable).set({ isDefault: false }).where(eq(savedAddressesTable.userId, userId));
  }
  const id = generateId();
  await db.insert(savedAddressesTable).values({
    id, userId, label, address,
    city: city || "Muzaffarabad",
    icon: icon || "location-outline",
    isDefault: isDefault ?? false,
  });
  const [addr] = await db.select().from(savedAddressesTable).where(eq(savedAddressesTable.id, id)).limit(1);
  res.json({ ...addr, createdAt: addr!.createdAt.toISOString() });
});

router.put("/:id", async (req, res) => {
  const { label, address, city, icon, isDefault } = req.body;
  const { id } = req.params;
  if (isDefault) {
    const [addr] = await db.select().from(savedAddressesTable).where(eq(savedAddressesTable.id, id!)).limit(1);
    if (addr) await db.update(savedAddressesTable).set({ isDefault: false }).where(eq(savedAddressesTable.userId, addr.userId));
  }
  await db.update(savedAddressesTable).set({ label, address, city, icon, isDefault }).where(eq(savedAddressesTable.id, id!));
  res.json({ success: true });
});

router.delete("/:id", async (req, res) => {
  await db.delete(savedAddressesTable).where(eq(savedAddressesTable.id, req.params["id"]!));
  res.json({ success: true });
});

export default router;
