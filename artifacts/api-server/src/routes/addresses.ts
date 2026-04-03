import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { savedAddressesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "../lib/id.js";
import { sendSuccess, sendCreated, sendNotFound, sendForbidden, sendValidationError } from "../lib/response.js";
import { validateBody } from "../middleware/validate.js";
import { customerAuth } from "../middleware/security.js";

const router: IRouter = Router();

router.use(customerAuth);

router.get("/", async (req, res) => {
  const userId = req.customerId!;
  const addresses = await db.select().from(savedAddressesTable)
    .where(eq(savedAddressesTable.userId, userId))
    .orderBy(savedAddressesTable.createdAt);
  sendSuccess(res, { addresses: addresses.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })) });
});

const createAddressSchema = z.object({
  label: z.string().min(1, "Label is required").max(100, "Label must be 100 characters or less"),
  address: z.string().min(1, "Address is required").max(500, "Address must be 500 characters or less"),
  city: z.string().max(100, "City must be 100 characters or less").optional(),
  icon: z.string().optional(),
  isDefault: z.boolean().optional(),
});

router.post("/", validateBody(createAddressSchema), async (req, res) => {
  const userId = req.customerId!;
  const { label, address, city, icon, isDefault } = req.body;

  const existing = await db.select({ id: savedAddressesTable.id }).from(savedAddressesTable).where(eq(savedAddressesTable.userId, userId));
  if (existing.length >= 5) {
    sendValidationError(res, "Maximum 5 addresses allowed", "زیادہ سے زیادہ 5 پتے مجاز ہیں۔");
    return;
  }
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
  sendCreated(res, { ...addr, createdAt: addr!.createdAt.toISOString() });
});

router.put("/:id", async (req, res) => {
  const userId = req.customerId!;
  const { label, address, city, icon, isDefault } = req.body;
  const { id } = req.params;

  const [existing] = await db.select().from(savedAddressesTable).where(eq(savedAddressesTable.id, id!)).limit(1);
  if (!existing) { sendNotFound(res, "Address not found", "پتہ نہیں ملا۔"); return; }
  if (existing.userId !== userId) { sendForbidden(res, "Access denied", "رسائی سے انکار۔"); return; }

  if (isDefault) {
    await db.update(savedAddressesTable).set({ isDefault: false }).where(eq(savedAddressesTable.userId, userId));
  }
  await db.update(savedAddressesTable).set({ label, address, city, icon, isDefault }).where(eq(savedAddressesTable.id, id!));
  sendSuccess(res, null);
});

router.patch("/:id/set-default", async (req, res) => {
  const userId = req.customerId!;
  const { id } = req.params;

  const [existing] = await db.select().from(savedAddressesTable).where(eq(savedAddressesTable.id, id!)).limit(1);
  if (!existing) { sendNotFound(res, "Address not found", "پتہ نہیں ملا۔"); return; }
  if (existing.userId !== userId) { sendForbidden(res, "Access denied", "رسائی سے انکار۔"); return; }

  await db.update(savedAddressesTable).set({ isDefault: false }).where(eq(savedAddressesTable.userId, userId));
  await db.update(savedAddressesTable).set({ isDefault: true }).where(eq(savedAddressesTable.id, id!));
  sendSuccess(res, null);
});

router.delete("/:id", async (req, res) => {
  const userId = req.customerId!;

  const [existing] = await db.select().from(savedAddressesTable).where(eq(savedAddressesTable.id, req.params["id"]!)).limit(1);
  if (!existing) { sendNotFound(res, "Address not found", "پتہ نہیں ملا۔"); return; }
  if (existing.userId !== userId) { sendForbidden(res, "Access denied", "رسائی سے انکار۔"); return; }

  await db.delete(savedAddressesTable).where(eq(savedAddressesTable.id, req.params["id"]!));
  sendSuccess(res, null);
});

export default router;
