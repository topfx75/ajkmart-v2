import { boolean, check, decimal, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id:              text("id").primaryKey(),
  phone:           text("phone").unique(),
  name:            text("name"),
  email:           text("email").unique(),
  role:            text("role").notNull().default("customer"),
  roles:           text("roles").notNull().default("customer"),
  avatar:          text("avatar"),
  walletBalance:   decimal("wallet_balance", { precision: 10, scale: 2 }).notNull().default("0"),
  /* ── OTP fields (phone verification) ── */
  otpCode:         text("otp_code"),
  otpExpiry:       timestamp("otp_expiry"),
  otpUsed:         boolean("otp_used").notNull().default(false),
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
  /* ── Profile completion flag ── */
  isProfileComplete: boolean("is_profile_complete").notNull().default(false),
  /* ── Account status ── */
  isActive:        boolean("is_active").notNull().default(true),
  isBanned:        boolean("is_banned").notNull().default(false),
  banReason:       text("ban_reason"),
  blockedServices: text("blocked_services").notNull().default(""),
  securityNote:    text("security_note"),
  isOnline:          boolean("is_online").notNull().default(false),
  /* ── Extended profile fields (shared across roles) ── */
  cnic:              text("cnic"),
  address:           text("address"),
  city:              text("city"),
  area:              text("area"),
  latitude:          decimal("latitude",  { precision: 10, scale: 7 }),
  longitude:         decimal("longitude", { precision: 10, scale: 7 }),
  kycStatus:         text("kyc_status").notNull().default("none"),
  accountLevel:      text("account_level").notNull().default("bronze"),
  emergencyContact:  text("emergency_contact"),
  bankName:          text("bank_name"),
  bankAccount:       text("bank_account"),
  bankAccountTitle:  text("bank_account_title"),
  nationalId:        text("national_id"),
  /* ── Vendor store fields (kept on users table — migrated subsets to vendor_profiles) ── */
  storeCategory:     text("store_category"),
  storeBanner:       text("store_banner"),
  storeDescription:  text("store_description"),
  storeHours:        text("store_hours"),
  storeAnnouncement: text("store_announcement"),
  storeMinOrder:     decimal("store_min_order", { precision: 10, scale: 2 }).default("0"),
  storeDeliveryTime: text("store_delivery_time"),
  storeIsOpen:       boolean("store_is_open").notNull().default(true),
  storeAddress:      text("store_address"),
  storeLat:          decimal("store_lat", { precision: 10, scale: 6 }),
  storeLng:          decimal("store_lng", { precision: 10, scale: 6 }),
  businessType:      text("business_type"),
  businessName:      text("business_name"),
  ntn:               text("ntn"),
  /* ── Rider vehicle fields (kept on users table — migrated subsets to rider_profiles) ── */
  vehiclePlate:      text("vehicle_plate"),
  vehicleRegNo:      text("vehicle_reg_no"),
  drivingLicense:    text("driving_license"),
  vehiclePhoto:      text("vehicle_photo"),
  documents:         text("documents"),
  biometricEnabled:  boolean("biometric_enabled").notNull().default(false),
  /* ── Wallet MPIN security ── */
  walletPinHash:       text("wallet_pin_hash"),
  walletPinAttempts:   integer("wallet_pin_attempts").notNull().default(0),
  walletPinLockedUntil: timestamp("wallet_pin_locked_until"),
  walletHidden:        boolean("wallet_hidden").notNull().default(false),
  /* ── 2FA / TOTP fields ── */
  totpSecret:        text("totp_secret"),
  totpEnabled:       boolean("totp_enabled").notNull().default(false),
  backupCodes:       text("backup_codes"),
  trustedDevices:    text("trusted_devices"),
  twoFactorEnforcedAt: timestamp("two_factor_enforced_at"),
  /* ── Social login fields ── */
  googleId:          text("google_id").unique(),
  facebookId:        text("facebook_id").unique(),
  /* ── Dispatch tracking ── */
  cancelCount:     integer("cancel_count").notNull().default(0),
  ignoreCount:     integer("ignore_count").notNull().default(0),
  isRestricted:    boolean("is_restricted").notNull().default(false),
  cancellationDebt: decimal("cancellation_debt", { precision: 10, scale: 2 }).notNull().default("0"),
  /* ── Merge OTP fields (separate from login OTP to avoid race conditions) ── */
  mergeOtpCode:    text("merge_otp_code"),
  mergeOtpExpiry:  timestamp("merge_otp_expiry"),
  /* ── Pending merge identifier — binds merge-OTP to a specific identifier ── */
  pendingMergeIdentifier: text("pending_merge_identifier"),
  /* ── Device fingerprinting — for multi-account abuse detection ── */
  deviceId:        text("device_id"),
  /* ── Token version — incremented on logout/ban/role change to invalidate access JWTs ── */
  tokenVersion:    integer("token_version").notNull().default(0),
  /* ── Dev OTP mode — admin-controlled per-user OTP display in response ── */
  devOtpEnabled:   boolean("dev_otp_enabled").notNull().default(false),
  /* ── Auto-suspension tracking ── */
  autoSuspendedAt: timestamp("auto_suspended_at"),
  autoSuspendReason: text("auto_suspend_reason"),
  adminOverrideSuspension: boolean("admin_override_suspension").notNull().default(false),
  /* ── Rider silence mode — synced from rider app ── */
  silenceMode:       boolean("silence_mode").notNull().default(false),
  silenceModeUntil:  timestamp("silence_mode_until"),
  lastLoginAt:       timestamp("last_login_at"),
  lastActive:        timestamp("last_active"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  /* DB-level floor: wallet can never go below zero.
     Application layer already enforces this; the DB constraint is the final guard. */
  check("users_wallet_non_negative", sql`${t.walletBalance} >= 0`),
  /* Performance indexes for fleet/admin queries that filter by role and/or online status */
  index("users_role_idx").on(t.role),
  index("users_is_online_idx").on(t.isOnline),
  index("users_role_is_online_idx").on(t.role, t.isOnline),
]);

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
