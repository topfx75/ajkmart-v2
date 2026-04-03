import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { ordersTable, pharmacyOrdersTable, parcelBookingsTable, productsTable, reviewsTable, rideRatingsTable, ridesTable, usersTable } from "@workspace/db/schema";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getPlatformSettings } from "./admin.js";
import { customerAuth, verifyUserJwt, writeAuthAuditLog, getClientIp } from "../middleware/security.js";
import OpenAI from "openai";

const router: IRouter = Router();

/* ── Local Vendor Auth ─────────────────────────────────────────────────── */
async function vendorAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  const tokenHeader = req.headers["x-auth-token"] as string | undefined;
  const raw = tokenHeader || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
  const ip = getClientIp(req);
  if (!raw) { res.status(401).json({ error: "Authentication required" }); return; }
  const payload = verifyUserJwt(raw);
  if (!payload) {
    writeAuthAuditLog("auth_denied_invalid_token", { ip, metadata: { url: req.url, role: "vendor" } });
    res.status(401).json({ error: "Invalid or expired session" }); return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
  if (!user || !user.isActive || user.isBanned) { res.status(403).json({ error: "Access denied" }); return; }
  const dbRoles = (user.roles || user.role || "").split(",").map((r: string) => r.trim());
  if (!dbRoles.includes("vendor")) { res.status(403).json({ error: "Vendor role required" }); return; }
  req.vendorId = user.id;
  req.vendorUser = user;
  next();
}

/* ── AI Moderation Client ──────────────────────────────────────────────── */
let aiClient: OpenAI | null = null;
function getAIClient(): OpenAI | null {
  if (!process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"] || !process.env["AI_INTEGRATIONS_OPENAI_API_KEY"]) {
    return null;
  }
  if (!aiClient) {
    aiClient = new OpenAI({
      baseURL: process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"],
      apiKey: process.env["AI_INTEGRATIONS_OPENAI_API_KEY"],
    });
  }
  return aiClient;
}

async function moderateComment(comment: string): Promise<{ flagged: boolean; reason: string | null }> {
  const client = getAIClient();
  if (!client || !comment || comment.trim().length < 5) {
    return { flagged: false, reason: null };
  }
  try {
    const response = await client.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 100,
      messages: [
        {
          role: "system",
          content: "You are a content moderation assistant. Analyze the following review comment and reply ONLY with a JSON object in the format: {\"flagged\": true/false, \"reason\": \"reason or null\"}. Flag as true if the comment contains spam, hate speech, profanity, offensive language, or abusive content. Otherwise set flagged to false and reason to null.",
        },
        { role: "user", content: comment },
      ],
    });
    const text = response.choices[0]?.message?.content?.trim() || "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { flagged: !!parsed.flagged, reason: parsed.reason || null };
    }
  } catch (e) {
    console.error("[moderation] AI check failed:", e);
  }
  return { flagged: false, reason: null };
}

