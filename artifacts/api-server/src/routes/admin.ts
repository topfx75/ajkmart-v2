import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  ordersTable,
  rideBidsTable,
  ridesTable,
  pharmacyOrdersTable,
  parcelBookingsTable,
  productsTable,
  walletTransactionsTable,
  notificationsTable,
  platformSettingsTable,
  flashDealsTable,
  promoCodesTable,
  adminAccountsTable,
  rideServiceTypesTable,
  popularLocationsTable,
  schoolRoutesTable,
  schoolSubscriptionsTable,
  liveLocationsTable,
  authAuditLogTable,
  refreshTokensTable,
  rideRatingsTable,
  riderPenaltiesTable,
  rideEventLogsTable,
  rideNotifiedRidersTable,
} from "@workspace/db/schema";
import { eq, desc, count, sum, and, gte, lte, sql, or, ilike, asc } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import {
  checkAdminIPWhitelist,
  addAuditEntry,
  addSecurityEvent,
  getClientIp,
  auditLog,
  securityEvents,
  blockedIPs,
  loginAttempts,
  unlockPhone,
  invalidateSettingsCache,
  signAdminJwt,
  verifyAdminJwt,
  writeAuthAuditLog,
  ADMIN_TOKEN_TTL_HRS,
} from "../middleware/security.js";
import { generateTotpSecret, verifyTotpToken, generateQRCodeDataURL, getTotpUri } from "../services/totp.js";
import { hashPassword, verifyPassword, hashAdminSecret, verifyAdminSecret } from "../services/password.js";

/* ── Sensitive field stripper — never leak hashes or OTP codes to API responses ── */
function stripUser(u: Record<string, any>) {
  const { passwordHash: _ph, otpCode: _otp, otpExpiry: _exp,
          emailOtpCode: _eotp, emailOtpExpiry: _eexp,
          totpSecret: _ts, backupCodes: _bc, trustedDevices: _td, ...safe } = u;
  return safe;
}

/* ── Default Platform Settings ── */
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
  /* Security & API Keys */
  /* ═══════════════════  Security & API  ═══════════════════ */
  /* Auth & Sessions */
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
  { key: "auth_email_otp_enabled",         value: JSON.stringify({ customer: "on", rider: "on", vendor: "on" }),   label: "Email OTP Login Enabled",              category: "auth" },
  { key: "auth_username_password_enabled", value: JSON.stringify({ customer: "on", rider: "on", vendor: "on" }),   label: "Username/Password Login Enabled",     category: "auth" },
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
  { key: "security_otp_cooldown_sec",     value: "60",  label: "OTP Resend Cooldown (seconds)",        category: "auth" },
  { key: "auth_social_google",            value: "off",  label: "Google Social Login (legacy toggle)",  category: "auth" },
  { key: "auth_social_facebook",          value: "off",  label: "Facebook Social Login (legacy toggle)",category: "auth" },
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
];

export async function getPlatformSettings(): Promise<Record<string, string>> {
  // Always seed missing keys (onConflictDoNothing skips existing ones)
  await db.insert(platformSettingsTable).values(DEFAULT_PLATFORM_SETTINGS).onConflictDoNothing();
  const rows = await db.select().from(platformSettingsTable);
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

const router: IRouter = Router();

export function getAdminSecret(): string {
  const s = process.env.ADMIN_SECRET;
  if (!s || s.length < 16) {
    console.error("[AUTH] FATAL: ADMIN_SECRET environment variable must be set and ≥16 characters.");
    process.exit(1);
  }
  return s;
}

/* ── Admin login brute-force protection (in-memory, per IP) ── */
const adminLoginAttempts = new Map<string, { count: number; lockedUntil: number | null }>();
const ADMIN_MAX_ATTEMPTS  = 5;
const ADMIN_LOCKOUT_MS    = 15 * 60 * 1000; // 15 minutes

function checkAdminLoginLockout(ip: string): { locked: boolean; minutesLeft: number } {
  const rec = adminLoginAttempts.get(ip);
  if (!rec?.lockedUntil) return { locked: false, minutesLeft: 0 };
  if (Date.now() < rec.lockedUntil) {
    const minutesLeft = Math.ceil((rec.lockedUntil - Date.now()) / 60_000);
    return { locked: true, minutesLeft };
  }
  adminLoginAttempts.delete(ip);
  return { locked: false, minutesLeft: 0 };
}

function recordAdminLoginFailure(ip: string) {
  const rec = adminLoginAttempts.get(ip) || { count: 0, lockedUntil: null };
  rec.count += 1;
  if (rec.count >= ADMIN_MAX_ATTEMPTS) {
    rec.lockedUntil = Date.now() + ADMIN_LOCKOUT_MS;
  }
  adminLoginAttempts.set(ip, rec);
}

function resetAdminLoginAttempts(ip: string) {
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
    res.status(403).json({ error: "Access denied. Your IP address is not whitelisted for admin access." });
    return;
  }

  /* ── 1. Try new signed admin JWT ── */
  if (adminTokenHeader) {
    const adminPayload = verifyAdminJwt(adminTokenHeader);
    if (!adminPayload) {
      addAuditEntry({ action: "admin_jwt_invalid", ip, details: `Invalid admin JWT for ${req.method} ${req.url}`, result: "fail" });
      addSecurityEvent({ type: "invalid_admin_jwt", ip, details: `Invalid/expired admin JWT used for ${req.url}`, severity: "high" });
      res.status(401).json({ error: "Admin session expired or invalid. Please log in again." });
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
            res.status(401).json({ error: "MFA required. Please provide your TOTP code.", mfaRequired: true });
            return;
          }
          if (!verifyTotpToken(totpHeader, sub.totpSecret)) {
            addAuditEntry({ action: "admin_totp_failed", ip, adminId: sub.id, details: `Invalid TOTP for ${sub.name}`, result: "fail" });
            addSecurityEvent({ type: "invalid_admin_totp", ip, userId: sub.id, details: `Wrong TOTP code`, severity: "high" });
            res.status(401).json({ error: "Invalid TOTP code. Please try again with your authenticator app." });
            return;
          }
        }
      }
    }

    (req as any).adminRole = adminPayload.role;
    (req as any).adminId   = adminPayload.adminId;
    (req as any).adminName = adminPayload.name;
    (req as any).adminIp   = ip;
    addAuditEntry({ action: "admin_access", ip, details: `Admin JWT access: ${adminPayload.name} (${adminPayload.role}) ${req.method} ${req.url}`, result: "success" });
    next();
    return;
  }

  /* ── 2. Backward-compat: accept static x-admin-secret ── */
  if (adminSecretHeader) {
    const ADMIN_SECRET = getAdminSecret();

    /* ── Super admin via master secret ── */
    if (adminSecretHeader === ADMIN_SECRET) {
      (req as any).adminRole = "super";
      (req as any).adminIp   = ip;
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
          res.status(401).json({ error: `Admin session expired after ${tokenHrs} hours. Please log in again.` });
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
            res.status(401).json({ error: "MFA required. Please provide your TOTP code in the x-admin-totp header.", mfaRequired: true });
            return;
          }
          if (!verifyTotpToken(totpHeader, sub.totpSecret!)) {
            addAuditEntry({ action: "admin_totp_failed", ip, adminId: sub.id, details: `Invalid TOTP for ${sub.name}`, result: "fail" });
            addSecurityEvent({ type: "invalid_admin_totp", ip, userId: sub.id, details: `Wrong TOTP code used by ${sub.name}`, severity: "high" });
            res.status(401).json({ error: "Invalid TOTP code. Please try again with your authenticator app." });
            return;
          }
        }
      }

      (req as any).adminRole = sub.role;
      (req as any).adminId   = sub.id;
      (req as any).adminName = sub.name;
      (req as any).adminIp   = ip;
      await db.update(adminAccountsTable).set({ lastLoginAt: new Date() }).where(eq(adminAccountsTable.id, sub.id));
      addAuditEntry({ action: "admin_login", ip, adminId: sub.id, details: `Sub-admin ${sub.name} (${sub.role}) accessed ${req.method} ${req.url}`, result: "success" });
      next();
      return;
    }

    addAuditEntry({ action: "admin_auth_failed", ip, details: `Invalid admin secret for ${req.method} ${req.url}`, result: "fail" });
    addSecurityEvent({ type: "invalid_admin_secret", ip, details: `Invalid admin secret used for ${req.url}`, severity: "high" });
    res.status(401).json({ error: "Unauthorized. Invalid admin secret." });
    return;
  }

  /* No auth provided */
  addAuditEntry({ action: "admin_auth_missing", ip, details: `No admin credentials provided for ${req.method} ${req.url}`, result: "fail" });
  res.status(401).json({ error: "Unauthorized. Admin authentication required (x-admin-token or x-admin-secret)." });
}

/* ── helpers ── */
async function sendUserNotification(userId: string, title: string, body: string, type: string, icon: string) {
  await db.insert(notificationsTable).values({
    id: generateId(),
    userId,
    title,
    body,
    type,
    icon,
  }).catch(() => {});
}

const ORDER_NOTIFICATIONS: Record<string, { title: string; body: string; icon: string }> = {
  confirmed:         { title: "Order Confirmed! ✅", body: "Your order has been confirmed and is being prepared.", icon: "checkmark-circle-outline" },
  preparing:         { title: "Order Being Prepared 🍳", body: "The vendor is now preparing your order.", icon: "restaurant-outline" },
  out_for_delivery:  { title: "On the Way! 🚴", body: "Your order is out for delivery. Track your rider.", icon: "bicycle-outline" },
  delivered:         { title: "Order Delivered! 🎉", body: "Your order has been delivered. Enjoy!", icon: "bag-check-outline" },
  cancelled:         { title: "Order Cancelled ❌", body: "Your order has been cancelled by the store.", icon: "close-circle-outline" },
};

const RIDE_NOTIFICATIONS: Record<string, { title: string; body: string; icon: string }> = {
  accepted:    { title: "Driver Found! 🚗", body: "A driver has accepted your ride. They are on the way.", icon: "car-outline" },
  arrived:     { title: "Driver Arrived! 📍", body: "Your driver has arrived at the pickup location.", icon: "location-outline" },
  in_transit:  { title: "Ride Started 🛣️", body: "Your ride is now in progress. Sit back and relax.", icon: "navigate-outline" },
  completed:   { title: "Ride Completed! ⭐", body: "Your ride has been completed. Thanks for choosing AJKMart!", icon: "star-outline" },
  cancelled:   { title: "Ride Cancelled ❌", body: "Your ride has been cancelled.", icon: "close-circle-outline" },
};

const PHARMACY_NOTIFICATIONS: Record<string, { title: string; body: string; icon: string }> = {
  confirmed:        { title: "Pharmacy Order Confirmed ✅", body: "Your medicine order has been confirmed.", icon: "checkmark-circle-outline" },
  preparing:        { title: "Medicines Being Packed 💊", body: "Your medicines are being prepared for delivery.", icon: "medical-outline" },
  out_for_delivery: { title: "Medicines On the Way! 🚴", body: "Your medicines are out for delivery.", icon: "bicycle-outline" },
  delivered:        { title: "Medicines Delivered! 💊", body: "Your pharmacy order has been delivered.", icon: "bag-check-outline" },
  cancelled:        { title: "Order Cancelled ❌", body: "Your pharmacy order has been cancelled.", icon: "close-circle-outline" },
};

const PARCEL_NOTIFICATIONS: Record<string, { title: string; body: string; icon: string }> = {
  accepted:    { title: "Rider Assigned! 📦", body: "A rider has been assigned to deliver your parcel.", icon: "person-outline" },
  in_transit:  { title: "Parcel In Transit 🚚", body: "Your parcel is on the way to the destination.", icon: "cube-outline" },
  completed:   { title: "Parcel Delivered! ✅", body: "Your parcel has been delivered successfully.", icon: "checkmark-circle-outline" },
  cancelled:   { title: "Booking Cancelled ❌", body: "Your parcel booking has been cancelled.", icon: "close-circle-outline" },
};

/* ── Admin login — issues a signed, time-limited JWT (4 hours) ── */
router.post("/auth", async (req, res) => {
  const { secret } = req.body;
  const ip = getClientIp(req);
  const ADMIN_SECRET = getAdminSecret();

  const lockout = checkAdminLoginLockout(ip);
  if (lockout.locked) {
    addSecurityEvent({ type: "admin_login_locked", ip, details: `Locked admin login attempt from ${ip}`, severity: "high" });
    res.status(429).json({ error: `Too many failed attempts. Try again in ${lockout.minutesLeft} minute(s).` });
    return;
  }

  /* ── Attempt master secret login ── */
  if (secret === ADMIN_SECRET) {
    resetAdminLoginAttempts(ip);
    const adminToken = signAdminJwt(null, "super", "Super Admin", ADMIN_TOKEN_TTL_HRS);
    addAuditEntry({ action: "admin_login_success", ip, details: "Master admin login — JWT issued", result: "success" });
    writeAuthAuditLog("admin_login", { ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { role: "super" } });
    res.json({ success: true, token: adminToken, expiresIn: `${ADMIN_TOKEN_TTL_HRS}h` });
    return;
  }

  /* ── Attempt sub-admin login via stored secret (bcrypt, legacy scrypt, or plaintext fallback) ── */
  const activeSubs2 = await db.select().from(adminAccountsTable)
    .where(eq(adminAccountsTable.isActive, true));
  const sub = activeSubs2.find(s => verifyAdminSecret(secret || "", s.secret));

  if (sub) {
    resetAdminLoginAttempts(ip);
    const adminToken = signAdminJwt(sub.id, sub.role, sub.name, ADMIN_TOKEN_TTL_HRS);
    await db.update(adminAccountsTable).set({ lastLoginAt: new Date() }).where(eq(adminAccountsTable.id, sub.id));
    addAuditEntry({ action: "admin_login_success", ip, adminId: sub.id, details: `Sub-admin ${sub.name} login — JWT issued`, result: "success" });
    writeAuthAuditLog("admin_login", { ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { adminId: sub.id, role: sub.role } });
    res.json({ success: true, token: adminToken, expiresIn: `${ADMIN_TOKEN_TTL_HRS}h` });
    return;
  }

  recordAdminLoginFailure(ip);
  const rec = adminLoginAttempts.get(ip);
  const remaining = Math.max(0, ADMIN_MAX_ATTEMPTS - (rec?.count ?? 0));
  addAuditEntry({ action: "admin_login_failed", ip, details: "Wrong admin secret", result: "fail" });
  addSecurityEvent({ type: "admin_login_failed", ip, details: `Failed admin login attempt from ${ip}`, severity: "high" });
  if (remaining === 0) {
    res.status(429).json({ error: `Too many failed attempts. Account locked for 15 minutes.` });
  } else {
    res.status(401).json({ error: `Invalid admin password. ${remaining} attempt(s) remaining.` });
  }
});

router.use(adminAuth);

