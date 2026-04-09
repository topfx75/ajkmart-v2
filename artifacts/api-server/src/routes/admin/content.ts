import { Router } from "express";
import { z } from "zod";
import path from "path";
import fs from "fs";
import { db } from "@workspace/db";
import {
  usersTable,
  walletTransactionsTable,
  notificationsTable,
  ordersTable, productsTable, flashDealsTable, promoCodesTable, categoriesTable, bannersTable,
} from "@workspace/db/schema";
import { eq, desc, count, sum, and, gte, lte, sql, or, ilike, asc, isNull, isNotNull, avg, ne, inArray } from "drizzle-orm";
import {
  stripUser, generateId, getUserLanguage, t,
  getPlatformSettings, adminAuth, getAdminSecret,
  sendUserNotification, logger,
  ORDER_NOTIF_KEYS, RIDE_NOTIF_KEYS, PHARMACY_NOTIF_KEYS, PARCEL_NOTIF_KEYS,
  checkAdminLoginLockout, recordAdminLoginFailure, resetAdminLoginAttempts,
  addAuditEntry, addSecurityEvent, getClientIp,
  signAdminJwt, verifyAdminJwt, invalidateSettingsCache, getCachedSettings,
  ADMIN_TOKEN_TTL_HRS, verifyTotpToken, verifyAdminSecret,
  ensureDefaultRideServices, ensureDefaultLocations, formatSvc,
  type AdminRequest, type TranslationKey,
} from "../admin-shared.js";
import { sendSuccess, sendCreated, sendError, sendNotFound, sendValidationError } from "../../lib/response.js";
import { validateBody, validateQuery, validateParams } from "../../middleware/validate.js";
import { stripHtml } from "../../lib/sanitize.js";

const idParamSchema = z.object({ id: z.string().min(1) }).strip();

const productsQuerySchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
}).strip();

const createProductSchema = z.object({
  name: z.string().min(1, "name is required").transform(stripHtml),
  description: z.string().optional().transform(v => (v ? stripHtml(v) : v)),
  price: z.number({ required_error: "price is required" }).positive(),
  originalPrice: z.number().positive().optional(),
  category: z.string().min(1, "category is required"),
  type: z.string().optional(),
  unit: z.string().optional(),
  vendorName: z.string().optional(),
  inStock: z.boolean().optional(),
  deliveryTime: z.string().optional(),
  image: z.string().optional(),
}).strip();

const patchProductSchema = z.object({
  name: z.string().optional().transform(v => (v ? stripHtml(v) : v)),
  description: z.string().optional().transform(v => (v ? stripHtml(v) : v)),
  price: z.number().positive().optional(),
  originalPrice: z.number().positive().nullable().optional(),
  category: z.string().optional(),
  unit: z.string().nullable().optional(),
  inStock: z.boolean().optional(),
  vendorName: z.string().optional(),
  deliveryTime: z.string().optional(),
  image: z.string().nullable().optional(),
}).strip();

const approveProductSchema = z.object({
  note: z.string().optional(),
}).strip();

const rejectProductSchema = z.object({
  reason: z.string().min(1, "reason is required"),
}).strip();

const broadcastSchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  titleKey: z.string().optional(),
  bodyKey: z.string().optional(),
  type: z.string().optional(),
  icon: z.string().optional(),
}).strip().refine(d => d.title || d.titleKey, { message: "title or titleKey required" })
  .refine(d => d.body || d.bodyKey, { message: "body or bodyKey required" });

const categoriesQuerySchema = z.object({
  type: z.string().optional(),
}).strip();

const createCategorySchema = z.object({
  name: z.string().min(1, "name is required"),
  type: z.string().min(1, "type is required"),
  icon: z.string().optional(),
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
}).strip();

const patchCategorySchema = z.object({
  name: z.string().optional(),
  icon: z.string().optional(),
  type: z.string().optional(),
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
}).strip();

const reorderItemsSchema = z.object({
  items: z.array(z.object({ id: z.string(), sortOrder: z.number().int() }).strip()),
}).strip();

const bannersQuerySchema = z.object({
  placement: z.string().optional(),
  status: z.string().optional(),
}).strip();

