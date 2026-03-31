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
import { useCart } from "@/context/CartContext";
import { useToast } from "@/context/ToastContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { useLanguage } from "@/context/LanguageContext";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { useGetOrders } from "@workspace/api-client-react";
import { CancelModal } from "@/components/CancelModal";
import type { CancelTarget } from "@/components/CancelModal";
import { API_BASE } from "@/utils/api";

const C = Colors.light;

const ORDER_STATUS: Record<string, { color: string; bg: string; icon: string; labelKey: TranslationKey }> = {
  pending:          { color: "#D97706", bg: "#FEF3C7", icon: "time-outline",            labelKey: "pending" },
  confirmed:        { color: "#2563EB", bg: "#DBEAFE", icon: "checkmark-circle-outline", labelKey: "confirmed" },
  preparing:        { color: "#7C3AED", bg: "#EDE9FE", icon: "flame-outline",            labelKey: "preparing" },
  ready:            { color: "#6366F1", bg: "#E0E7FF", icon: "bag-check-outline",       labelKey: "readyForPickup" },
  picked_up:        { color: "#0891B2", bg: "#CFFAFE", icon: "cube-outline",            labelKey: "onTheWay" },
  out_for_delivery: { color: "#059669", bg: "#D1FAE5", icon: "bicycle-outline",          labelKey: "onTheWay" },
  delivered:        { color: "#6B7280", bg: "#F3F4F6", icon: "checkmark-done-outline",   labelKey: "delivered" },
  cancelled:        { color: "#DC2626", bg: "#FEE2E2", icon: "close-circle-outline",     labelKey: "cancelled" },
};

const RIDE_STATUS: Record<string, { color: string; bg: string; icon: string; labelKey: TranslationKey }> = {
  searching:   { color: "#D97706", bg: "#FEF3C7", icon: "search-outline",            labelKey: "searching" },
  bargaining:  { color: "#D97706", bg: "#FEF3C7", icon: "swap-horizontal-outline",   labelKey: "bargaining" },
  accepted:    { color: "#2563EB", bg: "#DBEAFE", icon: "person-outline",            labelKey: "accepted" },
  arrived:    { color: "#7C3AED", bg: "#EDE9FE", icon: "location-outline",          labelKey: "arrived" },
  in_transit: { color: "#059669", bg: "#D1FAE5", icon: "car-outline",               labelKey: "inTransit" },
  ongoing:    { color: "#059669", bg: "#D1FAE5", icon: "car-outline",               labelKey: "inTransit" },
  completed:  { color: "#6B7280", bg: "#F3F4F6", icon: "checkmark-done-outline",    labelKey: "completed" },
  cancelled:  { color: "#DC2626", bg: "#FEE2E2", icon: "close-circle-outline",      labelKey: "cancelled" },
};

const PARCEL_STATUS: Record<string, { color: string; bg: string; icon: string; labelKey: TranslationKey }> = {
  pending:    { color: "#D97706", bg: "#FEF3C7", icon: "time-outline",              labelKey: "pending" },
  accepted:   { color: "#2563EB", bg: "#DBEAFE", icon: "person-outline",            labelKey: "accepted" },
  in_transit: { color: "#059669", bg: "#D1FAE5", icon: "cube-outline",              labelKey: "inTransit" },
  completed:  { color: "#6B7280", bg: "#F3F4F6", icon: "checkmark-done-outline",    labelKey: "delivered" },
  cancelled:  { color: "#DC2626", bg: "#FEE2E2", icon: "close-circle-outline",      labelKey: "cancelled" },
};