/* ── Dashboard Stats ── */
router.get("/stats", async (_req, res) => {
  const [userCount] = await db.select({ count: count() }).from(usersTable);
  const [orderCount] = await db.select({ count: count() }).from(ordersTable);
  const [rideCount] = await db.select({ count: count() }).from(ridesTable);
  const [pharmCount] = await db.select({ count: count() }).from(pharmacyOrdersTable);
  const [parcelCount] = await db.select({ count: count() }).from(parcelBookingsTable);
  const [productCount] = await db.select({ count: count() }).from(productsTable);

  const [totalRevenue] = await db
    .select({ total: sum(ordersTable.total) })
    .from(ordersTable)
    .where(eq(ordersTable.status, "delivered"));

  const [rideRevenue] = await db
    .select({ total: sum(ridesTable.fare) })
    .from(ridesTable)
    .where(eq(ridesTable.status, "completed"));

  const [pharmRevenue] = await db
    .select({ total: sum(pharmacyOrdersTable.total) })
    .from(pharmacyOrdersTable)
    .where(eq(pharmacyOrdersTable.status, "delivered"));

  const recentOrders = await db
    .select()
    .from(ordersTable)
    .orderBy(desc(ordersTable.createdAt))
    .limit(5);

  const recentRides = await db
    .select()
    .from(ridesTable)
    .orderBy(desc(ridesTable.createdAt))
    .limit(5);

  res.json({
    users: userCount!.count,
    orders: orderCount!.count,
    rides: rideCount!.count,
    pharmacyOrders: pharmCount!.count,
    parcelBookings: parcelCount!.count,
    products: productCount!.count,
    revenue: {
      orders: parseFloat(totalRevenue!.total ?? "0"),
      rides: parseFloat(rideRevenue!.total ?? "0"),
      pharmacy: parseFloat(pharmRevenue!.total ?? "0"),
      total:
        parseFloat(totalRevenue!.total ?? "0") +
        parseFloat(rideRevenue!.total ?? "0") +
        parseFloat(pharmRevenue!.total ?? "0"),
    },
    recentOrders: recentOrders.map(o => ({
      ...o,
      total: parseFloat(String(o.total)),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    })),
    recentRides: recentRides.map(r => ({
      ...r,
      fare: parseFloat(r.fare),
      distance: parseFloat(r.distance),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
});

/* ── Users ── */
router.get("/users", async (req, res) => {
  const filter = (req.query?.filter as string) ?? "";
  let query = db.select().from(usersTable);
  if (filter === "2fa_enabled") {
    query = query.where(eq(usersTable.totpEnabled, true)) as any;
  }
  const users = await query.orderBy(desc(usersTable.createdAt));
  res.json({
    users: users.map((u) => ({
      ...stripUser(u),
      walletBalance: parseFloat(u.walletBalance ?? "0"),
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    })),
    total: users.length,
  });
});

router.patch("/users/:id", async (req, res) => {
  const { role, isActive, walletBalance } = req.body;
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (role !== undefined) { updates.role = role; updates.roles = role; }
  if (isActive !== undefined) updates.isActive = isActive;
  if (walletBalance !== undefined) updates.walletBalance = String(walletBalance);

  /* ── Auto-approve: when role is assigned to vendor/rider and admin
     hasn't explicitly set isActive, use vendor_auto_approve / rider_auto_approve
     to decide whether the account is immediately active ── */
  if (role && isActive === undefined) {
    const s = await getPlatformSettings();
    if (role === "vendor") {
      updates.isActive = (s["vendor_auto_approve"] ?? "off") === "on";
    } else if (role === "rider") {
      updates.isActive = (s["rider_auto_approve"] ?? "off") === "on";
    }
  }

  const [user] = await db
    .update(usersTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(usersTable.id, req.params["id"]!))
    .returning();

  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  /* Revoke sessions on role or status change */
  if (role !== undefined || isActive === false) {
    revokeAllUserSessions(req.params["id"]!).catch(() => {});
  }
  res.json({ ...stripUser(user), walletBalance: parseFloat(user.walletBalance ?? "0") });
});

/* ── Pending Approval Users ── */
router.get("/users/pending", async (_req, res) => {
  const users = await db.select().from(usersTable)
    .where(eq(usersTable.approvalStatus, "pending"))
    .orderBy(desc(usersTable.createdAt));
  res.json({
    users: users.map(({ otpCode: _otp, otpExpiry: _exp, passwordHash: _ph, emailOtpCode: _eotp, emailOtpExpiry: _eexp, ...u }) => ({
      ...u,
      walletBalance: parseFloat(u.walletBalance ?? "0"),
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    })),
    total: users.length,
  });
});

/* ── List users with 2FA enabled ── */
router.get("/users/2fa-enabled", async (_req, res) => {
  const users = await db.select().from(usersTable)
    .where(eq(usersTable.totpEnabled, true))
    .orderBy(desc(usersTable.createdAt));
  res.json({
    users: users.map(u => ({
      ...stripUser(u),
      walletBalance: parseFloat(u.walletBalance ?? "0"),
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    })),
    total: users.length,
  });
});

/* ── Approve User ── */
router.post("/users/:id/approve", async (req, res) => {
  const { note } = req.body;
  const [user] = await db.update(usersTable)
    .set({ approvalStatus: "approved", approvalNote: note || null, isActive: true, updatedAt: new Date() })
    .where(eq(usersTable.id, req.params["id"]!))
    .returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  addAuditEntry({ action: "user_approved", ip: "admin", details: `User approved: ${user.phone} — ${user.name || "unnamed"}`, result: "success" });
  res.json({ success: true, user: { ...stripUser(user), walletBalance: parseFloat(user.walletBalance ?? "0") } });
});

/* ── Reject User ── */
router.post("/users/:id/reject", async (req, res) => {
  const { note } = req.body;
  const [user] = await db.update(usersTable)
    .set({ approvalStatus: "rejected", approvalNote: note || "Rejected by admin", isActive: false, updatedAt: new Date() })
    .where(eq(usersTable.id, req.params["id"]!))
    .returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  addAuditEntry({ action: "user_rejected", ip: "admin", details: `User rejected: ${user.phone} — ${note || "no reason"}`, result: "success" });
  res.json({ success: true, user: { ...stripUser(user), walletBalance: parseFloat(user.walletBalance ?? "0") } });
});

/* ── Wallet Top-up ── */
router.post("/users/:id/wallet-topup", async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ error: "Valid amount is required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.params["id"]!));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const currentBalance = parseFloat(user.walletBalance ?? "0");
  const newBalance = currentBalance + Number(amount);

  const [updatedUser] = await db
    .update(usersTable)
    .set({ walletBalance: String(newBalance), updatedAt: new Date() })
    .where(eq(usersTable.id, req.params["id"]!))
    .returning();

  await db.insert(walletTransactionsTable).values({
    id: generateId(),
    userId: req.params["id"]!,
    type: "credit",
    amount: String(amount),
    description: description || `Admin top-up: Rs. ${amount}`,
    reference: "admin_topup",
  });

  await sendUserNotification(
    req.params["id"]!,
    "Wallet Topped Up! 💰",
    `Rs. ${amount} has been added to your AJKMart wallet.`,
    "system",
    "wallet-outline"
  );

  res.json({
    success: true,
    newBalance,
    user: { ...stripUser(updatedUser!), walletBalance: newBalance },
  });
});

/* ── All Orders ── */
router.get("/orders", async (req, res) => {
  const { status, type, limit: lim } = req.query;
  const orders = await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt)).limit(Number(lim) || 200);

  const filtered = orders
    .filter(o => !status || o.status === status)
    .filter(o => !type || o.type === type);

  res.json({
    orders: filtered.map(o => ({
      ...o,
      total: parseFloat(String(o.total)),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    })),
    total: filtered.length,
  });
});

router.patch("/orders/:id/status", async (req, res) => {
  const { status } = req.body;
  const [order] = await db
    .update(ordersTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(ordersTable.id, req.params["id"]!))
    .returning();
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const notif = ORDER_NOTIFICATIONS[status];
  if (notif) {
    await sendUserNotification(order.userId, notif.title, notif.body, "mart", notif.icon);
  }

  // NOTE: Wallet is already debited when order is PLACED (orders.ts).
  // Do NOT deduct again here. Only credit the rider's share on delivery.

  // Wallet refund on admin cancellation (atomic)
  if (status === "cancelled" && order.paymentMethod === "wallet") {
    const refundAmt = parseFloat(String(order.total));
    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ walletBalance: sql`wallet_balance + ${refundAmt}`, updatedAt: new Date() }).where(eq(usersTable.id, order.userId));
      await tx.insert(walletTransactionsTable).values({ id: generateId(), userId: order.userId, type: "credit", amount: refundAmt.toFixed(2), description: `Refund — Order #${order.id.slice(-6).toUpperCase()} cancelled by admin` });
    }).catch(() => {});
    await sendUserNotification(order.userId, "Order Refund 💰", `Rs. ${refundAmt.toFixed(0)} aapki wallet mein refund ho gaya — Order #${order.id.slice(-6).toUpperCase()}`, "mart", "wallet-outline");
  }

  if (status === "delivered") {
    const total = parseFloat(String(order.total));
    const riderKeepPct = parseFloat((await getPlatformSettings())["rider_keep_pct"] ?? "80") / 100;
    const riderEarning = parseFloat((total * riderKeepPct).toFixed(2));
    // Credit assigned rider's wallet earnings
    if (order.riderId) {
      const [rider] = await db.select().from(usersTable).where(eq(usersTable.id, order.riderId));
      if (rider) {
        const riderNewBal = (parseFloat(rider.walletBalance ?? "0") + riderEarning).toFixed(2);
        await db.update(usersTable).set({ walletBalance: riderNewBal, updatedAt: new Date() }).where(eq(usersTable.id, rider.id));
        await db.insert(walletTransactionsTable).values({
          id: generateId(), userId: rider.id, type: "credit",
          amount: String(riderEarning),
          description: `Delivery earnings — Order #${order.id.slice(-6).toUpperCase()} (${Math.round(riderKeepPct * 100)}%)`,
        });
      }
    }
  }

  res.json({ ...order, total: parseFloat(String(order.total)) });
});

/* ── All Rides ── */
router.get("/rides", async (_req, res) => {
  const rides = await db.select().from(ridesTable).orderBy(desc(ridesTable.createdAt)).limit(200);
  res.json({
    rides: rides.map(r => ({
      ...r,
      fare: parseFloat(r.fare),
      distance: parseFloat(r.distance),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    total: rides.length,
  });
});

router.patch("/rides/:id/status", async (req, res) => {
  const { status, riderName, riderPhone } = req.body;
  const updateData: any = { status, updatedAt: new Date() };
  if (riderName) updateData.riderName = riderName;
  if (riderPhone) updateData.riderPhone = riderPhone;

  const [ride] = await db
    .update(ridesTable)
    .set(updateData)
    .where(eq(ridesTable.id, req.params["id"]!))
    .returning();
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }

  const notif = RIDE_NOTIFICATIONS[status];
  if (notif) {
    await sendUserNotification(ride.userId, notif.title, notif.body, "ride", notif.icon);
  }

  // NOTE: Wallet already debited at ride booking (rides.ts).
  // On completion, credit rider's earnings share.
  if (status === "completed") {
    const fare = parseFloat(ride.fare);
    const s = await getPlatformSettings();
    const riderKeepPct = parseFloat(s["rider_keep_pct"] ?? "80") / 100;
    const riderEarning = parseFloat((fare * riderKeepPct).toFixed(2));
    if (ride.riderId) {
      /* Atomic credit — uses sql`wallet_balance + X` to avoid clobbering
         concurrent balance changes (same pattern as all other wallet mutations) */
      await db.update(usersTable)
        .set({ walletBalance: sql`wallet_balance + ${riderEarning}`, updatedAt: new Date() })
        .where(eq(usersTable.id, ride.riderId));
      await db.insert(walletTransactionsTable).values({
        id: generateId(), userId: ride.riderId, type: "credit",
        amount: String(riderEarning),
        description: `Ride earnings — #${ride.id.slice(-6).toUpperCase()} (${Math.round(riderKeepPct * 100)}%)`,
      });
      await sendUserNotification(ride.riderId, "Ride Payment Received 💰", `Rs. ${riderEarning} wallet mein add ho gaya!`, "ride", "wallet-outline");
    }
  }

  // Wallet refund on admin cancellation (atomic)
  if (status === "cancelled" && ride.paymentMethod === "wallet") {
    const refundAmt = parseFloat(ride.fare);
    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ walletBalance: sql`wallet_balance + ${refundAmt}`, updatedAt: new Date() }).where(eq(usersTable.id, ride.userId));
      await tx.insert(walletTransactionsTable).values({ id: generateId(), userId: ride.userId, type: "credit", amount: refundAmt.toFixed(2), description: `Refund — Ride #${ride.id.slice(-6).toUpperCase()} cancelled by admin` });
    }).catch(() => {});
    await sendUserNotification(ride.userId, "Ride Refund 💰", `Rs. ${refundAmt.toFixed(0)} aapki wallet mein refund ho gaya.`, "ride", "wallet-outline");
  }

  res.json({ ...ride, fare: parseFloat(ride.fare), distance: parseFloat(ride.distance) });
});

/* ── Pharmacy Orders ── */
router.get("/pharmacy-orders", async (_req, res) => {
  const orders = await db
    .select()
    .from(pharmacyOrdersTable)
    .orderBy(desc(pharmacyOrdersTable.createdAt))
    .limit(200);
  res.json({
    orders: orders.map(o => ({
      ...o,
      total: parseFloat(o.total),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    })),
    total: orders.length,
  });
});

router.patch("/pharmacy-orders/:id/status", async (req, res) => {
  const { status } = req.body;
  const [order] = await db
    .update(pharmacyOrdersTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(pharmacyOrdersTable.id, req.params["id"]!))
    .returning();
  if (!order) { res.status(404).json({ error: "Not found" }); return; }

  const notif = PHARMACY_NOTIFICATIONS[status];
  if (notif) {
    await sendUserNotification(order.userId, notif.title, notif.body, "pharmacy", notif.icon);
  }

  // Wallet refund on cancellation (atomic)
  if (status === "cancelled" && order.paymentMethod === "wallet") {
    const refundAmt = parseFloat(order.total);
    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ walletBalance: sql`wallet_balance + ${refundAmt}`, updatedAt: new Date() }).where(eq(usersTable.id, order.userId));
      await tx.insert(walletTransactionsTable).values({ id: generateId(), userId: order.userId, type: "credit", amount: refundAmt.toFixed(2), description: `Refund — Pharmacy Order #${order.id.slice(-6).toUpperCase()} cancelled` });
    }).catch(() => {});
    await sendUserNotification(order.userId, "Pharmacy Refund 💊💰", `Rs. ${refundAmt} refunded to your wallet.`, "pharmacy", "wallet-outline");
  }

  res.json({ ...order, total: parseFloat(order.total) });
});

/* ── Parcel Bookings ── */
router.get("/parcel-bookings", async (_req, res) => {
  const bookings = await db
    .select()
    .from(parcelBookingsTable)
    .orderBy(desc(parcelBookingsTable.createdAt))
    .limit(200);
  res.json({
    bookings: bookings.map(b => ({
      ...b,
      fare: parseFloat(b.fare),
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    })),
    total: bookings.length,
  });
});

router.patch("/parcel-bookings/:id/status", async (req, res) => {
  const { status } = req.body;
  const [booking] = await db
    .update(parcelBookingsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(parcelBookingsTable.id, req.params["id"]!))
    .returning();
  if (!booking) { res.status(404).json({ error: "Not found" }); return; }

  const notif = PARCEL_NOTIFICATIONS[status];
  if (notif) {
    await sendUserNotification(booking.userId, notif.title, notif.body, "parcel", notif.icon);
  }

  // Wallet refund on cancellation (atomic)
  if (status === "cancelled" && booking.paymentMethod === "wallet") {
    const refundAmt = parseFloat(booking.fare);
    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ walletBalance: sql`wallet_balance + ${refundAmt}`, updatedAt: new Date() }).where(eq(usersTable.id, booking.userId));
      await tx.insert(walletTransactionsTable).values({ id: generateId(), userId: booking.userId, type: "credit", amount: refundAmt.toFixed(2), description: `Refund — Parcel Booking #${booking.id.slice(-6).toUpperCase()} cancelled` });
    }).catch(() => {});
    await sendUserNotification(booking.userId, "Parcel Refund 📦💰", `Rs. ${refundAmt} refunded to your wallet.`, "parcel", "wallet-outline");
  }

  res.json({ ...booking, fare: parseFloat(booking.fare) });
});

/* ── Products ── */
router.get("/products", async (_req, res) => {
  const products = await db.select().from(productsTable).orderBy(desc(productsTable.createdAt));
  res.json({
    products: products.map(p => ({
      ...p,
      price: parseFloat(p.price),
      originalPrice: p.originalPrice ? parseFloat(p.originalPrice) : null,
      rating: p.rating ? parseFloat(p.rating) : null,
      createdAt: p.createdAt.toISOString(),
    })),
    total: products.length,
  });
});

router.post("/products", async (req, res) => {
  const { name, description, price, originalPrice, category, type, unit, vendorName, inStock, deliveryTime, image } = req.body;
  if (!name || !price || !category) {
    res.status(400).json({ error: "name, price, and category are required" });
    return;
  }
  const [product] = await db.insert(productsTable).values({
    id: generateId(),
    name,
    description: description || null,
    price: String(price),
    originalPrice: originalPrice ? String(originalPrice) : null,
    category,
    type: type || "mart",
    vendorId: "ajkmart_system",
    vendorName: vendorName || "AJKMart Store",
    unit: unit || null,
    inStock: inStock !== false,
    deliveryTime: deliveryTime || "30-45 min",
    rating: "4.5",
    reviewCount: 0,
    image: image || null,
  }).returning();
  res.status(201).json({ ...product!, price: parseFloat(product!.price) });
});

router.patch("/products/:id", async (req, res) => {
  const { name, description, price, originalPrice, category, unit, inStock, vendorName, deliveryTime, image } = req.body;
  const updates: Partial<typeof productsTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (price !== undefined) updates.price = String(price);
  if (originalPrice !== undefined) updates.originalPrice = originalPrice ? String(originalPrice) : null;
  if (category !== undefined) updates.category = category;
  if (unit !== undefined) updates.unit = unit;
  if (inStock !== undefined) updates.inStock = inStock;
  if (vendorName !== undefined) updates.vendorName = vendorName;
  if (deliveryTime !== undefined) updates.deliveryTime = deliveryTime;
  if (image !== undefined) updates.image = image;

  const [product] = await db
    .update(productsTable)
    .set(updates)
    .where(eq(productsTable.id, req.params["id"]!))
    .returning();
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  res.json({ ...product, price: parseFloat(product.price) });
});

router.delete("/products/:id", async (req, res) => {
  await db.delete(productsTable).where(eq(productsTable.id, req.params["id"]!));
  res.json({ success: true });
});

/* ── Broadcast Notification ── */
router.post("/broadcast", async (req, res) => {
  const { title, body, type = "system", icon = "notifications-outline" } = req.body;
  if (!title || !body) { res.status(400).json({ error: "title and body required" }); return; }

  const users = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.isActive, true));
  let sent = 0;
  for (const user of users) {
    await db.insert(notificationsTable).values({
      id: generateId(),
      userId: user.id,
      title,
      body,
      type,
      icon,
    }).catch(() => {});
    sent++;
  }
  res.json({ success: true, sent });
});

/* ── Wallet Transactions ── */
router.get("/transactions", async (_req, res) => {
  const transactions = await db
    .select()
    .from(walletTransactionsTable)
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(200);

  const totalCredit = transactions.filter(t => t.type === "credit").reduce((s, t) => s + parseFloat(t.amount), 0);
  const totalDebit = transactions.filter(t => t.type === "debit").reduce((s, t) => s + parseFloat(t.amount), 0);

  res.json({
    transactions: transactions.map(t => ({
      ...t,
      amount: parseFloat(t.amount),
      createdAt: t.createdAt.toISOString(),
    })),
    total: transactions.length,
    totalCredit,
    totalDebit,
  });
});

/* ── Platform Settings ── */
router.get("/platform-settings", async (_req, res) => {
  /* Always seed new defaults (onConflictDoNothing keeps existing values intact) */
  await db.insert(platformSettingsTable).values(DEFAULT_PLATFORM_SETTINGS).onConflictDoNothing();
  const rows = await db.select().from(platformSettingsTable);
  const grouped: Record<string, any[]> = {};
  for (const row of rows) {
    if (!grouped[row.category]) grouped[row.category] = [];
    grouped[row.category]!.push({ key: row.key, value: row.value, label: row.label, updatedAt: row.updatedAt.toISOString() });
  }
  res.json({ settings: rows.map(r => ({ ...r, updatedAt: r.updatedAt.toISOString() })), grouped });
});

router.put("/platform-settings", async (req, res) => {
  const { settings } = req.body as { settings: Array<{ key: string; value: string }> };
  if (!Array.isArray(settings)) { res.status(400).json({ error: "settings array required" }); return; }
  for (const { key, value } of settings) {
    await db
      .update(platformSettingsTable)
      .set({ value: String(value), updatedAt: new Date() })
      .where(eq(platformSettingsTable.key, key));
  }
  /* Bust the security settings cache so new values apply immediately */
  invalidateSettingsCache();
  const changedKeys = settings.map((s: any) => s.key).join(", ");
  addAuditEntry({ action: "settings_update", ip: getClientIp(req), adminId: (req as any).adminId, details: `Updated ${settings.length} setting(s): ${changedKeys}`, result: "success" });
  const rows = await db.select().from(platformSettingsTable);
  res.json({ success: true, settings: rows.map(r => ({ ...r, updatedAt: r.updatedAt.toISOString() })) });
});

router.patch("/platform-settings/:key", async (req, res) => {
  const { value } = req.body;
  const settingKey = req.params["key"]!;
  const [row] = await db
    .update(platformSettingsTable)
    .set({ value: String(value), updatedAt: new Date() })
    .where(eq(platformSettingsTable.key, settingKey))
    .returning();
  if (!row) { res.status(404).json({ error: "Setting not found" }); return; }
  /* Bust the security settings cache so new values apply immediately */
  invalidateSettingsCache();
  addAuditEntry({ action: "settings_update", ip: getClientIp(req), adminId: (req as any).adminId, details: `Updated setting "${settingKey}" = "${value}"`, result: "success" });
  res.json({ ...row, updatedAt: row.updatedAt.toISOString() });
});

