import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { usePlatformConfig } from "../lib/useConfig";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${urgent ? "bg-red-100 text-red-600 animate-pulse" : "bg-gray-100 text-gray-500"}`}>
      ⏱ {label}
    </span>
  );
}

export default function Home() {
  const { user, refreshUser } = useAuth();
  const { config } = usePlatformConfig();
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
      showToast(newStatus ? "🟢 You are now Online!" : "🔴 You are now Offline");
    } catch (e: any) { showToast("❌ " + e.message); }
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

  // Detect truly NEW request IDs to trigger flash
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

  // Filter out dismissed
  const orders = allOrders.filter((o: any) => !dismissed.has(o.id));
  const rides  = allRides.filter((r: any) => !dismissed.has(r.id));
  const totalRequests = orders.length + rides.length;

  const dismiss = (id: string) => setDismissed(prev => new Set([...prev, id]));

  const acceptOrderMut = useMutation({
    mutationFn: (id: string) => api.acceptOrder(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      qc.invalidateQueries({ queryKey: ["rider-active"] });
      showToast("✅ Order accepted! Active tab mein dekho.");
    },
    onError: (e: any) => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      showToast("❌ " + (e.message || "Order accept nahi hua — shayad kisi ne pehle le liya"));
    },
  });

  const acceptRideMut = useMutation({
    mutationFn: (id: string) => api.acceptRide(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      qc.invalidateQueries({ queryKey: ["rider-active"] });
      showToast("✅ Ride accepted! Active tab mein dekho.");
    },
    onError: (e: any) => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      showToast("❌ " + (e.message || "Ride accept nahi hua — shayad kisi ne pehle le li"));
    },
  });

  const getDeliveryEarn = (type: string) => {
    const fee = (config.deliveryFee as Record<string, number>)[type] ?? config.deliveryFee.mart ?? 100;
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
            <p className="text-green-200 text-xs font-medium">
              <LiveClock /> · AJKMart Rider
            </p>
            <h1 className="text-2xl font-extrabold mt-0.5">{user?.name || "Rider"} 🏍️</h1>
          </div>
          <div className="text-right">
            <p className="text-green-200 text-xs">Wallet</p>
            <p className="font-extrabold text-xl">{formatCurrency(Number(user?.walletBalance) || 0)}</p>
          </div>
        </div>

        {/* Online/Offline Toggle */}
        <div className={`rounded-2xl p-4 transition-all ${user?.isOnline ? "bg-green-500/30 border border-green-400/40" : "bg-white/10 border border-white/10"}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${user?.isOnline ? "bg-green-300 animate-pulse" : "bg-gray-400"}`} />
                <p className="font-extrabold text-lg">{user?.isOnline ? "Online" : "Offline"}</p>
              </div>
              <p className="text-green-100 text-sm mt-0.5">
                {user?.isOnline ? "Accepting orders & rides" : "Tap to start working"}
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
            <span className="text-blue-500 text-base flex-shrink-0 mt-0.5">📌</span>
            <p className="text-sm text-blue-700 font-medium leading-snug flex-1">{config.content.riderNotice}</p>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { icon: "📦", label: "Today",  value: String(user?.stats?.deliveriesToday || 0),        sub: "deliveries" },
            { icon: "💰", label: "Earned", value: formatCurrency(user?.stats?.earningsToday || 0),  sub: "today"      },
            { icon: "📅", label: "Week",   value: formatCurrency(earningsData?.week?.earnings || 0), sub: "earnings"  },
            { icon: "🏆", label: "Total",  value: String(user?.stats?.totalDeliveries || 0),         sub: "lifetime"  },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl p-3 shadow-sm text-center">
              <p className="text-base mb-0.5">{s.icon}</p>
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
                  <span className="text-amber-500 font-bold text-xs bg-amber-100 px-2 py-1 rounded-full flex-shrink-0">Go →</span>
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
                    <span className="text-lg">📡</span>
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
                  <p className="text-4xl mb-2">🏍️</p>
                  <p className="text-gray-500 font-semibold">No requests right now</p>
                  <p className="text-gray-400 text-xs mt-1">Auto-refreshes every 12 seconds</p>
                  {dismissed.size > 0 && (
                    <button onClick={() => setDismissed(new Set())}
                      className="mt-3 text-xs text-green-600 font-bold bg-green-50 px-3 py-1.5 rounded-xl">
                      ↺ Show {dismissed.size} hidden request{dismissed.size > 1 ? "s" : ""}
                    </button>
                  )}
                </div>
              ) : (
                <div className="bg-white divide-y divide-gray-100">

                  {/* ─ ORDER Requests ─ */}
                  {orders.map((o: any) => (
                    <div key={o.id} className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-2xl flex-shrink-0">
                          {o.type === "food" ? "🍔" : o.type === "mart" ? "🛒" : o.type === "pharmacy" ? "💊" : "📦"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <p className="font-extrabold text-gray-900 capitalize">{o.type} Delivery</p>
                            <RequestAge createdAt={o.createdAt} />
                          </div>
                          {o.vendorStoreName && (
                            <p className="text-xs text-blue-600 font-semibold truncate">🏪 {o.vendorStoreName}</p>
                          )}
                          <p className="text-xs text-gray-500 truncate mt-0.5">📍 {o.deliveryAddress || "Destination"}</p>
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
                            🗺️
                          </a>
                        )}
                        <button onClick={() => dismiss(o.id)}
                          className="bg-gray-100 text-gray-500 font-bold px-3 py-2.5 rounded-xl text-sm hover:bg-gray-200 transition-colors">
                          ✕
                        </button>
                        <button onClick={() => acceptOrderMut.mutate(o.id)}
                          disabled={acceptOrderMut.isPending || acceptRideMut.isPending}
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white font-extrabold py-2.5 rounded-xl text-sm disabled:opacity-60 transition-colors">
                          {acceptOrderMut.isPending ? "Accepting..." : "✓ Accept Order"}
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* ─ RIDE Requests ─ */}
                  {rides.map((r: any) => (
                    <div key={r.id} className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-green-50 flex items-center justify-center text-2xl flex-shrink-0">
                          {r.type === "bike" ? "🏍️" : "🚗"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <p className="font-extrabold text-gray-900 capitalize">{r.type} Ride</p>
                            <RequestAge createdAt={r.createdAt} />
                          </div>
                          <p className="text-xs text-gray-500 truncate">🟢 {r.pickupAddress}</p>
                          <p className="text-xs text-gray-400 truncate">🔴 {r.dropAddress}</p>
                          <div className="flex items-center gap-4 mt-2">
                            <div>
                              <p className="text-lg font-extrabold text-green-600">+{formatCurrency(r.fare * (config.finance.riderEarningPct / 100))}</p>
                              <p className="text-[10px] text-gray-400">your earnings</p>
                            </div>
                            {r.distance && (
                              <div>
                                <p className="text-sm font-bold text-gray-700">{r.distance} km</p>
                                <p className="text-[10px] text-gray-400">distance</p>
                              </div>
                            )}
                            <div>
                              <p className="text-sm font-bold text-gray-700">{formatCurrency(r.fare)}</p>
                              <p className="text-[10px] text-gray-400">total fare</p>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        {(r.pickupLat && r.pickupLng) ? (
                          <a href={`https://www.google.com/maps/dir/?api=1&origin=${r.pickupLat},${r.pickupLng}&destination=${r.dropLat},${r.dropLng}&travelmode=driving`}
                            target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-600 text-xs font-bold px-3 py-2.5 rounded-xl">
                            🗺️
                          </a>
                        ) : r.pickupAddress ? (
                          <a href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(r.pickupAddress)}&destination=${encodeURIComponent(r.dropAddress)}&travelmode=driving`}
                            target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-600 text-xs font-bold px-3 py-2.5 rounded-xl">
                            🗺️
                          </a>
                        ) : null}
                        <button onClick={() => dismiss(r.id)}
                          className="bg-gray-100 text-gray-500 font-bold px-3 py-2.5 rounded-xl text-sm hover:bg-gray-200 transition-colors">
                          ✕
                        </button>
                        <button onClick={() => acceptRideMut.mutate(r.id)}
                          disabled={acceptRideMut.isPending || acceptOrderMut.isPending}
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white font-extrabold py-2.5 rounded-xl text-sm disabled:opacity-60 transition-colors">
                          {acceptRideMut.isPending ? "Accepting..." : "✓ Accept Ride"}
                        </button>
                      </div>
                    </div>
                  ))}

                  {dismissed.size > 0 && (
                    <div className="px-4 py-3 flex items-center justify-between bg-gray-50 border-t border-gray-100">
                      <p className="text-xs text-gray-400">{dismissed.size} dismissed request{dismissed.size > 1 ? "s" : ""}</p>
                      <button onClick={() => setDismissed(new Set())}
                        className="text-xs text-green-600 font-bold">
                        ↺ Show All
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
            <p className="text-5xl mb-3">😴</p>
            <p className="font-bold text-gray-700 text-lg">You're Offline</p>
            <p className="text-gray-400 text-sm mt-1">Toggle online above to start accepting orders</p>
            <button onClick={toggleOnline} disabled={toggling}
              className="mt-5 bg-green-600 text-white px-8 py-3 rounded-xl font-extrabold text-base disabled:opacity-60">
              🟢 Go Online Now
            </button>
          </div>
        )}

        {/* ── Quick Links ── */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { href: "/history",  icon: "📋", label: "History"  },
            { href: "/earnings", icon: "📈", label: "Earnings" },
            { href: "/wallet",   icon: "💳", label: "Wallet"   },
          ].map(link => (
            <Link key={link.href} href={link.href}
              className="bg-white rounded-2xl p-4 shadow-sm text-center flex flex-col items-center gap-1.5 hover:bg-green-50 transition-colors">
              <span className="text-2xl">{link.icon}</span>
              <span className="text-xs font-bold text-gray-600">{link.label}</span>
            </Link>
          ))}
        </div>

        {/* Feature disabled notices */}
        {!config.features.liveTracking && (
          <div className="bg-amber-50 border border-amber-300 rounded-2xl px-4 py-3 flex items-center gap-3">
            <span className="text-lg">📍</span>
            <div>
              <p className="text-xs font-bold text-amber-800">Live Tracking Disabled</p>
              <p className="text-xs text-amber-600">Orders manual accept karein.</p>
            </div>
          </div>
        )}
        {config.rider?.cashAllowed === false && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-start gap-3">
            <span className="text-amber-500 text-base flex-shrink-0 mt-0.5">💵</span>
            <p className="text-sm text-amber-700 font-medium leading-snug">Cash-on-delivery disabled by admin.</p>
          </div>
        )}
      </div>

      {/* WhatsApp Chat Support FAB */}
      {config.features.chat && (
        <a href={`https://wa.me/${config.platform.supportPhone?.replace(/^0/, "92")}`}
          target="_blank" rel="noopener noreferrer"
          className="fixed bottom-24 right-4 z-50 w-14 h-14 bg-green-500 hover:bg-green-600 text-white rounded-full shadow-2xl flex items-center justify-center text-2xl transition-all active:scale-95">
          💬
        </a>
      )}

      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-6 left-4 right-4 z-50 bg-gray-900 text-white text-sm font-semibold px-4 py-3 rounded-2xl shadow-2xl text-center">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
