import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { usePlatformConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { useSocket } from "../lib/socket";
import { tDual } from "@workspace/i18n";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { playRequestSound, unlockAudio, silenceFor, isSilenced, unsilence, getSilenceRemaining, getSilenceMode, setSilenceMode } from "../lib/notificationSound";
import { logRideEvent } from "../lib/rideUtils";
import { enqueue, registerDrainHandler, type QueuedPing } from "../lib/gpsQueue";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  AlertTriangle, MapPin, Pin, Bike, Car, Bus, ShoppingBag,
  ShoppingCart, Pill, Package, Banana, Navigation, Wifi, WifiOff,
  X, Timer, CheckCircle, MessageSquare, ChevronRight,
  TrendingUp, Calendar, Trophy, Radio, Zap, Clock,
  ArrowUpRight, Eye, VolumeX, Volume2, XCircle, Ban, SkipForward,
} from "lucide-react";

function formatCurrency(n: number, currencySymbol = "Rs.") { return `${currencySymbol} ${Math.round(n).toLocaleString()}`; }

function timeAgo(d: string | Date) {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);
  return <span>{time.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}</span>;
}

function RequestAge({ createdAt }: { createdAt: string }) {
  const [label, setLabel] = useState(timeAgo(createdAt));
  useEffect(() => {
    /* Per-second updates for the first 60s; coarsen to every 10s after that */
    const timerRef: { id: ReturnType<typeof setInterval> | null } = { id: null };

    const tick = () => {
      setLabel(timeAgo(createdAt));
      const diffNow = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
      if (diffNow >= 60 && timerRef.id !== null) {
        /* Switch to coarse interval — clear current and restart at 10s */
        clearInterval(timerRef.id);
        timerRef.id = setInterval(() => setLabel(timeAgo(createdAt)), 10000);
      }
    };

    const initialDiff = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
    timerRef.id = setInterval(tick, initialDiff >= 60 ? 10000 : 1000);
    return () => { if (timerRef.id) clearInterval(timerRef.id); };
  }, [createdAt]);
  const diffSec = (Date.now() - new Date(createdAt).getTime()) / 1000;
  const urgent = diffSec > 90;
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${urgent ? "bg-red-100 text-red-600 animate-pulse" : "bg-gray-100 text-gray-500"}`}>
      <Timer size={9}/> {label}
    </span>
  );
}

/* Countdown ring shown on request cards — counts down from ACCEPT_TIMEOUT_SEC.
   After timeout the request fades out naturally (it disappears from the server query). */
const ACCEPT_TIMEOUT_SEC = 90;
function AcceptCountdown({ createdAt, onExpired }: { createdAt: string; onExpired?: () => void }) {
  const [secs, setSecs] = useState(() => {
    const elapsed = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
    return Math.max(0, ACCEPT_TIMEOUT_SEC - elapsed);
  });
  const expiredRef = useRef(false);
  useEffect(() => {
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
      const remaining = Math.max(0, ACCEPT_TIMEOUT_SEC - elapsed);
      setSecs(remaining);
      if (remaining === 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpired?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [createdAt, onExpired]);
  const pct = secs / ACCEPT_TIMEOUT_SEC;
  const r = 14, stroke = 3;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ * (1 - pct);
  const col = secs > 30 ? "#22c55e" : secs > 10 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex-shrink-0 relative flex items-center justify-center" style={{ width: 36, height: 36 }}>
      <svg width={36} height={36} className={secs <= 10 ? "animate-pulse" : ""}>
        <circle cx={18} cy={18} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke}/>
        <circle cx={18} cy={18} r={r} fill="none" stroke={col} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={dashOffset}
          strokeLinecap="round" transform="rotate(-90 18 18)"
          style={{ transition: "stroke-dashoffset 0.9s linear, stroke 0.3s" }}
        />
      </svg>
      <span className="absolute text-[9px] font-extrabold tabular-nums" style={{ color: col }}>{secs}</span>
    </div>
  );
}

function OrderTypeIcon({ type }: { type: string }) {
  if (type === "food")     return <ShoppingBag size={20} className="text-orange-500"/>;
  if (type === "mart")     return <ShoppingCart size={20} className="text-blue-500"/>;
  if (type === "pharmacy") return <Pill size={20} className="text-purple-600"/>;
  if (type === "grocery")  return <Banana size={20} className="text-yellow-500"/>;
  return <Package size={20} className="text-indigo-500"/>;
}

function buildMapsDeepLink(lat: number | null | undefined, lng: number | null | undefined, address?: string | null): string {
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(ua)) return `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`;
    if (/Android/i.test(ua))          return `geo:${lat},${lng}?q=${lat},${lng}`;
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  }
  if (address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  return "#";
}

function RideTypeIcon({ type }: { type: string }) {
  if (type === "car")          return <Car  size={20} className="text-blue-600"/>;
  if (type === "rickshaw")     return <Bike size={20} className="text-yellow-600"/>;
  if (type === "daba")         return <Bus  size={20} className="text-gray-600"/>;
  if (type === "school_shift") return <Bus  size={20} className="text-green-600"/>;
  return <Bike size={20} className="text-green-600"/>;
}

/* ── MiniMapFitter: sets bounds so both markers are visible ── */
function MiniMapFitter({ pickupLat, pickupLng, dropLat, dropLng, hasPick, hasDrop }: {
  pickupLat: number; pickupLng: number; dropLat: number; dropLng: number;
  hasPick: boolean; hasDrop: boolean;
}) {
  const map = useMap();
  useEffect(() => {
    if (hasPick && hasDrop) {
      map.fitBounds([[pickupLat, pickupLng], [dropLat, dropLng]], { padding: [20, 20], maxZoom: 15 });
    } else if (hasPick) {
      map.setView([pickupLat, pickupLng], 14);
    } else if (hasDrop) {
      map.setView([dropLat, dropLng], 14);
    }
  }, [pickupLat, pickupLng, dropLat, dropLng, hasPick, hasDrop]);
  return null;
}

/* ── useMiniMapTileConfig — fetches map provider from /api/maps/config so the
   MiniMap uses the same tile provider the admin has configured (Mapbox, Google, OSM).
   Respects per-app override for the Rider App (appOverrides.rider).
   Defaults to OSM on any error — keeps the map functional even without a network call. ── */
interface MapsConfigPublic {
  provider: string; token: string;
  secondaryProvider?: string; secondaryToken?: string;
  appOverrides?: { rider?: { provider: string; token: string }; [k: string]: any };
}
function useMiniMapTileConfig(): { tileUrl: string; attribution: string } {
  const { data } = useQuery<MapsConfigPublic>({
    queryKey: ["maps-config-public"],
    queryFn: async (): Promise<MapsConfigPublic> => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/maps/config?app=rider`);
      const json = await res.json() as { data?: MapsConfigPublic } & MapsConfigPublic;
      /* /api/maps/config returns the object directly (no { success, data } wrapper) */
      return (json.data ?? json) as MapsConfigPublic;
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  /* Respect per-app rider override if configured, otherwise use global primary */
  const riderOverride = data?.appOverrides?.rider;
  const provider = riderOverride?.provider ?? data?.provider ?? "osm";
  const token    = riderOverride?.token    ?? data?.token    ?? "";

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

/* Mini-map: Leaflet map with pickup (green) and drop (red) markers.
   Lightweight, interactive, and works offline (cached OSM tiles).
   Tile provider is read from platform map config (Mapbox/Google/OSM). */
