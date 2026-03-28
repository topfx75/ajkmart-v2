import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { fetcher } from "@/lib/api";
import {
  useRidesEnriched, useUpdateRide, useRideServices, useCreateRideService, useUpdateRideService, useDeleteRideService,
  usePopularLocations, useCreateLocation, useUpdateLocation, useDeleteLocation,
  useSchoolRoutes, useCreateSchoolRoute, useUpdateSchoolRoute, useDeleteSchoolRoute, useSchoolSubscriptions,
  useLiveRiders, useCustomerLocations,
} from "@/hooks/use-admin";
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
  MessageCircle, Clock, Zap, History, Activity, Settings2,
  Plus, Pencil, Trash2, ToggleLeft, ToggleRight, ChevronUp, ChevronDown, Layers,
  GraduationCap, Bus, X, Users,
} from "lucide-react";
import { useLanguage } from "@/lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";

/* ─── constants ─── */
const STATUS_LABELS: Record<string, string> = {
  bargaining: "Bargaining", searching: "Searching", accepted: "Accepted",
  arrived: "Arrived", in_transit: "In Transit", completed: "Completed", cancelled: "Cancelled",
};
const SVC_ICONS: Record<string, string> = { bike: "🏍️", car: "🚗", rickshaw: "🛺", daba: "🚐", school_shift: "🚌" };
const SVC_CLR: Record<string, string> = {
  bike: "bg-orange-50 text-orange-600 border-orange-200",
  car: "bg-sky-50 text-sky-600 border-sky-200",
  rickshaw: "bg-yellow-50 text-yellow-700 border-yellow-200",
  daba: "bg-purple-50 text-purple-600 border-purple-200",
  school_shift: "bg-blue-50 text-blue-600 border-blue-200",
};
const svcIcon = (type: string) => SVC_ICONS[type] ?? "🚗";
const svcClr  = (type: string) => SVC_CLR[type]  ?? "bg-gray-50 text-gray-600 border-gray-200";
const svcName = (type: string) => type?.replace(/_/g, " ") ?? "ride";
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
  onAssign: (id: string, name: string, phone: string) => Promise<void>;
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

  const handleAssign = async () => {
    if (!assignName.trim() || !assignPhone.trim()) {
      toast({ title: "Name aur phone number zaroor likhein", variant: "destructive" }); return;
    }
    setAssigning(true);
    try {
      await onAssign(ride.id, assignName.trim(), assignPhone.trim());
    } catch {
      setAssigning(false);
    }
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
                  <p className="text-xl font-extrabold text-orange-600">
                    {ride.offeredFare != null ? formatCurrency(ride.offeredFare) : "—"}
                  </p>
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
              <Badge variant="outline" className={`text-[10px] font-bold uppercase ${svcClr(ride.type)}`}>
                {svcIcon(ride.type)} {svcName(ride.type)}
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

          {/* ── Journey Log (GPS milestones) ── */}
          <RideJourneyLog rideId={ride.id} />

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

/* ── Ride Journey Log Component ── */
const EVENT_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  accepted:         { label: "Ride Accepted",      icon: "✅", color: "text-green-700 bg-green-50 border-green-200"   },
  arrived:          { label: "Rider Arrived",      icon: "📍", color: "text-blue-700 bg-blue-50 border-blue-200"     },
  in_transit:       { label: "Ride Started",       icon: "🚀", color: "text-indigo-700 bg-indigo-50 border-indigo-200"},
  completed:        { label: "Ride Completed",     icon: "🏁", color: "text-purple-700 bg-purple-50 border-purple-200"},
  cancelled:        { label: "Ride Cancelled",     icon: "❌", color: "text-red-700 bg-red-50 border-red-200"         },
  order_store:      { label: "Going to Store",     icon: "🏪", color: "text-amber-700 bg-amber-50 border-amber-200"  },
  order_picked_up:  { label: "Order Picked Up",   icon: "📦", color: "text-blue-700 bg-blue-50 border-blue-200"     },
  order_delivered:  { label: "Order Delivered",   icon: "✅", color: "text-green-700 bg-green-50 border-green-200"   },
  order_cancelled:  { label: "Order Cancelled",   icon: "❌", color: "text-red-700 bg-red-50 border-red-200"         },
};

