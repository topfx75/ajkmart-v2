import { Router, type IRouter, type Request } from "express";
import crypto from "crypto";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable, notificationsTable, refreshTokensTable, magicLinkTokensTable } from "@workspace/db/schema";
import { eq, and, sql, lt, or } from "drizzle-orm";
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
  verifyCaptcha,
  checkAvailableRateLimit,
} from "../middleware/security.js";
import { sendOtpSMS } from "../services/sms.js";
import { sendWhatsAppOTP } from "../services/whatsapp.js";
import { randomBytes, createHash } from "crypto";
import { hashPassword, verifyPassword, validatePasswordStrength, generateSecureOtp } from "../services/password.js";
import { generateTotpSecret, verifyTotpToken, generateQRCodeDataURL, getTotpUri, encryptTotpSecret, decryptTotpSecret } from "../services/totp.js";
import { sendVerificationEmail, sendPasswordResetEmail, sendMagicLinkEmail } from "../services/email.js";
import { getUserLanguage, getPlatformDefaultLanguage } from "../lib/getUserLanguage.js";
import { t, type TranslationKey } from "@workspace/i18n";

function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}

function generateVerificationToken(): string {
  return randomBytes(32).toString("hex");
}

function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Canonical Pakistani mobile phone normalizer.
 * Returns 10-digit format: `3xxxxxxxxx` (no leading zero, no country code).
 * Accepts: 03..., 3..., +923..., 923...
 * This matches the client-side normalizePhone() in utils/phone.ts.
 */
function canonicalizePhone(raw: string): string {
  const cleaned = raw.replace(/[\s\-()]/g, "");
  const e164Match = cleaned.match(/^\+?92(3\d{9})$/);
  if (e164Match) return e164Match[1]!;
  const localMatch = cleaned.match(/^0(3\d{9})$/);
  if (localMatch) return localMatch[1]!;
  return cleaned;
}

const router: IRouter = Router();

