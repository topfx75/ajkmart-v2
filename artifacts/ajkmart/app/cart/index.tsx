import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Location from "expo-location";
import React, { useState, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { API_BASE } from "@/utils/api";

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
  visible, addresses, selected, onSelect, onClose,
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
          <Text style={styles.sheetTitle}>Choose Delivery Address</Text>
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
          <Pressable onPress={() => { onClose(); router.push({ pathname: "/(tabs)/profile", params: { section: "addresses" } }); }} style={[styles.addrOpt, { borderColor: C.primary, borderStyle: "dashed", marginTop: 8 }]}>
            <View style={[styles.addrOptIcon, { backgroundColor: "#DBEAFE" }]}>
              <Ionicons name="add-outline" size={20} color={C.primary} />
            </View>
            <Text style={[styles.addrOptLabel, { color: C.primary }]}>Add New Address</Text>
          </Pressable>
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
    { id: "cash",   label: "Cash on Delivery",    logo: "💵", available: true,  description: "Pay on delivery" },
    { id: "wallet", label: `${appName} Wallet`,   logo: "💰", available: true,  description: "Instant pay from wallet" },
  ]);

  const [promoInput, setPromoInput] = useState("");
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoApplied, setPromoApplied] = useState(false);

  const [showGwModal, setShowGwModal] = useState(false);
  const [gwMobile, setGwMobile] = useState("");
  const [gwPaying, setGwPaying] = useState(false);
  const [gwStep, setGwStep] = useState<"input" | "waiting" | "done">("input");

  const mountedRef = useRef(true);
  const gwPollRef = useRef<{ active: boolean; intervalId?: ReturnType<typeof setInterval> }>({ active: false });
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      gwPollRef.current.active = false;
      if (gwPollRef.current.intervalId) clearInterval(gwPollRef.current.intervalId);
    };
  }, []);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const deliveryFeeConfig = platformConfig.deliveryFee;
  const freeDeliveryAbove = platformConfig.deliveryFee.freeDeliveryAbove;
  const freeDeliveryEnabled = platformConfig.deliveryFee.freeEnabled;

  useEffect(() => {
    fetch(`${API_BASE}/platform-config`)
      .then(r => r.json())
      .then(d => {
        if (d.payment?.methods) {
          const methods: PaymentMethod[] = d.payment.methods.map((m: any) => ({
            id: m.id, label: m.label, logo: m.logo,
            available: m.available, description: m.description, mode: m.mode,
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

  const availablePayMethods = allPayMethods.map(m => {
    if (m.id === "cash" && grandTotal > orderRules.maxCodAmount) {
      return { ...m, available: false, description: `COD limit: Rs.${orderRules.maxCodAmount.toLocaleString()}` };
    }
    return m;
  });

  useEffect(() => {
    if (payMethod === "cash" && grandTotal > orderRules.maxCodAmount) {
      const fallback = availablePayMethods.find(m => m.id !== "cash" && m.available);
      if (fallback) setPayMethod(fallback.id as PayMethod);
    }
  }, [grandTotal, orderRules.maxCodAmount, payMethod]);

  const selectedAddr = addresses.find(a => a.id === selectedAddrId);
  const deliveryLine = selectedAddr
    ? `${selectedAddr.label} — ${selectedAddr.address}, ${selectedAddr.city}`
    : "";

  useEffect(() => {
    if (!user?.id) return;
    setAddrLoading(true);
    fetch(`${API_BASE}/addresses`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
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

  const cartFingerprint = items.map(i => `${i.productId}:${i.quantity}:${i.price}`).join("|") + "|" + cartType;
  useEffect(() => {
    if (promoApplied && promoCode) {
      revalidatePromo(promoCode);
    }
  }, [cartFingerprint]);

  const revalidatePromo = async (code: string) => {
    try {
      const orderType = (cartType === "mixed" || cartType === "pharmacy" || cartType === "none") ? "mart" : cartType;
      const res = await fetch(`${API_BASE}/orders/validate-promo?code=${encodeURIComponent(code)}&total=${total}&type=${orderType}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (data.valid) {
        setPromoDiscount(data.discount);
      } else {
        setPromoCode(null);
        setPromoDiscount(0);
        setPromoApplied(false);
        showToast("Promo code is no longer valid — removed", "error");
      }
    } catch {
      showToast("Could not verify promo code — please try again", "error");
      setPromoCode(null);
      setPromoDiscount(0);
      setPromoApplied(false);
    }
  };

  const applyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    setPromoLoading(true);
    setPromoError(null);
    try {
      const orderType = (cartType === "mixed" || cartType === "pharmacy" || cartType === "none") ? "mart" : cartType;
      const res = await fetch(`${API_BASE}/orders/validate-promo?code=${encodeURIComponent(code)}&total=${total}&type=${orderType}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (data.valid) {
        setPromoCode(code);
        setPromoDiscount(data.discount);
        setPromoApplied(true);
        setPromoError(null);
        showToast(`Promo code applied! Rs. ${data.discount} discount received`, "success");
      } else {
        setPromoCode(null);
        setPromoDiscount(0);
        setPromoApplied(false);
        setPromoError(data.error || "Invalid promo code");
      }
    } catch {
      setPromoError("Network error — please try again");
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

  const placeOrder = async (finalPayMethod: PayMethod) => {
    const order = await createOrder({
      type: cartType === "mixed" ? "mart" : cartType,
      items: items.map(i => ({
        productId: i.productId, name: i.name,
        price: i.price, quantity: i.quantity, image: i.image,
      })),
      deliveryAddress: deliveryLine,
      paymentMethod: finalPayMethod,
      ...(promoCode ? { promoCode } : {}),
    } as any);
    if (finalPayMethod === "wallet") {
      updateUser({ walletBalance: (user!.walletBalance ?? 0) - grandTotal });
    }

    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        await fetch(`${API_BASE}/locations/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            latitude: pos.coords.latitude, longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? null, role: "customer", action: "order_placed",
          }),
        });
      } catch (locErr) {
        if (__DEV__) console.warn("[location] order placement update failed:", locErr);
        Alert.alert(
          "Location Update Failed",
          "Your order was placed successfully, but we could not update your location for tracking. Please ensure location permissions are enabled.",
          [{ text: "OK" }]
        );
      }
    })();

    clearCart();
    setOrderSuccess({
      id: (order as any).id?.slice(-6).toUpperCase() || "------",
      time: (order as any).estimatedTime || "30-45 min",
      payMethod: finalPayMethod,
    });
  };

  const handleCheckout = async () => {
    if (loading) return;
    if (!user) { showToast("Please log in to place an order", "error"); return; }
    if (items.length === 0) { showToast("Your cart is empty", "error"); return; }
    if (cartType === "pharmacy") { router.push("/pharmacy"); return; }
    if (!deliveryLine) {
      showToast("Please select a delivery address", "error");
      setShowAddrPicker(true);
      return;
    }
    if (total < orderRules.minOrderAmount) {
      showToast(`Minimum order Rs.${orderRules.minOrderAmount} — add Rs.${orderRules.minOrderAmount - total} more`, "error");
      return;
    }
    if (total > orderRules.maxCartValue) {
      showToast(`Cart value cannot exceed Rs.${orderRules.maxCartValue.toLocaleString()}`, "error");
      return;
    }

    if (payMethod === "wallet") {
      if ((user.walletBalance ?? 0) < grandTotal) {
        showToast(`Wallet has Rs. ${user.walletBalance} — Rs. ${grandTotal} required`, "error");
        return;
      }
      setLoading(true);
      try { await placeOrder("wallet"); }
      catch (e: any) { showToast(e.message || "Could not place order.", "error"); }
      setLoading(false);
      return;
    }

    if (payMethod === "jazzcash" || payMethod === "easypaisa") {
      setGwStep("input");
      setGwMobile("");
      setShowGwModal(true);
      return;
    }

    setLoading(true);
    try { await placeOrder("cash"); }
    catch (e: any) { showToast(e.message || "Could not place order. Please try again.", "error"); }
    setLoading(false);
  };

  const handleGwPay = async () => {
    if (!gwMobile || gwMobile.replace(/\D/g, "").length < 10) {
      showToast("Please enter a valid mobile number (03XX-XXXXXXX)", "error");
      return;
    }
    setGwPaying(true);
    setGwStep("waiting");
    try {
      const order = await createOrder({
        type: cartType === "mixed" ? "mart" : cartType,
        items: items.map(i => ({
          productId: i.productId, name: i.name,
          price: i.price, quantity: i.quantity, image: i.image,
        })),
        deliveryAddress: deliveryLine,
        paymentMethod: payMethod,
        ...(promoCode ? { promoCode } : {}),
      } as any);
      const realOrderId = (order as any).id;
      if (!realOrderId) throw new Error("Could not create order");

      const r = await fetch(`${API_BASE}/payments/initiate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          gateway: payMethod, amount: grandTotal,
          orderId: realOrderId, mobileNumber: gwMobile.replace(/\D/g, ""),
        }),
      });
      const data = await r.json() as any;
      if (!r.ok) {
        await cancelPendingOrder(realOrderId);
        throw new Error(data.error || "Could not initiate payment");
      }

      const isSandbox = data.mode === "sandbox";
      if (isSandbox) {
        await new Promise(res => setTimeout(res, 2200));
        setGwStep("done");
        await new Promise(res => setTimeout(res, 800));
        clearCart();
        setOrderSuccess({
          id: realOrderId.slice(-6).toUpperCase(),
          time: (order as any).estimatedTime || "30-45 min",
          payMethod,
        });
        setShowGwModal(false);
      } else {
        const txnRef = data.txnRef || data.transactionRef || realOrderId;
        const POLL_INTERVAL = 4000;
        const MAX_POLL_TIME = 120000;
        const startTime = Date.now();
        gwPollRef.current.active = true;

        await new Promise<void>((resolve, reject) => {
          const intervalId = setInterval(async () => {
            if (!gwPollRef.current.active) {
              clearInterval(intervalId);
              gwPollRef.current.intervalId = undefined;
              resolve();
              return;
            }
            if (Date.now() - startTime >= MAX_POLL_TIME) {
              clearInterval(intervalId);
              gwPollRef.current.active = false;
              gwPollRef.current.intervalId = undefined;
              await cancelPendingOrder(realOrderId);
              reject(new Error("Payment timeout — no response in 2 minutes. Please check your account or contact support if charged."));
              return;
            }
            try {
              const statusRes = await fetch(`${API_BASE}/payments/status/${encodeURIComponent(txnRef)}`);
              const statusData = await statusRes.json() as any;
              if (statusData.status === "completed" || statusData.status === "success") {
                clearInterval(intervalId);
                gwPollRef.current.active = false;
                gwPollRef.current.intervalId = undefined;
                if (!mountedRef.current) { resolve(); return; }
                setGwStep("done");
                await new Promise(r => setTimeout(r, 600));
                if (!mountedRef.current) { resolve(); return; }
                clearCart();
                setOrderSuccess({
                  id: realOrderId.slice(-6).toUpperCase(),
                  time: (order as any).estimatedTime || "30-45 min",
                  payMethod,
                });
                setShowGwModal(false);
                resolve();
              } else if (statusData.status === "failed" || statusData.status === "expired") {
                clearInterval(intervalId);
                gwPollRef.current.active = false;
                gwPollRef.current.intervalId = undefined;
                await cancelPendingOrder(realOrderId);
                reject(new Error(statusData.message || "Payment failed"));
              }
            } catch (pollErr: any) {
              if (pollErr.message && pollErr.message !== "Failed to fetch") {
                clearInterval(intervalId);
                gwPollRef.current.active = false;
                gwPollRef.current.intervalId = undefined;
                reject(pollErr);
              }
            }
          }, POLL_INTERVAL);
          gwPollRef.current.intervalId = intervalId;
        });
      }
    } catch (e: any) {
      showToast(e.message || "Payment failed. Please try again.", "error");
      setGwStep("input");
    }
    setGwPaying(false);
  };

  const cancelPendingOrder = async (orderId: string) => {
    try {
      const res = await fetch(`${API_BASE}/orders/${orderId}/cancel`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ reason: "payment_failed" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not cancel order");
      }
    } catch (err: any) {
      showToast(err.message || "Your order could not be cancelled — please contact support", "error");
    }
  };

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
          <View style={{ alignItems: "center", marginBottom: 20 }}>
            <Text style={{ fontSize: 36, marginBottom: 8 }}>{gwLogo}</Text>
            <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: C.text }}>Pay with {gwName}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
              <View style={{ backgroundColor: gwMode === "live" ? "#DCFCE7" : "#FEF9C3", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: gwMode === "live" ? "#15803D" : "#92400E" }}>
                  {gwMode === "live" ? "🟢 LIVE" : "🟡 SANDBOX"}
                </Text>
              </View>
              <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary }}>Rs. {grandTotal.toLocaleString()}</Text>
            </View>
          </View>

          {gwStep === "input" && (
            <>
              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.text, marginBottom: 8 }}>
                {gwName} Mobile Number
              </Text>
              <View style={{ borderWidth: 1.5, borderColor: C.border, borderRadius: 14, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, marginBottom: 16, backgroundColor: C.surfaceSecondary }}>
                <Text style={{ fontSize: 16, color: C.textSecondary, marginRight: 8 }}>{gwLogo}</Text>
                <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: C.textSecondary, marginRight: 4 }}>+92</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontFamily: "Inter_500Medium", color: gwMobile ? C.text : C.textSecondary, paddingVertical: 14 }}>
                    {gwMobile || "03XX-XXXXXXX"}
                  </Text>
                </View>
              </View>
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
                        <Text style={{ fontSize: 20, fontFamily: "Inter_700Bold", color: btn.isOk ? "#fff" : C.text }}>{btn.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                ))}
              </View>
              {gwMode === "sandbox" && (
                <View style={{ backgroundColor: "#FEF9C3", borderRadius: 12, padding: 12, flexDirection: "row", gap: 8 }}>
                  <Text style={{ fontSize: 13 }}>🧪</Text>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: "#92400E", flex: 1 }}>
                    Sandbox mode: enter any number — payment will be simulated
                  </Text>
                </View>
              )}
              <Pressable onPress={() => { if (!gwPaying) setShowGwModal(false); }} style={{ marginTop: 12, paddingVertical: 12, alignItems: "center" }}>
                <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: C.textSecondary }}>Cancel</Text>
              </Pressable>
            </>
          )}

          {gwStep === "waiting" && (
            <View style={{ alignItems: "center", paddingVertical: 24 }}>
              <ActivityIndicator size="large" color={gwColor} />
              <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: C.text, marginTop: 20 }}>Payment Processing...</Text>
              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 8, textAlign: "center" }}>
                {gwMode === "sandbox"
                  ? "Simulating payment in sandbox mode..."
                  : `A ${gwName} notification will be sent to ${gwMobile} — please approve`}
              </Text>
            </View>
          )}

          {gwStep === "done" && (
            <View style={{ alignItems: "center", paddingVertical: 24 }}>
              <Text style={{ fontSize: 48 }}>✅</Text>
              <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#16A34A", marginTop: 12 }}>Payment Successful!</Text>
              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 6 }}>Placing your order...</Text>
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
          <Text style={styles.successTitle}>Order Placed Successfully!</Text>
          <Text style={styles.successId}>Order #{orderSuccess.id}</Text>
          <Text style={styles.successAddr} numberOfLines={2}>{deliveryLine}</Text>
          <Text style={styles.successEta}>ETA: {orderSuccess.time}</Text>
          <View style={{ backgroundColor: "#F0FDF4", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, marginTop: 6, borderWidth: 1, borderColor: "#BBF7D0" }}>
            <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#166534", textAlign: "center" }}>
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
        <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border }]}>
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
            <Ionicons name="bag-outline" size={48} color={C.primary} />
          </View>
          <Text style={styles.emptyTitle}>Your Cart is Empty</Text>
          <Text style={styles.emptyText}>Add items from Mart or Food section</Text>
          <View style={styles.emptyBtns}>
            <Pressable onPress={() => router.push("/mart")} style={styles.emptyBtn}>
              <Ionicons name="storefront-outline" size={16} color="#fff" />
              <Text style={styles.emptyBtnText}>Browse Mart</Text>
            </Pressable>
            <Pressable onPress={() => router.push("/food")} style={[styles.emptyBtn, { backgroundColor: C.food }]}>
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
        colors={["#0D3B93", "#1A56DB", "#3B82F6"]}
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
            <Text style={styles.headerSub}>{items.length} item{items.length !== 1 ? "s" : ""} in cart</Text>
          </View>
          <Pressable onPress={() => setShowClearConfirm(true)} style={styles.clearBtn}>
            <Ionicons name="trash-outline" size={14} color="#fff" />
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        </View>

        {showClearConfirm && (
          <View style={styles.clearConfirm}>
            <Text style={styles.clearConfirmTxt}>Remove all items?</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable onPress={() => setShowClearConfirm(false)} style={styles.clearNo}>
                <Text style={styles.clearNoTxt}>No</Text>
              </Pressable>
              <Pressable onPress={() => { clearCart(); setShowClearConfirm(false); }} style={styles.clearYes}>
                <Text style={styles.clearYesTxt}>Yes</Text>
              </Pressable>
            </View>
          </View>
        )}
      </LinearGradient>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Items</Text>
          {items.map(item => (
            <View key={item.productId} style={styles.cartItem}>
              <View style={[styles.itemThumb, { backgroundColor: item.type === "food" ? "#FEF3C7" : "#EFF6FF" }]}>
                <Ionicons
                  name={item.type === "food" ? "restaurant-outline" : "basket-outline"}
                  size={20}
                  color={item.type === "food" ? "#D97706" : "#1A56DB"}
                />
              </View>
              <View style={styles.itemInfo}>
                <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
                <Text style={styles.itemUnit}>Rs. {item.price} each</Text>
              </View>
              <View style={styles.qtyControl}>
                <Pressable onPress={() => updateQuantity(item.productId, item.quantity - 1)} style={styles.qtyBtn}>
                  <Ionicons name={item.quantity === 1 ? "trash-outline" : "remove"} size={14} color={item.quantity === 1 ? C.danger : C.primary} />
                </Pressable>
                <Text style={styles.qtyText}>{item.quantity}</Text>
                <Pressable onPress={() => updateQuantity(item.productId, item.quantity + 1)} style={styles.qtyBtn}>
                  <Ionicons name="add" size={14} color={C.primary} />
                </Pressable>
              </View>
              <Text style={styles.itemTotal}>Rs. {item.price * item.quantity}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Delivery Address</Text>
          <Pressable
            onPress={() => {
              if (addresses.length === 0) {
                showToast("Please add an address in your profile first", "info");
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
                    {selectedAddr ? selectedAddr.label : "Delivery Address"}
                  </Text>
                  <Text style={styles.addrCardValue} numberOfLines={2}>
                    {selectedAddr ? `${selectedAddr.address}, ${selectedAddr.city}` : "Select an address"}
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

        <View style={[styles.section, styles.etaRow]}>
          <View style={styles.etaIconWrap}>
            <Ionicons name="time-outline" size={16} color={C.success} />
          </View>
          <Text style={styles.etaText}>
            Estimated delivery: {cartType === "food" ? "25–40 min" : "30–50 min"}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Method</Text>
          {availablePayMethods.filter(m => m.available).map(method => {
            const sel = payMethod === method.id;
            const iconMap: Record<string, any> = {
              cash: "cash-outline", wallet: "wallet-outline",
              jazzcash: "card-outline", easypaisa: "phone-portrait-outline",
            };
            const colorMap: Record<string, { bg: string; tint: string }> = {
              cash: { bg: "#D1FAE5", tint: C.success },
              wallet: { bg: "#DBEAFE", tint: C.primary },
              jazzcash: { bg: "#FEE2E2", tint: "#DC2626" },
              easypaisa: { bg: "#DCFCE7", tint: "#16A34A" },
            };
            const clr = colorMap[method.id] || { bg: C.surfaceSecondary, tint: C.textSecondary };
            const isGateway = method.id === "jazzcash" || method.id === "easypaisa";
            return (
              <Pressable
                key={method.id}
                onPress={() => setPayMethod(method.id as PayMethod)}
                style={[styles.payOption, sel && { borderColor: clr.tint, backgroundColor: clr.bg + "33" }]}
              >
                <View style={[styles.payIcon, { backgroundColor: sel ? clr.bg : C.surfaceSecondary }]}>
                  {isGateway
                    ? <Text style={{ fontSize: 18 }}>{method.logo}</Text>
                    : <Ionicons name={iconMap[method.id]} size={20} color={sel ? clr.tint : C.textSecondary} />
                  }
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={[styles.payLabel, sel && { color: C.text }]}>{method.label}</Text>
                    {isGateway && method.mode === "sandbox" && (
                      <View style={{ backgroundColor: "#FEF9C3", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                        <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: "#92400E" }}>SANDBOX</Text>
                      </View>
                    )}
                    {isGateway && method.mode === "live" && (
                      <View style={{ backgroundColor: "#DCFCE7", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                        <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: "#15803D" }}>LIVE</Text>
                      </View>
                    )}
                  </View>
                  {method.id === "wallet" ? (
                    <Text style={[styles.paySub, user && user.walletBalance < grandTotal && { color: C.danger }]}>
                      Balance: Rs. {user?.walletBalance?.toLocaleString() || 0}
                      {user && user.walletBalance < grandTotal ? " (insufficient)" : ""}
                    </Text>
                  ) : (
                    <Text style={styles.paySub}>{method.description}</Text>
                  )}
                </View>
                {isGateway && sel && (
                  <View style={{ backgroundColor: clr.tint, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 }}>
                    <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" }}>Enter No. →</Text>
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

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Promo Code</Text>
          <View style={[styles.summaryCard, { padding: 14 }]}>
            {promoApplied ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1, backgroundColor: "#ECFDF5", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontSize: 18 }}>🏷️</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#065F46" }}>{promoCode}</Text>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: "#059669" }}>Rs. {promoDiscount.toLocaleString()} discount applied!</Text>
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
                    placeholder="Enter promo code"
                    placeholderTextColor={C.textSecondary}
                    autoCapitalize="characters"
                    style={{
                      flex: 1, borderWidth: 1.5, borderColor: promoError ? "#DC2626" : C.border,
                      borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11,
                      fontSize: 14, color: C.text, backgroundColor: C.surfaceSecondary,
                      fontFamily: "Inter_500Medium", letterSpacing: 1,
                    }}
                  />
                  <Pressable
                    onPress={applyPromo}
                    disabled={promoLoading || !promoInput.trim()}
                    style={{
                      backgroundColor: promoInput.trim() ? C.primary : C.border,
                      borderRadius: 14, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", minWidth: 72,
                    }}
                  >
                    {promoLoading
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 13 }}>Apply</Text>
                    }
                  </Pressable>
                </View>
                {promoError && (
                  <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: "#DC2626", marginTop: 6, marginLeft: 2 }}>{promoError}</Text>
                )}
              </View>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Summary</Text>
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal ({items.reduce((s, i) => s + i.quantity, 0)} items)</Text>
              <Text style={styles.summaryValue}>Rs. {total.toLocaleString()}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Delivery Fee</Text>
              <Text style={[styles.summaryValue, deliveryFee === 0 && { color: C.success }]}>
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
                <Text style={[styles.summaryLabel, { color: "#059669" }]}>🏷️ Promo ({promoCode})</Text>
                <Text style={[styles.summaryValue, { color: "#059669" }]}>- Rs. {promoDiscount.toLocaleString()}</Text>
              </View>
            )}
            <View style={[styles.summaryRow, styles.summaryDivider]}>
              <Text style={styles.grandLabel}>Grand Total</Text>
              <Text style={styles.grandValue}>Rs. {grandTotal.toLocaleString()}</Text>
            </View>
            {finance.cashbackEnabled && cashbackAmt > 0 && (
              <View style={{ marginTop: 10, backgroundColor: "#ECFDF5", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ fontSize: 16 }}>🎁</Text>
                <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: "#065F46", flex: 1 }}>
                  Earn <Text style={{ fontFamily: "Inter_700Bold" }}>Rs. {cashbackAmt}</Text> wallet cashback on this order!
                </Text>
              </View>
            )}
            {walletCashbackAmt > 0 && (
              <View style={{ marginTop: 6, backgroundColor: "#EFF6FF", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ fontSize: 16 }}>💰</Text>
                <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: "#1E40AF", flex: 1 }}>
                  Wallet bonus: Earn <Text style={{ fontFamily: "Inter_700Bold" }}>Rs. {walletCashbackAmt}</Text> ({customer.walletCashbackPct}%) back!
                </Text>
              </View>
            )}
          </View>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      <View style={[styles.checkoutBar, { paddingBottom: insets.bottom + 12 }]}>
        <View>
          <Text style={styles.checkoutTotal}>Rs. {grandTotal.toLocaleString()}</Text>
          <Text style={styles.checkoutItems}>{items.reduce((s, i) => s + i.quantity, 0)} items</Text>
        </View>
        {total < orderRules.minOrderAmount ? (
          <View style={styles.minOrderWrap}>
            <Text style={styles.minOrderTxt}>
              Min. Rs.{orderRules.minOrderAmount} — add Rs.{orderRules.minOrderAmount - total} more
            </Text>
            <View style={[styles.minOrderBar]}>
              <View style={[styles.minOrderFill, { width: `${Math.min(100, (total / orderRules.minOrderAmount) * 100)}%` }]} />
            </View>
          </View>
        ) : (
          <Pressable style={[styles.checkoutBtn, (loading || addrLoading) && { opacity: 0.7 }]} onPress={handleCheckout} disabled={loading || addrLoading}>
            {loading ? <ActivityIndicator color="#fff" size="small" /> : (
              <>
                <Text style={styles.checkoutBtnTxt}>Place Order</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </>
            )}
          </Pressable>
        )}
      </View>

      <AddressPickerModal
        visible={showAddrPicker}
        addresses={addresses}
        selected={selectedAddrId}
        onSelect={(a) => setSelectedAddrId(a.id)}
        onClose={() => setShowAddrPicker(false)}
      />

      <GatewayModal />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: { paddingHorizontal: 16, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: "#fff" },
  headerSub: { fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.75)", marginTop: 2 },
  clearBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.15)", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  clearText: { fontFamily: "Inter_500Medium", fontSize: 12, color: "rgba(255,255,255,0.9)" },
  clearConfirm: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 14, padding: 12, marginTop: 10 },
  clearConfirmTxt: { fontFamily: "Inter_500Medium", fontSize: 13, color: "#fff" },
  clearNo: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.2)" },
  clearNoTxt: { fontFamily: "Inter_500Medium", fontSize: 12, color: "#fff" },
  clearYes: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: "#DC2626" },
  clearYesTxt: { fontFamily: "Inter_700Bold", fontSize: 12, color: "#fff" },

  scroll: { flex: 1 },
  section: { paddingHorizontal: 16, paddingTop: 18 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 16, color: C.text, marginBottom: 12 },

  cartItem: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: C.surface, borderRadius: 16, marginBottom: 8, borderWidth: 1, borderColor: C.borderLight, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  itemThumb: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  itemInfo: { flex: 1 },
  itemName: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.text, marginBottom: 3 },
  itemUnit: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted },
  qtyControl: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.surfaceSecondary, borderRadius: 12, paddingHorizontal: 4, paddingVertical: 4 },
  qtyBtn: { width: 30, height: 30, borderRadius: 9, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border },
  qtyText: { fontFamily: "Inter_700Bold", fontSize: 15, color: C.text, minWidth: 20, textAlign: "center" },
  itemTotal: { fontFamily: "Inter_700Bold", fontSize: 15, color: C.text, minWidth: 60, textAlign: "right" },

  addrCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: C.surface, borderRadius: 16, borderWidth: 1.5, borderColor: C.border },
  addrCardIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center" },
  addrCardLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.text },
  addrCardValue: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, marginTop: 2 },
  changeBtn: { flexDirection: "row", alignItems: "center", gap: 2 },
  changeBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: C.primary },

  etaRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#F0FDF4", marginHorizontal: 16, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#BBF7D0" },
  etaIconWrap: { width: 32, height: 32, borderRadius: 10, backgroundColor: "#D1FAE5", alignItems: "center", justifyContent: "center" },
  etaText: { fontFamily: "Inter_500Medium", fontSize: 13, color: "#065F46", flex: 1 },

  payOption: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: C.surface, borderRadius: 16, marginBottom: 8, borderWidth: 1.5, borderColor: C.border },
  payIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  payLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.textSecondary },
  paySub: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 12, height: 12, borderRadius: 6 },

  summaryCard: { backgroundColor: C.surface, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: C.border },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  summaryLabel: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary },
  summaryValue: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text },
  summaryDivider: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 12, marginTop: 4 },
  grandLabel: { fontFamily: "Inter_700Bold", fontSize: 16, color: C.text },
  grandValue: { fontFamily: "Inter_700Bold", fontSize: 18, color: C.primary },

  checkoutBar: { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", paddingHorizontal: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.border, shadowColor: "#000", shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 8 },
  checkoutTotal: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.text },
  checkoutItems: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted },
  checkoutBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.primary, paddingHorizontal: 28, paddingVertical: 15, borderRadius: 16, shadowColor: C.primary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  checkoutBtnTxt: { fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff" },
  minOrderWrap: { flex: 1, marginLeft: 16, gap: 6 },
  minOrderTxt: { fontFamily: "Inter_500Medium", fontSize: 12, color: "#D97706" },
  minOrderBar: { height: 6, backgroundColor: "#FEF3C7", borderRadius: 3, overflow: "hidden" as const },
  minOrderFill: { height: 6, backgroundColor: "#F59E0B", borderRadius: 3 },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 32 },
  handle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: "center", marginBottom: 18 },
  sheetTitle: { fontFamily: "Inter_700Bold", fontSize: 18, color: C.text, marginBottom: 16 },

  addrOpt: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, borderWidth: 1.5, borderColor: C.border, marginBottom: 8 },
  addrOptSel: { borderColor: C.primary, backgroundColor: "#EFF6FF" },
  addrOptIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  addrOptLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.text },
  addrOptAddress: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, marginTop: 2 },
  addrOptCity: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted },
  defaultTag: { backgroundColor: C.primary, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  defaultTagText: { fontFamily: "Inter_700Bold", fontSize: 9, color: "#fff" },
  cancelBtn: { paddingVertical: 14, alignItems: "center", marginTop: 8 },
  cancelBtnText: { fontFamily: "Inter_500Medium", fontSize: 14, color: C.textSecondary },

  successWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  successCircle: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  successTitle: { fontFamily: "Inter_700Bold", fontSize: 22, color: C.text, marginBottom: 8, textAlign: "center" },
  successId: { fontFamily: "Inter_600SemiBold", fontSize: 16, color: C.primary, marginBottom: 4 },
  successAddr: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, textAlign: "center", marginBottom: 4 },
  successEta: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.success, marginBottom: 6 },
  successBtns: { flexDirection: "row", gap: 12, marginTop: 20, width: "100%" },
  trackBtn: { flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.primary, borderRadius: 16, paddingVertical: 15, shadowColor: C.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3 },
  trackBtnTxt: { fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" },
  homeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#EFF6FF", borderRadius: 16, paddingVertical: 15 },
  homeBtnTxt: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.primary },

  emptyContainer: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  emptyIconBox: { width: 88, height: 88, borderRadius: 28, backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center", marginBottom: 20 },
  emptyTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.text, marginBottom: 8 },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textSecondary, marginBottom: 20 },
  emptyBtns: { flexDirection: "row", gap: 12 },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.primary, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14 },
  emptyBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#fff" },
});
