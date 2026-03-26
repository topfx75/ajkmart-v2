import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

const API = process.env.EXPO_PUBLIC_API_URL ?? "";
const CACHE_MS = 30_000;

export interface PlatformConfig {
  appStatus: "active" | "maintenance";
  features: {
    mart: boolean;
    food: boolean;
    rides: boolean;
    pharmacy: boolean;
    parcel: boolean;
    wallet: boolean;
    referral: boolean;
    newUsers: boolean;
    chat: boolean;
    liveTracking: boolean;
    reviews: boolean;
  };
  content: {
    showBanner: boolean;
    banner: string;
    announcement: string;
    maintenanceMsg: string;
    supportMsg: string;
    vendorNotice: string;
    riderNotice: string;
    tncUrl: string;
    privacyUrl: string;
    refundPolicyUrl: string;
    faqUrl: string;
    aboutUrl: string;
  };
  platform: {
    appName: string;
    appTagline: string;
    appVersion: string;
    supportPhone: string;
    supportEmail: string;
    supportHours: string;
    businessAddress: string;
    socialFacebook: string;
    socialInstagram: string;
  };
  orderRules: {
    minOrderAmount: number;
    maxCodAmount: number;
    maxCartValue: number;
    cancelWindowMin: number;
    autoCancelMin: number;
    refundDays: number;
    preptimeMin: number;
    ratingWindowHours: number;
    scheduleEnabled: boolean;
  };
  deliveryFee: {
    mart: number;
    food: number;
    pharmacy: number;
    parcel: number;
    parcelPerKg: number;
    freeEnabled: boolean;
    freeDeliveryAbove: number;
  };
  rides: {
    bikeBaseFare: number;
    bikePerKm: number;
    bikeMinFare: number;
    carBaseFare: number;
    carPerKm: number;
    carMinFare: number;
    surgeEnabled: boolean;
    surgeMultiplier: number;
    cancellationFee: number;
  };
  finance: {
    gstEnabled: boolean;
    gstPct: number;
    cashbackEnabled: boolean;
    cashbackPct: number;
    cashbackMaxRs: number;
    invoiceEnabled: boolean;
    platformCommissionPct: number;
    vendorCommissionPct: number;
    riderEarningPct: number;
    minVendorPayout: number;
    minRiderPayout: number;
    vendorSettleDays: number;
    referralBonus: number;
  };
  customer: {
    walletMax: number;
    minTopup: number;
    maxTopup: number;
    minTransfer: number;
    maxTransfer: number;
    dailyLimit: number;
    p2pDailyLimit: number;
    withdrawalProcessingDays: number;
    kycRequired: boolean;
    topupMethods: string;
    referralEnabled: boolean;
    referralBonus: number;
    loyaltyEnabled: boolean;
    loyaltyPtsPerRs100: number;
    maxOrdersDay: number;
    signupBonus: number;
    p2pEnabled: boolean;
    walletCashbackPct: number;
    walletCashbackOrders: boolean;
    walletCashbackRides: boolean;
    walletCashbackPharm: boolean;
  };
  integrations: {
    pushNotif: boolean;
    analytics: boolean;
    analyticsPlatform: string;
    analyticsTrackingId: string;
    analyticsDebug: boolean;
    sentry: boolean;
    sentryDsn: string;
    sentryEnvironment: string;
    sentrySampleRate: number;
    sentryTracesSampleRate: number;
    maps: boolean;
    mapsAutocomplete: boolean;
    mapsGeocoding: boolean;
    mapsDistanceMatrix: boolean;
    whatsapp: boolean;
    sms: boolean;
    email: boolean;
  };
}

