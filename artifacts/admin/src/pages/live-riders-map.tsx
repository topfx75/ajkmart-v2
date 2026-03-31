import { useState, useEffect, useRef, useCallback } from "react";
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
import { useQuery } from "@tanstack/react-query";
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
  lat: number;
  lng: number;
  updatedAt: string;
  ageSeconds: number;
  isFresh: boolean;
  action?: string | null;
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

/* ── Rider status logic: Green = Online/idle, Red = Busy/Active Order, Grey = Offline ── */
function getRiderStatus(rider: Rider, offlineAfterSec = DEFAULT_OFFLINE_AFTER_SEC): "online" | "offline" | "busy" {
  if (!rider.isOnline || rider.ageSeconds >= offlineAfterSec) return "offline";
  if (rider.action === "on_trip" || rider.action === "delivering") return "busy";
  return "online";
}

/* ── Vehicle type → icon emoji ── */
function getVehicleIcon(vehicleType: string | null): string {
  const v = (vehicleType ?? "").toLowerCase();
  if (v.includes("bike") || v.includes("motorcycle") || v.includes("moto")) return "🏍️";
  if (v.includes("car") || v.includes("taxi"))  return "🚗";
  if (v.includes("rickshaw")) return "🛺";
  if (v.includes("van") || v.includes("daba"))  return "🚐";
  if (v.includes("truck") || v.includes("lori")) return "🚛";
  if (v.includes("service") || v.includes("tool") || v.includes("wrench")) return "🔧";
  return "🏍️";
}