/* ── GET /reviews/product/:productId — public paginated reviews for a product ── */
router.get("/product/:productId", async (req, res) => {
  const productId = req.params["productId"]!;
  const page = Math.max(1, parseInt(String(req.query["page"] || "1")));
  const limit = Math.min(parseInt(String(req.query["limit"] || "10")), 50);
  const offset = (page - 1) * limit;

  const [product] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);

  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const [countResult] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(reviewsTable)
    .where(and(
      eq(reviewsTable.productId, productId),
      eq(reviewsTable.hidden, false),
      isNull(reviewsTable.deletedAt),
      eq(reviewsTable.status, "visible"),
    ));

  const total = countResult?.total ?? 0;

  const rows = await db
    .select({
      id: reviewsTable.id,
      userId: reviewsTable.userId,
      rating: reviewsTable.rating,
      comment: reviewsTable.comment,
      photos: reviewsTable.photos,
      createdAt: reviewsTable.createdAt,
      vendorReply: reviewsTable.vendorReply,
      vendorRepliedAt: reviewsTable.vendorRepliedAt,
      userName: usersTable.name,
    })
    .from(reviewsTable)
    .leftJoin(usersTable, eq(reviewsTable.userId, usersTable.id))
    .where(and(
      eq(reviewsTable.productId, productId),
      eq(reviewsTable.hidden, false),
      isNull(reviewsTable.deletedAt),
      eq(reviewsTable.status, "visible"),
    ))
    .orderBy(desc(reviewsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({
    reviews: rows.map(r => ({
      ...r,
      userName: r.userName || "Customer",
      photos: r.photos ?? [],
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});

/* ── GET /reviews/product/:productId/summary — rating distribution stats ── */
router.get("/product/:productId/summary", async (req, res) => {
  const productId = req.params["productId"]!;

  const rows = await db
    .select({
      rating: reviewsTable.rating,
      count: sql<number>`count(*)::int`,
    })
    .from(reviewsTable)
    .where(and(
      eq(reviewsTable.productId, productId),
      eq(reviewsTable.hidden, false),
      isNull(reviewsTable.deletedAt),
      eq(reviewsTable.status, "visible"),
    ))
    .groupBy(reviewsTable.rating);

  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  let sum = 0;
  for (const row of rows) {
    distribution[row.rating] = row.count;
    total += row.count;
    sum += row.rating * row.count;
  }
  const average = total > 0 ? parseFloat((sum / total).toFixed(1)) : 0;

  res.json({ average, total, distribution });
});

/* ── POST /reviews — submit a review ─────────────────────────────────────── */
router.post("/", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const { orderId, vendorId, riderId, orderType, rating, riderRating, comment, productId, photos } = req.body;

  if (!orderType || !rating) {
    res.status(400).json({ error: "orderType and rating are required" });
    return;
  }
  if (orderType !== "product" && !orderId) {
    res.status(400).json({ error: "orderId is required for order-based reviews" });
    return;
  }

  const validPhotos: string[] = [];
  if (photos && Array.isArray(photos)) {
    for (const p of photos.slice(0, 3)) {
      if (typeof p === "string" && p.trim()) validPhotos.push(p.trim());
    }
  }
  if (typeof rating !== "number" || rating < 1 || rating > 5) {
    res.status(400).json({ error: "rating must be 1–5" });
    return;
  }
  if (riderRating !== undefined && riderRating !== null) {
    if (typeof riderRating !== "number" || riderRating < 1 || riderRating > 5) {
      res.status(400).json({ error: "riderRating must be 1–5" });
      return;
    }
  }

  const s = await getPlatformSettings();
  const reviewsEnabled = (s["feature_reviews"] ?? "on") === "on";
  if (!reviewsEnabled) {
    res.status(503).json({ error: "Customer reviews are currently disabled." });
    return;
  }

  /* ── Rating window enforcement + IDOR protection + authoritative subject derivation ──
     We derive vendorId and riderId from the DB row (not from client-supplied values)
     to prevent subject-spoofing. A client can only review the subjects actually
     associated with their order/ride. Client-supplied IDs are only used as a signal
     of intent (e.g. dual-rating) but the persisted value is always the DB-authoritative one. */
  const ratingWindowHours = parseFloat(s["order_rating_window_hours"] ?? "48");

  /* Resolved subjects — set from DB, not from request body */
  let authoritativeRiderId: string | null = null;
  let authoritativeVendorId: string | null = null;

  if (orderType === "ride") {
    const [rideRow] = await db
      .select({ createdAt: ridesTable.createdAt, userId: ridesTable.userId, riderId: ridesTable.riderId })
      .from(ridesTable)
      .where(eq(ridesTable.id, orderId))
      .limit(1);

    if (!rideRow) {
      res.status(404).json({ error: "Ride not found." });
      return;
    }
    if (rideRow.userId !== userId) {
      res.status(403).json({ error: "You can only review your own rides." });
      return;
    }
    /* Self-rating guard */
    if (rideRow.riderId && rideRow.riderId === userId) {
      res.status(403).json({ error: "You cannot rate yourself." });
      return;
    }
    const ageHours = (Date.now() - new Date(rideRow.createdAt).getTime()) / (3_600_000);
    if (ageHours > ratingWindowHours) {
      res.status(400).json({ error: `Reviews can only be submitted within ${ratingWindowHours} hours of completion.`, expired: true, ratingWindowHours });
      return;
    }
    authoritativeRiderId = rideRow.riderId ?? null;

  } else if (orderType === "pharmacy") {
    const [row] = await db
      .select({ createdAt: pharmacyOrdersTable.createdAt, userId: pharmacyOrdersTable.userId, riderId: pharmacyOrdersTable.riderId })
      .from(pharmacyOrdersTable)
      .where(eq(pharmacyOrdersTable.id, orderId))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Pharmacy order not found." });
      return;
    }
    if (row.userId !== userId) {
      res.status(403).json({ error: "You can only review your own orders." });
      return;
    }
    const ageHours = (Date.now() - new Date(row.createdAt).getTime()) / (3_600_000);
    if (ageHours > ratingWindowHours) {
      res.status(400).json({ error: `Reviews can only be submitted within ${ratingWindowHours} hours of order completion.`, expired: true, ratingWindowHours });
      return;
    }
    authoritativeRiderId = row.riderId ?? null;

  } else if (orderType === "parcel") {
    const [row] = await db
      .select({ createdAt: parcelBookingsTable.createdAt, userId: parcelBookingsTable.userId, riderId: parcelBookingsTable.riderId })
      .from(parcelBookingsTable)
      .where(eq(parcelBookingsTable.id, orderId))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Parcel booking not found." });
      return;
    }
    if (row.userId !== userId) {
      res.status(403).json({ error: "You can only review your own bookings." });
      return;
    }
    const ageHours = (Date.now() - new Date(row.createdAt).getTime()) / (3_600_000);
    if (ageHours > ratingWindowHours) {
      res.status(400).json({ error: `Reviews can only be submitted within ${ratingWindowHours} hours of completion.`, expired: true, ratingWindowHours });
      return;
    }
    authoritativeRiderId = row.riderId ?? null;

  } else if (orderType === "product") {
    if (!productId) {
      res.status(400).json({ error: "productId is required for product reviews." });
      return;
    }
    const [productRow] = await db
      .select({ id: productsTable.id, vendorId: productsTable.vendorId })
      .from(productsTable)
      .where(eq(productsTable.id, productId))
      .limit(1);

    if (!productRow) {
      res.status(404).json({ error: "Product not found." });
      return;
    }

    const purchaseOrders = await db
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.userId, userId),
          sql`${ordersTable.status} IN ('delivered', 'completed')`,
          sql`EXISTS (
            SELECT 1 FROM json_array_elements(${ordersTable.items}::json) elem
            WHERE elem->>'productId' = ${productId}
          )`
        )
      )
      .limit(1);

    if (purchaseOrders.length === 0) {
      res.status(403).json({ error: "You can only review products you have purchased." });
      return;
    }

    authoritativeVendorId = productRow.vendorId ?? null;

  } else {
    /* Mart / food / general delivery — all in ordersTable */
    const [orderRow] = await db
      .select({ createdAt: ordersTable.createdAt, userId: ordersTable.userId, vendorId: ordersTable.vendorId, riderId: ordersTable.riderId })
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .limit(1);

    if (!orderRow) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    if (orderRow.userId !== userId) {
      res.status(403).json({ error: "You can only review your own orders." });
      return;
    }
    const ageHours = (Date.now() - new Date(orderRow.createdAt).getTime()) / (3_600_000);
    if (ageHours > ratingWindowHours) {
      res.status(400).json({ error: `Reviews can only be submitted within ${ratingWindowHours} hours of order completion.`, expired: true, ratingWindowHours });
      return;
    }
    /* Derive subjects from DB — never from request body */
    authoritativeVendorId = orderRow.vendorId ?? null;
    authoritativeRiderId  = orderRow.riderId ?? null;
  }

  /* Self-rating guard (non-ride types) */
  if (authoritativeRiderId && authoritativeRiderId === userId) {
    res.status(403).json({ error: "You cannot rate yourself." });
    return;
  }

  const existingCondition = orderType === "product" && productId
    ? and(eq(reviewsTable.productId, productId), eq(reviewsTable.userId, userId), eq(reviewsTable.orderType, "product"))
    : and(eq(reviewsTable.orderId, orderId), eq(reviewsTable.userId, userId));

  const existing = await db
    .select({ id: reviewsTable.id })
    .from(reviewsTable)
    .where(existingCondition)
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: "Already reviewed", alreadyReviewed: true });
    return;
  }

  /* Use authoritative subjects from DB, not client-supplied IDs */
  let status = "visible";
  let moderationNote: string | null = null;

  if (comment && comment.trim().length > 0) {
    const modResult = await moderateComment(comment);
    if (modResult.flagged) {
      status = "pending_moderation";
      moderationNote = modResult.reason;
    }
  }

  const resolvedOrderId = orderType === "product" ? `product-review-${productId}-${generateId()}` : orderId;

  const [review] = await db.insert(reviewsTable).values({
    id: generateId(),
    orderId: resolvedOrderId,
    userId,
    vendorId: authoritativeVendorId,
    riderId:  authoritativeRiderId,
    orderType,
    rating,
    riderRating: (authoritativeRiderId && riderRating) ? riderRating : null,
    comment: comment ?? null,
    photos: validPhotos.length > 0 ? validPhotos : null,
    productId: productId ?? null,
    status,
    moderationNote,
  }).returning();

  if (status === "pending_moderation") {
    res.status(201).json({ ...review, _moderated: true, message: "Your review is under moderation and will be visible once approved." });
  } else {
    res.status(201).json(review);
  }
});

