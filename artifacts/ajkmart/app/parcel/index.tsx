import React, { Suspense, lazy } from "react";
import { View, StyleSheet } from "react-native";
import { SkeletonBlock } from "@/components/user-shared";
import Colors from "@/constants/colors";

const C = Colors.light;

const ParcelScreenContent = lazy(() =>
  import("@/components/screens/ParcelScreenContent")
);

function ParcelSkeleton() {
  return (
    <View style={sk.container}>
      <View style={sk.header}>
        <SkeletonBlock w="40%" h={20} r={8} />
        <SkeletonBlock w={32} h={32} r={16} />
      </View>
      <View style={sk.steps}>
        <SkeletonBlock w={28} h={28} r={14} />
        <SkeletonBlock w={40} h={2} r={1} />
        <SkeletonBlock w={28} h={28} r={14} />
        <SkeletonBlock w={40} h={2} r={1} />
        <SkeletonBlock w={28} h={28} r={14} />
      </View>
      <View style={sk.section}>
        <SkeletonBlock w="40%" h={16} r={6} />
      </View>
      <SkeletonBlock w="100%" h={52} r={12} />
      <View style={{ height: 12 }} />
      <SkeletonBlock w="100%" h={52} r={12} />
      <View style={{ height: 12 }} />
      <SkeletonBlock w="100%" h={52} r={12} />
      <View style={{ height: 24 }} />
      <View style={sk.section}>
        <SkeletonBlock w="45%" h={16} r={6} />
      </View>
      <View style={sk.typeRow}>
        <SkeletonBlock w="48%" h={80} r={12} />
        <SkeletonBlock w="48%" h={80} r={12} />
      </View>
    </View>
  );
}

export default function ParcelScreen() {
  return (
    <Suspense fallback={<ParcelSkeleton />}>
      <ParcelScreenContent />
    </Suspense>
  );
}

const sk = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background, padding: 16 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  steps: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 24,
  },
  section: { marginBottom: 12 },
  typeRow: { flexDirection: "row", gap: 8, marginTop: 8 },
});