function makeRiderIcon(rider: Rider, status: "online" | "offline" | "busy", isSelected: boolean) {
  /* Color: Green = online, Red = busy/on-trip, Grey = offline */
  const color = status === "online" ? "#22c55e" : status === "busy" ? "#ef4444" : "#9ca3af";
  const size = isSelected ? 40 : 32;
  const emoji = getVehicleIcon(rider.vehicleType);
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;background:${color};border:${isSelected ? "3px" : "2px"} solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-size:${isSelected ? "18px" : "14px"};cursor:pointer;transition:all 0.2s">${emoji}</div>`,
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

function MapAutoCenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current) {
      map.setView([lat, lng], map.getZoom());
      initializedRef.current = true;
    }
  }, [lat, lng]);
  return null;
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
  const [activeTab, setActiveTab] = useState<"map" | "analytics">("map");
  const [sosAlerts, setSosAlerts] = useState<SOSAlert[]>([]);
  const [selectedSOS, setSelectedSOS] = useState<SOSAlert | null>(null);
  const [chatMessages, setChatMessages] = useState<Record<string, Array<{ text: string; ts: string; from: "admin" | "rider" }>>>({});
  const [chatInput, setChatInput] = useState("");
  const socketRef = useRef<Socket | null>(null);

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
      transports: ["polling", "websocket"],
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

  /* Merge WebSocket overrides into the rider list */
  const riders: Rider[] = baseRiders.map(r => {
    const ov = riderOverrides[r.userId];
    if (!ov) return r;
    const ageSeconds = Math.floor((Date.now() - new Date(ov.updatedAt).getTime()) / 1000);
    return {
      ...r,
      lat: ov.lat,
      lng: ov.lng,
      updatedAt: ov.updatedAt,
      action: ov.action ?? r.action,
      ageSeconds,
      isFresh: ageSeconds < offlineAfterSec,
      isOnline: ageSeconds < offlineAfterSec,
    };
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

  const onlineCount = riders.filter(r => getRiderStatus(r, offlineAfterSec) === "online").length;
  const busyCount   = riders.filter(r => getRiderStatus(r, offlineAfterSec) === "busy").length;
  const selectedRider = riders.find(r => r.userId === selectedId) || null;

  /* Icon caches */
  const riderIconCacheRef = useRef<Map<string, ReturnType<typeof makeRiderIcon>>>(new Map());
  const customerIconCacheRef = useRef<Map<string, ReturnType<typeof makeCustomerIcon>>>(new Map());

  const riderIconMap = (() => {
    const result = new Map<string, ReturnType<typeof makeRiderIcon>>();
    for (const rider of riders) {
      const status = getRiderStatus(rider, offlineAfterSec);
      const isSelected = rider.userId === selectedId;
      const cacheKey = `${rider.userId}:${status}:${isSelected ? "1" : "0"}`;
      let icon = riderIconCacheRef.current.get(cacheKey);
      if (!icon) {
        icon = makeRiderIcon(rider, status, isSelected);
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
                    <MapAutoCenter lat={defaultLat} lng={defaultLng} />

                    {/* Rider markers */}
                    {riders.map(rider => {
                      const status = getRiderStatus(rider, offlineAfterSec);
                      return (
                        <Marker
                          key={rider.userId}
                          position={[rider.lat, rider.lng]}
                          icon={riderIconMap.get(rider.userId)!}
                          eventHandlers={{ click: () => setSelectedId(rider.userId) }}
                        >
                          <Popup maxWidth={200}>
                            <div style={{ fontFamily: "sans-serif", minWidth: 160 }}>
                              <p style={{ fontWeight: 700, margin: "0 0 4px" }}>{rider.name}</p>
                              <p style={{ color: "#6b7280", fontSize: 12, margin: 0 }}>
                                {rider.phone || "No phone"}{rider.vehicleType ? ` · ${rider.vehicleType}` : ""}
                              </p>
                              <p style={{ fontSize: 11, margin: "4px 0 0", color: status === "online" ? "#22c55e" : status === "busy" ? "#ef4444" : "#9ca3af" }}>
                                ● {status === "online" ? "Online" : status === "busy" ? "Busy / On Trip" : "Offline"} · {fd(rider.updatedAt)}
                              </p>
                            </div>
                          </Popup>
                        </Marker>
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
              <div className="flex gap-3 px-1 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Online</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Busy</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300 inline-block" /> Offline</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Customer</span>
              </div>

              <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden" style={{ maxHeight: 492, overflow: "auto" }}>
                {isLoading && riders.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Loading riders...</div>
                ) : riders.length === 0 ? (
                  <div className="p-8 text-center">
                    <Users className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No riders tracked yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border/40">
                    {riders.map(rider => {
                      const status = getRiderStatus(rider, offlineAfterSec);
                      return (
                        <button
                          key={rider.userId}
                          onClick={() => setSelectedId(rider.userId === selectedId ? null : rider.userId)}
                          className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left ${
                            rider.userId === selectedId ? "bg-green-50 border-l-4 border-green-500" : ""
                          }`}
                        >
                          <div className="flex-shrink-0">
                            <StatusDot status={status} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-sm text-foreground truncate">{rider.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {getVehicleIcon(rider.vehicleType)} {rider.phone || "No phone"}{rider.vehicleType ? ` · ${rider.vehicleType}` : ""}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
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
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {status === "offline" ? `Last seen ${fd(rider.updatedAt)}` : fd(rider.updatedAt)}
                            </p>
                          </div>
                        </button>
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

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm mb-4">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Status</p>
                  <p className="font-bold mt-0.5 flex items-center gap-1.5">
                    <StatusDot status={getRiderStatus(selectedRider, offlineAfterSec)} />
                    {getRiderStatus(selectedRider, offlineAfterSec) === "busy" ? "Busy / On Trip" : getRiderStatus(selectedRider, offlineAfterSec) === "online" ? "Online" : "Offline"}
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
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Last Update</p>
                  <p className="font-bold mt-0.5">
                    {getRiderStatus(selectedRider, offlineAfterSec) === "offline"
                      ? `Last Seen ${fd(selectedRider.updatedAt)}`
                      : fd(selectedRider.updatedAt)}
                  </p>
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
