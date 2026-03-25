import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

const C   = Colors.light;
const API = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

/* ─── Menu Item ─── */
function MenuItem({ icon, label, onPress, iconColor = C.primary, iconBg = C.rideLight, value, danger, badge, sub }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void;
  iconColor?: string; iconBg?: string; value?: string; danger?: boolean; badge?: string; sub?: string;
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
      {badge ? <View style={ps.menuBadge}><Text style={ps.menuBadgeTxt}>{badge}</Text></View> : null}
      {!danger && <Ionicons name="chevron-forward" size={16} color={C.textMuted} />}
    </Pressable>
  );
}

/* ─── Edit Profile Modal ─── */
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
    if (!name.trim()) { Alert.alert("Required", "Name required"); return; }
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
      Alert.alert("✅ Saved", "Profile updated successfully!");
    } catch { Alert.alert("Error", "Could not update profile. Try again."); }
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
            <TextInput style={ps.fieldInput} value={name} onChangeText={setName} placeholder="Your full name" placeholderTextColor={C.textMuted} autoCapitalize="words" />
          </View>

          <Text style={ps.label}>Email Address</Text>
          <View style={ps.field}>
            <Ionicons name="mail-outline" size={18} color={C.textMuted} />
            <TextInput style={ps.fieldInput} value={email} onChangeText={setEmail} placeholder="your@email.com" placeholderTextColor={C.textMuted} keyboardType="email-address" autoCapitalize="none" />
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

  const [showEdit,     setShowEdit]     = useState(false);
  const [refreshing,   setRefreshing]   = useState(false);
  const [stats,        setStats]        = useState({ orders: 0, rides: 0, spent: 0 });
  const [statsLoading, setStatsLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    if (!user) return;
    try {
      const [ordRes, rideRes] = await Promise.all([
        fetch(`${API}/orders?userId=${user.id}`),
        fetch(`${API}/rides?userId=${user.id}`),
      ]);
      const [ordData, rideData] = await Promise.all([ordRes.json(), rideRes.json()]);
      const orders = ordData.orders || [];
      const rides  = rideData.rides  || [];
      const spent  = orders.reduce((s: number, o: any) => s + (parseFloat(o.total) || 0), 0)
                   + rides.reduce((s: number,  r: any) => s + (parseFloat(r.fare)  || 0), 0);
      setStats({ orders: orders.length, rides: rides.length, spent: Math.round(spent) });
    } catch { /* ignore */ }
    setStatsLoading(false);
  }, [user]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchStats();
    setRefreshing(false);
  }, [fetchStats]);

  const handleLogout = () => {
    Alert.alert("Sign Out", "Sign out karna chahte hain?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: logout },
    ]);
  };

  const roleLabel:  Record<string, string>           = { customer: "Customer", rider: "Delivery Rider", vendor: "Store Vendor" };
  const roleColors: Record<string, [string, string]> = {
    customer: ["#1A56DB", "#3B82F6"],
    rider:    ["#059669", "#10B981"],
    vendor:   ["#D97706", "#F59E0B"],
  };
  const [c1, c2] = roleColors[user?.role || "customer"] || roleColors.customer!;
  const initials = user?.name ? user.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() : user?.phone?.slice(-2) || "U";

  const joinDate = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-PK", { month: "long", year: "numeric" })
    : "AJKMart User";

  return (
    <View style={[ps.root, { backgroundColor: C.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      >
        {/* Profile Card */}
        <LinearGradient colors={[c1, c2]} start={{ x:0,y:0 }} end={{ x:1,y:1 }} style={[ps.profileCard, { paddingTop: topPad + 20 }]}>
          <View style={[ps.blob, { width:180, height:180, top:-50, right:-30 }]} />
          <View style={[ps.blob, { width:90,  height:90,  bottom:-20, left:20 }]} />

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

        {/* Stats Row */}
        <View style={ps.statsRow}>
          {statsLoading ? (
            <ActivityIndicator color={C.primary} style={{ flex: 1, paddingVertical: 18 }} />
          ) : (
            <>
              <View style={ps.statBox}>
                <Text style={[ps.statVal, { color: C.primary }]}>{stats.orders}</Text>
                <Text style={ps.statLbl}>Orders</Text>
              </View>
              <View style={[ps.statDivider]} />
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

        {/* Wallet Banner */}
        <Pressable onPress={() => router.push("/(tabs)/wallet")} style={ps.walletBanner}>
          <View style={ps.walletL}>
            <LinearGradient colors={["#1A56DB","#2563EB"]} style={ps.walletIconGrad}>
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

        {/* Account */}
        <View style={ps.section}>
          <Text style={ps.sectionTitle}>Account</Text>
          <MenuItem icon="person-outline"         label="Edit Profile"    sub="Name, email update karein"                  onPress={() => setShowEdit(true)} />
          <MenuItem icon="call-outline"            label="Phone Number"   sub={user?.phone ? `+92 ${user.phone}` : "—"}    onPress={() => Alert.alert("Phone", "Phone number change ke liye helpline se contact karein: 0300-AJKMART")} iconColor="#7C3AED" iconBg="#EDE9FE" />
          <MenuItem icon="notifications-outline"   label="Notifications"  sub="Order, wallet updates"                      onPress={() => Alert.alert("Notifications", "• Order #XXXXXX confirmed\n• Wallet topped up successfully\n• New deals available today")} iconColor={C.food} iconBg={C.foodLight} badge="3" />
          <MenuItem icon="shield-outline"          label="Privacy & Security" sub="Data control & security"                onPress={() => Alert.alert("Privacy", "Aapka data secure hai aur kabhi third parties ko nahi diya jata.")} iconColor="#64748B" iconBg="#F1F5F9" />
        </View>

        {/* Activity */}
        <View style={ps.section}>
          <Text style={ps.sectionTitle}>My Activity</Text>
          <MenuItem icon="bag-outline"       label="My Orders"          sub={`${stats.orders} total orders`}   onPress={() => router.push("/(tabs)/orders")}          iconColor={C.primary} iconBg={C.rideLight} />
          <MenuItem icon="bicycle-outline"   label="My Rides"           sub={`${stats.rides} total rides`}     onPress={() => router.push("/ride")}                    iconColor="#8B5CF6"   iconBg="#EDE9FE" />
          <MenuItem icon="medkit-outline"    label="Pharmacy Orders"    sub="Medicine order history"           onPress={() => router.push("/pharmacy")}                iconColor="#7C3AED"   iconBg="#F5F3FF" />
          <MenuItem icon="cube-outline"      label="Parcel Bookings"    sub="Delivery history"                 onPress={() => router.push("/parcel")}                  iconColor="#D97706"   iconBg="#FFFBEB" />
          <MenuItem icon="wallet-outline"    label="Wallet & Payments"  sub="Top up, send money, history"     onPress={() => router.push("/(tabs)/wallet")}           iconColor={C.primary} iconBg="#EFF6FF" />
          <MenuItem icon="location-outline"  label="Saved Addresses"    sub="Muzaffarabad, Mirpur..."          onPress={() => Alert.alert("Saved Addresses", "📍 Home: Chowk Adalat, Muzaffarabad\n📍 Work: AJK University Campus\n📍 Other: CMH Hospital")} iconColor={C.mart} iconBg={C.martLight} />
        </View>

        {/* Vendor Dashboard */}
        {user?.role === "vendor" && (
          <View style={ps.section}>
            <Text style={ps.sectionTitle}>Vendor Dashboard</Text>
            <MenuItem icon="storefront-outline" label="My Products"       sub="Products manage karein"  onPress={() => Alert.alert("Vendor", "Product management coming soon!")} iconColor={C.mart} iconBg={C.martLight} />
            <MenuItem icon="analytics-outline"  label="Sales Analytics"   sub="Revenue aur sales data" onPress={() => Alert.alert("Vendor", "Analytics coming soon!")}           iconColor={C.primary} iconBg={C.rideLight} />
            <MenuItem icon="receipt-outline"    label="Incoming Orders"   sub="Naye orders dekho"      onPress={() => Alert.alert("Vendor", "Order management coming soon!")}    iconColor={C.food} iconBg={C.foodLight} />
          </View>
        )}

        {/* Rider Dashboard */}
        {user?.role === "rider" && (
          <View style={ps.section}>
            <Text style={ps.sectionTitle}>Rider Dashboard</Text>
            <MenuItem icon="bicycle-outline"  label="Active Deliveries"  sub="Current delivery status"    onPress={() => Alert.alert("Rider", "Active deliveries coming soon!")}    iconColor={C.success} iconBg="#D1FAE5" />
            <MenuItem icon="cash-outline"     label="My Earnings"        sub="Daily aur monthly earnings" onPress={() => Alert.alert("Rider", "Earnings tracking coming soon!")}     iconColor={C.food}    iconBg={C.foodLight} />
            <MenuItem icon="star-outline"     label="Ratings & Reviews"  sub="Customer feedback"          onPress={() => Alert.alert("Rider", "Rating: ⭐⭐⭐⭐⭐ 4.9/5.0 • 250+ trips")} iconColor="#F59E0B"   iconBg="#FEF3C7" />
          </View>
        )}

        {/* Support */}
        <View style={ps.section}>
          <Text style={ps.sectionTitle}>Support</Text>
          <MenuItem icon="help-circle-outline"   label="Help & FAQ"        sub="Aam sawaal aur jawab"   onPress={() => Alert.alert("Help Center", "📞 Helpline: 0300-AJKMART\n📧 Email: help@ajkmart.pk\n⏰ Available: 8AM - 10PM")}  iconColor="#64748B" iconBg="#F1F5F9" />
          <MenuItem icon="chatbubble-outline"    label="Live Chat Support" sub="Online chat support"    onPress={() => Alert.alert("Live Chat", "Chat support 8AM-10PM available hai.\nCall: 0300-AJKMART")}                           iconColor="#0891B2" iconBg="#E0F2FE" />
          <MenuItem icon="document-text-outline" label="Terms of Service"  sub="Terms aur conditions"  onPress={() => Alert.alert("Terms", "AJKMart use karke aap hamare terms of service se agree karte hain.")}                     iconColor="#64748B" iconBg="#F1F5F9" />
        </View>

        {/* App Info */}
        <View style={ps.appInfo}>
          <View style={ps.appLogo}>
            <Ionicons name="storefront" size={24} color={C.primary} />
          </View>
          <Text style={ps.appName}>AJKMart</Text>
          <Text style={ps.appVersion}>Version 1.0.0 • AJK, Pakistan</Text>
          <Text style={ps.appTagline}>Your Super App for everything in AJK</Text>
        </View>

        {/* Logout */}
        <View style={{ paddingHorizontal: 16, marginBottom: 32 }}>
          <Pressable onPress={handleLogout} style={ps.logoutBtn}>
            <Ionicons name="log-out-outline" size={20} color={C.danger} />
            <Text style={ps.logoutTxt}>Sign Out</Text>
          </Pressable>
        </View>

        <View style={{ height: Platform.OS === "web" ? 60 : 20 }} />
      </ScrollView>

      <EditProfileModal
        visible={showEdit}
        onClose={() => setShowEdit(false)}
        currentName={user?.name || ""}
        currentEmail={user?.email || ""}
        onSaved={(name, email) => updateUser({ name, email })}
      />
    </View>
  );
}

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
  walletIconGrad: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
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
  menuBadge: { backgroundColor: "#EF4444", borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5, marginRight: 4 },
  menuBadgeTxt: { fontFamily: "Inter_700Bold", fontSize: 10, color: "#fff" },

  appInfo: { alignItems: "center", marginTop: 28, marginBottom: 16, gap: 6 },
  appLogo: { width: 56, height: 56, borderRadius: 16, backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center" },
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
  field: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, marginBottom: 16, backgroundColor: C.surface },
  fieldInput: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 15, color: C.text, paddingVertical: 13 },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  cancelTxt: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: C.textSecondary },
  saveBtn: { flex: 2, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  saveTxt: { fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff" },
});
