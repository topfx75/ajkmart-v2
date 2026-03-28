import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { usePlatformConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { tDual } from "@workspace/i18n";
import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { fc, CARD, STAT_VAL, STAT_LBL } from "../lib/ui";

function VendorNoticeBanner({ message }: { message: string }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3 flex items-start gap-3 mb-2">
      <span className="text-blue-500 text-base flex-shrink-0 mt-0.5">📌</span>
      <p className="text-sm text-blue-700 font-medium leading-snug flex-1">{message}</p>
      <button onClick={() => setDismissed(true)} className="text-blue-400 hover:text-blue-600 text-lg leading-none flex-shrink-0">×</button>
    </div>
  );
}

export default function Dashboard() {
  const { user, refreshUser } = useAuth();
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: Parameters<typeof tDual>[0]) => tDual(key, language);
  const qc = useQueryClient();
  const [toast, setToast] = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const { data: stats, isLoading } = useQuery({ queryKey: ["vendor-stats"], queryFn: () => api.getStats(), refetchInterval: 30000 });
  const { data: ordersData } = useQuery({ queryKey: ["vendor-orders", "all"], queryFn: () => api.getOrders(), refetchInterval: 20000 });

  const toggleMut = useMutation({
    mutationFn: (isOpen: boolean) => api.updateStore({ storeIsOpen: isOpen }),
    onSuccess: () => { refreshUser(); qc.invalidateQueries({ queryKey: ["vendor-stats"] }); },
    onError: (e: any) => showToast("❌ " + e.message),
  });

  const acceptMut = useMutation({
    mutationFn: (id: string) => api.updateOrder(id, "confirmed"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor-orders"] }); qc.invalidateQueries({ queryKey: ["vendor-stats"] }); showToast("✅ Order confirmed!"); },
    onError: (e: any) => showToast("❌ " + e.message),
  });

  const allOrders = ordersData?.orders || [];
  const pendingOrders = allOrders.filter((o: any) => o.status === "pending");
  const activeOrders  = allOrders.filter((o: any) => ["confirmed","preparing","ready"].includes(o.status));

  const statItems = [
    { label: T("todaysOrders"),   value: isLoading ? "—" : String(stats?.today?.orders ?? 0),  color: "text-orange-500", bg: "bg-orange-50",  icon: "📦" },
    { label: T("todaysRevenue"),  value: isLoading ? "—" : fc(stats?.today?.revenue ?? 0),      color: "text-amber-600",  bg: "bg-amber-50",   icon: "💰" },
    { label: T("weeklyRevenue"),  value: isLoading ? "—" : fc(stats?.week?.revenue ?? 0),       color: "text-blue-600",   bg: "bg-blue-50",    icon: "📅" },
    { label: T("monthlyRevenue"), value: isLoading ? "—" : fc(stats?.month?.revenue ?? 0),      color: "text-purple-600", bg: "bg-purple-50",  icon: "📈" },
  ];

  return (
    <div className="bg-gray-50 md:bg-transparent">
      {/* ── Header ── */}
      <PageHeader
        title={user?.storeName || "Dashboard"}
        subtitle={user?.storeCategory ? `${user.storeCategory} · ${config.platform.appName} Partner` : `${config.platform.appName} Vendor Portal`}
        actions={
          <div className="flex items-center gap-2">
            <span className="hidden md:block text-sm text-gray-500 font-medium">Store:</span>
            <button
              onClick={() => toggleMut.mutate(!user?.storeIsOpen)}
              disabled={toggleMut.isPending}
              className={`relative h-8 w-14 rounded-full transition-all duration-300 flex-shrink-0 focus:outline-none
                ${user?.storeIsOpen ? "bg-green-400" : "bg-gray-300"}`}
            >
              <div className={`w-6 h-6 bg-white rounded-full absolute top-1 shadow-md transition-all duration-300 ${user?.storeIsOpen ? "left-7" : "left-1"}`} />
            </button>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${user?.storeIsOpen ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
              {user?.storeIsOpen ? "Open" : "Closed"}
            </span>
          </div>
        }
        mobileContent={
          <div className="flex items-center justify-between bg-white/20 rounded-2xl px-4 py-2.5">
            <div>
              <p className="text-orange-100 text-xs font-medium">{T("walletBalance")}</p>
              <p className="text-2xl font-extrabold text-white">{fc(user?.walletBalance || 0)}</p>
            </div>
            <div className="text-right">
              <p className="text-orange-100 text-xs font-medium">{T("storeStatus")}</p>
              <button onClick={() => toggleMut.mutate(!user?.storeIsOpen)} disabled={toggleMut.isPending}
                className={`w-14 h-7 rounded-full relative transition-all duration-300 block mt-1 ${user?.storeIsOpen ? "bg-green-400" : "bg-white/30"}`}>
                <div className={`w-5 h-5 bg-white rounded-full absolute top-1 shadow transition-all duration-300 ${user?.storeIsOpen ? "left-8" : "left-1"}`} />
              </button>
            </div>
          </div>
        }
      />

      <div className="px-4 py-4 space-y-4 md:px-0 md:py-0 md:space-y-0">
        {/* Vendor Notice Banner */}
        {config.content.vendorNotice && (
          <VendorNoticeBanner message={config.content.vendorNotice} />
        )}
        {/* Desktop wallet bar */}
        <div className="hidden md:flex items-center gap-4 px-6 py-4 bg-gradient-to-r from-orange-500 to-amber-500 rounded-2xl text-white shadow-sm mb-6">
          <div className="flex-1">
            <p className="text-orange-100 text-xs font-medium">{T("walletBalance")}</p>
            <p className="text-3xl font-extrabold">{fc(user?.walletBalance || 0)}</p>
          </div>
          <div className="text-center border-l border-white/20 pl-4">
            <p className="text-orange-100 text-xs font-medium">{T("commission")}</p>
            <p className="text-3xl font-extrabold">{Math.round(100 - (config.platform.vendorCommissionPct ?? 15))}%</p>
          </div>
          <div className="text-right border-l border-white/20 pl-4">
            <p className="text-orange-100 text-xs font-medium">{T("allTimeEarned")}</p>
            <p className="text-xl font-extrabold">{fc(user?.stats?.totalRevenue || 0)}</p>
          </div>
        </div>

        {/* ── Stats ── */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:mb-6">
          {statItems.map(s => (
            <div key={s.label} className={`${CARD} p-4 md:p-5`}>
              <div className={`w-10 h-10 ${s.bg} rounded-xl flex items-center justify-center text-xl mb-3`}>{s.icon}</div>
              <p className={`${STAT_VAL} ${s.color} text-xl md:text-2xl`}>{s.value}</p>
              <p className={`${STAT_LBL}`}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* Low Stock Alert */}
        {(stats?.lowStock ?? 0) > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center gap-3 md:mb-6">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="font-bold text-red-700 text-sm">{stats.lowStock} Products Low on Stock</p>
              <p className="text-red-500 text-xs mt-0.5">Go to Products → update stock</p>
            </div>
          </div>
        )}

        {/* ── Desktop: 2-column layout for orders ── */}
        <div className="md:grid md:grid-cols-2 md:gap-6 space-y-4 md:space-y-0">
          {/* Pending Orders */}
          <div>
            {pendingOrders.length > 0 ? (
              <div className={CARD}>
                <div className="px-4 py-3.5 border-b border-orange-100 bg-orange-50 flex items-center gap-2">
                  <span className="text-lg">🔔</span>
                  <div>
                    <p className="font-bold text-orange-800 text-sm">{pendingOrders.length} New Order{pendingOrders.length > 1 ? "s" : ""}!</p>
                    <p className="text-orange-500 text-xs">Accept within 5 minutes</p>
                  </div>
                </div>
                <div className="divide-y divide-gray-50">
                  {pendingOrders.map((o: any) => (
                    <div key={o.id} className="px-4 py-3 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-xl flex-shrink-0">
                        {o.type === "food" ? "🍔" : "🛒"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-gray-800 capitalize">{o.type} Order</p>
                        <p className="text-xs text-gray-400 font-mono">#{o.id.slice(-6).toUpperCase()} · {fc(o.total)}</p>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <button onClick={() => acceptMut.mutate(o.id)} disabled={acceptMut.isPending}
                          className="h-9 px-4 bg-green-500 text-white text-xs font-bold rounded-xl android-press min-h-0">✓ Accept</button>
                        <button onClick={() => api.updateOrder(o.id, "cancelled").then(() => qc.invalidateQueries({ queryKey: ["vendor-orders"] }))}
                          className="h-9 px-3 bg-red-50 text-red-600 text-xs font-bold rounded-xl android-press min-h-0">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className={`${CARD} px-4 py-10 text-center`}>
                <p className="text-4xl mb-2">📋</p>
                <p className="font-bold text-gray-500 text-sm">No pending orders</p>
                <p className="text-xs text-gray-400 mt-1">New orders appear here instantly</p>
              </div>
            )}
          </div>

          {/* Active Orders */}
          <div>
            {activeOrders.length > 0 ? (
              <div className={CARD}>
                <div className="px-4 py-3.5 border-b border-gray-100 flex items-center justify-between">
                  <p className="font-bold text-gray-800 text-sm">{activeOrders.length} Active Order{activeOrders.length > 1 ? "s" : ""}</p>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">In Progress</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {activeOrders.map((o: any) => (
                    <div key={o.id} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-sm text-gray-800 capitalize">{o.type} Order</p>
                        <p className="text-xs text-gray-400 font-mono">#{o.id.slice(-6).toUpperCase()}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-sm text-gray-800">{fc(o.total)}</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          o.status === "preparing" ? "bg-purple-100 text-purple-700" :
                          o.status === "ready" ? "bg-indigo-100 text-indigo-700" : "bg-blue-100 text-blue-700"
                        }`}>{o.status.toUpperCase()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className={`${CARD} px-4 py-10 text-center`}>
                <p className="text-4xl mb-2">🍳</p>
                <p className="font-bold text-gray-500 text-sm">No active orders</p>
                <p className="text-xs text-gray-400 mt-1">Accepted orders show here</p>
              </div>
            )}
          </div>
        </div>

        {/* Commission Banner — mobile only (desktop shows in header) */}
        <div className="md:hidden bg-gradient-to-r from-orange-500 to-amber-500 rounded-2xl p-4 text-white shadow-sm">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm text-orange-100 font-medium">Your Commission</p>
              <p className="text-4xl font-extrabold">{Math.round(100 - (config.platform.vendorCommissionPct ?? 15))}%</p>
              <p className="text-xs text-orange-100 mt-0.5">of every order value</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-orange-100">All-Time Earned</p>
              <p className="text-2xl font-extrabold">{fc(user?.stats?.totalRevenue || 0)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Live Tracking disabled notice */}
      {!config.features.liveTracking && (
        <div className="fixed bottom-24 left-4 right-4 z-40 bg-amber-50 border border-amber-300 rounded-2xl px-4 py-3 flex items-center gap-3 shadow-lg md:max-w-sm md:left-auto md:right-6">
          <span className="text-lg">📍</span>
          <div>
            <p className="text-xs font-bold text-amber-800">Live Tracking Disabled</p>
            <p className="text-xs text-amber-600">Admin ne live tracking band ki hai</p>
          </div>
        </div>
      )}

      {/* Chat Support FAB (only when feature_chat is on) */}
      {config.features.chat && (
        <a href={`https://wa.me/${config.platform.supportPhone.replace(/^0/, "92")}`} target="_blank" rel="noopener noreferrer"
          className="fixed bottom-24 right-4 z-50 w-14 h-14 bg-green-500 hover:bg-green-600 text-white rounded-full shadow-2xl flex items-center justify-center text-2xl transition-all active:scale-95 md:bottom-6"
          title={config.content.supportMsg || "Live Support"}>
          💬
        </a>
      )}

      {toast && (
        <div className="fixed top-0 left-0 right-0 z-50 flex justify-center toast-in"
          style={{ paddingTop: "calc(env(safe-area-inset-top,0px) + 8px)", paddingLeft: "16px", paddingRight: "16px" }}>
          <div className="bg-gray-900 text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-2xl max-w-sm w-full text-center">{toast}</div>
        </div>
      )}
    </div>
  );
}
