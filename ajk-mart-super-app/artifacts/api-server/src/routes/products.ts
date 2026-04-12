import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { productsTable, productVariantsTable, flashDealsTable, reviewsTable } from "@workspace/db/schema";
import { eq, ilike, and, SQL, gte, lte, gt, desc, asc, sql, isNotNull, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "../lib/id.js";
import { sendSuccess, sendCreated, sendNotFound, sendError, sendInternalError } from "../lib/response.js";
import { validateBody } from "../middleware/validate.js";
import { adminAuth, getPlatformSettings } from "./admin.js";

const router: IRouter = Router();

function mapProduct(p: typeof productsTable.$inferSelect) {
  return {
    ...p,
    price: parseFloat(p.price),
    originalPrice: p.originalPrice ? parseFloat(p.originalPrice) : undefined,
    rating: p.rating ? parseFloat(p.rating) : null,
  };
}

/* ── GET /products/flash-deals ──────────────────────────────────────────── */
router.get("/flash-deals", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
  const now = new Date();

  try {
    const activeDeals = await db.select({
      productId: flashDealsTable.productId,
      dealStock: flashDealsTable.dealStock,
      soldCount: flashDealsTable.soldCount,
      endTime: flashDealsTable.endTime,
    }).from(flashDealsTable).where(
      and(
        eq(flashDealsTable.isActive, true),
        lte(flashDealsTable.startTime, now),
        gte(flashDealsTable.endTime, now),
        gt(flashDealsTable.dealStock, flashDealsTable.soldCount),
      )
    ).limit(limit);

    if (activeDeals.length === 0) {
      sendSuccess(res, { products: [], total: 0 });
      return;
    }

    const dealProductIds = activeDeals.map(d => d.productId);
    const dealMap = new Map(activeDeals.map(d => [d.productId, d]));

    const products = await db.select().from(productsTable)
      .where(and(
        inArray(productsTable.id, dealProductIds),
        eq(productsTable.approvalStatus, "approved"),
        eq(productsTable.inStock, true),
      ))
      .orderBy(asc(productsTable.createdAt));

    sendSuccess(res, {
      products: products.map(p => {
        const price = parseFloat(p.price);
        const origPrice = p.originalPrice ? parseFloat(p.originalPrice) : price;
        const discount = origPrice > price ? Math.round(((origPrice - price) / origPrice) * 100) : 0;
        const dealInfo = dealMap.get(p.id);
        return {
          ...p,
          price,
          originalPrice: origPrice,
          rating: p.rating ? parseFloat(p.rating) : null,
          discountPercent: discount,
          dealStock: dealInfo?.dealStock ?? null,
          soldCount: dealInfo?.soldCount ?? 0,
          dealExpiresAt: dealInfo?.endTime?.toISOString() ?? null,
        };
      }),
      total: products.length,
    });
  } catch (e: unknown) {
    console.error("[products GET /flash-deals] DB error:", e);
    sendInternalError(res);
  }
});

/* ── GET /products/trending-searches — top search terms (MVP: top product names) ── */
router.get("/trending-searches", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 12, 30);

  const topProducts = await db
    .select({ name: productsTable.name })
    .from(productsTable)
    .where(and(
      eq(productsTable.approvalStatus, "approved"),
      eq(productsTable.inStock, true),
    ))
    .orderBy(desc(productsTable.reviewCount))
    .limit(limit * 3);

  const seen = new Set<string>();
  const searches: string[] = [];

  for (const p of topProducts) {
    const words = p.name.trim().split(/\s+/);
    const term = words.length > 2 ? words.slice(0, 2).join(" ") : p.name.trim();
    const key = term.toLowerCase();
    if (!seen.has(key) && term.length >= 3) {
      seen.add(key);
      searches.push(term);
    }
    if (searches.length >= limit) break;
  }

  const FALLBACK_TERMS = [
    "Fruits", "Vegetables", "Meat", "Dairy", "Bread",
    "Beverages", "Snacks", "Rice", "Chicken", "Eggs",
    "Biryani", "Pizza", "Burger",
  ];
  if (searches.length < 5) {
    for (const t of FALLBACK_TERMS) {
      const key = t.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        searches.push(t);
      }
      if (searches.length >= limit) break;
    }
  }

  sendSuccess(res, { searches });
});

