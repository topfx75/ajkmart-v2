import { Router } from "express";
import { db } from "@workspace/db";
import {
  accountConditionsTable,
  conditionRulesTable,
  conditionSettingsTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, desc, and, gte, lte, ilike, or, sql, count, inArray } from "drizzle-orm";
import {
  generateId, addAuditEntry, getClientIp, type AdminRequest,
} from "../admin-shared.js";
import { sendSuccess, sendError, sendNotFound, sendValidationError } from "../../lib/response.js";

const router = Router();

export async function reconcileUserFlags(userId: string, excludeConditionId?: string) {
  const filters: ReturnType<typeof eq>[] = [
    eq(accountConditionsTable.userId, userId),
    eq(accountConditionsTable.isActive, true),
  ];
  if (excludeConditionId) {
    filters.push(sql`${accountConditionsTable.id} != ${excludeConditionId}`);
  }

  const activeConditions = await db.select({
    severity: accountConditionsTable.severity,
    conditionType: accountConditionsTable.conditionType,
    reason: accountConditionsTable.reason,
  }).from(accountConditionsTable).where(and(...filters));

  const hasBan = activeConditions.some(c => c.severity === "ban");
  const hasSuspension = activeConditions.some(c => c.severity === "suspension");
  const banCondition = activeConditions.find(c => c.severity === "ban");

  const blockedServices: string[] = [];
  for (const c of activeConditions) {
    if (c.conditionType === "restriction_wallet_freeze") blockedServices.push("wallet");
    if (c.conditionType === "restriction_service_block") blockedServices.push("orders", "rides");
    if (c.conditionType === "restriction_new_order_block") blockedServices.push("new_orders");
  }
  const uniqueBlocked = [...new Set(blockedServices)];

  const updateSet: Partial<typeof usersTable.$inferInsert> = {
    isBanned: hasBan,
    isActive: !(hasBan || hasSuspension),
    banReason: hasBan ? (banCondition?.reason || "Banned via conditions") : null,
    updatedAt: new Date(),
  };
  if (uniqueBlocked.length > 0) {
    updateSet.blockedServices = uniqueBlocked.join(",");
  } else {
    const [currentUser] = await db.select({ blockedServices: usersTable.blockedServices }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (currentUser?.blockedServices) {
      updateSet.blockedServices = "";
    }
  }

  await db.update(usersTable).set(updateSet).where(eq(usersTable.id, userId));
}

const DEFAULT_RULES = [
  { name: "Customer cancellation rate > 25%", targetRole: "customer", metric: "cancellation_rate", operator: ">", threshold: "25", conditionType: "warning_l1" as const, severity: "warning" as const },
  { name: "Customer cancellation rate > 45%", targetRole: "customer", metric: "cancellation_rate", operator: ">", threshold: "45", conditionType: "restriction_service_block" as const, severity: "restriction_normal" as const },
  { name: "Customer cancellation rate > 65%", targetRole: "customer", metric: "cancellation_rate", operator: ">", threshold: "65", conditionType: "suspension_temporary" as const, severity: "suspension" as const },
  { name: "Customer fraud/chargeback 1 incident", targetRole: "customer", metric: "fraud_incidents", operator: ">=", threshold: "1", conditionType: "warning_l1" as const, severity: "warning" as const },
  { name: "Customer fraud/chargeback 2 incidents", targetRole: "customer", metric: "fraud_incidents", operator: ">=", threshold: "2", conditionType: "restriction_wallet_freeze" as const, severity: "restriction_normal" as const },
  { name: "Customer fraud/chargeback 3 incidents", targetRole: "customer", metric: "fraud_incidents", operator: ">=", threshold: "3", conditionType: "suspension_temporary" as const, severity: "suspension" as const },
  { name: "Customer fraud/chargeback 4+ incidents", targetRole: "customer", metric: "fraud_incidents", operator: ">=", threshold: "4", conditionType: "ban_fraud" as const, severity: "ban" as const },
  { name: "Customer abuse reports 3+", targetRole: "customer", metric: "abuse_reports", operator: ">=", threshold: "3", conditionType: "warning_l1" as const, severity: "warning" as const },
  { name: "Customer abuse reports 6+", targetRole: "customer", metric: "abuse_reports", operator: ">=", threshold: "6", conditionType: "restriction_new_order_block" as const, severity: "restriction_strict" as const },
  { name: "Customer abuse reports 10+", targetRole: "customer", metric: "abuse_reports", operator: ">=", threshold: "10", conditionType: "suspension_temporary" as const, severity: "suspension" as const },
  { name: "Rider miss/ignore rate > 20%", targetRole: "rider", metric: "miss_ignore_rate", operator: ">", threshold: "20", conditionType: "warning_l1" as const, severity: "warning" as const },
  { name: "Rider miss/ignore rate > 35%", targetRole: "rider", metric: "miss_ignore_rate", operator: ">", threshold: "35", conditionType: "restriction_service_block" as const, severity: "restriction_normal" as const },
  { name: "Rider miss/ignore rate > 50%", targetRole: "rider", metric: "miss_ignore_rate", operator: ">", threshold: "50", conditionType: "suspension_temporary" as const, severity: "suspension" as const },
  { name: "Rider avg rating < 3.8", targetRole: "rider", metric: "avg_rating_30d", operator: "<", threshold: "3.8", conditionType: "warning_l1" as const, severity: "warning" as const },
  { name: "Rider avg rating < 3.5", targetRole: "rider", metric: "avg_rating_30d", operator: "<", threshold: "3.5", conditionType: "restriction_service_block" as const, severity: "restriction_normal" as const },
  { name: "Rider GPS spoofing detected", targetRole: "rider", metric: "gps_spoofing", operator: ">=", threshold: "1", conditionType: "suspension_temporary" as const, severity: "suspension" as const },
  { name: "Vendor order completion < 85%", targetRole: "vendor", metric: "order_completion_rate", operator: "<", threshold: "85", conditionType: "warning_l1" as const, severity: "warning" as const },
  { name: "Vendor order completion < 70%", targetRole: "vendor", metric: "order_completion_rate", operator: "<", threshold: "70", conditionType: "restriction_service_block" as const, severity: "restriction_normal" as const },
  { name: "Vendor fraud/fake orders", targetRole: "vendor", metric: "fraud_incidents", operator: ">=", threshold: "1", conditionType: "warning_l1" as const, severity: "warning" as const },
  { name: "Vendor fraud 3+ incidents", targetRole: "vendor", metric: "fraud_incidents", operator: ">=", threshold: "3", conditionType: "ban_fraud" as const, severity: "ban" as const },
];

router.get("/conditions", async (req, res) => {
  try {
    const { role, type, severity, status, userId, dateFrom, dateTo, search, limit: limitStr, offset: offsetStr } = req.query as Record<string, string>;
    const conditions: ReturnType<typeof eq>[] = [];
    const filters: ReturnType<typeof eq>[] = [];

    if (role) filters.push(eq(accountConditionsTable.userRole, role));
    if (type) filters.push(eq(accountConditionsTable.conditionType, type as typeof accountConditionsTable.$inferInsert["conditionType"]));
    if (severity) filters.push(eq(accountConditionsTable.severity, severity as typeof accountConditionsTable.$inferInsert["severity"]));
    if (status === "active") filters.push(eq(accountConditionsTable.isActive, true));
    if (status === "lifted") filters.push(eq(accountConditionsTable.isActive, false));
    if (userId) filters.push(eq(accountConditionsTable.userId, userId));
    if (dateFrom) filters.push(gte(accountConditionsTable.appliedAt, new Date(dateFrom)));
    if (dateTo) filters.push(lte(accountConditionsTable.appliedAt, new Date(dateTo + "T23:59:59")));

    const limit = Math.min(parseInt(limitStr || "100", 10), 500);
    const offset = parseInt(offsetStr || "0", 10);

    let query = db.select({
      condition: accountConditionsTable,
      userName: usersTable.name,
      userPhone: usersTable.phone,
      userAvatar: usersTable.avatar,
    })
    .from(accountConditionsTable)
    .leftJoin(usersTable, eq(accountConditionsTable.userId, usersTable.id))
    .orderBy(desc(accountConditionsTable.appliedAt))
    .limit(limit)
    .offset(offset);

    if (filters.length > 0) {
      query = query.where(and(...filters)) as typeof query;
    }

    if (search) {
      query = query.where(
        and(
          ...(filters.length > 0 ? filters : []),
          or(
            ilike(usersTable.name, `%${search}%`),
            ilike(usersTable.phone, `%${search}%`),
            ilike(accountConditionsTable.reason, `%${search}%`),
          ),
        ),
      ) as typeof query;
    }

    const rows = await query;

    const [totalResult] = await db.select({ count: count() }).from(accountConditionsTable)
      .where(filters.length > 0 ? and(...filters) : undefined);

    const statsFilters: ReturnType<typeof eq>[] = [eq(accountConditionsTable.isActive, true)];
    if (role) statsFilters.push(eq(accountConditionsTable.userRole, role));
    if (userId) statsFilters.push(eq(accountConditionsTable.userId, userId));
    if (dateFrom) statsFilters.push(gte(accountConditionsTable.appliedAt, new Date(dateFrom)));
    if (dateTo) statsFilters.push(lte(accountConditionsTable.appliedAt, new Date(dateTo + "T23:59:59")));

    const [activeCount] = await db.select({ count: count() }).from(accountConditionsTable)
      .where(and(...statsFilters));

    const severityCounts = await db.select({
      severity: accountConditionsTable.severity,
      count: count(),
    }).from(accountConditionsTable)
      .where(and(...statsFilters))
      .groupBy(accountConditionsTable.severity);

    const roleCounts = await db.select({
      role: accountConditionsTable.userRole,
      count: count(),
    }).from(accountConditionsTable)
      .where(and(...statsFilters))
      .groupBy(accountConditionsTable.userRole);

    sendSuccess(res, {
      conditions: rows.map(r => ({
        ...r.condition,
        appliedAt: r.condition.appliedAt.toISOString(),
        expiresAt: r.condition.expiresAt?.toISOString() || null,
        liftedAt: r.condition.liftedAt?.toISOString() || null,
        createdAt: r.condition.createdAt.toISOString(),
        updatedAt: r.condition.updatedAt.toISOString(),
        userName: r.userName,
        userPhone: r.userPhone,
        userAvatar: r.userAvatar,
      })),
      total: totalResult?.count || 0,
      activeCount: activeCount?.count || 0,
      severityCounts: Object.fromEntries(severityCounts.map(s => [s.severity, s.count])),
      roleCounts: Object.fromEntries(roleCounts.map(r => [r.role, r.count])),
    });
  } catch (e: unknown) {
    sendError(res, (e instanceof Error ? e.message : undefined) || "Failed to fetch conditions", 500);
  }
});

router.post("/conditions", async (req, res) => {
  try {
    const body = req.body as { userId?: string; conditionType?: string; severity?: string; category?: string; reason?: string; notes?: string; expiresAt?: string; metadata?: unknown };
    const { userId, conditionType, severity, category, reason, notes, expiresAt, metadata } = body;

    if (!userId || !conditionType || !severity || !category || !reason) {
      sendValidationError(res, "userId, conditionType, severity, category, and reason are required");
      return;
    }

    const [user] = await db.select({ id: usersTable.id, role: usersTable.role, roles: usersTable.roles })
      .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { sendNotFound(res, "User not found"); return; }

    const adminReq = req as AdminRequest;
    const id = generateId();

    const [condition] = await db.insert(accountConditionsTable).values({
      id,
      userId,
      userRole: user.role,
      conditionType,
      severity,
      category,
      reason,
      notes: notes || null,
      appliedBy: adminReq.adminId || adminReq.adminName || "admin",
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      metadata: metadata || null,
    }).returning();

    await reconcileUserFlags(userId);

    addAuditEntry({
      action: "condition_applied",
      ip: getClientIp(req),
      adminId: adminReq.adminId,
      details: `Condition ${conditionType} (${severity}) applied to user ${userId}: ${reason}`,
      result: "success",
    });

    sendSuccess(res, {
      ...condition,
      appliedAt: condition.appliedAt.toISOString(),
      expiresAt: condition.expiresAt?.toISOString() || null,
      createdAt: condition.createdAt.toISOString(),
      updatedAt: condition.updatedAt.toISOString(),
    });
  } catch (e: unknown) {
    sendError(res, (e instanceof Error ? e.message : undefined) || "Failed to apply condition", 500);
  }
});

router.patch("/conditions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body as Record<string, unknown>;
    const adminReq = req as AdminRequest;

    const [existing] = await db.select().from(accountConditionsTable).where(eq(accountConditionsTable.id, id!)).limit(1);
    if (!existing) { sendNotFound(res, "Condition not found"); return; }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.action === "lift") {
      updates.isActive = false;
      updates.liftedAt = new Date();
      updates.liftedBy = adminReq.adminId || adminReq.adminName || "admin";
      updates.liftReason = body.liftReason || "Lifted by admin";

      await reconcileUserFlags(existing.userId, id as string);
    }

    if (body.action === "escalate") {
      const escalationMap: Record<string, { type: string; severity: string }> = {
        "warning_l1": { type: "warning_l2", severity: "warning" },
        "warning_l2": { type: "warning_l3", severity: "warning" },
        "warning_l3": { type: "suspension_temporary", severity: "suspension" },
        "restriction_service_block": { type: "suspension_temporary", severity: "suspension" },
        "restriction_wallet_freeze": { type: "suspension_temporary", severity: "suspension" },
        "suspension_temporary": { type: "suspension_extended", severity: "suspension" },
        "suspension_extended": { type: "ban_soft", severity: "ban" },
        "ban_soft": { type: "ban_hard", severity: "ban" },
      };
      const next = escalationMap[existing.conditionType];
      if (next) {
        updates.isActive = false;
        updates.liftedAt = new Date();
        updates.liftedBy = adminReq.adminId || "admin";
        updates.liftReason = "Escalated";

        const newId = generateId();
        await db.insert(accountConditionsTable).values({
          id: newId,
          userId: existing.userId,
          userRole: existing.userRole,
          conditionType: next.type as typeof accountConditionsTable.$inferInsert["conditionType"],
          severity: next.severity as typeof accountConditionsTable.$inferInsert["severity"],
          category: existing.category,
          reason: body.reason || `Escalated from ${existing.conditionType}`,
          notes: body.notes || null,
          appliedBy: adminReq.adminId || "admin",
          metadata: { escalatedFrom: existing.id },
        });

        await reconcileUserFlags(existing.userId);
      }
    }

    if (body.notes !== undefined) updates.notes = body.notes;

    const [updated] = await db.update(accountConditionsTable).set(updates).where(eq(accountConditionsTable.id, id!)).returning();

    addAuditEntry({
      action: `condition_${body.action || "updated"}`,
      ip: getClientIp(req),
      adminId: adminReq.adminId,
      details: `Condition ${id} ${body.action || "updated"} for user ${existing.userId}`,
      result: "success",
    });

    sendSuccess(res, {
      ...updated,
      appliedAt: updated.appliedAt.toISOString(),
      expiresAt: updated.expiresAt?.toISOString() || null,
      liftedAt: updated.liftedAt?.toISOString() || null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (e: unknown) {
    sendError(res, (e instanceof Error ? e.message : undefined) || "Failed to update condition", 500);
  }
});

router.delete("/conditions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const adminReq = req as AdminRequest;
    const [deleted] = await db.delete(accountConditionsTable).where(eq(accountConditionsTable.id, id!)).returning();
    if (!deleted) { sendNotFound(res, "Condition not found"); return; }

    if (deleted.isActive) {
      await reconcileUserFlags(deleted.userId);
    }

    addAuditEntry({
      action: "condition_deleted",
      ip: getClientIp(req),
      adminId: adminReq.adminId,
      details: `Condition ${id} hard-deleted (type: ${deleted.conditionType}, user: ${deleted.userId})`,
      result: "success",
    });

    sendSuccess(res, { success: true });
  } catch (e: unknown) {
    sendError(res, (e instanceof Error ? e.message : undefined) || "Failed to delete condition", 500);
  }
});

