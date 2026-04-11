import { Router } from "express";
import { z } from "zod";
import { getIO } from "../../lib/socketio.js";
import { canonicalizePhone } from "@workspace/phone-utils";
import { db } from "@workspace/db";
import {
  usersTable,
  walletTransactionsTable,
  notificationsTable,
  ordersTable, ridesTable, pharmacyOrdersTable, parcelBookingsTable,
  accountConditionsTable,
  savedAddressesTable,
  riderProfilesTable,
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
  type AdminRequest, revokeAllUserSessions,
} from "../admin-shared.js";
import { writeAuthAuditLog } from "../../middleware/security.js";
import { hashPassword } from "../../services/password.js";
import { sendSuccess, sendError, sendNotFound, sendForbidden, sendValidationError } from "../../lib/response.js";
import { reconcileUserFlags } from "./conditions.js";
import { validateBody, validateQuery, validateParams } from "../../middleware/validate.js";

const idParamSchema = z.object({ id: z.string().min(1) }).strip();

const createUserSchema = z.object({
  phone: z.string().optional(),
  name: z.string().optional(),
  role: z.enum(["customer", "rider", "vendor"]).optional(),
  city: z.string().optional(),
  area: z.string().optional(),
  email: z.string().email().optional(),
  /* Rider-specific fields */
  cnic: z.string().optional(),
  vehicleType: z.string().optional(),
  /* Vendor-specific fields */
  businessName: z.string().optional(),
  storeName: z.string().optional(),
  storeCategory: z.string().optional(),
  /* Admin override: immediately approve this user (skip pending queue) */
  approveNow: z.boolean().optional(),
}).strip();

const patchUserSchema = z.object({
  role: z.enum(["customer", "rider", "vendor"]).optional(),
  isActive: z.boolean().optional(),
  walletBalance: z.number().optional(),
}).strip();

const approveUserSchema = z.object({
  note: z.string().optional(),
  skipDocCheck: z.boolean().optional(),
}).strip();

const rejectUserSchema = z.object({
  note: z.string().optional(),
}).strip();

const walletTopupSchema = z.object({
  amount: z.number().positive("amount must be a positive number"),
  description: z.string().optional(),
}).strip();

const userSecuritySchema = z.object({
  isActive: z.boolean().optional(),
  isBanned: z.boolean().optional(),
  banReason: z.string().optional(),
  roles: z.string().refine(
    v => v === undefined || v.split(",").map(r => r.trim()).filter(Boolean).every(r => ["customer", "rider", "vendor"].includes(r)),
    { message: "roles must be a comma-separated list of: customer, rider, vendor" }
  ).optional(),
  role: z.enum(["customer", "rider", "vendor"]).optional(),
  blockedServices: z.string().optional(),
  securityNote: z.string().optional(),
  devOtpEnabled: z.boolean().optional(),
  notify: z.boolean().optional(),
}).strip();

const userIdentitySchema = z.object({
  username: z.string().optional(),
  email: z.string().optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
}).strip();

const usersQuerySchema = z.object({
  filter: z.enum(["2fa_enabled", ""]).optional(),
  profileStatus: z.enum(["complete", "incomplete", ""]).optional(),
  conditionTier: z.enum(["has_conditions", "clean", "warnings", "restrictions", "suspensions", "bans", ""]).optional(),
  role: z.enum(["customer", "rider", "vendor", ""]).optional(),
  approvalStatus: z.enum(["pending", "approved", "rejected", "correction_needed", ""]).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
}).strip();

const searchRidersQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
  onlineOnly: z.string().optional(),
}).strip();

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
}).strip();

const requestCorrectionSchema = z.object({
  field: z.string().optional(),
  note: z.string().optional(),
}).strip();

const bulkBanSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "at least one id is required"),
  action: z.enum(["ban", "unban"]),
  reason: z.string().optional(),
}).strip();

const router = Router();

