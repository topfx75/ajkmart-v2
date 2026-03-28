import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Bell, Package, Wallet, Bike, Settings, AlertTriangle,
  RefreshCw, CheckCheck, ChevronRight, Check, Inbox,
  Clock, Sparkles,
} from "lucide-react";
import { api } from "../lib/api";
import { useLanguage } from "../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";

const fd = (d: string | Date) => {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(d).toLocaleString("en-PK", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

function dateGroup(d: string): string {
  const now = new Date();
  const dt  = new Date(d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (dt >= today) return "Today";
  if (dt >= yesterday) return "Yesterday";
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
  if (dt >= weekAgo) return "This Week";
  return "Earlier";
}

type NFilter = "all" | "order" | "wallet" | "ride" | "system";

type NotifRecord = {
  id: string; type: string; title: string; body: string;
  isRead: boolean; createdAt: string;
};

type TypeInfo = {
  icon: React.ReactElement;
  label: string;
  bg: string;
  text: string;
  badge: string;
  iconBg: string;
};

function typeInfo(type: string): TypeInfo {
  if (type === "order")  return { icon: <Package  size={20} className="text-blue-600"/>,   label: "Order",  bg: "bg-blue-50",    text: "text-blue-700",   badge: "bg-blue-100 text-blue-700",   iconBg: "bg-blue-100"   };
  if (type === "wallet") return { icon: <Wallet   size={20} className="text-green-600"/>,  label: "Wallet", bg: "bg-green-50",   text: "text-green-700",  badge: "bg-green-100 text-green-700",  iconBg: "bg-green-100"  };
  if (type === "ride")   return { icon: <Bike     size={20} className="text-purple-600"/>, label: "Ride",   bg: "bg-purple-50",  text: "text-purple-700", badge: "bg-purple-100 text-purple-700", iconBg: "bg-purple-100" };
  if (type === "system") return { icon: <Settings size={20} className="text-gray-500"/>,   label: "System", bg: "bg-gray-50",    text: "text-gray-600",   badge: "bg-gray-100 text-gray-600",    iconBg: "bg-gray-100"   };
  if (type === "alert")  return { icon: <AlertTriangle size={20} className="text-amber-500"/>, label: "Alert", bg: "bg-amber-50", text: "text-amber-700", badge: "bg-amber-100 text-amber-700", iconBg: "bg-amber-100" };
  return                        { icon: <Bell     size={20} className="text-gray-500"/>,   label: "Other",  bg: "bg-gray-50",    text: "text-gray-600",   badge: "bg-gray-100 text-gray-600",    iconBg: "bg-gray-100"   };
}

function navTarget(type: string): string | null {
  if (type === "order")  return "/active";
  if (type === "ride")   return "/active";
  if (type === "wallet") return "/wallet";
  return null;
}

type FilterTab = { key: NFilter; label: string; icon: React.ReactElement };
const FILTER_TABS: FilterTab[] = [
  { key: "all",    label: "All",    icon: <Bell size={13}/>     },
  { key: "order",  label: "Orders", icon: <Package size={13}/>  },
  { key: "wallet", label: "Wallet", icon: <Wallet size={13}/>   },
  { key: "ride",   label: "Rides",  icon: <Bike size={13}/>     },
  { key: "system", label: "System", icon: <Settings size={13}/> },
];

export default function Notifications() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<NFilter>("all");
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["rider-notifications"],
    queryFn: () => api.getNotifications(),
    refetchInterval: 30000,
  });

  const notifs: NotifRecord[] = data?.notifications || [];
  const unread: number = data?.unread || 0;

  const [toast, setToast] = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const markAllMut = useMutation({
    mutationFn: () => api.markAllRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rider-notifications"] });
      qc.invalidateQueries({ queryKey: ["rider-notifs-count"] });
    },
    onError: (err: Error) => showToast(err.message || "Failed to mark all as read"),
  });

  const markOneMut = useMutation({
    mutationFn: (id: string) => api.markOneRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rider-notifications"] });
      qc.invalidateQueries({ queryKey: ["rider-notifs-count"] });
    },
    onError: (err: Error) => showToast(err.message || "Failed to mark as read"),
  });

  const filtered = filter === "all" ? notifs : notifs.filter(n => n.type === filter || (filter === "system" && !["order","wallet","ride"].includes(n.type)));

  const grouped = useMemo(() => {
    const groups: { label: string; items: NotifRecord[] }[] = [];
    const groupMap = new Map<string, NotifRecord[]>();
    for (const n of filtered) {
      const g = dateGroup(n.createdAt);
      if (!groupMap.has(g)) {
        groupMap.set(g, []);
        groups.push({ label: g, items: groupMap.get(g)! });
      }
      groupMap.get(g)!.push(n);
    }
    return groups;
  }, [filtered]);

  const filterCounts = useMemo(() => ({
    all:    notifs.filter(n => !n.isRead).length,
    order:  notifs.filter(n => n.type === "order" && !n.isRead).length,
    wallet: notifs.filter(n => n.type === "wallet" && !n.isRead).length,
    ride:   notifs.filter(n => n.type === "ride" && !n.isRead).length,
    system: notifs.filter(n => !["order","wallet","ride"].includes(n.type) && !n.isRead).length,
  }), [notifs]);

  return (
    <div className="min-h-screen bg-gray-50 pb-24">

      {/* ══ HEADER ══ */}
      <div className="bg-gradient-to-br from-green-600 via-emerald-600 to-teal-700 px-5 pt-12 pb-8 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.07]">
          <div className="absolute top-0 right-0 w-56 h-56 bg-white rounded-full -translate-y-1/3 translate-x-1/4"/>
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-white rounded-full translate-y-1/3 -translate-x-1/4"/>
        </div>
        <div className="relative flex items-center justify-between mb-3">
          <div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">{T("notificationsTitle")}</h1>
            <p className="text-green-200 text-sm mt-0.5 flex items-center gap-1.5">
              {unread > 0 ? (
                <><span className="w-2 h-2 bg-red-400 rounded-full animate-pulse"/>{unread} {T("unread")}</>
              ) : (
                <><Sparkles size={13}/> {T("allCaughtUp")}</>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => refetch()}
              className="h-10 w-10 bg-white/15 backdrop-blur-sm text-white rounded-xl flex items-center justify-center border border-white/10 active:bg-white/25 transition-colors">
              <RefreshCw size={16}/>
            </button>
            {unread > 0 && (
              <button onClick={() => markAllMut.mutate()} disabled={markAllMut.isPending}
                className="h-10 px-4 bg-white/15 backdrop-blur-sm text-white text-sm font-bold rounded-xl flex items-center gap-1.5 border border-white/10 active:bg-white/25 transition-colors disabled:opacity-60">
                <CheckCheck size={15}/> {T("readAll")}
              </button>
            )}
          </div>
        </div>

        {/* ── Stats Summary ── */}
        {notifs.length > 0 && (
          <div className="relative grid grid-cols-4 gap-2 mt-2">
            {[
              { label: "Total",  value: notifs.length,                                      color: "text-white"     },
              { label: "Orders", value: notifs.filter(n => n.type === "order").length,       color: "text-blue-200"  },
              { label: "Wallet", value: notifs.filter(n => n.type === "wallet").length,      color: "text-green-200" },
              { label: "Rides",  value: notifs.filter(n => n.type === "ride").length,        color: "text-purple-200"},
            ].map(s => (
              <div key={s.label} className="bg-white/10 backdrop-blur-sm rounded-xl p-2.5 text-center border border-white/5">
                <p className={`text-lg font-extrabold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-green-200 mt-0.5 font-medium">{s.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 py-4 space-y-3">

        {/* ── Filter Tabs ── */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {FILTER_TABS.map(tab => (
            <button key={tab.key} onClick={() => setFilter(tab.key)}
              className={`flex-shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border ${
                filter === tab.key
                  ? "bg-green-600 text-white border-green-600 shadow-sm"
                  : "bg-white text-gray-500 border-gray-100 active:bg-gray-50"
              }`}>
              {tab.icon} {tab.label}
              {filterCounts[tab.key] > 0 && (
                <span className={`text-[9px] font-extrabold rounded-full px-1.5 py-0.5 ${
                  filter === tab.key ? "bg-white/20 text-white" : "bg-red-500 text-white"
                }`}>
                  {filterCounts[tab.key]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        {isLoading ? (
          <div className="space-y-3">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 animate-pulse">
                <div className="flex gap-3">
                  <div className="w-12 h-12 bg-gray-100 rounded-xl"/>
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-100 rounded w-3/4"/>
                    <div className="h-3 bg-gray-50 rounded w-full"/>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-16 text-center">
            <div className="w-20 h-20 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Inbox size={40} className="text-gray-200"/>
            </div>
            <p className="font-bold text-gray-700 text-lg">
              {filter === "all" ? T("noNotificationsYet") : `${T("noNotifications")}`}
            </p>
            <p className="text-sm text-gray-400 mt-1.5 max-w-[260px] mx-auto leading-relaxed">
              {filter === "all" ? T("orderAlertsAppearHere") : T("tryDifferentFilter")}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {grouped.map(group => (
              <div key={group.label}>
                <div className="flex items-center gap-2 mb-2 px-1">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{group.label}</p>
                  <div className="flex-1 h-px bg-gray-200"/>
                  <span className="text-[10px] text-gray-400 font-medium">{group.items.length}</span>
                </div>
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-50">
                  {group.items.map((n: NotifRecord) => {
                    const info = typeInfo(n.type);
                    const dest = navTarget(n.type);
                    return (
                      <div key={n.id}
                        className={`px-4 py-4 flex gap-3 transition-colors ${!n.isRead ? "bg-green-50/40" : ""}`}>
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${!n.isRead ? info.iconBg : "bg-gray-50"}`}>
                          {info.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={`text-sm font-bold leading-snug ${!n.isRead ? "text-gray-900" : "text-gray-600"}`}>
                              {n.title}
                            </p>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {!n.isRead && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); markOneMut.mutate(n.id); }}
                                  className="w-7 h-7 rounded-lg bg-green-100 text-green-600 flex items-center justify-center active:bg-green-200 transition-colors"
                                  title="Mark as read"
                                >
                                  <Check size={14}/>
                                </button>
                              )}
                              {!n.isRead && <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0"/>}
                            </div>
                          </div>
                          <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-2">{n.body}</p>
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <span className="text-[10px] text-gray-400 font-medium flex items-center gap-0.5">
                              <Clock size={10}/> {fd(n.createdAt)}
                            </span>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${info.badge}`}>
                              {info.label}
                            </span>
                            {dest && (
                              <button
                                onClick={() => navigate(dest)}
                                className="text-[10px] text-green-600 font-bold flex items-center gap-0.5 bg-green-50 px-2 py-0.5 rounded-full active:bg-green-100 transition-colors"
                              >
                                View <ChevronRight size={10}/>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed top-6 left-4 right-4 z-50 pointer-events-none">
          <div className="bg-red-600 text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-2xl text-center">{toast}</div>
        </div>
      )}
    </div>
  );
}
