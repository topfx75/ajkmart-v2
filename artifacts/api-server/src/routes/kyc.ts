import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { kycVerificationsTable, usersTable } from "@workspace/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { customerAuth } from "../middleware/security.js";
import { adminAuth } from "./admin.js";
import multer from "multer";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { logger } from "../lib/logger.js";

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads/kyc");
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
const MAX_SIZE = 8 * 1024 * 1024; // 8MB

const kycUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPEG, PNG, WebP images allowed"));
  },
});

async function saveKycPhoto(userId: string, type: string, buffer: Buffer, mime: string): Promise<string> {
  const ext = mime === "image/png" ? ".png" : mime === "image/webp" ? ".webp" : ".jpg";
  const filename = `kyc_${userId.slice(-8)}_${type}_${randomUUID().slice(0, 8)}${ext}`;
  await mkdir(UPLOADS_DIR, { recursive: true });
  await writeFile(path.join(UPLOADS_DIR, filename), buffer);
  return `/api/uploads/kyc/${filename}`;
}

const router: IRouter = Router();

/* ─── Customer: GET /api/kyc/status ─── */
router.get("/status", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const [record] = await db
    .select()
    .from(kycVerificationsTable)
    .where(eq(kycVerificationsTable.userId, userId))
    .orderBy(desc(kycVerificationsTable.createdAt))
    .limit(1);

  const [user] = await db
    .select({ kycStatus: usersTable.kycStatus })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!record) {
    res.json({ status: user?.kycStatus ?? "none", record: null });
    return;
  }

  res.json({
    status: record.status,
    record: {
      id: record.id,
      status: record.status,
      fullName: record.fullName,
      cnic: record.cnic,
      dateOfBirth: record.dateOfBirth,
      gender: record.gender,
      address: record.address,
      city: record.city,
      hasFrontId: !!record.frontIdPhoto,
      hasBackId: !!record.backIdPhoto,
      hasSelfie: !!record.selfiePhoto,
      rejectionReason: record.rejectionReason,
      submittedAt: record.submittedAt.toISOString(),
      reviewedAt: record.reviewedAt?.toISOString() ?? null,
    },
  });
});

