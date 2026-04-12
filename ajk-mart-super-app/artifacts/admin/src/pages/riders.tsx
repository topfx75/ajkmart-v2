import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bike, Search, RefreshCw, Wallet, CircleDollarSign, Gift,
  CheckCircle2, Ban, AlertTriangle, Star, Phone, Download, CalendarDays,
  WifiOff, Wifi, ShieldAlert, ShieldCheck, Eye, XCircle, SkipForward, Gavel, BellOff,
} from "lucide-react";
import { useLanguage } from "@/lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { PullToRefresh } from "@/components/PullToRefresh";
import { useRiders, useUpdateRiderStatus, useRiderPayout, useRiderBonus, useToggleRiderOnline, useRiderPenalties, useRiderRatings, useRestrictRider, useUnrestrictRider, useOverrideSuspension, useApproveUser, useRejectUser } from "@/hooks/use-admin";
import { formatCurrency, formatDate } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/* ── Wallet Modal ── */
function RiderWalletModal({ rider, onClose }: { rider: any; onClose: () => void }) {
  const { toast } = useToast();
  const payoutMutation = useRiderPayout();
  const bonusMutation  = useRiderBonus();
  const [mode, setMode]     = useState<"payout" | "bonus">("payout");
  const [amount, setAmount] = useState("");
  const [note, setNote]     = useState("");

  const handleSubmit = () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast({ title: "Valid amount daalen", variant: "destructive" }); return; }
    const mutation = mode === "payout" ? payoutMutation : bonusMutation;
    mutation.mutate({ id: rider.id, amount: amt, description: note || undefined }, {
      onSuccess: (d: any) => {
        toast({ title: mode === "payout" ? "Payout processed ✅" : "Bonus added ✅", description: `New balance: ${formatCurrency(d.newBalance)}` });
        onClose();
      },
      onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-green-600" /> Rider Wallet — {rider.name || rider.phone}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
            <p className="text-xs text-green-600 font-medium mb-1">Current Wallet Balance</p>
            <p className="text-3xl font-extrabold text-green-700">{formatCurrency(rider.walletBalance)}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {(["payout","bonus"] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`p-3 rounded-xl border text-sm font-bold transition-all ${mode === m
                  ? m === "payout" ? "bg-red-50 border-red-400 text-red-700" : "bg-green-50 border-green-400 text-green-700"
                  : "bg-muted/30 border-border"}`}>
                {m === "payout" ? <><CircleDollarSign className="w-4 h-4 inline mr-1" />Process Payout</> : <><Gift className="w-4 h-4 inline mr-1" />Add Bonus</>}
              </button>
            ))}
          </div>

          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide block mb-1.5">Amount</label>
            <Input type="number" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)} className="h-12 rounded-xl text-lg font-bold" />
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide block mb-1.5">Note (optional)</label>
            <Input placeholder="e.g. Weekly earnings payout" value={note} onChange={e => setNote(e.target.value)} className="h-11 rounded-xl" />
          </div>

          {mode === "payout" && rider.walletBalance < Number(amount || 0) && Number(amount) > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">Wallet balance is insufficient for this payout.</p>
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit}
              disabled={payoutMutation.isPending || bonusMutation.isPending || !amount || (mode === "payout" && rider.walletBalance < Number(amount || 0) && Number(amount) > 0)}
              className={`flex-1 rounded-xl text-white ${mode === "payout" ? "bg-red-500 hover:bg-red-600" : "bg-green-600 hover:bg-green-700"}`}>
              {(payoutMutation.isPending || bonusMutation.isPending) ? "Processing..." : mode === "payout" ? "Process Payout" : "Add Bonus"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Suspend Modal ── */
function RiderSuspendModal({ rider, onClose }: { rider: any; onClose: () => void }) {
  const { toast } = useToast();
  const statusMutation = useUpdateRiderStatus();
  const [action, setAction] = useState<"active"|"blocked"|"banned">(
    rider.isBanned ? "banned" : !rider.isActive ? "blocked" : "active"
  );
  const [reason, setReason] = useState(rider.banReason || "");

  const handleSave = () => {
    statusMutation.mutate({
      id: rider.id,
      isActive: action === "active",
      isBanned: action === "banned",
      banReason: action === "banned" ? reason : null,
    }, {
      onSuccess: () => { toast({ title: "Rider status updated ✅" }); onClose(); },
      onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>Rider Status — {rider.name || rider.phone}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          {[
            { key: "active",  label: "✅ Active",             desc: "Rider can accept deliveries", color: "green" },
            { key: "blocked", label: "⊘ Temporarily Blocked", desc: "Suspend without ban",          color: "amber" },
            { key: "banned",  label: "🚫 Permanently Banned", desc: "Full ban with reason",          color: "red" },
          ].map(opt => (
            <div key={opt.key} onClick={() => setAction(opt.key as any)}
              className={`p-3 rounded-xl border cursor-pointer transition-all ${action === opt.key
                ? opt.color === "green" ? "bg-green-50 border-green-400"
                : opt.color === "amber" ? "bg-amber-50 border-amber-400"
                : "bg-red-50 border-red-400"
                : "bg-muted/30 border-border"}`}>
              <p className="text-sm font-bold">{opt.label}</p>
              <p className="text-xs text-muted-foreground">{opt.desc}</p>
            </div>
          ))}
          {action === "banned" && (
            <Input placeholder="Ban reason (required)" value={reason} onChange={e => setReason(e.target.value)} className="h-11 rounded-xl border-red-200" />
          )}
          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={statusMutation.isPending || (action === "banned" && !reason)} className="flex-1 rounded-xl">
              {statusMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RiderDetailDrawer({ rider, onClose }: { rider: any; onClose: () => void }) {
  const { toast } = useToast();
  const { data: penData } = useRiderPenalties(rider.id);
  const { data: ratData } = useRiderRatings(rider.id);
  const restrictMut = useRestrictRider();
  const unrestrictMut = useUnrestrictRider();

  const penalties: any[] = penData?.penalties || [];
  const ratings: any[] = ratData?.ratings || [];

  const handleRestrict = () => {
    restrictMut.mutate(rider.id, {
      onSuccess: () => { toast({ title: "Rider restricted" }); onClose(); },
      onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };
  const handleUnrestrict = () => {
    unrestrictMut.mutate(rider.id, {
      onSuccess: () => { toast({ title: "Rider unrestricted" }); onClose(); },
      onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-lg rounded-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-blue-600" /> Rider Details — {rider.name || rider.phone}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
              <p className="text-[10px] text-red-500 font-bold uppercase">Cancels</p>
              <p className="text-xl font-extrabold text-red-700">{rider.cancelCount ?? 0}</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
              <p className="text-[10px] text-amber-500 font-bold uppercase">Ignores</p>
              <p className="text-xl font-extrabold text-amber-700">{rider.ignoreCount ?? 0}</p>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-center">
              <p className="text-[10px] text-purple-500 font-bold uppercase">Penalties</p>
              <p className="text-xl font-extrabold text-purple-700">{formatCurrency(rider.penaltyTotal ?? 0)}</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
              <p className="text-[10px] text-blue-500 font-bold uppercase">Rating</p>
              <p className="text-xl font-extrabold text-blue-700">{rider.avgRating ?? 0} <span className="text-xs font-normal">({rider.ratingCount ?? 0})</span></p>
            </div>
          </div>

          <div className="flex gap-2">
            {rider.isRestricted ? (
              <Button onClick={handleUnrestrict} disabled={unrestrictMut.isPending}
                className="flex-1 rounded-xl bg-green-600 hover:bg-green-700 text-white gap-2">
                <ShieldCheck className="w-4 h-4" /> Unrestrict Rider
              </Button>
            ) : (
              <Button onClick={handleRestrict} disabled={restrictMut.isPending}
                variant="outline" className="flex-1 rounded-xl border-red-300 text-red-700 hover:bg-red-50 gap-2">
                <ShieldAlert className="w-4 h-4" /> Restrict Rider
              </Button>
            )}
          </div>

          {penalties.length > 0 && (
            <div>
              <p className="text-sm font-bold text-foreground mb-2">Penalty History</p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {penalties.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      {p.type === "cancel" ? <XCircle className="w-3.5 h-3.5 text-red-500"/> : <SkipForward className="w-3.5 h-3.5 text-amber-500"/>}
                      <span className="text-muted-foreground">{p.reason || p.type}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {p.amount > 0 && <span className="font-bold text-red-600">-{formatCurrency(p.amount)}</span>}
                      <span className="text-muted-foreground">{formatDate(p.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ratings.length > 0 && (
            <div>
              <p className="text-sm font-bold text-foreground mb-2">Recent Ratings</p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {ratings.map((rt: any) => (
                  <div key={rt.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Star className="w-3.5 h-3.5 text-amber-500"/>
                      <span className="font-bold">{rt.stars}/5</span>
                      {rt.comment && <span className="text-muted-foreground truncate max-w-[180px]">"{rt.comment}"</span>}
                    </div>
                    <span className="text-muted-foreground">{formatDate(rt.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function exportRidersCSV(riders: any[]) {
  const header = "ID,Name,Phone,Status,Wallet,Joined";
  const rows = riders.map((r: any) =>
    [r.id, r.name || "", r.phone || "",
     r.isBanned ? "banned" : !r.isActive ? "blocked" : r.isOnline ? "online" : "offline",
     r.walletBalance, r.createdAt?.slice(0,10) || ""].join(",")
  );
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `riders-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

/* ══════════ Main Riders Page ══════════ */
export default function Riders() {
  const [, navigate] = useLocation();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const { data, isLoading, refetch, isFetching } = useRiders();
  const toggleOnlineMutation = useToggleRiderOnline();
  const overrideSuspM = useOverrideSuspension("riders");
  const { toast } = useToast();

  const [search,       setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom]         = useState("");
  const [dateTo, setDateTo]             = useState("");
  const [walletModal,  setWalletModal]  = useState<any>(null);
  const [suspendModal, setSuspendModal] = useState<any>(null);
  const [detailModal,  setDetailModal]  = useState<any>(null);

  const riders: any[] = data?.users || data?.riders || [];

  const handleToggleOnline = (r: any) => {
    toggleOnlineMutation.mutate({ id: r.id, isOnline: !r.isOnline }, {
      onSuccess: () => toast({ title: r.isOnline ? "Rider set offline" : "Rider set online ✅" }),
      onError: e => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  const filtered = riders.filter((r: any) => {
    const q = search.toLowerCase();
    const matchSearch = (r.name || "").toLowerCase().includes(q) || (r.phone || "").includes(q);
    const matchStatus =
      statusFilter === "all" ||
      (statusFilter === "pending"  && r.approvalStatus === "pending") ||
      (statusFilter === "online"  && r.isOnline && r.isActive) ||
      (statusFilter === "offline" && !r.isOnline && r.isActive && r.approvalStatus !== "pending") ||
      (statusFilter === "blocked" && !r.isActive && !r.isBanned && r.approvalStatus !== "pending") ||
      (statusFilter === "banned"  && r.isBanned);
    const matchDate = (!dateFrom || new Date(r.createdAt) >= new Date(dateFrom))
                   && (!dateTo   || new Date(r.createdAt) <= new Date(dateTo + "T23:59:59"));
    return matchSearch && matchStatus && matchDate;
  });

  const onlineRiders   = riders.filter((r: any) => r.isOnline && r.isActive).length;
  const activeRiders   = riders.filter((r: any) => r.isActive && !r.isBanned).length;
  const pendingRiders  = riders.filter((r: any) => r.approvalStatus === "pending").length;
  const totalWallet    = riders.reduce((s: number, r: any) => s + r.walletBalance, 0);

  const getStatusBadge = (r: any) => {
    if (r.approvalStatus === "pending") return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 text-[10px]">⏳ Pending Approval</Badge>;
    if (r.isBanned)      return <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">Banned</Badge>;
    if (r.isRestricted)  return <Badge className="bg-purple-100 text-purple-700 border-purple-200 text-[10px]">Restricted</Badge>;
    if (!r.isActive)     return <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">Blocked</Badge>;
    if (r.isOnline)      return <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px]">🟢 Online</Badge>;
    return                      <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-[10px]">Offline</Badge>;
  };

  const approveM = useApproveUser();
  const rejectM  = useRejectUser();

  const handleApprove = (r: any) => {
    approveM.mutate({ id: r.id }, {
      onSuccess: () => { toast({ title: "Rider approved ✅" }); refetch(); },
      onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  const handleReject = (r: any) => {
    const note = window.prompt("Rejection reason (optional):");
    rejectM.mutate({ id: r.id, note: note || undefined }, {
      onSuccess: () => { toast({ title: "Rider rejected" }); refetch(); },
      onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  const qc = useQueryClient();
  const handlePullRefresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["admin-riders"] });
  }, [qc]);

  return (
    <PullToRefresh onRefresh={handlePullRefresh} className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-green-100 text-green-600 rounded-xl flex items-center justify-center">
            <Bike className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">Riders</h1>
            <p className="text-sm text-muted-foreground">{riders.length} total · {onlineRiders} online now{pendingRiders > 0 ? ` · ${pendingRiders} pending` : ""}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportRidersCSV(filtered)} className="h-9 rounded-xl gap-2">
            <Download className="w-4 h-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-9 rounded-xl gap-2">
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} /> {T("refresh")}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Total Riders",      value: String(riders.length),       icon: Bike,          color: "text-green-600",  bg: "bg-green-100" },
          { label: "Online Now",        value: String(onlineRiders),        icon: CheckCircle2,  color: "text-emerald-600",bg: "bg-emerald-100"},
          { label: "Pending Approval",  value: String(pendingRiders),       icon: AlertTriangle, color: "text-yellow-600", bg: "bg-yellow-100" },
          { label: "Wallet Pending",    value: formatCurrency(totalWallet), icon: Wallet,        color: "text-amber-600",  bg: "bg-amber-100" },
        ].map((s, i) => (
          <Card key={i} className="rounded-2xl border-border/50 shadow-sm">
            <CardContent className="p-4 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground font-medium mb-0.5">{s.label}</p>
                <p className="text-xl font-bold text-foreground">{s.value}</p>
              </div>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.bg}`}>
                <s.icon className={`w-5 h-5 ${s.color}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="p-4 rounded-2xl border-border/50 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search by name or phone..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-11 rounded-xl bg-muted/30" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-11 rounded-xl bg-muted/30 w-full sm:w-44">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Riders</SelectItem>
              <SelectItem value="pending">⏳ Pending Approval</SelectItem>
              <SelectItem value="online">🟢 Online</SelectItem>
              <SelectItem value="offline">⚫ Offline</SelectItem>
              <SelectItem value="blocked">⊘ Blocked</SelectItem>
              <SelectItem value="banned">🚫 Banned</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 rounded-xl bg-muted/30 text-xs w-32" />
          <span className="text-xs text-muted-foreground">–</span>
          <Input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="h-9 rounded-xl bg-muted/30 text-xs w-32" />
          {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-xs text-primary hover:underline">Clear</button>}
        </div>
      </Card>

      {/* Riders List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-2xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-12 text-center">
            <Bike className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No riders found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((r: any) => (
            <Card key={r.id} className="rounded-2xl border-border/50 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  {/* Rider Info */}
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 font-bold text-lg ${r.isOnline && r.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {r.name ? r.name[0].toUpperCase() : "R"}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-sm text-foreground">{r.name || "Unknown Rider"}</p>
                        {getStatusBadge(r)}
                        {r.silenceMode && (
                          <Badge className="bg-orange-100 text-orange-700 border border-orange-200 text-[10px] gap-0.5 py-0">
                            <BellOff className="w-2.5 h-2.5" /> Silenced
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <a href={`tel:${r.phone}`} className="flex items-center gap-1 text-xs text-blue-600 font-medium hover:underline">
                          <Phone className="w-3 h-3" /> {r.phone}
                        </a>
                        <a href={`https://wa.me/92${r.phone.replace(/^(\+92|92|0)/, "")}`} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-green-600 font-medium hover:underline">
                          💬 WhatsApp
                        </a>
                      </div>
                      <p className="text-xs text-muted-foreground">Joined {formatDate(r.createdAt)}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-center">
                    <div>
                      <p className="text-xs text-muted-foreground">Wallet</p>
                      <p className="font-bold text-sm text-green-700">{formatCurrency(r.walletBalance)}</p>
                    </div>
                    {(r.cancelCount > 0 || r.ignoreCount > 0) && (
                      <div className="flex gap-2">
                        {r.cancelCount > 0 && (
                          <div title="Total cancels">
                            <p className="text-[10px] text-red-500 font-bold">Cancels</p>
                            <p className="text-sm font-bold text-red-600">{r.cancelCount}</p>
                          </div>
                        )}
                        {r.ignoreCount > 0 && (
                          <div title="Total ignores">
                            <p className="text-[10px] text-amber-500 font-bold">Ignores</p>
                            <p className="text-sm font-bold text-amber-600">{r.ignoreCount}</p>
                          </div>
                        )}
                      </div>
                    )}
                    {r.avgRating > 0 && (
                      <div title="Average rating">
                        <p className="text-[10px] text-blue-500 font-bold">Rating</p>
                        <p className="text-sm font-bold text-blue-600">{r.avgRating} <Star className="w-3 h-3 inline text-amber-400"/></p>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 shrink-0 flex-wrap">
                    {r.approvalStatus === "pending" && (
                      <>
                        <Button size="sm" onClick={() => handleApprove(r)} disabled={approveM.isPending}
                          className="h-9 rounded-xl gap-1.5 text-xs bg-green-600 hover:bg-green-700 text-white">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleReject(r)} disabled={rejectM.isPending}
                          className="h-9 rounded-xl gap-1.5 text-xs border-red-200 text-red-700 hover:bg-red-50">
                          <XCircle className="w-3.5 h-3.5" /> Reject
                        </Button>
                      </>
                    )}
                    {r.isActive && !r.isBanned && r.approvalStatus !== "pending" && (
                      <Button size="sm" variant="outline" onClick={() => handleToggleOnline(r)}
                        disabled={toggleOnlineMutation.isPending}
                        className={`h-9 rounded-xl gap-1.5 text-xs ${r.isOnline ? "border-amber-200 text-amber-700 hover:bg-amber-50" : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"}`}>
                        {r.isOnline ? <><WifiOff className="w-3.5 h-3.5" /> Set Offline</> : <><Wifi className="w-3.5 h-3.5" /> Set Online</>}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setWalletModal(r)}
                      className="h-9 rounded-xl gap-1.5 text-xs border-green-200 text-green-700 hover:bg-green-50">
                      <Wallet className="w-3.5 h-3.5" /> Wallet
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setSuspendModal(r)}
                      className={`h-9 rounded-xl gap-1.5 text-xs ${r.isActive && !r.isBanned ? "border-red-200 text-red-700 hover:bg-red-50" : "border-green-200 text-green-700 hover:bg-green-50"}`}>
                      {r.isActive && !r.isBanned
                        ? <><Ban className="w-3.5 h-3.5" /> Suspend</>
                        : <><CheckCircle2 className="w-3.5 h-3.5" /> Activate</>
                      }
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setDetailModal(r)}
                      className="h-9 rounded-xl gap-1.5 text-xs border-blue-200 text-blue-700 hover:bg-blue-50">
                      <Eye className="w-3.5 h-3.5" /> Details
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => navigate(`/account-conditions?userId=${r.id}`)}
                      className="h-9 rounded-xl gap-1.5 text-xs border-violet-200 text-violet-700 hover:bg-violet-50" title="Conditions">
                      <Gavel className="w-3.5 h-3.5" /> Conditions
                    </Button>
                    {r.autoSuspendedAt && !r.adminOverrideSuspension && (
                      <Button size="sm" variant="outline" onClick={() => {
                        overrideSuspM.mutate(r.id, {
                          onSuccess: () => toast({ title: "Suspension overridden ✅", description: "Rider is now active again." }),
                          onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
                        });
                      }} disabled={overrideSuspM.isPending}
                        className="h-9 rounded-xl gap-1.5 text-xs border-purple-200 text-purple-700 hover:bg-purple-50">
                        <ShieldCheck className="w-3.5 h-3.5" /> Override Suspend
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Modals */}
      {walletModal  && <RiderWalletModal  rider={walletModal}  onClose={() => setWalletModal(null)} />}
      {suspendModal && <RiderSuspendModal rider={suspendModal} onClose={() => setSuspendModal(null)} />}
      {detailModal  && <RiderDetailDrawer rider={detailModal}  onClose={() => setDetailModal(null)} />}
    </PullToRefresh>
  );
}
