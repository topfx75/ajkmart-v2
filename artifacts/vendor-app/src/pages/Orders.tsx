import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { usePlatformConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { PageHeader } from "../components/PageHeader";
import { fc, fd, CARD } from "../lib/ui";

function useNow(intervalMs = 10000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const TAB_KEYS: { key: string; labelKey: TranslationKey; icon: string }[] = [
  { key: "new",       labelKey: "newLabel",  icon: "🔔" },
  { key: "active",    labelKey: "active",    icon: "🍳" },
  { key: "delivered", labelKey: "done",      icon: "✅" },
  { key: "all",       labelKey: "all",       icon: "📋" },
];

const NEXT_KEYS: Record<string, { next: string; labelKey: TranslationKey; bg: string }> = {
  pending:   { next: "confirmed", labelKey: "acceptOrder",    bg: "bg-green-500 text-white"  },
  confirmed: { next: "preparing", labelKey: "startPreparing", bg: "bg-blue-500 text-white"   },
  preparing: { next: "ready",     labelKey: "markReady",      bg: "bg-purple-500 text-white" },
};

const STATUS_BADGE: Record<string, string> = {
  pending:   "bg-yellow-100 text-yellow-700",
  confirmed: "bg-blue-100 text-blue-700",
  preparing: "bg-purple-100 text-purple-700",
  ready:     "bg-indigo-100 text-indigo-700",
  delivered: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
};

const ORDER_ICON: Record<string, string> = { food: "🍔", mart: "🛒", pharmacy: "💊", parcel: "📦" };

export default function Orders() {
  const qc = useQueryClient();
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const orderRules = config.orderRules;
  const vendorKeepp = 1 - (config.platform.vendorCommissionPct / 100);
  const dlvFeeMap: Record<string,number> = {
    mart: config.deliveryFee.mart,
    food: config.deliveryFee.food,
    pharmacy: config.deliveryFee.pharmacy,
    parcel: config.deliveryFee.parcel,
  };
  const now = useNow(10000);

  const [tab, setTab]           = useState("new");
  const [expanded, setExpanded] = useState<string|null>(null);
  const [toast, setToast]       = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const { data, isLoading, refetch } = useQuery({ queryKey: ["vendor-orders", tab], queryFn: () => api.getOrders(tab), refetchInterval: 15000 });
  const orders = data?.orders || [];

  const countQ = useQuery({ queryKey: ["vendor-orders-count"], queryFn: () => api.getOrders("new"), refetchInterval: 15000 });
  const newCount = countQ.data?.orders?.length || 0;

  const updateMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.updateOrder(id, status),
    onSuccess: (_, { status }) => {
      qc.invalidateQueries({ queryKey: ["vendor-orders"] });
      qc.invalidateQueries({ queryKey: ["vendor-stats"] });
      qc.invalidateQueries({ queryKey: ["vendor-orders-count"] });
      const msg: Record<string, string> = { confirmed: "✅ " + T("orderAccepted"), preparing: "🍳 " + T("preparingStarted"), ready: "📦 " + T("markedReady"), cancelled: "❌ " + T("orderCancelled") };
      showToast(msg[status] || "✅ " + T("done"));
    },
    onError: (e: any) => showToast("❌ " + e.message),
  });

  const RefreshBtn = (
    <button onClick={() => refetch()}
      className="w-10 h-10 bg-white/20 md:bg-gray-100 md:text-gray-600 rounded-xl flex items-center justify-center text-white text-lg android-press min-h-0">
      ↻
    </button>
  );

  return (
    <div className="bg-gray-50 md:bg-transparent">
      <PageHeader title={T("orders")} subtitle={`${orders.length} ${tab} order${orders.length !== 1 ? "s" : ""}`} actions={RefreshBtn} />

      {/* ── Tabs ── */}
      <div className="bg-white border-b border-gray-200 flex sticky top-0 z-10 md:mx-0">
        {TAB_KEYS.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            className={`flex-1 flex flex-col items-center py-3 text-[11px] font-bold border-b-2 transition-colors android-press min-h-0 relative
              ${tab === tb.key ? "border-orange-500 text-orange-600" : "border-transparent text-gray-400"}`}>
            <span className="text-lg mb-0.5">{tb.icon}</span>
            {T(tb.labelKey)}
            {tb.key === "new" && newCount > 0 && (
              <span className="absolute top-1 right-1/4 bg-red-500 text-white text-[9px] font-bold min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center">
                {newCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Order List ── */}
      <div className="px-4 py-4 space-y-3 md:px-0 md:py-4">
        {isLoading ? (
          [1,2,3].map(i => <div key={i} className="h-20 skeleton rounded-2xl"/>)
        ) : orders.length === 0 ? (
          <div className={`${CARD} px-4 py-16 text-center`}>
            <p className="text-5xl mb-3">{TAB_KEYS.find(tb => tb.key === tab)?.icon}</p>
            <p className="font-bold text-gray-700 text-base">{T("noNewOrders")}</p>
            <p className="text-sm text-gray-400 mt-1">{T("theyAppearAutomatically")}</p>
          </div>
        ) : (
          <div className="md:grid md:grid-cols-2 md:gap-4 space-y-3 md:space-y-0">
            {orders.map((o: any) => {
              const next = NEXT_KEYS[o.status];
              const items = Array.isArray(o.items) ? o.items : [];
              const isExp = expanded === o.id;

              // Auto-cancel countdown
              const msSincePlaced  = o.createdAt ? now - new Date(o.createdAt).getTime() : 0;
              const autoCancelMs   = orderRules.autoCancelMin * 60 * 1000;
              const msLeft         = Math.max(0, autoCancelMs - msSincePlaced);
              const minsLeft       = Math.ceil(msLeft / 60000);
              const secsLeft       = Math.ceil((msLeft % 60000) / 1000);
              const isPendingTimer = o.status === "pending" && msLeft > 0;
              const pct            = msLeft / autoCancelMs * 100;
              const timerRed       = minsLeft <= 2 && isPendingTimer;

              return (
                <div key={o.id} className={`${CARD}${o.status === "pending" ? " border-l-4 border-orange-400" : ""}`}>
                  {/* Auto-cancel countdown bar */}
                  {isPendingTimer && (
                    <div className="px-4 pt-3 pb-1">
                      <div className="flex justify-between items-center mb-1">
                        <span className={`text-[10px] font-bold tracking-wide ${timerRed ? "text-red-600" : "text-orange-500"}`}>
                          {timerRed ? "⚠️ AUTO-CANCEL IN" : "⏱ AUTO-CANCEL IN"}
                        </span>
                        <span className={`text-[11px] font-extrabold tabular-nums ${timerRed ? "text-red-600" : "text-orange-600"}`}>
                          {minsLeft}:{String(secsLeft).padStart(2,"0")}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-1000 ${timerRed ? "bg-red-500" : "bg-orange-400"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Order Row */}
                  <button className="w-full px-4 py-3.5 flex items-center gap-3 text-left android-press min-h-0"
                    onClick={() => setExpanded(isExp ? null : o.id)}>
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0 ${o.type === "food" ? "bg-red-50" : "bg-blue-50"}`}>
                      {ORDER_ICON[o.type] || "📦"}
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
                      <p className="font-extrabold text-gray-800 text-base">{fc(o.total)}</p>
                      <p className="text-xs text-green-600 font-semibold">+{fc(o.total * vendorKeepp)}</p>
                      <span className="text-gray-300 text-xs">{isExp ? "▲" : "▼"}</span>
                    </div>
                  </button>

                  {/* Quick Accept */}
                  {!isExp && o.status === "pending" && (
                    <div className="px-4 pb-3 flex gap-2">
                      <button onClick={() => updateMut.mutate({ id: o.id, status: "confirmed" })} disabled={updateMut.isPending}
                        className="flex-1 h-10 bg-green-500 text-white font-bold rounded-xl text-sm android-press disabled:opacity-60">✓ Accept</button>
                      <button onClick={() => updateMut.mutate({ id: o.id, status: "cancelled" })} disabled={updateMut.isPending}
                        className="h-10 px-4 bg-red-50 text-red-600 font-bold rounded-xl text-sm android-press">✕ Reject</button>
                    </div>
                  )}

                  {/* Expanded Detail */}
                  {isExp && (
                    <div className="border-t border-gray-50 slide-up">
                      {items.length > 0 && (
                        <div className="px-4 py-3 bg-gray-50 space-y-2">
                          <p className="text-[10px] font-extrabold text-gray-400 tracking-widest">{T("orderItems")}</p>
                          {items.map((item: any, i: number) => (
                            <div key={i} className="flex justify-between text-sm">
                              <span className="text-gray-700">{item.name} <span className="text-gray-400">×{item.quantity}</span></span>
                              <span className="font-semibold text-gray-800">{fc((item.price||0) * (item.quantity||1))}</span>
                            </div>
                          ))}
                          <div className="border-t border-gray-200 pt-2 flex justify-between font-bold text-sm">
                            <span className="text-gray-600">{T("subtotal")}</span>
                            <span className="text-orange-600">{fc(o.total)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500">🚚 {T("deliveryFee")}</span>
                            <span className="font-semibold text-sky-600">{fc(dlvFeeMap[o.type] ?? dlvFeeMap.mart)}</span>
                          </div>
                          <div className="flex justify-between text-[11px] text-gray-400 -mt-1">
                            <span>{T("chargedToCustomer")} · Rider keeps {config.finance.riderEarningPct}%</span>
                            <span>+{fc((dlvFeeMap[o.type] ?? dlvFeeMap.mart) * config.finance.riderEarningPct / 100)} rider</span>
                          </div>
                        </div>
                      )}
                      {o.deliveryAddress && (
                        <div className="px-4 py-3 flex items-start gap-2 border-t border-gray-50">
                          <span className="text-base mt-0.5">📍</span>
                          <p className="text-sm text-gray-600 leading-relaxed">{o.deliveryAddress}</p>
                        </div>
                      )}
                      <div className="px-4 py-3 flex items-center gap-2 border-t border-gray-50">
                        <span className="text-base">💳</span>
                        <p className="text-sm text-gray-600 capitalize font-medium">{o.paymentMethod || T("cashOnDelivery")}</p>
                      </div>
                      {next && (
                        <div className="px-4 pb-4 pt-2 flex gap-2">
                          <button onClick={() => updateMut.mutate({ id: o.id, status: next.next })} disabled={updateMut.isPending}
                            className={`flex-1 h-11 ${next.bg} font-bold rounded-xl text-sm android-press disabled:opacity-60`}>
                            {T(next.labelKey)}
                          </button>
                          {o.status === "pending" && (
                            <button onClick={() => updateMut.mutate({ id: o.id, status: "cancelled" })} disabled={updateMut.isPending}
                              className="h-11 px-4 bg-red-50 text-red-600 font-bold rounded-xl text-sm android-press">✕ {T("rejectOrder")}</button>
                          )}
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

      {toast && (
        <div className="fixed top-0 left-0 right-0 z-50 flex justify-center toast-in"
          style={{ paddingTop: "calc(env(safe-area-inset-top,0px) + 8px)", paddingLeft: "16px", paddingRight: "16px" }}>
          <div className="bg-gray-900 text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-2xl max-w-sm w-full text-center">{toast}</div>
        </div>
      )}
    </div>
  );
}
