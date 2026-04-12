import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { z } from "zod";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable, notificationsTable, refreshTokensTable, magicLinkTokensTable, rateLimitsTable, pendingOtpsTable, userSessionsTable, loginHistoryTable, vendorProfilesTable, riderProfilesTable } from "@workspace/db/schema";
import { eq, and, sql, lt, or, desc } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getPlatformSettings } from "./admin.js";
import {
  checkLockout,
  recordFailedAttempt,
  resetAttempts,
  addAuditEntry,
  addSecurityEvent,
  getClientIp,
  getCachedSettings,
  signUserJwt,
  signAccessToken,
  signSetupToken,
  sign2faChallengeToken,
  verify2faChallengeToken,
  generateRefreshToken,
  hashRefreshToken,
  isRefreshTokenValid,
  revokeRefreshToken,
  revokeAllUserRefreshTokens,
  verifyUserJwt,
  writeAuthAuditLog,
  REFRESH_TOKEN_TTL_DAYS,
  ACCESS_TOKEN_TTL_SEC,
  verifyCaptcha,
  checkAvailableRateLimit,
} from "../middleware/security.js";
import { sendOtpSMS } from "../services/sms.js";
import { sendWhatsAppOTP } from "../services/whatsapp.js";
import { sendOtp as notificationSendOtp, isOtpDebugMode, mergeProviderCredentials } from "../services/notification.js";
import { randomBytes, createHash } from "crypto";
import { hashPassword, verifyPassword, validatePasswordStrength, generateSecureOtp } from "../services/password.js";
import { generateTotpSecret, verifyTotpToken, generateQRCodeDataURL, getTotpUri, encryptTotpSecret, decryptTotpSecret } from "../services/totp.js";
import { sendVerificationEmail, sendPasswordResetEmail, sendMagicLinkEmail, alertNewVendor } from "../services/email.js";
import { getUserLanguage, getPlatformDefaultLanguage } from "../lib/getUserLanguage.js";
import { t, type TranslationKey } from "@workspace/i18n";
import { getRequestLocale, parseAcceptLanguage } from "../lib/requestLocale.js";
import { logger } from "../lib/logger.js";
import { clearSpoofHits } from "./rider.js";
import { canonicalizePhone } from "@workspace/phone-utils";
import { validateBody as sharedValidateBody } from "../middleware/validate.js";
import { stripHtml } from "../lib/sanitize.js";

/* OTP rate limiting is handled per-account + per-IP inside the route handler
   using the admin-configurable settings (security_otp_max_per_phone,
   security_otp_max_per_ip, security_otp_window_min) via checkAndIncrOtpRateLimit(). */

/* ── OTP verify IP-level rate limiter ────────────────────────────────────────
   Limits /auth/verify-otp to 5 attempts per IP per 15 minutes, regardless of
   which phone numbers are targeted. This prevents an attacker from cycling
   through many accounts from a single IP.
────────────────────────────────────────────────────────────────────────────── */
const verifyOtpIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "production" ? 5 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: (req: Request) => ({ error: t("apiErrTooManyRequests", parseAcceptLanguage(req.headers["accept-language"] as string | undefined) ?? "en") }),
  validate: { xForwardedForHeader: false },
  keyGenerator: (req) => getClientIp(req),
});

/* ── OTP TTL ─────────────────────────────────────────────────
   All auth OTPs (phone, email, forgot-password) expire in 5 minutes.
   Account-merge OTPs use a longer 10-minute window.
   ──────────────────────────────────────────────────────────── */
const AUTH_OTP_TTL_MS = 5 * 60 * 1000;

/* ── Auth Zod schemas ─────────────────────────────────────────
   One schema per key endpoint. Extra/unknown fields are stripped.
   ──────────────────────────────────────────────────────────── */
const checkIdentifierSchema = z.object({
  identifier: z.string().min(3, "Identifier must be at least 3 characters"),
  role: z.enum(["customer", "rider", "vendor"]).optional(),
  deviceId: z.string().max(256).optional(),
}).strip();

const phoneSchema = z
  .string()
  .min(7, "Phone number is required")
  .max(20, "Phone number too long")
  .regex(/^[\d\s\-()+]{7,20}$/, "Phone number must contain only digits, spaces, dashes, or parentheses");

const sendOtpSchema = z.object({
  phone: phoneSchema,
  role: z.enum(["customer", "rider", "vendor"]).optional(),
  mode: z.enum(["login", "register"]).optional(),
  deviceId: z.string().max(256).optional(),
  preferredChannel: z.enum(["whatsapp", "sms", "email"]).optional(),
  captchaToken: z.string().optional(),
}).strip();

const verifyOtpSchema = z.object({
  phone: phoneSchema,
  otp: z.string().length(6, "OTP must be exactly 6 digits").regex(/^\d{6}$/, "OTP must be 6 digits"),
  deviceFingerprint: z.string().max(512).optional(),
  deviceId: z.string().max(256).optional(),
  role: z.enum(["customer", "rider", "vendor"]).optional(),
}).strip();

const loginSchema = z.object({
  identifier: z.string().min(3, "Identifier (phone, email, or username) is required").optional(),
  username: z.string().min(3).optional(),
  password: z.string().min(1, "Password is required"),
  deviceFingerprint: z.string().max(512).optional(),
  role: z.enum(["customer", "rider", "vendor"]).optional(),
}).strip().refine(d => d.identifier || d.username, {
  message: "Phone, email, or username is required",
  path: ["identifier"],
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(10, "refreshToken is required"),
}).strip();

const forgotPasswordSchema = z.object({
  phone: z.string().min(7).optional(),
  email: z.string().email("Invalid email address").optional(),
  identifier: z.string().min(3).optional(),
}).strip().refine(d => d.phone || d.email || d.identifier, {
  message: "Phone, email, or username is required",
  path: ["phone"],
});

const registerSchema = z.object({
  phone: z.string().min(7, "Phone number is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().max(80).transform(stripHtml).optional(),
  role: z.enum(["customer", "rider", "vendor"]).optional(),
  email: z.string().email().optional().or(z.literal("")),
  username: z.string().min(3).max(20).regex(/^[a-z0-9_]+$/, "Username can only contain lowercase letters, numbers, and underscores").optional(),
  cnic: z.string().regex(/^\d{5}-\d{7}-\d{1}$/, "CNIC format must be XXXXX-XXXXXXX-X").optional().or(z.literal("")),
  nationalId: z.string().optional(),
  vehicleType: z.string().optional(),
  vehicleRegNo: z.string().optional(),
  drivingLicense: z.string().optional(),
  address: z.string().max(255).transform(stripHtml).optional(),
  city: z.string().max(80).optional(),
  emergencyContact: z.string().optional(),
  vehiclePlate: z.string().optional(),
  vehiclePhoto: z.string().optional(),
  documents: z.string().optional(),
  businessName: z.string().max(120).transform(stripHtml).optional(),
  businessType: z.string().optional(),
  storeAddress: z.string().max(255).optional(),
  ntn: z.string().optional(),
  storeName: z.string().max(120).optional(),
  captchaToken: z.string().optional(),
}).strip();

function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}

function normalizeVehicleTypeForStorage(raw: string): string {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return raw;
  const slug = v.replace(/[\s_\-]+/g, "_").replace(/[^a-z0-9_]/g, "").replace(/_+/g, "_").replace(/^_|_$/g, "");
  const words = slug.split("_").filter(Boolean);
  const wordSet = new Set(words);

  const isMotorcycle = slug === "motorcycle" || wordSet.has("motorcycle") || wordSet.has("motorbike") ||
    (wordSet.has("motor") && (wordSet.has("cycle") || wordSet.has("bike")));
  const isBike = slug === "bike" || wordSet.has("bike");
  if (isBike || isMotorcycle) return "bike";

  if (slug === "car") return "car";

  const isRickshaw = slug === "rickshaw" || wordSet.has("rickshaw") || wordSet.has("qingqi");
  if (isRickshaw) return "rickshaw";

  if (slug === "van") return "van";
  if (slug === "daba") return "daba";
  if (slug === "bicycle") return "bicycle";
  if (slug === "on_foot" || (wordSet.has("on") && wordSet.has("foot"))) return "on_foot";

  return slug || v;
}

function generateVerificationToken(): string {
  return randomBytes(32).toString("hex");
}

function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}


function isValidCanonicalPhone(phone: string | null): phone is string {
  return phone !== null && /^92\d{10}$/.test(phone);
}

const router: IRouter = Router();

/* ══════════════════════════════════════════════════════════════
   POST /auth/check-identifier
   Unified Auth Gatekeeper — Account Discovery.
   Step 1 of the smart "Continue" login flow.
   Body: { identifier: string, role?: string, deviceId?: string }
   Returns what the client should do next: action + available methods.

   Rate-limited to 10 requests/min/IP to prevent phone number enumeration.
══════════════════════════════════════════════════════════════ */
const checkIdentifierLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: (req: Request) => ({ error: t("apiErrTooManyIdentifierChecks", parseAcceptLanguage(req.headers["accept-language"] as string | undefined) ?? "en") }),
  validate: { xForwardedForHeader: false },
  keyGenerator: (req) => getClientIp(req),
});

router.post("/check-identifier", checkIdentifierLimiter, sharedValidateBody(checkIdentifierSchema), async (req, res) => {
  const { identifier, role, deviceId } = req.body;

  const ip          = getClientIp(req);
  const settings    = await getCachedSettings();
  const userRole    = (role === "rider" || role === "vendor") ? role : "customer";
  const registrationOpen = settings["feature_new_users"] !== "off";

  /* ── Normalise identifier — detect phone vs email vs username ── */
  let user: (typeof usersTable.$inferSelect) | undefined;

  const looksLikePhone = /^[\d\s\-+()]{7,15}$/.test(identifier.trim());
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim());

  if (looksLikePhone) {
    const phone = canonicalizePhone(identifier);
    if (!phone) { res.status(400).json({ error: "Invalid phone number format" }); return; }
    const rows = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
    user = rows[0];
  } else if (looksLikeEmail) {
    const rows = await db.select().from(usersTable).where(eq(usersTable.email, identifier.trim().toLowerCase())).limit(1);
    user = rows[0];
  } else {
    const rows = await db.select().from(usersTable).where(eq(usersTable.username, identifier.trim())).limit(1);
    user = rows[0];
  }

  const exists    = !!user;
  const isNewUser = !exists;

  /* ── Enumeration hardening (phone, email, and username) ─────────────────
     For all identifier types we must return an IDENTICAL response whether
     the account exists, is banned, is locked, is Google-linked, or doesn't
     exist at all.  Any distinguishable response would let an attacker enumerate
     registered identifiers.

     Security events are logged server-side; actual enforcement (banned,
     locked, Google-linked) happens downstream (in /auth/login or
     /auth/verify-otp) after credential proof.

     Rule: always use the *request* role, never the DB user's role — the
     latter would differ between existing and non-existing records. ── */

  /* Log security events silently for all identifier types — never gate here */
  if (user?.isBanned) {
    const identifierType = looksLikePhone ? "phone" : looksLikeEmail ? "email" : "username";
    addSecurityEvent({ type: "banned_user_identifier_check", ip, userId: user.id, details: `Banned user ${identifierType} check: ${identifier}`, severity: "medium" });
  }

  /* ── Build available methods based on admin config + request role ──
     Always use userRole (from request) — never user?.role — so the
     response shape is identical regardless of account existence. ── */
  const effectiveCheckRole = userRole;
  const googleEnabled    = isAuthMethodEnabled(settings, "auth_google_enabled", effectiveCheckRole);
  const facebookEnabled  = isAuthMethodEnabled(settings, "auth_facebook_enabled", effectiveCheckRole);
  const phoneOtpEnabled  = isAuthMethodEnabled(settings, "auth_phone_otp_enabled", effectiveCheckRole);
  const emailOtpEnabled  = isAuthMethodEnabled(settings, "auth_email_otp_enabled", effectiveCheckRole);
  const passwordEnabled  = isAuthMethodEnabled(settings, "auth_username_password_enabled", effectiveCheckRole);
  const magicLinkEnabled = isAuthMethodEnabled(settings, "auth_magic_link_enabled", effectiveCheckRole);

  const availableMethods: string[] = [];
  if (phoneOtpEnabled)  availableMethods.push("phone_otp");
  if (emailOtpEnabled)  availableMethods.push("email_otp");
  if (passwordEnabled)  availableMethods.push("password");
  if (googleEnabled)    availableMethods.push("google");
  if (facebookEnabled)  availableMethods.push("facebook");
  if (magicLinkEnabled) availableMethods.push("magic_link");

  /* ── Determine action — never reveal account existence ───────────────────
     For all identifier types, return a generic action regardless of whether
     the account exists, is new, banned, locked, or social-linked.
     Account state enforcement happens downstream after credential proof.

     Phone/email → always "send_otp" action.
     Username    → always "login_password" (never "register"), so an attacker
                   cannot tell whether the username is registered. ── */
  let action: string;
  let responseAvailableMethods: string[] = availableMethods;

  if (looksLikePhone) {
    /* Always say "send OTP" — never distinguish new vs returning user */
    action = phoneOtpEnabled ? "send_phone_otp" : "no_method";
  } else if (looksLikeEmail) {
    if (emailOtpEnabled)       action = "send_email_otp";
    else if (magicLinkEnabled) action = "send_magic_link";
    else                       action = "no_method";
  } else {
    /* Username path: always respond as if a password-protected account exists,
       regardless of actual account state. This prevents username enumeration. */
    if (passwordEnabled) {
      action = "login_password";
    } else if (availableMethods.length > 0) {
      const first = availableMethods[0]!;
      action = first === "password" ? "login_password"
             : first === "phone_otp" ? "send_phone_otp"
             : first === "email_otp" ? "send_email_otp"
             : first === "magic_link" ? "send_magic_link"
             : "no_method";
    } else {
      action = "no_method";
    }
  }

  const whatsappOn = settings["integration_whatsapp"] === "on";
  const smsOn      = phoneOtpEnabled;
  const otpChannels: string[] = [];
  if (whatsappOn) otpChannels.push("whatsapp");
  if (smsOn)      otpChannels.push("sms");

  res.json({
    registrationOpen,
    action,
    availableMethods: responseAvailableMethods,
    isBanned:  false,
    isLocked:  false,
    otpChannels,
  });
});

/* ─────────────────────────────────────────────────────────────
   POST /auth/send-merge-otp
   Send OTP for linking a new identifier to the authenticated user.
   Stores OTP on the authenticated user's record.
   Body: { identifier }
───────────────────────────────────────────────────────────── */
router.post("/send-merge-otp", async (req, res) => {
  const auth = extractAuthUser(req);
  if (!auth) {
    const lang = await getRequestLocale(req);
    res.status(401).json({ error: t("apiErrAuthRequired", lang) }); return;
  }

  const { identifier } = req.body;
  if (!identifier) {
    const lang = await getRequestLocale(req, auth.userId);
    res.status(400).json({ error: t("apiErrIdentifierRequired", lang) }); return;
  }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  const looksLikePhone = /^[\d\s\-+()]{7,15}$/.test(identifier.trim());
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim());

  if (!looksLikePhone && !looksLikeEmail) {
    const lang = await getRequestLocale(req, auth.userId);
    res.status(400).json({ error: t("apiErrIdentifierMustBePhoneOrEmail", lang) });
    return;
  }

  if (looksLikePhone) {
    const phone = canonicalizePhone(identifier);
    if (!phone) { res.status(400).json({ error: "Invalid phone number format" }); return; }
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
    if (existing) {
      const lang = await getRequestLocale(req, auth.userId);
      res.status(409).json({ error: t("apiErrPhoneAlreadyLinked", lang) }); return;
    }
  } else {
    const email = identifier.trim().toLowerCase();
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing) {
      const lang = await getRequestLocale(req, auth.userId);
      res.status(409).json({ error: t("apiErrEmailAlreadyLinked", lang) }); return;
    }
  }

  const otp = generateSecureOtp();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
  const normalizedIdentifier = looksLikePhone ? canonicalizePhone(identifier)! : identifier.trim().toLowerCase();
  await db.update(usersTable).set({ mergeOtpCode: hashOtp(otp), mergeOtpExpiry: otpExpiry, pendingMergeIdentifier: normalizedIdentifier, updatedAt: new Date() }).where(eq(usersTable.id, auth.userId));

  const lang = await getUserLanguage(auth.userId);
  if (looksLikePhone) {
    const phone = canonicalizePhone(identifier)!;
    await notificationSendOtp({ phone, otp, settings, userLanguage: lang });
    res.json({ message: "OTP sent to phone" });
  } else {
    const email = identifier.trim().toLowerCase();
    const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
    await notificationSendOtp({ phone: undefined, otp, settings, userEmail: email, userName: user?.name ?? undefined, userLanguage: lang, preferredChannel: "email" });
    res.json({ message: "OTP sent to email" });
  }

  writeAuthAuditLog("merge_otp_sent", { ip, userId: auth.userId, userAgent: req.headers["user-agent"] ?? undefined, metadata: { identifier } });
});

/* ─────────────────────────────────────────────────────────────
   POST /auth/merge-account
   Link a new identifier (phone/email) to an authenticated user.
   Requires: valid JWT + OTP verification for the new identifier.
   Body: { identifier, otp }
───────────────────────────────────────────────────────────── */
router.post("/merge-account", async (req, res) => {
  const auth = extractAuthUser(req);
  if (!auth) {
    const lang = await getRequestLocale(req);
    res.status(401).json({ error: t("apiErrAuthRequired", lang) }); return;
  }

  const { identifier, otp } = req.body;
  if (!identifier || !otp) {
    const lang = await getRequestLocale(req, auth.userId);
    res.status(400).json({ error: t("apiErrIdentifierAndOtpRequired", lang) }); return;
  }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  const looksLikePhone = /^[\d\s\-+()]{7,15}$/.test(identifier.trim());
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim());

  if (!looksLikePhone && !looksLikeEmail) {
    const lang = await getRequestLocale(req, auth.userId);
    res.status(400).json({ error: t("apiErrIdentifierMustBePhoneOrEmail", lang) });
    return;
  }

  const [currentUser] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  if (!currentUser) {
    const lang = await getRequestLocale(req, auth.userId);
    res.status(404).json({ error: t("apiErrUserNotFound", lang) }); return;
  }

  const normalizedIdentifier = looksLikePhone ? canonicalizePhone(identifier) : identifier.trim().toLowerCase();
  if (!normalizedIdentifier) {
    const lang = await getRequestLocale(req, auth.userId);
    res.status(400).json({ error: "Invalid phone number format" }); return;
  }

  if (currentUser.mergeOtpCode !== hashOtp(otp) || !currentUser.mergeOtpExpiry || currentUser.mergeOtpExpiry < new Date()) {
    const lang = await getRequestLocale(req, auth.userId);
    res.status(400).json({ error: t("apiErrOtpInvalidOrExpired", lang) });
    return;
  }

  if (currentUser.pendingMergeIdentifier !== normalizedIdentifier) {
    const lang = await getRequestLocale(req, auth.userId);
    res.status(400).json({ error: t("apiErrOtpNotForIdentifier", lang) });
    return;
  }

  if (looksLikePhone) {
    const phone = normalizedIdentifier;
    if (currentUser.phone === phone) {
      const lang = await getRequestLocale(req, auth.userId);
      res.status(400).json({ error: t("apiErrPhoneAlreadyOnAccount", lang) }); return;
    }

    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
    if (existing) {
      const lang = await getRequestLocale(req, auth.userId);
      res.status(409).json({ error: t("apiErrPhoneAlreadyLinked", lang) }); return;
    }

    await db.update(usersTable).set({ phone, mergeOtpCode: null, mergeOtpExpiry: null, phoneVerified: true, pendingMergeIdentifier: null, updatedAt: new Date() }).where(eq(usersTable.id, auth.userId));

    writeAuthAuditLog("account_merge_phone", { ip, userId: auth.userId, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone } });
    res.json({ success: true, linked: "phone" });
  } else {
    const email = normalizedIdentifier;
    if (currentUser.email === email) {
      const lang = await getRequestLocale(req, auth.userId);
      res.status(400).json({ error: t("apiErrEmailAlreadyOnAccount", lang) }); return;
    }

    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing) {
      const lang = await getRequestLocale(req, auth.userId);
      res.status(409).json({ error: t("apiErrEmailAlreadyLinked", lang) }); return;
    }

    await db.update(usersTable).set({ email, mergeOtpCode: null, mergeOtpExpiry: null, emailVerified: true, pendingMergeIdentifier: null, updatedAt: new Date() }).where(eq(usersTable.id, auth.userId));

    writeAuthAuditLog("account_merge_email", { ip, userId: auth.userId, userAgent: req.headers["user-agent"] ?? undefined, metadata: { email } });
    res.json({ success: true, linked: "email" });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /auth/send-otp
   Atomically upsert user by phone — one account per number.