router.post("/users", validateBody(createUserSchema), async (req, res) => {
  const { phone, name, role, city, area, email, cnic, vehicleType, businessName, storeName, storeCategory, approveNow } = req.body;
  const rawPhone = typeof phone === "string" ? phone.trim() : "";
  const trimName = typeof name === "string" ? name.trim() : "";
  if (!rawPhone && !trimName) {
    sendValidationError(res, "At least phone or name is required");
    return;
  }
  let trimPhone = "";
  if (rawPhone) {
    const canonical = canonicalizePhone(rawPhone);
    if (!canonical) {
      sendValidationError(res, "Invalid phone number format. Please enter a valid Pakistani mobile number (e.g. 03001234567 or +923001234567).");
      return;
    }
    trimPhone = canonical;
  }
  const validRoles = ["customer", "rider", "vendor"];
  const userRole = validRoles.includes(role) ? role : "customer";

  /* Role-based profile completion and activation:
     - Customer:  complete when name provided; auto-approved + active
     - Rider:     complete when name + cnic provided; pending approval (or approveNow override)
     - Vendor:    complete when name + (businessName or storeName) provided; pending approval (or approveNow override)
     approveNow flag lets admin immediately activate a rider/vendor on creation. */
  let isProfileComplete = false;
  if (userRole === "customer") {
    isProfileComplete = !!(trimName);
  } else if (userRole === "rider") {
    isProfileComplete = !!(trimName) && !!(typeof cnic === "string" && cnic.trim());
  } else if (userRole === "vendor") {
    const hasStore = !!(typeof businessName === "string" && businessName.trim()) || !!(typeof storeName === "string" && storeName.trim());
    isProfileComplete = !!(trimName) && hasStore;
  }

  const adminApproveNow = approveNow === true && isProfileComplete;
  const approvalStatus = (userRole === "customer" || adminApproveNow) ? "approved" : "pending";
  const isActive = isProfileComplete && (userRole === "customer" || adminApproveNow);

  try {
    const platformSettings = await getPlatformSettings();
    const [user] = await db.insert(usersTable).values({
      id: generateId(),
      phone: trimPhone || null,
      name: trimName || null,
      email: typeof email === "string" && email.trim() ? email.trim() : null,
      role: userRole,
      roles: userRole,
      city: typeof city === "string" && city.trim() ? city.trim() : null,
      area: typeof area === "string" && area.trim() ? area.trim() : null,
      cnic: typeof cnic === "string" && cnic.trim() ? cnic.trim() : null,
      nationalId: typeof cnic === "string" && cnic.trim() ? cnic.trim() : null,
      businessName: typeof businessName === "string" && businessName.trim() ? businessName.trim() : (typeof storeName === "string" && storeName.trim() ? storeName.trim() : null),
      phoneVerified: true,
      approvalStatus,
      isActive,
      isProfileComplete,
      walletBalance: isActive && userRole === "customer" ? String(parseFloat(platformSettings["customer_signup_bonus"] ?? "0") || 0) : "0",
    }).returning();

    /* Create role-specific profile records if fields were provided */
    if (userRole === "rider" && vehicleType) {
      await db.insert(riderProfilesTable).values({
        userId: user!.id,
        vehicleType: vehicleType.toLowerCase().replace(/\s+/g, "_"),
      }).onConflictDoNothing();
    }
    if (userRole === "vendor" && (storeName || businessName)) {
      await db.insert(vendorProfilesTable).values({
        userId: user!.id,
        storeName: storeName || businessName || null,
        storeCategory: storeCategory || null,
      }).onConflictDoNothing();
    }

    sendSuccess(res, { user: stripUser(user!) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg?.includes("duplicate")) {
      sendError(res, "A user with this phone or email already exists", 409);
    } else {
      sendError(res, msg, 500);
    }
  }
});

/* GET /admin/users/search-riders?q=...&limit=20&onlineOnly=true
   Lightweight server-side rider search used by RideDetailModal for reassignment.
   Returns only active, non-rejected riders matching the search query.
   Pass onlineOnly=true to restrict to riders currently online (matches reassign constraints). */
router.get("/users/search-riders", validateQuery(searchRidersQuerySchema), async (req, res) => {
  const q = ((req.query?.q as string) ?? "").trim();
  const limitN = Math.min(50, Math.max(1, parseInt((req.query?.limit as string) ?? "20", 10)));
  const onlineOnly = (req.query?.onlineOnly as string) === "true";

  const conditions = [
    eq(usersTable.role, "rider"),
    eq(usersTable.isActive, true),
    ne(usersTable.approvalStatus, "rejected"),
  ];
  if (onlineOnly) {
    conditions.push(eq(usersTable.isOnline, true) as ReturnType<typeof eq>);
  }
  if (q) {
    const canonicalQ = canonicalizePhone(q);
    const phoneMatch = canonicalQ
      ? eq(usersTable.phone, canonicalQ)
      : ilike(usersTable.phone, `%${q}%`);
    conditions.push(or(
      ilike(usersTable.name, `%${q}%`),
      phoneMatch,
    )! as ReturnType<typeof eq>);
  }
  const riders = await db
    .select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, isOnline: usersTable.isOnline, approvalStatus: usersTable.approvalStatus })
    .from(usersTable)
    .where(and(...conditions))
    .orderBy(asc(usersTable.name))
    .limit(limitN);
  sendSuccess(res, { riders, total: riders.length });
});

