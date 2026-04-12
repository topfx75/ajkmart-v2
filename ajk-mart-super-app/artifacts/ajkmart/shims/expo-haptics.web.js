/**
 * expo-haptics web shim
 * Haptic feedback is not available in browsers — all functions are intentional no-ops.
 * Haptics are an enhancement-only feature; callers must not gate user-visible
 * content or flows on haptic feedback success.
 */

export async function impactAsync(_style) {}
export async function notificationAsync(_type) {}
export async function selectionAsync() {}

export const ImpactFeedbackStyle = {
  Light: "light",
  Medium: "medium",
  Heavy: "heavy",
  Rigid: "rigid",
  Soft: "soft",
};

export const NotificationFeedbackType = {
  Success: "success",
  Warning: "warning",
  Error: "error",
};
