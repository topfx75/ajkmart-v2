import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLiveRiders, usePlatformSettings, useRiderRoute, useCustomerLocations } from "@/hooks/use-admin";
import { MapPin, RefreshCw, Users, Navigation, Route, Clock, Eye, EyeOff, AlertTriangle, MessageSquare, BarChart2, Activity, TrendingUp, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, Circle } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { PLATFORM_DEFAULTS } from "@/lib/platformConfig";
import { io, type Socket } from "socket.io-client";
import { fetcher } from "@/lib/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

/* Fallback used only until the first API response provides the server-configured value */
const DEFAULT_OFFLINE_AFTER_SEC = 5 * 60;

const fd = (isoStr: string) => {
  const secs = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
};

/* ── Status dot — correct colors: Green=online, Red=busy/on_trip, Grey=offline ── */
function StatusDot({ status }: { status: "online" | "offline" | "busy" }) {
  if (status === "online") return <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block animate-pulse" />;
  if (status === "busy")   return <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block animate-pulse" />;
  return <span className="w-2.5 h-2.5 rounded-full bg-gray-300 inline-block" />;
}

type Rider = {
  userId: string;
  name: string;
  phone: string | null;
  isOnline: boolean;
  vehicleType: string | null;
  city?: string | null;
  role?: string | null;
  lat: number;
  lng: number;
  updatedAt: string;
  ageSeconds: number;
  isFresh: boolean;
  action?: string | null;
  batteryLevel?: number | null;
  lastSeen?: string;
};

type CustomerLoc = {
  userId: string;
  name?: string;
  lat: number;
  lng: number;
  updatedAt: string;
};

type RoutePoint = {
  latitude: number;
  longitude: number;
  createdAt: string;
};

type SOSAlert = {
  userId: string;
  name: string;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  rideId?: string | null;
  sentAt: string;
};

/* ── Rider status logic ──
   isOnline (from DB) is the authoritative "online" flag set by the rider.
   GPS staleness only affects visual freshness, not the displayed status.
   Green = online/idle  |  Red = busy/on_trip  |  Grey = offline (rider tapped offline)
─────────────────────────────────────────────────────────────────────────────── */
function getRiderStatus(rider: Rider): "online" | "offline" | "busy" {
  if (!rider.isOnline) return "offline";
  if (rider.action === "on_trip" || rider.action === "delivering") return "busy";
  return "online";
}

/* Returns true when the last GPS ping is older than offlineAfterSec */
function isGpsStale(rider: Rider, offlineAfterSec: number): boolean {
  return rider.ageSeconds >= offlineAfterSec;
}

/* ── Vehicle type → emoji label (for text use) ── */
function getVehicleEmoji(vehicleType: string | null): string {
  const v = (vehicleType ?? "").toLowerCase();
  if (v.includes("bike") || v.includes("motorcycle") || v.includes("moto")) return "🏍️";
  if (v.includes("car") || v.includes("taxi"))  return "🚗";
  if (v.includes("rickshaw")) return "🛺";
  if (v.includes("van") || v.includes("daba"))  return "🚐";
  if (v.includes("truck") || v.includes("lori")) return "🚛";
  if (v.includes("service") || v.includes("tool") || v.includes("wrench")) return "🔧";
  return "🏍️";
}

/* Legacy alias for text display */
const getVehicleIcon = getVehicleEmoji;