/* ── Pharmacy Orders Enriched ── */
router.get("/pharmacy-enriched", async (_req, res) => {
  const orders = await db.select().from(pharmacyOrdersTable).orderBy(desc(pharmacyOrdersTable.createdAt)).limit(200);
  const users = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone }).from(usersTable);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  res.json({
    orders: orders.map(o => ({
      ...o,
      total: parseFloat(String(o.total)),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
      userName: userMap[o.userId]?.name || null,
      userPhone: userMap[o.userId]?.phone || null,
    })),
    total: orders.length,
  });
});

/* ── Parcel Bookings Enriched ── */
router.get("/parcel-enriched", async (_req, res) => {
  const bookings = await db.select().from(parcelBookingsTable).orderBy(desc(parcelBookingsTable.createdAt)).limit(200);
  const users = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone }).from(usersTable);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  res.json({
    bookings: bookings.map(b => ({
      ...b,
      fare: parseFloat(b.fare),
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
      userName: userMap[b.userId]?.name || null,
      userPhone: userMap[b.userId]?.phone || null,
    })),
    total: bookings.length,
  });
});

/* ── Transactions Enriched ── */
router.get("/transactions-enriched", async (_req, res) => {
  const transactions = await db.select().from(walletTransactionsTable).orderBy(desc(walletTransactionsTable.createdAt)).limit(300);
  const users = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone }).from(usersTable);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));

  const enriched = transactions.map(t => ({
    ...t,
    amount: parseFloat(t.amount),
    createdAt: t.createdAt.toISOString(),
    userName: userMap[t.userId]?.name || null,
    userPhone: userMap[t.userId]?.phone || null,
  }));

  const totalCredit = enriched.filter(t => t.type === "credit").reduce((s, t) => s + t.amount, 0);
  const totalDebit = enriched.filter(t => t.type === "debit").reduce((s, t) => s + t.amount, 0);

  res.json({ transactions: enriched, total: transactions.length, totalCredit, totalDebit });
});

/* ── Delete User ── */
router.delete("/users/:id", async (req, res) => {
  await db.delete(usersTable).where(eq(usersTable.id, req.params["id"]!));
  res.json({ success: true });
});

/* ── User Activity (orders + rides summary) ── */
router.get("/users/:id/activity", async (req, res) => {
  const uid = req.params["id"]!;
  const orders = await db.select().from(ordersTable).where(eq(ordersTable.userId, uid)).orderBy(desc(ordersTable.createdAt)).limit(10);
  const rides = await db.select().from(ridesTable).where(eq(ridesTable.userId, uid)).orderBy(desc(ridesTable.createdAt)).limit(10);
  const pharmacy = await db.select().from(pharmacyOrdersTable).where(eq(pharmacyOrdersTable.userId, uid)).orderBy(desc(pharmacyOrdersTable.createdAt)).limit(5);
  const parcels = await db.select().from(parcelBookingsTable).where(eq(parcelBookingsTable.userId, uid)).orderBy(desc(parcelBookingsTable.createdAt)).limit(5);
  const txns = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.userId, uid)).orderBy(desc(walletTransactionsTable.createdAt)).limit(10);
  res.json({
    orders: orders.map(o => ({ ...o, total: parseFloat(String(o.total)), createdAt: o.createdAt.toISOString(), updatedAt: o.updatedAt.toISOString() })),
    rides: rides.map(r => ({ ...r, fare: parseFloat(r.fare), distance: parseFloat(r.distance), createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })),
    pharmacy: pharmacy.map(p => ({ ...p, total: parseFloat(String(p.total)), createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() })),
    parcels: parcels.map(p => ({ ...p, fare: parseFloat(p.fare), createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() })),
    transactions: txns.map(t => ({ ...t, amount: parseFloat(t.amount), createdAt: t.createdAt.toISOString() })),
  });
});

/* ── Overview with user enrichment (orders + user info) ── */
router.get("/orders-enriched", async (_req, res) => {
  const orders = await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt)).limit(200);
  const users = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone }).from(usersTable);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  res.json({
    orders: orders.map(o => ({
      ...o,
      total: parseFloat(String(o.total)),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
      userName: userMap[o.userId]?.name || null,
      userPhone: userMap[o.userId]?.phone || null,
    })),
    total: orders.length,
  });
});

router.get("/rides-enriched", async (_req, res) => {
  const [rides, users, bidCounts] = await Promise.all([
    db.select().from(ridesTable).orderBy(desc(ridesTable.createdAt)).limit(200),
    db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone }).from(usersTable),
    /* Count bids per ride for bargaining transparency */
    db.select({ rideId: rideBidsTable.rideId, total: count(rideBidsTable.id) })
      .from(rideBidsTable)
      .groupBy(rideBidsTable.rideId),
  ]);
  const userMap    = Object.fromEntries(users.map(u => [u.id, u]));
  const bidCountMap = Object.fromEntries(bidCounts.map(b => [b.rideId, Number(b.total)]));
  res.json({
    rides: rides.map(r => ({
      ...r,
      fare:        parseFloat(r.fare),
      distance:    parseFloat(r.distance),
      offeredFare: r.offeredFare ? parseFloat(r.offeredFare) : null,
      counterFare: r.counterFare ? parseFloat(r.counterFare) : null,
      createdAt:   r.createdAt.toISOString(),
      updatedAt:   r.updatedAt.toISOString(),
      userName:    userMap[r.userId]?.name  || null,
      userPhone:   userMap[r.userId]?.phone || null,
      totalBids:   bidCountMap[r.id] ?? 0,
    })),
    total: rides.length,
  });
});

/** Revoke all active refresh tokens and bump tokenVersion for a user — immediate session invalidation. */
async function revokeAllUserSessions(userId: string): Promise<void> {
  await db.update(usersTable)
    .set({ tokenVersion: sql`token_version + 1` })
    .where(eq(usersTable.id, userId));
  await db.delete(refreshTokensTable)
    .where(eq(refreshTokensTable.userId, userId));
}

/* ── User Security Management ── */
router.patch("/users/:id/security", async (req, res) => {
  const { id } = req.params;
  const body = req.body as any;
  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.isActive     !== undefined) updates.isActive     = body.isActive;
  if (body.isBanned     !== undefined) updates.isBanned     = body.isBanned;
  if (body.banReason    !== undefined) updates.banReason    = body.banReason || null;
  if (body.roles        !== undefined) { updates.roles = body.roles; updates.role = body.roles; }
  if (body.role         !== undefined) { updates.role  = body.role;  updates.roles = body.role; }
  if (body.blockedServices !== undefined) updates.blockedServices = body.blockedServices;
  if (body.securityNote !== undefined) updates.securityNote = body.securityNote || null;
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id!)).returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  /* Revoke all sessions if ban, deactivation, or role change occurred */
  if (body.isBanned || body.isActive === false || body.roles !== undefined || body.role !== undefined) {
    revokeAllUserSessions(id!).catch(() => {});
  }
  if (body.isBanned && body.notify) {
    await sendUserNotification(id!, "Account Suspended ⚠️", body.banReason || "Your account has been suspended. Contact support.", "warning", "warning-outline");
  }
  res.json({ ...user, walletBalance: parseFloat(String(user.walletBalance)) });
});

router.post("/users/:id/reset-otp", async (req, res) => {
  await db.update(usersTable).set({ otpCode: null, otpExpiry: null, updatedAt: new Date() }).where(eq(usersTable.id, req.params["id"]!));
  res.json({ success: true, message: "OTP cleared — user must re-authenticate" });
});

/* ── Force-disable 2FA for a user (admin action) ── */
router.post("/users/:id/2fa/disable", async (req, res) => {
  const userId = req.params["id"]!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (!user.totpEnabled) { res.status(400).json({ error: "2FA is not enabled for this user" }); return; }

  await db.update(usersTable).set({
    totpEnabled: false, totpSecret: null, backupCodes: null, trustedDevices: null, updatedAt: new Date(),
  }).where(eq(usersTable.id, userId));

  const ip = getClientIp(req);
  addAuditEntry({ action: "admin_2fa_disable", ip, details: `Admin force-disabled 2FA for user ${userId} (${user.phone})`, result: "success" });
  writeAuthAuditLog("admin_2fa_disabled", { userId, ip, userAgent: req.headers["user-agent"] as string, metadata: { adminAction: true } });

  res.json({ success: true, message: `2FA disabled for user ${user.name ?? user.phone}` });
});

/* ── Admin Accounts (Sub-Admins) ── */
router.get("/admin-accounts", async (_req, res) => {
  const accounts = await db.select({
    id: adminAccountsTable.id,
    name: adminAccountsTable.name,
    role: adminAccountsTable.role,
    permissions: adminAccountsTable.permissions,
    isActive: adminAccountsTable.isActive,
    lastLoginAt: adminAccountsTable.lastLoginAt,
    createdAt: adminAccountsTable.createdAt,
  }).from(adminAccountsTable).orderBy(desc(adminAccountsTable.createdAt));
  res.json({
    accounts: accounts.map(a => ({
      ...a,
      lastLoginAt: a.lastLoginAt ? a.lastLoginAt.toISOString() : null,
      createdAt: a.createdAt.toISOString(),
    })),
  });
});

router.post("/admin-accounts", async (req, res) => {
  const body = req.body as any;
  if (!body.name || !body.secret) { res.status(400).json({ error: "name and secret required" }); return; }
  if (body.secret === getAdminSecret()) { res.status(400).json({ error: "Cannot use the master secret" }); return; }
  try {
    const [account] = await db.insert(adminAccountsTable).values({
      id:          generateId(),
      name:        body.name,
      secret:      hashAdminSecret(body.secret),
      role:        body.role        || "manager",
      permissions: body.permissions || "",
      isActive:    body.isActive !== false,
    }).returning();
    res.status(201).json({ ...account, secret: "••••••", createdAt: account.createdAt.toISOString() });
  } catch (e: any) {
    if (e.code === "23505") { res.status(409).json({ error: "Secret already in use" }); return; }
    throw e;
  }
});

router.patch("/admin-accounts/:id", async (req, res) => {
  const body = req.body as any;
  const updates: Record<string, any> = {};
  if (body.name        !== undefined) updates.name        = body.name;
  if (body.role        !== undefined) updates.role        = body.role;
  if (body.permissions !== undefined) updates.permissions = body.permissions;
  if (body.isActive    !== undefined) updates.isActive    = body.isActive;
  if (body.secret      !== undefined) {
    if (body.secret === getAdminSecret()) { res.status(400).json({ error: "Cannot use the master secret" }); return; }
    updates.secret = hashAdminSecret(body.secret);
  }
  const [account] = await db.update(adminAccountsTable).set(updates).where(eq(adminAccountsTable.id, req.params["id"]!)).returning();
  if (!account) { res.status(404).json({ error: "Admin account not found" }); return; }
  res.json({ ...account, secret: "••••••", createdAt: account.createdAt.toISOString() });
});

router.delete("/admin-accounts/:id", async (req, res) => {
  await db.delete(adminAccountsTable).where(eq(adminAccountsTable.id, req.params["id"]!));
  res.json({ success: true });
});

/* ── App Management ── */
router.get("/app-overview", async (_req, res) => {
  const [
    totalUsers, activeUsers, bannedUsers,
    totalOrders, pendingOrders,
    totalRides, activeRides,
    totalPharmacy, totalParcel,
    settings, adminAccounts,
  ] = await Promise.all([
    db.select({ c: count() }).from(usersTable),
    db.select({ c: count() }).from(usersTable).where(eq(usersTable.isActive, true)),
    db.select({ c: count() }).from(usersTable).where(eq(usersTable.isBanned, true)),
    db.select({ c: count() }).from(ordersTable),
    db.select({ c: count() }).from(ordersTable).where(eq(ordersTable.status, "pending")),
    db.select({ c: count() }).from(ridesTable),
    db.select({ c: count() }).from(ridesTable).where(eq(ridesTable.status, "ongoing")),
    db.select({ c: count() }).from(pharmacyOrdersTable),
    db.select({ c: count() }).from(parcelBookingsTable),
    db.select().from(platformSettingsTable),
    db.select({ c: count() }).from(adminAccountsTable).where(eq(adminAccountsTable.isActive, true)),
  ]);
  const settingsMap = Object.fromEntries(settings.map(s => [s.key, s.value]));
  res.json({
    users:    { total: totalUsers[0]?.c ?? 0, active: activeUsers[0]?.c ?? 0, banned: bannedUsers[0]?.c ?? 0 },
    orders:   { total: totalOrders[0]?.c ?? 0, pending: pendingOrders[0]?.c ?? 0 },
    rides:    { total: totalRides[0]?.c ?? 0, active: activeRides[0]?.c ?? 0 },
    pharmacy: { total: totalPharmacy[0]?.c ?? 0 },
    parcel:   { total: totalParcel[0]?.c ?? 0 },
    adminAccounts: adminAccounts[0]?.c ?? 0,
    appStatus:    settingsMap["app_status"]    || "active",
    appName:      settingsMap["app_name"]      || "AJKMart",
    features: {
      mart:     settingsMap["feature_mart"]     || "on",
      food:     settingsMap["feature_food"]     || "on",
      rides:    settingsMap["feature_rides"]    || "on",
      pharmacy: settingsMap["feature_pharmacy"] || "on",
      parcel:   settingsMap["feature_parcel"]   || "on",
      wallet:   settingsMap["feature_wallet"]   || "on",
    },
  });
});

/* ── Flash Deals ── */
router.get("/flash-deals", async (_req, res) => {
  const deals = await db.select().from(flashDealsTable).orderBy(desc(flashDealsTable.createdAt));
  const products = await db.select({ id: productsTable.id, name: productsTable.name, price: productsTable.price, image: productsTable.image, category: productsTable.category }).from(productsTable);
  const productMap = Object.fromEntries(products.map(p => [p.id, p]));
  const now = new Date();
  res.json({
    deals: deals.map(d => ({
      ...d,
      discountPct:  d.discountPct  ? parseFloat(String(d.discountPct))  : null,
      discountFlat: d.discountFlat ? parseFloat(String(d.discountFlat)) : null,
      startTime: d.startTime.toISOString(),
      endTime:   d.endTime.toISOString(),
      createdAt: d.createdAt.toISOString(),
      product:   productMap[d.productId] ?? null,
      status: !d.isActive ? "inactive"
            : now < d.startTime ? "scheduled"
            : now > d.endTime   ? "expired"
            : d.dealStock !== null && d.soldCount >= d.dealStock ? "sold_out"
            : "live",
    })),
  });
});

router.post("/flash-deals", async (req, res) => {
  const body = req.body as any;
  if (!body.productId || !body.startTime || !body.endTime) {
    res.status(400).json({ error: "productId, startTime, endTime required" }); return;
  }
  const [deal] = await db.insert(flashDealsTable).values({
    id:           generateId(),
    productId:    body.productId,
    title:        body.title    || null,
    badge:        body.badge    || "FLASH",
    discountPct:  body.discountPct  ? String(body.discountPct)  : null,
    discountFlat: body.discountFlat ? String(body.discountFlat) : null,
    startTime:    new Date(body.startTime),
    endTime:      new Date(body.endTime),
    dealStock:    body.dealStock  ? Number(body.dealStock)  : null,
    isActive:     body.isActive !== false,
  }).returning();
  res.status(201).json(deal);
});

router.patch("/flash-deals/:id", async (req, res) => {
  const body = req.body as any;
  const updates: Record<string, any> = {};
  if (body.title        !== undefined) updates.title        = body.title;
  if (body.badge        !== undefined) updates.badge        = body.badge;
  if (body.discountPct  !== undefined) updates.discountPct  = body.discountPct  ? String(body.discountPct)  : null;
  if (body.discountFlat !== undefined) updates.discountFlat = body.discountFlat ? String(body.discountFlat) : null;
  if (body.startTime    !== undefined) updates.startTime    = new Date(body.startTime);
  if (body.endTime      !== undefined) updates.endTime      = new Date(body.endTime);
  if (body.dealStock    !== undefined) updates.dealStock    = body.dealStock ? Number(body.dealStock) : null;
  if (body.isActive     !== undefined) updates.isActive     = body.isActive;
  const [deal] = await db.update(flashDealsTable).set(updates).where(eq(flashDealsTable.id, req.params["id"]!)).returning();
  if (!deal) { res.status(404).json({ error: "Deal not found" }); return; }
  res.json(deal);
});

router.delete("/flash-deals/:id", async (req, res) => {
  await db.delete(flashDealsTable).where(eq(flashDealsTable.id, req.params["id"]!));
  res.json({ success: true });
});

/* ── Promo Codes ── */
router.get("/promo-codes", async (_req, res) => {
  const codes = await db.select().from(promoCodesTable).orderBy(desc(promoCodesTable.createdAt));
  const now = new Date();
  res.json({
    codes: codes.map(c => ({
      ...c,
      discountPct:    c.discountPct    ? parseFloat(String(c.discountPct))    : null,
      discountFlat:   c.discountFlat   ? parseFloat(String(c.discountFlat))   : null,
      minOrderAmount: c.minOrderAmount ? parseFloat(String(c.minOrderAmount)) : 0,
      maxDiscount:    c.maxDiscount    ? parseFloat(String(c.maxDiscount))    : null,
      expiresAt:  c.expiresAt  ? c.expiresAt.toISOString()  : null,
      createdAt:  c.createdAt.toISOString(),
      status: !c.isActive ? "inactive"
            : c.expiresAt && now > c.expiresAt ? "expired"
            : c.usageLimit !== null && c.usedCount >= c.usageLimit ? "exhausted"
            : "active",
    })),
  });
});

router.post("/promo-codes", async (req, res) => {
  const body = req.body as any;
  if (!body.code) { res.status(400).json({ error: "code required" }); return; }
  try {
    const [code] = await db.insert(promoCodesTable).values({
      id:             generateId(),
      code:           String(body.code).toUpperCase().trim(),
      description:    body.description    || null,
      discountPct:    body.discountPct    ? String(body.discountPct)    : null,
      discountFlat:   body.discountFlat   ? String(body.discountFlat)   : null,
      minOrderAmount: body.minOrderAmount ? String(body.minOrderAmount) : "0",
      maxDiscount:    body.maxDiscount    ? String(body.maxDiscount)    : null,
      usageLimit:     body.usageLimit     ? Number(body.usageLimit)     : null,
      appliesTo:      body.appliesTo      || "all",
      expiresAt:      body.expiresAt      ? new Date(body.expiresAt)    : null,
      isActive:       body.isActive !== false,
    }).returning();
    res.status(201).json(code);
  } catch (e: any) {
    if (e.code === "23505") { res.status(409).json({ error: "Promo code already exists" }); return; }
    throw e;
  }
});