const DEFAULT: PlatformConfig = {
  appStatus: "active",
  features: { mart: true, food: true, rides: true, pharmacy: true, parcel: true, wallet: true, referral: true, newUsers: true, chat: false, liveTracking: true, reviews: true },
  content: {
    showBanner:      true,
    banner:          "Free delivery on your first order! 🎉",
    announcement:    "",
    maintenanceMsg:  "We're performing scheduled maintenance. Back soon!",
    supportMsg:      "Need help? Chat with us!",
    vendorNotice:    "",
    riderNotice:     "",
    tncUrl:          "",
    privacyUrl:      "",
    refundPolicyUrl: "",
    faqUrl:          "",
    aboutUrl:        "",
  },
  platform: {
    appName: "AJKMart",
    appTagline: "Your super app for everything",
    appVersion: "1.0.0",
    supportPhone: "03001234567",
    supportEmail: "",
    supportHours: "Mon–Sat, 8AM–10PM",
    businessAddress: "Muzaffarabad, AJK, Pakistan",
    socialFacebook: "",
    socialInstagram: "",
  },
  orderRules: {
    minOrderAmount:    100,
    maxCodAmount:      5000,
    maxCartValue:      50000,
    cancelWindowMin:   5,
    autoCancelMin:     15,
    refundDays:        3,
    preptimeMin:       15,
    ratingWindowHours: 48,
    scheduleEnabled:   false,
  },
  deliveryFee: {
    mart: 80, food: 60, pharmacy: 50, parcel: 100,
    parcelPerKg: 40, freeEnabled: true, freeDeliveryAbove: 1000,
  },
  rides: {
    bikeBaseFare: 15, bikePerKm: 8, bikeMinFare: 50,
    carBaseFare: 25, carPerKm: 12, carMinFare: 80,
    surgeEnabled: false, surgeMultiplier: 1.5, cancellationFee: 30,
  },
  finance: {
    gstEnabled: false, gstPct: 17, cashbackEnabled: false, cashbackPct: 2, cashbackMaxRs: 100,
    invoiceEnabled: false, platformCommissionPct: 10, vendorCommissionPct: 15, riderEarningPct: 80,
    minVendorPayout: 500, minRiderPayout: 500, vendorSettleDays: 7, referralBonus: 100,
  },
  customer: {
    walletMax: 50000, minTopup: 100, maxTopup: 25000, minTransfer: 200, maxTransfer: 10000,
    dailyLimit: 20000, p2pDailyLimit: 10000, withdrawalProcessingDays: 2, kycRequired: false,
    topupMethods: "jazzcash,easypaisa,bank",
    referralEnabled: true, referralBonus: 100,
    loyaltyEnabled: true, loyaltyPtsPerRs100: 5,
    maxOrdersDay: 10, signupBonus: 0, p2pEnabled: true,
    walletCashbackPct: 0, walletCashbackOrders: true, walletCashbackRides: false, walletCashbackPharm: false,
  },
  integrations: {
    pushNotif: false, analytics: false, analyticsPlatform: "ga4", analyticsTrackingId: "", analyticsDebug: false,
    sentry: false, sentryDsn: "", sentryEnvironment: "production", sentrySampleRate: 1.0, sentryTracesSampleRate: 0.1,
    maps: false, mapsAutocomplete: true, mapsGeocoding: true, mapsDistanceMatrix: true,
    whatsapp: false, sms: false, email: false,
  },
};

interface Ctx {
  config: PlatformConfig;
  loading: boolean;
  refresh: () => void;
}

const PlatformConfigContext = createContext<Ctx>({
  config: DEFAULT,
  loading: false,
  refresh: () => {},
});

let _cached: PlatformConfig | null = null;
let _cachedAt = 0;

