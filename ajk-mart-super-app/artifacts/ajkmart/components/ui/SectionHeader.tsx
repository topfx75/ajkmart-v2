import React from "react";
import { TouchableOpacity, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import Colors, { spacing, typography } from "@/constants/colors";

const C = Colors.light;

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function SectionHeader({ title, subtitle, actionLabel, onAction }: SectionHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      {actionLabel && onAction && (
        <TouchableOpacity activeOpacity={0.7} onPress={onAction} style={styles.action}>
          <Text style={styles.actionText}>{actionLabel}</Text>
          <Ionicons name="chevron-forward" size={14} color={C.primary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  title: { ...typography.h3, color: C.text },
  subtitle: { ...typography.caption, color: C.textMuted, marginTop: 2 },
  action: { flexDirection: "row", alignItems: "center", gap: 2 },
  actionText: { ...typography.captionMedium, color: C.primary },
});