router.patch("/promo-codes/:id", async (req, res) => {
  const body = req.body as any;
  const updates: Record<string, any> = {};
  if (body.code           !== undefined) updates.code           = String(body.code).toUpperCase().trim();
  if (body.description    !== undefined) updates.description    = body.description;
  if (body.discountPct    !== undefined) updates.discountPct    = body.discountPct    ? String(body.discountPct)    : null;
  if (body.discountFlat   !== undefined) updates.discountFlat   = body.discountFlat   ? String(body.discountFlat)   : null;
  if (body.minOrderAmount !== undefined) updates.minOrderAmount = String(body.minOrderAmount);
  if (body.maxDiscount    !== undefined) updates.maxDiscount    = body.maxDiscount    ? String(body.maxDiscount)    : null;
  if (body.usageLimit     !== undefined) updates.usageLimit     = body.usageLimit     ? Number(body.usageLimit)     : null;
  if (body.appliesTo      !== undefined) updates.appliesTo      = body.appliesTo;
  if (body.expiresAt      !== undefined) updates.expiresAt      = body.expiresAt      ? new Date(body.expiresAt)    : null;
  if (body.isActive       !== undefined) updates.isActive       = body.isActive;
  const [code] = await db.update(promoCodesTable).set(updates).where(eq(promoCodesTable.id, req.params["id"]!)).returning();
  if (!code) { res.status(404).json({ error: "Promo code not found" }); return; }
  res.json(code);
});

router.delete("/promo-codes/:id", async (req, res) => {
  await db.delete(promoCodesTable).where(eq(promoCodesTable.id, req.params["id"]!));
  res.json({ success: true });
});

/* ══════════════════════════════════════
   VENDOR MANAGEMENT
══════════════════════════════════════ */
router.get("/vendors", async (_req, res) => {
  const vendors = await db.select().from(usersTable).where(
    or(ilike(usersTable.roles, "%vendor%"), eq(usersTable.role, "vendor"))
  ).orderBy(desc(usersTable.createdAt));

  const vendorIds = vendors.map(v => v.id);
  let orderStats: any[] = [];
  if (vendorIds.length > 0) {
    orderStats = await db.select({
      vendorId: ordersTable.vendorId,
      totalOrders: count(),
      totalRevenue: sum(ordersTable.total),
      pendingOrders: sql<number>`COUNT(*) FILTER (WHERE ${ordersTable.status} = 'pending')`,
    }).from(ordersTable).where(sql`${ordersTable.vendorId} = ANY(${sql.raw(`ARRAY[${vendorIds.map(id => `'${id}'`).join(",")}]`)})`).groupBy(ordersTable.vendorId).catch(() => []);
  }

  const statsMap = Object.fromEntries(orderStats.map(s => [s.vendorId, s]));

  res.json({
    vendors: vendors.map(v => {
      const stats = statsMap[v.id] || {};
      return {
        id: v.id, phone: v.phone, name: v.name, email: v.email,
        storeName: v.storeName, storeCategory: v.storeCategory,
        storeIsOpen: v.storeIsOpen, storeDescription: v.storeDescription,
        walletBalance: parseFloat(v.walletBalance ?? "0"),
        isActive: v.isActive, isBanned: v.isBanned,
        roles: v.roles, role: v.role,
        createdAt: v.createdAt.toISOString(),
        lastLoginAt: v.lastLoginAt ? v.lastLoginAt.toISOString() : null,
        totalOrders: Number(stats.totalOrders ?? 0),
        totalRevenue: parseFloat(String(stats.totalRevenue ?? "0")),
        pendingOrders: Number(stats.pendingOrders ?? 0),
      };
    }),
    total: vendors.length,
  });
});

router.patch("/vendors/:id/status", async (req, res) => {
  const { isActive, isBanned, banReason, securityNote } = req.body;
  const updates: Record<string, any> = { updatedAt: new Date() };
  if (isActive    !== undefined) updates.isActive    = isActive;
  if (isBanned    !== undefined) updates.isBanned    = isBanned;
  if (banReason   !== undefined) updates.banReason   = banReason || null;
  if (securityNote !== undefined) updates.securityNote = securityNote || null;
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, req.params["id"]!)).returning();
  if (!user) { res.status(404).json({ error: "Vendor not found" }); return; }
  if (isBanned || isActive === false) {
    revokeAllUserSessions(req.params["id"]!).catch(() => {});
    if (isBanned) {
      await sendUserNotification(req.params["id"]!, "Store Account Suspended ⚠️", banReason || "Your vendor account has been suspended. Contact support.", "warning", "warning-outline");
    }
  }
  res.json({ ...user, walletBalance: parseFloat(String(user.walletBalance ?? "0")) });
});

router.post("/vendors/:id/payout", async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ error: "Valid amount required" }); return;
  }
  const [vendor] = await db.select().from(usersTable).where(eq(usersTable.id, req.params["id"]!)).limit(1);
  if (!vendor) { res.status(404).json({ error: "Vendor not found" }); return; }
  const amt = Number(amount);
  const currentBal = parseFloat(vendor.walletBalance ?? "0");
  if (currentBal < amt) {
    res.status(400).json({ error: `Insufficient wallet balance (Rs. ${currentBal.toFixed(0)})` }); return;
  }
  const newBal = currentBal - amt;
  const [updated] = await db.update(usersTable).set({ walletBalance: String(newBal), updatedAt: new Date() }).where(eq(usersTable.id, vendor.id)).returning();
  await db.insert(walletTransactionsTable).values({
    id: generateId(), userId: vendor.id, type: "debit", amount: String(amt),
    description: description || `Admin payout processed: Rs. ${amt}`, reference: "admin_payout",
  });
  await sendUserNotification(vendor.id, "Payout Processed 💰", `Rs. ${amt} has been paid out from your vendor wallet.`, "system", "cash-outline");
  res.json({ success: true, amount: amt, newBalance: newBal, vendor: { ...stripUser(updated!), walletBalance: newBal } });
});

router.post("/vendors/:id/credit", async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ error: "Valid amount required" }); return;
  }
  const [vendor] = await db.select().from(usersTable).where(eq(usersTable.id, req.params["id"]!)).limit(1);
  if (!vendor) { res.status(404).json({ error: "Vendor not found" }); return; }
  const amt = Number(amount);
  const newBal = parseFloat(vendor.walletBalance ?? "0") + amt;
  const [updated] = await db.update(usersTable).set({ walletBalance: String(newBal), updatedAt: new Date() }).where(eq(usersTable.id, vendor.id)).returning();
  await db.insert(walletTransactionsTable).values({
    id: generateId(), userId: vendor.id, type: "credit", amount: String(amt),
    description: description || `Admin credit: Rs. ${amt}`, reference: "admin_credit",
  });
  await sendUserNotification(vendor.id, "Wallet Credited 💰", `Rs. ${amt} has been credited to your vendor wallet.`, "system", "wallet-outline");
  res.json({ success: true, amount: amt, newBalance: newBal, vendor: { ...stripUser(updated!), walletBalance: newBal } });
});

/* ══════════════════════════════════════
   RIDER MANAGEMENT
══════════════════════════════════════ */
router.get("/riders", async (_req, res) => {
  const riders = await db.select().from(usersTable).where(
    or(ilike(usersTable.roles, "%rider%"), eq(usersTable.role, "rider"))
  ).orderBy(desc(usersTable.createdAt));

  const riderIds = riders.map(r => r.id);
  const [penaltyRows, ratingRows] = await Promise.all([
    riderIds.length > 0
      ? db.select({ riderId: riderPenaltiesTable.riderId, total: sum(riderPenaltiesTable.amount) })
          .from(riderPenaltiesTable)
          .where(sql`${riderPenaltiesTable.riderId} IN ${riderIds}`)
          .groupBy(riderPenaltiesTable.riderId)
      : Promise.resolve([]),
    riderIds.length > 0
      ? db.select({ riderId: rideRatingsTable.riderId, avgRating: sql<string>`ROUND(AVG(${rideRatingsTable.stars})::numeric, 1)`, ratingCount: count() })
          .from(rideRatingsTable)
          .where(sql`${rideRatingsTable.riderId} IN ${riderIds}`)
          .groupBy(rideRatingsTable.riderId)
      : Promise.resolve([]),
  ]);
  const penaltyMap = new Map(penaltyRows.map((r: any) => [r.riderId, parseFloat(r.total ?? "0")]));
  const ratingMap = new Map(ratingRows.map((r: any) => [r.riderId, { avg: parseFloat(r.avgRating ?? "0"), count: r.ratingCount }]));

  res.json({
    riders: riders.map(r => ({
      id: r.id, phone: r.phone, name: r.name, email: r.email,
      avatar: r.avatar,
      walletBalance: parseFloat(r.walletBalance ?? "0"),
      isActive: r.isActive, isBanned: r.isBanned,
      isRestricted: r.isRestricted ?? false,
      cancelCount: r.cancelCount ?? 0,
      ignoreCount: r.ignoreCount ?? 0,
      penaltyTotal: penaltyMap.get(r.id) ?? 0,
      avgRating: ratingMap.get(r.id)?.avg ?? 0,
      ratingCount: ratingMap.get(r.id)?.count ?? 0,
      roles: r.roles, role: r.role,
      isOnline: (r as any).isOnline ?? false,
      createdAt: r.createdAt.toISOString(),
      lastLoginAt: r.lastLoginAt ? r.lastLoginAt.toISOString() : null,
    })),
    total: riders.length,
  });
});

router.patch("/riders/:id/status", async (req, res) => {
  const { isActive, isBanned, banReason } = req.body;
  const updates: Record<string, any> = { updatedAt: new Date() };
  if (isActive  !== undefined) updates.isActive  = isActive;
  if (isBanned  !== undefined) updates.isBanned  = isBanned;
  if (banReason !== undefined) updates.banReason = banReason || null;
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, req.params["id"]!)).returning();
  if (!user) { res.status(404).json({ error: "Rider not found" }); return; }
  if (isBanned || isActive === false) {
    revokeAllUserSessions(req.params["id"]!).catch(() => {});
    if (isBanned) {
      await sendUserNotification(req.params["id"]!, "Rider Account Suspended ⚠️", banReason || "Your rider account has been suspended. Contact support.", "warning", "warning-outline");
    }
  }
  res.json({ ...user, walletBalance: parseFloat(String(user.walletBalance ?? "0")) });
});

router.post("/riders/:id/payout", async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ error: "Valid amount required" }); return;
  }
  const [rider] = await db.select().from(usersTable).where(eq(usersTable.id, req.params["id"]!)).limit(1);
  if (!rider) { res.status(404).json({ error: "Rider not found" }); return; }
  const amt = Number(amount);
  const currentBal = parseFloat(rider.walletBalance ?? "0");
  if (currentBal < amt) {
    res.status(400).json({ error: `Insufficient wallet balance (Rs. ${currentBal.toFixed(0)})` }); return;
  }
  const newBal = currentBal - amt;
  const [updated] = await db.update(usersTable).set({ walletBalance: String(newBal), updatedAt: new Date() }).where(eq(usersTable.id, rider.id)).returning();
  await db.insert(walletTransactionsTable).values({
    id: generateId(), userId: rider.id, type: "debit", amount: String(amt),
    description: description || `Rider payout: Rs. ${amt}`, reference: "rider_payout",
  });
  await sendUserNotification(rider.id, "Earnings Paid Out 💵", `Rs. ${amt} has been paid out to your account.`, "system", "cash-outline");
  res.json({ success: true, amount: amt, newBalance: newBal, rider: { ...updated, walletBalance: newBal } });
});

router.post("/riders/:id/bonus", async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ error: "Valid amount required" }); return;
  }
  const [rider] = await db.select().from(usersTable).where(eq(usersTable.id, req.params["id"]!)).limit(1);
  if (!rider) { res.status(404).json({ error: "Rider not found" }); return; }
  const amt = Number(amount);
  const newBal = parseFloat(rider.walletBalance ?? "0") + amt;
  const [updated] = await db.update(usersTable).set({ walletBalance: String(newBal), updatedAt: new Date() }).where(eq(usersTable.id, rider.id)).returning();
  await db.insert(walletTransactionsTable).values({
    id: generateId(), userId: rider.id, type: "credit", amount: String(amt),
    description: description || `Admin bonus: Rs. ${amt}`, reference: "rider_bonus",
  });
  await sendUserNotification(rider.id, "Bonus Received! 🎉", `Rs. ${amt} bonus has been added to your wallet.`, "system", "gift-outline");
  res.json({ success: true, amount: amt, newBalance: newBal, rider: { ...updated, walletBalance: newBal } });
});

router.get("/riders/:id/penalties", async (req, res) => {
  const riderId = req.params["id"]!;
  const penalties = await db.select().from(riderPenaltiesTable)
    .where(eq(riderPenaltiesTable.riderId, riderId))
    .orderBy(desc(riderPenaltiesTable.createdAt))
    .limit(100);
  res.json({ penalties: penalties.map(p => ({ ...p, amount: parseFloat(String(p.amount)) })) });
});

router.get("/riders/:id/ratings", async (req, res) => {
  const riderId = req.params["id"]!;
  const ratings = await db.select().from(rideRatingsTable)
    .where(eq(rideRatingsTable.riderId, riderId))
    .orderBy(desc(rideRatingsTable.createdAt))
    .limit(100);
  res.json({ ratings });
});

router.post("/riders/:id/restrict", async (req, res) => {
  const riderId = req.params["id"]!;
  const [user] = await db.update(usersTable)
    .set({ isRestricted: true, updatedAt: new Date() })
    .where(eq(usersTable.id, riderId))
    .returning();
  if (!user) { res.status(404).json({ error: "Rider not found" }); return; }
  await sendUserNotification(riderId, "Account Restricted ⚠️", "Your account has been restricted by admin. Contact support for more details.", "system", "alert-circle-outline");
  res.json({ success: true, isRestricted: true });
});

router.post("/riders/:id/unrestrict", async (req, res) => {
  const riderId = req.params["id"]!;
  const [user] = await db.update(usersTable)
    .set({ isRestricted: false, updatedAt: new Date() })
    .where(eq(usersTable.id, riderId))
    .returning();
  if (!user) { res.status(404).json({ error: "Rider not found" }); return; }
  await sendUserNotification(riderId, "Account Unrestricted ✅", "Your account has been unrestricted. You can now accept rides again.", "system", "checkmark-circle-outline");
  res.json({ success: true, isRestricted: false });
});

/* ── GET /admin/withdrawal-requests ─────────── */
router.get("/withdrawal-requests", async (req, res) => {
  const statusFilter = req.query["status"] as string | undefined;
  const txns = await db.select().from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.type, "withdrawal"))
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(300);
  const enriched = await Promise.all(txns.map(async t => {
    const [user] = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, t.userId)).limit(1);
    const ref = t.reference ?? "pending";
    const status = ref === "pending" ? "pending" : ref.startsWith("paid:") ? "paid" : ref.startsWith("rejected:") ? "rejected" : ref;
    const refNo = ref.startsWith("paid:") ? ref.slice(5) : ref.startsWith("rejected:") ? ref.slice(9) : "";
    return { ...t, amount: parseFloat(String(t.amount)), user: user || null, status, refNo };
  }));
  const filtered = statusFilter ? enriched.filter(w => w.status === statusFilter) : enriched;
  res.json({ withdrawals: filtered });
});

/* ── PATCH /admin/withdrawal-requests/:id/approve ─── */
router.patch("/withdrawal-requests/:id/approve", async (req, res) => {
  const { refNo, note } = req.body;
  const txId = req.params["id"]!;
  const [tx] = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
  if (!tx) { res.status(404).json({ error: "Withdrawal not found" }); return; }
  if (tx.reference && tx.reference !== "pending") {
    res.status(400).json({ error: `Already processed (${tx.reference})` }); return;
  }
  const ref = refNo ? `paid:${refNo.trim()}` : "paid:manual";
  await db.update(walletTransactionsTable).set({ reference: ref }).where(eq(walletTransactionsTable.id, txId));
  const amt = parseFloat(String(tx.amount));
  await db.insert(notificationsTable).values({
    id: generateId(), userId: tx.userId,
    title: "Withdrawal Processed ✅",
    body: `Rs. ${amt.toFixed(0)} aapke account mein transfer kar diya gaya hai.${refNo ? ` Reference: ${refNo}` : ""}${note ? ` Note: ${note}` : ""}`,
    type: "wallet", icon: "checkmark-circle-outline",
  }).catch(() => {});
  res.json({ success: true, txId, status: "paid", refNo: refNo || "manual" });
});

/* ── PATCH /admin/withdrawal-requests/:id/reject ─── */
router.patch("/withdrawal-requests/:id/reject", async (req, res) => {
  const { reason } = req.body;
  const txId = req.params["id"]!;
  const [tx] = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
  if (!tx) { res.status(404).json({ error: "Withdrawal not found" }); return; }
  if (tx.reference && tx.reference !== "pending") {
    res.status(400).json({ error: `Already processed (${tx.reference})` }); return;
  }
  const rejReason = reason?.trim() || "Admin rejected";
  await db.update(walletTransactionsTable).set({ reference: `rejected:${rejReason}` }).where(eq(walletTransactionsTable.id, txId));
  const amt = parseFloat(String(tx.amount));
  await db.update(usersTable).set({ walletBalance: sql`wallet_balance + ${amt}`, updatedAt: new Date() }).where(eq(usersTable.id, tx.userId));
  await db.insert(walletTransactionsTable).values({
    id: generateId(), userId: tx.userId, type: "credit",
    amount: amt.toFixed(2),
    description: `Withdrawal Refunded — ${rejReason}`,
    reference: `refund:${txId}`,
    paymentMethod: null,
  });
  await db.insert(notificationsTable).values({
    id: generateId(), userId: tx.userId,
    title: "Withdrawal Rejected ❌",
    body: `Rs. ${amt.toFixed(0)} withdrawal reject ho gaya. Reason: ${rejReason}. Raqam wapas wallet mein aa gaya hai.`,
    type: "wallet", icon: "close-circle-outline",
  }).catch(() => {});
  res.json({ success: true, txId, status: "rejected", reason: rejReason, refunded: amt });
});

/* ── PATCH /admin/withdrawal-requests/batch-approve ─── */
router.patch("/withdrawal-requests/batch-approve", async (req, res) => {
  const { ids } = req.body as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids required" }); return; }
  const results: any[] = [];
  for (const txId of ids) {
    const [tx] = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
    if (!tx || (tx.reference && tx.reference !== "pending")) continue;
    const refNo = `BATCH-${Date.now()}`;
    await db.update(walletTransactionsTable).set({ reference: refNo }).where(eq(walletTransactionsTable.id, txId));
    await db.insert(notificationsTable).values({
      id: generateId(), userId: tx.userId,
      title: "Withdrawal Approved ✅",
      body: `Rs. ${parseFloat(String(tx.amount)).toFixed(0)} withdrawal approve ho gaya. Ref: ${refNo}`,
      type: "wallet", icon: "checkmark-circle-outline",
    }).catch(() => {});
    results.push(txId);
  }
  res.json({ success: true, approved: results });
});

