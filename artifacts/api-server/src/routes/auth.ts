import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable, notificationsTable } from "@workspace/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
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
} from "../middleware/security.js";
import { sendOtpSMS } from "../services/sms.js";
import { sendWhatsAppOTP } from "../services/whatsapp.js";

const router: IRouter = Router();

/* ─────────────────────────────────────────────────────────────
   POST /auth/send-otp
   Atomically upsert user by phone — one account per number.
───────────────────────────────────────────────────────────── */
router.post("/send-otp", async (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    res.status(400).json({ error: "Phone number is required" });
    return;
  }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  /* ── Check if new-user registration is allowed ── */
  const existingUser = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.phone, phone))
    .limit(1);

  if (existingUser.length === 0 && settings["feature_new_users"] === "off") {
    res.status(403).json({ error: "New user registration is currently disabled. Please contact support." });
    return;
  }

  /* ── Phone verify flag: when ON, OTP bypass is disabled globally ──
     Enforcement happens in verify-otp; nothing to gate at send-otp. ── */

  /* ── Check lockout before generating new OTP ── */
  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);
  const lockoutStatus = checkLockout(phone, maxAttempts, lockoutMinutes);
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

  /* ── Check single-phone-per-account policy (already enforced by DB unique constraint) ── */

  const otp       = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  /* Atomic upsert — prevents duplicate accounts even under concurrent
     requests because the DB unique constraint on phone is the final
     authority.  If a row with this phone already exists, we ONLY update
     the OTP fields; we never touch role, wallet, or any other data. */
  await db
    .insert(usersTable)
    .values({
      id:            generateId(),
      phone,
      otpCode:       otp,
      otpExpiry,
      role:          "customer",
      roles:         "customer",
      walletBalance: "0",
      isActive:      true,
    })
    .onConflictDoUpdate({
      target: usersTable.phone,
      set: {
        otpCode:   otp,
        otpExpiry,
        updatedAt: new Date(),
      },
    });

  req.log.info({ phone, otp }, "OTP sent");

  /* ── Send OTP via SMS ── */
  const smsResult = await sendOtpSMS(phone, otp, settings);

  /* ── Also try WhatsApp as a fallback / parallel channel ── */
  if (settings["integration_whatsapp"] === "on") {
    sendWhatsAppOTP(phone, otp, settings).catch(err =>
      req.log.warn({ err: err.message }, "WhatsApp OTP send failed (non-fatal)")
    );
  }

  const isDev = process.env.NODE_ENV !== "production";
  res.json({
    message: "OTP sent successfully",
    channel: smsResult.sent ? smsResult.provider : "console",
    ...(isDev ? { otp } : {}),
  });
});

