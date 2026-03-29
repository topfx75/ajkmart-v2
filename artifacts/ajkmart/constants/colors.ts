const primary = "#0066FF";
const primaryLight = "#4D94FF";
const primaryDark = "#0047B3";
const primarySoft = "#E8F1FF";
const accent = "#FF9500";
const accentSoft = "#FFF4E5";
const success = "#00C48C";
const successSoft = "#E5F9F2";
const danger = "#FF3B30";
const dangerSoft = "#FFE5E3";
const warning = "#FF9500";
const warningSoft = "#FFF4E5";
const info = "#5856D6";
const infoSoft = "#EEEEFF";

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  full: 999,
} as const;

export const typography = {
  h1: { fontFamily: "Inter_700Bold", fontSize: 28, lineHeight: 34 },
  h2: { fontFamily: "Inter_700Bold", fontSize: 22, lineHeight: 28 },
  h3: { fontFamily: "Inter_700Bold", fontSize: 18, lineHeight: 24 },
  subtitle: { fontFamily: "Inter_600SemiBold", fontSize: 16, lineHeight: 22 },
  body: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  bodyMedium: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20 },
  bodySemiBold: { fontFamily: "Inter_600SemiBold", fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 16 },
  captionMedium: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 16 },
  small: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 14 },
  smallMedium: { fontFamily: "Inter_500Medium", fontSize: 11, lineHeight: 14 },
  button: { fontFamily: "Inter_600SemiBold", fontSize: 15, lineHeight: 20 },
  buttonSmall: { fontFamily: "Inter_600SemiBold", fontSize: 13, lineHeight: 18 },
  tabLabel: { fontFamily: "Inter_500Medium", fontSize: 11, lineHeight: 14 },
  otp: { fontFamily: "Inter_700Bold", fontSize: 24, lineHeight: 30 },
} as const;

export const shadows = {
  sm: {
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  md: {
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 6,
  },
  xl: {
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 10,
  },
} as const;

export default {
  light: {
    primary,
    primaryLight,
    primaryDark,
    primarySoft,
    accent,
    accentSoft,
    success,
    successSoft,
    danger,
    dangerSoft,
    warning,
    warningSoft,
    info,
    infoSoft,
    text: "#0F172A",
    textSecondary: "#475569",
    textMuted: "#94A3B8",
    textInverse: "#FFFFFF",
    background: "#F1F5F9",
    surface: "#FFFFFF",
    surfaceSecondary: "#F8FAFC",
    surfaceElevated: "#FFFFFF",
    border: "#E2E8F0",
    borderLight: "#F1F5F9",
    tint: primary,
    tabIconDefault: "#94A3B8",
    tabIconSelected: primary,
    shadow: "rgba(15, 23, 42, 0.06)",
    overlay: "rgba(15, 23, 42, 0.5)",

    mart: "#00C48C",
    martLight: "#E5F9F2",
    food: "#FF9500",
    foodLight: "#FFF4E5",
    ride: "#0066FF",
    rideLight: "#E8F1FF",
    wallet: "#5856D6",
    walletLight: "#EEEEFF",
    pharmacy: "#AF52DE",
    pharmacyLight: "#F5E6FF",
    parcel: "#FF6B35",
    parcelLight: "#FFF0EB",
  },
};