/* ── GET /products/search ─────────────────────────────────────────────────
   Supports full-text ranking (ts_rank) for the default "relevance" sort.
   Falls back to ilike for very short queries (<3 chars).
   ─────────────────────────────────────────────────────────────────────── */
router.get("/search", async (req, res) => {
  const { q, type, sort, minPrice, maxPrice, minRating, category } = req.query;
  const page = Math.max(parseInt(req.query.page as string) || 1, 1);
  const perPage = Math.min(Math.max(parseInt(req.query.perPage as string) || 20, 1), 50);
  const offset = (page - 1) * perPage;

  if (!q || typeof q !== "string" || !q.trim()) {
    sendSuccess(res, { products: [], total: 0, page, perPage, totalPages: 0 });
    return;
  }

  const trimmed = q.trim();

  const tokens = trimmed
    .replace(/[^a-zA-Z0-9\s\u0600-\u06FF]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 0);
  const tsQueryStr = tokens.join(" & ");
  const useFullText = tokens.length > 0 && trimmed.length >= 3;

  const baseConditions: SQL[] = [
    eq(productsTable.approvalStatus, "approved"),
    eq(productsTable.inStock, true),
  ];
  if (type && typeof type === "string") baseConditions.push(eq(productsTable.type, type));
  if (category && typeof category === "string") baseConditions.push(eq(productsTable.category, category));
  if (minPrice) baseConditions.push(gte(productsTable.price, String(minPrice)));
  if (maxPrice) baseConditions.push(lte(productsTable.price, String(maxPrice)));
  if (minRating) baseConditions.push(gte(productsTable.rating, String(minRating)));

  let conditions: SQL[];
  if (useFullText) {
    const ftCondition = sql`to_tsvector('english', coalesce(${productsTable.name}, '') || ' ' || coalesce(${productsTable.description}, '')) @@ to_tsquery('english', ${tsQueryStr + ":*"})`;
    conditions = [...baseConditions, ftCondition];
  } else {
    conditions = [...baseConditions, ilike(productsTable.name, `%${trimmed}%`)];
  }

  let orderBy: SQL;
  if (sort === "price_asc") {
    orderBy = asc(productsTable.price);
  } else if (sort === "price_desc") {
    orderBy = desc(productsTable.price);
  } else if (sort === "rating") {
    orderBy = desc(productsTable.rating);
  } else if (sort === "newest") {
    orderBy = desc(productsTable.createdAt);
  } else if (useFullText) {
    orderBy = desc(
      sql`ts_rank(to_tsvector('english', coalesce(${productsTable.name}, '') || ' ' || coalesce(${productsTable.description}, '')), to_tsquery('english', ${tsQueryStr + ":*"}))`
    );
  } else {
    orderBy = desc(productsTable.reviewCount);
  }

  const [allProducts, countResult] = await Promise.all([
    db.select().from(productsTable).where(and(...conditions)).orderBy(orderBy).limit(perPage).offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(productsTable).where(and(...conditions)),
  ]);

  const total = countResult[0]?.total ?? 0;

  sendSuccess(res, {
    products: allProducts.map(mapProduct),
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
  });
});

