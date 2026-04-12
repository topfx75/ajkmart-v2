import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id:        text("id").primaryKey(),
  userId:    text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  role:      text("role").notNull().default("customer"),
  endpoint:  text("endpoint").notNull(),
  p256dh:    text("p256dh").notNull(),
  authKey:   text("auth_key").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("push_sub_user_idx").on(t.userId),
  index("push_sub_role_idx").on(t.role),
]);

export type PushSubscription = typeof pushSubscriptionsTable.$inferSelect;