/* ══════════════════════════════════════════════════════════════
   POST /auth/check-identifier
   Unified Auth Gatekeeper — Account Discovery.
   Step 1 of the smart "Continue" login flow.
   Body: { identifier: string, role?: string, deviceId?: string }
   Returns what the client should do next: action + available methods.
══════════════════════════════════════════════════════════════ */
router.post("/check-identifier", async (req, res) => {
  const { identifier, role, deviceId } = req.body ?? {};
  if (!identifier || typeof identifier !== "string") {
    res.status(400).json({ error: "identifier is required" });
    return;
  }

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

  /* ── If user is banned or locked, surface it early ── */
  if (user?.isBanned) {
    addSecurityEvent({ type: "banned_user_identifier_check", ip, userId: user.id, details: `Banned user check: ${identifier}`, severity: "medium" });
    res.json({ isNewUser: false, isBanned: true, action: "blocked", availableMethods: [] });
    return;
  }

  const maxAttempts    = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);
  const lockoutKey     = looksLikePhone ? canonicalizePhone(identifier) : identifier.trim();
  const lockout        = await checkLockout(lockoutKey, maxAttempts, lockoutMinutes);
  if (lockout.locked) {
    res.json({ isNewUser: false, isLocked: true, lockedMinutes: lockout.minutesLeft, action: "locked", availableMethods: [] });
    return;
  }

  /* ── Device fingerprint abuse check ── */
  let deviceFlagged = false;
  const DEVICE_ACCOUNT_THRESHOLD = 5;
  if (deviceId && isNewUser) {
    const deviceAccounts = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.deviceId, deviceId))
      .limit(DEVICE_ACCOUNT_THRESHOLD + 1);
    if (deviceAccounts.length >= DEVICE_ACCOUNT_THRESHOLD) {
      deviceFlagged = true;
      addSecurityEvent({
        type: "device_multi_account_flag",
        ip,
        details: `Device ${deviceId} has ${deviceAccounts.length} accounts — registration flagged`,
        severity: "high",
      });
    }
  }

  /* ── Build available methods based on admin config + actual role ── */
  const effectiveCheckRole = user?.role ?? userRole;
  const googleEnabled   = isAuthMethodEnabled(settings, "auth_google_enabled", effectiveCheckRole);
  const facebookEnabled = isAuthMethodEnabled(settings, "auth_facebook_enabled", effectiveCheckRole);
  const phoneOtpEnabled = isAuthMethodEnabled(settings, "auth_phone_otp_enabled", effectiveCheckRole);
  const emailOtpEnabled = isAuthMethodEnabled(settings, "auth_email_otp_enabled", effectiveCheckRole);
  const passwordEnabled = isAuthMethodEnabled(settings, "auth_username_password_enabled", effectiveCheckRole);
  const magicLinkEnabled = isAuthMethodEnabled(settings, "auth_magic_link_enabled", effectiveCheckRole);

  const availableMethods: string[] = [];
  if (phoneOtpEnabled)  availableMethods.push("phone_otp");
  if (emailOtpEnabled)  availableMethods.push("email_otp");
  if (passwordEnabled)  availableMethods.push("password");
  if (googleEnabled)    availableMethods.push("google");
  if (facebookEnabled)  availableMethods.push("facebook");
  if (magicLinkEnabled) availableMethods.push("magic_link");

  /* ── For EXISTING users: determine the best/enforced action ── */
  let action: string;
  const hasGoogle   = !!(user?.googleId);
  const hasFacebook = !!(user?.facebookId);

  const usableMethods = availableMethods.filter(m => {
    if (m === "password") return !!user?.passwordHash;
    return true;
  });

  const profileIncomplete = exists && (!user?.name || user.name === "User" || user.name === "Pending") && !user?.passwordHash;

  if (exists && profileIncomplete) {
    action = "register";
  } else if (exists) {
    if (hasGoogle && googleEnabled) {
      action = "force_google";
    } else if (hasFacebook && facebookEnabled && !hasGoogle) {
      action = "force_facebook";
    } else if (looksLikePhone && phoneOtpEnabled) {
      action = "send_phone_otp";
    } else if (looksLikeEmail && emailOtpEnabled) {
      action = "send_email_otp";
    } else if (looksLikeEmail && magicLinkEnabled) {
      action = "send_magic_link";
    } else if (passwordEnabled && user?.passwordHash) {
      action = "login_password";
    } else if (phoneOtpEnabled) {
      action = "send_phone_otp";
    } else if (usableMethods.length > 0) {
      const first = usableMethods[0]!;
      action = first === "password" ? "login_password" : first === "phone_otp" ? "send_phone_otp" : first === "email_otp" ? "send_email_otp" : first === "magic_link" ? "send_magic_link" : "no_method";
    } else {
      action = "no_method";
    }
  } else {
    action = registrationOpen ? "register" : "registration_closed";
  }

  const whatsappOn = settings["integration_whatsapp"] === "on";
  const smsOn      = isAuthMethodEnabled(settings, "auth_phone_otp_enabled", effectiveCheckRole);
  const emailOn    = isAuthMethodEnabled(settings, "auth_email_otp_enabled", effectiveCheckRole);
  const otpChannels: string[] = [];
  if (whatsappOn)  otpChannels.push("whatsapp");
  if (smsOn)       otpChannels.push("sms");
  if (emailOn && user?.email) otpChannels.push("email");

  const canMerge = !exists && (looksLikePhone || looksLikeEmail);

  res.json({
    exists,
    isNewUser: isNewUser || profileIncomplete,
    registrationOpen,
    action,
    profileIncomplete: !!profileIncomplete,
    availableMethods: exists ? usableMethods : availableMethods,
    hasGoogle,
    hasFacebook,
    hasPhone: !!user?.phone,
    hasEmail: !!user?.email,
    requiresPhoneVerification: exists && !user?.phoneVerified,
    deviceFlagged,
    isBanned:  false,
    isLocked:  false,
    otpChannels,
    canMerge,
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
  if (!auth) { res.status(401).json({ error: "Authentication required" }); return; }

  const { identifier } = req.body;
  if (!identifier) { res.status(400).json({ error: "Identifier is required" }); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  const looksLikePhone = /^[\d\s\-+()]{7,15}$/.test(identifier.trim());
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim());

  if (!looksLikePhone && !looksLikeEmail) {
    res.status(400).json({ error: "Identifier must be a phone number or email address" });
    return;
  }

  if (looksLikePhone) {
    const phone = canonicalizePhone(identifier);
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
    if (existing) { res.status(409).json({ error: "This phone number is already linked to another account" }); return; }
  } else {
    const email = identifier.trim().toLowerCase();
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing) { res.status(409).json({ error: "This email is already linked to another account" }); return; }
  }

  const otp = generateSecureOtp();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
  const normalizedIdentifier = looksLikePhone ? canonicalizePhone(identifier) : identifier.trim().toLowerCase();
  await db.update(usersTable).set({ mergeOtpCode: hashOtp(otp), mergeOtpExpiry: otpExpiry, pendingMergeIdentifier: normalizedIdentifier, updatedAt: new Date() }).where(eq(usersTable.id, auth.userId));

  if (looksLikePhone) {
    const phone = canonicalizePhone(identifier);
    const lang = await getUserLanguage(auth.userId);
    const whatsappEnabled = settings["integration_whatsapp"] === "on";
    let sent = false;
    if (whatsappEnabled) {
      const waResult = await sendWhatsAppOTP(phone, otp, settings, lang);
      if (waResult.sent) sent = true;
    }
    if (!sent) {
      const smsResult = await sendOtpSMS(phone, otp, settings, lang);
      sent = smsResult.sent;
    }
    const isDev = process.env.NODE_ENV !== "production";
    res.json({ message: "OTP sent to phone" });
  } else {
    const email = identifier.trim().toLowerCase();
    const lang = await getUserLanguage(auth.userId);
    const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
    await sendPasswordResetEmail(email, otp, user?.name ?? undefined, lang);
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
  if (!auth) { res.status(401).json({ error: "Authentication required" }); return; }

  const { identifier, otp } = req.body;
  if (!identifier || !otp) { res.status(400).json({ error: "Identifier and OTP are required" }); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  const looksLikePhone = /^[\d\s\-+()]{7,15}$/.test(identifier.trim());
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim());

  if (!looksLikePhone && !looksLikeEmail) {
    res.status(400).json({ error: "Identifier must be a phone number or email address" });
    return;
  }

  const [currentUser] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  if (!currentUser) { res.status(404).json({ error: "User not found" }); return; }

  const normalizedIdentifier = looksLikePhone ? canonicalizePhone(identifier) : identifier.trim().toLowerCase();

  if (currentUser.mergeOtpCode !== hashOtp(otp) || !currentUser.mergeOtpExpiry || currentUser.mergeOtpExpiry < new Date()) {
    res.status(400).json({ error: "Invalid or expired OTP" });
    return;
  }

  if (currentUser.pendingMergeIdentifier !== normalizedIdentifier) {
    res.status(400).json({ error: "OTP was not issued for this identifier" });
    return;
  }

  if (looksLikePhone) {
    const phone = normalizedIdentifier;
    if (currentUser.phone === phone) { res.status(400).json({ error: "This phone is already linked to your account" }); return; }

    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
    if (existing) { res.status(409).json({ error: "This phone number is already linked to another account" }); return; }

    await db.update(usersTable).set({ phone, mergeOtpCode: null, mergeOtpExpiry: null, phoneVerified: true, pendingMergeIdentifier: null, updatedAt: new Date() }).where(eq(usersTable.id, auth.userId));

    writeAuthAuditLog("account_merge_phone", { ip, userId: auth.userId, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone } });
    res.json({ success: true, message: "Phone number linked successfully", linked: "phone" });
  } else {
    const email = normalizedIdentifier;
    if (currentUser.email === email) { res.status(400).json({ error: "This email is already linked to your account" }); return; }

    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing) { res.status(409).json({ error: "This email is already linked to another account" }); return; }

    await db.update(usersTable).set({ email, mergeOtpCode: null, mergeOtpExpiry: null, emailVerified: true, pendingMergeIdentifier: null, updatedAt: new Date() }).where(eq(usersTable.id, auth.userId));

    writeAuthAuditLog("account_merge_email", { ip, userId: auth.userId, userAgent: req.headers["user-agent"] ?? undefined, metadata: { email } });
    res.json({ success: true, message: "Email linked successfully", linked: "email" });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /auth/send-otp
   Atomically upsert user by phone — one account per number.
───────────────────────────────────────────────────────────── */
router.post("/send-otp", verifyCaptcha, async (req, res) => {
  const rawPhone = req.body?.phone;
  const deviceId: string | undefined = typeof req.body?.deviceId === "string" ? req.body.deviceId : undefined;
  const preferredChannel: string | undefined = req.body?.preferredChannel;
  if (!rawPhone) {
    res.status(400).json({ error: "Phone number is required" });
    return;
  }
  const phone = canonicalizePhone(rawPhone);

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  const otpEnabled = isAuthMethodEnabled(settings, "auth_phone_otp_enabled");

  /* ── Check if new-user registration is allowed ── */
  const existingUser = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.phone, phone))
    .limit(1);

  const effectiveRole = existingUser[0]?.role ?? ((req.body?.role === "rider" || req.body?.role === "vendor") ? req.body.role : "customer");
  const otpEnabledForRole = isAuthMethodEnabled(settings, "auth_phone_otp_enabled", effectiveRole);

  if (existingUser.length === 0 && settings["feature_new_users"] === "off") {
    res.status(403).json({ error: "New user registration is currently disabled. Please contact support." });
    return;
  }

  /* ── Phone verify flag: when ON, OTP bypass is disabled globally ──
     Enforcement happens in verify-otp; nothing to gate at send-otp. ── */

  /* ── Check lockout before generating new OTP ── */
  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);
  const lockoutStatus = await checkLockout(phone, maxAttempts, lockoutMinutes);
  if (lockoutStatus.locked) {
    addSecurityEvent({ type: "locked_account_otp_request", ip, details: `OTP request for locked phone: ${phone}`, severity: "medium" });
    res.status(429).json({
      error: `Account temporarily locked due to too many failed attempts. Please try again in ${lockoutStatus.minutesLeft} minute(s).`,
      lockedMinutes: lockoutStatus.minutesLeft,
    });
    return;
  }

  /* ── Check banned status ── */
  if (existingUser[0]?.isBanned) {
    addSecurityEvent({ type: "banned_user_otp_request", ip, details: `Banned user attempted OTP: ${phone}`, severity: "high" });
    res.status(403).json({ error: "Your account has been suspended. Please contact support." });
    return;
  }

  /* ── Method Enforcement (Unified Auth Gatekeeper) ──
     If this number is linked to a Google account and Google login is enabled,
     the user MUST log in via Google — not OTP — to prevent account hijacking. ── */
  const existingGoogleId = existingUser[0]?.googleId;
  if (existingGoogleId && isAuthMethodEnabled(settings, "auth_google_enabled", existingUser[0]?.role ?? effectiveRole)) {
    addSecurityEvent({ type: "otp_blocked_google_account", ip, details: `OTP attempt on Google-linked account: ${phone}`, severity: "low" });
    res.status(403).json({
      error: "This account is linked to Google. Please sign in with Google.",
      useGoogle: true,
      googleLinked: true,
    });
    return;
  }

  /* ── Determine approval status for NEW users ── */
  const isNewUser = existingUser.length === 0;
  const requireApproval = (settings["user_require_approval"] ?? "off") === "on";
  const newUserApprovalStatus = isNewUser && requireApproval ? "pending" : "approved";

  /* ══ OTP DISABLED — require password for existing users, block new registrations ══ */
  if (!otpEnabled || !otpEnabledForRole) {
    if (isNewUser) {
      res.status(403).json({ error: "Phone verification is required for new registrations. Please contact support." });
      return;
    }
    const u = existingUser[0]!;
    if (!u.passwordHash) {
      res.status(403).json({ error: "Phone OTP is currently disabled. Please use password or another login method." });
      return;
    }
    res.json({
      otpRequired: false,
      requiresPassword: true,
      message: "Phone OTP is disabled. Please enter your password.",
      action: "login_password",
      availableMethods: ["password"],
      user: { id: u.id, phone: u.phone, name: u.name },
    });
    return;
  }
  if (false) {
    const now = new Date();
    const userId = existingUser[0]?.id ?? generateId();
    const u = existingUser[0];
    if (!u) { res.status(500).json({ error: "User creation failed" }); return; }

    const signupBonus = parseFloat(settings["customer_signup_bonus"] ?? "0");
    if (isNewUser && signupBonus > 0) {
      await db.update(usersTable)
        .set({ walletBalance: sql`wallet_balance + ${signupBonus}` })
        .where(eq(usersTable.id, u.id));
      await db.insert(walletTransactionsTable).values({
        id: generateId(), userId: u.id, type: "bonus",
        amount: signupBonus.toFixed(2),
        description: `Welcome bonus — Thanks for joining AJKMart!`,
      });
    }

    writeAuthAuditLog("otp_bypass_login", { ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone, reason: "otp_disabled" } });

    const accessToken = signAccessToken(u.id, phone, u.role ?? "customer", u.roles ?? u.role ?? "customer", u.tokenVersion ?? 0);
    const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    await db.insert(refreshTokensTable).values({
      id: generateId(), userId: u.id, tokenHash: refreshHash,
      authMethod: "phone_otp_bypass", expiresAt: refreshExpiresAt,
    });

    res.json({
      otpRequired: false,
      message: "OTP verification skipped — phone registered directly",
      token: accessToken,
      refreshToken: refreshRaw,
      user: {
        id: u.id, phone: u.phone, name: u.name, email: u.email,
        username: u.username, role: u.role, roles: u.roles,
        avatar: u.avatar, walletBalance: parseFloat(u.walletBalance ?? "0"),
        isActive: u.isActive, cnic: u.cnic, city: u.city,
        totpEnabled: u.totpEnabled ?? false, createdAt: u.createdAt.toISOString(),
      },
    });
    return;
  }

  /* ── Per-phone OTP resend cooldown (60 s) — prevents SMS bombing ── */
  const otpCooldownMs = parseInt(settings["security_otp_cooldown_sec"] ?? "60", 10) * 1000;
  const existingOtpExpiry = existingUser[0]?.otpExpiry;
  if (existingOtpExpiry) {
    const otpValidityMs = 10 * 60 * 1000;
    const issuedAgoMs   = otpValidityMs - (existingOtpExpiry.getTime() - Date.now());
    if (issuedAgoMs < otpCooldownMs) {
      const waitSec = Math.ceil((otpCooldownMs - issuedAgoMs) / 1000);
      addSecurityEvent({ type: "otp_resend_throttle", ip, details: `OTP resend too soon for ${phone} — ${waitSec}s remaining`, severity: "low" });
      res.status(429).json({ error: `Please wait ${waitSec} second(s) before requesting a new OTP.`, retryAfterSeconds: waitSec });
      return;
    }
  }

  const otp       = generateSecureOtp();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

  await db
    .insert(usersTable)
    .values({
      id:             generateId(),
      phone,
      otpCode:        hashOtp(otp),
      otpExpiry,
      otpUsed:        false,
      role:           "customer",
      roles:          "customer",
      walletBalance:  "0",
      isActive:       !isNewUser || !requireApproval,
      approvalStatus: newUserApprovalStatus,
      ...(isNewUser && deviceId ? { deviceId } : {}),
    })
    .onConflictDoUpdate({
      target: usersTable.phone,
      set: {
        otpCode:   hashOtp(otp),
        otpExpiry,
        otpUsed:   false,
        updatedAt: new Date(),
      },
    });

  writeAuthAuditLog("otp_sent", { ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone } });
  req.log.info({ phone, otp }, "OTP sent");

  const otpUserId = existingUser[0]?.id;
  const otpLang = otpUserId ? await getUserLanguage(otpUserId) : await getPlatformDefaultLanguage();

  const whatsappEnabled = settings["integration_whatsapp"] === "on";
  const emailEnabled    = isAuthMethodEnabled(settings, "auth_email_otp_enabled", effectiveRole);
  const userEmail       = existingUser[0]?.email;

  let deliveryChannel = "none";
  let deliverySuccess = false;
  const smsEnabled = isAuthMethodEnabled(settings, "auth_phone_otp_enabled", effectiveRole);
  const availableChannels: string[] = [];
  if (whatsappEnabled) availableChannels.push("whatsapp");
  if (smsEnabled) availableChannels.push("sms");
  if (emailEnabled && userEmail) availableChannels.push("email");

  const channelOrder: string[] = [];
  if (preferredChannel && availableChannels.includes(preferredChannel)) {
    channelOrder.push(preferredChannel);
    for (const ch of availableChannels) { if (ch !== preferredChannel) channelOrder.push(ch); }
  } else {
    if (whatsappEnabled) channelOrder.push("whatsapp");
    if (smsEnabled) channelOrder.push("sms");
    if (emailEnabled && userEmail) channelOrder.push("email");
  }

  for (const channel of channelOrder) {
    if (channel === "whatsapp") {
      const waResult = await sendWhatsAppOTP(phone, otp, settings, otpLang);
      if (waResult.sent) { deliveryChannel = "whatsapp"; deliverySuccess = true; break; }
      req.log.warn({ err: waResult.error }, "WhatsApp OTP failed, trying next channel");
    } else if (channel === "sms") {
      const smsResult = await sendOtpSMS(phone, otp, settings, otpLang);
      if (smsResult.sent) { deliveryChannel = "sms"; deliverySuccess = true; break; }
      req.log.warn({ err: smsResult.error }, "SMS OTP failed, trying next channel");
    } else if (channel === "email" && userEmail) {
      const emailLang = otpUserId ? await getUserLanguage(otpUserId) : await getPlatformDefaultLanguage();
      const emailResult = await sendPasswordResetEmail(userEmail, otp, existingUser[0]?.name ?? undefined, emailLang);
      if (emailResult.sent) { deliveryChannel = "email"; deliverySuccess = true; break; }
      req.log.warn({ err: emailResult.reason }, "Email OTP failed");
    }
  }

  const isDev = process.env.NODE_ENV !== "production";
  const userDevOtp = existingUser[0]?.devOtpEnabled === true;
  const globalDevOtp = settings["security_global_dev_otp"] === "on";

  if (!deliverySuccess) {
    if (isDev || userDevOtp || globalDevOtp) {
      deliveryChannel = "dev";
      req.log.warn({ phone }, "All OTP delivery channels failed — returning OTP in dev/devOtp mode");
    } else {
      req.log.error({ phone }, "All OTP delivery channels failed");
      res.status(502).json({ error: "Could not deliver OTP. Please try again or use an alternative login method.", fallbackChannels: availableChannels });
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

  /* Dev OTP: expose OTP in response when:
     - the admin enabled devOtpEnabled on this specific user (per-user flag in Users page), OR
     - the global Dev OTP Mode platform setting is "on" (Security settings in admin)
     Both only work when the server is not in production mode. */
  if ((userDevOtp || globalDevOtp) && isDev) {
    response.otp = otp;
    response.devMode = true;
  }

  res.json(response);
});

