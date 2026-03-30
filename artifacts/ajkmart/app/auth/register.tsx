import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
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

const C = Colors.light;
const API = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}/api`;

type RegStep = 1 | 2 | 3 | 4;

function formatCnic(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 13);
  if (digits.length <= 5) return digits;
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: "8+ characters", ok: password.length >= 8 },
    { label: "Uppercase", ok: /[A-Z]/.test(password) },
    { label: "Number", ok: /[0-9]/.test(password) },
  ];
  const score = checks.filter(c => c.ok).length;
  const colors = [C.danger, C.accent, C.success];
  const labels = ["Weak", "Medium", "Strong"];

  if (!password) return null;
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: "row", gap: 4, marginBottom: 6 }}>
        {[0, 1, 2].map(i => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < score ? colors[Math.min(score - 1, 2)] : C.border }} />
        ))}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ ...typography.smallMedium, color: colors[Math.min(score - 1, 2)] || C.textMuted }}>
          {score > 0 ? labels[score - 1] : ""}
        </Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
        {checks.map(c => (
          <View key={c.label} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Ionicons name={c.ok ? "checkmark-circle" : "ellipse-outline"} size={12} color={c.ok ? C.success : C.textMuted} />
            <Text style={{ ...typography.small, color: c.ok ? C.success : C.textMuted }}>{c.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
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

  const normalizedPhone = (() => {
    const digits = phone.replace(/\D/g, "");
    if (digits.startsWith("0")) return digits.slice(1);
    if (digits.startsWith("92")) return digits.slice(2);
    return digits;
  })();

  const formattedDashPhone = (() => {
    const d = normalizedPhone.startsWith("3") ? `0${normalizedPhone}` : `03${normalizedPhone}`;
    const clean = d.replace(/\D/g, "").slice(0, 11);
    return `${clean.slice(0, 4)}-${clean.slice(4)}`;
  })();

  const handleSendOtp = async () => {
    clearError();
    if (!phone || normalizedPhone.length < 10) { setError("Please enter a valid phone number (10 digits)"); return; }
    if (resendCooldown > 0) return;
    setLoading(true);
    try {
      if (!otpSent) {
        const regRes = await fetch(`${API}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: formattedDashPhone }),
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
      if (sendOtpData.otp) setDevOtp(sendOtpData.otp);
      setResendCooldown(60);
      setOtpSent(true);
    } catch (e: any) {
      setError(e.message || "Could not send OTP.");
    }
    setLoading(false);
  };

  const handleVerifyOtp = async () => {
    clearError();
    if (!otp || otp.length < 4) { setError("Please enter the OTP"); return; }
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
      if (data.token) setAuthToken(data.token);
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
    if (!password || password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (!/[A-Z]/.test(password)) { setError("Password must contain at least 1 uppercase letter"); return; }
    if (!/[0-9]/.test(password)) { setError("Password must contain at least 1 number"); return; }
    if (!termsAccepted) { setError("Please accept the Terms & Conditions"); return; }

    setLoading(true);
    try {
      if (!authToken) {
        setError("Session expired. Please go back and verify OTP again.");
        setLoading(false);
        return;
      }

      const profileRes = await fetch(`${API}/auth/complete-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
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
      if (authToken && authUser) {
        const userData = {
          ...authUser,
          walletBalance: authUser.walletBalance ?? 0,
          isActive: authUser.isActive ?? true,
          createdAt: authUser.createdAt ?? new Date().toISOString(),
        };
        await login(userData, authToken, authRefreshToken || undefined);
        router.replace("/(tabs)");
      } else {
        router.replace("/auth");
      }
    } catch (e: any) {
      console.warn("Login after registration failed:", e.message);
      router.replace("/auth");
    }
    setLoading(false);
  };

  const stepIndicator = (
    <View style={s.steps}>
      {([1, 2, 3, 4] as RegStep[]).map(n => (
        <View key={n} style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={[s.stepDot, step >= n && s.stepDotActive, step > n && s.stepDotDone]}>
            {step > n ? <Ionicons name="checkmark" size={12} color="#fff" /> : <Text style={[s.stepNum, step >= n && s.stepNumActive]}>{n}</Text>}
          </View>
          {n < 4 && <View style={[s.stepLine, step > n && s.stepLineActive]} />}
        </View>
      ))}
    </View>
  );

  if (step === 4) {
    return (
      <LinearGradient colors={[C.primaryDark, C.primary, C.primaryLight]} style={s.gradient}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", alignItems: "center", padding: spacing.xxl, paddingTop: topPad }}>
          <View style={s.successCard}>
            <View style={s.successIcon}>
              <Ionicons name="checkmark-circle" size={64} color={C.success} />
            </View>
            <Text style={s.successTitle}>Registration Successful!</Text>
            <Text style={s.successSub}>Welcome to {config.platform.appName}! Your account is ready.</Text>
            {signupBonus > 0 && (
              <View style={s.bonusBanner}>
                <Ionicons name="gift" size={24} color={C.accent} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.bonusTitle}>Welcome Bonus!</Text>
                  <Text style={s.bonusSub}>Rs. {signupBonus} has been added to your wallet</Text>
                </View>
              </View>
            )}
            <Pressable onPress={handleFinish} style={s.btn} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Start Shopping</Text>}
            </Pressable>
          </View>
        </ScrollView>
      </LinearGradient>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <LinearGradient colors={[C.primaryDark, C.primary, C.primaryLight]} style={s.gradient}>
        <View style={[s.topSection, { paddingTop: topPad + 16 }]}>
          <Pressable onPress={() => step === 1 ? router.back() : setStep((step - 1) as RegStep)} style={s.backBtn}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <Text style={s.headerTitle}>Create Account</Text>
          <Text style={s.headerSub}>
            {step === 1 ? "Verify your phone number" : step === 2 ? "Tell us about yourself" : "Set your password"}
          </Text>
          {stepIndicator}
        </View>

        <ScrollView style={s.card} contentContainerStyle={{ paddingBottom: 40 }}>
          {step === 1 && (
            <>
              {!otpSent ? (
                <>
                  <Text style={s.fieldLabel}>Phone Number</Text>
                  <View style={s.inputWrapper}>
                    <View style={s.countryCode}><Text style={s.countryCodeText}>+92</Text></View>
                    <TextInput
                      style={s.input}
                      value={phone}
                      onChangeText={v => { setPhone(v); clearError(); }}
                      placeholder="3XX XXX XXXX"
                      placeholderTextColor={C.textMuted}
                      keyboardType="phone-pad"
                      maxLength={11}
                      autoFocus
                    />
                  </View>
                </>
              ) : (
                <>
                  <Pressable onPress={() => { setOtpSent(false); clearError(); }} style={s.changeBtn}>
                    <Ionicons name="arrow-back" size={14} color={C.primary} />
                    <Text style={s.changeBtnText}>Change Number</Text>
                  </Pressable>
                  <Text style={s.fieldLabel}>Enter OTP</Text>
                  <Text style={s.fieldSub}>OTP sent to +92 {phone}</Text>
                  <TextInput
                    style={[s.inputFull, s.otpInput, error ? s.inputError : null]}
                    value={otp}
                    onChangeText={v => { setOtp(v); clearError(); }}
                    placeholder="6-digit OTP"
                    placeholderTextColor={C.textMuted}
                    keyboardType="number-pad"
                    maxLength={6}
                    autoFocus
                  />
                  {devOtp ? (
                    <View style={s.devOtpBox}>
                      <Ionicons name="key-outline" size={14} color={C.success} />
                      <Text style={s.devOtpTxt}>Dev OTP: <Text style={{ fontFamily: "Inter_700Bold", letterSpacing: 4 }}>{devOtp}</Text></Text>
                    </View>
                  ) : null}
                  <Pressable
                    onPress={handleSendOtp}
                    style={[s.resendBtn, resendCooldown > 0 && { opacity: 0.4 }]}
                    disabled={resendCooldown > 0}
                  >
                    <Text style={s.resendText}>
                      {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend OTP"}
                    </Text>
                  </Pressable>
                </>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <Text style={s.fieldLabel}>Full Name *</Text>
              <TextInput
                style={[s.inputFull, error && !name.trim() && s.inputError]}
                value={name}
                onChangeText={v => { setName(v); clearError(); }}
                placeholder="Enter your full name"
                placeholderTextColor={C.textMuted}
                autoCapitalize="words"
                autoFocus
              />

              <Text style={[s.fieldLabel, { marginTop: 14 }]}>Email (optional)</Text>
              <TextInput
                style={s.inputFull}
                value={email}
                onChangeText={v => { setEmail(v); clearError(); }}
                placeholder="email@example.com"
                placeholderTextColor={C.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <Text style={[s.fieldLabel, { marginTop: 14 }]}>CNIC / National ID</Text>
              <TextInput
                style={[s.inputFull, error && cnic && !/^\d{5}-\d{7}-\d{1}$/.test(cnic) && s.inputError]}
                value={cnic}
                onChangeText={v => { setCnic(formatCnic(v)); clearError(); }}
                placeholder="XXXXX-XXXXXXX-X"
                placeholderTextColor={C.textMuted}
                keyboardType="numeric"
                maxLength={15}
              />
              <Text style={s.fieldHint}>Optional — for verification</Text>
            </>
          )}

          {step === 3 && (
            <>
              <Text style={s.fieldLabel}>Password *</Text>
              <View style={s.pwdWrapper}>
                <TextInput
                  style={[s.input, { flex: 1, marginBottom: 0, borderWidth: 0 }]}
                  value={password}
                  onChangeText={v => { setPassword(v); clearError(); }}
                  placeholder="Kam az kam 8 characters"
                  placeholderTextColor={C.textMuted}
                  secureTextEntry={!showPwd}
                  autoFocus
                />
                <Pressable onPress={() => setShowPwd(v => !v)} style={s.eyeBtn}>
                  <Ionicons name={showPwd ? "eye-off-outline" : "eye-outline"} size={20} color={C.textMuted} />
                </Pressable>
              </View>
              <PasswordStrength password={password} />

              <Pressable onPress={() => setTermsAccepted(!termsAccepted)} style={s.termsRow}>
                <View style={[s.checkbox, termsAccepted && s.checkboxChecked]}>
                  {termsAccepted && <Ionicons name="checkmark" size={14} color="#fff" />}
                </View>
                <Text style={s.termsText}>
                  I agree to the <Text style={{ color: C.primary }}>Terms & Conditions</Text> and <Text style={{ color: C.primary }}>Privacy Policy</Text>
                </Text>
              </Pressable>
            </>
          )}

          {error ? (
            <View style={s.errorBox}>
              <Ionicons name="alert-circle-outline" size={15} color={C.danger} />
              <Text style={s.errorTxt}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={
              step === 1
                ? otpSent ? handleVerifyOtp : handleSendOtp
                : step === 2 ? handleStep2 : handleStep3
            }
            style={[s.btn, loading && s.btnDisabled]}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : (
              <Text style={s.btnText}>
                {step === 1
                  ? otpSent ? "Verify OTP" : "Send OTP"
                  : step === 2 ? "Continue" : "Create Account"
                }
              </Text>
            )}
          </Pressable>

          {step === 1 && (
            <Pressable onPress={() => router.replace("/auth")} style={{ alignItems: "center", marginTop: spacing.lg }}>
              <Text style={{ ...typography.bodyMedium, color: C.primary }}>
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
  topSection: { alignItems: "center", paddingBottom: spacing.xl, paddingHorizontal: spacing.xl },
  backBtn: { position: "absolute", left: spacing.lg, top: Platform.OS === "web" ? 67 : 50, width: 40, height: 40, borderRadius: radii.md, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 28, color: "#fff", marginBottom: 4 },
  headerSub: { ...typography.body, color: "rgba(255,255,255,0.85)", marginBottom: spacing.lg },

  steps: { flexDirection: "row", alignItems: "center" },
  stepDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: "rgba(255,255,255,0.35)", alignItems: "center", justifyContent: "center" },
  stepDotActive: { borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.15)" },
  stepDotDone: { backgroundColor: C.success, borderColor: C.success },
  stepNum: { ...typography.captionMedium, color: "rgba(255,255,255,0.5)" },
  stepNumActive: { color: "#fff" },
  stepLine: { width: 30, height: 2, backgroundColor: "rgba(255,255,255,0.25)", marginHorizontal: 4 },
  stepLineActive: { backgroundColor: C.success },

  card: { backgroundColor: C.surface, borderTopLeftRadius: radii.xxl + 4, borderTopRightRadius: radii.xxl + 4, padding: spacing.xxl, flex: 1 },

  fieldLabel: { ...typography.captionMedium, color: C.textSecondary, marginBottom: spacing.sm },
  fieldSub: { ...typography.caption, color: C.textMuted, marginBottom: spacing.md },
  fieldHint: { ...typography.small, color: C.textMuted, marginBottom: 4, paddingLeft: 2 },

  inputWrapper: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: C.border, borderRadius: radii.lg, overflow: "hidden", marginBottom: spacing.md, backgroundColor: C.surfaceSecondary },
  countryCode: { paddingHorizontal: 14, paddingVertical: 16, backgroundColor: C.surface, borderRightWidth: 1, borderRightColor: C.border },
  countryCodeText: { ...typography.subtitle, color: C.text },
  input: { flex: 1, paddingHorizontal: 16, paddingVertical: 15, ...typography.bodyMedium, color: C.text },
  inputFull: { paddingHorizontal: 16, paddingVertical: 15, ...typography.bodyMedium, color: C.text, borderWidth: 1.5, borderColor: C.border, borderRadius: radii.lg, marginBottom: spacing.md, backgroundColor: C.surfaceSecondary },
  otpInput: { textAlign: "center", letterSpacing: 8, ...typography.otp },
  inputError: { borderColor: C.danger },

  pwdWrapper: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: C.border, borderRadius: radii.lg, overflow: "hidden", marginBottom: 10, backgroundColor: C.surfaceSecondary },
  eyeBtn: { paddingHorizontal: 14 },

  changeBtn: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: spacing.md },
  changeBtnText: { ...typography.bodyMedium, color: C.primary },

  errorBox: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.dangerSoft, borderRadius: radii.md, paddingHorizontal: 12, paddingVertical: 10, marginBottom: spacing.md, borderWidth: 1, borderColor: "#FECACA" },
  errorTxt: { ...typography.captionMedium, color: C.danger, flex: 1 },
  devOtpBox: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.successSoft, borderRadius: radii.md, paddingHorizontal: 12, paddingVertical: 10, marginBottom: spacing.sm, borderWidth: 1, borderColor: "#80E6CC" },
  devOtpTxt: { ...typography.captionMedium, color: C.success, flex: 1 },

  resendBtn: { alignItems: "center", marginBottom: spacing.sm },
  resendText: { ...typography.bodyMedium, color: C.primary },

  termsRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: spacing.sm },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: C.border, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkboxChecked: { backgroundColor: C.primary, borderColor: C.primary },
  termsText: { flex: 1, ...typography.caption, color: C.textSecondary, lineHeight: 19 },

  btn: { backgroundColor: C.primary, borderRadius: radii.lg, paddingVertical: 16, alignItems: "center", marginTop: spacing.sm, ...shadows.md },
  btnDisabled: { opacity: 0.7 },
  btnText: { ...typography.button, color: "#fff" },

  successCard: { backgroundColor: C.surface, borderRadius: radii.xxl, padding: spacing.xxxl, alignItems: "center", width: "100%", ...shadows.lg },
  successIcon: { marginBottom: spacing.xl },
  successTitle: { ...typography.h2, color: C.text, marginBottom: spacing.sm, textAlign: "center" },
  successSub: { ...typography.body, color: C.textMuted, textAlign: "center", marginBottom: spacing.xxl, lineHeight: 22 },
  bonusBanner: { flexDirection: "row", alignItems: "center", backgroundColor: C.accentSoft, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.xxl, borderWidth: 1, borderColor: "#FFD580", width: "100%" },
  bonusTitle: { ...typography.subtitle, color: C.text, marginBottom: 2 },
  bonusSub: { ...typography.caption, color: C.textSecondary },
});
