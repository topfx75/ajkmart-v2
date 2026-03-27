import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState, useCallback } from "react";
import {
  ActivityIndicator,
  Linking,
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
import { LinearGradient } from "expo-linear-gradient";

import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { useGetOrders } from "@workspace/api-client-react";

const C = Colors.light;

/* ─────────────────────────── Status config ─────────────────────────── */
const ORDER_STATUS: Record<string, { color: string; bg: string; icon: string; label: string }> = {
  pending:          { color: "#D97706", bg: "#FEF3C7", icon: "time-outline",            label: "Pending" },
  confirmed:        { color: "#2563EB", bg: "#DBEAFE", icon: "checkmark-circle-outline", label: "Confirmed" },
  preparing:        { color: "#7C3AED", bg: "#EDE9FE", icon: "flame-outline",            label: "Preparing" },
  out_for_delivery: { color: "#059669", bg: "#D1FAE5", icon: "bicycle-outline",          label: "On the Way" },
  delivered:        { color: "#6B7280", bg: "#F3F4F6", icon: "checkmark-done-outline",   label: "Delivered" },
  cancelled:        { color: "#DC2626", bg: "#FEE2E2", icon: "close-circle-outline",     label: "Cancelled" },
};

const RIDE_STATUS: Record<string, { color: string; bg: string; icon: string; label: string }> = {
  searching:  { color: "#D97706", bg: "#FEF3C7", icon: "search-outline",            label: "Finding Rider" },
  accepted:   { color: "#2563EB", bg: "#DBEAFE", icon: "person-outline",            label: "Rider Accepted" },
  arrived:    { color: "#7C3AED", bg: "#EDE9FE", icon: "location-outline",          label: "Rider Arrived" },
  in_transit: { color: "#059669", bg: "#D1FAE5", icon: "car-outline",               label: "In Transit" },
  ongoing:    { color: "#059669", bg: "#D1FAE5", icon: "car-outline",               label: "In Transit" },
  completed:  { color: "#6B7280", bg: "#F3F4F6", icon: "checkmark-done-outline",    label: "Completed" },
  cancelled:  { color: "#DC2626", bg: "#FEE2E2", icon: "close-circle-outline",      label: "Cancelled" },
};

const PARCEL_STATUS: Record<string, { color: string; bg: string; icon: string; label: string }> = {
  pending:    { color: "#D97706", bg: "#FEF3C7", icon: "time-outline",              label: "Awaiting Rider" },
  accepted:   { color: "#2563EB", bg: "#DBEAFE", icon: "person-outline",            label: "Rider Assigned" },
  in_transit: { color: "#059669", bg: "#D1FAE5", icon: "cube-outline",              label: "In Transit" },
  completed:  { color: "#6B7280", bg: "#F3F4F6", icon: "checkmark-done-outline",    label: "Delivered" },
  cancelled:  { color: "#DC2626", bg: "#FEE2E2", icon: "close-circle-outline",      label: "Cancelled" },
};

/* ─────────────────────────── Tab config ─────────────────────────── */
const TABS = [
  { key: "all",      label: "All",       icon: "layers-outline" },
  { key: "mart",     label: "Mart",      icon: "storefront-outline" },
  { key: "food",     label: "Food",      icon: "restaurant-outline" },
  { key: "rides",    label: "Rides",     icon: "car-outline" },
  { key: "pharmacy", label: "Pharmacy",  icon: "medical-outline" },
  { key: "parcel",   label: "Parcel",    icon: "cube-outline" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/* ─────────────────────────── Grocery/Food Card ─────────────────────────── */
function OrderCard({ order, liveTracking, reviews, cancelWindowMin, refundDays, ratingWindowHours, onRate, onCancel }: {
  order: any;
  liveTracking: boolean;
  reviews: boolean;
  cancelWindowMin: number;
  refundDays: number;
  ratingWindowHours: number;
  onRate: (o: any) => void;
  onCancel: (o: any) => void;
}) {
  const cfg = ORDER_STATUS[order.status] || ORDER_STATUS["pending"]!;
  const isFood = order.type === "food";
  const isDelivered = order.status === "delivered";
  const isCancelled = order.status === "cancelled";
  const isActive = !["delivered", "cancelled"].includes(order.status);

  // Cancel window calculation
  const minutesSincePlaced = order.createdAt
    ? (Date.now() - new Date(order.createdAt).getTime()) / 60000
    : 999;
  const canCancel = order.status === "pending" && minutesSincePlaced <= cancelWindowMin;
  const cancelMinsLeft = Math.max(0, Math.ceil(cancelWindowMin - minutesSincePlaced));

  // Rating window: only show rate button if within ratingWindowHours after delivery
  const hourssinceDelivery = order.updatedAt
    ? (Date.now() - new Date(order.updatedAt).getTime()) / 3600000
    : 0;
  const canRate = reviews && isDelivered && !order._reviewed && hourssinceDelivery <= ratingWindowHours;

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={[styles.chip, { backgroundColor: isFood ? "#FFF3E0" : "#E3F2FD" }]}>
          <Ionicons
            name={isFood ? "restaurant-outline" : "storefront-outline"}
            size={13}
            color={isFood ? "#E65100" : "#0D47A1"}
          />
          <Text style={[styles.chipText, { color: isFood ? "#E65100" : "#0D47A1" }]}>
            {isFood ? "Food" : "Mart"}
          </Text>
        </View>
        <Text style={styles.cardId}>#{order.id.slice(-8).toUpperCase()}</Text>
      </View>

      <View style={styles.cardItems}>
        {(order.items || []).slice(0, 2).map((item: any, i: number) => (
          <View key={i} style={styles.itemRow}>
            <View style={styles.itemDot} />
            <Text style={styles.itemText} numberOfLines={1}>{item.quantity}× {item.name}</Text>
            <Text style={styles.itemPrice}>Rs. {item.price * item.quantity}</Text>
          </View>
        ))}
        {(order.items || []).length > 2 && (
          <Text style={styles.moreItems}>+{order.items.length - 2} more items</Text>
        )}
      </View>

      <View style={styles.cardFooter}>
        <View style={[styles.statusChip, { backgroundColor: cfg.bg }]}>
          <Ionicons name={cfg.icon as any} size={13} color={cfg.color} />
          <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        <View style={styles.totalWrap}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalAmount}>Rs. {order.total?.toLocaleString()}</Text>
        </View>
      </View>

      {liveTracking && order.estimatedTime && isActive && (
        <View style={styles.etaBar}>
          <Ionicons name="time-outline" size={12} color={C.primary} />
          <Text style={styles.etaText}>ETA: {order.estimatedTime}</Text>
          <View style={styles.payBadge}>
            <Ionicons
              name={order.paymentMethod === "wallet" ? "wallet-outline" : "cash-outline"}
              size={11} color={C.textMuted}
            />
            <Text style={styles.payText}>{order.paymentMethod === "wallet" ? "Wallet" : "Cash"}</Text>
          </View>
        </View>
      )}

      {!liveTracking && isActive && (
        <View style={[styles.etaBar, { backgroundColor: "#FFF8E1", borderRadius: 8, paddingHorizontal: 10 }]}>
          <Ionicons name="navigate-circle-outline" size={13} color="#D97706" />
          <Text style={[styles.etaText, { color: "#92400E" }]}>Live tracking temporarily unavailable</Text>
        </View>
      )}

      {/* Cancel button — only within cancel window on pending orders */}
      {canCancel && (
        <Pressable style={styles.cancelBtn} onPress={() => onCancel(order)}>
          <Ionicons name="close-circle-outline" size={14} color="#DC2626" />
          <Text style={styles.cancelBtnText}>Cancel Order ({cancelMinsLeft}m left)</Text>
        </Pressable>
      )}

      {/* Rate button — only within rating window */}
      {canRate && (
        <Pressable style={styles.rateBtn} onPress={() => onRate(order)}>
          <Ionicons name="star-outline" size={14} color="#F59E0B" />
          <Text style={styles.rateBtnText}>Rate this order</Text>
        </Pressable>
      )}

      {order._reviewed && (
        <View style={styles.reviewedBadge}>
          <Ionicons name="star" size={13} color="#F59E0B" />
          <Text style={styles.reviewedText}>Reviewed — Thank you!</Text>
        </View>
      )}

      {/* Refund info on cancelled orders */}
      {isCancelled && order.paymentMethod !== "cash" && refundDays > 0 && (
        <View style={styles.refundBar}>
          <Ionicons name="return-down-back-outline" size={12} color="#059669" />
          <Text style={styles.refundText}>Refund {refundDays} din mein process hoga</Text>
        </View>
      )}
    </View>
  );
}

/* ─────────────────────────── Ride Card ─────────────────────────── */
function RideCard({ ride, liveTracking, reviews, onRate, onCancel }: {
  ride: any;
  liveTracking: boolean;
  reviews: boolean;
  onRate: (o: any) => void;
  onCancel: (o: any) => void;
}) {
  const cfg = RIDE_STATUS[ride.status] || RIDE_STATUS["searching"]!;
  const isActive    = !["completed", "cancelled"].includes(ride.status);
  const isCompleted = ride.status === "completed";
  const canCancel   = ["searching", "accepted"].includes(ride.status);
  const hasRider    = ["accepted", "arrived", "in_transit", "ongoing"].includes(ride.status);

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={[styles.chip, { backgroundColor: "#E8F5E9" }]}>
          <Ionicons
            name={ride.type === "bike" ? "bicycle-outline" : "car-outline"}
            size={13} color="#1B5E20"
          />
          <Text style={[styles.chipText, { color: "#1B5E20" }]}>
            {ride.type === "bike" ? "Bike Ride" : "Car Ride"}
          </Text>
        </View>
        <Text style={styles.cardId}>#{ride.id.slice(-8).toUpperCase()}</Text>
      </View>

      <View style={styles.rideRoute}>
        <View style={styles.ridePoint}>
          <View style={[styles.routeDot, { backgroundColor: "#10B981" }]} />
          <Text style={styles.rideAddr} numberOfLines={1}>{ride.pickupAddress || "Pickup Location"}</Text>
        </View>
        <View style={styles.routeLine} />
        <View style={styles.ridePoint}>
          <View style={[styles.routeDot, { backgroundColor: "#EF4444" }]} />
          <Text style={styles.rideAddr} numberOfLines={1}>{ride.dropAddress || "Drop Location"}</Text>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <View style={[styles.statusChip, { backgroundColor: cfg.bg }]}>
          <Ionicons name={cfg.icon as any} size={13} color={cfg.color} />
          <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        <View style={styles.totalWrap}>
          <Text style={styles.totalLabel}>{ride.distance ? `${ride.distance} km` : "Fare"}</Text>
          <Text style={styles.totalAmount}>Rs. {ride.fare?.toLocaleString()}</Text>
        </View>
      </View>

      {/* Rider info — show name & phone once a rider accepts */}
      {hasRider && ride.riderName && (
        <View style={styles.etaBar}>
          <Ionicons name="person-outline" size={12} color="#2563EB" />
          <Text style={[styles.etaText, { flex: 1 }]}>
            Driver: {ride.riderName}{ride.riderPhone ? ` · ${ride.riderPhone}` : ""}
          </Text>
          {ride.riderPhone && (
            <Pressable onPress={() => Linking.openURL(`tel:${ride.riderPhone}`)}>
              <Ionicons name="call-outline" size={14} color="#2563EB" />
            </Pressable>
          )}
        </View>
      )}

      {/* Payment info bar */}
      {isActive && (
        <View style={styles.etaBar}>
          <Ionicons name={ride.paymentMethod === "wallet" ? "wallet-outline" : "cash-outline"} size={12} color={C.primary} />
          <Text style={styles.etaText}>
            {ride.paymentMethod === "wallet" ? "Paid via Wallet" : "Cash Payment"}
          </Text>
        </View>
      )}

      {/* Cancel button for searching/accepted rides */}
      {canCancel && (
        <Pressable style={styles.cancelBtn} onPress={() => onCancel(ride)}>
          <Ionicons name="close-circle-outline" size={14} color="#DC2626" />
          <Text style={styles.cancelBtnText}>
            {ride.status === "accepted" ? "Cancel Ride (fee may apply)" : "Cancel Ride"}
          </Text>
        </Pressable>
      )}

      {reviews && isCompleted && !ride._reviewed && (
        <Pressable style={styles.rateBtn} onPress={() => onRate({ ...ride, _type: "ride" })}>
          <Ionicons name="star-outline" size={14} color="#F59E0B" />
          <Text style={styles.rateBtnText}>Rate this ride</Text>
        </Pressable>
      )}

      {ride._reviewed && (
        <View style={styles.reviewedBadge}>
          <Ionicons name="star" size={13} color="#F59E0B" />
          <Text style={styles.reviewedText}>Reviewed — Thank you!</Text>
        </View>
      )}
    </View>
  );
}

