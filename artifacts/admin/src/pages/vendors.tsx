import { useState, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Store, Search, RefreshCw, Wallet, TrendingUp, ShoppingBag,
  CheckCircle2, XCircle, Ban, CircleDollarSign, CreditCard,
  Package, Phone, ToggleLeft, ToggleRight, AlertTriangle, X, MessageCircle, Settings2,
  Download, CalendarDays, Percent, Truck, Gavel, Clock, Megaphone, Upload, Eye, Zap,
} from "lucide-react";
import { useLanguage } from "@/lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { PullToRefresh } from "@/components/PullToRefresh";
import { useVendors, useUpdateVendorStatus, useVendorPayout, useVendorCredit, usePlatformSettings, useVendorCommissionOverride, useOverrideSuspension, useDeliveryAccess, useAddWhitelistEntry, useDeleteWhitelistEntry, useDeliveryAccessRequests, useResolveDeliveryRequest, useVendorHours, useUpdateVendorHours, useVendorAnnouncement, useUpdateVendorAnnouncement, useUpdateVendorDeliveryTime, useVendorBulkUploads, useSetVendorAutoConfirm } from "@/hooks/use-admin";
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

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function VendorDetailModal({ vendor, onClose }: { vendor: any; onClose: () => void }) {
  const { toast } = useToast();
  const { data: hoursData, isLoading: hoursLoading } = useVendorHours(vendor.id);
  const updateHoursM = useUpdateVendorHours();
  const { data: annData, isLoading: annLoading } = useVendorAnnouncement(vendor.id);
  const updateAnnM = useUpdateVendorAnnouncement();
  const updateDeliveryM = useUpdateVendorDeliveryTime();
  const { data: uploadsData, isLoading: uploadsLoading } = useVendorBulkUploads(vendor.id);
  const autoConfirmM = useSetVendorAutoConfirm();
  const [autoConfirm, setAutoConfirm] = useState<boolean>(!!vendor.autoConfirm);

  const handleAutoConfirmToggle = (enabled: boolean) => {
    const prev = autoConfirm;
    setAutoConfirm(enabled);
    autoConfirmM.mutate({ id: vendor.id, enabled }, {
      onSuccess: () => toast({ title: enabled ? "Auto-confirm enabled" : "Auto-confirm disabled", description: enabled ? "Orders will skip vendor acceptance step" : "Vendor must manually accept orders" }),
      onError: (e: any) => { setAutoConfirm(prev); toast({ title: "Failed", description: e.message, variant: "destructive" }); },
    });
  };

  const [annText, setAnnText] = useState(vendor.storeAnnouncement || "");
  const [deliveryTime, setDeliveryTime] = useState(vendor.storeDeliveryTime || "");
  const [forceOpen, setForceOpen] = useState<boolean | null>(null);
  const [editingHours, setEditingHours] = useState(false);
  const [editHoursData, setEditHoursData] = useState<Record<string, { open: string; close: string; isOpen: boolean }>>({});

  const annSyncRef = useRef(false);
  useEffect(() => {
    if (!annSyncRef.current && annData && !annLoading) {
      setAnnText(annData.storeAnnouncement || "");
      annSyncRef.current = true;
    }
  }, [annData, annLoading]);

  const storeHours = hoursData?.storeHours;
  const storeIsOpen = forceOpen ?? hoursData?.storeIsOpen ?? vendor.storeIsOpen;
  const uploads: any[] = uploadsData?.uploads || [];

  const startEditingHours = () => {
    const init: Record<string, { open: string; close: string; isOpen: boolean }> = {};
    DAYS.forEach(d => {
      const key = d.toLowerCase();
      const entry = storeHours && typeof storeHours === "object"
        ? (Array.isArray(storeHours)
          ? storeHours.find((h: any) => (h.day || "").toLowerCase() === key)
          : storeHours[key] || storeHours[d])
        : null;
      init[key] = entry
        ? { open: entry.open || "09:00", close: entry.close || "21:00", isOpen: entry.isOpen !== false }
        : { open: "09:00", close: "21:00", isOpen: true };
    });
    setEditHoursData(init);
    setEditingHours(true);
  };

  const handleSaveHours = () => {
    const hoursObj: Record<string, { open: string; close: string; isOpen: boolean }> = {};
    DAYS.forEach(d => {
      const key = d.toLowerCase();
      hoursObj[key] = editHoursData[key] || { open: "09:00", close: "21:00", isOpen: true };
    });
    updateHoursM.mutate({ id: vendor.id, storeHours: hoursObj }, {
      onSuccess: () => { toast({ title: "Business hours updated" }); setEditingHours(false); },
      onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  const handleForceOpenClose = (open: boolean) => {
    const prev = forceOpen;
    setForceOpen(open);
    updateHoursM.mutate({ id: vendor.id, storeIsOpen: open }, {
      onSuccess: () => toast({ title: open ? "Store forced OPEN" : "Store forced CLOSED" }),
      onError: (e: any) => { setForceOpen(prev); toast({ title: "Failed", description: e.message, variant: "destructive" }); },
    });
  };

  const handleSaveAnnouncement = () => {
    updateAnnM.mutate({ id: vendor.id, storeAnnouncement: annText }, {
      onSuccess: () => toast({ title: "Announcement updated" }),
      onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  const handleSaveDeliveryTime = () => {
    updateDeliveryM.mutate({ id: vendor.id, storeDeliveryTime: deliveryTime }, {
      onSuccess: () => toast({ title: "Delivery time updated" }),
      onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-orange-500" /> {vendor.storeName || vendor.name} — Details
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5 mt-2">

          {/* Business Hours */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-2"><Clock className="w-4 h-4 text-blue-500" /> Business Hours</h3>
              <div className="flex items-center gap-2">
                {!editingHours && (
                  <Button size="sm" variant="outline" className="h-7 text-xs rounded-lg"
                    onClick={startEditingHours}>
                    Edit Hours
                  </Button>
                )}
                <Button size="sm" variant={storeIsOpen ? "default" : "outline"}
                  className={`h-7 text-xs rounded-lg ${storeIsOpen ? "bg-green-600 hover:bg-green-700 text-white" : ""}`}
                  onClick={() => handleForceOpenClose(true)} disabled={updateHoursM.isPending}>
                  <ToggleRight className="w-3 h-3 mr-1" /> Open
                </Button>
                <Button size="sm" variant={!storeIsOpen ? "destructive" : "outline"}
                  className="h-7 text-xs rounded-lg"
                  onClick={() => handleForceOpenClose(false)} disabled={updateHoursM.isPending}>
                  <ToggleLeft className="w-3 h-3 mr-1" /> Closed
                </Button>
              </div>
            </div>
            {hoursLoading ? (
              <div className="h-16 bg-muted animate-pulse rounded-xl" />
            ) : editingHours ? (
              <div className="space-y-2">
                {DAYS.map(d => {
                  const key = d.toLowerCase();
                  const entry = editHoursData[key] || { open: "09:00", close: "21:00", isOpen: true };
                  return (
                    <div key={key} className={`flex items-center gap-2 border rounded-lg px-3 py-2 text-xs ${entry.isOpen ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
                      <label className="flex items-center gap-1.5 min-w-[100px]">
                        <input type="checkbox" checked={entry.isOpen}
                          onChange={e => setEditHoursData(prev => ({ ...prev, [key]: { ...prev[key], isOpen: e.target.checked } }))}
                          className="rounded" />
                        <span className="font-semibold">{d}</span>
                      </label>
                      {entry.isOpen ? (
                        <div className="flex items-center gap-1 flex-1">
                          <input type="time" value={entry.open}
                            onChange={e => setEditHoursData(prev => ({ ...prev, [key]: { ...prev[key], open: e.target.value } }))}
                            className="border rounded px-2 py-1 text-xs bg-white" />
                          <span>–</span>
                          <input type="time" value={entry.close}
                            onChange={e => setEditHoursData(prev => ({ ...prev, [key]: { ...prev[key], close: e.target.value } }))}
                            className="border rounded px-2 py-1 text-xs bg-white" />
                        </div>
                      ) : (
                        <span className="text-red-500 text-xs">Closed</span>
                      )}
                    </div>
                  );
                })}
                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={handleSaveHours} disabled={updateHoursM.isPending} className="h-8 rounded-lg text-xs">
                    {updateHoursM.isPending ? "Saving..." : "Save Hours"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingHours(false)} className="h-8 rounded-lg text-xs">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : storeHours && typeof storeHours === "object" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(Array.isArray(storeHours) ? storeHours : DAYS.map(d => {
                  const entry = storeHours[d.toLowerCase()] || storeHours[d];
                  return entry ? { day: d, ...entry } : { day: d, open: "—", close: "—", isOpen: false };
                })).map((h: any, i: number) => (
                  <div key={i} className={`flex items-center justify-between border rounded-lg px-3 py-2 text-xs ${h.isOpen === false ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
                    <span className="font-semibold">{h.day || DAYS[i] || `Day ${i+1}`}</span>
                    <span>{h.isOpen === false ? "Closed" : `${h.open || "—"} – ${h.close || "—"}`}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground bg-muted/30 rounded-xl p-3">No business hours set by vendor</p>
            )}
          </div>

          {/* Store Announcement */}
          <div className="space-y-2 border-t border-border/40 pt-4">
            <h3 className="text-sm font-bold flex items-center gap-2"><Megaphone className="w-4 h-4 text-purple-500" /> Store Announcement</h3>
            <textarea
              className="w-full border rounded-xl p-3 text-sm h-20 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Store announcement text (leave empty to clear)..."
              value={annText}
              onChange={e => setAnnText(e.target.value)}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveAnnouncement} disabled={updateAnnM.isPending} className="h-8 rounded-lg text-xs">
                {updateAnnM.isPending ? "Saving..." : "Save Announcement"}
              </Button>
              {annText && (
                <Button size="sm" variant="outline" onClick={() => { setAnnText(""); updateAnnM.mutate({ id: vendor.id, storeAnnouncement: "" }, {
                  onSuccess: () => toast({ title: "Announcement cleared" }),
                  onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
                }); }} disabled={updateAnnM.isPending} className="h-8 rounded-lg text-xs border-red-200 text-red-600 hover:bg-red-50">
                  Clear
                </Button>
              )}
            </div>
          </div>

          {/* Delivery Time */}
          <div className="space-y-2 border-t border-border/40 pt-4">
            <h3 className="text-sm font-bold flex items-center gap-2"><Truck className="w-4 h-4 text-sky-500" /> Delivery Time</h3>
            <div className="flex items-center gap-2">
              <Input
                placeholder="e.g. 30-45 min"
                value={deliveryTime}
                onChange={e => setDeliveryTime(e.target.value)}
                className="h-10 rounded-xl flex-1"
              />
              <Button size="sm" onClick={handleSaveDeliveryTime} disabled={updateDeliveryM.isPending} className="h-10 rounded-lg text-xs">
                {updateDeliveryM.isPending ? "Saving..." : "Override"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Current: {vendor.storeDeliveryTime || "Not set"}</p>
          </div>

          {/* Auto-Confirm Toggle */}
          <div className="space-y-2 border-t border-border/40 pt-4">
            <h3 className="text-sm font-bold flex items-center gap-2"><Zap className="w-4 h-4 text-violet-500" /> Auto-Confirm Orders</h3>
            <div className="flex items-center justify-between rounded-xl border px-4 py-3 bg-muted/20">
              <div>
                <p className="text-sm font-medium">Skip Vendor Acceptance</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {autoConfirm ? "Orders placed to this vendor are auto-confirmed (no manual acceptance needed)" : "Vendor must manually accept each order (default behavior)"}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-4 shrink-0">
                <Button size="sm" variant={autoConfirm ? "default" : "outline"}
                  className={`h-7 text-xs rounded-lg ${autoConfirm ? "bg-violet-600 hover:bg-violet-700 text-white" : ""}`}
                  onClick={() => handleAutoConfirmToggle(true)}
                  disabled={autoConfirmM.isPending || autoConfirm}>
                  <ToggleRight className="w-3 h-3 mr-1" /> On
                </Button>
                <Button size="sm" variant={!autoConfirm ? "destructive" : "outline"}
                  className="h-7 text-xs rounded-lg"
                  onClick={() => handleAutoConfirmToggle(false)}
                  disabled={autoConfirmM.isPending || !autoConfirm}>
                  <ToggleLeft className="w-3 h-3 mr-1" /> Off
                </Button>
              </div>
            </div>
          </div>

          {/* Bulk Uploads History */}
          <div className="space-y-2 border-t border-border/40 pt-4">
            <h3 className="text-sm font-bold flex items-center gap-2"><Upload className="w-4 h-4 text-amber-500" /> Bulk Upload History</h3>
            {uploadsLoading ? (
              <div className="h-16 bg-muted animate-pulse rounded-xl" />
            ) : uploads.length === 0 ? (
              <p className="text-xs text-muted-foreground bg-muted/30 rounded-xl p-3">No bulk uploads recorded</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Date</th>
                      <th className="text-left px-3 py-2 font-semibold">File</th>
                      <th className="text-center px-3 py-2 font-semibold">Total</th>
                      <th className="text-center px-3 py-2 font-semibold">Success</th>
                      <th className="text-center px-3 py-2 font-semibold">Failed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {uploads.slice(0, 20).map((u: any) => (
                      <tr key={u.id} className="hover:bg-muted/30">
                        <td className="px-3 py-2">{formatDate(u.createdAt)}</td>
                        <td className="px-3 py-2 truncate max-w-[120px]">{u.fileName || "—"}</td>
                        <td className="px-3 py-2 text-center">{u.totalRows}</td>
                        <td className="px-3 py-2 text-center text-green-600 font-semibold">{u.successCount}</td>
                        <td className="px-3 py-2 text-center text-red-600 font-semibold">{u.failCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
  const [detailModal,  setDetailModal]  = useState<any>(null);

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
                    <Button size="sm" variant="outline" onClick={() => setDetailModal(v)}
                      className="h-9 rounded-xl gap-1.5 text-xs border-blue-200 text-blue-700 hover:bg-blue-50">
                      <Eye className="w-3.5 h-3.5" /> Manage
                    </Button>
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
      {detailModal  && <VendorDetailModal vendor={detailModal} onClose={() => setDetailModal(null)} />}
    </PullToRefresh>
  );
}
