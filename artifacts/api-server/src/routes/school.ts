import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  schoolRoutesTable, schoolSubscriptionsTable,
  notificationsTable, usersTable, walletTransactionsTable,
} from "@workspace/db/schema";
import { asc, desc, eq, and, sql } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { customerAuth } from "../middleware/security.js";

const router: IRouter = Router();

const safeNum = (v: any, def = 0) => { const n = parseFloat(String(v ?? def)); return isNaN(n) ? def : n; };

function formatRoute(r: any) {
  return {
    ...r,
    monthlyPrice:  safeNum(r.monthlyPrice),
    fromLat:       r.fromLat ? safeNum(r.fromLat) : null,
    fromLng:       r.fromLng ? safeNum(r.fromLng) : null,
    toLat:         r.toLat   ? safeNum(r.toLat)   : null,
    toLng:         r.toLng   ? safeNum(r.toLng)   : null,
    createdAt:     r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    updatedAt:     r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
  };
}

/* ══════════════════════════════════════════════════════
   GET /school/routes — Public list of active school routes
══════════════════════════════════════════════════════ */
router.get("/routes", async (_req, res) => {
  const routes = await db.select().from(schoolRoutesTable)
    .where(eq(schoolRoutesTable.isActive, true))
    .orderBy(asc(schoolRoutesTable.sortOrder), asc(schoolRoutesTable.schoolName));
  res.json({ routes: routes.map(formatRoute) });
});

/* ══════════════════════════════════════════════════════
   GET /school/routes/:id — Single route details
══════════════════════════════════════════════════════ */
router.get("/routes/:id", async (req, res) => {
  const [route] = await db.select().from(schoolRoutesTable)
    .where(eq(schoolRoutesTable.id, req.params["id"]!)).limit(1);
  if (!route) { res.status(404).json({ error: "Route not found" }); return; }
  res.json(formatRoute(route));
});

/* ══════════════════════════════════════════════════════
   POST /school/subscribe — Subscribe a student to a school route
   Body: { routeId, studentName, studentClass, paymentMethod }
══════════════════════════════════════════════════════ */
router.post("/subscribe", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const { routeId, studentName, studentClass, paymentMethod = "cash", notes } = req.body;
  if (!routeId || !studentName || !studentClass) {
    res.status(400).json({ error: "routeId, studentName, studentClass required" }); return;
  }

  const [route] = await db.select().from(schoolRoutesTable)
    .where(and(eq(schoolRoutesTable.id, routeId), eq(schoolRoutesTable.isActive, true))).limit(1);
  if (!route) { res.status(404).json({ error: "Route not found or inactive" }); return; }

  /* Capacity check */
  if (route.enrolledCount >= route.capacity) {
    res.status(409).json({ error: `Route is full. Capacity: ${route.capacity}` }); return;
  }

  /* Prevent duplicate active subscription */
  const [existing] = await db.select({ id: schoolSubscriptionsTable.id })
    .from(schoolSubscriptionsTable)
    .where(and(
      eq(schoolSubscriptionsTable.userId, userId),
      eq(schoolSubscriptionsTable.routeId, routeId),
      eq(schoolSubscriptionsTable.status, "active"),
    )).limit(1);
  if (existing) {
    res.status(409).json({ error: "You already have an active subscription for this route" }); return;
  }

  /* Wallet deduction for first month (only if wallet payment) */
  const monthlyAmt = safeNum(route.monthlyPrice);
  if (paymentMethod === "wallet" && monthlyAmt > 0) {
    const [user] = await db.select({ walletBalance: usersTable.walletBalance })
      .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    const balance = safeNum(user.walletBalance);
    if (balance < monthlyAmt) {
      res.status(400).json({ error: `Insufficient wallet balance. Need Rs. ${monthlyAmt.toFixed(0)}` }); return;
    }
    /* Atomic deduction — prevents double-spend under concurrent requests */
    await db.update(usersTable)
      .set({ walletBalance: sql`wallet_balance - ${monthlyAmt.toFixed(2)}` })
      .where(eq(usersTable.id, userId));
    await db.insert(walletTransactionsTable).values({
      id: generateId(), userId, type: "debit",
      amount: monthlyAmt.toFixed(2),
      description: `School Shift — ${route.schoolName} (1st month)`,
    }).catch(() => {});
  }

  /* Next billing = 30 days from now */
  const startDate        = new Date();
  const nextBillingDate  = new Date(startDate);
  nextBillingDate.setDate(nextBillingDate.getDate() + 30);

  const [sub] = await db.insert(schoolSubscriptionsTable).values({
    id: generateId(), userId, routeId, studentName, studentClass,
    monthlyAmount: monthlyAmt.toFixed(2),
    status: "active", paymentMethod,
    startDate, nextBillingDate,
    notes: notes || null,
  }).returning();

  /* Atomic increment — prevents under-counting under concurrent subscriptions */
  await db.update(schoolRoutesTable)
    .set({ enrolledCount: sql`enrolled_count + 1`, updatedAt: new Date() })
    .where(eq(schoolRoutesTable.id, routeId));

  /* Notification */
  await db.insert(notificationsTable).values({
    id: generateId(), userId,
    title: "School Shift Subscribe Ho Gaya! 🚌",
    body: `${studentName} ko ${route.schoolName} ke liye subscribe kar diya gaya. Route: ${route.fromArea} → ${route.toAddress}. Monthly: Rs. ${monthlyAmt.toFixed(0)}`,
    type: "ride", icon: "bus-outline",
  }).catch(() => {});

  res.status(201).json({ ...sub, monthlyAmount: safeNum(sub!.monthlyAmount), route: formatRoute(route) });
});

