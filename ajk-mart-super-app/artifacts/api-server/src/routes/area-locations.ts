import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { locationHierarchyTable, type InsertLocationHierarchy } from "@workspace/db/schema";
import { eq, asc, and, isNull } from "drizzle-orm";
import { adminAuth } from "./admin-shared.js";
import { haversineKm } from "../lib/geofence.js";
import { sendSuccess, sendError, sendNotFound, sendValidationError } from "../lib/response.js";

const router: IRouter = Router();

/* ── GET /cities — list active cities ── */
router.get("/cities", async (_req, res) => {
  try {
    const cities = await db
      .select()
      .from(locationHierarchyTable)
      .where(and(
        eq(locationHierarchyTable.level, "city"),
        eq(locationHierarchyTable.isActive, true),
      ))
      .orderBy(asc(locationHierarchyTable.sortOrder), asc(locationHierarchyTable.name));
    res.json({ success: true, data: cities });
  } catch (err) {
    sendError(res, 500, "Failed to fetch cities");
  }
});

/* ── GET /:id/children — list active children of any node ── */
router.get("/:id/children", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { sendValidationError(res, "Invalid id"); return; }

  try {
    const children = await db
      .select()
      .from(locationHierarchyTable)
      .where(and(
        eq(locationHierarchyTable.parentId, id),
        eq(locationHierarchyTable.isActive, true),
      ))
      .orderBy(asc(locationHierarchyTable.sortOrder), asc(locationHierarchyTable.name));
    res.json({ success: true, data: children });
  } catch (err) {
    sendError(res, 500, "Failed to fetch children");
  }
});

/* ── GET /tree — full hierarchy tree for admin display ── */
router.get("/tree", adminAuth, async (_req, res) => {
  try {
    const all = await db
      .select()
      .from(locationHierarchyTable)
      .orderBy(asc(locationHierarchyTable.sortOrder), asc(locationHierarchyTable.name));

    /* Build tree in-process */
    type Row = typeof all[0] & { children?: Row[] };
    const byId = new Map<number, Row>();
    const roots: Row[] = [];

    for (const row of all) {
      byId.set(row.id, { ...row, children: [] });
    }
    for (const row of byId.values()) {
      if (row.parentId == null) {
        roots.push(row);
      } else {
        const parent = byId.get(row.parentId);
        if (parent) parent.children!.push(row);
      }
    }

    res.json({ success: true, data: roots });
  } catch (err) {
    sendError(res, 500, "Failed to fetch tree");
  }
});

