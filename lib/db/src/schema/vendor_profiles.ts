import { boolean, decimal, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * vendor_profiles — stores all vendor/store-specific data, linked to users table by userId.
 * The users table only holds identity, auth, and wallet data.
 * Migrated from: users.storeName, storeCategory, storeBanner, storeDescription,
 *                storeHours, storeAnnouncement, storeMinOrder, storeDeliveryTime,
 *                storeIsOpen, storeAddress, businessType, businessName, ntn
 */
export const vendorProfilesTable = pgTable("vendor_profiles", {
  userId:            text("user_id").primaryKey(),
  storeName:         text("store_name"),
  storeCategory:     text("store_category"),
  storeBanner:       text("store_banner"),
  storeDescription:  text("store_description"),
  storeHours:        text("store_hours"),
  storeAnnouncement: text("store_announcement"),
  storeMinOrder:     decimal("store_min_order", { precision: 10, scale: 2 }).default("0"),
  storeDeliveryTime: text("store_delivery_time"),
  storeIsOpen:       boolean("store_is_open").notNull().default(true),
  storeAddress:      text("store_address"),
  businessType:      text("business_type"),
  businessName:      text("business_name"),
  ntn:               text("ntn"),
  createdAt:         timestamp("created_at").notNull().defaultNow(),
  updatedAt:         timestamp("updated_at").notNull().defaultNow(),
});

export const insertVendorProfileSchema = createInsertSchema(vendorProfilesTable).omit({ createdAt: true, updatedAt: true });
export type InsertVendorProfile = z.infer<typeof insertVendorProfileSchema>;
export type VendorProfile = typeof vendorProfilesTable.$inferSelect;
