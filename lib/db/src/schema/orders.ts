import { check, decimal, index, json, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ordersTable = pgTable("orders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").notNull(),
  items: json("items").notNull(),
  status: text("status").notNull().default("pending"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  deliveryAddress: text("delivery_address"),
  paymentMethod: text("payment_method").notNull(),
  riderId: text("rider_id"),
  vendorId: text("vendor_id"),
  estimatedTime: text("estimated_time"),
  proofPhotoUrl: text("proof_photo_url"),
  txnRef: text("txn_ref"),
  paymentStatus: text("payment_status").default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("orders_user_id_idx").on(t.userId),
  index("orders_rider_id_idx").on(t.riderId),
  index("orders_vendor_id_idx").on(t.vendorId),
  index("orders_status_idx").on(t.status),
  index("orders_created_at_idx").on(t.createdAt),
  /* Orders can never have a negative total */
  check("orders_total_non_negative", sql`${t.total} >= 0`),
]);

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ createdAt: true, updatedAt: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
