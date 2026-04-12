import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  usersTable,
  walletTransactionsTable,
  notificationsTable,
  ordersTable, ridesTable, productsTable, riderPenaltiesTable, rideRatingsTable, reviewsTable,
  vendorProfilesTable,
} from "@workspace/db/schema";
import { eq, desc, count, sum, and, gte, lte, sql, or, ilike, asc, isNull, isNotNull, avg, ne, inArray } from "drizzle-orm";
import {
  stripUser, generateId, getUserLanguage, t,
  getPlatformSettings, adminAuth, getAdminSecret,
  sendUserNotification, logger,
  ORDER_NOTIF_KEYS, RIDE_NOTIF_KEYS, PHARMACY_NOTIF_KEYS, PARCEL_NOTIF_KEYS,
  checkAdminLoginLockout, recordAdminLoginFailure, resetAdminLoginAttempts,
  addAuditEntry, addSecurityEvent, getClientIp,
  signAdminJwt, verifyAdminJwt, invalidateSettingsCache, getCachedSettings,
  ADMIN_TOKEN_TTL_HRS, verifyTotpToken, verifyAdminSecret,
  ensureDefaultRideServices, ensureDefaultLocations, formatSvc,
  type AdminRequest, type TranslationKey, revokeAllUserSessions, serializeSosAlert,
} from "../admin-shared.js";
import { sendSuccess, sendError, sendNotFound, sendForbidden, sendValidationError } from "../../lib/response.js";
import { validateBody, validateQuery, validateParams } from "../../middleware/validate.js";

const idParamSchema = z.object({ id: z.string().min(1) }).strip();

const vendorStatusSchema = z.object({
  isActive: z.boolean().optional(),
  isBanned: z.boolean().optional(),
  banReason: z.string().optional(),
  securityNote: z.string().optional(),
}).strip();

const positiveAmountSchema = z.object({
  amount: z.number().positive("amount must be positive"),
  description: z.string().optional(),
}).strip();

const riderStatusSchema = z.object({
  isActive: z.boolean().optional(),
  isBanned: z.boolean().optional(),
  banReason: z.string().optional(),
}).strip();

const approveWithdrawalSchema = z.object({
  refNo: z.string().optional(),
  note: z.string().optional(),
}).strip();

const rejectWithdrawalSchema = z.object({
  reason: z.string().min(1, "reason is required when rejecting a withdrawal"),
}).strip();

const transactionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
}).strip();

const depositRequestsQuerySchema = z.object({
  status: z.string().optional(),
}).strip();

const approveDepositSchema = z.object({
  refNo: z.string().optional(),
  note: z.string().optional(),
}).strip();

const rejectDepositSchema = z.object({
  reason: z.string().optional(),
}).strip();

const batchWithdrawalSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "at least one id is required"),
  refNo: z.string().optional(),
  note: z.string().optional(),
  reason: z.string().optional(),
}).strip();

const vendorCommissionSchema = z.object({
  commissionPct: z.number().min(0).max(100, "commissionPct must be between 0 and 100"),
}).strip();

const riderCreditSchema = z.object({
  amount: z.number().positive("amount must be positive"),
  description: z.string().optional(),
  type: z.enum(["bonus", "credit"]).optional(),
}).strip();

const overrideSuspensionSchema = z.object({
  reason: z.string().optional(),
}).strip();

const withdrawalRequestsQuerySchema = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
}).strip();

const router = Router();
router.get("/transactions", validateQuery(transactionsQuerySchema), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query?.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query?.limit as string) || 50));
    const offset = (page - 1) * limit;

    const [totalResult, transactions] = await Promise.all([
      db.select({ total: count() }).from(walletTransactionsTable),
      db.select().from(walletTransactionsTable).orderBy(desc(walletTransactionsTable.createdAt)).limit(limit).offset(offset),
    ]);

    const total = Number(totalResult[0]?.total ?? 0);
    const totalCredit = transactions.filter(t => t.type === "credit").reduce((s, t) => s + parseFloat(t.amount), 0);
    const totalDebit = transactions.filter(t => t.type === "debit").reduce((s, t) => s + parseFloat(t.amount), 0);

    sendSuccess(res, {
      transactions: transactions.map(t => ({
        ...t,
        amount: parseFloat(t.amount),
        createdAt: t.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      totalCredit,
      totalDebit,
    });
  } catch (e) {
    logger.error({ err: e }, "[admin/finance] transactions list error");
    sendError(res, "Failed to load transactions.", 500);
  }
});

/* ── Platform Settings ── */
router.get("/transactions-enriched", validateQuery(transactionsQuerySchema), async (req, res) => {
  const page = Math.max(1, parseInt(req.query?.page as string) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query?.limit as string) || 50));
  const offset = (page - 1) * limit;

  const [totalResult, transactions] = await Promise.all([
    db.select({ total: count() }).from(walletTransactionsTable),
    db.select().from(walletTransactionsTable).orderBy(desc(walletTransactionsTable.createdAt)).limit(limit).offset(offset),
  ]);

  const total = Number(totalResult[0]?.total ?? 0);
  const userIds = transactions.map(t => t.userId);
  const users = userIds.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone }).from(usersTable).where(inArray(usersTable.id, userIds))
    : [];
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));

  const enriched = transactions.map(t => ({
    ...t,
    amount: parseFloat(t.amount),
    createdAt: t.createdAt.toISOString(),
    userName: userMap[t.userId]?.name || null,
    userPhone: userMap[t.userId]?.phone || null,
  }));

  const totalCredit = enriched.filter(t => t.type === "credit").reduce((s, t) => s + t.amount, 0);
  const totalDebit = enriched.filter(t => t.type === "debit").reduce((s, t) => s + t.amount, 0);

  sendSuccess(res, { transactions: enriched, total, page, limit, totalPages: Math.ceil(total / limit), totalCredit, totalDebit });
});