/* ─────────────────────────── Pharmacy Card ─────────────────────────── */
function PharmacyCard({ order, reviews, onRate }: {
  order: any;
  reviews: boolean;
  onRate: (o: any) => void;
}) {
  const cfg = ORDER_STATUS[order.status] || ORDER_STATUS["pending"]!;
  const isDelivered = order.status === "delivered";

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={[styles.chip, { backgroundColor: "#FCE4EC" }]}>
          <Ionicons name="medical-outline" size={13} color="#880E4F" />
          <Text style={[styles.chipText, { color: "#880E4F" }]}>Pharmacy</Text>
        </View>
        <Text style={styles.cardId}>#{order.id.slice(-8).toUpperCase()}</Text>
      </View>

      {order.prescriptionNote && (
        <View style={styles.noteRow}>
          <Ionicons name="document-text-outline" size={14} color={C.textMuted} />
          <Text style={styles.noteText} numberOfLines={2}>{order.prescriptionNote}</Text>
        </View>
      )}

      <View style={styles.cardItems}>
        {(order.items || []).slice(0, 2).map((item: any, i: number) => (
          <View key={i} style={styles.itemRow}>
            <View style={styles.itemDot} />
            <Text style={styles.itemText} numberOfLines={1}>{item.quantity}× {item.name}</Text>
            <Text style={styles.itemPrice}>Rs. {item.price * item.quantity}</Text>
          </View>
        ))}
        {(order.items || []).length > 2 && (
          <Text style={styles.moreItems}>+{order.items.length - 2} more items</Text>
        )}
      </View>

      <View style={styles.cardFooter}>
        <View style={[styles.statusChip, { backgroundColor: cfg.bg }]}>
          <Ionicons name={cfg.icon as any} size={13} color={cfg.color} />
          <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        <View style={styles.totalWrap}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalAmount}>Rs. {order.total?.toLocaleString()}</Text>
        </View>
      </View>

      {reviews && isDelivered && !order._reviewed && (
        <Pressable style={styles.rateBtn} onPress={() => onRate({ ...order, _type: "pharmacy" })}>
          <Ionicons name="star-outline" size={14} color="#F59E0B" />
          <Text style={styles.rateBtnText}>Rate this order</Text>
        </Pressable>
      )}

      {order._reviewed && (
        <View style={styles.reviewedBadge}>
          <Ionicons name="star" size={13} color="#F59E0B" />
          <Text style={styles.reviewedText}>Reviewed — Thank you!</Text>
        </View>
      )}
    </View>
  );
}

