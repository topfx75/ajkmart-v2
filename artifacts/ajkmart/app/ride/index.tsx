import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { router } from "expo-router";
import { useMapsAutocomplete, resolveLocation, getDirections } from "@/hooks/useMaps";
import type { MapPrediction } from "@/hooks/useMaps";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Linking,
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
import { usePlatformConfig } from "@/context/PlatformConfigContext";

const C   = Colors.light;
const W   = Dimensions.get("window").width;
const API = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

/* ─── Popular spots (quick-fill chips) ─── */
const POPULAR_SPOTS = [
  { name: "Muzaffarabad Chowk", lat: 34.3697, lng: 73.4716 },
  { name: "Mirpur City Centre", lat: 33.1413, lng: 73.7508 },
  { name: "Rawalakot Bazar",    lat: 33.8572, lng: 73.7613 },
  { name: "Bagh City",          lat: 33.9732, lng: 73.7729 },
  { name: "Kotli Main Chowk",   lat: 33.5152, lng: 73.9019 },
  { name: "Poonch City",        lat: 33.7700, lng: 74.0954 },
  { name: "Neelum Valley",      lat: 34.5689, lng: 73.8765 },
  { name: "AJK University",     lat: 34.3601, lng: 73.5088 },
];


function calcFareFromConfig(
  dist: number, type: "bike" | "car",
  cfg: { bikeBaseFare: number; bikePerKm: number; bikeMinFare: number; carBaseFare: number; carPerKm: number; carMinFare: number; surgeEnabled: boolean; surgeMultiplier: number }
) {
  const base   = type === "bike" ? cfg.bikeBaseFare : cfg.carBaseFare;
  const perKm  = type === "bike" ? cfg.bikePerKm    : cfg.carPerKm;
  const minF   = type === "bike" ? cfg.bikeMinFare  : cfg.carMinFare;
  const raw    = Math.round(base + dist * perKm);
  const withMin = Math.max(minF, raw);
  return Math.round(withMin * (cfg.surgeEnabled ? cfg.surgeMultiplier : 1));
}