function RideJourneyLog({ rideId }: { rideId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["ride-event-logs", rideId],
    queryFn:  () => fetcher(`/rides/${rideId}/event-logs`),
    refetchInterval: 15_000,
    enabled: !!rideId,
  });

  const logs: any[] = data?.logs ?? [];

  if (isLoading) return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
      <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"/>
      Journey log lod ho raha hai...
    </div>
  );

  if (logs.length === 0) return (
    <div className="text-xs text-muted-foreground/60 italic py-1 text-center border border-dashed border-muted rounded-xl p-3">
      📡 Journey milestones yahan dikhenge jab rider GPS ke saath status update kare
    </div>
  );

  return (
    <div>
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
        <Navigation className="w-3 h-3" /> Journey Log ({logs.length} milestones)
      </p>
      <div className="space-y-2">
        {logs.map((log: any, i: number) => {
          const cfg = EVENT_CONFIG[log.event] ?? { label: log.event, icon: "📌", color: "text-gray-700 bg-gray-50 border-gray-200" };
          const ts  = new Date(log.createdAt);
          const timeStr = ts.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
          const dateStr = ts.toLocaleDateString("en-PK", { day: "numeric", month: "short" });
          return (
            <div key={log.id} className={`flex items-start gap-3 p-2.5 rounded-xl border ${cfg.color}`}>
              <div className="w-7 h-7 rounded-lg bg-white/70 flex items-center justify-center text-base shrink-0 shadow-sm border border-white">
                {cfg.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold">{cfg.label}</p>
                  <span className="text-[9px] font-mono shrink-0">{dateStr} {timeStr}</span>
                </div>
                {log.lat != null && log.lng != null ? (
                  <a
                    href={`https://www.google.com/maps?q=${log.lat},${log.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-mono flex items-center gap-0.5 hover:underline mt-0.5"
                  >
                    <MapPin className="w-2.5 h-2.5 shrink-0" />
                    {log.lat.toFixed(5)}, {log.lng.toFixed(5)}
                  </a>
                ) : (
                  <p className="text-[10px] opacity-50 mt-0.5">GPS unavailable at this moment</p>
                )}
              </div>
              {i < logs.length - 1 && (
                <div className="absolute left-[17px] mt-7 w-0.5 h-2 bg-current opacity-20" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   LOCATIONS MANAGER — "locations" tab
   ───────────────────────────────────────────────────────── */
function LocationsManager() {
  const { data, isLoading } = usePopularLocations();
  const createMut  = useCreateLocation();
  const updateMut  = useUpdateLocation();
  const deleteMut  = useDeleteLocation();
  const { toast }  = useToast();

  const [showForm, setShowForm] = useState(false);
  const [editing,  setEditing]  = useState<any>(null);
  const [form, setForm] = useState({ name: "", nameUrdu: "", lat: "", lng: "", category: "general", icon: "📍", sortOrder: "0", isActive: true });

  const locations = data?.locations || [];

  const CATEGORIES = ["chowk", "school", "hospital", "bazar", "park", "landmark", "general"];

  const openAdd = () => { setEditing(null); setForm({ name: "", nameUrdu: "", lat: "", lng: "", category: "general", icon: "📍", sortOrder: "0", isActive: true }); setShowForm(true); };
  const openEdit = (l: any) => { setEditing(l); setForm({ name: l.name, nameUrdu: l.nameUrdu || "", lat: String(l.lat), lng: String(l.lng), category: l.category, icon: l.icon, sortOrder: String(l.sortOrder), isActive: l.isActive }); setShowForm(true); };

  const handleSave = () => {
    if (!form.name || !form.lat || !form.lng) { toast({ title: "Name, Lat & Lng required", variant: "destructive" }); return; }
    const payload = { ...form, sortOrder: Number(form.sortOrder), lat: parseFloat(form.lat), lng: parseFloat(form.lng) };
    if (editing) {
      updateMut.mutate({ id: editing.id, ...payload }, {
        onSuccess: () => { toast({ title: "Location updated ✅" }); setShowForm(false); },
        onError: e => toast({ title: "Error", description: e.message, variant: "destructive" }),
      });
    } else {
      createMut.mutate(payload, {
        onSuccess: () => { toast({ title: "Location added ✅" }); setShowForm(false); },
        onError: e => toast({ title: "Error", description: e.message, variant: "destructive" }),
      });
    }
  };

  const handleToggle = (l: any) => {
    updateMut.mutate({ id: l.id, isActive: !l.isActive }, {
      onSuccess: () => toast({ title: `${l.isActive ? "Disabled" : "Enabled"} ✅` }),
    });
  };

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    deleteMut.mutate(id, {
      onSuccess: () => toast({ title: "Deleted ✅" }),
      onError: e => toast({ title: "Error", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Popular Locations</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Manage quick-pick stops shown in the customer app</p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" /> Add Location
        </button>
      </div>

      {isLoading ? (
        <Card className="p-8 rounded-2xl text-center"><p className="text-muted-foreground">Loading…</p></Card>
      ) : locations.length === 0 ? (
        <Card className="p-8 rounded-2xl text-center">
          <MapPin className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="font-semibold text-muted-foreground">No locations yet</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {locations.map((l: any) => (
            <Card key={l.id} className={`p-4 rounded-2xl border-2 transition-all ${l.isActive ? "border-border/50" : "border-dashed border-muted-foreground/30 opacity-60"}`}>
              <div className="flex items-start gap-3">
                <span className="text-2xl">{l.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm truncate">{l.name}</p>
                  {l.nameUrdu && <p className="text-xs text-muted-foreground" dir="rtl">{l.nameUrdu}</p>}
                  <p className="text-[10px] text-muted-foreground mt-1">{l.lat?.toFixed(4)}, {l.lng?.toFixed(4)}</p>
                  <span className="inline-block text-[10px] font-semibold bg-muted px-2 py-0.5 rounded-full mt-1 capitalize">{l.category}</span>
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  <button onClick={() => handleToggle(l)} className="text-muted-foreground hover:text-foreground transition-colors" title={l.isActive ? "Disable" : "Enable"}>
                    {l.isActive ? <ToggleRight className="w-5 h-5 text-green-500" /> : <ToggleLeft className="w-5 h-5" />}
                  </button>
                  <button onClick={() => openEdit(l)} className="text-muted-foreground hover:text-blue-600 transition-colors"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => handleDelete(l.id, l.name)} className="text-muted-foreground hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${l.isActive ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                  {l.isActive ? "Active" : "Inactive"}
                </span>
                <span className="text-[10px] text-muted-foreground">Order #{l.sortOrder}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Location" : "Add Location"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Name (English)</label>
                <Input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="Muzaffarabad Chowk" className="rounded-xl mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Name (Urdu)</label>
                <Input value={form.nameUrdu} onChange={e => setForm(f => ({...f, nameUrdu: e.target.value}))} placeholder="مظفرآباد چوک" dir="rtl" className="rounded-xl mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Latitude</label>
                <Input type="number" step="0.000001" value={form.lat} onChange={e => setForm(f => ({...f, lat: e.target.value}))} placeholder="34.3697" className="rounded-xl mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Longitude</label>
                <Input type="number" step="0.000001" value={form.lng} onChange={e => setForm(f => ({...f, lng: e.target.value}))} placeholder="73.4716" className="rounded-xl mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Category</label>
                <Select value={form.category} onValueChange={v => setForm(f => ({...f, category: v}))}>
                  <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Icon (emoji)</label>
                <Input value={form.icon} onChange={e => setForm(f => ({...f, icon: e.target.value}))} placeholder="📍" className="rounded-xl mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Sort Order</label>
                <Input type="number" value={form.sortOrder} onChange={e => setForm(f => ({...f, sortOrder: e.target.value}))} placeholder="0" className="rounded-xl mt-1" />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({...f, isActive: e.target.checked}))} className="w-4 h-4 rounded" />
              <span className="text-sm font-medium">Active (visible in customer app)</span>
            </label>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border text-sm font-medium hover:bg-muted transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}
                className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50">
                {editing ? "Save Changes" : "Add Location"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   SCHOOL ROUTES MANAGER — "school" tab
   ───────────────────────────────────────────────────────── */
function SchoolRoutesManager() {
  const { data: routesData, isLoading }  = useSchoolRoutes();
  const { data: subsData }               = useSchoolSubscriptions();
  const createMut  = useCreateSchoolRoute();
  const updateMut  = useUpdateSchoolRoute();
  const deleteMut  = useDeleteSchoolRoute();
  const { toast }  = useToast();

  const [showForm,   setShowForm]   = useState(false);
  const [showSubs,   setShowSubs]   = useState<any>(null); /* route whose subs to view */
  const [editing,    setEditing]    = useState<any>(null);
  const [activeTab,  setActiveTab]  = useState<"routes"|"subs">("routes");
  const [form, setForm] = useState({
    routeName: "", schoolName: "", schoolNameUrdu: "",
    fromArea: "", fromAreaUrdu: "", toAddress: "",
    monthlyPrice: "", morningTime: "7:30 AM", afternoonTime: "",
    capacity: "30", vehicleType: "school_shift",
    notes: "", isActive: true, sortOrder: "0",
  });

  const routes = routesData?.routes || [];
  const allSubs = subsData?.subscriptions || [];

  const openAdd = () => {
    setEditing(null);
    setForm({ routeName: "", schoolName: "", schoolNameUrdu: "", fromArea: "", fromAreaUrdu: "", toAddress: "", monthlyPrice: "", morningTime: "7:30 AM", afternoonTime: "", capacity: "30", vehicleType: "school_shift", notes: "", isActive: true, sortOrder: "0" });
    setShowForm(true);
  };
  const openEdit = (r: any) => {
    setEditing(r);
    setForm({
      routeName: r.routeName, schoolName: r.schoolName, schoolNameUrdu: r.schoolNameUrdu || "",
      fromArea: r.fromArea, fromAreaUrdu: r.fromAreaUrdu || "", toAddress: r.toAddress,
      monthlyPrice: String(r.monthlyPrice), morningTime: r.morningTime || "7:30 AM",
      afternoonTime: r.afternoonTime || "", capacity: String(r.capacity),
      vehicleType: r.vehicleType, notes: r.notes || "", isActive: r.isActive, sortOrder: String(r.sortOrder),
    });
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.routeName || !form.schoolName || !form.fromArea || !form.toAddress || !form.monthlyPrice) {
      toast({ title: "Route Name, School, From, To & Price required", variant: "destructive" }); return;
    }
    const payload = { ...form, sortOrder: Number(form.sortOrder), capacity: Number(form.capacity), monthlyPrice: parseFloat(form.monthlyPrice) };
    if (editing) {
      updateMut.mutate({ id: editing.id, ...payload }, {
        onSuccess: () => { toast({ title: "Route updated ✅" }); setShowForm(false); },
        onError: e => toast({ title: "Error", description: e.message, variant: "destructive" }),
      });
    } else {
      createMut.mutate(payload, {
        onSuccess: () => { toast({ title: "Route added ✅" }); setShowForm(false); },
        onError: e => toast({ title: "Error", description: e.message, variant: "destructive" }),
      });
    }
  };

  const handleToggle = (r: any) => {
    updateMut.mutate({ id: r.id, isActive: !r.isActive }, {
      onSuccess: () => toast({ title: `${r.isActive ? "Disabled" : "Enabled"} ✅` }),
    });
  };

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This will fail if active subscribers exist.`)) return;
    deleteMut.mutate(id, {
      onSuccess: () => toast({ title: "Deleted ✅" }),
      onError: e => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
    });
  };

  const routeSubs = showSubs ? allSubs.filter((s: any) => s.routeId === showSubs.id) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">School Shift Routes</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Monthly school transport subscriptions for students</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-border/60 overflow-hidden text-xs font-semibold">
            <button onClick={() => setActiveTab("routes")} className={`px-3 py-1.5 ${activeTab === "routes" ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted"} transition-colors`}>Routes</button>
            <button onClick={() => setActiveTab("subs")} className={`px-3 py-1.5 ${activeTab === "subs" ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted"} transition-colors`}>
              Subscriptions {allSubs.filter((s:any) => s.status === "active").length > 0 && <span className="ml-1 bg-green-500 text-white px-1.5 py-0.5 rounded-full text-[10px]">{allSubs.filter((s:any) => s.status === "active").length}</span>}
            </button>
          </div>
          {activeTab === "routes" && (
            <button onClick={openAdd} className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 transition-colors">
              <Plus className="w-4 h-4" /> Add Route
            </button>
          )}
        </div>
      </div>

      {/* Routes Tab */}
      {activeTab === "routes" && (
        isLoading ? (
          <Card className="p-8 rounded-2xl text-center"><p className="text-muted-foreground">Loading…</p></Card>
        ) : routes.length === 0 ? (
          <Card className="p-10 rounded-2xl text-center">
            <Bus className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-bold text-muted-foreground">No routes yet</p>
            <p className="text-xs text-muted-foreground mt-1">Add school routes for monthly student transport subscriptions</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {routes.map((r: any) => (
              <Card key={r.id} className={`p-4 rounded-2xl border-2 transition-all ${r.isActive ? "border-border/50" : "border-dashed border-muted-foreground/30 opacity-60"}`}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center shrink-0 text-lg">🚌</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm">{r.routeName}</p>
                    <p className="text-xs text-muted-foreground">{r.schoolName}</p>
                    {r.schoolNameUrdu && <p className="text-xs text-muted-foreground" dir="rtl">{r.schoolNameUrdu}</p>}
                    <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
                      <MapPin className="w-3 h-3" />{r.fromArea} → {r.toAddress}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <span className="text-xs font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">Rs. {r.monthlyPrice?.toLocaleString()}/month</span>
                      <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">🕗 {r.morningTime}</span>
                      {r.afternoonTime && <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">🕑 {r.afternoonTime}</span>}
                      <span className="text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                        <Users className="w-3 h-3 inline mr-0.5" />{r.enrolledCount}/{r.capacity}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button onClick={() => handleToggle(r)} title={r.isActive ? "Disable" : "Enable"}>
                      {r.isActive ? <ToggleRight className="w-5 h-5 text-green-500" /> : <ToggleLeft className="w-5 h-5 text-muted-foreground" />}
                    </button>
                    <button onClick={() => openEdit(r)} className="text-muted-foreground hover:text-blue-600 transition-colors"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(r.id, r.routeName)} className="text-muted-foreground hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border/50">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${r.isActive ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                    {r.isActive ? "Active" : "Inactive"}
                  </span>
                  <button onClick={() => { setShowSubs(r); setActiveTab("subs"); }}
                    className="text-[10px] text-blue-600 font-medium hover:underline ml-auto">
                    View subscribers →
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {/* Subscriptions Tab */}
      {activeTab === "subs" && (
        <div className="space-y-3">
          {showSubs && (
            <div className="flex items-center gap-2 text-sm font-medium bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
              <Bus className="w-4 h-4 text-blue-600" />
              Filtered by: <span className="font-bold text-blue-700">{showSubs.routeName}</span>
              <button onClick={() => setShowSubs(null)} className="ml-auto text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
          )}
          {allSubs.length === 0 ? (
            <Card className="p-10 rounded-2xl text-center">
              <GraduationCap className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-bold text-muted-foreground">No subscriptions yet</p>
            </Card>
          ) : (
            <Card className="rounded-2xl overflow-hidden border-border/50 shadow-sm">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead>Student</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Route</TableHead>
                      <TableHead>Monthly</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Next Billing</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(showSubs ? routeSubs : allSubs).map((s: any) => (
                      <TableRow key={s.id} className="hover:bg-muted/20">
                        <TableCell>
                          <p className="font-semibold text-sm">{s.studentName}</p>
                          <p className="text-xs text-muted-foreground">Class {s.studentClass}</p>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm">{s.userName || "—"}</p>
                          <p className="text-xs text-muted-foreground">{s.userPhone || "—"}</p>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm font-medium">{s.routeName || "—"}</p>
                          <p className="text-xs text-muted-foreground">{s.schoolName || "—"}</p>
                        </TableCell>
                        <TableCell className="font-bold text-green-700">Rs. {s.monthlyAmount?.toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge className={`text-xs ${s.status === "active" ? "bg-green-100 text-green-700 border-green-200" : "bg-muted text-muted-foreground"}`}>
                            {s.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {s.nextBillingDate ? new Date(s.nextBillingDate).toLocaleDateString() : "—"}
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

      {/* Add/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="rounded-2xl max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit School Route" : "Add School Route"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Route Name</label>
                <Input value={form.routeName} onChange={e => setForm(f => ({...f, routeName: e.target.value}))} placeholder="Muzaffarabad City → APS" className="rounded-xl mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">School Name</label>
                <Input value={form.schoolName} onChange={e => setForm(f => ({...f, schoolName: e.target.value}))} placeholder="Army Public School" className="rounded-xl mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">School Name (Urdu)</label>
                <Input value={form.schoolNameUrdu} onChange={e => setForm(f => ({...f, schoolNameUrdu: e.target.value}))} placeholder="آرمی پبلک اسکول" dir="rtl" className="rounded-xl mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">From Area</label>
                <Input value={form.fromArea} onChange={e => setForm(f => ({...f, fromArea: e.target.value}))} placeholder="Kohala Chowk" className="rounded-xl mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">From Area (Urdu)</label>
                <Input value={form.fromAreaUrdu} onChange={e => setForm(f => ({...f, fromAreaUrdu: e.target.value}))} placeholder="کوہالہ چوک" dir="rtl" className="rounded-xl mt-1" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground">School Address (To)</label>
                <Input value={form.toAddress} onChange={e => setForm(f => ({...f, toAddress: e.target.value}))} placeholder="APS Muzaffarabad, Near DHQ Hospital" className="rounded-xl mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Monthly Price (Rs.)</label>
                <Input type="number" value={form.monthlyPrice} onChange={e => setForm(f => ({...f, monthlyPrice: e.target.value}))} placeholder="3000" className="rounded-xl mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Morning Time</label>
                <Input value={form.morningTime} onChange={e => setForm(f => ({...f, morningTime: e.target.value}))} placeholder="7:30 AM" className="rounded-xl mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Afternoon Time</label>
                <Input value={form.afternoonTime} onChange={e => setForm(f => ({...f, afternoonTime: e.target.value}))} placeholder="2:00 PM" className="rounded-xl mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Capacity (students)</label>
                <Input type="number" value={form.capacity} onChange={e => setForm(f => ({...f, capacity: e.target.value}))} placeholder="30" className="rounded-xl mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Sort Order</label>
                <Input type="number" value={form.sortOrder} onChange={e => setForm(f => ({...f, sortOrder: e.target.value}))} placeholder="0" className="rounded-xl mt-1" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
              <Input value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} placeholder="AC van, door-to-door pickup" className="rounded-xl mt-1" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({...f, isActive: e.target.checked}))} className="w-4 h-4 rounded" />
              <span className="text-sm font-medium">Active (visible for customer subscriptions)</span>
            </label>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border text-sm font-medium hover:bg-muted transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}
                className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50">
                {editing ? "Save Changes" : "Add Route"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ────────────────────────────────────────────────────
   MAIN PAGE
   ──────────────────────────────────────────────────── */
type Tab = "live" | "active" | "history" | "services" | "locations" | "school";

/* ─────────────────────────────────────────────────────────
   SERVICE MANAGEMENT UI — shown in the "services" tab
   ───────────────────────────────────────────────────────── */
const EMPTY_FORM = { key: "", name: "", nameUrdu: "", icon: "🚗", description: "", color: "#6B7280", baseFare: "15", perKm: "8", minFare: "50", maxPassengers: "1", allowBargaining: true };

function ServiceManager() {
  const { data: svcData, isLoading: svcLoading } = useRideServices();
  const createMut = useCreateRideService();
  const updateMut = useUpdateRideService();
  const deleteMut = useDeleteRideService();
  const { toast } = useToast();
  const services: any[] = svcData?.services ?? [];

  const [showAdd,   setShowAdd]   = useState(false);
  const [editId,    setEditId]    = useState<string | null>(null);
  const [form,      setForm]      = useState({ ...EMPTY_FORM });
  const [delConfirm, setDelConfirm] = useState<string | null>(null);

  const resetForm = () => { setForm({ ...EMPTY_FORM }); setEditId(null); setShowAdd(false); };

  const startEdit = (svc: any) => {
    setForm({
      key: svc.key, name: svc.name, nameUrdu: svc.nameUrdu ?? "",
      icon: svc.icon, description: svc.description ?? "",
      color: svc.color ?? "#6B7280",
      baseFare: String(svc.baseFare), perKm: String(svc.perKm), minFare: String(svc.minFare),
      maxPassengers: String(svc.maxPassengers), allowBargaining: svc.allowBargaining,
    });
    setEditId(svc.id);
    setShowAdd(false);
  };

  const handleSubmit = async () => {
    const payload = {
      ...form,
      baseFare:      parseFloat(form.baseFare)      || 0,
      perKm:         parseFloat(form.perKm)         || 0,
      minFare:       parseFloat(form.minFare)        || 0,
      maxPassengers: parseInt(form.maxPassengers)    || 1,
    };
    try {
      if (editId) {
        await updateMut.mutateAsync({ id: editId, ...payload });
        toast({ title: "Service updated ✅" });
      } else {
        await createMut.mutateAsync(payload);
        toast({ title: "Service created ✅" });
      }
      resetForm();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const toggleEnabled = async (svc: any) => {
    try {
      await updateMut.mutateAsync({ id: svc.id, isEnabled: !svc.isEnabled });
      toast({ title: svc.isEnabled ? `${svc.name} disabled` : `${svc.name} enabled ✅` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const reorder = async (svc: any, dir: "up" | "down") => {
    const sorted = [...services].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex(s => s.id === svc.id);
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const other = sorted[swapIdx]!;
    await Promise.all([
      updateMut.mutateAsync({ id: svc.id,   sortOrder: other.sortOrder }),
      updateMut.mutateAsync({ id: other.id, sortOrder: svc.sortOrder   }),
    ]);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMut.mutateAsync(id);
      toast({ title: "Service deleted" });
      setDelConfirm(null);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const FormPanel = ({ isNew }: { isNew: boolean }) => (
    <Card className="p-5 rounded-2xl border-2 border-primary/20 bg-primary/5 space-y-4">
      <h3 className="font-bold text-base text-foreground">{isNew ? "Add Custom Service" : `Edit: ${form.name}`}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">Icon (Emoji)</label>
          <Input value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} placeholder="🚗" className="text-2xl" />
        </div>
        {isNew && (
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">Key (unique slug)</label>
            <Input value={form.key} onChange={e => setForm(f => ({ ...f, key: e.target.value.toLowerCase().replace(/\s+/g, "_") }))} placeholder="e.g. school_van" />
          </div>
        )}
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">Name (English)</label>
          <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="School Van" />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">نام (اردو)</label>
          <Input value={form.nameUrdu} onChange={e => setForm(f => ({ ...f, nameUrdu: e.target.value }))} placeholder="اسکول وین" className="text-right" dir="rtl" />
        </div>
        <div className={isNew ? "sm:col-span-2" : ""}>
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">Description</label>
          <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief description..." />
        </div>
      </div>
      <div className="border-t pt-4">
        <p className="text-xs font-bold text-muted-foreground mb-3 uppercase tracking-wide">💰 Fare Settings (Rs.)</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Base Fare", key: "baseFare", placeholder: "15" },
            { label: "Per Km",    key: "perKm",    placeholder: "8"  },
            { label: "Min Fare",  key: "minFare",  placeholder: "50" },
            { label: "Max Pax",   key: "maxPassengers", placeholder: "1" },
          ].map(f => (
            <div key={f.key}>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">{f.label}</label>
              <Input type="number" value={(form as any)[f.key]} onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.placeholder} />
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.allowBargaining} onChange={e => setForm(f => ({ ...f, allowBargaining: e.target.checked }))} className="w-4 h-4 rounded" />
          <span className="text-sm font-medium text-foreground">Allow Bargaining (Mol-Tol)</span>
        </label>
      </div>
      <div className="flex gap-3">
        <button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending}
          className="flex-1 bg-primary text-white font-bold py-2.5 rounded-xl hover:opacity-90 disabled:opacity-60 transition-opacity">
          {(createMut.isPending || updateMut.isPending) ? "Saving..." : (isNew ? "Create Service" : "Save Changes")}
        </button>
        <button onClick={resetForm} className="px-4 py-2.5 rounded-xl border border-border/60 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition-colors">
          Cancel
        </button>
      </div>
    </Card>
  );

  const sorted = [...services].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Ride Services Management</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Control which vehicle services customers can book. Changes take effect immediately.
          </p>
        </div>
        <button onClick={() => { setShowAdd(true); setEditId(null); setForm({ ...EMPTY_FORM }); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-bold hover:opacity-90 transition-opacity shrink-0">
          <Plus className="w-4 h-4" /> Add Custom Service
        </button>
      </div>

      {/* Add form */}
      {showAdd && !editId && <FormPanel isNew />}

      {svcLoading ? (
        <Card className="p-12 rounded-2xl text-center">
          <p className="text-muted-foreground">Loading services...</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {sorted.map((svc, idx) => (
            <Card key={svc.id} className={`rounded-2xl overflow-hidden transition-all border-2 ${svc.isEnabled ? "border-border/50" : "border-dashed border-border/30 opacity-60"}`}>
              {/* Color stripe */}
              <div className="h-1.5" style={{ backgroundColor: svc.color ?? "#6B7280" }} />

              <div className="p-4">
                {/* Top row */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shadow-sm border border-border/30" style={{ backgroundColor: svc.color ? `${svc.color}18` : "#6B728018" }}>
                      {svc.icon}
                    </div>
                    <div>
                      <p className="font-bold text-base text-foreground leading-tight">{svc.name}</p>
                      {svc.nameUrdu && <p className="text-xs text-muted-foreground font-medium" dir="rtl">{svc.nameUrdu}</p>}
                      <code className="text-[10px] text-muted-foreground/60 bg-muted/40 px-1 rounded">{svc.key}</code>
                    </div>
                  </div>
                  {/* Enabled toggle */}
                  <button onClick={() => toggleEnabled(svc)} disabled={updateMut.isPending}
                    className={`flex-shrink-0 p-1.5 rounded-xl transition-colors ${svc.isEnabled ? "text-green-600 bg-green-50 hover:bg-green-100" : "text-gray-400 bg-gray-100 hover:bg-gray-200"}`}>
                    {svc.isEnabled ? <ToggleRight className="w-6 h-6" /> : <ToggleLeft className="w-6 h-6" />}
                  </button>
                </div>

                {svc.description && <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{svc.description}</p>}

                {/* Pricing grid */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {[
                    { label: "Base", value: `Rs. ${svc.baseFare}` },
                    { label: "Per km", value: `Rs. ${svc.perKm}` },
                    { label: "Min fare", value: `Rs. ${svc.minFare}` },
                  ].map(f => (
                    <div key={f.label} className="bg-muted/30 rounded-xl p-2 text-center">
                      <p className="text-xs font-bold text-foreground">{f.value}</p>
                      <p className="text-[10px] text-muted-foreground">{f.label}</p>
                    </div>
                  ))}
                </div>

                {/* Badges */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                    👥 Max {svc.maxPassengers} pax
                  </span>
                  {svc.allowBargaining && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">
                      💬 Bargaining
                    </span>
                  )}
                  {!svc.isCustom && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                      🔒 Built-in
                    </span>
                  )}
                  {svc.isCustom && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                      ✨ Custom
                    </span>
                  )}
                </div>

                {/* Edit form (inline) */}
                {editId === svc.id && <FormPanel isNew={false} />}

                {/* Actions */}
                {editId !== svc.id && (
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <button onClick={() => reorder(svc, "up")} disabled={idx === 0 || updateMut.isPending}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-30 transition-colors">
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button onClick={() => reorder(svc, "down")} disabled={idx === sorted.length - 1 || updateMut.isPending}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-30 transition-colors">
                        <ChevronDown className="w-4 h-4" />
                      </button>
                    </div>
                    <button onClick={() => startEdit(svc)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-border/60 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                    {svc.isCustom && (
                      delConfirm === svc.id ? (
                        <div className="flex gap-1.5">
                          <button onClick={() => handleDelete(svc.id)} disabled={deleteMut.isPending}
                            className="px-3 py-2 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-60 transition-colors">
                            Delete
                          </button>
                          <button onClick={() => setDelConfirm(null)} className="px-3 py-2 rounded-xl border text-xs font-semibold hover:bg-muted/50 transition-colors">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setDelConfirm(svc.id)}
                          className="p-2 rounded-xl text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Rides() {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
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

  /* ── Live Riders (GPS positions) ── */
  const { data: liveRidersData } = useLiveRiders();
  const liveRiders: any[] = liveRidersData?.riders || [];
  const freshRiders = liveRiders.filter((r: any) => r.isFresh);

  /* ── Customer Locations (GPS at booking / order time) ── */
  const { data: custLocData } = useCustomerLocations();
  const customerLocs: any[] = custLocData?.customers || [];
  const freshCustomers = customerLocs.filter((c: any) => c.isFresh);

  /* ── Grouped Rides ── */
  const bargaining  = rides.filter((r: any) => r.status === "bargaining");
  const searching   = rides.filter((r: any) => r.status === "searching");
  const inProgress  = rides.filter((r: any) => ["accepted","arrived","in_transit"].includes(r.status));
  const completed   = rides.filter((r: any) => r.status === "completed");
  const cancelled   = rides.filter((r: any) => r.status === "cancelled");
  const liveRides   = [...bargaining, ...searching];

  /* ── Stats ── */
  const [, setLocation] = useLocation();
  const activeCount = bargaining.length + searching.length + inProgress.length;
  const totalRevenue = completed.reduce((s: number, r: any) => s + (r.counterFare ?? r.fare ?? 0), 0);

  /* ── History search filter ── */
  const q = search.toLowerCase();
  const historyFiltered = [...completed, ...cancelled].filter((r: any) =>
    r.id.toLowerCase().includes(q) ||
    (r.userName  || "").toLowerCase().includes(q) ||
    (r.userPhone || "").toLowerCase().includes(q) ||
    (r.riderName || "").toLowerCase().includes(q)
  );

  /* ── Actions ── */
  const handleUpdateStatus = (id: string, status: string, opts?: any) => {
    updateMutation.mutate({ id, status, ...opts }, {
      onSuccess: () => toast({ title: `Status → ${STATUS_LABELS[status]} ✅` }),
      onError: err => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
    });
  };

  const handleAssign = (id: string, name: string, phone: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      updateMutation.mutate({ id, status: "accepted", riderName: name, riderPhone: phone }, {
        onSuccess: () => {
          toast({ title: "Rider assigned & Accepted ✅" });
          setSelectedRide(null);
          resolve();
        },
        onError: err => {
          toast({ title: "Assignment failed", description: err.message, variant: "destructive" });
          reject(err);
        },
      });
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
              {isBargain ? "💬" : svcIcon(r.type)}
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
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">{T("ridesTitle")}</h1>
            <p className="text-muted-foreground text-xs">{rides.length} total · {rides.filter((r:any) => r.type === "bike").length} bike · {rides.filter((r:any) => r.type === "car").length} car</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`w-2 h-2 rounded-full ${secAgo < 35 ? "bg-green-500 animate-pulse" : "bg-amber-400"}`} />
            {isLoading ? "Refreshing..." : `Refreshed ${secAgo}s ago`}
          </span>
          <button
            onClick={() => setLocation("/settings?cat=rides")}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border/60 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <Settings2 className="w-3.5 h-3.5" />
            {T("ridesConfig")}
          </button>
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
              {liveRides.slice(0, 4).map((r: any) => `${svcIcon(r.type)} #${r.id.slice(-6).toUpperCase()}`).join(" · ")}
              {liveRides.length > 4 && ` +${liveRides.length - 4} more`}
            </p>
          </div>
          <button onClick={() => setTab("live")}
            className="px-3 py-1.5 bg-orange-500 text-white text-xs font-bold rounded-xl whitespace-nowrap hover:bg-orange-600 transition-colors">
            {T("ridesViewLive")}
          </button>
        </div>
      )}

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: T("ridesTotal"),      val: rides.length,          cls: "text-foreground", bg: "" },
          { label: T("ridesBargaining"), val: bargaining.length,     cls: "text-orange-600", bg: "bg-orange-50/60 border-orange-200/60" },
          { label: T("ridesSearching"),  val: searching.length,      cls: "text-amber-700",  bg: "bg-amber-50/60 border-amber-200/60"  },
          { label: T("activeNow"),       val: activeCount,            cls: "text-blue-700",   bg: "bg-blue-50/60 border-blue-200/60"    },
          { label: T("ridesCompleted"),  val: completed.length,      cls: "text-green-700",  bg: "bg-green-50/60 border-green-200/60"  },
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
            <p className="text-xs text-amber-500 font-medium">{T("ridesTotalRevenue")}</p>
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
        <TabBtn id="live"      icon={Zap}           label={T("ridesLive")}        count={liveRides.length}   urgent />
        <TabBtn id="active"    icon={Activity}      label={T("ridesInProgress")}  count={inProgress.length}         />
        <TabBtn id="history"   icon={History}       label={T("ridesHistory")}     count={completed.length + cancelled.length} />
        <TabBtn id="services"  icon={Layers}        label={T("ridesServices")}    count={0} />
        <TabBtn id="locations" icon={MapPin}        label={T("ridesStops")}       count={0} />
        <TabBtn id="school"    icon={GraduationCap} label={T("ridesSchoolShift")} count={0} />
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
              <p className="text-lg font-bold text-gray-700">{T("ridesAllQuiet")}</p>
              <p className="text-gray-400 text-sm mt-1">No rides need attention right now</p>
            </Card>
          )}

          {/* ── Live Riders GPS ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Navigation className="w-4 h-4 text-blue-500" />
              <h2 className="font-bold text-blue-700">{T("ridesLiveGPS")}</h2>
              {freshRiders.length > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                  {freshRiders.length} Active
                </span>
              )}
            </div>
            {liveRiders.length === 0 ? (
              <Card className="p-6 rounded-2xl border-border/50 text-center">
                <p className="text-2xl mb-2">📡</p>
                <p className="text-muted-foreground text-sm font-semibold">No GPS data yet</p>
                <p className="text-muted-foreground text-xs mt-1">Riders share location when online or on an active ride</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {liveRiders.map((r: any) => {
                  const age = r.ageSeconds < 60 ? `${r.ageSeconds}s ago` : r.ageSeconds < 3600 ? `${Math.floor(r.ageSeconds / 60)}m ago` : `${Math.floor(r.ageSeconds / 3600)}h ago`;
                  return (
                    <Card key={r.userId} className={`p-4 rounded-2xl border-2 ${r.isFresh ? "border-blue-200 bg-blue-50/40" : "border-dashed border-muted-foreground/30 opacity-60"}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-base shrink-0 ${r.isOnline ? "bg-green-500" : "bg-gray-400"}`}>
                          {r.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm truncate">{r.name}</p>
                          {r.phone && <p className="text-xs text-muted-foreground">{r.phone}</p>}
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${r.isOnline ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                              {r.isOnline ? "Online" : "Offline"}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${r.isFresh ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-400"}`}>
                              📡 {age}
                            </span>
                          </div>
                        </div>
                        <a
                          href={`https://www.google.com/maps?q=${r.lat},${r.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex flex-col items-center gap-0.5 text-blue-600 hover:text-blue-800 transition-colors shrink-0"
                          title="Open in Maps"
                        >
                          <MapPin className="w-4 h-4" />
                          <span className="text-[9px] font-mono">{r.lat.toFixed(3)},{r.lng.toFixed(3)}</span>
                        </a>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Active Customers GPS ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <User className="w-4 h-4 text-purple-500" />
              <h2 className="font-bold text-purple-700">{T("ridesCustomerGPS")}</h2>
              {freshCustomers.length > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                  {freshCustomers.length} Recent
                </span>
              )}
            </div>
            {customerLocs.length === 0 ? (
              <Card className="p-6 rounded-2xl border-border/50 text-center">
                <p className="text-2xl mb-2">👤</p>
                <p className="text-muted-foreground text-sm font-semibold">Abhi koi customer active nahi</p>
                <p className="text-muted-foreground text-xs mt-1">Ride book ya order place hone par customer ka GPS yahan dikhega</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {customerLocs.map((c: any) => {
                  const age = c.ageSeconds < 60
                    ? `${c.ageSeconds}s ago`
                    : c.ageSeconds < 3600
                      ? `${Math.floor(c.ageSeconds / 60)}m ago`
                      : `${Math.floor(c.ageSeconds / 3600)}h ago`;
                  const actionLabel: Record<string, string> = {
                    ride_booked:   "🛺 Ride",
                    order_placed:  "🛒 Order",
                  };
                  const actionDisplay = c.action ? (actionLabel[c.action] ?? c.action) : "📍 Activity";
                  return (
                    <Card key={c.userId} className={`p-4 rounded-2xl border-2 ${c.isFresh ? "border-purple-200 bg-purple-50/40" : "border-dashed border-muted-foreground/30 opacity-60"}`}>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-purple-500 text-white font-bold text-base shrink-0">
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm truncate">{c.name}</p>
                          {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
                              {actionDisplay}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${c.isFresh ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"}`}>
                              🕐 {age}
                            </span>
                          </div>
                        </div>
                        <a
                          href={`https://www.google.com/maps?q=${c.lat},${c.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex flex-col items-center gap-0.5 text-purple-600 hover:text-purple-800 transition-colors shrink-0"
                          title="Open in Maps"
                        >
                          <MapPin className="w-4 h-4" />
                          <span className="text-[9px] font-mono">{c.lat.toFixed(3)},{c.lng.toFixed(3)}</span>
                        </a>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
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
              <p className="text-lg font-bold text-gray-700">{T("ridesNoActiveRides")}</p>
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
                              <Badge variant="outline" className={`mt-0.5 text-[10px] font-bold uppercase ${svcClr(r.type)}`}>
                                {svcIcon(r.type)} {svcName(r.type)}
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
                          <div className="flex items-center gap-1.5">
                            <Select
                              value={r.status}
                              onValueChange={val => {
                                if (val === r.status || val === "cancelled") return;
                                if (!allowedNext(r).includes(val)) return;
                                handleUpdateStatus(r.id, val);
                              }}
                            >
                              <SelectTrigger className={`w-28 h-8 text-[10px] font-bold uppercase tracking-wider border-2 ${getStatusColor(r.status)}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {allowedNext(r).filter(s => s !== "cancelled").map(s => (
                                  <SelectItem key={s} value={s} className="text-xs uppercase font-bold">{STATUS_LABELS[s]}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <button
                              onClick={() => openRide(r)}
                              title="Open detail for cancel & more options"
                              className="h-8 w-8 flex items-center justify-center rounded-lg border border-border/50 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                            >
                              <AlertTriangle className="w-3.5 h-3.5" />
                            </button>
                          </div>
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
              <p className="text-xs text-green-500 mt-1">{T("ridesCompleted")}</p>
              <p className="text-sm font-bold text-green-600 mt-0.5">{formatCurrency(totalRevenue)}</p>
            </Card>
            <Card className="p-4 rounded-2xl border-border/50 shadow-sm bg-red-50/60 border-red-200/60 text-center">
              <p className="text-3xl font-bold text-red-700">{cancelled.length}</p>
              <p className="text-xs text-red-400 mt-1">{T("ridesCancelled")}</p>
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
                          <Badge variant="outline" className={`mt-1 text-[10px] font-bold uppercase ${svcClr(r.type)}`}>
                            {svcIcon(r.type)} {svcName(r.type)}
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

      {/* ══════════ TAB: SERVICES ══════════ */}
      {tab === "services" && <ServiceManager />}

      {/* ══════════ TAB: LOCATIONS ══════════ */}
      {tab === "locations" && <LocationsManager />}

      {/* ══════════ TAB: SCHOOL SHIFT ══════════ */}
      {tab === "school" && <SchoolRoutesManager />}

      {/* ── Ride Detail Modal ── */}
      {selectedRide && (
        <RideDetailModal
          ride={selectedRide}
          onClose={() => setSelectedRide(null)}
          onUpdateStatus={(id, status, opts) => {
            handleUpdateStatus(id, status, opts);
            setSelectedRide(null);
          }}
          onAssign={handleAssign}
        />
      )}
    </div>
  );
}
