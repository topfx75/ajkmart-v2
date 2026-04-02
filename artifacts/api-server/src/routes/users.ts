import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, ordersTable, walletTransactionsTable, ridesTable, savedAddressesTable, userSessionsTable, loginHistoryTable, refreshTokensTable } from "@workspace/db/schema";
import { eq, desc, and, count, sql, isNull } from "drizzle-orm";
import { customerAuth, getClientIp, writeAuthAuditLog } from "../middleware/security.js";
import { randomUUID, createHash } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import multer from "multer";
import { generateId } from "../lib/id.js";

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

const router: IRouter = Router();

router.use(customerAuth);

router.get("/profile", async (req, res) => {
  const userId = req.customerId!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({
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
    createdAt: user.createdAt.toISOString(),
  });
});

router.get("/:id/debt", async (req, res) => {
  const userId = req.customerId!;
  if (req.params["id"] !== userId) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const [user] = await db.select({ cancellationDebt: usersTable.cancellationDebt }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ debtBalance: parseFloat(user.cancellationDebt ?? "0") });
});

router.post("/export-data", async (req, res) => {
  const userId = req.customerId!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const [orders, rides, walletHistory, addresses] = await Promise.all([
    db.select().from(ordersTable).where(eq(ordersTable.userId, userId)).orderBy(desc(ordersTable.createdAt)),
    db.select().from(ridesTable).where(eq(ridesTable.userId, userId)).orderBy(desc(ridesTable.createdAt)),
    db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.userId, userId)).orderBy(desc(walletTransactionsTable.createdAt)),
    db.select().from(savedAddressesTable).where(eq(savedAddressesTable.userId, userId)),
  ]);

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
    orders: orders.map(o => ({
      id: o.id,
      type: o.type,
      status: o.status,
      total: parseFloat(o.total),
      paymentMethod: o.paymentMethod,
      deliveryAddress: o.deliveryAddress,
      items: o.items,
      createdAt: o.createdAt.toISOString(),
    })),
    rides: rides.map(r => ({
      id: r.id,
      type: r.type,
      status: r.status,
      pickupAddress: r.pickupAddress,
      dropoffAddress: r.dropAddress,
      fare: parseFloat(r.fare),
      paymentMethod: r.paymentMethod,
      createdAt: r.createdAt.toISOString(),
    })),
    walletHistory: walletHistory.map(t => ({
      id: t.id,
      type: t.type,
      amount: parseFloat(t.amount),
      description: t.description,
      createdAt: t.createdAt.toISOString(),
    })),
    addresses: addresses.map(a => ({
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
  try {
    let buffer: Buffer;
    let mime: string;

    if (req.file) {
      buffer = req.file.buffer;
      mime = req.file.mimetype;
    } else {
      const { file, mimeType } = req.body;
      if (!file) { res.status(400).json({ error: "No image data provided" }); return; }
      mime = mimeType || "image/jpeg";
      if (!ALLOWED_AVATAR_TYPES.includes(mime)) {
        res.status(400).json({ error: "Only JPEG, PNG, and WebP images are allowed" }); return;
      }
      const base64Data = (file as string).replace(/^data:image\/\w+;base64,/, "");
      buffer = Buffer.from(base64Data, "base64");
      if (buffer.length > MAX_AVATAR_SIZE) {
        res.status(400).json({ error: "File too large. Maximum 5MB allowed" }); return;
      }
    }

    const avatarUrl = await saveAvatarBuffer(userId, buffer, mime);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    res.json({ success: true, avatarUrl, user: {
      id: user.id, phone: user.phone, name: user.name, email: user.email,
      role: user.role, avatar: user.avatar, walletBalance: parseFloat(user.walletBalance ?? "0"),
    }});
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Avatar upload failed" });
  }
});

router.put("/profile", async (req, res) => {
  const userId = req.customerId!;
  const { userId: _ignored, name, email, avatar, cnic, city, address } = req.body;

  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    res.status(400).json({ error: "Name cannot be empty" });
    return;
  }
  if (email !== undefined && email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Invalid email format" });
    return;
  }
  if (cnic !== undefined && cnic !== "" && !/^\d{13}$/.test(cnic.replace(/[-\s]/g, ""))) {
    res.status(400).json({ error: "CNIC must be 13 digits (e.g. 3740512345678)" });
    return;
  }

  const updates: any = { updatedAt: new Date() };
  if (name    !== undefined) updates.name    = String(name).trim();
  if (email   !== undefined) updates.email   = String(email).trim();
  if (avatar  !== undefined) updates.avatar  = avatar;
  if (cnic    !== undefined) updates.cnic    = String(cnic).replace(/[-\s]/g, "").trim();
  if (city    !== undefined) updates.city    = String(city).trim();
  if (address !== undefined) updates.address = String(address).trim();

  const [current] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!current) {
    res.status(404).json({ error: "User not found" });
    return;
  }

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
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({
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
  });
});

router.delete("/delete-account", async (req, res) => {
  const userId = req.customerId!;
  const { confirmation } = req.body ?? {};

  if (confirmation !== "DELETE") {
    res.status(400).json({ error: "You must type DELETE to confirm account deletion." });
    return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const activeOrders = await db.select({ c: count() }).from(ordersTable)
      .where(and(
        eq(ordersTable.userId, userId),
        sql`${ordersTable.status} NOT IN ('delivered', 'cancelled', 'completed')`,
      ));

    if (activeOrders[0] && activeOrders[0].c > 0) {
      res.status(400).json({ error: "Cannot delete account with active orders. Please wait for all orders to complete." });
      return;
    }

    const activeRides = await db.select({ c: count() }).from(ridesTable)
      .where(and(
        eq(ridesTable.userId, userId),
        sql`${ridesTable.status} NOT IN ('completed', 'cancelled')`,
      ));

    if (activeRides[0] && activeRides[0].c > 0) {
      res.status(400).json({ error: "Cannot delete account with active rides. Please wait for all rides to complete." });
      return;
    }

    const now = new Date();
    const scrambledPhone = `DELETED_${userId.slice(0, 8)}_${Date.now()}`;
    await db.update(usersTable)
      .set({
        isActive: false,
        isBanned: true,
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
        tokenVersion: sql`${usersTable.tokenVersion} + 1`,
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

    res.json({ success: true, message: "Account has been deleted and all data anonymized." });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Could not delete account" });
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

  res.json({
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

  res.json({ success: true, message: "All other sessions have been signed out." });
});

router.delete("/sessions/:sessionId", async (req, res) => {
  const userId = req.customerId!;
  const sessionId = req.params["sessionId"]!;

  const [session] = await db.select().from(userSessionsTable)
    .where(and(eq(userSessionsTable.id, sessionId), eq(userSessionsTable.userId, userId)))
    .limit(1);

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (session.revokedAt) {
    res.status(400).json({ error: "Session already revoked" });
    return;
  }

  await db.update(userSessionsTable)
    .set({ revokedAt: new Date() })
    .where(eq(userSessionsTable.id, sessionId));

  if (session.tokenHash) {
    await db.update(refreshTokensTable)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(refreshTokensTable.userId, userId),
        isNull(refreshTokensTable.revokedAt),
      ));
  }

  const ip = getClientIp(req);
  writeAuthAuditLog("session_revoked", { userId, ip, userAgent: req.headers["user-agent"] as string, metadata: { sessionId } });

  res.json({ success: true, message: "Session revoked" });
});

router.get("/login-history", async (req, res) => {
  const userId = req.customerId!;
  const history = await db.select().from(loginHistoryTable)
    .where(eq(loginHistoryTable.userId, userId))
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