/* ── POST /resolve — resolve lat/lng to deepest active node ── */
router.post("/resolve", async (req, res) => {
  const { lat, lng } = req.body ?? {};
  if (typeof lat !== "number" || typeof lng !== "number") {
    sendValidationError(res, "lat and lng are required numbers");
    return;
  }

  try {
    /* Fetch ALL nodes — active ones are candidates; all are needed for ancestor checks
       to detect inactive parents that could silently allow orphaned children through. */
    const all = await db.select().from(locationHierarchyTable);
    const active = all.filter(n => n.isActive);

    /* Level priority: mohalla > area > sub_city > city */
    const LEVEL_PRIORITY: Record<string, number> = {
      mohalla: 4, area: 3, sub_city: 2, city: 1,
    };

    /* Build a full-hierarchy lookup map (active + inactive for ancestor checks) */
    const allNodeMap = new Map(all.map(n => [n.id, n]));
    type Candidate = { node: typeof active[0]; dist: number };
    const matchingIds = new Set<number>();

    for (const node of active) {
      if (node.lat == null || node.lng == null || node.radiusKm == null) continue;
      const nodeLat = parseFloat(String(node.lat));
      const nodeLng = parseFloat(String(node.lng));
      if (isNaN(nodeLat) || isNaN(nodeLng)) continue;
      const dist = haversineKm(lat, lng, nodeLat, nodeLng);
      if (dist <= parseFloat(String(node.radiusKm))) {
        matchingIds.add(node.id);
      }
    }

    /* Helper: walk the full parent chain (using allNodeMap) and confirm every ancestor
       is both active AND contains the GPS point (i.e., in matchingIds).
       This prevents active children of inactive parents from slipping through. */
    function isHierarchyConsistent(node: typeof all[0]): boolean {
      let current: typeof all[0] | undefined = node;
      while (current) {
        if (!current.isActive) return false;
        if (!matchingIds.has(current.id)) return false;
        current = current.parentId ? allNodeMap.get(current.parentId) : undefined;
      }
      return true;
    }

    /* Collect nodes with fully-consistent parent chains, grouped by level priority */
    const candidatesByLevel: Record<number, Candidate[]> = {};
    for (const node of active) {
      if (!matchingIds.has(node.id)) continue;
      if (!isHierarchyConsistent(node)) continue;

      const nodeLat = parseFloat(String(node.lat!));
      const nodeLng = parseFloat(String(node.lng!));
      const dist = haversineKm(lat, lng, nodeLat, nodeLng);
      const priority = LEVEL_PRIORITY[node.level] ?? 0;
      if (!candidatesByLevel[priority]) candidatesByLevel[priority] = [];
      candidatesByLevel[priority].push({ node, dist });
    }

    /* Pick the deepest level that has at least one consistent match, then nearest */
    let best: (typeof active[0]) | null = null;
    const sortedPriorities = Object.keys(candidatesByLevel).map(Number).sort((a, b) => b - a);
    if (sortedPriorities.length > 0) {
      const topPriority = sortedPriorities[0];
      const candidates = candidatesByLevel[topPriority];
      candidates.sort((a, b) => a.dist - b.dist);
      best = candidates[0].node;
    }

    if (!best) {
      res.json({ success: true, data: null, message: "No matching location found" });
      return;
    }

    /* Build ancestry chain using full map (active+inactive) to traverse parent links */
    const ancestry: (typeof all[0])[] = [];
    let current: typeof all[0] | undefined = best;
    while (current) {
      ancestry.unshift(current);
      current = current.parentId ? allNodeMap.get(current.parentId) : undefined;
    }

    res.json({ success: true, data: best, ancestry });
  } catch (err) {
    sendError(res, 500, "Failed to resolve location");
  }
});

/* ── Admin CRUD ── */

/** Validate optional lat/lng/radiusKm fields; returns an error message or null. */
function validateCoords(lat: unknown, lng: unknown, radiusKm: unknown): string | null {
  if (lat != null) {
    const v = Number(lat);
    if (isNaN(v) || v < -90 || v > 90) return "lat must be a number between -90 and 90";
  }
  if (lng != null) {
    const v = Number(lng);
    if (isNaN(v) || v < -180 || v > 180) return "lng must be a number between -180 and 180";
  }
  if (radiusKm != null) {
    const v = Number(radiusKm);
    if (isNaN(v) || v <= 0) return "radiusKm must be a positive number";
  }
  return null;
}

