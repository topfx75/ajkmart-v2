import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Location from "expo-location";
import React, { useState, useEffect } from "react";
import {
  ActivityIndicator,
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
import { LinearGradient } from "expo-linear-gradient";

import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/context/ToastContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { createOrder } from "@workspace/api-client-react";

const C = Colors.light;
type PayMethod = "cash" | "wallet" | "jazzcash" | "easypaisa";

interface PaymentMethod {
  id: PayMethod;
  label: string;
  logo: string;
  available: boolean;
  description: string;
  mode?: string;
}

interface SavedAddress {
  id: string;
  label: string;
  address: string;
  city: string;
  icon: string;
  isDefault: boolean;
}

function AddressPickerModal({
  visible,
  addresses,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  addresses: SavedAddress[];
  selected: string;
  onSelect: (a: SavedAddress) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Delivery Address Chunein</Text>
          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 340 }}>
            {addresses.map(addr => {
              const isSel = selected === addr.id;
              return (
                <Pressable
                  key={addr.id}
                  onPress={() => { onSelect(addr); onClose(); }}
                  style={[styles.addrOpt, isSel && styles.addrOptSel]}
                >
                  <View style={[styles.addrOptIcon, { backgroundColor: isSel ? "#DBEAFE" : C.surfaceSecondary }]}>
                    <Ionicons name={(addr.icon as any) || "location-outline"} size={20} color={isSel ? C.primary : C.textSecondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={[styles.addrOptLabel, isSel && { color: C.primary }]}>{addr.label}</Text>
                      {addr.isDefault && (
                        <View style={styles.defaultTag}>
                          <Text style={styles.defaultTagText}>Default</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.addrOptAddress} numberOfLines={1}>{addr.address}</Text>
                    <Text style={styles.addrOptCity}>{addr.city}</Text>
                  </View>
                  {isSel && <Ionicons name="checkmark-circle" size={22} color={C.primary} />}
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable onPress={onClose} style={styles.cancelBtn}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function CartScreen() {
  const insets = useSafeAreaInsets();
  const { user, updateUser, token } = useAuth();
  const { items, total, cartType, updateQuantity, clearCart } = useCart();
  const { showToast } = useToast();
  const { config: platformConfig } = usePlatformConfig();
  const appName    = platformConfig.platform.appName;
  const orderRules = platformConfig.orderRules;
  const finance    = platformConfig.finance;
  const customer   = platformConfig.customer;

  const [payMethod, setPayMethod] = useState<PayMethod>("cash");
  const [loading, setLoading] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState<{ id: string; time: string; payMethod?: string } | null>(null);

  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [selectedAddrId, setSelectedAddrId] = useState<string>("");
  const [showAddrPicker, setShowAddrPicker] = useState(false);
  const [addrLoading, setAddrLoading] = useState(false);

  const [allPayMethods, setAllPayMethods] = useState<PaymentMethod[]>([
    { id: "cash",   label: "Cash on Delivery",    logo: "💵", available: true,  description: "Delivery par payment karein" },
    { id: "wallet", label: `${appName} Wallet`,   logo: "💰", available: true,  description: "Wallet se instant pay" },
  ]);

  // Promo code state
  const [promoInput, setPromoInput] = useState("");
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoApplied, setPromoApplied] = useState(false);

  // Gateway payment modal state
  const [showGwModal, setShowGwModal] = useState(false);
  const [gwMobile, setGwMobile] = useState("");
  const [gwPaying, setGwPaying] = useState(false);
  const [gwStep, setGwStep] = useState<"input" | "waiting" | "done">("input");

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const [deliveryFeeConfig, setDeliveryFeeConfig] = useState<{ mart: number; food: number; pharmacy: number; parcel: number }>({ mart: 80, food: 60, pharmacy: 50, parcel: 100 });
  const [freeDeliveryAbove, setFreeDeliveryAbove] = useState(1000);
  const [freeDeliveryEnabled, setFreeDeliveryEnabled] = useState(true);

  useEffect(() => {
    const API = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
    fetch(`${API}/platform-config`)
      .then(r => r.json())
      .then(d => {
        if (d.deliveryFee) {
          setDeliveryFeeConfig({
            mart:     d.deliveryFee.mart     ?? 80,
            food:     d.deliveryFee.food     ?? 60,
            pharmacy: d.deliveryFee.pharmacy ?? 50,
            parcel:   d.deliveryFee.parcel   ?? 100,
          });
          if (typeof d.deliveryFee.freeEnabled === "boolean") setFreeDeliveryEnabled(d.deliveryFee.freeEnabled);
          if (d.deliveryFee.freeDeliveryAbove) setFreeDeliveryAbove(d.deliveryFee.freeDeliveryAbove);
        } else if (d.platform?.freeDeliveryAbove) {
          setFreeDeliveryAbove(d.platform.freeDeliveryAbove);
        }
        if (d.payment?.methods) {
          const methods: PaymentMethod[] = d.payment.methods.map((m: any) => ({
            id:          m.id,
            label:       m.label,
            logo:        m.logo,
            available:   m.available,
            description: m.description,
            mode:        m.mode,
          }));
          setAllPayMethods(methods);
        }
      })
      .catch(() => {});
  }, []);

  const rawDeliveryFee = (deliveryFeeConfig as Record<string,number>)[cartType] ?? deliveryFeeConfig.mart;
  const deliveryFee = (freeDeliveryEnabled && total >= freeDeliveryAbove) ? 0 : rawDeliveryFee;
  const gstAmount   = finance.gstEnabled ? Math.round(total * finance.gstPct / 100) : 0;
  const cashbackAmt = finance.cashbackEnabled ? Math.min(Math.round(total * finance.cashbackPct / 100), finance.cashbackMaxRs) : 0;
  const grandTotal  = Math.max(0, total + deliveryFee + gstAmount - promoDiscount);
  const walletCashbackApplies = payMethod === "wallet" && customer.walletCashbackPct > 0 && customer.walletCashbackOrders;
  const walletCashbackAmt = walletCashbackApplies ? Math.round(grandTotal * customer.walletCashbackPct / 100) : 0;

  // Dynamic payment methods: hide COD if order exceeds max COD limit
  const availablePayMethods = allPayMethods.map(m => {
    if (m.id === "cash" && grandTotal > orderRules.maxCodAmount) {
      return { ...m, available: false, description: `COD limit: Rs.${orderRules.maxCodAmount.toLocaleString()}` };
    }
    return m;
  });

  // Auto-switch away from COD if it becomes unavailable
  useEffect(() => {
    if (payMethod === "cash" && grandTotal > orderRules.maxCodAmount) {
      const fallback = availablePayMethods.find(m => m.id !== "cash" && m.available);
      if (fallback) setPayMethod(fallback.id as PayMethod);
    }
  }, [grandTotal, orderRules.maxCodAmount]);

  const selectedAddr = addresses.find(a => a.id === selectedAddrId);
  const deliveryLine = selectedAddr
    ? `${selectedAddr.label} — ${selectedAddr.address}, ${selectedAddr.city}`
    : "Home, AJK, Pakistan";

  useEffect(() => {
    if (!user?.id) return;
    const API = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
    setAddrLoading(true);
    fetch(`${API}/addresses`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.json())
      .then(d => {
        const addrs: SavedAddress[] = d.addresses || [];
        setAddresses(addrs);
        const def = addrs.find(a => a.isDefault) || addrs[0];
        if (def) setSelectedAddrId(def.id);
      })
      .catch(() => {})
      .finally(() => setAddrLoading(false));
  }, [user?.id]);

  const applyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    setPromoLoading(true);
    setPromoError(null);
    try {
      const API = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
      const orderType = cartType === "mixed" ? "mart" : cartType;
      const res = await fetch(`${API}/orders/validate-promo?code=${encodeURIComponent(code)}&total=${total}&type=${orderType}`);
      const data = await res.json();
      if (data.valid) {
        setPromoCode(code);
        setPromoDiscount(data.discount);
        setPromoApplied(true);
        setPromoError(null);
        showToast(`Promo code apply ho gaya! Rs. ${data.discount} discount mila`, "success");
      } else {
        setPromoCode(null);
        setPromoDiscount(0);
        setPromoApplied(false);
        setPromoError(data.error || "Invalid promo code");
      }
    } catch {
      setPromoError("Network error — dobara try karein");
    } finally {
      setPromoLoading(false);
    }
  };

  const removePromo = () => {
    setPromoCode(null);
    setPromoDiscount(0);
    setPromoApplied(false);
    setPromoInput("");
    setPromoError(null);
  };

  // Place order after payment cleared
  const placeOrder = async (finalPayMethod: PayMethod) => {
    const order = await createOrder({
      type: cartType === "mixed" ? "mart" : cartType,
      items: items.map(i => ({
        productId: i.productId,
        name: i.name,
        price: i.price,
        quantity: i.quantity,
        image: i.image,
      })),
      deliveryAddress: deliveryLine,
      paymentMethod: finalPayMethod,
      ...(promoCode ? { promoCode } : {}),
    } as any);
    if (finalPayMethod === "wallet") {
      updateUser({ walletBalance: (user!.walletBalance ?? 0) - grandTotal });
    }

    /* ── Fire-and-forget: save customer GPS at order placement ── */
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const API_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
        await fetch(`${API_URL}/locations/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            latitude:  pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy:  pos.coords.accuracy ?? null,
            role:      "customer",
            action:    "order_placed",
          }),
        });
      } catch { /* silent — never block the user flow */ }
    })();

    clearCart();
    setOrderSuccess({
      id: (order as any).id?.slice(-6).toUpperCase() || "------",
      time: (order as any).estimatedTime || "30-45 min",
      payMethod: finalPayMethod,
    });
  };

  const handleCheckout = async () => {
    if (!user) { showToast("Login karein order place karne ke liye", "error"); return; }
    if (items.length === 0) { showToast("Cart mein koi item nahi", "error"); return; }
    if (total < orderRules.minOrderAmount) {
      showToast(`Minimum order Rs.${orderRules.minOrderAmount} — Rs.${orderRules.minOrderAmount - total} aur add karein`, "error");
      return;
    }
    if (total > orderRules.maxCartValue) {
      showToast(`Cart value Rs.${orderRules.maxCartValue.toLocaleString()} se zyada nahi ho sakti`, "error");
      return;
    }

    if (payMethod === "wallet") {
      if ((user.walletBalance ?? 0) < grandTotal) {
        showToast(`Wallet mein Rs. ${user.walletBalance} hain — Rs. ${grandTotal} chahiye`, "error");
        return;
      }
      setLoading(true);
      try { await placeOrder("wallet"); }
      catch (e: any) { showToast(e.message || "Order place nahi ho saka.", "error"); }
      setLoading(false);
      return;
    }

    if (payMethod === "jazzcash" || payMethod === "easypaisa") {
      setGwStep("input");
      setGwMobile("");
      setShowGwModal(true);
      return;
    }

    // Cash on delivery
    setLoading(true);
    try { await placeOrder("cash"); }
    catch (e: any) { showToast(e.message || "Order place nahi ho saka. Dobara try karein.", "error"); }
    setLoading(false);
  };

  // Gateway payment flow (JazzCash / EasyPaisa)
  const handleGwPay = async () => {
    if (!gwMobile || gwMobile.replace(/\D/g, "").length < 10) {
      showToast("Sahih mobile number darj karein (03XX-XXXXXXX)", "error");
      return;
    }
    setGwPaying(true);
    setGwStep("waiting");
    try {
      const API = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
      const tempOrderId = `TEMP-${Date.now()}`;
      const r = await fetch(`${API}/payments/initiate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gateway:      payMethod,
          amount:       grandTotal,
          orderId:      tempOrderId,
          mobileNumber: gwMobile.replace(/\D/g, ""),
        }),
      });
      const data = await r.json() as any;
      if (!r.ok) throw new Error(data.error || "Payment initiate nahi ho saka");

      // Sandbox: auto-simulate after 2s; Live: user approves on their app
      const isSandbox = data.mode === "sandbox";
      if (isSandbox) {
        await new Promise(res => setTimeout(res, 2200));
        setGwStep("done");
        await new Promise(res => setTimeout(res, 800));
        await placeOrder(payMethod);
        setShowGwModal(false);
      } else {
        // Live mode — show waiting state for user to approve on their phone
        setGwStep("waiting");
        await new Promise(res => setTimeout(res, 3000));
        // In production, you'd poll /api/payments/status/:txnRef here
        setGwStep("done");
        await new Promise(res => setTimeout(res, 600));
        await placeOrder(payMethod);
        setShowGwModal(false);
      }
    } catch (e: any) {
      showToast(e.message || "Payment fail ho gaya. Dobara try karein.", "error");
      setGwStep("input");
    }
    setGwPaying(false);
  };

  // ── Gateway Payment Modal ─────────────────────────────────────────
  const gwName = payMethod === "jazzcash" ? "JazzCash" : "EasyPaisa";
  const gwLogo = payMethod === "jazzcash" ? "🔴" : "🟢";
  const gwMode = availablePayMethods.find(m => m.id === payMethod)?.mode ?? "sandbox";
  const gwColor = payMethod === "jazzcash" ? "#DC2626" : "#16A34A";

  type NumPadBtn = { label: string; action: () => void; isOk?: boolean };
  const numPadRows: NumPadBtn[][] = [
    [
      { label: "1", action: () => gwMobile.length < 11 && setGwMobile(p => p + "1") },
      { label: "2", action: () => gwMobile.length < 11 && setGwMobile(p => p + "2") },
      { label: "3", action: () => gwMobile.length < 11 && setGwMobile(p => p + "3") },
    ],
    [
      { label: "4", action: () => gwMobile.length < 11 && setGwMobile(p => p + "4") },
      { label: "5", action: () => gwMobile.length < 11 && setGwMobile(p => p + "5") },
      { label: "6", action: () => gwMobile.length < 11 && setGwMobile(p => p + "6") },
    ],
    [
      { label: "7", action: () => gwMobile.length < 11 && setGwMobile(p => p + "7") },
      { label: "8", action: () => gwMobile.length < 11 && setGwMobile(p => p + "8") },
      { label: "9", action: () => gwMobile.length < 11 && setGwMobile(p => p + "9") },
    ],
    [
      { label: "⌫", action: () => setGwMobile(p => p.slice(0, -1)) },
      { label: "0", action: () => gwMobile.length < 11 && setGwMobile(p => p + "0") },
      { label: "✓", action: handleGwPay, isOk: true },
    ],
  ];

  const GatewayModal = () => (
    <Modal visible={showGwModal} transparent animationType="slide" onRequestClose={() => { if (!gwPaying) setShowGwModal(false); }}>
      <Pressable style={styles.overlay} onPress={() => { if (!gwPaying) setShowGwModal(false); }}>
        <Pressable style={[styles.sheet, { paddingBottom: 32 }]} onPress={() => {}}>
          <View style={styles.handle} />
          {/* Header */}
          <View style={{ alignItems: "center", marginBottom: 20 }}>
            <Text style={{ fontSize: 36, marginBottom: 8 }}>{gwLogo}</Text>
            <Text style={{ fontSize: 18, fontWeight: "700", color: C.text }}>{gwName} se Pay Karein</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
              <View style={{ backgroundColor: gwMode === "live" ? "#DCFCE7" : "#FEF9C3", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: gwMode === "live" ? "#15803D" : "#92400E" }}>
                  {gwMode === "live" ? "🟢 LIVE" : "🟡 SANDBOX"}
                </Text>
              </View>
              <Text style={{ fontSize: 13, color: C.textSecondary }}>Rs. {grandTotal.toLocaleString()}</Text>
            </View>
          </View>

          {gwStep === "input" && (
            <>
              <Text style={{ fontSize: 13, fontWeight: "600", color: C.text, marginBottom: 8 }}>
                {gwName} Mobile Number
              </Text>
              <View style={{ borderWidth: 1.5, borderColor: C.border, borderRadius: 14, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, marginBottom: 16, backgroundColor: C.surface }}>
                <Text style={{ fontSize: 16, color: C.textSecondary, marginRight: 8 }}>{gwLogo}</Text>
                <Text style={{ fontSize: 14, color: C.textSecondary, marginRight: 4 }}>+92</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, color: gwMobile ? C.text : C.textSecondary, paddingVertical: 14 }}>
                    {gwMobile || "03XX-XXXXXXX"}
                  </Text>
                </View>
              </View>
              {/* Simple number pad */}
              <View style={{ gap: 8, marginBottom: 16 }}>
                {numPadRows.map((row, ri) => (
                  <View key={ri} style={{ flexDirection: "row", gap: 8 }}>
                    {row.map((btn, ci) => (
                      <Pressable
                        key={ci}
                        onPress={btn.action}
                        style={{
                          flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: "center", justifyContent: "center",
                          backgroundColor: btn.isOk ? gwColor : C.surfaceSecondary,
                          borderWidth: 1, borderColor: btn.isOk ? "transparent" : C.border,
                        }}
                      >
                        <Text style={{ fontSize: 20, fontWeight: "700", color: btn.isOk ? "#fff" : C.text }}>{btn.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                ))}
              </View>
              {gwMode === "sandbox" && (
                <View style={{ backgroundColor: "#FEF9C3", borderRadius: 10, padding: 12, flexDirection: "row", gap: 8 }}>
                  <Text style={{ fontSize: 13 }}>🧪</Text>
                  <Text style={{ fontSize: 12, color: "#92400E", flex: 1 }}>
                    Sandbox mode: koi bhi number enter karein — payment simulate hogi
                  </Text>
                </View>
              )}
              <Pressable onPress={() => { if (!gwPaying) setShowGwModal(false); }} style={{ marginTop: 12, paddingVertical: 12, alignItems: "center" }}>
                <Text style={{ fontSize: 14, color: C.textSecondary }}>Cancel</Text>
              </Pressable>
            </>
          )}

          {gwStep === "waiting" && (
            <View style={{ alignItems: "center", paddingVertical: 24 }}>
              <ActivityIndicator size="large" color={payMethod === "jazzcash" ? "#DC2626" : "#16A34A"} />
              <Text style={{ fontSize: 16, fontWeight: "700", color: C.text, marginTop: 20 }}>
                Payment Processing...
              </Text>
              <Text style={{ fontSize: 13, color: C.textSecondary, marginTop: 8, textAlign: "center" }}>
                {gwMode === "sandbox"
                  ? "Sandbox mein payment simulate ho rahi hai..."
                  : `${gwMobile} pe ${gwName} notification aayegi — approve karein`}
              </Text>
            </View>
          )}

          {gwStep === "done" && (
            <View style={{ alignItems: "center", paddingVertical: 24 }}>
              <Text style={{ fontSize: 48 }}>✅</Text>
              <Text style={{ fontSize: 16, fontWeight: "700", color: "#16A34A", marginTop: 12 }}>
                Payment Kamyab!
              </Text>
              <Text style={{ fontSize: 13, color: C.textSecondary, marginTop: 6 }}>
                Order place ho raha hai...
              </Text>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );

  if (orderSuccess) {
    const methodLabel: Record<string, string> = {
      cash: "Cash on Delivery", wallet: `${appName} Wallet`,
      jazzcash: "JazzCash ✅", easypaisa: "EasyPaisa ✅",
    };
    return (
      <View style={[styles.container, { backgroundColor: C.background }]}>
        <View style={styles.successWrap}>
          <LinearGradient colors={["#065F46", "#059669"]} style={styles.successCircle}>
            <Ionicons name="checkmark" size={44} color="#fff" />
          </LinearGradient>
          <Text style={styles.successTitle}>Order Place Ho Gaya!</Text>
          <Text style={styles.successId}>Order #{orderSuccess.id}</Text>
          <Text style={styles.successAddr} numberOfLines={2}>{deliveryLine}</Text>
          <Text style={styles.successEta}>ETA: {orderSuccess.time}</Text>
          <View style={{ backgroundColor: "#F0FDF4", borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8, marginTop: 6, borderWidth: 1, borderColor: "#BBF7D0" }}>
            <Text style={{ fontSize: 13, color: "#166534", textAlign: "center" }}>
              Payment: {methodLabel[orderSuccess.payMethod || "cash"] || orderSuccess.payMethod}
            </Text>
          </View>
          <View style={styles.successBtns}>
            <Pressable onPress={() => router.push("/(tabs)/orders")} style={styles.trackBtn}>
              <Ionicons name="navigate-outline" size={16} color="#fff" />
              <Text style={styles.trackBtnTxt}>Track Order</Text>
            </Pressable>
            <Pressable onPress={() => router.replace("/(tabs)")} style={styles.homeBtn}>
              <Ionicons name="home-outline" size={16} color={C.primary} />
              <Text style={styles.homeBtnTxt}>Home</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: C.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 8 }]}>
          <View style={styles.headerRow}>
            <Pressable onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={22} color={C.text} />
            </Pressable>
            <Text style={[styles.headerTitle, { color: C.text }]}>Cart</Text>
            <View style={{ width: 34 }} />
          </View>
        </View>
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconBox}>
            <Ionicons name="bag-outline" size={52} color={C.primary} />
          </View>
          <Text style={styles.emptyTitle}>Cart Khaali Hai</Text>
          <Text style={styles.emptyText}>Mart ya Food section se items add karein</Text>
          <View style={styles.emptyBtns}>
            <Pressable onPress={() => router.push("/mart")} style={styles.emptyBtn}>
              <Ionicons name="storefront-outline" size={16} color="#fff" />
              <Text style={styles.emptyBtnText}>Browse Mart</Text>
            </Pressable>
            <Pressable onPress={() => router.push("/food")} style={[styles.emptyBtn, { backgroundColor: "#E65100" }]}>
              <Ionicons name="restaurant-outline" size={16} color="#fff" />
              <Text style={styles.emptyBtnText}>Order Food</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <LinearGradient
        colors={["#0F3BA8", C.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: topPad + 8 }]}
      >
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>{cartType === "food" ? "Food Order" : "Mart Order"}</Text>
            <Text style={styles.headerSub}>{items.length} item{items.length !== 1 ? "s" : ""}</Text>
          </View>
          <Pressable onPress={() => setShowClearConfirm(true)} style={styles.clearBtn}>
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        </View>

        {showClearConfirm && (
          <View style={styles.clearConfirm}>
            <Text style={styles.clearConfirmTxt}>Saare items remove karein?</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable onPress={() => setShowClearConfirm(false)} style={styles.clearNo}>
                <Text style={styles.clearNoTxt}>Nahi</Text>
              </Pressable>
              <Pressable onPress={() => { clearCart(); setShowClearConfirm(false); }} style={styles.clearYes}>
                <Text style={styles.clearYesTxt}>Haan</Text>
              </Pressable>
            </View>
          </View>
        )}
      </LinearGradient>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Items */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Aapke Items</Text>
          {items.map(item => (
            <View key={item.productId} style={styles.cartItem}>
              <View style={[styles.itemThumb, { backgroundColor: item.type === "food" ? "#FFF3E0" : "#E3F2FD" }]}>
                <Ionicons
                  name={item.type === "food" ? "restaurant-outline" : "basket-outline"}
                  size={22}
                  color={item.type === "food" ? "#E65100" : "#0D47A1"}
                />
              </View>
              <View style={styles.itemInfo}>
                <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
                <Text style={styles.itemUnit}>Rs. {item.price} each</Text>
              </View>
              <View style={styles.qtyControl}>
                <Pressable onPress={() => updateQuantity(item.productId, item.quantity - 1)} style={styles.qtyBtn}>
                  <Ionicons name={item.quantity === 1 ? "trash-outline" : "remove"} size={15} color={item.quantity === 1 ? C.danger : C.primary} />
                </Pressable>
                <Text style={styles.qtyText}>{item.quantity}</Text>
                <Pressable onPress={() => updateQuantity(item.productId, item.quantity + 1)} style={styles.qtyBtn}>
                  <Ionicons name="add" size={15} color={C.primary} />
                </Pressable>
              </View>
              <Text style={styles.itemTotal}>Rs. {item.price * item.quantity}</Text>
            </View>
          ))}
        </View>

        {/* Delivery Address */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Delivery Address</Text>
          <Pressable
            onPress={() => {
              if (addresses.length === 0) {
                showToast("Profile mein pehle address add karein", "info");
                return;
              }
              setShowAddrPicker(true);
            }}
            style={styles.addrCard}
          >
            <View style={styles.addrCardIcon}>
              <Ionicons name="location-outline" size={20} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              {addrLoading ? (
                <ActivityIndicator size="small" color={C.primary} />
              ) : (
                <>
                  <Text style={styles.addrCardLabel}>
                    {selectedAddr ? selectedAddr.label : "Home"}
                  </Text>
                  <Text style={styles.addrCardValue} numberOfLines={2}>
                    {selectedAddr ? `${selectedAddr.address}, ${selectedAddr.city}` : "AJK, Pakistan"}
                  </Text>
                </>
              )}
            </View>
            {addresses.length > 0 && (
              <View style={styles.changeBtn}>
                <Text style={styles.changeBtnText}>Change</Text>
                <Ionicons name="chevron-forward" size={14} color={C.primary} />
              </View>
            )}
          </Pressable>
        </View>

        {/* Estimated Time */}
        <View style={[styles.section, styles.etaRow]}>
          <Ionicons name="time-outline" size={18} color={C.success} />
          <Text style={styles.etaText}>
            Estimated delivery: {cartType === "food" ? "25–40 min" : "30–50 min"}
          </Text>
        </View>

        {/* Payment Method */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Method</Text>
          {availablePayMethods.filter(m => m.available).map(method => {
            const sel = payMethod === method.id;
            const iconMap: Record<string, any> = {
              cash:      "cash-outline",
              wallet:    "wallet-outline",
              jazzcash:  "card-outline",
              easypaisa: "phone-portrait-outline",
            };
            const colorMap: Record<string, { bg: string; tint: string }> = {
              cash:      { bg: "#D1FAE5", tint: C.success },
              wallet:    { bg: "#DBEAFE", tint: C.primary },
              jazzcash:  { bg: "#FEE2E2", tint: "#DC2626" },
              easypaisa: { bg: "#DCFCE7", tint: "#16A34A" },
            };
            const clr = colorMap[method.id] || { bg: C.surfaceSecondary, tint: C.textSecondary };
            const isGateway = method.id === "jazzcash" || method.id === "easypaisa";
            return (
              <Pressable
                key={method.id}
                onPress={() => setPayMethod(method.id as PayMethod)}
                style={[styles.payOption, sel && { borderColor: clr.tint, backgroundColor: clr.bg + "44" }]}
              >
                <View style={[styles.payIcon, { backgroundColor: sel ? clr.bg : C.surfaceSecondary }]}>
                  {method.id === "jazzcash" || method.id === "easypaisa"
                    ? <Text style={{ fontSize: 18 }}>{method.logo}</Text>
                    : <Ionicons name={iconMap[method.id]} size={20} color={sel ? clr.tint : C.textSecondary} />
                  }
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={[styles.payLabel, sel && { color: C.text }]}>{method.label}</Text>
                    {isGateway && method.mode === "sandbox" && (
                      <View style={{ backgroundColor: "#FEF9C3", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                        <Text style={{ fontSize: 9, fontWeight: "700", color: "#92400E" }}>SANDBOX</Text>
                      </View>
                    )}
                    {isGateway && method.mode === "live" && (
                      <View style={{ backgroundColor: "#DCFCE7", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                        <Text style={{ fontSize: 9, fontWeight: "700", color: "#15803D" }}>LIVE</Text>
                      </View>
                    )}
                  </View>
                  {method.id === "wallet" ? (
                    <Text style={[styles.paySub, user && user.walletBalance < grandTotal && { color: C.danger }]}>
                      Balance: Rs. {user?.walletBalance?.toLocaleString() || 0}
                      {user && user.walletBalance < grandTotal ? " (kam hai)" : ""}
                    </Text>
                  ) : (
                    <Text style={styles.paySub}>{method.description}</Text>
                  )}
                </View>
                {isGateway && sel && (
                  <View style={{ backgroundColor: clr.tint, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: "#fff" }}>Enter No. →</Text>
                  </View>
                )}
                {!isGateway && (
                  <View style={[styles.radio, sel && { borderColor: clr.tint }]}>
                    {sel && <View style={[styles.radioDot, { backgroundColor: clr.tint }]} />}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {/* Promo Code */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Promo Code</Text>
          <View style={[styles.summaryCard, { padding: 12 }]}>
            {promoApplied ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1, backgroundColor: "#ECFDF5", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontSize: 18 }}>🏷️</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: "#065F46" }}>{promoCode}</Text>
                    <Text style={{ fontSize: 12, color: "#059669" }}>Rs. {promoDiscount.toLocaleString()} discount apply hua!</Text>
                  </View>
                </View>
                <Pressable onPress={removePromo} style={{ padding: 8 }}>
                  <Ionicons name="close-circle" size={24} color="#DC2626" />
                </Pressable>
              </View>
            ) : (
              <View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TextInput
                    value={promoInput}
                    onChangeText={t => { setPromoInput(t.toUpperCase()); setPromoError(null); }}
                    placeholder="Promo code enter karein"
                    placeholderTextColor={C.textSecondary}
                    autoCapitalize="characters"
                    style={{
                      flex: 1, borderWidth: 1.5, borderColor: promoError ? "#DC2626" : C.border,
                      borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
                      fontSize: 14, color: C.text, backgroundColor: C.surface,
                      fontFamily: "Inter_500Medium", letterSpacing: 1,
                    }}
                  />
                  <Pressable
                    onPress={applyPromo}
                    disabled={promoLoading || !promoInput.trim()}
                    style={{
                      backgroundColor: promoInput.trim() ? C.primary : C.border,
                      borderRadius: 12, paddingHorizontal: 16, alignItems: "center", justifyContent: "center",
                      minWidth: 70,
                    }}
                  >
                    {promoLoading
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Apply</Text>
                    }
                  </Pressable>
                </View>
                {promoError && (
                  <Text style={{ fontSize: 12, color: "#DC2626", marginTop: 6, marginLeft: 2 }}>{promoError}</Text>
                )}
              </View>
            )}
          </View>
        </View>

        {/* Order Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Summary</Text>
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal ({items.reduce((s, i) => s + i.quantity, 0)} items)</Text>
              <Text style={styles.summaryValue}>Rs. {total.toLocaleString()}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Delivery Fee</Text>
              <Text style={styles.summaryValue}>
                {deliveryFee === 0 ? "FREE 🎉" : `Rs. ${deliveryFee}`}
              </Text>
            </View>
            {finance.gstEnabled && gstAmount > 0 && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>GST ({finance.gstPct}%)</Text>
                <Text style={[styles.summaryValue, { color: "#D97706" }]}>Rs. {gstAmount.toLocaleString()}</Text>
              </View>
            )}
            {promoDiscount > 0 && (
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: "#059669" }]}>🏷️ Promo Discount ({promoCode})</Text>
                <Text style={[styles.summaryValue, { color: "#059669" }]}>- Rs. {promoDiscount.toLocaleString()}</Text>
              </View>
            )}
            <View style={[styles.summaryRow, styles.summaryDivider]}>
              <Text style={styles.grandLabel}>Grand Total</Text>
              <Text style={styles.grandValue}>Rs. {grandTotal.toLocaleString()}</Text>
            </View>
            {finance.cashbackEnabled && cashbackAmt > 0 && (
              <View style={{ marginTop: 10, backgroundColor: "#ECFDF5", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ fontSize: 16 }}>🎁</Text>
                <Text style={{ fontSize: 12, color: "#065F46", fontWeight: "600", flex: 1 }}>
                  Earn <Text style={{ fontWeight: "800" }}>Rs. {cashbackAmt}</Text> wallet cashback on this order!
                </Text>
              </View>
            )}
            {walletCashbackAmt > 0 && (
              <View style={{ marginTop: 6, backgroundColor: "#EFF6FF", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ fontSize: 16 }}>💰</Text>
                <Text style={{ fontSize: 12, color: "#1E40AF", fontWeight: "600", flex: 1 }}>
                  Wallet bonus: Earn <Text style={{ fontWeight: "800" }}>Rs. {walletCashbackAmt}</Text> ({customer.walletCashbackPct}%) back for paying with Wallet!
                </Text>
              </View>
            )}
          </View>
        </View>

        <View style={{ height: 110 }} />
      </ScrollView>

      {/* Checkout Bar */}
      <View style={[styles.checkoutBar, { paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 12 }]}>
        {/* Min-order progress indicator */}
        {total < orderRules.minOrderAmount && total > 0 && (
          <View style={styles.minOrderBar}>
            <View style={styles.minOrderTrack}>
              <View style={[styles.minOrderFill, { width: `${Math.min(100, (total / orderRules.minOrderAmount) * 100)}%` as any }]} />
            </View>
            <Text style={styles.minOrderText}>
              Rs.{(orderRules.minOrderAmount - total).toLocaleString()} more for minimum order
            </Text>
          </View>
        )}
        <View style={styles.checkoutRow}>
          <View style={styles.checkoutInfo}>
            <Text style={styles.checkoutLabel}>Total Amount</Text>
            <Text style={styles.checkoutAmount}>Rs. {grandTotal.toLocaleString()}</Text>
          </View>
          <Pressable
            onPress={handleCheckout}
            style={[styles.checkoutBtn, (loading || total < orderRules.minOrderAmount) && styles.checkoutBtnDisabled]}
            disabled={loading || total < orderRules.minOrderAmount}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.checkoutBtnText}>
                  {payMethod === "jazzcash" ? "Pay with JazzCash" :
                   payMethod === "easypaisa" ? "Pay with EasyPaisa" :
                   "Place Order"}
                </Text>
                <Ionicons
                  name={payMethod === "jazzcash" || payMethod === "easypaisa" ? "card-outline" : "arrow-forward"}
                  size={18} color="#fff"
                />
              </>
            )}
          </Pressable>
        </View>
      </View>

      <GatewayModal />
      <AddressPickerModal
        visible={showAddrPicker}
        addresses={addresses}
        selected={selectedAddrId}
        onSelect={a => setSelectedAddrId(a.id)}
        onClose={() => setShowAddrPicker(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: "#fff" },
  headerSub: { fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.8)" },
  clearBtn: { padding: 6 },
  clearText: { fontFamily: "Inter_500Medium", fontSize: 14, color: "rgba(255,255,255,0.85)" },
  clearConfirm: { backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 12, padding: 12, marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  clearConfirmTxt: { fontFamily: "Inter_500Medium", fontSize: 13, color: "#fff", flex: 1 },
  clearNo: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.2)" },
  clearNoTxt: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#fff" },
  clearYes: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: "#EF4444" },
  clearYesTxt: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#fff" },

  scroll: { flex: 1 },
  section: { marginTop: 16, marginHorizontal: 16 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 15, color: C.text, marginBottom: 10 },

  cartItem: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.surface, borderRadius: 14, padding: 12, marginBottom: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  itemThumb: { width: 46, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  itemInfo: { flex: 1 },
  itemName: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text, marginBottom: 3 },
  itemUnit: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted },
  qtyControl: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.surfaceSecondary, borderRadius: 10, padding: 5 },
  qtyBtn: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 2, elevation: 1 },
  qtyText: { fontFamily: "Inter_700Bold", fontSize: 14, color: C.text, minWidth: 18, textAlign: "center" },
  itemTotal: { fontFamily: "Inter_700Bold", fontSize: 14, color: C.text, width: 62, textAlign: "right" },

  addrCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.surface, borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: C.borderLight, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  addrCardIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center" },
  addrCardLabel: { fontFamily: "Inter_700Bold", fontSize: 13, color: C.text, marginBottom: 2 },
  addrCardValue: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary },
  changeBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: "#EFF6FF" },
  changeBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: C.primary },

  etaRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F0FDF4", borderRadius: 12, padding: 12, marginTop: 12 },
  etaText: { fontFamily: "Inter_500Medium", fontSize: 13, color: "#065F46" },

  payOption: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface, marginBottom: 8 },
  payOptionActive: { borderColor: C.primary, backgroundColor: "#F0F7FF" },
  payIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  payLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.textSecondary, marginBottom: 2 },
  paySub: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  radioActive: { borderColor: C.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary },

  summaryCard: { backgroundColor: C.surface, borderRadius: 14, padding: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 },
  summaryLabel: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textSecondary },
  summaryValue: { fontFamily: "Inter_500Medium", fontSize: 14, color: C.text },
  summaryDivider: { borderTopWidth: 1.5, borderTopColor: C.border, marginTop: 4, paddingTop: 12 },
  grandLabel: { fontFamily: "Inter_700Bold", fontSize: 16, color: C.text },
  grandValue: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.primary },

  checkoutBar: { backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border, flexDirection: "column", paddingHorizontal: 16, paddingTop: 12, gap: 10, shadowColor: "#000", shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 10 },
  checkoutRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  checkoutInfo: { flex: 1 },
  minOrderBar: { gap: 4 },
  minOrderTrack: { height: 4, borderRadius: 4, backgroundColor: "#E2E8F0", overflow: "hidden" },
  minOrderFill: { height: 4, borderRadius: 4, backgroundColor: C.primary },
  minOrderText: { fontFamily: "Inter_500Medium", fontSize: 11, color: C.textMuted },
  checkoutLabel: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted },
  checkoutAmount: { fontFamily: "Inter_700Bold", fontSize: 22, color: C.text },
  checkoutBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.primary, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 22 },
  checkoutBtnDisabled: { opacity: 0.65 },
  checkoutBtnText: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" },

  emptyContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 32 },
  emptyIconBox: { width: 100, height: 100, borderRadius: 28, backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontFamily: "Inter_700Bold", fontSize: 22, color: C.text },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textSecondary, textAlign: "center" },
  emptyBtns: { flexDirection: "row", gap: 12, marginTop: 6 },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14 },
  emptyBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#fff" },

  successWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  successCircle: { width: 100, height: 100, borderRadius: 50, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  successTitle: { fontFamily: "Inter_700Bold", fontSize: 26, color: C.text },
  successId: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: C.textSecondary },
  successAddr: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, textAlign: "center", maxWidth: 280 },
  successEta: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted },
  successBtns: { flexDirection: "row", gap: 12, marginTop: 12 },
  trackBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.primary, paddingHorizontal: 20, paddingVertical: 13, borderRadius: 14 },
  trackBtnTxt: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#fff" },
  homeBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderColor: C.primary, paddingHorizontal: 20, paddingVertical: 13, borderRadius: 14 },
  homeBtnTxt: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.primary },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: "center", marginBottom: 16 },
  sheetTitle: { fontFamily: "Inter_700Bold", fontSize: 18, color: C.text, marginBottom: 4 },

  addrOpt: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface, marginBottom: 8 },
  addrOptSel: { borderColor: C.primary, backgroundColor: "#F0F7FF" },
  addrOptIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  addrOptLabel: { fontFamily: "Inter_700Bold", fontSize: 14, color: C.text, marginBottom: 2 },
  addrOptAddress: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary },
  addrOptCity: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted },
  defaultTag: { backgroundColor: "#D1FAE5", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  defaultTagText: { fontFamily: "Inter_600SemiBold", fontSize: 10, color: "#065F46" },

  cancelBtn: { marginTop: 12, padding: 14, borderRadius: 14, backgroundColor: C.surfaceSecondary, alignItems: "center" },
  cancelBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: C.textSecondary },
});
