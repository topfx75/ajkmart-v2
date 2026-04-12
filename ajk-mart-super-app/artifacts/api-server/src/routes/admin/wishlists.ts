import { Router } from "express";
import { db } from "@workspace/db";
import { wishlistTable, productsTable, usersTable } from "@workspace/db/schema";
import { eq, desc, count, sql } from "drizzle-orm";
import { sendSuccess, sendNotFound } from "../../lib/response.js";

const router = Router();

router.get("/wishlists/analytics", async (_req, res) => {
  const [totalResult] = await db.select({ total: count() }).from(wishlistTable);
  const totalItems = Number(totalResult?.total ?? 0);

  const [uniqueUsersResult] = await db.select({
    total: sql<number>`COUNT(DISTINCT ${wishlistTable.userId})`,
  }).from(wishlistTable);
  const uniqueUsers = Number(uniqueUsersResult?.total ?? 0);

  const [uniqueProductsResult] = await db.select({
    total: sql<number>`COUNT(DISTINCT ${wishlistTable.productId})`,
  }).from(wishlistTable);
  const uniqueProducts = Number(uniqueProductsResult?.total ?? 0);

  const mostWishlisted = await db.select({
    productId: wishlistTable.productId,
    wishlistCount: count(),
    productName: productsTable.name,
    productImage: productsTable.image,
    productPrice: productsTable.price,
  })
    .from(wishlistTable)
    .leftJoin(productsTable, eq(wishlistTable.productId, productsTable.id))
    .groupBy(wishlistTable.productId, productsTable.name, productsTable.image, productsTable.price)
    .orderBy(desc(count()))
    .limit(20);

  const recentActivity = await db.select({
    id: wishlistTable.id,
    userId: wishlistTable.userId,
    productId: wishlistTable.productId,
    createdAt: wishlistTable.createdAt,
    userName: usersTable.name,
    userPhone: usersTable.phone,
    productName: productsTable.name,
  })
    .from(wishlistTable)
    .leftJoin(usersTable, eq(wishlistTable.userId, usersTable.id))
    .leftJoin(productsTable, eq(wishlistTable.productId, productsTable.id))
    .orderBy(desc(wishlistTable.createdAt))
    .limit(20);

  const dailyTrend = await db.select({
    date: sql<string>`DATE(${wishlistTable.createdAt})`.as("date"),
    count: count(),
  })
    .from(wishlistTable)
    .where(sql`${wishlistTable.createdAt} >= NOW() - INTERVAL '30 days'`)
    .groupBy(sql`DATE(${wishlistTable.createdAt})`)
    .orderBy(sql`DATE(${wishlistTable.createdAt})`);

  sendSuccess(res, {
    totalItems,
    uniqueUsers,
    uniqueProducts,
    dailyTrend: dailyTrend.map(d => ({ date: d.date, count: Number(d.count) })),
    mostWishlisted: mostWishlisted.map(m => ({
      productId: m.productId,
      count: Number(m.wishlistCount),
      name: m.productName,
      image: m.productImage,
      price: m.productPrice ? parseFloat(m.productPrice) : null,
    })),
    recentActivity: recentActivity.map(a => ({
      id: a.id,
      userId: a.userId,
      productId: a.productId,
      createdAt: a.createdAt.toISOString(),
      userName: a.userName,
      userPhone: a.userPhone,
      productName: a.productName,
    })),
  });
});

router.get("/wishlists/user/:userId", async (req, res) => {
  const userId = req.params["userId"]!;
  const page = Math.max(1, parseInt(req.query?.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit as string) || 20));
  const offset = (page - 1) * limit;

  const [user] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { sendNotFound(res, "User not found"); return; }

  const [totalResult] = await db.select({ total: count() }).from(wishlistTable).where(eq(wishlistTable.userId, userId));
  const total = Number(totalResult?.total ?? 0);

  const items = await db.select({
    id: wishlistTable.id,
    productId: wishlistTable.productId,
    createdAt: wishlistTable.createdAt,
    productName: productsTable.name,
    productImage: productsTable.image,
    productPrice: productsTable.price,
    productCategory: productsTable.category,
  })
    .from(wishlistTable)
    .leftJoin(productsTable, eq(wishlistTable.productId, productsTable.id))
    .where(eq(wishlistTable.userId, userId))
    .orderBy(desc(wishlistTable.createdAt))
    .limit(limit)
    .offset(offset);

  sendSuccess(res, {
    userId,
    userName: user.name,
    items: items.map(i => ({
      id: i.id,
      productId: i.productId,
      createdAt: i.createdAt.toISOString(),
      name: i.productName,
      image: i.productImage,
      price: i.productPrice ? parseFloat(i.productPrice) : null,
      category: i.productCategory,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.delete("/wishlists/user/:userId", async (req, res) => {
  const userId = req.params["userId"]!;
  const deleted = await db.delete(wishlistTable).where(eq(wishlistTable.userId, userId)).returning({ id: wishlistTable.id });
  sendSuccess(res, { cleared: deleted.length });
});

export default router;
