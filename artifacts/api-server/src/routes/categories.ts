import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { productsTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getPlatformSettings } from "./admin.js";

const router: IRouter = Router();

const MART_CATEGORIES = [
  { id: "fruits", name: "Fruits & Veg", icon: "leaf-outline", type: "mart" },
  { id: "meat", name: "Meat & Fish", icon: "fish-outline", type: "mart" },
  { id: "dairy", name: "Dairy & Eggs", icon: "egg-outline", type: "mart" },
  { id: "bakery", name: "Bakery", icon: "cafe-outline", type: "mart" },
  { id: "household", name: "Household", icon: "home-outline", type: "mart" },
  { id: "beverages", name: "Beverages", icon: "wine-outline", type: "mart" },
  { id: "snacks", name: "Snacks", icon: "pizza-outline", type: "mart" },
  { id: "personal", name: "Personal Care", icon: "heart-outline", type: "mart" },
];

const FOOD_CATEGORIES = [
  { id: "restaurants", name: "Restaurants", icon: "restaurant-outline", type: "food" },
  { id: "fast-food", name: "Fast Food", icon: "fast-food-outline", type: "food" },
  { id: "desi", name: "Desi Food", icon: "flame-outline", type: "food" },
  { id: "chinese", name: "Chinese", icon: "nutrition-outline", type: "food" },
  { id: "pizza", name: "Pizza", icon: "pizza-outline", type: "food" },
  { id: "desserts", name: "Desserts", icon: "ice-cream-outline", type: "food" },
];

router.get("/", async (req, res) => {
  const type = req.query["type"] as string;

  if (type && (type === "mart" || type === "food")) {
    try {
      const s = await getPlatformSettings();
      const featureKey = `feature_${type}`;
      if ((s[featureKey] ?? "on") !== "on") {
        res.json({ categories: [] });
        return;
      }
    } catch {}
  }

  let categories = type === "food" ? FOOD_CATEGORIES : type === "mart" ? MART_CATEGORIES : [...MART_CATEGORIES, ...FOOD_CATEGORIES];

  const countRows = await db
    .select({
      category: productsTable.category,
      count: sql<number>`count(*)::int`,
    })
    .from(productsTable)
    .where(
      and(
        eq(productsTable.inStock, true),
        eq(productsTable.approvalStatus, "approved"),
      )
    )
    .groupBy(productsTable.category);

  const countMap = new Map(countRows.map((r) => [r.category, r.count]));

  res.json({
    categories: categories.map((c) => ({
      ...c,
      productCount: countMap.get(c.id) ?? 0,
    })),
  });
});

export default router;