/* ─────────────────────────────────────────────────────────────
   POST /auth/verify-otp
   Validates the OTP, checks security settings, returns token.
───────────────────────────────────────────────────────────── */
router.post("/verify-otp", verifyCaptcha, async (req, res) => {
  const rawPhone = req.body?.phone;
  const { otp } = req.body;
  if (!rawPhone || !otp) {
    res.status(400).json({ error: "Phone and OTP are required" });
    return;
  }
  const phone = canonicalizePhone(rawPhone);

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabled(settings, "auth_phone_otp_enabled")) {
    res.status(403).json({ error: "Phone OTP login is currently disabled." });
    return;
  }

  const maxAttempts    = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"]    ?? "30", 10);

  /* ── Lockout check ── */
  const lockoutStatus = await checkLockout(phone, maxAttempts, lockoutMinutes);
  if (lockoutStatus.locked) {
    addAuditEntry({ action: "verify_otp_lockout", ip, details: `Locked account OTP attempt: ${phone}`, result: "fail" });
    res.status(429).json({
      error: `Account temporarily locked. Please try again in ${lockoutStatus.minutesLeft} minute(s).`,
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
    res.status(404).json({ error: "User not found. Please request a new OTP." });
    return;
  }

  if (!isAuthMethodEnabled(settings, "auth_phone_otp_enabled", user.role ?? undefined)) {
    res.status(403).json({ error: "Phone OTP login is currently disabled for your account type." });
    return;
  }

  /* ── Banned check ── */
  if (user.isBanned) {
    addSecurityEvent({ type: "banned_login_attempt", ip, userId: user.id, details: `Banned user tried to verify OTP: ${phone}`, severity: "high" });
    res.status(403).json({ error: "Your account has been suspended. Please contact support." });
    return;
  }

  /* ── Inactive check ──
     Pending-approval accounts are isActive=false but should NOT be blocked here;
     they need to pass OTP validation and receive the pendingApproval=true response.
     Check approvalStatus directly — the setting only controls NEW users, not existing pending ones. ── */
  const isPendingApproval = user.approvalStatus === "pending";
  if (!user.isActive && !isPendingApproval) {
    res.status(403).json({ error: "Your account is currently inactive. Please contact support." });
    return;
  }

  /* ── OTP Bypass Mode (dev/testing only) ──
     Only allowed when NODE_ENV is explicitly "development" or "test".
     Any other value (including undefined/unset) treats the env as production-like.
     security_phone_verify=on also overrides the bypass. ── */
  const nodeEnv = process.env.NODE_ENV;
  const isExplicitlyDev = nodeEnv === "development" || nodeEnv === "test";
  const phoneVerifyRequired = settings["security_phone_verify"] === "on";
  const otpBypass = isExplicitlyDev && settings["security_otp_bypass"] === "on" && !phoneVerifyRequired;
  if (otpBypass) {
    console.warn("[SECURITY] OTP bypass is ENABLED for phone verify-otp. This must NOT be used in production.");
  }

  /* ── Atomic OTP consumption via a single conditional UPDATE ──
     The WHERE clause combines: correct code + not-yet-used + not-expired.
     Concurrency-safe: only the first concurrent caller gets rows back.
     On bypass mode we skip the OTP check entirely. ── */
  const signupBonus = parseFloat(settings["customer_signup_bonus"] ?? "0");
  const now = new Date();

  let isActualFirstLogin = false;

  if (!otpBypass) {
    const consumed = await db.transaction(async (tx) => {
      /* Single atomic UPDATE: marks OTP as used ONLY if code matches, unused, and unexpired.
         Returns the row if consumed, empty if already used / wrong code / expired. */
      const rows = await tx
        .update(usersTable)
        .set({ otpCode: null, otpExpiry: null, otpUsed: true, phoneVerified: true, lastLoginAt: now })
        .where(and(
          eq(usersTable.phone, phone),
          eq(usersTable.otpCode, hashOtp(otp)),
          eq(usersTable.otpUsed, false),
          sql`otp_expiry > now()`,
        ))
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

      if (fresh?.otpUsed) {
        writeAuthAuditLog("otp_reuse_attempt", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined });
        res.status(401).json({ error: "This OTP has already been used. Please request a new one." });
      } else if (!fresh?.otpExpiry || new Date() > fresh.otpExpiry) {
        writeAuthAuditLog("otp_expired", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined });
        res.status(401).json({ error: "OTP expired. Please request a new one." });
      } else {
        const updated = await recordFailedAttempt(phone, maxAttempts, lockoutMinutes);
        const remaining = maxAttempts - updated.attempts;
        addAuditEntry({ action: "verify_otp_failed", ip, details: `Wrong OTP for phone: ${phone}, attempt ${updated.attempts}/${maxAttempts}`, result: "fail" });
        writeAuthAuditLog("otp_failed", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined });
        if (updated.lockedUntil) {
          addSecurityEvent({ type: "account_locked", ip, userId: user.id, details: `Account locked after ${maxAttempts} failed OTP attempts`, severity: "high" });
          res.status(429).json({ error: `Too many failed attempts. Account locked for ${lockoutMinutes} minutes.`, lockedMinutes: lockoutMinutes });
        } else {
          res.status(401).json({
            error: `Invalid OTP. ${remaining > 0 ? `${remaining} attempt(s) remaining before lockout.` : "Next failure will lock your account."}`,
            attemptsRemaining: Math.max(0, remaining),
          });
        }
      }
      return;
    }
  } else {
    /* OTP bypass mode — still mark verified and update last login */
    await db.update(usersTable)
      .set({ phoneVerified: true, lastLoginAt: now })
      .where(eq(usersTable.phone, phone));
  }

  await resetAttempts(phone);

  /* ── Re-fetch user to get latest data (wallet balance, name, etc.) ── */
  const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
  const u = freshUser ?? user;

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
    res.status(403).json({ error: "Aapka account reject kar diya gaya hai. Admin se rabta karein.", approvalStatus: "rejected", approvalNote: u.approvalNote });
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
    expiresAt:    new Date(Date.now() + 15 * 60 * 1000).toISOString(),
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
    res.status(401).json({ error: "Authentication required. Please verify your phone via OTP first." });
    return;
  }

  const { storeName, storeCategory, name, cnic, address, city, bankName, bankAccount, bankAccountTitle, username } = req.body;
  if (!storeName) {
    res.status(400).json({ error: "Store name is required" });
    return;
  }

  if (username) {
    const normalizedUsername = String(username).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
    if (normalizedUsername.length < 3) {
      res.status(400).json({ error: "Username must be at least 3 characters" });
      return;
    }
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(sql`lower(${usersTable.username}) = ${normalizedUsername} AND ${usersTable.id} != ${auth.userId}`)
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "Username is already taken" });
      return;
    }
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  if (!user.phoneVerified) {
    res.status(403).json({ error: "Phone number not verified. Please verify OTP first." });
    return;
  }

  const existingRoles = (user.roles || user.role || "").split(",").map((r: string) => r.trim()).filter(Boolean);
  if (existingRoles.includes("vendor")) {
    if (user.approvalStatus === "pending") {
      res.json({ success: true, status: "pending", message: "Your vendor application is already pending admin approval." });
      return;
    }
    if (user.approvalStatus === "approved") {
      res.json({ success: true, status: "approved", message: "You are already approved as a vendor." });
      return;
    }
  }

  const newRoles = existingRoles.includes("vendor") ? existingRoles : [...existingRoles, "vendor"];
  const settings = await getCachedSettings();
  const autoApprove = (settings["vendor_auto_approve"] ?? "off") === "on";

  await db.update(usersTable).set({
    roles: newRoles.join(","),
    role: "vendor",
    storeName,
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
    updatedAt: new Date(),
  }).where(eq(usersTable.id, user.id));

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

  if (!token) { res.status(400).json({ error: "token required" }); return; }

  try {
    const payload = verifyUserJwt(token);
    if (!payload) { res.status(401).json({ valid: false, error: "Invalid or expired token" }); return; }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
    if (!user)         { res.status(401).json({ valid: false, error: "User not found" }); return; }
    if (user.isBanned) { res.status(403).json({ valid: false, error: "Account suspended" }); return; }
    if (!user.isActive){ res.status(403).json({ valid: false, error: "Account inactive" }); return; }

    if ((payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
      res.status(401).json({ valid: false, error: "Token revoked" }); return;
    }

    const expiresAt = payload.exp ? new Date(payload.exp * 1000).toISOString() : null;
    res.json({ valid: true, expiresAt, userId: user.id, role: user.role });
  } catch {
    res.status(401).json({ valid: false, error: "Token validation failed" });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /auth/refresh
   Exchange a valid refresh token for a new access token.
   Body: { refreshToken }
   On success: returns { token, expiresAt }
   Refresh tokens are rotated on use (old one revoked, new one issued).
───────────────────────────────────────────────────────────── */
router.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body;
  const ip = getClientIp(req);

  if (!refreshToken) {
    res.status(400).json({ error: "refreshToken required" });
    return;
  }

  const tokenHash = hashRefreshToken(refreshToken);
  const [rt] = await db.select().from(refreshTokensTable).where(eq(refreshTokensTable.tokenHash, tokenHash)).limit(1);

  if (!rt) {
    writeAuthAuditLog("refresh_failed_not_found", { ip, userAgent: req.headers["user-agent"] ?? undefined });
    res.status(401).json({ error: "Invalid refresh token. Please log in again." });
    return;
  }

  if (rt.revokedAt) {
    /* Token reuse detected — revoke all tokens for this user (possible token theft) */
    await revokeAllUserRefreshTokens(rt.userId);
    writeAuthAuditLog("refresh_token_reuse", { userId: rt.userId, ip, userAgent: req.headers["user-agent"] ?? undefined });
    addSecurityEvent({ type: "refresh_token_reuse", ip, userId: rt.userId, details: "Refresh token reuse detected — all sessions revoked", severity: "high" });
    res.status(401).json({ error: "Session invalidated for security. Please log in again." });
    return;
  }

  if (new Date() > rt.expiresAt) {
    await revokeRefreshToken(tokenHash);
    writeAuthAuditLog("refresh_token_expired", { userId: rt.userId, ip });
    res.status(401).json({ error: "Session expired. Please log in again." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, rt.userId)).limit(1);
  if (!user || user.isBanned || !user.isActive) {
    await revokeRefreshToken(tokenHash);
    res.status(401).json({ error: "Account not available. Please log in again." });
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
      res.status(403).json({ error: "Your login method has been disabled. Please log in again using an available method." });
      return;
    }
  } else {
    await revokeRefreshToken(tokenHash);
    res.status(403).json({ error: "Session expired. Please log in again." });
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
    expiresAt:    new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
});

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
    res.status(429).json({ error: `Too many requests. Try again in ${rlCheck.minutesLeft} minute(s).` }); return;
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
    res.status(400).json({ error: "Valid email address required" }); return;
  }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabled(settings, "auth_email_otp_enabled")) {
    res.status(403).json({ error: "Email OTP login is currently disabled." });
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
    res.status(403).json({ error: "Email OTP login is currently disabled for your account type." });
    return;
  }

  if (user.isBanned) { res.status(403).json({ error: "Your account has been suspended." }); return; }
  const isPendingEmail = user.approvalStatus === "pending";
  if (!user.isActive && !isPendingEmail) { res.status(403).json({ error: "Your account is inactive. Contact support." }); return; }

  /* Lockout check using email as key */
  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);
  const lockout = await checkLockout(normalized, maxAttempts, lockoutMinutes);
  if (lockout.locked) {
    res.status(429).json({ error: `Too many attempts. Try again in ${lockout.minutesLeft} minute(s).` }); return;
  }

  /* ── Per-email OTP resend cooldown — prevents inbox flooding ──
     Same 60-second window as the SMS OTP cooldown. */
  const otpCooldownMs   = parseInt(settings["security_otp_cooldown_sec"] ?? "60", 10) * 1000;
  const existingExpiry  = user.emailOtpExpiry;
  if (existingExpiry) {
    const otpValidityMs = 10 * 60 * 1000;
    const issuedAgoMs   = otpValidityMs - (existingExpiry.getTime() - Date.now());
    if (issuedAgoMs < otpCooldownMs) {
      const waitSec = Math.ceil((otpCooldownMs - issuedAgoMs) / 1000);
      addAuditEntry({ action: "email_otp_throttle", ip, details: `Email OTP resend too soon for ${normalized} — ${waitSec}s remaining`, result: "fail" });
      res.status(429).json({ error: `Please wait ${waitSec} second(s) before requesting a new email OTP.`, retryAfterSeconds: waitSec });
      return;
    }
  }

  const otp    = generateSecureOtp();
  const expiry = new Date(Date.now() + 10 * 60 * 1000);

  await db.update(usersTable)
    .set({ emailOtpCode: hashOtp(otp), emailOtpExpiry: expiry, updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  const isDev = process.env.NODE_ENV !== "production";
  req.log.info({ email: normalized, otp: isDev ? otp : "[hidden]" }, "Email OTP generated");

  /* Send OTP via email service. Falls back gracefully when SMTP is not configured.
     In development, the OTP is also exposed in the response for easy testing. */
  const emailOtpLang = await getUserLanguage(user.id);
  const emailResult = await sendPasswordResetEmail(normalized, otp, user.name ?? undefined, emailOtpLang);

  if (!emailResult.sent) {
    if (isDev) {
      /* In development, log OTP to console so developers can see it */
      console.log(`[EMAIL-OTP DEV] Email OTP for ${normalized}: ${otp} (SMTP not configured: ${emailResult.reason ?? "unknown"})`);
    } else {
      /* In production, log a warning but still issue the OTP (client won't see it) */
      console.warn(`[EMAIL-OTP] Failed to send OTP email to ${normalized}: ${emailResult.reason ?? "SMTP not configured"}`);
    }
  }

  addAuditEntry({ action: "email_otp_sent", ip, details: `Email OTP for: ${normalized} (delivered: ${emailResult.sent})`, result: "success" });

  res.json({
    message: "OTP aapki email par bhej diya gaya hai",
    channel: emailResult.sent ? "email" : "console",
  });
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/verify-email-otp
   Login via email OTP. Body: { email, otp }
══════════════════════════════════════════════════════════════ */
router.post("/verify-email-otp", verifyCaptcha, async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) { res.status(400).json({ error: "Email and OTP are required" }); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabled(settings, "auth_email_otp_enabled")) {
    res.status(403).json({ error: "Email OTP login is currently disabled." });
    return;
  }
  const normalized = email.toLowerCase().trim();

  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);

  const lockout = await checkLockout(normalized, maxAttempts, lockoutMinutes);
  if (lockout.locked) {
    res.status(429).json({ error: `Account locked. Try again in ${lockout.minutesLeft} minute(s).` }); return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
  if (!user) { res.status(404).json({ error: "Is email se koi account nahi mila." }); return; }

  if (!isAuthMethodEnabled(settings, "auth_email_otp_enabled", user.role ?? "customer")) {
    res.status(403).json({ error: "Email OTP login is currently disabled for your account type." });
    return;
  }

  if (user.isBanned) { res.status(403).json({ error: "Account suspended. Contact support." }); return; }
  const emailIsPending = user.approvalStatus === "pending";
  if (!user.isActive && !emailIsPending) { res.status(403).json({ error: "Account inactive. Contact support." }); return; }

  /* Verify OTP — bypass only allowed in development/test, respects phoneVerifyRequired */
  const phoneVerifyRequired = settings["security_phone_verify"] === "on";
  const emailNodeEnv = process.env.NODE_ENV;
  const emailIsExplicitlyDev = emailNodeEnv === "development" || emailNodeEnv === "test";
  const otpBypass = emailIsExplicitlyDev && settings["security_otp_bypass"] === "on" && !phoneVerifyRequired;
  if (otpBypass) {
    console.warn("[SECURITY] OTP bypass is ENABLED for email verify-otp. This must NOT be used in production.");
  }

  /* Check expiry FIRST — prevents timing oracle (attacker learning that an
     expired OTP was correct by observing which error branch fires). */
  if (!otpBypass && user.emailOtpExpiry && new Date() > user.emailOtpExpiry) {
    res.status(401).json({ error: "OTP expired. Please request a new one." }); return;
  }

  if (!otpBypass && user.emailOtpCode !== hashOtp(otp)) {
    const updated = await recordFailedAttempt(normalized, maxAttempts, lockoutMinutes);
    const remaining = maxAttempts - updated.attempts;
    addAuditEntry({ action: "email_otp_failed", ip, details: `Wrong email OTP for: ${normalized}`, result: "fail" });
    if (updated.lockedUntil) {
      res.status(429).json({ error: `Too many failed attempts. Locked for ${lockoutMinutes} minutes.` });
    } else {
      res.status(401).json({ error: `Invalid OTP. ${remaining} attempt(s) remaining.`, attemptsRemaining: remaining });
    }
    return;
  }

  /* Check approval BEFORE touching the DB — a rejected user must not have their OTP cleared */
  if (user.approvalStatus === "rejected") {
    res.status(403).json({ error: "Account rejected. Contact admin.", approvalNote: user.approvalNote }); return;
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
  const expiresAt   = new Date(Date.now() + 15 * 60 * 1000).toISOString();

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

async function handleUnifiedLogin(req: Request, res: any) {
  const identifier = (req.body?.identifier || req.body?.username || "").trim();
  const { password } = req.body;
  if (!identifier || !password) { res.status(400).json({ error: "Identifier and password required" }); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabled(settings, "auth_username_password_enabled")) {
    res.status(403).json({ error: "Password login is currently disabled." });
    return;
  }

  const { user, idType, lookupKey } = await findUserByIdentifier(identifier);

  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);

  const lockoutKey = user ? `uid:${user.id}` : lookupKey;

  const lockout = await checkLockout(lockoutKey, maxAttempts, lockoutMinutes);
  if (lockout.locked) {
    res.status(429).json({ error: `Account locked. Try again in ${lockout.minutesLeft} minute(s).` }); return;
  }

  if (!user || !user.passwordHash) {
    await recordFailedAttempt(lockoutKey, maxAttempts, lockoutMinutes);
    addAuditEntry({ action: "unified_login_failed", ip, details: `Not found or no password (${idType}): ${lookupKey}`, result: "fail" });
    res.status(401).json({ error: "Invalid credentials" }); return;
  }

  if (!isAuthMethodEnabled(settings, "auth_username_password_enabled", user.role ?? "customer")) {
    res.status(403).json({ error: "Password login is currently disabled for your account type." });
    return;
  }

  if (user.isBanned) { res.status(403).json({ error: "Account suspended. Contact support." }); return; }
  const isPendingApproval = user.approvalStatus === "pending";
  if (!user.isActive && !isPendingApproval) { res.status(403).json({ error: "Account inactive. Contact support." }); return; }

  const passwordOk = verifyPassword(password, user.passwordHash);
  if (!passwordOk) {
    const updated = await recordFailedAttempt(lockoutKey, maxAttempts, lockoutMinutes);
    addAuditEntry({ action: "unified_login_failed", ip, details: `Wrong password (${idType}): ${lookupKey}`, result: "fail" });
    if (updated.lockedUntil) {
      res.status(429).json({ error: `Too many failed attempts. Locked for ${lockoutMinutes} minutes.` });
    } else {
      res.status(401).json({ error: `Invalid credentials. ${maxAttempts - updated.attempts} attempt(s) remaining.` });
    }
    return;
  }

  if (user.approvalStatus === "rejected") {
    res.status(403).json({ error: "Account rejected. Contact admin.", approvalNote: user.approvalNote }); return;
  }

  await resetAttempts(lockoutKey);
  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
  addAuditEntry({ action: "unified_login", ip, details: `Login via ${idType}: ${lookupKey}`, result: "success" });

  if (user.totpEnabled && isAuthMethodEnabled(settings, "auth_2fa_enabled", user.role ?? undefined)) {
    const deviceFingerprint = req.body.deviceFingerprint ?? "";
    const trustedDays = parseInt(settings["auth_trusted_device_days"] ?? "30", 10);
    if (!isDeviceTrusted(user, deviceFingerprint, trustedDays)) {
      const tempToken = sign2faChallengeToken(user.id, user.phone ?? "", user.role ?? "customer", user.roles ?? "customer", "password");
      res.json({ requires2FA: true, tempToken, userId: user.id }); return;
    }
  }

  const accessToken = signAccessToken(user.id, user.phone ?? "", user.role ?? "customer", user.roles ?? "customer", user.tokenVersion ?? 0);
  const expiresAt   = new Date(Date.now() + 15 * 60 * 1000).toISOString();

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
  const { name, email, username, password, currentPassword, cnic, address, city, area, latitude, longitude } = req.body;
  if (!rawToken) { res.status(401).json({ error: "Token required" }); return; }

  /* Verify JWT to get userId */
  const payload = verifyUserJwt(rawToken);
  if (!payload) { res.status(401).json({ error: "Invalid or expired token. Please log in again." }); return; }
  const userId = payload.userId;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user)         { res.status(404).json({ error: "User not found" }); return; }
  if (user.isBanned) { res.status(403).json({ error: "Account suspended. Contact support." }); return; }
  if (!user.isActive && user.approvalStatus !== "pending") {
    res.status(403).json({ error: "Account inactive. Contact support." }); return;
  }

  const updates: Record<string, any> = { updatedAt: new Date() };

  if (name && name.trim().length > 1) {
    updates.name = name.trim();
  }

  if (email && email.includes("@")) {
    const normalized = email.toLowerCase().trim();
    /* Check email uniqueness (skip if it's already this user's email) */
    if (normalized !== user.email) {
      const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
      if (existing && existing.id !== userId) {
        res.status(409).json({ error: "Is email se pehle se ek account bana hua hai" }); return;
      }
    }
    updates.email = normalized;
  }

  if (username && username.length > 2) {
    const clean = username.toLowerCase().replace(/[^a-z0-9_]/g, "").trim();
    if (clean.length < 3) { res.status(400).json({ error: "Username must be at least 3 characters (letters, numbers, underscore only)" }); return; }
    if (clean !== user.username) {
      const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(sql`lower(${usersTable.username}) = ${clean}`).limit(1);
      if (existing && existing.id !== userId) {
        res.status(409).json({ error: "Yeh username pehle se liya hua hai" }); return;
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

  if (password && password.length >= 8) {
    const isNewRegistration = !user.name || user.name === "User" || user.name === "Pending";
    if (user.passwordHash && !isNewRegistration) {
      if (!currentPassword) {
        res.status(400).json({ error: "Current password required to change password" }); return;
      }
      if (!verifyPassword(currentPassword, user.passwordHash)) {
        res.status(401).json({ error: "Current password galat hai" }); return;
      }
    }
    const check = validatePasswordStrength(password);
    if (!check.ok) { res.status(400).json({ error: check.message }); return; }
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
    res.status(400).json({ error: "Koi update nahi kiya — name, email, username ya password provide karein" }); return;
  }

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();

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

  res.json({
    success: true,
    message: "Profile update ho gaya",
    token: accessToken,
    refreshToken: refreshRaw,
    user: { id: updated!.id, phone: updated!.phone, name: updated!.name, email: updated!.email, username: updated!.username, role: updated!.role, roles: updated!.roles, avatar: updated!.avatar, cnic: updated!.cnic, city: updated!.city, area: updated!.area, address: updated!.address, latitude: updated!.latitude, longitude: updated!.longitude, kycStatus: updated!.kycStatus, accountLevel: updated!.accountLevel, totpEnabled: updated!.totpEnabled ?? false, emailVerified: updated!.emailVerified, phoneVerified: updated!.phoneVerified, walletBalance: parseFloat(updated!.walletBalance ?? "0"), isActive: updated!.isActive, createdAt: updated!.createdAt.toISOString() },
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
  if (!rawToken || !password) { res.status(400).json({ error: "Token and password required" }); return; }

  const payload = verifyUserJwt(rawToken);
  if (!payload) { res.status(401).json({ error: "Invalid or expired token. Please log in again." }); return; }
  const userId = payload.userId;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user)         { res.status(404).json({ error: "User not found" }); return; }
  if (user.isBanned) { res.status(403).json({ error: "Account suspended. Contact support." }); return; }
  if (!user.isActive){ res.status(403).json({ error: "Account inactive. Contact support." }); return; }

  /* If user already has a password, ALWAYS require the current password — no bypass */
  if (user.passwordHash) {
    if (!currentPassword) {
      res.status(400).json({ error: "Current password required to change password" }); return;
    }
    if (!verifyPassword(currentPassword, user.passwordHash)) {
      res.status(401).json({ error: "Current password galat hai" }); return;
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
    if (role && parsed[role]) return parsed[role] === "on";
    if (!role) return false;
    return false;
  } catch {
    return val === "on";
  }
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
const PHONE_REGEX = /^0?3\d{9}$/;

router.post("/register", verifyCaptcha, async (req, res) => {
  const { phone, password, name, role, cnic, nationalId, email, username,
          vehicleType, vehicleRegNo, drivingLicense,
          address, city, emergencyContact, vehiclePlate, vehiclePhoto, documents,
          businessName, businessType, storeAddress, ntn, storeName } = req.body;

  const ip = getClientIp(req);
  const settings = await getCachedSettings();
  const userRole = (role === "rider" || role === "vendor") ? role : "customer";

  if (settings["feature_new_users"] === "off") {
    res.status(403).json({ error: "New user registration is currently disabled." });
    return;
  }

  if (!isAuthMethodEnabled(settings, "auth_phone_otp_enabled", userRole)) {
    res.status(403).json({ error: "Phone registration is currently disabled for this role." });
    return;
  }

  if (!phone) {
    res.status(400).json({ error: "Phone number is required" });
    return;
  }
  const cleanedPhone = phone.replace(/[\s\-()]/g, "");
  if (!PHONE_REGEX.test(cleanedPhone)) {
    res.status(400).json({ error: "Invalid phone number. Use format: 03XXXXXXXXX" });
    return;
  }

  if (!password) {
    res.status(400).json({ error: "Password is required" });
    return;
  }
  const pwCheck = validatePasswordStrength(password);
  if (!pwCheck.ok) {
    res.status(400).json({ error: pwCheck.message });
    return;
  }

  const cnicValue = cnic || nationalId;
  if (cnicValue && !CNIC_REGEX.test(cnicValue)) {
    res.status(400).json({ error: "CNIC format must be XXXXX-XXXXXXX-X" });
    return;
  }

  if (userRole === "rider") {
    if (!cnicValue) { res.status(400).json({ error: "CNIC is required for rider registration" }); return; }
    if (!vehicleType) { res.status(400).json({ error: "Vehicle type is required for rider registration" }); return; }
  }

  if (userRole === "vendor") {
    if (!businessName && !storeName) { res.status(400).json({ error: "Business/store name is required for vendor registration" }); return; }
  }

  const normalizedPhone = canonicalizePhone(phone);
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, normalizedPhone)).limit(1);
  if (existing) {
    res.status(409).json({ error: "An account with this phone number already exists" });
    return;
  }

  if (email) {
    const normalizedEmail = email.toLowerCase().trim();
    const [existingEmail] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);
    if (existingEmail) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }
  }

  let cleanUsername: string | null = null;
  if (username) {
    cleanUsername = username.toLowerCase().trim().replace(/[^a-z0-9_]/g, "").slice(0, 20);
    if (cleanUsername !== null && cleanUsername.length >= 3) {
      const [existingUsername] = await db.select({ id: usersTable.id }).from(usersTable).where(sql`lower(${usersTable.username}) = ${cleanUsername}`).limit(1);
      if (existingUsername) {
        res.status(409).json({ error: "This username is already taken" });
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
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
  const userId = generateId();

  await db.insert(usersTable).values({
    id: userId,
    phone: normalizedPhone,
    name: name?.trim() || null,
    email: email ? email.toLowerCase().trim() : null,
    username: cleanUsername,
    role: userRole,
    roles: userRole,
    passwordHash: hashPassword(password),
    otpCode: hashOtp(otp),
    otpExpiry,
    otpUsed: false,
    walletBalance: "0",
    isActive: !needsApproval,
    approvalStatus: needsApproval ? "pending" : "approved",
    cnic: cnicValue || null,
    nationalId: cnicValue || null,
    vehicleType: vehicleType || null,
    vehicleRegNo: vehicleRegNo || null,
    vehiclePlate: vehiclePlate || vehicleRegNo || null,
    drivingLicense: drivingLicense || null,
    address: address || null,
    city: city || null,
    emergencyContact: emergencyContact || null,
    vehiclePhoto: vehiclePhoto || null,
    documents: documents || null,
    businessName: businessName || storeName || null,
    storeName: storeName || businessName || null,
    businessType: businessType || null,
    storeAddress: storeAddress || null,
    ntn: ntn || null,
  });

  const registerLang = await getUserLanguage(userId);
  const smsResult = await sendOtpSMS(normalizedPhone, otp, settings, registerLang);
  if (settings["integration_whatsapp"] === "on") {
    sendWhatsAppOTP(normalizedPhone, otp, settings, registerLang).catch(err =>
      req.log.warn({ err: err.message }, "WhatsApp OTP send failed (non-fatal)")
    );
  }

  writeAuthAuditLog("register", { ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone: normalizedPhone, role: userRole } });

  const isDev = process.env.NODE_ENV !== "production";
  res.status(201).json({
    message: "Registration successful. Please verify your phone with the OTP sent.",
    userId,
    role: userRole,
    pendingApproval: needsApproval,
    channel: smsResult.sent ? smsResult.provider : "console",
  });
});

router.post("/forgot-password", verifyCaptcha, async (req, res) => {
  let { phone, email, identifier } = req.body;
  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (identifier && !phone && !email) {
    const resolved = await findUserByIdentifier(identifier);
    if (resolved.user) {
      if (resolved.idType === "phone") {
        phone = resolved.user.phone;
      } else if (resolved.idType === "email") {
        email = resolved.user.email;
      } else if (resolved.idType === "username") {
        if (resolved.user.email) {
          email = resolved.user.email;
        } else if (resolved.user.phone) {
          phone = resolved.user.phone;
        }
      }
    }
  }

  if (!phone && !email) {
    res.status(400).json({ error: "Phone, email, or username is required" });
    return;
  }

  if (phone && !isAuthMethodEnabled(settings, "auth_phone_otp_enabled")) {
    res.status(403).json({ error: "Phone-based password reset is currently disabled" });
    return;
  }
  if (email && !phone && !isAuthMethodEnabled(settings, "auth_email_otp_enabled")) {
    res.status(403).json({ error: "Email-based password reset is currently disabled" });
    return;
  }

  let user;
  if (phone) {
    const canonPhone = canonicalizePhone(phone);
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
  if (phone && !isAuthMethodEnabled(settings, "auth_phone_otp_enabled", forgotRole)) {
    res.status(403).json({ error: "Phone-based password reset is currently disabled for your account type." });
    return;
  }
  if (email && !phone && !isAuthMethodEnabled(settings, "auth_email_otp_enabled", forgotRole)) {
    res.status(403).json({ error: "Email-based password reset is currently disabled for your account type." });
    return;
  }

  if (user.isBanned) { res.status(403).json({ error: "Account suspended." }); return; }
  if (!user.isActive) { res.status(403).json({ error: "Account inactive." }); return; }

  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);
  const lockoutKey = `reset:${user.id}`;
  const lockout = await checkLockout(lockoutKey, maxAttempts, lockoutMinutes);
  if (lockout.locked) {
    res.status(429).json({ error: `Too many attempts. Try again in ${lockout.minutesLeft} minute(s).` });
    return;
  }

  const otp = generateSecureOtp();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

  const forgotLang = await getUserLanguage(user.id);

  if (phone) {
    await db.update(usersTable)
      .set({ otpCode: hashOtp(otp), otpExpiry, otpUsed: false, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));

    const targetPhone = canonicalizePhone(phone);
    await sendOtpSMS(targetPhone, otp, settings, forgotLang);
    if (settings["integration_whatsapp"] === "on") {
      sendWhatsAppOTP(targetPhone, otp, settings, forgotLang).catch(() => {});
    }
  } else {
    await db.update(usersTable)
      .set({ emailOtpCode: hashOtp(otp), emailOtpExpiry: otpExpiry, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));

    await sendPasswordResetEmail(email, otp, user.name ?? undefined, forgotLang);
  }

  writeAuthAuditLog("forgot_password", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined });

  res.json({
    message: "If an account exists, a reset code has been sent.",
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

  if (!otp || typeof otp !== "string") {
    res.status(400).json({ error: "OTP is required" });
    return;
  }
  if (!phone && !email) {
    res.status(400).json({ error: "Phone or email is required" });
    return;
  }

  let user: (typeof usersTable.$inferSelect) | undefined;
  if (phone) {
    const canonPhone = canonicalizePhone(phone);
    const [found] = await db.select().from(usersTable).where(eq(usersTable.phone, canonPhone)).limit(1);
    user = found;
  } else {
    const normalized = (email as string).toLowerCase().trim();
    const [found] = await db.select().from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
    user = found;
  }

  if (!user) {
    res.status(422).json({ error: "Invalid or expired code" });
    return;
  }

  const hashed = hashOtp(otp);
  const now = new Date();

  if (phone) {
    if (!user.otpCode || user.otpCode !== hashed) {
      res.status(422).json({ error: "Invalid verification code" });
      return;
    }
    if (!user.otpExpiry || user.otpExpiry < now) {
      res.status(422).json({ error: "Verification code has expired. Please request a new one." });
      return;
    }
    if (user.otpUsed) {
      res.status(422).json({ error: "This code has already been used. Please request a new one." });
      return;
    }
  } else {
    if (!user.emailOtpCode || user.emailOtpCode !== hashed) {
      res.status(422).json({ error: "Invalid verification code" });
      return;
    }
    if (!user.emailOtpExpiry || user.emailOtpExpiry < now) {
      res.status(422).json({ error: "Verification code has expired. Please request a new one." });
      return;
    }
  }

  writeAuthAuditLog("verify_reset_otp", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined });
  res.json({ valid: true });
});

router.post("/reset-password", verifyCaptcha, async (req, res) => {
  let { phone, email, identifier, otp, newPassword, totpCode } = req.body;
  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!otp || !newPassword) {
    res.status(400).json({ error: "OTP and new password are required" });
    return;
  }

  if (identifier && !phone && !email) {
    const resolved = await findUserByIdentifier(identifier);
    if (resolved.user) {
      if (resolved.idType === "phone") {
        phone = resolved.user.phone;
      } else if (resolved.idType === "email") {
        email = resolved.user.email;
      } else if (resolved.idType === "username") {
        if (resolved.user.email) {
          email = resolved.user.email;
        } else if (resolved.user.phone) {
          phone = resolved.user.phone;
        }
      }
    }
  }

  if (!phone && !email) {
    res.status(400).json({ error: "Phone, email, or username is required" });
    return;
  }

  const pwCheck = validatePasswordStrength(newPassword);
  if (!pwCheck.ok) {
    res.status(400).json({ error: pwCheck.message });
    return;
  }

  let user;
  if (phone) {
    const canonPhone = canonicalizePhone(phone);
    const [found] = await db.select().from(usersTable).where(eq(usersTable.phone, canonPhone)).limit(1);
    user = found;
  } else {
    const normalized = email!.toLowerCase().trim();
    const [found] = await db.select().from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
    user = found;
  }

  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  const userRole = user.role ?? "customer";

  if (phone && !isAuthMethodEnabled(settings, "auth_phone_otp_enabled", userRole)) {
    res.status(403).json({ error: "Phone-based password reset is currently disabled for your account type." });
    return;
  }
  if (email && !phone && !isAuthMethodEnabled(settings, "auth_email_otp_enabled", userRole)) {
    res.status(403).json({ error: "Email-based password reset is currently disabled for your account type." });
    return;
  }

  if (user.isBanned) { res.status(403).json({ error: "Account suspended." }); return; }

  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);
  const lockoutKey = `reset:${user.id}`;
  const lockout = await checkLockout(lockoutKey, maxAttempts, lockoutMinutes);
  if (lockout.locked) {
    res.status(429).json({ error: `Too many attempts. Try again in ${lockout.minutesLeft} minute(s).` });
    return;
  }

  let otpValid = false;
  if (phone) {
    otpValid = user.otpCode === hashOtp(otp) && !user.otpUsed && user.otpExpiry != null && new Date() < user.otpExpiry;
  } else {
    otpValid = user.emailOtpCode === hashOtp(otp) && user.emailOtpExpiry != null && new Date() < user.emailOtpExpiry;
  }

  if (!otpValid) {
    await recordFailedAttempt(lockoutKey, maxAttempts, lockoutMinutes);
    addAuditEntry({ action: "reset_password_failed", ip, details: `Invalid OTP for password reset: ${user.id}`, result: "fail" });
    res.status(401).json({ error: "Invalid or expired OTP" });
    return;
  }

  if (user.totpEnabled && isAuthMethodEnabled(settings, "auth_2fa_enabled", userRole)) {
    if (!totpCode) {
      res.status(400).json({ error: "Two-factor authentication code required", requires2FA: true });
      return;
    }
    if (!/^\d{6}$/.test(totpCode)) {
      res.status(400).json({ error: "TOTP code must be 6 digits" });
      return;
    }
    if (!user.totpSecret) {
      res.status(400).json({ error: "2FA is not properly configured for this account. Please contact support." });
      return;
    }
    const { verifyTotpCode } = await import("../services/password.js");
    const decryptedSecret = decryptTotpSecret(user.totpSecret);
    if (!verifyTotpCode(decryptedSecret, totpCode)) {
      await recordFailedAttempt(lockoutKey, maxAttempts, lockoutMinutes);
      addAuditEntry({ action: "reset_password_2fa_failed", ip, details: `Invalid TOTP for password reset: ${user.id}`, result: "fail" });
      res.status(401).json({ error: "Invalid two-factor authentication code" });
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

  if (!isAuthMethodEnabled(settings, "auth_email_register_enabled", userRole)) {
    res.status(403).json({ error: "Email registration is currently disabled" });
    return;
  }

  if (settings["feature_new_users"] === "off") {
    res.status(403).json({ error: "New user registration is currently disabled." });
    return;
  }

  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Valid email address is required" });
    return;
  }
  if (!password) {
    res.status(400).json({ error: "Password is required" });
    return;
  }

  const pwCheck = validatePasswordStrength(password);
  if (!pwCheck.ok) {
    res.status(400).json({ error: pwCheck.message });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);
  if (existing) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  let cleanUsername: string | null = null;
  if (username) {
    cleanUsername = username.toLowerCase().trim().replace(/[^a-z0-9_]/g, "").slice(0, 20);
    if (cleanUsername !== null && cleanUsername.length >= 3) {
      const [existingUsername] = await db.select({ id: usersTable.id }).from(usersTable).where(sql`lower(${usersTable.username}) = ${cleanUsername}`).limit(1);
      if (existingUsername) {
        res.status(409).json({ error: "This username is already taken" });
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
    ...(vehicleType ? { vehicleType: vehicleType.trim() } : {}),
    ...(resolvedVehicleRegNo ? { vehicleRegNo: resolvedVehicleRegNo.trim() } : {}),
    ...(drivingLicense ? { drivingLicense: drivingLicense.trim() } : {}),
    ...(address ? { address: address.trim() } : {}),
    ...(city ? { city: city.trim() } : {}),
    ...(emergencyContact ? { emergencyContact: emergencyContact.trim() } : {}),
    ...(vehiclePlate ? { vehiclePlate: vehiclePlate.trim() } : {}),
    ...(vehiclePhoto ? { vehiclePhoto } : {}),
    ...(documents ? { documents } : {}),
  });

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

  if (!token || !email) {
    res.status(400).json({ error: "Invalid verification link" });
    return;
  }

  const normalizedEmail = decodeURIComponent(email).toLowerCase().trim();
  const verifyKey = `email_verify:${normalizedEmail}`;

  const lockout = await checkLockout(verifyKey, 5, 15);
  if (lockout.locked) {
    res.status(429).json({ error: `Too many verification attempts. Try again in ${lockout.minutesLeft} minute(s).` });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);

  if (!user) {
    await recordFailedAttempt(verifyKey, 5, 15);
    res.status(400).json({ error: "Invalid or expired verification link" });
    return;
  }

  if (user.emailVerified) {
    res.json({ message: "Email already verified. You can log in." });
    return;
  }

  if (user.emailOtpExpiry && new Date() > user.emailOtpExpiry) {
    res.status(401).json({ error: "Verification link has expired. Please register again." });
    return;
  }

  const incomingHash = hashVerificationToken(decodeURIComponent(token));
  if (!user.emailOtpCode || user.emailOtpCode !== incomingHash) {
    await recordFailedAttempt(verifyKey, 5, 15);
    addAuditEntry({ action: "email_verify_failed", ip, details: `Invalid verification token for ${normalizedEmail}`, result: "fail" });
    res.status(401).json({ error: "Invalid or expired verification link" });
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
async function issueTokensForUser(user: any, ip: string, method: string, userAgent?: string) {
  const accessToken = signAccessToken(user.id, user.phone ?? "", user.role ?? "customer", user.roles ?? user.role ?? "customer", user.tokenVersion ?? 0);
  const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokensTable).values({ id: generateId(), userId: user.id, tokenHash: refreshHash, authMethod: method, expiresAt: refreshExpiresAt });
  db.delete(refreshTokensTable).where(and(eq(refreshTokensTable.userId, user.id), lt(refreshTokensTable.expiresAt, new Date()))).catch(() => {});
  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
  writeAuthAuditLog("login_success", { userId: user.id, ip, userAgent, metadata: { method } });

  return {
    token: accessToken,
    refreshToken: refreshRaw,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
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
function isDeviceTrusted(user: any, deviceFingerprint: string, trustedDays: number): boolean {
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
  if (!idToken) { res.status(400).json({ error: "idToken required" }); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabledStrict(settings, "auth_google_enabled", "auth_social_google")) {
    res.status(403).json({ error: "Google login is currently disabled" }); return;
  }

  let googlePayload: any;
  try {
    const resp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) throw new Error("Invalid token");
    googlePayload = await resp.json();
  } catch {
    addSecurityEvent({ type: "social_google_invalid_token", ip, details: "Invalid Google ID token", severity: "medium" });
    res.status(401).json({ error: "Invalid Google token" }); return;
  }

  const googleId = googlePayload.sub;
  const email = googlePayload.email?.toLowerCase?.() ?? null;
  const name = googlePayload.name ?? null;
  const avatar = googlePayload.picture ?? null;

  if (!googleId) { res.status(401).json({ error: "Google token missing sub" }); return; }

  let [user] = await db.select().from(usersTable).where(eq(usersTable.googleId, googleId)).limit(1);

  if (!user && email) {
    [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (user) {
      await db.update(usersTable).set({ googleId, updatedAt: new Date() }).where(eq(usersTable.id, user.id));
      user.googleId = googleId;
    }
  }

  const isNewUser = !user;

  const googleEffectiveRole = user?.role ?? ((req.body?.role === "rider" || req.body?.role === "vendor") ? req.body.role : "customer");
  if (!isAuthMethodEnabledStrict(settings, "auth_google_enabled", "auth_social_google", googleEffectiveRole)) {
    res.status(403).json({ error: "Google login is currently disabled for your account type." }); return;
  }

  if (!user) {
    if (settings["feature_new_users"] === "off") {
      res.status(403).json({ error: "New user registration is currently disabled" }); return;
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

  if (user!.isBanned) { res.status(403).json({ error: "Account suspended" }); return; }
  if (!user!.isActive && user!.approvalStatus !== "pending") { res.status(403).json({ error: "Account inactive" }); return; }

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
  if (!fbToken) { res.status(400).json({ error: "accessToken required" }); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabledStrict(settings, "auth_facebook_enabled", "auth_social_facebook")) {
    res.status(403).json({ error: "Facebook login is currently disabled" }); return;
  }

  let fbPayload: any;
  try {
    const resp = await fetch(`https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${encodeURIComponent(fbToken)}`, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) throw new Error("Invalid token");
    fbPayload = await resp.json();
  } catch {
    addSecurityEvent({ type: "social_facebook_invalid_token", ip, details: "Invalid Facebook access token", severity: "medium" });
    res.status(401).json({ error: "Invalid Facebook token" }); return;
  }

  const facebookId = fbPayload.id;
  const email = fbPayload.email?.toLowerCase?.() ?? null;
  const name = fbPayload.name ?? null;
  const avatar = fbPayload.picture?.data?.url ?? null;

  if (!facebookId) { res.status(401).json({ error: "Facebook token missing id" }); return; }

  let [user] = await db.select().from(usersTable).where(eq(usersTable.facebookId, facebookId)).limit(1);

  if (!user && email) {
    [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (user) {
      await db.update(usersTable).set({ facebookId, updatedAt: new Date() }).where(eq(usersTable.id, user.id));
      user.facebookId = facebookId;
    }
  }

  const isNewUser = !user;

  const fbEffectiveRole = user?.role ?? ((req.body?.role === "rider" || req.body?.role === "vendor") ? req.body.role : "customer");
  if (!isAuthMethodEnabledStrict(settings, "auth_facebook_enabled", "auth_social_facebook", fbEffectiveRole)) {
    res.status(403).json({ error: "Facebook login is currently disabled for your account type." }); return;
  }

  if (!user) {
    if (settings["feature_new_users"] === "off") {
      res.status(403).json({ error: "New user registration is currently disabled" }); return;
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

  if (user!.isBanned) { res.status(403).json({ error: "Account suspended" }); return; }
  if (!user!.isActive && user!.approvalStatus !== "pending") { res.status(403).json({ error: "Account inactive" }); return; }

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
  if (!auth) { res.status(401).json({ error: "Authentication required" }); return; }

  const settings = await getCachedSettings();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (!isAuthMethodEnabled(settings, "auth_2fa_enabled", user.role ?? undefined)) {
    res.status(403).json({ error: "Two-factor authentication is currently disabled" }); return;
  }
  if (user.totpEnabled) { res.status(409).json({ error: "2FA is already enabled" }); return; }

  const secret = generateTotpSecret();
  const label = user.email ?? user.phone ?? user.name ?? auth.userId;
  const uri = getTotpUri(secret, label);

  const encryptedSecret = encryptTotpSecret(secret);
  await db.update(usersTable).set({ totpSecret: encryptedSecret, updatedAt: new Date() }).where(eq(usersTable.id, auth.userId));

  let qrDataUrl: string | null = null;
  try { qrDataUrl = await generateQRCodeDataURL(secret, label); } catch {}

  res.json({ secret, uri, qrDataUrl });
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/2fa/verify-setup
   Confirm first TOTP code, activate 2FA, return backup codes.
   Body: { code }
══════════════════════════════════════════════════════════════ */
router.post("/2fa/verify-setup", async (req, res) => {
  const auth = extractAuthUser(req);
  if (!auth) { res.status(401).json({ error: "Authentication required" }); return; }

  const { code } = req.body;
  if (!code) { res.status(400).json({ error: "TOTP code required" }); return; }

  const settings = await getCachedSettings();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (!isAuthMethodEnabled(settings, "auth_2fa_enabled", user.role ?? undefined)) {
    res.status(403).json({ error: "Two-factor authentication is currently disabled" }); return;
  }
  if (user.totpEnabled) { res.status(409).json({ error: "2FA is already enabled" }); return; }
  if (!user.totpSecret) { res.status(400).json({ error: "Please call /auth/2fa/setup first" }); return; }

  const secret = decryptTotpSecret(user.totpSecret);
  if (!verifyTotpToken(code, secret)) {
    res.status(401).json({ error: "Invalid TOTP code. Please try again." }); return;
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
  if (!tempToken || !code) { res.status(400).json({ error: "tempToken and code required" }); return; }

  const challengePayload = verify2faChallengeToken(tempToken);
  if (!challengePayload) { res.status(401).json({ error: "Invalid or expired 2FA challenge token" }); return; }

  const settings = await getCachedSettings();
  const ip = getClientIp(req);

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, challengePayload.userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (!isAuthMethodEnabled(settings, "auth_2fa_enabled", user.role ?? undefined)) {
    res.status(403).json({ error: "Two-factor authentication has been disabled by admin." }); return;
  }

  if (!user.totpEnabled || !user.totpSecret) { res.status(400).json({ error: "2FA is not enabled" }); return; }

  const secret = decryptTotpSecret(user.totpSecret);
  if (!verifyTotpToken(code, secret)) {
    addSecurityEvent({ type: "2fa_verify_failed", ip, userId: user.id, details: "Invalid 2FA code on login", severity: "medium" });
    res.status(401).json({ error: "Invalid 2FA code" }); return;
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
  if (!auth) { res.status(401).json({ error: "Authentication required" }); return; }

  const { code } = req.body;
  if (!code) { res.status(400).json({ error: "TOTP code required to disable 2FA" }); return; }

  const settings = await getCachedSettings();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (!isAuthMethodEnabled(settings, "auth_2fa_enabled", user.role ?? undefined)) {
    res.status(403).json({ error: "Two-factor authentication has been disabled by admin." }); return;
  }

  if (!user.totpEnabled || !user.totpSecret) { res.status(400).json({ error: "2FA is not enabled" }); return; }

  const secret = decryptTotpSecret(user.totpSecret);
  if (!verifyTotpToken(code, secret)) {
    res.status(401).json({ error: "Invalid TOTP code" }); return;
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
  if (!tempToken || !backupCode) { res.status(400).json({ error: "tempToken and backupCode required" }); return; }

  const challengePayload = verify2faChallengeToken(tempToken);
  if (!challengePayload) { res.status(401).json({ error: "Invalid or expired 2FA challenge token" }); return; }

  const ip = getClientIp(req);

  const settings = await getCachedSettings();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, challengePayload.userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (!isAuthMethodEnabled(settings, "auth_2fa_enabled", user.role ?? undefined)) {
    res.status(403).json({ error: "Two-factor authentication has been disabled by admin." }); return;
  }

  if (!user.totpEnabled || !user.backupCodes) { res.status(400).json({ error: "2FA is not enabled or no backup codes available" }); return; }

  let storedCodes: string[];
  try { storedCodes = JSON.parse(user.backupCodes); } catch { res.status(500).json({ error: "Internal error" }); return; }

  let matchIdx = -1;
  for (let i = 0; i < storedCodes.length; i++) {
    if (verifyPassword(backupCode, storedCodes[i]!)) { matchIdx = i; break; }
  }

  if (matchIdx === -1) {
    addSecurityEvent({ type: "2fa_recovery_failed", ip, userId: user.id, details: "Invalid backup code attempt", severity: "high" });
    res.status(401).json({ error: "Invalid backup code" }); return;
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
  if (!auth) { res.status(401).json({ error: "Authentication required" }); return; }

  const { deviceFingerprint } = req.body;
  if (!deviceFingerprint || typeof deviceFingerprint !== "string" || deviceFingerprint.length < 8) {
    res.status(400).json({ error: "Valid deviceFingerprint required (min 8 chars)" }); return;
  }

  const settings = await getCachedSettings();
  const trustedDays = parseInt(settings["auth_trusted_device_days"] ?? "30", 10);

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (!isAuthMethodEnabled(settings, "auth_2fa_enabled", user.role ?? undefined)) {
    res.status(403).json({ error: "Two-factor authentication has been disabled by admin." }); return;
  }

  if (!user.totpEnabled) { res.status(400).json({ error: "2FA is not enabled" }); return; }

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
  if (!email || !email.includes("@")) { res.status(400).json({ error: "Valid email address required" }); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabledStrict(settings, "auth_magic_link_enabled", "auth_magic_link")) {
    res.status(403).json({ error: "Magic link login is currently disabled" }); return;
  }

  const normalized = email.toLowerCase().trim();

  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const rlKey = `ml:${normalized}`;
  const rl = magicLinkRateMap.get(rlKey);
  if (rl && now - rl.windowStart < windowMs) {
    if (rl.count >= 3) {
      const waitMin = Math.ceil((rl.windowStart + windowMs - now) / 60000);
      res.status(429).json({ error: `Too many magic link requests. Try again in ${waitMin} minute(s).` }); return;
    }
    rl.count++;
  } else {
    magicLinkRateMap.set(rlKey, { count: 1, windowStart: now });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
  if (!user) {
    res.json({ message: "If an account exists with this email, a magic link has been sent." }); return;
  }

  const effectiveMagicRole = user.role ?? ((req.body?.role === "rider" || req.body?.role === "vendor") ? req.body.role : "customer");
  if (!isAuthMethodEnabledStrict(settings, "auth_magic_link_enabled", "auth_magic_link", effectiveMagicRole)) {
    res.status(403).json({ error: "Magic link login is currently disabled for your account type." }); return;
  }

  if (user.isBanned) { res.status(403).json({ error: "Account suspended" }); return; }
  if (!user.isActive) { res.status(403).json({ error: "Account inactive" }); return; }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashPassword(rawToken);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

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
  if (!token) { res.status(400).json({ error: "Token required" }); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabledStrict(settings, "auth_magic_link_enabled", "auth_magic_link")) {
    res.status(403).json({ error: "Magic link login is currently disabled" }); return;
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
    res.status(401).json({ error: "Invalid or expired magic link. Please request a new one." }); return;
  }

  await db.update(magicLinkTokensTable).set({ usedAt: new Date() }).where(eq(magicLinkTokensTable.id, matchedRow.id));

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, matchedRow.userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (user.isBanned) { res.status(403).json({ error: "Account suspended" }); return; }
  if (!user.isActive) { res.status(403).json({ error: "Account inactive" }); return; }

  if (!isAuthMethodEnabledStrict(settings, "auth_magic_link_enabled", "auth_magic_link", user.role ?? "customer")) {
    res.status(403).json({ error: "Magic link login is currently disabled for your account type." }); return;
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
        res.status(401).json({ error: "Invalid 2FA code" }); return;
      }
    }
  }

  await db.update(usersTable).set({ emailVerified: true, updatedAt: new Date() }).where(eq(usersTable.id, user.id));

  addAuditEntry({ action: "magic_link_login", ip, details: `Magic link login: ${user.email ?? matchedRow.userId}`, result: "success" });
  const result = await issueTokensForUser(user, ip, "magic_link", req.headers["user-agent"] as string);
  res.json(result);
});

export default router;
