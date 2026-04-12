import { type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  notificationsTable,
  platformSettingsTable,
  adminAccountsTable,
  rideServiceTypesTable,
  popularLocationsTable,
  refreshTokensTable,
  serviceZonesTable,
  supportedPaymentMethodsTable,
  locationHierarchyTable,
} from "@workspace/db/schema";
import { eq, count, sql } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getUserLanguage } from "../lib/getUserLanguage.js";
import { t, type TranslationKey } from "@workspace/i18n";
import { sendSuccess, sendError, sendErrorWithData, sendNotFound, sendForbidden, sendUnauthorized, sendValidationError } from "../lib/response.js";
import {
  checkAdminIPWhitelist,
  addAuditEntry,
  addSecurityEvent,
  getClientIp,
  signAdminJwt,
  verifyAdminJwt,
  invalidateSettingsCache,
  getCachedSettings,
  ADMIN_TOKEN_TTL_HRS,
  auditLog,
} from "../middleware/security.js";
import { verifyTotpToken } from "../services/totp.js";
import { verifyAdminSecret } from "../services/password.js";
import { logger } from "../lib/logger.js";
import { sendPushToUser } from "../lib/webpush.js";

export interface AdminRequest extends Request {
  adminRole?: string;
  adminId?: string;
  adminName?: string;
  adminIp?: string;
}

export function stripUser(u: Record<string, unknown>) {
  const { passwordHash: _ph, otpCode: _otp, otpExpiry: _exp,
          emailOtpCode: _eotp, emailOtpExpiry: _eexp,
          totpSecret: _ts, backupCodes: _bc, trustedDevices: _td, ...safe } = u;
  return safe;
}

