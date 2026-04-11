import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import type { Map as LeafletMap, LeafletMouseEvent } from "leaflet";
import L from "leaflet";

const LEAFLET_CSS_ID = "leaflet-css-cdn";
if (typeof document !== "undefined" && !document.getElementById(LEAFLET_CSS_ID)) {
  const link = document.createElement("link");
  link.id = LEAFLET_CSS_ID;
  link.rel = "stylesheet";
  link.href = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css";
  document.head.appendChild(link);
}

const defaultIcon = L.icon({
  iconUrl: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

type Props = {
  lat: number;
  lng: number;
  onDragEnd: (lat: number, lng: number) => void;
};

function DraggableMarker({
  position,
  onDragEnd,
}: {
  position: [number, number];
  onDragEnd: (lat: number, lng: number) => void;
}) {
  const markerRef = useRef<L.Marker | null>(null);
  const [pos, setPos] = useState<[number, number]>(position);

  useEffect(() => {
    setPos(position);
  }, [position[0], position[1]]);

  const eventHandlers = useMemo(
    () => ({
      dragend() {
        const marker = markerRef.current;
        if (marker) {
          const latlng = marker.getLatLng();
          setPos([latlng.lat, latlng.lng]);
          onDragEnd(latlng.lat, latlng.lng);
        }
      },
    }),
    [onDragEnd],
  );

  useMapEvents({
    click(e: LeafletMouseEvent) {
      setPos([e.latlng.lat, e.latlng.lng]);
      onDragEnd(e.latlng.lat, e.latlng.lng);
    },
  });

  return (
    <Marker
      draggable
      eventHandlers={eventHandlers}
      position={pos}
      ref={markerRef}
      icon={defaultIcon}
    />
  );
}

export function MapPickerLeaflet({ lat, lng, onDragEnd }: Props) {
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <MapContainer
      center={[lat, lng]}
      zoom={14}
      style={{ width: "100%", height: "100%" }}
      zoomControl
      attributionControl={false}
      ref={mapRef}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <DraggableMarker position={[lat, lng]} onDragEnd={onDragEnd} />
    </MapContainer>
  );
}