router.post("/conditions/bulk", async (req, res) => {
  try {
    const { ids, action, reason } = req.body as { ids: string[]; action: "lift"; reason?: string };
    if (!ids?.length) { sendValidationError(res, "ids required"); return; }
    if (action !== "lift") { sendValidationError(res, "Only 'lift' action is supported for bulk operations"); return; }
    const adminReq = req as AdminRequest;

    let affected = 0;
    const affectedUserIds = new Set<string>();
    for (const id of ids) {
      const [existing] = await db.select().from(accountConditionsTable).where(eq(accountConditionsTable.id, id)).limit(1);
      if (!existing || !existing.isActive) continue;

      await db.update(accountConditionsTable).set({
        isActive: false,
        liftedAt: new Date(),
        liftedBy: adminReq.adminId || "admin",
        liftReason: reason || "Bulk lift",
        updatedAt: new Date(),
      }).where(eq(accountConditionsTable.id, id));
      affected++;
      affectedUserIds.add(existing.userId);
    }

    for (const userId of affectedUserIds) {
      await reconcileUserFlags(userId);
    }

    addAuditEntry({
      action: `condition_bulk_${action}`,
      ip: getClientIp(req),
      adminId: adminReq.adminId,
      details: `Bulk ${action}: ${affected} of ${ids.length} conditions`,
      result: "success",
    });

    sendSuccess(res, { success: true, affected, action });
  } catch (e: unknown) {
    sendError(res, (e instanceof Error ? e.message : undefined) || "Bulk action failed", 500);
  }
});

