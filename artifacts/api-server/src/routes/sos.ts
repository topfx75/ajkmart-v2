import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { notificationsTable, usersTable } from "@workspace/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { customerAuth, riderAuth, verifyUserJwt } from "../middleware/security.js";
import { t } from "@workspace/i18n";
import { getUserLanguage } from "../lib/getUserLanguage.js";

const router: IRouter = Router();

/* ── POST /sos — Customer or rider triggers SOS alert ─────────────────── */
router.post("/", async (req, res) => {
  const authHeader  = req.headers["authorization"] as string | undefined;
  const tokenHeader = req.headers["x-auth-token"]  as string | undefined;
  const raw = tokenHeader || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
  if (!raw) { res.status(401).json({ error: "Authentication required" }); return; }
  const payload = verifyUserJwt(raw);
  if (!payload) { res.status(401).json({ error: "Invalid or expired session" }); return; }

  const userId = payload.userId;
  const { rideId, lat, lng, message } = req.body;

  const [user] = await db.select({ name: usersTable.name, phone: usersTable.phone, role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);

  const locationStr = (lat && lng) ? ` · Location: ${parseFloat(lat).toFixed(5)},${parseFloat(lng).toFixed(5)}` : "";
  const rideStr     = rideId ? ` · Ride: #${String(rideId).slice(-8).toUpperCase()}` : "";
  const msgStr      = message ? ` · "${message}"` : "";

  const alertId = generateId();
  const sosLang = await getUserLanguage(userId);

  await db.insert(notificationsTable).values({
    id: alertId,
    userId,
    title: `🆘 ${t("sosAlert", sosLang)} — ${user?.name || "Unknown"} (${user?.role || "user"})`,
    body: `Phone: ${user?.phone || "N/A"}${rideStr}${locationStr}${msgStr}`,
    type: "sos",
    icon: "alert-circle-outline",
    link: rideId ? `/rides/${rideId}` : `/users/${userId}`,
  });

  res.json({ ok: true, alertId, message: "SOS alert sent. Help is on the way." });
});

/* ── GET /sos/alerts — Admin: list all SOS alerts ─────────────────────── */
router.get("/alerts", async (req, res) => {
  const authHeader = req.headers["authorization"] as string | undefined;
  const raw = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!raw) { res.status(401).json({ error: "Authentication required" }); return; }
  const payload = verifyUserJwt(raw);
  if (!payload || payload.role !== "admin") {
    res.status(403).json({ error: "Admin access required" }); return;
  }

  const page  = Math.max(1, parseInt(String(req.query["page"] || "1"), 10));
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query["limit"] || "20"), 10)));
  const offset = (page - 1) * limit;

  const alerts = await db.select().from(notificationsTable)
    .where(eq(notificationsTable.type, "sos"))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const total = await db.select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(eq(notificationsTable.type, "sos"))
    .then(r => r.length);

  res.json({
    alerts: alerts.map(a => ({
      id:        a.id,
      userId:    a.userId,
      title:     a.title,
      body:      a.body,
      link:      a.link,
      createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt,
    })),
    total,
    page,
    hasMore: offset + alerts.length < total,
  });
});

export default router;