/* ─────────────────────────────────────────────────────────────
   POST /auth/verify-otp
   Validates the OTP, checks security settings, returns token.
───────────────────────────────────────────────────────────── */
router.post("/verify-otp", async (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) {
    res.status(400).json({ error: "Phone and OTP are required" });
    return;
  }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  const maxAttempts    = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"]    ?? "30", 10);

  /* ── Lockout check ── */
  const lockoutStatus = checkLockout(phone, maxAttempts, lockoutMinutes);
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

  /* ── Banned check ── */
  if (user.isBanned) {
    addSecurityEvent({ type: "banned_login_attempt", ip, userId: user.id, details: `Banned user tried to verify OTP: ${phone}`, severity: "high" });
    res.status(403).json({ error: "Your account has been suspended. Please contact support." });
    return;
  }

  /* ── Inactive check ── */
  if (!user.isActive) {
    res.status(403).json({ error: "Your account is currently inactive. Please contact support." });
    return;
  }

  /* ── OTP Bypass Mode (dev/testing only) ──
     security_phone_verify=on overrides the bypass, enforcing real OTP for all users. ── */
  const phoneVerifyRequired = settings["security_phone_verify"] === "on";
  const otpBypass = settings["security_otp_bypass"] === "on" && !phoneVerifyRequired;

  /* ── OTP code check ── */
  if (!otpBypass && user.otpCode !== otp) {
    const updated = recordFailedAttempt(phone, maxAttempts, lockoutMinutes);
    const remaining = maxAttempts - updated.attempts;

    addAuditEntry({ action: "verify_otp_failed", ip, details: `Wrong OTP for phone: ${phone}, attempt ${updated.attempts}/${maxAttempts}`, result: "fail" });

    if (updated.lockedUntil) {
      addSecurityEvent({ type: "account_locked", ip, userId: user.id, details: `Account locked after ${maxAttempts} failed OTP attempts`, severity: "high" });
      res.status(429).json({
        error: `Too many failed attempts. Account locked for ${lockoutMinutes} minutes.`,
        lockedMinutes: lockoutMinutes,
      });
    } else {
      res.status(401).json({
        error: `Invalid OTP. ${remaining > 0 ? `${remaining} attempt(s) remaining before lockout.` : "Next failure will lock your account."}`,
        attemptsRemaining: Math.max(0, remaining),
      });
    }
    return;
  }

  /* ── OTP expiry check ── */
  if (!otpBypass && user.otpExpiry && new Date() > user.otpExpiry) {
    res.status(401).json({ error: "OTP expired. Please request a new one." });
    return;
  }

  /* ── Multi-device check ── */
  if (settings["security_multi_device"] === "off") {
    /* Single-device: invalidate existing sessions by rotating the token seed.
       We achieve this by storing a session seed in the OTP field temporarily.
       On future token validation, we can check this. For now, we clear
       any pending OTP which signals last-login is this session. */
  }

  /* ── Signup bonus on first login ── */
  const isFirstLogin = !user.lastLoginAt;
  if (isFirstLogin) {
    const signupBonus = parseFloat(settings["customer_signup_bonus"] ?? "0");
    if (signupBonus > 0) {
      await db.update(usersTable)
        .set({ walletBalance: (parseFloat(user.walletBalance ?? "0") + signupBonus).toFixed(2) })
        .where(eq(usersTable.id, user.id))
        .catch(() => {});
      await db.insert(walletTransactionsTable).values({
        id: generateId(), userId: user.id, type: "bonus",
        amount: signupBonus.toFixed(2),
        description: `Welcome bonus — Thanks for joining AJKMart!`,
      }).catch(() => {});
      await db.insert(notificationsTable).values({
        id: generateId(), userId: user.id,
        title: "Welcome Bonus! 🎁", body: `Rs. ${signupBonus} has been added to your wallet as a welcome bonus!`,
        type: "wallet", icon: "gift-outline",
      }).catch(() => {});
    }
  }

  /* ── Success: clear OTP + update last login ── */
  await db
    .update(usersTable)
    .set({ otpCode: null, otpExpiry: null, lastLoginAt: new Date() })
    .where(eq(usersTable.phone, phone));

  resetAttempts(phone);

  addAuditEntry({ action: "user_login", ip, details: `Successful login for phone: ${phone} (role: ${user.role})`, result: "success" });

  /* ── Role-specific session duration ── */
  const sessionDays = user.role === "rider"
    ? parseInt(settings["security_rider_token_days"] ?? "7",  10)
    : parseInt(settings["security_session_days"]     ?? "30", 10);

  /* ── Build token: userId:phone:issuedAt ── */
  const issuedAt = Date.now();
  const token = Buffer.from(`${user.id}:${phone}:${issuedAt}`).toString("base64");
  const expiresAt = new Date(issuedAt + sessionDays * 24 * 60 * 60 * 1000).toISOString();

  res.json({
    token,
    expiresAt,
    sessionDays,
    user: {
      id:            user.id,
      phone:         user.phone,
      name:          user.name,
      email:         user.email,
      role:          user.role,
      roles:         user.roles,
      avatar:        user.avatar,
      walletBalance: parseFloat(user.walletBalance ?? "0"),
      isActive:      user.isActive,
      cnic:          user.cnic,
      city:          user.city,
      createdAt:     user.createdAt.toISOString(),
    },
  });
});

/* ─────────────────────────────────────────────────────────────
   POST /auth/validate-token
   Client can use this to check if their token is still valid.
───────────────────────────────────────────────────────────── */
router.post("/validate-token", async (req, res) => {
  const { token } = req.body;
  if (!token) { res.status(400).json({ error: "token required" }); return; }

  try {
    const decoded = Buffer.from(token, "base64").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length < 3) { res.status(401).json({ valid: false, error: "Invalid token" }); return; }

    const userId   = parts[0]!;
    const issuedAt = parseInt(parts[parts.length - 1]!, 10);
    if (isNaN(issuedAt)) { res.status(401).json({ valid: false, error: "Invalid token" }); return; }

    const settings = await getCachedSettings();

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(401).json({ valid: false, error: "User not found" }); return; }
    if (user.isBanned) { res.status(403).json({ valid: false, error: "Account suspended" }); return; }
    if (!user.isActive) { res.status(403).json({ valid: false, error: "Account inactive" }); return; }

    const sessionDays = user.role === "rider"
      ? parseInt(settings["security_rider_token_days"] ?? "7",  10)
      : parseInt(settings["security_session_days"]     ?? "30", 10);
    const expiryMs = sessionDays * 24 * 60 * 60 * 1000;

    if (Date.now() - issuedAt > expiryMs) {
      res.status(401).json({ valid: false, error: "Session expired. Please log in again." });
      return;
    }

    const expiresAt = new Date(issuedAt + expiryMs).toISOString();
    res.json({ valid: true, expiresAt, userId: user.id, role: user.role });
  } catch {
    res.status(401).json({ valid: false, error: "Token validation failed" });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /auth/logout
   Clears OTP and logs the logout action.
───────────────────────────────────────────────────────────── */
router.post("/logout", async (req, res) => {
  const { userId } = req.body;
  if (userId) {
    await db.update(usersTable).set({ otpCode: null }).where(eq(usersTable.id, userId));
    addAuditEntry({ action: "user_logout", ip: getClientIp(req), details: `User logout: ${userId}`, result: "success" });
  }
  res.json({ success: true, message: "Logged out successfully" });
});

export default router;
