import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { kycVerificationsTable, usersTable } from "@workspace/db/schema";
import { eq, desc, and, ne } from "drizzle-orm";
import { randomUUID } from "crypto";
import { customerAuth } from "../middleware/security.js";
import { adminAuth } from "./admin.js";
import { getPlatformSettings } from "./admin-shared.js";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { logger } from "../lib/logger.js";
import { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden, sendValidationError } from "../lib/response.js";
import { imageUpload, validateImageBuffer, validateBase64Image, handleMulterError } from "../lib/upload-validator.js";

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, "").trim();

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads/kyc");

const kycUpload = imageUpload;

async function saveKycPhoto(userId: string, type: string, buffer: Buffer, mime: string): Promise<string> {
  const ext = mime === "image/png" ? ".png" : mime === "image/webp" ? ".webp" : ".jpg";
  const filename = `kyc_${userId.slice(-8)}_${type}_${randomUUID().slice(0, 8)}${ext}`;
  await mkdir(UPLOADS_DIR, { recursive: true });
  await writeFile(path.join(UPLOADS_DIR, filename), buffer);
  return `/api/uploads/kyc/${filename}`;
}

/** Task 11: Check if this user is allowed to submit KYC.
 *  Riders and vendors always allowed. Customers only allowed if
 *  platform config has wallet_kyc_required=on. */
