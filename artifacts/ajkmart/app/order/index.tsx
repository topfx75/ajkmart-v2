import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { useLanguage } from "@/context/LanguageContext";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { CancelModal } from "@/components/CancelModal";
import type { CancelTarget } from "@/components/CancelModal";
import { API_BASE } from "@/utils/api";
import { staticMapUrl } from "@/hooks/useMaps";

const C = Colors.light;

const STATUS_STEPS = ["pending", "confirmed", "preparing", "out_for_delivery", "delivered"];
const PARCEL_STEPS = ["pending", "accepted", "in_transit", "completed"];

const LIVE_TRACKING_STATUSES = ["picked_up", "out_for_delivery", "in_transit", "accepted", "arrived"];

export default function OrderDetailScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Math.max(insets.top, 12);
  const { orderId, type } = useLocalSearchParams<{ orderId: string; type?: string }>();
  const isParcel = type === "parcel";
  const isRide = type === "ride";
  const { token } = useAuth();
  const { showToast } = useToast();
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: string; label: string }> = {
    pending:          { color: "#D97706", bg: "#FEF3C7", icon: "time-outline",             label: T("pending") },
    confirmed:        { color: "#2563EB", bg: "#DBEAFE", icon: "checkmark-circle-outline", label: T("confirmed") },
    preparing:        { color: "#7C3AED", bg: "#EDE9FE", icon: "flame-outline",             label: T("preparing") },
    ready:            { color: "#6366F1", bg: "#E0E7FF", icon: "bag-check-outline",        label: T("statusReady") },
    picked_up:        { color: "#0891B2", bg: "#CFFAFE", icon: "cube-outline",             label: T("pickedUp") },
    out_for_delivery: { color: "#059669", bg: "#D1FAE5", icon: "bicycle-outline",          label: T("onTheWay") },
    delivered:        { color: "#6B7280", bg: "#F3F4F6", icon: "checkmark-done-outline",   label: T("delivered") },
    cancelled:        { color: "#DC2626", bg: "#FEE2E2", icon: "close-circle-outline",     label: T("cancelled") },
    accepted:         { color: "#059669", bg: "#D1FAE5", icon: "checkmark-circle-outline", label: T("statusAccepted") },
    arrived:          { color: "#0891B2", bg: "#CFFAFE", icon: "location-outline",         label: T("arrived") },
    in_transit:       { color: "#7C3AED", bg: "#EDE9FE", icon: "car-outline",              label: T("inTransit") },
    completed:        { color: "#6B7280", bg: "#F3F4F6", icon: "checkmark-done-outline",   label: T("completed") },
    searching:        { color: "#D97706", bg: "#FEF3C7", icon: "search-outline",           label: T("searching") },
    bargaining:       { color: "#2563EB", bg: "#DBEAFE", icon: "chatbubbles-outline",      label: T("bargaining") },
  };

  const STEP_LABELS = [T("statusPlaced"), T("confirmed"), T("preparing"), T("statusOnWay"), T("delivered")];
  const PARCEL_STEP_LABELS = [T("statusPlaced"), T("statusAccepted"), T("inTransit"), T("delivered")];
  const [order, setOrder] = useState<any>(null);
  const [serverNow, setServerNow] = useState<number>(Date.now());
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [riderLat, setRiderLat] = useState<number | null>(null);
  const [riderLng, setRiderLng] = useState<number | null>(null);
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [trackFailed, setTrackFailed] = useState(false);

  const mountedRef = useRef(true);
  const isPharmacyType = type === "pharmacy";

  // Poll rider live location for all active order types.
  // - Parcel orders: GET /rides/:id/track (returns riderId live loc + ETA)
  // - Pharmacy orders: GET /pharmacy-orders/:id/track (uses riderId from pharmacyOrdersTable)
  // - Mart/food orders: GET /orders/:id/track (uses riderId from ordersTable)
  // Re-runs when order.status changes (e.g. transitions into a trackable status).
  useEffect(() => {
    if (!orderId || !token || !order) return;
    if (!LIVE_TRACKING_STATUSES.includes(order.status)) return;

    let ivRef: ReturnType<typeof setInterval> | null = null;

    const fetchTrack = async () => {
      try {
        const endpoint = isParcel
          ? `${API_BASE}/rides/${orderId}/track`
          : isRide
          ? `${API_BASE}/rides/${orderId}/track`
          : isPharmacyType
          ? `${API_BASE}/pharmacy-orders/${orderId}/track`
          : `${API_BASE}/orders/${orderId}/track`;

        const res = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const d = await res.json();
          if (mountedRef.current) {
            setRiderLat(d.riderLat ?? null);
            setRiderLng(d.riderLng ?? null);
            setEtaMinutes(d.etaMinutes ?? null);
            setTrackFailed(false);
          }
        }
      } catch {
        if (mountedRef.current) setTrackFailed(true);
      }
    };

    ivRef = setInterval(fetchTrack, 15000);
    fetchTrack();
    return () => { if (ivRef !== null) clearInterval(ivRef); };
  }, [order?.status, orderId, token, isParcel, isRide, isPharmacyType]);

  useEffect(() => {
    mountedRef.current = true;
    if (!orderId) return;
    const endpoint = isParcel
      ? `${API_BASE}/parcel-bookings/${orderId}`
      : isPharmacyType
      ? `${API_BASE}/pharmacy-orders/${orderId}`
      : isRide
      ? `${API_BASE}/rides/${orderId}`
      : `${API_BASE}/orders/${orderId}`;
    let ivRef: ReturnType<typeof setInterval> | null = null;
    const fetchAndMaybeClear = async () => {
      try {
        const res = await fetch(endpoint, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const serverDate = res.headers.get("Date");
        if (serverDate && mountedRef.current) {
          setServerNow(new Date(serverDate).getTime());
        }
        const data = await res.json();
        const fetched = data.order || data.booking || data;
        if (mountedRef.current) {
          setOrder(fetched);
          if (fetched && ["delivered", "cancelled", "completed"].includes(fetched.status)) {
            if (ivRef !== null) clearInterval(ivRef);
          }
        }
      } catch {
        if (mountedRef.current) {
          showToast(isParcel ? T("parcelLoadError") : T("orderLoadError"), "error");
        }
      }
      if (mountedRef.current) setLoading(false);
    };
    fetchAndMaybeClear();
    ivRef = setInterval(fetchAndMaybeClear, 10000);
    return () => {
      mountedRef.current = false;
      if (ivRef !== null) clearInterval(ivRef);
    };
  }, [orderId, isParcel, isRide]);

  const mapUrl = useMemo(() => {
    if (riderLat === null || riderLng === null) return null;
    return staticMapUrl(
      [
        { lat: riderLat, lng: riderLng, color: "blue" },
        ...(order?.deliveryLat && order?.deliveryLng
          ? [{ lat: Number(order.deliveryLat), lng: Number(order.deliveryLng), color: "red" }]
          : []),
      ],
      { width: 600, height: 180, zoom: 14 },
    );
  }, [riderLat, riderLng, order?.deliveryLat, order?.deliveryLng]);

  if (loading) {
    return (
      <View style={[s.root, { paddingTop: topPad }]}>
        <View style={s.loadingWrap}>
          <ActivityIndicator color={C.primary} size="large" />
          <Text style={s.loadingText}>{isParcel ? "Loading parcel..." : "Loading order..."}</Text>
        </View>
      </View>
    );
  }

  if (!order) {
    return (
      <View style={[s.root, { paddingTop: topPad }]}>
        <View style={s.headerBar}>
          <Pressable onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={20} color={C.text} />
          </Pressable>
          <Text style={s.headerTitle}>{isParcel ? "Parcel Details" : isRide ? "Ride Details" : "Order Details"}</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={s.loadingWrap}>
          <Ionicons name="alert-circle-outline" size={48} color={C.textMuted} />
          <Text style={s.loadingText}>{isParcel ? "Parcel not found" : isRide ? "Ride not found" : "Order not found"}</Text>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, marginTop: 4 }}>This order may have been removed or you may not have access.</Text>
          <Pressable
            onPress={() => router.replace("/(tabs)")}
            style={{ marginTop: 20, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: C.primary, borderRadius: 14 }}
          >
            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#fff" }}>Go to Home</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const RIDE_STEPS = ["searching", "accepted", "arrived", "in_transit", "completed"];
  const RIDE_STEP_LABELS = [T("searching"), T("statusAccepted"), T("arrived"), T("inTransit"), T("completed")];

  const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG["pending"]!;
  const isActive = !["delivered", "cancelled", "completed"].includes(order.status);
  const activeSteps = isParcel ? PARCEL_STEPS : isRide ? RIDE_STEPS : STATUS_STEPS;
  const activeStepLabels = isParcel ? PARCEL_STEP_LABELS : isRide ? RIDE_STEP_LABELS : STEP_LABELS;
  const stepIdx = activeSteps.indexOf(order.status);
  const isFood = order.type === "food";
  const isPharmacy = order.type === "pharmacy" || type === "pharmacy";
  const isParcelType = isParcel || order.type === "parcel";

  const minutesSincePlaced = order.createdAt
    ? (serverNow - new Date(order.createdAt).getTime()) / 60000
    : 999;
  const cancelWindowMin = config.orderRules?.cancelWindowMin ?? 15;
  const canCancel = isParcelType
    ? ["pending", "accepted"].includes(order.status)
    : isRide
    ? ["searching", "bargaining", "accepted", "arrived"].includes(order.status)
    : ["pending", "confirmed"].includes(order.status) && minutesSincePlaced <= cancelWindowMin;

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      <View style={s.headerBar}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>{isParcel ? "Parcel Details" : isRide ? "Ride Details" : "Order Details"}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        <View style={[s.statusCard, { borderColor: cfg.bg }]}>
          <View style={[s.statusIcon, { backgroundColor: cfg.bg }]}>
            <Ionicons name={cfg.icon as any} size={28} color={cfg.color} />
          </View>
          <Text style={[s.statusLabel, { color: cfg.color }]}>{cfg.label}</Text>
          <Text style={s.orderId}>#{(order.id || orderId || "").slice(-8).toUpperCase()}</Text>
          {isActive && order.estimatedTime && (
            <View style={s.etaChip}>
              <Ionicons name="time-outline" size={13} color="#D97706" />
              <Text style={s.etaText}>ETA: {order.estimatedTime}</Text>
            </View>
          )}
        </View>

        {isActive && LIVE_TRACKING_STATUSES.includes(order.status) && (
          <View style={[s.card, { backgroundColor: "#ECFDF5", borderColor: "#6EE7B7", padding: 0, overflow: "hidden" }]}>
            {/* Tracking failure banner */}
            {trackFailed && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEF3C7", borderBottomWidth: 1, borderBottomColor: "#FDE68A", paddingHorizontal: 14, paddingVertical: 10 }}>
                <Ionicons name="warning-outline" size={15} color="#D97706" />
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#92400E", flex: 1 }}>Live tracking is temporarily unavailable. Your order is still on the way.</Text>
              </View>
            )}
            {/* Static map showing rider position */}
            {mapUrl ? (
              <Image
                source={{ uri: mapUrl }}
                style={{ width: "100%", height: 160 }}
                resizeMode="cover"
              />
            ) : null}
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: riderLat ? 10 : 0 }}>
                <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: "#059669", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="navigate-outline" size={20} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#065F46" }}>
                    {order.status === "in_transit" ? "In Transit" : "On the Way to You"}
                  </Text>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#047857", marginTop: 2 }}>
                    {etaMinutes !== null ? `ETA: ~${etaMinutes} min` : "Your delivery is heading your way"}
                  </Text>
                </View>
                <View style={{ backgroundColor: "#059669", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 11, color: "#fff" }}>LIVE</Text>
                </View>
              </View>
              {order.deliveryAddress ? (
                <Pressable
                  onPress={() => {
                    const encodedAddr = encodeURIComponent(order.deliveryAddress);
                    const url = Platform.OS === "ios"
                      ? `maps:?q=${encodedAddr}`
                      : `geo:0,0?q=${encodedAddr}`;
                    Linking.openURL(url).catch(() => {
                      Linking.openURL(`https://maps.google.com/?q=${encodedAddr}`);
                    });
                  }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: "#A7F3D0" }}
                >
                  <Ionicons name="location-outline" size={16} color="#059669" />
                  <Text style={{ flex: 1, fontFamily: "Inter_400Regular", fontSize: 12, color: "#065F46" }} numberOfLines={1}>
                    {order.deliveryAddress}
                  </Text>
                  <Ionicons name="open-outline" size={14} color="#059669" />
                </Pressable>
              ) : null}
            </View>
          </View>
        )}

        {isActive && stepIdx >= 0 && (
          <View style={s.stepperCard}>
            <Text style={s.sectionTitle}>Order Progress</Text>
            <View style={s.stepperRow}>
              {activeSteps.map((step, i) => {
                const done = stepIdx >= i;
                const active = stepIdx === i;
                const isLast = i === activeSteps.length - 1;
                return (
                  <React.Fragment key={step}>
                    <View style={s.stepItem}>
                      <View style={[
                        s.stepDot,
                        done && { backgroundColor: active ? cfg.color : "#10B981" },
                        active && { shadowColor: cfg.color, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 6 },
                      ]}>
                        {done
                          ? <Ionicons name="checkmark" size={13} color="#fff" />
                          : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#CBD5E1" }} />}
                      </View>
                      <Text style={[s.stepLabel, done && { color: C.text }, active && { fontFamily: "Inter_700Bold" }]}>
                        {activeStepLabels[i]}
                      </Text>
                    </View>
                    {!isLast && (
                      <View style={[s.stepLine, stepIdx > i && { backgroundColor: "#10B981" }]} />
                    )}
                  </React.Fragment>
                );
              })}
            </View>
          </View>
        )}

        {isRide ? (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <View style={[s.typeChip, { backgroundColor: "#FEF3C7" }]}>
                <Ionicons name="car-outline" size={13} color="#D97706" />
                <Text style={[s.typeChipText, { color: "#D97706" }]}>Ride · {(order.type || "").charAt(0).toUpperCase() + (order.type || "").slice(1)}</Text>
              </View>
            </View>
            <View style={{ gap: 12, marginTop: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#10B981", marginTop: 4 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted }}>Pickup</Text>
                  <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: C.text, marginTop: 2 }}>{order.pickupAddress || "—"}</Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#EF4444", marginTop: 4 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted }}>Drop-off</Text>
                  <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: C.text, marginTop: 2 }}>{order.dropAddress || "—"}</Text>
                </View>
              </View>
              {order.distance ? (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1, backgroundColor: C.surfaceSecondary, borderRadius: 10, padding: 10, alignItems: "center" }}>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted }}>Distance</Text>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: C.text, marginTop: 2 }}>{parseFloat(order.distance).toFixed(1)} km</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: C.surfaceSecondary, borderRadius: 10, padding: 10, alignItems: "center" }}>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted }}>Fare</Text>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#D97706", marginTop: 2 }}>Rs. {parseFloat(order.fare || 0).toLocaleString()}</Text>
                  </View>
                </View>
              ) : (
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Fare</Text>
                  <Text style={s.totalAmount}>Rs. {parseFloat(order.fare || 0).toLocaleString()}</Text>
                </View>
              )}
            </View>
          </View>
        ) : (
          <View style={s.card}>
            <View style={s.cardHeader}>
              {isPharmacy ? (
                <View style={[s.typeChip, { backgroundColor: "#F3E8FF" }]}>
                  <Ionicons name="medical-outline" size={13} color="#7C3AED" />
                  <Text style={[s.typeChipText, { color: "#7C3AED" }]}>Pharmacy</Text>
                </View>
              ) : isParcelType ? (
                <View style={[s.typeChip, { backgroundColor: "#ECFDF5" }]}>
                  <Ionicons name="cube-outline" size={13} color="#059669" />
                  <Text style={[s.typeChipText, { color: "#059669" }]}>Parcel</Text>
                </View>
              ) : (
                <View style={[s.typeChip, { backgroundColor: isFood ? "#FEF3C7" : "#EFF6FF" }]}>
                  <Ionicons name={isFood ? "restaurant-outline" : "storefront-outline"} size={13} color={isFood ? "#D97706" : "#1A56DB"} />
                  <Text style={[s.typeChipText, { color: isFood ? "#D97706" : "#1A56DB" }]}>{isFood ? "Food" : "Mart"}</Text>
                </View>
              )}
              {order.vendorName && <Text style={s.vendorName}>{order.vendorName}</Text>}
            </View>

            {isPharmacy && order.prescriptionNote ? (
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#F3E8FF", borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: "#DDD6FE" }}>
                <Ionicons name="document-text-outline" size={16} color="#7C3AED" style={{ marginTop: 1 }} />
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: "#5B21B6", flex: 1, lineHeight: 19 }}>{order.prescriptionNote}</Text>
              </View>
            ) : null}

            <Text style={s.sectionTitle}>Items</Text>
            {(order.items || []).map((item: any, i: number) => (
              <View key={i} style={s.itemRow}>
                <View style={s.itemQty}>
                  <Text style={s.itemQtyText}>{item.quantity}×</Text>
                </View>
                <Text style={s.itemName} numberOfLines={2}>{item.name}</Text>
                <Text style={s.itemPrice}>Rs. {item.price * item.quantity}</Text>
              </View>
            ))}

            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Total</Text>
              <Text style={s.totalAmount}>Rs. {order.total?.toLocaleString()}</Text>
            </View>
          </View>
        )}

        {!isRide && order.deliveryAddress && (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Delivery Address</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="location-outline" size={18} color={C.primary} />
              </View>
              <Text style={s.addressText}>{order.deliveryAddress}</Text>
            </View>
          </View>
        )}

        {order.riderName && (
          <View style={s.card}>
            <Text style={s.sectionTitle}>{isRide ? "Your Driver" : "Delivery Rider"}</Text>
            <View style={s.riderRow}>
              <View style={s.riderAvatar}>
                <Text style={s.riderInitial}>{order.riderName.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.riderName}>{order.riderName}</Text>
                {order.riderPhone && <Text style={s.riderPhone}>{order.riderPhone}</Text>}
              </View>
              {order.riderPhone && (
                <Pressable onPress={() => Linking.openURL(`tel:${order.riderPhone}`)} style={s.callBtn}>
                  <Ionicons name="call" size={18} color="#fff" />
                </Pressable>
              )}
            </View>
          </View>
        )}

        <View style={s.card}>
          <Text style={s.sectionTitle}>Payment</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: "#D1FAE5", alignItems: "center", justifyContent: "center" }}>
              <Ionicons
                name={
                  order.paymentMethod === "wallet"
                    ? "wallet-outline"
                    : order.paymentMethod === "jazzcash" || order.paymentMethod === "easypaisa"
                    ? "phone-portrait-outline"
                    : "cash-outline"
                }
                size={18}
                color="#059669"
              />
            </View>
            <Text style={s.paymentText}>
              {order.paymentMethod === "wallet"
                ? "Wallet"
                : order.paymentMethod === "jazzcash"
                ? "JazzCash"
                : order.paymentMethod === "easypaisa"
                ? "EasyPaisa"
                : "Cash on Delivery"}
            </Text>
          </View>
        </View>

        {canCancel && (
          <Pressable
            style={s.cancelOrderBtn}
            onPress={() => {
              const cancelMinsLeft = isParcelType
                ? undefined
                : Math.max(0, Math.ceil(cancelWindowMin - minutesSincePlaced));
              setCancelTarget({
                id: order.id,
                type: isRide ? "ride" : isParcelType ? "parcel" : isPharmacy ? "pharmacy" : "order",
                status: order.status,
                total: isRide ? parseFloat(order.fare ?? "0") : isParcelType ? parseFloat(order.fare ?? order.total ?? "0") : order.total,
                paymentMethod: order.paymentMethod,
                cancelMinsLeft,
              });
            }}
          >
            <Ionicons name="close-circle-outline" size={16} color="#DC2626" />
            <Text style={s.cancelOrderBtnText}>{isRide ? "Cancel Ride" : isParcelType ? "Cancel Booking" : "Cancel Order"}</Text>
          </Pressable>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {cancelTarget && (
        <CancelModal
          target={cancelTarget}
          cancellationFee={order?.cancellationFee ?? config.rides?.cancellationFee ?? 0}
          apiBase={API_BASE}
          token={token}
          onClose={() => setCancelTarget(null)}
          onDone={(result) => {
            showToast(T("orderCancelledSuccess"), "success");
            setOrder((prev: any) => prev ? { ...prev, status: "cancelled" } : prev);
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },
  headerBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 18, color: C.text },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted },
  scroll: { padding: 16, gap: 14 },
  statusCard: {
    backgroundColor: "#fff", borderRadius: 20, padding: 24, alignItems: "center",
    borderWidth: 1.5, gap: 8,
  },
  statusIcon: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  statusLabel: { fontFamily: "Inter_700Bold", fontSize: 20 },
  orderId: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.textMuted },
  etaChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FEF3C7", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, marginTop: 4 },
  etaText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: "#92400E" },
  stepperCard: { backgroundColor: "#fff", borderRadius: 20, padding: 18, borderWidth: 1, borderColor: C.border },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 14, color: C.text, marginBottom: 14 },
  stepperRow: { flexDirection: "row", alignItems: "flex-start" },
  stepItem: { alignItems: "center", flex: 1, gap: 6 },
  stepDot: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: "#F1F5F9",
    alignItems: "center", justifyContent: "center",
  },
  stepLabel: { fontSize: 9, textAlign: "center", color: C.textMuted, fontFamily: "Inter_400Regular" },
  stepLine: { height: 2, flex: 0.4, backgroundColor: "#F1F5F9", marginTop: 13, borderRadius: 1 },
  card: { backgroundColor: "#fff", borderRadius: 20, padding: 18, borderWidth: 1, borderColor: C.border },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  typeChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  typeChipText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  vendorName: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.text },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  itemQty: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  itemQtyText: { fontFamily: "Inter_700Bold", fontSize: 12, color: C.primary },
  itemName: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 13, color: C.text },
  itemPrice: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14, paddingTop: 14, borderTopWidth: 1.5, borderTopColor: C.border },
  totalLabel: { fontFamily: "Inter_700Bold", fontSize: 15, color: C.text },
  totalAmount: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.success },
  addressText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 13, color: C.text, lineHeight: 20 },
  riderRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  riderAvatar: { width: 44, height: 44, borderRadius: 14, backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center" },
  riderInitial: { fontFamily: "Inter_700Bold", fontSize: 18, color: C.primary },
  riderName: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.text },
  riderPhone: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, marginTop: 2 },
  callBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" },
  paymentText: { fontFamily: "Inter_500Medium", fontSize: 14, color: C.text },
  cancelOrderBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: 16, backgroundColor: "#FEF2F2",
    borderWidth: 1.5, borderColor: "#FECACA",
  },
  cancelOrderBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: "#DC2626" },
});
