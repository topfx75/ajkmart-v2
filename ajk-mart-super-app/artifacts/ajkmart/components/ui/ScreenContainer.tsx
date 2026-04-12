import React from "react";
import { Platform, ScrollView, StyleSheet, View, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";

const C = Colors.light;

interface ScreenContainerProps {
  children: React.ReactNode;
  scroll?: boolean;
  edges?: ("top" | "bottom" | "left" | "right")[];
  backgroundColor?: string;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
  keyboardAware?: boolean;
}

export function ScreenContainer({
  children,
  scroll = true,
  edges = ["top", "left", "right"],
  backgroundColor = C.background,
  style,
  contentStyle,
  keyboardAware = false,
}: ScreenContainerProps) {
  const inner = scroll ? (
    keyboardAware ? (
      <KeyboardAwareScrollViewCompat
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, contentStyle]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </KeyboardAwareScrollViewCompat>
    ) : (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, contentStyle]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    )
  ) : (
    <View style={[styles.fill, contentStyle]}>{children}</View>
  );

  return (
    <SafeAreaView edges={edges} style={[styles.safe, { backgroundColor }, style]}>
      {inner}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: Platform.OS === "web" ? 40 : 100,
  },
});
