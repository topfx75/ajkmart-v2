import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { setBaseUrl } from "@workspace/api-client-react";
import * as Linking from "expo-linking";
import { loadCoreFonts, loadUrduFonts } from "@/utils/fonts";
import { router, Stack, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Platform, TouchableOpacity, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PwaInstallBanner } from "@/components/PwaInstallBanner";
import { registerServiceWorker } from "@/utils/register-service-worker";
import { initSentry, setSentryUser } from "@/utils/sentry";
import { initAnalytics, trackScreen, identifyUser } from "@/utils/analytics";
import { registerPush } from "@/utils/push";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { API_BASE } from "@/utils/api";
import { LanguageProvider, useLanguage } from "@/context/LanguageContext";
import { PlatformConfigProvider, usePlatformConfig } from "@/context/PlatformConfigContext";
import { LocationProvider } from "@/context/LocationContext";
import { ToastProvider } from "@/context/ToastContext";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { slowNetworkQueryDefaults } from "@/lib/queryConfig";

const _domain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
if (_domain) setBaseUrl(API_BASE);

if (typeof window !== "undefined" && __DEV__) {
  const _h = window.location.hash;
  if (_h.startsWith("#_da=")) {
    try {
      const [_tok, _ref, _usr] = _h.slice(5).split("|");
      const _P = "@ajkmart_ws_";
      if (_tok) localStorage.setItem(_P + "ajkmart_token", decodeURIComponent(_tok));
      if (_ref) localStorage.setItem(_P + "ajkmart_refresh_token", decodeURIComponent(_ref));
      if (_usr) localStorage.setItem("@ajkmart_user", decodeURIComponent(_usr));
      history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch {}
  }
}

SplashScreen.preventAutoHideAsync();

function WebShell({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== "web") return <>{children}</>;
  return (
    <View style={webStyles.bg}>
      <View style={webStyles.phone}>
        {children}
      </View>
    </View>
  );
}

const webStyles = Platform.OS === "web" ? StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: "#0a0f1e",
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  phone: {
    width: "100%" as any,
    maxWidth: 430,
    flex: 1,
    overflow: "hidden" as const,
    boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
  },
}) : { bg: {}, phone: {} };

const splashStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0047B3",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 12,
  },
  logoWrap: {
    width: 110,
    height: 110,
    borderRadius: 28,
    backgroundColor: "#ffffff",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    marginBottom: 6,
    boxShadow: "0 8px 32px rgba(0,0,0,0.25)" as any,
  },
  logo: {
    width: 88,
    height: 88,
  },
  appName: {
    fontFamily: "System",
    fontSize: 28,
    fontWeight: "800" as const,
    color: "#ffffff",
    letterSpacing: 0.5,
  },
  tagline: {
    fontFamily: "System",
    fontSize: 13,
    color: "rgba(255,255,255,0.75)",
    letterSpacing: 1.5,
    textTransform: "uppercase" as const,
    marginTop: -4,
  },
  loaderRow: {
    marginTop: 28,
  },
});

const queryClient = new QueryClient({
  defaultOptions: slowNetworkQueryDefaults,
});

const GUEST_BROWSABLE = new Set([
  "food", "mart", "ride", "pharmacy", "parcel", "product", "search",
  "cart", "categories",
]);

function AuthGuard() {
  const { user, isLoading } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;
    const inAuthGroup = segments[0] === "auth";
    const inTabsGroup = segments[0] === "(tabs)";
    const inRootIndex = (segments as string[]).length === 0;
    const isBrowsable = GUEST_BROWSABLE.has(segments[0] as string);

    const isPublicRoute = inAuthGroup || inTabsGroup || inRootIndex || isBrowsable;
    const onWrongAppScreen = segments[0] === "auth" && segments[1] === "wrong-app";

    if (!user && !isPublicRoute) {
      router.replace("/auth");
    } else if (user && user.role !== "customer" && !onWrongAppScreen) {
      router.replace("/auth/wrong-app");
    } else if (user && user.role === "customer" && (inAuthGroup || inRootIndex)) {
      router.replace("/(tabs)");
    }
  }, [user, isLoading, segments]);

  return null;
}

