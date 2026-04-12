import Ionicons from "@expo/vector-icons/Ionicons";
import Head from "expo-router/head";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { T as Typ, Font } from "@/constants/typography";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { useLanguage } from "@/context/LanguageContext";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { CancelModal } from "@/components/CancelModal";
import type { CancelTarget } from "@/components/CancelModal";
import { API_BASE, unwrapApiResponse } from "@/utils/api";
import { LiveTrackMap } from "@/components/ride/LiveTrackMap";
import {
  ORDER_STATUS_MAP,
  RIDE_STATUS_MAP,
  PARCEL_STATUS_MAP,
  ORDER_STEPS,
  PARCEL_STEPS,
  RIDE_STEPS,
  getSocketRoom,
} from "@/lib/orderUtils";
import type { Socket } from "socket.io-client";

const C = Colors.light;

const LIVE_TRACKING_STATUSES = ["picked_up", "out_for_delivery", "in_transit", "accepted", "arrived"];

export default function OrderDetailScreen() {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const topPad = Math.max(insets.top, 12);
  /* Responsive breakpoints */
  const isTablet = Platform.OS === "web" && screenWidth >= 768;
  const isWide   = Platform.OS === "web" && screenWidth >= 1080;
  const mapHeight = Math.min(Math.max(screenWidth * 0.34, 140), 220);
  const { id: routeId, type, action } = useLocalSearchParams<{ id: string; type?: string; action?: string }>();
  const orderId = routeId;
  const isParcel = type === "parcel";
  const isRide = type === "ride";
  const { token } = useAuth();
  const { showToast } = useToast();
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  const STATUS_CONFIG = useMemo<Record<string, { color: string; bg: string; icon: string; label: string }>>(() => {
    const build = (map: Record<string, { color: string; bg: string; icon: string; labelKey: TranslationKey }>) =>
      Object.fromEntries(Object.entries(map).map(([k, v]) => [k, { ...v, label: T(v.labelKey) }]));
    return {
      ...build(ORDER_STATUS_MAP),
      ...build(RIDE_STATUS_MAP),
      ...build(PARCEL_STATUS_MAP),
    };
  }, [language]);

  const STEP_LABELS = [T("statusPlaced"), T("confirmed"), T("preparing"), T("readyForPickup"), T("statusOnWay"), T("delivered")];
  const PARCEL_STEP_LABELS = [T("statusPlaced"), T("statusAccepted"), T("inTransit"), T("delivered")];
  const RIDE_STEP_LABELS = [T("searching"), T("statusAccepted"), T("arrived"), T("inTransit"), T("completed")];

  const [order, setOrder] = useState<any>(null);
  const [serverNow, setServerNow] = useState<number>(Date.now());
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [refundRequesting, setRefundRequesting] = useState(false);
  const [refundRequested, setRefundRequested] = useState(false);
  const [riderLat, setRiderLat] = useState<number | null>(null);
  const [riderLng, setRiderLng] = useState<number | null>(null);
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [trackFailed, setTrackFailed] = useState(false);

  const navigation = useNavigation();

  const goBack = () => {
    if (navigation.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/orders");
    }
  };

  const mountedRef = useRef(true);
  const socketRef = useRef<Socket | null>(null);
  const socketActiveRef = useRef(false);
  const isPharmacyType = type === "pharmacy";

  const interpFromRef = useRef<{ lat: number; lng: number } | null>(null);
  const interpToRef   = useRef<{ lat: number; lng: number } | null>(null);
  const interpRenderedRef = useRef<{ lat: number; lng: number } | null>(null);
  const interpStartRef = useRef<number>(0);
  const interpRafRef   = useRef<number | null>(null);
  const INTERP_DURATION_MS = 4000;

  const animateToLocation = (newLat: number, newLng: number) => {
    if (!mountedRef.current) return;
    const renderedLat = interpRenderedRef.current?.lat ?? interpToRef.current?.lat ?? newLat;
    const renderedLng = interpRenderedRef.current?.lng ?? interpToRef.current?.lng ?? newLng;
    if (interpRafRef.current !== null) { cancelAnimationFrame(interpRafRef.current); interpRafRef.current = null; }
    interpFromRef.current = { lat: renderedLat, lng: renderedLng };
    interpToRef.current   = { lat: newLat, lng: newLng };
    interpStartRef.current = performance.now();
    const tick = (now: number) => {
      if (!mountedRef.current) return;
      const from = interpFromRef.current!;
      const to   = interpToRef.current!;
      const t    = Math.min((now - interpStartRef.current) / INTERP_DURATION_MS, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const lat = from.lat + (to.lat - from.lat) * ease;
      const lng = from.lng + (to.lng - from.lng) * ease;
      interpRenderedRef.current = { lat, lng };
      setRiderLat(lat);
      setRiderLng(lng);
      if (t < 1) {
        interpRafRef.current = requestAnimationFrame(tick);
      } else {
        interpRafRef.current = null;
      }
    };
    interpRafRef.current = requestAnimationFrame(tick);
  };

  /* Combined socket + polling-fallback effect.
     Socket is established first; polling only activates if the socket
     fails to connect within SOCKET_TIMEOUT_MS, or later disconnects.
     If the socket connects after polling has already started, polling
     is stopped. */
  useEffect(() => {
    if (!orderId || !token || !order) return;
    const isTerminal = ["delivered", "cancelled", "completed"].includes(order.status ?? "");
    if (isTerminal) return;

    const isLiveTracking = LIVE_TRACKING_STATUSES.includes(order.status);
    const SOCKET_TIMEOUT_MS = 8000;

    const effectiveType = order.type ?? (isRide ? "ride" : isParcel ? "parcel" : "mart");
    const room = getSocketRoom(orderId, effectiveType);
    const domain = process.env.EXPO_PUBLIC_DOMAIN ?? "";
    const socketUrl = `https://${domain}`;

    let socket: Socket | null = null;
    let isCancelled = false;
    let retryCount = 0;
    const MAX_RETRIES = 3;

    let ivRef: ReturnType<typeof setInterval> | null = null;
    let fallbackTimeout: ReturnType<typeof setTimeout> | null = null;
    let fallbackStarted = false;
    let socketConnected = false;

    const fetchTrack = async () => {
      if (!isLiveTracking) return;
      try {
        const endpoint = isParcel || isRide
          ? `${API_BASE}/rides/${orderId}/track`
          : isPharmacyType
          ? `${API_BASE}/pharmacy-orders/${orderId}/track`
          : `${API_BASE}/orders/${orderId}/track`;
        const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const d = unwrapApiResponse(await res.json());
          if (mountedRef.current) {
            if (typeof d.riderLat === "number" && typeof d.riderLng === "number") {
              animateToLocation(d.riderLat, d.riderLng);
            } else {
              setRiderLat(null);
              setRiderLng(null);
            }
            setEtaMinutes(d.etaMinutes ?? null);
            setTrackFailed(false);
          }
        }
      } catch {
        if (mountedRef.current) setTrackFailed(true);
      }
    };

    const stopPolling = () => {
      if (ivRef !== null) { clearInterval(ivRef); ivRef = null; }
    };

    const startPollingFallback = () => {
      if (fallbackStarted || !isLiveTracking) return;
      fallbackStarted = true;
      ivRef = setInterval(fetchTrack, 15000);
      fetchTrack();
    };

    import("socket.io-client").then(({ io }) => {
      if (isCancelled) return;

      socket = io(socketUrl, {
        path: "/api/socket.io",
        query: { rooms: room },
        auth: { token },
        extraHeaders: { Authorization: `Bearer ${token}` },
        transports: ["polling", "websocket"],
        reconnection: false,
      });

      if (isCancelled) { socket.disconnect(); socket = null; return; }

      socketRef.current = socket;

      fallbackTimeout = setTimeout(() => {
        if (!socketConnected && !isCancelled) startPollingFallback();
      }, SOCKET_TIMEOUT_MS);

      socket.on("connect", () => {
        socketConnected = true;
        socketActiveRef.current = true;
        retryCount = 0;
        socket?.emit("join", room);
        if (fallbackTimeout !== null) { clearTimeout(fallbackTimeout); fallbackTimeout = null; }
        stopPolling();
        fallbackStarted = false;
      });

      socket.on("disconnect", () => {
        socketConnected = false;
        socketActiveRef.current = false;
        startPollingFallback();
      });

      socket.on("connect_error", () => {
        if (!socketConnected) {
          if (retryCount < MAX_RETRIES) {
            retryCount++;
            const delay = Math.pow(2, retryCount) * 500;
            setTimeout(() => {
              if (!isCancelled && socket) {
                socket.disconnect();
                socket = null;
                socketRef.current = null;
              }
            }, delay);
          } else {
            startPollingFallback();
          }
        }
      });

      socket.on("rider:location", (payload: { latitude: number; longitude: number; orderId?: string; rideId?: string }) => {
        const payloadOrderId = payload.orderId ?? payload.rideId;
        if (!payloadOrderId || payloadOrderId !== orderId) return;
        if (mountedRef.current) animateToLocation(payload.latitude, payload.longitude);
      });

      socket.on("order:update", (updated: any) => {
        if (!updated || updated.id !== orderId) return;
        if (mountedRef.current) setOrder((prev: any) => prev ? { ...prev, ...updated } : updated);
      });
    });

    return () => {
      isCancelled = true;
      socketActiveRef.current = false;
      if (fallbackTimeout !== null) { clearTimeout(fallbackTimeout); fallbackTimeout = null; }
      stopPolling();
      if (socket) {
        socket.emit("leave", room);
        socket.disconnect();
      }
      socketRef.current = null;
      if (interpRafRef.current !== null) {
        cancelAnimationFrame(interpRafRef.current);
        interpRafRef.current = null;
      }
    };
  }, [order?.status, orderId, token, isRide, isParcel, isPharmacyType]);

  useEffect(() => {
    mountedRef.current = true;
    if (!orderId) return;
    const endpoint = isParcel
      ? `${API_BASE}/parcel-bookings/${orderId}`
      : isPharmacyType
      ? `${API_BASE}/pharmacy-orders/${orderId}`
      : isRide
      ? `${API_BASE}/rides/${orderId}`
      : `${API_BASE}/orders/${orderId}`;
    let ivRef: ReturnType<typeof setInterval> | null = null;
    const fetchAndMaybeClear = async (isInitial = false) => {
      if (!isInitial && socketActiveRef.current) return;
      try {
        const res = await fetch(endpoint, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const serverDate = res.headers.get("Date");
        if (serverDate && mountedRef.current) {
          const parsed = new Date(serverDate).getTime();
          setServerNow(Number.isFinite(parsed) ? parsed : Date.now());
        } else if (mountedRef.current) {
          setServerNow(Date.now());
        }
        const data = unwrapApiResponse(await res.json());
        const fetched = data.order || data.booking || data;
        if (mountedRef.current) {
          setOrder(fetched);
          if (fetched && ["delivered", "cancelled", "completed"].includes(fetched.status)) {
            if (ivRef !== null) clearInterval(ivRef);
          }
        }
      } catch {
        if (mountedRef.current) {
          showToast(isParcel ? T("parcelLoadError") : T("orderLoadError"), "error");
        }
      }
      if (mountedRef.current) setLoading(false);
    };
    fetchAndMaybeClear(true);
    ivRef = setInterval(() => fetchAndMaybeClear(false), 10000);
    return () => {
      mountedRef.current = false;
      if (ivRef !== null) clearInterval(ivRef);
    };
  }, [orderId, isParcel, isRide]);

  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId || !token || isParcel || isRide) return;
    if (isPharmacyType) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/payments/${encodeURIComponent(orderId)}/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const d = unwrapApiResponse(await res.json());
          if (mountedRef.current && d.status) {
            setPaymentStatus(d.status);
          }
        } else if (mountedRef.current) {
          showToast(T("orderLoadError"), "error");
        }
      } catch (err) {
        console.warn("[OrderDetail] payment status fetch failed:", err);
        if (mountedRef.current) showToast(T("orderLoadError"), "error");
      }
    })();
  }, [orderId, token, isParcel, isRide, isPharmacyType]);

  useEffect(() => {
    if (!orderId || !token || isParcel || isRide || isPharmacyType) return;
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        (async () => {
          try {
            const res = await fetch(`${API_BASE}/payments/${encodeURIComponent(orderId)}/status`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
              const d = unwrapApiResponse(await res.json());
              if (mountedRef.current && d.status) {
                setPaymentStatus(d.status);
              }
            }
          } catch (err) {
            console.warn("[OrderDetail] payment status background refresh failed:", err);
          }
        })();
      }
    });
    return () => sub.remove();
  }, [orderId, token, isParcel, isRide, isPharmacyType]);


  if (loading) {
    return (
      <View style={[s.root, { paddingTop: topPad }]}>
        <View style={s.loadingWrap}>
          <ActivityIndicator color={C.primary} size="large" />
          <Text style={s.loadingText}>{isParcel ? T("loadingParcel") : isRide ? T("loadingRide") : T("loadingOrder")}</Text>
        </View>
      </View>
    );
  }

  if (!order) {
    return (
      <View style={[s.root, { paddingTop: topPad }]}>
        <View style={s.headerBar}>
          <TouchableOpacity activeOpacity={0.7} onPress={goBack} style={s.backBtn}>
            <Ionicons name="chevron-back" size={20} color={C.text} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>{isParcel ? T("parcelDetails") : isRide ? T("rideDetails") : T("orderDetails")}</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={s.loadingWrap}>
          <Ionicons name="alert-circle-outline" size={48} color={C.textMuted} />
          <Text style={s.loadingText}>{isParcel ? T("parcelNotFound") : isRide ? T("rideNotFound") : T("orderNotFound")}</Text>
          <Text style={{ ...Typ.body, fontSize: 13, color: C.textMuted, marginTop: 4 }}>{T("orderNotFoundDesc" as TranslationKey)}</Text>
          <TouchableOpacity activeOpacity={0.7}
            onPress={() => router.replace("/(tabs)")}
            style={{ marginTop: 20, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: C.primary, borderRadius: 14 }}
          >
            <Text style={{ ...Typ.bodySemiBold, color: C.textInverse }}>{T("goToHome" as TranslationKey)}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const activeSteps = isParcel ? PARCEL_STEPS : isRide ? RIDE_STEPS : ORDER_STEPS;
  const activeStepLabels = isParcel ? PARCEL_STEP_LABELS : isRide ? RIDE_STEP_LABELS : STEP_LABELS;
  const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG["pending"]!;
  const isActive = !["delivered", "cancelled", "completed"].includes(order.status);
  const stepIdx = activeSteps.indexOf(order.status);
  const isFood = order.type === "food";
  const isPharmacy = order.type === "pharmacy" || type === "pharmacy";
  const isParcelType = isParcel || order.type === "parcel";

  const minutesSincePlaced = order.createdAt
    ? (serverNow - new Date(order.createdAt).getTime()) / 60000
    : 999;
  const cancelWindowMin = config.orderRules?.cancelWindowMin ?? 15;
  const canCancel = isParcelType
    ? ["pending", "accepted"].includes(order.status)
    : isRide
    ? ["searching", "bargaining", "accepted", "arrived"].includes(order.status)
    : ["pending", "confirmed"].includes(order.status) && minutesSincePlaced <= cancelWindowMin;

  const isDelivered = order.status === "delivered" || order.status === "completed";
  const isCashOrder = order.paymentMethod === "cod" || order.paymentMethod === "cash";
  const hasExistingRefund = order.refundStatus === "requested" || order.refundStatus === "approved" || order.refundStatus === "refunded";
  const canRequestRefund = isDelivered && !isCashOrder && !refundRequested && !hasExistingRefund;

  const orderShortId = `#${(order.id || orderId || "").slice(-8).toUpperCase()}`;
  const pageTitle = `Order ${orderShortId} — Tracking | AJKMart`;
  const pageDescription = `Track your ${isRide ? "ride" : isParcel ? "parcel" : "order"} ${orderShortId}. Current status: ${cfg?.label ?? order.status}.`;

  const handleRefundRequest = async () => {
    setRefundRequesting(true);
    try {
      const res = await fetch(`${API_BASE}/orders/${orderId}/refund-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const data = unwrapApiResponse(await res.json());
      if (!res.ok) throw new Error(data.error || "Refund request failed");
      setRefundRequested(true);
      showToast(T("refundSubmitted"), "success");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Refund request failed";
      showToast(msg, "error");
    }
    setRefundRequesting(false);
  };

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      {Platform.OS === "web" && (
        <Head>
          <title>{pageTitle}</title>
          <meta name="description" content={pageDescription} />
        </Head>
      )}

      <View style={s.headerBar}>
        <TouchableOpacity activeOpacity={0.7} onPress={goBack} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color={C.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{isParcel ? T("parcelDetails") : isRide ? T("rideDetails") : T("orderDetails")}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[s.scroll, isTablet && { alignSelf: "center", width: "100%", maxWidth: isWide ? 1100 : 800 }]}>
        {/* Two-column layout on desktop: left=status+tracking, right=items+actions */}
        <View style={isWide ? { flexDirection: "row", alignItems: "flex-start", gap: 20 } : undefined}>
        {/* LEFT COLUMN (or full-width on mobile): status, stepper, tracking */}
        <View style={isWide ? { flex: 1 } : undefined}>
        <View style={[s.statusCard, { borderColor: cfg.bg }]}>
          <View style={[s.statusIcon, { backgroundColor: cfg.bg }]}>
            <Ionicons name={cfg.icon as any} size={28} color={cfg.color} />
          </View>
          <Text style={[s.statusLabel, { color: cfg.color }]}>{cfg.label}</Text>
          <Text style={s.orderId}>{orderShortId}</Text>
          {isActive && order.estimatedTime && (
            <View style={s.etaChip}>
              <Ionicons name="time-outline" size={13} color={C.amber} />
              <Text style={s.etaText}>ETA: {order.estimatedTime}</Text>
            </View>
          )}
        </View>

        {order.status === "pending" && (
          <View style={{ backgroundColor: C.amberSoft, borderRadius: 14, borderWidth: 1, borderColor: C.amberBorder, padding: 14, flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 4 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: C.amber, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Ionicons name="storefront-outline" size={20} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ ...Typ.body, fontFamily: Font.bold, color: C.amberDark }}>{T("awaitingVendorAccept" as TranslationKey)}</Text>
              <Text style={{ ...Typ.caption, color: C.amber, marginTop: 3, lineHeight: 18 }}>{T("awaitingVendorNote" as TranslationKey)}</Text>
            </View>
          </View>
        )}

        {isActive && LIVE_TRACKING_STATUSES.includes(order.status) && (
          <View style={[s.card, { backgroundColor: C.emeraldBg, borderColor: C.emeraldMid, padding: 0, overflow: "hidden" }]}>
            {trackFailed && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.amberSoft, borderBottomWidth: 1, borderBottomColor: C.amberBorder, paddingHorizontal: 14, paddingVertical: 10 }}>
                <Ionicons name="warning-outline" size={15} color={C.amber} />
                <Text style={{ ...Typ.caption, color: C.amberDark, flex: 1 }}>{T("trackingUnavailableMsg" as TranslationKey)}</Text>
              </View>
            )}
            {trackFailed ? (
              <View style={{ width: "100%", height: mapHeight, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.surfaceSecondary }}>
                <Ionicons name="map-outline" size={28} color={C.textMuted} />
                <Text style={{ ...Typ.caption, color: C.textMuted, textAlign: "center", paddingHorizontal: 16 }}>
                  {T("mapUnavailableMsg" as TranslationKey)}
                </Text>
              </View>
            ) : (
              <LiveTrackMap
                orderId={orderId}
                type={isRide ? "ride" : isParcel ? "parcel" : isPharmacyType ? "pharmacy" : "order"}
                token={token ?? ""}
                destLat={isRide ? order?.dropLat : order?.deliveryLat}
                destLng={isRide ? order?.dropLng : order?.deliveryLng}
                destLabel={isRide ? "Drop-off" : "Delivery"}
                height={mapHeight}
                lang={language}
                riderLat={riderLat}
                riderLng={riderLng}
              />
            )}
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: riderLat ? 10 : 0 }}>
                <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: C.emerald, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="navigate-outline" size={20} color={C.textInverse} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...Typ.body, fontFamily: Font.bold, color: C.emeraldDeep }}>
                    {order.status === "in_transit" ? T("inTransit") : T("deliveryOnWay" as TranslationKey)}
                  </Text>
                  <Text style={{ ...Typ.caption, color: C.emeraldDark, marginTop: 2 }}>
                    {etaMinutes !== null ? `ETA: ~${etaMinutes} ${T("etaMin" as TranslationKey)}` : T("deliveryHeading" as TranslationKey)}
                  </Text>
                </View>
                <View style={{ backgroundColor: C.emerald, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                  <Text style={{ ...Typ.smallBold, color: C.textInverse }}>LIVE</Text>
                </View>
              </View>
              {order.deliveryAddress ? (
                <TouchableOpacity activeOpacity={0.7}
                  onPress={() => {
                    const encodedAddr = encodeURIComponent(order.deliveryAddress);
                    const url = Platform.OS === "ios"
                      ? `maps:?q=${encodedAddr}`
                      : `geo:0,0?q=${encodedAddr}`;
                    Linking.openURL(url).catch(() => {
                      Linking.openURL(`https://maps.google.com/?q=${encodedAddr}`);
                    });
                  }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: C.emeraldBorder }}
                >
                  <Ionicons name="location-outline" size={16} color={C.emerald} />
                  <Text style={{ flex: 1, ...Typ.caption, color: C.emeraldDeep }} numberOfLines={1}>
                    {order.deliveryAddress}
                  </Text>
                  <Ionicons name="open-outline" size={14} color={C.emerald} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        )}

        {isActive && stepIdx >= 0 && (
          <View style={s.stepperCard}>
            <Text style={s.sectionTitle}>{isRide ? T("rideProgressLabel") : T("orderProgressLabel")}</Text>
            <View style={s.stepperRow}>
              {activeSteps.map((step, i) => {
                const done = stepIdx >= i;
                const active = stepIdx === i;
                const isLast = i === activeSteps.length - 1;
                return (
                  <React.Fragment key={step}>
                    <View style={s.stepItem}>
                      <View style={[
                        s.stepDot,
                        done && { backgroundColor: active ? cfg.color : C.emeraldDot },
                        active && { shadowColor: cfg.color, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 6 },
                      ]}>
                        {done
                          ? <Ionicons name="checkmark" size={13} color={C.textInverse} />
                          : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.slate }} />}
                      </View>
                      <Text style={[s.stepLabel, done && { color: C.text }, active && { fontFamily: Font.bold }]}>
                        {activeStepLabels[i]}
                      </Text>
                    </View>
                    {!isLast && (
                      <View style={[s.stepLine, stepIdx > i && { backgroundColor: C.emeraldDot }]} />
                    )}
                  </React.Fragment>
                );
              })}
            </View>
          </View>
        )}
        </View>{/* END LEFT COLUMN */}

        {/* RIGHT COLUMN (or full-width on mobile): items, rider, payment, actions */}
        <View style={isWide ? { flex: 1 } : undefined}>

        {isRide ? (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <View style={[s.typeChip, { backgroundColor: C.amberSoft }]}>
                <Ionicons name="car-outline" size={13} color={C.amber} />
                <Text style={[s.typeChipText, { color: C.amber }]}>Ride · {(order.type || "").charAt(0).toUpperCase() + (order.type || "").slice(1)}</Text>
              </View>
            </View>
            <View style={{ gap: 12, marginTop: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.emeraldDot, marginTop: 4 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...Typ.small, color: C.textMuted }}>{T("pickup")}</Text>
                  <Text style={{ ...Typ.bodyMedium, fontSize: 13, color: C.text, marginTop: 2 }}>{order.pickupAddress || "—"}</Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.redBright, marginTop: 4 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...Typ.small, color: C.textMuted }}>{T("dropOff")}</Text>
                  <Text style={{ ...Typ.bodyMedium, fontSize: 13, color: C.text, marginTop: 2 }}>{order.dropAddress || "—"}</Text>
                </View>
              </View>
              {order.distance ? (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1, backgroundColor: C.surfaceSecondary, borderRadius: 10, padding: 10, alignItems: "center" }}>
                    <Text style={{ ...Typ.small, color: C.textMuted }}>{T("distanceLabel" as TranslationKey)}</Text>
                    <Text style={{ ...Typ.body, fontFamily: Font.bold, color: C.text, marginTop: 2 }}>{Number.isFinite(parseFloat(order.distance)) ? parseFloat(order.distance).toFixed(1) : "—"} km</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: C.surfaceSecondary, borderRadius: 10, padding: 10, alignItems: "center" }}>
                    <Text style={{ ...Typ.small, color: C.textMuted }}>{T("fareLabel" as TranslationKey)}</Text>
                    <Text style={{ ...Typ.body, fontFamily: Font.bold, color: C.amber, marginTop: 2 }}>Rs. {Number.isFinite(parseFloat(order.fare)) ? parseFloat(order.fare).toLocaleString() : "0"}</Text>
                  </View>
                </View>
              ) : (
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>{T("fareLabel" as TranslationKey)}</Text>
                  <Text style={s.totalAmount}>Rs. {Number.isFinite(parseFloat(order.fare)) ? parseFloat(order.fare).toLocaleString() : "0"}</Text>
                </View>
              )}
            </View>
          </View>
        ) : (
          <View style={s.card}>
            <View style={s.cardHeader}>
              {isPharmacy ? (
                <View style={[s.typeChip, { backgroundColor: C.purpleLight }]}>
                  <Ionicons name="medical-outline" size={13} color={C.purple} />
                  <Text style={[s.typeChipText, { color: C.purple }]}>{T("pharmacy")}</Text>
                </View>
              ) : isParcelType ? (
                <View style={[s.typeChip, { backgroundColor: C.emeraldBg }]}>
                  <Ionicons name="cube-outline" size={13} color={C.emerald} />
                  <Text style={[s.typeChipText, { color: C.emerald }]}>{T("parcel")}</Text>
                </View>
              ) : (
                <View style={[s.typeChip, { backgroundColor: isFood ? C.amberSoft : C.blueSoft }]}>
                  <Ionicons name={isFood ? "restaurant-outline" : "storefront-outline"} size={13} color={isFood ? C.amber : C.brandBlue} />
                  <Text style={[s.typeChipText, { color: isFood ? C.amber : C.brandBlue }]}>{isFood ? T("food" as TranslationKey) : T("mart" as TranslationKey)}</Text>
                </View>
              )}
              {order.vendorName && <Text style={s.vendorName}>{order.vendorName}</Text>}
            </View>

            {isPharmacy && order.prescriptionNote ? (
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: C.purpleLight, borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: C.purpleBorder }}>
                <Ionicons name="document-text-outline" size={16} color={C.purple} style={{ marginTop: 1 }} />
                <Text style={{ ...Typ.body, fontSize: 13, color: C.purpleDeep, flex: 1, lineHeight: 19 }}>{order.prescriptionNote}</Text>
              </View>
            ) : null}

            <Text style={s.sectionTitle}>{T("items")}</Text>
            {(order.items || []).map((item: any, i: number) => (
              <View key={i} style={s.itemRow}>
                <View style={s.itemQty}>
                  <Text style={s.itemQtyText}>{item.quantity}×</Text>
                </View>
                <Text style={s.itemName} numberOfLines={2}>{item.name}</Text>
                <Text style={s.itemPrice}>Rs. {item.price * item.quantity}</Text>
              </View>
            ))}

            <View style={s.totalRow}>
              <Text style={s.totalLabel}>{T("totalLabel")}</Text>
              <Text style={s.totalAmount}>Rs. {(order.total != null && Number.isFinite(Number(order.total)) ? Number(order.total) : 0).toLocaleString()}</Text>
            </View>
          </View>
        )}

        {!isRide && order.deliveryAddress && (
          <View style={s.card}>
            <Text style={s.sectionTitle}>{T("deliveryAddress")}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: C.blueSoft, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="location-outline" size={18} color={C.primary} />
              </View>
              <Text style={s.addressText}>{order.deliveryAddress}</Text>
            </View>
          </View>
        )}

        {order.riderName && (
          <View style={s.card}>
            <Text style={s.sectionTitle}>{isRide ? T("yourDriver") : T("deliveryRider")}</Text>
            <View style={s.riderRow}>
              <View style={s.riderAvatar}>
                <Text style={s.riderInitial}>{order.riderName.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.riderName}>{order.riderName}</Text>
                {order.riderPhone && <Text style={s.riderPhone}>{order.riderPhone}</Text>}
              </View>
              {order.riderPhone && (
                <TouchableOpacity activeOpacity={0.7} onPress={() => Linking.openURL(`tel:${order.riderPhone}`)} style={s.callBtn}>
                  <Ionicons name="call" size={18} color={C.textInverse} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        <View style={s.card}>
          <Text style={s.sectionTitle}>{T("payment")}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: C.emeraldSoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons
                name={
                  order.paymentMethod === "wallet"
                    ? "wallet-outline"
                    : order.paymentMethod === "jazzcash" || order.paymentMethod === "easypaisa"
                    ? "phone-portrait-outline"
                    : "cash-outline"
                }
                size={18}
                color={C.emerald}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.paymentText}>
                {order.paymentMethod === "wallet"
                  ? T("paymentWallet" as TranslationKey)
                  : order.paymentMethod === "jazzcash"
                  ? T("paymentJazzCash" as TranslationKey)
                  : order.paymentMethod === "easypaisa"
                  ? T("paymentEasyPaisa" as TranslationKey)
                  : T("cashOnDelivery")}
              </Text>
              {paymentStatus && paymentStatus !== "pending" && (
                <Text style={{
                  ...Typ.small, marginTop: 2,
                  color: paymentStatus === "completed" || paymentStatus === "success" ? C.emerald
                    : paymentStatus === "failed" || paymentStatus === "expired" ? C.red
                    : C.textMuted,
                }}>
                  {paymentStatus === "completed" || paymentStatus === "success" ? T("paymentConfirmed" as TranslationKey)
                    : paymentStatus === "failed" ? T("paymentFailedLabel" as TranslationKey)
                    : paymentStatus === "expired" ? T("paymentExpiredLabel" as TranslationKey)
                    : `Status: ${paymentStatus}`}
                </Text>
              )}
            </View>
          </View>
        </View>

        {canCancel ? (
          <TouchableOpacity activeOpacity={0.7}
            style={[s.cancelOrderBtn, refundRequesting && { opacity: 0.5 }]}
            disabled={refundRequesting}
            onPress={() => {
              const cancelMinsLeft = isParcelType
                ? undefined
                : Math.max(0, Math.ceil(cancelWindowMin - minutesSincePlaced));
              setCancelTarget({
                id: order.id,
                type: isRide ? "ride" : isParcelType ? "parcel" : isPharmacy ? "pharmacy" : "order",
                status: order.status,
                total: isRide ? parseFloat(order.fare ?? "0") : isParcelType ? parseFloat(order.fare ?? order.total ?? "0") : order.total,
                paymentMethod: order.paymentMethod,
                cancelMinsLeft,
              });
            }}
          >
            <Ionicons name="close-circle-outline" size={16} color={C.red} />
            <Text style={s.cancelOrderBtnText}>{isRide ? T("cancelRide") : isParcelType ? T("cancelBooking") : T("cancelOrder")}</Text>
          </TouchableOpacity>
        ) : isActive && !isDelivered && (
          <View style={s.cancelDisabledBtn}>
            <Ionicons name="close-circle-outline" size={16} color={C.textMuted} />
            <Text style={s.cancelDisabledBtnText}>
              {T("cancelOrder")} — {["preparing", "ready", "picked_up"].includes(order.status)
                ? T("orderPreparing" as TranslationKey)
                : order.status === "out_for_delivery" || order.status === "in_transit"
                ? T("deliveryOnWay" as TranslationKey)
                : T("cancelWindowPassed")}
            </Text>
          </View>
        )}

        {canRequestRefund && (
          <View style={s.refundSection}>
            <Text style={s.refundTitle}>{T("requestRefund")}</Text>
            <Text style={s.refundDesc}>{T("refundDescText" as TranslationKey)}</Text>
            <TouchableOpacity activeOpacity={0.7}
              style={[s.refundBtn, refundRequesting && { opacity: 0.6 }]}
              onPress={handleRefundRequest}
              disabled={refundRequesting}
            >
              {refundRequesting ? <ActivityIndicator color={C.textInverse} size="small" /> : (
                <>
                  <Ionicons name="return-down-back-outline" size={16} color={C.textInverse} />
                  <Text style={s.refundBtnText}>{T("requestRefund")}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {(refundRequested || hasExistingRefund) && (
          <View style={s.refundSuccessBox}>
            <Ionicons name="checkmark-circle" size={20} color={C.emerald} />
            <Text style={s.refundSuccessText}>
              {order.refundStatus === "approved" || order.refundStatus === "refunded"
                ? T("refundProcessed" as TranslationKey)
                : T("refundSubmitted" as TranslationKey)}
            </Text>
          </View>
        )}

        </View>{/* END RIGHT COLUMN */}
        </View>{/* END TWO-COLUMN WRAPPER */}
        <View style={{ height: 40 }} />
      </ScrollView>

      {cancelTarget && (
        <CancelModal
          target={cancelTarget}
          cancellationFee={order?.cancellationFee ?? config.rides?.cancellationFee ?? 0}
          apiBase={API_BASE}
          token={token}
          onClose={() => setCancelTarget(null)}
          onDone={(_result) => {
            showToast(T("orderCancelledSuccess"), "success");
            setOrder((prev: any) => prev ? { ...prev, status: "cancelled" } : prev);
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },
  headerBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...Typ.h3, color: C.text },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { ...Typ.body, color: C.textMuted },
  scroll: { padding: 16, gap: 14 },
  statusCard: {
    backgroundColor: C.surface, borderRadius: 20, padding: 24, alignItems: "center",
    borderWidth: 1.5, gap: 8,
  },
  statusIcon: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  statusLabel: { ...Typ.title },
  orderId: { ...Typ.bodyMedium, fontSize: 13, color: C.textMuted },
  etaChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.amberSoft, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, marginTop: 4 },
  etaText: { ...Typ.captionMedium, fontFamily: Font.semiBold, color: C.amberDark },
  stepperCard: { backgroundColor: C.surface, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: C.border },
  sectionTitle: { ...Typ.body, fontFamily: Font.bold, color: C.text, marginBottom: 14 },
  stepperRow: { flexDirection: "row", alignItems: "flex-start", overflow: "hidden" },
  stepItem: { alignItems: "center", flex: 1, gap: 6, minWidth: 0 },
  stepDot: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: C.background,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  stepLabel: { ...Typ.small, fontSize: 9, textAlign: "center", color: C.textMuted, maxWidth: "100%", flexShrink: 1 },
  stepLine: { height: 2, flex: 0.3, backgroundColor: C.background, marginTop: 13, borderRadius: 1, flexShrink: 1 },
  card: { backgroundColor: C.surface, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: C.border },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  typeChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  typeChipText: { ...Typ.captionMedium, fontFamily: Font.semiBold },
  vendorName: { ...Typ.bodySemiBold, color: C.text },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  itemQty: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  itemQtyText: { ...Typ.captionBold, color: C.primary },
  itemName: { flex: 1, ...Typ.bodyMedium, fontSize: 13, color: C.text },
  itemPrice: { ...Typ.buttonSmall, color: C.text },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14, paddingTop: 14, borderTopWidth: 1.5, borderTopColor: C.border },
  totalLabel: { ...Typ.button, fontFamily: Font.bold, color: C.text },
  totalAmount: { ...Typ.title, color: C.success },
  addressText: { flex: 1, ...Typ.bodyMedium, fontSize: 13, color: C.text, lineHeight: 20 },
  riderRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  riderAvatar: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.blueSoft, alignItems: "center", justifyContent: "center" },
  riderInitial: { ...Typ.h3, color: C.primary },
  riderName: { ...Typ.bodySemiBold, color: C.text },
  riderPhone: { ...Typ.caption, color: C.textMuted, marginTop: 2 },
  callBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" },
  paymentText: { ...Typ.bodyMedium, color: C.text },
  cancelOrderBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: 16, backgroundColor: C.redBg,
    borderWidth: 1.5, borderColor: C.redBorder,
  },
  cancelOrderBtnText: { ...Typ.button, color: C.red },
  refundSection: {
    backgroundColor: C.orangeBg, borderRadius: 16, padding: 18,
    borderWidth: 1.5, borderColor: C.orangeBorder, gap: 8,
  },
  refundTitle: { ...Typ.button, fontFamily: Font.bold, color: C.orangeDark },
  refundDesc: { ...Typ.body, fontSize: 13, color: C.orangeDark, lineHeight: 20 },
  refundBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 12, borderRadius: 12, backgroundColor: C.orangeBrand, marginTop: 4,
  },
  refundBtnText: { ...Typ.bodySemiBold, color: C.textInverse },
  refundSuccessBox: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.emeraldSoft, borderRadius: 16, padding: 16,
    borderWidth: 1.5, borderColor: C.emeraldBorder,
  },
  refundSuccessText: { ...Typ.bodyMedium, fontSize: 13, color: C.emeraldDeep, flex: 1 },
  cancelDisabledBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14, backgroundColor: C.surfaceSecondary,
    borderWidth: 1, borderColor: C.border, opacity: 0.65,
  },
  cancelDisabledBtnText: { ...Typ.bodyMedium, fontSize: 13, color: C.textMuted },
});
