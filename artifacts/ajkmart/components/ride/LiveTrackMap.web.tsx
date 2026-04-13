import React, { useEffect, useRef, useState } from "react";
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
  const pendingRef = useRef<{ lat: number; lng: number } | null>(null);
  const [iframeReady, setIframeReady] = useState(false);

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

  const sendRiderUpdate = (lat: number, lng: number) => {
    if (iframeReady && iframeRef.current?.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage(
          { type: "RIDER_UPDATE", lat, lng },
          ORIGIN,
        );
      } catch {}
      pendingRef.current = null;
    } else {
      pendingRef.current = { lat, lng };
    }
  };

  useEffect(() => {
    if (riderLat == null || riderLng == null) return;
    const prev = prevRiderRef.current;
    if (prev && prev.lat === riderLat && prev.lng === riderLng) return;
    prevRiderRef.current = { lat: riderLat, lng: riderLng };
    sendRiderUpdate(riderLat, riderLng);
  }, [riderLat, riderLng, iframeReady]);

  const handleLoad = () => {
    setIframeReady(true);
    const pending = pendingRef.current;
    if (pending && iframeRef.current?.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage(
          { type: "RIDER_UPDATE", lat: pending.lat, lng: pending.lng },
          ORIGIN,
        );
      } catch {}
      pendingRef.current = null;
    }
  };

  return (
    <View style={[styles.root, { height }]}>
      <iframe
        ref={iframeRef}
        src={src}
        style={{ width: "100%", height: "100%", border: "none", display: "block" }}
        sandbox="allow-scripts allow-same-origin allow-forms"
        title="Live order tracking"
        onLoad={handleLoad}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: "100%", overflow: "hidden", backgroundColor: "#0f172a" },
});
