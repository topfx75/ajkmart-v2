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

/* ─── Professional Ride Tracker — Careem/Uber style ─── */
function RideTracker({ rideId, initialType, userId, cancellationFee, onReset }: {
  rideId: string;
  initialType: "bike" | "car";
  userId: string;
  cancellationFee: number;
  onReset: () => void;
}) {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  /* ── Animation refs ── */
  const ring1     = useRef(new Animated.Value(1)).current;
  const ring2     = useRef(new Animated.Value(1)).current;
  const ring3     = useRef(new Animated.Value(1)).current;
  const ring1Op   = useRef(new Animated.Value(0.55)).current;
  const ring2Op   = useRef(new Animated.Value(0.38)).current;
  const ring3Op   = useRef(new Animated.Value(0.22)).current;
  const slideUp   = useRef(new Animated.Value(50)).current;
  const fadeIn    = useRef(new Animated.Value(0)).current;

  /* ── State ── */
  const [ride,           setRide]           = useState<any>(null);
  const [cancelling,     setCancelling]     = useState(false);
  const [showCancelModal,setShowCancelModal]= useState(false);
  const [rating,         setRating]         = useState(0);
  const [ratingDone,     setRatingDone]     = useState(false);
  const [elapsed,        setElapsed]        = useState(0);
  const prevStatus   = useRef<string>("");

  /* ── Triple concentric pulse (staggered) ── */
  useEffect(() => {
    const pulse = (scale: Animated.Value, op: Animated.Value, delay: number, resetOp: number) =>
      Animated.loop(Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1.55, duration: 1300, useNativeDriver: true }),
          Animated.timing(op,    { toValue: 0,    duration: 1300, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(op,    { toValue: resetOp, duration: 0, useNativeDriver: true }),
        ]),
      ]));
    const a1 = pulse(ring1, ring1Op, 0,   0.55);
    const a2 = pulse(ring2, ring2Op, 350, 0.38);
    const a3 = pulse(ring3, ring3Op, 700, 0.22);
    a1.start(); a2.start(); a3.start();
    const timer = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => { a1.stop(); a2.stop(); a3.stop(); clearInterval(timer); };
  }, []);

  /* ── Slide-in on status change ── */
  useEffect(() => {
    const st = ride?.status;
    if (st && st !== "searching" && prevStatus.current === "searching") {
      slideUp.setValue(50); fadeIn.setValue(0);
      Animated.parallel([
        Animated.spring(slideUp, { toValue: 0, useNativeDriver: true, bounciness: 6 }),
        Animated.timing(fadeIn,  { toValue: 1, duration: 500, useNativeDriver: true }),
      ]).start();
    }
    if (!prevStatus.current && st && st !== "searching") {
      slideUp.setValue(0); fadeIn.setValue(1);
    }
    prevStatus.current = st || "";
  }, [ride?.status]);

  /* ── Poll every 5s ── */
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(`${API}/rides/${rideId}`);
        if (r.ok) setRide(await r.json());
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
  }, [rideId]);

  const cancelRide = async () => {
    setCancelling(true);
    setShowCancelModal(false);
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
    const oLat = ride?.pickupLat ?? 34.37, oLng = ride?.pickupLng ?? 73.47;
    const dLat = ride?.dropLat   ?? 33.14, dLng = ride?.dropLng   ?? 73.75;
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${oLat},${oLng}&destination=${dLat},${dLng}&travelmode=driving`);
  };

  const status   = ride?.status ?? "searching";
  const rideType = ride?.type   ?? initialType;
  const STEPS    = ["accepted", "arrived", "in_transit", "completed"];
  const LABELS   = ["Accepted", "Arrived", "On Route", "Done"];
  const stepIdx  = STEPS.indexOf(status);
  const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

  /* ════════════════ SEARCHING ════════════════ */
  if (status === "searching") {
    return (
      <View style={{ flex: 1 }}>
        <LinearGradient colors={["#0D47C0", "#1565C0", "#1E88E5"]} style={StyleSheet.absoluteFillObject} />
        <View style={{ position: "absolute", top: -70, right: -70, width: 240, height: 240, borderRadius: 120, backgroundColor: "rgba(255,255,255,0.05)" }} />
        <View style={{ position: "absolute", bottom: 100, left: -50, width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(255,255,255,0.04)" }} />

        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
          {/* Ride badge */}
          <View style={{ backgroundColor: "rgba(255,255,255,0.13)", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, marginBottom: 44 }}>
            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: "rgba(255,255,255,0.9)", letterSpacing: 1 }}>
              RIDE #{rideId.slice(-8).toUpperCase()}
            </Text>
          </View>

          {/* Triple pulse rings */}
          <View style={{ width: 230, height: 230, alignItems: "center", justifyContent: "center" }}>
            <Animated.View style={{ position: "absolute", width: 230, height: 230, borderRadius: 115, backgroundColor: "rgba(255,255,255,0.07)", transform: [{ scale: ring3 }], opacity: ring3Op }} />
            <Animated.View style={{ position: "absolute", width: 176, height: 176, borderRadius: 88,  backgroundColor: "rgba(255,255,255,0.11)", transform: [{ scale: ring2 }], opacity: ring2Op }} />
            <Animated.View style={{ position: "absolute", width: 122, height: 122, borderRadius: 61,  backgroundColor: "rgba(255,255,255,0.17)", transform: [{ scale: ring1 }], opacity: ring1Op }} />
            <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: "rgba(255,255,255,0.24)", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.35)" }}>
              <Ionicons name={rideType === "bike" ? "bicycle" : "car"} size={42} color="#fff" />
            </View>
          </View>

          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 24, color: "#fff", marginTop: 36, textAlign: "center" }}>
            Driver Dhund Rahe Hain
          </Text>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: "rgba(255,255,255,0.75)", marginTop: 8, textAlign: "center", lineHeight: 21 }}>
            AJK mein qareeb driver assign ho raha hai
          </Text>

          {/* Elapsed timer */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginTop: 18, backgroundColor: "rgba(255,255,255,0.12)", paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20 }}>
            <Ionicons name="time-outline" size={14} color="rgba(255,255,255,0.8)" />
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,255,255,0.8)" }}>
              Searching for {elapsedStr}
            </Text>
          </View>

          {/* Stats */}
          <View style={{ flexDirection: "row", backgroundColor: "rgba(255,255,255,0.11)", borderRadius: 16, overflow: "hidden", marginTop: 36, width: "100%" }}>
            {[{ val: "50+", lbl: "Active Drivers" }, { val: "2–5", lbl: "Min ETA" }].map((s, i) => (
              <View key={i} style={{ flex: 1, alignItems: "center", padding: 16, borderLeftWidth: i > 0 ? 1 : 0, borderLeftColor: "rgba(255,255,255,0.15)" }}>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: "#fff" }}>{s.val}</Text>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "rgba(255,255,255,0.7)", marginTop: 4 }}>{s.lbl}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Cancel */}
        <View style={{ paddingHorizontal: 24, paddingBottom: Math.max(insets.bottom, 24) + 16 }}>
          <Pressable onPress={cancelRide} disabled={cancelling} style={{ alignItems: "center", padding: 16, borderRadius: 16, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.3)", backgroundColor: "rgba(255,255,255,0.1)" }}>
            {cancelling
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 15, color: "#fff" }}>Cancel Ride</Text>
            }
          </Pressable>
        </View>
      </View>
    );
  }

  /* ════════════════ CANCELLED ════════════════ */
  if (status === "cancelled") {
    const wasWallet = ride?.paymentMethod === "wallet";
    return (
      <View style={{ flex: 1, backgroundColor: "#FFF5F5" }}>
        <LinearGradient colors={["#B91C1C", "#DC2626"]} style={{ paddingTop: topPad + 20, paddingBottom: 32, alignItems: "center", gap: 10, paddingHorizontal: 24 }}>
          <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="close-circle" size={44} color="#fff" />
          </View>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: "#fff" }}>Ride Cancelled</Text>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,255,255,0.85)", textAlign: "center" }}>Aapki ride cancel ho gayi hai</Text>
        </LinearGradient>
        <ScrollView contentContainerStyle={{ margin: 16, gap: 12 }}>
          {wasWallet && (
            <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 16, borderLeftWidth: 4, borderLeftColor: "#10B981", gap: 6, borderWidth: 1, borderColor: "#D1FAE5" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="wallet-outline" size={18} color="#10B981" />
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#065F46" }}>Refund Initiated</Text>
              </View>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: "#374151", lineHeight: 19 }}>
                Rs. {ride?.fare} aapki wallet mein refund ho raha hai.{cancellationFee > 0 ? ` Agar rider assign tha to Rs. ${cancellationFee} cancellation fee apply hogi.` : ""}
              </Text>
            </View>
          )}
          <View style={{ backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#F3F4F6", alignItems: "center" }}>
            <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: "#9CA3AF" }}>
              Ride ID: #{rideId.slice(-8).toUpperCase()}
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable onPress={() => router.push("/(tabs)")} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 15, borderRadius: 14, backgroundColor: "#EFF6FF" }}>
              <Ionicons name="home-outline" size={17} color="#2563EB" />
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#2563EB" }}>Home</Text>
            </Pressable>
            <Pressable onPress={onReset} style={{ flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 15, borderRadius: 14, backgroundColor: "#059669" }}>
              <Ionicons name="add" size={17} color="#fff" />
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" }}>New Ride</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  /* ════════════════ COMPLETED ════════════════ */
  if (status === "completed") {
    return (
      <View style={{ flex: 1, backgroundColor: "#F0FDF4" }}>
        <LinearGradient colors={["#065F46", "#059669"]} style={{ paddingTop: topPad + 16, paddingBottom: 28, alignItems: "center", gap: 8, paddingHorizontal: 24 }}>
          <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="checkmark-circle" size={44} color="#fff" />
          </View>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: "#fff" }}>Ride Manzil Pe! 🎉</Text>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,255,255,0.85)" }}>Rs. {ride?.fare} · {ride?.distance} km</Text>
        </LinearGradient>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 14, gap: 12 }}>
          {/* Rating */}
          {!ratingDone ? (
            <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 18, alignItems: "center", gap: 10, borderWidth: 1.5, borderColor: "#D1FAE5" }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: "#065F46" }}>Driver ko Rate Karein</Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {[1,2,3,4,5].map(s => (
                  <Pressable key={s} onPress={() => { setRating(s); setTimeout(() => setRatingDone(true), 500); }}>
                    <Ionicons name={s <= rating ? "star" : "star-outline"} size={36} color={s <= rating ? "#F59E0B" : "#D1D5DB"} />
                  </Pressable>
                ))}
              </View>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#6B7280" }}>
                {rating === 0 ? "Tap to rate" : rating === 5 ? "Zabardast! ⭐⭐⭐⭐⭐" : rating >= 4 ? "Acha tha! 👍" : rating >= 3 ? "Theek tha" : "Masail the"}
              </Text>
            </View>
          ) : (
            <View style={{ backgroundColor: "#D1FAE5", borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name="checkmark-circle" size={22} color="#059669" />
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#065F46" }}>Shukriya! Rating de di ✨</Text>
            </View>
          )}

          {/* Receipt */}
          <View style={{ backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E2E8F0", overflow: "hidden" }}>
            <View style={{ backgroundColor: "#F8FAFC", padding: 12, borderBottomWidth: 1, borderBottomColor: "#E2E8F0", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: "#374151" }}>Ride Receipt</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Ionicons name="receipt-outline" size={13} color="#9CA3AF" />
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "#9CA3AF" }}>#{rideId.slice(-8).toUpperCase()}</Text>
              </View>
            </View>
            <View style={{ padding: 14, gap: 10 }}>
              {[
                { lbl: "Vehicle",  val: rideType === "bike" ? "🏍️  Bike" : "🚗  Car" },
                { lbl: "Distance", val: `${ride?.distance} km` },
                { lbl: "Payment",  val: ride?.paymentMethod === "wallet" ? "💳  Wallet" : "💵  Cash" },
                { lbl: "Driver",   val: ride?.riderName || "AJK Driver" },
              ].map(r => (
                <View key={r.lbl} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: "#6B7280" }}>{r.lbl}</Text>
                  <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: "#111827" }}>{r.val}</Text>
                </View>
              ))}
              <View style={{ height: 1, backgroundColor: "#E5E7EB", marginVertical: 4 }} />
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: "#111827" }}>Total</Text>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: "#059669" }}>Rs. {ride?.fare}</Text>
              </View>
            </View>
          </View>

          {/* Route */}
          <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: "#E2E8F0" }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: "#374151" }}>Route</Text>
              <Pressable onPress={openInMaps} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#EFF6FF", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8 }}>
                <Ionicons name="navigate-outline" size={12} color="#4285F4" />
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: "#4285F4" }}>Google Maps</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ alignItems: "center", gap: 4 }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: "#10B981" }} />
                <View style={{ flex: 1, width: 2, backgroundColor: "#E2E8F0", minHeight: 22 }} />
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: "#EF4444" }} />
              </View>
              <View style={{ flex: 1, gap: 14 }}>
                <View>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "#9CA3AF" }}>Pickup</Text>
                  <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: "#111827", marginTop: 2 }}>{ride?.pickupAddress}</Text>
                </View>
                <View>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "#9CA3AF" }}>Drop</Text>
                  <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: "#111827", marginTop: 2 }}>{ride?.dropAddress}</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Safety */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#D1FAE5", padding: 12, borderRadius: 12 }}>
            <Ionicons name="shield-checkmark" size={14} color="#059669" />
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#065F46" }}>Insured ride · Verified driver · GPS tracked</Text>
          </View>

          {/* Buttons */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable onPress={() => router.push("/(tabs)")} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 15, borderRadius: 14, backgroundColor: "#EFF6FF" }}>
              <Ionicons name="home-outline" size={17} color="#2563EB" />
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#2563EB" }}>Home</Text>
            </Pressable>
            <Pressable onPress={onReset} style={{ flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 15, borderRadius: 14, backgroundColor: "#059669" }}>
              <Ionicons name="add" size={17} color="#fff" />
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" }}>New Ride</Text>
            </Pressable>
          </View>
          <View style={{ height: 24 }} />
        </ScrollView>
      </View>
    );
  }

  /* ════════════════ ACTIVE (accepted / arrived / in_transit) ════════════════ */
  type StatusCfg = { colors: [string,string]; icon: string; title: string; sub: string };
  const statusCfgs: Record<string, StatusCfg> = {
    accepted:   { colors: ["#1565C0","#1976D2"],  icon: "car",      title: "Driver Aa Raha Hai! 🚗",  sub: "Driver ne ride accept kar li"       },
    arrived:    { colors: ["#B45309","#D97706"],  icon: "location", title: "Driver Pahunch Gaya! 📍", sub: "Driver aapke pickup point pe hai"   },
    in_transit: { colors: ["#065F46","#059669"],  icon: "navigate", title: "Aap Route Mein Hain! 🛣", sub: "Safar jari — manzil qareeb hai"     },
  };
  const hdrCfg  = statusCfgs[status] ?? statusCfgs["accepted"]!;
  const canCancel = status === "accepted";

  return (
    <View style={{ flex: 1, backgroundColor: "#F8FAFC" }}>
      {/* ── Status Header ── */}
      <LinearGradient colors={hdrCfg.colors} style={{ paddingTop: topPad + 14, paddingBottom: 22, paddingHorizontal: 20 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={hdrCfg.icon as any} size={28} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 18, color: "#fff" }}>{hdrCfg.title}</Text>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 3 }}>{hdrCfg.sub}</Text>
          </View>
        </View>
      </LinearGradient>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 14, gap: 12 }}>
        <Animated.View style={{ opacity: fadeIn, transform: [{ translateY: slideUp }], gap: 12 }}>

          {/* ── Progress stepper ── */}
          <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#E2E8F0" }}>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: "#374151", marginBottom: 16 }}>Ride Progress</Text>
            <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
              {STEPS.map((step, i) => {
                const done   = stepIdx >= i;
                const active = stepIdx === i;
                const isLast = i === STEPS.length - 1;
                return (
                  <React.Fragment key={step}>
                    <View style={{ alignItems: "center", flex: 1, gap: 5 }}>
                      <View style={{
                        width: 32, height: 32, borderRadius: 16,
                        backgroundColor: done ? (active ? hdrCfg.colors[0] : "#10B981") : "#E5E7EB",
                        alignItems: "center", justifyContent: "center",
                        borderWidth: active ? 3 : 0, borderColor: "rgba(0,0,0,0.1)",
                      }}>
                        {done
                          ? <Ionicons name="checkmark" size={15} color="#fff" />
                          : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#CBD5E1" }} />}
                      </View>
                      <Text style={{ fontSize: 9, textAlign: "center", color: done ? "#374151" : "#9CA3AF", fontFamily: active ? "Inter_700Bold" : "Inter_400Regular" }}>
                        {LABELS[i]}
                      </Text>
                    </View>
                    {!isLast && (
                      <View style={{ height: 2, flex: 0.4, backgroundColor: stepIdx > i ? "#10B981" : "#E5E7EB", marginTop: 15 }} />
                    )}
                  </React.Fragment>
                );
              })}
            </View>
          </View>

          {/* ── Rider Card ── */}
          {ride?.riderName && (
            <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#E2E8F0" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: hdrCfg.colors[0], alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 24, color: "#fff" }}>
                    {ride.riderName.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: "#111827" }}>{ride.riderName}</Text>
                  {ride.riderPhone && (
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#6B7280", marginTop: 2 }}>{ride.riderPhone}</Text>
                  )}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 5 }}>
                    {[1,2,3,4,5].map(s => <Ionicons key={s} name={s <= 4 ? "star" : "star-outline"} size={11} color="#F59E0B" />)}
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: "#9CA3AF", marginLeft: 4 }}>4.0 · Verified</Text>
                  </View>
                </View>
                <View style={{ backgroundColor: "#F1F5F9", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, alignItems: "center" }}>
                  <Ionicons name={rideType === "bike" ? "bicycle" : "car"} size={20} color="#475569" />
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 10, color: "#475569", marginTop: 3 }}>
                    {rideType === "bike" ? "Bike" : "Car"}
                  </Text>
                </View>
              </View>
              {/* Action buttons */}
              <View style={{ flexDirection: "row", gap: 10 }}>
                {ride.riderPhone && (
                  <Pressable onPress={() => Linking.openURL(`tel:${ride.riderPhone}`)}
                    style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 14, backgroundColor: "#059669" }}>
                    <Ionicons name="call" size={18} color="#fff" />
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" }}>Call Driver</Text>
                  </Pressable>
                )}
                {ride.riderPhone && (
                  <Pressable onPress={() => Linking.openURL(`https://wa.me/92${ride.riderPhone.replace(/^(\+92|0)/, "")}`)}
                    style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: "#25D366", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="logo-whatsapp" size={24} color="#fff" />
                  </Pressable>
                )}
              </View>
            </View>
          )}

          {/* ── Route ── */}
          <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#E2E8F0" }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: "#374151" }}>Route</Text>
              <Pressable onPress={openInMaps} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#EFF6FF", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8 }}>
                <Ionicons name="navigate-outline" size={12} color="#4285F4" />
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: "#4285F4" }}>Open in Maps</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ alignItems: "center", gap: 4 }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: "#10B981" }} />
                <View style={{ flex: 1, width: 2, backgroundColor: "#E2E8F0", minHeight: 22 }} />
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: "#EF4444" }} />
              </View>
              <View style={{ flex: 1, gap: 14 }}>
                <View>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "#9CA3AF" }}>Pickup</Text>
                  <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: "#111827", marginTop: 2 }}>{ride?.pickupAddress}</Text>
                </View>
                <View>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "#9CA3AF" }}>Drop</Text>
                  <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: "#111827", marginTop: 2 }}>{ride?.dropAddress}</Text>
                </View>
              </View>
            </View>
          </View>

          {/* ── Fare & Payment ── */}
          <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#E2E8F0" }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#9CA3AF" }}>Total Fare</Text>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 26, color: "#059669", marginTop: 2 }}>Rs. {ride?.fare}</Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "#9CA3AF" }}>Payment</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#F1F5F9", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 }}>
                  <Ionicons name={ride?.paymentMethod === "wallet" ? "wallet-outline" : "cash-outline"} size={14} color="#374151" />
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: "#374151" }}>
                    {ride?.paymentMethod === "wallet" ? "Wallet" : "Cash"}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* ── Safety ── */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#ECFDF5", padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "#D1FAE5" }}>
            <Ionicons name="shield-checkmark" size={14} color="#059669" />
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#065F46", flex: 1 }}>
              Insured ride · Verified driver · GPS tracked · ID: #{rideId.slice(-6).toUpperCase()}
            </Text>
          </View>

          {/* ── Cancel (only when accepted) ── */}
          {canCancel && (
            <Pressable onPress={() => setShowCancelModal(true)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 14, borderRadius: 14, backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA" }}>
              <Ionicons name="close-circle-outline" size={18} color="#DC2626" />
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#DC2626" }}>
                Cancel Ride{cancellationFee > 0 ? ` (Rs. ${cancellationFee} fee applies)` : ""}
              </Text>
            </Pressable>
          )}

          <View style={{ height: 24 }} />
        </Animated.View>
      </ScrollView>

      {/* ── Cancel Confirmation Modal ── */}
      <Modal visible={showCancelModal} transparent animationType="fade" onRequestClose={() => setShowCancelModal(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 24 }} onPress={() => setShowCancelModal(false)}>
          <Pressable style={{ backgroundColor: "#fff", borderRadius: 24, padding: 24, width: "100%", maxWidth: 400, gap: 18 }} onPress={() => {}}>
            <View style={{ alignItems: "center", gap: 10 }}>
              <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="close-circle" size={36} color="#DC2626" />
              </View>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 19, color: "#111827" }}>Cancel Ride?</Text>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: "#6B7280", textAlign: "center", lineHeight: 21 }}>
                {cancellationFee > 0
                  ? `Driver pehle se assign ho chuka hai. Cancel karne par Rs. ${cancellationFee} cancellation fee apply hogi.`
                  : "Kya aap wakai is ride ko cancel karna chahte hain?"}
              </Text>
              {ride?.paymentMethod === "wallet" && (
                <View style={{ backgroundColor: "#ECFDF5", borderRadius: 12, padding: 12, width: "100%" }}>
                  <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: "#065F46", textAlign: "center" }}>
                    💚 Baaki rakam aapki wallet mein refund ho jayega
                  </Text>
                </View>
              )}
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable onPress={() => setShowCancelModal(false)} style={{ flex: 1, alignItems: "center", padding: 15, borderRadius: 14, backgroundColor: "#F3F4F6" }}>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#374151" }}>Back</Text>
              </Pressable>
              <Pressable onPress={cancelRide} disabled={cancelling} style={{ flex: 1, alignItems: "center", padding: 15, borderRadius: 14, backgroundColor: "#DC2626" }}>
                {cancelling
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" }}>Yes, Cancel</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
