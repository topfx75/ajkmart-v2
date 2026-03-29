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
import { withServiceGuard } from "@/components/ServiceGuard";
import {
  estimateFare, bookRide,
  getRide as getRideApi,
  getRideStops, getRideServices,
  getPaymentMethods,
  cancelRide as cancelRideApi,
  acceptRideBid as acceptRideBidApi,
  customerCounterOffer as customerCounterOfferApi,
  updateLocation,
  getRideHistory,
  getSchoolRoutes,
  subscribeSchoolRoute,
  geocodeAddress,
} from "@workspace/api-client-react";
import type { BookRideRequest, EstimateFareRequest } from "@workspace/api-client-react";

const C   = Colors.light;
const W   = Dimensions.get("window").width;

/* ─── Haversine distance (km) ─── */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ─── Popular spots (quick-fill chips) ─── */
/* Popular spots — fetched dynamically from admin-managed API */
type PopularSpot = { id: string; name: string; nameUrdu?: string; lat: number; lng: number; icon?: string; category?: string };



/* ─── Professional Ride Tracker — Careem/Uber style ─── */
function RideTracker({ rideId, initialType, userId, token, cancellationFee, onReset }: {
  rideId: string;
  initialType: string;
  userId: string;
  token: string | null;
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
    const prev = prevStatus.current;
    const pendingStatuses = ["searching", "bargaining"];
    if (st && !pendingStatuses.includes(st) && pendingStatuses.includes(prev)) {
      slideUp.setValue(50); fadeIn.setValue(0);
      Animated.parallel([
        Animated.spring(slideUp, { toValue: 0, useNativeDriver: true, bounciness: 6 }),
        Animated.timing(fadeIn,  { toValue: 1, duration: 500, useNativeDriver: true }),
      ]).start();
    }
    if (!prevStatus.current && st && !pendingStatuses.includes(st)) {
      slideUp.setValue(0); fadeIn.setValue(1);
    }
    prevStatus.current = st || "";
  }, [ride?.status]);

  /* Bargaining state — InDrive multi-bid model */
  const [updateOfferInput,  setUpdateOfferInput]  = useState("");
  const [updateOfferLoading,setUpdateOfferLoading] = useState(false);
  const [showUpdateOffer,   setShowUpdateOffer]    = useState(false);
  const [acceptBidId,       setAcceptBidId]        = useState<string | null>(null);  /* which bid is loading */

  const acceptBid = async (bidId: string) => {
    setAcceptBidId(bidId);
    try {
      const d = await acceptRideBidApi(rideId, { bidId });
      setRide(d as typeof ride);
    } catch {}
    setAcceptBidId(null);
  };

  const sendUpdateOffer = async () => {
    const amt = parseFloat(updateOfferInput);
    if (isNaN(amt) || amt <= 0) return;
    setUpdateOfferLoading(true);
    try {
      const d = await customerCounterOfferApi(rideId, { offeredFare: amt });
      setRide(d as typeof ride);
      setUpdateOfferInput("");
      setShowUpdateOffer(false);
    } catch {}
    setUpdateOfferLoading(false);
  };

  /* ── Poll ride status every 5s (via api-client-react) ── */
  useEffect(() => {
    const poll = async () => {
      try {
        const d = await getRideApi(rideId);
        setRide(d as typeof ride);
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
  }, [rideId]);

  const { showToast } = useToast();

  const cancelRideHandler = async () => {
    setCancelling(true);
    setShowCancelModal(false);
    try {
      await cancelRideApi(rideId, {});
      setRide((r: any) => r ? { ...r, status: "cancelled" } : r);
    } catch {
      showToast("Could not cancel. Please try again.", "error");
    }
    setCancelling(false);
  };

  const openInMaps = () => {
    if (!ride?.pickupLat || !ride?.pickupLng || !ride?.dropLat || !ride?.dropLng) return;
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${ride.pickupLat},${ride.pickupLng}&destination=${ride.dropLat},${ride.dropLng}&travelmode=driving`);
  };

  const status   = ride?.status ?? "searching";
  const rideType = ride?.type   ?? initialType;
  const STEPS    = ["accepted", "arrived", "in_transit", "completed"];
  const LABELS   = ["Accepted", "Arrived", "On Route", "Done"];
  const stepIdx  = STEPS.indexOf(status);
  const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

  /* ════════════════ BARGAINING — InDrive Live Bids Screen ════════════════ */
  if (status === "bargaining") {
    const offeredFare = ride?.offeredFare ?? 0;
    const bids: any[]  = ride?.bids ?? [];
    const hasBids      = bids.length > 0;

    return (
      <View style={{ flex: 1 }}>
        <LinearGradient colors={["#78350F", "#B45309", "#D97706"]} style={StyleSheet.absoluteFillObject} />

        {/* Header */}
        <View style={{ paddingTop: topPad + 16, paddingHorizontal: 24, paddingBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" }}>Negotiation In Progress 💬</Text>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "rgba(255,255,255,0.7)" }}>
              #{rideId.slice(-8).toUpperCase()} · {elapsedStr}
            </Text>
          </View>
          <View style={{ backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, alignItems: "center" }}>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 18, color: "#FCD34D" }}>Rs. {offeredFare}</Text>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: "rgba(255,255,255,0.7)" }}>your offer</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120, gap: 12 }} showsVerticalScrollIndicator={false}>

          {/* ── No bids yet — waiting animation ── */}
          {!hasBids && (
            <View style={{ alignItems: "center", paddingVertical: 40 }}>
              <View style={{ width: 180, height: 180, alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
                <Animated.View style={{ position: "absolute", width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(255,255,255,0.07)", transform: [{ scale: ring3 }], opacity: ring3Op }} />
                <Animated.View style={{ position: "absolute", width: 136, height: 136, borderRadius: 68,  backgroundColor: "rgba(255,255,255,0.11)", transform: [{ scale: ring2 }], opacity: ring2Op }} />
                <Animated.View style={{ position: "absolute", width: 92,  height: 92,  borderRadius: 46,  backgroundColor: "rgba(255,255,255,0.17)", transform: [{ scale: ring1 }], opacity: ring1Op }} />
                <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(255,255,255,0.24)", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 34 }}>💬</Text>
                </View>
              </View>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 20, color: "#fff", textAlign: "center" }}>Riders Are Reviewing</Text>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,255,255,0.7)", textAlign: "center", marginTop: 6, lineHeight: 20 }}>
                When a rider bids, you can view it here and choose the best offer
              </Text>
            </View>
          )}

          {/* ── Bids list ── */}
          {hasBids && (
            <>
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: "rgba(255,255,255,0.85)", marginBottom: 4 }}>
                {bids.length} Rider{bids.length > 1 ? "s" : ""} Placed a Bid — Choose the best:
              </Text>
              {bids.map((bid: any) => (
                <View key={bid.id} style={{ backgroundColor: "rgba(255,255,255,0.14)", borderRadius: 20, padding: 18, borderWidth: 1, borderColor: "rgba(255,255,255,0.22)" }}>
                  {/* Rider info */}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 }}>
                    <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 22 }}>🏍️</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff" }}>{bid.riderName}</Text>
                      {bid.note ? (
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 2 }}>💬 {bid.note}</Text>
                      ) : null}
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: "#FCD34D" }}>Rs. {Math.round(bid.fare)}</Text>
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: "rgba(255,255,255,0.6)" }}>
                        {bid.fare === offeredFare
                          ? "matches your offer"
                          : bid.fare > offeredFare
                            ? `Rs. ${Math.round(bid.fare - offeredFare)} above your offer`
                            : `Rs. ${Math.round(offeredFare - bid.fare)} savings for you`}
                      </Text>
                    </View>
                  </View>
                  {/* Accept this bid */}
                  <Pressable
                    onPress={() => acceptBid(bid.id)}
                    disabled={acceptBidId !== null}
                    style={{ backgroundColor: "#10B981", borderRadius: 14, paddingVertical: 13, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, opacity: acceptBidId !== null ? 0.7 : 1 }}>
                    {acceptBidId === bid.id
                      ? <ActivityIndicator color="#fff" size="small" />
                      : (
                        <>
                          <Ionicons name="checkmark-circle" size={18} color="#fff" />
                          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" }}>Accept — Rs. {Math.round(bid.fare)}</Text>
                        </>
                      )
                    }
                  </Pressable>
                </View>
              ))}
            </>
          )}

          {/* ── Update Offer Section ── */}
          <View style={{ backgroundColor: "rgba(255,255,255,0.11)", borderRadius: 18, overflow: "hidden" }}>
            <Pressable
              onPress={() => setShowUpdateOffer(v => !v)}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 }}>
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#fff" }}>✏️ Update Your Offer</Text>
              <Ionicons name={showUpdateOffer ? "chevron-up" : "chevron-down"} size={18} color="rgba(255,255,255,0.7)" />
            </Pressable>
            {showUpdateOffer && (
              <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 10 }}>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
                  Submitting a new offer will cancel all pending bids, and riders will place fresh bids
                </Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, paddingHorizontal: 12 }}>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#374151" }}>Rs.</Text>
                    <TextInput
                      value={updateOfferInput}
                      onChangeText={setUpdateOfferInput}
                      keyboardType="numeric"
                      placeholder={String(Math.ceil(offeredFare * 1.1))}
                      placeholderTextColor="#9CA3AF"
                      style={{ flex: 1, fontFamily: "Inter_700Bold", fontSize: 18, color: "#1F2937", paddingVertical: 10, paddingHorizontal: 6 }}
                    />
                  </View>
                  <Pressable
                    onPress={sendUpdateOffer}
                    disabled={updateOfferLoading || !updateOfferInput}
                    style={{ backgroundColor: "#F59E0B", borderRadius: 12, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", opacity: (!updateOfferInput || updateOfferLoading) ? 0.6 : 1 }}>
                    {updateOfferLoading
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: "#fff" }}>Update</Text>
                    }
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        </ScrollView>

        {/* Cancel button */}
        <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: 24, paddingBottom: Math.max(insets.bottom, 24) + 8, backgroundColor: "transparent" }}>
          <Pressable
            onPress={() => setShowCancelModal(true)}
            disabled={cancelling}
            style={{ alignItems: "center", padding: 15, borderRadius: 16, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.35)", backgroundColor: "rgba(0,0,0,0.25)" }}>
            {cancelling
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 15, color: "rgba(255,255,255,0.9)" }}>Cancel Offer</Text>
            }
          </Pressable>
        </View>

        {/* ── Cancel Confirmation Modal (Bargaining) ── */}
        <Modal visible={showCancelModal} transparent animationType="fade" onRequestClose={() => setShowCancelModal(false)}>
          <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 24 }} onPress={() => setShowCancelModal(false)}>
            <Pressable style={{ backgroundColor: "#fff", borderRadius: 24, padding: 24, width: "100%", maxWidth: 400, gap: 18 }} onPress={() => {}}>
              <View style={{ alignItems: "center", gap: 10 }}>
                <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="close-circle" size={36} color="#DC2626" />
                </View>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 19, color: "#111827" }}>Cancel Offer?</Text>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: "#6B7280", textAlign: "center", lineHeight: 21 }}>
                  Are you sure you want to cancel your offer? All pending rider bids will also be cancelled.
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable onPress={() => setShowCancelModal(false)} style={{ flex: 1, alignItems: "center", padding: 15, borderRadius: 14, backgroundColor: "#F3F4F6" }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#374151" }}>Back</Text>
                </Pressable>
                <Pressable onPress={cancelRideHandler} disabled={cancelling} style={{ flex: 1, alignItems: "center", padding: 15, borderRadius: 14, backgroundColor: "#DC2626" }}>
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

  /* ════════════════ SEARCHING ════════════════ */
  if (status === "searching") {
    const SEARCH_TIMEOUT = 180;
    const timedOut = elapsed >= SEARCH_TIMEOUT;

    if (timedOut) {
      return (
        <View style={{ flex: 1 }}>
          <LinearGradient colors={["#7C2D12", "#B91C1C", "#DC2626"]} style={StyleSheet.absoluteFillObject} />
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
            <View style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
              <Ionicons name="sad-outline" size={52} color="#fff" />
            </View>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 24, color: "#fff", textAlign: "center", marginBottom: 10 }}>
              No Driver Found
            </Text>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: "rgba(255,255,255,0.8)", textAlign: "center", lineHeight: 21, marginBottom: 32 }}>
              No driver was available after 3 minutes of searching. Please try again or book later.
            </Text>
            <Pressable
              onPress={() => { cancelRideHandler(); }}
              style={{ backgroundColor: "#fff", borderRadius: 16, paddingVertical: 16, paddingHorizontal: 32, alignItems: "center", width: "100%", marginBottom: 12 }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: "#DC2626" }}>Cancel & Rebook</Text>
            </Pressable>
            <Pressable
              onPress={onReset}
              style={{ borderWidth: 1.5, borderColor: "rgba(255,255,255,0.4)", borderRadius: 16, paddingVertical: 14, paddingHorizontal: 32, alignItems: "center", width: "100%" }}>
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 15, color: "#fff" }}>Go Back Home</Text>
            </Pressable>
          </View>
        </View>
      );
    }

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
              <Text style={{ fontSize: 42 }}>
                {{ bike: "🏍️", car: "🚗", rickshaw: "🛺", daba: "🚐", school_shift: "🚌" }[rideType] ?? "🚗"}
              </Text>
            </View>
          </View>

          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 24, color: "#fff", marginTop: 36, textAlign: "center" }}>
            Finding Your Driver
          </Text>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: "rgba(255,255,255,0.75)", marginTop: 8, textAlign: "center", lineHeight: 21 }}>
            Assigning the nearest driver in AJK
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
          <Pressable onPress={() => setShowCancelModal(true)} disabled={cancelling} style={{ alignItems: "center", padding: 16, borderRadius: 16, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.3)", backgroundColor: "rgba(255,255,255,0.1)" }}>
            {cancelling
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 15, color: "#fff" }}>Cancel Ride</Text>
            }
          </Pressable>
        </View>

        {/* ── Cancel Confirmation Modal (Searching) ── */}
        <Modal visible={showCancelModal} transparent animationType="fade" onRequestClose={() => setShowCancelModal(false)}>
          <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 24 }} onPress={() => setShowCancelModal(false)}>
            <Pressable style={{ backgroundColor: "#fff", borderRadius: 24, padding: 24, width: "100%", maxWidth: 400, gap: 18 }} onPress={() => {}}>
              <View style={{ alignItems: "center", gap: 10 }}>
                <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="close-circle" size={36} color="#DC2626" />
                </View>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 19, color: "#111827" }}>Cancel Ride?</Text>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: "#6B7280", textAlign: "center", lineHeight: 21 }}>
                  Are you sure you want to cancel this ride? No driver has been assigned yet, so there will be no cancellation fee.
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable onPress={() => setShowCancelModal(false)} style={{ flex: 1, alignItems: "center", padding: 15, borderRadius: 14, backgroundColor: "#F3F4F6" }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#374151" }}>Back</Text>
                </Pressable>
                <Pressable onPress={cancelRideHandler} disabled={cancelling} style={{ flex: 1, alignItems: "center", padding: 15, borderRadius: 14, backgroundColor: "#DC2626" }}>
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
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,255,255,0.85)", textAlign: "center" }}>Your ride has been cancelled</Text>
        </LinearGradient>
        <ScrollView contentContainerStyle={{ margin: 16, gap: 12 }}>
          {wasWallet && (
            <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 16, borderLeftWidth: 4, borderLeftColor: "#10B981", gap: 6, borderWidth: 1, borderColor: "#D1FAE5" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="wallet-outline" size={18} color="#10B981" />
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#065F46" }}>Refund Initiated</Text>
              </View>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: "#374151", lineHeight: 19 }}>
                Rs. {ride?.fare} will be refunded to your wallet.{cancellationFee > 0 ? ` If a rider was assigned, a Rs. ${cancellationFee} cancellation fee will apply.` : ""}
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
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: "#065F46" }}>Rate Your Driver</Text>
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
    accepted:   { colors: ["#1565C0","#1976D2"],  icon: "car",      title: "Driver Is Coming! 🚗",  sub: "Driver has accepted your ride"       },
    arrived:    { colors: ["#B45309","#D97706"],  icon: "location", title: "Driver Has Arrived! 📍", sub: "Driver is at your pickup point"   },
    in_transit: { colors: ["#065F46","#059669"],  icon: "navigate", title: "You're On Your Way! 🛣", sub: "Trip in progress — destination is near"     },
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
                  <Text style={{ fontSize: 20 }}>
                    {{ bike: "🏍️", car: "🚗", rickshaw: "🛺", daba: "🚐", school_shift: "🚌" }[rideType] ?? "🚗"}
                  </Text>
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 10, color: "#475569", marginTop: 3 }}>
                    {{ bike: "Bike", car: "Car", rickshaw: "Rickshaw", daba: "Daba", school_shift: "School" }[rideType] ?? rideType}
                  </Text>
                </View>
              </View>
              {/* ── Rider live distance badge (when accepted/arrived) ── */}
              {ride.riderLat != null && ride.riderLng != null && ride.pickupLat != null && (status === "accepted" || status === "arrived") && (() => {
                const km = haversineKm(ride.riderLat, ride.riderLng, ride.pickupLat, ride.pickupLng);
                const nearby = km < 0.2;
                const stale  = ride.riderLocAge != null && ride.riderLocAge > 60;
                return (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: nearby ? "#DCFCE7" : "#EFF6FF", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12 }}>
                    <Text style={{ fontSize: 15 }}>{nearby ? "📍" : "🚗"}</Text>
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: nearby ? "#065F46" : "#1E40AF", flex: 1 }}>
                      {nearby ? "Driver is nearby!" : `Driver is ${km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`} away`}
                    </Text>
                    {stale && <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: "#9CA3AF" }}>• stale</Text>}
                  </View>
                );
              })()}

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
                  ? `A driver has already been assigned. Cancelling will incur a Rs. ${cancellationFee} cancellation fee.`
                  : "Are you sure you want to cancel this ride?"}
              </Text>
              {ride?.paymentMethod === "wallet" && (
                <View style={{ backgroundColor: "#ECFDF5", borderRadius: 12, padding: 12, width: "100%" }}>
                  <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: "#065F46", textAlign: "center" }}>
                    💚 The remaining amount will be refunded to your wallet
                  </Text>
                </View>
              )}
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable onPress={() => setShowCancelModal(false)} style={{ flex: 1, alignItems: "center", padding: 15, borderRadius: 14, backgroundColor: "#F3F4F6" }}>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#374151" }}>Back</Text>
              </Pressable>
              <Pressable onPress={cancelRideHandler} disabled={cancelling} style={{ flex: 1, alignItems: "center", padding: 15, borderRadius: 14, backgroundColor: "#DC2626" }}>
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
function RideScreenInner() {
  const insets = useSafeAreaInsets();
  const { user, updateUser, token } = useAuth();
  const { showToast } = useToast();
  const { config } = usePlatformConfig();
  const rideCfg = config.rides;
  const inMaintenance = config.appStatus === "maintenance";
  const ridesEnabled = config.features.rides;
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  type LocObj = { lat: number; lng: number; address: string };

  const [pickup,     setPickup]    = useState("");
  const [drop,       setDrop]      = useState("");
  const [pickupObj,  setPickupObj] = useState<LocObj | null>(null);
  const [dropObj,    setDropObj]   = useState<LocObj | null>(null);
  const [rideType,   setRideType]  = useState<string>("bike");
  const [services,   setServices]  = useState<Array<{ key: string; name: string; nameUrdu?: string; icon: string; description?: string; color: string; baseFare: number; perKm: number; minFare: number; maxPassengers: number; allowBargaining: boolean }>>([
    { key: "bike",     name: "Bike",     icon: "🏍️", color: "#059669", baseFare: 15, perKm: 8,  minFare: 50, maxPassengers: 1, allowBargaining: true },
    { key: "car",      name: "Car",      icon: "🚗", color: "#3B82F6", baseFare: 25, perKm: 12, minFare: 80, maxPassengers: 4, allowBargaining: true },
  ]);
  const [payMethod,  setPayMethod] = useState<"cash" | "wallet">("cash");
  const [payMethods, setPayMethods] = useState<Array<{ id: string; label: string }>>([
    { id: "cash", label: "Cash" },
    { id: "wallet", label: "Wallet" },
  ]);
  const [estimate,   setEstimate]  = useState<{
    fare: number; dist: number; dur: string;
    baseFare: number; gstAmount: number;
    bargainEnabled: boolean; minOffer: number;
  } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [booking,    setBooking]   = useState(false);
  const [booked,     setBooked]    = useState<any>(null);
  const [showHistory,setShowHistory] = useState(false);
  const [history,    setHistory]   = useState<any[]>([]);
  const [histLoading,setHistLoading] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [locDenied,  setLocDenied]  = useState(false);
  const [showBargain,setShowBargain] = useState(false);
  const [offeredFare,setOfferedFare] = useState("");
  const [bargainNote,setBargainNote] = useState("");

  const [pickupFocus, setPickupFocus] = useState(false);
  const [dropFocus,   setDropFocus]   = useState(false);

  /* Popular spots — fetched from admin-managed API */
  const [popularSpots,   setPopularSpots]   = useState<PopularSpot[]>([]);
  const [schoolRoutes,   setSchoolRoutes]   = useState<any[]>([]);
  const [showSchoolModal,setShowSchoolModal] = useState(false);
  const [selectedRoute,  setSelectedRoute]  = useState<any>(null);
  const [schoolStudent,  setSchoolStudent]  = useState("");
  const [schoolClass,    setSchoolClass]    = useState("");
  const [subscribing,    setSubscribing]    = useState(false);

  /* Live autocomplete from Maps API */
  const { predictions: pickupPreds, loading: pickupLoading } = useMapsAutocomplete(pickupFocus ? pickup : "");
  const { predictions: dropPreds,   loading: dropLoading }   = useMapsAutocomplete(dropFocus   ? drop   : "");

  /* ── Fetch popular spots (via api-client-react) ── */
  useEffect(() => {
    getRideStops()
      .then(data => { if (data?.locations?.length) setPopularSpots(data.locations); })
      .catch(() => {});
  }, []);

  /* ── Fetch school routes when school_shift is selected (via api-client-react) ── */
  useEffect(() => {
    if (rideType !== "school_shift") return;
    getSchoolRoutes()
      .then(data => { if (data?.routes?.length) setSchoolRoutes(data.routes); })
      .catch(() => {});
  }, [rideType]);

  /* ── Fetch enabled payment methods (via api-client-react) ── */
  useEffect(() => {
    getPaymentMethods()
      .then(data => {
        if (!data?.methods) return;
        const rideCompatible = data.methods.filter(m => m.id === "cash" || m.id === "wallet");
        if (rideCompatible.length > 0) {
          setPayMethods(rideCompatible);
          setPayMethod(rideCompatible[0]!.id as "cash" | "wallet");
        }
      })
      .catch(() => {});
  }, []);

  /* ── Fetch enabled ride service types (via api-client-react) ── */
  useEffect(() => {
    getRideServices()
      .then(data => {
        if (!data?.services?.length) return;
        setServices(data.services);
        setRideType(prev => data.services.find(s => s.key === prev) ? prev : data.services[0]!.key);
      })
      .catch(() => {});
  }, []);

  /* ── Get device location for pickup auto-fill ── */
  const handleMyLocation = async () => {
    setLocLoading(true);
    setLocDenied(false);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") { setLocDenied(true); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude: lat, longitude: lng } = pos.coords;
      const data = await geocodeAddress({ address: `${lat},${lng}` });
      const address = data?.formattedAddress ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      setPickup(address);
      setPickupObj({ lat, lng, address });
      setLocDenied(false);
    } catch {
      showToast("Could not get location. Please type it manually.", "error");
    } finally {
      setLocLoading(false);
    }
  };

  /* ── Fetch server-side fare estimate (includes GST, surge, bargaining info) ── */
  useEffect(() => {
    if (!pickupObj || !dropObj) { setEstimate(null); return; }
    let cancelled = false;
    setEstimating(true);
    estimateFare({
      pickupLat: pickupObj.lat, pickupLng: pickupObj.lng,
      dropLat:   dropObj.lat,   dropLng:   dropObj.lng,
      type: rideType,
    } as EstimateFareRequest)
      .then((data: Record<string, unknown> & { fare: number; distance: number; duration: string }) => {
        if (cancelled || !data) return;
        setEstimate({
          fare:           data.fare,
          dist:           data.distance,
          dur:            data.duration,
          baseFare:       (data.baseFare as number | undefined) ?? data.fare,
          gstAmount:      (data.gstAmount as number | undefined) ?? 0,
          bargainEnabled: (data.bargainEnabled as boolean | undefined) ?? false,
          minOffer:       (data.minOffer as number | undefined) ?? data.fare,
        });
      })
      .catch(() => {
        /* If server unreachable, silently clear estimate */
        if (!cancelled) setEstimate(null);
      })
      .finally(() => { if (!cancelled) setEstimating(false); });
    return () => { cancelled = true; };
  }, [pickupObj?.lat, pickupObj?.lng, dropObj?.lat, dropObj?.lng, rideType]);

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
  const handleChip = (spot: PopularSpot) => {
    if (!pickupObj) {
      setPickup(spot.name);
      setPickupObj({ lat: spot.lat, lng: spot.lng, address: spot.name });
    } else if (!dropObj) {
      setDrop(spot.name);
      setDropObj({ lat: spot.lat, lng: spot.lng, address: spot.name });
    }
  };

  /* ── School Shift subscribe ── */
  const handleSchoolSubscribe = async () => {
    if (!user)          { showToast("Please log in first", "error"); return; }
    if (!selectedRoute) { showToast("Please select a route", "error"); return; }
    if (!schoolStudent.trim()) { showToast("Please enter the student's name", "error"); return; }
    if (!schoolClass.trim())   { showToast("Please enter the student's class", "error"); return; }
    setSubscribing(true);
    try {
      const json = await subscribeSchoolRoute({
        routeId: selectedRoute.id,
        studentName: schoolStudent.trim(),
        studentClass: schoolClass.trim(),
        paymentMethod: payMethod as "cash" | "wallet",
      });
      setShowSchoolModal(false);
      setSelectedRoute(null); setSchoolStudent(""); setSchoolClass("");
      showToast(`🎉 ${schoolStudent} has been subscribed to ${selectedRoute.schoolName}!`, "success");
    } catch {
      showToast("Network error. Please try again.", "error");
    } finally {
      setSubscribing(false);
    }
  };

  const handleBook = async () => {
    if (!pickup || !drop)    { showToast("Please select pickup and drop locations", "error"); return; }
    if (!pickupObj)          { showToast("Please select pickup location from the list (exact location required)", "error"); return; }
    if (!dropObj)            { showToast("Please select drop location from the list (exact location required)", "error"); return; }
    if (!user)               { showToast("Please log in to book a ride", "error"); return; }
    if (!estimate)           { showToast("Fare estimate is being calculated. Please wait.", "error"); return; }

    /* Validate bargaining offer */
    let parsedOffer: number | undefined;
    if (showBargain && offeredFare) {
      parsedOffer = parseFloat(offeredFare);
      if (isNaN(parsedOffer) || parsedOffer <= 0) {
        showToast("Please enter a valid amount for your offer", "error"); return;
      }
      if (parsedOffer < estimate.minOffer) {
        showToast(`Minimum offer is Rs. ${estimate.minOffer} (${Math.round((estimate.minOffer / estimate.fare) * 100)}% of platform fare)`, "error"); return;
      }
    }

    const effectiveFare = parsedOffer ?? estimate.fare;
    if (payMethod === "wallet" && (user.walletBalance ?? 0) < effectiveFare) {
      showToast(`Wallet balance Rs. ${user.walletBalance} — less than Rs. ${effectiveFare} required. Please top up.`, "error");
      return;
    }

    setBooking(true);
    try {
      const rideData = await bookRide({
        userId: user.id,
        type: rideType,
        pickupAddress: pickup, dropAddress: drop,
        pickupLat: pickupObj.lat, pickupLng: pickupObj.lng,
        dropLat:   dropObj.lat,   dropLng:   dropObj.lng,
        paymentMethod: payMethod,
        ...(parsedOffer !== undefined && { offeredFare: parsedOffer }),
        ...(bargainNote && { bargainNote }),
      } as BookRideRequest);
      type BookedRide = typeof rideData & { isBargaining?: boolean; effectiveFare?: number };
      const bookedRide = rideData as BookedRide;
      if (payMethod === "wallet" && !bookedRide.isBargaining) {
        updateUser({ walletBalance: (user.walletBalance ?? 0) - (bookedRide.effectiveFare ?? bookedRide.fare) });
      }
      setBooked(bookedRide);

      /* ── Fire-and-forget: save customer GPS at booking time ── */
      (async () => {
        try {
          const perm = await Location.getForegroundPermissionsAsync();
          if (perm.status !== "granted") return;
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          await updateLocation({
            userId: user?.id ?? "",
            latitude:  pos.coords.latitude,
            longitude: pos.coords.longitude,
            role:      "customer",
          });
        } catch { /* silent — never block the user flow */ }
      })();
    } catch { showToast("Network error. Please try again.", "error"); }
    finally { setBooking(false); }
  };

  const fetchHistory = async () => {
    if (!user) return;
    setHistLoading(true);
    try {
      const data = await getRideHistory();
      setHistory(data?.rides || []);
    } catch { setHistory([]); }
    finally { setHistLoading(false); }
  };

  /* ── Maintenance blocks ALL states including active ride ── */
  if (inMaintenance) {
    return (
      <View style={{ flex: 1, backgroundColor: C.background, justifyContent: "center", alignItems: "center", padding: 32 }}>
        <View style={{ backgroundColor: "#fff", borderRadius: 20, padding: 32, alignItems: "center", width: "100%", borderWidth: 1, borderColor: "#FEF3C7" }}>
          <Text style={{ fontSize: 52, marginBottom: 12 }}>🔧</Text>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: "#D97706", marginBottom: 8, textAlign: "center" }}>Under Maintenance</Text>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted, textAlign: "center", lineHeight: 20, marginBottom: 20 }}>
            {config.content.maintenanceMsg}
          </Text>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, textAlign: "center" }}>
            Please check back later. We apologize for the inconvenience.
          </Text>
        </View>
      </View>
    );
  }

  if (booked) {
    return (
      <RideTracker
        rideId={booked.id}
        initialType={booked.type ?? rideType}
        userId={user?.id ?? ""}
        token={token}
        cancellationFee={rideCfg.cancellationFee ?? 30}
        onReset={() => { setBooked(null); setPickup(""); setDrop(""); setPickupObj(null); setDropObj(null); setEstimate(null); }}
      />
    );
  }

  if (!ridesEnabled) {
    return (
      <View style={{ flex: 1, backgroundColor: C.background, justifyContent: "center", alignItems: "center", padding: 32 }}>
        <Pressable onPress={() => router.back()} style={{ position: "absolute", top: topPad + 12, left: 16 }}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </Pressable>
        <View style={{ backgroundColor: "#fff", borderRadius: 20, padding: 32, alignItems: "center", width: "100%", borderWidth: 1, borderColor: "#FEE2E2" }}>
          <Text style={{ fontSize: 52, marginBottom: 12 }}>🚫</Text>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: "#EF4444", marginBottom: 8, textAlign: "center" }}>Service Unavailable</Text>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted, textAlign: "center", lineHeight: 20, marginBottom: 20 }}>
            Ride service is currently unavailable.{"\n"}Please try again later.
          </Text>
          <Pressable style={{ width: "100%", alignItems: "center", backgroundColor: "#FEF2F2", borderRadius: 14, paddingVertical: 14 }} onPress={() => router.back()}>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: "#EF4444" }}>Back to Home</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  /* selected service lookup */
  const selectedSvc = services.find(s => s.key === rideType) ?? services[0];

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
            <Text style={rs.hdrSub}>Anywhere in AJK, anytime</Text>
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
              : <Ionicons name="locate-outline" size={14} color={locDenied ? "#DC2626" : "#059669"} />
            }
            <Text style={[rs.myLocTxt, locDenied && { color: "#DC2626" }]}>
              {locLoading ? "Locating..." : locDenied ? "Location access required — tap to retry" : "Use my location"}
            </Text>
          </Pressable>
          {locDenied && (
            <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 4, paddingBottom: 4, gap: 6 }}>
              <Ionicons name="warning-outline" size={12} color="#DC2626" />
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "#DC2626", flex: 1 }}>
                Location permission denied. Enable it in device settings or type your pickup manually.
              </Text>
            </View>
          )}

          {/* Pickup */}
          <View style={rs.locRow}>
            <View style={rs.dotGreen} />
            <TextInput
              value={pickup}
              onChangeText={v => { setPickup(v); setPickupObj(null); }}
              onFocus={() => setPickupFocus(true)}
              onBlur={() => setTimeout(() => setPickupFocus(false), 250)}
              placeholder="Type pickup location..."
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
              placeholder="Type drop location..."
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
        {popularSpots.length > 0 && (
          <>
            <View style={rs.secRow}><Text style={rs.secTitle}>Popular Locations</Text></View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={rs.chips}>
              {popularSpots.map(spot => (
                <Pressable key={spot.id} onPress={() => handleChip(spot)} style={rs.chip}>
                  <Text style={{ fontSize: 12 }}>{spot.icon || "📍"}</Text>
                  <Text style={rs.chipTxt}>{spot.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {/* School Shift Subscribe button — shown when school_shift is selected */}
        {rideType === "school_shift" && (
          <Pressable
            onPress={() => setShowSchoolModal(true)}
            style={{ marginHorizontal: 16, marginBottom: 10, backgroundColor: "#EFF6FF", borderWidth: 1.5, borderColor: "#BFDBFE", borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}
          >
            <Text style={{ fontSize: 24 }}>🚌</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: "#1D4ED8" }}>School Shift Subscribe</Text>
              <Text style={{ fontSize: 12, color: "#3B82F6", marginTop: 2 }}>Monthly school transport — student registration</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#3B82F6" />
          </Pressable>
        )}

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

        {/* Vehicle Cards — dynamic from admin */}
        <View style={rs.secRow}><Text style={rs.secTitle}>Service Type</Text></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 10, flexDirection: "row" }}>
          {services.map((svc) => {
            const active = rideType === svc.key;
            const feats: string[] = [];
            if (svc.perKm > 0) feats.push(`Rs. ${svc.perKm}/km`);
            if (svc.maxPassengers > 1) feats.push(`${svc.maxPassengers} passengers`);
            if (svc.allowBargaining) feats.push("Bargaining OK");
            if (svc.description) feats.push(svc.description);
            return (
              <Pressable key={svc.key} onPress={() => setRideType(svc.key)}
                style={[rs.vCard, active && rs.vCardActive, { width: 148 }]}>
                {active && <LinearGradient colors={[svc.color ?? "#059669", (svc.color ?? "#059669") + "CC"]} style={rs.vGrad} />}
                <View style={[rs.vIconBox, { backgroundColor: active ? "rgba(255,255,255,0.2)" : `${svc.color ?? "#059669"}22` }]}>
                  <Text style={{ fontSize: 30 }}>{svc.icon}</Text>
                </View>
                <Text style={[rs.vTitle, active && { color: "#fff" }]}>{svc.name}</Text>
                {svc.nameUrdu ? <Text style={[{ fontSize: 11, color: "#6B7280", fontFamily: "Inter_400Regular" }, active && { color: "rgba(255,255,255,0.85)" }]}>{svc.nameUrdu}</Text> : null}
                <Text style={[rs.vFrom, active && { color: "rgba(255,255,255,0.85)" }]}>From Rs. {svc.minFare}</Text>
                <View style={{ gap: 4, marginTop: 8 }}>
                  {feats.slice(0, 3).map(f => (
                    <View key={f} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                      <Ionicons name="checkmark-circle" size={11} color={active ? "rgba(255,255,255,0.8)" : (svc.color ?? "#059669")} />
                      <Text style={[rs.vFeat, active && { color: "rgba(255,255,255,0.85)" }]} numberOfLines={1}>{f}</Text>
                    </View>
                  ))}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Fare Estimate */}
        {estimating && (
          <View style={[rs.fareCard, { alignItems: "center", padding: 16 }]}>
            <ActivityIndicator color="#059669" />
            <Text style={{ marginTop: 6, fontSize: 12, color: C.textMuted }}>Calculating route...</Text>
          </View>
        )}
        {!estimating && estimate && (
          <View style={rs.fareCard}>
            <LinearGradient colors={["#F0FDF4","#DCFCE7"]} style={rs.fareInner}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <Text style={rs.fareTitle}>📍 Fare Estimate</Text>
                <Pressable onPress={() => {
                  if (pickupObj && dropObj) {
                    const url = `https://www.google.com/maps/dir/?api=1&origin=${pickupObj.lat},${pickupObj.lng}&destination=${dropObj.lat},${dropObj.lng}&travelmode=${rideType === "bike" || rideType === "rickshaw" ? "bicycling" : "driving"}`;
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
              {/* GST breakdown */}
              {estimate.gstAmount > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: "rgba(5,150,105,0.15)" }}>
                  <Text style={{ fontSize: 11, color: "#065F46", opacity: 0.7 }}>Base fare: Rs. {estimate.baseFare}</Text>
                  <Text style={{ fontSize: 11, color: "#065F46", opacity: 0.7 }}>GST: Rs. {estimate.gstAmount}</Text>
                </View>
              )}
            </LinearGradient>
          </View>
        )}

        {/* ── Bargaining Panel ── */}
        {!estimating && estimate?.bargainEnabled && (
          <View style={{ marginTop: 8 }}>
            <Pressable
              onPress={() => { setShowBargain(v => !v); setOfferedFare(""); setBargainNote(""); }}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: showBargain ? "#FFF7ED" : "#F8FAFC", borderWidth: 1.5, borderColor: showBargain ? "#FB923C" : "#E2E8F0", borderRadius: 14, padding: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: showBargain ? "#FFEDD5" : "#F1F5F9", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 18 }}>💬</Text>
                </View>
                <View>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: showBargain ? "#C2410C" : "#374151" }}>
                    {showBargain ? "Bargaining Mode ON" : "Make an Offer"}
                  </Text>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: showBargain ? "#EA580C" : "#6B7280" }}>
                    {showBargain ? `Min: Rs. ${estimate.minOffer}` : `Suggest your price (min Rs. ${estimate.minOffer})`}
                  </Text>
                </View>
              </View>
              <Ionicons name={showBargain ? "chevron-up" : "chevron-down"} size={18} color={showBargain ? "#EA580C" : "#9CA3AF"} />
            </Pressable>

            {showBargain && (
              <View style={{ backgroundColor: "#FFF7ED", borderWidth: 1, borderColor: "#FED7AA", borderTopWidth: 0, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, padding: 14, gap: 10 }}>
                <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: "#92400E" }}>
                  Platform fare: Rs. {estimate.fare} · Minimum offer: Rs. {estimate.minOffer}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#FB923C", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 4 }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: "#374151", marginRight: 4 }}>Rs.</Text>
                  <TextInput
                    value={offeredFare}
                    onChangeText={setOfferedFare}
                    keyboardType="numeric"
                    placeholder={String(estimate.minOffer)}
                    placeholderTextColor="#D1D5DB"
                    style={{ flex: 1, fontFamily: "Inter_700Bold", fontSize: 20, color: "#1F2937", paddingVertical: 10 }}
                  />
                  {offeredFare !== "" && (
                    <Pressable onPress={() => setOfferedFare("")}>
                      <Ionicons name="close-circle" size={18} color="#D1D5DB" />
                    </Pressable>
                  )}
                </View>
                <TextInput
                  value={bargainNote}
                  onChangeText={setBargainNote}
                  placeholder="Note (optional) — e.g. 'Main pass hoon'"
                  placeholderTextColor="#D1D5DB"
                  style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: "#FED7AA", borderRadius: 10, padding: 10, fontFamily: "Inter_400Regular", fontSize: 13, color: "#374151" }}
                />
                <Text style={{ fontSize: 11, color: "#9A3412", lineHeight: 16 }}>
                  💡 The rider can accept, counter, or reject your offer. You'll be notified if a counter offer is made.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Payment */}
        <View style={rs.secRow}><Text style={rs.secTitle}>Payment Method</Text></View>
        <View style={rs.payRow}>
          {payMethods.map(pm => {
            const pmId = pm.id as "cash" | "wallet";
            const active = payMethod === pmId;
            const isWallet = pmId === "wallet";
            const isCash   = pmId === "cash";
            const insufficient = isWallet && estimate && (user?.walletBalance ?? 0) < estimate.fare;
            return (
              <Pressable key={pmId} onPress={() => setPayMethod(pmId)} style={[rs.payCard, active && rs.payCardActive]}>
                <View style={[rs.payIcon, { backgroundColor: active ? (isWallet ? "#DBEAFE" : "#D1FAE5") : "#F1F5F9" }]}>
                  <Ionicons name={isCash ? "cash-outline" : "wallet-outline"} size={22} color={active ? (isWallet ? C.primary : C.success) : C.textSecondary} />
                </View>
                <Text style={[rs.payLbl, active && { color: C.text, fontFamily: "Inter_700Bold" }]}>
                  {isCash ? "Cash" : "Wallet"}
                </Text>
                <Text style={[rs.paySub, insufficient && { color: C.danger }]}>
                  {isCash ? "Pay on arrival" : `Rs. ${(user?.walletBalance ?? 0).toLocaleString()}`}
                </Text>
                {active && <View style={[rs.payCheck, { backgroundColor: isWallet ? C.primary : C.success }]}><Ionicons name="checkmark" size={11} color="#fff" /></View>}
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
        <Pressable onPress={handleBook} disabled={booking || !estimate} style={[rs.bookBtn, (booking || !estimate) && { opacity: 0.7 }, showBargain && offeredFare ? { backgroundColor: "#EA580C" } : {}]}>
          {booking ? <ActivityIndicator color="#fff" /> : (
            <>
              {showBargain && offeredFare
                ? <Ionicons name="chatbubble-ellipses" size={20} color="#fff" />
                : <Text style={{ fontSize: 20 }}>{selectedSvc?.icon ?? "🚗"}</Text>
              }
              <Text style={rs.bookBtnTxt}>
                {showBargain && offeredFare
                  ? `Send Offer • Rs. ${offeredFare}`
                  : `Book ${selectedSvc?.name ?? rideType} Now${estimate ? ` • Rs. ${estimate.fare}` : ""}`}
              </Text>
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
              <Text style={rs.histEmptyTxt}>No rides booked yet</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8 }}>
              {history.map((ride, i) => (
                <View key={ride.id || i} style={rs.histItem}>
                  <View style={[rs.histIcon, { backgroundColor: "#F0FDF4" }]}>
                    <Text style={{ fontSize: 20 }}>
                      {services.find(s => s.key === ride.type)?.icon ?? (ride.type === "bike" ? "🏍️" : ride.type === "car" ? "🚗" : ride.type === "rickshaw" ? "🛺" : ride.type === "daba" ? "🚐" : "🚗")}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={rs.histRoute}>{ride.pickupAddress} → {ride.dropAddress}</Text>
                    <Text style={rs.histMeta}>{ride.distance} km • {new Date(ride.createdAt).toLocaleDateString("en-PK", { day: "numeric", month: "short" })}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={rs.histFare}>Rs. {ride.fare}</Text>
                    <View style={[rs.histStatus, { backgroundColor: ride.status === "completed" ? "#D1FAE5" : ride.status === "cancelled" ? "#FEE2E2" : "#FEF3C7" }]}>
                      <Text style={[rs.histStatusTxt, { color: ride.status === "completed" ? "#059669" : ride.status === "cancelled" ? "#DC2626" : "#D97706" }]}>
                        {{ searching: "Finding Rider", bargaining: "Negotiating", accepted: "Accepted", arrived: "Arrived", in_transit: "In Transit", completed: "Completed", cancelled: "Cancelled", ongoing: "In Transit" }[ride.status as string] ?? ride.status}
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

      {/* ── School Shift Subscription Modal ── */}
      <Modal visible={showSchoolModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowSchoolModal(false)}>
        <View style={{ flex: 1, backgroundColor: "#fff" }}>
          <View style={{ flexDirection: "row", alignItems: "center", padding: 20, borderBottomWidth: 1, borderColor: "#F1F5F9" }}>
            <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", flex: 1, color: "#1E293B" }}>🚌 School Shift Subscribe</Text>
            <Pressable onPress={() => setShowSchoolModal(false)} style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="close" size={18} color="#374151" />
            </Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 16 }}>
            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#374151", marginBottom: 4 }}>Select a Route</Text>
            {schoolRoutes.length === 0 ? (
              <View style={{ backgroundColor: "#F8FAFC", borderRadius: 14, padding: 24, alignItems: "center" }}>
                <Text style={{ fontSize: 24, marginBottom: 8 }}>🚌</Text>
                <Text style={{ fontFamily: "Inter_600SemiBold", color: "#64748B" }}>No routes available</Text>
                <Text style={{ fontSize: 12, color: "#94A3B8", marginTop: 4, textAlign: "center" }}>Contact admin to add school shift routes</Text>
              </View>
            ) : (
              schoolRoutes.map((r: any) => (
                <Pressable key={r.id} onPress={() => setSelectedRoute(r)}
                  style={{ borderWidth: 2, borderColor: selectedRoute?.id === r.id ? "#3B82F6" : "#E2E8F0", borderRadius: 14, padding: 14, backgroundColor: selectedRoute?.id === r.id ? "#EFF6FF" : "#FAFAFA" }}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                    <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#DBEAFE", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 22 }}>🚌</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#1E293B" }}>{r.routeName}</Text>
                      <Text style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>{r.schoolName}</Text>
                      {r.schoolNameUrdu ? <Text style={{ fontSize: 11, color: "#94A3B8", marginTop: 1 }} allowFontScaling={false}>{r.schoolNameUrdu}</Text> : null}
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        <View style={{ backgroundColor: "#DCFCE7", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#16A34A" }}>Rs. {r.monthlyPrice?.toLocaleString()}/month</Text>
                        </View>
                        <View style={{ backgroundColor: "#F1F5F9", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <Text style={{ fontSize: 11, color: "#475569" }}>🕗 {r.morningTime}</Text>
                        </View>
                        {r.afternoonTime ? <View style={{ backgroundColor: "#F1F5F9", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ fontSize: 11, color: "#475569" }}>🕑 {r.afternoonTime}</Text></View> : null}
                        <View style={{ backgroundColor: "#F1F5F9", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <Text style={{ fontSize: 11, color: "#475569" }}>👥 {r.enrolledCount}/{r.capacity} students</Text>
                        </View>
                      </View>
                      <Text style={{ fontSize: 11, color: "#94A3B8", marginTop: 6 }}>📍 {r.fromArea} → {r.toAddress}</Text>
                    </View>
                    {selectedRoute?.id === r.id && <Ionicons name="checkmark-circle" size={22} color="#3B82F6" />}
                  </View>
                </Pressable>
              ))
            )}

            {selectedRoute && (
              <>
                <View style={{ height: 1, backgroundColor: "#F1F5F9" }} />
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#374151" }}>Student Details</Text>
                <View style={{ gap: 12 }}>
                  <View>
                    <Text style={{ fontSize: 12, color: "#6B7280", marginBottom: 6, fontFamily: "Inter_500Medium" }}>Student Name *</Text>
                    <View style={{ borderWidth: 1.5, borderColor: "#E2E8F0", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#FAFAFA" }}>
                      <TextInput
                        value={schoolStudent}
                        onChangeText={setSchoolStudent}
                        placeholder="e.g. Ali Khan"
                        style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: "#1E293B" }}
                        placeholderTextColor="#9CA3AF"
                      />
                    </View>
                  </View>
                  <View>
                    <Text style={{ fontSize: 12, color: "#6B7280", marginBottom: 6, fontFamily: "Inter_500Medium" }}>Class / Grade *</Text>
                    <View style={{ borderWidth: 1.5, borderColor: "#E2E8F0", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#FAFAFA" }}>
                      <TextInput
                        value={schoolClass}
                        onChangeText={setSchoolClass}
                        placeholder="e.g. 7th Grade"
                        style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: "#1E293B" }}
                        placeholderTextColor="#9CA3AF"
                      />
                    </View>
                  </View>
                </View>
                <View style={{ backgroundColor: "#FFFBEB", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#FDE68A", marginTop: 4 }}>
                  <Text style={{ fontSize: 12, color: "#92400E", fontFamily: "Inter_500Medium" }}>
                    💳 First month payment: Rs. {selectedRoute.monthlyPrice?.toLocaleString()} — {payMethod === "wallet" ? "Deducted from wallet" : "Cash on pickup"}
                  </Text>
                </View>
                <Pressable onPress={handleSchoolSubscribe} disabled={subscribing}
                  style={{ backgroundColor: subscribing ? "#93C5FD" : "#3B82F6", borderRadius: 14, padding: 16, alignItems: "center", marginTop: 8, opacity: subscribing ? 0.8 : 1 }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff" }}>
                    {subscribing ? "Subscribing..." : `🚌 Subscribe — Rs. ${selectedRoute.monthlyPrice?.toLocaleString()}/month`}
                  </Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

    </View>
  );
}

export default withServiceGuard("rides", RideScreenInner);

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
