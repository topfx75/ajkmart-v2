import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  TouchableOpacity,
  ScrollView,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useToast } from "@/context/ToastContext";
import { CancelModal } from "@/components/CancelModal";
import type { CancelTarget } from "@/components/CancelModal";
import {
  acceptRideBid as acceptRideBidApi,
  customerCounterOffer as customerCounterOfferApi,
} from "@workspace/api-client-react";

interface RideBid {
  id: string;
  riderId: string;
  riderName?: string;
  fare: number;
  offer?: number;
  status?: string;
  createdAt?: string;
  ratingAvg?: number | null;
  totalRides?: number;
  vehiclePlate?: string | null;
  vehicleType?: string | null;
  note?: string | null;
}

interface NegotiationRide {
  id: string;
  status: string;
  fare?: number;
  offeredFare?: number;
  minOffer?: number;
  paymentMethod?: string;
  bids?: RideBid[];
  riderId?: string;
  riderName?: string;
  pickupAddress?: string;
  dropAddress?: string;
}

type NegotiationScreenProps = {
  rideId: string;
  ride: NegotiationRide | null;
  setRide: (updater: (r: NegotiationRide | null) => NegotiationRide | null) => void;
  elapsed: number;
  cancellationFee: number;
  token: string | null;
  broadcastTimeoutSec?: number;
  estimatedFare?: number;
  minOffer?: number;
};

