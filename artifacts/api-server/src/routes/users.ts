import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, ordersTable, walletTransactionsTable, ridesTable, savedAddressesTable, userSessionsTable, loginHistoryTable, refreshTokensTable, pharmacyOrdersTable, parcelBookingsTable } from "@workspace/db/schema";
import { eq, desc, and, count, sql, isNull, ne } from "drizzle-orm";
import { customerAuth, getClientIp, writeAuthAuditLog, checkLockout, recordFailedAttempt, resetAttempts } from "../middleware/security.js";
import { randomUUID, createHash } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import multer from "multer";
import { generateId } from "../lib/id.js";
import { z } from "zod";
import { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden, sendValidationError } from "../lib/response.js";

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, "").trim();

/* Avatar field is intentionally excluded — set only via POST /avatar */
const sanitizedString = (maxLen: number, minLen = 0) =>
  z.preprocess(
    (v) => (typeof v === "string" ? stripHtml(v) : v),
    minLen > 0
      ? z.string().min(minLen, "This field cannot be empty").max(maxLen).optional()
      : z.string().max(maxLen).optional()
  );

const profileUpdateSchema = z.object({
  name: sanitizedString(100, 1),
  email: z.string().email("Invalid email format").max(255).optional().or(z.literal("")),
  cnic: z.preprocess(
    (v) => typeof v === "string" ? v.replace(/[-\s]/g, "") : v,
    z.string().regex(/^\d{13}$/, "CNIC must be 13 digits (e.g. 3740512345678 or 37405-1234567-8)").optional().or(z.literal(""))
  ),
  city: sanitizedString(100),
  address: sanitizedString(500),
}).strip();

const deleteAccountSchema = z.object({
  confirmation: z.literal("DELETE", { errorMap: () => ({ message: "You must type DELETE to confirm account deletion." }) }),
});

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_AVATAR_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPEG, PNG, and WebP images are allowed"));
  },
});

/* Simple per-user in-memory rate limiter for profile/avatar writes (10 req/min) */
const profileRateMap = new Map<string, { count: number; resetAt: number }>();
function profileRateLimit(userId: string, maxPerMin = 10): boolean {
  const now = Date.now();
  const entry = profileRateMap.get(userId);
  if (!entry || now > entry.resetAt) {
    profileRateMap.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count++;
  if (entry.count > maxPerMin) return false;
  return true;
}

const router: IRouter = Router();

router.use(customerAuth);

router.get("/profile", async (req, res) => {
  const userId = req.customerId!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    sendNotFound(res, "User not found");
    return;
  }
  sendSuccess(res, {
    id: user.id,
    phone: user.phone,
    name: user.name,
    email: user.email,
    username: user.username ?? null,
    role: user.role,
    avatar: user.avatar,
    walletBalance: parseFloat(user.walletBalance ?? "0"),
    isActive: user.isActive,
    cnic: user.cnic ?? null,
    city: user.city ?? null,
    area: user.area ?? null,
    address: user.address ?? null,
    latitude: user.latitude ?? null,
    longitude: user.longitude ?? null,
    accountLevel: user.accountLevel ?? "bronze",
    kycStatus: user.kycStatus ?? "none",
    totpEnabled: user.totpEnabled ?? false,
    hasPassword: !!user.passwordHash,
    createdAt: user.createdAt.toISOString(),
  });
});

router.get("/:id/debt", async (req, res) => {
  const userId = req.customerId!;
  if (req.params["id"] !== userId) {
    sendForbidden(res, "Access denied");
    return;
  }
  const [user] = await db.select({ cancellationDebt: usersTable.cancellationDebt }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    sendNotFound(res, "User not found");
    return;
  }
  sendSuccess(res, { debtBalance: parseFloat(user.cancellationDebt ?? "0") });
});

