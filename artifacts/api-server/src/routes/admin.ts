import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  ordersTable,
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
} from "@workspace/db/schema";
import { eq, desc, count, sum, and, gte, lte, sql, or, ilike } from "drizzle-orm";
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
} from "../middleware/security.js";
import { generateTotpSecret, verifyTotpToken, generateQRCodeDataURL, getTotpUri } from "../services/totp.js";

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
  { key: "ride_surge_enabled",       value: "off", label: "Enable Surge Pricing",                   category: "rides" },
  { key: "ride_surge_multiplier",    value: "1.5", label: "Surge Multiplier",                       category: "rides" },
  { key: "ride_cancellation_fee",    value: "30",  label: "Cancellation Fee after Acceptance (Rs.)", category: "rides" },
  /* Finance */
  { key: "platform_commission_pct", value: "10",  label: "Platform Commission % (Global Override)", category: "finance" },
  { key: "finance_gst_enabled",     value: "off", label: "Collect GST / Sales Tax",                 category: "finance" },
  { key: "finance_gst_pct",         value: "17",  label: "GST / Tax Rate (%)",                      category: "finance" },
  { key: "finance_cashback_enabled",value: "off", label: "Enable Order Cashback Rewards",            category: "finance" },
  { key: "finance_cashback_pct",    value: "2",   label: "Cashback % on Every Order",               category: "finance" },
  { key: "finance_cashback_max_rs", value: "100", label: "Max Cashback Per Order (Rs.)",             category: "finance" },
  { key: "finance_invoice_enabled", value: "off", label: "Auto-Generate PDF Invoices on Orders",    category: "finance" },
  { key: "finance_min_vendor_payout",value:"500", label: "Minimum Vendor Payout Request (Rs.)",     category: "finance" },
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
  { key: "rider_keep_pct",         value: "80",    label: "Rider Earnings % (of fare)",    category: "rider" },
  { key: "rider_acceptance_km",    value: "5",     label: "Acceptance Radius (KM)",        category: "rider" },
  { key: "rider_max_deliveries",   value: "3",     label: "Max Active Deliveries",         category: "rider" },
  { key: "rider_bonus_per_trip",   value: "0",     label: "Bonus Per Trip (Rs.)",          category: "rider" },
  { key: "rider_min_payout",       value: "500",   label: "Minimum Payout (Rs.)",          category: "rider" },
  { key: "rider_cash_allowed",     value: "on",    label: "Allow Cash Payments",           category: "rider" },
  { key: "rider_auto_approve",     value: "off",   label: "Auto-Approve New Riders",        category: "rider" },
  { key: "rider_withdrawal_enabled", value: "on",  label: "Riders Can Submit Withdrawals",  category: "rider" },
  { key: "rider_max_payout",       value: "50000", label: "Maximum Single Payout (Rs.)",   category: "rider" },
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
  /* Content & Messaging */
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
  { key: "wallet_referral_bonus",        value: "100",      label: "Referral Bonus to Wallet (Rs.)",       category: "payment" },
  { key: "wallet_topup_methods",         value: "jazzcash,easypaisa,bank,rider", label: "Accepted Top-Up Methods", category: "payment" },
  { key: "wallet_p2p_enabled",           value: "on",       label: "Allow P2P Money Transfer",             category: "payment" },
  { key: "wallet_p2p_daily_limit",       value: "10000",    label: "P2P Daily Send Limit (Rs.)",           category: "payment" },
  { key: "wallet_kyc_required",          value: "off",      label: "KYC Required Before Activation",       category: "payment" },
  { key: "wallet_cashback_on_orders",    value: "on",       label: "Cashback on Mart/Food Orders",         category: "payment" },
  { key: "wallet_cashback_on_rides",     value: "off",      label: "Cashback on Rides",                    category: "payment" },
  { key: "wallet_cashback_on_pharmacy",  value: "off",      label: "Cashback on Pharmacy",                 category: "payment" },
  { key: "wallet_expiry_days",           value: "0",        label: "Wallet Balance Expiry (days, 0=never)",category: "payment" },
  { key: "wallet_withdrawal_processing", value: "24",       label: "Withdrawal Processing Time (hours)",   category: "payment" },
  { key: "wallet_signup_bonus",          value: "0",        label: "New User Signup Bonus (Rs.)",          category: "payment" },
  /* ═══════════════════  Payment General Rules  ═══════════════════ */
  { key: "payment_timeout_mins",         value: "15",       label: "Payment Timeout (minutes)",            category: "payment" },
  { key: "payment_auto_cancel",          value: "on",       label: "Auto-Cancel Unpaid Orders",            category: "payment" },
  { key: "payment_min_online",           value: "50",       label: "Minimum Online Payment (Rs.)",         category: "payment" },
  { key: "payment_max_online",           value: "100000",   label: "Maximum Online Payment (Rs.)",         category: "payment" },
  { key: "payment_receipt_required",     value: "on",       label: "Require Receipt for Manual Payments",  category: "payment" },
  { key: "payment_verify_window_hours",  value: "4",        label: "Manual Payment Verify Window (hours)", category: "payment" },
];