function MiniMap({ pickupLat, pickupLng, dropLat, dropLng }: {
  pickupLat?: number | null; pickupLng?: number | null;
  dropLat?: number | null; dropLng?: number | null;
}) {
  const hasPick = pickupLat != null && pickupLng != null;
  const hasDrop = dropLat != null && dropLng != null;
  const { tileUrl, attribution } = useMiniMapTileConfig();
  if (!hasPick && !hasDrop) return null;

  const centerLat = hasPick && hasDrop ? (pickupLat! + dropLat!) / 2 : (hasPick ? pickupLat! : dropLat!);
  const centerLng = hasPick && hasDrop ? (pickupLng! + dropLng!) / 2 : (hasPick ? pickupLng! : dropLng!);

  const pickupIcon = L.divIcon({ html: `<div style="width:14px;height:14px;background:#22c55e;border:2.5px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>`, className: "", iconSize: [14, 14], iconAnchor: [7, 7] });
  const dropIcon   = L.divIcon({ html: `<div style="width:14px;height:14px;background:#ef4444;border:2.5px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>`, className: "", iconSize: [14, 14], iconAnchor: [7, 7] });

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
        {hasDrop  && <Marker position={[dropLat!, dropLng!]} icon={dropIcon} />}
        <MiniMapFitter
          pickupLat={pickupLat ?? 0} pickupLng={pickupLng ?? 0}
          dropLat={dropLat ?? 0} dropLng={dropLng ?? 0}
          hasPick={hasPick} hasDrop={hasDrop}
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

const SVC_NAMES: Record<string, string> = {
  bike: "Bike", car: "Car", rickshaw: "Rickshaw", daba: "Daba / Van", school_shift: "School Shift",
};

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded-xl ${className || ""}`} />;
}

function SkeletonHome() {
  return (
    <div className="flex flex-col min-h-screen bg-[#F5F6F8]">
      <div className="bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 px-5 pb-8 rounded-b-[2rem] relative overflow-hidden"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 3.5rem)" }}>
        <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-green-500/[0.04]"/>
        <div className="absolute bottom-10 -left-16 w-56 h-56 rounded-full bg-white/[0.02]"/>
        <div className="relative flex items-center justify-between mb-6">
          <div className="space-y-2">
            <SkeletonBlock className="h-3 w-28 !bg-white/10" />
            <SkeletonBlock className="h-6 w-36 !bg-white/10" />
          </div>
          <SkeletonBlock className="h-10 w-24 rounded-2xl !bg-white/10" />
        </div>
        <SkeletonBlock className="h-20 w-full rounded-2xl !bg-white/[0.06]" />
        <div className="grid grid-cols-4 gap-2 mt-4">
          {[1,2,3,4].map(i => <SkeletonBlock key={i} className="h-[72px] rounded-2xl !bg-white/[0.06]" />)}
        </div>
      </div>
      <div className="px-4 pt-4 space-y-3">
        <SkeletonBlock className="h-14 rounded-3xl" />
        <SkeletonBlock className="h-48 rounded-3xl" />
      </div>
    </div>
  );
}

export default function Home() {
  const { user, refreshUser, loading: authLoading } = useAuth();
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: Parameters<typeof tDual>[0]) => tDual(key, language);
  const currency = config.platform.currencySymbol ?? "Rs.";
  const qc = useQueryClient();
  const [toggling, setToggling] = useState(false);
  const [tabVisible, setTabVisible] = useState(!document.hidden);
  const [toastMsg, setToastMsg] = useState("");
  const [toastType, setToastType] = useState<"success" | "error">("success");
  const [newFlash, setNewFlash] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem("rider_dismissed");
      return saved ? new Set<string>(JSON.parse(saved)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const [silenceOn, setSilenceOn] = useState(getSilenceMode());
  const prevIdsRef = useRef<Set<string>>(new Set());
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasUnseenRequestsRef = useRef(false);
  const [silenced, setSilenced] = useState(isSilenced());
  const [silenceRemaining, setSilenceRemaining] = useState(getSilenceRemaining());
  const [showSilenceMenu, setShowSilenceMenu] = useState(false);

  useEffect(() => {
    const handler = () => unlockAudio();
    document.addEventListener("click", handler, { once: true });
    document.addEventListener("touchstart", handler, { once: true });
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (soundIntervalRef.current) clearInterval(soundIntervalRef.current);
      document.removeEventListener("click", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);

  const { socket: sharedSocket, connected: socketConnected } = useSocket();

  useEffect(() => {
    if (!silenced) return;
    const t = setInterval(() => {
      const rem = getSilenceRemaining();
      setSilenceRemaining(rem);
      if (rem <= 0) { setSilenced(false); setShowSilenceMenu(false); }
    }, 1000);
    return () => clearInterval(t);
  }, [silenced]);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg(msg);
    setToastType(type);
    toastTimerRef.current = setTimeout(() => setToastMsg(""), 3000);
  };

  const [optimisticOnline, setOptimisticOnline] = useState<boolean | null>(null);
  const effectiveOnline = optimisticOnline !== null ? optimisticOnline : !!user?.isOnline;

  /* isMountedRef prevents state updates after the component unmounts mid-request
     (e.g. when the rider navigates away while the toggle API call is in-flight). */
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  /* Debounce ref: tracks the timestamp of the most recent toggle so that rapid
     consecutive taps within TOGGLE_DEBOUNCE_MS are silently ignored instead of
     queuing conflicting online/offline API calls. */
  const TOGGLE_DEBOUNCE_MS = 1000;
  const lastToggleRef = useRef<number>(0);

  const [showOfflineConfirm, setShowOfflineConfirm] = useState(false);
  const [zoneWarning, setZoneWarning] = useState<string | null>(null);

  const doActualToggle = async () => {
    const now = Date.now();
    lastToggleRef.current = now;
    setToggling(true);
    const newStatus = !effectiveOnline;
    setOptimisticOnline(newStatus);
    let succeeded = false;
    try {
      const result = await api.setOnline(newStatus);
      if (!isMountedRef.current) return;
      if (result?.serviceZoneWarning) {
        setZoneWarning(result.serviceZoneWarning);
      } else {
        setZoneWarning(null);
      }
      await refreshUser().catch(() => {});
      if (!isMountedRef.current) return;
      succeeded = true;
      showToast(newStatus ? T("youAreNowOnline") : T("youAreNowOffline"), "success");
    } catch (e: unknown) {
      if (!isMountedRef.current) return;
      setOptimisticOnline(!newStatus);
      showToast(e instanceof Error ? e.message : T("somethingWentWrong"), "error");
    } finally {
      if (isMountedRef.current) {
        if (succeeded) setOptimisticOnline(null);
        setToggling(false);
      }
    }
  };

  const toggleOnline = async () => {
    const now = Date.now();
    /* Debounce: reject if a toggle fired within the last second */
    if (toggling || now - lastToggleRef.current < TOGGLE_DEBOUNCE_MS) return;
    lastToggleRef.current = now;

    if (effectiveOnline && totalRequests > 0) {
      setShowOfflineConfirm(true);
      return;
    }

    await doActualToggle();
  };

  const { data: earningsData } = useQuery({
    queryKey: ["rider-earnings"],
    queryFn: () => api.getEarnings(),
    refetchInterval: tabVisible ? 60000 : false,
    enabled: effectiveOnline && tabVisible,
  });

  const { data: activeData } = useQuery({
    queryKey: ["rider-active"],
    queryFn: () => api.getActive(),
    refetchInterval: tabVisible ? 8000 : false,
    enabled: effectiveOnline && tabVisible,
  });
  const hasActiveTask = !!(activeData?.order || activeData?.ride);

  const { data: requestsData } = useQuery({
    queryKey: ["rider-requests"],
    queryFn: () => api.getRequests(),
    refetchInterval: tabVisible ? (user?.isOnline ? 12000 : 60000) : false,
    enabled: effectiveOnline && tabVisible,
  });

  const { data: cancelStatsData } = useQuery({
    queryKey: ["rider-cancel-stats"],
    queryFn: () => api.getCancelStats(),
    refetchInterval: tabVisible ? 120000 : false,
    staleTime: 60000,
  });

  const { data: ignoreStatsData } = useQuery({
    queryKey: ["rider-ignore-stats"],
    queryFn: () => api.getIgnoreStats(),
    refetchInterval: tabVisible ? 120000 : false,
    staleTime: 60000,
  });

  const allOrders: any[] = requestsData?.orders || [];
  const allRides:  any[] = requestsData?.rides  || [];

  useEffect(() => {
    if (!requestsData) return;
    const serverIds = new Set<string>([
      ...allOrders.map((o: any) => o.id),
      ...allRides.map((r: any) => r.id),
    ]);
    setDismissed(prev => {
      const next = new Set([...prev].filter(id => serverIds.has(id)));
      if (next.size === prev.size) return prev;
      try { sessionStorage.setItem("rider_dismissed", JSON.stringify([...next])); } catch {}
      return next;
    });
  }, [requestsData]);

  const currentIdsSig = [...allOrders.map((o: any) => o.id), ...allRides.map((r: any) => r.id)].sort().join(",");
  useEffect(() => {
    const currentIds = new Set<string>(currentIdsSig.split(",").filter(Boolean));
    const prevIds = prevIdsRef.current;
    let hasNew = false;
    currentIds.forEach(id => { if (!prevIds.has(id)) hasNew = true; });
    if (hasNew && currentIds.size > 0) {
      setNewFlash(true);
      setTimeout(() => setNewFlash(false), 2500);
      playRequestSound();
      hasUnseenRequestsRef.current = true;
      if (soundIntervalRef.current) clearInterval(soundIntervalRef.current);
      soundIntervalRef.current = setInterval(() => {
        if (hasUnseenRequestsRef.current && !getSilenceMode() && !isSilenced() && !document.hidden) playRequestSound();
      }, 8000);
    }
    if (currentIds.size === 0) {
      hasUnseenRequestsRef.current = false;
      if (soundIntervalRef.current) { clearInterval(soundIntervalRef.current); soundIntervalRef.current = null; }
    }
    prevIdsRef.current = currentIds;
    return () => {
      if (soundIntervalRef.current) { clearInterval(soundIntervalRef.current); soundIntervalRef.current = null; }
    };
  }, [currentIdsSig]);

  useEffect(() => {
    const handler = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  /* Wake Lock: keep screen awake while the rider is online so GPS and socket
     stay alive in the foreground. Re-acquire whenever the tab becomes visible
     again (covers both release-on-hide and cases where no release event fires).
     Released when going offline or unmounting. */
  useEffect(() => {
    if (!effectiveOnline || !tabVisible) return;
    if (!('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        if (cancelled || document.hidden) return;
        sentinel = await (navigator as Navigator & { wakeLock: { request(type: string): Promise<WakeLockSentinel> } }).wakeLock.request('screen');
      } catch { /* unsupported or permission denied — fail silently */ }
    };

    acquire();

    return () => {
      cancelled = true;
      sentinel?.release().catch(() => {});
    };
  }, [effectiveOnline, tabVisible]);

  /* Clear dismissed set when rider logs out so stale entries don't persist */
  useEffect(() => {
    const handleLogout = () => {
      setDismissed(new Set());
      try { sessionStorage.removeItem("rider_dismissed"); } catch {}
    };
    window.addEventListener("ajkmart:logout", handleLogout);
    return () => window.removeEventListener("ajkmart:logout", handleLogout);
  }, []);

  useEffect(() => {
    if (tabVisible) {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      qc.invalidateQueries({ queryKey: ["rider-active"] });
    }
  }, [tabVisible]);

  const [gpsWarning, setGpsWarning] = useState<string | null>(null);
  const gpsWarningRef = useRef<string | null>(null);

  const setGpsWarningWithRef = (val: string | null) => {
    gpsWarningRef.current = val;
    setGpsWarning(val);
  };

  const batteryRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (typeof navigator !== "undefined" && "getBattery" in navigator) {
      (navigator as any).getBattery().then((batt: any) => {
        batteryRef.current = Math.round(batt.level * 100);
        batt.addEventListener("levelchange", () => {
          batteryRef.current = Math.round(batt.level * 100);
        });
      }).catch(() => {});
    }
  }, []);

  const socketRef = useRef(sharedSocket);
  socketRef.current = sharedSocket;

  useEffect(() => {
    if (!sharedSocket) return;
    const handleNewRequest = () => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
    };
    sharedSocket.on("rider:new-request", handleNewRequest);
    sharedSocket.on("new:request", handleNewRequest);
    return () => {
      sharedSocket.off("rider:new-request", handleNewRequest);
      sharedSocket.off("new:request", handleNewRequest);
    };
  }, [sharedSocket]);

  useEffect(() => {
    if (!user?.isOnline || hasActiveTask || !user?.id) return;
    if (!navigator?.geolocation) return;

    let lastSentTime = 0;
    let lastLat: number | null = null;
    let lastLng: number | null = null;
    const IDLE_INTERVAL_MS = 5 * 1000;
    const MIN_DISTANCE_METERS = 25;

    function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
      const R = 6371000;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /* Battery level is tracked by the outer batteryRef useRef — no need to
       redeclare here. Using batteryRef.current in the location payload below
       reads the current value set by the outer battery effect. */

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        const { latitude, longitude, accuracy, speed, heading } = pos.coords;

        /* Detect client-side mock GPS: accuracy === 0 is impossible with real hardware sensors.
           Suppress the ping entirely — no spoofed coordinates are forwarded to the server. */
        const isMockGps = accuracy !== null && accuracy === 0;
        if (isMockGps) {
          setGpsWarningWithRef("Suspicious GPS accuracy detected. Please disable mock location apps.");
          return;
        }

        /* Throttle non-spoof pings to prevent unnecessary API spam.
           Send if moved enough OR idle keep-alive interval passed. */
        const timeSinceLast = now - lastSentTime;
        if (timeSinceLast < 1000) return; /* hard 1s rate limit */
        if (lastLat !== null && lastLng !== null) {
          const dist = haversineMeters(lastLat, lastLng, latitude, longitude);
          if (dist < MIN_DISTANCE_METERS && timeSinceLast < IDLE_INTERVAL_MS) return;
        } else {
          if (timeSinceLast < IDLE_INTERVAL_MS) return;
        }
        lastSentTime = now;
        lastLat = latitude;
        lastLng = longitude;
        const locationData = {
          latitude,
          longitude,
          accuracy:     accuracy ?? undefined,
          speed:        speed ?? undefined,
          heading:      heading ?? undefined,
          batteryLevel: batteryRef.current,
        };
        const queuedPing = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          timestamp: new Date().toISOString(),
          ...locationData,
        };

        if (!navigator.onLine) {
          /* Queue ping for later when offline */
          enqueue(queuedPing).catch(() => {});
          return;
        }

        api.updateLocation(locationData).then(() => {
          if (gpsWarningRef.current) setGpsWarningWithRef(null);
        }).catch((err: Error) => {
          const msg = err.message || "";
          const isSpoofError = msg.toLowerCase().includes("spoof") || msg.toLowerCase().includes("mock");
          if (isSpoofError) {
            setGpsWarningWithRef(`GPS Spoof Detected: ${msg}`);
          } else {
            /* Enqueue for batch replay on any fetch failure, not just when already offline */
            enqueue(queuedPing).catch(() => {});
            setGpsWarningWithRef(T("gpsLocationError"));
          }
        });
      },
      () => {
        setGpsWarningWithRef(T("gpsNotAvailable"));
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [user?.isOnline, hasActiveTask, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const unregister = registerDrainHandler(async (pings: QueuedPing[]) => {
      await api.batchLocation(pings.map(p => ({
        timestamp: p.timestamp,
        latitude: p.latitude,
        longitude: p.longitude,
        accuracy: p.accuracy,
        speed: p.speed,
        heading: p.heading,
        batteryLevel: p.batteryLevel,
        mockProvider: p.mockProvider,
        action: p.action,
      })));
    });
    return unregister;
  }, [user?.id]);

  /* Heartbeat is managed globally in App.tsx so it runs on all pages. */

  const orders = allOrders.filter((o: any) => !dismissed.has(o.id));
  const rides  = allRides.filter((r: any) => !dismissed.has(r.id));
  const totalRequests = orders.length + rides.length;

  const dismiss = (id: string) => setDismissed(prev => {
    const next = new Set([...prev, id]);
    try { sessionStorage.setItem("rider_dismissed", JSON.stringify([...next])); } catch {}
    /* Stop the notification sound if all server-side requests are now dismissed */
    const serverIds = new Set<string>([
      ...allOrders.map((o: any) => o.id),
      ...allRides.map((r: any) => r.id),
    ]);
    const remainingVisible = [...serverIds].filter(sid => !next.has(sid));
    if (remainingVisible.length === 0) {
      hasUnseenRequestsRef.current = false;
      if (soundIntervalRef.current) { clearInterval(soundIntervalRef.current); soundIntervalRef.current = null; }
    }
    return next;
  });

  const stopRequestSound = () => {
    hasUnseenRequestsRef.current = false;
    if (soundIntervalRef.current) { clearInterval(soundIntervalRef.current); soundIntervalRef.current = null; }
  };

  const acceptOrderMut = useMutation({
    mutationFn: (id: string) => api.acceptOrder(id),
    onSuccess: (_, id) => {
      stopRequestSound();
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      qc.invalidateQueries({ queryKey: ["rider-active"] });
      showToast("Order accepted! Check Active tab.", "success");
    },
    onError: (e: any, id) => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      if (e?.status === 409 || /already taken|already accepted/i.test(e?.message || "")) {
        dismiss(id);
        showToast("This order was already accepted by another rider.", "error");
      } else {
        showToast(e.message || "Could not accept order. Please try again.", "error");
      }
    },
  });

  const rejectOrderMut = useMutation({
    mutationFn: (id: string) => api.rejectOrder(id),
    onSuccess: (_, id) => {
      dismiss(id);
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      showToast("Order rejected.", "success");
    },
    onError: (e: any) => {
      showToast(e.message || "Could not reject order", "error");
    },
  });

  const acceptRideMut = useMutation({
    mutationFn: (id: string) => api.acceptRide(id),
    onSuccess: (_, id) => {
      stopRequestSound();
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      qc.invalidateQueries({ queryKey: ["rider-active"] });
      logRideEvent(id, "accepted", (msg, isErr) => showToast(msg, isErr ? "error" : "success"));
      showToast("Ride accepted! Check Active tab.", "success");
    },
    onError: (e: any, id) => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      if (e?.status === 409 || /already taken|already accepted/i.test(e?.message || "")) {
        dismiss(id);
        showToast("This ride was already accepted by another rider.", "error");
      } else {
        showToast(e.message || "Could not accept ride. Please try again.", "error");
      }
    },
  });

  const [counterInputs, setCounterInputs] = useState<Record<string, string>>({});
  const [showCounter,   setShowCounter]   = useState<Record<string, boolean>>({});
  const [counterErrors, setCounterErrors] = useState<Record<string, string>>({});

  const counterRideMut = useMutation({
    mutationFn: ({ id, counterFare }: { id: string; counterFare: number }) =>
      api.counterRide(id, { counterFare }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      setCounterInputs(prev => ({ ...prev, [vars.id]: "" }));
      setShowCounter(prev => ({ ...prev, [vars.id]: false }));
      showToast("Counter offer submitted!", "success");
    },
    onError: (e: any) => showToast(e.message || "Counter offer failed", "error"),
  });

  const rejectOfferMut = useMutation({
    mutationFn: (id: string) => api.rejectOffer(id),
    onSuccess: (_, id) => {
      dismiss(id);
      showToast("Ride skipped.", "success");
    },
    onError: (e: any) => showToast(e.message, "error"),
  });

  const ignoreRideMut = useMutation({
    mutationFn: (id: string) => api.ignoreRide(id),
    onSuccess: (data: any, id) => {
      dismiss(id);
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      const p = data?.ignorePenalty ?? data;
      if (p?.penaltyApplied > 0) {
        showToast(`Ignored — ${currency} ${p.penaltyApplied} penalty deducted!${p.restricted ? " Account restricted." : ""}`, "error");
      } else {
        showToast(`Ride ignored (${p?.dailyIgnores || "?"} today).`, "success");
      }
    },
    onError: (e: any) => showToast(e.message || "Ignore failed", "error"),
  });

  const toggleSilence = () => {
    const next = !getSilenceMode();
    setSilenceMode(next);
    setSilenceOn(next);
    showToast(next ? "Silence mode ON — no alert sounds" : "Silence mode OFF — sounds enabled", "success");
  };

  const getDeliveryEarn = (type: string) => {
    const df = config.deliveryFee;
    let fee: number;
    if (typeof df === "number") {
      fee = df;
    } else if (df && typeof df === "object") {
      const raw = (df as Record<string, unknown>)[type] ?? (df as Record<string, unknown>).mart ?? 0;
      fee = typeof raw === "number" ? raw : parseFloat(String(raw)) || 0;
    } else {
      fee = parseFloat(String(df)) || 0;
    }
    return fee * (config.finance.riderEarningPct / 100);
  };

  if (authLoading) return <SkeletonHome />;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return T("goodMorning");
    if (h < 17) return T("goodAfternoon");
    return T("goodEvening");
  })();

  return (
    <div className="flex flex-col min-h-screen bg-[#F5F6F8] animate-[fadeIn_0.3s_ease-out]">

      {newFlash && (
        <div className="fixed inset-0 z-50 pointer-events-none">
          <div className="absolute inset-0 border-[6px] border-green-400 rounded-none animate-ping opacity-50"/>
          <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white font-extrabold text-sm px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 animate-bounce">
            <span className="w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse"/>
            New Request Available!
          </div>
        </div>
      )}

      {!socketConnected && effectiveOnline && (
        <div className="fixed top-0 left-0 right-0 z-40 bg-red-600 text-white text-xs font-bold text-center py-1.5 flex items-center justify-center gap-1.5 shadow-lg animate-pulse"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 6px)" }}>
          <WifiOff size={13}/> {T("connectionLost")}
        </div>
      )}

      {zoneWarning && effectiveOnline && (
        <div className="fixed top-0 left-0 right-0 z-[39] bg-amber-500 text-white text-xs font-bold text-center py-1.5 flex items-center justify-center gap-1.5 shadow-lg"
          style={{ paddingTop: (!socketConnected ? "calc(env(safe-area-inset-top, 0px) + 30px)" : "calc(env(safe-area-inset-top, 0px) + 6px)") }}>
          <MapPin size={13}/> {zoneWarning}
          <button onClick={() => setZoneWarning(null)} className="ml-2 bg-white/20 rounded-full p-0.5"><X size={11}/></button>
        </div>
      )}

      <div className="bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 text-white px-5 pb-8 rounded-b-[2rem] relative overflow-hidden"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 3.5rem)" }}>
        <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-green-500/[0.04]"/>
        <div className="absolute bottom-10 -left-16 w-56 h-56 rounded-full bg-white/[0.02]"/>
        <div className="absolute top-1/2 right-1/4 w-32 h-32 rounded-full bg-white/[0.015]"/>

        <div className="relative">
          <div className="flex items-start justify-between mb-5">
            <div>
              <p className="text-white/40 text-[11px] font-semibold tracking-widest uppercase flex items-center gap-1.5 mb-1">
                <Clock size={11}/> <LiveClock/> · AJKMart Rider
              </p>
              <h1 className="text-[22px] font-extrabold tracking-tight leading-tight">
                {greeting}, {user?.name?.split(" ")[0] || "Rider"} 👋
              </h1>
            </div>
            <Link href="/wallet" className="flex flex-col items-end">
              <div className="bg-white/[0.06] backdrop-blur-sm border border-white/[0.06] rounded-2xl px-3.5 py-2 text-right">
                <p className="text-white/40 text-[9px] font-bold uppercase tracking-wider">{T("wallet")}</p>
                <p className="font-extrabold text-lg leading-tight">{formatCurrency(Number(user?.walletBalance) || 0, currency)}</p>
              </div>
            </Link>
          </div>

          <div className={`rounded-2xl p-4 transition-all duration-300 border backdrop-blur-sm ${effectiveOnline ? "bg-white/[0.08] border-green-500/20" : "bg-white/[0.04] border-white/[0.06]"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${effectiveOnline ? "bg-green-500/15" : "bg-white/[0.06]"}`}>
                  {effectiveOnline
                    ? <Zap size={22} className="text-green-400"/>
                    : <Wifi size={22} className="text-white/40"/>
                  }
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${effectiveOnline ? "bg-green-400 animate-pulse shadow-lg shadow-green-400/50" : "bg-gray-500"}`} />
                    <p className="font-extrabold text-lg tracking-tight">{effectiveOnline ? T("online") : T("offline")}</p>
                  </div>
                  <p className="text-white/40 text-xs mt-0.5">
                    {effectiveOnline ? T("acceptingOrders") : T("tapToStart")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={toggleSilence}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl transition-all ${silenceOn ? "bg-red-500/20 text-red-400 border border-red-500/20" : "bg-white/10 text-white/40 border border-white/10"}`}
                  title={silenceOn ? "Unmute sounds" : "Mute sounds"}>
                  {silenceOn ? <VolumeX size={15}/> : <Volume2 size={15}/>}
                  <span className="text-[10px] font-bold leading-none">{silenceOn ? "Sound Off" : "Sound"}</span>
                </button>
                <button onClick={toggleOnline} disabled={toggling}
                  className={`w-[56px] h-[30px] rounded-full relative transition-all duration-300 shadow-inner ${effectiveOnline ? "bg-green-500 shadow-green-500/30" : "bg-white/20"} ${toggling ? "opacity-50 scale-95" : "active:scale-95"}`}>
                  <div className={`w-[24px] h-[24px] bg-white rounded-full absolute top-[3px] shadow-md transition-all duration-300 ${effectiveOnline ? "left-[29px]" : "left-[3px]"}`} />
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <button onClick={() => setShowSilenceMenu(!showSilenceMenu)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border ${silenced ? "bg-red-500/15 border-red-500/30 text-red-400" : "bg-white/[0.06] border-white/[0.06] text-white/50 hover:text-white/70"}`}>
              {silenced ? <VolumeX size={13}/> : <Volume2 size={13}/>}
              {silenced ? `Muted ${Math.ceil(silenceRemaining / 60)}m` : "Sound"}
            </button>
            {showSilenceMenu && (
              <div className="flex items-center gap-1.5 animate-[slideUp_0.2s_ease-out]">
                {silenced ? (
                  <button onClick={() => { unsilence(); setSilenced(false); setShowSilenceMenu(false); showToast("Sound unmuted", "success"); }}
                    className="bg-green-500/20 border border-green-500/30 text-green-400 text-[10px] font-bold px-2.5 py-1.5 rounded-lg">
                    Unmute
                  </button>
                ) : (
                  <>
                    {[15, 30, 60].map(m => (
                      <button key={m} onClick={() => { silenceFor(m); setSilenced(true); setSilenceRemaining(m * 60); setShowSilenceMenu(false); showToast(`Sound muted for ${m}min`, "success"); }}
                        className="bg-white/[0.08] border border-white/[0.08] text-white/60 text-[10px] font-bold px-2.5 py-1.5 rounded-lg hover:bg-white/[0.12] transition-colors">
                        {m}m
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-4 gap-2 mt-3">
            {[
              { icon: <Package size={15} className="text-indigo-300"/>, label: "Today",  value: String(user?.stats?.deliveriesToday || 0), sub: "deliveries" },
              { icon: <TrendingUp size={15} className="text-green-300"/>, label: "Earned", value: formatCurrency(user?.stats?.earningsToday || 0, currency), sub: "today" },
              { icon: <Calendar size={15} className="text-blue-300"/>, label: "Week",   value: formatCurrency(earningsData?.week?.earnings || 0, currency), sub: "earnings" },
              { icon: <Trophy size={15} className="text-amber-300"/>, label: "Total",  value: String(user?.stats?.totalDeliveries || 0), sub: "lifetime" },
            ].map((s, i) => (
              <div key={s.label} className="bg-white/[0.06] backdrop-blur-sm rounded-2xl p-2.5 text-center border border-white/[0.06] animate-[slideUp_0.3s_ease-out]"
                style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}>
                <div className="flex justify-center mb-1.5">
                  <div className="w-7 h-7 rounded-xl bg-white/[0.06] flex items-center justify-center">
                    {s.icon}
                  </div>
                </div>
                <p className="text-[13px] font-extrabold leading-tight text-white">{s.value}</p>
                <p className="text-[9px] text-white/30 mt-0.5 font-semibold uppercase tracking-wider">{s.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-3 relative z-10">

        {gpsWarning && (
          <div className="bg-amber-50 border border-amber-200 rounded-3xl px-4 py-3 flex items-start gap-3 shadow-sm animate-[slideUp_0.2s_ease-out]">
            <div className="w-8 h-8 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={16} className="text-amber-500"/>
            </div>
            <p className="text-xs font-bold text-amber-700 flex-1 leading-relaxed pt-1">{gpsWarning}</p>
            <button onClick={() => setGpsWarning(null)} className="text-amber-400 hover:text-amber-600 p-1 rounded-lg hover:bg-amber-100 transition-colors"><X size={14}/></button>
          </div>
        )}

        {user?.isRestricted && (
          <div className="bg-red-50 border-2 border-red-300 rounded-3xl px-4 py-3.5 flex items-start gap-3 shadow-sm animate-[slideUp_0.2s_ease-out]">
            <div className="w-10 h-10 bg-red-100 rounded-2xl flex items-center justify-center flex-shrink-0">
              <Ban size={18} className="text-red-500"/>
            </div>
            <div className="flex-1">
              <p className="text-sm font-extrabold text-red-800">Account Restricted</p>
              <p className="text-xs text-red-600 mt-0.5 leading-relaxed">
                Your account has been restricted due to excessive cancellations or ignores. You cannot accept new rides. Contact support to resolve.
              </p>
            </div>
          </div>
        )}

        {config.content.riderNotice && !dismissed.has("rider-notice") && (
          <div className="bg-blue-50 border border-blue-200 rounded-3xl px-4 py-3 flex items-start gap-3 shadow-sm">
            <div className="w-8 h-8 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Pin size={14} className="text-blue-500"/>
            </div>
            <p className="text-sm text-blue-700 font-medium leading-relaxed flex-1 pt-0.5">{config.content.riderNotice}</p>
            <button
              onClick={() => setDismissed(prev => {
                const next = new Set(prev);
                next.add("rider-notice");
                try { sessionStorage.setItem("rider_dismissed", JSON.stringify([...next])); } catch {}
                return next;
              })}
              className="text-blue-400 hover:text-blue-600 flex-shrink-0 mt-0.5">
              <X size={14}/>
            </button>
          </div>
        )}

        {cancelStatsData && cancelStatsData.dailyCancels > 0 && (() => {
          const atRisk = cancelStatsData.remaining <= 1;
          const cancelRate: number | null = cancelStatsData.cancelRate ?? null;
          return (
            <div className={`rounded-3xl px-4 py-3.5 shadow-sm border ${atRisk ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${atRisk ? "bg-red-100" : "bg-amber-100"}`}>
                  <XCircle size={18} className={atRisk ? "text-red-500" : "text-amber-500"}/>
                </div>
                <div className="flex-1">
                  <p className={`text-xs font-extrabold ${atRisk ? "text-red-800" : "text-amber-800"}`}>
                    {cancelStatsData.dailyCancels} cancellation{cancelStatsData.dailyCancels !== 1 ? "s" : ""} today
                    {cancelStatsData.remaining === 0 ? " — Limit Reached!" : cancelStatsData.remaining === 1 ? " — 1 left before penalty!" : ""}
                  </p>
                  {cancelStatsData.dailyLimit != null && (
                    <p className="text-[10px] text-amber-600 mt-0.5 font-medium">
                      Limit: {cancelStatsData.dailyLimit}/day · {cancelStatsData.remaining} remaining
                      {cancelStatsData.penaltyAmount > 0 && ` · ${currency} ${Math.round(cancelStatsData.penaltyAmount)} penalty per excess`}
                    </p>
                  )}
                </div>
              </div>
              {cancelRate != null && (
                <div className="mt-2.5 flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5 bg-white/70 rounded-xl px-2.5 py-1.5 border border-amber-200/60">
                    <span className="text-[10px] text-gray-500 font-semibold">Cancel rate</span>
                    <span className={`text-[10px] font-extrabold ${cancelRate > 20 ? "text-red-600" : "text-amber-700"}`}>{Math.round(cancelRate)}%</span>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {ignoreStatsData && ignoreStatsData.dailyIgnores > 0 && (() => {
          const atRisk = ignoreStatsData.remaining <= 1;
          return (
            <div className={`rounded-3xl px-4 py-3.5 shadow-sm border ${atRisk ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${atRisk ? "bg-red-100" : "bg-amber-100"}`}>
                  <SkipForward size={18} className={atRisk ? "text-red-500" : "text-amber-500"}/>
                </div>
                <div className="flex-1">
                  <p className={`text-xs font-extrabold ${atRisk ? "text-red-800" : "text-amber-800"}`}>
                    {ignoreStatsData.dailyIgnores} request{ignoreStatsData.dailyIgnores !== 1 ? "s" : ""} ignored today
                    {ignoreStatsData.remaining === 0 ? " — Limit Reached!" : ignoreStatsData.remaining === 1 ? " — 1 left before penalty!" : ""}
                  </p>
                  {ignoreStatsData.dailyLimit != null && (
                    <p className="text-[10px] text-amber-600 mt-0.5 font-medium">
                      Limit: {ignoreStatsData.dailyLimit}/day · {ignoreStatsData.remaining} remaining
                      {ignoreStatsData.penaltyAmount > 0 && ` · ${currency} ${Math.round(ignoreStatsData.penaltyAmount)} penalty per excess`}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {(() => {
          const minBal  = config.rider?.minBalance ?? 0;
          const curBal  = Number(user?.walletBalance) || 0;
          if (minBal <= 0 || curBal >= minBal) return null;
          const shortfall = minBal - curBal;
          return (
            <Link href="/wallet">
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-300 rounded-3xl px-4 py-3.5 flex items-start gap-3 cursor-pointer active:scale-[0.98] transition-transform shadow-sm">
                <div className="w-10 h-10 bg-amber-100 rounded-2xl flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={18} className="text-amber-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-extrabold text-amber-800">Low Wallet Balance</p>
                  <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
                    Minimum <strong>{currency} {Math.round(minBal)}</strong> required for cash orders.
                    Your balance: <strong>{currency} {Math.round(curBal)}</strong>.
                    {shortfall > 0 && <> Need {currency} {Math.round(shortfall)} more.</>}
                  </p>
                  <p className="text-[10px] text-amber-600 mt-1.5 font-bold flex items-center gap-1">
                    Tap to deposit <ArrowUpRight size={10}/>
                  </p>
                </div>
              </div>
            </Link>
          );
        })()}

        {config.content.trackerBannerEnabled && hasActiveTask && config.content.trackerBannerPosition === "top" && (
          <Link href="/active"
            className="block bg-gradient-to-r from-green-500 to-emerald-600 rounded-3xl px-4 py-3.5 shadow-lg shadow-green-200 active:scale-[0.98] transition-transform animate-[slideUp_0.3s_ease-out]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center flex-shrink-0">
                <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-extrabold text-white tracking-tight">
                  {activeData?.order ? "Active Delivery in Progress" : "Active Ride in Progress"}
                </p>
                <p className="text-xs text-white/70 mt-0.5 truncate">
                  {activeData?.order
                    ? `Order #${activeData.order.id?.slice(-6).toUpperCase()} — ${activeData.order.deliveryAddress || "Customer"}`
                    : `Ride → ${activeData?.ride?.dropAddress || "Drop location"}`}
                </p>
              </div>
              <div className="bg-white/20 backdrop-blur-sm text-white font-extrabold text-xs px-3 py-2 rounded-xl flex-shrink-0 flex items-center gap-1">
                Track <ChevronRight size={12}/>
              </div>
            </div>
          </Link>
        )}

        {user?.isOnline ? (
          <>
            {hasActiveTask && !config.content.trackerBannerEnabled && (
              <Link href="/active"
                className="block bg-gradient-to-r from-amber-50 to-yellow-50 border-2 border-amber-400 rounded-3xl px-4 py-3.5 shadow-sm active:scale-[0.98] transition-transform animate-[slideUp_0.3s_ease-out]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-amber-100 rounded-2xl flex items-center justify-center flex-shrink-0">
                    <div className="w-3 h-3 bg-amber-500 rounded-full animate-pulse" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-extrabold text-amber-800 tracking-tight">
                      {activeData?.order ? "Active Delivery in Progress" : "Active Ride in Progress"}
                    </p>
                    <p className="text-xs text-amber-600 mt-0.5 truncate">
                      {activeData?.order
                        ? `Order #${activeData.order.id?.slice(-6).toUpperCase()} — ${activeData.order.deliveryAddress || "Customer"}`
                        : `Ride → ${activeData?.ride?.dropAddress || "Drop location"}`}
                    </p>
                  </div>
                  <div className="bg-amber-200/60 text-amber-700 font-extrabold text-xs px-3 py-2 rounded-xl flex-shrink-0 flex items-center gap-1">
                    Go <ChevronRight size={12}/>
                  </div>
                </div>
              </Link>
            )}

            <div className={`rounded-3xl shadow-sm overflow-hidden transition-all ${newFlash ? "ring-4 ring-green-400 ring-offset-2" : ""}`}>
              <div className={`px-4 py-3.5 flex items-center justify-between ${totalRequests > 0 ? "bg-gradient-to-r from-orange-500 via-orange-500 to-amber-500" : "bg-gray-900"}`}>
                <div className="flex items-center gap-2.5">
                  {totalRequests > 0 ? (
                    <div className="w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center">
                      <Zap size={14} className="text-white"/>
                    </div>
                  ) : (
                    <div className="w-7 h-7 bg-white/10 rounded-lg flex items-center justify-center">
                      <Radio size={14} className="text-white/70"/>
                    </div>
                  )}
                  <div>
                    <p className="font-extrabold text-white text-sm tracking-tight">
                      {totalRequests > 0
                        ? `${totalRequests} Request${totalRequests > 1 ? "s" : ""} Available`
                        : T("listeningForRequests")}
                    </p>
                    {totalRequests > 0 && (
                      <p className="text-white/60 text-[10px] font-medium">Tap to accept</p>
                    )}
                  </div>
                </div>
                {totalRequests > 0 && (
                  <span className="text-white/90 text-[10px] font-extrabold bg-white/15 backdrop-blur-sm px-3 py-1.5 rounded-full tracking-widest flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"/>
                    LIVE
                  </span>
                )}
              </div>

              {totalRequests === 0 ? (
                <div className="bg-white p-10 text-center">
                  <div className="w-16 h-16 bg-gray-50 rounded-3xl flex items-center justify-center mx-auto mb-4">
                    <Bike size={32} className="text-gray-300"/>
                  </div>
                  <p className="text-gray-600 font-bold text-base">{T("noRequestsNow")}</p>
                  <p className="text-gray-400 text-xs mt-1.5">{T("autoRefreshes")}</p>
                  {dismissed.size > 0 && (
                    <button onClick={() => setDismissed(new Set())}
                      className="mt-4 text-xs text-gray-900 font-bold bg-gray-100 border border-gray-200 px-4 py-2 rounded-full inline-flex items-center gap-1.5 hover:bg-gray-200 transition-colors">
                      <Eye size={12}/> Show {dismissed.size} hidden request{dismissed.size > 1 ? "s" : ""}
                    </button>
                  )}
                </div>
              ) : (
                <div className="bg-white divide-y divide-gray-100">

                  {orders.map((o: any) => {
                    const earnings = getDeliveryEarn(o.type);
                    const isExpired = (Date.now() - new Date(o.createdAt).getTime()) / 1000 >= ACCEPT_TIMEOUT_SEC;
                    return (
                    <div key={o.id} className="p-4 animate-[slideUp_0.3s_ease-out] border-b border-gray-50 last:border-0">
                      {/* Header row */}
                      <div className="flex items-start gap-3">
                        <AcceptCountdown createdAt={o.createdAt} onExpired={() => dismiss(o.id)} />
                        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 flex items-center justify-center flex-shrink-0 shadow-sm">
                          <OrderTypeIcon type={o.type}/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <p className="font-extrabold text-gray-900 text-[15px] capitalize tracking-tight">{o.type} Delivery</p>
                            <RequestAge createdAt={o.createdAt} />
                          </div>
                          {o.vendorStoreName && (
                            <p className="text-xs text-blue-600 font-semibold truncate flex items-center gap-1">
                              <MapPin size={10}/> {o.vendorStoreName}
                            </p>
                          )}
                          <p className="text-xs text-gray-400 truncate mt-0.5 flex items-center gap-1">
                            <Navigation size={10} className="text-gray-300"/> {o.deliveryAddress || "Destination"}
                          </p>
                        </div>
                        {/* Earnings chip */}
                        <div className="bg-green-500 text-white rounded-2xl px-3 py-1.5 flex-shrink-0 text-right shadow-sm shadow-green-200">
                          <p className="text-base font-extrabold leading-tight">+{formatCurrency(earnings)}</p>
                          <p className="text-[9px] text-green-100 font-semibold">{T("yourEarnings")}</p>
                        </div>
                      </div>

                      {/* Stats row */}
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        {o.total && (
                          <div className="bg-gray-50 rounded-xl px-2.5 py-1 border border-gray-100">
                            <p className="text-xs font-bold text-gray-700">{formatCurrency(o.total)}</p>
                            <p className="text-[9px] text-gray-400">{T("orderTotal")}</p>
                          </div>
                        )}
                        {o.itemCount && (
                          <div className="bg-gray-50 rounded-xl px-2.5 py-1 border border-gray-100">
                            <p className="text-xs font-bold text-gray-700">{o.itemCount} items</p>
                            <p className="text-[9px] text-gray-400">{T("toCollect")}</p>
                          </div>
                        )}
                        {o.distanceKm && (
                          <div className="bg-blue-50 rounded-xl px-2.5 py-1 border border-blue-100">
                            <p className="text-xs font-bold text-blue-700">{parseFloat(o.distanceKm).toFixed(1)} km</p>
                            <p className="text-[9px] text-blue-400">{T("distance")}</p>
                          </div>
                        )}
                      </div>

                      {/* Mini-map for order */}
                      {(o.vendorLat != null && o.vendorLng != null) && (
                        <MiniMap
                          pickupLat={o.vendorLat ? parseFloat(o.vendorLat) : null}
                          pickupLng={o.vendorLng ? parseFloat(o.vendorLng) : null}
                          dropLat={o.deliveryLat ? parseFloat(o.deliveryLat) : null}
                          dropLng={o.deliveryLng ? parseFloat(o.deliveryLng) : null}
                        />
                      )}

                      {/* Action buttons */}
                      <div className="flex gap-2 mt-3">
                        {o.deliveryAddress && (
                          <a href={buildMapsDeepLink(null, null, o.deliveryAddress)}
                            target="_blank" rel="noopener noreferrer" aria-label="Open delivery address in maps"
                            className="flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-600 text-xs font-bold px-3 py-2.5 rounded-xl hover:bg-blue-100 transition-colors">
                            <MapPin size={14}/>
                          </a>
                        )}
                        <button onClick={() => rejectOrderMut.mutate(o.id)}
                          disabled={rejectOrderMut.isPending}
                          className="border border-red-200 text-red-400 font-bold px-3 py-2.5 rounded-xl text-sm hover:bg-red-50 transition-colors flex items-center gap-1 disabled:opacity-60"
                          title="Reject" aria-label="Reject order">
                          <XCircle size={14}/> Reject
                        </button>
                        <button onClick={() => dismiss(o.id)}
                          className="border border-gray-200 text-gray-400 font-bold px-3 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors flex items-center"
                          title="Ignore" aria-label="Dismiss order">
                          <X size={16}/>
                        </button>
                        <button onClick={() => acceptOrderMut.mutate(o.id)}
                          disabled={isExpired || acceptOrderMut.isPending || acceptRideMut.isPending}
                          className="flex-1 bg-gray-900 hover:bg-gray-800 text-white font-extrabold py-2.5 rounded-xl text-sm disabled:opacity-60 transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 shadow-sm">
                          <CheckCircle size={15}/>
                          {acceptOrderMut.isPending ? T("accepting") : T("acceptOrder")}
                        </button>
                      </div>
                    </div>
                    );
                  })}

                  {rides.map((r: any) => {
                    const isBargain    = r.status === "bargaining" && r.offeredFare != null;
                    const isDispatched = r.dispatchedRiderId === user?.id;
                    const offeredFare  = r.offeredFare  ?? r.fare;
                    const effectiveFare = isBargain ? offeredFare : r.fare;
                    const rideExpired = (Date.now() - new Date(r.createdAt).getTime()) / 1000 >= ACCEPT_TIMEOUT_SEC;
                    const earnings     = effectiveFare * (config.finance.riderEarningPct / 100);
                    const mapsUrl = buildMapsDeepLink(r.dropLat, r.dropLng, r.dropAddress || r.pickupAddress);
                    const svcName = SVC_NAMES[r.type] ?? r.type?.replace(/_/g, " ") ?? "Ride";
                    const rideDistKm = r.distance ? parseFloat(r.distance) : null;
                    const etaMin = rideDistKm ? Math.max(1, Math.round((rideDistKm / 30) * 60)) : null;

                    return (
                      <div key={r.id} className={`p-4 animate-[slideUp_0.3s_ease-out] ${isDispatched ? "border-l-4 border-blue-500 bg-gradient-to-r from-blue-50/50 to-white" : isBargain ? "border-l-4 border-orange-400 bg-gradient-to-r from-orange-50/50 to-white" : "hover:bg-gray-50/50"} transition-colors`}>
                        <div className="flex items-start gap-3">
                          <AcceptCountdown createdAt={r.createdAt} onExpired={() => dismiss(r.id)} />
                          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm border ${isDispatched ? "bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200" : isBargain ? "bg-gradient-to-br from-orange-50 to-amber-50 border-orange-200" : "bg-gradient-to-br from-green-50 to-emerald-50 border-green-100"}`}>
                            {isBargain ? <MessageSquare size={20} className="text-orange-500"/> : <RideTypeIcon type={r.type}/>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <p className="font-extrabold text-gray-900 text-[15px] tracking-tight">{svcName} Ride</p>
                              {isDispatched && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 animate-pulse flex items-center gap-1 border border-blue-200">
                                  <Zap size={8}/> DISPATCHED
                                </span>
                              )}
                              {isBargain && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gradient-to-r from-orange-100 to-amber-100 text-orange-700 animate-pulse flex items-center gap-1 border border-orange-200">
                                  <MessageSquare size={8}/> BARGAIN
                                </span>
                              )}
                              {isBargain && r.myBid && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 flex items-center gap-1 border border-blue-200">
                                  <CheckCircle size={8}/> Bid Sent
                                </span>
                              )}
                              {r.isParcel && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 flex items-center gap-1 border border-amber-200">
                                  📦 Parcel
                                </span>
                              )}
                              {(r as any).isPoolRide && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 flex items-center gap-1 border border-violet-200">
                                  👥 Pool
                                </span>
                              )}
                              <RequestAge createdAt={r.createdAt} />
                            </div>
                            {(r.riderDistanceKm != null || r.riderEtaMin != null) && (
                              <div className="flex items-center gap-2 mt-1 mb-1">
                                {r.riderDistanceKm != null && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 flex items-center gap-1">
                                    <Navigation size={9}/> {r.riderDistanceKm < 1 ? `${Math.round(r.riderDistanceKm * 1000)}m` : `${r.riderDistanceKm} km`} away
                                  </span>
                                )}
                                {r.riderEtaMin != null && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 border border-purple-100 flex items-center gap-1">
                                    <Clock size={9}/> {r.riderEtaMin} min ETA
                                  </span>
                                )}
                              </div>
                            )}
                            <div className="space-y-1 mt-1">
                              <p className="text-xs text-gray-600 truncate flex items-center gap-1.5">
                                <span className="w-2 h-2 bg-green-500 rounded-full inline-block flex-shrink-0 shadow-sm shadow-green-500/30"/>
                                {r.pickupAddress}
                              </p>
                              <p className="text-xs text-gray-400 truncate flex items-center gap-1.5">
                                <span className="w-2 h-2 bg-red-500 rounded-full inline-block flex-shrink-0 shadow-sm shadow-red-500/30"/>
                                {r.dropAddress}
                              </p>
                            </div>
                            <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                              <div className={`rounded-xl px-3 py-1.5 border ${isBargain ? "bg-orange-50 border-orange-100" : "bg-green-50 border-green-100"}`}>
                                <p className={`text-base font-extrabold leading-tight ${isBargain ? "text-orange-600" : "text-green-600"}`}>
                                  +{formatCurrency(earnings)}
                                </p>
                                <p className="text-[9px] text-gray-400 font-semibold">{T("yourEarnings")}</p>
                              </div>
                              {isBargain && (
                                <div>
                                  <p className="text-sm font-bold text-orange-700">{formatCurrency(offeredFare)}</p>
                                  <p className="text-[9px] text-gray-400 font-medium">{T("customerOffer")}</p>
                                </div>
                              )}
                              {rideDistKm && (
                                <div>
                                  <p className="text-sm font-bold text-gray-700">{rideDistKm.toFixed(1)} km</p>
                                  <p className="text-[9px] text-gray-400 font-medium">{T("distance")}</p>
                                </div>
                              )}
                              {etaMin && (
                                <div>
                                  <p className="text-sm font-bold text-blue-600">{etaMin} min</p>
                                  <p className="text-[9px] text-gray-400 font-medium">ETA</p>
                                </div>
                              )}
                              <div>
                                <p className="text-sm font-bold text-gray-300 line-through">{formatCurrency(r.fare)}</p>
                                <p className="text-[9px] text-gray-400 font-medium">{T("platformFare")}</p>
                              </div>
                            </div>
                            {r.bargainNote && (
                              <div className="mt-2 bg-orange-50 border border-orange-100 rounded-xl px-3 py-2">
                                <p className="text-xs text-orange-700 italic flex items-center gap-1.5">
                                  <MessageSquare size={11} className="flex-shrink-0"/> "{r.bargainNote}"
                                </p>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Ride mini-map */}
                        {(r.pickupLat != null && r.pickupLng != null) && (
                          <MiniMap
                            pickupLat={r.pickupLat != null ? parseFloat(r.pickupLat) : null}
                            pickupLng={r.pickupLng != null ? parseFloat(r.pickupLng) : null}
                            dropLat={r.dropLat != null ? parseFloat(r.dropLat) : null}
                            dropLng={r.dropLng != null ? parseFloat(r.dropLng) : null}
                          />
                        )}

                        {!isBargain && (
                          <div className="flex gap-2 mt-3">
                            <a href={mapsUrl} target="_blank" rel="noopener noreferrer" aria-label="Open pickup location in maps"
                              className="flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-600 text-xs font-bold px-3 py-2.5 rounded-xl hover:bg-blue-100 transition-colors">
                              <MapPin size={14}/>
                            </a>
                            {isDispatched ? (
                              <button onClick={() => ignoreRideMut.mutate(r.id)}
                                disabled={ignoreRideMut.isPending || acceptRideMut.isPending || acceptOrderMut.isPending}
                                className="border border-amber-300 text-amber-600 font-bold px-3 py-2.5 rounded-xl text-sm hover:bg-amber-50 transition-colors flex items-center gap-1 disabled:opacity-60">
                                <SkipForward size={14}/> Ignore
                              </button>
                            ) : (
                              <button onClick={() => dismiss(r.id)}
                                className="border border-gray-200 text-gray-400 font-bold px-3 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors flex items-center"
                                title="Ignore" aria-label="Dismiss ride request">
                                <X size={16}/>
                              </button>
                            )}
                            <button onClick={() => acceptRideMut.mutate(r.id)}
                              disabled={rideExpired || acceptRideMut.isPending || acceptOrderMut.isPending || ignoreRideMut.isPending || !!user?.isRestricted}
                              className="flex-1 bg-gray-900 hover:bg-gray-800 text-white font-extrabold py-2.5 rounded-xl text-sm disabled:opacity-60 transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 shadow-sm">
                              <CheckCircle size={15}/>
                              {acceptRideMut.isPending ? T("accepting") : T("acceptRide")}
                            </button>
                          </div>
                        )}

                        {isBargain && (
                          <div className="mt-3 space-y-2">
                            {r.myBid ? (
                              <div className="bg-gradient-to-r from-orange-50 to-amber-50 border-2 border-orange-200 rounded-xl p-3.5 space-y-2.5">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-xs font-bold text-orange-700 flex items-center gap-1"><MessageSquare size={11}/> Your Bid Pending</p>
                                    <p className="text-lg font-extrabold text-orange-600">{currency} {Math.round(r.myBid.fare)}</p>
                                  </div>
                                  <span className="text-[10px] font-bold px-2.5 py-1 bg-orange-100 text-orange-600 rounded-full animate-pulse border border-orange-200">
                                    WAITING
                                  </span>
                                </div>
                                <div className="flex gap-2">
                                  <input
                                    type="number" inputMode="numeric"
                                    value={counterInputs[r.id] || ""}
                                    onChange={e => setCounterInputs(prev => ({ ...prev, [r.id]: e.target.value }))}
                                    placeholder="Update bid..."
                                    className="flex-1 h-10 px-3 bg-white border border-orange-200 rounded-xl text-sm focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                                  />
                                  {counterErrors[r.id] && (
                                    <p className="text-xs text-red-500 font-semibold col-span-full">{counterErrors[r.id]}</p>
                                  )}
                                  <button
                                    onClick={() => {
                                      const v = Number(counterInputs[r.id] || 0);
                                      const vt = r.vehicleType as string | undefined;
                                      const minFare = vt === "car" ? (config.rides.carMinFare ?? 80) : vt === "rickshaw" ? (config.rides.rickshawMinFare ?? 50) : vt === "daba" ? (config.rides.dabaMinFare ?? 60) : (config.rides.bikeMinFare ?? 50);
                                      const maxFare = (r.offeredFare ?? r.fare) * (config.rides.counterMaxMultiplier ?? 3);
                                      if (!v || v < minFare) {
                                        setCounterErrors(prev => ({ ...prev, [r.id]: `Minimum fare is ${formatCurrency(minFare, currency)}` }));
                                        return;
                                      }
                                      if (v > maxFare) {
                                        setCounterErrors(prev => ({ ...prev, [r.id]: `Cannot exceed ${formatCurrency(maxFare, currency)}` }));
                                        return;
                                      }
                                      setCounterErrors(prev => ({ ...prev, [r.id]: "" }));
                                      counterRideMut.mutate({ id: r.id, counterFare: v });
                                    }}
                                    disabled={counterRideMut.isPending}
                                    className="bg-orange-500 hover:bg-orange-600 text-white font-bold px-3.5 py-2 rounded-xl text-sm disabled:opacity-60 transition-colors">
                                    Update
                                  </button>
                                  <button onClick={() => acceptRideMut.mutate(r.id)}
                                    disabled={acceptRideMut.isPending}
                                    className="bg-gray-900 hover:bg-gray-800 text-white font-bold px-3.5 py-2 rounded-xl text-sm disabled:opacity-60 flex items-center gap-1 transition-colors">
                                    <CheckCircle size={13}/> Accept
                                  </button>
                                </div>
                              </div>
                            ) : showCounter[r.id] ? (
                              <div className="space-y-2">
                                <div className="flex gap-2">
                                <input
                                  type="number" inputMode="numeric"
                                  value={counterInputs[r.id] || ""}
                                  onChange={e => {
                                    setCounterInputs(prev => ({ ...prev, [r.id]: e.target.value }));
                                    if (counterErrors[r.id]) setCounterErrors(prev => ({ ...prev, [r.id]: "" }));
                                  }}
                                  placeholder="Your counter fare..."
                                  className={`flex-1 h-11 px-4 bg-gray-50 border rounded-xl text-sm focus:outline-none focus:ring-2 ${counterErrors[r.id] ? "border-red-300 focus:border-red-400 focus:ring-red-100" : "border-gray-200 focus:border-orange-400 focus:ring-orange-100"}`}
                                />
                                <button
                                  onClick={() => {
                                    const v = Number(counterInputs[r.id] || 0);
                                    const vt = r.vehicleType as string | undefined;
                                    const minFare = vt === "car" ? (config.rides.carMinFare ?? 80) : vt === "rickshaw" ? (config.rides.rickshawMinFare ?? 50) : vt === "daba" ? (config.rides.dabaMinFare ?? 60) : (config.rides.bikeMinFare ?? 50);
                                    const maxFare = (r.offeredFare ?? r.fare) * (config.rides.counterMaxMultiplier ?? 3);
                                    if (!v || v < minFare) {
                                      setCounterErrors(prev => ({ ...prev, [r.id]: `Minimum fare is ${formatCurrency(minFare, currency)}` }));
                                      return;
                                    }
                                    if (v > maxFare) {
                                      setCounterErrors(prev => ({ ...prev, [r.id]: `Cannot exceed ${formatCurrency(maxFare, currency)}` }));
                                      return;
                                    }
                                    setCounterErrors(prev => ({ ...prev, [r.id]: "" }));
                                    counterRideMut.mutate({ id: r.id, counterFare: v });
                                  }}
                                  disabled={counterRideMut.isPending}
                                  className="bg-orange-500 hover:bg-orange-600 text-white font-extrabold px-4 py-2.5 rounded-xl text-sm disabled:opacity-60 transition-colors">
                                  {counterRideMut.isPending ? "..." : "Submit"}
                                </button>
                                <button onClick={() => { setShowCounter(prev => ({ ...prev, [r.id]: false })); setCounterErrors(prev => ({ ...prev, [r.id]: "" })); }}
                                  className="bg-gray-100 text-gray-400 px-3 py-2.5 rounded-xl flex items-center hover:bg-gray-200 transition-colors">
                                  <X size={15}/>
                                </button>
                                </div>
                                {counterErrors[r.id] && (
                                  <p className="text-xs text-red-500 font-semibold px-1">{counterErrors[r.id]}</p>
                                )}
                              </div>
                            ) : (
                              <div className="flex gap-2">
                                <a href={mapsUrl} target="_blank" rel="noopener noreferrer" aria-label="Open location in maps"
                                  className="flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-600 text-xs font-bold px-3 py-2.5 rounded-xl hover:bg-blue-100 transition-colors">
                                  <MapPin size={14}/>
                                </a>
                                <button onClick={() => rejectOfferMut.mutate(r.id)}
                                  className="bg-gray-100 text-gray-400 font-bold px-3 py-2.5 rounded-xl text-sm flex items-center hover:bg-gray-200 transition-colors"
                                  aria-label="Reject offer">
                                  <X size={16}/>
                                </button>
                                <button onClick={() => setShowCounter(prev => ({ ...prev, [r.id]: true }))}
                                  className="flex-1 bg-gradient-to-r from-orange-100 to-amber-100 text-orange-700 font-extrabold py-2.5 rounded-xl text-sm flex items-center justify-center gap-1.5 border border-orange-200 hover:from-orange-200 hover:to-amber-200 transition-all active:scale-[0.98]">
                                  <MessageSquare size={14}/> Counter Offer
                                </button>
                                <button onClick={() => acceptRideMut.mutate(r.id)}
                                  disabled={acceptRideMut.isPending || acceptOrderMut.isPending}
                                  className="flex-1 bg-gray-900 text-white font-extrabold py-2.5 rounded-xl text-sm disabled:opacity-60 flex items-center justify-center gap-1.5 shadow-sm active:scale-[0.98] transition-all">
                                  <CheckCircle size={14}/>
                                  Accept
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                </div>
              )}
            </div>
          </>
        ) : (
          <div className="bg-white rounded-3xl shadow-sm p-10 text-center border border-gray-100 animate-[slideUp_0.3s_ease-out]">
            <div className="w-20 h-20 bg-gray-50 rounded-3xl flex items-center justify-center mx-auto mb-4">
              <Wifi size={36} className="text-gray-300"/>
            </div>
            <p className="text-gray-700 font-extrabold text-lg tracking-tight">You are Offline</p>
            <p className="text-gray-400 text-sm mt-1.5">Toggle the switch above to start accepting orders</p>
            <button onClick={toggleOnline} disabled={toggling}
              className="mt-5 bg-gray-900 text-white font-bold text-sm px-6 py-3 rounded-xl shadow-sm hover:bg-gray-800 transition-all active:scale-[0.98] disabled:opacity-60 inline-flex items-center gap-2">
              <Zap size={16}/> Go Online
            </button>
          </div>
        )}

        {config.content.trackerBannerEnabled && hasActiveTask && config.content.trackerBannerPosition === "bottom" && (
          <Link href="/active"
            className="block bg-gradient-to-r from-green-500 to-emerald-600 rounded-3xl px-4 py-3.5 shadow-lg shadow-green-200 active:scale-[0.98] transition-transform animate-[slideUp_0.3s_ease-out] mt-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center flex-shrink-0">
                <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-extrabold text-white tracking-tight">
                  {activeData?.order ? "Active Delivery in Progress" : "Active Ride in Progress"}
                </p>
                <p className="text-xs text-white/70 mt-0.5 truncate">
                  {activeData?.order
                    ? `Order #${activeData.order.id?.slice(-6).toUpperCase()} — ${activeData.order.deliveryAddress || "Customer"}`
                    : `Ride → ${activeData?.ride?.dropAddress || "Drop location"}`}
                </p>
              </div>
              <div className="bg-white/20 backdrop-blur-sm text-white font-extrabold text-xs px-3 py-2 rounded-xl flex-shrink-0 flex items-center gap-1">
                Track <ChevronRight size={12}/>
              </div>
            </div>
          </Link>
        )}

      </div>

      {toastMsg && (
        <div className="fixed top-6 left-4 right-4 z-50 pointer-events-none animate-[slideDown_0.3s_ease-out]">
          <div className={`${toastType === "success" ? "bg-green-600" : "bg-red-600"} text-white text-sm font-semibold px-5 py-3.5 rounded-2xl shadow-2xl flex items-center justify-center gap-2 max-w-md mx-auto`}>
            {toastType === "success" ? <CheckCircle size={16}/> : <AlertTriangle size={16}/>}
            {toastMsg}
          </div>
        </div>
      )}

      {hasActiveTask && !config.content.trackerBannerEnabled && (
        <Link href="/active"
          className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+72px)] left-4 right-4 z-30 block bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl px-4 py-3 shadow-lg shadow-green-300/40 active:scale-[0.98] transition-transform animate-[slideUp_0.3s_ease-out]">
          <div className="flex items-center gap-2.5 max-w-md mx-auto">
            <div className="w-2.5 h-2.5 bg-white rounded-full animate-pulse flex-shrink-0" />
            <p className="text-sm font-extrabold text-white flex-1 truncate">{T("youHaveActiveTask")}</p>
            <ChevronRight size={14} className="text-white/80 flex-shrink-0" />
          </div>
        </Link>
      )}

      {showOfflineConfirm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center pointer-events-auto animate-[fadeIn_0.15s_ease-out]">
          <div className="w-full max-w-sm mx-auto bg-white rounded-t-3xl px-6 py-6 shadow-2xl animate-[slideUp_0.2s_ease-out]">
            <p className="text-base font-extrabold text-gray-900 mb-1.5">Go Offline?</p>
            <p className="text-sm text-gray-500 mb-5">You have {totalRequests} request{totalRequests > 1 ? "s" : ""} waiting — go offline anyway?</p>
            <div className="flex gap-3">
              <button onClick={() => setShowOfflineConfirm(false)}
                className="flex-1 h-12 border-2 border-gray-200 text-gray-700 font-bold rounded-xl text-sm hover:bg-gray-50 transition-colors">
                Stay Online
              </button>
              <button onClick={async () => { setShowOfflineConfirm(false); await doActualToggle(); }}
                className="flex-1 h-12 bg-gray-900 text-white font-bold rounded-xl text-sm hover:bg-gray-800 transition-colors">
                Go Offline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
