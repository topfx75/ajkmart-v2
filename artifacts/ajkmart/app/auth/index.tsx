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

import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { sendOtp, verifyOtp } from "@workspace/api-client-react";

const C = Colors.light;

type LoginMethod = "phone" | "email" | "username";
type Step = "method" | "otp" | "pending" | "complete-profile";

/* ─── simple fetch helper ─── */
async function authPost(path: string, body: object) {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const { config: platformCfg } = usePlatformConfig();
  const appName    = platformCfg.platform.appName;
  const appTagline = platformCfg.platform.appTagline;
  const topPad     = Platform.OS === "web" ? 67 : insets.top;

  /* ── State ── */
  const [method, setMethod]     = useState<LoginMethod>("phone");
  const [step, setStep]         = useState<Step>("method");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  /* Phone OTP */
  const [phone, setPhone]   = useState("");
  const [otp, setOtp]       = useState("");
  const [devOtp, setDevOtp] = useState("");

  /* Email OTP */
  const [email, setEmail]     = useState("");
  const [emailOtp, setEmailOtp] = useState("");
  const [emailDevOtp, setEmailDevOtp] = useState("");

  /* Username + Password */
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd]   = useState(false);

  /* Pending / Profile completion */
  const [pendingToken, setPendingToken]         = useState("");
  const [pendingRefreshToken, setPendingRefreshToken] = useState<string | undefined>(undefined);
  const [profileName, setProfileName]       = useState("");
  const [profileEmail, setProfileEmail]     = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [profilePassword, setProfilePassword] = useState("");
  const [showProfilePwd, setShowProfilePwd]   = useState(false);

  /* OTP resend cooldown — counts down to 0 before resend is allowed */
  const [resendCooldown, setResendCooldown]           = useState(0);
  const [emailResendCooldown, setEmailResendCooldown] = useState(0);
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

  const slideAnim = useRef(new Animated.Value(0)).current;

  const slide = () =>
    Animated.timing(slideAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  const clearError = () => setError("");

  /* ══════════ Phone OTP ══════════ */
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
      const msg: string = e.message || "OTP send nahi hua. Dobara try karein.";
      setError(msg);
      /* If the server says wait N seconds, start the visual countdown */
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
      if (res.pendingApproval) { setPendingToken(res.token); setPendingRefreshToken(res.refreshToken); setStep("pending"); return; }
      if (!res.user.name) { setPendingToken(res.token); setPendingRefreshToken(res.refreshToken); setStep("complete-profile"); return; }
      await login(res.user as any, res.token, res.refreshToken);
      router.replace("/(tabs)");
    } catch (e: any) { setError(e.message || "OTP galat hai. Dobara try karein."); }
    setLoading(false);
  };

  /* ══════════ Email OTP ══════════ */
  const handleSendEmailOtp = async () => {
    clearError();
    if (!email || !email.includes("@")) { setError("Valid email address enter karein"); return; }
    if (emailResendCooldown > 0) { setError(`Please wait ${emailResendCooldown}s before resending.`); return; }
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
      if (res.pendingApproval) { setPendingToken(res.token); setPendingRefreshToken(res.refreshToken); setStep("pending"); return; }
      if (!res.user.name) { setPendingToken(res.token); setPendingRefreshToken(res.refreshToken); setStep("complete-profile"); return; }
      await login(res.user as any, res.token, res.refreshToken);
      router.replace("/(tabs)");
    } catch (e: any) { setError(e.message || "OTP galat hai."); }
    setLoading(false);
  };

  /* ══════════ Username + Password ══════════ */
  const handleUsernameLogin = async () => {
    clearError();
    if (!username || username.length < 3) { setError("Username enter karein"); return; }
    if (!password || password.length < 6) { setError("Password enter karein"); return; }
    setLoading(true);
    try {
      const res = await authPost("/auth/login/username", { username, password });
      if (res.pendingApproval) { setPendingToken(res.token); setStep("pending"); return; }
      await login(res.user as any, res.token, res.refreshToken);
      router.replace("/(tabs)");
    } catch (e: any) { setError(e.message || "Username ya password galat hai."); }
    setLoading(false);
  };

  /* ══════════ Complete Profile ══════════ */
  const handleCompleteProfile = async () => {
    clearError();
    if (!profileName || profileName.trim().length < 2) { setError("Apna naam enter karein"); return; }
    setLoading(true);
    try {
      const res = await authPost("/auth/complete-profile", {
        token: pendingToken,
        name: profileName.trim(),
        ...(profileEmail && { email: profileEmail }),
        ...(profileUsername && { username: profileUsername }),
        ...(profilePassword && profilePassword.length >= 8 && { password: profilePassword }),
      });
      if (res.user) {
        await login(res.user as any, pendingToken, pendingRefreshToken);
        router.replace("/(tabs)");
      }
    } catch (e: any) { setError(e.message || "Profile save nahi hua."); }
    setLoading(false);
  };

  /* ── Tab press ── */
  const selectMethod = (m: LoginMethod) => {
    setMethod(m); clearError();
    setOtp(""); setEmailOtp(""); setDevOtp(""); setEmailDevOtp("");
  };

  /* ═══════════════════════════════════════
     STEP: PENDING APPROVAL
  ═══════════════════════════════════════ */
  if (step === "pending") {
    return (
      <LinearGradient colors={[C.primaryDark, C.primary, "#60A5FA"]} style={styles.gradient}>
        <View style={[styles.centerContainer, { paddingTop: topPad + 40 }]}>
          <View style={styles.pendingCard}>
            <View style={styles.pendingIcon}>
              <Ionicons name="time-outline" size={48} color="#F59E0B" />
            </View>
            <Text style={styles.pendingTitle}>Approval Ka Intezaar</Text>
            <Text style={styles.pendingSubtitle}>
              Aapka account admin approval ke liye submit ho gaya hai. Approve hone ke baad aap login kar sakenge.
            </Text>
            <View style={styles.pendingInfo}>
              <Ionicons name="information-circle-outline" size={16} color="#6B7280" />
              <Text style={styles.pendingInfoTxt}>Approval mein 24-48 ghante lag sakte hain.</Text>
            </View>
            <Pressable style={styles.backBtn} onPress={() => { setStep("method"); setOtp(""); setEmailOtp(""); }}>
              <Ionicons name="arrow-back" size={16} color={C.primary} />
              <Text style={styles.backBtnText}>Wapis Login Par</Text>
            </Pressable>
          </View>
        </View>
      </LinearGradient>
    );
  }

  /* ═══════════════════════════════════════
     STEP: COMPLETE PROFILE
  ═══════════════════════════════════════ */
  if (step === "complete-profile") {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <LinearGradient colors={[C.primaryDark, C.primary, "#60A5FA"]} style={styles.gradient}>
          <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
            <View style={[styles.topSection, { paddingTop: topPad + 24 }]}>
              <View style={styles.logo}><Ionicons name="person" size={36} color={C.primary} /></View>
              <Text style={styles.appName}>Profile Complete Karein</Text>
              <Text style={styles.tagline}>Thodi si information aur ho jayega!</Text>
            </View>

            <View style={styles.card}>
              {/* Name (required) */}
              <Text style={styles.fieldLabel}>Aapka Naam *</Text>
              <TextInput
                style={[styles.input2, error && profileName.trim().length < 2 && styles.inputError]}
                value={profileName} onChangeText={v => { setProfileName(v); clearError(); }}
                placeholder="Full name enter karein" placeholderTextColor={C.textMuted}
                autoFocus
              />

              {/* Email (optional) */}
              <Text style={styles.fieldLabel}>Email (optional)</Text>
              <TextInput
                style={styles.input2} value={profileEmail} onChangeText={v => { setProfileEmail(v); clearError(); }}
                placeholder="email@example.com" placeholderTextColor={C.textMuted}
                keyboardType="email-address" autoCapitalize="none"
              />

              {/* Username (optional) */}
              <Text style={styles.fieldLabel}>Username (optional)</Text>
              <TextInput
                style={styles.input2} value={profileUsername} onChangeText={v => { setProfileUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, "")); clearError(); }}
                placeholder="e.g. ali_ahmed123" placeholderTextColor={C.textMuted}
                autoCapitalize="none"
              />

              {/* Password (optional) */}
              <Text style={styles.fieldLabel}>Password (optional)</Text>
              <View style={styles.pwdWrapper}>
                <TextInput
                  style={[styles.input2, { flex: 1, marginBottom: 0 }]}
                  value={profilePassword} onChangeText={v => { setProfilePassword(v); clearError(); }}
                  placeholder="Min 8 characters" placeholderTextColor={C.textMuted}
                  secureTextEntry={!showProfilePwd}
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

              <Pressable
                onPress={handleCompleteProfile}
                style={[styles.btn, loading && styles.btnDisabled]}
                disabled={loading}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save & Continue →</Text>}
              </Pressable>

              <Pressable onPress={() => { setStep("method"); setPendingToken(""); }} style={{ alignItems: "center", marginTop: 12 }}>
                <Text style={[styles.backBtnText, { fontSize: 13 }]}>Baad mein karein</Text>
              </Pressable>
            </View>
          </ScrollView>
        </LinearGradient>
      </KeyboardAvoidingView>
    );
  }

  /* ═══════════════════════════════════════
     MAIN LOGIN SCREEN
  ═══════════════════════════════════════ */
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <LinearGradient colors={[C.primaryDark, C.primary, "#60A5FA"]} start={{ x: 0, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.gradient}>
        <View style={[styles.topSection, { paddingTop: topPad + 32 }]}>
          <View style={styles.logoContainer}>
            <View style={styles.logo}><Ionicons name="cart" size={40} color={C.primary} /></View>
          </View>
          <Text style={styles.appName}>{appName}</Text>
          <Text style={styles.tagline}>{appTagline}</Text>
        </View>

        <View style={styles.card}>
          {/* ── Method Tabs ── */}
          {step === "method" && (
            <View style={styles.tabs}>
              {(["phone", "email", "username"] as LoginMethod[]).map(m => (
                <Pressable key={m} onPress={() => selectMethod(m)} style={[styles.tab, method === m && styles.tabActive]}>
                  <Ionicons
                    name={m === "phone" ? "call-outline" : m === "email" ? "mail-outline" : "person-outline"}
                    size={15}
                    color={method === m ? C.primary : C.textMuted}
                  />
                  <Text style={[styles.tabText, method === m && styles.tabTextActive]}>
                    {m === "phone" ? "Phone" : m === "email" ? "Email" : "Username"}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* ── Phone OTP ── */}
          {method === "phone" && step === "method" && (
            <>
              <Text style={styles.cardTitle}>Phone Number</Text>
              <Text style={styles.cardSubtitle}>Aapko ek verification code bheja jayega</Text>
              <View style={styles.inputWrapper}>
                <View style={styles.countryCode}><Text style={styles.countryCodeText}>+92</Text></View>
                <TextInput
                  style={styles.input}
                  value={phone} onChangeText={v => { setPhone(v); clearError(); }}
                  placeholder="3XX XXX XXXX" placeholderTextColor={C.textMuted}
                  keyboardType="phone-pad" maxLength={11}
                />
              </View>
            </>
          )}

          {method === "phone" && step === "otp" && (
            <>
              <Pressable onPress={() => { setStep("method"); clearError(); setDevOtp(""); }} style={styles.backBtn}>
                <Ionicons name="arrow-back" size={16} color={C.primary} />
                <Text style={styles.backBtnText}>Number change karein</Text>
              </Pressable>
              <Text style={styles.cardTitle}>OTP Enter Karein</Text>
              <Text style={styles.cardSubtitle}>+92{phone} par bheja gaya</Text>
              <TextInput
                style={[styles.input, styles.otpInput, error ? styles.inputError : null]}
                value={otp} onChangeText={v => { setOtp(v); clearError(); }}
                placeholder="6-digit OTP" placeholderTextColor={C.textMuted}
                keyboardType="number-pad" maxLength={6} autoFocus
              />
              {devOtp ? (
                <View style={styles.devOtpBox}>
                  <Ionicons name="key-outline" size={14} color="#059669" />
                  <Text style={styles.devOtpTxt}>Dev OTP: <Text style={{ fontFamily: "Inter_700Bold", letterSpacing: 4 }}>{devOtp}</Text></Text>
                </View>
              ) : null}
              <Pressable
                onPress={handleSendPhoneOtp}
                style={[styles.resendBtn, resendCooldown > 0 && { opacity: 0.4 }]}
                disabled={resendCooldown > 0}
              >
                <Text style={styles.resendText}>
                  {resendCooldown > 0 ? `OTP dobara bhejein (${resendCooldown}s)` : "OTP dobara bhejein"}
                </Text>
              </Pressable>
            </>
          )}

          {/* ── Email OTP ── */}
          {method === "email" && step === "method" && (
            <>
              <Text style={styles.cardTitle}>Email Address</Text>
              <Text style={styles.cardSubtitle}>Pehle se registered email se login karein</Text>
              <TextInput
                style={[styles.input, { marginBottom: 8 }]}
                value={email} onChangeText={v => { setEmail(v); clearError(); }}
                placeholder="aapka@email.com" placeholderTextColor={C.textMuted}
                keyboardType="email-address" autoCapitalize="none"
              />
            </>
          )}

          {method === "email" && step === "otp" && (
            <>
              <Pressable onPress={() => { setStep("method"); clearError(); setEmailDevOtp(""); }} style={styles.backBtn}>
                <Ionicons name="arrow-back" size={16} color={C.primary} />
                <Text style={styles.backBtnText}>Email change karein</Text>
              </Pressable>
              <Text style={styles.cardTitle}>Email OTP</Text>
              <Text style={styles.cardSubtitle}>{email} par bheja gaya</Text>
              <TextInput
                style={[styles.input, styles.otpInput, error ? styles.inputError : null]}
                value={emailOtp} onChangeText={v => { setEmailOtp(v); clearError(); }}
                placeholder="6-digit OTP" placeholderTextColor={C.textMuted}
                keyboardType="number-pad" maxLength={6} autoFocus
              />
              {emailDevOtp ? (
                <View style={styles.devOtpBox}>
                  <Ionicons name="key-outline" size={14} color="#059669" />
                  <Text style={styles.devOtpTxt}>Dev OTP: <Text style={{ fontFamily: "Inter_700Bold", letterSpacing: 4 }}>{emailDevOtp}</Text></Text>
                </View>
              ) : null}
              <Pressable
                onPress={handleSendEmailOtp}
                style={[styles.resendBtn, emailResendCooldown > 0 && { opacity: 0.4 }]}
                disabled={emailResendCooldown > 0}
              >
                <Text style={styles.resendText}>
                  {emailResendCooldown > 0 ? `OTP dobara bhejein (${emailResendCooldown}s)` : "OTP dobara bhejein"}
                </Text>
              </Pressable>
            </>
          )}

          {/* ── Username + Password ── */}
          {method === "username" && step === "method" && (
            <>
              <Text style={styles.cardTitle}>Username se Login</Text>
              <Text style={styles.cardSubtitle}>Apna username aur password dalein</Text>
              <TextInput
                style={[styles.input, { marginBottom: 10 }]}
                value={username} onChangeText={v => { setUsername(v.toLowerCase()); clearError(); }}
                placeholder="Username" placeholderTextColor={C.textMuted}
                autoCapitalize="none"
              />
              <View style={styles.pwdWrapper}>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  value={password} onChangeText={v => { setPassword(v); clearError(); }}
                  placeholder="Password" placeholderTextColor={C.textMuted}
                  secureTextEntry={!showPwd}
                />
                <Pressable onPress={() => setShowPwd(v => !v)} style={styles.eyeBtn}>
                  <Ionicons name={showPwd ? "eye-off-outline" : "eye-outline"} size={20} color={C.textMuted} />
                </Pressable>
              </View>
            </>
          )}

          {/* ── Error ── */}
          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={15} color="#DC2626" />
              <Text style={styles.errorTxt}>{error}</Text>
            </View>
          ) : null}

          {/* ── Main CTA Button ── */}
          <Pressable
            onPress={
              method === "phone"
                ? step === "method" ? handleSendPhoneOtp : handleVerifyPhoneOtp
                : method === "email"
                ? step === "method" ? handleSendEmailOtp : handleVerifyEmailOtp
                : handleUsernameLogin
            }
            style={[styles.btn, loading && styles.btnDisabled]}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : (
              <Text style={styles.btnText}>
                {method === "phone"
                  ? step === "method" ? "OTP Bhejein" : "Verify & Continue →"
                  : method === "email"
                  ? step === "method" ? "Email OTP Bhejein" : "Verify & Continue →"
                  : "Login Karein →"
                }
              </Text>
            )}
          </Pressable>
        </View>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
          <Text style={styles.footerText}>Continue karne par aap hamare Terms & Privacy Policy se agree karte hain</Text>
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

  footer:           { backgroundColor: "#fff", paddingHorizontal: 24, paddingTop: 12, alignItems: "center" },
  footerText:       { fontFamily: "Inter_400Regular", fontSize: 12, color: "#9CA3AF", textAlign: "center" },
});
