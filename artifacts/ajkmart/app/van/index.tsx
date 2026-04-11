import React, { Suspense, lazy } from "react";
import { View, StyleSheet } from "react-native";
import { SkeletonBlock } from "@/components/user-shared";
import Colors from "@/constants/colors";

const C = Colors.light;

const VanScreenContent = lazy(() =>
  import("@/components/screens/VanScreenContent")
);

function VanSkeleton() {
  return (
    <View style={sk.container}>
      <View style={sk.header}>
        <SkeletonBlock w={32} h={32} r={16} />
        <SkeletonBlock w="50%" h={20} r={8} />
        <View style={{ width: 32 }} />
      </View>
      <View style={sk.section}>
        <SkeletonBlock w="35%" h={14} r={6} />
      </View>
      <SkeletonBlock w="100%" h={52} r={12} />
      <View style={{ height: 12 }} />
      <SkeletonBlock w="100%" h={52} r={12} />
      <View style={{ height: 20 }} />
      <View style={sk.section}>
        <SkeletonBlock w="40%" h={14} r={6} />
      </View>
      <View style={sk.typeRow}>
        <SkeletonBlock w="48%" h={100} r={12} />
        <SkeletonBlock w="48%" h={100} r={12} />
      </View>
      <View style={{ height: 20 }} />
      <SkeletonBlock w="100%" h={56} r={14} />
    </View>
  );
}

export default function VanScreen() {
  return (
    <Suspense fallback={<VanSkeleton />}>
      <VanScreenContent />
    </Suspense>
  );
}

const sk = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background, padding: 16 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  section: { marginBottom: 10 },
  typeRow: { flexDirection: "row", gap: 8 },
});
