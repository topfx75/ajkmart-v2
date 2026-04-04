import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, useWindowDimensions, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Colors from "@/constants/colors";

const C = Colors.light;

function SkeletonPulse({ style }: { style?: any }) {
  const shimmerX = useRef(new Animated.Value(0)).current;
  const { width } = useWindowDimensions();

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(shimmerX, {
        toValue: 1,
        duration: 1100,
        useNativeDriver: false,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const translateX = shimmerX.interpolate({
    inputRange: [0, 1],
    outputRange: [-width, width],
  });

  return (
    <View style={[sk.base, style]}>
      <Animated.View
        style={[StyleSheet.absoluteFillObject, { transform: [{ translateX }] }]}
      >
        <LinearGradient
          colors={["transparent", "rgba(255,255,255,0.68)", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}

const sk = StyleSheet.create({
  base: {
    backgroundColor: "#DDE3EA",
    borderRadius: 10,
    overflow: "hidden",
  },
});

export function ServiceListSkeleton() {
  return (
    <View style={{ marginBottom: 18 }}>
      <SkeletonPulse style={{ width: 110, height: 15, marginBottom: 14, borderRadius: 8 }} />
      <View style={{ flexDirection: "row", gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={{
              width: 150,
              borderRadius: 20,
              padding: 16,
              borderWidth: 1,
              borderColor: C.border,
              backgroundColor: C.surface,
              gap: 10,
            }}
          >
            <SkeletonPulse style={{ width: 52, height: 52, borderRadius: 16 }} />
            <SkeletonPulse style={{ width: 84, height: 16, borderRadius: 8 }} />
            <SkeletonPulse style={{ width: 62, height: 12, borderRadius: 6 }} />
            <View style={{ gap: 5 }}>
              <SkeletonPulse style={{ width: 100, height: 10, borderRadius: 5 }} />
              <SkeletonPulse style={{ width: 70, height: 10, borderRadius: 5 }} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export function FareEstimateSkeleton() {
  return (
    <View
      style={{
        borderRadius: 20,
        overflow: "hidden",
        marginBottom: 14,
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: C.surface,
        padding: 18,
        gap: 14,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <SkeletonPulse style={{ width: 110, height: 16, borderRadius: 8 }} />
        <SkeletonPulse style={{ width: 58, height: 24, borderRadius: 12 }} />
      </View>
      <SkeletonPulse style={{ width: "100%", height: 100, borderRadius: 14 }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 0 }}>
        {[0, 1, 2].map((i) => (
          <React.Fragment key={i}>
            <View style={{ flex: 1, alignItems: "center", gap: 6 }}>
              <SkeletonPulse style={{ width: 48, height: 11, borderRadius: 6 }} />
              <SkeletonPulse style={{ width: 64, height: 20, borderRadius: 8 }} />
            </View>
            {i < 2 && <View style={{ width: 1, height: 36, backgroundColor: C.border }} />}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

export function RideStatusSkeleton() {
  return (
    <View style={{ flex: 1, backgroundColor: C.background, padding: 20, gap: 14 }}>
      <View
        style={{
          backgroundColor: C.surface,
          borderRadius: 22,
          padding: 18,
          borderWidth: 1,
          borderColor: C.border,
        }}
      >
        <SkeletonPulse style={{ width: 130, height: 16, marginBottom: 20, borderRadius: 8 }} />
        <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
          {[0, 1, 2, 3].map((i) => (
            <React.Fragment key={i}>
              <View style={{ alignItems: "center", flex: 1, gap: 7 }}>
                <SkeletonPulse style={{ width: 34, height: 34, borderRadius: 17 }} />
                <SkeletonPulse style={{ width: 42, height: 10, borderRadius: 5 }} />
              </View>
              {i < 3 && (
                <SkeletonPulse
                  style={{ height: 2, flex: 0.4, marginTop: 16, borderRadius: 1 }}
                />
              )}
            </React.Fragment>
          ))}
        </View>
      </View>
      <View
        style={{
          backgroundColor: C.surface,
          borderRadius: 22,
          padding: 18,
          borderWidth: 1,
          borderColor: C.border,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <SkeletonPulse style={{ width: 58, height: 58, borderRadius: 18 }} />
        <View style={{ flex: 1, gap: 8 }}>
          <SkeletonPulse style={{ width: 130, height: 16, borderRadius: 8 }} />
          <SkeletonPulse style={{ width: 90, height: 12, borderRadius: 6 }} />
        </View>
      </View>
    </View>
  );
}
