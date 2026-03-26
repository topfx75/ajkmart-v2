import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./api";

export interface PlatformConfig {
  rider?: {
    keepPct: number;
    bonusPerTrip: number;
    minPayout: number;
    maxPayout: number;
    maxDeliveries: number;
    cashAllowed: boolean;
    withdrawalEnabled: boolean;
    autoApprove: boolean;
  };
  platform: {
    appName: string;
    appTagline: string;
    appVersion: string;
    appStatus: "active" | "maintenance";
    supportPhone: string;
    supportEmail: string;
    supportHours: string;
    businessAddress: string;
    socialFacebook: string;
    socialInstagram: string;
    commissionPct: number;
    vendorCommissionPct: number;
    minOrderAmount: number;
  };
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
    riderEarningPct: number;
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
  security?: {
    gpsTracking: boolean;
    gpsInterval: number;
    otpBypass: boolean;
    sessionDays: number;
    riderTokenDays: number;
  };
  integrations?: {
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

const DEFAULT_CONFIG: PlatformConfig = {
  platform: {
    appName: "AJKMart",
    appTagline: "Your super app for everything",
    appVersion: "1.0.0",
    appStatus: "active",
    supportPhone: "03001234567",
    supportEmail: "",
    supportHours: "Mon–Sat, 8AM–10PM",
    businessAddress: "Muzaffarabad, AJK, Pakistan",
    socialFacebook: "",
    socialInstagram: "",
    commissionPct: 10,
    vendorCommissionPct: 15,
    minOrderAmount: 100,
  },
  features: { mart: true, food: true, rides: true, pharmacy: true, parcel: true, wallet: true, referral: true, newUsers: true, chat: false, liveTracking: true, reviews: true },
  content: { showBanner: true, banner: "Free delivery on your first order! 🎉", announcement: "", maintenanceMsg: "We're performing scheduled maintenance. Back soon!", supportMsg: "Need help? Chat with us!", vendorNotice: "", riderNotice: "", tncUrl: "", privacyUrl: "", refundPolicyUrl: "", faqUrl: "", aboutUrl: "" },
  orderRules: { minOrderAmount: 100, maxCodAmount: 5000, maxCartValue: 50000, cancelWindowMin: 5, autoCancelMin: 15, refundDays: 3, preptimeMin: 15, ratingWindowHours: 48, scheduleEnabled: false },
  deliveryFee: { mart: 80, food: 60, pharmacy: 50, parcel: 100, parcelPerKg: 40, freeEnabled: true, freeDeliveryAbove: 1000 },
  rides: { bikeBaseFare: 15, bikePerKm: 8, bikeMinFare: 50, carBaseFare: 25, carPerKm: 12, carMinFare: 80, surgeEnabled: false, surgeMultiplier: 1.5, cancellationFee: 30, riderEarningPct: 80 },
  finance: { gstEnabled: false, gstPct: 17, cashbackEnabled: false, cashbackPct: 2, cashbackMaxRs: 100, invoiceEnabled: false, platformCommissionPct: 10, vendorCommissionPct: 15, riderEarningPct: 80, minVendorPayout: 500, minRiderPayout: 500, vendorSettleDays: 7, referralBonus: 100 },
  security: { gpsTracking: true, gpsInterval: 30, otpBypass: false, sessionDays: 30, riderTokenDays: 7 },
};

export function usePlatformConfig() {
  const { data, isLoading } = useQuery<PlatformConfig>({
    queryKey: ["platform-config"],
    queryFn: () => apiFetch("/platform-config"),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 2,
  });
  return { config: data ?? DEFAULT_CONFIG, isLoading };
}
