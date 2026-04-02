import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * rider_profiles — stores all rider-specific data, linked to users table by userId.
 * The users table only holds identity, auth, and wallet data.
 * Migrated from: users.vehicleType, vehiclePlate, vehicleRegNo, drivingLicense,
 *                vehiclePhoto, documents
 */
export const riderProfilesTable = pgTable("rider_profiles", {
  userId:         text("user_id").primaryKey(),
  vehicleType:    text("vehicle_type"),
  vehiclePlate:   text("vehicle_plate"),
  vehicleRegNo:   text("vehicle_reg_no"),
  drivingLicense: text("driving_license"),
  vehiclePhoto:   text("vehicle_photo"),
  documents:      text("documents"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
});

export const insertRiderProfileSchema = createInsertSchema(riderProfilesTable).omit({ createdAt: true, updatedAt: true });
export type InsertRiderProfile = z.infer<typeof insertRiderProfileSchema>;
export type RiderProfile = typeof riderProfilesTable.$inferSelect;
