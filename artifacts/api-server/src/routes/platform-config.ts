import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { serviceZonesTable, supportedPaymentMethodsTable } from "@workspace/db/schema";
import { eq, asc } from "drizzle-orm";
import { getPlatformSettings } from "./admin.js";
import { sendSuccess } from "../lib/response.js";

const router: IRouter = Router();

// Public endpoint — all client apps fetch this for config + feature flags
router.get("/", async (req, res) => {
  const [s, zoneRows, pmRows] = await Promise.all([
    getPlatformSettings(),
    db.select({ city: serviceZonesTable.city })
      .from(serviceZonesTable)
      .where(eq(serviceZonesTable.isActive, true))
      .orderBy(asc(serviceZonesTable.city))
      .catch(() => [] as Array<{ city: string }>),
    db.select()
      .from(supportedPaymentMethodsTable)
      .where(eq(supportedPaymentMethodsTable.isActive, true))
      .orderBy(asc(supportedPaymentMethodsTable.sortOrder))
      .catch(() => [] as typeof supportedPaymentMethodsTable.$inferSelect[]),
  ]);

  /* Derive unique sorted city list from service_zones */
  const citySet = new Set<string>();
  for (const row of zoneRows) {
    if (row.city) citySet.add(row.city);
  }
  let dbCities = Array.from(citySet).sort();

  /* Fallback chain: service_zones → service_cities setting → built-in default */
  if (dbCities.length === 0) {
    const raw = s["service_cities"] ?? "";
    if (raw.trim()) {
      dbCities = raw.split(",").map((c: string) => c.trim()).filter(Boolean);
    }
  }

  const jazzcashEnabled  = (s["jazzcash_enabled"]  ?? "off") === "on";
  const easypaisaEnabled = (s["easypaisa_enabled"] ?? "off") === "on";
  const bankEnabled      = (s["bank_enabled"]      ?? "off") === "on";
  const walletEnabled    = (s["feature_wallet"]    ?? "on")  === "on";
  const appName          = s["app_name"] ?? "AJKMart";

  /* Platform-settings availability overlay keyed by method id */
  const availabilityMap: Record<string, boolean> = {
    cash:      true,
    wallet:    walletEnabled,
    jazzcash:  jazzcashEnabled,
    easypaisa: easypaisaEnabled,
    bank:      bankEnabled,
  };

  /* Mode overlay for gateway methods */
  const modeMap: Record<string, string> = {
    jazzcash:  s["jazzcash_mode"]  ?? "sandbox",
    easypaisa: s["easypaisa_mode"] ?? "sandbox",
  };

  /* Logo map */
  const logoMap: Record<string, string> = {
    cash: "💵", wallet: "💰", jazzcash: "🔴", easypaisa: "🟢", bank: "🏦",
  };

  /* Build payment methods list from DB rows, applying availability overlay */
  const paymentMethods = pmRows.length > 0
    ? pmRows.map(m => ({
        id:          m.id,
        label:       m.id === "wallet" ? `${appName} Wallet` : m.label,
        logo:        logoMap[m.id] ?? "💳",
        available:   availabilityMap[m.id] ?? true,
        mode:        modeMap[m.id] ?? "live",
        description: m.description,
      }))
    : /* Fallback if DB table not yet populated */
      [
        { id: "cash",      label: "Cash on Delivery",    logo: "💵", available: true,             mode: "live",                        description: "Delivery par payment karein" },
        { id: "wallet",    label: `${appName} Wallet`,   logo: "💰", available: walletEnabled,     mode: "live",                        description: "Apni wallet se instant pay karein" },
        { id: "jazzcash",  label: "JazzCash",            logo: "🔴", available: jazzcashEnabled,   mode: modeMap["jazzcash"]  ?? "sandbox", description: "JazzCash mobile wallet" },
        { id: "easypaisa", label: "EasyPaisa",           logo: "🟢", available: easypaisaEnabled,  mode: modeMap["easypaisa"] ?? "sandbox", description: "EasyPaisa mobile wallet" },
        { id: "bank",      label: "Bank Transfer",       logo: "🏦", available: bankEnabled,       mode: "live",                        description: "Direct bank account transfer" },
      ];

  sendSuccess(res, {
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
      surgeEnabled:       (s["ride_surge_enabled"]              ?? "off") === "on",
      surgeMultiplier:    parseFloat(s["ride_surge_multiplier"] ?? "1.5"),
      cancellationFee:    parseFloat(s["ride_cancellation_fee"] ?? "30"),
      cancelGraceSec:     parseInt(s["ride_cancel_grace_sec"]   ?? "180", 10),
      riderEarningPct:    (Number(s["rider_keep_pct"]) || 80),
      bargainingEnabled:  (s["ride_bargaining_enabled"]         ?? "on")  === "on",
      bargainingMinPct:   parseFloat(s["ride_bargaining_min_pct"]    ?? "70"),
      bargainingMaxRounds:parseInt(s["ride_bargaining_max_rounds"]   ?? "3", 10),
    },
    language: (() => {
      const defaultLang = s["default_language"] ?? "en";
      let enabledLangs: string[];
      try { enabledLangs = JSON.parse(s["enabled_languages"] ?? "[]") as string[]; }
      catch { enabledLangs = ["en"]; }
      if (!enabledLangs.length) enabledLangs = ["en"];
      return { defaultLanguage: defaultLang, enabledLanguages: enabledLangs };
    })(),
    platform: {
      commissionPct:        parseFloat(s["platform_commission_pct"] ?? "10"),
      vendorCommissionPct:  parseFloat(s["vendor_commission_pct"]   ?? "15"),
      minOrderAmount:       parseFloat(s["min_order_amount"]         ?? "100"),
      maxCodAmount:         parseFloat(s["cod_max_amount"]           ?? "5000"),
      freeDeliveryAbove:    parseFloat(s["free_delivery_above"]      ?? "1000"),
      appName:              s["app_name"]           ?? "AJKMart",
      appTagline:           s["app_tagline"]        ?? "Your super app for everything",
      appVersion:           s["app_version"]        ?? "1.0.0",
      logoUrl:              s["app_logo_url"]       ?? "",
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
    deliveryAccessMode: s["delivery_access_mode"] ?? "all",
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
      sos:          (s["feature_sos"]           ?? "on")  === "on",
      weather:      (s["feature_weather"]       ?? "on")  === "on",
    },
    content: {
      trackerBannerEnabled: (s["content_tracker_banner_enabled"] ?? "on") === "on",
      trackerBannerPosition: (s["content_tracker_banner_position"] === "bottom" ? "bottom" : "top") as "top" | "bottom",
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
      riderEarningPct:       (Number(s["rider_keep_pct"]) || 80),
      minVendorPayout:       parseFloat(s["vendor_min_payout"]          ?? "500"),
      minRiderPayout:        parseFloat(s["rider_min_payout"]        ?? "500"),
      vendorSettleDays:      parseInt(s["vendor_settlement_days"]    ?? "7"),
      referralBonus:         parseFloat(s["customer_referral_bonus"] ?? "100"),
    },
    customer: {
      walletMax:                parseFloat(s["wallet_max_balance"]          ?? "50000"),
      minTopup:                 parseFloat(s["wallet_min_topup"]            ?? "100"),
      maxTopup:                 parseFloat(s["wallet_max_topup"]            ?? "25000"),
      minWithdrawal:            parseFloat(s["wallet_min_withdrawal"]       ?? "200"),
      maxWithdrawal:            parseFloat(s["wallet_max_withdrawal"]       ?? "10000"),
      minTransfer:              parseFloat(s["wallet_min_withdrawal"]       ?? "200"),
      maxTransfer:              parseFloat(s["wallet_max_withdrawal"]       ?? "10000"),
      dailyLimit:               parseFloat(s["wallet_daily_limit"]          ?? "20000"),
      p2pDailyLimit:            parseFloat(s["wallet_p2p_daily_limit"]      ?? "10000"),
      withdrawalProcessingHours: parseInt(s["wallet_withdrawal_processing"]  ?? "24"),
      withdrawalProcessingDays: Math.ceil(parseInt(s["wallet_withdrawal_processing"]  ?? "24") / 24),
      kycRequired:              (s["wallet_kyc_required"]                   ?? "off") === "on",
      topupMethods:             (s["wallet_topup_methods"]                  ?? "jazzcash,easypaisa,bank"),
      referralEnabled:          (s["customer_referral_enabled"]             ?? "on") === "on",
      referralBonus:            parseFloat(s["customer_referral_bonus"]     ?? "100"),
      loyaltyEnabled:           (s["customer_loyalty_enabled"]              ?? "on") === "on",
      loyaltyPtsPerRs100:       parseFloat(s["customer_loyalty_pts"]        ?? "5"),
      maxOrdersDay:             parseInt(s["customer_max_orders_day"]       ?? "10"),
      signupBonus:              parseFloat(s["customer_signup_bonus"]       ?? "0"),
      p2pEnabled:               (s["wallet_p2p_enabled"]                    ?? "on") === "on",
      p2pFeePct:                parseFloat(s["wallet_p2p_fee_pct"]                ?? "0"),
      depositAutoApprove:       parseFloat(s["wallet_deposit_auto_approve"]        ?? "0"),
      mpinEnabled:              (s["wallet_mpin_enabled"]                          ?? "on") === "on",
    },
    rider: {
      keepPct:            (Number(s["rider_keep_pct"]) || 80),
      bonusPerTrip:       parseFloat(s["rider_bonus_per_trip"]      ?? "0"),
      minPayout:          parseFloat(s["rider_min_payout"]          ?? "500"),
      maxPayout:          parseFloat(s["rider_max_payout"]          ?? "50000"),
      maxDeliveries:      parseInt(s["rider_max_deliveries"]        ?? "3"),
      cashAllowed:        (s["rider_cash_allowed"]                  ?? "on")  === "on",
      withdrawalEnabled:  (s["rider_withdrawal_enabled"]            ?? "on")  === "on",
      autoApprove:        (s["rider_auto_approve"]                  ?? "off") === "on",
      minBalance:         parseFloat(s["rider_min_balance"]         ?? "500"),
      depositEnabled:     (s["rider_deposit_enabled"]               ?? "on")  === "on",
      dailyGoal:          parseFloat(s["rider_daily_goal"]            ?? "5000"),
      modules: {
        wallet:       (s["rider_module_wallet"]         ?? "on")  === "on",
        earnings:     (s["rider_module_earnings"]        ?? "on")  === "on",
        history:      (s["rider_module_history"]         ?? "on")  === "on",
        twoFaRequired:(s["rider_module_2fa_required"]    ?? "off") === "on",
        gpsTracking:  (s["rider_module_gps_tracking"]    ?? "on")  === "on",
        profileEdit:  (s["rider_module_profile_edit"]    ?? "on")  === "on",
        supportChat:  (s["rider_module_support_chat"]    ?? "on")  === "on",
      },
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
      deliveryTimeMax:    parseInt(s["vendor_delivery_time_max"]     ?? "120"),
      deliveryTimeDefault: parseInt(s["vendor_delivery_time_default"] ?? "45"),
    },
    security: {
      gpsTracking:    (s["security_gps_tracking"]   ?? "on")  === "on",
      gpsInterval:    parseInt(s["security_gps_interval"]     ?? "10"),
      gpsAccuracy:    parseInt(s["security_gps_accuracy"]     ?? "50"),
      geoFence:       (s["security_geo_fence"]       ?? "off") === "on",
      spoofDetection: (s["security_spoof_detection"] ?? "on")  === "on",
      maxSpeedKmh:    parseInt(s["security_max_speed_kmh"]    ?? "150"),
      sessionDays:    parseInt(s["security_session_days"]     ?? "30"),
      riderTokenDays: parseInt(s["security_rider_token_days"] ?? "30"),
      rateLimit:      parseInt(s["security_rate_limit"]       ?? "100"),
      smsGateway:     s["sms_provider"]  ?? "console",
      mapKeySet:      (s["maps_api_key"] ?? "") !== "",
      firebaseSet:    (s["fcm_server_key"] ?? "") !== "",
      orderGpsCaptureEnabled: (s["order_gps_capture_enabled"] ?? "off") === "on",
      gpsMismatchThresholdM:  parseInt(s["gps_mismatch_threshold_m"] ?? "500"),
    },
    profile: {
      showSavedAddresses: (s["profile_show_saved_addresses"] ?? "on") === "on",
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
      sentrySampleRate:     parseFloat(s["sentry_sample_rate"]        ?? "100") / 100,
      sentryTracesSampleRate: parseFloat(s["sentry_traces_sample_rate"] ?? "10") / 100,
      mapsAutocomplete:     (s["maps_places_autocomplete"] ?? "on") === "on",
      mapsGeocoding:        (s["maps_geocoding"]           ?? "on") === "on",
      mapsDistanceMatrix:   (s["maps_distance_matrix"]     ?? "on") === "on",
    },
    auth: (() => {
      function parseAuthToggle(val: string | undefined, _fallback: string): Record<string, boolean> | boolean {
        if (!val) return false;
        try {
          const parsed = JSON.parse(val) as Record<string, string>;
          return { customer: parsed.customer === "on", rider: parsed.rider === "on", vendor: parsed.vendor === "on" };
        } catch {
          return val === "on";
        }
      }
      return {
        phoneOtpEnabled:        parseAuthToggle(s["auth_phone_otp_enabled"], "on"),
        emailOtpEnabled:        parseAuthToggle(s["auth_email_otp_enabled"], "on"),
        usernamePasswordEnabled: parseAuthToggle(s["auth_username_password_enabled"], "on"),
        googleEnabled:          parseAuthToggle(s["auth_google_enabled"], "off"),
        facebookEnabled:        parseAuthToggle(s["auth_facebook_enabled"], "off"),
        emailRegisterEnabled:   parseAuthToggle(s["auth_email_register_enabled"], "on"),
        biometricEnabled:       parseAuthToggle(s["auth_biometric_enabled"], "off"),
        captchaEnabled:         (s["auth_captcha_enabled"] ?? "off") === "on",
        twoFactorEnabled:       parseAuthToggle(s["auth_2fa_enabled"], "off"),
        magicLinkEnabled:       parseAuthToggle(s["auth_magic_link_enabled"], "off"),
        captchaSiteKey:         s["recaptcha_site_key"] ?? "",
        lockoutEnabled:         (s["security_lockout_enabled"] ?? "on") === "on",
        lockoutMaxAttempts:     parseInt(s["security_login_max_attempts"] ?? "5", 10),
        lockoutDurationSec:     parseInt(s["security_lockout_minutes"] ?? "30", 10) * 60,
        googleClientId:         s["google_client_id"] ?? "",
        facebookAppId:          s["facebook_app_id"] ?? "",
      };
    })(),
    cities: dbCities.length > 0 ? dbCities : ["Muzaffarabad","Mirpur","Rawalakot","Bagh","Kotli","Bhimber","Poonch","Neelum Valley","Rawalpindi","Islamabad"],
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

