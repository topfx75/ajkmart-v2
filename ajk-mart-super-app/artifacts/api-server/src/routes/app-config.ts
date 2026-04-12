import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { serviceZonesTable, supportedPaymentMethodsTable } from "@workspace/db/schema";
import { eq, asc } from "drizzle-orm";
import { getPlatformSettings } from "./admin.js";
import { sendSuccess } from "../lib/response.js";

const router: IRouter = Router();

/* ── GET /settings/app-config ──────────────────────────────────────────────
   Public endpoint — returns cities (from service_zones table) and payment
   methods (from supported_payment_methods table, with live availability
   from platform_settings) so all frontend apps can fetch dynamic config
   without hardcoded arrays.

   Adding a new city: admin adds a service_zone row → next fetch picks it up.
   Adding a new payment method: admin inserts a supported_payment_methods row
   and sets the matching platform_setting toggle → no code change needed.
────────────────────────────────────────────────────────────────────────── */
router.get("/", async (req, res) => {
  try {
    const [s, zoneRows, methodRows] = await Promise.all([
      getPlatformSettings(),
      db
        .select({ city: serviceZonesTable.city })
        .from(serviceZonesTable)
        .where(eq(serviceZonesTable.isActive, true))
        .orderBy(asc(serviceZonesTable.city)),
      db
        .select()
        .from(supportedPaymentMethodsTable)
        .where(eq(supportedPaymentMethodsTable.isActive, true))
        .orderBy(asc(supportedPaymentMethodsTable.sortOrder)),
    ]);

    /* ── Cities: unique city names from active service_zones ── */
    const citySet = new Set<string>();
    for (const row of zoneRows) {
      if (row.city) citySet.add(row.city);
    }
    let cities = Array.from(citySet).sort();

    /* Fallback: if service_zones not yet seeded, use platform_settings list */
    if (cities.length === 0) {
      const raw = s["service_cities"] ?? "";
      if (raw.trim()) {
        cities = raw.split(",").map((c: string) => c.trim()).filter(Boolean);
      }
      if (cities.length === 0) {
        cities = [
          "Muzaffarabad", "Mirpur", "Rawalakot", "Bagh", "Kotli",
          "Bhimber", "Poonch", "Neelum Valley", "Hattian", "Sudhnoti",
          "Haveli", "Pallandri",
        ];
      }
    }

    /* ── Payment methods: from supported_payment_methods DB table.
       Availability is resolved live from platform_settings toggles so
       admins can enable/disable without touching the methods table.      ── */
    const availabilityMap: Record<string, boolean> = {
      cash:      true,
      wallet:    (s["feature_wallet"]    ?? "on")  === "on",
      jazzcash:  (s["jazzcash_enabled"]  ?? "off") === "on",
      easypaisa: (s["easypaisa_enabled"] ?? "off") === "on",
      bank:      (s["bank_enabled"]      ?? "off") === "on",
    };

    const paymentMethods = methodRows.map(m => ({
      id:          m.id,
      label:       m.label,
      description: m.description,
      /* If the method has no explicit toggle, default to active (admin can
         control via the isActive column in supported_payment_methods) */
      available:   availabilityMap[m.id] !== undefined ? availabilityMap[m.id] : true,
    }));

    /* Fallback: if supported_payment_methods not yet seeded, return basics */
    if (paymentMethods.length === 0) {
      paymentMethods.push({ id: "cash", label: "Cash on Delivery", description: "Pay at delivery", available: true });
    }

    sendSuccess(res, { cities, paymentMethods });
  } catch {
    sendSuccess(res, {
      cities: [
        "Muzaffarabad", "Mirpur", "Rawalakot", "Bagh", "Kotli",
        "Bhimber", "Poonch", "Neelum Valley",
      ],
      paymentMethods: [
        { id: "cash", label: "Cash on Delivery", available: true, description: "Pay at delivery" },
      ],
    });
  }
});

export default router;
