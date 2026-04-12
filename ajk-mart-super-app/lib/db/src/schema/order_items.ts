import { decimal, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ordersTable } from "./orders";
import { productsTable } from "./products";

export const orderItemsTable = pgTable("order_items", {
  id:                  text("id").primaryKey(),
  orderId:             text("order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  productId:           text("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  name:                text("name"),
  image:               text("image"),
  unitPriceAtPurchase: decimal("unit_price_at_purchase", { precision: 10, scale: 2 }).notNull(),
  quantity:            integer("quantity").notNull(),
}, (t) => [
  index("order_items_order_id_idx").on(t.orderId),
  index("order_items_product_id_idx").on(t.productId),
]);

export const insertOrderItemSchema = createInsertSchema(orderItemsTable);
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type OrderItem = typeof orderItemsTable.$inferSelect;
