import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors, { radii, shadows, typography } from "@/constants/colors";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { useCart } from "@/context/CartContext";
import { useLanguage } from "@/context/LanguageContext";
import { tDual } from "@workspace/i18n";
import { getActiveServices } from "@/constants/serviceRegistry";

const C = Colors.light;

function useAdaptiveTabConfig() {
  const { config } = usePlatformConfig();
  const features = config.features;
  const { language } = useLanguage();
  const T = (key: Parameters<typeof tDual>[0]) => tDual(key, language);

  return useMemo(() => {
    const active = getActiveServices(features);
    const activeKeys = new Set(active.map((s) => s.key));

    const hasRides = activeKeys.has("rides");
    const hasFood = activeKeys.has("food");
    const hasMart = activeKeys.has("mart");
    const hasPharmacy = activeKeys.has("pharmacy");
    const hasParcel = activeKeys.has("parcel");
    const hasWallet = features.wallet;

    const hasOrderServices = hasMart || hasFood || hasPharmacy || hasParcel;

    let homeTitle = T("home");
    if (active.length === 1) {
      const svc = active[0];
      homeTitle = svc.tabLabel;
    }

    let ordersTitle = T("orders");
    if (hasRides && !hasOrderServices) {
      ordersTitle = T("rides");
    }

    return {
      homeTitle,
      ordersTitle,
      walletTitle: T("wallet"),
      profileTitle: T("profile"),
      showWalletTab: hasWallet,
      showOrdersTab: true,
    };
  }, [features, language]);
}

function NativeTabLayout() {
  const tabConfig = useAdaptiveTabConfig();

  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "house", selected: "house.fill" }} />
        <Label>{tabConfig.homeTitle}</Label>
      </NativeTabs.Trigger>
      {tabConfig.showOrdersTab && (
        <NativeTabs.Trigger name="orders">
          <Icon sf={{ default: "bag", selected: "bag.fill" }} />
          <Label>{tabConfig.ordersTitle}</Label>
        </NativeTabs.Trigger>
      )}
      {tabConfig.showWalletTab && (
        <NativeTabs.Trigger name="wallet">
          <Icon sf={{ default: "creditcard", selected: "creditcard.fill" }} />
          <Label>{tabConfig.walletTitle}</Label>
        </NativeTabs.Trigger>
      )}
      <NativeTabs.Trigger name="profile">
        <Icon sf={{ default: "person", selected: "person.fill" }} />
        <Label>{tabConfig.profileTitle}</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function TabIconWithBadge({ name, focusedName, color, focused, badgeCount }: {
  name: keyof typeof Ionicons.glyphMap;
  focusedName: keyof typeof Ionicons.glyphMap;
  color: string;
  focused: boolean;
  badgeCount?: number;
}) {
  return (
    <View style={focused ? tabStyles.activeIconWrap : tabStyles.iconWrap}>
      <Ionicons name={focused ? focusedName : name} size={22} color={color} />
      {(badgeCount ?? 0) > 0 && (
        <View style={tabStyles.badge}>
          <Text style={tabStyles.badgeText}>{badgeCount! > 9 ? "9+" : badgeCount}</Text>
        </View>
      )}
    </View>
  );
}

function ClassicTabLayout() {
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const insets = useSafeAreaInsets();
  const tabConfig = useAdaptiveTabConfig();
  const { itemCount } = useCart();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.tabIconSelected,
        tabBarInactiveTintColor: C.tabIconDefault,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : "#111827",
          borderTopWidth: 0,
          paddingBottom: insets.bottom,
          ...shadows.lg,
          ...(isWeb ? { height: 72, borderTopWidth: 1, borderTopColor: "#1F2937" } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={95} tint="dark" style={StyleSheet.absoluteFill} />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: "#111827" }]} />
          ) : null,
        tabBarLabelStyle: {
          ...typography.tabLabel,
          marginTop: -2,
        },
        tabBarItemStyle: {
          paddingTop: 6,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: tabConfig.homeTitle,
          tabBarIcon: ({ color, size, focused }) =>
            isIOS ? (
              <SymbolView name="house" tintColor={color} size={size} />
            ) : (
              <TabIconWithBadge name="home-outline" focusedName="home" color={color} focused={focused} />
            ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: tabConfig.ordersTitle,
          href: tabConfig.showOrdersTab ? undefined : null,
          tabBarIcon: ({ color, size, focused }) =>
            isIOS ? (
              <SymbolView name="bag" tintColor={color} size={size} />
            ) : (
              <TabIconWithBadge name="bag-outline" focusedName="bag" color={color} focused={focused} badgeCount={itemCount} />
            ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: tabConfig.walletTitle,
          href: tabConfig.showWalletTab ? undefined : null,
          tabBarIcon: ({ color, size, focused }) =>
            isIOS ? (
              <SymbolView name="creditcard" tintColor={color} size={size} />
            ) : (
              <TabIconWithBadge name="wallet-outline" focusedName="wallet" color={color} focused={focused} />
            ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: tabConfig.profileTitle,
          tabBarIcon: ({ color, size, focused }) =>
            isIOS ? (
              <SymbolView name="person" tintColor={color} size={size} />
            ) : (
              <TabIconWithBadge name="person-outline" focusedName="person" color={color} focused={focused} />
            ),
        }}
      />
    </Tabs>
  );
}

const tabStyles = StyleSheet.create({
  iconWrap: {
    position: "relative",
  },
  activeIconWrap: {
    position: "relative",
    backgroundColor: C.primarySoft,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -10,
    backgroundColor: C.accent,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  badgeText: {
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    color: "#fff",
  },
});

const ms = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,23,42,0.96)",
    zIndex: 9999,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: radii.xxl,
    padding: 32,
    alignItems: "center",
    maxWidth: 380,
    width: "100%",
    ...shadows.xl,
  },
  icon: { fontSize: 52, marginBottom: 16 },
  title: { ...typography.h2, color: C.text, marginBottom: 10, textAlign: "center" },
  msg: { ...typography.body, color: C.textSecondary, textAlign: "center", lineHeight: 22, marginBottom: 8 },
  sub: { ...typography.caption, color: C.textMuted, textAlign: "center", lineHeight: 18 },
});

function MaintenanceOverlay({ message }: { message: string }) {
  return (
    <View style={ms.overlay}>
      <View style={ms.card}>
        <Text style={ms.icon}>🔧</Text>
        <Text style={ms.title}>Under Maintenance</Text>
        <Text style={ms.msg}>{message}</Text>
        <Text style={ms.sub}>Please check back later. We apologize for the inconvenience.</Text>
      </View>
    </View>
  );
}

export default function TabLayout() {
  const { config } = usePlatformConfig();
  const inMaintenance = config.appStatus === "maintenance";

  const inner = isLiquidGlassAvailable() ? <NativeTabLayout /> : <ClassicTabLayout />;

  return (
    <View style={{ flex: 1 }}>
      {inner}
      {inMaintenance && (
        <MaintenanceOverlay message={config.content.maintenanceMsg} />
      )}
    </View>
  );
}
