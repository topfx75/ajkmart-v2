import React, { useEffect, useRef } from "react";
import { Animated, useColorScheme, useWindowDimensions, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Colors from "@/constants/colors";

function SkeletonPulse({ style, dark }: { style?: any; dark?: boolean }) {
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

  const baseBg = dark ? "#1E2A40" : "#DDE3EA";
  const shimmerColor = dark ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.68)";

  return (
    <View style={[{ backgroundColor: baseBg, borderRadius: 10, overflow: "hidden" }, style]}>
      <Animated.View
        style={[{ ...StyleSheet_absoluteFillObject, transform: [{ translateX }] }]}
      >
        <LinearGradient
          colors={["transparent", shimmerColor, "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}

const StyleSheet_absoluteFillObject = {
  position: "absolute" as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};

export function ServiceListSkeleton() {
  const colorScheme = useColorScheme();
  const C = colorScheme === "dark" ? Colors.dark : Colors.light;
  const dark = colorScheme === "dark";
  return (
    <View style={{ marginBottom: 18 }}>
      <SkeletonPulse dark={dark} style={{ width: 110, height: 15, marginBottom: 14, borderRadius: 8 }} />
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
            <SkeletonPulse dark={dark} style={{ width: 52, height: 52, borderRadius: 16 }} />
            <SkeletonPulse dark={dark} style={{ width: 84, height: 16, borderRadius: 8 }} />
            <SkeletonPulse dark={dark} style={{ width: 62, height: 12, borderRadius: 6 }} />
            <View style={{ gap: 5 }}>
              <SkeletonPulse dark={dark} style={{ width: 100, height: 10, borderRadius: 5 }} />
              <SkeletonPulse dark={dark} style={{ width: 70, height: 10, borderRadius: 5 }} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export function FareEstimateSkeleton() {
  const colorScheme = useColorScheme();
  const C = colorScheme === "dark" ? Colors.dark : Colors.light;
  const dark = colorScheme === "dark";
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
        <SkeletonPulse dark={dark} style={{ width: 110, height: 16, borderRadius: 8 }} />
        <SkeletonPulse dark={dark} style={{ width: 58, height: 24, borderRadius: 12 }} />
      </View>
      <SkeletonPulse dark={dark} style={{ width: "100%", height: 100, borderRadius: 14 }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 0 }}>
        {[0, 1, 2].map((i) => (
          <React.Fragment key={i}>
            <View style={{ flex: 1, alignItems: "center", gap: 6 }}>
              <SkeletonPulse dark={dark} style={{ width: 48, height: 11, borderRadius: 6 }} />
              <SkeletonPulse dark={dark} style={{ width: 64, height: 20, borderRadius: 8 }} />
            </View>
            {i < 2 && <View style={{ width: 1, height: 36, backgroundColor: C.border }} />}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

export function RideStatusSkeleton() {
  const colorScheme = useColorScheme();
  const C = colorScheme === "dark" ? Colors.dark : Colors.light;
  const dark = colorScheme === "dark";
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
        <SkeletonPulse dark={dark} style={{ width: 130, height: 16, marginBottom: 20, borderRadius: 8 }} />
        <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
          {[0, 1, 2, 3].map((i) => (
            <React.Fragment key={i}>
              <View style={{ alignItems: "center", flex: 1, gap: 7 }}>
                <SkeletonPulse dark={dark} style={{ width: 34, height: 34, borderRadius: 17 }} />
                <SkeletonPulse dark={dark} style={{ width: 42, height: 10, borderRadius: 5 }} />
              </View>
              {i < 3 && (
                <SkeletonPulse
                  dark={dark}
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
        <SkeletonPulse dark={dark} style={{ width: 58, height: 58, borderRadius: 18 }} />
        <View style={{ flex: 1, gap: 8 }}>
          <SkeletonPulse dark={dark} style={{ width: 130, height: 16, borderRadius: 8 }} />
          <SkeletonPulse dark={dark} style={{ width: 90, height: 12, borderRadius: 6 }} />
        </View>
      </View>
    </View>
  );
}

export function HistoryRowSkeleton({ dark }: { dark?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 }}>
      <SkeletonPulse dark={dark} style={{ width: 44, height: 44, borderRadius: 14 }} />
      <View style={{ flex: 1, gap: 7 }}>
        <SkeletonPulse dark={dark} style={{ width: "70%", height: 14, borderRadius: 7 }} />
        <SkeletonPulse dark={dark} style={{ width: "45%", height: 11, borderRadius: 6 }} />
      </View>
      <SkeletonPulse dark={dark} style={{ width: 52, height: 20, borderRadius: 10 }} />
    </View>
  );
}