router.post("/export-data", async (req, res) => {
  const userId = req.customerId!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    sendNotFound(res, "User not found");
    return;
  }

  let orders: any[], rides: any[], walletHistory: any[], addresses: any[], pharmacyOrders: any[], parcelBookings: any[];
  try {
    [orders, rides, walletHistory, addresses, pharmacyOrders, parcelBookings] = await Promise.all([
      db.select().from(ordersTable).where(eq(ordersTable.userId, userId)).orderBy(desc(ordersTable.createdAt)),
      db.select().from(ridesTable).where(eq(ridesTable.userId, userId)).orderBy(desc(ridesTable.createdAt)),
      db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.userId, userId)).orderBy(desc(walletTransactionsTable.createdAt)),
      db.select().from(savedAddressesTable).where(eq(savedAddressesTable.userId, userId)),
      db.select().from(pharmacyOrdersTable).where(eq(pharmacyOrdersTable.userId, userId)).orderBy(desc(pharmacyOrdersTable.createdAt)),
      db.select().from(parcelBookingsTable).where(eq(parcelBookingsTable.userId, userId)).orderBy(desc(parcelBookingsTable.createdAt)),
    ]);
  } catch (err) {
    sendError(res, "Failed to retrieve your data. Please try again later.");
    return;
  }

  const exportData = {
    exportedAt: new Date().toISOString(),
    profile: {
      id: user.id,
      phone: user.phone,
      name: user.name,
      email: user.email,
      city: user.city,
      address: user.address,
      cnic: user.cnic,
      walletBalance: parseFloat(user.walletBalance ?? "0"),
      createdAt: user.createdAt.toISOString(),
    },
    orders: orders.map((o: any) => ({
      id: o.id,
      type: o.type,
      status: o.status,
      total: parseFloat(o.total),
      paymentMethod: o.paymentMethod,
      deliveryAddress: o.deliveryAddress,
      items: o.items,
      createdAt: o.createdAt.toISOString(),
    })),
    rides: rides.map((r: any) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      pickupAddress: r.pickupAddress,
      dropoffAddress: r.dropAddress,
      fare: parseFloat(r.fare),
      paymentMethod: r.paymentMethod,
      createdAt: r.createdAt.toISOString(),
    })),
    pharmacyOrders: pharmacyOrders.map((o: any) => ({
      id: o.id,
      status: o.status,
      total: parseFloat(o.total ?? "0"),
      items: o.items,
      prescriptionNote: o.prescriptionNote,
      createdAt: o.createdAt.toISOString(),
    })),
    parcelBookings: parcelBookings.map((b: any) => ({
      id: b.id,
      status: b.status,
      parcelType: b.parcelType,
      pickupAddress: b.pickupAddress,
      dropAddress: b.dropAddress,
      fare: parseFloat(b.fare ?? "0"),
      createdAt: b.createdAt.toISOString(),
    })),
    walletHistory: walletHistory.map((t: any) => ({
      id: t.id,
      type: t.type,
      amount: parseFloat(t.amount),
      description: t.description,
      createdAt: t.createdAt.toISOString(),
    })),
    addresses: addresses.map((a: any) => ({
      id: a.id,
      label: a.label,
      address: a.address,
      city: a.city,
      isDefault: a.isDefault,
    })),
  };

  const ip = getClientIp(req);
  writeAuthAuditLog("data_export", { userId, ip, userAgent: req.headers["user-agent"] as string });

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="ajkmart-data-export-${userId.slice(-8)}.json"`);
  res.json(exportData);
});

async function saveAvatarBuffer(userId: string, buffer: Buffer, mime: string) {
  const ext = mime === "image/png" ? ".png" : mime === "image/webp" ? ".webp" : ".jpg";
  const uniqueName = `avatar_${userId.slice(-8)}_${randomUUID().slice(0, 8)}${ext}`;
  await mkdir(UPLOADS_DIR, { recursive: true });
  await writeFile(path.join(UPLOADS_DIR, uniqueName), buffer);
  const avatarUrl = `/api/uploads/${uniqueName}`;
  await db.update(usersTable).set({ avatar: avatarUrl, updatedAt: new Date() }).where(eq(usersTable.id, userId));
  return avatarUrl;
}

router.post("/avatar", avatarUpload.single("avatar"), async (req, res) => {
  const userId = req.customerId!;

  /* Rate limit: max 10 avatar uploads per minute per user */
  if (!profileRateLimit(userId, 10)) {
    sendError(res, "Too many requests. Please wait a moment before uploading again.");
    return;
  }

  try {
    let buffer: Buffer;
    let mime: string;

    if (req.file) {
      buffer = req.file.buffer;
      mime = req.file.mimetype;
    } else {
      const { file, mimeType } = req.body;
      if (!file) { sendValidationError(res, "No image data provided"); return; }
      mime = mimeType || "image/jpeg";
      if (!ALLOWED_AVATAR_TYPES.includes(mime)) {
        sendValidationError(res, "Only JPEG, PNG, and WebP images are allowed"); return;
      }
      const base64Data = (file as string).replace(/^data:image\/\w+;base64,/, "");
      buffer = Buffer.from(base64Data, "base64");
      if (buffer.length > MAX_AVATAR_SIZE) {
        sendValidationError(res, "File too large. Maximum 5MB allowed"); return;
      }
    }

    const avatarUrl = await saveAvatarBuffer(userId, buffer, mime);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { sendNotFound(res, "User not found"); return; }
    sendSuccess(res, { avatarUrl, user: {
      id: user.id, phone: user.phone, name: user.name, email: user.email,
      role: user.role, avatar: user.avatar, walletBalance: parseFloat(user.walletBalance ?? "0"),
    }});
  } catch (e: unknown) {
    const rawMsg = (e as Error)?.message || "Avatar upload failed";
    const safeMsg = rawMsg.replace(/\/[^\s]+\//g, "").replace(/[A-Z]:\\[^\s]+/g, "");
    sendError(res, safeMsg.includes("/") || safeMsg.includes("\\") ? "Avatar upload failed" : safeMsg);
  }
});

router.put("/profile", async (req, res) => {
  const userId = req.customerId!;

  /* Rate limit: max 10 profile updates per minute per user */
  if (!profileRateLimit(userId, 10)) {
    sendError(res, "Too many requests. Please wait before updating your profile again.");
    return;
  }

  const parsed = profileUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? "Invalid input";
    sendValidationError(res, firstError);
    return;
  }

  const { name, email, cnic, city, address } = parsed.data;

  const [current] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!current) {
    sendNotFound(res, "User not found");
    return;
  }

  if (email && email.trim() && email.trim() !== current.email) {
    const [emailTaken] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.email, email.trim()), ne(usersTable.id, userId)))
      .limit(1);
    if (emailTaken) {
      sendValidationError(res, "This email address is already registered to another account.");
      return;
    }
  }

  const cnicClean = cnic ? cnic.replace(/[-\s]/g, "").trim() : undefined;
  if (cnicClean && cnicClean !== (current.cnic ?? "")) {
    const [cnicTaken] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.cnic, cnicClean), ne(usersTable.id, userId)))
      .limit(1);
    if (cnicTaken) {
      sendValidationError(res, "This CNIC is already registered to another account.");
      return;
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name    !== undefined) updates.name    = name.trim();
  if (email   !== undefined) updates.email   = email.trim();
  if (cnic    !== undefined) updates.cnic    = cnic.replace(/[-\s]/g, "").trim();
  if (city    !== undefined) updates.city    = city.trim();
  if (address !== undefined) updates.address = address.trim();

  const hasName = updates.name ?? current.name;
  const hasEmail = updates.email ?? current.email;
  const hasAddress = updates.address ?? current.address;
  const hasCity = updates.city ?? current.city;
  const hasCnic = updates.cnic ?? current.cnic;
  const hasPassword = current.passwordHash;
  const filledCount = [hasName, hasEmail, hasAddress, hasCity, hasCnic, hasPassword].filter(Boolean).length;
  let newLevel = "bronze";
  if (filledCount >= 5 && hasCnic) newLevel = "gold";
  else if (filledCount >= 3) newLevel = "silver";
  updates.accountLevel = newLevel;

  await db.update(usersTable).set(updates).where(eq(usersTable.id, userId));
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    sendNotFound(res, "User not found");
    return;
  }
  sendSuccess(res, {
    id: user.id,
    phone: user.phone,
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
    avatar: user.avatar,
    walletBalance: parseFloat(user.walletBalance ?? "0"),
    cnic: user.cnic,
    city: user.city,
    area: user.area,
    address: user.address,
    accountLevel: user.accountLevel,
    kycStatus: user.kycStatus,
    createdAt: user.createdAt.toISOString(),
  }, "پروفائل کامیابی سے اپ ڈیٹ ہو گیا۔");
});

router.delete("/delete-account", async (req, res) => {
  const userId = req.customerId!;

  const parsed = deleteAccountSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const msg = parsed.error.errors[0]?.message ?? "You must type DELETE to confirm account deletion.";
    sendValidationError(res, msg);
    return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { sendNotFound(res, "User not found"); return; }

    const activeOrders = await db.select({ c: count() }).from(ordersTable)
      .where(and(
        eq(ordersTable.userId, userId),
        sql`${ordersTable.status} NOT IN ('delivered', 'cancelled', 'completed')`,
      ));

    if (activeOrders[0] && activeOrders[0].c > 0) {
      sendValidationError(res, "Cannot delete account with active orders. Please wait for all orders to complete.");
      return;
    }

    const activeRides = await db.select({ c: count() }).from(ridesTable)
      .where(and(
        eq(ridesTable.userId, userId),
        sql`${ridesTable.status} NOT IN ('completed', 'cancelled')`,
      ));

    if (activeRides[0] && activeRides[0].c > 0) {
      sendValidationError(res, "Cannot delete account with active rides. Please wait for all rides to complete.");
      return;
    }

    const pendingWithdrawals = await db.select({ c: count(), total: sql<string>`COALESCE(SUM(${walletTransactionsTable.amount}), 0)` })
      .from(walletTransactionsTable)
      .where(and(
        eq(walletTransactionsTable.userId, userId),
        eq(walletTransactionsTable.type, "withdrawal"),
        eq(walletTransactionsTable.reference, "pending"),
      ));

    if (pendingWithdrawals[0] && pendingWithdrawals[0].c > 0) {
      const pendingTotal = parseFloat(pendingWithdrawals[0].total || "0");
      sendValidationError(res, `You have ${pendingWithdrawals[0].c} pending withdrawal(s) totalling Rs. ${pendingTotal.toLocaleString()}. These will be lost if you delete your account. Please wait for them to process or cancel them first.`);
      return;
    }

    const now = new Date();
    /* Scramble phone in a format that is NOT classified as banned — prefix with GDEL_
       so the original phone number is free for re-registration */
    const scrambledPhone = `GDEL_${userId.slice(-8)}_${Date.now()}`;
    await db.update(usersTable)
      .set({
        isActive: false,
        isBanned: false,          /* don't ban — the original phone is free to re-register */
        name: "Deleted User",
        phone: scrambledPhone,
        email: null,
        username: null,
        avatar: null,
        cnic: null,
        address: null,
        area: null,
        city: null,
        latitude: null,
        longitude: null,
        totpSecret: null,
        totpEnabled: false,
        backupCodes: null,
        trustedDevices: null,
        passwordHash: null,
        tokenVersion: sql`${usersTable.tokenVersion} + 1`,  /* invalidate all access tokens immediately */
        updatedAt: now,
      })
      .where(eq(usersTable.id, userId));

    await db.update(refreshTokensTable)
      .set({ revokedAt: now })
      .where(eq(refreshTokensTable.userId, userId));

    await db.update(userSessionsTable)
      .set({ revokedAt: now })
      .where(eq(userSessionsTable.userId, userId));

    const ip = getClientIp(req);
    writeAuthAuditLog("account_deleted", { userId, ip, userAgent: req.headers["user-agent"] as string });

    sendSuccess(res, null, "اکاؤنٹ حذف ہو گیا اور تمام ڈیٹا گمنام ہو گیا۔");
  } catch (e: unknown) {
    sendError(res, (e as Error).message || "Could not delete account");
  }
});

router.get("/sessions", async (req, res) => {
  const userId = req.customerId!;
  const sessions = await db.select().from(userSessionsTable)
    .where(and(eq(userSessionsTable.userId, userId), isNull(userSessionsTable.revokedAt)))
    .orderBy(desc(userSessionsTable.lastActiveAt));

  const authHeader = req.headers["authorization"] as string | undefined;
  const currentToken = authHeader?.replace(/^Bearer\s+/i, "") ?? "";
  const currentTokenHash = currentToken ? createHash("sha256").update(currentToken).digest("hex") : "";

  sendSuccess(res, {
    sessions: sessions.map(s => ({
      id: s.id,
      deviceName: s.deviceName,
      browser: s.browser,
      os: s.os,
      ip: s.ip,
      location: s.location,
      lastActiveAt: s.lastActiveAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      isCurrent: s.tokenHash === currentTokenHash,
    })),
  });
});

router.delete("/sessions/all", async (req, res) => {
  const userId = req.customerId!;
  const authHeader = req.headers["authorization"] as string | undefined;
  const currentToken = authHeader?.replace(/^Bearer\s+/i, "") ?? "";
  const currentTokenHash = currentToken ? createHash("sha256").update(currentToken).digest("hex") : "";

  await db.update(userSessionsTable)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(userSessionsTable.userId, userId),
      isNull(userSessionsTable.revokedAt),
      sql`${userSessionsTable.tokenHash} != ${currentTokenHash}`,
    ));

  await db.update(refreshTokensTable)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(refreshTokensTable.userId, userId),
      isNull(refreshTokensTable.revokedAt),
    ));

  const ip = getClientIp(req);
  writeAuthAuditLog("sessions_revoked_all", { userId, ip, userAgent: req.headers["user-agent"] as string });

  sendSuccess(res, null, "تمام دیگر سیشنز سے سائن آؤٹ ہو گیا۔");
});

router.delete("/sessions/:sessionId", async (req, res) => {
  const userId = req.customerId!;
  const sessionId = req.params["sessionId"]!;

  const [session] = await db.select().from(userSessionsTable)
    .where(and(eq(userSessionsTable.id, sessionId), eq(userSessionsTable.userId, userId)))
    .limit(1);

  if (!session) {
    sendNotFound(res, "Session not found");
    return;
  }

  if (session.revokedAt) {
    sendValidationError(res, "Session already revoked");
    return;
  }

  await db.update(userSessionsTable)
    .set({ revokedAt: new Date() })
    .where(eq(userSessionsTable.id, sessionId));

  if (session.refreshTokenId) {
    await db.update(refreshTokensTable)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(refreshTokensTable.id, session.refreshTokenId),
        eq(refreshTokensTable.userId, userId),
        isNull(refreshTokensTable.revokedAt),
      ));
  }

  const ip = getClientIp(req);
  writeAuthAuditLog("session_revoked", { userId, ip, userAgent: req.headers["user-agent"] as string, metadata: { sessionId } });

  sendSuccess(res, null, "سیشن منسوخ ہو گیا۔");
});

router.get("/login-history", async (req, res) => {
  const userId = req.customerId!;
  const history = await db.select().from(loginHistoryTable)
    .where(eq(loginHistoryTable.userId, userId))
    .orderBy(desc(loginHistoryTable.createdAt))
    .limit(20);

  sendSuccess(res, {
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