export { generateId, getUserLanguage, t, type TranslationKey };
export { checkAdminIPWhitelist, addAuditEntry, addSecurityEvent, getClientIp, signAdminJwt, verifyAdminJwt, invalidateSettingsCache, getCachedSettings, ADMIN_TOKEN_TTL_HRS, auditLog };
export { verifyTotpToken };
export { verifyAdminSecret };
export { logger };
export const DEFAULT_PLATFORM_SETTINGS = [
  /* Delivery */
  { key: "delivery_fee_mart",       value: "80",   label: "Mart Delivery Fee (Rs.)",             category: "delivery" },
  { key: "delivery_fee_food",       value: "60",   label: "Food Delivery Fee (Rs.)",             category: "delivery" },
  { key: "delivery_fee_pharmacy",   value: "50",   label: "Pharmacy Delivery Fee (Rs.)",         category: "delivery" },
  { key: "delivery_fee_parcel",     value: "100",  label: "Parcel Base Delivery Fee (Rs.)",      category: "delivery" },
  { key: "delivery_parcel_per_kg",  value: "40",   label: "Parcel Extra Charge Per KG (Rs.)",    category: "delivery" },
  { key: "delivery_free_enabled",   value: "on",   label: "Enable Free Delivery Threshold",      category: "delivery" },
  { key: "free_delivery_above",     value: "1000", label: "Free Delivery Above (Rs.)",           category: "delivery" },
  /* Rides */
  { key: "haversine_terrain_multiplier", value: "1.4", label: "Haversine Terrain Multiplier (applied when routing API unavailable; 1.4 = 40% uplift for mountainous terrain)", category: "rides" },
  { key: "ride_bike_base_fare",      value: "15",  label: "Bike Base Fare (Rs.)",                   category: "rides" },
  { key: "ride_bike_per_km",         value: "8",   label: "Bike Per KM Rate (Rs.)",                 category: "rides" },
  { key: "ride_bike_min_fare",       value: "50",  label: "Bike Minimum Fare (Rs.)",                category: "rides" },
  { key: "ride_car_base_fare",       value: "25",  label: "Car Base Fare (Rs.)",                    category: "rides" },
  { key: "ride_car_per_km",          value: "12",  label: "Car Per KM Rate (Rs.)",                  category: "rides" },
  { key: "ride_car_min_fare",        value: "80",  label: "Car Minimum Fare (Rs.)",                 category: "rides" },
  { key: "ride_surge_enabled",          value: "off", label: "Enable Surge Pricing",                    category: "rides" },
  { key: "ride_surge_multiplier",       value: "1.5", label: "Surge Multiplier",                        category: "rides" },
  { key: "ride_cancellation_fee",       value: "30",  label: "Cancellation Fee after Acceptance (Rs.)",  category: "rides" },
  { key: "ride_cancel_grace_sec",       value: "180", label: "Free-Cancel Grace Period (seconds)",        category: "rides" },
  { key: "ride_bargaining_enabled",     value: "on",  label: "Enable Price Bargaining",                  category: "rides" },
  { key: "ride_bargaining_min_pct",     value: "70",  label: "Minimum Offer % of Platform Fare",         category: "rides" },
  { key: "ride_bargaining_max_rounds",  value: "3",   label: "Max Bargaining Rounds",                    category: "rides" },
  /* Rickshaw */
  { key: "ride_rickshaw_base_fare",     value: "20",  label: "Rickshaw Base Fare (Rs.)",                 category: "rides" },
  { key: "ride_rickshaw_per_km",        value: "10",  label: "Rickshaw Per KM Rate (Rs.)",               category: "rides" },
  { key: "ride_rickshaw_min_fare",      value: "60",  label: "Rickshaw Minimum Fare (Rs.)",              category: "rides" },
  /* Daba / Van */
  { key: "ride_daba_base_fare",         value: "30",  label: "Daba / Van Base Fare (Rs.)",               category: "rides" },
  { key: "ride_daba_per_km",            value: "14",  label: "Daba / Van Per KM Rate (Rs.)",             category: "rides" },
  { key: "ride_daba_min_fare",          value: "100", label: "Daba / Van Minimum Fare (Rs.)",            category: "rides" },
  /* Finance */
  { key: "platform_commission_pct", value: "10",  label: "Platform Commission % (Global Override)", category: "finance" },
  { key: "finance_gst_enabled",     value: "off", label: "Collect GST / Sales Tax",                 category: "finance" },
  { key: "finance_gst_pct",         value: "17",  label: "GST / Tax Rate (%)",                      category: "finance" },
  { key: "finance_cashback_enabled",value: "off", label: "Enable Order Cashback Rewards",            category: "finance" },
  { key: "finance_cashback_pct",    value: "2",   label: "Cashback % on Every Order",               category: "finance" },
  { key: "finance_cashback_max_rs", value: "100", label: "Max Cashback Per Order (Rs.)",             category: "finance" },
  { key: "finance_invoice_enabled", value: "off", label: "Auto-Generate PDF Invoices on Orders",    category: "finance" },
  /* Orders */
  { key: "min_order_amount",          value: "100",   label: "Minimum Order Amount (Rs.)",              category: "orders" },
  { key: "order_max_cart_value",      value: "50000", label: "Max Cart Value / Hard Cap (Rs.)",         category: "orders" },
  { key: "order_cancel_window_min",   value: "5",     label: "Customer Cancel Window (minutes)",        category: "orders" },
  { key: "order_auto_cancel_min",     value: "15",    label: "Auto-Cancel if Unaccepted (minutes)",     category: "orders" },
  { key: "auto_confirm_mart",         value: "off",   label: "Auto-Confirm Mart Orders (skip vendor acceptance)", category: "orders" },
  { key: "auto_confirm_food",         value: "off",   label: "Auto-Confirm Food Orders (skip vendor acceptance)", category: "orders" },
  { key: "auto_confirm_pharmacy",     value: "off",   label: "Auto-Confirm Pharmacy Orders",            category: "orders" },
  { key: "auto_confirm_parcel",       value: "off",   label: "Auto-Confirm Parcel Orders",              category: "orders" },
  { key: "order_refund_days",         value: "3",     label: "Refund Processing Time (days)",           category: "orders" },
  { key: "order_preptime_min",        value: "15",    label: "Default Prep Time Shown (minutes)",       category: "orders" },
  { key: "order_rating_window_hours", value: "48",    label: "Rating Window After Delivery (hours)",    category: "orders" },
  { key: "order_schedule_enabled",    value: "off",   label: "Allow Advance Order Scheduling",          category: "orders" },
  /* Language */
  { key: "default_language",    value: "en",       label: "Default Language",             category: "general" },
  { key: "enabled_languages",   value: '["en"]',   label: "Enabled Language Modes (JSON array)", category: "general" },
  /* General */
  { key: "app_name",               value: "AJKMart",                        label: "App Name",                    category: "general" },
  { key: "app_tagline",            value: "Your super app for everything",   label: "App Tagline / Subtitle",      category: "general" },
  { key: "app_version",            value: "1.0.0",                          label: "App Version",                 category: "general" },
  { key: "app_status",             value: "active",                         label: "App Status",                  category: "general" },
  { key: "support_phone",          value: "03001234567",                    label: "Support Phone Number",        category: "general" },
  { key: "support_email",          value: "",                               label: "Support Email Address",       category: "general" },
  { key: "support_hours",          value: "Mon–Sat, 8AM–10PM",              label: "Support Hours",               category: "general" },
  { key: "business_address",       value: "Muzaffarabad, AJK, Pakistan",    label: "Business Address / Region",   category: "general" },
  { key: "social_facebook",        value: "",                               label: "Facebook Page URL",           category: "general" },
  { key: "social_instagram",       value: "",                               label: "Instagram Profile URL",       category: "general" },
  /* Customer Role Settings */
  { key: "customer_referral_bonus",   value: "100",   label: "Referral Bonus (Rs.)",            category: "customer" },
  { key: "customer_loyalty_pts",      value: "5",     label: "Loyalty Points Per Rs.100",       category: "customer" },
  { key: "customer_max_orders_day",   value: "10",    label: "Max Orders Per Day",              category: "customer" },
  { key: "customer_referral_enabled", value: "on",    label: "Referral Program Active",         category: "customer" },
  { key: "customer_loyalty_enabled",  value: "on",    label: "Loyalty Points Program Active",   category: "customer" },
  { key: "customer_signup_bonus",     value: "0",     label: "New User Signup Bonus (Rs.)",     category: "customer" },
  /* Rider Role Settings */
  { key: "rider_keep_pct",         value: "80",    label: "Rider Earnings % (of fare)",                    category: "rider" },
  { key: "rider_acceptance_km",    value: "5",     label: "Acceptance Radius (KM)",                        category: "rider" },
  { key: "rider_max_deliveries",   value: "3",     label: "Max Active Deliveries",                         category: "rider" },
  { key: "rider_bonus_per_trip",   value: "0",     label: "Bonus Per Trip (Rs.)",                          category: "rider" },
  { key: "rider_min_payout",       value: "500",   label: "Minimum Payout (Rs.)",                          category: "rider" },
  { key: "rider_cash_allowed",     value: "on",    label: "Allow Cash Payments",                           category: "rider" },
  { key: "rider_auto_approve",     value: "off",   label: "Auto-Approve New Riders",                       category: "rider" },
  { key: "rider_withdrawal_enabled", value: "on",  label: "Riders Can Submit Withdrawals",                 category: "rider" },
  { key: "rider_max_payout",       value: "50000", label: "Maximum Single Payout (Rs.)",                   category: "rider" },
  { key: "rider_min_balance",      value: "500",   label: "Minimum Wallet Balance for Cash Orders (Rs.)",  category: "rider" },
  { key: "rider_deposit_enabled",  value: "on",    label: "Riders Can Submit Wallet Deposit Requests",     category: "rider" },
  { key: "rider_daily_goal",       value: "5000",  label: "Rider Daily Earnings Goal (Rs.)",               category: "rider" },
  { key: "rider_cancel_limit_daily",      value: "3",    label: "Max Cancellations Per Day Before Penalty",     category: "rider" },
  { key: "rider_cancel_penalty_amount",   value: "50",   label: "Cancellation Penalty Amount (Rs.)",            category: "rider" },
  { key: "rider_cancel_restrict_enabled", value: "on",   label: "Auto-Restrict Rider on Excessive Cancels",    category: "rider" },
  /* Vendor Role Settings */
  { key: "vendor_commission_pct",      value: "15",     label: "Vendor Platform Commission (%)",         category: "vendor" },
  { key: "vendor_min_order",           value: "100",    label: "Platform Default Min Order (Rs.)",       category: "vendor" },
  { key: "vendor_max_items",           value: "100",    label: "Max Menu Items Per Vendor",              category: "vendor" },
  { key: "vendor_settlement_days",     value: "7",      label: "Payout Settlement Days",                 category: "vendor" },
  { key: "vendor_min_payout",          value: "500",    label: "Minimum Payout Request (Rs.)",           category: "vendor" },
  { key: "vendor_max_payout",          value: "50000",  label: "Maximum Single Payout Request (Rs.)",    category: "vendor" },
  { key: "vendor_auto_approve",        value: "off",    label: "Auto-Approve New Vendors",               category: "vendor" },
  { key: "vendor_promo_enabled",       value: "on",     label: "Vendors Can Create Promo Codes",         category: "vendor" },
  { key: "vendor_withdrawal_enabled",  value: "on",     label: "Vendors Can Submit Withdrawal Requests", category: "vendor" },
  { key: "vendor_delivery_time_max",   value: "120",    label: "Max Delivery Time Cap (minutes)",        category: "vendor" },
  { key: "vendor_delivery_time_default", value: "45",   label: "Default Delivery Time (minutes)",        category: "vendor" },
  /* Auto-Suspension Settings */
  { key: "auto_suspend_rating_threshold", value: "2.5",  label: "Auto-Suspend Rating Threshold (avg below this)", category: "rider" },
  { key: "auto_suspend_min_reviews",      value: "10",   label: "Auto-Suspend Min Reviews in 30 Days",            category: "rider" },
  { key: "auto_suspend_vendor_threshold", value: "2.5",  label: "Auto-Suspend Vendor Rating Threshold",           category: "vendor" },
  { key: "auto_suspend_vendor_min_reviews", value: "10", label: "Auto-Suspend Vendor Min Reviews in 30 Days",     category: "vendor" },
  /* App Feature Toggles */
  { key: "feature_mart",           value: "on",    label: "Mart (Grocery) Service",        category: "features" },
  { key: "feature_food",           value: "on",    label: "Food Delivery Service",         category: "features" },
  { key: "feature_rides",          value: "on",    label: "Taxi & Bike Booking",           category: "features" },
  { key: "feature_pharmacy",       value: "on",    label: "Pharmacy Service",              category: "features" },
  { key: "feature_parcel",         value: "on",    label: "Parcel Delivery Service",       category: "features" },
  { key: "feature_wallet",         value: "on",    label: "Digital Wallet",                category: "features" },
  { key: "feature_referral",       value: "on",    label: "Referral Program",              category: "features" },
  { key: "feature_new_users",      value: "on",    label: "New User Registration",         category: "features" },
  { key: "user_require_approval",  value: "off",   label: "Require Admin Approval for New Users", category: "features" },
  /* Content & Messaging */
  { key: "content_tracker_banner_enabled", value: "on", label: "Active Tracker Banner (shows active rides/orders)", category: "content" },
  { key: "content_tracker_banner_position", value: "top", label: "Tracker Banner Position (top or bottom)", category: "content" },
  { key: "content_show_banner",    value: "on",    label: "Show Promotional Banner Carousel",     category: "content" },
  { key: "content_banner",         value: "Free delivery on your first order! 🎉", label: "Promo Ribbon Text (below services)", category: "content" },
  { key: "content_announcement",   value: "",      label: "Announcement Bar (empty = hidden)",    category: "content" },
  { key: "content_maintenance_msg",value: "We're performing scheduled maintenance. Back soon!", label: "Maintenance Screen Message", category: "content" },
  { key: "content_support_msg",    value: "Need help? Chat with us!",              label: "Support / WhatsApp Greeting",         category: "content" },
  { key: "content_vendor_notice",  value: "",      label: "Vendor Dashboard Notice (empty = hidden)", category: "content" },
  { key: "content_rider_notice",   value: "",      label: "Rider Home Notice (empty = hidden)",   category: "content" },
  { key: "content_tnc_url",        value: "",      label: "Terms & Conditions URL",               category: "content" },
  { key: "content_privacy_url",    value: "",      label: "Privacy Policy URL",                   category: "content" },
  { key: "content_refund_policy_url", value: "",   label: "Refund Policy URL",                    category: "content" },
  { key: "content_faq_url",        value: "",      label: "FAQ / Help Center URL",                category: "content" },
  { key: "content_about_url",      value: "",      label: "About Us URL",                         category: "content" },
  { key: "feature_chat",           value: "off",   label: "In-App Chat / WhatsApp Support",       category: "features" },
  { key: "feature_live_tracking",  value: "on",    label: "Live Order GPS Tracking",              category: "features" },
  { key: "feature_reviews",        value: "on",    label: "Customer Reviews & Ratings",           category: "features" },
  { key: "feature_sos",            value: "on",    label: "SOS Emergency Alerts",                 category: "features" },
  { key: "feature_weather",        value: "on",    label: "Weather Widget",                       category: "features" },
  /* Security & API Keys */
  /* ═══════════════════  Security & API  ═══════════════════ */
  /* Auth & Sessions */
  { key: "security_global_dev_otp",     value: "off",    label: "Global Dev OTP Mode — show OTP in API response (testing only)", category: "security" },
  { key: "security_otp_bypass",        value: "off",    label: "OTP Bypass Mode (Dev Only — DANGER)",        category: "security" },
  { key: "security_mfa_required",      value: "off",    label: "Two-Factor Auth for Admin Login",             category: "security" },
  { key: "security_multi_device",      value: "on",     label: "Allow Multiple Device Logins",                category: "security" },
  { key: "security_session_days",      value: "30",     label: "Session Expiry (days)",                       category: "security" },
  { key: "security_admin_token_hrs",   value: "24",     label: "Admin Token Expiry (hours)",                  category: "security" },
  { key: "security_rider_token_days",  value: "30",     label: "Rider Token Expiry (days)",                   category: "security" },
  { key: "security_login_max_attempts",value: "5",      label: "Max Failed Login Attempts Before Lockout",    category: "security" },
  { key: "security_lockout_minutes",   value: "30",     label: "Account Lockout Duration (minutes)",          category: "security" },
  /* Rate Limiting & DDoS */
  { key: "security_rate_limit",        value: "100",    label: "General API Rate Limit (req/min per IP)",     category: "security" },
  { key: "security_rate_admin",        value: "60",     label: "Admin Panel Rate Limit (req/min)",            category: "security" },
  { key: "security_rate_rider",        value: "200",    label: "Rider API Rate Limit (req/min)",              category: "security" },
  { key: "security_rate_vendor",       value: "150",    label: "Vendor API Rate Limit (req/min)",             category: "security" },
  { key: "security_block_tor",         value: "off",    label: "Block TOR Exit Node IPs",                     category: "security" },
  { key: "security_block_vpn",         value: "off",    label: "Block VPN/Proxy Users",                       category: "security" },
  { key: "security_rate_burst",        value: "20",     label: "Burst Allowance (extra req before block)",    category: "security" },
  /* GPS & Location */
  { key: "security_gps_tracking",      value: "on",     label: "GPS Tracking for Riders",                    category: "security" },
  { key: "security_gps_accuracy",      value: "50",     label: "Min GPS Accuracy Required (meters)",         category: "security" },
  { key: "security_gps_interval",      value: "10",     label: "GPS Update Interval (seconds)",              category: "security" },
  { key: "security_geo_fence",         value: "off",    label: "Strict Geofence Mode",                       category: "security" },
  { key: "security_spoof_detection",   value: "on",     label: "GPS Spoofing / Mock Location Detection",     category: "security" },
  { key: "security_max_speed_kmh",     value: "150",    label: "Max Speed Allowed (km/h — legacy, use gps_max_speed_kmh)", category: "security" },
  { key: "gps_max_speed_kmh",          value: "120",    label: "GPS Max Speed for Spoof Detection (km/h) — overrides legacy setting", category: "security" },
  /* Service Area */
  { key: "security_service_city",       value: "Muzaffarabad, AJK", label: "Primary Service City",                   category: "security" },
  { key: "security_service_radius_km",  value: "30",     label: "Max Service Radius (km from city center)",    category: "security" },
  /* Password & Token Policy */
  { key: "security_pwd_min_length",    value: "8",      label: "Minimum Password Length (characters)",        category: "security" },
  { key: "security_pwd_strong",        value: "on",     label: "Require Strong Password (uppercase+number)",  category: "security" },
  { key: "security_pwd_expiry_days",   value: "0",      label: "Password Expiry (days, 0 = never)",           category: "security" },
  { key: "security_jwt_rotation_days", value: "90",     label: "JWT Secret Rotation Interval (days)",         category: "security" },
  /* File Uploads */
  { key: "security_allow_uploads",     value: "on",     label: "Allow File Uploads (photos/receipts)",        category: "security" },
  { key: "security_max_file_mb",       value: "5",      label: "Max Upload File Size (MB)",                   category: "security" },
  { key: "security_allowed_types",     value: "jpg,jpeg,png,pdf", label: "Allowed File Types (comma-sep)",   category: "security" },
  { key: "security_compress_images",   value: "on",     label: "Auto-compress Uploaded Images",               category: "security" },
  { key: "security_img_quality",       value: "80",     label: "Image Compression Quality (%)",               category: "security" },
  { key: "security_scan_uploads",      value: "off",    label: "Virus/Malware Scan on Uploads",               category: "security" },
  /* Upload Use Cases */
  { key: "upload_payment_proof",       value: "on",     label: "Allow Payment Proof Screenshots",             category: "security" },
  { key: "upload_kyc_docs",            value: "on",     label: "Allow KYC Identity Documents",               category: "security" },
  { key: "upload_rider_docs",          value: "on",     label: "Allow Rider CNIC & License Uploads",         category: "security" },
  { key: "upload_vendor_docs",         value: "on",     label: "Allow Vendor Business Document Uploads",     category: "security" },
  { key: "upload_product_imgs",        value: "on",     label: "Allow Product / Menu Image Uploads",         category: "security" },
  { key: "upload_cod_proof",           value: "on",     label: "Allow COD Cash Photo Proof Uploads",         category: "security" },
  /* Fraud Detection */
  { key: "order_gps_capture_enabled",  value: "off",    label: "Capture Customer GPS on Order Placement",      category: "security" },
  { key: "gps_mismatch_threshold_m",   value: "500",    label: "GPS Mismatch Threshold (metres)",              category: "security" },
  { key: "profile_show_saved_addresses",value: "on",    label: "Show Saved Addresses on Customer Profile",     category: "security" },
  { key: "security_fake_order_detect", value: "on",     label: "Fake Order Auto-Detection",                   category: "security" },
  { key: "security_max_daily_orders",  value: "20",     label: "Max Orders per Customer per Day",             category: "security" },
  { key: "security_auto_block_ip",     value: "on",     label: "Auto-block Suspicious IPs",                   category: "security" },
  { key: "security_new_acct_limit",    value: "3",      label: "New Account Order Limit (first 7 days)",      category: "security" },
  { key: "security_same_addr_limit",   value: "5",      label: "Same Address Orders per Hour Limit",          category: "security" },
  { key: "security_phone_verify",      value: "on",     label: "Phone Number Verification Required",          category: "security" },
  { key: "security_single_phone",      value: "on",     label: "One Account per Phone Number",                category: "security" },
  /* Admin Access Control */
  { key: "security_audit_log",         value: "on",     label: "Admin Action Audit Log",                      category: "security" },
  { key: "security_admin_ip_whitelist",value: "",        label: "Admin IP Whitelist (comma-separated, blank=any)", category: "security" },
  { key: "security_maintenance_key",   value: "",        label: "Maintenance Mode Access Key",                category: "security" },
  /* ═══════════════════  Platform Integrations  ═══════════════════ */
  /* Firebase FCM — Push Notifications */
  { key: "integration_push_notif",    value: "off",      label: "Firebase Push Notifications",            category: "integrations" },
  /* Notification Channel Toggles */
  { key: "notif_new_order",           value: "on",       label: "Notify Vendor on New Order Received",    category: "integrations" },
  { key: "notif_order_ready",         value: "on",       label: "Notify Rider when Order Ready for Pickup", category: "integrations" },
  { key: "notif_ride_request",        value: "on",       label: "Notify Rider on New Ride Request",       category: "integrations" },
  { key: "notif_promo",               value: "on",       label: "Send Promotional Notifications to Customers", category: "integrations" },
  { key: "fcm_server_key",            value: "",         label: "FCM Server Key / API Key",               category: "integrations" },
  { key: "fcm_project_id",            value: "",         label: "Firebase Project ID",                    category: "integrations" },
  { key: "fcm_sender_id",             value: "",         label: "Firebase Sender ID",                     category: "integrations" },
  { key: "fcm_app_id",                value: "",         label: "Firebase App ID",                        category: "integrations" },
  { key: "fcm_vapid_key",             value: "",         label: "VAPID Web Push Key",                     category: "integrations" },
  /* SMS Gateway */
  { key: "integration_sms",           value: "off",      label: "SMS Notifications",                      category: "integrations" },
  { key: "sms_provider",              value: "console",  label: "SMS Provider (console/twilio/msg91)",    category: "integrations" },
  { key: "sms_api_key",               value: "",         label: "SMS API Key / Auth Token",               category: "integrations" },
  { key: "sms_account_sid",           value: "",         label: "Twilio Account SID",                     category: "integrations" },
  { key: "sms_sender_id",             value: "",         label: "SMS Sender ID / From Number",            category: "integrations" },
  { key: "sms_msg91_key",             value: "",         label: "MSG91 Auth Key",                         category: "integrations" },
  { key: "sms_template_otp",          value: "Your AJKMart OTP is {otp}. Valid for 5 minutes.", label: "OTP SMS Template", category: "integrations" },
  { key: "sms_template_order",        value: "Your order #{id} status: {status}. AJKMart", label: "Order SMS Template", category: "integrations" },
  /* Email — SMTP */
  { key: "integration_email",         value: "off",      label: "Email Admin Alerts (SMTP)",              category: "integrations" },
  { key: "smtp_host",                 value: "",         label: "SMTP Host",                              category: "integrations" },
  { key: "smtp_port",                 value: "587",      label: "SMTP Port",                              category: "integrations" },
  { key: "smtp_user",                 value: "",         label: "SMTP Username / Email Address",          category: "integrations" },
  { key: "smtp_password",             value: "",         label: "SMTP Password / App Password",           category: "integrations" },
  { key: "smtp_from_email",           value: "",         label: "From Email Address",                     category: "integrations" },
  { key: "smtp_from_name",            value: "AJKMart",  label: "From Display Name",                      category: "integrations" },
  { key: "smtp_secure",               value: "tls",      label: "Encryption Mode (tls/ssl/none)",         category: "integrations" },
  { key: "smtp_admin_alert_email",    value: "",         label: "Admin Alert Recipient Email",            category: "integrations" },
  /* WhatsApp Business */
  { key: "integration_whatsapp",      value: "off",      label: "WhatsApp Business Notifications",        category: "integrations" },
  { key: "wa_phone_number_id",        value: "",         label: "WhatsApp Phone Number ID",               category: "integrations" },
  { key: "wa_access_token",           value: "",         label: "Permanent Access Token",                 category: "integrations" },
  { key: "wa_verify_token",           value: "",         label: "Webhook Verify Token",                   category: "integrations" },
  { key: "wa_business_account_id",    value: "",         label: "WhatsApp Business Account ID",           category: "integrations" },
  { key: "wa_order_template",         value: "order_notification", label: "Order Notification Template", category: "integrations" },
  { key: "wa_otp_template",           value: "otp_verification",   label: "OTP Template Name",           category: "integrations" },
  /* Analytics */
  { key: "integration_analytics",     value: "off",      label: "Analytics & Event Tracking",             category: "integrations" },
  { key: "analytics_platform",        value: "none",     label: "Analytics Platform (none/google/mixpanel/amplitude)", category: "integrations" },
  { key: "analytics_tracking_id",     value: "",         label: "Tracking / Measurement ID",              category: "integrations" },
  { key: "analytics_api_secret",      value: "",         label: "Analytics API Secret",                   category: "integrations" },
  { key: "analytics_debug_mode",      value: "off",      label: "Analytics Debug Mode",                   category: "integrations" },
  /* Sentry — Error Monitoring */
  { key: "integration_sentry",        value: "off",      label: "Error Monitoring (Sentry)",              category: "integrations" },
  { key: "sentry_dsn",                value: "",         label: "Sentry DSN URL",                         category: "integrations" },
  { key: "sentry_environment",        value: "production", label: "Sentry Environment",                   category: "integrations" },
  { key: "sentry_sample_rate",        value: "100",      label: "Error Sample Rate (%)",                  category: "integrations" },
  { key: "sentry_traces_sample_rate", value: "10",       label: "Performance Traces Sample Rate (%)",     category: "integrations" },
  /* Google Maps */
  { key: "integration_maps",          value: "off",      label: "Google Maps (Location & Tracking)",      category: "integrations" },
  { key: "maps_api_key",              value: "",         label: "Google Maps API Key",                    category: "integrations" },
  { key: "maps_distance_matrix",      value: "on",       label: "Distance Matrix API",                    category: "integrations" },
  { key: "maps_places_autocomplete",  value: "on",       label: "Places Autocomplete API",                category: "integrations" },
  { key: "maps_geocoding",            value: "on",       label: "Geocoding API",                          category: "integrations" },
  /* ═══════════════════  JazzCash Payment Gateway  ═══════════════════ */
  { key: "jazzcash_enabled",           value: "off",      label: "JazzCash Enable",                      category: "payment" },
  { key: "jazzcash_type",              value: "manual",   label: "JazzCash Mode (api/manual)",           category: "payment" },
  { key: "jazzcash_mode",              value: "sandbox",  label: "API Environment",                      category: "payment" },
  { key: "jazzcash_merchant_id",       value: "",         label: "API Merchant ID",                      category: "payment" },
  { key: "jazzcash_password",          value: "",         label: "API Password",                         category: "payment" },
  { key: "jazzcash_salt",              value: "",         label: "API Integrity Salt",                   category: "payment" },
  { key: "jazzcash_currency",          value: "PKR",      label: "Currency",                             category: "payment" },
  { key: "jazzcash_return_url",        value: "",         label: "API Return URL",                       category: "payment" },
  { key: "jazzcash_manual_name",          value: "",         label: "Manual - Account Holder Name",         category: "payment" },
  { key: "jazzcash_manual_number",        value: "",         label: "Manual - JazzCash Number",             category: "payment" },
  { key: "jazzcash_manual_instructions",  value: "Upar diye gaye Jazz number par payment karein aur Transaction ID hamein WhatsApp karein.", label: "Manual - Payment Instructions", category: "payment" },
  { key: "jazzcash_proof_required",       value: "on",       label: "Require Payment Screenshot/Proof",     category: "payment" },
  { key: "jazzcash_min_amount",           value: "100",      label: "Minimum JazzCash Payment (Rs.)",       category: "payment" },
  { key: "jazzcash_max_amount",           value: "50000",    label: "Maximum JazzCash Payment (Rs.)",       category: "payment" },
  /* ═══════════════════  EasyPaisa Payment Gateway  ═══════════════════ */
  { key: "easypaisa_enabled",             value: "off",      label: "EasyPaisa Enable",                     category: "payment" },
  { key: "easypaisa_type",               value: "manual",   label: "EasyPaisa Mode (api/manual)",          category: "payment" },
  { key: "easypaisa_mode",               value: "sandbox",  label: "API Environment",                      category: "payment" },
  { key: "easypaisa_store_id",           value: "",         label: "API Store ID",                         category: "payment" },
  { key: "easypaisa_merchant_id",        value: "",         label: "API Merchant Account",                 category: "payment" },
  { key: "easypaisa_hash_key",           value: "",         label: "API Hash Key",                         category: "payment" },
  { key: "easypaisa_username",           value: "",         label: "API Username",                         category: "payment" },
  { key: "easypaisa_password",           value: "",         label: "API Password",                         category: "payment" },
  { key: "easypaisa_manual_name",        value: "",         label: "Manual - Account Holder Name",         category: "payment" },
  { key: "easypaisa_manual_number",      value: "",         label: "Manual - EasyPaisa Number",            category: "payment" },
  { key: "easypaisa_manual_instructions", value: "Upar diye gaye EasyPaisa number par payment karein aur Transaction ID hamein bhejein.", label: "Manual - Payment Instructions", category: "payment" },
  { key: "easypaisa_proof_required",     value: "on",       label: "Require Payment Screenshot/Proof",     category: "payment" },
  { key: "easypaisa_min_amount",         value: "100",      label: "Minimum EasyPaisa Payment (Rs.)",      category: "payment" },
  { key: "easypaisa_max_amount",         value: "50000",    label: "Maximum EasyPaisa Payment (Rs.)",      category: "payment" },
  /* ═══════════════════  Bank Transfer  ═══════════════════ */
  { key: "bank_enabled",                 value: "off",      label: "Bank Transfer Enable",                 category: "payment" },
  { key: "bank_name",                    value: "",         label: "Bank Name",                            category: "payment" },
  { key: "bank_account_title",           value: "",         label: "Account Title (Holder Name)",          category: "payment" },
  { key: "bank_account_number",          value: "",         label: "Account Number",                       category: "payment" },
  { key: "bank_iban",                    value: "",         label: "IBAN",                                 category: "payment" },
  { key: "bank_branch_code",             value: "",         label: "Branch Code",                          category: "payment" },
  { key: "bank_swift_code",              value: "",         label: "SWIFT / BIC Code",                     category: "payment" },
  { key: "bank_instructions",            value: "Account par transfer karen aur receipt WhatsApp Karen. Order 2-4 hours mein confirm hogi.", label: "Transfer Instructions", category: "payment" },
  { key: "bank_proof_required",          value: "on",       label: "Require Bank Slip/Screenshot",         category: "payment" },
  { key: "bank_min_amount",              value: "500",      label: "Minimum Bank Transfer (Rs.)",          category: "payment" },
  { key: "bank_processing_hours",        value: "24",       label: "Processing Time (hours)",              category: "payment" },
  /* ═══════════════════  Cash on Delivery  ═══════════════════ */
  { key: "cod_enabled",                  value: "on",       label: "Cash on Delivery Enable",              category: "payment" },
  { key: "cod_max_amount",               value: "5000",     label: "Max COD Order Amount (Rs.)",           category: "payment" },
  { key: "cod_fee",                      value: "0",        label: "COD Service Fee (Rs.)",                category: "payment" },
  { key: "cod_free_above",               value: "2000",     label: "Free COD Fee Above (Rs.)",             category: "payment" },
  { key: "cod_allowed_mart",             value: "on",       label: "COD for Mart/Grocery Orders",          category: "payment" },
  { key: "cod_allowed_food",             value: "on",       label: "COD for Food Delivery",                category: "payment" },
  { key: "cod_allowed_pharmacy",         value: "on",       label: "COD for Pharmacy Orders",              category: "payment" },
  { key: "cod_allowed_parcel",           value: "off",      label: "COD for Parcel Delivery",              category: "payment" },
  { key: "cod_verification_threshold",   value: "3000",     label: "Photo Verification Above (Rs.)",       category: "payment" },
  { key: "cod_fake_penalty",             value: "on",       label: "Block Repeat Fake COD Customers",      category: "payment" },
  { key: "cod_advance_pct",              value: "0",        label: "COD Advance Deposit Required (%)",     category: "payment" },
  { key: "cod_restricted_areas",         value: "",         label: "Restricted Areas (comma-separated)",   category: "payment" },
  { key: "cod_notes",                    value: "Rider ke aane par exact payment ready rakhein. Receipt zaroor lein.", label: "Customer Instructions", category: "payment" },
  /* ═══════════════════  AJK Wallet  ═══════════════════ */
  { key: "wallet_min_topup",             value: "100",      label: "Minimum Top-Up (Rs.)",                 category: "payment" },
  { key: "wallet_max_topup",             value: "25000",    label: "Maximum Single Top-Up (Rs.)",          category: "payment" },
  { key: "wallet_max_balance",           value: "50000",    label: "Maximum Wallet Balance (Rs.)",         category: "payment" },
  { key: "wallet_min_withdrawal",        value: "200",      label: "Minimum Withdrawal (Rs.)",             category: "payment" },
  { key: "wallet_max_withdrawal",        value: "10000",    label: "Maximum Single Withdrawal (Rs.)",      category: "payment" },
  { key: "wallet_daily_limit",           value: "20000",    label: "Daily Transaction Limit (Rs.)",        category: "payment" },
  { key: "wallet_cashback_pct",          value: "0",        label: "Wallet Cashback (%)",                  category: "payment" },
  { key: "wallet_topup_methods",         value: "jazzcash,easypaisa,bank,rider", label: "Accepted Top-Up Methods", category: "payment" },
  { key: "wallet_mpin_enabled",          value: "on",       label: "MPIN Enforcement (Wallet Send/Withdraw)", category: "features" },
  { key: "wallet_p2p_enabled",           value: "on",       label: "Allow P2P Money Transfer",             category: "payment" },
  { key: "wallet_p2p_daily_limit",       value: "10000",    label: "P2P Daily Send Limit (Rs.)",           category: "payment" },
  { key: "wallet_kyc_required",          value: "off",      label: "KYC Required Before Activation",       category: "payment" },
  { key: "wallet_cashback_on_orders",    value: "on",       label: "Cashback on Mart/Food Orders",         category: "payment" },
  { key: "wallet_cashback_on_rides",     value: "off",      label: "Cashback on Rides",                    category: "payment" },
  { key: "wallet_cashback_on_pharmacy",  value: "off",      label: "Cashback on Pharmacy",                 category: "payment" },
  { key: "wallet_expiry_days",           value: "0",        label: "Wallet Balance Expiry (days, 0=never)",category: "payment" },
  { key: "wallet_withdrawal_processing", value: "24",       label: "Withdrawal Processing Time (hours)",   category: "payment" },
  /* ═══════════════════  Payment General Rules  ═══════════════════ */
  { key: "payment_timeout_mins",         value: "15",       label: "Payment Timeout (minutes)",            category: "payment" },
  { key: "payment_auto_cancel",          value: "on",       label: "Auto-Cancel Unpaid Orders",            category: "payment" },
  { key: "payment_min_online",           value: "50",       label: "Minimum Online Payment (Rs.)",         category: "payment" },
  { key: "payment_max_online",           value: "100000",   label: "Maximum Online Payment (Rs.)",         category: "payment" },
  { key: "payment_receipt_required",     value: "on",       label: "Require Receipt for Manual Payments",  category: "payment" },
  { key: "payment_verify_window_hours",  value: "4",        label: "Manual Payment Verify Window (hours)", category: "payment" },

  /* ═══════════════════  Maps / Tracking  ═══════════════════ */
  { key: "maps_base_fare",       value: "50",   label: "Maps Base Fare (Rs.)",                    category: "integrations" },
  { key: "maps_per_km_rate",     value: "25",   label: "Maps Per KM Rate (Rs.)",                  category: "integrations" },
  { key: "maps_max_radius_km",   value: "15",   label: "Maps Max Delivery Radius (KM)",           category: "integrations" },
  { key: "maps_surge_multiplier",value: "1.5",  label: "Maps Surge Multiplier",                   category: "integrations" },
  { key: "maps_use_customer_app",value: "on",   label: "Use Maps in Customer App",                category: "integrations" },
  { key: "maps_use_rider_app",   value: "on",   label: "Use Maps in Rider App",                   category: "integrations" },
  { key: "maps_use_vendor_app",  value: "off",  label: "Use Maps in Vendor App",                  category: "integrations" },
  { key: "maps_live_tracking",   value: "on",   label: "Live Order Tracking Enabled",             category: "integrations" },

  /* ═══════════════════  Email Admin Alerts  ═══════════════════ */
  { key: "email_alert_new_vendor",        value: "on",  label: "Email Alert: New Vendor Registration",   category: "integrations" },
  { key: "email_alert_high_value_order",  value: "on",  label: "Email Alert: High Value Order",          category: "integrations" },
  { key: "email_alert_fraud",             value: "on",  label: "Email Alert: Fraud / Fake Order",        category: "integrations" },
  { key: "email_alert_low_balance",       value: "on",  label: "Email Alert: Low Wallet Balance",        category: "integrations" },
  { key: "email_alert_daily_summary",     value: "off", label: "Email Alert: Daily Summary Report",      category: "integrations" },
  { key: "email_alert_weekly_report",     value: "off", label: "Email Alert: Weekly Revenue Report",     category: "integrations" },

  /* ═══════════════════  WhatsApp Send Flags  ═══════════════════ */
  { key: "wa_send_otp",          value: "on",  label: "WhatsApp: Send OTP Messages",             category: "integrations" },
  { key: "wa_send_order_update", value: "on",  label: "WhatsApp: Send Order Status Updates",     category: "integrations" },
  { key: "wa_send_ride_update",  value: "on",  label: "WhatsApp: Send Ride Status Updates",      category: "integrations" },
  { key: "wa_send_promo",        value: "off", label: "WhatsApp: Send Promotional Messages",     category: "integrations" },
  { key: "wa_send_rider_notif",  value: "on",  label: "WhatsApp: Send Rider Assignment Alerts",  category: "integrations" },
  { key: "wa_send_vendor_notif", value: "on",  label: "WhatsApp: Send New Order to Vendor",      category: "integrations" },

  /* ═══════════════════  Analytics Event Tracking  ═══════════════════ */
  { key: "track_order_placed",   value: "on",  label: "Track: Order Placed Events",              category: "integrations" },
  { key: "track_ride_booked",    value: "on",  label: "Track: Ride Booked Events",               category: "integrations" },
  { key: "track_user_signup",    value: "on",  label: "Track: User Signup Events",               category: "integrations" },
  { key: "track_wallet_topup",   value: "on",  label: "Track: Wallet Top-Up Events",             category: "integrations" },
  { key: "track_screen_views",   value: "on",  label: "Track: Screen / Page Views",              category: "integrations" },
  { key: "track_search_queries", value: "off", label: "Track: Search Query Events",              category: "integrations" },

  /* ═══════════════════  Sentry Capture Flags  ═══════════════════ */
  { key: "sentry_capture_api",       value: "on",  label: "Sentry: Capture API Server Errors",   category: "integrations" },
  { key: "sentry_capture_admin",     value: "on",  label: "Sentry: Capture Admin Panel Errors",  category: "integrations" },
  { key: "sentry_capture_vendor",    value: "off", label: "Sentry: Capture Vendor App Errors",   category: "integrations" },
  { key: "sentry_capture_rider",     value: "off", label: "Sentry: Capture Rider App Errors",    category: "integrations" },
  { key: "sentry_capture_unhandled", value: "on",  label: "Sentry: Capture Unhandled Rejections",category: "integrations" },
  { key: "sentry_capture_perf",      value: "on",  label: "Sentry: Performance Monitoring",      category: "integrations" },


  { key: "auth_phone_otp_enabled",         value: JSON.stringify({ customer: "on", rider: "on", vendor: "on" }),   label: "Phone OTP Login Enabled",              category: "auth" },
  { key: "auth_email_otp_enabled",         value: JSON.stringify({ customer: "off", rider: "off", vendor: "off" }),   label: "Email OTP Login Enabled",              category: "auth" },
  { key: "auth_username_password_enabled", value: JSON.stringify({ customer: "off", rider: "off", vendor: "off" }),   label: "Username/Password Login Enabled",     category: "auth" },
  { key: "auth_google_enabled",            value: JSON.stringify({ customer: "off", rider: "off", vendor: "off" }), label: "Google Social Login Enabled",           category: "auth" },
  { key: "auth_facebook_enabled",          value: JSON.stringify({ customer: "off", rider: "off", vendor: "off" }), label: "Facebook Social Login Enabled",         category: "auth" },
  { key: "auth_email_register_enabled",    value: JSON.stringify({ customer: "on", rider: "on", vendor: "on" }),   label: "Email Registration (no OTP) Enabled",  category: "auth" },
  { key: "auth_biometric_enabled",         value: JSON.stringify({ customer: "off", rider: "off", vendor: "off" }), label: "Biometric Login Enabled",              category: "auth" },
  { key: "auth_captcha_enabled",           value: "off", label: "reCAPTCHA v3 Verification Enabled",    category: "auth" },
  { key: "auth_2fa_enabled",              value: JSON.stringify({ customer: "off", rider: "off", vendor: "off" }), label: "Two-Factor Authentication Enabled",    category: "auth" },
  { key: "auth_magic_link_enabled",       value: JSON.stringify({ customer: "off", rider: "off", vendor: "off" }), label: "Magic Link Login Enabled",             category: "auth" },
  { key: "recaptcha_site_key",            value: "",    label: "reCAPTCHA v3 Site Key",                category: "auth" },
  { key: "recaptcha_secret_key",          value: "",    label: "reCAPTCHA v3 Secret Key",              category: "auth" },
  { key: "recaptcha_min_score",           value: "0.5", label: "reCAPTCHA Minimum Score Threshold",    category: "auth" },
  { key: "security_otp_cooldown_sec",     value: "60",  label: "OTP Resend Cooldown (seconds)",                   category: "auth" },
  { key: "security_otp_max_per_phone",    value: "5",   label: "Max OTP Sends Per Phone/Email (per window)",      category: "auth" },
  { key: "security_otp_max_per_ip",       value: "10",  label: "Max OTP Sends Per IP Address (per window)",       category: "auth" },
  { key: "security_otp_window_min",       value: "60",  label: "OTP Rate Limit Window (minutes)",                 category: "auth" },
  { key: "otp_debug_mode",               value: "off", label: "OTP Debug Mode — log OTP to server logger (non-production only)", category: "auth" },
  { key: "primary_otp_channel",          value: "sms", label: "Primary OTP Delivery Channel (sms / whatsapp / email / all)", category: "auth" },
  { key: "provider_credentials",         value: "{}",  label: "Provider Credentials JSON (Twilio/Msg91/SMTP overrides)", category: "auth" },
  { key: "auth_social_google",            value: "off",  label: "Google Social Login (legacy toggle)",  category: "auth" },
  { key: "auth_social_facebook",          value: "off",  label: "Facebook Social Login (legacy toggle)",category: "auth" },
  { key: "google_client_id",             value: "",     label: "Google OAuth Client ID",               category: "auth" },
  { key: "facebook_app_id",              value: "",     label: "Facebook App ID",                      category: "auth" },
  { key: "auth_trusted_device_days",      value: "30",   label: "Trusted Device Expiry (days)",         category: "auth" },
  /* ═══════════════════  Ride Dispatch Engine  ═══════════════════ */
  { key: "dispatch_request_timeout_sec",      value: "30",   label: "Rider Accept Timeout (seconds)",                    category: "rides" },
  { key: "dispatch_max_loops",                value: "2",    label: "Max Dispatch Loops Before Expiry",                  category: "rides" },
  { key: "dispatch_min_radius_km",            value: "5",    label: "Min Request Radius (KM)",                           category: "rides" },
  { key: "dispatch_ride_start_proximity_m",   value: "200",  label: "Ride Start Proximity (meters from pickup)",         category: "rides" },
  { key: "dispatch_avg_speed_kmh",            value: "25",   label: "Average Rider Speed for ETA (km/h)",                category: "rides" },
  /* ═══════════════════  Rider Ignore Penalty  ═══════════════════ */
  { key: "dispatch_ignore_threshold",         value: "10",   label: "Ignore Threshold (per day)",                        category: "rides" },
  { key: "dispatch_ignore_penalty",           value: "25",   label: "Ignore Penalty Amount (Rs.)",                       category: "rides" },
  { key: "rider_ignore_limit_daily",          value: "5",    label: "Max Ignores Per Day Before Penalty",                category: "rider" },
  { key: "rider_ignore_penalty_amount",       value: "30",   label: "Ignore Penalty Amount (Rs.)",                       category: "rider" },
  { key: "rider_ignore_restrict_enabled",     value: "off",  label: "Auto-Restrict Rider on Excessive Ignores",          category: "rider" },
  /* ═══════════════════  Ride Payment Method Toggles (legacy)  ═══════════════════ */
  { key: "ride_payment_cash",                 value: "on",   label: "Cash Payment for Rides",                            category: "rides" },
  { key: "ride_payment_wallet",               value: "on",   label: "Wallet Payment for Rides",                          category: "rides" },
  { key: "ride_payment_jazzcash",             value: "off",  label: "JazzCash Direct Payment for Rides",                 category: "rides" },
  { key: "ride_payment_easypaisa",            value: "off",  label: "EasyPaisa Direct Payment for Rides",                category: "rides" },
  /* ═══════════════════  Per-Service Payment Availability  ═══════════════════ */
  { key: "jazzcash_allowed_mart",             value: "on",   label: "JazzCash Available for Mart",                       category: "payment" },
  { key: "jazzcash_allowed_food",             value: "on",   label: "JazzCash Available for Food",                       category: "payment" },
  { key: "jazzcash_allowed_pharmacy",         value: "on",   label: "JazzCash Available for Pharmacy",                   category: "payment" },
  { key: "jazzcash_allowed_parcel",           value: "on",   label: "JazzCash Available for Parcel",                     category: "payment" },
  { key: "jazzcash_allowed_rides",            value: "on",   label: "JazzCash Available for Rides",                      category: "payment" },
  { key: "easypaisa_allowed_mart",            value: "on",   label: "EasyPaisa Available for Mart",                      category: "payment" },
  { key: "easypaisa_allowed_food",            value: "on",   label: "EasyPaisa Available for Food",                      category: "payment" },
  { key: "easypaisa_allowed_pharmacy",        value: "on",   label: "EasyPaisa Available for Pharmacy",                  category: "payment" },
  { key: "easypaisa_allowed_parcel",          value: "on",   label: "EasyPaisa Available for Parcel",                    category: "payment" },
  { key: "easypaisa_allowed_rides",           value: "on",   label: "EasyPaisa Available for Rides",                     category: "payment" },
  { key: "bank_allowed_mart",                 value: "on",   label: "Bank Transfer Available for Mart",                  category: "payment" },
  { key: "bank_allowed_food",                 value: "on",   label: "Bank Transfer Available for Food",                  category: "payment" },
  { key: "bank_allowed_pharmacy",             value: "on",   label: "Bank Transfer Available for Pharmacy",              category: "payment" },
  { key: "bank_allowed_parcel",               value: "on",   label: "Bank Transfer Available for Parcel",                category: "payment" },
  { key: "bank_allowed_rides",                value: "on",   label: "Bank Transfer Available for Rides",                 category: "payment" },
  { key: "wallet_allowed_mart",               value: "on",   label: "Wallet Available for Mart",                         category: "payment" },
  { key: "wallet_allowed_food",               value: "on",   label: "Wallet Available for Food",                         category: "payment" },
  { key: "wallet_allowed_pharmacy",           value: "on",   label: "Wallet Available for Pharmacy",                     category: "payment" },
  { key: "wallet_allowed_parcel",             value: "on",   label: "Wallet Available for Parcel",                       category: "payment" },
  { key: "wallet_allowed_rides",              value: "on",   label: "Wallet Available for Rides",                        category: "payment" },
  { key: "cod_allowed_rides",                 value: "on",   label: "COD Available for Rides",                           category: "payment" },
  { key: "wallet_p2p_fee_pct",               value: "0",    label: "P2P Transfer Fee (%)",                              category: "payment" },
  { key: "wallet_deposit_auto_approve",      value: "0",    label: "Auto-Approve Deposits Up To (Rs.)",                 category: "payment" },
  { key: "wallet_mpin_enabled",             value: "on",   label: "Require MPIN for Wallet Transactions",               category: "payment" },
  { key: "security_lockout_enabled",         value: "on",   label: "Login Lockout Policy Enabled",                      category: "security" },
  { key: "service_cities",                   value: "",     label: "Service Cities (comma-separated, blank=all)",        category: "general" },
  /* Map Configuration */
  { key: "map_provider_primary",            value: "osm",      label: "Primary Map Provider (osm|mapbox|google)",           category: "map" },
  { key: "map_provider_secondary",          value: "osm",      label: "Secondary/Failover Map Provider",                    category: "map" },
  { key: "map_failover_enabled",            value: "on",       label: "Auto-Failover to Secondary Provider",                category: "map" },
  { key: "mapbox_api_key",                  value: "",         label: "Mapbox Access Token",                                category: "map" },
  { key: "mapbox_enabled",                  value: "off",      label: "Mapbox GL JS Enabled",                               category: "map" },
  { key: "google_maps_api_key",             value: "",         label: "Google Maps API Key",                                category: "map" },
  { key: "google_maps_enabled",             value: "off",      label: "Google Maps Enabled",                                category: "map" },
  { key: "osm_enabled",                     value: "on",       label: "OpenStreetMap Enabled",                              category: "map" },
  { key: "routing_engine",                  value: "osrm",     label: "Routing Engine (mapbox|google|osrm)",                category: "map" },
  { key: "map_app_override_customer",       value: "primary",  label: "Customer App Map Provider Override",                 category: "map" },
  { key: "map_app_override_rider",          value: "primary",  label: "Rider App Map Provider Override",                    category: "map" },
  { key: "map_app_override_vendor",         value: "primary",  label: "Vendor App Map Provider Override",                   category: "map" },
  { key: "map_app_override_admin",          value: "primary",  label: "Admin Fleet Map Provider Override",                  category: "map" },
  { key: "map_provider_role_osm",           value: "primary",  label: "OSM Provider Role (primary|secondary|both|disabled)", category: "map" },
  { key: "map_provider_role_mapbox",        value: "disabled", label: "Mapbox Provider Role (primary|secondary|both|disabled)", category: "map" },
  { key: "map_provider_role_google",        value: "disabled", label: "Google Maps Provider Role (primary|secondary|both|disabled)", category: "map" },
  { key: "routing_mapbox_per_km_rate",      value: "25",       label: "Mapbox Routing Per-KM Rate (Rs.)",                   category: "map" },
  { key: "routing_mapbox_base_fare",        value: "50",       label: "Mapbox Routing Base Fare (Rs.)",                     category: "map" },
  { key: "routing_mapbox_surge_mult",       value: "1.5",      label: "Mapbox Routing Surge Multiplier",                    category: "map" },
  { key: "routing_mapbox_max_radius_km",    value: "15",       label: "Mapbox Routing Max Radius (KM)",                     category: "map" },
  { key: "routing_google_per_km_rate",      value: "25",       label: "Google Routing Per-KM Rate (Rs.)",                   category: "map" },
  { key: "routing_google_base_fare",        value: "50",       label: "Google Routing Base Fare (Rs.)",                     category: "map" },
  { key: "routing_google_surge_mult",       value: "1.5",      label: "Google Routing Surge Multiplier",                    category: "map" },
  { key: "routing_google_max_radius_km",    value: "15",       label: "Google Routing Max Radius (KM)",                     category: "map" },
  { key: "routing_osrm_per_km_rate",        value: "25",       label: "OSRM Routing Per-KM Rate (Rs.)",                     category: "map" },
  { key: "routing_osrm_base_fare",          value: "50",       label: "OSRM Routing Base Fare (Rs.)",                       category: "map" },
  { key: "routing_osrm_surge_mult",         value: "1.5",      label: "OSRM Routing Surge Multiplier",                      category: "map" },
  { key: "routing_osrm_max_radius_km",      value: "15",       label: "OSRM Routing Max Radius (KM)",                       category: "map" },
  { key: "fare_ride_per_km_rate",           value: "25",       label: "Ride Fare Per-KM Rate (Rs.)",                        category: "map" },
  { key: "fare_ride_base_fare",             value: "50",       label: "Ride Base Fare (Rs.)",                               category: "map" },
  { key: "fare_ride_surge_mult",            value: "1.5",      label: "Ride Surge Multiplier",                              category: "map" },
  { key: "fare_ride_max_radius_km",         value: "30",       label: "Ride Max Radius (KM)",                               category: "map" },
  { key: "fare_delivery_per_km_rate",       value: "20",       label: "Delivery Fare Per-KM Rate (Rs.)",                    category: "map" },
  { key: "fare_delivery_base_fare",         value: "40",       label: "Delivery Base Fare (Rs.)",                           category: "map" },
  { key: "fare_delivery_surge_mult",        value: "1.2",      label: "Delivery Surge Multiplier",                          category: "map" },
  { key: "fare_delivery_max_radius_km",     value: "15",       label: "Delivery Max Radius (KM)",                           category: "map" },
  { key: "fare_parcel_per_km_rate",         value: "30",       label: "Parcel Fare Per-KM Rate (Rs.)",                      category: "map" },
  { key: "fare_parcel_base_fare",           value: "60",       label: "Parcel Base Fare (Rs.)",                             category: "map" },
  { key: "fare_parcel_surge_mult",          value: "1.3",      label: "Parcel Surge Multiplier",                            category: "map" },
  { key: "fare_parcel_max_radius_km",       value: "20",       label: "Parcel Max Radius (KM)",                             category: "map" },
  { key: "geocode_cache_ttl_min",           value: "10",       label: "Geocode Cache TTL (minutes)",                        category: "map" },
  { key: "geocode_cache_max_size",          value: "200",      label: "Geocode Cache Max Size (entries)",                   category: "map" },
  { key: "tracking_distance_threshold",     value: "10",       label: "Location Save Threshold (metres, 0 = save every point)", category: "map" },
  { key: "map_last_tested_osm",             value: "",         label: "OSM Last Test Timestamp",                            category: "map" },
  { key: "map_last_tested_mapbox",          value: "",         label: "Mapbox Last Test Timestamp",                         category: "map" },
  { key: "map_last_tested_google",          value: "",         label: "Google Maps Last Test Timestamp",                    category: "map" },
  { key: "map_test_status_osm",             value: "unknown",  label: "OSM Test Status (ok|fail|unknown)",                  category: "map" },
  { key: "map_test_status_mapbox",          value: "unknown",  label: "Mapbox Test Status (ok|fail|unknown)",               category: "map" },
  { key: "map_test_status_google",          value: "unknown",  label: "Google Maps Test Status (ok|fail|unknown)",          category: "map" },
  /* LocationIQ */
  { key: "locationiq_api_key",              value: "",         label: "LocationIQ API Key / Access Token",                  category: "map" },
  { key: "locationiq_enabled",              value: "off",      label: "LocationIQ Enabled",                                 category: "map" },
  { key: "map_provider_role_locationiq",    value: "disabled", label: "LocationIQ Provider Role (primary|secondary|both|disabled)", category: "map" },
  { key: "map_test_status_locationiq",      value: "unknown",  label: "LocationIQ Test Status (ok|fail|unknown)",           category: "map" },
  { key: "map_last_tested_locationiq",      value: "",         label: "LocationIQ Last Test Timestamp",                     category: "map" },
  /* Search & geocoding provider (key used by frontend MapsMgmtSection) */
  { key: "map_search_provider",             value: "locationiq", label: "Search & Geocoding Provider (locationiq|google|osm)", category: "map" },
];

