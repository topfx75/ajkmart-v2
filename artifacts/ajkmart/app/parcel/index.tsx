import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useMapsAutocomplete, resolveLocation } from "@/hooks/useMaps";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { useLanguage } from "@/context/LanguageContext";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { getPaymentMethods, estimateParcel, createParcelBooking } from "@workspace/api-client-react";
import type { CreateParcelBookingRequest } from "@workspace/api-client-react";

interface ParcelBookingPayload extends CreateParcelBookingRequest {
  pickupLat?: number;
  pickupLng?: number;
  dropLat?: number;
  dropLng?: number;
}

const C = Colors.light;

interface ParcelType {
  id: string;
  label: string;
  emoji: string;
  desc: string;
  baseFare: number;
}

const PARCEL_TYPES: ParcelType[] = [
  { id: "document",    label: "Document",     emoji: "📄", desc: "Papers, certificates, files", baseFare: 150 },
  { id: "clothes",     label: "Clothes",      emoji: "👕", desc: "Garments, accessories",       baseFare: 200 },
  { id: "electronics", label: "Electronics",  emoji: "📱", desc: "Phones, gadgets, devices",    baseFare: 350 },
  { id: "food",        label: "Food/Gift",    emoji: "🎁", desc: "Packed food, gift items",     baseFare: 180 },
  { id: "other",       label: "Other",        emoji: "📦", desc: "Any other parcel",            baseFare: 250 },
];

const steps = ["Sender", "Receiver", "Parcel", "Payment"];

function Steps({ current, labels }: { current: number; labels: string[] }) {
  return (
    <View style={ss.steps}>
      {labels.map((lbl, i) => (
        <React.Fragment key={lbl}>
          <View style={ss.stepItem}>
            <View style={[ss.stepDot, i <= current && ss.stepDotActive]}>
              {i < current ? (
                <Ionicons name="checkmark" size={12} color="#fff" />
              ) : (
                <Text style={[ss.stepNum, i === current && { color: "#fff" }]}>{i + 1}</Text>
              )}
            </View>
            <Text style={[ss.stepLbl, i === current && { color: "#FBBF24" }]}>{lbl}</Text>
          </View>
          {i < steps.length - 1 && <View style={[ss.stepLine, i < current && ss.stepLineActive]} />}
        </React.Fragment>
      ))}
    </View>
  );
}

const PARCEL_DRAFT_KEY = "parcel_wizard_draft";

