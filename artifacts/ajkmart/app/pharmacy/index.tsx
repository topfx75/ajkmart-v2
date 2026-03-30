import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import React, { useState, useEffect } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
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
import { useCart } from "@/context/CartContext";
import { useToast } from "@/context/ToastContext";
import { useLanguage } from "@/context/LanguageContext";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { getProducts, createPharmacyOrder } from "@workspace/api-client-react";
import type { GetProductsType } from "@workspace/api-client-react";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { withServiceGuard } from "@/components/ServiceGuard";

const C = Colors.light;
const W = Dimensions.get("window").width;

interface PharmacyProduct {
  id: string;
  name: string;
  category: string;
  price: number;
  vendorName?: string;
  unit?: string;
  description?: string;
  requires_prescription?: boolean;
}

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

function MedCard({ med, qty, onAdd, onRemove }: {
  med: Med; qty: number; onAdd: () => void; onRemove: () => void;
}) {
  return (
    <View style={s.medCard}>
      <View style={s.medEmoji}><Text style={{ fontSize: 26 }}>{med.emoji || "💊"}</Text></View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
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
              <Ionicons name="remove" size={16} color="#7C3AED" />
            </Pressable>
            <Text style={s.qtyTxt}>{qty}</Text>
            <Pressable onPress={onAdd} style={s.qtyBtn}>
              <Ionicons name="add" size={16} color="#7C3AED" />
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

function PharmacyScreenInner() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const { user, updateUser, token } = useAuth();
  const { items: globalCartItems, addItem: addToGlobalCart, removeItem: removeFromGlobalCart, updateQuantity, clearCart } = useCart();
  const { showToast } = useToast();
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  const inMaintenance = config.appStatus === "maintenance";
  const pharmacyEnabled = config.features.pharmacy;

  const [medicines, setMedicines] = useState<Med[]>([]);
  const [categories, setCategories] = useState<string[]>(["All"]);
  const [loadingMeds, setLoadingMeds] = useState(true);
  const [medsError, setMedsError] = useState(false);
  const [activeTab, setActiveTab] = useState("All");
  const [search, setSearch] = useState("");
  const [showCheckout, setShowCheckout] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedOrderId, setConfirmedOrderId] = useState("");

  const pharmacyCartItems = globalCartItems.filter(i => i.type === "pharmacy");

  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState(user?.phone || "");
  const [prescription, setPrescription] = useState("");
  const [prescriptionPhotoUri, setPrescriptionPhotoUri] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<"wallet" | "cash">("cash");

  const [showPhotoSourceModal, setShowPhotoSourceModal] = useState(false);

  const pickPrescriptionPhoto = () => {
    setShowPhotoSourceModal(true);
  };

  const pickFromGallery = async () => {
    setShowPhotoSourceModal(false);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { showToast("Photo library permission denied", "error"); return; }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.7,
      });
      if (result.canceled || !result.assets?.[0]) return;
      setPrescriptionPhotoUri(result.assets[0].uri);
    } catch {
      showToast("Could not pick image", "error");
    }
  };

  const takePhoto = async () => {
    setShowPhotoSourceModal(false);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { showToast("Camera permission denied", "error"); return; }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.7,
      });
      if (result.canceled || !result.assets?.[0]) return;
      setPrescriptionPhotoUri(result.assets[0].uri);
    } catch {
      showToast("Could not open camera", "error");
    }
  };

  const loadMeds = () => {
    if (!pharmacyEnabled) return;
    setLoadingMeds(true);
    setMedsError(false);
    getProducts({ type: "pharmacy" as GetProductsType })
      .then(data => {
        if (data?.products?.length) {
          const meds: Med[] = (data.products as unknown as PharmacyProduct[]).map(p => ({
            id: p.id,
            name: p.name,
            brand: p.vendorName ?? "Various",
            category: p.category,
            price: p.price,
            unit: p.unit ?? p.description ?? "1 unit",
            emoji: "💊",
            requires_prescription: !!p.requires_prescription,
          }));
          setMedicines(meds);
          setCategories(["All", ...new Set(meds.map(m => m.category))]);
        }
      })
      .catch(() => setMedsError(true))
      .finally(() => setLoadingMeds(false));
  };

  useEffect(() => { loadMeds(); }, [pharmacyEnabled]);

  const filtered = medicines.filter(m => {
    const matchCat = activeTab === "All" || m.category === activeTab;
    const matchSearch = !search || m.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const cartItems: CartItem[] = medicines
    .filter(m => pharmacyCartItems.some(ci => ci.productId === m.id))
    .map(m => {
      const ci = pharmacyCartItems.find(ci => ci.productId === m.id)!;
      return { ...m, qty: ci.quantity };
    });

  const cartTotal = cartItems.reduce((sum, m) => sum + m.price * m.qty, 0);
  const cartCount = pharmacyCartItems.reduce((sum, i) => sum + i.quantity, 0);

  useEffect(() => {
    if (payMethod === "cash" && cartTotal > config.orderRules.maxCodAmount) {
      const walletBalance = user?.walletBalance ?? 0;
      if (config.features.wallet && walletBalance >= cartTotal) {
        setPayMethod("wallet");
      } else {
        showToast(
          `Order total exceeds COD limit (Rs. ${config.orderRules.maxCodAmount.toLocaleString()}) and wallet balance is insufficient. Please reduce your order.`,
          "error"
        );
      }
    }
  }, [cartTotal, config.orderRules.maxCodAmount, payMethod]);

  const addToCart = (med: Med) => {
    addToGlobalCart({ productId: med.id, name: med.name, price: med.price, quantity: 1, type: "pharmacy" });
  };

  const removeFromCart = (med: Med) => {
    const existing = pharmacyCartItems.find(ci => ci.productId === med.id);
    if (!existing) return;
    if (existing.quantity <= 1) {
      removeFromGlobalCart(med.id);
    } else {
      updateQuantity(med.id, existing.quantity - 1);
    }
  };

  const placeOrder = async () => {
    if (!address.trim() || !phone.trim()) {
      showToast(T("deliveryAddress"), "error");
      return;
    }
    if (cartItems.length === 0) {
      showToast(T("addToCart"), "error");
      return;
    }
    if (payMethod === "cash" && cartTotal > config.orderRules.maxCodAmount) {
      showToast(
        `Order total exceeds COD limit (Rs. ${config.orderRules.maxCodAmount.toLocaleString()}). Please use wallet or reduce your order.`,
        "error"
      );
      return;
    }
    setLoading(true);
    try {
      // Upload prescription photo if selected, then submit order with returned URL
      let prescriptionPhotoUrl: string | undefined;
      if (prescriptionPhotoUri) {
        try {
          // Read the file as base64
          const FileSystem = await import("expo-file-system");
          const base64 = await FileSystem.readAsStringAsync(prescriptionPhotoUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const mimeType = prescriptionPhotoUri.endsWith(".png") ? "image/png" : "image/jpeg";
          const uploadRes = await fetch(`https://${process.env.EXPO_PUBLIC_DOMAIN}/api/uploads`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ file: `data:${mimeType};base64,${base64}`, mimeType }),
          });
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            prescriptionPhotoUrl = uploadData.url as string;
          } else {
            showToast("Could not upload prescription photo — check connection and try again", "error");
            setLoading(false);
            return;
          }
        } catch {
          showToast("Could not upload prescription photo", "error");
          setLoading(false);
          return;
        }
      }

      const data = await createPharmacyOrder({
        items: cartItems.map(m => ({ id: m.id, name: m.name, price: m.price, quantity: m.qty })),
        prescriptionNote: prescription || null,
        prescriptionPhotoUri: prescriptionPhotoUrl || undefined,
        deliveryAddress: address,
        contactPhone: phone,
        paymentMethod: payMethod as "cash" | "wallet",
      });
      if (payMethod === "wallet" && user) {
        updateUser({ walletBalance: (user.walletBalance ?? 0) - (data.total ?? cartTotal) });
      }
      setConfirmedOrderId(data.id);
      setConfirmed(true);
      clearCart();
    } catch {
      showToast(T("networkError"), "error");
    } finally {
      setLoading(false);
    }
  };

  if (!pharmacyEnabled) {
    return (
      <View style={[s.root, { justifyContent: "center", alignItems: "center", padding: 32 }]}>
        <Pressable onPress={() => router.back()} style={{ position: "absolute", top: topPad + 12, left: 16 }}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </Pressable>
        <View style={[s.successCard, { borderColor: "#FEE2E2" }]}>
          <Text style={{ fontSize: 52, marginBottom: 12 }}>🚫</Text>
          <Text style={[s.successTitle, { color: "#EF4444" }]}>{T("serviceUnavailable")}</Text>
          <Text style={[s.successSub, { marginBottom: 20 }]}>{T("maintenanceApology")}</Text>
          <Pressable style={[s.successBtn, { backgroundColor: "#FEF2F2" }]} onPress={() => router.back()}>
            <Text style={[s.successBtnTxt, { color: "#EF4444" }]}>{T("backToHome")}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (inMaintenance) {
    return (
      <View style={[s.root, { justifyContent: "center", alignItems: "center", padding: 32 }]}>
        <View style={[s.successCard, { borderColor: "#FEF3C7" }]}>
          <Text style={{ fontSize: 52, marginBottom: 12 }}>🔧</Text>
          <Text style={[s.successTitle, { color: "#D97706" }]}>{T("underMaintenance")}</Text>
          <Text style={[s.successSub, { marginBottom: 20 }]}>{config.content.maintenanceMsg}</Text>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, textAlign: "center" }}>
            {T("maintenanceApology")}
          </Text>
        </View>
      </View>
    );
  }

  if (confirmed) {
    return (
      <View style={[s.root, { justifyContent: "center", alignItems: "center", paddingHorizontal: 32 }]}>
        <View style={s.successCard}>
          <View style={s.successIconWrap}>
            <LinearGradient colors={["#7C3AED", "#A78BFA"]} style={s.successIconCircle}>
              <Ionicons name="checkmark" size={36} color="#fff" />
            </LinearGradient>
          </View>
          <Text style={s.successTitle}>{T("orderPlaced")}</Text>
          <Text style={s.successSub}>
            #{confirmedOrderId.slice(-6).toUpperCase()}{"\n"}
            {T("eta")}: 25-40 min
          </Text>
          <View style={s.successMeta}>
            <Ionicons name="location-outline" size={14} color={C.textMuted} />
            <Text style={s.successMetaTxt} numberOfLines={2}>{address}</Text>
          </View>
          <Pressable style={s.successBtn} onPress={() => { setConfirmed(false); router.push("/(tabs)"); }}>
            <Text style={s.successBtnTxt}>{T("backToHome")}</Text>
          </Pressable>
          <Pressable style={[s.successBtn, { backgroundColor: "#F5F3FF", marginTop: 8 }]} onPress={() => { setConfirmed(false); }}>
            <Text style={[s.successBtnTxt, { color: "#7C3AED" }]}>{T("orderMore")}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <LinearGradient colors={["#6D28D9", "#7C3AED", "#A78BFA"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.header, { paddingTop: topPad + 14 }]}>
        <View style={s.hdrRow}>
          <Pressable onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.hdrTitle}>💊 {T("pharmacy")}</Text>
            <Text style={s.hdrSub}>{T("medicinesDeliveredTo")}</Text>
          </View>
          {cartCount > 0 && (
            <Pressable onPress={() => setShowCheckout(true)} style={s.cartPill}>
              <Ionicons name="cart" size={16} color="#fff" />
              <Text style={s.cartPillTxt}>{cartCount} {T("itemsLabel")}</Text>
            </Pressable>
          )}
        </View>
        <View style={s.searchBar}>
          <Ionicons name="search-outline" size={16} color={C.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={T("searchMedicines")}
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

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabsScroll} contentContainerStyle={s.tabsRow}>
        {categories.map(cat => (
          <Pressable key={cat} onPress={() => setActiveTab(cat)} style={[s.tab, activeTab === cat && s.tabActive]}>
            <Text style={[s.tabTxt, activeTab === cat && s.tabTxtActive]}>{cat}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={s.rxNotice}>
        <Ionicons name="information-circle-outline" size={14} color="#7C3AED" />
        <Text style={s.rxNoticeTxt}><Text style={{ fontFamily: "Inter_600SemiBold" }}>Rx</Text> {T("rxNotice")}</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.grid}>
        {loadingMeds ? (
          <View style={s.centerState}>
            <ActivityIndicator size="large" color="#7C3AED" />
            <Text style={s.emptyTxt}>{T("loadingMedicines")}</Text>
          </View>
        ) : medsError ? (
          <View style={s.centerState}>
            <View style={s.errorIconWrap}>
              <Ionicons name="cloud-offline-outline" size={48} color="#9CA3AF" />
            </View>
            <Text style={s.errorTitle}>{T("cannotLoad")}</Text>
            <Text style={s.errorSub}>{T("checkInternet")}</Text>
            <Pressable onPress={loadMeds} style={s.retryBtn}>
              <Ionicons name="refresh-outline" size={16} color="#fff" />
              <Text style={s.retryBtnTxt}>{T("retry")}</Text>
            </Pressable>
          </View>
        ) : filtered.length === 0 ? (
          <View style={s.centerState}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🔍</Text>
            <Text style={s.emptyTxt}>{T("noMedicineFound")}</Text>
          </View>
        ) : (
          filtered.map(med => (
            <MedCard
              key={med.id}
              med={med}
              qty={pharmacyCartItems.find(ci => ci.productId === med.id)?.quantity ?? 0}
              onAdd={() => addToCart(med)}
              onRemove={() => removeFromCart(med)}
            />
          ))
        )}
        <View style={{ height: cartCount > 0 ? 100 : 24 }} />
      </ScrollView>

      {cartCount > 0 && (
        <View style={[s.cartBar, { paddingBottom: insets.bottom + 12 }]}>
          <View>
            <Text style={s.cartBarCount}>{cartCount} {T("medicines")}</Text>
            <Text style={s.cartBarTotal}>Rs. {cartTotal.toLocaleString()}</Text>
          </View>
          <Pressable style={s.checkoutBtn} onPress={() => setShowCheckout(true)}>
            <Text style={s.checkoutBtnTxt}>{T("placeOrder")}</Text>
            <Ionicons name="arrow-forward" size={16} color="#fff" />
          </Pressable>
        </View>
      )}

      <Modal visible={showCheckout} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCheckout(false)}>
        <ScrollView style={s.modal} contentContainerStyle={{ paddingBottom: 40 }}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>{T("orderSummary")}</Text>
            <Pressable onPress={() => setShowCheckout(false)} style={s.modalCloseBtn}>
              <Ionicons name="close" size={20} color={C.text} />
            </Pressable>
          </View>

          <View style={s.section}>
            <Text style={s.sectionTitle}>{T("medicines")} ({cartCount})</Text>
            {cartItems.map(item => (
              <View key={item.id} style={s.orderItem}>
                <Text style={s.orderItemName}>{item.emoji || "💊"} {item.name}</Text>
                <Text style={s.orderItemQty}>×{item.qty}</Text>
                <Text style={s.orderItemPrice}>Rs. {(item.price * item.qty).toLocaleString()}</Text>
              </View>
            ))}
            <View style={s.divider} />
            <View style={[s.orderItem, { marginTop: 4 }]}>
              <Text style={[s.orderItemName, { fontFamily: "Inter_700Bold" }]}>{T("deliveryFee")}</Text>
              <Text style={[s.orderItemPrice, { color: C.success }]}>{T("freeLabel")}</Text>
            </View>
            <View style={s.orderItem}>
              <Text style={[s.orderItemName, { fontFamily: "Inter_700Bold", fontSize: 15 }]}>{T("totalLabel")}</Text>
              <Text style={[s.orderItemPrice, { fontFamily: "Inter_700Bold", fontSize: 15, color: "#7C3AED" }]}>Rs. {cartTotal.toLocaleString()}</Text>
            </View>
          </View>

          <View style={s.section}>
            <Text style={s.sectionTitle}>{T("deliveryDetails")}</Text>
            <Text style={s.label}>{T("deliveryAddress")} *</Text>
            <TextInput
              value={address}
              onChangeText={setAddress}
              placeholder={T("enterFullName")}
              placeholderTextColor={C.textMuted}
              style={s.input}
              multiline
              numberOfLines={2}
            />
            <Text style={s.label}>{T("contactNumber")} *</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="03XX XXXXXXX"
              placeholderTextColor={C.textMuted}
              style={s.input}
              keyboardType="phone-pad"
            />
            <Text style={s.label}>{T("prescriptionNote")}</Text>
            <TextInput
              value={prescription}
              onChangeText={setPrescription}
              placeholder={T("rxNotice")}
              placeholderTextColor={C.textMuted}
              style={[s.input, { minHeight: 72 }]}
              multiline
              numberOfLines={3}
            />
            <Pressable onPress={pickPrescriptionPhoto} style={s.photoPickerBtn}>
              <Ionicons name="camera-outline" size={18} color="#7C3AED" />
              <Text style={s.photoPickerTxt}>
                {prescriptionPhotoUri ? "Change Prescription Photo" : "Attach Prescription Photo"}
              </Text>
            </Pressable>
            {prescriptionPhotoUri && (
              <View style={{ marginTop: 10, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: "#DDD6FE" }}>
                <Image source={{ uri: prescriptionPhotoUri }} style={{ width: "100%", height: 140 }} resizeMode="cover" />
                <Pressable
                  onPress={() => setPrescriptionPhotoUri(null)}
                  style={{ position: "absolute", top: 8, right: 8, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 12, padding: 4 }}
                >
                  <Ionicons name="close" size={16} color="#fff" />
                </Pressable>
              </View>
            )}
          </View>

          <View style={s.section}>
            <Text style={s.sectionTitle}>{T("paymentMethods")}</Text>
            <View style={s.payRow}>
              {cartTotal <= config.orderRules.maxCodAmount ? (
                <Pressable onPress={() => setPayMethod("cash")} style={[s.payOpt, payMethod === "cash" && s.payOptActive]}>
                  <View style={[s.payOptIconWrap, { backgroundColor: payMethod === "cash" ? "#D1FAE5" : C.surfaceSecondary }]}>
                    <Ionicons name="cash-outline" size={20} color={payMethod === "cash" ? "#059669" : C.textMuted} />
                  </View>
                  <Text style={[s.payOptTxt, payMethod === "cash" && { color: "#059669" }]}>{T("cashOnDelivery")}</Text>
                </Pressable>
              ) : (
                <View style={[s.payOpt, { opacity: 0.4 }]}>
                  <View style={[s.payOptIconWrap, { backgroundColor: C.surfaceSecondary }]}>
                    <Ionicons name="cash-outline" size={20} color={C.textMuted} />
                  </View>
                  <Text style={s.payOptTxt}>{T("codLimit")}: Rs. {config.orderRules.maxCodAmount.toLocaleString()}</Text>
                </View>
              )}
              {config.features.wallet && (
                <Pressable onPress={() => setPayMethod("wallet")} style={[s.payOpt, payMethod === "wallet" && s.payOptActive]}>
                  <View style={[s.payOptIconWrap, { backgroundColor: payMethod === "wallet" ? "#EFF6FF" : C.surfaceSecondary }]}>
                    <Ionicons name="wallet-outline" size={20} color={payMethod === "wallet" ? C.primary : C.textMuted} />
                  </View>
                  <View>
                    <Text style={[s.payOptTxt, payMethod === "wallet" && { color: C.primary }]}>{T("wallet")}</Text>
                    <Text style={s.walletBal}>Rs. {(user?.walletBalance ?? 0).toLocaleString()} {T("availableBalance")}</Text>
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
                <Text style={s.placeBtnTxt}>{T("placeOrder")} • Rs. {cartTotal.toLocaleString()}</Text>
                <Ionicons name="checkmark-circle" size={18} color="#fff" />
              </>
            )}
          </Pressable>
        </ScrollView>
      </Modal>

      <Modal visible={showPhotoSourceModal} transparent animationType="fade" onRequestClose={() => setShowPhotoSourceModal(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }} onPress={() => setShowPhotoSourceModal(false)}>
          <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34 }}>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: C.text, marginBottom: 16, textAlign: "center" }}>
              Attach Prescription
            </Text>
            <Pressable
              onPress={takePhoto}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: "#F5F3FF", borderRadius: 14, marginBottom: 10 }}
            >
              <Ionicons name="camera-outline" size={22} color="#7C3AED" />
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#7C3AED" }}>Take Photo</Text>
            </Pressable>
            <Pressable
              onPress={pickFromGallery}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: "#F5F3FF", borderRadius: 14, marginBottom: 10 }}
            >
              <Ionicons name="image-outline" size={22} color="#7C3AED" />
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#7C3AED" }}>Choose from Gallery</Text>
            </Pressable>
            <Pressable
              onPress={() => setShowPhotoSourceModal(false)}
              style={{ paddingVertical: 12, alignItems: "center" }}
            >
              <Text style={{ fontFamily: "Inter_500Medium", fontSize: 14, color: C.textSecondary }}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

