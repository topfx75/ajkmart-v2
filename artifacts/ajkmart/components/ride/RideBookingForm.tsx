import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { router } from "expo-router";
import { useMapsAutocomplete, resolveLocation, reverseGeocodeCoords, staticMapUrl } from "@/hooks/useMaps";
import type { MapPrediction } from "@/hooks/useMaps";
import { MapPickerModal } from "@/components/ride/MapPickerModal";
import type { MapPickerResult } from "@/components/ride/MapPickerModal";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Linking,
  Modal,
  Platform,
  TouchableOpacity,
  ScrollView,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
  StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { T as Typ, Font } from "@/constants/typography";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { useApiCall } from "@/hooks/useApiCall";
import { API_BASE, unwrapApiResponse } from "@/utils/api";
import { ServiceListSkeleton, FareEstimateSkeleton, HistoryRowSkeleton } from "@/components/ride/Skeletons";
import { PermissionGuide } from "@/components/PermissionGuide";
import {
  estimateFare,
  bookRide,
  getRideStops,
  getRideServices,
  getRideHistory,
  getSchoolRoutes,
  subscribeSchoolRoute,
  updateLocation,
} from "@workspace/api-client-react";
import type {
  BookRideRequest,
  EstimateFareRequest,
  SchoolSubscribeRequest,
} from "@workspace/api-client-react";

type SchoolSubscribeRequestWithNotes = SchoolSubscribeRequest & {
  notes?: string;
  shift?: "morning" | "afternoon" | "both";
  startDate?: string;
  recurring?: boolean;
};

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
  isParcel?: boolean;
};

const PARCEL_KEYS = ["parcel", "courier", "delivery", "cargo", "freight"];
const isParcelService = (key: string, svc?: ServiceType) =>
  (svc?.isParcel === true) ||
  PARCEL_KEYS.some((k) => key.toLowerCase().includes(k));

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
  prefillPickup?: string;
  prefillDrop?: string;
  prefillType?: string;
};

