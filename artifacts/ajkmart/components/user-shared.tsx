import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Pressable,
  View,
  Text,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Colors, { spacing, radii, shadows, typography } from "@/constants/colors";

const C = Colors.light;
export { C as userColors };

export function AnimatedPressable({
  children,
  onPress,
  onLongPress,
  style,
  delay = 0,
  disabled,
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
}: {
  children: React.ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  delay?: number;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "link" | "tab" | "none";
  accessibilityState?: { selected?: boolean; disabled?: boolean };
}) {
  const sc = useRef(new Animated.Value(delay > 0 ? 0.96 : 1)).current;
  const op = useRef(new Animated.Value(delay > 0 ? 0 : 1)).current;

  useEffect(() => {
    if (delay > 0) {
      Animated.parallel([
        Animated.spring(sc, { toValue: 1, useNativeDriver: true, delay, tension: 50, friction: 7 }),
        Animated.timing(op, { toValue: 1, duration: 300, delay, useNativeDriver: true }),
      ]).start();
    }
  }, []);

  const onIn = () => {
    if (!disabled) Animated.spring(sc, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start();
  };
  const onOut = () => {
    Animated.spring(sc, { toValue: 1, useNativeDriver: true, speed: 35 }).start();
  };

  return (
    <Animated.View style={[{ opacity: op, transform: [{ scale: sc }] }, style]}>
      <Pressable
        onPressIn={onIn}
        onPressOut={onOut}
        onPress={onPress}
        onLongPress={onLongPress}
        disabled={disabled}
        style={{ flex: 1 }}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole ?? "button"}
        accessibilityState={accessibilityState}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

export function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
  style,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[us.secRow, style]}>
      <View style={{ flex: 1 }}>
        <Text style={us.secTitle}>{title}</Text>
        {subtitle ? <Text style={us.secSub}>{subtitle}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" accessibilityLabel={actionLabel}>
          <Text style={us.secAction}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function SkeletonBlock({ w, h, r = radii.lg, style }: { w: number | string; h: number; r?: number; style?: StyleProp<ViewStyle> }) {
  const op = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(op, { toValue: 0.7, duration: 700, useNativeDriver: true }),
        Animated.timing(op, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ])
    );
    blink.start();
    return () => blink.stop();
  }, []);
  return (
    <Animated.View
      style={[
        {
          width: w as any,
          height: h,
          borderRadius: r,
          backgroundColor: "#CBD5E1",
          opacity: op,
        },
        style,
      ]}
    />
  );
}

export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <View style={{ gap: spacing.md, paddingHorizontal: spacing.lg }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <SkeletonBlock w={44} h={44} r={radii.lg} />
          <View style={{ flex: 1, gap: 6 }}>
            <SkeletonBlock w="70%" h={14} r={6} />
            <SkeletonBlock w="45%" h={10} r={4} />
          </View>
          <SkeletonBlock w={60} h={14} r={6} />
        </View>
      ))}
    </View>
  );
}

export function FilterChip({
  label,
  icon,
  active,
  onPress,
  color,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
  color?: string;
}) {
  const accentColor = color ?? C.primary;
  return (
    <Pressable
      onPress={onPress}
      style={[us.chip, active && { backgroundColor: accentColor }]}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      {icon ? <Ionicons name={icon} size={14} color={active ? "#fff" : C.textSecondary} /> : null}
      <Text style={[us.chipText, active && { color: "#fff" }]}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[us.chipRow, style]}>
      {children}
    </View>
  );
}

