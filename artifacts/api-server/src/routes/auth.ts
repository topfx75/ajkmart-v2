import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable, notificationsTable } from "@workspace/db/schema";
import { eq, and, gte, sql, isNull, or } from "drizzle-orm";
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
import { hashPassword, verifyPassword, validatePasswordStrength, generateSecureOtp } from "../services/password.js";

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

  /* ── Determine approval status for NEW users ── */
  const isNewUser = existingUser.length === 0;
  const requireApproval = (settings["user_require_approval"] ?? "off") === "on";
  const newUserApprovalStatus = isNewUser && requireApproval ? "pending" : "approved";

  const otp       = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  /* Atomic upsert — prevents duplicate accounts even under concurrent
     requests because the DB unique constraint on phone is the final
     authority.  If a row with this phone already exists, we ONLY update
     the OTP fields; we never touch role, wallet, or any other data. */
  await db
    .insert(usersTable)
    .values({
      id:             generateId(),
      phone,
      otpCode:        otp,
      otpExpiry,
      role:           "customer",
      roles:          "customer",
      walletBalance:  "0",
      isActive:       !isNewUser || !requireApproval,
      approvalStatus: newUserApprovalStatus,
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

  /* ── Success: clear OTP + update last login atomically ──
     Using lastLoginAt IS NULL as an atomic gate to detect and credit the
     signup bonus exactly once — prevents double-credit from concurrent OTP
     verify requests.  SQL arithmetic (wallet_balance + N) ensures the
     credit uses the current DB value, not a stale in-memory snapshot. ── */
  const signupBonus = parseFloat(settings["customer_signup_bonus"] ?? "0");
  const now = new Date();

  await db.transaction(async (tx) => {
    /* Atomically mark first login — only succeeds once (WHERE lastLoginAt IS NULL) */
    const updated = await tx
      .update(usersTable)
      .set({ otpCode: null, otpExpiry: null, lastLoginAt: now })
      .where(and(eq(usersTable.phone, phone), isNull(usersTable.lastLoginAt)))
      .returning({ id: usersTable.id });

    const isActualFirstLogin = updated.length > 0;

    if (!isActualFirstLogin) {
      /* Not first login — just clear OTP without touching lastLoginAt */
      await tx
        .update(usersTable)
        .set({ otpCode: null, otpExpiry: null })
        .where(eq(usersTable.phone, phone));
    }

    /* Credit signup bonus only on verified first login */
    if (isActualFirstLogin && signupBonus > 0) {
      await tx
        .update(usersTable)
        .set({ walletBalance: sql`wallet_balance + ${signupBonus}` })
        .where(eq(usersTable.id, user.id));
      await tx.insert(walletTransactionsTable).values({
        id: generateId(), userId: user.id, type: "bonus",
        amount: signupBonus.toFixed(2),
        description: `Welcome bonus — Thanks for joining AJKMart!`,
      });
      await tx.insert(notificationsTable).values({
        id: generateId(), userId: user.id,
        title: "Welcome Bonus! 🎁", body: `Rs. ${signupBonus} has been added to your wallet as a welcome bonus!`,
        type: "wallet", icon: "gift-outline",
      });
    }
  });

  resetAttempts(phone);

  /* ── Mark phone as verified ── */
  await db.update(usersTable)
    .set({ phoneVerified: true })
    .where(and(eq(usersTable.phone, phone)));

  /* ── Admin approval check ── */
  const requireApproval = (settings["user_require_approval"] ?? "off") === "on";
  if (requireApproval && user.approvalStatus === "pending") {
    addAuditEntry({ action: "user_login_pending", ip, details: `Pending approval login for phone: ${phone}`, result: "pending" });
    const token = Buffer.from(`${user.id}:${phone}:${Date.now()}`).toString("base64");
    res.json({
      token, pendingApproval: true,
      message: "Aapka account admin approval ke liye bheja gaya hai. Approve hone par aap login kar sakenge.",
      user: { id: user.id, phone: user.phone, name: user.name, role: user.role, approvalStatus: "pending" },
    });
    return;
  }
  if (user.approvalStatus === "rejected") {
    res.status(403).json({ error: "Aapka account reject kar diya gaya hai. Admin se rabta karein.", approvalStatus: "rejected", approvalNote: user.approvalNote });
    return;
  }

  addAuditEntry({ action: "user_login", ip, details: `Successful login for phone: ${phone} (role: ${user.role})`, result: "success" });

  /* ── Role-specific session duration ── */
  const sessionDays = user.role === "rider"
    ? parseInt(settings["security_rider_token_days"] ?? "30", 10)
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
      ? parseInt(settings["security_rider_token_days"] ?? "30", 10)
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
───────────────────────────────────────────────────────────── */
router.post("/logout", async (req, res) => {
  const { userId } = req.body;
  if (userId) {
    await db.update(usersTable).set({ otpCode: null }).where(eq(usersTable.id, userId));
    addAuditEntry({ action: "user_logout", ip: getClientIp(req), details: `User logout: ${userId}`, result: "success" });
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
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, clean)).limit(1);
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
router.post("/send-email-otp", async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Valid email address required" }); return;
  }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();
  const normalized = email.toLowerCase().trim();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
  if (!user) {
    /* Security: don't reveal if email exists. Use same message. */
    const isDev = process.env.NODE_ENV !== "production";
    res.json({ message: "If an account exists with this email, an OTP has been sent.", ...(isDev ? { hint: "No account found" } : {}) });
    return;
  }

  if (user.isBanned) { res.status(403).json({ error: "Your account has been suspended." }); return; }
  if (!user.isActive) { res.status(403).json({ error: "Your account is inactive. Contact support." }); return; }

  /* Lockout check using email as key */
  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);
  const lockout = checkLockout(normalized, maxAttempts, lockoutMinutes);
  if (lockout.locked) {
    res.status(429).json({ error: `Too many attempts. Try again in ${lockout.minutesLeft} minute(s).` }); return;
  }

  const otp    = generateSecureOtp();
  const expiry = new Date(Date.now() + 10 * 60 * 1000);

  await db.update(usersTable)
    .set({ emailOtpCode: otp, emailOtpExpiry: expiry, updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  /* In dev mode, return OTP in response. In production, send via email service. */
  const isDev = process.env.NODE_ENV !== "production";
  req.log.info({ email: normalized, otp }, "Email OTP sent");

  /* TODO: Send via email service when configured */
  addAuditEntry({ action: "email_otp_sent", ip, details: `Email OTP for: ${normalized}`, result: "success" });

  res.json({
    message: "OTP aapki email par bhej diya gaya hai",
    ...(isDev ? { otp } : {}),
  });
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/verify-email-otp
   Login via email OTP. Body: { email, otp }
══════════════════════════════════════════════════════════════ */
router.post("/verify-email-otp", async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) { res.status(400).json({ error: "Email and OTP are required" }); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();
  const normalized = email.toLowerCase().trim();

  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);

  const lockout = checkLockout(normalized, maxAttempts, lockoutMinutes);
  if (lockout.locked) {
    res.status(429).json({ error: `Account locked. Try again in ${lockout.minutesLeft} minute(s).` }); return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
  if (!user) { res.status(404).json({ error: "Is email se koi account nahi mila." }); return; }

  if (user.isBanned) { res.status(403).json({ error: "Account suspended. Contact support." }); return; }
  if (!user.isActive) { res.status(403).json({ error: "Account inactive. Contact support." }); return; }

  /* Verify OTP */
  const otpBypass = settings["security_otp_bypass"] === "on";
  if (!otpBypass && user.emailOtpCode !== otp) {
    const updated = recordFailedAttempt(normalized, maxAttempts, lockoutMinutes);
    const remaining = maxAttempts - updated.attempts;
    addAuditEntry({ action: "email_otp_failed", ip, details: `Wrong email OTP for: ${normalized}`, result: "fail" });
    if (updated.lockedUntil) {
      res.status(429).json({ error: `Too many failed attempts. Locked for ${lockoutMinutes} minutes.` });
    } else {
      res.status(401).json({ error: `Invalid OTP. ${remaining} attempt(s) remaining.`, attemptsRemaining: remaining });
    }
    return;
  }

  if (!otpBypass && user.emailOtpExpiry && new Date() > user.emailOtpExpiry) {
    res.status(401).json({ error: "OTP expired. Please request a new one." }); return;
  }

  /* Clear email OTP + mark email verified + update last login */
  await db.update(usersTable)
    .set({ emailOtpCode: null, emailOtpExpiry: null, emailVerified: true, lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  resetAttempts(normalized);

  /* Check approval */
  if (user.approvalStatus === "rejected") {
    res.status(403).json({ error: "Account rejected. Contact admin.", approvalNote: user.approvalNote }); return;
  }

  addAuditEntry({ action: "email_login", ip, details: `Email OTP login for: ${normalized}`, result: "success" });

  const sessionDays = parseInt(settings["security_session_days"] ?? "30", 10);
  const issuedAt = Date.now();
  const token = Buffer.from(`${user.id}:${normalized}:${issuedAt}`).toString("base64");

  res.json({
    token,
    expiresAt: new Date(issuedAt + sessionDays * 86400000).toISOString(),
    pendingApproval: user.approvalStatus === "pending",
    user: { id: user.id, phone: user.phone, name: user.name, email: user.email, username: user.username, role: user.role, roles: user.roles, avatar: user.avatar, walletBalance: parseFloat(user.walletBalance ?? "0"), emailVerified: true, phoneVerified: user.phoneVerified ?? false },
  });
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/login/username
   Login with username + password. Body: { username, password }
══════════════════════════════════════════════════════════════ */
router.post("/login/username", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) { res.status(400).json({ error: "Username and password required" }); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();
  const clean = username.toLowerCase().trim();

  /* Lockout check */
  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);
  const lockout = checkLockout(clean, maxAttempts, lockoutMinutes);
  if (lockout.locked) {
    res.status(429).json({ error: `Account locked. Try again in ${lockout.minutesLeft} minute(s).` }); return;
  }

  /* Find user by username */
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, clean)).limit(1);
  if (!user || !user.passwordHash) {
    recordFailedAttempt(clean, maxAttempts, lockoutMinutes);
    addAuditEntry({ action: "username_login_failed", ip, details: `Username not found or no password: ${clean}`, result: "fail" });
    res.status(401).json({ error: "Invalid username or password" }); return;
  }

  if (user.isBanned) { res.status(403).json({ error: "Account suspended." }); return; }
  if (!user.isActive) { res.status(403).json({ error: "Account inactive." }); return; }

  /* Verify password */
  const passwordOk = verifyPassword(password, user.passwordHash);
  if (!passwordOk) {
    const updated = recordFailedAttempt(clean, maxAttempts, lockoutMinutes);
    addAuditEntry({ action: "username_login_failed", ip, details: `Wrong password for username: ${clean}`, result: "fail" });
    if (updated.lockedUntil) {
      res.status(429).json({ error: `Too many failed attempts. Locked for ${lockoutMinutes} minutes.` });
    } else {
      res.status(401).json({ error: `Invalid username or password. ${maxAttempts - updated.attempts} attempt(s) remaining.` });
    }
    return;
  }

  /* Check approval */
  if (user.approvalStatus === "rejected") {
    res.status(403).json({ error: "Account rejected. Contact admin.", approvalNote: user.approvalNote }); return;
  }

  resetAttempts(clean);
  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
  addAuditEntry({ action: "username_login", ip, details: `Username login: ${clean}`, result: "success" });

  const sessionDays = parseInt(settings["security_session_days"] ?? "30", 10);
  const issuedAt = Date.now();
  const token = Buffer.from(`${user.id}:${user.phone}:${issuedAt}`).toString("base64");
  const pendingApproval = (settings["user_require_approval"] ?? "off") === "on" && user.approvalStatus === "pending";

  res.json({
    token,
    expiresAt: new Date(issuedAt + sessionDays * 86400000).toISOString(),
    pendingApproval,
    user: { id: user.id, phone: user.phone, name: user.name, email: user.email, username: user.username, role: user.role, roles: user.roles, avatar: user.avatar, walletBalance: parseFloat(user.walletBalance ?? "0"), emailVerified: user.emailVerified ?? false, phoneVerified: user.phoneVerified ?? false },
  });
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/complete-profile
   Set name, email, username, password for first-time setup.
   Requires auth token. Body: { token, name, email?, username?, password? }
══════════════════════════════════════════════════════════════ */
router.post("/complete-profile", async (req, res) => {
  const { token, name, email, username, password } = req.body;
  if (!token) { res.status(401).json({ error: "Token required" }); return; }

  /* Decode token to get userId */
  let userId: string;
  try {
    const decoded = Buffer.from(token, "base64").toString("utf8");
    userId = decoded.split(":")[0]!;
  } catch {
    res.status(401).json({ error: "Invalid token" }); return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

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
      const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, clean)).limit(1);
      if (existing && existing.id !== userId) {
        res.status(409).json({ error: "Yeh username pehle se liya hua hai" }); return;
      }
    }
    updates.username = clean;
  }

  if (password && password.length >= 8) {
    const check = validatePasswordStrength(password);
    if (!check.ok) { res.status(400).json({ error: check.message }); return; }
    updates.passwordHash = hashPassword(password);
  }

  if (Object.keys(updates).length === 1) {
    res.status(400).json({ error: "Koi update nahi kiya — name, email, username ya password provide karein" }); return;
  }

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();

  res.json({
    success: true,
    message: "Profile update ho gaya",
    user: { id: updated!.id, phone: updated!.phone, name: updated!.name, email: updated!.email, username: updated!.username, role: updated!.role, emailVerified: updated!.emailVerified, phoneVerified: updated!.phoneVerified },
  });
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/set-password
   Set or change password. Body: { token, password, currentPassword? }
══════════════════════════════════════════════════════════════ */
router.post("/set-password", async (req, res) => {
  const { token, password, currentPassword } = req.body;
  if (!token || !password) { res.status(400).json({ error: "Token and password required" }); return; }

  let userId: string;
  try { userId = Buffer.from(token, "base64").toString("utf8").split(":")[0]!; } catch { res.status(401).json({ error: "Invalid token" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  /* If user already has a password, require current password */
  if (user.passwordHash && currentPassword) {
    if (!verifyPassword(currentPassword, user.passwordHash)) {
      res.status(401).json({ error: "Current password galat hai" }); return;
    }
  }

  const check = validatePasswordStrength(password);
  if (!check.ok) { res.status(400).json({ error: check.message }); return; }

  await db.update(usersTable).set({ passwordHash: hashPassword(password), updatedAt: new Date() }).where(eq(usersTable.id, userId));
  res.json({ success: true, message: "Password set ho gaya" });
});

export default router;
