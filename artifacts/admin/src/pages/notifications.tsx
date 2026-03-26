import { useState } from "react";
import { Bell, BanknoteIcon, ChevronDown, ChevronUp, RefreshCw, UserCheck, Filter } from "lucide-react";
import { useWithdrawalRequests, useAllNotifications } from "@/hooks/use-admin";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function fc(n: number) { return `Rs. ${Math.round(n).toLocaleString()}`; }
function fd(d: string | Date) {
  return new Date(d).toLocaleString("en-PK", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function roleColor(role: string) {
  if (role === "vendor") return "bg-orange-100 text-orange-700";
  if (role === "rider")  return "bg-green-100 text-green-700";
  if (role === "admin")  return "bg-purple-100 text-purple-700";
  return "bg-blue-100 text-blue-700";
}

function parseWithdrawal(desc: string) {
  const parts = desc.replace("Withdrawal — ", "").split(" · ");
  return {
    bank: parts[0] || "—",
    account: parts[1] || "—",
    name: parts[2] || "—",
    note: parts[3] || "",
  };
}

function typeIcon(type: string) {
  if (type === "order")  return "📦";
  if (type === "wallet") return "💰";
  if (type === "ride")   return "🏍️";
  if (type === "system") return "⚙️";
  if (type === "alert")  return "⚠️";
  return "🔔";
}

export default function Notifications() {
  const [activeTab, setActiveTab] = useState<"withdrawals"|"notifications">("withdrawals");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: wData, isLoading: wLoading, refetch: refetchW } = useWithdrawalRequests();
  const { data: nData, isLoading: nLoading, refetch: refetchN } = useAllNotifications(roleFilter || undefined);

  const withdrawals: any[] = wData?.withdrawals || [];
  const notifications: any[] = nData?.notifications || [];

  const pendingCount = withdrawals.length;
  const totalAmt = withdrawals.reduce((s: number, w: any) => s + Number(w.amount), 0);

  const tabs = [
    { id: "withdrawals", label: "Withdrawal Requests", icon: BanknoteIcon, count: pendingCount },
    { id: "notifications", label: "All Notifications", icon: Bell, count: notifications.length },
  ];

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notifications & Withdrawals</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage withdrawal requests and system notifications</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { refetchW(); refetchN(); }} className="self-start sm:self-auto">
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      {activeTab === "withdrawals" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Requests", value: String(pendingCount),        icon: "📋", color: "text-gray-800" },
            { label: "Total Amount",   value: fc(totalAmt),                icon: "💰", color: "text-red-600"  },
            { label: "Vendor Requests",value: String(withdrawals.filter((w:any) => w.user?.role === "vendor").length), icon: "🏪", color: "text-orange-600" },
            { label: "Rider Requests", value: String(withdrawals.filter((w:any) => w.user?.role === "rider").length),  icon: "🏍️", color: "text-green-600"  },
          ].map(c => (
            <Card key={c.label} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xl">{c.icon}</span>
                </div>
                <p className={`text-lg font-extrabold ${c.color}`}>{c.value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{c.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id as any)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${activeTab === t.id ? "border-primary text-primary" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            <t.icon className="w-4 h-4"/>
            {t.label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${activeTab === t.id ? "bg-primary/10 text-primary" : "bg-gray-100 text-gray-500"}`}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* Withdrawal Requests */}
      {activeTab === "withdrawals" && (
        <div className="space-y-3">
          {wLoading ? (
            [1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse"/>)
          ) : withdrawals.length === 0 ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-12 text-center">
                <p className="text-4xl mb-3">✅</p>
                <p className="font-bold text-gray-700">No withdrawal requests</p>
                <p className="text-sm text-gray-400 mt-1">All vendor and rider withdrawals will appear here</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
                <span className="text-xl">⚠️</span>
                <div>
                  <p className="text-sm font-bold text-amber-800">Manual Processing Required</p>
                  <p className="text-xs text-amber-600 mt-0.5">These are withdrawal requests submitted by vendors and riders. Transfer funds manually to their bank accounts and inform them separately. The amounts have already been deducted from their wallets.</p>
                </div>
              </div>
              {withdrawals.map((w: any) => {
                const parsed = parseWithdrawal(w.description || "");
                const expanded = expandedId === w.id;
                return (
                  <Card key={w.id} className="border-0 shadow-sm overflow-hidden">
                    <CardContent className="p-0">
                      <button className="w-full text-left p-4" onClick={() => setExpandedId(expanded ? null : w.id)}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl ${w.user?.role === "vendor" ? "bg-orange-50" : "bg-green-50"}`}>
                              {w.user?.role === "vendor" ? "🏪" : "🏍️"}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-bold text-gray-900 text-sm truncate">{w.user?.name || "Unknown User"}</p>
                                <Badge className={`text-[10px] font-bold ${roleColor(w.user?.role || "")}`} variant="outline">
                                  {w.user?.role || "—"}
                                </Badge>
                              </div>
                              <p className="text-xs text-gray-500">{w.user?.phone} · {fd(w.createdAt)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <p className="text-lg font-extrabold text-red-600">{fc(w.amount)}</p>
                            {expanded ? <ChevronUp className="w-4 h-4 text-gray-400"/> : <ChevronDown className="w-4 h-4 text-gray-400"/>}
                          </div>
                        </div>
                      </button>
                      {expanded && (
                        <div className="border-t border-gray-100 px-4 py-4 bg-gray-50 space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            {[
                              { label: "Bank / Wallet", value: parsed.bank },
                              { label: "Account No.",   value: parsed.account },
                              { label: "Account Name",  value: parsed.name },
                              { label: "Amount",        value: fc(w.amount) },
                            ].map(f => (
                              <div key={f.label} className="bg-white rounded-xl p-3">
                                <p className="text-[10px] font-bold text-gray-400 uppercase">{f.label}</p>
                                <p className="text-sm font-bold text-gray-800 mt-0.5">{f.value}</p>
                              </div>
                            ))}
                          </div>
                          {parsed.note && (
                            <div className="bg-white rounded-xl p-3">
                              <p className="text-[10px] font-bold text-gray-400 uppercase">Note</p>
                              <p className="text-sm text-gray-700 mt-0.5">{parsed.note}</p>
                            </div>
                          )}
                          <div className="bg-blue-50 rounded-xl p-3 flex items-start gap-2">
                            <UserCheck className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5"/>
                            <p className="text-xs text-blue-700 font-medium">Transfer {fc(w.amount)} to {parsed.bank} account <strong>{parsed.account}</strong> in the name of <strong>{parsed.name}</strong>. The wallet balance has already been deducted.</p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* All Notifications */}
      {activeTab === "notifications" && (
        <div className="space-y-3">
          {/* Role Filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-gray-400"/>
            <span className="text-sm text-gray-500 font-medium">Filter by role:</span>
            {["", "customer", "vendor", "rider"].map(r => (
              <button key={r} onClick={() => setRoleFilter(r)}
                className={`px-3 py-1.5 text-xs font-bold rounded-xl border transition-colors ${roleFilter === r ? "bg-primary text-white border-primary" : "border-gray-200 text-gray-600 hover:border-gray-300"}`}>
                {r === "" ? "All" : r.charAt(0).toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>

          {nLoading ? (
            [1,2,3,4].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse"/>)
          ) : notifications.length === 0 ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-12 text-center">
                <p className="text-4xl mb-3">🔔</p>
                <p className="font-bold text-gray-700">No notifications found</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-0 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                <p className="text-sm font-bold text-gray-700">Recent Notifications</p>
                <span className="text-xs text-gray-400">{notifications.length} records</span>
              </div>
              <div className="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
                {notifications.map((n: any) => (
                  <div key={n.id} className="px-4 py-3.5 flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl ${n.isRead ? "bg-gray-100" : "bg-blue-50"}`}>
                      {typeIcon(n.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-gray-800 leading-snug">{n.title}</p>
                        {n.user && (
                          <Badge className={`text-[9px] font-bold ${roleColor(n.user.role || "")}`} variant="outline">
                            {n.user.role}
                          </Badge>
                        )}
                        {!n.isRead && <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0"/>}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed line-clamp-2">{n.body}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <p className="text-[10px] text-gray-400">{fd(n.createdAt)}</p>
                        {n.user && <p className="text-[10px] text-gray-400 truncate">{n.user.name} · {n.user.phone}</p>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