function ParcelScreenInner() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const { user, updateUser, token } = useAuth();
  const { showToast } = useToast();
  const { config: platformConfig } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const appName = platformConfig.platform.appName;
  const inMaintenance = platformConfig.appStatus === "maintenance";
  const parcelEnabled = platformConfig.features.parcel;

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedId, setConfirmedId] = useState("");
  const [confirmedFare, setConfirmedFare] = useState(0);
  const [showLocPicker, setShowLocPicker] = useState<"pickup" | "drop" | null>(null);
  const [locSearch,     setLocSearch]     = useState("");
  const { predictions, loading: locLoading } = useMapsAutocomplete(locSearch);

  const [senderName, setSenderName] = useState(user?.name || "");
  const [senderPhone, setSenderPhone] = useState(user?.phone || "");
  const [pickupAddress, setPickupAddress] = useState("");
  const [pickupLat, setPickupLat] = useState<number | undefined>(undefined);
  const [pickupLng, setPickupLng] = useState<number | undefined>(undefined);

  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [dropAddress, setDropAddress] = useState("");
  const [dropLat, setDropLat] = useState<number | undefined>(undefined);
  const [dropLng, setDropLng] = useState<number | undefined>(undefined);

  const [parcelType, setParcelType] = useState<string>("");
  const [weight, setWeight] = useState("");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [description, setDescription] = useState("");

  const VOLUMETRIC_DIVISOR = 5000;
  const volumetricWeight = (parseFloat(length) || 0) * (parseFloat(width) || 0) * (parseFloat(height) || 0) / VOLUMETRIC_DIVISOR;
  const actualWeight = parseFloat(weight) || 0;
  const chargeableWeight = Math.max(actualWeight, volumetricWeight);

  const [payMethod, setPayMethod] = useState<string>("cash");
  const [payMethods, setPayMethods] = useState<Array<{ id: string; label: string; logo: string; description: string }>>([
    { id: "cash", label: "Cash on Pickup", logo: "💵", description: "" },
  ]);

  const [estimatedFare, setEstimatedFare] = useState(0);
  const [fareLoading, setFareLoading] = useState(false);

  const selectedType = PARCEL_TYPES.find(t => t.id === parcelType);

  // Load wizard draft from AsyncStorage on mount
  useEffect(() => {
    AsyncStorage.getItem(PARCEL_DRAFT_KEY)
      .then(raw => {
        if (!raw) return;
        const d = JSON.parse(raw);
        if (d.senderName)    setSenderName(d.senderName);
        if (d.senderPhone)   setSenderPhone(d.senderPhone);
        if (d.pickupAddress) setPickupAddress(d.pickupAddress);
        if (d.receiverName)  setReceiverName(d.receiverName);
        if (d.receiverPhone) setReceiverPhone(d.receiverPhone);
        if (d.dropAddress)   setDropAddress(d.dropAddress);
        if (d.parcelType)    setParcelType(d.parcelType);
        if (d.weight)        setWeight(d.weight);
        if (d.description)   setDescription(d.description);
        if (d.step !== undefined) setStep(d.step);
      })
      .catch(() => {});
  }, []);

  // Persist wizard draft to AsyncStorage whenever key fields change
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (confirmed) {
      AsyncStorage.removeItem(PARCEL_DRAFT_KEY).catch(() => {});
      return;
    }
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(PARCEL_DRAFT_KEY, JSON.stringify({
        senderName, senderPhone, pickupAddress,
        receiverName, receiverPhone, dropAddress,
        parcelType, weight, description, step,
      })).catch(() => {});
    }, 500);
    return () => { if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current); };
  }, [senderName, senderPhone, pickupAddress, receiverName, receiverPhone, dropAddress, parcelType, weight, description, step, confirmed]);

  useEffect(() => {
    getPaymentMethods()
      .then(data => {
        if (data?.methods?.length) {
          setPayMethods(data.methods);
          setPayMethod(data.methods[0]!.id);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!parcelType) { setEstimatedFare(0); return; }
    setFareLoading(true);
    estimateParcel({ parcelType, weight: chargeableWeight > 0 ? chargeableWeight : undefined })
      .then(data => { if (data.fare) setEstimatedFare(data.fare); })
      .catch(() => {})
      .finally(() => setFareLoading(false));
  }, [parcelType, chargeableWeight]);

  const phoneRegex = /^03\d{9}$/;

  const validateStep = (s: number): boolean => {
    if (s === 0) {
      if (!senderName.trim()) { showToast(T("enterFullName"), "error"); return false; }
      if (!senderPhone.trim()) { showToast(T("enterPhoneNumber"), "error"); return false; }
      if (!phoneRegex.test(senderPhone.replace(/\s/g, ""))) { showToast("Phone must be in format 03XXXXXXXXX", "error"); return false; }
      if (!pickupAddress.trim()) { showToast(T("pickupAddress"), "error"); return false; }
    }
    if (s === 1) {
      if (!receiverName.trim()) { showToast(T("enterFullName"), "error"); return false; }
      if (!receiverPhone.trim()) { showToast(T("enterPhoneNumber"), "error"); return false; }
      if (!phoneRegex.test(receiverPhone.replace(/\s/g, ""))) { showToast("Phone must be in format 03XXXXXXXXX", "error"); return false; }
      if (!dropAddress.trim()) { showToast(T("dropAddress"), "error"); return false; }
    }
    if (s === 2) {
      if (!parcelType) { showToast(T("parcelType"), "error"); return false; }
    }
    return true;
  };

  const next = () => {
    if (validateStep(step)) setStep(s => s + 1);
  };
  const prev = () => setStep(s => s - 1);

  const bookParcel = async () => {
    setLoading(true);
    try {
      // Geocode any manually-typed addresses that don't have coordinates yet
      let finalPickupLat = pickupLat;
      let finalPickupLng = pickupLng;
      let finalDropLat   = dropLat;
      let finalDropLng   = dropLng;

      if (finalPickupLat === undefined || finalPickupLng === undefined) {
        try {
          const loc = await resolveLocation(pickupAddress);
          if (loc?.lat && loc?.lng) { finalPickupLat = loc.lat; finalPickupLng = loc.lng; }
        } catch { /* swallow — will fail validation below */ }
      }
      if (finalDropLat === undefined || finalDropLng === undefined) {
        try {
          const loc = await resolveLocation(dropAddress);
          if (loc?.lat && loc?.lng) { finalDropLat = loc.lat; finalDropLng = loc.lng; }
        } catch { /* swallow — will fail validation below */ }
      }

      // Block booking if either address could not be geocoded
      if (finalPickupLat === undefined || finalPickupLng === undefined) {
        showToast("Could not locate pickup address. Please select from suggestions or enter a more specific address.", "error");
        return;
      }
      if (finalDropLat === undefined || finalDropLng === undefined) {
        showToast("Could not locate drop-off address. Please select from suggestions or enter a more specific address.", "error");
        return;
      }

      const w = chargeableWeight > 0 ? chargeableWeight : (parseFloat(weight) || undefined);
      const payload: ParcelBookingPayload = {
        senderName, senderPhone, pickupAddress,
        receiverName, receiverPhone, dropAddress,
        parcelType: parcelType!, weight: w,
        description: description || undefined,
        paymentMethod: payMethod as "cash" | "wallet",
        ...(finalPickupLat !== undefined && finalPickupLng !== undefined ? { pickupLat: finalPickupLat, pickupLng: finalPickupLng } : {}),
        ...(finalDropLat !== undefined && finalDropLng !== undefined ? { dropLat: finalDropLat, dropLng: finalDropLng } : {}),
      };
      const data = await createParcelBooking(payload as CreateParcelBookingRequest);
      if (payMethod === "wallet" && user) {
        updateUser({ walletBalance: (user.walletBalance ?? 0) - data.fare });
      }
      setConfirmedId(data.id);
      setConfirmedFare(data.fare);
      setConfirmed(true);
    } catch (err: unknown) {
      const errMsg = (err as { message?: string })?.message;
      showToast(errMsg || "Could not book parcel", "error");
    } finally {
      setLoading(false);
    }
  };

  if (!parcelEnabled) {
    return (
      <View style={[ss.root, { justifyContent: "center", alignItems: "center", padding: 32 }]}>
        <Pressable onPress={() => router.back()} style={{ position: "absolute", top: topPad + 12, left: 16 }}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </Pressable>
        <View style={[ss.confirmCard, { borderColor: "#FEE2E2" }]}>
          <Text style={{ fontSize: 52 }}>🚫</Text>
          <Text style={[ss.confirmTitle, { color: "#EF4444" }]}>{T("serviceUnavailable")}</Text>
          <Text style={ss.confirmSub}>{T("maintenanceApology")}</Text>
          <Pressable style={[ss.doneBtn, { backgroundColor: "#FEF2F2", width: "100%" }]} onPress={() => router.back()}>
            <Text style={[ss.doneBtnTxt, { color: "#EF4444" }]}>{T("backToHome")}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (inMaintenance) {
    return (
      <View style={[ss.root, { justifyContent: "center", alignItems: "center", padding: 32 }]}>
        <View style={[ss.confirmCard, { borderColor: "#FEF3C7" }]}>
          <Text style={{ fontSize: 52 }}>🔧</Text>
          <Text style={[ss.confirmTitle, { color: "#D97706" }]}>{T("underMaintenance")}</Text>
          <Text style={ss.confirmSub}>{platformConfig.content.maintenanceMsg}</Text>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, textAlign: "center", marginTop: 8 }}>
            {T("maintenanceApology")}
          </Text>
        </View>
      </View>
    );
  }

  if (confirmed) {
    return (
      <View style={[ss.root, { justifyContent: "center", alignItems: "center", paddingHorizontal: 28 }]}>
        <View style={ss.confirmCard}>
          <LinearGradient colors={["#D97706", "#F59E0B"]} style={ss.confirmIconCircle}>
            <Ionicons name="checkmark" size={36} color="#fff" />
          </LinearGradient>
          <Text style={ss.confirmTitle}>{T("parcelBooked")}</Text>
          <Text style={ss.confirmSub}>
            Booking #{confirmedId.slice(-6).toUpperCase()}{"\n"}
            {T("estimatedDeliveryTime")}
          </Text>
          <View style={ss.confirmRow}>
            <View style={ss.confirmInfoBox}>
              <Text style={ss.confirmInfoLbl}>{T("pickup")}</Text>
              <Text style={ss.confirmInfoVal} numberOfLines={2}>{pickupAddress}</Text>
            </View>
            <Ionicons name="arrow-forward" size={20} color={C.textMuted} />
            <View style={ss.confirmInfoBox}>
              <Text style={ss.confirmInfoLbl}>{T("dropOff")}</Text>
              <Text style={ss.confirmInfoVal} numberOfLines={2}>{dropAddress}</Text>
            </View>
          </View>
          <View style={ss.fareBox}>
            <Text style={ss.fareLbl}>{T("totalFare")}</Text>
            <Text style={ss.fareVal}>Rs. {confirmedFare.toLocaleString()}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 10, width: "100%" }}>
            <Pressable style={[ss.doneBtn, { flex: 1, backgroundColor: "#F0FDF4" }]} onPress={() => { setConfirmed(false); router.push("/(tabs)"); }}>
              <Text style={[ss.doneBtnTxt, { color: "#059669" }]}>{T("home")}</Text>
            </Pressable>
            <Pressable style={[ss.doneBtn, { flex: 2 }]} onPress={() => { setConfirmed(false); router.push("/(tabs)/orders"); }}>
              <Ionicons name="cube-outline" size={16} color="#fff" style={{ marginRight: 4 }} />
              <Text style={ss.doneBtnTxt}>{T("trackParcel")}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={ss.root}>
      <LinearGradient colors={["#92400E", "#B45309", "#D97706"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[ss.header, { paddingTop: topPad + 14 }]}>
        <View style={ss.hdrRow}>
          <Pressable onPress={() => router.back()} style={ss.backBtn}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={ss.hdrTitle}>📦 {T("parcel")}</Text>
            <Text style={ss.hdrSub}>{T("parcelsAnywhere")}</Text>
          </View>
        </View>
        <Steps current={step} labels={[T("senderDetails"), T("receiverDetails"), T("parcelDetails"), T("paymentMethods")]} />
      </LinearGradient>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ss.scroll}>
        {step === 0 && (
          <View style={ss.card}>
            <Text style={ss.cardTitle}>📍 {T("senderDetails")}</Text>
            <Text style={ss.label}>{T("yourName")} *</Text>
            <TextInput value={senderName} onChangeText={setSenderName} placeholder={T("fullName")} placeholderTextColor={C.textMuted} style={ss.input} />
            <Text style={ss.label}>{T("yourPhone")} *</Text>
            <TextInput value={senderPhone} onChangeText={setSenderPhone} placeholder="03XX XXXXXXX" placeholderTextColor={C.textMuted} style={ss.input} keyboardType="phone-pad" />
            <Text style={ss.label}>{T("pickupAddress")} *</Text>
            <Pressable onPress={() => setShowLocPicker("pickup")} style={ss.locInput}>
              <Ionicons name="location-outline" size={16} color={pickupAddress ? C.text : C.textMuted} />
              <Text style={[ss.locInputTxt, !pickupAddress && { color: C.textMuted }]}>
                {pickupAddress || T("selectPickupLocation")}
              </Text>
              <Ionicons name="chevron-down" size={14} color={C.textMuted} />
            </Pressable>
            <Text style={ss.label}>{T("orTypeManually")}</Text>
            <TextInput
              value={pickupAddress}
              onChangeText={v => { setPickupAddress(v); setPickupLat(undefined); setPickupLng(undefined); }}
              placeholder="e.g. Chowk Adalat, Muzaffarabad"
              placeholderTextColor={C.textMuted}
              style={ss.input}
              multiline
            />
          </View>
        )}

        {step === 1 && (
          <View style={ss.card}>
            <Text style={ss.cardTitle}>📬 {T("receiverDetails")}</Text>
            <Text style={ss.label}>{T("receiverName")} *</Text>
            <TextInput value={receiverName} onChangeText={setReceiverName} placeholder={T("fullName")} placeholderTextColor={C.textMuted} style={ss.input} />
            <Text style={ss.label}>{T("receiverPhone")} *</Text>
            <TextInput value={receiverPhone} onChangeText={setReceiverPhone} placeholder="03XX XXXXXXX" placeholderTextColor={C.textMuted} style={ss.input} keyboardType="phone-pad" />
            <Text style={ss.label}>{T("dropAddress")} *</Text>
            <Pressable onPress={() => setShowLocPicker("drop")} style={ss.locInput}>
              <Ionicons name="location-outline" size={16} color={dropAddress ? C.text : C.textMuted} />
              <Text style={[ss.locInputTxt, !dropAddress && { color: C.textMuted }]}>
                {dropAddress || T("selectDropLocation")}
              </Text>
              <Ionicons name="chevron-down" size={14} color={C.textMuted} />
            </Pressable>
            <Text style={ss.label}>{T("orTypeManually")}</Text>
            <TextInput
              value={dropAddress}
              onChangeText={v => { setDropAddress(v); setDropLat(undefined); setDropLng(undefined); }}
              placeholder="e.g. Commercial Area, Mirpur"
              placeholderTextColor={C.textMuted}
              style={ss.input}
              multiline
            />
          </View>
        )}

        {step === 2 && (
          <View>
            <View style={ss.card}>
              <Text style={ss.cardTitle}>📦 {T("parcelDetails")}</Text>
              <Text style={ss.label}>{T("parcelType")} *</Text>
              <View style={ss.typeGrid}>
                {PARCEL_TYPES.map(pt => (
                  <Pressable key={pt.id} onPress={() => setParcelType(pt.id)} style={[ss.typeCard, parcelType === pt.id && ss.typeCardActive]}>
                    <Text style={{ fontSize: 24 }}>{pt.emoji}</Text>
                    <Text style={[ss.typeLabel, parcelType === pt.id && { color: "#D97706" }]}>{pt.label}</Text>
                    <Text style={ss.typeDesc}>{pt.desc}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View style={ss.card}>
              <Text style={ss.label}>{T("weightOptional")} (kg)</Text>
              <TextInput
                value={weight}
                onChangeText={setWeight}
                placeholder="e.g. 1.5"
                placeholderTextColor={C.textMuted}
                style={ss.input}
                keyboardType="decimal-pad"
              />
              <Text style={ss.label}>Dimensions (cm) — Optional</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[ss.label, { fontSize: 11, marginBottom: 4 }]}>Length</Text>
                  <TextInput value={length} onChangeText={setLength} placeholder="L" placeholderTextColor={C.textMuted} style={[ss.input, { textAlign: "center" }]} keyboardType="decimal-pad" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[ss.label, { fontSize: 11, marginBottom: 4 }]}>Width</Text>
                  <TextInput value={width} onChangeText={setWidth} placeholder="W" placeholderTextColor={C.textMuted} style={[ss.input, { textAlign: "center" }]} keyboardType="decimal-pad" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[ss.label, { fontSize: 11, marginBottom: 4 }]}>Height</Text>
                  <TextInput value={height} onChangeText={setHeight} placeholder="H" placeholderTextColor={C.textMuted} style={[ss.input, { textAlign: "center" }]} keyboardType="decimal-pad" />
                </View>
              </View>
              {volumetricWeight > 0 && (
                <View style={{ backgroundColor: "#FEF3C7", borderRadius: 10, padding: 10, marginTop: 4, gap: 4 }}>
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: "#92400E" }}>Weight Breakdown</Text>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "#92400E" }}>Actual: {actualWeight.toFixed(1)} kg  •  Volumetric: {volumetricWeight.toFixed(2)} kg</Text>
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: "#D97706" }}>Chargeable: {chargeableWeight.toFixed(2)} kg</Text>
                </View>
              )}
              <Text style={ss.label}>{T("descriptionOptional")}</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder={T("whatsInParcel")}
                placeholderTextColor={C.textMuted}
                style={[ss.input, { minHeight: 60 }]}
                multiline
              />
            </View>
            {parcelType && (
              <View style={ss.fareCard}>
                <View>
                  <Text style={ss.fareLbl2}>{T("estimatedFareLabel")}</Text>
                  <Text style={ss.fareNote}>{T("eta")}</Text>
                </View>
                {fareLoading
                  ? <ActivityIndicator color="#D97706" size="small" />
                  : <Text style={ss.fareAmt}>Rs. {estimatedFare}</Text>
                }
              </View>
            )}
          </View>
        )}

        {step === 3 && (
          <View>
            <View style={ss.card}>
              <Text style={ss.cardTitle}>💳 {T("paymentMethods")}</Text>
              {payMethods.map(pm => {
                const active = payMethod === pm.id;
                const isWallet = pm.id === "wallet";
                const iconName: any = pm.id === "cash" ? "cash-outline"
                  : pm.id === "wallet" ? "wallet-outline"
                  : pm.id === "jazzcash" ? "phone-portrait-outline"
                  : pm.id === "easypaisa" ? "phone-portrait-outline"
                  : "card-outline";
                const iconBg = pm.id === "cash" ? "#D1FAE5"
                  : pm.id === "wallet" ? "#EFF6FF"
                  : pm.id === "jazzcash" ? "#FFE4E6"
                  : "#E0F2FE";
                const iconColor = pm.id === "cash" ? "#059669"
                  : pm.id === "wallet" ? C.primary
                  : pm.id === "jazzcash" ? "#BE123C"
                  : "#0284C7";
                const subLabel = isWallet
                  ? `${T("availableBalance")}: Rs. ${(user?.walletBalance ?? 0).toLocaleString()}`
                  : (pm as any).description || pm.label;
                return (
                  <Pressable key={pm.id} onPress={() => setPayMethod(pm.id)} style={[ss.payOpt, active && ss.payOptActive]}>
                    <View style={[ss.payIcon, { backgroundColor: iconBg }]}>
                      <Ionicons name={iconName} size={22} color={iconColor} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[ss.payLabel, active && { color: "#D97706" }]}>
                        {isWallet ? `${appName} ${T("wallet")}` : pm.label}
                      </Text>
                      <Text style={ss.paySub}>{subLabel}</Text>
                    </View>
                    {active && <Ionicons name="checkmark-circle" size={22} color="#D97706" />}
                  </Pressable>
                );
              })}
            </View>

            <View style={ss.summaryCard}>
              <Text style={ss.summaryTitle}>{T("bookingSummary")}</Text>
              <View style={ss.summaryRow}>
                <View style={[ss.summaryDot, { backgroundColor: "#10B981" }]} />
                <Text style={ss.summaryTxt}><Text style={{ fontFamily: "Inter_600SemiBold" }}>{T("pickup")}:</Text> {pickupAddress}</Text>
              </View>
              <View style={ss.summaryRow}>
                <View style={[ss.summaryDot, { backgroundColor: "#EF4444" }]} />
                <Text style={ss.summaryTxt}><Text style={{ fontFamily: "Inter_600SemiBold" }}>{T("dropOff")}:</Text> {dropAddress}</Text>
              </View>
              <View style={ss.summaryRow}>
                <Ionicons name="person-outline" size={14} color={C.textMuted} />
                <Text style={ss.summaryTxt}>{receiverName} • {receiverPhone}</Text>
              </View>
              <View style={ss.summaryRow}>
                <Ionicons name="cube-outline" size={14} color={C.textMuted} />
                <Text style={ss.summaryTxt}>{selectedType?.emoji} {selectedType?.label}{chargeableWeight > 0 ? ` • ${chargeableWeight.toFixed(2)} kg${volumetricWeight > actualWeight ? " (vol.)" : ""}` : weight ? ` • ${weight} kg` : ""}</Text>
              </View>
              <View style={[{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border }]}>
                {estimatedFare > 0 && confirmedFare > 0 && confirmedFare !== estimatedFare && (
                  <View style={ss.summaryRow}>
                    <Text style={[ss.summaryTotal, { color: C.textMuted, fontSize: 12 }]}>Estimated Fare</Text>
                    <Text style={[ss.summaryFare, { color: C.textMuted, fontSize: 12, textDecorationLine: "line-through" }]}>Rs. {estimatedFare.toLocaleString()}</Text>
                  </View>
                )}
                <View style={ss.summaryRow}>
                  <Text style={ss.summaryTotal}>{confirmedFare > 0 ? "Confirmed Fare" : T("totalFare")}</Text>
                  <Text style={ss.summaryFare}>Rs. {(confirmedFare || estimatedFare).toLocaleString()}</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      <View style={[ss.navBar, { paddingBottom: insets.bottom + 12 }]}>
        {step > 0 && (
          <Pressable style={ss.prevBtn} onPress={prev}>
            <Ionicons name="arrow-back" size={18} color={C.text} />
            <Text style={ss.prevBtnTxt}>{T("back")}</Text>
          </Pressable>
        )}
        {step < 3 ? (
          <Pressable style={[ss.nextBtn, step === 0 && { marginLeft: "auto" }]} onPress={next}>
            <Text style={ss.nextBtnTxt}>{T("confirmLabel")}</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </Pressable>
        ) : (
          <Pressable style={[ss.nextBtn, loading && { opacity: 0.7 }]} onPress={bookParcel} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : (
              <>
                <Text style={ss.nextBtnTxt}>{T("parcel")} • Rs. {estimatedFare}</Text>
                <Ionicons name="checkmark-circle" size={18} color="#fff" />
              </>
            )}
          </Pressable>
        )}
      </View>

      <Modal visible={!!showLocPicker} animationType="slide" presentationStyle="pageSheet"
        onRequestClose={() => { setShowLocPicker(null); setLocSearch(""); }}>
        <View style={ss.locModal}>
          <View style={ss.locModalHeader}>
            <Text style={ss.locModalTitle}>
              {showLocPicker === "pickup" ? "📍 Pickup" : "🏁 Drop"} Location
            </Text>
            <Pressable onPress={() => { setShowLocPicker(null); setLocSearch(""); }} style={ss.locCloseBtn}>
              <Ionicons name="close" size={20} color={C.text} />
            </Pressable>
          </View>

          <View style={ss.locSearchRow}>
            <Ionicons name="search-outline" size={16} color={C.textMuted} />
            <TextInput
              value={locSearch}
              onChangeText={setLocSearch}
              placeholder="Search location or area..."
              placeholderTextColor={C.textMuted}
              autoFocus
              style={ss.locSearchInput}
            />
            {locLoading && <ActivityIndicator size="small" color={C.primary} />}
            {locSearch.length > 0 && !locLoading && (
              <Pressable onPress={() => setLocSearch("")}>
                <Ionicons name="close-circle" size={16} color={C.textMuted} />
              </Pressable>
            )}
          </View>

          <ScrollView keyboardShouldPersistTaps="always">
            {predictions.map(pred => (
              <Pressable
                key={pred.placeId}
                style={ss.locOption}
                onPress={async () => {
                  try {
                    const loc = await resolveLocation(pred);
                    const address = loc.address || pred.description;
                    if (showLocPicker === "pickup") {
                      setPickupAddress(address);
                      setPickupLat(loc.lat);
                      setPickupLng(loc.lng);
                    } else {
                      setDropAddress(address);
                      setDropLat(loc.lat);
                      setDropLng(loc.lng);
                    }
                    setShowLocPicker(null);
                    setLocSearch("");
                  } catch {
                    showToast("Could not resolve location. Please type the address manually.", "error");
                  }
                }}
              >
                <View style={ss.locIconWrap}>
                  <Ionicons name="location-outline" size={18} color={C.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={ss.locOptionTxt}>{pred.mainText}</Text>
                  {pred.secondaryText ? (
                    <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }} numberOfLines={1}>{pred.secondaryText}</Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
              </Pressable>
            ))}
            {predictions.length === 0 && !locLoading && locSearch.length > 2 && (
              <View style={{ padding: 24, alignItems: "center" }}>
                <Text style={{ color: C.textMuted, fontSize: 13 }}>No location found</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

export default withServiceGuard("parcel", ParcelScreenInner);

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },

  header: { paddingHorizontal: 16, paddingBottom: 16 },
  hdrRow: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  backBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  hdrTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: "#fff" },
  hdrSub: { fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 2 },

  steps: { flexDirection: "row", alignItems: "center", paddingHorizontal: 4 },
  stepItem: { alignItems: "center", gap: 4 },
  stepDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.3)", alignItems: "center", justifyContent: "center" },
  stepDotActive: { backgroundColor: "#D97706" },
  stepNum: { fontFamily: "Inter_700Bold", fontSize: 11, color: "rgba(255,255,255,0.7)" },
  stepLbl: { fontFamily: "Inter_500Medium", fontSize: 9, color: "rgba(255,255,255,0.8)" },
  stepLine: { flex: 1, height: 2, backgroundColor: "rgba(255,255,255,0.3)", marginBottom: 16 },
  stepLineActive: { backgroundColor: "#D97706" },

  scroll: { padding: 16, paddingBottom: 24 },
  card: { backgroundColor: "#fff", borderRadius: 18, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: C.border, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  cardTitle: { fontFamily: "Inter_700Bold", fontSize: 17, color: C.text, marginBottom: 14 },

  label: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.text, marginBottom: 6, marginTop: 12 },
  input: { borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontFamily: "Inter_400Regular", fontSize: 13, color: C.text, backgroundColor: C.surfaceSecondary },
  locInput: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: C.surfaceSecondary },
  locInputTxt: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13, color: C.text },

  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  typeCard: { width: "46%", padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: C.border, alignItems: "center", gap: 6, backgroundColor: C.surfaceSecondary },
  typeCardActive: { borderColor: "#D97706", backgroundColor: "#FFFBEB" },
  typeLabel: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: C.text },
  typeDesc: { fontFamily: "Inter_400Regular", fontSize: 10, color: C.textMuted, textAlign: "center" },
  typeFare: { fontFamily: "Inter_700Bold", fontSize: 12, color: C.primary },
  weightNote: { fontFamily: "Inter_400Regular", fontSize: 11, color: "#D97706", marginTop: 6 },

  fareCard: { backgroundColor: "#FFFBEB", borderRadius: 16, padding: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: "#FDE68A", marginHorizontal: 0, marginBottom: 12 },
  fareLbl2: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#92400E" },
  fareNote: { fontFamily: "Inter_400Regular", fontSize: 11, color: "#B45309", marginTop: 2 },
  fareAmt: { fontFamily: "Inter_700Bold", fontSize: 24, color: "#D97706" },

  payOpt: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, borderWidth: 1.5, borderColor: C.border, marginBottom: 10 },
  payOptActive: { borderColor: "#D97706", backgroundColor: "#FFFBEB" },
  payIcon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  payLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.text },
  paySub: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginTop: 2 },

  summaryCard: { backgroundColor: "#fff", borderRadius: 18, padding: 18, borderWidth: 1, borderColor: C.border, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  summaryTitle: { fontFamily: "Inter_700Bold", fontSize: 16, color: C.text, marginBottom: 14 },
  summaryRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 10 },
  summaryDot: { width: 10, height: 10, borderRadius: 5, marginTop: 3 },
  summaryTxt: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  summaryTotal: { flex: 1, fontFamily: "Inter_700Bold", fontSize: 16, color: C.text },
  summaryFare: { fontFamily: "Inter_700Bold", fontSize: 20, color: "#D97706" },

  navBar: { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", paddingHorizontal: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.border, shadowColor: "#000", shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 5 },
  prevBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 14, borderRadius: 14, backgroundColor: C.surfaceSecondary },
  prevBtnTxt: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.text },
  nextBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15, borderRadius: 16, backgroundColor: "#D97706", shadowColor: "#D97706", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3 },
  nextBtnTxt: { fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" },

  locModal: { flex: 1, backgroundColor: "#fff" },
  locModalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  locModalTitle: { fontFamily: "Inter_700Bold", fontSize: 17, color: C.text },
  locCloseBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  locSearchRow: { flexDirection: "row", alignItems: "center", gap: 10, margin: 12, backgroundColor: C.surfaceSecondary, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, borderWidth: 1, borderColor: C.borderLight },
  locSearchInput: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 14, color: C.text, paddingVertical: 0 },
  locOption: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  locOptionTxt: { fontFamily: "Inter_500Medium", fontSize: 14, color: C.text },
  locIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center" },

  confirmCard: { backgroundColor: "#fff", borderRadius: 24, padding: 28, alignItems: "center", width: "100%", borderWidth: 1, borderColor: C.border, gap: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 5 },
  confirmIconCircle: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  confirmTitle: { fontFamily: "Inter_700Bold", fontSize: 24, color: C.text },
  confirmSub: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted, textAlign: "center", lineHeight: 21 },
  confirmRow: { flexDirection: "row", alignItems: "center", gap: 8, width: "100%" },
  confirmInfoBox: { flex: 1, backgroundColor: C.surfaceSecondary, borderRadius: 14, padding: 12 },
  confirmInfoLbl: { fontFamily: "Inter_500Medium", fontSize: 10, color: C.textMuted, marginBottom: 4 },
  confirmInfoVal: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: C.text },
  fareBox: { width: "100%", backgroundColor: "#FFFBEB", borderRadius: 14, padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fareLbl: { fontFamily: "Inter_500Medium", fontSize: 13, color: "#92400E" },
  fareVal: { fontFamily: "Inter_700Bold", fontSize: 22, color: "#D97706" },
  doneBtn: { backgroundColor: "#D97706", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 24, alignItems: "center", justifyContent: "center", flexDirection: "row" },
  doneBtnTxt: { fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" },
});
