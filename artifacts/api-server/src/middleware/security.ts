import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getPlatformSettings } from "../routes/admin.js";

/* ══════════════════════════════════════════════════════════════
   JWT CONFIGURATION
══════════════════════════════════════════════════════════════ */
const _jwtSecret = process.env["JWT_SECRET"];
if (!_jwtSecret) {
  console.warn("[AUTH] JWT_SECRET env var not set — using insecure dev default. Set JWT_SECRET before deploying to production.");
}
export const JWT_SECRET = _jwtSecret ?? "ajkmart-dev-secret-CHANGE-IN-PRODUCTION";

/* ══════════════════════════════════════════════════════════════
   TOR EXIT NODE DETECTION
   Fetches the public TOR exit node list every hour (free, no API key).
   Source: https://check.torproject.org/torbulkexitlist
══════════════════════════════════════════════════════════════ */
let torExitNodes: Set<string> = new Set();
let torListFetchedAt = 0;
const TOR_LIST_TTL_MS = 60 * 60 * 1000; // 1 hour

async function refreshTorExitNodes(): Promise<void> {
  try {
    const resp = await fetch("https://check.torproject.org/torbulkexitlist", {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return;
    const text = await resp.text();
    const ips = text.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    torExitNodes = new Set(ips);
    torListFetchedAt = Date.now();
    console.log(`[TOR] Refreshed exit node list: ${torExitNodes.size} nodes`);
  } catch (err: any) {
    console.warn(`[TOR] Failed to fetch exit node list: ${err.message}`);
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
   Uses ip-api.com free tier — returns proxy/hosting flags.
   Rate limit: 45 requests/minute (per IP of our server). We cache
   results for 10 minutes to stay well within limits.
══════════════════════════════════════════════════════════════ */
const vpnCache: Map<string, { isVpn: boolean; cachedAt: number }> = new Map();
const VPN_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

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
    if (!resp.ok) return false;
    const data = await resp.json() as any;
    const isVpn = data.status === "success" && (data.proxy === true || data.hosting === true);
    vpnCache.set(ip, { isVpn, cachedAt: Date.now() });
    return isVpn;
  } catch {
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════
   IN-MEMORY STORES
══════════════════════════════════════════════════════════════ */

/* Rate limiter: "ip:roleKey" -> { count, windowStart } */
const ipRateStore = new Map<string, { count: number; windowStart: number }>();

/* Blocked IPs */
export const blockedIPs = new Set<string>();

/* Login lockout: phone -> { attempts, lockedUntil } */
export const loginAttempts = new Map<string, { attempts: number; lockedUntil: number | null }>();

/* Audit log — in-memory ring buffer (last 2000 entries) */
export interface AuditEntry {
  timestamp: string;
  action: string;
  adminId?: string;
  ip: string;
  details: string;
  result: "success" | "fail" | "warn";
}
export const auditLog: AuditEntry[] = [];

/* Security events — suspicious activity ring buffer */
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
   AUDIT LOG
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
   JWT HELPERS
   Signed tokens replace the old Base64 scheme.
   Payload: { sub: userId, phone, role, roles }
   Expiry is embedded in the JWT — no separate issuedAt check needed.
══════════════════════════════════════════════════════════════ */
export interface JwtUserPayload {
  userId: string;
  phone: string;
  role: string;
  roles: string;
  /** JWT expiry — seconds since epoch (same as the JWT "exp" claim) */
  exp?: number;
  /** JWT issued-at — seconds since epoch */
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
    { expiresIn: `${sessionDays}d` },
  );
}

export function verifyUserJwt(token: string): JwtUserPayload | null {
  try {
    /* Pin to HS256 — prevents algorithm-confusion attacks (e.g. alg:none, RS256 key-confusion) */
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    if (!payload.sub) return null;
    return {
      userId: payload["sub"] as string,
      phone:  payload["phone"] as string ?? "",
      role:   payload["role"]  as string ?? "customer",
      roles:  payload["roles"] as string ?? "customer",
      exp:    typeof payload.exp === "number" ? payload.exp : undefined,
      iat:    typeof payload.iat === "number" ? payload.iat : undefined,
    };
  } catch {
    return null;
  }
}

/* ── Legacy decode: kept for internal callers that still use it ── */
export function decodeUserToken(token: string): { userId: string; phone: string; issuedAt: number } | null {
  const v = verifyUserJwt(token);
  if (!v) return null;
  const raw = jwt.decode(token) as { iat?: number } | null;
  return { userId: v.userId, phone: v.phone, issuedAt: (raw?.iat ?? 0) * 1000 };
}

export function isTokenExpired(_issuedAt: number, _sessionDays: number): boolean {
  /* JWT handles expiry — this is a no-op kept for compatibility */
  return false;
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
   SETTINGS CACHE (avoid hitting DB on every request)
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
   Uses JWT claims — never trusts the client-supplied x-user-role header.
══════════════════════════════════════════════════════════════ */
function getRoleKey(req: Request): "admin" | "rider" | "vendor" | "general" {
  const url = req.url || "";
  if (req.headers["x-admin-secret"] || url.includes("/admin")) return "admin";

  /* Decode JWT from Authorization header to get the verified role */
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

  /* Health check — always pass */
  if (req.url === "/" || req.url.endsWith("/health")) { next(); return; }

  /* Blocked IP check */
  if (blockedIPs.has(ip)) {
    addSecurityEvent({ type: "blocked_ip_access", ip, details: `Blocked IP attempted access to ${req.url}`, severity: "high" });
    res.status(403).json({ error: "Access denied. Your IP address has been blocked due to suspicious activity." });
    return;
  }

  const settings = await getCachedSettings();

  /* TOR exit node check */
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

  /* VPN / Proxy check */
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

    /* Auto-block persistent abusers */
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
const R = 6371; // km
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
   CUSTOMER AUTH MIDDLEWARE
   Validates JWT, checks DB ban/active status, sets req.customerId.
   Apply to all customer-facing authenticated routes.
══════════════════════════════════════════════════════════════ */
export async function customerAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"] as string | undefined;
  const tokenHeader = req.headers["x-auth-token"] as string | undefined;
  const token = tokenHeader || authHeader?.replace(/^Bearer\s+/i, "");

  if (!token) {
    res.status(401).json({ error: "Authentication required. Please log in." });
    return;
  }

  const payload = verifyUserJwt(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired session. Please log in again." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
  if (!user) { res.status(401).json({ error: "Account not found." }); return; }
  if (user.isBanned) { res.status(403).json({ error: "Your account has been suspended. Contact support." }); return; }
  if (!user.isActive) { res.status(403).json({ error: "Your account is inactive. Contact support." }); return; }

  req.customerId = payload.userId;
  req.customerPhone = payload.phone;
  req.customerUser = user;
  next();
}

/* ══════════════════════════════════════════════════════════════
   RIDER AUTH MIDDLEWARE
   Requires a valid JWT whose DB + JWT role both include "rider".
   Sets req.riderId and req.riderUser on success.
══════════════════════════════════════════════════════════════ */
export async function riderAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"] as string | undefined;
  const tokenHeader = req.headers["x-auth-token"] as string | undefined;
  const token = tokenHeader || authHeader?.replace(/^Bearer\s+/i, "");

  if (!token) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const payload = verifyUserJwt(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired session. Please log in again." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
  if (!user) { res.status(401).json({ error: "Account not found." }); return; }
  if (user.isBanned) { res.status(403).json({ error: "Account is banned." }); return; }
  if (!user.isActive) { res.status(403).json({ error: "Account is inactive." }); return; }

  const dbRoles  = (user.roles  || user.role  || "").split(",").map((r: string) => r.trim());
  const jwtRoles = (payload.roles || payload.role || "").split(",").map((r: string) => r.trim());
  if (!dbRoles.includes("rider") || !jwtRoles.includes("rider")) {
    res.status(403).json({ error: "Access denied. Rider account required." });
    return;
  }

  req.riderId = user.id;
  req.riderUser = user;
  next();
}

/* ── Legacy middleware alias — kept for any internal usage ── */
export async function requireUserAuth(req: Request, res: Response, next: NextFunction) {
  return customerAuth(req, res, next);
}
