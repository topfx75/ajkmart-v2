import React, { useState, useEffect } from "react";
import {
  ActivityIndicator, Alert, TouchableOpacity, ScrollView, StyleSheet,
  Text, TextInput, View, Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@expo/vector-icons/Ionicons";
import Colors from "@/constants/colors";
import { Font } from "@/constants/typography";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useLanguage } from "@/context/LanguageContext";
import { tDual } from "@workspace/i18n";

const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
const C = Colors.light;

const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

interface VanRoute { id: string; name: string; nameUrdu?: string; fromAddress: string; toAddress: string; farePerSeat: string; distanceKm?: string; durationMin?: number; notes?: string; }
interface VanSchedule { id: string; departureTime: string; returnTime?: string; daysOfWeek: number[]; totalSeats?: number; vehiclePlate?: string; vehicleModel?: string; }
interface RouteDetail extends VanRoute { schedules: VanSchedule[]; }

type Step = "routes" | "schedules" | "date" | "seats" | "confirm";

export default function VanServiceScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Math.max(insets.top, 12);
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const { language } = useLanguage();
  const T = (key: any) => tDual(key, language);

  const [step, setStep] = useState<Step>("routes");
  const [loading, setLoading] = useState(false);

  const [routes, setRoutes] = useState<VanRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<RouteDetail | null>(null);
  const [selectedSchedule, setSelectedSchedule] = useState<VanSchedule | null>(null);
  const [travelDate, setTravelDate] = useState<string>(() => new Date().toISOString().split("T")[0]!);
  const [availability, setAvailability] = useState<{ bookedSeats: number[]; totalSeats: number; available: boolean; reason?: string } | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "wallet">("cash");
  const [passengerName, setPassengerName] = useState("");
  const [passengerPhone, setPassengerPhone] = useState("");
  const [bookingLoading, setBookingLoading] = useState(false);

  /* ── Load routes on mount ── */
  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/van/routes`)
      .then(r => r.json())
      .then(j => setRoutes(j.data ?? []))
      .catch(() => showToast("Could not load routes. Please try again.", "error"))
      .finally(() => setLoading(false));
  }, []);

  async function selectRoute(r: VanRoute) {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/van/routes/${r.id}`);
      const j = await res.json();
      setSelectedRoute(j.data ?? null);
      setSelectedSchedule(null);
      setAvailability(null);
      setSelectedSeats([]);
      setStep("schedules");
    } catch {
      showToast("Could not load schedules.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function checkAvailability(scheduleId: string, date: string) {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/van/schedules/${scheduleId}/availability?date=${date}`);
      const j = await res.json();
      setAvailability(j.data ?? null);
      setSelectedSeats([]);
      setStep("seats");
    } catch {
      showToast("Could not check seat availability.", "error");
    } finally {
      setLoading(false);
    }
  }

  function toggleSeat(num: number) {
    if (availability?.bookedSeats.includes(num)) return;
    setSelectedSeats(prev =>
      prev.includes(num) ? prev.filter(s => s !== num) : [...prev, num].sort((a, b) => a - b)
    );
  }

  async function bookSeats() {
    if (!selectedSchedule || !selectedRoute) return;
    if (selectedSeats.length === 0) { showToast("Please select at least one seat.", "error"); return; }
    if (!user) { showToast("Please log in to book.", "error"); router.push("/auth"); return; }
    setBookingLoading(true);
    try {
      const res = await fetch(`${API_BASE}/van/bookings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-token": token || "",
        },
        body: JSON.stringify({
          scheduleId: selectedSchedule.id,
          travelDate,
          seatNumbers: selectedSeats,
          paymentMethod,
          ...(passengerName ? { passengerName } : {}),
          ...(passengerPhone ? { passengerPhone } : {}),
        }),
      });
      const j = await res.json();
      if (!res.ok) { showToast(j.error || "Booking failed.", "error"); return; }
      showToast("Van seat(s) booked successfully!", "success");
      router.replace("/van/bookings" as any);
    } catch {
      showToast("Booking failed. Please try again.", "error");
    } finally {
      setBookingLoading(false);
    }
  }

  /* ── Back navigation per step ── */
  function goBack() {
    if (step === "schedules") { setStep("routes"); setSelectedRoute(null); }
    else if (step === "date") { setStep("schedules"); }
    else if (step === "seats") { setStep("date"); setAvailability(null); setSelectedSeats([]); }
    else if (step === "confirm") { setStep("seats"); }
    else router.back();
  }

  /* ── Render helpers ── */
  function renderHeader(title: string, sub?: string) {
    return (
      <LinearGradient colors={["#4338CA","#6366F1","#818CF8"]} start={{ x:0, y:0 }} end={{ x:1, y:1 }}
        style={[ss.headerGradient, { paddingTop: topPad + 14 }]}>
        <View style={ss.headerRow}>
          <TouchableOpacity activeOpacity={0.7} onPress={goBack} style={ss.backBtn} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={ss.headerTitle}>{title}</Text>
            {sub ? <Text style={ss.headerSub}>{sub}</Text> : null}
          </View>
          <TouchableOpacity activeOpacity={0.7} onPress={() => router.push("/van/bookings" as any)} hitSlop={12}>
            <Ionicons name="calendar-outline" size={22} color="rgba(255,255,255,0.85)" />
          </TouchableOpacity>
        </View>
      </LinearGradient>
    );
  }

  /* ═══ ROUTES ═══ */
  if (step === "routes") return (
    <View style={ss.root}>
      {renderHeader("Van Service", "Fixed-route commuter vans")}
      {loading ? <View style={ss.center}><ActivityIndicator color={C.primary} size="large" /></View> : (
        <ScrollView contentContainerStyle={ss.content}>
          {routes.length === 0 ? (
            <View style={ss.empty}>
              <Ionicons name="bus-outline" size={48} color={C.textMuted} />
              <Text style={ss.emptyTitle}>No Routes Available</Text>
              <Text style={ss.emptyDesc}>Van service routes will appear here.</Text>
            </View>
          ) : routes.map(r => (
            <TouchableOpacity activeOpacity={0.7} key={r.id} style={ss.routeCard} onPress={() => selectRoute(r)}>
              <View style={ss.routeIcon}>
                <Ionicons name="bus" size={22} color="#6366F1" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={ss.routeName}>{r.name}</Text>
                <Text style={ss.routeFromTo}>{r.fromAddress} → {r.toAddress}</Text>
                {r.distanceKm ? <Text style={ss.routeMeta}>{r.distanceKm} km{r.durationMin ? ` · ${r.durationMin} min` : ""}</Text> : null}
              </View>
              <View style={ss.routeFareCol}>
                <Text style={ss.routeFare}>Rs {parseFloat(r.farePerSeat).toFixed(0)}</Text>
                <Text style={ss.routeFareLabel}>per seat</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );

  /* ═══ SCHEDULES ═══ */
  if (step === "schedules" && selectedRoute) return (
    <View style={ss.root}>
      {renderHeader(selectedRoute.name, `${selectedRoute.fromAddress} → ${selectedRoute.toAddress}`)}
      <ScrollView contentContainerStyle={ss.content}>
        <Text style={ss.sectionLabel}>Select Departure Time</Text>
        {selectedRoute.schedules.length === 0 ? (
          <View style={ss.empty}><Text style={ss.emptyDesc}>No active schedules for this route.</Text></View>
        ) : selectedRoute.schedules.map(s => (
          <TouchableOpacity activeOpacity={0.7} key={s.id} style={[ss.scheduleCard, selectedSchedule?.id === s.id && ss.scheduleCardSelected]}
            onPress={() => { setSelectedSchedule(s); setStep("date"); }}>
            <View style={ss.scheduleRow}>
              <Ionicons name="time-outline" size={20} color="#6366F1" />
              <Text style={ss.scheduleTime}>{s.departureTime}</Text>
              {s.returnTime ? <><Text style={ss.scheduleSep}>·</Text><Ionicons name="return-down-back-outline" size={16} color={C.textMuted} /><Text style={ss.scheduleReturnTime}>{s.returnTime}</Text></> : null}
            </View>
            <View style={ss.daysRow}>
              {(Array.isArray(s.daysOfWeek) ? s.daysOfWeek as number[] : []).map(d => {
                const today = new Date().getDay();
                const isToday = today === (d === 7 ? 0 : d);
                return <View key={d} style={[ss.dayBadge, isToday && ss.dayBadgeActive]}><Text style={[ss.dayBadgeText, isToday && ss.dayBadgeTextActive]}>{DAY_NAMES[d === 7 ? 0 : d]}</Text></View>;
              })}
            </View>
            {s.vehiclePlate ? <Text style={ss.vehicleText}>{s.vehicleModel || "Van"} · {s.vehiclePlate} · {s.totalSeats ?? "?"} seats</Text> : null}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  /* ═══ DATE ═══ */
  if (step === "date" && selectedSchedule) return (
    <View style={ss.root}>
      {renderHeader("Select Travel Date")}
      <ScrollView contentContainerStyle={ss.content}>
        <Text style={ss.sectionLabel}>Choose your travel date</Text>
        {/* Date quick-picks for next 7 days */}
        {Array.from({ length: 7 }, (_, i) => {
          const d = new Date();
          d.setDate(d.getDate() + i);
          const iso = d.toISOString().split("T")[0]!;
          const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : `${DAY_NAMES[d.getDay()]}, ${d.getDate()} ${d.toLocaleString("default",{month:"short"})}`;
          const dow = d.getDay() === 0 ? 7 : d.getDay();
          const running = (Array.isArray(selectedSchedule.daysOfWeek) ? selectedSchedule.daysOfWeek as number[] : []).includes(dow);
          return (
            <TouchableOpacity activeOpacity={0.7} key={iso} style={[ss.datePill, travelDate === iso && ss.datePillSelected, !running && ss.datePillDisabled]}
              onPress={() => { if (!running) return; setTravelDate(iso); }}>
              <Text style={[ss.datePillText, travelDate === iso && ss.datePillTextSelected, !running && ss.datePillTextDisabled]}>{label}</Text>
              {!running && <Text style={ss.notRunning}>Not running</Text>}
            </TouchableOpacity>
          );
        })}
        <View style={{ height: 12 }} />
        <View style={ss.inputRow}>
          <Ionicons name="calendar-outline" size={20} color={C.textMuted} style={{ marginRight: 10 }} />
          <TextInput
            style={[ss.dateInput, { flex: 1 }]}
            value={travelDate}
            onChangeText={v => { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) setTravelDate(v); else setTravelDate(v); }}
            placeholder="YYYY-MM-DD"
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
        </View>
        <TouchableOpacity activeOpacity={0.7} style={[ss.btnPrimary, loading && ss.btnDisabled]} onPress={() => checkAvailability(selectedSchedule.id, travelDate)} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={ss.btnPrimaryText}>Check Availability</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );

  /* ═══ SEATS ═══ */
  if (step === "seats" && selectedSchedule && selectedRoute && availability) {
    const totalSeats = availability.totalSeats;
    const rows = Math.ceil(totalSeats / 4);
    return (
      <View style={ss.root}>
        {renderHeader("Select Seats")}
        <ScrollView contentContainerStyle={ss.content}>
          {!availability.available && availability.reason === "not_running_this_day" ? (
            <View style={ss.empty}>
              <Ionicons name="calendar-outline" size={36} color={C.textMuted} />
              <Text style={ss.emptyTitle}>Not Running This Day</Text>
              <Text style={ss.emptyDesc}>This van does not operate on the selected date. Please choose a different date.</Text>
              <TouchableOpacity activeOpacity={0.7} style={[ss.btnPrimary, { marginTop: 16 }]} onPress={() => setStep("date")}><Text style={ss.btnPrimaryText}>Change Date</Text></TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={ss.seatLegend}>
                {[{color:"#EEF2FF",border:"#A5B4FC",label:"Available"},{color:"#DCFCE7",border:"#86EFAC",label:"Selected"},{color:"#FEE2E2",border:"#FCA5A5",label:"Booked"}].map(l => (
                  <View key={l.label} style={ss.legendItem}>
                    <View style={[ss.legendBox, { backgroundColor: l.color, borderColor: l.border }]} />
                    <Text style={ss.legendLabel}>{l.label}</Text>
                  </View>
                ))}
              </View>

              {/* Driver seat */}
              <View style={ss.driverRow}>
                <View style={ss.driverSeat}><Ionicons name="person" size={16} color="#6366F1" /><Text style={ss.driverLabel}>Driver</Text></View>
              </View>

              {/* Seat grid */}
              <View style={ss.seatGrid}>
                {Array.from({ length: totalSeats }, (_, i) => i + 1).map(num => {
                  const booked = availability.bookedSeats.includes(num);
                  const sel = selectedSeats.includes(num);
                  return (
                    <TouchableOpacity activeOpacity={0.7} key={num} style={[ss.seat, booked ? ss.seatBooked : sel ? ss.seatSelected : ss.seatAvailable]} onPress={() => toggleSeat(num)} disabled={booked}>
                      <Ionicons name="person" size={14} color={booked ? "#EF4444" : sel ? "#16A34A" : "#6366F1"} />
                      <Text style={[ss.seatNum, { color: booked ? "#EF4444" : sel ? "#16A34A" : "#4338CA" }]}>{num}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {selectedSeats.length > 0 ? (
                <View style={ss.seatSummary}>
                  <Text style={ss.seatSummaryText}>
                    {selectedSeats.length} seat{selectedSeats.length > 1 ? "s" : ""} selected · Rs {(selectedSeats.length * parseFloat(selectedRoute.farePerSeat)).toFixed(0)}
                  </Text>
                  <TouchableOpacity activeOpacity={0.7} style={ss.btnPrimary} onPress={() => setStep("confirm")}>
                    <Text style={ss.btnPrimaryText}>Continue</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      </View>
    );
  }

  /* ═══ CONFIRM ═══ */
  if (step === "confirm" && selectedRoute && selectedSchedule && availability) {
    const fareTotal = selectedSeats.length * parseFloat(selectedRoute.farePerSeat);
    return (
      <View style={ss.root}>
        {renderHeader("Confirm Booking")}
        <ScrollView contentContainerStyle={ss.content}>
          <View style={ss.confirmCard}>
            <View style={ss.confirmRow}><Text style={ss.confirmLabel}>Route</Text><Text style={ss.confirmValue}>{selectedRoute.name}</Text></View>
            <View style={ss.confirmRow}><Text style={ss.confirmLabel}>From</Text><Text style={ss.confirmValue}>{selectedRoute.fromAddress}</Text></View>
            <View style={ss.confirmRow}><Text style={ss.confirmLabel}>To</Text><Text style={ss.confirmValue}>{selectedRoute.toAddress}</Text></View>
            <View style={ss.confirmRow}><Text style={ss.confirmLabel}>Departure</Text><Text style={ss.confirmValue}>{selectedSchedule.departureTime}</Text></View>
            <View style={ss.confirmRow}><Text style={ss.confirmLabel}>Date</Text><Text style={ss.confirmValue}>{travelDate}</Text></View>
            <View style={ss.confirmRow}><Text style={ss.confirmLabel}>Seats</Text><Text style={ss.confirmValue}>{selectedSeats.join(", ")}</Text></View>
            <View style={ss.confirmRow}><Text style={ss.confirmLabel}>Fare/Seat</Text><Text style={ss.confirmValue}>Rs {parseFloat(selectedRoute.farePerSeat).toFixed(0)}</Text></View>
            <View style={[ss.confirmRow, ss.confirmTotal]}><Text style={ss.confirmTotalLabel}>Total</Text><Text style={ss.confirmTotalValue}>Rs {fareTotal.toFixed(0)}</Text></View>
          </View>

          <Text style={ss.sectionLabel}>Passenger Details (optional)</Text>
          <View style={ss.inputGroup}>
            <View style={ss.inputRow}>
              <Ionicons name="person-outline" size={18} color={C.textMuted} style={{ marginRight: 10 }} />
              <TextInput style={{ flex: 1, fontFamily: Font.regular, fontSize: 14, color: C.text }} placeholder="Passenger name" value={passengerName} onChangeText={setPassengerName} />
            </View>
            <View style={ss.inputRow}>
              <Ionicons name="call-outline" size={18} color={C.textMuted} style={{ marginRight: 10 }} />
              <TextInput style={{ flex: 1, fontFamily: Font.regular, fontSize: 14, color: C.text }} placeholder="Passenger phone" value={passengerPhone} onChangeText={setPassengerPhone} keyboardType="phone-pad" />
            </View>
          </View>

          <Text style={ss.sectionLabel}>Payment Method</Text>
          <View style={ss.payRow}>
            {(["cash","wallet"] as const).map(pm => (
              <TouchableOpacity activeOpacity={0.7} key={pm} style={[ss.payBtn, paymentMethod === pm && ss.payBtnSelected]} onPress={() => setPaymentMethod(pm)}>
                <Ionicons name={pm === "cash" ? "cash-outline" : "wallet-outline"} size={18} color={paymentMethod === pm ? "#fff" : C.textMuted} />
                <Text style={[ss.payBtnText, paymentMethod === pm && { color: "#fff" }]}>{pm === "cash" ? "Cash" : "Wallet"}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity activeOpacity={0.7} style={[ss.btnPrimary, bookingLoading && ss.btnDisabled]} onPress={bookSeats} disabled={bookingLoading}>
            {bookingLoading ? <ActivityIndicator color="#fff" /> : <Text style={ss.btnPrimaryText}>Confirm Booking</Text>}
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return <View style={[ss.root, ss.center]}><ActivityIndicator color={C.primary} /></View>;
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F5F6F8" },
  headerGradient: { paddingHorizontal: 16, paddingBottom: 18 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  backBtn: { padding: 4 },
  headerTitle: { fontFamily: Font.bold, fontSize: 20, color: "#fff" },
  headerSub: { fontFamily: Font.regular, fontSize: 13, color: "rgba(255,255,255,0.8)", marginTop: 2 },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", justifyContent: "center", padding: 32 },
  emptyTitle: { fontFamily: Font.semiBold, fontSize: 17, color: "#374151", marginTop: 12 },
  emptyDesc: { fontFamily: Font.regular, fontSize: 14, color: "#6B7280", textAlign: "center", marginTop: 6, lineHeight: 20 },
  sectionLabel: { fontFamily: Font.semiBold, fontSize: 13, color: "#6B7280", marginBottom: 12, marginTop: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  routeCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 10, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  routeIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: "#EEF2FF", alignItems: "center", justifyContent: "center", marginRight: 12 },
  routeName: { fontFamily: Font.semiBold, fontSize: 15, color: "#111827" },
  routeFromTo: { fontFamily: Font.regular, fontSize: 13, color: "#6B7280", marginTop: 2 },
  routeMeta: { fontFamily: Font.regular, fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  routeFareCol: { alignItems: "flex-end", marginRight: 8 },
  routeFare: { fontFamily: Font.bold, fontSize: 16, color: "#16A34A" },
  routeFareLabel: { fontFamily: Font.regular, fontSize: 11, color: "#9CA3AF" },
  scheduleCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 2, borderColor: "transparent", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  scheduleCardSelected: { borderColor: "#6366F1" },
  scheduleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  scheduleTime: { fontFamily: Font.bold, fontSize: 20, color: "#111827" },
  scheduleSep: { color: "#9CA3AF" },
  scheduleReturnTime: { fontFamily: Font.regular, fontSize: 14, color: "#6B7280" },
  daysRow: { flexDirection: "row", gap: 6, marginTop: 10 },
  dayBadge: { backgroundColor: "#F3F4F6", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  dayBadgeActive: { backgroundColor: "#EEF2FF" },
  dayBadgeText: { fontFamily: Font.semiBold, fontSize: 11, color: "#6B7280" },
  dayBadgeTextActive: { color: "#6366F1" },
  vehicleText: { fontFamily: Font.regular, fontSize: 12, color: "#9CA3AF", marginTop: 8 },
  datePill: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 2, borderColor: "transparent" },
  datePillSelected: { borderColor: "#6366F1", backgroundColor: "#EEF2FF" },
  datePillDisabled: { opacity: 0.5 },
  datePillText: { fontFamily: Font.semiBold, fontSize: 15, color: "#111827" },
  datePillTextSelected: { color: "#4338CA" },
  datePillTextDisabled: { color: "#9CA3AF" },
  notRunning: { fontFamily: Font.regular, fontSize: 11, color: "#EF4444" },
  inputGroup: { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 16, gap: 12 },
  inputRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#F9FAFB", borderRadius: 10, padding: 12, marginBottom: 8 },
  dateInput: { fontFamily: Font.regular, fontSize: 15, color: "#111827" },
  btnPrimary: { backgroundColor: "#6366F1", borderRadius: 14, padding: 16, alignItems: "center", marginTop: 8 },
  btnPrimaryText: { fontFamily: Font.bold, fontSize: 16, color: "#fff" },
  btnDisabled: { opacity: 0.6 },
  seatLegend: { flexDirection: "row", gap: 16, marginBottom: 16, justifyContent: "center" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendBox: { width: 16, height: 16, borderRadius: 4, borderWidth: 1.5 },
  legendLabel: { fontFamily: Font.regular, fontSize: 12, color: "#6B7280" },
  driverRow: { flexDirection: "row", justifyContent: "flex-start", marginBottom: 8 },
  driverSeat: { width: 56, height: 40, backgroundColor: "#E0E7FF", borderRadius: 10, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 2 },
  driverLabel: { fontFamily: Font.semiBold, fontSize: 10, color: "#6366F1" },
  seatGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center", marginBottom: 16 },
  seat: { width: 56, height: 56, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 2, gap: 2 },
  seatAvailable: { backgroundColor: "#EEF2FF", borderColor: "#A5B4FC" },
  seatSelected: { backgroundColor: "#DCFCE7", borderColor: "#86EFAC" },
  seatBooked: { backgroundColor: "#FEE2E2", borderColor: "#FCA5A5" },
  seatNum: { fontFamily: Font.bold, fontSize: 12 },
  seatSummary: { backgroundColor: "#EEF2FF", borderRadius: 14, padding: 14, marginTop: 8 },
  seatSummaryText: { fontFamily: Font.semiBold, fontSize: 14, color: "#4338CA", marginBottom: 10, textAlign: "center" },
  confirmCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 16, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  confirmRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  confirmLabel: { fontFamily: Font.regular, fontSize: 13, color: "#6B7280" },
  confirmValue: { fontFamily: Font.semiBold, fontSize: 13, color: "#111827", maxWidth: "60%", textAlign: "right" },
  confirmTotal: { borderBottomWidth: 0, paddingTop: 12, marginTop: 4 },
  confirmTotalLabel: { fontFamily: Font.bold, fontSize: 15, color: "#111827" },
  confirmTotalValue: { fontFamily: Font.bold, fontSize: 18, color: "#16A34A" },
  payRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  payBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#F9FAFB", borderRadius: 12, padding: 14, borderWidth: 2, borderColor: "#E5E7EB" },
  payBtnSelected: { backgroundColor: "#6366F1", borderColor: "#6366F1" },
  payBtnText: { fontFamily: Font.semiBold, fontSize: 14, color: "#6B7280" },
});