/* ── PATCH /admin/withdrawal-requests/batch-reject ─── */
router.patch("/withdrawal-requests/batch-reject", async (req, res) => {
  const { ids, reason } = req.body as { ids: string[]; reason: string };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids required" }); return; }
  const rejReason = (reason || "Admin batch rejected").trim();
  const results: any[] = [];
  for (const txId of ids) {
    const [tx] = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
    if (!tx || (tx.reference && tx.reference !== "pending")) continue;
    await db.update(walletTransactionsTable).set({ reference: `rejected:${rejReason}` }).where(eq(walletTransactionsTable.id, txId));
    const amt = parseFloat(String(tx.amount));
    await db.update(usersTable).set({ walletBalance: sql`wallet_balance + ${amt}`, updatedAt: new Date() }).where(eq(usersTable.id, tx.userId));
    await db.insert(walletTransactionsTable).values({
      id: generateId(), userId: tx.userId, type: "credit", amount: amt.toFixed(2),
      description: `Withdrawal Refunded — ${rejReason}`, reference: `refund:${txId}`, paymentMethod: null,
    });
    results.push(txId);
  }
  res.json({ success: true, rejected: results });
});

/* ── GET /admin/deposit-requests — List all rider deposit requests ─── */
router.get("/deposit-requests", async (req, res) => {
  const statusFilter = req.query["status"] as string | undefined;
  const txns = await db.select().from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.type, "deposit"))
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(200);
  const enriched = await Promise.all(txns.map(async t => {
    const [user] = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, t.userId)).limit(1);
    const ref = t.reference ?? "pending";
    const isPending = ref === "pending" || ref.startsWith("pending:");
    const status = isPending ? "pending" : ref.startsWith("approved:") ? "approved" : ref.startsWith("rejected:") ? "rejected" : ref;
    const refNo = ref.startsWith("approved:") || ref.startsWith("rejected:") ? ref.split(":").slice(1).join(":") : "";
    return { ...t, amount: parseFloat(String(t.amount)), user: user || null, status, refNo };
  }));
  const filtered = statusFilter ? enriched.filter(d => d.status === statusFilter) : enriched;
  res.json({ deposits: filtered });
});

