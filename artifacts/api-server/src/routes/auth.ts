import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable, notificationsTable, refreshTokensTable } from "@workspace/db/schema";
import { eq, and, sql, lt } from "drizzle-orm";
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
  generateRefreshToken,
  hashRefreshToken,
  isRefreshTokenValid,
  revokeRefreshToken,
  revokeAllUserRefreshTokens,
  verifyUserJwt,
  writeAuthAuditLog,
  REFRESH_TOKEN_TTL_DAYS,
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

  /* ── Per-phone OTP resend cooldown (60 s) — prevents SMS bombing ──
     OTP expiry is set to now+10 min; if it's still >9 min away the
     code was issued less than 60 seconds ago — block the resend. ── */
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

  /* ── Determine approval status for NEW users ── */
  const isNewUser = existingUser.length === 0;
  const requireApproval = (settings["user_require_approval"] ?? "off") === "on";
  const newUserApprovalStatus = isNewUser && requireApproval ? "pending" : "approved";

  const otp       = generateSecureOtp();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  /* Atomic upsert — any previously issued OTP is overwritten (invalidated),
     so it cannot be used after a new OTP is requested. */
  await db
    .insert(usersTable)
    .values({
      id:             generateId(),
      phone,
      otpCode:        otp,
      otpExpiry,
      otpUsed:        false,
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
        otpUsed:   false,
        updatedAt: new Date(),
      },
    });

  writeAuthAuditLog("otp_sent", { ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone } });
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

  /* ── Inactive check ──
     Pending-approval accounts are isActive=false but should NOT be blocked here;
     they need to pass OTP validation and receive the pendingApproval=true response. ── */
  const isPendingApproval = (settings["user_require_approval"] ?? "off") === "on" && user.approvalStatus === "pending";
  if (!user.isActive && !isPendingApproval) {
    res.status(403).json({ error: "Your account is currently inactive. Please contact support." });
    return;
  }

  /* ── OTP Bypass Mode (dev/testing only) ──
     security_phone_verify=on overrides the bypass, enforcing real OTP for all users. ── */
  const phoneVerifyRequired = settings["security_phone_verify"] === "on";
  const otpBypass = settings["security_otp_bypass"] === "on" && !phoneVerifyRequired;

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
          eq(usersTable.otpCode, otp),
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
        await tx.insert(notificationsTable).values({
          id: generateId(), userId: rows[0]!.id,
          title: "Welcome Bonus! 🎁", body: `Rs. ${signupBonus} has been added to your wallet as a welcome bonus!`,
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
        const updated = recordFailedAttempt(phone, maxAttempts, lockoutMinutes);
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

  resetAttempts(phone);

  /* ── Admin approval check ── */
  const requireApproval = (settings["user_require_approval"] ?? "off") === "on";
  if (requireApproval && user.approvalStatus === "pending") {
    addAuditEntry({ action: "user_login_pending", ip, details: `Pending approval login for phone: ${phone}`, result: "pending" });
    const token = signAccessToken(user.id, phone, user.role ?? "customer", user.roles ?? "customer", user.tokenVersion ?? 0);
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
  writeAuthAuditLog("login_success", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone, role: user.role } });

  /* ── Issue short-lived access token + long-lived refresh token ── */
  const accessToken  = signAccessToken(user.id, phone, user.role ?? "customer", user.roles ?? user.role ?? "customer", user.tokenVersion ?? 0);
  const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokensTable).values({
    id:        generateId(),
    userId:    user.id,
    tokenHash: refreshHash,
    expiresAt: refreshExpiresAt,
  });

  /* Clean up expired refresh tokens for this user (housekeeping) */
  db.delete(refreshTokensTable)
    .where(and(eq(refreshTokensTable.userId, user.id), lt(refreshTokensTable.expiresAt, new Date())))
    .catch(() => {});

  res.json({
    token:        accessToken,
    refreshToken: refreshRaw,
    expiresAt:    new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    sessionDays:  REFRESH_TOKEN_TTL_DAYS,
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

  /* Rotate: revoke old token and issue a new one */
  await revokeRefreshToken(tokenHash);

  const newAccessToken = signAccessToken(user.id, user.phone, user.role ?? "customer", user.roles ?? user.role ?? "customer", user.tokenVersion ?? 0);
  const { raw: newRefreshRaw, hash: newRefreshHash } = generateRefreshToken();
  const newRefreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokensTable).values({
    id:        generateId(),
    userId:    user.id,
    tokenHash: newRefreshHash,
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
  const rlKey = `ip:check-available:${ip}`;
  const rlStatus = checkLockout(rlKey, 20, 10);
  if (rlStatus.locked) {
    res.status(429).json({ error: `Too many requests. Try again in ${rlStatus.minutesLeft} minute(s).` }); return;
  }
  recordFailedAttempt(rlKey, 20, 10);

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

  /* Verify OTP — bypass also respects phoneVerifyRequired for consistency */
  const phoneVerifyRequired = settings["security_phone_verify"] === "on";
  const otpBypass = settings["security_otp_bypass"] === "on" && !phoneVerifyRequired;

  /* Check expiry FIRST — prevents timing oracle (attacker learning that an
     expired OTP was correct by observing which error branch fires). */
  if (!otpBypass && user.emailOtpExpiry && new Date() > user.emailOtpExpiry) {
    res.status(401).json({ error: "OTP expired. Please request a new one." }); return;
  }

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

  /* Check approval BEFORE touching the DB — a rejected user must not have their OTP cleared */
  if (user.approvalStatus === "rejected") {
    res.status(403).json({ error: "Account rejected. Contact admin.", approvalNote: user.approvalNote }); return;
  }

  /* Clear email OTP + mark email verified + update last login */
  await db.update(usersTable)
    .set({ emailOtpCode: null, emailOtpExpiry: null, emailVerified: true, lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  resetAttempts(normalized);

  addAuditEntry({ action: "email_login", ip, details: `Email OTP login for: ${normalized}`, result: "success" });

  const requireApproval = (settings["user_require_approval"] ?? "off") === "on";
  const isPendingApproval = requireApproval && user.approvalStatus === "pending";

  /* Issue short-lived access token + refresh token (consistent with OTP flow) */
  const accessToken = signAccessToken(user.id, user.phone ?? normalized, user.role ?? "customer", user.roles ?? "customer", user.tokenVersion ?? 0);
  const expiresAt   = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  if (isPendingApproval) {
    res.json({
      token: accessToken, expiresAt, pendingApproval: true,
      message: "Aapka account admin approval ke liye bheja gaya hai.",
      user: { id: user.id, phone: user.phone, name: user.name, role: user.role, approvalStatus: "pending" },
    });
    return;
  }

  const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(refreshTokensTable).values({ id: generateId(), userId: user.id, tokenHash: refreshHash, expiresAt: refreshExpiresAt });
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

  const isPendingApproval = (settings["user_require_approval"] ?? "off") === "on" && user.approvalStatus === "pending";

  const accessToken = signAccessToken(user.id, user.phone ?? "", user.role ?? "customer", user.roles ?? "customer", user.tokenVersion ?? 0);
  const expiresAt   = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  if (isPendingApproval) {
    res.json({
      token: accessToken, expiresAt, pendingApproval: true,
      message: "Aapka account admin approval ke liye bheja gaya hai.",
      user: { id: user.id, phone: user.phone, name: user.name, role: user.role, approvalStatus: "pending" },
    });
    return;
  }

  const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(refreshTokensTable).values({ id: generateId(), userId: user.id, tokenHash: refreshHash, expiresAt: refreshExpiresAt });
  db.delete(refreshTokensTable).where(and(eq(refreshTokensTable.userId, user.id), lt(refreshTokensTable.expiresAt, new Date()))).catch(() => {});

  writeAuthAuditLog("login_success", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { method: "username_password" } });

  res.json({
    token:        accessToken,
    refreshToken: refreshRaw,
    expiresAt,
    sessionDays:  REFRESH_TOKEN_TTL_DAYS,
    pendingApproval: false,
    user: { id: user.id, phone: user.phone, name: user.name, email: user.email, username: user.username, role: user.role, roles: user.roles, avatar: user.avatar, walletBalance: parseFloat(user.walletBalance ?? "0"), emailVerified: user.emailVerified ?? false, phoneVerified: user.phoneVerified ?? false },
  });
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/complete-profile
   Set name, email, username, password for first-time setup.
   Requires valid JWT. Body: { token, name, email?, username?, password? }
══════════════════════════════════════════════════════════════ */
router.post("/complete-profile", async (req, res) => {
  /* Accept token from body OR Authorization: Bearer header */
  const authHeader = req.headers["authorization"] as string | undefined;
  const rawToken = req.body?.token || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
  const { name, email, username, password, currentPassword } = req.body;
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
      const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, clean)).limit(1);
      if (existing && existing.id !== userId) {
        res.status(409).json({ error: "Yeh username pehle se liya hua hai" }); return;
      }
    }
    updates.username = clean;
  }

  if (password && password.length >= 8) {
    /* If a password already exists, require the current one — same rule as set-password */
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

  await db.update(usersTable).set({ passwordHash: hashPassword(password), updatedAt: new Date() }).where(eq(usersTable.id, userId));
  res.json({ success: true, message: "Password set ho gaya" });
});

export default router;