export function PlatformConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<PlatformConfig>(_cached ?? DEFAULT);
  const [loading, setLoading] = useState(!_cached);
  const fetchingRef = useRef(false);

  const fetchConfig = useCallback(async (force = false) => {
    if (fetchingRef.current) return;
    const now = Date.now();
    if (!force && _cached && now - _cachedAt < CACHE_MS) {
      setConfig(_cached);
      setLoading(false);
      return;
    }
    fetchingRef.current = true;
    try {
      const res = await fetch(`${API}/api/platform-config`, { cache: "no-store" });
      if (!res.ok) throw new Error("config fetch failed");
      const raw = await res.json();
      const parsed: PlatformConfig = {
        appStatus: raw.platform?.appStatus === "maintenance" ? "maintenance" : "active",
        features: {
          mart:         raw.features?.mart         ?? true,
          food:         raw.features?.food         ?? true,
          rides:        raw.features?.rides        ?? true,
          pharmacy:     raw.features?.pharmacy     ?? true,
          parcel:       raw.features?.parcel       ?? true,
          wallet:       raw.features?.wallet       ?? true,
          referral:     raw.features?.referral     ?? true,
          newUsers:     raw.features?.newUsers     ?? true,
          chat:         raw.features?.chat         ?? false,
          liveTracking: raw.features?.liveTracking ?? true,
          reviews:      raw.features?.reviews      ?? true,
        },
        content: {
          showBanner:      raw.content?.showBanner      ?? true,
          banner:          raw.content?.banner          ?? DEFAULT.content.banner,
          announcement:    raw.content?.announcement    ?? "",
          maintenanceMsg:  raw.content?.maintenanceMsg  ?? DEFAULT.content.maintenanceMsg,
          supportMsg:      raw.content?.supportMsg      ?? DEFAULT.content.supportMsg,
          vendorNotice:    raw.content?.vendorNotice    ?? "",
          riderNotice:     raw.content?.riderNotice     ?? "",
          tncUrl:          raw.content?.tncUrl          ?? "",
          privacyUrl:      raw.content?.privacyUrl      ?? "",
          refundPolicyUrl: raw.content?.refundPolicyUrl ?? "",
          faqUrl:          raw.content?.faqUrl          ?? "",
          aboutUrl:        raw.content?.aboutUrl        ?? "",
        },
        platform: {
          appName:         raw.platform?.appName         ?? DEFAULT.platform.appName,
          appTagline:      raw.platform?.appTagline      ?? DEFAULT.platform.appTagline,
          appVersion:      raw.platform?.appVersion      ?? DEFAULT.platform.appVersion,
          supportPhone:    raw.platform?.supportPhone    ?? DEFAULT.platform.supportPhone,
          supportEmail:    raw.platform?.supportEmail    ?? "",
          supportHours:    raw.platform?.supportHours    ?? DEFAULT.platform.supportHours,
          businessAddress: raw.platform?.businessAddress ?? DEFAULT.platform.businessAddress,
          socialFacebook:  raw.platform?.socialFacebook  ?? "",
          socialInstagram: raw.platform?.socialInstagram ?? "",
        },
        orderRules: {
          minOrderAmount:    raw.orderRules?.minOrderAmount    ?? DEFAULT.orderRules.minOrderAmount,
          maxCodAmount:      raw.orderRules?.maxCodAmount      ?? DEFAULT.orderRules.maxCodAmount,
          maxCartValue:      raw.orderRules?.maxCartValue      ?? DEFAULT.orderRules.maxCartValue,
          cancelWindowMin:   raw.orderRules?.cancelWindowMin   ?? DEFAULT.orderRules.cancelWindowMin,
          autoCancelMin:     raw.orderRules?.autoCancelMin     ?? DEFAULT.orderRules.autoCancelMin,
          refundDays:        raw.orderRules?.refundDays        ?? DEFAULT.orderRules.refundDays,
          preptimeMin:       raw.orderRules?.preptimeMin       ?? DEFAULT.orderRules.preptimeMin,
          ratingWindowHours: raw.orderRules?.ratingWindowHours ?? DEFAULT.orderRules.ratingWindowHours,
          scheduleEnabled:   raw.orderRules?.scheduleEnabled   ?? DEFAULT.orderRules.scheduleEnabled,
        },
        deliveryFee: {
          mart:             raw.deliveryFee?.mart              ?? DEFAULT.deliveryFee.mart,
          food:             raw.deliveryFee?.food              ?? DEFAULT.deliveryFee.food,
          pharmacy:         raw.deliveryFee?.pharmacy          ?? DEFAULT.deliveryFee.pharmacy,
          parcel:           raw.deliveryFee?.parcel            ?? DEFAULT.deliveryFee.parcel,
          parcelPerKg:      raw.deliveryFee?.parcelPerKg       ?? DEFAULT.deliveryFee.parcelPerKg,
          freeEnabled:      raw.deliveryFee?.freeEnabled       ?? DEFAULT.deliveryFee.freeEnabled,
          freeDeliveryAbove: raw.deliveryFee?.freeDeliveryAbove ?? raw.platform?.freeDeliveryAbove ?? DEFAULT.deliveryFee.freeDeliveryAbove,
        },
        rides: {
          bikeBaseFare:    raw.rides?.bikeBaseFare    ?? DEFAULT.rides.bikeBaseFare,
          bikePerKm:       raw.rides?.bikePerKm       ?? DEFAULT.rides.bikePerKm,
          bikeMinFare:     raw.rides?.bikeMinFare     ?? DEFAULT.rides.bikeMinFare,
          carBaseFare:     raw.rides?.carBaseFare     ?? DEFAULT.rides.carBaseFare,
          carPerKm:        raw.rides?.carPerKm        ?? DEFAULT.rides.carPerKm,
          carMinFare:      raw.rides?.carMinFare      ?? DEFAULT.rides.carMinFare,
          surgeEnabled:    raw.rides?.surgeEnabled    ?? DEFAULT.rides.surgeEnabled,
          surgeMultiplier: raw.rides?.surgeMultiplier ?? DEFAULT.rides.surgeMultiplier,
          cancellationFee: raw.rides?.cancellationFee ?? DEFAULT.rides.cancellationFee,
        },
        finance: {
          gstEnabled:           raw.finance?.gstEnabled           ?? DEFAULT.finance.gstEnabled,
          gstPct:               raw.finance?.gstPct               ?? DEFAULT.finance.gstPct,
          cashbackEnabled:      raw.finance?.cashbackEnabled      ?? DEFAULT.finance.cashbackEnabled,
          cashbackPct:          raw.finance?.cashbackPct          ?? DEFAULT.finance.cashbackPct,
          cashbackMaxRs:        raw.finance?.cashbackMaxRs        ?? DEFAULT.finance.cashbackMaxRs,
          invoiceEnabled:       raw.finance?.invoiceEnabled       ?? DEFAULT.finance.invoiceEnabled,
          platformCommissionPct:raw.finance?.platformCommissionPct?? DEFAULT.finance.platformCommissionPct,
          vendorCommissionPct:  raw.finance?.vendorCommissionPct  ?? DEFAULT.finance.vendorCommissionPct,
          riderEarningPct:      raw.finance?.riderEarningPct      ?? DEFAULT.finance.riderEarningPct,
          minVendorPayout:      raw.finance?.minVendorPayout      ?? DEFAULT.finance.minVendorPayout,
          minRiderPayout:       raw.finance?.minRiderPayout       ?? DEFAULT.finance.minRiderPayout,
          vendorSettleDays:     raw.finance?.vendorSettleDays     ?? DEFAULT.finance.vendorSettleDays,
          referralBonus:        raw.finance?.referralBonus        ?? DEFAULT.finance.referralBonus,
        },
        customer: {
          walletMax:                raw.customer?.walletMax                ?? DEFAULT.customer.walletMax,
          minTopup:                 raw.customer?.minTopup                 ?? DEFAULT.customer.minTopup,
          maxTopup:                 raw.customer?.maxTopup                 ?? DEFAULT.customer.maxTopup,
          minTransfer:              raw.customer?.minTransfer              ?? DEFAULT.customer.minTransfer,
          maxTransfer:              raw.customer?.maxTransfer              ?? DEFAULT.customer.maxTransfer,
          dailyLimit:               raw.customer?.dailyLimit               ?? DEFAULT.customer.dailyLimit,
          p2pDailyLimit:            raw.customer?.p2pDailyLimit            ?? DEFAULT.customer.p2pDailyLimit,
          withdrawalProcessingDays: raw.customer?.withdrawalProcessingDays ?? DEFAULT.customer.withdrawalProcessingDays,
          kycRequired:              raw.customer?.kycRequired              ?? DEFAULT.customer.kycRequired,
          topupMethods:             raw.customer?.topupMethods             ?? DEFAULT.customer.topupMethods,
          referralEnabled:          raw.customer?.referralEnabled          ?? DEFAULT.customer.referralEnabled,
          referralBonus:            raw.customer?.referralBonus            ?? DEFAULT.customer.referralBonus,
          loyaltyEnabled:           raw.customer?.loyaltyEnabled           ?? DEFAULT.customer.loyaltyEnabled,
          loyaltyPtsPerRs100:       raw.customer?.loyaltyPtsPerRs100       ?? DEFAULT.customer.loyaltyPtsPerRs100,
          maxOrdersDay:             raw.customer?.maxOrdersDay             ?? DEFAULT.customer.maxOrdersDay,
          signupBonus:              raw.customer?.signupBonus              ?? DEFAULT.customer.signupBonus,
          p2pEnabled:               raw.customer?.p2pEnabled               ?? DEFAULT.customer.p2pEnabled,
          walletCashbackPct:        raw.payment?.walletCashbackPct         ?? DEFAULT.customer.walletCashbackPct,
          walletCashbackOrders:     raw.payment?.walletCashbackOrders      ?? DEFAULT.customer.walletCashbackOrders,
          walletCashbackRides:      raw.payment?.walletCashbackRides       ?? DEFAULT.customer.walletCashbackRides,
          walletCashbackPharm:      raw.payment?.walletCashbackPharm       ?? DEFAULT.customer.walletCashbackPharm,
        },
        integrations: {
          pushNotif:             raw.integrations?.pushNotif             ?? DEFAULT.integrations.pushNotif,
          analytics:             raw.integrations?.analytics             ?? DEFAULT.integrations.analytics,
          analyticsPlatform:     raw.integrations?.analyticsPlatform     ?? DEFAULT.integrations.analyticsPlatform,
          analyticsTrackingId:   raw.integrations?.analyticsTrackingId   ?? DEFAULT.integrations.analyticsTrackingId,
          analyticsDebug:        raw.integrations?.analyticsDebug        ?? DEFAULT.integrations.analyticsDebug,
          sentry:                raw.integrations?.sentry                ?? DEFAULT.integrations.sentry,
          sentryDsn:             raw.integrations?.sentryDsn             ?? DEFAULT.integrations.sentryDsn,
          sentryEnvironment:     raw.integrations?.sentryEnvironment     ?? DEFAULT.integrations.sentryEnvironment,
          sentrySampleRate:      raw.integrations?.sentrySampleRate      ?? DEFAULT.integrations.sentrySampleRate,
          sentryTracesSampleRate:raw.integrations?.sentryTracesSampleRate?? DEFAULT.integrations.sentryTracesSampleRate,
          maps:                  raw.integrations?.maps                  ?? DEFAULT.integrations.maps,
          mapsAutocomplete:      raw.integrations?.mapsAutocomplete      ?? DEFAULT.integrations.mapsAutocomplete,
          mapsGeocoding:         raw.integrations?.mapsGeocoding         ?? DEFAULT.integrations.mapsGeocoding,
          mapsDistanceMatrix:    raw.integrations?.mapsDistanceMatrix     ?? DEFAULT.integrations.mapsDistanceMatrix,
          whatsapp:              raw.integrations?.whatsapp              ?? DEFAULT.integrations.whatsapp,
          sms:                   raw.integrations?.sms                  ?? DEFAULT.integrations.sms,
          email:                 raw.integrations?.email                 ?? DEFAULT.integrations.email,
        },
      };
      _cached = parsed;
      _cachedAt = Date.now();
      setConfig(parsed);
    } catch {
      if (_cached) setConfig(_cached);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    const interval = setInterval(() => fetchConfig(), CACHE_MS);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") fetchConfig(true);
    });
    return () => { clearInterval(interval); sub.remove(); };
  }, [fetchConfig]);

  const refresh = useCallback(() => fetchConfig(true), [fetchConfig]);

  return (
    <PlatformConfigContext.Provider value={{ config, loading, refresh }}>
      {children}
    </PlatformConfigContext.Provider>
  );
}

export function usePlatformConfig() {
  return useContext(PlatformConfigContext);
}
