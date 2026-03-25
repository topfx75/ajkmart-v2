import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { userSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { generateId } from "../lib/id.js";

const router: IRouter = Router();

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
  const userId = req.query["userId"] as string;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }

  let [settings] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId)).limit(1);
  if (!settings) {
    const id = generateId();
    await db.insert(userSettingsTable).values({ id, userId, ...DEFAULT_SETTINGS });
    [settings] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId)).limit(1);
  }
  res.json({ ...settings, updatedAt: settings!.updatedAt.toISOString() });
});

router.put("/", async (req, res) => {
  const { userId, ...updates } = req.body;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }

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