let _authMethodColumnMigrated = false;
export async function ensureAuthMethodColumn() {
  if (_authMethodColumnMigrated) return;
  try {
    await db.execute(sql`ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS auth_method TEXT`);
  } catch { /* column likely already exists */ }
  _authMethodColumnMigrated = true;
}

let _ordersGpsMigrated = false;
export async function ensureOrdersGpsColumns() {
  if (_ordersGpsMigrated) return;
  try {
    await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_lat DECIMAL(10,7)`);
    await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_lng DECIMAL(10,7)`);
    await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS gps_accuracy DOUBLE PRECISION`);
    await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS gps_mismatch BOOLEAN DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_lat DECIMAL(10,7)`);
    await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_lng DECIMAL(10,7)`);
  } catch { /* columns likely already exist */ }
  _ordersGpsMigrated = true;
}

let _rideBidsMigrated = false;
export async function ensureRideBidsMigration() {
  if (_rideBidsMigrated) return;
  try {
    await db.execute(sql`ALTER TABLE ride_bids ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`);
    await db.execute(sql`
      UPDATE ride_bids SET expires_at = created_at + INTERVAL '30 minutes'
      WHERE expires_at IS NULL AND status = 'pending'
    `);
    await db.execute(sql`
      UPDATE ride_bids SET expires_at = updated_at
      WHERE expires_at IS NULL
    `);
    await db.execute(sql`ALTER TABLE ride_bids ALTER COLUMN expires_at SET NOT NULL`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ride_bids_expires_at_idx ON ride_bids (expires_at)`);
    await db.execute(sql`
      DROP INDEX IF EXISTS rides_one_active_per_user_uidx
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS rides_one_active_per_user_uidx
        ON rides (user_id)
        WHERE status IN ('searching', 'bargaining', 'accepted', 'arrived', 'in_transit', 'dispatched', 'pending')
    `);
  } catch (e: unknown) {
    /* "column already exists" / "index already exists" / "relation already exists"
       are benign idempotency outcomes — log as debug.  Anything else is a real
       schema failure; log as error and do NOT mark migrated so the next request
       will retry rather than silently operating on a partially migrated schema. */
    const msg = e instanceof Error ? e.message : String(e);
    const isIdempotent = /already exists|duplicate column|42701|42P07/i.test(msg);
    if (isIdempotent) {
      logger.debug({ err: e }, "[migration] ride_bids expiry migration skipped (schema already in target state)");
    } else {
      logger.error({ err: e }, "[migration] ride_bids expiry migration FAILED — will retry on next request");
      return;
    }
  }
  _rideBidsMigrated = true;
}

