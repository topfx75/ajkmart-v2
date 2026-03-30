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
import { useLanguage } from "@/context/LanguageContext";
import { usePlatformConfig, isMethodEnabled } from "@/context/PlatformConfigContext";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { API_BASE as API } from "@/utils/api";

const C = Colors.light;

type ForgotStep = "method" | "otp" | "newPassword" | "totp" | "done";
type ResetMethod = "phone" | "email";

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
      <Text style={{ ...typography.smallMedium, color: colors[Math.min(score - 1, 2)] || C.textMuted }}>
        {score > 0 ? labels[score - 1] : ""}
      </Text>
    </View>
  );
}

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const { config } = usePlatformConfig();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [step, setStep] = useState<ForgotStep>("method");
  const [method, setMethod] = useState<ResetMethod>("phone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [totpCode, setTotpCode] = useState("");

  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const clearError = () => setError("");

  const handleSendResetCode = async () => {
    clearError();
    if (method === "phone" && (!phone || phone.length < 10)) {
      setError("Please enter a valid phone number"); return;
    }
    if (method === "email" && (!email || !email.includes("@"))) {
      setError("Please enter a valid email address"); return;
    }
    if (resendCooldown > 0) return;

    setLoading(true);
    try {
      const body: any = {};
      if (method === "phone") body.phone = phone.replace(/^0/, "");
      else body.email = email.trim().toLowerCase();

      const res = await fetch(`${API}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Request fail."); setLoading(false); return; }
      if (data.otp) setDevOtp(data.otp);
      setResendCooldown(60);
      setStep("otp");
    } catch (e: any) { setError(e.message || "Please try again."); }
    setLoading(false);
  };

  const handleVerifyAndReset = async () => {
    clearError();
    if (!otp || otp.length < 4) { setError("Please enter the OTP"); return; }
    if (!newPassword || newPassword.length < 8) { setError("New password must be at least 8 characters"); return; }
    if (!/[A-Z]/.test(newPassword)) { setError("Password must contain an uppercase letter"); return; }
    if (!/[0-9]/.test(newPassword)) { setError("Password must contain a number"); return; }
    if (newPassword !== confirmPassword) { setError("Passwords do not match"); return; }

    setLoading(true);
    try {
      const body: any = { otp, newPassword };
      if (method === "phone") body.phone = phone.replace(/^0/, "");
      else body.email = email.trim().toLowerCase();
      if (totpCode) body.totpCode = totpCode;

      const res = await fetch(`${API}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.requires2FA) {
          setStep("totp");
          setLoading(false);
          return;
        }
        setError(data.error || "Reset fail.");
        setLoading(false);
        return;
      }
      setStep("done");
    } catch (e: any) { setError(e.message || "Please try again."); }
    setLoading(false);
  };

  const handleTotpSubmit = async () => {
    if (!totpCode || totpCode.length < 6) { setError("Please enter the 6-digit 2FA code"); return; }
    await handleVerifyAndReset();
  };

  if (step === "done") {
    return (
      <LinearGradient colors={[C.primaryDark, C.primary, C.primaryLight]} style={s.gradient}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.xxl }}>
          <View style={s.doneCard}>
            <View style={s.doneIconWrap}>
              <Ionicons name="checkmark-circle" size={64} color={C.success} />
            </View>
            <Text style={s.doneTitle}>Password Reset!</Text>
            <Text style={s.doneSub}>Your password has been successfully changed. Please log in with your new password.</Text>
            <Pressable onPress={() => router.replace("/auth")} style={s.btn}>
              <Text style={s.btnText}>Login</Text>
            </Pressable>
          </View>
        </View>
      </LinearGradient>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <LinearGradient colors={[C.primaryDark, C.primary, C.primaryLight]} style={s.gradient}>
        <View style={[s.topSection, { paddingTop: topPad + 16 }]}>
          <Pressable onPress={() => step === "method" ? router.back() : setStep("method")} style={s.backBtn}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <View style={s.headerIcon}>
            <Ionicons name="lock-closed" size={32} color="rgba(255,255,255,0.9)" />
          </View>
          <Text style={s.headerTitle}>Reset Password</Text>
          <Text style={s.headerSub}>
            {step === "method" ? "Enter your phone or email to receive a reset code"
              : step === "otp" ? "Enter the code and your new password"
              : step === "totp" ? "Enter your 2FA code"
              : ""}
          </Text>
        </View>

        <ScrollView style={s.card} contentContainerStyle={{ paddingBottom: 40 }}>
          {step === "method" && (
            <>
              <View style={s.methodTabs}>
                {isMethodEnabled(config.auth.phoneOtpEnabled) && (
                  <Pressable onPress={() => { setMethod("phone"); clearError(); }} style={[s.methodTab, method === "phone" && s.methodTabActive]}>
                    <Ionicons name="call-outline" size={16} color={method === "phone" ? C.primary : C.textMuted} />
                    <Text style={[s.methodTabText, method === "phone" && s.methodTabTextActive]}>Phone</Text>
                  </Pressable>
                )}
                {isMethodEnabled(config.auth.emailOtpEnabled) && (
                  <Pressable onPress={() => { setMethod("email"); clearError(); }} style={[s.methodTab, method === "email" && s.methodTabActive]}>
                    <Ionicons name="mail-outline" size={16} color={method === "email" ? C.primary : C.textMuted} />
                    <Text style={[s.methodTabText, method === "email" && s.methodTabTextActive]}>Email</Text>
                  </Pressable>
                )}
              </View>

              {method === "phone" && (
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
              )}

              {method === "email" && (
                <>
                  <Text style={s.fieldLabel}>Email Address</Text>
                  <TextInput
                    style={s.inputFull}
                    value={email}
                    onChangeText={v => { setEmail(v); clearError(); }}
                    placeholder="your@email.com"
                    placeholderTextColor={C.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoFocus
                  />
                </>
              )}
            </>
          )}

          {step === "otp" && (
            <>
              <Pressable onPress={() => { setStep("method"); clearError(); }} style={s.changeBtn}>
                <Ionicons name="arrow-back" size={14} color={C.primary} />
                <Text style={s.changeBtnText}>Change {method === "phone" ? "Number" : "Email"}</Text>
              </Pressable>

              <Text style={s.fieldLabel}>Reset Code</Text>
              <Text style={s.fieldSub}>
                Code sent to {method === "phone" ? `+92 ${phone}` : email}
              </Text>
              <TextInput
                style={[s.inputFull, s.otpInput, error ? s.inputError : null]}
                value={otp}
                onChangeText={v => { setOtp(v); clearError(); }}
                placeholder="6-digit code"
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
                onPress={handleSendResetCode}
                style={[s.resendBtn, resendCooldown > 0 && { opacity: 0.4 }]}
                disabled={resendCooldown > 0}
              >
                <Text style={s.resendText}>
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend Code"}
                </Text>
              </Pressable>

              <Text style={[s.fieldLabel, { marginTop: spacing.lg }]}>New Password</Text>
              <View style={s.pwdWrapper}>
                <TextInput
                  style={[s.input, { flex: 1, marginBottom: 0, borderWidth: 0 }]}
                  value={newPassword}
                  onChangeText={v => { setNewPassword(v); clearError(); }}
                  placeholder="New password"
                  placeholderTextColor={C.textMuted}
                  secureTextEntry={!showPwd}
                />
                <Pressable onPress={() => setShowPwd(v => !v)} style={s.eyeBtn}>
                  <Ionicons name={showPwd ? "eye-off-outline" : "eye-outline"} size={20} color={C.textMuted} />
                </Pressable>
              </View>
              <PasswordStrength password={newPassword} />

              <Text style={s.fieldLabel}>Confirm Password</Text>
              <View style={[s.inputRow, confirmPassword && newPassword !== confirmPassword && s.inputError]}>
                <TextInput
                  style={[s.input, { flex: 1, marginBottom: 0, borderWidth: 0 }]}
                  value={confirmPassword}
                  onChangeText={v => { setConfirmPassword(v); clearError(); }}
                  placeholder="Re-enter password"
                  placeholderTextColor={C.textMuted}
                  secureTextEntry={!showConfirmPwd}
                />
                <Pressable onPress={() => setShowConfirmPwd(v => !v)} style={s.eyeBtn}>
                  <Ionicons name={showConfirmPwd ? "eye-off-outline" : "eye-outline"} size={20} color={C.textMuted} />
                </Pressable>
              </View>
            </>
          )}

          {step === "totp" && (
            <>
              <View style={{ alignItems: "center", marginBottom: spacing.xl }}>
                <View style={s.totpIcon}>
                  <Ionicons name="shield-checkmark" size={36} color={C.primary} />
                </View>
              </View>
              <Text style={[s.fieldLabel, { textAlign: "center" }]}>Two-Factor Authentication</Text>
              <Text style={[s.fieldSub, { textAlign: "center" }]}>
                Enter the 6-digit code from your authenticator app
              </Text>
              <TextInput
                style={[s.inputFull, s.otpInput]}
                value={totpCode}
                onChangeText={v => { setTotpCode(v); clearError(); }}
                placeholder="6-digit code"
                placeholderTextColor={C.textMuted}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
              />
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
              step === "method" ? handleSendResetCode
                : step === "otp" ? handleVerifyAndReset
                : step === "totp" ? handleTotpSubmit
                : () => {}
            }
            style={[s.btn, loading && s.btnDisabled]}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : (
              <Text style={s.btnText}>
                {step === "method" ? "Send Reset Code"
                  : step === "otp" ? "Reset Password"
                  : step === "totp" ? "Verify & Reset"
                  : ""}
              </Text>
            )}
          </Pressable>

          <Pressable onPress={() => router.replace("/auth")} style={{ alignItems: "center", marginTop: spacing.lg }}>
            <Text style={{ ...typography.bodyMedium, color: C.primary }}>Back to Login</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  gradient: { flex: 1 },
  topSection: { alignItems: "center", paddingBottom: spacing.xxl, paddingHorizontal: spacing.xl },
  backBtn: { position: "absolute", left: spacing.lg, top: Platform.OS === "web" ? 67 : 50, width: 40, height: 40, borderRadius: radii.md, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 28, color: "#fff", marginBottom: 4 },
  headerSub: { ...typography.body, color: "rgba(255,255,255,0.85)", textAlign: "center" },

  card: { backgroundColor: C.surface, borderTopLeftRadius: radii.xxl + 4, borderTopRightRadius: radii.xxl + 4, padding: spacing.xxl, flex: 1 },

  methodTabs: { flexDirection: "row", backgroundColor: C.surfaceSecondary, borderRadius: radii.lg, padding: 3, marginBottom: spacing.xl, gap: 2 },
  methodTab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 10, borderRadius: radii.md },
  methodTabActive: { backgroundColor: C.surface, ...shadows.sm },
  methodTabText: { ...typography.captionMedium, color: C.textMuted },
  methodTabTextActive: { color: C.text, fontFamily: "Inter_600SemiBold" },

  fieldLabel: { ...typography.captionMedium, color: C.textSecondary, marginBottom: spacing.sm },
  fieldSub: { ...typography.caption, color: C.textMuted, marginBottom: spacing.md },

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

  totpIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.primarySoft, alignItems: "center", justifyContent: "center" },

  btn: { backgroundColor: C.primary, borderRadius: radii.lg, paddingVertical: 16, alignItems: "center", marginTop: spacing.sm, ...shadows.md },
  btnDisabled: { opacity: 0.7 },
  btnText: { ...typography.button, color: "#fff" },

  doneCard: { backgroundColor: C.surface, borderRadius: radii.xxl, padding: spacing.xxxl, alignItems: "center", width: "100%", ...shadows.lg },
  doneIconWrap: { marginBottom: spacing.lg },
  doneTitle: { ...typography.h2, color: C.text, marginBottom: spacing.sm },
  doneSub: { ...typography.body, color: C.textMuted, textAlign: "center", marginBottom: spacing.xxl, lineHeight: 22 },
});
