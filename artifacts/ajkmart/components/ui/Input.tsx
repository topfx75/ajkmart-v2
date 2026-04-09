import Ionicons from "@expo/vector-icons/Ionicons";
import React, { useState } from "react";
import {
  TouchableOpacity,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import Colors, { radii, typography } from "@/constants/colors";

const C = Colors.light;

interface InputProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string;
  success?: string;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  leftElement?: React.ReactNode;
  rightElement?: React.ReactNode;
  isPassword?: boolean;
  maxLength?: number;
  showCharCount?: boolean;
  clearable?: boolean;
  onClear?: () => void;
}

export function Input({
  label,
  hint,
  error,
  success,
  leftIcon,
  leftElement,
  rightElement,
  isPassword,
  maxLength,
  showCharCount,
  clearable,
  onClear,
  value,
  style,
  ...props
}: InputProps) {
  const [showPwd, setShowPwd] = useState(false);
  const hasError = !!error;
  const hasSuccess = !!success;

  const charCount = value?.length ?? 0;
  const showClear = clearable && charCount > 0;

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View
        style={[
          styles.inputWrapper,
          hasError && styles.inputError,
          hasSuccess && styles.inputSuccess,
        ]}
      >
        {leftElement && <View style={styles.leftElement}>{leftElement}</View>}
        {leftIcon && !leftElement && (
          <View style={styles.leftIconWrap}>
            <Ionicons
              name={leftIcon}
              size={18}
              color={hasError ? C.danger : hasSuccess ? C.success : C.textMuted}
            />
          </View>
        )}
        <TextInput
          style={[styles.input, style]}
          placeholderTextColor={C.textMuted}
          secureTextEntry={isPassword && !showPwd}
          value={value}
          maxLength={maxLength}
          {...props}
        />
        {showClear && !isPassword && (
          <TouchableOpacity activeOpacity={0.7}
            onPress={() => {
              if (onClear) onClear();
              else if (props.onChangeText) props.onChangeText("");
            }}
            style={styles.clearBtn}
            hitSlop={8}
          >
            <Ionicons name="close-circle" size={18} color={C.textMuted} />
          </TouchableOpacity>
        )}
        {isPassword && (
          <TouchableOpacity activeOpacity={0.7} onPress={() => setShowPwd((v) => !v)} style={styles.eyeBtn}>
            <Ionicons
              name={showPwd ? "eye-off-outline" : "eye-outline"}
              size={20}
              color={C.textMuted}
            />
          </TouchableOpacity>
        )}
        {rightElement && <View style={styles.rightElement}>{rightElement}</View>}
      </View>
      <View style={styles.footer}>
        {error ? (
          <View style={styles.feedbackRow}>
            <Ionicons name="alert-circle" size={13} color={C.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : success ? (
          <View style={styles.feedbackRow}>
            <Ionicons name="checkmark-circle" size={13} color={C.success} />
            <Text style={styles.successText}>{success}</Text>
          </View>
        ) : hint ? (
          <Text style={styles.hint}>{hint}</Text>
        ) : (
          <View />
        )}
        {showCharCount && maxLength && (
          <Text style={[styles.charCount, charCount >= maxLength && { color: C.danger }]}>
            {charCount}/{maxLength}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 14 },
  label: { ...typography.captionMedium, color: C.textSecondary, marginBottom: 6 },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: radii.lg,
    backgroundColor: C.surfaceSecondary,
    overflow: "hidden",
  },
  inputError: {
    borderColor: C.danger,
    backgroundColor: C.dangerSoft,
  },
  inputSuccess: {
    borderColor: C.success,
    backgroundColor: C.successSoft,
  },
  leftElement: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: C.surface,
    borderRightWidth: 1,
    borderRightColor: C.border,
  },
  leftIconWrap: {
    paddingLeft: 14,
  },
  rightElement: {
    paddingRight: 14,
  },
  input: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    ...typography.bodyMedium,
    color: C.text,
  },
  eyeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  clearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 14,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
    paddingLeft: 2,
    minHeight: 16,
  },
  feedbackRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flex: 1,
  },
  errorText: { ...typography.small, color: C.danger },
  successText: { ...typography.small, color: C.success },
  hint: { ...typography.small, color: C.textMuted },
  charCount: { ...typography.small, color: C.textMuted, marginLeft: 8 },
});
