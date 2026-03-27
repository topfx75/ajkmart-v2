import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { usePlatformConfig } from "../lib/useConfig";

function formatCurrency(n: number) { return `Rs. ${Math.round(n).toLocaleString()}`; }

function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className={`${color} rounded-2xl p-4`}>
      <p className="text-sm font-medium opacity-80">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      <p className="text-xs opacity-70 mt-0.5">{sub}</p>
    </div>
  );
}

export default function Earnings() {
  const { user } = useAuth();
  const { config } = usePlatformConfig();
  const riderKeepPct = config.rider?.keepPct ?? config.finance.riderEarningPct;
  const { data, isLoading } = useQuery({ queryKey: ["rider-earnings"], queryFn: () => api.getEarnings() });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-green-600 to-emerald-700 px-5 pt-12 pb-6">
        <h1 className="text-2xl font-bold text-white">Earnings</h1>
        <p className="text-green-200 text-sm">Your delivery income ({riderKeepPct}% of each fare)</p>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Wallet Balance */}
        <div className="bg-white rounded-2xl shadow-sm p-5 text-center">
          <p className="text-sm text-gray-500">Wallet Balance</p>
          <p className="text-4xl font-bold text-green-600 mt-1">{formatCurrency(Number(user?.walletBalance) || 0)}</p>
          <p className="text-xs text-gray-400 mt-1">Earnings are added after each delivery</p>
        </div>

        {isLoading ? (
          [1,2,3].map(i => <div key={i} className="h-24 bg-white rounded-2xl animate-pulse"/>)
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="Today's Earnings"
                value={formatCurrency(data?.today?.earnings || 0)}
                sub={`${data?.today?.deliveries || 0} deliveries`}
                color="bg-green-600 text-white"
              />
              <StatCard
                label="This Week"
                value={formatCurrency(data?.week?.earnings || 0)}
                sub={`${data?.week?.deliveries || 0} deliveries`}
                color="bg-emerald-100 text-emerald-800"
              />
            </div>

            <div className="bg-white rounded-2xl shadow-sm p-5">
              <h3 className="font-bold text-gray-800 mb-4">This Month</h3>
              <div className="flex items-center justify-between py-3 border-b border-gray-100">
                <span className="text-gray-600">Total Earnings ({riderKeepPct}% cut)</span>
                <span className="font-bold text-green-600">{formatCurrency(data?.month?.earnings || 0)}</span>
              </div>
              <div className="flex items-center justify-between py-3 border-b border-gray-100">
                <span className="text-gray-600">Deliveries Completed</span>
                <span className="font-bold">{data?.month?.deliveries || 0}</span>
              </div>
              <div className="flex items-center justify-between py-3 border-b border-gray-100">
                <span className="text-gray-600">All Time Earnings</span>
                <span className="font-bold text-green-600">{formatCurrency(user?.stats?.totalEarnings || 0)}</span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-gray-600">All Time Deliveries</span>
                <span className="font-bold">{user?.stats?.totalDeliveries || 0}</span>
              </div>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
              <h3 className="font-bold text-green-800 mb-1">💰 How it Works</h3>
              <p className="text-sm text-green-700">You earn <strong>{riderKeepPct}%</strong> of each order's total. Earnings are instantly credited to your wallet after each successful delivery.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