const TABS = [
  { key: "all",      labelKey: "all" as TranslationKey,       icon: "layers-outline" },
  { key: "mart",     labelKey: "mart" as TranslationKey,      icon: "storefront-outline" },
  { key: "food",     labelKey: "food" as TranslationKey,      icon: "restaurant-outline" },
  { key: "rides",    labelKey: "ride" as TranslationKey,      icon: "car-outline" },
  { key: "pharmacy", labelKey: "pharmacy" as TranslationKey,  icon: "medical-outline" },
  { key: "parcel",   labelKey: "parcel" as TranslationKey,    icon: "cube-outline" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function OrderCard({ order, liveTracking, reviews, cancelWindowMin, refundDays, ratingWindowHours, serverNow, onRate, onCancel, onReorder }: {
  order: any;
  liveTracking: boolean;
  reviews: boolean;
  cancelWindowMin: number;
  refundDays: number;
  ratingWindowHours: number;
  serverNow?: number;
  onRate: (o: any) => void;
  onCancel: (o: any) => void;
  onReorder?: (o: any) => void;
}) {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const [itemsExpanded, setItemsExpanded] = useState(false);
  const cfg = ORDER_STATUS[order.status] || ORDER_STATUS["pending"]!;
  const isFood = order.type === "food";
  const isDelivered = order.status === "delivered";
  const isCancelled = order.status === "cancelled";
  const isActive = !["delivered", "cancelled"].includes(order.status);

  const nowMs = serverNow ?? Date.now();
  const minutesSincePlaced = order.createdAt
    ? (nowMs - new Date(order.createdAt).getTime()) / 60000
    : 999;
  const canCancel = ["pending", "confirmed"].includes(order.status) && minutesSincePlaced <= cancelWindowMin;
  const cancelMinsLeft = Math.max(0, Math.ceil(cancelWindowMin - minutesSincePlaced));

  const hourssinceDelivery = order.updatedAt
    ? (Date.now() - new Date(order.updatedAt).getTime()) / 3600000
    : 0;
  const canRate = reviews && isDelivered && !order._reviewed && hourssinceDelivery <= ratingWindowHours;

  const handleCardPress = () => {
    router.push(`/order?orderId=${order.id}`);
  };

  return (
    <Pressable onPress={handleCardPress} style={styles.card}>
      <View style={styles.cardTop}>
        <View style={[styles.chip, { backgroundColor: isFood ? "#FEF3C7" : "#EFF6FF" }]}>
          <Ionicons
            name={isFood ? "restaurant-outline" : "storefront-outline"}
            size={13}
            color={isFood ? "#D97706" : "#1A56DB"}
          />
          <Text style={[styles.chipText, { color: isFood ? "#D97706" : "#1A56DB" }]}>
            {isFood ? T("food") : T("mart")}
          </Text>
        </View>
        <Text style={styles.cardId}>#{order.id.slice(-8).toUpperCase()}</Text>
      </View>

      <View style={styles.cardItems}>
        {(order.items || []).slice(0, itemsExpanded ? undefined : 2).map((item: any, i: number) => (
          <View key={i} style={styles.itemRow}>
            <View style={styles.itemDot} />
            <Text style={styles.itemText} numberOfLines={1}>{item.quantity}× {item.name}</Text>
            <Text style={styles.itemPrice}>Rs. {item.price * item.quantity}</Text>
          </View>
        ))}
        {(order.items || []).length > 2 && (
          <Pressable onPress={() => setItemsExpanded(prev => !prev)} style={styles.expandRow}>
            <Text style={styles.moreItems}>
              {itemsExpanded ? T("showLess") : `+${order.items.length - 2} ${T("moreItems")}`}
            </Text>
            <Ionicons
              name={itemsExpanded ? "chevron-up" : "chevron-down"}
              size={13}
              color={C.primary}
            />
          </Pressable>
        )}
      </View>

      <View style={styles.cardFooter}>
        <View style={[styles.statusChip, { backgroundColor: cfg.bg }]}>
          <Ionicons name={cfg.icon as any} size={13} color={cfg.color} />
          <Text style={[styles.statusText, { color: cfg.color }]}>{T(cfg.labelKey)}</Text>
        </View>
        <View style={styles.totalWrap}>
          <Text style={styles.totalLabel}>{T("total")}</Text>
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
            <Text style={styles.payText}>{order.paymentMethod === "wallet" ? T("wallet") : T("cash")}</Text>
          </View>
        </View>
      )}

      {!liveTracking && isActive && (
        <View style={[styles.etaBar, { backgroundColor: "#FEF3C7", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 0, marginTop: 12 }]}>
          <Ionicons name="navigate-circle-outline" size={13} color="#D97706" />
          <Text style={[styles.etaText, { color: "#92400E" }]}>{T("liveTrackingUnavailable")}</Text>
        </View>
      )}

      {canCancel && (
        <Pressable style={styles.cancelBtn} onPress={() => onCancel(order)}>
          <Ionicons name="close-circle-outline" size={14} color="#DC2626" />
          <Text style={styles.cancelBtnText}>{T("cancelOrder")} ({cancelMinsLeft}m left)</Text>
        </Pressable>
      )}

      {canRate && (
        <Pressable style={styles.rateBtn} onPress={() => onRate(order)}>
          <Ionicons name="star-outline" size={14} color="#F59E0B" />
          <Text style={styles.rateBtnText}>{T("rateOrder")}</Text>
        </Pressable>
      )}

      {order._reviewed && (
        <View style={styles.reviewedBadge}>
          <Ionicons name="star" size={13} color="#F59E0B" />
          <Text style={styles.reviewedText}>{T("reviewedThanks")}</Text>
        </View>
      )}

      {(isDelivered || isCancelled) && onReorder && order.items?.length > 0 && (
        <Pressable style={styles.reorderBtn} onPress={() => onReorder(order)}>
          <Ionicons name="refresh-outline" size={14} color={C.primary} />
          <Text style={styles.reorderBtnText}>Reorder</Text>
        </Pressable>
      )}

      {isCancelled && order.paymentMethod !== "cash" && refundDays > 0 && (
        <View style={styles.refundBar}>
          <Ionicons name="return-down-back-outline" size={12} color="#059669" />
          <Text style={styles.refundText}>{T("refundInfo").replace("{n}", String(refundDays))}</Text>
        </View>
      )}

      <View style={styles.tapHint}>
        <Ionicons name="open-outline" size={11} color={C.textMuted} />
        <Text style={styles.tapHintText}>Tap for details</Text>
      </View>
    </Pressable>
  );
}

const RIDE_STEPS = ["accepted", "arrived", "in_transit", "completed"];
const RIDE_STEP_LABELS = ["Accepted", "Arrived", "On Route", "Done"];

