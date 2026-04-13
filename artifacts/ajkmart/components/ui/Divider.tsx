import React from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import Colors, { spacing, typography } from "@/constants/colors";

const C = Colors.light;

interface DividerProps {
  label?: string;
  spacing?: number;
  color?: string;
  style?: ViewStyle;
}

export function Divider({
  label,
  spacing: verticalSpacing = spacing.lg,
  color = C.border,
  style,
}: DividerProps) {
  if (label) {
    return (
      <View style={[styles.labelContainer, { marginVertical: verticalSpacing }, style]}>
        <View style={[styles.line, { backgroundColor: color }]} />
        <Text style={styles.label}>{label}</Text>
        <View style={[styles.line, { backgroundColor: color }]} />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.simple,
        { backgroundColor: color, marginVertical: verticalSpacing },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  simple: {
    height: 1,
    width: "100%",
  },
  labelContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  line: {
    flex: 1,
    height: 1,
  },
  label: {
    ...typography.captionMedium,
    color: C.textMuted,
  },
});
