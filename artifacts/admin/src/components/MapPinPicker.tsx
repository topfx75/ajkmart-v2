import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* Leaflet's bundled icons rely on webpack url-loader, which Vite doesn't wire
   by default. Point directly at the CDN copies instead. */
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface Props {
  lat: number | null;
  lng: number | null;
  radiusKm: number;
  onChange: (lat: number, lng: number) => void;
}

const AJK_CENTER: L.LatLngTuple = [33.8573, 73.7643];
const DEFAULT_ZOOM = 10;
const PLACED_ZOOM = 13;
const CIRCLE_STYLE: L.CircleMarkerOptions = {
  color: "#2563EB",
  fillColor: "#2563EB",
  fillOpacity: 0.1,
  weight: 2,
};

export function MapPinPicker({ lat, lng, radiusKm, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);

  /* Keep a stable ref to onChange so map event handlers don't stale-close */
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /* Keep a stable ref to radiusKm for use inside map event handlers */
  const radiusKmRef = useRef(radiusKm);
  radiusKmRef.current = radiusKm;

  function placeMarker(map: L.Map, pos: L.LatLng) {
    if (markerRef.current) {
      markerRef.current.setLatLng(pos);
    } else {
      const marker = L.marker(pos, { draggable: true }).addTo(map);
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        syncCircle(p, radiusKmRef.current);
        onChangeRef.current(p.lat, p.lng);
      });
      markerRef.current = marker;
    }
  }

  function syncCircle(center: L.LatLng, km: number) {
    if (!mapRef.current) return;
    const radiusMeters = Math.max(km, 0.1) * 1000;
    if (circleRef.current) {
      circleRef.current.setLatLng(center);
      circleRef.current.setRadius(radiusMeters);
    } else {
      circleRef.current = L.circle(center, { ...CIRCLE_STYLE, radius: radiusMeters })
        .addTo(mapRef.current);
    }
  }

  /* Init map once on mount */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const hasCoords = lat != null && lng != null;
    const center: L.LatLngTuple = hasCoords ? [lat as number, lng as number] : AJK_CENTER;
    const zoom = hasCoords ? PLACED_ZOOM : DEFAULT_ZOOM;

    const map = L.map(containerRef.current, { center, zoom });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;

    if (hasCoords) {
      const pos = L.latLng(lat as number, lng as number);
      placeMarker(map, pos);
      syncCircle(pos, radiusKmRef.current);
    }

    map.on("click", (e: L.LeafletMouseEvent) => {
      placeMarker(map, e.latlng);
      syncCircle(e.latlng, radiusKmRef.current);
      onChangeRef.current(e.latlng.lat, e.latlng.lng);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Sync external coordinate changes (e.g. user types in the text inputs) */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || lat == null || lng == null) return;
    const pos = L.latLng(lat, lng);
    placeMarker(map, pos);
    syncCircle(pos, radiusKmRef.current);
    if (map.getZoom() < PLACED_ZOOM) map.setView(pos, PLACED_ZOOM);
    else map.panTo(pos);
  }, [lat, lng]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Sync radius changes */
  useEffect(() => {
    if (!circleRef.current || radiusKm <= 0) return;
    circleRef.current.setRadius(radiusKm * 1000);
  }, [radiusKm]);

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        Click the map or drag the pin to set GPS coordinates
      </p>
      <div
        ref={containerRef}
        className="w-full rounded-lg border border-border overflow-hidden"
        style={{ height: 240 }}
      />
    </div>
  );
}