/* ── PATCH /admin/deposit-requests/:id/approve — Approve a rider deposit (credits wallet, atomic) ─── */
router.patch("/deposit-requests/:id/approve", async (req, res) => {
  const { refNo, note } = req.body;
  const txId = req.params["id"]!;

  /* First, verify it exists and is the right type */
  const [tx] = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
  if (!tx) { res.status(404).json({ error: "Deposit not found" }); return; }
  if (tx.type !== "deposit") { res.status(400).json({ error: "Not a deposit record" }); return; }

  const amt = parseFloat(String(tx.amount));
  const txidSuffix = (tx.reference && tx.reference.includes("txid:")) ? `:${tx.reference.split("txid:").pop()}` : "";
  const approvedRef = refNo ? `approved:${refNo.trim()}${txidSuffix}` : `approved:manual${txidSuffix}`;

  /* Fully atomic: conditional state-transition + wallet credit in ONE transaction.
     If the conditional update hits 0 rows (already processed), transaction rolls back
     and we return 409. No double-credit or orphaned approval possible. */
  let approved = false;
  try {
    await db.transaction(async (trx) => {
      const [marked] = await trx.update(walletTransactionsTable)
        .set({ reference: approvedRef })
        .where(and(eq(walletTransactionsTable.id, txId), sql`(${walletTransactionsTable.reference} = 'pending' OR ${walletTransactionsTable.reference} LIKE 'pending:%')`))
        .returning({ id: walletTransactionsTable.id });
      if (!marked) throw new Error("ALREADY_PROCESSED");
      await trx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance + ${amt}`, updatedAt: new Date() })
        .where(eq(usersTable.id, tx.userId));
    });
    approved = true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "ALREADY_PROCESSED") {
      const [current] = await db.select({ reference: walletTransactionsTable.reference }).from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
      res.status(409).json({ error: `Deposit already processed (${current?.reference ?? "unknown state"})` }); return;
    }
    throw err;
  }

  if (!approved) return;
  await db.insert(notificationsTable).values({
    id: generateId(), userId: tx.userId,
    title: "Deposit Credited ✅",
    body: `Rs. ${amt.toFixed(0)} aapki wallet mein add kar diya gaya hai!${refNo ? ` Ref: ${refNo}` : ""}${note ? ` Note: ${note}` : ""}`,
    type: "wallet", icon: "wallet-outline",
  }).catch(e => console.error("deposit approval notif failed:", e));
  res.json({ success: true, txId, status: "approved", credited: amt });
});

/* ── PATCH /admin/deposit-requests/:id/reject — Reject a rider deposit (atomic state transition) ─── */
router.patch("/deposit-requests/:id/reject", async (req, res) => {
  const { reason } = req.body;
  const txId = req.params["id"]!;

  /* Verify type first (cheap read) */
  const [tx] = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
  if (!tx) { res.status(404).json({ error: "Deposit not found" }); return; }
  if (tx.type !== "deposit") { res.status(400).json({ error: "Not a deposit record" }); return; }

  const rejReason = reason?.trim() || "Admin rejected";
  const txidSuffix = (tx.reference && tx.reference.includes("txid:")) ? `:${tx.reference.split("txid:").pop()}` : "";

  const [marked] = await db.update(walletTransactionsTable)
    .set({ reference: `rejected:${rejReason}${txidSuffix}` })
    .where(and(eq(walletTransactionsTable.id, txId), sql`(${walletTransactionsTable.reference} = 'pending' OR ${walletTransactionsTable.reference} LIKE 'pending:%')`))
    .returning({ id: walletTransactionsTable.id });

  if (!marked) {
    const [current] = await db.select({ reference: walletTransactionsTable.reference }).from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
    res.status(409).json({ error: `Deposit already processed (${current?.reference ?? "unknown state"})` }); return;
  }

  const amt = parseFloat(String(tx.amount));
  await db.insert(notificationsTable).values({
    id: generateId(), userId: tx.userId,
    title: "Deposit Rejected ❌",
    body: `Rs. ${amt.toFixed(0)} deposit request reject ho gayi. Reason: ${rejReason}.`,
    type: "wallet", icon: "close-circle-outline",
  }).catch(e => console.error("deposit rejection notif failed:", e));
  res.json({ success: true, txId, status: "rejected", reason: rejReason });
});

/* ── POST /admin/deposit-requests/bulk-approve — Bulk approve customer pending deposits (all-or-nothing atomic) ─── */
router.post("/deposit-requests/bulk-approve", async (req, res) => {
  const { ids, refNo } = req.body as { ids: string[]; refNo?: string };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids array is required" }); return; }
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length > 50) { res.status(400).json({ error: "Maximum 50 deposits per bulk action" }); return; }

  const preChecked: { tx: typeof walletTransactionsTable.$inferSelect; amt: number; approvedRef: string }[] = [];
  for (const txId of uniqueIds) {
    const [tx] = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
    if (!tx) { res.status(400).json({ error: `Deposit ${txId} not found` }); return; }
    if (tx.type !== "deposit") { res.status(400).json({ error: `${txId} is not a deposit record` }); return; }
    const ref = tx.reference ?? "pending";
    const isPending = ref === "pending" || ref.startsWith("pending:");
    if (!isPending) { res.status(409).json({ error: `Deposit ${txId} already processed (${ref})` }); return; }
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, tx.userId)).limit(1);
    if (!user) { res.status(400).json({ error: `User not found for deposit ${txId}` }); return; }
    if (user.role !== "customer") { res.status(400).json({ error: `Deposit ${txId} belongs to a ${user.role}, not a customer. Bulk actions are for customer deposits only.` }); return; }
    const amt = parseFloat(String(tx.amount));
    if (!Number.isFinite(amt) || amt <= 0) { res.status(400).json({ error: `Invalid amount for deposit ${txId}` }); return; }
    const txidSuffix = (tx.reference && tx.reference.includes("txid:")) ? `:${tx.reference.split("txid:").pop()}` : "";
    const approvedRef = refNo ? `approved:${refNo.trim()}${txidSuffix}` : `approved:manual${txidSuffix}`;
    preChecked.push({ tx, amt, approvedRef });
  }

  try {
    await db.transaction(async (trx) => {
      for (const { tx, amt, approvedRef } of preChecked) {
        const [marked] = await trx.update(walletTransactionsTable)
          .set({ reference: approvedRef })
          .where(and(eq(walletTransactionsTable.id, tx.id), sql`(${walletTransactionsTable.reference} = 'pending' OR ${walletTransactionsTable.reference} LIKE 'pending:%')`))
          .returning({ id: walletTransactionsTable.id });
        if (!marked) throw new Error(`Deposit ${tx.id} was already processed (race condition)`);
        const [credited] = await trx.update(usersTable)
          .set({ walletBalance: sql`wallet_balance + ${amt}`, updatedAt: new Date() })
          .where(eq(usersTable.id, tx.userId))
          .returning({ id: usersTable.id });
        if (!credited) throw new Error(`User ${tx.userId} not found for deposit ${tx.id}`);
      }
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(409).json({ error: msg });
    return;
  }

  for (const { tx, amt } of preChecked) {
    await db.insert(notificationsTable).values({
      id: generateId(), userId: tx.userId,
      title: "Deposit Credited ✅",
      body: `Rs. ${amt.toFixed(0)} aapki wallet mein add kar diya gaya hai!${refNo ? ` Ref: ${refNo}` : ""}`,
      type: "wallet", icon: "wallet-outline",
    }).catch(e => console.error("bulk deposit approval notif failed:", e));
  }

  res.json({ success: true, approved: preChecked.length });
});

/* ── POST /admin/deposit-requests/bulk-reject — Bulk reject customer pending deposits (all-or-nothing atomic) ─── */
router.post("/deposit-requests/bulk-reject", async (req, res) => {
  const { ids, reason } = req.body as { ids: string[]; reason: string };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids array is required" }); return; }
  if (!reason?.trim()) { res.status(400).json({ error: "reason is required" }); return; }
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length > 50) { res.status(400).json({ error: "Maximum 50 deposits per bulk action" }); return; }

  const rejReason = reason.trim();

  const preChecked: { tx: typeof walletTransactionsTable.$inferSelect; rejRef: string }[] = [];
  for (const txId of uniqueIds) {
    const [tx] = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
    if (!tx) { res.status(400).json({ error: `Deposit ${txId} not found` }); return; }
    if (tx.type !== "deposit") { res.status(400).json({ error: `${txId} is not a deposit record` }); return; }
    const ref = tx.reference ?? "pending";
    const isPending = ref === "pending" || ref.startsWith("pending:");
    if (!isPending) { res.status(409).json({ error: `Deposit ${txId} already processed (${ref})` }); return; }
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, tx.userId)).limit(1);
    if (!user) { res.status(400).json({ error: `User not found for deposit ${txId}` }); return; }
    if (user.role !== "customer") { res.status(400).json({ error: `Deposit ${txId} belongs to a ${user.role}, not a customer. Bulk actions are for customer deposits only.` }); return; }
    const txidSuffix = (tx.reference && tx.reference.includes("txid:")) ? `:${tx.reference.split("txid:").pop()}` : "";
    preChecked.push({ tx, rejRef: `rejected:${rejReason}${txidSuffix}` });
  }

  try {
    await db.transaction(async (trx) => {
      for (const { tx, rejRef } of preChecked) {
        const [marked] = await trx.update(walletTransactionsTable)
          .set({ reference: rejRef })
          .where(and(eq(walletTransactionsTable.id, tx.id), sql`(${walletTransactionsTable.reference} = 'pending' OR ${walletTransactionsTable.reference} LIKE 'pending:%')`))
          .returning({ id: walletTransactionsTable.id });
        if (!marked) throw new Error(`Deposit ${tx.id} was already processed (race condition)`);
      }
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(409).json({ error: msg });
    return;
  }

  for (const { tx } of preChecked) {
    const amt = parseFloat(String(tx.amount));
    await db.insert(notificationsTable).values({
      id: generateId(), userId: tx.userId,
      title: "Deposit Rejected ❌",
      body: `Rs. ${amt.toFixed(0)} deposit request reject ho gayi. Reason: ${rejReason}.`,
      type: "wallet", icon: "close-circle-outline",
    }).catch(e => console.error("bulk deposit rejection notif failed:", e));
  }

  res.json({ success: true, rejected: preChecked.length });
});

/* ── GET /admin/all-notifications ─────────── */
router.get("/all-notifications", async (req, res) => {
  const role = req.query["role"] as string | undefined;
  const limit = Math.min(parseInt(String(req.query["limit"] || "100")), 300);
  let userIds: string[] = [];
  if (role) {
    const users = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role as any, role));
    userIds = users.map(u => u.id);
    if (userIds.length === 0) { res.json({ notifications: [] }); return; }
  }
  const notifs = await db.select().from(notificationsTable)
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit);
  const filtered = role ? notifs.filter(n => userIds.includes(n.userId)) : notifs;
  const enriched = await Promise.all(filtered.slice(0, 200).map(async n => {
    const [user] = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, n.userId)).limit(1);
    return { ...n, user: user || null };
  }));
  res.json({ notifications: enriched });
});

/* ══════════════════════════════════════════════════════════════
   SECURITY MANAGEMENT ENDPOINTS
══════════════════════════════════════════════════════════════ */

/* ── GET /admin/audit-log — view admin action audit trail ── */
router.get("/audit-log", adminAuth, (req, res) => {
  const page   = Math.max(1, parseInt(String(req.query["page"]  || "1")));
  const limit  = Math.min(parseInt(String(req.query["limit"]  || "50")), 500);
  const action = req.query["action"] as string | undefined;
  const result = req.query["result"] as string | undefined;
  const from   = req.query["from"] as string | undefined;
  const to     = req.query["to"]   as string | undefined;

  let entries = [...auditLog];
  if (action) entries = entries.filter(e => e.action.includes(action));
  if (result) entries = entries.filter(e => e.result === result);
  if (from)   entries = entries.filter(e => new Date(e.timestamp) >= new Date(from));
  if (to)     entries = entries.filter(e => new Date(e.timestamp) <= new Date(to));

  const total = entries.length;
  const paginated = entries.slice((page - 1) * limit, page * limit);

  res.json({
    entries: paginated,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

/* ── GET /admin/auth-audit-log — persistent auth event log from DB ── */
router.get("/auth-audit-log", adminAuth, async (req, res) => {
  const limit  = Math.min(parseInt(String(req.query["limit"]  || "100")), 500);
  const event  = req.query["event"] as string | undefined;
  const userId = req.query["userId"] as string | undefined;

  const conditions: any[] = [];
  if (event)  conditions.push(eq(authAuditLogTable.event, event));
  if (userId) conditions.push(eq(authAuditLogTable.userId, userId));

  const entries = await db.select().from(authAuditLogTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(authAuditLogTable.createdAt))
    .limit(limit);

  res.json({ entries, total: entries.length });
});

/* ── POST /admin/rotate-secret — rotate the admin master secret ── */
router.post("/rotate-secret", adminAuth, (req, res) => {
  const adminRole = (req as any).adminRole;
  if (adminRole !== "super") {
    res.status(403).json({ error: "Only super admin can rotate the master secret." });
    return;
  }

  /* The new secret must be provided in the request body.
     The actual env var rotation must be done by the operator, but this
     endpoint validates the new secret and returns guidance. */
  const { newSecret } = req.body;
  if (!newSecret || newSecret.length < 32) {
    res.status(400).json({ error: "New secret must be at least 32 characters." });
    return;
  }

  const ip = getClientIp(req);
  addAuditEntry({ action: "admin_secret_rotation_requested", ip, details: "Admin requested secret rotation", result: "success" });
  writeAuthAuditLog("admin_secret_rotation", { ip, metadata: { note: "Secret rotation requested — update ADMIN_SECRET env var" } });

  res.json({
    success: true,
    message: "Set the new secret as the ADMIN_SECRET environment variable and restart the server to apply the rotation.",
    instructions: "New secret validated — it meets the minimum length requirement (32+ chars).",
  });
});

/* ── GET /admin/security-events — suspicious activity log ── */
router.get("/security-events", adminAuth, (req, res) => {
  const limit    = Math.min(parseInt(String(req.query["limit"]    || "200")), 1000);
  const severity = req.query["severity"] as string | undefined;
  const type     = req.query["type"]     as string | undefined;

  let events = [...securityEvents];
  if (severity) events = events.filter(e => e.severity === severity);
  if (type)     events = events.filter(e => e.type.includes(type));

  res.json({
    events: events.slice(0, limit),
    total: events.length,
    summary: {
      critical: securityEvents.filter(e => e.severity === "critical").length,
      high:     securityEvents.filter(e => e.severity === "high").length,
      medium:   securityEvents.filter(e => e.severity === "medium").length,
      low:      securityEvents.filter(e => e.severity === "low").length,
    },
  });
});

/* ── GET /admin/blocked-ips — list all blocked IPs ── */
router.get("/blocked-ips", adminAuth, (_req, res) => {
  res.json({
    blocked: Array.from(blockedIPs),
    total: blockedIPs.size,
  });
});

/* ── POST /admin/blocked-ips — block an IP ── */
router.post("/blocked-ips", adminAuth, (req, res) => {
  const { ip, reason } = req.body as { ip: string; reason?: string };
  if (!ip) { res.status(400).json({ error: "ip required" }); return; }

  blockedIPs.add(ip.trim());
  addAuditEntry({
    action: "manual_block_ip",
    ip: getClientIp(req),
    adminId: req.adminId!,
    details: `IP ${ip} manually blocked. Reason: ${reason || "No reason given"}`,
    result: "success",
  });
  addSecurityEvent({ type: "ip_manually_blocked", ip, details: `Admin manually blocked IP: ${ip}. Reason: ${reason || "none"}`, severity: "high" });
  res.json({ success: true, blocked: ip, totalBlocked: blockedIPs.size });
});

/* ── DELETE /admin/blocked-ips/:ip — unblock an IP ── */
router.delete("/blocked-ips/:ip", adminAuth, (req, res) => {
  const ip = decodeURIComponent(String(req.params["ip"]));
  const wasBlocked = blockedIPs.has(ip);
  blockedIPs.delete(ip);
  addAuditEntry({
    action: "unblock_ip",
    ip: getClientIp(req),
    adminId: req.adminId!,
    details: `IP ${ip} unblocked`,
    result: "success",
  });
  res.json({ success: true, unblocked: ip, wasBlocked });
});

/* ── GET /admin/login-lockouts — view locked accounts ── */
router.get("/login-lockouts", adminAuth, (_req, res) => {
  const now = Date.now();
  const lockouts: Array<{ phone: string; attempts: number; lockedUntil: string | null; minutesLeft: number | null }> = [];

  for (const [phone, record] of loginAttempts.entries()) {
    const minutesLeft = record.lockedUntil
      ? Math.max(0, Math.ceil((record.lockedUntil - now) / 60000))
      : null;
    lockouts.push({
      phone,
      attempts: record.attempts,
      lockedUntil: record.lockedUntil ? new Date(record.lockedUntil).toISOString() : null,
      minutesLeft,
    });
  }

  res.json({
    lockouts: lockouts.filter(l => l.lockedUntil !== null || l.attempts > 0),
    total: lockouts.length,
  });
});

/* ── DELETE /admin/login-lockouts/:phone — unlock a phone ── */
router.delete("/login-lockouts/:phone", adminAuth, (req, res) => {
  const phone = decodeURIComponent(String(req.params["phone"]));
  unlockPhone(phone);
  addAuditEntry({
    action: "admin_unlock_phone",
    ip: getClientIp(req),
    adminId: req.adminId!,
    details: `Admin manually unlocked phone: ${phone}`,
    result: "success",
  });
  res.json({ success: true, unlocked: phone });
});

/* ── GET /admin/security-dashboard — quick security overview ── */
router.get("/security-dashboard", adminAuth, async (_req, res) => {
  const settings = await getPlatformSettings();
  const now = Date.now();

  const activeBlocks = blockedIPs.size;
  const activeLockouts = Array.from(loginAttempts.values()).filter(r => r.lockedUntil && r.lockedUntil > now).length;
  const recentCritical = securityEvents.filter(e => e.severity === "critical" && new Date(e.timestamp).getTime() > now - 24 * 60 * 60 * 1000).length;
  const recentHigh     = securityEvents.filter(e => e.severity === "high"     && new Date(e.timestamp).getTime() > now - 24 * 60 * 60 * 1000).length;

  res.json({
    status: recentCritical > 0 ? "critical" : recentHigh > 5 ? "warning" : "healthy",
    activeBlockedIPs: activeBlocks,
    activeAccountLockouts: activeLockouts,
    last24hCriticalEvents: recentCritical,
    last24hHighEvents: recentHigh,
    totalAuditEntries: auditLog.length,
    totalSecurityEvents: securityEvents.length,
    settings: {
      otpBypass:      settings["security_otp_bypass"]       === "on",
      mfaRequired:    settings["security_mfa_required"]      === "on",
      autoBlockIP:    settings["security_auto_block_ip"]     === "on",
      spoofDetection: settings["security_spoof_detection"]   === "on",
      fakeOrderDetect:settings["security_fake_order_detect"] === "on",
      rateLimitGeneral: parseInt(settings["security_rate_limit"]  ?? "100", 10),
      rateLimitAdmin:   parseInt(settings["security_rate_admin"]  ?? "60",  10),
      rateLimitRider:   parseInt(settings["security_rate_rider"]  ?? "200", 10),
      rateLimitVendor:  parseInt(settings["security_rate_vendor"] ?? "150", 10),
      sessionDays:      parseInt(settings["security_session_days"]      ?? "30", 10),
      adminTokenHrs:    parseInt(settings["security_admin_token_hrs"]   ?? "24", 10),
      riderTokenDays:   parseInt(settings["security_rider_token_days"]  ?? "30", 10),
      maxLoginAttempts: parseInt(settings["security_login_max_attempts"]?? "5",  10),
      lockoutMinutes:   parseInt(settings["security_lockout_minutes"]   ?? "30", 10),
      maxDailyOrders:   parseInt(settings["security_max_daily_orders"]  ?? "20", 10),
      maxSpeedKmh:      parseInt(settings["security_max_speed_kmh"]     ?? "150",10),
      ipWhitelistActive: !!(settings["security_admin_ip_whitelist"] || "").trim(),
    },
  });
});

/* ── POST /admin/settings (override) — invalidate settings cache on save ── */
/* This wraps the existing settings update to bust the cache */
router.post("/invalidate-cache", adminAuth, (_req, res) => {
  invalidateSettingsCache();
  res.json({ success: true, message: "Settings cache invalidated. New security settings will be applied immediately." });
});

/* ═══════════════════════════════════════════════════════════════
   TOTP / MFA ENDPOINTS
   Sub-admins can set up Google Authenticator / Authy for their account.
   Super admin is not required to use TOTP (secret key is the master).
═══════════════════════════════════════════════════════════════ */

/* GET /admin/mfa/status — check if MFA is set up for the current sub-admin */
router.get("/mfa/status", adminAuth, async (req, res) => {
  const adminId = req.adminId!;
  if (!adminId) {
    res.json({ mfaEnabled: false, note: "Super admin does not use TOTP." });
    return;
  }
  const [admin] = await db.select().from(adminAccountsTable).where(eq(adminAccountsTable.id, adminId)).limit(1);
  if (!admin) { res.status(404).json({ error: "Admin account not found" }); return; }
  res.json({
    mfaEnabled: admin.totpEnabled,
    totpConfigured: !!admin.totpSecret,
  });
});

/* POST /admin/mfa/setup — generate a TOTP secret and QR code (step 1 of MFA setup) */
router.post("/mfa/setup", adminAuth, async (req, res) => {
  const adminId   = req.adminId!;
  const adminName = req.adminName! ?? "Admin";
  if (!adminId) {
    res.status(400).json({ error: "Super admin does not need TOTP setup." });
    return;
  }

  const secret    = generateTotpSecret();
  const qrCodeUrl = await generateQRCodeDataURL(secret, adminName);
  const otpUri    = getTotpUri(secret, adminName);

  /* Store secret but don't enable TOTP yet — must be verified first */
  await db.update(adminAccountsTable)
    .set({ totpSecret: secret, totpEnabled: false })
    .where(eq(adminAccountsTable.id, adminId));

  addAuditEntry({ action: "mfa_setup_initiated", ip: req.adminIp!, adminId, details: `MFA setup started for ${adminName}`, result: "success" });

  res.json({
    secret,
    otpUri,
    qrCodeDataUrl: qrCodeUrl,
    instructions: "Scan the QR code with Google Authenticator or Authy. Then call POST /admin/mfa/verify with a valid token to activate MFA.",
  });
});

/* POST /admin/mfa/verify — verify a TOTP token to activate MFA */
router.post("/mfa/verify", adminAuth, async (req, res) => {
  const adminId   = req.adminId!;
  const adminName = req.adminName! ?? "Admin";
  if (!adminId) {
    res.status(400).json({ error: "Super admin does not use TOTP." });
    return;
  }

  const { token } = req.body as { token: string };
  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  const [admin] = await db.select().from(adminAccountsTable).where(eq(adminAccountsTable.id, adminId)).limit(1);
  if (!admin || !admin.totpSecret) {
    res.status(400).json({ error: "TOTP not set up yet. Call POST /admin/mfa/setup first." });
    return;
  }

  if (admin.totpEnabled) {
    res.json({ success: true, message: "MFA is already active." });
    return;
  }

  const valid = verifyTotpToken(token, admin.totpSecret);
  if (!valid) {
    addAuditEntry({ action: "mfa_verify_failed", ip: req.adminIp!, adminId, details: `MFA verify failed for ${adminName}`, result: "fail" });
    res.status(401).json({ error: "Invalid TOTP token. Please try again." });
    return;
  }

  await db.update(adminAccountsTable)
    .set({ totpEnabled: true })
    .where(eq(adminAccountsTable.id, adminId));

  addAuditEntry({ action: "mfa_activated", ip: req.adminIp!, adminId, details: `MFA activated for ${adminName}`, result: "success" });

  res.json({ success: true, message: "MFA successfully activated. You must now provide x-admin-totp with every request when global MFA is enabled." });
});

/* DELETE /admin/mfa/disable — disable MFA (requires current valid TOTP or super admin) */
router.delete("/mfa/disable", adminAuth, async (req, res) => {
  const adminId   = req.adminId!;
  const adminName = req.adminName! ?? "Admin";
  if (!adminId) {
    res.status(400).json({ error: "Super admin does not use TOTP." });
    return;
  }

  const { token } = req.body as { token?: string };
  const [admin]   = await db.select().from(adminAccountsTable).where(eq(adminAccountsTable.id, adminId)).limit(1);
  if (!admin) { res.status(404).json({ error: "Admin not found" }); return; }

  if (admin.totpEnabled && admin.totpSecret) {
    if (!token || !verifyTotpToken(token, admin.totpSecret)) {
      res.status(401).json({ error: "Valid TOTP token required to disable MFA." });
      return;
    }
  }

  await db.update(adminAccountsTable)
    .set({ totpSecret: null, totpEnabled: false })
    .where(eq(adminAccountsTable.id, adminId));

  addAuditEntry({ action: "mfa_disabled", ip: req.adminIp!, adminId, details: `MFA disabled for ${adminName}`, result: "warn" });

  res.json({ success: true, message: "MFA has been disabled for your account." });
});

/* ══════════════════════════════════════════════════════
   COD REMITTANCE MANAGEMENT
══════════════════════════════════════════════════════ */

/* ── GET /admin/cod-remittances ── */
router.get("/cod-remittances", async (_req, res) => {
  const txns = await db.select().from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.type, "cod_remittance"))
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(300);
  const enriched = await Promise.all(txns.map(async t => {
    const [user] = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, t.userId)).limit(1);
    const ref = t.reference ?? "pending";
    const status = ref === "pending" ? "pending" : ref.startsWith("verified:") ? "verified" : ref.startsWith("rejected:") ? "rejected" : "pending";
    const refDetail = ref.startsWith("verified:") ? ref.slice(9) : ref.startsWith("rejected:") ? ref.slice(9) : "";
    return { ...t, amount: parseFloat(String(t.amount)), user: user || null, status, refDetail };
  }));
  res.json({ remittances: enriched });
});

/* ── PATCH /admin/cod-remittances/:id/verify ── */
router.patch("/cod-remittances/:id/verify", async (req, res) => {
  const { note } = req.body;
  const txId = req.params["id"]!;
  const [tx] = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
  if (!tx) { res.status(404).json({ error: "Remittance not found" }); return; }
  if (tx.type !== "cod_remittance") { res.status(400).json({ error: "Not a COD remittance record" }); return; }
  const dateStr = new Date().toISOString().split("T")[0];
  const [updated] = await db.update(walletTransactionsTable)
    .set({ reference: `verified:${dateStr}` })
    .where(eq(walletTransactionsTable.id, txId)).returning();
  await sendUserNotification(
    tx.userId, "COD Remittance Verified ✅",
    `Rs. ${parseFloat(String(tx.amount)).toLocaleString()} COD remittance verified hai.${note ? ` Note: ${note}` : ""} Shukriya!`,
    "wallet", "checkmark-circle-outline"
  );
  res.json({ success: true, remittance: updated });
});

/* ── PATCH /admin/cod-remittances/:id/reject ── */
router.patch("/cod-remittances/:id/reject", async (req, res) => {
  const { reason } = req.body;
  const txId = req.params["id"]!;
  const [tx] = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
  if (!tx) { res.status(404).json({ error: "Remittance not found" }); return; }
  if (tx.type !== "cod_remittance") { res.status(400).json({ error: "Not a COD remittance record" }); return; }
  const [updated] = await db.update(walletTransactionsTable)
    .set({ reference: `rejected:${reason || "Verification failed"}` })
    .where(eq(walletTransactionsTable.id, txId)).returning();
  await sendUserNotification(
    tx.userId, "COD Remittance Rejected ❌",
    `Rs. ${parseFloat(String(tx.amount)).toLocaleString()} remittance reject ho gaya. Reason: ${reason || "Verification failed"}. Please resubmit with correct details.`,
    "wallet", "close-circle-outline"
  );
  res.json({ success: true, remittance: updated });
});

/* ── PATCH /admin/cod-remittances/batch-verify ── */
router.patch("/cod-remittances/batch-verify", async (req, res) => {
  const { ids } = req.body as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids required" }); return; }
  const results: any[] = [];
  for (const txId of ids) {
    const [tx] = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.id, txId)).limit(1);
    if (!tx || tx.type !== "cod_remittance") continue;
    if (tx.reference && tx.reference !== "pending") continue;
    const [updated] = await db.update(walletTransactionsTable)
      .set({ reference: `verified:batch-${Date.now()}` })
      .where(eq(walletTransactionsTable.id, txId)).returning();
    await sendUserNotification(
      tx.userId, "COD Remittance Verified ✅",
      `Rs. ${parseFloat(String(tx.amount)).toLocaleString()} COD remittance verify ho gaya.`,
      "wallet", "checkmark-circle-outline"
    );
    results.push(txId);
  }
  res.json({ success: true, verified: results });
});

/* ── POST /admin/riders/:id/credit — Manual wallet credit for rider ── */
router.post("/riders/:id/credit", async (req, res) => {
  const { amount, description, type } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ error: "Valid amount required" }); return;
  }
  const [rider] = await db.select().from(usersTable).where(eq(usersTable.id, req.params["id"]!)).limit(1);
  if (!rider) { res.status(404).json({ error: "Rider not found" }); return; }
  const roles = (rider.role || rider.roles || "").split(",").map((r: string) => r.trim());
  if (!roles.includes("rider")) { res.status(400).json({ error: "User is not a rider" }); return; }
  const amt = Number(amount);
  const txType = type === "bonus" ? "bonus" : "credit";
  const [updated] = await db.update(usersTable)
    .set({ walletBalance: sql`wallet_balance + ${amt}`, updatedAt: new Date() })
    .where(eq(usersTable.id, rider.id)).returning();
  await db.insert(walletTransactionsTable).values({
    id: generateId(), userId: rider.id, type: txType, amount: String(amt),
    description: description || `Admin credit: Rs. ${amt}`,
    reference: txType === "bonus" ? "rider_bonus" : "admin_credit",
  });
  await sendUserNotification(
    rider.id,
    txType === "bonus" ? "Bonus Received! 🎉" : "Wallet Credited 💰",
    `Rs. ${amt} aapke wallet mein add ho gaya. ${description || ""}`,
    "wallet", "wallet-outline"
  );
  res.json({ success: true, amount: amt, newBalance: parseFloat(updated?.walletBalance ?? "0") });
});

/* ══════════════════════════════════════════════════════
   RIDE SERVICE TYPES — Admin CRUD
   Controls which vehicle services are visible & priced
══════════════════════════════════════════════════════ */

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

function formatSvc(s: any) {
  return {
    ...s,
    baseFare:      parseFloat(s.baseFare ?? "0"),
    perKm:         parseFloat(s.perKm    ?? "0"),
    minFare:       parseFloat(s.minFare  ?? "0"),
    createdAt:     s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
    updatedAt:     s.updatedAt instanceof Date ? s.updatedAt.toISOString() : s.updatedAt,
  };
}

/* GET /admin/ride-services */
router.get("/ride-services", async (_req, res) => {
  await ensureDefaultRideServices();
  const services = await db.select().from(rideServiceTypesTable).orderBy(asc(rideServiceTypesTable.sortOrder));
  res.json({ services: services.map(formatSvc) });
});

/* POST /admin/ride-services — create custom service */
router.post("/ride-services", async (req, res) => {
  const { key, name, nameUrdu, icon, description, color, baseFare, perKm, minFare, maxPassengers, allowBargaining, sortOrder } = req.body;
  if (!key || !name || !icon) { res.status(400).json({ error: "key, name, icon are required" }); return; }
  const existing = await db.select({ id: rideServiceTypesTable.id }).from(rideServiceTypesTable).where(eq(rideServiceTypesTable.key, String(key))).limit(1);
  if (existing.length > 0) { res.status(409).json({ error: `Service key "${key}" already exists` }); return; }
  const [created] = await db.insert(rideServiceTypesTable).values({
    id: `svc_${generateId()}`,
    key: String(key).toLowerCase().replace(/\s+/g, "_"),
    name: String(name),
    nameUrdu:      nameUrdu      || null,
    icon:          String(icon),
    description:   description   || null,
    color:         color         || "#6B7280",
    isEnabled:     true,
    isCustom:      true,
    baseFare:      String(baseFare  ?? 15),
    perKm:         String(perKm     ?? 8),
    minFare:       String(minFare   ?? 50),
    maxPassengers: Number(maxPassengers ?? 1),
    allowBargaining: allowBargaining !== false,
    sortOrder:     Number(sortOrder ?? 99),
  }).returning();
  res.status(201).json({ success: true, service: formatSvc(created) });
});

/* PATCH /admin/ride-services/:id — update any field */
router.patch("/ride-services/:id", async (req, res) => {
  const svcId = req.params["id"]!;
  const [existing] = await db.select().from(rideServiceTypesTable).where(eq(rideServiceTypesTable.id, svcId)).limit(1);
  if (!existing) { res.status(404).json({ error: "Service not found" }); return; }
  const { name, nameUrdu, icon, description, color, isEnabled, baseFare, perKm, minFare, maxPassengers, allowBargaining, sortOrder } = req.body;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (name          !== undefined) patch["name"]           = String(name);
  if (nameUrdu      !== undefined) patch["nameUrdu"]       = nameUrdu;
  if (icon          !== undefined) patch["icon"]           = String(icon);
  if (description   !== undefined) patch["description"]    = description;
  if (color         !== undefined) patch["color"]          = String(color);
  if (isEnabled     !== undefined) patch["isEnabled"]      = Boolean(isEnabled);
  if (baseFare      !== undefined) patch["baseFare"]       = String(baseFare);
  if (perKm         !== undefined) patch["perKm"]          = String(perKm);
  if (minFare       !== undefined) patch["minFare"]        = String(minFare);
  if (maxPassengers !== undefined) patch["maxPassengers"]  = Number(maxPassengers);
  if (allowBargaining !== undefined) patch["allowBargaining"] = Boolean(allowBargaining);
  if (sortOrder     !== undefined) patch["sortOrder"]      = Number(sortOrder);
  const [updated] = await db.update(rideServiceTypesTable).set(patch as any).where(eq(rideServiceTypesTable.id, svcId)).returning();
  res.json({ success: true, service: formatSvc(updated) });
});

/* DELETE /admin/ride-services/:id — only custom services */
router.delete("/ride-services/:id", async (req, res) => {
  const svcId = req.params["id"]!;
  const [existing] = await db.select().from(rideServiceTypesTable).where(eq(rideServiceTypesTable.id, svcId)).limit(1);
  if (!existing) { res.status(404).json({ error: "Service not found" }); return; }
  if (!existing.isCustom) { res.status(400).json({ error: "Built-in services cannot be deleted. Disable them instead." }); return; }
  await db.delete(rideServiceTypesTable).where(eq(rideServiceTypesTable.id, svcId));
  res.json({ success: true });
});

/* ══════════════════════════════════════════════════════
   POPULAR LOCATIONS — Admin CRUD
   GET  /admin/locations
   POST /admin/locations
   PATCH /admin/locations/:id
   DELETE /admin/locations/:id
══════════════════════════════════════════════════════ */

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

router.get("/locations", async (_req, res) => {
  await ensureDefaultLocations();
  const locs = await db.select().from(popularLocationsTable)
    .orderBy(asc(popularLocationsTable.sortOrder), asc(popularLocationsTable.name));
  res.json({
    locations: locs.map(l => ({
      ...l,
      lat: parseFloat(String(l.lat)),
      lng: parseFloat(String(l.lng)),
    })),
  });
});

router.post("/locations", async (req, res) => {
  const { name, nameUrdu, lat, lng, category = "general", icon = "📍", isActive = true, sortOrder = 0 } = req.body;
  if (!name || !lat || !lng) { res.status(400).json({ error: "name, lat, lng required" }); return; }
  const [loc] = await db.insert(popularLocationsTable).values({
    id: generateId(), name, nameUrdu: nameUrdu || null,
    lat: String(lat), lng: String(lng), category, icon,
    isActive: Boolean(isActive), sortOrder: Number(sortOrder),
  }).returning();
  res.status(201).json({ ...loc, lat: parseFloat(String(loc!.lat)), lng: parseFloat(String(loc!.lng)) });
});

router.patch("/locations/:id", async (req, res) => {
  const { name, nameUrdu, lat, lng, category, icon, isActive, sortOrder } = req.body;
  const patch: any = { updatedAt: new Date() };
  if (name      !== undefined) patch.name      = name;
  if (nameUrdu  !== undefined) patch.nameUrdu  = nameUrdu || null;
  if (lat       !== undefined) patch.lat       = String(lat);
  if (lng       !== undefined) patch.lng       = String(lng);
  if (category  !== undefined) patch.category  = category;
  if (icon      !== undefined) patch.icon      = icon;
  if (isActive  !== undefined) patch.isActive  = Boolean(isActive);
  if (sortOrder !== undefined) patch.sortOrder = Number(sortOrder);
  const [updated] = await db.update(popularLocationsTable).set(patch).where(eq(popularLocationsTable.id, req.params["id"]!)).returning();
  if (!updated) { res.status(404).json({ error: "Location not found" }); return; }
  res.json({ ...updated, lat: parseFloat(String(updated.lat)), lng: parseFloat(String(updated.lng)) });
});

router.delete("/locations/:id", async (req, res) => {
  const [existing] = await db.select({ id: popularLocationsTable.id })
    .from(popularLocationsTable).where(eq(popularLocationsTable.id, req.params["id"]!)).limit(1);
  if (!existing) { res.status(404).json({ error: "Location not found" }); return; }
  await db.delete(popularLocationsTable).where(eq(popularLocationsTable.id, req.params["id"]!));
  res.json({ success: true });
});

/* ══════════════════════════════════════════════════════
   SCHOOL ROUTES — Admin CRUD + Subscriptions view
   GET  /admin/school-routes
   POST /admin/school-routes
   PATCH /admin/school-routes/:id
   DELETE /admin/school-routes/:id
   GET  /admin/school-subscriptions
══════════════════════════════════════════════════════ */

function fmtRoute(r: any) {
  return {
    ...r,
    monthlyPrice:  parseFloat(String(r.monthlyPrice ?? "0")),
    fromLat:       r.fromLat ? parseFloat(String(r.fromLat)) : null,
    fromLng:       r.fromLng ? parseFloat(String(r.fromLng)) : null,
    toLat:         r.toLat   ? parseFloat(String(r.toLat))   : null,
    toLng:         r.toLng   ? parseFloat(String(r.toLng))   : null,
    createdAt:     r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    updatedAt:     r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
  };
}

router.get("/school-routes", async (_req, res) => {
  const routes = await db.select().from(schoolRoutesTable)
    .orderBy(asc(schoolRoutesTable.sortOrder), asc(schoolRoutesTable.schoolName));
  res.json({ routes: routes.map(fmtRoute) });
});

router.post("/school-routes", async (req, res) => {
  const {
    routeName, schoolName, schoolNameUrdu, fromArea, fromAreaUrdu, toAddress,
    fromLat, fromLng, toLat, toLng, monthlyPrice, morningTime, afternoonTime,
    capacity = 30, vehicleType = "school_shift", notes, isActive = true, sortOrder = 0,
  } = req.body;
  if (!routeName || !schoolName || !fromArea || !toAddress || !monthlyPrice) {
    res.status(400).json({ error: "routeName, schoolName, fromArea, toAddress, monthlyPrice required" }); return;
  }
  const [route] = await db.insert(schoolRoutesTable).values({
    id: generateId(), routeName, schoolName, schoolNameUrdu: schoolNameUrdu || null,
    fromArea, fromAreaUrdu: fromAreaUrdu || null, toAddress,
    fromLat: fromLat ? String(fromLat) : null, fromLng: fromLng ? String(fromLng) : null,
    toLat:   toLat   ? String(toLat)   : null, toLng:   toLng   ? String(toLng)   : null,
    monthlyPrice: String(parseFloat(monthlyPrice)),
    morningTime: morningTime || "7:30 AM",
    afternoonTime: afternoonTime || null,
    capacity: Number(capacity), enrolledCount: 0,
    vehicleType, notes: notes || null,
    isActive: Boolean(isActive), sortOrder: Number(sortOrder),
  }).returning();
  res.status(201).json(fmtRoute(route!));
});

router.patch("/school-routes/:id", async (req, res) => {
  const routeId = req.params["id"]!;
  const {
    routeName, schoolName, schoolNameUrdu, fromArea, fromAreaUrdu, toAddress,
    fromLat, fromLng, toLat, toLng, monthlyPrice, morningTime, afternoonTime,
    capacity, vehicleType, notes, isActive, sortOrder,
  } = req.body;
  const patch: any = { updatedAt: new Date() };
  if (routeName      !== undefined) patch.routeName      = routeName;
  if (schoolName     !== undefined) patch.schoolName     = schoolName;
  if (schoolNameUrdu !== undefined) patch.schoolNameUrdu = schoolNameUrdu || null;
  if (fromArea       !== undefined) patch.fromArea       = fromArea;
  if (fromAreaUrdu   !== undefined) patch.fromAreaUrdu   = fromAreaUrdu || null;
  if (toAddress      !== undefined) patch.toAddress      = toAddress;
  if (fromLat        !== undefined) patch.fromLat        = fromLat ? String(fromLat) : null;
  if (fromLng        !== undefined) patch.fromLng        = fromLng ? String(fromLng) : null;
  if (toLat          !== undefined) patch.toLat          = toLat   ? String(toLat)   : null;
  if (toLng          !== undefined) patch.toLng          = toLng   ? String(toLng)   : null;
  if (monthlyPrice   !== undefined) patch.monthlyPrice   = String(parseFloat(monthlyPrice));
  if (morningTime    !== undefined) patch.morningTime    = morningTime;
  if (afternoonTime  !== undefined) patch.afternoonTime  = afternoonTime || null;
  if (capacity       !== undefined) patch.capacity       = Number(capacity);
  if (vehicleType    !== undefined) patch.vehicleType    = vehicleType;
  if (notes          !== undefined) patch.notes          = notes || null;
  if (isActive       !== undefined) patch.isActive       = Boolean(isActive);
  if (sortOrder      !== undefined) patch.sortOrder      = Number(sortOrder);
  const [updated] = await db.update(schoolRoutesTable).set(patch).where(eq(schoolRoutesTable.id, routeId)).returning();
  if (!updated) { res.status(404).json({ error: "Route not found" }); return; }
  res.json(fmtRoute(updated));
});

router.delete("/school-routes/:id", async (req, res) => {
  const routeId = req.params["id"]!;
  /* Only delete if no active subscriptions */
  const [activeSub] = await db.select({ id: schoolSubscriptionsTable.id })
    .from(schoolSubscriptionsTable)
    .where(and(eq(schoolSubscriptionsTable.routeId, routeId), eq(schoolSubscriptionsTable.status, "active")))
    .limit(1);
  if (activeSub) {
    res.status(409).json({ error: "Cannot delete route with active subscriptions. Disable it instead." }); return;
  }
  const [existing] = await db.select({ id: schoolRoutesTable.id })
    .from(schoolRoutesTable).where(eq(schoolRoutesTable.id, routeId)).limit(1);
  if (!existing) { res.status(404).json({ error: "Route not found" }); return; }
  await db.delete(schoolRoutesTable).where(eq(schoolRoutesTable.id, routeId));
  res.json({ success: true });
});

router.get("/school-subscriptions", async (req, res) => {
  const routeIdFilter = req.query["routeId"] as string | undefined;
  const query = routeIdFilter
    ? db.select().from(schoolSubscriptionsTable).where(eq(schoolSubscriptionsTable.routeId, routeIdFilter))
    : db.select().from(schoolSubscriptionsTable);
  const subs = await query.orderBy(desc(schoolSubscriptionsTable.createdAt));
  /* Enrich with user info */
  const enriched = await Promise.all(subs.map(async sub => {
    const [user] = await db.select({ name: usersTable.name, phone: usersTable.phone })
      .from(usersTable).where(eq(usersTable.id, sub.userId)).limit(1);
    const [route] = await db.select({ routeName: schoolRoutesTable.routeName, schoolName: schoolRoutesTable.schoolName })
      .from(schoolRoutesTable).where(eq(schoolRoutesTable.id, sub.routeId)).limit(1);
    return {
      ...sub,
      monthlyAmount:   parseFloat(String(sub.monthlyAmount ?? "0")),
      userName:        user?.name  || null,
      userPhone:       user?.phone || null,
      routeName:       route?.routeName   || null,
      schoolName:      route?.schoolName  || null,
      startDate:       sub.startDate instanceof Date       ? sub.startDate.toISOString()       : sub.startDate,
      nextBillingDate: sub.nextBillingDate instanceof Date ? sub.nextBillingDate.toISOString() : sub.nextBillingDate,
      createdAt:       sub.createdAt instanceof Date       ? sub.createdAt.toISOString()       : sub.createdAt,
    };
  }));
  res.json({ subscriptions: enriched, total: enriched.length });
});

/* ══════════════════════════════════════════════════════════
   GET /admin/live-riders
   Returns all riders who have recently sent GPS updates,
   enriched with their name, phone and online status.
   "Fresh" = updated within last 5 minutes.
══════════════════════════════════════════════════════════ */
router.get("/live-riders", async (_req, res) => {
  const STALE_MS = 5 * 60 * 1000; /* 5 minutes */
  const cutoff   = new Date(Date.now() - STALE_MS);

  const locs = await db.select().from(liveLocationsTable)
    .where(eq(liveLocationsTable.role, "rider"));

  const enriched = await Promise.all(locs.map(async loc => {
    const [user] = await db
      .select({ name: usersTable.name, phone: usersTable.phone, isOnline: usersTable.isOnline })
      .from(usersTable)
      .where(eq(usersTable.id, loc.userId))
      .limit(1);

    const updatedAt  = loc.updatedAt instanceof Date ? loc.updatedAt : new Date(loc.updatedAt);
    const ageSeconds = Math.floor((Date.now() - updatedAt.getTime()) / 1000);
    const isFresh    = updatedAt >= cutoff;

    return {
      userId:     loc.userId,
      name:       user?.name  ?? "Unknown Rider",
      phone:      user?.phone ?? null,
      isOnline:   user?.isOnline ?? false,
      lat:        parseFloat(String(loc.latitude)),
      lng:        parseFloat(String(loc.longitude)),
      updatedAt:  updatedAt.toISOString(),
      ageSeconds,
      isFresh,
    };
  }));

  /* Sort: online first, then by freshness */
  enriched.sort((a, b) => {
    if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
    return a.ageSeconds - b.ageSeconds;
  });

  res.json({ riders: enriched, total: enriched.length, freshCount: enriched.filter(r => r.isFresh).length });
});

/* ══════════════════════════════════════════════════════════
   GET /admin/customer-locations
   Returns customers who sent a GPS update (ride booking or
   order placement). Shows their identity + last position.
   "Fresh" = updated within last 2 hours.
══════════════════════════════════════════════════════════ */
router.get("/customer-locations", async (_req, res) => {
  const STALE_MS = 2 * 60 * 60 * 1000; /* 2 hours */
  const cutoff   = new Date(Date.now() - STALE_MS);

  const locs = await db.select().from(liveLocationsTable)
    .where(eq(liveLocationsTable.role, "customer"))
    .orderBy(desc(liveLocationsTable.updatedAt));

  const enriched = await Promise.all(locs.map(async loc => {
    const [user] = await db
      .select({ name: usersTable.name, phone: usersTable.phone, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, loc.userId))
      .limit(1);

    const updatedAt  = loc.updatedAt instanceof Date ? loc.updatedAt : new Date(loc.updatedAt as string);
    const ageSeconds = Math.floor((Date.now() - updatedAt.getTime()) / 1000);
    const isFresh    = updatedAt >= cutoff;
    const action     = loc.action ?? null;

    return {
      userId:     loc.userId,
      name:       user?.name  ?? "Unknown User",
      phone:      user?.phone ?? null,
      email:      user?.email ?? null,
      lat:        parseFloat(String(loc.latitude)),
      lng:        parseFloat(String(loc.longitude)),
      action,
      updatedAt:  updatedAt.toISOString(),
      ageSeconds,
      isFresh,
    };
  }));

  res.json({ customers: enriched, total: enriched.length, freshCount: enriched.filter(c => c.isFresh).length });
});

/* ══════════════════════════════════════════════════════════════════════════════
   GET /admin/search?q=query
   Global search across users, rides, orders, pharmacy, parcels
   Returns max 5 results per category, sorted by relevance (recency)
══════════════════════════════════════════════════════════════════════════════ */
router.get("/search", async (req, res) => {
  const q = String(req.query["q"] ?? "").trim();
  if (!q || q.length < 2) {
    res.json({ users: [], rides: [], orders: [], pharmacy: [], query: q });
    return;
  }

  const pattern = `%${q}%`;

  const [users, rides, orders, pharmacy] = await Promise.all([
    /* Users — by name or phone */
    db.select({
      id:    usersTable.id,
      name:  usersTable.name,
      phone: usersTable.phone,
      email: usersTable.email,
      role:  usersTable.role,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(or(ilike(usersTable.name, pattern), ilike(usersTable.phone, pattern), ilike(usersTable.email, pattern)))
    .orderBy(desc(usersTable.createdAt))
    .limit(5),

    /* Rides — by ID or address */
    db.select({
      id:            ridesTable.id,
      type:          ridesTable.type,
      status:        ridesTable.status,
      pickupAddress: ridesTable.pickupAddress,
      dropAddress:   ridesTable.dropAddress,
      fare:          ridesTable.fare,
      offeredFare:   ridesTable.offeredFare,
      riderName:     ridesTable.riderName,
      createdAt:     ridesTable.createdAt,
    })
    .from(ridesTable)
    .where(or(
      ilike(ridesTable.id, pattern),
      ilike(ridesTable.pickupAddress, pattern),
      ilike(ridesTable.dropAddress, pattern),
      ilike(ridesTable.riderName, pattern),
      ilike(ridesTable.status, pattern),
    ))
    .orderBy(desc(ridesTable.createdAt))
    .limit(5),

    /* Orders — by ID or delivery address */
    db.select({
      id:              ordersTable.id,
      status:          ordersTable.status,
      type:            ordersTable.type,
      total:           ordersTable.total,
      deliveryAddress: ordersTable.deliveryAddress,
      createdAt:       ordersTable.createdAt,
    })
    .from(ordersTable)
    .where(or(
      ilike(ordersTable.id, pattern),
      ilike(ordersTable.deliveryAddress, pattern),
      ilike(ordersTable.status, pattern),
    ))
    .orderBy(desc(ordersTable.createdAt))
    .limit(5),

    /* Pharmacy orders */
    db.select({
      id:              pharmacyOrdersTable.id,
      status:          pharmacyOrdersTable.status,
      total:           pharmacyOrdersTable.total,
      deliveryAddress: pharmacyOrdersTable.deliveryAddress,
      createdAt:       pharmacyOrdersTable.createdAt,
    })
    .from(pharmacyOrdersTable)
    .where(or(
      ilike(pharmacyOrdersTable.id, pattern),
      ilike(pharmacyOrdersTable.deliveryAddress, pattern),
      ilike(pharmacyOrdersTable.status, pattern),
    ))
    .orderBy(desc(pharmacyOrdersTable.createdAt))
    .limit(5),
  ]);

  res.json({ users, rides, orders, pharmacy, query: q });
});

/* ══════════════════════════════════════════════════════════════════════════════
   NEW ENDPOINTS — Task 4: Operations Pages (51–100)
══════════════════════════════════════════════════════════════════════════════ */

/* ── PATCH /admin/users/:id/request-correction — ask user to re-upload specific doc ── */
router.patch("/users/:id/request-correction", async (req, res) => {
  const { field, note } = req.body as { field?: string; note?: string };
  const [user] = await db.update(usersTable)
    .set({ approvalStatus: "correction_needed", approvalNote: note || `Please re-upload: ${field || "document"}`, updatedAt: new Date() })
    .where(eq(usersTable.id, req.params["id"]!))
    .returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  addAuditEntry({ action: "user_correction_requested", ip: getClientIp(req), adminId: (req as any).adminId, details: `Correction requested for ${user.phone}: ${field}`, result: "success" });
  await db.insert(notificationsTable).values({
    id: generateId(), userId: user.id,
    title: "Document Correction Required 📄",
    body: note || `Please re-upload your ${field || "document"} for verification.`,
    type: "system", icon: "document-outline",
  }).catch(() => {});
  res.json({ success: true, user: stripUser(user) });
});

/* ── PATCH /admin/users/:id/bulk-ban — ban/unban multiple users ── */
router.patch("/users/bulk-ban", async (req, res) => {
  const { ids, action, reason } = req.body as { ids: string[]; action: "ban" | "unban"; reason?: string };
  if (!ids?.length) { res.status(400).json({ error: "ids required" }); return; }
  const updates = action === "ban"
    ? { isBanned: true, isActive: false, banReason: reason || "Banned by admin", updatedAt: new Date() }
    : { isBanned: false, isActive: true, banReason: null as any, updatedAt: new Date() };
  for (const id of ids) {
    await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).catch(() => {});
  }
  addAuditEntry({ action: `bulk_${action}`, ip: getClientIp(req), adminId: (req as any).adminId, details: `Bulk ${action}: ${ids.length} users`, result: "success" });
  res.json({ success: true, affected: ids.length, action });
});

/* ── PATCH /admin/orders/:id/assign-rider — manually assign a rider to an order ── */
router.patch("/orders/:id/assign-rider", async (req, res) => {
  const { riderId } = req.body as { riderId?: string };
  const [order] = await db.update(ordersTable)
    .set({ riderId: riderId || null, updatedAt: new Date() })
    .where(eq(ordersTable.id, req.params["id"]!))
    .returning();
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  let riderName: string | null = null;
  if (riderId) {
    const [rider] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, riderId));
    riderName = rider?.name ?? null;
  }
  addAuditEntry({ action: "order_rider_assigned", ip: getClientIp(req), adminId: (req as any).adminId, details: `Rider ${riderName ?? riderId ?? "unassigned"} assigned to order ${req.params["id"]}`, result: "success" });
  res.json({ success: true, order: { ...order, total: parseFloat(String(order.total)), riderName } });
});

/* ── PATCH /admin/vendors/:id/commission — set per-vendor commission override ── */
router.patch("/vendors/:id/commission", async (req, res) => {
  const { commissionPct } = req.body as { commissionPct: number };
  if (commissionPct === undefined || isNaN(Number(commissionPct))) {
    res.status(400).json({ error: "commissionPct required" }); return;
  }
  const [vendor] = await db.update(usersTable)
    .set({ commissionOverride: String(commissionPct), updatedAt: new Date() } as any)
    .where(eq(usersTable.id, req.params["id"]!))
    .returning();
  if (!vendor) { res.status(404).json({ error: "Vendor not found" }); return; }
  addAuditEntry({ action: "vendor_commission_override", ip: getClientIp(req), adminId: (req as any).adminId, details: `Commission override ${commissionPct}% for vendor ${req.params["id"]}`, result: "success" });
  res.json({ success: true, commissionPct });
});

/* ── PATCH /admin/riders/:id/online — toggle rider online/offline ── */
router.patch("/riders/:id/online", async (req, res) => {
  const { isOnline } = req.body as { isOnline: boolean };
  const [rider] = await db.update(usersTable)
    .set({ isOnline, updatedAt: new Date() } as any)
    .where(eq(usersTable.id, req.params["id"]!))
    .returning();
  if (!rider) { res.status(404).json({ error: "Rider not found" }); return; }
  addAuditEntry({ action: "rider_online_toggle", ip: getClientIp(req), adminId: (req as any).adminId, details: `Rider ${req.params["id"]} set ${isOnline ? "online" : "offline"} by admin`, result: "success" });
  res.json({ success: true, isOnline });
});

/* ── GET /admin/revenue-trend — 7-day rolling revenue for dashboard sparkline ── */
router.get("/revenue-trend", async (_req, res) => {
  const days: { date: string; revenue: number }[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const from = new Date(d); from.setHours(0, 0, 0, 0);
    const to   = new Date(d); to.setHours(23, 59, 59, 999);
    const [row] = await db.select({ total: sum(ordersTable.total) })
      .from(ordersTable)
      .where(and(eq(ordersTable.status, "delivered"), gte(ordersTable.createdAt, from), lte(ordersTable.createdAt, to)));
    const [rideRow] = await db.select({ total: sum(ridesTable.fare) })
      .from(ridesTable)
      .where(and(eq(ridesTable.status, "completed"), gte(ridesTable.createdAt, from), lte(ridesTable.createdAt, to)));
    days.push({
      date: d.toISOString().slice(0, 10),
      revenue: parseFloat(row?.total ?? "0") + parseFloat(rideRow?.total ?? "0"),
    });
  }
  res.json({ trend: days });
});

/* ── GET /admin/leaderboard — top-5 vendors and riders ── */
router.get("/leaderboard", async (_req, res) => {
  const vendors = await db.select({
    id:     usersTable.id,
    name:   usersTable.storeName,
    phone:  usersTable.phone,
    totalOrders: sql<number>`count(${ordersTable.id})`,
    totalRevenue: sql<number>`coalesce(sum(${ordersTable.total}),0)`,
  })
  .from(usersTable)
  .leftJoin(ordersTable, and(eq(ordersTable.vendorId, usersTable.id), eq(ordersTable.status, "delivered")))
  .where(eq(usersTable.role, "vendor"))
  .groupBy(usersTable.id)
  .orderBy(sql`coalesce(sum(${ordersTable.total}),0) desc`)
  .limit(5);

  const riders = await db.select({
    id:   usersTable.id,
    name: usersTable.name,
    phone: usersTable.phone,
    completedTrips: sql<number>`count(${ridesTable.id})`,
    totalEarned: sql<number>`coalesce(sum(${ridesTable.fare}),0)`,
  })
  .from(usersTable)
  .leftJoin(ridesTable, and(eq(ridesTable.riderId, usersTable.id), eq(ridesTable.status, "completed")))
  .where(eq(usersTable.role, "rider"))
  .groupBy(usersTable.id)
  .orderBy(sql`count(${ridesTable.id}) desc`)
  .limit(5);

  res.json({
    vendors: vendors.map(v => ({ ...v, totalRevenue: parseFloat(String(v.totalRevenue)), totalOrders: Number(v.totalOrders) })),
    riders:  riders.map(r  => ({ ...r,  totalEarned: parseFloat(String(r.totalEarned)),  completedTrips: Number(r.completedTrips) })),
  });
});

/* ── GET /admin/dashboard-export — export current dashboard stats as JSON ── */
router.get("/dashboard-export", async (_req, res) => {
  const [userCount] = await db.select({ count: count() }).from(usersTable);
  const [orderCount] = await db.select({ count: count() }).from(ordersTable);
  const [rideCount]  = await db.select({ count: count() }).from(ridesTable);
  const [revenue]    = await db.select({ total: sum(ordersTable.total) }).from(ordersTable).where(eq(ordersTable.status, "delivered"));
  const [rideRev]    = await db.select({ total: sum(ridesTable.fare) }).from(ridesTable).where(eq(ridesTable.status, "completed"));
  const snapshot = {
    exportedAt: new Date().toISOString(),
    users: userCount?.count ?? 0,
    orders: orderCount?.count ?? 0,
    rides: rideCount?.count ?? 0,
    totalRevenue: parseFloat(revenue?.total ?? "0") + parseFloat(rideRev?.total ?? "0"),
    orderRevenue: parseFloat(revenue?.total ?? "0"),
    rideRevenue:  parseFloat(rideRev?.total ?? "0"),
  };
  res.setHeader("Content-Disposition", `attachment; filename="dashboard-${new Date().toISOString().slice(0,10)}.json"`);
  res.json(snapshot);
});

/* ══════════════════════════════════════════════════════════════════════════════
   RIDE MANAGEMENT MODULE — Admin ride actions with full audit logging
══════════════════════════════════════════════════════════════════════════════ */

router.post("/rides/:id/cancel", async (req, res) => {
  const rideId = req.params["id"]!;
  const { reason } = req.body as { reason?: string };
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }
  if (["completed", "cancelled"].includes(ride.status)) {
    res.status(400).json({ error: `Cannot cancel a ride that is already ${ride.status}` }); return;
  }

  const isWallet = ride.paymentMethod === "wallet";
  const refundAmt = parseFloat(ride.fare);
  let refunded = false;

  try {
    await db.transaction(async (tx) => {
      await tx.update(ridesTable)
        .set({ status: "cancelled", cancellationReason: reason || null, updatedAt: new Date() })
        .where(eq(ridesTable.id, rideId));

      await tx.update(rideBidsTable)
        .set({ status: "rejected", updatedAt: new Date() })
        .where(and(eq(rideBidsTable.rideId, rideId), eq(rideBidsTable.status, "pending")));

      if (isWallet) {
        await tx.update(usersTable)
          .set({ walletBalance: sql`wallet_balance + ${refundAmt}`, updatedAt: new Date() })
          .where(eq(usersTable.id, ride.userId));
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId: ride.userId, type: "credit",
          amount: refundAmt.toFixed(2),
          description: `Refund — Ride #${rideId.slice(-6).toUpperCase()} cancelled by admin`,
        });
        refunded = true;
      }
    });
  } catch (txErr: any) {
    addAuditEntry({ action: "ride_cancel", ip: getClientIp(req), adminId: (req as any).adminId, details: `Ride ${rideId} cancel failed — transaction error: ${txErr.message}`, result: "error" });
    res.status(500).json({ error: "Cancellation failed: could not complete transaction", detail: txErr.message });
    return;
  }

  if (refunded) {
    await sendUserNotification(ride.userId, "Ride Cancelled & Refunded 💰", `Rs. ${refundAmt.toFixed(0)} refund ho gaya. ${reason ? `Reason: ${reason}` : ""}`, "ride", "wallet-outline");
  } else {
    await sendUserNotification(ride.userId, "Ride Cancelled ❌", `Your ride has been cancelled by admin. ${reason ? `Reason: ${reason}` : ""}`, "ride", "close-circle-outline");
  }

  if (ride.riderId) {
    await sendUserNotification(ride.riderId, "Ride Cancelled ❌", `Ride #${rideId.slice(-6).toUpperCase()} admin ne cancel ki.`, "ride", "close-circle-outline");
  }

  addAuditEntry({ action: "ride_cancel", ip: getClientIp(req), adminId: (req as any).adminId, details: `Admin cancelled ride ${rideId}${reason ? ` — ${reason}` : ""}${refunded ? " (wallet refunded)" : ""}`, result: "success" });
  res.json({ success: true, rideId, refunded });
});

