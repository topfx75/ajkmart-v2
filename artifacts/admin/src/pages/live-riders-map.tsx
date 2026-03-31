import { useState, useEffect, useRef } from "react";
import { useLiveRiders } from "@/hooks/use-admin";
import { MapPin, Wifi, WifiOff, RefreshCw, Users, Navigation } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const fd = (isoStr: string) => {
  const secs = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
};

function StatusDot({ isOnline, isFresh }: { isOnline: boolean; isFresh: boolean }) {
  if (isOnline && isFresh) return <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block animate-pulse" />;
  if (isOnline) return <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" />;
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
};

function LeafletMap({ riders, selectedId, onSelect }: {
  riders: Rider[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const L = (window as any).L;
    if (!L) {
      setError("Map library not loaded. Check your internet connection.");
      return;
    }

    try {
      const map = L.map(containerRef.current, {
        center: [33.7215, 73.0433],
        zoom: 12,
        zoomControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;
      setMapReady(true);
    } catch (e) {
      setError("Failed to initialize map.");
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markersRef.current.clear();
        setMapReady(false);
      }
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    const L = (window as any).L;
    if (!L) return;

    const currentIds = new Set(riders.map(r => r.userId));

    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    riders.forEach(rider => {
      const color = rider.isOnline && rider.isFresh ? "#22c55e" : rider.isOnline ? "#f59e0b" : "#9ca3af";
      const isSelected = rider.userId === selectedId;

      const svgIcon = L.divIcon({
        html: `
          <div style="
            width: ${isSelected ? 40 : 32}px;
            height: ${isSelected ? 40 : 32}px;
            background: ${color};
            border: ${isSelected ? "3px" : "2px"} solid white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            font-size: ${isSelected ? "18px" : "14px"};
            cursor: pointer;
            transition: all 0.2s;
          ">🏍️</div>
        `,
        className: "",
        iconSize: [isSelected ? 40 : 32, isSelected ? 40 : 32],
        iconAnchor: [isSelected ? 20 : 16, isSelected ? 20 : 16],
      });

      if (markersRef.current.has(rider.userId)) {
        const marker = markersRef.current.get(rider.userId);
        marker.setLatLng([rider.lat, rider.lng]);
        marker.setIcon(svgIcon);
        const vehicleLabel = rider.vehicleType ? ` &bull; ${esc(rider.vehicleType)}` : "";
        marker.getPopup()?.setContent(
          `<div style="font-family:sans-serif;min-width:160px">
            <p style="font-weight:700;margin:0 0 4px">${esc(rider.name)}</p>
            <p style="color:#6b7280;font-size:12px;margin:0">${esc(rider.phone || "No phone")}${vehicleLabel}</p>
            <p style="font-size:11px;margin:4px 0 0;color:${esc(color)}">&#9679; ${rider.isOnline ? "Online" : "Offline"} &middot; ${esc(fd(rider.updatedAt))}</p>
          </div>`
        );
      } else {
        const vehicleLabel = rider.vehicleType ? ` &bull; ${esc(rider.vehicleType)}` : "";
        const marker = L.marker([rider.lat, rider.lng], { icon: svgIcon })
          .addTo(mapRef.current)
          .bindPopup(
            `<div style="font-family:sans-serif;min-width:160px">
              <p style="font-weight:700;margin:0 0 4px">${esc(rider.name)}</p>
              <p style="color:#6b7280;font-size:12px;margin:0">${esc(rider.phone || "No phone")}${vehicleLabel}</p>
              <p style="font-size:11px;margin:4px 0 0;color:${esc(color)}">&#9679; ${rider.isOnline ? "Online" : "Offline"} &middot; ${esc(fd(rider.updatedAt))}</p>
            </div>`,
            { maxWidth: 200 }
          )
          .on("click", () => onSelect(rider.userId));
        markersRef.current.set(rider.userId, marker);
      }
    });
  }, [riders, selectedId, mapReady]);

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100 rounded-2xl">
        <div className="text-center p-8">
          <MapPin className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-600 font-semibold">{error}</p>
          <p className="text-sm text-gray-400 mt-1">Make sure you have internet access</p>
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className="w-full h-full rounded-2xl" style={{ minHeight: 400 }} />;
}

export default function LiveRidersMap() {
  const { data, isLoading, refetch, dataUpdatedAt } = useLiveRiders();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [leafletLoaded, setLeafletLoaded] = useState(!!(window as any).L);
  const [secAgo, setSecAgo] = useState(0);

  useEffect(() => {
    if ((window as any).L) { setLeafletLoaded(true); return; }

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => setLeafletLoaded(true);
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    setSecAgo(0);
    const t = setInterval(() => setSecAgo(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [dataUpdatedAt]);

  const riders: Rider[] = data?.riders || [];
  const onlineCount = riders.filter(r => r.isOnline).length;
  const freshCount  = data?.freshCount ?? 0;
  const selectedRider = riders.find(r => r.userId === selectedId) || null;

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
            <p className="text-muted-foreground text-sm">{riders.length} riders tracked · {onlineCount} online · {freshCount} active (&lt;5 min)</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className={`w-2 h-2 rounded-full ${secAgo < 25 ? "bg-green-500" : "bg-amber-400"} animate-pulse`} />
            {isLoading ? "Refreshing..." : `${secAgo}s ago`}
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading} className="h-9 rounded-xl gap-2">
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4 rounded-2xl border-border/50 shadow-sm text-center">
          <p className="text-2xl font-bold text-foreground">{riders.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Total Tracked</p>
        </Card>
        <Card className="p-4 rounded-2xl border-border/50 shadow-sm text-center bg-green-50/60 border-green-200/60">
          <p className="text-2xl font-bold text-green-700">{onlineCount}</p>
          <p className="text-xs text-green-600 mt-1">Online</p>
        </Card>
        <Card className="p-4 rounded-2xl border-border/50 shadow-sm text-center bg-blue-50/60 border-blue-200/60">
          <p className="text-2xl font-bold text-blue-700">{freshCount}</p>
          <p className="text-xs text-blue-500 mt-1">Active (&lt;5min)</p>
        </Card>
      </div>

      {/* Map + sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Map */}
        <div className="lg:col-span-2">
          <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden" style={{ height: 500 }}>
            {!leafletLoaded ? (
              <div className="w-full h-full flex items-center justify-center bg-gray-50">
                <div className="text-center">
                  <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">Loading map...</p>
                </div>
              </div>
            ) : riders.length === 0 && !isLoading ? (
              <div className="w-full h-full flex items-center justify-center bg-gray-50">
                <div className="text-center p-8">
                  <MapPin className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="font-semibold text-gray-600">No riders on map yet</p>
                  <p className="text-sm text-gray-400 mt-1">Riders appear here when they share their GPS location</p>
                </div>
              </div>
            ) : (
              <LeafletMap riders={riders} selectedId={selectedId} onSelect={setSelectedId} />
            )}
          </Card>
        </div>

        {/* Riders list sidebar */}
        <div className="space-y-2">
          {/* Legend */}
          <div className="flex gap-4 px-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Active</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" /> Online</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300 inline-block" /> Offline</span>
          </div>

          <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden" style={{ maxHeight: 476, overflow: "auto" }}>
            {isLoading && riders.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Loading riders...</div>
            ) : riders.length === 0 ? (
              <div className="p-8 text-center">
                <Users className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No riders tracked yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {riders.map(rider => (
                  <button
                    key={rider.userId}
                    onClick={() => setSelectedId(rider.userId === selectedId ? null : rider.userId)}
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left ${
                      rider.userId === selectedId ? "bg-green-50 border-l-4 border-green-500" : ""
                    }`}
                  >
                    <div className="flex-shrink-0">
                      <StatusDot isOnline={rider.isOnline} isFresh={rider.isFresh} />
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
                          rider.isOnline && rider.isFresh
                            ? "bg-green-100 text-green-700"
                            : rider.isOnline
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {rider.isOnline ? (rider.isFresh ? "Active" : "Online") : "Offline"}
                      </Badge>
                      <p className="text-[10px] text-muted-foreground mt-1">{fd(rider.updatedAt)}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Selected rider detail */}
      {selectedRider && (
        <Card className="rounded-2xl border-border/50 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-lg">🏍️ {selectedRider.name}</h3>
            <button onClick={() => setSelectedId(null)} className="text-xs text-muted-foreground hover:underline">Deselect</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Status</p>
              <p className="font-bold mt-0.5 flex items-center gap-1.5">
                <StatusDot isOnline={selectedRider.isOnline} isFresh={selectedRider.isFresh} />
                {selectedRider.isOnline ? (selectedRider.isFresh ? "Active" : "Online (idle)") : "Offline"}
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
              <p className="font-bold mt-0.5">{fd(selectedRider.updatedAt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Coordinates</p>
              <p className="font-mono text-xs mt-0.5">{selectedRider.lat.toFixed(5)}, {selectedRider.lng.toFixed(5)}</p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