───────────────────────────────────────────────────────────── */
router.post("/send-otp", verifyCaptcha, sharedValidateBody(sendOtpSchema), async (req, res) => {
  const rawPhone = req.body.phone;
  const deviceId = req.body.deviceId;
  const preferredChannel = req.body.preferredChannel;
  const mode = (req.body.mode as string | undefined) ?? "login";
  const phone = canonicalizePhone(rawPhone);

  if (!isValidCanonicalPhone(phone)) {
    const lang = await getRequestLocale(req);
    res.status(400).json({ error: t("apiErrInvalidPhone", lang), field: "phone" });
    return;
  }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  const otpEnabled = isAuthMethodEnabled(settings, "auth_phone_otp_enabled");

  /* ── Look up existing user (not exposed in response — only used server-side) ── */
  const existingUser = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.phone, phone))
    .limit(1);

  /* ── Enforce login vs. register separation ────────────────────────────────
     In "login" mode (the default), the account must already exist.
     In "register" mode, the caller is explicitly signing up as a new user.  ── */
  if (mode === "login" && existingUser.length === 0) {
    const lang = await getRequestLocale(req);
    res.status(404).json({ error: "Account not found. Please sign up first.", accountNotFound: true });
    return;
  }

  /* ── Early role check ─────────────────────────────────────────────────────
     If the user exists and a role was specified, verify the role matches before
     sending any OTP — no OTP should be wasted on a wrong-app login attempt.
     Role is always sent by the first-party apps (customer/rider/vendor).
     Omitting role is allowed only for passwordless/social flows that don't
     target a specific app (e.g. programmatic API callers), in which case the
     check is skipped and the verify-otp endpoint enforces it instead.        ── */
  const requestedRoleEarly = req.body.role as string | undefined;
  if (existingUser[0] && requestedRoleEarly && mode === "login") {
    const userRolesEarly = (existingUser[0].roles || existingUser[0].role || "customer").split(",").map((r: string) => r.trim());
    if (!userRolesEarly.includes(requestedRoleEarly)) {
      addSecurityEvent({ type: "cross_role_login_attempt", ip, userId: existingUser[0].id, details: `Wrong-app OTP blocked at send-otp for [${existingUser[0].roles}] trying ${requestedRoleEarly}`, severity: "high" });
      const lang = await getRequestLocale(req, existingUser[0].id);
      res.status(403).json({ error: t("apiErrWrongApp", lang), wrongApp: true });
      return;
    }
  }

  const effectiveRole = existingUser[0]?.role ?? ((req.body.role === "rider" || req.body.role === "vendor") ? req.body.role : "customer");
  const otpEnabledForRole = isAuthMethodEnabled(settings, "auth_phone_otp_enabled", effectiveRole);

  /* ── Phone enumeration hardening ─────────────────────────────────────────
     Do NOT return distinguishable errors for banned accounts, Google-linked
     accounts, or registration-closed states — all of these would reveal
     whether a phone number is registered.  Enforcement of these rules happens
     inside /auth/verify-otp (after the caller has proven OTP ownership).

     Exceptions that are acceptable to surface at send-otp:
       • lockout  — rate-limit response, keyed on the phone, not on account existence
       • invalid phone format — rejected before DB lookup
       • login mode with no account — explicit "Account not found" (handled above)
       • wrong app role — rejected before OTP (handled above)
     Everything else: silently write OTP to pending_otps and return generic success. ── */

  /* ── Check lockout before generating new OTP ── */
  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);
  const lockoutStatus = await checkLockout(phone, maxAttempts, lockoutMinutes);
  if (lockoutStatus.locked) {
    addSecurityEvent({ type: "locked_account_otp_request", ip, details: `OTP request for locked phone: ${phone}`, severity: "medium" });
    const lang = await getRequestLocale(req);
    res.status(429).json({
      error: t("apiErrAccountLocked", lang).replace("{minutes}", String(lockoutStatus.minutesLeft)),
      lockedMinutes: lockoutStatus.minutesLeft,
    });
    return;
  }

  /* Log security events server-side without blocking the OTP flow */
  if (existingUser[0]?.isBanned) {
    addSecurityEvent({ type: "banned_user_otp_request", ip, details: `Banned user attempted OTP: ${phone}`, severity: "high" });
  }
  const existingGoogleId = existingUser[0]?.googleId;
  if (existingGoogleId && isAuthMethodEnabled(settings, "auth_google_enabled", existingUser[0]?.role ?? effectiveRole)) {
    addSecurityEvent({ type: "otp_blocked_google_account", ip, details: `OTP attempt on Google-linked account: ${phone}`, severity: "low" });
  }

  /* ── Determine approval status for NEW users ── */
  const isNewUser = existingUser.length === 0;
  const requireApproval = (settings["user_require_approval"] ?? "off") === "on";
  const newUserApprovalStatus = isNewUser && requireApproval ? "pending" : "approved";

  /* ══ OTP DISABLED — return generic "use another method" without revealing account state ══ */
  if (!otpEnabled || !otpEnabledForRole) {
    const lang = await getRequestLocale(req, existingUser[0]?.id);
    res.status(403).json({ error: t("apiErrPhoneOtpDisabled", lang) });
    return;
  }
  /* ── Per-phone OTP resend cooldown (60 s) — prevents SMS bombing ── */
  const otpCooldownMs = parseInt(settings["security_otp_cooldown_sec"] ?? "60", 10) * 1000;
  const existingOtpExpiry = existingUser[0]?.otpExpiry;
  if (existingOtpExpiry) {
    const otpValidityMs = AUTH_OTP_TTL_MS;
    const issuedAgoMs   = otpValidityMs - (existingOtpExpiry.getTime() - Date.now());
    if (issuedAgoMs < otpCooldownMs) {
      const waitSec = Math.ceil((otpCooldownMs - issuedAgoMs) / 1000);
      addSecurityEvent({ type: "otp_resend_throttle", ip, details: `OTP resend too soon for ${phone} — ${waitSec}s remaining`, severity: "low" });
      const otpWaitLang = await getRequestLocale(req);
      res.status(429).json({ error: t("apiErrOtpWaitSeconds", otpWaitLang).replace("{seconds}", String(waitSec)), retryAfterSeconds: waitSec });
      return;
    }
  }

  /* ── Per-account + per-IP OTP rate limit (admin-configurable window) ── */
  const otpRateCheck = await checkAndIncrOtpRateLimit({ identifier: phone, ip, settings });
  if (otpRateCheck.blocked) {
    const otpRateLang = await getRequestLocale(req);
    const errKey: TranslationKey = otpRateCheck.reason === "ip" ? "apiErrOtpRateLimitedIp" : "apiErrOtpRateLimitedAccount";
    addSecurityEvent({ type: "otp_rate_limit_exceeded", ip, details: `OTP rate limited (${phone}) — retry in ${otpRateCheck.retryAfterSeconds}s`, severity: "medium" });
    res.status(429).json({ error: t(errKey, otpRateLang).replace("{seconds}", String(otpRateCheck.retryAfterSeconds)), retryAfterSeconds: otpRateCheck.retryAfterSeconds });
    return;
  }

  /* ── OTP Bypass Mode — skip SMS, store "1234" as OTP ──────────────────────
     When otp_bypass_mode is "on" in admin settings, no real OTP is sent.
     The bypass OTP "1234" is stored so verify-otp can accept it.
     For existing users (login): returns { otpRequired: false, bypassed: true }.
     For new users (register):   same — frontend auto-calls verify-otp("1234").
  ────────────────────────────────────────────────────────────────────────────── */
  const isBypassMode = settings["otp_bypass_mode"] === "on";
  if (isBypassMode) {
    const bypassOtp    = "1234";
    const bypassExpiry = new Date(Date.now() + AUTH_OTP_TTL_MS);
    if (isNewUser) {
      const bypassPayload = mode === "register"
        ? JSON.stringify({ _source: "register", role: req.body.role ?? "customer" })
        : null;
      await db.insert(pendingOtpsTable).values({
        id: generateId(), phone, otpHash: hashOtp(bypassOtp), otpExpiry: bypassExpiry, payload: bypassPayload,
      }).onConflictDoUpdate({
        target: pendingOtpsTable.phone,
        set: { otpHash: hashOtp(bypassOtp), otpExpiry: bypassExpiry, attempts: 0, payload: bypassPayload },
      });
    } else {
      await db.update(usersTable)
        .set({ otpCode: hashOtp(bypassOtp), otpExpiry: bypassExpiry, otpUsed: false, updatedAt: new Date() })
        .where(eq(usersTable.phone, phone));
    }
    writeAuthAuditLog("otp_bypass_used", { ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone } });
    res.json({ otpRequired: false, bypassed: true, message: "OTP bypass mode is active" });
    return;
  }

  const otp       = generateSecureOtp();
  const otpExpiry = new Date(Date.now() + AUTH_OTP_TTL_MS);

  if (isNewUser) {
    /* NEW USERS: store OTP in pending_otps — do NOT create a users record yet.
       The users record is only created after OTP is successfully verified.
       When mode=register, include _source so verify-otp allows non-customer roles. */
    const sendOtpPayload = mode === "register"
      ? JSON.stringify({ _source: "register", role: req.body.role ?? "customer" })
      : null;
    await db
      .insert(pendingOtpsTable)
      .values({ id: generateId(), phone, otpHash: hashOtp(otp), otpExpiry, payload: sendOtpPayload })
      .onConflictDoUpdate({
        target: pendingOtpsTable.phone,
        set: { otpHash: hashOtp(otp), otpExpiry, attempts: 0, payload: sendOtpPayload },
      });
  } else {
    /* EXISTING USERS: update OTP in the users table (login / resend flow) */
    await db
      .update(usersTable)
      .set({ otpCode: hashOtp(otp), otpExpiry, otpUsed: false, updatedAt: new Date() })
      .where(eq(usersTable.phone, phone));
  }

  writeAuthAuditLog("otp_sent", { ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone } });

  const otpUserId = existingUser[0]?.id;
  const otpLang = otpUserId ? await getUserLanguage(otpUserId) : await getPlatformDefaultLanguage();

  const emailEnabled = isAuthMethodEnabled(settings, "auth_email_otp_enabled", effectiveRole);
  const userEmail    = existingUser[0]?.email;
  const smsEnabled   = isAuthMethodEnabled(settings, "auth_phone_otp_enabled", effectiveRole);
  const whatsappEnabled = settings["integration_whatsapp"] === "on";

  const availableChannels: string[] = [];
  if (whatsappEnabled) availableChannels.push("whatsapp");
  if (smsEnabled) availableChannels.push("sms");
  if (emailEnabled && userEmail) availableChannels.push("email");

  const deliveryResult = await notificationSendOtp({
    phone,
    otp,
    settings,
    userLanguage: otpLang,
    userEmail: emailEnabled ? userEmail ?? undefined : undefined,
    userName: existingUser[0]?.name ?? undefined,
    preferredChannel: preferredChannel ?? undefined,
  });

  let deliveryChannel = deliveryResult.channel;
  const deliverySuccess = deliveryResult.sent;
  const deliveryProvider = deliveryResult.provider;
  const otpDebugMode = isOtpDebugMode(settings);

  const isDev = process.env.NODE_ENV !== "production";
  const userDevOtp = existingUser[0]?.devOtpEnabled === true;
  const globalDevOtp = settings["security_global_dev_otp"] === "on";
  const isConsoleDelivery = deliveryProvider === "console";

  if (!deliverySuccess) {
    if (userDevOtp || globalDevOtp) {
      deliveryChannel = "dev";
      req.log.warn({ phone }, "All OTP delivery channels failed — returning OTP in dev/devOtp mode");
    } else {
      req.log.error({ phone }, "All OTP delivery channels failed");
      const otpLangFail = await getRequestLocale(req);
      res.status(502).json({ error: t("apiErrOtpDeliveryFailed", otpLangFail), fallbackChannels: availableChannels });
      return;
    }
  }

  const fallbackChannels = availableChannels.filter(ch => ch !== deliveryChannel);
  const response: Record<string, unknown> = {
    otpRequired: true,
    message: "OTP sent successfully",
    channel: deliveryChannel,
    fallbackChannels,
  };

  /* Dev OTP: expose OTP in response ONLY when admin explicitly enabled:
     - admin enabled devOtpEnabled on this specific user (per-user flag in Users page)
     - global Dev OTP Mode platform setting is "on" (Security settings in admin)
     - otp_debug_mode is "on" (admin OTP Debug Mode setting, non-prod only)
     NOTE: isConsoleDelivery or isDev alone is NOT enough — admin must explicitly enable */
  if (userDevOtp || globalDevOtp || otpDebugMode) {
    response.otp = otp;
    response.devMode = true;
  }

  res.json(response);
});

