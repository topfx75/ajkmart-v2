import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  accountDeletionRequestsTable, usersTable, notificationsTable,
  refreshTokensTable, userSessionsTable,
} from "@workspace/db/schema";
import { eq, desc, count, sql } from "drizzle-orm";
import { sendSuccess, sendNotFound, sendValidationError } from "../../lib/response.js";
import { generateId, addAuditEntry, getClientIp, sendUserNotification, type AdminRequest } from "../admin-shared.js";
import { validateBody, validateQuery, validateParams } from "../../middleware/validate.js";

const idParamSchema = z.object({ id: z.string().min(1) }).strip();

const deletionRequestsQuerySchema = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
}).strip();

const approveRequestSchema = z.object({
  note: z.string().optional(),
}).strip();

const denyRequestSchema = z.object({
  note: z.string().min(1, "A note is required when denying a deletion request"),
}).strip();

const router = Router();

router.get("/deletion-requests", validateQuery(deletionRequestsQuerySchema), async (req, res) => {
  const statusFilter = (req.query?.status as string) ?? "";
  const page = Math.max(1, parseInt(req.query?.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit as string) || 50));
  const offset = (page - 1) * limit;

  const conditions = statusFilter && statusFilter !== "all"
    ? eq(accountDeletionRequestsTable.status, statusFilter)
    : undefined;

  const [totalResult] = await db.select({ total: count() }).from(accountDeletionRequestsTable).where(conditions);
  const total = Number(totalResult?.total ?? 0);

  const requests = await db.select({
    id: accountDeletionRequestsTable.id,
    userId: accountDeletionRequestsTable.userId,
    reason: accountDeletionRequestsTable.reason,
    status: accountDeletionRequestsTable.status,
    adminNote: accountDeletionRequestsTable.adminNote,
    reviewedAt: accountDeletionRequestsTable.reviewedAt,
    createdAt: accountDeletionRequestsTable.createdAt,
    userName: usersTable.name,
    userPhone: usersTable.phone,
    userEmail: usersTable.email,
    userRole: usersTable.role,
  })
    .from(accountDeletionRequestsTable)
    .leftJoin(usersTable, eq(accountDeletionRequestsTable.userId, usersTable.id))
    .where(conditions)
    .orderBy(desc(accountDeletionRequestsTable.createdAt))
    .limit(limit)
    .offset(offset);

  sendSuccess(res, {
    requests: requests.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.post("/deletion-requests/:id/approve", validateParams(idParamSchema), validateBody(approveRequestSchema), async (req, res) => {
  const requestId = req.params["id"]!;
  const { note } = req.body as { note?: string };

  const [request] = await db.select().from(accountDeletionRequestsTable)
    .where(eq(accountDeletionRequestsTable.id, requestId)).limit(1);
  if (!request) { sendNotFound(res, "Deletion request not found"); return; }
  if (request.status !== "pending") { sendValidationError(res, "Request is not pending"); return; }

  const userId = request.userId;
  const now = new Date();
  const scrambledPhone = `GDEL_${userId.slice(-8)}_${Date.now()}`;

  await db.transaction(async (tx) => {
    await tx.update(accountDeletionRequestsTable).set({
      status: "approved",
      adminNote: note || "Approved by admin",
      reviewedAt: now,
    }).where(eq(accountDeletionRequestsTable.id, requestId));

    await tx.update(usersTable).set({
      isActive: false,
      isBanned: false,
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
    }).where(eq(usersTable.id, userId));

    await tx.update(refreshTokensTable).set({ revokedAt: now }).where(eq(refreshTokensTable.userId, userId));
    await tx.update(userSessionsTable).set({ revokedAt: now }).where(eq(userSessionsTable.userId, userId));
  });

  const adminReq = req as AdminRequest;
  addAuditEntry({ action: "deletion_request_approved", ip: getClientIp(req), adminId: adminReq.adminId, details: `Deletion approved for user ${userId}`, result: "success" });

  sendSuccess(res, { success: true, message: "Account deleted successfully" });
});

router.post("/deletion-requests/:id/deny", validateParams(idParamSchema), validateBody(denyRequestSchema), async (req, res) => {
  const requestId = req.params["id"]!;
  const { note } = req.body as { note?: string };

  if (!note) { sendValidationError(res, "A note is required when denying a deletion request"); return; }

  const [request] = await db.select().from(accountDeletionRequestsTable)
    .where(eq(accountDeletionRequestsTable.id, requestId)).limit(1);
  if (!request) { sendNotFound(res, "Deletion request not found"); return; }
  if (request.status !== "pending") { sendValidationError(res, "Request is not pending"); return; }

  await db.update(accountDeletionRequestsTable).set({
    status: "denied",
    adminNote: note,
    reviewedAt: new Date(),
  }).where(eq(accountDeletionRequestsTable.id, requestId));

  await sendUserNotification(
    request.userId,
    "Account Deletion Request Denied",
    `Your account deletion request has been denied. Reason: ${note}`,
    "system",
    "information-circle-outline"
  );

  const adminReq = req as AdminRequest;
  addAuditEntry({ action: "deletion_request_denied", ip: getClientIp(req), adminId: adminReq.adminId, details: `Deletion denied for user ${request.userId}: ${note}`, result: "success" });

  sendSuccess(res, { success: true, message: "Request denied" });
});

export default router;