/* ─── Live Ride Tracker (replaces fake SearchingOverlay + ConfirmedScreen) ─── */
function RideTracker({ rideId, initialType, userId, cancellationFee, onReset }: {
  rideId: string;
  initialType: "bike" | "car";
  userId: string;
  cancellationFee: number;
  onReset: () => void;
}) {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const pulse   = useRef(new Animated.Value(1)).current;
  const slideUp = useRef(new Animated.Value(40)).current;
  const op      = useRef(new Animated.Value(0)).current;

  const [dots,      setDots]      = useState(".");
  const [ride,      setRide]      = useState<any>(null);
  const [cancelling,setCancelling]= useState(false);
  const prevStatus  = useRef<string>("");

  /* Pulse animation — always running (used on searching screen) */
  useEffect(() => {
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.18, duration: 600, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1,    duration: 600, useNativeDriver: true }),
    ]));
    anim.start();
    const dotTimer = setInterval(() => setDots(d => d.length >= 3 ? "." : d + "."), 400);
    return () => { anim.stop(); clearInterval(dotTimer); };
  }, []);

  /* Slide-in when driver accepts (searching → accepted) */
  useEffect(() => {
    const st = ride?.status;
    if (st && st !== "searching" && prevStatus.current === "searching") {
      slideUp.setValue(40); op.setValue(0);
      Animated.parallel([
        Animated.spring(slideUp, { toValue: 0, useNativeDriver: true, bounciness: 8 }),
        Animated.timing(op,      { toValue: 1, duration: 400,        useNativeDriver: true }),
      ]).start();
    }
    prevStatus.current = st || "";
  }, [ride?.status]);

  /* Poll GET /rides/:id every 5 seconds */
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`${API}/rides/${rideId}`);
        if (res.ok) setRide(await res.json());
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
  }, [rideId]);

  const cancelRide = async () => {
    setCancelling(true);
    try {
      await fetch(`${API}/rides/${rideId}/cancel`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
    } catch {}
    setCancelling(false);
  };

  const openInMaps = () => {
    const oLat = ride?.pickupLat ?? 34.37;
    const oLng = ride?.pickupLng ?? 73.47;
    const dLat = ride?.dropLat   ?? 33.14;
    const dLng = ride?.dropLng   ?? 73.75;
    Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&origin=${oLat},${oLng}&destination=${dLat},${dLng}&travelmode=driving`
    );
  };

  const status   = ride?.status ?? "searching";
  const rideType = ride?.type ?? initialType;

  const TRACK_STEPS  = ["accepted", "arrived", "in_transit", "completed"];
  const TRACK_LABELS = ["Accepted", "Arrived", "In Transit", "Done"];
  const currentStep  = TRACK_STEPS.indexOf(status);

  /* ── Searching screen ── */
  if (status === "searching") {
    return (
      <View style={ov.root}>
        <LinearGradient colors={["#0F3BA8", "#1A56DB"]} style={ov.bg} />
        <View style={ov.content}>
          <Animated.View style={[ov.pulseRing, { transform: [{ scale: pulse }] }]}>
            <View style={ov.pulseInner}>
              <Ionicons name={rideType === "bike" ? "bicycle" : "car"} size={48} color="#fff" />
            </View>
          </Animated.View>
          <Text style={ov.title}>Driver Dhund Rahe Hain{dots}</Text>
          <Text style={ov.sub}>AJK mein qareeb se qareeb driver assign ho raha hai</Text>
          <View style={ov.statsRow}>
            <View style={ov.statBox}>
              <Text style={ov.statVal}>50+</Text>
              <Text style={ov.statLbl}>Active Drivers</Text>
            </View>
            <View style={[ov.statBox, { borderLeftWidth: 1, borderLeftColor: "rgba(255,255,255,0.2)" }]}>
              <Text style={ov.statVal}>2-5</Text>
              <Text style={ov.statLbl}>Min ETA</Text>
            </View>
          </View>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: -8 }}>
            Ride #{rideId.slice(-8).toUpperCase()}
          </Text>
          <Pressable onPress={cancelRide} disabled={cancelling} style={ov.cancelBtn}>
            {cancelling
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={ov.cancelTxt}>Cancel Ride</Text>
            }
          </Pressable>
        </View>
      </View>
    );
  }

  /* ── Cancelled screen ── */
  if (status === "cancelled") {
    return (
      <View style={{ flex: 1, backgroundColor: C.background, alignItems: "center", justifyContent: "center", padding: 32, gap: 16 }}>
        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="close-circle" size={48} color="#DC2626" />
        </View>
        <Text style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: C.text }}>Ride Cancelled</Text>
        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: C.textSecondary, textAlign: "center" }}>
          Aapki ride cancel ho gayi.{ride?.paymentMethod !== "cash" ? " Cancellation fee apply ho sakti hai." : ""}
        </Text>
        <View style={{ flexDirection: "row", gap: 12, marginTop: 8, width: "100%" }}>
          <Pressable onPress={() => router.push("/(tabs)")} style={[cf.homeBtn, { flex: 1 }]}>
            <Ionicons name="home-outline" size={17} color={C.primary} />
            <Text style={cf.homeBtnTxt}>Home</Text>
          </Pressable>
          <Pressable onPress={onReset} style={cf.newBtn}>
            <Ionicons name="add" size={17} color="#fff" />
            <Text style={cf.newBtnTxt}>New Ride</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  /* ── Completed screen ── */
  if (status === "completed") {
    return (
      <View style={{ flex: 1, backgroundColor: C.background }}>
        <LinearGradient colors={["#065F46", "#059669"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[cf.header, { paddingTop: topPad + 16 }]}>
          <View style={cf.checkCircle}>
            <Ionicons name="checkmark" size={34} color="#fff" />
          </View>
          <Text style={cf.headerTitle}>Ride Complete! 🎉</Text>
          <Text style={cf.headerSub}>Rs. {ride?.fare} · {ride?.distance} km</Text>
        </LinearGradient>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 14 }}>
          <View style={cf.card}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Text style={cf.cardTitle}>Route Details</Text>
              <Pressable onPress={openInMaps} style={cf.mapsBtn}>
                <Ionicons name="navigate-outline" size={13} color="#4285F4" />
                <Text style={cf.mapsBtnTxt}>Google Maps</Text>
              </Pressable>
            </View>
            <View style={cf.routeRow}>
              <View style={{ alignItems: "center", gap: 4 }}>
                <View style={[cf.routeDot, { backgroundColor: "#10B981" }]} />
                <View style={cf.routeLine} />
                <View style={[cf.routeDot, { backgroundColor: "#EF4444" }]} />
              </View>
              <View style={{ flex: 1, gap: 12 }}>
                <View><Text style={cf.routeLabel}>Pickup</Text><Text style={cf.routeVal}>{ride?.pickupAddress}</Text></View>
                <View><Text style={cf.routeLabel}>Drop</Text><Text style={cf.routeVal}>{ride?.dropAddress}</Text></View>
              </View>
            </View>
          </View>
          <View style={cf.card}>
            <Text style={cf.cardTitle}>Fare Breakdown</Text>
            <View style={cf.fareRows}>
              <View style={cf.fareRow}><Text style={cf.fareLbl}>Vehicle</Text><Text style={cf.fareVal}>{rideType === "bike" ? "🏍️ Bike" : "🚗 Car"}</Text></View>
              <View style={cf.fareRow}><Text style={cf.fareLbl}>Distance</Text><Text style={cf.fareVal}>{ride?.distance} km</Text></View>
              <View style={cf.fareRow}><Text style={cf.fareLbl}>Payment</Text><Text style={cf.fareVal}>{ride?.paymentMethod === "wallet" ? "💳 Wallet" : "💵 Cash"}</Text></View>
              <View style={[cf.fareRow, cf.fareTotalRow]}>
                <Text style={cf.fareTotalLbl}>Total Fare</Text>
                <Text style={cf.fareTotalVal}>Rs. {ride?.fare}</Text>
              </View>
            </View>
          </View>
          <View style={cf.rideIdRow}>
            <Ionicons name="receipt-outline" size={14} color={C.textMuted} />
            <Text style={cf.rideIdTxt}>Ride ID: #{rideId?.slice(-8).toUpperCase()}</Text>
          </View>
          <View style={cf.safetyRow}>
            <Ionicons name="shield-checkmark" size={14} color="#059669" />
            <Text style={cf.safetyTxt}>Insured ride • Verified driver • GPS tracked</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
            <Pressable onPress={() => router.push("/(tabs)")} style={cf.homeBtn}>
              <Ionicons name="home-outline" size={17} color={C.primary} />
              <Text style={cf.homeBtnTxt}>Home</Text>
            </Pressable>
            <Pressable onPress={onReset} style={cf.newBtn}>
              <Ionicons name="add" size={17} color="#fff" />
              <Text style={cf.newBtnTxt}>New Ride</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  /* ── Active tracking: accepted / arrived / in_transit ── */
  const canCancel = status === "accepted";
  const statusHeaders: Record<string, { title: string; sub: string; icon: string }> = {
    accepted:   { title: "Driver Aa Raha Hai! 🚗", sub: "Driver ne aapki ride accept kar li",  icon: "person" },
    arrived:    { title: "Driver Pahunch Gaya! 📍", sub: "Driver aapke pickup point pe hai",    icon: "location" },
    in_transit: { title: "Aap Route Mein Hain 🛣",  sub: "Aapki ride chal rahi hai",            icon: "car" },
  };
  const hdr = statusHeaders[status] ?? statusHeaders["accepted"]!;

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <LinearGradient colors={["#065F46", "#059669"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[cf.header, { paddingTop: topPad + 16 }]}>
        <View style={cf.checkCircle}>
          <Ionicons name={hdr.icon as any} size={34} color="#fff" />
        </View>
        <Text style={cf.headerTitle}>{hdr.title}</Text>
        <Text style={cf.headerSub}>{hdr.sub}</Text>
      </LinearGradient>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Animated.View style={{ opacity: op, transform: [{ translateY: slideUp }] }}>

          {/* Status Progress */}
          <View style={cf.card}>
            <Text style={[cf.cardTitle, { marginBottom: 16 }]}>Ride Progress</Text>
            <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
              {TRACK_STEPS.map((step, i) => {
                const done   = currentStep >= i;
                const active = currentStep === i;
                const isLast = i === TRACK_STEPS.length - 1;
                return (
                  <React.Fragment key={step}>
                    <View style={{ alignItems: "center", flex: 1, gap: 6 }}>
                      <View style={{
                        width: 30, height: 30, borderRadius: 15,
                        backgroundColor: done ? "#059669" : "#E2E8F0",
                        alignItems: "center", justifyContent: "center",
                        borderWidth: active ? 3 : 0, borderColor: "#065F46",
                      }}>
                        {done
                          ? <Ionicons name="checkmark" size={14} color="#fff" />
                          : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#CBD5E1" }} />
                        }
                      </View>
                      <Text style={{
                        fontSize: 9, textAlign: "center",
                        color: done ? "#059669" : "#94A3B8",
                        fontFamily: active ? "Inter_700Bold" : "Inter_400Regular",
                      }}>{TRACK_LABELS[i]}</Text>
                    </View>
                    {!isLast && (
                      <View style={{ height: 2, flex: 0.3, backgroundColor: currentStep > i ? "#059669" : "#E2E8F0", marginTop: 14 }} />
                    )}
                  </React.Fragment>
                );
              })}
            </View>
          </View>

          {/* Rider info — shown once driver accepts */}
          {ride?.riderName && (
            <View style={cf.card}>
              <View style={cf.driverRow}>
                <View style={cf.driverAvatar}>
                  <Text style={{ fontSize: 28 }}>{rideType === "bike" ? "🏍" : "🚗"}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={cf.driverName}>{ride.riderName}</Text>
                  {ride.riderPhone && (
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, marginTop: 2 }}>
                      {ride.riderPhone}
                    </Text>
                  )}
                  <View style={cf.plateRow}>
                    <Ionicons name="shield-checkmark-outline" size={13} color="#059669" />
                    <Text style={cf.plateTxt}>Verified Driver</Text>
                  </View>
                </View>
                {ride.riderPhone && (
                  <Pressable onPress={() => Linking.openURL(`tel:${ride.riderPhone}`)} style={cf.actionBtn}>
                    <Ionicons name="call-outline" size={20} color={C.primary} />
                  </Pressable>
                )}
              </View>
            </View>
          )}

          {/* Route */}
          <View style={cf.card}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Text style={cf.cardTitle}>Route</Text>
              <Pressable onPress={openInMaps} style={cf.mapsBtn}>
                <Ionicons name="navigate-outline" size={13} color="#4285F4" />
                <Text style={cf.mapsBtnTxt}>Google Maps</Text>
              </Pressable>
            </View>
            <View style={cf.routeRow}>
              <View style={{ alignItems: "center", gap: 4 }}>
                <View style={[cf.routeDot, { backgroundColor: "#10B981" }]} />
                <View style={cf.routeLine} />
                <View style={[cf.routeDot, { backgroundColor: "#EF4444" }]} />
              </View>
              <View style={{ flex: 1, gap: 12 }}>
                <View><Text style={cf.routeLabel}>Pickup</Text><Text style={cf.routeVal}>{ride?.pickupAddress}</Text></View>
                <View><Text style={cf.routeLabel}>Drop</Text><Text style={cf.routeVal}>{ride?.dropAddress}</Text></View>
              </View>
            </View>
          </View>

          {/* Fare */}
          <View style={cf.card}>
            <View style={cf.fareRows}>
              <View style={cf.fareRow}>
                <Text style={cf.fareLbl}>Fare</Text>
                <Text style={[cf.fareVal, { color: "#059669", fontFamily: "Inter_700Bold", fontSize: 18 }]}>Rs. {ride?.fare}</Text>
              </View>
              <View style={cf.fareRow}>
                <Text style={cf.fareLbl}>Payment</Text>
                <Text style={cf.fareVal}>{ride?.paymentMethod === "wallet" ? "💳 Wallet" : "💵 Cash"}</Text>
              </View>
            </View>
          </View>

          {/* Safety */}
          <View style={cf.safetyRow}>
            <Ionicons name="shield-checkmark" size={14} color="#059669" />
            <Text style={cf.safetyTxt}>Insured ride • Verified driver • GPS tracked</Text>
          </View>

          {/* Cancel — only available when accepted (cancellation fee applies) */}
          {canCancel && (
            <Pressable onPress={cancelRide} disabled={cancelling} style={{
              flexDirection: "row", alignItems: "center", justifyContent: "center",
              gap: 6, padding: 14, borderRadius: 14,
              backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA",
            }}>
              {cancelling
                ? <ActivityIndicator color="#DC2626" size="small" />
                : <>
                    <Ionicons name="close-circle-outline" size={18} color="#DC2626" />
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#DC2626" }}>
                      Cancel Ride (Rs. {cancellationFee} fee may apply)
                    </Text>
                  </>
              }
            </Pressable>
          )}

          {/* Orders tab shortcut */}
          <Pressable onPress={() => router.push("/(tabs)/orders")} style={cf.homeBtn}>
            <Ionicons name="list-outline" size={17} color={C.primary} />
            <Text style={cf.homeBtnTxt}>Track from Orders Tab</Text>
          </Pressable>
        </Animated.View>
        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

/* ════════════════════ MAIN RIDE SCREEN ════════════════════ */
export default function RideScreen() {
  const insets = useSafeAreaInsets();
  const { user, updateUser } = useAuth();
  const { showToast } = useToast();
  const { config } = usePlatformConfig();
  const rideCfg = config.rides;
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  type LocObj = { lat: number; lng: number; address: string };

  const [pickup,     setPickup]    = useState("");
  const [drop,       setDrop]      = useState("");
  const [pickupObj,  setPickupObj] = useState<LocObj | null>(null);
  const [dropObj,    setDropObj]   = useState<LocObj | null>(null);
  const [rideType,   setRideType]  = useState<"bike" | "car">("bike");
  const [payMethod,  setPayMethod] = useState<"cash" | "wallet">("cash");
  const [estimate,   setEstimate]  = useState<{ fare: number; dist: number; dur: string } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [booking,    setBooking]   = useState(false);
  const [booked,     setBooked]    = useState<any>(null);
  const [showHistory,setShowHistory] = useState(false);
  const [history,    setHistory]   = useState<any[]>([]);
  const [histLoading,setHistLoading] = useState(false);
  const [locLoading, setLocLoading] = useState(false);

  const [pickupFocus, setPickupFocus] = useState(false);
  const [dropFocus,   setDropFocus]   = useState(false);

  /* Live autocomplete from Maps API */
  const { predictions: pickupPreds, loading: pickupLoading } = useMapsAutocomplete(pickupFocus ? pickup : "");
  const { predictions: dropPreds,   loading: dropLoading }   = useMapsAutocomplete(dropFocus   ? drop   : "");

  /* ── Get device location for pickup auto-fill ── */
  const handleMyLocation = async () => {
    setLocLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") { showToast("Location permission nahi mili", "error"); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude: lat, longitude: lng } = pos.coords;
      const res  = await fetch(`https://${process.env.EXPO_PUBLIC_DOMAIN}/api/maps/geocode?address=${lat},${lng}`);
      const data = await res.json();
      const address = data.formattedAddress ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      setPickup(address);
      setPickupObj({ lat, lng, address });
    } catch {
      showToast("Location nahi mil saki. Manually likhein.", "error");
    } finally {
      setLocLoading(false);
    }
  };

  /* ── Fetch real directions when both locations set ── */
  useEffect(() => {
    if (!pickupObj || !dropObj) { setEstimate(null); return; }

    setEstimating(true);
    getDirections(pickupObj.lat, pickupObj.lng, dropObj.lat, dropObj.lng,
      rideType === "bike" ? "bicycling" : "driving"
    ).then(result => {
      const dist = result?.distanceKm ?? 0;
      const dur  = result?.durationText ?? `${Math.round(dist * 3 + 5)} min`;
      const fare = calcFareFromConfig(dist, rideType, rideCfg);
      setEstimate({ fare, dist, dur });
    }).finally(() => setEstimating(false));
  }, [pickupObj, dropObj, rideType, rideCfg]);

  /* ── Select a prediction from the list ── */
  const selectPickup = useCallback(async (pred: MapPrediction) => {
    setPickup(pred.mainText);
    setPickupFocus(false);
    const loc = await resolveLocation(pred);
    setPickupObj({ ...loc, address: pred.description });
    setPickup(pred.description);
  }, []);

  const selectDrop = useCallback(async (pred: MapPrediction) => {
    setDrop(pred.mainText);
    setDropFocus(false);
    const loc = await resolveLocation(pred);
    setDropObj({ ...loc, address: pred.description });
    setDrop(pred.description);
  }, []);

  /* ── Select popular spot chip ── */
  const handleChip = (spot: typeof POPULAR_SPOTS[0]) => {
    if (!pickupObj) {
      setPickup(spot.name);
      setPickupObj({ lat: spot.lat, lng: spot.lng, address: spot.name });
    } else if (!dropObj) {
      setDrop(spot.name);
      setDropObj({ lat: spot.lat, lng: spot.lng, address: spot.name });
    }
  };

  const handleBook = async () => {
    if (!pickup || !drop) { showToast("Pickup aur drop location select karein", "error"); return; }
    if (!user)            { showToast("Login karein ride book karne ke liye", "error"); return; }
    if (payMethod === "wallet" && estimate && (user.walletBalance ?? 0) < estimate.fare) {
      showToast(`Wallet balance Rs. ${user.walletBalance} — fare Rs. ${estimate.fare} se kam hai. Wallet top up karein.`, "error");
      return;
    }
    setBooking(true);
    try {
      const res = await fetch(`${API}/rides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id, type: rideType,
          pickupAddress: pickup, dropAddress: drop,
          pickupLat: pickupObj?.lat ?? 34.37, pickupLng: pickupObj?.lng ?? 73.47,
          dropLat: dropObj?.lat ?? 33.14,     dropLng: dropObj?.lng ?? 73.75,
          paymentMethod: payMethod,
        }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || "Booking fail ho gayi", "error"); return; }
      if (payMethod === "wallet") updateUser({ walletBalance: (user.walletBalance ?? 0) - data.fare });
      setBooked(data);
    } catch { showToast("Network error. Dobara try karein.", "error"); }
    finally { setBooking(false); }
  };

  const fetchHistory = async () => {
    if (!user) return;
    setHistLoading(true);
    try {
      const res = await fetch(`${API}/rides?userId=${user.id}`);
      const data = await res.json();
      setHistory(data.rides || []);
    } catch { setHistory([]); }
    finally { setHistLoading(false); }
  };

  if (booked) {
    return (
      <RideTracker
        rideId={booked.id}
        initialType={booked.type ?? rideType}
        userId={user?.id ?? ""}
        cancellationFee={rideCfg.cancellationFee ?? 30}
        onReset={() => { setBooked(null); setPickup(""); setDrop(""); setPickupObj(null); setDropObj(null); setEstimate(null); }}
      />
    );
  }

  const bikeFeatures = [
    `Rs. ${rideCfg.bikeBaseFare} base + Rs. ${rideCfg.bikePerKm}/km`,
    "Helmet included", "Fastest route", "GPS tracked",
  ];
  const carFeatures = [
    `Rs. ${rideCfg.carBaseFare} base + Rs. ${rideCfg.carPerKm}/km`,
    "AC available", "4 passengers", "GPS tracked",
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* HEADER */}
      <LinearGradient colors={["#065F46","#059669","#10B981"]} start={{ x:0,y:0 }} end={{ x:1,y:1 }} style={[rs.header, { paddingTop: topPad + 12 }]}>
        <View style={[rs.blob, { width:180, height:180, top:-50, right:-40 }]} />
        <View style={rs.hdrRow}>
          <Pressable onPress={() => router.back()} style={rs.backBtn}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex:1, marginLeft:10 }}>
            <Text style={rs.hdrTitle}>🚗 Book a Ride</Text>
            <Text style={rs.hdrSub}>AJK mein kahin bhi, kabhi bhi</Text>
          </View>
          <Pressable onPress={() => { setShowHistory(true); fetchHistory(); }} style={rs.histBtn}>
            <Ionicons name="time-outline" size={18} color="#fff" />
          </Pressable>
        </View>

        {/* Location Card */}
        <View style={rs.locCard}>
          {/* My Location button */}
          <Pressable onPress={handleMyLocation} disabled={locLoading} style={rs.myLocBtn}>
            {locLoading
              ? <ActivityIndicator size="small" color="#059669" />
              : <Ionicons name="locate-outline" size={14} color="#059669" />
            }
            <Text style={rs.myLocTxt}>{locLoading ? "Locating..." : "Use my location"}</Text>
          </Pressable>

          {/* Pickup */}
          <View style={rs.locRow}>
            <View style={rs.dotGreen} />
            <TextInput
              value={pickup}
              onChangeText={v => { setPickup(v); setPickupObj(null); }}
              onFocus={() => setPickupFocus(true)}
              onBlur={() => setTimeout(() => setPickupFocus(false), 250)}
              placeholder="Pickup location type karein..."
              placeholderTextColor={C.textMuted}
              style={rs.locInput}
            />
            {pickup.length > 0 && (
              <Pressable onPress={() => { setPickup(""); setPickupObj(null); }}>
                <Ionicons name="close-circle" size={16} color={C.textMuted} />
              </Pressable>
            )}
          </View>

          {pickupFocus && (
            <View style={rs.sugg}>
              {pickupLoading && <ActivityIndicator size="small" color="#059669" style={{ padding: 8 }} />}
              <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="always">
                {pickupPreds.slice(0, 6).map(pred => (
                  <Pressable key={pred.placeId} onPress={() => selectPickup(pred)} style={rs.suggRow}>
                    <Ionicons name="location-outline" size={14} color="#10B981" />
                    <View style={{ flex: 1 }}>
                      <Text style={rs.suggTxt}>{pred.mainText}</Text>
                      {pred.secondaryText ? <Text style={rs.suggSub} numberOfLines={1}>{pred.secondaryText}</Text> : null}
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          <View style={rs.sep}>
            <View style={rs.sepLine} />
            <Pressable onPress={() => {
              const t = pickup; const to = pickupObj;
              setPickup(drop); setPickupObj(dropObj);
              setDrop(t); setDropObj(to);
            }} style={rs.swapBtn}>
              <Ionicons name="swap-vertical" size={14} color={C.primary} />
            </Pressable>
            <View style={rs.sepLine} />
          </View>

          {/* Drop */}
          <View style={rs.locRow}>
            <View style={rs.dotRed} />
            <TextInput
              value={drop}
              onChangeText={v => { setDrop(v); setDropObj(null); }}
              onFocus={() => setDropFocus(true)}
              onBlur={() => setTimeout(() => setDropFocus(false), 250)}
              placeholder="Drop location type karein..."
              placeholderTextColor={C.textMuted}
              style={rs.locInput}
            />
            {drop.length > 0 && (
              <Pressable onPress={() => { setDrop(""); setDropObj(null); }}>
                <Ionicons name="close-circle" size={16} color={C.textMuted} />
              </Pressable>
            )}
          </View>

          {dropFocus && (
            <View style={rs.sugg}>
              {dropLoading && <ActivityIndicator size="small" color="#EF4444" style={{ padding: 8 }} />}
              <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="always">
                {dropPreds.slice(0, 6).map(pred => (
                  <Pressable key={pred.placeId} onPress={() => selectDrop(pred)} style={rs.suggRow}>
                    <Ionicons name="location-outline" size={14} color="#EF4444" />
                    <View style={{ flex: 1 }}>
                      <Text style={rs.suggTxt}>{pred.mainText}</Text>
                      {pred.secondaryText ? <Text style={rs.suggSub} numberOfLines={1}>{pred.secondaryText}</Text> : null}
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      </LinearGradient>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={rs.scroll}>
        {/* Popular Locations */}
        <View style={rs.secRow}><Text style={rs.secTitle}>Popular Locations</Text></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={rs.chips}>
          {POPULAR_SPOTS.map(spot => (
            <Pressable key={spot.name} onPress={() => handleChip(spot)} style={rs.chip}>
              <Ionicons name="location-outline" size={12} color="#059669" />
              <Text style={rs.chipTxt}>{spot.name}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Surge Banner */}
        {rideCfg.surgeEnabled && (
          <View style={{ marginHorizontal: 16, marginBottom: 8, backgroundColor: "#FFF7ED", borderWidth: 1, borderColor: "#FED7AA", borderRadius: 12, padding: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="flash" size={16} color="#EA580C" />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: "#C2410C" }}>Surge Pricing Active ×{rideCfg.surgeMultiplier}</Text>
              <Text style={{ fontSize: 11, color: "#9A3412" }}>High demand — fares are {Math.round((rideCfg.surgeMultiplier - 1) * 100)}% higher right now</Text>
            </View>
          </View>
        )}

        {/* Vehicle Cards */}
        <View style={rs.secRow}><Text style={rs.secTitle}>Vehicle Type</Text></View>
        <View style={rs.vehicleRow}>
          {(["bike", "car"] as const).map(type => {
            const active = rideType === type;
            const feats = type === "bike" ? bikeFeatures : carFeatures;
            const fromPrice = `Rs. ${type === "bike" ? rideCfg.bikeMinFare : rideCfg.carMinFare}`;
            return (
              <Pressable key={type} onPress={() => setRideType(type)} style={[rs.vCard, active && rs.vCardActive]}>
                {active && <LinearGradient colors={["#059669","#10B981"]} style={rs.vGrad} />}
                <View style={[rs.vIconBox, { backgroundColor: active ? "rgba(255,255,255,0.2)" : "#D1FAE5" }]}>
                  <Ionicons name={type === "bike" ? "bicycle" : "car"} size={32} color={active ? "#fff" : "#059669"} />
                </View>
                <Text style={[rs.vTitle, active && { color: "#fff" }]}>{type === "bike" ? "Bike" : "Car"}</Text>
                <Text style={[rs.vFrom, active && { color: "rgba(255,255,255,0.85)" }]}>From {fromPrice}</Text>
                <View style={{ gap: 5, marginTop: 8 }}>
                  {feats.map(f => (
                    <View key={f} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                      <Ionicons name="checkmark-circle" size={11} color={active ? "rgba(255,255,255,0.8)" : "#059669"} />
                      <Text style={[rs.vFeat, active && { color: "rgba(255,255,255,0.85)" }]}>{f}</Text>
                    </View>
                  ))}
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Fare Estimate */}
        {estimating && (
          <View style={[rs.fareCard, { alignItems: "center", padding: 16 }]}>
            <ActivityIndicator color="#059669" />
            <Text style={{ marginTop: 6, fontSize: 12, color: C.textMuted }}>Route calculate ho raha hai...</Text>
          </View>
        )}
        {!estimating && estimate && (
          <View style={rs.fareCard}>
            <LinearGradient colors={["#F0FDF4","#DCFCE7"]} style={rs.fareInner}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <Text style={rs.fareTitle}>📍 Fare Estimate</Text>
                <Pressable onPress={() => {
                  if (pickupObj && dropObj) {
                    const url = `https://www.google.com/maps/dir/?api=1&origin=${pickupObj.lat},${pickupObj.lng}&destination=${dropObj.lat},${dropObj.lng}&travelmode=${rideType === "bike" ? "bicycling" : "driving"}`;
                    Linking.openURL(url);
                  }
                }} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#fff", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: "#BBDEFB" }}>
                  <Ionicons name="navigate-outline" size={12} color="#4285F4" />
                  <Text style={{ fontSize: 11, color: "#4285F4", fontWeight: "700" }}>View Route</Text>
                </Pressable>
              </View>
              <View style={rs.fareGrid}>
                <View style={rs.fareItem}>
                  <Text style={rs.fareItemLbl}>Distance</Text>
                  <Text style={rs.fareItemVal}>{estimate.dist} km</Text>
                </View>
                <View style={rs.fareDivider} />
                <View style={rs.fareItem}>
                  <Text style={rs.fareItemLbl}>Duration</Text>
                  <Text style={rs.fareItemVal}>{estimate.dur}</Text>
                </View>
                <View style={rs.fareDivider} />
                <View style={rs.fareItem}>
                  <Text style={rs.fareItemLbl}>Total Fare</Text>
                  <Text style={[rs.fareItemVal, { color: "#059669", fontSize: 20 }]}>Rs. {estimate.fare}</Text>
                </View>
              </View>
            </LinearGradient>
          </View>
        )}

        {/* Payment */}
        <View style={rs.secRow}><Text style={rs.secTitle}>Payment Method</Text></View>
        <View style={rs.payRow}>
          {(["cash", "wallet"] as const).map(pm => {
            const active = payMethod === pm;
            const insufficient = pm === "wallet" && estimate && (user?.walletBalance ?? 0) < estimate.fare;
            return (
              <Pressable key={pm} onPress={() => setPayMethod(pm)} style={[rs.payCard, active && rs.payCardActive]}>
                <View style={[rs.payIcon, { backgroundColor: active ? (pm === "wallet" ? "#DBEAFE" : "#D1FAE5") : "#F1F5F9" }]}>
                  <Ionicons name={pm === "cash" ? "cash-outline" : "wallet-outline"} size={22} color={active ? (pm === "wallet" ? C.primary : C.success) : C.textSecondary} />
                </View>
                <Text style={[rs.payLbl, active && { color: C.text, fontFamily: "Inter_700Bold" }]}>{pm === "cash" ? "Cash" : "Wallet"}</Text>
                <Text style={[rs.paySub, insufficient && { color: C.danger }]}>
                  {pm === "cash" ? "Pay on arrival" : `Rs. ${(user?.walletBalance ?? 0).toLocaleString()}`}
                </Text>
                {active && <View style={[rs.payCheck, { backgroundColor: pm === "wallet" ? C.primary : C.success }]}><Ionicons name="checkmark" size={11} color="#fff" /></View>}
              </Pressable>
            );
          })}
        </View>

        {/* Cancellation Fee Info */}
        <View style={{ marginHorizontal: 16, marginBottom: 8, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 10, padding: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Ionicons name="information-circle-outline" size={15} color="#64748B" />
          <Text style={{ fontSize: 11, color: "#475569", flex: 1 }}>
            Cancellation fee of Rs. {rideCfg.cancellationFee} applies if you cancel after a driver accepts your ride.
          </Text>
        </View>

        {/* Safety */}
        <View style={rs.safetyRow}>
          <Ionicons name="shield-checkmark-outline" size={15} color="#059669" />
          <Text style={rs.safetyTxt}>All rides insured • Verified drivers • GPS tracked</Text>
        </View>

        {/* Book Button */}
        <Pressable onPress={handleBook} disabled={booking} style={[rs.bookBtn, booking && { opacity: 0.7 }]}>
          {booking ? <ActivityIndicator color="#fff" /> : (
            <>
              <Ionicons name={rideType === "bike" ? "bicycle" : "car"} size={20} color="#fff" />
              <Text style={rs.bookBtnTxt}>Book {rideType === "bike" ? "Bike" : "Car"} Now{estimate ? ` • Rs. ${estimate.fare}` : ""}</Text>
            </>
          )}
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Ride History Modal */}
      <Modal visible={showHistory} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowHistory(false)}>
        <View style={rs.histModal}>
          <View style={rs.histHeader}>
            <Text style={rs.histTitle}>My Ride History</Text>
            <Pressable onPress={() => setShowHistory(false)}>
              <Ionicons name="close" size={22} color={C.text} />
            </Pressable>
          </View>
          {histLoading ? (
            <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
          ) : history.length === 0 ? (
            <View style={rs.histEmpty}>
              <Text style={{ fontSize: 48 }}>🚗</Text>
              <Text style={rs.histEmptyTxt}>Abhi tak koi ride book nahi hui</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8 }}>
              {history.map((ride, i) => (
                <View key={ride.id || i} style={rs.histItem}>
                  <View style={[rs.histIcon, { backgroundColor: ride.type === "bike" ? "#D1FAE5" : "#DBEAFE" }]}>
                    <Ionicons name={ride.type === "bike" ? "bicycle" : "car"} size={20} color={ride.type === "bike" ? "#059669" : C.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={rs.histRoute}>{ride.pickupAddress} → {ride.dropAddress}</Text>
                    <Text style={rs.histMeta}>{ride.distance} km • {new Date(ride.createdAt).toLocaleDateString("en-PK", { day: "numeric", month: "short" })}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={rs.histFare}>Rs. {ride.fare}</Text>
                    <View style={[rs.histStatus, { backgroundColor: ride.status === "completed" ? "#D1FAE5" : ride.status === "cancelled" ? "#FEE2E2" : "#FEF3C7" }]}>
                      <Text style={[rs.histStatusTxt, { color: ride.status === "completed" ? "#059669" : ride.status === "cancelled" ? "#DC2626" : "#D97706" }]}>
                        {{ searching: "Finding Rider", accepted: "Accepted", arrived: "Arrived", in_transit: "In Transit", completed: "Completed", cancelled: "Cancelled", ongoing: "In Transit" }[ride.status as string] ?? ride.status}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
              <View style={{ height: 30 }} />
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

/* ── Searching Overlay Styles ── */
const ov = StyleSheet.create({
  root: { flex: 1 },
  bg: { ...StyleSheet.absoluteFillObject },
  content: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 20 },
  pulseRing: { width: 140, height: 140, borderRadius: 70, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  pulseInner: { width: 100, height: 100, borderRadius: 50, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  title: { fontFamily: "Inter_700Bold", fontSize: 22, color: "#fff", textAlign: "center" },
  sub: { fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,255,255,0.8)", textAlign: "center", lineHeight: 19 },
  statsRow: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 14, overflow: "hidden" },
  statBox: { flex: 1, alignItems: "center", padding: 14, gap: 3 },
  statVal: { fontFamily: "Inter_700Bold", fontSize: 20, color: "#fff" },
  statLbl: { fontFamily: "Inter_400Regular", fontSize: 11, color: "rgba(255,255,255,0.75)" },
  cancelBtn: { backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 14, paddingHorizontal: 24, paddingVertical: 13, borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" },
  cancelTxt: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: "#fff" },
});

/* ── Confirmed Screen Styles ── */
const cf = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 24, alignItems: "center", gap: 8 },
  checkCircle: { width: 72, height: 72, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 22, color: "#fff" },
  headerSub: { fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,255,255,0.85)" },
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border },
  driverRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  driverAvatar: { width: 56, height: 56, borderRadius: 16, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  driverName: { fontFamily: "Inter_700Bold", fontSize: 16, color: C.text, marginBottom: 3 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 3, marginBottom: 5 },
  ratingTxt: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginLeft: 4 },
  plateRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  plateTxt: { fontFamily: "Inter_500Medium", fontSize: 12, color: C.textSecondary },
  etaBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#D1FAE5", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 20 },
  etaTxt: { fontFamily: "Inter_600SemiBold", fontSize: 10, color: "#059669" },
  actionBtn: { width: 38, height: 38, borderRadius: 11, backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center" },
  cardTitle: { fontFamily: "Inter_700Bold", fontSize: 14, color: C.text },
  mapsBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#EFF6FF", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8 },
  mapsBtnTxt: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: "#4285F4" },
  routeRow: { flexDirection: "row", gap: 12, alignItems: "stretch" },
  routeDot: { width: 12, height: 12, borderRadius: 6 },
  routeLine: { flex: 1, width: 2, backgroundColor: C.border, alignSelf: "center" },
  routeLabel: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted },
  routeVal: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.text, marginTop: 2 },
  fareRows: { gap: 8 },
  fareRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fareLbl: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted },
  fareVal: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.text },
  fareTotalRow: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  fareTotalLbl: { fontFamily: "Inter_700Bold", fontSize: 15, color: C.text },
  fareTotalVal: { fontFamily: "Inter_700Bold", fontSize: 18, color: "#059669" },
  rideIdRow: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center" },
  rideIdTxt: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted },
  safetyRow: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", backgroundColor: "#D1FAE5", padding: 10, borderRadius: 12 },
  safetyTxt: { fontFamily: "Inter_400Regular", fontSize: 12, color: "#065F46" },
  homeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 14, borderRadius: 14, backgroundColor: "#EFF6FF" },
  homeBtnTxt: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.primary },
  newBtn: { flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 14, borderRadius: 14, backgroundColor: "#059669" },
  newBtnTxt: { fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" },
});