/* ─────────────────────────────────────────────────────────────
   POST /auth/verify-otp
   Validates the OTP, checks security settings, returns token.
───────────────────────────────────────────────────────────── */
router.post("/verify-otp", verifyOtpIpLimiter, verifyCaptcha, sharedValidateBody(verifyOtpSchema), async (req, res) => {
  const phone = canonicalizePhone(req.body.phone);

  if (!isValidCanonicalPhone(phone)) {
    const lang = await getRequestLocale(req);
    res.status(400).json({ error: t("apiErrInvalidPhone", lang), field: "phone" });
    return;
  }

  const { otp } = req.body;

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabled(settings, "auth_phone_otp_enabled")) {
    const lang = await getRequestLocale(req);
    res.status(403).json({ error: t("apiErrPhoneOtpDisabled", lang) });
    return;
  }

  const maxAttempts    = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"]    ?? "30", 10);
  const lang = await getRequestLocale(req);

  /* ── Lockout check ── */
  const lockoutStatus = await checkLockout(phone, maxAttempts, lockoutMinutes);
  if (lockoutStatus.locked) {
    addAuditEntry({ action: "verify_otp_lockout", ip, details: `Locked account OTP attempt: ${phone}`, result: "fail" });
    res.status(429).json({
      error: t("apiErrAccountLocked", lang).replace("{minutes}", String(lockoutStatus.minutesLeft)),
      lockedMinutes: lockoutStatus.minutesLeft,
    });
    return;
  }

  /* ── Fetch user ── */
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.phone, phone))
    .limit(1);

  if (!user) {
    /* ── NEW USER REGISTRATION PATH ──────────────────────────────────────────
       If the phone is not yet in usersTable, check pendingOtpsTable.
       This prevents phantom account creation — user records are only
       created AFTER successful OTP verification, not at send-otp time. */
    const [pending] = await db
      .select()
      .from(pendingOtpsTable)
      .where(eq(pendingOtpsTable.phone, phone))
      .limit(1);

    if (!pending) {
      const lang = await getRequestLocale(req);
      res.status(404).json({ error: t("apiErrUserNotFoundRequestOtp", lang) });
      return;
    }

    /* ── Cross-role new-user guard ──
       Allow new-user creation only when the pending OTP came from the /auth/register
       flow (payload._source === "register").  If a non-customer send-otp was fired
       (e.g. from the wrong app), there will be no registration payload, so block it. */
    let pendingPayloadParsed: Record<string, unknown> | null = null;
    if (pending.payload) {
      try { pendingPayloadParsed = JSON.parse(pending.payload); } catch { /* noop */ }
    }
    const requestedRoleForNew = req.body.role as string | undefined;
    const payloadSource = pendingPayloadParsed?._source as string | undefined;
    if (requestedRoleForNew && requestedRoleForNew !== "customer" && payloadSource !== "register") {
      const lang = await getRequestLocale(req);
      res.status(403).json({
        error: t("apiErrWrongApp", lang),
        wrongApp: true,
      });
      return;
    }

    /* Verify OTP from pending_otps — bypass when otp_bypass_mode is "on" */
    const bypassOtp_pending = settings["otp_bypass_mode"] === "on";
    const otpValid = bypassOtp_pending || (pending.otpHash === hashOtp(otp) && new Date() < pending.otpExpiry);
    if (!otpValid) {
      /* Increment failed attempts */
      const newAttempts = (pending.attempts ?? 0) + 1;
      await db.update(pendingOtpsTable)
        .set({ attempts: newAttempts })
        .where(eq(pendingOtpsTable.phone, phone));

      const lang = await getRequestLocale(req);
      if (newAttempts >= maxAttempts) {
        await db.delete(pendingOtpsTable).where(eq(pendingOtpsTable.phone, phone));
        res.status(429).json({ error: t("apiErrTooManyAttemptsRequestOtp", lang), lockedMinutes: 1 });
      } else {
        const remaining = maxAttempts - newAttempts;
        res.status(401).json({
          error: remaining > 0
            ? `${t("apiErrInvalidOtp", lang)} ${t("apiErrAttemptsRemaining", lang).replace("{count}", String(remaining))}`
            : `${t("apiErrInvalidOtp", lang)} ${t("apiErrRequestNewOtp", lang)}`,
          attemptsRemaining: Math.max(0, remaining),
        });
      }
      return;
    }

    /* OTP valid — create user record now.
       If a registration payload exists (from /auth/register flow), use it to
       pre-fill all the fields the user submitted; otherwise start with minimal data. */
    const deviceId = req.body.deviceId as string | undefined;
    const newUserId = generateId();

    const regPayload = pendingPayloadParsed;

    const userRole = (regPayload?.role === "rider" || regPayload?.role === "vendor")
      ? (regPayload.role as "rider" | "vendor")
      : "customer";

    /* Determine profile completeness from registration payload.
       Riders/vendors who submitted a full registration form via /auth/register already
       have all required fields — mark their profile complete so they can log in after
       admin approval without needing a separate complete-profile step.
       Customer accounts created from a bare send-otp (no payload) remain incomplete. */
    const payloadName  = (regPayload?.name  as string | null) || null;
    const payloadCnic  = (regPayload?.cnic  as string | null) || null;
    const payloadBiz   = ((regPayload?.businessName as string | null) || (regPayload?.storeName as string | null)) || null;
    let isProfileCompleteFromReg = false;
    if (userRole === "rider")   isProfileCompleteFromReg = !!(payloadName && payloadCnic);
    else if (userRole === "vendor") isProfileCompleteFromReg = !!(payloadName && payloadBiz);
    else isProfileCompleteFromReg = !!payloadName;

    await db.insert(usersTable).values({
      id:               newUserId,
      phone,
      role:             userRole,
      roles:            userRole,
      walletBalance:    "0",
      phoneVerified:    true,
      isActive:         false,
      approvalStatus:   "pending",
      isProfileComplete: isProfileCompleteFromReg,
      ...(deviceId ? { deviceId } : {}),
      /* Pre-fill from registration intent if available */
      ...(regPayload ? {
        name:            (regPayload.name as string) || null,
        email:           (regPayload.email as string) || null,
        username:        (regPayload.username as string) || null,
        passwordHash:    (regPayload.passwordHash as string) || null,
        cnic:            (regPayload.cnic as string) || null,
        nationalId:      (regPayload.cnic as string) || null,
        vehicleRegNo:    (regPayload.vehicleRegNo as string) || null,
        vehiclePlate:    (regPayload.vehiclePlate as string) || null,
        drivingLicense:  (regPayload.drivingLicense as string) || null,
        address:         (regPayload.address as string) || null,
        city:            (regPayload.city as string) || null,
        emergencyContact: (regPayload.emergencyContact as string) || null,
        vehiclePhoto:    (regPayload.vehiclePhoto as string) || null,
        documents:       (regPayload.documents as string) || null,
        businessName:    (regPayload.businessName as string) || null,
        businessType:    (regPayload.businessType as string) || null,
        storeAddress:    (regPayload.storeAddress as string) || null,
        ntn:             (regPayload.ntn as string) || null,
      } : {}),
    });

    /* Create role-specific profiles if registration payload had that data */
    if (regPayload && userRole === "rider" && regPayload.vehicleType) {
      await db.insert(riderProfilesTable).values({
        userId: newUserId,
        vehicleType: normalizeVehicleTypeForStorage(regPayload.vehicleType as string),
      }).onConflictDoUpdate({
        target: riderProfilesTable.userId,
        set: { vehicleType: normalizeVehicleTypeForStorage(regPayload.vehicleType as string) },
      });
    }
    if (regPayload && userRole === "vendor" && (regPayload.storeName || regPayload.businessName)) {
      await db.insert(vendorProfilesTable).values({
        userId: newUserId,
        storeName: (regPayload.storeName as string) || (regPayload.businessName as string) || null,
        storeCategory: (regPayload.storeCategory as string) || null,
      }).onConflictDoUpdate({
        target: vendorProfilesTable.userId,
        set: {
          storeName: (regPayload.storeName as string) || (regPayload.businessName as string) || null,
          storeCategory: (regPayload.storeCategory as string) || null,
        },
      });
    }

    /* Delete from pending_otps */
    await db.delete(pendingOtpsTable).where(eq(pendingOtpsTable.phone, phone));
    writeAuthAuditLog("otp_verified_new_user", { userId: newUserId, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone, role: userRole } });

    /* For users whose profile is already complete (riders/vendors with full registration
       data), return a pending-approval response — no setup token needed.
       For users who still need to complete their profile (bare send-otp customers),
       issue a scoped setup-only token accepted only by /auth/complete-profile. */
    if (isProfileCompleteFromReg) {
      res.json({
        pendingApproval: true,
        isProfileComplete: true,
        message: "Aapka account admin approval ke liye bheja gaya hai. Approve hone par aap login kar sakenge.",
        user: { id: newUserId, phone, name: (regPayload?.name as string) ?? null, email: (regPayload?.email as string) ?? null,
                username: (regPayload?.username as string) ?? null, role: userRole, roles: userRole,
                walletBalance: 0, isActive: false, totpEnabled: false, isProfileComplete: true, approvalStatus: "pending" },
      });
    } else {
      const setupToken = signSetupToken(newUserId, phone, userRole);
      res.json({
        token: setupToken,
        setupOnly: true,
        isProfileComplete: false,
        user: { id: newUserId, phone, name: (regPayload?.name as string) ?? null, email: (regPayload?.email as string) ?? null,
                username: (regPayload?.username as string) ?? null, role: userRole, roles: userRole,
                walletBalance: 0, isActive: false, totpEnabled: false, isProfileComplete: false },
      });
    }
    return;
  }

  if (!isAuthMethodEnabled(settings, "auth_phone_otp_enabled", user.role ?? undefined)) {
    const lang = await getRequestLocale(req, user.id);
    res.status(403).json({ error: t("apiErrPhoneOtpDisabled", lang) });
    return;
  }

  /* ── Cross-role enforcement ── */
  const requestedRole = req.body.role as string | undefined;
  if (requestedRole) {
    const userRoles = (user.roles || user.role || "customer").split(",").map((r: string) => r.trim());
    if (!userRoles.includes(requestedRole)) {
      addSecurityEvent({ type: "cross_role_login_attempt", ip, userId: user.id, details: `User with roles [${user.roles}] tried to log in as ${requestedRole}`, severity: "high" });
      const lang = await getRequestLocale(req, user.id);
      res.status(403).json({ error: t("apiErrWrongApp", lang), wrongApp: true });
      return;
    }
  }

  /* ── Banned check ── */
  if (user.isBanned) {
    addSecurityEvent({ type: "banned_login_attempt", ip, userId: user.id, details: `Banned user tried to verify OTP: ${phone}`, severity: "high" });
    const lang = await getRequestLocale(req, user.id);
    res.status(403).json({ error: t("apiErrAccountSuspended", lang) });
    return;
  }

  /* ── Google-linked account: block OTP hijack ─────────────────────────────
     Enforcement moved here from send-otp to avoid leaking account existence.
     After OTP proof the caller is bound to this phone, so we can safely tell
     them to use Google instead without disclosing anything about other numbers. ── */
  if (user.googleId && isAuthMethodEnabled(await getCachedSettings(), "auth_google_enabled", user.role ?? undefined)) {
    addSecurityEvent({ type: "otp_hijack_google_account", ip, userId: user.id, details: `OTP verify attempted on Google-linked account: ${phone}`, severity: "medium" });
    const lang = await getRequestLocale(req, user.id);
    res.status(403).json({ error: t("apiErrUseGoogleSignIn", lang), useGoogle: true });
    return;
  }

  /* ── Inactive check ──
     Pending-approval accounts are isActive=false but should NOT be blocked here;
     they need to pass OTP validation and receive the pendingApproval=true response.
     Check approvalStatus directly — the setting only controls NEW users, not existing pending ones. ── */
  const isPendingApproval = user.approvalStatus === "pending";
  if (!user.isActive && !isPendingApproval) {
    const lang = await getRequestLocale(req, user.id);
    res.status(403).json({ error: t("apiErrAccountInactive", lang) });
    return;
  }

  /* ── Atomic OTP consumption via a single conditional UPDATE ──
     The WHERE clause combines: correct code + not-yet-used + not-expired.
     Concurrency-safe: only the first concurrent caller gets rows back. ── */
  const signupBonus = parseFloat(settings["customer_signup_bonus"] ?? "0");
  const now = new Date();

  /* OTP Bypass: skip hash check when otp_bypass_mode is "on" in admin */
  const bypassOtp_existing = settings["otp_bypass_mode"] === "on";

  let isActualFirstLogin = false;

  {
    const consumed = await db.transaction(async (tx) => {
      /* Single atomic UPDATE: marks OTP as used ONLY if code matches, unused, and unexpired.
         In bypass mode (dev only) skip the OTP hash + expiry checks. */
      const whereConditions = bypassOtp_existing
        ? and(eq(usersTable.phone, phone))
        : and(
            eq(usersTable.phone, phone),
            eq(usersTable.otpCode, hashOtp(otp)),
            eq(usersTable.otpUsed, false),
            sql`otp_expiry > now()`,
          );
      const rows = await tx
        .update(usersTable)
        .set({ otpCode: null, otpExpiry: null, otpUsed: true, phoneVerified: true, lastLoginAt: now })
        .where(whereConditions)
        .returning({ id: usersTable.id, lastLoginAt: usersTable.lastLoginAt });

      if (rows.length === 0) return null;

      /* This is the first login if lastLoginAt was NULL before we set it now.
         We detect first login by checking if no prior refresh tokens exist. */
      const [existingToken] = await tx.select({ id: refreshTokensTable.id })
        .from(refreshTokensTable)
        .where(eq(refreshTokensTable.userId, rows[0]!.id))
        .limit(1);
      isActualFirstLogin = !existingToken;

      /* Credit signup bonus only on verified first login */
      if (isActualFirstLogin && signupBonus > 0) {
        await tx
          .update(usersTable)
          .set({ walletBalance: sql`wallet_balance + ${signupBonus}` })
          .where(eq(usersTable.id, rows[0]!.id));
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId: rows[0]!.id, type: "bonus",
          amount: signupBonus.toFixed(2),
          description: `Welcome bonus — Thanks for joining AJKMart!`,
        });
        const bonusLang = await getUserLanguage(rows[0]!.id);
        await tx.insert(notificationsTable).values({
          id: generateId(), userId: rows[0]!.id,
          title: t("notifWelcomeBonusTitle" as TranslationKey, bonusLang),
          body: t("notifWelcomeBonusBody" as TranslationKey, bonusLang).replace("{amount}", String(signupBonus)),
          type: "wallet", icon: "gift-outline",
        });
      }

      return rows[0];
    });

    if (!consumed) {
      /* OTP was wrong, already used, or expired — determine reason from fresh row */
      const [fresh] = await db.select({ otpUsed: usersTable.otpUsed, otpExpiry: usersTable.otpExpiry })
        .from(usersTable).where(eq(usersTable.phone, phone)).limit(1);

      const otpLangErr = await getRequestLocale(req, user.id);
      if (fresh?.otpUsed) {
        writeAuthAuditLog("otp_reuse_attempt", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined });
        res.status(401).json({ error: t("apiErrOtpAlreadyUsed", otpLangErr) });
      } else if (!fresh?.otpExpiry || new Date() > fresh.otpExpiry) {
        writeAuthAuditLog("otp_expired", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined });
        res.status(401).json({ error: t("apiErrOtpExpired", otpLangErr) });
      } else {
        const updated = await recordFailedAttempt(phone, maxAttempts, lockoutMinutes);
        const remaining = maxAttempts - updated.attempts;
        addAuditEntry({ action: "verify_otp_failed", ip, details: `Wrong OTP for phone: ${phone}, attempt ${updated.attempts}/${maxAttempts}`, result: "fail" });
        writeAuthAuditLog("otp_failed", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined });
        if (updated.lockedUntil) {
          addSecurityEvent({ type: "account_locked", ip, userId: user.id, details: `Account locked after ${maxAttempts} failed OTP attempts`, severity: "high" });
          res.status(429).json({ error: t("apiErrAccountLocked", otpLangErr).replace("{minutes}", String(lockoutMinutes)), lockedMinutes: lockoutMinutes });
        } else {
          res.status(401).json({
            error: remaining > 0
              ? `${t("apiErrInvalidOtp", otpLangErr)} ${t("apiErrAttemptsRemaining", otpLangErr).replace("{count}", String(remaining))}`
              : `${t("apiErrInvalidOtp", otpLangErr)} ${t("apiErrNextFailureLocks", otpLangErr)}`,
            attemptsRemaining: Math.max(0, remaining),
          });
        }
      }
      return;
    }
  }

  await resetAttempts(phone);

  /* ── Re-fetch user to get latest data (wallet balance, name, etc.) ── */
  const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
  const u = freshUser ?? user;

  /* ── Profile-incomplete guard ──
     If the user has not finished registration (isProfileComplete = false) we must ONLY
     issue a setup token — never a full access token — regardless of approval status.    */
  if (!u.isProfileComplete) {
    addAuditEntry({ action: "user_login_setup_required", ip, details: `Setup token issued for incomplete profile phone: ${phone}`, result: "pending" });
    const setupToken = signSetupToken(u.id, phone, u.role ?? "customer");
    res.json({
      token: setupToken,
      setupRequired: true,
      pendingApproval: u.approvalStatus === "pending",
      message: u.approvalStatus === "pending"
        ? "Aapka account admin approval ke liye bheja gaya hai. Approve hone par aap login kar sakenge."
        : "Kripya apna profile poora karein.",
      user: { id: u.id, phone: u.phone, name: u.name, role: u.role, roles: u.roles, approvalStatus: u.approvalStatus },
    });
    return;
  }

  /* ── Admin approval check ──
     approvalStatus is the source of truth; the setting only controls NEW user creation. ── */
  if (u.approvalStatus === "pending") {
    addAuditEntry({ action: "user_login_pending", ip, details: `Pending approval login for phone: ${phone}`, result: "pending" });
    const token = signAccessToken(u.id, phone, u.role ?? "customer", u.roles ?? "customer", u.tokenVersion ?? 0);
    res.json({
      token, pendingApproval: true,
      message: "Aapka account admin approval ke liye bheja gaya hai. Approve hone par aap login kar sakenge.",
      user: { id: u.id, phone: u.phone, name: u.name, role: u.role, roles: u.roles, approvalStatus: "pending" },
    });
    return;
  }
  if (u.approvalStatus === "rejected") {
    const rejLang = await getRequestLocale(req, u.id);
    res.status(403).json({ error: t("apiErrApprovalRejected", rejLang), code: "APPROVAL_REJECTED", approvalStatus: "rejected", rejectionReason: u.approvalNote ?? null });
    return;
  }

  /* ── 2FA challenge ── */
  if (u.totpEnabled && isAuthMethodEnabled(settings, "auth_2fa_enabled", u.role ?? undefined)) {
    const deviceFingerprint = req.body.deviceFingerprint ?? "";
    const trustedDays = parseInt(settings["auth_trusted_device_days"] ?? "30", 10);
    if (!isDeviceTrusted(u, deviceFingerprint, trustedDays)) {
      const tempToken = sign2faChallengeToken(u.id, u.phone ?? "", u.role ?? "customer", u.roles ?? u.role ?? "customer", "phone_otp");
      res.json({ requires2FA: true, tempToken, userId: u.id }); return;
    }
  }

  addAuditEntry({ action: "user_login", ip, details: `Successful login for phone: ${phone} (role: ${u.role})`, result: "success" });
  writeAuthAuditLog("login_success", { userId: u.id, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone, role: u.role } });

  /* ── Issue short-lived access token + long-lived refresh token ── */
  const accessToken  = signAccessToken(u.id, phone, u.role ?? "customer", u.roles ?? u.role ?? "customer", u.tokenVersion ?? 0);
  const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokensTable).values({
    id:        generateId(),
    userId:    u.id,
    tokenHash: refreshHash,
    authMethod: "phone_otp",
    expiresAt: refreshExpiresAt,
  });

  /* Clean up expired refresh tokens for this user (housekeeping) */
  db.delete(refreshTokensTable)
    .where(and(eq(refreshTokensTable.userId, u.id), lt(refreshTokensTable.expiresAt, new Date())))
    .catch(() => {});

  res.json({
    token:        accessToken,
    refreshToken: refreshRaw,
    expiresAt:    new Date(Date.now() + ACCESS_TOKEN_TTL_SEC * 1000).toISOString(),
    sessionDays:  REFRESH_TOKEN_TTL_DAYS,
    user: {
      id:            u.id,
      phone:         u.phone,
      name:          u.name,
      email:         u.email,
      username:      u.username,
      role:          u.role,
      roles:         u.roles,
      avatar:        u.avatar,
      walletBalance: parseFloat(u.walletBalance ?? "0"),
      isActive:      u.isActive,
      cnic:          u.cnic,
      city:          u.city,
      totpEnabled:   u.totpEnabled ?? false,
      createdAt:     u.createdAt.toISOString(),
    },
  });
});

/* ─────────────────────────────────────────────────────────────
   POST /auth/vendor-register
   Vendor signup: after phone OTP verified, submit store info
   and register as a vendor pending admin approval.
───────────────────────────────────────────────────────────── */
router.post("/vendor-register", async (req, res) => {
  const auth = extractAuthUser(req);
  if (!auth) {
    const lang = await getRequestLocale(req);
    res.status(401).json({ error: t("apiErrAuthRequiredOtp", lang) });
    return;
  }

  const { storeName, storeCategory, name, cnic, address, city, bankName, bankAccount, bankAccountTitle, username } = req.body;
  if (!storeName) {
    const lang = await getRequestLocale(req, auth.userId);
    res.status(400).json({ error: t("apiErrStoreNameRequired", lang) });
    return;
  }

  if (username) {
    const normalizedUsername = String(username).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
    if (normalizedUsername.length < 3) {
      const lang = await getRequestLocale(req, auth.userId);
      res.status(400).json({ error: t("apiErrUsernameTooShort", lang) });
      return;
    }
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(sql`lower(${usersTable.username}) = ${normalizedUsername} AND ${usersTable.id} != ${auth.userId}`)
      .limit(1);
    if (existing) {
      const lang = await getRequestLocale(req, auth.userId);
      res.status(409).json({ error: t("apiErrUsernameTaken", lang) });
      return;
    }
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  if (!user) {
    const lang = await getRequestLocale(req, auth.userId);
    res.status(404).json({ error: t("apiErrUserNotFound", lang) });
    return;
  }

  if (!user.phoneVerified) {
    const lang = await getRequestLocale(req, auth.userId);
    res.status(403).json({ error: t("apiErrPhoneNotVerified", lang) });
    return;
  }

  const existingRoles = (user.roles || user.role || "").split(",").map((r: string) => r.trim()).filter(Boolean);
  if (existingRoles.includes("vendor")) {
    /* Allow profile completion even for existing vendor accounts that have not
       yet completed setup (isProfileComplete: false). Only skip if already done. */
    if (user.isProfileComplete) {
      if (user.approvalStatus === "pending") {
        res.json({ success: true, status: "pending", message: "Your vendor application is already pending admin approval." });
        return;
      }
      if (user.approvalStatus === "approved") {
        res.json({ success: true, status: "approved", message: "You are already approved as a vendor." });
        return;
      }
    }
  }

  const newRoles = existingRoles.includes("vendor") ? existingRoles : [...existingRoles, "vendor"];
  const settings = await getCachedSettings();
  const autoApprove = (settings["vendor_auto_approve"] ?? "off") === "on";

  await db.update(usersTable).set({
    roles: newRoles.join(","),
    role: "vendor",
    businessName: storeName || user.businessName || null,
    storeCategory: storeCategory || null,
    name: name || user.name,
    username: username ? String(username).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20) : user.username || null,
    cnic: cnic || user.cnic || null,
    address: address || user.address || null,
    city: city || user.city || null,
    bankName: bankName || user.bankName || null,
    bankAccount: bankAccount || user.bankAccount || null,
    bankAccountTitle: bankAccountTitle || user.bankAccountTitle || null,
    approvalStatus: autoApprove ? "approved" : "pending",
    isActive: autoApprove ? true : false,
    isProfileComplete: true,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, user.id));

  await db.insert(vendorProfilesTable).values({
    userId: user.id,
    storeName,
    storeCategory: storeCategory || null,
  }).onConflictDoUpdate({
    target: vendorProfilesTable.userId,
    set: { storeName, storeCategory: storeCategory || null },
  });

  await db.insert(notificationsTable).values({
    id: generateId(),
    userId: user.id,
    title: autoApprove ? "Welcome, Vendor! 🎉" : "Application Submitted ⏳",
    body: autoApprove
      ? "Your vendor account is approved! Start adding products and manage your store."
      : "Your vendor registration is pending admin approval. We'll notify you once approved.",
    type: "system",
    icon: autoApprove ? "checkmark-circle-outline" : "time-outline",
  }).catch(() => {});

  if (!autoApprove) {
    const admins = await db.select({ id: usersTable.id }).from(usersTable)
      .where(or(eq(usersTable.role, "admin"), sql`${usersTable.roles} LIKE '%admin%'`));
    const adminNotifs = admins.map(a => ({
      id: generateId(),
      userId: a.id,
      title: "New Vendor Application 📋",
      body: `${name || user.name || user.phone} has applied to become a vendor with store "${storeName}". Review and approve in the admin panel.`,
      type: "system" as const,
      icon: "storefront-outline",
    }));
    if (adminNotifs.length) {
      db.insert(notificationsTable).values(adminNotifs).catch(() => {});
    }
  }

  if (!autoApprove) {
    alertNewVendor(
      name || user.name || user.phone || "Unknown",
      user.phone || "N/A",
      storeName,
      settings,
    ).catch(() => {});
  }

  res.json({
    success: true,
    status: autoApprove ? "approved" : "pending",
    message: autoApprove
      ? "Your vendor account is approved! You can now log in."
      : "Your application has been submitted. Admin will review and approve your account.",
  });
});