function RideCard({ ride, liveTracking, reviews, onRate, onCancel }: {
  ride: any;
  liveTracking: boolean;
  reviews: boolean;
  onRate: (o: any) => void;
  onCancel: (o: any) => void;
}) {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const cfg = RIDE_STATUS[ride.status] || RIDE_STATUS["searching"]!;
  const isActive    = !["completed", "cancelled"].includes(ride.status);
  const isCompleted = ride.status === "completed";
  const canCancel   = ["searching", "bargaining", "accepted", "arrived"].includes(ride.status);
  const hasRider    = ["accepted", "arrived", "in_transit", "ongoing"].includes(ride.status);
  const rideStepIdx = RIDE_STEPS.indexOf(ride.status);
  const showStepper = isActive && rideStepIdx >= 0;

  const handleCardPress = () => {
    if (isActive) {
      router.push(`/ride?rideId=${ride.id}`);
    } else {
      router.push({ pathname: "/order", params: { orderId: ride.id, type: "ride" } });
    }
  };

  return (
    <Pressable onPress={handleCardPress} style={styles.card}>
      <View style={styles.cardTop}>
        <View style={[styles.chip, { backgroundColor: "#ECFDF5" }]}>
          <Ionicons
            name={
              ride.type === "bike" ? "bicycle-outline" :
              ride.type === "rickshaw" ? "car-sport-outline" :
              ride.type === "daba" ? "bus-outline" :
              ride.type === "school_shift" ? "school-outline" :
              "car-outline"
            }
            size={13} color="#059669"
          />
          <Text style={[styles.chipText, { color: "#059669" }]}>
            {ride.type === "bike" ? T("bikeRide") :
             ride.type === "rickshaw" ? "Rickshaw" :
             ride.type === "daba" ? "Daba" :
             ride.type === "school_shift" ? "School Shift" :
             T("carRide")}
          </Text>
        </View>
        <Text style={styles.cardId}>#{ride.id.slice(-8).toUpperCase()}</Text>
      </View>

      <View style={styles.rideRoute}>
        <View style={styles.ridePoint}>
          <View style={[styles.routeDot, { backgroundColor: "#10B981" }]} />
          <Text style={styles.rideAddr} numberOfLines={1}>{ride.pickupAddress || T("pickup")}</Text>
        </View>
        <View style={styles.routeLine} />
        <View style={styles.ridePoint}>
          <View style={[styles.routeDot, { backgroundColor: "#EF4444" }]} />
          <Text style={styles.rideAddr} numberOfLines={1}>{ride.dropAddress || T("drop")}</Text>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <View style={[styles.statusChip, { backgroundColor: cfg.bg }]}>
          <Ionicons name={cfg.icon as any} size={13} color={cfg.color} />
          <Text style={[styles.statusText, { color: cfg.color }]}>{T(cfg.labelKey)}</Text>
        </View>
        <View style={styles.totalWrap}>
          <Text style={styles.totalLabel}>{ride.distance ? `${ride.distance} km` : T("fare")}</Text>
          <Text style={styles.totalAmount}>Rs. {ride.fare?.toLocaleString()}</Text>
        </View>
      </View>

      {hasRider && ride.riderName && (
        <View style={styles.riderBar}>
          <View style={styles.riderIconWrap}>
            <Ionicons name="person-outline" size={14} color="#2563EB" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.riderName}>{ride.riderName}</Text>
            {ride.riderPhone && <Text style={styles.riderPhone}>{ride.riderPhone}</Text>}
          </View>
          {ride.riderPhone && (
            <Pressable onPress={() => Linking.openURL(`tel:${ride.riderPhone}`)} style={styles.callBtn}>
              <Ionicons name="call-outline" size={16} color="#fff" />
            </Pressable>
          )}
        </View>
      )}

      {isActive && (
        <View style={styles.etaBar}>
          <Ionicons name={ride.paymentMethod === "wallet" ? "wallet-outline" : "cash-outline"} size={12} color={C.primary} />
          <Text style={styles.etaText}>
            {ride.paymentMethod === "wallet" ? T("paidViaWallet") : T("cashPayment")}
          </Text>
        </View>
      )}

      {canCancel && (
        <Pressable style={styles.cancelBtn} onPress={() => onCancel(ride)}>
          <Ionicons name="close-circle-outline" size={14} color="#DC2626" />
          <Text style={styles.cancelBtnText}>
            {["accepted", "arrived"].includes(ride.status) ? T("cancelRideFee") : T("cancelRide")}
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
          <Text style={styles.reviewedText}>{T("reviewedThanks")}</Text>
        </View>
      )}

      {showStepper && (
        <View style={styles.rideStepperWrap}>
          <View style={styles.rideStepperRow}>
            {RIDE_STEPS.map((step, i) => {
              const done = rideStepIdx >= i;
              const active = rideStepIdx === i;
              const isLast = i === RIDE_STEPS.length - 1;
              return (
                <React.Fragment key={step}>
                  <View style={styles.rideStepItem}>
                    <View style={[
                      styles.rideStepDot,
                      done && { backgroundColor: active ? cfg.color : "#10B981" },
                      active && { shadowColor: cfg.color, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3 },
                    ]}>
                      {done
                        ? <Ionicons name="checkmark" size={10} color="#fff" />
                        : <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: "#CBD5E1" }} />}
                    </View>
                    <Text style={[styles.rideStepLabel, done && { color: C.text }, active && { fontFamily: "Inter_700Bold" }]}>
                      {RIDE_STEP_LABELS[i]}
                    </Text>
                  </View>
                  {!isLast && (
                    <View style={[styles.rideStepLine, rideStepIdx > i && { backgroundColor: "#10B981" }]} />
                  )}
                </React.Fragment>
              );
            })}
          </View>
        </View>
      )}

      <View style={styles.tapHint}>
        <Ionicons name="open-outline" size={11} color={C.textMuted} />
        <Text style={styles.tapHintText}>{isActive ? "Tap to track" : "Tap for details"}</Text>
      </View>
    </Pressable>
  );
}

