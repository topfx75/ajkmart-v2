import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

const C   = Colors.light;
const API = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

/* ─── Helpers ─── */
function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "Abhi abhi";
  if (m < 60) return `${m} minute pehle`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ghante pehle`;
  const d = Math.floor(h / 24);
  return `${d} din pehle`;
}

/* ─── MenuItem ─── */
function MenuItem({ icon, label, sub, onPress, iconColor = C.primary, iconBg = C.rideLight, value, danger, badge }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; sub?: string; onPress: () => void;
  iconColor?: string; iconBg?: string; value?: string; danger?: boolean; badge?: number;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [ps.menuItem, pressed && { opacity: 0.7 }]}>
      <View style={[ps.menuIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={19} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[ps.menuLabel, danger && { color: C.danger }]}>{label}</Text>
        {sub ? <Text style={ps.menuSub}>{sub}</Text> : null}
      </View>
      {value ? <Text style={ps.menuValue}>{value}</Text> : null}
      {badge && badge > 0 ? (
        <View style={ps.badge}><Text style={ps.badgeTxt}>{badge > 99 ? "99+" : badge}</Text></View>
      ) : null}
      {!danger && <Ionicons name="chevron-forward" size={16} color={C.textMuted} />}
    </Pressable>
  );
}

/* ══════════════════════════════════════════════
   NOTIFICATIONS MODAL
══════════════════════════════════════════════ */
function NotificationsModal({ visible, userId, onClose }: { visible: boolean; userId: string; onClose: (unread: number) => void }) {
  const [notifs,   setNotifs]   = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [marking,  setMarking]  = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/notifications?userId=${userId}`);
      const d = await res.json();
      setNotifs(d.notifications || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [userId]);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  const markRead = async (id: string) => {
    await fetch(`${API}/notifications/${id}/read`, { method: "PATCH" });
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  };

  const markAll = async () => {
    setMarking(true);
    await fetch(`${API}/notifications/read-all`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
    setNotifs(prev => prev.map(n => ({ ...n, isRead: true })));
    setMarking(false);
  };

  const deleteNotif = async (id: string) => {
    await fetch(`${API}/notifications/${id}`, { method: "DELETE" });
    setNotifs(prev => prev.filter(n => n.id !== id));
  };

  const unread = notifs.filter(n => !n.isRead).length;

  const iconMap: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string; bg: string }> = {
    wallet: { icon: "wallet-outline",        color: C.primary,  bg: "#DBEAFE" },
    ride:   { icon: "car-outline",           color: "#059669",  bg: "#D1FAE5" },
    order:  { icon: "bag-outline",           color: "#D97706",  bg: "#FEF3C7" },
    deal:   { icon: "pricetag-outline",      color: "#7C3AED",  bg: "#EDE9FE" },
    system: { icon: "notifications-outline", color: "#64748B",  bg: "#F1F5F9" },
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => onClose(unread)}>
      <View style={nm.root}>
        {/* Header */}
        <View style={nm.header}>
          <View>
            <Text style={nm.title}>Notifications</Text>
            {unread > 0 && <Text style={nm.unreadSub}>{unread} naye notifications</Text>}
          </View>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            {unread > 0 && (
              <Pressable onPress={markAll} disabled={marking} style={nm.markAllBtn}>
                {marking ? <ActivityIndicator size="small" color={C.primary} /> : <Text style={nm.markAllTxt}>Sab read karein</Text>}
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
            <Text style={nm.emptyTitle}>Koi notification nahi</Text>
            <Text style={nm.emptySub}>Aap sab kuch updated hain!</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8 }}>
            {notifs.map(n => {
              const meta = iconMap[n.type] || iconMap.system!;
              return (
                <Pressable
                  key={n.id}
                  onPress={() => !n.isRead && markRead(n.id)}
                  style={[nm.item, !n.isRead && nm.itemUnread]}
                >
                  <View style={[nm.itemIcon, { backgroundColor: meta.bg }]}>
                    <Ionicons name={meta.icon} size={20} color={meta.color} />
                    {!n.isRead && <View style={nm.unreadDot} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[nm.itemTitle, !n.isRead && { fontFamily: "Inter_700Bold" }]}>{n.title}</Text>
                    <Text style={nm.itemBody} numberOfLines={2}>{n.body}</Text>
                    <Text style={nm.itemTime}>{relativeTime(n.createdAt)}</Text>
                  </View>
                  <Pressable onPress={() => deleteNotif(n.id)} style={nm.deleteBtn}>
                    <Ionicons name="close" size={14} color={C.textMuted} />
                  </Pressable>
                </Pressable>
              );
            })}
            <View style={{ height: 30 }} />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