/* ─────────────────────────────────────────────────────────────
   POST /auth/validate-token
   Client can use this to check if their token is still valid.
───────────────────────────────────────────────────────────── */
router.post("/validate-token", async (req, res) => {
  /* Support both body token and Authorization header */
  const authHeader = req.headers.authorization ?? "";
  const bodyToken  = req.body?.token ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : bodyToken;

  const tokenLang = await getRequestLocale(req);
  if (!token) { res.status(400).json({ error: t("apiErrTokenRequired", tokenLang) }); return; }

  try {
    const payload = verifyUserJwt(token);
    if (!payload) { res.status(401).json({ valid: false, error: t("apiErrInvalidExpiredToken", tokenLang) }); return; }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
    const userLang = user ? await getRequestLocale(req, user.id) : tokenLang;
    if (!user)         { res.status(401).json({ valid: false, error: t("apiErrUserNotFound", tokenLang) }); return; }
    if (user.isBanned) { res.status(403).json({ valid: false, error: t("apiErrAccountSuspended", userLang) }); return; }
    if (!user.isActive){ res.status(403).json({ valid: false, error: t("apiErrAccountInactive", userLang) }); return; }

    if ((payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
      res.status(401).json({ valid: false, error: t("apiErrTokenRevoked", userLang) }); return;
    }

    const expiresAt = payload.exp ? new Date(payload.exp * 1000).toISOString() : null;
    res.json({ valid: true, expiresAt, userId: user.id, role: user.role });
  } catch {
    res.status(401).json({ valid: false, error: t("apiErrTokenValidationFailed", tokenLang) });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /auth/refresh
   Exchange a valid refresh token for a new access token.
   Body: { refreshToken }
   On success: returns { token, expiresAt }
   Refresh tokens are rotated on use (old one revoked, new one issued).
───────────────────────────────────────────────────────────── */
async function handleRefreshToken(req: Request, res: Response) {
  const { refreshToken } = req.body;
  const ip = getClientIp(req);

  const tokenHash = hashRefreshToken(refreshToken);
  const [rt] = await db.select().from(refreshTokensTable).where(eq(refreshTokensTable.tokenHash, tokenHash)).limit(1);

  if (!rt) {
    writeAuthAuditLog("refresh_failed_not_found", { ip, userAgent: req.headers["user-agent"] ?? undefined });
    const lang = await getRequestLocale(req);
    res.status(401).json({ error: t("apiErrInvalidRefreshToken", lang) });
    return;
  }

  if (rt.revokedAt) {
    /* Token reuse detected — revoke all tokens for this user (possible token theft) */
    await revokeAllUserRefreshTokens(rt.userId);
    writeAuthAuditLog("refresh_token_reuse", { userId: rt.userId, ip, userAgent: req.headers["user-agent"] ?? undefined });
    addSecurityEvent({ type: "refresh_token_reuse", ip, userId: rt.userId, details: "Refresh token reuse detected — all sessions revoked", severity: "high" });
    const lang = await getRequestLocale(req, rt.userId);
    res.status(401).json({ error: t("apiErrSessionInvalidated", lang) });
    return;
  }

  if (new Date() > rt.expiresAt) {
    await revokeRefreshToken(tokenHash);
    writeAuthAuditLog("refresh_token_expired", { userId: rt.userId, ip });
    const lang = await getRequestLocale(req, rt.userId);
    res.status(401).json({ error: t("apiErrSessionExpired", lang) });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, rt.userId)).limit(1);
  if (!user || user.isBanned || !user.isActive) {
    await revokeRefreshToken(tokenHash);
    const lang = await getRequestLocale(req, rt.userId);
    res.status(401).json({ error: t("apiErrAccountNotAvailable", lang) });
    return;
  }

  const settings = await getCachedSettings();
  const userRole = user.role ?? "customer";

  const methodToSettingsKey: Record<string, string> = {
    phone_otp: "auth_phone_otp_enabled",
    email_otp: "auth_email_otp_enabled",
    password: "auth_username_password_enabled",
    social_google: "auth_google_enabled",
    social_facebook: "auth_facebook_enabled",
    magic_link: "auth_magic_link_enabled",
  };

  const originalMethod = rt.authMethod;
  if (originalMethod && methodToSettingsKey[originalMethod]) {
    const settingsKey = methodToSettingsKey[originalMethod]!;
    const legacyKeys: Record<string, string> = {
      social_google: "auth_social_google",
      social_facebook: "auth_social_facebook",
      magic_link: "auth_magic_link",
    };
    const legacyKey = legacyKeys[originalMethod];
    const isEnabled = legacyKey
      ? isAuthMethodEnabledStrict(settings, settingsKey, legacyKey, userRole)
      : isAuthMethodEnabled(settings, settingsKey, userRole);
    if (!isEnabled) {
      await revokeRefreshToken(tokenHash);
      const methodLang = await getRequestLocale(req);
      res.status(403).json({ error: t("apiErrLoginMethodDisabled", methodLang) });
      return;
    }
  } else {
    await revokeRefreshToken(tokenHash);
    const expLang = await getRequestLocale(req);
    res.status(403).json({ error: t("apiErrSessionExpired", expLang) });
    return;
  }

  /* Rotate: revoke old token and issue a new one */
  await revokeRefreshToken(tokenHash);

  const newAccessToken = signAccessToken(user.id, user.phone ?? "", user.role ?? "customer", user.roles ?? user.role ?? "customer", user.tokenVersion ?? 0);
  const { raw: newRefreshRaw, hash: newRefreshHash } = generateRefreshToken();
  const newRefreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokensTable).values({
    id:        generateId(),
    userId:    user.id,
    tokenHash: newRefreshHash,
    authMethod: rt.authMethod ?? null,
    expiresAt: newRefreshExpiresAt,
  });

  writeAuthAuditLog("token_refresh", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined });

  res.json({
    token:        newAccessToken,
    refreshToken: newRefreshRaw,
    expiresAt:    new Date(Date.now() + ACCESS_TOKEN_TTL_SEC * 1000).toISOString(),
  });
}

router.post("/refresh", sharedValidateBody(refreshTokenSchema), handleRefreshToken);
router.post("/refresh-token", sharedValidateBody(refreshTokenSchema), handleRefreshToken);

/* ─────────────────────────────────────────────────────────────
   POST /auth/logout
   Revokes the refresh token and clears OTP. Client must discard tokens.
───────────────────────────────────────────────────────────── */
router.post("/logout", async (req, res) => {
  const authHeader = req.headers["authorization"] as string | undefined;
  const tokenHeader = req.headers["x-auth-token"] as string | undefined;
  const raw = tokenHeader || authHeader?.replace(/^Bearer\s+/i, "");
  const { refreshToken } = req.body ?? {};
  const ip = getClientIp(req);

  if (raw) {
    const payload = verifyUserJwt(raw);
    if (payload) {
      /* Increment tokenVersion to immediately invalidate ALL outstanding access JWTs for this user */
      await db.update(usersTable)
        .set({ otpCode: null, tokenVersion: sql`token_version + 1` })
        .where(eq(usersTable.id, payload.userId));
      /* Clear GPS spoof hit counter so next login starts with a clean session */
      clearSpoofHits(payload.userId);
      addAuditEntry({ action: "user_logout", ip, details: `User logout: ${payload.userId}`, result: "success" });
      writeAuthAuditLog("logout", { userId: payload.userId, ip, userAgent: req.headers["user-agent"] ?? undefined });
    }
  }

  /* Revoke all refresh tokens for this user if refreshToken provided */
  if (refreshToken) {
    const tokenHash = hashRefreshToken(refreshToken);
    await revokeRefreshToken(tokenHash).catch(() => {});
    writeAuthAuditLog("token_revoked", { ip });
  }

  res.json({ success: true, message: "Logged out successfully" });
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/check-available
   Check if phone, email, or username is already taken.
   Body: { phone?, email?, username? }
   Returns: { phone: {available,taken}, email: {...}, username: {...} }
══════════════════════════════════════════════════════════════ */
router.post("/check-available", async (req, res) => {
  /* ── IP-based rate limit: max 20 checks per 10 minutes per IP ──
     Prevents scraping the entire user registry via phone/email/username probing. */
  const ip = getClientIp(req);
  const rlCheck = await checkAvailableRateLimit(ip, 20, 10);
  if (rlCheck.limited) {
    const lang = await getRequestLocale(req);
    res.status(429).json({ error: t("apiErrTooManyRequestsMinutes", lang).replace("{minutes}", String(rlCheck.minutesLeft)) }); return;
  }

  const { phone, email, username } = req.body;
  const result: Record<string, { available: boolean; message: string }> = {};

  if (phone) {
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
    result.phone = existing
      ? { available: false, message: "Is number se pehle se ek account bana hua hai" }
      : { available: true,  message: "Available" };
  }

  if (email && email.length > 3) {
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim())).limit(1);
    result.email = existing
      ? { available: false, message: "Is email se pehle se ek account bana hua hai" }
      : { available: true,  message: "Available" };
  }

  if (username && username.length > 2) {
    const clean = username.toLowerCase().trim();
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(sql`lower(${usersTable.username}) = ${clean}`).limit(1);
    result.username = existing
      ? { available: false, message: "Yeh username pehle se liya hua hai. Koi aur try karein." }
      : { available: true,  message: "Available" };
  }

  res.json(result);
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/send-email-otp
   Send OTP to email address (only for existing accounts with that email)
   Body: { email }
══════════════════════════════════════════════════════════════ */
router.post("/send-email-otp", verifyCaptcha, async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes("@")) {
    const lang = await getRequestLocale(req);
    res.status(400).json({ error: t("apiErrValidEmailRequired", lang) }); return;
  }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabled(settings, "auth_email_otp_enabled")) {
    const lang = await getRequestLocale(req);
    res.status(403).json({ error: t("apiErrEmailOtpDisabled", lang) });
    return;
  }
  const normalized = email.toLowerCase().trim();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
  if (!user) {
    const isDev = process.env.NODE_ENV !== "production";
    res.json({ message: "If an account exists with this email, an OTP has been sent.", ...(isDev ? { hint: "No account found" } : {}) });
    return;
  }

  if (!isAuthMethodEnabled(settings, "auth_email_otp_enabled", user.role ?? "customer")) {
    const lang = await getRequestLocale(req, user.id);
    res.status(403).json({ error: t("apiErrEmailOtpDisabled", lang) });
    return;
  }

  if (user.isBanned) {
    const lang = await getRequestLocale(req, user.id);
    res.status(403).json({ error: t("apiErrAccountSuspended", lang) }); return;
  }
  const isPendingEmail = user.approvalStatus === "pending";
  if (!user.isActive && !isPendingEmail) {
    const lang = await getRequestLocale(req, user.id);
    res.status(403).json({ error: t("apiErrAccountInactive", lang) }); return;
  }

  /* Lockout check using email as key */
  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);
  const lockout = await checkLockout(normalized, maxAttempts, lockoutMinutes);
  if (lockout.locked) {
    const lockLang = await getRequestLocale(req);
    res.status(429).json({ error: t("apiErrTooManyAttemptsMinutes", lockLang).replace("{minutes}", String(lockout.minutesLeft)) }); return;
  }

  /* ── Per-email OTP resend cooldown — prevents inbox flooding ──
     Same 60-second window as the SMS OTP cooldown. */
  const otpCooldownMs   = parseInt(settings["security_otp_cooldown_sec"] ?? "60", 10) * 1000;
  const existingExpiry  = user.emailOtpExpiry;
  if (existingExpiry) {
    const otpValidityMs = AUTH_OTP_TTL_MS;
    const issuedAgoMs   = otpValidityMs - (existingExpiry.getTime() - Date.now());
    if (issuedAgoMs < otpCooldownMs) {
      const waitSec = Math.ceil((otpCooldownMs - issuedAgoMs) / 1000);
      addAuditEntry({ action: "email_otp_throttle", ip, details: `Email OTP resend too soon for ${normalized} — ${waitSec}s remaining`, result: "fail" });
      const emailWaitLang = await getRequestLocale(req);
      res.status(429).json({ error: t("apiErrEmailOtpWaitSeconds", emailWaitLang).replace("{seconds}", String(waitSec)), retryAfterSeconds: waitSec });
      return;
    }
  }

  /* ── Per-account + per-IP OTP rate limit (admin-configurable window) ── */
  const emailRateCheck = await checkAndIncrOtpRateLimit({ identifier: normalized, ip, settings });
  if (emailRateCheck.blocked) {
    const emailRateLang = await getRequestLocale(req);
    const emailErrKey: TranslationKey = emailRateCheck.reason === "ip" ? "apiErrEmailOtpRateLimitedIp" : "apiErrEmailOtpRateLimitedAccount";
    addAuditEntry({ action: "email_otp_rate_limit", ip, details: `Email OTP rate limited (${normalized}) — retry in ${emailRateCheck.retryAfterSeconds}s`, result: "fail" });
    res.status(429).json({ error: t(emailErrKey, emailRateLang).replace("{seconds}", String(emailRateCheck.retryAfterSeconds)), retryAfterSeconds: emailRateCheck.retryAfterSeconds });
    return;
  }

  const otp    = generateSecureOtp();
  const expiry = new Date(Date.now() + AUTH_OTP_TTL_MS);

  await db.update(usersTable)
    .set({ emailOtpCode: hashOtp(otp), emailOtpExpiry: expiry, updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  const isDev = process.env.NODE_ENV !== "production";
  const emailOtpDebugMode = isOtpDebugMode(settings);
  req.log.info({ email: normalized, otp: emailOtpDebugMode ? otp : "[hidden]" }, "Email OTP generated");

  /* Send OTP via email service. Falls back gracefully when SMTP is not configured.
     In development or debug mode, the OTP is also exposed in the response for easy testing. */
  const emailOtpLang = await getUserLanguage(user.id);
  const effectiveEmailSettings = mergeProviderCredentials(settings);
  const emailResult = await sendPasswordResetEmail(normalized, otp, user.name ?? undefined, emailOtpLang, effectiveEmailSettings);

  if (!emailResult.sent) {
    if (emailOtpDebugMode) {
      logger.warn({ email: normalized, otp, reason: emailResult.reason ?? "SMTP not configured" }, "[EMAIL-OTP] Failed to send OTP email — debug mode active");
    } else {
      logger.warn({ email: normalized, reason: emailResult.reason ?? "SMTP not configured" }, "[EMAIL-OTP] Failed to send OTP email");
    }
  }

  addAuditEntry({ action: "email_otp_sent", ip, details: `Email OTP for: ${normalized} (delivered: ${emailResult.sent})`, result: "success" });

  const globalDevOtpEmail = settings["security_global_dev_otp"] === "on";
  const userDevOtpEmail = user.devOtpEnabled === true;
  const emailConsoleFallback = !emailResult.sent;
  res.json({
    message: "OTP aapki email par bhej diya gaya hai",
    channel: emailResult.sent ? "email" : "console",
    ...((globalDevOtpEmail || userDevOtpEmail) ? { otp, devMode: true } : {}),
  });
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/verify-email-otp
   Login via email OTP. Body: { email, otp }
══════════════════════════════════════════════════════════════ */
router.post("/verify-email-otp", verifyCaptcha, async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    const lang = await getRequestLocale(req);
    res.status(400).json({ error: t("apiErrEmailAndOtpRequired", lang) }); return;
  }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabled(settings, "auth_email_otp_enabled")) {
    const lang = await getRequestLocale(req);
    res.status(403).json({ error: t("apiErrEmailOtpDisabled", lang) });
    return;
  }
  const normalized = email.toLowerCase().trim();

  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);

  const lockout = await checkLockout(normalized, maxAttempts, lockoutMinutes);
  if (lockout.locked) {
    const lang = await getRequestLocale(req);
    res.status(429).json({ error: t("apiErrAccountLocked", lang).replace("{minutes}", String(lockout.minutesLeft)) }); return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
  if (!user) {
    const lang = await getRequestLocale(req);
    res.status(404).json({ error: t("apiErrUserNotFound", lang) }); return;
  }

  if (!isAuthMethodEnabled(settings, "auth_email_otp_enabled", user.role ?? "customer")) {
    const lang = await getRequestLocale(req, user.id);
    res.status(403).json({ error: t("apiErrEmailOtpDisabled", lang) });
    return;
  }

  /* Cross-role enforcement: rider/vendor apps send their role; reject mismatches */
  const requestedEmailRole = req.body.role as string | undefined;
  if (requestedEmailRole) {
    const userRolesEmail = (user.roles || user.role || "customer").split(",").map((r: string) => r.trim());
    if (!userRolesEmail.includes(requestedEmailRole)) {
      addSecurityEvent({ type: "cross_role_login_attempt", ip, userId: user.id, details: `User with roles [${user.roles}] tried email OTP login as ${requestedEmailRole}`, severity: "high" });
      const lang = await getRequestLocale(req, user.id);
      res.status(403).json({ error: t("apiErrWrongApp", lang), wrongApp: true }); return;
    }
  }

  if (user.isBanned) {
    const lang = await getRequestLocale(req, user.id);
    res.status(403).json({ error: t("apiErrAccountSuspended", lang) }); return;
  }
  const emailIsPending = user.approvalStatus === "pending";
  if (!user.isActive && !emailIsPending) {
    const lang = await getRequestLocale(req, user.id);
    res.status(403).json({ error: t("apiErrAccountInactive", lang) }); return;
  }

  /* Check expiry FIRST — prevents timing oracle (attacker learning that an
     expired OTP was correct by observing which error branch fires). */
  if (user.emailOtpExpiry && new Date() > user.emailOtpExpiry) {
    const lang = await getRequestLocale(req, user.id);
    res.status(401).json({ error: t("apiErrOtpExpired", lang) }); return;
  }

  const isDev_emailOtp = process.env.NODE_ENV !== "production";
  const bypassOtp_email = isDev_emailOtp && settings["security_otp_bypass"] === "on";
  if (!bypassOtp_email && user.emailOtpCode !== hashOtp(otp)) {
    const updated = await recordFailedAttempt(normalized, maxAttempts, lockoutMinutes);
    const remaining = maxAttempts - updated.attempts;
    addAuditEntry({ action: "email_otp_failed", ip, details: `Wrong email OTP for: ${normalized}`, result: "fail" });
    const lang = await getRequestLocale(req, user.id);
    if (updated.lockedUntil) {
      res.status(429).json({ error: t("apiErrAccountLocked", lang).replace("{minutes}", String(lockoutMinutes)) });
    } else {
      res.status(401).json({ error: `${t("apiErrInvalidOtp", lang)} ${t("apiErrAttemptsRemaining", lang).replace("{count}", String(remaining))}`, attemptsRemaining: remaining });
    }
    return;
  }

  /* Check approval BEFORE touching the DB — a rejected user must not have their OTP cleared */
  if (user.approvalStatus === "rejected") {
    const lang = await getRequestLocale(req, user.id);
    res.status(403).json({ error: t("apiErrAccountRejected", lang), code: "APPROVAL_REJECTED", approvalStatus: "rejected", rejectionReason: user.approvalNote ?? null }); return;
  }

  /* Clear email OTP + mark email verified + update last login */
  await db.update(usersTable)
    .set({ emailOtpCode: null, emailOtpExpiry: null, emailVerified: true, lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  await resetAttempts(normalized);

  addAuditEntry({ action: "email_login", ip, details: `Email OTP login for: ${normalized}`, result: "success" });

  /* ── 2FA challenge ── */
  if (user.totpEnabled && isAuthMethodEnabled(settings, "auth_2fa_enabled", user.role ?? undefined)) {
    const deviceFingerprint = req.body.deviceFingerprint ?? "";
    const trustedDays = parseInt(settings["auth_trusted_device_days"] ?? "30", 10);
    if (!isDeviceTrusted(user, deviceFingerprint, trustedDays)) {
      const tempToken = sign2faChallengeToken(user.id, user.phone ?? "", user.role ?? "customer", user.roles ?? "customer", "email_otp");
      res.json({ requires2FA: true, tempToken, userId: user.id }); return;
    }
  }

  const isPendingApproval = user.approvalStatus === "pending";

  /* Issue short-lived access token + refresh token (consistent with OTP flow) */
  const accessToken = signAccessToken(user.id, user.phone ?? "", user.role ?? "customer", user.roles ?? "customer", user.tokenVersion ?? 0);
  const expiresAt   = new Date(Date.now() + ACCESS_TOKEN_TTL_SEC * 1000).toISOString();

  if (isPendingApproval) {
    res.json({
      token: accessToken, expiresAt, pendingApproval: true,
      message: "Aapka account admin approval ke liye bheja gaya hai.",
      user: { id: user.id, phone: user.phone, name: user.name, role: user.role, roles: user.roles, approvalStatus: "pending" },
    });
    return;
  }

  const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(refreshTokensTable).values({ id: generateId(), userId: user.id, tokenHash: refreshHash, authMethod: "email_otp", expiresAt: refreshExpiresAt });
  db.delete(refreshTokensTable).where(and(eq(refreshTokensTable.userId, user.id), lt(refreshTokensTable.expiresAt, new Date()))).catch(() => {});

  writeAuthAuditLog("login_success", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { method: "email_otp" } });

  res.json({
    token:        accessToken,
    refreshToken: refreshRaw,
    expiresAt,
    sessionDays:  REFRESH_TOKEN_TTL_DAYS,
    pendingApproval: false,
    user: { id: user.id, phone: user.phone, name: user.name, email: user.email, username: user.username, role: user.role, roles: user.roles, avatar: user.avatar, walletBalance: parseFloat(user.walletBalance ?? "0"), emailVerified: true, phoneVerified: user.phoneVerified ?? false },
  });
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/login/username   (kept for backward-compat)
   POST /auth/login            (new unified endpoint)
   Unified identifier + password login (Binance-style).
   Accepts phone, email, OR username as `identifier` (or `username`).
   Body: { identifier, password } OR { username, password }
══════════════════════════════════════════════════════════════ */
function detectIdentifierType(raw: string): "phone" | "email" | "username" {
  if (raw.includes("@")) return "email";
  const cleaned = raw.replace(/[\s\-()]/g, "");
  if (/^\+?92\d{10}$/.test(cleaned) || /^0?3\d{9}$/.test(cleaned)) return "phone";
  if (/^\d{10,}$/.test(cleaned)) return "phone";
  return "username";
}

async function findUserByIdentifier(identifier: string) {
  const clean = identifier.toLowerCase().trim();
  const idType = detectIdentifierType(clean);

  if (idType === "phone") {
    const phone = canonicalizePhone(clean);
    if (!phone) return { user: null, idType, lookupKey: clean };
    const [user] = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
    return { user: user ?? null, idType, lookupKey: phone };
  }
  if (idType === "email") {
    const [user] = await db.select().from(usersTable).where(sql`lower(${usersTable.email}) = ${clean}`).limit(1);
    return { user: user ?? null, idType, lookupKey: clean };
  }
  const [user] = await db.select().from(usersTable).where(sql`lower(${usersTable.username}) = ${clean}`).limit(1);
  return { user: user ?? null, idType, lookupKey: clean };
}

async function handleUnifiedLogin(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const loginLang = parseAcceptLanguage(req.headers["accept-language"] as string | undefined) ?? "en";
    res.status(400).json({ error: first?.message ?? t("apiErrInvalidRequestBody", loginLang), field: first?.path?.[0] ?? undefined });
    return;
  }
  const identifier = (parsed.data.identifier || parsed.data.username || "").trim();
  const { password } = parsed.data;
  if (!identifier) {
    const lang = await getRequestLocale(req);
    res.status(400).json({ error: t("apiErrCredentialsRequired", lang) }); return;
  }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabled(settings, "auth_username_password_enabled")) {
    const lang = await getRequestLocale(req);
    res.status(403).json({ error: t("apiErrPasswordLoginDisabled", lang) });
    return;
  }

  const { user, idType, lookupKey } = await findUserByIdentifier(identifier);

  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);

  const lockoutKey = user ? `uid:${user.id}` : lookupKey;

  const lockout = await checkLockout(lockoutKey, maxAttempts, lockoutMinutes);
  if (lockout.locked) {
    const lang = await getRequestLocale(req, user?.id);
    res.status(429).json({ error: t("apiErrAccountLocked", lang).replace("{minutes}", String(lockout.minutesLeft)) }); return;
  }

  if (!user || !user.passwordHash) {
    await recordFailedAttempt(lockoutKey, maxAttempts, lockoutMinutes);
    addAuditEntry({ action: "unified_login_failed", ip, details: `Not found or no password (${idType}): ${lookupKey}`, result: "fail" });
    const lang = await getRequestLocale(req);
    res.status(401).json({ error: t("apiErrInvalidCredentials", lang) }); return;
  }

  if (!isAuthMethodEnabled(settings, "auth_username_password_enabled", user.role ?? "customer")) {
    const lang = await getRequestLocale(req, user.id);
    res.status(403).json({ error: t("apiErrPasswordLoginDisabled", lang) });
    return;
  }

  /* ── Cross-role enforcement ── */
  const requestedRoleLogin = parsed.data.role;
  if (requestedRoleLogin) {
    const userRolesLogin = (user.roles || user.role || "customer").split(",").map((r: string) => r.trim());
    if (!userRolesLogin.includes(requestedRoleLogin)) {
      addSecurityEvent({ type: "cross_role_login_attempt", ip, userId: user.id, details: `User with roles [${user.roles}] tried to log in as ${requestedRoleLogin}`, severity: "high" });
      const lang = await getRequestLocale(req, user.id);
      res.status(403).json({ error: t("apiErrWrongApp", lang), wrongApp: true }); return;
    }
  }

  if (user.isBanned) {
    const lang = await getRequestLocale(req, user.id);
    res.status(403).json({ error: t("apiErrAccountSuspended", lang) }); return;
  }
  const isPendingApproval = user.approvalStatus === "pending";
  if (!user.isActive && !isPendingApproval) {
    const lang = await getRequestLocale(req, user.id);
    res.status(403).json({ error: t("apiErrAccountInactive", lang) }); return;
  }

  const passwordOk = verifyPassword(password, user.passwordHash);
  if (!passwordOk) {
    const updated = await recordFailedAttempt(lockoutKey, maxAttempts, lockoutMinutes);
    addAuditEntry({ action: "unified_login_failed", ip, details: `Wrong password (${idType}): ${lookupKey}`, result: "fail" });
    const lang = await getRequestLocale(req, user.id);
    if (updated.lockedUntil) {
      res.status(429).json({ error: t("apiErrAccountLocked", lang).replace("{minutes}", String(lockoutMinutes)) });
    } else {
      res.status(401).json({ error: `${t("apiErrInvalidCredentials", lang)} ${t("apiErrAttemptsRemaining", lang).replace("{count}", String(maxAttempts - updated.attempts))}` });
    }
    return;
  }

  if (user.approvalStatus === "rejected") {
    const lang = await getRequestLocale(req, user.id);
    res.status(403).json({ error: t("apiErrAccountRejected", lang), code: "APPROVAL_REJECTED", approvalStatus: "rejected", rejectionReason: user.approvalNote ?? null }); return;
  }

  await resetAttempts(lockoutKey);
  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
  addAuditEntry({ action: "unified_login", ip, details: `Login via ${idType}: ${lookupKey}`, result: "success" });

  /* ── Profile-incomplete guard (password login path) ──
     Must be checked before 2FA and before access token issuance.
     An incomplete-profile user receives a setup token only — never a full access token. */
  if (!user.isProfileComplete) {
    addAuditEntry({ action: "user_login_setup_required", ip, details: `Setup token issued (password) for incomplete profile: ${lookupKey}`, result: "pending" });
    const setupToken = signSetupToken(user.id, user.phone ?? "", user.role ?? "customer");
    res.json({
      token: setupToken,
      setupRequired: true,
      pendingApproval: user.approvalStatus === "pending",
      message: user.approvalStatus === "pending"
        ? "Aapka account admin approval ke liye bheja gaya hai. Approve hone par aap login kar sakenge."
        : "Kripya apna profile poora karein.",
      user: { id: user.id, phone: user.phone, name: user.name, role: user.role, roles: user.roles, approvalStatus: user.approvalStatus },
    });
    return;
  }

  if (user.totpEnabled && isAuthMethodEnabled(settings, "auth_2fa_enabled", user.role ?? undefined)) {
    const deviceFingerprint = req.body.deviceFingerprint ?? "";
    const trustedDays = parseInt(settings["auth_trusted_device_days"] ?? "30", 10);
    if (!isDeviceTrusted(user, deviceFingerprint, trustedDays)) {
      const tempToken = sign2faChallengeToken(user.id, user.phone ?? "", user.role ?? "customer", user.roles ?? "customer", "password");
      res.json({ requires2FA: true, tempToken, userId: user.id }); return;
    }
  }

  const accessToken = signAccessToken(user.id, user.phone ?? "", user.role ?? "customer", user.roles ?? "customer", user.tokenVersion ?? 0);
  const expiresAt   = new Date(Date.now() + ACCESS_TOKEN_TTL_SEC * 1000).toISOString();

  if (isPendingApproval) {
    res.json({
      token: accessToken, expiresAt, pendingApproval: true,
      message: "Aapka account admin approval ke liye bheja gaya hai.",
      user: { id: user.id, phone: user.phone, name: user.name, role: user.role, roles: user.roles, approvalStatus: "pending" },
    });
    return;
  }

  const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(refreshTokensTable).values({ id: generateId(), userId: user.id, tokenHash: refreshHash, authMethod: "password", expiresAt: refreshExpiresAt });
  db.delete(refreshTokensTable).where(and(eq(refreshTokensTable.userId, user.id), lt(refreshTokensTable.expiresAt, new Date()))).catch(() => {});

  writeAuthAuditLog("login_success", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { method: `password_${idType}`, identifier: lookupKey } });

  res.json({
    token:        accessToken,
    refreshToken: refreshRaw,
    expiresAt,
    sessionDays:  REFRESH_TOKEN_TTL_DAYS,
    pendingApproval: false,
    identifierType: idType,
    user: { id: user.id, phone: user.phone, name: user.name, email: user.email, username: user.username, role: user.role, roles: user.roles, avatar: user.avatar, walletBalance: parseFloat(user.walletBalance ?? "0"), emailVerified: user.emailVerified ?? false, phoneVerified: user.phoneVerified ?? false },
  });
}

