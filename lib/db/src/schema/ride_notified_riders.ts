import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const rideNotifiedRidersTable = pgTable("ride_notified_riders", {
  id:      text("id").primaryKey(),
  rideId:  text("ride_id").notNull(),
  riderId: text("rider_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ride_notified_riders_ride_rider_uidx").on(t.rideId, t.riderId),
  index("ride_notified_riders_ride_id_idx").on(t.rideId),
]);
