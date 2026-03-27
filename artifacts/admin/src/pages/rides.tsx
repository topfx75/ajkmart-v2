import { useState, useEffect } from "react";
import { useRidesEnriched, useUpdateRide } from "@/hooks/use-admin";
import { formatCurrency, formatDate, getStatusColor } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Car, Search, User, MapPin, Navigation, Phone,
  TrendingUp, UserCheck, AlertTriangle, CheckCircle2,
  MessageCircle, Clock, Zap, History, Activity,
} from "lucide-react";

/* ─── constants ─── */
const STATUS_LABELS: Record<string, string> = {
  bargaining: "Bargaining", searching: "Searching", accepted: "Accepted",
  arrived: "Arrived", in_transit: "In Transit", completed: "Completed", cancelled: "Cancelled",
};
const BARGAIN_STATUS_LABELS: Record<string, string> = {
  customer_offered: "Bids Open", rider_countered: "Rider Countered",
  customer_countered: "Customer Countered", agreed: "Deal Agreed", expired: "Expired",
};
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  bargaining: ["searching", "cancelled"],
  searching:  ["accepted", "cancelled"],
  accepted:   ["arrived", "cancelled"],
  arrived:    ["in_transit", "cancelled"],
  in_transit: ["completed", "cancelled"],
  completed:  ["completed"],
  cancelled:  ["cancelled"],
};

/* ─── helpers ─── */
const isTerminal  = (s: string) => s === "completed" || s === "cancelled";
const allowedNext = (r: any)   => ALLOWED_TRANSITIONS[r.status] ?? [];
const canCancel   = (r: any)   => !isTerminal(r.status);

function TimeAgo({ date }: { date: string }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const update = () => {
      const sec = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
      if (sec < 60) setLabel(`${sec}s ago`);
      else if (sec < 3600) setLabel(`${Math.floor(sec / 60)}m ago`);
      else setLabel(`${Math.floor(sec / 3600)}h ago`);
    };
    update();
    const t = setInterval(update, 10_000);
    return () => clearInterval(t);
  }, [date]);
  return <span>{label}</span>;
}

/* ────────────────────────────────────────────────────
   RIDE DETAIL MODAL — shared across all sections
   ──────────────────────────────────────────────────── */