router.post("/login/username", verifyCaptcha, handleUnifiedLogin);
router.post("/login", verifyCaptcha, handleUnifiedLogin);

/* ══════════════════════════════════════════════════════════════
   POST /auth/complete-profile
   Set name, email, username, password for first-time setup.
   Requires valid JWT. Body: { token, name, email?, username?, password? }
══════════════════════════════════════════════════════════════ */
router.post("/complete-profile", async (req, res) => {
  /* Accept token from body OR Authorization: Bearer header */
  const authHeader = req.headers["authorization"] as string | undefined;
  const rawToken = req.body?.token || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
  const { name, email, username, password, currentPassword, cnic, address, city, area, latitude, longitude,
          businessName, storeName, storeCategory, vehicleType, role: requestedRole } = req.body;
  if (!rawToken) {
    const lang = await getRequestLocale(req);
    res.status(401).json({ error: t("apiErrTokenRequired", lang) }); return;
  }

  /* Verify JWT to get userId — accept both setup-only and full access tokens */
  const payload = verifyUserJwt(rawToken);
  if (!payload) {
    const lang = await getRequestLocale(req);
    res.status(401).json({ error: t("apiErrTokenInvalidOrExpired", lang) }); return;
  }
  const userId = payload.userId;

  const settings = await getCachedSettings();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    const lang = await getRequestLocale(req, userId);
    res.status(404).json({ error: t("apiErrUserNotFound", lang) }); return;
  }
  if (user.isBanned) {
    const lang = await getRequestLocale(req, userId);
    res.status(403).json({ error: t("apiErrAccountSuspended", lang) }); return;
  }
  /* Allow through: setup-only users (isProfileComplete: false) and pending-approval users */
  if (!user.isActive && user.isProfileComplete && user.approvalStatus !== "pending") {
    const lang = await getRequestLocale(req, userId);
    res.status(403).json({ error: t("apiErrAccountInactive", lang) }); return;
  }

  const updates: Partial<typeof usersTable.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() };

  if (name && name.trim().length > 1) {
    updates.name = name.trim();
  }

  if (email && email.includes("@")) {
    const normalized = email.toLowerCase().trim();
    /* Check email uniqueness (skip if it's already this user's email) */
    if (normalized !== user.email) {
      const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
      if (existing && existing.id !== userId) {
        const lang = await getRequestLocale(req, userId);
        res.status(409).json({ error: t("apiErrEmailAlreadyExists", lang) }); return;
      }
    }
    updates.email = normalized;
  }

  if (username && username.length > 2) {
    const clean = username.toLowerCase().replace(/[^a-z0-9_]/g, "").trim();
    if (clean.length < 3) {
      const lang = await getRequestLocale(req, userId);
      res.status(400).json({ error: t("apiErrUsernameMinLength", lang) }); return;
    }
    if (clean !== user.username) {
      const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(sql`lower(${usersTable.username}) = ${clean}`).limit(1);
      if (existing && existing.id !== userId) {
        const lang = await getRequestLocale(req, userId);
        res.status(409).json({ error: t("apiErrUsernameTaken", lang) }); return;
      }
    }
    updates.username = clean;
  }

  if (cnic && cnic.trim()) {
    const cnicClean = cnic.trim();
    if (CNIC_REGEX.test(cnicClean)) {
      updates.cnic = cnicClean;
      updates.nationalId = cnicClean;
    }
  }

  if (address && typeof address === "string" && address.trim()) {
    updates.address = address.trim();
  }
  if (city && typeof city === "string" && city.trim()) {
    updates.city = city.trim();
  }
  if (area && typeof area === "string" && area.trim()) {
    updates.area = area.trim();
  }
  if (latitude && typeof latitude === "string") {
    updates.latitude = latitude;
  }
  if (longitude && typeof longitude === "string") {
    updates.longitude = longitude;
  }

  /* ── Vendor profile fields ── */
  if (businessName && typeof businessName === "string" && businessName.trim()) {
    updates.businessName = businessName.trim();
  }
  if (storeName && typeof storeName === "string" && storeName.trim()) {
    /* storeName maps to businessName on the users table for vendor identity */
    if (!updates.businessName) updates.businessName = storeName.trim();
  }
  if (storeCategory && typeof storeCategory === "string" && storeCategory.trim()) {
    updates.storeCategory = storeCategory.trim();
  }

  /* ── Rider vehicle type (upsert into riderProfilesTable) handled after user update ── */

  if (password && password.length >= 8) {
    const isNewRegistration = !user.name || user.name === "User" || user.name === "Pending";
    if (user.passwordHash && !isNewRegistration) {
      if (!currentPassword) {
        const lang = await getRequestLocale(req, userId);
        res.status(400).json({ error: t("apiErrCurrentPasswordChange", lang) }); return;
      }
      if (!verifyPassword(currentPassword, user.passwordHash)) {
        const lang = await getRequestLocale(req, userId);
        res.status(401).json({ error: t("apiErrCurrentPasswordWrong", lang) }); return;
      }
    }
    const check = validatePasswordStrength(password);
    if (!check.ok) {
      const lang = await getRequestLocale(req, userId);
      res.status(400).json({ error: t("apiErrPasswordPolicy", lang) }); return;
    }
    updates.passwordHash = hashPassword(password);
  }

  const hasName = updates.name || user.name;
  const hasEmail = updates.email || user.email;
  const hasAddress = updates.address || user.address;
  const hasCity = updates.city || user.city;
  const hasCnic = updates.cnic || user.cnic;
  const hasPassword = updates.passwordHash || user.passwordHash;
  const filledCount = [hasName, hasEmail, hasAddress, hasCity, hasCnic, hasPassword].filter(Boolean).length;
  let newLevel = "bronze";
  if (filledCount >= 5 && hasCnic) newLevel = "gold";
  else if (filledCount >= 3) newLevel = "silver";
  updates.accountLevel = newLevel;

  if (Object.keys(updates).length === 1) {
    const lang = await getRequestLocale(req, userId);
    res.status(400).json({ error: t("apiErrNoProfileUpdate", lang) }); return;
  }

  /* ── Role-based activation on profile completion ────────────────────────────
     This gate is idempotent: only new completions (isProfileComplete: false)
     trigger bonus credit and status change. Already-complete users may still
     update fields (name, city, etc.) without side effects.

     Customer → immediately active (approvalStatus: approved, isActive: true)
     Rider    → pending admin approval (approvalStatus: pending, isActive: false)
     Vendor   → pending admin approval (approvalStatus: pending, isActive: false)

     Required fields per role (server-side enforced):
     - Customer: name
     - Rider:    name + cnic (or already stored from register payload)
     - Vendor:   name + (businessName already stored or will be checked)
  ──────────────────────────────────────────────────────────────────────────── */
  /* Allow role upgrade from customer → rider/vendor during first profile completion only */
  const allowedRoles = ["customer", "rider", "vendor"] as const;
  const isFirstCompletion = !user.isProfileComplete;
  let effectiveRole: string = user.role ?? "customer";
  if (isFirstCompletion && requestedRole && allowedRoles.includes(requestedRole as typeof allowedRoles[number]) && requestedRole !== "customer") {
    effectiveRole = requestedRole as string;
    updates.role = effectiveRole;
    updates.roles = effectiveRole;
  }

  /* Validate role-specific required fields before marking profile complete */
  const resolvedName = (updates.name as string | undefined) || user.name;
  const resolvedCnic = (updates.cnic as string | undefined) || user.cnic;
  const resolvedBusinessName = (updates.businessName as string | undefined) || user.businessName;

  if (isFirstCompletion) {
    if (!resolvedName || (resolvedName as string).trim().length < 2) {
      const lang = await getRequestLocale(req, userId);
      res.status(400).json({ error: t("apiErrNameRequired", lang) ?? "Name is required to complete your profile." });
      return;
    }
    if (effectiveRole === "rider" && !resolvedCnic) {
      const lang = await getRequestLocale(req, userId);
      res.status(400).json({ error: t("apiErrCnicRequired", lang) ?? "CNIC is required for rider profile completion." });
      return;
    }
    if (effectiveRole === "vendor" && !resolvedBusinessName) {
      const lang = await getRequestLocale(req, userId);
      res.status(400).json({ error: t("apiErrBusinessNameRequired", lang) ?? "Business name is required for vendor profile completion." });
      return;
    }
    updates.isProfileComplete = true;
    if (effectiveRole === "customer") {
      updates.approvalStatus = "approved";
      updates.isActive = true;
    } else {
      /* Rider and vendor require admin approval */
      updates.approvalStatus = "pending";
      updates.isActive = false;
    }
  }

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();

  /* ── Credit signup bonus ONLY on first completion, only for customers ──
     Guard against double-credit: users who went through /auth/register → /auth/verify-otp
     may have already received the bonus during OTP verification.
     We check walletTransactionsTable to prevent duplicate bonus issuance. ── */
  const signupBonusAmount = parseFloat(settings["customer_signup_bonus"] ?? "0");
  if (isFirstCompletion && effectiveRole === "customer" && signupBonusAmount > 0) {
    const [existingBonus] = await db
      .select({ id: walletTransactionsTable.id })
      .from(walletTransactionsTable)
      .where(and(eq(walletTransactionsTable.userId, updated!.id), eq(walletTransactionsTable.type, "bonus")))
      .limit(1);
    if (!existingBonus) {
      await db.update(usersTable)
        .set({ walletBalance: sql`wallet_balance + ${signupBonusAmount}` })
        .where(eq(usersTable.id, updated!.id));
      await db.insert(walletTransactionsTable).values({
        id: generateId(), userId: updated!.id, type: "bonus",
        amount: signupBonusAmount.toFixed(2), description: "Welcome bonus — Thanks for joining!",
      });
      await db.insert(notificationsTable).values({
        id: generateId(), userId: updated!.id,
        title: "Welcome Bonus!",
        body: `Rs. ${signupBonusAmount} has been added to your wallet. Welcome to AJKMart!`,
        type: "wallet", icon: "gift-outline",
      }).catch(() => {});
    }
  }

  /* ── For riders/vendors: return approval status — no full access token ── */
  if (effectiveRole !== "customer") {
    writeAuthAuditLog("profile_complete_pending", { userId: updated!.id, ip: req.socket?.remoteAddress ?? "unknown", metadata: { role: effectiveRole } });
    res.json({
      success: true,
      pendingApproval: updated!.approvalStatus === "pending",
      isProfileComplete: !!updated!.isProfileComplete,
      message: updated!.approvalStatus === "approved"
        ? "Profile updated."
        : "Profile submitted. Your account is pending admin approval.",
      user: { id: updated!.id, phone: updated!.phone, name: updated!.name, role: updated!.role, roles: updated!.roles, approvalStatus: updated!.approvalStatus, isActive: updated!.isActive, isProfileComplete: !!updated!.isProfileComplete },
    });
    return;
  }

  /* ── Customer: issue full access token ── */
  const freshWallet = await db.select({ walletBalance: usersTable.walletBalance })
    .from(usersTable).where(eq(usersTable.id, updated!.id)).limit(1);
  const finalWalletBalance = parseFloat(freshWallet[0]?.walletBalance ?? "0");

  const accessToken = signAccessToken(updated!.id, updated!.phone ?? "", updated!.role ?? "customer", updated!.roles ?? updated!.role ?? "customer", updated!.tokenVersion ?? 0);
  const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokensTable).values({
    id:        generateId(),
    userId:    updated!.id,
    tokenHash: refreshHash,
    authMethod: "password",
    expiresAt: refreshExpiresAt,
  });

  db.delete(refreshTokensTable)
    .where(and(eq(refreshTokensTable.userId, updated!.id), lt(refreshTokensTable.expiresAt, new Date())))
    .catch(() => {});

  writeAuthAuditLog("profile_complete_activated", { userId: updated!.id, ip: req.socket?.remoteAddress ?? "unknown", metadata: { role: effectiveRole } });

  res.json({
    success: true,
    isProfileComplete: true,
    message: "Profile complete. Welcome to AJKMart!",
    token: accessToken,
    refreshToken: refreshRaw,
    user: { id: updated!.id, phone: updated!.phone, name: updated!.name, email: updated!.email, username: updated!.username, role: updated!.role, roles: updated!.roles, avatar: updated!.avatar, cnic: updated!.cnic, city: updated!.city, area: updated!.area, address: updated!.address, latitude: updated!.latitude, longitude: updated!.longitude, kycStatus: updated!.kycStatus, accountLevel: updated!.accountLevel, totpEnabled: updated!.totpEnabled ?? false, emailVerified: updated!.emailVerified, phoneVerified: updated!.phoneVerified, walletBalance: finalWalletBalance, isActive: true, isProfileComplete: true, createdAt: updated!.createdAt.toISOString() },
  });
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/set-password
   Set or change password. Body: { token, password, currentPassword? }
══════════════════════════════════════════════════════════════ */
router.post("/set-password", async (req, res) => {
  /* Accept token from body OR Authorization: Bearer header */
  const authHeader = req.headers["authorization"] as string | undefined;
  const rawToken = req.body?.token || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
  const { password, currentPassword } = req.body;
  if (!rawToken || !password) {
    const lang = await getRequestLocale(req);
    res.status(400).json({ error: t("apiErrTokenAndPasswordRequired", lang) }); return;
  }

  const payload = verifyUserJwt(rawToken);
  if (!payload) {
    const lang = await getRequestLocale(req);
    res.status(401).json({ error: t("apiErrTokenInvalidOrExpired", lang) }); return;
  }
  const userId = payload.userId;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    const lang = await getRequestLocale(req, userId);
    res.status(404).json({ error: t("apiErrUserNotFound", lang) }); return;
  }
  if (user.isBanned) {
    const lang = await getRequestLocale(req, userId);
    res.status(403).json({ error: t("apiErrAccountSuspended", lang) }); return;
  }
  if (!user.isActive) {
    const lang = await getRequestLocale(req, userId);
    res.status(403).json({ error: t("apiErrAccountInactive", lang) }); return;
  }

  /* If user already has a password, ALWAYS require the current password — no bypass */
  if (user.passwordHash) {
    if (!currentPassword) {
      const lang = await getRequestLocale(req, userId);
      res.status(400).json({ error: t("apiErrCurrentPasswordRequired", lang) }); return;
    }
    if (!verifyPassword(currentPassword, user.passwordHash)) {
      const lang = await getRequestLocale(req, userId);
      res.status(401).json({ error: t("apiErrCurrentPasswordWrong", lang) }); return;
    }
  }

  const check = validatePasswordStrength(password);
  if (!check.ok) { res.status(400).json({ error: check.message }); return; }

  /* Bump tokenVersion to invalidate all outstanding JWTs on password change */
  await db.update(usersTable).set({
    passwordHash: hashPassword(password),
    tokenVersion: sql`token_version + 1`,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, userId));
  writeAuthAuditLog("password_changed", { userId, ip: getClientIp(req), userAgent: req.headers["user-agent"] ?? undefined });
  res.json({ success: true, message: "Password set ho gaya" });
});

function isAuthMethodEnabled(settings: Record<string, string>, key: string, role?: string): boolean {
  const val = settings[key];
  if (!val) return false;
  if (val === "on") return true;
  if (val === "off") return false;
  try {
    const parsed = JSON.parse(val) as Record<string, string>;
    if (role) return (parsed[role] ?? "off") === "on";
    /* No role given — return true if at least one role has it enabled */
    return Object.values(parsed).some(v => v === "on");
  } catch {
    return val === "on";
  }
}

/* ══════════════════════════════════════════════════════════════════════
   OTP Rate Limiter — per account (phone/email) + per IP address
   Uses rateLimitsTable with sliding window (resets after window expires).
   Keys: otp_acct:<identifier>  and  otp_ip:<ip>
══════════════════════════════════════════════════════════════════════ */
async function checkAndIncrOtpRateLimit(params: {
  identifier: string;
  ip:         string;
  settings:   Record<string, string>;
}): Promise<{ blocked: true; retryAfterSeconds: number; reason: "account" | "ip" } | { blocked: false }> {
  const maxPerAcct = Math.max(1, parseInt(params.settings["security_otp_max_per_phone"] ?? "5",  10));
  const maxPerIp   = Math.max(1, parseInt(params.settings["security_otp_max_per_ip"]    ?? "10", 10));
  const windowMin  = Math.max(1, parseInt(params.settings["security_otp_window_min"]     ?? "60", 10));
  const windowMs   = windowMin * 60 * 1000;
  const now        = new Date();

  async function checkOne(
    key: string,
    max: number,
  ): Promise<{ blocked: true; retryAfterSeconds: number } | { blocked: false }> {
    const rows = await db.select().from(rateLimitsTable).where(eq(rateLimitsTable.key, key)).limit(1);
    const row  = rows[0];
    const windowExpired = !row || (now.getTime() - row.windowStart.getTime()) >= windowMs;

    if (windowExpired) {
      /* Reset (or create) the window and count this as 1 request */
      await db
        .insert(rateLimitsTable)
        .values({ key, attempts: 1, windowStart: now, updatedAt: now })
        .onConflictDoUpdate({
          target: rateLimitsTable.key,
          set:    { attempts: 1, windowStart: now, updatedAt: now },
        });
      return { blocked: false };
    }

    if (row.attempts >= max) {
      const windowEndsAt       = row.windowStart.getTime() + windowMs;
      const retryAfterSeconds  = Math.max(1, Math.ceil((windowEndsAt - now.getTime()) / 1000));
      return { blocked: true, retryAfterSeconds };
    }

    await db
      .update(rateLimitsTable)
      .set({ attempts: row.attempts + 1, updatedAt: now })
      .where(eq(rateLimitsTable.key, key));
    return { blocked: false };
  }

  /* 1. Per-account limit */
  const acctResult = await checkOne(`otp_acct:${params.identifier}`, maxPerAcct);
  if (acctResult.blocked) return { blocked: true, retryAfterSeconds: acctResult.retryAfterSeconds, reason: "account" };

  /* 2. Per-IP limit */
  const ipResult = await checkOne(`otp_ip:${params.ip}`, maxPerIp);
  if (ipResult.blocked) return { blocked: true, retryAfterSeconds: ipResult.retryAfterSeconds, reason: "ip" };

  return { blocked: false };
}

