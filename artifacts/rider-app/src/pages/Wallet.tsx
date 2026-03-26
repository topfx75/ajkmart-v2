import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";

const BANKS = ["EasyPaisa","JazzCash","MCB","HBL","UBL","Meezan Bank","Bank Alfalah","NBP","Allied Bank","Other"];
const fc = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;
const fd = (d: string | Date) => new Date(d).toLocaleString("en-PK", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" });

function WithdrawModal({ balance, onClose, onSuccess }: { balance: number; onClose: () => void; onSuccess: () => void }) {
  const [amount, setAmount]  = useState("");
  const [bank, setBank]      = useState("");
  const [acNo, setAcNo]      = useState("");
  const [acName, setAcName]  = useState("");
  const [note, setNote]      = useState("");
  const [step, setStep]      = useState<"form"|"confirm"|"done">("form");
  const [err, setErr]        = useState("");

  const INPUT = "w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:border-green-400 focus:bg-white transition-colors";
  const SELECT = "w-full h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:border-green-400 appearance-none";

  const mut = useMutation({
    mutationFn: () => api.withdrawWallet({ amount: Number(amount), bankName: bank, accountNumber: acNo, accountTitle: acName, note }),
    onSuccess: () => setStep("done"),
    onError: (e: any) => setErr(e.message),
  });

  const validate = () => {
    const amt = Number(amount);
    if (!amount || isNaN(amt) || amt <= 0) { setErr("Valid amount required"); return; }
    if (amt < 500)   { setErr("Minimum withdrawal is Rs. 500"); return; }
    if (amt > balance) { setErr(`Max available: ${fc(balance)}`); return; }
    if (!bank)         { setErr("Select your bank / wallet"); return; }
    if (!acNo.trim())  { setErr("Account / phone number required"); return; }
    if (!acName.trim()) { setErr("Account holder name required"); return; }
    setErr(""); setStep("confirm");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-t-3xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {step === "done" ? (
          <div className="p-8 text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 text-4xl">✅</div>
            <h3 className="text-xl font-extrabold text-gray-800">Request Submitted!</h3>
            <p className="text-gray-500 mt-2 text-sm">Your withdrawal of <span className="font-bold text-green-600">{fc(Number(amount))}</span> is queued. Admin processes in 24–48 hours.</p>
            <div className="mt-4 bg-green-50 rounded-2xl p-4 text-left space-y-1.5">
              <div className="flex justify-between text-sm"><span className="text-gray-500">Bank</span><span className="font-bold">{bank}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Account</span><span className="font-bold">{acNo}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Name</span><span className="font-bold">{acName}</span></div>
            </div>
            <button onClick={() => { onSuccess(); onClose(); }}
              className="mt-6 w-full h-14 bg-green-600 text-white font-extrabold rounded-2xl">Done</button>
          </div>
        ) : step === "confirm" ? (
          <div className="p-6">
            <h3 className="text-lg font-extrabold text-gray-800 mb-4">Confirm Withdrawal</h3>
            <div className="bg-green-50 rounded-2xl p-4 space-y-2 mb-5">
              <div className="flex justify-between"><span className="text-gray-500 text-sm">Amount</span><span className="font-extrabold text-green-600 text-lg">{fc(Number(amount))}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">To</span><span className="font-bold">{bank}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Account</span><span className="font-bold">{acNo}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Name</span><span className="font-bold">{acName}</span></div>
            </div>
            <div className="bg-blue-50 rounded-xl p-3 mb-4">
              <p className="text-xs text-blue-700 font-medium">🔒 Please verify all details before confirming. Processed within 24–48 hours.</p>
            </div>
            {err && <p className="text-red-500 text-sm font-semibold mb-3">⚠️ {err}</p>}
            <div className="flex gap-3">
              <button onClick={() => { setStep("form"); setErr(""); }}
                className="flex-1 h-12 border-2 border-gray-200 text-gray-600 font-bold rounded-2xl">← Edit</button>
              <button onClick={() => mut.mutate()} disabled={mut.isPending}
                className="flex-1 h-12 bg-green-600 text-white font-bold rounded-2xl disabled:opacity-60">
                {mut.isPending ? "Processing..." : "✓ Confirm"}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-extrabold text-gray-800">💸 Withdraw Funds</h3>
              <button onClick={onClose} className="w-9 h-9 bg-gray-100 rounded-xl font-bold text-gray-500 flex items-center justify-center">✕</button>
            </div>
            <div className="bg-gradient-to-r from-green-600 to-emerald-600 rounded-2xl p-4 text-white mb-5">
              <p className="text-sm text-green-100">Available Balance</p>
              <p className="text-3xl font-extrabold mt-0.5">{fc(balance)}</p>
              <p className="text-xs text-green-200 mt-1.5">Minimum withdrawal: Rs. 500</p>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Amount (Rs.) *</p>
                <div className="relative">
                  <input type="number" inputMode="numeric" value={amount} onChange={e => { setAmount(e.target.value); setErr(""); }} placeholder="0" className={INPUT}/>
                  <button onClick={() => setAmount(String(Math.floor(balance)))}
                    className="absolute right-3 top-3 text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-lg">MAX</button>
                </div>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Bank / Mobile Wallet *</p>
                <select value={bank} onChange={e => { setBank(e.target.value); setErr(""); }} className={SELECT}>
                  <option value="">Select bank or wallet</option>
                  {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Account / Phone Number *</p>
                <input value={acNo} onChange={e => { setAcNo(e.target.value); setErr(""); }} placeholder="03XX-XXXXXXX or IBAN" className={INPUT}/>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Account Holder Name *</p>
                <input value={acName} onChange={e => { setAcName(e.target.value); setErr(""); }} placeholder="Full name as on account" className={INPUT}/>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Note (Optional)</p>
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Any note for admin" className={INPUT}/>
              </div>
              {err && <div className="bg-red-50 rounded-xl px-4 py-2.5"><p className="text-red-500 text-sm font-semibold">⚠️ {err}</p></div>}
              <button onClick={validate} className="w-full h-14 bg-green-600 text-white font-extrabold rounded-2xl text-base">
                Review Withdrawal →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Wallet() {
  const { user, refreshUser } = useAuth();
  const qc = useQueryClient();
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [toast, setToast] = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["rider-wallet"],
    queryFn: () => api.getWallet(),
    refetchInterval: 30000,
  });

  const transactions: any[] = data?.transactions || [];
  const balance = data?.balance ?? (user?.walletBalance ? Number(user.walletBalance) : 0);

  const today = new Date(); today.setHours(0,0,0,0);
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const todayEarned = transactions.filter(t => t.type === "credit" && new Date(t.createdAt) >= today).reduce((s, t) => s + Number(t.amount), 0);
  const weekEarned  = transactions.filter(t => t.type === "credit" && new Date(t.createdAt) >= weekAgo).reduce((s, t) => s + Number(t.amount), 0);
  const totalCredits = transactions.filter(t => t.type === "credit" || t.type === "bonus").reduce((s, t) => s + Number(t.amount), 0);

  return (
    <div className="bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-br from-green-600 to-emerald-700 px-5 pt-12 pb-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-white">Wallet</h1>
          <button onClick={() => refetch()} className="h-9 px-4 bg-white/20 text-white text-sm font-bold rounded-xl">↻ Refresh</button>
        </div>
        <p className="text-green-200 text-sm">Your earnings & withdrawals</p>
      </div>

      <div className="px-4 -mt-2 space-y-4">
        {/* Balance Card */}
        <div className="bg-white rounded-3xl shadow-md p-5 relative overflow-hidden border border-green-100">
          <div className="absolute -top-6 -right-6 w-24 h-24 bg-green-50 rounded-full"/>
          <div className="relative">
            <p className="text-sm text-gray-500 font-medium">Available Balance</p>
            <p className="text-5xl font-extrabold text-green-600 mt-1">{fc(balance)}</p>
            <p className="text-xs text-gray-400 mt-2">80% of each delivery goes to your wallet</p>
            <button onClick={() => setShowWithdraw(true)}
              className="mt-4 w-full h-12 bg-green-600 text-white font-extrabold rounded-2xl flex items-center justify-center gap-2">
              💸 Withdraw Funds
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Today",         value: fc(todayEarned),  icon: "☀️", bg: "bg-amber-50",  text: "text-amber-700"  },
            { label: "This Week",     value: fc(weekEarned),   icon: "📅", bg: "bg-blue-50",   text: "text-blue-700"   },
            { label: "Total Credits", value: fc(totalCredits), icon: "💰", bg: "bg-green-50",  text: "text-green-700"  },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-2xl p-3 text-center`}>
              <p className="text-xl">{s.icon}</p>
              <p className={`text-sm font-extrabold ${s.text} mt-1 leading-tight`}>{s.value}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Security Info */}
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex gap-3">
          <span className="text-2xl flex-shrink-0">🔒</span>
          <div>
            <p className="text-sm font-bold text-blue-800">Secure Withdrawals</p>
            <p className="text-xs text-blue-600 mt-0.5 leading-relaxed">Withdrawal requests are reviewed by admin and transferred to your bank or mobile wallet within 24–48 hours. Min. Rs. 500 per request.</p>
          </div>
        </div>

        {/* Transaction History */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <div>
              <p className="font-bold text-gray-800 text-sm">Transaction History</p>
              <p className="text-xs text-gray-400 mt-0.5">{transactions.length} records</p>
            </div>
            <span className="text-xs text-gray-400">Last 50</span>
          </div>

          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1,2,3,4].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse"/>)}
            </div>
          ) : transactions.length === 0 ? (
            <div className="px-4 py-16 text-center">
              <p className="text-4xl mb-3">💳</p>
              <p className="font-bold text-gray-600">No transactions yet</p>
              <p className="text-sm text-gray-400 mt-1">Earnings will appear here after deliveries</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {transactions.map((t: any) => (
                <div key={t.id} className="px-4 py-3.5 flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg ${t.type === "credit" || t.type === "bonus" ? "bg-green-50" : "bg-red-50"}`}>
                    {t.type === "credit" ? "💰" : t.type === "bonus" ? "🎁" : "💸"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 leading-snug line-clamp-2">{t.description}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{fd(t.createdAt)}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-base font-extrabold ${t.type === "debit" ? "text-red-500" : "text-green-600"}`}>
                      {t.type === "debit" ? "-" : "+"}{fc(Number(t.amount))}
                    </p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${t.type === "credit" ? "bg-green-100 text-green-700" : t.type === "bonus" ? "bg-blue-100 text-blue-700" : "bg-red-100 text-red-600"}`}>
                      {t.type === "credit" ? "Credit" : t.type === "bonus" ? "Bonus" : "Debit"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-gray-100 rounded-2xl p-4">
          <p className="text-xs text-gray-500 font-medium text-center leading-relaxed">
            🔐 All wallet transactions are encrypted and audited. For any issues contact <span className="font-bold text-green-600">AJKMart Admin</span>.
          </p>
        </div>
      </div>

      {showWithdraw && (
        <WithdrawModal
          balance={balance}
          onClose={() => setShowWithdraw(false)}
          onSuccess={() => { qc.invalidateQueries({ queryKey: ["rider-wallet"] }); refreshUser(); showToast("✅ Withdrawal request submitted!"); }}
        />
      )}

      {toast && (
        <div className="fixed top-0 left-0 right-0 z-50 flex justify-center" style={{ paddingTop: "calc(env(safe-area-inset-top,0px) + 8px)", paddingLeft: "16px", paddingRight: "16px" }}>
          <div className="bg-gray-900 text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-2xl max-w-sm w-full text-center">{toast}</div>
        </div>
      )}
    </div>
  );
}