router.get("/users", validateQuery(usersQuerySchema), async (req, res) => {
  const filter = (req.query?.filter as string) ?? "";
  const profileStatus = (req.query?.profileStatus as string) ?? "";
  const conditionTier = (req.query?.conditionTier as string) ?? "";
  const roleFilter = (req.query?.role as string) ?? "";
  const approvalStatusFilter = (req.query?.approvalStatus as string) ?? "";
  const search = (req.query?.search as string) ?? "";
  const page = Math.max(1, parseInt(req.query?.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit as string) || 50));
  const offset = (page - 1) * limit;

  const whereConditions: ReturnType<typeof and>[] = [];
  if (filter === "2fa_enabled") {
    whereConditions.push(eq(usersTable.totpEnabled, true));
  }
  if (roleFilter && ["customer", "rider", "vendor"].includes(roleFilter)) {
    whereConditions.push(eq(usersTable.role, roleFilter as "customer" | "rider" | "vendor"));
  }
  if (approvalStatusFilter && ["pending", "approved", "rejected", "correction_needed"].includes(approvalStatusFilter)) {
    whereConditions.push(eq(usersTable.approvalStatus, approvalStatusFilter));
  }
  if (profileStatus === "complete") {
    whereConditions.push(eq(usersTable.isProfileComplete, true));
  } else if (profileStatus === "incomplete") {
    whereConditions.push(eq(usersTable.isProfileComplete, false));
  }
  if (search) {
    const canonicalSearch = canonicalizePhone(search);
    const phoneSearchMatch = canonicalSearch
      ? eq(usersTable.phone, canonicalSearch)
      : ilike(usersTable.phone, `%${search}%`);
    whereConditions.push(or(
      ilike(usersTable.name, `%${search}%`),
      phoneSearchMatch,
      ilike(usersTable.email, `%${search}%`),
    )!);
  }

  if (conditionTier === "has_conditions") {
    whereConditions.push(
      sql`EXISTS (
        SELECT 1 FROM ${accountConditionsTable}
        WHERE ${accountConditionsTable.userId} = ${usersTable.id}
          AND ${accountConditionsTable.isActive} = true
      )`
    );
  } else if (conditionTier === "clean") {
    whereConditions.push(
      sql`NOT EXISTS (
        SELECT 1 FROM ${accountConditionsTable}
        WHERE ${accountConditionsTable.userId} = ${usersTable.id}
          AND ${accountConditionsTable.isActive} = true
      )`
    );
  } else if (conditionTier === "warnings") {
    whereConditions.push(
      sql`(
        SELECT MAX(CASE severity::text
          WHEN 'ban'                THEN 5
          WHEN 'suspension'         THEN 4
          WHEN 'restriction_strict' THEN 3
          WHEN 'restriction_normal' THEN 2
          WHEN 'warning'            THEN 1
          ELSE 0 END)
        FROM ${accountConditionsTable}
        WHERE ${accountConditionsTable.userId} = ${usersTable.id}
          AND ${accountConditionsTable.isActive} = true
      ) = 1`
    );
  } else if (conditionTier === "restrictions") {
    whereConditions.push(
      sql`(
        SELECT MAX(CASE severity::text
          WHEN 'ban'                THEN 5
          WHEN 'suspension'         THEN 4
          WHEN 'restriction_strict' THEN 3
          WHEN 'restriction_normal' THEN 2
          WHEN 'warning'            THEN 1
          ELSE 0 END)
        FROM ${accountConditionsTable}
        WHERE ${accountConditionsTable.userId} = ${usersTable.id}
          AND ${accountConditionsTable.isActive} = true
      ) IN (2, 3)`
    );
  } else if (conditionTier === "suspensions") {
    whereConditions.push(
      sql`(
        SELECT MAX(CASE severity::text
          WHEN 'ban'                THEN 5
          WHEN 'suspension'         THEN 4
          WHEN 'restriction_strict' THEN 3
          WHEN 'restriction_normal' THEN 2
          WHEN 'warning'            THEN 1
          ELSE 0 END)
        FROM ${accountConditionsTable}
        WHERE ${accountConditionsTable.userId} = ${usersTable.id}
          AND ${accountConditionsTable.isActive} = true
      ) = 4`
    );
  } else if (conditionTier === "bans") {
    whereConditions.push(
      sql`(
        SELECT MAX(CASE severity::text
          WHEN 'ban'                THEN 5
          WHEN 'suspension'         THEN 4
          WHEN 'restriction_strict' THEN 3
          WHEN 'restriction_normal' THEN 2
          WHEN 'warning'            THEN 1
          ELSE 0 END)
        FROM ${accountConditionsTable}
        WHERE ${accountConditionsTable.userId} = ${usersTable.id}
          AND ${accountConditionsTable.isActive} = true
      ) = 5`
    );
  }

  const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

  const [totalResult, users] = await Promise.all([
    db.select({ total: count() }).from(usersTable).where(whereClause),
    db.select().from(usersTable).where(whereClause).orderBy(desc(usersTable.createdAt)).limit(limit).offset(offset),
  ]);

  const total = Number(totalResult[0]?.total ?? 0);
  const totalPages = Math.ceil(total / limit);

  const pageUserIds = users.map(u => u.id);
  const condCounts = pageUserIds.length > 0
    ? await db.select({
        userId: accountConditionsTable.userId,
        activeCount: count(),
        maxSeverityLabel: sql<string>`(ARRAY['warning','warning','restriction_normal','restriction_strict','suspension','ban'])[1 + MAX(CASE ${accountConditionsTable.severity}::text WHEN 'ban' THEN 5 WHEN 'suspension' THEN 4 WHEN 'restriction_strict' THEN 3 WHEN 'restriction_normal' THEN 2 WHEN 'warning' THEN 1 ELSE 0 END)]`,
      }).from(accountConditionsTable)
        .where(and(eq(accountConditionsTable.isActive, true), inArray(accountConditionsTable.userId, pageUserIds)))
        .groupBy(accountConditionsTable.userId)
    : [];

  const condMap = new Map(condCounts.map(c => [c.userId, { count: Number(c.activeCount), maxSeverity: c.maxSeverityLabel }]));

  const enrichedUsers = users.map((u) => {
    let trustedDeviceCount = 0;
    try { trustedDeviceCount = u.trustedDevices ? JSON.parse(u.trustedDevices).length : 0; } catch {}
    let backupCodesRemaining = 0;
    try { backupCodesRemaining = u.backupCodes ? JSON.parse(u.backupCodes).filter((c: any) => !c.used).length : 0; } catch {}
    return {
      ...stripUser(u),
      walletBalance: parseFloat(u.walletBalance ?? "0"),
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
      conditionCount: condMap.get(u.id)?.count || 0,
      maxConditionSeverity: condMap.get(u.id)?.maxSeverity || null,
      trustedDeviceCount,
      backupCodesRemaining,
    };
  });

  sendSuccess(res, {
    users: enrichedUsers,
    total,
    page,
    limit,
    totalPages,
  });
});

