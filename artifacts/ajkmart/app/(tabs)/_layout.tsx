import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, View, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors from "@/constants/colors";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { useLanguage } from "@/context/LanguageContext";
import { tDual } from "@workspace/i18n";

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
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const insets = useSafeAreaInsets();
  const C = Colors.light;
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
          backgroundColor: isIOS ? "transparent" : "#fff",
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: C.border,
          elevation: 0,
          paddingBottom: insets.bottom,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={100} tint="light" style={StyleSheet.absoluteFill} />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: "#fff" }]} />
          ) : null,
        tabBarLabelStyle: {
          fontFamily: "Inter_500Medium",
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: T("home"),
          tabBarIcon: ({ color, size }) =>
            isIOS ? (
              <SymbolView name="house" tintColor={color} size={size} />
            ) : (
              <Ionicons name="home-outline" size={size} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: T("orders"),
          tabBarIcon: ({ color, size }) =>
            isIOS ? (
              <SymbolView name="bag" tintColor={color} size={size} />
            ) : (
              <Ionicons name="bag-outline" size={size} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: T("wallet"),
          tabBarIcon: ({ color, size }) =>
            isIOS ? (
              <SymbolView name="creditcard" tintColor={color} size={size} />
            ) : (
              <Ionicons name="wallet-outline" size={size} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: T("profile"),
          tabBarIcon: ({ color, size }) =>
            isIOS ? (
              <SymbolView name="person" tintColor={color} size={size} />
            ) : (
              <Ionicons name="person-outline" size={size} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

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
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    maxWidth: 380,
    width: "100%",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  icon: { fontSize: 52, marginBottom: 16 },
  title: { fontSize: 22, fontWeight: "700", color: "#0F172A", marginBottom: 10, textAlign: "center" },
  msg:   { fontSize: 15, color: "#475569", textAlign: "center", lineHeight: 22, marginBottom: 8 },
  sub:   { fontSize: 13, color: "#94A3B8", textAlign: "center", lineHeight: 18 },
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
