import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { usePlatformConfig, isMethodEnabled } from "@/context/PlatformConfigContext";
import { useToast } from "@/context/ToastContext";
import { LANGUAGE_OPTIONS, tDual, type Language, type TranslationKey } from "@workspace/i18n";

const C   = Colors.light;
const API = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

function relativeTime(iso: string) {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1)  return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* ══════════════════════════════════════════
   EDIT PROFILE MODAL  (name + email + phone)
══════════════════════════════════════════ */
const EXPO_CITIES = ["Muzaffarabad","Mirpur","Rawalakot","Bagh","Kotli","Bhimber","Poonch","Neelum Valley","Rawalpindi","Islamabad","Other"];

function EditProfileModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { user, updateUser, token } = useAuth();
  const { showToast } = useToast();
  const [name,   setName]   = useState(user?.name  || "");
  const [email,  setEmail]  = useState(user?.email || "");
  const [cnic,   setCnic]   = useState(user?.cnic  || "");
  const [city,   setCity]   = useState(user?.city  || "");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");
  const [showCityPicker, setShowCityPicker] = useState(false);

  useEffect(() => {
    if (visible) { setName(user?.name || ""); setEmail(user?.email || ""); setCnic(user?.cnic || ""); setCity(user?.city || ""); setError(""); }
  }, [visible, user]);

  const save = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`${API}/users/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), cnic: cnic.trim(), city: city.trim() }),
      });
      if (!res.ok) throw new Error();
      updateUser({ name: name.trim(), email: email.trim(), cnic: cnic.trim(), city: city.trim() });
      onClose();
      showToast("Profile updated!", "success");
    } catch { showToast("Update failed. Please try again.", "error"); }
    setSaving(false);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={st.overlay} onPress={onClose}>
        <Pressable style={st.sheet} onPress={e => e.stopPropagation()}>
          <View style={st.sheetHandle} />
          <Text style={st.sheetTitle}>Edit Profile</Text>
          <Text style={st.sheetSub}>Update your information</Text>

          {/* Phone (read-only) */}
          <Text style={st.fldLabel}>Phone Number</Text>
          <View style={[st.fldWrap, { backgroundColor: "#F8FAFC" }]}>
            <View style={st.fldPre}>
              <Text style={st.fldPreTxt}>🇵🇰 +92</Text>
            </View>
            <Text style={[st.fldTxt, { color: C.textMuted }]}>{user?.phone || "—"}</Text>
            <View style={st.fldLock}>
              <Ionicons name="lock-closed-outline" size={14} color={C.textMuted} />
              <Text style={st.fldLockTxt}>Verified</Text>
            </View>
          </View>
          <Text style={st.fldHint}>To change phone, call helpline: 0300-AJKMART</Text>

          {/* Full Name */}
          <Text style={[st.fldLabel, { marginTop: 16 }]}>Full Name</Text>
          <View style={st.fldWrap}>
            <View style={[st.fldPre, { backgroundColor: "#EFF6FF" }]}>
              <Ionicons name="person-outline" size={16} color={C.primary} />
            </View>
            <TextInput
              style={st.fldInput}
              value={name}
              onChangeText={setName}
              placeholder="Enter your name"
              placeholderTextColor={C.textMuted}
              autoCapitalize="words"
            />
          </View>

          {/* Email */}
          <Text style={[st.fldLabel, { marginTop: 12 }]}>Email Address</Text>
          <View style={st.fldWrap}>
            <View style={[st.fldPre, { backgroundColor: "#F0FDF4" }]}>
              <Ionicons name="mail-outline" size={16} color="#059669" />
            </View>
            <TextInput
              style={st.fldInput}
              value={email}
              onChangeText={setEmail}
              placeholder="email@example.com (optional)"
              placeholderTextColor={C.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          {/* CNIC */}
          <Text style={[st.fldLabel, { marginTop: 12 }]}>CNIC / National ID</Text>
          <View style={st.fldWrap}>
            <View style={[st.fldPre, { backgroundColor: "#FFF7ED" }]}>
              <Ionicons name="card-outline" size={16} color="#D97706" />
            </View>
            <TextInput
              style={st.fldInput}
              value={cnic}
              onChangeText={setCnic}
              placeholder="XXXXX-XXXXXXX-X (optional)"
              placeholderTextColor={C.textMuted}
              keyboardType="numeric"
              maxLength={15}
            />
          </View>
          <Text style={st.fldHint}>For verification (optional)</Text>

          {/* City */}
          <Text style={[st.fldLabel, { marginTop: 12 }]}>City</Text>
          <View style={[st.fldWrap, { paddingRight: 0, overflow: "hidden" }]}>
            <View style={[st.fldPre, { backgroundColor: "#F0FDF4" }]}>
              <Ionicons name="location-outline" size={16} color="#059669" />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", gap: 6, alignItems: "center", paddingRight: 12, paddingLeft: 8, height: 52 }}>
                {EXPO_CITIES.map(c => (
                  <Pressable key={c} onPress={() => setCity(c)}
                    style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: city === c ? "#D1FAE5" : "#F8FAFC", borderWidth: 1, borderColor: city === c ? "#059669" : "#E2E8F0" }}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: city === c ? "#059669" : C.textMuted }}>{c}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>

          {error ? (
            <View style={st.errorBox}>
              <Ionicons name="alert-circle-outline" size={14} color="#DC2626" />
              <Text style={st.errorTxt}>{error}</Text>
            </View>
          ) : null}

          <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
            <Pressable onPress={onClose} style={st.cancelBtn}>
              <Text style={st.cancelTxt}>Cancel</Text>
            </Pressable>
            <Pressable onPress={save} disabled={saving} style={[st.saveBtn, saving && { opacity: 0.7 }]}>
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={st.saveTxt}>Save Changes</Text>}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ══════════════════════════════════════════
   NOTIFICATIONS MODAL
══════════════════════════════════════════ */
function NotificationsModal({ visible, userId, token, onClose }: {
  visible: boolean; userId: string; token?: string; onClose: (unread: number) => void;
}) {
  const [notifs,  setNotifs]  = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);

  const authHdrs = token ? { Authorization: `Bearer ${token}` } : {};

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const r = await fetch(`${API}/notifications`, { headers: authHdrs });
      const d = await r.json();
      setNotifs(d.notifications || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [userId, token]);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  const markOne = async (id: string) => {
    await fetch(`${API}/notifications/${id}/read`, { method: "PATCH", headers: authHdrs });
    setNotifs(p => p.map(n => n.id === id ? { ...n, isRead: true } : n));
  };
  const markAll = async () => {
    setMarking(true);
    await fetch(`${API}/notifications/read-all`, { method: "PATCH", headers: { "Content-Type": "application/json", ...authHdrs } });
    setNotifs(p => p.map(n => ({ ...n, isRead: true })));
    setMarking(false);
  };
  const del = async (id: string) => {
    await fetch(`${API}/notifications/${id}`, { method: "DELETE", headers: authHdrs });
    setNotifs(p => p.filter(n => n.id !== id));
  };

  const unread = notifs.filter(n => !n.isRead).length;
  const typeMap: Record<string, [keyof typeof Ionicons.glyphMap, string, string]> = {
    wallet: ["wallet-outline",         C.primary,  "#DBEAFE"],
    ride:   ["car-outline",            "#059669",  "#D1FAE5"],
    order:  ["bag-outline",            "#D97706",  "#FEF3C7"],
    deal:   ["pricetag-outline",       "#7C3AED",  "#EDE9FE"],
    system: ["notifications-outline",  "#64748B",  "#F1F5F9"],
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => onClose(unread)}>
      <View style={{ flex: 1, backgroundColor: "#fff" }}>
        <View style={nm.header}>
          <View>
            <Text style={nm.title}>Notifications</Text>
            {unread > 0 && <Text style={nm.sub}>{unread} naye</Text>}
          </View>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            {unread > 0 && (
              <Pressable onPress={markAll} disabled={marking} style={nm.markAllBtn}>
                {marking ? <ActivityIndicator size="small" color={C.primary} /> : <Text style={nm.markAllTxt}>Mark all as read</Text>}
              </Pressable>
            )}
            <Pressable onPress={() => onClose(unread)} style={nm.closeBtn}>
              <Ionicons name="close" size={20} color={C.text} />
            </Pressable>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
        ) : notifs.length === 0 ? (
          <View style={nm.empty}>
            <Text style={{ fontSize: 52 }}>🔔</Text>
            <Text style={nm.emptyTitle}>No notifications</Text>
            <Text style={nm.emptySub}>You're all caught up!</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6 }}>
            {notifs.map(n => {
              const [icon, color, bg] = typeMap[n.type] || typeMap.system!;
              return (
                <Pressable key={n.id} onPress={() => !n.isRead && markOne(n.id)} style={[nm.item, !n.isRead && nm.itemUnread]}>
                  <View style={[nm.iIcon, { backgroundColor: bg }]}>
                    <Ionicons name={icon} size={19} color={color} />
                    {!n.isRead && <View style={nm.dot} />}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[nm.iTitle, !n.isRead && { fontFamily: "Inter_700Bold" }]}>{n.title}</Text>
                    <Text style={nm.iBody} numberOfLines={2}>{n.body}</Text>
                    <Text style={nm.iTime}>{relativeTime(n.createdAt)}</Text>
                  </View>
                  <Pressable onPress={() => del(n.id)} style={nm.del}>
                    <Ionicons name="close" size={13} color={C.textMuted} />
                  </Pressable>
                </Pressable>
              );
            })}
            <View style={{ height: 32 }} />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

/* ══════════════════════════════════════════
   PRIVACY & SECURITY MODAL
══════════════════════════════════════════ */
function PrivacyModal({ visible, userId, token, onClose }: { visible: boolean; userId: string; token?: string; onClose: () => void }) {
  const { showToast } = useToast();
  const { biometricEnabled, setBiometricEnabled, user, updateUser } = useAuth();
  const { config } = usePlatformConfig();
  const [cfg,     setCfg]     = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState<string | null>(null);
  const authHdrs = token ? { Authorization: `Bearer ${token}` } : {};

  const [show2FASetup, setShow2FASetup]   = useState(false);
  const [twoFASecret, setTwoFASecret]     = useState("");
  const [twoFAUri, setTwoFAUri]           = useState("");
  const [twoFAQR, setTwoFAQR]             = useState("");
  const [twoFACode, setTwoFACode]         = useState("");
  const [backupCodes, setBackupCodes]      = useState<string[]>([]);
  const [twoFALoading, setTwoFALoading]   = useState(false);
  const [twoFAError, setTwoFAError]       = useState("");
  const [showDisable2FA, setShowDisable2FA] = useState(false);
  const [disableCode, setDisableCode]      = useState("");

  useEffect(() => {
    if (!visible || !userId) return;
    setLoading(true);
    fetch(`${API}/settings`, { headers: authHdrs })
      .then(r => r.json())
      .then(d => setCfg({ notifOrders: d.notifOrders, notifWallet: d.notifWallet, notifDeals: d.notifDeals, notifRides: d.notifRides, locationSharing: d.locationSharing, darkMode: d.darkMode }))
      .finally(() => setLoading(false));
  }, [visible, userId, token]);

  const toggle = async (k: string, v: boolean) => {
    setSaving(k);
    const upd = { ...cfg, [k]: v };
    setCfg(upd);
    try { await fetch(`${API}/settings`, { method: "PUT", headers: { "Content-Type": "application/json", ...authHdrs }, body: JSON.stringify(upd) }); }
    catch { setCfg(cfg); }
    setSaving(null);
  };

  const handleBiometricToggle = async (v: boolean) => {
    setSaving("biometric");
    try {
      if (v) {
        const LocalAuth = await import("expo-local-authentication");
        const hasHardware = await LocalAuth.hasHardwareAsync();
        if (!hasHardware) { showToast("Device does not support biometrics", "error"); setSaving(null); return; }
        const isEnrolled = await LocalAuth.isEnrolledAsync();
        if (!isEnrolled) { showToast("No biometrics enrolled on device", "error"); setSaving(null); return; }
        const result = await LocalAuth.authenticateAsync({ promptMessage: "Enable Biometric Login", cancelLabel: "Cancel" });
        if (!result.success) { setSaving(null); return; }
      }
      await setBiometricEnabled(v);
      showToast(v ? "Biometric login enabled" : "Biometric login disabled", "success");
    } catch { showToast("Biometric setup failed", "error"); }
    setSaving(null);
  };

  const handle2FAToggle = async () => {
    if (user?.totpEnabled) {
      setShowDisable2FA(true);
      return;
    }
    setTwoFALoading(true);
    setTwoFAError("");
    try {
      const res = await fetch(`${API}/auth/2fa/setup`, { headers: authHdrs });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTwoFASecret(data.secret);
      setTwoFAUri(data.uri);
      setTwoFAQR(data.qrDataUrl ?? "");
      setShow2FASetup(true);
    } catch (e: any) { showToast(e.message || "2FA setup failed", "error"); }
    setTwoFALoading(false);
  };

  const handleVerify2FASetup = async () => {
    if (!twoFACode || twoFACode.length < 6) { setTwoFAError("Enter 6-digit code"); return; }
    setTwoFALoading(true);
    setTwoFAError("");
    try {
      const res = await fetch(`${API}/auth/2fa/verify-setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHdrs },
        body: JSON.stringify({ code: twoFACode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBackupCodes(data.backupCodes || []);
      updateUser({ totpEnabled: true } as any);
      showToast("2FA enabled successfully!", "success");
    } catch (e: any) { setTwoFAError(e.message || "Verification failed"); }
    setTwoFALoading(false);
  };

  const handleDisable2FA = async () => {
    if (!disableCode || disableCode.length < 6) { setTwoFAError("Enter 6-digit code"); return; }
    setTwoFALoading(true);
    setTwoFAError("");
    try {
      const res = await fetch(`${API}/auth/2fa/disable`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHdrs },
        body: JSON.stringify({ code: disableCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      updateUser({ totpEnabled: false } as any);
      setShowDisable2FA(false);
      setDisableCode("");
      showToast("2FA disabled", "success");
    } catch (e: any) { setTwoFAError(e.message || "Failed to disable 2FA"); }
    setTwoFALoading(false);
  };

  const Row = ({ k, label, sub, icon, ic = C.primary, ib = C.rideLight }: { k: string; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap; ic?: string; ib?: string }) => (
    <View style={pv.row}>
      <View style={[pv.rIcon, { backgroundColor: ib }]}><Ionicons name={icon} size={17} color={ic} /></View>
      <View style={{ flex: 1 }}>
        <Text style={pv.rLabel}>{label}</Text>
        <Text style={pv.rSub}>{sub}</Text>
      </View>
      {saving === k ? <ActivityIndicator size="small" color={C.primary} /> : (
        <Switch value={cfg[k] ?? false} onValueChange={v => toggle(k, v)} trackColor={{ false: C.border, true: C.primary }} thumbColor="#fff" />
      )}
    </View>
  );

  const is2FAEnabled = isMethodEnabled(config.auth.twoFactorEnabled);
  const isBioEnabled = isMethodEnabled(config.auth.biometricEnabled);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#fff" }}>
        <View style={pv.header}>
          <Text style={pv.title}>Privacy & Security</Text>
          <Pressable onPress={onClose} style={pv.closeBtn}><Ionicons name="close" size={20} color={C.text} /></Pressable>
        </View>
        {loading ? <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} /> : (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 40 }}>
            <View>
              <Text style={pv.secTitle}>🔔 Notifications</Text>
              <View style={pv.card}>
                <Row k="notifOrders"  label="Order Updates"    sub="Delivery & order status"     icon="bag-outline"           ic={C.primary} ib={C.rideLight} />
                <Row k="notifWallet"  label="Wallet Activity"  sub="Payment & top-up alerts"     icon="wallet-outline"        ic="#7C3AED"   ib="#EDE9FE" />
                <Row k="notifDeals"   label="Deals & Offers"   sub="Discounts & promotions"      icon="pricetag-outline"      ic="#D97706"   ib="#FEF3C7" />
                <Row k="notifRides"   label="Ride Updates"     sub="Driver assignment & ETA"     icon="car-outline"           ic="#059669"   ib="#D1FAE5" />
              </View>
            </View>
            <View>
              <Text style={pv.secTitle}>🔒 Privacy</Text>
              <View style={pv.card}>
                <Row k="locationSharing" label="Location Sharing" sub="For rides and deliveries"  icon="location-outline"     ic="#059669" ib="#D1FAE5" />
                <Row k="darkMode"        label="Dark Mode"        sub="App appearance"               icon="moon-outline"         ic="#7C3AED" ib="#EDE9FE" />
              </View>
            </View>
            <View>
              <Text style={pv.secTitle}>🛡️ Security</Text>
              <View style={pv.card}>
                {isBioEnabled && (
                  <View style={pv.row}>
                    <View style={[pv.rIcon, { backgroundColor: C.rideLight }]}><Ionicons name="finger-print-outline" size={17} color={C.primary} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={pv.rLabel}>Biometric Login</Text>
                      <Text style={pv.rSub}>Face ID / Fingerprint</Text>
                    </View>
                    {saving === "biometric" ? <ActivityIndicator size="small" color={C.primary} /> : (
                      <Switch value={biometricEnabled} onValueChange={handleBiometricToggle} trackColor={{ false: C.border, true: C.primary }} thumbColor="#fff" />
                    )}
                  </View>
                )}
                {is2FAEnabled && (
                  <Pressable onPress={handle2FAToggle} style={pv.row}>
                    <View style={[pv.rIcon, { backgroundColor: "#D1FAE5" }]}><Ionicons name="shield-outline" size={17} color="#059669" /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={pv.rLabel}>Two-Factor Auth</Text>
                      <Text style={pv.rSub}>{user?.totpEnabled ? "Enabled — tap to disable" : "Authenticator app"}</Text>
                    </View>
                    {twoFALoading ? <ActivityIndicator size="small" color={C.primary} /> : (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        {user?.totpEnabled && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#10B981" }} />}
                        <Ionicons name="chevron-forward" size={15} color={C.textMuted} />
                      </View>
                    )}
                  </Pressable>
                )}
              </View>
            </View>
            <View>
              <Text style={pv.secTitle}>⚙️ Account Actions</Text>
              <View style={pv.card}>
                <Pressable onPress={() => showToast("Your data will be emailed within 24 hours.", "info")} style={[pv.row, { borderBottomWidth: 0 }]}>
                  <View style={[pv.rIcon, { backgroundColor: "#F1F5F9" }]}><Ionicons name="download-outline" size={17} color="#64748B" /></View>
                  <View style={{ flex: 1 }}><Text style={pv.rLabel}>Download My Data</Text><Text style={pv.rSub}>Export all your data</Text></View>
                  <Ionicons name="chevron-forward" size={15} color={C.textMuted} />
                </Pressable>
              </View>
            </View>
          </ScrollView>
        )}

        <Modal visible={show2FASetup} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setShow2FASetup(false); setTwoFACode(""); setBackupCodes([]); setTwoFAError(""); }}>
          <View style={{ flex: 1, backgroundColor: "#fff" }}>
            <View style={pv.header}>
              <Text style={pv.title}>{backupCodes.length > 0 ? "Backup Codes" : "Setup 2FA"}</Text>
              <Pressable onPress={() => { setShow2FASetup(false); setTwoFACode(""); setBackupCodes([]); setTwoFAError(""); }} style={pv.closeBtn}>
                <Ionicons name="close" size={20} color={C.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
              {backupCodes.length > 0 ? (
                <>
                  <View style={{ alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <Ionicons name="checkmark-circle" size={48} color="#10B981" />
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 20, color: "#1F2937" }}>2FA Activated!</Text>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: "#6B7280", textAlign: "center" }}>
                      Save these backup codes securely. They cannot be shown again.
                    </Text>
                  </View>
                  <View style={{ backgroundColor: "#FEF3C7", borderRadius: 12, padding: 16, borderWidth: 1, borderColor: "#FDE68A" }}>
                    {backupCodes.map((code, i) => (
                      <Text key={i} style={{ fontFamily: "Inter_600SemiBold", fontSize: 16, color: "#92400E", textAlign: "center", paddingVertical: 4, letterSpacing: 2 }}>{code}</Text>
                    ))}
                  </View>
                </>
              ) : (
                <>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: "#6B7280", lineHeight: 22 }}>
                    1. Install an authenticator app (Google Authenticator, Authy){"\n"}
                    2. Scan the QR code or enter the secret manually{"\n"}
                    3. Enter the 6-digit code to verify
                  </Text>
                  {twoFASecret ? (
                    <View style={{ backgroundColor: "#F9FAFB", borderRadius: 12, padding: 16, borderWidth: 1, borderColor: "#E5E7EB" }}>
                      <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: "#6B7280", marginBottom: 8 }}>Secret Key (manual entry):</Text>
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#1F2937", letterSpacing: 2 }} selectable>{twoFASecret}</Text>
                    </View>
                  ) : null}
                  <TextInput
                    style={{ paddingHorizontal: 16, paddingVertical: 14, fontFamily: "Inter_700Bold", fontSize: 24, color: "#1F2937", borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 14, textAlign: "center", letterSpacing: 8 }}
                    value={twoFACode} onChangeText={v => { setTwoFACode(v); setTwoFAError(""); }}
                    placeholder="6-digit code" placeholderTextColor={C.textMuted}
                    keyboardType="number-pad" maxLength={6}
                  />
                  {twoFAError ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FEF2F2", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#FECACA" }}>
                      <Ionicons name="alert-circle-outline" size={15} color="#DC2626" />
                      <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: "#DC2626" }}>{twoFAError}</Text>
                    </View>
                  ) : null}
                  <Pressable onPress={handleVerify2FASetup} disabled={twoFALoading}
                    style={{ backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center", opacity: twoFALoading ? 0.7 : 1 }}>
                    {twoFALoading ? <ActivityIndicator color="#fff" /> : <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" }}>Verify & Enable</Text>}
                  </Pressable>
                </>
              )}
            </ScrollView>
          </View>
        </Modal>

        <Modal visible={showDisable2FA} animationType="slide" transparent onRequestClose={() => { setShowDisable2FA(false); setDisableCode(""); setTwoFAError(""); }}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 24 }}>
            <View style={{ backgroundColor: "#fff", borderRadius: 20, padding: 24 }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 18, color: "#1F2937", marginBottom: 8 }}>Disable 2FA</Text>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: "#6B7280", marginBottom: 16 }}>Enter your authenticator code to disable two-factor authentication.</Text>
              <TextInput
                style={{ paddingHorizontal: 16, paddingVertical: 14, fontFamily: "Inter_700Bold", fontSize: 24, color: "#1F2937", borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 14, textAlign: "center", letterSpacing: 8, marginBottom: 12 }}
                value={disableCode} onChangeText={v => { setDisableCode(v); setTwoFAError(""); }}
                placeholder="6-digit code" placeholderTextColor={C.textMuted}
                keyboardType="number-pad" maxLength={6} autoFocus
              />
              {twoFAError ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FEF2F2", borderRadius: 10, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: "#FECACA" }}>
                  <Ionicons name="alert-circle-outline" size={15} color="#DC2626" />
                  <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: "#DC2626" }}>{twoFAError}</Text>
                </View>
              ) : null}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable onPress={() => { setShowDisable2FA(false); setDisableCode(""); setTwoFAError(""); }}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, borderColor: "#E5E7EB", alignItems: "center" }}>
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#6B7280" }}>Cancel</Text>
                </Pressable>
                <Pressable onPress={handleDisable2FA} disabled={twoFALoading}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: "#EF4444", alignItems: "center", opacity: twoFALoading ? 0.7 : 1 }}>
                  {twoFALoading ? <ActivityIndicator color="#fff" /> : <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#fff" }}>Disable</Text>}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

/* ══════════════════════════════════════════
   SAVED ADDRESSES MODAL
══════════════════════════════════════════ */
const LABEL_OPTS = [
  { label: "Home",  icon: "home-outline"      as const, color: "#059669", bg: "#D1FAE5" },
  { label: "Work",  icon: "briefcase-outline" as const, color: C.primary, bg: C.rideLight },
  { label: "Other", icon: "location-outline"  as const, color: "#D97706", bg: "#FEF3C7" },
];
const AJK_CITIES = ["Muzaffarabad","Mirpur","Rawalakot","Bagh","Kotli","Bhimber","Poonch","Neelum Valley"];

function AddressesModal({ visible, userId, token, onClose }: { visible: boolean; userId: string; token?: string; onClose: () => void }) {
  const { showToast } = useToast();
  const [list,    setList]    = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [label,   setLabel]   = useState("Home");
  const [addr,    setAddr]    = useState("");
  const [city,    setCity]    = useState("Muzaffarabad");
  const [saving,  setSaving]  = useState(false);

  const authHdrs = token ? { Authorization: `Bearer ${token}` } : {};

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try { const r = await fetch(`${API}/addresses`, { headers: authHdrs }); const d = await r.json(); setList(d.addresses || []); }
    catch { /* ignore */ }
    setLoading(false);
  }, [userId, token]);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const add = async () => {
    if (!addr.trim()) { showToast("Address is required", "error"); return; }
    setSaving(true);
    const opt = LABEL_OPTS.find(o => o.label === label)!;
    try {
      await fetch(`${API}/addresses`, { method: "POST", headers: { "Content-Type": "application/json", ...authHdrs }, body: JSON.stringify({ label, address: addr.trim(), city, icon: opt.icon, isDefault: list.length === 0 }) });
      setAddr(""); setCity("Muzaffarabad"); setShowAdd(false); await load();
      showToast("Address saved!", "success");
    } catch { showToast("Could not save address", "error"); }
    setSaving(false);
  };
  const del = async (id: string) => {
    await fetch(`${API}/addresses/${id}`, { method: "DELETE", headers: authHdrs });
    setList(p => p.filter(a => a.id !== id));
    setDeleteConfirmId(null);
    showToast("Address deleted", "info");
  };

  const [settingDefault, setSettingDefault] = useState<string | null>(null);
  const setDefault = async (id: string) => {
    setSettingDefault(id);
    try {
      const r = await fetch(`${API}/addresses/${id}/set-default`, { method: "PATCH", headers: { "Content-Type": "application/json", ...authHdrs } });
      if (!r.ok) throw new Error();
      setList(p => p.map(a => ({ ...a, isDefault: a.id === id })));
      showToast("Default address set!", "success");
    } catch { showToast("Could not set default", "error"); }
    setSettingDefault(null);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#fff" }}>
        <View style={ad.header}>
          <Text style={ad.title}>Saved Addresses</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={() => setShowAdd(v => !v)} style={ad.addBtn}>
              <Ionicons name={showAdd ? "close" : "add"} size={17} color="#fff" />
              <Text style={ad.addBtnTxt}>{showAdd ? "Cancel" : "Add New"}</Text>
            </Pressable>
            <Pressable onPress={onClose} style={ad.closeBtn}><Ionicons name="close" size={20} color={C.text} /></Pressable>
          </View>
        </View>

        {showAdd && (
          <View style={ad.addPanel}>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
              {LABEL_OPTS.map(o => (
                <Pressable key={o.label} onPress={() => setLabel(o.label)} style={[ad.chip, label === o.label && { backgroundColor: o.bg, borderColor: o.color }]}>
                  <Ionicons name={o.icon} size={13} color={label === o.label ? o.color : C.textMuted} />
                  <Text style={[ad.chipTxt, label === o.label && { color: o.color }]}>{o.label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={ad.fld}>
              <TextInput value={addr} onChangeText={setAddr} placeholder="Enter full address..." placeholderTextColor={C.textMuted} style={ad.fldTxt} multiline />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {AJK_CITIES.map(c => (
                  <Pressable key={c} onPress={() => setCity(c)} style={[ad.cityChip, city === c && { backgroundColor: C.rideLight, borderColor: C.primary }]}>
                    <Text style={[ad.cityTxt, city === c && { color: C.primary }]}>{c}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
            <Pressable onPress={add} disabled={saving} style={[ad.saveBtn, saving && { opacity: 0.7 }]}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={ad.saveBtnTxt}>Save Address</Text>}
            </Pressable>
          </View>
        )}

        {loading ? <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} /> : list.length === 0 && !showAdd ? (
          <View style={ad.empty}>
            <Text style={{ fontSize: 52 }}>📍</Text>
            <Text style={ad.emptyTitle}>No addresses</Text>
            <Text style={ad.emptySub}>Save your home or office address</Text>
            <Pressable onPress={() => setShowAdd(true)} style={ad.emptyBtn}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={ad.emptyBtnTxt}>Add Address</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
            {list.map(a => {
              const opt = LABEL_OPTS.find(o => o.label === a.label) || LABEL_OPTS[2]!;
              return (
                <View key={a.id} style={ad.item}>
                  <View style={[ad.iIcon, { backgroundColor: opt.bg }]}>
                    <Ionicons name={opt.icon} size={19} color={opt.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={ad.iLabel}>{a.label}</Text>
                      {a.isDefault && <View style={ad.defBadge}><Text style={ad.defTxt}>Default</Text></View>}
                    </View>
                    <Text style={ad.iAddr}>{a.address}</Text>
                    <Text style={ad.iCity}>{a.city}, AJK</Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                    {!a.isDefault && (
                      <Pressable onPress={() => setDefault(a.id)} disabled={settingDefault === a.id} style={{ paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, backgroundColor: "#EFF6FF", borderWidth: 1, borderColor: "#BFDBFE" }}>
                        {settingDefault === a.id
                          ? <ActivityIndicator size="small" color={C.primary} />
                          : <Text style={{ fontSize: 10, color: C.primary, fontFamily: "Inter_600SemiBold" }}>Set Default</Text>}
                      </Pressable>
                    )}
                    {deleteConfirmId === a.id ? (
                      <View style={{ flexDirection: "row", gap: 6 }}>
                        <Pressable onPress={() => del(a.id)} style={[ad.delBtn, { backgroundColor: "#FEE2E2", paddingHorizontal: 8, borderRadius: 6, width: "auto" as any }]}>
                          <Text style={{ fontSize: 11, color: C.danger, fontWeight: "600" }}>Yes</Text>
                        </Pressable>
                        <Pressable onPress={() => setDeleteConfirmId(null)} style={[ad.delBtn, { backgroundColor: "#F1F5F9", paddingHorizontal: 8, borderRadius: 6, width: "auto" as any }]}>
                          <Text style={{ fontSize: 11, color: C.textMuted, fontWeight: "600" }}>No</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable onPress={() => setDeleteConfirmId(a.id)} style={ad.delBtn}>
                        <Ionicons name="trash-outline" size={16} color={C.danger} />
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
            <View style={{ height: 30 }} />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

/* ════════════════════════════════════════════════════
   MAIN PROFILE SCREEN
════════════════════════════════════════════════════ */
export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout, updateUser, token } = useAuth();
  const { showToast } = useToast();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const TAB_H  = Platform.OS === "web" ? 84 : 49;

  const [showEdit,    setShowEdit]    = useState(false);
  const [showNotifs,  setShowNotifs]  = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showAddrs,   setShowAddrs]   = useState(false);
  const [showLang,    setShowLang]    = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const [unread,      setUnread]      = useState(0);
  const [stats,       setStats]       = useState({ orders: 0, rides: 0, spent: 0 });
  const [statsLoading,setStatsLoading]= useState(true);
  const [signingOut,        setSigningOut]        = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  const { language, setLanguage, loading: langLoading } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  const { config: platformConfig } = usePlatformConfig();
  const platformCfg = {
    tncUrl:          platformConfig.content.tncUrl,
    privacyUrl:      platformConfig.content.privacyUrl,
    refundPolicyUrl: platformConfig.content.refundPolicyUrl,
    faqUrl:          platformConfig.content.faqUrl,
    aboutUrl:        platformConfig.content.aboutUrl,
    supportMsg:      platformConfig.content.supportMsg,
    supportPhone:    platformConfig.platform.supportPhone,
    supportEmail:    platformConfig.platform.supportEmail,
    supportHours:    platformConfig.platform.supportHours,
    appName:         platformConfig.platform.appName,
    appTagline:      platformConfig.platform.appTagline,
    appVersion:      platformConfig.platform.appVersion,
    businessAddress: platformConfig.platform.businessAddress,
    socialFacebook:  platformConfig.platform.socialFacebook,
    socialInstagram: platformConfig.platform.socialInstagram,
    chat:            platformConfig.features.chat,
  };

  const fetchAll = useCallback(async () => {
    if (!user?.id) return;
    const hdrs = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const [oR, rR, nR] = await Promise.all([
        fetch(`${API}/orders`,        { headers: hdrs }),
        fetch(`${API}/rides`,         { headers: hdrs }),
        fetch(`${API}/notifications`, { headers: hdrs }),
      ]);
      const [oD, rD, nD] = await Promise.all([oR.json(), rR.json(), nR.json()]);
      const orders = oD.orders || [];
      const rides  = rD.rides  || [];
      const spent  = orders.reduce((s: number, o: any) => s + (parseFloat(o.total) || 0), 0)
                   + rides.reduce((s: number,  r: any) => s + (parseFloat(r.fare)  || 0), 0);
      setStats({ orders: orders.length, rides: rides.length, spent: Math.round(spent) });
      setUnread(nD.unreadCount || 0);
    } catch { /* ignore */ }
    setStatsLoading(false);
  }, [user?.id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true); setStatsLoading(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  const doSignOut = async () => {
    setSigningOut(true);
    setShowSignOutConfirm(false);
    try {
      await logout();
      /* AuthGuard in _layout.tsx detects user=null and navigates to /auth */
    } catch {
      setSigningOut(false);
    }
  };

  const roleMap: Record<string, { label: string; colors: [string, string] }> = {
    customer: { label: "Customer",        colors: ["#1A56DB", "#3B82F6"] },
    rider:    { label: "Delivery Rider",  colors: ["#059669", "#10B981"] },
    vendor:   { label: "Store Vendor",    colors: ["#D97706", "#F59E0B"] },
  };
  const role = roleMap[user?.role || "customer"] || roleMap.customer!;
  const initials = user?.name
    ? user.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()
    : user?.phone?.slice(-2) || "U";

  /* ── Render Helpers ── */
  const SectionCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <View style={sc.wrap}>
      <Text style={sc.title}>{title}</Text>
      <View style={sc.card}>{children}</View>
    </View>
  );

  const Row = ({ icon, label, sub, onPress, iconColor = C.primary, iconBg = C.rideLight, right, danger, badge }: {
    icon: keyof typeof Ionicons.glyphMap; label: string; sub?: string; onPress: () => void;
    iconColor?: string; iconBg?: string; right?: React.ReactNode; danger?: boolean; badge?: number;
  }) => (
    <Pressable onPress={onPress} style={({ pressed }) => [sc.row, pressed && { opacity: 0.65 }]}>
      <View style={[sc.rIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[sc.rLabel, danger && { color: C.danger }]}>{label}</Text>
        {sub ? <Text style={sc.rSub}>{sub}</Text> : null}
      </View>
      {badge && badge > 0 ? <View style={sc.badge}><Text style={sc.badgeTxt}>{badge > 99 ? "99+" : badge}</Text></View> : null}
      {right ?? <Ionicons name="chevron-forward" size={15} color={C.textMuted} />}
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      >
        {/* ── Profile Header ── */}
        <LinearGradient colors={role.colors} start={{ x:0,y:0 }} end={{ x:1,y:1 }} style={[ph.card, { paddingTop: topPad + 16 }]}>
          <View style={[ph.blob, { width:180, height:180, top:-50, right:-40 }]} />
          <View style={[ph.blob, { width:80,  height:80,  bottom:-15, left:16 }]} />

          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View style={ph.avatar}>
              <Text style={ph.avatarTxt}>{initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={ph.name}>{user?.name || "AJKMart User"}</Text>
              <Text style={ph.phone}>+92 {user?.phone || "—"}</Text>
              {user?.email ? <Text style={ph.email}>{user.email}</Text> : null}
              <View style={ph.roleBadge}>
                <Text style={ph.roleTxt}>{role.label}</Text>
              </View>
            </View>
            <Pressable onPress={() => setShowEdit(true)} style={ph.editBtn}>
              <Ionicons name="pencil" size={16} color="#fff" />
            </Pressable>
          </View>

          {/* Stats strip */}
          <View style={ph.statsStrip}>
            {statsLoading ? (
              <ActivityIndicator color="rgba(255,255,255,0.8)" />
            ) : (
              <>
                <View style={ph.stat}>
                  <Text style={ph.statVal}>{stats.orders}</Text>
                  <Text style={ph.statLbl}>{T("orders")}</Text>
                </View>
                <View style={ph.statDiv} />
                <View style={ph.stat}>
                  <Text style={ph.statVal}>{stats.rides}</Text>
                  <Text style={ph.statLbl}>{T("rides")}</Text>
                </View>
                <View style={ph.statDiv} />
                <View style={ph.stat}>
                  <Text style={ph.statVal}>Rs.{stats.spent.toLocaleString()}</Text>
                  <Text style={ph.statLbl}>{T("spentLabel")}</Text>
                </View>
              </>
            )}
          </View>
        </LinearGradient>

        {/* ── Wallet Banner ── */}
        <Pressable onPress={() => router.push("/(tabs)/wallet")} style={wb.wrap}>
          <LinearGradient colors={["#1A56DB","#2563EB"]} style={wb.grad}>
            <Ionicons name="wallet" size={18} color="#fff" />
          </LinearGradient>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={wb.lbl}>{platformCfg.appName} {T("wallet")}</Text>
            <Text style={wb.amt}>Rs. {(user?.walletBalance || 0).toLocaleString()}</Text>
          </View>
          <View style={wb.btn}>
            <Text style={wb.btnTxt}>{T("manageLabel")}</Text>
            <Ionicons name="arrow-forward" size={13} color={C.primary} />
          </View>
        </Pressable>

        {/* ── Referral Program Card ── */}
        {platformConfig.features.referral && platformConfig.customer.referralEnabled && (
          <View style={rc.wrap}>
            <View style={rc.left}>
              <View style={rc.iconBox}>
                <Ionicons name="gift-outline" size={22} color="#7C3AED" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={rc.title}>{T("referAndEarn")}</Text>
                <Text style={rc.sub}>Invite a friend — both of you get Rs. {platformConfig.customer.referralBonus.toLocaleString()}</Text>
                <View style={rc.codeRow}>
                  <Text style={rc.codeLabel}>Your Code:</Text>
                  <View style={rc.codePill}>
                    <Text style={rc.code}>{user?.id?.slice(-8).toUpperCase() ?? "AJKXXXX"}</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ── Loyalty Points Card ── */}
        {platformConfig.customer.loyaltyEnabled && (
          <View style={[rc.wrap, { borderColor: "#F59E0B22", backgroundColor: "#FFFBEB" }]}>
            <View style={rc.left}>
              <View style={[rc.iconBox, { backgroundColor: "#FEF3C7" }]}>
                <Ionicons name="star-outline" size={22} color="#D97706" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={rc.title}>{T("loyaltyPointsLabel")}</Text>
                <Text style={rc.sub}>Earn {platformConfig.customer.loyaltyPtsPerRs100} points for every Rs. 100 spent</Text>
                <View style={rc.codeRow}>
                  <Text style={rc.codeLabel}>You can earn:</Text>
                  <View style={[rc.codePill, { backgroundColor: "#FDE68A" }]}>
                    <Text style={[rc.code, { color: "#92400E" }]}>{platformConfig.customer.loyaltyPtsPerRs100} pts / Rs.100</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ── Account ── */}
        <SectionCard title={T("account")}>
          <Row icon="person-outline"          label={T("editProfile")}       sub={T("editProfileSub")}            onPress={() => setShowEdit(true)} />
          <Row icon="notifications-outline"   label={T("notifications")}      sub={unread > 0 ? `${unread} ${T("notificationsSub")}` : T("noNewNotifs")} badge={unread} onPress={() => setShowNotifs(true)} iconColor={C.food} iconBg={C.foodLight} />
          <Row icon="shield-checkmark-outline" label={T("privacySecurity")} sub="Toggles, biometric, location"       onPress={() => setShowPrivacy(true)} iconColor="#059669" iconBg="#D1FAE5"
            right={<View style={{ flexDirection:"row", alignItems:"center", gap:4 }}><View style={sc.secureBadge}><Text style={sc.secureTxt}>Secure</Text></View><Ionicons name="chevron-forward" size={15} color={C.textMuted} /></View>}
          />
          <Row icon="language-outline" label="Language / زبان" sub={LANGUAGE_OPTIONS.find(o => o.value === language)?.label || "Select Language"} onPress={() => setShowLang(true)} iconColor="#7C3AED" iconBg="#F5F3FF" />
        </SectionCard>

        {/* ── Activity ── */}
        <SectionCard title={T("myActivity")}>
          <Row icon="bag-outline"      label={T("myOrders")}        sub={`${stats.orders} ${T("ordersCount")}`}       onPress={() => router.push("/(tabs)/orders")}  iconColor={C.primary} iconBg={C.rideLight} />
          <Row icon="bicycle-outline"  label={T("rides")}         sub={`${stats.rides} ${T("ridesCount")}`}          onPress={() => router.push("/ride")}            iconColor="#8B5CF6"   iconBg="#EDE9FE" />
          <Row icon="medkit-outline"   label={T("pharmacy")}         sub={T("medicineOrderHistory")}               onPress={() => router.push("/pharmacy")}        iconColor="#7C3AED"   iconBg="#F5F3FF" />
          <Row icon="cube-outline"     label={T("parcelBookings")}  sub={T("courierHistory")}             onPress={() => router.push("/parcel")}          iconColor="#D97706"   iconBg="#FFFBEB" />
          <Row icon="location-outline" label={T("savedAddresses")}  sub={T("savedAddressesSub")}    onPress={() => setShowAddrs(true)}              iconColor={C.mart}    iconBg={C.martLight} />
        </SectionCard>

        {/* ── Vendor / Rider dashboard ── */}
        {user?.role === "vendor" && (
          <SectionCard title="VENDOR DASHBOARD">
            <Row icon="storefront-outline" label="My Products"     sub="Manage products"       onPress={() => showToast("Product management coming soon!", "info")} iconColor={C.mart} iconBg={C.martLight} />
            <Row icon="analytics-outline"  label="Sales Analytics" sub="Revenue & sales"     onPress={() => showToast("Analytics coming soon!", "info")}           iconColor={C.primary} iconBg={C.rideLight} />
            <Row icon="receipt-outline"    label="Incoming Orders" sub="View new orders"     onPress={() => showToast("Order management coming soon!", "info")}    iconColor={C.food} iconBg={C.foodLight} />
          </SectionCard>
        )}
        {user?.role === "rider" && (
          <SectionCard title="RIDER DASHBOARD">
            <Row icon="bicycle-outline" label="Active Deliveries" sub="Current deliveries"    onPress={() => showToast("Active deliveries feature coming soon!", "info")}     iconColor={C.success} iconBg="#D1FAE5" />
            <Row icon="cash-outline"    label="My Earnings"       sub="Daily/monthly earnings" onPress={() => showToast("Earnings tracking coming soon!", "info")}      iconColor={C.food}    iconBg={C.foodLight} />
            <Row icon="star-outline"    label="My Rating"         sub="4.9 ⭐ • 250+ trips"   onPress={() => showToast("Rating: ⭐⭐⭐⭐⭐ 4.9/5.0 • 250+ trips completed", "success")} iconColor="#F59E0B" iconBg="#FEF3C7" />
          </SectionCard>
        )}

        {/* ── Support ── */}
        <SectionCard title={T("helpSupport")}>
          <Row icon="call-outline"
               label={T("contactSupport")}
               sub={platformCfg.supportHours || `Call: ${platformCfg.supportPhone}`}
               onPress={() => Linking.openURL(`tel:${platformCfg.supportPhone}`).catch(() => showToast(`📞 ${platformCfg.supportPhone}`, "info"))}
               iconColor="#64748B" iconBg="#F1F5F9" />
          {platformCfg.supportEmail ? (
            <Row icon="mail-outline"
                 label={T("emailSupport")}
                 sub={platformCfg.supportEmail}
                 onPress={() => Linking.openURL(`mailto:${platformCfg.supportEmail}`).catch(() => showToast(platformCfg.supportEmail, "info"))}
                 iconColor="#6366F1" iconBg="#EEF2FF" />
          ) : null}
          {platformCfg.chat && (
            <Row icon="logo-whatsapp"
                 label={T("liveChatLabel")}
                 sub={platformCfg.supportMsg}
                 onPress={() => Linking.openURL(`https://wa.me/${platformCfg.supportPhone.replace(/^0/, "92")}`).catch(() => showToast(`📞 ${platformCfg.supportPhone}`, "info"))}
                 iconColor="#25D366" iconBg="#DCFCE7" />
          )}
          {(platformCfg.socialFacebook || platformCfg.socialInstagram) && (
            <Row icon="share-social-outline"
                 label={T("followUsLabel")}
                 sub={[platformCfg.socialFacebook && "Facebook", platformCfg.socialInstagram && "Instagram"].filter(Boolean).join(" • ")}
                 onPress={() => Linking.openURL(platformCfg.socialFacebook || platformCfg.socialInstagram).catch(() => {})}
                 iconColor="#1877F2" iconBg="#EFF6FF" />
          )}
          {platformCfg.tncUrl ? (
            <Row icon="document-text-outline"
                 label={T("termsOfService")}
                 sub={T("termsSubLabel")}
                 onPress={() => Linking.openURL(platformCfg.tncUrl).catch(() => {})}
                 iconColor="#64748B" iconBg="#F1F5F9" />
          ) : (
            <Row icon="document-text-outline"
                 label={T("termsOfService")}
                 sub={T("termsSubLabel")}
                 onPress={() => showToast(`By using ${platformCfg.appName}, you agree to our terms.`, "info")}
                 iconColor="#64748B" iconBg="#F1F5F9" />
          )}
          {platformCfg.privacyUrl && (
            <Row icon="shield-checkmark-outline"
                 label={T("privacyPolicy")}
                 sub={T("privacySubLabel")}
                 onPress={() => Linking.openURL(platformCfg.privacyUrl).catch(() => {})}
                 iconColor="#0891B2" iconBg="#E0F2FE" />
          )}
          {platformCfg.refundPolicyUrl && (
            <Row icon="return-down-back-outline"
                 label={T("refundPolicy")}
                 sub={T("refundSubLabel")}
                 onPress={() => Linking.openURL(platformCfg.refundPolicyUrl).catch(() => {})}
                 iconColor="#059669" iconBg="#ECFDF5" />
          )}
          {platformCfg.faqUrl && (
            <Row icon="help-circle-outline"
                 label={T("helpFaqsLabel")}
                 sub={T("faqSubLabel")}
                 onPress={() => Linking.openURL(platformCfg.faqUrl).catch(() => {})}
                 iconColor="#7C3AED" iconBg="#F5F3FF" />
          )}
          {platformCfg.aboutUrl && (
            <Row icon="information-circle-outline"
                 label={T("aboutUsLabel")}
                 sub={`${platformCfg.appName} ${T("aboutSubLabel")}`}
                 onPress={() => Linking.openURL(platformCfg.aboutUrl).catch(() => {})}
                 iconColor="#EA580C" iconBg="#FFF7ED" />
          )}
        </SectionCard>

        {/* ── App Info ── */}
        <View style={ai.wrap}>
          <View style={ai.logo}><Ionicons name="storefront" size={26} color={C.primary} /></View>
          <Text style={ai.name}>{platformCfg.appName}</Text>
          <Text style={ai.version}>v{platformCfg.appVersion} • {platformCfg.businessAddress}</Text>
        </View>

        {/* ── Sign Out ── */}
        <View style={{ paddingHorizontal: 16, paddingBottom: 40 }}>
          {showSignOutConfirm ? (
            /* Inline confirmation — no Alert.alert (doesn't work in web iframe) */
            <View style={so.confirmBox}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="log-out-outline" size={18} color={C.danger} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={so.confirmTitle}>{T("signOutConfirm")}</Text>
                  <Text style={so.confirmSub}>{T("signOutMsg")}</Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable
                  onPress={() => setShowSignOutConfirm(false)}
                  style={so.confirmCancel}
                >
                  <Text style={so.confirmCancelTxt}>{T("cancelNo")}</Text>
                </Pressable>
                <Pressable
                  onPress={doSignOut}
                  disabled={signingOut}
                  style={[so.confirmOk, signingOut && { opacity: 0.7 }]}
                >
                  {signingOut
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={so.confirmOkTxt}>{T("signOutYes")}</Text>}
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => setShowSignOutConfirm(true)}
              style={so.btn}
            >
              <Ionicons name="log-out-outline" size={20} color={C.danger} />
              <Text style={so.txt}>{T("signOutLabel")}</Text>
            </Pressable>
          )}
        </View>

        <View style={{ height: TAB_H + insets.bottom + 20 }} />
      </ScrollView>

      {/* ── Modals ── */}
      <EditProfileModal visible={showEdit} onClose={() => setShowEdit(false)} />
      <NotificationsModal visible={showNotifs} userId={user?.id || ""} token={token} onClose={count => { setUnread(count); setShowNotifs(false); }} />
      <PrivacyModal       visible={showPrivacy} userId={user?.id || ""} token={token} onClose={() => setShowPrivacy(false)} />
      <AddressesModal     visible={showAddrs}  userId={user?.id || ""} token={token} onClose={() => setShowAddrs(false)} />

      {/* ── Language Picker Modal ── */}
      <Modal visible={showLang} transparent animationType="slide" onRequestClose={() => setShowLang(false)}>
        <Pressable style={lm.overlay} onPress={() => setShowLang(false)}>
          <Pressable style={lm.sheet} onPress={e => e.stopPropagation()}>
            <View style={lm.handle} />
            <Text style={lm.title}>Language / زبان</Text>
            <Text style={lm.sub}>{T("selectLanguageSub")}</Text>
            <View style={{ gap: 8, marginTop: 8 }}>
              {LANGUAGE_OPTIONS.map(opt => {
                const active = language === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={async () => {
                      await setLanguage(opt.value as Language);
                      setShowLang(false);
                      showToast("Language saved!", "success");
                    }}
                    disabled={langLoading}
                    style={[lm.option, active && lm.optionActive]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[lm.optLabel, active && lm.optLabelActive]}>{opt.label}</Text>
                      <Text style={[lm.optNative, active && { color: C.primary }]}>{opt.nativeLabel}</Text>
                    </View>
                    {active && <Ionicons name="checkmark-circle" size={22} color={C.primary} />}
                    {opt.rtl && (
                      <View style={lm.rtlBadge}><Text style={lm.rtlBadgeTxt}>RTL</Text></View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/* ══════════════════════════════════════ STYLES ══════════════════════════════════════ */

/* Profile Header */
const ph = StyleSheet.create({
  card: { paddingHorizontal: 16, paddingBottom: 0, overflow: "hidden" },
  blob: { position: "absolute", borderRadius: 999, backgroundColor: "rgba(255,255,255,0.1)" },
  avatar: { width: 68, height: 68, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "rgba(255,255,255,0.4)" },
  avatarTxt: { fontFamily: "Inter_700Bold", fontSize: 26, color: "#fff" },
  name: { fontFamily: "Inter_700Bold", fontSize: 18, color: "#fff", marginBottom: 2 },
  phone: { fontFamily: "Inter_500Medium", fontSize: 13, color: "rgba(255,255,255,0.85)" },
  email: { fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 1 },
  roleBadge: { backgroundColor: "rgba(255,255,255,0.22)", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, alignSelf: "flex-start", marginTop: 6 },
  roleTxt: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: "#fff" },
  editBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  statsStrip: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(0,0,0,0.15)", borderRadius: 14, marginTop: 14, marginBottom: 16, padding: 12 },
  stat: { flex: 1, alignItems: "center" },
  statVal: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" },
  statLbl: { fontFamily: "Inter_400Regular", fontSize: 10, color: "rgba(255,255,255,0.75)", marginTop: 2 },
  statDiv: { width: 1, height: 28, backgroundColor: "rgba(255,255,255,0.25)" },
});

/* Wallet Banner */
const wb = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", marginHorizontal: 16, marginTop: 14, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#DBEAFE" },
  grad: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  lbl: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginBottom: 2 },
  amt: { fontFamily: "Inter_700Bold", fontSize: 18, color: C.text },
  btn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.rideLight, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
  btnTxt: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: C.primary },
});

/* Referral / Loyalty Cards */
const rc = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", backgroundColor: "#FAF5FF", marginHorizontal: 16, marginTop: 12, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#E9D5FF" },
  left: { flexDirection: "row", alignItems: "flex-start", gap: 12, flex: 1 },
  iconBox: { width: 44, height: 44, borderRadius: 13, backgroundColor: "#F3E8FF", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  title: { fontFamily: "Inter_700Bold", fontSize: 14, color: C.text, marginBottom: 3 },
  sub: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary, lineHeight: 17, marginBottom: 8 },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  codeLabel: { fontFamily: "Inter_500Medium", fontSize: 11, color: C.textMuted },
  codePill: { backgroundColor: "#E9D5FF", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  code: { fontFamily: "Inter_700Bold", fontSize: 12, color: "#6D28D9", letterSpacing: 1 },
});

/* Section Card */
const sc = StyleSheet.create({
  wrap: { paddingHorizontal: 16, marginTop: 20 },
  title: { fontFamily: "Inter_700Bold", fontSize: 10, color: C.textMuted, letterSpacing: 1, marginBottom: 6 },
  card: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  rIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rLabel: { fontFamily: "Inter_500Medium", fontSize: 14, color: C.text },
  rSub: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginTop: 1 },
  badge: { backgroundColor: "#EF4444", borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5, marginRight: 4 },
  badgeTxt: { fontFamily: "Inter_700Bold", fontSize: 10, color: "#fff" },
  secureBadge: { backgroundColor: "#D1FAE5", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 20 },
  secureTxt: { fontFamily: "Inter_600SemiBold", fontSize: 10, color: "#059669" },
});

/* App Info */
const ai = StyleSheet.create({
  wrap: { alignItems: "center", marginTop: 28, marginBottom: 16, gap: 6 },
  logo: { width: 56, height: 56, borderRadius: 16, backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center" },
  name: { fontFamily: "Inter_700Bold", fontSize: 16, color: C.text },
  version: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted },
});

/* Sign Out */
const so = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 15, backgroundColor: "#FEE2E2", borderRadius: 16 },
  txt: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: C.danger },
  confirmBox: { backgroundColor: "#fff", borderRadius: 16, padding: 16, borderWidth: 1.5, borderColor: "#FEE2E2" },
  confirmTitle: { fontFamily: "Inter_700Bold", fontSize: 15, color: C.text },
  confirmSub: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, marginTop: 2 },
  confirmCancel: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  confirmCancelTxt: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.textSecondary },
  confirmOk: { flex: 2, backgroundColor: C.danger, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  confirmOkTxt: { fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" },
});

/* Edit Profile Sheet */
const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 22, paddingBottom: Platform.OS === "web" ? 40 : 48, paddingTop: 12 },
  sheetHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: "center", marginBottom: 20 },
  sheetTitle: { fontFamily: "Inter_700Bold", fontSize: 22, color: C.text, marginBottom: 4 },
  sheetSub: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, marginBottom: 20 },
  fldLabel: { fontFamily: "Inter_500Medium", fontSize: 12, color: C.textSecondary, marginBottom: 7 },
  fldWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: C.border, borderRadius: 12, marginBottom: 6, overflow: "hidden" },
  fldPre: { paddingHorizontal: 12, paddingVertical: 13, backgroundColor: "#F1F5F9", borderRightWidth: 1, borderRightColor: C.border, alignItems: "center", justifyContent: "center" },
  fldPreTxt: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text },
  fldTxt: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 14, color: C.text, paddingHorizontal: 12 },
  fldInput: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 15, color: C.text, paddingHorizontal: 12, paddingVertical: 13 },
  fldLock: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12 },
  fldLockTxt: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted },
  fldHint: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginBottom: 4, paddingLeft: 2 },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 13, paddingVertical: 14, alignItems: "center" },
  cancelTxt: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.textSecondary },
  saveBtn: { flex: 2, backgroundColor: C.primary, borderRadius: 13, paddingVertical: 14, alignItems: "center" },
  saveTxt: { fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FEF2F2", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 8, borderWidth: 1, borderColor: "#FECACA" },
  errorTxt: { fontFamily: "Inter_500Medium", fontSize: 13, color: "#DC2626", flex: 1 },
});