/* ── Main Screen Styles ── */
const rs = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingBottom: 16, overflow: "hidden" },
  blob: { position: "absolute", borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)" },
  hdrRow: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  backBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  hdrTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: "#fff" },
  hdrSub: { fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.8)" },
  histBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },

  locCard: { backgroundColor: "#fff", borderRadius: 16, padding: 14, elevation: 4 },
  myLocBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 7, paddingHorizontal: 4, marginBottom: 6 },
  myLocTxt: { fontFamily: "Inter_500Medium", fontSize: 12, color: "#059669" },
  locRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dotGreen: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#10B981", borderWidth: 2, borderColor: "#D1FAE5" },
  dotRed:   { width: 12, height: 12, borderRadius: 6, backgroundColor: "#EF4444", borderWidth: 2, borderColor: "#FEE2E2" },
  locInput: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 15, color: C.text, paddingVertical: 9 },
  sep: { flexDirection: "row", alignItems: "center", marginVertical: 4, gap: 8 },
  sepLine: { flex: 1, height: 1, backgroundColor: C.borderLight },
  swapBtn: { width: 28, height: 28, borderRadius: 8, backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center" },
  sugg: { backgroundColor: "#F8FAFC", borderRadius: 10, marginTop: 4, borderWidth: 1, borderColor: C.borderLight, maxHeight: 200 },
  suggRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  suggTxt: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.text },
  suggSub: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginTop: 1 },

  scroll: { padding: 16 },
  secRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16, marginBottom: 10 },
  secTitle: { fontFamily: "Inter_700Bold", fontSize: 15, color: C.text },

  chips: { gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#DCFCE7", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  chipTxt: { fontFamily: "Inter_500Medium", fontSize: 12, color: "#065F46" },

  vehicleRow: { flexDirection: "row", gap: 12 },
  vCard: { flex: 1, borderRadius: 16, padding: 14, borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff", overflow: "hidden" },
  vCardActive: { borderColor: "#059669" },
  vGrad: { ...StyleSheet.absoluteFillObject, borderRadius: 16 },
  vIconBox: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  vTitle: { fontFamily: "Inter_700Bold", fontSize: 18, color: C.text },
  vFrom: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, marginBottom: 4 },
  vFeat: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textSecondary },

  fareCard: { borderRadius: 14, overflow: "hidden", marginTop: 12 },
  fareInner: { padding: 16 },
  fareTitle: { fontFamily: "Inter_700Bold", fontSize: 14, color: "#065F46" },
  fareGrid: { flexDirection: "row", alignItems: "center" },
  fareItem: { flex: 1, alignItems: "center" },
  fareItemLbl: { fontFamily: "Inter_400Regular", fontSize: 11, color: "#065F46", opacity: 0.7 },
  fareItemVal: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#059669", marginTop: 3 },
  fareDivider: { width: 1, height: 36, backgroundColor: "rgba(5,150,105,0.2)" },

  payRow: { flexDirection: "row", gap: 10 },
  payCard: { flex: 1, alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff", gap: 5, position: "relative" },
  payCardActive: { borderColor: C.success },
  payIcon: { width: 46, height: 46, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  payLbl: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.textSecondary },
  paySub: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted },
  payCheck: { position: "absolute", top: 8, right: 8, width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },

  safetyRow: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#D1FAE5", padding: 10, borderRadius: 12, marginTop: 12 },
  safetyTxt: { fontFamily: "Inter_400Regular", fontSize: 12, color: "#065F46", flex: 1 },

  bookBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#059669", borderRadius: 16, paddingVertical: 16, marginTop: 16 },
  bookBtnTxt: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" },

  histModal: { flex: 1, backgroundColor: "#fff" },
  histHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  histTitle: { fontFamily: "Inter_700Bold", fontSize: 18, color: C.text },
  histEmpty: { alignItems: "center", justifyContent: "center", flex: 1, gap: 12 },
  histEmptyTxt: { fontFamily: "Inter_500Medium", fontSize: 14, color: C.textMuted },
  histItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  histIcon: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  histRoute: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.text, flex: 1 },
  histMeta: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginTop: 3 },
  histFare: { fontFamily: "Inter_700Bold", fontSize: 14, color: C.text },
  histStatus: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  histStatusTxt: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
});
