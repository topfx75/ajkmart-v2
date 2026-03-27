import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "../lib/api";

const fd = (d: string | Date) => {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(d).toLocaleString("en-PK", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" });
};

type NFilter = "all" | "order" | "wallet" | "ride" | "system";

function typeInfo(type: string) {
  if (type === "order")  return { emoji: "📦", label: "Order",  bg: "bg-blue-100",   text: "text-blue-700",   badge: "bg-blue-100 text-blue-700"   };
  if (type === "wallet") return { emoji: "💰", label: "Wallet", bg: "bg-green-100",  text: "text-green-700",  badge: "bg-green-100 text-green-700"  };
  if (type === "ride")   return { emoji: "🏍️", label: "Ride",   bg: "bg-purple-100", text: "text-purple-700", badge: "bg-purple-100 text-purple-700" };
  if (type === "system") return { emoji: "⚙️", label: "System", bg: "bg-gray-100",   text: "text-gray-600",   badge: "bg-gray-100 text-gray-600"    };
  if (type === "alert")  return { emoji: "⚠️", label: "Alert",  bg: "bg-amber-100",  text: "text-amber-700",  badge: "bg-amber-100 text-amber-700"  };
  return                        { emoji: "🔔", label: "Other",  bg: "bg-gray-100",   text: "text-gray-600",   badge: "bg-gray-100 text-gray-600"    };
}

function navTarget(type: string) {
  if (type === "order")  return "/active";
  if (type === "ride")   return "/active";
  if (type === "wallet") return "/wallet";
  return null;
}

const FILTER_TABS: { key: NFilter; label: string; emoji: string }[] = [
  { key: "all",    label: "All",    emoji: "🔔" },
  { key: "order",  label: "Orders", emoji: "📦" },
  { key: "wallet", label: "Wallet", emoji: "💰" },
  { key: "ride",   label: "Rides",  emoji: "🏍️" },
  { key: "system", label: "System", emoji: "⚙️" },
];

export default function Notifications() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<NFilter>("all");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["rider-notifications"],
    queryFn: () => api.getNotifications(),
    refetchInterval: 30000,
  });

  const notifs: any[] = data?.notifications || [];
  const unread: number = data?.unread || 0;

  const markAllMut = useMutation({
    mutationFn: () => api.markAllRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rider-notifications"] });
      qc.invalidateQueries({ queryKey: ["rider-notifs-count"] });
    },
  });

  const filtered = filter === "all" ? notifs : notifs.filter(n => n.type === filter || (filter === "system" && !["order","wallet","ride"].includes(n.type)));

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-br from-green-600 to-emerald-700 px-5 pt-12 pb-6">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h1 className="text-2xl font-bold text-white">Notifications</h1>
            <p className="text-green-200 text-sm mt-0.5">
              {unread > 0 ? `${unread} unread` : "All caught up ✓"}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => refetch()}
              className="h-9 w-9 bg-white/20 text-white text-sm font-bold rounded-xl flex items-center justify-center">
              ↻
            </button>
            {unread > 0 && (
              <button onClick={() => markAllMut.mutate()} disabled={markAllMut.isPending}
                className="h-9 px-4 bg-white/20 text-white text-sm font-bold rounded-xl">
                ✓ Mark All Read
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Filter Tabs */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {FILTER_TABS.map(tab => (
            <button key={tab.key} onClick={() => setFilter(tab.key)}
              className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-bold transition-all ${filter === tab.key ? "bg-green-600 text-white shadow-sm" : "bg-white text-gray-500"}`}>
              {tab.emoji} {tab.label}
              {tab.key !== "all" && notifs.filter(n => n.type === tab.key && !n.isRead).length > 0 && (
                <span className="ml-1 bg-red-500 text-white text-[9px] font-extrabold rounded-full px-1.5">
                  {notifs.filter(n => n.type === tab.key && !n.isRead).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Stats Summary */}
        {notifs.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Total",  value: notifs.length,                                       bg: "bg-white"       },
              { label: "Orders", value: notifs.filter(n => n.type === "order").length,        bg: "bg-blue-50"     },
              { label: "Wallet", value: notifs.filter(n => n.type === "wallet").length,       bg: "bg-green-50"    },
              { label: "Rides",  value: notifs.filter(n => n.type === "ride").length,         bg: "bg-purple-50"   },
            ].map(s => (
              <div key={s.label} className={`${s.bg} rounded-2xl p-2.5 text-center shadow-sm`}>
                <p className="text-base font-extrabold text-gray-800">{s.value}</p>
                <p className="text-[10px] text-gray-400 mt-0.5 font-medium">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[1,2,3,4,5].map(i => <div key={i} className="h-20 bg-white rounded-2xl animate-pulse shadow-sm"/>)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm px-4 py-16 text-center">
            <p className="text-5xl mb-4">🔔</p>
            <p className="font-bold text-gray-700">
              {filter === "all" ? "No notifications yet" : `No ${filter} notifications`}
            </p>
            <p className="text-sm text-gray-400 mt-1">
              {filter === "all" ? "Order & delivery alerts will appear here" : "Try a different filter above"}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <p className="text-sm font-bold text-gray-700">
                {filter === "all" ? `${filtered.length} notifications` : `${filtered.length} ${filter} notifications`}
              </p>
              {unread > 0 && (
                <span className="text-xs font-extrabold bg-red-100 text-red-600 px-2.5 py-1 rounded-full">
                  {unread} unread
                </span>
              )}
            </div>
            <div className="divide-y divide-gray-50">
              {filtered.map((n: any) => {
                const info = typeInfo(n.type);
                const dest = navTarget(n.type);
                const Wrapper = dest ? "button" : "div";
                return (
                  <Wrapper key={n.id}
                    className={`w-full px-4 py-4 flex gap-3 text-left transition-colors ${!n.isRead ? "bg-green-50/50" : ""} ${dest ? "hover:bg-gray-50 active:bg-gray-100 cursor-pointer" : ""}`}
                    onClick={dest ? () => navigate(dest) : undefined}>
                    {/* Icon */}
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 text-2xl ${!n.isRead ? info.bg : "bg-gray-100"}`}>
                      {info.emoji}
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm font-bold leading-snug ${!n.isRead ? "text-gray-900" : "text-gray-700"}`}>
                          {n.title}
                        </p>
                        {!n.isRead && (
                          <div className="w-2.5 h-2.5 bg-green-500 rounded-full flex-shrink-0 mt-1"/>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{n.body}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] text-gray-400 font-medium">{fd(n.createdAt)}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${info.badge}`}>
                          {info.label}
                        </span>
                        {dest && (
                          <span className="text-[10px] text-green-600 font-bold">→ Tap to view</span>
                        )}
                      </div>
                    </div>
                  </Wrapper>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
