import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { usePlatformConfig } from "../lib/useConfig";

const BANKS = ["EasyPaisa","JazzCash","MCB","HBL","UBL","Meezan Bank","Bank Alfalah","NBP","Allied Bank","Other"];
const fc = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;
const fd = (d: string | Date) => new Date(d).toLocaleString("en-PK", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" });

type TxFilter = "all" | "credit" | "debit" | "bonus" | "loyalty";

function txIcon(type: string) {
  if (type === "credit")   return { emoji: "💰", label: "Delivery",   bg: "bg-green-50",  text: "text-green-600",  badge: "bg-green-100 text-green-700"  };
  if (type === "bonus")    return { emoji: "🎁", label: "Bonus",      bg: "bg-blue-50",   text: "text-blue-600",   badge: "bg-blue-100 text-blue-700"    };
  if (type === "loyalty")  return { emoji: "⭐", label: "Loyalty",    bg: "bg-purple-50", text: "text-purple-600", badge: "bg-purple-100 text-purple-700" };
  if (type === "cashback") return { emoji: "💝", label: "Cashback",   bg: "bg-pink-50",   text: "text-pink-600",   badge: "bg-pink-100 text-pink-700"    };
  return                          { emoji: "💸", label: "Withdrawal", bg: "bg-red-50",    text: "text-red-500",    badge: "bg-red-100 text-red-600"      };
}

function WithdrawModal({ balance, minPayout, maxPayout, onClose, onSuccess }: {
  balance: number; minPayout: number; maxPayout: number; onClose: () => void; onSuccess: () => void;
}) {
  const [amount, setAmount]    = useState("");
  const [bank, setBank]        = useState("");
  const [acNo, setAcNo]        = useState("");
  const [acName, setAcName]    = useState("");
  const [note, setNote]        = useState("");
  const [step, setStep]        = useState<"form"|"confirm"|"done">("form");
  const [err, setErr]          = useState("");
  const { user } = useAuth();

  const INPUT  = "w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:border-green-400 focus:bg-white transition-colors";
  const SELECT = "w-full h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:border-green-400 appearance-none";

  const mut = useMutation({
    mutationFn: () => api.withdrawWallet({ amount: Number(amount), bankName: bank, accountNumber: acNo, accountTitle: acName, note }),
    onSuccess: () => setStep("done"),
    onError: (e: any) => setErr(e.message),
  });

  const validate = () => {
    const amt = Number(amount);
    if (!amount || isNaN(amt) || amt <= 0) { setErr("Valid amount likhein"); return; }
    if (amt < minPayout)   { setErr(`Minimum withdrawal: ${fc(minPayout)}`); return; }
    if (amt > maxPayout)   { setErr(`Maximum withdrawal: ${fc(maxPayout)}`); return; }
    if (amt > balance) { setErr(`Available balance: ${fc(balance)}`); return; }
    if (!bank)         { setErr("Bank ya wallet select karein"); return; }
    if (!acNo.trim())  { setErr("Account / phone number required"); return; }
    if (!acName.trim()) { setErr("Account holder ka naam likhein"); return; }
    setErr(""); setStep("confirm");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-t-3xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

        {step === "done" ? (
          <div className="p-8 text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 text-5xl">✅</div>
            <h3 className="text-2xl font-extrabold text-gray-800">Request Submitted!</h3>
            <p className="text-gray-500 mt-2">
              <span className="font-extrabold text-green-600">{fc(Number(amount))}</span> withdrawal queued.
            </p>
            <p className="text-sm text-gray-400 mt-1">Admin 24–48 hours mein process karega.</p>
            <div className="mt-4 bg-green-50 rounded-2xl p-4 text-left space-y-2">
              <div className="flex justify-between text-sm"><span className="text-gray-500">Bank / Wallet</span><span className="font-bold">{bank}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Account</span><span className="font-bold">{acNo}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Account Name</span><span className="font-bold">{acName}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Amount</span><span className="font-extrabold text-green-600">{fc(Number(amount))}</span></div>
            </div>
            <button onClick={() => { onSuccess(); onClose(); }}
              className="mt-6 w-full h-14 bg-green-600 text-white font-extrabold rounded-2xl text-lg">Done ✓</button>
          </div>

        ) : step === "confirm" ? (
          <div className="p-6">
            <h3 className="text-xl font-extrabold text-gray-800 mb-5">Confirm Withdrawal</h3>
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-100 rounded-2xl p-5 space-y-3 mb-5">
              <div className="flex justify-between items-center">
                <span className="text-gray-500 text-sm">Amount</span>
                <span className="font-extrabold text-green-600 text-2xl">{fc(Number(amount))}</span>
              </div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Bank / Wallet</span><span className="font-bold">{bank}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Account No.</span><span className="font-bold">{acNo}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Account Name</span><span className="font-bold">{acName}</span></div>
              {note && <div className="flex justify-between text-sm"><span className="text-gray-500">Note</span><span className="font-bold">{note}</span></div>}
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-4">
              <p className="text-xs text-amber-700 font-semibold">⚠️ Sabhi details verify karein. Galat info se delay ho sakta hai.</p>
            </div>
            {err && <p className="text-red-500 text-sm font-semibold mb-3 bg-red-50 px-3 py-2 rounded-xl">⚠️ {err}</p>}
            <div className="flex gap-3">
              <button onClick={() => { setStep("form"); setErr(""); }}
                className="flex-1 h-13 border-2 border-gray-200 text-gray-600 font-bold rounded-2xl py-3">← Edit</button>
              <button onClick={() => mut.mutate()} disabled={mut.isPending}
                className="flex-1 h-13 bg-green-600 text-white font-bold rounded-2xl py-3 disabled:opacity-60">
                {mut.isPending ? "Processing..." : "✓ Confirm"}
              </button>
            </div>
          </div>

        ) : (
          <div className="p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-xl font-extrabold text-gray-800">💸 Withdraw Funds</h3>
              <button onClick={onClose} className="w-9 h-9 bg-gray-100 rounded-xl font-bold text-gray-500">✕</button>
            </div>
            {/* Balance Banner */}
            <div className="bg-gradient-to-r from-green-600 to-emerald-600 rounded-2xl p-4 text-white mb-5">
              <p className="text-sm text-green-200">Available Balance</p>
              <p className="text-4xl font-extrabold mt-0.5">{fc(balance)}</p>
              <p className="text-xs text-green-300 mt-2">Min: {fc(minPayout)} · Max: {fc(maxPayout)}</p>
            </div>
            {/* Quick amount buttons */}
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Quick Select</p>
            <div className="flex gap-2 mb-4 flex-wrap">
              {[500, 1000, 2000, 5000].filter(v => v <= balance && v >= minPayout).map(v => (
                <button key={v} onClick={() => { setAmount(String(v)); setErr(""); }}
                  className={`px-3 py-1.5 rounded-xl text-sm font-bold border transition-all ${amount === String(v) ? "bg-green-600 text-white border-green-600" : "bg-gray-50 text-gray-600 border-gray-200"}`}>
                  {fc(v)}
                </button>
              ))}
              {balance >= minPayout && (
                <button onClick={() => { setAmount(String(Math.floor(balance))); setErr(""); }}
                  className={`px-3 py-1.5 rounded-xl text-sm font-bold border transition-all ${amount === String(Math.floor(balance)) ? "bg-green-600 text-white border-green-600" : "bg-green-50 text-green-600 border-green-200"}`}>
                  MAX
                </button>
              )}
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Amount (Rs.) *</p>
                <input type="number" inputMode="numeric" value={amount}
                  onChange={e => { setAmount(e.target.value); setErr(""); }}
                  placeholder="0" className={INPUT}/>
              </div>
              {/* Auto-fill from profile */}
              {(user as any)?.bankName && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-blue-700">Saved Account</p>
                    <p className="text-xs text-blue-600 mt-0.5">{(user as any).bankName} · {(user as any).bankAccount}</p>
                  </div>
                  <button onClick={() => {
                    setBank((user as any).bankName || "");
                    setAcNo((user as any).bankAccount || "");
                    setAcName((user as any).bankAccountTitle || "");
                    setErr("");
                  }} className="text-xs font-extrabold text-blue-600 bg-blue-100 px-3 py-1.5 rounded-lg">Use →</button>
                </div>
              )}
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Bank / Mobile Wallet *</p>
                <select value={bank} onChange={e => { setBank(e.target.value); setErr(""); }} className={SELECT}>
                  <option value="">Select bank or wallet</option>
                  {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Account / Phone Number *</p>
                <input value={acNo} onChange={e => { setAcNo(e.target.value); setErr(""); }}
                  inputMode="numeric" placeholder="03XX-XXXXXXX or IBAN" className={INPUT}/>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Account Holder Name *</p>
                <input value={acName} onChange={e => { setAcName(e.target.value); setErr(""); }}
                  placeholder="Full name as on account" className={INPUT}/>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Note (Optional)</p>
                <input value={note} onChange={e => setNote(e.target.value)}
                  placeholder="Any note for admin" className={INPUT}/>
              </div>
              {err && <div className="bg-red-50 rounded-xl px-4 py-2.5"><p className="text-red-500 text-sm font-semibold">⚠️ {err}</p></div>}
              <button onClick={validate}
                className="w-full h-14 bg-green-600 text-white font-extrabold rounded-2xl text-base">
                Review Withdrawal →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const FILTER_TABS: { key: TxFilter; label: string; emoji: string }[] = [
  { key: "all",     label: "All",         emoji: "📋" },
  { key: "credit",  label: "Earnings",    emoji: "💰" },
  { key: "debit",   label: "Withdrawals", emoji: "💸" },
  { key: "bonus",   label: "Bonuses",     emoji: "🎁" },
];

export default function Wallet() {
  const { user, refreshUser } = useAuth();
  const { config } = usePlatformConfig();
  const riderKeepPct      = config.rider?.keepPct    ?? config.finance.riderEarningPct;
  const minPayout         = config.rider?.minPayout  ?? config.finance.minRiderPayout;
  const maxPayout         = config.rider?.maxPayout  ?? 50000;
  const withdrawalEnabled = config.rider?.withdrawalEnabled !== false;
  const qc = useQueryClient();
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [toast, setToast] = useState("");
  const [filter, setFilter] = useState<TxFilter>("all");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["rider-wallet"],
    queryFn: () => api.getWallet(),
    refetchInterval: 30000,
    enabled: config.features.wallet,
  });

  const transactions: any[] = data?.transactions || [];
  const balance = data?.balance ?? (user?.walletBalance ? Number(user.walletBalance) : 0);

  const today    = new Date(); today.setHours(0,0,0,0);
  const weekAgo  = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const todayEarned   = transactions.filter(t => t.type === "credit" && new Date(t.createdAt) >= today).reduce((s, t) => s + Number(t.amount), 0);
  const weekEarned    = transactions.filter(t => t.type === "credit" && new Date(t.createdAt) >= weekAgo).reduce((s, t) => s + Number(t.amount), 0);
  const totalWithdrawn = transactions.filter(t => t.type === "debit").reduce((s, t) => s + Number(t.amount), 0);
  const pendingWithdrawal = transactions.filter(t => t.type === "debit" && new Date(t.createdAt) >= today).reduce((s, t) => s + Number(t.amount), 0);

  const filtered = filter === "all" ? transactions : transactions.filter(t => t.type === filter);

  if (!config.features.wallet) {
    return (
      <div className="bg-gray-50 pb-24">
        <div className="bg-gradient-to-br from-green-600 to-emerald-700 px-5 pt-12 pb-6">
          <h1 className="text-2xl font-bold text-white">Wallet</h1>
        </div>
        <div className="px-4 py-8 text-center">
          <div className="bg-white rounded-3xl p-10 shadow-sm">
            <div className="text-5xl mb-4">🔒</div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Wallet Disabled</h3>
            <p className="text-sm text-gray-500">Admin ne wallet feature abhi band ki hai.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 pb-24 min-h-screen">
      {/* Header */}
      <div className="bg-gradient-to-br from-green-600 to-emerald-700 px-5 pt-12 pb-20">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-white">Wallet</h1>
          <button onClick={() => refetch()} className="h-9 px-4 bg-white/20 text-white text-sm font-bold rounded-xl">↻</button>
        </div>
        <p className="text-green-200 text-sm">Earnings & withdrawals</p>
      </div>

      <div className="px-4 -mt-14 space-y-4">
        {/* Balance Card */}
        <div className="bg-white rounded-3xl shadow-lg p-5 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-28 h-28 bg-green-50 rounded-full"/>
          <div className="relative">
            <p className="text-sm text-gray-500 font-medium">Available Balance</p>
            <p className="text-5xl font-extrabold text-green-600 mt-1">{fc(balance)}</p>
            <p className="text-xs text-gray-400 mt-1.5">{riderKeepPct}% of every delivery credited instantly</p>
            <div className="flex gap-2 mt-4">
              {withdrawalEnabled ? (
                <button onClick={() => setShowWithdraw(true)}
                  className="flex-1 h-13 bg-green-600 text-white font-extrabold rounded-2xl py-3 flex items-center justify-center gap-2 text-base">
                  💸 Withdraw
                </button>
              ) : (
                <button disabled
                  className="flex-1 h-13 bg-gray-200 text-gray-400 font-bold rounded-2xl py-3 cursor-not-allowed">
                  🔒 Withdrawals Paused
                </button>
              )}
              <button onClick={() => refetch()}
                className="h-13 px-4 bg-gray-100 text-gray-600 font-bold rounded-2xl py-3">
                ↻
              </button>
            </div>
          </div>
        </div>

        {/* Pending Withdrawal Alert */}
        {pendingWithdrawal > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-2xl px-4 py-3 flex items-center gap-3">
            <div className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-pulse flex-shrink-0"/>
            <div>
              <p className="text-sm font-extrabold text-amber-800">Withdrawal Pending</p>
              <p className="text-xs text-amber-600">{fc(pendingWithdrawal)} today submitted — admin processing...</p>
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Earned Today",   value: fc(todayEarned),    icon: "☀️", bg: "bg-amber-50",  text: "text-amber-700"  },
            { label: "Earned This Week", value: fc(weekEarned),   icon: "📅", bg: "bg-blue-50",   text: "text-blue-700"   },
            { label: "Total Withdrawn", value: fc(totalWithdrawn), icon: "💸", bg: "bg-red-50",    text: "text-red-600"    },
            { label: "Current Balance", value: fc(balance),        icon: "💳", bg: "bg-green-50",  text: "text-green-700"  },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-2xl p-3.5`}>
              <p className="text-xl">{s.icon}</p>
              <p className={`text-lg font-extrabold ${s.text} mt-1 leading-tight`}>{s.value}</p>
              <p className="text-[10px] text-gray-500 mt-0.5 font-medium">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Earnings Rate Info */}
        {!withdrawalEnabled && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3">
            <span className="text-2xl flex-shrink-0">🚫</span>
            <div>
              <p className="text-sm font-bold text-red-800">Withdrawals Paused</p>
              <p className="text-xs text-red-700 mt-0.5 leading-relaxed">Admin ne temporarily band ki hain. Earnings safe hain.</p>
            </div>
          </div>
        )}

        {/* Transaction History with Filter Tabs */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 pt-4 pb-2 border-b border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <p className="font-bold text-gray-800 text-sm">Transaction History</p>
              <span className="text-xs text-gray-400">{filtered.length} records</span>
            </div>
            {/* Filter tabs */}
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
              {FILTER_TABS.map(tab => (
                <button key={tab.key} onClick={() => setFilter(tab.key)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${filter === tab.key ? "bg-green-600 text-white" : "bg-gray-100 text-gray-500"}`}>
                  {tab.emoji} {tab.label}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse"/>)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-4xl mb-3">💳</p>
              <p className="font-bold text-gray-600">No {filter === "all" ? "" : filter} transactions yet</p>
              <p className="text-sm text-gray-400 mt-1">Earnings will appear here after deliveries</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {filtered.map((t: any) => {
                const info = txIcon(t.type);
                const isCredit = t.type === "credit" || t.type === "bonus" || t.type === "loyalty" || t.type === "cashback";
                return (
                  <div key={t.id} className="px-4 py-3.5 flex items-start gap-3">
                    <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 text-xl ${info.bg}`}>
                      {info.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 leading-snug line-clamp-2">{t.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-xs text-gray-400">{fd(t.createdAt)}</p>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${info.badge}`}>{info.label}</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-base font-extrabold ${isCredit ? "text-green-600" : "text-red-500"}`}>
                        {isCredit ? "+" : "−"}{fc(Number(t.amount))}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Policy */}
        <div className="bg-green-50 border border-green-100 rounded-2xl p-4 space-y-1.5">
          <p className="text-xs font-bold text-green-700">💡 Payout Policy</p>
          {[
            `${riderKeepPct}% earnings — ${100 - riderKeepPct}% platform fee`,
            `Minimum withdrawal: ${fc(minPayout)} — Maximum: ${fc(maxPayout)}`,
            "Processed within 24–48 hours by admin",
            "EasyPaisa, JazzCash, ya bank account par transfer",
          ].map((p, i) => <p key={i} className="text-xs text-green-600">✓ {p}</p>)}
        </div>

        <div className="text-center">
          <p className="text-xs text-gray-400">🔐 All transactions are encrypted & audited by {config.platform.appName} Admin</p>
        </div>
      </div>

      {showWithdraw && withdrawalEnabled && (
        <WithdrawModal
          balance={balance} minPayout={minPayout} maxPayout={maxPayout}
          onClose={() => setShowWithdraw(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["rider-wallet"] });
            refreshUser();
            showToast("✅ Withdrawal request submitted!");
          }}
        />
      )}

      {toast && (
        <div className="fixed top-6 left-4 right-4 z-50">
          <div className="bg-gray-900 text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-2xl text-center">{toast}</div>
        </div>
      )}
    </div>
  );
}
