import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { wishlistTable, productsTable } from "@workspace/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { customerAuth } from "../middleware/security.js";

const router: IRouter = Router();

router.use(customerAuth);

router.post("/", async (req, res) => {
  const userId = req.customerId!;
  const { productId } = req.body;

  if (!productId || typeof productId !== "string") {
    res.status(400).json({ error: "productId is required" });
    return;
  }

  const [product] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);

  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const existing = await db
    .select({ id: wishlistTable.id })
    .from(wishlistTable)
    .where(and(eq(wishlistTable.userId, userId), eq(wishlistTable.productId, productId)))
    .limit(1);

  if (existing.length > 0) {
    res.json({ success: true, alreadyExists: true, id: existing[0]!.id });
    return;
  }

  const [entry] = await db.insert(wishlistTable).values({
    id: generateId(),
    userId,
    productId,
  }).returning();

  res.status(201).json({ success: true, id: entry!.id });
});

router.delete("/:productId", async (req, res) => {
  const userId = req.customerId!;
  const productId = req.params["productId"]!;

  const deleted = await db
    .delete(wishlistTable)
    .where(and(eq(wishlistTable.userId, userId), eq(wishlistTable.productId, productId)))
    .returning();

  if (deleted.length === 0) {
    res.status(404).json({ error: "Item not in wishlist" });
    return;
  }

  res.json({ success: true });
});

router.get("/", async (req, res) => {
  const userId = req.customerId!;

  const items = await db
    .select({
      id: wishlistTable.id,
      productId: wishlistTable.productId,
      createdAt: wishlistTable.createdAt,
    })
    .from(wishlistTable)
    .where(eq(wishlistTable.userId, userId))
    .orderBy(desc(wishlistTable.createdAt));

  if (items.length === 0) {
    res.json({ items: [], total: 0 });
    return;
  }

  const productIds = items.map(i => i.productId);
  const products = await db
    .select()
    .from(productsTable)
    .where(inArray(productsTable.id, productIds));

  const productMap = new Map(products.map(p => [p.id, p]));

  const enriched = items
    .map(item => {
      const p = productMap.get(item.productId);
      if (!p) return null;
      return {
        id: item.id,
        productId: item.productId,
        createdAt: item.createdAt,
        product: {
          id: p.id,
          name: p.name,
          price: parseFloat(p.price),
          originalPrice: p.originalPrice ? parseFloat(p.originalPrice) : undefined,
          image: p.image,
          category: p.category,
          type: p.type,
          rating: p.rating ? parseFloat(p.rating) : undefined,
          reviewCount: p.reviewCount,
          inStock: p.inStock,
          unit: p.unit,
          vendorName: p.vendorName,
        },
      };
    })
    .filter(Boolean);

  res.json({ items: enriched, total: enriched.length });
});

router.get("/check/:productId", async (req, res) => {
  const userId = req.customerId!;
  const productId = req.params["productId"]!;

  const existing = await db
    .select({ id: wishlistTable.id })
    .from(wishlistTable)
    .where(and(eq(wishlistTable.userId, userId), eq(wishlistTable.productId, productId)))
    .limit(1);

  res.json({ inWishlist: existing.length > 0 });
});

export default router;
