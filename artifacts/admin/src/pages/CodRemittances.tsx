import { useState } from "react";
import { RefreshCw, CheckCircle, XCircle, ChevronDown, ChevronUp, Banknote, Search, CalendarDays } from "lucide-react";
import { useCodRemittances, useVerifyCodRemittance, useRejectCodRemittance, useBatchVerifyCodRemittances } from "@/hooks/use-admin";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const fc = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;
const fd = (d: string | Date) =>
  new Date(d).toLocaleString("en-PK", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

type StatusFilter = "all" | "pending" | "verified" | "rejected";

function parseDesc(desc: string) {
  const clean = desc.replace("COD Remittance — ", "");
  const parts = clean.split(" · ");
  return {
    method:  parts[0] || "—",
    account: parts[1] || "—",
    txId:    parts[2]?.replace("TxID: ", "") || "",
    note:    parts[3] || "",
  };
}

function methodIcon(method: string) {
  const m = (method || "").toLowerCase();
  if (m.includes("jazzcash"))  return "🔴";
  if (m.includes("easypaisa")) return "🟢";
  return "🏦";
}

function StatusBadge({ status }: { status: string }) {
  if (status === "pending")  return <Badge className="bg-amber-100 text-amber-700 border-0 text-xs font-bold">⏳ Pending</Badge>;
  if (status === "verified") return <Badge className="bg-green-100 text-green-700 border-0 text-xs font-bold">✅ Verified</Badge>;
  if (status === "rejected") return <Badge className="bg-red-100 text-red-700 border-0 text-xs font-bold">❌ Rejected</Badge>;
  return <Badge className="bg-gray-100 text-gray-600 border-0 text-xs">{status}</Badge>;
}

function VerifyModal({ item, onClose }: { item: any; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [err, setErr]   = useState("");
  const { toast }       = useToast();
  const verify = useVerifyCodRemittance();
  const d = parseDesc(item.description || "");

  const submit = () => {
    verify.mutate({ id: item.id, note }, {
      onSuccess: () => {
        toast({ title: "✅ Remittance Verified", description: `Rs. ${Math.round(item.amount).toLocaleString()} marked as received. Rider notified.` });
        onClose();
      },
      onError: (e: any) => setErr(e.message),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-extrabold text-gray-900 mb-4">✅ Verify COD Remittance</h3>
        <div className="bg-green-50 border border-green-100 rounded-xl p-4 mb-5 space-y-2">
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">Rider</span>
            <span className="font-bold text-sm">{item.user?.name || "Unknown"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">Phone</span>
            <span className="font-bold text-sm">{item.user?.phone || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">Method</span>
            <span className="font-bold text-sm">{methodIcon(d.method)} {d.method}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">Account</span>
            <span className="font-bold text-sm font-mono">{d.account}</span>
          </div>
          {d.txId && (
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">TxID</span>
              <span className="font-bold text-sm font-mono">{d.txId}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-green-100 pt-2 mt-2">
            <span className="text-sm font-semibold text-gray-700">Amount</span>
            <span className="font-extrabold text-green-600 text-lg">{fc(item.amount)}</span>
          </div>
        </div>
        <div className="mb-4">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">Note for Rider (Optional)</label>
          <input value={note} onChange={e => setNote(e.target.value)}
            placeholder="e.g. Received via JazzCash on 27 March"
            className="w-full h-10 border border-gray-200 rounded-xl px-3 text-sm focus:outline-none focus:border-green-400"/>
        </div>
        {err && <p className="text-red-500 text-sm mb-3 font-semibold">⚠️ {err}</p>}
        <div className="flex gap-3">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
          <Button onClick={submit} disabled={verify.isPending} className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold">
            {verify.isPending ? "Verifying..." : "✅ Mark as Received"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RejectModal({ item, onClose }: { item: any; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr]       = useState("");
  const { toast }           = useToast();
  const reject = useRejectCodRemittance();

  const submit = () => {
    if (!reason.trim()) { setErr("Rejection reason likhein"); return; }
    reject.mutate({ id: item.id, reason }, {
      onSuccess: () => {
        toast({ title: "❌ Remittance Rejected", description: "Rider ko notification bhej di gayi hai." });
        onClose();
      },
      onError: (e: any) => setErr(e.message),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-extrabold text-red-700 mb-4">❌ Reject Remittance</h3>
        <p className="text-sm text-gray-600 mb-4">
          <span className="font-bold">{item.user?.name}</span> ka <span className="font-bold text-red-600">{fc(item.amount)}</span> remittance reject karein.
        </p>
        <div className="mb-4">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">Rejection Reason *</label>
          <textarea value={reason} onChange={e => { setReason(e.target.value); setErr(""); }} rows={3}
            placeholder="e.g. Transaction ID not found in JazzCash records, please resubmit with correct ID"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-400 resize-none"/>
        </div>
        {err && <p className="text-red-500 text-sm mb-3 font-semibold">⚠️ {err}</p>}
        <div className="flex gap-3">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
          <Button onClick={submit} disabled={reject.isPending} className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold">
            {reject.isPending ? "Rejecting..." : "❌ Reject"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RemittanceCard({ item }: { item: any }) {
  const [expanded, setExpanded] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const d = parseDesc(item.description || "");

  return (
    <>
      <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 bg-blue-50 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0">
              {methodIcon(d.method)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold text-gray-900 text-sm">{item.user?.name || "Unknown Rider"}</p>
                <StatusBadge status={item.status} />
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{item.user?.phone} · {d.method}</p>
              <p className="text-xs text-gray-400 mt-0.5">{fd(item.createdAt)}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-lg font-extrabold text-gray-900">{fc(item.amount)}</p>
              <button onClick={() => setExpanded(!expanded)} className="text-xs text-gray-400 flex items-center gap-0.5 ml-auto mt-1">
                {expanded ? <ChevronUp className="w-3 h-3"/> : <ChevronDown className="w-3 h-3"/>}
                {expanded ? "Less" : "More"}
              </button>
            </div>
          </div>

          {expanded && (
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-gray-400">Account</span><p className="font-bold font-mono">{d.account}</p></div>
                {d.txId && <div><span className="text-gray-400">Tx Ref</span><p className="font-bold font-mono">{d.txId}</p></div>}
                {d.note && <div className="col-span-2"><span className="text-gray-400">Note</span><p className="font-medium">{d.note}</p></div>}
                {item.refDetail && (
                  <div className="col-span-2">
                    <span className="text-gray-400">{item.status === "verified" ? "Verified Date" : "Rejection Reason"}</span>
                    <p className="font-medium">{item.refDetail}</p>
                  </div>
                )}
              </div>
              {item.status === "pending" && (
                <div className="flex gap-2 mt-3">
                  <Button size="sm" onClick={() => setVerifyOpen(true)}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold h-9 text-xs gap-1">
                    <CheckCircle className="w-3.5 h-3.5"/> Verify
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRejectOpen(true)}
                    className="flex-1 border-red-200 text-red-600 hover:bg-red-50 font-bold h-9 text-xs gap-1">
                    <XCircle className="w-3.5 h-3.5"/> Reject
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      {verifyOpen && <VerifyModal item={item} onClose={() => setVerifyOpen(false)}/>}
      {rejectOpen && <RejectModal item={item} onClose={() => setRejectOpen(false)}/>}
    </>
  );
}

export default function CodRemittances() {
  const { data, isLoading, refetch } = useCodRemittances();
  const batchVerify = useBatchVerifyCodRemittances();
  const { toast } = useToast();

  const [filter, setFilter]   = useState<StatusFilter>("all");
  const [search, setSearch]   = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const all: any[] = data?.remittances || [];

  const filtered = all.filter(r => {
    const matchStatus = filter === "all" || r.status === filter;
    const q = search.toLowerCase();
    const matchSearch = !q || r.user?.name?.toLowerCase().includes(q) || r.user?.phone?.includes(q) || r.description?.toLowerCase().includes(q);
    const matchDate = (!dateFrom || new Date(r.createdAt) >= new Date(dateFrom))
                   && (!dateTo   || new Date(r.createdAt) <= new Date(dateTo + "T23:59:59"));
    return matchStatus && matchSearch && matchDate;
  });

  const totalPending  = all.filter(r => r.status === "pending").reduce((s: number, r: any) => s + r.amount, 0);
  const totalVerified = all.filter(r => r.status === "verified").reduce((s: number, r: any) => s + r.amount, 0);
  const pendingCount  = all.filter(r => r.status === "pending").length;

  const pendingFiltered = filtered.filter(r => r.status === "pending");
  const toggleSelect = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    const ids = pendingFiltered.map((r: any) => r.id);
    setSelected(prev => prev.size === ids.length ? new Set() : new Set(ids));
  };
  const handleBatchVerify = () => {
    if (selected.size === 0) return;
    batchVerify.mutate([...selected], {
      onSuccess: (r: any) => { toast({ title: `✅ ${r.verified?.length || selected.size} remittances verified` }); setSelected(new Set()); },
      onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    });
  };

  const STATUS_TABS: { key: StatusFilter; label: string; count: number }[] = [
    { key: "all",      label: "All",      count: all.length },
    { key: "pending",  label: "Pending",  count: all.filter(r => r.status === "pending").length },
    { key: "verified", label: "Verified", count: all.filter(r => r.status === "verified").length },
    { key: "rejected", label: "Rejected", count: all.filter(r => r.status === "rejected").length },
  ];

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2">
            <Banknote className="w-6 h-6 text-blue-600"/> COD Remittances
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Riders ke COD cash deposits verify karein</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
          <RefreshCw className="w-4 h-4"/> Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-amber-600 font-bold uppercase">Pending Amount</p>
            <p className="text-2xl font-extrabold text-amber-700 mt-1">{fc(totalPending)}</p>
            <p className="text-xs text-gray-400 mt-0.5">{pendingCount} requests</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-green-600 font-bold uppercase">Total Verified</p>
            <p className="text-2xl font-extrabold text-green-700 mt-1">{fc(totalVerified)}</p>
            <p className="text-xs text-gray-400 mt-0.5">{all.filter(r => r.status === "verified").length} cleared</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 font-bold uppercase">Total Requests</p>
            <p className="text-2xl font-extrabold text-gray-800 mt-1">{all.length}</p>
            <p className="text-xs text-gray-400 mt-0.5">all time</p>
          </CardContent>
        </Card>
      </div>

      {/* How it works info */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
        <p className="text-sm font-bold text-blue-800 mb-2">💡 COD Remittance Process</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-xs text-blue-700">
          <div className="flex items-start gap-1.5"><span className="font-extrabold">1.</span><span>Rider COD order deliver karta hai, customer se cash leta hai</span></div>
          <div className="flex items-start gap-1.5"><span className="font-extrabold">2.</span><span>Rider app se JazzCash/EasyPaisa ya bank mein remit karta hai</span></div>
          <div className="flex items-start gap-1.5"><span className="font-extrabold">3.</span><span>App mein submission karta hai proof ke sath</span></div>
          <div className="flex items-start gap-1.5"><span className="font-extrabold">4.</span><span>Admin verify karta hai → rider ka COD balance clear hota hai</span></div>
        </div>
      </div>

      {/* Filter + Search */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex gap-1.5 overflow-x-auto">
            {STATUS_TABS.map(tab => (
              <button key={tab.key} onClick={() => setFilter(tab.key)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                  filter === tab.key ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"
                }`}>
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Rider name ya phone..."
              className="w-full h-9 pl-9 pr-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-400"/>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-gray-400 shrink-0" />
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 rounded-xl bg-gray-50 text-xs w-32 border-gray-200" />
          <span className="text-xs text-gray-400">–</span>
          <Input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="h-9 rounded-xl bg-gray-50 text-xs w-32 border-gray-200" />
          {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-xs text-blue-600 hover:underline">Clear</button>}
        </div>
      </div>

      {/* Batch Action Bar */}
      {pendingFiltered.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-3">
            <input type="checkbox" className="w-4 h-4 rounded cursor-pointer" checked={selected.size === pendingFiltered.length && pendingFiltered.length > 0} onChange={toggleAll} />
            <span className="text-sm text-gray-600">{selected.size > 0 ? `${selected.size} selected` : "Select pending to batch-verify"}</span>
          </div>
          {selected.size > 0 && (
            <div className="sm:ml-auto">
              <Button size="sm" onClick={handleBatchVerify} disabled={batchVerify.isPending}
                className="bg-green-600 hover:bg-green-700 text-white rounded-xl gap-1.5 text-xs">
                <CheckCircle className="w-3.5 h-3.5" /> Batch Verify ({selected.size})
              </Button>
            </div>
          )}
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse"/>)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-3">📋</div>
          <p className="font-bold text-gray-600">No {filter === "all" ? "" : filter} remittances</p>
          <p className="text-sm text-gray-400 mt-1">Jab riders COD cash submit karenge, yahan dikhega</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r: any) => (
            <div key={r.id} className="relative">
              {r.status === "pending" && (
                <div className="absolute top-4 left-4 z-10" onClick={e => { e.stopPropagation(); toggleSelect(r.id); }}>
                  <input type="checkbox" className="w-4 h-4 rounded cursor-pointer" checked={selected.has(r.id)} onChange={() => {}} />
                </div>
              )}
              <div className={r.status === "pending" ? "pl-8" : ""}>
                <RemittanceCard item={r}/>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