export function StatCard({
  icon,
  label,
  value,
  color,
  bg,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string | number;
  color: string;
  bg: string;
}) {
  return (
    <View style={[us.statCard, { backgroundColor: bg }]} accessibilityLabel={`${label}: ${value}`}>
      <View style={[us.statIcon, { backgroundColor: color + "18" }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={us.statValue}>{value}</Text>
      <Text style={us.statLabel}>{label}</Text>
    </View>
  );
}

export function ListItem({
  icon,
  iconColor,
  iconBg,
  title,
  subtitle,
  right,
  onPress,
  danger,
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  iconBg?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
  accessibilityLabel?: string;
}) {
  const color = danger ? C.danger : (iconColor ?? C.text);
  const bg = danger ? C.dangerSoft : (iconBg ?? C.primarySoft);

  const content = (
    <View style={us.listRow}>
      <View style={[us.listIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[us.listTitle, danger && { color: C.danger }]}>{title}</Text>
        {subtitle ? <Text style={us.listSub}>{subtitle}</Text> : null}
      </View>
      {right ?? <Ionicons name="chevron-forward" size={16} color={C.textMuted} />}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
      >
        {content}
      </Pressable>
    );
  }
  return content;
}

export function GradientCard({
  colors,
  children,
  style,
  onPress,
  accessibilityLabel,
}: {
  colors: [string, string] | [string, string, string];
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const card = (
    <LinearGradient
      colors={colors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[us.gradCard, style]}
    >
      {children}
    </LinearGradient>
  );

  if (onPress) {
    return (
      <AnimatedPressable onPress={onPress} accessibilityLabel={accessibilityLabel} style={{ borderRadius: radii.xxl, overflow: "hidden" }}>
        {card}
      </AnimatedPressable>
    );
  }
  return <View style={{ borderRadius: radii.xxl, overflow: "hidden" }}>{card}</View>;
}

export function EmptyState({
  icon,
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={us.empty}>
      <View style={us.emptyCircle}>
        <Ionicons name={icon} size={36} color={C.textMuted} />
      </View>
      <Text style={us.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={us.emptySub}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} style={us.emptyCta} accessibilityRole="button" accessibilityLabel={actionLabel}>
          <Text style={us.emptyCtaTxt}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function StatusBadge({
  label,
  color,
  bg,
  icon,
}: {
  label: string;
  color: string;
  bg: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={[us.badge, { backgroundColor: bg }]} accessibilityLabel={`Status: ${label}`}>
      {icon ? <Ionicons name={icon} size={13} color={color} /> : null}
      <Text style={[us.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[us.divider, style]} />;
}

export function CardSurface({
  children,
  style,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const content = <View style={[us.surface, style]}>{children}</View>;
  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
        {content}
      </Pressable>
    );
  }
  return content;
}

const us = StyleSheet.create({
  secRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  secTitle: { ...typography.h3, color: C.text },
  secSub: { ...typography.caption, color: C.textMuted, marginTop: 2 },
  secAction: { ...typography.captionMedium, color: C.primary },

  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.full,
    backgroundColor: C.surfaceSecondary,
  },
  chipText: { ...typography.captionMedium, color: C.textSecondary },

  statCard: {
    flex: 1,
    borderRadius: radii.xl,
    padding: spacing.lg,
    alignItems: "center",
    gap: 6,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.lg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  statValue: { ...typography.h3, color: C.text },
  statLabel: { ...typography.caption, color: C.textMuted, textAlign: "center" },

  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  listIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  listTitle: { ...typography.bodyMedium, color: C.text },
  listSub: { ...typography.caption, color: C.textMuted, marginTop: 2 },

  gradCard: {
    borderRadius: radii.xxl,
    padding: spacing.xl,
    overflow: "hidden",
  },

  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: C.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: { ...typography.h3, color: C.text, textAlign: "center", marginBottom: 8 },
  emptySub: { ...typography.body, color: C.textMuted, textAlign: "center", lineHeight: 21 },
  emptyCta: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radii.lg,
    backgroundColor: C.primarySoft,
  },
  emptyCtaTxt: { ...typography.captionMedium, color: C.primary },

  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.full,
  },
  badgeText: { ...typography.captionMedium },

  divider: {
    height: 1,
    backgroundColor: C.border,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
  },

  surface: {
    backgroundColor: C.surface,
    borderRadius: radii.xl,
    ...shadows.sm,
    marginHorizontal: spacing.lg,
    overflow: "hidden",
  },
});
