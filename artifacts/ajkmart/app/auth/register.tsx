import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors, { spacing, radii, shadows, typography } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { normalizePhone, isValidPakistaniPhone } from "@/utils/phone";

import {
  OtpDigitInput,
  AuthButton,
  AlertBox,
  PhoneInput,
  InputField,
  PasswordStrengthBar,
  StepProgress,
  DevOtpBanner,
  authColors as C,
} from "@/components/auth-shared";

const API = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}/api`;

type RegStep = 1 | 2 | 3 | 4;

function formatCnic(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 13);
  if (digits.length <= 5) return digits;
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const { config } = usePlatformConfig();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [step, setStep] = useState<RegStep>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [userId, setUserId] = useState("");

  const [authToken, setAuthToken] = useState("");
  const [authRefreshToken, setAuthRefreshToken] = useState("");
  const [authUser, setAuthUser] = useState<any>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [cnic, setCnic] = useState("");

  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const signupBonus = config.customer.signupBonus;

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const clearError = () => setError("");

  const normalizedPhone = normalizePhone(phone);

  const handleSendOtp = async () => {
    clearError();
    if (!isValidPakistaniPhone(phone)) { setError("Please enter a valid Pakistani phone number (e.g. 03XX-XXXXXXX)"); return; }
    if (resendCooldown > 0) return;
    setLoading(true);
    try {
      if (!otpSent) {
        const regRes = await fetch(`${API}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: normalizedPhone }),
        });
        const regData = await regRes.json();
        if (!regRes.ok) {
          if (regRes.status === 409) {
            setError("An account already exists with this number. Please log in.");
          } else {
            setError(regData.error || "Registration failed. Please try again.");
          }
          setLoading(false);
          return;
        }
        if (regData.userId) setUserId(regData.userId);
      }

      const sendOtpRes = await fetch(`${API}/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizedPhone }),
      });
      const sendOtpData = await sendOtpRes.json();
      if (!sendOtpRes.ok) {
        const msg: string = sendOtpData.error || "Could not send OTP.";
        setError(msg);
        const match = msg.match(/wait (\d+) second/);
        if (match) setResendCooldown(parseInt(match[1]!, 10));
        setLoading(false);
        return;
      }
      if (__DEV__ === true && sendOtpData.otp) setDevOtp(sendOtpData.otp);
      setResendCooldown(60);
      setOtpSent(true);
    } catch (e: any) {
      setError(e.message || "Could not send OTP.");
    }
    setLoading(false);
  };

  const handleVerifyOtp = async () => {
    clearError();
    if (!otp || otp.length < 6) { setError("Please enter the 6-digit OTP"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizedPhone, otp }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Invalid OTP."); setLoading(false); return; }
      if (data.user?.id) setUserId(data.user.id);
      if (data.token) {
        setAuthToken(data.token);
        try {
          const SecureStore = await import("expo-secure-store");
          await SecureStore.setItemAsync("ajkmart_reg_token", data.token);
        } catch {}
      }
      if (data.refreshToken) setAuthRefreshToken(data.refreshToken);
      if (data.user) setAuthUser(data.user);
      setStep(2);
    } catch (e: any) { setError(e.message || "Verification fail."); }
    setLoading(false);
  };

  const handleStep2 = () => {
    clearError();
    if (!name.trim() || name.trim().length < 2) { setError("Please enter your name (at least 2 characters)"); return; }
    if (cnic && !/^\d{5}-\d{7}-\d{1}$/.test(cnic)) { setError("CNIC format: XXXXX-XXXXXXX-X"); return; }
    setStep(3);
  };

  const handleStep3 = async () => {
    clearError();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address");
      return;
    }
    if (!password || password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (!/[A-Z]/.test(password)) { setError("Password must contain at least 1 uppercase letter"); return; }
    if (!/[0-9]/.test(password)) { setError("Password must contain at least 1 number"); return; }
    if (!termsAccepted) { setError("Please accept the Terms & Conditions"); return; }

    setLoading(true);
    try {
      let activeToken = authToken;
      if (!activeToken) {
        try {
          const SecureStore = await import("expo-secure-store");
          activeToken = await SecureStore.getItemAsync("ajkmart_reg_token") || "";
        } catch {}
      }
      if (!activeToken) {
        setError("Session expired. Please go back and verify OTP again.");
        setLoading(false);
        return;
      }

      const profileRes = await fetch(`${API}/auth/complete-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${activeToken}` },
        body: JSON.stringify({
          name: name.trim(),
          ...(email && { email: email.trim().toLowerCase() }),
          ...(cnic && { cnic: cnic.trim() }),
          password,
        }),
      });
      const profileData = await profileRes.json();

      if (!profileRes.ok) {
        setError(profileData.error || "Could not save profile. Please try again.");
        setLoading(false);
        return;
      }

      if (profileData.token) setAuthToken(profileData.token);
      if (profileData.refreshToken) setAuthRefreshToken(profileData.refreshToken);
      if (profileData.user) setAuthUser(profileData.user);

      setStep(4);
    } catch (e: any) { setError(e.message || "Could not save profile."); }
    setLoading(false);
  };

  const handleFinish = async () => {
    setLoading(true);
    try {
      let finalToken = authToken;
      if (!finalToken) {
        try {
          const SecureStore = await import("expo-secure-store");
          finalToken = await SecureStore.getItemAsync("ajkmart_reg_token") || "";
        } catch {}
      }
      if (finalToken && authUser) {
        const userData = {
          ...authUser,
          walletBalance: authUser.walletBalance ?? 0,
          isActive: authUser.isActive ?? true,
          createdAt: authUser.createdAt ?? new Date().toISOString(),
        };
        await login(userData, finalToken, authRefreshToken || undefined);
        try {
          const SecureStore = await import("expo-secure-store");
          await SecureStore.deleteItemAsync("ajkmart_reg_token");
        } catch {}
        router.replace("/(tabs)");
      } else {
        router.replace("/auth");
      }
    } catch (e: unknown) {
      console.warn("Login after registration failed:", e instanceof Error ? e.message : e);
      router.replace("/auth");
    }
    setLoading(false);
  };

  const stepLabels = ["Verify", "Details", "Security", "Done"];

  if (step === 4) {
    return (
      <LinearGradient colors={[C.primaryDark, C.primary, C.primaryLight]} style={s.gradient}>
        <ScrollView contentContainerStyle={s.successScroll}>
          <View style={s.successCard}>
            <View style={s.successIconWrap}>
              <View style={s.successIconCircle}>
                <Ionicons name="checkmark" size={40} color="#fff" />
              </View>
            </View>
            <Text style={s.successTitle}>Registration Successful!</Text>
            <Text style={s.successSub}>
              Welcome to {config.platform.appName}! Your account is ready.
            </Text>
            {signupBonus > 0 && (
              <View style={s.bonusBanner}>
                <View style={s.bonusIconWrap}>
                  <Ionicons name="gift" size={22} color={C.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.bonusTitle}>Welcome Bonus!</Text>
                  <Text style={s.bonusSub}>Rs. {signupBonus} has been added to your wallet</Text>
                </View>
              </View>
            )}
            <AuthButton label="Start Shopping" onPress={handleFinish} loading={loading} icon="cart-outline" />
          </View>
        </ScrollView>
      </LinearGradient>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
      <LinearGradient colors={[C.primaryDark, C.primary, C.primaryLight]} style={s.gradient}>
        <View style={[s.topSection, { paddingTop: topPad + 16 }]}>
          <Pressable
            onPress={() => step === 1 ? router.back() : setStep((step - 1) as RegStep)}
            style={s.backBtn}
            accessibilityLabel={step === 1 ? "Go back" : "Previous step"}
            accessibilityRole="button"
          >
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <Text style={s.headerTitle}>Create Account</Text>
          <Text style={s.headerSub}>
            {step === 1 ? "Verify your phone number" : step === 2 ? "Tell us about yourself" : "Set your password"}
          </Text>

          <View style={s.progressRow}>
            <StepProgress total={4} current={step} />
          </View>
          <View style={s.stepLabels}>
            {stepLabels.map((label, i) => (
              <Text key={label} style={[s.stepLabel, step >= i + 1 && s.stepLabelActive]}>{label}</Text>
            ))}
          </View>
        </View>

        <ScrollView style={s.card} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {step === 1 && (
            <>
              {!otpSent ? (
                <>
                  <Text style={s.fieldLabel}>Phone Number</Text>
                  <PhoneInput
                    value={phone}
                    onChangeText={v => { setPhone(v); clearError(); }}
                    autoFocus
                  />
                </>
              ) : (
                <>
                  <Pressable
                    onPress={() => { setOtpSent(false); setOtp(""); clearError(); }}
                    style={s.changeBtn}
                    accessibilityRole="button"
                  >
                    <Ionicons name="arrow-back" size={14} color={C.primary} />
                    <Text style={s.changeBtnText}>Change Number</Text>
                  </Pressable>

                  <Text style={s.fieldLabel}>Enter Verification Code</Text>
                  <Text style={s.fieldSub}>Code sent to +92 {phone}</Text>

                  <OtpDigitInput
                    value={otp}
                    onChangeText={v => { setOtp(v); clearError(); }}
                    hasError={!!error}
                    onComplete={() => handleVerifyOtp()}
                  />

                  <DevOtpBanner otp={__DEV__ ? devOtp : ""} />

                  <Pressable
                    onPress={handleSendOtp}
                    style={[s.resendBtn, resendCooldown > 0 && s.resendDisabled]}
                    disabled={resendCooldown > 0}
                    accessibilityRole="button"
                  >
                    <Ionicons name="refresh-outline" size={16} color={resendCooldown > 0 ? C.textMuted : C.primary} />
                    <Text style={[s.resendText, resendCooldown > 0 && { color: C.textMuted }]}>
                      {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend OTP"}
                    </Text>
                  </Pressable>
                </>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <InputField
                label="Full Name *"
                value={name}
                onChangeText={v => { setName(v); clearError(); }}
                placeholder="Enter your full name"
                autoCapitalize="words"
                autoFocus
                error={!!error && !name.trim()}
              />
              <InputField
                label="Email (optional)"
                value={email}
                onChangeText={v => { setEmail(v); clearError(); }}
                placeholder="email@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <View>
                <Text style={s.fieldLabel}>CNIC / National ID</Text>
                <InputField
                  value={cnic}
                  onChangeText={v => { setCnic(formatCnic(v)); clearError(); }}
                  placeholder="XXXXX-XXXXXXX-X"
                  keyboardType="numeric"
                  maxLength={15}
                  error={!!error && !!cnic && !/^\d{5}-\d{7}-\d{1}$/.test(cnic)}
                />
                <Text style={s.fieldHint}>Optional — for identity verification</Text>
              </View>
            </>
          )}

          {step === 3 && (
            <>
              <InputField
                label="Password *"
                value={password}
                onChangeText={v => { setPassword(v); clearError(); }}
                placeholder="Minimum 8 characters"
                secureTextEntry={!showPwd}
                rightIcon={showPwd ? "eye-off-outline" : "eye-outline"}
                onRightIconPress={() => setShowPwd(v => !v)}
                autoFocus
              />
              <PasswordStrengthBar password={password} />

              <Pressable
                onPress={() => setTermsAccepted(!termsAccepted)}
                style={s.termsRow}
                accessibilityLabel="Accept Terms and Conditions"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: termsAccepted }}
              >
                <View style={[s.checkbox, termsAccepted && s.checkboxChecked]}>
                  {termsAccepted && <Ionicons name="checkmark" size={14} color="#fff" />}
                </View>
                <Text style={s.termsText}>
                  I agree to the <Text style={{ color: C.primary }}>Terms & Conditions</Text> and{" "}
                  <Text style={{ color: C.primary }}>Privacy Policy</Text>
                </Text>
              </Pressable>
            </>
          )}

          {error ? <AlertBox type="error" message={error} /> : null}

          <AuthButton
            label={
              step === 1
                ? otpSent ? "Verify OTP" : "Send OTP"
                : step === 2 ? "Continue" : "Create Account"
            }
            onPress={
              step === 1
                ? otpSent ? handleVerifyOtp : handleSendOtp
                : step === 2 ? handleStep2 : handleStep3
            }
            loading={loading}
            icon={step === 3 ? "shield-checkmark-outline" : step === 1 && !otpSent ? "send-outline" : undefined}
          />

          {step === 1 && (
            <Pressable
              onPress={() => router.replace("/auth")}
              style={s.loginLink}
              accessibilityLabel="Go to login"
              accessibilityRole="link"
            >
              <Text style={s.loginLinkText}>
                Already have an account? <Text style={{ fontFamily: "Inter_700Bold" }}>Login</Text>
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  gradient: { flex: 1 },
  topSection: { alignItems: "center", paddingBottom: spacing.lg, paddingHorizontal: spacing.xl },
  backBtn: {
    position: "absolute", left: spacing.lg,
    top: Platform.OS === "web" ? 67 : 50,
    width: 40, height: 40, borderRadius: radii.md,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 26, color: "#fff", marginBottom: 4 },
  headerSub: { ...typography.body, color: "rgba(255,255,255,0.85)", marginBottom: spacing.lg },
  progressRow: { marginBottom: 8 },
  stepLabels: { flexDirection: "row", justifyContent: "center", gap: 24 },
  stepLabel: { ...typography.small, color: "rgba(255,255,255,0.4)" },
  stepLabelActive: { color: "rgba(255,255,255,0.9)" },

  card: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.xxl, flex: 1 },

  fieldLabel: { ...typography.captionMedium, color: C.textSecondary, marginBottom: spacing.sm },
  fieldSub: { ...typography.caption, color: C.textMuted, marginBottom: spacing.md },
  fieldHint: { ...typography.small, color: C.textMuted, marginTop: -8, marginBottom: spacing.md, paddingLeft: 2 },

  changeBtn: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: spacing.md },
  changeBtnText: { ...typography.bodyMedium, color: C.primary },

  resendBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, marginBottom: spacing.md },
  resendDisabled: { opacity: 0.5 },
  resendText: { ...typography.bodyMedium, color: C.primary },

  termsRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: spacing.sm, marginBottom: spacing.md },
  checkbox: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: C.border, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkboxChecked: { backgroundColor: C.primary, borderColor: C.primary },
  termsText: { flex: 1, ...typography.caption, color: C.textSecondary, lineHeight: 19 },

  loginLink: { alignItems: "center", marginTop: spacing.xl },
  loginLinkText: { ...typography.bodyMedium, color: C.primary },

  successScroll: { flexGrow: 1, justifyContent: "center", alignItems: "center", padding: spacing.xxl },
  successCard: { backgroundColor: C.surface, borderRadius: radii.xxl, padding: spacing.xxxl, alignItems: "center", width: "100%", ...shadows.lg },
  successIconWrap: { marginBottom: spacing.xl },
  successIconCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.success, alignItems: "center", justifyContent: "center" },
  successTitle: { ...typography.h2, color: C.text, marginBottom: spacing.sm, textAlign: "center" },
  successSub: { ...typography.body, color: C.textMuted, textAlign: "center", marginBottom: spacing.xxl, lineHeight: 22 },
  bonusBanner: { flexDirection: "row", alignItems: "center", backgroundColor: C.accentSoft, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.xxl, borderWidth: 1, borderColor: "#FFD580", width: "100%" },
  bonusIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#FFF4E5", alignItems: "center", justifyContent: "center", marginRight: 12 },
  bonusTitle: { ...typography.subtitle, color: C.text, marginBottom: 2 },
  bonusSub: { ...typography.caption, color: C.textSecondary },
});
