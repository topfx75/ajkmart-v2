import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import {
  Modal as RNModal,
  TouchableOpacity,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Colors, { radii, shadows, spacing, typography } from "@/constants/colors";

const C = Colors.light;

interface ModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  showCloseButton?: boolean;
}

export function Modal({
  visible,
  onClose,
  title,
  subtitle,
  children,
  showCloseButton = true,
}: ModalProps) {
  return (
    <RNModal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={0.7} style={styles.overlay} onPress={onClose}>
        <TouchableOpacity activeOpacity={0.7} style={styles.content} onPress={(e) => e.stopPropagation()}>
          {(title || showCloseButton) && (
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                {title && <Text style={styles.title}>{title}</Text>}
                {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
              </View>
              {showCloseButton && (
                <TouchableOpacity activeOpacity={0.7} onPress={onClose} style={styles.closeBtn} hitSlop={8}>
                  <Ionicons name="close" size={22} color={C.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
          )}
          {children}
        </TouchableOpacity>
      </TouchableOpacity>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: C.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xxl,
  },
  content: {
    backgroundColor: C.surface,
    borderRadius: radii.xxl,
    padding: spacing.xxl,
    maxWidth: 400,
    width: "100%",
    ...shadows.xl,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: spacing.lg,
  },
  title: { ...typography.h3, color: C.text },
  subtitle: { ...typography.caption, color: C.textMuted, marginTop: 4 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: spacing.sm,
  },
});
