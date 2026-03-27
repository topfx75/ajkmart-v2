import { boolean, decimal, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id:              text("id").primaryKey(),
  phone:           text("phone").notNull().unique(),
  name:            text("name"),
  email:           text("email").unique(),
  role:            text("role").notNull().default("customer"),
  roles:           text("roles").notNull().default("customer"),
  avatar:          text("avatar"),
  walletBalance:   decimal("wallet_balance", { precision: 10, scale: 2 }).notNull().default("0"),
  /* ── OTP fields (phone verification) ── */
  otpCode:         text("otp_code"),
  otpExpiry:       timestamp("otp_expiry"),
  /* ── Email OTP (separate from phone OTP) ── */
  emailOtpCode:    text("email_otp_code"),
  emailOtpExpiry:  timestamp("email_otp_expiry"),
  /* ── Username + password login ── */
  username:        text("username").unique(),
  passwordHash:    text("password_hash"),
  /* ── Verification status ── */
  phoneVerified:   boolean("phone_verified").notNull().default(false),
  emailVerified:   boolean("email_verified").notNull().default(false),
  /* ── Admin approval ── */
  approvalStatus:  text("approval_status").notNull().default("approved"), /* pending | approved | rejected */
  approvalNote:    text("approval_note"),
  /* ── Account status ── */
  isActive:        boolean("is_active").notNull().default(true),
  isBanned:        boolean("is_banned").notNull().default(false),
  banReason:       text("ban_reason"),
  blockedServices: text("blocked_services").notNull().default(""),
  securityNote:    text("security_note"),
  isOnline:          boolean("is_online").notNull().default(false),
  /* ── Vendor/Store fields ── */
  storeName:         text("store_name"),
  storeCategory:     text("store_category"),
  storeBanner:       text("store_banner"),
  storeDescription:  text("store_description"),
  storeHours:        text("store_hours"),
  storeAnnouncement: text("store_announcement"),
  storeMinOrder:     decimal("store_min_order", { precision: 10, scale: 2 }).default("0"),
  storeDeliveryTime: text("store_delivery_time"),
  storeIsOpen:       boolean("store_is_open").notNull().default(true),
  /* ── Extended profile fields ── */
  cnic:              text("cnic"),
  address:           text("address"),
  city:              text("city"),
  emergencyContact:  text("emergency_contact"),
  vehicleType:       text("vehicle_type"),
  vehiclePlate:      text("vehicle_plate"),
  bankName:          text("bank_name"),
  bankAccount:       text("bank_account"),
  bankAccountTitle:  text("bank_account_title"),
  businessType:      text("business_type"),
  lastLoginAt:       timestamp("last_login_at"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