async function canSubmitKyc(userId: string): Promise<{ allowed: boolean; reason?: string }> {
  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) return { allowed: false, reason: "User not found" };

  const role = user.role ?? "customer";
  if (role === "rider" || role === "vendor") return { allowed: true };

  /* Customer: check platform config */
  const settings = await getPlatformSettings();
  if (settings["wallet_kyc_required"] === "on" || settings["upload_kyc_docs"] === "on") {
    return { allowed: true };
  }

  return { allowed: false, reason: "KYC verification is not required for your account type." };
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
  (req, res, next) => {
    kycUpload.fields([
      { name: "frontIdPhoto", maxCount: 1 },
      { name: "backIdPhoto", maxCount: 1 },
      { name: "selfiePhoto", maxCount: 1 },
      { name: "idFront", maxCount: 1 },
      { name: "idBack", maxCount: 1 },
      { name: "selfie", maxCount: 1 },
      { name: "idPhoto", maxCount: 1 },
    ])(req, res, (err) => {
      handleMulterError(err, req, res, next);
    });
  },
  async (req, res) => {
    const userId = req.customerId!;

    const { allowed, reason } = await canSubmitKyc(userId);
    if (!allowed) {
      sendForbidden(res, reason ?? "KYC not required for your account type.");
      return;
    }

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const frontFile = files?.["frontIdPhoto"]?.[0] ?? files?.["idFront"]?.[0] ?? files?.["idPhoto"]?.[0];
    const backFile  = files?.["backIdPhoto"]?.[0]  ?? files?.["idBack"]?.[0];
    const selfieFile = files?.["selfiePhoto"]?.[0] ?? files?.["selfie"]?.[0];
    if (!frontFile)  { res.status(400).json({ success: false, error: "Front side of CNIC is required" }); return; }
    if (!backFile)   { res.status(400).json({ success: false, error: "Back side of CNIC is required" }); return; }
    if (!selfieFile) { res.status(400).json({ success: false, error: "Selfie photo is required" }); return; }

    try {
      validateImageBuffer(frontFile.buffer, frontFile.mimetype, "Front CNIC photo");
      validateImageBuffer(backFile.buffer, backFile.mimetype, "Back CNIC photo");
      validateImageBuffer(selfieFile.buffer, selfieFile.mimetype, "Selfie photo");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid image file";
      res.status(400).json({ success: false, error: msg });
      return;
    }

    const rawBody = req.body;
    const fullName = typeof rawBody.fullName === "string" ? stripHtml(rawBody.fullName) : "";
    const cnic = typeof rawBody.cnic === "string" ? rawBody.cnic : "";
    const dateOfBirth = rawBody.dateOfBirth;
    const gender = rawBody.gender;
    const address = typeof rawBody.address === "string" ? stripHtml(rawBody.address) : undefined;
    const city = typeof rawBody.city === "string" ? stripHtml(rawBody.city) : undefined;

    if (!fullName)          { res.status(400).json({ error: "Full name is required" }); return; }
    if (!cnic?.trim())      { res.status(400).json({ error: "CNIC number is required" }); return; }
    if (!/^\d{13}$/.test(cnic.replace(/[-\s]/g, ""))) {
      res.status(400).json({ error: "CNIC must be 13 digits (e.g. 3740512345678)" }); return;
    }
    if (!dateOfBirth)       { res.status(400).json({ error: "Date of birth is required" }); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      res.status(400).json({ error: "Date of birth must be in YYYY-MM-DD format" }); return;
    }
    const dobDateMp = new Date(dateOfBirth);
    if (isNaN(dobDateMp.getTime()) || dobDateMp > new Date()) {
      res.status(400).json({ error: "Date of birth must be a valid past date" }); return;
    }
    if (!gender)            { res.status(400).json({ error: "Gender is required" }); return; }
    if (!["male", "female"].includes(gender)) {
      res.status(400).json({ error: "Gender must be 'male' or 'female'" }); return;
    }

    const cnicClean = cnic.replace(/[-\s]/g, "");

    try {
      await db.transaction(async (tx) => {
        /* Block re-submission if already approved */
        const [existing] = await tx
          .select({ id: kycVerificationsTable.id, status: kycVerificationsTable.status })
          .from(kycVerificationsTable)
          .where(eq(kycVerificationsTable.userId, userId))
          .orderBy(desc(kycVerificationsTable.createdAt))
          .limit(1);

        if (existing?.status === "approved") {
          throw Object.assign(new Error("KYC already verified"), { statusCode: 400 });
        }

        /* Block duplicate CNIC across different users */
        const [cnicDuplicate] = await tx
          .select({ userId: kycVerificationsTable.userId })
          .from(kycVerificationsTable)
          .where(and(
            eq(kycVerificationsTable.cnic, cnicClean),
            ne(kycVerificationsTable.userId, userId),
          ))
          .limit(1);

        if (cnicDuplicate) {
          throw Object.assign(new Error("This CNIC is already registered to another account."), { statusCode: 409 });
        }

        const [frontUrl, backUrl, selfieUrl] = await Promise.all([
          saveKycPhoto(userId, "front",  frontFile.buffer, frontFile.mimetype),
          saveKycPhoto(userId, "back",   backFile.buffer,  backFile.mimetype),
          saveKycPhoto(userId, "selfie", selfieFile.buffer, selfieFile.mimetype),
        ]);

        const id = randomUUID();
        const now = new Date();

        if (existing?.status === "rejected" || existing?.status === "resubmit") {
          await tx.update(kycVerificationsTable).set({
            status: "pending",
            fullName,
            cnic: cnicClean,
            dateOfBirth,
            gender,
            address: address ?? null,
            city: city ?? null,
            frontIdPhoto: frontUrl,
            backIdPhoto: backUrl,
            selfiePhoto: selfieUrl,
            rejectionReason: null,
            reviewedBy: null,
            reviewedAt: null,
            submittedAt: now,
            updatedAt: now,
          }).where(eq(kycVerificationsTable.userId, userId));
        } else {
          await tx.insert(kycVerificationsTable).values({
            id,
            userId,
            status: "pending",
            fullName,
            cnic: cnicClean,
            dateOfBirth,
            gender,
            address: address ?? null,
            city: city ?? null,
            frontIdPhoto: frontUrl,
            backIdPhoto: backUrl,
            selfiePhoto: selfieUrl,
            submittedAt: now,
            createdAt: now,
            updatedAt: now,
          });
        }

        await tx.update(usersTable)
          .set({ kycStatus: "pending", updatedAt: now })
          .where(eq(usersTable.id, userId));
      });

      res.json({ success: true, message: "KYC submitted successfully. Our team will review within 24 hours." });
    } catch (err: unknown) {
      if ((err as {statusCode?:number})?.statusCode === 400) { res.status(400).json({ error: (err instanceof Error ? err.message : String(err)) }); return; }
      if ((err as {statusCode?:number})?.statusCode === 409) { res.status(409).json({ error: (err instanceof Error ? err.message : String(err)) }); return; }
      logger.error({ err }, "KYC submit error");
      res.status(500).json({ error: "Failed to submit KYC. Please try again." });
    }
  }
);

