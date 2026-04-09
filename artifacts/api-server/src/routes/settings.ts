import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { userSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { customerAuth } from "../middleware/security.js";
import { getPlatformDefaultLanguage } from "../lib/getUserLanguage.js";
import { sendSuccess } from "../lib/response.js";

const router: IRouter = Router();

router.use(customerAuth);

const VALID_LANGUAGES = ["en", "ur", "roman", "en_roman", "en_ur"] as const;

const DEFAULT_SETTINGS_BASE = {
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
    const platformLang = await getPlatformDefaultLanguage();
    const id = generateId();
    await db.insert(userSettingsTable).values({ id, userId, ...DEFAULT_SETTINGS_BASE, language: platformLang });
    [settings] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId)).limit(1);
  }
  sendSuccess(res, { ...settings, updatedAt: settings!.updatedAt.toISOString() });
});

const BOOLEAN_FIELDS = new Set([
  "notifOrders", "notifWallet", "notifDeals", "notifRides",
  "locationSharing", "biometric", "twoFactor", "darkMode",
]);
const ALLOWED_FIELDS = new Set([...BOOLEAN_FIELDS, "language"]);

router.put("/", async (req, res) => {
  const userId = req.customerId!;
  const raw = req.body;

  const updates: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    if (BOOLEAN_FIELDS.has(key)) {
      if (typeof raw[key] !== "boolean") continue;
      updates[key] = raw[key];
    } else if (key === "language") {
      if (VALID_LANGUAGES.includes(raw[key])) updates[key] = raw[key];
    }
  }

  let [existing] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId)).limit(1);
  if (!existing) {
    const platformLang = await getPlatformDefaultLanguage();
    const id = generateId();
    await db.insert(userSettingsTable).values({ id, userId, ...DEFAULT_SETTINGS_BASE, language: platformLang, ...updates });
  } else {
    await db.update(userSettingsTable).set({ ...updates, updatedAt: new Date() }).where(eq(userSettingsTable.userId, userId));
  }
  const [settings] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId)).limit(1);
  sendSuccess(res, { ...settings, updatedAt: settings!.updatedAt.toISOString() });
});

export default router;