function RideDetailModal({
  ride, onClose, onUpdateStatus, onAssign,
}: {
  ride: any;
  onClose: () => void;
  onUpdateStatus: (id: string, status: string, opts?: any) => void;
  onAssign: (id: string, name: string, phone: string) => void;
}) {
  const [assignName,  setAssignName]  = useState("");
  const [assignPhone, setAssignPhone] = useState("");
  const [assigning,   setAssigning]   = useState(false);
  const [showCancel,  setShowCancel]  = useState(false);
  const [cancelling,  setCancelling]  = useState(false);
  const { toast } = useToast();

  const openInMaps = () => {
    if (ride.pickupLat && ride.dropLat) {
      window.open(`https://www.google.com/maps/dir/?api=1&origin=${ride.pickupLat},${ride.pickupLng}&destination=${ride.dropLat},${ride.dropLng}&travelmode=driving`, "_blank");
    } else if (ride.pickupAddress && ride.dropAddress) {
      window.open(`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(ride.pickupAddress)}&destination=${encodeURIComponent(ride.dropAddress)}&travelmode=driving`, "_blank");
    }
  };

  const handleAssign = () => {
    if (!assignName.trim() || !assignPhone.trim()) {
      toast({ title: "Name aur phone number zaroor likhein", variant: "destructive" }); return;
    }
    setAssigning(true);
    onAssign(ride.id, assignName.trim(), assignPhone.trim());
  };

  const handleCancel = () => {
    setCancelling(true);
    onUpdateStatus(ride.id, "cancelled");
    setTimeout(() => { setCancelling(false); setShowCancel(false); onClose(); }, 800);
  };

  return (
    <Dialog open={!!ride} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-lg rounded-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <Car className="w-5 h-5 text-green-600" />
            Ride Detail
            <Badge variant="outline" className={`text-[10px] font-bold uppercase ${getStatusColor(ride.status)}`}>
              {STATUS_LABELS[ride.status]}
            </Badge>
            <span className="font-mono text-xs text-muted-foreground ml-auto">#{ride.id.slice(-8).toUpperCase()}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-1">

          {/* Cancel confirmation inline */}
          {showCancel && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <p className="text-sm font-bold text-red-700">Cancel Ride #{ride.id.slice(-6).toUpperCase()}?</p>
              </div>
              <p className="text-xs text-red-600">
                {ride.paymentMethod === "wallet"
                  ? `Rs. ${Math.round(ride.fare)} customer ki wallet mein refund ho jayega.`
                  : "Cash ride — no refund needed."}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setShowCancel(false)}
                  className="flex-1 h-9 bg-white border border-red-200 text-red-600 text-sm font-bold rounded-xl">
                  Back
                </button>
                <button onClick={handleCancel} disabled={cancelling}
                  className="flex-1 h-9 bg-red-600 text-white text-sm font-bold rounded-xl disabled:opacity-60">
                  {cancelling ? "Cancelling..." : "Confirm Cancel"}
                </button>
              </div>
            </div>
          )}

          {/* Bargaining Summary — highlighted section */}
          {ride.status === "bargaining" && (
            <div className="bg-orange-50 border-2 border-orange-200 rounded-xl p-4 space-y-2">
              <p className="text-xs font-bold text-orange-700 uppercase tracking-wide flex items-center gap-1.5">
                <MessageCircle className="w-3.5 h-3.5" /> Mol-Tol (Bargaining) Status
              </p>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-xl font-extrabold text-orange-600">{formatCurrency(ride.offeredFare ?? 0)}</p>
                  <p className="text-[10px] text-orange-500">Customer Offer</p>
                </div>
                <div>
                  <p className="text-xl font-extrabold text-blue-600">{ride.totalBids ?? 0}</p>
                  <p className="text-[10px] text-blue-500">Rider Bids</p>
                </div>
                <div>
                  <p className="text-xl font-extrabold text-gray-600">{formatCurrency(ride.fare)}</p>
                  <p className="text-[10px] text-gray-400">Platform Fare</p>
                </div>
              </div>
              {ride.bargainStatus && (
                <div className="flex justify-center pt-1">
                  <Badge variant="outline" className="text-[10px] font-bold bg-purple-50 text-purple-700 border-purple-200">
                    💬 {BARGAIN_STATUS_LABELS[ride.bargainStatus] ?? ride.bargainStatus}
                    {ride.bargainRounds > 0 ? ` · Round ${ride.bargainRounds}` : ""}
                  </Badge>
                </div>
              )}
              {ride.counterFare != null && (
                <div className="flex justify-between items-center bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  <span className="text-xs font-bold text-green-700">Agreed Bid Fare</span>
                  <span className="font-extrabold text-green-700">{formatCurrency(ride.counterFare)}</span>
                </div>
              )}
              {ride.bargainNote && (
                <p className="text-xs text-orange-700 italic border-t border-orange-200 pt-2">
                  Customer note: "{ride.bargainNote}"
                </p>
              )}
              <div className="border-t border-orange-200 pt-2">
                <p className="text-[10px] text-orange-500 font-medium">
                  Admin Action: Move to "Searching" to force driver assignment, or Cancel to reject.
                </p>
              </div>
            </div>
          )}

          {/* Core info grid */}
          <div className="bg-muted/40 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type</span>
              <Badge variant="outline" className={`text-[10px] font-bold uppercase ${ride.type === 'bike' ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-sky-50 text-sky-600 border-sky-200'}`}>
                {ride.type === 'bike' ? '🏍️' : '🚗'} {ride.type}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Platform Fare</span>
              <span className="font-bold">{formatCurrency(ride.fare)}</span>
            </div>
            {ride.offeredFare != null && ride.status !== "bargaining" && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Customer Offer Was</span>
                <span className="font-bold text-orange-600">{formatCurrency(ride.offeredFare)}</span>
              </div>
            )}
            {ride.counterFare != null && ride.status !== "bargaining" && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Agreed Bid Fare</span>
                <span className="font-bold text-green-600">{formatCurrency(ride.counterFare)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Distance</span>
              <span>{ride.distance} km</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Payment</span>
              <span className={`font-medium capitalize ${ride.paymentMethod === "wallet" ? "text-blue-600" : "text-green-600"}`}>
                {ride.paymentMethod === "wallet" ? "💳 Wallet" : "💵 Cash"}
              </span>
            </div>
          </div>

          {/* Customer & Rider */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-1">
              <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wide flex items-center gap-1"><User className="w-3 h-3" /> Customer</p>
              <p className="text-sm font-semibold text-gray-800">{ride.userName || "Unknown"}</p>
              {ride.userPhone && (
                <>
                  <a href={`tel:${ride.userPhone}`} className="flex items-center gap-1 text-xs text-blue-600 font-medium hover:underline">
                    <Phone className="w-3 h-3" /> {ride.userPhone}
                  </a>
                  <a href={`https://wa.me/92${ride.userPhone.replace(/^(\+92|0)/, "")}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-green-600 font-medium hover:underline">
                    💬 WhatsApp
                  </a>
                </>
              )}
            </div>
            <div className={`rounded-xl p-3 space-y-1 border ${ride.riderName ? "bg-green-50 border-green-100" : "bg-amber-50 border-amber-100"}`}>
              <p className={`text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 ${ride.riderName ? "text-green-600" : "text-amber-600"}`}>
                <Car className="w-3 h-3" /> Rider
              </p>
              {ride.riderName ? (
                <>
                  <p className="text-sm font-semibold text-gray-800">{ride.riderName}</p>
                  {ride.riderPhone && (
                    <>
                      <a href={`tel:${ride.riderPhone}`} className="flex items-center gap-1 text-xs text-green-600 font-medium hover:underline">
                        <Phone className="w-3 h-3" /> {ride.riderPhone}
                      </a>
                      <a href={`https://wa.me/92${ride.riderPhone.replace(/^(\+92|0)/, "")}`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-green-600 font-medium hover:underline">
                        💬 WhatsApp
                      </a>
                    </>
                  )}
                </>
              ) : (
                <p className="text-xs text-amber-600 font-semibold">Not assigned yet</p>
              )}
            </div>
          </div>

          {/* Manual Assign (searching/accepted without rider) */}
          {["searching", "accepted", "bargaining"].includes(ride.status) && !ride.riderName && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
              <p className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5" /> Manually Assign Rider
              </p>
              <div className="grid grid-cols-2 gap-2">
                <input value={assignName} onChange={e => setAssignName(e.target.value)}
                  placeholder="Rider name"
                  className="h-9 px-3 rounded-lg border border-amber-200 bg-white text-xs focus:outline-none focus:border-amber-400" />
                <input value={assignPhone} onChange={e => setAssignPhone(e.target.value)}
                  placeholder="03XX-XXXXXXX"
                  className="h-9 px-3 rounded-lg border border-amber-200 bg-white text-xs focus:outline-none focus:border-amber-400" />
              </div>
              <button onClick={handleAssign} disabled={assigning || !assignName.trim() || !assignPhone.trim()}
                className="w-full h-9 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5" />
                {assigning ? "Assigning..." : "Assign Rider & Mark Accepted"}
              </button>
            </div>
          )}

          {/* Route */}
          <div className="bg-gradient-to-b from-green-50 to-red-50 border border-green-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-bold text-muted-foreground flex items-center gap-1">
                <Navigation className="w-3.5 h-3.5" /> Route
              </p>
              {(ride.pickupAddress || ride.pickupLat) && (
                <button onClick={openInMaps}
                  className="flex items-center gap-1 text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg hover:bg-blue-100 transition-colors">
                  🗺️ Open in Maps
                </button>
              )}
            </div>
            <div className="flex items-start gap-3">
              <MapPin className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-bold text-green-700 uppercase tracking-wide">Pickup</p>
                <p className="text-sm">{ride.pickupAddress || "—"}</p>
              </div>
            </div>
            <div className="border-l-2 border-dashed border-muted ml-[7px] h-3" />
            <div className="flex items-start gap-3">
              <MapPin className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-bold text-red-700 uppercase tracking-wide">Drop</p>
                <p className="text-sm">{ride.dropAddress || "—"}</p>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          {!isTerminal(ride.status) && !showCancel && (
            <div className="flex gap-3">
              <div className="flex-1">
                <p className="text-xs text-muted-foreground font-medium mb-1.5">Move to Next Status</p>
                <Select
                  value={ride.status}
                  onValueChange={val => { if (val !== ride.status) onUpdateStatus(ride.id, val); }}
                >
                  <SelectTrigger className={`h-9 text-[11px] font-bold uppercase tracking-wider border-2 ${getStatusColor(ride.status)}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedNext(ride).filter(s => s !== "cancelled").map(s => (
                      <SelectItem key={s} value={s} className="text-xs uppercase font-bold">
                        <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-green-500" />{STATUS_LABELS[s]}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {canCancel(ride) && (
                <div>
                  <p className="text-xs text-muted-foreground font-medium mb-1.5">Admin Action</p>
                  <button onClick={() => setShowCancel(true)}
                    className="h-9 px-4 bg-red-50 hover:bg-red-100 border-2 border-red-300 text-red-600 text-xs font-bold rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Cancel & Refund
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Timestamps */}
          <div className="flex justify-between text-xs text-muted-foreground border-t border-border/40 pt-3">
            <span>Booked: {formatDate(ride.createdAt)}</span>
            <span>Updated: {formatDate(ride.updatedAt)}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────────────────────────────────
   MAIN PAGE
   ──────────────────────────────────────────────────── */
type Tab = "live" | "active" | "history";

export default function Rides() {
  const { data, isLoading } = useRidesEnriched();
  const updateMutation = useUpdateRide();
  const { toast } = useToast();

  const [tab,          setTab]          = useState<Tab>("live");
  const [search,       setSearch]       = useState("");
  const [selectedRide, setSelectedRide] = useState<any>(null);

  /* Refresh ticker */
  const [secAgo, setSecAgo] = useState(0);
  useEffect(() => { if (!isLoading) setSecAgo(0); }, [isLoading]);
  useEffect(() => {
    const t = setInterval(() => setSecAgo(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const rides = data?.rides || [];

  /* ── Grouped Rides ── */
  const bargaining  = rides.filter((r: any) => r.status === "bargaining");
  const searching   = rides.filter((r: any) => r.status === "searching");
  const inProgress  = rides.filter((r: any) => ["accepted","arrived","in_transit"].includes(r.status));
  const completed   = rides.filter((r: any) => r.status === "completed");
  const cancelled   = rides.filter((r: any) => r.status === "cancelled");
  const liveRides   = [...bargaining, ...searching];

  /* ── Stats ── */
  const activeCount = bargaining.length + searching.length + inProgress.length;
  const totalRevenue = completed.reduce((s: number, r: any) => s + (r.fare || 0), 0);

  /* ── History search filter ── */
  const q = search.toLowerCase();
  const historyFiltered = [...completed, ...cancelled].filter((r: any) =>
    r.id.toLowerCase().includes(q) ||
    (r.userName  || "").toLowerCase().includes(q) ||
    (r.userPhone || "").includes(q) ||
    (r.riderName || "").toLowerCase().includes(q)
  );

  /* ── Actions ── */
  const handleUpdateStatus = (id: string, status: string, opts?: any) => {
    updateMutation.mutate({ id, status, ...opts }, {
      onSuccess: () => toast({ title: `Status → ${STATUS_LABELS[status]} ✅` }),
      onError: err => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
    });
  };

  const handleAssign = (id: string, name: string, phone: string) => {
    updateMutation.mutate({ id, status: "accepted", riderName: name, riderPhone: phone }, {
      onSuccess: () => {
        toast({ title: "Rider assigned & Accepted ✅" });
        setSelectedRide(null);
      },
      onError: err => toast({ title: "Assignment failed", description: err.message, variant: "destructive" }),
    });
  };

  const openRide = (r: any) => setSelectedRide(r);

  /* ─── Live card component ─── */
  const LiveCard = ({ r }: { r: any }) => {
    const isBargain = r.status === "bargaining";
    return (
      <div
        onClick={() => openRide(r)}
        className={`rounded-2xl border-2 p-4 cursor-pointer transition-all hover:shadow-md ${
          isBargain
            ? "bg-orange-50 border-orange-300 hover:border-orange-400"
            : "bg-amber-50 border-amber-300 hover:border-amber-400"
        }`}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0 ${isBargain ? "bg-orange-200" : "bg-amber-200"}`}>
              {isBargain ? "💬" : (r.type === "bike" ? "🏍️" : "🚗")}
            </div>
            <div>
              <p className="font-mono font-bold text-sm text-gray-800">#{r.id.slice(-8).toUpperCase()}</p>
              <p className="text-[10px] text-muted-foreground"><TimeAgo date={r.createdAt} /></p>
            </div>
          </div>
          <div className="text-right shrink-0">
            {isBargain ? (
              <>
                <p className="font-extrabold text-orange-600">{formatCurrency(r.offeredFare ?? 0)}</p>
                <p className="text-[10px] text-orange-400">offer · {formatCurrency(r.fare)} platform</p>
              </>
            ) : (
              <>
                <p className="font-extrabold text-gray-800">{formatCurrency(r.fare)}</p>
                <p className="text-[10px] text-muted-foreground">{r.distance} km</p>
              </>
            )}
          </div>
        </div>

        {/* Route */}
        <div className="space-y-1 mb-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
            <span className="truncate">{r.pickupAddress || "—"}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
            <span className="truncate">{r.dropAddress || "—"}</span>
          </div>
        </div>

        {/* Customer */}
        {r.userName && (
          <p className="text-xs text-gray-500 mb-2">👤 {r.userName} {r.userPhone && `· ${r.userPhone}`}</p>
        )}

        {/* Bargaining specifics */}
        {isBargain && (
          <div className="flex items-center gap-2 flex-wrap">
            {(r.totalBids ?? 0) > 0 && (
              <span className="text-[10px] font-bold px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                {r.totalBids} bid{r.totalBids > 1 ? "s" : ""} submitted
              </span>
            )}
            {r.bargainStatus && (
              <span className="text-[10px] font-bold px-2 py-1 bg-purple-100 text-purple-700 rounded-full">
                {BARGAIN_STATUS_LABELS[r.bargainStatus] ?? r.bargainStatus}
              </span>
            )}
            {(r.totalBids ?? 0) === 0 && (
              <span className="text-[10px] font-bold px-2 py-1 bg-orange-100 text-orange-600 rounded-full animate-pulse">
                Waiting for bids...
              </span>
            )}
          </div>
        )}

        {/* Quick status badge for searching */}
        {!isBargain && (
          <span className="text-[10px] font-bold px-2 py-1 bg-amber-100 text-amber-700 rounded-full animate-pulse">
            🔍 Searching for driver...
          </span>
        )}
      </div>
    );
  };

  /* ─── In-Progress row ─── */
  const STATUS_ICONS: Record<string, string> = {
    accepted: "✅", arrived: "📍", in_transit: "🛣️",
  };

  /* ─── Tab button ─── */
  const TabBtn = ({ id, icon: Icon, label, count, urgent }: { id: Tab; icon: any; label: string; count: number; urgent?: boolean }) => (
    <button
      onClick={() => setTab(id)}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border ${
        tab === id
          ? "bg-primary text-white border-primary shadow-sm"
          : `bg-muted/30 border-border/50 text-muted-foreground hover:border-primary/50 ${urgent && count > 0 ? "border-orange-300 text-orange-700 bg-orange-50" : ""}`
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
      {count > 0 && (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab === id ? "bg-white/20 text-white" : urgent ? "bg-orange-500 text-white" : "bg-muted text-muted-foreground"}`}>
          {count}
        </span>
      )}
    </button>
  );

  return (
    <div className="space-y-5 sm:space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-green-100 text-green-600 rounded-xl flex items-center justify-center shrink-0">
            <Car className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">Rides</h1>
            <p className="text-muted-foreground text-xs">{rides.length} total · {rides.filter((r:any) => r.type === "bike").length} bike · {rides.filter((r:any) => r.type === "car").length} car</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
          <span className={`w-2 h-2 rounded-full ${secAgo < 35 ? "bg-green-500 animate-pulse" : "bg-amber-400"}`} />
          {isLoading ? "Refreshing..." : `Refreshed ${secAgo}s ago`}
        </div>
      </div>

      {/* ── Urgent Alerts ── */}
      {liveRides.length > 0 && (
        <div className={`flex items-center gap-3 rounded-2xl px-4 py-3 border-2 ${bargaining.length > 0 ? "bg-orange-50 border-orange-400" : "bg-amber-50 border-amber-400"}`}>
          <span className="text-2xl">{bargaining.length > 0 ? "💬" : "🚨"}</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-orange-800">
              {bargaining.length > 0 && `${bargaining.length} bargaining ride${bargaining.length > 1 ? "s" : ""} — customers waiting for bids`}
              {bargaining.length > 0 && searching.length > 0 && " · "}
              {searching.length > 0 && `${searching.length} ride${searching.length > 1 ? "s" : ""} searching for driver`}
            </p>
            <p className="text-xs text-orange-600 mt-0.5">
              {liveRides.slice(0, 4).map((r: any) => `${r.type === "bike" ? "🏍️" : "🚗"} #${r.id.slice(-6).toUpperCase()}`).join(" · ")}
              {liveRides.length > 4 && ` +${liveRides.length - 4} more`}
            </p>
          </div>
          <button onClick={() => setTab("live")}
            className="px-3 py-1.5 bg-orange-500 text-white text-xs font-bold rounded-xl whitespace-nowrap hover:bg-orange-600 transition-colors">
            View Live
          </button>
        </div>
      )}

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Total",      val: rides.length,          cls: "text-foreground", bg: "" },
          { label: "Bargaining", val: bargaining.length,     cls: "text-orange-600", bg: "bg-orange-50/60 border-orange-200/60" },
          { label: "Searching",  val: searching.length,      cls: "text-amber-700",  bg: "bg-amber-50/60 border-amber-200/60"  },
          { label: "Active Now", val: activeCount,            cls: "text-blue-700",   bg: "bg-blue-50/60 border-blue-200/60"    },
          { label: "Completed",  val: completed.length,      cls: "text-green-700",  bg: "bg-green-50/60 border-green-200/60"  },
        ].map(s => (
          <Card key={s.label} className={`p-4 rounded-2xl border-border/50 shadow-sm text-center ${s.bg}`}>
            <p className={`text-3xl font-bold ${s.cls}`}>{s.val}</p>
            <p className={`text-xs mt-1 ${s.cls || "text-muted-foreground"} opacity-75`}>{s.label}</p>
          </Card>
        ))}
      </div>

      {/* Revenue card */}
      <Card className="p-4 rounded-2xl border-border/50 shadow-sm bg-amber-50/60 border-amber-200/60 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-xs text-amber-500 font-medium">Total Revenue (Completed Rides)</p>
            <p className="text-2xl font-extrabold text-amber-700">{formatCurrency(totalRevenue)}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-amber-500">{cancelled.length} cancelled</p>
          <p className="text-xs text-amber-400">{completed.length} completed</p>
        </div>
      </Card>

      {/* ── Tabs ── */}
      <div className="flex flex-wrap gap-2">
        <TabBtn id="live"    icon={Zap}      label="Live"        count={liveRides.length}   urgent />
        <TabBtn id="active"  icon={Activity} label="In Progress" count={inProgress.length}         />
        <TabBtn id="history" icon={History}  label="History"     count={completed.length + cancelled.length} />
      </div>

      {/* ══════════ TAB: LIVE ══════════ */}
      {tab === "live" && (
        <div className="space-y-4">

          {/* Bargaining section */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MessageCircle className="w-4 h-4 text-orange-500" />
              <h2 className="font-bold text-orange-700">Mol-Tol (Bargaining)</h2>
              {bargaining.length > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 animate-pulse">
                  {bargaining.length} LIVE
                </span>
              )}
            </div>
            {bargaining.length === 0 ? (
              <Card className="p-8 rounded-2xl border-border/50 shadow-sm text-center">
                <p className="text-3xl mb-2">💬</p>
                <p className="text-muted-foreground font-semibold">No bargaining rides right now</p>
                <p className="text-muted-foreground text-xs mt-1">Rides appear here when customers submit InDrive-style offers</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {bargaining.map((r: any) => <LiveCard key={r.id} r={r} />)}
              </div>
            )}
          </div>

          {/* Searching section */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Search className="w-4 h-4 text-amber-600" />
              <h2 className="font-bold text-amber-700">Driver Dhundh Rahe (Searching)</h2>
              {searching.length > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 animate-pulse">
                  {searching.length} LIVE
                </span>
              )}
            </div>
            {searching.length === 0 ? (
              <Card className="p-6 rounded-2xl border-border/50 shadow-sm text-center">
                <p className="text-2xl mb-2">✅</p>
                <p className="text-muted-foreground text-sm font-semibold">No rides searching for a driver</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {searching.map((r: any) => <LiveCard key={r.id} r={r} />)}
              </div>
            )}
          </div>

          {liveRides.length === 0 && (
            <Card className="p-12 rounded-2xl border-border/50 shadow-sm text-center">
              <p className="text-5xl mb-3">🟢</p>
              <p className="text-lg font-bold text-gray-700">All Quiet</p>
              <p className="text-gray-400 text-sm mt-1">No rides need attention right now</p>
            </Card>
          )}
        </div>
      )}

      {/* ══════════ TAB: ACTIVE (in progress) ══════════ */}
      {tab === "active" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="w-4 h-4 text-blue-500" />
            <h2 className="font-bold text-blue-700">Rides In Progress</h2>
          </div>

          {inProgress.length === 0 ? (
            <Card className="p-12 rounded-2xl border-border/50 shadow-sm text-center">
              <p className="text-5xl mb-3">🏍️</p>
              <p className="text-lg font-bold text-gray-700">No Active Rides</p>
              <p className="text-gray-400 text-sm mt-1">Accepted / Arrived / In-transit rides appear here</p>
            </Card>
          ) : (
            <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <Table className="min-w-[600px]">
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="font-semibold">Ride</TableHead>
                      <TableHead className="font-semibold">Customer</TableHead>
                      <TableHead className="font-semibold">Rider</TableHead>
                      <TableHead className="font-semibold">Route</TableHead>
                      <TableHead className="font-semibold">Fare</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inProgress.map((r: any) => (
                      <TableRow key={r.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => openRide(r)}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="text-base">{STATUS_ICONS[r.status] ?? "🚗"}</span>
                            <div>
                              <p className="font-mono font-medium text-sm">{r.id.slice(-8).toUpperCase()}</p>
                              <Badge variant="outline" className={`mt-0.5 text-[10px] font-bold uppercase ${r.type === 'bike' ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-sky-50 text-sky-600 border-sky-200'}`}>
                                {r.type === 'bike' ? '🏍️' : '🚗'} {r.type}
                              </Badge>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm font-semibold">{r.userName || "—"}</p>
                          <p className="text-xs text-muted-foreground">{r.userPhone || ""}</p>
                        </TableCell>
                        <TableCell>
                          {r.riderName
                            ? <><p className="text-sm font-semibold">{r.riderName}</p><p className="text-xs text-muted-foreground">{r.riderPhone}</p></>
                            : <span className="text-xs text-amber-600 font-semibold">Unassigned</span>}
                        </TableCell>
                        <TableCell className="max-w-[160px]">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-xs">
                              <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                              <span className="truncate">{r.pickupAddress || "—"}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs">
                              <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                              <span className="truncate">{r.dropAddress || "—"}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="font-bold">{formatCurrency(r.counterFare ?? r.fare)}</p>
                          {r.counterFare && r.counterFare !== r.fare && (
                            <p className="text-[10px] text-muted-foreground line-through">{formatCurrency(r.fare)}</p>
                          )}
                          <p className="text-xs text-muted-foreground">{r.distance} km</p>
                        </TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <Select
                            value={r.status}
                            onValueChange={val => {
                              if (!allowedNext(r).includes(val)) return;
                              handleUpdateStatus(r.id, val);
                            }}
                          >
                            <SelectTrigger className={`w-32 h-8 text-[10px] font-bold uppercase tracking-wider border-2 ${getStatusColor(r.status)}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {allowedNext(r).map(s => (
                                <SelectItem key={s} value={s} className="text-xs uppercase font-bold">{STATUS_LABELS[s]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ══════════ TAB: HISTORY ══════════ */}
      {tab === "history" && (
        <div className="space-y-4">
          {/* Search */}
          <Card className="p-3 rounded-2xl border-border/50 shadow-sm">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by ID, customer, rider or phone..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 h-10 rounded-xl bg-muted/30 border-border/50 text-sm"
              />
            </div>
          </Card>

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4 rounded-2xl border-border/50 shadow-sm bg-green-50/60 border-green-200/60 text-center">
              <p className="text-3xl font-bold text-green-700">{completed.length}</p>
              <p className="text-xs text-green-500 mt-1">Completed</p>
              <p className="text-sm font-bold text-green-600 mt-0.5">{formatCurrency(totalRevenue)}</p>
            </Card>
            <Card className="p-4 rounded-2xl border-border/50 shadow-sm bg-red-50/60 border-red-200/60 text-center">
              <p className="text-3xl font-bold text-red-700">{cancelled.length}</p>
              <p className="text-xs text-red-400 mt-1">Cancelled</p>
              <p className="text-sm text-red-400 mt-0.5">
                {rides.length > 0 ? Math.round((cancelled.length / rides.length) * 100) : 0}% cancel rate
              </p>
            </Card>
          </div>

          {/* Table */}
          <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <Table className="min-w-[620px]">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-semibold">Ride / Type</TableHead>
                    <TableHead className="font-semibold">Customer</TableHead>
                    <TableHead className="font-semibold">Rider</TableHead>
                    <TableHead className="font-semibold">Route</TableHead>
                    <TableHead className="font-semibold">Fare</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="font-semibold text-right">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">Loading...</TableCell></TableRow>
                  ) : historyFiltered.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">{search ? "No rides match your search." : "No ride history yet."}</TableCell></TableRow>
                  ) : (
                    historyFiltered.map((r: any) => (
                      <TableRow key={r.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => openRide(r)}>
                        <TableCell>
                          <p className="font-mono font-medium text-sm">{r.id.slice(-8).toUpperCase()}</p>
                          <Badge variant="outline" className={`mt-1 text-[10px] font-bold uppercase ${r.type === 'bike' ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-sky-50 text-sky-600 border-sky-200'}`}>
                            {r.type === 'bike' ? '🏍️' : '🚗'} {r.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm font-semibold">{r.userName || "Unknown"}</p>
                          <p className="text-xs text-muted-foreground">{r.userPhone}</p>
                        </TableCell>
                        <TableCell>
                          {r.riderName
                            ? <><p className="text-sm font-semibold">{r.riderName}</p><p className="text-xs text-muted-foreground">{r.riderPhone}</p></>
                            : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="max-w-[160px]">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-xs">
                              <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                              <span className="truncate">{r.pickupAddress || "—"}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs">
                              <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                              <span className="truncate">{r.dropAddress || "—"}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {r.status === "completed" && r.counterFare ? (
                            <>
                              <p className="font-bold text-green-600">{formatCurrency(r.counterFare)}</p>
                              <p className="text-[10px] text-muted-foreground line-through">{formatCurrency(r.fare)}</p>
                            </>
                          ) : (
                            <p className="font-bold">{formatCurrency(r.fare)}</p>
                          )}
                          <p className="text-xs text-muted-foreground">{r.distance} km</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] font-bold uppercase ${getStatusColor(r.status)}`}>
                            {r.status === "completed" ? "✅" : "❌"} {STATUS_LABELS[r.status]}
                          </Badge>
                          {r.bargainStatus === "agreed" && r.offeredFare && (
                            <Badge variant="outline" className="mt-1 text-[9px] font-bold bg-purple-50 text-purple-700 border-purple-200 block">
                              💬 Negotiated
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(r.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      )}

      {/* ── Ride Detail Modal ── */}
      {selectedRide && (
        <RideDetailModal
          ride={selectedRide}
          onClose={() => setSelectedRide(null)}
          onUpdateStatus={(id, status, opts) => {
            handleUpdateStatus(id, status, opts);
            setSelectedRide((r: any) => r ? { ...r, status } : null);
          }}
          onAssign={handleAssign}
        />
      )}
    </div>
  );
}