/* ── GET /reviews?orderId= — check if reviewed (IDOR-protected) ── */
router.get("/", customerAuth, async (req, res) => {
  const userId  = req.customerId!;
  const orderId = req.query["orderId"] as string;
  const type    = (req.query["type"] as string) ?? "order"; // "ride" | "order"
  if (!orderId) { res.status(400).json({ error: "orderId required" }); return; }

  /* Ownership gate: verify the caller owns this order/ride before revealing review status.
     Without this check a caller can enumerate review states for arbitrary IDs. */
  let owned = false;
  if (type === "ride") {
    const [row] = await db.select({ userId: ridesTable.userId }).from(ridesTable).where(eq(ridesTable.id, orderId)).limit(1);
    owned = !!row && row.userId === userId;
  } else if (type === "pharmacy") {
    const [row] = await db.select({ userId: pharmacyOrdersTable.userId }).from(pharmacyOrdersTable).where(eq(pharmacyOrdersTable.id, orderId)).limit(1);
    owned = !!row && row.userId === userId;
  } else if (type === "parcel") {
    const [row] = await db.select({ userId: parcelBookingsTable.userId }).from(parcelBookingsTable).where(eq(parcelBookingsTable.id, orderId)).limit(1);
    owned = !!row && row.userId === userId;
  } else {
    const [row] = await db.select({ userId: ordersTable.userId }).from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
    owned = !!row && row.userId === userId;
  }
  if (!owned) {
    res.status(403).json({ error: "Forbidden." });
    return;
  }

  /* Now safe to query review status — already scoped to (orderId + userId) */
  const rows = await db
    .select()
    .from(reviewsTable)
    .where(and(eq(reviewsTable.orderId, orderId), eq(reviewsTable.userId, userId)))
    .limit(1);

  res.json({ reviewed: rows.length > 0, review: rows[0] ?? null });
});

