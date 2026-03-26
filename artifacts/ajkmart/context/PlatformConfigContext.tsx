import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

const API = process.env.EXPO_PUBLIC_API_URL ?? "";
const CACHE_MS = 30_000;

export interface PlatformConfig {
  appStatus: "active" | "maintenance";
  features: {
    chat: boolean;
    wallet: boolean;
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
}

const DEFAULT: PlatformConfig = {
  appStatus: "active",
  features: { chat: false, wallet: true, liveTracking: true, reviews: true },
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
          chat:         raw.features?.chat         ?? false,
          wallet:       raw.features?.wallet        ?? true,
          liveTracking: raw.features?.liveTracking  ?? true,
          reviews:      raw.features?.reviews       ?? true,
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
