import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { productsTable, productVariantsTable, flashDealsTable } from "@workspace/db/schema";
import { eq, ilike, and, SQL, gte, lte, gt, desc, asc, sql, isNotNull } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { adminAuth, getPlatformSettings } from "./admin.js";

const router: IRouter = Router();

router.get("/flash-deals", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
  const now = new Date();

  const conditions: SQL[] = [
    eq(productsTable.approvalStatus, "approved"),
    eq(productsTable.inStock, true),
    isNotNull(productsTable.originalPrice),
    gt(productsTable.originalPrice, productsTable.price),
    isNotNull(productsTable.dealExpiresAt),
    gt(productsTable.dealExpiresAt, now),
  ];

  const products = await db.select().from(productsTable)
    .where(and(...conditions))
    .orderBy(asc(productsTable.dealExpiresAt))
    .limit(limit);

  const activeDeals = await db.select({
    productId: flashDealsTable.productId,
    dealStock: flashDealsTable.dealStock,
    soldCount: flashDealsTable.soldCount,
  }).from(flashDealsTable).where(
    and(
      eq(flashDealsTable.isActive, true),
      lte(flashDealsTable.startTime, now),
      gte(flashDealsTable.endTime, now),
    )
  );
  const dealMap = new Map(activeDeals.map(d => [d.productId, d]));

  res.json({
    products: products.map(p => {
      const price = parseFloat(p.price);
      const origPrice = p.originalPrice ? parseFloat(p.originalPrice) : price;
      const discount = origPrice > price ? Math.round(((origPrice - price) / origPrice) * 100) : 0;
      const dealInfo = dealMap.get(p.id);
      return {
        ...p,
        price,
        originalPrice: origPrice,
        rating: p.rating ? parseFloat(p.rating) : 4.0,
        discountPercent: discount,
        dealExpiresAt: p.dealExpiresAt!.toISOString(),
        dealStock: dealInfo?.dealStock ?? null,
        soldCount: dealInfo?.soldCount ?? 0,
      };
    }),
    total: products.length,
  });
});

router.get("/search", async (req, res) => {
  const { q, type, sort, minPrice, maxPrice, minRating, category } = req.query;
  const page = Math.max(parseInt(req.query.page as string) || 1, 1);
  const perPage = Math.min(Math.max(parseInt(req.query.perPage as string) || 20, 1), 50);
  const offset = (page - 1) * perPage;

  if (!q || typeof q !== "string" || !q.trim()) {
    res.json({ products: [], total: 0, page, perPage, totalPages: 0 });
    return;
  }

  const conditions: SQL[] = [
    eq(productsTable.approvalStatus, "approved"),
    eq(productsTable.inStock, true),
    ilike(productsTable.name, `%${q.trim()}%`),
  ];
  if (type && typeof type === "string") conditions.push(eq(productsTable.type, type));
  if (category && typeof category === "string") conditions.push(eq(productsTable.category, category));
  if (minPrice) conditions.push(gte(productsTable.price, String(minPrice)));
  if (maxPrice) conditions.push(lte(productsTable.price, String(maxPrice)));
  if (minRating) conditions.push(gte(productsTable.rating, String(minRating)));

  let orderBy;
  switch (sort) {
    case "price_asc": orderBy = asc(productsTable.price); break;
    case "price_desc": orderBy = desc(productsTable.price); break;
    case "rating": orderBy = desc(productsTable.rating); break;
    case "newest": orderBy = desc(productsTable.createdAt); break;
    default: orderBy = desc(productsTable.reviewCount);
  }

  const [allProducts, countResult] = await Promise.all([
    db.select().from(productsTable).where(and(...conditions)).orderBy(orderBy).limit(perPage).offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(productsTable).where(and(...conditions)),
  ]);

  const total = countResult[0]?.total ?? 0;

  res.json({
    products: allProducts.map(p => ({
      ...p,
      price: parseFloat(p.price),
      originalPrice: p.originalPrice ? parseFloat(p.originalPrice) : undefined,
      rating: p.rating ? parseFloat(p.rating) : 4.0,
    })),
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
  });
});

router.get("/", async (req, res) => {
  const { category, search, type, minPrice, maxPrice, minRating, sort, vendor } = req.query;

  if (type && typeof type === "string") {
    try {
      const s = await getPlatformSettings();
      const featureKey = `feature_${type}`;
      const enabled = (s[featureKey] ?? "on") === "on";
      if (!enabled) {
        res.status(503).json({ error: `${type.charAt(0).toUpperCase() + type.slice(1)} service is currently disabled`, products: [], total: 0 });
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

  let orderBy;
  switch (sort) {
    case "price_asc": orderBy = asc(productsTable.price); break;
    case "price_desc": orderBy = desc(productsTable.price); break;
    case "rating": orderBy = desc(productsTable.rating); break;
    case "newest": orderBy = desc(productsTable.createdAt); break;
    case "popular": orderBy = desc(productsTable.reviewCount); break;
    default: orderBy = desc(productsTable.createdAt);
  }

  const products = await db.select().from(productsTable).where(and(...conditions)).orderBy(orderBy);
  res.json({
    products: products.map(p => ({
      ...p,
      price: parseFloat(p.price),
      originalPrice: p.originalPrice ? parseFloat(p.originalPrice) : undefined,
      rating: p.rating ? parseFloat(p.rating) : 4.0,
    })),
    total: products.length,
  });
});

router.get("/:id", async (req, res) => {
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, req.params["id"]!)).limit(1);
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  if (product.type) {
    try {
      const s = await getPlatformSettings();
      const featureKey = `feature_${product.type}`;
      if ((s[featureKey] ?? "on") !== "on") {
        res.status(503).json({ error: `${product.type.charAt(0).toUpperCase() + product.type.slice(1)} service is currently disabled` });
        return;
      }
    } catch {}
  }

  const variants = await db
    .select()
    .from(productVariantsTable)
    .where(and(
      eq(productVariantsTable.productId, product.id),
      eq(productVariantsTable.inStock, true),
    ))
    .orderBy(asc(productVariantsTable.sortOrder));

  res.json({
    ...product,
    price: parseFloat(product.price),
    originalPrice: product.originalPrice ? parseFloat(product.originalPrice) : undefined,
    rating: product.rating ? parseFloat(product.rating) : 4.0,
    variants: variants.map(v => ({
      ...v,
      price: parseFloat(v.price),
      originalPrice: v.originalPrice ? parseFloat(v.originalPrice) : undefined,
      attributes: v.attributes ? JSON.parse(v.attributes) : null,
    })),
  });
});

router.post("/", adminAuth, async (req, res) => {
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
  res.status(201).json({
    ...product!,
    price: parseFloat(product!.price),
  });
});

export default router;
