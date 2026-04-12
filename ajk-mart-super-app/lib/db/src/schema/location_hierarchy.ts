import { boolean, index, integer, numeric, pgTable, serial, text, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";

export const locationHierarchyTable = pgTable("location_hierarchy", {
  id:         serial("id").primaryKey(),
  name:       text("name").notNull(),
  level:      text("level").notNull(), // 'city' | 'sub_city' | 'area' | 'mohalla'
  parentId:   integer("parent_id").references((): AnyPgColumn => locationHierarchyTable.id, { onDelete: "cascade" }),
  lat:        numeric("lat", { precision: 10, scale: 6 }),
  lng:        numeric("lng", { precision: 10, scale: 6 }),
  radiusKm:   numeric("radius_km", { precision: 8, scale: 2 }).default("5"),
  isActive:   boolean("is_active").notNull().default(true),
  sortOrder:  integer("sort_order").notNull().default(0),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("location_hierarchy_level_idx").on(t.level),
  index("location_hierarchy_parent_id_idx").on(t.parentId),
  index("location_hierarchy_is_active_idx").on(t.isActive),
]);

export type LocationHierarchy = typeof locationHierarchyTable.$inferSelect;
export type InsertLocationHierarchy = typeof locationHierarchyTable.$inferInsert;