const createBannerSchema = z.object({
  title: z.string().min(1, "title is required"),
  subtitle: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  linkType: z.string().optional(),
  linkValue: z.string().nullable().optional(),
  targetService: z.string().nullable().optional(),
  placement: z.string().optional(),
  colorFrom: z.string().optional(),
  colorTo: z.string().optional(),
  icon: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
}).strip();

const patchBannerSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  linkType: z.string().optional(),
  linkValue: z.string().nullable().optional(),
  targetService: z.string().nullable().optional(),
  placement: z.string().optional(),
  colorFrom: z.string().optional(),
  colorTo: z.string().optional(),
  icon: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
}).strip();

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
}).strip();

const createFlashDealSchema = z.object({
  productId: z.string().min(1, "productId is required"),
  startTime: z.string().min(1, "startTime is required"),
  endTime: z.string().min(1, "endTime is required"),
  title: z.string().nullable().optional(),
  badge: z.string().optional(),
  discountPct: z.number().optional(),
  discountFlat: z.number().optional(),
  dealStock: z.number().int().nullable().optional(),
  isActive: z.boolean().optional(),
}).strip();

const patchFlashDealSchema = z.object({
  title: z.string().nullable().optional(),
  badge: z.string().optional(),
  discountPct: z.number().nullable().optional(),
  discountFlat: z.number().nullable().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  dealStock: z.number().int().nullable().optional(),
  isActive: z.boolean().optional(),
}).strip();

const createPromoCodeSchema = z.object({
  code: z.string().min(1, "code is required"),
  description: z.string().nullable().optional(),
  discountPct: z.number().optional(),
  discountFlat: z.number().optional(),
  minOrderAmount: z.number().optional(),
  maxDiscount: z.number().nullable().optional(),
  usageLimit: z.number().int().nullable().optional(),
  appliesTo: z.string().optional(),
  expiresAt: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
}).strip();

const patchPromoCodeSchema = z.object({
  code: z.string().optional(),
  description: z.string().nullable().optional(),
  discountPct: z.number().nullable().optional(),
  discountFlat: z.number().nullable().optional(),
  minOrderAmount: z.number().optional(),
  maxDiscount: z.number().nullable().optional(),
  usageLimit: z.number().int().nullable().optional(),
  appliesTo: z.string().optional(),
  expiresAt: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
}).strip();

const uploadSchema = z.object({
  base64: z.string().min(1, "base64 is required"),
  mimeType: z.string().min(1, "mimeType is required"),
}).strip();