router.get("/conditions/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const conditions = await db.select().from(accountConditionsTable)
      .where(eq(accountConditionsTable.userId, userId!))
      .orderBy(desc(accountConditionsTable.appliedAt));

    const activeCount = conditions.filter(c => c.isActive).length;

    sendSuccess(res, {
      conditions: conditions.map(c => ({
        ...c,
        appliedAt: c.appliedAt.toISOString(),
        expiresAt: c.expiresAt?.toISOString() || null,
        liftedAt: c.liftedAt?.toISOString() || null,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
      activeCount,
      total: conditions.length,
    });
  } catch (e: unknown) {
    sendError(res, (e instanceof Error ? e.message : undefined) || "Failed to fetch user conditions", 500);
  }
});

router.get("/condition-rules", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query?.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query?.limit as string) || 50));
    const offset = (page - 1) * limit;

    const [totalResult, rules] = await Promise.all([
      db.select({ total: count() }).from(conditionRulesTable),
      db.select().from(conditionRulesTable).orderBy(conditionRulesTable.targetRole, conditionRulesTable.name).limit(limit).offset(offset),
    ]);

    const total = Number(totalResult[0]?.total ?? 0);
    sendSuccess(res, {
      rules: rules.map(r => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (e: unknown) {
    sendError(res, (e instanceof Error ? e.message : undefined) || "Failed to fetch rules", 500);
  }
});

router.post("/condition-rules", async (req, res) => {
  try {
    const body = req.body;
    const { name, targetRole, metric, operator, threshold, conditionType, severity, cooldownHours, modeApplicability } = body;

    if (!name || !targetRole || !metric || !operator || !threshold || !conditionType || !severity) {
      sendValidationError(res, "All rule fields are required");
      return;
    }

    const id = generateId();
    const [rule] = await db.insert(conditionRulesTable).values({
      id,
      name,
      description: body.description || null,
      targetRole,
      metric,
      operator,
      threshold: String(threshold),
      conditionType,
      severity,
      cooldownHours: cooldownHours || 24,
      modeApplicability: modeApplicability || "default,ai_recommended,custom",
    }).returning();

    const adminReq = req as AdminRequest;
    addAuditEntry({
      action: "condition_rule_created",
      ip: getClientIp(req),
      adminId: adminReq.adminId,
      details: `Rule created: ${name} (${targetRole}, ${metric} ${operator} ${threshold})`,
      result: "success",
    });

    sendSuccess(res, { ...rule, createdAt: rule.createdAt.toISOString(), updatedAt: rule.updatedAt.toISOString() });
  } catch (e: unknown) {
    sendError(res, (e instanceof Error ? e.message : undefined) || "Failed to create rule", 500);
  }
});

router.patch("/condition-rules/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.targetRole !== undefined) updates.targetRole = body.targetRole;
    if (body.metric !== undefined) updates.metric = body.metric;
    if (body.operator !== undefined) updates.operator = body.operator;
    if (body.threshold !== undefined) updates.threshold = String(body.threshold);
    if (body.conditionType !== undefined) updates.conditionType = body.conditionType;
    if (body.severity !== undefined) updates.severity = body.severity;
    if (body.cooldownHours !== undefined) updates.cooldownHours = body.cooldownHours;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (body.modeApplicability !== undefined) updates.modeApplicability = body.modeApplicability;

    const [rule] = await db.update(conditionRulesTable).set(updates).where(eq(conditionRulesTable.id, id!)).returning();
    if (!rule) { sendNotFound(res, "Rule not found"); return; }

    const adminReq = req as AdminRequest;
    addAuditEntry({
      action: "condition_rule_updated",
      ip: getClientIp(req),
      adminId: adminReq.adminId,
      details: `Rule updated: ${rule.name} (fields: ${Object.keys(body).join(", ")})`,
      result: "success",
    });

    sendSuccess(res, { ...rule, createdAt: rule.createdAt.toISOString(), updatedAt: rule.updatedAt.toISOString() });
  } catch (e: unknown) {
    sendError(res, (e instanceof Error ? e.message : undefined) || "Failed to update rule", 500);
  }
});

