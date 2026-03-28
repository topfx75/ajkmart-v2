import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ClipboardList, Package, Bike, Car, UtensilsCrossed,
  ShoppingCart, CreditCard,
} from "lucide-react";
import { api } from "../lib/api";
import { useLanguage } from "../lib/useLanguage";
import { tDual } from "@workspace/i18n";

function formatCurrency(n: number) { return `Rs. ${Math.round(n).toLocaleString()}`; }
function formatDate(d: string | Date) {
  const date = new Date(d);
  return date.toLocaleDateString("en-PK", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

type FilterPeriod = "today" | "week" | "all";
type FilterKind   = "all" | "order" | "ride";

type HistoryItem = {
  id: string; kind: "order" | "ride"; type: string;
  status: string; earnings: number; amount: number;
  address?: string; createdAt: string;
};

export default function History() {
  const [period, setPeriod]   = useState<FilterPeriod>("all");
  const [kind,   setKind]     = useState<FilterKind>("all");
  const { language } = useLanguage();
  const T = (key: Parameters<typeof tDual>[0]) => tDual(key, language);

  const { data, isLoading } = useQuery({
    queryKey: ["rider-history"],
    queryFn: () => api.getHistory(),
  });

  const raw: HistoryItem[] = data?.history || [];

  const now      = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart  = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const filtered = raw.filter(item => {
    const d = new Date(item.createdAt);
    if (period === "today" && d < todayStart) return false;
    if (period === "week"  && d < weekStart)  return false;
    if (kind === "order"   && item.kind !== "order") return false;
    if (kind === "ride"    && item.kind !== "ride")  return false;
    return true;
  });

  const totalEarnings  = filtered.reduce((s, i) => s + (i.earnings || 0), 0);
  const completedItems = filtered.filter(i => i.status === "delivered" || i.status === "completed");
  const cancelledItems = filtered.filter(i => i.status === "cancelled");

  const PERIOD_TABS: { key: FilterPeriod; label: string }[] = [
    { key: "today", label: T("today") },
    { key: "week",  label: T("thisWeek") },
    { key: "all",   label: T("allTimeEarnings") },
  ];
  type KindTab = { key: FilterKind; label: string; icon: React.ReactElement };
  const KIND_TABS: KindTab[] = [
    { key: "all",   label: T("all"),    icon: <ClipboardList size={12}/> },
    { key: "order", label: T("orders"), icon: <Package size={12}/>       },
    { key: "ride",  label: T("rides"),  icon: <Bike size={12}/>          },
  ];

  function ItemIcon({ kind, type }: { kind: string; type: string }) {
    if (kind === "ride") {
      return type === "bike"
        ? <Bike size={20} className="text-green-600"/>
        : <Car  size={20} className="text-green-600"/>;
    }
    if (type === "food") return <UtensilsCrossed size={20} className="text-blue-600"/>;
    if (type === "mart") return <ShoppingCart    size={20} className="text-blue-600"/>;
    return                      <Package         size={20} className="text-blue-600"/>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-green-600 to-emerald-700 px-5 pt-12 pb-6">
        <h1 className="text-2xl font-bold text-white">{T("history")}</h1>
        <p className="text-green-200 text-sm">{raw.length} {T("totalRecords")}</p>
      </div>

      {!isLoading && (
        <div className="px-4 -mt-2 mb-0">
          <div className="bg-white rounded-2xl shadow-sm p-4 grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-lg font-extrabold text-green-600">{formatCurrency(totalEarnings)}</p>
              <p className="text-[10px] text-gray-400 font-medium mt-0.5">{T("earnings")}</p>
            </div>
            <div className="text-center border-x border-gray-100">
              <p className="text-lg font-extrabold text-blue-600">{completedItems.length}</p>
              <p className="text-[10px] text-gray-400 font-medium mt-0.5">{T("completed")}</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-extrabold text-red-500">{cancelledItems.length}</p>
              <p className="text-[10px] text-gray-400 font-medium mt-0.5">{T("cancelled")}</p>
            </div>
          </div>
        </div>
      )}

      <div className="px-4 pt-4 space-y-3 sticky top-0 bg-gray-50 pb-2 z-10">
        <div className="flex bg-white rounded-xl p-1 shadow-sm gap-1">
          {PERIOD_TABS.map(tab => (
            <button key={tab.key} onClick={() => setPeriod(tab.key)}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${period === tab.key ? "bg-green-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {KIND_TABS.map(tab => (
            <button key={tab.key} onClick={() => setKind(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${kind === tab.key ? "bg-green-600 text-white border-green-600" : "bg-white text-gray-500 border-gray-200"}`}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3 space-y-3 pb-24">
        {isLoading ? (
          [1,2,3,4,5].map(i => <div key={i} className="h-20 bg-white rounded-2xl animate-pulse"/>)
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <ClipboardList size={56} className="text-gray-200 mx-auto mb-3"/>
            <p className="font-bold text-gray-700">{T("noRecordsFound")}</p>
            <p className="text-gray-400 text-sm mt-1">
              {period !== "all" ? T("widerTimePeriod") : T("deliveriesAppearHere")}
            </p>
          </div>
        ) : (
          filtered.map((item: HistoryItem) => {
            const completed = item.status === "delivered" || item.status === "completed";
            const cancelled = item.status === "cancelled";
            return (
              <div key={item.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="p-4 flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${item.kind === "ride" ? "bg-green-50" : "bg-blue-50"}`}>
                    <ItemIcon kind={item.kind} type={item.type}/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-800 capitalize">
                      {item.kind === "ride" ? `${item.type} ${T("ride")}` : `${item.type} ${T("deliveryLabel")}`}
                    </p>
                    <p className="text-xs text-gray-500 truncate mt-0.5">{item.address || "—"}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatDate(item.createdAt)}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {completed ? (
                      <p className="font-bold text-green-600">+{formatCurrency(item.earnings || 0)}</p>
                    ) : (
                      <p className="font-bold text-gray-400">{formatCurrency(item.amount || 0)}</p>
                    )}
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mt-1 inline-block ${
                      completed  ? "bg-green-100 text-green-700" :
                      cancelled  ? "bg-red-100 text-red-600"     :
                                   "bg-gray-100 text-gray-600"
                    }`}>
                      {item.status.replace(/_/g, " ").toUpperCase()}
                    </span>
                  </div>
                </div>
                {completed && item.earnings > 0 && (
                  <div className="px-4 pb-3">
                    <div className="bg-green-50 rounded-lg px-3 py-1.5 flex items-center justify-between">
                      <span className="text-xs text-green-600 font-medium flex items-center gap-1"><CreditCard size={11}/> {T("earningsCredited")}</span>
                      <span className="text-xs font-extrabold text-green-700">{formatCurrency(item.earnings)}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
