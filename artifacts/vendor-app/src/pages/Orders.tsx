import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Header } from "../components/Header";

function fc(n: number) { return `Rs. ${Math.round(n).toLocaleString()}`; }
function fd(d: string | Date) {
  return new Date(d).toLocaleString("en-PK", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const TABS = [
  { key: "new",       label: "New",       icon: "🔔" },
  { key: "active",    label: "Preparing", icon: "🍳" },
  { key: "delivered", label: "Delivered", icon: "✅" },
  { key: "all",       label: "All",       icon: "📋" },
];

const NEXT_STATUS: Record<string, { next: string; label: string; color: string }> = {
  pending:   { next: "confirmed", label: "✓ Accept Order",    color: "bg-green-500 text-white" },
  confirmed: { next: "preparing", label: "🍳 Start Preparing", color: "bg-blue-500 text-white" },
  preparing: { next: "ready",     label: "📦 Mark as Ready",   color: "bg-purple-500 text-white" },
};

const STATUS_BADGE: Record<string, string> = {
  pending:   "bg-yellow-100 text-yellow-700",
  confirmed: "bg-blue-100 text-blue-700",
  preparing: "bg-purple-100 text-purple-700",
  ready:     "bg-indigo-100 text-indigo-700",
  delivered: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
};

export default function Orders() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("new");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const { data, isLoading, refetch } = useQuery({ queryKey: ["vendor-orders", tab], queryFn: () => api.getOrders(tab), refetchInterval: 15000 });
  const orders = data?.orders || [];

  const newCount = useQuery({ queryKey: ["vendor-orders-count"], queryFn: () => api.getOrders("new"), refetchInterval: 15000 });
  const newOrderCount = newCount.data?.orders?.length || 0;

  const updateMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.updateOrder(id, status),
    onSuccess: (_, { status }) => {
      qc.invalidateQueries({ queryKey: ["vendor-orders"] });
      qc.invalidateQueries({ queryKey: ["vendor-stats"] });
      qc.invalidateQueries({ queryKey: ["vendor-orders-count"] });
      const msgs: Record<string, string> = { confirmed: "✅ Order accepted!", preparing: "🍳 Preparing started", ready: "📦 Marked as ready", cancelled: "❌ Order cancelled" };
      showToast(msgs[status] || "✅ Updated");
    },
    onError: (e: any) => showToast("❌ " + e.message),
  });

  return (
    <div className="min-h-screen bg-gray-50 page-enter">
      <Header pb="pb-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Orders</h1>
            <p className="text-orange-100 text-sm">{orders.length} {tab === "all" ? "total" : tab} orders</p>
          </div>
          <button onClick={() => refetch()} className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center text-white text-lg android-press min-h-0">↻</button>
        </div>
      </Header>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-100 flex sticky top-0 z-10 card-1">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex flex-col items-center py-2.5 text-xs font-bold transition-colors border-b-2 relative android-press min-h-0 ${tab === t.key ? "border-orange-500 text-orange-600" : "border-transparent text-gray-400"}`}
          >
            <span className="text-base mb-0.5">{t.icon}</span>
            {t.label}
            {t.key === "new" && newOrderCount > 0 && (
              <span className="absolute top-1 right-1/4 -translate-x-1 bg-red-500 text-white text-[9px] font-bold min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center">
                {newOrderCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="px-4 py-4 space-y-3">
        {isLoading ? (
          [1,2,3].map(i => <div key={i} className="h-28 skeleton rounded-2xl"/>)
        ) : orders.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-6xl mb-3">{TABS.find(t => t.key === tab)?.icon || "📋"}</p>
            <p className="font-bold text-gray-700 text-lg">No {tab === "all" ? "" : tab + " "}orders</p>
            <p className="text-gray-400 text-sm mt-1">They'll appear here instantly</p>
          </div>
        ) : (
          orders.map((o: any) => {
            const next = NEXT_STATUS[o.status];
            const items = Array.isArray(o.items) ? o.items : [];
            const isExpanded = expanded === o.id;
            return (
              <div key={o.id} className={`bg-white rounded-2xl card-1 overflow-hidden transition-all duration-200 ${o.status === "pending" ? "border-l-4 border-orange-400" : ""}`}>
                {/* Order Header */}
                <button className="w-full px-4 py-3.5 flex items-center gap-3 text-left android-press min-h-0" onClick={() => setExpanded(isExpanded ? null : o.id)}>
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0 ${o.type === "food" ? "bg-red-50" : "bg-blue-50"}`}>
                    {o.type === "food" ? "🍔" : o.type === "mart" ? "🛒" : o.type === "pharmacy" ? "💊" : "📦"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[o.status] || "bg-gray-100 text-gray-600"}`}>
                        {o.status.replace(/_/g," ").toUpperCase()}
                      </span>
                      <span className="text-xs text-gray-400 font-mono">#{o.id.slice(-6).toUpperCase()}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{fd(o.createdAt)} · {items.length} items</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-extrabold text-gray-800">{fc(o.total)}</p>
                    <p className="text-xs text-green-600 font-semibold">+{fc(o.total * 0.85)}</p>
                    <span className="text-gray-300 text-xs">{isExpanded ? "▲" : "▼"}</span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-50 slide-up">
                    {/* Items */}
                    {items.length > 0 && (
                      <div className="px-4 py-3 bg-gray-50 space-y-1.5">
                        <p className="text-[10px] font-extrabold text-gray-400 tracking-widest mb-2">ORDER ITEMS</p>
                        {items.map((item: any, i: number) => (
                          <div key={i} className="flex justify-between text-sm">
                            <span className="text-gray-700">{item.name} <span className="text-gray-400">×{item.quantity}</span></span>
                            <span className="font-semibold text-gray-800">{fc((item.price || 0) * (item.quantity || 1))}</span>
                          </div>
                        ))}
                        <div className="border-t border-gray-200 mt-2 pt-2 flex justify-between font-bold">
                          <span className="text-gray-600">Total</span>
                          <span className="text-orange-600">{fc(o.total)}</span>
                        </div>
                      </div>
                    )}

                    {o.deliveryAddress && (
                      <div className="px-4 py-2 flex items-start gap-2 border-t border-gray-50">
                        <span className="text-base mt-0.5">📍</span>
                        <p className="text-sm text-gray-600 leading-relaxed">{o.deliveryAddress}</p>
                      </div>
                    )}

                    <div className="px-4 py-2 flex items-center gap-2 border-t border-gray-50">
                      <span className="text-base">💳</span>
                      <p className="text-sm text-gray-600 capitalize font-medium">{o.paymentMethod || "Cash on Delivery"}</p>
                    </div>

                    {/* Action Buttons */}
                    {next && (
                      <div className="px-4 pb-4 pt-3 flex gap-2">
                        <button
                          onClick={() => updateMut.mutate({ id: o.id, status: next.next })}
                          disabled={updateMut.isPending}
                          className={`flex-1 py-3.5 ${next.color} font-bold rounded-xl text-sm android-press disabled:opacity-60`}
                        >{next.label}</button>
                        {o.status === "pending" && (
                          <button
                            onClick={() => updateMut.mutate({ id: o.id, status: "cancelled" })}
                            disabled={updateMut.isPending}
                            className="px-4 py-3.5 bg-red-50 text-red-600 font-bold rounded-xl text-sm android-press"
                          >✕ Reject</button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Quick Accept — when collapsed & pending */}
                {!isExpanded && o.status === "pending" && (
                  <div className="px-4 pb-3 flex gap-2">
                    <button onClick={() => updateMut.mutate({ id: o.id, status: "confirmed" })} disabled={updateMut.isPending} className="flex-1 py-3 bg-green-500 text-white font-bold rounded-xl text-sm android-press disabled:opacity-60">✓ Accept</button>
                    <button onClick={() => updateMut.mutate({ id: o.id, status: "cancelled" })} disabled={updateMut.isPending} className="px-4 py-3 bg-red-50 text-red-600 font-bold rounded-xl text-sm android-press">✕</button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {toast && (
        <div className="fixed top-0 left-0 right-0 z-50 flex justify-center toast-in"
          style={{ paddingTop: "calc(env(safe-area-inset-top,0px) + 8px)", paddingLeft: "16px", paddingRight: "16px" }}>
          <div className="bg-gray-900 text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-2xl max-w-sm w-full text-center">{toast}</div>
        </div>
      )}
    </div>
  );
}