/* ── GET /reviews/my — list all reviews submitted by the logged-in customer ── */
router.get("/my", customerAuth, async (req, res) => {
  const userId     = req.customerId!;
  const pageParam  = Math.max(1, parseInt(String(req.query["page"] || "1")));
  const limitParam = Math.min(parseInt(String(req.query["limit"] || "50")), 100);
  const offset     = (pageParam - 1) * limitParam;

  /* Fetch both review sources without local slicing so we can compute an accurate total */

  /* All reviews from the unified reviews table (order reviews + ride reviews posted via Orders tab) */
  const [reviewRows, rideRatingsRows] = await Promise.all([
    db
      .select({
        id: reviewsTable.id,
        type: sql<string>`CASE WHEN ${reviewsTable.orderType} = 'ride' THEN 'ride' ELSE 'order' END`,
        orderId: reviewsTable.orderId,
        vendorId: reviewsTable.vendorId,
        riderId: reviewsTable.riderId,
        orderType: reviewsTable.orderType,
        rating: reviewsTable.rating,
        riderRating: reviewsTable.riderRating,
        comment: reviewsTable.comment,
        createdAt: reviewsTable.createdAt,
        vendorName: usersTable.storeName,
      })
      .from(reviewsTable)
      .leftJoin(usersTable, eq(reviewsTable.vendorId, usersTable.id))
      .where(and(eq(reviewsTable.userId, userId), isNull(reviewsTable.deletedAt)))
      .orderBy(desc(reviewsTable.createdAt)),

    /* Ride ratings submitted via the dedicated /rides/:id/rate endpoint */
    db
      .select({
        id: rideRatingsTable.id,
        type: sql<string>`'ride'`,
        orderId: rideRatingsTable.rideId,
        vendorId: sql<string | null>`null`,
        riderId: rideRatingsTable.riderId,
        orderType: sql<string>`'ride'`,
        rating: rideRatingsTable.stars,
        riderRating: sql<number | null>`null`,
        comment: rideRatingsTable.comment,
        createdAt: rideRatingsTable.createdAt,
        vendorName: sql<string | null>`null`,
      })
      .from(rideRatingsTable)
      .where(and(eq(rideRatingsTable.customerId, userId), isNull(rideRatingsTable.deletedAt)))
      .orderBy(desc(rideRatingsTable.createdAt)),
  ]);

  /* Merge and sort chronologically — dedup so a ride reviewed via /reviews
     doesn't also appear as a legacy rideRatingsTable row */
  const rideIdsInReviews = new Set(
    reviewRows.filter(r => r.orderType === "ride").map(r => r.orderId),
  );
  const filteredRideRatings = rideRatingsRows.filter(r => !rideIdsInReviews.has(r.orderId));

  const allRows = [...reviewRows, ...filteredRideRatings]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const total = allRows.length; // true total before pagination

  /* Paginate after sorting */
  const paginated = allRows.slice(offset, offset + limitParam);

  /* Enrich with rider names */
  const riderIds = [...new Set(paginated.map(r => r.riderId).filter(Boolean))] as string[];
  const riderUsers = riderIds.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name })
        .from(usersTable)
        .where(sql`${usersTable.id} = ANY(${riderIds})`)
    : [];
  const riderMap = new Map(riderUsers.map(u => [u.id, u.name]));

  const reviews = paginated.map(r => ({
    ...r,
    riderName: r.riderId ? (riderMap.get(r.riderId) ?? null) : null,
  }));

  res.json({ reviews, total, page: pageParam, pages: Math.ceil(total / limitParam) });
});

