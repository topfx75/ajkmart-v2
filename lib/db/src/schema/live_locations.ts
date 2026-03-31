import { decimal, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const liveLocationsTable = pgTable("live_locations", {
  userId:    text("user_id").primaryKey(),
  latitude:  decimal("latitude",  { precision: 10, scale: 6 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 6 }).notNull(),
  role:      text("role").notNull(),
  action:    text("action"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  /* Supports "find all online riders" lookup */
  index("live_locations_role_idx").on(t.role),
  /* Composite spatial index: supports bounding-box pre-filter for proximity queries */
  index("live_locations_lat_lng_idx").on(t.latitude, t.longitude),
  /* Composite index: role + recency for fleet queries */
  index("live_locations_role_updated_idx").on(t.role, t.updatedAt),
]);

export const insertLiveLocationSchema = createInsertSchema(liveLocationsTable);
export type InsertLiveLocation = z.infer<typeof insertLiveLocationSchema>;
export type LiveLocation = typeof liveLocationsTable.$inferSelect;