/* ── Delete User ── */
router.get("/vendors", async (_req, res) => {
  try {
  const vendors = await db.select({
    id: usersTable.id,
    phone: usersTable.phone,
    name: usersTable.name,
    email: usersTable.email,
    storeName: vendorProfilesTable.storeName,
    storeCategory: vendorProfilesTable.storeCategory,
    storeIsOpen: vendorProfilesTable.storeIsOpen,
    storeDescription: vendorProfilesTable.storeDescription,
    autoConfirm: vendorProfilesTable.autoConfirm,
    walletBalance: usersTable.walletBalance,
    isActive: usersTable.isActive,
    isBanned: usersTable.isBanned,
    approvalStatus: usersTable.approvalStatus,
    approvalNote: usersTable.approvalNote,
    roles: usersTable.roles,
    role: usersTable.role,
    createdAt: usersTable.createdAt,
    lastLoginAt: usersTable.lastLoginAt,
  }).from(usersTable)
    .leftJoin(vendorProfilesTable, eq(usersTable.id, vendorProfilesTable.userId))
    .where(or(ilike(usersTable.roles, "%vendor%"), eq(usersTable.role, "vendor")))
    .orderBy(desc(usersTable.createdAt));

  const vendorIds = vendors.map(v => v.id);
  let orderStats: { vendorId: string | null; totalOrders: number; totalRevenue: string | null; pendingOrders: number }[] = [];
  if (vendorIds.length > 0) {
    orderStats = await db.select({
      vendorId: ordersTable.vendorId,
      totalOrders: count(),
      totalRevenue: sum(ordersTable.total),
      pendingOrders: sql<number>`COUNT(*) FILTER (WHERE ${ordersTable.status} = 'pending')`,
    }).from(ordersTable).where(inArray(ordersTable.vendorId, vendorIds)).groupBy(ordersTable.vendorId).catch(() => []);
  }

  const statsMap = Object.fromEntries(orderStats.map(s => [s.vendorId, s]));

  sendSuccess(res, {
    vendors: vendors.map(v => {
      const stats = statsMap[v.id] || {};
      return {
        id: v.id, phone: v.phone, name: v.name, email: v.email,
        storeName: v.storeName, storeCategory: v.storeCategory,
        storeIsOpen: v.storeIsOpen, storeDescription: v.storeDescription,
        autoConfirm: v.autoConfirm ?? false,
        walletBalance: parseFloat(v.walletBalance ?? "0"),
        isActive: v.isActive, isBanned: v.isBanned,
        approvalStatus: v.approvalStatus, approvalNote: v.approvalNote,
        roles: v.roles, role: v.role,
        createdAt: v.createdAt.toISOString(),
        lastLoginAt: v.lastLoginAt ? v.lastLoginAt.toISOString() : null,
        totalOrders: Number(stats.totalOrders ?? 0),
        totalRevenue: parseFloat(String(stats.totalRevenue ?? "0")),
        pendingOrders: Number(stats.pendingOrders ?? 0),
      };
    }),
    total: vendors.length,
  });
  } catch (e) {
    logger.error({ err: e }, "[admin/finance] vendors list error");
    sendError(res, "Failed to load vendors.", 500);
  }
});

router.patch("/vendors/:id/status", validateParams(idParamSchema), validateBody(vendorStatusSchema), async (req, res) => {
  const { isActive, isBanned, banReason, securityNote } = req.body;
  const updates: Partial<typeof usersTable.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() };
  if (isActive    !== undefined) updates.isActive    = isActive;
  if (isBanned    !== undefined) updates.isBanned    = isBanned;
  if (banReason   !== undefined) updates.banReason   = banReason || null;
  if (securityNote !== undefined) updates.securityNote = securityNote || null;
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, req.params["id"]!)).returning();
  if (!user) { sendNotFound(res, "Vendor not found"); return; }
  if (isBanned || isActive === false) {
    revokeAllUserSessions(req.params["id"]!).catch(() => {});
    if (isBanned) {
      await sendUserNotification(req.params["id"]!, "Store Account Suspended ⚠️", banReason || "Your vendor account has been suspended. Contact support.", "warning", "warning-outline");
    }
  }
  sendSuccess(res, { ...user, walletBalance: parseFloat(String(user.walletBalance ?? "0")) });
});

router.post("/vendors/:id/payout", validateParams(idParamSchema), validateBody(positiveAmountSchema), async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    sendValidationError(res, "Valid amount required"); return;
  }
  const [vendor] = await db.select().from(usersTable).where(eq(usersTable.id, req.params["id"]!)).limit(1);
  if (!vendor) { sendNotFound(res, "Vendor not found"); return; }
  const amt = Number(amount);
  const txResult = await db.transaction(async (tx) => {
    /* Lock vendor row (SELECT FOR UPDATE) — serializes concurrent payout requests
       so the balance check is performed on the committed balance, not a stale snapshot. */
    const [locked] = await tx.select({ walletBalance: usersTable.walletBalance })
      .from(usersTable).where(eq(usersTable.id, vendor.id)).limit(1).for("update");
    if (!locked) throw new Error("NOT_FOUND");
    if (parseFloat(locked.walletBalance ?? "0") < amt) throw new Error("INSUFFICIENT_BALANCE");

    const [updated] = await tx.update(usersTable)
      .set({ walletBalance: sql`GREATEST(wallet_balance - ${amt}, 0)`, updatedAt: new Date() })
      .where(and(eq(usersTable.id, vendor.id), gte(usersTable.walletBalance, String(amt))))
      .returning();
    if (!updated) throw new Error("INSUFFICIENT_BALANCE");
    await tx.insert(walletTransactionsTable).values({
      id: generateId(), userId: vendor.id, type: "debit", amount: String(amt),
      description: description || `Admin payout processed: Rs. ${amt}`, reference: "admin_payout",
    });
    return { updated, newBal: parseFloat(updated.walletBalance ?? "0") };
  }).catch((err: Error) => {
    if (err.message === "INSUFFICIENT_BALANCE" || err.message === "NOT_FOUND") return err.message;
    throw err;
  });
  if (txResult === "NOT_FOUND") {
    sendNotFound(res, "Vendor not found"); return;
  }
  if (txResult === "INSUFFICIENT_BALANCE" || !txResult) {
    sendValidationError(res, `Insufficient wallet balance`); return;
  }
  await sendUserNotification(vendor.id, "Payout Processed 💰", `Rs. ${amt} has been paid out from your vendor wallet.`, "system", "cash-outline");
  sendSuccess(res, { amount: amt, newBalance: txResult.newBal, vendor: { ...stripUser(txResult.updated), walletBalance: txResult.newBal } });
});

