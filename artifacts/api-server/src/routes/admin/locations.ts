import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { popularLocationsTable } from "@workspace/db/schema";
import { eq, asc } from "drizzle-orm";
import { sendSuccess, sendCreated, sendError, sendNotFound, sendValidationError } from "../../lib/response.js";
import { generateId } from "../../lib/id.js";

const VALID_CATEGORIES = ["chowk", "school", "hospital", "bazar", "park", "general"] as const;

const router: IRouter = Router();

/* ── GET /admin/locations — list all popular locations ── */
router.get("/locations", async (_req, res) => {
  const rows = await db
    .select()
    .from(popularLocationsTable)
    .orderBy(asc(popularLocationsTable.sortOrder), asc(popularLocationsTable.name));
  sendSuccess(res, rows);
});

/* ── POST /admin/locations — create a popular location ── */
router.post("/locations", async (req, res) => {
  const { name, nameUrdu, lat, lng, category, icon, isActive, sortOrder } =
    req.body as Record<string, unknown>;

  if (!name || lat == null || lng == null) {
    sendValidationError(res, "name, lat, lng are required");
    return;
  }

  const latNum = parseFloat(String(lat));
  const lngNum = parseFloat(String(lng));
  if (isNaN(latNum) || isNaN(lngNum) || latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
    sendValidationError(res, "Invalid lat/lng values");
    return;
  }

  const cat = String(category ?? "general");
  if (!VALID_CATEGORIES.includes(cat as typeof VALID_CATEGORIES[number])) {
    sendValidationError(res, `category must be one of: ${VALID_CATEGORIES.join(", ")}`);
    return;
  }

  const [row] = await db
    .insert(popularLocationsTable)
    .values({
      id:        generateId(),
      name:      String(name),
      nameUrdu:  nameUrdu != null ? String(nameUrdu) : null,
      lat:       latNum.toFixed(6),
      lng:       lngNum.toFixed(6),
      category:  cat,
      icon:      icon != null ? String(icon) : "📍",
      isActive:  isActive !== false,
      sortOrder: Number(sortOrder ?? 0),
      updatedAt: new Date(),
    })
    .returning();

  sendCreated(res, row);
});

/* ── PATCH /admin/locations/:id — update a popular location ── */
router.patch("/locations/:id", async (req, res) => {
  const { id } = req.params;
  const { name, nameUrdu, lat, lng, category, icon, isActive, sortOrder } =
    req.body as Record<string, unknown>;

  const [existing] = await db
    .select()
    .from(popularLocationsTable)
    .where(eq(popularLocationsTable.id, id));

  if (!existing) {
    sendNotFound(res, "Location not found");
    return;
  }

  const updates: Partial<typeof popularLocationsTable.$inferInsert> = { updatedAt: new Date() };

  if (name != null)      updates.name      = String(name);
  if (nameUrdu != null)  updates.nameUrdu  = String(nameUrdu);
  if (icon != null)      updates.icon      = String(icon);
  if (isActive != null)  updates.isActive  = Boolean(isActive);
  if (sortOrder != null) updates.sortOrder = Number(sortOrder);

  if (lat != null || lng != null) {
    const latNum = parseFloat(String(lat ?? existing.lat));
    const lngNum = parseFloat(String(lng ?? existing.lng));
    if (isNaN(latNum) || isNaN(lngNum) || latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
      sendValidationError(res, "Invalid lat/lng values");
      return;
    }
    updates.lat = latNum.toFixed(6);
    updates.lng = lngNum.toFixed(6);
  }

  if (category != null) {
    const cat = String(category);
    if (!VALID_CATEGORIES.includes(cat as typeof VALID_CATEGORIES[number])) {
      sendValidationError(res, `category must be one of: ${VALID_CATEGORIES.join(", ")}`);
      return;
    }
    updates.category = cat;
  }

  const [updated] = await db
    .update(popularLocationsTable)
    .set(updates)
    .where(eq(popularLocationsTable.id, id))
    .returning();

  sendSuccess(res, updated);
});

/* ── DELETE /admin/locations/:id — remove a popular location ── */
router.delete("/locations/:id", async (req, res) => {
  const { id } = req.params;

  const [existing] = await db
    .select()
    .from(popularLocationsTable)
    .where(eq(popularLocationsTable.id, id));

  if (!existing) {
    sendNotFound(res, "Location not found");
    return;
  }

  await db.delete(popularLocationsTable).where(eq(popularLocationsTable.id, id));
  sendSuccess(res, { deleted: true });
});

export default router;
