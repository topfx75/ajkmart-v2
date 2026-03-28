import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useAuth } from "../lib/auth";
import { api, apiFetch } from "../lib/api";
import { usePlatformConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { tDual } from "@workspace/i18n";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, MapPin, Pin, Bike, Car, Bus, ShoppingBag,
  ShoppingCart, Pill, Package, Banana, Navigation, Wifi,
  X, Timer, CheckCircle, MessageSquare, ChevronRight,
  TrendingUp, Calendar, Trophy, Radio,
} from "lucide-react";

function formatCurrency(n: number) { return `Rs. ${Math.round(n).toLocaleString()}`; }

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
    const t = setInterval(() => setLabel(timeAgo(createdAt)), 5000);
    return () => clearInterval(t);
  }, [createdAt]);
  const diffSec = (Date.now() - new Date(createdAt).getTime()) / 1000;
  const urgent = diffSec > 90;
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${urgent ? "bg-red-100 text-red-600 animate-pulse" : "bg-gray-100 text-gray-500"}`}>
      <Timer size={9}/> {label}
    </span>
  );
}

function OrderTypeIcon({ type }: { type: string }) {
  if (type === "food")     return <ShoppingBag size={22} className="text-orange-500"/>;
  if (type === "mart")     return <ShoppingCart size={22} className="text-blue-500"/>;
  if (type === "pharmacy") return <Pill size={22} className="text-green-600"/>;
  if (type === "grocery")  return <Banana size={22} className="text-yellow-500"/>;
  return <Package size={22} className="text-indigo-500"/>;
}

function RideTypeIcon({ type }: { type: string }) {
  if (type === "car")          return <Car  size={22} className="text-blue-600"/>;
  if (type === "rickshaw")     return <Bike size={22} className="text-yellow-600"/>;
  if (type === "daba")         return <Bus  size={22} className="text-gray-600"/>;
  if (type === "school_shift") return <Bus  size={22} className="text-green-600"/>;
  return <Bike size={22} className="text-green-600"/>;
}

const SVC_NAMES: Record<string, string> = {
  bike: "Bike", car: "Car", rickshaw: "Rickshaw", daba: "Daba / Van", school_shift: "School Shift",
};

export default function Home() {
  const { user, refreshUser } = useAuth();
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: Parameters<typeof tDual>[0]) => tDual(key, language);
  const qc = useQueryClient();
  const [toggling, setToggling] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [newFlash, setNewFlash] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const prevIdsRef = useRef<Set<string>>(new Set());

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(""), 3000);
  };

  const toggleOnline = async () => {
    if (toggling) return;
    setToggling(true);
    try {
      const newStatus = !user?.isOnline;
      await api.setOnline(newStatus);
      await refreshUser();
      showToast(newStatus ? "You are now Online!" : "You are now Offline");
    } catch (e: any) { showToast(e.message); }
    setToggling(false);
  };

  const { data: earningsData } = useQuery({
    queryKey: ["rider-earnings"],
    queryFn: () => api.getEarnings(),
    refetchInterval: 60000,
  });

  const { data: activeData } = useQuery({
    queryKey: ["rider-active"],
    queryFn: () => api.getActive(),
    refetchInterval: 8000,
  });
  const hasActiveTask = !!(activeData?.order || activeData?.ride);

  const { data: requestsData } = useQuery({
    queryKey: ["rider-requests"],
    queryFn: () => api.getRequests(),
    refetchInterval: user?.isOnline ? 12000 : 60000,
  });

  const allOrders: any[] = requestsData?.orders || [];
  const allRides:  any[] = requestsData?.rides  || [];

  useEffect(() => {
    const currentIds = new Set<string>([...allOrders.map((o: any) => o.id), ...allRides.map((r: any) => r.id)]);
    const prevIds = prevIdsRef.current;
    let hasNew = false;
    currentIds.forEach(id => { if (!prevIds.has(id)) hasNew = true; });
    if (hasNew && currentIds.size > 0) {
      setNewFlash(true);
      setTimeout(() => setNewFlash(false), 2500);
    }
    prevIdsRef.current = currentIds;
  }, [allOrders.length, allRides.length]);

  /* ── GPS location tracking — sends position every 30s when online with no active task ── */
  useEffect(() => {
    if (!user?.isOnline || hasActiveTask || !user?.id) return;
    if (!navigator?.geolocation) return;

    let lastSentTime = 0;
    const MIN_INTERVAL_MS = 30_000;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastSentTime < MIN_INTERVAL_MS) return;
        lastSentTime = now;
        apiFetch("/locations/update", {
          method: "POST",
          body: JSON.stringify({
            latitude:  pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy:  pos.coords.accuracy,
            role:      "rider",
          }),
        }).catch((err: Error) => {
          console.warn("[Home] GPS location update failed:", err.message);
        });
      },
      () => {},
      { enableHighAccuracy: false, maximumAge: 20_000, timeout: 30_000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [user?.isOnline, hasActiveTask, user?.id]);

  const orders = allOrders.filter((o: any) => !dismissed.has(o.id));
  const rides  = allRides.filter((r: any) => !dismissed.has(r.id));
  const totalRequests = orders.length + rides.length;

  const dismiss = (id: string) => setDismissed(prev => new Set([...prev, id]));

  const logRideEvent = (rideId: string, event: string) => {
    const doLog = (lat?: number, lng?: number) => {
      apiFetch(`/rides/${rideId}/event-log`, {
        method: "POST",
        body: JSON.stringify({ event, lat, lng }),
      }).catch((err: Error) => {
        console.warn("[Home] ride event log failed:", err.message);
      });
    };
    if (navigator?.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => doLog(pos.coords.latitude, pos.coords.longitude),
        ()    => doLog(),
        { enableHighAccuracy: true, timeout: 8_000, maximumAge: 15_000 },
      );
    } else {
      doLog();
    }
  };

  const acceptOrderMut = useMutation({
    mutationFn: (id: string) => api.acceptOrder(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      qc.invalidateQueries({ queryKey: ["rider-active"] });
      logRideEvent(id, "accepted");
      showToast("Order accepted! Active tab mein dekho.");
    },
    onError: (e: any) => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      showToast(e.message || "Order accept nahi hua — shayad kisi ne pehle le liya");
    },
  });

  const acceptRideMut = useMutation({
    mutationFn: (id: string) => api.acceptRide(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      qc.invalidateQueries({ queryKey: ["rider-active"] });
      logRideEvent(id, "accepted");
      showToast("Ride accepted! Active tab mein dekho.");
    },
    onError: (e: any) => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      showToast(e.message || "Ride accept nahi hua — shayad kisi ne pehle le li");
    },
  });

  const [counterInputs, setCounterInputs] = useState<Record<string, string>>({});
  const [showCounter,   setShowCounter]   = useState<Record<string, boolean>>({});

  const counterRideMut = useMutation({
    mutationFn: ({ id, counterFare }: { id: string; counterFare: number }) =>
      api.counterRide(id, { counterFare }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      setCounterInputs(prev => ({ ...prev, [vars.id]: "" }));
      setShowCounter(prev => ({ ...prev, [vars.id]: false }));
      showToast("Counter offer bhej diya gaya!");
    },
    onError: (e: any) => showToast(e.message || "Counter offer nahi gaya"),
  });

  const rejectOfferMut = useMutation({
    mutationFn: (id: string) => api.rejectOffer(id),
    onSuccess: (_, id) => {
      dismiss(id);
      showToast("Ride skip kar diya gaya.");
    },
    onError: (e: any) => showToast(e.message),
  });

  const getDeliveryEarn = (type: string) => {
    const fee = (config.deliveryFee as Record<string, unknown>)[type] as number ?? config.deliveryFee.mart ?? 100;
    return fee * (config.finance.riderEarningPct / 100);
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-24">

      {/* ── New request flash overlay ── */}
      {newFlash && (
        <div className="fixed inset-0 z-50 pointer-events-none">
          <div className="absolute inset-0 border-8 border-green-400 rounded-none animate-ping opacity-60"/>
          <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-green-600 text-white font-extrabold text-base px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-2 animate-bounce">
            <span className="w-2.5 h-2.5 bg-white rounded-full"/>
            New Request Available!
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="bg-gradient-to-br from-green-600 to-emerald-700 text-white px-5 pt-12 pb-20">
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-green-200 text-xs font-medium flex items-center gap-1.5">
              <LiveClock/> · AJKMart Rider
            </p>
            <h1 className="text-2xl font-extrabold mt-0.5 flex items-center gap-2">
              <Bike size={22}/> {user?.name || "Rider"}
            </h1>
          </div>
          <div className="text-right">
            <p className="text-green-200 text-xs">{T("wallet")}</p>
            <p className="font-extrabold text-xl">{formatCurrency(Number(user?.walletBalance) || 0)}</p>
          </div>
        </div>

        {/* Online/Offline Toggle */}
        <div className={`rounded-2xl p-4 transition-all ${user?.isOnline ? "bg-green-500/30 border border-green-400/40" : "bg-white/10 border border-white/10"}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${user?.isOnline ? "bg-green-300 animate-pulse" : "bg-gray-400"}`} />
                <p className="font-extrabold text-lg">{user?.isOnline ? T("online") : T("offline")}</p>
              </div>
              <p className="text-green-100 text-sm mt-0.5">
                {user?.isOnline ? T("acceptingOrders") : T("tapToStart")}
              </p>
            </div>
            <button onClick={toggleOnline} disabled={toggling}
              className={`w-16 h-9 rounded-full relative transition-all duration-300 shadow-inner ${user?.isOnline ? "bg-green-400" : "bg-white/30"} ${toggling ? "opacity-60" : ""}`}>
              <div className={`w-7 h-7 bg-white rounded-full absolute top-1 shadow-md transition-all duration-300 ${user?.isOnline ? "left-8" : "left-1"}`} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Stats Pull Cards ── */}
      <div className="px-4 -mt-10 space-y-3">

        {/* Notice Banner */}
        {config.content.riderNotice && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3 flex items-start gap-3">
            <Pin size={16} className="text-blue-500 flex-shrink-0 mt-0.5"/>
            <p className="text-sm text-blue-700 font-medium leading-snug flex-1">{config.content.riderNotice}</p>
          </div>
        )}

        {/* Minimum Balance Warning */}
        {(() => {
          const minBal  = config.rider?.minBalance ?? 0;
          const curBal  = Number(user?.walletBalance) || 0;
          if (minBal <= 0 || curBal >= minBal) return null;
          const shortfall = minBal - curBal;
          return (
            <Link href="/wallet">
              <div className="bg-amber-50 border border-amber-300 rounded-2xl px-4 py-3 flex items-start gap-3 cursor-pointer active:opacity-80">
                <AlertTriangle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-amber-800">Wallet Balance Kam Hai</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Cash orders accept karne ke liye minimum <strong>Rs. {Math.round(minBal)}</strong> chahiye.
                    Aapka balance: <strong>Rs. {Math.round(curBal)}</strong>.
                    {shortfall > 0 && <> Rs. {Math.round(shortfall)} aur chahiye.</>}
                  </p>
                  <p className="text-[10px] text-amber-600 mt-1 font-semibold flex items-center gap-1">
                    Wallet tab mein tap karke deposit karein <ChevronRight size={10}/>
                  </p>
                </div>
              </div>
            </Link>
          );
        })()}

        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { icon: <Package size={16} className="text-indigo-500"/>,    label: "Today",  value: String(user?.stats?.deliveriesToday || 0),         sub: "deliveries" },
            { icon: <TrendingUp size={16} className="text-green-600"/>,  label: "Earned", value: formatCurrency(user?.stats?.earningsToday || 0),   sub: "today"      },
            { icon: <Calendar size={16} className="text-blue-500"/>,     label: "Week",   value: formatCurrency(earningsData?.week?.earnings || 0),  sub: "earnings"   },
            { icon: <Trophy size={16} className="text-amber-500"/>,      label: "Total",  value: String(user?.stats?.totalDeliveries || 0),          sub: "lifetime"   },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl p-3 shadow-sm text-center">
              <div className="flex justify-center mb-0.5">{s.icon}</div>
              <p className="text-xs font-extrabold text-gray-800 leading-tight">{s.value}</p>
              <p className="text-[9px] text-gray-400 mt-0.5 font-medium">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* ── REQUEST ALERTS ── */}
        {user?.isOnline ? (
          <>
            {/* Active task warning */}
            {hasActiveTask && (
              <Link href="/active"
                className="block bg-amber-50 border-2 border-amber-400 rounded-2xl px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-pulse flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-extrabold text-amber-800">
                      {activeData?.order ? "Active Delivery in Progress" : "Active Ride in Progress"}
                    </p>
                    <p className="text-xs text-amber-600 mt-0.5">
                      {activeData?.order
                        ? `Order #${activeData.order.id?.slice(-6).toUpperCase()} — ${activeData.order.deliveryAddress || "Customer"}`
                        : `Ride → ${activeData?.ride?.dropAddress || "Drop location"}`}
                    </p>
                  </div>
                  <span className="text-amber-500 font-bold text-xs bg-amber-100 px-2 py-1 rounded-full flex-shrink-0 flex items-center gap-1">
                    Go <ChevronRight size={12}/>
                  </span>
                </div>
              </Link>
            )}

            {/* Requests Panel */}
            <div className={`rounded-2xl shadow-sm overflow-hidden transition-all ${newFlash ? "ring-4 ring-green-400 ring-offset-2" : ""}`}>
              <div className={`px-4 py-3 flex items-center justify-between ${totalRequests > 0 ? "bg-orange-500" : "bg-gray-700"}`}>
                <div className="flex items-center gap-2">
                  {totalRequests > 0 ? (
                    <span className="w-2.5 h-2.5 bg-white rounded-full animate-pulse inline-block" />
                  ) : (
                    <Radio size={16} className="text-white"/>
                  )}
                  <p className="font-extrabold text-white text-sm">
                    {totalRequests > 0
                      ? `${totalRequests} Request${totalRequests > 1 ? "s" : ""} — Accept Karo!`
                      : "Listening for Requests..."}
                  </p>
                </div>
                {totalRequests > 0 && (
                  <span className="text-orange-100 text-xs font-bold bg-orange-600 px-2 py-0.5 rounded-full">LIVE</span>
                )}
              </div>

              {totalRequests === 0 ? (
                <div className="bg-white p-8 text-center">
                  <div className="flex justify-center mb-2"><Bike size={40} className="text-gray-300"/></div>
                  <p className="text-gray-500 font-semibold">No requests right now</p>
                  <p className="text-gray-400 text-xs mt-1">Auto-refreshes every 12 seconds</p>
                  {dismissed.size > 0 && (
                    <button onClick={() => setDismissed(new Set())}
                      className="mt-3 text-xs text-green-600 font-bold bg-green-50 px-3 py-1.5 rounded-xl">
                      Show {dismissed.size} hidden request{dismissed.size > 1 ? "s" : ""}
                    </button>
                  )}
                </div>
              ) : (
                <div className="bg-white divide-y divide-gray-100">

                  {/* ─ ORDER Requests ─ */}
                  {orders.map((o: any) => (
                    <div key={o.id} className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                          <OrderTypeIcon type={o.type}/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <p className="font-extrabold text-gray-900 capitalize">{o.type} Delivery</p>
                            <RequestAge createdAt={o.createdAt} />
                          </div>
                          {o.vendorStoreName && (
                            <p className="text-xs text-blue-600 font-semibold truncate flex items-center gap-1">
                              <MapPin size={10}/> {o.vendorStoreName}
                            </p>
                          )}
                          <p className="text-xs text-gray-500 truncate mt-0.5 flex items-center gap-1">
                            <Navigation size={10}/> {o.deliveryAddress || "Destination"}
                          </p>
                          <div className="flex items-center gap-3 mt-2">
                            <div>
                              <p className="text-lg font-extrabold text-green-600">+{formatCurrency(getDeliveryEarn(o.type))}</p>
                              <p className="text-[10px] text-gray-400">your earnings</p>
                            </div>
                            {o.total && (
                              <div>
                                <p className="text-sm font-bold text-gray-700">{formatCurrency(o.total)}</p>
                                <p className="text-[10px] text-gray-400">order total</p>
                              </div>
                            )}
                            {o.itemCount && (
                              <div>
                                <p className="text-sm font-bold text-gray-700">{o.itemCount} items</p>
                                <p className="text-[10px] text-gray-400">to collect</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        {o.deliveryAddress && (
                          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.deliveryAddress)}`}
                            target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-600 text-xs font-bold px-3 py-2.5 rounded-xl">
                            <MapPin size={14}/>
                          </a>
                        )}
                        <button onClick={() => dismiss(o.id)}
                          className="bg-gray-100 text-gray-500 font-bold px-3 py-2.5 rounded-xl text-sm hover:bg-gray-200 transition-colors flex items-center">
                          <X size={16}/>
                        </button>
                        <button onClick={() => acceptOrderMut.mutate(o.id)}
                          disabled={acceptOrderMut.isPending || acceptRideMut.isPending}
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white font-extrabold py-2.5 rounded-xl text-sm disabled:opacity-60 transition-colors flex items-center justify-center gap-1.5">
                          <CheckCircle size={15}/>
                          {acceptOrderMut.isPending ? "Accepting..." : "Accept Order"}
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* ─ RIDE Requests ─ */}
                  {rides.map((r: any) => {
                    const isBargain    = r.status === "bargaining" && r.offeredFare != null;
                    const offeredFare  = r.offeredFare  ?? r.fare;
                    const effectiveFare = isBargain ? offeredFare : r.fare;
                    const earnings     = effectiveFare * (config.finance.riderEarningPct / 100);
                    const mapsUrl = (r.pickupLat && r.pickupLng)
                      ? `https://www.google.com/maps/dir/?api=1&origin=${r.pickupLat},${r.pickupLng}&destination=${r.dropLat},${r.dropLng}&travelmode=driving`
                      : `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(r.pickupAddress)}&destination=${encodeURIComponent(r.dropAddress)}&travelmode=driving`;
                    const svcName = SVC_NAMES[r.type] ?? r.type?.replace(/_/g, " ") ?? "Ride";

                    return (
                      <div key={r.id} className={`p-4 ${isBargain ? "border-l-4 border-orange-400 bg-orange-50/30" : ""}`}>
                        <div className="flex items-start gap-3">
                          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${isBargain ? "bg-orange-100" : "bg-green-50"}`}>
                            {isBargain ? <MessageSquare size={22} className="text-orange-500"/> : <RideTypeIcon type={r.type}/>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                              <p className="font-extrabold text-gray-900">{svcName} Ride</p>
                              {isBargain && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 animate-pulse flex items-center gap-1">
                                  <MessageSquare size={8}/> BARGAIN OFFER
                                </span>
                              )}
                              {isBargain && r.myBid && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 flex items-center gap-1">
                                  <CheckCircle size={8}/> Bid Submitted
                                </span>
                              )}
                              <RequestAge createdAt={r.createdAt} />
                            </div>
                            <p className="text-xs text-gray-500 truncate flex items-center gap-1">
                              <span className="w-2 h-2 bg-green-500 rounded-full inline-block flex-shrink-0"/>
                              {r.pickupAddress}
                            </p>
                            <p className="text-xs text-gray-400 truncate flex items-center gap-1">
                              <span className="w-2 h-2 bg-red-500 rounded-full inline-block flex-shrink-0"/>
                              {r.dropAddress}
                            </p>
                            <div className="flex items-center gap-4 mt-2 flex-wrap">
                              <div>
                                <p className={`text-lg font-extrabold ${isBargain ? "text-orange-600" : "text-green-600"}`}>
                                  +{formatCurrency(earnings)}
                                </p>
                                <p className="text-[10px] text-gray-400">your earnings</p>
                              </div>
                              {isBargain && (
                                <div>
                                  <p className="text-sm font-bold text-orange-700">{formatCurrency(offeredFare)}</p>
                                  <p className="text-[10px] text-gray-400">customer offer</p>
                                </div>
                              )}
                              {r.distance && (
                                <div>
                                  <p className="text-sm font-bold text-gray-700">{r.distance} km</p>
                                  <p className="text-[10px] text-gray-400">distance</p>
                                </div>
                              )}
                              <div>
                                <p className="text-sm font-bold text-gray-400 line-through">{formatCurrency(r.fare)}</p>
                                <p className="text-[10px] text-gray-400">platform fare</p>
                              </div>
                            </div>
                            {r.bargainNote && (
                              <p className="text-xs text-orange-700 mt-1.5 italic flex items-center gap-1">
                                <MessageSquare size={11}/> "{r.bargainNote}"
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Standard actions */}
                        {!isBargain && (
                          <div className="flex gap-2 mt-3">
                            <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-600 text-xs font-bold px-3 py-2.5 rounded-xl">
                              <MapPin size={14}/>
                            </a>
                            <button onClick={() => dismiss(r.id)}
                              className="bg-gray-100 text-gray-500 font-bold px-3 py-2.5 rounded-xl text-sm hover:bg-gray-200 transition-colors flex items-center">
                              <X size={16}/>
                            </button>
                            <button onClick={() => acceptRideMut.mutate(r.id)}
                              disabled={acceptRideMut.isPending || acceptOrderMut.isPending}
                              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-extrabold py-2.5 rounded-xl text-sm disabled:opacity-60 transition-colors flex items-center justify-center gap-1.5">
                              <CheckCircle size={15}/>
                              {acceptRideMut.isPending ? "Accepting..." : "Accept Ride"}
                            </button>
                          </div>
                        )}

                        {/* Bargaining actions */}
                        {isBargain && (
                          <div className="mt-3 space-y-2">
                            {r.myBid ? (
                              <div className="bg-orange-50 border-2 border-orange-300 rounded-xl p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-xs font-bold text-orange-700 flex items-center gap-1"><MessageSquare size={11}/> Aapka Bid Pending</p>
                                    <p className="text-lg font-extrabold text-orange-600">Rs. {Math.round(r.myBid.fare)}</p>
                                  </div>
                                  <span className="text-[10px] font-bold px-2 py-1 bg-orange-100 text-orange-600 rounded-full animate-pulse">
                                    WAITING FOR CUSTOMER
                                  </span>
                                </div>
                                <div className="flex gap-2">
                                  <input
                                    type="number" inputMode="numeric"
                                    value={counterInputs[r.id] || ""}
                                    onChange={e => setCounterInputs(prev => ({ ...prev, [r.id]: e.target.value }))}
                                    placeholder="Update bid..."
                                    className="flex-1 h-9 px-3 bg-white border border-orange-200 rounded-xl text-sm focus:outline-none focus:border-orange-400"
                                  />
                                  <button
                                    onClick={() => {
                                      const v = Number(counterInputs[r.id] || 0);
                                      if (v > 0) counterRideMut.mutate({ id: r.id, counterFare: v });
                                    }}
                                    disabled={counterRideMut.isPending}
                                    className="bg-orange-500 text-white font-bold px-3 py-2 rounded-xl text-sm disabled:opacity-60">
                                    Update
                                  </button>
                                  <button onClick={() => acceptRideMut.mutate(r.id)}
                                    disabled={acceptRideMut.isPending}
                                    className="bg-green-600 text-white font-bold px-3 py-2 rounded-xl text-sm disabled:opacity-60 flex items-center gap-1">
                                    <CheckCircle size={13}/> Accept
                                  </button>
                                </div>
                              </div>
                            ) : showCounter[r.id] ? (
                              <div className="flex gap-2">
                                <input
                                  type="number" inputMode="numeric"
                                  value={counterInputs[r.id] || ""}
                                  onChange={e => setCounterInputs(prev => ({ ...prev, [r.id]: e.target.value }))}
                                  placeholder="Your counter fare..."
                                  className="flex-1 h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-orange-400"
                                />
                                <button
                                  onClick={() => {
                                    const v = Number(counterInputs[r.id] || 0);
                                    if (v > 0) counterRideMut.mutate({ id: r.id, counterFare: v });
                                  }}
                                  disabled={counterRideMut.isPending}
                                  className="bg-orange-500 text-white font-extrabold px-4 py-2.5 rounded-xl text-sm disabled:opacity-60">
                                  {counterRideMut.isPending ? "..." : "Submit"}
                                </button>
                                <button onClick={() => setShowCounter(prev => ({ ...prev, [r.id]: false }))}
                                  className="bg-gray-100 text-gray-500 px-3 py-2.5 rounded-xl flex items-center">
                                  <X size={15}/>
                                </button>
                              </div>
                            ) : (
                              <div className="flex gap-2">
                                <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                                  className="flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-600 text-xs font-bold px-3 py-2.5 rounded-xl">
                                  <MapPin size={14}/>
                                </a>
                                <button onClick={() => rejectOfferMut.mutate(r.id)}
                                  className="bg-gray-100 text-gray-500 font-bold px-3 py-2.5 rounded-xl text-sm flex items-center">
                                  <X size={16}/>
                                </button>
                                <button onClick={() => setShowCounter(prev => ({ ...prev, [r.id]: true }))}
                                  className="flex-1 bg-orange-100 text-orange-700 font-extrabold py-2.5 rounded-xl text-sm flex items-center justify-center gap-1.5">
                                  <MessageSquare size={14}/> Counter Offer
                                </button>
                                <button onClick={() => acceptRideMut.mutate(r.id)}
                                  disabled={acceptRideMut.isPending || acceptOrderMut.isPending}
                                  className="flex-1 bg-green-600 text-white font-extrabold py-2.5 rounded-xl text-sm disabled:opacity-60 flex items-center justify-center gap-1.5">
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
          /* Offline state */
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
            <div className="flex justify-center mb-3">
              <Wifi size={40} className="text-gray-300"/>
            </div>
            <p className="text-gray-500 font-semibold">You are Offline</p>
            <p className="text-gray-400 text-xs mt-1">Toggle switch to start accepting orders</p>
          </div>
        )}

      </div>

      {/* ── TOAST ── */}
      {toastMsg && (
        <div className="fixed top-6 left-4 right-4 z-50 pointer-events-none">
          <div className="bg-gray-900 text-white text-sm font-semibold px-5 py-3.5 rounded-2xl shadow-2xl text-center">{toastMsg}</div>
        </div>
      )}
    </div>
  );
}