let _idempotencyTableMigrated = false;
export async function ensureIdempotencyTable() {
  if (_idempotencyTableMigrated) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (key)
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idempotency_keys_created_at_idx ON idempotency_keys (created_at)
    `);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const isIdempotent = /already exists|42P07/i.test(msg);
    if (!isIdempotent) {
      logger.error({ err: e }, "[migration] idempotency_keys table creation FAILED — will retry on next request");
      return;
    }
  }
  _idempotencyTableMigrated = true;
}

let _walletNormalizedTxIdMigrated = false;
export async function ensureWalletNormalizedTxId() {
  if (_walletNormalizedTxIdMigrated) return;

  /* Step 1: Add column (idempotent). Throws on unexpected errors → startup aborts. */
  try {
    await db.execute(sql`
      ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS normalized_tx_id TEXT
    `);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/already exists|duplicate column|42701/i.test(msg)) {
      logger.fatal({ err: e }, "[migration] wallet normalizedTxId: FATAL — failed to add column");
      throw e;
    }
  }

  /* Step 2: Backfill existing deposit rows from the :txid: suffix in reference.
     NULL out any rows whose suffix is empty so they don't participate in the unique index. */
  try {
    /* Normalize the same way the request path does: trim + uppercase + collapse all whitespace.
       regexp_replace(..., '\s+', '', 'g') removes all internal whitespace characters. */
    await db.execute(sql`
      UPDATE wallet_transactions
      SET normalized_tx_id = UPPER(REGEXP_REPLACE(TRIM(SPLIT_PART(reference, ':txid:', 2)), '\s+', '', 'g'))
      WHERE type = 'deposit'
        AND reference LIKE '%:txid:%'
        AND normalized_tx_id IS NULL
        AND TRIM(SPLIT_PART(reference, ':txid:', 2)) <> ''
    `);
  } catch (e: unknown) {
    logger.fatal({ err: e }, "[migration] wallet normalizedTxId: FATAL — backfill failed");
    throw e;
  }

  /* Step 3: Null out backfilled values that are duplicates so the unique index can be created.
     Pre-existing duplicates (should not exist in a clean system) are resolved by keeping the
     oldest row and NULLing the rest so they fall outside the partial index scope.
     Data-quality warning is logged; this is a one-time repair and then throws are used. */
  try {
    const dupes = await db.execute<{ normalized_tx_id: string; cnt: string }>(sql`
      SELECT normalized_tx_id, COUNT(*) AS cnt
      FROM wallet_transactions
      WHERE type = 'deposit' AND normalized_tx_id IS NOT NULL
      GROUP BY normalized_tx_id
      HAVING COUNT(*) > 1
    `);
    if (dupes.rows.length > 0) {
      logger.warn({ count: dupes.rows.length }, "[migration] wallet normalizedTxId: pre-existing duplicate TxIDs found — NULLing duplicates (keeping oldest)");
      await db.execute(sql`
        UPDATE wallet_transactions SET normalized_tx_id = NULL
        WHERE id IN (
          SELECT id FROM (
            SELECT id,
              ROW_NUMBER() OVER (PARTITION BY normalized_tx_id ORDER BY created_at ASC) AS rn
            FROM wallet_transactions
            WHERE type = 'deposit' AND normalized_tx_id IS NOT NULL
          ) ranked
          WHERE rn > 1
        )
      `);
    }
  } catch (e: unknown) {
    logger.fatal({ err: e }, "[migration] wallet normalizedTxId: FATAL — duplicate-nulling step failed");
    throw e;
  }

  /* Step 4: Create partial unique index (idempotent).
     CRITICAL: If index creation fails for any non-idempotent reason, we throw so the
     startup chain receives the error and process.exit(1) is called.  The service must
     NOT start without this constraint — it is the DB-level deduplication guarantee. */
  try {
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS wallet_txn_deposit_normalized_tx_id_uidx
        ON wallet_transactions (normalized_tx_id)
        WHERE type = 'deposit' AND normalized_tx_id IS NOT NULL
    `);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/already exists|42P07/i.test(msg)) {
      logger.fatal({ err: e }, "[migration] wallet normalizedTxId: FATAL — unique index creation failed, deposit deduplication NOT enforced — refusing to start");
      throw e;
    }
  }

  logger.info("[migration] wallet normalizedTxId: migration complete");
  _walletNormalizedTxIdMigrated = true;
}