/* Notifications */
const nm = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.text },
  sub: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, marginTop: 2 },
  markAllBtn: { backgroundColor: C.rideLight, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  markAllTxt: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: C.primary },
  closeBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 16, color: C.text },
  emptySub: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted },
  item: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  itemUnread: { backgroundColor: "#F8FAFF" },
  iIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", position: "relative", flexShrink: 0 },
  dot: { position: "absolute", top: -1, right: -1, width: 10, height: 10, borderRadius: 5, backgroundColor: C.danger, borderWidth: 2, borderColor: "#fff" },
  iTitle: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text, marginBottom: 2 },
  iBody: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary, lineHeight: 17 },
  iTime: { fontFamily: "Inter_400Regular", fontSize: 10, color: C.textMuted, marginTop: 4 },
  del: { width: 26, height: 26, borderRadius: 8, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center", flexShrink: 0 },
});

/* Privacy */
const pv = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.text },
  closeBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  secTitle: { fontFamily: "Inter_700Bold", fontSize: 13, color: C.text, marginBottom: 8 },
  card: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  rIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rLabel: { fontFamily: "Inter_500Medium", fontSize: 14, color: C.text },
  rSub: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginTop: 1 },
});

/* Addresses */
const ad = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.text },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: C.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  addBtnTxt: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#fff" },
  closeBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  addPanel: { borderBottomWidth: 1, borderBottomColor: C.border, padding: 16, backgroundColor: "#FAFAFA" },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff" },
  chipTxt: { fontFamily: "Inter_500Medium", fontSize: 12, color: C.textMuted },
  fld: { borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, backgroundColor: "#fff" },
  fldTxt: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.text },
  cityChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff" },
  cityTxt: { fontFamily: "Inter_500Medium", fontSize: 12, color: C.textMuted },
  saveBtn: { backgroundColor: C.primary, borderRadius: 13, paddingVertical: 13, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 },
  saveBtnTxt: { fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 32 },
  emptyTitle: { fontFamily: "Inter_700Bold", fontSize: 17, color: C.text },
  emptySub: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, textAlign: "center" },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.primary, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14, marginTop: 8 },
  emptyBtnTxt: { fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" },
  item: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border },
  iIcon: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  iLabel: { fontFamily: "Inter_700Bold", fontSize: 14, color: C.text },
  iAddr: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary, marginTop: 2 },
  iCity: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginTop: 1 },
  defBadge: { backgroundColor: "#D1FAE5", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  defTxt: { fontFamily: "Inter_600SemiBold", fontSize: 10, color: "#059669" },
  delBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" },
});

/* Language Modal */
const lm = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12 },
  handle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: "center", marginBottom: 20 },
  title: { fontFamily: "Inter_700Bold", fontSize: 22, color: C.text, marginBottom: 4 },
  sub: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, marginBottom: 8 },
  option: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff" },
  optionActive: { borderColor: C.primary, backgroundColor: C.rideLight },
  optLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.text },
  optLabelActive: { color: C.primary },
  optNative: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, marginTop: 2 },
  rtlBadge: { backgroundColor: "#FEF3C7", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 20 },
  rtlBadgeTxt: { fontFamily: "Inter_600SemiBold", fontSize: 10, color: "#D97706" },
});