router.post("/vendors/:id/credit", validateParams(idParamSchema), validateBody(positiveAmountSchema), async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    sendValidationError(res, "Valid amount required"); return;
  }
  const vendorId = req.params["id"] as string;
  const amt = Number(amount);
  let updated: typeof usersTable.$inferSelect | undefined;
  let newBal = 0;
  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, vendorId)).limit(1);
      if (!existing) throw new Error("NOT_FOUND");
      const [u] = await tx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance + ${amt}`, updatedAt: new Date() })
        .where(eq(usersTable.id, vendorId))
        .returning();
      if (!u) throw new Error("NOT_FOUND");
      await tx.insert(walletTransactionsTable).values({
        id: generateId(), userId: vendorId, type: "credit", amount: String(amt),
        description: description || `Admin credit: Rs. ${amt}`, reference: "admin_credit",
      });
      updated = u;
      newBal = parseFloat(u.walletBalance ?? "0");
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "NOT_FOUND") { sendNotFound(res, "Vendor not found"); return; }
    throw err;
  }
  await sendUserNotification(vendorId, "Wallet Credited 💰", `Rs. ${amt} has been credited to your vendor wallet.`, "system", "wallet-outline");
  sendSuccess(res, { amount: amt, newBalance: newBal, vendor: { ...stripUser(updated!), walletBalance: newBal } });
});

/* ══════════════════════════════════════
   RIDER MANAGEMENT
══════════════════════════════════════ */
router.get("/riders", async (_req, res) => {
  try {
    const riders = await db.select().from(usersTable).where(
      or(ilike(usersTable.roles, "%rider%"), eq(usersTable.role, "rider"))
    ).orderBy(desc(usersTable.createdAt));

    const riderIds = riders.map(r => r.id);
    const [penaltyRows, ratingRows] = await Promise.all([
      riderIds.length > 0
        ? db.select({ riderId: riderPenaltiesTable.riderId, total: sum(riderPenaltiesTable.amount) })
            .from(riderPenaltiesTable)
            .where(sql`${riderPenaltiesTable.riderId} IN ${riderIds}`)
            .groupBy(riderPenaltiesTable.riderId)
        : Promise.resolve([]),
      riderIds.length > 0
        ? db.select({ riderId: rideRatingsTable.riderId, avgRating: sql<string>`ROUND(AVG(${rideRatingsTable.stars})::numeric, 1)`, ratingCount: count() })
            .from(rideRatingsTable)
            .where(sql`${rideRatingsTable.riderId} IN ${riderIds}`)
            .groupBy(rideRatingsTable.riderId)
        : Promise.resolve([]),
    ]);
    const penaltyMap = new Map(penaltyRows.map((r: Record<string, unknown>) => [r.riderId, parseFloat(String(r.total ?? "0"))]));
    const ratingMap = new Map(ratingRows.map((r: Record<string, unknown>) => [r.riderId, { avg: parseFloat(String(r.avgRating ?? "0")), count: r.ratingCount }]));

    sendSuccess(res, {
      riders: riders.map(r => ({
        id: r.id, phone: r.phone, name: r.name, email: r.email,
        avatar: r.avatar,
        walletBalance: parseFloat(r.walletBalance ?? "0"),
        isActive: r.isActive, isBanned: r.isBanned,
        isRestricted: r.isRestricted ?? false,
        cancelCount: r.cancelCount ?? 0,
        ignoreCount: r.ignoreCount ?? 0,
        penaltyTotal: penaltyMap.get(r.id) ?? 0,
        avgRating: ratingMap.get(r.id)?.avg ?? 0,
        ratingCount: ratingMap.get(r.id)?.count ?? 0,
        roles: r.roles, role: r.role,
        isOnline: (r as Record<string, unknown>)["isOnline"] as boolean ?? false,
        silenceMode: (r as Record<string, unknown>)["silenceMode"] as boolean ?? false,
        silenceModeUntil: (r as Record<string, unknown>)["silenceModeUntil"] ? ((r as Record<string, unknown>)["silenceModeUntil"] as Date).toISOString() : null,
        approvalStatus: r.approvalStatus,
        createdAt: r.createdAt.toISOString(),
        lastLoginAt: r.lastLoginAt ? r.lastLoginAt.toISOString() : null,
      })),
      total: riders.length,
    });
  } catch (e) {
    logger.error({ err: e }, "[admin/finance] riders list error");
    sendError(res, "Failed to load riders.", 500);
  }
});

router.patch("/riders/:id/status", validateParams(idParamSchema), validateBody(riderStatusSchema), async (req, res) => {
  const { isActive, isBanned, banReason } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (isActive  !== undefined) updates.isActive  = isActive;
  if (isBanned  !== undefined) updates.isBanned  = isBanned;
  if (banReason !== undefined) updates.banReason = banReason || null;
  if (isActive === true) {
    const [current] = await db.select({ isBanned: usersTable.isBanned }).from(usersTable).where(eq(usersTable.id, req.params["id"]!)).limit(1);
    if (!isBanned && !current?.isBanned) updates.approvalStatus = "approved";
  }
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, req.params["id"]!)).returning();
  if (!user) { sendNotFound(res, "Rider not found"); return; }
  if (isBanned || isActive === false) {
    revokeAllUserSessions(req.params["id"]!).catch(() => {});
    if (isBanned) {
      await sendUserNotification(req.params["id"]!, "Rider Account Suspended ⚠️", banReason || "Your rider account has been suspended. Contact support.", "warning", "warning-outline");
    }
  }
  sendSuccess(res, { ...user, walletBalance: parseFloat(String(user.walletBalance ?? "0")) });
});

router.post("/riders/:id/payout", validateParams(idParamSchema), validateBody(positiveAmountSchema), async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    sendValidationError(res, "Valid amount required"); return;
  }
  const [riderPre] = await db.select({ id: usersTable.id, walletBalance: usersTable.walletBalance })
    .from(usersTable).where(eq(usersTable.id, req.params["id"]!)).limit(1);
  if (!riderPre) { sendNotFound(res, "Rider not found"); return; }
  const amt = Number(amount);
  /* Fast-fail shortcut (not authoritative — the locked balance inside the transaction is). */
  const preBal = parseFloat(riderPre.walletBalance ?? "0");
  if (preBal < amt) {
    sendValidationError(res, `Insufficient wallet balance (Rs. ${preBal.toFixed(0)})`); return;
  }

  let updated: typeof usersTable.$inferSelect | undefined;
  const txResult = await db.transaction(async (tx) => {
    /* Lock rider row (SELECT FOR UPDATE) — serializes concurrent payout requests so the
       balance check uses the committed balance, preventing double-deduction race conditions. */
    const [locked] = await tx.select({ walletBalance: usersTable.walletBalance })
      .from(usersTable).where(eq(usersTable.id, riderPre.id)).limit(1).for("update");
    if (!locked) throw new Error("NOT_FOUND");
    if (parseFloat(locked.walletBalance ?? "0") < amt) throw new Error("INSUFFICIENT_BALANCE");

    const [deducted] = await tx.update(usersTable)
      .set({ walletBalance: sql`wallet_balance - ${amt}`, updatedAt: new Date() })
      .where(and(eq(usersTable.id, riderPre.id), sql`CAST(wallet_balance AS NUMERIC) >= ${amt}`))
      .returning();
    if (!deducted) throw new Error("INSUFFICIENT_BALANCE");

    await tx.insert(walletTransactionsTable).values({
      id: generateId(), userId: riderPre.id, type: "debit", amount: String(amt),
      description: description || `Rider payout: Rs. ${amt}`, reference: "rider_payout",
    });
    updated = deducted;
    return deducted;
  }).catch((err: Error) => {
    if (err.message === "INSUFFICIENT_BALANCE" || err.message === "NOT_FOUND") return err.message;
    throw err;
  });

  if (txResult === "NOT_FOUND") {
    sendNotFound(res, "Rider not found"); return;
  }
  if (txResult === "INSUFFICIENT_BALANCE" || !txResult) {
    sendValidationError(res, "Payout failed: insufficient balance at time of processing (possible concurrent request)."); return;
  }
  const newBal = parseFloat(updated!.walletBalance ?? "0");
  await sendUserNotification(riderPre.id, "Earnings Paid Out 💵", `Rs. ${amt} has been paid out to your account.`, "system", "cash-outline");
  sendSuccess(res, { amount: amt, newBalance: newBal, rider: { ...updated, walletBalance: newBal } });
});

router.post("/riders/:id/bonus", validateParams(idParamSchema), validateBody(positiveAmountSchema), async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    sendValidationError(res, "Valid amount required"); return;
  }
  const riderId = req.params["id"]!;
  const amt = Number(amount);
  const txId = generateId();

  let updated: typeof usersTable.$inferSelect | undefined;
  let newBal = 0;
  try {
    await db.transaction(async (tx) => {
      const [rider] = await tx.select().from(usersTable).where(eq(usersTable.id, riderId)).limit(1);
      if (!rider) throw new Error("NOT_FOUND");
      await tx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance + ${amt}`, updatedAt: new Date() })
        .where(eq(usersTable.id, riderId));
      await tx.insert(walletTransactionsTable).values({
        id: txId, userId: riderId, type: "credit", amount: String(amt),
        description: description || `Admin bonus: Rs. ${amt}`, reference: "rider_bonus",
      });
      const [refreshed] = await tx.select().from(usersTable).where(eq(usersTable.id, riderId)).limit(1);
      updated = refreshed;
      newBal = parseFloat(refreshed?.walletBalance ?? "0");
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      sendNotFound(res, "Rider not found"); return;
    }
    throw err;
  }
  await sendUserNotification(riderId, "Bonus Received! 🎉", `Rs. ${amt} bonus has been added to your wallet.`, "system", "gift-outline");
  sendSuccess(res, { amount: amt, newBalance: newBal, rider: { ...updated, walletBalance: newBal } });
});