/* ── GET /products — paginated list with filters ──────────────────────── */
router.get("/", async (req, res) => {
  const { category, search, type, minPrice, maxPrice, minRating, sort, vendor } = req.query;
  const page = Math.max(parseInt(req.query.page as string) || 1, 1);
  const perPage = Math.min(Math.max(parseInt(req.query.perPage as string) || 20, 1), 100);
  const offset = (page - 1) * perPage;

  if (type && typeof type === "string") {
    try {
      const s = await getPlatformSettings();
      const featureKey = `feature_${type}`;
      const enabled = (s[featureKey] ?? "on") === "on";
      if (!enabled) {
        sendError(res, `${type.charAt(0).toUpperCase() + type.slice(1)} service is currently disabled`, 503, "یہ سروس فی الحال بند ہے۔");
        return;
      }
    } catch {}
  }

  const conditions: SQL[] = [
    eq(productsTable.approvalStatus, "approved"),
    eq(productsTable.inStock, true),
  ];
  if (type) conditions.push(eq(productsTable.type, type as string));
  if (category) conditions.push(eq(productsTable.category, category as string));
  if (search) conditions.push(ilike(productsTable.name, `%${search}%`));
  if (vendor) conditions.push(eq(productsTable.vendorId, vendor as string));
  if (minPrice) conditions.push(gte(productsTable.price, String(minPrice)));
  if (maxPrice) conditions.push(lte(productsTable.price, String(maxPrice)));
  if (minRating) conditions.push(gte(productsTable.rating, String(minRating)));

  let orderBy: SQL;
  switch (sort) {
    case "price_asc": orderBy = asc(productsTable.price); break;
    case "price_desc": orderBy = desc(productsTable.price); break;
    case "rating": orderBy = desc(productsTable.rating); break;
    case "newest": orderBy = desc(productsTable.createdAt); break;
    case "popular": orderBy = desc(productsTable.reviewCount); break;
    default: orderBy = desc(productsTable.createdAt);
  }

  const [products, countResult] = await Promise.all([
    db.select().from(productsTable).where(and(...conditions)).orderBy(orderBy).limit(perPage).offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(productsTable).where(and(...conditions)),
  ]);

  const total = countResult[0]?.total ?? 0;

  sendSuccess(res, {
    products: products.map(mapProduct),
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
  });
});

/* ── GET /products/:id — product detail with variants + reviews summary ── */
router.get("/:id", async (req, res) => {
  const productId = req.params["id"]!;

  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId)).limit(1);
  if (!product) {
    sendNotFound(res, "Product not found", "پروڈکٹ نہیں ملی۔");
    return;
  }
  if (product.type) {
    try {
      const s = await getPlatformSettings();
      const featureKey = `feature_${product.type}`;
      if ((s[featureKey] ?? "on") !== "on") {
        sendError(res, `${product.type.charAt(0).toUpperCase() + product.type.slice(1)} service is currently disabled`, 503, "یہ سروس فی الحال بند ہے۔");
        return;
      }
    } catch {}
  }

  const [variants, reviewRows] = await Promise.all([
    db
      .select()
      .from(productVariantsTable)
      .where(and(
        eq(productVariantsTable.productId, productId),
        eq(productVariantsTable.inStock, true),
      ))
      .orderBy(asc(productVariantsTable.sortOrder)),

    db
      .select({
        rating: reviewsTable.rating,
        count: sql<number>`count(*)::int`,
      })
      .from(reviewsTable)
      .where(and(
        eq(reviewsTable.productId, productId),
        eq(reviewsTable.hidden, false),
        eq(reviewsTable.status, "visible"),
        sql`${reviewsTable.deletedAt} IS NULL`,
      ))
      .groupBy(reviewsTable.rating),
  ]);

  const breakdown: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let reviewTotal = 0;
  let reviewSum = 0;
  for (const row of reviewRows) {
    breakdown[row.rating] = row.count;
    reviewTotal += row.count;
    reviewSum += row.rating * row.count;
  }
  const reviewAverage = reviewTotal > 0 ? parseFloat((reviewSum / reviewTotal).toFixed(1)) : 0;

  sendSuccess(res, {
    ...mapProduct(product),
    variants: variants.map(v => ({
      ...v,
      price: parseFloat(v.price),
      originalPrice: v.originalPrice ? parseFloat(v.originalPrice) : undefined,
      attributes: v.attributes ? JSON.parse(v.attributes) : null,
    })),
    reviewsSummary: {
      average: reviewAverage,
      total: reviewTotal,
      breakdown,
    },
  });
});

const createProductSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  price: z.number().positive("Price must be positive"),
  category: z.string().min(1, "Category is required"),
  type: z.string().optional(),
  image: z.string().optional(),
  vendorId: z.string().optional(),
  unit: z.string().optional(),
});

router.post("/", adminAuth, validateBody(createProductSchema), async (req, res) => {
  const { name, description, price, category, type, image, vendorId, unit } = req.body;
  const [product] = await db.insert(productsTable).values({
    id: generateId(),
    name,
    description,
    price: price.toString(),
    category,
    type: type || "mart",
    image,
    vendorId,
    unit,
    inStock: true,
  }).returning();
  sendCreated(res, {
    ...product!,
    price: parseFloat(product!.price),
  });
});

export default router;