export default withServiceGuard("pharmacy", PharmacyScreenInner);

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },

  header: { paddingHorizontal: 16, paddingBottom: 16 },
  hdrRow: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  backBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  hdrTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: "#fff" },
  hdrSub: { fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.8)", marginTop: 2 },
  cartPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.25)", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 22 },
  cartPillTxt: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: "#fff" },
  searchBar: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3 },
  searchInput: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13, color: C.text, padding: 0 },

  tabsScroll: { maxHeight: 52, backgroundColor: "#fff" },
  tabsRow: { paddingHorizontal: 12, gap: 8, alignItems: "center", paddingVertical: 8 },
  tab: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 22, backgroundColor: "#F5F3FF" },
  tabActive: { backgroundColor: "#7C3AED" },
  tabTxt: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: "#7C3AED" },
  tabTxtActive: { color: "#fff" },

  rxNotice: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F5F3FF", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#EDE9FE" },
  rxNoticeTxt: { fontFamily: "Inter_400Regular", fontSize: 11, color: "#7C3AED", flex: 1 },

  grid: { paddingHorizontal: 12, paddingTop: 12, gap: 10 },
  centerState: { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyTxt: { fontFamily: "Inter_500Medium", fontSize: 14, color: C.textMuted },
  errorIconWrap: { width: 80, height: 80, borderRadius: 24, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  errorTitle: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#374151" },
  errorSub: { fontFamily: "Inter_400Regular", fontSize: 13, color: "#6B7280" },
  retryBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#7C3AED", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, marginTop: 4 },
  retryBtnTxt: { fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" },

  medCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 16, padding: 14, gap: 12, borderWidth: 1, borderColor: C.border, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  medEmoji: { width: 50, height: 50, borderRadius: 14, backgroundColor: "#F5F3FF", alignItems: "center", justifyContent: "center" },
  medName: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.text, flex: 1 },
  medBrand: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginTop: 2 },
  medUnit: { fontFamily: "Inter_400Regular", fontSize: 10, color: C.textMuted },
  medPrice: { fontFamily: "Inter_700Bold", fontSize: 15, color: "#7C3AED", marginTop: 4 },
  rxBadge: { backgroundColor: "#FEE2E2", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  rxTxt: { fontFamily: "Inter_700Bold", fontSize: 9, color: "#EF4444" },

  qtyCtrl: { flexDirection: "row", alignItems: "center", gap: 8 },
  qtyBtn: { width: 32, height: 32, borderRadius: 10, borderWidth: 1.5, borderColor: "#7C3AED", alignItems: "center", justifyContent: "center" },
  qtyTxt: { fontFamily: "Inter_700Bold", fontSize: 15, color: C.text, minWidth: 20, textAlign: "center" },
  addBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center", shadowColor: "#7C3AED", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3 },

  cartBar: { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", paddingHorizontal: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.border, shadowColor: "#000", shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 5 },
  cartBarCount: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted },
  cartBarTotal: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.text },
  checkoutBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#7C3AED", paddingHorizontal: 22, paddingVertical: 13, borderRadius: 14, shadowColor: "#7C3AED", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3 },
  checkoutBtnTxt: { fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" },

  modal: { backgroundColor: "#fff", flex: 1 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontFamily: "Inter_700Bold", fontSize: 18, color: C.text },
  modalCloseBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" },

  section: { paddingHorizontal: 16, paddingTop: 18 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 16, color: C.text, marginBottom: 12 },

  orderItem: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  orderItemName: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13, color: C.text },
  orderItemQty: { fontFamily: "Inter_500Medium", fontSize: 12, color: C.textMuted, width: 28 },
  orderItemPrice: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 10 },

  label: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.text, marginBottom: 6, marginTop: 12 },
  input: { borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontFamily: "Inter_400Regular", fontSize: 13, color: C.text, backgroundColor: C.surfaceSecondary },
  photoPickerBtn: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1.5, borderColor: "#DDD6FE", backgroundColor: "#F5F3FF" },
  photoPickerTxt: { fontFamily: "Inter_500Medium", fontSize: 13, color: "#7C3AED" },

  payRow: { gap: 10 },
  payOpt: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: C.border },
  payOptActive: { borderColor: "#7C3AED", backgroundColor: "#F5F3FF" },
  payOptIconWrap: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  payOptTxt: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.textMuted },
  walletBal: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginTop: 2 },

  placeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, margin: 16, backgroundColor: "#7C3AED", borderRadius: 16, paddingVertical: 16, shadowColor: "#7C3AED", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  placeBtnTxt: { fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff" },

  successCard: { backgroundColor: "#fff", borderRadius: 24, padding: 28, alignItems: "center", width: "100%", borderWidth: 1, borderColor: C.border, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 5 },
  successIconWrap: { marginBottom: 16 },
  successIconCircle: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  successTitle: { fontFamily: "Inter_700Bold", fontSize: 24, color: C.text, marginBottom: 8 },
  successSub: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted, textAlign: "center", lineHeight: 20, marginBottom: 16 },
  successMeta: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginBottom: 20, width: "100%" },
  successMetaTxt: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, flex: 1 },
  successBtn: { width: "100%", alignItems: "center", backgroundColor: "#7C3AED", borderRadius: 16, paddingVertical: 15 },
  successBtnTxt: { fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff" },
});
