import { Router } from "express";
import { getIO } from "../../lib/socketio.js";
import { db } from "@workspace/db";
import {
  usersTable,
  walletTransactionsTable,
  notificationsTable,
  ordersTable, ridesTable, pharmacyOrdersTable, parcelBookingsTable,
} from "@workspace/db/schema";
import { eq, desc, count, sum, and, gte, lte, sql, or, ilike, asc, isNull, isNotNull, avg, ne } from "drizzle-orm";
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

const router = Router();
router.get("/users", async (req, res) => {
  const filter = (req.query?.filter as string) ?? "";
  let query = db.select().from(usersTable);
  if (filter === "2fa_enabled") {
    query = query.where(eq(usersTable.totpEnabled, true)) as any;
  }
  const users = await query.orderBy(desc(usersTable.createdAt));
  sendSuccess(res, {
    users: users.map((u) => ({
      ...stripUser(u),
      walletBalance: parseFloat(u.walletBalance ?? "0"),
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    })),
    total: users.length,
  });
});

router.patch("/users/:id", async (req, res) => {
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
router.get("/users/pending", async (_req, res) => {
  const users = await db.select().from(usersTable)
    .where(eq(usersTable.approvalStatus, "pending"))
    .orderBy(desc(usersTable.createdAt));
  sendSuccess(res, {
    users: users.map(({ otpCode: _otp, otpExpiry: _exp, passwordHash: _ph, emailOtpCode: _eotp, emailOtpExpiry: _eexp, ...u }) => ({
      ...u,
      walletBalance: parseFloat(u.walletBalance ?? "0"),
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    })),
    total: users.length,
  });
});

/* ── Approve User ── */
router.post("/users/:id/approve", async (req, res) => {
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

  const [user] = await db.update(usersTable)
    .set({ approvalStatus: "approved", approvalNote: note || null, isActive: true, updatedAt: new Date() })
    .where(eq(usersTable.id, req.params["id"]!))
    .returning();
  if (!user) { sendNotFound(res, "User not found"); return; }
  addAuditEntry({ action: "user_approved", ip: "admin", details: `User approved: ${user.phone} — ${user.name || "unnamed"}`, result: "success" });
  sendSuccess(res, { success: true, user: { ...stripUser(user), walletBalance: parseFloat(user.walletBalance ?? "0") } });
});

/* ── Reject User ── */
router.post("/users/:id/reject", async (req, res) => {
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
router.post("/users/:id/wallet-topup", async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    sendValidationError(res, "Valid amount is required");
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.params["id"]!));
  if (!user) { sendNotFound(res, "User not found"); return; }

  const currentBalance = parseFloat(user.walletBalance ?? "0");
  const newBalance = currentBalance + Number(amount);

  const [updatedUser] = await db
    .update(usersTable)
    .set({ walletBalance: String(newBalance), updatedAt: new Date() })
    .where(eq(usersTable.id, req.params["id"]!))
    .returning();

  await db.insert(walletTransactionsTable).values({
    id: generateId(),
    userId: req.params["id"]!,
    type: "credit",
    amount: String(amount),
    description: description || `Admin top-up: Rs. ${amount}`,
    reference: "admin_topup",
  });

  await sendUserNotification(
    req.params["id"]!,
    "Wallet Topped Up! 💰",
    `Rs. ${amount} has been added to your AJKMart wallet.`,
    "system",
    "wallet-outline"
  );

  sendSuccess(res, {
    success: true,
    newBalance,
    user: { ...stripUser(updatedUser!), walletBalance: newBalance },
  });
});
router.delete("/users/:id", async (req, res) => {
  await db.delete(usersTable).where(eq(usersTable.id, req.params["id"]!));
  sendSuccess(res, { success: true });
});

/* ── User Activity (orders + rides summary) ── */
router.get("/users/:id/activity", async (req, res) => {
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
router.patch("/users/:id/security", async (req, res) => {
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
router.patch("/users/:id/identity", async (req, res) => {
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
    const raw = String(body.phone).replace(/[\s\-()]/g, "");
    if (raw) {
      const normalized = raw.replace(/^\+?92/, "").replace(/^0/, "");
      if (!/^3\d{9}$/.test(normalized)) { sendValidationError(res, "Invalid phone format"); return; }
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

router.post("/users/:id/reset-otp", async (req, res) => {
  await db.update(usersTable).set({ otpCode: null, otpExpiry: null, updatedAt: new Date() }).where(eq(usersTable.id, req.params["id"]!));
  sendSuccess(res, { success: true, message: "OTP cleared — user must re-authenticate" });
});

/* ── Force-disable 2FA for a user (admin action) ── */
router.post("/users/:id/2fa/disable", async (req, res) => {
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

/* ── Admin Accounts (Sub-Admins) ── */
router.patch("/users/:id/request-correction", async (req, res) => {
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
router.patch("/users/:id/waive-debt", async (req, res) => {
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
router.patch("/users/bulk-ban", async (req, res) => {
  const { ids, action, reason } = req.body as { ids: string[]; action: "ban" | "unban"; reason?: string };
  if (!ids?.length) { sendValidationError(res, "ids required"); return; }
  const updates = action === "ban"
    ? { isBanned: true, isActive: false, banReason: (reason || "Banned by admin") as string | null, updatedAt: new Date() }
    : { isBanned: false, isActive: true, banReason: null as string | null, updatedAt: new Date() };
  for (const id of ids) {
    await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).catch(() => {});
  }
  addAuditEntry({ action: `bulk_${action}`, ip: getClientIp(req), adminId: (req as AdminRequest).adminId, details: `Bulk ${action}: ${ids.length} users`, result: "success" });
  sendSuccess(res, { success: true, affected: ids.length, action });
});

/* ── PATCH /admin/orders/:id/assign-rider — manually assign a rider to an order ── */

export default router;
