import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, TouchableOpacity, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@expo/vector-icons/Ionicons";
import Colors from "@/constants/colors";
import { Font } from "@/constants/typography";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";

const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
const C = Colors.light;

interface VanBooking {
  id: string;
  scheduleId: string;
  seatNumbers: number[];
  travelDate: string;
  status: string;
  fare: string;
  paymentMethod: string;
  routeName?: string;
  routeFrom?: string;
  routeTo?: string;
  departureTime?: string;
  cancelledAt?: string;
  boardedAt?: string;
  completedAt?: string;
  createdAt: string;
}

const STATUS_INFO: Record<string, { color: string; bg: string; icon: any; label: string }> = {
  confirmed: { color: "#2563EB", bg: "#DBEAFE", icon: "checkmark-circle-outline", label: "Confirmed" },
  boarded:   { color: "#D97706", bg: "#FEF3C7", icon: "bus-outline",               label: "Boarded" },
  completed: { color: "#16A34A", bg: "#DCFCE7", icon: "checkmark-done-circle",     label: "Completed" },
  cancelled: { color: "#DC2626", bg: "#FEE2E2", icon: "close-circle-outline",      label: "Cancelled" },
};

export default function VanBookingsScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Math.max(insets.top, 12);
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const [bookings, setBookings] = useState<VanBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  async function fetchBookings() {
    if (!token) { setLoading(false); return; }
    try {
      const res = await fetch(`${API_BASE}/van/bookings`, {
        headers: { "x-auth-token": token },
      });
      const j = await res.json();
      setBookings(j.data ?? []);
    } catch {
      showToast("Could not load your bookings.", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { fetchBookings(); }, []);

  async function cancelBooking(id: string) {
    Alert.alert("Cancel Booking", "Are you sure you want to cancel this booking?", [
      { text: "No", style: "cancel" },
      {
        text: "Yes, Cancel", style: "destructive", onPress: async () => {
          setCancelling(id);
          try {
            const res = await fetch(`${API_BASE}/van/bookings/${id}/cancel`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", "x-auth-token": token || "" },
              body: JSON.stringify({ reason: "customer_cancelled" }),
            });
            const j = await res.json();
            if (!res.ok) { showToast(j.error || "Cancellation failed.", "error"); return; }
            showToast("Booking cancelled. Refund will be processed if paid by wallet.", "success");
            fetchBookings();
          } catch {
            showToast("Cancellation failed. Please try again.", "error");
          } finally {
            setCancelling(null);
          }
        }
      }
    ]);
  }

  return (
    <View style={ss.root}>
      <LinearGradient colors={["#4338CA","#6366F1","#818CF8"]} start={{ x:0,y:0 }} end={{ x:1,y:1 }}
        style={[ss.header, { paddingTop: topPad + 14 }]}>
        <View style={ss.headerRow}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => router.back()} style={ss.backBtn} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={ss.headerTitle}>My Van Bookings</Text>
          <TouchableOpacity activeOpacity={0.7} onPress={() => router.push("/van" as any)} hitSlop={12}>
            <Ionicons name="add-circle-outline" size={24} color="rgba(255,255,255,0.85)" />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {!user ? (
        <View style={ss.center}>
          <Ionicons name="person-circle-outline" size={48} color={C.textMuted} />
          <Text style={ss.emptyTitle}>Login to See Bookings</Text>
          <TouchableOpacity activeOpacity={0.7} style={ss.btnPrimary} onPress={() => router.push("/auth")}><Text style={ss.btnPrimaryText}>Login</Text></TouchableOpacity>
        </View>
      ) : loading ? (
        <View style={ss.center}><ActivityIndicator color="#6366F1" size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={[ss.content, bookings.length === 0 && ss.emptyContent]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchBookings(); }} tintColor="#6366F1" />}
        >
          {bookings.length === 0 ? (
            <View style={ss.empty}>
              <Ionicons name="bus-outline" size={48} color={C.textMuted} />
              <Text style={ss.emptyTitle}>No Bookings Yet</Text>
              <Text style={ss.emptyDesc}>Your van seat bookings will appear here.</Text>
              <TouchableOpacity activeOpacity={0.7} style={[ss.btnPrimary, { marginTop: 20 }]} onPress={() => router.push("/van" as any)}>
                <Text style={ss.btnPrimaryText}>Book a Seat</Text>
              </TouchableOpacity>
            </View>
          ) : (
            bookings.map(b => {
              const statusInfo = STATUS_INFO[b.status] ?? STATUS_INFO["confirmed"]!;
              const canCancel = b.status === "confirmed";
              return (
                <View key={b.id} style={ss.card}>
                  <View style={ss.cardHeader}>
                    <View style={[ss.statusBadge, { backgroundColor: statusInfo.bg }]}>
                      <Ionicons name={statusInfo.icon} size={14} color={statusInfo.color} />
                      <Text style={[ss.statusText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
                    </View>
                    <Text style={ss.cardDate}>{b.travelDate}</Text>
                  </View>
                  <Text style={ss.routeName}>{b.routeName ?? "—"}</Text>
                  <Text style={ss.routeFromTo}>{b.routeFrom} → {b.routeTo}</Text>
                  <View style={ss.detailRow}>
                    <View style={ss.detailItem}><Ionicons name="time-outline" size={14} color={C.textMuted} /><Text style={ss.detailText}>{b.departureTime ?? "—"}</Text></View>
                    <View style={ss.detailItem}><Ionicons name="person-outline" size={14} color={C.textMuted} /><Text style={ss.detailText}>Seat{(Array.isArray(b.seatNumbers) ? b.seatNumbers as number[] : []).length > 1 ? "s" : ""} {(Array.isArray(b.seatNumbers) ? b.seatNumbers as number[] : []).join(", ")}</Text></View>
                    <View style={ss.detailItem}><Ionicons name={b.paymentMethod === "wallet" ? "wallet-outline" : "cash-outline"} size={14} color={C.textMuted} /><Text style={ss.detailText}>Rs {parseFloat(b.fare).toFixed(0)}</Text></View>
                  </View>
                  {canCancel && (
                    <TouchableOpacity activeOpacity={0.7}
                      style={[ss.cancelBtn, cancelling === b.id && ss.cancelBtnDisabled]}
                      onPress={() => cancelBooking(b.id)}
                      disabled={cancelling === b.id}
                    >
                      {cancelling === b.id ? <ActivityIndicator color="#DC2626" size="small" /> : (
                        <><Ionicons name="close-circle-outline" size={16} color="#DC2626" /><Text style={ss.cancelBtnText}>Cancel Booking</Text></>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F5F6F8" },
  header: { paddingHorizontal: 16, paddingBottom: 18 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  backBtn: { padding: 4 },
  headerTitle: { fontFamily: Font.bold, fontSize: 20, color: "#fff", flex: 1, marginLeft: 12 },
  content: { padding: 16, paddingBottom: 40 },
  emptyContent: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontFamily: Font.semiBold, fontSize: 17, color: "#374151", marginTop: 12 },
  emptyDesc: { fontFamily: Font.regular, fontSize: 14, color: "#6B7280", textAlign: "center", marginTop: 6 },
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 10, elevation: 3 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontFamily: Font.semiBold, fontSize: 12 },
  cardDate: { fontFamily: Font.semiBold, fontSize: 13, color: "#6B7280" },
  routeName: { fontFamily: Font.bold, fontSize: 16, color: "#111827", marginBottom: 2 },
  routeFromTo: { fontFamily: Font.regular, fontSize: 13, color: "#6B7280", marginBottom: 12 },
  detailRow: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
  detailItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  detailText: { fontFamily: Font.regular, fontSize: 13, color: "#374151" },
  cancelBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: "#FCA5A5", backgroundColor: "#FFF1F1" },
  cancelBtnDisabled: { opacity: 0.6 },
  cancelBtnText: { fontFamily: Font.semiBold, fontSize: 14, color: "#DC2626" },
  btnPrimary: { backgroundColor: "#6366F1", borderRadius: 14, paddingHorizontal: 24, paddingVertical: 14, alignItems: "center" },
  btnPrimaryText: { fontFamily: Font.bold, fontSize: 15, color: "#fff" },
});
