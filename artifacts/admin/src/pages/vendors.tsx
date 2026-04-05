import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Store, Search, RefreshCw, Wallet, TrendingUp, ShoppingBag,
  CheckCircle2, XCircle, Ban, CircleDollarSign, CreditCard,
  Package, Phone, ToggleLeft, ToggleRight, AlertTriangle, X, MessageCircle, Settings2,
  Download, CalendarDays, Percent, Truck, Gavel,
} from "lucide-react";
import { useLanguage } from "@/lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { PullToRefresh } from "@/components/PullToRefresh";
import { useVendors, useUpdateVendorStatus, useVendorPayout, useVendorCredit, usePlatformSettings, useVendorCommissionOverride, useOverrideSuspension, useDeliveryAccess, useAddWhitelistEntry, useDeleteWhitelistEntry, useDeliveryAccessRequests, useResolveDeliveryRequest } from "@/hooks/use-admin";
import { formatCurrency, formatDate } from "@/lib/format";
import { PLATFORM_DEFAULTS } from "@/lib/platformConfig";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/* ── Wallet Modal ── */
function WalletModal({ vendor, onClose }: { vendor: any; onClose: () => void }) {
  const { toast } = useToast();
  const payoutMutation = useVendorPayout();
  const creditMutation = useVendorCredit();
  const [mode, setMode]         = useState<"payout" | "credit">("payout");
  const [amount, setAmount]     = useState("");
  const [note, setNote]         = useState("");

  const handleSubmit = () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast({ title: "Valid amount daalen", variant: "destructive" }); return; }
    const mutation = mode === "payout" ? payoutMutation : creditMutation;
    mutation.mutate({ id: vendor.id, amount: amt, description: note || undefined }, {
      onSuccess: (d: any) => {
        toast({ title: mode === "payout" ? "Payout processed ✅" : "Amount credited ✅", description: `New balance: ${formatCurrency(d.newBalance)}` });
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
            <Wallet className="w-5 h-5 text-orange-500" /> Vendor Wallet — {vendor.storeName || vendor.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-center">
            <p className="text-xs text-orange-600 font-medium mb-1">Current Wallet Balance</p>
            <p className="text-3xl font-extrabold text-orange-700">{formatCurrency(vendor.walletBalance)}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {(["payout","credit"] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`p-3 rounded-xl border text-sm font-bold transition-all ${mode === m ? (m === "payout" ? "bg-red-50 border-red-400 text-red-700" : "bg-green-50 border-green-400 text-green-700") : "bg-muted/30 border-border"}`}>
                {m === "payout" ? <><CircleDollarSign className="w-4 h-4 inline mr-1" />Process Payout</> : <><CreditCard className="w-4 h-4 inline mr-1" />Credit Amount</>}
              </button>
            ))}
          </div>

          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide block mb-1.5">Amount (Rs.)</label>
            <Input type="number" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)}
              className="h-12 rounded-xl text-lg font-bold" />
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide block mb-1.5">Note (optional)</label>
            <Input placeholder="e.g. Weekly settlement" value={note} onChange={e => setNote(e.target.value)} className="h-11 rounded-xl" />
          </div>

          {mode === "payout" && vendor.walletBalance < Number(amount || 0) && Number(amount) > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">Wallet balance is insufficient for this payout.</p>
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit}
              disabled={payoutMutation.isPending || creditMutation.isPending || !amount}
              className={`flex-1 rounded-xl ${mode === "payout" ? "bg-red-500 hover:bg-red-600" : "bg-green-600 hover:bg-green-700"} text-white`}>
              {(payoutMutation.isPending || creditMutation.isPending) ? "Processing..." : mode === "payout" ? "Process Payout" : "Credit Amount"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Suspend Modal ── */
function SuspendModal({ vendor, onClose }: { vendor: any; onClose: () => void }) {
  const { toast } = useToast();
  const statusMutation = useUpdateVendorStatus();
  const [action, setAction] = useState<"active" | "blocked" | "banned">(
    vendor.isBanned ? "banned" : !vendor.isActive ? "blocked" : "active"
  );
  const [reason, setReason] = useState(vendor.banReason || "");

  const handleSave = () => {
    statusMutation.mutate({
      id: vendor.id,
      isActive: action === "active",
      isBanned: action === "banned",
      banReason: action === "banned" ? reason : null,
    }, {
      onSuccess: () => { toast({ title: "Vendor status updated ✅" }); onClose(); },
      onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>Vendor Status — {vendor.storeName || vendor.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          {[
            { key: "active",  label: "✅ Active",             desc: "Vendor can accept orders", color: "green" },
            { key: "blocked", label: "⊘ Temporarily Blocked", desc: "Suspend without ban",       color: "amber" },
            { key: "banned",  label: "🚫 Permanently Banned", desc: "Ban with reason",           color: "red" },
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

/* ── Commission Override Modal ── */
function CommissionModal({ vendor, defaultPct, onClose }: { vendor: any; defaultPct: number; onClose: () => void }) {
  const { toast } = useToast();
  const overrideMutation = useVendorCommissionOverride();
  const [pct, setPct] = useState(String(vendor.commissionOverride ?? defaultPct));

  const handleSave = () => {
    const v = parseFloat(pct);
    if (isNaN(v) || v < 0 || v > 100) { toast({ title: "Invalid %", variant: "destructive" }); return; }
    overrideMutation.mutate({ id: vendor.id, commissionPct: v }, {
      onSuccess: () => { toast({ title: "Commission override saved ✅" }); onClose(); },
      onError: e => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Percent className="w-5 h-5 text-orange-600" /> Commission — {vendor.storeName || vendor.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-sm">
            <p className="text-orange-700">Platform default: <strong>{defaultPct}%</strong></p>
            {vendor.commissionOverride && (
              <p className="text-orange-700 mt-0.5">Current override: <strong>{vendor.commissionOverride}%</strong></p>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Override Commission %</label>
            <Input type="number" min="0" max="100" step="0.5" value={pct} onChange={e => setPct(e.target.value)} className="h-12 rounded-xl text-lg font-bold" />
            <p className="text-xs text-muted-foreground">Set to 0–100%. Leave at platform default to reset.</p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={overrideMutation.isPending} className="flex-1 rounded-xl bg-orange-600 hover:bg-orange-700 text-white">
              {overrideMutation.isPending ? "Saving..." : "Save Override"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function exportVendorsCSV(vendors: any[]) {
  const header = "ID,Store,Owner,Phone,Status,Orders,Revenue,Wallet,Joined";
  const rows = vendors.map((v: any) =>
    [v.id, v.storeName || "", v.name || "", v.phone || "",
     v.isBanned ? "banned" : !v.isActive ? "blocked" : "active",
     v.totalOrders || 0, v.totalRevenue || 0, v.walletBalance, v.createdAt?.slice(0,10) || ""].join(",")
  );
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `vendors-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

/* ══════════ Main Vendors Page ══════════ */
export default function Vendors() {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const [, setLocation] = useLocation();
  const { data, isLoading, refetch, isFetching } = useVendors();
  const { data: settingsData } = usePlatformSettings();
  const overrideSuspM = useOverrideSuspension("vendors");
  const { data: daData } = useDeliveryAccess();
  const addWhitelistM = useAddWhitelistEntry();
  const deleteWhitelistM = useDeleteWhitelistEntry();
  const { data: reqData } = useDeliveryAccessRequests();
  const resolveReqM = useResolveDeliveryRequest();
  const { toast } = useToast();

  const [search,       setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom]         = useState("");
  const [dateTo, setDateTo]             = useState("");
  const [walletModal,  setWalletModal]  = useState<any>(null);
  const [suspendModal, setSuspendModal] = useState<any>(null);
  const [commModal,    setCommModal]    = useState<any>(null);

  const settings: any[] = settingsData?.settings || [];
  const vendorCommissionPct = parseFloat(settings.find((s: any) => s.key === "vendor_commission_pct")?.value ?? String(PLATFORM_DEFAULTS.vendorCommissionPct));
  const vendorShare = 1 - vendorCommissionPct / 100;

  const vendors: any[] = data?.vendors || [];
  const deliveryMode = daData?.mode || "all";
  const vendorWhitelistMap = new Map<string, string>();
  (daData?.whitelist || [])
    .filter((w: any) => w.type === "vendor" && w.status === "active")
    .forEach((w: any) => vendorWhitelistMap.set(w.targetId, w.id));
  const whitelistedVendorIds = new Set(vendorWhitelistMap.keys());
  const pendingRequests: any[] = reqData?.requests || [];
  const vendorPendingReqs = new Map<string, any[]>();
  pendingRequests
    .filter((r: any) => r.status === "pending")
    .forEach((r: any) => {
      const arr = vendorPendingReqs.get(r.vendorId) || [];
      arr.push(r);
      vendorPendingReqs.set(r.vendorId, arr);
    });

  const filtered = vendors.filter((v: any) => {
    const q = search.toLowerCase();
    const matchSearch =
      (v.storeName || "").toLowerCase().includes(q) ||
      (v.name || "").toLowerCase().includes(q) ||
      (v.phone || "").includes(q);
    const matchStatus =
      statusFilter === "all" ||
      (statusFilter === "active"  && v.isActive && !v.isBanned) ||
      (statusFilter === "pending" && v.approvalStatus === "pending") ||
      (statusFilter === "blocked" && !v.isActive && !v.isBanned && v.approvalStatus !== "pending") ||
      (statusFilter === "banned"  && v.isBanned);
    const matchDate = (!dateFrom || new Date(v.createdAt) >= new Date(dateFrom))
                   && (!dateTo   || new Date(v.createdAt) <= new Date(dateTo + "T23:59:59"));
    return matchSearch && matchStatus && matchDate;
  });

  const totalEarnings    = vendors.reduce((s: number, v: any) => s + v.totalRevenue * vendorShare, 0);
  const totalWallet      = vendors.reduce((s: number, v: any) => s + v.walletBalance, 0);
  const activeVendors    = vendors.filter((v: any) => v.isActive && !v.isBanned).length;
  const pendingVendors   = vendors.filter((v: any) => v.approvalStatus === "pending").length;
  const suspendedVendors = vendors.filter((v: any) => (!v.isActive || v.isBanned) && v.approvalStatus !== "pending").length;

  const getStatusBadge = (v: any) => {
    if (v.isBanned)   return <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">Banned</Badge>;
    if (v.approvalStatus === "pending") return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 text-[10px]">Pending Approval</Badge>;
    if (!v.isActive)  return <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">Blocked</Badge>;
    if (v.storeIsOpen) return <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px]">Open</Badge>;
    return <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-[10px]">Closed</Badge>;
  };

  const qc = useQueryClient();
  const handlePullRefresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["admin-vendors"] });
  }, [qc]);

  return (
    <PullToRefresh onRefresh={handlePullRefresh} className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-xl flex items-center justify-center">
            <Store className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">Vendors</h1>
            <p className="text-sm text-muted-foreground">{vendors.length} total · {activeVendors} active{pendingVendors > 0 ? ` · ${pendingVendors} pending` : ""} · {suspendedVendors} suspended</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => exportVendorsCSV(filtered)} className="h-9 rounded-xl gap-2">
            <Download className="w-4 h-4" /> CSV
          </Button>
          <button
            onClick={() => setLocation("/settings?cat=vendor")}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border/60 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <Settings2 className="w-3.5 h-3.5" />
            Vendor Config
          </button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-9 rounded-xl gap-2">
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} /> {T("refresh")}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Total Vendors",   value: String(vendors.length),       icon: Store,          color: "text-orange-600", bg: "bg-orange-100" },
          { label: "Active Stores",   value: String(activeVendors),        icon: CheckCircle2,   color: "text-green-600",  bg: "bg-green-100" },
          { label: "Total Earnings",  value: formatCurrency(totalEarnings), icon: TrendingUp,     color: "text-blue-600",   bg: "bg-blue-100" },
          { label: "Wallet Pending",  value: formatCurrency(totalWallet),   icon: Wallet,         color: "text-amber-600",  bg: "bg-amber-100" },
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
            <Input placeholder="Search store name, vendor name, phone..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-11 rounded-xl bg-muted/30" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-11 rounded-xl bg-muted/30 w-full sm:w-44">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">✅ Active</SelectItem>
              <SelectItem value="pending">⏳ Pending Approval</SelectItem>
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

      {/* Vendors Table/Cards */}
      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-muted animate-pulse rounded-2xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-12 text-center">
            <Store className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No vendors found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((v: any) => (
            <Card key={v.id} className="rounded-2xl border-border/50 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  {/* Store Info */}
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-12 h-12 rounded-2xl bg-orange-100 flex items-center justify-center shrink-0 text-2xl">
                      🏪
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-sm text-foreground truncate">{v.storeName || "Unnamed Store"}</p>
                        {getStatusBadge(v)}
                        {(deliveryMode === "stores" || deliveryMode === "both") && (
                          whitelistedVendorIds.has(v.id)
                            ? <Badge
                                className="bg-blue-100 text-blue-700 border-blue-200 text-[10px] gap-1 cursor-pointer hover:bg-blue-200"
                                onClick={(e: React.MouseEvent) => {
                                  e.stopPropagation();
                                  const entryId = vendorWhitelistMap.get(v.id);
                                  if (entryId) deleteWhitelistM.mutate(entryId, {
                                    onSuccess: () => toast({ title: "Delivery disabled", description: `${v.storeName || "Store"} removed from delivery whitelist` }),
                                    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
                                  });
                                }}
                              ><Truck className="w-2.5 h-2.5" /> Delivery ✓</Badge>
                            : <Badge
                                className="bg-gray-100 text-gray-500 border-gray-200 text-[10px] gap-1 cursor-pointer hover:bg-gray-200"
                                onClick={(e: React.MouseEvent) => {
                                  e.stopPropagation();
                                  addWhitelistM.mutate({ type: "vendor", targetId: v.id, serviceType: "all" }, {
                                    onSuccess: () => toast({ title: "Delivery enabled", description: `${v.storeName || "Store"} added to delivery whitelist` }),
                                    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
                                  });
                                }}
                              ><Truck className="w-2.5 h-2.5" /> No Delivery</Badge>
                        )}
                        {vendorPendingReqs.has(v.id) && (
                          <Badge
                            className="bg-yellow-100 text-yellow-700 border-yellow-200 text-[10px] gap-1 cursor-pointer hover:bg-yellow-200"
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation();
                              const reqs = vendorPendingReqs.get(v.id) || [];
                              reqs.forEach((r: any) => {
                                resolveReqM.mutate({ id: r.id, status: "approved" }, {
                                  onSuccess: () => {
                                    toast({ title: "Request approved", description: `Delivery access granted to ${v.storeName || "store"}` });
                                  },
                                  onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
                                });
                              });
                            }}
                          >📋 {vendorPendingReqs.get(v.id)!.length} Request{vendorPendingReqs.get(v.id)!.length > 1 ? "s" : ""} — Approve</Badge>
                        )}
                        {v.storeCategory && (
                          <Badge variant="outline" className="text-[10px] capitalize">{v.storeCategory}</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{v.name || "—"}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <a href={`tel:${v.phone}`} className="flex items-center gap-1 text-xs text-blue-600 font-medium hover:underline">
                          <Phone className="w-3 h-3" /> {v.phone}
                        </a>
                        <a href={`https://wa.me/92${v.phone.replace(/^(\+92|0)/, "")}`} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-green-600 font-medium hover:underline">
                          <MessageCircle className="w-3 h-3" /> WhatsApp
                        </a>
                      </div>
                      <p className="text-xs text-muted-foreground">Joined {formatDate(v.createdAt)}</p>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-3 sm:gap-4">
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Orders</p>
                      <p className="font-bold text-sm">{v.totalOrders}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Revenue</p>
                      <p className="font-bold text-sm text-green-600">{formatCurrency(v.totalRevenue * vendorShare)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Wallet</p>
                      <p className="font-bold text-sm text-orange-600">{formatCurrency(v.walletBalance)}</p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 shrink-0 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => setCommModal(v)}
                      className="h-9 rounded-xl gap-1.5 text-xs border-purple-200 text-purple-700 hover:bg-purple-50">
                      <Percent className="w-3.5 h-3.5" /> Commission
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setWalletModal(v)}
                      className="h-9 rounded-xl gap-1.5 text-xs border-orange-200 text-orange-700 hover:bg-orange-50">
                      <Wallet className="w-3.5 h-3.5" /> Wallet
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setSuspendModal(v)}
                      className={`h-9 rounded-xl gap-1.5 text-xs ${v.isActive && !v.isBanned ? "border-red-200 text-red-700 hover:bg-red-50" : "border-green-200 text-green-700 hover:bg-green-50"}`}>
                      {v.isActive && !v.isBanned
                        ? <><Ban className="w-3.5 h-3.5" /> Suspend</>
                        : <><CheckCircle2 className="w-3.5 h-3.5" /> Activate</>
                      }
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setLocation(`/account-conditions?userId=${v.id}`)}
                      className="h-9 rounded-xl gap-1.5 text-xs border-violet-200 text-violet-700 hover:bg-violet-50" title="Conditions">
                      <Gavel className="w-3.5 h-3.5" /> Conditions
                    </Button>
                    {v.autoSuspendedAt && !v.adminOverrideSuspension && (
                      <Button size="sm" variant="outline" onClick={() => {
                        overrideSuspM.mutate(v.id, {
                          onSuccess: () => toast({ title: "Suspension overridden ✅", description: "Vendor is now active again." }),
                          onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
                        });
                      }} disabled={overrideSuspM.isPending}
                        className="h-9 rounded-xl gap-1.5 text-xs border-purple-200 text-purple-700 hover:bg-purple-50">
                        <Settings2 className="w-3.5 h-3.5" /> Override Suspend
                      </Button>
                    )}
                  </div>
                </div>

                {/* Pending orders warning */}
                {v.pendingOrders > 0 && (
                  <div className="mt-3 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    <Package className="w-4 h-4 text-amber-600" />
                    <p className="text-xs text-amber-700 font-semibold">{v.pendingOrders} pending order{v.pendingOrders > 1 ? "s" : ""} waiting</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Modals */}
      {walletModal  && <WalletModal  vendor={walletModal}  onClose={() => setWalletModal(null)} />}
      {suspendModal && <SuspendModal vendor={suspendModal} onClose={() => setSuspendModal(null)} />}
      {commModal    && <CommissionModal vendor={commModal} defaultPct={vendorCommissionPct} onClose={() => setCommModal(null)} />}
    </PullToRefresh>
  );
}