function SuspendedScreen() {
  const { suspendedMessage, clearSuspended } = useAuth();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  return (
    <View style={{ flex: 1, backgroundColor: "#FEF2F2", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <View style={{ width: 90, height: 90, borderRadius: 45, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
        <Text style={{ fontSize: 44 }}>🚫</Text>
      </View>
      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: "#991B1B", textAlign: "center", marginBottom: 12 }}>{T("accountSuspended")}</Text>
      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: "#7F1D1D", textAlign: "center", lineHeight: 22, marginBottom: 32 }}>
        {suspendedMessage || T("accountSuspendedMsg")}
      </Text>
      <TouchableOpacity activeOpacity={0.7} onPress={clearSuspended} style={{ backgroundColor: "#DC2626", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, alignItems: "center" }}>
        <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff" }}>{T("signOutLabel")}</Text>
      </TouchableOpacity>
    </View>
  );
}

function MaintenanceScreen() {
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  return (
    <View style={{ flex: 1, backgroundColor: "#FFF7ED", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <View style={{ width: 90, height: 90, borderRadius: 45, backgroundColor: "#FEF3C7", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
        <Text style={{ fontSize: 44 }}>🔧</Text>
      </View>
      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: "#92400E", textAlign: "center", marginBottom: 12 }}>{T("underMaintenance")}</Text>
      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: "#78350F", textAlign: "center", lineHeight: 22, marginBottom: 16 }}>
        {config.content.maintenanceMsg || T("maintenanceApology")}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FEF3C7", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 }}>
        <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: "#B45309" }}>
          Support: {config.platform.supportPhone || config.platform.supportEmail}
        </Text>
      </View>
    </View>
  );
}

