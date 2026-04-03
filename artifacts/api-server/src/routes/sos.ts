import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db/schema";
import { usersTable } from "@workspace/db/schema";
import { eq, desc, and, ne } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { customerAuth, getCachedSettings } from "../middleware/security.js";
import { adminAuth } from "./admin.js";
import { t } from "@workspace/i18n";
import { getUserLanguage } from "../lib/getUserLanguage.js";
import { emitSosNew, emitSosAcknowledged, emitSosResolved } from "../lib/socketio.js";

const router: IRouter = Router();

/* ── POST /sos — Customer or rider triggers SOS alert ─────────────────── */
router.post("/", customerAuth, async (req, res) => {
  const settings = await getCachedSettings();
  if ((settings["feature_sos"] ?? "on") !== "on") {
    res.status(503).json({ error: "SOS feature is currently disabled" }); return;
  }

  const userId = req.customerId!;
  const { rideId, lat, lng, message } = req.body;

  const [user] = await db.select({ name: usersTable.name, phone: usersTable.phone, role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);

  const locationStr = (lat && lng) ? ` · Location: ${parseFloat(lat).toFixed(5)},${parseFloat(lng).toFixed(5)}` : "";
  const rideStr     = rideId ? ` · Ride: #${String(rideId).slice(-8).toUpperCase()}` : "";
  const msgStr      = message ? ` · "${message}"` : "";

  const alertId = generateId();
  const sosLang = await getUserLanguage(userId);

  const now = new Date();
  const title = `🆘 ${t("sosAlert", sosLang)} — ${user?.name || "Unknown"} (${user?.role || "user"})`;
  const body  = `Phone: ${user?.phone || "N/A"}${rideStr}${locationStr}${msgStr}`;
  const link  = rideId ? `/rides/${rideId}` : `/users/${userId}`;

  await db.insert(notificationsTable).values({
    id: alertId,
    userId,
    title,
    body,
    type: "sos",
    icon: "alert-circle-outline",
    link,
    sosStatus: "pending",
  });

  /* Emit real-time sos:new to all admin-fleet sessions */
  try {
    emitSosNew({
      id: alertId, userId, title, body, link, sosStatus: "pending",
      acknowledgedAt: null, acknowledgedBy: null, acknowledgedByName: null,
      resolvedAt: null, resolvedBy: null, resolvedByName: null, resolutionNotes: null,
      createdAt: now.toISOString(),
    });
  } catch { /* non-critical */ }

  res.json({ ok: true, alertId, message: "SOS alert sent. Help is on the way." });
});

function getAdminFromReq(req: Request): { adminId: string; adminName: string } {
  const adminId = (req as Record<string, unknown>).adminId as string | undefined;
  const adminName = (req as Record<string, unknown>).adminName as string | undefined;
  return { adminId: adminId ?? "admin", adminName: adminName ?? "Admin" };
}

type SosAlertResponse = {
  id: string;
  userId: string;
  title: string;
  body: string;
  link: string | null;
  sosStatus: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  acknowledgedByName: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolvedByName: string | null;
  resolutionNotes: string | null;
  createdAt: string;
};

function ts(v: Date | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/* ── Serialize a notification row — uses persisted name columns directly ── */
function serializeAlert(a: typeof notificationsTable.$inferSelect): SosAlertResponse {
  return {
    id:                 a.id,
    userId:             a.userId,
    title:              a.title,
    body:               a.body,
    link:               a.link ?? null,
    sosStatus:          a.sosStatus ?? "pending",
    acknowledgedAt:     ts(a.acknowledgedAt),
    acknowledgedBy:     a.acknowledgedBy ?? null,
    acknowledgedByName: a.acknowledgedByName ?? a.acknowledgedBy ?? null,
    resolvedAt:         ts(a.resolvedAt),
    resolvedBy:         a.resolvedBy ?? null,
    resolvedByName:     a.resolvedByName ?? a.resolvedBy ?? null,
    resolutionNotes:    a.resolutionNotes ?? null,
    createdAt:          ts(a.createdAt) ?? new Date(0).toISOString(),
  };
}

const ALLOWED_SOS_STATUSES = new Set(["pending", "acknowledged", "resolved"]);

/* ── GET /sos/alerts — Admin: list SOS alerts with optional ?status= filter ── */
router.get("/alerts", adminAuth, async (req, res) => {
  const admin = getAdminFromReq(req);

  const page   = Math.max(1, parseInt(String(req.query["page"]  || "1"),  10));
  const limit  = Math.min(50, Math.max(1, parseInt(String(req.query["limit"] || "20"), 10)));
  const offset = (page - 1) * limit;
  const rawStatus = req.query["status"] as string | undefined;
  const statusFilter = rawStatus && ALLOWED_SOS_STATUSES.has(rawStatus) ? rawStatus : undefined;

  const baseWhere = eq(notificationsTable.type, "sos");
  const whereClause = statusFilter
    ? and(baseWhere, eq(notificationsTable.sosStatus, statusFilter))
    : baseWhere;

  const [alerts, allSos] = await Promise.all([
    db.select().from(notificationsTable)
      .where(whereClause)
      .orderBy(desc(notificationsTable.createdAt))
      .limit(limit)
      .offset(offset),
    /* unresolved count for sidebar badge (pending + acknowledged) */
    db.select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(and(eq(notificationsTable.type, "sos"), ne(notificationsTable.sosStatus, "resolved"))),
  ]);

  /* total for current filter */
  const totalRows = await db.select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(whereClause)
    .then(r => r.length);

  res.json({
    alerts: alerts.map(a => serializeAlert(a)),
    total:  totalRows,
    page,
    hasMore:     offset + alerts.length < totalRows,
    activeCount: allSos.length,
  });
});

/* ── PATCH /sos/alerts/:id/acknowledge ── */
router.patch("/alerts/:id/acknowledge", adminAuth, async (req, res) => {
  const admin = getAdminFromReq(req);

  const alertId = req.params["id"];
  const [existing] = await db.select().from(notificationsTable)
    .where(and(eq(notificationsTable.id, alertId), eq(notificationsTable.type, "sos")))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "SOS alert not found" }); return; }
  if (existing.sosStatus === "acknowledged") {
    res.status(409).json({ error: "Alert is already acknowledged", acknowledgedBy: existing.acknowledgedByName ?? existing.acknowledgedBy ?? "another admin" });
    return;
  }
  if (existing.sosStatus === "resolved") { res.status(409).json({ error: "Alert is already resolved" }); return; }

  const now = new Date();
  await db.update(notificationsTable)
    .set({ sosStatus: "acknowledged", acknowledgedAt: now, acknowledgedBy: admin.adminId, acknowledgedByName: admin.adminName })
    .where(eq(notificationsTable.id, alertId));

  const [updated] = await db.select().from(notificationsTable).where(eq(notificationsTable.id, alertId)).limit(1);
  const fullPayload = serializeAlert(updated);

  try { emitSosAcknowledged(fullPayload); } catch { /* non-critical */ }
  res.json({ ok: true, alert: fullPayload });
});

/* ── PATCH /sos/alerts/:id/resolve ── */
router.patch("/alerts/:id/resolve", adminAuth, async (req, res) => {
  const admin = getAdminFromReq(req);

  const alertId = req.params["id"];
  const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : null;

  const [existing] = await db.select().from(notificationsTable)
    .where(and(eq(notificationsTable.id, alertId), eq(notificationsTable.type, "sos")))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "SOS alert not found" }); return; }
  if (existing.sosStatus === "resolved") { res.status(409).json({ error: "Alert is already resolved" }); return; }

  const now = new Date();
  await db.update(notificationsTable)
    .set({ sosStatus: "resolved", resolvedAt: now, resolvedBy: admin.adminId, resolvedByName: admin.adminName, resolutionNotes: notes || null })
    .where(eq(notificationsTable.id, alertId));

  const [updated] = await db.select().from(notificationsTable).where(eq(notificationsTable.id, alertId)).limit(1);
  const fullPayload = serializeAlert(updated);

  try { emitSosResolved(fullPayload); } catch { /* non-critical */ }
  res.json({ ok: true, alert: fullPayload });
});

export default router;
