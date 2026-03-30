import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { router } from "expo-router";
import { useMapsAutocomplete, resolveLocation } from "@/hooks/useMaps";
import type { MapPrediction } from "@/hooks/useMaps";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { useApiCall } from "@/hooks/useApiCall";
import { API_BASE } from "@/utils/api";
import { ServiceListSkeleton, FareEstimateSkeleton } from "@/components/ride/Skeletons";
import {
  estimateFare,
  bookRide,
  getRideStops,
  getRideServices,
  getRideHistory,
  getSchoolRoutes,
  subscribeSchoolRoute,
  geocodeAddress,
  updateLocation,
} from "@workspace/api-client-react";
import type {
  BookRideRequest,
  EstimateFareRequest,
} from "@workspace/api-client-react";

const C = Colors.light;

type PopularSpot = {
  id: string;
  name: string;
  nameUrdu?: string;
  lat: number;
  lng: number;
  icon?: string;
  category?: string;
};

type ServiceType = {
  key: string;
  name: string;
  nameUrdu?: string;
  icon: string;
  color?: string;
  baseFare: number;
  perKm: number;
  minFare: number;
  maxPassengers: number;
  description?: string;
  allowBargaining?: boolean;
};

type BookedRide = {
  id: string;
  type?: string;
  status?: string;
  fare?: number;
  isBargaining?: boolean;
  effectiveFare?: number;
};

type RideBookingFormProps = {
  onBooked: (ride: BookedRide) => void;
};