const router = Router();
router.get("/products", validateQuery(productsQuerySchema), async (req, res) => {
  try {
    const search = (req.query?.search as string) ?? "";
    const category = (req.query?.category as string) ?? "";
    const page = Math.max(1, parseInt(req.query?.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit as string) || 50));
    const offset = (page - 1) * limit;

    const whereConditions: ReturnType<typeof and>[] = [];
    if (search) whereConditions.push(ilike(productsTable.name, `%${search}%`));
    if (category && category !== "all") whereConditions.push(eq(productsTable.category, category));
    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

    const [totalResult, products] = await Promise.all([
      db.select({ total: count() }).from(productsTable).where(whereClause),
      db.select().from(productsTable).where(whereClause).orderBy(desc(productsTable.createdAt)).limit(limit).offset(offset),
    ]);

    const total = Number(totalResult[0]?.total ?? 0);
    sendSuccess(res, {
      products: products.map(p => ({
        ...p,
        price: parseFloat(p.price),
        originalPrice: p.originalPrice ? parseFloat(p.originalPrice) : null,
        rating: p.rating ? parseFloat(p.rating) : null,
        createdAt: p.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (e) {
    logger.error({ err: e }, "[admin/content] products list error");
    sendError(res, "Failed to load products.", 500);
  }
});

router.get("/products/pending", validateQuery(productsQuerySchema), async (req, res) => {
  try {
    const search = (req.query?.search as string) ?? "";
    const category = (req.query?.category as string) ?? "";
    const page = Math.max(1, parseInt(req.query?.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit as string) || 50));
    const offset = (page - 1) * limit;

    const whereConditions: ReturnType<typeof and>[] = [eq(productsTable.approvalStatus, "pending")];
    if (search) whereConditions.push(ilike(productsTable.name, `%${search}%`));
    if (category && category !== "all") whereConditions.push(eq(productsTable.category, category));
    const whereClause = and(...whereConditions);

    const [totalResult, products] = await Promise.all([
      db.select({ total: count() }).from(productsTable).where(whereClause),
      db.select().from(productsTable).where(whereClause).orderBy(desc(productsTable.createdAt)).limit(limit).offset(offset),
    ]);

    const total = Number(totalResult[0]?.total ?? 0);
    sendSuccess(res, {
      products: products.map(p => ({
        ...p,
        price: parseFloat(p.price),
        originalPrice: p.originalPrice ? parseFloat(p.originalPrice) : null,
        rating: p.rating ? parseFloat(p.rating) : null,
        createdAt: p.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (e) {
    logger.error({ err: e }, "[admin/content] pending products error");
    sendError(res, "Failed to load pending products.", 500);
  }
});

router.patch("/products/:id/approve", validateParams(idParamSchema), validateBody(approveProductSchema), async (req, res) => {
  try {
    const { note } = req.body;
    const [product] = await db
      .update(productsTable)
      .set({ approvalStatus: "approved", inStock: true, updatedAt: new Date() })
      .where(eq(productsTable.id, req.params["id"]!))
      .returning();
    if (!product) { sendNotFound(res, "Product not found"); return; }
    if (product.vendorId && product.vendorId !== "ajkmart_system") {
      const [vendor] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, product.vendorId)).limit(1);
      if (vendor) {
        const vLang = await getUserLanguage(vendor.id);
        const vBody = note
          ? t("notifProductApprovedBodyNote", vLang).replace("{name}", product.name).replace("{note}", note)
          : t("notifProductApprovedBody", vLang).replace("{name}", product.name);
        await db.insert(notificationsTable).values({
          id: generateId(),
          userId: vendor.id,
          title: t("notifProductApproved", vLang),
          body: vBody,
          type: "system",
          icon: "checkmark-circle-outline",
        }).catch(() => {});
      }
    }
    sendSuccess(res, { ...product, price: parseFloat(product.price) });
  } catch (e) {
    logger.error({ err: e }, "[admin/content] product approve error");
    sendError(res, "Failed to approve product.", 500);
  }
});

router.patch("/products/:id/reject", validateParams(idParamSchema), validateBody(rejectProductSchema), async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) { sendValidationError(res, "reason is required"); return; }
    const [product] = await db
      .update(productsTable)
      .set({ approvalStatus: "rejected", inStock: false, updatedAt: new Date() })
      .where(eq(productsTable.id, req.params["id"]!))
      .returning();
    if (!product) { sendNotFound(res, "Product not found"); return; }
    if (product.vendorId && product.vendorId !== "ajkmart_system") {
      const [vendor] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, product.vendorId)).limit(1);
      if (vendor) {
        const vLang = await getUserLanguage(vendor.id);
        await db.insert(notificationsTable).values({
          id: generateId(),
          userId: vendor.id,
          title: t("notifProductRejected", vLang),
          body: t("notifProductRejectedBody", vLang).replace("{name}", product.name).replace("{reason}", reason),
          type: "system",
          icon: "close-circle-outline",
        }).catch(() => {});
      }
    }
    sendSuccess(res, { ...product, price: parseFloat(product.price) });
  } catch (e) {
    logger.error({ err: e }, "[admin/content] product reject error");
    sendError(res, "Failed to reject product.", 500);
  }
});

const SYSTEM_VENDOR_ID = "ajkmart_system";

async function ensureSystemVendor(): Promise<void> {
  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, SYSTEM_VENDOR_ID));
  if (existing.length === 0) {
    await db.insert(usersTable).values({
      id: SYSTEM_VENDOR_ID,
      phone: "+920000000000",
      name: "AJKMart System",
      role: "vendor",
      roles: "vendor",
      city: "Muzaffarabad",
      area: "System",
      phoneVerified: true,
      approvalStatus: "approved",
      isActive: true,
      walletBalance: "0",
    });
  }
}

router.post("/products", validateBody(createProductSchema), async (req, res) => {
  try {
    const { name, description, price, originalPrice, category, type, unit, vendorName, inStock, deliveryTime, image } = req.body;
    if (!name || !price || !category) {
      sendValidationError(res, "name, price, and category are required");
      return;
    }
    await ensureSystemVendor();
    const [product] = await db.insert(productsTable).values({
      id: generateId(),
      name,
      description: description || null,
      price: String(price),
      originalPrice: originalPrice ? String(originalPrice) : null,
      category,
      type: type || "mart",
      vendorId: SYSTEM_VENDOR_ID,
      vendorName: vendorName || "AJKMart Store",
      unit: unit || null,
      inStock: inStock !== false,
      deliveryTime: deliveryTime || "30-45 min",
      rating: "4.5",
      reviewCount: 0,
      image: image || null,
    }).returning();
    sendCreated(res, { ...product!, price: parseFloat(product!.price) });
  } catch (e) {
    logger.error({ err: e }, "[admin/content] product create error");
    sendError(res, "Failed to create product.", 500);
  }
});

router.patch("/products/:id", validateParams(idParamSchema), validateBody(patchProductSchema), async (req, res) => {
  try {
    const { name, description, price, originalPrice, category, unit, inStock, vendorName, deliveryTime, image } = req.body;
    const updates: Partial<typeof productsTable.$inferInsert> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (price !== undefined) updates.price = String(price);
    if (originalPrice !== undefined) updates.originalPrice = originalPrice ? String(originalPrice) : null;
    if (category !== undefined) updates.category = category;
    if (unit !== undefined) updates.unit = unit;
    if (inStock !== undefined) updates.inStock = inStock;
    if (vendorName !== undefined) updates.vendorName = vendorName;
    if (deliveryTime !== undefined) updates.deliveryTime = deliveryTime;
    if (image !== undefined) updates.image = image;

    const [product] = await db
      .update(productsTable)
      .set(updates)
      .where(eq(productsTable.id, req.params["id"]!))
      .returning();
    if (!product) { sendNotFound(res, "Product not found"); return; }
    sendSuccess(res, { ...product, price: parseFloat(product.price) });
  } catch (e) {
    logger.error({ err: e }, "[admin/content] product update error");
    sendError(res, "Failed to update product.", 500);
  }
});

router.delete("/products/:id", validateParams(idParamSchema), async (req, res) => {
  try {
    await db.delete(productsTable).where(eq(productsTable.id, req.params["id"]!));
    sendSuccess(res, { success: true });
  } catch (e) {
    logger.error({ err: e }, "[admin/content] product delete error");
    sendError(res, "Failed to delete product.", 500);
  }
});

/* ── Broadcast Notification ── */
router.post("/broadcast", validateBody(broadcastSchema), async (req, res) => {
  const { title, body, titleKey, bodyKey, type = "system", icon = "notifications-outline" } = req.body;
  if (!title && !titleKey) { sendValidationError(res, "title or titleKey required"); return; }
  if (!body && !bodyKey) { sendValidationError(res, "body or bodyKey required"); return; }

  const users = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.isActive, true));
  let sent = 0;
  for (const user of users) {
    let localTitle = title as string;
    let localBody = body as string;
    if (titleKey || bodyKey) {
      const lang = await getUserLanguage(user.id);
      if (titleKey) localTitle = t(titleKey as TranslationKey, lang);
      if (bodyKey) localBody = t(bodyKey as TranslationKey, lang);
    }
    await db.insert(notificationsTable).values({
      id: generateId(),
      userId: user.id,
      title: localTitle,
      body: localBody,
      type,
      icon,
    }).catch(() => {});
    sent++;
  }
  sendSuccess(res, { success: true, sent });
});

