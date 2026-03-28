import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useState, useEffect } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Modal,
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
import { useToast } from "@/context/ToastContext";
import { getProducts, createPharmacyOrder } from "@workspace/api-client-react";
import type { GetProductsParams, GetProductsType } from "@workspace/api-client-react";
import { usePlatformConfig } from "@/context/PlatformConfigContext";

const C = Colors.light;
const W = Dimensions.get("window").width;

/* ─── Types ─── */
interface Med {
  id: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  unit: string;
  emoji: string;
  requires_prescription?: boolean;
}

interface CartItem extends Med { qty: number }

/* ─── Medicine Card ─── */
function MedCard({ med, qty, onAdd, onRemove }: {
  med: Med; qty: number; onAdd: () => void; onRemove: () => void;
}) {
  return (
    <View style={s.medCard}>
      <View style={s.medEmoji}><Text style={{ fontSize: 26 }}>{med.emoji || "💊"}</Text></View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Text style={s.medName} numberOfLines={1}>{med.name}</Text>
          {med.requires_prescription && (
            <View style={s.rxBadge}><Text style={s.rxTxt}>Rx</Text></View>
          )}
        </View>
        <Text style={s.medBrand}>{med.brand}</Text>
        <Text style={s.medUnit}>{med.unit}</Text>
        <Text style={s.medPrice}>Rs. {med.price}</Text>
      </View>
      <View style={s.qtyCtrl}>
        {qty > 0 ? (
          <>
            <Pressable onPress={onRemove} style={s.qtyBtn}>
              <Ionicons name="remove" size={16} color={C.primary} />
            </Pressable>
            <Text style={s.qtyTxt}>{qty}</Text>
            <Pressable onPress={onAdd} style={s.qtyBtn}>
              <Ionicons name="add" size={16} color={C.primary} />
            </Pressable>
          </>
        ) : (
          <Pressable onPress={onAdd} style={s.addBtn}>
            <Ionicons name="add" size={16} color="#fff" />
          </Pressable>
        )}
      </View>
    </View>
  );
}

