import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { usePlatformConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import WithdrawModal from "../components/wallet/WithdrawModal";
import RemittanceModal from "../components/wallet/RemittanceModal";
import DepositModal from "../components/wallet/DepositModal";
import {
  TrendingUp, Gift, Star, Heart, Building2, ArrowDownToLine,
  Banknote, ArrowUpFromLine, Lock, Wallet2, CreditCard,
  RefreshCw, AlertTriangle, CheckCircle, Clock, XCircle,
  Landmark, Smartphone, ChevronDown, ChevronUp, ShieldCheck,
  Eye, EyeOff, Sparkles,
} from "lucide-react";

const fc  = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;
const fd  = (d: string | Date) => new Date(d).toLocaleString("en-PK", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fdr = (d: string | Date) => {
  const diff = Date.now() - new Date(d).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1)  return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

function dateGroupLabel(d: string): string {
  const now = new Date();
  const dt  = new Date(d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (dt >= today) return "today_group";
  if (dt >= yesterday) return "yesterday_group";
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
  if (dt >= weekAgo) return "thisWeek_group";
  return dt.toLocaleDateString("en-PK", { month: "long", year: "numeric" });
}

function TxIcon({ type }: { type: string }) {
  if (type === "credit")          return <TrendingUp      size={18} className="text-green-600"/>;
  if (type === "bonus")           return <Gift            size={18} className="text-blue-600"/>;
  if (type === "loyalty")         return <Star            size={18} className="text-purple-600"/>;
  if (type === "cashback")        return <Heart           size={18} className="text-pink-600"/>;
  if (type === "platform_fee")    return <Building2       size={18} className="text-orange-500"/>;
  if (type === "deposit")         return <ArrowDownToLine size={18} className="text-teal-600"/>;
  if (type === "cod_remittance")  return <Banknote        size={18} className="text-blue-600"/>;
  if (type === "cash_collection") return <Banknote        size={18} className="text-blue-400"/>;
  return                                 <ArrowUpFromLine size={18} className="text-red-500"/>;
}

function txMeta(type: string) {
  if (type === "credit")          return { labelKey: "earnings" as TranslationKey,    bg: "bg-green-50",   badge: "bg-green-100 text-green-700"    };
  if (type === "bonus")           return { labelKey: "bonus" as TranslationKey,       bg: "bg-blue-50",    badge: "bg-blue-100 text-blue-700"      };
  if (type === "loyalty")         return { labelKey: "loyalty" as TranslationKey,     bg: "bg-purple-50",  badge: "bg-purple-100 text-purple-700"  };
  if (type === "cashback")        return { labelKey: "cashback" as TranslationKey,    bg: "bg-pink-50",    badge: "bg-pink-100 text-pink-700"      };
  if (type === "platform_fee")    return { labelKey: "platformFare" as TranslationKey,bg: "bg-orange-50",  badge: "bg-orange-100 text-orange-700"  };
  if (type === "deposit")         return { labelKey: "deposit" as TranslationKey,     bg: "bg-teal-50",    badge: "bg-teal-100 text-teal-700"      };
  if (type === "cod_remittance")  return { labelKey: "remittanceLabel" as TranslationKey,   bg: "bg-blue-50",    badge: "bg-blue-100 text-blue-700"      };
  if (type === "cash_collection") return { labelKey: "collected" as TranslationKey,  bg: "bg-blue-50",    badge: "bg-blue-100 text-blue-600"      };
  return                                 { labelKey: "withdraw" as TranslationKey,  bg: "bg-red-50",     badge: "bg-red-100 text-red-600"        };
}

function MethodIcon({ method }: { method: string | null }) {
  if (!method) return <Landmark size={16} className="text-blue-500"/>;
  const m = method.toLowerCase();
  if (m.includes("jazzcash"))  return <Smartphone size={16} className="text-red-500"/>;
  if (m.includes("easypaisa")) return <Smartphone size={16} className="text-green-500"/>;
  return <Landmark size={16} className="text-blue-500"/>;
}

/* ══════════════════════════════════════════
   7-DAY EARNINGS CHART
══════════════════════════════════════════ */
function EarningsChart({ transactions }: { transactions: WalletTx[] }) {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const days = useMemo(() => {
    const result: { label: string; amount: number; date: string }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      const earned = transactions
        .filter(t => t.type === "credit" && new Date(t.createdAt) >= d && new Date(t.createdAt) < next)
        .reduce((s, t) => s + Number(t.amount), 0);
      result.push({
        label: i === 0 ? "Aaj" : d.toLocaleDateString("en-PK", { weekday: "short" }),
        amount: earned,
        date: d.toLocaleDateString("en-PK", { day: "numeric", month: "short" }),
      });
    }
    return result;
  }, [transactions]);

  const maxVal = Math.max(...days.map(d => d.amount), 1);
  const weekTotal = days.reduce((s, d) => s + d.amount, 0);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="font-bold text-gray-900 text-[15px]">{T("sevenDayEarnings")}</p>
          <p className="text-xs text-gray-400 mt-0.5">{T("lastSevenDays")}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-extrabold text-green-600">{fc(weekTotal)}</p>
          <p className="text-[10px] text-gray-400">{T("thisWeek")}</p>
        </div>
      </div>
      <div className="flex items-end gap-2 h-24">
        {days.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
            {d.amount > 0 && (
              <p className="text-[8px] text-gray-400 font-bold">{fc(d.amount).replace("Rs. ", "")}</p>
            )}
            <div className="w-full flex items-end justify-center" style={{ height: "64px" }}>
              <div
                className={`w-full max-w-[28px] rounded-lg transition-all duration-500 ${
                  i === 6 ? "bg-gradient-to-t from-green-600 to-emerald-400" : "bg-gradient-to-t from-green-200 to-green-100"
                }`}
                style={{ height: `${Math.max((d.amount / maxVal) * 64, d.amount > 0 ? 6 : 2)}px` }}
                title={`${d.date}: ${fc(d.amount)}`}
              />
            </div>
            <p className={`text-[10px] font-medium text-center leading-tight ${i === 6 ? "text-green-600 font-bold" : "text-gray-400"}`}>{d.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   PENDING REQUEST CARD
══════════════════════════════════════════ */
function PendingRequestCard({ tx }: { tx: WalletTx }) {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const parsed = (() => {
    const parts = (tx.description || "").replace("Withdrawal — ", "").split(" · ");
    return { bank: parts[0] || "—", account: parts[1] || "—", title: parts[2] || "—", note: parts[3] || "" };
  })();

  const ref = tx.reference ?? "pending";
  const status = ref === "pending" ? "pending" : ref.startsWith("paid:") ? "paid" : ref.startsWith("rejected:") ? "rejected" : "pending";
  const refNo  = ref.startsWith("paid:") ? ref.slice(5) : ref.startsWith("rejected:") ? ref.slice(9) : "";

  const statusConfig = {
    pending:  { label: T("processing"), icon: <Clock size={11}/>,       bg: "bg-amber-50",  border: "border-amber-200", badge: "bg-amber-100 text-amber-700", dot: "bg-amber-400"  },
    paid:     { label: T("paid"),       icon: <CheckCircle size={11}/>, bg: "bg-green-50",  border: "border-green-200", badge: "bg-green-100 text-green-700",  dot: "bg-green-400" },
    rejected: { label: T("rejected"),   icon: <XCircle size={11}/>,     bg: "bg-red-50",    border: "border-red-200",   badge: "bg-red-100 text-red-600",     dot: "bg-red-400"   },
  }[status] ?? { label: T("processing"), icon: <Clock size={11}/>, bg: "bg-amber-50", border: "border-amber-200", badge: "bg-amber-100 text-amber-700", dot: "bg-amber-400" };

  return (
    <div className={`${statusConfig.bg} border ${statusConfig.border} rounded-2xl p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
            <MethodIcon method={tx.paymentMethod || parsed.bank}/>
          </div>
          <div className="min-w-0">
            <p className="font-extrabold text-gray-900 text-sm">{parsed.bank}</p>
            <p className="text-xs text-gray-500 font-mono mt-0.5">{parsed.account}</p>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-lg font-extrabold text-gray-900">{fc(Number(tx.amount))}</p>
          <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${statusConfig.badge} inline-flex items-center gap-1`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot} ${status === "pending" ? "animate-pulse" : ""}`}/>
            {statusConfig.icon} {statusConfig.label}
          </span>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-white/60 flex items-center justify-between">
        <p className="text-[10px] text-gray-500">{fd(tx.createdAt)} · {fdr(tx.createdAt)}</p>
        {refNo && <p className="text-[10px] font-bold text-gray-600">Ref: {refNo}</p>}
      </div>
      {status === "rejected" && refNo && (
        <div className="mt-2 bg-white/70 rounded-xl px-3 py-2">
          <p className="text-xs text-red-600 font-medium">{T("reason")}: {refNo}</p>
          <p className="text-[10px] text-red-500 mt-0.5">{T("amountRefunded")}</p>
        </div>
      )}
      {status === "pending" && (
        <p className="text-[10px] text-amber-600 mt-2 font-medium">{T("adminProcess24h")}</p>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════
   TYPES & FILTERS
══════════════════════════════════════════ */
type WalletTx = {
  id: string; type: string; amount: string | number;
  description?: string; reference?: string; createdAt: string;
  paymentMethod?: string;
};

type TxFilter = "all" | "credit" | "debit" | "bonus" | "fees";

const FILTER_TABS: { key: TxFilter; label: string }[] = [
  { key: "all",    label: "All"         },
  { key: "credit", label: "Earnings"    },
  { key: "debit",  label: "Withdrawals" },
  { key: "bonus",  label: "Bonuses"     },
  { key: "fees",   label: "Fees"        },
];

/* ══════════════════════════════════════════
   MAIN WALLET PAGE
══════════════════════════════════════════ */
export default function Wallet() {
  const { user, refreshUser } = useAuth();
  const { config } = usePlatformConfig();
  const riderKeepPct      = config.rider?.keepPct        ?? config.finance.riderEarningPct;
  const minPayout         = config.rider?.minPayout      ?? config.finance.minRiderPayout;
  const maxPayout         = config.rider?.maxPayout      ?? 50000;
  const withdrawalEnabled = config.rider?.withdrawalEnabled !== false;
  const depositEnabled    = config.rider?.depositEnabled !== false;
  const minBalance        = config.rider?.minBalance     ?? 0;
  const procDays          = config.wallet?.withdrawalProcessingDays ?? 2;
  const qc = useQueryClient();

  const [showWithdraw, setShowWithdraw]     = useState(false);
  const [showRemittance, setShowRemittance] = useState(false);
  const [showDeposit, setShowDeposit]       = useState(false);
  const [toast, setToast]                   = useState("");
  const [filter, setFilter]                 = useState<TxFilter>("all");
  const [showRequests, setShowRequests]     = useState(true);
  const [showCodHistory, setShowCodHistory] = useState(false);
  const [balanceHidden, setBalanceHidden]   = useState(false);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["rider-wallet"],
    queryFn: () => api.getWallet(),
    refetchInterval: 30000,
    enabled: config.features.wallet,
  });

  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  const FILTER_TABS_LOCAL = [
    { key: "all" as TxFilter,    label: T("all")         },
    { key: "credit" as TxFilter, label: T("earnings")    },
    { key: "debit" as TxFilter,  label: T("withdraw")    },
    { key: "bonus" as TxFilter,  label: T("bonus" as TranslationKey) },
    { key: "fees" as TxFilter,   label: T("platformFare") },
  ];

  const resolveGroupLabel = (g: string) => {
    if (g === "today_group") return T("today");
    if (g === "yesterday_group") return T("yesterday");
    if (g === "thisWeek_group") return T("thisWeek");
    return g;
  };

  const { data: codData, refetch: refetchCod } = useQuery({
    queryKey: ["rider-cod"],
    queryFn: () => api.getCodSummary(),
    refetchInterval: 60000,
    enabled: config.features.wallet,
  });

  const transactions: WalletTx[] = data?.transactions || [];
  const balance = data?.balance ?? (user?.walletBalance ? Number(user.walletBalance) : 0);

  const today   = new Date(); today.setHours(0,0,0,0);
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);

  const todayEarned    = transactions.filter(t => t.type === "credit" && new Date(t.createdAt) >= today).reduce((s, t) => s + Number(t.amount), 0);
  const weekEarned     = transactions.filter(t => t.type === "credit" && new Date(t.createdAt) >= weekAgo).reduce((s, t) => s + Number(t.amount), 0);
  const totalEarned    = transactions.filter(t => t.type === "credit" || t.type === "bonus").reduce((s, t) => s + Number(t.amount), 0);
  const totalWithdrawn = transactions.filter(t => t.type === "debit" && !t.reference?.startsWith("refund:")).reduce((s, t) => s + Number(t.amount), 0);

  const withdrawalRequests = transactions.filter(t =>
    t.type === "debit" && t.description?.startsWith("Withdrawal") && !t.reference?.startsWith("refund:")
  );
  const pendingRequests = withdrawalRequests.filter(t => !t.reference || t.reference === "pending");
  const pendingAmt = pendingRequests.reduce((s, t) => s + Number(t.amount), 0);

  const codNetOwed    = codData?.netOwed       ?? 0;
  const codCollected  = codData?.totalCollected ?? 0;
  const codVerified   = codData?.totalVerified  ?? 0;
  const codOrderCount = codData?.codOrderCount  ?? 0;
  const codRemittances: WalletTx[] = codData?.remittances ?? [];
  const codPending    = codRemittances.filter(r => r.reference === "pending");

  const filtered = useMemo(() => {
    if (filter === "all") return transactions;
    if (filter === "bonus") return transactions.filter(t => t.type === "bonus" || t.type === "loyalty" || t.type === "cashback");
    if (filter === "fees") return transactions.filter(t => t.type === "platform_fee");
    if (filter === "debit") return transactions.filter(t => t.type === "debit" || t.type === "platform_fee");
    return transactions.filter(t => t.type === filter);
  }, [filter, transactions]);

  const groupedTx = useMemo(() => {
    const groups: { label: string; items: WalletTx[] }[] = [];
    const groupMap = new Map<string, WalletTx[]>();
    for (const t of filtered) {
      const g = dateGroupLabel(t.createdAt);
      if (!groupMap.has(g)) {
        groupMap.set(g, []);
        groups.push({ label: g, items: groupMap.get(g)! });
      }
      groupMap.get(g)!.push(t);
    }
    return groups;
  }, [filtered]);

  if (!config.features.wallet) {
    return (
      <div className="bg-gray-50 pb-24 min-h-screen">
        <div className="bg-gradient-to-br from-green-600 to-emerald-700 px-5 pt-12 pb-8">
          <h1 className="text-2xl font-bold text-white">Wallet</h1>
        </div>
        <div className="px-4 py-8 text-center">
          <div className="bg-white rounded-3xl p-10 shadow-sm border border-gray-100">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock size={32} className="text-gray-400"/>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">{T("walletDisabled")}</h3>
            <p className="text-sm text-gray-500">{T("withdrawalsDisabled")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 pb-28 min-h-screen">

      {/* ══ HEADER ══ */}
      <div className="bg-gradient-to-br from-green-600 via-emerald-600 to-teal-700 px-5 pt-12 pb-28 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.07]">
          <div className="absolute top-0 right-0 w-56 h-56 bg-white rounded-full -translate-y-1/3 translate-x-1/4"/>
          <div className="absolute bottom-0 left-0 w-40 h-40 bg-white rounded-full translate-y-1/3 -translate-x-1/4"/>
        </div>
        <div className="relative flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">{T("wallet")}</h1>
            <p className="text-green-200 text-sm mt-0.5">{T("earningsPayoutsShort")}</p>
          </div>
          <button onClick={() => refetch()} className="h-10 w-10 bg-white/15 backdrop-blur-sm text-white rounded-xl flex items-center justify-center border border-white/10 active:bg-white/25 transition-colors">
            <RefreshCw size={16}/>
          </button>
        </div>
      </div>

      <div className="px-4 -mt-20 space-y-4">

        {/* ══ BALANCE CARD ══ */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-5 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-28 h-28 bg-green-50 rounded-full opacity-50"/>
          <div className="absolute -bottom-6 -left-6 w-20 h-20 bg-emerald-50 rounded-full opacity-50"/>
          <div className="relative">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{T("availableBalance")}</p>
                  <button onClick={() => setBalanceHidden(v => !v)} className="text-gray-400 active:text-gray-600 transition-colors">
                    {balanceHidden ? <EyeOff size={14}/> : <Eye size={14}/>}
                  </button>
                </div>
                <p className="text-4xl font-extrabold text-green-600 leading-none">
                  {balanceHidden ? "Rs. ••••••" : fc(balance)}
                </p>
                <p className="text-xs text-gray-400 mt-2">{riderKeepPct}% — {T("earningsCreditedInstantly")}</p>
              </div>
              {pendingAmt > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-right flex-shrink-0">
                  <p className="text-[10px] text-amber-600 font-bold flex items-center gap-1 justify-end"><Clock size={10}/> {T("pending")}</p>
                  <p className="text-sm font-extrabold text-amber-700">{fc(pendingAmt)}</p>
                </div>
              )}
            </div>

            {minBalance > 0 && balance < minBalance && (
              <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-500 flex-shrink-0"/>
                <div>
                  <p className="text-xs text-amber-700 font-bold">{T("cashMinBalance")}: {fc(minBalance)}</p>
                  <p className="text-[10px] text-amber-600">{T("balanceAmount")}: {fc(balance)} — Rs. {Math.round(minBalance - balance)} {T("moreNeeded")}</p>
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-4">
              {withdrawalEnabled ? (
                <button onClick={() => setShowWithdraw(true)}
                  className="flex-1 bg-green-600 text-white font-extrabold rounded-xl py-3.5 flex items-center justify-center gap-2 active:bg-green-700 transition-colors shadow-sm">
                  <ArrowUpFromLine size={17}/> {T("withdraw")}
                </button>
              ) : (
                <button disabled className="flex-1 bg-gray-200 text-gray-400 font-bold rounded-xl py-3.5 flex items-center justify-center gap-2 cursor-not-allowed">
                  <Lock size={16}/> {T("withdrawalsPaused")}
                </button>
              )}
              {depositEnabled && (
                <button onClick={() => setShowDeposit(true)}
                  className="flex-1 bg-teal-600 text-white font-extrabold rounded-xl py-3.5 flex items-center justify-center gap-2 active:bg-teal-700 transition-colors shadow-sm">
                  <ArrowDownToLine size={17}/> {T("deposit")}
                </button>
              )}
              <button onClick={() => refetch()} className="w-[52px] h-[52px] bg-gray-50 text-gray-500 font-bold rounded-xl flex items-center justify-center active:bg-gray-100 transition-colors border border-gray-100">
                <RefreshCw size={17}/>
              </button>
            </div>

            {!withdrawalEnabled && (
              <div className="mt-3 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5 flex items-center gap-2">
                <XCircle size={14} className="text-red-500 flex-shrink-0"/>
                <p className="text-xs text-red-600 font-medium">{T("withdrawalsDisabled")}</p>
              </div>
            )}
          </div>
        </div>

        {/* ══ STATS GRID ══ */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: T("earnedToday"),     value: fc(todayEarned),    icon: <TrendingUp size={18} className="text-amber-600"/>,   bg: "bg-amber-50",  text: "text-amber-700",  border: "border-amber-100"  },
            { label: T("earnedThisWeek"),  value: fc(weekEarned),     icon: <CreditCard size={18} className="text-blue-600"/>,    bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-100"   },
            { label: T("totalEarned"),      value: fc(totalEarned),    icon: <Wallet2    size={18} className="text-green-600"/>,   bg: "bg-green-50",  text: "text-green-700",  border: "border-green-100"  },
            { label: T("totalWithdrawn"),   value: fc(totalWithdrawn), icon: <ArrowUpFromLine size={18} className="text-red-500"/>,bg: "bg-red-50",    text: "text-red-600",    border: "border-red-100"    },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-2xl p-4 border ${s.border}`}>
              <div className="mb-1.5">{s.icon}</div>
              <p className={`text-lg font-extrabold ${s.text} leading-tight`}>{s.value}</p>
              <p className="text-[10px] text-gray-500 mt-1 font-semibold">{s.label}</p>
            </div>
          ))}
        </div>

        {/* ══ 7-DAY EARNINGS CHART ══ */}
        <EarningsChart transactions={transactions}/>

        {/* ══ COD CASH SECTION ══ */}
        {codOrderCount > 0 && (
          <div className={`rounded-2xl shadow-sm overflow-hidden border ${codNetOwed > 0 ? "border-blue-200 bg-white" : "border-green-200 bg-white"}`}>
            <div className="px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${codNetOwed > 0 ? "bg-blue-100" : "bg-green-100"}`}>
                  <Banknote size={20} className={codNetOwed > 0 ? "text-blue-600" : "text-green-600"}/>
                </div>
                <div>
                  <p className="font-bold text-gray-900 text-[15px]">{T("codCashBalance")}</p>
                  <p className="text-xs text-gray-500">{T("cashOnDelivery")}</p>
                </div>
              </div>
              <div className="text-right">
                <p className={`text-xl font-extrabold ${codNetOwed > 0 ? "text-blue-600" : "text-green-600"}`}>{fc(codNetOwed)}</p>
                <p className="text-[10px] text-gray-400 flex items-center gap-1 justify-end">
                  {codNetOwed > 0 ? T("remitCodCashBtn") : <><CheckCircle size={10} className="text-green-500"/> {T("allClear")}</>}
                </p>
              </div>
            </div>

            <div className="px-5 pb-3 grid grid-cols-3 gap-2 text-center border-t border-gray-50 pt-3">
              <div>
                <p className="text-xs font-extrabold text-gray-800">{fc(codCollected)}</p>
                <p className="text-[9px] text-gray-400 font-medium">{T("collected")}</p>
              </div>
              <div>
                <p className="text-xs font-extrabold text-green-600">{fc(codVerified)}</p>
                <p className="text-[9px] text-gray-400 font-medium">{T("verified")}</p>
              </div>
              <div>
                <p className={`text-xs font-extrabold ${codNetOwed > 0 ? "text-blue-600" : "text-gray-400"}`}>{fc(codNetOwed)}</p>
                <p className="text-[9px] text-gray-400 font-medium">{T("owed")}</p>
              </div>
            </div>

            {codPending.length > 0 && (
              <div className="mx-5 mb-3 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse flex-shrink-0"/>
                <p className="text-xs text-amber-700 font-semibold">{codPending.length} {T("remitPending")}</p>
              </div>
            )}

            <div className="px-5 pb-4 flex gap-2">
              {codNetOwed > 0 && (
                <button onClick={() => setShowRemittance(true)}
                  className="flex-1 bg-blue-600 text-white font-extrabold rounded-xl py-3 flex items-center justify-center gap-2 text-sm active:bg-blue-700 transition-colors shadow-sm">
                  <Banknote size={16}/> {T("remitCodCashBtn")}
                </button>
              )}
              <button onClick={() => setShowCodHistory(!showCodHistory)}
                className={`${codNetOwed > 0 ? "w-auto px-4" : "flex-1"} bg-gray-50 text-gray-600 font-bold rounded-xl py-3 text-sm flex items-center justify-center gap-1.5 border border-gray-100 active:bg-gray-100 transition-colors`}>
                {showCodHistory ? <><ChevronUp size={14}/> {T("hide")}</> : T("history")}
              </button>
            </div>

            {showCodHistory && codRemittances.length > 0 && (
              <div className="border-t border-gray-100 divide-y divide-gray-50">
                {codRemittances.map(r => {
                  const ref = r.reference ?? "pending";
                  const st  = ref === "pending" ? "pending" : ref.startsWith("verified:") ? "verified" : ref.startsWith("rejected:") ? "rejected" : "pending";
                  const stBadge = st === "pending" ? "bg-amber-100 text-amber-700" : st === "verified" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600";
                  const stIcon  = st === "pending" ? <Clock size={10}/> : st === "verified" ? <CheckCircle size={10}/> : <XCircle size={10}/>;
                  const stLabel = st === "pending" ? T("pending") : st === "verified" ? T("verified") : T("rejected");
                  const parts = (r.description || "").replace("COD Remittance — ", "").split(" · ");
                  return (
                    <div key={r.id} className="px-5 py-3.5 flex items-center gap-3">
                      <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
                        <Banknote size={16} className="text-blue-600"/>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-800">{parts[0] || "Remittance"}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <p className="text-[10px] text-gray-400">{new Date(r.createdAt).toLocaleDateString("en-PK", { day:"numeric", month:"short" })}</p>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5 ${stBadge}`}>{stIcon} {stLabel}</span>
                        </div>
                      </div>
                      <p className="text-sm font-extrabold text-blue-600 flex-shrink-0">{fc(Number(r.amount))}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══ WITHDRAWAL REQUESTS ══ */}
        {withdrawalRequests.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-4"
              onClick={() => setShowRequests(!showRequests)}
            >
              <div className="flex items-center gap-2.5">
                <span className="font-bold text-gray-900 text-[15px]">{T("withdrawalRequests")}</span>
                {pendingRequests.length > 0 && (
                  <span className="text-[10px] font-extrabold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Clock size={9}/> {pendingRequests.length} {T("pending")}
                  </span>
                )}
              </div>
              {showRequests ? <ChevronUp size={16} className="text-gray-400"/> : <ChevronDown size={16} className="text-gray-400"/>}
            </button>
            {showRequests && (
              <div className="px-4 pb-4 space-y-3 border-t border-gray-50 pt-3">
                {withdrawalRequests.map(tx => <PendingRequestCard key={tx.id} tx={tx}/>)}
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex gap-2">
                  <ShieldCheck size={14} className="text-blue-500 flex-shrink-0 mt-0.5"/>
                  <p className="text-xs text-blue-700 font-medium">
                    {T("processingTime")}: {procDays * 24}–{procDays * 24 + 24}h. {T("adminApproveNotify")}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ HOW WALLET WORKS ══ */}
        {withdrawalRequests.length === 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <p className="font-bold text-gray-900 text-[15px] mb-4 flex items-center gap-2">
              <Sparkles size={16} className="text-green-500"/> {T("howItWorks")}
            </p>
            <div className="space-y-3">
              {[
                { step: "1", icon: <TrendingUp size={15} className="text-green-600"/>, title: T("completeDeliveries"),    desc: `${riderKeepPct}% ${T("earningsAddedInstantly")}` },
                { step: "2", icon: <Wallet2 size={15} className="text-green-600"/>,    title: T("buildBalance"),    desc: `${T("minToWithdraw")}: ${fc(minPayout)}`   },
                { step: "3", icon: <ArrowUpFromLine size={15} className="text-green-600"/>, title: T("requestWithdrawal"), desc: T("selectPaymentMethod")     },
                { step: "4", icon: <CheckCircle size={15} className="text-green-600"/>, title: T("receivePayment"),       desc: `${procDays * 24}–${procDays * 24 + 24}h ${T("transferTime")}` },
              ].map(s => (
                <div key={s.step} className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-green-100 rounded-xl flex items-center justify-center text-sm font-extrabold text-green-600 flex-shrink-0">{s.step}</div>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-sm font-bold text-gray-800 flex items-center gap-1.5">{s.icon} {s.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ TRANSACTION HISTORY ══ */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 pt-5 pb-3">
            <div className="flex items-center justify-between mb-3">
              <p className="font-bold text-gray-900 text-[15px]">{T("transactionHistoryTitle")}</p>
              <span className="text-xs text-gray-400 font-medium">{filtered.length} {T("records")}</span>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
              {FILTER_TABS_LOCAL.map(tab => (
                <button key={tab.key} onClick={() => setFilter(tab.key)}
                  className={`flex-shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                    filter === tab.key
                      ? "bg-green-600 text-white border-green-600"
                      : "bg-gray-50 text-gray-500 border-gray-100 active:bg-gray-100"
                  }`}>
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="p-5 space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-gray-50 rounded-xl animate-pulse"/>)}</div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-12 text-center border-t border-gray-50">
              <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <CreditCard size={28} className="text-gray-200"/>
              </div>
              <p className="font-bold text-gray-600">{T("noTransactionsFilter")}</p>
              <p className="text-sm text-gray-400 mt-1">{T("completeDeliveriesTrack")}</p>
            </div>
          ) : (
            <div className="border-t border-gray-50">
              {groupedTx.map(group => (
                <div key={group.label}>
                  <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">{resolveGroupLabel(group.label)}</p>
                    <span className="text-[10px] text-gray-400">{group.items.length}</span>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {group.items.map((t: WalletTx) => {
                      const meta = txMeta(t.type);
                      const isDebitType = t.type === "debit" || t.type === "platform_fee";
                      const isCredit = !isDebitType;
                      const isW = t.type === "debit" && t.description?.startsWith("Withdrawal");
                      const isDeposit = t.type === "deposit";
                      const ref = (isW || isDeposit) ? (t.reference ?? "pending") : null;
                      const wStatus = !ref ? null
                        : ref === "pending" ? "pending"
                        : (ref.startsWith("paid:") || ref.startsWith("approved:")) ? "approved"
                        : ref.startsWith("rejected:") ? "rejected" : null;
                      return (
                        <div key={t.id} className="px-5 py-3.5 flex items-start gap-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${meta.bg}`}>
                            <TxIcon type={t.type}/>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-800 leading-snug line-clamp-2">{t.description}</p>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              <p className="text-[10px] text-gray-400">{fd(t.createdAt)}</p>
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${meta.badge}`}>{T(meta.labelKey)}</span>
                              {wStatus === "pending"  && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 flex items-center gap-0.5"><Clock size={8}/> {T("pending")}</span>}
                              {wStatus === "approved" && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 flex items-center gap-0.5"><CheckCircle size={8}/> {isDeposit ? T("creditedLabel") : T("paid")}</span>}
                              {wStatus === "rejected" && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 flex items-center gap-0.5"><XCircle size={8}/> {T("rejected")}</span>}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={`text-[15px] font-extrabold ${
                              isDeposit && wStatus === "pending" ? "text-amber-500"
                              : isDeposit ? "text-teal-600"
                              : isCredit ? "text-green-600"
                              : wStatus === "rejected" ? "text-gray-400 line-through"
                              : "text-red-500"
                            }`}>
                              {isDebitType ? "−" : "+"}{fc(Number(t.amount))}
                            </p>
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

        {/* ══ PAYOUT POLICY ══ */}
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-100 rounded-2xl p-5">
          <p className="text-[15px] font-bold text-green-800 mb-3 flex items-center gap-2">
            <ShieldCheck size={16}/> {T("payoutPolicy")}
          </p>
          <div className="space-y-2.5">
            {[
              { icon: <TrendingUp size={13}/>,   text: `${riderKeepPct}% ${T("yourShare")} — ${100 - riderKeepPct}% ${T("platformFeeLabel")}` },
              { icon: <CreditCard size={13}/>,   text: `${T("minWithdrawalLabel")}: ${fc(minPayout)} · ${T("maxWithdrawalLabel")}: ${fc(maxPayout)}` },
              { icon: <Clock size={13}/>,        text: `${procDays * 24}–${procDays * 24 + 24}h ${T("processedInHours")}` },
              { icon: <Smartphone size={13}/>,   text: T("transferVia") },
              { icon: <ShieldCheck size={13}/>,  text: T("rejectedAutoRefund") },
            ].map((p, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <span className="text-green-500 flex-shrink-0">{p.icon}</span>
                <p className="text-xs text-green-700 font-medium">{p.text}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 pb-2 flex items-center justify-center gap-1.5">
          <ShieldCheck size={12}/> {T("allTransactionsSecure")} {config.platform.appName}
        </p>
      </div>

      {/* ══ MODALS ══ */}
      {showRemittance && (
        <RemittanceModal
          netOwed={codNetOwed}
          onClose={() => setShowRemittance(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["rider-cod"] });
            refetchCod();
            showToast(T("codRemittanceSubmitted"));
          }}
        />
      )}

      {showWithdraw && withdrawalEnabled && (
        <WithdrawModal
          balance={balance} minPayout={minPayout} maxPayout={maxPayout}
          onClose={() => setShowWithdraw(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["rider-wallet"] });
            refreshUser();
            showToast(T("withdrawalSubmitted"));
          }}
        />
      )}

      {showDeposit && depositEnabled && (
        <DepositModal
          balance={balance} minBalance={minBalance}
          onClose={() => setShowDeposit(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["rider-wallet"] });
            showToast(T("depositSubmittedMsg"));
          }}
        />
      )}

      {/* ══ TOAST ══ */}
      {toast && (
        <div className="fixed top-6 left-4 right-4 z-50 pointer-events-none">
          <div className="bg-gray-900 text-white text-sm font-semibold px-5 py-3.5 rounded-2xl shadow-2xl text-center">{toast}</div>
        </div>
      )}
    </div>
  );
}