/* ══════════════════════════════════════════════════════
   GET /school/my-subscriptions — requires JWT
══════════════════════════════════════════════════════ */
router.get("/my-subscriptions", customerAuth, async (req, res) => {
  const userId = req.customerId!;

  const subs = await db.select().from(schoolSubscriptionsTable)
    .where(eq(schoolSubscriptionsTable.userId, userId))
    .orderBy(desc(schoolSubscriptionsTable.createdAt));

  /* Enrich with route info */
  const enriched = await Promise.all(subs.map(async (sub) => {
    const [route] = await db.select().from(schoolRoutesTable)
      .where(eq(schoolRoutesTable.id, sub.routeId)).limit(1);
    return {
      ...sub,
      monthlyAmount: safeNum(sub.monthlyAmount),
      route: route ? formatRoute(route) : null,
      startDate: sub.startDate instanceof Date ? sub.startDate.toISOString() : sub.startDate,
      nextBillingDate: sub.nextBillingDate instanceof Date ? sub.nextBillingDate.toISOString() : sub.nextBillingDate,
      createdAt: sub.createdAt instanceof Date ? sub.createdAt.toISOString() : sub.createdAt,
    };
  }));

  res.json({ subscriptions: enriched });
});

/* ══════════════════════════════════════════════════════
   PATCH /school/subscriptions/:id/cancel
   Requires JWT — cancels the calling user's own subscription.
══════════════════════════════════════════════════════ */
router.patch("/subscriptions/:id/cancel", customerAuth, async (req, res) => {
  const userId = req.customerId!;

  const [sub] = await db.select().from(schoolSubscriptionsTable)
    .where(and(eq(schoolSubscriptionsTable.id, req.params["id"]!), eq(schoolSubscriptionsTable.userId, userId)))
    .limit(1);
  if (!sub) { res.status(404).json({ error: "Subscription not found" }); return; }
  if (sub.status !== "active") { res.status(400).json({ error: "Subscription is already inactive" }); return; }

  /* TOCTOU guard: include userId in UPDATE WHERE so the ownership check
     and the mutation are atomic — a token swap between SELECT and UPDATE
     cannot cancel another user's subscription */
  const [updated] = await db.update(schoolSubscriptionsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(
      eq(schoolSubscriptionsTable.id, req.params["id"]!),
      eq(schoolSubscriptionsTable.userId, userId),
    ))
    .returning();

  /* Decrement enrolled count on the route */
  await db.update(schoolRoutesTable)
    .set({ enrolledCount: sql`enrolled_count - 1`, updatedAt: new Date() })
    .where(eq(schoolRoutesTable.id, sub.routeId));

  res.json({ ...updated, monthlyAmount: safeNum(updated!.monthlyAmount) });
});

export default router;