/* ─── Customer: POST /api/kyc/submit-base64 — JSON base64 photo upload ─── */
router.post("/submit-base64", customerAuth, async (req, res) => {
  const userId = req.customerId!;

  const { allowed, reason } = await canSubmitKyc(userId);
  if (!allowed) {
    sendForbidden(res, reason ?? "KYC not required for your account type.");
    return;
  }

  const rawBody = req.body;
  const fullName = typeof rawBody.fullName === "string" ? stripHtml(rawBody.fullName) : "";
  const cnic = typeof rawBody.cnic === "string" ? rawBody.cnic : "";
  const dateOfBirth = rawBody.dateOfBirth;
  const gender = rawBody.gender;
  const address = typeof rawBody.address === "string" ? stripHtml(rawBody.address) : undefined;
  const city = typeof rawBody.city === "string" ? stripHtml(rawBody.city) : undefined;
  const { frontIdPhoto, backIdPhoto, selfiePhoto } = rawBody;

  if (!fullName)          { res.status(400).json({ error: "Full name is required" }); return; }
  if (!cnic?.trim())      { res.status(400).json({ error: "CNIC number is required" }); return; }
  if (!/^\d{13}$/.test(cnic.replace(/[-\s]/g, ""))) {
    res.status(400).json({ error: "CNIC must be 13 digits (e.g. 3740512345678)" }); return;
  }
  if (!dateOfBirth)       { res.status(400).json({ error: "Date of birth is required" }); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    res.status(400).json({ error: "Date of birth must be in YYYY-MM-DD format" }); return;
  }
  const dobDate = new Date(dateOfBirth);
  if (isNaN(dobDate.getTime()) || dobDate > new Date()) {
    res.status(400).json({ error: "Date of birth must be a valid past date" }); return;
  }
  if (!gender)            { res.status(400).json({ error: "Gender is required" }); return; }
  if (!["male", "female"].includes(gender)) {
    res.status(400).json({ error: "Gender must be 'male' or 'female'" }); return;
  }
  if (!frontIdPhoto)      { res.status(400).json({ success: false, error: "Front side of CNIC is required" }); return; }
  if (!backIdPhoto)       { res.status(400).json({ success: false, error: "Back side of CNIC is required" }); return; }
  if (!selfiePhoto)       { res.status(400).json({ success: false, error: "Selfie photo is required" }); return; }

  const cnicClean = cnic.replace(/[-\s]/g, "");

  try {
    const front = validateBase64Image(frontIdPhoto, "Front CNIC photo");
    const back  = validateBase64Image(backIdPhoto, "Back CNIC photo");
    const selfie = validateBase64Image(selfiePhoto, "Selfie photo");

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: kycVerificationsTable.id, status: kycVerificationsTable.status })
        .from(kycVerificationsTable)
        .where(eq(kycVerificationsTable.userId, userId))
        .orderBy(desc(kycVerificationsTable.createdAt))
        .limit(1);

      if (existing?.status === "approved") {
        throw Object.assign(new Error("KYC already verified"), { statusCode: 400 });
      }

      /* Block duplicate CNIC across different users */
      const [cnicDuplicate] = await tx
        .select({ userId: kycVerificationsTable.userId })
        .from(kycVerificationsTable)
        .where(and(
          eq(kycVerificationsTable.cnic, cnicClean),
          ne(kycVerificationsTable.userId, userId),
        ))
        .limit(1);

      if (cnicDuplicate) {
        throw Object.assign(new Error("This CNIC is already registered to another account."), { statusCode: 409 });
      }

      const [frontUrl, backUrl, selfieUrl] = await Promise.all([
        saveKycPhoto(userId, "front",  front.buffer,  front.mime),
        saveKycPhoto(userId, "back",   back.buffer,   back.mime),
        saveKycPhoto(userId, "selfie", selfie.buffer, selfie.mime),
      ]);

      const id  = randomUUID();
      const now = new Date();

      if (existing?.status === "rejected" || existing?.status === "resubmit") {
        await tx.update(kycVerificationsTable).set({
          status: "pending",
          fullName,
          cnic: cnicClean,
          dateOfBirth,
          gender,
          address: address ?? null,
          city: city ?? null,
          frontIdPhoto: frontUrl,
          backIdPhoto: backUrl,
          selfiePhoto: selfieUrl,
          rejectionReason: null,
          reviewedBy: null,
          reviewedAt: null,
          submittedAt: now,
          updatedAt: now,
        }).where(eq(kycVerificationsTable.userId, userId));
      } else {
        await tx.insert(kycVerificationsTable).values({
          id,
          userId,
          status: "pending",
          fullName,
          cnic: cnicClean,
          dateOfBirth,
          gender,
          address: address ?? null,
          city: city ?? null,
          frontIdPhoto: frontUrl,
          backIdPhoto: backUrl,
          selfiePhoto: selfieUrl,
          submittedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }

      await tx.update(usersTable)
        .set({ kycStatus: "pending", updatedAt: now })
        .where(eq(usersTable.id, userId));
    });

    res.json({ success: true, message: "KYC submitted successfully. Our team will review within 24 hours." });
  } catch (err: unknown) {
    if ((err as {statusCode?:number})?.statusCode === 400) { res.status(400).json({ error: (err instanceof Error ? err.message : String(err)) }); return; }
    if ((err as {statusCode?:number})?.statusCode === 409) { res.status(409).json({ error: (err instanceof Error ? err.message : String(err)) }); return; }
    logger.error({ err }, "KYC submit-base64 error");
    res.status(500).json({ error: "Failed to submit KYC. Please try again." });
  }
});

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
  if (!req.adminId) {
    res.status(403).json({ error: "Admin identity could not be verified." });
    return;
  }
  const adminId = req.adminId;

  const [record] = await db
    .select()
    .from(kycVerificationsTable)
    .where(eq(kycVerificationsTable.id, req.params["id"]!))
    .limit(1);

  if (!record) { res.status(404).json({ error: "KYC record not found" }); return; }
  if (record.status === "approved") { res.status(400).json({ error: "Already approved" }); return; }

  const [currentUser] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, record.userId))
    .limit(1);

  const now = new Date();
  await db
    .update(kycVerificationsTable)
    .set({ status: "approved", reviewedBy: adminId, reviewedAt: now, updatedAt: now })
    .where(eq(kycVerificationsTable.id, record.id));

  const syncName = (!currentUser?.name || currentUser.name.trim() === "") ? (record.fullName ?? undefined) : undefined;

  await db
    .update(usersTable)
    .set({
      kycStatus: "verified",
      approvalStatus: "approved",
      isActive: true,
      cnic: record.cnic ?? undefined,
      ...(syncName !== undefined ? { name: syncName } : {}),
      city: record.city ?? undefined,
      address: record.address ?? undefined,
      updatedAt: now,
    })
    .where(eq(usersTable.id, record.userId));

  res.json({ success: true, message: "KYC approved and account activated" });
});

/* ─── Admin: POST /api/kyc/admin/:id/reject ─── */
router.post("/admin/:id/reject", adminAuth, async (req, res) => {
  if (!req.adminId) {
    res.status(403).json({ error: "Admin identity could not be verified." });
    return;
  }
  const adminId = req.adminId;

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