router.post("/rides/:id/refund", async (req, res) => {
  const rideId = req.params["id"]!;
  const { amount, reason } = req.body as { amount?: number; reason?: string };
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }

  const refundAmt = amount ?? parseFloat(ride.fare);
  if (refundAmt <= 0) { res.status(400).json({ error: "Invalid refund amount" }); return; }

  await db.transaction(async (tx) => {
    await tx.update(usersTable).set({ walletBalance: sql`wallet_balance + ${refundAmt}`, updatedAt: new Date() }).where(eq(usersTable.id, ride.userId));
    await tx.insert(walletTransactionsTable).values({
      id: generateId(), userId: ride.userId, type: "credit",
      amount: refundAmt.toFixed(2),
      description: `Admin refund — Ride #${rideId.slice(-6).toUpperCase()}${reason ? ` (${reason})` : ""}`,
    });
  });

  await sendUserNotification(ride.userId, "Ride Refund 💰", `Rs. ${refundAmt.toFixed(0)} aapki wallet mein refund ho gaya.`, "ride", "wallet-outline");
  addAuditEntry({ action: "ride_refund", ip: getClientIp(req), adminId: (req as any).adminId, details: `Admin refunded Rs. ${refundAmt} for ride ${rideId}${reason ? ` — ${reason}` : ""}`, result: "success" });
  res.json({ success: true, rideId, refundedAmount: refundAmt });
});