function MagicLinkHandler() {
  const { login, setTwoFactorPending } = useAuth();

  useEffect(() => {
    const handleUrl = async (url: string) => {
      try {
        const parsed = new URL(url);
        const token = parsed.searchParams.get("magic_token") || parsed.searchParams.get("token");
        if (!token) return;
        if (!parsed.pathname.includes("magic-link") && !parsed.pathname.includes("auth")) return;

        const res = await fetch(`${API_BASE}/auth/magic-link/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (!res.ok) {
          const errMsg: string = data.error || data.message || "";
          let userMessage: string;
          if (errMsg.toLowerCase().includes("expired") || data.code === "EXPIRED") {
            userMessage = "This magic link has expired. Please request a new login link.";
          } else if (errMsg.toLowerCase().includes("used") || data.code === "USED") {
            userMessage = "This magic link has already been used. Please request a new one.";
          } else if (errMsg.toLowerCase().includes("invalid") || data.code === "INVALID") {
            userMessage = "This magic link is invalid. Please request a new login link.";
          } else {
            userMessage = errMsg || "Invalid or expired magic link. Please request a new one.";
          }
          Alert.alert("Sign-In Failed", userMessage, [{ text: "OK" }]);
          return;
        }
        if (data.requires2FA) {
          setTwoFactorPending({ tempToken: data.tempToken, userId: data.userId });
          router.replace("/auth");
          return;
        }
        if (data.token && data.user) {
          await login(data.user as any, data.token, data.refreshToken);
          const role: string = (data.user as any)?.role ?? "customer";
          if (role !== "customer") {
            router.replace("/auth/wrong-app");
          } else {
            router.replace("/(tabs)");
          }
        }
      } catch (err: any) {
        if (__DEV__) console.warn("MagicLinkHandler error:", err.message || err);
      }
    };

    const sub = Linking.addEventListener("url", (event) => handleUrl(event.url));
    Linking.getInitialURL().then(url => { if (url) handleUrl(url); });
    return () => sub.remove();
  }, []);

  return null;
}

function MisconfigScreen() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: "#0f172a" }}>
      <Text style={{ fontSize: 48 }}>⚙️</Text>
      <Text style={{ color: "#f1f5f9", fontSize: 20, fontWeight: "700", marginTop: 16, textAlign: "center" }}>
        App Not Configured
      </Text>
      <Text style={{ color: "#94a3b8", fontSize: 14, marginTop: 10, textAlign: "center", lineHeight: 22 }}>
        {"EXPO_PUBLIC_DOMAIN is not set.\nPlease configure the environment and rebuild the app."}
      </Text>
    </View>
  );
}


function RootLayoutNav() {
  const { isSuspended, user, token } = useAuth();
  const { config } = usePlatformConfig();
  const qc = useQueryClient();
  const prevUserRef = useRef<string | null>(null);

  useEffect(() => {
    const uid = user?.id ?? null;
    if (prevUserRef.current && !uid) {
      qc.clear();
    }
    prevUserRef.current = uid;
  }, [user?.id]);

  /* ── Init Sentry + Analytics from platform-config (web only) ── */
  useEffect(() => {
    const integ = config?.integrations;
    if (!integ) return;
    if (integ.sentry && integ.sentryDsn) {
      initSentry(integ.sentryDsn, integ.sentryEnvironment, integ.sentrySampleRate).catch(() => {});
    }
    if (integ.analytics && integ.analyticsTrackingId) {
      initAnalytics(integ.analyticsPlatform, integ.analyticsTrackingId, integ.analyticsDebug ?? false);
      trackScreen("app_start");
    }
  }, [config?.integrations?.sentryDsn, config?.integrations?.analyticsTrackingId]);

  /* ── Register push + identify user after login ── */
  useEffect(() => {
    if (!user?.id || !token) return;
    setSentryUser(String(user.id));
    identifyUser(String(user.id));
    registerPush(token).catch(() => {});
  }, [user?.id, token]);

  if (isSuspended) return <SuspendedScreen />;
  if (config.appStatus === "maintenance" && user) return <MaintenanceScreen />;

  return (
    <>
      <AuthGuard />
      <MagicLinkHandler />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index"          options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)"         options={{ headerShown: false }} />
        <Stack.Screen name="auth"           options={{ headerShown: false }} />
        <Stack.Screen name="mart/index"     options={{ headerShown: false }} />
        <Stack.Screen name="food/index"     options={{ headerShown: false }} />
        <Stack.Screen name="ride/index"     options={{ headerShown: false }} />
        <Stack.Screen name="cart/index"     options={{ headerShown: false }} />
        <Stack.Screen name="pharmacy/index" options={{ headerShown: false }} />
        <Stack.Screen name="parcel/index"   options={{ headerShown: false }} />
        <Stack.Screen name="categories/index" options={{ headerShown: false }} />
        <Stack.Screen name="order/index"    options={{ headerShown: false }} />
        <Stack.Screen name="orders/[id]"    options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  /* Register PWA service worker on web */
  useEffect(() => {
    registerServiceWorker();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadAllFonts = async () => {
      try {
        const timeout = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

        // Step 1: Load core Inter fonts — always required, fast (~300 KB).
        await Promise.race([
          loadCoreFonts(),
          timeout(Platform.OS === "web" ? 3000 : 8000),
        ]).catch(() => {});

        // Step 2: Pre-load Noto Nastaliq Urdu ONLY if the saved language
        // preference is Urdu. This prevents the large (~2.7 MB) font set
        // from being downloaded/registered on every cold start for
        // English-speaking users — which was the source of the startup error.
        const savedLang = await AsyncStorage.getItem("@ajkmart_language").catch(() => null);
        if (savedLang === "ur" || savedLang === "en_ur") {
          // Fire-and-forget; don't block the splash hide on Urdu font load.
          loadUrduFonts().catch(() => {});
        }
      } catch {
        // Silently continue — the app renders with system fonts as fallback.
      }

      if (!cancelled) {
        setReady(true);
        SplashScreen.hideAsync().catch(() => {});
      }
    };

    loadAllFonts();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <WebShell>
        <View style={splashStyles.container}>
          <View style={splashStyles.logoWrap}>
            <Image
              source={require("@/assets/images/logo.png")}
              style={splashStyles.logo}
              resizeMode="contain"
            />
          </View>
          <Text style={splashStyles.appName}>AJKMart</Text>
          <Text style={splashStyles.tagline}>Fast Home Delivery</Text>
          <View style={splashStyles.loaderRow}>
            <ActivityIndicator size="small" color="rgba(255,255,255,0.9)" />
          </View>
        </View>
      </WebShell>
    );
  }

  if (!_domain) {
    return (
      <WebShell>
        <MisconfigScreen />
      </WebShell>
    );
  }

  return (
    <WebShell>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <PlatformConfigProvider>
                  <LanguageProvider>
                    <AuthProvider>
                      <LocationProvider>
                      <CartProvider>
                        <ToastProvider>
                          <RootLayoutNav />
                          <PwaInstallBanner />
                        </ToastProvider>
                      </CartProvider>
                      </LocationProvider>
                    </AuthProvider>
                  </LanguageProvider>
                </PlatformConfigProvider>
              </KeyboardProvider>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </WebShell>
  );
}