/* ════════════════════ MAIN SCREEN ════════════════════ */
export default function PharmacyScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const { user, updateUser, token } = useAuth();
  const { showToast } = useToast();
  const { config } = usePlatformConfig();

  const inMaintenance = config.appStatus === "maintenance";
  const pharmacyEnabled = config.features.pharmacy;

  const [medicines, setMedicines] = useState<Med[]>([]);
  const [categories, setCategories] = useState<string[]>(["All"]);
  const [loadingMeds, setLoadingMeds] = useState(true);
  const [medsError, setMedsError] = useState(false);
  const [activeTab, setActiveTab] = useState("All");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [showCheckout, setShowCheckout] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedOrderId, setConfirmedOrderId] = useState("");

  const [address, setAddress] = useState(user?.name ? `${user.name}'s address, AJK` : "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [prescription, setPrescription] = useState("");
  const [payMethod, setPayMethod] = useState<"wallet" | "cash">("cash");

  /* ── Fetch medicines from real API (typed, via api-client-react) ── */
  useEffect(() => {
    if (!pharmacyEnabled) return;
    setLoadingMeds(true);
    const params: GetProductsParams = { type: "pharmacy" as GetProductsType };
    setMedsError(false);
    getProducts(params)
      .then(data => {
        if (data?.products?.length) {
          const meds: Med[] = data.products.map(p => ({
            id: p.id,
            name: p.name,
            brand: p.vendorName ?? "Various",
            category: p.category,
            price: p.price,
            unit: p.unit ?? p.description ?? "1 unit",
            emoji: "💊",
            requires_prescription: false,
          }));
          setMedicines(meds);
          const cats = ["All", ...new Set(meds.map(m => m.category))];
          setCategories(cats);
        }
      })
      .catch(() => { setMedsError(true); })
      .finally(() => setLoadingMeds(false));
  }, [pharmacyEnabled]);

  const filtered = medicines.filter(m => {
    const matchCat = activeTab === "All" || m.category === activeTab;
    const matchSearch = !search || m.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const cartItems: CartItem[] = medicines
    .filter(m => (cart[m.id] ?? 0) > 0)
    .map(m => ({ ...m, qty: cart[m.id]! }));

  const cartTotal = cartItems.reduce((sum, m) => sum + m.price * m.qty, 0);
  const cartCount = Object.values(cart).reduce((sum, v) => sum + v, 0);

  useEffect(() => {
    if (payMethod === "cash" && cartTotal > config.orderRules.maxCodAmount) {
      setPayMethod("wallet");
    }
  }, [cartTotal, config.orderRules.maxCodAmount]);

  const addToCart = (id: string) => setCart(p => ({ ...p, [id]: (p[id] ?? 0) + 1 }));
  const removeFromCart = (id: string) => setCart(p => {
    const v = (p[id] ?? 0) - 1;
    if (v <= 0) { const n = { ...p }; delete n[id]; return n; }
    return { ...p, [id]: v };
  });

  const placeOrder = async () => {
    if (!address.trim() || !phone.trim()) {
      showToast("Delivery address aur phone number enter karein", "error");
      return;
    }
    if (cartItems.length === 0) {
      showToast("Cart mein kam az kam ek medicine add karein", "error");
      return;
    }
    setLoading(true);
    try {
      const data = await createPharmacyOrder({
        items: cartItems.map(m => ({ id: m.id, name: m.name, price: m.price, quantity: m.qty })),
        prescriptionNote: prescription || null,
        deliveryAddress: address,
        contactPhone: phone,
        paymentMethod: payMethod as "cash" | "wallet",
      });
      if (payMethod === "wallet" && user) {
        updateUser({ walletBalance: (user.walletBalance ?? 0) - (data.total ?? cartTotal) });
      }
      setConfirmedOrderId(data.id);
      setConfirmed(true);
      setCart({});
    } catch {
      showToast("Network error. Dobara try karein.", "error");
    } finally {
      setLoading(false);
    }
  };

  /* ── Service Unavailable ── */
  if (!pharmacyEnabled) {
    return (
      <View style={[s.root, { justifyContent: "center", alignItems: "center", padding: 32 }]}>
        <Pressable onPress={() => router.back()} style={{ position: "absolute", top: topPad + 12, left: 16 }}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </Pressable>
        <View style={[s.successCard, { borderColor: "#FEE2E2" }]}>
          <Text style={{ fontSize: 52, marginBottom: 12 }}>🚫</Text>
          <Text style={[s.successTitle, { color: "#EF4444" }]}>Service Unavailable</Text>
          <Text style={[s.successSub, { marginBottom: 20 }]}>
            Pharmacy service filhaal available nahi hai.{"\n"}
            Thodi der baad dobara try karein.
          </Text>
          <Pressable style={[s.successBtn, { backgroundColor: "#FEF2F2" }]} onPress={() => router.back()}>
            <Text style={[s.successBtnTxt, { color: "#EF4444" }]}>Back to Home</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  /* ── Maintenance blocks ALL states including order confirmation ── */
  if (inMaintenance) {
    return (
      <View style={[s.root, { justifyContent: "center", alignItems: "center", padding: 32 }]}>
        <View style={[s.successCard, { borderColor: "#FEF3C7" }]}>
          <Text style={{ fontSize: 52, marginBottom: 12 }}>🔧</Text>
          <Text style={[s.successTitle, { color: "#D97706" }]}>Under Maintenance</Text>
          <Text style={[s.successSub, { marginBottom: 20 }]}>{config.content.maintenanceMsg}</Text>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, textAlign: "center" }}>
            Please check back later. We apologize for the inconvenience.
          </Text>
        </View>
      </View>
    );
  }

  if (confirmed) {
    return (
      <View style={[s.root, { justifyContent: "center", alignItems: "center", paddingHorizontal: 32 }]}>
        <View style={s.successCard}>
          <View style={s.successIcon}><Text style={{ fontSize: 48 }}>✅</Text></View>
          <Text style={s.successTitle}>Order Placed!</Text>
          <Text style={s.successSub}>
            Aapka pharmacy order #{confirmedOrderId.slice(-6).toUpperCase()} place ho gaya!{"\n"}
            Delivery: 25-40 minutes
          </Text>
          <View style={s.successMeta}>
            <Ionicons name="location-outline" size={14} color={C.textMuted} />
            <Text style={s.successMetaTxt} numberOfLines={2}>{address}</Text>
          </View>
          <Pressable style={s.successBtn} onPress={() => { setConfirmed(false); router.push("/(tabs)"); }}>
            <Text style={s.successBtnTxt}>Back to Home</Text>
          </Pressable>
          <Pressable style={[s.successBtn, { backgroundColor: "#EFF6FF", marginTop: 8 }]} onPress={() => { setConfirmed(false); }}>
            <Text style={[s.successBtnTxt, { color: C.primary }]}>Order More</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      {/* Header */}
      <LinearGradient colors={["#7C3AED", "#8B5CF6", "#A78BFA"]} start={{ x:0,y:0 }} end={{ x:1,y:1 }} style={[s.header, { paddingTop: topPad + 14 }]}>
        <View style={s.hdrRow}>
          <Pressable onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.hdrTitle}>💊 Pharmacy</Text>
            <Text style={s.hdrSub}>Medicines delivered to your door</Text>
          </View>
          {cartCount > 0 && (
            <Pressable onPress={() => setShowCheckout(true)} style={s.cartPill}>
              <Ionicons name="cart" size={16} color="#fff" />
              <Text style={s.cartPillTxt}>{cartCount} items</Text>
            </Pressable>
          )}
        </View>
        {/* Search */}
        <View style={s.searchBar}>
          <Ionicons name="search-outline" size={16} color={C.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search medicines..."
            placeholderTextColor={C.textMuted}
            style={s.searchInput}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={16} color={C.textMuted} />
            </Pressable>
          )}
        </View>
      </LinearGradient>

      {/* Category Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabsScroll} contentContainerStyle={s.tabsRow}>
        {categories.map(cat => (
          <Pressable key={cat} onPress={() => setActiveTab(cat)} style={[s.tab, activeTab === cat && s.tabActive]}>
            <Text style={[s.tabTxt, activeTab === cat && s.tabTxtActive]}>{cat}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Notice */}
      <View style={s.rxNotice}>
        <Ionicons name="information-circle-outline" size={14} color="#7C3AED" />
        <Text style={s.rxNoticeTxt}><Text style={{ fontFamily: "Inter_600SemiBold" }}>Rx</Text> wali dawaiyan prescription ke saath milti hain</Text>
      </View>

      {/* Medicines Grid */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.grid}>
        {loadingMeds ? (
          <View style={{ alignItems: "center", paddingTop: 60 }}>
            <ActivityIndicator size="large" color="#7C3AED" />
            <Text style={[s.emptyTxt, { marginTop: 12 }]}>Medicines load ho rahi hain...</Text>
          </View>
        ) : medsError ? (
          <View style={{ alignItems: "center", paddingTop: 60, gap: 8 }}>
            <Ionicons name="cloud-offline-outline" size={48} color="#9CA3AF" />
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: "#374151" }}>Load nahi ho sakein</Text>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: "#6B7280" }}>Internet check karein aur retry karein</Text>
            <Pressable onPress={() => { setLoadingMeds(true); setMedsError(false); getProducts({ type: "pharmacy" as GetProductsType }).then(data => { if (data?.products?.length) { const meds: Med[] = data.products.map(p => ({ id: p.id, name: p.name, brand: p.vendorName ?? "Various", category: p.category, price: p.price, unit: p.unit ?? p.description ?? "1 unit", emoji: "💊", requires_prescription: false })); setMedicines(meds); setCategories(["All", ...new Set(meds.map(m => m.category))]); } }).catch(() => setMedsError(true)).finally(() => setLoadingMeds(false)); }} style={{ backgroundColor: "#7C3AED", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 8 }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" }}>Retry</Text>
            </Pressable>
          </View>
        ) : filtered.length === 0 ? (
          <View style={{ alignItems: "center", paddingTop: 60 }}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🔍</Text>
            <Text style={s.emptyTxt}>Koi medicine nahi mili</Text>
          </View>
        ) : (
          filtered.map(med => (
            <MedCard
              key={med.id}
              med={med}
              qty={cart[med.id] ?? 0}
              onAdd={() => addToCart(med.id)}
              onRemove={() => removeFromCart(med.id)}
            />
          ))
        )}
        <View style={{ height: cartCount > 0 ? 100 : 24 }} />
      </ScrollView>

      {/* Bottom Cart Bar */}
      {cartCount > 0 && (
        <View style={[s.cartBar, { paddingBottom: insets.bottom + 12 }]}>
          <View>
            <Text style={s.cartBarCount}>{cartCount} medicines</Text>
            <Text style={s.cartBarTotal}>Rs. {cartTotal.toLocaleString()}</Text>
          </View>
          <Pressable style={s.checkoutBtn} onPress={() => setShowCheckout(true)}>
            <Text style={s.checkoutBtnTxt}>Place Order</Text>
            <Ionicons name="arrow-forward" size={16} color="#fff" />
          </Pressable>
        </View>
      )}

      {/* Checkout Modal */}
      <Modal visible={showCheckout} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCheckout(false)}>
        <ScrollView style={s.modal} contentContainerStyle={{ paddingBottom: 40 }}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Order Summary</Text>
            <Pressable onPress={() => setShowCheckout(false)}>
              <Ionicons name="close" size={22} color={C.text} />
            </Pressable>
          </View>

          {/* Cart Items */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>Medicines ({cartCount})</Text>
            {cartItems.map(item => (
              <View key={item.id} style={s.orderItem}>
                <Text style={s.orderItemName}>{item.emoji || "💊"} {item.name}</Text>
                <Text style={s.orderItemQty}>×{item.qty}</Text>
                <Text style={s.orderItemPrice}>Rs. {(item.price * item.qty).toLocaleString()}</Text>
              </View>
            ))}
            <View style={s.divider} />
            <View style={[s.orderItem, { marginTop: 4 }]}>
              <Text style={[s.orderItemName, { fontFamily: "Inter_700Bold" }]}>Delivery Fee</Text>
              <Text style={[s.orderItemPrice, { color: C.success }]}>FREE</Text>
            </View>
            <View style={s.orderItem}>
              <Text style={[s.orderItemName, { fontFamily: "Inter_700Bold", fontSize: 15 }]}>Total</Text>
              <Text style={[s.orderItemPrice, { fontFamily: "Inter_700Bold", fontSize: 15, color: C.primary }]}>Rs. {cartTotal.toLocaleString()}</Text>
            </View>
          </View>

          {/* Delivery Info */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>Delivery Details</Text>
            <Text style={s.label}>Delivery Address *</Text>
            <TextInput
              value={address}
              onChangeText={setAddress}
              placeholder="Enter full address"
              placeholderTextColor={C.textMuted}
              style={s.input}
              multiline
              numberOfLines={2}
            />
            <Text style={s.label}>Contact Number *</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="03XX XXXXXXX"
              placeholderTextColor={C.textMuted}
              style={s.input}
              keyboardType="phone-pad"
            />
            <Text style={s.label}>Prescription Note (Optional)</Text>
            <TextInput
              value={prescription}
              onChangeText={setPrescription}
              placeholder="Any special instructions or prescription details..."
              placeholderTextColor={C.textMuted}
              style={[s.input, { minHeight: 72 }]}
              multiline
              numberOfLines={3}
            />
          </View>

          {/* Payment */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>Payment Method</Text>
            <View style={s.payRow}>
              {cartTotal <= config.orderRules.maxCodAmount ? (
                <Pressable onPress={() => setPayMethod("cash")} style={[s.payOpt, payMethod === "cash" && s.payOptActive]}>
                  <Ionicons name="cash-outline" size={20} color={payMethod === "cash" ? C.primary : C.textMuted} />
                  <Text style={[s.payOptTxt, payMethod === "cash" && { color: C.primary }]}>Cash on Delivery</Text>
                </Pressable>
              ) : (
                <View style={[s.payOpt, { opacity: 0.4 }]}>
                  <Ionicons name="cash-outline" size={20} color={C.textMuted} />
                  <Text style={s.payOptTxt}>COD limit: Rs. {config.orderRules.maxCodAmount.toLocaleString()}</Text>
                </View>
              )}
              {config.features.wallet && (
                <Pressable onPress={() => setPayMethod("wallet")} style={[s.payOpt, payMethod === "wallet" && s.payOptActive]}>
                  <Ionicons name="wallet-outline" size={20} color={payMethod === "wallet" ? C.primary : C.textMuted} />
                  <View>
                    <Text style={[s.payOptTxt, payMethod === "wallet" && { color: C.primary }]}>Wallet</Text>
                    <Text style={s.walletBal}>Rs. {(user?.walletBalance ?? 0).toLocaleString()} available</Text>
                  </View>
                </Pressable>
              )}
            </View>
          </View>

          <Pressable style={[s.placeBtn, loading && { opacity: 0.7 }]} onPress={placeOrder} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={s.placeBtnTxt}>Place Order • Rs. {cartTotal.toLocaleString()}</Text>
                <Ionicons name="checkmark-circle" size={18} color="#fff" />
              </>
            )}
          </Pressable>
        </ScrollView>
      </Modal>

    </View>
  );
}

