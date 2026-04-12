import { Router } from "express";
import { z } from "zod";
import { sendAdminAlert } from "../../services/email.js";
import { sendOtpSMS } from "../../services/sms.js";
import { sendWhatsAppOTP } from "../../services/whatsapp.js";
import { canonicalizePhone } from "@workspace/phone-utils";
import { db } from "@workspace/db";
import {
  usersTable,
  walletTransactionsTable,
  notificationsTable,
  ordersTable, ridesTable, pharmacyOrdersTable, parcelBookingsTable, productsTable, platformSettingsTable, adminAccountsTable, authAuditLogTable, refreshTokensTable, rideRatingsTable, riderPenaltiesTable, reviewsTable,
  vendorProfilesTable,
  bulkUploadLogsTable,
} from "@workspace/db/schema";
import { eq, desc, count, sum, and, gte, lte, sql, or, ilike, asc, isNull, isNotNull, avg, ne, inArray, type SQL } from "drizzle-orm";
import {
  stripUser, generateId, getUserLanguage, t,
  getPlatformSettings, invalidatePlatformSettingsCache, adminAuth, getAdminSecret,
  sendUserNotification, logger, DEFAULT_PLATFORM_SETTINGS,
  ORDER_NOTIF_KEYS, RIDE_NOTIF_KEYS, PHARMACY_NOTIF_KEYS, PARCEL_NOTIF_KEYS,
  checkAdminLoginLockout, recordAdminLoginFailure, resetAdminLoginAttempts,
  addAuditEntry, addSecurityEvent, getClientIp,
  signAdminJwt, verifyAdminJwt, invalidateSettingsCache, getCachedSettings,
  ADMIN_TOKEN_TTL_HRS, verifyTotpToken, verifyAdminSecret,
  ensureDefaultRideServices, ensureDefaultLocations, formatSvc,
  type AdminRequest, serializeSosAlert,
} from "../admin-shared.js";
import { emitSosNew, emitSosAcknowledged, emitSosResolved, type SosAlertPayload } from "../../lib/socketio.js";
import { hashPassword } from "../../services/password.js";
import { sendSuccess, sendError, sendErrorWithData, sendNotFound, sendForbidden, sendValidationError } from "../../lib/response.js";
import { auditLog, securityEvents, blockIP, unblockIP, isIPBlocked, getBlockedIPList, getActiveLockouts, unlockPhone } from "../../middleware/security.js";
import { validateBody } from "../../middleware/validate.js";

const router = Router();

/**
 * Setting keys whose values contain secrets (credentials, tokens, API keys).
 * Values for these keys are always replaced with "[redacted]" in audit logs
 * to prevent secret leakage into logs or the admin audit trail.
 */
const SENSITIVE_SETTING_KEYS = new Set([
  "provider_credentials",
  "sms_api_key", "sms_account_sid", "sms_msg91_key",
  "smtp_password", "smtp_user",
  "wa_access_token", "wa_api_key",
  "fcm_server_key", "maps_api_key", "google_maps_api_key",
  "mapbox_api_key", "locationiq_api_key",
  "payment_secret_key", "payment_api_key",
  "admin_totp_secret",
]);

function redactAuditValue(key: string, value: string | null): string | null {
  if (value !== null && SENSITIVE_SETTING_KEYS.has(key)) return "[redacted]";
  return value;
}

