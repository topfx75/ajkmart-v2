import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
  NotoNastaliqUrdu_400Regular,
  NotoNastaliqUrdu_500Medium,
  NotoNastaliqUrdu_600SemiBold,
  NotoNastaliqUrdu_700Bold,
} from "@expo-google-fonts/noto-nastaliq-urdu";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setBaseUrl } from "@workspace/api-client-react";
import * as Font from "expo-font";
import * as Linking from "expo-linking";
import { router, Stack, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { LanguageProvider, useLanguage } from "@/context/LanguageContext";
import { PlatformConfigProvider, usePlatformConfig } from "@/context/PlatformConfigContext";
import { ToastProvider } from "@/context/ToastContext";
import { tDual, type TranslationKey } from "@workspace/i18n";

setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

/* ── Auth Guard ──────────────────────────────────────────────
   Watches the auth state inside the router context and
   redirects immediately whenever user logs out.
   This is the canonical Expo Router pattern for auth.
──────────────────────────────────────────────────────────── */
function AuthGuard() {
  const { user, isLoading } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return; // wait until auth is fully resolved

    const inAuthGroup = segments[0] === "auth";
    const inRootIndex = segments.length === 0;

    if (!user && !inAuthGroup) {
      // User logged out or not authenticated → send to auth
      router.replace("/auth");
    } else if (user && (inAuthGroup || inRootIndex)) {
      // User authenticated but on auth/root screen → send to app
      router.replace("/(tabs)");
    }
    // Otherwise stay where we are (user on tabs, stays on tabs)
  }, [user, isLoading]); // intentionally NOT including segments to avoid loop

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
      <Pressable onPress={clearSuspended} style={{ backgroundColor: "#DC2626", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, alignItems: "center" }}>
        <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff" }}>{T("signOutLabel")}</Text>
      </Pressable>
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

const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}/api`;

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
          Alert.alert("Magic Link Error", data.error || "Invalid or expired magic link.");
          return;
        }
        if (data.requires2FA) {
          setTwoFactorPending({ tempToken: data.tempToken, userId: data.userId });
          router.replace("/auth");
          return;
        }
        if (data.token && data.user) {
          await login(data.user as any, data.token, data.refreshToken);
          router.replace("/(tabs)");
        }
      } catch (err: any) {
        console.warn("MagicLinkHandler error:", err.message || err);
      }
    };

    const sub = Linking.addEventListener("url", (event) => handleUrl(event.url));
    Linking.getInitialURL().then(url => { if (url) handleUrl(url); });
    return () => sub.remove();
  }, []);

  return null;
}

function RootLayoutNav() {
  const { isSuspended, user } = useAuth();
  const { config } = usePlatformConfig();

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
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadFonts = async () => {
      try {
        const fontPromise = Font.loadAsync({
          Inter_400Regular,
          Inter_500Medium,
          Inter_600SemiBold,
          Inter_700Bold,
          NotoNastaliqUrdu_400Regular,
          NotoNastaliqUrdu_500Medium,
          NotoNastaliqUrdu_600SemiBold,
          NotoNastaliqUrdu_700Bold,
        }).catch(() => { /* fall back to system fonts silently */ });

        await Promise.race([
          fontPromise,
          new Promise<void>(resolve => setTimeout(resolve, Platform.OS === "web" ? 500 : 2000)),
        ]);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) {
          setReady(true);
          SplashScreen.hideAsync();
        }
      }
    };

    loadFonts();
    return () => { cancelled = true; };
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: "#1A56DB", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <PlatformConfigProvider>
                <LanguageProvider>
                  <AuthProvider>
                    <CartProvider>
                      <ToastProvider>
                        <RootLayoutNav />
                      </ToastProvider>
                    </CartProvider>
                  </AuthProvider>
                </LanguageProvider>
              </PlatformConfigProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
