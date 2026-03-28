import { useState, useEffect } from "react";
import { useOrdersEnriched, useUpdateOrder, useAssignRider, useRiders } from "@/hooks/use-admin";
import { formatCurrency, formatDate, getStatusColor } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShoppingBag, Search, User, Package, Phone, TrendingUp, AlertTriangle, CheckCircle2, Download, CalendarDays, UserCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";

function exportOrdersCSV(orders: any[]) {
  const header = "ID,Type,Status,Total,Payment,Customer,Rider,Date";
  const rows = orders.map((o: any) =>
    [o.id, o.type, o.status, o.total, o.paymentMethod, o.userName || "", o.riderName || "", o.createdAt?.slice(0,10) || ""].join(",")
  );
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `orders-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

const STATUS_LABELS: Record<string, string> = {
  pending:          "Pending",
  confirmed:        "Confirmed",
  preparing:        "Preparing",
  out_for_delivery: "Out for Delivery",
  delivered:        "Delivered",
  cancelled:        "Cancelled",
};

/* Only logical forward moves allowed */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending:          ["confirmed", "cancelled"],
  confirmed:        ["preparing", "cancelled"],
  preparing:        ["out_for_delivery", "cancelled"],
  out_for_delivery: ["delivered", "cancelled"],
  delivered:        ["delivered"],
  cancelled:        ["cancelled"],
};

const ALL_STATUSES = Object.keys(ALLOWED_TRANSITIONS);

export default function Orders() {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const { data, isLoading } = useOrdersEnriched();
  const { data: ridersData } = useRiders();
  const updateMutation  = useUpdateOrder();
  const assignMutation  = useAssignRider();
  const { toast } = useToast();

  const [search, setSearch]               = useState("");
  const [statusFilter, setStatusFilter]   = useState("all");
  const [typeFilter, setTypeFilter]       = useState("all");
  const [dateFrom, setDateFrom]           = useState("");
  const [dateTo, setDateTo]               = useState("");
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling]       = useState(false);
  const [showAssignRider, setShowAssignRider] = useState(false);
  const [riderSearch, setRiderSearch]     = useState("");

  const handleUpdateStatus = (id: string, status: string, extra?: { localUpdate?: any }) => {
    updateMutation.mutate({ id, status }, {
      onSuccess: () => {
        toast({ title: `Order status → ${STATUS_LABELS[status] ?? status} ✅` });
        if (extra?.localUpdate) setSelectedOrder((prev: any) => ({ ...prev, status }));
      },
      onError: (err) => toast({ title: "Update failed", description: err.message, variant: "destructive" })
    });
  };

  const handleCancelOrder = () => {
    setCancelling(true);
    updateMutation.mutate({ id: selectedOrder.id, status: "cancelled" }, {
      onSuccess: () => {
        setSelectedOrder((p: any) => ({ ...p, status: "cancelled" }));
        setShowCancelConfirm(false);
        setCancelling(false);
        toast({ title: "Order cancelled ✅" + (selectedOrder.paymentMethod === "wallet" ? " — Wallet refund issued" : "") });
      },
      onError: (err) => {
        setCancelling(false);
        toast({ title: "Cancel failed", description: err.message, variant: "destructive" });
      },
    });
  };

  const handleAssignRider = (rider: any) => {
    if (!selectedOrder) return;
    assignMutation.mutate({ orderId: selectedOrder.id, riderId: rider.id, riderName: rider.name || rider.phone, riderPhone: rider.phone }, {
      onSuccess: () => {
        toast({ title: "Rider assigned ✅", description: `${rider.name || rider.phone} assigned to order` });
        setSelectedOrder((p: any) => ({ ...p, riderId: rider.id, riderName: rider.name || rider.phone }));
        setShowAssignRider(false);
      },
      onError: e => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  const orders = data?.orders || [];
  const q = search.toLowerCase();
  const filtered = orders.filter((o: any) => {
    const matchesSearch = o.id.toLowerCase().includes(q)
      || (o.userName  || "").toLowerCase().includes(q)
      || (o.userPhone || "").includes(q);
    const matchesStatus = statusFilter === "all"
      || (statusFilter === "active" && ["pending","confirmed","preparing","out_for_delivery"].includes(o.status))
      || o.status === statusFilter;
    const matchesType = typeFilter === "all" || o.type === typeFilter;
    const matchesDate = (!dateFrom || new Date(o.createdAt) >= new Date(dateFrom))
                     && (!dateTo   || new Date(o.createdAt) <= new Date(dateTo + "T23:59:59"));
    return matchesSearch && matchesStatus && matchesType && matchesDate;
  });

  const totalCount     = orders.length;
  const pendingOrders  = orders.filter((o: any) => o.status === "pending");
  const pendingCount   = pendingOrders.length;
  const activeCount    = orders.filter((o: any) => ["confirmed","preparing","out_for_delivery"].includes(o.status)).length;
  const deliveredCount = orders.filter((o: any) => o.status === "delivered").length;
  const cancelledCount = orders.filter((o: any) => o.status === "cancelled").length;
  const totalRevenue   = orders.filter((o: any) => o.status === "delivered").reduce((s: number, o: any) => s + (o.total || 0), 0);

  /* Last-refreshed ticker */
  const [secAgo, setSecAgo] = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  useEffect(() => { if (!isLoading) { setLastRefreshed(new Date()); setSecAgo(0); } }, [isLoading]);
  useEffect(() => {
    const t = setInterval(() => setSecAgo(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [lastRefreshed]);

  const isTerminal  = (s: string) => s === "delivered" || s === "cancelled";
  const canCancel   = (o: any) => !isTerminal(o.status);
  const allowedNext = (o: any) => ALLOWED_TRANSITIONS[o.status] ?? [];

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 sm:w-12 sm:h-12 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center shrink-0">
            <ShoppingBag className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">{T("martFoodOrders")}</h1>
            <p className="text-muted-foreground text-xs sm:text-sm">{totalCount} {T("total")} · {pendingCount} {T("pending")} · {deliveredCount} {T("delivered")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => exportOrdersCSV(filtered)} className="h-9 rounded-xl gap-2">
            <Download className="w-4 h-4" /> CSV
          </Button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className={`w-2 h-2 rounded-full ${secAgo < 35 ? "bg-green-500" : "bg-amber-400"} animate-pulse`} />
            {isLoading ? "Refreshing..." : `${secAgo}s ago`}
          </div>
        </div>
      </div>

      {/* New Pending Orders Alert */}
      {pendingCount > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border-2 border-amber-400 rounded-2xl px-4 py-3">
          <span className="text-2xl">📦</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-800">
              {pendingCount} new order{pendingCount > 1 ? "s" : ""} waiting for confirmation!
            </p>
            <p className="text-xs text-amber-600">
              {pendingOrders.slice(0,3).map((o: any) => `#${o.id.slice(-6).toUpperCase()} (${o.type})`).join(" · ")}
              {pendingOrders.length > 3 ? ` +${pendingOrders.length - 3} more` : ""}
            </p>
          </div>
          <button
            onClick={() => setStatusFilter("pending")}
            className="px-3 py-1.5 bg-amber-500 text-white text-xs font-bold rounded-xl whitespace-nowrap hover:bg-amber-600 transition-colors"
          >
            View All
          </button>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="p-4 rounded-2xl border-border/50 shadow-sm text-center">
          <p className="text-3xl font-bold text-foreground">{totalCount}</p>
          <p className="text-xs text-muted-foreground mt-1">{T("totalOrders")}</p>
        </Card>
        <Card className="p-4 rounded-2xl border-border/50 shadow-sm text-center bg-amber-50/60 border-amber-200/60">
          <p className="text-3xl font-bold text-amber-700">{pendingCount}</p>
          <p className="text-xs text-amber-600 mt-1">{T("pending")}</p>
        </Card>
        <Card className="p-4 rounded-2xl border-border/50 shadow-sm text-center bg-blue-50/60 border-blue-200/60">
          <p className="text-3xl font-bold text-blue-700">{activeCount}</p>
          <p className="text-xs text-blue-500 mt-1">{T("activeNow")}</p>
        </Card>
        <Card className="p-4 rounded-2xl border-border/50 shadow-sm text-center bg-green-50/60 border-green-200/60">
          <p className="text-3xl font-bold text-green-700">{deliveredCount}</p>
          <p className="text-xs text-green-500 mt-1">{T("delivered")}</p>
        </Card>
        <Card className="p-4 rounded-2xl border-border/50 shadow-sm text-center bg-purple-50/60 border-purple-200/60 sm:col-span-1 col-span-2">
          <div className="flex items-center justify-center gap-1 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-purple-600" />
          </div>
          <p className="text-2xl font-bold text-purple-700">{formatCurrency(totalRevenue)}</p>
          <p className="text-xs text-purple-500 mt-1">{T("totalRevenue")}</p>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-3 sm:p-4 rounded-2xl border-border/50 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by Order ID, name or phone..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-10 sm:h-11 rounded-xl bg-muted/30 border-border/50 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 rounded-xl bg-muted/30 border-border/50 text-xs w-32" />
            <span className="text-xs text-muted-foreground">–</span>
            <Input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="h-9 rounded-xl bg-muted/30 border-border/50 text-xs w-32" />
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-xs text-primary hover:underline shrink-0">Clear</button>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            {[
              { key: "all",      label: "All" },
              { key: "mart",     label: "🛒 Mart" },
              { key: "food",     label: "🍔 Food" },
              { key: "pharmacy", label: "💊 Pharmacy" },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setTypeFilter(t.key)}
                className={`flex-1 sm:flex-none px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold capitalize transition-colors border ${
                  typeFilter === t.key ? "bg-primary text-white border-primary" : "bg-muted/30 border-border/50 text-muted-foreground hover:border-primary"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Status filter chips */}
        <div className="flex flex-wrap gap-2">
          {[
            { key: "all",              label: "All",           cls: "border-border/50 text-muted-foreground hover:border-primary" },
            { key: "active",           label: "🔵 Active",      cls: "border-blue-300 text-blue-700 bg-blue-50" },
            { key: "pending",          label: "🟡 Pending",     cls: "border-amber-300 text-amber-700 bg-amber-50" },
            { key: "out_for_delivery", label: "🚴 Delivering",   cls: "border-indigo-300 text-indigo-700 bg-indigo-50" },
            { key: "delivered",        label: "✅ Delivered",   cls: "border-green-300 text-green-700 bg-green-50" },
            { key: "cancelled",        label: "❌ Cancelled",   cls: "border-red-300 text-red-600 bg-red-50" },
          ].map(({ key, label, cls }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                statusFilter === key ? "bg-primary text-white border-primary" : `bg-muted/30 ${cls}`
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>

      {/* Table */}
      <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="min-w-[640px]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="font-semibold">{T("orderId")}</TableHead>
                <TableHead className="font-semibold">{T("customer")}</TableHead>
                <TableHead className="font-semibold">{T("type")}</TableHead>
                <TableHead className="font-semibold">{T("total")}</TableHead>
                <TableHead className="font-semibold">{T("status")}</TableHead>
                <TableHead className="font-semibold text-right">{T("date")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">Loading orders...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">No orders found.</TableCell></TableRow>
              ) : (
                filtered.map((order: any) => (
                  <TableRow key={order.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => { setSelectedOrder(order); setShowCancelConfirm(false); }}>
                    <TableCell>
                      <p className="font-mono font-medium text-sm">{order.id.slice(-8).toUpperCase()}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{Array.isArray(order.items) ? `${order.items.length} items` : "N/A"}</p>
                    </TableCell>
                    <TableCell>
                      {order.userName ? (
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <User className="w-3.5 h-3.5 text-primary" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-foreground">{order.userName}</p>
                            <p className="text-xs text-muted-foreground">{order.userPhone}</p>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Guest</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={order.type === "food" ? "default" : "secondary"} className="capitalize">
                        {order.type === "food" ? "🍔 " : order.type === "pharmacy" ? "💊 " : "🛒 "}{order.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-bold text-foreground">{formatCurrency(order.total)}</TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <Select
                        value={order.status}
                        onValueChange={(val) => {
                          if (!allowedNext(order).includes(val)) {
                            toast({ title: "Invalid transition", description: `Can't move ${STATUS_LABELS[order.status]} → ${STATUS_LABELS[val]}`, variant: "destructive" }); return;
                          }
                          handleUpdateStatus(order.id, val);
                        }}
                      >
                        <SelectTrigger className={`w-36 h-8 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider border-2 ${getStatusColor(order.status)}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {allowedNext(order).map(s => (
                            <SelectItem key={s} value={s} className="text-xs uppercase font-bold">{STATUS_LABELS[s] ?? s.replace("_", " ")}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right text-xs sm:text-sm text-muted-foreground whitespace-nowrap">
                      {formatDate(order.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Order Detail Modal */}
      <Dialog open={!!selectedOrder} onOpenChange={open => { if (!open) { setSelectedOrder(null); setShowCancelConfirm(false); } }}>
        <DialogContent className="w-[95vw] max-w-lg rounded-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-indigo-600" />
              Order Detail
              {selectedOrder && (
                <Badge variant="outline" className={`ml-2 text-[10px] font-bold uppercase ${getStatusColor(selectedOrder.status)}`}>
                  {STATUS_LABELS[selectedOrder.status]}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-4 mt-2">

              {/* Cancel confirmation inline */}
              {showCancelConfirm && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                    <p className="text-sm font-bold text-red-700">Cancel Order #{selectedOrder.id.slice(-6).toUpperCase()}?</p>
                  </div>
                  <p className="text-xs text-red-600">
                    {selectedOrder.paymentMethod === "wallet"
                      ? `Rs. ${Math.round(selectedOrder.total)} customer ki wallet mein refund ho jayega.`
                      : "Cash order — no wallet refund needed."}
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => setShowCancelConfirm(false)}
                      className="flex-1 h-9 bg-white border border-red-200 text-red-600 text-sm font-bold rounded-xl">
                      Back
                    </button>
                    <button onClick={handleCancelOrder} disabled={cancelling}
                      className="flex-1 h-9 bg-red-600 text-white text-sm font-bold rounded-xl disabled:opacity-60">
                      {cancelling ? "Cancelling..." : "Confirm Cancel"}
                    </button>
                  </div>
                </div>
              )}

              {/* Info */}
              <div className="bg-muted/40 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Order ID</span>
                  <span className="font-mono font-bold">{selectedOrder.id.slice(-8).toUpperCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <Badge variant={selectedOrder.type === "food" ? "default" : "secondary"} className="capitalize">
                    {selectedOrder.type === "food" ? "🍔 " : selectedOrder.type === "pharmacy" ? "💊 " : "🛒 "}{selectedOrder.type}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-bold text-lg text-foreground">{formatCurrency(selectedOrder.total)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment</span>
                  <span className={`font-medium capitalize ${selectedOrder.paymentMethod === "wallet" ? "text-blue-600" : "text-green-600"}`}>
                    {selectedOrder.paymentMethod === "wallet" ? "💳 Wallet" : "💵 Cash"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Delivery Address</span>
                  <span className="text-right max-w-[200px] text-xs">{selectedOrder.deliveryAddress || "—"}</span>
                </div>
              </div>

              {/* Customer contact */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-1">
                <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wide flex items-center gap-1"><User className="w-3 h-3" /> Customer</p>
                <p className="text-sm font-semibold text-gray-800">{selectedOrder.userName || "Guest"}</p>
                {selectedOrder.userPhone && (
                  <div className="flex gap-3 mt-1">
                    <a href={`tel:${selectedOrder.userPhone}`} className="flex items-center gap-1 text-xs text-blue-600 font-medium hover:underline">
                      <Phone className="w-3 h-3" /> {selectedOrder.userPhone}
                    </a>
                    <a href={`https://wa.me/92${selectedOrder.userPhone.replace(/^(\+92|0)/, "")}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-green-600 font-medium hover:underline">
                      💬 WhatsApp
                    </a>
                  </div>
                )}
              </div>

              {/* Items */}
              {Array.isArray(selectedOrder.items) && selectedOrder.items.length > 0 && (
                <div>
                  <p className="text-sm font-bold mb-2 flex items-center gap-2">
                    <Package className="w-4 h-4 text-indigo-600" /> Items ({selectedOrder.items.length})
                  </p>
                  <div className="space-y-2">
                    {selectedOrder.items.map((item: any, i: number) => (
                      <div key={i} className="flex justify-between items-center bg-muted/30 rounded-xl px-3 py-2.5">
                        <div>
                          <p className="text-sm font-semibold">{item.name}</p>
                          <p className="text-xs text-muted-foreground">×{item.quantity}</p>
                        </div>
                        <p className="font-bold text-foreground">{formatCurrency(item.price * item.quantity)}</p>
                      </div>
                    ))}
                    <div className="flex justify-between items-center bg-primary/5 border border-primary/20 rounded-xl px-3 py-2.5">
                      <p className="font-bold text-foreground">Total</p>
                      <p className="font-bold text-primary text-lg">{formatCurrency(selectedOrder.total)}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Rider Info + Assign */}
              <div className="bg-green-50 border border-green-100 rounded-xl p-3 space-y-1">
                <p className="text-[10px] font-bold text-green-700 uppercase tracking-wide flex items-center gap-1"><UserCheck className="w-3 h-3" /> Rider Assignment</p>
                {selectedOrder.riderName ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{selectedOrder.riderName}</p>
                      {selectedOrder.riderPhone && (
                        <a href={`tel:${selectedOrder.riderPhone}`} className="flex items-center gap-1 text-xs text-green-600 font-medium hover:underline">
                          <Phone className="w-3 h-3" /> {selectedOrder.riderPhone}
                        </a>
                      )}
                    </div>
                    <button onClick={() => { setShowAssignRider(true); setRiderSearch(""); }}
                      className="text-xs text-green-700 border border-green-300 bg-white rounded-lg px-2 py-1 hover:bg-green-50">
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">No rider assigned</span>
                    <button onClick={() => { setShowAssignRider(true); setRiderSearch(""); }}
                      className="text-xs text-white bg-green-600 hover:bg-green-700 rounded-lg px-3 py-1.5 font-bold">
                      Assign Rider
                    </button>
                  </div>
                )}

                {/* Rider picker dropdown */}
                {showAssignRider && (
                  <div className="mt-2 space-y-2">
                    <Input placeholder="Search riders..." value={riderSearch} onChange={e => setRiderSearch(e.target.value)}
                      className="h-8 rounded-lg text-xs" autoFocus />
                    <div className="max-h-36 overflow-y-auto space-y-1">
                      {(ridersData?.users || [])
                        .filter((r: any) => r.isActive && !r.isBanned)
                        .filter((r: any) => riderSearch ? ((r.name || r.phone || "").toLowerCase().includes(riderSearch.toLowerCase())) : true)
                        .slice(0, 8)
                        .map((r: any) => (
                          <button key={r.id} onClick={() => handleAssignRider(r)} disabled={assignMutation.isPending}
                            className="w-full flex items-center gap-2 text-left px-2 py-1.5 bg-white border border-border/50 rounded-lg hover:bg-green-50 text-xs">
                            <div className="w-6 h-6 rounded-full bg-green-100 text-green-700 font-bold text-[10px] flex items-center justify-center shrink-0">
                              {(r.name || r.phone || "R")[0].toUpperCase()}
                            </div>
                            <span className="font-semibold">{r.name || r.phone}</span>
                            <span className="text-muted-foreground ml-auto font-mono">{r.vehiclePlate || ""}</span>
                          </button>
                        ))}
                    </div>
                    <button onClick={() => setShowAssignRider(false)} className="text-xs text-muted-foreground hover:underline">Cancel</button>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              {!isTerminal(selectedOrder.status) && (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground font-medium mb-1.5">Move to Next Status</p>
                    <Select
                      value={selectedOrder.status}
                      onValueChange={(val) => {
                        if (val === selectedOrder.status) return;
                        handleUpdateStatus(selectedOrder.id, val, { localUpdate: true });
                      }}
                    >
                      <SelectTrigger className={`h-9 text-[11px] font-bold uppercase tracking-wider border-2 ${getStatusColor(selectedOrder.status)}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {allowedNext(selectedOrder).filter(s => s !== "cancelled").map(s => (
                          <SelectItem key={s} value={s} className="text-xs uppercase font-bold">
                            <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-green-500" />{STATUS_LABELS[s]}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {canCancel(selectedOrder) && !showCancelConfirm && (
                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-1.5">Admin Actions</p>
                      <button
                        onClick={() => setShowCancelConfirm(true)}
                        className="h-9 px-4 bg-red-50 hover:bg-red-100 border-2 border-red-300 text-red-600 text-xs font-bold rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Cancel & Refund
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-between text-xs text-muted-foreground border-t border-border/40 pt-3">
                <span>Ordered: {formatDate(selectedOrder.createdAt)}</span>
                <span>Updated: {formatDate(selectedOrder.updatedAt)}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
