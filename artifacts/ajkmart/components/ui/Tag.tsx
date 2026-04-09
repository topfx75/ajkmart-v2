import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import { TouchableOpacity, StyleSheet, Text, View } from "react-native";
import Colors, { radii, spacing, typography } from "@/constants/colors";

const C = Colors.light;

type TagVariant = "success" | "warning" | "danger" | "info" | "neutral" | "primary";

const VARIANT_MAP: Record<TagVariant, { bg: string; text: string; border: string }> = {
  success: { bg: C.successSoft, text: C.success, border: C.successSoft },
  warning: { bg: C.warningSoft, text: "#B45309", border: C.warningSoft },
  danger: { bg: C.dangerSoft, text: C.danger, border: C.dangerSoft },
  info: { bg: C.primarySoft, text: C.primary, border: C.primarySoft },
  neutral: { bg: "#F1F5F9", text: C.textSecondary, border: "#E2E8F0" },
  primary: { bg: C.primarySoft, text: C.primary, border: C.primarySoft },
};

interface TagProps {
  label: string;
  variant?: TagVariant;
  icon?: keyof typeof Ionicons.glyphMap;
  size?: "sm" | "md";
  onRemove?: () => void;
  outlined?: boolean;
}

export function Tag({
  label,
  variant = "neutral",
  icon,
  size = "sm",
  onRemove,
  outlined = false,
}: TagProps) {
  const v = VARIANT_MAP[variant];
  const isSm = size === "sm";

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: outlined ? "transparent" : v.bg,
          borderColor: v.border,
          borderWidth: outlined ? 1.5 : 0,
          paddingHorizontal: isSm ? 8 : 12,
          paddingVertical: isSm ? 3 : 5,
        },
      ]}
    >
      {icon && <Ionicons name={icon} size={isSm ? 11 : 13} color={v.text} />}
      <Text style={[isSm ? typography.small : typography.captionMedium, { color: v.text }]}>
        {label}
      </Text>
      {onRemove && (
        <TouchableOpacity activeOpacity={0.7} onPress={onRemove} hitSlop={8}>
          <Ionicons name="close-circle" size={isSm ? 13 : 15} color={v.text} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radii.full,
    alignSelf: "flex-start",
  },
});
