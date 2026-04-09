import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { Font } from "@/constants/typography";
import { useAuth } from "@/context/AuthContext";

const C = Colors.light;

export default function WrongAppScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();

  const roleLabel =
    user?.role === "rider" ? "Delivery Rider" :
    user?.role === "vendor" ? "Store Vendor" :
    "non-customer";

  const handleSignOut = async () => {
    await logout();
    router.replace("/auth");
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.iconWrap}>
        <Ionicons name="alert-circle" size={56} color={C.amber} />
      </View>

      <Text style={styles.title}>Wrong App</Text>

      <Text style={styles.subtitle}>
        {`You signed in as a ${roleLabel} account. This is the AJKMart customer app — it is designed for customers to browse, order, and track deliveries.`}
      </Text>

      <Text style={styles.hint}>
        {user?.role === "rider"
          ? "Please use the AJKMart Rider App to manage your deliveries."
          : user?.role === "vendor"
          ? "Please use the AJKMart Vendor App to manage your store."
          : "Please sign in with a customer account to continue."}
      </Text>

      <TouchableOpacity
        activeOpacity={0.8}
        style={styles.signOutBtn}
        onPress={handleSignOut}
        accessibilityRole="button"
      >
        <Ionicons name="log-out-outline" size={18} color="#fff" />
        <Text style={styles.signOutTxt}>Sign Out</Text>
      </TouchableOpacity>

      <TouchableOpacity
        activeOpacity={0.8}
        style={styles.backBtn}
        onPress={async () => {
          await logout();
          router.replace("/auth");
        }}
        accessibilityRole="button"
      >
        <Text style={styles.backTxt}>Use a Different Account</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.background,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  iconWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: C.amberBg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  title: {
    fontFamily: Font.bold,
    fontSize: 26,
    color: C.text,
    textAlign: "center",
    marginBottom: 16,
  },
  subtitle: {
    fontFamily: Font.regular,
    fontSize: 15,
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 12,
  },
  hint: {
    fontFamily: Font.semiBold,
    fontSize: 14,
    color: C.amber,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 36,
  },
  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 36,
    width: "100%",
    justifyContent: "center",
    marginBottom: 12,
  },
  signOutTxt: {
    fontFamily: Font.bold,
    fontSize: 15,
    color: "#fff",
  },
  backBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  backTxt: {
    fontFamily: Font.semiBold,
    fontSize: 14,
    color: C.textMuted,
  },
});
