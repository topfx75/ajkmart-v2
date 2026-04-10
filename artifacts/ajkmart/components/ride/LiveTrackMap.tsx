import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? "";

export type LiveTrackMapProps = {
  orderId: string;
  type?: "order" | "ride" | "parcel" | "pharmacy";
  token: string;
  destLat?: number | null;
  destLng?: number | null;
  destLabel?: string;
  height: number;
  lang?: string;
  riderLat?: number | null;
  riderLng?: number | null;
};

export function LiveTrackMap({
  orderId,
  type = "order",
  token,
  destLat,
  destLng,
  destLabel = "Destination",
  height,
  lang = "en",
  riderLat,
  riderLng,
}: LiveTrackMapProps) {
  const webViewRef = useRef<WebView>(null);
  const prevRiderRef = useRef<{ lat: number; lng: number } | null>(null);

  const params = new URLSearchParams({
    orderId,
    type,
    token,
    lang,
    ...(destLat != null ? { destLat: String(destLat) } : {}),
    ...(destLng != null ? { destLng: String(destLng) } : {}),
    destLabel,
  });
  const src = `https://${DOMAIN}/api/maps/live-track?${params.toString()}`;

  useEffect(() => {
    if (riderLat == null || riderLng == null) return;
    const prev = prevRiderRef.current;
    if (prev && prev.lat === riderLat && prev.lng === riderLng) return;
    prevRiderRef.current = { lat: riderLat, lng: riderLng };
    const msg = JSON.stringify({ type: "RIDER_UPDATE", lat: riderLat, lng: riderLng });
    webViewRef.current?.postMessage(msg);
  }, [riderLat, riderLng]);

  return (
    <View style={[styles.root, { height }]}>
      <WebView
        ref={webViewRef}
        source={{ uri: src }}
        style={styles.webView}
        javaScriptEnabled
        geolocationEnabled={false}
        allowsInlineMediaPlayback
        scrollEnabled={false}
        onMessage={(_e: WebViewMessageEvent) => {}}
        originWhitelist={["*"]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: "100%", overflow: "hidden", borderRadius: 0, backgroundColor: "#0f172a" },
  webView: { flex: 1, backgroundColor: "transparent" },
});