router.get("/stats", async (_req, res) => {
  const [
    [userCount],
    [orderCount],
    [rideCount],
    [pharmCount],
    [parcelCount],
    [productCount],
    [pendingOrderCount],
    [activeRideCount],
    [activeSosCount],
    [totalRevenue],
    [rideRevenue],
    [pharmRevenue],
    recentOrders,
    recentRides,
  ] = await Promise.all([
    db.select({ count: count() }).from(usersTable),
    db.select({ count: count() }).from(ordersTable),
    db.select({ count: count() }).from(ridesTable),
    db.select({ count: count() }).from(pharmacyOrdersTable),
    db.select({ count: count() }).from(parcelBookingsTable),
    db.select({ count: count() }).from(productsTable),
    /* pending orders only */
    db.select({ count: count() }).from(ordersTable).where(eq(ordersTable.status, "pending")),
    /* active rides: searching / accepted / active */
    db.select({ count: count() }).from(ridesTable)
      .where(or(eq(ridesTable.status, "searching"), eq(ridesTable.status, "accepted"), eq(ridesTable.status, "active"))),
    /* active SOS: pending (unhandled) or acknowledged (in progress) — not yet resolved */
    db.select({ count: count() }).from(notificationsTable)
      .where(and(eq(notificationsTable.type, "sos"), or(eq(notificationsTable.sosStatus, "pending"), eq(notificationsTable.sosStatus, "acknowledged")))),
    db.select({ total: sum(ordersTable.total) }).from(ordersTable).where(eq(ordersTable.status, "delivered")),
    db.select({ total: sum(ridesTable.fare) }).from(ridesTable).where(eq(ridesTable.status, "completed")),
    db.select({ total: sum(pharmacyOrdersTable.total) }).from(pharmacyOrdersTable).where(eq(pharmacyOrdersTable.status, "delivered")),
    db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt)).limit(5),
    db.select().from(ridesTable).orderBy(desc(ridesTable.createdAt)).limit(5),
  ]);

  sendSuccess(res, {
    users: userCount!.count,
    orders: orderCount!.count,
    rides: rideCount!.count,
    pendingOrders: pendingOrderCount!.count,
    activeRides: activeRideCount!.count,
    activeSos: activeSosCount!.count,
    pharmacyOrders: pharmCount!.count,
    parcelBookings: parcelCount!.count,
    products: productCount!.count,
    revenue: {
      orders: parseFloat(totalRevenue!.total ?? "0"),
      rides: parseFloat(rideRevenue!.total ?? "0"),
      pharmacy: parseFloat(pharmRevenue!.total ?? "0"),
      total:
        parseFloat(totalRevenue!.total ?? "0") +
        parseFloat(rideRevenue!.total ?? "0") +
        parseFloat(pharmRevenue!.total ?? "0"),
    },
    recentOrders: recentOrders.map(o => ({
      ...o,
      total: parseFloat(String(o.total)),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    })),
    recentRides: recentRides.map(r => ({
      ...r,
      fare: parseFloat(r.fare),
      distance: parseFloat(r.distance),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
});

router.get("/platform-settings", async (_req, res) => {
  try {
    /* Always seed new defaults (onConflictDoNothing keeps existing values intact) */
    await db.insert(platformSettingsTable).values(DEFAULT_PLATFORM_SETTINGS).onConflictDoNothing();
    const rows = await db.select().from(platformSettingsTable);
    const grouped: Record<string, Array<{ key: string; value: string; label: string; updatedAt: string }>> = {};
    for (const row of rows) {
      if (!grouped[row.category]) grouped[row.category] = [];
      grouped[row.category]!.push({ key: row.key, value: row.value, label: row.label, updatedAt: row.updatedAt.toISOString() });
    }
    sendSuccess(res, { settings: rows.map(r => ({ ...r, updatedAt: r.updatedAt.toISOString() })), grouped });
  } catch (e) {
    logger.error({ err: e }, "[admin/system] platform-settings list error");
    sendError(res, "Failed to load platform settings.", 500);
  }
});

const ALLOWED_SETTING_KEYS = new Set(DEFAULT_PLATFORM_SETTINGS.map(s => s.key));

const bulkSettingsSchema = z.object({
  settings: z
    .array(
      z.object({
        key: z.string().min(1, "key must be non-empty").max(100, "key must be at most 100 characters"),
        value: z.string().max(5000, "value must be at most 5000 characters"),
      }),
    )
    .min(1, "settings array must not be empty")
    .max(500, "settings array must not exceed 500 items"),
});

function rejectUnknownKeys(settings: Array<{ key: string }>, res: import("express").Response): boolean {
  const unknown = settings.filter(s => !ALLOWED_SETTING_KEYS.has(s.key)).map(s => s.key);
  if (unknown.length > 0) {
    sendError(res, `Unknown setting key(s): ${unknown.join(", ")}`, 422);
    return true;
  }
  return false;
}

/* Keys that must be valid finite numbers */
const NUMERIC_SETTING_KEYS = new Set([
  "dispatch_min_radius_km", "dispatch_max_radius_km", "dispatch_avg_speed_kmh",
  "ride_cancellation_fee", "ride_cancel_grace_sec", "ride_surge_multiplier", "ride_bargaining_min_pct",
  "finance_gst_pct", "customer_signup_bonus",
  "payment_min_online", "payment_max_online",
  "security_login_max_attempts", "security_lockout_minutes", "security_otp_cooldown_sec",
  "security_otp_max_per_phone", "security_otp_max_per_ip", "security_otp_window_min",
  "auth_trusted_device_days", "order_refund_days",
  "haversine_terrain_multiplier", "gps_max_speed_kmh",
]);

/* Keys that must be strictly "on" or "off" */
const BOOLEAN_SETTING_KEYS = new Set([
  "feature_rides", "feature_wallet", "feature_mart", "feature_food", "feature_parcel",
  "feature_pharmacy", "feature_school", "feature_new_users",
  "ride_bargaining_enabled", "ride_surge_enabled", "rider_cash_allowed",
  "cod_enabled", "finance_gst_enabled", "jazzcash_enabled", "easypaisa_enabled",
  "security_global_dev_otp", "security_otp_bypass", "security_phone_verify",
  "otp_debug_mode", "feature_weather", "user_require_approval", "integration_whatsapp",
  "cod_allowed_rides", "wallet_allowed_rides", "jazzcash_allowed_rides", "easypaisa_allowed_rides",
]);

function isValidOctet(s: string): boolean {
  const n = parseInt(s, 10);
  return n >= 0 && n <= 255 && String(n) === s;
}

function isValidIPv4(s: string): boolean {
  const parts = s.split(".");
  return parts.length === 4 && parts.every(isValidOctet);
}

function isValidIpOrCidr(entry: string): boolean {
  if (entry.includes("/")) {
    const [ip, prefix] = entry.split("/");
    const p = parseInt(prefix, 10);
    return isValidIPv4(ip) && !isNaN(p) && p >= 0 && p <= 32 && String(p) === prefix;
  }
  return isValidIPv4(entry);
}

function validateSettingValue(key: string, value: string): string | null {
  if (NUMERIC_SETTING_KEYS.has(key)) {
    const n = parseFloat(value);
    if (!Number.isFinite(n)) return `Setting "${key}" must be a valid number (got: "${value}")`;
  }
  if (BOOLEAN_SETTING_KEYS.has(key)) {
    if (value !== "on" && value !== "off") return `Setting "${key}" must be "on" or "off" (got: "${value}")`;
  }
  if (key === "security_admin_ip_whitelist" && value.trim()) {
    const entries = value.split(",").map((s: string) => s.trim()).filter(Boolean);
    const invalid = entries.filter((e: string) => !isValidIpOrCidr(e));
    if (invalid.length > 0) {
      return `Invalid IP whitelist entr${invalid.length === 1 ? "y" : "ies"}: ${invalid.join(", ")}. Use IPv4 or CIDR notation (e.g. 192.168.1.1 or 10.0.0.0/8).`;
    }
  }
  if (key === "primary_otp_channel") {
    const allowed = ["sms", "whatsapp", "email", "all"] as const;
    if (!allowed.includes(value as (typeof allowed)[number])) {
      return `Setting "primary_otp_channel" must be one of: ${allowed.join(", ")} (got: "${value}")`;
    }
  }
  if (key === "provider_credentials") {
    if (value && value !== "{}") {
      try { JSON.parse(value); } catch {
        return `Setting "provider_credentials" must be valid JSON (got invalid JSON)`;
      }
    }
  }
  return null;
}

router.put("/platform-settings", validateBody(bulkSettingsSchema), async (req, res) => {
  const { settings } = req.body as z.infer<typeof bulkSettingsSchema>;
  if (rejectUnknownKeys(settings, res)) return;
  for (const { key, value } of settings) {
    const err = validateSettingValue(key, String(value));
    if (err) { sendError(res, err, 422); return; }
  }
  /* Fetch old values before writing so we can record them in the audit log */
  const keys = settings.map(s => s.key);
  const oldRows = await db.select().from(platformSettingsTable).where(
    inArray(platformSettingsTable.key, keys)
  );
  const oldValueMap: Record<string, string> = {};
  for (const r of oldRows) oldValueMap[r.key] = r.value;

  for (const { key, value } of settings) {
    await db
      .insert(platformSettingsTable)
      .values({ key, value: String(value), label: key, category: "custom", updatedAt: new Date() })
      .onConflictDoUpdate({
        target: platformSettingsTable.key,
        set:    { value: String(value), updatedAt: new Date() },
      });
  }
  /* Bust both caches so new values apply immediately to all call sites */
  invalidateSettingsCache();
  invalidatePlatformSettingsCache();

  /* Build structured change list for audit — redact sensitive values */
  const changes = settings.map(s => ({
    key: s.key,
    oldValue: redactAuditValue(s.key, oldValueMap[s.key] ?? null),
    newValue: redactAuditValue(s.key, String(s.value)),
  }));
  addAuditEntry({
    action: "settings_update",
    ip: getClientIp(req),
    adminId: (req as AdminRequest).adminId,
    details: JSON.stringify({ count: settings.length, changes }),
    result: "success",
  }, true);
  const rows = await db.select().from(platformSettingsTable);
  sendSuccess(res, { settings: rows.map(r => ({ ...r, updatedAt: r.updatedAt.toISOString() })) });
});

/* ── Backup: download all settings as JSON ───────────────────────────────── */
router.get("/platform-settings/backup", async (req, res) => {
  try {
    const rows = await db.select().from(platformSettingsTable);
    const payload = {
      _meta: {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        count: rows.length,
        source: "AJKMart Admin Panel",
      },
      settings: rows.map(r => ({
        key: r.key,
        value: r.value,
        category: r.category,
        label: r.label,
      })),
    };
    addAuditEntry({ action: "settings_backup", ip: getClientIp(req), adminId: (req as AdminRequest).adminId, details: `Exported ${rows.length} settings`, result: "success" });
    sendSuccess(res, payload);
  } catch (e) {
    logger.error({ err: e }, "[admin/system] platform-settings backup error");
    sendError(res, "Failed to export settings backup.", 500);
  }
});

/* ── Restore: import settings from a backup JSON ─────────────────────────── */
router.post("/platform-settings/restore", validateBody(bulkSettingsSchema), async (req, res) => {
  const { settings } = req.body as z.infer<typeof bulkSettingsSchema>;
  if (rejectUnknownKeys(settings, res)) return;
  const errors: string[] = [];
  for (const { key, value } of settings) {
    const err = validateSettingValue(key, value);
    if (err) errors.push(err);
  }
  if (errors.length > 0) { sendError(res, `Validation failed: ${errors.slice(0, 3).join("; ")}`, 422); return; }

  /* Fetch old values before writing */
  const restoreKeys = settings.map(s => s.key);
  const oldRestoreRows = await db.select().from(platformSettingsTable).where(
    restoreKeys.length === 1 ? eq(platformSettingsTable.key, restoreKeys[0]!) : sql`${platformSettingsTable.key} = ANY(${restoreKeys})`
  );
  const oldRestoreMap: Record<string, string> = {};
  for (const r of oldRestoreRows) oldRestoreMap[r.key] = r.value;

  let updated = 0;
  let skipped = 0;
  const restoreChanges: Array<{ key: string; oldValue: string | null; newValue: string }> = [];
  for (const { key, value } of settings) {
    const result = await db
      .update(platformSettingsTable)
      .set({ value: String(value), updatedAt: new Date() })
      .where(eq(platformSettingsTable.key, key))
      .returning({ key: platformSettingsTable.key });
    if (result.length > 0) {
      updated++;
      restoreChanges.push({ key, oldValue: redactAuditValue(key, oldRestoreMap[key] ?? null), newValue: redactAuditValue(key, String(value)) ?? String(value) });
    } else { skipped++; }
  }
  invalidateSettingsCache();
  invalidatePlatformSettingsCache();
  addAuditEntry({
    action: "settings_restore",
    ip: getClientIp(req),
    adminId: (req as AdminRequest).adminId,
    details: JSON.stringify({ restored: updated, skipped, changes: restoreChanges }),
    result: "success",
  }, true);
  const rows = await db.select().from(platformSettingsTable);
  sendSuccess(res, { restored: updated, skipped, settings: rows.map(r => ({ ...r, updatedAt: r.updatedAt.toISOString() })) });
});

const patchSettingSchema = z.object({ value: z.string() });

router.patch("/platform-settings/:key", validateBody(patchSettingSchema), async (req, res) => {
  const { value } = req.body;
  const settingKey = req.params["key"]!;
  const err = validateSettingValue(settingKey, String(value));
  if (err) { sendError(res, err, 422); return; }
  /* Fetch old value before writing */
  const [oldRow] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, settingKey));
  const oldValue = oldRow?.value ?? null;
  const [row] = await db
    .update(platformSettingsTable)
    .set({ value: String(value), updatedAt: new Date() })
    .where(eq(platformSettingsTable.key, settingKey))
    .returning();
  if (!row) { sendNotFound(res, "Setting not found"); return; }
  /* Bust both caches so new values apply immediately to all call sites */
  invalidateSettingsCache();
  invalidatePlatformSettingsCache();
  addAuditEntry({
    action: "settings_update",
    ip: getClientIp(req),
    adminId: (req as AdminRequest).adminId,
    details: JSON.stringify({ count: 1, changes: [{ key: settingKey, oldValue: redactAuditValue(settingKey, oldValue), newValue: redactAuditValue(settingKey, String(value)) }] }),
    result: "success",
  }, true);
  sendSuccess(res, { ...row, updatedAt: row.updatedAt.toISOString() });
});

/* ── Integration Test Endpoints ────────────────────────────────────────────
 * POST /api/admin/system/test-integration/email
 * POST /api/admin/system/test-integration/sms
 * POST /api/admin/system/test-integration/whatsapp
 * POST /api/admin/system/test-integration/fcm
 * POST /api/admin/system/test-integration/maps
 *
 * Each returns { sent, message } after attempting to send with current settings.
 */
router.post("/test-integration/email", async (_req, res) => {
  try {
    const settings = await getCachedSettings();
    const result = await sendAdminAlert(
      "new_vendor",
      "Test Email from AJKMart Admin",
      `
        <h3>✅ Email Integration Test</h3>
        <p>This is a test alert sent from the AJKMart Admin Panel to verify your SMTP configuration is working correctly.</p>
        <p style="color:#6b7280; font-size:13px;">Sent at: ${new Date().toISOString()}</p>
      `,
      { ...settings, email_alert_new_vendor: "on" },
    );
    if (result.sent) {
      sendSuccess(res, { sent: true, message: `Test email sent to ${settings["smtp_admin_alert_email"]}` });
    } else {
      sendError(res, result.reason ?? result.error ?? "Email test failed", 400);
    }
  } catch (err: unknown) {
    sendError(res, (err instanceof Error ? err.message : null) ?? "Email test failed unexpectedly", 502);
  }
});

router.post("/test-integration/sms", async (req, res) => {
  try {
    const settings = await getCachedSettings();
    const { phone } = req.body as { phone?: string };
    if (!phone) { sendValidationError(res, "phone number required"); return; }
    const testOtp = "123456";
    const result = await sendOtpSMS(phone, testOtp, { ...settings, integration_sms: "on" });
    if (result.sent) {
      sendSuccess(res, { sent: true, message: `Test SMS sent to ${phone} via ${result.provider}` });
    } else {
      sendError(res, result.error ?? "SMS test failed", 400);
    }
  } catch (err: unknown) {
    sendError(res, (err instanceof Error ? err.message : null) ?? "SMS test failed unexpectedly", 502);
  }
});

router.post("/test-integration/whatsapp", async (req, res) => {
  try {
    const settings = await getCachedSettings();
    const { phone } = req.body as { phone?: string };
    if (!phone) { sendValidationError(res, "phone number required"); return; }
    const testOtp = "123456";
    const result = await sendWhatsAppOTP(phone, testOtp, {
      ...settings,
      integration_whatsapp: "on",
      wa_send_otp: "on",
    });
    if (result.sent) {
      sendSuccess(res, { sent: true, message: `Test WhatsApp message sent to ${phone}`, messageId: result.messageId });
    } else {
      sendError(res, result.error ?? "WhatsApp test failed", 400);
    }
  } catch (err: unknown) {
    sendError(res, (err instanceof Error ? err.message : null) ?? "WhatsApp test failed unexpectedly", 502);
  }
});

router.post("/test-integration/fcm", async (req, res) => {
  try {
    const settings = await getCachedSettings();
    const { deviceToken } = req.body as { deviceToken?: string };
    if (!deviceToken) { sendValidationError(res, "deviceToken is required"); return; }

    const serverKey = settings["fcm_server_key"]?.trim();
    const projectId = settings["fcm_project_id"]?.trim();

    if (!serverKey) {
      sendError(res, "FCM Server Key is not configured. Set fcm_server_key in Integrations → Firebase.", 400);
      return;
    }
    if (!projectId) {
      sendError(res, "Firebase Project ID is not configured. Set fcm_project_id in Integrations → Firebase.", 400);
      return;
    }

    const resp = await fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `key=${serverKey}`,
      },
      body: JSON.stringify({
        to: deviceToken,
        notification: {
          title: "AJKMart — Test Push Notification ✅",
          body: `This is a test push sent from AJKMart Admin at ${new Date().toISOString()}`,
        },
        data: { type: "test", timestamp: Date.now().toString() },
      }),
    });

    const body = await resp.json() as { error?: string; failure?: number; results?: Array<{ error?: string; message_id?: string }> };

    if (!resp.ok) {
      sendError(res, body?.error ?? `FCM HTTP ${resp.status}`, 400);
      return;
    }
    if (body?.failure && body.failure > 0) {
      const errDetail = body?.results?.[0]?.error ?? "Unknown FCM error";
      sendError(res, `FCM rejected the message: ${errDetail}`, 400);
      return;
    }

    sendSuccess(res, { sent: true, message: `Test push notification sent to device token successfully`, fcmMessageId: body?.results?.[0]?.message_id });
  } catch (err: unknown) {
    sendError(res, (err instanceof Error ? err.message : null) ?? "FCM test failed unexpectedly", 502);
  }
});

