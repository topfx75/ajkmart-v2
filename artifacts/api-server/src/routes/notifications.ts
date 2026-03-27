import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { customerAuth } from "../middleware/security.js";

/* ── internal-only admin secret (set via ADMIN_SECRET env) ── */
const INTERNAL_SECRET = process.env["ADMIN_SECRET"] || "ajkmart-admin-secret-CHANGE-IN-PRODUCTION";

const router: IRouter = Router();

/* GET /notifications — list notifications for the authenticated user */
router.get("/", customerAuth, async (req, res) => {
  const userId = (req as any).customerId as string;

  let notifs = await db.select().from(notificationsTable)
    .where(eq(notificationsTable.userId, userId))
    .orderBy(notificationsTable.createdAt);

  if (notifs.length === 0) {
    const seeds = [
      { id: generateId(), userId, title: "Welcome to AJKMart!", body: "AJK ki pehli Super App mein aapka khush amdeed! Grocery, Food, Ride, Pharmacy sab ek jagah.", type: "system", icon: "star-outline", isRead: false },
      { id: generateId(), userId, title: "Wallet Feature Active", body: "Aapka AJKMart Wallet ready hai. Top up karein aur cashless payments enjoy karein.", type: "wallet", icon: "wallet-outline", isRead: false },
      { id: generateId(), userId, title: "Ride Service Available", body: "Muzaffarabad, Mirpur, Rawalakot mein bike aur car booking available hai. Abhi try karein!", type: "ride", icon: "car-outline", isRead: true },
    ];
    await db.insert(notificationsTable).values(seeds);
    notifs = await db.select().from(notificationsTable)
      .where(eq(notificationsTable.userId, userId))
      .orderBy(notificationsTable.createdAt);
  }

  const unreadCount = notifs.filter(n => !n.isRead).length;
  res.json({
    notifications: notifs.reverse().map(n => ({ ...n, createdAt: n.createdAt.toISOString() })),
    unreadCount,
  });
});

/* POST /notifications — internal server-to-server use only; requires x-admin-secret header */
router.post("/", async (req, res) => {
  const incomingSecret = req.headers["x-admin-secret"] as string | undefined;
  if (!incomingSecret || incomingSecret !== INTERNAL_SECRET) {
    res.status(401).json({ error: "Unauthorized. Admin secret required for internal notifications." });
    return;
  }
  const { userId, title, body, type, icon, link } = req.body;
  if (!userId || !title || !body) { res.status(400).json({ error: "userId, title, body required" }); return; }
  const id = generateId();
  await db.insert(notificationsTable).values({ id, userId, title, body, type: type || "system", icon: icon || "notifications-outline", link: link || null, isRead: false });
  res.json({ id, success: true });
});

/* PATCH /notifications/read-all — mark all as read for auth user */
router.patch("/read-all", customerAuth, async (req, res) => {
  const userId = (req as any).customerId as string;
  await db.update(notificationsTable).set({ isRead: true }).where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));
  res.json({ success: true });
});

/* PATCH /notifications/:id/read */
router.patch("/:id/read", customerAuth, async (req, res) => {
  const userId = (req as any).customerId as string;
  /* Verify ownership */
  const [notif] = await db.select().from(notificationsTable).where(eq(notificationsTable.id, req.params["id"]!)).limit(1);
  if (!notif) { res.status(404).json({ error: "Not found" }); return; }
  if (notif.userId !== userId) { res.status(403).json({ error: "Access denied" }); return; }
  await db.update(notificationsTable).set({ isRead: true }).where(eq(notificationsTable.id, req.params["id"]!));
  res.json({ success: true });
});

/* DELETE /notifications/:id */
router.delete("/:id", customerAuth, async (req, res) => {
  const userId = (req as any).customerId as string;
  const [notif] = await db.select().from(notificationsTable).where(eq(notificationsTable.id, req.params["id"]!)).limit(1);
  if (!notif) { res.status(404).json({ error: "Not found" }); return; }
  if (notif.userId !== userId) { res.status(403).json({ error: "Access denied" }); return; }
  await db.delete(notificationsTable).where(eq(notificationsTable.id, req.params["id"]!));
  res.json({ success: true });
});

export default router;
