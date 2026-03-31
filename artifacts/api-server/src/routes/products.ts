import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { productsTable } from "@workspace/db/schema";
import { eq, ilike, and, SQL } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { adminAuth, getPlatformSettings } from "./admin.js";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  const { category, search, type } = req.query;

  // Feature flag check: if a specific type is requested, verify that service is enabled
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

  /* Public endpoint: only serve approved, in-stock products */
  const conditions: SQL[] = [
    eq(productsTable.approvalStatus, "approved"),
    eq(productsTable.inStock, true),
  ];
  if (type) conditions.push(eq(productsTable.type, type as string));
  if (category) conditions.push(eq(productsTable.category, category as string));
  if (search) conditions.push(ilike(productsTable.name, `%${search}%`));
  const products = await db.select().from(productsTable).where(and(...conditions));
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
  // Feature flag check: verify the product's service type is enabled
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
  res.json({
    ...product,
    price: parseFloat(product.price),
    originalPrice: product.originalPrice ? parseFloat(product.originalPrice) : undefined,
    rating: product.rating ? parseFloat(product.rating) : 4.0,
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
