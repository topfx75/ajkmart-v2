import { index, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { ridesTable } from "./rides";

export const rideMessagesTable = pgTable("ride_messages", {
  id: text("id").primaryKey(),
  rideId: text("ride_id").notNull().references(() => ridesTable.id, { onDelete: "cascade" }),
  senderRole: varchar("sender_role", { length: 10 }).notNull(),
  senderId: text("sender_id").notNull(),
  body: varchar("body", { length: 500 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("ride_messages_ride_id_idx").on(t.rideId),
  index("ride_messages_created_at_idx").on(t.rideId, t.createdAt),
]);

export type RideMessage = typeof rideMessagesTable.$inferSelect;
export type NewRideMessage = typeof rideMessagesTable.$inferInsert;
