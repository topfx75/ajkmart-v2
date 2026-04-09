/**
 * expo-local-authentication web shim
 * Biometric authentication is not available in browsers via this API.
 * All capability queries return false/empty, and authenticate returns
 * a typed failure result that callers can inspect.
 */

export async function hasHardwareAsync() {
  return false;
}

export async function isEnrolledAsync() {
  return false;
}

export async function supportedAuthenticationTypesAsync() {
  return [];
}

export async function authenticateAsync(_options) {
  return { success: false, error: "not_available", warning: "Biometric authentication is not supported on web. Please use the mobile app or another sign-in method." };
}

export async function cancelAuthenticate() {}

export async function getEnrolledLevelAsync() {
  return 0;
}

export const AuthenticationType = {
  FINGERPRINT: 1,
  FACIAL_RECOGNITION: 2,
  IRIS: 3,
};

export const SecurityLevel = {
  NONE: 0,
  SECRET: 1,
  BIOMETRIC_WEAK: 2,
  BIOMETRIC_STRONG: 3,
};
