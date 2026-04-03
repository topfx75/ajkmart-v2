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
  { key: "ride_bike_base_fare",      value: "15",  label: "Bike Base Fare (Rs.)",                   category: "rides" },
  { key: "ride_bike_per_km",         value: "8",   label: "Bike Per KM Rate (Rs.)",                 category: "rides" },
  { key: "ride_bike_min_fare",       value: "50",  label: "Bike Minimum Fare (Rs.)",                category: "rides" },
  { key: "ride_car_base_fare",       value: "25",  label: "Car Base Fare (Rs.)",                    category: "rides" },
  { key: "ride_car_per_km",          value: "12",  label: "Car Per KM Rate (Rs.)",                  category: "rides" },
  { key: "ride_car_min_fare",        value: "80",  label: "Car Minimum Fare (Rs.)",                 category: "rides" },
  { key: "ride_surge_enabled",          value: "off", label: "Enable Surge Pricing",                    category: "rides" },
  { key: "ride_surge_multiplier",       value: "1.5", label: "Surge Multiplier",                        category: "rides" },
  { key: "ride_cancellation_fee",       value: "30",  label: "Cancellation Fee after Acceptance (Rs.)",  category: "rides" },
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
  { key: "security_max_speed_kmh",     value: "150",    label: "Max Speed Allowed (km/h — flag if exceeded)",category: "security" },
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
  { key: "security_lockout_enabled",         value: "on",   label: "Login Lockout Policy Enabled",                      category: "security" },
  { key: "service_cities",                   value: "",     label: "Service Cities (comma-separated, blank=all)",        category: "general" },
  /* Map Configuration */
  { key: "map_provider_primary",            value: "leaflet",            label: "Primary Map Provider (leaflet | mapbox)",              category: "map" },
  { key: "map_provider_secondary",          value: "google_maps_deeplink", label: "Secondary / Navigation Provider",                  category: "map" },
  { key: "google_maps_api_key",             value: "",                   label: "Google Maps API Key (optional)",                       category: "map" },
  { key: "tracking_distance_threshold",     value: "10",                 label: "Location Save Threshold (metres, 0 = save every point)", category: "map" },
];

let _authMethodColumnMigrated = false;
export async function ensureAuthMethodColumn() {
  if (_authMethodColumnMigrated) return;
  try {
    await db.execute(sql`ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS auth_method TEXT`);
  } catch { /* column likely already exists */ }
  _authMethodColumnMigrated = true;
}

export async function getPlatformSettings(): Promise<Record<string, string>> {
  await db.insert(platformSettingsTable).values(DEFAULT_PLATFORM_SETTINGS).onConflictDoNothing();
  const rows = await db.select().from(platformSettingsTable);
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
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
  /* ── Backward-compat: also accept x-admin-secret (the old static secret) ── */
  const adminSecretHeader = String(req.headers["x-admin-secret"] || "");

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

  /* ── 2. Backward-compat: accept static x-admin-secret ── */
  if (adminSecretHeader) {
    const ADMIN_SECRET = getAdminSecret();

    /* ── Super admin via master secret ── */
    if (adminSecretHeader === ADMIN_SECRET) {
      ((req as AdminRequest) as AdminRequest).adminRole = "super";
      ((req as AdminRequest) as AdminRequest).adminIp   = ip;
      addAuditEntry({ action: "admin_login", ip, details: `Super admin (legacy secret) accessed ${req.method} ${req.url}`, result: "success" });
      next();
      return;
    }

    /* ── Sub-admin via stored secret (bcrypt, legacy scrypt, or plaintext fallback) ── */
    const activeSubs = await db.select().from(adminAccountsTable)
      .where(eq(adminAccountsTable.isActive, true));
    const sub = activeSubs.find(s => verifyAdminSecret(adminSecretHeader, s.secret));

    if (sub) {
      const tokenHrs = parseInt(settings["security_admin_token_hrs"] ?? "4", 10);
      if (sub.lastLoginAt) {
        const msSinceLogin = Date.now() - sub.lastLoginAt.getTime();
        const maxMs = tokenHrs * 60 * 60 * 1000;
        if (msSinceLogin > maxMs) {
          addAuditEntry({ action: "admin_token_expired", ip, adminId: sub.id, details: `Admin token expired for ${sub.name} (${tokenHrs}h limit)`, result: "fail" });
          sendUnauthorized(res, `Admin session expired after ${tokenHrs} hours. Please log in again.`);
          return;
        }
      }

      const mfaEnabled  = settings["security_mfa_required"] === "on";
      const totpEnabled = sub.totpEnabled && sub.totpSecret;
      if (mfaEnabled && totpEnabled) {
        const totpHeader = String(req.headers["x-admin-totp"] || "");
        const isMfaRoute = req.url.includes("/mfa/");
        if (!isMfaRoute) {
          if (!totpHeader) {
            sendErrorWithData(res, "MFA required. Please provide your TOTP code in the x-admin-totp header.", { mfaRequired: true }, 401);
            return;
          }
          if (!verifyTotpToken(totpHeader, sub.totpSecret!)) {
            addAuditEntry({ action: "admin_totp_failed", ip, adminId: sub.id, details: `Invalid TOTP for ${sub.name}`, result: "fail" });
            addSecurityEvent({ type: "invalid_admin_totp", ip, userId: sub.id, details: `Wrong TOTP code used by ${sub.name}`, severity: "high" });
            sendUnauthorized(res, "Invalid TOTP code. Please try again with your authenticator app.");
            return;
          }
        }
      }

      ((req as AdminRequest) as AdminRequest).adminRole = sub.role;
      ((req as AdminRequest) as AdminRequest).adminId   = sub.id;
      ((req as AdminRequest) as AdminRequest).adminName = sub.name ?? undefined;
      ((req as AdminRequest) as AdminRequest).adminIp   = ip;
      await db.update(adminAccountsTable).set({ lastLoginAt: new Date() }).where(eq(adminAccountsTable.id, sub.id));
      addAuditEntry({ action: "admin_login", ip, adminId: sub.id, details: `Sub-admin ${sub.name} (${sub.role}) accessed ${req.method} ${req.url}`, result: "success" });
      next();
      return;
    }

    addAuditEntry({ action: "admin_auth_failed", ip, details: `Invalid admin secret for ${req.method} ${req.url}`, result: "fail" });
    addSecurityEvent({ type: "invalid_admin_secret", ip, details: `Invalid admin secret used for ${req.url}`, severity: "high" });
    sendUnauthorized(res, "Unauthorized. Invalid admin secret.");
    return;
  }

  /* No auth provided */
  addAuditEntry({ action: "admin_auth_missing", ip, details: `No admin credentials provided for ${req.method} ${req.url}`, result: "fail" });
  sendUnauthorized(res, "Unauthorized. Admin authentication required (x-admin-token or x-admin-secret).");
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
    baseFare:      parseFloat(String(s.baseFare ?? "0")),
    perKm:         parseFloat(String(s.perKm ?? "0")),
    minFare:       parseFloat(String(s.minFare ?? "0")),
    createdAt:     s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
    updatedAt:     s.updatedAt instanceof Date ? s.updatedAt.toISOString() : s.updatedAt,
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