export function RideBookingForm({ onBooked, prefillPickup, prefillDrop, prefillType }: RideBookingFormProps) {
  const colorScheme = useColorScheme();
  const C = colorScheme === "dark" ? Colors.dark : Colors.light;
  const ds = makeDynStyles(C);
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const { width: screenWidth } = useWindowDimensions();
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
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
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
  const [pickupError, setPickupError] = useState("");
  const [pickupFocus, setPickupFocus] = useState(false);
  const [dropFocus, setDropFocus] = useState(false);
  const [popularSpots, setPopularSpots] = useState<PopularSpot[]>([]);
  const [schoolRoutes, setSchoolRoutes] = useState<any[]>([]);
  const [showSchoolModal, setShowSchoolModal] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<any>(null);
  const [schoolStudent, setSchoolStudent] = useState("");
  const [schoolClass, setSchoolClass] = useState("");
  const [schoolNotes, setSchoolNotes] = useState("");
  const [schoolShift, setSchoolShift] = useState<"morning" | "afternoon" | "both">("morning");
  const [schoolStartDate, setSchoolStartDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [schoolRecurring, setSchoolRecurring] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [debtBalance, setDebtBalance] = useState(0);
  const [debtDismissed, setDebtDismissed] = useState(false);
  const [permGuideVisible, setPermGuideVisible] = useState(false);
  const [estimateForType, setEstimateForType] = useState<string | null>(null);
  const [estimateAt, setEstimateAt] = useState<number | null>(null);
  const [estimateAgeMinutes, setEstimateAgeMinutes] = useState(0);
  const [estimateNonce, setEstimateNonce] = useState(0);

  const [showMapPicker, setShowMapPicker] = useState(false);
  const [mapPickerTarget, setMapPickerTarget] = useState<"pickup" | "drop" | number>("pickup");
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [scheduledTime, setScheduledTime] = useState("08:00");
  const [stops, setStops] = useState<Array<{ id: string; address: string; lat?: number; lng?: number }>>([]);
  const [stopInputs, setStopInputs] = useState<Record<string, string>>({});
  const [isPoolRide, setIsPoolRide] = useState(false);

  const liveAnim = useRef(new Animated.Value(1)).current;
  const bookBtnScale = useRef(new Animated.Value(1)).current;
  const bargainPanelH = useRef(new Animated.Value(0)).current;
  const svcIndicatorX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(liveAnim, { toValue: 0.25, duration: 550, useNativeDriver: false }),
        Animated.timing(liveAnim, { toValue: 1, duration: 550, useNativeDriver: false }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  useEffect(() => {
    Animated.spring(bargainPanelH, {
      toValue: showBargain ? 1 : 0,
      useNativeDriver: false,
      tension: 200,
      friction: 20,
    }).start();
  }, [showBargain]);

  useEffect(() => {
    const idx = Math.max(0, services.findIndex((s) => s.key === rideType));
    Animated.spring(svcIndicatorX, {
      toValue: idx * 10,
      useNativeDriver: false,
      tension: 220,
      friction: 14,
    }).start();
  }, [rideType, services]);

  const handleMapPickerConfirm = useCallback((result: MapPickerResult) => {
    setShowMapPicker(false);
    const { lat, lng, address } = result;
    if (mapPickerTarget === "pickup") {
      setPickup(address);
      setPickupObj({ lat, lng, address });
    } else if (mapPickerTarget === "drop") {
      setDrop(address);
      setDropObj({ lat, lng, address });
    } else if (typeof mapPickerTarget === "number") {
      setStops(prev => prev.map((s, i) => i === mapPickerTarget ? { ...s, address, lat, lng } : s));
      setStopInputs(prev => ({ ...prev, [String(mapPickerTarget)]: address }));
    }
  }, [mapPickerTarget]);

  const addStop = useCallback(() => {
    const id = `stop_${Date.now()}`;
    setStops(prev => [...prev, { id, address: "", lat: undefined, lng: undefined }]);
    setStopInputs(prev => ({ ...prev, [String(stops.length)]: "" }));
  }, [stops.length]);

  const removeStop = useCallback((idx: number) => {
    setStops(prev => prev.filter((_, i) => i !== idx));
    setStopInputs(prev => {
      const next = { ...prev };
      delete next[String(idx)];
      return next;
    });
  }, []);

  const { predictions: pickupPreds, loading: pickupLoading } =
    useMapsAutocomplete(pickupFocus ? pickup : "");
  const { predictions: dropPreds, loading: dropLoading } =
    useMapsAutocomplete(dropFocus ? drop : "");

  useEffect(() => {
    if (prefillPickup) setPickup(prefillPickup);
    if (prefillDrop) setDrop(prefillDrop);
    if (prefillType) setRideType(prefillType);
  }, []);

  /* Auto-fill pickup from current GPS on form mount */
  useEffect(() => {
    if (prefillPickup) return;
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted" || cancelled) return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        const { latitude: lat, longitude: lng } = pos.coords;
        const data = await reverseGeocodeCoords(lat, lng);
        if (cancelled) return;
        const address = data?.address ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        setPickup(address);
        setPickupObj({ lat, lng, address });
      } catch (err) {
        console.warn("[RideBookingForm] GPS auto-fill failed:", err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    getRideStops()
      .then((data) => {
        if (data?.locations?.length) setPopularSpots(data.locations);
      })
      .catch((err) => {
        console.warn("[RideBookingForm] Popular spots fetch failed:", err instanceof Error ? err.message : String(err));
      });
  }, []);

  useEffect(() => {
    if (rideType !== "school_shift") return;
    getSchoolRoutes()
      .then((data) => {
        if (data?.routes?.length) setSchoolRoutes(data.routes);
      })
      .catch((err) => {
        console.warn("[RideBookingForm] School routes fetch failed:", err instanceof Error ? err.message : String(err));
      });
  }, [rideType]);

  useEffect(() => {
    fetch(`${API_BASE}/rides/payment-methods`)
      .then((r) => r.json())
      .then(unwrapApiResponse)
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
      .catch((err) => {
        console.warn("[RideBookingForm] Ride services fetch failed:", err instanceof Error ? err.message : String(err));
        showToast("Could not load ride types. Please check your connection and try again.", "error");
      })
      .finally(() => setServicesLoading(false));
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    fetch(`${API_BASE}/users/${user.id}/debt`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then(unwrapApiResponse)
      .then((d) => {
        if (d?.debtBalance > 0) setDebtBalance(d.debtBalance);
      })
      .catch((err) => {
        console.warn("[RideBookingForm] Debt fetch failed:", err instanceof Error ? err.message : String(err));
      });
  }, [user?.id]);

  const handleMyLocation = async () => {
    setLocLoading(true);
    setLocDenied(false);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocDenied(true);
        setPermGuideVisible(true);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude: lat, longitude: lng } = pos.coords;
      const data = await reverseGeocodeCoords(lat, lng);
      const address = data?.address ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
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
          (data) => {
            if (cancelled || !data) return;
            const ext = data as typeof data & { baseFare?: number; gstAmount?: number; bargainEnabled?: boolean; minOffer?: number };
            setEstimateForType(data.type ?? rideType);
            setEstimateAt(Date.now());
            setEstimateAgeMinutes(0);
            setEstimate({
              fare: data.fare,
              dist: data.distance,
              dur: data.duration,
              baseFare: ext.baseFare ?? data.fare,
              gstAmount: ext.gstAmount ?? 0,
              bargainEnabled: ext.bargainEnabled ?? false,
              minOffer: ext.minOffer ?? data.fare,
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
  }, [pickupObj?.lat, pickupObj?.lng, dropObj?.lat, dropObj?.lng, rideType, estimateNonce]);

  useEffect(() => {
    if (!estimateAt) return;
    const interval = setInterval(() => {
      setEstimateAgeMinutes(Math.floor((Date.now() - estimateAt) / 60000));
    }, 30000);
    return () => clearInterval(interval);
  }, [estimateAt]);

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
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(schoolStartDate)) {
      showToast("Please enter start date as YYYY-MM-DD", "error");
      return;
    }
    const parsedDate = new Date(schoolStartDate);
    if (isNaN(parsedDate.getTime())) {
      showToast("Invalid start date", "error");
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (parsedDate < today) {
      showToast("Start date cannot be in the past", "error");
      return;
    }
    setSubscribing(true);
    try {
      const subscribePayload: SchoolSubscribeRequestWithNotes = {
        routeId: selectedRoute.id,
        studentName: schoolStudent.trim(),
        studentClass: schoolClass.trim(),
        paymentMethod: payMethod as SchoolSubscribeRequest["paymentMethod"],
        shift: schoolShift,
        startDate: schoolStartDate,
        recurring: schoolRecurring,
        ...(schoolNotes.trim() ? { notes: schoolNotes.trim() } : {}),
      };
      await subscribeSchoolRoute(subscribePayload);
      setShowSchoolModal(false);
      setSelectedRoute(null);
      setSchoolStudent("");
      setSchoolClass("");
      setSchoolNotes("");
      setSchoolShift("morning");
      setSchoolRecurring(true);
      showToast(
        `${schoolStudent} has been subscribed to ${selectedRoute.schoolName}!`,
        "success",
      );
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || "Network error. Please try again.";
      showToast(msg, "error");
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
      setPickupError("Please select an exact pickup location from the suggestions");
      showToast(
        "Please select pickup location from the list (exact location required)",
        "error",
      );
      return;
    }
    setPickupError("");
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
    const selectedSvc = services.find((s) => s.key === rideType);
    if (isParcelService(rideType, selectedSvc)) {
      if (!receiverName.trim()) {
        showToast("Please enter the receiver's full name", "error");
        return;
      }
      if (!receiverPhone.trim()) {
        showToast("Please enter the receiver's phone number", "error");
        return;
      }
    }
    if (
      pickupObj && dropObj &&
      Math.abs(pickupObj.lat - dropObj.lat) < 0.0001 &&
      Math.abs(pickupObj.lng - dropObj.lng) < 0.0001
    ) {
      showToast("Pickup and drop locations cannot be the same", "error");
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
    if (estimateAt && Date.now() - estimateAt > 5 * 60 * 1000) {
      showToast("Fare estimate has expired — refreshing now, please try again in a moment.", "error");
      setEstimate(null);
      setEstimateAt(null);
      setEstimateNonce((n) => n + 1);
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
      if (parsedOffer > estimate.fare) {
        showToast(
          `Offer cannot exceed the platform fare of Rs. ${estimate.fare}`,
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
      if (isScheduled) {
        if (!scheduledDate || !scheduledTime) {
          showToast("Please enter a valid scheduled date and time.", "error");
          setBooking(false);
          return;
        }
        const scheduledDt = new Date(`${scheduledDate}T${scheduledTime}:00`);
        if (isNaN(scheduledDt.getTime()) || scheduledDt <= new Date()) {
          showToast("Scheduled time must be in the future.", "error");
          setBooking(false);
          return;
        }
      }

      const selectedSvcForBook = services.find((s) => s.key === rideType);
      const parcelBooking = isParcelService(rideType, selectedSvcForBook);
      const resolvedStops = stops.filter(s => s.lat !== undefined && s.lng !== undefined).map((s, i) => ({
        address: s.address || stopInputs[String(i)] || "",
        lat: s.lat!,
        lng: s.lng!,
        order: i + 1,
      }));
      const rideData = await bookRide({
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
        ...(parcelBooking && receiverName.trim() && { receiverName: receiverName.trim() }),
        ...(parcelBooking && receiverPhone.trim() && { receiverPhone: receiverPhone.trim() }),
        ...(parcelBooking && { isParcel: true }),
        ...(isScheduled && { isScheduled: true, scheduledAt: new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString() }),
        ...(resolvedStops.length > 0 && { stops: resolvedStops }),
        ...(isPoolRide && { isPoolRide: true }),
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
          const perm = await Location.requestForegroundPermissionsAsync();
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
      <LinearGradient
        colors={["#001A5C", "#003399", "#0052CC"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          paddingTop: topPad + 8,
          paddingHorizontal: 16,
          paddingBottom: 14,
        }}
      >
        <View style={rs.hdrRow}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => router.back()} style={rs.backBtnBlue}>
            <Ionicons name="arrow-back" size={18} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text
              style={{
                fontFamily: Font.bold,
                fontSize: 17,
                color: "#FFFFFF",
              }}
            >
              Book a Ride
            </Text>
          </View>
          <TouchableOpacity activeOpacity={0.7}
            onPress={handleMyLocation}
            disabled={locLoading}
            style={{
              height: 34,
              borderRadius: 10,
              backgroundColor: "rgba(255,255,255,0.18)",
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 10,
              gap: 5,
              marginRight: 8,
            }}
          >
            {locLoading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons
                name="locate-outline"
                size={14}
                color={locDenied ? "#ff8888" : "#FFFFFF"}
              />
            )}
            <Text
              style={{
                fontFamily: Font.medium,
                fontSize: 11,
                color: locDenied ? "#ff8888" : "rgba(255,255,255,0.9)",
              }}
            >
              {locLoading ? "..." : locDenied ? "Denied" : "GPS"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7}
            onPress={() => {
              setShowHistory(true);
              fetchHistory();
            }}
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              backgroundColor: "rgba(255,255,255,0.18)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="time-outline" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <View
          style={{
            marginTop: 10,
            backgroundColor: "#FFFFFF",
            borderRadius: 16,
            paddingHorizontal: 12,
            paddingVertical: 10,
            ...Platform.select({
              ios: { shadowColor: "#001A5C", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.14, shadowRadius: 12 },
              android: { elevation: 4 },
              web: { boxShadow: "0 4px 14px rgba(0,26,92,0.14)" },
            }),
          }}
        >
          {locDenied && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 4,
                paddingBottom: 4,
                gap: 5,
              }}
            >
              <Ionicons name="warning-outline" size={11} color={C.red} />
              <Text
                style={{
                  fontFamily: Font.regular,
                  fontSize: 10,
                  color: C.red,
                  flex: 1,
                }}
              >
                Location denied — type address or tap GPS to retry
              </Text>
            </View>
          )}

          <View style={{ flexDirection: "row", alignItems: "stretch", gap: 0 }}>
            <View style={{ width: 20, alignItems: "center", paddingTop: 12 }}>
              <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: C.emerald, borderWidth: 2, borderColor: `${C.emerald}40` }} />
              <View style={{ flex: 1, width: 1.5, alignItems: "center", marginVertical: 2 }}>
                {[0,1,2].map((i) => (
                  <View key={i} style={{ width: 1.5, height: 3, backgroundColor: C.border, borderRadius: 1, marginBottom: 2, opacity: 0.7 }} />
                ))}
              </View>
              <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: C.red, borderWidth: 2, borderColor: `${C.red}40`, marginBottom: 12 }} />
            </View>

            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: C.borderLight, paddingBottom: 1 }}>
                <TextInput
                  value={pickup}
                  onChangeText={(v) => {
                    setPickup(v);
                    setPickupObj(null);
                    if (pickupError) setPickupError("");
                  }}
                  onFocus={() => setPickupFocus(true)}
                  onBlur={() => setTimeout(() => setPickupFocus(false), 250)}
                  placeholder="Pickup location..."
                  placeholderTextColor={C.textMuted}
                  style={{
                    flex: 1,
                    fontFamily: Font.medium,
                    fontSize: 13,
                    color: C.text,
                    paddingVertical: 8,
                    paddingLeft: 6,
                  }}
                />
                {pickup.length > 0 && (
                  <TouchableOpacity activeOpacity={0.7}
                    onPress={() => {
                      setPickup("");
                      setPickupObj(null);
                      setPickupError("");
                    }}
                    hitSlop={8}
                  >
                    <Ionicons name="close-circle" size={14} color={C.textMuted} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity activeOpacity={0.7}
                  onPress={() => { setMapPickerTarget("pickup"); setShowMapPicker(true); }}
                  hitSlop={8}
                  style={{ marginLeft: 4, padding: 3 }}
                >
                  <Ionicons name="map-outline" size={16} color={C.primary} />
                </TouchableOpacity>
              </View>

              {pickup !== "" && !pickupObj && pickupError ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2, marginLeft: 6 }}>
                  <Ionicons name="alert-circle-outline" size={11} color={C.red} />
                  <Text style={{ ...Typ.small, fontSize: 10, color: C.red }}>{pickupError}</Text>
                </View>
              ) : null}

              {pickupFocus && (
                <View style={ds.sugg}>
                  {pickupLoading && (
                    <ActivityIndicator size="small" color={C.primary} style={{ padding: 6 }} />
                  )}
                  <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="always" style={{ maxHeight: 150 }}>
                    {pickupPreds.slice(0, 5).map((pred) => (
                      <TouchableOpacity activeOpacity={0.7} key={pred.placeId} onPress={() => selectPickup(pred)} style={ds.suggRow}>
                        <Ionicons name="location-outline" size={13} color={C.emerald} />
                        <View style={{ flex: 1 }}>
                          <Text style={ds.suggTxt}>{pred.mainText}</Text>
                          {pred.secondaryText ? (
                            <Text style={ds.suggSub} numberOfLines={1}>{pred.secondaryText}</Text>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              <View style={{ flexDirection: "row", alignItems: "center" }}>
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
                    fontFamily: Font.medium,
                    fontSize: 13,
                    color: C.text,
                    paddingVertical: 8,
                    paddingLeft: 6,
                  }}
                />
                {drop.length > 0 && (
                  <TouchableOpacity activeOpacity={0.7}
                    onPress={() => {
                      setDrop("");
                      setDropObj(null);
                    }}
                    hitSlop={8}
                  >
                    <Ionicons name="close-circle" size={14} color={C.textMuted} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity activeOpacity={0.7}
                  onPress={() => { setMapPickerTarget("drop"); setShowMapPicker(true); }}
                  hitSlop={8}
                  style={{ marginLeft: 4, padding: 3 }}
                >
                  <Ionicons name="map-outline" size={16} color={C.red} />
                </TouchableOpacity>
              </View>

              {dropFocus && (
                <View style={ds.sugg}>
                  {dropLoading && (
                    <ActivityIndicator size="small" color={C.red} style={{ padding: 6 }} />
                  )}
                  <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="always" style={{ maxHeight: 150 }}>
                    {dropPreds.slice(0, 5).map((pred) => (
                      <TouchableOpacity activeOpacity={0.7} key={pred.placeId} onPress={() => selectDrop(pred)} style={ds.suggRow}>
                        <Ionicons name="location-outline" size={13} color={C.red} />
                        <View style={{ flex: 1 }}>
                          <Text style={ds.suggTxt}>{pred.mainText}</Text>
                          {pred.secondaryText ? (
                            <Text style={ds.suggSub} numberOfLines={1}>{pred.secondaryText}</Text>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            <TouchableOpacity activeOpacity={0.7}
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
                backgroundColor: C.surface,
                borderWidth: 1,
                borderColor: C.border,
                alignItems: "center" as const,
                justifyContent: "center" as const,
                alignSelf: "center" as const,
              }}
            >
              <Ionicons name="swap-vertical" size={14} color={C.primary} />
            </TouchableOpacity>
          </View>

          {stops.map((stop, idx) => (
            <View key={stop.id} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.amberBrown }} />
              <TextInput
                value={stopInputs[String(idx)] ?? stop.address}
                onChangeText={v => setStopInputs(prev => ({ ...prev, [String(idx)]: v }))}
                placeholder={`Stop ${idx + 1} location...`}
                placeholderTextColor={C.textMuted}
                style={{ flex: 1, fontFamily: Font.regular, fontSize: 14, color: C.text, paddingVertical: 8 }}
              />
              <TouchableOpacity activeOpacity={0.7} onPress={() => { setMapPickerTarget(idx); setShowMapPicker(true); }} hitSlop={8} style={{ padding: 4 }}>
                <Ionicons name="map-outline" size={16} color={C.amberBrown} />
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.7} onPress={() => removeStop(idx)} hitSlop={8} style={{ padding: 4 }}>
                <Ionicons name="close-circle" size={16} color={C.textMuted} />
              </TouchableOpacity>
            </View>
          ))}

          {!isParcelService(rideType, services.find(s => s.key === rideType)) && rideType !== "school_shift" && (
            <TouchableOpacity activeOpacity={0.7}
              onPress={addStop}
              style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6, paddingVertical: 4, paddingHorizontal: 4 }}
            >
              <Ionicons name="add-circle-outline" size={14} color={C.primary} />
              <Text style={{ fontFamily: Font.medium, fontSize: 11, color: C.primary }}>Add Stop</Text>
            </TouchableOpacity>
          )}
        </View>
      </LinearGradient>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16 }}
      >
        {debtBalance > 0 && !debtDismissed && (
          <View
            style={{
              marginBottom: 14,
              backgroundColor: C.redBg,
              borderWidth: 1,
              borderColor: C.redBorder,
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
                    backgroundColor: C.redBorder,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="warning" size={18} color={C.red} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontFamily: Font.bold,
                      fontSize: 14,
                      color: C.redDeepest,
                    }}
                  >
                    Outstanding Balance: Rs. {debtBalance}
                  </Text>
                  <Text
                    style={{
                      fontFamily: Font.regular,
                      fontSize: 12,
                      color: C.redDark,
                      marginTop: 2,
                    }}
                  >
                    You have an unpaid cancellation fee
                  </Text>
                </View>
              </View>
              <TouchableOpacity activeOpacity={0.7}
                onPress={() => setDebtDismissed(true)}
                hitSlop={8}
              >
                <Ionicons name="close" size={16} color={C.redDeepest} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity activeOpacity={0.7}
              onPress={() => router.push("/(tabs)/wallet")}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                backgroundColor: C.red,
                borderRadius: 12,
                paddingVertical: 12,
              }}
            >
              <Ionicons name="wallet-outline" size={16} color={C.textInverse} />
              <Text
                style={{
                  fontFamily: Font.bold,
                  fontSize: 13,
                  color: C.textInverse,
                }}
              >
                Pay Now
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {popularSpots.length > 0 && (
          <>
            <Text
              style={{
                fontFamily: Font.bold,
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
              style={{ marginBottom: 14, marginHorizontal: -16 }}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
            >
              {popularSpots.map((spot) => (
                <TouchableOpacity activeOpacity={0.7}
                  key={spot.id}
                  onPress={() => handleChip(spot)}
                  style={{
                    flexDirection: "row" as const,
                    alignItems: "center" as const,
                    gap: 6,
                    backgroundColor: C.surface,
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 50,
                    borderWidth: 1,
                    borderColor: C.border,
                    ...Platform.select({
                      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
                      android: { elevation: 1 },
                      web: { boxShadow: "0 1px 4px rgba(0,0,0,0.06)" },
                    }),
                  }}
                >
                  <Text style={{ fontSize: 13 }}>{spot.icon || "📍"}</Text>
                  <Text
                    style={{
                      fontFamily: Font.semiBold,
                      fontSize: 12,
                      color: C.text,
                    }}
                  >
                    {spot.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        {rideType === "school_shift" && (
          <TouchableOpacity activeOpacity={0.7}
            onPress={() => setShowSchoolModal(true)}
            style={{
              marginBottom: 14,
              backgroundColor: C.blueSoft,
              borderWidth: 1,
              borderColor: C.blueBorder,
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
                backgroundColor: C.blueBorder,
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
                  fontFamily: Font.bold,
                  color: C.navyDeep,
                }}
              >
                School Shift Subscribe
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: Font.regular,
                  color: C.royalBlue,
                  marginTop: 2,
                }}
              >
                Monthly school transport
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.royalBlue} />
          </TouchableOpacity>
        )}

        {rideCfg.surgeEnabled && (
          <View
            style={{
              marginBottom: 14,
              backgroundColor: C.orangeBg,
              borderWidth: 1,
              borderColor: C.orangeBorder,
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
                backgroundColor: C.orangeSoft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="flash" size={18} color={C.orangeBrand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: Font.bold,
                  color: C.orangeDark,
                }}
              >
                Surge Active x{rideCfg.surgeMultiplier}
              </Text>
              <Text
                style={{
                  fontSize: 11,
                  fontFamily: Font.regular,
                  color: C.orangeDark,
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
            fontFamily: Font.bold,
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
          <React.Fragment>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -16, marginBottom: 8 }}
            contentContainerStyle={{
              paddingHorizontal: 16,
              gap: 8,
              flexDirection: "row",
            }}
          >
            {services.map((svc) => {
              const active = rideType === svc.key;
              const accentColor = svc.color ?? C.primary;
              const feats: string[] = [];
              if (svc.perKm > 0) feats.push(`Rs. ${svc.perKm}/km`);
              if (svc.maxPassengers > 1) feats.push(`${svc.maxPassengers} seats`);
              if (svc.allowBargaining) feats.push("Bargain OK");
              if (svc.description) feats.push(svc.description);
              const cardInner = (
                <View
                  style={{
                    borderRadius: active ? 15 : 16,
                    padding: 12,
                    backgroundColor: active ? `${accentColor}0A` : C.textInverse,
                    ...(active ? {} : { borderWidth: 1.5, borderColor: C.border }),
                    overflow: "hidden",
                    minHeight: 120,
                  }}
                >
                  {active && (
                    <View style={{ position: "absolute", top: 8, right: 8 }}>
                      <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: accentColor, alignItems: "center", justifyContent: "center" }}>
                        <Ionicons name="checkmark" size={10} color="#fff" />
                      </View>
                    </View>
                  )}
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 14,
                      backgroundColor: active ? `${accentColor}18` : C.surfaceSecondary,
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ fontSize: 24 }}>{svc.icon}</Text>
                  </View>
                  <Text style={{ fontFamily: Font.bold, fontSize: 14, color: active ? accentColor : C.text }}>
                    {svc.name}
                  </Text>
                  {svc.nameUrdu ? (
                    <Text style={{ fontSize: 10, color: C.textMuted, fontFamily: Font.regular }}>
                      {svc.nameUrdu}
                    </Text>
                  ) : null}
                  <Text style={{ fontFamily: Font.semiBold, fontSize: 12, color: active ? accentColor : C.textSecondary, marginTop: 2 }}>
                    Rs. {svc.minFare}
                  </Text>
                  <View style={{ gap: 3, marginTop: 6 }}>
                    {feats.slice(0, 2).map((f) => (
                      <View key={f} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Ionicons
                          name="checkmark-circle"
                          size={10}
                          color={active ? accentColor : C.textMuted}
                        />
                        <Text
                          style={{ fontFamily: Font.regular, fontSize: 10, color: C.textSecondary }}
                          numberOfLines={1}
                        >
                          {f}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              );
              return (
                <TouchableOpacity activeOpacity={0.7}
                  key={svc.key}
                  onPress={() => setRideType(svc.key)}
                  style={{
                    width: 130,
                    borderRadius: 17,
                  }}
                >
                  {active ? (
                    <LinearGradient
                      colors={[accentColor, `${accentColor}70`, `${accentColor}30`]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={{ borderRadius: 17, padding: 1.5 }}
                    >
                      {cardInner}
                    </LinearGradient>
                  ) : cardInner}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {services.length > 1 && (
            <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 10, height: 6, gap: 4 }}>
              <Animated.View
                style={{
                  position: "absolute",
                  left: svcIndicatorX,
                  width: 20,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: services.find((s) => s.key === rideType)?.color ?? C.primary,
                }}
              />
              {services.map((svc) => (
                <View
                  key={svc.key}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: svc.key === rideType ? "transparent" : C.borderLight,
                  }}
                />
              ))}
            </View>
          )}
          </React.Fragment>
        )}

        {estimating && <FareEstimateSkeleton />}
        {!estimating && estimate && (
          <View
            style={{
              borderRadius: 20,
              overflow: "hidden",
              marginBottom: 14,
              borderWidth: 1,
              borderColor: C.border,
              backgroundColor: C.surface,
              ...Platform.select({
                ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8 },
                android: { elevation: 2 },
                web: { boxShadow: "0 2px 8px rgba(0,0,0,0.07)" },
              }),
            }}
          >
            {pickupObj && dropObj && (
              <TouchableOpacity activeOpacity={0.7}
                onPress={() => {
                  const url = `https://www.google.com/maps/dir/?api=1&origin=${pickupObj.lat},${pickupObj.lng}&destination=${dropObj.lat},${dropObj.lng}&travelmode=driving`;
                  Linking.openURL(url);
                }}
                style={{ width: "100%", height: 120, backgroundColor: C.surfaceSecondary }}
              >
                <Image
                  source={{ uri: staticMapUrl([{ lat: pickupObj.lat, lng: pickupObj.lng, color: "green" }, { lat: dropObj.lat, lng: dropObj.lng, color: "red" }], { width: Math.round(screenWidth - 40), height: 120 }) }}
                  style={{ width: "100%", height: 120 }}
                  resizeMode="cover"
                />
                <View style={{ position: "absolute", bottom: 6, right: 8, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Ionicons name="navigate-outline" size={11} color={C.textInverse} />
                  <Text style={{ ...Typ.smallMedium, fontSize: 10, color: C.textInverse }}>Open in Maps</Text>
                </View>
              </TouchableOpacity>
            )}
            <View style={{ padding: 18 }}>
              {estimateAgeMinutes >= 5 && (
                <View style={{ backgroundColor: C.yellowLightBg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="time-outline" size={13} color={C.amberBrown} />
                  <Text style={{ fontFamily: Font.medium, fontSize: 12, color: C.amberBrown, flex: 1 }}>
                    Estimate is {estimateAgeMinutes} min old — prices may have changed
                  </Text>
                </View>
              )}
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 14,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text
                    style={{
                      fontFamily: Font.bold,
                      fontSize: 15,
                      color: C.text,
                    }}
                  >
                    Fare Estimate
                  </Text>
                  {estimateAgeMinutes < 5 && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.successSoft, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: C.greenLightBg }}>
                      <Animated.View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.emerald, opacity: liveAnim }} />
                      <Text style={{ fontFamily: Font.bold, fontSize: 10, color: C.emerald, letterSpacing: 0.5 }}>LIVE</Text>
                    </View>
                  )}
                </View>
                <TouchableOpacity activeOpacity={0.7}
                  onPress={() => {
                    if (pickupObj && dropObj) {
                      const url = `https://www.google.com/maps/dir/?api=1&origin=${pickupObj.lat},${pickupObj.lng}&destination=${dropObj.lat},${dropObj.lng}&travelmode=${rideType === "bike" || rideType === "rickshaw" ? "bicycling" : "driving"}`;
                      Linking.openURL(url);
                    }
                  }}
                  style={{
                    flexDirection: "row" as const,
                    alignItems: "center" as const,
                    gap: 4,
                    backgroundColor: C.blueSoft,
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 10,
                  }}
                >
                  <Ionicons name="navigate-outline" size={12} color={C.royalBlue} />
                  <Text style={{ fontSize: 11, color: C.royalBlue, fontFamily: Font.semiBold }}>Route</Text>
                </TouchableOpacity>
              </View>
              {estimateAgeMinutes < 5 && (
                <View style={{ marginBottom: 10 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                    <Text style={{ fontFamily: Font.regular, fontSize: 10, color: C.textMuted }}>
                      {estimateAgeMinutes === 0 ? "Updated just now" : `Updated ${estimateAgeMinutes} min ago`}
                    </Text>
                    <Text style={{ fontFamily: Font.regular, fontSize: 10, color: C.textMuted }}>
                      {Math.max(0, 5 - estimateAgeMinutes)} min left
                    </Text>
                  </View>
                  <View style={{ height: 3, backgroundColor: C.borderLight, borderRadius: 2, overflow: "hidden" }}>
                    <View
                      style={{
                        height: "100%",
                        width: `${(1 - Math.min(estimateAgeMinutes / 5, 1)) * 100}%`,
                        backgroundColor: estimateAgeMinutes >= 4 ? C.danger : estimateAgeMinutes >= 2 ? C.amberBrown : C.emerald,
                        borderRadius: 2,
                      }}
                    />
                  </View>
                </View>
              )}
              <View
                style={{ flexDirection: "row", alignItems: "center" }}
              >
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text
                    style={{
                      fontFamily: Font.regular,
                      fontSize: 11,
                      color: C.textMuted,
                    }}
                  >
                    Distance
                  </Text>
                  <Text
                    style={{
                      fontFamily: Font.bold,
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
                      fontFamily: Font.regular,
                      fontSize: 11,
                      color: C.textMuted,
                    }}
                  >
                    Duration
                  </Text>
                  <Text
                    style={{
                      fontFamily: Font.bold,
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
                      fontFamily: Font.regular,
                      fontSize: 11,
                      color: C.textMuted,
                    }}
                  >
                    Total
                  </Text>
                  <Text
                    style={{
                      fontFamily: Font.bold,
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
            <TouchableOpacity activeOpacity={0.7}
              onPress={() => {
                setShowBargain((v) => !v);
                setOfferedFare("");
                setBargainNote("");
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: showBargain ? C.orangeBg : C.textInverse,
                borderWidth: 1.5,
                borderColor: showBargain ? C.goldWarm : C.border,
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
                      ? C.orangeSoft
                      : C.surfaceSecondary,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons
                    name="chatbubble-ellipses-outline"
                    size={20}
                    color={showBargain ? C.orangeBrand : C.textSecondary}
                  />
                </View>
                <View>
                  <Text
                    style={{
                      fontFamily: Font.bold,
                      fontSize: 14,
                      color: showBargain ? C.orangeDark : C.text,
                    }}
                  >
                    {showBargain ? "Bargaining ON" : "Make an Offer"}
                  </Text>
                  <Text
                    style={{
                      fontFamily: Font.regular,
                      fontSize: 11,
                      color: showBargain ? C.orangeBrand : C.textMuted,
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
                color={showBargain ? C.orangeBrand : C.textMuted}
              />
            </TouchableOpacity>

            <Animated.View
              style={{
                overflow: "hidden",
                maxHeight: bargainPanelH.interpolate({ inputRange: [0, 1], outputRange: [0, 280] }),
                opacity: bargainPanelH,
              }}
            >
              <View
                style={{
                  backgroundColor: C.orangeBg,
                  borderWidth: 1,
                  borderColor: C.orangeBorder,
                  borderTopWidth: 0,
                  borderBottomLeftRadius: 16,
                  borderBottomRightRadius: 16,
                  padding: 16,
                  gap: 12,
                }}
              >
                <Text
                  style={{
                    fontFamily: Font.medium,
                    fontSize: 12,
                    color: C.amberBrown,
                  }}
                >
                  Platform fare: Rs. {estimate.fare} · Min: Rs.{" "}
                  {estimate.minOffer}
                </Text>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: C.surface,
                    borderWidth: 1.5,
                    borderColor: C.goldWarm,
                    borderRadius: 14,
                    paddingHorizontal: 14,
                    paddingVertical: 4,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: Font.bold,
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
                    placeholderTextColor={C.silverBg}
                    style={{
                      flex: 1,
                      fontFamily: Font.bold,
                      fontSize: 20,
                      color: C.text,
                      paddingVertical: 10,
                    }}
                  />
                  {offeredFare !== "" && (
                    <TouchableOpacity activeOpacity={0.7} onPress={() => setOfferedFare("")}>
                      <Ionicons
                        name="close-circle"
                        size={18}
                        color={C.silverBg}
                      />
                    </TouchableOpacity>
                  )}
                </View>
                <TextInput
                  value={bargainNote}
                  onChangeText={setBargainNote}
                  placeholder="Note (optional)"
                  placeholderTextColor={C.silverBg}
                  maxLength={500}
                  style={{
                    backgroundColor: C.surface,
                    borderWidth: 1,
                    borderColor: C.orangeBorder,
                    borderRadius: 12,
                    padding: 12,
                    fontFamily: Font.regular,
                    fontSize: 13,
                    color: C.text,
                  }}
                />
                <Text
                  style={{
                    fontSize: 11,
                    color: C.orangeDark,
                    lineHeight: 16,
                    fontFamily: Font.regular,
                  }}
                >
                  The rider can accept, counter, or reject your offer.
                </Text>
              </View>
            </Animated.View>
          </View>
        )}

        {isParcelService(rideType, services.find((s) => s.key === rideType)) && (
          <View style={{ marginBottom: 14 }}>
            <Text style={{ fontFamily: Font.bold, fontSize: 15, color: C.text, marginBottom: 10 }}>
              Receiver Details
            </Text>
            <TextInput
              value={receiverName}
              onChangeText={setReceiverName}
              placeholder="Receiver full name"
              placeholderTextColor={C.textMuted}
              style={{
                fontFamily: Font.regular,
                fontSize: 14,
                color: C.text,
                backgroundColor: C.surface,
                borderWidth: 1,
                borderColor: C.border,
                borderRadius: 10,
                paddingHorizontal: 14,
                paddingVertical: 12,
                marginBottom: 10,
              }}
            />
            <TextInput
              value={receiverPhone}
              onChangeText={setReceiverPhone}
              placeholder="Receiver phone (03XXXXXXXXX)"
              placeholderTextColor={C.textMuted}
              keyboardType="phone-pad"
              style={{
                fontFamily: Font.regular,
                fontSize: 14,
                color: C.text,
                backgroundColor: C.surface,
                borderWidth: 1,
                borderColor: C.border,
                borderRadius: 10,
                paddingHorizontal: 14,
                paddingVertical: 12,
              }}
            />
          </View>
        )}

        {!isParcelService(rideType, services.find(s => s.key === rideType)) && rideType !== "school_shift" && (
          <View style={{ marginBottom: 14 }}>
            <TouchableOpacity activeOpacity={0.7}
              onPress={() => setIsScheduled(v => !v)}
              style={{
                flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                backgroundColor: isScheduled ? C.blueSoft : C.textInverse,
                borderWidth: 1.5, borderColor: isScheduled ? C.primary : C.border,
                borderRadius: 16, padding: 16,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: isScheduled ? C.blueBorder : C.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="calendar-outline" size={20} color={isScheduled ? C.primary : C.textSecondary} />
                </View>
                <View>
                  <Text style={{ fontFamily: Font.bold, fontSize: 14, color: isScheduled ? C.primary : C.text }}>
                    {isScheduled ? "Scheduled Ride" : "Schedule for Later"}
                  </Text>
                  <Text style={{ fontFamily: Font.regular, fontSize: 11, color: isScheduled ? C.primary : C.textMuted }}>
                    {isScheduled ? `${scheduledDate} at ${scheduledTime}` : "Book a ride for a specific date & time"}
                  </Text>
                </View>
              </View>
              <Ionicons name={isScheduled ? "chevron-up" : "chevron-down"} size={18} color={isScheduled ? C.primary : C.textMuted} />
            </TouchableOpacity>
            {isScheduled && (
              <View style={{ backgroundColor: C.blueSoft, borderWidth: 1, borderColor: C.blueBorder, borderTopWidth: 0, borderBottomLeftRadius: 16, borderBottomRightRadius: 16, padding: 16, gap: 12 }}>
                <View>
                  <Text style={{ fontFamily: Font.medium, fontSize: 12, color: C.textMuted, marginBottom: 6 }}>Date</Text>
                  <TextInput
                    value={scheduledDate}
                    onChangeText={setScheduledDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={C.textMuted}
                    style={{ backgroundColor: C.textInverse, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontFamily: Font.regular, fontSize: 14, color: C.text }}
                  />
                </View>
                <View>
                  <Text style={{ fontFamily: Font.medium, fontSize: 12, color: C.textMuted, marginBottom: 6 }}>Time</Text>
                  <TextInput
                    value={scheduledTime}
                    onChangeText={setScheduledTime}
                    placeholder="HH:MM (24h)"
                    placeholderTextColor={C.textMuted}
                    style={{ backgroundColor: C.textInverse, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontFamily: Font.regular, fontSize: 14, color: C.text }}
                  />
                </View>
                <Text style={{ fontSize: 11, color: C.primary, fontFamily: Font.regular }}>
                  Your ride will be sent to nearby riders 15 minutes before the scheduled time.
                </Text>
              </View>
            )}
          </View>
        )}

        {!isParcelService(rideType, services.find(s => s.key === rideType)) && rideType !== "school_shift" && !isScheduled && (
          <TouchableOpacity activeOpacity={0.7}
            onPress={() => setIsPoolRide(v => !v)}
            style={{
              flexDirection: "row", alignItems: "center", justifyContent: "space-between",
              backgroundColor: isPoolRide ? C.greenBg : C.textInverse,
              borderWidth: 1.5, borderColor: isPoolRide ? C.success : C.border,
              borderRadius: 16, padding: 16, marginBottom: 14,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: isPoolRide ? C.greenLightBg : C.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="people-outline" size={20} color={isPoolRide ? C.success : C.textSecondary} />
              </View>
              <View>
                <Text style={{ fontFamily: Font.bold, fontSize: 14, color: isPoolRide ? C.success : C.text }}>
                  {isPoolRide ? "Pool Ride ON" : "Share Ride (Pool)"}
                </Text>
                <Text style={{ fontFamily: Font.regular, fontSize: 11, color: isPoolRide ? C.success : C.textMuted }}>
                  {isPoolRide ? "You may share this ride — cheaper fare" : "Share with others going the same way"}
                </Text>
              </View>
            </View>
            <View style={{ width: 44, height: 26, borderRadius: 13, backgroundColor: isPoolRide ? C.success : C.border, padding: 3, justifyContent: "center", alignItems: isPoolRide ? "flex-end" : "flex-start" }}>
              <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" }} />
            </View>
          </TouchableOpacity>
        )}

        <Text
          style={{
            fontFamily: Font.bold,
            fontSize: 15,
            color: C.text,
            marginBottom: 10,
          }}
        >
          Payment
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginBottom: 14 }}
          contentContainerStyle={{ gap: 8, paddingRight: 20 }}
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
              (user?.walletBalance ?? 0) < (offeredFare ? parseFloat(offeredFare) : estimate.fare);
            const pmLabel = pm.label || pm.name || pmId;
            const pmIcon: string = isCash ? "cash-outline" : isWallet ? "wallet-outline" : isJazzcash ? "phone-portrait-outline" : isEasypaisa ? "phone-portrait-outline" : "card-outline";
            const pmColor = isCash ? C.success : isWallet ? C.primary : isJazzcash ? C.red : isEasypaisa ? C.emerald : C.primary;
            const pmBg = isCash ? C.greenLightBg : isWallet ? C.blueBorder : isJazzcash ? C.redBorder : isEasypaisa ? C.greenLightBg : C.blueBorder;
            const balanceLabel = isWallet ? ` · Rs. ${(user?.walletBalance ?? 0).toLocaleString()}` : "";
            return (
              <TouchableOpacity activeOpacity={0.7}
                key={pmId}
                onPress={() => setPayMethod(pmId)}
                style={{
                  flexDirection: "row" as const,
                  alignItems: "center" as const,
                  gap: 7,
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  borderRadius: 24,
                  borderWidth: 1.5,
                  borderColor: active ? pmColor : C.border,
                  backgroundColor: active ? `${pmColor}10` : C.textInverse,
                }}
              >
                <View
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 10,
                    backgroundColor: active ? pmBg : C.surfaceSecondary,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons
                    name={pmIcon as any}
                    size={16}
                    color={active ? pmColor : C.textSecondary}
                  />
                </View>
                <Text
                  style={{
                    fontFamily: active ? Font.bold : Font.semiBold,
                    fontSize: 13,
                    color: active ? C.text : C.textSecondary,
                  }}
                >
                  {pmLabel}{balanceLabel}
                </Text>
                {active && (
                  <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: pmColor, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="checkmark" size={10} color="#fff" />
                  </View>
                )}
                {insufficient && (
                  <Ionicons name="alert-circle" size={14} color={C.danger} />
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

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
              fontFamily: Font.regular,
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
            backgroundColor: C.greenBg,
            padding: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: C.greenLightBg,
          }}
        >
          <Ionicons
            name="shield-checkmark-outline"
            size={15}
            color={C.emerald}
          />
          <Text
            style={{
              fontFamily: Font.regular,
              fontSize: 12,
              color: C.greenDeep,
            }}
          >
            All rides insured · Verified drivers · GPS tracked
          </Text>
        </View>

        <TouchableOpacity activeOpacity={0.7}
          onPress={handleBook}
          disabled={booking || !estimate}
          onPressIn={() => Animated.spring(bookBtnScale, { toValue: 0.96, useNativeDriver: false, tension: 300, friction: 10 }).start()}
          onPressOut={() => Animated.spring(bookBtnScale, { toValue: 1, useNativeDriver: false, tension: 300, friction: 10 }).start()}
          style={{ opacity: booking || !estimate ? 0.6 : 1, borderRadius: 18 }}
        >
          <Animated.View style={{ transform: [{ scale: bookBtnScale }], borderRadius: 18, overflow: "hidden" }}>
            <LinearGradient
              colors={showBargain && offeredFare ? ["#E05A00", "#FF7B1A"] : ["#003399", "#0052CC", "#1A72E8"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                borderRadius: 18,
                paddingVertical: 18,
                paddingHorizontal: 24,
              }}
            >
              {booking ? (
                <ActivityIndicator color={C.textInverse} />
              ) : (
                <>
                  {showBargain && offeredFare ? (
                    <Ionicons name="chatbubble-ellipses" size={20} color={C.textInverse} />
                  ) : (
                    <Text style={{ fontSize: 22 }}>{selectedSvc?.icon ?? "🚗"}</Text>
                  )}
                  <Text style={{ fontFamily: Font.bold, fontSize: 16, color: C.textInverse, letterSpacing: 0.3 }}>
                    {showBargain && offeredFare
                      ? `Send Offer · Rs. ${offeredFare}`
                      : `Book ${selectedSvc?.name ?? rideType}${estimate ? ` · Rs. ${estimate.fare}` : ""}`}
                  </Text>
                  {!booking && estimate && !(showBargain && offeredFare) && (
                    <Ionicons name="arrow-forward" size={18} color="rgba(255,255,255,0.8)" />
                  )}
                </>
              )}
            </LinearGradient>
          </Animated.View>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal
        visible={showHistory}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowHistory(false)}
      >
        <View style={{ flex: 1, backgroundColor: C.background }}>
          <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 4 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: C.border }} />
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 20,
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: C.border,
            }}
          >
            <Text
              style={{
                fontFamily: Font.bold,
                fontSize: 18,
                color: C.text,
              }}
            >
              Ride History
            </Text>
            <TouchableOpacity activeOpacity={0.7}
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
            </TouchableOpacity>
          </View>
          {histLoading ? (
            <View style={{ padding: 20 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <HistoryRowSkeleton key={i} dark={colorScheme === "dark"} />
              ))}
            </View>
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
                  fontFamily: Font.semiBold,
                  fontSize: 15,
                  color: C.text,
                }}
              >
                No rides yet
              </Text>
              <Text
                style={{
                  fontFamily: Font.regular,
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
                    backgroundColor: C.surface,
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
                        fontFamily: Font.medium,
                        fontSize: 13,
                        color: C.text,
                      }}
                      numberOfLines={1}
                    >
                      {ride.pickupAddress} → {ride.dropAddress}
                    </Text>
                    <Text
                      style={{
                        fontFamily: Font.regular,
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
                        fontFamily: Font.bold,
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
                            ? C.greenLightBg
                            : ride.status === "cancelled"
                              ? C.redBorder
                              : C.yellowLightBg,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: 8,
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: Font.medium,
                          fontSize: 10,
                          color:
                            ride.status === "completed"
                              ? C.emerald
                              : ride.status === "cancelled"
                                ? C.red
                                : C.amberBrown,
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
              backgroundColor: C.surface,
              borderBottomWidth: 1,
              borderBottomColor: C.border,
            }}
          >
            <Text
              style={{
                fontSize: 18,
                fontFamily: Font.bold,
                flex: 1,
                color: C.text,
              }}
            >
              School Shift Subscribe
            </Text>
            <TouchableOpacity activeOpacity={0.7}
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
            </TouchableOpacity>
          </View>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 20, gap: 14 }}
          >
            <Text
              style={{
                fontFamily: Font.semiBold,
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
                  backgroundColor: C.surface,
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
                    fontFamily: Font.semiBold,
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
                <TouchableOpacity activeOpacity={0.7}
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
                        : C.textInverse,
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
                        backgroundColor: C.blueBorder,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ fontSize: 22 }}>🚌</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontFamily: Font.bold,
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
                            backgroundColor: C.greenLightBg,
                            borderRadius: 8,
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 11,
                              fontFamily: Font.bold,
                              color: C.greenBright,
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
                </TouchableOpacity>
              ))
            )}

            {selectedRoute && (
              <>
                <View
                  style={{ height: 1, backgroundColor: C.border }}
                />
                <Text
                  style={{
                    fontFamily: Font.semiBold,
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
                        fontFamily: Font.medium,
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
                        backgroundColor: C.surface,
                      }}
                    >
                      <TextInput
                        value={schoolStudent}
                        onChangeText={setSchoolStudent}
                        placeholder="e.g. Ali Khan"
                        style={{
                          fontFamily: Font.regular,
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
                        fontFamily: Font.medium,
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
                        backgroundColor: C.surface,
                      }}
                    >
                      <TextInput
                        value={schoolClass}
                        onChangeText={setSchoolClass}
                        placeholder="e.g. 7th Grade"
                        style={{
                          fontFamily: Font.regular,
                          fontSize: 14,
                          color: C.text,
                        }}
                        placeholderTextColor={C.textMuted}
                      />
                    </View>
                  </View>
                  <View>
                    <Text style={{ fontSize: 12, color: C.textSecondary, marginBottom: 6, fontFamily: Font.medium }}>
                      Shift
                    </Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {(["morning", "afternoon", "both"] as const).map(s => (
                        <TouchableOpacity activeOpacity={0.7}
                          key={s}
                          onPress={() => setSchoolShift(s)}
                          style={{
                            flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: "center",
                            backgroundColor: schoolShift === s ? C.primary : C.textInverse,
                            borderWidth: 1.5, borderColor: schoolShift === s ? C.primary : C.border,
                          }}
                        >
                          <Text style={{ fontSize: 12, fontFamily: Font.semiBold, color: schoolShift === s ? C.textInverse : C.textSecondary, textTransform: "capitalize" }}>{s}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {selectedRoute?.morningTime && schoolShift !== "afternoon" ? (
                      <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 4, fontFamily: Font.regular }}>
                        AM pickup: {selectedRoute.morningTime}
                      </Text>
                    ) : null}
                    {selectedRoute?.afternoonTime && schoolShift !== "morning" ? (
                      <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 2, fontFamily: Font.regular }}>
                        PM pickup: {selectedRoute.afternoonTime}
                      </Text>
                    ) : null}
                  </View>
                  <View>
                    <Text style={{ fontSize: 12, color: C.textSecondary, marginBottom: 6, fontFamily: Font.medium }}>
                      Start Date
                    </Text>
                    <View style={{ borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: C.surface }}>
                      <TextInput
                        value={schoolStartDate}
                        onChangeText={v => setSchoolStartDate(v)}
                        placeholder="YYYY-MM-DD"
                        style={{ fontFamily: Font.regular, fontSize: 14, color: C.text }}
                        placeholderTextColor={C.textMuted}
                        keyboardType="numbers-and-punctuation"
                        maxLength={10}
                      />
                    </View>
                    <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 3, fontFamily: Font.regular }}>
                      Subscription starts on this date (today or later)
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontFamily: Font.medium, color: C.text }}>Auto-Renew Monthly</Text>
                      <Text style={{ fontSize: 11, color: C.textMuted, fontFamily: Font.regular }}>Renew subscription every 30 days</Text>
                    </View>
                    <TouchableOpacity activeOpacity={0.7}
                      onPress={() => setSchoolRecurring(r => !r)}
                      style={{
                        width: 48, height: 26, borderRadius: 13,
                        backgroundColor: schoolRecurring ? C.primary : C.border,
                        justifyContent: "center", paddingHorizontal: 3,
                      }}
                    >
                      <View style={{
                        width: 20, height: 20, borderRadius: 10, backgroundColor: C.surface,
                        alignSelf: schoolRecurring ? "flex-end" : "flex-start",
                      }} />
                    </TouchableOpacity>
                  </View>
                  <View>
                    <Text
                      style={{
                        fontSize: 12,
                        color: C.textSecondary,
                        marginBottom: 6,
                        fontFamily: Font.medium,
                      }}
                    >
                      Notes (Optional)
                    </Text>
                    <View
                      style={{
                        borderWidth: 1.5,
                        borderColor: C.border,
                        borderRadius: 14,
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                        backgroundColor: C.surface,
                        minHeight: 72,
                      }}
                    >
                      <TextInput
                        value={schoolNotes}
                        onChangeText={setSchoolNotes}
                        placeholder="e.g. Drop off at gate B, allergies, etc."
                        style={{
                          fontFamily: Font.regular,
                          fontSize: 14,
                          color: C.text,
                        }}
                        placeholderTextColor={C.textMuted}
                        multiline
                        numberOfLines={2}
                      />
                    </View>
                  </View>
                </View>
                <View
                  style={{
                    backgroundColor: C.yellowLightBg,
                    borderRadius: 14,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: C.amberBorder,
                    marginTop: 4,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      color: C.amberBrown,
                      fontFamily: Font.medium,
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
                <TouchableOpacity activeOpacity={0.7}
                  onPress={handleSchoolSubscribe}
                  disabled={subscribing}
                  style={{
                    backgroundColor: subscribing
                      ? C.blueMist
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
                      fontFamily: Font.bold,
                      fontSize: 15,
                      color: C.textInverse,
                    }}
                  >
                    {subscribing
                      ? "Subscribing..."
                      : `Subscribe · Rs. ${selectedRoute.monthlyPrice?.toLocaleString()}/mo`}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
      <PermissionGuide
        visible={permGuideVisible}
        type="location"
        onClose={() => setPermGuideVisible(false)}
      />
      <MapPickerModal
        visible={showMapPicker}
        label={mapPickerTarget === "pickup" ? "Pickup" : mapPickerTarget === "drop" ? "Drop-off" : `Stop ${(mapPickerTarget as number) + 1}`}
        initialLat={
          mapPickerTarget === "pickup" ? (pickupObj?.lat ?? 33.7294)
          : mapPickerTarget === "drop" ? (dropObj?.lat ?? 33.7294)
          : 33.7294
        }
        initialLng={
          mapPickerTarget === "pickup" ? (pickupObj?.lng ?? 73.3872)
          : mapPickerTarget === "drop" ? (dropObj?.lng ?? 73.3872)
          : 73.3872
        }
        onConfirm={handleMapPickerConfirm}
        onClose={() => setShowMapPicker(false)}
      />
    </View>
  );
}

const rs = StyleSheet.create({
  hdrRow: { flexDirection: "row", alignItems: "center" },
  backBtnBlue: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
});

function makeDynStyles(C: typeof import("@/constants/colors").default.light) {
  return {
    sugg: {
      backgroundColor: C.surface,
      borderRadius: 10,
      marginTop: 4,
      borderWidth: 1,
      borderColor: C.border,
      maxHeight: 160,
    } as const,
    suggRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: C.borderLight,
    } as const,
    suggTxt: {
      fontFamily: Font.regular,
      fontSize: 12,
      color: C.text,
    } as const,
    suggSub: {
      fontFamily: Font.regular,
      fontSize: 10,
      color: C.textMuted,
      marginTop: 1,
    } as const,
  };
}
