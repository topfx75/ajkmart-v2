import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { usePlatformConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { PageHeader } from "../components/PageHeader";
import { PullToRefresh } from "../components/PullToRefresh";
import { PageError } from "../components/PageStates";
import { fc, CARD, CARD_HEADER, BADGE_GREEN, BADGE_ORANGE, BADGE_RED, BADGE_GRAY } from "../lib/ui";

const RANGES = [
  { value: 7  },
  { value: 30 },
  { value: 90 },
];

function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.max(pct, 2)}%` }}/>
    </div>
  );
}

export default function Analytics() {
  const [days, setDays] = useState(30);
  const { user } = useAuth();
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["vendor-analytics", days],
    queryFn: () => api.getAnalytics(days),
    staleTime: 60000,
  });

  const handlePullRefresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["vendor-analytics"] });
  }, [qc]);

  const summary     = data?.summary     || {};
  const dailyData   = data?.daily       || [];
  const topProducts = data?.topProducts || [];
  const byStatus    = data?.byStatus    || {};

  const revValues = dailyData.map((d: any) => d.revenue || 0);
  const ordValues = dailyData.map((d: any) => d.orders  || 0);
  const maxRev = revValues.length > 0 ? Math.max(...revValues, 1) : 1;
  const maxOrd = ordValues.length > 0 ? Math.max(...ordValues, 1) : 1;

  const totalOrders   = Number(summary.totalOrders   || 0);
  const totalRevenue  = Number(summary.totalRevenue  || 0);
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const completionRate = totalOrders > 0
    ? Math.round(((byStatus.delivered || 0) / totalOrders) * 100)
    : 0;

  const statuses = [
    { key: "pending",            label: "Pending",       badge: BADGE_ORANGE },
    { key: "confirmed",          label: "Confirmed",     badge: BADGE_ORANGE },
    { key: "preparing",          label: "Preparing",     badge: BADGE_ORANGE },
    { key: "ready",              label: "Ready",         badge: BADGE_GRAY   },
    { key: "picked_up",          label: "Picked Up",     badge: BADGE_GRAY   },
    { key: "out_for_delivery",   label: "Out Delivery",  badge: BADGE_GRAY   },
    { key: "delivered",          label: "Delivered",     badge: BADGE_GREEN  },
    { key: "cancelled",          label: "Cancelled",     badge: BADGE_RED    },
  ];

  return (
    <PullToRefresh onRefresh={handlePullRefresh} className="bg-gray-50 md:bg-transparent">
      <PageHeader
        title={T("analytics")}
        subtitle={T("storePerformance")}
        actions={
          <div className="flex gap-1.5" role="group" aria-label="Time range">
            {RANGES.map(r => (
              <button key={r.value} onClick={() => setDays(r.value)}
                aria-pressed={days === r.value}
                className={`h-8 px-3 text-xs font-bold rounded-xl android-press min-h-0 transition-all
                  ${days === r.value ? "bg-white text-orange-500 md:bg-orange-500 md:text-white" : "bg-white/20 text-white md:bg-gray-100 md:text-gray-600"}`}>
                {r.value} {T("daysLabel")}
              </button>
            ))}
          </div>
        }
      />

      <div className="px-4 py-4 space-y-4 md:px-0 md:py-4">
        {isError && (
          <PageError
            message={T("somethingWentWrong")}
            onRetry={() => refetch()}
            retryLabel={T("tryAgain")}
          />
        )}
        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" role="list" aria-label={T("analytics")}>
          {[
            { label: T("revenue"),       value: fc(totalRevenue),             icon: "💰", sub: `${days} ${T("dayTrend")}`, bg: "bg-orange-50", val: "text-orange-600" },
            { label: T("orders"),        value: String(totalOrders),          icon: "📦", sub: `${days} ${T("dayTrend")}`, bg: "bg-blue-50",   val: "text-blue-600"   },
            { label: T("avgOrder"),      value: fc(avgOrderValue),            icon: "📊", sub: T("avgOrder"),       bg: "bg-purple-50", val: "text-purple-600" },
            { label: T("completion"),    value: `${completionRate}%`,         icon: "✅", sub: T("delivered"),      bg: "bg-green-50",  val: "text-green-600"  },
          ].map(k => (
            <div key={k.label} className={`${k.bg} rounded-2xl p-4`}>
              <p className="text-2xl">{k.icon}</p>
              {isLoading ? (
                <div className="h-6 w-24 skeleton rounded-lg mt-2"/>
              ) : (
                <p className={`text-xl font-extrabold ${k.val} mt-1 leading-tight`}>{k.value}</p>
              )}
              <p className="text-xs text-gray-500 font-medium mt-0.5">{k.label}</p>
              <p className="text-[10px] text-gray-400">{k.sub}</p>
            </div>
          ))}
        </div>

        <div className="md:grid md:grid-cols-2 md:gap-6 space-y-4 md:space-y-0">
          {/* ── Revenue Chart ── */}
          <div className={CARD}>
            <div className={CARD_HEADER}>
              <div>
                <p className="font-bold text-gray-800 text-sm">{T("dailyRevenue")}</p>
                <p className="text-xs text-gray-400">{days} {T("dayTrend")}</p>
              </div>
              <span className="text-xs font-bold text-orange-500 bg-orange-50 px-2.5 py-1 rounded-full">Rs.</span>
            </div>
            <div className="p-4">
              {isLoading ? (
                <div className="h-40 skeleton rounded-xl"/>
              ) : dailyData.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-gray-400 text-sm">{T("noDataYet")}</div>
              ) : (
                <>
                  <div className="flex items-end gap-0.5 h-40 px-1 overflow-x-auto">
                    {dailyData.slice(-days).map((d: any, i: number) => {
                      const pct = ((d.revenue || 0) / maxRev) * 100;
                      return (
                        <div key={i} className="flex-shrink-0 flex flex-col items-center justify-end gap-0.5 group relative" style={{ minWidth: `${Math.max(4, Math.floor(100 / days))}%`, width: `${Math.max(4, Math.floor(100 / days))}%` }}>
                          <div className="absolute bottom-full mb-1 bg-gray-800 text-white text-[10px] font-bold px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">
                            {fc(d.revenue || 0)}<br/>{d.date}
                          </div>
                          <div className="w-full bg-orange-400 rounded-t-sm hover:bg-orange-500 transition-colors"
                            style={{ height: `${Math.max(pct, 2)}%` }}/>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between mt-2">
                    <p className="text-[10px] text-gray-400">{dailyData[0]?.date || ""}</p>
                    <p className="text-[10px] text-gray-400">{dailyData[dailyData.length-1]?.date || ""}</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Orders Chart ── */}
          <div className={CARD}>
            <div className={CARD_HEADER}>
              <div>
                <p className="font-bold text-gray-800 text-sm">{T("dailyOrders")}</p>
                <p className="text-xs text-gray-400">{days} {T("dayTrend")}</p>
              </div>
              <span className="text-xs font-bold text-blue-500 bg-blue-50 px-2.5 py-1 rounded-full">#</span>
            </div>
            <div className="p-4">
              {isLoading ? (
                <div className="h-40 skeleton rounded-xl"/>
              ) : dailyData.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-gray-400 text-sm">{T("noDataYet")}</div>
              ) : (
                <>
                  <div className="flex items-end gap-0.5 h-40 px-1 overflow-x-auto">
                    {dailyData.slice(-days).map((d: any, i: number) => {
                      const pct = ((d.orders || 0) / maxOrd) * 100;
                      return (
                        <div key={i} className="flex-shrink-0 flex flex-col items-center justify-end gap-0.5 group relative" style={{ minWidth: `${Math.max(4, Math.floor(100 / days))}%`, width: `${Math.max(4, Math.floor(100 / days))}%` }}>
                          <div className="absolute bottom-full mb-1 bg-gray-800 text-white text-[10px] font-bold px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">
                            {d.orders || 0} orders<br/>{d.date}
                          </div>
                          <div className="w-full bg-blue-400 rounded-t-sm hover:bg-blue-500 transition-colors"
                            style={{ height: `${Math.max(pct, 2)}%` }}/>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between mt-2">
                    <p className="text-[10px] text-gray-400">{dailyData[0]?.date || ""}</p>
                    <p className="text-[10px] text-gray-400">{dailyData[dailyData.length-1]?.date || ""}</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="md:grid md:grid-cols-2 md:gap-6 space-y-4 md:space-y-0">
          {/* ── Order Status Breakdown ── */}
          <div className={CARD}>
            <div className={`${CARD_HEADER} bg-gray-50`}>
              <p className="font-bold text-gray-800 text-sm">{T("orderStatusBreakdown")}</p>
            </div>
            <div className="p-4 space-y-3">
              {isLoading ? (
                [1,2,3,4,5].map(i => <div key={i} className="h-8 skeleton rounded-lg"/>)
              ) : (
                statuses.map(s => {
                  const count = byStatus[s.key] || 0;
                  const pct   = totalOrders > 0 ? Math.round((count / totalOrders) * 100) : 0;
                  return (
                    <div key={s.key} className="flex items-center gap-3">
                      <span className={`${s.badge} w-20 text-center flex-shrink-0`}>{s.label}</span>
                      <MiniBar pct={pct} color={s.key === "delivered" ? "bg-green-400" : s.key === "cancelled" ? "bg-red-400" : "bg-orange-400"}/>
                      <span className="text-sm font-bold text-gray-700 w-8 text-right">{count}</span>
                      <span className="text-xs text-gray-400 w-8">{pct}%</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── Top Products ── */}
          <div className={CARD}>
            <div className={`${CARD_HEADER} bg-gray-50`}>
              <p className="font-bold text-gray-800 text-sm">🏆 {T("topProducts")}</p>
              <span className="text-xs text-gray-400">{T("byOrders")}</span>
            </div>
            <div className="divide-y divide-gray-50">
              {isLoading ? (
                [1,2,3,4,5].map(i => <div key={i} className="h-14 skeleton rounded-lg m-3"/>)
              ) : topProducts.length === 0 ? (
                <div className="px-4 py-10 text-center text-gray-400 text-sm">{T("noDataYet")}</div>
              ) : (
                topProducts.slice(0, 8).map((p: any, i: number) => (
                  <div key={p.productId || i} className="px-4 py-3 flex items-center gap-3">
                    <span className={`text-lg font-extrabold w-6 text-center ${i === 0 ? "text-yellow-500" : i === 1 ? "text-gray-400" : i === 2 ? "text-amber-600" : "text-gray-300"}`}>
                      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i+1}`}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{p.name}</p>
                      <p className="text-xs text-gray-400">{p.orders} {T("ordersSold")}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-orange-500">{fc(p.revenue || 0)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── Performance Tips ── */}
        <div className={CARD}>
          <div className={`${CARD_HEADER} bg-amber-50`}>
            <p className="font-bold text-amber-800 text-sm">💡 Performance Tips</p>
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { icon: "📸", tip: "Add high-quality images to your products — stores with images get 3x more orders" },
              { icon: "⏱️", tip: "Keep your estimated delivery time accurate to improve customer satisfaction ratings" },
              { icon: "🎟️", tip: "Create promo codes during slow periods to attract more customers to your store" },
            ].map((t, i) => (
              <div key={i} className="bg-amber-50/50 rounded-xl p-3 flex gap-2.5">
                <span className="text-xl flex-shrink-0">{t.icon}</span>
                <p className="text-xs text-amber-800 leading-relaxed font-medium">{t.tip}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PullToRefresh>
  );
}
