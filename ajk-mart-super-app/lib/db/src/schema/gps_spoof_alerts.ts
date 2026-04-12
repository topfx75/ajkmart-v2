import { boolean, decimal, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const gpsSpoofAlertsTable = pgTable("gps_spoof_alerts", {
  id:             text("id").primaryKey(),
  riderId:        text("rider_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  latitude:       decimal("latitude",  { precision: 10, scale: 6 }).notNull(),
  longitude:      decimal("longitude", { precision: 10, scale: 6 }).notNull(),
  violationType:  text("violation_type").notNull(),
  reason:         text("reason").notNull(),
  violationCount: integer("violation_count").notNull().default(1),
  autoOffline:    boolean("auto_offline").notNull().default(false),
  resolved:       boolean("resolved").notNull().default(false),
  resolvedAt:     timestamp("resolved_at"),
  resolvedBy:     text("resolved_by"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("gps_spoof_alerts_rider_idx").on(t.riderId),
  index("gps_spoof_alerts_resolved_idx").on(t.resolved),
  index("gps_spoof_alerts_created_at_idx").on(t.createdAt),
]);

export type GpsSpoofAlert = typeof gpsSpoofAlertsTable.$inferSelect;
