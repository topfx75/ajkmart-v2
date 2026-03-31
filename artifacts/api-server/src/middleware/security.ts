import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { db } from "@workspace/db";
import { usersTable, refreshTokensTable, authAuditLogTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { getPlatformSettings } from "../routes/admin.js";
import { generateId } from "../lib/id.js";

/* ══════════════════════════════════════════════════════════════
   JWT CONFIGURATION — fail-fast if secret is absent or too short
══════════════════════════════════════════════════════════════ */
const _jwtSecret = process.env["JWT_SECRET"];
if (!_jwtSecret || _jwtSecret.length < 32) {
  const msg = !_jwtSecret
    ? "[AUTH] FATAL: JWT_SECRET environment variable is not set. Minimum 32 characters required."
    : `[AUTH] FATAL: JWT_SECRET too short (${_jwtSecret.length} chars, need ≥32).`;
  console.error(msg);
  process.exit(1);
}
export const JWT_SECRET: string = _jwtSecret;

/* Access token TTL: 15 minutes */
export const ACCESS_TOKEN_TTL_SEC = 15 * 60;
/* Refresh token TTL: 30 days */
export const REFRESH_TOKEN_TTL_DAYS = 30;

/* ══════════════════════════════════════════════════════════════
   ADMIN JWT CONFIGURATION — separate from user JWT
══════════════════════════════════════════════════════════════ */
const _adminJwtSecret = process.env["ADMIN_JWT_SECRET"];
if (!_adminJwtSecret) {
  console.error("FATAL: ADMIN_JWT_SECRET environment variable is required");
  process.exit(1);
}
export const ADMIN_JWT_SECRET: string = _adminJwtSecret;
export const ADMIN_TOKEN_TTL_HRS = 4;

/* ══════════════════════════════════════════════════════════════
   TOR EXIT NODE DETECTION
══════════════════════════════════════════════════════════════ */
let torExitNodes: Set<string> = new Set();
let torListFetchedAt = 0;
const TOR_LIST_TTL_MS = 60 * 60 * 1000;

async function refreshTorExitNodes(): Promise<void> {
  try {
    const resp = await fetch("https://check.torproject.org/torbulkexitlist", {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      const msg = `TOR list HTTP error ${resp.status}`;
      console.warn(`[TOR] Failed to refresh exit node list: ${msg}`);
      addSecurityEvent({ type: "tor_list_refresh_failed", ip: "server", details: msg, severity: "low" });
      return;
    }
    const text = await resp.text();
    const ips = text.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    torExitNodes = new Set(ips);
    torListFetchedAt = Date.now();
    console.log(`[TOR] Refreshed exit node list: ${torExitNodes.size} nodes`);
  } catch (err: any) {
    const msg = err?.message ?? "unknown error";
    console.warn(`[TOR] Failed to fetch exit node list: ${msg}`);
    addSecurityEvent({ type: "tor_list_refresh_failed", ip: "server", details: `TOR list fetch error: ${msg}`, severity: "low" });
  }
}

async function isTorExitNode(ip: string): Promise<boolean> {
  if (Date.now() - torListFetchedAt > TOR_LIST_TTL_MS) {
    await refreshTorExitNodes();
  }
  return torExitNodes.has(ip);
}

/* ══════════════════════════════════════════════════════════════
   VPN / PROXY DETECTION
══════════════════════════════════════════════════════════════ */
const vpnCache: Map<string, { isVpn: boolean; cachedAt: number }> = new Map();
const VPN_CACHE_TTL_MS = 10 * 60 * 1000;

async function isVpnOrProxy(ip: string): Promise<boolean> {
  const cached = vpnCache.get(ip);
  if (cached && Date.now() - cached.cachedAt < VPN_CACHE_TTL_MS) {
    return cached.isVpn;
  }

  if (ip === "unknown" || ip.startsWith("127.") || ip.startsWith("::1") || ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("172.")) {
    return false;
  }

  try {
    const resp = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,proxy,hosting`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) {
      console.warn(`[VPN] Check failed for IP ${ip}: HTTP ${resp.status} — flagging as check_failed`);
      addSecurityEvent({ type: "vpn_check_failed", ip, details: `VPN check HTTP error ${resp.status}`, severity: "low" });
      return false;
    }
    const data = await resp.json() as any;
    const isVpn = data.status === "success" && (data.proxy === true || data.hosting === true);
    vpnCache.set(ip, { isVpn, cachedAt: Date.now() });
    return isVpn;
  } catch (err: any) {
    console.warn(`[VPN] Check failed for IP ${ip}: ${err?.message ?? "unknown error"} — flagging as check_failed`);
    addSecurityEvent({ type: "vpn_check_failed", ip, details: `VPN check error: ${err?.message ?? "unknown"}`, severity: "low" });
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════
   IN-MEMORY STORES
══════════════════════════════════════════════════════════════ */
const ipRateStore = new Map<string, { count: number; windowStart: number }>();
export const blockedIPs = new Set<string>();
export const loginAttempts = new Map<string, { attempts: number; lockedUntil: number | null }>();

export interface AuditEntry {
  timestamp: string;
  action: string;
  adminId?: string;
  ip: string;
  details: string;
  result: "success" | "fail" | "warn" | "pending";
}
export const auditLog: AuditEntry[] = [];

export interface SecurityEvent {
  timestamp: string;
  type: string;
  ip: string;
  userId?: string;
  details: string;
  severity: "low" | "medium" | "high" | "critical";
}
export const securityEvents: SecurityEvent[] = [];

/* ══════════════════════════════════════════════════════════════
   IP HELPERS
══════════════════════════════════════════════════════════════ */
export function getClientIp(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

/* ══════════════════════════════════════════════════════════════
   AUDIT LOG (in-memory ring buffer)
══════════════════════════════════════════════════════════════ */
export function addAuditEntry(entry: Omit<AuditEntry, "timestamp">) {
  if (settingsCache["security_audit_log"] === "off") return;
  auditLog.unshift({ ...entry, timestamp: new Date().toISOString() });
  if (auditLog.length > 2000) auditLog.splice(2000);
}

export function addSecurityEvent(event: Omit<SecurityEvent, "timestamp">) {
  securityEvents.unshift({ ...event, timestamp: new Date().toISOString() });
  if (securityEvents.length > 2000) securityEvents.splice(2000);
}

/* ══════════════════════════════════════════════════════════════
   PERSISTENT AUTH AUDIT LOG
   Writes to the auth_audit_log DB table for cross-session durability.
══════════════════════════════════════════════════════════════ */
export async function writeAuthAuditLog(
  event: string,
  opts: {
    userId?: string;
    ip?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
  } = {}
): Promise<void> {
  try {
    await db.insert(authAuditLogTable).values({
      id:        generateId(),
      userId:    opts.userId ?? null,
      event,
      ip:        opts.ip ?? "unknown",
      userAgent: opts.userAgent ?? null,
      metadata:  opts.metadata ? JSON.stringify(opts.metadata) : null,
    });
  } catch {
    /* Non-fatal — never let audit log writes crash the main flow */
  }
}

/* ══════════════════════════════════════════════════════════════
   JWT HELPERS — HS256 pinned, iat validation, algorithm confusion prevention
══════════════════════════════════════════════════════════════ */
export interface JwtUserPayload {
  userId: string;
  phone: string;
  role: string;
  roles: string;
  tokenVersion?: number;
  exp?: number;
  iat?: number;
}

export function signUserJwt(
  userId: string,
  phone: string,
  role: string,
  roles: string,
  sessionDays: number,
): string {
  return jwt.sign(
    { sub: userId, phone, role, roles },
    JWT_SECRET,
    { algorithm: "HS256", expiresIn: `${sessionDays}d` },
  );
}

/** Sign a short-lived access token (15 minutes), embedding tokenVersion for revocation checks. */
export function signAccessToken(userId: string, phone: string, role: string, roles: string, tokenVersion = 0): string {
  return jwt.sign(
    { sub: userId, phone, role, roles, tokenVersion, type: "access" },
    JWT_SECRET,
    { algorithm: "HS256", expiresIn: ACCESS_TOKEN_TTL_SEC },
  );
}

export function sign2faChallengeToken(userId: string, phone: string, role: string, roles: string): string {
  return jwt.sign(
    { sub: userId, phone, role, roles, type: "2fa_challenge" },
    JWT_SECRET,
    { algorithm: "HS256", expiresIn: 300 },
  );
}

export interface TwoFaChallengePayload {
  userId: string;
  phone: string;
  role: string;
  roles: string;
}

export function verify2faChallengeToken(token: string): TwoFaChallengePayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    if ((payload as Record<string, unknown>)["type"] !== "2fa_challenge") return null;
    if (!payload.sub) return null;
    return {
      userId: payload["sub"] as string,
      phone: payload["phone"] as string ?? "",
      role: payload["role"] as string ?? "customer",
      roles: payload["roles"] as string ?? "customer",
    };
  } catch {
    return null;
  }
}

/** Sign a refresh token (opaque random value). Returns the raw token and its hash. */
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(40).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

export function hashRefreshToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function verifyUserJwt(token: string): JwtUserPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    if (!payload.sub) return null;

    if ((payload as Record<string, unknown>)["type"] === "2fa_challenge") return null;

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.iat === "number" && payload.iat > nowSec + 60) {
      return null;
    }

    return {
      userId:       payload["sub"] as string,
      phone:        payload["phone"] as string ?? "",
      role:         payload["role"]  as string ?? "customer",
      roles:        payload["roles"] as string ?? "customer",
      tokenVersion: typeof payload["tokenVersion"] === "number" ? payload["tokenVersion"] : undefined,
      exp:          typeof payload.exp === "number" ? payload.exp : undefined,
      iat:          typeof payload.iat === "number" ? payload.iat : undefined,
    };
  } catch {
    return null;
  }
}

/* ── Legacy decode: kept for internal callers ── */
export function decodeUserToken(token: string): { userId: string; phone: string; issuedAt: number } | null {
  const v = verifyUserJwt(token);
  if (!v) return null;
  const raw = jwt.decode(token) as { iat?: number } | null;
  return { userId: v.userId, phone: v.phone, issuedAt: (raw?.iat ?? 0) * 1000 };
}

/**
 * TTL-based session expiry check for legacy session-day tokens.
 * For access JWTs, revocation is handled via `tokenVersion` in `riderAuth`:
 * whenever a user changes password or logs out, `tokenVersion` is incremented
 * in the DB, and any JWT carrying a stale version is immediately rejected.
 * This function covers the additional wall-clock TTL guard for older-style
 * session tokens that may not carry a `tokenVersion` claim.
 */
export function isTokenExpired(issuedAt: number, sessionDays: number): boolean {
  const issuedAtMs = issuedAt < 1e12 ? issuedAt * 1000 : issuedAt;
  const expiryMs = issuedAtMs + sessionDays * 24 * 60 * 60 * 1000;
  return Date.now() > expiryMs;
}

/* ══════════════════════════════════════════════════════════════
   ADMIN JWT HELPERS — time-limited signed tokens (4-hour TTL)
══════════════════════════════════════════════════════════════ */
export interface AdminJwtPayload {
  adminId: string | null;
  role: string;
  name: string;
  iat?: number;
  exp?: number;
}

export function signAdminJwt(adminId: string | null, role: string, name: string, ttlHrs = ADMIN_TOKEN_TTL_HRS): string {
  return jwt.sign(
    { adminId, role, name, type: "admin" },
    ADMIN_JWT_SECRET,
    { algorithm: "HS256", expiresIn: `${ttlHrs}h` },
  );
}

export function verifyAdminJwt(token: string): AdminJwtPayload | null {
  try {
    const payload = jwt.verify(token, ADMIN_JWT_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    if ((payload as any).type !== "admin") return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.iat === "number" && payload.iat > nowSec + 60) return null;
    return {
      adminId: payload["adminId"] as string | null,
      role:    payload["role"]    as string ?? "manager",
      name:    payload["name"]    as string ?? "Admin",
      iat:     payload.iat,
      exp:     payload.exp,
    };
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════
   LOGIN LOCKOUT HELPERS
══════════════════════════════════════════════════════════════ */
export function checkLockout(
  phone: string,
  maxAttempts: number,
  lockoutMinutes: number
): { locked: boolean; minutesLeft?: number; attempts?: number } {
  const record = loginAttempts.get(phone);
  if (!record) return { locked: false, attempts: 0 };

  if (record.lockedUntil) {
    const now = Date.now();
    if (now < record.lockedUntil) {
      const minutesLeft = Math.ceil((record.lockedUntil - now) / 60000);
      return { locked: true, minutesLeft, attempts: record.attempts };
    }
    loginAttempts.delete(phone);
    return { locked: false, attempts: 0 };
  }

  return { locked: false, attempts: record.attempts };
}

export function recordFailedAttempt(phone: string, maxAttempts: number, lockoutMinutes: number) {
  const record = loginAttempts.get(phone) || { attempts: 0, lockedUntil: null };
  record.attempts += 1;
  if (record.attempts >= maxAttempts) {
    record.lockedUntil = Date.now() + lockoutMinutes * 60 * 1000;
  }
  loginAttempts.set(phone, record);
  return record;
}

export function resetAttempts(phone: string) {
  loginAttempts.delete(phone);
}

export function unlockPhone(phone: string) {
  loginAttempts.delete(phone);
}

/* ══════════════════════════════════════════════════════════════
   SETTINGS CACHE
══════════════════════════════════════════════════════════════ */
let settingsCache: Record<string, string> = {};
let settingsCacheExpiry = 0;

export async function getCachedSettings(): Promise<Record<string, string>> {
  if (Date.now() < settingsCacheExpiry) return settingsCache;
  try {
    settingsCache = await getPlatformSettings();
    settingsCacheExpiry = Date.now() + 30_000;
  } catch {}
  return settingsCache;
}

export function invalidateSettingsCache() {
  settingsCacheExpiry = 0;
}

/* ══════════════════════════════════════════════════════════════
   ROLE DETECTION
══════════════════════════════════════════════════════════════ */
function getRoleKey(req: Request): "admin" | "rider" | "vendor" | "general" {
  const url = req.url || "";
  if (req.headers["x-admin-secret"] || req.headers["x-admin-token"] || url.includes("/admin")) return "admin";

  const authHeader = req.headers["authorization"] as string | undefined;
  const tokenHeader = req.headers["x-auth-token"] as string | undefined;
  const rawToken = tokenHeader || authHeader?.replace(/^Bearer\s+/i, "");
  if (rawToken) {
    const payload = verifyUserJwt(rawToken);
    if (payload) {
      if (payload.role === "rider" || (payload.roles && payload.roles.includes("rider"))) return "rider";
      if (payload.role === "vendor" || (payload.roles && payload.roles.includes("vendor"))) return "vendor";
    }
  }
  return "general";
}

/* ══════════════════════════════════════════════════════════════
   RATE LIMITING MIDDLEWARE
══════════════════════════════════════════════════════════════ */
export async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  const ip = getClientIp(req);

  if (req.url === "/" || req.url.endsWith("/health")) { next(); return; }

  if (blockedIPs.has(ip)) {
    addSecurityEvent({ type: "blocked_ip_access", ip, details: `Blocked IP attempted access to ${req.url}`, severity: "high" });
    res.status(403).json({ error: "Access denied. Your IP address has been blocked due to suspicious activity." });
    return;
  }

  const settings = await getCachedSettings();

  if (settings["security_block_tor"] === "on") {
    const isTor = await isTorExitNode(ip);
    if (isTor) {
      blockedIPs.add(ip);
      addSecurityEvent({ type: "tor_access_blocked", ip, details: `TOR exit node blocked from ${req.url}`, severity: "high" });
      addAuditEntry({ action: "tor_block", ip, details: `Blocked TOR exit node IP`, result: "warn" });
      res.status(403).json({ error: "Access via TOR is not permitted." });
      return;
    }
  }

  if (settings["security_block_vpn"] === "on") {
    const isVpn = await isVpnOrProxy(ip);
    if (isVpn) {
      addSecurityEvent({ type: "vpn_access_blocked", ip, details: `VPN/proxy IP blocked from ${req.url}`, severity: "medium" });
      res.status(403).json({ error: "Access via VPN or proxy is not permitted." });
      return;
    }
  }

  const roleKey = getRoleKey(req);

  let limitPerMin: number;
  switch (roleKey) {
    case "admin":   limitPerMin = parseInt(settings["security_rate_admin"]  ?? "60",  10); break;
    case "rider":   limitPerMin = parseInt(settings["security_rate_rider"]  ?? "200", 10); break;
    case "vendor":  limitPerMin = parseInt(settings["security_rate_vendor"] ?? "150", 10); break;
    default:        limitPerMin = parseInt(settings["security_rate_limit"]  ?? "100", 10); break;
  }

  const burst = parseInt(settings["security_rate_burst"] ?? "20", 10);
  const hardLimit = limitPerMin + burst;

  const now = Date.now();
  const windowMs = 60_000;
  const key = `${ip}:${roleKey}`;
  const entry = ipRateStore.get(key);

  if (!entry || now - entry.windowStart > windowMs) {
    ipRateStore.set(key, { count: 1, windowStart: now });
  } else {
    entry.count++;

    if (settings["security_auto_block_ip"] === "on" && entry.count > hardLimit * 3) {
      blockedIPs.add(ip);
      addAuditEntry({ action: "auto_block_ip", ip, details: `Auto-blocked: ${entry.count} req/min far exceeds limit of ${hardLimit}`, result: "warn" });
      addSecurityEvent({ type: "ip_auto_blocked", ip, details: `Auto-blocked after ${entry.count} requests in 1 minute`, severity: "critical" });
      res.status(403).json({ error: "Your IP has been automatically blocked due to excessive requests." });
      return;
    }

    if (entry.count > hardLimit) {
      const retryAfter = Math.ceil((entry.windowStart + windowMs - now) / 1000);
      res.setHeader("Retry-After", retryAfter.toString());
      res.status(429).json({ error: "Too many requests. Please slow down.", retryAfter });
      return;
    }
  }

  next();
}

/* ══════════════════════════════════════════════════════════════
   SECURITY HEADERS MIDDLEWARE
══════════════════════════════════════════════════════════════ */
export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  next();
}

/* ══════════════════════════════════════════════════════════════
   ADMIN IP WHITELIST CHECK
══════════════════════════════════════════════════════════════ */
export function checkAdminIPWhitelist(req: Request, settings: Record<string, string>): boolean {
  const rawWhitelist = (settings["security_admin_ip_whitelist"] ?? "").trim();
  if (!rawWhitelist) return true;

  const allowed = rawWhitelist.split(",").map(s => s.trim()).filter(Boolean);
  if (allowed.length === 0) return true;

  const clientIP = getClientIp(req);
  return allowed.some(a => {
    if (a === clientIP) return true;
    if (a.endsWith(".") && clientIP.startsWith(a)) return true;
    return false;
  });
}

/* ══════════════════════════════════════════════════════════════
   GPS SPOOF DETECTION
══════════════════════════════════════════════════════════════ */
const R = 6371;
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function detectGPSSpoof(
  prevLat: number, prevLon: number, prevTime: Date,
  newLat: number, newLon: number,
  maxSpeedKmh: number
): { spoofed: boolean; speedKmh: number } {
  const distKm = haversineKm(prevLat, prevLon, newLat, newLon);
  const elapsedHours = (Date.now() - prevTime.getTime()) / 3_600_000;
  if (elapsedHours <= 0) return { spoofed: false, speedKmh: 0 };
  const speedKmh = distKm / elapsedHours;
  return { spoofed: speedKmh > maxSpeedKmh, speedKmh };
}

/* ══════════════════════════════════════════════════════════════
   TOKEN REVOCATION CHECK
   Checks if a refresh token has been revoked or expired.
══════════════════════════════════════════════════════════════ */
export async function isRefreshTokenValid(tokenHash: string): Promise<boolean> {
  const [rt] = await db.select().from(refreshTokensTable)
    .where(and(eq(refreshTokensTable.tokenHash, tokenHash)))
    .limit(1);
  if (!rt) return false;
  if (rt.revokedAt) return false;
  if (new Date() > rt.expiresAt) return false;
  return true;
}

export async function revokeRefreshToken(tokenHash: string): Promise<void> {
  await db.update(refreshTokensTable)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokensTable.tokenHash, tokenHash));
}

export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  await db.update(refreshTokensTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokensTable.userId, userId)));
}

/* ══════════════════════════════════════════════════════════════
   CUSTOMER AUTH MIDDLEWARE
   Validates JWT, checks DB ban/active status, sets req.customerId.
══════════════════════════════════════════════════════════════ */
export async function customerAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"] as string | undefined;
  const tokenHeader = req.headers["x-auth-token"] as string | undefined;
  const token = tokenHeader || authHeader?.replace(/^Bearer\s+/i, "");
  const ip = getClientIp(req);

  if (!token) {
    res.status(401).json({ error: "Authentication required. Please log in." });
    return;
  }

  const payload = verifyUserJwt(token);
  if (!payload) {
    writeAuthAuditLog("auth_denied_invalid_token", { ip, metadata: { url: req.url } });
    res.status(401).json({ error: "Invalid or expired session. Please log in again." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
  if (!user) { res.status(401).json({ error: "Account not found." }); return; }
  if (user.isBanned) {
    writeAuthAuditLog("auth_denied_banned", { userId: user.id, ip });
    res.status(403).json({ error: "Your account has been suspended. Contact support." });
    return;
  }
  if (!user.isActive) {
    writeAuthAuditLog("auth_denied_inactive", { userId: user.id, ip });
    res.status(403).json({ error: "Your account is inactive. Contact support." });
    return;
  }

  /* Token version check — invalidates access JWTs on logout/ban/role change */
  if (typeof payload.tokenVersion === "number" && payload.tokenVersion !== (user.tokenVersion ?? 0)) {
    writeAuthAuditLog("auth_denied_token_revoked", { userId: user.id, ip, metadata: { url: req.url } });
    res.status(401).json({ error: "Session revoked. Please log in again." });
    return;
  }

  req.customerId    = payload.userId;
  req.customerPhone = payload.phone;
  req.customerUser  = user;
  next();
}

/* ══════════════════════════════════════════════════════════════
   RIDER AUTH MIDDLEWARE
══════════════════════════════════════════════════════════════ */
export async function riderAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"] as string | undefined;
  const tokenHeader = req.headers["x-auth-token"] as string | undefined;
  const token = tokenHeader || authHeader?.replace(/^Bearer\s+/i, "");
  const ip = getClientIp(req);

  if (!token) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const payload = verifyUserJwt(token);
  if (!payload) {
    writeAuthAuditLog("auth_denied_invalid_token", { ip, metadata: { url: req.url, role: "rider" } });
    res.status(401).json({ error: "Invalid or expired session. Please log in again." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
  if (!user) { res.status(401).json({ error: "Account not found." }); return; }
  if (user.isBanned) {
    writeAuthAuditLog("auth_denied_banned", { userId: user.id, ip, metadata: { url: req.url, role: "rider" } });
    res.status(403).json({ code: "AUTH_REQUIRED", error: "Account is banned." }); return;
  }
  if (!user.isActive) {
    writeAuthAuditLog("auth_denied_inactive", { userId: user.id, ip, metadata: { url: req.url, role: "rider" } });
    res.status(403).json({ code: "AUTH_REQUIRED", error: "Account is inactive." }); return;
  }

  /* Token version check — invalidates access JWTs on logout/ban/role change */
  if (typeof payload.tokenVersion === "number" && payload.tokenVersion !== (user.tokenVersion ?? 0)) {
    writeAuthAuditLog("auth_denied_token_revoked", { userId: user.id, ip, metadata: { url: req.url, role: "rider" } });
    res.status(401).json({ code: "TOKEN_EXPIRED", error: "Session revoked. Please log in again." });
    return;
  }

  /* Use the authoritative roles field from DB — catches immediate role changes/bans */
  const dbRoles = (user.roles || user.role || "customer").split(",").map((r: string) => r.trim());
  if (!dbRoles.includes("rider")) {
    writeAuthAuditLog("auth_denied_role", { userId: user.id, ip, metadata: { required: "rider", actual: user.roles } });
    res.status(403).json({ code: "ROLE_DENIED", error: "Access denied. Rider account required." });
    return;
  }

  req.riderId = user.id;
  req.riderUser = user;
  next();
}

/* ── Legacy middleware alias ── */
export async function requireUserAuth(req: Request, res: Response, next: NextFunction) {
  return customerAuth(req, res, next);
}

export async function verifyCaptcha(req: Request, res: Response, next: NextFunction) {
  const settings = await getCachedSettings();
  if (settings["auth_captcha_enabled"] !== "on") {
    next();
    return;
  }

  const captchaToken = req.body?.captchaToken || req.headers["x-captcha-token"];
  if (!captchaToken) {
    res.status(400).json({ error: "CAPTCHA verification required" });
    return;
  }

  const secretKey = process.env["RECAPTCHA_SECRET_KEY"] || settings["recaptcha_secret_key"] || "";
  if (!secretKey) {
    console.error("[CAPTCHA] CAPTCHA enabled but no RECAPTCHA_SECRET_KEY configured — blocking request");
    res.status(500).json({ error: "CAPTCHA verification is misconfigured. Please contact support." });
    return;
  }

  try {
    const verifyUrl = "https://www.google.com/recaptcha/api/siteverify";
    const resp = await fetch(verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `secret=${encodeURIComponent(secretKey)}&response=${encodeURIComponent(captchaToken as string)}`,
      signal: AbortSignal.timeout(5_000),
    });

    if (!resp.ok) {
      console.error("[CAPTCHA] Google API returned non-OK status:", resp.status);
      res.status(502).json({ error: "CAPTCHA verification service unavailable. Please try again." });
      return;
    }

    const data = await resp.json() as { success: boolean; score?: number; "error-codes"?: string[] };
    if (!data.success) {
      const ip = getClientIp(req);
      addSecurityEvent({ type: "captcha_failed", ip, details: `CAPTCHA failed: ${(data["error-codes"] ?? []).join(", ")}`, severity: "medium" });
      res.status(403).json({ error: "CAPTCHA verification failed. Please try again." });
      return;
    }

    const minScore = parseFloat(settings["recaptcha_min_score"] ?? "0.5");
    if (typeof data.score === "number" && data.score < minScore) {
      const ip = getClientIp(req);
      addSecurityEvent({ type: "captcha_low_score", ip, details: `CAPTCHA score ${data.score} below threshold ${minScore}`, severity: "medium" });
      res.status(403).json({ error: "Suspicious activity detected. Please try again." });
      return;
    }

    next();
  } catch (err: any) {
    console.error("[CAPTCHA] Verification error:", err.message);
    res.status(502).json({ error: "CAPTCHA verification failed. Please try again later." });
  }
}

/* ══════════════════════════════════════════════════════════════
   IDOR GUARD — ensures the requesting user owns the resource.
   Usage: if (idorGuard(res, requestedOwnerId, req.userId)) return;
══════════════════════════════════════════════════════════════ */
export function idorGuard(
  res: Response,
  resourceOwnerId: string | null | undefined,
  requestingUserId: string,
  opts: { adminBypass?: boolean; requestingRole?: string } = {}
): boolean {
  if (opts.adminBypass && opts.requestingRole && ["admin", "superadmin"].includes(opts.requestingRole)) {
    return false;
  }
  if (!resourceOwnerId || resourceOwnerId !== requestingUserId) {
    res.status(403).json({ error: "Access denied." });
    return true;
  }
  return false;
}
