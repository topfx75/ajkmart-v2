import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./api";

export interface PlatformConfig {
  vendor: {
    commissionPct: number;
    settleDays: number;
    minPayout: number;
    maxPayout: number;
    minOrder: number;
    maxItems: number;
    autoApprove: boolean;
    promoEnabled: boolean;
    withdrawalEnabled: boolean;
  };
  platform: {
    appName: string;
    appTagline: string;
    appVersion: string;
    appStatus: "active" | "maintenance";
    logoUrl: string;
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
    trackerBannerEnabled: boolean;
    trackerBannerPosition: "top" | "bottom";
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
  auth?: {
    phoneOtpEnabled?: boolean | { customer?: boolean; rider?: boolean; vendor?: boolean };
    emailOtpEnabled?: boolean | { customer?: boolean; rider?: boolean; vendor?: boolean };
    usernamePasswordEnabled?: boolean | { customer?: boolean; rider?: boolean; vendor?: boolean };
    googleEnabled?: boolean | { customer?: boolean; rider?: boolean; vendor?: boolean };
    facebookEnabled?: boolean | { customer?: boolean; rider?: boolean; vendor?: boolean };
    magicLinkEnabled?: boolean | { customer?: boolean; rider?: boolean; vendor?: boolean };
    captchaEnabled?: boolean;
    googleClientId?: string;
    facebookAppId?: string;
    lockoutEnabled?: boolean;
    lockoutMaxAttempts?: number;
    lockoutDurationSec?: number;
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
  cities?: string[];
}

const DEFAULT_CONFIG: PlatformConfig = {
  vendor: { commissionPct: 15, settleDays: 7, minPayout: 500, maxPayout: 50000, minOrder: 100, maxItems: 100, autoApprove: false, promoEnabled: true, withdrawalEnabled: true },
  platform: {
    appName: "AJKMart",
    appTagline: "Your super app for everything",
    appVersion: "1.0.0",
    appStatus: "active",
    logoUrl: "",
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
  content: { trackerBannerEnabled: true, trackerBannerPosition: "top", showBanner: true, banner: "Free delivery on your first order! 🎉", announcement: "", maintenanceMsg: "We're performing scheduled maintenance. Back soon!", supportMsg: "Need help? Chat with us!", vendorNotice: "", riderNotice: "", tncUrl: "", privacyUrl: "", refundPolicyUrl: "", faqUrl: "", aboutUrl: "" },
  orderRules: { minOrderAmount: 100, maxCodAmount: 5000, maxCartValue: 50000, cancelWindowMin: 5, autoCancelMin: 15, refundDays: 3, preptimeMin: 15, ratingWindowHours: 48, scheduleEnabled: false },
  deliveryFee: { mart: 80, food: 60, pharmacy: 50, parcel: 100, parcelPerKg: 40, freeEnabled: true, freeDeliveryAbove: 1000 },
  finance: { gstEnabled: false, gstPct: 17, cashbackEnabled: false, cashbackPct: 2, cashbackMaxRs: 100, invoiceEnabled: false, platformCommissionPct: 10, vendorCommissionPct: 15, riderEarningPct: 80, minVendorPayout: 500, minRiderPayout: 500, vendorSettleDays: 7, referralBonus: 100 },
};

function resolveVendorFlag(
  perRole: boolean | { customer?: boolean; rider?: boolean; vendor?: boolean } | undefined,
): boolean {
  if (typeof perRole === "boolean") return perRole;
  if (perRole && typeof perRole === "object" && "vendor" in perRole) {
    return typeof perRole.vendor === "boolean" ? perRole.vendor : false;
  }
  return false;
}

export interface VendorAuthConfig {
  phoneOtp: boolean;
  emailOtp: boolean;
  usernamePassword: boolean;
  google: boolean;
  facebook: boolean;
  magicLink: boolean;
  lockoutEnabled: boolean;
  lockoutMaxAttempts: number;
  lockoutDurationSec: number;
}

export function getVendorAuthConfig(config: PlatformConfig): VendorAuthConfig {
  const a = config.auth;
  if (!a) return { phoneOtp: false, emailOtp: false, usernamePassword: false, google: false, facebook: false, magicLink: false, lockoutEnabled: true, lockoutMaxAttempts: 5, lockoutDurationSec: 300 };
  return {
    phoneOtp: resolveVendorFlag(a.phoneOtpEnabled),
    emailOtp: resolveVendorFlag(a.emailOtpEnabled),
    usernamePassword: resolveVendorFlag(a.usernamePasswordEnabled),
    google: resolveVendorFlag(a.googleEnabled),
    facebook: resolveVendorFlag(a.facebookEnabled),
    magicLink: resolveVendorFlag(a.magicLinkEnabled),
    lockoutEnabled: a.lockoutEnabled ?? true,
    lockoutMaxAttempts: a.lockoutMaxAttempts ?? 5,
    lockoutDurationSec: a.lockoutDurationSec ?? 300,
  };
}

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
