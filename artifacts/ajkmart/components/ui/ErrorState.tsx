import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Colors, { spacing, typography } from "@/constants/colors";
import { ActionButton } from "./ActionButton";

const C = Colors.light;

interface ErrorStateProps {
  title?: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  emoji?: string;
  retryLabel?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = "Something went wrong",
  subtitle = "Please try again later.",
  icon = "alert-circle-outline",
  emoji,
  retryLabel = "Try Again",
  onRetry,
}: ErrorStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        {emoji ? (
          <Text style={styles.emoji}>{emoji}</Text>
        ) : (
          <Ionicons name={icon} size={44} color={C.danger} />
        )}
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {onRetry && (
        <View style={styles.btnWrap}>
          <ActionButton
            label={retryLabel}
            onPress={onRetry}
            variant="outline"
            size="sm"
            icon="refresh-outline"
            fullWidth={false}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    paddingHorizontal: spacing.xxxl,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: C.dangerSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xl,
  },
  emoji: { fontSize: 44 },
  title: { ...typography.h3, color: C.text, textAlign: "center", marginBottom: spacing.sm },
  subtitle: { ...typography.body, color: C.textMuted, textAlign: "center", lineHeight: 21 },
  btnWrap: { marginTop: spacing.xl },
});