function isAuthMethodEnabledStrict(settings: Record<string, string>, newKey: string, legacyKey: string, role?: string): boolean {
  const newVal = settings[newKey];
  if (newVal) {
    try {
      const parsed = JSON.parse(newVal) as Record<string, string>;
      if (role && role in parsed) return parsed[role] === "on";
      if (!role) return false;
      return false;
    } catch {
      return newVal === "on";
    }
  }
  const legacyVal = settings[legacyKey];
  if (legacyVal) return legacyVal === "on";
  return false;
}

const CNIC_REGEX = /^\d{5}-\d{7}-\d{1}$/;
const PHONE_REGEX = /^(\+?92|0)?3\d{9}$/;

router.post("/register", verifyCaptcha, sharedValidateBody(registerSchema), async (req, res) => {
  const { phone, password, name, role, cnic, nationalId, email, username,
          vehicleType, vehicleRegNo, drivingLicense,
          address, city, emergencyContact, vehiclePlate, vehiclePhoto, documents,
          businessName, businessType, storeAddress, ntn, storeName, storeCategory } = req.body;

  const ip = getClientIp(req);
  const settings = await getCachedSettings();
  const userRole = (role === "rider" || role === "vendor") ? role : "customer";

  const regLang = await getRequestLocale(req);
  if (settings["feature_new_users"] === "off") {
    res.status(403).json({ error: t("apiErrRegistrationDisabled", regLang) });
    return;
  }

  if (!isAuthMethodEnabled(settings, "auth_phone_otp_enabled", userRole)) {
    res.status(403).json({ error: t("apiErrPhoneRegDisabled", regLang) });
    return;
  }

  if (!phone) {
    res.status(400).json({ error: t("apiErrPhoneRequired", regLang) });
    return;
  }
  const cleanedPhone = phone.replace(/[\s\-()]/g, "");
  if (!PHONE_REGEX.test(cleanedPhone)) {
    res.status(400).json({ error: t("apiErrInvalidPhone", regLang) });
    return;
  }

  if (!password) {
    res.status(400).json({ error: t("apiErrPasswordRequired", regLang) });
    return;
  }
  const pwCheck = validatePasswordStrength(password);
  if (!pwCheck.ok) {
    res.status(400).json({ error: t("apiErrPasswordPolicy", regLang) });
    return;
  }

  const cnicValue = cnic || nationalId;
  if (cnicValue && !CNIC_REGEX.test(cnicValue)) {
    res.status(400).json({ error: t("apiErrCnicFormat", regLang) });
    return;
  }

  if (userRole === "rider") {
    if (!cnicValue) { res.status(400).json({ error: t("apiErrCnicRequired", regLang) }); return; }
    if (!vehicleType) { res.status(400).json({ error: t("apiErrVehicleTypeRequired", regLang) }); return; }
  }

  if (userRole === "vendor") {
    if (!businessName && !storeName) { res.status(400).json({ error: t("apiErrBusinessNameRequired", regLang) }); return; }
  }

  const normalizedPhone = canonicalizePhone(phone);
  if (!normalizedPhone) {
    res.status(400).json({ error: t("apiErrInvalidPhone", regLang) }); return;
  }
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, normalizedPhone)).limit(1);
  if (existing) {
    res.status(409).json({ error: t("apiErrPhoneAlreadyExists", regLang) });
    return;
  }

  if (email) {
    const normalizedEmail = email.toLowerCase().trim();
    const [existingEmail] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);
    if (existingEmail) {
      res.status(409).json({ error: t("apiErrEmailAlreadyExists", regLang) });
      return;
    }
  }

  let cleanUsername: string | null = null;
  if (username) {
    cleanUsername = username.toLowerCase().trim().replace(/[^a-z0-9_]/g, "").slice(0, 20);
    if (cleanUsername !== null && cleanUsername.length >= 3) {
      const [existingUsername] = await db.select({ id: usersTable.id }).from(usersTable).where(sql`lower(${usersTable.username}) = ${cleanUsername}`).limit(1);
      if (existingUsername) {
        res.status(409).json({ error: t("apiErrUsernameTaken", regLang) });
        return;
      }
    } else {
      cleanUsername = null;
    }
  }

  const requireApproval = (settings["user_require_approval"] ?? "off") === "on";
  const autoApproveRider = userRole === "rider" && settings["rider_auto_approve"] === "on";
  const autoApproveVendor = userRole === "vendor" && settings["vendor_auto_approve"] === "on";
  const needsApproval = requireApproval && !autoApproveRider && !autoApproveVendor;

  const otp = generateSecureOtp();
  const otpExpiry = new Date(Date.now() + AUTH_OTP_TTL_MS);

  /* ── Store registration INTENT in pendingOtpsTable — NO user record yet ──
     The user row is only created atomically inside verify-otp after OTP is confirmed.
     This prevents phantom accounts from being created for unverified phone numbers. */
  const registrationPayload = JSON.stringify({
    name:            name?.trim() || null,
    email:           email ? email.toLowerCase().trim() : null,
    username:        cleanUsername,
    role:            userRole,
    passwordHash:    hashPassword(password),
    cnic:            cnicValue || null,
    vehicleType:     vehicleType || null,
    vehicleRegNo:    vehicleRegNo || null,
    vehiclePlate:    vehiclePlate || vehicleRegNo || null,
    drivingLicense:  drivingLicense || null,
    address:         address || null,
    city:            city || null,
    emergencyContact: emergencyContact || null,
    vehiclePhoto:    vehiclePhoto || null,
    documents:       documents || null,
    businessName:    businessName || storeName || null,
    businessType:    businessType || null,
    storeAddress:    storeAddress || null,
    ntn:             ntn || null,
    storeName:       storeName || businessName || null,
    storeCategory:   storeCategory || null,
    needsApproval,
    _source:         "register",
  });

  await db
    .insert(pendingOtpsTable)
    .values({ id: generateId(), phone: normalizedPhone, otpHash: hashOtp(otp), otpExpiry, payload: registrationPayload })
    .onConflictDoUpdate({
      target: pendingOtpsTable.phone,
      set: { otpHash: hashOtp(otp), otpExpiry, attempts: 0, payload: registrationPayload },
    });

  const defaultLang = await getPlatformDefaultLanguage();
  const smsResult = await sendOtpSMS(normalizedPhone, otp, settings, defaultLang);
  if (settings["integration_whatsapp"] === "on") {
    sendWhatsAppOTP(normalizedPhone, otp, settings, defaultLang).catch(err =>
      req.log.warn({ err: err.message }, "WhatsApp OTP send failed (non-fatal)")
    );
  }

  writeAuthAuditLog("register", { ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone: normalizedPhone, role: userRole } });

  const isDev = process.env.NODE_ENV !== "production";
  const globalDevOtp = settings["security_global_dev_otp"] === "on";
  const isConsoleDelivery = smsResult.provider === "console";
  const regResponse: Record<string, unknown> = {
    message: "Registration successful. Please verify your phone with the OTP sent.",
    role: userRole,
    pendingApproval: needsApproval,
    channel: smsResult.sent ? smsResult.provider : "console",
  };

  /* Expose OTP in response ONLY when admin explicitly enabled:
     - Global Dev OTP Mode is enabled in admin Security settings */
  if (globalDevOtp) {
    regResponse.otp = otp;
    regResponse.devMode = true;
  }

  res.status(201).json(regResponse);
});

router.post("/forgot-password", verifyCaptcha, sharedValidateBody(forgotPasswordSchema), async (req, res) => {
  let { phone, email, identifier } = req.body;
  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (identifier && !phone && !email) {
    const resolved = await findUserByIdentifier(identifier);
    if (resolved.user) {
      if (resolved.idType === "phone") {
        phone = resolved.user.phone ?? undefined;
      } else if (resolved.idType === "email") {
        email = resolved.user.email ?? undefined;
      } else if (resolved.idType === "username") {
        if (resolved.user.email) {
          email = resolved.user.email ?? undefined;
        } else if (resolved.user.phone) {
          phone = resolved.user.phone ?? undefined;
        }
      }
    }
  }

  const forgotLang1 = await getRequestLocale(req);
  if (!phone && !email) {
    res.status(400).json({ error: t("apiErrPhoneEmailUsernameRequired", forgotLang1) });
    return;
  }

  if (phone && !isAuthMethodEnabled(settings, "auth_phone_otp_enabled")) {
    res.status(403).json({ error: t("apiErrPhoneResetDisabled", forgotLang1) });
    return;
  }
  if (email && !phone && !isAuthMethodEnabled(settings, "auth_email_otp_enabled")) {
    res.status(403).json({ error: t("apiErrEmailResetDisabled", forgotLang1) });
    return;
  }

  let user;
  if (phone) {
    const canonPhone = canonicalizePhone(phone);
    if (!canonPhone) { res.status(400).json({ error: t("apiErrInvalidPhone", forgotLang1) }); return; }
    const [found] = await db.select().from(usersTable).where(eq(usersTable.phone, canonPhone)).limit(1);
    user = found;
  } else {
    const normalized = email!.toLowerCase().trim();
    const [found] = await db.select().from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
    user = found;
  }

  const isDev = process.env.NODE_ENV !== "production";
  if (!user) {
    res.json({ message: "If an account exists, a reset code has been sent.", ...(isDev ? { hint: "No account found" } : {}) });
    return;
  }

  const forgotRole = user.role ?? "customer";
  const forgotUserLang = await getRequestLocale(req, user.id);
  if (phone && !isAuthMethodEnabled(settings, "auth_phone_otp_enabled", forgotRole)) {
    res.status(403).json({ error: t("apiErrPhoneResetAccountDisabled", forgotUserLang) });
    return;
  }
  if (email && !phone && !isAuthMethodEnabled(settings, "auth_email_otp_enabled", forgotRole)) {
    res.status(403).json({ error: t("apiErrEmailResetAccountDisabled", forgotUserLang) });
    return;
  }

  if (user.isBanned) { res.status(403).json({ error: t("apiErrAccountSuspended", forgotUserLang) }); return; }
  if (!user.isActive) { res.status(403).json({ error: t("apiErrAccountInactive", forgotUserLang) }); return; }

  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);
  const lockoutKey = `reset:${user.id}`;
  const lockout = await checkLockout(lockoutKey, maxAttempts, lockoutMinutes);
  if (lockout.locked) {
    res.status(429).json({ error: t("apiErrTooManyAttemptsMinutes", forgotUserLang).replace("{minutes}", String(lockout.minutesLeft)) });
    return;
  }

  const otp = generateSecureOtp();
  const otpExpiry = new Date(Date.now() + AUTH_OTP_TTL_MS);

  const forgotLang = await getUserLanguage(user.id);

  const isDev_forgot = process.env.NODE_ENV !== "production";
  const globalDevOtp_forgot = settings["security_global_dev_otp"] === "on";
  let forgotChannel = "sms";

  if (phone) {
    await db.update(usersTable)
      .set({ otpCode: hashOtp(otp), otpExpiry, otpUsed: false, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));

    const targetPhone = canonicalizePhone(phone)!;
    const smsResult = await sendOtpSMS(targetPhone, otp, settings, forgotLang);
    forgotChannel = smsResult.provider;
    if (settings["integration_whatsapp"] === "on") {
      sendWhatsAppOTP(targetPhone, otp, settings, forgotLang).catch(() => {});
    }
  } else {
    await db.update(usersTable)
      .set({ emailOtpCode: hashOtp(otp), emailOtpExpiry: otpExpiry, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));

    await sendPasswordResetEmail(email!, otp, user.name ?? undefined, forgotLang);
    forgotChannel = "email";
  }

  writeAuthAuditLog("forgot_password", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined });

  const forgotDevOtp = globalDevOtp_forgot;
  res.json({
    message: "If an account exists, a reset code has been sent.",
    ...(forgotDevOtp ? { otp, devMode: true } : {}),
  });
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/verify-reset-otp
   Pre-verify the OTP before allowing the user to set a new password.
   Body: { phone?, email?, otp }
   Returns: { valid: true } or 400/422 with error
══════════════════════════════════════════════════════════════ */
router.post("/verify-reset-otp", verifyCaptcha, async (req, res) => {
  let { phone, email, otp } = req.body;
  const ip = getClientIp(req);

  const verifyResetLang = await getRequestLocale(req);
  if (!otp || typeof otp !== "string") {
    res.status(400).json({ error: t("apiErrOtpRequired", verifyResetLang) });
    return;
  }
  if (!phone && !email) {
    res.status(400).json({ error: t("apiErrPhoneOrEmailRequired", verifyResetLang) });
    return;
  }

  let user: (typeof usersTable.$inferSelect) | undefined;
  if (phone) {
    const canonPhone = canonicalizePhone(phone);
    if (!canonPhone) { res.status(400).json({ error: t("apiErrInvalidPhone", verifyResetLang) }); return; }
    const [found] = await db.select().from(usersTable).where(eq(usersTable.phone, canonPhone)).limit(1);
    user = found;
  } else {
    const normalized = (email as string).toLowerCase().trim();
    const [found] = await db.select().from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
    user = found;
  }

  if (!user) {
    res.status(422).json({ error: t("apiErrInvalidOrExpiredCode", verifyResetLang) });
    return;
  }

  const hashed = hashOtp(otp);
  const now = new Date();
  const verifyResetUserLang = await getRequestLocale(req, user.id);

  const isDev_resetVerify = process.env.NODE_ENV !== "production";
  const bypassOtp_resetVerify = isDev_resetVerify && settings["security_otp_bypass"] === "on";

  if (!bypassOtp_resetVerify) {
    if (phone) {
      if (!user.otpCode || user.otpCode !== hashed) {
        res.status(422).json({ error: t("apiErrInvalidVerificationCode", verifyResetUserLang) });
        return;
      }
      if (!user.otpExpiry || user.otpExpiry < now) {
        res.status(422).json({ error: t("apiErrCodeExpired", verifyResetUserLang) });
        return;
      }
      if (user.otpUsed) {
        res.status(422).json({ error: t("apiErrCodeAlreadyUsed", verifyResetUserLang) });
        return;
      }
    } else {
      if (!user.emailOtpCode || user.emailOtpCode !== hashed) {
        res.status(422).json({ error: t("apiErrInvalidVerificationCode", verifyResetUserLang) });
        return;
      }
      if (!user.emailOtpExpiry || user.emailOtpExpiry < now) {
        res.status(422).json({ error: t("apiErrCodeExpired", verifyResetUserLang) });
        return;
      }
    }
  }

  writeAuthAuditLog("verify_reset_otp", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined });
  res.json({ valid: true });
});

router.post("/reset-password", verifyCaptcha, async (req, res) => {
  let { phone, email, identifier, otp, newPassword, totpCode } = req.body;
  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  const resetLang1 = await getRequestLocale(req);
  if (!otp || !newPassword) {
    res.status(400).json({ error: t("apiErrOtpAndPasswordRequired", resetLang1) });
    return;
  }

  if (identifier && !phone && !email) {
    const resolved = await findUserByIdentifier(identifier);
    if (resolved.user) {
      if (resolved.idType === "phone") {
        phone = resolved.user.phone ?? undefined;
      } else if (resolved.idType === "email") {
        email = resolved.user.email ?? undefined;
      } else if (resolved.idType === "username") {
        if (resolved.user.email) {
          email = resolved.user.email ?? undefined;
        } else if (resolved.user.phone) {
          phone = resolved.user.phone ?? undefined;
        }
      }
    }
  }

  if (!phone && !email) {
    res.status(400).json({ error: t("apiErrPhoneEmailUsernameRequired", resetLang1) });
    return;
  }

  const pwCheck = validatePasswordStrength(newPassword);
  if (!pwCheck.ok) {
    res.status(400).json({ error: t("apiErrPasswordPolicy", resetLang1) });
    return;
  }

  let user;
  if (phone) {
    const canonPhone = canonicalizePhone(phone);
    if (!canonPhone) { res.status(400).json({ error: t("apiErrInvalidPhone", resetLang1) }); return; }
    const [found] = await db.select().from(usersTable).where(eq(usersTable.phone, canonPhone)).limit(1);
    user = found;
  } else {
    const normalized = email!.toLowerCase().trim();
    const [found] = await db.select().from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
    user = found;
  }

  if (!user) {
    res.status(404).json({ error: t("apiErrAccountNotFound", resetLang1) });
    return;
  }

  const resetUserLang = await getRequestLocale(req, user.id);
  const userRole = user.role ?? "customer";

  if (phone && !isAuthMethodEnabled(settings, "auth_phone_otp_enabled", userRole)) {
    res.status(403).json({ error: t("apiErrPhoneResetAccountDisabled", resetUserLang) });
    return;
  }
  if (email && !phone && !isAuthMethodEnabled(settings, "auth_email_otp_enabled", userRole)) {
    res.status(403).json({ error: t("apiErrEmailResetAccountDisabled", resetUserLang) });
    return;
  }

  if (user.isBanned) { res.status(403).json({ error: t("apiErrAccountSuspended", resetUserLang) }); return; }

  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);
  const lockoutKey = `reset:${user.id}`;
  const lockout = await checkLockout(lockoutKey, maxAttempts, lockoutMinutes);
  if (lockout.locked) {
    res.status(429).json({ error: t("apiErrTooManyAttemptsMinutes", resetUserLang).replace("{minutes}", String(lockout.minutesLeft)) });
    return;
  }

  const isDev_resetPwd = process.env.NODE_ENV !== "production";
  const bypassOtp_resetPwd = isDev_resetPwd && settings["security_otp_bypass"] === "on";
  let otpValid = bypassOtp_resetPwd;
  if (!otpValid) {
    if (phone) {
      otpValid = user.otpCode === hashOtp(otp) && !user.otpUsed && user.otpExpiry != null && new Date() < user.otpExpiry;
    } else {
      otpValid = user.emailOtpCode === hashOtp(otp) && user.emailOtpExpiry != null && new Date() < user.emailOtpExpiry;
    }
  }

  if (!otpValid) {
    await recordFailedAttempt(lockoutKey, maxAttempts, lockoutMinutes);
    addAuditEntry({ action: "reset_password_failed", ip, details: `Invalid OTP for password reset: ${user.id}`, result: "fail" });
    res.status(401).json({ error: t("apiErrInvalidOrExpiredOtp", resetUserLang) });
    return;
  }

  if (user.totpEnabled && isAuthMethodEnabled(settings, "auth_2fa_enabled", userRole)) {
    if (!totpCode) {
      res.status(400).json({ error: t("apiErr2faRequired", resetUserLang), requires2FA: true });
      return;
    }
    if (!/^\d{6}$/.test(totpCode)) {
      res.status(400).json({ error: t("apiErrTotpSixDigits", resetUserLang) });
      return;
    }
    if (!user.totpSecret) {
      res.status(400).json({ error: t("apiErr2faNotConfigured", resetUserLang) });
      return;
    }
    const { verifyTotpCode } = await import("../services/password.js");
    const decryptedSecret = decryptTotpSecret(user.totpSecret);
    if (!verifyTotpCode(decryptedSecret, totpCode)) {
      await recordFailedAttempt(lockoutKey, maxAttempts, lockoutMinutes);
      addAuditEntry({ action: "reset_password_2fa_failed", ip, details: `Invalid TOTP for password reset: ${user.id}`, result: "fail" });
      res.status(401).json({ error: t("apiErrInvalid2faCode", resetUserLang) });
      return;
    }
  }

  await db.update(usersTable).set({
    passwordHash: hashPassword(newPassword),
    otpCode: null,
    otpExpiry: null,
    otpUsed: true,
    emailOtpCode: null,
    emailOtpExpiry: null,
    tokenVersion: sql`token_version + 1`,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, user.id));

  await resetAttempts(lockoutKey);

  writeAuthAuditLog("password_reset", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined });

  res.json({ success: true, message: "Password has been reset successfully. Please login with your new password." });
});

