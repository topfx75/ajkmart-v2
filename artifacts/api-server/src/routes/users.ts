import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, ordersTable, walletTransactionsTable, ridesTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { customerAuth } from "../middleware/security.js";
import { randomUUID } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import multer from "multer";

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
    role: user.role,
    avatar: user.avatar,
    walletBalance: parseFloat(user.walletBalance ?? "0"),
    isActive: user.isActive,
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

  const [orders, rides, walletHistory] = await Promise.all([
    db.select().from(ordersTable).where(eq(ordersTable.userId, userId)).orderBy(desc(ordersTable.createdAt)),
    db.select().from(ridesTable).where(eq(ridesTable.userId, userId)).orderBy(desc(ridesTable.createdAt)),
    db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.userId, userId)).orderBy(desc(walletTransactionsTable.createdAt)),
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
      dropoffAddress: r.dropoffAddress,
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
  };

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="ajkmart-data-export-${userId.slice(-8)}.json"`);
  res.json({ success: true, data: exportData });
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
    role: user.role,
    avatar: user.avatar,
    walletBalance: parseFloat(user.walletBalance ?? "0"),
    cnic: user.cnic,
    city: user.city,
    address: user.address,
    createdAt: user.createdAt.toISOString(),
  });
});

export default router;