router.delete("/condition-rules/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [deleted] = await db.delete(conditionRulesTable).where(eq(conditionRulesTable.id, id!)).returning();
    if (!deleted) { sendNotFound(res, "Rule not found"); return; }

    const adminReq = req as AdminRequest;
    addAuditEntry({
      action: "condition_rule_deleted",
      ip: getClientIp(req),
      adminId: adminReq.adminId,
      details: `Rule deleted: ${deleted.name} (${deleted.targetRole}, ${deleted.metric} ${deleted.operator} ${deleted.threshold})`,
      result: "success",
    });

    sendSuccess(res, { success: true });
  } catch (e: unknown) {
    sendError(res, (e instanceof Error ? e.message : undefined) || "Failed to delete rule", 500);
  }
});

router.post("/condition-rules/seed-defaults", async (req, res) => {
  try {
    const existing = await db.select({ count: count() }).from(conditionRulesTable);
    if ((existing[0]?.count || 0) > 0) {
      sendSuccess(res, { message: "Rules already exist, skipping seed", seeded: 0 });
      return;
    }

    for (const rule of DEFAULT_RULES) {
      await db.insert(conditionRulesTable).values({
        id: generateId(),
        ...rule,
        cooldownHours: 24,
        modeApplicability: "default,ai_recommended,custom",
      });
    }

    sendSuccess(res, { message: "Default rules seeded", seeded: DEFAULT_RULES.length });
  } catch (e: unknown) {
    sendError(res, (e instanceof Error ? e.message : undefined) || "Failed to seed rules", 500);
  }
});