router.patch("/users/:id", validateParams(idParamSchema), validateBody(patchUserSchema), async (req, res) => {
  const { role, isActive, walletBalance } = req.body;
  const updates: Partial<typeof usersTable.$inferInsert> & { tokenVersion?: ReturnType<typeof sql> } = {};
  if (role !== undefined) { updates.role = role; updates.roles = role; }
  if (isActive !== undefined) updates.isActive = isActive;
  if (walletBalance !== undefined) updates.walletBalance = String(walletBalance);

  if (role === "vendor" || role === "rider") {
    updates.isActive = true;
    updates.approvalStatus = "approved";
  }

  const [user] = await db
    .update(usersTable)
    .set({ ...(updates as typeof usersTable.$inferInsert), updatedAt: new Date() })
    .where(eq(usersTable.id, req.params["id"]!))
    .returning();

  if (!user) { sendNotFound(res, "User not found"); return; }
  /* Revoke sessions on role or status change so user re-authenticates with new role */
  if (role !== undefined || isActive === false) {
    revokeAllUserSessions(req.params["id"]!).catch(() => {});
  }
  sendSuccess(res, { ...stripUser(user), walletBalance: parseFloat(user.walletBalance ?? "0") });
});

/* ── Pending Approval Users ── */
router.get("/users/pending", validateQuery(paginationQuerySchema), async (req, res) => {
  const page = Math.max(1, parseInt(req.query?.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit as string) || 50));
  const offset = (page - 1) * limit;

  const [totalResult, users] = await Promise.all([
    db.select({ total: count() }).from(usersTable).where(eq(usersTable.approvalStatus, "pending")),
    db.select().from(usersTable)
      .where(eq(usersTable.approvalStatus, "pending"))
      .orderBy(desc(usersTable.createdAt))
      .limit(limit)
      .offset(offset),
  ]);

  const total = Number(totalResult[0]?.total ?? 0);
  const totalPages = Math.ceil(total / limit);

  sendSuccess(res, {
    users: users.map(({ otpCode: _otp, otpExpiry: _exp, passwordHash: _ph, emailOtpCode: _eotp, emailOtpExpiry: _eexp, ...u }) => ({
      ...u,
      walletBalance: parseFloat(u.walletBalance ?? "0"),
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    })),
    total,
    page,
    limit,
    totalPages,
  });
});

/* ── Approve User ── */
router.post("/users/:id/approve", validateParams(idParamSchema), validateBody(approveUserSchema), async (req, res) => {
  const { note, skipDocCheck } = req.body;
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, req.params["id"]!)).limit(1);
  if (!target) { sendNotFound(res, "User not found"); return; }

  if (target.role === "rider" && !skipDocCheck) {
    const hasCnic = !!target.cnic;
    const hasLicense = !!target.drivingLicense;
    const missing: string[] = [];
    if (!hasCnic) missing.push("CNIC");
    if (!hasLicense) missing.push("Driving License");
    if (missing.length > 0) {
      sendValidationError(res, `Missing required documents: ${missing.join(", ")}. Pass skipDocCheck=true to override.`);
      return;
    }
  }

  /* Also mark profile complete if the user has the required fields — this allows
     riders/vendors to log in immediately after approval without a separate
     complete-profile step (they submitted all data during registration). */
  const hasName = !!target.name;
  const hasCnicForApprove = !!target.cnic;
  const hasBizForApprove = !!target.businessName;
  let setProfileComplete = !target.isProfileComplete; // only update if not already set
  if (target.role === "rider")  setProfileComplete = setProfileComplete && hasName && hasCnicForApprove;
  else if (target.role === "vendor") setProfileComplete = setProfileComplete && hasName && hasBizForApprove;
  else setProfileComplete = setProfileComplete && hasName;

  const [user] = await db.update(usersTable)
    .set({ approvalStatus: "approved", approvalNote: note || null, isActive: true,
           ...(setProfileComplete ? { isProfileComplete: true } : {}),
           updatedAt: new Date() })
    .where(eq(usersTable.id, req.params["id"]!))
    .returning();
  if (!user) { sendNotFound(res, "User not found"); return; }
  addAuditEntry({ action: "user_approved", ip: "admin", details: `User approved: ${user.phone} — ${user.name || "unnamed"}`, result: "success" });
  sendSuccess(res, { success: true, user: { ...stripUser(user), walletBalance: parseFloat(user.walletBalance ?? "0") } });
});

/* ── Reject User ── */
router.post("/users/:id/reject", validateParams(idParamSchema), validateBody(rejectUserSchema), async (req, res) => {
  const { note } = req.body;
  const [user] = await db.update(usersTable)
    .set({ approvalStatus: "rejected", approvalNote: note || "Rejected by admin", isActive: false, updatedAt: new Date() })
    .where(eq(usersTable.id, req.params["id"]!))
    .returning();
  if (!user) { sendNotFound(res, "User not found"); return; }
  addAuditEntry({ action: "user_rejected", ip: "admin", details: `User rejected: ${user.phone} — ${note || "no reason"}`, result: "success" });
  sendSuccess(res, { success: true, user: { ...stripUser(user), walletBalance: parseFloat(user.walletBalance ?? "0") } });
});

