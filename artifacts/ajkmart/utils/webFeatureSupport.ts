import { Platform } from "react-native";

/**
 * Returns true when running on web where mobile-only features are unavailable.
 */
export const isWeb = Platform.OS === "web";

/**
 * Feature availability flags for web vs native.
 * Use these to guard UI elements and interactions that rely on
 * platform-only APIs so users see clear "not supported" messaging
 * instead of silent failures.
 */
export const webFeatureSupport = {
  /** Biometric authentication (Face ID / Fingerprint) */
  biometrics: !isWeb,
  /** Background GPS location updates via expo-task-manager */
  backgroundLocation: !isWeb,
  /** Reverse geocoding (address lookup from coordinates) */
  geocoding: !isWeb,
  /**
   * Haptic feedback — intentional no-op on web, does not affect UI.
   * Haptics are enhancement-only; no user-visible features should depend on them.
   */
  haptics: !isWeb,
  /** Hardware-backed secure keychain storage */
  secureKeychain: !isWeb,
  /** Background task scheduling */
  backgroundTasks: !isWeb,
} as const;

/**
 * Returns a user-friendly message explaining why a feature is not available on web.
 */
export function getWebUnsupportedMessage(feature: keyof typeof webFeatureSupport): string {
  const messages: Record<keyof typeof webFeatureSupport, string> = {
    biometrics: "Biometric login is not available on web. Please use the mobile app or sign in with your password.",
    backgroundLocation: "Background location tracking requires the mobile app.",
    geocoding: "Address lookup from coordinates is not available on web. Your GPS coordinates were captured.",
    haptics: "Haptic feedback is not available on web.",
    secureKeychain: "Hardware-backed secure storage is not available on web. Credentials are stored in browser storage.",
    backgroundTasks: "Background tasks are not supported on web.",
  };
  return messages[feature];
}

function hasCode(err: unknown): err is { code: string } {
  return typeof err === "object" && err !== null && "code" in err && typeof (err as Record<string, unknown>).code === "string";
}

/**
 * Checks if an error is a GEOCODING_UNSUPPORTED_ON_WEB error thrown by the
 * expo-location web shim. Use this in catch blocks at all reverseGeocodeAsync /
 * geocodeAsync callsites to surface a visible fallback message to the user.
 *
 * Example:
 *   try {
 *     const [geo] = await Location.reverseGeocodeAsync({ ... });
 *   } catch (err) {
 *     if (isGeocodingUnsupportedOnWeb(err)) {
 *       showToast("Address lookup unavailable on web — showing your coordinates", "info");
 *     }
 *   }
 */
export function isGeocodingUnsupportedOnWeb(err: unknown): boolean {
  return hasCode(err) && err.code === "GEOCODING_UNSUPPORTED_ON_WEB";
}