let _twoFactorEnforcedAtMigrated = false;
export async function ensureTwoFactorEnforcedAt() {
  if (_twoFactorEnforcedAtMigrated) return;

  try {
    await db.execute(sql`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enforced_at TIMESTAMPTZ
    `);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/already exists|duplicate column|42701/i.test(msg)) {
      logger.fatal({ err: e }, "[migration] twoFactorEnforcedAt: FATAL — failed to add column");
      throw e;
    }
  }

  logger.info("[migration] twoFactorEnforcedAt: migration complete");
  _twoFactorEnforcedAtMigrated = true;
}

let _profileCompleteMigrated = false;
export async function ensureProfileCompleteColumn() {
  if (_profileCompleteMigrated) return;

  const stmts = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_profile_complete BOOLEAN NOT NULL DEFAULT false`,
    /* Backfill: mark existing legitimate users as complete so they are not locked out */
    `UPDATE users SET is_profile_complete = true
     WHERE is_profile_complete = false
       AND phone_verified = true
       AND name IS NOT NULL AND name != ''
       AND (approval_status = 'approved' OR approval_status = 'pending')`,
    /* Add payload column to pending_otps so registration intent can be stored before OTP verification */
    `ALTER TABLE pending_otps ADD COLUMN IF NOT EXISTS payload TEXT`,
  ];

  for (const stmt of stmts) {
    try {
      await db.execute(sql.raw(stmt));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/already exists|duplicate column|42701/i.test(msg)) {
        logger.fatal({ err: e }, `[migration] profileComplete: FATAL — ${stmt}`);
        throw e;
      }
    }
  }

  logger.info("[migration] profileComplete: migration complete");
  _profileCompleteMigrated = true;
}

let _vendorAutoConfirmMigrated = false;
export async function ensureVendorAutoConfirmColumn() {
  if (_vendorAutoConfirmMigrated) return;
  try {
    await db.execute(sql.raw(`ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS auto_confirm BOOLEAN NOT NULL DEFAULT false`));
    logger.info("[migration] vendorAutoConfirm: migration complete");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/already exists|duplicate column|42701/i.test(msg)) {
      logger.fatal({ err: e }, "[migration] vendorAutoConfirm: FATAL");
      throw e;
    }
  }
  _vendorAutoConfirmMigrated = true;
}

let _silenceModeMigrated = false;
export async function ensureSilenceModeColumns() {
  if (_silenceModeMigrated) return;

  const alterations = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS silence_mode BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS silence_mode_until TIMESTAMPTZ`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active TIMESTAMPTZ`,
  ];

  for (const stmt of alterations) {
    try {
      await db.execute(sql.raw(stmt));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/already exists|duplicate column|42701/i.test(msg)) {
        logger.fatal({ err: e }, `[migration] silenceMode: FATAL — ${stmt}`);
        throw e;
      }
    }
  }

  logger.info("[migration] silenceMode: migration complete");
  _silenceModeMigrated = true;
}

let _otpSettingsSeeded = false;
export async function ensureOtpSettings() {
  if (_otpSettingsSeeded) return;
  try {
    await db.insert(platformSettingsTable).values([
      { key: "otp_debug_mode",       value: "off", label: "OTP Debug Mode — log OTP to server logger (non-production only)", category: "auth" },
      { key: "primary_otp_channel",  value: "sms", label: "Primary OTP Delivery Channel (sms / whatsapp / email / all)",    category: "auth" },
      { key: "provider_credentials", value: "{}",  label: "Provider Credentials JSON (Twilio/Msg91/SMTP overrides)",        category: "auth" },
    ]).onConflictDoNothing();
    logger.debug("[migration] OTP settings seeded");
  } catch (e: unknown) {
    logger.error({ err: e }, "[migration] ensureOtpSettings FAILED");
    return;
  }
  _otpSettingsSeeded = true;
}

/* ── Platform settings in-memory cache (10s TTL) ──────────────────────────
 * Prevents hammering the DB on every fare-calculation request while still
 * ensuring admin updates take effect within seconds.  Call
 * invalidatePlatformSettingsCache() immediately after any admin save so
 * the very next request re-reads from the DB. */
let _platformSettingsCache: Record<string, string> | null = null;
let _platformSettingsCacheExpiry = 0;

export function invalidatePlatformSettingsCache(): void {
  _platformSettingsCache = null;
  _platformSettingsCacheExpiry = 0;
}

export async function getPlatformSettings(): Promise<Record<string, string>> {
  if (_platformSettingsCache && Date.now() < _platformSettingsCacheExpiry) {
    return _platformSettingsCache;
  }
  await db.insert(platformSettingsTable).values(DEFAULT_PLATFORM_SETTINGS).onConflictDoNothing();
  const rows = await db.select().from(platformSettingsTable);
  _platformSettingsCache = Object.fromEntries(rows.map(r => [r.key, r.value]));
  _platformSettingsCacheExpiry = Date.now() + 10_000;
  return _platformSettingsCache;
}

export function getAdminSecret(): string {
  const s = process.env.ADMIN_SECRET;
  if (!s || s.length < 16) {
    logger.fatal("[AUTH] ADMIN_SECRET environment variable must be set and ≥16 characters.");
    process.exit(1);
  }
  return s;
}

export const adminLoginAttempts = new Map<string, { count: number; lockedUntil: number | null }>();
export const ADMIN_MAX_ATTEMPTS  = 5;
const ADMIN_LOCKOUT_MS    = 15 * 60 * 1000;

export function checkAdminLoginLockout(ip: string): { locked: boolean; minutesLeft: number } {
  const rec = adminLoginAttempts.get(ip);
  if (!rec?.lockedUntil) return { locked: false, minutesLeft: 0 };
  if (Date.now() < rec.lockedUntil) {
    const minutesLeft = Math.ceil((rec.lockedUntil - Date.now()) / 60_000);
    return { locked: true, minutesLeft };
  }
  adminLoginAttempts.delete(ip);
  return { locked: false, minutesLeft: 0 };
}

export function recordAdminLoginFailure(ip: string) {
  const rec = adminLoginAttempts.get(ip) || { count: 0, lockedUntil: null };
  rec.count += 1;
  if (rec.count >= ADMIN_MAX_ATTEMPTS) {
    rec.lockedUntil = Date.now() + ADMIN_LOCKOUT_MS;
  }
  adminLoginAttempts.set(ip, rec);
}

export function resetAdminLoginAttempts(ip: string) {
  adminLoginAttempts.delete(ip);
}
export async function adminAuth(req: Request, res: Response, next: NextFunction) {
  const ip = getClientIp(req);

  /* ── Prefer new signed admin JWT (x-admin-token header) ── */
  const adminTokenHeader = String(req.headers["x-admin-token"] || "");

  /* Load settings for IP whitelist check */
  const settings = await getPlatformSettings();

  /* ── Admin IP Whitelist ── */
  if (!checkAdminIPWhitelist(req, settings)) {
    addAuditEntry({ action: "admin_ip_blocked", ip, details: `Admin access denied: IP not in whitelist`, result: "fail" });
    addSecurityEvent({ type: "admin_ip_blocked", ip, details: `Admin access denied from IP: ${ip}`, severity: "critical" });
    sendForbidden(res, "Access denied. Your IP address is not whitelisted for admin access.");
    return;
  }

  /* ── 1. Try new signed admin JWT ── */
  if (adminTokenHeader) {
    const adminPayload = verifyAdminJwt(adminTokenHeader);
    if (!adminPayload) {
      addAuditEntry({ action: "admin_jwt_invalid", ip, details: `Invalid admin JWT for ${req.method} ${req.url}`, result: "fail" });
      addSecurityEvent({ type: "invalid_admin_jwt", ip, details: `Invalid/expired admin JWT used for ${req.url}`, severity: "high" });
      sendUnauthorized(res, "Admin session expired or invalid. Please log in again.");
      return;
    }

    /* ── TOTP / MFA check for JWT-based sessions ── */
    if (adminPayload.adminId) {
      const mfaEnabled = settings["security_mfa_required"] === "on";
      const [sub] = await db.select().from(adminAccountsTable)
        .where(eq(adminAccountsTable.id, adminPayload.adminId))
        .limit(1);
      if (sub && mfaEnabled && sub.totpEnabled && sub.totpSecret) {
        const totpHeader = String(req.headers["x-admin-totp"] || "");
        const isMfaRoute = req.url.includes("/mfa/");
        if (!isMfaRoute) {
          if (!totpHeader) {
            sendErrorWithData(res, "MFA required. Please provide your TOTP code.", { mfaRequired: true }, 401);
            return;
          }
          if (!verifyTotpToken(totpHeader, sub.totpSecret)) {
            addAuditEntry({ action: "admin_totp_failed", ip, adminId: sub.id, details: `Invalid TOTP for ${sub.name}`, result: "fail" });
            addSecurityEvent({ type: "invalid_admin_totp", ip, userId: sub.id, details: `Wrong TOTP code`, severity: "high" });
            sendUnauthorized(res, "Invalid TOTP code. Please try again with your authenticator app.");
            return;
          }
        }
      }
    }

    ((req as AdminRequest) as AdminRequest).adminRole = adminPayload.role;
    ((req as AdminRequest) as AdminRequest).adminId   = adminPayload.adminId ?? undefined;
    ((req as AdminRequest) as AdminRequest).adminName = adminPayload.name ?? undefined;
    ((req as AdminRequest) as AdminRequest).adminIp   = ip;
    addAuditEntry({ action: "admin_access", ip, details: `Admin JWT access: ${adminPayload.name} (${adminPayload.role}) ${req.method} ${req.url}`, result: "success" });
    next();
    return;
  }

  /* No auth provided */
  addAuditEntry({ action: "admin_auth_missing", ip, details: `No admin credentials provided for ${req.method} ${req.url}`, result: "fail" });
  sendUnauthorized(res, "Unauthorized. Admin authentication required. Please provide a valid x-admin-token.");
}

export async function sendUserNotification(userId: string, title: string, body: string, type: string, icon: string) {
  await db.insert(notificationsTable).values({
    id: generateId(),
    userId,
    title,
    body,
    type,
    icon,
  }).catch(() => {});

  sendPushToUser(userId, { title, body, tag: `${type}-${Date.now()}` }).catch(() => {});
}

type NotifKeys = { titleKey: TranslationKey; bodyKey: TranslationKey; icon: string };

export const ORDER_NOTIF_KEYS: Record<string, NotifKeys> = {
  confirmed:        { titleKey: "notifOrderConfirmed",        bodyKey: "notifOrderConfirmedBody",        icon: "checkmark-circle-outline" },
  preparing:        { titleKey: "notifOrderPreparing",        bodyKey: "notifOrderPreparingBody",        icon: "restaurant-outline" },
  out_for_delivery: { titleKey: "notifOrderOutForDelivery",   bodyKey: "notifOrderOutForDeliveryBody",   icon: "bicycle-outline" },
  delivered:        { titleKey: "notifOrderDelivered",        bodyKey: "notifOrderDeliveredBody",        icon: "bag-check-outline" },
  cancelled:        { titleKey: "notifOrderCancelled",        bodyKey: "notifOrderCancelledBody",        icon: "close-circle-outline" },
};

export const RIDE_NOTIF_KEYS: Record<string, NotifKeys> = {
  accepted:   { titleKey: "notifRideAccepted",   bodyKey: "notifRideAcceptedBody",   icon: "car-outline" },
  arrived:    { titleKey: "notifRideArrived",    bodyKey: "notifRideArrivedBody",    icon: "location-outline" },
  in_transit: { titleKey: "notifRideInTransit",  bodyKey: "notifRideInTransitBody",  icon: "navigate-outline" },
  completed:  { titleKey: "notifRideCompleted",  bodyKey: "notifRideCompletedBody",  icon: "star-outline" },
  cancelled:  { titleKey: "notifRideCancelled",  bodyKey: "notifRideCancelledBody",  icon: "close-circle-outline" },
};

export const PHARMACY_NOTIF_KEYS: Record<string, NotifKeys> = {
  confirmed:        { titleKey: "notifPharmacyConfirmed",        bodyKey: "notifPharmacyConfirmedBody",        icon: "checkmark-circle-outline" },
  preparing:        { titleKey: "notifPharmacyPreparing",        bodyKey: "notifPharmacyPreparingBody",        icon: "medical-outline" },
  out_for_delivery: { titleKey: "notifPharmacyOutForDelivery",   bodyKey: "notifPharmacyOutForDeliveryBody",   icon: "bicycle-outline" },
  delivered:        { titleKey: "notifPharmacyDelivered",        bodyKey: "notifPharmacyDeliveredBody",        icon: "bag-check-outline" },
  cancelled:        { titleKey: "notifPharmacyCancelled",        bodyKey: "notifPharmacyCancelledBody",        icon: "close-circle-outline" },
};

export const PARCEL_NOTIF_KEYS: Record<string, NotifKeys> = {
  accepted:   { titleKey: "notifParcelAccepted",   bodyKey: "notifParcelAcceptedBody",   icon: "person-outline" },
  in_transit: { titleKey: "notifParcelInTransit",  bodyKey: "notifParcelInTransitBody",  icon: "cube-outline" },
  completed:  { titleKey: "notifParcelCompleted",  bodyKey: "notifParcelCompletedBody",  icon: "checkmark-circle-outline" },
  cancelled:  { titleKey: "notifParcelCancelled",  bodyKey: "notifParcelCancelledBody",  icon: "close-circle-outline" },
};
export const DEFAULT_RIDE_SERVICES = [
  { id: "svc_bike",         key: "bike",         name: "Bike",         nameUrdu: "موٹرسائیکل",  icon: "🏍️", description: "Fast & affordable solo rides",        color: "#059669", isEnabled: true, isCustom: false, baseFare: "15", perKm: "8",  minFare: "50",  maxPassengers: 1,  allowBargaining: true,  sortOrder: 1 },
  { id: "svc_car",          key: "car",          name: "Car",          nameUrdu: "گاڑی",        icon: "🚗", description: "Comfortable AC rides up to 4 people",  color: "#3B82F6", isEnabled: true, isCustom: false, baseFare: "25", perKm: "12", minFare: "80",  maxPassengers: 4,  allowBargaining: true,  sortOrder: 2 },
  { id: "svc_rickshaw",     key: "rickshaw",     name: "Rickshaw",     nameUrdu: "رکشہ",        icon: "🛺", description: "Cheap 3-wheeler, ideal for short trips", color: "#F59E0B", isEnabled: true, isCustom: false, baseFare: "20", perKm: "10", minFare: "60",  maxPassengers: 3,  allowBargaining: true,  sortOrder: 3 },
  { id: "svc_daba",         key: "daba",         name: "Daba / Van",   nameUrdu: "ڈبہ / وین",  icon: "🚐", description: "School van, group & cargo trips",        color: "#8B5CF6", isEnabled: true, isCustom: false, baseFare: "30", perKm: "14", minFare: "100", maxPassengers: 8,  allowBargaining: true,  sortOrder: 4 },
  { id: "svc_school_shift", key: "school_shift", name: "School Shift", nameUrdu: "اسکول شفٹ",  icon: "🚌", description: "Monthly school bus service for students", color: "#EC4899", isEnabled: true, isCustom: false, baseFare: "0",  perKm: "0",  minFare: "0",   maxPassengers: 30, allowBargaining: false, sortOrder: 5 },
];

export async function ensureDefaultRideServices() {
  const [row] = await db.select({ c: sql<number>`count(*)::int` }).from(rideServiceTypesTable);
  if ((row?.c ?? 0) === 0) {
    await db.insert(rideServiceTypesTable).values(DEFAULT_RIDE_SERVICES);
  }
}

export function formatSvc(s: Record<string, unknown>) {
  return {
    ...s,
    baseFare:        parseFloat(String(s.baseFare       ?? "0")),
    perKm:           parseFloat(String(s.perKm         ?? "0")),
    perMinuteRate:   parseFloat(String(s.perMinuteRate ?? "0")),
    minFare:         parseFloat(String(s.minFare       ?? "0")),
    createdAt:       s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
    updatedAt:       s.updatedAt instanceof Date ? s.updatedAt.toISOString() : s.updatedAt,
  };
}
const DEFAULT_LOCATIONS = [
  { name: "Muzaffarabad Chowk",      nameUrdu: "مظفرآباد چوک",      lat: 34.3697, lng: 73.4716, category: "chowk",   icon: "🏙️", sortOrder: 1 },
  { name: "Kohala Bridge",           nameUrdu: "کوہالہ پل",         lat: 34.2021, lng: 73.3791, category: "landmark", icon: "🌉", sortOrder: 2 },
  { name: "Mirpur City Centre",      nameUrdu: "میرپور سٹی سینٹر",  lat: 33.1413, lng: 73.7508, category: "chowk",   icon: "🏙️", sortOrder: 3 },
  { name: "Rawalakot Bazar",         nameUrdu: "راولاکوٹ بازار",    lat: 33.8572, lng: 73.7613, category: "bazar",   icon: "🛍️", sortOrder: 4 },
  { name: "Bagh City",               nameUrdu: "باغ شہر",           lat: 33.9732, lng: 73.7729, category: "general",  icon: "🌆", sortOrder: 5 },
  { name: "Kotli Main Chowk",        nameUrdu: "کوٹلی مین چوک",     lat: 33.5152, lng: 73.9019, category: "chowk",   icon: "🏙️", sortOrder: 6 },
  { name: "Poonch City",             nameUrdu: "پونچھ شہر",         lat: 33.7700, lng: 74.0954, category: "general",  icon: "🌆", sortOrder: 7 },
  { name: "Neelum Valley",           nameUrdu: "نیلم ویلی",         lat: 34.5689, lng: 73.8765, category: "landmark", icon: "🏔️", sortOrder: 8 },
  { name: "AJK University",          nameUrdu: "یونیورسٹی آف آزاد کشمیر", lat: 34.3601, lng: 73.5088, category: "school",  icon: "🎓", sortOrder: 9 },
  { name: "District Headquarters Hospital", nameUrdu: "ضلعی ہیڈکوارٹر ہسپتال", lat: 34.3712, lng: 73.4730, category: "hospital", icon: "🏥", sortOrder: 10 },
  { name: "Muzaffarabad Bus Stand",  nameUrdu: "مظفرآباد بس اڈہ",  lat: 34.3664, lng: 73.4726, category: "landmark", icon: "🚏", sortOrder: 11 },
  { name: "Hattian Bala",            nameUrdu: "ہٹیاں بالا",        lat: 34.0949, lng: 73.8185, category: "general",  icon: "🌆", sortOrder: 12 },
];

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await db.update(usersTable)
    .set({ tokenVersion: sql`token_version + 1` })
    .where(eq(usersTable.id, userId));
  await db.delete(refreshTokensTable)
    .where(eq(refreshTokensTable.userId, userId));
}

export async function ensureDefaultLocations() {
  const existing = await db.select({ c: count() }).from(popularLocationsTable);
  if ((existing[0]?.c ?? 0) === 0) {
    await db.insert(popularLocationsTable).values(
      DEFAULT_LOCATIONS.map(l => ({
        id:        `loc_${l.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
        name:      l.name,
        nameUrdu:  l.nameUrdu,
        lat:       l.lat.toFixed(6),
        lng:       l.lng.toFixed(6),
        category:  l.category,
        icon:      l.icon,
        isActive:  true,
        sortOrder: l.sortOrder,
      }))
    ).onConflictDoNothing();
  }
}