/* ── GET /reviews/vendor/:vendorId — all visible reviews for a vendor (public) ── */
router.get("/vendor/:vendorId", async (req, res) => {
  const rows = await db
    .select({
      id: reviewsTable.id,
      orderId: reviewsTable.orderId,
      userId: reviewsTable.userId,
      rating: reviewsTable.rating,
      comment: reviewsTable.comment,
      orderType: reviewsTable.orderType,
      createdAt: reviewsTable.createdAt,
      customerName: usersTable.name,
    })
    .from(reviewsTable)
    .leftJoin(usersTable, eq(reviewsTable.userId, usersTable.id))
    .where(and(
      eq(reviewsTable.vendorId, req.params["vendorId"]!),
      eq(reviewsTable.hidden, false),
      isNull(reviewsTable.deletedAt),
    ))
    .orderBy(desc(reviewsTable.createdAt));

  const avg = rows.length
    ? (rows.reduce((s, r) => s + r.rating, 0) / rows.length).toFixed(1)
    : null;

  res.json({ reviews: rows, avgRating: avg ? parseFloat(avg) : null, total: rows.length });
});

/* ── POST /reviews/:id/vendor-reply — vendor reply ─────────────────────── */
router.post("/:id/vendor-reply", vendorAuth, async (req, res) => {
  const vendorId = req.vendorId!;
  const reviewId = String(req.params["id"]);
  const { reply } = req.body;

  if (!reply || typeof reply !== "string" || reply.trim().length === 0) {
    res.status(400).json({ error: "reply text is required" });
    return;
  }

  const [review] = await db.select().from(reviewsTable)
    .where(and(eq(reviewsTable.id, reviewId), eq(reviewsTable.vendorId, vendorId)))
    .limit(1);

  if (!review) {
    res.status(404).json({ error: "Review not found or does not belong to your store" });
    return;
  }

  if (review.vendorReply) {
    res.status(409).json({ error: "A reply already exists. Use PUT to update it." });
    return;
  }

  const [updated] = await db.update(reviewsTable)
    .set({ vendorReply: reply.trim(), vendorRepliedAt: new Date() })
    .where(eq(reviewsTable.id, reviewId))
    .returning();

  res.status(201).json(updated);
});

