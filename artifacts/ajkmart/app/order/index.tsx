import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { CancelModal } from "@/components/CancelModal";
import type { CancelTarget } from "@/components/CancelModal";
import { API_BASE } from "@/utils/api";

const C = Colors.light;

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: string; label: string }> = {
  pending:          { color: "#D97706", bg: "#FEF3C7", icon: "time-outline",            label: "Pending" },
  confirmed:        { color: "#2563EB", bg: "#DBEAFE", icon: "checkmark-circle-outline", label: "Confirmed" },
  preparing:        { color: "#7C3AED", bg: "#EDE9FE", icon: "flame-outline",            label: "Preparing" },
  ready:            { color: "#6366F1", bg: "#E0E7FF", icon: "bag-check-outline",       label: "Ready" },
  picked_up:        { color: "#0891B2", bg: "#CFFAFE", icon: "cube-outline",            label: "Picked Up" },
  out_for_delivery: { color: "#059669", bg: "#D1FAE5", icon: "bicycle-outline",          label: "On the Way" },
  delivered:        { color: "#6B7280", bg: "#F3F4F6", icon: "checkmark-done-outline",   label: "Delivered" },
  cancelled:        { color: "#DC2626", bg: "#FEE2E2", icon: "close-circle-outline",     label: "Cancelled" },
};

const STEPS = ["pending", "confirmed", "preparing", "out_for_delivery", "delivered"];
const STEP_LABELS = ["Placed", "Confirmed", "Preparing", "On Way", "Delivered"];
const PARCEL_STEPS = ["pending", "accepted", "in_transit", "completed"];
const PARCEL_STEP_LABELS = ["Placed", "Accepted", "In Transit", "Delivered"];

export default function OrderDetailScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const { orderId, type } = useLocalSearchParams<{ orderId: string; type?: string }>();
  const isParcel = type === "parcel";
  const { token } = useAuth();
  const { showToast } = useToast();
  const { config } = usePlatformConfig();
  const [order, setOrder] = useState<any>(null);
  const [serverNow, setServerNow] = useState<number>(Date.now());
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!orderId) return;
    const endpoint = isParcel
      ? `${API_BASE}/parcel-bookings/${orderId}`
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
          showToast(isParcel ? "Could not load parcel details" : "Could not load order details", "error");
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
  }, [orderId, isParcel]);

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
          <Text style={s.headerTitle}>{isParcel ? "Parcel Details" : "Order Details"}</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={s.loadingWrap}>
          <Ionicons name="alert-circle-outline" size={48} color={C.textMuted} />
          <Text style={s.loadingText}>{isParcel ? "Parcel not found" : "Order not found"}</Text>
        </View>
      </View>
    );
  }

  const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG["pending"]!;
  const isActive = !["delivered", "cancelled", "completed"].includes(order.status);
  const activeSteps = isParcel ? PARCEL_STEPS : STEPS;
  const activeStepLabels = isParcel ? PARCEL_STEP_LABELS : STEP_LABELS;
  const stepIdx = activeSteps.indexOf(order.status);
  const isFood = order.type === "food";

  const minutesSincePlaced = order.createdAt
    ? (serverNow - new Date(order.createdAt).getTime()) / 60000
    : 999;
  const canCancel = ["pending", "confirmed"].includes(order.status) &&
    minutesSincePlaced <= (config.orderRules?.cancelWindowMin ?? 15);

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      <View style={s.headerBar}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>{isParcel ? "Parcel Details" : "Order Details"}</Text>
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

        <View style={s.card}>
          <View style={s.cardHeader}>
            <View style={[s.typeChip, { backgroundColor: isFood ? "#FEF3C7" : "#EFF6FF" }]}>
              <Ionicons name={isFood ? "restaurant-outline" : "storefront-outline"} size={13} color={isFood ? "#D97706" : "#1A56DB"} />
              <Text style={[s.typeChipText, { color: isFood ? "#D97706" : "#1A56DB" }]}>{isFood ? "Food" : "Mart"}</Text>
            </View>
            {order.vendorName && <Text style={s.vendorName}>{order.vendorName}</Text>}
          </View>

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

        {order.deliveryAddress && (
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
            <Text style={s.sectionTitle}>Delivery Rider</Text>
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
              const cancelMinsLeft = Math.max(0, Math.ceil((config.orderRules?.cancelWindowMin ?? 15) - minutesSincePlaced));
              setCancelTarget({
                id: order.id,
                type: "order",
                status: order.status,
                total: order.total,
                paymentMethod: order.paymentMethod,
                cancelMinsLeft,
              });
            }}
          >
            <Ionicons name="close-circle-outline" size={16} color="#DC2626" />
            <Text style={s.cancelOrderBtnText}>Cancel Order</Text>
          </Pressable>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {cancelTarget && (
        <CancelModal
          target={cancelTarget}
          cancellationFee={0}
          apiBase={API_BASE}
          token={token}
          onClose={() => setCancelTarget(null)}
          onDone={(result) => {
            showToast("Order cancelled successfully.", "success");
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
