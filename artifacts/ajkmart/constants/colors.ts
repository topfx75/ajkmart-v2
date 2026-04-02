import { Platform } from "react-native";

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

export function getTypography(language: string) {
  const isUrdu = language === "ur" || language === "en_ur";

  const regular = isUrdu ? "NotoNastaliqUrdu_400Regular" : "Inter_400Regular";
  const medium = isUrdu ? "NotoNastaliqUrdu_500Medium" : "Inter_500Medium";
  const semiBold = isUrdu ? "NotoNastaliqUrdu_600SemiBold" : "Inter_600SemiBold";
  const bold = isUrdu ? "NotoNastaliqUrdu_700Bold" : "Inter_700Bold";

  return {
    h1: { fontFamily: bold, fontSize: 28, lineHeight: isUrdu ? 48 : 34 },
    h2: { fontFamily: bold, fontSize: 22, lineHeight: isUrdu ? 40 : 28 },
    h3: { fontFamily: bold, fontSize: 18, lineHeight: isUrdu ? 34 : 24 },
    subtitle: { fontFamily: semiBold, fontSize: 16, lineHeight: isUrdu ? 30 : 22 },
    body: { fontFamily: regular, fontSize: 14, lineHeight: isUrdu ? 30 : 20 },
    bodyMedium: { fontFamily: medium, fontSize: 14, lineHeight: isUrdu ? 30 : 20 },
    bodySemiBold: { fontFamily: semiBold, fontSize: 14, lineHeight: isUrdu ? 30 : 20 },
    caption: { fontFamily: regular, fontSize: 12, lineHeight: isUrdu ? 24 : 16 },
    captionMedium: { fontFamily: medium, fontSize: 12, lineHeight: isUrdu ? 24 : 16 },
    small: { fontFamily: regular, fontSize: 11, lineHeight: isUrdu ? 22 : 14 },
    smallMedium: { fontFamily: medium, fontSize: 11, lineHeight: isUrdu ? 22 : 14 },
    button: { fontFamily: semiBold, fontSize: 15, lineHeight: isUrdu ? 28 : 20 },
    buttonSmall: { fontFamily: semiBold, fontSize: 13, lineHeight: isUrdu ? 26 : 18 },
    tabLabel: { fontFamily: medium, fontSize: 11, lineHeight: isUrdu ? 22 : 14 },
    otp: { fontFamily: bold, fontSize: 24, lineHeight: isUrdu ? 44 : 30 },
  };
}

export function getFontFamily(language: string) {
  const isUrdu = language === "ur" || language === "en_ur";
  return {
    regular: isUrdu ? "NotoNastaliqUrdu_400Regular" : "Inter_400Regular",
    medium: isUrdu ? "NotoNastaliqUrdu_500Medium" : "Inter_500Medium",
    semiBold: isUrdu ? "NotoNastaliqUrdu_600SemiBold" : "Inter_600SemiBold",
    bold: isUrdu ? "NotoNastaliqUrdu_700Bold" : "Inter_700Bold",
    isUrdu,
  };
}

const _mkShadow = (yOff: number, blur: number, opacity: number, elev: number) =>
  Platform.OS === "web"
    ? { boxShadow: `0 ${yOff}px ${blur}px rgba(15,23,42,${opacity})` }
    : { shadowColor: "#0F172A", shadowOffset: { width: 0, height: yOff }, shadowOpacity: opacity, shadowRadius: blur, elevation: elev };

export const shadows = {
  sm: _mkShadow(1, 3, 0.04, 1),
  md: _mkShadow(2, 8, 0.06, 3),
  lg: _mkShadow(4, 16, 0.08, 6),
  xl: _mkShadow(8, 24, 0.12, 10),
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
    inputBg: "#F8F9FA",
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