/* ── PUT /reviews/:id/vendor-reply — edit vendor reply ──────────────────── */
router.put("/:id/vendor-reply", vendorAuth, async (req, res) => {
  const vendorId = req.vendorId!;
  const reviewId = String(req.params["id"]);
  const { reply } = req.body;

  if (!reply || typeof reply !== "string" || reply.trim().length === 0) {
    res.status(400).json({ error: "reply text is required" });
    return;
  }

  const [review] = await db.select().from(reviewsTable)
    .where(and(eq(reviewsTable.id, reviewId), eq(reviewsTable.vendorId, vendorId)))
    .limit(1);

  if (!review) {
    res.status(404).json({ error: "Review not found or does not belong to your store" });
    return;
  }

  if (!review.vendorReply) {
    res.status(404).json({ error: "No reply exists. Use POST to create one." });
    return;
  }

  const [updated] = await db.update(reviewsTable)
    .set({ vendorReply: reply.trim(), vendorRepliedAt: new Date() })
    .where(eq(reviewsTable.id, reviewId))
    .returning();

  res.json(updated);
});

/* ── DELETE /reviews/:id/vendor-reply — delete vendor reply ─────────────── */
router.delete("/:id/vendor-reply", vendorAuth, async (req, res) => {
  const vendorId = req.vendorId!;
  const reviewId = String(req.params["id"]);

  const [review] = await db.select().from(reviewsTable)
    .where(and(eq(reviewsTable.id, reviewId), eq(reviewsTable.vendorId, vendorId)))
    .limit(1);

  if (!review) {
    res.status(404).json({ error: "Review not found or does not belong to your store" });
    return;
  }

  if (!review.vendorReply) {
    res.status(404).json({ error: "No reply exists" });
    return;
  }

  const [updated] = await db.update(reviewsTable)
    .set({ vendorReply: null, vendorRepliedAt: null })
    .where(eq(reviewsTable.id, reviewId))
    .returning();

  res.json(updated);
});

export default router;