router.get("/riders/:id/penalties", validateParams(idParamSchema), async (req, res) => {
  const riderId = req.params["id"]!;
  const penalties = await db.select().from(riderPenaltiesTable)
    .where(eq(riderPenaltiesTable.riderId, riderId))
    .orderBy(desc(riderPenaltiesTable.createdAt))
    .limit(100);
  sendSuccess(res, { penalties: penalties.map(p => ({ ...p, amount: parseFloat(String(p.amount)) })) });
});

router.get("/riders/:id/ratings", validateParams(idParamSchema), async (req, res) => {
  const riderId = req.params["id"]!;
  const ratings = await db.select().from(rideRatingsTable)
    .where(eq(rideRatingsTable.riderId, riderId))
    .orderBy(desc(rideRatingsTable.createdAt))
    .limit(100);
  sendSuccess(res, { ratings });
});

router.post("/riders/:id/restrict", validateParams(idParamSchema), async (req, res) => {
  const riderId = req.params["id"]!;
  const [user] = await db.update(usersTable)
    .set({ isRestricted: true, updatedAt: new Date() })
    .where(eq(usersTable.id, riderId))
    .returning();
  if (!user) { sendNotFound(res, "Rider not found"); return; }
  await sendUserNotification(riderId, "Account Restricted ⚠️", "Your account has been restricted by admin. Contact support for more details.", "system", "alert-circle-outline");
  sendSuccess(res, { isRestricted: true });
});

router.post("/riders/:id/unrestrict", validateParams(idParamSchema), async (req, res) => {
  const riderId = req.params["id"]!;
  const [user] = await db.update(usersTable)
    .set({ isRestricted: false, updatedAt: new Date() })
    .where(eq(usersTable.id, riderId))
    .returning();
  if (!user) { sendNotFound(res, "Rider not found"); return; }
  await sendUserNotification(riderId, "Account Unrestricted ✅", "Your account has been unrestricted. You can now accept rides again.", "system", "checkmark-circle-outline");
  sendSuccess(res, { isRestricted: false });
});

/* ── GET /admin/withdrawal-requests ─────────── */
router.get("/withdrawal-requests", validateQuery(withdrawalRequestsQuerySchema), async (req, res) => {
  const statusFilter = req.query["status"] as string | undefined;
  const page = Math.max(1, parseInt(req.query?.page as string) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query?.limit as string) || 50));
  const offset = (page - 1) * limit;

  const whereConditions: ReturnType<typeof and>[] = [eq(walletTransactionsTable.type, "withdrawal")];
  if (statusFilter === "pending") {
    whereConditions.push(sql`(${walletTransactionsTable.reference} IS NULL OR ${walletTransactionsTable.reference} = 'pending')`);
  } else if (statusFilter === "paid") {
    whereConditions.push(sql`${walletTransactionsTable.reference} LIKE 'paid:%'`);
  } else if (statusFilter === "rejected") {
    whereConditions.push(sql`${walletTransactionsTable.reference} LIKE 'rejected:%'`);
  }

  const whereClause = and(...whereConditions);
  const [totalResult, txns] = await Promise.all([
    db.select({ total: count() }).from(walletTransactionsTable).where(whereClause),
    db.select().from(walletTransactionsTable)
      .where(whereClause)
      .orderBy(desc(walletTransactionsTable.createdAt))
      .limit(limit)
      .offset(offset),
  ]);

  const total = Number(totalResult[0]?.total ?? 0);
  const userIds = txns.map(t => t.userId);
  const usersData = userIds.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, role: usersTable.role }).from(usersTable).where(inArray(usersTable.id, userIds))
    : [];
  const userMap = Object.fromEntries(usersData.map(u => [u.id, u]));

  const enriched = txns.map(t => {
    const ref = t.reference ?? "pending";
    const status = ref === "pending" ? "pending" : ref.startsWith("paid:") ? "paid" : ref.startsWith("rejected:") ? "rejected" : ref;
    const refNo = ref.startsWith("paid:") ? ref.slice(5) : ref.startsWith("rejected:") ? ref.slice(9) : "";
    return { ...t, amount: parseFloat(String(t.amount)), user: userMap[t.userId] || null, status, refNo };
  });

  sendSuccess(res, { withdrawals: enriched, total, page, limit, totalPages: Math.ceil(total / limit) });
});