/* ══════════════════════════════════════════════
   PRIVACY & SECURITY MODAL
══════════════════════════════════════════════ */
function PrivacyModal({ visible, userId, onClose }: { visible: boolean; userId: string; onClose: () => void }) {
  const [settings, setSettings] = useState<Record<string, boolean>>({
    notifOrders: true, notifWallet: true, notifDeals: true, notifRides: true,
    locationSharing: true, biometric: false, twoFactor: false, darkMode: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    fetch(`${API}/settings?userId=${userId}`)
      .then(r => r.json())
      .then(d => setSettings({
        notifOrders: d.notifOrders, notifWallet: d.notifWallet,
        notifDeals: d.notifDeals, notifRides: d.notifRides,
        locationSharing: d.locationSharing, biometric: d.biometric,
        twoFactor: d.twoFactor, darkMode: d.darkMode,
      }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [visible, userId]);

  const toggle = async (key: string, val: boolean) => {
    setSaving(key);
    const newSettings = { ...settings, [key]: val };
    setSettings(newSettings);
    try {
      await fetch(`${API}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...newSettings }),
      });
    } catch { setSettings(settings); }
    setSaving(null);
  };

  const Row = ({ label, sub, k, icon, iconColor = C.primary, iconBg = C.rideLight }: {
    label: string; sub: string; k: string; icon: keyof typeof Ionicons.glyphMap; iconColor?: string; iconBg?: string;
  }) => (
    <View style={prv.row}>
      <View style={[prv.rowIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={prv.rowLabel}>{label}</Text>
        <Text style={prv.rowSub}>{sub}</Text>
      </View>
      {saving === k ? (
        <ActivityIndicator size="small" color={C.primary} />
      ) : (
        <Switch
          value={settings[k] ?? false}
          onValueChange={v => toggle(k, v)}
          trackColor={{ false: C.border, true: C.primary }}
          thumbColor="#fff"
        />
      )}
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={prv.root}>
        <View style={prv.header}>
          <Text style={prv.title}>Privacy & Security</Text>
          <Pressable onPress={onClose} style={prv.closeBtn}>
            <Ionicons name="close" size={20} color={C.text} />
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
            {/* Notifications Section */}
            <View style={prv.section}>
              <Text style={prv.sectionTitle}>Notifications</Text>
              <View style={prv.card}>
                <Row k="notifOrders"  label="Order Updates"    sub="Apne orders ki status janein"     icon="bag-outline"           iconColor={C.primary}  iconBg={C.rideLight} />
                <Row k="notifWallet"  label="Wallet Activity"  sub="Payments aur top-up alerts"       icon="wallet-outline"        iconColor="#7C3AED"    iconBg="#EDE9FE" />
                <Row k="notifDeals"   label="Deals & Offers"   sub="Naye deals aur discounts"         icon="pricetag-outline"      iconColor="#D97706"    iconBg="#FEF3C7" />
                <Row k="notifRides"   label="Ride Updates"     sub="Driver assignment aur ETA"        icon="car-outline"           iconColor="#059669"    iconBg="#D1FAE5" />
              </View>
            </View>

            {/* Privacy Section */}
            <View style={prv.section}>
              <Text style={prv.sectionTitle}>Privacy</Text>
              <View style={prv.card}>
                <Row k="locationSharing"  label="Location Sharing"    sub="Driver aur delivery ke liye"     icon="location-outline"      iconColor="#059669" iconBg="#D1FAE5" />
                <Row k="darkMode"         label="Dark Mode"           sub="App appearance"                  icon="moon-outline"          iconColor="#7C3AED" iconBg="#EDE9FE" />
              </View>
            </View>

            {/* Security Section */}
            <View style={prv.section}>
              <Text style={prv.sectionTitle}>Security</Text>
              <View style={prv.card}>
                <Row k="biometric"   label="Biometric Login"      sub="Face ID / Fingerprint se login"    icon="finger-print-outline"  iconColor={C.primary} iconBg={C.rideLight} />
                <Row k="twoFactor"   label="Two-Factor Auth"      sub="SMS OTP se extra security"         icon="shield-outline"        iconColor="#059669"   iconBg="#D1FAE5" />
              </View>
            </View>

            {/* Danger Zone */}
            <View style={prv.section}>
              <Text style={prv.sectionTitle}>Account</Text>
              <View style={prv.card}>
                <Pressable onPress={() => Alert.alert("Data Export", "Aapka data 24 ghante mein email par bheja jayega.\n\nEmail: (aapki registered email)")} style={prv.row}>
                  <View style={[prv.rowIcon, { backgroundColor: "#F1F5F9" }]}>
                    <Ionicons name="download-outline" size={18} color="#64748B" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={prv.rowLabel}>Download My Data</Text>
                    <Text style={prv.rowSub}>Aapka pura data export karein</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
                </Pressable>
                <Pressable onPress={() => Alert.alert("Deactivate Account", "Account deactivate karne se aapki profile, orders aur wallet ka access band ho jayega.\n\nConfirm karne ke liye helpline: 0300-AJKMART", [{ text: "Cancel", style: "cancel" }, { text: "Deactivate", style: "destructive", onPress: () => Alert.alert("Requested", "Aapki request 2-3 din mein process ho jayegi.") }])} style={prv.row}>
                  <View style={[prv.rowIcon, { backgroundColor: "#FEE2E2" }]}>
                    <Ionicons name="person-remove-outline" size={18} color={C.danger} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[prv.rowLabel, { color: C.danger }]}>Deactivate Account</Text>
                    <Text style={prv.rowSub}>Account band karein</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
                </Pressable>
              </View>
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

/* ══════════════════════════════════════════════
   SAVED ADDRESSES MODAL
══════════════════════════════════════════════ */
const LABEL_OPTS = [
  { label: "Home",   icon: "home-outline",     color: "#059669", bg: "#D1FAE5" },
  { label: "Work",   icon: "briefcase-outline", color: C.primary, bg: C.rideLight },
  { label: "Other",  icon: "location-outline",  color: "#D97706", bg: "#FEF3C7" },
];
const AJK_CITIES = ["Muzaffarabad", "Mirpur", "Rawalakot", "Bagh", "Kotli", "Bhimber", "Poonch", "Neelum Valley"];

function AddressesModal({ visible, userId, onClose }: { visible: boolean; userId: string; onClose: () => void }) {
  const [addresses, setAddresses] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [showAdd,   setShowAdd]   = useState(false);
  const [newLabel,  setNewLabel]  = useState("Home");
  const [newAddr,   setNewAddr]   = useState("");
  const [newCity,   setNewCity]   = useState("Muzaffarabad");
  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/addresses?userId=${userId}`);
      const d = await res.json();
      setAddresses(d.addresses || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [userId]);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  const addAddress = async () => {
    if (!newAddr.trim()) { Alert.alert("Required", "Address enter karein"); return; }
    setSaving(true);
    const opt = LABEL_OPTS.find(o => o.label === newLabel)!;
    try {
      await fetch(`${API}/addresses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, label: newLabel, address: newAddr.trim(), city: newCity, icon: opt.icon, isDefault: addresses.length === 0 }),
      });
      setNewAddr(""); setNewCity("Muzaffarabad");
      setShowAdd(false);
      await load();
    } catch { Alert.alert("Error", "Address save nahi ho saka"); }
    setSaving(false);
  };

  const deleteAddress = async (id: string) => {
    Alert.alert("Delete Address", "Is address ko delete karna chahte hain?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        setDeleting(id);
        await fetch(`${API}/addresses/${id}`, { method: "DELETE" });
        setAddresses(prev => prev.filter(a => a.id !== id));
        setDeleting(null);
      }},
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={adm.root}>
        <View style={adm.header}>
          <Text style={adm.title}>Saved Addresses</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable onPress={() => setShowAdd(true)} style={adm.addBtn}>
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={adm.addBtnTxt}>Add New</Text>
            </Pressable>
            <Pressable onPress={onClose} style={adm.closeBtn}>
              <Ionicons name="close" size={20} color={C.text} />
            </Pressable>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
        ) : addresses.length === 0 && !showAdd ? (
          <View style={adm.empty}>
            <Text style={{ fontSize: 52 }}>📍</Text>
            <Text style={adm.emptyTitle}>Koi address nahi</Text>
            <Text style={adm.emptySub}>Apna ghar, office ya koi bhi address save karein</Text>
            <Pressable onPress={() => setShowAdd(true)} style={adm.emptyBtn}>
              <Ionicons name="add" size={17} color="#fff" />
              <Text style={adm.emptyBtnTxt}>Pehla Address Add Karein</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
            {addresses.map(a => {
              const opt = LABEL_OPTS.find(o => o.label === a.label) || LABEL_OPTS[2]!;
              return (
                <View key={a.id} style={adm.item}>
                  <View style={[adm.itemIcon, { backgroundColor: opt.bg }]}>
                    <Ionicons name={opt.icon as any} size={20} color={opt.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={adm.itemLabel}>{a.label}</Text>
                      {a.isDefault && <View style={adm.defaultBadge}><Text style={adm.defaultTxt}>Default</Text></View>}
                    </View>
                    <Text style={adm.itemAddr}>{a.address}</Text>
                    <Text style={adm.itemCity}>{a.city}, AJK</Text>
                  </View>
                  {deleting === a.id ? (
                    <ActivityIndicator size="small" color={C.danger} />
                  ) : (
                    <Pressable onPress={() => deleteAddress(a.id)} style={adm.deleteBtn}>
                      <Ionicons name="trash-outline" size={17} color={C.danger} />
                    </Pressable>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* Add Address Panel */}
        {showAdd && (
          <View style={adm.addPanel}>
            <Text style={adm.addTitle}>New Address</Text>

            <Text style={adm.fldLabel}>Address Type</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
              {LABEL_OPTS.map(o => (
                <Pressable key={o.label} onPress={() => setNewLabel(o.label)} style={[adm.labelChip, newLabel === o.label && { backgroundColor: o.bg, borderColor: o.color }]}>
                  <Ionicons name={o.icon as any} size={14} color={newLabel === o.label ? o.color : C.textMuted} />
                  <Text style={[adm.labelChipTxt, newLabel === o.label && { color: o.color, fontFamily: "Inter_700Bold" }]}>{o.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={adm.fldLabel}>Full Address</Text>
            <View style={adm.fldWrap}>
              <TextInput value={newAddr} onChangeText={setNewAddr} placeholder="e.g. Chowk Adalat, Near Bank" placeholderTextColor={C.textMuted} style={adm.fldInput} multiline />
            </View>

            <Text style={adm.fldLabel}>City</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {AJK_CITIES.map(c => (
                  <Pressable key={c} onPress={() => setNewCity(c)} style={[adm.cityChip, newCity === c && { backgroundColor: C.rideLight, borderColor: C.primary }]}>
                    <Text style={[adm.cityChipTxt, newCity === c && { color: C.primary }]}>{c}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable onPress={() => setShowAdd(false)} style={adm.cancelBtn}><Text style={adm.cancelTxt}>Cancel</Text></Pressable>
              <Pressable onPress={addAddress} disabled={saving} style={[adm.saveBtn, saving && { opacity: 0.7 }]}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={adm.saveTxt}>Save Address</Text>}
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

/* ══════════════════════════════════════════════
   EDIT PROFILE MODAL
══════════════════════════════════════════════ */
function EditProfileModal({ visible, onClose, currentName, currentEmail, onSaved }: {
  visible: boolean; onClose: () => void; currentName: string; currentEmail: string;
  onSaved: (name: string, email: string) => void;
}) {
  const { user } = useAuth();
  const [name,   setName]   = useState(currentName);
  const [email,  setEmail]  = useState(currentEmail);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setName(currentName); setEmail(currentEmail); }, [currentName, currentEmail]);

  const handleSave = async () => {
    if (!name.trim()) { Alert.alert("Required", "Name zaroor likhen"); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API}/users/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user!.id, name: name.trim(), email: email.trim() }),
      });
      if (!res.ok) throw new Error();
      onSaved(name.trim(), email.trim());
      onClose();
      Alert.alert("✅ Saved", "Profile update ho gaya!");
    } catch { Alert.alert("Error", "Profile update nahi ho saka. Dobara try karein."); }
    setSaving(false);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={ps.overlay} onPress={onClose}>
        <Pressable style={ps.sheet} onPress={e => e.stopPropagation()}>
          <View style={ps.handle} />
          <Text style={ps.sheetTitle}>Edit Profile</Text>

          <Text style={ps.label}>Full Name</Text>
          <View style={ps.field}>
            <Ionicons name="person-outline" size={18} color={C.textMuted} />
            <TextInput style={ps.fieldInput} value={name} onChangeText={setName} placeholder="Aapka naam" placeholderTextColor={C.textMuted} autoCapitalize="words" />
          </View>

          <Text style={ps.label}>Email Address</Text>
          <View style={ps.field}>
            <Ionicons name="mail-outline" size={18} color={C.textMuted} />
            <TextInput style={ps.fieldInput} value={email} onChangeText={setEmail} placeholder="email@example.com" placeholderTextColor={C.textMuted} keyboardType="email-address" autoCapitalize="none" />
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
            <Pressable onPress={onClose} style={ps.cancelBtn}><Text style={ps.cancelTxt}>Cancel</Text></Pressable>
            <Pressable onPress={handleSave} disabled={saving} style={[ps.saveBtn, saving && { opacity: 0.7 }]}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={ps.saveTxt}>Save Changes</Text>}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ════════════════════ MAIN PROFILE SCREEN ════════════════════ */
export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout, updateUser } = useAuth();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [showEdit,    setShowEdit]    = useState(false);
  const [showNotifs,  setShowNotifs]  = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showAddrs,   setShowAddrs]   = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [stats,       setStats]       = useState({ orders: 0, rides: 0, spent: 0 });
  const [statsLoading,setStatsLoading]= useState(true);

  const fetchStats = useCallback(async () => {
    if (!user) return;
    try {
      const [ordRes, rideRes, notifRes] = await Promise.all([
        fetch(`${API}/orders?userId=${user.id}`),
        fetch(`${API}/rides?userId=${user.id}`),
        fetch(`${API}/notifications?userId=${user.id}`),
      ]);
      const [ordData, rideData, notifData] = await Promise.all([ordRes.json(), rideRes.json(), notifRes.json()]);
      const orders = ordData.orders || [];
      const rides  = rideData.rides  || [];
      const spent  = orders.reduce((s: number, o: any) => s + (parseFloat(o.total) || 0), 0)
                   + rides.reduce((s: number,  r: any) => s + (parseFloat(r.fare)  || 0), 0);
      setStats({ orders: orders.length, rides: rides.length, spent: Math.round(spent) });
      setUnreadCount(notifData.unreadCount || 0);
    } catch { /* ignore */ }
    setStatsLoading(false);
  }, [user]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setStatsLoading(true);
    await fetchStats();
    setRefreshing(false);
  }, [fetchStats]);

  const handleLogout = () => {
    Alert.alert("Sign Out", "Bahar jaana chahte hain?", [
      { text: "Nahi", style: "cancel" },
      { text: "Haan, Sign Out", style: "destructive", onPress: logout },
    ]);
  };

  const roleLabel:  Record<string, string>           = { customer: "Customer", rider: "Delivery Rider", vendor: "Store Vendor" };
  const roleColors: Record<string, [string, string]> = {
    customer: ["#1A56DB","#3B82F6"],
    rider:    ["#059669","#10B981"],
    vendor:   ["#D97706","#F59E0B"],
  };
  const [c1, c2] = roleColors[user?.role || "customer"] || roleColors.customer!;
  const initials = user?.name ? user.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() : user?.phone?.slice(-2) || "U";

  const joinDate = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-PK", { month: "long", year: "numeric" })
    : "March 2026";

  return (
    <View style={[ps.root, { backgroundColor: C.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      >
        {/* ── Profile Card ── */}
        <LinearGradient colors={[c1, c2]} start={{ x:0,y:0 }} end={{ x:1,y:1 }} style={[ps.profileCard, { paddingTop: topPad + 20 }]}>
          <View style={[ps.blob, { width:180, height:180, top:-50, right:-30 }]} />
          <View style={[ps.blob, { width:80,  height:80,  bottom:-20, left:20 }]} />
          <View style={ps.avatarRing}>
            <Text style={ps.avatarTxt}>{initials}</Text>
          </View>
          <Text style={ps.profileName}>{user?.name || "AJKMart User"}</Text>
          <Text style={ps.profilePhone}>{user?.phone ? `+92 ${user.phone}` : ""}</Text>
          {user?.email ? <Text style={ps.profileEmail}>{user.email}</Text> : null}
          <Text style={ps.joinDate}>Member since {joinDate}</Text>
          <View style={ps.roleBadge}>
            <Text style={ps.roleTxt}>{roleLabel[user?.role || "customer"]}</Text>
          </View>
          <Pressable onPress={() => setShowEdit(true)} style={ps.editBtn}>
            <Ionicons name="pencil-outline" size={14} color={c1} />
            <Text style={[ps.editBtnTxt, { color: c1 }]}>Edit Profile</Text>
          </Pressable>
        </LinearGradient>

        {/* ── Stats Row ── */}
        <View style={ps.statsRow}>
          {statsLoading ? (
            <ActivityIndicator color={C.primary} style={{ flex: 1, paddingVertical: 18 }} />
          ) : (
            <>
              <View style={ps.statBox}>
                <Text style={[ps.statVal, { color: C.primary }]}>{stats.orders}</Text>
                <Text style={ps.statLbl}>Orders</Text>
              </View>
              <View style={ps.statDivider} />
              <View style={ps.statBox}>
                <Text style={[ps.statVal, { color: "#059669" }]}>{stats.rides}</Text>
                <Text style={ps.statLbl}>Rides</Text>
              </View>
              <View style={ps.statDivider} />
              <View style={ps.statBox}>
                <Text style={[ps.statVal, { color: "#D97706" }]}>Rs. {stats.spent.toLocaleString()}</Text>
                <Text style={ps.statLbl}>Total Spent</Text>
              </View>
            </>
          )}
        </View>

        {/* ── Wallet Banner ── */}
        <Pressable onPress={() => router.push("/(tabs)/wallet")} style={ps.walletBanner}>
          <View style={ps.walletL}>
            <LinearGradient colors={["#1A56DB","#2563EB"]} style={ps.walletGrad}>
              <Ionicons name="wallet" size={20} color="#fff" />
            </LinearGradient>
            <View>
              <Text style={ps.walletLbl}>AJKMart Wallet</Text>
              <Text style={ps.walletAmt}>Rs. {(user?.walletBalance || 0).toLocaleString()}</Text>
            </View>
          </View>
          <View style={ps.manageBtn}>
            <Text style={ps.manageTxt}>Manage</Text>
            <Ionicons name="arrow-forward" size={14} color={C.primary} />
          </View>
        </Pressable>

        {/* ── Account ── */}
        <View style={ps.section}>
          <Text style={ps.sectionTitle}>Account</Text>
          <MenuItem icon="person-outline"   label="Edit Profile"    sub="Naam, email update karein"            onPress={() => setShowEdit(true)} />
          <MenuItem icon="call-outline"     label="Phone Number"    sub={user?.phone ? `+92 ${user.phone}` : "—"} onPress={() => Alert.alert("Phone Change", "Phone number change karne ke liye:\n\n📞 Call: 0300-AJKMART\n📧 Email: support@ajkmart.pk\n\nVerification ke baad 24 ghante mein update ho jata hai.")} iconColor="#7C3AED" iconBg="#EDE9FE" />
          <MenuItem icon="notifications-outline" label="Notifications" sub={unreadCount > 0 ? `${unreadCount} naye notifications` : "Sab read ho gaye"} badge={unreadCount} onPress={() => setShowNotifs(true)} iconColor={C.food} iconBg={C.foodLight} />
          <MenuItem icon="shield-outline"   label="Privacy & Security" sub="Notifications, location, biometric" onPress={() => setShowPrivacy(true)} iconColor="#059669" iconBg="#D1FAE5" />
        </View>

        {/* ── My Activity ── */}
        <View style={ps.section}>
          <Text style={ps.sectionTitle}>My Activity</Text>
          <MenuItem icon="bag-outline"       label="My Orders"         sub={`${stats.orders} total orders`}       onPress={() => router.push("/(tabs)/orders")}   iconColor={C.primary} iconBg={C.rideLight} />
          <MenuItem icon="bicycle-outline"   label="My Rides"          sub={`${stats.rides} total rides`}          onPress={() => router.push("/ride")}             iconColor="#8B5CF6"   iconBg="#EDE9FE" />
          <MenuItem icon="medkit-outline"    label="Pharmacy Orders"   sub="Medicine delivery history"            onPress={() => router.push("/pharmacy")}         iconColor="#7C3AED"   iconBg="#F5F3FF" />
          <MenuItem icon="cube-outline"      label="Parcel Bookings"   sub="Courier delivery history"             onPress={() => router.push("/parcel")}           iconColor="#D97706"   iconBg="#FFFBEB" />
          <MenuItem icon="wallet-outline"    label="Wallet & Payments" sub="Top up, send money, history"         onPress={() => router.push("/(tabs)/wallet")}    iconColor={C.primary} iconBg="#EFF6FF" />
          <MenuItem icon="location-outline"  label="Saved Addresses"   sub="Ghar, office aur doosre addresses"    onPress={() => setShowAddrs(true)}               iconColor={C.mart}    iconBg={C.martLight} />
        </View>

        {/* ── Vendor Dashboard ── */}
        {user?.role === "vendor" && (
          <View style={ps.section}>
            <Text style={ps.sectionTitle}>Vendor Dashboard</Text>
            <MenuItem icon="storefront-outline" label="My Products"     sub="Products manage karein"    onPress={() => Alert.alert("Vendor", "Product management coming soon!")} iconColor={C.mart} iconBg={C.martLight} />
            <MenuItem icon="analytics-outline"  label="Sales Analytics" sub="Revenue aur sales data"   onPress={() => Alert.alert("Vendor", "Analytics coming soon!")}           iconColor={C.primary} iconBg={C.rideLight} />
            <MenuItem icon="receipt-outline"    label="Incoming Orders" sub="Naye orders dekho"        onPress={() => Alert.alert("Vendor", "Order management coming soon!")}    iconColor={C.food} iconBg={C.foodLight} />
          </View>
        )}

        {/* ── Rider Dashboard ── */}
        {user?.role === "rider" && (
          <View style={ps.section}>
            <Text style={ps.sectionTitle}>Rider Dashboard</Text>
            <MenuItem icon="bicycle-outline" label="Active Deliveries" sub="Current delivery status"     onPress={() => Alert.alert("Rider", "Active deliveries coming soon!")}    iconColor={C.success} iconBg="#D1FAE5" />
            <MenuItem icon="cash-outline"    label="My Earnings"       sub="Daily aur monthly earnings"  onPress={() => Alert.alert("Rider", "Earnings tracking coming soon!")}     iconColor={C.food}    iconBg={C.foodLight} />
            <MenuItem icon="star-outline"    label="Ratings"           sub="Customer feedback"           onPress={() => Alert.alert("Rating", "⭐⭐⭐⭐⭐ 4.9/5.0\n250+ completed trips\nExcellent driver!")} iconColor="#F59E0B" iconBg="#FEF3C7" />
          </View>
        )}

        {/* ── Support ── */}
        <View style={ps.section}>
          <Text style={ps.sectionTitle}>Support</Text>
          <MenuItem icon="help-circle-outline"   label="Help & FAQ"       sub="Aam sawaal aur jawab"    onPress={() => Alert.alert("Help Center", "📞 Helpline: 0300-AJKMART\n📧 Email: help@ajkmart.pk\n⏰ Available: 8AM - 10PM daily\n\n• Order issue? Order screen se report karein\n• Payment issue? Wallet se contact karein\n• Ride issue? Ride confirm screen se report karein")} iconColor="#64748B" iconBg="#F1F5F9" />
          <MenuItem icon="chatbubble-outline"    label="Live Chat Support" sub="Online support 8AM–10PM"  onPress={() => Alert.alert("Live Chat", "Abhi chat connect karein:\n\n📞 0300-AJKMART\n📧 support@ajkmart.pk\n\nAverage response time: 5 minutes")} iconColor="#0891B2" iconBg="#E0F2FE" />
          <MenuItem icon="document-text-outline" label="Terms of Service"  sub="Terms aur conditions"     onPress={() => Alert.alert("Terms of Service", "AJKMart use karke aap agree karte hain:\n\n1. Valid Pakistani phone number required\n2. Wallet transactions are final\n3. Ride cancellation policy applies\n4. We never share your data\n\nFull terms: ajkmart.pk/terms")} iconColor="#64748B" iconBg="#F1F5F9" />
        </View>

        {/* ── App Info ── */}
        <View style={ps.appInfo}>
          <View style={ps.appLogo}>
            <Ionicons name="storefront" size={26} color={C.primary} />
          </View>
          <Text style={ps.appName}>AJKMart</Text>
          <Text style={ps.appVersion}>Version 1.0.0 • AJK, Pakistan</Text>
          <Text style={ps.appTagline}>Your Super App for everything in AJK 🇵🇰</Text>
        </View>

        {/* ── Logout ── */}
        <View style={{ paddingHorizontal: 16, marginBottom: 32 }}>
          <Pressable onPress={handleLogout} style={ps.logoutBtn}>
            <Ionicons name="log-out-outline" size={20} color={C.danger} />
            <Text style={ps.logoutTxt}>Sign Out</Text>
          </Pressable>
        </View>

        <View style={{ height: Platform.OS === "web" ? 60 : 20 }} />
      </ScrollView>

      {/* ── Modals ── */}
      <EditProfileModal
        visible={showEdit}
        onClose={() => setShowEdit(false)}
        currentName={user?.name || ""}
        currentEmail={user?.email || ""}
        onSaved={(name, email) => updateUser({ name, email })}
      />
      <NotificationsModal visible={showNotifs} userId={user?.id || ""} onClose={count => { setUnreadCount(count); setShowNotifs(false); }} />
      <PrivacyModal       visible={showPrivacy} userId={user?.id || ""} onClose={() => setShowPrivacy(false)} />
      <AddressesModal     visible={showAddrs}  userId={user?.id || ""} onClose={() => setShowAddrs(false)} />
    </View>
  );
}

/* ══════════════════════════════════════ STYLES ══════════════════════════════════════ */
const ps = StyleSheet.create({
  root: { flex: 1 },
  blob: { position: "absolute", borderRadius: 999, backgroundColor: "rgba(255,255,255,0.1)" },
  profileCard: { paddingHorizontal: 20, paddingBottom: 28, alignItems: "center", overflow: "hidden" },
  avatarRing: { width: 84, height: 84, borderRadius: 25, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center", marginBottom: 12, borderWidth: 2, borderColor: "rgba(255,255,255,0.4)" },
  avatarTxt: { fontFamily: "Inter_700Bold", fontSize: 32, color: "#fff" },
  profileName: { fontFamily: "Inter_700Bold", fontSize: 22, color: "#fff", marginBottom: 4 },
  profilePhone: { fontFamily: "Inter_400Regular", fontSize: 14, color: "rgba(255,255,255,0.85)" },
  profileEmail: { fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,255,255,0.75)", marginTop: 2 },
  joinDate: { fontFamily: "Inter_400Regular", fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 3 },
  roleBadge: { backgroundColor: "rgba(255,255,255,0.22)", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, marginTop: 10 },
  roleTxt: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#fff" },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, marginTop: 14 },
  editBtnTxt: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  statsRow: { flexDirection: "row", backgroundColor: "#fff", marginHorizontal: 16, marginTop: 14, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border },
  statBox: { flex: 1, alignItems: "center", gap: 4 },
  statVal: { fontFamily: "Inter_700Bold", fontSize: 18 },
  statLbl: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted },
  statDivider: { width: 1, height: 36, backgroundColor: C.border, alignSelf: "center" },
  walletBanner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", marginHorizontal: 16, marginTop: 12, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#DBEAFE" },
  walletL: { flexDirection: "row", alignItems: "center", gap: 12 },
  walletGrad: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  walletLbl: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, marginBottom: 2 },
  walletAmt: { fontFamily: "Inter_700Bold", fontSize: 19, color: C.text },
  manageBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: C.rideLight, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  manageTxt: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.primary },
  section: { paddingHorizontal: 16, marginTop: 20 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  menuIcon: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  menuLabel: { fontFamily: "Inter_500Medium", fontSize: 14, color: C.text },
  menuSub: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginTop: 1 },
  menuValue: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, marginRight: 4 },
  badge: { backgroundColor: "#EF4444", borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5, marginRight: 4 },
  badgeTxt: { fontFamily: "Inter_700Bold", fontSize: 10, color: "#fff" },
  appInfo: { alignItems: "center", marginTop: 28, marginBottom: 16, gap: 6 },
  appLogo: { width: 60, height: 60, borderRadius: 18, backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center" },
  appName: { fontFamily: "Inter_700Bold", fontSize: 17, color: C.text },
  appVersion: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted },
  appTagline: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.border },
  logoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 15, backgroundColor: "#FEE2E2", borderRadius: 16 },
  logoutTxt: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: C.danger },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingBottom: Platform.OS === "web" ? 40 : 48, paddingTop: 12 },
  handle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: "center", marginBottom: 20 },
  sheetTitle: { fontFamily: "Inter_700Bold", fontSize: 22, color: C.text, marginBottom: 20 },
  label: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.textSecondary, marginBottom: 8 },
  field: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, marginBottom: 16 },
  fieldInput: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 15, color: C.text, paddingVertical: 13 },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  cancelTxt: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: C.textSecondary },
  saveBtn: { flex: 2, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  saveTxt: { fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff" },
});

const nm = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.text },
  unreadSub: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, marginTop: 2 },
  markAllBtn: { backgroundColor: C.rideLight, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  markAllTxt: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: C.primary },
  closeBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 16, color: C.text },
  emptySub: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted },
  item: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  itemUnread: { backgroundColor: "#F8FAFF" },
  itemIcon: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", position: "relative" },
  unreadDot: { position: "absolute", top: 0, right: 0, width: 10, height: 10, borderRadius: 5, backgroundColor: C.danger, borderWidth: 2, borderColor: "#fff" },
  itemTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.text, marginBottom: 3 },
  itemBody: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary, lineHeight: 17 },
  itemTime: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginTop: 5 },
  deleteBtn: { width: 28, height: 28, borderRadius: 8, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center", marginTop: 6 },
});

const prv = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.text },
  closeBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  section: { marginTop: 20, paddingHorizontal: 16 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 },
  card: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  rowIcon: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  rowLabel: { fontFamily: "Inter_500Medium", fontSize: 14, color: C.text },
  rowSub: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginTop: 2 },
});

const adm = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.text },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: C.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  addBtnTxt: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#fff" },
  closeBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  emptyTitle: { fontFamily: "Inter_700Bold", fontSize: 18, color: C.text },
  emptySub: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, textAlign: "center" },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.primary, paddingHorizontal: 20, paddingVertical: 13, borderRadius: 14, marginTop: 8 },
  emptyBtnTxt: { fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" },
  item: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: C.border },
  itemIcon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  itemLabel: { fontFamily: "Inter_700Bold", fontSize: 14, color: C.text },
  itemAddr: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary, marginTop: 2 },
  itemCity: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginTop: 2 },
  defaultBadge: { backgroundColor: "#D1FAE5", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  defaultTxt: { fontFamily: "Inter_600SemiBold", fontSize: 10, color: "#059669" },
  deleteBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" },
  addPanel: { borderTopWidth: 1, borderTopColor: C.border, backgroundColor: "#fff", padding: 16 },
  addTitle: { fontFamily: "Inter_700Bold", fontSize: 17, color: C.text, marginBottom: 14 },
  fldLabel: { fontFamily: "Inter_500Medium", fontSize: 12, color: C.textSecondary, marginBottom: 7 },
  fldWrap: { borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14 },
  fldInput: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.text },
  labelChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: "#F8FAFC" },
  labelChipTxt: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.textMuted },
  cityChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: "#F8FAFC" },
  cityChipTxt: { fontFamily: "Inter_500Medium", fontSize: 12, color: C.textMuted },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingVertical: 13, alignItems: "center" },
  cancelTxt: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.textSecondary },
  saveBtn: { flex: 2, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 13, alignItems: "center" },
  saveTxt: { fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" },
});