router.post("/email-register", verifyCaptcha, async (req, res) => {
  const { email, password, name, role, phone, username, cnic, vehicleType, vehicleRegNo, vehicleRegistration, drivingLicense,
          address, city, emergencyContact, vehiclePlate, vehiclePhoto, documents } = req.body;
  const ip = getClientIp(req);
  const settings = await getCachedSettings();
  const userRole = (role === "rider" || role === "vendor") ? role : "customer";

  const emailRegLang = await getRequestLocale(req);
  if (!isAuthMethodEnabled(settings, "auth_email_register_enabled", userRole)) {
    res.status(403).json({ error: t("apiErrEmailRegDisabled", emailRegLang) });
    return;
  }

  if (settings["feature_new_users"] === "off") {
    res.status(403).json({ error: t("apiErrRegistrationDisabled", emailRegLang) });
    return;
  }

  if (!email || !email.includes("@")) {
    res.status(400).json({ error: t("apiErrValidEmailRequired", emailRegLang) });
    return;
  }
  if (!password) {
    res.status(400).json({ error: t("apiErrPasswordRequired", emailRegLang) });
    return;
  }

  const pwCheck = validatePasswordStrength(password);
  if (!pwCheck.ok) {
    res.status(400).json({ error: t("apiErrPasswordPolicy", emailRegLang) });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);
  if (existing) {
    res.status(409).json({ error: t("apiErrEmailAlreadyExists", emailRegLang) });
    return;
  }

  let cleanUsername: string | null = null;
  if (username) {
    cleanUsername = username.toLowerCase().trim().replace(/[^a-z0-9_]/g, "").slice(0, 20);
    if (cleanUsername !== null && cleanUsername.length >= 3) {
      const [existingUsername] = await db.select({ id: usersTable.id }).from(usersTable).where(sql`lower(${usersTable.username}) = ${cleanUsername}`).limit(1);
      if (existingUsername) {
        res.status(409).json({ error: t("apiErrUsernameTaken", emailRegLang) });
        return;
      }
    } else {
      cleanUsername = null;
    }
  }

  const requireApproval = (settings["user_require_approval"] ?? "off") === "on";
  const userId = generateId();
  const tempPhone = `email_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const rawToken = generateVerificationToken();
  const tokenHash = hashVerificationToken(rawToken);
  const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const resolvedPhone = phone?.trim() || tempPhone;
  const resolvedVehicleRegNo = vehicleRegNo || vehicleRegistration || null;

  await db.insert(usersTable).values({
    id: userId,
    phone: resolvedPhone,
    name: name?.trim() || null,
    email: normalizedEmail,
    username: cleanUsername,
    role: userRole,
    roles: userRole,
    passwordHash: hashPassword(password),
    walletBalance: "0",
    isActive: !requireApproval,
    approvalStatus: requireApproval ? "pending" : "approved",
    emailVerified: false,
    emailOtpCode: tokenHash,
    emailOtpExpiry: verificationExpiry,
    ...(cnic ? { cnic: cnic.trim() } : {}),
    ...(resolvedVehicleRegNo ? { vehicleRegNo: resolvedVehicleRegNo.trim() } : {}),
    ...(drivingLicense ? { drivingLicense: drivingLicense.trim() } : {}),
    ...(address ? { address: address.trim() } : {}),
    ...(city ? { city: city.trim() } : {}),
    ...(emergencyContact ? { emergencyContact: emergencyContact.trim() } : {}),
    ...(vehiclePlate ? { vehiclePlate: vehiclePlate.trim() } : {}),
    ...(vehiclePhoto ? { vehiclePhoto } : {}),
    ...(documents ? { documents } : {}),
  });

  if (userRole === "rider" && vehicleType) {
    await db.insert(riderProfilesTable).values({
      userId,
      vehicleType: normalizeVehicleTypeForStorage(vehicleType),
    }).onConflictDoUpdate({
      target: riderProfilesTable.userId,
      set: { vehicleType: normalizeVehicleTypeForStorage(vehicleType) },
    });
  }

  const domain = process.env["REPLIT_DEV_DOMAIN"] || process.env["APP_DOMAIN"] || "localhost";
  const verificationLink = `https://${domain}/api/auth/verify-email?token=${encodeURIComponent(rawToken)}&email=${encodeURIComponent(normalizedEmail)}`;

  const verifyLang = await getUserLanguage(userId);
  const emailResult = await sendVerificationEmail(normalizedEmail, verificationLink, name, verifyLang);

  writeAuthAuditLog("email_register", { userId, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { email: normalizedEmail, role: userRole, emailSent: emailResult.sent } });

  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    req.log.info({ email: normalizedEmail, emailSent: emailResult.sent }, "Email verification token generated");
  }

  res.status(201).json({
    message: emailResult.sent
      ? "Registration successful. Please check your email to verify your account."
      : "Registration successful. Please check your email to verify your account. (Email delivery pending — contact support if not received.)",
    userId,
    role: userRole,
    pendingApproval: requireApproval,
    emailSent: emailResult.sent,
    verificationLink: isDev ? verificationLink : undefined,
    ...(isDev ? { verificationToken: rawToken } : {}),
  });
});

router.get("/verify-email", async (req, res) => {
  const { token, email } = req.query as { token?: string; email?: string };
  const ip = getClientIp(req);

  const verifyEmailLang = await getRequestLocale(req);
  if (!token || !email) {
    res.status(400).json({ error: t("apiErrInvalidVerificationLink", verifyEmailLang) });
    return;
  }

  const normalizedEmail = decodeURIComponent(email).toLowerCase().trim();
  const verifyKey = `email_verify:${normalizedEmail}`;

  const lockout = await checkLockout(verifyKey, 5, 15);
  if (lockout.locked) {
    res.status(429).json({ error: t("apiErrTooManyVerifyAttempts", verifyEmailLang).replace("{minutes}", String(lockout.minutesLeft)) });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);

  if (!user) {
    await recordFailedAttempt(verifyKey, 5, 15);
    res.status(400).json({ error: t("apiErrInvalidOrExpiredLink", verifyEmailLang) });
    return;
  }

  const verifyEmailUserLang = await getRequestLocale(req, user.id);

  if (user.emailVerified) {
    res.json({ message: t("apiErrEmailAlreadyVerified", verifyEmailUserLang) });
    return;
  }

  if (user.emailOtpExpiry && new Date() > user.emailOtpExpiry) {
    res.status(401).json({ error: t("apiErrVerificationLinkExpired", verifyEmailUserLang) });
    return;
  }

  const incomingHash = hashVerificationToken(decodeURIComponent(token));
  if (!user.emailOtpCode || user.emailOtpCode !== incomingHash) {
    await recordFailedAttempt(verifyKey, 5, 15);
    addAuditEntry({ action: "email_verify_failed", ip, details: `Invalid verification token for ${normalizedEmail}`, result: "fail" });
    res.status(401).json({ error: t("apiErrInvalidOrExpiredLink", verifyEmailUserLang) });
    return;
  }

  await db.update(usersTable).set({
    emailVerified: true,
    emailOtpCode: null,
    emailOtpExpiry: null,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, user.id));

  await resetAttempts(verifyKey);
  writeAuthAuditLog("email_verified", { userId: user.id, ip });

  res.json({ message: "Email verified successfully. You can now log in." });
});

/* ══════════════════════════════════════════════════════════════
   HELPER: Extract authenticated user from JWT (Authorization header)
══════════════════════════════════════════════════════════════ */
function extractAuthUser(req: Request): { userId: string; phone: string; role: string } | null {
  const authHeader = req.headers["authorization"] as string | undefined;
  const raw = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : (req.body?.token ?? null);
  if (!raw) return null;
  const payload = verifyUserJwt(raw);
  if (!payload) return null;
  return { userId: payload.userId, phone: payload.phone, role: payload.role };
}

/* ══════════════════════════════════════════════════════════════
   HELPER: Issue tokens & build response for a given user
══════════════════════════════════════════════════════════════ */
function parseUserAgent(ua?: string): { deviceName: string; browser: string; os: string } {
  if (!ua) return { deviceName: "Unknown", browser: "Unknown", os: "Unknown" };
  let browser = "Unknown";
  if (ua.includes("Firefox/")) browser = "Firefox";
  else if (ua.includes("Edg/")) browser = "Edge";
  else if (ua.includes("OPR/") || ua.includes("Opera/")) browser = "Opera";
  else if (ua.includes("Chrome/")) browser = "Chrome";
  else if (ua.includes("Safari/")) browser = "Safari";
  let os = "Unknown";
  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Mac OS")) os = "macOS";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
  else if (ua.includes("Linux")) os = "Linux";
  const deviceName = `${browser} on ${os}`;
  return { deviceName, browser, os };
}

async function issueTokensForUser(user: typeof usersTable.$inferSelect, ip: string, method: string, userAgent?: string) {
  const accessToken = signAccessToken(user.id, user.phone ?? "", user.role ?? "customer", user.roles ?? user.role ?? "customer", user.tokenVersion ?? 0);
  const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const refreshTokenId = generateId();
  await db.insert(refreshTokensTable).values({ id: refreshTokenId, userId: user.id, tokenHash: refreshHash, authMethod: method, expiresAt: refreshExpiresAt });
  db.delete(refreshTokensTable).where(and(eq(refreshTokensTable.userId, user.id), lt(refreshTokensTable.expiresAt, new Date()))).catch((err) => { console.error("[auth] Expired token cleanup failed:", err); });
  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
  writeAuthAuditLog("login_success", { userId: user.id, ip, userAgent, metadata: { method } });

  const parsed = parseUserAgent(userAgent);
  const tokenHash = crypto.createHash("sha256").update(accessToken).digest("hex");
  try {
    await db.insert(userSessionsTable).values({
      id: generateId(),
      userId: user.id,
      tokenHash,
      refreshTokenId,
      deviceName: parsed.deviceName,
      browser: parsed.browser,
      os: parsed.os,
      ip,
    });
  } catch (err) { console.error("[auth] Session record insert failed:", err); }

  try {
    await db.insert(loginHistoryTable).values({
      id: generateId(),
      userId: user.id,
      ip,
      deviceName: parsed.deviceName,
      browser: parsed.browser,
      os: parsed.os,
      success: true,
      method,
    });
  } catch (err) { console.error("[auth] Login history insert failed:", err); }

  return {
    token: accessToken,
    refreshToken: refreshRaw,
    expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SEC * 1000).toISOString(),
    sessionDays: REFRESH_TOKEN_TTL_DAYS,
    user: {
      id: user.id, phone: user.phone, name: user.name, email: user.email,
      role: user.role, roles: user.roles, avatar: user.avatar,
      walletBalance: parseFloat(user.walletBalance ?? "0"),
      isActive: user.isActive, cnic: user.cnic, city: user.city,
      emailVerified: user.emailVerified ?? false, phoneVerified: user.phoneVerified ?? false,
      totpEnabled: user.totpEnabled ?? false,
      needsProfileCompletion: !user.cnic || !user.name,
    },
  };
}