/* ── Default AJK service zones — seeded once so /settings/app-config can
   serve city list from the DB without code hardcoding.
   Admins can add, edit, or deactivate zones via the admin panel.        ── */
const DEFAULT_SERVICE_ZONES = [
  { name: "Muzaffarabad City", city: "Muzaffarabad", lat: 34.3697, lng: 73.4716, radiusKm: 20 },
  { name: "Mirpur City",       city: "Mirpur",       lat: 33.1413, lng: 73.7508, radiusKm: 20 },
  { name: "Rawalakot City",    city: "Rawalakot",    lat: 33.8572, lng: 73.7613, radiusKm: 15 },
  { name: "Bagh City",         city: "Bagh",         lat: 33.9732, lng: 73.7729, radiusKm: 15 },
  { name: "Kotli City",        city: "Kotli",        lat: 33.5152, lng: 73.9019, radiusKm: 15 },
  { name: "Bhimber City",      city: "Bhimber",      lat: 32.9755, lng: 74.0727, radiusKm: 10 },
  { name: "Poonch City",       city: "Poonch",       lat: 33.7700, lng: 74.0954, radiusKm: 15 },
  { name: "Neelum Valley",     city: "Neelum Valley",lat: 34.5689, lng: 73.8765, radiusKm: 30 },
  { name: "Hattian Bala",      city: "Hattian",      lat: 34.0523, lng: 73.8265, radiusKm: 10 },
  { name: "Sudhnoti City",     city: "Sudhnoti",     lat: 33.7457, lng: 73.6920, radiusKm: 10 },
  { name: "Haveli City",       city: "Haveli",       lat: 33.6667, lng: 73.9500, radiusKm: 10 },
  { name: "Pallandri City",    city: "Pallandri",    lat: 33.7124, lng: 73.9294, radiusKm: 10 },
  { name: "Rawalpindi City",   city: "Rawalpindi",   lat: 33.6007, lng: 73.0679, radiusKm: 30 },
  { name: "Islamabad City",    city: "Islamabad",    lat: 33.7294, lng: 73.0931, radiusKm: 30 },
];

