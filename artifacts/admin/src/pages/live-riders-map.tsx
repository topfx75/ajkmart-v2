import { useState, useEffect, useRef, useCallback } from "react";
import { useLiveRiders, usePlatformSettings, useRiderRoute, useCustomerLocations } from "@/hooks/use-admin";
import { MapPin, RefreshCw, Users, Navigation, Route, Clock, Eye, EyeOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { PLATFORM_DEFAULTS } from "@/lib/platformConfig";
import { io, type Socket } from "socket.io-client";

/* Fallback used only until the first API response provides the server-configured value */
const DEFAULT_OFFLINE_AFTER_SEC = 5 * 60;

const fd = (isoStr: string) => {
  const secs = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
};

function StatusDot({ status }: { status: "online" | "offline" | "on_trip" }) {
  if (status === "online")   return <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block animate-pulse" />;
  if (status === "on_trip")  return <span className="w-2.5 h-2.5 rounded-full bg-orange-400 inline-block animate-pulse" />;
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

function getRiderStatus(rider: Rider, offlineAfterSec = DEFAULT_OFFLINE_AFTER_SEC): "online" | "offline" | "on_trip" {
  /* Treat as offline if GPS is stale (age > server-configured timeout) regardless of DB isOnline flag */
  if (!rider.isOnline || rider.ageSeconds >= offlineAfterSec) return "offline";
  if (rider.action === "on_trip" || rider.action === "delivering") return "on_trip";
  return "online";
}

function makeRiderIcon(status: "online" | "offline" | "on_trip", isSelected: boolean) {
  const color = status === "online" ? "#22c55e" : status === "on_trip" ? "#f97316" : "#9ca3af";
  const size = isSelected ? 40 : 32;
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;background:${color};border:${isSelected ? "3px" : "2px"} solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-size:${isSelected ? "18px" : "14px"};cursor:pointer;transition:all 0.2s">🏍️</div>`,
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
      /* Token goes in auth + header only — NOT in query string to prevent
         it from appearing in HTTP polling URLs and server access logs. */
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
        /* Prune to prevent unbounded growth — keep most recent 500 customers */
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
  /* Use server-configured timeout if available, fall back to default */
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
  /* Also include any socket-only customers not yet in base — immutable concat */
  const mergedCustomerIds = new Set(mergedCustomers.map(c => c.userId));
  const customers: CustomerLoc[] = [
    ...mergedCustomers,
    ...Object.entries(customerOverrides)
      .filter(([uid]) => !mergedCustomerIds.has(uid))
      .map(([uid, ov]) => ({ userId: uid, lat: ov.lat, lng: ov.lng, updatedAt: ov.updatedAt })),
  ];

  const onlineCount  = riders.filter(r => getRiderStatus(r, offlineAfterSec) === "online").length;
  const freshCount   = riders.filter(r => r.isFresh).length;
  const onTripCount  = riders.filter(r => getRiderStatus(r, offlineAfterSec) === "on_trip").length;
  const selectedRider = riders.find(r => r.userId === selectedId) || null;

  /**
   * Stable icon caches keyed by a string of (userId, status, isSelected) or (userId).
   * Using refs means the cache persists across renders regardless of array identity changes,
   * so Leaflet does not recreate DOM nodes on timer-only re-renders (secAgo ticks).
   */
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
        icon = makeRiderIcon(status, isSelected);
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

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-green-100 text-green-600 rounded-xl flex items-center justify-center">
            <Navigation className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Live Riders Map</h1>
            <p className="text-muted-foreground text-sm">{riders.length} riders tracked · {onlineCount} online · {onTripCount} on trip</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
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
        </div>
      </div>

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
        <Card className="p-4 rounded-2xl border-border/50 shadow-sm text-center bg-orange-50/60 border-orange-200/60">
          <p className="text-2xl font-bold text-orange-600">{onTripCount}</p>
          <p className="text-xs text-orange-500 mt-1">On Trip</p>
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
                          <p style={{ fontSize: 11, margin: "4px 0 0", color: status === "online" ? "#22c55e" : status === "on_trip" ? "#f97316" : "#9ca3af" }}>
                            ● {status === "online" ? "Online" : status === "on_trip" ? "On Trip" : "Offline"} · {fd(rider.updatedAt)}
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
                        <p style={{ fontSize: 11, color: "#3b82f6", margin: 0 }}>● Active · {fd(c.updatedAt)}</p>
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
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" /> On Trip</span>
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
                          {rider.phone || "No phone"}{rider.vehicleType ? ` · ${rider.vehicleType}` : ""}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <Badge
                          className={`text-[10px] font-bold ${
                            status === "on_trip"
                              ? "bg-orange-100 text-orange-700"
                              : status === "online"
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {status === "on_trip" ? "On Trip" : status === "online" ? "Online" : "Offline"}
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
            <h3 className="font-bold text-lg">🏍️ {selectedRider.name}</h3>
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
                {getRiderStatus(selectedRider, offlineAfterSec) === "on_trip" ? "On Trip" : getRiderStatus(selectedRider, offlineAfterSec) === "online" ? "Online" : `Offline`}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Phone</p>
              <p className="font-bold mt-0.5">{selectedRider.phone || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Vehicle</p>
              <p className="font-bold mt-0.5">{selectedRider.vehicleType || "—"}</p>
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
    </div>
  );
}
