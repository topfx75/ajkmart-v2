import React, { Suspense, lazy } from "react";
import { View, StyleSheet } from "react-native";
import { SkeletonBlock } from "@/components/user-shared";
import Colors from "@/constants/colors";

const C = Colors.light;

const MartScreenContent = lazy(() =>
  import("@/components/screens/MartScreenContent")
);

function MartSkeleton() {
  return (
    <View style={sk.container}>
      <View style={sk.header}>
        <SkeletonBlock w="40%" h={20} r={8} />
        <View style={sk.headerRight}>
          <SkeletonBlock w={32} h={32} r={16} />
          <SkeletonBlock w={32} h={32} r={16} />
        </View>
      </View>
      <View style={sk.searchRow}>
        <SkeletonBlock w="100%" h={40} r={20} />
      </View>
      <View style={sk.row}>
        <SkeletonBlock w="48%" h={180} r={12} />
        <SkeletonBlock w="48%" h={180} r={12} />
      </View>
      <View style={sk.sectionTitle}>
        <SkeletonBlock w="40%" h={16} r={6} />
      </View>
      <View style={sk.row}>
        <SkeletonBlock w="31%" h={140} r={12} />
        <SkeletonBlock w="31%" h={140} r={12} />
        <SkeletonBlock w="31%" h={140} r={12} />
      </View>
      <View style={sk.sectionTitle}>
        <SkeletonBlock w="35%" h={16} r={6} />
      </View>
      <View style={sk.row}>
        <SkeletonBlock w="48%" h={200} r={12} />
        <SkeletonBlock w="48%" h={200} r={12} />
      </View>
    </View>
  );
}

export default function MartScreen() {
  return (
    <Suspense fallback={<MartSkeleton />}>
      <MartScreenContent />
    </Suspense>
  );
}

const sk = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background, padding: 16 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  headerRight: { flexDirection: "row", gap: 8 },
  searchRow: { marginBottom: 16 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 16,
  },
  sectionTitle: { marginBottom: 10 },
});
