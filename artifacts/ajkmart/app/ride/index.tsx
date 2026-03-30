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
  rateRide,
  getDispatchStatus,
  retryRideDispatch,
} from "@workspace/api-client-react";
import type { BookRideRequest, EstimateFareRequest } from "@workspace/api-client-react";

const C   = Colors.light;
const W   = Dimensions.get("window").width;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type PopularSpot = { id: string; name: string; nameUrdu?: string; lat: number; lng: number; icon?: string; category?: string };

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

  const ring1     = useRef(new Animated.Value(1)).current;
  const ring2     = useRef(new Animated.Value(1)).current;
  const ring3     = useRef(new Animated.Value(1)).current;
  const ring1Op   = useRef(new Animated.Value(0.55)).current;
  const ring2Op   = useRef(new Animated.Value(0.38)).current;
  const ring3Op   = useRef(new Animated.Value(0.22)).current;
  const slideUp   = useRef(new Animated.Value(50)).current;
  const fadeIn    = useRef(new Animated.Value(0)).current;

  const [ride,           setRide]           = useState<any>(null);
  const [cancelling,     setCancelling]     = useState(false);
  const [showCancelModal,setShowCancelModal]= useState(false);
  const [rating,         setRating]         = useState(0);
  const [ratingDone,     setRatingDone]     = useState(false);
  const [ratingComment,  setRatingComment]  = useState("");
  const [elapsed,        setElapsed]        = useState(0);
  const [dispatchInfo,   setDispatchInfo]   = useState<any>(null);
  const [retrying,       setRetrying]       = useState(false);
  const prevStatus   = useRef<string>("");

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

  const [updateOfferInput,  setUpdateOfferInput]  = useState("");
  const [updateOfferLoading,setUpdateOfferLoading] = useState(false);
  const [showUpdateOffer,   setShowUpdateOffer]    = useState(false);
  const [acceptBidId,       setAcceptBidId]        = useState<string | null>(null);

  const acceptBid = async (bidId: string) => {
    setAcceptBidId(bidId);
    try {
      const d = await acceptRideBidApi(rideId, { bidId });
      setRide(d as typeof ride);
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || "Could not accept bid. Please try again.";
      showToast(msg, "error");
    }
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
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || "Could not update offer. Please try again.";
      showToast(msg, "error");
    }
    setUpdateOfferLoading(false);
  };

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

  useEffect(() => {
    const status = ride?.status;
    if (status !== "searching" && status !== "no_riders") return;
    const poll = async () => {
      try {
        const d = await getDispatchStatus(rideId);
        setDispatchInfo(d);
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
  }, [rideId, ride?.status]);

  const handleRetryDispatch = async () => {
    setRetrying(true);
    try {
      await retryRideDispatch(rideId);
      setRide((r: any) => r ? { ...r, status: "searching" } : r);
      setDispatchInfo(null);
    } catch {
      showToast("Could not retry. Please try again.", "error");
    }
    setRetrying(false);
  };

  const { showToast } = useToast();

  const [cancelResult, setCancelResult] = useState<{ cancellationFee?: number; cancelReason?: string } | null>(null);

  const cancelRideHandler = async () => {
    setCancelling(true);
    setShowCancelModal(false);
    try {
      const result = await cancelRideApi(rideId, {}) as any;
      setCancelResult({ cancellationFee: result?.cancellationFee, cancelReason: result?.cancelReason });
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

  if (status === "bargaining") {
    const offeredFare = ride?.offeredFare ?? 0;
    const bids: any[]  = ride?.bids ?? [];
    const hasBids      = bids.length > 0;

    return (
      <View style={{ flex: 1, backgroundColor: "#0F172A" }}>
        <LinearGradient colors={["#1E293B", "#0F172A"]} style={StyleSheet.absoluteFillObject} />

        <View style={{ paddingTop: topPad + 16, paddingHorizontal: 20, paddingBottom: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Pressable onPress={() => router.push("/(tabs)")} hitSlop={8} style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="chevron-back" size={20} color="#fff" />
              </Pressable>
              <View>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 18, color: "#fff" }}>Live Negotiation</Text>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
                #{rideId.slice(-8).toUpperCase()} · {elapsedStr}
              </Text>
              </View>
            </View>
            <View style={{ backgroundColor: "rgba(251,191,36,0.15)", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10, alignItems: "center", borderWidth: 1, borderColor: "rgba(251,191,36,0.3)" }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 20, color: "#FCD34D" }}>Rs. {offeredFare}</Text>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: "rgba(251,191,36,0.7)" }}>Your Offer</Text>
            </View>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120, gap: 14 }} showsVerticalScrollIndicator={false}>
          {!hasBids && (
            <View style={{ alignItems: "center", paddingVertical: 48 }}>
              <View style={{ width: 160, height: 160, alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                <Animated.View style={{ position: "absolute", width: 160, height: 160, borderRadius: 80, backgroundColor: "rgba(251,191,36,0.06)", transform: [{ scale: ring3 }], opacity: ring3Op }} />
                <Animated.View style={{ position: "absolute", width: 120, height: 120, borderRadius: 60, backgroundColor: "rgba(251,191,36,0.1)", transform: [{ scale: ring2 }], opacity: ring2Op }} />
                <Animated.View style={{ position: "absolute", width: 80,  height: 80,  borderRadius: 40, backgroundColor: "rgba(251,191,36,0.16)", transform: [{ scale: ring1 }], opacity: ring1Op }} />
                <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: "rgba(251,191,36,0.25)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="chatbubbles" size={28} color="#FCD34D" />
                </View>
              </View>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 20, color: "#fff", textAlign: "center" }}>Waiting for Riders</Text>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,255,255,0.5)", textAlign: "center", marginTop: 8, lineHeight: 20, maxWidth: 260 }}>
                Riders are reviewing your offer. You'll see bids appear here.
              </Text>
            </View>
          )}

          {hasBids && (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#10B981" }} />
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
                  {bids.length} Bid{bids.length > 1 ? "s" : ""} Received
                </Text>
              </View>
              {bids.map((bid: any) => (
                <View key={bid.id} style={{ backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 20, padding: 18, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 }}>
                    <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(251,191,36,0.15)", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 22 }}>🏍️</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" }}>{bid.riderName}</Text>
                      {bid.note ? (
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 3 }}>{bid.note}</Text>
                      ) : null}
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: "#FCD34D" }}>Rs. {Math.round(bid.fare)}</Text>
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                        {bid.fare === offeredFare
                          ? "Matches your offer"
                          : bid.fare > offeredFare
                            ? `+Rs. ${Math.round(bid.fare - offeredFare)}`
                            : `-Rs. ${Math.round(offeredFare - bid.fare)} savings`}
                      </Text>
                    </View>
                  </View>
                  <Pressable
                    onPress={() => acceptBid(bid.id)}
                    disabled={acceptBidId !== null}
                    style={{ backgroundColor: "#10B981", borderRadius: 14, paddingVertical: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, opacity: acceptBidId !== null ? 0.6 : 1 }}>
                    {acceptBidId === bid.id
                      ? <ActivityIndicator color="#fff" size="small" />
                      : (
                        <>
                          <Ionicons name="checkmark-circle" size={18} color="#fff" />
                          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" }}>Accept Rs. {Math.round(bid.fare)}</Text>
                        </>
                      )
                    }
                  </Pressable>
                </View>
              ))}
            </>
          )}

          <View style={{ backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 18, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" }}>
            <Pressable
              onPress={() => setShowUpdateOffer(v => !v)}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons name="create-outline" size={18} color="rgba(255,255,255,0.6)" />
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "rgba(255,255,255,0.8)" }}>Update Your Offer</Text>
              </View>
              <Ionicons name={showUpdateOffer ? "chevron-up" : "chevron-down"} size={16} color="rgba(255,255,255,0.4)" />
            </Pressable>
            {showUpdateOffer && (
              <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12 }}>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
                  A new offer cancels all pending bids
                </Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" }}>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "rgba(255,255,255,0.5)" }}>Rs.</Text>
                    <TextInput
                      value={updateOfferInput}
                      onChangeText={setUpdateOfferInput}
                      keyboardType="numeric"
                      placeholder={String(Math.ceil(offeredFare * 1.1))}
                      placeholderTextColor="rgba(255,255,255,0.2)"
                      style={{ flex: 1, fontFamily: "Inter_700Bold", fontSize: 18, color: "#fff", paddingVertical: 12, paddingHorizontal: 6 }}
                    />
                  </View>
                  <Pressable
                    onPress={sendUpdateOffer}
                    disabled={updateOfferLoading || !updateOfferInput}
                    style={{ backgroundColor: "#F59E0B", borderRadius: 12, paddingHorizontal: 20, alignItems: "center", justifyContent: "center", opacity: (!updateOfferInput || updateOfferLoading) ? 0.5 : 1 }}>
                    {updateOfferLoading
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: "#fff" }}>Send</Text>
                    }
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        </ScrollView>

        <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 24) + 8 }}>
          <Pressable
            onPress={() => setShowCancelModal(true)}
            disabled={cancelling}
            style={{ alignItems: "center", padding: 16, borderRadius: 16, borderWidth: 1.5, borderColor: "rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.1)" }}>
            {cancelling
              ? <ActivityIndicator color="#EF4444" size="small" />
              : <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 15, color: "#EF4444" }}>Cancel Offer</Text>
            }
          </Pressable>
        </View>

        <Modal visible={showCancelModal} transparent animationType="fade" onRequestClose={() => setShowCancelModal(false)}>
          <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 24 }} onPress={() => setShowCancelModal(false)}>
            <Pressable style={{ backgroundColor: "#fff", borderRadius: 24, padding: 28, width: "100%", maxWidth: 380, gap: 20 }} onPress={() => {}}>
              <View style={{ alignItems: "center", gap: 12 }}>
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="close-circle" size={34} color="#DC2626" />
                </View>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 20, color: "#111827" }}>Cancel Offer?</Text>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: "#6B7280", textAlign: "center", lineHeight: 21 }}>
                  All pending rider bids will also be cancelled.
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <Pressable onPress={() => setShowCancelModal(false)} style={{ flex: 1, alignItems: "center", padding: 15, borderRadius: 14, backgroundColor: "#F3F4F6" }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#374151" }}>Go Back</Text>
                </Pressable>
                <Pressable onPress={cancelRideHandler} disabled={cancelling} style={{ flex: 1, alignItems: "center", padding: 15, borderRadius: 14, backgroundColor: "#DC2626" }}>
                  {cancelling
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" }}>Cancel</Text>}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    );
  }

  if (status === "no_riders" || (status === "searching" && elapsed >= 180)) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0F172A" }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
          <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: "rgba(239,68,68,0.12)", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
            <Ionicons name="car-outline" size={44} color="#EF4444" />
          </View>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 24, color: "#fff", textAlign: "center", marginBottom: 8 }}>
            No Drivers Available
          </Text>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: "rgba(255,255,255,0.5)", textAlign: "center", lineHeight: 22, marginBottom: 12 }}>
            {dispatchInfo?.notifiedRiders > 0
              ? `We notified ${dispatchInfo.notifiedRiders} driver(s) but none accepted.`
              : "No drivers are available right now. Try again shortly."}
          </Text>
          {dispatchInfo && (
            <View style={{ backgroundColor: "rgba(255,255,255,0.06)", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, marginBottom: 24, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" }}>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                {dispatchInfo.notifiedRiders} riders notified · {dispatchInfo.elapsedSec}s elapsed
                {dispatchInfo.dispatchLoopCount != null ? ` · Round ${dispatchInfo.dispatchLoopCount}/${dispatchInfo.maxLoops}` : ""}
              </Text>
            </View>
          )}
          <Pressable
            onPress={handleRetryDispatch}
            disabled={retrying}
            style={{ backgroundColor: "#fff", borderRadius: 16, paddingVertical: 16, paddingHorizontal: 32, alignItems: "center", width: "100%", marginBottom: 12, opacity: retrying ? 0.6 : 1 }}>
            {retrying
              ? <ActivityIndicator color={C.primary} size="small" />
              : <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: C.primary }}>Retry Search</Text>
            }
          </Pressable>
          <Pressable
            onPress={() => setShowCancelModal(true)}
            disabled={cancelling}
            style={{ borderWidth: 1.5, borderColor: "rgba(239,68,68,0.4)", borderRadius: 16, paddingVertical: 14, paddingHorizontal: 32, alignItems: "center", width: "100%", marginBottom: 12 }}>
            {cancelling
              ? <ActivityIndicator color="#EF4444" size="small" />
              : <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 15, color: "#EF4444" }}>Cancel Ride</Text>
            }
          </Pressable>
          <Pressable
            onPress={onReset}
            style={{ borderWidth: 1.5, borderColor: "rgba(255,255,255,0.15)", borderRadius: 16, paddingVertical: 14, paddingHorizontal: 32, alignItems: "center", width: "100%" }}>
            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 15, color: "rgba(255,255,255,0.5)" }}>Go Back</Text>
          </Pressable>
        </View>

        <Modal visible={showCancelModal} transparent animationType="fade" onRequestClose={() => setShowCancelModal(false)}>
          <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 24 }} onPress={() => setShowCancelModal(false)}>
            <Pressable style={{ backgroundColor: "#fff", borderRadius: 24, padding: 28, width: "100%", maxWidth: 380, gap: 20 }} onPress={() => {}}>
              <View style={{ alignItems: "center", gap: 12 }}>
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="close-circle" size={34} color="#DC2626" />
                </View>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 20, color: "#111827" }}>Cancel Ride?</Text>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: "#6B7280", textAlign: "center", lineHeight: 21 }}>
                  No driver assigned yet — no cancellation fee will apply.
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <Pressable onPress={() => setShowCancelModal(false)} style={{ flex: 1, alignItems: "center", padding: 15, borderRadius: 14, backgroundColor: "#F3F4F6" }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#374151" }}>Go Back</Text>
                </Pressable>
                <Pressable onPress={cancelRideHandler} disabled={cancelling} style={{ flex: 1, alignItems: "center", padding: 15, borderRadius: 14, backgroundColor: "#DC2626" }}>
                  {cancelling
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" }}>Cancel</Text>}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    );
  }

  if (status === "searching") {
    return (
      <View style={{ flex: 1, backgroundColor: "#0F172A" }}>
        <View style={{ position: "absolute", top: topPad + 16, left: 20, zIndex: 10 }}>
          <Pressable onPress={() => router.push("/(tabs)")} hitSlop={8} style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="chevron-back" size={20} color="#fff" />
          </Pressable>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
          <View style={{ width: 160, height: 160, alignItems: "center", justifyContent: "center", marginBottom: 28 }}>
            <Animated.View style={{ position: "absolute", width: 160, height: 160, borderRadius: 80, backgroundColor: "rgba(16,185,129,0.06)", transform: [{ scale: ring3 }], opacity: ring3Op }} />
            <Animated.View style={{ position: "absolute", width: 120, height: 120, borderRadius: 60, backgroundColor: "rgba(16,185,129,0.1)", transform: [{ scale: ring2 }], opacity: ring2Op }} />
            <Animated.View style={{ position: "absolute", width: 80,  height: 80,  borderRadius: 40, backgroundColor: "rgba(16,185,129,0.16)", transform: [{ scale: ring1 }], opacity: ring1Op }} />
            <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: "rgba(16,185,129,0.25)", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="search" size={28} color="#10B981" />
            </View>
          </View>

          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: "#fff", textAlign: "center", marginBottom: 8 }}>
            Finding Your Driver
          </Text>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: "rgba(255,255,255,0.5)", textAlign: "center", lineHeight: 22 }}>
            Searching nearby drivers... {elapsedStr}
          </Text>

          {dispatchInfo && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, backgroundColor: "rgba(255,255,255,0.06)", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" }}>
              <Ionicons name="navigate-outline" size={13} color="rgba(255,255,255,0.5)" />
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                Round {(dispatchInfo.dispatchLoopCount ?? 0) + 1}/{dispatchInfo.maxLoops || "?"} · {dispatchInfo.attemptCount || 0} contacted
              </Text>
            </View>
          )}

          <View style={{ flexDirection: "row", backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 16, overflow: "hidden", marginTop: 36, width: "100%", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" }}>
            {[{ val: "50+", lbl: "Active Drivers" }, { val: "2–5", lbl: "Min ETA" }].map((s, i) => (
              <View key={i} style={{ flex: 1, alignItems: "center", padding: 16, borderLeftWidth: i > 0 ? 1 : 0, borderLeftColor: "rgba(255,255,255,0.08)" }}>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: "#fff" }}>{s.val}</Text>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>{s.lbl}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ paddingHorizontal: 24, paddingBottom: Math.max(insets.bottom, 24) + 16 }}>
          <Pressable onPress={() => setShowCancelModal(true)} disabled={cancelling} style={{ alignItems: "center", padding: 16, borderRadius: 16, borderWidth: 1.5, borderColor: "rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.08)" }}>
            {cancelling
              ? <ActivityIndicator color="#EF4444" size="small" />
              : <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 15, color: "#EF4444" }}>Cancel Ride</Text>
            }
          </Pressable>
        </View>

        <Modal visible={showCancelModal} transparent animationType="fade" onRequestClose={() => setShowCancelModal(false)}>
          <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 24 }} onPress={() => setShowCancelModal(false)}>
            <Pressable style={{ backgroundColor: "#fff", borderRadius: 24, padding: 28, width: "100%", maxWidth: 380, gap: 20 }} onPress={() => {}}>
              <View style={{ alignItems: "center", gap: 12 }}>
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="close-circle" size={34} color="#DC2626" />
                </View>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 20, color: "#111827" }}>Cancel Ride?</Text>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: "#6B7280", textAlign: "center", lineHeight: 21 }}>
                  No driver assigned yet — no cancellation fee will apply.
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <Pressable onPress={() => setShowCancelModal(false)} style={{ flex: 1, alignItems: "center", padding: 15, borderRadius: 14, backgroundColor: "#F3F4F6" }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#374151" }}>Go Back</Text>
                </Pressable>
                <Pressable onPress={cancelRideHandler} disabled={cancelling} style={{ flex: 1, alignItems: "center", padding: 15, borderRadius: 14, backgroundColor: "#DC2626" }}>
                  {cancelling
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" }}>Cancel</Text>}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    );
  }

  if (status === "cancelled") {
    const wasWallet = ride?.paymentMethod === "wallet";
    const appliedFee = cancelResult?.cancellationFee ?? 0;
    const cancelReason = cancelResult?.cancelReason;
    return (
      <View style={{ flex: 1, backgroundColor: C.background }}>
        <View style={{ paddingTop: topPad + 24, paddingBottom: 36, alignItems: "center", paddingHorizontal: 24, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
            <Ionicons name="close-circle" size={40} color="#EF4444" />
          </View>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: C.text }}>Ride Cancelled</Text>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted, marginTop: 6 }}>Your ride has been cancelled</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          {appliedFee > 0 && (
            <View style={{ backgroundColor: "#FEF2F2", borderRadius: 16, padding: 16, gap: 8, borderWidth: 1, borderColor: "#FEE2E2" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="cash-outline" size={16} color="#DC2626" />
                </View>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#991B1B" }}>Cancellation Fee Applied</Text>
              </View>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: "#374151", lineHeight: 19 }}>
                Rs. {appliedFee} cancellation fee has been charged.
              </Text>
            </View>
          )}
          {wasWallet && (
            <View style={{ backgroundColor: "#F0FDF4", borderRadius: 16, padding: 16, gap: 8, borderWidth: 1, borderColor: "#D1FAE5" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "#D1FAE5", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="wallet-outline" size={16} color="#10B981" />
                </View>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#065F46" }}>Refund Initiated</Text>
              </View>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: "#374151", lineHeight: 19 }}>
                Rs. {ride?.fare} will be refunded to your wallet.
              </Text>
            </View>
          )}
          {cancelReason && (
            <View style={{ backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border }}>
              <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: C.textMuted, marginBottom: 4 }}>Reason</Text>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.text }}>{cancelReason}</Text>
            </View>
          )}
          <View style={{ backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border, alignItems: "center" }}>
            <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: C.textMuted }}>
              Ride #{rideId.slice(-8).toUpperCase()}
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Pressable onPress={() => router.push("/(tabs)")} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 16, borderRadius: 14, backgroundColor: "#F1F5F9" }}>
              <Ionicons name="home-outline" size={17} color={C.textSecondary} />
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.textSecondary }}>Home</Text>
            </Pressable>
            <Pressable onPress={onReset} style={{ flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 16, borderRadius: 14, backgroundColor: C.primary }}>
              <Ionicons name="add" size={17} color="#fff" />
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" }}>Book New Ride</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (status === "completed") {
    return (
      <View style={{ flex: 1, backgroundColor: C.background }}>
        <View style={{ paddingTop: topPad + 24, paddingBottom: 32, alignItems: "center", paddingHorizontal: 24, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: "#D1FAE5", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
            <Ionicons name="checkmark-circle" size={40} color="#10B981" />
          </View>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: C.text }}>Ride Complete!</Text>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted, marginTop: 6 }}>Rs. {ride?.fare} · {ride?.distance} km</Text>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 14 }}>
          {!ratingDone ? (
            <View style={{ backgroundColor: "#fff", borderRadius: 20, padding: 20, alignItems: "center", gap: 12, borderWidth: 1, borderColor: C.border }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: C.text }}>Rate Your Driver</Text>
              <View style={{ flexDirection: "row", gap: 12, marginVertical: 4 }}>
                {[1,2,3,4,5].map(s => (
                  <Pressable key={s} onPress={() => setRating(s)}>
                    <Ionicons name={s <= rating ? "star" : "star-outline"} size={36} color={s <= rating ? "#F59E0B" : "#D1D5DB"} />
                  </Pressable>
                ))}
              </View>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted }}>
                {rating === 0 ? "Tap to rate" : rating === 5 ? "Excellent!" : rating >= 4 ? "Great ride!" : rating >= 3 ? "It was okay" : "Could be better"}
              </Text>
              {rating > 0 && (
                <>
                  <TextInput
                    placeholder="Add a comment (optional)..."
                    value={ratingComment}
                    onChangeText={setRatingComment}
                    style={{ width: "100%", borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12, fontFamily: "Inter_400Regular", fontSize: 14, color: C.text, marginTop: 4 }}
                    placeholderTextColor={C.textMuted}
                  />
                  <Pressable
                    onPress={async () => {
                      try {
                        await rateRide(rideId, { stars: rating, comment: ratingComment || undefined });
                        setRatingDone(true);
                      } catch {
                        showToast("Could not submit rating. Please try again.", "error");
                      }
                    }}
                    style={{ backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 24, width: "100%", alignItems: "center", marginTop: 4 }}>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" }}>Submit Rating</Text>
                  </Pressable>
                </>
              )}
            </View>
          ) : (
            <View style={{ backgroundColor: "#D1FAE5", borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name="checkmark-circle" size={20} color="#059669" />
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#065F46" }}>Thanks for rating!</Text>
            </View>
          )}

          <View style={{ backgroundColor: "#fff", borderRadius: 20, borderWidth: 1, borderColor: C.border, overflow: "hidden" }}>
            <View style={{ backgroundColor: C.surfaceSecondary, padding: 14, borderBottomWidth: 1, borderBottomColor: C.border, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: C.text }}>Receipt</Text>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted }}>#{rideId.slice(-8).toUpperCase()}</Text>
            </View>
            <View style={{ padding: 16, gap: 12 }}>
              {[
                { lbl: "Vehicle",  val: rideType === "bike" ? "Bike" : rideType === "car" ? "Car" : rideType === "rickshaw" ? "Rickshaw" : rideType },
                { lbl: "Distance", val: `${ride?.distance} km` },
                { lbl: "Payment",  val: ride?.paymentMethod === "wallet" ? "Wallet" : "Cash" },
                { lbl: "Driver",   val: ride?.riderName || "AJK Driver" },
              ].map(r => (
                <View key={r.lbl} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted }}>{r.lbl}</Text>
                  <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: C.text }}>{r.val}</Text>
                </View>
              ))}
              <View style={{ height: 1, backgroundColor: C.border, marginVertical: 4 }} />
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: C.text }}>Total</Text>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: C.success }}>Rs. {ride?.fare}</Text>
              </View>
            </View>
          </View>

          <View style={{ backgroundColor: "#fff", borderRadius: 20, padding: 16, gap: 14, borderWidth: 1, borderColor: C.border }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: C.text }}>Route</Text>
              <Pressable onPress={openInMaps} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#EFF6FF", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 }}>
                <Ionicons name="navigate-outline" size={12} color="#4285F4" />
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: "#4285F4" }}>Map</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ alignItems: "center", gap: 4 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#10B981" }} />
                <View style={{ flex: 1, width: 2, backgroundColor: C.border, minHeight: 20 }} />
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#EF4444" }} />
              </View>
              <View style={{ flex: 1, gap: 16 }}>
                <View>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted }}>Pickup</Text>
                  <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: C.text, marginTop: 2 }}>{ride?.pickupAddress}</Text>
                </View>
                <View>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted }}>Drop-off</Text>
                  <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: C.text, marginTop: 2 }}>{ride?.dropAddress}</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F0FDF4", padding: 14, borderRadius: 14, borderWidth: 1, borderColor: "#D1FAE5" }}>
            <Ionicons name="shield-checkmark" size={14} color="#059669" />
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#065F46" }}>Insured ride · Verified driver · GPS tracked</Text>
          </View>

          <View style={{ flexDirection: "row", gap: 12 }}>
            <Pressable onPress={() => router.push("/(tabs)")} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 16, borderRadius: 14, backgroundColor: "#F1F5F9" }}>
              <Ionicons name="home-outline" size={17} color={C.textSecondary} />
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.textSecondary }}>Home</Text>
            </Pressable>
            <Pressable onPress={onReset} style={{ flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 16, borderRadius: 14, backgroundColor: C.primary }}>
              <Ionicons name="add" size={17} color="#fff" />
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" }}>Book New Ride</Text>
            </Pressable>
          </View>
          <View style={{ height: 24 }} />
        </ScrollView>
      </View>
    );
  }

  type StatusCfg = { color: string; icon: string; title: string; sub: string };
  const statusCfgs: Record<string, StatusCfg> = {
    accepted:   { color: "#1A56DB",  icon: "car",      title: "Driver Is Coming",    sub: "Your driver has accepted the ride"       },
    arrived:    { color: "#D97706",  icon: "location", title: "Driver Has Arrived",   sub: "Your driver is at the pickup point"   },
    in_transit: { color: "#059669",  icon: "navigate", title: "On Your Way",          sub: "Trip in progress"     },
  };
  const hdrCfg  = statusCfgs[status] ?? statusCfgs["accepted"]!;
  const canCancel = ["accepted", "arrived", "in_transit"].includes(status);

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={{ paddingTop: topPad + 16, paddingBottom: 20, paddingHorizontal: 20, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Pressable onPress={() => router.push("/(tabs)")} hitSlop={8} style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="chevron-back" size={20} color={C.text} />
          </Pressable>
          <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: `${hdrCfg.color}15`, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={hdrCfg.icon as any} size={26} color={hdrCfg.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 18, color: C.text }}>{hdrCfg.title}</Text>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, marginTop: 3 }}>{hdrCfg.sub}</Text>
          </View>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 14 }}>
        <Animated.View style={{ opacity: fadeIn, transform: [{ translateY: slideUp }], gap: 14 }}>
          <View style={{ backgroundColor: "#fff", borderRadius: 20, padding: 18, borderWidth: 1, borderColor: C.border }}>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: C.text, marginBottom: 18 }}>Ride Progress</Text>
            <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
              {STEPS.map((step, i) => {
                const done   = stepIdx >= i;
                const active = stepIdx === i;
                const isLast = i === STEPS.length - 1;
                return (
                  <React.Fragment key={step}>
                    <View style={{ alignItems: "center", flex: 1, gap: 6 }}>
                      <View style={{
                        width: 32, height: 32, borderRadius: 16,
                        backgroundColor: done ? (active ? hdrCfg.color : "#10B981") : "#F1F5F9",
                        alignItems: "center", justifyContent: "center",
                        ...(active ? { shadowColor: hdrCfg.color, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 6 } : {}),
                      }}>
                        {done
                          ? <Ionicons name="checkmark" size={15} color="#fff" />
                          : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#CBD5E1" }} />}
                      </View>
                      <Text style={{ fontSize: 10, textAlign: "center", color: done ? C.text : C.textMuted, fontFamily: active ? "Inter_700Bold" : "Inter_400Regular" }}>
                        {LABELS[i]}
                      </Text>
                    </View>
                    {!isLast && (
                      <View style={{ height: 2, flex: 0.4, backgroundColor: stepIdx > i ? "#10B981" : "#F1F5F9", marginTop: 15, borderRadius: 1 }} />
                    )}
                  </React.Fragment>
                );
              })}
            </View>
          </View>

          {ride?.riderName && (
            <View style={{ backgroundColor: "#fff", borderRadius: 20, padding: 18, borderWidth: 1, borderColor: C.border }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: `${hdrCfg.color}12`, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: hdrCfg.color }}>
                    {ride.riderName.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: C.text }}>{ride.riderName}</Text>
                  {ride.riderPhone && (
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, marginTop: 2 }}>{ride.riderPhone}</Text>
                  )}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 5 }}>
                    {[1,2,3,4,5].map(s => <Ionicons key={s} name={s <= 4 ? "star" : "star-outline"} size={11} color="#F59E0B" />)}
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: C.textMuted, marginLeft: 4 }}>4.0</Text>
                  </View>
                </View>
                <View style={{ backgroundColor: C.surfaceSecondary, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, alignItems: "center" }}>
                  <Text style={{ fontSize: 22 }}>
                    {{ bike: "🏍️", car: "🚗", rickshaw: "🛺", daba: "🚐", school_shift: "🚌" }[rideType] ?? "🚗"}
                  </Text>
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 10, color: C.textSecondary, marginTop: 3 }}>
                    {{ bike: "Bike", car: "Car", rickshaw: "Rickshaw", daba: "Daba", school_shift: "School" }[rideType] ?? rideType}
                  </Text>
                </View>
              </View>

              {ride.riderLat != null && ride.riderLng != null && ride.pickupLat != null && (status === "accepted" || status === "arrived") && (() => {
                const km = haversineKm(ride.riderLat, ride.riderLng, ride.pickupLat, ride.pickupLng);
                const nearby = km < 0.2;
                const stale  = ride.riderLocAge != null && ride.riderLocAge > 60;
                return (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: nearby ? "#F0FDF4" : "#EFF6FF", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14, borderWidth: 1, borderColor: nearby ? "#D1FAE5" : "#DBEAFE" }}>
                    <Ionicons name={nearby ? "location" : "navigate-outline"} size={16} color={nearby ? "#10B981" : C.primary} />
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: nearby ? "#065F46" : "#1E40AF", flex: 1 }}>
                      {nearby ? "Driver is nearby!" : `${km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`} away`}
                    </Text>
                    {stale && <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: C.textMuted }}>stale</Text>}
                  </View>
                );
              })()}

              <View style={{ flexDirection: "row", gap: 10 }}>
                {ride.riderPhone && (
                  <Pressable onPress={() => Linking.openURL(`tel:${ride.riderPhone}`)}
                    style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 14, backgroundColor: C.primary }}>
                    <Ionicons name="call" size={18} color="#fff" />
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" }}>Call</Text>
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

          <View style={{ backgroundColor: "#fff", borderRadius: 20, padding: 16, gap: 14, borderWidth: 1, borderColor: C.border }}>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: C.text }}>Trip Details</Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ alignItems: "center", gap: 4 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#10B981" }} />
                <View style={{ flex: 1, width: 2, backgroundColor: C.border, minHeight: 20 }} />
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#EF4444" }} />
              </View>
              <View style={{ flex: 1, gap: 16 }}>
                <View>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted }}>Pickup</Text>
                  <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: C.text, marginTop: 2 }}>{ride?.pickupAddress}</Text>
                </View>
                <View>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted }}>Drop-off</Text>
                  <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: C.text, marginTop: 2 }}>{ride?.dropAddress}</Text>
                </View>
              </View>
            </View>
            <View style={{ height: 1, backgroundColor: C.border }} />
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted }}>Fare</Text>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: C.success }}>Rs. {ride?.fare}</Text>
            </View>
          </View>

          <Pressable onPress={openInMaps} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#EFF6FF", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#DBEAFE" }}>
            <Ionicons name="navigate-outline" size={16} color="#4285F4" />
            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#4285F4" }}>Open in Google Maps</Text>
          </Pressable>

          {canCancel && (
            <Pressable
              onPress={() => setShowCancelModal(true)}
              disabled={cancelling}
              style={{ alignItems: "center", padding: 16, borderRadius: 16, borderWidth: 1.5, borderColor: "#FCA5A5", backgroundColor: "#FEF2F2" }}>
              {cancelling
                ? <ActivityIndicator color="#DC2626" size="small" />
                : <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 15, color: "#DC2626" }}>Cancel Ride</Text>
              }
            </Pressable>
          )}
        </Animated.View>
        <View style={{ height: 24 }} />
      </ScrollView>

      <Modal visible={showCancelModal} transparent animationType="fade" onRequestClose={() => setShowCancelModal(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 24 }} onPress={() => setShowCancelModal(false)}>
          <Pressable style={{ backgroundColor: "#fff", borderRadius: 24, padding: 28, width: "100%", maxWidth: 380, gap: 20 }} onPress={() => {}}>
            <View style={{ alignItems: "center", gap: 12 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="close-circle" size={34} color="#DC2626" />
              </View>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 20, color: "#111827" }}>Cancel Ride?</Text>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: "#6B7280", textAlign: "center", lineHeight: 21 }}>
                {cancellationFee > 0
                  ? `A cancellation fee of Rs. ${cancellationFee} will be charged since a driver has been assigned.`
                  : "Your ride will be cancelled. No fee applies."}
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Pressable onPress={() => setShowCancelModal(false)} style={{ flex: 1, alignItems: "center", padding: 15, borderRadius: 14, backgroundColor: "#F3F4F6" }}>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#374151" }}>Go Back</Text>
              </Pressable>
              <Pressable onPress={cancelRideHandler} disabled={cancelling} style={{ flex: 1, alignItems: "center", padding: 15, borderRadius: 14, backgroundColor: "#DC2626" }}>
                {cancelling
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" }}>Cancel</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function RideScreenInner() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const { user, updateUser, token } = useAuth();
  const { showToast } = useToast();
  const { config } = usePlatformConfig();
  const rideCfg = config.rides;
  const ridesEnabled = config.features.rides;
  const inMaintenance = config.appStatus === "maintenance";
  const apiBase = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

  const [pickup,     setPickup]    = useState("");
  const [drop,       setDrop]      = useState("");
  const [pickupObj,  setPickupObj] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [dropObj,    setDropObj]   = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [rideType,   setRideType]  = useState("bike");
  const [payMethod,  setPayMethod] = useState<"cash" | "wallet">("cash");

  type ServiceType = { key: string; name: string; nameUrdu?: string; icon: string; color?: string; baseFare: number; perKm: number; minFare: number; maxPassengers: number; description?: string; allowBargaining?: boolean };
  const DEFAULT_SERVICES: ServiceType[] = [
    { key: "bike", name: "Bike", icon: "🏍️", baseFare: 50, perKm: 15, minFare: 50, maxPassengers: 1, allowBargaining: true },
    { key: "car", name: "Car", icon: "🚗", baseFare: 150, perKm: 25, minFare: 150, maxPassengers: 4, allowBargaining: true },
    { key: "rickshaw", name: "Rickshaw", icon: "🛺", baseFare: 80, perKm: 18, minFare: 80, maxPassengers: 3, allowBargaining: true },
  ];
  const [services,   setServices]  = useState<ServiceType[]>(DEFAULT_SERVICES);
  const [payMethods, setPayMethods] = useState<{ id: string; label?: string; name?: string }[]>([
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

  const [popularSpots,   setPopularSpots]   = useState<PopularSpot[]>([]);
  const [schoolRoutes,   setSchoolRoutes]   = useState<any[]>([]);
  const [showSchoolModal,setShowSchoolModal] = useState(false);
  const [selectedRoute,  setSelectedRoute]  = useState<any>(null);
  const [schoolStudent,  setSchoolStudent]  = useState("");
  const [schoolClass,    setSchoolClass]    = useState("");
  const [subscribing,    setSubscribing]    = useState(false);

  const { predictions: pickupPreds, loading: pickupLoading } = useMapsAutocomplete(pickupFocus ? pickup : "");
  const { predictions: dropPreds,   loading: dropLoading }   = useMapsAutocomplete(dropFocus   ? drop   : "");

  useEffect(() => {
    getRideStops()
      .then(data => { if (data?.locations?.length) setPopularSpots(data.locations); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (rideType !== "school_shift") return;
    getSchoolRoutes()
      .then(data => { if (data?.routes?.length) setSchoolRoutes(data.routes); })
      .catch(() => {});
  }, [rideType]);

  useEffect(() => {
    Promise.all([
      getPaymentMethods(),
      fetch(`${apiBase}/rides/payment-methods`).then(r => r.json()).catch(() => null),
    ]).then(([legacyData, rideData]) => {
      const rideKeys = new Set((rideData?.methods || []).map((m: any) => m.key));
      if (legacyData?.methods?.length) {
        const filtered = legacyData.methods.filter((m: any) => rideKeys.has(m.id));
        if (filtered.length > 0) {
          setPayMethods(filtered);
          setPayMethod(filtered[0]!.id as "cash" | "wallet");
        }
      } else if (rideData?.methods?.length) {
        const mapped = rideData.methods.map((m: any) => ({ id: m.key, name: m.label }));
        setPayMethods(mapped);
        setPayMethod(mapped[0]!.id as "cash" | "wallet");
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    getRideServices()
      .then(data => {
        if (!data?.services?.length) return;
        setServices(data.services);
        setRideType(prev => data.services.find(s => s.key === prev) ? prev : data.services[0]!.key);
      })
      .catch(() => {});
  }, []);

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
        if (!cancelled) setEstimate(null);
      })
      .finally(() => { if (!cancelled) setEstimating(false); });
    return () => { cancelled = true; };
  }, [pickupObj?.lat, pickupObj?.lng, dropObj?.lat, dropObj?.lng, rideType]);

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

  const handleChip = (spot: PopularSpot) => {
    if (!pickupObj) {
      setPickup(spot.name);
      setPickupObj({ lat: spot.lat, lng: spot.lng, address: spot.name });
    } else if (!dropObj) {
      setDrop(spot.name);
      setDropObj({ lat: spot.lat, lng: spot.lng, address: spot.name });
    }
  };

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
      showToast(`${schoolStudent} has been subscribed to ${selectedRoute.schoolName}!`, "success");
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
        } catch {}
      })();
    } catch (err: any) {
      const errData = err?.response?.data || err?.data;
      if (errData?.activeRideId) {
        setBooked({ id: errData.activeRideId, type: rideType, status: errData.activeRideStatus });
        showToast("You have an active ride. Resuming tracking.", "info");
      } else {
        const msg = errData?.error || "Network error. Please try again.";
        showToast(msg, "error");
      }
    } finally { setBooking(false); }
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

  if (inMaintenance) {
    return (
      <View style={{ flex: 1, backgroundColor: C.background, justifyContent: "center", alignItems: "center", padding: 32 }}>
        <View style={{ backgroundColor: "#fff", borderRadius: 24, padding: 32, alignItems: "center", width: "100%", borderWidth: 1, borderColor: "#FEF3C7" }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "#FEF3C7", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
            <Ionicons name="construct-outline" size={32} color="#D97706" />
          </View>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 20, color: "#D97706", marginBottom: 8, textAlign: "center" }}>Under Maintenance</Text>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted, textAlign: "center", lineHeight: 20 }}>
            {config.content.maintenanceMsg}
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
        <View style={{ backgroundColor: "#fff", borderRadius: 24, padding: 32, alignItems: "center", width: "100%", borderWidth: 1, borderColor: "#FEE2E2" }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
            <Ionicons name="close-circle-outline" size={32} color="#EF4444" />
          </View>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 20, color: "#EF4444", marginBottom: 8, textAlign: "center" }}>Service Unavailable</Text>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted, textAlign: "center", lineHeight: 20, marginBottom: 20 }}>
            Ride service is currently unavailable. Please try again later.
          </Text>
          <Pressable style={{ width: "100%", alignItems: "center", backgroundColor: "#FEF2F2", borderRadius: 14, paddingVertical: 14 }} onPress={() => router.back()}>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: "#EF4444" }}>Back to Home</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const selectedSvc = services.find(s => s.key === rideType) ?? services[0];

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={{ backgroundColor: "#fff", paddingTop: topPad + 12, paddingHorizontal: 20, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <View style={rs.hdrRow}>
          <Pressable onPress={() => router.back()} style={rs.backBtn}>
            <Ionicons name="arrow-back" size={20} color={C.text} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 20, color: C.text }}>Book a Ride</Text>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, marginTop: 2 }}>Anywhere in AJK</Text>
          </View>
          <Pressable onPress={() => { setShowHistory(true); fetchHistory(); }} style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="time-outline" size={20} color={C.textSecondary} />
          </Pressable>
        </View>

        <View style={{ marginTop: 16, backgroundColor: C.surfaceSecondary, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border }}>
          <Pressable onPress={handleMyLocation} disabled={locLoading} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 4, marginBottom: 8 }}>
            {locLoading
              ? <ActivityIndicator size="small" color={C.primary} />
              : <Ionicons name="locate-outline" size={14} color={locDenied ? "#DC2626" : C.primary} />
            }
            <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: locDenied ? "#DC2626" : C.primary }}>
              {locLoading ? "Locating..." : locDenied ? "Location denied — tap to retry" : "Use my location"}
            </Text>
          </Pressable>
          {locDenied && (
            <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 4, paddingBottom: 6, gap: 6 }}>
              <Ionicons name="warning-outline" size={12} color="#DC2626" />
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "#DC2626", flex: 1 }}>
                Enable location in device settings or type pickup manually.
              </Text>
            </View>
          )}

          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#10B981" }} />
            <TextInput
              value={pickup}
              onChangeText={v => { setPickup(v); setPickupObj(null); }}
              onFocus={() => setPickupFocus(true)}
              onBlur={() => setTimeout(() => setPickupFocus(false), 250)}
              placeholder="Pickup location..."
              placeholderTextColor={C.textMuted}
              style={{ flex: 1, fontFamily: "Inter_400Regular", fontSize: 15, color: C.text, paddingVertical: 10 }}
            />
            {pickup.length > 0 && (
              <Pressable onPress={() => { setPickup(""); setPickupObj(null); }}>
                <Ionicons name="close-circle" size={16} color={C.textMuted} />
              </Pressable>
            )}
          </View>

          {pickupFocus && (
            <View style={rs.sugg}>
              {pickupLoading && <ActivityIndicator size="small" color={C.primary} style={{ padding: 8 }} />}
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

          <View style={{ flexDirection: "row", alignItems: "center", marginVertical: 4, gap: 8 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
            <Pressable onPress={() => {
              const t = pickup; const to = pickupObj;
              setPickup(drop); setPickupObj(dropObj);
              setDrop(t); setDropObj(to);
            }} style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border }}>
              <Ionicons name="swap-vertical" size={14} color={C.primary} />
            </Pressable>
            <View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#EF4444" }} />
            <TextInput
              value={drop}
              onChangeText={v => { setDrop(v); setDropObj(null); }}
              onFocus={() => setDropFocus(true)}
              onBlur={() => setTimeout(() => setDropFocus(false), 250)}
              placeholder="Drop-off location..."
              placeholderTextColor={C.textMuted}
              style={{ flex: 1, fontFamily: "Inter_400Regular", fontSize: 15, color: C.text, paddingVertical: 10 }}
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
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20 }}>
        {popularSpots.length > 0 && (
          <>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: C.text, marginBottom: 10 }}>Popular Locations</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16, marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
              {popularSpots.map(spot => (
                <Pressable key={spot.id} onPress={() => handleChip(spot)} style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fff", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: C.border }}>
                  <Text style={{ fontSize: 12 }}>{spot.icon || "📍"}</Text>
                  <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: C.text }}>{spot.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {rideType === "school_shift" && (
          <Pressable
            onPress={() => setShowSchoolModal(true)}
            style={{ marginBottom: 14, backgroundColor: "#EFF6FF", borderWidth: 1, borderColor: "#DBEAFE", borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 }}
          >
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: "#DBEAFE", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 22 }}>🚌</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: "#1D4ED8" }}>School Shift Subscribe</Text>
              <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: "#3B82F6", marginTop: 2 }}>Monthly school transport</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#3B82F6" />
          </Pressable>
        )}

        {rideCfg.surgeEnabled && (
          <View style={{ marginBottom: 14, backgroundColor: "#FFF7ED", borderWidth: 1, borderColor: "#FED7AA", borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#FFEDD5", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="flash" size={18} color="#EA580C" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#C2410C" }}>Surge Active x{rideCfg.surgeMultiplier}</Text>
              <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A3412" }}>Fares are {Math.round((rideCfg.surgeMultiplier - 1) * 100)}% higher</Text>
            </View>
          </View>
        )}

        <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: C.text, marginBottom: 10 }}>Service Type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, marginBottom: 16 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 10, flexDirection: "row" }}>
          {services.map((svc) => {
            const active = rideType === svc.key;
            const feats: string[] = [];
            if (svc.perKm > 0) feats.push(`Rs. ${svc.perKm}/km`);
            if (svc.maxPassengers > 1) feats.push(`${svc.maxPassengers} seats`);
            if (svc.allowBargaining) feats.push("Bargain OK");
            if (svc.description) feats.push(svc.description);
            return (
              <Pressable key={svc.key} onPress={() => setRideType(svc.key)}
                style={[{
                  width: 150, borderRadius: 18, padding: 16, borderWidth: 1.5,
                  borderColor: active ? (svc.color ?? C.primary) : C.border,
                  backgroundColor: active ? `${svc.color ?? C.primary}08` : "#fff",
                  overflow: "hidden",
                }]}>
                <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: active ? `${svc.color ?? C.primary}15` : C.surfaceSecondary, alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                  <Text style={{ fontSize: 28 }}>{svc.icon}</Text>
                </View>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: C.text }}>{svc.name}</Text>
                {svc.nameUrdu ? <Text style={{ fontSize: 11, color: C.textMuted, fontFamily: "Inter_400Regular" }}>{svc.nameUrdu}</Text> : null}
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, marginTop: 2 }}>From Rs. {svc.minFare}</Text>
                <View style={{ gap: 4, marginTop: 8 }}>
                  {feats.slice(0, 3).map(f => (
                    <View key={f} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                      <Ionicons name="checkmark-circle" size={11} color={active ? (svc.color ?? C.primary) : C.textMuted} />
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textSecondary }} numberOfLines={1}>{f}</Text>
                    </View>
                  ))}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        {estimating && (
          <View style={{ borderRadius: 18, backgroundColor: "#fff", borderWidth: 1, borderColor: C.border, alignItems: "center", padding: 20, marginBottom: 14 }}>
            <ActivityIndicator color={C.primary} />
            <Text style={{ marginTop: 8, fontSize: 12, color: C.textMuted, fontFamily: "Inter_400Regular" }}>Calculating route...</Text>
          </View>
        )}
        {!estimating && estimate && (
          <View style={{ borderRadius: 18, overflow: "hidden", marginBottom: 14, borderWidth: 1, borderColor: C.border, backgroundColor: "#fff" }}>
            <View style={{ padding: 18 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: C.text }}>Fare Estimate</Text>
                <Pressable onPress={() => {
                  if (pickupObj && dropObj) {
                    const url = `https://www.google.com/maps/dir/?api=1&origin=${pickupObj.lat},${pickupObj.lng}&destination=${dropObj.lat},${dropObj.lng}&travelmode=${rideType === "bike" || rideType === "rickshaw" ? "bicycling" : "driving"}`;
                    Linking.openURL(url);
                  }
                }} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#EFF6FF", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 }}>
                  <Ionicons name="navigate-outline" size={12} color="#4285F4" />
                  <Text style={{ fontSize: 11, color: "#4285F4", fontFamily: "Inter_600SemiBold" }}>Route</Text>
                </Pressable>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted }}>Distance</Text>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: C.text, marginTop: 3 }}>{estimate.dist} km</Text>
                </View>
                <View style={{ width: 1, height: 36, backgroundColor: C.border }} />
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted }}>Duration</Text>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: C.text, marginTop: 3 }}>{estimate.dur}</Text>
                </View>
                <View style={{ width: 1, height: 36, backgroundColor: C.border }} />
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted }}>Total</Text>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 20, color: C.success, marginTop: 3 }}>Rs. {estimate.fare}</Text>
                </View>
              </View>
              {estimate.gstAmount > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border }}>
                  <Text style={{ fontSize: 11, color: C.textMuted }}>Base fare: Rs. {estimate.baseFare}</Text>
                  <Text style={{ fontSize: 11, color: C.textMuted }}>GST: Rs. {estimate.gstAmount}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {!estimating && estimate?.bargainEnabled && (
          <View style={{ marginBottom: 14 }}>
            <Pressable
              onPress={() => { setShowBargain(v => !v); setOfferedFare(""); setBargainNote(""); }}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: showBargain ? "#FFF7ED" : "#fff", borderWidth: 1.5, borderColor: showBargain ? "#FB923C" : C.border, borderRadius: 16, padding: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: showBargain ? "#FFEDD5" : C.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="chatbubble-ellipses-outline" size={20} color={showBargain ? "#EA580C" : C.textSecondary} />
                </View>
                <View>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: showBargain ? "#C2410C" : C.text }}>
                    {showBargain ? "Bargaining ON" : "Make an Offer"}
                  </Text>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: showBargain ? "#EA580C" : C.textMuted }}>
                    {showBargain ? `Min: Rs. ${estimate.minOffer}` : `Suggest your price (min Rs. ${estimate.minOffer})`}
                  </Text>
                </View>
              </View>
              <Ionicons name={showBargain ? "chevron-up" : "chevron-down"} size={18} color={showBargain ? "#EA580C" : C.textMuted} />
            </Pressable>

            {showBargain && (
              <View style={{ backgroundColor: "#FFF7ED", borderWidth: 1, borderColor: "#FED7AA", borderTopWidth: 0, borderBottomLeftRadius: 16, borderBottomRightRadius: 16, padding: 16, gap: 12 }}>
                <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: "#92400E" }}>
                  Platform fare: Rs. {estimate.fare} · Min: Rs. {estimate.minOffer}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#FB923C", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 4 }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: C.textSecondary, marginRight: 4 }}>Rs.</Text>
                  <TextInput
                    value={offeredFare}
                    onChangeText={setOfferedFare}
                    keyboardType="numeric"
                    placeholder={String(estimate.minOffer)}
                    placeholderTextColor="#D1D5DB"
                    style={{ flex: 1, fontFamily: "Inter_700Bold", fontSize: 20, color: C.text, paddingVertical: 10 }}
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
                  placeholder="Note (optional)"
                  placeholderTextColor="#D1D5DB"
                  style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: "#FED7AA", borderRadius: 12, padding: 12, fontFamily: "Inter_400Regular", fontSize: 13, color: C.text }}
                />
                <Text style={{ fontSize: 11, color: "#9A3412", lineHeight: 16, fontFamily: "Inter_400Regular" }}>
                  The rider can accept, counter, or reject your offer.
                </Text>
              </View>
            )}
          </View>
        )}

        <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: C.text, marginBottom: 10 }}>Payment</Text>
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
          {payMethods.map(pm => {
            const pmId = pm.id as "cash" | "wallet";
            const active = payMethod === pmId;
            const isWallet = pmId === "wallet";
            const isCash   = pmId === "cash";
            const insufficient = isWallet && estimate && (user?.walletBalance ?? 0) < estimate.fare;
            return (
              <Pressable key={pmId} onPress={() => setPayMethod(pmId)} style={{
                flex: 1, alignItems: "center", padding: 16, borderRadius: 16,
                borderWidth: 1.5, borderColor: active ? (isWallet ? C.primary : C.success) : C.border,
                backgroundColor: active ? (isWallet ? `${C.primary}08` : `${C.success}08`) : "#fff",
                gap: 6,
              }}>
                <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: active ? (isWallet ? "#DBEAFE" : "#D1FAE5") : C.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={isCash ? "cash-outline" : "wallet-outline"} size={22} color={active ? (isWallet ? C.primary : C.success) : C.textSecondary} />
                </View>
                <Text style={{ fontFamily: active ? "Inter_700Bold" : "Inter_600SemiBold", fontSize: 13, color: active ? C.text : C.textSecondary }}>
                  {isCash ? "Cash" : "Wallet"}
                </Text>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: insufficient ? C.danger : C.textMuted }}>
                  {isCash ? "Pay on arrival" : `Rs. ${(user?.walletBalance ?? 0).toLocaleString()}`}
                </Text>
                {active && <View style={{ position: "absolute", top: 8, right: 8, width: 20, height: 20, borderRadius: 10, backgroundColor: isWallet ? C.primary : C.success, alignItems: "center", justifyContent: "center" }}><Ionicons name="checkmark" size={12} color="#fff" /></View>}
              </Pressable>
            );
          })}
        </View>

        <View style={{ marginBottom: 14, backgroundColor: C.surfaceSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Ionicons name="information-circle-outline" size={15} color={C.textMuted} />
          <Text style={{ fontSize: 11, color: C.textSecondary, flex: 1, fontFamily: "Inter_400Regular" }}>
            Rs. {rideCfg.cancellationFee} fee applies if you cancel after driver accepts.
          </Text>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 18, backgroundColor: "#F0FDF4", padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "#D1FAE5" }}>
          <Ionicons name="shield-checkmark-outline" size={15} color="#059669" />
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#065F46" }}>All rides insured · Verified drivers · GPS tracked</Text>
        </View>

        <Pressable onPress={handleBook} disabled={booking || !estimate} style={[{
          flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
          backgroundColor: showBargain && offeredFare ? "#EA580C" : C.primary,
          borderRadius: 16, paddingVertical: 18, opacity: (booking || !estimate) ? 0.6 : 1,
        }]}>
          {booking ? <ActivityIndicator color="#fff" /> : (
            <>
              {showBargain && offeredFare
                ? <Ionicons name="chatbubble-ellipses" size={20} color="#fff" />
                : <Text style={{ fontSize: 20 }}>{selectedSvc?.icon ?? "🚗"}</Text>
              }
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" }}>
                {showBargain && offeredFare
                  ? `Send Offer · Rs. ${offeredFare}`
                  : `Book ${selectedSvc?.name ?? rideType}${estimate ? ` · Rs. ${estimate.fare}` : ""}`}
              </Text>
            </>
          )}
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={showHistory} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowHistory(false)}>
        <View style={{ flex: 1, backgroundColor: C.background }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border }}>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 18, color: C.text }}>Ride History</Text>
            <Pressable onPress={() => setShowHistory(false)} style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="close" size={18} color={C.text} />
            </Pressable>
          </View>
          {histLoading ? (
            <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
          ) : history.length === 0 ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="car-outline" size={30} color={C.textMuted} />
              </View>
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 15, color: C.text }}>No rides yet</Text>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted }}>Your ride history will appear here</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }}>
              {history.map((ride, i) => (
                <View key={ride.id || i} style={{ backgroundColor: "#fff", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border, flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 20 }}>
                      {services.find(s => s.key === ride.type)?.icon ?? (ride.type === "bike" ? "🏍️" : ride.type === "car" ? "🚗" : ride.type === "rickshaw" ? "🛺" : ride.type === "daba" ? "🚐" : "🚗")}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: C.text }} numberOfLines={1}>{ride.pickupAddress} → {ride.dropAddress}</Text>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginTop: 3 }}>{ride.distance} km · {new Date(ride.createdAt).toLocaleDateString("en-PK", { day: "numeric", month: "short" })}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: C.text }}>Rs. {ride.fare}</Text>
                    <View style={{ backgroundColor: ride.status === "completed" ? "#D1FAE5" : ride.status === "cancelled" ? "#FEE2E2" : "#FEF3C7", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                      <Text style={{ fontFamily: "Inter_500Medium", fontSize: 10, color: ride.status === "completed" ? "#059669" : ride.status === "cancelled" ? "#DC2626" : "#D97706" }}>
                        {{ searching: "Finding", bargaining: "Negotiating", accepted: "Accepted", arrived: "Arrived", in_transit: "In Transit", completed: "Done", cancelled: "Cancelled", ongoing: "In Transit", no_riders: "No Riders" }[ride.status as string] ?? ride.status}
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

      <Modal visible={showSchoolModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowSchoolModal(false)}>
        <View style={{ flex: 1, backgroundColor: C.background }}>
          <View style={{ flexDirection: "row", alignItems: "center", padding: 20, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border }}>
            <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", flex: 1, color: C.text }}>School Shift Subscribe</Text>
            <Pressable onPress={() => setShowSchoolModal(false)} style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="close" size={18} color={C.text} />
            </Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 14 }}>
            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.text, marginBottom: 4 }}>Select a Route</Text>
            {schoolRoutes.length === 0 ? (
              <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 24, alignItems: "center", borderWidth: 1, borderColor: C.border }}>
                <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                  <Text style={{ fontSize: 24 }}>🚌</Text>
                </View>
                <Text style={{ fontFamily: "Inter_600SemiBold", color: C.textSecondary }}>No routes available</Text>
                <Text style={{ fontSize: 12, color: C.textMuted, marginTop: 4, textAlign: "center" }}>Contact admin to add school shift routes</Text>
              </View>
            ) : (
              schoolRoutes.map((r: any) => (
                <Pressable key={r.id} onPress={() => setSelectedRoute(r)}
                  style={{ borderWidth: 1.5, borderColor: selectedRoute?.id === r.id ? C.primary : C.border, borderRadius: 16, padding: 16, backgroundColor: selectedRoute?.id === r.id ? `${C.primary}06` : "#fff" }}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                    <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: "#DBEAFE", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 22 }}>🚌</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: C.text }}>{r.routeName}</Text>
                      <Text style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>{r.schoolName}</Text>
                      {r.schoolNameUrdu ? <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 1 }} allowFontScaling={false}>{r.schoolNameUrdu}</Text> : null}
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        <View style={{ backgroundColor: "#D1FAE5", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#16A34A" }}>Rs. {r.monthlyPrice?.toLocaleString()}/mo</Text>
                        </View>
                        <View style={{ backgroundColor: C.surfaceSecondary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <Text style={{ fontSize: 11, color: C.textSecondary }}>AM {r.morningTime}</Text>
                        </View>
                        {r.afternoonTime ? <View style={{ backgroundColor: C.surfaceSecondary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ fontSize: 11, color: C.textSecondary }}>PM {r.afternoonTime}</Text></View> : null}
                        <View style={{ backgroundColor: C.surfaceSecondary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <Text style={{ fontSize: 11, color: C.textSecondary }}>{r.enrolledCount}/{r.capacity} seats</Text>
                        </View>
                      </View>
                      <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>{r.fromArea} → {r.toAddress}</Text>
                    </View>
                    {selectedRoute?.id === r.id && <Ionicons name="checkmark-circle" size={22} color={C.primary} />}
                  </View>
                </Pressable>
              ))
            )}

            {selectedRoute && (
              <>
                <View style={{ height: 1, backgroundColor: C.border }} />
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.text }}>Student Details</Text>
                <View style={{ gap: 12 }}>
                  <View>
                    <Text style={{ fontSize: 12, color: C.textSecondary, marginBottom: 6, fontFamily: "Inter_500Medium" }}>Student Name *</Text>
                    <View style={{ borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fff" }}>
                      <TextInput
                        value={schoolStudent}
                        onChangeText={setSchoolStudent}
                        placeholder="e.g. Ali Khan"
                        style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: C.text }}
                        placeholderTextColor={C.textMuted}
                      />
                    </View>
                  </View>
                  <View>
                    <Text style={{ fontSize: 12, color: C.textSecondary, marginBottom: 6, fontFamily: "Inter_500Medium" }}>Class / Grade *</Text>
                    <View style={{ borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fff" }}>
                      <TextInput
                        value={schoolClass}
                        onChangeText={setSchoolClass}
                        placeholder="e.g. 7th Grade"
                        style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: C.text }}
                        placeholderTextColor={C.textMuted}
                      />
                    </View>
                  </View>
                </View>
                <View style={{ backgroundColor: "#FEF3C7", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#FDE68A", marginTop: 4 }}>
                  <Text style={{ fontSize: 12, color: "#92400E", fontFamily: "Inter_500Medium" }}>
                    First month: Rs. {selectedRoute.monthlyPrice?.toLocaleString()} — {payMethod === "wallet" ? "From wallet" : "Cash on pickup"}
                  </Text>
                </View>
                <Pressable onPress={handleSchoolSubscribe} disabled={subscribing}
                  style={{ backgroundColor: subscribing ? "#93C5FD" : C.primary, borderRadius: 16, padding: 16, alignItems: "center", marginTop: 8, opacity: subscribing ? 0.7 : 1 }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff" }}>
                    {subscribing ? "Subscribing..." : `Subscribe · Rs. ${selectedRoute.monthlyPrice?.toLocaleString()}/mo`}
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

const rs = StyleSheet.create({
  hdrRow: { flexDirection: "row", alignItems: "center" },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  sugg: { backgroundColor: "#fff", borderRadius: 12, marginTop: 6, borderWidth: 1, borderColor: C.border, maxHeight: 200 },
  suggRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  suggTxt: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.text },
  suggSub: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginTop: 1 },
});