router.post("/test-integration/maps", async (req, res) => {
  try {
    const settings = await getCachedSettings();
    /* Use the correct key names that match the Maps Management UI and whitelist */
    const mapsProvider = settings["map_search_provider"] ?? settings["map_provider_primary"] ?? settings["maps_provider"] ?? "osm";
    const googleKey     = settings["google_maps_api_key"]?.trim() || settings["maps_api_key"]?.trim();
    const mapboxKey     = settings["mapbox_api_key"]?.trim();
    const locationIqKey = settings["locationiq_api_key"]?.trim();

    const testQuery = "Muzaffarabad, Azad Kashmir";
    const start = Date.now();
    let provider = mapsProvider;
    let result: unknown = null;

    async function safeJson(resp: Response): Promise<unknown> {
      const ct = resp.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        const text = await resp.text().catch(() => "");
        throw new Error(`Unexpected non-JSON response (HTTP ${resp.status}): ${text.slice(0, 200).replace(/<[^>]*>/g, "").trim() || "No details"}`);
      }
      return resp.json();
    }

    if (mapsProvider === "google") {
      if (!googleKey) {
        sendError(res, "Google Maps API key is not configured. Set google_maps_api_key in Integrations → Maps.", 400);
        return;
      }
      provider = "google";
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(testQuery)}&key=${googleKey}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const body = await safeJson(resp) as { status?: string; error_message?: string; results?: Array<{ geometry?: { location?: unknown } }> };
      if (body?.status !== "OK") {
        sendError(res, `Google Maps geocoding failed: ${body?.status} — ${body?.error_message ?? ""}`, 400);
        return;
      }
      result = body?.results?.[0]?.geometry?.location;
    } else if (mapsProvider === "mapbox") {
      if (!mapboxKey) {
        sendError(res, "Mapbox API key is not configured. Set mapbox_api_key in Integrations → Maps.", 400);
        return;
      }
      provider = "mapbox";
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(testQuery)}.json?access_token=${mapboxKey}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const body = await safeJson(resp) as { message?: string; features?: Array<{ center?: unknown }> };
      if (!resp.ok || !body?.features?.length) {
        sendError(res, `Mapbox geocoding failed: ${body?.message ?? `HTTP ${resp.status}`}`, 400);
        return;
      }
      result = body?.features?.[0]?.center;
    } else if (mapsProvider === "locationiq") {
      if (!locationIqKey) {
        sendError(res, "LocationIQ API key is not configured. Set locationiq_api_key in Integrations → Maps.", 400);
        return;
      }
      provider = "locationiq";
      const url = `https://us1.locationiq.com/v1/search?key=${locationIqKey}&q=${encodeURIComponent(testQuery)}&format=json&limit=1`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      type LiqResult = Array<{ lat?: unknown; lon?: unknown; error?: string }>;
      type LiqError  = { error?: string };
      const body = await safeJson(resp) as LiqResult | LiqError;
      if (!resp.ok || (Array.isArray(body) && body.length === 0)) {
        const errMsg = !Array.isArray(body) ? (body as LiqError).error : undefined;
        sendError(res, `LocationIQ geocoding failed: ${errMsg ?? `HTTP ${resp.status}`}`, 400);
        return;
      }
      const bodyArr = Array.isArray(body) ? (body as LiqResult) : [];
      result = { lat: bodyArr[0]?.lat, lon: bodyArr[0]?.lon };
    } else {
      /* OSM / Nominatim — free, no key required */
      provider = "osm";
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(testQuery)}&format=json&limit=1`;
      const resp = await fetch(url, { headers: { "User-Agent": "AJKMart-Admin-Test/1.0" }, signal: AbortSignal.timeout(8000) });
      const body = await safeJson(resp) as Array<{ lat?: unknown; lon?: unknown; display_name?: string }>;
      if (!resp.ok || !Array.isArray(body) || body.length === 0) {
        sendError(res, `Nominatim geocoding failed: HTTP ${resp.status}`, 400);
        return;
      }
      result = { lat: body[0]?.lat, lon: body[0]?.lon, display_name: body[0]?.display_name };
    }

    const latencyMs = Date.now() - start;
    sendSuccess(res, { sent: true, message: `Geocoding test passed via ${provider} — found location for "${testQuery}"`, provider, latencyMs, result, query: testQuery });
  } catch (err: unknown) {
    sendError(res, (err instanceof Error ? err.message : null) ?? "Maps test failed unexpectedly", 502);
  }
});

/* ── Pharmacy Orders Enriched ── */
router.get("/app-overview", async (_req, res) => {
  const [
    totalUsers, activeUsers, bannedUsers,
    totalOrders, pendingOrders,
    totalRides, activeRides,
    totalPharmacy, totalParcel,
    settings, adminAccounts,
  ] = await Promise.all([
    db.select({ c: count() }).from(usersTable),
    db.select({ c: count() }).from(usersTable).where(eq(usersTable.isActive, true)),
    db.select({ c: count() }).from(usersTable).where(eq(usersTable.isBanned, true)),
    db.select({ c: count() }).from(ordersTable),
    db.select({ c: count() }).from(ordersTable).where(eq(ordersTable.status, "pending")),
    db.select({ c: count() }).from(ridesTable),
    db.select({ c: count() }).from(ridesTable).where(eq(ridesTable.status, "ongoing")),
    db.select({ c: count() }).from(pharmacyOrdersTable),
    db.select({ c: count() }).from(parcelBookingsTable),
    db.select().from(platformSettingsTable),
    db.select({ c: count() }).from(adminAccountsTable).where(eq(adminAccountsTable.isActive, true)),
  ]);
  const settingsMap = Object.fromEntries(settings.map(s => [s.key, s.value]));
  sendSuccess(res, {
    users:    { total: totalUsers[0]?.c ?? 0, active: activeUsers[0]?.c ?? 0, banned: bannedUsers[0]?.c ?? 0 },
    orders:   { total: totalOrders[0]?.c ?? 0, pending: pendingOrders[0]?.c ?? 0 },
    rides:    { total: totalRides[0]?.c ?? 0, active: activeRides[0]?.c ?? 0 },
    pharmacy: { total: totalPharmacy[0]?.c ?? 0 },
    parcel:   { total: totalParcel[0]?.c ?? 0 },
    adminAccounts: adminAccounts[0]?.c ?? 0,
    appStatus:    settingsMap["app_status"]    || "active",
    appName:      settingsMap["app_name"]      || "AJKMart",
    features: {
      mart:     settingsMap["feature_mart"]     || "on",
      food:     settingsMap["feature_food"]     || "on",
      rides:    settingsMap["feature_rides"]    || "on",
      pharmacy: settingsMap["feature_pharmacy"] || "on",
      parcel:   settingsMap["feature_parcel"]   || "on",
      wallet:   settingsMap["feature_wallet"]   || "on",
    },
  });
});

/* ── Categories Management ── */
router.get("/all-notifications", async (req, res) => {
  const role = req.query["role"] as string | undefined;
  const limit = Math.min(parseInt(String(req.query["limit"] || "100")), 300);
  let userIds: string[] = [];
  if (role) {
    const users = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, role));
    userIds = users.map(u => u.id);
    if (userIds.length === 0) { sendSuccess(res, { notifications: [] }); return; }
  }
  const notifs = await db.select().from(notificationsTable)
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit);
  const filtered = role ? notifs.filter(n => userIds.includes(n.userId)) : notifs;
  const enriched = await Promise.all(filtered.slice(0, 200).map(async n => {
    const [user] = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, n.userId)).limit(1);
    return { ...n, user: user || null };
  }));
  sendSuccess(res, { notifications: enriched });
});

/* ══════════════════════════════════════════════════════════════
   SECURITY MANAGEMENT ENDPOINTS
══════════════════════════════════════════════════════════════ */

/* ── GET /admin/audit-log — view admin action audit trail ── */
router.get("/audit-log", adminAuth, (req, res) => {
  const page   = Math.max(1, parseInt(String(req.query["page"]  || "1")));
  const limit  = Math.min(parseInt(String(req.query["limit"]  || "50")), 500);
  const action = req.query["action"] as string | undefined;
  const result = req.query["result"] as string | undefined;
  const from   = req.query["from"] as string | undefined;
  const to     = req.query["to"]   as string | undefined;

  let entries = [...auditLog];
  if (action) entries = entries.filter(e => e.action.includes(action));
  if (result) entries = entries.filter(e => e.result === result);
  if (from)   entries = entries.filter(e => new Date(e.timestamp) >= new Date(from));
  if (to)     entries = entries.filter(e => new Date(e.timestamp) <= new Date(to));

  const total = entries.length;
  const paginated = entries.slice((page - 1) * limit, page * limit);

  sendSuccess(res, {
    entries: paginated,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

/* ── GET /admin/auth-audit-log — persistent auth event log from DB ── */
router.get("/auth-audit-log", adminAuth, async (req, res) => {
  const limit  = Math.min(parseInt(String(req.query["limit"]  || "100")), 500);
  const event  = req.query["event"] as string | undefined;
  const userId = req.query["userId"] as string | undefined;

  const conditions: SQL[] = [];
  if (event)  conditions.push(eq(authAuditLogTable.event, event));
  if (userId) conditions.push(eq(authAuditLogTable.userId, userId));

  const entries = await db.select().from(authAuditLogTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(authAuditLogTable.createdAt))
    .limit(limit);

  sendSuccess(res, { entries, total: entries.length });
});

/* ── POST /admin/rotate-secret — rotate the admin master secret ── */
router.get("/security-events", adminAuth, (req, res) => {
  const limit    = Math.min(parseInt(String(req.query["limit"]    || "200")), 1000);
  const severity = req.query["severity"] as string | undefined;
  const type     = req.query["type"]     as string | undefined;

  let events = [...securityEvents];
  if (severity) events = events.filter(e => e.severity === severity);
  if (type)     events = events.filter(e => e.type.includes(type));

  sendSuccess(res, {
    events: events.slice(0, limit),
    total: events.length,
    summary: {
      critical: securityEvents.filter(e => e.severity === "critical").length,
      high:     securityEvents.filter(e => e.severity === "high").length,
      medium:   securityEvents.filter(e => e.severity === "medium").length,
      low:      securityEvents.filter(e => e.severity === "low").length,
    },
  });
});

/* ── GET /admin/blocked-ips — list all blocked IPs ── */
router.get("/blocked-ips", adminAuth, async (_req, res) => {
  const blocked = await getBlockedIPList();
  sendSuccess(res, {
    blocked,
    total: blocked.length,
  });
});

/* ── POST /admin/blocked-ips — block an IP ── */
router.post("/blocked-ips", adminAuth, async (req, res) => {
  const { ip, reason } = req.body as { ip: string; reason?: string };
  if (!ip) { sendValidationError(res, "ip required"); return; }

  await blockIP(ip.trim());
  addAuditEntry({
    action: "manual_block_ip",
    ip: getClientIp(req),
    adminId: req.adminId!,
    details: `IP ${ip} manually blocked. Reason: ${reason || "No reason given"}`,
    result: "success",
  });
  addSecurityEvent({ type: "ip_manually_blocked", ip, details: `Admin manually blocked IP: ${ip}. Reason: ${reason || "none"}`, severity: "high" });
  const blocked = await getBlockedIPList();
  sendSuccess(res, { blocked: ip, totalBlocked: blocked.length });
});

/* ── DELETE /admin/blocked-ips/:ip — unblock an IP ── */
router.delete("/blocked-ips/:ip", adminAuth, async (req, res) => {
  const ip = decodeURIComponent(String(req.params["ip"]));
  const wasBlocked = await isIPBlocked(ip);
  await unblockIP(ip);
  addAuditEntry({
    action: "unblock_ip",
    ip: getClientIp(req),
    adminId: req.adminId!,
    details: `IP ${ip} unblocked`,
    result: "success",
  });
  sendSuccess(res, { unblocked: ip, wasBlocked });
});

/* ── GET /admin/login-lockouts — view locked accounts ── */
router.get("/login-lockouts", adminAuth, async (_req, res) => {
  const lockouts = await getActiveLockouts();
  sendSuccess(res, {
    lockouts: lockouts.map(l => ({
      phone: l.key,
      attempts: l.attempts,
      lockedUntil: l.lockedUntil,
      minutesLeft: l.minutesLeft,
    })),
    total: lockouts.length,
  });
});

/* ── DELETE /admin/login-lockouts/:phone — unlock a phone ── */
router.delete("/login-lockouts/:phone", adminAuth, async (req, res) => {
  const phone = decodeURIComponent(String(req.params["phone"]));
  await unlockPhone(phone);
  addAuditEntry({
    action: "admin_unlock_phone",
    ip: getClientIp(req),
    adminId: req.adminId!,
    details: `Admin manually unlocked phone: ${phone}`,
    result: "success",
  });
  sendSuccess(res, { unlocked: phone });
});

/* ── GET /admin/security-dashboard — quick security overview ── */
router.get("/security-dashboard", adminAuth, async (_req, res) => {
  const settings = await getPlatformSettings();
  const now = Date.now();

  const blockedList = await getBlockedIPList();
  const activeBlocks = blockedList.length;
  const lockoutList = await getActiveLockouts();
  const activeLockouts = lockoutList.filter(r => r.minutesLeft !== null && r.minutesLeft > 0).length;
  const recentCritical = securityEvents.filter(e => e.severity === "critical" && new Date(e.timestamp).getTime() > now - 24 * 60 * 60 * 1000).length;
  const recentHigh     = securityEvents.filter(e => e.severity === "high"     && new Date(e.timestamp).getTime() > now - 24 * 60 * 60 * 1000).length;

  sendSuccess(res, {
    status: recentCritical > 0 ? "critical" : recentHigh > 5 ? "warning" : "healthy",
    activeBlockedIPs: activeBlocks,
    activeAccountLockouts: activeLockouts,
    last24hCriticalEvents: recentCritical,
    last24hHighEvents: recentHigh,
    totalAuditEntries: auditLog.length,
    totalSecurityEvents: securityEvents.length,
    settings: {
      otpBypass:      settings["security_otp_bypass"]       === "on",
      mfaRequired:    settings["security_mfa_required"]      === "on",
      autoBlockIP:    settings["security_auto_block_ip"]     === "on",
      spoofDetection: settings["security_spoof_detection"]   === "on",
      fakeOrderDetect:settings["security_fake_order_detect"] === "on",
      rateLimitGeneral: parseInt(settings["security_rate_limit"]  ?? "100", 10),
      rateLimitAdmin:   parseInt(settings["security_rate_admin"]  ?? "60",  10),
      rateLimitRider:   parseInt(settings["security_rate_rider"]  ?? "200", 10),
      rateLimitVendor:  parseInt(settings["security_rate_vendor"] ?? "150", 10),
      sessionDays:      parseInt(settings["security_session_days"]      ?? "30", 10),
      adminTokenHrs:    parseInt(settings["security_admin_token_hrs"]   ?? "24", 10),
      riderTokenDays:   parseInt(settings["security_rider_token_days"]  ?? "30", 10),
      maxLoginAttempts: parseInt(settings["security_login_max_attempts"]?? "5",  10),
      lockoutMinutes:   parseInt(settings["security_lockout_minutes"]   ?? "30", 10),
      maxDailyOrders:   parseInt(settings["security_max_daily_orders"]  ?? "20", 10),
      maxSpeedKmh:      parseInt(settings["security_max_speed_kmh"]     ?? "150",10),
      ipWhitelistActive: !!(settings["security_admin_ip_whitelist"] || "").trim(),
    },
  });
});

/* ── POST /admin/settings (override) — invalidate settings cache on save ── */
/* This wraps the existing settings update to bust the cache */
router.post("/invalidate-cache", adminAuth, (_req, res) => {
  invalidateSettingsCache();
  invalidatePlatformSettingsCache();
  sendSuccess(res, { message: "Settings cache invalidated. New security settings will be applied immediately." });
});

/* ═══════════════════════════════════════════════════════════════
   TOTP / MFA ENDPOINTS
   Sub-admins can set up Google Authenticator / Authy for their account.
   Super admin is not required to use TOTP (secret key is the master).
═══════════════════════════════════════════════════════════════ */

/* GET /admin/me/language — get current admin's saved language */
router.get("/search", async (req, res) => {
  const q = String(req.query["q"] ?? "").trim();
  if (!q || q.length < 2) {
    sendSuccess(res, { users: [], rides: [], orders: [], pharmacy: [], query: q });
    return;
  }

  const pattern = `%${q}%`;

  type UserResult = { id: string; name: string | null; phone: string; email: string | null; role: string; createdAt: Date };
  type RideResult = { id: string; type: string; status: string; pickupAddress: string; dropAddress: string; fare: string | null; offeredFare: string | null; riderName: string | null; createdAt: Date };
  type OrderResult = { id: string; status: string; type: string; total: string; deliveryAddress: string; createdAt: Date };
  type PharmacyResult = { id: string; status: string; total: string; deliveryAddress: string; createdAt: Date };
  type SearchError = { source: string; message: string };

  const errors: SearchError[] = [];

  async function safeSearchQuery<R>(source: string, fn: () => Promise<R[]>): Promise<R[]> {
    try {
      return await fn();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      errors.push({ source, message });
      return [];
    }
  }

  const [users, rides, orders, pharmacy] = await Promise.all([
    safeSearchQuery<UserResult>("users", async () =>
      db.select({
        id:    usersTable.id,
        name:  usersTable.name,
        phone: usersTable.phone,
        email: usersTable.email,
        role:  usersTable.role,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(or(ilike(usersTable.name, pattern), ilike(usersTable.phone, pattern), ilike(usersTable.email, pattern)))
      .orderBy(desc(usersTable.createdAt))
      .limit(5)
    ),

    safeSearchQuery<RideResult>("rides", () =>
      db.select({
        id:            ridesTable.id,
        type:          ridesTable.type,
        status:        ridesTable.status,
        pickupAddress: ridesTable.pickupAddress,
        dropAddress:   ridesTable.dropAddress,
        fare:          ridesTable.fare,
        offeredFare:   ridesTable.offeredFare,
        riderName:     ridesTable.riderName,
        createdAt:     ridesTable.createdAt,
      })
      .from(ridesTable)
      .where(or(
        ilike(ridesTable.id, pattern),
        ilike(ridesTable.pickupAddress, pattern),
        ilike(ridesTable.dropAddress, pattern),
        ilike(ridesTable.riderName, pattern),
        ilike(ridesTable.status, pattern),
      ))
      .orderBy(desc(ridesTable.createdAt))
      .limit(5)
    ),

    safeSearchQuery<OrderResult>("orders", async () =>
      db.select({
        id:              ordersTable.id,
        status:          ordersTable.status,
        type:            ordersTable.type,
        total:           ordersTable.total,
        deliveryAddress: ordersTable.deliveryAddress,
        createdAt:       ordersTable.createdAt,
      })
      .from(ordersTable)
      .where(or(
        ilike(ordersTable.id, pattern),
        ilike(ordersTable.deliveryAddress, pattern),
        ilike(ordersTable.status, pattern),
      ))
      .orderBy(desc(ordersTable.createdAt))
      .limit(5)
    ),

    safeSearchQuery<PharmacyResult>("pharmacy", () =>
      db.select({
        id:              pharmacyOrdersTable.id,
        status:          pharmacyOrdersTable.status,
        total:           pharmacyOrdersTable.total,
        deliveryAddress: pharmacyOrdersTable.deliveryAddress,
        createdAt:       pharmacyOrdersTable.createdAt,
      })
      .from(pharmacyOrdersTable)
      .where(or(
        ilike(pharmacyOrdersTable.id, pattern),
        ilike(pharmacyOrdersTable.deliveryAddress, pattern),
        ilike(pharmacyOrdersTable.status, pattern),
      ))
      .orderBy(desc(pharmacyOrdersTable.createdAt))
      .limit(5)
    ),
  ]);

  sendSuccess(res, {
    users, rides, orders, pharmacy, query: q,
    ...(errors.length > 0 ? { errors, partial: true } : {}),
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   NEW ENDPOINTS — Task 4: Operations Pages (51–100)
══════════════════════════════════════════════════════════════════════════════ */

/* ── PATCH /admin/users/:id/request-correction — ask user to re-upload specific doc ── */
router.get("/leaderboard", async (_req, res) => {
  const vendors = await db.select({
    id:     usersTable.id,
    name:   vendorProfilesTable.storeName,
    phone:  usersTable.phone,
    totalOrders: sql<number>`count(${ordersTable.id})`,
    totalRevenue: sql<number>`coalesce(sum(${ordersTable.total}),0)`,
  })
  .from(usersTable)
  .leftJoin(vendorProfilesTable, eq(usersTable.id, vendorProfilesTable.userId))
  .leftJoin(ordersTable, and(eq(ordersTable.vendorId, usersTable.id), eq(ordersTable.status, "delivered")))
  .where(eq(usersTable.role, "vendor"))
  .groupBy(usersTable.id, vendorProfilesTable.storeName)
  .orderBy(sql`coalesce(sum(${ordersTable.total}),0) desc`)
  .limit(5);

  const riders = await db.select({
    id:   usersTable.id,
    name: usersTable.name,
    phone: usersTable.phone,
    completedTrips: sql<number>`count(${ridesTable.id})`,
    totalEarned: sql<number>`coalesce(sum(${ridesTable.fare}),0)`,
  })
  .from(usersTable)
  .leftJoin(ridesTable, and(eq(ridesTable.riderId, usersTable.id), eq(ridesTable.status, "completed")))
  .where(eq(usersTable.role, "rider"))
  .groupBy(usersTable.id)
  .orderBy(sql`count(${ridesTable.id}) desc`)
  .limit(5);

  sendSuccess(res, {
    vendors: vendors.map(v => ({ ...v, totalRevenue: parseFloat(String(v.totalRevenue)), totalOrders: Number(v.totalOrders) })),
    riders:  riders.map(r  => ({ ...r,  totalEarned: parseFloat(String(r.totalEarned)),  completedTrips: Number(r.completedTrips) })),
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   RIDE MANAGEMENT MODULE — Admin ride actions with full audit logging
══════════════════════════════════════════════════════════════════════════════ */

router.get("/reviews", adminAuth, async (req, res) => {
  const page   = Math.max(1, parseInt(String(req.query["page"]  || "1")));
  const limit  = Math.min(parseInt(String(req.query["limit"] || "50")), 200);
  const offset = (page - 1) * limit;

  const typeFilter    = req.query["type"]    as string | undefined;  // "order" | "ride"
  const starsFilter   = req.query["stars"]   as string | undefined;  // "1"–"5"
  const statusFilter  = req.query["status"]  as string | undefined;  // "visible" | "hidden" | "deleted"
  const subjectFilter = req.query["subject"] as string | undefined;  // "vendor" | "rider"
  const dateFrom      = req.query["dateFrom"] as string | undefined;
  const dateTo        = req.query["dateTo"]   as string | undefined;

  /* ── Order Reviews ── */
  const orderConditions: SQL[] = [];
  if (starsFilter) orderConditions.push(eq(reviewsTable.rating, parseInt(starsFilter)));
  if (statusFilter === "hidden")  orderConditions.push(eq(reviewsTable.hidden, true));
  if (statusFilter === "deleted") orderConditions.push(isNotNull(reviewsTable.deletedAt));
  if (statusFilter === "visible") orderConditions.push(eq(reviewsTable.hidden, false), isNull(reviewsTable.deletedAt));
  if (dateFrom) orderConditions.push(gte(reviewsTable.createdAt, new Date(dateFrom)));
  if (dateTo)   orderConditions.push(lte(reviewsTable.createdAt, new Date(dateTo)));
  /* subject filter:
     vendor = has vendorId (includes dual-rated delivery orders)
     rider  = has riderId (includes both ride-only AND dual-rated delivery orders where rider feedback exists) */
  if (subjectFilter === "vendor") orderConditions.push(isNotNull(reviewsTable.vendorId));
  if (subjectFilter === "rider")  orderConditions.push(isNotNull(reviewsTable.riderId));

  /* ── Ride Ratings ── */
  const rideConditions: SQL[] = [];
  if (starsFilter) rideConditions.push(eq(rideRatingsTable.stars, parseInt(starsFilter)));
  if (statusFilter === "hidden")  rideConditions.push(eq(rideRatingsTable.hidden, true));
  if (statusFilter === "deleted") rideConditions.push(isNotNull(rideRatingsTable.deletedAt));
  if (statusFilter === "visible") rideConditions.push(eq(rideRatingsTable.hidden, false), isNull(rideRatingsTable.deletedAt));
  if (dateFrom) rideConditions.push(gte(rideRatingsTable.createdAt, new Date(dateFrom)));
  if (dateTo)   rideConditions.push(lte(rideRatingsTable.createdAt, new Date(dateTo)));
  /* For ride_ratings: all rows are rider-subject; vendor filter means exclude all ride_ratings */
  const skipRideRatings = subjectFilter === "vendor";

  const [orderReviews, rideRatings] = await Promise.all([
    typeFilter === "ride" ? [] : db
      .select({
        id: reviewsTable.id,
        type: sql<string>`'order'`,
        rating: reviewsTable.rating,
        riderRating: reviewsTable.riderRating,
        comment: reviewsTable.comment,
        orderType: reviewsTable.orderType,
        hidden: reviewsTable.hidden,
        deletedAt: reviewsTable.deletedAt,
        createdAt: reviewsTable.createdAt,
        reviewerId: reviewsTable.userId,
        subjectId: sql<string | null>`COALESCE(${reviewsTable.vendorId}, ${reviewsTable.riderId})`,
        subjectRiderId: reviewsTable.riderId,
        reviewerName: usersTable.name,
        reviewerPhone: usersTable.phone,
        vendorReply: reviewsTable.vendorReply,
        vendorRepliedAt: reviewsTable.vendorRepliedAt,
      })
      .from(reviewsTable)
      .leftJoin(usersTable, eq(reviewsTable.userId, usersTable.id))
      .where(orderConditions.length > 0 ? and(...orderConditions) : undefined)
      .orderBy(desc(reviewsTable.createdAt)),

    (typeFilter === "order" || skipRideRatings) ? [] : db
      .select({
        id: rideRatingsTable.id,
        type: sql<string>`'ride'`,
        rating: rideRatingsTable.stars,
        riderRating: sql<null>`null`,
        comment: rideRatingsTable.comment,
        orderType: sql<string>`'ride'`,
        hidden: rideRatingsTable.hidden,
        deletedAt: rideRatingsTable.deletedAt,
        createdAt: rideRatingsTable.createdAt,
        reviewerId: rideRatingsTable.customerId,
        subjectId: rideRatingsTable.riderId,
        subjectRiderId: rideRatingsTable.riderId,
        reviewerName: usersTable.name,
        reviewerPhone: usersTable.phone,
      })
      .from(rideRatingsTable)
      .leftJoin(usersTable, eq(rideRatingsTable.customerId, usersTable.id))
      .where(rideConditions.length > 0 ? and(...rideConditions) : undefined)
      .orderBy(desc(rideRatingsTable.createdAt)),
  ]);

  /* Merge and sort by date descending */
  const combined = [...orderReviews, ...rideRatings]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const total = combined.length;
  const paginated = combined.slice(offset, offset + limit);

  /* Enrich with subject names */
  const subjectIds = [...new Set(paginated.map(r => r.subjectId).filter(Boolean))];
  const subjectUsers = subjectIds.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name, storeName: vendorProfilesTable.storeName, phone: usersTable.phone })
        .from(usersTable)
        .leftJoin(vendorProfilesTable, eq(usersTable.id, vendorProfilesTable.userId))
        .where(sql`${usersTable.id} = ANY(${subjectIds})`)
    : [];
  const subjectMap = new Map(subjectUsers.map(u => [u.id, u]));

  const enriched = paginated.map(r => ({
    ...r,
    deletedAt: r.deletedAt ? r.deletedAt.toISOString?.() ?? r.deletedAt : null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    subjectName: r.subjectId ? (subjectMap.get(r.subjectId)?.storeName || subjectMap.get(r.subjectId)?.name || null) : null,
    subjectPhone: r.subjectId ? subjectMap.get(r.subjectId)?.phone ?? null : null,
  }));

  sendSuccess(res, { reviews: enriched, total, page, limit, pages: Math.ceil(total / limit) });
});

/* ── PATCH /admin/reviews/:id/hide — toggle hidden status ── */
router.patch("/reviews/:id/hide", adminAuth, async (req, res) => {
  const [existing] = await db.select({ id: reviewsTable.id, hidden: reviewsTable.hidden })
    .from(reviewsTable).where(eq(reviewsTable.id, String(req.params["id"]))).limit(1);
  if (!existing) { sendNotFound(res, "Review not found"); return; }
  const newHidden = !existing.hidden;
  await db.update(reviewsTable).set({ hidden: newHidden }).where(eq(reviewsTable.id, existing.id));
  sendSuccess(res, { hidden: newHidden });
});

/* ── DELETE /admin/reviews/:id — soft delete ── */
router.delete("/reviews/:id", adminAuth, async (req, res) => {
  const adminId = (req as AdminRequest).adminId ?? "admin";
  const [existing] = await db.select({ id: reviewsTable.id })
    .from(reviewsTable).where(eq(reviewsTable.id, String(req.params["id"]))).limit(1);
  if (!existing) { sendNotFound(res, "Review not found"); return; }
  await db.update(reviewsTable)
    .set({ deletedAt: new Date(), deletedBy: adminId, hidden: true })
    .where(eq(reviewsTable.id, existing.id));
  sendSuccess(res);
});

/* ── PATCH /admin/ride-ratings/:id/hide — toggle hidden status ── */
router.patch("/ride-ratings/:id/hide", adminAuth, async (req, res) => {
  const [existing] = await db.select({ id: rideRatingsTable.id, hidden: rideRatingsTable.hidden })
    .from(rideRatingsTable).where(eq(rideRatingsTable.id, String(req.params["id"]))).limit(1);
  if (!existing) { sendNotFound(res, "Ride rating not found"); return; }
  const newHidden = !existing.hidden;
  await db.update(rideRatingsTable).set({ hidden: newHidden }).where(eq(rideRatingsTable.id, existing.id));
  sendSuccess(res, { hidden: newHidden });
});

/* ── DELETE /admin/ride-ratings/:id — soft delete ── */
router.delete("/ride-ratings/:id", adminAuth, async (req, res) => {
  const adminId = (req as AdminRequest).adminId ?? "admin";
  const [existing] = await db.select({ id: rideRatingsTable.id })
    .from(rideRatingsTable).where(eq(rideRatingsTable.id, String(req.params["id"]))).limit(1);
  if (!existing) { sendNotFound(res, "Ride rating not found"); return; }
  await db.update(rideRatingsTable)
    .set({ deletedAt: new Date(), deletedBy: adminId, hidden: true })
    .where(eq(rideRatingsTable.id, existing.id));
  sendSuccess(res);
});

/* ── GET /admin/reviews/export — export CSV ────────────────────────────── */
router.get("/reviews/export", async (req, res) => {
  const { status, type } = req.query as Record<string, string>;

  const conditions: SQL[] = [];
  if (status && status !== "all") conditions.push(eq(reviewsTable.status, status));
  if (type && type !== "all") conditions.push(eq(reviewsTable.orderType, type));

  const rows = await db
    .select({
      review: reviewsTable,
      reviewerName: usersTable.name,
      reviewerPhone: usersTable.phone,
    })
    .from(reviewsTable)
    .leftJoin(usersTable, eq(reviewsTable.userId, usersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(reviewsTable.createdAt));

  const escCSV = (v: unknown) => {
    const s = String(v ?? "").replace(/"/g, '""');
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
  };

  const header = ["id", "orderType", "orderId", "vendorId", "riderId", "reviewer", "stars", "comment", "vendorReply", "status", "date"].join(",");
  const csvRows = rows.map(r => [
    escCSV(r.review.id),
    escCSV(r.review.orderType),
    escCSV(r.review.orderId),
    escCSV(r.review.vendorId || ""),
    escCSV(r.review.riderId || ""),
    escCSV(r.reviewerName || r.reviewerPhone || ""),
    escCSV(r.review.rating),
    escCSV(r.review.comment || ""),
    escCSV(r.review.vendorReply || ""),
    escCSV(r.review.status),
    escCSV(r.review.createdAt.toISOString().slice(0, 10)),
  ].join(","));

  const csv = [header, ...csvRows].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="reviews-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

/* ── POST /admin/reviews/import — import CSV ────────────────────────────── */
router.post("/reviews/import", async (req, res) => {
  const { csvData } = req.body;
  if (!csvData || typeof csvData !== "string") {
    sendValidationError(res, "csvData (string) is required");
    return;
  }

  const lines = csvData.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    sendValidationError(res, "CSV must have a header and at least one data row");
    return;
  }

  const header = lines[0]!.split(",").map(h => h.trim().replace(/^"|"$/g, "").toLowerCase());
  const requiredCols = ["ordertype", "orderid", "stars"];
  const missing = requiredCols.filter(c => !header.includes(c));
  if (missing.length > 0) {
    sendValidationError(res, `Missing required columns: ${missing.join(", ")}`);
    return;
  }

  const col = (row: string[], name: string) => {
    const idx = header.indexOf(name);
    return idx >= 0 ? (row[idx] || "").replace(/^"|"$/g, "").trim() : "";
  };

  let imported = 0, skipped = 0, errored = 0;

  for (let i = 1; i < lines.length; i++) {
    const cells = (lines[i] || "").match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) || lines[i]!.split(",");
    try {
      const orderId   = col(cells, "orderid");
      const userId    = col(cells, "userid") || generateId();
      const orderType = col(cells, "ordertype");
      const ratingStr = col(cells, "stars") || col(cells, "rating");
      const rating    = parseInt(ratingStr);

      if (!orderId || !orderType || isNaN(rating) || rating < 1 || rating > 5) {
        errored++;
        continue;
      }

      const existing = await db.select({ id: reviewsTable.id })
        .from(reviewsTable)
        .where(and(eq(reviewsTable.orderId, orderId), eq(reviewsTable.userId, userId)))
        .limit(1);

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      await db.insert(reviewsTable).values({
        id: generateId(),
        orderId,
        userId,
        vendorId: col(cells, "vendorid") || null,
        riderId: col(cells, "riderid") || null,
        orderType,
        rating,
        comment: col(cells, "comment") || null,
        vendorReply: col(cells, "vendorreply") || null,
        status: col(cells, "status") || "visible",
      });
      imported++;
    } catch {
      errored++;
    }
  }

  sendSuccess(res, { imported, skipped, errored, total: lines.length - 1 });
});

/* ── GET /admin/reviews/moderation-queue — pending moderation ─────────── */
router.get("/reviews/moderation-queue", async (req, res) => {
  const rows = await db
    .select({
      review: reviewsTable,
      reviewerName: usersTable.name,
      reviewerPhone: usersTable.phone,
    })
    .from(reviewsTable)
    .leftJoin(usersTable, eq(reviewsTable.userId, usersTable.id))
    .where(eq(reviewsTable.status, "pending_moderation"))
    .orderBy(desc(reviewsTable.createdAt));

  sendSuccess(res, {
    reviews: rows.map(r => ({
      ...r.review,
      reviewerName: r.reviewerName,
      reviewerPhone: r.reviewerPhone,
    })),
    total: rows.length,
  });
});

/* ── PATCH /admin/reviews/:id/approve — approve a moderated review ──────── */
router.patch("/reviews/:id/approve", async (req, res) => {
  const [updated] = await db.update(reviewsTable)
    .set({ status: "visible" })
    .where(and(eq(reviewsTable.id, req.params["id"]!), eq(reviewsTable.status, "pending_moderation")))
    .returning();
  if (!updated) { sendNotFound(res, "Review not found or not pending moderation"); return; }
  sendSuccess(res, updated);
});

/* ── PATCH /admin/reviews/:id/reject — reject (soft-delete) a moderated review ─ */
router.patch("/reviews/:id/reject", async (req, res) => {
  const [updated] = await db.update(reviewsTable)
    .set({ status: "rejected" })
    .where(eq(reviewsTable.id, req.params["id"]!))
    .returning();
  if (!updated) { sendNotFound(res, "Review not found"); return; }
  sendSuccess(res, updated);
});

/* ── POST /admin/jobs/rating-suspension — auto-suspend low-rated riders/vendors ─ */
router.post("/jobs/rating-suspension", async (req, res) => {
  const s = await getPlatformSettings();
  const riderThreshold  = parseFloat(s["auto_suspend_rating_threshold"] ?? "2.5");
  const riderMinReviews = parseInt(s["auto_suspend_min_reviews"] ?? "10");
  const vendorThreshold  = parseFloat(s["auto_suspend_vendor_threshold"] ?? "2.5");
  const vendorMinReviews = parseInt(s["auto_suspend_vendor_min_reviews"] ?? "10");

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const now = new Date();

  let suspendedRiders = 0;
  let suspendedVendors = 0;

  /* ── Rider auto-suspension ── */
  const riderRatings = await db
    .select({
      riderId: reviewsTable.riderId,
      avgRating: avg(reviewsTable.rating),
      reviewCount: count(),
    })
    .from(reviewsTable)
    .where(and(
      eq(reviewsTable.status, "visible"),
      gte(reviewsTable.createdAt, thirtyDaysAgo),
      ne(reviewsTable.riderId, ""),
    ))
    .groupBy(reviewsTable.riderId);

  for (const row of riderRatings) {
    if (!row.riderId) continue;
    const avg_ = parseFloat(String(row.avgRating ?? "5"));
    const cnt  = Number(row.reviewCount ?? 0);
    if (cnt >= riderMinReviews && avg_ < riderThreshold) {
      const [rider] = await db.select({ id: usersTable.id, isActive: usersTable.isActive, adminOverrideSuspension: usersTable.adminOverrideSuspension })
        .from(usersTable)
        .where(eq(usersTable.id, row.riderId))
        .limit(1);

      if (rider && rider.isActive && !rider.adminOverrideSuspension) {
        await db.update(usersTable).set({
          isActive: false,
          autoSuspendedAt: now,
          autoSuspendReason: `Average rating ${avg_.toFixed(1)} (${cnt} reviews in last 30 days) fell below threshold ${riderThreshold}`,
          updatedAt: now,
        }).where(eq(usersTable.id, rider.id));

        await db.insert(notificationsTable).values({
          id: generateId(),
          userId: rider.id,
          title: "Account Suspended",
          body: `Your account has been automatically suspended due to a low average rating of ${avg_.toFixed(1)} stars. Please contact support for assistance.`,
          type: "system",
          icon: "alert-circle-outline",
        }).catch(() => {});

        suspendedRiders++;
      }
    }
  }

  /* ── Vendor auto-suspension ── */
  const vendorRatings = await db
    .select({
      vendorId: reviewsTable.vendorId,
      avgRating: avg(reviewsTable.rating),
      reviewCount: count(),
    })
    .from(reviewsTable)
    .where(and(
      eq(reviewsTable.status, "visible"),
      gte(reviewsTable.createdAt, thirtyDaysAgo),
      ne(reviewsTable.vendorId, ""),
    ))
    .groupBy(reviewsTable.vendorId);

  for (const row of vendorRatings) {
    if (!row.vendorId) continue;
    const avg_ = parseFloat(String(row.avgRating ?? "5"));
    const cnt  = Number(row.reviewCount ?? 0);
    if (cnt >= vendorMinReviews && avg_ < vendorThreshold) {
      const [vendor] = await db.select({ id: usersTable.id, isActive: usersTable.isActive, adminOverrideSuspension: usersTable.adminOverrideSuspension })
        .from(usersTable)
        .where(eq(usersTable.id, row.vendorId))
        .limit(1);

      if (vendor && vendor.isActive && !vendor.adminOverrideSuspension) {
        await db.update(usersTable).set({
          isActive: false,
          autoSuspendedAt: now,
          autoSuspendReason: `Average vendor rating ${avg_.toFixed(1)} (${cnt} reviews in last 30 days) fell below threshold ${vendorThreshold}`,
          updatedAt: now,
        }).where(eq(usersTable.id, vendor.id));

        await db.insert(notificationsTable).values({
          id: generateId(),
          userId: vendor.id,
          title: "Store Suspended",
          body: `Your store has been automatically suspended due to a low average rating of ${avg_.toFixed(1)} stars. Please contact support for assistance.`,
          type: "system",
          icon: "alert-circle-outline",
        }).catch(() => {});

        suspendedVendors++;
      }
    }
  }

  sendSuccess(res, {
    success: true,
    suspendedRiders,
    suspendedVendors,
    message: `Suspended ${suspendedRiders} rider(s) and ${suspendedVendors} vendor(s) due to low ratings.`,
  });
});

const ALLOWED_SOS_STATUSES = new Set(["pending", "acknowledged", "resolved"]);

/* ── POST /admin/riders/:id/override-suspension — override auto-suspension ─ */
router.get("/sos/alerts", async (req, res) => {
  const page   = Math.max(1, parseInt(String(req.query["page"]  || "1"),  10));
  const limit  = Math.min(50, Math.max(1, parseInt(String(req.query["limit"] || "20"), 10)));
  const offset = (page - 1) * limit;
  const rawStatus = req.query["status"] as string | undefined;
  const statusFilter = rawStatus && ALLOWED_SOS_STATUSES.has(rawStatus) ? rawStatus : undefined;

  const baseWhere = eq(notificationsTable.type, "sos");
  const whereClause = statusFilter
    ? and(baseWhere, eq(notificationsTable.sosStatus, statusFilter))
    : baseWhere;

  const [alerts, totalRows, unresolvedRows] = await Promise.all([
    db.select().from(notificationsTable)
      .where(whereClause)
      .orderBy(desc(notificationsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ id: notificationsTable.id }).from(notificationsTable).where(whereClause).then(r => r.length),
    /* unresolved = pending + acknowledged (anything not resolved) */
    db.select({ id: notificationsTable.id }).from(notificationsTable)
      .where(and(eq(notificationsTable.type, "sos"), ne(notificationsTable.sosStatus, "resolved")))
      .then(r => r.length),
  ]);

  sendSuccess(res, {
    alerts:      alerts.map(serializeSosAlert),
    total:       totalRows,
    page,
    hasMore:     offset + alerts.length < totalRows,
    activeCount: unresolvedRows,
  });
});

/* PATCH /admin/sos/alerts/:id/acknowledge */
router.patch("/sos/alerts/:id/acknowledge", async (req, res) => {
  const alertId  = req.params["id"];
  const adminId  = (req as AdminRequest).adminId  ?? "admin";
  const adminName = (req as AdminRequest).adminName ?? "Admin";

  const [existing] = await db.select().from(notificationsTable)
    .where(and(eq(notificationsTable.id, alertId), eq(notificationsTable.type, "sos")))
    .limit(1);

  if (!existing) { sendNotFound(res, "SOS alert not found"); return; }
  if (existing.sosStatus === "acknowledged") {
    sendErrorWithData(res, "Alert is already acknowledged", { acknowledgedBy: existing.acknowledgedByName ?? existing.acknowledgedBy ?? "another admin" }, 409);
    return;
  }
  if (existing.sosStatus === "resolved") { sendError(res, "Alert is already resolved", 409); return; }

  const now = new Date();
  await db.update(notificationsTable)
    .set({ sosStatus: "acknowledged", acknowledgedAt: now, acknowledgedBy: adminId, acknowledgedByName: adminName })
    .where(eq(notificationsTable.id, alertId));

  const [updatedAck] = await db.select().from(notificationsTable).where(eq(notificationsTable.id, alertId)).limit(1);
  const fullAckPayload = serializeSosAlert(updatedAck) as SosAlertPayload;
  try { emitSosAcknowledged(fullAckPayload); } catch { /* non-critical */ }
  sendSuccess(res, { ok: true, alert: fullAckPayload });
});

/* PATCH /admin/sos/alerts/:id/resolve */
router.patch("/sos/alerts/:id/resolve", async (req, res) => {
  const alertId   = req.params["id"];
  const adminId   = (req as AdminRequest).adminId  ?? "admin";
  const adminName = (req as AdminRequest).adminName ?? "Admin";
  const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : null;

  const [existing] = await db.select().from(notificationsTable)
    .where(and(eq(notificationsTable.id, alertId), eq(notificationsTable.type, "sos")))
    .limit(1);

  if (!existing) { sendNotFound(res, "SOS alert not found"); return; }
  if (existing.sosStatus === "resolved") { sendError(res, "Alert is already resolved", 409); return; }

  const now = new Date();
  await db.update(notificationsTable)
    .set({ sosStatus: "resolved", resolvedAt: now, resolvedBy: adminId, resolvedByName: adminName, resolutionNotes: notes || null })
    .where(eq(notificationsTable.id, alertId));

  const [updatedRes] = await db.select().from(notificationsTable).where(eq(notificationsTable.id, alertId)).limit(1);
  const fullResPayload = serializeSosAlert(updatedRes) as SosAlertPayload;
  try { emitSosResolved(fullResPayload); } catch { /* non-critical */ }
  sendSuccess(res, { ok: true, alert: fullResPayload });
});

/* ══════════════════════════════════════════════════════════════════════════
   VENDOR ADMIN CONTROLS — Batch 2
   ══════════════════════════════════════════════════════════════════════════ */

/* ── GET /admin/vendors/:id/hours — view vendor business hours ── */
router.get("/vendors/:id/hours", adminAuth, async (req, res) => {
  const vendorId = String(req.params["id"]);
  const [user] = await db.select({ storeHours: usersTable.storeHours, storeIsOpen: usersTable.storeIsOpen, role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, vendorId)).limit(1);
  if (!user || user.role !== "vendor") { sendNotFound(res, "Vendor not found"); return; }
  let parsed = null;
  try { parsed = user.storeHours ? JSON.parse(user.storeHours) : null; } catch { /* keep null */ }
  sendSuccess(res, { vendorId, storeHours: parsed, storeIsOpen: user.storeIsOpen });
});

/* ── PATCH /admin/vendors/:id/hours — override vendor hours or force open/closed ── */
router.patch("/vendors/:id/hours", adminAuth, async (req, res) => {
  const vendorId = String(req.params["id"]);
  const { storeHours, storeIsOpen } = req.body;
  const [existing] = await db.select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, vendorId)).limit(1);
  if (!existing || existing.role !== "vendor") { sendNotFound(res, "Vendor not found"); return; }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (storeHours !== undefined) {
    updates.storeHours = typeof storeHours === "string" ? storeHours : JSON.stringify(storeHours);
  }
  if (storeIsOpen !== undefined) updates.storeIsOpen = Boolean(storeIsOpen);

  await db.update(usersTable).set(updates).where(eq(usersTable.id, vendorId));
  sendSuccess(res, { vendorId, updated: Object.keys(updates).filter(k => k !== "updatedAt") });
});

/* ── PATCH /admin/reviews/:id/vendor-reply — edit vendor reply (admin moderation) ── */
router.patch("/reviews/:id/vendor-reply", adminAuth, async (req, res) => {
  const reviewId = String(req.params["id"]);
  const { reply } = req.body;
  if (!reply || typeof reply !== "string" || reply.trim().length === 0) {
    sendValidationError(res, "reply text is required"); return;
  }
  const [existing] = await db.select({ id: reviewsTable.id })
    .from(reviewsTable).where(eq(reviewsTable.id, reviewId)).limit(1);
  if (!existing) { sendNotFound(res, "Review not found"); return; }
  const [updated] = await db.update(reviewsTable)
    .set({ vendorReply: reply.trim(), vendorRepliedAt: new Date() })
    .where(eq(reviewsTable.id, reviewId)).returning();
  sendSuccess(res, updated);
});

/* ── DELETE /admin/reviews/:id/vendor-reply — remove vendor reply (admin moderation) ── */
router.delete("/reviews/:id/vendor-reply", adminAuth, async (req, res) => {
  const reviewId = String(req.params["id"]);
  const [existing] = await db.select({ id: reviewsTable.id, vendorReply: reviewsTable.vendorReply })
    .from(reviewsTable).where(eq(reviewsTable.id, reviewId)).limit(1);
  if (!existing) { sendNotFound(res, "Review not found"); return; }
  if (!existing.vendorReply) { sendNotFound(res, "No vendor reply exists"); return; }
  await db.update(reviewsTable)
    .set({ vendorReply: null, vendorRepliedAt: null })
    .where(eq(reviewsTable.id, reviewId));
  sendSuccess(res, { deleted: true });
});

/* ── GET /admin/vendors/:id/announcement — view store announcement ── */
router.get("/vendors/:id/announcement", adminAuth, async (req, res) => {
  const vendorId = String(req.params["id"]);
  const [user] = await db.select({ storeAnnouncement: usersTable.storeAnnouncement, role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, vendorId)).limit(1);
  if (!user || user.role !== "vendor") { sendNotFound(res, "Vendor not found"); return; }
  sendSuccess(res, { vendorId, storeAnnouncement: user.storeAnnouncement ?? "" });
});

/* ── PATCH /admin/vendors/:id/announcement — override/clear store announcement ── */
router.patch("/vendors/:id/announcement", adminAuth, async (req, res) => {
  const vendorId = String(req.params["id"]);
  const { storeAnnouncement } = req.body;
  const [existing] = await db.select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, vendorId)).limit(1);
  if (!existing || existing.role !== "vendor") { sendNotFound(res, "Vendor not found"); return; }
  const newVal = (typeof storeAnnouncement === "string") ? storeAnnouncement.trim() : "";
  await db.update(usersTable).set({ storeAnnouncement: newVal || null, updatedAt: new Date() }).where(eq(usersTable.id, vendorId));
  sendSuccess(res, { vendorId, storeAnnouncement: newVal });
});

/* ── PATCH /admin/vendors/:id/delivery-time — override vendor delivery time ── */
router.patch("/vendors/:id/delivery-time", adminAuth, async (req, res) => {
  const vendorId = String(req.params["id"]);
  const { storeDeliveryTime } = req.body;
  const [existing] = await db.select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, vendorId)).limit(1);
  if (!existing || existing.role !== "vendor") { sendNotFound(res, "Vendor not found"); return; }
  const newVal = storeDeliveryTime ? String(storeDeliveryTime).trim() : null;
  await db.update(usersTable).set({ storeDeliveryTime: newVal, updatedAt: new Date() }).where(eq(usersTable.id, vendorId));
  sendSuccess(res, { vendorId, storeDeliveryTime: newVal });
});

/* ── GET /admin/bulk-uploads — list all bulk upload logs ── */
router.get("/bulk-uploads", adminAuth, async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query["page"] || "1")));
  const limit = Math.min(parseInt(String(req.query["limit"] || "50")), 200);
  const offset = (page - 1) * limit;
  const vendorFilter = req.query["vendorId"] as string | undefined;
  const dateFrom = req.query["dateFrom"] as string | undefined;
  const dateTo = req.query["dateTo"] as string | undefined;

  const conditions: SQL[] = [];
  if (vendorFilter) conditions.push(eq(bulkUploadLogsTable.vendorId, vendorFilter));
  if (dateFrom) conditions.push(gte(bulkUploadLogsTable.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(bulkUploadLogsTable.createdAt, new Date(dateTo)));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [totalRow]] = await Promise.all([
    db.select({
      log: bulkUploadLogsTable,
      vendorName: usersTable.name,
      storeName: vendorProfilesTable.storeName,
    })
      .from(bulkUploadLogsTable)
      .leftJoin(usersTable, eq(bulkUploadLogsTable.vendorId, usersTable.id))
      .leftJoin(vendorProfilesTable, eq(bulkUploadLogsTable.vendorId, vendorProfilesTable.userId))
      .where(whereClause)
      .orderBy(desc(bulkUploadLogsTable.createdAt))
      .limit(limit).offset(offset),
    db.select({ c: count() }).from(bulkUploadLogsTable).where(whereClause),
  ]);

  const total = totalRow?.c ?? 0;
  sendSuccess(res, {
    uploads: rows.map(r => ({
      ...r.log,
      vendorName: r.storeName || r.vendorName,
      createdAt: r.log.createdAt instanceof Date ? r.log.createdAt.toISOString() : r.log.createdAt,
    })),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  });
});

/* ── GET /admin/bulk-uploads/:vendorId — per-vendor bulk upload history ── */
router.get("/bulk-uploads/:vendorId", adminAuth, async (req, res) => {
  const vendorId = String(req.params["vendorId"]);
  const rows = await db.select()
    .from(bulkUploadLogsTable)
    .where(eq(bulkUploadLogsTable.vendorId, vendorId))
    .orderBy(desc(bulkUploadLogsTable.createdAt))
    .limit(50);
  sendSuccess(res, {
    uploads: rows.map(r => ({
      ...r,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    })),
  });
});

/* ── GET /admin/system/phone-audit ──────────────────────────────────────────
   Returns:
   (a) users with non-canonical phone numbers
   (b) groups of users sharing the same canonical phone (duplicates)
   (c) ghost accounts: no name, no orders/rides/transactions, created 7+ days ago ── */
router.get("/system/phone-audit", adminAuth, async (_req, res) => {
  const allUsers = await db
    .select({
      id: usersTable.id,
      phone: usersTable.phone,
      name: usersTable.name,
      role: usersTable.role,
      isProfileComplete: usersTable.isProfileComplete,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(isNotNull(usersTable.phone))
    .orderBy(asc(usersTable.createdAt));

  const nonCanonical: typeof allUsers = [];
  const canonicalMap = new Map<string, typeof allUsers>();

  for (const u of allUsers) {
    const phone = u.phone!;
    const canonical = canonicalizePhone(phone);
    if (!canonical || canonical !== phone) {
      nonCanonical.push(u);
    }
    const key = canonical ?? phone;
    if (!canonicalMap.has(key)) canonicalMap.set(key, []);
    canonicalMap.get(key)!.push(u);
  }

  const duplicates = [...canonicalMap.values()].filter(g => g.length > 1);

  /* Ghost accounts: no name AND incomplete profile AND old enough.
     Uses strict AND so only fully-abandoned OTP-stage accounts are flagged.
     Activity check (orders, rides, wallet txns) excludes accounts with real usage.
     Non-canonical phone accounts are surfaced separately in nonCanonicalPhones above. */
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const ghostCandidates = await db
    .select({
      id: usersTable.id,
      phone: usersTable.phone,
      name: usersTable.name,
      role: usersTable.role,
      isProfileComplete: usersTable.isProfileComplete,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(
      and(
        isNull(usersTable.name),
        eq(usersTable.isProfileComplete, false),
        lte(usersTable.createdAt, sevenDaysAgo),
      )
    );

  const ghostIds = ghostCandidates.map(u => u.id);

  const ghostsWithActivity: string[] = [];
  if (ghostIds.length > 0) {
    const orderCounts = await db
      .select({ userId: ordersTable.userId, cnt: count() })
      .from(ordersTable)
      .where(inArray(ordersTable.userId, ghostIds))
      .groupBy(ordersTable.userId);
    const rideCustomerCounts = await db
      .select({ userId: ridesTable.userId, cnt: count() })
      .from(ridesTable)
      .where(inArray(ridesTable.userId, ghostIds))
      .groupBy(ridesTable.userId);
    const rideRiderCounts = await db
      .select({ userId: ridesTable.riderId, cnt: count() })
      .from(ridesTable)
      .where(inArray(ridesTable.riderId, ghostIds.map(id => id) as string[]))
      .groupBy(ridesTable.riderId);
    const txCounts = await db
      .select({ userId: walletTransactionsTable.userId, cnt: count() })
      .from(walletTransactionsTable)
      .where(inArray(walletTransactionsTable.userId, ghostIds))
      .groupBy(walletTransactionsTable.userId);
    const activeIds = new Set([
      ...orderCounts.filter(r => (r.cnt ?? 0) > 0).map(r => r.userId),
      ...rideCustomerCounts.filter(r => (r.cnt ?? 0) > 0).map(r => r.userId),
      ...rideRiderCounts.filter(r => (r.cnt ?? 0) > 0).map(r => r.userId).filter((id): id is string => Boolean(id)),
      ...txCounts.filter(r => (r.cnt ?? 0) > 0).map(r => r.userId),
    ]);
    ghostsWithActivity.push(...activeIds);
  }

  const ghosts = ghostCandidates.filter(u => !ghostsWithActivity.includes(u.id));

  sendSuccess(res, {
    summary: {
      nonCanonicalCount: nonCanonical.length,
      duplicateGroupCount: duplicates.length,
      ghostCount: ghosts.length,
    },
    nonCanonicalPhones: nonCanonical.map(u => ({
      id: u.id, phone: u.phone, canonicalPhone: canonicalizePhone(u.phone!),
      name: u.name, role: u.role,
      createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : u.createdAt,
    })),
    duplicateGroups: duplicates.map(group => ({
      canonicalPhone: canonicalizePhone(group[0]!.phone!) ?? group[0]!.phone,
      users: group.map(u => ({
        id: u.id, phone: u.phone, name: u.name, role: u.role,
        createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : u.createdAt,
      })),
    })),
    ghostAccounts: ghosts.map(u => ({
      id: u.id, phone: u.phone, name: u.name, role: u.role,
      createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : u.createdAt,
    })),
  });
});

/* ── POST /admin/system/cleanup-ghosts?dryRun=true ──────────────────────────
   Deletes two classes of dead accounts (both require: no activity + 7+ days old):
   1. Ghost accounts: name IS NULL AND isProfileComplete=false
      (OTP was sent but registration was never completed)
   2. Non-canonical phone accounts: phone stored in non-canonical format
      (these should be migrated/fixed first; flag them for deletion only if safe)
   Always runs in dry-run mode by default. Pass dryRun=false to actually delete. ── */
router.post("/system/cleanup-ghosts", adminAuth, async (req, res) => {
  const dryRun = (req.query["dryRun"] as string) !== "false";

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  /* Fetch all users that are old enough — then classify in-process */
  const allOldUsers = await db
    .select({
      id: usersTable.id,
      phone: usersTable.phone,
      name: usersTable.name,
      role: usersTable.role,
      isProfileComplete: usersTable.isProfileComplete,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(
      and(
        isNotNull(usersTable.phone),
        lte(usersTable.createdAt, sevenDaysAgo),
      )
    );

  /* Classify into ghost (strict AND) and non-canonical */
  const candidates = allOldUsers.filter(u => {
    const isGhost = u.name === null && u.isProfileComplete === false;
    const isNonCanonical = (() => {
      if (!u.phone) return false;
      const canonical = canonicalizePhone(u.phone);
      return !canonical || canonical !== u.phone;
    })();
    return isGhost || isNonCanonical;
  });

  if (candidates.length === 0) {
    sendSuccess(res, { dryRun, wouldDeleteCount: 0, wouldDelete: [], message: "No ghost accounts found." });
    return;
  }

  const candidateIds = candidates.map(u => u.id);

  const [orderCounts, rideCustomerCounts, rideRiderCounts, txCounts] = await Promise.all([
    db.select({ userId: ordersTable.userId, cnt: count() })
      .from(ordersTable)
      .where(inArray(ordersTable.userId, candidateIds))
      .groupBy(ordersTable.userId),
    db.select({ userId: ridesTable.userId, cnt: count() })
      .from(ridesTable)
      .where(inArray(ridesTable.userId, candidateIds))
      .groupBy(ridesTable.userId),
    db.select({ userId: ridesTable.riderId, cnt: count() })
      .from(ridesTable)
      .where(inArray(ridesTable.riderId, candidateIds))
      .groupBy(ridesTable.riderId),
    db.select({ userId: walletTransactionsTable.userId, cnt: count() })
      .from(walletTransactionsTable)
      .where(inArray(walletTransactionsTable.userId, candidateIds))
      .groupBy(walletTransactionsTable.userId),
  ]);

  const activeIds = new Set([
    ...orderCounts.filter(r => (r.cnt ?? 0) > 0).map(r => r.userId),
    ...rideCustomerCounts.filter(r => (r.cnt ?? 0) > 0).map(r => r.userId),
    ...rideRiderCounts.filter(r => (r.cnt ?? 0) > 0).map(r => r.userId).filter((id): id is string => Boolean(id)),
    ...txCounts.filter(r => (r.cnt ?? 0) > 0).map(r => r.userId),
  ]);

  const toDelete = candidates.filter(u => !activeIds.has(u.id));

  const toDeleteMapped = toDelete.map(u => {
    const isGhost = u.name === null && u.isProfileComplete === false;
    const isNonCanonical = (() => {
      if (!u.phone) return false;
      const canonical = canonicalizePhone(u.phone);
      return !canonical || canonical !== u.phone;
    })();
    const reasons: string[] = [];
    if (isGhost) reasons.push("incomplete_registration");
    if (isNonCanonical) reasons.push("non_canonical_phone");
    return {
      id: u.id, phone: u.phone, name: u.name, role: u.role,
      isProfileComplete: u.isProfileComplete,
      createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : u.createdAt,
      reasons,
    };
  });

  if (dryRun) {
    logger.info({ ghostCount: toDelete.length }, "[DRY RUN] Ghost account cleanup — would delete:");
    toDelete.forEach(u => logger.info({ id: u.id, phone: u.phone, role: u.role, createdAt: u.createdAt }, "[DRY RUN] Would delete ghost account"));
    sendSuccess(res, {
      dryRun: true,
      wouldDeleteCount: toDelete.length,
      wouldDelete: toDeleteMapped,
      message: `Dry run complete. ${toDelete.length} ghost account(s) would be deleted. Run with dryRun=false to actually delete.`,
    });
    return;
  }

  const deleteIds = toDelete.map(u => u.id);
  let deletedCount = 0;
  if (deleteIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, deleteIds));
    deletedCount = deleteIds.length;
    logger.info({ deletedCount, ids: deleteIds }, "Ghost account cleanup: deleted accounts");
    addAuditEntry({ action: "ghost_cleanup", details: `Deleted ${deletedCount} ghost accounts`, result: "success" });
  }

  sendSuccess(res, {
    dryRun: false,
    deletedCount,
    deleted: toDeleteMapped,
    message: `Cleanup complete. ${deletedCount} ghost account(s) deleted.`,
  });
});

export default router;