/* ── Wallet Transactions ── */
router.get("/categories/tree", validateQuery(categoriesQuerySchema), async (req, res) => {
  try {
    const type = req.query["type"] as string;
    const conditions = [];
    if (type) conditions.push(eq(categoriesTable.type, type));

    const allCats = await db
      .select()
      .from(categoriesTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(categoriesTable.sortOrder));

    const topLevel = allCats.filter(c => !c.parentId);
    const childrenMap = new Map<string, typeof allCats>();
    for (const c of allCats) {
      if (c.parentId) {
        const arr = childrenMap.get(c.parentId) || [];
        arr.push(c);
        childrenMap.set(c.parentId, arr);
      }
    }

    const tree = topLevel.map(c => ({
      ...c,
      children: (childrenMap.get(c.id) || []),
    }));

    sendSuccess(res, { categories: tree });
  } catch (e) {
    logger.error({ err: e }, "[admin/content] categories tree error");
    sendError(res, "Failed to load category tree.", 500);
  }
});

router.post("/categories", validateBody(createCategorySchema), async (req, res) => {
  try {
    const { name, icon, type, parentId, sortOrder, isActive } = req.body;
    if (!name || !type) {
      sendValidationError(res, "name and type are required");
      return;
    }

    const id = generateId();
    const [category] = await db.insert(categoriesTable).values({
      id,
      name,
      icon: icon || "grid-outline",
      type,
      parentId: parentId || null,
      sortOrder: sortOrder ?? 0,
      isActive: isActive !== false,
    }).returning();

    sendCreated(res, category);
  } catch (e) {
    logger.error({ err: e }, "[admin/content] category create error");
    sendError(res, "Failed to create category.", 500);
  }
});