/* ── Default payment methods — seeded once so /settings/app-config can
   serve the list from DB. Admins toggle isActive via platform_settings.
   To add a new method: INSERT a row here OR via admin panel.             ── */
const DEFAULT_PAYMENT_METHODS = [
  { id: "cash",      label: "Cash on Delivery", description: "Pay at delivery",              sortOrder: 1 },
  { id: "wallet",    label: "AJKMart Wallet",    description: "Pay from your in-app wallet",  sortOrder: 2 },
  { id: "jazzcash",  label: "JazzCash",          description: "JazzCash mobile wallet",       sortOrder: 3 },
  { id: "easypaisa", label: "EasyPaisa",         description: "EasyPaisa mobile wallet",      sortOrder: 4 },
  { id: "bank",      label: "Bank Transfer",     description: "Direct bank account transfer", sortOrder: 5 },
];

export async function ensureDefaultPaymentMethods() {
  try {
    /* Ensure table exists before querying (safe to re-run) */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "supported_payment_methods" (
        "id"          text      PRIMARY KEY,
        "label"       text      NOT NULL,
        "description" text      NOT NULL DEFAULT '',
        "is_active"   boolean   NOT NULL DEFAULT true,
        "sort_order"  integer   NOT NULL DEFAULT 0,
        "created_at"  timestamp NOT NULL DEFAULT now(),
        "updated_at"  timestamp NOT NULL DEFAULT now()
      )
    `);
    const existing = await db.select({ c: count() }).from(supportedPaymentMethodsTable);
    if ((existing[0]?.c ?? 0) === 0) {
      await db.insert(supportedPaymentMethodsTable).values(
        DEFAULT_PAYMENT_METHODS.map(m => ({
          id:          m.id,
          label:       m.label,
          description: m.description,
          isActive:    true,
          sortOrder:   m.sortOrder,
        }))
      ).onConflictDoNothing();
    }
  } catch (err) {
    console.error("[ensureDefaultPaymentMethods] failed:", err);
  }
}

export async function ensureDefaultServiceZones() {
  try {
    const existing = await db.select({ c: count() }).from(serviceZonesTable);
    if ((existing[0]?.c ?? 0) === 0) {
      await db.insert(serviceZonesTable).values(
        DEFAULT_SERVICE_ZONES.map(z => ({
          name:            z.name,
          city:            z.city,
          lat:             z.lat.toFixed(6),
          lng:             z.lng.toFixed(6),
          radiusKm:        z.radiusKm.toFixed(2),
          isActive:        true,
          appliesToRides:  true,
          appliesToOrders: true,
          appliesToParcel: true,
        }))
      ).onConflictDoNothing();
    }
  } catch {
    /* Non-fatal: table may not exist yet on first boot */
  }
}

export function serializeSosAlert(a: Record<string, unknown>) {
  const ts = (v: unknown) => v ? (v instanceof Date ? v.toISOString() : String(v)) : null;
  return {
    id:                 a.id,
    userId:             a.userId,
    title:              a.title,
    body:               a.body,
    link:               a.link,
    sosStatus:          (a.sosStatus as string) ?? "pending",
    acknowledgedAt:     ts(a.acknowledgedAt),
    acknowledgedBy:     a.acknowledgedBy ?? null,
    acknowledgedByName: (a.acknowledgedByName ?? a.acknowledgedBy) ?? null,
    resolvedAt:         ts(a.resolvedAt),
    resolvedBy:         a.resolvedBy ?? null,
    resolvedByName:     (a.resolvedByName ?? a.resolvedBy) ?? null,
    resolutionNotes:    a.resolutionNotes ?? null,
    createdAt:          ts(a.createdAt) ?? "",
  };
}

let _ordersItemsNullableMigrated = false;
export async function ensureOrdersItemsNullable() {
  if (_ordersItemsNullableMigrated) return;

  const stmts = [
    /* The orders.items column was created NOT NULL with no default in an older schema.
       New inserts go into order_items table instead; make items nullable with a default. */
    `ALTER TABLE orders ALTER COLUMN items DROP NOT NULL`,
    `ALTER TABLE orders ALTER COLUMN items SET DEFAULT '[]'::json`,
    /* cod_verified was text in an old schema but should be boolean */
    `DO $$ BEGIN
       ALTER TABLE orders ALTER COLUMN cod_verified TYPE boolean USING (cod_verified::boolean);
     EXCEPTION WHEN others THEN NULL;
     END $$`,
  ];

  for (const stmt of stmts) {
    try {
      await db.execute(sql.raw(stmt));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/already|duplicate|42701|column.*does not exist/i.test(msg)) {
        logger.warn({ err: e }, `[migration] ordersItemsNullable: non-fatal — ${stmt.slice(0, 80)}`);
      }
    }
  }

  logger.info("[migration] ordersItemsNullable: migration complete");
  _ordersItemsNullableMigrated = true;
}

/* ── Location Hierarchy: create table + seed default cities ── */
let _locationHierarchyMigrated = false;

const DEFAULT_CITIES = [
  { name: "Rawalakot",     lat: 33.8573,  lng: 73.7643,  radiusKm: 25, sortOrder: 0 },
  { name: "Muzaffarabad",  lat: 34.3700,  lng: 73.4710,  radiusKm: 30, sortOrder: 1 },
  { name: "Mirpur",        lat: 33.1479,  lng: 73.7516,  radiusKm: 20, sortOrder: 2 },
];

type SubCityDef = { name: string; lat: number; lng: number; radiusKm: number; sortOrder: number };
type AreaDef = { name: string; lat: number; lng: number; radiusKm: number; sortOrder: number; mohallaList?: MohallaDef[] };
type MohallaDef = { name: string; lat: number; lng: number; radiusKm: number; sortOrder: number };

const DEFAULT_SUB_CITIES: Record<string, Array<SubCityDef & { areas?: AreaDef[] }>> = {
  Rawalakot: [
    {
      name: "Hajira", lat: 33.7583, lng: 73.8014, radiusKm: 10, sortOrder: 0,
      areas: [
        { name: "Hajira Bazar", lat: 33.7583, lng: 73.8014, radiusKm: 2, sortOrder: 0, mohallaList: [
          { name: "Main Bazar Hajira", lat: 33.7590, lng: 73.8020, radiusKm: 0.5, sortOrder: 0 },
          { name: "Hajira Bus Stand", lat: 33.7575, lng: 73.8010, radiusKm: 0.5, sortOrder: 1 },
        ]},
        { name: "Tarar Khal", lat: 33.7650, lng: 73.8100, radiusKm: 2, sortOrder: 1, mohallaList: [] },
      ],
    },
    { name: "Banjosa",  lat: 33.8200, lng: 73.7200, radiusKm: 8,  sortOrder: 1, areas: [] },
    {
      name: "City",    lat: 33.8573, lng: 73.7643, radiusKm: 5,  sortOrder: 2,
      areas: [
        { name: "Rawalakot Colony", lat: 33.8580, lng: 73.7650, radiusKm: 1.5, sortOrder: 0, mohallaList: [
          { name: "Main Chowk",        lat: 33.8573, lng: 73.7643, radiusKm: 0.4, sortOrder: 0 },
          { name: "Rawalakot GPO",     lat: 33.8560, lng: 73.7630, radiusKm: 0.4, sortOrder: 1 },
          { name: "Mong Road",         lat: 33.8590, lng: 73.7660, radiusKm: 0.4, sortOrder: 2 },
        ]},
        { name: "New Rawalakot",    lat: 33.8500, lng: 73.7700, radiusKm: 1.5, sortOrder: 1, mohallaList: [
          { name: "New Town",          lat: 33.8500, lng: 73.7700, radiusKm: 0.5, sortOrder: 0 },
          { name: "City Hospital Area",lat: 33.8490, lng: 73.7720, radiusKm: 0.4, sortOrder: 1 },
        ]},
      ],
    },
  ],
  Muzaffarabad: [
    {
      name: "New City", lat: 34.3900, lng: 73.4500, radiusKm: 10, sortOrder: 0,
      areas: [
        { name: "Chattar Plaza", lat: 34.3900, lng: 73.4500, radiusKm: 2, sortOrder: 0, mohallaList: [
          { name: "Chattar Main Market", lat: 34.3910, lng: 73.4510, radiusKm: 0.5, sortOrder: 0 },
          { name: "Katchery Road",       lat: 34.3890, lng: 73.4490, radiusKm: 0.5, sortOrder: 1 },
        ]},
      ],
    },
    { name: "Old City",  lat: 34.3600, lng: 73.4700, radiusKm: 8, sortOrder: 1, areas: [] },
    { name: "Chattar",   lat: 34.3500, lng: 73.5000, radiusKm: 8, sortOrder: 2, areas: [] },
  ],
  Mirpur: [
    {
      name: "Allama Iqbal Town", lat: 33.1479, lng: 73.7516, radiusKm: 8, sortOrder: 0,
      areas: [
        { name: "Mirpur Bazar", lat: 33.1479, lng: 73.7516, radiusKm: 2, sortOrder: 0, mohallaList: [
          { name: "Mirpur Chowk",    lat: 33.1479, lng: 73.7516, radiusKm: 0.5, sortOrder: 0 },
          { name: "Mirpur Bus Stand",lat: 33.1460, lng: 73.7500, radiusKm: 0.5, sortOrder: 1 },
        ]},
      ],
    },
    { name: "New Mirpur", lat: 33.1600, lng: 73.7600, radiusKm: 8, sortOrder: 1, areas: [] },
  ],
};

export async function ensureLocationHierarchyTable() {
  if (_locationHierarchyMigrated) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS location_hierarchy (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        level       TEXT NOT NULL,
        parent_id   INTEGER REFERENCES location_hierarchy(id) ON DELETE CASCADE,
        lat         NUMERIC(10,6),
        lng         NUMERIC(10,6),
        radius_km   NUMERIC(8,2) DEFAULT 5,
        is_active   BOOLEAN NOT NULL DEFAULT true,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS location_hierarchy_level_idx ON location_hierarchy(level)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS location_hierarchy_parent_id_idx ON location_hierarchy(parent_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS location_hierarchy_is_active_idx ON location_hierarchy(is_active)`);

    /* Seed if empty */
    const existing = await db.select({ c: count() }).from(locationHierarchyTable);
    if ((existing[0]?.c ?? 0) === 0) {
      for (const city of DEFAULT_CITIES) {
        const [cityRow] = await db.insert(locationHierarchyTable).values({
          name:      city.name,
          level:     "city",
          parentId:  null,
          lat:       city.lat.toFixed(6),
          lng:       city.lng.toFixed(6),
          radiusKm:  city.radiusKm.toFixed(2),
          isActive:  true,
          sortOrder: city.sortOrder,
        }).returning({ id: locationHierarchyTable.id });

        const subCities = DEFAULT_SUB_CITIES[city.name] ?? [];
        for (const sc of subCities) {
          const [scRow] = await db.insert(locationHierarchyTable).values({
            name:      sc.name,
            level:     "sub_city",
            parentId:  cityRow.id,
            lat:       sc.lat.toFixed(6),
            lng:       sc.lng.toFixed(6),
            radiusKm:  sc.radiusKm.toFixed(2),
            isActive:  true,
            sortOrder: sc.sortOrder,
          }).returning({ id: locationHierarchyTable.id });

          for (const area of sc.areas ?? []) {
            const [areaRow] = await db.insert(locationHierarchyTable).values({
              name:      area.name,
              level:     "area",
              parentId:  scRow.id,
              lat:       area.lat.toFixed(6),
              lng:       area.lng.toFixed(6),
              radiusKm:  area.radiusKm.toFixed(2),
              isActive:  true,
              sortOrder: area.sortOrder,
            }).returning({ id: locationHierarchyTable.id });

            for (const mohalla of area.mohallaList ?? []) {
              await db.insert(locationHierarchyTable).values({
                name:      mohalla.name,
                level:     "mohalla",
                parentId:  areaRow.id,
                lat:       mohalla.lat.toFixed(6),
                lng:       mohalla.lng.toFixed(6),
                radiusKm:  mohalla.radiusKm.toFixed(2),
                isActive:  true,
                sortOrder: mohalla.sortOrder,
              });
            }
          }
        }
      }
      logger.info("[migration] locationHierarchy: seeded default cities");
    } else {
      /* Table already has data — back-fill area/mohalla rows for sub-cities that have none */
      const allAreas = await db
        .select({ c: count() })
        .from(locationHierarchyTable)
        .where(eq(locationHierarchyTable.level, "area"));

      if ((allAreas[0]?.c ?? 0) === 0) {
        /* Find existing sub-cities by name and add their areas */
        const existingSubCities = await db
          .select()
          .from(locationHierarchyTable)
          .where(eq(locationHierarchyTable.level, "sub_city"));

        for (const scRow of existingSubCities) {
          /* Identify which city this sub-city belongs to */
          const cityRow = scRow.parentId
            ? await db.select().from(locationHierarchyTable).where(eq(locationHierarchyTable.id, scRow.parentId)).limit(1)
            : [];
          if (!cityRow[0]) continue;

          const cityName = cityRow[0].name;
          const scDefs = DEFAULT_SUB_CITIES[cityName] ?? [];
          const scDef = scDefs.find(s => s.name === scRow.name);
          if (!scDef?.areas?.length) continue;

          for (const area of scDef.areas) {
            const [areaRow] = await db.insert(locationHierarchyTable).values({
              name:      area.name,
              level:     "area",
              parentId:  scRow.id,
              lat:       area.lat.toFixed(6),
              lng:       area.lng.toFixed(6),
              radiusKm:  area.radiusKm.toFixed(2),
              isActive:  true,
              sortOrder: area.sortOrder,
            }).returning({ id: locationHierarchyTable.id });

            for (const mohalla of area.mohallaList ?? []) {
              await db.insert(locationHierarchyTable).values({
                name:      mohalla.name,
                level:     "mohalla",
                parentId:  areaRow.id,
                lat:       mohalla.lat.toFixed(6),
                lng:       mohalla.lng.toFixed(6),
                radiusKm:  mohalla.radiusKm.toFixed(2),
                isActive:  true,
                sortOrder: mohalla.sortOrder,
              });
            }
          }
        }
        logger.info("[migration] locationHierarchy: back-filled areas and mohallaList");
      }
    }
  } catch (err) {
    logger.warn({ err }, "[migration] locationHierarchy: non-fatal error");
  }
  _locationHierarchyMigrated = true;
}