/* ─────────────────────────── Parcel Card ─────────────────────────── */
function ParcelCard({ booking }: { booking: any }) {
  const cfg = PARCEL_STATUS[booking.status] || PARCEL_STATUS["pending"]!;
  const isActive = !["completed", "cancelled"].includes(booking.status);
  const parcelLabel = booking.parcelType
    ? booking.parcelType.charAt(0).toUpperCase() + booking.parcelType.slice(1)
    : "Parcel";

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={[styles.chip, { backgroundColor: "#FFF8E1" }]}>
          <Ionicons name="cube-outline" size={13} color="#E65100" />
          <Text style={[styles.chipText, { color: "#E65100" }]}>Parcel · {parcelLabel}</Text>
        </View>
        <Text style={styles.cardId}>#{booking.id.slice(-8).toUpperCase()}</Text>
      </View>

      <View style={styles.rideRoute}>
        <View style={styles.ridePoint}>
          <View style={[styles.routeDot, { backgroundColor: "#10B981" }]} />
          <Text style={styles.rideAddr} numberOfLines={1}>{booking.pickupAddress || "Pickup"}</Text>
        </View>
        <View style={styles.routeLine} />
        <View style={styles.ridePoint}>
          <View style={[styles.routeDot, { backgroundColor: "#EF4444" }]} />
          <Text style={styles.rideAddr} numberOfLines={1}>{booking.dropAddress || "Drop"}</Text>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <View style={[styles.statusChip, { backgroundColor: cfg.bg }]}>
          <Ionicons name={cfg.icon as any} size={13} color={cfg.color} />
          <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        <View style={styles.totalWrap}>
          <Text style={styles.totalLabel}>Fare</Text>
          <Text style={styles.totalAmount}>Rs. {(booking.fare || booking.estimatedFare)?.toLocaleString()}</Text>
        </View>
      </View>

      {booking.receiverName && (
        <View style={styles.etaBar}>
          <Ionicons name="person-outline" size={12} color={C.primary} />
          <Text style={styles.etaText} numberOfLines={1}>To: {booking.receiverName} · {booking.receiverPhone}</Text>
        </View>
      )}

      {isActive && booking.estimatedTime && (
        <View style={styles.etaBar}>
          <Ionicons name="time-outline" size={12} color="#D97706" />
          <Text style={[styles.etaText, { color: "#92400E" }]}>ETA: {booking.estimatedTime}</Text>
          <View style={styles.payBadge}>
            <Ionicons
              name={booking.paymentMethod === "wallet" ? "wallet-outline" : "cash-outline"}
              size={11} color={C.textMuted}
            />
            <Text style={styles.payText}>
              {booking.paymentMethod === "wallet" ? "Wallet" : booking.paymentMethod === "jazzcash" ? "JazzCash" : booking.paymentMethod === "easypaisa" ? "EasyPaisa" : "Cash"}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

/* ─────────────────────────── Review Modal ─────────────────────────── */
function ReviewModal({ target, userId, apiBase, token, onClose, onDone }: {
  target: any;
  userId: string;
  apiBase: string;
  token: string | null;
  onClose: () => void;
  onDone: (orderId: string) => void;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (rating === 0) { setError("Please select a star rating."); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          orderId: target.id,
          vendorId: target.vendorId ?? null,
          riderId: target.riderId ?? null,
          orderType: target._type ?? target.type ?? "order",
          rating,
          comment: comment.trim() || null,
        }),
      });
      if (res.status === 409) { onDone(target.id); onClose(); return; }
      if (!res.ok) throw new Error("Failed");
      onDone(target.id);
      onClose();
    } catch {
      setError("Could not submit review. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={rm.backdrop} onPress={onClose}>
        <Pressable style={rm.sheet} onPress={() => {}}>
          <View style={rm.handle} />
          <Text style={rm.title}>Rate your experience</Text>
          <Text style={rm.sub}>
            {target._type === "ride"
              ? `Ride #${target.id?.slice(-8).toUpperCase()}`
              : target._type === "pharmacy"
              ? `Pharmacy order #${target.id?.slice(-8).toUpperCase()}`
              : `Order #${target.id?.slice(-8).toUpperCase()}`}
          </Text>

          <View style={rm.stars}>
            {[1, 2, 3, 4, 5].map(s => (
              <Pressable key={s} onPress={() => setRating(s)} hitSlop={10}>
                <Ionicons
                  name={s <= rating ? "star" : "star-outline"}
                  size={36}
                  color={s <= rating ? "#F59E0B" : "#CBD5E1"}
                />
              </Pressable>
            ))}
          </View>

          <TextInput
            style={rm.input}
            placeholder="Optional comment..."
            placeholderTextColor="#94A3B8"
            value={comment}
            onChangeText={setComment}
            multiline
            numberOfLines={3}
            maxLength={300}
          />

          {error ? <Text style={rm.error}>{error}</Text> : null}

          <View style={rm.btns}>
            <Pressable style={rm.cancelBtn} onPress={onClose}>
              <Text style={rm.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={[rm.submitBtn, rating === 0 && { opacity: 0.5 }]} onPress={submit} disabled={loading}>
              {loading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={rm.submitText}>Submit Review</Text>}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const rm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:    { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  handle:   { width: 40, height: 4, backgroundColor: "#CBD5E1", borderRadius: 2, alignSelf: "center", marginBottom: 20 },
  title:    { fontFamily: "Inter_700Bold", fontSize: 20, color: "#0F172A", textAlign: "center", marginBottom: 4 },
  sub:      { fontFamily: "Inter_400Regular", fontSize: 13, color: "#64748B", textAlign: "center", marginBottom: 20 },
  stars:    { flexDirection: "row", justifyContent: "center", gap: 12, marginBottom: 20 },
  input: {
    borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 12,
    padding: 14, fontFamily: "Inter_400Regular", fontSize: 14, color: "#0F172A",
    minHeight: 80, textAlignVertical: "top", marginBottom: 8,
  },
  error:    { fontFamily: "Inter_400Regular", fontSize: 13, color: "#EF4444", textAlign: "center", marginBottom: 8 },
  btns:     { flexDirection: "row", gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  cancelText:{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#64748B" },
  submitBtn: { flex: 2, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  submitText:{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#fff" },
});

/* ─────────────────────────── Section header ─────────────────────────── */
function SectionHeader({ title, count, active }: { title: string; count: number; active?: boolean }) {
  return (
    <View style={styles.secRow}>
      {active && <View style={styles.activeDot} />}
      <Text style={[styles.secTitle, !active && { color: C.textSecondary }]}>{title}</Text>
      <View style={[styles.countBadge, !active && { backgroundColor: C.textMuted }]}>
        <Text style={styles.countText}>{count}</Text>
      </View>
    </View>
  );
}

/* ─────────────────────────── Main Screen ─────────────────────────── */
export default function OrdersScreen() {
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const { config } = usePlatformConfig();
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<any>(null);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const TAB_H  = Platform.OS === "web" ? 84 : 49;

  const orderRules = config.orderRules;

  const handleRate = useCallback((order: any) => {
    if (!reviewedIds.has(order.id)) setReviewTarget(order);
  }, [reviewedIds]);

  const handleReviewDone = useCallback((orderId: string) => {
    setReviewedIds(prev => new Set([...prev, orderId]));
  }, []);

  const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

  /* ── Grocery/Food orders ── */
  const { data: ordersData, isLoading: ordersLoading, refetch: refetchOrders } = useGetOrders(
    { userId: user?.id || "" },
    { query: { enabled: !!user?.id, refetchInterval: 30000 } }
  );

  /* ── Rides ── */
  const [ridesData, setRidesData] = useState<any>(null);
  const [ridesLoading, setRidesLoading] = useState(false);

  /* ── Pharmacy ── */
  const [pharmData, setPharmData] = useState<any>(null);
  const [pharmLoading, setPharmLoading] = useState(false);

  /* ── Parcel ── */
  const [parcelData, setParcelData] = useState<any>(null);
  const [parcelLoading, setParcelLoading] = useState(false);

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  const handleCancel = useCallback(async (order: any) => {
    try {
      const res = await fetch(`${API_BASE}/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ status: "cancelled" }),
      });
      if (!res.ok) throw new Error();
      refetchOrders();
    } catch { /* silent — order list will refresh on next poll */ }
  }, [user, token, refetchOrders, API_BASE]);

  const fetchRides = useCallback(async () => {
    if (!user?.id) return;
    setRidesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/rides`, { headers: authHeaders });
      const d = await res.json();
      setRidesData(d);
    } catch {}
    setRidesLoading(false);
  }, [user?.id, token]);

  const fetchPharmacy = useCallback(async () => {
    if (!user?.id) return;
    setPharmLoading(true);
    try {
      const res = await fetch(`${API_BASE}/pharmacy-orders`, { headers: authHeaders });
      const d = await res.json();
      setPharmData(d);
    } catch {}
    setPharmLoading(false);
  }, [user?.id, token]);

  const fetchParcel = useCallback(async () => {
    if (!user?.id) return;
    setParcelLoading(true);
    try {
      const res = await fetch(`${API_BASE}/parcel-bookings`, { headers: authHeaders });
      const d = await res.json();
      setParcelData(d);
    } catch {}
    setParcelLoading(false);
  }, [user?.id, token]);

  const handleCancelRide = useCallback(async (ride: any) => {
    try {
      await fetch(`${API_BASE}/rides/${ride.id}/cancel`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({}),
      });
      fetchRides();
    } catch { /* ride list will refresh on next poll */ }
  }, [user?.id, token, fetchRides, API_BASE]);

  React.useEffect(() => {
    if (user?.id) {
      fetchRides();
      fetchPharmacy();
      fetchParcel();
    }
  }, [user?.id]);

  // Auto-refresh rides, pharmacy, parcel every 30s (same as orders)
  React.useEffect(() => {
    if (!user?.id) return;
    const interval = setInterval(() => {
      fetchRides();
      fetchPharmacy();
      fetchParcel();
    }, 30000);
    return () => clearInterval(interval);
  }, [user?.id, fetchRides, fetchPharmacy, fetchParcel]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchOrders(), fetchRides(), fetchPharmacy(), fetchParcel()]);
    setRefreshing(false);
  }, [refetchOrders, fetchRides, fetchPharmacy, fetchParcel]);

  const allOrders = [...(ordersData?.orders || [])].reverse();
  const martOrders = allOrders.filter(o => o.type === "mart");
  const foodOrders = allOrders.filter(o => o.type === "food");
  const rides = (ridesData?.rides || []);
  const pharmOrders = (pharmData?.orders || pharmData?.pharmacyOrders || []);
  const parcels = (parcelData?.bookings || parcelData?.parcelBookings || []);

  const totalCount = allOrders.length + rides.length + pharmOrders.length + parcels.length;

  const isLoading = ordersLoading || ridesLoading || pharmLoading || parcelLoading;

  const renderContent = () => {
    if (isLoading && totalCount === 0) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={C.primary} size="large" />
          <Text style={styles.loadingText}>Orders load ho rahe hain...</Text>
        </View>
      );
    }

    if (totalCount === 0) {
      return (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Ionicons name="bag-outline" size={52} color={C.primary} />
          </View>
          <Text style={styles.emptyTitle}>Koi order nahi mila</Text>
          <Text style={styles.emptyText}>
            Shop karein, ride lein ya parcel bhejein — sab yahan dikhega
          </Text>
          <View style={styles.emptyBtns}>
            <Pressable onPress={() => router.push("/mart")} style={styles.emptyBtn}>
              <Ionicons name="storefront-outline" size={15} color="#fff" />
              <Text style={styles.emptyBtnText}>Mart</Text>
            </Pressable>
            <Pressable onPress={() => router.push("/food")} style={[styles.emptyBtn, { backgroundColor: "#E65100" }]}>
              <Ionicons name="restaurant-outline" size={15} color="#fff" />
              <Text style={styles.emptyBtnText}>Food</Text>
            </Pressable>
            <Pressable onPress={() => router.push("/ride")} style={[styles.emptyBtn, { backgroundColor: "#10B981" }]}>
              <Ionicons name="car-outline" size={15} color="#fff" />
              <Text style={styles.emptyBtnText}>Ride</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    /* ── Filter logic ── */
    let showOrders: any[] = [];
    let showMart: any[] = [];
    let showFood: any[] = [];
    let showRides: any[] = rides;
    let showPharm: any[] = pharmOrders;
    let showParcel: any[] = parcels;

    switch (activeTab) {
      case "all":
        showOrders = allOrders;
        break;
      case "mart":
        showMart = martOrders;
        showOrders = [];
        break;
      case "food":
        showFood = foodOrders;
        showOrders = [];
        break;
      case "rides":
        showOrders = [];
        showPharm = [];
        showParcel = [];
        break;
      case "pharmacy":
        showOrders = [];
        showRides = [];
        showParcel = [];
        break;
      case "parcel":
        showOrders = [];
        showRides = [];
        showPharm = [];
        break;
    }

    const displayOrders = activeTab === "all" ? allOrders : activeTab === "mart" ? showMart : activeTab === "food" ? showFood : [];
    const displayRides  = ["all", "rides"].includes(activeTab) ? showRides : [];
    const displayPharm  = ["all", "pharmacy"].includes(activeTab) ? showPharm : [];
    const displayParcel = ["all", "parcel"].includes(activeTab) ? showParcel : [];

    const activeOrders   = displayOrders.filter(o => !["delivered","cancelled"].includes(o.status));
    const pastOrders     = displayOrders.filter(o => ["delivered","cancelled"].includes(o.status));
    const activeRides    = displayRides.filter(r => !["completed","cancelled"].includes(r.status));
    const pastRides      = displayRides.filter(r => ["completed","cancelled"].includes(r.status));
    const activePharm    = displayPharm.filter(o => !["delivered","cancelled"].includes(o.status));
    const pastPharm      = displayPharm.filter(o => ["delivered","cancelled"].includes(o.status));
    const activeParcel   = displayParcel.filter(b => !["completed","cancelled"].includes(b.status));
    const pastParcel     = displayParcel.filter(b => ["completed","cancelled"].includes(b.status));

    const anyActive = activeOrders.length + activeRides.length + activePharm.length + activeParcel.length;
    const anyPast   = pastOrders.length + pastRides.length + pastPharm.length + pastParcel.length;

    if (anyActive + anyPast === 0) {
      return (
        <View style={styles.center}>
          <Ionicons name="search-outline" size={44} color={C.textMuted} />
          <Text style={styles.emptyTitle}>
            {activeTab === "mart" ? "Koi mart order nahi" :
             activeTab === "food" ? "Koi food order nahi" :
             activeTab === "rides" ? "Koi ride nahi" :
             activeTab === "pharmacy" ? "Koi pharmacy order nahi" :
             "Koi parcel booking nahi"}
          </Text>
          <Text style={styles.emptyText}>Is section mein abhi tak koi activity nahi hai</Text>
        </View>
      );
    }

    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        contentContainerStyle={styles.scroll}
      >
        {anyActive > 0 && (
          <>
            <SectionHeader title="Active" count={anyActive} active />
            {activeOrders.map(o => <OrderCard key={o.id} order={{ ...o, _reviewed: reviewedIds.has(o.id) }} liveTracking={config.features.liveTracking} reviews={config.features.reviews} cancelWindowMin={orderRules.cancelWindowMin} refundDays={orderRules.refundDays} ratingWindowHours={orderRules.ratingWindowHours} onRate={handleRate} onCancel={handleCancel} />)}
            {activeRides.map(r => <RideCard key={r.id} ride={{ ...r, _reviewed: reviewedIds.has(r.id) }} liveTracking={config.features.liveTracking} reviews={config.features.reviews} onRate={handleRate} onCancel={handleCancelRide} />)}
            {activePharm.map(o => <PharmacyCard key={o.id} order={{ ...o, _reviewed: reviewedIds.has(o.id) }} reviews={config.features.reviews} onRate={handleRate} />)}
            {activeParcel.map(b => <ParcelCard key={b.id} booking={b} />)}
          </>
        )}

        {anyPast > 0 && (
          <>
            <SectionHeader title="History" count={anyPast} />
            {pastOrders.map(o => <OrderCard key={o.id} order={{ ...o, _reviewed: reviewedIds.has(o.id) }} liveTracking={config.features.liveTracking} reviews={config.features.reviews} cancelWindowMin={orderRules.cancelWindowMin} refundDays={orderRules.refundDays} ratingWindowHours={orderRules.ratingWindowHours} onRate={handleRate} onCancel={handleCancel} />)}
            {pastRides.map(r => <RideCard key={r.id} ride={{ ...r, _reviewed: reviewedIds.has(r.id) }} liveTracking={config.features.liveTracking} reviews={config.features.reviews} onRate={handleRate} onCancel={handleCancelRide} />)}
            {pastPharm.map(o => <PharmacyCard key={o.id} order={{ ...o, _reviewed: reviewedIds.has(o.id) }} reviews={config.features.reviews} onRate={handleRate} />)}
            {pastParcel.map(b => <ParcelCard key={b.id} booking={b} />)}
          </>
        )}
        <View style={{ height: TAB_H + insets.bottom + 20 }} />
      </ScrollView>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      {/* Header */}
      <LinearGradient
        colors={["#0F3BA8", C.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: topPad + 12 }]}
      >
        <Text style={styles.headerTitle}>My Orders</Text>
        <Text style={styles.headerSub}>
          {totalCount > 0 ? `${totalCount} total bookings` : "Track all your activity here"}
        </Text>
      </LinearGradient>

      {/* Tabs */}
      <View style={styles.tabsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {TABS.map(tab => {
            const count =
              tab.key === "all"      ? totalCount :
              tab.key === "mart"     ? martOrders.length :
              tab.key === "food"     ? foodOrders.length :
              tab.key === "rides"    ? rides.length :
              tab.key === "pharmacy" ? pharmOrders.length :
              parcels.length;

            const isActive = activeTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={[styles.tab, isActive && styles.tabActive]}
              >
                <Ionicons
                  name={tab.icon as any}
                  size={14}
                  color={isActive ? "#fff" : C.textSecondary}
                />
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{tab.label}</Text>
                {count > 0 && (
                  <View style={[styles.tabBadge, isActive && { backgroundColor: "rgba(255,255,255,0.35)" }]}>
                    <Text style={[styles.tabBadgeText, isActive && { color: "#fff" }]}>{count}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {renderContent()}

      {reviewTarget && user && (
        <ReviewModal
          target={reviewTarget}
          userId={user.id}
          apiBase={`https://${process.env.EXPO_PUBLIC_DOMAIN}/api`}
          token={token}
          onClose={() => setReviewTarget(null)}
          onDone={handleReviewDone}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 26, color: "#fff", marginBottom: 4 },
  headerSub: { fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,255,255,0.8)" },

  tabsWrap: { backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  tabs: { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  tab: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: C.surfaceSecondary,
  },
  tabActive: { backgroundColor: C.primary },
  tabLabel: { fontFamily: "Inter_500Medium", fontSize: 12, color: C.textSecondary },
  tabLabelActive: { color: "#fff" },
  tabBadge: {
    backgroundColor: C.border, borderRadius: 8,
    minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
  },
  tabBadgeText: { fontFamily: "Inter_700Bold", fontSize: 9, color: C.textMuted },

  scroll: { paddingBottom: 0 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 },
  loadingText: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted },

  emptyIcon: { width: 100, height: 100, borderRadius: 28, backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.text, textAlign: "center" },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary, textAlign: "center" },
  emptyBtns: { flexDirection: "row", gap: 10, marginTop: 6 },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  emptyBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#fff" },

  secRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 10 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#10B981" },
  secTitle: { fontFamily: "Inter_700Bold", fontSize: 15, color: C.text, flex: 1 },
  countBadge: { backgroundColor: C.primary, borderRadius: 10, minWidth: 22, height: 22, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  countText: { fontFamily: "Inter_700Bold", fontSize: 11, color: "#fff" },

  card: {
    backgroundColor: C.surface, borderRadius: 18,
    marginHorizontal: 16, marginBottom: 12, padding: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  chipText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  cardId: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted },

  cardItems: { marginBottom: 12, gap: 5 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  itemDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.border },
  itemText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary },
  itemPrice: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.text },
  moreItems: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, marginLeft: 13 },

  noteRow: { flexDirection: "row", gap: 8, alignItems: "flex-start", marginBottom: 10, padding: 8, backgroundColor: "#FFF8E1", borderRadius: 10 },
  noteText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 12, color: "#5D4037" },

  rideRoute: { marginBottom: 12, gap: 4 },
  ridePoint: { flexDirection: "row", alignItems: "center", gap: 10 },
  routeDot: { width: 9, height: 9, borderRadius: 5 },
  routeLine: { width: 2, height: 14, backgroundColor: C.border, marginLeft: 3.5 },
  rideAddr: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 13, color: C.text },

  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statusChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  statusText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  totalWrap: { alignItems: "flex-end" },
  totalLabel: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted },
  totalAmount: { fontFamily: "Inter_700Bold", fontSize: 17, color: C.text },

  etaBar: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.borderLight },
  etaText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted },
  payBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  payText: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted },

  cancelBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: "#FEF2F2",
    borderWidth: 1, borderColor: "#FECACA",
  },
  cancelBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#DC2626" },
  rateBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.borderLight,
    paddingVertical: 8, borderRadius: 10, backgroundColor: "#FFFBEB",
  },
  rateBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#B45309" },
  reviewedBadge: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.borderLight,
  },
  reviewedText: { fontFamily: "Inter_500Medium", fontSize: 12, color: "#92400E" },
  refundBar: {
    flexDirection: "row", alignItems: "center", gap: 5,
    marginTop: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8,
    backgroundColor: "#ECFDF5",
  },
  refundText: { fontFamily: "Inter_400Regular", fontSize: 12, color: "#047857" },
});