/* ── PATCH /admin/withdrawal-requests/:id/approve ─── */
router.patch("/withdrawal-requests/:id/approve", validateParams(idParamSchema), validateBody(approveWithdrawalSchema), async (req, res) => {
  const { refNo, note } = req.body;
  const txId = req.params["id"]!;
  const [tx] = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
  if (!tx) { sendNotFound(res, "Withdrawal not found"); return; }
  if (tx.reference && tx.reference !== "pending") {
    sendError(res, `Already processed (${tx.reference})`, 409); return;
  }
  const ref = refNo ? `paid:${refNo.trim()}` : "paid:manual";
  /* Atomic compare-and-swap: only succeeds if still 'pending', preventing double-approval */
  const [updated] = await db
    .update(walletTransactionsTable)
    .set({ reference: ref })
    .where(and(eq(walletTransactionsTable.id, txId), eq(walletTransactionsTable.reference, "pending")))
    .returning();
  if (!updated) { sendError(res, "Withdrawal already processed by another request", 409); return; }
  const amt = parseFloat(String(tx.amount));
  const wdLang = await getUserLanguage(tx.userId);
  const wdRef = refNo ? ` Reference: ${refNo}` : "";
  const wdNote = note ? ` Note: ${note}` : "";
  await db.insert(notificationsTable).values({
    id: generateId(), userId: tx.userId,
    title: t("notifWithdrawalApproved" as TranslationKey, wdLang),
    body: t("notifWithdrawalApprovedBody" as TranslationKey, wdLang).replace("{amount}", amt.toFixed(0)).replace("{ref}", wdRef).replace("{note}", wdNote),
    type: "wallet", icon: "checkmark-circle-outline",
  }).catch(() => {});
  sendSuccess(res, { txId, status: "paid", refNo: refNo || "manual" });
});

/* ── PATCH /admin/withdrawal-requests/:id/reject ─── */
router.patch("/withdrawal-requests/:id/reject", validateParams(idParamSchema), validateBody(rejectWithdrawalSchema), async (req, res) => {
  const { reason } = req.body;
  const txId = req.params["id"]!;
  const [tx] = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
  if (!tx) { sendNotFound(res, "Withdrawal not found"); return; }
  if (tx.reference && tx.reference !== "pending") {
    sendValidationError(res, `Already processed (${tx.reference})`); return;
  }
  const rejReason = reason?.trim() || "Admin rejected";
  const amt = parseFloat(String(tx.amount));
  const txResult = await db.transaction(async (txn) => {
    const [updated] = await txn.update(walletTransactionsTable)
      .set({ reference: `rejected:${rejReason}` })
      .where(and(eq(walletTransactionsTable.id, txId), eq(walletTransactionsTable.reference, "pending")))
      .returning();
    if (!updated) throw new Error("ALREADY_PROCESSED");
    await txn.update(usersTable).set({ walletBalance: sql`wallet_balance + ${amt}`, updatedAt: new Date() }).where(eq(usersTable.id, tx.userId));
    await txn.insert(walletTransactionsTable).values({
      id: generateId(), userId: tx.userId, type: "credit",
      amount: amt.toFixed(2),
      description: `Withdrawal Refunded — ${rejReason}`,
      reference: `refund:${txId}`,
      paymentMethod: null,
    });
    return true;
  }).catch((err: Error) => {
    if (err.message === "ALREADY_PROCESSED") return null;
    throw err;
  });
  if (!txResult) { sendError(res, "Withdrawal has already been processed", 409); return; }
  const wdRejLang = await getUserLanguage(tx.userId);
  await db.insert(notificationsTable).values({
    id: generateId(), userId: tx.userId,
    title: t("notifWithdrawalRejected" as TranslationKey, wdRejLang),
    body: t("notifWithdrawalRejectedBody" as TranslationKey, wdRejLang).replace("{amount}", amt.toFixed(0)).replace("{reason}", rejReason),
    type: "wallet", icon: "close-circle-outline",
  }).catch(() => {});
  sendSuccess(res, { txId, status: "rejected", reason: rejReason, refunded: amt });
});

/* ── PATCH /admin/withdrawal-requests/batch-approve ─── */
router.patch("/withdrawal-requests/batch-approve", validateBody(batchWithdrawalSchema), async (req, res) => {
  const { ids } = req.body as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0) { sendValidationError(res, "ids required"); return; }
  const results: unknown[] = [];
  for (const txId of ids) {
    const [tx] = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
    if (!tx || (tx.reference && tx.reference !== "pending")) continue;
    const refNo = `BATCH-${Date.now()}`;
    await db.update(walletTransactionsTable).set({ reference: refNo }).where(eq(walletTransactionsTable.id, txId));
    const batchAppLang = await getUserLanguage(tx.userId);
    await db.insert(notificationsTable).values({
      id: generateId(), userId: tx.userId,
      title: t("notifWithdrawalApproved" as TranslationKey, batchAppLang),
      body: t("notifWithdrawalApprovedBody" as TranslationKey, batchAppLang).replace("{amount}", parseFloat(String(tx.amount)).toFixed(0)).replace("{ref}", ` Ref: ${refNo}`).replace("{note}", ""),
      type: "wallet", icon: "checkmark-circle-outline",
    }).catch(() => {});
    results.push(txId);
  }
  sendSuccess(res, { approved: results });
});

