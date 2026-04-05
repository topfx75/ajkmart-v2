import { useState, useEffect, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrdersEnriched, useUpdateOrder, useAssignRider, useRiders, useOrderRefund } from "@/hooks/use-admin";
import { formatCurrency, formatDate, getStatusColor } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ShoppingBag, Search, User, Package, Phone, TrendingUp, AlertTriangle,
  CheckCircle2, Download, CalendarDays, UserCheck, MapPin, ChevronLeft,
  ChevronRight, ChevronsLeft, ChevronsRight, ArrowUpDown, ArrowUp, ArrowDown,
  RefreshCw, XCircle,
} from "lucide-react";
import { MobileDrawer } from "@/components/MobileDrawer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { StatusBadge } from "@/components/AdminShared";
import { Skeleton } from "@/components/ui/skeleton";
import { PullToRefresh } from "@/components/PullToRefresh";

function GpsMiniMap({ cLat, cLng, dLat, dLng }: { cLat: number; cLng: number; dLat: number | null; dLng: number | null }) {
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    import("leaflet").then(L => {
      if (el.querySelector(".leaflet-container")) return;
      const map = L.map(el, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(map);
      const customerIcon = L.divIcon({
        className: "", iconSize: [14, 14], iconAnchor: [7, 7],
        html: `<div style="width:14px;height:14px;background:#3b82f6;border:2px solid white;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`,
      });
      L.marker([cLat, cLng], { icon: customerIcon }).addTo(map).bindPopup("Placed from");
      if (dLat != null && dLng != null && Number.isFinite(dLat) && Number.isFinite(dLng)) {
        const deliveryIcon = L.divIcon({
          className: "", iconSize: [14, 14], iconAnchor: [7, 7],
          html: `<div style="width:14px;height:14px;background:#f59e0b;border:2px solid white;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`,
        });
        L.marker([dLat, dLng], { icon: deliveryIcon }).addTo(map).bindPopup("Delivery address");
        L.polyline([[cLat, cLng], [dLat, dLng]], { color: "#94a3b8", weight: 2, dashArray: "5,5" }).addTo(map);
        map.fitBounds([[cLat, cLng], [dLat, dLng]], { padding: [30, 30] });
      } else {
        map.setView([cLat, cLng], 14);
      }
    }).catch(() => {});
  }, [cLat, cLng, dLat, dLng]);
  return <div ref={ref} className="w-full rounded-lg border border-gray-200" style={{ height: 150 }} />;
}