function PharmacyCard({ order, reviews, cancelWindowMin, serverNow, onRate, onCancel }: {
  order: any;
  reviews: boolean;
  cancelWindowMin: number;
  serverNow?: number;
  onRate: (o: any) => void;
  onCancel: (o: any) => void;
}) {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const [itemsExpanded, setItemsExpanded] = useState(false);
  const cfg = ORDER_STATUS[order.status] || ORDER_STATUS["pending"]!;
  const isDelivered = order.status === "delivered";

  const nowMs = serverNow ?? Date.now();
  const minutesSincePlaced = order.createdAt
    ? (nowMs - new Date(order.createdAt).getTime()) / 60000
    : 999;
  const canCancel = order.status === "pending" && minutesSincePlaced <= cancelWindowMin;
  const cancelMinsLeft = Math.max(0, Math.ceil(cancelWindowMin - minutesSincePlaced));

  return (
    <Pressable style={styles.card} onPress={() => router.push({ pathname: "/order", params: { orderId: order.id, type: "pharmacy" } })}>
      <View style={styles.cardTop}>
        <View style={[styles.chip, { backgroundColor: "#F3E8FF" }]}>
          <Ionicons name="medical-outline" size={13} color="#7C3AED" />
          <Text style={[styles.chipText, { color: "#7C3AED" }]}>{T("pharmacy")}</Text>
        </View>
        <Text style={styles.cardId}>#{order.id.slice(-8).toUpperCase()}</Text>
      </View>

      {order.prescriptionNote && (
        <View style={styles.noteRow}>
          <Ionicons name="document-text-outline" size={14} color="#7C3AED" />
          <Text style={styles.noteText} numberOfLines={2}>{order.prescriptionNote}</Text>
        </View>
      )}

      <View style={styles.cardItems}>
        {(order.items || []).slice(0, itemsExpanded ? undefined : 2).map((item: any, i: number) => (
          <View key={i} style={styles.itemRow}>
            <View style={styles.itemDot} />
            <Text style={styles.itemText} numberOfLines={1}>{item.quantity}× {item.name}</Text>
            <Text style={styles.itemPrice}>Rs. {item.price * item.quantity}</Text>
          </View>
        ))}
        {(order.items || []).length > 2 && (
          <Pressable onPress={() => setItemsExpanded(prev => !prev)} style={styles.expandRow}>
            <Text style={styles.moreItems}>
              {itemsExpanded ? T("showLess") : `+${order.items.length - 2} ${T("moreItems")}`}
            </Text>
            <Ionicons
              name={itemsExpanded ? "chevron-up" : "chevron-down"}
              size={13}
              color={C.primary}
            />
          </Pressable>
        )}
      </View>

      <View style={styles.cardFooter}>
        <View style={[styles.statusChip, { backgroundColor: cfg.bg }]}>
          <Ionicons name={cfg.icon as any} size={13} color={cfg.color} />
          <Text style={[styles.statusText, { color: cfg.color }]}>{T(cfg.labelKey)}</Text>
        </View>
        <View style={styles.totalWrap}>
          <Text style={styles.totalLabel}>{T("total")}</Text>
          <Text style={styles.totalAmount}>Rs. {order.total?.toLocaleString()}</Text>
        </View>
      </View>

      {canCancel && (
        <Pressable style={styles.cancelBtn} onPress={() => onCancel(order)}>
          <Ionicons name="close-circle-outline" size={14} color="#DC2626" />
          <Text style={styles.cancelBtnText}>{T("cancelOrder")} ({cancelMinsLeft}m left)</Text>
        </Pressable>
      )}

      {reviews && isDelivered && !order._reviewed && (
        <Pressable style={styles.rateBtn} onPress={() => onRate({ ...order, _type: "pharmacy" })}>
          <Ionicons name="star-outline" size={14} color="#F59E0B" />
          <Text style={styles.rateBtnText}>{T("rateOrder")}</Text>
        </Pressable>
      )}

      {order._reviewed && (
        <View style={styles.reviewedBadge}>
          <Ionicons name="star" size={13} color="#F59E0B" />
          <Text style={styles.reviewedText}>{T("reviewedThanks")}</Text>
        </View>
      )}
    </Pressable>
  );
}

function ParcelCard({ booking }: { booking: any }) {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const cfg = PARCEL_STATUS[booking.status] || PARCEL_STATUS["pending"]!;
  const isActive = !["completed", "cancelled"].includes(booking.status);
  const parcelLabel = booking.parcelType
    ? booking.parcelType.charAt(0).toUpperCase() + booking.parcelType.slice(1)
    : T("parcel");

  const handleCardPress = () => {
    router.push(`/order?orderId=${booking.id}&type=parcel`);
  };

  return (
    <Pressable onPress={handleCardPress} style={styles.card}>
      <View style={styles.cardTop}>
        <View style={[styles.chip, { backgroundColor: "#FEF3C7" }]}>
          <Ionicons name="cube-outline" size={13} color="#D97706" />
          <Text style={[styles.chipText, { color: "#D97706" }]}>{T("parcel")} · {parcelLabel}</Text>
        </View>
        <Text style={styles.cardId}>#{booking.id.slice(-8).toUpperCase()}</Text>
      </View>

      <View style={styles.rideRoute}>
        <View style={styles.ridePoint}>
          <View style={[styles.routeDot, { backgroundColor: "#10B981" }]} />
          <Text style={styles.rideAddr} numberOfLines={1}>{booking.pickupAddress || T("pickup")}</Text>
        </View>
        <View style={styles.routeLine} />
        <View style={styles.ridePoint}>
          <View style={[styles.routeDot, { backgroundColor: "#EF4444" }]} />
          <Text style={styles.rideAddr} numberOfLines={1}>{booking.dropAddress || T("drop")}</Text>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <View style={[styles.statusChip, { backgroundColor: cfg.bg }]}>
          <Ionicons name={cfg.icon as any} size={13} color={cfg.color} />
          <Text style={[styles.statusText, { color: cfg.color }]}>{T(cfg.labelKey)}</Text>
        </View>
        <View style={styles.totalWrap}>
          <Text style={styles.totalLabel}>{T("fare")}</Text>
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
              {booking.paymentMethod === "wallet" ? T("wallet") : booking.paymentMethod === "jazzcash" ? T("jazzcash") : booking.paymentMethod === "easypaisa" ? T("easypaisa") : T("cash")}
            </Text>
          </View>
        </View>
      )}

      <View style={styles.tapHint}>
        <Ionicons name="open-outline" size={11} color={C.textMuted} />
        <Text style={styles.tapHintText}>{isActive ? "Tap to track" : "Tap for details"}</Text>
      </View>
    </Pressable>
  );
}

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

  const ratingLabels = ["", "Poor", "Fair", "Good", "Great", "Excellent"];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={rm.backdrop} onPress={onClose}>
        <Pressable style={rm.sheet} onPress={() => {}}>
          <View style={rm.handle} />

          <View style={rm.headerIconWrap}>
            <LinearGradient colors={["#F59E0B", "#FBBF24"]} style={rm.headerIcon}>
              <Ionicons name="star" size={24} color="#fff" />
            </LinearGradient>
          </View>

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
                  size={38}
                  color={s <= rating ? "#F59E0B" : "#E2E8F0"}
                />
              </Pressable>
            ))}
          </View>
          {rating > 0 && (
            <Text style={rm.ratingLabel}>{ratingLabels[rating]}</Text>
          )}

          <TextInput
            style={rm.input}
            placeholder="Share your experience (optional)..."
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
  sheet:    { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 40 },
  handle:   { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: "center", marginBottom: 20 },
  headerIconWrap: { alignItems: "center", marginBottom: 14 },
  headerIcon: { width: 52, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  title:    { fontFamily: "Inter_700Bold", fontSize: 22, color: C.text, textAlign: "center", marginBottom: 4 },
  sub:      { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary, textAlign: "center", marginBottom: 20 },
  stars:    { flexDirection: "row", justifyContent: "center", gap: 14, marginBottom: 8 },
  ratingLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#B45309", textAlign: "center", marginBottom: 16 },
  input: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 16,
    padding: 14, fontFamily: "Inter_400Regular", fontSize: 14, color: C.text,
    minHeight: 80, textAlignVertical: "top", marginBottom: 8, backgroundColor: C.surfaceSecondary,
  },
  error:    { fontFamily: "Inter_400Regular", fontSize: 13, color: "#EF4444", textAlign: "center", marginBottom: 8 },
  btns:     { flexDirection: "row", gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 16, paddingVertical: 15, alignItems: "center" },
  cancelText:{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.textSecondary },
  submitBtn: { flex: 2, backgroundColor: C.primary, borderRadius: 16, paddingVertical: 15, alignItems: "center", justifyContent: "center", shadowColor: C.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3 },
  submitText:{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" },
});