/* ── PATCH /admin/withdrawal-requests/batch-reject ─── */
router.patch("/withdrawal-requests/batch-reject", validateBody(batchWithdrawalSchema), async (req, res) => {
  const { ids, reason } = req.body as { ids: string[]; reason: string };
  if (!Array.isArray(ids) || ids.length === 0) { sendValidationError(res, "ids required"); return; }
  const rejReason = (reason || "Admin batch rejected").trim();
  const results: unknown[] = [];
  for (const txId of ids) {
    const processed = await db.transaction(async (trx) => {
      const [tx] = await trx.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
      if (!tx || (tx.reference && tx.reference !== "pending")) return false;
      await trx.update(walletTransactionsTable).set({ reference: `rejected:${rejReason}` }).where(eq(walletTransactionsTable.id, txId));
      const amt = parseFloat(String(tx.amount));
      await trx.update(usersTable).set({ walletBalance: sql`wallet_balance + ${amt}`, updatedAt: new Date() }).where(eq(usersTable.id, tx.userId));
      await trx.insert(walletTransactionsTable).values({
        id: generateId(), userId: tx.userId, type: "credit", amount: amt.toFixed(2),
        description: `Withdrawal Refunded — ${rejReason}`, reference: `refund:${txId}`, paymentMethod: null,
      });
      return { userId: tx.userId, amt };
    });
    if (!processed) continue;
    const batchRejLang = await getUserLanguage(processed.userId);
    await db.insert(notificationsTable).values({
      id: generateId(), userId: processed.userId,
      title: t("notifWithdrawalRejected" as TranslationKey, batchRejLang),
      body: t("notifWithdrawalRejectedBody" as TranslationKey, batchRejLang).replace("{amount}", processed.amt.toFixed(0)).replace("{reason}", rejReason),
      type: "wallet", icon: "close-circle-outline",
    }).catch(() => {});
    results.push(txId);
  }
  sendSuccess(res, { rejected: results });
});

/* ── GET /admin/deposit-requests — List all rider deposit requests ─── */
router.get("/deposit-requests", validateQuery(depositRequestsQuerySchema), async (req, res) => {
  const statusFilter = req.query["status"] as string | undefined;
  const txns = await db.select().from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.type, "deposit"))
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(200);
  const enriched = await Promise.all(txns.map(async t => {
    const [user] = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, t.userId)).limit(1);
    const ref = t.reference ?? "pending";
    const isPending = ref === "pending" || ref.startsWith("pending:");
    const status = isPending ? "pending" : ref.startsWith("approved:") ? "approved" : ref.startsWith("rejected:") ? "rejected" : ref;
    const refNo = ref.startsWith("approved:") || ref.startsWith("rejected:") ? ref.split(":").slice(1).join(":") : "";
    return { ...t, amount: parseFloat(String(t.amount)), user: user || null, status, refNo };
  }));
  const filtered = statusFilter ? enriched.filter(d => d.status === statusFilter) : enriched;
  sendSuccess(res, { deposits: filtered });
});