router.get("/condition-settings", async (_req, res) => {
  try {
    let [settings] = await db.select().from(conditionSettingsTable).limit(1);
    if (!settings) {
      [settings] = await db.insert(conditionSettingsTable).values({
        id: generateId(),
        mode: "default",
        customThresholds: null,
        aiParameters: null,
      }).returning();
    }
    sendSuccess(res, {
      ...settings,
      updatedAt: settings.updatedAt.toISOString(),
    });
  } catch (e: unknown) {
    sendError(res, (e instanceof Error ? e.message : undefined) || "Failed to fetch settings", 500);
  }
});

router.patch("/condition-settings", async (req, res) => {
  try {
    const body = req.body;
    const adminReq = req as AdminRequest;

    let [existing] = await db.select().from(conditionSettingsTable).limit(1);
    if (!existing) {
      [existing] = await db.insert(conditionSettingsTable).values({
        id: generateId(),
        mode: "default",
      }).returning();
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy: adminReq.adminId || adminReq.adminName || "admin",
    };

    if (body.mode !== undefined) updates.mode = body.mode;
    if (body.customThresholds !== undefined) updates.customThresholds = body.customThresholds;
    if (body.aiParameters !== undefined) updates.aiParameters = body.aiParameters;

    const [updated] = await db.update(conditionSettingsTable).set(updates).where(eq(conditionSettingsTable.id, existing.id)).returning();

    addAuditEntry({
      action: "condition_settings_updated",
      ip: getClientIp(req),
      adminId: adminReq.adminId,
      details: `Condition settings updated: mode ${existing.mode} → ${updated.mode}, fields: ${Object.keys(body).join(", ")}`,
      result: "success",
    });

    sendSuccess(res, {
      ...updated,
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (e: unknown) {
    sendError(res, (e instanceof Error ? e.message : undefined) || "Failed to update settings", 500);
  }
});

router.post("/condition-rules/evaluate/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const adminReq = req as AdminRequest;

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId!)).limit(1);
    if (!user) { sendNotFound(res, "User not found"); return; }

    const [settings] = await db.select().from(conditionSettingsTable).limit(1);
    const currentMode = settings?.mode || "default";

    const rules = await db.select().from(conditionRulesTable)
      .where(eq(conditionRulesTable.isActive, true));

    const applicableRules = rules.filter(r => {
      const modeList = (r.modeApplicability || "default").split(",").map((s: string) => s.trim());
      return modeList.includes(currentMode) && r.targetRole === (user.role || "customer");
    });

    const existingConditions = await db.select().from(accountConditionsTable)
      .where(and(eq(accountConditionsTable.userId, userId!), eq(accountConditionsTable.isActive, true)));

    const triggered: Array<{ rule: string; conditionType: string; severity: string; applied: boolean; reason: string }> = [];

    for (const rule of applicableRules) {
      const alreadyHas = existingConditions.some(c => c.conditionType === rule.conditionType);
      if (alreadyHas) {
        triggered.push({ rule: rule.name, conditionType: rule.conditionType, severity: rule.severity, applied: false, reason: "Already has this condition" });
        continue;
      }

      let metricValue: number | null = null;
      if (rule.metric === "cancellation_rate") {
        metricValue = parseFloat(String((user as Record<string, unknown>)["cancellationRate"] || 0));
      } else if (rule.metric === "fraud_incidents") {
        metricValue = parseInt(String((user as Record<string, unknown>)["fraudIncidents"] || 0), 10);
      } else if (rule.metric === "abuse_reports") {
        metricValue = parseInt(String((user as Record<string, unknown>)["abuseReports"] || 0), 10);
      } else if (rule.metric === "avg_rating_30d") {
        metricValue = parseFloat(String((user as Record<string, unknown>)["avgRating"] || 5));
      } else if (rule.metric === "miss_ignore_rate") {
        metricValue = parseFloat(String((user as Record<string, unknown>)["missIgnoreRate"] || 0));
      } else if (rule.metric === "order_completion_rate") {
        metricValue = parseFloat(String((user as Record<string, unknown>)["orderCompletionRate"] || 100));
      }

      if (metricValue === null) continue;

      const threshold = parseFloat(rule.threshold);
      let matches = false;
      switch (rule.operator) {
        case ">": matches = metricValue > threshold; break;
        case "<": matches = metricValue < threshold; break;
        case ">=": matches = metricValue >= threshold; break;
        case "<=": matches = metricValue <= threshold; break;
        case "==": matches = metricValue === threshold; break;
        case "!=": matches = metricValue !== threshold; break;
      }

      if (matches) {
        const condId = generateId();
        const category = rule.severity === "ban" ? "ban" : rule.severity === "suspension" ? "suspension" : rule.severity.startsWith("restriction") ? "restriction" : "warning";
        await db.insert(accountConditionsTable).values({
          id: condId,
          userId: userId!,
          userRole: user.role || "customer",
          conditionType: rule.conditionType as typeof accountConditionsTable.$inferInsert["conditionType"],
          severity: rule.severity as typeof accountConditionsTable.$inferInsert["severity"],
          category,
          reason: `Auto-triggered: ${rule.name} (${rule.metric} ${rule.operator} ${rule.threshold})`,
          appliedBy: "rule_engine",
          metadata: { ruleId: rule.id, metricValue },
        });

        triggered.push({ rule: rule.name, conditionType: rule.conditionType, severity: rule.severity, applied: true, reason: `Metric ${rule.metric}=${metricValue} ${rule.operator} ${rule.threshold}` });
      }
    }

    if (triggered.some(t => t.applied)) {
      await reconcileUserFlags(userId!);
    }

    addAuditEntry({
      action: "condition_rules_evaluated",
      ip: getClientIp(req),
      adminId: adminReq.adminId,
      details: `Evaluated ${applicableRules.length} rules for user ${userId}: ${triggered.filter(t => t.applied).length} conditions applied`,
      result: "success",
    });

    sendSuccess(res, { userId, mode: currentMode, rulesEvaluated: applicableRules.length, triggered });
  } catch (e: unknown) {
    sendError(res, (e instanceof Error ? e.message : undefined) || "Rule evaluation failed", 500);
  }
});

export default router;
