import React from "react";
import { Image, StyleSheet, Text, View, type ImageStyle, type ViewStyle } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_MAP: Record<AvatarSize, { size: number; fontSize: number }> = {
  xs: { size: 28, fontSize: 11 },
  sm: { size: 36, fontSize: 13 },
  md: { size: 44, fontSize: 16 },
  lg: { size: 56, fontSize: 20 },
  xl: { size: 72, fontSize: 26 },
};

interface AvatarProps {
  uri?: string | null;
  name?: string | null;
  size?: AvatarSize;
  style?: ViewStyle | ImageStyle;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return (name[0] || "?").toUpperCase();
}

function getColor(name: string): string {
  const palette = [
    C.primary, C.mart, C.food, C.wallet, C.pharmacy,
    C.parcel, C.emerald, C.indigo, C.purple, C.cyan,
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
}

export function Avatar({ uri, name, size = "md", style }: AvatarProps) {
  const s = SIZE_MAP[size];

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[
          { width: s.size, height: s.size, borderRadius: s.size / 2 },
          styles.image,
          style as ImageStyle,
        ]}
      />
    );
  }

  const initials = name ? getInitials(name) : "?";
  const bg = name ? getColor(name) : C.textMuted;

  return (
    <View
      style={[
        {
          width: s.size,
          height: s.size,
          borderRadius: s.size / 2,
          backgroundColor: bg,
        },
        styles.fallback,
        style,
      ]}
    >
      <Text style={[styles.text, { fontSize: s.fontSize }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: C.surfaceSecondary,
  },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    color: "#FFFFFF",
    fontFamily: "Inter_700Bold",
  },
});
