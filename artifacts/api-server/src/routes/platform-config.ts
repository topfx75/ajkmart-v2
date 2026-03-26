import { Router, type IRouter } from "express";
import { getPlatformSettings } from "./admin.js";

const router: IRouter = Router();

// Public endpoint — all client apps fetch this for config + feature flags
router.get("/", async (_req, res) => {
  const s = await getPlatformSettings();

  const jazzcashEnabled  = (s["jazzcash_enabled"]  ?? "off") === "on";
  const easypaisaEnabled = (s["easypaisa_enabled"] ?? "off") === "on";
  const walletEnabled    = (s["feature_wallet"]    ?? "on")  === "on";

  // Build available payment methods list for client apps
  const paymentMethods: Array<{
    id: string;
    label: string;
    logo: string;
    available: boolean;
    mode: string;
    description: string;
  }> = [
    {
      id:          "cash",
      label:       "Cash on Delivery",
      logo:        "💵",
      available:   true,
      mode:        "live",
      description: "Delivery par payment karein",
    },
    {
      id:          "wallet",
      label:       `${s["app_name"] ?? "AJKMart"} Wallet`,
      logo:        "💰",
      available:   walletEnabled,
      mode:        "live",
      description: "Apni wallet se instant pay karein",
    },
    {
      id:          "jazzcash",
      label:       "JazzCash",
      logo:        "🔴",
      available:   jazzcashEnabled,
      mode:        s["jazzcash_mode"] ?? "sandbox",
      description: "JazzCash mobile wallet",
    },
    {
      id:          "easypaisa",
      label:       "EasyPaisa",
      logo:        "🟢",
      available:   easypaisaEnabled,
      mode:        s["easypaisa_mode"] ?? "sandbox",
      description: "EasyPaisa mobile wallet",
    },
  ];

  res.json({
    deliveryFee: {
      mart:     parseFloat(s["delivery_fee_mart"]     ?? "80"),
      food:     parseFloat(s["delivery_fee_food"]     ?? "60"),
      pharmacy: parseFloat(s["delivery_fee_pharmacy"] ?? "50"),
      parcel:   parseFloat(s["delivery_fee_parcel"]   ?? "100"),
    },
    rides: {
      bikeBaseFare: parseFloat(s["ride_bike_base_fare"] ?? "15"),
      bikePerKm:    parseFloat(s["ride_bike_per_km"]    ?? "8"),
      carBaseFare:  parseFloat(s["ride_car_base_fare"]  ?? "25"),
      carPerKm:     parseFloat(s["ride_car_per_km"]     ?? "12"),
    },
    platform: {
      commissionPct:        parseFloat(s["platform_commission_pct"] ?? "10"),
      vendorCommissionPct:  parseFloat(s["vendor_commission_pct"]   ?? "15"),
      minOrderAmount:       parseFloat(s["min_order_amount"]         ?? "100"),
      maxCodAmount:         parseFloat(s["max_cod_amount"]           ?? "5000"),
      freeDeliveryAbove:    parseFloat(s["free_delivery_above"]      ?? "1000"),
      appName:              s["app_name"]           ?? "AJKMart",
      appTagline:           s["app_tagline"]        ?? "Your super app for everything",
      appVersion:           s["app_version"]        ?? "1.0.0",
      appStatus:            s["app_status"]         ?? "active",
      supportPhone:         s["support_phone"]      ?? "03001234567",
      supportEmail:         s["support_email"]      ?? "",
      supportHours:         s["support_hours"]      ?? "Mon–Sat, 8AM–10PM",
      businessAddress:      s["business_address"]   ?? "Muzaffarabad, AJK, Pakistan",
      socialFacebook:       s["social_facebook"]    ?? "",
      socialInstagram:      s["social_instagram"]   ?? "",
    },
    features: {
      mart:         (s["feature_mart"]          ?? "on")  === "on",
      food:         (s["feature_food"]          ?? "on")  === "on",
      rides:        (s["feature_rides"]         ?? "on")  === "on",
      pharmacy:     (s["feature_pharmacy"]      ?? "on")  === "on",
      parcel:       (s["feature_parcel"]        ?? "on")  === "on",
      wallet:       walletEnabled,
      referral:     (s["feature_referral"]      ?? "on")  === "on",
      newUsers:     (s["feature_new_users"]     ?? "on")  === "on",
      chat:         (s["feature_chat"]          ?? "off") === "on",
      liveTracking: (s["feature_live_tracking"] ?? "on")  === "on",
      reviews:      (s["feature_reviews"]       ?? "on")  === "on",
    },
    content: {
      showBanner:       (s["content_show_banner"]        ?? "on")  === "on",
      banner:           s["content_banner"]              ?? "Free delivery on your first order! 🎉",
      announcement:     s["content_announcement"]        ?? "",
      maintenanceMsg:   s["content_maintenance_msg"]     ?? "We're performing scheduled maintenance. Back soon!",
      supportMsg:       s["content_support_msg"]         ?? "Need help? Chat with us!",
      vendorNotice:     s["content_vendor_notice"]       ?? "",
      riderNotice:      s["content_rider_notice"]        ?? "",
      tncUrl:           s["content_tnc_url"]             ?? "",
      privacyUrl:       s["content_privacy_url"]         ?? "",
      refundPolicyUrl:  s["content_refund_policy_url"]   ?? "",
      faqUrl:           s["content_faq_url"]             ?? "",
      aboutUrl:         s["content_about_url"]           ?? "",
    },
    security: {
      gpsTracking: (s["security_gps_tracking"] ?? "on")  === "on",
      otpBypass:   (s["security_otp_bypass"]   ?? "off") === "on",
      sessionDays: parseInt(s["security_session_days"] ?? "30"),
      rateLimit:   parseInt(s["security_rate_limit"]   ?? "100"),
      smsGateway:  s["api_sms_gateway"] ?? "console",
      mapKeySet:   (s["api_map_key"]     ?? "") !== "",
      firebaseSet: (s["api_firebase_key"] ?? "") !== "",
    },
    integrations: {
      jazzcash:  jazzcashEnabled,
      easypaisa: easypaisaEnabled,
      pushNotif: (s["integration_push_notif"] ?? "off") === "on",
      analytics: (s["integration_analytics"]  ?? "off") === "on",
      email:     (s["integration_email"]      ?? "off") === "on",
      sentry:    (s["integration_sentry"]     ?? "off") === "on",
      whatsapp:  (s["integration_whatsapp"]   ?? "off") === "on",
    },
    payment: {
      methods:      paymentMethods,
      currency:     "PKR",
      timeoutMins:  parseInt(s["payment_timeout_mins"] ?? "15"),
      minOnline:    parseFloat(s["payment_min_online"] ?? "50"),
      maxOnline:    parseFloat(s["payment_max_online"] ?? "100000"),
      autoCancelOn: (s["payment_auto_cancel"] ?? "on") === "on",
    },
  });
});

export default router;