/* ══════════════════════════════════════════════════════════════
   HELPER: Check trusted device
══════════════════════════════════════════════════════════════ */
function isDeviceTrusted(user: Pick<typeof usersTable.$inferSelect, "trustedDevices">, deviceFingerprint: string, trustedDays: number): boolean {
  if (!user.trustedDevices || !deviceFingerprint) return false;
  try {
    const devices: Array<{ fp: string; expiresAt: number }> = JSON.parse(user.trustedDevices);
    const now = Date.now();
    return devices.some(d => d.fp === deviceFingerprint && d.expiresAt > now);
  } catch {
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════
   POST /auth/social/google
   Verify Google ID token, match or create user, return JWT.
   Body: { idToken, deviceFingerprint? }
══════════════════════════════════════════════════════════════ */
router.post("/social/google", async (req, res) => {
  const { idToken, deviceFingerprint } = req.body;
  const googleLang1 = await getRequestLocale(req);
  if (!idToken) { res.status(400).json({ error: t("apiErrIdTokenRequired", googleLang1) }); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabledStrict(settings, "auth_google_enabled", "auth_social_google")) {
    res.status(403).json({ error: t("apiErrGoogleLoginDisabled", googleLang1) }); return;
  }

  let googlePayload: { sub?: string; email?: string; name?: string; picture?: string };
  try {
    const resp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) throw new Error("Invalid token");
    googlePayload = await resp.json() as typeof googlePayload;
  } catch {
    addSecurityEvent({ type: "social_google_invalid_token", ip, details: "Invalid Google ID token", severity: "medium" });
    res.status(401).json({ error: t("apiErrInvalidGoogleToken", googleLang1) }); return;
  }

  const googleId = googlePayload.sub;
  const email = googlePayload.email?.toLowerCase?.() ?? null;
  const name = googlePayload.name ?? null;
  const avatar = googlePayload.picture ?? null;

  if (!googleId) { res.status(401).json({ error: t("apiErrGoogleTokenMissingSub", googleLang1) }); return; }

  let [user] = await db.select().from(usersTable).where(eq(usersTable.googleId, googleId)).limit(1);

  if (!user && email) {
    [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (user) {
      await db.update(usersTable).set({ googleId, updatedAt: new Date() }).where(eq(usersTable.id, user.id));
      user.googleId = googleId;
    }
  }

  const isNewUser = !user;

  /* ── Cross-role guard for social login ──
     If the caller specifies a role (rider/vendor), enforce that the existing account
     includes that role. Block new user creation for non-customer roles via social auth. */
  const requestedSocialRole = (req.body?.role as string | undefined) ?? null;
  if (requestedSocialRole && requestedSocialRole !== "customer") {
    if (user) {
      const userRoles = (user.roles || user.role || "").split(",").map((r: string) => r.trim());
      if (!userRoles.includes(requestedSocialRole)) {
        addSecurityEvent({ type: "cross_role_social_login_attempt", ip, details: `Social Google cross-role: requested=${requestedSocialRole} user.roles=${user.roles}`, severity: "medium" });
        res.status(403).json({ error: t("apiErrWrongAppForRole", googleLang1).replace("{role}", requestedSocialRole), wrongApp: true }); return;
      }
    } else {
      /* No user found — cannot auto-create non-customer accounts via social auth */
      res.status(403).json({ error: t("apiErrNoRoleAccountContact", googleLang1).replace("{role}", requestedSocialRole), wrongApp: true }); return;
    }
  }

  const googleEffectiveRole = user?.role ?? "customer";
  const googleUserLang = user ? await getRequestLocale(req, user.id) : googleLang1;
  if (!isAuthMethodEnabledStrict(settings, "auth_google_enabled", "auth_social_google", googleEffectiveRole)) {
    res.status(403).json({ error: t("apiErrGoogleLoginAccountDisabled", googleUserLang) }); return;
  }

  if (!user) {
    if (settings["feature_new_users"] === "off") {
      res.status(403).json({ error: t("apiErrRegistrationDisabled", googleLang1) }); return;
    }
    const requireApproval = settings["user_require_approval"] === "on";
    const id = generateId();
    [user] = await db.insert(usersTable).values({
      id, name, email, avatar, googleId,
      role: "customer", roles: "customer", walletBalance: "0",
      emailVerified: !!email,
      isActive: !requireApproval, approvalStatus: requireApproval ? "pending" : "approved",
    }).returning();
  }

  if (user!.isBanned) { res.status(403).json({ error: t("apiErrAccountSuspended", googleUserLang) }); return; }
  if (!user!.isActive && user!.approvalStatus !== "pending") { res.status(403).json({ error: t("apiErrAccountInactive", googleUserLang) }); return; }

  if (user!.totpEnabled && isAuthMethodEnabled(settings, "auth_2fa_enabled", user!.role ?? undefined)) {
    const trustedDays = parseInt(settings["auth_trusted_device_days"] ?? "30", 10);
    if (!isDeviceTrusted(user!, deviceFingerprint, trustedDays)) {
      const tempToken = sign2faChallengeToken(user!.id, user!.phone ?? "", user!.role ?? "customer", user!.roles ?? "customer", "social_google");
      res.json({ requires2FA: true, tempToken, userId: user!.id }); return;
    }
  }

  addAuditEntry({ action: "social_google_login", ip, details: `Google login: ${email ?? googleId}`, result: "success" });
  const result = await issueTokensForUser(user!, ip, "social_google", req.headers["user-agent"] as string);
  res.json({ ...result, isNewUser, needsProfileCompletion: isNewUser || !user!.cnic || !user!.name });
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/social/facebook
   Verify Facebook access token, match or create user, return JWT.
   Body: { accessToken, deviceFingerprint? }
══════════════════════════════════════════════════════════════ */
router.post("/social/facebook", async (req, res) => {
  const { accessToken: fbToken, deviceFingerprint } = req.body;
  const fbLang1 = await getRequestLocale(req);
  if (!fbToken) { res.status(400).json({ error: t("apiErrAccessTokenRequired", fbLang1) }); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabledStrict(settings, "auth_facebook_enabled", "auth_social_facebook")) {
    res.status(403).json({ error: t("apiErrFacebookLoginDisabled", fbLang1) }); return;
  }

  let fbPayload: { id?: string; name?: string; email?: string; picture?: { data?: { url?: string } } };
  try {
    const resp = await fetch(`https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${encodeURIComponent(fbToken)}`, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) throw new Error("Invalid token");
    fbPayload = await resp.json() as typeof fbPayload;
  } catch {
    addSecurityEvent({ type: "social_facebook_invalid_token", ip, details: "Invalid Facebook access token", severity: "medium" });
    res.status(401).json({ error: t("apiErrInvalidFacebookToken", fbLang1) }); return;
  }

  const facebookId = fbPayload.id;
  const email = fbPayload.email?.toLowerCase?.() ?? null;
  const name = fbPayload.name ?? null;
  const avatar = fbPayload.picture?.data?.url ?? null;

  if (!facebookId) { res.status(401).json({ error: t("apiErrFacebookTokenMissingId", fbLang1) }); return; }

  let [user] = await db.select().from(usersTable).where(eq(usersTable.facebookId, facebookId)).limit(1);

  if (!user && email) {
    [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (user) {
      await db.update(usersTable).set({ facebookId, updatedAt: new Date() }).where(eq(usersTable.id, user.id));
      user.facebookId = facebookId;
    }
  }

  const isNewUser = !user;

  /* ── Cross-role guard for social login ──
     If the caller specifies a role (rider/vendor), enforce that the existing account
     includes that role. Block new user creation for non-customer roles via social auth. */
  const requestedFbSocialRole = (req.body?.role as string | undefined) ?? null;
  if (requestedFbSocialRole && requestedFbSocialRole !== "customer") {
    if (user) {
      const userRoles = (user.roles || user.role || "").split(",").map((r: string) => r.trim());
      if (!userRoles.includes(requestedFbSocialRole)) {
        addSecurityEvent({ type: "cross_role_social_login_attempt", ip, details: `Social Facebook cross-role: requested=${requestedFbSocialRole} user.roles=${user.roles}`, severity: "medium" });
        res.status(403).json({ error: t("apiErrWrongAppForRole", fbLang1).replace("{role}", requestedFbSocialRole), wrongApp: true }); return;
      }
    } else {
      /* No user found — cannot auto-create non-customer accounts via social auth */
      res.status(403).json({ error: t("apiErrNoRoleAccountContact", fbLang1).replace("{role}", requestedFbSocialRole), wrongApp: true }); return;
    }
  }

  const fbEffectiveRole = user?.role ?? "customer";
  const fbUserLang = user ? await getRequestLocale(req, user.id) : fbLang1;
  if (!isAuthMethodEnabledStrict(settings, "auth_facebook_enabled", "auth_social_facebook", fbEffectiveRole)) {
    res.status(403).json({ error: t("apiErrFacebookLoginAccountDisabled", fbUserLang) }); return;
  }

  if (!user) {
    if (settings["feature_new_users"] === "off") {
      res.status(403).json({ error: t("apiErrRegistrationDisabled", fbLang1) }); return;
    }
    const requireApproval = settings["user_require_approval"] === "on";
    const id = generateId();
    [user] = await db.insert(usersTable).values({
      id, name, email, avatar, facebookId,
      role: "customer", roles: "customer", walletBalance: "0",
      emailVerified: !!email,
      isActive: !requireApproval, approvalStatus: requireApproval ? "pending" : "approved",
    }).returning();
  }

  if (user!.isBanned) { res.status(403).json({ error: t("apiErrAccountSuspended", fbUserLang) }); return; }
  if (!user!.isActive && user!.approvalStatus !== "pending") { res.status(403).json({ error: t("apiErrAccountInactive", fbUserLang) }); return; }

  if (user!.totpEnabled && isAuthMethodEnabled(settings, "auth_2fa_enabled", user!.role ?? undefined)) {
    const trustedDays = parseInt(settings["auth_trusted_device_days"] ?? "30", 10);
    if (!isDeviceTrusted(user!, deviceFingerprint, trustedDays)) {
      const tempToken = sign2faChallengeToken(user!.id, user!.phone ?? "", user!.role ?? "customer", user!.roles ?? "customer", "social_facebook");
      res.json({ requires2FA: true, tempToken, userId: user!.id }); return;
    }
  }

  addAuditEntry({ action: "social_facebook_login", ip, details: `Facebook login: ${email ?? facebookId}`, result: "success" });
  const result = await issueTokensForUser(user!, ip, "social_facebook", req.headers["user-agent"] as string);
  res.json({ ...result, isNewUser, needsProfileCompletion: isNewUser || !user!.cnic || !user!.name });
});

/* ══════════════════════════════════════════════════════════════
   GET /auth/2fa/setup
   Generate TOTP secret + QR code URI. Requires valid JWT.
══════════════════════════════════════════════════════════════ */
router.get("/2fa/setup", async (req, res) => {
  const auth = extractAuthUser(req);
  if (!auth) { res.status(401).json({ error: t("apiErrAuthRequired", parseAcceptLanguage(req.headers["accept-language"] as string | undefined) ?? "en") }); return; }

  const settings = await getCachedSettings();
  const twoFaLang = await getRequestLocale(req, auth.userId);

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  if (!user) { res.status(404).json({ error: t("apiErrUserNotFound", twoFaLang) }); return; }

  if (!isAuthMethodEnabled(settings, "auth_2fa_enabled", user.role ?? undefined)) {
    res.status(403).json({ error: t("apiErr2faDisabled", twoFaLang) }); return;
  }
  if (user.totpEnabled) { res.status(409).json({ error: t("apiErr2faAlreadyEnabled", twoFaLang) }); return; }

  const secret = generateTotpSecret();
  const label = user.email ?? user.phone ?? user.name ?? auth.userId;
  const uri = getTotpUri(secret, label);

  const encryptedSecret = encryptTotpSecret(secret);
  await db.update(usersTable).set({ totpSecret: encryptedSecret, updatedAt: new Date() }).where(eq(usersTable.id, auth.userId));

  let qrDataUrl: string | null = null;
  try { qrDataUrl = await generateQRCodeDataURL(secret, label); } catch (err) { console.error("[2fa/setup] QR code generation failed:", err); }

  res.json({ secret, uri, qrDataUrl });
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/2fa/verify-setup
   Confirm first TOTP code, activate 2FA, return backup codes.
   Body: { code }
══════════════════════════════════════════════════════════════ */
router.post("/2fa/verify-setup", async (req, res) => {
  const auth = extractAuthUser(req);
  if (!auth) { res.status(401).json({ error: t("apiErrAuthRequired", parseAcceptLanguage(req.headers["accept-language"] as string | undefined) ?? "en") }); return; }

  const { code } = req.body;
  const verifySetupLang = await getRequestLocale(req, auth.userId);
  if (!code) { res.status(400).json({ error: t("apiErrTotpCodeRequired", verifySetupLang) }); return; }

  const settings = await getCachedSettings();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  if (!user) { res.status(404).json({ error: t("apiErrUserNotFound", verifySetupLang) }); return; }

  if (!isAuthMethodEnabled(settings, "auth_2fa_enabled", user.role ?? undefined)) {
    res.status(403).json({ error: t("apiErr2faDisabled", verifySetupLang) }); return;
  }
  if (user.totpEnabled) { res.status(409).json({ error: t("apiErr2faAlreadyEnabled", verifySetupLang) }); return; }
  if (!user.totpSecret) { res.status(400).json({ error: t("apiErr2faSetupFirst", verifySetupLang) }); return; }

  const secret = decryptTotpSecret(user.totpSecret);
  if (!verifyTotpToken(code, secret)) {
    res.status(401).json({ error: t("apiErrInvalidTotpCode", verifySetupLang) }); return;
  }

  const backupCodes: string[] = [];
  const hashedCodes: string[] = [];
  for (let i = 0; i < 8; i++) {
    const raw = crypto.randomBytes(4).toString("hex");
    backupCodes.push(raw);
    hashedCodes.push(hashPassword(raw));
  }

  await db.update(usersTable).set({
    totpEnabled: true,
    backupCodes: JSON.stringify(hashedCodes),
    updatedAt: new Date(),
  }).where(eq(usersTable.id, auth.userId));

  const ip = getClientIp(req);
  writeAuthAuditLog("2fa_enabled", { userId: auth.userId, ip, userAgent: req.headers["user-agent"] as string });
  addAuditEntry({ action: "2fa_enabled", ip, details: `2FA enabled for user ${auth.userId}`, result: "success" });

  res.json({ success: true, backupCodes, message: "2FA activated. Save your backup codes securely — they cannot be shown again." });
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/2fa/verify
   Verify TOTP code during login flow.
   Body: { tempToken, code, deviceFingerprint? }
══════════════════════════════════════════════════════════════ */
router.post("/2fa/verify", async (req, res) => {
  const { tempToken, code, deviceFingerprint } = req.body;
  const twoFaVerifyLang1 = await getRequestLocale(req);
  if (!tempToken || !code) { res.status(400).json({ error: t("apiErrTempTokenAndCodeRequired", twoFaVerifyLang1) }); return; }

  const challengePayload = verify2faChallengeToken(tempToken);
  if (!challengePayload) { res.status(401).json({ error: t("apiErrInvalidExpired2faToken", twoFaVerifyLang1) }); return; }

  const settings = await getCachedSettings();
  const ip = getClientIp(req);

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, challengePayload.userId)).limit(1);
  const twoFaVerifyLang = user ? await getRequestLocale(req, user.id) : twoFaVerifyLang1;
  if (!user) { res.status(404).json({ error: t("apiErrUserNotFound", twoFaVerifyLang1) }); return; }

  if (!isAuthMethodEnabled(settings, "auth_2fa_enabled", user.role ?? undefined)) {
    res.status(403).json({ error: t("apiErr2faDisabledAdmin", twoFaVerifyLang) }); return;
  }

  if (!user.totpEnabled || !user.totpSecret) { res.status(400).json({ error: t("apiErr2faNotEnabled", twoFaVerifyLang) }); return; }

  const secret = decryptTotpSecret(user.totpSecret);
  if (!verifyTotpToken(code, secret)) {
    addSecurityEvent({ type: "2fa_verify_failed", ip, userId: user.id, details: "Invalid 2FA code on login", severity: "medium" });
    res.status(401).json({ error: t("apiErrInvalid2faCode", twoFaVerifyLang) }); return;
  }

  writeAuthAuditLog("2fa_verified", { userId: user.id, ip, userAgent: req.headers["user-agent"] as string });
  const originalMethod = challengePayload.authMethod ?? "phone_otp";
  const result = await issueTokensForUser(user, ip, originalMethod, req.headers["user-agent"] as string);
  res.json(result);
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/2fa/disable
   Disable 2FA for the authenticated user. Body: { code }
══════════════════════════════════════════════════════════════ */
router.post("/2fa/disable", async (req, res) => {
  const auth = extractAuthUser(req);
  if (!auth) { res.status(401).json({ error: t("apiErrAuthRequired", parseAcceptLanguage(req.headers["accept-language"] as string | undefined) ?? "en") }); return; }

  const { code } = req.body;
  const disableLang = await getRequestLocale(req, auth.userId);
  if (!code) { res.status(400).json({ error: t("apiErrTotpCodeRequiredDisable", disableLang) }); return; }

  const settings = await getCachedSettings();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  if (!user) { res.status(404).json({ error: t("apiErrUserNotFound", disableLang) }); return; }

  if (!isAuthMethodEnabled(settings, "auth_2fa_enabled", user.role ?? undefined)) {
    res.status(403).json({ error: t("apiErr2faDisabledAdmin", disableLang) }); return;
  }

  if (!user.totpEnabled || !user.totpSecret) { res.status(400).json({ error: t("apiErr2faNotEnabled", disableLang) }); return; }

  const secret = decryptTotpSecret(user.totpSecret);
  if (!verifyTotpToken(code, secret)) {
    res.status(401).json({ error: t("apiErrInvalidTotpCode", disableLang) }); return;
  }

  await db.update(usersTable).set({
    totpEnabled: false, totpSecret: null, backupCodes: null, trustedDevices: null, updatedAt: new Date(),
  }).where(eq(usersTable.id, auth.userId));

  const ip = getClientIp(req);
  writeAuthAuditLog("2fa_disabled", { userId: auth.userId, ip, userAgent: req.headers["user-agent"] as string });
  addAuditEntry({ action: "2fa_disabled", ip, details: `2FA disabled by user ${auth.userId}`, result: "success" });

  res.json({ success: true, message: "Two-factor authentication has been disabled" });
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/2fa/recovery
   Use a single-use backup code. Body: { tempToken, backupCode }
══════════════════════════════════════════════════════════════ */
router.post("/2fa/recovery", async (req, res) => {
  const { tempToken, backupCode } = req.body;
  const recoveryLang1 = await getRequestLocale(req);
  if (!tempToken || !backupCode) { res.status(400).json({ error: t("apiErrTempTokenAndBackupRequired", recoveryLang1) }); return; }

  const challengePayload = verify2faChallengeToken(tempToken);
  if (!challengePayload) { res.status(401).json({ error: t("apiErrInvalidExpired2faToken", recoveryLang1) }); return; }

  const ip = getClientIp(req);

  const settings = await getCachedSettings();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, challengePayload.userId)).limit(1);
  const recoveryLang = user ? await getRequestLocale(req, user.id) : recoveryLang1;
  if (!user) { res.status(404).json({ error: t("apiErrUserNotFound", recoveryLang1) }); return; }

  if (!isAuthMethodEnabled(settings, "auth_2fa_enabled", user.role ?? undefined)) {
    res.status(403).json({ error: t("apiErr2faDisabledAdmin", recoveryLang) }); return;
  }

  if (!user.totpEnabled || !user.backupCodes) { res.status(400).json({ error: t("apiErr2faNoBackupCodes", recoveryLang) }); return; }

  let storedCodes: string[];
  try { storedCodes = JSON.parse(user.backupCodes); } catch { res.status(500).json({ error: t("apiErrInternal", recoveryLang) }); return; }

  let matchIdx = -1;
  for (let i = 0; i < storedCodes.length; i++) {
    if (verifyPassword(backupCode, storedCodes[i]!)) { matchIdx = i; break; }
  }

  if (matchIdx === -1) {
    addSecurityEvent({ type: "2fa_recovery_failed", ip, userId: user.id, details: "Invalid backup code attempt", severity: "high" });
    res.status(401).json({ error: t("apiErrInvalidBackupCode", recoveryLang) }); return;
  }

  storedCodes.splice(matchIdx, 1);
  await db.update(usersTable).set({ backupCodes: JSON.stringify(storedCodes), updatedAt: new Date() }).where(eq(usersTable.id, user.id));

  writeAuthAuditLog("2fa_recovery_used", { userId: user.id, ip, userAgent: req.headers["user-agent"] as string, metadata: { codesRemaining: storedCodes.length } });
  addAuditEntry({ action: "2fa_recovery_used", ip, details: `Backup code used for user ${user.id}, ${storedCodes.length} codes remaining`, result: "success" });

  const recoveryOrigMethod = challengePayload.authMethod ?? "phone_otp";
  const result = await issueTokensForUser(user, ip, recoveryOrigMethod, req.headers["user-agent"] as string);
  res.json({ ...result, codesRemaining: storedCodes.length });
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/2fa/trust-device
   Store device fingerprint for trusted device bypass.
   Body: { deviceFingerprint }
══════════════════════════════════════════════════════════════ */
router.post("/2fa/trust-device", async (req, res) => {
  const auth = extractAuthUser(req);
  if (!auth) { res.status(401).json({ error: t("apiErrAuthRequired", parseAcceptLanguage(req.headers["accept-language"] as string | undefined) ?? "en") }); return; }

  const { deviceFingerprint } = req.body;
  const trustDeviceLang = await getRequestLocale(req, auth.userId);
  if (!deviceFingerprint || typeof deviceFingerprint !== "string" || deviceFingerprint.length < 8) {
    res.status(400).json({ error: t("apiErrDeviceFingerprintRequired", trustDeviceLang) }); return;
  }

  const settings = await getCachedSettings();
  const trustedDays = parseInt(settings["auth_trusted_device_days"] ?? "30", 10);

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  if (!user) { res.status(404).json({ error: t("apiErrUserNotFound", trustDeviceLang) }); return; }

  if (!isAuthMethodEnabled(settings, "auth_2fa_enabled", user.role ?? undefined)) {
    res.status(403).json({ error: t("apiErr2faDisabledAdmin", trustDeviceLang) }); return;
  }

  if (!user.totpEnabled) { res.status(400).json({ error: t("apiErr2faNotEnabled", trustDeviceLang) }); return; }

  let devices: Array<{ fp: string; expiresAt: number }> = [];
  try { if (user.trustedDevices) devices = JSON.parse(user.trustedDevices); } catch {}

  const now = Date.now();
  devices = devices.filter(d => d.expiresAt > now && d.fp !== deviceFingerprint);
  devices.push({ fp: deviceFingerprint, expiresAt: now + trustedDays * 24 * 60 * 60 * 1000 });

  if (devices.length > 10) devices = devices.slice(-10);

  await db.update(usersTable).set({ trustedDevices: JSON.stringify(devices), updatedAt: new Date() }).where(eq(usersTable.id, auth.userId));

  const ip = getClientIp(req);
  writeAuthAuditLog("device_trusted", { userId: auth.userId, ip, userAgent: req.headers["user-agent"] as string });

  res.json({ success: true, message: `Device trusted for ${trustedDays} days`, trustedDevices: devices.length });
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/magic-link/send
   Send a magic link to the user's email. Rate limited: 3 per email per 10 min.
   Body: { email }
══════════════════════════════════════════════════════════════ */
const magicLinkRateMap = new Map<string, { count: number; windowStart: number }>();

router.post("/magic-link/send", async (req, res) => {
  const { email } = req.body;
  const mlSendLang1 = await getRequestLocale(req);
  if (!email || !email.includes("@")) { res.status(400).json({ error: t("apiErrValidEmailRequired", mlSendLang1) }); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabledStrict(settings, "auth_magic_link_enabled", "auth_magic_link")) {
    res.status(403).json({ error: t("apiErrMagicLinkDisabled", mlSendLang1) }); return;
  }

  const normalized = email.toLowerCase().trim();

  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const rlKey = `ml:${normalized}`;
  const rl = magicLinkRateMap.get(rlKey);
  if (rl && now - rl.windowStart < windowMs) {
    if (rl.count >= 3) {
      const waitMin = Math.ceil((rl.windowStart + windowMs - now) / 60000);
      res.status(429).json({ error: t("apiErrTooManyMagicLinks", mlSendLang1).replace("{minutes}", String(waitMin)) }); return;
    }
    rl.count++;
  } else {
    magicLinkRateMap.set(rlKey, { count: 1, windowStart: now });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
  if (!user) {
    res.json({ message: "If an account exists with this email, a magic link has been sent." }); return;
  }

  const mlSendUserLang = await getRequestLocale(req, user.id);
  const effectiveMagicRole = user.role ?? ((req.body?.role === "rider" || req.body?.role === "vendor") ? req.body.role : "customer");
  if (!isAuthMethodEnabledStrict(settings, "auth_magic_link_enabled", "auth_magic_link", effectiveMagicRole)) {
    res.status(403).json({ error: t("apiErrMagicLinkAccountDisabled", mlSendUserLang) }); return;
  }

  if (user.isBanned) { res.status(403).json({ error: t("apiErrAccountSuspended", mlSendUserLang) }); return; }
  if (!user.isActive) { res.status(403).json({ error: t("apiErrAccountInactive", mlSendUserLang) }); return; }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashPassword(rawToken);
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SEC * 1000);

  await db.insert(magicLinkTokensTable).values({
    id: generateId(),
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  const magicLinkLang = await getUserLanguage(user.id);
  await sendMagicLinkEmail(normalized, rawToken, settings, magicLinkLang);

  addAuditEntry({ action: "magic_link_sent", ip, details: `Magic link sent to: ${normalized}`, result: "success" });
  writeAuthAuditLog("magic_link_sent", { ip, metadata: { email: normalized } });

  const isDev = process.env.NODE_ENV !== "production";
  res.json({
    message: "If an account exists with this email, a magic link has been sent.",
    ...(isDev ? { token: rawToken } : {}),
  });
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/magic-link/verify
   Validate magic link token, handle 2FA guard.
   Body: { token, totpCode?, deviceFingerprint? }
══════════════════════════════════════════════════════════════ */
router.post("/magic-link/verify", async (req, res) => {
  const { token, totpCode, deviceFingerprint } = req.body;
  const mlVerifyLang1 = await getRequestLocale(req);
  if (!token) { res.status(400).json({ error: t("apiErrTokenRequired", mlVerifyLang1) }); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabledStrict(settings, "auth_magic_link_enabled", "auth_magic_link")) {
    res.status(403).json({ error: t("apiErrMagicLinkDisabled", mlVerifyLang1) }); return;
  }

  const allTokens = await db.select().from(magicLinkTokensTable)
    .where(sql`${magicLinkTokensTable.usedAt} IS NULL AND ${magicLinkTokensTable.expiresAt} > now()`)
    .limit(50);

  let matchedRow: typeof allTokens[0] | null = null;
  for (const row of allTokens) {
    if (verifyPassword(token, row.tokenHash)) { matchedRow = row; break; }
  }

  if (!matchedRow) {
    addSecurityEvent({ type: "magic_link_invalid", ip, details: "Invalid or expired magic link token", severity: "medium" });
    res.status(401).json({ error: t("apiErrInvalidOrExpiredMagicLink", mlVerifyLang1) }); return;
  }

  await db.update(magicLinkTokensTable).set({ usedAt: new Date() }).where(eq(magicLinkTokensTable.id, matchedRow.id));

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, matchedRow.userId)).limit(1);
  const mlVerifyUserLang = user ? await getRequestLocale(req, user.id) : mlVerifyLang1;
  if (!user) { res.status(404).json({ error: t("apiErrUserNotFound", mlVerifyLang1) }); return; }
  if (user.isBanned) { res.status(403).json({ error: t("apiErrAccountSuspended", mlVerifyUserLang) }); return; }
  if (!user.isActive) { res.status(403).json({ error: t("apiErrAccountInactive", mlVerifyUserLang) }); return; }

  if (!isAuthMethodEnabledStrict(settings, "auth_magic_link_enabled", "auth_magic_link", user.role ?? "customer")) {
    res.status(403).json({ error: t("apiErrMagicLinkAccountDisabled", mlVerifyUserLang) }); return;
  }

  if (user.totpEnabled && isAuthMethodEnabled(settings, "auth_2fa_enabled", user.role ?? undefined)) {
    const trustedDays = parseInt(settings["auth_trusted_device_days"] ?? "30", 10);
    if (!isDeviceTrusted(user, deviceFingerprint ?? "", trustedDays)) {
      if (!totpCode) {
        const tempToken = sign2faChallengeToken(user.id, user.phone ?? "", user.role ?? "customer", user.roles ?? "customer", "magic_link");
        res.json({ requires2FA: true, tempToken, userId: user.id }); return;
      }
      const secret = decryptTotpSecret(user.totpSecret!);
      if (!verifyTotpToken(totpCode, secret)) {
        res.status(401).json({ error: t("apiErrInvalid2faCode", mlVerifyUserLang) }); return;
      }
    }
  }

  await db.update(usersTable).set({ emailVerified: true, updatedAt: new Date() }).where(eq(usersTable.id, user.id));

  addAuditEntry({ action: "magic_link_login", ip, details: `Magic link login: ${user.email ?? matchedRow.userId}`, result: "success" });
  const result = await issueTokensForUser(user, ip, "magic_link", req.headers["user-agent"] as string);
  res.json(result);
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/change-phone/request
   Send OTP to a new phone number for phone change flow.
   Body: { newPhone }
══════════════════════════════════════════════════════════════ */
router.post("/change-phone/request", async (req, res) => {
  const auth = extractAuthUser(req);
  if (!auth) { res.status(401).json({ error: t("apiErrAuthRequired", parseAcceptLanguage(req.headers["accept-language"] as string | undefined) ?? "en") }); return; }

  const { newPhone } = req.body;
  const chPhoneLang = await getRequestLocale(req, auth.userId);
  if (!newPhone || typeof newPhone !== "string") {
    res.status(400).json({ error: t("apiErrNewPhoneRequired", chPhoneLang) }); return;
  }

  const phone = canonicalizePhone(newPhone);
  if (!phone) {
    res.status(400).json({ error: t("apiErrInvalidPhone", chPhoneLang) }); return;
  }

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
  if (existing) {
    res.status(409).json({ error: t("apiErrPhoneAlreadyRegistered", chPhoneLang) }); return;
  }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();
  const otp = generateSecureOtp();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

  await db.update(usersTable).set({
    mergeOtpCode: hashOtp(otp),
    mergeOtpExpiry: otpExpiry,
    pendingMergeIdentifier: phone,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, auth.userId));

  const lang = await getUserLanguage(auth.userId);
  const whatsappEnabled = settings["integration_whatsapp"] === "on";
  let sent = false;
  if (whatsappEnabled) {
    const waResult = await sendWhatsAppOTP(phone, otp, settings, lang);
    if (waResult.sent) sent = true;
  }
  if (!sent) {
    await sendOtpSMS(phone, otp, settings, lang);
  }

  writeAuthAuditLog("phone_change_requested", { userId: auth.userId, ip, userAgent: req.headers["user-agent"] as string, metadata: { newPhone: phone } });

  res.json({ success: true, message: "OTP sent to new phone number" });
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/change-phone/confirm
   Verify OTP and update phone number.
   Body: { newPhone, otp }
══════════════════════════════════════════════════════════════ */
router.post("/change-phone/confirm", async (req, res) => {
  const auth = extractAuthUser(req);
  if (!auth) { res.status(401).json({ error: t("apiErrAuthRequired", parseAcceptLanguage(req.headers["accept-language"] as string | undefined) ?? "en") }); return; }

  const { newPhone, otp } = req.body;
  const chPhoneConfLang = await getRequestLocale(req, auth.userId);
  if (!newPhone || !otp) {
    res.status(400).json({ error: t("apiErrPhoneAndOtpRequired", chPhoneConfLang) }); return;
  }

  const phone = canonicalizePhone(newPhone);
  if (!phone) { res.status(400).json({ error: t("apiErrInvalidPhone", chPhoneConfLang) }); return; }
  const ip = getClientIp(req);

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  if (!user) { res.status(404).json({ error: t("apiErrUserNotFound", chPhoneConfLang) }); return; }

  if (user.pendingMergeIdentifier !== phone) {
    res.status(400).json({ error: t("apiErrOtpNotRequestedForPhone", chPhoneConfLang) }); return;
  }

  if (user.mergeOtpCode !== hashOtp(otp) || !user.mergeOtpExpiry || user.mergeOtpExpiry < new Date()) {
    res.status(400).json({ error: t("apiErrInvalidOrExpiredOtp", chPhoneConfLang) }); return;
  }

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
  if (existing) {
    res.status(409).json({ error: t("apiErrPhoneAlreadyRegistered", chPhoneConfLang) }); return;
  }

  await db.update(usersTable).set({
    phone,
    phoneVerified: true,
    mergeOtpCode: null,
    mergeOtpExpiry: null,
    pendingMergeIdentifier: null,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, auth.userId));

  writeAuthAuditLog("phone_changed", { userId: auth.userId, ip, userAgent: req.headers["user-agent"] as string, metadata: { newPhone: phone } });

  res.json({ success: true, message: "Phone number updated successfully", phone });
});

/* ══════════════════════════════════════════════════════════════
   GET /auth/login-history
   Return last 20 login attempts for authenticated user.
══════════════════════════════════════════════════════════════ */
router.get("/login-history", async (req, res) => {
  const auth = extractAuthUser(req);
  if (!auth) { res.status(401).json({ error: t("apiErrAuthRequired", parseAcceptLanguage(req.headers["accept-language"] as string | undefined) ?? "en") }); return; }

  const history = await db.select().from(loginHistoryTable)
    .where(eq(loginHistoryTable.userId, auth.userId))
    .orderBy(desc(loginHistoryTable.createdAt))
    .limit(20);

  res.json({
    history: history.map(h => ({
      id: h.id,
      ip: h.ip,
      deviceName: h.deviceName,
      browser: h.browser,
      os: h.os,
      location: h.location,
      success: h.success,
      method: h.method,
      createdAt: h.createdAt.toISOString(),
    })),
  });
});

export default router;
