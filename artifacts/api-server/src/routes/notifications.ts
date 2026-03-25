import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { generateId } from "../lib/id.js";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  const userId = req.query["userId"] as string;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }

  let notifs = await db.select().from(notificationsTable)
    .where(eq(notificationsTable.userId, userId))
    .orderBy(notificationsTable.createdAt);

  if (notifs.length === 0) {
    const seeds = [
      { id: generateId(), userId, title: "Welcome to AJKMart! 🎉", body: "AJK ki pehli Super App mein aapka khush amdeed! Grocery, Food, Ride, Pharmacy sab ek jagah.", type: "system", icon: "star-outline", isRead: false },
      { id: generateId(), userId, title: "Wallet Feature Active", body: "Aapka AJKMart Wallet ready hai. Top up karein aur cashless payments enjoy karein.", type: "wallet", icon: "wallet-outline", isRead: false },
      { id: generateId(), userId, title: "🏍️ Ride Service Available", body: "Muzaffarabad, Mirpur, Rawalakot mein bike aur car booking available hai. Abhi try karein!", type: "ride", icon: "car-outline", isRead: true },
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

router.post("/", async (req, res) => {
  const { userId, title, body, type, icon, link } = req.body;
  if (!userId || !title || !body) { res.status(400).json({ error: "userId, title, body required" }); return; }
  const id = generateId();
  await db.insert(notificationsTable).values({ id, userId, title, body, type: type || "system", icon: icon || "notifications-outline", link: link || null, isRead: false });
  res.json({ id, success: true });
});

router.patch("/:id/read", async (req, res) => {
  const { id } = req.params;
  await db.update(notificationsTable).set({ isRead: true }).where(eq(notificationsTable.id, id!));
  res.json({ success: true });
});

router.patch("/read-all", async (req, res) => {
  const userId = req.body.userId as string;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }
  await db.update(notificationsTable).set({ isRead: true }).where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));
  res.json({ success: true });
});

router.delete("/:id", async (req, res) => {
  await db.delete(notificationsTable).where(eq(notificationsTable.id, req.params["id"]!));
  res.json({ success: true });
});

export default router;