/* ── Wallet Top-up ── */
router.post("/users/:id/wallet-topup", validateParams(idParamSchema), validateBody(walletTopupSchema), async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    sendValidationError(res, "Valid amount is required");
    return;
  }

  const userId = req.params["id"] as string;
  const amt = Number(amount);

  let updatedUser: typeof usersTable.$inferSelect | undefined;
  let newBalance = 0;

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);
      if (!existing) throw new Error("NOT_FOUND");

      const [updated] = await tx
        .update(usersTable)
        .set({ walletBalance: sql`wallet_balance + ${amt}`, updatedAt: new Date() })
        .where(eq(usersTable.id, userId))
        .returning();
      if (!updated) throw new Error("NOT_FOUND");

      await tx.insert(walletTransactionsTable).values({
        id: generateId(),
        userId,
        type: "credit",
        amount: String(amt),
        description: description || `Admin top-up: Rs. ${amt}`,
        reference: "admin_topup",
      });

      updatedUser = updated;
      newBalance = parseFloat(updated.walletBalance ?? "0");
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      sendNotFound(res, "User not found"); return;
    }
    throw err;
  }

  await sendUserNotification(
    userId,
    "Wallet Topped Up! 💰",
    `Rs. ${amt} has been added to your AJKMart wallet.`,
    "system",
    "wallet-outline"
  );

  sendSuccess(res, {
    success: true,
    newBalance,
    user: { ...stripUser(updatedUser!), walletBalance: newBalance },
  });
});
router.delete("/users/:id", validateParams(idParamSchema), async (req, res) => {
  await db.delete(usersTable).where(eq(usersTable.id, req.params["id"]!));
  sendSuccess(res, { success: true });
});

/* ── User Activity (orders + rides summary) ── */
router.get("/users/:id/activity", validateParams(idParamSchema), async (req, res) => {
  const uid = req.params["id"]!;
  const orders = await db.select().from(ordersTable).where(eq(ordersTable.userId, uid)).orderBy(desc(ordersTable.createdAt)).limit(10);
  const rides = await db.select().from(ridesTable).where(eq(ridesTable.userId, uid)).orderBy(desc(ridesTable.createdAt)).limit(10);
  const pharmacy = await db.select().from(pharmacyOrdersTable).where(eq(pharmacyOrdersTable.userId, uid)).orderBy(desc(pharmacyOrdersTable.createdAt)).limit(5);
  const parcels = await db.select().from(parcelBookingsTable).where(eq(parcelBookingsTable.userId, uid)).orderBy(desc(parcelBookingsTable.createdAt)).limit(5);
  const txns = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.userId, uid)).orderBy(desc(walletTransactionsTable.createdAt)).limit(10);
  sendSuccess(res, {
    orders: orders.map(o => ({ ...o, total: parseFloat(String(o.total)), createdAt: o.createdAt.toISOString(), updatedAt: o.updatedAt.toISOString() })),
    rides: rides.map(r => ({ ...r, fare: parseFloat(r.fare), distance: parseFloat(r.distance), createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })),
    pharmacy: pharmacy.map(p => ({ ...p, total: parseFloat(String(p.total)), createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() })),
    parcels: parcels.map(p => ({ ...p, fare: parseFloat(p.fare), createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() })),
    transactions: txns.map(t => ({ ...t, amount: parseFloat(t.amount), createdAt: t.createdAt.toISOString() })),
  });
});