/* ─── Customer: POST /api/kyc/submit ─── */
router.post(
  "/submit",
  customerAuth,
  kycUpload.fields([
    { name: "frontIdPhoto", maxCount: 1 },
    { name: "backIdPhoto", maxCount: 1 },
    { name: "selfiePhoto", maxCount: 1 },
  ]),
  async (req, res) => {
    const userId = req.customerId!;

    /* Block re-submission if already approved */
    const [existing] = await db
      .select({ status: kycVerificationsTable.status })
      .from(kycVerificationsTable)
      .where(eq(kycVerificationsTable.userId, userId))
      .orderBy(desc(kycVerificationsTable.createdAt))
      .limit(1);

    if (existing?.status === "approved") {
      res.status(400).json({ error: "KYC already verified" });
      return;
    }

    const { fullName, cnic, dateOfBirth, gender, address, city } = req.body;

    if (!fullName?.trim())  { res.status(400).json({ error: "Full name is required" }); return; }
    if (!cnic?.trim())      { res.status(400).json({ error: "CNIC number is required" }); return; }
    if (!/^\d{13}$/.test(cnic.replace(/[-\s]/g, ""))) {
      res.status(400).json({ error: "CNIC must be 13 digits (e.g. 3740512345678)" }); return;
    }
    if (!dateOfBirth)       { res.status(400).json({ error: "Date of birth is required" }); return; }
    if (!gender)            { res.status(400).json({ error: "Gender is required" }); return; }

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    if (!files?.["frontIdPhoto"]?.[0]) { res.status(400).json({ error: "Front side of CNIC is required" }); return; }
    if (!files?.["backIdPhoto"]?.[0])  { res.status(400).json({ error: "Back side of CNIC is required" }); return; }
    if (!files?.["selfiePhoto"]?.[0])  { res.status(400).json({ error: "Selfie photo is required" }); return; }

    try {
      const [frontUrl, backUrl, selfieUrl] = await Promise.all([
        saveKycPhoto(userId, "front", files["frontIdPhoto"][0].buffer, files["frontIdPhoto"][0].mimetype),
        saveKycPhoto(userId, "back",  files["backIdPhoto"][0].buffer,  files["backIdPhoto"][0].mimetype),
        saveKycPhoto(userId, "selfie",files["selfiePhoto"][0].buffer,  files["selfiePhoto"][0].mimetype),
      ]);

      const id = randomUUID();
      const now = new Date();

      /* If rejected before, update existing; otherwise insert */
      if (existing?.status === "rejected" || existing?.status === "resubmit") {
        await db
          .update(kycVerificationsTable)
          .set({
            status: "pending",
            fullName: fullName.trim(),
            cnic: cnic.replace(/[-\s]/g, ""),
            dateOfBirth,
            gender,
            address: address?.trim() ?? null,
            city: city?.trim() ?? null,
            frontIdPhoto: frontUrl,
            backIdPhoto: backUrl,
            selfiePhoto: selfieUrl,
            rejectionReason: null,
            reviewedBy: null,
            reviewedAt: null,
            submittedAt: now,
            updatedAt: now,
          })
          .where(and(
            eq(kycVerificationsTable.userId, userId),
            eq(kycVerificationsTable.status, existing.status),
          ));
      } else {
        await db.insert(kycVerificationsTable).values({
          id,
          userId,
          status: "pending",
          fullName: fullName.trim(),
          cnic: cnic.replace(/[-\s]/g, ""),
          dateOfBirth,
          gender,
          address: address?.trim() ?? null,
          city: city?.trim() ?? null,
          frontIdPhoto: frontUrl,
          backIdPhoto: backUrl,
          selfiePhoto: selfieUrl,
          submittedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }

      /* Update user kyc_status to pending */
      await db
        .update(usersTable)
        .set({ kycStatus: "pending", updatedAt: now })
        .where(eq(usersTable.id, userId));

      res.json({ success: true, message: "KYC submitted successfully. Our team will review within 24 hours." });
    } catch (err) {
      logger.error({ err }, "KYC submit error");
      res.status(500).json({ error: "Failed to submit KYC. Please try again." });
    }
  }
);

/* ─── Admin: GET /api/kyc/admin/list ─── */
router.get("/admin/list", adminAuth, async (req, res) => {
  const { status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (status && status !== "all") {
    conditions.push(eq(kycVerificationsTable.status, status));
  }

  const records = await db
    .select({
      id: kycVerificationsTable.id,
      userId: kycVerificationsTable.userId,
      status: kycVerificationsTable.status,
      fullName: kycVerificationsTable.fullName,
      cnic: kycVerificationsTable.cnic,
      dateOfBirth: kycVerificationsTable.dateOfBirth,
      gender: kycVerificationsTable.gender,
      city: kycVerificationsTable.city,
      submittedAt: kycVerificationsTable.submittedAt,
      reviewedAt: kycVerificationsTable.reviewedAt,
      rejectionReason: kycVerificationsTable.rejectionReason,
      userName: usersTable.name,
      userPhone: usersTable.phone,
      userEmail: usersTable.email,
    })
    .from(kycVerificationsTable)
    .leftJoin(usersTable, eq(kycVerificationsTable.userId, usersTable.id))
    .where(conditions.length > 0 ? conditions[0] : undefined)
    .orderBy(desc(kycVerificationsTable.submittedAt))
    .limit(limitNum)
    .offset(offset);

  res.json({ records });
});

/* ─── Admin: GET /api/kyc/admin/:id ─── */
router.get("/admin/:id", adminAuth, async (req, res) => {
  const [record] = await db
    .select()
    .from(kycVerificationsTable)
    .where(eq(kycVerificationsTable.id, req.params["id"]!))
    .limit(1);

  if (!record) { res.status(404).json({ error: "KYC record not found" }); return; }

  const [user] = await db
    .select({ name: usersTable.name, phone: usersTable.phone, email: usersTable.email, avatar: usersTable.avatar })
    .from(usersTable)
    .where(eq(usersTable.id, record.userId))
    .limit(1);

  res.json({
    ...record,
    submittedAt: record.submittedAt.toISOString(),
    reviewedAt: record.reviewedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    user: user ?? null,
  });
});

/* ─── Admin: POST /api/kyc/admin/:id/approve ─── */
router.post("/admin/:id/approve", adminAuth, async (req, res) => {
  const adminId = req.adminId ?? "admin";
  const [record] = await db
    .select()
    .from(kycVerificationsTable)
    .where(eq(kycVerificationsTable.id, req.params["id"]!))
    .limit(1);

  if (!record) { res.status(404).json({ error: "KYC record not found" }); return; }
  if (record.status === "approved") { res.status(400).json({ error: "Already approved" }); return; }

  const now = new Date();
  await db
    .update(kycVerificationsTable)
    .set({ status: "approved", reviewedBy: adminId, reviewedAt: now, updatedAt: now })
    .where(eq(kycVerificationsTable.id, record.id));

  /* Update user kycStatus + CNIC on users table */
  await db
    .update(usersTable)
    .set({
      kycStatus: "verified",
      cnic: record.cnic ?? undefined,
      name: record.fullName ?? undefined,
      city: record.city ?? undefined,
      address: record.address ?? undefined,
      updatedAt: now,
    })
    .where(eq(usersTable.id, record.userId));

  res.json({ success: true, message: "KYC approved" });
});

/* ─── Admin: POST /api/kyc/admin/:id/reject ─── */
router.post("/admin/:id/reject", adminAuth, async (req, res) => {
  const adminId = req.adminId ?? "admin";
  const { reason } = req.body;
  if (!reason?.trim()) { res.status(400).json({ error: "Rejection reason is required" }); return; }

  const [record] = await db
    .select()
    .from(kycVerificationsTable)
    .where(eq(kycVerificationsTable.id, req.params["id"]!))
    .limit(1);

  if (!record) { res.status(404).json({ error: "KYC record not found" }); return; }

  const now = new Date();
  await db
    .update(kycVerificationsTable)
    .set({ status: "rejected", rejectionReason: reason.trim(), reviewedBy: adminId, reviewedAt: now, updatedAt: now })
    .where(eq(kycVerificationsTable.id, record.id));

  await db
    .update(usersTable)
    .set({ kycStatus: "rejected", updatedAt: now })
    .where(eq(usersTable.id, record.userId));

  res.json({ success: true, message: "KYC rejected" });
});

export default router;