router.patch("/categories/:id", validateParams(idParamSchema), validateBody(patchCategorySchema), async (req, res) => {
  try {
    const { name, icon, type, parentId, sortOrder, isActive } = req.body;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (icon !== undefined) updates.icon = icon;
    if (type !== undefined) updates.type = type;
    if (parentId !== undefined) updates.parentId = parentId || null;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;
    if (isActive !== undefined) updates.isActive = isActive;

    const [updated] = await db
      .update(categoriesTable)
      .set(updates)
      .where(eq(categoriesTable.id, req.params["id"]!))
      .returning();

    if (!updated) {
      sendNotFound(res, "Category not found");
      return;
    }

    sendSuccess(res, updated);
  } catch (e) {
    logger.error({ err: e }, "[admin/content] category update error");
    sendError(res, "Failed to update category.", 500);
  }
});

router.delete("/categories/:id", validateParams(idParamSchema), async (req, res) => {
  try {
    const id = req.params["id"]!;

    await db
      .update(categoriesTable)
      .set({ parentId: null })
      .where(eq(categoriesTable.parentId, id));

    const [deleted] = await db
      .delete(categoriesTable)
      .where(eq(categoriesTable.id, id))
      .returning();

    if (!deleted) {
      sendNotFound(res, "Category not found");
      return;
    }

    sendSuccess(res, { success: true });
  } catch (e) {
    logger.error({ err: e }, "[admin/content] category delete error");
    sendError(res, "Failed to delete category.", 500);
  }
});

router.post("/categories/reorder", validateBody(reorderItemsSchema), async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      sendValidationError(res, "items array required");
      return;
    }

    for (const item of items) {
      if (item.id && typeof item.sortOrder === "number") {
        await db
          .update(categoriesTable)
          .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
          .where(eq(categoriesTable.id, item.id));
      }
    }

    sendSuccess(res, { success: true });
  } catch (e) {
    logger.error({ err: e }, "[admin/content] categories reorder error");
    sendError(res, "Failed to reorder categories.", 500);
  }
});

/* ── Banners ── */
router.get("/banners", validateQuery(bannersQuerySchema), async (req, res) => {
  try {
    const placement = req.query["placement"] as string | undefined;
    const status = req.query["status"] as string | undefined;

    const banners = await db
      .select()
      .from(bannersTable)
      .orderBy(asc(bannersTable.sortOrder), desc(bannersTable.createdAt));
    const now = new Date();
    let mapped = banners.map(b => ({
      ...b,
      startDate: b.startDate ? b.startDate.toISOString() : null,
      endDate: b.endDate ? b.endDate.toISOString() : null,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
      status: (!b.isActive ? "inactive"
            : b.startDate && now < b.startDate ? "scheduled"
            : b.endDate && now > b.endDate ? "expired"
            : "active") as "active" | "scheduled" | "expired" | "inactive",
    }));
    if (placement) mapped = mapped.filter(b => b.placement === placement);
    if (status) mapped = mapped.filter(b => b.status === status);
    sendSuccess(res, { banners: mapped, total: mapped.length });
  } catch (e) {
    logger.error({ err: e }, "[admin/content] banners list error");
    sendError(res, "Failed to load banners.", 500);
  }
});

