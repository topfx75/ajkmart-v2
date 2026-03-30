import React, { useState, useEffect } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { withServiceGuard } from "@/components/ServiceGuard";
import { RideBookingForm } from "@/components/ride/RideBookingForm";
import { RideTracker } from "@/components/ride/RideTracker";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, Platform } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = Colors.light;

function RideScreenInner() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const { user, token } = useAuth();
  const { config } = usePlatformConfig();
  const rideCfg = config.rides;
  const ridesEnabled = config.features.rides;
  const inMaintenance = config.appStatus === "maintenance";
  const { rideId: urlRideId } = useLocalSearchParams<{ rideId?: string }>();

  const [booked, setBooked] = useState<any>(null);

  useEffect(() => {
    if (!urlRideId || !token) return;
    const apiBase = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
    fetch(`${apiBase}/rides/${urlRideId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => {
        if (!r.ok) throw new Error("fetch failed");
        return r.json();
      })
      .then(data => {
        const ride = data.ride || data;
        setBooked({ id: urlRideId, type: ride.type || "bike" });
      })
      .catch(() => {
        setBooked({ id: urlRideId, type: "bike" });
      });
  }, [urlRideId, token]);

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
            Under Maintenance
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
            Service Unavailable
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
            Ride service is currently unavailable. Please try again later.
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
              Back to Home
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
