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

import * as Linking from "expo-linking";

import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { usePlatformConfig, isMethodEnabled } from "@/context/PlatformConfigContext";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { sendOtp, verifyOtp } from "@workspace/api-client-react";
import { LANGUAGE_OPTIONS, type Language } from "@workspace/i18n";

const C = Colors.light;
const API = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}/api`;

type LoginMethod = "phone" | "email" | "username" | "magic" | "google" | "facebook";
type Step = "method" | "otp" | "totp" | "pending" | "complete-profile";

async function authPost(path: string, body: object) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const LANG_PRESETS: { value: Language; label: string; icon: string }[] = [
  { value: "en_roman", label: "English", icon: "language-outline" },
  { value: "ur",       label: "اردو",    icon: "language-outline" },
  { value: "en_ur",    label: "En + اردو", icon: "language-outline" },
];

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { login, setTwoFactorPending, twoFactorPending, completeTwoFactorLogin, biometricEnabled, attemptBiometricLogin } = useAuth();
  const { language, setLanguage } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const { config: platformCfg } = usePlatformConfig();
  const authCfg = platformCfg.auth;
  const appName    = platformCfg.platform.appName;
  const appTagline = platformCfg.platform.appTagline;
  const topPad     = Platform.OS === "web" ? 67 : insets.top;

  const [method, setMethod]     = useState<LoginMethod>("phone");
  const [step, setStep]         = useState<Step>("method");

  useEffect(() => {
    if (twoFactorPending) {
      setTotpTempToken(twoFactorPending.tempToken);
      setTotpUserId(twoFactorPending.userId);
      setStep("totp");
      setTwoFactorPending(null);
    }
  }, [twoFactorPending]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [biometricLoading, setBiometricLoading] = useState(false);

  const [phone, setPhone]   = useState("");
  const [otp, setOtp]       = useState("");
  const [devOtp, setDevOtp] = useState("");

  const [email, setEmail]     = useState("");
  const [emailOtp, setEmailOtp] = useState("");
  const [emailDevOtp, setEmailDevOtp] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd]   = useState(false);

  const [magicEmail, setMagicEmail] = useState("");
  const [magicSent, setMagicSent] = useState(false);
  const [magicCooldown, setMagicCooldown] = useState(0);

  const [pendingToken, setPendingToken]         = useState("");
  const [pendingRefreshToken, setPendingRefreshToken] = useState<string | undefined>(undefined);
  const [pendingUser, setPendingUser]           = useState<any>(null);
  const [profileName, setProfileName]       = useState("");
  const [profileEmail, setProfileEmail]     = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [profilePassword, setProfilePassword] = useState("");
  const [showProfilePwd, setShowProfilePwd]   = useState(false);

  const [totpTempToken, setTotpTempToken] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpUserId, setTotpUserId] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);

  const [resendCooldown, setResendCooldown]           = useState(0);
  const [emailResendCooldown, setEmailResendCooldown] = useState(0);

  const [useBackup, setUseBackup] = useState(false);
  const [backupCode, setBackupCode] = useState("");

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);
  useEffect(() => {
    if (emailResendCooldown <= 0) return;
    const t = setTimeout(() => setEmailResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [emailResendCooldown]);
  useEffect(() => {
    if (magicCooldown <= 0) return;
    const t = setTimeout(() => setMagicCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [magicCooldown]);

  const slideAnim = useRef(new Animated.Value(0)).current;
  const slide = () => Animated.timing(slideAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  const clearError = () => setError("");

  const enabledMethods: { key: LoginMethod; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [];
  if (isMethodEnabled(authCfg.phoneOtpEnabled)) enabledMethods.push({ key: "phone", icon: "call-outline", label: T("phone") });
  if (isMethodEnabled(authCfg.emailOtpEnabled)) enabledMethods.push({ key: "email", icon: "mail-outline", label: T("email") });
  if (isMethodEnabled(authCfg.usernamePasswordEnabled)) enabledMethods.push({ key: "username", icon: "person-outline", label: T("username") });

  const socialMethods: { key: LoginMethod; icon: keyof typeof Ionicons.glyphMap; label: string; color: string }[] = [];
  if (isMethodEnabled(authCfg.googleEnabled)) socialMethods.push({ key: "google", icon: "logo-google", label: "Google", color: "#EA4335" });
  if (isMethodEnabled(authCfg.facebookEnabled)) socialMethods.push({ key: "facebook", icon: "logo-facebook", label: "Facebook", color: "#1877F2" });
  const showMagicLink = isMethodEnabled(authCfg.magicLinkEnabled);
  const showBiometric = isMethodEnabled(authCfg.biometricEnabled) && biometricEnabled;

  const handleLoginResult = async (res: any) => {
    if (res.requires2FA) {
      setTotpTempToken(res.tempToken);
      setTotpUserId(res.userId);
      setStep("totp");
      return;
    }
    if (res.pendingApproval) {
      setPendingToken(res.token); setPendingRefreshToken(res.refreshToken); setPendingUser(res.user);
      setStep("pending");
      return;
    }
    if (res.user && !res.user.name) {
      setPendingToken(res.token); setPendingRefreshToken(res.refreshToken); setPendingUser(res.user);
      setStep("complete-profile");
      return;
    }
    if (res.user && res.token) {
      await login(res.user as any, res.token, res.refreshToken);
      router.replace("/(tabs)");
    }
  };

  const handleSendPhoneOtp = async () => {
    clearError();
    if (!phone || phone.length < 10) { setError("Valid phone number enter karein (10 digits)"); return; }
    if (resendCooldown > 0) { setError(`Please wait ${resendCooldown}s before resending.`); return; }
    setLoading(true);
    try {
      const res = await sendOtp({ phone });
      if (res.otp) setDevOtp(res.otp);
      setResendCooldown(60);
      slide(); setStep("otp");
    } catch (e: any) {
      const msg: string = e.message || "OTP send nahi hua.";
      setError(msg);
      const match = msg.match(/wait (\d+) second/);
      if (match) setResendCooldown(parseInt(match[1]!, 10));
    }
    setLoading(false);
  };

  const handleVerifyPhoneOtp = async () => {
    clearError();
    if (!otp || otp.length < 4) { setError("OTP enter karein"); return; }
    setLoading(true);
    try {
      const res = await verifyOtp({ phone, otp });
      await handleLoginResult(res);
    } catch (e: any) { setError(e.message || "OTP galat hai."); }
    setLoading(false);
  };

  const handleSendEmailOtp = async () => {
    clearError();
    if (!email || !email.includes("@")) { setError("Valid email address enter karein"); return; }
    if (emailResendCooldown > 0) return;
    setLoading(true);
    try {
      const res = await authPost("/auth/send-email-otp", { email });
      if (res.otp) setEmailDevOtp(res.otp);
      setEmailResendCooldown(60);
      slide(); setStep("otp");
    } catch (e: any) { setError(e.message || "OTP send nahi hua."); }
    setLoading(false);
  };

  const handleVerifyEmailOtp = async () => {
    clearError();
    if (!emailOtp || emailOtp.length < 6) { setError("6-digit OTP enter karein"); return; }
    setLoading(true);
    try {
      const res = await authPost("/auth/verify-email-otp", { email, otp: emailOtp });
      await handleLoginResult(res);
    } catch (e: any) { setError(e.message || "OTP galat hai."); }
    setLoading(false);
  };

  const handleUsernameLogin = async () => {
    clearError();
    if (!username || username.length < 3) { setError("Username enter karein"); return; }
    if (!password || password.length < 6) { setError("Password enter karein"); return; }
    setLoading(true);
    try {
      const res = await authPost("/auth/login/username", { username, password });
      await handleLoginResult(res);
    } catch (e: any) { setError(e.message || "Username ya password galat hai."); }
    setLoading(false);
  };

  const handleSocialLogin = async (provider: "google" | "facebook") => {
    clearError();
    setLoading(true);
    try {
      const redirectUri = Linking.createURL("auth/callback");
      const WebBrowser = await import("expo-web-browser");

      if (provider === "google") {
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=GOOGLE_CLIENT_ID&response_type=id_token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=openid%20email%20profile&nonce=${Date.now()}`;
        const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
        if (result.type === "success" && result.url) {
          const params = new URL(result.url).hash.slice(1).split("&").reduce((a: any, p) => { const [k, v] = p.split("="); a[k!] = decodeURIComponent(v!); return a; }, {});
          if (params.id_token) {
            const data = await authPost("/auth/social/google", { idToken: params.id_token });
            await handleLoginResult(data);
            setLoading(false);
            return;
          }
        }
      } else {
        const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=FB_APP_ID&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=public_profile,email`;
        const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
        if (result.type === "success" && result.url) {
          const params = new URL(result.url).hash.slice(1).split("&").reduce((a: any, p) => { const [k, v] = p.split("="); a[k!] = decodeURIComponent(v!); return a; }, {});
          if (params.access_token) {
            const data = await authPost("/auth/social/facebook", { accessToken: params.access_token });
            await handleLoginResult(data);
            setLoading(false);
            return;
          }
        }
      }
      setError(`${provider} login cancelled or not configured.`);
    } catch (e: any) { setError(e.message || `${provider} login failed.`); }
    setLoading(false);
  };

  const handleMagicLink = async () => {
    clearError();
    if (!magicEmail || !magicEmail.includes("@")) { setError("Valid email enter karein"); return; }
    if (magicCooldown > 0) return;
    setLoading(true);
    try {
      await authPost("/auth/magic-link/send", { email: magicEmail });
      setMagicSent(true);
      setMagicCooldown(60);
    } catch (e: any) { setError(e.message || "Magic link send fail."); }
    setLoading(false);
  };

  const handleBiometricLogin = async () => {
    setBiometricLoading(true);
    try {
      const success = await attemptBiometricLogin();
      if (success) {
        router.replace("/(tabs)");
      } else {
        setError("Biometric login fail. Koi aur method se login karein.");
      }
    } catch {
      setError("Biometric not available.");
    }
    setBiometricLoading(false);
  };

  const getDeviceFingerprint = async (): Promise<string> => {
    try {
      const SecureStore = await import("expo-secure-store");
      const existing = await SecureStore.getItemAsync("device_fingerprint");
      if (existing) return existing;
      const fp = `${Platform.OS}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      await SecureStore.setItemAsync("device_fingerprint", fp);
      return fp;
    } catch {
      return `${Platform.OS}_${Date.now().toString(36)}`;
    }
  };

  const handleTotpVerify = async () => {
    clearError();
    if (!totpCode || totpCode.length < 6) { setError("6-digit code enter karein"); return; }
    setLoading(true);
    try {
      const fingerprint = await getDeviceFingerprint();
      const res = await authPost("/auth/2fa/verify", {
        tempToken: totpTempToken,
        code: totpCode,
        deviceFingerprint: fingerprint,
      });
      if (trustDevice) {
        try {
          await fetch(`${API}/auth/2fa/trust-device`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${res.token}` },
            body: JSON.stringify({ deviceFingerprint: fingerprint }),
          });
        } catch (trustErr: any) {
          console.warn("Trust device failed:", trustErr.message);
        }
      }
      await completeTwoFactorLogin(res.user as any, res.token, res.refreshToken);
      router.replace("/(tabs)");
    } catch (e: any) { setError(e.message || "2FA code galat hai."); }
    setLoading(false);
  };

  const handleTotpBackup = async (backupCode: string) => {
    clearError();
    setLoading(true);
    try {
      const res = await authPost("/auth/2fa/recovery", {
        tempToken: totpTempToken,
        backupCode,
      });
      await completeTwoFactorLogin(res.user as any, res.token, res.refreshToken);
      router.replace("/(tabs)");
    } catch (e: any) { setError(e.message || "Backup code galat hai."); }
    setLoading(false);
  };

  const handleCompleteProfile = async () => {
    clearError();
    if (!profileName || profileName.trim().length < 2) { setError("Apna naam enter karein"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/complete-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${pendingToken}` },
        body: JSON.stringify({
          name: profileName.trim(),
          ...(profileEmail && { email: profileEmail }),
          ...(profileUsername && { username: profileUsername }),
          ...(profilePassword && profilePassword.length >= 8 && { password: profilePassword }),
        }),
      }).then(r => r.json());
      if (res.user) {
        await login({
          walletBalance: 0, isActive: true, createdAt: new Date().toISOString(), ...res.user,
        } as any, res.token ?? pendingToken, res.refreshToken ?? pendingRefreshToken);
        router.replace("/(tabs)");
      }
    } catch (e: any) { setError(e.message || "Profile save nahi hua."); }
    setLoading(false);
  };

  const selectMethod = (m: LoginMethod) => {
    setMethod(m); clearError();
    setOtp(""); setEmailOtp(""); setDevOtp(""); setEmailDevOtp("");
    setMagicSent(false);
  };

  if (step === "totp") {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <LinearGradient colors={[C.primaryDark, C.primary, "#60A5FA"]} style={styles.gradient}>
          <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
            <View style={[styles.topSection, { paddingTop: topPad + 24 }]}>
              <View style={styles.logo}><Ionicons name="shield-checkmark" size={36} color={C.primary} /></View>
              <Text style={styles.appName}>Two-Factor Auth</Text>
              <Text style={styles.tagline}>{useBackup ? "Enter a backup code" : "Enter code from authenticator app"}</Text>
            </View>
            <View style={styles.card}>
              {!useBackup ? (
                <TextInput
                  style={[styles.input, styles.otpInput]}
                  value={totpCode}
                  onChangeText={v => { setTotpCode(v); clearError(); }}
                  placeholder="6-digit code"
                  placeholderTextColor={C.textMuted}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                />
              ) : (
                <TextInput
                  style={[styles.input, { marginBottom: 12 }]}
                  value={backupCode}
                  onChangeText={v => { setBackupCode(v); clearError(); }}
                  placeholder="Backup code enter karein"
                  placeholderTextColor={C.textMuted}
                  autoCapitalize="none"
                  autoFocus
                />
              )}

              <Pressable onPress={() => setTrustDevice(!trustDevice)} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 10, backgroundColor: "#F9FAFB", borderRadius: 8, marginBottom: 12 }}>
                <View style={[{ width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: "#D1D5DB", alignItems: "center", justifyContent: "center" }, trustDevice && { backgroundColor: C.primary, borderColor: C.primary }]}>
                  {trustDevice && <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>✓</Text>}
                </View>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: "#374151" }}>Trust this device for 30 days</Text>
              </Pressable>

              {error ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={15} color="#DC2626" />
                  <Text style={styles.errorTxt}>{error}</Text>
                </View>
              ) : null}

              <Pressable
                onPress={useBackup ? () => handleTotpBackup(backupCode) : handleTotpVerify}
                style={[styles.btn, loading && styles.btnDisabled]}
                disabled={loading}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Verify</Text>}
              </Pressable>

              <Pressable onPress={() => { setUseBackup(!useBackup); setBackupCode(""); setTotpCode(""); clearError(); }} style={{ alignItems: "center", marginTop: 12 }}>
                <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: C.primary }}>
                  {useBackup ? "Use authenticator app" : "Use a backup code"}
                </Text>
              </Pressable>

              <Pressable onPress={() => { setStep("method"); setTotpCode(""); clearError(); }} style={styles.backBtn}>
                <Ionicons name="arrow-back" size={16} color={C.primary} />
                <Text style={styles.backBtnText}>{T("backToLogin")}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </LinearGradient>
      </KeyboardAvoidingView>
    );
  }

  if (step === "pending") {
    return (
      <LinearGradient colors={[C.primaryDark, C.primary, "#60A5FA"]} style={styles.gradient}>
        <View style={[styles.centerContainer, { paddingTop: topPad + 40 }]}>
          <View style={styles.pendingCard}>
            <View style={styles.pendingIcon}>
              <Ionicons name="time-outline" size={48} color="#F59E0B" />
            </View>
            <Text style={styles.pendingTitle}>{T("approvalWaiting")}</Text>
            <Text style={styles.pendingSubtitle}>{T("approvalMsg")}</Text>
            <View style={styles.pendingInfo}>
              <Ionicons name="information-circle-outline" size={16} color="#6B7280" />
              <Text style={styles.pendingInfoTxt}>{T("approvalTimeframe")}</Text>
            </View>
            <Pressable style={styles.backBtn} onPress={() => { setStep("method"); setOtp(""); setEmailOtp(""); }}>
              <Ionicons name="arrow-back" size={16} color={C.primary} />
              <Text style={styles.backBtnText}>{T("backToLogin")}</Text>
            </Pressable>
          </View>
        </View>
      </LinearGradient>
    );
  }

  if (step === "complete-profile") {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <LinearGradient colors={[C.primaryDark, C.primary, "#60A5FA"]} style={styles.gradient}>
          <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
            <View style={[styles.topSection, { paddingTop: topPad + 24 }]}>
              <View style={styles.logo}><Ionicons name="person" size={36} color={C.primary} /></View>
              <Text style={styles.appName}>{T("completeProfileLabel")}</Text>
              <Text style={styles.tagline}>{T("almostDone")}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.fieldLabel}>{T("yourNameRequired")}</Text>
              <TextInput
                style={[styles.input2, error && profileName.trim().length < 2 && styles.inputError]}
                value={profileName} onChangeText={v => { setProfileName(v); clearError(); }}
                placeholder="Full name enter karein" placeholderTextColor={C.textMuted} autoFocus
              />
              <Text style={styles.fieldLabel}>{T("emailOptional")}</Text>
              <TextInput
                style={styles.input2} value={profileEmail} onChangeText={v => { setProfileEmail(v); clearError(); }}
                placeholder="email@example.com" placeholderTextColor={C.textMuted}
                keyboardType="email-address" autoCapitalize="none"
              />
              <Text style={styles.fieldLabel}>{T("usernameOptional")}</Text>
              <TextInput
                style={styles.input2} value={profileUsername}
                onChangeText={v => { setProfileUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, "")); clearError(); }}
                placeholder="e.g. ali_ahmed123" placeholderTextColor={C.textMuted} autoCapitalize="none"
              />
              <Text style={styles.fieldLabel}>{T("passwordOptional")}</Text>
              <View style={styles.pwdWrapper}>
                <TextInput
                  style={[styles.input2, { flex: 1, marginBottom: 0 }]}
                  value={profilePassword} onChangeText={v => { setProfilePassword(v); clearError(); }}
                  placeholder="Min 8 characters" placeholderTextColor={C.textMuted} secureTextEntry={!showProfilePwd}
                />
                <Pressable onPress={() => setShowProfilePwd(v => !v)} style={styles.eyeBtn}>
                  <Ionicons name={showProfilePwd ? "eye-off-outline" : "eye-outline"} size={20} color={C.textMuted} />
                </Pressable>
              </View>
              {error ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={15} color="#DC2626" />
                  <Text style={styles.errorTxt}>{error}</Text>
                </View>
              ) : null}
              <Pressable onPress={handleCompleteProfile} style={[styles.btn, loading && styles.btnDisabled]} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>{T("saveAndContinue")} →</Text>}
              </Pressable>
              <Pressable onPress={async () => {
                if (pendingToken && pendingUser) {
                  await login(pendingUser as any, pendingToken, pendingRefreshToken || undefined);
                  router.replace("/(tabs)");
                } else { setStep("method"); setPendingToken(""); }
              }} style={{ alignItems: "center", marginTop: 12 }}>
                <Text style={[styles.backBtnText, { fontSize: 13 }]}>{T("doLater")}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </LinearGradient>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <LinearGradient colors={[C.primaryDark, C.primary, "#60A5FA"]} start={{ x: 0, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.gradient}>
        <View style={[styles.topSection, { paddingTop: topPad + 32 }]}>
          <View style={styles.logoContainer}>
            <View style={styles.logo}><Ionicons name="cart" size={40} color={C.primary} /></View>
          </View>
          <Text style={styles.appName}>{appName}</Text>
          <Text style={styles.tagline}>{appTagline}</Text>
          <View style={styles.langRow}>
            {LANG_PRESETS.map(lp => (
              <Pressable key={lp.value} onPress={() => setLanguage(lp.value)}
                style={[styles.langChip, language === lp.value && styles.langChipActive]}>
                <Ionicons name={lp.icon as any} size={13} color={language === lp.value ? "#fff" : "rgba(255,255,255,0.7)"} />
                <Text style={[styles.langChipTxt, language === lp.value && styles.langChipTxtActive]}>{lp.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <ScrollView style={styles.card} contentContainerStyle={{ paddingBottom: 40 }}>
          {step === "method" && enabledMethods.length > 0 && (
            <View style={styles.tabs}>
              {enabledMethods.map(m => (
                <Pressable key={m.key} onPress={() => selectMethod(m.key)} style={[styles.tab, method === m.key && styles.tabActive]}>
                  <Ionicons name={m.icon} size={15} color={method === m.key ? C.primary : C.textMuted} />
                  <Text style={[styles.tabText, method === m.key && styles.tabTextActive]}>{m.label}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {method === "phone" && step === "method" && (
            <>
              <Text style={styles.cardTitle}>{T("phoneNumber")}</Text>
              <Text style={styles.cardSubtitle}>{T("verificationCodeSent")}</Text>
              <View style={styles.inputWrapper}>
                <View style={styles.countryCode}><Text style={styles.countryCodeText}>+92</Text></View>
                <TextInput style={styles.input} value={phone} onChangeText={v => { setPhone(v); clearError(); }}
                  placeholder="3XX XXX XXXX" placeholderTextColor={C.textMuted} keyboardType="phone-pad" maxLength={11} />
              </View>
            </>
          )}

          {method === "phone" && step === "otp" && (
            <>
              <Pressable onPress={() => { setStep("method"); clearError(); setDevOtp(""); }} style={styles.backBtn}>
                <Ionicons name="arrow-back" size={16} color={C.primary} />
                <Text style={styles.backBtnText}>{T("changeNumber")}</Text>
              </Pressable>
              <Text style={styles.cardTitle}>{T("enterOtp")}</Text>
              <Text style={styles.cardSubtitle}>{T("otpSentToPhone")}{phone}</Text>
              <TextInput style={[styles.input, styles.otpInput, error ? styles.inputError : null]}
                value={otp} onChangeText={v => { setOtp(v); clearError(); }}
                placeholder="6-digit OTP" placeholderTextColor={C.textMuted}
                keyboardType="number-pad" maxLength={6} autoFocus />
              {devOtp ? (
                <View style={styles.devOtpBox}>
                  <Ionicons name="key-outline" size={14} color="#059669" />
                  <Text style={styles.devOtpTxt}>Dev OTP: <Text style={{ fontFamily: "Inter_700Bold", letterSpacing: 4 }}>{devOtp}</Text></Text>
                </View>
              ) : null}
              <Pressable onPress={handleSendPhoneOtp} style={[styles.resendBtn, resendCooldown > 0 && { opacity: 0.4 }]} disabled={resendCooldown > 0}>
                <Text style={styles.resendText}>{resendCooldown > 0 ? `${T("otpResendIn")} (${resendCooldown}s)` : T("otpResend")}</Text>
              </Pressable>
            </>
          )}

          {method === "email" && step === "method" && (
            <>
              <Text style={styles.cardTitle}>{T("emailAddress")}</Text>
              <Text style={styles.cardSubtitle}>{T("enterRegisteredEmail")}</Text>
              <TextInput style={[styles.input, { marginBottom: 8 }]} value={email}
                onChangeText={v => { setEmail(v); clearError(); }}
                placeholder="aapka@email.com" placeholderTextColor={C.textMuted}
                keyboardType="email-address" autoCapitalize="none" />
            </>
          )}

          {method === "email" && step === "otp" && (
            <>
              <Pressable onPress={() => { setStep("method"); clearError(); setEmailDevOtp(""); }} style={styles.backBtn}>
                <Ionicons name="arrow-back" size={16} color={C.primary} />
                <Text style={styles.backBtnText}>{T("changeEmail")}</Text>
              </Pressable>
              <Text style={styles.cardTitle}>{T("enterEmailOtp")}</Text>
              <Text style={styles.cardSubtitle}>{T("otpSentToEmail")} {email}</Text>
              <TextInput style={[styles.input, styles.otpInput, error ? styles.inputError : null]}
                value={emailOtp} onChangeText={v => { setEmailOtp(v); clearError(); }}
                placeholder="6-digit OTP" placeholderTextColor={C.textMuted}
                keyboardType="number-pad" maxLength={6} autoFocus />
              {emailDevOtp ? (
                <View style={styles.devOtpBox}>
                  <Ionicons name="key-outline" size={14} color="#059669" />
                  <Text style={styles.devOtpTxt}>Dev OTP: <Text style={{ fontFamily: "Inter_700Bold", letterSpacing: 4 }}>{emailDevOtp}</Text></Text>
                </View>
              ) : null}
              <Pressable onPress={handleSendEmailOtp} style={[styles.resendBtn, emailResendCooldown > 0 && { opacity: 0.4 }]} disabled={emailResendCooldown > 0}>
                <Text style={styles.resendText}>{emailResendCooldown > 0 ? `${T("otpResendIn")} (${emailResendCooldown}s)` : T("otpResend")}</Text>
              </Pressable>
            </>
          )}

          {method === "username" && step === "method" && (
            <>
              <Text style={styles.cardTitle}>{T("loginViaUsername")}</Text>
              <Text style={styles.cardSubtitle}>{T("enterUsernamePassword")}</Text>
              <TextInput style={[styles.input, { marginBottom: 10 }]} value={username}
                onChangeText={v => { setUsername(v.toLowerCase()); clearError(); }}
                placeholder="Username" placeholderTextColor={C.textMuted} autoCapitalize="none" />
              <View style={styles.pwdWrapper}>
                <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} value={password}
                  onChangeText={v => { setPassword(v); clearError(); }}
                  placeholder="Password" placeholderTextColor={C.textMuted} secureTextEntry={!showPwd} />
                <Pressable onPress={() => setShowPwd(v => !v)} style={styles.eyeBtn}>
                  <Ionicons name={showPwd ? "eye-off-outline" : "eye-outline"} size={20} color={C.textMuted} />
                </Pressable>
              </View>
              <Pressable onPress={() => router.push("/auth/forgot-password")} style={{ alignSelf: "flex-end", marginBottom: 8, marginTop: 4 }}>
                <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: C.primary }}>Forgot Password?</Text>
              </Pressable>
            </>
          )}

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={15} color="#DC2626" />
              <Text style={styles.errorTxt}>{error}</Text>
            </View>
          ) : null}

          {step === "method" && (
            <>
              <Pressable
                onPress={
                  method === "phone" ? handleSendPhoneOtp
                    : method === "email" ? handleSendEmailOtp
                    : handleUsernameLogin
                }
                style={[styles.btn, loading && styles.btnDisabled]}
                disabled={loading}
              >
                {loading ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.btnText}>
                    {method === "phone" || method === "email" ? T("sendOtpBtn") : `${T("loginBtn")} →`}
                  </Text>
                )}
              </Pressable>

              {(socialMethods.length > 0 || showMagicLink || showBiometric) && (
                <>
                  <View style={styles.divider}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>OR</Text>
                    <View style={styles.dividerLine} />
                  </View>

                  {showBiometric && (
                    <Pressable onPress={handleBiometricLogin} style={styles.socialBtn} disabled={biometricLoading}>
                      {biometricLoading ? <ActivityIndicator color={C.primary} size="small" /> : (
                        <>
                          <Ionicons name="finger-print" size={22} color={C.primary} />
                          <Text style={styles.socialBtnText}>Login with Biometrics</Text>
                        </>
                      )}
                    </Pressable>
                  )}

                  {socialMethods.map(sm => (
                    <Pressable key={sm.key} onPress={() => handleSocialLogin(sm.key as any)} style={styles.socialBtn}>
                      <Ionicons name={sm.icon} size={20} color={sm.color} />
                      <Text style={styles.socialBtnText}>Continue with {sm.label}</Text>
                    </Pressable>
                  ))}

                  {showMagicLink && (
                    <>
                      {!magicSent ? (
                        <View style={{ marginTop: 4 }}>
                          <TextInput
                            style={[styles.input, { marginBottom: 8 }]}
                            value={magicEmail}
                            onChangeText={setMagicEmail}
                            placeholder="Email for magic link"
                            placeholderTextColor={C.textMuted}
                            keyboardType="email-address"
                            autoCapitalize="none"
                          />
                          <Pressable onPress={handleMagicLink} style={styles.socialBtn}>
                            <Ionicons name="link" size={20} color="#7C3AED" />
                            <Text style={styles.socialBtnText}>Send Magic Link</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <View style={styles.magicSentBox}>
                          <Ionicons name="checkmark-circle" size={20} color="#10B981" />
                          <Text style={styles.magicSentText}>Magic link sent! Check your email.</Text>
                          {magicCooldown > 0 && <Text style={styles.magicCooldown}>Resend in {magicCooldown}s</Text>}
                        </View>
                      )}
                    </>
                  )}
                </>
              )}

              <Pressable onPress={() => router.push("/auth/register")} style={{ alignItems: "center", marginTop: 20 }}>
                <Text style={{ fontFamily: "Inter_500Medium", fontSize: 14, color: C.primary }}>
                  Don't have an account? <Text style={{ fontFamily: "Inter_700Bold" }}>Register</Text>
                </Text>
              </Pressable>
            </>
          )}

          {step === "otp" && (
            <Pressable
              onPress={method === "phone" ? handleVerifyPhoneOtp : handleVerifyEmailOtp}
              style={[styles.btn, loading && styles.btnDisabled]}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>{`${T("verifyAndContinueBtn")} →`}</Text>}
            </Pressable>
          )}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
          <Text style={styles.footerText}>{T("termsAgreement")}</Text>
        </View>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  gradient:         { flex: 1 },
  topSection:       { alignItems: "center", paddingBottom: 32 },
  centerContainer:  { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  logoContainer:    { marginBottom: 16 },
  logo:             { width: 76, height: 76, borderRadius: 22, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 6, marginBottom: 14 },
  appName:          { fontFamily: "Inter_700Bold", fontSize: 34, color: "#fff", marginBottom: 6 },
  tagline:          { fontFamily: "Inter_400Regular", fontSize: 15, color: "rgba(255,255,255,0.85)" },

  card:             { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, flex: 1 },
  pendingCard:      { backgroundColor: "#fff", borderRadius: 24, padding: 28, alignItems: "center", width: "100%" },
  pendingIcon:      { width: 84, height: 84, borderRadius: 42, backgroundColor: "#FEF3C7", alignItems: "center", justifyContent: "center", marginBottom: 20 },
  pendingTitle:     { fontFamily: "Inter_700Bold", fontSize: 22, color: "#1F2937", marginBottom: 12, textAlign: "center" },
  pendingSubtitle:  { fontFamily: "Inter_400Regular", fontSize: 14, color: "#6B7280", textAlign: "center", marginBottom: 20, lineHeight: 22 },
  pendingInfo:      { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F9FAFB", borderRadius: 10, padding: 12, marginBottom: 24, width: "100%" },
  pendingInfoTxt:   { fontFamily: "Inter_400Regular", fontSize: 13, color: "#6B7280", flex: 1 },

  tabs:             { flexDirection: "row", backgroundColor: "#F3F4F6", borderRadius: 12, padding: 3, marginBottom: 20, gap: 2 },
  tab:              { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 9, borderRadius: 10 },
  tabActive:        { backgroundColor: "#fff", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  tabText:          { fontFamily: "Inter_500Medium", fontSize: 12, color: "#9CA3AF" },
  tabTextActive:    { color: "#1F2937", fontFamily: "Inter_600SemiBold" },

  cardTitle:        { fontFamily: "Inter_700Bold", fontSize: 20, color: "#1F2937", marginBottom: 5 },
  cardSubtitle:     { fontFamily: "Inter_400Regular", fontSize: 13, color: "#6B7280", marginBottom: 18 },

  inputWrapper:     { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 14, overflow: "hidden", marginBottom: 8 },
  countryCode:      { paddingHorizontal: 14, paddingVertical: 16, backgroundColor: "#F9FAFB", borderRightWidth: 1, borderRightColor: "#E5E7EB" },
  countryCodeText:  { fontFamily: "Inter_600SemiBold", fontSize: 16, color: "#374151" },
  input:            { flex: 1, paddingHorizontal: 16, paddingVertical: 15, fontFamily: "Inter_500Medium", fontSize: 16, color: "#1F2937", borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 14 },
  input2:           { paddingHorizontal: 16, paddingVertical: 14, fontFamily: "Inter_500Medium", fontSize: 15, color: "#1F2937", borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 12, marginBottom: 12 },
  otpInput:         { textAlign: "center", letterSpacing: 8, fontSize: 24, fontFamily: "Inter_700Bold" },
  inputError:       { borderColor: "#EF4444" },
  pwdWrapper:       { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 14, overflow: "hidden", marginBottom: 10 },
  eyeBtn:           { paddingHorizontal: 14 },

  fieldLabel:       { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#374151", marginBottom: 6 },

  errorBox:         { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FEF2F2", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, borderWidth: 1, borderColor: "#FECACA" },
  errorTxt:         { fontFamily: "Inter_500Medium", fontSize: 13, color: "#DC2626", flex: 1 },
  devOtpBox:        { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#ECFDF5", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, borderWidth: 1, borderColor: "#A7F3D0" },
  devOtpTxt:        { fontFamily: "Inter_500Medium", fontSize: 13, color: "#059669", flex: 1 },

  btn:              { backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  btnDisabled:      { opacity: 0.7 },
  btnText:          { fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" },

  resendBtn:        { alignItems: "center", marginBottom: 8 },
  resendText:       { fontFamily: "Inter_500Medium", fontSize: 14, color: C.primary },
  backBtn:          { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 16 },
  backBtnText:      { fontFamily: "Inter_500Medium", fontSize: 14, color: C.primary },

  divider:          { flexDirection: "row", alignItems: "center", marginVertical: 16 },
  dividerLine:      { flex: 1, height: 1, backgroundColor: "#E5E7EB" },
  dividerText:      { fontFamily: "Inter_500Medium", fontSize: 12, color: "#9CA3AF", marginHorizontal: 12 },

  socialBtn:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 14, paddingVertical: 14, marginBottom: 8 },
  socialBtnText:    { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#374151" },

  magicSentBox:     { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#ECFDF5", borderRadius: 12, padding: 14, marginTop: 8, borderWidth: 1, borderColor: "#A7F3D0" },
  magicSentText:    { fontFamily: "Inter_500Medium", fontSize: 13, color: "#059669", flex: 1 },
  magicCooldown:    { fontFamily: "Inter_400Regular", fontSize: 11, color: "#6B7280" },

  footer:           { backgroundColor: "#fff", paddingHorizontal: 24, paddingTop: 12, alignItems: "center" },
  footerText:       { fontFamily: "Inter_400Regular", fontSize: 12, color: "#9CA3AF", textAlign: "center" },

  langRow:          { flexDirection: "row", gap: 8, marginTop: 18 },
  langChip:         { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  langChipActive:   { backgroundColor: "rgba(255,255,255,0.3)", borderColor: "rgba(255,255,255,0.5)" },
  langChipTxt:      { fontFamily: "Inter_500Medium", fontSize: 12, color: "rgba(255,255,255,0.7)" },
  langChipTxtActive:{ color: "#fff", fontFamily: "Inter_700Bold" },
});
