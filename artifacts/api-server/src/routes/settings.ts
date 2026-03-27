import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { userSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { customerAuth } from "../middleware/security.js";

const router: IRouter = Router();

router.use(customerAuth);

const DEFAULT_SETTINGS = {
  notifOrders: true,
  notifWallet: true,
  notifDeals: true,
  notifRides: true,
  locationSharing: true,
  biometric: false,
  twoFactor: false,
  darkMode: false,
};

router.get("/", async (req, res) => {
  const userId = req.customerId!;

  let [settings] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId)).limit(1);
  if (!settings) {
    const id = generateId();
    await db.insert(userSettingsTable).values({ id, userId, ...DEFAULT_SETTINGS });
    [settings] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId)).limit(1);
  }
  res.json({ ...settings, updatedAt: settings!.updatedAt.toISOString() });
});

router.put("/", async (req, res) => {
  const userId = req.customerId!;
  const { userId: _ignored, ...updates } = req.body;

  let [existing] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId)).limit(1);
  if (!existing) {
    const id = generateId();
    await db.insert(userSettingsTable).values({ id, userId, ...DEFAULT_SETTINGS, ...updates });
  } else {
    await db.update(userSettingsTable).set({ ...updates, updatedAt: new Date() }).where(eq(userSettingsTable.userId, userId));
  }
  const [settings] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId)).limit(1);
  res.json({ ...settings, updatedAt: settings!.updatedAt.toISOString() });
});

export default router;
