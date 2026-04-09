import { boolean, decimal, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const popularLocationsTable = pgTable("popular_locations", {
  id:         text("id").primaryKey(),
  name:       text("name").notNull(),
  nameUrdu:   text("name_urdu"),
  lat:        decimal("lat", { precision: 10, scale: 6 }).notNull(),
  lng:        decimal("lng", { precision: 10, scale: 6 }).notNull(),
  category:   text("category").notNull().default("general"), /* chowk | school | hospital | bazar | park | general */
  icon:       text("icon").notNull().default("📍"),
  isActive:   boolean("is_active").notNull().default(true),
  sortOrder:  integer("sort_order").notNull().default(0),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
  updatedAt:  timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("popular_locations_category_is_active_idx").on(t.category, t.isActive),
]);

export type PopularLocation    = typeof popularLocationsTable.$inferSelect;
export type NewPopularLocation = typeof popularLocationsTable.$inferInsert;