/* ── PATCH /admin/deposit-requests/:id/approve — Approve a rider deposit (credits wallet, atomic) ─── */
router.patch("/deposit-requests/:id/approve", validateParams(idParamSchema), validateBody(approveDepositSchema), async (req, res) => {
  const { refNo, note } = req.body;
  const txId = req.params["id"]!;

  const [tx] = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
  if (!tx) { sendNotFound(res, "Deposit not found"); return; }
  if (tx.type !== "deposit") { sendValidationError(res, "Not a deposit record"); return; }

  const amt = parseFloat(String(tx.amount));
  const txidSuffix = (tx.reference && tx.reference.includes("txid:")) ? `:${tx.reference.split("txid:").pop()}` : "";

  if (txidSuffix) {
    const dupes = await db.select({ id: walletTransactionsTable.id })
      .from(walletTransactionsTable)
      .where(and(
        eq(walletTransactionsTable.type, "deposit"),
        sql`${walletTransactionsTable.reference} LIKE ${'%approved%' + txidSuffix}`,
        sql`RIGHT(${walletTransactionsTable.reference}, ${txidSuffix.length}) = ${txidSuffix}`,
      ))
      .limit(1);
    if (dupes.length > 0) {
      sendError(res, "A deposit with this Transaction ID has already been approved", 409); return;
    }
  }
  const approvedRef = refNo ? `approved:${refNo.trim()}${txidSuffix}` : `approved:manual${txidSuffix}`;

  /* Fully atomic: conditional state-transition + wallet credit in ONE transaction.
     If the conditional update hits 0 rows (already processed), transaction rolls back
     and we return 409. No double-credit or orphaned approval possible. */
  let approved = false;
  try {
    await db.transaction(async (trx) => {
      const [marked] = await trx.update(walletTransactionsTable)
        .set({ reference: approvedRef })
        .where(and(eq(walletTransactionsTable.id, txId), sql`(${walletTransactionsTable.reference} = 'pending' OR ${walletTransactionsTable.reference} LIKE 'pending:%')`))
        .returning({ id: walletTransactionsTable.id });
      if (!marked) throw new Error("ALREADY_PROCESSED");
      await trx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance + ${amt}`, updatedAt: new Date() })
        .where(eq(usersTable.id, tx.userId));
    });
    approved = true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "ALREADY_PROCESSED") {
      const [current] = await db.select({ reference: walletTransactionsTable.reference }).from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
      sendError(res, `Deposit already processed (${current?.reference ?? "unknown state"})`, 409); return;
    }
    throw err;
  }

  if (!approved) return;
  const depApprLang = await getUserLanguage(tx.userId);
  await db.insert(notificationsTable).values({
    id: generateId(), userId: tx.userId,
    title: t("notifDepositCredited", depApprLang),
    body: t("notifDepositCreditedBody", depApprLang).replace("{amount}", amt.toFixed(0)),
    type: "wallet", icon: "wallet-outline",
  }).catch(e => logger.error("deposit approval notif failed:", e));
  sendSuccess(res, { txId, status: "approved", credited: amt });
});

/* ── PATCH /admin/deposit-requests/:id/reject — Reject a rider deposit (atomic state transition) ─── */
router.patch("/deposit-requests/:id/reject", validateParams(idParamSchema), validateBody(rejectDepositSchema), async (req, res) => {
  const { reason } = req.body;
  const txId = req.params["id"]!;

  /* Verify type first (cheap read) */
  const [tx] = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
  if (!tx) { sendNotFound(res, "Deposit not found"); return; }
  if (tx.type !== "deposit") { sendValidationError(res, "Not a deposit record"); return; }

  const rejReason = reason?.trim() || "Admin rejected";
  const txidSuffix = (tx.reference && tx.reference.includes("txid:")) ? `:${tx.reference.split("txid:").pop()}` : "";

  const [marked] = await db.update(walletTransactionsTable)
    .set({ reference: `rejected:${rejReason}${txidSuffix}` })
    .where(and(eq(walletTransactionsTable.id, txId), sql`(${walletTransactionsTable.reference} = 'pending' OR ${walletTransactionsTable.reference} LIKE 'pending:%')`))
    .returning({ id: walletTransactionsTable.id });

  if (!marked) {
    const [current] = await db.select({ reference: walletTransactionsTable.reference }).from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
    sendError(res, `Deposit already processed (${current?.reference ?? "unknown state"})`, 409); return;
  }

  const amt = parseFloat(String(tx.amount));
  const depRejLang = await getUserLanguage(tx.userId);
  await db.insert(notificationsTable).values({
    id: generateId(), userId: tx.userId,
    title: t("notifDepositRejected", depRejLang),
    body: t("notifDepositRejectedBody", depRejLang).replace("{amount}", amt.toFixed(0)).replace("{reason}", rejReason),
    type: "wallet", icon: "close-circle-outline",
  }).catch(e => logger.error("deposit rejection notif failed:", e));
  sendSuccess(res, { txId, status: "rejected", reason: rejReason });
});

/* ── POST /admin/deposit-requests/bulk-approve — Bulk approve customer pending deposits (all-or-nothing atomic) ─── */
router.post("/deposit-requests/bulk-approve", validateBody(batchWithdrawalSchema), async (req, res) => {
  const { ids, refNo } = req.body as { ids: string[]; refNo?: string };
  if (!Array.isArray(ids) || ids.length === 0) { sendValidationError(res, "ids array is required"); return; }
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length > 50) { sendValidationError(res, "Maximum 50 deposits per bulk action"); return; }

  const preChecked: { tx: typeof walletTransactionsTable.$inferSelect; amt: number; approvedRef: string }[] = [];
  for (const txId of uniqueIds) {
    const [tx] = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
    if (!tx) { sendValidationError(res, `Deposit ${txId} not found`); return; }
    if (tx.type !== "deposit") { sendValidationError(res, `${txId} is not a deposit record`); return; }
    const ref = tx.reference ?? "pending";
    const isPending = ref === "pending" || ref.startsWith("pending:");
    if (!isPending) { sendError(res, `Deposit ${txId} already processed (${ref})`, 409); return; }
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, tx.userId)).limit(1);
    if (!user) { sendValidationError(res, `User not found for deposit ${txId}`); return; }
    if (user.role !== "customer") { sendValidationError(res, `Deposit ${txId} belongs to a ${user.role}, not a customer. Bulk actions are for customer deposits only.`); return; }
    const amt = parseFloat(String(tx.amount));
    if (!Number.isFinite(amt) || amt <= 0) { sendValidationError(res, `Invalid amount for deposit ${txId}`); return; }
    const txidSuffix = (tx.reference && tx.reference.includes("txid:")) ? `:${tx.reference.split("txid:").pop()}` : "";
    const approvedRef = refNo ? `approved:${refNo.trim()}${txidSuffix}` : `approved:manual${txidSuffix}`;
    preChecked.push({ tx, amt, approvedRef });
  }

  try {
    await db.transaction(async (trx) => {
      for (const { tx, amt, approvedRef } of preChecked) {
        const [marked] = await trx.update(walletTransactionsTable)
          .set({ reference: approvedRef })
          .where(and(eq(walletTransactionsTable.id, tx.id), sql`(${walletTransactionsTable.reference} = 'pending' OR ${walletTransactionsTable.reference} LIKE 'pending:%')`))
          .returning({ id: walletTransactionsTable.id });
        if (!marked) throw new Error(`Deposit ${tx.id} was already processed (race condition)`);
        const [credited] = await trx.update(usersTable)
          .set({ walletBalance: sql`wallet_balance + ${amt}`, updatedAt: new Date() })
          .where(eq(usersTable.id, tx.userId))
          .returning({ id: usersTable.id });
        if (!credited) throw new Error(`User ${tx.userId} not found for deposit ${tx.id}`);
      }
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(res, msg, 409);
    return;
  }

  for (const { tx, amt } of preChecked) {
    const bulkApprLang = await getUserLanguage(tx.userId);
    await db.insert(notificationsTable).values({
      id: generateId(), userId: tx.userId,
      title: t("notifDepositCredited", bulkApprLang),
      body: t("notifDepositCreditedBody", bulkApprLang).replace("{amount}", amt.toFixed(0)),
      type: "wallet", icon: "wallet-outline",
    }).catch(e => logger.error("bulk deposit approval notif failed:", e));
  }

  sendSuccess(res, { approved: preChecked.length });
});

/* ── POST /admin/deposit-requests/bulk-reject — Bulk reject customer pending deposits (all-or-nothing atomic) ─── */
router.post("/deposit-requests/bulk-reject", validateBody(batchWithdrawalSchema), async (req, res) => {
  const { ids, reason } = req.body as { ids: string[]; reason: string };
  if (!Array.isArray(ids) || ids.length === 0) { sendValidationError(res, "ids array is required"); return; }
  if (!reason?.trim()) { sendValidationError(res, "reason is required"); return; }
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length > 50) { sendValidationError(res, "Maximum 50 deposits per bulk action"); return; }

  const rejReason = reason.trim();

  const preChecked: { tx: typeof walletTransactionsTable.$inferSelect; rejRef: string }[] = [];
  for (const txId of uniqueIds) {
    const [tx] = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
    if (!tx) { sendValidationError(res, `Deposit ${txId} not found`); return; }
    if (tx.type !== "deposit") { sendValidationError(res, `${txId} is not a deposit record`); return; }
    const ref = tx.reference ?? "pending";
    const isPending = ref === "pending" || ref.startsWith("pending:");
    if (!isPending) { sendError(res, `Deposit ${txId} already processed (${ref})`, 409); return; }
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, tx.userId)).limit(1);
    if (!user) { sendValidationError(res, `User not found for deposit ${txId}`); return; }
    if (user.role !== "customer") { sendValidationError(res, `Deposit ${txId} belongs to a ${user.role}, not a customer. Bulk actions are for customer deposits only.`); return; }
    const txidSuffix = (tx.reference && tx.reference.includes("txid:")) ? `:${tx.reference.split("txid:").pop()}` : "";
    preChecked.push({ tx, rejRef: `rejected:${rejReason}${txidSuffix}` });
  }

  try {
    await db.transaction(async (trx) => {
      for (const { tx, rejRef } of preChecked) {
        const [marked] = await trx.update(walletTransactionsTable)
          .set({ reference: rejRef })
          .where(and(eq(walletTransactionsTable.id, tx.id), sql`(${walletTransactionsTable.reference} = 'pending' OR ${walletTransactionsTable.reference} LIKE 'pending:%')`))
          .returning({ id: walletTransactionsTable.id });
        if (!marked) throw new Error(`Deposit ${tx.id} was already processed (race condition)`);
      }
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(res, msg, 409);
    return;
  }

  for (const { tx } of preChecked) {
    const amt = parseFloat(String(tx.amount));
    const bulkRejLang = await getUserLanguage(tx.userId);
    await db.insert(notificationsTable).values({
      id: generateId(), userId: tx.userId,
      title: t("notifDepositRejected", bulkRejLang),
      body: t("notifDepositRejectedBody", bulkRejLang).replace("{amount}", amt.toFixed(0)).replace("{reason}", rejReason),
      type: "wallet", icon: "close-circle-outline",
    }).catch(e => logger.error("bulk deposit rejection notif failed:", e));
  }

  sendSuccess(res, { rejected: preChecked.length });
});

/* ── GET /admin/all-notifications ─────────── */
router.post("/riders/:id/credit", validateParams(idParamSchema), validateBody(riderCreditSchema), async (req, res) => {
  const { amount, description, type } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    sendValidationError(res, "Valid amount required"); return;
  }
  const [rider] = await db.select().from(usersTable).where(eq(usersTable.id, req.params["id"]!)).limit(1);
  if (!rider) { sendNotFound(res, "Rider not found"); return; }
  const roles = (rider.role || rider.roles || "").split(",").map((r: string) => r.trim());
  if (!roles.includes("rider")) { sendValidationError(res, "User is not a rider"); return; }
  const amt = Number(amount);
  const txType = type === "bonus" ? "bonus" : "credit";
  const [updated] = await db.update(usersTable)
    .set({ walletBalance: sql`wallet_balance + ${amt}`, updatedAt: new Date() })
    .where(eq(usersTable.id, rider.id)).returning();
  await db.insert(walletTransactionsTable).values({
    id: generateId(), userId: rider.id, type: txType, amount: String(amt),
    description: description || `Admin credit: Rs. ${amt}`,
    reference: txType === "bonus" ? "rider_bonus" : "admin_credit",
  });
  await sendUserNotification(
    rider.id,
    txType === "bonus" ? "Bonus Received! 🎉" : "Wallet Credited 💰",
    `Rs. ${amt} aapke wallet mein add ho gaya. ${description || ""}`,
    "wallet", "wallet-outline"
  );
  sendSuccess(res, { amount: amt, newBalance: parseFloat(updated?.walletBalance ?? "0") });
});
async function handleVendorCommissionOverride(req: import("express").Request, res: import("express").Response) {
  const { commissionPct } = req.body as { commissionPct: number };
  if (commissionPct === undefined || isNaN(Number(commissionPct))) {
    sendValidationError(res, "commissionPct required"); return;
  }
  const [vendor] = await db.update(usersTable)
    .set({ commissionOverride: String(commissionPct), updatedAt: new Date() } as Partial<typeof usersTable.$inferInsert>)
    .where(eq(usersTable.id, req.params["id"]!))
    .returning();
  if (!vendor) { sendNotFound(res, "Vendor not found"); return; }
  addAuditEntry({ action: "vendor_commission_override", ip: getClientIp(req), adminId: (req as AdminRequest).adminId, details: `Commission override ${commissionPct}% for vendor ${req.params["id"]}`, result: "success" });
  sendSuccess(res, { commissionPct });
}
router.patch("/vendors/:id/commission", validateParams(idParamSchema), validateBody(vendorCommissionSchema), handleVendorCommissionOverride);
router.patch("/vendors/:id/commission-override", validateParams(idParamSchema), validateBody(vendorCommissionSchema), handleVendorCommissionOverride);

/* ── POST /admin/riders/:id/override-suspension — override auto-suspension ── */
router.post("/riders/:id/override-suspension", validateParams(idParamSchema), validateBody(overrideSuspensionSchema), async (req, res) => {
  const userId = req.params["id"]!;
  const [user] = await db.select({ id: usersTable.id, autoSuspendedAt: usersTable.autoSuspendedAt })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { sendNotFound(res, "Rider not found"); return; }
  if (!user.autoSuspendedAt) { sendValidationError(res, "Rider was not auto-suspended"); return; }

  const [updated] = await db.update(usersTable).set({
    isActive: true,
    adminOverrideSuspension: true,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, userId)).returning();

  await db.insert(notificationsTable).values({
    id: generateId(),
    userId,
    title: "Suspension Overridden",
    body: "An admin has reviewed and overridden your account suspension. You are now active again.",
    type: "system",
    icon: "shield-checkmark-outline",
  }).catch(() => {});

  sendSuccess(res, { user: stripUser(updated) });
});

/* ── POST /admin/vendors/:id/override-suspension — override auto-suspension ─ */
router.post("/vendors/:id/override-suspension", validateParams(idParamSchema), validateBody(overrideSuspensionSchema), async (req, res) => {
  const userId = req.params["id"]!;
  const [user] = await db.select({ id: usersTable.id, autoSuspendedAt: usersTable.autoSuspendedAt })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { sendNotFound(res, "Vendor not found"); return; }
  if (!user.autoSuspendedAt) { sendValidationError(res, "Vendor was not auto-suspended"); return; }

  const [updated] = await db.update(usersTable).set({
    isActive: true,
    adminOverrideSuspension: true,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, userId)).returning();

  await db.insert(notificationsTable).values({
    id: generateId(),
    userId,
    title: "Suspension Overridden",
    body: "An admin has reviewed and overridden your store suspension. You are now active again.",
    type: "system",
    icon: "shield-checkmark-outline",
  }).catch(() => {});

  sendSuccess(res, { user: stripUser(updated) });
});

export default router;
