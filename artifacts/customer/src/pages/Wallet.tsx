import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "../lib/auth";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const token = () => localStorage.getItem("customer_token") ?? "";

async function getWallet() {
  const r = await fetch(`${BASE}/api/wallet`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error || d.message || `HTTP ${r.status}`);
  }
  return r.json() as Promise<{ balance: number; transactions: { id: string; type: string; amount: number; description: string; createdAt: string }[] }>;
}

async function simulateTopup(amount: number) {
  const r = await fetch(`${BASE}/api/wallet/simulate-topup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ amount }),
  });
  if (!r.ok) { const d = await r.json(); throw new Error(d.error || "Failed"); }
  return r.json() as Promise<{ success: boolean; amount: number; newBalance: number }>;
}

const AMOUNTS = [500, 1000, 2000, 5000];
const TYPE_LABEL: Record<string, string> = {
  simulated_topup: "Simulated Top-up",
  credit: "Ride Credit",
  deposit: "Deposit",
  debit: "Debit",
  refund: "Refund",
};
const TYPE_COLOR: Record<string, string> = {
  simulated_topup: "text-green-600",
  credit: "text-green-600",
  deposit: "text-green-600",
  debit: "text-red-500",
  refund: "text-blue-500",
};

export default function Wallet() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { user, setUser } = useAuth();
  const [selected, setSelected] = useState<number | null>(null);
  const [toast, setToast] = useState("");

  const { data, isLoading, isError, error: walletError } = useQuery({ queryKey: ["cust-wallet"], queryFn: getWallet });

  const topupMut = useMutation({
    mutationFn: simulateTopup,
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["cust-wallet"] });
      if (user) setUser({ ...user, walletBalance: d.newBalance });
      setToast(`✅ Rs. ${d.amount} added! New balance: Rs. ${d.newBalance.toFixed(0)}`);
      setSelected(null);
      setTimeout(() => setToast(""), 3000);
    },
    onError: (e: Error) => {
      setToast(`❌ ${e.message}`);
      setTimeout(() => setToast(""), 4000);
    },
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate("/")} className="p-1 text-gray-500">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h1 className="text-base font-bold text-gray-900">My Wallet</h1>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      <div className="p-4 space-y-4">
        {/* Balance Card */}
        <div className="bg-gradient-to-r from-green-600 to-emerald-700 rounded-2xl p-5 text-white shadow">
          <p className="text-sm opacity-80 mb-1">Current Balance</p>
          {isLoading ? (
            <div className="h-10 w-32 bg-white/20 rounded animate-pulse" />
          ) : isError ? (
            <p className="text-lg font-bold text-red-200">{(walletError as Error)?.message || "Failed to load wallet"}</p>
          ) : (
            <p className="text-4xl font-bold">Rs. {(data?.balance ?? 0).toFixed(0)}</p>
          )}
          <p className="text-xs opacity-60 mt-2">Demo Mode — Simulated balance</p>
        </div>

        {/* Simulate Top-up */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-1">Add Balance (Simulated)</p>
          <p className="text-xs text-gray-400 mb-3">For demo purposes only. Choose an amount to add instantly.</p>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {AMOUNTS.map((a) => (
              <button
                key={a}
                onClick={() => setSelected(a === selected ? null : a)}
                className={`py-2 rounded-lg text-sm font-semibold border transition-all ${
                  selected === a
                    ? "bg-green-600 text-white border-green-600"
                    : "bg-white text-gray-700 border-gray-200 hover:border-green-400"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
          <button
            disabled={!selected || topupMut.isPending}
            onClick={() => selected && topupMut.mutate(selected)}
            className="w-full py-2.5 bg-green-600 text-white rounded-xl font-semibold text-sm disabled:opacity-40"
          >
            {topupMut.isPending ? "Adding…" : selected ? `Add Rs. ${selected}` : "Select an amount"}
          </button>
        </div>

        {/* Transaction History */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-3">Transaction History</p>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />)}
            </div>
          ) : !data?.transactions?.length ? (
            <p className="text-gray-400 text-sm text-center py-6">No transactions yet</p>
          ) : (
            <div className="space-y-2">
              {data.transactions.map(tx => (
                <div key={tx.id} className="flex items-start justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{TYPE_LABEL[tx.type] || tx.type}</p>
                    <p className="text-xs text-gray-400">{tx.description}</p>
                    <p className="text-xs text-gray-300">{new Date(tx.createdAt).toLocaleString("en-PK")}</p>
                  </div>
                  <span className={`text-sm font-bold ${TYPE_COLOR[tx.type] || "text-gray-700"}`}>
                    Rs. {tx.amount.toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