/* ── Overview with user enrichment (orders + user info) ── */
router.patch("/users/:id/security", validateParams(idParamSchema), validateBody(userSecuritySchema), async (req, res) => {
  const { id } = req.params;
  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.isActive     !== undefined) updates.isActive     = body.isActive;
  if (body.isBanned     !== undefined) updates.isBanned     = body.isBanned;
  if (body.banReason    !== undefined) updates.banReason    = (body.banReason as string) || null;

  const willBeBanned = body.isBanned === true;
  const currentUser = await db.select({ isBanned: usersTable.isBanned }).from(usersTable).where(eq(usersTable.id, id!)).limit(1).then(r => r[0]);
  const alreadyBanned = currentUser?.isBanned ?? false;
  const canAutoApprove = !willBeBanned && !alreadyBanned;

  if (body.roles !== undefined) {
    const rolesValue = String(body.roles).trim();
    const roleList = rolesValue.split(",").map((r: string) => r.trim()).filter(Boolean);
    if (!roleList.length) { sendValidationError(res, "At least one role must be assigned"); return; }
    updates.roles = roleList.join(",");
    updates.role = roleList.includes("vendor") ? "vendor" : roleList.includes("rider") ? "rider" : roleList[0];

    if (canAutoApprove && (roleList.includes("rider") || roleList.includes("vendor"))) {
      updates.isActive = true;
      updates.approvalStatus = "approved";
    }
  }
  if (body.role !== undefined) {
    const roleValue = String(body.role).trim();
    if (roleValue) {
      updates.role = roleValue;
      if (canAutoApprove && (roleValue === "vendor" || roleValue === "rider")) {
        updates.isActive = true;
        updates.approvalStatus = "approved";
      }
    }
  }

  const prevBlockedServices = body.blockedServices !== undefined
    ? (await db.select({ blockedServices: usersTable.blockedServices }).from(usersTable).where(eq(usersTable.id, id!)).limit(1).then(r => r[0]?.blockedServices ?? ""))
    : null;
  if (body.blockedServices !== undefined) updates.blockedServices = body.blockedServices;
  if (body.securityNote !== undefined) updates.securityNote = body.securityNote || null;
  if (body.devOtpEnabled !== undefined) updates.devOtpEnabled = body.devOtpEnabled === true;

  const adminReq = req as AdminRequest;
  if (willBeBanned && !alreadyBanned) {
    const [existingUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, id!)).limit(1);
    await db.insert(accountConditionsTable).values({
      id: generateId(),
      userId: id!,
      userRole: existingUser?.role || "customer",
      conditionType: "ban_hard",
      severity: "ban",
      category: "ban",
      reason: String(body.banReason || "Banned by admin via security panel"),
      appliedBy: adminReq.adminId || "admin",
      notes: body.securityNote ? String(body.securityNote) : null,
    });
    await reconcileUserFlags(id!);
  } else if (!willBeBanned && alreadyBanned && body.isBanned === false) {
    await db.update(accountConditionsTable).set({
      isActive: false,
      liftedAt: new Date(),
      liftedBy: adminReq.adminId || "admin",
      liftReason: "Unbanned via security panel",
      updatedAt: new Date(),
    }).where(and(
      eq(accountConditionsTable.userId, id!),
      eq(accountConditionsTable.isActive, true),
      eq(accountConditionsTable.severity, "ban"),
    ));
    await reconcileUserFlags(id!);
  }

  if (willBeBanned !== alreadyBanned) {
    delete updates.isBanned;
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (updates as Partial<typeof usersTable.$inferInsert>).isActive;
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (updates as Partial<typeof usersTable.$inferInsert>).banReason;
  }
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id!)).returning();
  if (!user) { sendNotFound(res, "User not found"); return; }

  if (body.blockedServices !== undefined && prevBlockedServices !== null) {
    const wasFrozen = (prevBlockedServices || "").split(",").map((s: string) => s.trim()).includes("wallet");
    const isFrozen = (String(body.blockedServices || "")).split(",").map((s: string) => s.trim()).includes("wallet");
    if (isFrozen !== wasFrozen) {
      const io = getIO();
      if (io) io.to(`user:${id}`).emit(isFrozen ? "wallet:frozen" : "wallet:unfrozen", {});
    }
  }

  /* Revoke all sessions if ban, deactivation, or role change occurred */
  if (body.isBanned || body.isActive === false || body.roles !== undefined || body.role !== undefined) {
    revokeAllUserSessions(id!).catch(() => {});
  }
  if (body.isBanned && body.notify) {
    await sendUserNotification(id!, "Account Suspended ⚠️", String(body.banReason || "Your account has been suspended. Contact support."), "warning", "warning-outline");
  }
  sendSuccess(res, { ...user, walletBalance: parseFloat(String(user.walletBalance)) });
});

/* ── PATCH /admin/users/:id/identity — Admin update user identity (username, email, name) ── */
router.patch("/users/:id/identity", validateParams(idParamSchema), validateBody(userIdentitySchema), async (req, res) => {
  const userId = req.params["id"]!;
  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!target) { sendNotFound(res, "User not found"); return; }

  if (body.username !== undefined) {
    const raw = String(body.username).toLowerCase().replace(/[^a-z0-9_]/g, "").trim();
    if (raw && raw.length < 3) { sendValidationError(res, "Username must be at least 3 characters"); return; }
    if (raw) {
      const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(sql`lower(${usersTable.username}) = ${raw}`).limit(1);
      if (existing && existing.id !== userId) {
        sendError(res, "Username already taken by another account", 409); return;
      }
      updates.username = raw;
    } else {
      updates.username = null;
    }
  }

  if (body.email !== undefined) {
    const raw = String(body.email).toLowerCase().trim();
    if (raw && !raw.includes("@")) { sendValidationError(res, "Invalid email format"); return; }
    if (raw) {
      const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(sql`lower(${usersTable.email}) = ${raw}`).limit(1);
      if (existing && existing.id !== userId) {
        sendError(res, "Email already linked to another account", 409); return;
      }
      updates.email = raw;
      updates.emailVerified = false;
    } else {
      updates.email = null;
      updates.emailVerified = false;
    }
  }

  if (body.name !== undefined) {
    const raw = String(body.name).trim();
    if (raw) updates.name = raw;
  }

  if (body.phone !== undefined) {
    const raw = String(body.phone);
    if (raw.trim()) {
      const normalized = canonicalizePhone(raw);
      if (!normalized || !/^92\d{10}$/.test(normalized)) { sendValidationError(res, "Invalid phone format"); return; }
      const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, normalized)).limit(1);
      if (existing && existing.id !== userId) {
        sendError(res, "Phone already linked to another account", 409); return;
      }
      updates.phone = normalized;
    }
  }

  if (Object.keys(updates).length <= 1) {
    sendValidationError(res, "No valid fields to update"); return;
  }

  const ip = getClientIp(req);
  const changedFields = Object.keys(updates).filter(k => k !== "updatedAt");
  addAuditEntry({ action: "admin_identity_update", ip, details: `Admin updated identity for ${userId}: ${changedFields.join(", ")}`, result: "success" });

  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();
  if (!user) { sendNotFound(res, "User not found"); return; }

  revokeAllUserSessions(userId).catch(() => {});

  sendSuccess(res, { ...stripUser(user), walletBalance: parseFloat(String(user.walletBalance)) });
});

router.post("/users/:id/reset-otp", validateParams(idParamSchema), async (req, res) => {
  await db.update(usersTable).set({ otpCode: null, otpExpiry: null, updatedAt: new Date() }).where(eq(usersTable.id, req.params["id"]!));
  sendSuccess(res, { success: true, message: "OTP cleared — user must re-authenticate" });
});

