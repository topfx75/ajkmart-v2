import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface MapsConfigPublic {
  provider: string;
  token: string;
  secondaryProvider?: string;
  secondaryToken?: string;
  appOverrides?: { rider?: { provider: string; token: string }; [k: string]: any };
}

function MiniMapFitter({
  pickupLat,
  pickupLng,
  dropLat,
  dropLng,
  hasPick,
  hasDrop,
}: {
  pickupLat: number;
  pickupLng: number;
  dropLat: number;
  dropLng: number;
  hasPick: boolean;
  hasDrop: boolean;
}) {
  const map = useMap();
  useEffect(() => {
    if (hasPick && hasDrop) {
      map.fitBounds(
        [
          [pickupLat, pickupLng],
          [dropLat, dropLng],
        ],
        { padding: [20, 20], maxZoom: 15 },
      );
    } else if (hasPick) {
      map.setView([pickupLat, pickupLng], 14);
    } else if (hasDrop) {
      map.setView([dropLat, dropLng], 14);
    }
  }, [pickupLat, pickupLng, dropLat, dropLng, hasPick, hasDrop]);
  return null;
}

function useMiniMapTileConfig(): { tileUrl: string; attribution: string } {
  const { data } = useQuery<MapsConfigPublic>({
    queryKey: ["maps-config-public"],
    queryFn: async (): Promise<MapsConfigPublic> => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/maps/config?app=rider`);
      const json = (await res.json()) as { data?: MapsConfigPublic } & MapsConfigPublic;
      return (json.data ?? json) as MapsConfigPublic;
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const riderOverride = data?.appOverrides?.rider;
  const provider = riderOverride?.provider ?? data?.provider ?? "osm";
  const token = riderOverride?.token ?? data?.token ?? "";

  if (provider === "mapbox" && token)
    return {
      tileUrl: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${token}`,
      attribution: "© Mapbox © OSM",
    };
  if (provider === "google" && token)
    return {
      tileUrl: `https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&key=${token}`,
      attribution: "© Google Maps",
    };
  return {
    tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OSM",
  };
}

export function MiniMap({
  pickupLat,
  pickupLng,
  dropLat,
  dropLng,
}: {
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropLat?: number | null;
  dropLng?: number | null;
}) {
  const hasPick = pickupLat != null && pickupLng != null;
  const hasDrop = dropLat != null && dropLng != null;
  const { tileUrl, attribution } = useMiniMapTileConfig();
  if (!hasPick && !hasDrop) return null;

  const centerLat =
    hasPick && hasDrop
      ? (pickupLat! + dropLat!) / 2
      : hasPick
        ? pickupLat!
        : dropLat!;
  const centerLng =
    hasPick && hasDrop
      ? (pickupLng! + dropLng!) / 2
      : hasPick
        ? pickupLng!
        : dropLng!;

  const pickupIcon = L.divIcon({
    html: `<div style="width:14px;height:14px;background:#22c55e;border:2.5px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>`,
    className: "",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
  const dropIcon = L.divIcon({
    html: `<div style="width:14px;height:14px;background:#ef4444;border:2.5px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>`,
    className: "",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });

  return (
    <div className="w-full h-28 rounded-2xl overflow-hidden bg-gray-100 relative mt-3 shadow-inner border border-gray-100">
      <MapContainer
        center={[centerLat!, centerLng!]}
        zoom={13}
        style={{ width: "100%", height: "100%" }}
        zoomControl={false}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        keyboard={false}
        attributionControl={false}
      >
        <TileLayer url={tileUrl} />
        {hasPick && <Marker position={[pickupLat!, pickupLng!]} icon={pickupIcon} />}
        {hasDrop && <Marker position={[dropLat!, dropLng!]} icon={dropIcon} />}
        <MiniMapFitter
          pickupLat={pickupLat ?? 0}
          pickupLng={pickupLng ?? 0}
          dropLat={dropLat ?? 0}
          dropLng={dropLng ?? 0}
          hasPick={hasPick}
          hasDrop={hasDrop}
        />
      </MapContainer>
      <div className="absolute bottom-1.5 right-1.5 bg-black/40 backdrop-blur-sm text-white text-[9px] font-bold px-1.5 py-0.5 rounded pointer-events-none z-[1000]">
        {attribution}
      </div>
      {hasPick && (
        <div className="absolute top-1.5 left-1.5 bg-green-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full pointer-events-none z-[1000]">
          PICKUP
        </div>
      )}
      {hasDrop && (
        <div className="absolute bottom-1.5 left-1.5 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full pointer-events-none z-[1000]">
          DROP
        </div>
      )}
    </div>
  );
}
