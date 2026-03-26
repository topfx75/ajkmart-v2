import { Router, type IRouter } from "express";
import { getPlatformSettings } from "./admin.js";

const router: IRouter = Router();

// Public endpoint — all client apps fetch this for config + feature flags
router.get("/", async (req, res) => {
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
      mart:             parseFloat(s["delivery_fee_mart"]      ?? "80"),
      food:             parseFloat(s["delivery_fee_food"]      ?? "60"),
      pharmacy:         parseFloat(s["delivery_fee_pharmacy"]  ?? "50"),
      parcel:           parseFloat(s["delivery_fee_parcel"]    ?? "100"),
      parcelPerKg:      parseFloat(s["delivery_parcel_per_kg"] ?? "40"),
      freeEnabled:      (s["delivery_free_enabled"]            ?? "on") === "on",
      freeDeliveryAbove: parseFloat(s["free_delivery_above"]   ?? "1000"),
    },
    rides: {
      bikeBaseFare:      parseFloat(s["ride_bike_base_fare"]   ?? "15"),
      bikePerKm:         parseFloat(s["ride_bike_per_km"]      ?? "8"),
      bikeMinFare:       parseFloat(s["ride_bike_min_fare"]    ?? "50"),
      carBaseFare:       parseFloat(s["ride_car_base_fare"]    ?? "25"),
      carPerKm:          parseFloat(s["ride_car_per_km"]       ?? "12"),
      carMinFare:        parseFloat(s["ride_car_min_fare"]     ?? "80"),
      surgeEnabled:      (s["ride_surge_enabled"]              ?? "off") === "on",
      surgeMultiplier:   parseFloat(s["ride_surge_multiplier"] ?? "1.5"),
      cancellationFee:   parseFloat(s["ride_cancellation_fee"] ?? "30"),
      riderEarningPct:   parseFloat(s["rider_keep_pct"]        ?? "80"),
    },
    platform: {
      commissionPct:        parseFloat(s["platform_commission_pct"] ?? "10"),
      vendorCommissionPct:  parseFloat(s["vendor_commission_pct"]   ?? "15"),
      minOrderAmount:       parseFloat(s["min_order_amount"]         ?? "100"),
      maxCodAmount:         parseFloat(s["cod_max_amount"]           ?? "5000"),
      freeDeliveryAbove:    parseFloat(s["free_delivery_above"]      ?? "1000"),
      appName:              s["app_name"]           ?? "AJKMart",
      appTagline:           s["app_tagline"]        ?? "Your super app for everything",
      appVersion:           s["app_version"]        ?? "1.0.0",
      appStatus:            (() => {
        const base = s["app_status"] ?? "active";
        if (base !== "maintenance") return base;
        const key = (s["security_maintenance_key"] ?? "").trim();
        const bypass = ((req.headers["x-maintenance-key"] as string) ?? "").trim();
        return (key && bypass === key) ? "active" : "maintenance";
      })(),
      supportPhone:         s["support_phone"]      ?? "03001234567",
      supportEmail:         s["support_email"]      ?? "",
      supportHours:         s["support_hours"]      ?? "Mon–Sat, 8AM–10PM",
      businessAddress:      s["business_address"]   ?? "Muzaffarabad, AJK, Pakistan",
      socialFacebook:       s["social_facebook"]    ?? "",
      socialInstagram:      s["social_instagram"]   ?? "",
    },
    orderRules: {
      minOrderAmount:    parseFloat(s["min_order_amount"]          ?? "100"),
      maxCodAmount:      parseFloat(s["cod_max_amount"]            ?? "5000"),
      maxCartValue:      parseFloat(s["order_max_cart_value"]      ?? "50000"),
      cancelWindowMin:   parseInt(s["order_cancel_window_min"]     ?? "5"),
      autoCancelMin:     parseInt(s["order_auto_cancel_min"]       ?? "15"),
      refundDays:        parseInt(s["order_refund_days"]           ?? "3"),
      preptimeMin:       parseInt(s["order_preptime_min"]          ?? "15"),
      ratingWindowHours: parseInt(s["order_rating_window_hours"]   ?? "48"),
      scheduleEnabled:   (s["order_schedule_enabled"]              ?? "off") === "on",
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
    finance: {
      gstEnabled:       (s["finance_gst_enabled"]      ?? "off") === "on",
      gstPct:           parseFloat(s["finance_gst_pct"]           ?? "17"),
      cashbackEnabled:  (s["finance_cashback_enabled"]  ?? "off") === "on",
      cashbackPct:      parseFloat(s["finance_cashback_pct"]       ?? "2"),
      cashbackMaxRs:    parseFloat(s["finance_cashback_max_rs"]    ?? "100"),
      invoiceEnabled:   (s["finance_invoice_enabled"]   ?? "off") === "on",
      platformCommissionPct: parseFloat(s["platform_commission_pct"] ?? "10"),
      vendorCommissionPct:   parseFloat(s["vendor_commission_pct"]   ?? "15"),
      riderEarningPct:       parseFloat(s["rider_keep_pct"]          ?? "80"),
      minVendorPayout:       parseFloat(s["vendor_min_payout"]          ?? "500"),
      minRiderPayout:        parseFloat(s["rider_min_payout"]        ?? "500"),
      vendorSettleDays:      parseInt(s["vendor_settlement_days"]    ?? "7"),
      referralBonus:         parseFloat(s["customer_referral_bonus"] ?? "100"),
    },
    customer: {
      walletMax:                parseFloat(s["wallet_max_balance"]          ?? "50000"),
      minTopup:                 parseFloat(s["wallet_min_topup"]            ?? "100"),
      maxTopup:                 parseFloat(s["wallet_max_topup"]            ?? "25000"),
      minTransfer:              parseFloat(s["wallet_min_withdrawal"]       ?? "200"),
      maxTransfer:              parseFloat(s["wallet_max_withdrawal"]       ?? "10000"),
      dailyLimit:               parseFloat(s["wallet_daily_limit"]          ?? "20000"),
      p2pDailyLimit:            parseFloat(s["wallet_p2p_daily_limit"]      ?? "10000"),
      withdrawalProcessingDays: parseInt(s["wallet_withdrawal_processing"]  ?? "2"),
      kycRequired:              (s["wallet_kyc_required"]                   ?? "off") === "on",
      topupMethods:             (s["wallet_topup_methods"]                  ?? "jazzcash,easypaisa,bank"),
      referralEnabled:          (s["customer_referral_enabled"]             ?? "on") === "on",
      referralBonus:            parseFloat(s["customer_referral_bonus"]     ?? "100"),
      loyaltyEnabled:           (s["customer_loyalty_enabled"]              ?? "on") === "on",
      loyaltyPtsPerRs100:       parseFloat(s["customer_loyalty_pts"]        ?? "5"),
      maxOrdersDay:             parseInt(s["customer_max_orders_day"]       ?? "10"),
      signupBonus:              parseFloat(s["customer_signup_bonus"]       ?? "0"),
      p2pEnabled:               (s["wallet_p2p_enabled"]                    ?? "on") === "on",
    },
    rider: {
      keepPct:            parseFloat(s["rider_keep_pct"]            ?? "80"),
      bonusPerTrip:       parseFloat(s["rider_bonus_per_trip"]      ?? "0"),
      minPayout:          parseFloat(s["rider_min_payout"]          ?? "500"),
      maxPayout:          parseFloat(s["rider_max_payout"]          ?? "50000"),
      maxDeliveries:      parseInt(s["rider_max_deliveries"]        ?? "3"),
      cashAllowed:        (s["rider_cash_allowed"]                  ?? "on")  === "on",
      withdrawalEnabled:  (s["rider_withdrawal_enabled"]            ?? "on")  === "on",
      autoApprove:        (s["rider_auto_approve"]                  ?? "off") === "on",
    },
    vendor: {
      commissionPct:      parseFloat(s["vendor_commission_pct"]     ?? "15"),
      settleDays:         parseInt(s["vendor_settlement_days"]       ?? "7"),
      minPayout:          parseFloat(s["vendor_min_payout"]          ?? "500"),
      maxPayout:          parseFloat(s["vendor_max_payout"]          ?? "50000"),
      minOrder:           parseFloat(s["vendor_min_order"]           ?? "100"),
      maxItems:           parseInt(s["vendor_max_items"]             ?? "100"),
      autoApprove:        (s["vendor_auto_approve"]                  ?? "off") === "on",
      promoEnabled:       (s["vendor_promo_enabled"]                 ?? "on")  === "on",
      withdrawalEnabled:  (s["vendor_withdrawal_enabled"]            ?? "on")  === "on",
    },
    security: {
      gpsTracking:  (s["security_gps_tracking"] ?? "on")  === "on",
      gpsInterval:  parseInt(s["security_gps_interval"]  ?? "30"),
      otpBypass:    (s["security_otp_bypass"]   ?? "off") === "on",
      sessionDays:  parseInt(s["security_session_days"]  ?? "30"),
      riderTokenDays: parseInt(s["security_rider_token_days"] ?? "7"),
      rateLimit:    parseInt(s["security_rate_limit"]    ?? "100"),
      smsGateway:   s["sms_provider"]   ?? "console",
      mapKeySet:    (s["maps_api_key"]  ?? "") !== "",
      firebaseSet:  (s["fcm_server_key"] ?? "") !== "",
    },
    integrations: {
      jazzcash:  jazzcashEnabled,
      easypaisa: easypaisaEnabled,
      pushNotif: (s["integration_push_notif"] ?? "off") === "on",
      analytics: (s["integration_analytics"]  ?? "off") === "on",
      email:     (s["integration_email"]      ?? "off") === "on",
      sentry:    (s["integration_sentry"]     ?? "off") === "on",
      whatsapp:  (s["integration_whatsapp"]   ?? "off") === "on",
      sms:       (s["integration_sms"]        ?? "off") === "on",
      maps:      (s["integration_maps"]       ?? "off") === "on",
      analyticsPlatform:    s["analytics_platform"]      ?? "ga4",
      analyticsTrackingId:  s["analytics_tracking_id"]  ?? "",
      analyticsDebug:       (s["analytics_debug_mode"]  ?? "off") === "on",
      sentryDsn:            s["sentry_dsn"]              ?? "",
      sentryEnvironment:    s["sentry_environment"]      ?? "production",
      sentrySampleRate:     parseFloat(s["sentry_sample_rate"]        ?? "1.0"),
      sentryTracesSampleRate: parseFloat(s["sentry_traces_sample_rate"] ?? "0.1"),
      mapsAutocomplete:     (s["maps_places_autocomplete"] ?? "on") === "on",
      mapsGeocoding:        (s["maps_geocoding"]           ?? "on") === "on",
      mapsDistanceMatrix:   (s["maps_distance_matrix"]     ?? "on") === "on",
    },
    payment: {
      methods:              paymentMethods,
      currency:             "PKR",
      timeoutMins:          parseInt(s["payment_timeout_mins"] ?? "15"),
      minOnline:            parseFloat(s["payment_min_online"] ?? "50"),
      maxOnline:            parseFloat(s["payment_max_online"] ?? "100000"),
      autoCancelOn:         (s["payment_auto_cancel"]          ?? "on") === "on",
      walletCashbackPct:    parseFloat(s["wallet_cashback_pct"]            ?? "0"),
      walletCashbackOrders: (s["wallet_cashback_on_orders"]    ?? "on")  === "on",
      walletCashbackRides:  (s["wallet_cashback_on_rides"]     ?? "off") === "on",
      walletCashbackPharm:  (s["wallet_cashback_on_pharmacy"]  ?? "off") === "on",
    },
  });
});

export default router;
