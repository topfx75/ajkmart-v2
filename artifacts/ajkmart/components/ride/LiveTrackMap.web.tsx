import React, { useEffect, useRef } from "react";
import { View, StyleSheet } from "react-native";

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? "";
const ORIGIN = `https://${DOMAIN}`;

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
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
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
  const src = `${ORIGIN}/api/maps/live-track?${params.toString()}`;

  useEffect(() => {
    if (riderLat == null || riderLng == null) return;
    const prev = prevRiderRef.current;
    if (prev && prev.lat === riderLat && prev.lng === riderLng) return;
    prevRiderRef.current = { lat: riderLat, lng: riderLng };
    try {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "RIDER_UPDATE", lat: riderLat, lng: riderLng },
        ORIGIN,
      );
    } catch {}
  }, [riderLat, riderLng]);

  return (
    <View style={[styles.root, { height }]}>
      <iframe
        ref={iframeRef}
        src={src}
        style={{ width: "100%", height: "100%", border: "none", display: "block" }}
        sandbox="allow-scripts allow-same-origin allow-forms"
        title="Live order tracking"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: "100%", overflow: "hidden", backgroundColor: "#0f172a" },
});