export function NegotiationScreen({
  rideId,
  ride,
  setRide,
  elapsed,
  cancellationFee,
  token,
  broadcastTimeoutSec = 300,
  estimatedFare,
  minOffer: minOfferProp,
}: NegotiationScreenProps) {
  const colorScheme = useColorScheme();
  const C = colorScheme === "dark" ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const { showToast } = useToast();

  const ring1 = useRef(new Animated.Value(1)).current;
  const ring2 = useRef(new Animated.Value(1)).current;
  const ring3 = useRef(new Animated.Value(1)).current;
  const ring1Op = useRef(new Animated.Value(0.55)).current;
  const ring2Op = useRef(new Animated.Value(0.38)).current;
  const ring3Op = useRef(new Animated.Value(0.22)).current;

  const livePulse = useRef(new Animated.Value(1)).current;
  const livePulseOp = useRef(new Animated.Value(1)).current;

  const updateOfferSlide = useRef(new Animated.Value(0)).current;

  const [updateOfferInput, setUpdateOfferInput] = useState("");
  const [updateOfferLoading, setUpdateOfferLoading] = useState(false);
  const [showUpdateOffer, setShowUpdateOffer] = useState(false);
  const [acceptBidId, setAcceptBidId] = useState<string | null>(null);
  const [cancelModalTarget, setCancelModalTarget] =
    useState<CancelTarget | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [offerError, setOfferError] = useState("");
  const [connectionLost, setConnectionLost] = useState(false);
  const consecutiveFailsRef = useRef(0);

  const rideApiBase = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

  useEffect(() => {
    const pulse = (
      scale: Animated.Value,
      op: Animated.Value,
      d: number,
      resetOp: number,
    ) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(d),
          Animated.parallel([
            Animated.timing(scale, {
              toValue: 1.55,
              duration: 1300,
              useNativeDriver: true,
            }),
            Animated.timing(op, {
              toValue: 0,
              duration: 1300,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(scale, {
              toValue: 1,
              duration: 0,
              useNativeDriver: true,
            }),
            Animated.timing(op, {
              toValue: resetOp,
              duration: 0,
              useNativeDriver: true,
            }),
          ]),
        ]),
      );
    const a1 = pulse(ring1, ring1Op, 0, 0.55);
    const a2 = pulse(ring2, ring2Op, 350, 0.38);
    const a3 = pulse(ring3, ring3Op, 700, 0.22);
    a1.start();
    a2.start();
    a3.start();
    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, []);

  useEffect(() => {
    const livePulseAnim = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(livePulse, { toValue: 1.4, duration: 600, useNativeDriver: true }),
          Animated.timing(livePulseOp, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(livePulse, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(livePulseOp, { toValue: 1, duration: 600, useNativeDriver: true }),
        ]),
      ]),
    );
    livePulseAnim.start();
    return () => livePulseAnim.stop();
  }, []);

  useEffect(() => {
    Animated.timing(updateOfferSlide, {
      toValue: showUpdateOffer ? 1 : 0,
      duration: 280,
      useNativeDriver: false,
    }).start();
  }, [showUpdateOffer]);

  useEffect(() => {
    const HEARTBEAT_MS = 15000;
    const FAIL_THRESHOLD = 2;
    const interval = setInterval(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(`${rideApiBase}/rides/${rideId}`, {
          method: "GET",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          consecutiveFailsRef.current = 0;
          setConnectionLost(false);
        } else {
          consecutiveFailsRef.current++;
        }
      } catch {
        clearTimeout(timeout);
        consecutiveFailsRef.current++;
      }
      if (consecutiveFailsRef.current >= FAIL_THRESHOLD) {
        setConnectionLost(true);
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, [rideId, token, rideApiBase]);

  const offeredFare = ride?.offeredFare ?? 0;
  const bids: RideBid[] = ride?.bids ?? [];
  const sortedBids = [...bids].sort((a, b) => a.fare - b.fare);
  const hasBids = bids.length > 0;
  const elapsedStr =
    elapsed < 60
      ? `${elapsed}s`
      : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

  const remaining = Math.max(0, broadcastTimeoutSec - elapsed);
  const remainingMin = Math.floor(remaining / 60);
  const remainingSec = remaining % 60;
  const timerStr = `${remainingMin}:${String(remainingSec).padStart(2, "0")}`;
  const timerPct = broadcastTimeoutSec > 0 ? remaining / broadcastTimeoutSec : 1;
  const timerUrgent = timerPct < 0.2;

  const serverMinOffer = ride?.minOffer ?? minOfferProp;
  const minCounterOffer = serverMinOffer
    ? Math.ceil(serverMinOffer)
    : estimatedFare
      ? Math.ceil(estimatedFare * 0.7)
      : Math.ceil(offeredFare * 0.7);

  const validateOffer = (val: string): string => {
    const amt = parseFloat(val);
    if (isNaN(amt) || amt <= 0) return "Please enter a valid amount";
    if (amt < minCounterOffer)
      return `Minimum offer is Rs. ${minCounterOffer}`;
    return "";
  };

  const acceptBid = async (bidId: string) => {
    setAcceptBidId(bidId);
    try {
      const d = await acceptRideBidApi(rideId, { bidId });
      setRide(() => d as unknown as NegotiationRide);
    } catch (e: any) {
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        "Could not accept bid. Please try again.";
      showToast(msg, "error");
    }
    setAcceptBidId(null);
  };

  const sendUpdateOffer = async () => {
    const err = validateOffer(updateOfferInput);
    if (err) {
      setOfferError(err);
      showToast(err, "error");
      return;
    }
    const amt = parseFloat(updateOfferInput);
    setUpdateOfferLoading(true);
    setOfferError("");
    try {
      const d = await customerCounterOfferApi(rideId, { offeredFare: amt });
      setRide(() => d as unknown as NegotiationRide);
      setUpdateOfferInput("");
      setShowUpdateOffer(false);
    } catch (e: any) {
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        "Could not update offer. Please try again.";
      showToast(msg, "error");
    }
    setUpdateOfferLoading(false);
  };

  const openUnifiedCancelModal = () => {
    const riderAssigned = [
      "accepted",
      "arrived",
      "in_transit",
    ].includes(ride?.status || "");
    setCancelModalTarget({
      id: rideId,
      type: "ride",
      status: ride?.status || "bargaining",
      fare: ride?.fare,
      paymentMethod: ride?.paymentMethod,
      riderAssigned,
    });
  };

  const updateOfferMaxHeight = updateOfferSlide.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 220],
  });
  const updateOfferOpacity = updateOfferSlide.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 0.5, 1],
  });

  const isDark = colorScheme === "dark";
  const headerGradient: [string, string] = isDark
    ? ["#1A2744", "#0F172A"]
    : ["#1E3A5F", "#132847"];
  const cardBg = isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.12)";
  const cardBgBest = isDark ? "rgba(16,185,129,0.14)" : "rgba(16,185,129,0.16)";
  const cardBorder = isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.2)";
  const textPrimary = "#FFFFFF";
  const textSecondary = isDark ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.75)";
  const textMuted = isDark ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.55)";

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <LinearGradient
        colors={headerGradient}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
        }}
      />

      {/* Header */}
      <View
        style={{
          paddingTop: topPad + 16,
          paddingHorizontal: 20,
          paddingBottom: 14,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
          >
            <TouchableOpacity activeOpacity={0.7}
              onPress={() => router.push("/(tabs)")}
              hitSlop={8}
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                backgroundColor: "rgba(255,255,255,0.1)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="chevron-back" size={20} color="#fff" />
            </TouchableOpacity>
            <View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text
                  style={{
                    fontFamily: "Inter_700Bold",
                    fontSize: 18,
                    color: textPrimary,
                  }}
                >
                  Live Negotiation
                </Text>
                {/* LIVE badge */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(16,185,129,0.18)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: "rgba(16,185,129,0.35)" }}>
                  <Animated.View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#10B981", transform: [{ scale: livePulse }], opacity: livePulseOp }} />
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 9, color: "#10B981", letterSpacing: 0.8 }}>LIVE</Text>
                </View>
              </View>
              <Text
                style={{
                  fontFamily: "Inter_400Regular",
                  fontSize: 12,
                  color: textSecondary,
                  marginTop: 2,
                }}
              >
                #{rideId.slice(-8).toUpperCase()} · {elapsedStr}
              </Text>
            </View>
          </View>
          {/* Offer pill */}
          <View
            style={{
              backgroundColor: "rgba(251,191,36,0.15)",
              borderRadius: 14,
              paddingHorizontal: 16,
              paddingVertical: 10,
              alignItems: "center",
              borderWidth: 1,
              borderColor: "rgba(251,191,36,0.3)",
            }}
          >
            <Text
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 20,
                color: "#FCD34D",
              }}
            >
              Rs. {offeredFare}
            </Text>
            <Text
              style={{
                fontFamily: "Inter_400Regular",
                fontSize: 10,
                color: "rgba(251,191,36,0.7)",
              }}
            >
              Your Offer
            </Text>
          </View>
        </View>
      </View>

      {/* Timer bar */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 20,
          paddingBottom: 10,
          gap: 10,
        }}
      >
        <Ionicons
          name="timer-outline"
          size={16}
          color={timerUrgent ? "#EF4444" : "rgba(255,255,255,0.6)"}
        />
        <View
          style={{
            flex: 1,
            height: 4,
            backgroundColor: "rgba(255,255,255,0.1)",
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              height: 4,
              borderRadius: 2,
              width: `${Math.max(timerPct * 100, 0)}%`,
              backgroundColor: timerUrgent ? "#EF4444" : "#FCD34D",
            }}
          />
        </View>
        {/* Timer pill */}
        <View style={{
          backgroundColor: timerUrgent ? "rgba(239,68,68,0.2)" : "rgba(252,211,77,0.15)",
          borderRadius: 10,
          paddingHorizontal: 10,
          paddingVertical: 3,
          borderWidth: 1,
          borderColor: timerUrgent ? "rgba(239,68,68,0.35)" : "rgba(252,211,77,0.3)",
        }}>
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 13,
              color: timerUrgent ? "#EF4444" : "#FCD34D",
              minWidth: 36,
              textAlign: "center",
            }}
          >
            {timerStr}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: 140,
          gap: 14,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Broadcast waiting / no bids */}
        {!hasBids && (
          <View style={{ alignItems: "center", paddingVertical: 48 }}>
            <View
              style={{
                width: 180,
                height: 180,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <Animated.View
                style={{
                  position: "absolute",
                  width: 180,
                  height: 180,
                  borderRadius: 90,
                  backgroundColor: "rgba(251,191,36,0.05)",
                  transform: [{ scale: ring3 }],
                  opacity: ring3Op,
                }}
              />
              <Animated.View
                style={{
                  position: "absolute",
                  width: 130,
                  height: 130,
                  borderRadius: 65,
                  backgroundColor: "rgba(251,191,36,0.09)",
                  transform: [{ scale: ring2 }],
                  opacity: ring2Op,
                }}
              />
              <Animated.View
                style={{
                  position: "absolute",
                  width: 90,
                  height: 90,
                  borderRadius: 45,
                  backgroundColor: "rgba(251,191,36,0.15)",
                  transform: [{ scale: ring1 }],
                  opacity: ring1Op,
                }}
              />
              {/* Center icon */}
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  backgroundColor: "rgba(251,191,36,0.25)",
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 2,
                  borderColor: "rgba(251,191,36,0.4)",
                }}
              >
                <Ionicons name="chatbubbles" size={30} color="#FCD34D" />
              </View>
            </View>
            <Text
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 20,
                color: "#fff",
                textAlign: "center",
              }}
            >
              Waiting for Riders
            </Text>
            <Text
              style={{
                fontFamily: "Inter_400Regular",
                fontSize: 13,
                color: "rgba(255,255,255,0.5)",
                textAlign: "center",
                marginTop: 8,
                lineHeight: 20,
                maxWidth: 260,
              }}
            >
              Riders are reviewing your offer. You'll see bids appear here.
            </Text>

            {/* Broadcast elapsed timer pill */}
            <View style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              backgroundColor: "rgba(255,255,255,0.07)",
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 7,
              marginTop: 14,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.1)",
            }}>
              <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#FCD34D" }} />
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
                Broadcasting · {elapsedStr}
              </Text>
            </View>

            {connectionLost && (
              <View style={{
                flexDirection: "row", alignItems: "center", gap: 8,
                backgroundColor: "rgba(239,68,68,0.15)", borderRadius: 12,
                paddingHorizontal: 14, paddingVertical: 8, marginTop: 12,
                borderWidth: 1, borderColor: "rgba(239,68,68,0.25)",
              }}>
                <Ionicons name="cloud-offline-outline" size={16} color="#EF4444" />
                <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: "#FCA5A5" }}>
                  Connection lost — tap below to reconnect
                </Text>
              </View>
            )}
            {(remaining <= 0 || connectionLost) && (
              <TouchableOpacity activeOpacity={0.7}
                onPress={async () => {
                  try {
                    const res = await fetch(`${rideApiBase}/rides/${rideId}/retry`, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                      },
                    });
                    if (res.ok) {
                      setConnectionLost(false);
                      showToast("Searching for more riders...", "success");
                    } else {
                      showToast("Could not refresh. Please try again.", "error");
                    }
                  } catch {
                    setConnectionLost(true);
                    showToast("Connection issue. Please try again.", "error");
                  }
                }}
                style={{
                  marginTop: 12,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  backgroundColor: "rgba(251,191,36,0.2)",
                  borderRadius: 14,
                  paddingHorizontal: 20,
                  paddingVertical: 12,
                  borderWidth: 1,
                  borderColor: "rgba(251,191,36,0.3)",
                }}
              >
                <Ionicons name="refresh-outline" size={18} color="#FCD34D" />
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#FCD34D" }}>
                  {connectionLost ? "Reconnect & Search Again" : "Refresh & Search Again"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Bids */}
        {hasBids && (
          <>
            {/* Bids header */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                marginBottom: 4,
              }}
            >
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: "#10B981",
                }}
              />
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 13,
                  color: "rgba(255,255,255,0.7)",
                }}
              >
                {bids.length} Bid{bids.length > 1 ? "s" : ""} Received
              </Text>
            </View>

            {sortedBids.map((bid: RideBid, bidIndex: number) => {
              const isAccepting = acceptBidId === bid.id;
              const isBestOffer = bidIndex === 0;
              return (
                <View
                  key={bid.id}
                  style={{
                    borderRadius: 20,
                    overflow: "hidden",
                    borderWidth: isBestOffer ? 1.5 : 1,
                    borderColor: isBestOffer ? "rgba(16,185,129,0.45)" : cardBorder,
                  }}
                >
                  <LinearGradient
                    colors={isBestOffer ? [cardBgBest, "rgba(255,255,255,0.04)"] : [cardBg, "rgba(255,255,255,0.03)"]}
                    style={{ padding: 18 }}
                  >
                    {isBestOffer && (
                      <View style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 5,
                        marginBottom: 10,
                      }}>
                        <Ionicons name="ribbon" size={12} color="#10B981" />
                        <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 10, color: "#10B981", letterSpacing: 0.5 }}>
                          BEST OFFER
                        </Text>
                      </View>
                    )}

                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        marginBottom: 14,
                      }}
                    >
                      {/* Avatar circle */}
                      <View style={{ position: "relative" }}>
                        <View
                          style={{
                            width: 52,
                            height: 52,
                            borderRadius: 26,
                            backgroundColor: isBestOffer ? "rgba(16,185,129,0.2)" : "rgba(251,191,36,0.15)",
                            alignItems: "center",
                            justifyContent: "center",
                            borderWidth: 2,
                            borderColor: isBestOffer ? "rgba(16,185,129,0.5)" : "rgba(251,191,36,0.3)",
                          }}
                        >
                          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 20, color: isBestOffer ? "#10B981" : "#FCD34D" }}>
                            {(bid.riderName ?? "R").charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        {/* Online dot */}
                        <View style={{
                          position: "absolute",
                          bottom: 0,
                          right: 0,
                          width: 14,
                          height: 14,
                          borderRadius: 7,
                          backgroundColor: "#10B981",
                          borderWidth: 2,
                          borderColor: "#0F172A",
                        }} />
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            fontFamily: "Inter_700Bold",
                            fontSize: 16,
                            color: textPrimary,
                          }}
                        >
                          {bid.riderName}
                        </Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                          {bid.ratingAvg != null && (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(245,158,11,0.15)", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 }}>
                              <Ionicons name="star" size={11} color="#F59E0B" />
                              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 11, color: "#FCD34D" }}>
                                {bid.ratingAvg.toFixed(1)}
                              </Text>
                              {(bid.totalRides ?? 0) > 0 && (
                                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: textMuted }}>
                                  · {bid.totalRides}
                                </Text>
                              )}
                            </View>
                          )}
                          {bid.vehiclePlate && (
                            <View style={{ backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: cardBorder }}>
                              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 10, color: "rgba(255,255,255,0.75)", letterSpacing: 1 }}>
                                {bid.vehiclePlate}
                              </Text>
                            </View>
                          )}
                          {bid.vehicleType && (
                            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: textMuted }}>
                              {bid.vehicleType}
                            </Text>
                          )}
                        </View>
                        {bid.note ? (
                          <Text
                            style={{
                              fontFamily: "Inter_400Regular",
                              fontSize: 12,
                              color: textSecondary,
                              marginTop: 4,
                              fontStyle: "italic",
                            }}
                          >
                            "{bid.note}"
                          </Text>
                        ) : null}
                        {bid.ratingAvg == null && bid.totalRides === 0 && (
                          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: textMuted, marginTop: 2 }}>
                            New rider
                          </Text>
                        )}
                      </View>

                      {/* Fare badge */}
                      <View style={{ alignItems: "flex-end" }}>
                        <View style={{
                          backgroundColor: "rgba(252,211,77,0.15)",
                          borderRadius: 12,
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderWidth: 1,
                          borderColor: "rgba(252,211,77,0.3)",
                          marginBottom: 4,
                        }}>
                          <Text
                            style={{
                              fontFamily: "Inter_700Bold",
                              fontSize: 20,
                              color: "#FCD34D",
                            }}
                          >
                            Rs. {Math.round(bid.fare)}
                          </Text>
                        </View>
                        <Text
                          style={{
                            fontFamily: "Inter_400Regular",
                            fontSize: 10,
                            color: bid.fare <= offeredFare ? "#10B981" : "rgba(255,255,255,0.4)",
                            textAlign: "right",
                          }}
                        >
                          {bid.fare === offeredFare
                            ? "Matches offer"
                            : bid.fare > offeredFare
                              ? `+Rs. ${Math.round(bid.fare - offeredFare)}`
                              : `-Rs. ${Math.round(offeredFare - bid.fare)} saved`}
                        </Text>
                      </View>
                    </View>

                    {/* Accept + Counter button row */}
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      {/* Accept */}
                      <TouchableOpacity activeOpacity={0.7}
                        onPress={() => acceptBid(bid.id)}
                        disabled={acceptBidId !== null}
                        style={{ flex: 3, opacity: acceptBidId !== null ? 0.6 : 1 }}
                      >
                        <LinearGradient
                          colors={["#10B981", "#059669"]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={{
                            borderRadius: 14,
                            paddingVertical: 14,
                            alignItems: "center",
                            flexDirection: "row",
                            justifyContent: "center",
                            gap: 6,
                          }}
                        >
                          {isAccepting ? (
                            <ActivityIndicator color="#fff" size="small" />
                          ) : (
                            <>
                              <Ionicons name="checkmark-circle" size={16} color="#fff" />
                              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: "#fff" }}>
                                Accept · Rs. {Math.round(bid.fare)}
                              </Text>
                            </>
                          )}
                        </LinearGradient>
                      </TouchableOpacity>

                      {/* Counter */}
                      <TouchableOpacity activeOpacity={0.7}
                        onPress={() => {
                          setUpdateOfferInput(String(Math.round(bid.fare)));
                          setShowUpdateOffer(true);
                        }}
                        disabled={acceptBidId !== null}
                        style={{
                          flex: 2,
                          borderRadius: 14,
                          paddingVertical: 14,
                          alignItems: "center",
                          justifyContent: "center",
                          flexDirection: "row",
                          gap: 6,
                          borderWidth: 1.5,
                          borderColor: "rgba(251,191,36,0.55)",
                          backgroundColor: "rgba(251,191,36,0.08)",
                          opacity: acceptBidId !== null ? 0.5 : 1,
                        }}
                      >
                        <Ionicons name="swap-horizontal" size={14} color="#FCD34D" />
                        <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#FCD34D" }}>
                          Counter
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </LinearGradient>
                </View>
              );
            })}
          </>
        )}

        {/* Counter-offer panel — animated slide-up */}
        <View
          style={{
            borderRadius: 18,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: cardBorder,
          }}
        >
          <LinearGradient
            colors={[cardBg, "rgba(255,255,255,0.03)"]}
            style={{ overflow: "hidden" }}
          >
            <TouchableOpacity activeOpacity={0.7}
              onPress={() => {
                setShowUpdateOffer((v) => !v);
                setOfferError("");
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                padding: 16,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <View style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  backgroundColor: "rgba(251,191,36,0.15)",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <Ionicons
                    name="create-outline"
                    size={16}
                    color="#FCD34D"
                  />
                </View>
                <Text
                  style={{
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 14,
                    color: textPrimary,
                  }}
                >
                  Update Your Offer
                </Text>
              </View>
              <View style={{
                width: 24,
                height: 24,
                borderRadius: 8,
                backgroundColor: "rgba(255,255,255,0.08)",
                alignItems: "center",
                justifyContent: "center",
              }}>
                <Ionicons
                  name={showUpdateOffer ? "chevron-up" : "chevron-down"}
                  size={14}
                  color="rgba(255,255,255,0.5)"
                />
              </View>
            </TouchableOpacity>

            {/* Animated slide-up body */}
            <Animated.View
              style={{
                maxHeight: updateOfferMaxHeight,
                opacity: updateOfferOpacity,
                overflow: "hidden",
              }}
            >
              <View
                style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12 }}
              >
                <View style={{
                  height: 1,
                  backgroundColor: "rgba(255,255,255,0.08)",
                  marginBottom: 4,
                }} />
                <Text
                  style={{
                    fontFamily: "Inter_400Regular",
                    fontSize: 12,
                    color: textMuted,
                  }}
                >
                  A new offer cancels all pending bids · Min: Rs. {minCounterOffer}
                </Text>

                {/* Range indicator */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: textMuted }}>
                    Rs. {minCounterOffer}
                  </Text>
                  <View style={{ flex: 1, height: 3, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 2 }}>
                    <View style={{
                      width: updateOfferInput ? `${Math.min(100, Math.max(0, (parseFloat(updateOfferInput) - minCounterOffer) / (offeredFare * 2 - minCounterOffer) * 100))}%` : "0%",
                      height: 3,
                      backgroundColor: "#FCD34D",
                      borderRadius: 2,
                    }} />
                  </View>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: textMuted }}>
                    Rs. {Math.ceil(offeredFare * 1.5)}
                  </Text>
                </View>

                {offerError ? (
                  <Text
                    style={{
                      fontFamily: "Inter_500Medium",
                      fontSize: 12,
                      color: "#EF4444",
                    }}
                  >
                    {offerError}
                  </Text>
                ) : null}
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View
                    style={{
                      flex: 1,
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: "rgba(255,255,255,0.08)",
                      borderRadius: 12,
                      paddingHorizontal: 14,
                      borderWidth: 1,
                      borderColor: offerError
                        ? "rgba(239,68,68,0.5)"
                        : "rgba(255,255,255,0.12)",
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: "Inter_700Bold",
                        fontSize: 14,
                        color: "rgba(255,255,255,0.5)",
                      }}
                    >
                      Rs.
                    </Text>
                    <TextInput
                      value={updateOfferInput}
                      onChangeText={(v) => {
                        setUpdateOfferInput(v);
                        setOfferError("");
                      }}
                      keyboardType="numeric"
                      placeholder={String(Math.ceil(offeredFare * 1.1))}
                      placeholderTextColor="rgba(255,255,255,0.2)"
                      maxLength={7}
                      style={{
                        flex: 1,
                        fontFamily: "Inter_700Bold",
                        fontSize: 18,
                        color: "#fff",
                        paddingVertical: 12,
                        paddingHorizontal: 6,
                      }}
                    />
                  </View>
                  <TouchableOpacity activeOpacity={0.7}
                    onPress={sendUpdateOffer}
                    disabled={updateOfferLoading || !updateOfferInput}
                    style={{
                      opacity: !updateOfferInput || updateOfferLoading ? 0.5 : 1,
                    }}
                  >
                    <LinearGradient
                      colors={["#F59E0B", "#D97706"]}
                      style={{
                        borderRadius: 12,
                        paddingHorizontal: 20,
                        height: "100%",
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: 48,
                      }}
                    >
                      {updateOfferLoading ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text
                          style={{
                            fontFamily: "Inter_700Bold",
                            fontSize: 13,
                            color: "#fff",
                          }}
                        >
                          Send
                        </Text>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </View>
            </Animated.View>
          </LinearGradient>
        </View>
      </ScrollView>

      {/* Cancel button bottom */}
      <View
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          paddingHorizontal: 20,
          paddingBottom: Math.max(insets.bottom, 24) + 8,
        }}
      >
        <LinearGradient
          colors={["transparent", "rgba(15,23,42,0.95)"]}
          style={{ position: "absolute", top: -20, left: 0, right: 0, bottom: 0 }}
        />
        <TouchableOpacity activeOpacity={0.7}
          onPress={() => openUnifiedCancelModal()}
          disabled={cancelling}
          style={{
            alignItems: "center",
            padding: 16,
            borderRadius: 16,
            borderWidth: 1.5,
            borderColor: "rgba(239,68,68,0.3)",
            backgroundColor: "rgba(239,68,68,0.1)",
          }}
        >
          {cancelling ? (
            <ActivityIndicator color="#EF4444" size="small" />
          ) : (
            <Text
              style={{
                fontFamily: "Inter_600SemiBold",
                fontSize: 15,
                color: "#EF4444",
              }}
            >
              Cancel Offer
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {cancelModalTarget && (
        <CancelModal
          target={cancelModalTarget}
          cancellationFee={cancellationFee}
          apiBase={rideApiBase}
          token={token}
          onClose={() => setCancelModalTarget(null)}
          onDone={(result) => {
            setRide((r: NegotiationRide | null) =>
              r ? { ...r, status: "cancelled" } : r,
            );
          }}
        />
      )}
    </View>
  );
}