function SectionHeader({ title, count, active }: { title: string; count: number; active?: boolean }) {
  return (
    <View style={styles.secRow}>
      {active && <View style={styles.activeDot} />}
      <Text style={[styles.secTitle, !active && { color: C.textSecondary }]}>{title}</Text>
      <View style={[styles.countBadge, active ? { backgroundColor: C.primary } : { backgroundColor: C.textMuted }]}>
        <Text style={styles.countText}>{count}</Text>
      </View>
    </View>
  );
}

export default function OrdersScreen() {
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const { addItem } = useCart();
  const { showToast } = useToast();
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: Parameters<typeof tDual>[0]) => tDual(key, language);
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<any>(null);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const TAB_H  = Platform.OS === "web" ? 84 : 49;

  const orderRules = config.orderRules;

  const svcFeatures = config.features;
  const martActive = svcFeatures.mart;
  const foodActive = svcFeatures.food;
  const ridesActive = svcFeatures.rides;
  const pharmActive = svcFeatures.pharmacy;
  const parcelActive = svcFeatures.parcel;
  const anyMartFood = martActive || foodActive;

  const visibleTabs = TABS.filter(tab => {
    if (tab.key === "all") return true;
    if (tab.key === "mart") return martActive;
    if (tab.key === "food") return foodActive;
    if (tab.key === "rides") return ridesActive;
    if (tab.key === "pharmacy") return pharmActive;
    if (tab.key === "parcel") return parcelActive;
    return true;
  });

  React.useEffect(() => {
    if (!visibleTabs.some(t => t.key === activeTab)) {
      setActiveTab("all");
    }
  }, [martActive, foodActive, ridesActive, pharmActive, parcelActive]);

  const handleReorder = useCallback((order: any) => {
    if (!order.items || order.items.length === 0) return;
    const validItems = order.items.filter((i: any) => i.productId);
    if (validItems.length === 0) {
      showToast("Items from this order are no longer available", "error");
      return;
    }
    let count = 0;
    for (const item of validItems) {
      addItem({
        productId: item.productId,
        name: item.name,
        price: item.price,
        quantity: item.quantity || 1,
        image: item.image,
        type: order.type || "mart",
      });
      count++;
    }
    if (validItems.length < order.items.length) {
      showToast(`${count} items added — ${order.items.length - validItems.length} unavailable items skipped`, "info");
    } else {
      showToast(`${count} items added to cart`, "success");
    }
    router.push("/cart");
  }, [addItem, showToast]);

  const handleRate = useCallback((order: any) => {
    if (!reviewedIds.has(order.id)) setReviewTarget(order);
  }, [reviewedIds]);

  const handleReviewDone = useCallback((orderId: string) => {
    setReviewedIds(prev => new Set([...prev, orderId]));
  }, []);

  const [hasActiveItems, setHasActiveItems] = useState(false);
  const pollInterval = hasActiveItems ? 10000 : 30000;

  const { data: ordersData, isLoading: ordersLoading, refetch: refetchOrders } = useGetOrders(
    { userId: user?.id || "" },
    { query: { enabled: !!user?.id && anyMartFood, refetchInterval: pollInterval } }
  );

  const [ridesData, setRidesData] = useState<any>(null);
  const [ridesLoading, setRidesLoading] = useState(false);

  const [pharmData, setPharmData] = useState<any>(null);
  const [pharmLoading, setPharmLoading] = useState(false);

  const [parcelData, setParcelData] = useState<any>(null);
  const [parcelLoading, setParcelLoading] = useState(false);
  const [serverNow, setServerNow] = useState<number>(Date.now());

  const fetchServerTime = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/platform-config`, { method: "HEAD" });
      const serverDate = res.headers.get("Date");
      if (serverDate) setServerNow(new Date(serverDate).getTime());
    } catch {}
  }, []);

  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const handleCancel = useCallback((order: any) => {
    const nowMs = serverNow ?? Date.now();
    const minutesSincePlaced = order.createdAt
      ? (nowMs - new Date(order.createdAt).getTime()) / 60000
      : 999;
    const cancelMinsLeft = Math.max(0, Math.ceil(orderRules.cancelWindowMin - minutesSincePlaced));
    setCancelTarget({
      id: order.id,
      type: "order",
      status: order.status,
      total: order.total,
      paymentMethod: order.paymentMethod,
      cancelMinsLeft,
    });
  }, [orderRules.cancelWindowMin, serverNow]);

  const handleCancelPharmacy = useCallback((order: any) => {
    const nowMs = serverNow ?? Date.now();
    const minutesSincePlaced = order.createdAt
      ? (nowMs - new Date(order.createdAt).getTime()) / 60000
      : 999;
    const cancelMinsLeft = Math.max(0, Math.ceil(orderRules.cancelWindowMin - minutesSincePlaced));
    setCancelTarget({
      id: order.id,
      type: "pharmacy",
      status: order.status,
      total: order.total,
      paymentMethod: order.paymentMethod,
      cancelMinsLeft,
    });
  }, [orderRules.cancelWindowMin, serverNow]);

  const fetchRides = useCallback(async () => {
    if (!user?.id || !ridesActive) return;
    setRidesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/rides`, { headers: authHeaders });
      const serverDate = res.headers.get("Date");
      if (serverDate) setServerNow(new Date(serverDate).getTime());
      const d = await res.json();
      setRidesData(d);
    } catch {}
    setRidesLoading(false);
  }, [user?.id, token, ridesActive]);

  const fetchPharmacy = useCallback(async () => {
    if (!user?.id || !pharmActive) return;
    setPharmLoading(true);
    try {
      const res = await fetch(`${API_BASE}/pharmacy-orders`, { headers: authHeaders });
      const serverDate = res.headers.get("Date");
      if (serverDate) setServerNow(new Date(serverDate).getTime());
      const d = await res.json();
      setPharmData(d);
    } catch {}
    setPharmLoading(false);
  }, [user?.id, token, pharmActive]);

  const fetchParcel = useCallback(async () => {
    if (!user?.id || !parcelActive) return;
    setParcelLoading(true);
    try {
      const res = await fetch(`${API_BASE}/parcel-bookings`, { headers: authHeaders });
      const serverDate = res.headers.get("Date");
      if (serverDate) setServerNow(new Date(serverDate).getTime());
      const d = await res.json();
      setParcelData(d);
    } catch {}
    setParcelLoading(false);
  }, [user?.id, token, parcelActive]);

  const handleCancelRide = useCallback((ride: any) => {
    const riderAssigned = ["accepted", "arrived", "in_transit", "ongoing"].includes(ride.status);
    setCancelTarget({
      id: ride.id,
      type: "ride",
      status: ride.status,
      fare: ride.fare,
      paymentMethod: ride.paymentMethod,
      riderAssigned,
    });
  }, []);

  React.useEffect(() => {
    fetchServerTime();
    if (user?.id) {
      fetchRides();
      fetchPharmacy();
      fetchParcel();
    }
  }, [user?.id, ridesActive, pharmActive, parcelActive]);

  React.useEffect(() => {
    if (!user?.id) return;
    const interval = setInterval(() => {
      fetchRides();
      fetchPharmacy();
      fetchParcel();
    }, pollInterval);
    return () => clearInterval(interval);
  }, [user?.id, fetchRides, fetchPharmacy, fetchParcel, pollInterval]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchServerTime(), refetchOrders(), fetchRides(), fetchPharmacy(), fetchParcel()]);
    setRefreshing(false);
  }, [fetchServerTime, refetchOrders, fetchRides, fetchPharmacy, fetchParcel]);

  const rawOrders = [...(ordersData?.orders || [])].reverse();
  const allOrders = rawOrders.filter(o =>
    (o.type === "mart" && martActive) || (o.type === "food" && foodActive)
  );
  const martOrders = martActive ? allOrders.filter(o => o.type === "mart") : [];
  const foodOrders = foodActive ? allOrders.filter(o => o.type === "food") : [];
  const rides = ridesActive ? (ridesData?.rides || []) : [];
  const pharmOrders = pharmActive ? (pharmData?.orders || pharmData?.pharmacyOrders || []) : [];
  const parcels = parcelActive ? (parcelData?.bookings || parcelData?.parcelBookings || []) : [];

  const totalCount = allOrders.length + rides.length + pharmOrders.length + parcels.length;

  const globalActiveCount =
    allOrders.filter(o => !["delivered", "cancelled"].includes(o.status)).length +
    rides.filter((r: any) => !["completed", "cancelled"].includes(r.status)).length +
    pharmOrders.filter((o: any) => !["delivered", "cancelled"].includes(o.status)).length +
    parcels.filter((b: any) => !["completed", "cancelled"].includes(b.status)).length;

  React.useEffect(() => {
    setHasActiveItems(globalActiveCount > 0);
  }, [globalActiveCount]);

  const isLoading = ordersLoading || ridesLoading || pharmLoading || parcelLoading;

  const renderContent = () => {
    if (isLoading && totalCount === 0) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={C.primary} size="large" />
          <Text style={styles.loadingText}>{T("loading")}</Text>
        </View>
      );
    }

    if (totalCount === 0) {
      return (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Ionicons name="bag-outline" size={48} color={C.primary} />
          </View>
          <Text style={styles.emptyTitle}>{T("noRecordsFound")}</Text>
          <Text style={styles.emptyText}>
            {T("trackActivity")}
          </Text>
          <View style={styles.emptyBtns}>
            {martActive && (
              <Pressable onPress={() => router.push("/mart")} style={styles.emptyBtn}>
                <Ionicons name="storefront-outline" size={15} color="#fff" />
                <Text style={styles.emptyBtnText}>Mart</Text>
              </Pressable>
            )}
            {foodActive && (
              <Pressable onPress={() => router.push("/food")} style={[styles.emptyBtn, { backgroundColor: "#D97706" }]}>
                <Ionicons name="restaurant-outline" size={15} color="#fff" />
                <Text style={styles.emptyBtnText}>Food</Text>
              </Pressable>
            )}
            {ridesActive && (
              <Pressable onPress={() => router.push("/ride")} style={[styles.emptyBtn, { backgroundColor: "#059669" }]}>
                <Ionicons name="car-outline" size={15} color="#fff" />
                <Text style={styles.emptyBtnText}>Ride</Text>
              </Pressable>
            )}
            {pharmActive && (
              <Pressable onPress={() => router.push("/pharmacy")} style={[styles.emptyBtn, { backgroundColor: "#7C3AED" }]}>
                <Ionicons name="medical-outline" size={15} color="#fff" />
                <Text style={styles.emptyBtnText}>Pharmacy</Text>
              </Pressable>
            )}
            {parcelActive && (
              <Pressable onPress={() => router.push("/parcel")} style={[styles.emptyBtn, { backgroundColor: "#B45309" }]}>
                <Ionicons name="cube-outline" size={15} color="#fff" />
                <Text style={styles.emptyBtnText}>Parcel</Text>
              </Pressable>
            )}
          </View>
        </View>
      );
    }

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
      const tabLabel = activeTab === "all" ? "any orders" : activeTab === "rides" ? "any rides" : activeTab === "pharmacy" ? "any pharmacy orders" : activeTab === "parcel" ? "any parcels" : activeTab === "mart" ? "any mart orders" : "any food orders";
      return (
        <View style={styles.center}>
          <View style={styles.emptyFilterIcon}>
            <Ionicons name={activeTab === "rides" ? "car-outline" : activeTab === "parcel" ? "cube-outline" : activeTab === "pharmacy" ? "medical-outline" : "bag-outline"} size={36} color={C.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>No {tabLabel} yet</Text>
          <Text style={styles.emptyText}>{activeTab === "all" ? "Your order history will appear here once you place an order." : `You haven't placed ${tabLabel}. Start exploring!`}</Text>
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
            <SectionHeader title={T("activeLabel")} count={anyActive} active />
            {activeOrders.map(o => <OrderCard key={o.id} order={{ ...o, _reviewed: reviewedIds.has(o.id) }} liveTracking={config.features.liveTracking} reviews={config.features.reviews} cancelWindowMin={orderRules.cancelWindowMin} refundDays={orderRules.refundDays} ratingWindowHours={orderRules.ratingWindowHours} serverNow={serverNow} onRate={handleRate} onCancel={handleCancel} onReorder={handleReorder} />)}
            {activeRides.map(r => <RideCard key={r.id} ride={{ ...r, _reviewed: reviewedIds.has(r.id) }} liveTracking={config.features.liveTracking} reviews={config.features.reviews} onRate={handleRate} onCancel={handleCancelRide} />)}
            {activePharm.map(o => <PharmacyCard key={o.id} order={{ ...o, _reviewed: reviewedIds.has(o.id) }} reviews={config.features.reviews} cancelWindowMin={orderRules.cancelWindowMin} serverNow={serverNow} onRate={handleRate} onCancel={handleCancelPharmacy} />)}
            {activeParcel.map(b => <ParcelCard key={b.id} booking={b} />)}
          </>
        )}

        {anyPast > 0 && (
          <>
            <SectionHeader title={T("historyLabel")} count={anyPast} />
            {pastOrders.map(o => <OrderCard key={o.id} order={{ ...o, _reviewed: reviewedIds.has(o.id) }} liveTracking={config.features.liveTracking} reviews={config.features.reviews} cancelWindowMin={orderRules.cancelWindowMin} refundDays={orderRules.refundDays} ratingWindowHours={orderRules.ratingWindowHours} serverNow={serverNow} onRate={handleRate} onCancel={handleCancel} onReorder={handleReorder} />)}
            {pastRides.map(r => <RideCard key={r.id} ride={{ ...r, _reviewed: reviewedIds.has(r.id) }} liveTracking={config.features.liveTracking} reviews={config.features.reviews} onRate={handleRate} onCancel={handleCancelRide} />)}
            {pastPharm.map(o => <PharmacyCard key={o.id} order={{ ...o, _reviewed: reviewedIds.has(o.id) }} reviews={config.features.reviews} cancelWindowMin={orderRules.cancelWindowMin} serverNow={serverNow} onRate={handleRate} onCancel={handleCancelPharmacy} />)}
            {pastParcel.map(b => <ParcelCard key={b.id} booking={b} />)}
          </>
        )}
        <View style={{ height: TAB_H + insets.bottom + 20 }} />
      </ScrollView>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <LinearGradient
        colors={["#0D3B93", "#1A56DB", "#3B82F6"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: topPad + 12 }]}
      >
        <Text style={styles.headerTitle}>{T("myOrders")}</Text>
        <Text style={styles.headerSub}>
          {totalCount > 0 ? `${totalCount} ${T("totalBookingsLabel")}` : T("trackActivity")}
        </Text>
      </LinearGradient>

      <View style={styles.tabsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {visibleTabs.map(tab => {
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
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{T(tab.labelKey)}</Text>
                {count > 0 && (
                  <View style={[styles.tabBadge, isActive && { backgroundColor: "rgba(255,255,255,0.3)" }]}>
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
          apiBase={API_BASE}
          token={token}
          onClose={() => setReviewTarget(null)}
          onDone={handleReviewDone}
        />
      )}

      {cancelTarget && (
        <CancelModal
          target={cancelTarget}
          cancellationFee={config.rides?.cancellationFee ?? 30}
          apiBase={API_BASE}
          token={token}
          onClose={() => setCancelTarget(null)}
          onDone={(result) => {
            if (cancelTarget.type === "ride") {
              const fee = result?.cancellationFee;
              const msg = fee > 0
                ? `Ride cancelled. Rs. ${fee} fee applied.`
                : "Ride cancelled successfully.";
              showToast(msg, "success");
              fetchRides();
            } else if (cancelTarget.type === "pharmacy") {
              showToast("Pharmacy order cancelled successfully.", "success");
              fetchPharmacy();
            } else {
              const refund = result?.refundAmount;
              const msg = refund > 0
                ? `Order cancelled. Rs. ${Math.round(refund)} will be refunded.`
                : "Order cancelled successfully.";
              showToast(msg, "success");
              refetchOrders();
            }
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 24, color: "#fff", marginBottom: 4 },
  headerSub: { fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,255,255,0.8)" },

  tabsWrap: { backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  tabs: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  tab: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 22,
    backgroundColor: C.surfaceSecondary, borderWidth: 1, borderColor: C.border,
  },
  tabActive: { backgroundColor: C.primary, borderColor: C.primary },
  tabLabel: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: C.textSecondary },
  tabLabelActive: { color: "#fff" },
  tabBadge: {
    backgroundColor: C.border, borderRadius: 9,
    minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
  },
  tabBadgeText: { fontFamily: "Inter_700Bold", fontSize: 10, color: C.textMuted },

  scroll: { paddingBottom: 0 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 },
  loadingText: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted },

  emptyIcon: { width: 96, height: 96, borderRadius: 28, backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyFilterIcon: { width: 72, height: 72, borderRadius: 22, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.text, textAlign: "center" },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary, textAlign: "center" },
  emptyBtns: { flexDirection: "row", gap: 10, marginTop: 8 },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.primary, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 14 },
  emptyBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#fff" },

  secRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 12 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#10B981" },
  secTitle: { fontFamily: "Inter_700Bold", fontSize: 16, color: C.text, flex: 1 },
  countBadge: { borderRadius: 10, minWidth: 24, height: 24, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  countText: { fontFamily: "Inter_700Bold", fontSize: 11, color: "#fff" },

  card: {
    backgroundColor: C.surface, borderRadius: 20,
    marginHorizontal: 16, marginBottom: 12, padding: 16,
    borderWidth: 1, borderColor: C.borderLight,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 3,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 22 },
  chipText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  cardId: { fontFamily: "Inter_500Medium", fontSize: 12, color: C.textMuted },

  cardItems: { marginBottom: 12, gap: 6 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  itemDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.border },
  itemText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary },
  itemPrice: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text },
  moreItems: { fontFamily: "Inter_500Medium", fontSize: 12, color: C.primary },
  expandRow: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: 14, paddingVertical: 4 },

  noteRow: { flexDirection: "row", gap: 8, alignItems: "flex-start", marginBottom: 12, padding: 10, backgroundColor: "#F5F3FF", borderRadius: 12, borderWidth: 1, borderColor: "#EDE9FE" },
  noteText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 12, color: "#5B21B6" },

  rideRoute: { marginBottom: 12, gap: 4 },
  ridePoint: { flexDirection: "row", alignItems: "center", gap: 10 },
  routeDot: { width: 10, height: 10, borderRadius: 5 },
  routeLine: { width: 2, height: 16, backgroundColor: C.border, marginLeft: 4 },
  rideAddr: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 13, color: C.text },

  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statusChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 22 },
  statusText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  totalWrap: { alignItems: "flex-end" },
  totalLabel: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted },
  totalAmount: { fontFamily: "Inter_700Bold", fontSize: 18, color: C.text },

  etaBar: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.borderLight },
  etaText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted },
  payBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  payText: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted },

  riderBar: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.borderLight },
  riderIconWrap: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#DBEAFE", alignItems: "center", justifyContent: "center" },
  riderName: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text },
  riderPhone: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, marginTop: 1 },
  callBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#2563EB", alignItems: "center", justifyContent: "center" },

  cancelBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: "#FEF2F2",
    borderWidth: 1.5, borderColor: "#FECACA",
  },
  cancelBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#DC2626" },
  rateBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: "#FFFBEB",
    borderWidth: 1.5, borderColor: "#FDE68A",
  },
  rateBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#B45309" },
  reviewedBadge: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.borderLight,
  },
  reviewedText: { fontFamily: "Inter_500Medium", fontSize: 12, color: "#92400E" },
  refundBar: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12,
    backgroundColor: "#ECFDF5", borderWidth: 1, borderColor: "#A7F3D0",
  },
  refundText: { fontFamily: "Inter_400Regular", fontSize: 12, color: "#047857" },
  reorderBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: 10, paddingVertical: 10, borderRadius: 14, backgroundColor: "#EFF6FF",
    borderWidth: 1.5, borderColor: "#BFDBFE",
  },
  reorderBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.primary },

  tapHint: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.borderLight,
  },
  tapHintText: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted },

  rideStepperWrap: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.borderLight },
  rideStepperRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center" },
  rideStepItem: { alignItems: "center", width: 56 },
  rideStepDot: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: "#E2E8F0",
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  rideStepLabel: { fontFamily: "Inter_500Medium", fontSize: 9, color: C.textMuted, textAlign: "center" },
  rideStepLine: { flex: 1, height: 2, backgroundColor: "#E2E8F0", marginTop: 10 },
});
