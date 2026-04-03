import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import Colors from "@/constants/colors";
import { Font } from "@/constants/typography";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = Colors.light;

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

const PICKER_ORIGIN = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

export function MapPickerModal({
  visible,
  label = "Location",
  initialLat,
  initialLng,
  onConfirm,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const webViewRef = useRef<WebView>(null);

  const lat = initialLat ?? 33.7294;
  const lng = initialLng ?? 73.3872;
  const src = `${PICKER_ORIGIN}/api/maps/picker?lat=${lat}&lng=${lng}&zoom=14&label=${encodeURIComponent(label)}`;

  const handleMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      try {
        const payload = JSON.parse(event.nativeEvent.data) as {
          type: string;
          lat: number;
          lng: number;
          address: string;
        };
        if (payload.type !== "MAP_PICKER_CONFIRM") return;
        if (typeof payload.lat !== "number" || typeof payload.lng !== "number") return;
        onConfirm({
          lat: payload.lat,
          lng: payload.lng,
          address: payload.address ?? `${payload.lat.toFixed(5)}, ${payload.lng.toFixed(5)}`,
        });
      } catch {
        /* ignore malformed messages */
      }
    },
    [onConfirm],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={C.text} />
          </Pressable>
          <Text style={styles.title}>Select {label}</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.mapWrap}>
          {loading && (
            <View style={styles.loader}>
              <ActivityIndicator size="large" color={C.primary} />
              <Text style={styles.loaderTxt}>Loading map...</Text>
            </View>
          )}
          <WebView
            ref={webViewRef}
            source={{ uri: src }}
            style={[styles.webview, loading && styles.hidden]}
            onLoad={() => setLoading(false)}
            onError={() => setLoading(false)}
            onMessage={handleMessage}
            javaScriptEnabled
            domStorageEnabled
            geolocationEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            mixedContentMode="compatibility"
          />
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
    position: "relative",
  },
  webview: {
    flex: 1,
  },
  hidden: {
    opacity: 0,
    position: "absolute",
    width: "100%",
    height: "100%",
  },
  loader: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    zIndex: 10,
    backgroundColor: "#fff",
  },
  loaderTxt: {
    fontFamily: Font.medium,
    fontSize: 14,
    color: C.textMuted,
  },
});
