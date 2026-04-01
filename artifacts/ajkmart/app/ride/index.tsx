import React, { useState, useEffect } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { useLanguage } from "@/context/LanguageContext";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { withServiceGuard } from "@/components/ServiceGuard";
import { RideBookingForm } from "@/components/ride/RideBookingForm";
import { RideTracker } from "@/components/ride/RideTracker";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, Platform } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { API_BASE } from "@/utils/api";

const C = Colors.light;

function RideScreenInner() {
  const insets = useSafeAreaInsets();
  const topPad = Math.max(insets.top, 12);
  const { user, token } = useAuth();
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const rideCfg = config.rides;
  const ridesEnabled = config.features.rides;
  const inMaintenance = config.appStatus === "maintenance";
  const { rideId: urlRideId } = useLocalSearchParams<{ rideId?: string }>();

  const [booked, setBooked] = useState<any>(null);
  const [rideLoadError, setRideLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!urlRideId || !token) return;
    setRideLoadError(false);
    fetch(`${API_BASE}/rides/${urlRideId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => {
        if (!r.ok) throw new Error("fetch failed");
        return r.json();
      })
      .then(data => {
        setBooked({ id: urlRideId, type: data.type || "bike" });
      })
      .catch(() => {
        setRideLoadError(true);
      });
  }, [urlRideId, token, retryNonce]);

  if (inMaintenance) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: C.background,
          justifyContent: "center",
          alignItems: "center",
          padding: 32,
        }}
      >
        <View
          style={{
            backgroundColor: "#fff",
            borderRadius: 24,
            padding: 32,
            alignItems: "center",
            width: "100%",
            borderWidth: 1,
            borderColor: "#FEF3C7",
          }}
        >
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: "#FEF3C7",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <Ionicons name="construct-outline" size={32} color="#D97706" />
          </View>
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 20,
              color: "#D97706",
              marginBottom: 8,
              textAlign: "center",
            }}
          >
            {T("underMaintenance")}
          </Text>
          <Text
            style={{
              fontFamily: "Inter_400Regular",
              fontSize: 14,
              color: C.textMuted,
              textAlign: "center",
              lineHeight: 20,
            }}
          >
            {config.content.maintenanceMsg}
          </Text>
        </View>
      </View>
    );
  }

  if (!ridesEnabled) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: C.background,
          justifyContent: "center",
          alignItems: "center",
          padding: 32,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={{ position: "absolute", top: topPad + 12, left: 16 }}
        >
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </Pressable>
        <View
          style={{
            backgroundColor: "#fff",
            borderRadius: 24,
            padding: 32,
            alignItems: "center",
            width: "100%",
            borderWidth: 1,
            borderColor: "#FEE2E2",
          }}
        >
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: "#FEE2E2",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <Ionicons
              name="close-circle-outline"
              size={32}
              color="#EF4444"
            />
          </View>
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 20,
              color: "#EF4444",
              marginBottom: 8,
              textAlign: "center",
            }}
          >
            {T("serviceUnavailable")}
          </Text>
          <Text
            style={{
              fontFamily: "Inter_400Regular",
              fontSize: 14,
              color: C.textMuted,
              textAlign: "center",
              lineHeight: 20,
              marginBottom: 20,
            }}
          >
            {T("rideUnavailableMsg")}
          </Text>
          <Pressable
            style={{
              width: "100%",
              alignItems: "center",
              backgroundColor: "#FEF2F2",
              borderRadius: 14,
              paddingVertical: 14,
            }}
            onPress={() => router.back()}
          >
            <Text
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 15,
                color: "#EF4444",
              }}
            >
              {T("backToHome")}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (rideLoadError) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: C.background,
          justifyContent: "center",
          alignItems: "center",
          padding: 32,
        }}
      >
        <View
          style={{
            backgroundColor: "#fff",
            borderRadius: 24,
            padding: 32,
            alignItems: "center",
            width: "100%",
            borderWidth: 1,
            borderColor: "#FEE2E2",
          }}
        >
          <Ionicons name="alert-circle-outline" size={48} color="#EF4444" style={{ marginBottom: 16 }} />
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 18,
              color: "#EF4444",
              marginBottom: 8,
              textAlign: "center",
            }}
          >
            {T("rideLoadErrorTitle")}
          </Text>
          <Text
            style={{
              fontFamily: "Inter_400Regular",
              fontSize: 14,
              color: C.textMuted,
              textAlign: "center",
              lineHeight: 20,
              marginBottom: 20,
            }}
          >
            {T("rideLoadErrorMsg")}
          </Text>
          <Pressable
            style={{
              width: "100%",
              alignItems: "center",
              backgroundColor: C.primary,
              borderRadius: 14,
              paddingVertical: 14,
              marginBottom: 10,
            }}
            onPress={() => { setRetryNonce(n => n + 1); }}
          >
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff" }}>
              {T("tryAgain")}
            </Text>
          </Pressable>
          <Pressable
            style={{
              width: "100%",
              alignItems: "center",
              backgroundColor: "#FEF2F2",
              borderRadius: 14,
              paddingVertical: 14,
            }}
            onPress={() => router.back()}
          >
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: "#EF4444" }}>
              {T("backToHome")}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (booked) {
    return (
      <RideTracker
        rideId={booked.id}
        initialType={booked.type ?? "bike"}
        userId={user?.id ?? ""}
        token={token}
        cancellationFee={rideCfg.cancellationFee ?? 30}
        onReset={() => setBooked(null)}
      />
    );
  }

  return <RideBookingForm onBooked={(ride) => setBooked(ride)} />;
}

export default withServiceGuard("rides", RideScreenInner);