/* ─── Styles ─── */
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },

  header: { paddingHorizontal: 16, paddingBottom: 16 },
  hdrRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  backBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  hdrTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: "#fff" },
  hdrSub: { fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.8)" },
  cartPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.25)", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  cartPillTxt: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: "#fff" },
  searchBar: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  searchInput: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13, color: C.text, padding: 0 },

  tabsScroll: { maxHeight: 50, backgroundColor: "#fff" },
  tabsRow: { paddingHorizontal: 12, gap: 8, alignItems: "center", paddingVertical: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: "#F1F5F9" },
  tabActive: { backgroundColor: "#7C3AED" },
  tabTxt: { fontFamily: "Inter_500Medium", fontSize: 12, color: C.textMuted },
  tabTxtActive: { color: "#fff" },

  rxNotice: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F5F3FF", paddingHorizontal: 16, paddingVertical: 8 },
  rxNoticeTxt: { fontFamily: "Inter_400Regular", fontSize: 11, color: "#7C3AED", flex: 1 },

  grid: { paddingHorizontal: 12, paddingTop: 12, gap: 10 },
  emptyTxt: { fontFamily: "Inter_500Medium", fontSize: 14, color: C.textMuted },

  medCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 14, padding: 12, gap: 10, borderWidth: 1, borderColor: C.border },
  medEmoji: { width: 48, height: 48, borderRadius: 13, backgroundColor: "#F5F3FF", alignItems: "center", justifyContent: "center" },
  medName: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text, flex: 1 },
  medBrand: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted },
  medUnit: { fontFamily: "Inter_400Regular", fontSize: 10, color: C.textMuted },
  medPrice: { fontFamily: "Inter_700Bold", fontSize: 14, color: "#7C3AED", marginTop: 3 },
  rxBadge: { backgroundColor: "#FEE2E2", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  rxTxt: { fontFamily: "Inter_700Bold", fontSize: 9, color: "#EF4444" },

  qtyCtrl: { flexDirection: "row", alignItems: "center", gap: 8 },
  qtyBtn: { width: 30, height: 30, borderRadius: 9, borderWidth: 1.5, borderColor: C.primary, alignItems: "center", justifyContent: "center" },
  qtyTxt: { fontFamily: "Inter_700Bold", fontSize: 14, color: C.text, minWidth: 18, textAlign: "center" },
  addBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center" },

  cartBar: { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  cartBarCount: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted },
  cartBarTotal: { fontFamily: "Inter_700Bold", fontSize: 18, color: C.text },
  checkoutBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#7C3AED", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14 },
  checkoutBtnTxt: { fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" },

  modal: { backgroundColor: "#fff", flex: 1 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontFamily: "Inter_700Bold", fontSize: 17, color: C.text },

  section: { paddingHorizontal: 16, paddingTop: 16 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 15, color: C.text, marginBottom: 10 },

  orderItem: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  orderItemName: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13, color: C.text },
  orderItemQty: { fontFamily: "Inter_500Medium", fontSize: 12, color: C.textMuted, width: 28 },
  orderItemPrice: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 8 },

  label: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.text, marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontFamily: "Inter_400Regular", fontSize: 13, color: C.text },

  payRow: { flexDirection: "row", gap: 10 },
  payOpt: { flex: 1, flexDirection: "column", alignItems: "center", gap: 5, padding: 12, borderRadius: 12, borderWidth: 1.5, borderColor: C.border },
  payOptActive: { borderColor: C.primary, backgroundColor: "#EFF6FF" },
  payOptTxt: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: C.textMuted, textAlign: "center" },
  walletBal: { fontFamily: "Inter_400Regular", fontSize: 10, color: C.textMuted, textAlign: "center" },

  placeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, margin: 16, backgroundColor: "#7C3AED", borderRadius: 14, paddingVertical: 15 },
  placeBtnTxt: { fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff" },

  successCard: { backgroundColor: "#fff", borderRadius: 20, padding: 28, alignItems: "center", width: "100%", borderWidth: 1, borderColor: C.border },
  successIcon: { marginBottom: 12 },
  successTitle: { fontFamily: "Inter_700Bold", fontSize: 24, color: C.text, marginBottom: 8 },
  successSub: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted, textAlign: "center", lineHeight: 20, marginBottom: 16 },
  successMeta: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginBottom: 20, width: "100%" },
  successMetaTxt: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, flex: 1 },
  successBtn: { width: "100%", alignItems: "center", backgroundColor: "#7C3AED", borderRadius: 14, paddingVertical: 14 },
  successBtnTxt: { fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff" },
});