/* ── SVG paths for distinct map icon shapes ── */
function getVehicleSvgPath(vehicleType: string | null): string {
  const v = (vehicleType ?? "").toLowerCase();
  if (v.includes("car") || v.includes("taxi")) {
    /* Car silhouette */
    return `<path d="M6 11L7.5 6.5A1.5 1.5 0 0 1 9 5.5h6a1.5 1.5 0 0 1 1.5 1l1.5 4.5" stroke="white" stroke-width="1" fill="none"/><rect x="3" y="11" width="18" height="6" rx="1.5" fill="white" opacity="0.9"/><circle cx="7" cy="18" r="2" fill="white"/><circle cx="17" cy="18" r="2" fill="white"/>`;
  }
  if (v.includes("rickshaw")) {
    /* Three-wheeler shape */
    return `<path d="M5 14L7 8h8l3 6H5z" fill="white" opacity="0.9"/><circle cx="7" cy="17" r="2" fill="white"/><circle cx="17" cy="17" r="2" fill="white"/><circle cx="12" cy="17" r="1.5" fill="white"/>`;
  }
  if (v.includes("van") || v.includes("daba") || v.includes("bus")) {
    /* Van/bus shape */
    return `<rect x="3" y="8" width="18" height="9" rx="2" fill="white" opacity="0.9"/><rect x="4" y="9" width="7" height="4" rx="1" fill="rgba(0,0,0,0.3)"/><rect x="13" y="9" width="4" height="4" rx="1" fill="rgba(0,0,0,0.3)"/><circle cx="7" cy="18" r="2" fill="white"/><circle cx="17" cy="18" r="2" fill="white"/>`;
  }
  if (v.includes("truck") || v.includes("lori")) {
    /* Truck shape */
    return `<rect x="2" y="10" width="12" height="7" rx="1" fill="white" opacity="0.9"/><path d="M14 12l5 0v5h-5z" fill="white" opacity="0.8"/><circle cx="6" cy="18.5" r="2" fill="white"/><circle cx="16" cy="18.5" r="2" fill="white"/>`;
  }
  /* Default: motorcycle/bike SVG */
  return `<ellipse cx="7" cy="17" rx="3" ry="3" stroke="white" stroke-width="1.5" fill="none"/><ellipse cx="17" cy="17" rx="3" ry="3" stroke="white" stroke-width="1.5" fill="none"/><path d="M7 17L10 10l4 0 2 4-3 3" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
}

/* Service-provider icon: wrench/tool silhouette in distinct purple */
function makeServiceProviderIcon(status: "online" | "offline" | "busy", isSelected: boolean, stale: boolean) {
  const color = "#7c3aed"; /* Purple — distinct from rider green/red/gray */
  const size = isSelected ? 44 : 34;
  const innerSize = size - 8;
  const staleBorder = stale && status !== "offline" ? "3px solid #f59e0b" : `${isSelected ? "3px" : "2px"} solid white`;
  /* Wrench/tool SVG path */
  const svgPath = `<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;background:${color};border:${staleBorder};border-radius:${isSelected ? "10px" : "8px"};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,0.35);cursor:pointer;will-change:transform;transition:background-color 0.3s,border-color 0.3s">
      <svg width="${innerSize}" height="${innerSize}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${svgPath}</svg>
    </div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function makeRiderIcon(rider: Rider, status: "online" | "offline" | "busy", isSelected: boolean, stale: boolean) {
  /* Service providers get a distinct purple wrench icon */
  const role = (rider.role ?? "rider").toLowerCase();
  if (role === "service_provider" || role === "provider") {
    return makeServiceProviderIcon(status, isSelected, stale);
  }
  const color = status === "online" ? "#22c55e" : status === "busy" ? "#ef4444" : "#9ca3af";
  const size = isSelected ? 44 : 34;
  const innerSize = size - 8;
  const staleBorder = stale && status !== "offline" ? "3px solid #f59e0b" : `${isSelected ? "3px" : "2px"} solid white`;
  const svgPath = getVehicleSvgPath(rider.vehicleType);
  /* Use CSS transform for smooth position updates instead of recreating DOM elements */
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;background:${color};border:${staleBorder};border-radius:${isSelected ? "10px" : "50%"};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,0.35);cursor:pointer;will-change:transform;transition:background-color 0.3s,border-color 0.3s">
      <svg width="${innerSize}" height="${innerSize}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${svgPath}</svg>
    </div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function makeCustomerIcon(isSelected: boolean) {
  const size = isSelected ? 32 : 24;
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;background:#3b82f6;border:2px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-size:${isSelected ? "14px" : "11px"}">👤</div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function makeSOSIcon() {
  return L.divIcon({
    html: `<div style="width:36px;height:36px;background:#ef4444;border:3px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(239,68,68,0.7);font-size:18px;animation:pulse 1s infinite">🆘</div>`,
    className: "",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

function makeLoginIcon() {
  return L.divIcon({
    html: `<div style="width:28px;height:28px;background:#6366f1;border:2px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-size:14px">🏠</div>`,
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/* Auto-fits the map to include all markers on first data load.
   Falls back to the default center if there are no markers. */
function FitBoundsOnLoad({
  riders,
  customers,
  defaultLat,
  defaultLng,
}: {
  riders: Array<{ lat: number; lng: number }>;
  customers: Array<{ lat: number; lng: number }>;
  defaultLat: number;
  defaultLng: number;
}) {
  const map = useMap();
  const fittedRef = useRef(false);
  const prevHashRef = useRef("");

  const points = useMemo(() => [
    ...riders.filter(r => r.lat !== 0 || r.lng !== 0).map(r => [r.lat, r.lng] as [number, number]),
    ...customers.filter(c => c.lat !== 0 || c.lng !== 0).map(c => [c.lat, c.lng] as [number, number]),
  ], [riders, customers]);

  const pointsHash = useMemo(() => {
    if (points.length === 0) return "";
    const minLat = Math.min(...points.map(p => p[0]));
    const maxLat = Math.max(...points.map(p => p[0]));
    const minLng = Math.min(...points.map(p => p[1]));
    const maxLng = Math.max(...points.map(p => p[1]));
    return `${points.length}:${minLat.toFixed(3)}:${maxLat.toFixed(3)}:${minLng.toFixed(3)}:${maxLng.toFixed(3)}`;
  }, [points]);

  useEffect(() => {
    if (points.length === 0) {
      if (!fittedRef.current) {
        map.setView([defaultLat, defaultLng], 12);
        fittedRef.current = true;
      }
      return;
    }
    if (fittedRef.current && pointsHash === prevHashRef.current) return;
    prevHashRef.current = pointsHash;
    fittedRef.current = true;
    if (points.length === 1) {
      map.setView(points[0]!, 14);
    } else {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
    }
  }, [pointsHash]);

  return null;
}

/* ── RiderTrailOverlay — fetches & renders persisted GPS history for a single rider ──
   Decoupled component so it can call useRiderRoute per rider without breaking hook rules.
   Uses session-scoped mode (sinceOnline=true) by default — no date prop needed here.
   Date is only passed when the admin explicitly picks a historic date in the detail panel. */
function RiderTrailOverlay({ userId, date }: { userId: string; date?: string }) {
  const { data } = useRiderRoute(userId, date);
  const pts: Array<[number, number]> = (data?.route ?? []).map(
    (p: { latitude: number; longitude: number }) => [p.latitude, p.longitude]
  );
  if (pts.length < 2) return null;
  return (
    <Polyline
      positions={pts}
      pathOptions={{ color: "#6366f1", weight: 2.5, opacity: 0.7, dashArray: "6,4" }}
    />
  );
}

/* ── AnimatedMarker — smoothly interpolates to new lat/lng over ~1.2s via RAF ── */
function AnimatedMarker({
  position,
  icon,
  children,
  onClick,
}: {
  position: [number, number];
  icon: L.Icon | L.DivIcon;
  children?: React.ReactNode;
  onClick?: () => void;
}) {
  const markerRef = useRef<L.Marker | null>(null);
  const animRef   = useRef<number | null>(null);
  const prevPos   = useRef<[number, number]>(position);

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    const [fromLat, fromLng] = prevPos.current;
    const [toLat, toLng]     = position;
    if (fromLat === toLat && fromLng === toLng) return;

    const DURATION = 1200; /* ms */
    const start = performance.now();

    if (animRef.current != null) cancelAnimationFrame(animRef.current);

    const step = (now: number) => {
      const t = Math.min((now - start) / DURATION, 1);
      /* Ease-out cubic */
      const ease = 1 - Math.pow(1 - t, 3);
      marker.setLatLng([fromLat + (toLat - fromLat) * ease, fromLng + (toLng - fromLng) * ease]);
      if (t < 1) {
        animRef.current = requestAnimationFrame(step);
      } else {
        prevPos.current = position;
        animRef.current = null;
      }
    };
    animRef.current = requestAnimationFrame(step);
    return () => { if (animRef.current != null) cancelAnimationFrame(animRef.current); };
  }, [position[0], position[1]]);

  return (
    <Marker
      ref={(m) => { markerRef.current = m; }}
      position={position}
      icon={icon}
      eventHandlers={{ click: onClick ? () => onClick() : undefined }}
    >
      {children}
    </Marker>
  );
}

/* ── Fleet Analytics Tab ── */
function FleetAnalyticsTab() {
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-fleet-analytics", fromDate, toDate],
    queryFn: () => fetcher(`/fleet-analytics?from=${fromDate}&to=${toDate}`),
    staleTime: 60_000,
  });

  const heatPoints: Array<{ lat: number; lng: number; weight: number }> = data?.heatmap ?? [];
  const riderDistances: Array<{ userId: string; name: string; distanceKm: number }> = data?.riderDistances ?? [];
  const peakZones: Array<{ lat: number; lng: number; pings: number }> = data?.peakZones ?? [];

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground">From</label>
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="text-sm border rounded-lg px-2 py-1.5"
            max={toDate}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground">To</label>
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            className="text-sm border rounded-lg px-2 py-1.5"
            min={fromDate}
            max={new Date().toISOString().slice(0, 10)}
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading} className="h-9 rounded-xl gap-2">
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 rounded-2xl border-border/50 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Total GPS Pings</p>
          <p className="text-3xl font-black text-foreground">{(data?.totalPings ?? 0).toLocaleString()}</p>
          <p className="text-xs text-muted-foreground mt-1">Rider location updates</p>
        </Card>
        <Card className="p-4 rounded-2xl border-border/50 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Avg Response Time</p>
          <p className="text-3xl font-black text-foreground">
            {data?.avgResponseTimeMin != null ? `${data.avgResponseTimeMin}m` : "—"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Ride request to acceptance</p>
        </Card>
        <Card className="p-4 rounded-2xl border-border/50 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Active Riders</p>
          <p className="text-3xl font-black text-foreground">{riderDistances.length}</p>
          <p className="text-xs text-muted-foreground mt-1">With tracked distance</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Heatmap overlay (simplified dot map) */}
        <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border/40">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-orange-500" />
              <h3 className="font-bold text-sm">Activity Heatmap</h3>
              <span className="text-xs text-muted-foreground">({heatPoints.length.toLocaleString()} points)</span>
            </div>
          </div>
          <div style={{ height: 350 }}>
            {heatPoints.length > 0 ? (
              <MapContainer
                center={heatPoints.length > 0 ? [heatPoints[0]!.lat, heatPoints[0]!.lng] : [30.3753, 69.3451]}
                zoom={11}
                style={{ width: "100%", height: "100%" }}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution="&copy; OpenStreetMap contributors"
                  maxZoom={19}
                />
                {heatPoints.slice(0, 2000).map((pt, i) => (
                  <Circle
                    key={i}
                    center={[pt.lat, pt.lng]}
                    radius={100}
                    pathOptions={{ color: "transparent", fillColor: "#f97316", fillOpacity: 0.15 }}
                  />
                ))}
              </MapContainer>
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gray-50">
                <p className="text-sm text-muted-foreground">
                  {isLoading ? "Loading heatmap..." : "No location data for selected period"}
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* Rider distance leaderboard */}
        <Card className="rounded-2xl border-border/50 shadow-sm">
          <div className="p-4 border-b border-border/40">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              <h3 className="font-bold text-sm">Distance Covered</h3>
              <span className="text-xs text-muted-foreground">(km, top riders)</span>
            </div>
          </div>
          {riderDistances.length > 0 ? (
            <div className="p-4">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={riderDistances.slice(0, 10)} layout="vertical" margin={{ left: 8, right: 20 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} unit=" km" />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                  <Tooltip formatter={(v) => [`${v} km`, "Distance"]} />
                  <Bar dataKey="distanceKm" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {isLoading ? "Loading..." : "No rider distance data"}
            </div>
          )}
        </Card>
      </div>

      {/* Peak Zones */}
      {peakZones.length > 0 && (
        <Card className="rounded-2xl border-border/50 shadow-sm">
          <div className="p-4 border-b border-border/40">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-red-500" />
              <h3 className="font-bold text-sm">Peak Activity Zones</h3>
              <span className="text-xs text-muted-foreground">(top {peakZones.length} clusters, ~500 m grid)</span>
            </div>
          </div>
          <div className="divide-y divide-border/40">
            {peakZones.map((zone, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="text-lg font-black text-orange-500">#{i + 1}</span>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {zone.lat.toFixed(4)}, {zone.lng.toFixed(4)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${zone.lat}&mlon=${zone.lng}&zoom=15`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-500 hover:underline"
                      >
                        View on map
                      </a>
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-foreground">{zone.pings.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">pings</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

export default function LiveRidersMap() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, dataUpdatedAt } = useLiveRiders();
  const { data: settingsData } = usePlatformSettings();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [routeDate, setRouteDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sliderVal, setSliderVal] = useState(100);
  const [showCustomers, setShowCustomers] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [secAgo, setSecAgo] = useState(0);
  const [riderOverrides, setRiderOverrides] = useState<Record<string, { lat: number; lng: number; updatedAt: string; action?: string | null }>>({});
  const [customerOverrides, setCustomerOverrides] = useState<Record<string, { lat: number; lng: number; updatedAt: string }>>({});
  /* Status overrides from rider:status socket events (instant online/offline sync) */
  const [riderStatusOverrides, setRiderStatusOverrides] = useState<Record<string, { isOnline: boolean; updatedAt: string }>>({});
  /* Heartbeat data: battery level + last seen time per rider */
  const [riderHeartbeats, setRiderHeartbeats] = useState<Record<string, { batteryLevel?: number | null; lastSeen: string }>>({});
  /* Spoof alerts from server anti-spoofing */
  const [spoofAlerts, setSpoofAlerts] = useState<Array<{ userId: string; reason: string; autoOffline: boolean; sentAt: string }>>([]);
  const [activeTab, setActiveTab] = useState<"map" | "analytics">("map");
  const [sosAlerts, setSosAlerts] = useState<SOSAlert[]>([]);
  const [selectedSOS, setSelectedSOS] = useState<SOSAlert | null>(null);
  const [chatMessages, setChatMessages] = useState<Record<string, Array<{ text: string; ts: string; from: "admin" | "rider" }>>>({});
  const [chatInput, setChatInput] = useState("");
  /* Sidebar search + filter (search is debounced 200ms to avoid re-renders on every keystroke) */
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(sidebarSearch), 200);
    return () => clearTimeout(t);
  }, [sidebarSearch]);
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline" | "busy">("all");
  const socketRef = useRef<Socket | null>(null);
  const [vehicleFilter, setVehicleFilter] = useState<string>("all");
  const [zoneFilter, setZoneFilter] = useState<string>("all");
  const [activeRideFilter, setActiveRideFilter] = useState(false);
  /* Per-rider show-trail toggle: Set of userIds that have trail display enabled */
  const [trailSet, setTrailSet] = useState<Set<string>>(new Set());
  const toggleTrail = (uid: string) => setTrailSet(prev => {
    const next = new Set(prev);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    return next;
  });

  const { data: routeData } = useRiderRoute(selectedId, routeDate);
  const { data: customerData } = useCustomerLocations();

  const routePoints: RoutePoint[] = routeData?.route ?? [];
  const sliderMax = Math.max(0, routePoints.length - 1);
  const sliderIndex = sliderMax > 0 ? Math.round((sliderVal / 100) * sliderMax) : 0;
  const visibleRoute = routePoints.slice(0, sliderIndex + 1);

  /* ── Socket.io connection ── */
  useEffect(() => {
    const token = localStorage.getItem("ajkmart_admin_token") ?? "";
    const socketUrl = window.location.origin;
    const socket = io(socketUrl, {
      path: "/api/socket.io",
      query: { rooms: "admin-fleet" },
      auth: { adminToken: token },
      extraHeaders: { "x-admin-token": token },
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setWsConnected(true);
      socket.emit("join", "admin-fleet");
    });

    socket.on("connect_error", (err) => {
      console.warn("[Fleet] Socket connect error:", err.message);
      setWsConnected(false);
    });

    socket.on("disconnect", () => setWsConnected(false));

    socket.on("rider:location", (payload: {
      userId: string;
      latitude: number;
      longitude: number;
      action?: string | null;
      updatedAt: string;
    }) => {
      if (typeof payload.userId !== "string" ||
          typeof payload.latitude !== "number" ||
          typeof payload.longitude !== "number") return;
      setRiderOverrides(prev => {
        const next = {
          ...prev,
          [payload.userId]: {
            lat: payload.latitude,
            lng: payload.longitude,
            updatedAt: payload.updatedAt,
            action: payload.action,
          },
        };
        /* Prune to prevent unbounded growth — keep most recent 500 riders */
        const keys = Object.keys(next);
        if (keys.length > 500) {
          const sorted = keys.sort(
            (a, b) => new Date(prev[a]?.updatedAt ?? 0).getTime() - new Date(prev[b]?.updatedAt ?? 0).getTime()
          );
          for (const k of sorted.slice(0, keys.length - 500)) delete next[k];
        }
        return next;
      });
      setSecAgo(0);
    });

    socket.on("customer:location", (payload: {
      userId: string;
      latitude: number;
      longitude: number;
      updatedAt: string;
    }) => {
      if (typeof payload.userId !== "string" ||
          typeof payload.latitude !== "number" ||
          typeof payload.longitude !== "number") return;
      setCustomerOverrides(prev => {
        const next = {
          ...prev,
          [payload.userId]: {
            lat: payload.latitude,
            lng: payload.longitude,
            updatedAt: payload.updatedAt,
          },
        };
        const keys = Object.keys(next);
        if (keys.length > 500) {
          const sorted = keys.sort(
            (a, b) => new Date(prev[a]?.updatedAt ?? 0).getTime() - new Date(prev[b]?.updatedAt ?? 0).getTime()
          );
          for (const k of sorted.slice(0, keys.length - 500)) delete next[k];
        }
        return next;
      });
    });

    /* SOS alert handler */
    socket.on("rider:sos", (payload: SOSAlert) => {
      if (typeof payload.userId !== "string") return;
      setSosAlerts(prev => {
        /* Deduplicate by userId — keep most recent */
        const filtered = prev.filter(a => a.userId !== payload.userId);
        return [payload, ...filtered];
      });
    });

    /* Rider-to-admin chat reply handler */
    socket.on("rider:chat", (payload: { userId: string; message: string; sentAt: string; from: "rider" }) => {
      if (typeof payload.userId !== "string" || typeof payload.message !== "string") return;
      setChatMessages(prev => ({
        ...prev,
        [payload.userId]: [
          ...(prev[payload.userId] ?? []),
          { text: payload.message, ts: payload.sentAt, from: "rider" as const },
        ],
      }));
    });

    /* Instant online/offline status change (T1) */
    socket.on("rider:status", (payload: { userId: string; isOnline: boolean; name?: string; batteryLevel?: number | null; updatedAt: string }) => {
      if (typeof payload.userId !== "string") return;
      setRiderStatusOverrides(prev => ({
        ...prev,
        [payload.userId]: { isOnline: payload.isOnline, updatedAt: payload.updatedAt },
      }));
    });

    /* Heartbeat — battery level + last seen refresh (T1, T2) */
    socket.on("rider:heartbeat", (payload: { userId: string; batteryLevel?: number | null; isOnline?: boolean; sentAt: string }) => {
      if (typeof payload.userId !== "string") return;
      setRiderHeartbeats(prev => ({
        ...prev,
        [payload.userId]: { batteryLevel: payload.batteryLevel, lastSeen: payload.sentAt },
      }));
    });

    /* Anti-spoofing auto-offline alert (T7) */
    socket.on("rider:spoof-alert", (payload: { userId: string; reason: string; autoOffline: boolean; sentAt: string }) => {
      if (typeof payload.userId !== "string") return;
      setSpoofAlerts(prev => [payload, ...prev].slice(0, 20));
      if (payload.autoOffline) {
        setRiderStatusOverrides(prev => ({
          ...prev,
          [payload.userId]: { isOnline: false, updatedAt: payload.sentAt },
        }));
      }
    });

    socket.on("order:new", () => {
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      qc.invalidateQueries({ queryKey: ["admin-orders-enriched"] });
    });
    socket.on("order:update", () => {
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      qc.invalidateQueries({ queryKey: ["admin-orders-enriched"] });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    setSecAgo(0);
    const t = setInterval(() => setSecAgo(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [dataUpdatedAt]);

  const settings: Record<string, string> = {};
  if (settingsData?.settings) {
    for (const s of settingsData.settings) settings[s.key] = s.value;
  }
  const defaultLat = parseFloat(settings["map_default_lat"] || settings["platform_default_lat"] || String(PLATFORM_DEFAULTS.defaultLat));
  const defaultLng = parseFloat(settings["map_default_lng"] || settings["platform_default_lng"] || String(PLATFORM_DEFAULTS.defaultLng));

  const baseRiders: Rider[] = data?.riders || [];
  const offlineAfterSec: number = data?.staleTimeoutSec ?? DEFAULT_OFFLINE_AFTER_SEC;

  /* Merge WebSocket overrides into the rider list (location + status + heartbeat) */
  const mergedBaseRiders: Rider[] = baseRiders.map(r => {
    const ov = riderOverrides[r.userId];
    const statusOv = riderStatusOverrides[r.userId];
    const hb = riderHeartbeats[r.userId];
    const base = ov ? { ...r, lat: ov.lat, lng: ov.lng, updatedAt: ov.updatedAt, action: ov.action ?? r.action } : r;
    const latestTs = ov ? ov.updatedAt : r.updatedAt;
    const ageSeconds = Math.floor((Date.now() - new Date(latestTs).getTime()) / 1000);
    return {
      ...base,
      ageSeconds,
      isFresh: ageSeconds < offlineAfterSec,
      /* Status override takes priority for instant online/offline sync */
      isOnline: statusOv ? statusOv.isOnline : r.isOnline,
      batteryLevel: hb?.batteryLevel ?? null,
      lastSeen: hb?.lastSeen ?? r.updatedAt,
    };
  });

  /* Add WebSocket-only riders (online but not yet in REST API response) */
  const mergedBaseRiderIds = new Set(mergedBaseRiders.map(r => r.userId));
  const wsOnlyRiders: Rider[] = Object.entries(riderOverrides)
    .filter(([uid]) => !mergedBaseRiderIds.has(uid))
    .map(([uid, ov]) => {
      const statusOv = riderStatusOverrides[uid];
      const hb = riderHeartbeats[uid];
      const ageSeconds = Math.floor((Date.now() - new Date(ov.updatedAt).getTime()) / 1000);
      return {
        userId: uid,
        name: "Rider",
        phone: null,
        isOnline: statusOv ? statusOv.isOnline : ageSeconds < offlineAfterSec,
        vehicleType: null,
        lat: ov.lat,
        lng: ov.lng,
        updatedAt: ov.updatedAt,
        ageSeconds,
        isFresh: ageSeconds < offlineAfterSec,
        action: ov.action ?? null,
        batteryLevel: hb?.batteryLevel ?? null,
        lastSeen: hb?.lastSeen ?? ov.updatedAt,
      };
    });

  const riders: Rider[] = [...mergedBaseRiders, ...wsOnlyRiders];

  /* ── Debounced filtered rider set — shared by both map markers AND sidebar list ──
     Keeps map and sidebar perfectly in sync with the same filter logic. */
  const filteredRiders = riders.filter(rider => {
    const status = getRiderStatus(rider);
    if (statusFilter !== "all" && status !== statusFilter) return false;
    if (vehicleFilter !== "all") {
      const vt = (rider.vehicleType ?? "").toLowerCase();
      const normalized = vt === "bike" || vt === "motorbike" || vt === "moto" ? "motorcycle" : vt;
      if (normalized !== vehicleFilter) return false;
    }
    if (activeRideFilter && status !== "busy") return false;
    if (zoneFilter !== "all" && (rider.city ?? null) !== zoneFilter) return false;
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      if (!rider.name?.toLowerCase().includes(q) && !rider.phone?.includes(q)) return false;
    }
    return true;
  });

  /* Customer locations */
  type RawCustomer = { userId: string; name?: string; lat?: number; latitude?: number; lng?: number; longitude?: number; updatedAt: string };
  const baseCustomers: CustomerLoc[] = ((customerData?.customers ?? []) as RawCustomer[]).map(c => ({
    userId: c.userId,
    name: c.name,
    lat: c.lat ?? c.latitude ?? 0,
    lng: c.lng ?? c.longitude ?? 0,
    updatedAt: c.updatedAt,
  }));

  const mergedCustomers: CustomerLoc[] = baseCustomers.map(c => {
    const ov = customerOverrides[c.userId];
    if (!ov) return c;
    return { ...c, lat: ov.lat, lng: ov.lng, updatedAt: ov.updatedAt };
  });
  const mergedCustomerIds = new Set(mergedCustomers.map(c => c.userId));
  const customers: CustomerLoc[] = [
    ...mergedCustomers,
    ...Object.entries(customerOverrides)
      .filter(([uid]) => !mergedCustomerIds.has(uid))
      .map(([uid, ov]) => ({ userId: uid, lat: ov.lat, lng: ov.lng, updatedAt: ov.updatedAt })),
  ];

  const onlineCount = riders.filter(r => getRiderStatus(r) === "online").length;
  const busyCount   = riders.filter(r => getRiderStatus(r) === "busy").length;
  const selectedRider = riders.find(r => r.userId === selectedId) || null;

  /* Icon caches */
  const riderIconCacheRef = useRef<Map<string, ReturnType<typeof makeRiderIcon>>>(new Map());
  const customerIconCacheRef = useRef<Map<string, ReturnType<typeof makeCustomerIcon>>>(new Map());

  const riderIconMap = (() => {
    const result = new Map<string, ReturnType<typeof makeRiderIcon>>();
    for (const rider of riders) {
      const status = getRiderStatus(rider);
      const stale = isGpsStale(rider, offlineAfterSec);
      const isSelected = rider.userId === selectedId;
      const cacheKey = `${rider.userId}:${status}:${isSelected ? "1" : "0"}:${stale ? "s" : "f"}`;
      let icon = riderIconCacheRef.current.get(cacheKey);
      if (!icon) {
        icon = makeRiderIcon(rider, status, isSelected, stale);
        riderIconCacheRef.current.set(cacheKey, icon);
      }
      result.set(rider.userId, icon);
    }
    return result;
  })();

  const customerIconMap = (() => {
    const result = new Map<string, ReturnType<typeof makeCustomerIcon>>();
    const cached = customerIconCacheRef.current.get("customer:false") ?? (() => {
      const icon = makeCustomerIcon(false);
      customerIconCacheRef.current.set("customer:false", icon);
      return icon;
    })();
    for (const c of customers) {
      result.set(c.userId, cached);
    }
    return result;
  })();

  const polylinePositions: [number, number][] = visibleRoute.map(p => [p.latitude, p.longitude]);
  const loginPoint = routePoints[0] ?? null;
  const replayPoint = visibleRoute[visibleRoute.length - 1] ?? null;

  /* Send admin chat message */
  const sendChatMessage = (riderId: string) => {
    if (!chatInput.trim() || !socketRef.current) return;
    socketRef.current.emit("admin:chat", { riderId, message: chatInput.trim() });
    setChatMessages(prev => ({
      ...prev,
      [riderId]: [...(prev[riderId] ?? []), { text: chatInput.trim(), ts: new Date().toISOString(), from: "admin" }],
    }));
    setChatInput("");
  };

  /* Dismiss SOS */
  const dismissSOS = (userId: string) => {
    setSosAlerts(prev => prev.filter(a => a.userId !== userId));
    if (selectedSOS?.userId === userId) setSelectedSOS(null);
  };

  return (
    <div className="space-y-5">
      {/* GPS Spoof Alert Banner */}
      {spoofAlerts.length > 0 && (
        <div className="bg-orange-600 text-white rounded-2xl p-3 flex items-start gap-3 shadow-lg shadow-orange-200">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm">⚠ GPS Spoof Detected ({spoofAlerts.length})</p>
            <div className="mt-1.5 space-y-1">
              {spoofAlerts.slice(0, 3).map((alert, i) => (
                <div key={i} className="flex items-center gap-2 text-xs bg-orange-700/50 rounded-xl px-3 py-1.5">
                  <span className="flex-1">{alert.userId.slice(0, 8)}… — {alert.reason}</span>
                  {alert.autoOffline && <span className="bg-orange-800 rounded px-1.5 py-0.5 text-[9px] font-bold">AUTO-OFFLINE</span>}
                  <button onClick={() => setSpoofAlerts(prev => prev.filter((_, j) => j !== i))} className="opacity-70 hover:opacity-100"><X className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          </div>
          <button onClick={() => setSpoofAlerts([])} className="opacity-70 hover:opacity-100"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* SOS Banner — red banner at top when active SOS alerts exist */}
      {sosAlerts.length > 0 && (
        <div className="bg-red-600 text-white rounded-2xl p-4 flex items-start gap-3 shadow-lg shadow-red-200 animate-pulse">
          <AlertTriangle className="w-6 h-6 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-lg">🆘 SOS Alert{sosAlerts.length > 1 ? `s (${sosAlerts.length})` : ""}</p>
            <div className="mt-2 space-y-2">
              {sosAlerts.map(sos => (
                <div key={sos.userId} className="flex items-center gap-3 bg-red-700/50 rounded-xl px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm">{sos.name} {sos.phone ? `· ${sos.phone}` : ""}</p>
                    <p className="text-xs text-red-200">{fd(sos.sentAt)} · {sos.latitude != null && sos.longitude != null ? `${sos.latitude.toFixed(5)}, ${sos.longitude.toFixed(5)}` : "Location unavailable"}</p>
                  </div>
                  <button
                    onClick={() => setSelectedSOS(sos)}
                    className="text-xs font-bold bg-white text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 flex items-center gap-1"
                  >
                    <MessageSquare className="w-3 h-3" /> Reply
                  </button>
                  <button
                    onClick={() => dismissSOS(sos.userId)}
                    className="text-xs font-bold bg-red-800/50 px-2 py-1.5 rounded-lg hover:bg-red-800"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SOS Chat Modal */}
      {selectedSOS && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="font-bold text-red-600 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> SOS — {selectedSOS.name}</p>
                {selectedSOS.phone && <p className="text-xs text-gray-500">{selectedSOS.phone}</p>}
                <p className="text-xs text-gray-400">{fd(selectedSOS.sentAt)}</p>
              </div>
              <button onClick={() => setSelectedSOS(null)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>
            {/* Chat history */}
            <div className="bg-gray-50 rounded-xl p-3 min-h-[80px] max-h-40 overflow-y-auto space-y-2 mb-3">
              {(chatMessages[selectedSOS.userId] ?? []).length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">No messages yet. Send a message to the rider.</p>
              ) : (
                (chatMessages[selectedSOS.userId] ?? []).map((m, i) => (
                  <div key={i} className={`flex ${m.from === "admin" ? "justify-end" : "justify-start"}`}>
                    <div className={`text-xs px-3 py-1.5 rounded-xl max-w-[80%] ${m.from === "admin" ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-800"}`}>
                      {m.text}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendChatMessage(selectedSOS.userId)}
                placeholder="Type a reply..."
                className="flex-1 text-sm border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button
                onClick={() => sendChatMessage(selectedSOS.userId)}
                className="bg-blue-600 text-white text-sm font-bold px-4 py-2 rounded-xl hover:bg-blue-700"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-green-100 text-green-600 rounded-xl flex items-center justify-center">
            <Navigation className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Live Riders Map</h1>
            <p className="text-muted-foreground text-sm">{riders.length} riders tracked · {onlineCount} online · {busyCount} busy</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Tab selector */}
          <div className="flex rounded-xl border border-border overflow-hidden">
            <button
              onClick={() => setActiveTab("map")}
              className={`px-3 py-1.5 text-sm font-semibold flex items-center gap-1.5 ${activeTab === "map" ? "bg-green-600 text-white" : "bg-white text-muted-foreground hover:bg-gray-50"}`}
            >
              <MapPin className="w-3.5 h-3.5" /> Map
            </button>
            <button
              onClick={() => setActiveTab("analytics")}
              className={`px-3 py-1.5 text-sm font-semibold flex items-center gap-1.5 ${activeTab === "analytics" ? "bg-blue-600 text-white" : "bg-white text-muted-foreground hover:bg-gray-50"}`}
            >
              <BarChart2 className="w-3.5 h-3.5" /> Analytics
            </button>
          </div>
          {activeTab === "map" && (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className={`w-2 h-2 rounded-full ${wsConnected ? "bg-green-500 animate-pulse" : "bg-amber-400"}`} />
                {wsConnected ? "Live" : isLoading ? "Refreshing..." : `${secAgo}s ago`}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCustomers(v => !v)}
                className="h-9 rounded-xl gap-2"
              >
                {showCustomers ? <Eye className="w-4 h-4 text-blue-500" /> : <EyeOff className="w-4 h-4 text-gray-400" />}
                Customers
              </Button>
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading} className="h-9 rounded-xl gap-2">
                <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </>
          )}
        </div>
      </div>

      {activeTab === "analytics" ? (
        <FleetAnalyticsTab />
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-4 gap-3">
            <Card className="p-4 rounded-2xl border-border/50 shadow-sm text-center">
              <p className="text-2xl font-bold text-foreground">{riders.length}</p>
              <p className="text-xs text-muted-foreground mt-1">Total Tracked</p>
            </Card>
            <Card className="p-4 rounded-2xl border-border/50 shadow-sm text-center bg-green-50/60 border-green-200/60">
              <p className="text-2xl font-bold text-green-700">{onlineCount}</p>
              <p className="text-xs text-green-600 mt-1">Online</p>
            </Card>
            <Card className="p-4 rounded-2xl border-border/50 shadow-sm text-center bg-red-50/60 border-red-200/60">
              <p className="text-2xl font-bold text-red-600">{busyCount}</p>
              <p className="text-xs text-red-500 mt-1">Busy / On Trip</p>
            </Card>
            <Card className="p-4 rounded-2xl border-border/50 shadow-sm text-center bg-blue-50/60 border-blue-200/60">
              <p className="text-2xl font-bold text-blue-700">{showCustomers ? customers.length : 0}</p>
              <p className="text-xs text-blue-500 mt-1">Active Customers</p>
            </Card>
          </div>

          {/* Map + sidebar */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Map */}
            <div className="lg:col-span-2">
              <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden" style={{ height: 520 }}>
                {isLoading && riders.length === 0 ? (
                  <div className="w-full h-full flex items-center justify-center bg-gray-50">
                    <div className="text-center">
                      <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">Loading map...</p>
                    </div>
                  </div>
                ) : (
                  <MapContainer
                    center={[defaultLat, defaultLng]}
                    zoom={12}
                    style={{ width: "100%", height: "100%" }}
                  >
                    <TileLayer
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      attribution="&copy; OpenStreetMap contributors"
                      maxZoom={19}
                    />
                    <FitBoundsOnLoad
                      riders={riders}
                      customers={customers}
                      defaultLat={defaultLat}
                      defaultLng={defaultLng}
                    />

                    {/* Per-rider persisted trail polylines — shown when trail toggle is on */}
                    {filteredRiders
                      .filter(r => trailSet.has(r.userId))
                      .map(r => (
                        <RiderTrailOverlay key={`trail-${r.userId}`} userId={r.userId} />
                      ))}

                    {/* Rider markers — AnimatedMarker smoothly tweens position over 1.2s
                        Uses filteredRiders so map and sidebar list are always in sync */}
                    {filteredRiders.map(rider => {
                      const status = getRiderStatus(rider);
                      const stale = isGpsStale(rider, offlineAfterSec);
                      return (
                        <AnimatedMarker
                          key={rider.userId}
                          position={[rider.lat, rider.lng]}
                          icon={riderIconMap.get(rider.userId)!}
                          onClick={() => setSelectedId(rider.userId)}
                        >
                          <Popup maxWidth={200}>
                            <div style={{ fontFamily: "sans-serif", minWidth: 160 }}>
                              <p style={{ fontWeight: 700, margin: "0 0 4px" }}>{rider.name || "Unknown Rider"}</p>
                              <p style={{ color: "#6b7280", fontSize: 12, margin: 0 }}>
                                {rider.phone || "No phone"}{rider.vehicleType ? ` · ${rider.vehicleType}` : ""}
                              </p>
                              <p style={{ fontSize: 11, margin: "4px 0 0", color: status === "online" ? "#22c55e" : status === "busy" ? "#ef4444" : "#9ca3af" }}>
                                ● {status === "online" ? "Online" : status === "busy" ? "Busy / On Trip" : "Offline"} · {fd(rider.updatedAt)}
                              </p>
                              {stale && status !== "offline" && (
                                <p style={{ fontSize: 10, margin: "2px 0 0", color: "#f59e0b" }}>⚠ GPS stale — last ping {fd(rider.updatedAt)}</p>
                              )}
                            </div>
                          </Popup>
                        </AnimatedMarker>
                      );
                    })}

                    {/* Customer markers */}
                    {showCustomers && customers.map(c => (
                      <Marker
                        key={c.userId}
                        position={[c.lat, c.lng]}
                        icon={customerIconMap.get(c.userId)!}
                      >
                        <Popup maxWidth={160}>
                          <div style={{ fontFamily: "sans-serif" }}>
                            <p style={{ fontWeight: 700, margin: "0 0 2px" }}>{c.name || "Customer"}</p>
                            <p style={{ fontSize: 11, color: "#3b82f6", margin: 0 }}>👤 Active · {fd(c.updatedAt)}</p>
                          </div>
                        </Popup>
                      </Marker>
                    ))}

                    {/* SOS markers on map — only render when location is known */}
                    {sosAlerts.filter(sos => sos.latitude != null && sos.longitude != null).map(sos => (
                      <Marker
                        key={`sos-${sos.userId}`}
                        position={[sos.latitude!, sos.longitude!]}
                        icon={makeSOSIcon()}
                      >
                        <Popup maxWidth={200}>
                          <div style={{ fontFamily: "sans-serif" }}>
                            <p style={{ fontWeight: 700, color: "#ef4444", margin: "0 0 4px" }}>🆘 SOS — {sos.name}</p>
                            {sos.phone && <p style={{ fontSize: 12, margin: 0 }}>{sos.phone}</p>}
                            <p style={{ fontSize: 11, color: "#9ca3af", margin: "4px 0 0" }}>{fd(sos.sentAt)}</p>
                          </div>
                        </Popup>
                      </Marker>
                    ))}

                    {/* Selected rider route playback */}
                    {selectedRider && polylinePositions.length > 1 && (
                      <Polyline positions={polylinePositions} color="#6366f1" weight={3} opacity={0.75} />
                    )}

                    {/* Login location pin */}
                    {selectedRider && loginPoint && (
                      <Marker position={[loginPoint.latitude, loginPoint.longitude]} icon={makeLoginIcon()}>
                        <Popup>
                          <div style={{ fontFamily: "sans-serif" }}>
                            <p style={{ fontWeight: 700, margin: "0 0 2px" }}>Login Location</p>
                            <p style={{ fontSize: 11, color: "#6366f1", margin: 0 }}>{new Date(loginPoint.createdAt).toLocaleTimeString()}</p>
                          </div>
                        </Popup>
                      </Marker>
                    )}

                    {/* Replay scrub position */}
                    {selectedRider && replayPoint && sliderVal < 100 && (
                      <Marker
                        position={[replayPoint.latitude, replayPoint.longitude]}
                        icon={L.divIcon({
                          html: `<div style="width:18px;height:18px;background:#6366f1;border:2px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>`,
                          className: "",
                          iconSize: [18, 18],
                          iconAnchor: [9, 9],
                        })}
                      >
                        <Popup>
                          <p style={{ fontFamily: "sans-serif", fontSize: 11 }}>{new Date(replayPoint.createdAt).toLocaleTimeString()}</p>
                        </Popup>
                      </Marker>
                    )}
                  </MapContainer>
                )}
              </Card>
            </div>

            {/* Riders list sidebar */}
            <div className="space-y-2">
              {/* Search + Filter Controls */}
              <div className="space-y-2">
                <input
                  type="text"
                  value={sidebarSearch}
                  onChange={e => setSidebarSearch(e.target.value)}
                  placeholder="Search by name or phone..."
                  className="w-full text-xs border border-border/60 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-green-400 bg-white"
                />
                <div className="flex gap-1.5 flex-wrap">
                  {(["all", "online", "busy", "offline"] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setStatusFilter(f)}
                      className={`px-2.5 py-1 text-[10px] font-bold rounded-full border transition-colors ${
                        statusFilter === f
                          ? f === "online" ? "bg-green-600 text-white border-green-600"
                            : f === "busy" ? "bg-red-600 text-white border-red-600"
                            : f === "offline" ? "bg-gray-500 text-white border-gray-500"
                            : "bg-foreground text-background border-foreground"
                          : "bg-transparent text-muted-foreground border-border/50 hover:bg-muted"
                      }`}
                    >
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1.5 flex-wrap items-center">
                  <span className="text-[10px] font-semibold text-muted-foreground">Vehicle:</span>
                  {(["all", "motorcycle", "car", "rickshaw", "van", "truck"] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => setVehicleFilter(v)}
                      className={`px-2 py-0.5 text-[10px] font-bold rounded-full border transition-colors ${
                        vehicleFilter === v
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-transparent text-muted-foreground border-border/50 hover:bg-muted"
                      }`}
                    >
                      {v === "all" ? "All" : `${getVehicleIcon(v)} ${v.charAt(0).toUpperCase() + v.slice(1)}`}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1.5 flex-wrap items-center">
                  <span className="text-[10px] font-semibold text-muted-foreground">Other:</span>
                  <button
                    onClick={() => setActiveRideFilter(p => !p)}
                    className={`px-2.5 py-1 text-[10px] font-bold rounded-full border transition-colors ${
                      activeRideFilter
                        ? "bg-purple-600 text-white border-purple-600"
                        : "bg-transparent text-muted-foreground border-border/50 hover:bg-muted"
                    }`}
                  >
                    🚗 Active Ride
                  </button>
                </div>
                {/* Zone/city filter — dynamically built from riders' city field */}
                {(() => {
                  const cities = ["all", ...Array.from(new Set(riders.map(r => r.city).filter(Boolean) as string[])).sort()];
                  if (cities.length <= 1) return null;
                  return (
                    <div className="flex gap-1.5 flex-wrap items-center">
                      <span className="text-[10px] font-semibold text-muted-foreground">Zone:</span>
                      {cities.map(c => (
                        <button
                          key={c}
                          onClick={() => setZoneFilter(c)}
                          className={`px-2 py-0.5 text-[10px] font-bold rounded-full border transition-colors ${
                            zoneFilter === c
                              ? "bg-teal-600 text-white border-teal-600"
                              : "bg-transparent text-muted-foreground border-border/50 hover:bg-muted"
                          }`}
                        >
                          {c === "all" ? "All Zones" : c}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>

              <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden" style={{ maxHeight: 460, overflow: "auto" }}>
                {isLoading && riders.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Loading riders...</div>
                ) : riders.length === 0 ? (
                  <div className="p-8 text-center">
                    <Users className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No riders tracked yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border/40">
                    {filteredRiders
                      .slice() /* shallow copy before sort to avoid mutating original */
                      .sort((a, b) => {
                        /* Sort: online/busy first, then by last update */
                        const sa = getRiderStatus(a), sb = getRiderStatus(b);
                        if (sa !== sb) {
                          const order = { online: 0, busy: 1, offline: 2 };
                          return (order[sa] ?? 3) - (order[sb] ?? 3);
                        }
                        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
                      })
                      .map(rider => {
                        const status = getRiderStatus(rider);
                        const stale = isGpsStale(rider, offlineAfterSec);
                        const battPct = rider.batteryLevel != null ? Math.round(rider.batteryLevel * 100) : null;
                        const battColor = battPct != null ? (battPct > 50 ? "#22c55e" : battPct > 20 ? "#f59e0b" : "#ef4444") : null;
                        const hasTrail = trailSet.has(rider.userId);
                        return (
                          <div
                            key={rider.userId}
                            role="button"
                            onClick={() => setSelectedId(rider.userId === selectedId ? null : rider.userId)}
                            className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer ${
                              rider.userId === selectedId ? "bg-green-50 border-l-4 border-green-500" : ""
                            }`}
                          >
                            <div className="flex-shrink-0">
                              <StatusDot status={status} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-sm text-foreground truncate">{rider.name || "Unknown Rider"}</p>
                              <p className="text-xs text-muted-foreground">
                                {getVehicleIcon(rider.vehicleType)} {rider.phone || "No phone"}{rider.vehicleType ? ` · ${rider.vehicleType}` : ""}
                              </p>
                              {/* Last Seen */}
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                Last Seen: {fd(rider.lastSeen ?? rider.updatedAt)}
                              </p>
                              {stale && status !== "offline" && (
                                <p className="text-[10px] text-amber-500">⚠ GPS stale</p>
                              )}
                              {/* Show Trail toggle */}
                              <button
                                onClick={e => { e.stopPropagation(); toggleTrail(rider.userId); }}
                                className={`mt-1 px-2 py-0.5 text-[9px] font-bold rounded-full border transition-colors ${
                                  hasTrail ? "bg-indigo-600 text-white border-indigo-600" : "bg-transparent text-muted-foreground border-border/50 hover:bg-muted"
                                }`}
                              >
                                {hasTrail ? "▶ Trail On" : "▶ Trail"}
                              </button>
                            </div>
                            <div className="text-right flex-shrink-0 space-y-1">
                              <Badge
                                className={`text-[10px] font-bold ${
                                  status === "busy"
                                    ? "bg-red-100 text-red-700"
                                    : status === "online"
                                    ? "bg-green-100 text-green-700"
                                    : "bg-gray-100 text-gray-500"
                                }`}
                              >
                                {status === "busy" ? "Busy" : status === "online" ? "Online" : "Offline"}
                              </Badge>
                              {/* Battery Level */}
                              {battPct != null && (
                                <div className="flex items-center justify-end gap-1">
                                  <div className="w-10 h-2 bg-gray-200 rounded-full overflow-hidden">
                                    <div style={{ width: `${battPct}%`, background: battColor ?? "#22c55e" }} className="h-full rounded-full transition-all" />
                                  </div>
                                  <span className="text-[9px] font-bold" style={{ color: battColor ?? "#22c55e" }}>{battPct}%</span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
              </Card>
            </div>
          </div>

          {/* Selected rider detail + route playback */}
          {selectedRider && (
            <Card className="rounded-2xl border-border/50 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-lg">{getVehicleIcon(selectedRider.vehicleType)} {selectedRider.name}</h3>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={routeDate}
                    onChange={e => { setRouteDate(e.target.value); setSliderVal(100); }}
                    className="text-xs border rounded-lg px-2 py-1"
                    max={new Date().toISOString().slice(0, 10)}
                  />
                  <button onClick={() => setSelectedId(null)} className="text-xs text-muted-foreground hover:underline">Deselect</button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-sm mb-4">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Status</p>
                  <p className="font-bold mt-0.5 flex items-center gap-1.5">
                    <StatusDot status={getRiderStatus(selectedRider)} />
                    {getRiderStatus(selectedRider) === "busy" ? "Busy / On Trip" : getRiderStatus(selectedRider) === "online" ? "Online" : "Offline"}
                    {isGpsStale(selectedRider, offlineAfterSec) && getRiderStatus(selectedRider) !== "offline" && (
                      <span className="text-[10px] text-amber-500 font-normal ml-1">⚠ GPS stale</span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Phone</p>
                  <p className="font-bold mt-0.5">{selectedRider.phone || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Vehicle</p>
                  <p className="font-bold mt-0.5">{selectedRider.vehicleType ? `${getVehicleIcon(selectedRider.vehicleType)} ${selectedRider.vehicleType}` : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Last Seen</p>
                  <p className="font-bold mt-0.5 text-sm">
                    {fd(selectedRider.lastSeen ?? selectedRider.updatedAt)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Battery</p>
                  {selectedRider.batteryLevel != null ? (() => {
                    const pct = Math.round(selectedRider.batteryLevel * 100);
                    const col = pct > 50 ? "#22c55e" : pct > 20 ? "#f59e0b" : "#ef4444";
                    return (
                      <div className="mt-1 flex items-center gap-1.5">
                        <div className="w-16 h-3 bg-gray-200 rounded-full overflow-hidden">
                          <div style={{ width: `${pct}%`, background: col }} className="h-full rounded-full" />
                        </div>
                        <span className="text-xs font-bold" style={{ color: col }}>{pct}%</span>
                      </div>
                    );
                  })() : <p className="font-bold mt-0.5">—</p>}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Coordinates</p>
                  <p className="font-mono text-xs mt-0.5">{selectedRider.lat.toFixed(5)}, {selectedRider.lng.toFixed(5)}</p>
                </div>
              </div>

              {/* Route playback */}
              {routePoints.length > 0 ? (
                <div className="border-t border-border/40 pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Route className="w-4 h-4 text-indigo-500" />
                      <span className="text-sm font-semibold text-foreground">Route Playback</span>
                      <span className="text-xs text-muted-foreground">({routePoints.length} points)</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {replayPoint ? new Date(replayPoint.createdAt).toLocaleTimeString() : "—"}
                    </div>
                  </div>
                  <Slider
                    value={[sliderVal]}
                    onValueChange={([v]) => setSliderVal(v)}
                    min={0}
                    max={100}
                    step={1}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>{loginPoint ? new Date(loginPoint.createdAt).toLocaleTimeString() : "Login"}</span>
                    <span>{routePoints[routePoints.length - 1] ? new Date(routePoints[routePoints.length - 1]!.createdAt).toLocaleTimeString() : "Now"}</span>
                  </div>
                </div>
              ) : (
                <div className="border-t border-border/40 pt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Route className="w-4 h-4" />
                  No route data for {routeDate}
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