export async function getPlatformSettings(): Promise<Record<string, string>> {
  // Always seed missing keys (onConflictDoNothing skips existing ones)
  await db.insert(platformSettingsTable).values(DEFAULT_PLATFORM_SETTINGS).onConflictDoNothing();
  const rows = await db.select().from(platformSettingsTable);
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

const router: IRouter = Router();

const ADMIN_SECRET = process.env.ADMIN_SECRET || "ajkmart-admin-2025";

async function adminAuth(req: Request, res: Response, next: NextFunction) {
  const ip   = getClientIp(req);
  const auth = String(req.headers["x-admin-secret"] || req.query["secret"] || "");

  if (!auth) {
    addAuditEntry({ action: "admin_auth_missing", ip, details: `No admin secret provided for ${req.method} ${req.url}`, result: "fail" });
    res.status(401).json({ error: "Unauthorized. Admin secret is required." });
    return;
  }

  /* ── Load settings for IP whitelist & token expiry checks ── */
  const settings = await getPlatformSettings();

  /* ── Admin IP Whitelist ── */
  if (!checkAdminIPWhitelist(req, settings)) {
    addAuditEntry({ action: "admin_ip_blocked", ip, details: `Admin access denied: IP not in whitelist`, result: "fail" });
    addSecurityEvent({ type: "admin_ip_blocked", ip, details: `Admin access denied from IP: ${ip}`, severity: "critical" });
    res.status(403).json({ error: "Access denied. Your IP address is not whitelisted for admin access." });
    return;
  }

  /* ── Super admin via master secret ── */
  if (auth === ADMIN_SECRET) {
    (req as any).adminRole = "super";
    (req as any).adminIp   = ip;
    addAuditEntry({ action: "admin_login", ip, details: `Super admin accessed ${req.method} ${req.url}`, result: "success" });
    next();
    return;
  }

  /* ── Sub-admin via stored secret ── */
  const [sub] = await db.select().from(adminAccountsTable)
    .where(and(eq(adminAccountsTable.secret, auth), eq(adminAccountsTable.isActive, true)))
    .limit(1);

  if (sub) {
    /* ── Admin token expiry check ── */
    const tokenHrs = parseInt(settings["security_admin_token_hrs"] ?? "24", 10);
    if (sub.lastLoginAt) {
      const msSinceLogin = Date.now() - sub.lastLoginAt.getTime();
      const maxMs = tokenHrs * 60 * 60 * 1000;
      if (msSinceLogin > maxMs) {
        addAuditEntry({ action: "admin_token_expired", ip, adminId: sub.id, details: `Admin token expired for ${sub.name} (${tokenHrs}h limit)`, result: "fail" });
        res.status(401).json({ error: `Admin session expired after ${tokenHrs} hours. Please re-authenticate.` });
        return;
      }
    }

    /* ── TOTP / MFA check ── */
    const mfaEnabled   = settings["security_mfa_required"] === "on";
    const totpEnabled  = sub.totpEnabled && sub.totpSecret;
    if (mfaEnabled && totpEnabled) {
      const totpHeader = String(req.headers["x-admin-totp"] || "");
      /* Allow MFA setup endpoints without TOTP check */
      const isMfaRoute = req.url.includes("/mfa/");
      if (!isMfaRoute) {
        if (!totpHeader) {
          res.status(401).json({
            error: "MFA required. Please provide your TOTP code in the x-admin-totp header.",
            mfaRequired: true,
          });
          return;
        }
        const valid = verifyTotpToken(totpHeader, sub.totpSecret!);
        if (!valid) {
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

/* ── Auth check ── */
router.post("/auth", (req, res) => {
  const { secret } = req.body;
  if (secret === ADMIN_SECRET) {
    res.json({ success: true, token: ADMIN_SECRET });
  } else {
    res.status(401).json({ error: "Invalid admin password" });
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
router.get("/users", async (_req, res) => {
  const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));
  res.json({
    users: users.map(u => ({
      ...u,
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
  if (role !== undefined) updates.role = role;
  if (isActive !== undefined) updates.isActive = isActive;
  if (walletBalance !== undefined) updates.walletBalance = String(walletBalance);

  const [user] = await db
    .update(usersTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(usersTable.id, req.params["id"]!))
    .returning();

  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ ...user, walletBalance: parseFloat(user.walletBalance ?? "0") });
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
    user: { ...updatedUser!, walletBalance: newBalance },
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
      const [rider] = await db.select().from(usersTable).where(eq(usersTable.id, ride.riderId));
      if (rider) {
        const riderNewBal = (parseFloat(rider.walletBalance ?? "0") + riderEarning).toFixed(2);
        await db.update(usersTable).set({ walletBalance: riderNewBal, updatedAt: new Date() }).where(eq(usersTable.id, rider.id));
        await db.insert(walletTransactionsTable).values({
          id: generateId(), userId: rider.id, type: "credit",
          amount: String(riderEarning),
          description: `Ride earnings — #${ride.id.slice(-6).toUpperCase()} (${Math.round(riderKeepPct * 100)}%)`,
        });
        await sendUserNotification(rider.id, "Ride Payment Received 💰", `Rs. ${riderEarning} wallet mein add ho gaya!`, "ride", "wallet-outline");
      }
    }
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
  let rows = await db.select().from(platformSettingsTable);
  if (rows.length === 0) {
    await db.insert(platformSettingsTable).values(DEFAULT_PLATFORM_SETTINGS).onConflictDoNothing();
    rows = await db.select().from(platformSettingsTable);
  }
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
  const rows = await db.select().from(platformSettingsTable);
  res.json({ success: true, settings: rows.map(r => ({ ...r, updatedAt: r.updatedAt.toISOString() })) });
});

router.patch("/platform-settings/:key", async (req, res) => {
  const { value } = req.body;
  const [row] = await db
    .update(platformSettingsTable)
    .set({ value: String(value), updatedAt: new Date() })
    .where(eq(platformSettingsTable.key, req.params["key"]!))
    .returning();
  if (!row) { res.status(404).json({ error: "Setting not found" }); return; }
  /* Bust the security settings cache so new values apply immediately */
  invalidateSettingsCache();
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
  const rides = await db.select().from(ridesTable).orderBy(desc(ridesTable.createdAt)).limit(200);
  const users = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone }).from(usersTable);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  res.json({
    rides: rides.map(r => ({
      ...r,
      fare: parseFloat(r.fare),
      distance: parseFloat(r.distance),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      userName: userMap[r.userId]?.name || null,
      userPhone: userMap[r.userId]?.phone || null,
    })),
    total: rides.length,
  });
});

/* ── User Security Management ── */
router.patch("/users/:id/security", async (req, res) => {
  const { id } = req.params;
  const body = req.body as any;
  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.isActive     !== undefined) updates.isActive     = body.isActive;
  if (body.isBanned     !== undefined) updates.isBanned     = body.isBanned;
  if (body.banReason    !== undefined) updates.banReason    = body.banReason || null;
  if (body.roles        !== undefined) updates.roles        = body.roles;
  if (body.role         !== undefined) updates.role         = body.role;
  if (body.blockedServices !== undefined) updates.blockedServices = body.blockedServices;
  if (body.securityNote !== undefined) updates.securityNote = body.securityNote || null;
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id!)).returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (body.isBanned && body.notify) {
    await sendUserNotification(id!, "Account Suspended ⚠️", body.banReason || "Your account has been suspended. Contact support.", "warning", "warning-outline");
  }
  res.json({ ...user, walletBalance: parseFloat(String(user.walletBalance)) });
});

router.post("/users/:id/reset-otp", async (req, res) => {
  await db.update(usersTable).set({ otpCode: null, otpExpiry: null, updatedAt: new Date() }).where(eq(usersTable.id, req.params["id"]!));
  res.json({ success: true, message: "OTP cleared — user must re-authenticate" });
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
  if (body.secret === ADMIN_SECRET) { res.status(400).json({ error: "Cannot use the master secret" }); return; }
  try {
    const [account] = await db.insert(adminAccountsTable).values({
      id:          generateId(),
      name:        body.name,
      secret:      body.secret,
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
    if (body.secret === ADMIN_SECRET) { res.status(400).json({ error: "Cannot use the master secret" }); return; }
    updates.secret = body.secret;
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
  if (isBanned) {
    await sendUserNotification(req.params["id"]!, "Store Account Suspended ⚠️", banReason || "Your vendor account has been suspended. Contact support.", "warning", "warning-outline");
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
  res.json({ success: true, amount: amt, newBalance: newBal, vendor: { ...updated, walletBalance: newBal } });
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
  res.json({ success: true, amount: amt, newBalance: newBal, vendor: { ...updated, walletBalance: newBal } });
});

/* ══════════════════════════════════════
   RIDER MANAGEMENT
══════════════════════════════════════ */
router.get("/riders", async (_req, res) => {
  const riders = await db.select().from(usersTable).where(
    or(ilike(usersTable.roles, "%rider%"), eq(usersTable.role, "rider"))
  ).orderBy(desc(usersTable.createdAt));

  res.json({
    riders: riders.map(r => ({
      id: r.id, phone: r.phone, name: r.name, email: r.email,
      avatar: r.avatar,
      walletBalance: parseFloat(r.walletBalance ?? "0"),
      isActive: r.isActive, isBanned: r.isBanned,
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
  if (isBanned) {
    await sendUserNotification(req.params["id"]!, "Rider Account Suspended ⚠️", banReason || "Your rider account has been suspended. Contact support.", "warning", "warning-outline");
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

/* ── GET /admin/withdrawal-requests ─────────── */
router.get("/withdrawal-requests", async (_req, res) => {
  const txns = await db.select().from(walletTransactionsTable)
    .where(sql`description LIKE 'Withdrawal —%' AND type = 'debit'`)
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(200);
  const enriched = await Promise.all(txns.map(async t => {
    const [user] = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, t.userId)).limit(1);
    return { ...t, amount: parseFloat(String(t.amount)), user: user || null };
  }));
  res.json({ withdrawals: enriched });
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
  const limit  = Math.min(parseInt(String(req.query["limit"]  || "200")), 1000);
  const action = req.query["action"] as string | undefined;
  const result = req.query["result"] as string | undefined;

  let entries = [...auditLog];
  if (action) entries = entries.filter(e => e.action.includes(action));
  if (result) entries = entries.filter(e => e.result === result);

  res.json({
    entries: entries.slice(0, limit),
    total: entries.length,
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
    adminId: (req as any).adminId,
    details: `IP ${ip} manually blocked. Reason: ${reason || "No reason given"}`,
    result: "success",
  });
  addSecurityEvent({ type: "ip_manually_blocked", ip, details: `Admin manually blocked IP: ${ip}. Reason: ${reason || "none"}`, severity: "high" });
  res.json({ success: true, blocked: ip, totalBlocked: blockedIPs.size });
});

/* ── DELETE /admin/blocked-ips/:ip — unblock an IP ── */
router.delete("/blocked-ips/:ip", adminAuth, (req, res) => {
  const ip = decodeURIComponent(req.params["ip"]!);
  const wasBlocked = blockedIPs.has(ip);
  blockedIPs.delete(ip);
  addAuditEntry({
    action: "unblock_ip",
    ip: getClientIp(req),
    adminId: (req as any).adminId,
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
  const phone = decodeURIComponent(req.params["phone"]!);
  unlockPhone(phone);
  addAuditEntry({
    action: "admin_unlock_phone",
    ip: getClientIp(req),
    adminId: (req as any).adminId,
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
  const adminId = (req as any).adminId;
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
  const adminId   = (req as any).adminId;
  const adminName = (req as any).adminName ?? "Admin";
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

  addAuditEntry({ action: "mfa_setup_initiated", ip: (req as any).adminIp, adminId, details: `MFA setup started for ${adminName}`, result: "success" });

  res.json({
    secret,
    otpUri,
    qrCodeDataUrl: qrCodeUrl,
    instructions: "Scan the QR code with Google Authenticator or Authy. Then call POST /admin/mfa/verify with a valid token to activate MFA.",
  });
});

/* POST /admin/mfa/verify — verify a TOTP token to activate MFA */
router.post("/mfa/verify", adminAuth, async (req, res) => {
  const adminId   = (req as any).adminId;
  const adminName = (req as any).adminName ?? "Admin";
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
    addAuditEntry({ action: "mfa_verify_failed", ip: (req as any).adminIp, adminId, details: `MFA verify failed for ${adminName}`, result: "fail" });
    res.status(401).json({ error: "Invalid TOTP token. Please try again." });
    return;
  }

  await db.update(adminAccountsTable)
    .set({ totpEnabled: true })
    .where(eq(adminAccountsTable.id, adminId));

  addAuditEntry({ action: "mfa_activated", ip: (req as any).adminIp, adminId, details: `MFA activated for ${adminName}`, result: "success" });

  res.json({ success: true, message: "MFA successfully activated. You must now provide x-admin-totp with every request when global MFA is enabled." });
});

/* DELETE /admin/mfa/disable — disable MFA (requires current valid TOTP or super admin) */
router.delete("/mfa/disable", adminAuth, async (req, res) => {
  const adminId   = (req as any).adminId;
  const adminName = (req as any).adminName ?? "Admin";
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

  addAuditEntry({ action: "mfa_disabled", ip: (req as any).adminIp, adminId, details: `MFA disabled for ${adminName}`, result: "warn" });

  res.json({ success: true, message: "MFA has been disabled for your account." });
});

export default router;