export function RideBookingForm({ onBooked }: RideBookingFormProps) {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const { user, updateUser, token } = useAuth();
  const { showToast } = useToast();
  const { config } = usePlatformConfig();
  const rideCfg = config.rides;

  const DEFAULT_SERVICES: ServiceType[] = [
    {
      key: "bike",
      name: "Bike",
      icon: "🏍️",
      baseFare: 50,
      perKm: 15,
      minFare: 50,
      maxPassengers: 1,
      allowBargaining: true,
    },
    {
      key: "car",
      name: "Car",
      icon: "🚗",
      baseFare: 150,
      perKm: 25,
      minFare: 150,
      maxPassengers: 4,
      allowBargaining: true,
    },
    {
      key: "rickshaw",
      name: "Rickshaw",
      icon: "🛺",
      baseFare: 80,
      perKm: 18,
      minFare: 80,
      maxPassengers: 3,
      allowBargaining: true,
    },
  ];

  const [pickup, setPickup] = useState("");
  const [drop, setDrop] = useState("");
  const [pickupObj, setPickupObj] = useState<{
    lat: number;
    lng: number;
    address: string;
  } | null>(null);
  const [dropObj, setDropObj] = useState<{
    lat: number;
    lng: number;
    address: string;
  } | null>(null);
  const [rideType, setRideType] = useState("bike");
  const [payMethod, setPayMethod] = useState("cash");
  const [services, setServices] = useState<ServiceType[]>(DEFAULT_SERVICES);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [payMethods, setPayMethods] = useState<
    { id: string; label?: string; name?: string }[]
  >([
    { id: "cash", label: "Cash" },
    { id: "wallet", label: "Wallet" },
  ]);
  const [estimate, setEstimate] = useState<{
    fare: number;
    dist: number;
    dur: string;
    baseFare: number;
    gstAmount: number;
    bargainEnabled: boolean;
    minOffer: number;
  } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [booking, setBooking] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [locDenied, setLocDenied] = useState(false);
  const [showBargain, setShowBargain] = useState(false);
  const [offeredFare, setOfferedFare] = useState("");
  const [bargainNote, setBargainNote] = useState("");
  const [pickupFocus, setPickupFocus] = useState(false);
  const [dropFocus, setDropFocus] = useState(false);
  const [popularSpots, setPopularSpots] = useState<PopularSpot[]>([]);
  const [schoolRoutes, setSchoolRoutes] = useState<any[]>([]);
  const [showSchoolModal, setShowSchoolModal] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<any>(null);
  const [schoolStudent, setSchoolStudent] = useState("");
  const [schoolClass, setSchoolClass] = useState("");
  const [subscribing, setSubscribing] = useState(false);
  const [debtBalance, setDebtBalance] = useState(0);
  const [debtDismissed, setDebtDismissed] = useState(false);
  const [estimateForType, setEstimateForType] = useState<string | null>(null);

  const { predictions: pickupPreds, loading: pickupLoading } =
    useMapsAutocomplete(pickupFocus ? pickup : "");
  const { predictions: dropPreds, loading: dropLoading } =
    useMapsAutocomplete(dropFocus ? drop : "");

  useEffect(() => {
    getRideStops()
      .then((data) => {
        if (data?.locations?.length) setPopularSpots(data.locations);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (rideType !== "school_shift") return;
    getSchoolRoutes()
      .then((data) => {
        if (data?.routes?.length) setSchoolRoutes(data.routes);
      })
      .catch(() => {});
  }, [rideType]);

  useEffect(() => {
    fetch(`${API_BASE}/rides/payment-methods`)
      .then((r) => r.json())
      .then((rideData) => {
        if (rideData?.methods?.length) {
          const mapped = rideData.methods.map((m: any) => ({
            id: m.key ?? m.id,
            label: m.label ?? m.name,
          }));
          setPayMethods(mapped);
          setPayMethod(mapped[0]!.id);
        }
      })
      .catch(() => {
        setPayMethods([
          { id: "cash", label: "Cash" },
          { id: "wallet", label: "Wallet" },
        ]);
        setPayMethod("cash");
      });
  }, []);

  useEffect(() => {
    setServicesLoading(true);
    getRideServices()
      .then((data) => {
        if (!data?.services?.length) return;
        setServices(data.services);
        setRideType((prev) =>
          data.services.find((s: ServiceType) => s.key === prev)
            ? prev
            : data.services[0]!.key,
        );
      })
      .catch(() => {})
      .finally(() => setServicesLoading(false));
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    fetch(`${API_BASE}/users/${user.id}/debt`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((d) => {
        if (d?.debtBalance > 0) setDebtBalance(d.debtBalance);
      })
      .catch(() => {});
  }, [user?.id]);

  const handleMyLocation = async () => {
    setLocLoading(true);
    setLocDenied(false);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocDenied(true);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude: lat, longitude: lng } = pos.coords;
      const data = await geocodeAddress({ address: `${lat},${lng}` });
      const address =
        data?.formattedAddress ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
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
    if (!pickupObj || !dropObj) {
      setEstimate(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setEstimating(true);
      estimateFare({
        pickupLat: pickupObj.lat,
        pickupLng: pickupObj.lng,
        dropLat: dropObj.lat,
        dropLng: dropObj.lng,
        type: rideType,
      } as EstimateFareRequest)
        .then(
          (
            data: Record<string, unknown> & {
              fare: number;
              distance: number;
              duration: string;
              type?: string;
            },
          ) => {
            if (cancelled || !data) return;
            setEstimateForType(data.type ?? rideType);
            setEstimate({
              fare: data.fare,
              dist: data.distance,
              dur: data.duration,
              baseFare: (data.baseFare as number | undefined) ?? data.fare,
              gstAmount: (data.gstAmount as number | undefined) ?? 0,
              bargainEnabled:
                (data.bargainEnabled as boolean | undefined) ?? false,
              minOffer: (data.minOffer as number | undefined) ?? data.fare,
            });
          },
        )
        .catch(() => {
          if (!cancelled) {
            setEstimate(null);
            setEstimateForType(null);
            showToast("Could not estimate fare. Please try again.", "error");
          }
        })
        .finally(() => {
          if (!cancelled) setEstimating(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pickupObj?.lat, pickupObj?.lng, dropObj?.lat, dropObj?.lng, rideType]);

  const selectPickup = useCallback(async (pred: MapPrediction) => {
    setPickup(pred.mainText);
    setPickupFocus(false);
    const loc = await resolveLocation(pred, (msg) => showToast(msg, "error"));
    if (!loc) {
      setPickup("");
      return;
    }
    setPickupObj({ ...loc, address: pred.description });
    setPickup(pred.description);
  }, [showToast]);

  const selectDrop = useCallback(async (pred: MapPrediction) => {
    setDrop(pred.mainText);
    setDropFocus(false);
    const loc = await resolveLocation(pred, (msg) => showToast(msg, "error"));
    if (!loc) {
      setDrop("");
      return;
    }
    setDropObj({ ...loc, address: pred.description });
    setDrop(pred.description);
  }, [showToast]);

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
    if (!user) {
      showToast("Please log in first", "error");
      return;
    }
    if (!selectedRoute) {
      showToast("Please select a route", "error");
      return;
    }
    if (!schoolStudent.trim()) {
      showToast("Please enter the student's name", "error");
      return;
    }
    if (!schoolClass.trim()) {
      showToast("Please enter the student's class", "error");
      return;
    }
    setSubscribing(true);
    try {
      await subscribeSchoolRoute({
        routeId: selectedRoute.id,
        studentName: schoolStudent.trim(),
        studentClass: schoolClass.trim(),
        paymentMethod: payMethod,
      });
      setShowSchoolModal(false);
      setSelectedRoute(null);
      setSchoolStudent("");
      setSchoolClass("");
      showToast(
        `${schoolStudent} has been subscribed to ${selectedRoute.schoolName}!`,
        "success",
      );
    } catch {
      showToast("Network error. Please try again.", "error");
    } finally {
      setSubscribing(false);
    }
  };

  const handleBook = async () => {
    if (!pickup || !drop) {
      showToast("Please select pickup and drop locations", "error");
      return;
    }
    if (!pickupObj) {
      showToast(
        "Please select pickup location from the list (exact location required)",
        "error",
      );
      return;
    }
    if (!dropObj) {
      showToast(
        "Please select drop location from the list (exact location required)",
        "error",
      );
      return;
    }
    if (!user) {
      showToast("Please log in to book a ride", "error");
      return;
    }
    if (!estimate) {
      showToast("Fare estimate is being calculated. Please wait.", "error");
      return;
    }
    if (estimateForType && estimateForType !== rideType) {
      showToast("Fare estimate is outdated. Please wait for it to refresh.", "error");
      return;
    }

    let parsedOffer: number | undefined;
    if (showBargain && offeredFare) {
      parsedOffer = parseFloat(offeredFare);
      if (isNaN(parsedOffer) || parsedOffer <= 0) {
        showToast("Please enter a valid amount for your offer", "error");
        return;
      }
      if (parsedOffer < estimate.minOffer) {
        showToast(
          `Minimum offer is Rs. ${estimate.minOffer} (${Math.round((estimate.minOffer / estimate.fare) * 100)}% of platform fare)`,
          "error",
        );
        return;
      }
    }

    const effectiveFare = parsedOffer ?? estimate.fare;
    if (
      payMethod === "wallet" &&
      (user.walletBalance ?? 0) < effectiveFare
    ) {
      showToast(
        `Wallet balance Rs. ${user.walletBalance} — less than Rs. ${effectiveFare} required. Please top up.`,
        "error",
      );
      return;
    }

    setBooking(true);
    try {
      const rideData = await bookRide({
        userId: user.id,
        type: rideType,
        pickupAddress: pickup,
        dropAddress: drop,
        pickupLat: pickupObj.lat,
        pickupLng: pickupObj.lng,
        dropLat: dropObj.lat,
        dropLng: dropObj.lng,
        paymentMethod: payMethod,
        ...(parsedOffer !== undefined && { offeredFare: parsedOffer }),
        ...(bargainNote && { bargainNote }),
      } as BookRideRequest);
      const bookedRide = rideData as BookedRide;
      if (payMethod === "wallet" && !bookedRide.isBargaining) {
        updateUser({
          walletBalance:
            (user.walletBalance ?? 0) -
            (bookedRide.effectiveFare ?? bookedRide.fare ?? 0),
        });
      }
      onBooked(bookedRide);

      (async () => {
        try {
          const perm = await Location.getForegroundPermissionsAsync();
          if (perm.status !== "granted") return;
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          await updateLocation({
            userId: user?.id ?? "",
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            role: "customer",
          });
        } catch (locErr) {
          if (__DEV__) console.warn("[location] ride booking update failed:", locErr);
          showToast("Ride booked, but location update failed", "info");
        }
      })();
    } catch (err: any) {
      const errData = err?.response?.data || err?.data;
      if (errData?.activeRideId) {
        onBooked({
          id: errData.activeRideId,
          type: rideType,
          status: errData.activeRideStatus,
        });
        showToast("You have an active ride. Resuming tracking.", "info");
      } else {
        const msg = errData?.error || "Network error. Please try again.";
        showToast(msg, "error");
      }
    } finally {
      setBooking(false);
    }
  };

  const fetchHistory = async () => {
    if (!user) return;
    setHistLoading(true);
    try {
      const data = await getRideHistory();
      setHistory(data?.rides || []);
    } catch {
      setHistory([]);
    } finally {
      setHistLoading(false);
    }
  };

  const selectedSvc = services.find((s) => s.key === rideType) ?? services[0];

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View
        style={{
          backgroundColor: "#fff",
          paddingTop: topPad + 12,
          paddingHorizontal: 20,
          paddingBottom: 18,
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}
      >
        <View style={rs.hdrRow}>
          <Pressable onPress={() => router.back()} style={rs.backBtn}>
            <Ionicons name="arrow-back" size={20} color={C.text} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 20,
                color: C.text,
              }}
            >
              Book a Ride
            </Text>
            <Text
              style={{
                fontFamily: "Inter_400Regular",
                fontSize: 12,
                color: C.textMuted,
                marginTop: 2,
              }}
            >
              Anywhere in AJK
            </Text>
          </View>
          <Pressable
            onPress={() => {
              setShowHistory(true);
              fetchHistory();
            }}
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: C.surfaceSecondary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="time-outline" size={20} color={C.textSecondary} />
          </Pressable>
        </View>

        <View
          style={{
            marginTop: 16,
            backgroundColor: C.surfaceSecondary,
            borderRadius: 16,
            padding: 14,
            borderWidth: 1,
            borderColor: C.border,
          }}
        >
          <Pressable
            onPress={handleMyLocation}
            disabled={locLoading}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingVertical: 6,
              paddingHorizontal: 4,
              marginBottom: 8,
            }}
          >
            {locLoading ? (
              <ActivityIndicator size="small" color={C.primary} />
            ) : (
              <Ionicons
                name="locate-outline"
                size={14}
                color={locDenied ? "#DC2626" : C.primary}
              />
            )}
            <Text
              style={{
                fontFamily: "Inter_500Medium",
                fontSize: 12,
                color: locDenied ? "#DC2626" : C.primary,
              }}
            >
              {locLoading
                ? "Locating..."
                : locDenied
                  ? "Location denied — tap to retry"
                  : "Use my location"}
            </Text>
          </Pressable>
          {locDenied && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 4,
                paddingBottom: 6,
                gap: 6,
              }}
            >
              <Ionicons name="warning-outline" size={12} color="#DC2626" />
              <Text
                style={{
                  fontFamily: "Inter_400Regular",
                  fontSize: 11,
                  color: "#DC2626",
                  flex: 1,
                }}
              >
                Enable location in device settings or type pickup manually.
              </Text>
            </View>
          )}

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: "#10B981",
              }}
            />
            <TextInput
              value={pickup}
              onChangeText={(v) => {
                setPickup(v);
                setPickupObj(null);
              }}
              onFocus={() => setPickupFocus(true)}
              onBlur={() => setTimeout(() => setPickupFocus(false), 250)}
              placeholder="Pickup location..."
              placeholderTextColor={C.textMuted}
              style={{
                flex: 1,
                fontFamily: "Inter_400Regular",
                fontSize: 15,
                color: C.text,
                paddingVertical: 10,
              }}
            />
            {pickup.length > 0 && (
              <Pressable
                onPress={() => {
                  setPickup("");
                  setPickupObj(null);
                }}
              >
                <Ionicons name="close-circle" size={16} color={C.textMuted} />
              </Pressable>
            )}
          </View>

          {pickupFocus && (
            <View style={rs.sugg}>
              {pickupLoading && (
                <ActivityIndicator
                  size="small"
                  color={C.primary}
                  style={{ padding: 8 }}
                />
              )}
              <ScrollView
                nestedScrollEnabled
                keyboardShouldPersistTaps="always"
              >
                {pickupPreds.slice(0, 6).map((pred) => (
                  <Pressable
                    key={pred.placeId}
                    onPress={() => selectPickup(pred)}
                    style={rs.suggRow}
                  >
                    <Ionicons
                      name="location-outline"
                      size={14}
                      color="#10B981"
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={rs.suggTxt}>{pred.mainText}</Text>
                      {pred.secondaryText ? (
                        <Text style={rs.suggSub} numberOfLines={1}>
                          {pred.secondaryText}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginVertical: 4,
              gap: 8,
            }}
          >
            <View
              style={{ flex: 1, height: 1, backgroundColor: C.border }}
            />
            <Pressable
              onPress={() => {
                const t = pickup;
                const to = pickupObj;
                setPickup(drop);
                setPickupObj(dropObj);
                setDrop(t);
                setDropObj(to);
              }}
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                backgroundColor: "#fff",
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              <Ionicons
                name="swap-vertical"
                size={14}
                color={C.primary}
              />
            </Pressable>
            <View
              style={{ flex: 1, height: 1, backgroundColor: C.border }}
            />
          </View>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: "#EF4444",
              }}
            />
            <TextInput
              value={drop}
              onChangeText={(v) => {
                setDrop(v);
                setDropObj(null);
              }}
              onFocus={() => setDropFocus(true)}
              onBlur={() => setTimeout(() => setDropFocus(false), 250)}
              placeholder="Drop-off location..."
              placeholderTextColor={C.textMuted}
              style={{
                flex: 1,
                fontFamily: "Inter_400Regular",
                fontSize: 15,
                color: C.text,
                paddingVertical: 10,
              }}
            />
            {drop.length > 0 && (
              <Pressable
                onPress={() => {
                  setDrop("");
                  setDropObj(null);
                }}
              >
                <Ionicons name="close-circle" size={16} color={C.textMuted} />
              </Pressable>
            )}
          </View>

          {dropFocus && (
            <View style={rs.sugg}>
              {dropLoading && (
                <ActivityIndicator
                  size="small"
                  color="#EF4444"
                  style={{ padding: 8 }}
                />
              )}
              <ScrollView
                nestedScrollEnabled
                keyboardShouldPersistTaps="always"
              >
                {dropPreds.slice(0, 6).map((pred) => (
                  <Pressable
                    key={pred.placeId}
                    onPress={() => selectDrop(pred)}
                    style={rs.suggRow}
                  >
                    <Ionicons
                      name="location-outline"
                      size={14}
                      color="#EF4444"
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={rs.suggTxt}>{pred.mainText}</Text>
                      {pred.secondaryText ? (
                        <Text style={rs.suggSub} numberOfLines={1}>
                          {pred.secondaryText}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 20 }}
      >
        {debtBalance > 0 && !debtDismissed && (
          <View
            style={{
              marginBottom: 14,
              backgroundColor: "#FEF2F2",
              borderWidth: 1,
              borderColor: "#FEE2E2",
              borderRadius: 16,
              padding: 16,
              gap: 10,
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
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  flex: 1,
                }}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    backgroundColor: "#FEE2E2",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="warning" size={18} color="#DC2626" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontFamily: "Inter_700Bold",
                      fontSize: 14,
                      color: "#991B1B",
                    }}
                  >
                    Outstanding Balance: Rs. {debtBalance}
                  </Text>
                  <Text
                    style={{
                      fontFamily: "Inter_400Regular",
                      fontSize: 12,
                      color: "#B91C1C",
                      marginTop: 2,
                    }}
                  >
                    You have an unpaid cancellation fee
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={() => setDebtDismissed(true)}
                hitSlop={8}
              >
                <Ionicons name="close" size={16} color="#991B1B" />
              </Pressable>
            </View>
            <Pressable
              onPress={() => router.push("/(tabs)/wallet")}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                backgroundColor: "#DC2626",
                borderRadius: 12,
                paddingVertical: 12,
              }}
            >
              <Ionicons name="wallet-outline" size={16} color="#fff" />
              <Text
                style={{
                  fontFamily: "Inter_700Bold",
                  fontSize: 13,
                  color: "#fff",
                }}
              >
                Pay Now
              </Text>
            </Pressable>
          </View>
        )}

        {popularSpots.length > 0 && (
          <>
            <Text
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 15,
                color: C.text,
                marginBottom: 10,
              }}
            >
              Popular Locations
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: 16, marginHorizontal: -20 }}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
            >
              {popularSpots.map((spot) => (
                <Pressable
                  key={spot.id}
                  onPress={() => handleChip(spot)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    backgroundColor: "#fff",
                    paddingHorizontal: 14,
                    paddingVertical: 9,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: C.border,
                  }}
                >
                  <Text style={{ fontSize: 12 }}>{spot.icon || "📍"}</Text>
                  <Text
                    style={{
                      fontFamily: "Inter_500Medium",
                      fontSize: 12,
                      color: C.text,
                    }}
                  >
                    {spot.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {rideType === "school_shift" && (
          <Pressable
            onPress={() => setShowSchoolModal(true)}
            style={{
              marginBottom: 14,
              backgroundColor: "#EFF6FF",
              borderWidth: 1,
              borderColor: "#DBEAFE",
              borderRadius: 16,
              padding: 16,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
            }}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                backgroundColor: "#DBEAFE",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 22 }}>🚌</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: "Inter_700Bold",
                  color: "#1D4ED8",
                }}
              >
                School Shift Subscribe
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: "Inter_400Regular",
                  color: "#3B82F6",
                  marginTop: 2,
                }}
              >
                Monthly school transport
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#3B82F6" />
          </Pressable>
        )}

        {rideCfg.surgeEnabled && (
          <View
            style={{
              marginBottom: 14,
              backgroundColor: "#FFF7ED",
              borderWidth: 1,
              borderColor: "#FED7AA",
              borderRadius: 14,
              padding: 14,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                backgroundColor: "#FFEDD5",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="flash" size={18} color="#EA580C" />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: "Inter_700Bold",
                  color: "#C2410C",
                }}
              >
                Surge Active x{rideCfg.surgeMultiplier}
              </Text>
              <Text
                style={{
                  fontSize: 11,
                  fontFamily: "Inter_400Regular",
                  color: "#9A3412",
                }}
              >
                Fares are {Math.round((rideCfg.surgeMultiplier - 1) * 100)}%
                higher
              </Text>
            </View>
          </View>
        )}

        <Text
          style={{
            fontFamily: "Inter_700Bold",
            fontSize: 15,
            color: C.text,
            marginBottom: 10,
          }}
        >
          Service Type
        </Text>
        {servicesLoading ? (
          <ServiceListSkeleton />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -20, marginBottom: 16 }}
            contentContainerStyle={{
              paddingHorizontal: 20,
              gap: 10,
              flexDirection: "row",
            }}
          >
            {services.map((svc) => {
              const active = rideType === svc.key;
              const feats: string[] = [];
              if (svc.perKm > 0) feats.push(`Rs. ${svc.perKm}/km`);
              if (svc.maxPassengers > 1)
                feats.push(`${svc.maxPassengers} seats`);
              if (svc.allowBargaining) feats.push("Bargain OK");
              if (svc.description) feats.push(svc.description);
              return (
                <Pressable
                  key={svc.key}
                  onPress={() => setRideType(svc.key)}
                  style={[
                    {
                      width: 150,
                      borderRadius: 18,
                      padding: 16,
                      borderWidth: 1.5,
                      borderColor: active
                        ? svc.color ?? C.primary
                        : C.border,
                      backgroundColor: active
                        ? `${svc.color ?? C.primary}08`
                        : "#fff",
                      overflow: "hidden",
                    },
                  ]}
                >
                  <View
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 16,
                      backgroundColor: active
                        ? `${svc.color ?? C.primary}15`
                        : C.surfaceSecondary,
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 10,
                    }}
                  >
                    <Text style={{ fontSize: 28 }}>{svc.icon}</Text>
                  </View>
                  <Text
                    style={{
                      fontFamily: "Inter_700Bold",
                      fontSize: 16,
                      color: C.text,
                    }}
                  >
                    {svc.name}
                  </Text>
                  {svc.nameUrdu ? (
                    <Text
                      style={{
                        fontSize: 11,
                        color: C.textMuted,
                        fontFamily: "Inter_400Regular",
                      }}
                    >
                      {svc.nameUrdu}
                    </Text>
                  ) : null}
                  <Text
                    style={{
                      fontFamily: "Inter_400Regular",
                      fontSize: 12,
                      color: C.textMuted,
                      marginTop: 2,
                    }}
                  >
                    From Rs. {svc.minFare}
                  </Text>
                  <View style={{ gap: 4, marginTop: 8 }}>
                    {feats.slice(0, 3).map((f) => (
                      <View
                        key={f}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        <Ionicons
                          name="checkmark-circle"
                          size={11}
                          color={
                            active ? svc.color ?? C.primary : C.textMuted
                          }
                        />
                        <Text
                          style={{
                            fontFamily: "Inter_400Regular",
                            fontSize: 11,
                            color: C.textSecondary,
                          }}
                          numberOfLines={1}
                        >
                          {f}
                        </Text>
                      </View>
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {estimating && <FareEstimateSkeleton />}
        {!estimating && estimate && (
          <View
            style={{
              borderRadius: 18,
              overflow: "hidden",
              marginBottom: 14,
              borderWidth: 1,
              borderColor: C.border,
              backgroundColor: "#fff",
            }}
          >
            <View style={{ padding: 18 }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 14,
                }}
              >
                <Text
                  style={{
                    fontFamily: "Inter_700Bold",
                    fontSize: 15,
                    color: C.text,
                  }}
                >
                  Fare Estimate
                </Text>
                <Pressable
                  onPress={() => {
                    if (pickupObj && dropObj) {
                      const url = `https://www.google.com/maps/dir/?api=1&origin=${pickupObj.lat},${pickupObj.lng}&destination=${dropObj.lat},${dropObj.lng}&travelmode=${rideType === "bike" || rideType === "rickshaw" ? "bicycling" : "driving"}`;
                      Linking.openURL(url);
                    }
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    backgroundColor: "#EFF6FF",
                    paddingHorizontal: 10,
                    paddingVertical: 5,
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
                      fontSize: 11,
                      color: "#4285F4",
                      fontFamily: "Inter_600SemiBold",
                    }}
                  >
                    Route
                  </Text>
                </Pressable>
              </View>
              <View
                style={{ flexDirection: "row", alignItems: "center" }}
              >
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text
                    style={{
                      fontFamily: "Inter_400Regular",
                      fontSize: 11,
                      color: C.textMuted,
                    }}
                  >
                    Distance
                  </Text>
                  <Text
                    style={{
                      fontFamily: "Inter_700Bold",
                      fontSize: 16,
                      color: C.text,
                      marginTop: 3,
                    }}
                  >
                    {estimate.dist} km
                  </Text>
                </View>
                <View
                  style={{
                    width: 1,
                    height: 36,
                    backgroundColor: C.border,
                  }}
                />
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text
                    style={{
                      fontFamily: "Inter_400Regular",
                      fontSize: 11,
                      color: C.textMuted,
                    }}
                  >
                    Duration
                  </Text>
                  <Text
                    style={{
                      fontFamily: "Inter_700Bold",
                      fontSize: 16,
                      color: C.text,
                      marginTop: 3,
                    }}
                  >
                    {estimate.dur}
                  </Text>
                </View>
                <View
                  style={{
                    width: 1,
                    height: 36,
                    backgroundColor: C.border,
                  }}
                />
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text
                    style={{
                      fontFamily: "Inter_400Regular",
                      fontSize: 11,
                      color: C.textMuted,
                    }}
                  >
                    Total
                  </Text>
                  <Text
                    style={{
                      fontFamily: "Inter_700Bold",
                      fontSize: 20,
                      color: C.success,
                      marginTop: 3,
                    }}
                  >
                    Rs. {estimate.fare}
                  </Text>
                </View>
              </View>
              {estimate.gstAmount > 0 && (
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    marginTop: 12,
                    paddingTop: 10,
                    borderTopWidth: 1,
                    borderTopColor: C.border,
                  }}
                >
                  <Text
                    style={{ fontSize: 11, color: C.textMuted }}
                  >
                    Base fare: Rs. {estimate.baseFare}
                  </Text>
                  <Text
                    style={{ fontSize: 11, color: C.textMuted }}
                  >
                    GST: Rs. {estimate.gstAmount}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {!estimating && estimate?.bargainEnabled && (
          <View style={{ marginBottom: 14 }}>
            <Pressable
              onPress={() => {
                setShowBargain((v) => !v);
                setOfferedFare("");
                setBargainNote("");
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: showBargain ? "#FFF7ED" : "#fff",
                borderWidth: 1.5,
                borderColor: showBargain ? "#FB923C" : C.border,
                borderRadius: 16,
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
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    backgroundColor: showBargain
                      ? "#FFEDD5"
                      : C.surfaceSecondary,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons
                    name="chatbubble-ellipses-outline"
                    size={20}
                    color={showBargain ? "#EA580C" : C.textSecondary}
                  />
                </View>
                <View>
                  <Text
                    style={{
                      fontFamily: "Inter_700Bold",
                      fontSize: 14,
                      color: showBargain ? "#C2410C" : C.text,
                    }}
                  >
                    {showBargain ? "Bargaining ON" : "Make an Offer"}
                  </Text>
                  <Text
                    style={{
                      fontFamily: "Inter_400Regular",
                      fontSize: 11,
                      color: showBargain ? "#EA580C" : C.textMuted,
                    }}
                  >
                    {showBargain
                      ? `Min: Rs. ${estimate.minOffer}`
                      : `Suggest your price (min Rs. ${estimate.minOffer})`}
                  </Text>
                </View>
              </View>
              <Ionicons
                name={showBargain ? "chevron-up" : "chevron-down"}
                size={18}
                color={showBargain ? "#EA580C" : C.textMuted}
              />
            </Pressable>

            {showBargain && (
              <View
                style={{
                  backgroundColor: "#FFF7ED",
                  borderWidth: 1,
                  borderColor: "#FED7AA",
                  borderTopWidth: 0,
                  borderBottomLeftRadius: 16,
                  borderBottomRightRadius: 16,
                  padding: 16,
                  gap: 12,
                }}
              >
                <Text
                  style={{
                    fontFamily: "Inter_500Medium",
                    fontSize: 12,
                    color: "#92400E",
                  }}
                >
                  Platform fare: Rs. {estimate.fare} · Min: Rs.{" "}
                  {estimate.minOffer}
                </Text>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: "#fff",
                    borderWidth: 1.5,
                    borderColor: "#FB923C",
                    borderRadius: 14,
                    paddingHorizontal: 14,
                    paddingVertical: 4,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "Inter_700Bold",
                      fontSize: 16,
                      color: C.textSecondary,
                      marginRight: 4,
                    }}
                  >
                    Rs.
                  </Text>
                  <TextInput
                    value={offeredFare}
                    onChangeText={setOfferedFare}
                    keyboardType="numeric"
                    placeholder={String(estimate.minOffer)}
                    placeholderTextColor="#D1D5DB"
                    style={{
                      flex: 1,
                      fontFamily: "Inter_700Bold",
                      fontSize: 20,
                      color: C.text,
                      paddingVertical: 10,
                    }}
                  />
                  {offeredFare !== "" && (
                    <Pressable onPress={() => setOfferedFare("")}>
                      <Ionicons
                        name="close-circle"
                        size={18}
                        color="#D1D5DB"
                      />
                    </Pressable>
                  )}
                </View>
                <TextInput
                  value={bargainNote}
                  onChangeText={setBargainNote}
                  placeholder="Note (optional)"
                  placeholderTextColor="#D1D5DB"
                  style={{
                    backgroundColor: "#fff",
                    borderWidth: 1,
                    borderColor: "#FED7AA",
                    borderRadius: 12,
                    padding: 12,
                    fontFamily: "Inter_400Regular",
                    fontSize: 13,
                    color: C.text,
                  }}
                />
                <Text
                  style={{
                    fontSize: 11,
                    color: "#9A3412",
                    lineHeight: 16,
                    fontFamily: "Inter_400Regular",
                  }}
                >
                  The rider can accept, counter, or reject your offer.
                </Text>
              </View>
            )}
          </View>
        )}

        <Text
          style={{
            fontFamily: "Inter_700Bold",
            fontSize: 15,
            color: C.text,
            marginBottom: 10,
          }}
        >
          Payment
        </Text>
        <View
          style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}
        >
          {payMethods.map((pm) => {
            const pmId = pm.id;
            const active = payMethod === pmId;
            const isCash = pmId === "cash";
            const isWallet = pmId === "wallet";
            const isJazzcash = pmId === "jazzcash";
            const isEasypaisa = pmId === "easypaisa";
            const insufficient =
              isWallet &&
              estimate &&
              (user?.walletBalance ?? 0) < estimate.fare;
            const pmLabel = pm.label || pm.name || pmId;
            const pmIcon: string = isCash ? "cash-outline" : isWallet ? "wallet-outline" : isJazzcash ? "phone-portrait-outline" : isEasypaisa ? "phone-portrait-outline" : "card-outline";
            const pmColor = isCash ? C.success : isWallet ? C.primary : isJazzcash ? "#E53E3E" : isEasypaisa ? "#38A169" : C.primary;
            const pmBg = isCash ? "#D1FAE5" : isWallet ? "#DBEAFE" : isJazzcash ? "#FEE2E2" : isEasypaisa ? "#D1FAE5" : "#DBEAFE";
            const pmSubtext = isCash ? "Pay on arrival" : isWallet ? `Rs. ${(user?.walletBalance ?? 0).toLocaleString()}` : `Pay via ${pmLabel}`;
            return (
              <Pressable
                key={pmId}
                onPress={() => setPayMethod(pmId)}
                style={{
                  flex: 1,
                  alignItems: "center",
                  padding: 16,
                  borderRadius: 16,
                  borderWidth: 1.5,
                  borderColor: active ? pmColor : C.border,
                  backgroundColor: active ? `${pmColor}08` : "#fff",
                  gap: 6,
                }}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    backgroundColor: active ? pmBg : C.surfaceSecondary,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons
                    name={pmIcon as any}
                    size={22}
                    color={active ? pmColor : C.textSecondary}
                  />
                </View>
                <Text
                  style={{
                    fontFamily: active
                      ? "Inter_700Bold"
                      : "Inter_600SemiBold",
                    fontSize: 13,
                    color: active ? C.text : C.textSecondary,
                  }}
                >
                  {pmLabel}
                </Text>
                <Text
                  style={{
                    fontFamily: "Inter_400Regular",
                    fontSize: 11,
                    color: insufficient ? C.danger : C.textMuted,
                  }}
                >
                  {pmSubtext}
                </Text>
                {active && (
                  <View
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      backgroundColor: pmColor,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="checkmark" size={12} color="#fff" />
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        <View
          style={{
            marginBottom: 14,
            backgroundColor: C.surfaceSecondary,
            borderWidth: 1,
            borderColor: C.border,
            borderRadius: 12,
            padding: 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Ionicons
            name="information-circle-outline"
            size={15}
            color={C.textMuted}
          />
          <Text
            style={{
              fontSize: 11,
              color: C.textSecondary,
              flex: 1,
              fontFamily: "Inter_400Regular",
            }}
          >
            Rs. {rideCfg.cancellationFee} fee applies if you cancel after
            driver accepts.
          </Text>
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginBottom: 18,
            backgroundColor: "#F0FDF4",
            padding: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "#D1FAE5",
          }}
        >
          <Ionicons
            name="shield-checkmark-outline"
            size={15}
            color="#059669"
          />
          <Text
            style={{
              fontFamily: "Inter_400Regular",
              fontSize: 12,
              color: "#065F46",
            }}
          >
            All rides insured · Verified drivers · GPS tracked
          </Text>
        </View>

        <Pressable
          onPress={handleBook}
          disabled={booking || !estimate}
          style={[
            {
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              backgroundColor:
                showBargain && offeredFare ? "#EA580C" : C.primary,
              borderRadius: 16,
              paddingVertical: 18,
              opacity: booking || !estimate ? 0.6 : 1,
            },
          ]}
        >
          {booking ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              {showBargain && offeredFare ? (
                <Ionicons
                  name="chatbubble-ellipses"
                  size={20}
                  color="#fff"
                />
              ) : (
                <Text style={{ fontSize: 20 }}>
                  {selectedSvc?.icon ?? "🚗"}
                </Text>
              )}
              <Text
                style={{
                  fontFamily: "Inter_700Bold",
                  fontSize: 16,
                  color: "#fff",
                }}
              >
                {showBargain && offeredFare
                  ? `Send Offer · Rs. ${offeredFare}`
                  : `Book ${selectedSvc?.name ?? rideType}${estimate ? ` · Rs. ${estimate.fare}` : ""}`}
              </Text>
            </>
          )}
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal
        visible={showHistory}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowHistory(false)}
      >
        <View style={{ flex: 1, backgroundColor: C.background }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              padding: 20,
              backgroundColor: "#fff",
              borderBottomWidth: 1,
              borderBottomColor: C.border,
            }}
          >
            <Text
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 18,
                color: C.text,
              }}
            >
              Ride History
            </Text>
            <Pressable
              onPress={() => setShowHistory(false)}
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                backgroundColor: C.surfaceSecondary,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="close" size={18} color={C.text} />
            </Pressable>
          </View>
          {histLoading ? (
            <ActivityIndicator
              color={C.primary}
              style={{ marginTop: 40 }}
            />
          ) : history.length === 0 ? (
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
              }}
            >
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  backgroundColor: C.surfaceSecondary,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons
                  name="car-outline"
                  size={30}
                  color={C.textMuted}
                />
              </View>
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 15,
                  color: C.text,
                }}
              >
                No rides yet
              </Text>
              <Text
                style={{
                  fontFamily: "Inter_400Regular",
                  fontSize: 13,
                  color: C.textMuted,
                }}
              >
                Your ride history will appear here
              </Text>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={{ padding: 20, gap: 10 }}
            >
              {history.map((ride, i) => (
                <View
                  key={ride.id || i}
                  style={{
                    backgroundColor: "#fff",
                    borderRadius: 16,
                    padding: 16,
                    borderWidth: 1,
                    borderColor: C.border,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 14,
                      backgroundColor: C.surfaceSecondary,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ fontSize: 20 }}>
                      {services.find((s) => s.key === ride.type)
                        ?.icon ??
                        (ride.type === "bike"
                          ? "🏍️"
                          : ride.type === "car"
                            ? "🚗"
                            : ride.type === "rickshaw"
                              ? "🛺"
                              : ride.type === "daba"
                                ? "🚐"
                                : "🚗")}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontFamily: "Inter_500Medium",
                        fontSize: 13,
                        color: C.text,
                      }}
                      numberOfLines={1}
                    >
                      {ride.pickupAddress} → {ride.dropAddress}
                    </Text>
                    <Text
                      style={{
                        fontFamily: "Inter_400Regular",
                        fontSize: 11,
                        color: C.textMuted,
                        marginTop: 3,
                      }}
                    >
                      {ride.distance} km ·{" "}
                      {new Date(ride.createdAt).toLocaleDateString(
                        "en-PK",
                        { day: "numeric", month: "short" },
                      )}
                    </Text>
                  </View>
                  <View
                    style={{ alignItems: "flex-end", gap: 4 }}
                  >
                    <Text
                      style={{
                        fontFamily: "Inter_700Bold",
                        fontSize: 14,
                        color: C.text,
                      }}
                    >
                      Rs. {ride.fare}
                    </Text>
                    <View
                      style={{
                        backgroundColor:
                          ride.status === "completed"
                            ? "#D1FAE5"
                            : ride.status === "cancelled"
                              ? "#FEE2E2"
                              : "#FEF3C7",
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: 8,
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: "Inter_500Medium",
                          fontSize: 10,
                          color:
                            ride.status === "completed"
                              ? "#059669"
                              : ride.status === "cancelled"
                                ? "#DC2626"
                                : "#D97706",
                        }}
                      >
                        {(
                          {
                            searching: "Finding",
                            bargaining: "Negotiating",
                            accepted: "Accepted",
                            arrived: "Arrived",
                            in_transit: "In Transit",
                            completed: "Done",
                            cancelled: "Cancelled",
                            ongoing: "In Transit",
                            no_riders: "No Riders",
                          } as Record<string, string>
                        )[ride.status as string] ?? ride.status}
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

      <Modal
        visible={showSchoolModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowSchoolModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: C.background }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              padding: 20,
              backgroundColor: "#fff",
              borderBottomWidth: 1,
              borderBottomColor: C.border,
            }}
          >
            <Text
              style={{
                fontSize: 18,
                fontFamily: "Inter_700Bold",
                flex: 1,
                color: C.text,
              }}
            >
              School Shift Subscribe
            </Text>
            <Pressable
              onPress={() => setShowSchoolModal(false)}
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                backgroundColor: C.surfaceSecondary,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="close" size={18} color={C.text} />
            </Pressable>
          </View>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 20, gap: 14 }}
          >
            <Text
              style={{
                fontFamily: "Inter_600SemiBold",
                fontSize: 14,
                color: C.text,
                marginBottom: 4,
              }}
            >
              Select a Route
            </Text>
            {schoolRoutes.length === 0 ? (
              <View
                style={{
                  backgroundColor: "#fff",
                  borderRadius: 16,
                  padding: 24,
                  alignItems: "center",
                  borderWidth: 1,
                  borderColor: C.border,
                }}
              >
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 16,
                    backgroundColor: C.surfaceSecondary,
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 10,
                  }}
                >
                  <Text style={{ fontSize: 24 }}>🚌</Text>
                </View>
                <Text
                  style={{
                    fontFamily: "Inter_600SemiBold",
                    color: C.textSecondary,
                  }}
                >
                  No routes available
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: C.textMuted,
                    marginTop: 4,
                    textAlign: "center",
                  }}
                >
                  Contact admin to add school shift routes
                </Text>
              </View>
            ) : (
              schoolRoutes.map((r: any) => (
                <Pressable
                  key={r.id}
                  onPress={() => setSelectedRoute(r)}
                  style={{
                    borderWidth: 1.5,
                    borderColor:
                      selectedRoute?.id === r.id
                        ? C.primary
                        : C.border,
                    borderRadius: 16,
                    padding: 16,
                    backgroundColor:
                      selectedRoute?.id === r.id
                        ? `${C.primary}06`
                        : "#fff",
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: 12,
                    }}
                  >
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 14,
                        backgroundColor: "#DBEAFE",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ fontSize: 22 }}>🚌</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontFamily: "Inter_700Bold",
                          fontSize: 14,
                          color: C.text,
                        }}
                      >
                        {r.routeName}
                      </Text>
                      <Text
                        style={{
                          fontSize: 12,
                          color: C.textSecondary,
                          marginTop: 2,
                        }}
                      >
                        {r.schoolName}
                      </Text>
                      {r.schoolNameUrdu ? (
                        <Text
                          style={{
                            fontSize: 11,
                            color: C.textMuted,
                            marginTop: 1,
                          }}
                          allowFontScaling={false}
                        >
                          {r.schoolNameUrdu}
                        </Text>
                      ) : null}
                      <View
                        style={{
                          flexDirection: "row",
                          flexWrap: "wrap",
                          gap: 6,
                          marginTop: 8,
                        }}
                      >
                        <View
                          style={{
                            backgroundColor: "#D1FAE5",
                            borderRadius: 8,
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 11,
                              fontFamily: "Inter_700Bold",
                              color: "#16A34A",
                            }}
                          >
                            Rs. {r.monthlyPrice?.toLocaleString()}/mo
                          </Text>
                        </View>
                        <View
                          style={{
                            backgroundColor: C.surfaceSecondary,
                            borderRadius: 8,
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 11,
                              color: C.textSecondary,
                            }}
                          >
                            AM {r.morningTime}
                          </Text>
                        </View>
                        {r.afternoonTime ? (
                          <View
                            style={{
                              backgroundColor: C.surfaceSecondary,
                              borderRadius: 8,
                              paddingHorizontal: 8,
                              paddingVertical: 3,
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 11,
                                color: C.textSecondary,
                              }}
                            >
                              PM {r.afternoonTime}
                            </Text>
                          </View>
                        ) : null}
                        <View
                          style={{
                            backgroundColor: C.surfaceSecondary,
                            borderRadius: 8,
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 11,
                              color: C.textSecondary,
                            }}
                          >
                            {r.enrolledCount}/{r.capacity} seats
                          </Text>
                        </View>
                      </View>
                      <Text
                        style={{
                          fontSize: 11,
                          color: C.textMuted,
                          marginTop: 6,
                        }}
                      >
                        {r.fromArea} → {r.toAddress}
                      </Text>
                    </View>
                    {selectedRoute?.id === r.id && (
                      <Ionicons
                        name="checkmark-circle"
                        size={22}
                        color={C.primary}
                      />
                    )}
                  </View>
                </Pressable>
              ))
            )}

            {selectedRoute && (
              <>
                <View
                  style={{ height: 1, backgroundColor: C.border }}
                />
                <Text
                  style={{
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 14,
                    color: C.text,
                  }}
                >
                  Student Details
                </Text>
                <View style={{ gap: 12 }}>
                  <View>
                    <Text
                      style={{
                        fontSize: 12,
                        color: C.textSecondary,
                        marginBottom: 6,
                        fontFamily: "Inter_500Medium",
                      }}
                    >
                      Student Name *
                    </Text>
                    <View
                      style={{
                        borderWidth: 1.5,
                        borderColor: C.border,
                        borderRadius: 14,
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                        backgroundColor: "#fff",
                      }}
                    >
                      <TextInput
                        value={schoolStudent}
                        onChangeText={setSchoolStudent}
                        placeholder="e.g. Ali Khan"
                        style={{
                          fontFamily: "Inter_400Regular",
                          fontSize: 14,
                          color: C.text,
                        }}
                        placeholderTextColor={C.textMuted}
                      />
                    </View>
                  </View>
                  <View>
                    <Text
                      style={{
                        fontSize: 12,
                        color: C.textSecondary,
                        marginBottom: 6,
                        fontFamily: "Inter_500Medium",
                      }}
                    >
                      Class / Grade *
                    </Text>
                    <View
                      style={{
                        borderWidth: 1.5,
                        borderColor: C.border,
                        borderRadius: 14,
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                        backgroundColor: "#fff",
                      }}
                    >
                      <TextInput
                        value={schoolClass}
                        onChangeText={setSchoolClass}
                        placeholder="e.g. 7th Grade"
                        style={{
                          fontFamily: "Inter_400Regular",
                          fontSize: 14,
                          color: C.text,
                        }}
                        placeholderTextColor={C.textMuted}
                      />
                    </View>
                  </View>
                </View>
                <View
                  style={{
                    backgroundColor: "#FEF3C7",
                    borderRadius: 14,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: "#FDE68A",
                    marginTop: 4,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      color: "#92400E",
                      fontFamily: "Inter_500Medium",
                    }}
                  >
                    First month: Rs.{" "}
                    {selectedRoute.monthlyPrice?.toLocaleString()} —{" "}
                    {payMethod === "wallet"
                      ? "From wallet"
                      : payMethod === "cash"
                        ? "Cash on pickup"
                        : `Via ${payMethod}`}
                  </Text>
                </View>
                <Pressable
                  onPress={handleSchoolSubscribe}
                  disabled={subscribing}
                  style={{
                    backgroundColor: subscribing
                      ? "#93C5FD"
                      : C.primary,
                    borderRadius: 16,
                    padding: 16,
                    alignItems: "center",
                    marginTop: 8,
                    opacity: subscribing ? 0.7 : 1,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "Inter_700Bold",
                      fontSize: 15,
                      color: "#fff",
                    }}
                  >
                    {subscribing
                      ? "Subscribing..."
                      : `Subscribe · Rs. ${selectedRoute.monthlyPrice?.toLocaleString()}/mo`}
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

const rs = StyleSheet.create({
  hdrRow: { flexDirection: "row", alignItems: "center" },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  sugg: {
    backgroundColor: "#fff",
    borderRadius: 12,
    marginTop: 6,
    borderWidth: 1,
    borderColor: C.border,
    maxHeight: 200,
  },
  suggRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },
  suggTxt: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: C.text,
  },
  suggSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: C.textMuted,
    marginTop: 1,
  },
});