router.post("/banners", validateBody(createBannerSchema), async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    if (!body.title) {
      sendValidationError(res, "title is required"); return;
    }
    const [banner] = await db.insert(bannersTable).values({
      id: generateId(),
      title: body.title as string,
      subtitle: (body.subtitle as string) || null,
      imageUrl: (body.imageUrl as string) || null,
      linkType: (body.linkType as string) || "none",
      linkValue: (body.linkValue as string) || null,
      targetService: (body.targetService as string) || null,
      placement: (body.placement as string) || "home",
      colorFrom: (body.colorFrom as string) || "#7C3AED",
      colorTo: (body.colorTo as string) || "#4F46E5",
      icon: (body.icon as string) || null,
      sortOrder: (body.sortOrder as number) ?? 0,
      isActive: body.isActive !== false,
      startDate: body.startDate ? new Date(body.startDate as string) : null,
      endDate: body.endDate ? new Date(body.endDate as string) : null,
    }).returning();
    sendCreated(res, banner);
  } catch (e) {
    logger.error({ err: e }, "[admin/content] banner create error");
    sendError(res, "Failed to create banner.", 500);
  }
});

router.patch("/banners/reorder", validateBody(reorderItemsSchema), async (req, res) => {
  try {
    const { items } = req.body as { items: { id: string; sortOrder: number }[] };
    if (!Array.isArray(items)) {
      sendValidationError(res, "items array required"); return;
    }
    for (const item of items) {
      await db.update(bannersTable).set({ sortOrder: item.sortOrder, updatedAt: new Date() }).where(eq(bannersTable.id, item.id));
    }
    sendSuccess(res, { success: true });
  } catch (e) {
    logger.error({ err: e }, "[admin/content] banners reorder error");
    sendError(res, "Failed to reorder banners.", 500);
  }
});

const bannerUpdateMiddleware = [validateParams(idParamSchema), validateBody(patchBannerSchema)];
const bannerUpdateHandler = async (req: import("express").Request, res: import("express").Response) => {
  try {
    const bannerId = req.params["id"]!;
    const body = req.body as Record<string, unknown>;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const fields = ["title", "subtitle", "imageUrl", "linkType", "linkValue", "targetService", "placement", "colorFrom", "colorTo", "icon", "sortOrder", "isActive"];
    for (const f of fields) {
      if (body[f] !== undefined) updates[f] = body[f];
    }
    if (body.startDate !== undefined) updates.startDate = body.startDate ? new Date(body.startDate as string) : null;
    if (body.endDate !== undefined) updates.endDate = body.endDate ? new Date(body.endDate as string) : null;

    const [updated] = await db.update(bannersTable).set(updates).where(eq(bannersTable.id, bannerId)).returning();
    if (!updated) {
      sendNotFound(res, "Banner not found"); return;
    }
    sendSuccess(res, updated);
  } catch (e) {
    logger.error({ err: e }, "[admin/content] banner update error");
    sendError(res, "Failed to update banner.", 500);
  }
};
router.patch("/banners/:id", ...bannerUpdateMiddleware, bannerUpdateHandler);
router.put("/banners/:id", ...bannerUpdateMiddleware, bannerUpdateHandler);

router.delete("/banners/:id", validateParams(idParamSchema), async (req, res) => {
  try {
    const bannerId = req.params["id"]!;
    const [deleted] = await db.delete(bannersTable).where(eq(bannersTable.id, bannerId)).returning();
    if (!deleted) {
      sendNotFound(res, "Banner not found"); return;
    }
    sendSuccess(res, { success: true, id: bannerId });
  } catch (e) {
    logger.error({ err: e }, "[admin/content] banner delete error");
    sendError(res, "Failed to delete banner.", 500);
  }
});

