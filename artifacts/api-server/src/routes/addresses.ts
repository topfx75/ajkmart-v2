import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { savedAddressesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { customerAuth } from "../middleware/security.js";

const router: IRouter = Router();

/* All address routes require authentication */
router.use(customerAuth);

router.get("/", async (req, res) => {
  const userId = req.customerId!;
  const addresses = await db.select().from(savedAddressesTable)
    .where(eq(savedAddressesTable.userId, userId))
    .orderBy(savedAddressesTable.createdAt);
  res.json({ addresses: addresses.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })) });
});

router.post("/", async (req, res) => {
  const userId = req.customerId!;
  const { label, address, city, icon, isDefault } = req.body;
  if (!label || !address) { res.status(400).json({ error: "label and address required" }); return; }
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
  const userId = req.customerId!;
  const { label, address, city, icon, isDefault } = req.body;
  const { id } = req.params;

  /* Verify ownership before updating */
  const [existing] = await db.select().from(savedAddressesTable).where(eq(savedAddressesTable.id, id!)).limit(1);
  if (!existing) { res.status(404).json({ error: "Address not found" }); return; }
  if (existing.userId !== userId) { res.status(403).json({ error: "Access denied" }); return; }

  if (isDefault) {
    await db.update(savedAddressesTable).set({ isDefault: false }).where(eq(savedAddressesTable.userId, userId));
  }
  await db.update(savedAddressesTable).set({ label, address, city, icon, isDefault }).where(eq(savedAddressesTable.id, id!));
  res.json({ success: true });
});

router.delete("/:id", async (req, res) => {
  const userId = req.customerId!;

  /* Verify ownership before deleting */
  const [existing] = await db.select().from(savedAddressesTable).where(eq(savedAddressesTable.id, req.params["id"]!)).limit(1);
  if (!existing) { res.status(404).json({ error: "Address not found" }); return; }
  if (existing.userId !== userId) { res.status(403).json({ error: "Access denied" }); return; }

  await db.delete(savedAddressesTable).where(eq(savedAddressesTable.id, req.params["id"]!));
  res.json({ success: true });
});

export default router;