router.post("/rides/:id/reassign", async (req, res) => {
  const rideId = req.params["id"]!;
  const { riderId, riderName, riderPhone } = req.body as { riderId?: string; riderName?: string; riderPhone?: string };
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }
  if (["completed", "cancelled"].includes(ride.status)) {
    res.status(400).json({ error: `Cannot reassign a ride that is ${ride.status}` }); return;
  }

  if (!riderId) { res.status(400).json({ error: "riderId is required to reassign" }); return; }

  const [riderUser] = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, riderId)).limit(1);
  if (!riderUser) { res.status(404).json({ error: "Rider not found" }); return; }
  if (riderUser.role !== "rider") { res.status(400).json({ error: "Selected user is not a rider" }); return; }

  const oldRiderId = ride.riderId;
  const resolvedName = riderName || riderUser.name;
  const resolvedPhone = riderPhone || riderUser.phone;
  const updateData: Record<string, any> = {
    riderId,
    riderName: resolvedName,
    riderPhone: resolvedPhone,
    updatedAt: new Date(),
  };
  if (!ride.riderId) updateData.status = "accepted";

  const [updated] = await db.update(ridesTable).set(updateData).where(eq(ridesTable.id, rideId)).returning();

  if (oldRiderId && oldRiderId !== riderId) {
    await sendUserNotification(oldRiderId, "Ride Reassigned", `Ride #${rideId.slice(-6).toUpperCase()} doosre rider ko assign ho gayi.`, "ride", "swap-horizontal-outline");
  }
  if (riderId) {
    await sendUserNotification(riderId, "New Ride Assigned 🚗", `Ride #${rideId.slice(-6).toUpperCase()} aapko assign ho gayi!`, "ride", "car-outline");
  }
  await sendUserNotification(ride.userId, "Rider Changed", `Aapki ride ka rider change ho gaya hai${resolvedName ? ` — ${resolvedName}` : ""}.`, "ride", "swap-horizontal-outline");

  addAuditEntry({ action: "ride_reassign", ip: getClientIp(req), adminId: (req as any).adminId, details: `Admin reassigned ride ${rideId} from ${oldRiderId ?? "none"} to ${riderId} (${resolvedName})`, result: "success" });
  res.json({ success: true, ride: { ...updated, fare: parseFloat(updated!.fare), distance: parseFloat(updated!.distance) } });
});

router.get("/rides/:id/audit-trail", async (req, res) => {
  const rideId = req.params["id"]!;
  const shortId = rideId.slice(-6).toUpperCase();
  const trail = auditLog.filter(e => e.details?.includes(rideId) || e.details?.includes(shortId)).map(e => ({
    action: e.action,
    details: e.details,
    ip: e.ip,
    adminId: e.adminId,
    result: e.result,
    timestamp: e.timestamp,
  }));
  trail.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  res.json({ trail, rideId });
});

router.get("/rides/:id/detail", async (req, res) => {
  const rideId = req.params["id"]!;
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }

  const [customer] = await db.select({ name: usersTable.name, phone: usersTable.phone, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, ride.userId)).limit(1);
  let rider = null;
  if (ride.riderId) {
    const [r] = await db.select({ name: usersTable.name, phone: usersTable.phone, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, ride.riderId)).limit(1);
    rider = r ?? null;
  }

  const eventLogs = await db.select().from(rideEventLogsTable).where(eq(rideEventLogsTable.rideId, rideId)).orderBy(asc(rideEventLogsTable.createdAt));

  const bidRows = await db.select().from(rideBidsTable).where(eq(rideBidsTable.rideId, rideId)).orderBy(desc(rideBidsTable.createdAt));

  const notifiedCount = await db.select({ cnt: count() }).from(rideNotifiedRidersTable).where(eq(rideNotifiedRidersTable.rideId, rideId));

  const s = await getPlatformSettings();
  const gstEnabled = (s["finance_gst_enabled"] ?? "off") === "on";
  const gstPct = parseFloat(s["finance_gst_pct"] ?? "17");
  const surgeEnabled = (s["ride_surge_enabled"] ?? "off") === "on";
  const surgeMultiplier = surgeEnabled ? parseFloat(s["ride_surge_multiplier"] ?? "1.5") : 1;
  const fare = parseFloat(ride.fare);
  const gstAmount = gstEnabled ? parseFloat(((fare * gstPct) / (100 + gstPct)).toFixed(2)) : 0;
  const baseFare = fare - gstAmount;

  res.json({
    ride: {
      ...ride,
      fare,
      distance: parseFloat(ride.distance),
      offeredFare: ride.offeredFare ? parseFloat(ride.offeredFare) : null,
      counterFare: ride.counterFare ? parseFloat(ride.counterFare) : null,
      createdAt: ride.createdAt.toISOString(),
      updatedAt: ride.updatedAt.toISOString(),
      acceptedAt: ride.acceptedAt ? ride.acceptedAt.toISOString() : null,
      dispatchedAt: ride.dispatchedAt ? ride.dispatchedAt.toISOString() : null,
    },
    customer: customer ?? null,
    rider: rider ?? null,
    fareBreakdown: { baseFare, gstAmount, gstPct: gstEnabled ? gstPct : 0, surgeMultiplier, total: fare },
    eventLogs: eventLogs.map(e => ({
      ...e,
      lat: e.lat ? parseFloat(e.lat) : null,
      lng: e.lng ? parseFloat(e.lng) : null,
      createdAt: e.createdAt.toISOString(),
    })),
    bids: bidRows.map(b => ({
      ...b,
      amount: parseFloat(b.amount),
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    })),
    notifiedRiderCount: Number(notifiedCount[0]?.cnt ?? 0),
  });
});

router.get("/dispatch-monitor", async (_req, res) => {
  const activeRides = await db.select().from(ridesTable)
    .where(or(eq(ridesTable.status, "searching"), eq(ridesTable.status, "bargaining")))
    .orderBy(desc(ridesTable.createdAt));

  const rideIds = activeRides.map(r => r.id);
  let notifiedCounts: Record<string, number> = {};
  if (rideIds.length > 0) {
    const counts = await db.select({ rideId: rideNotifiedRidersTable.rideId, cnt: count() })
      .from(rideNotifiedRidersTable)
      .where(sql`${rideNotifiedRidersTable.rideId} IN (${sql.join(rideIds.map(id => sql`${id}`), sql`, `)})`)
      .groupBy(rideNotifiedRidersTable.rideId);
    notifiedCounts = Object.fromEntries(counts.map(c => [c.rideId, Number(c.cnt)]));
  }

  const userIds = [...new Set(activeRides.map(r => r.userId))];
  let userMap: Record<string, { name: string | null; phone: string | null }> = {};
  if (userIds.length > 0) {
    const users = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone })
      .from(usersTable)
      .where(sql`${usersTable.id} IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})`);
    userMap = Object.fromEntries(users.map(u => [u.id, { name: u.name, phone: u.phone }]));
  }

  const bidCounts = rideIds.length > 0
    ? await db.select({ rideId: rideBidsTable.rideId, total: count(rideBidsTable.id) })
        .from(rideBidsTable)
        .where(sql`${rideBidsTable.rideId} IN (${sql.join(rideIds.map(id => sql`${id}`), sql`, `)})`)
        .groupBy(rideBidsTable.rideId)
    : [];
  const bidCountMap = Object.fromEntries(bidCounts.map(b => [b.rideId, Number(b.total)]));

  res.json({
    rides: activeRides.map(r => ({
      id: r.id,
      type: r.type,
      status: r.status,
      pickupAddress: r.pickupAddress,
      dropAddress: r.dropAddress,
      pickupLat: r.pickupLat ? parseFloat(r.pickupLat) : null,
      pickupLng: r.pickupLng ? parseFloat(r.pickupLng) : null,
      fare: parseFloat(r.fare),
      offeredFare: r.offeredFare ? parseFloat(r.offeredFare) : null,
      customerName: userMap[r.userId]?.name ?? "Unknown",
      customerPhone: userMap[r.userId]?.phone ?? null,
      notifiedRiders: notifiedCounts[r.id] ?? 0,
      totalBids: bidCountMap[r.id] ?? 0,
      elapsedSeconds: Math.floor((Date.now() - r.createdAt.getTime()) / 1000),
      createdAt: r.createdAt.toISOString(),
      bargainStatus: r.bargainStatus,
    })),
    total: activeRides.length,
  });
});

export default router;