/* POST / — create node */
router.post("/", adminAuth, async (req, res) => {
  const { name, level, parentId, lat, lng, radiusKm, isActive, sortOrder } = req.body ?? {};

  if (!name || typeof name !== "string" || !name.trim()) {
    sendValidationError(res, "name is required");
    return;
  }
  const VALID_LEVELS = ["city", "sub_city", "area", "mohalla"] as const;
  if (!VALID_LEVELS.includes(level)) {
    sendValidationError(res, "level must be city, sub_city, area, or mohalla");
    return;
  }
  if (level === "city" && parentId) {
    sendValidationError(res, "city nodes must not have a parentId");
    return;
  }
  if (level !== "city" && !parentId) {
    sendValidationError(res, "parentId is required for non-city levels");
    return;
  }

  const coordError = validateCoords(lat, lng, radiusKm);
  if (coordError) { sendValidationError(res, coordError); return; }

  const ALLOWED_PARENT: Record<string, string> = {
    sub_city: "city",
    area:     "sub_city",
    mohalla:  "area",
  };

  try {
    /* Validate parent level transition */
    if (parentId) {
      const [parent] = await db
        .select({ level: locationHierarchyTable.level })
        .from(locationHierarchyTable)
        .where(eq(locationHierarchyTable.id, parseInt(parentId, 10)))
        .limit(1);
      if (!parent) {
        sendNotFound(res, "Parent node not found");
        return;
      }
      const expectedParentLevel = ALLOWED_PARENT[level];
      if (parent.level !== expectedParentLevel) {
        sendValidationError(res, `A ${level} must have a ${expectedParentLevel} parent (got ${parent.level})`);
        return;
      }
    }

    const [row] = await db.insert(locationHierarchyTable).values({
      name:      name.trim(),
      level,
      parentId:  parentId ? parseInt(parentId, 10) : null,
      lat:       lat != null ? String(lat) : null,
      lng:       lng != null ? String(lng) : null,
      radiusKm:  radiusKm != null ? String(radiusKm) : "5",
      isActive:  isActive !== false,
      sortOrder: sortOrder != null ? parseInt(String(sortOrder), 10) : 0,
    }).returning();
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    sendError(res, 500, "Failed to create location");
  }
});

/* PATCH /:id — update node */
router.patch("/:id", adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { sendValidationError(res, "Invalid id"); return; }

  const { name, lat, lng, radiusKm, isActive, sortOrder } = req.body ?? {};

  const coordError = validateCoords(lat, lng, radiusKm);
  if (coordError) { sendValidationError(res, coordError); return; }

  if (name != null && (!String(name).trim())) {
    sendValidationError(res, "name must not be empty or whitespace");
    return;
  }

  const body = req.body ?? {};
  const updates: Partial<InsertLocationHierarchy> = {};
  if (name != null)      updates.name      = String(name).trim();
  /* Coordinates accept explicit null to clear the field, or a numeric value to update */
  if ("lat" in body)       updates.lat      = lat == null ? null : String(lat);
  if ("lng" in body)       updates.lng      = lng == null ? null : String(lng);
  if ("radiusKm" in body)  updates.radiusKm = radiusKm == null ? null : String(radiusKm);
  if (isActive != null)  updates.isActive  = Boolean(isActive);
  if (sortOrder != null) {
    const so = parseInt(String(sortOrder), 10);
    if (isNaN(so)) { sendValidationError(res, "sortOrder must be an integer"); return; }
    updates.sortOrder = so;
  }

  if (Object.keys(updates).length === 0) {
    sendValidationError(res, "No fields to update");
    return;
  }

  try {
    const [row] = await db
      .update(locationHierarchyTable)
      .set(updates)
      .where(eq(locationHierarchyTable.id, id))
      .returning();

    if (!row) { sendNotFound(res, "Location not found"); return; }
    res.json({ success: true, data: row });
  } catch (err) {
    sendError(res, 500, "Failed to update location");
  }
});

/* DELETE /:id — delete node (and children cascade via parent_id check) */
router.delete("/:id", adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { sendValidationError(res, "Invalid id"); return; }

  try {
    /* Check for children */
    const children = await db
      .select({ id: locationHierarchyTable.id })
      .from(locationHierarchyTable)
      .where(eq(locationHierarchyTable.parentId, id))
      .limit(1);

    if (children.length > 0) {
      sendValidationError(res, "Cannot delete a location that has children. Delete children first.");
      return;
    }

    const [deleted] = await db
      .delete(locationHierarchyTable)
      .where(eq(locationHierarchyTable.id, id))
      .returning();

    if (!deleted) { sendNotFound(res, "Location not found"); return; }
    res.json({ success: true, data: deleted });
  } catch (err) {
    sendError(res, 500, "Failed to delete location");
  }
});

export default router;
