import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Linking,
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
import { useRideStatus } from "@/hooks/useRideStatus";
import { NegotiationScreen } from "@/components/ride/NegotiationScreen";
import { RideStatusSkeleton } from "@/components/ride/Skeletons";
import { staticMapUrl } from "@/hooks/useMaps";
import {
  getDispatchStatus,
  retryRideDispatch,
  rateRide,
} from "@workspace/api-client-react";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { useLanguage } from "@/context/LanguageContext";
import { tDual, type TranslationKey } from "@workspace/i18n";

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type RideTrackerProps = {
  rideId: string;
  initialType: string;
  userId: string;
  token: string | null;
  cancellationFee: number;
  onReset: () => void;
};

export function RideTracker({
  rideId,
  initialType,
  userId,
  token,
  cancellationFee,
  onReset,
}: RideTrackerProps) {
  const colorScheme = useColorScheme();
  const C = colorScheme === "dark" ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const { showToast } = useToast();
  const { language } = useLanguage();
  const tl = (key: TranslationKey) => tDual(key, language);

  const slideUp = useRef(new Animated.Value(50)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;
  const livePulse = useRef(new Animated.Value(1)).current;
  const livePulseOp = useRef(new Animated.Value(1)).current;
  const sosRing = useRef(new Animated.Value(1)).current;
  const sosRingOp = useRef(new Animated.Value(0.6)).current;
  const stepProgress = useRef(new Animated.Value(1)).current;

  const { ride, setRide, connectionType, reconnect } = useRideStatus(rideId);
  const RIDE_STEPS = ["searching", "accepted", "arrived", "in_transit", "completed"];
  const { config } = usePlatformConfig();
  const sosEnabled = config.features?.sos !== false;
  const [sosLoading, setSosLoading] = useState(false);
  const [sosSent, setSosSent] = useState(false);

  const [cancelling, setCancelling] = useState(false);
  const [cancelModalTarget, setCancelModalTarget] =
    useState<CancelTarget | null>(null);
  const [rating, setRating] = useState(0);
  const [ratingDone, setRatingDone] = useState(false);
  const [ratingComment, setRatingComment] = useState("");
  const elapsedInitialized = useRef(false);
  const [elapsed, setElapsed] = useState(0);
  const [dispatchInfo, setDispatchInfo] = useState<any>(null);
  const [retrying, setRetrying] = useState(false);
  const prevStatus = useRef<string>("");
  const [cancelResult, setCancelResult] = useState<{
    cancellationFee?: number;
    cancelReason?: string;
  } | null>(null);
  const [acceptedAt, setAcceptedAt] = useState<number | null>(null);
  const CANCEL_GRACE_SEC = 180;

  /* ── Trip OTP — shown to customer when rider has arrived ── */
  const [tripOtp, setTripOtp] = useState<string | null>(null);
  const [otpCopied, setOtpCopied] = useState(false);

  /* ── Live rider location via Socket.io ── */
  const [riderLivePos, setRiderLivePos] = useState<{ lat: number; lng: number } | null>(null);
  const socketRef = useRef<{ disconnect: () => void } | null>(null);

  const isSocketActive = ["accepted", "arrived", "in_transit"].includes(ride?.status ?? "");

  useEffect(() => {
    if (!isSocketActive || !rideId) return;

    const domain = process.env.EXPO_PUBLIC_DOMAIN ?? "";
    const socketUrl = `https://${domain}`;
    const socketIoPath = "/api/socket.io";

    let unmounted = false;
    import("socket.io-client").then(({ io }) => {
      if (unmounted) return;
      const socket = io(socketUrl, {
        path: socketIoPath,
        query: { rooms: `ride:${rideId}` },
        auth: token ? { token } : {},
        extraHeaders: token ? { Authorization: `Bearer ${token}` } : {},
        transports: ["polling", "websocket"],
      });
      if (unmounted) { socket.disconnect(); return; }
      socketRef.current = socket;
      socket.on("rider:location", (payload: { latitude: number; longitude: number; rideId?: string; orderId?: string }) => {
        const payloadRideId = payload.rideId ?? payload.orderId;
        if (!payloadRideId || payloadRideId !== rideId) {
          if (__DEV__) console.warn("[socket] rider:location discarded — ID mismatch", { payloadRideId, expected: rideId });
          return;
        }
        setRiderLivePos({ lat: payload.latitude, lng: payload.longitude });
      });
      socket.on("ride:otp", (payload: { rideId: string; otp: string }) => {
        if (payload.rideId === rideId && payload.otp) {
          setTripOtp(payload.otp);
        }
      });
    });

    return () => {
      unmounted = true;
      if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
    };
    /* isSocketActive is a derived boolean — it only changes on non-active↔active
       transitions (e.g. searching→accepted or in_transit→completed), NOT on
       active→active transitions (accepted→arrived→in_transit). This avoids
       tearing down the socket mid-ride while still connecting when the ride
       first becomes active and disconnecting on terminal statuses. */
  }, [rideId, token, isSocketActive]);

  useEffect(() => {
    AsyncStorage.getItem(`rated_ride_${rideId}`).then(val => {
      if (val === "1") setRatingDone(true);
    }).catch(() => {});
  }, [rideId]);

  /* Seed elapsed from ride.createdAt on first data arrival to avoid
     timer drift when the component mounts after the ride was already created. */
  useEffect(() => {
    if (elapsedInitialized.current || !ride?.createdAt) return;
    const ageMs = Date.now() - new Date(ride.createdAt).getTime();
    if (ageMs > 0) setElapsed(Math.floor(ageMs / 1000));
    elapsedInitialized.current = true;
  }, [ride?.createdAt]);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const st = ride?.status;
    if (st === "accepted" && !acceptedAt) setAcceptedAt(Date.now());
  }, [ride?.status, acceptedAt]);

  /* ── Populate OTP from polling data (fallback if socket event missed) ── */
  useEffect(() => {
    if (ride?.status === "arrived" && (ride as any)?.tripOtp && !tripOtp) {
      setTripOtp((ride as any).tripOtp);
    }
    if (ride?.status === "in_transit") {
      setTripOtp(null); // clear once trip starts
    }
  }, [ride?.status, (ride as any)?.tripOtp]);

  useEffect(() => {
    const st = ride?.status;
    const prev = prevStatus.current;
    const pendingStatuses = ["searching", "bargaining"];
    if (
      st &&
      !pendingStatuses.includes(st) &&
      pendingStatuses.includes(prev)
    ) {
      slideUp.setValue(50);
      fadeIn.setValue(0);
      Animated.parallel([
        Animated.spring(slideUp, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 6,
        }),
        Animated.timing(fadeIn, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ]).start();
    }
    if (!prevStatus.current && st && !pendingStatuses.includes(st)) {
      slideUp.setValue(0);
      fadeIn.setValue(1);
    }
    prevStatus.current = st || "";
  }, [ride?.status]);

  useEffect(() => {
    const idx = RIDE_STEPS.indexOf(ride?.status ?? "");
    if (idx > 0) {
      stepProgress.setValue(0);
      Animated.timing(stepProgress, {
        toValue: 1,
        duration: 500,
        useNativeDriver: false,
      }).start();
    }
  }, [ride?.status]);

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
    if (!sosEnabled) return;
    const sosRingAnim = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(sosRing, { toValue: 1.6, duration: 800, useNativeDriver: true }),
          Animated.timing(sosRingOp, { toValue: 0, duration: 800, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(sosRing, { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(sosRingOp, { toValue: 0.6, duration: 0, useNativeDriver: true }),
        ]),
      ]),
    );
    sosRingAnim.start();
    return () => sosRingAnim.stop();
  }, [sosEnabled]);

  useEffect(() => {
    const status = ride?.status;
    if (status !== "searching" && status !== "no_riders") return;
    const poll = async () => {
      try {
        const d = await getDispatchStatus(rideId);
        setDispatchInfo(d);
      } catch (err) {
        if (__DEV__) console.warn("[RideTracker] Dispatch status poll failed:", err instanceof Error ? err.message : String(err));
      }
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
  }, [rideId, ride?.status]);

  const handleRetryDispatch = async () => {
    setRetrying(true);
    try {
      await retryRideDispatch(rideId);
      setRide((r: any) => (r ? { ...r, status: "searching" } : r));
      setDispatchInfo(null);
    } catch {
      showToast(tl("couldNotRetry"), "error");
    }
    setRetrying(false);
  };

  const rideApiBase = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

  const graceSecondsLeft = acceptedAt
    ? Math.max(0, CANCEL_GRACE_SEC - Math.floor((Date.now() - acceptedAt) / 1000))
    : null;
  const inGracePeriod = graceSecondsLeft !== null && graceSecondsLeft > 0;
  const effectiveCancellationFee = inGracePeriod ? 0 : cancellationFee;

  const openUnifiedCancelModal = () => {
    const riderAssigned = [
      "accepted",
      "arrived",
      "in_transit",
    ].includes(ride?.status || "");
    setCancelModalTarget({
      id: rideId,
      type: "ride",
      status: ride?.status || "searching",
      fare: ride?.fare,
      paymentMethod: ride?.paymentMethod,
      riderAssigned,
    });
  };

  const openInMaps = () => {
    if (
      !ride?.pickupLat ||
      !ride?.pickupLng ||
      !ride?.dropLat ||
      !ride?.dropLng
    )
      return;
    Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&origin=${ride.pickupLat},${ride.pickupLng}&destination=${ride.dropLat},${ride.dropLng}&travelmode=driving`,
    );
  };

  const status = ride?.status ?? "searching";
  const rideType = ride?.type ?? initialType;
  const STEPS = RIDE_STEPS;
  const LABELS = [tl("stepSearching"), tl("stepAccepted"), tl("stepArrived"), tl("stepEnRoute"), tl("stepCompleted")];
  const stepIdx = STEPS.indexOf(status) !== -1 ? STEPS.indexOf(status) : 0;
  const elapsedStr =
    elapsed < 60
      ? `${elapsed}s`
      : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

  if (!ride) {
    return <RideStatusSkeleton />;
  }

  if (status === "bargaining") {
    return (
      <NegotiationScreen
        rideId={rideId}
        ride={ride as any}
        setRide={(updater) => setRide((prev) => updater(prev as any) as any)}
        elapsed={elapsed}
        cancellationFee={effectiveCancellationFee}
        token={token}
        broadcastTimeoutSec={ride?.broadcastTimeoutSec ?? 300}
        estimatedFare={ride?.estimatedFare ?? ride?.fare}
        minOffer={ride?.minOffer}
      />
    );
  }

  if (status === "no_riders" || (status === "searching" && elapsed >= 180)) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0F172A" }}>
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 32,
          }}
        >
          <View
            style={{
              width: 88,
              height: 88,
              borderRadius: 44,
              backgroundColor: "rgba(239,68,68,0.12)",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 24,
            }}
          >
            <Ionicons name="car-outline" size={44} color="#EF4444" />
          </View>
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 24,
              color: "#fff",
              textAlign: "center",
              marginBottom: 8,
            }}
          >
            {tl("noDriversAvailable")}
          </Text>
          <Text
            style={{
              fontFamily: "Inter_400Regular",
              fontSize: 14,
              color: "rgba(255,255,255,0.5)",
              textAlign: "center",
              lineHeight: 22,
              marginBottom: 12,
            }}
          >
            {dispatchInfo?.notifiedRiders > 0
              ? tl("noDriversNotified").replace("{count}", String(dispatchInfo.notifiedRiders))
              : tl("noDriversDefault")}
          </Text>
          {dispatchInfo && (
            <View
              style={{
                backgroundColor: "rgba(255,255,255,0.06)",
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: 12,
                marginBottom: 24,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.08)",
              }}
            >
              <Text
                style={{
                  fontFamily: "Inter_400Regular",
                  fontSize: 12,
                  color: "rgba(255,255,255,0.5)",
                }}
              >
                {dispatchInfo.notifiedRiders} riders notified ·{" "}
                {dispatchInfo.elapsedSec}s elapsed
                {dispatchInfo.dispatchLoopCount != null
                  ? ` · Round ${dispatchInfo.dispatchLoopCount}/${dispatchInfo.maxLoops}`
                  : ""}
              </Text>
            </View>
          )}
          <TouchableOpacity activeOpacity={0.7}
            onPress={handleRetryDispatch}
            disabled={retrying}
            style={{
              backgroundColor: "#fff",
              borderRadius: 16,
              paddingVertical: 16,
              paddingHorizontal: 32,
              alignItems: "center",
              width: "100%",
              marginBottom: 12,
              opacity: retrying ? 0.6 : 1,
            }}
          >
            {retrying ? (
              <ActivityIndicator color={C.primary} size="small" />
            ) : (
              <Text
                style={{
                  fontFamily: "Inter_700Bold",
                  fontSize: 15,
                  color: C.primary,
                }}
              >
                {tl("retrySearch")}
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7}
            onPress={onReset}
            style={{
              backgroundColor: "rgba(245,158,11,0.18)",
              borderWidth: 1.5,
              borderColor: "rgba(245,158,11,0.4)",
              borderRadius: 16,
              paddingVertical: 14,
              paddingHorizontal: 32,
              alignItems: "center",
              width: "100%",
              marginBottom: 12,
              flexDirection: "row",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <Ionicons name="trending-up-outline" size={16} color="#F59E0B" />
            <Text
              style={{
                fontFamily: "Inter_600SemiBold",
                fontSize: 15,
                color: "#F59E0B",
              }}
            >
              {tl("increaseOffer")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7}
            onPress={onReset}
            style={{
              backgroundColor: "rgba(99,102,241,0.15)",
              borderWidth: 1.5,
              borderColor: "rgba(99,102,241,0.35)",
              borderRadius: 16,
              paddingVertical: 14,
              paddingHorizontal: 32,
              alignItems: "center",
              width: "100%",
              marginBottom: 12,
              flexDirection: "row",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <Ionicons name="swap-horizontal-outline" size={16} color="#818CF8" />
            <Text
              style={{
                fontFamily: "Inter_600SemiBold",
                fontSize: 15,
                color: "#818CF8",
              }}
            >
              {tl("tryDifferentService")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7}
            onPress={() => openUnifiedCancelModal()}
            disabled={cancelling}
            style={{
              borderWidth: 1.5,
              borderColor: "rgba(239,68,68,0.4)",
              borderRadius: 16,
              paddingVertical: 14,
              paddingHorizontal: 32,
              alignItems: "center",
              width: "100%",
              marginBottom: 12,
            }}
          >
            {cancelling ? (
              <ActivityIndicator color="#EF4444" size="small" />
            ) : (
              <>
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 15, color: "#EF4444" }}>
                  {tl("cancelRideLabel")}
                </Text>
                {inGracePeriod && graceSecondsLeft !== null && (
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "#16A34A", marginTop: 2 }}>
                    {tl("freeCancel")} {Math.floor(graceSecondsLeft / 60)}:{String(graceSecondsLeft % 60).padStart(2, "0")} left
                  </Text>
                )}
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7}
            onPress={onReset}
            style={{
              borderWidth: 1.5,
              borderColor: "rgba(255,255,255,0.15)",
              borderRadius: 16,
              paddingVertical: 14,
              paddingHorizontal: 32,
              alignItems: "center",
              width: "100%",
            }}
          >
            <Text
              style={{
                fontFamily: "Inter_600SemiBold",
                fontSize: 15,
                color: "rgba(255,255,255,0.5)",
              }}
            >
              {tl("goBack")}
            </Text>
          </TouchableOpacity>
        </View>

        {cancelModalTarget && (
          <CancelModal
            target={cancelModalTarget}
            cancellationFee={effectiveCancellationFee}
            apiBase={rideApiBase}
            token={token}
            onClose={() => setCancelModalTarget(null)}
            onDone={(result) => {
              setCancelResult({
                cancellationFee: result?.cancellationFee,
                cancelReason: result?.cancelReason,
              });
              setRide((r: any) =>
                r ? { ...r, status: "cancelled" } : r,
              );
            }}
          />
        )}
      </View>
    );
  }

  if (status === "searching") {
    return (
      <View style={{ flex: 1, backgroundColor: "#0F172A" }}>
        <View
          style={{
            position: "absolute",
            top: topPad + 16,
            left: 20,
            zIndex: 10,
          }}
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
        </View>

        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 32,
          }}
        >
          <View
            style={{
              width: 160,
              height: 160,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 24,
            }}
          >
            <ActivityIndicator size="large" color="#FCD34D" />
          </View>
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 22,
              color: "#fff",
              textAlign: "center",
              marginBottom: 8,
            }}
          >
            {tl("findingYourDriver")}
          </Text>
          <Text
            style={{
              fontFamily: "Inter_400Regular",
              fontSize: 14,
              color: "rgba(255,255,255,0.5)",
              textAlign: "center",
              lineHeight: 22,
            }}
          >
            {tl("searchingNearbyDrivers")} {elapsedStr}
          </Text>

          {connectionType === "sse" && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                marginTop: 12,
                backgroundColor: "rgba(16,185,129,0.15)",
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 10,
              }}
            >
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: "#10B981",
                }}
              />
              <Text
                style={{
                  fontFamily: "Inter_400Regular",
                  fontSize: 11,
                  color: "#10B981",
                }}
              >
                {tl("liveUpdates")}
              </Text>
            </View>
          )}

          {dispatchInfo && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                marginTop: 16,
                backgroundColor: "rgba(255,255,255,0.06)",
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.08)",
              }}
            >
              <Ionicons
                name="navigate-outline"
                size={13}
                color="rgba(255,255,255,0.5)"
              />
              <Text
                style={{
                  fontFamily: "Inter_400Regular",
                  fontSize: 12,
                  color: "rgba(255,255,255,0.5)",
                }}
              >
                Round {(dispatchInfo.dispatchLoopCount ?? 0) + 1}/
                {dispatchInfo.maxLoops || "?"} ·{" "}
                {dispatchInfo.attemptCount || 0} contacted
              </Text>
            </View>
          )}

          <View
            style={{
              flexDirection: "row",
              backgroundColor: "rgba(255,255,255,0.06)",
              borderRadius: 16,
              overflow: "hidden",
              marginTop: 36,
              width: "100%",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.08)",
            }}
          >
            {[
              { val: "50+", lbl: tl("activeDrivers") },
              { val: "2–5", lbl: tl("minEta") },
            ].map((s, i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  alignItems: "center",
                  padding: 16,
                  borderLeftWidth: i > 0 ? 1 : 0,
                  borderLeftColor: "rgba(255,255,255,0.08)",
                }}
              >
                <Text
                  style={{
                    fontFamily: "Inter_700Bold",
                    fontSize: 22,
                    color: "#fff",
                  }}
                >
                  {s.val}
                </Text>
                <Text
                  style={{
                    fontFamily: "Inter_400Regular",
                    fontSize: 11,
                    color: "rgba(255,255,255,0.4)",
                    marginTop: 4,
                  }}
                >
                  {s.lbl}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View
          style={{
            paddingHorizontal: 24,
            paddingBottom: Math.max(insets.bottom, 24) + 16,
          }}
        >
          <TouchableOpacity activeOpacity={0.7}
            onPress={() => openUnifiedCancelModal()}
            disabled={cancelling}
            style={{
              alignItems: "center",
              padding: 16,
              borderRadius: 16,
              borderWidth: 1.5,
              borderColor: "rgba(239,68,68,0.3)",
              backgroundColor: "rgba(239,68,68,0.08)",
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
                {tl("cancelRideLabel")}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {cancelModalTarget && (
          <CancelModal
            target={cancelModalTarget}
            cancellationFee={effectiveCancellationFee}
            apiBase={rideApiBase}
            token={token}
            onClose={() => setCancelModalTarget(null)}
            onDone={(result) => {
              setCancelResult({
                cancellationFee: result?.cancellationFee,
                cancelReason: result?.cancelReason,
              });
              setRide((r: any) =>
                r ? { ...r, status: "cancelled" } : r,
              );
            }}
          />
        )}
      </View>
    );
  }

  if (status === "cancelled") {
    const wasWallet = ride?.paymentMethod === "wallet";
    const appliedFee = cancelResult?.cancellationFee ?? 0;
    const cancelReason = cancelResult?.cancelReason;
    return (
      <View style={{ flex: 1, backgroundColor: C.background }}>
        <View
          style={{
            paddingTop: topPad + 24,
            paddingBottom: 36,
            alignItems: "center",
            paddingHorizontal: 24,
            backgroundColor: C.surface,
            borderBottomWidth: 1,
            borderBottomColor: C.border,
          }}
        >
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: C.redSoft,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <Ionicons name="close-circle" size={40} color="#EF4444" />
          </View>
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 22,
              color: C.text,
            }}
          >
            {tl("rideCancelledTitle")}
          </Text>
          <Text
            style={{
              fontFamily: "Inter_400Regular",
              fontSize: 14,
              color: C.textMuted,
              marginTop: 6,
            }}
          >
            {tl("rideCancelledSubtitle")}
          </Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          {appliedFee > 0 && (
            <View
              style={{
                backgroundColor: C.redBg,
                borderRadius: 16,
                padding: 16,
                gap: 8,
                borderWidth: 1,
                borderColor: C.redSoft,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    backgroundColor: "#FEE2E2",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="cash-outline" size={16} color="#DC2626" />
                </View>
                <Text
                  style={{
                    fontFamily: "Inter_700Bold",
                    fontSize: 14,
                    color: "#991B1B",
                  }}
                >
                  {tl("cancellationFeeApplied")}
                </Text>
              </View>
              <Text
                style={{
                  fontFamily: "Inter_400Regular",
                  fontSize: 13,
                  color: "#374151",
                  lineHeight: 19,
                }}
              >
                {tl("cancellationFeeMsg").replace("{amount}", String(appliedFee))}
              </Text>
            </View>
          )}
          {wasWallet && (
            <View
              style={{
                backgroundColor: C.greenBg,
                borderRadius: 16,
                padding: 16,
                gap: 8,
                borderWidth: 1,
                borderColor: C.greenBorder,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    backgroundColor: "#D1FAE5",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons
                    name="wallet-outline"
                    size={16}
                    color="#10B981"
                  />
                </View>
                <Text
                  style={{
                    fontFamily: "Inter_700Bold",
                    fontSize: 14,
                    color: "#065F46",
                  }}
                >
                  {tl("refundInitiated")}
                </Text>
              </View>
              <Text
                style={{
                  fontFamily: "Inter_400Regular",
                  fontSize: 13,
                  color: "#374151",
                  lineHeight: 19,
                }}
              >
                {tl("refundWalletMsg").replace("{amount}", String(Math.round(parseFloat(String(ride?.fare ?? 0)) - appliedFee)))}
              </Text>
            </View>
          )}
          {cancelReason && (
            <View
              style={{
                backgroundColor: "#fff",
                borderRadius: 14,
                padding: 14,
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              <Text
                style={{
                  fontFamily: "Inter_500Medium",
                  fontSize: 12,
                  color: C.textMuted,
                  marginBottom: 4,
                }}
              >
                {tl("reason")}
              </Text>
              <Text
                style={{
                  fontFamily: "Inter_400Regular",
                  fontSize: 13,
                  color: C.text,
                }}
              >
                {cancelReason}
              </Text>
            </View>
          )}
          <View
            style={{
              backgroundColor: "#fff",
              borderRadius: 14,
              padding: 14,
              borderWidth: 1,
              borderColor: C.border,
              alignItems: "center",
            }}
          >
            <Text
              style={{
                fontFamily: "Inter_500Medium",
                fontSize: 12,
                color: C.textMuted,
              }}
            >
              Ride #{rideId.slice(-8).toUpperCase()}
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <TouchableOpacity activeOpacity={0.7}
              onPress={() => router.push("/(tabs)")}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: 16,
                borderRadius: 14,
                backgroundColor: "#F1F5F9",
              }}
            >
              <Ionicons
                name="home-outline"
                size={17}
                color={C.textSecondary}
              />
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 14,
                  color: C.textSecondary,
                }}
              >
                {tl("home")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.7}
              onPress={onReset}
              style={{
                flex: 2,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: 16,
                borderRadius: 14,
                backgroundColor: C.primary,
              }}
            >
              <Ionicons name="add" size={17} color="#fff" />
              <Text
                style={{
                  fontFamily: "Inter_700Bold",
                  fontSize: 14,
                  color: "#fff",
                }}
              >
                {tl("bookNewRide")}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (status === "completed") {
    return (
      <View style={{ flex: 1, backgroundColor: C.background }}>
        <View
          style={{
            paddingTop: topPad + 24,
            paddingBottom: 32,
            alignItems: "center",
            paddingHorizontal: 24,
            backgroundColor: C.surface,
            borderBottomWidth: 1,
            borderBottomColor: C.border,
          }}
        >
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: C.emeraldSoft,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <Ionicons
              name="checkmark-circle"
              size={40}
              color="#10B981"
            />
          </View>
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 22,
              color: C.text,
            }}
          >
            {tl("rideCompleteExclaim")}
          </Text>
          <Text
            style={{
              fontFamily: "Inter_400Regular",
              fontSize: 14,
              color: C.textMuted,
              marginTop: 6,
            }}
          >
            Rs. {parseFloat(String(ride?.fare ?? 0)).toLocaleString()} · {parseFloat(String(ride?.distance ?? 0)).toFixed(1)} km
          </Text>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 20, gap: 14 }}
        >
          {!ratingDone ? (
            <View
              style={{
                borderRadius: 24,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              {/* Sheet header */}
              <LinearGradient
                colors={["#1E293B", "#0F172A"]}
                style={{ padding: 20, alignItems: "center", gap: 4 }}
              >
                {/* drag handle */}
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)", marginBottom: 12 }} />
                <View style={{
                  width: 60,
                  height: 60,
                  borderRadius: 30,
                  backgroundColor: "rgba(245,158,11,0.15)",
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 2,
                  borderColor: "rgba(245,158,11,0.4)",
                  marginBottom: 10,
                }}>
                  <Ionicons name="star" size={28} color="#F59E0B" />
                </View>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 18, color: "#fff" }}>
                  {tl("rateYourDriver")}
                </Text>
                {ride.riderName ? (
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
                    {tl("howWasRide").replace("{name}", ride.riderName)}
                  </Text>
                ) : null}
                {/* Stars */}
                <View style={{ flexDirection: "row", gap: 14, marginTop: 18, marginBottom: 6 }}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <TouchableOpacity activeOpacity={0.7} key={s} onPress={() => setRating(s)} style={{ padding: 4 }}>
                      <Ionicons
                        name={s <= rating ? "star" : "star-outline"}
                        size={38}
                        color={s <= rating ? "#F59E0B" : "rgba(255,255,255,0.25)"}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
                {rating > 0 && (
                  <View style={{
                    backgroundColor: "rgba(245,158,11,0.15)",
                    borderRadius: 20,
                    paddingHorizontal: 16,
                    paddingVertical: 6,
                    borderWidth: 1,
                    borderColor: "rgba(245,158,11,0.3)",
                    marginTop: 4,
                  }}>
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#FCD34D" }}>
                      {rating === 5 ? tl("ratingExcellent") : rating >= 4 ? tl("ratingGreat") : rating >= 3 ? tl("ratingOkay") : tl("ratingCouldBeBetter")}
                    </Text>
                  </View>
                )}
                {rating === 0 && (
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
                    {tl("tapStarToRate")}
                  </Text>
                )}
              </LinearGradient>
              {/* Comment + submit */}
              <View style={{ backgroundColor: C.surface, padding: 20, gap: 12 }}>
                <TextInput
                  placeholder={tl("leaveComment")}
                  value={ratingComment}
                  onChangeText={setRatingComment}
                  multiline
                  numberOfLines={2}
                  style={{
                    borderWidth: 1,
                    borderColor: C.border,
                    borderRadius: 14,
                    padding: 13,
                    fontFamily: "Inter_400Regular",
                    fontSize: 14,
                    color: C.text,
                    minHeight: 60,
                    textAlignVertical: "top",
                    backgroundColor: C.surfaceSecondary,
                  }}
                  placeholderTextColor={C.textMuted}
                />
                <TouchableOpacity activeOpacity={0.7}
                  onPress={async () => {
                    if (rating === 0) return;
                    try {
                      await rateRide(rideId, {
                        stars: rating,
                        comment: ratingComment || undefined,
                      });
                      setRatingDone(true);
                      AsyncStorage.setItem(`rated_ride_${rideId}`, "1").catch(() => {});
                    } catch {
                      showToast(tl("couldNotSubmitRating"), "error");
                    }
                  }}
                  disabled={rating === 0}
                  style={{ opacity: rating === 0 ? 0.45 : 1 }}
                >
                  <LinearGradient
                    colors={rating > 0 ? ["#F59E0B", "#D97706"] : [C.border, C.border]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{
                      borderRadius: 14,
                      paddingVertical: 15,
                      alignItems: "center",
                      flexDirection: "row",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    <Ionicons name="paper-plane" size={16} color="#fff" />
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" }}>
                      {tl("submitRating")}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.7}
                  onPress={() => setRatingDone(true)}
                  style={{ alignItems: "center", paddingVertical: 6 }}
                >
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted }}>
                    {tl("skipForNow")}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View
              style={{
                backgroundColor: C.greenBg,
                borderRadius: 16,
                padding: 16,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                borderWidth: 1,
                borderColor: C.greenBorder,
              }}
            >
              <Ionicons name="checkmark-circle" size={20} color={C.emerald} />
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.emeraldDeep }}>
                {tl("thanksForRating")}
              </Text>
            </View>
          )}

          <View
            style={{
              backgroundColor: C.surface,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: C.border,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                backgroundColor: C.surfaceSecondary,
                padding: 14,
                borderBottomWidth: 1,
                borderBottomColor: C.border,
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  fontFamily: "Inter_700Bold",
                  fontSize: 14,
                  color: C.text,
                }}
              >
                {tl("receiptTitle")}
              </Text>
              <Text
                style={{
                  fontFamily: "Inter_400Regular",
                  fontSize: 11,
                  color: C.textMuted,
                }}
              >
                #{rideId.slice(-8).toUpperCase()}
              </Text>
            </View>
            <View style={{ padding: 16, gap: 12 }}>
              {[
                {
                  lbl: tl("vehicleLabel"),
                  val:
                    rideType === "bike"
                      ? tl("bike")
                      : rideType === "car"
                        ? tl("car")
                        : rideType === "rickshaw"
                          ? tl("rickshaw")
                          : rideType,
                },
                { lbl: tl("distance"), val: `${parseFloat(String(ride?.distance ?? 0)).toFixed(1)} km` },
                {
                  lbl: tl("payment"),
                  val:
                    ride?.paymentMethod === "wallet" ? tl("paymentWallet") : ride?.paymentMethod === "jazzcash" ? tl("paymentJazzCash") : ride?.paymentMethod === "easypaisa" ? tl("paymentEasyPaisa") : tl("paymentCashLabel"),
                },
                {
                  lbl: tl("driver"),
                  val: ride?.riderName || tl("ajkDriver"),
                },
              ].map((r) => (
                <View
                  key={r.lbl}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "Inter_400Regular",
                      fontSize: 13,
                      color: C.textMuted,
                    }}
                  >
                    {r.lbl}
                  </Text>
                  <Text
                    style={{
                      fontFamily: "Inter_500Medium",
                      fontSize: 13,
                      color: C.text,
                    }}
                  >
                    {r.val}
                  </Text>
                </View>
              ))}
              <View
                style={{
                  height: 1,
                  backgroundColor: C.border,
                  marginVertical: 4,
                }}
              />
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    fontFamily: "Inter_700Bold",
                    fontSize: 15,
                    color: C.text,
                  }}
                >
                  {tl("total")}
                </Text>
                <Text
                  style={{
                    fontFamily: "Inter_700Bold",
                    fontSize: 22,
                    color: C.success,
                  }}
                >
                  Rs. {parseFloat(String(ride?.fare ?? 0)).toLocaleString()}
                </Text>
              </View>
            </View>
          </View>

          <View
            style={{
              backgroundColor: C.surface,
              borderRadius: 20,
              padding: 16,
              gap: 14,
              borderWidth: 1,
              borderColor: C.border,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  fontFamily: "Inter_700Bold",
                  fontSize: 14,
                  color: C.text,
                }}
              >
                {tl("routeLabel")}
              </Text>
              <TouchableOpacity activeOpacity={0.7}
                onPress={openInMaps}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  backgroundColor: "#EFF6FF",
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 10,
                }}
              >
                <Ionicons
                  name="navigate-outline"
                  size={12}
                  color="#4285F4"
                />
                <Text
                  style={{
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 11,
                    color: "#4285F4",
                  }}
                >
                  Map
                </Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ alignItems: "center", gap: 4 }}>
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: "#10B981",
                  }}
                />
                <View
                  style={{
                    flex: 1,
                    width: 2,
                    backgroundColor: C.border,
                    minHeight: 20,
                  }}
                />
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: "#EF4444",
                  }}
                />
              </View>
              <View style={{ flex: 1, gap: 16 }}>
                <View>
                  <Text
                    style={{
                      fontFamily: "Inter_400Regular",
                      fontSize: 11,
                      color: C.textMuted,
                    }}
                  >
                    {tl("pickup")}
                  </Text>
                  <Text
                    style={{
                      fontFamily: "Inter_500Medium",
                      fontSize: 13,
                      color: C.text,
                      marginTop: 2,
                    }}
                  >
                    {ride?.pickupAddress}
                  </Text>
                </View>
                <View>
                  <Text
                    style={{
                      fontFamily: "Inter_400Regular",
                      fontSize: 11,
                      color: C.textMuted,
                    }}
                  >
                    {tl("dropoff")}
                  </Text>
                  <Text
                    style={{
                      fontFamily: "Inter_500Medium",
                      fontSize: 13,
                      color: C.text,
                      marginTop: 2,
                    }}
                  >
                    {ride?.dropAddress}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              backgroundColor: C.greenBg,
              padding: 14,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: C.greenBorder,
            }}
          >
            <Ionicons
              name="shield-checkmark"
              size={14}
              color={C.emerald}
            />
            <Text
              style={{
                fontFamily: "Inter_400Regular",
                fontSize: 12,
                color: C.emeraldDeep,
              }}
            >
              {tl("insuredRide")}
            </Text>
          </View>

          <View style={{ flexDirection: "row", gap: 12 }}>
            <TouchableOpacity activeOpacity={0.7}
              onPress={() => router.push("/(tabs)")}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: 16,
                borderRadius: 14,
                backgroundColor: "#F1F5F9",
              }}
            >
              <Ionicons
                name="home-outline"
                size={17}
                color={C.textSecondary}
              />
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 14,
                  color: C.textSecondary,
                }}
              >
                {tl("home")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.7}
              onPress={onReset}
              style={{
                flex: 2,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: 16,
                borderRadius: 14,
                backgroundColor: C.primary,
              }}
            >
              <Ionicons name="add" size={17} color="#fff" />
              <Text
                style={{
                  fontFamily: "Inter_700Bold",
                  fontSize: 14,
                  color: "#fff",
                }}
              >
                {tl("bookNewRide")}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={{ height: 24 }} />
        </ScrollView>
      </View>
    );
  }

  type StatusCfg = { color: string; icon: React.ComponentProps<typeof Ionicons>["name"]; title: string; sub: string };
  const statusCfgs: Record<string, StatusCfg> = {
    accepted: {
      color: "#1A56DB",
      icon: "car",
      title: tl("driverIsComing"),
      sub: tl("driverAcceptedSub"),
    },
    arrived: {
      color: "#D97706",
      icon: "location",
      title: tl("driverHasArrived"),
      sub: tl("driverAtPickup"),
    },
    in_transit: {
      color: "#059669",
      icon: "navigate",
      title: tl("onYourWay"),
      sub: tl("tripInProgress"),
    },
  };
  const hdrCfg = statusCfgs[status] ?? statusCfgs["accepted"]!;
  const canCancel = ["accepted", "arrived", "in_transit"].includes(status);

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* Dark gradient header */}
      <LinearGradient
        colors={["#1E293B", "#0F172A"]}
        style={{
          paddingTop: topPad + 16,
          paddingBottom: 20,
          paddingHorizontal: 20,
        }}
      >
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: 14 }}
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
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 16,
              backgroundColor: `${hdrCfg.color}25`,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: `${hdrCfg.color}50`,
            }}
          >
            <Ionicons
              name={hdrCfg.icon}
              size={26}
              color={hdrCfg.color}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 18,
                color: "#fff",
              }}
            >
              {hdrCfg.title}
            </Text>
            <Text
              style={{
                fontFamily: "Inter_400Regular",
                fontSize: 13,
                color: "rgba(255,255,255,0.5)",
                marginTop: 3,
              }}
            >
              {hdrCfg.sub}
            </Text>
          </View>
          {/* LIVE badge */}
          <View style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            backgroundColor: "rgba(16,185,129,0.18)",
            borderRadius: 10,
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderWidth: 1,
            borderColor: "rgba(16,185,129,0.35)",
          }}>
            <Animated.View style={{
              width: 7,
              height: 7,
              borderRadius: 3.5,
              backgroundColor: "#10B981",
              transform: [{ scale: livePulse }],
              opacity: livePulseOp,
            }} />
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 10, color: "#10B981", letterSpacing: 0.8 }}>
              {tl("liveLabel")}
            </Text>
          </View>
        </View>

        {/* Elapsed timer strip */}
        <View style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          marginTop: 14,
          paddingTop: 12,
          borderTopWidth: 1,
          borderTopColor: "rgba(255,255,255,0.08)",
        }}>
          <Ionicons name="time-outline" size={13} color="rgba(255,255,255,0.4)" />
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
            {tl("tripElapsed")}
          </Text>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
            {elapsedStr}
          </Text>
          <View style={{ flex: 1 }} />
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
            #{rideId.slice(-6).toUpperCase()}
          </Text>
        </View>
      </LinearGradient>

      {connectionType === "polling" && (
        <TouchableOpacity activeOpacity={0.7}
          onPress={reconnect}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            backgroundColor: "#FEF3C7",
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderBottomColor: "#FDE68A",
          }}
        >
          <Ionicons name="wifi-outline" size={15} color="#D97706" />
          <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: "#92400E", flex: 1 }}>
            {tl("liveUpdatesPaused")}
          </Text>
          <Ionicons name="refresh-outline" size={15} color="#D97706" />
        </TouchableOpacity>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 20, gap: 14 }}
      >
        <Animated.View
          style={{
            opacity: fadeIn,
            transform: [{ translateY: slideUp }],
            gap: 14,
          }}
        >
          <View
            style={{
              backgroundColor: C.surface,
              borderRadius: 20,
              padding: 18,
              borderWidth: 1,
              borderColor: C.border,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <Text
                style={{
                  fontFamily: "Inter_700Bold",
                  fontSize: 14,
                  color: C.text,
                }}
              >
                {tl("rideProgressLabel")}
              </Text>
              <View style={{
                backgroundColor: `${hdrCfg.color}15`,
                borderRadius: 8,
                paddingHorizontal: 8,
                paddingVertical: 3,
              }}>
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 10, color: hdrCfg.color }}>
                  {LABELS[Math.max(0, stepIdx)]}
                </Text>
              </View>
            </View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
              }}
            >
              {STEPS.map((step, i) => {
                const done = stepIdx >= i;
                const active = stepIdx === i;
                const isLast = i === STEPS.length - 1;
                const completedColor = "#10B981";
                const nodeColor = done ? (active ? hdrCfg.color : completedColor) : C.surfaceSecondary;
                return (
                  <React.Fragment key={step}>
                    <View
                      style={{
                        alignItems: "center",
                        flex: 1,
                        gap: 6,
                      }}
                    >
                      {/* Node with glow for active */}
                      <View style={{ alignItems: "center", justifyContent: "center" }}>
                        {active && (
                          <View style={{
                            position: "absolute",
                            width: 44,
                            height: 44,
                            borderRadius: 22,
                            backgroundColor: `${hdrCfg.color}20`,
                          }} />
                        )}
                        <View
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 17,
                            backgroundColor: nodeColor,
                            alignItems: "center",
                            justifyContent: "center",
                            borderWidth: active ? 2 : done ? 0 : 1.5,
                            borderColor: active ? hdrCfg.color : done ? "transparent" : C.border,
                            ...(active
                              ? {
                                  shadowColor: hdrCfg.color,
                                  shadowOffset: { width: 0, height: 0 },
                                  shadowOpacity: 0.5,
                                  shadowRadius: 8,
                                  elevation: 6,
                                }
                              : {}),
                          }}
                        >
                          {done ? (
                            <Ionicons
                              name={active ? hdrCfg.icon : "checkmark"}
                              size={active ? 16 : 15}
                              color="#fff"
                            />
                          ) : (
                            <View
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 4,
                                backgroundColor: C.border,
                              }}
                            />
                          )}
                        </View>
                      </View>
                      <Text
                        style={{
                          fontSize: 10,
                          textAlign: "center",
                          color: done ? C.text : C.textMuted,
                          fontFamily: active
                            ? "Inter_700Bold"
                            : done ? "Inter_500Medium"
                            : "Inter_400Regular",
                        }}
                      >
                        {LABELS[i]}
                      </Text>
                    </View>
                    {!isLast && (
                      <View
                        style={{
                          height: 3,
                          flex: 0.4,
                          backgroundColor: C.border,
                          marginTop: 16,
                          borderRadius: 2,
                          overflow: "hidden",
                        }}
                      >
                        {stepIdx > i && (
                          <Animated.View
                            style={{
                              height: "100%",
                              borderRadius: 2,
                              backgroundColor: completedColor,
                              width: stepIdx === i + 1
                                ? stepProgress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] })
                                : "100%",
                            }}
                          />
                        )}
                      </View>
                    )}
                  </React.Fragment>
                );
              })}
            </View>
          </View>

          {/* ── OTP placeholder — rider arrived but OTP not yet received (brief window) ── */}
          {status === "arrived" && !tripOtp && (
            <View
              style={{
                backgroundColor: "#FFFBEB",
                borderRadius: 20,
                padding: 20,
                borderWidth: 2,
                borderColor: "#F59E0B",
                alignItems: "center",
                gap: 12,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons name="shield-checkmark-outline" size={24} color="#D97706" />
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#92400E" }}>
                  {tl("securityCodeGenerating")}
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 10, justifyContent: "center" }}>
                {[0, 1, 2, 3].map((i) => (
                  <View
                    key={i}
                    style={{
                      width: 56,
                      height: 64,
                      borderRadius: 14,
                      backgroundColor: "#FDE68A",
                      borderWidth: 2,
                      borderColor: "#F59E0B",
                    }}
                  />
                ))}
              </View>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#B45309", textAlign: "center" }}>
                {tl("securityCodeReady")}
              </Text>
            </View>
          )}

          {/* ── OTP Security Card — shown when driver has arrived ── */}
          {status === "arrived" && tripOtp && (
            <View
              style={{
                backgroundColor: "#FFFBEB",
                borderRadius: 20,
                padding: 20,
                borderWidth: 2,
                borderColor: "#F59E0B",
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 12,
                    backgroundColor: "#FDE68A",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="shield-checkmark" size={20} color="#D97706" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: "#92400E" }}>
                    {tl("tripSecurityCode")}
                  </Text>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#B45309", marginTop: 1 }}>
                    {tl("shareWithDriver")}
                  </Text>
                </View>
              </View>

              {/* 4-digit OTP display */}
              <View style={{ flexDirection: "row", gap: 10, justifyContent: "center", marginBottom: 16 }}>
                {tripOtp.split("").map((digit, idx) => (
                  <View
                    key={idx}
                    style={{
                      width: 56,
                      height: 64,
                      borderRadius: 14,
                      backgroundColor: "#fff",
                      borderWidth: 2,
                      borderColor: "#F59E0B",
                      alignItems: "center",
                      justifyContent: "center",
                      shadowColor: "#F59E0B",
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.15,
                      shadowRadius: 4,
                      elevation: 3,
                    }}
                  >
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 32, color: "#92400E" }}>
                      {digit}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Copy button */}
              <TouchableOpacity activeOpacity={0.7}
                onPress={async () => {
                  await Clipboard.setStringAsync(tripOtp);
                  setOtpCopied(true);
                  setTimeout(() => setOtpCopied(false), 2500);
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  backgroundColor: otpCopied ? "#10B981" : "#F59E0B",
                  paddingVertical: 10,
                  borderRadius: 12,
                }}
              >
                <Ionicons
                  name={otpCopied ? "checkmark-circle" : "copy-outline"}
                  size={16}
                  color="#fff"
                />
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: "#fff" }}>
                  {otpCopied ? tl("copiedExclaim") : tl("copyCode")}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {ride?.riderName && (
            <View
              style={{
                backgroundColor: C.surface,
                borderRadius: 20,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              {/* Glassmorphism rider card top strip */}
              <LinearGradient
                colors={colorScheme === "dark" ? ["rgba(30,41,59,0.95)", "rgba(15,23,42,0.6)"] : ["rgba(255,255,255,0.95)", "rgba(248,250,252,0.8)"]}
                style={{ padding: 18 }}
              >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 14,
                  marginBottom: 16,
                }}
              >
                {/* Circular avatar with colored ring */}
                <View style={{ position: "relative" }}>
                  <View style={{
                    width: 62,
                    height: 62,
                    borderRadius: 31,
                    backgroundColor: `${hdrCfg.color}18`,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 2.5,
                    borderColor: hdrCfg.color,
                    shadowColor: hdrCfg.color,
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: 0.4,
                    shadowRadius: 8,
                    elevation: 4,
                  }}>
                    <Text
                      style={{
                        fontFamily: "Inter_700Bold",
                        fontSize: 24,
                        color: hdrCfg.color,
                      }}
                    >
                      {ride.riderName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  {/* Active green dot */}
                  <View style={{
                    position: "absolute",
                    bottom: 0,
                    right: 0,
                    width: 16,
                    height: 16,
                    borderRadius: 8,
                    backgroundColor: "#10B981",
                    borderWidth: 2.5,
                    borderColor: C.surface,
                  }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontFamily: "Inter_700Bold",
                      fontSize: 17,
                      color: C.text,
                    }}
                  >
                    {ride.riderName}
                  </Text>
                  {/* Star rating inline */}
                  {ride?.riderAvgRating != null && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Ionicons
                            key={s}
                            name={s <= Math.round(ride.riderAvgRating ?? 0) ? "star" : "star-outline"}
                            size={12}
                            color="#F59E0B"
                          />
                        ))}
                      </View>
                      <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: "#F59E0B" }}>
                        {ride.riderAvgRating.toFixed(1)}
                      </Text>
                    </View>
                  )}
                  {ride.riderPhone && (
                    <Text
                      style={{
                        fontFamily: "Inter_400Regular",
                        fontSize: 12,
                        color: C.textMuted,
                        marginTop: 3,
                      }}
                    >
                      {ride.riderPhone}
                    </Text>
                  )}
                </View>
                {/* Vehicle plate chip + type */}
                <View style={{ alignItems: "center", gap: 6 }}>
                  <View
                    style={{
                      backgroundColor: C.surfaceSecondary,
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      borderRadius: 14,
                      alignItems: "center",
                      borderWidth: 1,
                      borderColor: C.border,
                    }}
                  >
                    <Text style={{ fontSize: 20 }}>
                      {
                        ({
                          bike: "🏍️",
                          car: "🚗",
                          rickshaw: "🛺",
                          daba: "🚐",
                          school_shift: "🚌",
                        } as Record<string, string>)[rideType] ?? "🚗"
                      }
                    </Text>
                    <Text
                      style={{
                        fontFamily: "Inter_600SemiBold",
                        fontSize: 9,
                        color: C.textSecondary,
                        marginTop: 2,
                      }}
                    >
                      {
                        ({
                          bike: tl("bike"),
                          car: tl("car"),
                          rickshaw: tl("rickshaw"),
                          daba: tl("daba"),
                          school_shift: tl("schoolShift"),
                        } as Record<string, string>)[rideType] ?? rideType
                      }
                    </Text>
                  </View>
                  {ride.bids?.find((b) => b.vehiclePlate)?.vehiclePlate && (
                    <View style={{
                      backgroundColor: colorScheme === "dark" ? "rgba(255,255,255,0.1)" : "#F1F5F9",
                      borderRadius: 7,
                      paddingHorizontal: 7,
                      paddingVertical: 3,
                      borderWidth: 1,
                      borderColor: C.border,
                    }}>
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 9, color: C.text, letterSpacing: 0.8 }}>
                        {ride.bids?.find((b) => b.vehiclePlate)?.vehiclePlate}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {(riderLivePos != null || ride.riderLat != null) &&
                (status === "accepted" || status === "arrived" || status === "in_transit") &&
                (() => {
                  /* Prefer live socket position, fall back to polling data */
                  const effLat = riderLivePos?.lat ?? ride.riderLat!;
                  const effLng = riderLivePos?.lng ?? ride.riderLng!;
                  if (effLat == null || effLng == null) return null;

                  const km = ride.pickupLat != null
                    ? haversineKm(effLat, effLng, ride.pickupLat, ride.pickupLng!)
                    : null;
                  const nearby = km != null && km < 0.2;
                  const stale = riderLivePos == null &&
                    ride.riderLocAge != null && ride.riderLocAge > 90;
                  const isLive = riderLivePos != null;

                  /* Build static map markers: rider (green) + pickup (red) */
                  const mapMarkers: Array<{ lat: number; lng: number; color: string }> = [
                    { lat: effLat, lng: effLng, color: "green" },
                    ...(ride.pickupLat != null
                      ? [{ lat: ride.pickupLat, lng: ride.pickupLng!, color: "red" }]
                      : []),
                  ];
                  const mapImgUrl = staticMapUrl(mapMarkers, { width: 600, height: 200, zoom: km != null && km < 1 ? 16 : 14 });

                  return (
                    <>
                      {/* Live map with rounded corners and overlay badge */}
                      <View
                        style={{
                          borderRadius: 16,
                          overflow: "hidden",
                          marginBottom: 10,
                          borderWidth: 1,
                          borderColor: C.border,
                          shadowColor: "#000",
                          shadowOffset: { width: 0, height: 2 },
                          shadowOpacity: 0.08,
                          shadowRadius: 6,
                          elevation: 3,
                        }}
                      >
                        <Image
                          source={{ uri: mapImgUrl }}
                          style={{ width: "100%", height: 190 }}
                          resizeMode="cover"
                        />
                        {/* "Live Map" badge top-left */}
                        <View style={{
                          position: "absolute",
                          top: 10,
                          left: 10,
                          backgroundColor: "rgba(15,23,42,0.75)",
                          borderRadius: 9,
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 5,
                        }}>
                          <Ionicons name="map" size={11} color="#fff" />
                          <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 10, color: "#fff" }}>
                            {tl("liveMapLabel")}
                          </Text>
                        </View>
                        {/* Live/last known indicator top-right */}
                        <View
                          style={{
                            position: "absolute",
                            top: 10,
                            right: 10,
                            backgroundColor: isLive ? "rgba(16,185,129,0.85)" : "rgba(100,116,139,0.85)",
                            borderRadius: 8,
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff", opacity: isLive ? 1 : 0.6 }} />
                          <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 10, color: "#fff" }}>
                            {isLive ? tl("liveLabel") : tl("lastKnownLabel")}
                          </Text>
                        </View>
                        {/* Refresh icon button — bottom-right */}
                        <TouchableOpacity activeOpacity={0.7}
                          onPress={() => reconnect?.()}
                          style={{
                            position: "absolute",
                            bottom: 10,
                            right: 10,
                            width: 34,
                            height: 34,
                            borderRadius: 17,
                            backgroundColor: "rgba(15,23,42,0.72)",
                            alignItems: "center",
                            justifyContent: "center",
                            borderWidth: 1,
                            borderColor: "rgba(255,255,255,0.15)",
                          }}
                        >
                          <Ionicons name="refresh" size={16} color="#fff" />
                        </TouchableOpacity>
                      </View>

                      {/* Distance badge */}
                      {km != null && (
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 8,
                            backgroundColor: nearby ? C.greenBg : C.blueSoft,
                            borderRadius: 12,
                            paddingHorizontal: 14,
                            paddingVertical: 10,
                            marginBottom: 14,
                            borderWidth: 1,
                            borderColor: nearby ? C.greenBorder : C.blueBorder,
                          }}
                        >
                          <Ionicons
                            name={nearby ? "location" : "navigate-outline"}
                            size={16}
                            color={nearby ? C.emeraldDot : C.primary}
                          />
                          <Text
                            style={{
                              fontFamily: "Inter_600SemiBold",
                              fontSize: 13,
                              color: nearby ? C.emeraldDeep : C.navyDeep,
                              flex: 1,
                            }}
                          >
                            {nearby
                              ? tl("driverNearby")
                              : `${km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`} ${tl("awayLabel")}`}
                          </Text>
                          {isLive && (
                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#10B981" }} />
                          )}
                          {stale && (
                            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: C.textMuted }}>
                              {tl("staleLabel")}
                            </Text>
                          )}
                        </View>
                      )}
                    </>
                  );
                })()}

              {/* Action buttons row */}
              <View style={{ flexDirection: "row", gap: 12, justifyContent: "center" }}>
                {ride.riderPhone && (
                  <View style={{ alignItems: "center", gap: 6 }}>
                    <TouchableOpacity activeOpacity={0.7}
                      onPress={() => Linking.openURL(`tel:${ride.riderPhone}`)}
                    >
                      <LinearGradient
                        colors={["#0066FF", "#0047B3"]}
                        style={{
                          width: 60,
                          height: 60,
                          borderRadius: 30,
                          alignItems: "center",
                          justifyContent: "center",
                          shadowColor: "#0066FF",
                          shadowOffset: { width: 0, height: 4 },
                          shadowOpacity: 0.4,
                          shadowRadius: 8,
                          elevation: 6,
                        }}
                      >
                        <Ionicons name="call" size={24} color="#fff" />
                      </LinearGradient>
                    </TouchableOpacity>
                    <Text style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: C.textMuted }}>Call</Text>
                  </View>
                )}
                {canCancel && (
                  <View style={{ alignItems: "center", gap: 6 }}>
                    <TouchableOpacity activeOpacity={0.7}
                      onPress={() => setCancelModalTarget({ id: rideId, type: "ride", status: status, fare: ride?.fare, paymentMethod: ride?.paymentMethod, riderAssigned: !!ride?.riderId })}
                    >
                      <LinearGradient
                        colors={["#F43F5E", "#BE123C"]}
                        style={{
                          width: 60,
                          height: 60,
                          borderRadius: 30,
                          alignItems: "center",
                          justifyContent: "center",
                          shadowColor: "#F43F5E",
                          shadowOffset: { width: 0, height: 4 },
                          shadowOpacity: 0.4,
                          shadowRadius: 8,
                          elevation: 5,
                        }}
                      >
                        <Ionicons name="close" size={26} color="#fff" />
                      </LinearGradient>
                    </TouchableOpacity>
                    <Text style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: "#F43F5E" }}>Cancel</Text>
                  </View>
                )}
                {sosEnabled && (
                  <View style={{ alignItems: "center", gap: 6 }}>
                    <TouchableOpacity activeOpacity={0.7}
                      onPress={async () => {
                        if (sosSent) return;
                        setSosLoading(true);
                        try {
                          const resp = await fetch(`https://${process.env.EXPO_PUBLIC_DOMAIN}/api/sos`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                            body: JSON.stringify({ rideId }),
                          });
                          if (resp.ok) {
                            setSosSent(true);
                          } else {
                            showToast("SOS failed — please call emergency contacts directly");
                          }
                        } catch {
                          showToast("SOS failed — please call emergency contacts directly");
                        }
                        setSosLoading(false);
                      }}
                      disabled={sosLoading || sosSent}
                      style={{ opacity: sosSent ? 0.65 : 1 }}
                    >
                      <View style={{ alignItems: "center", justifyContent: "center" }}>
                        {/* Pulsing ring around SOS */}
                        {!sosSent && (
                          <Animated.View style={{
                            position: "absolute",
                            width: 72,
                            height: 72,
                            borderRadius: 36,
                            backgroundColor: "rgba(239,68,68,0.3)",
                            transform: [{ scale: sosRing }],
                            opacity: sosRingOp,
                          }} />
                        )}
                        <LinearGradient
                          colors={sosSent ? ["#6B7280", "#4B5563"] : ["#EF4444", "#B91C1C"]}
                          style={{
                            width: 60,
                            height: 60,
                            borderRadius: 30,
                            alignItems: "center",
                            justifyContent: "center",
                            shadowColor: sosSent ? "#6B7280" : "#EF4444",
                            shadowOffset: { width: 0, height: 4 },
                            shadowOpacity: 0.45,
                            shadowRadius: 8,
                            elevation: 6,
                          }}
                        >
                          {sosLoading ? (
                            <ActivityIndicator color="#fff" size="small" />
                          ) : (
                            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: "#fff", letterSpacing: 0.5 }}>
                              {sosSent ? "✓" : "SOS"}
                            </Text>
                          )}
                        </LinearGradient>
                      </View>
                    </TouchableOpacity>
                    <Text style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: sosSent ? C.textMuted : "#EF4444" }}>
                      {sosSent ? tl("sosSentShort") : "SOS"}
                    </Text>
                  </View>
                )}
              </View>
              </LinearGradient>
            </View>
          )}

          <View
            style={{
              backgroundColor: C.surface,
              borderRadius: 20,
              padding: 16,
              gap: 14,
              borderWidth: 1,
              borderColor: C.border,
            }}
          >
            <Text
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 14,
                color: C.text,
              }}
            >
              {tl("tripDetailsLabel")}
            </Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ alignItems: "center", gap: 4 }}>
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: "#10B981",
                  }}
                />
                <View
                  style={{
                    flex: 1,
                    width: 2,
                    backgroundColor: C.border,
                    minHeight: 20,
                  }}
                />
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: "#EF4444",
                  }}
                />
              </View>
              <View style={{ flex: 1, gap: 16 }}>
                <View>
                  <Text
                    style={{
                      fontFamily: "Inter_400Regular",
                      fontSize: 11,
                      color: C.textMuted,
                    }}
                  >
                    {tl("pickup")}
                  </Text>
                  <Text
                    style={{
                      fontFamily: "Inter_500Medium",
                      fontSize: 13,
                      color: C.text,
                      marginTop: 2,
                    }}
                  >
                    {ride?.pickupAddress}
                  </Text>
                </View>
                <View>
                  <Text
                    style={{
                      fontFamily: "Inter_400Regular",
                      fontSize: 11,
                      color: C.textMuted,
                    }}
                  >
                    {tl("dropoff")}
                  </Text>
                  <Text
                    style={{
                      fontFamily: "Inter_500Medium",
                      fontSize: 13,
                      color: C.text,
                      marginTop: 2,
                    }}
                  >
                    {ride?.dropAddress}
                  </Text>
                </View>
              </View>
            </View>
            <View
              style={{ height: 1, backgroundColor: C.border }}
            />
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
              }}
            >
              <Text
                style={{
                  fontFamily: "Inter_400Regular",
                  fontSize: 13,
                  color: C.textMuted,
                }}
              >
                {tl("fare")}
              </Text>
              <Text
                style={{
                  fontFamily: "Inter_700Bold",
                  fontSize: 16,
                  color: C.success,
                }}
              >
                Rs. {parseFloat(String(ride?.fare ?? 0)).toLocaleString()}
              </Text>
            </View>
          </View>

          <TouchableOpacity activeOpacity={0.7}
            onPress={openInMaps}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              backgroundColor: "#EFF6FF",
              borderRadius: 14,
              padding: 14,
              borderWidth: 1,
              borderColor: "#DBEAFE",
            }}
          >
            <Ionicons
              name="navigate-outline"
              size={16}
              color="#4285F4"
            />
            <Text
              style={{
                fontFamily: "Inter_600SemiBold",
                fontSize: 14,
                color: "#4285F4",
              }}
            >
              {tl("openInMaps")}
            </Text>
          </TouchableOpacity>

          {canCancel && (
            <TouchableOpacity activeOpacity={0.7}
              onPress={() => openUnifiedCancelModal()}
              disabled={cancelling}
              style={{
                alignItems: "center",
                padding: 16,
                borderRadius: 16,
                borderWidth: 1.5,
                borderColor: C.redBorder,
                backgroundColor: C.redBg,
                flexDirection: "row",
                justifyContent: "center",
                gap: 8,
              }}
            >
              {cancelling ? (
                <ActivityIndicator color={C.red} size="small" />
              ) : (
                <>
                  <Ionicons name="close-circle-outline" size={18} color={C.red} />
                  <Text
                    style={{
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 15,
                      color: C.red,
                    }}
                  >
                    {tl("cancelRideLabel")}
                  </Text>
                  {inGracePeriod && graceSecondsLeft !== null && (
                    <View style={{ backgroundColor: C.greenBg, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 }}>
                      <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 10, color: C.greenBright }}>
                        {tl("freeCancelShort")} · {Math.floor(graceSecondsLeft / 60)}:{String(graceSecondsLeft % 60).padStart(2, "0")}
                      </Text>
                    </View>
                  )}
                </>
              )}
            </TouchableOpacity>
          )}
        </Animated.View>
        <View style={{ height: 24 }} />
      </ScrollView>

      {cancelModalTarget && (
        <CancelModal
          target={cancelModalTarget}
          cancellationFee={effectiveCancellationFee}
          apiBase={rideApiBase}
          token={token}
          onClose={() => setCancelModalTarget(null)}
          onDone={(result) => {
            setCancelResult({
              cancellationFee: result?.cancellationFee,
              cancelReason: result?.cancelReason,
            });
            setRide((r: any) =>
              r ? { ...r, status: "cancelled" } : r,
            );
          }}
        />
      )}
    </View>
  );
}
