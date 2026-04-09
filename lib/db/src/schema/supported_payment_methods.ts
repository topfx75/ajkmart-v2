import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const supportedPaymentMethodsTable = pgTable("supported_payment_methods", {
  id:          text("id").primaryKey(),
  label:       text("label").notNull(),
  description: text("description").notNull().default(""),
  isActive:    boolean("is_active").notNull().default(true),
  sortOrder:   integer("sort_order").notNull().default(0),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});

export const insertSupportedPaymentMethodSchema = createInsertSchema(supportedPaymentMethodsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertSupportedPaymentMethod = z.infer<typeof insertSupportedPaymentMethodSchema>;
export type SupportedPaymentMethod = typeof supportedPaymentMethodsTable.$inferSelect;
