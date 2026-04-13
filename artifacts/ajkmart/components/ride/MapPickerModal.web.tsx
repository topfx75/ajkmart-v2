import React, { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import {
  ActivityIndicator,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import Colors from "@/constants/colors";
import { Font } from "@/constants/typography";
const C = Colors.light;

const API = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/maps`;

export type MapPickerResult = {
  lat: number;
  lng: number;
  address: string;
};

type Props = {
  visible: boolean;
  label?: string;
  initialLat?: number;
  initialLng?: number;
  onConfirm: (result: MapPickerResult) => void;
  onClose: () => void;
};

const LeafletMapInner = lazy(() =>
  import("./MapPickerLeaflet.web").then((mod) => ({
    default: mod.MapPickerLeaflet,
  }))
);

export function MapPickerModal({ visible, label = "Location", initialLat, initialLng, onConfirm, onClose }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [address, setAddress] = useState("");
  const currentPos = useRef<{ lat: number; lng: number }>({
    lat: initialLat ?? 33.7294,
    lng: initialLng ?? 73.3872,
  });

  useEffect(() => {
    currentPos.current = {
      lat: initialLat ?? 33.7294,
      lng: initialLng ?? 73.3872,
    };
    setAddress("");
  }, [initialLat, initialLng, visible]);

  const handleDragEnd = useCallback(async (lat: number, lng: number) => {
    currentPos.current = { lat, lng };
    setAddress("");
    try {
      const r = await fetch(`${API}/reverse-geocode?lat=${lat}&lng=${lng}`);
      if (r.ok) {
        const d = await r.json();
        setAddress(d.address ?? d.formattedAddress ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      }
    } catch {}
  }, []);

  const handleConfirm = useCallback(async () => {
    setConfirming(true);
    const { lat, lng } = currentPos.current;
    let finalAddress = address;
    if (!finalAddress) {
      try {
        const r = await fetch(`${API}/reverse-geocode?lat=${lat}&lng=${lng}`);
        if (r.ok) {
          const d = await r.json();
          finalAddress = d.address ?? d.formattedAddress ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        }
      } catch {}
    }
    if (!finalAddress) finalAddress = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    onConfirm({ lat, lng, address: finalAddress });
    setConfirming(false);
  }, [address, onConfirm]);

  const lat = initialLat ?? 33.7294;
  const lng = initialLng ?? 73.3872;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: 0 }]}>
        <View style={styles.header}>
          <TouchableOpacity activeOpacity={0.7} onPress={onClose} hitSlop={12} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Select {label}</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.mapWrap}>
          {visible && (
            <Suspense
              fallback={
                <View style={styles.loader}>
                  <ActivityIndicator size="large" color={C.primary} />
                  <Text style={styles.loaderTxt}>Loading map...</Text>
                </View>
              }
            >
              <LeafletMapInner lat={lat} lng={lng} onDragEnd={handleDragEnd} />
            </Suspense>
          )}
        </View>

        {address ? (
          <View style={styles.addressBar}>
            <Ionicons name="location" size={16} color={C.primary} />
            <Text style={styles.addressText} numberOfLines={2}>{address}</Text>
          </View>
        ) : null}

        <View style={styles.bottomBar}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={handleConfirm}
            disabled={confirming}
            style={[styles.confirmBtn, confirming && { opacity: 0.6 }]}
          >
            {confirming ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.confirmText}>Confirm Location</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: "#fff",
    zIndex: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    textAlign: "center",
    fontFamily: Font.bold,
    fontSize: 17,
    color: C.text,
  },
  mapWrap: {
    flex: 1,
    backgroundColor: C.surfaceSecondary,
  },
  loader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loaderTxt: {
    fontFamily: Font.medium,
    fontSize: 14,
    color: C.textMuted,
  },
  addressBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#F8FAFC",
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  addressText: {
    flex: 1,
    fontFamily: Font.medium,
    fontSize: 13,
    color: C.text,
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 24,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  confirmBtn: {
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmText: {
    fontFamily: Font.bold,
    fontSize: 15,
    color: "#fff",
  },
});
