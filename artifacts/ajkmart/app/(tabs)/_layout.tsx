import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors, { radii, shadows, typography } from "@/constants/colors";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { useLanguage } from "@/context/LanguageContext";
import { tDual } from "@workspace/i18n";

const C = Colors.light;

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "house", selected: "house.fill" }} />
        <Label>Home</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="orders">
        <Icon sf={{ default: "bag", selected: "bag.fill" }} />
        <Label>Orders</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="wallet">
        <Icon sf={{ default: "creditcard", selected: "creditcard.fill" }} />
        <Label>Wallet</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Icon sf={{ default: "person", selected: "person.fill" }} />
        <Label>Profile</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const insets = useSafeAreaInsets();
  const { language } = useLanguage();
  const T = (key: Parameters<typeof tDual>[0]) => tDual(key, language);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.tabIconDefault,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : C.surface,
          borderTopWidth: 0,
          elevation: 0,
          paddingBottom: insets.bottom,
          ...shadows.lg,
          ...(isWeb ? { height: 72, borderTopWidth: 1, borderTopColor: C.borderLight } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={95} tint="light" style={StyleSheet.absoluteFill} />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: C.surface }]} />
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
          title: T("home"),
          tabBarIcon: ({ color, size, focused }) =>
            isIOS ? (
              <SymbolView name="house" tintColor={color} size={size} />
            ) : (
              <View style={focused ? tabStyles.activeIconWrap : undefined}>
                <Ionicons name={focused ? "home" : "home-outline"} size={22} color={color} />
              </View>
            ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: T("orders"),
          tabBarIcon: ({ color, size, focused }) =>
            isIOS ? (
              <SymbolView name="bag" tintColor={color} size={size} />
            ) : (
              <View style={focused ? tabStyles.activeIconWrap : undefined}>
                <Ionicons name={focused ? "bag" : "bag-outline"} size={22} color={color} />
              </View>
            ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: T("wallet"),
          tabBarIcon: ({ color, size, focused }) =>
            isIOS ? (
              <SymbolView name="creditcard" tintColor={color} size={size} />
            ) : (
              <View style={focused ? tabStyles.activeIconWrap : undefined}>
                <Ionicons name={focused ? "wallet" : "wallet-outline"} size={22} color={color} />
              </View>
            ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: T("profile"),
          tabBarIcon: ({ color, size, focused }) =>
            isIOS ? (
              <SymbolView name="person" tintColor={color} size={size} />
            ) : (
              <View style={focused ? tabStyles.activeIconWrap : undefined}>
                <Ionicons name={focused ? "person" : "person-outline"} size={22} color={color} />
              </View>
            ),
        }}
      />
    </Tabs>
  );
}

const tabStyles = StyleSheet.create({
  activeIconWrap: {
    backgroundColor: C.primarySoft,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 4,
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