/* ── Flash Deals ── */
router.get("/flash-deals", validateQuery(paginationQuerySchema), async (req, res) => {
  const page = Math.max(1, parseInt(req.query?.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit as string) || 50));
  const offset = (page - 1) * limit;

  const [totalResult, deals] = await Promise.all([
    db.select({ total: count() }).from(flashDealsTable),
    db.select().from(flashDealsTable).orderBy(desc(flashDealsTable.createdAt)).limit(limit).offset(offset),
  ]);

  const total = Number(totalResult[0]?.total ?? 0);

  const dealProductIds = deals.map(d => d.productId);
  const products = dealProductIds.length > 0
    ? await db.select({ id: productsTable.id, name: productsTable.name, price: productsTable.price, image: productsTable.image, category: productsTable.category }).from(productsTable).where(inArray(productsTable.id, dealProductIds))
    : [];
  const productMap = Object.fromEntries(products.map(p => [p.id, p]));
  const now = new Date();
  sendSuccess(res, {
    deals: deals.map(d => ({
      ...d,
      discountPct:  d.discountPct  ? parseFloat(String(d.discountPct))  : null,
      discountFlat: d.discountFlat ? parseFloat(String(d.discountFlat)) : null,
      startTime: d.startTime.toISOString(),
      endTime:   d.endTime.toISOString(),
      createdAt: d.createdAt.toISOString(),
      product:   productMap[d.productId] ?? null,
      status: !d.isActive ? "inactive"
            : now < d.startTime ? "scheduled"
            : now > d.endTime   ? "expired"
            : d.dealStock !== null && d.soldCount >= d.dealStock ? "sold_out"
            : "live",
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.post("/flash-deals", validateBody(createFlashDealSchema), async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!body.productId || !body.startTime || !body.endTime) {
    sendValidationError(res, "productId, startTime, endTime required"); return;
  }
  const [deal] = await db.insert(flashDealsTable).values({
    id:           generateId(),
    productId:    body.productId as string,
    title:        (body.title as string)    || null,
    badge:        (body.badge as string)    || "FLASH",
    discountPct:  body.discountPct  ? String(body.discountPct)  : null,
    discountFlat: body.discountFlat ? String(body.discountFlat) : null,
    startTime:    new Date(body.startTime as string),
    endTime:      new Date(body.endTime as string),
    dealStock:    body.dealStock  ? Number(body.dealStock)  : null,
    isActive:     body.isActive !== false,
  }).returning();
  sendCreated(res, deal);
});

router.patch("/flash-deals/:id", validateParams(idParamSchema), validateBody(patchFlashDealSchema), async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  if (body.title        !== undefined) updates.title        = body.title;
  if (body.badge        !== undefined) updates.badge        = body.badge;
  if (body.discountPct  !== undefined) updates.discountPct  = body.discountPct  ? String(body.discountPct)  : null;
  if (body.discountFlat !== undefined) updates.discountFlat = body.discountFlat ? String(body.discountFlat) : null;
  if (body.startTime    !== undefined) updates.startTime    = new Date(body.startTime as string);
  if (body.endTime      !== undefined) updates.endTime      = new Date(body.endTime as string);
  if (body.dealStock    !== undefined) updates.dealStock    = body.dealStock ? Number(body.dealStock) : null;
  if (body.isActive     !== undefined) updates.isActive     = body.isActive;
  const [deal] = await db.update(flashDealsTable).set(updates).where(eq(flashDealsTable.id, req.params["id"]!)).returning();
  if (!deal) { sendNotFound(res, "Deal not found"); return; }
  sendSuccess(res, deal);
});

router.delete("/flash-deals/:id", validateParams(idParamSchema), async (req, res) => {
  await db.delete(flashDealsTable).where(eq(flashDealsTable.id, req.params["id"]!));
  sendSuccess(res, { success: true });
});

/* ── Promo Codes ── */
router.get("/promo-codes", validateQuery(paginationQuerySchema), async (req, res) => {
  const page = Math.max(1, parseInt(req.query?.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit as string) || 50));
  const offset = (page - 1) * limit;

  const [totalResult, codes] = await Promise.all([
    db.select({ total: count() }).from(promoCodesTable),
    db.select().from(promoCodesTable).orderBy(desc(promoCodesTable.createdAt)).limit(limit).offset(offset),
  ]);

  const total = Number(totalResult[0]?.total ?? 0);
  const now = new Date();
  sendSuccess(res, {
    codes: codes.map(c => ({
      ...c,
      discountPct:    c.discountPct    ? parseFloat(String(c.discountPct))    : null,
      discountFlat:   c.discountFlat   ? parseFloat(String(c.discountFlat))   : null,
      minOrderAmount: c.minOrderAmount ? parseFloat(String(c.minOrderAmount)) : 0,
      maxDiscount:    c.maxDiscount    ? parseFloat(String(c.maxDiscount))    : null,
      expiresAt:  c.expiresAt  ? c.expiresAt.toISOString()  : null,
      createdAt:  c.createdAt.toISOString(),
      status: !c.isActive ? "inactive"
            : c.expiresAt && now > c.expiresAt ? "expired"
            : c.usageLimit !== null && c.usedCount >= c.usageLimit ? "exhausted"
            : "active",
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.post("/promo-codes", validateBody(createPromoCodeSchema), async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!body.code) { sendValidationError(res, "code required"); return; }
  try {
    const [code] = await db.insert(promoCodesTable).values({
      id:             generateId(),
      code:           String(body.code).toUpperCase().trim(),
      description:    body.description    || null,
      discountPct:    body.discountPct    ? String(body.discountPct)    : null,
      discountFlat:   body.discountFlat   ? String(body.discountFlat)   : null,
      minOrderAmount: body.minOrderAmount ? String(body.minOrderAmount) : "0",
      maxDiscount:    body.maxDiscount    ? String(body.maxDiscount)    : null,
      usageLimit:     body.usageLimit     ? Number(body.usageLimit)     : null,
      appliesTo:      body.appliesTo      || "all",
      expiresAt:      body.expiresAt      ? new Date(body.expiresAt as string) : null,
      isActive:       body.isActive !== false,
    }).returning();
    sendCreated(res, code);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "23505") { sendError(res, "Promo code already exists", 409); return; }
    throw e;
  }
});

router.patch("/promo-codes/:id", validateParams(idParamSchema), validateBody(patchPromoCodeSchema), async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  if (body.code           !== undefined) updates.code           = String(body.code).toUpperCase().trim();
  if (body.description    !== undefined) updates.description    = body.description;
  if (body.discountPct    !== undefined) updates.discountPct    = body.discountPct    ? String(body.discountPct)    : null;
  if (body.discountFlat   !== undefined) updates.discountFlat   = body.discountFlat   ? String(body.discountFlat)   : null;
  if (body.minOrderAmount !== undefined) updates.minOrderAmount = String(body.minOrderAmount);
  if (body.maxDiscount    !== undefined) updates.maxDiscount    = body.maxDiscount    ? String(body.maxDiscount)    : null;
  if (body.usageLimit     !== undefined) updates.usageLimit     = body.usageLimit     ? Number(body.usageLimit)     : null;
  if (body.appliesTo      !== undefined) updates.appliesTo      = body.appliesTo;
  if (body.expiresAt      !== undefined) updates.expiresAt      = body.expiresAt      ? new Date(body.expiresAt)    : null;
  if (body.isActive       !== undefined) updates.isActive       = body.isActive;
  const [code] = await db.update(promoCodesTable).set(updates).where(eq(promoCodesTable.id, req.params["id"]!)).returning();
  if (!code) { sendNotFound(res, "Promo code not found"); return; }
  sendSuccess(res, code);
});

router.delete("/promo-codes/:id", validateParams(idParamSchema), async (req, res) => {
  await db.delete(promoCodesTable).where(eq(promoCodesTable.id, req.params["id"]!));
  sendSuccess(res, { success: true });
});

/* ══════════════════════════════════════
   VENDOR MANAGEMENT
══════════════════════════════════════ */

/* ── POST /uploads/admin — base64 image upload for admin panel ── */
router.post("/uploads/admin", validateBody(uploadSchema), async (req, res) => {
  try {
    const { base64, mimeType } = req.body as { base64?: string; mimeType?: string };
    if (!base64 || !mimeType) { sendError(res, "base64 and mimeType are required", 400); return; }
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!allowed.includes(mimeType)) { sendError(res, "Only JPEG, PNG, and WebP images are allowed", 400); return; }
    const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length > 10 * 1024 * 1024) { sendError(res, "Image must be under 10MB", 400); return; }
    const uniqueName = `admin_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const uploadsDir = path.resolve(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, uniqueName), buffer);
    const url = `/api/uploads/${uniqueName}`;
    sendSuccess(res, { url });
  } catch (e: unknown) {
    sendError(res, (e instanceof Error ? e.message : undefined) || "Upload failed", 500);
  }
});

export default router;