function GpsStampCard({ order }: { order: any }) {
  const cLat = Number(order.customerLat);
  const cLng = Number(order.customerLng);
  const dLat = order.deliveryLat != null ? Number(order.deliveryLat) : null;
  const dLng = order.deliveryLng != null ? Number(order.deliveryLng) : null;
  const hasDual = dLat != null && dLng != null && Number.isFinite(dLat) && Number.isFinite(dLng);
  const isMismatch = !!order.gpsMismatch;
  const [placeName, setPlaceName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`https://nominatim.openstreetmap.org/reverse?lat=${cLat}&lon=${cLng}&format=json&zoom=16&addressdetails=1`, {
      headers: { "Accept-Language": "en" },
    })
      .then(r => r.json())
      .then(data => {
        if (!cancelled && data?.display_name) {
          const parts = data.display_name.split(",").slice(0, 3).map((s: string) => s.trim());
          setPlaceName(parts.join(", "));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [cLat, cLng]);

  return (
    <div className={`rounded-xl overflow-hidden border ${isMismatch ? "border-amber-300" : "border-emerald-200"}`}>
      {isMismatch && (
        <div className="bg-amber-50 px-3 py-2 flex items-center gap-2 border-b border-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <div>
            <p className="text-[11px] font-bold text-amber-800">GPS Mismatch Warning</p>
            <p className="text-[10px] text-amber-700">Customer device GPS is far from the selected delivery address</p>
          </div>
        </div>
      )}
      <div className={`p-3 space-y-2 ${isMismatch ? "bg-amber-50/50" : "bg-emerald-50"}`}>
        <p className={`text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 ${isMismatch ? "text-amber-700" : "text-emerald-700"}`}>
          <MapPin className="w-3 h-3" /> Customer GPS Location
          {!isMismatch && <span className="ml-1 text-[9px] bg-emerald-200 text-emerald-800 px-1.5 py-0.5 rounded-full">Match OK</span>}
        </p>
        {placeName && (
          <p className="text-xs font-medium text-gray-800">{placeName}</p>
        )}
        <p className="text-[10px] font-mono text-gray-500">
          Placed from: {cLat.toFixed(5)}, {cLng.toFixed(5)}
        </p>
        {hasDual && (
          <p className="text-[10px] font-mono text-gray-500">
            Delivery to: {dLat!.toFixed(5)}, {dLng!.toFixed(5)}
          </p>
        )}
        {order.gpsAccuracy != null && (
          <p className="text-[10px] text-muted-foreground">GPS Accuracy: +/-{Math.round(Number(order.gpsAccuracy))}m</p>
        )}
        <GpsMiniMap cLat={cLat} cLng={cLng} dLat={dLat} dLng={dLng} />
        {hasDual && (
          <div className="flex gap-3 text-[9px]">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> Placed from</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> Delivery address</span>
          </div>
        )}
        <div className="flex items-start gap-1.5 pt-1">
          <MapPin className="w-3 h-3 text-gray-500 mt-0.5 shrink-0" />
          <p className="text-[10px] text-gray-600">
            <span className="font-semibold">Delivery Address:</span> {order.deliveryAddress || "—"}
          </p>
        </div>
      </div>
    </div>
  );
}

function escapeCSV(val: string): string {
  let safe = val;
  if (/^[=+\-@\t\r]/.test(safe)) {
    safe = "'" + safe;
  }
  if (safe.includes(",") || safe.includes('"') || safe.includes("\n")) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function exportOrdersCSV(orders: any[]) {
  const header = "ID,Type,Status,Total,Payment,Customer,Rider,Date";
  const rows = orders.map((o: any) =>
    [
      escapeCSV(o.id),
      escapeCSV(o.type || ""),
      escapeCSV(o.status || ""),
      String(o.total ?? ""),
      escapeCSV(o.paymentMethod || ""),
      escapeCSV(o.userName || ""),
      escapeCSV(o.riderName || ""),
      escapeCSV(o.createdAt?.slice(0, 10) || ""),
    ].join(",")
  );
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
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

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending:          ["confirmed", "cancelled"],
  confirmed:        ["preparing", "cancelled"],
  preparing:        ["out_for_delivery", "cancelled"],
  out_for_delivery: ["delivered", "cancelled"],
  delivered:        ["delivered"],
  cancelled:        ["cancelled"],
};

type SortKey = "id" | "customer" | "type" | "total" | "status" | "date";
type SortDir = "asc" | "desc";

const PAGE_SIZES = [10, 25, 50];

function SortHeader({ label, sortKey, currentSort, currentDir, onSort }: {
  label: string; sortKey: SortKey; currentSort: SortKey; currentDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = currentSort === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      className="flex items-center gap-1 font-semibold hover:text-foreground transition-colors group w-full text-left"
      aria-label={`Sort by ${label}`}
    >
      {label}
      <span className="shrink-0">
        {isActive ? (
          currentDir === "asc" ? <ArrowUp className="w-3.5 h-3.5 text-primary" /> : <ArrowDown className="w-3.5 h-3.5 text-primary" />
        ) : (
          <ArrowUpDown className="w-3 h-3 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
        )}
      </span>
    </button>
  );
}

export default function Orders() {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const { data, isLoading, isError, error } = useOrdersEnriched();
  const { data: ridersData } = useRiders();
  const updateMutation = useUpdateOrder();
  const assignMutation = useAssignRider();
  const refundMutation = useOrderRefund();
  const { toast } = useToast();

  const [search, setSearch]               = useState("");
  const [statusFilter, setStatusFilter]   = useState("all");
  const [typeFilter, setTypeFilter]       = useState("all");
  const [dateFrom, setDateFrom]           = useState("");
  const [dateTo, setDateTo]               = useState("");
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showRefundConfirm, setShowRefundConfirm] = useState(false);
  const [refundAmount, setRefundAmount]   = useState("");
  const [refundReason, setRefundReason]   = useState("");
  const [cancelling, setCancelling]       = useState(false);
  const [showAssignRider, setShowAssignRider] = useState(false);
  const [riderSearch, setRiderSearch]     = useState("");
  const [showDeliverConfirm, setShowDeliverConfirm] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage]       = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  }, [sortKey]);

  const handleUpdateStatus = (id: string, status: string, extra?: { localUpdate?: any }) => {
    if (status === "delivered" && !extra?.localUpdate) {
      setShowDeliverConfirm(id);
      return;
    }
    updateMutation.mutate({ id, status }, {
      onSuccess: () => {
        toast({ title: `Order status updated to ${STATUS_LABELS[status] ?? status}` });
        if (extra?.localUpdate) setSelectedOrder((prev: any) => prev ? ({ ...prev, status }) : prev);
      },
      onError: (err) => toast({ title: "Update failed", description: err.message, variant: "destructive" })
    });
  };

  const confirmDeliver = () => {
    if (!showDeliverConfirm) return;
    const id = showDeliverConfirm;
    setShowDeliverConfirm(null);
    updateMutation.mutate({ id, status: "delivered" }, {
      onSuccess: () => {
        toast({ title: "Order marked as Delivered" });
        setSelectedOrder((prev: any) => prev?.id === id ? ({ ...prev, status: "delivered" }) : prev);
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
        toast({ title: "Order cancelled" + (selectedOrder.paymentMethod === "wallet" ? " — Wallet refund issued" : "") });
      },
      onError: (err) => {
        setCancelling(false);
        toast({ title: "Cancel failed", description: err.message, variant: "destructive" });
      },
    });
  };

  const handleRefundOrder = () => {
    if (!selectedOrder) return;
    const amt = parseFloat(refundAmount);
    if (!refundAmount || !Number.isFinite(amt) || amt <= 0) return;
    refundMutation.mutate({ id: selectedOrder.id, amount: amt, reason: refundReason.trim() || undefined }, {
      onSuccess: (res: any) => {
        toast({ title: "Refund issued", description: `${formatCurrency(Math.round(res.refundedAmount))} credited to customer wallet` });
        setShowRefundConfirm(false);
        setRefundAmount("");
        setRefundReason("");
      },
      onError: (err: any) => toast({ title: "Refund failed", description: err.message, variant: "destructive" }),
    });
  };

  const handleAssignRider = (rider: any) => {
    if (!selectedOrder) return;
    assignMutation.mutate({ orderId: selectedOrder.id, riderId: rider.id, riderName: rider.name || rider.phone, riderPhone: rider.phone }, {
      onSuccess: () => {
        toast({ title: "Rider assigned", description: `${rider.name || rider.phone} assigned to order` });
        setSelectedOrder((p: any) => ({ ...p, riderId: rider.id, riderName: rider.name || rider.phone }));
        setShowAssignRider(false);
      },
      onError: e => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  const orders: any[] = data?.orders || [];
  const q = search.toLowerCase();

  const filtered = useMemo(() => {
    return orders.filter((o: any) => {
      const matchesSearch = o.id.toLowerCase().includes(q)
        || (o.userName || "").toLowerCase().includes(q)
        || (o.userPhone || "").includes(q);
      const matchesStatus = statusFilter === "all"
        || (statusFilter === "active" && ["pending", "confirmed", "preparing", "out_for_delivery"].includes(o.status))
        || o.status === statusFilter;
      const matchesType = typeFilter === "all" || o.type === typeFilter;
      const orderDate = new Date(o.createdAt);
      const matchesDateFrom = !dateFrom || orderDate >= new Date(dateFrom + "T00:00:00.000Z");
      const matchesDateTo = !dateTo || orderDate <= new Date(dateTo + "T23:59:59.999Z");
      const matchesDate = matchesDateFrom && matchesDateTo;
      return matchesSearch && matchesStatus && matchesType && matchesDate;
    });
  }, [orders, q, statusFilter, typeFilter, dateFrom, dateTo]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a: any, b: any) => {
      let cmp = 0;
      switch (sortKey) {
        case "id": cmp = a.id.localeCompare(b.id); break;
        case "customer": cmp = (a.userName || "").localeCompare(b.userName || ""); break;
        case "type": cmp = (a.type || "").localeCompare(b.type || ""); break;
        case "total": cmp = (a.total || 0) - (b.total || 0); break;
        case "status": cmp = (a.status || "").localeCompare(b.status || ""); break;
        case "date":
        default: cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, typeFilter, dateFrom, dateTo]);

  const totalCount     = orders.length;
  const pendingOrders  = orders.filter((o: any) => o.status === "pending");
  const pendingCount   = pendingOrders.length;
  const activeCount    = orders.filter((o: any) => ["confirmed", "preparing", "out_for_delivery"].includes(o.status)).length;
  const deliveredCount = orders.filter((o: any) => o.status === "delivered").length;
  const totalRevenue   = orders.filter((o: any) => o.status === "delivered").reduce((s: number, o: any) => s + (o.total || 0), 0);

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

  const qc = useQueryClient();
  const handlePullRefresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["admin-orders-enriched"] });
  }, [qc]);

  const hasActiveFilters = statusFilter !== "all" || typeFilter !== "all" || dateFrom || dateTo || search;

  return (
    <PullToRefresh onRefresh={handlePullRefresh} className="space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 sm:w-12 sm:h-12 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center shrink-0" aria-hidden="true">
            <ShoppingBag className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">{T("martFoodOrders")}</h1>
            <p className="text-muted-foreground text-xs sm:text-sm">{totalCount} {T("total")} · {pendingCount} {T("pending")} · {deliveredCount} {T("delivered")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => exportOrdersCSV(filtered)} className="h-9 rounded-xl gap-2" aria-label="Export orders as CSV">
            <Download className="w-4 h-4" /> CSV
          </Button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            <span className={`w-2 h-2 rounded-full ${secAgo < 35 ? "bg-green-500" : "bg-amber-400"} animate-pulse`} />
            {isLoading ? "Refreshing..." : `${secAgo}s ago`}
          </div>
        </div>
      </div>

      {pendingCount > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border-2 border-amber-400 rounded-2xl px-4 py-3" role="alert">
          <span className="text-2xl shrink-0" aria-hidden="true">📦</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-amber-800">
              {pendingCount} new order{pendingCount > 1 ? "s" : ""} waiting for confirmation!
            </p>
            <p className="text-xs text-amber-600 truncate">
              {pendingOrders.slice(0, 3).map((o: any) => `#${o.id.slice(-6).toUpperCase()} (${o.type})`).join(" · ")}
              {pendingOrders.length > 3 ? ` +${pendingOrders.length - 3} more` : ""}
            </p>
          </div>
          <button
            onClick={() => setStatusFilter("pending")}
            className="px-3 py-1.5 bg-amber-500 text-white text-xs font-bold rounded-xl whitespace-nowrap hover:bg-amber-600 transition-colors min-h-[36px]"
          >
            View All
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
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
        <Card className="p-4 rounded-2xl border-border/50 shadow-sm text-center bg-purple-50/60 border-purple-200/60 col-span-2 sm:col-span-1">
          <div className="flex items-center justify-center gap-1 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-purple-600" />
          </div>
          <p className="text-2xl font-bold text-purple-700">{formatCurrency(totalRevenue)}</p>
          <p className="text-xs text-purple-500 mt-1">{T("totalRevenue")}</p>
        </Card>
      </div>

      <Card className="p-3 sm:p-4 rounded-2xl border-border/50 shadow-sm space-y-3" role="search" aria-label="Order filters">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder="Search by Order ID, name or phone..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-10 sm:h-11 rounded-xl bg-muted/30 border-border/50 text-sm"
              aria-label="Search orders"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 rounded-xl bg-muted/30 border-border/50 text-xs w-[130px]" aria-label="From date" />
            <span className="text-xs text-muted-foreground">–</span>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 rounded-xl bg-muted/30 border-border/50 text-xs w-[130px]" aria-label="To date" />
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-xs text-primary hover:underline shrink-0 min-h-[36px] px-1">Clear</button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { key: "all",      label: "All" },
            { key: "mart",     label: "Mart" },
            { key: "food",     label: "Food" },
            { key: "pharmacy", label: "Pharmacy" },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTypeFilter(t.key)}
              className={`px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold capitalize transition-colors border min-h-[36px] ${
                typeFilter === t.key ? "bg-primary text-white border-primary" : "bg-muted/30 border-border/50 text-muted-foreground hover:border-primary"
              }`}
              aria-pressed={typeFilter === t.key}
            >
              {t.key === "mart" ? "🛒 " : t.key === "food" ? "🍔 " : t.key === "pharmacy" ? "💊 " : ""}{t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            { key: "all",              label: "All",            cls: "border-border/50 text-muted-foreground hover:border-primary" },
            { key: "active",           label: "Active",         cls: "border-blue-300 text-blue-700 bg-blue-50" },
            { key: "pending",          label: "Pending",        cls: "border-amber-300 text-amber-700 bg-amber-50" },
            { key: "out_for_delivery", label: "Delivering",     cls: "border-indigo-300 text-indigo-700 bg-indigo-50" },
            { key: "delivered",        label: "Delivered",       cls: "border-green-300 text-green-700 bg-green-50" },
            { key: "cancelled",        label: "Cancelled",      cls: "border-red-300 text-red-600 bg-red-50" },
          ].map(({ key, label, cls }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors min-h-[36px] ${
                statusFilter === key ? "bg-primary text-white border-primary" : `bg-muted/30 ${cls}`
              }`}
              aria-pressed={statusFilter === key}
            >
              {label}
            </button>

          ))}
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/30">
          <span aria-live="polite">Showing {sorted.length} of {totalCount} orders</span>
          {hasActiveFilters && (
            <button
              onClick={() => { setSearch(""); setStatusFilter("all"); setTypeFilter("all"); setDateFrom(""); setDateTo(""); }}
              className="flex items-center gap-1 text-primary hover:underline min-h-[36px]"
            >
              <XCircle className="w-3 h-3" /> Clear all filters
            </button>
          )}
        </div>
      </Card>

      {isError && orders.length === 0 && (
        <Card className="rounded-2xl border-red-200 bg-red-50 p-6 text-center space-y-3" role="alert">
          <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
          <p className="font-semibold text-red-700">Failed to load orders</p>
          <p className="text-xs text-red-500">{(error as Error)?.message || "An unexpected error occurred"}</p>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["admin-orders-enriched"] })} className="rounded-xl gap-2">
            <RefreshCw className="w-4 h-4" /> Retry
          </Button>
        </Card>
      )}

      {isError && orders.length > 0 && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600" role="alert">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Failed to refresh — showing cached data.</span>
          <button onClick={() => qc.invalidateQueries({ queryKey: ["admin-orders-enriched"] })} className="text-primary font-semibold hover:underline ml-auto min-h-[36px]">Retry</button>
        </div>
      )}

      {!(isError && orders.length === 0) && <Card className="hidden md:block rounded-2xl border-border/50 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="min-w-[700px]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead><SortHeader label={T("orderId")} sortKey="id" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} /></TableHead>
                <TableHead><SortHeader label={T("customer")} sortKey="customer" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} /></TableHead>
                <TableHead><SortHeader label={T("type")} sortKey="type" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} /></TableHead>
                <TableHead><SortHeader label={T("total")} sortKey="total" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} /></TableHead>
                <TableHead><SortHeader label={T("status")} sortKey="status" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} /></TableHead>
                <TableHead className="text-right"><SortHeader label={T("date")} sortKey="date" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} /></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: Math.min(pageSize, 6) }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-7 w-7 rounded-full shrink-0" />
                        <div className="space-y-1.5">
                          <Skeleton className="h-3.5 w-28" />
                          <Skeleton className="h-3 w-20" />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-36 rounded-xl" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : paginated.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <ShoppingBag className="w-10 h-10 text-muted-foreground/25 mb-3" />
                      <p className="font-semibold text-muted-foreground">No orders found</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        {hasActiveFilters ? "Try adjusting your search or filters" : "No orders have been placed yet"}
                      </p>
                      {hasActiveFilters && (
                        <button
                          onClick={() => { setSearch(""); setStatusFilter("all"); setTypeFilter("all"); setDateFrom(""); setDateTo(""); }}
                          className="text-xs text-primary hover:underline mt-2"
                        >
                          Clear all filters
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((order: any) => (
                  <TableRow
                    key={order.id}
                    className="hover:bg-muted/30 cursor-pointer"
                    onClick={() => { setSelectedOrder(order); setShowCancelConfirm(false); }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Order ${order.id.slice(-8).toUpperCase()}`}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedOrder(order); setShowCancelConfirm(false); } }}
                  >
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
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate max-w-[140px]">{order.userName}</p>
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
                            toast({ title: "Invalid transition", description: `Can't move ${STATUS_LABELS[order.status]} to ${STATUS_LABELS[val]}`, variant: "destructive" }); return;
                          }
                          handleUpdateStatus(order.id, val);
                        }}
                      >
                        <SelectTrigger className={`w-36 h-8 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider border-2 ${getStatusColor(order.status)}`} aria-label={`Status: ${STATUS_LABELS[order.status]}`}>
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
        {!isLoading && sorted.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border/30 bg-muted/20">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Rows per page</span>
              <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setPage(1); }}>
                <SelectTrigger className="h-8 w-16 text-xs rounded-lg border-border/50" aria-label="Rows per page">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map(s => (
                    <SelectItem key={s} value={String(s)} className="text-xs">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="hidden sm:inline">|</span>
              <span>
                {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, sorted.length)} of {sorted.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg" onClick={() => setPage(1)} disabled={safePage <= 1} aria-label="First page">
                <ChevronsLeft className="w-3.5 h-3.5" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1} aria-label="Previous page">
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <span className="text-xs text-muted-foreground px-2">
                Page {safePage} of {totalPages}
              </span>
              <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages} aria-label="Next page">
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg" onClick={() => setPage(totalPages)} disabled={safePage >= totalPages} aria-label="Last page">
                <ChevronsRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>}

      {!(isError && orders.length === 0) && <div className="md:hidden space-y-3">
        {isLoading ? (
          [1, 2, 3].map(i => <div key={i} className="h-24 bg-muted rounded-2xl animate-pulse" />)
        ) : paginated.length === 0 ? (
          <Card className="rounded-2xl border-border/50 p-12 text-center">
            <ShoppingBag className="w-10 h-10 text-muted-foreground/25 mx-auto mb-3" />
            <p className="font-semibold text-muted-foreground text-sm">No orders found</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {hasActiveFilters ? "Try adjusting your filters" : "No orders have been placed yet"}
            </p>
            {hasActiveFilters && (
              <button
                onClick={() => { setSearch(""); setStatusFilter("all"); setTypeFilter("all"); setDateFrom(""); setDateTo(""); }}
                className="text-xs text-primary hover:underline mt-2"
              >
                Clear all filters
              </button>
            )}
          </Card>
        ) : (
          paginated.map((order: any) => (
            <Card
              key={order.id}
              className="rounded-2xl border-border/50 shadow-sm p-4 cursor-pointer hover:shadow-md transition-shadow active:scale-[0.99]"
              onClick={() => { setSelectedOrder(order); setShowCancelConfirm(false); }}
              tabIndex={0}
              role="button"
              aria-label={`Order ${order.id.slice(-8).toUpperCase()}`}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedOrder(order); setShowCancelConfirm(false); } }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-mono font-bold text-sm text-foreground">#{order.id.slice(-8).toUpperCase()}</p>
                    <Badge variant={order.type === "food" ? "default" : "secondary"} className="text-[10px] capitalize">
                      {order.type === "food" ? "🍔" : order.type === "pharmacy" ? "💊" : "🛒"} {order.type}
                    </Badge>
                    <StatusBadge status={order.status} />
                    {order.gpsMismatch && <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-bold inline-flex items-center gap-1">GPS Mismatch</span>}
                  </div>
                  {order.userName && (
                    <p className="text-sm text-muted-foreground mt-1 truncate">
                      {order.userName}{order.userPhone ? ` · ${order.userPhone}` : ""}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">{formatDate(order.createdAt)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-foreground">{formatCurrency(order.total)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{Array.isArray(order.items) ? `${order.items.length} items` : ""}</p>
                </div>
              </div>
            </Card>
          ))
        )}
        {!isLoading && sorted.length > pageSize && (
          <div className="flex items-center justify-between gap-2 pt-2">
            <span className="text-xs text-muted-foreground">
              {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, sorted.length)} of {sorted.length}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-8 rounded-xl px-3" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-xs text-muted-foreground px-2">{safePage}/{totalPages}</span>
              <Button variant="outline" size="sm" className="h-8 rounded-xl px-3" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>}

      {showDeliverConfirm && (
        <MobileDrawer
          open={true}
          onClose={() => setShowDeliverConfirm(null)}
          title={<><CheckCircle2 className="w-5 h-5 text-green-600" /> Confirm Delivery</>}
          dialogClassName="w-[95vw] max-w-sm rounded-3xl"
        >
          <div className="space-y-4 mt-2">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
              <p className="text-sm font-semibold text-green-800">Mark order as Delivered?</p>
              <p className="text-xs text-green-600">This will finalize the order. The customer will be notified that delivery is complete.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeliverConfirm(null)}
                className="flex-1 h-10 bg-white border border-border text-foreground text-sm font-bold rounded-xl hover:bg-muted/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeliver}
                disabled={updateMutation.isPending}
                className="flex-1 h-10 bg-green-600 text-white text-sm font-bold rounded-xl hover:bg-green-700 disabled:opacity-60 transition-colors"
              >
                {updateMutation.isPending ? "Updating..." : "Confirm Delivered"}
              </button>
            </div>
          </div>
        </MobileDrawer>
      )}

      <MobileDrawer
        open={!!selectedOrder}
        onClose={() => { setSelectedOrder(null); setShowCancelConfirm(false); setShowRefundConfirm(false); }}
        title={<><ShoppingBag className="w-5 h-5 text-indigo-600" /> Order Detail {selectedOrder && <StatusBadge status={selectedOrder.status} />}</>}
        dialogClassName="w-[95vw] max-w-lg rounded-3xl max-h-[90vh] overflow-y-auto"
      >
        {selectedOrder && (
          <div className="space-y-4 mt-2">

            {showCancelConfirm && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <p className="text-sm font-bold text-red-700">Cancel Order #{selectedOrder.id.slice(-6).toUpperCase()}?</p>
                </div>
                <p className="text-xs text-red-600">
                  {selectedOrder.paymentMethod === "wallet"
                    ? `${formatCurrency(Math.round(selectedOrder.total))} will be refunded to the customer's wallet.`
                    : "Cash order — no wallet refund needed."}
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setShowCancelConfirm(false)}
                    className="flex-1 h-9 bg-white border border-red-200 text-red-600 text-sm font-bold rounded-xl min-h-[36px]">
                    Back
                  </button>
                  <button onClick={handleCancelOrder} disabled={cancelling}
                    className="flex-1 h-9 bg-red-600 text-white text-sm font-bold rounded-xl disabled:opacity-60 min-h-[36px]">
                    {cancelling ? "Cancelling..." : "Confirm Cancel"}
                  </button>
                </div>
              </div>
            )}

            {showRefundConfirm && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-blue-600 shrink-0" />
                  <p className="text-sm font-bold text-blue-700">Issue Wallet Refund</p>
                </div>
                <p className="text-xs text-blue-600">
                  Max refundable: {formatCurrency(Math.round(selectedOrder.total))}.
                </p>
                <div className="flex gap-1.5 mb-1">
                  {[25, 50, 75, 100].map(pct => (
                    <button key={pct} type="button"
                      onClick={() => setRefundAmount(Math.round(selectedOrder.total * pct / 100).toString())}
                      className="flex-1 h-8 text-xs font-bold bg-white border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-100 min-h-[36px]">
                      {pct === 100 ? "Full" : `${pct}%`}
                    </button>
                  ))}
                </div>
                <div className="space-y-2">
                  <Input
                    type="number"
                    min="1"
                    max={selectedOrder.total}
                    placeholder={`Amount (required, max ${Math.round(selectedOrder.total)})`}
                    value={refundAmount}
                    onChange={e => setRefundAmount(e.target.value)}
                    className="h-9 rounded-xl text-sm"
                    aria-label="Refund amount"
                    required
                  />
                  <Input
                    placeholder="Reason (optional)"
                    value={refundReason}
                    onChange={e => setRefundReason(e.target.value)}
                    className="h-9 rounded-xl text-sm"
                    aria-label="Refund reason"
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowRefundConfirm(false)}
                    className="flex-1 h-9 bg-white border border-blue-200 text-blue-600 text-sm font-bold rounded-xl min-h-[36px]">
                    Back
                  </button>
                  <button onClick={handleRefundOrder}
                    disabled={refundMutation.isPending || !refundAmount || parseFloat(refundAmount) <= 0}
                    className="flex-1 h-9 bg-blue-600 text-white text-sm font-bold rounded-xl disabled:opacity-60 min-h-[36px]">
                    {refundMutation.isPending ? "Processing..." : "Issue Refund"}
                  </button>
                </div>
              </div>
            )}

            <div className="bg-muted/40 rounded-xl p-4 space-y-2.5 text-sm">
              <h2 className="sr-only">Order Information</h2>
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
                  {selectedOrder.paymentMethod === "wallet" ? "Wallet" : "Cash"}
                </span>
              </div>
              <div className="flex justify-between items-start gap-4">
                <span className="text-muted-foreground shrink-0">Delivery Address</span>
                <span className="text-right text-xs break-words max-w-[220px]">{selectedOrder.deliveryAddress || "—"}</span>
              </div>
            </div>

            {(selectedOrder.customerLat != null && selectedOrder.customerLng != null) && (
              <GpsStampCard order={selectedOrder} />
            )}

            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-1">
              <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wide flex items-center gap-1"><User className="w-3 h-3" /> Customer</p>
              <p className="text-sm font-semibold text-gray-800">{selectedOrder.userName || "Guest"}</p>
              {selectedOrder.userPhone && (
                <div className="flex gap-3 mt-1">
                  <a href={`tel:${selectedOrder.userPhone}`} className="flex items-center gap-1 text-xs text-blue-600 font-medium hover:underline min-h-[36px]">
                    <Phone className="w-3 h-3" /> {selectedOrder.userPhone}
                  </a>
                  <a href={`https://wa.me/92${selectedOrder.userPhone.replace(/^(\+92|0)/, "")}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-green-600 font-medium hover:underline min-h-[36px]">
                    WhatsApp
                  </a>
                </div>
              )}
            </div>

            {Array.isArray(selectedOrder.items) && selectedOrder.items.length > 0 && (
              <div>
                <h2 className="text-sm font-bold mb-2 flex items-center gap-2">
                  <Package className="w-4 h-4 text-indigo-600" /> Items ({selectedOrder.items.length})
                </h2>
                <div className="space-y-2">
                  {selectedOrder.items.map((item: any, i: number) => (
                    <div key={i} className="flex justify-between items-center gap-3 bg-muted/30 rounded-xl px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground">x{item.quantity}</p>
                      </div>
                      <p className="font-bold text-foreground shrink-0">{formatCurrency(item.price * item.quantity)}</p>
                    </div>
                  ))}
                  <div className="flex justify-between items-center bg-primary/5 border border-primary/20 rounded-xl px-3 py-2.5">
                    <p className="font-bold text-foreground">Total</p>
                    <p className="font-bold text-primary text-lg">{formatCurrency(selectedOrder.total)}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-green-50 border border-green-100 rounded-xl p-3 space-y-1">
              <p className="text-[10px] font-bold text-green-700 uppercase tracking-wide flex items-center gap-1"><UserCheck className="w-3 h-3" /> Rider Assignment</p>
              {selectedOrder.riderName ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{selectedOrder.riderName}</p>
                    {selectedOrder.riderPhone && (
                      <a href={`tel:${selectedOrder.riderPhone}`} className="flex items-center gap-1 text-xs text-green-600 font-medium hover:underline min-h-[36px]">
                        <Phone className="w-3 h-3" /> {selectedOrder.riderPhone}
                      </a>
                    )}
                  </div>
                  <button onClick={() => { setShowAssignRider(true); setRiderSearch(""); }}
                    className="text-xs text-green-700 border border-green-300 bg-white rounded-lg px-2 py-1 hover:bg-green-50 min-h-[36px]">
                    Change
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">No rider assigned</span>
                  <button onClick={() => { setShowAssignRider(true); setRiderSearch(""); }}
                    className="text-xs text-white bg-green-600 hover:bg-green-700 rounded-lg px-3 py-1.5 font-bold min-h-[36px]">
                    Assign Rider
                  </button>
                </div>
              )}

              {showAssignRider && (
                <div className="mt-2 space-y-2">
                  <Input placeholder="Search riders..." value={riderSearch} onChange={e => setRiderSearch(e.target.value)}
                    className="h-9 rounded-lg text-xs" autoFocus aria-label="Search riders" />
                  <div className="max-h-36 overflow-y-auto space-y-1">
                    {(ridersData?.users || [])
                      .filter((r: any) => r.isActive && !r.isBanned)
                      .filter((r: any) => riderSearch ? ((r.name || r.phone || "").toLowerCase().includes(riderSearch.toLowerCase())) : true)
                      .slice(0, 8)
                      .map((r: any) => (
                        <button key={r.id} onClick={() => handleAssignRider(r)} disabled={assignMutation.isPending}
                          className="w-full flex items-center gap-2 text-left px-2 py-2 bg-white border border-border/50 rounded-lg hover:bg-green-50 text-xs min-h-[36px]">
                          <div className="w-6 h-6 rounded-full bg-green-100 text-green-700 font-bold text-[10px] flex items-center justify-center shrink-0">
                            {(r.name || r.phone || "R")[0].toUpperCase()}
                          </div>
                          <span className="font-semibold truncate">{r.name || r.phone}</span>
                          <span className="text-muted-foreground ml-auto font-mono shrink-0">{r.vehiclePlate || ""}</span>
                        </button>
                      ))}
                  </div>
                  <button onClick={() => setShowAssignRider(false)} className="text-xs text-muted-foreground hover:underline min-h-[36px]">Cancel</button>
                </div>
              )}
            </div>

            {isTerminal(selectedOrder.status) && selectedOrder.paymentMethod === "wallet" && (
              <div>
                <p className="text-xs text-muted-foreground font-medium mb-1.5">Admin Actions</p>
                {selectedOrder.refundedAt ? (
                  <div className="h-9 px-4 bg-green-50 border-2 border-green-300 text-green-700 text-xs font-bold rounded-xl flex items-center gap-1.5">
                    Refunded{selectedOrder.refundedAmount ? ` — ${formatCurrency(Math.round(parseFloat(selectedOrder.refundedAmount)))}` : ""}
                  </div>
                ) : !showRefundConfirm ? (
                  <button
                    onClick={() => { setShowRefundConfirm(true); setShowCancelConfirm(false); setRefundAmount(""); setRefundReason(""); }}
                    className="h-9 px-4 bg-blue-50 hover:bg-blue-100 border-2 border-blue-300 text-blue-700 text-xs font-bold rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 min-h-[36px]"
                  >
                    Issue Wallet Refund
                  </button>
                ) : null}
              </div>
            )}

            {!isTerminal(selectedOrder.status) && (
              <div className="flex gap-3">
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground font-medium mb-1.5">Move to Next Status</p>
                  <Select
                    value={selectedOrder.status}
                    onValueChange={(val) => {
                      if (val === selectedOrder.status) return;
                      if (val === "delivered") {
                        setShowDeliverConfirm(selectedOrder.id);
                        return;
                      }
                      handleUpdateStatus(selectedOrder.id, val, { localUpdate: true });
                    }}
                  >
                    <SelectTrigger className={`h-9 text-[11px] font-bold uppercase tracking-wider border-2 ${getStatusColor(selectedOrder.status)}`} aria-label="Change order status">
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
                      className="h-9 px-4 bg-red-50 hover:bg-red-100 border-2 border-red-300 text-red-600 text-xs font-bold rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 min-h-[36px]"
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
      </MobileDrawer>
    </PullToRefresh>
  );
}
