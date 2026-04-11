import React, { Suspense, lazy } from "react";
import { View, StyleSheet } from "react-native";
import { SkeletonBlock } from "@/components/user-shared";
import Colors from "@/constants/colors";

const C = Colors.light;

const FoodScreenContent = lazy(() =>
  import("@/components/screens/FoodScreenContent")
);

function FoodSkeleton() {
  return (
    <View style={sk.container}>
      <View style={sk.header}>
        <SkeletonBlock w="40%" h={20} r={8} />
        <SkeletonBlock w={32} h={32} r={16} />
      </View>
      <View style={sk.searchRow}>
        <SkeletonBlock w="100%" h={40} r={20} />
      </View>
      <View style={sk.sectionTitle}>
        <SkeletonBlock w="50%" h={16} r={6} />
      </View>
      {[1, 2, 3, 4].map((i) => (
        <View key={i} style={sk.card}>
          <SkeletonBlock w={80} h={80} r={12} />
          <View style={sk.cardText}>
            <SkeletonBlock w="70%" h={14} r={6} />
            <SkeletonBlock w="50%" h={12} r={6} />
            <SkeletonBlock w="40%" h={12} r={6} />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function FoodScreen() {
  return (
    <Suspense fallback={<FoodSkeleton />}>
      <FoodScreenContent />
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
  searchRow: { marginBottom: 16 },
  sectionTitle: { marginBottom: 12 },
  card: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
  },
  cardText: { flex: 1, gap: 8, justifyContent: "center" },
});