/* ── Force-disable 2FA for a user (admin action) ── */
router.post("/users/:id/2fa/disable", validateParams(idParamSchema), async (req, res) => {
  const userId = req.params["id"]!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { sendNotFound(res, "User not found"); return; }

  if (!user.totpEnabled) { sendValidationError(res, "2FA is not enabled for this user"); return; }

  await db.update(usersTable).set({
    totpEnabled: false, totpSecret: null, backupCodes: null, trustedDevices: null, updatedAt: new Date(),
  }).where(eq(usersTable.id, userId));

  const ip = getClientIp(req);
  addAuditEntry({ action: "admin_2fa_disable", ip, details: `Admin force-disabled 2FA for user ${userId} (${user.phone})`, result: "success" });
  writeAuthAuditLog("admin_2fa_disabled", { userId, ip, userAgent: req.headers["user-agent"] as string, metadata: { adminAction: true } });

  sendSuccess(res, { success: true, message: `2FA disabled for user ${user.name ?? user.phone}` });
});

router.post("/users/:id/reset-wallet-pin", validateParams(idParamSchema), async (req, res) => {
  const userId = req.params["id"]!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { sendNotFound(res, "User not found"); return; }
  if (!user.walletPinHash) { sendValidationError(res, "This user has no MPIN set"); return; }

  await db.update(usersTable).set({
    walletPinHash: null,
    walletPinAttempts: 0,
    walletPinLockedUntil: null,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, userId));

  sendSuccess(res, { success: true, message: `Wallet MPIN reset for ${user.name ?? user.phone}. User will need to create a new MPIN.` });
});

/* ── Admin Accounts (Sub-Admins) ── */
router.patch("/users/:id/request-correction", validateParams(idParamSchema), validateBody(requestCorrectionSchema), async (req, res) => {
  const { field, note } = req.body as { field?: string; note?: string };
  const [user] = await db.update(usersTable)
    .set({ approvalStatus: "correction_needed", approvalNote: note || `Please re-upload: ${field || "document"}`, updatedAt: new Date() })
    .where(eq(usersTable.id, req.params["id"]!))
    .returning();
  if (!user) { sendNotFound(res, "User not found"); return; }
  addAuditEntry({ action: "user_correction_requested", ip: getClientIp(req), adminId: (req as AdminRequest).adminId, details: `Correction requested for ${user.phone}: ${field}`, result: "success" });
  const docLang = await getUserLanguage(user.id);
  await db.insert(notificationsTable).values({
    id: generateId(), userId: user.id,
    title: t("notifDocumentCorrection", docLang),
    body: note || t("notifDocumentCorrectionBody", docLang).replace("{field}", field || "document"),
    type: "system", icon: "document-outline",
  }).catch(() => {});
  sendSuccess(res, { success: true, user: stripUser(user) });
});

/* ── PATCH /admin/users/:id/waive-debt — waive rider's cancellation debt ── */
router.patch("/users/:id/waive-debt", validateParams(idParamSchema), async (req, res) => {
  const userId = req.params["id"]!;
  const [user] = await db.select({ id: usersTable.id, phone: usersTable.phone, cancellationDebt: usersTable.cancellationDebt })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { sendNotFound(res, "User not found"); return; }
  const debt = parseFloat(user.cancellationDebt ?? "0");
  if (debt <= 0) { sendSuccess(res, { success: true, message: "No debt to waive" }); return; }
  await db.update(usersTable).set({ cancellationDebt: "0", updatedAt: new Date() }).where(eq(usersTable.id, userId));
  addAuditEntry({ action: "debt_waived", ip: getClientIp(req), adminId: (req as AdminRequest).adminId, details: `Cancelled debt of Rs.${debt.toFixed(0)} for ${user.phone}`, result: "success" });
  const debtLang = await getUserLanguage(userId);
  await db.insert(notificationsTable).values({
    id: generateId(), userId,
    title: t("notifDebtWaived", debtLang),
    body: t("notifDebtWaivedBody", debtLang).replace("{amount}", debt.toFixed(0)),
    type: "system", icon: "checkmark-circle-outline",
  }).catch(() => {});
  sendSuccess(res, { success: true, waived: debt });
});

/* ── PATCH /admin/users/:id/bulk-ban — ban/unban multiple users ── */
router.patch("/users/bulk-ban", validateBody(bulkBanSchema), async (req, res) => {
  const { ids, action, reason } = req.body as { ids: string[]; action: "ban" | "unban"; reason?: string };
  if (!ids?.length) { sendValidationError(res, "ids required"); return; }
  const adminReq = req as AdminRequest;
  for (const id of ids) {
    if (action === "ban") {
      const [u] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, id)).limit(1);
      await db.insert(accountConditionsTable).values({
        id: generateId(),
        userId: id,
        userRole: u?.role || "customer",
        conditionType: "ban_hard",
        severity: "ban",
        category: "ban",
        reason: reason || "Bulk banned by admin",
        appliedBy: adminReq.adminId || "admin",
      });
    } else {
      await db.update(accountConditionsTable).set({
        isActive: false, liftedAt: new Date(), liftedBy: adminReq.adminId || "admin",
        liftReason: "Bulk unbanned via admin", updatedAt: new Date(),
      }).where(and(
        eq(accountConditionsTable.userId, id),
        eq(accountConditionsTable.isActive, true),
        eq(accountConditionsTable.severity, "ban"),
      ));
    }
    await reconcileUserFlags(id);
  }
  addAuditEntry({ action: `bulk_${action}`, ip: getClientIp(req), adminId: adminReq.adminId, details: `Bulk ${action}: ${ids.length} users`, result: "success" });
  sendSuccess(res, { success: true, affected: ids.length, action });
});

