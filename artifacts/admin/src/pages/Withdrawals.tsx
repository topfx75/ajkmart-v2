import { useState } from "react";
import {
  BanknoteIcon, CheckCircle, XCircle, RefreshCw, ChevronDown, ChevronUp, Clock, Filter, CheckSquare,
} from "lucide-react";
import { useWithdrawalRequests, useApproveWithdrawal, useRejectWithdrawal, useBatchApproveWithdrawals, useBatchRejectWithdrawals } from "@/hooks/use-admin";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";

const fc = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;
const fd = (d: string | Date) =>
  new Date(d).toLocaleString("en-PK", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

type StatusFilter = "all" | "pending" | "paid" | "rejected";

function parseDesc(desc: string) {
  const parts = desc.replace("Withdrawal — ", "").split(" · ");
  return { bank: parts[0] || "—", account: parts[1] || "—", title: parts[2] || "—", note: parts[3] || "" };
}

function methodIcon(method: string | null) {
  if (!method) return "🏦";
  const m = method.toLowerCase();
  if (m.includes("jazzcash"))  return "🔴";
  if (m.includes("easypaisa")) return "🟢";
  if (m.includes("bank") || m.includes("hbl") || m.includes("mcb") || m.includes("ubl") || m.includes("meezan") || m.includes("alfalah") || m.includes("nbp") || m.includes("allied")) return "🏦";
  if (m.includes("wallet"))    return "💰";
  return "💳";
}

function StatusBadge({ status }: { status: string }) {
  if (status === "pending")  return <Badge className="bg-amber-100 text-amber-700 border-0 text-xs font-bold">⏳ Pending</Badge>;
  if (status === "paid")     return <Badge className="bg-green-100 text-green-700 border-0 text-xs font-bold">✅ Paid</Badge>;
  if (status === "rejected") return <Badge className="bg-red-100 text-red-700 border-0 text-xs font-bold">❌ Rejected</Badge>;
  return <Badge className="bg-gray-100 text-gray-600 border-0 text-xs">{status}</Badge>;
}

function roleColor(role: string) {
  if (role === "vendor") return "bg-orange-100 text-orange-700";
  if (role === "rider")  return "bg-green-100 text-green-700";
  return "bg-blue-100 text-blue-700";
}

function ApproveModal({ w, onClose }: { w: any; onClose: () => void }) {
  const [refNo, setRefNo] = useState("");
  const [note, setNote]   = useState("");
  const { toast } = useToast();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const approve = useApproveWithdrawal();
  const parsed = parseDesc(w.description || "");

  const handleApprove = () => {
    if (!refNo.trim()) { toast({ title: "Reference number required", variant: "destructive" }); return; }
    approve.mutate({ id: w.id, refNo: refNo.trim(), note: note.trim() || undefined }, {
      onSuccess: () => { toast({ title: "✅ Withdrawal Approved", description: `Rs. ${w.amount.toLocaleString()} marked as paid — Ref: ${refNo}` }); onClose(); },
      onError:   (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-gradient-to-r from-green-600 to-emerald-600 p-5">
          <h2 className="text-lg font-extrabold text-white">✅ Approve Withdrawal</h2>
          <p className="text-green-200 text-sm mt-0.5">Mark as paid and enter proof of transfer</p>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-green-50 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm"><span className="text-gray-500">Rider / Vendor</span><span className="font-bold">{w.user?.name}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">Phone</span><span className="font-bold">{w.user?.phone}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">{methodIcon(w.paymentMethod)} Method</span><span className="font-bold">{parsed.bank}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">Account</span><span className="font-bold">{parsed.account}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">Account Name</span><span className="font-bold">{parsed.title}</span></div>
            <div className="flex justify-between items-center pt-1 border-t border-green-200">
              <span className="text-gray-600 font-semibold">Amount to Transfer</span>
              <span className="text-xl font-extrabold text-green-600">{fc(w.amount)}</span>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">Transaction / Reference No. *</label>
            <input value={refNo} onChange={e => setRefNo(e.target.value)}
              placeholder="e.g. TXN12345678 or JC-20240101"
              className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-400"/>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">Note for Rider (Optional)</label>
            <input value={note} onChange={e => setNote(e.target.value)}
              placeholder="e.g. Transferred via JazzCash"
              className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-400"/>
          </div>

          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose}>{T("cancel")}</Button>
            <Button className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold"
              onClick={handleApprove} disabled={approve.isPending}>
              {approve.isPending ? T("processing") : "✅ Confirm Payment"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RejectModal({ w, onClose }: { w: any; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const { toast } = useToast();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const reject = useRejectWithdrawal();
  const parsed = parseDesc(w.description || "");

  const handleReject = () => {
    if (!reason.trim()) { toast({ title: "Reason required", variant: "destructive" }); return; }
    reject.mutate({ id: w.id, reason: reason.trim() }, {
      onSuccess: (data: any) => {
        toast({ title: "Withdrawal Rejected", description: `${fc(data.refunded)} wapas rider wallet mein aa gaya.` });
        onClose();
      },
      onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-gradient-to-r from-red-600 to-rose-600 p-5">
          <h2 className="text-lg font-extrabold text-white">❌ Reject Withdrawal</h2>
          <p className="text-red-200 text-sm mt-0.5">Amount will be automatically refunded to rider's wallet</p>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-red-50 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm"><span className="text-gray-500">User</span><span className="font-bold">{w.user?.name}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">Method</span><span className="font-bold">{parsed.bank}</span></div>
            <div className="flex justify-between items-center pt-1 border-t border-red-200">
              <span className="text-gray-600 font-semibold">Amount (will be refunded)</span>
              <span className="text-xl font-extrabold text-red-600">{fc(w.amount)}</span>
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-xs text-amber-700 font-semibold">⚠️ {fc(w.amount)} automatically rider ke wallet mein wapas aa jayega aur unhe notification milegi.</p>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">Rejection Reason *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
              placeholder="e.g. Incorrect account details · Duplicate request · Account name mismatch"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-red-400 resize-none"/>
          </div>

          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose}>{T("cancel")}</Button>
            <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold"
              onClick={handleReject} disabled={reject.isPending}>
              {reject.isPending ? T("processing") : "❌ Reject & Refund"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Withdrawals() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [approveTarget, setApproveTarget] = useState<any | null>(null);
  const [rejectTarget,  setRejectTarget]  = useState<any | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchRejectReason, setBatchRejectReason] = useState("");

  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const { data, isLoading, refetch } = useWithdrawalRequests();
  const batchApprove = useBatchApproveWithdrawals();
  const batchReject  = useBatchRejectWithdrawals();
  const { toast } = useToast();

  const withdrawals: any[] = data?.withdrawals || [];

  const filtered = statusFilter === "all" ? withdrawals : withdrawals.filter(w => w.status === statusFilter);
  const pendingFiltered = filtered.filter(w => w.status === "pending");

  const pendingCount   = withdrawals.filter(w => w.status === "pending").length;
  const pendingAmt     = withdrawals.filter(w => w.status === "pending").reduce((s: number, w: any) => s + Number(w.amount), 0);
  const paidCount      = withdrawals.filter(w => w.status === "paid").length;
  const rejectedCount  = withdrawals.filter(w => w.status === "rejected").length;

  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => {
    const pendingIds = pendingFiltered.map((w: any) => w.id);
    setSelected(prev => prev.size === pendingIds.length ? new Set() : new Set(pendingIds));
  };
  const handleBatchApprove = () => {
    if (selected.size === 0) return;
    batchApprove.mutate([...selected], {
      onSuccess: (r: any) => { toast({ title: `✅ Batch Approved ${r.approved?.length || selected.size} withdrawals` }); setSelected(new Set()); },
      onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    });
  };
  const handleBatchReject = () => {
    if (selected.size === 0) return;
    batchReject.mutate({ ids: [...selected], reason: batchRejectReason || "Batch rejected by admin" }, {
      onSuccess: (r: any) => { toast({ title: `❌ Batch Rejected ${r.rejected?.length || selected.size} withdrawals` }); setSelected(new Set()); setBatchRejectReason(""); },
      onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    });
  };

  const STATUS_TABS: { id: StatusFilter; label: string; count: number; color: string }[] = [
    { id: "all",      label: "All",      count: withdrawals.length,  color: "text-gray-700" },
    { id: "pending",  label: "Pending",  count: pendingCount,        color: "text-amber-600" },
    { id: "paid",     label: "Paid",     count: paidCount,           color: "text-green-600" },
    { id: "rejected", label: "Rejected", count: rejectedCount,       color: "text-red-600"   },
  ];

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Withdrawal Requests</h1>
          <p className="text-sm text-gray-500 mt-0.5">Approve or reject rider & vendor withdrawal requests</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="self-start sm:self-auto">
          <RefreshCw className="w-4 h-4 mr-2"/> {T("refresh")}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Pending Requests", value: String(pendingCount),      icon: "⏳", color: "text-amber-600", bg: "bg-amber-50" },
          { label: "Pending Amount",   value: fc(pendingAmt),            icon: "💰", color: "text-red-600",   bg: "bg-red-50"   },
          { label: "Paid Today",       value: String(paidCount),         icon: "✅", color: "text-green-600", bg: "bg-green-50" },
          { label: "Rejected",         value: String(rejectedCount),     icon: "❌", color: "text-gray-600",  bg: "bg-gray-50"  },
        ].map(c => (
          <Card key={c.label} className={`border-0 shadow-sm ${c.bg}`}>
            <CardContent className="p-4">
              <span className="text-2xl">{c.icon}</span>
              <p className={`text-lg font-extrabold ${c.color} mt-1`}>{c.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{c.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Status Filter Tabs */}
      <div className="flex border-b border-gray-200">
        {STATUS_TABS.map(t => (
          <button key={t.id} onClick={() => setStatusFilter(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${statusFilter === t.id ? "border-primary text-primary" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {t.label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${statusFilter === t.id ? "bg-primary/10 text-primary" : "bg-gray-100 text-gray-500"}`}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* Pending banner for manual processing */}
      {pendingCount > 0 && statusFilter !== "paid" && statusFilter !== "rejected" && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
          <span className="text-xl flex-shrink-0">⚠️</span>
          <div>
            <p className="text-sm font-bold text-amber-800">Manual Transfer Required</p>
            <p className="text-xs text-amber-700 mt-0.5">{pendingCount} request{pendingCount > 1 ? "s" : ""} pending. Amounts already deducted from wallets. Transfer manually and click Approve with reference number.</p>
          </div>
        </div>
      )}

      {/* Batch Action Bar */}
      {pendingFiltered.length > 0 && (
        <div className="bg-white border border-border/60 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-3">
            <input type="checkbox" className="w-4 h-4 rounded cursor-pointer" checked={selected.size === pendingFiltered.length && pendingFiltered.length > 0} onChange={toggleAll} />
            <span className="text-sm text-gray-600">{selected.size > 0 ? `${selected.size} selected` : "Select pending to batch-process"}</span>
          </div>
          {selected.size > 0 && (
            <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
              <Button size="sm" onClick={handleBatchApprove} disabled={batchApprove.isPending} className="bg-green-600 hover:bg-green-700 text-white rounded-xl gap-1.5 text-xs">
                <CheckCircle className="w-3.5 h-3.5" /> Batch Approve ({selected.size})
              </Button>
              <input
                type="text" placeholder="Reject reason..." value={batchRejectReason} onChange={e => setBatchRejectReason(e.target.value)}
                className="h-8 text-xs rounded-lg border border-border/60 px-2 bg-muted/30"
              />
              <Button size="sm" variant="outline" onClick={handleBatchReject} disabled={batchReject.isPending} className="border-red-300 text-red-600 hover:bg-red-50 rounded-xl gap-1.5 text-xs">
                <XCircle className="w-3.5 h-3.5" /> Batch Reject ({selected.size})
              </Button>
            </div>
          )}
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse"/>)}</div>
      ) : filtered.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-12 text-center">
            <p className="text-4xl mb-3">{statusFilter === "pending" ? "🎉" : "📋"}</p>
            <p className="font-bold text-gray-700">{statusFilter === "pending" ? "No pending requests!" : `No ${statusFilter} requests`}</p>
            <p className="text-sm text-gray-400 mt-1">{statusFilter === "pending" ? "All withdrawal requests have been processed." : "Nothing to show."}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((w: any) => {
            const parsed = parseDesc(w.description || "");
            const expanded = expandedId === w.id;
            return (
              <Card key={w.id} className={`border-0 shadow-sm overflow-hidden ${selected.has(w.id) ? "ring-2 ring-primary/40" : ""}`}>
                <CardContent className="p-0">
                  <button className="w-full text-left p-4" onClick={() => setExpandedId(expanded ? null : w.id)}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {w.status === "pending" && (
                          <div onClick={e => { e.stopPropagation(); toggleSelect(w.id); }} className="flex-shrink-0">
                            <input type="checkbox" className="w-4 h-4 rounded cursor-pointer" checked={selected.has(w.id)} onChange={() => {}} />
                          </div>
                        )}
                        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 text-xl ${w.status === "pending" ? "bg-amber-50" : w.status === "paid" ? "bg-green-50" : "bg-red-50"}`}>
                          {methodIcon(w.paymentMethod || parsed.bank)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold text-gray-900 text-sm">{w.user?.name || "Unknown"}</p>
                            {w.user?.role && (
                              <Badge className={`text-[10px] font-bold ${roleColor(w.user.role)}`} variant="outline">{w.user.role}</Badge>
                            )}
                            <StatusBadge status={w.status}/>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {methodIcon(w.paymentMethod || parsed.bank)} {parsed.bank} · {w.user?.phone} · {fd(w.createdAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <p className={`text-lg font-extrabold ${w.status === "paid" ? "text-green-600" : w.status === "rejected" ? "text-gray-400 line-through" : "text-red-600"}`}>
                          {fc(w.amount)}
                        </p>
                        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400"/> : <ChevronDown className="w-4 h-4 text-gray-400"/>}
                      </div>
                    </div>
                  </button>

                  {expanded && (
                    <div className="border-t border-gray-100 px-4 py-4 bg-gray-50 space-y-4">
                      {/* Details Grid */}
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {[
                          { label: "Bank / Method", value: `${methodIcon(w.paymentMethod || parsed.bank)} ${parsed.bank}` },
                          { label: "Account No.",   value: parsed.account },
                          { label: "Account Name",  value: parsed.title },
                          { label: "Amount",        value: fc(w.amount) },
                          { label: "Status",        value: w.status.toUpperCase() },
                          ...(w.refNo ? [{ label: "Ref / Reason", value: w.refNo }] : []),
                        ].map(f => (
                          <div key={f.label} className="bg-white rounded-xl p-3">
                            <p className="text-[10px] font-bold text-gray-400 uppercase">{f.label}</p>
                            <p className="text-sm font-bold text-gray-800 mt-0.5">{f.value}</p>
                          </div>
                        ))}
                      </div>
                      {parsed.note && (
                        <div className="bg-white rounded-xl p-3">
                          <p className="text-[10px] font-bold text-gray-400 uppercase">Note from User</p>
                          <p className="text-sm text-gray-700 mt-0.5">{parsed.note}</p>
                        </div>
                      )}

                      {/* Action Buttons — only for pending */}
                      {w.status === "pending" && (
                        <div className="flex gap-3">
                          <Button size="sm"
                            className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold gap-2"
                            onClick={() => setApproveTarget(w)}>
                            <CheckCircle className="w-4 h-4"/> Approve & Mark Paid
                          </Button>
                          <Button size="sm" variant="outline"
                            className="flex-1 border-red-300 text-red-600 hover:bg-red-50 font-bold gap-2"
                            onClick={() => setRejectTarget(w)}>
                            <XCircle className="w-4 h-4"/> Reject & Refund
                          </Button>
                        </div>
                      )}

                      {/* Paid info */}
                      {w.status === "paid" && (
                        <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0"/>
                          <p className="text-xs text-green-700 font-medium">
                            {fc(w.amount)} transferred to {parsed.bank} account <strong>{parsed.account}</strong>.
                            {w.refNo && <> Reference: <strong>{w.refNo}</strong></>}
                          </p>
                        </div>
                      )}

                      {/* Rejected info */}
                      {w.status === "rejected" && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2">
                          <XCircle className="w-4 h-4 text-red-500 flex-shrink-0"/>
                          <p className="text-xs text-red-700 font-medium">
                            Request rejected. {w.refNo && <>Reason: <strong>{w.refNo}</strong>.</>} {fc(w.amount)} wapas rider wallet mein aa gaya.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {approveTarget && <ApproveModal w={approveTarget} onClose={() => setApproveTarget(null)}/>}
      {rejectTarget  && <RejectModal  w={rejectTarget}  onClose={() => setRejectTarget(null)}/>}
    </div>
  );
}