/* ── GET /admin/users/:id/addresses — all saved addresses for a user ── */
router.get("/users/:id/addresses", validateParams(idParamSchema), async (req, res) => {
  const userId = req.params["id"]!;
  const addresses = await db.select().from(savedAddressesTable)
    .where(eq(savedAddressesTable.userId, userId))
    .orderBy(desc(savedAddressesTable.createdAt));
  sendSuccess(res, {
    addresses: addresses.map(a => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
    })),
  });
});

/* ── DELETE /admin/addresses/:id — remove a specific address ── */
router.delete("/addresses/:id", validateParams(idParamSchema), async (req, res) => {
  const addressId = req.params["id"]!;
  const deleted = await db.delete(savedAddressesTable)
    .where(eq(savedAddressesTable.id, addressId))
    .returning({ id: savedAddressesTable.id });
  if (deleted.length === 0) { sendNotFound(res, "Address not found"); return; }
  sendSuccess(res, { success: true });
});

/* ── GET /admin/users/2fa-stats — aggregate 2FA adoption stats ── */
router.get("/users/2fa-stats", async (req, res) => {
  const [totalUsers] = await db.select({ total: count() }).from(usersTable);
  const [enabledUsers] = await db.select({ total: count() }).from(usersTable).where(eq(usersTable.totpEnabled, true));
  const [enforcedUsers] = await db.select({ total: count() }).from(usersTable).where(isNotNull(usersTable.twoFactorEnforcedAt));

  const byRole = await db.select({
    role: usersTable.role,
    total: count(),
    enabled: sql<number>`COUNT(*) FILTER (WHERE ${usersTable.totpEnabled} = true)`,
    enforced: sql<number>`COUNT(*) FILTER (WHERE ${usersTable.twoFactorEnforcedAt} IS NOT NULL)`,
  }).from(usersTable).groupBy(usersTable.role);

  sendSuccess(res, {
    totalUsers: Number(totalUsers?.total ?? 0),
    twoFactorEnabled: Number(enabledUsers?.total ?? 0),
    twoFactorEnforced: Number(enforcedUsers?.total ?? 0),
    adoptionRate: Number(totalUsers?.total ?? 0) > 0
      ? Math.round((Number(enabledUsers?.total ?? 0) / Number(totalUsers?.total ?? 1)) * 100)
      : 0,
    byRole: byRole.map(r => ({
      role: r.role,
      total: Number(r.total),
      enabled: Number(r.enabled),
      enforced: Number(r.enforced),
    })),
  });
});

/* ── POST /admin/users/:id/2fa/enforce — mark user as 2FA-required ── */
router.post("/users/:id/2fa/enforce", validateParams(idParamSchema), async (req, res) => {
  const userId = req.params["id"]!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { sendNotFound(res, "User not found"); return; }
  await db.update(usersTable).set({ twoFactorEnforcedAt: new Date(), updatedAt: new Date() }).where(eq(usersTable.id, userId));
  addAuditEntry({ action: "admin_2fa_enforce", ip: getClientIp(req), details: `Admin enforced 2FA for user ${userId} (${user.phone})`, result: "success" });
  sendSuccess(res, { success: true, message: `2FA enforcement enabled for ${user.name ?? user.phone}` });
});

/* ── POST /admin/users/:id/2fa/unenforce — remove 2FA enforcement ── */
router.post("/users/:id/2fa/unenforce", validateParams(idParamSchema), async (req, res) => {
  const userId = req.params["id"]!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { sendNotFound(res, "User not found"); return; }
  await db.update(usersTable).set({ twoFactorEnforcedAt: null, updatedAt: new Date() }).where(eq(usersTable.id, userId));
  addAuditEntry({ action: "admin_2fa_unenforce", ip: getClientIp(req), details: `Admin removed 2FA enforcement for user ${userId} (${user.phone})`, result: "success" });
  sendSuccess(res, { success: true, message: `2FA enforcement removed for ${user.name ?? user.phone}` });
});

/* ── PATCH /admin/vendors/:id/auto-confirm — toggle vendor-level auto-confirm ── */
router.patch("/vendors/:id/auto-confirm", validateParams(idParamSchema), async (req, res) => {
  const userId = req.params["id"]!;
  const { enabled } = req.body as { enabled: boolean };
  if (typeof enabled !== "boolean") {
    sendError(res, "`enabled` (boolean) is required", 400); return;
  }
  const [vp] = await db.select({ userId: vendorProfilesTable.userId }).from(vendorProfilesTable).where(eq(vendorProfilesTable.userId, userId)).limit(1);
  if (!vp) { sendNotFound(res, "Vendor profile not found"); return; }
  await db.update(vendorProfilesTable).set({ autoConfirm: enabled, updatedAt: new Date() }).where(eq(vendorProfilesTable.userId, userId));
  addAuditEntry({ action: "admin_vendor_auto_confirm", ip: getClientIp(req), details: `Admin set autoConfirm=${enabled} for vendor ${userId}`, result: "success" });
  sendSuccess(res, { success: true, autoConfirm: enabled });
});

export default router;
