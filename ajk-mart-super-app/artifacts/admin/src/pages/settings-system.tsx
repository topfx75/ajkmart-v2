import { useState, useEffect } from "react";
import {
  Database, Download, Upload, Trash2, HardDrive, RefreshCcw,
  FlaskConical, RotateCcw, Clock, AlertTriangle, Settings,
  Loader2, X, RefreshCw, Plus, UserPlus,
  ShoppingCart, Tag, Zap, ChevronDown, ChevronUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type PendingUndo = { id: string; label: string; expiresAt: string; actionId: string };

function fmtCountdown(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return "00:00";
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

type CustomFormType = "user" | "product" | "order" | "promo" | "banner" | null;

export function SystemSection() {
  const { toast } = useToast();
  const adminSecret = localStorage.getItem("ajkmart_admin_token") || "";

  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pendingUndos, setPendingUndos] = useState<PendingUndo[]>([]);
  const [undoLoading, setUndoLoading] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const [confirmDialog, setConfirmDialog] = useState<{ type: "remove" | "demo"; } | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const [customFormOpen, setCustomFormOpen] = useState<CustomFormType>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [formLoading, setFormLoading] = useState(false);

  const [showOldActions, setShowOldActions] = useState(false);

  useEffect(() => {
    const t = setInterval(() => {
      const ts = Date.now();
      setNow(ts);
      setPendingUndos(prev => prev.filter(u => new Date(u.expiresAt).getTime() > ts));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const apiFetch = async (path: string, opts?: RequestInit) => {
    const res = await fetch(`/api/admin/system${path}`, {
      ...opts,
      headers: { "x-admin-token": adminSecret, "Content-Type": "application/json", ...(opts?.headers || {}) },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  };

  const loadStats = async () => {
    setStatsLoading(true);
    try {
      const data = await apiFetch("/stats");
      setStats(data.stats);
    } catch (e: any) {
      toast({ title: "Failed to load DB stats", description: e.message, variant: "destructive" });
    }
    setStatsLoading(false);
  };

  useEffect(() => {
    loadStats();
    apiFetch("/snapshots").then(data => {
      if (data?.snapshots?.length) {
        setPendingUndos(data.snapshots.map((s: any) => ({
          id: s.id, label: s.label, expiresAt: s.expiresAt, actionId: s.actionId,
        })));
      }
    }).catch(() => {});
  }, []);

  const addUndoFromResponse = (data: any, label: string) => {
    if (data.snapshotId) {
      setPendingUndos(prev => [
        { id: data.snapshotId, label, expiresAt: data.expiresAt, actionId: data.snapshotId },
        ...prev,
      ]);
    }
  };

  const handleRemoveAll = async () => {
    setActionLoading("remove-all");
    try {
      const data = await apiFetch("/remove-all", { method: "POST" });
      toast({ title: "All data removed", description: "You have 30 minutes to undo this action." });
      addUndoFromResponse(data, "Remove All Data");
      await loadStats();
    } catch (e: any) {
      toast({ title: "Remove failed", description: e.message, variant: "destructive" });
    }
    setActionLoading(null);
    setConfirmDialog(null);
    setConfirmText("");
  };

  const handleSeedDemo = async () => {
    setActionLoading("seed-demo");
    try {
      const data = await apiFetch("/seed-demo", { method: "POST" });
      toast({ title: "Demo data loaded!", description: "Full realistic demo content populated." });
      addUndoFromResponse(data, "Load Demo Data");
      await loadStats();
    } catch (e: any) {
      toast({ title: "Seed failed", description: e.message, variant: "destructive" });
    }
    setActionLoading(null);
    setConfirmDialog(null);
    setConfirmText("");
  };

  const handleUndo = async (undo: PendingUndo) => {
    setUndoLoading(undo.id);
    try {
      const data = await apiFetch(`/undo/${undo.id}`, { method: "POST" });
      toast({ title: "Undo complete", description: data.message });
      setPendingUndos(prev => prev.filter(u => u.id !== undo.id));
      await loadStats();
    } catch (e: any) {
      toast({ title: "Undo failed", description: e.message, variant: "destructive" });
      setPendingUndos(prev => prev.filter(u => u.id !== undo.id));
    }
    setUndoLoading(null);
  };

  const handleDismissUndo = async (id: string) => {
    try { await apiFetch(`/snapshots/${id}`, { method: "DELETE" }); } catch {}
    setPendingUndos(prev => prev.filter(u => u.id !== id));
    toast({ title: "Action confirmed permanent", description: "Undo snapshot discarded." });
  };

  const handleBackup = async () => {
    setActionLoading("backup");
    try {
      const res = await fetch("/api/admin/system/backup", { headers: { "x-admin-token": adminSecret } });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ajkmart-backup-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Backup downloaded", description: "Full database exported as JSON" });
    } catch (e: any) {
      toast({ title: "Backup failed", description: e.message, variant: "destructive" });
    }
    setActionLoading(null);
  };

  const handleRestore = async (file: File) => {
    setRestoreError(null);
    setActionLoading("restore");
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (!json.tables) throw new Error("Invalid backup file — missing 'tables' key");
      const data = await apiFetch("/restore", { method: "POST", body: JSON.stringify(json) });
      toast({ title: "Restore complete", description: "You have 30 minutes to undo this." });
      addUndoFromResponse(data, "Import Restore");
      await loadStats();
    } catch (e: any) {
      setRestoreError(e.message);
      toast({ title: "Restore failed", description: e.message, variant: "destructive" });
    }
    setActionLoading(null);
  };

  const handleOldAction = async (endpoint: string, label: string) => {
    setActionLoading(endpoint);
    try {
      const data = await apiFetch(endpoint, { method: "POST" });
      toast({ title: `${label} — done`, description: "You have 30 minutes to undo this action." });
      addUndoFromResponse(data, label);
      await loadStats();
    } catch (e: any) {
      toast({ title: `${label} failed`, description: e.message, variant: "destructive" });
    }
    setActionLoading(null);
  };

  const handleCustomFormSubmit = async () => {
    if (!customFormOpen) return;
    setFormLoading(true);
    try {
      let endpoint = "";
      let body: any = {};

      if (customFormOpen === "user") {
        if (!formData.name?.trim() && !formData.phone?.trim()) {
          toast({ title: "Validation", description: "Name or phone is required", variant: "destructive" });
          setFormLoading(false);
          return;
        }
        endpoint = "/api/admin/users";
        body = {
          phone: formData.phone?.trim() || "",
          name: formData.name?.trim() || "",
          role: formData.role || "customer",
          city: formData.city?.trim() || "Muzaffarabad",
        };
      } else if (customFormOpen === "product") {
        if (!formData.name?.trim()) {
          toast({ title: "Validation", description: "Product name is required", variant: "destructive" });
          setFormLoading(false);
          return;
        }
        const price = Number(formData.price);
        if (!price || price <= 0) {
          toast({ title: "Validation", description: "Price must be a positive number", variant: "destructive" });
          setFormLoading(false);
          return;
        }
        endpoint = "/api/admin/products";
        body = {
          name: formData.name.trim(),
          price: price.toString(),
          category: formData.category?.trim() || "fruits",
          type: formData.type || "mart",
          description: formData.description?.trim() || "",
          unit: formData.unit?.trim() || "1 pc",
        };
      } else if (customFormOpen === "order") {
        if (!formData.userId?.trim()) {
          toast({ title: "Validation", description: "User ID is required", variant: "destructive" });
          setFormLoading(false);
          return;
        }
        const total = Number(formData.total);
        if (!total || total <= 0) {
          toast({ title: "Validation", description: "Total must be a positive number", variant: "destructive" });
          setFormLoading(false);
          return;
        }
        endpoint = "/api/admin/orders";
        body = {
          userId: formData.userId.trim(),
          vendorId: formData.vendorId?.trim() || formData.userId.trim(),
          type: formData.type || "mart",
          total: total.toString(),
          deliveryAddress: formData.deliveryAddress?.trim() || "Admin-created order",
          paymentMethod: formData.paymentMethod || "cod",
        };
      } else if (customFormOpen === "promo") {
        if (!formData.code?.trim()) {
          toast({ title: "Validation", description: "Promo code is required", variant: "destructive" });
          setFormLoading(false);
          return;
        }
        if (!formData.discountPct && !formData.discountFlat) {
          toast({ title: "Validation", description: "Either discount % or flat amount is required", variant: "destructive" });
          setFormLoading(false);
          return;
        }
        endpoint = "/api/admin/promo-codes";
        body = {
          code: formData.code.trim().toUpperCase(),
          description: formData.description?.trim() || "",
          discountPct: formData.discountPct ? Number(formData.discountPct).toString() : undefined,
          discountFlat: formData.discountFlat ? Number(formData.discountFlat).toString() : undefined,
          minOrderAmount: formData.minOrderAmount || "0",
          appliesTo: formData.appliesTo || "all",
        };
      } else if (customFormOpen === "banner") {
        if (!formData.title?.trim()) {
          toast({ title: "Validation", description: "Banner title is required", variant: "destructive" });
          setFormLoading(false);
          return;
        }
        endpoint = "/api/admin/banners";
        body = {
          title: formData.title.trim(),
          subtitle: formData.subtitle?.trim() || "",
          colorFrom: formData.colorFrom || "#7C3AED",
          colorTo: formData.colorTo || "#4F46E5",
          placement: formData.placement || "home",
        };
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "x-admin-token": adminSecret, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create");

      toast({ title: `${customFormOpen} created`, description: `New ${customFormOpen} has been added.` });
      setCustomFormOpen(null);
      setFormData({});
      await loadStats();
    } catch (e: any) {
      toast({ title: "Creation failed", description: e.message, variant: "destructive" });
    }
    setFormLoading(false);
  };

  const STAT_ITEMS = [
    { key: "users",          label: "Users",           icon: "👤", color: "bg-blue-50 border-blue-200 text-blue-700" },
    { key: "orders",         label: "Orders",          icon: "🛒", color: "bg-orange-50 border-orange-200 text-orange-700" },
    { key: "rides",          label: "Rides",           icon: "🚗", color: "bg-teal-50 border-teal-200 text-teal-700" },
    { key: "pharmacy",       label: "Pharmacy",        icon: "💊", color: "bg-green-50 border-green-200 text-green-700" },
    { key: "parcel",         label: "Parcels",         icon: "📦", color: "bg-amber-50 border-amber-200 text-amber-700" },
    { key: "products",       label: "Products",        icon: "🏪", color: "bg-violet-50 border-violet-200 text-violet-700" },
    { key: "walletTx",       label: "Wallet Txns",     icon: "💳", color: "bg-indigo-50 border-indigo-200 text-indigo-700" },
    { key: "reviews",        label: "Reviews",         icon: "⭐", color: "bg-yellow-50 border-yellow-200 text-yellow-700" },
    { key: "notifications",  label: "Notifications",   icon: "🔔", color: "bg-pink-50 border-pink-200 text-pink-700" },
    { key: "promos",         label: "Promo Codes",     icon: "🎫", color: "bg-rose-50 border-rose-200 text-rose-700" },
    { key: "flashDeals",     label: "Flash Deals",     icon: "⚡", color: "bg-sky-50 border-sky-200 text-sky-700" },
    { key: "banners",        label: "Banners",         icon: "🖼️", color: "bg-purple-50 border-purple-200 text-purple-700" },
    { key: "vendorProfiles", label: "Vendor Profiles", icon: "🏬", color: "bg-emerald-50 border-emerald-200 text-emerald-700" },
    { key: "riderProfiles",  label: "Rider Profiles",  icon: "🏍️", color: "bg-cyan-50 border-cyan-200 text-cyan-700" },
    { key: "serviceZones",   label: "Service Zones",   icon: "📍", color: "bg-lime-50 border-lime-200 text-lime-700" },
    { key: "savedAddresses", label: "Saved Addresses", icon: "📌", color: "bg-slate-50 border-slate-200 text-slate-700" },
    { key: "settings",       label: "Settings",        icon: "⚙️", color: "bg-slate-50 border-slate-200 text-slate-700" },
    { key: "adminAccounts",  label: "Admin Accounts",  icon: "🛡️", color: "bg-red-50 border-red-200 text-red-700" },
  ];

  const CUSTOM_FORM_OPTIONS: { key: CustomFormType; label: string; icon: any; color: string }[] = [
    { key: "user",    label: "User",    icon: <UserPlus size={14} />,     color: "text-blue-600 bg-blue-50 border-blue-200" },
    { key: "product", label: "Product", icon: <ShoppingCart size={14} />, color: "text-violet-600 bg-violet-50 border-violet-200" },
    { key: "order",   label: "Order",   icon: <ShoppingCart size={14} />, color: "text-green-600 bg-green-50 border-green-200" },
    { key: "promo",   label: "Promo Code",  icon: <Tag size={14} />,     color: "text-rose-600 bg-rose-50 border-rose-200" },
    { key: "banner",  label: "Banner",  icon: <Zap size={14} />,         color: "text-amber-600 bg-amber-50 border-amber-200" },
  ];

  const renderFormField = (label: string, field: string, opts?: { type?: string; placeholder?: string; options?: { value: string; label: string }[] }) => (
    <div key={field}>
      <label className="text-[11px] font-semibold text-slate-600 mb-1 block">{label}</label>
      {opts?.options ? (
        <select
          value={formData[field] || opts.options[0]?.value || ""}
          onChange={e => setFormData(prev => ({ ...prev, [field]: e.target.value }))}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          {opts.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input
          type={opts?.type || "text"}
          value={formData[field] || ""}
          onChange={e => setFormData(prev => ({ ...prev, [field]: e.target.value }))}
          placeholder={opts?.placeholder || ""}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      )}
    </div>
  );

  const renderCustomForm = () => {
    if (!customFormOpen) return null;

    let fields: JSX.Element[] = [];
    if (customFormOpen === "user") {
      fields = [
        renderFormField("Name", "name", { placeholder: "Ahmed Khan" }),
        renderFormField("Phone", "phone", { placeholder: "+923001234000" }),
        renderFormField("Role", "role", { options: [{ value: "customer", label: "Customer" }, { value: "rider", label: "Rider" }, { value: "vendor", label: "Vendor" }] }),
        renderFormField("City", "city", { placeholder: "Muzaffarabad" }),
      ];
    } else if (customFormOpen === "product") {
      fields = [
        renderFormField("Name", "name", { placeholder: "Basmati Rice 5kg" }),
        renderFormField("Price (Rs.)", "price", { type: "number", placeholder: "980" }),
        renderFormField("Type", "type", { options: [{ value: "mart", label: "Mart" }, { value: "food", label: "Food" }, { value: "pharmacy", label: "Pharmacy" }] }),
        renderFormField("Category", "category", { placeholder: "fruits" }),
        renderFormField("Unit", "unit", { placeholder: "1kg" }),
        renderFormField("Description", "description", { placeholder: "Premium quality..." }),
      ];
    } else if (customFormOpen === "order") {
      fields = [
        renderFormField("User ID", "userId", { placeholder: "demo_cust_1" }),
        renderFormField("Vendor ID", "vendorId", { placeholder: "demo_vend_1" }),
        renderFormField("Type", "type", { options: [{ value: "mart", label: "Mart" }, { value: "food", label: "Food" }] }),
        renderFormField("Total (Rs.)", "total", { type: "number", placeholder: "500" }),
        renderFormField("Delivery Address", "deliveryAddress", { placeholder: "Upper Adda, Muzaffarabad" }),
        renderFormField("Payment Method", "paymentMethod", { options: [{ value: "cod", label: "Cash on Delivery" }, { value: "wallet", label: "Wallet" }, { value: "jazzcash", label: "JazzCash" }, { value: "easypaisa", label: "EasyPaisa" }] }),
      ];
    } else if (customFormOpen === "promo") {
      fields = [
        renderFormField("Code", "code", { placeholder: "WELCOME50" }),
        renderFormField("Description", "description", { placeholder: "50% off first order" }),
        renderFormField("Discount %", "discountPct", { type: "number", placeholder: "50" }),
        renderFormField("Discount Flat (Rs.)", "discountFlat", { type: "number", placeholder: "100" }),
        renderFormField("Min Order (Rs.)", "minOrderAmount", { type: "number", placeholder: "200" }),
        renderFormField("Applies To", "appliesTo", { options: [{ value: "all", label: "All" }, { value: "mart", label: "Mart" }, { value: "food", label: "Food" }, { value: "ride", label: "Rides" }] }),
      ];
    } else if (customFormOpen === "banner") {
      fields = [
        renderFormField("Title", "title", { placeholder: "Free Delivery" }),
        renderFormField("Subtitle", "subtitle", { placeholder: "On orders above Rs. 500" }),
        renderFormField("Color From", "colorFrom", { placeholder: "#7C3AED" }),
        renderFormField("Color To", "colorTo", { placeholder: "#4F46E5" }),
        renderFormField("Placement", "placement", { options: [{ value: "home", label: "Home" }, { value: "mart", label: "Mart" }, { value: "food", label: "Food" }] }),
      ];
    }

    return (
      <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-sm text-slate-800">Add {customFormOpen}</p>
          <button onClick={() => { setCustomFormOpen(null); setFormData({}); }} className="p-1 rounded-lg hover:bg-slate-100">
            <X size={14} className="text-slate-400" />
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {fields}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={() => { setCustomFormOpen(null); setFormData({}); }}
            className="px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={handleCustomFormSubmit} disabled={formLoading}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 flex items-center gap-2">
            {formLoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {formLoading ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">

      {pendingUndos.length > 0 && (
        <div className="space-y-2">
          {pendingUndos.map(undo => {
            const countdown = fmtCountdown(undo.expiresAt, now);
            const urgentMs  = new Date(undo.expiresAt).getTime() - now;
            const isUrgent  = urgentMs < 5 * 60 * 1000;
            return (
              <div key={undo.id}
                className={`rounded-xl border-2 p-3 flex items-center gap-3 transition-all
                  ${isUrgent
                    ? "bg-red-50 border-red-300 animate-pulse"
                    : "bg-amber-50 border-amber-300"}`}>
                <div className={`flex items-center gap-1.5 shrink-0 font-mono text-sm font-bold tabular-nums
                  ${isUrgent ? "text-red-600" : "text-amber-700"}`}>
                  <Clock size={14} className={isUrgent ? "text-red-500" : "text-amber-500"} />
                  {countdown}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold truncate ${isUrgent ? "text-red-800" : "text-amber-800"}`}>
                    "{undo.label}" — undo available
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Snapshot saved before this action. Tap Undo to reverse it completely.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleUndo(undo)}
                    disabled={undoLoading === undo.id || !!actionLoading}
                    className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all">
                    {undoLoading === undo.id
                      ? <Loader2 size={11} className="animate-spin" />
                      : <RotateCcw size={11} />}
                    Undo
                  </button>
                  <button
                    onClick={() => handleDismissUndo(undo.id)}
                    disabled={undoLoading === undo.id}
                    title="Dismiss — make this action permanent"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white/60 transition-all">
                    <X size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-gradient-to-br from-slate-50 to-white p-5">
        <div className="flex items-center gap-2 mb-4">
          <Database size={16} className="text-slate-600" />
          <p className="font-bold text-base text-slate-800">Data Management</p>
          <p className="text-[11px] text-slate-400 flex items-center gap-1 ml-auto">
            <Clock size={10} /> All actions create undo snapshots for 30 min
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            onClick={() => { setConfirmDialog({ type: "remove" }); setConfirmText(""); }}
            disabled={!!actionLoading}
            className="group relative flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-red-200 bg-red-50 hover:bg-red-100 hover:border-red-300 transition-all disabled:opacity-50"
          >
            <div className="w-12 h-12 rounded-xl bg-red-100 group-hover:bg-red-200 flex items-center justify-center transition-all">
              <Trash2 size={22} className="text-red-600" />
            </div>
            <p className="font-bold text-sm text-red-800">Remove All</p>
            <p className="text-[10px] text-red-600 text-center leading-tight">
              Wipe all data (users, orders, products...). Admin accounts & settings preserved.
            </p>
          </button>

          <button
            onClick={() => { setConfirmDialog({ type: "demo" }); setConfirmText(""); }}
            disabled={!!actionLoading}
            className="group relative flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-300 transition-all disabled:opacity-50"
          >
            {actionLoading === "seed-demo" && (
              <div className="absolute inset-0 rounded-xl bg-white/60 flex items-center justify-center z-10">
                <Loader2 size={24} className="animate-spin text-emerald-600" />
              </div>
            )}
            <div className="w-12 h-12 rounded-xl bg-emerald-100 group-hover:bg-emerald-200 flex items-center justify-center transition-all">
              <FlaskConical size={22} className="text-emerald-600" />
            </div>
            <p className="font-bold text-sm text-emerald-800">Load Demo Data</p>
            <p className="text-[10px] text-emerald-600 text-center leading-tight">
              Populate with 22 users, 38+ products, 24 orders, 15 rides, reviews & more.
            </p>
          </button>

          <button
            onClick={() => { setCustomFormOpen(customFormOpen ? null : "user"); setFormData({}); }}
            disabled={!!actionLoading}
            className="group relative flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-blue-200 bg-blue-50 hover:bg-blue-100 hover:border-blue-300 transition-all disabled:opacity-50"
          >
            <div className="w-12 h-12 rounded-xl bg-blue-100 group-hover:bg-blue-200 flex items-center justify-center transition-all">
              <Plus size={22} className="text-blue-600" />
            </div>
            <p className="font-bold text-sm text-blue-800">Add Custom Data</p>
            <p className="text-[10px] text-blue-600 text-center leading-tight">
              Manually add individual users, products, promo codes or banners.
            </p>
          </button>
        </div>
      </div>

      {customFormOpen && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {CUSTOM_FORM_OPTIONS.map(opt => (
              <button
                key={opt.key}
                onClick={() => { setCustomFormOpen(opt.key); setFormData({}); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  customFormOpen === opt.key
                    ? opt.color + " shadow-sm"
                    : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
          </div>
          {renderCustomForm()}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <HardDrive size={15} className="text-slate-500" />
            <p className="font-semibold text-sm text-slate-700">Database Overview</p>
            {!statsLoading && stats && (
              <span className="text-[10px] text-slate-400 font-mono bg-slate-100 px-1.5 py-0.5 rounded">
                {Object.values(stats).reduce((a, b) => a + b, 0).toLocaleString()} total rows
              </span>
            )}
          </div>
          <button onClick={loadStats} disabled={statsLoading}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg hover:bg-slate-100 transition-all">
            <RefreshCw size={11} className={statsLoading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
        {statsLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Array(8).fill(0).map((_,i) => (
              <div key={i} className="h-14 rounded-xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {STAT_ITEMS.map(item => (
              <div key={item.key} className={`rounded-xl border p-3 flex items-center gap-2.5 ${item.color}`}>
                <span className="text-lg shrink-0">{item.icon}</span>
                <div>
                  <p className="text-lg font-extrabold leading-none">{(stats?.[item.key] ?? 0).toLocaleString()}</p>
                  <p className="text-[10px] font-medium opacity-70 mt-0.5">{item.label}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <HardDrive size={15} className="text-slate-500" />
          <p className="font-semibold text-sm text-slate-700">Backup & Restore</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="border border-green-200 bg-green-50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Download size={16} className="text-green-700" />
              <p className="font-semibold text-sm text-green-800">Export Backup</p>
            </div>
            <p className="text-[11px] text-green-700 mb-4">Downloads the full database as a JSON file.</p>
            <button onClick={handleBackup} disabled={actionLoading === "backup"}
              className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2 rounded-lg transition-all disabled:opacity-60">
              {actionLoading === "backup" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {actionLoading === "backup" ? "Exporting..." : "Download Backup (.json)"}
            </button>
          </div>

          <div className="border border-blue-200 bg-blue-50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Upload size={16} className="text-blue-700" />
              <p className="font-semibold text-sm text-blue-800">Import Restore</p>
            </div>
            <p className="text-[11px] text-blue-700 mb-3">Upload a previously exported backup JSON file. Undo available for 30 min.</p>
            {restoreError && (
              <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg p-2 mb-2 flex items-start gap-1.5">
                <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                {restoreError}
              </div>
            )}
            <label className={`w-full flex items-center justify-center gap-2 text-sm font-semibold py-2 rounded-lg transition-all cursor-pointer border-2 border-dashed
              ${actionLoading === "restore" ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed" : "bg-white text-blue-700 border-blue-300 hover:border-blue-500 hover:bg-blue-100"}`}>
              {actionLoading === "restore" ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {actionLoading === "restore" ? "Restoring..." : "Upload Backup File"}
              <input type="file" accept=".json" className="hidden" disabled={!!actionLoading}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleRestore(f); e.target.value = ""; }} />
            </label>
          </div>
        </div>
      </div>

      <div>
        <button
          onClick={() => setShowOldActions(!showOldActions)}
          className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-700 mb-2"
        >
          {showOldActions ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          <span className="font-semibold">Advanced Reset Actions</span>
        </button>

        {showOldActions && (
          <div className="space-y-2 mt-2">
            {[
              { endpoint: "/reset-demo", label: "Reset Demo Content", desc: "Clear transactional data + reseed products", color: "border-amber-200 bg-amber-50", btnColor: "bg-amber-500 hover:bg-amber-600", icon: <FlaskConical size={14} /> },
              { endpoint: "/reset-transactional", label: "Clear Transactional Data", desc: "Clear orders, rides, reviews. Keep users/products.", color: "border-orange-200 bg-orange-50", btnColor: "bg-orange-500 hover:bg-orange-600", icon: <RotateCcw size={14} /> },
              { endpoint: "/reset-products", label: "Reseed Products", desc: "Delete all products and insert fresh demo products.", color: "border-violet-200 bg-violet-50", btnColor: "bg-violet-500 hover:bg-violet-600", icon: <RefreshCcw size={14} /> },
              { endpoint: "/reset-settings", label: "Reset Platform Settings", desc: "Delete all settings. Factory defaults on next visit.", color: "border-red-200 bg-red-50", btnColor: "bg-red-500 hover:bg-red-600", icon: <Settings size={14} /> },
              { endpoint: "/reset-all", label: "Full Database Reset", desc: "Delete ALL users, orders, rides, products. Preserves settings.", color: "border-red-300 bg-red-50", btnColor: "bg-red-700 hover:bg-red-800", icon: <Trash2 size={14} /> },
            ].map(action => (
              <div key={action.endpoint} className={`rounded-xl border p-3 flex items-center justify-between gap-3 ${action.color}`}>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-slate-600">{action.icon}</span>
                  <div className="min-w-0">
                    <p className="font-semibold text-xs text-slate-800">{action.label}</p>
                    <p className="text-[10px] text-slate-500 truncate">{action.desc}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleOldAction(action.endpoint, action.label)}
                  disabled={!!actionLoading}
                  className={`shrink-0 text-white text-xs font-bold px-3 py-1.5 rounded-lg disabled:opacity-50 ${action.btnColor}`}
                >
                  {actionLoading === action.endpoint ? <Loader2 size={12} className="animate-spin" /> : "Run"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className={`px-6 py-4 ${confirmDialog.type === "remove" ? "bg-red-600" : "bg-emerald-600"} text-white`}>
              <div className="flex items-center gap-2">
                {confirmDialog.type === "remove" ? <Trash2 size={18} /> : <FlaskConical size={18} />}
                <p className="font-bold">{confirmDialog.type === "remove" ? "Remove All Data" : "Load Demo Data"}</p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-600">
                {confirmDialog.type === "remove"
                  ? "This will delete ALL users, orders, rides, products, reviews, wallet transactions and all other content. Admin accounts and platform settings will be preserved."
                  : "This will clear existing data and populate the system with comprehensive demo content: 22 users (customers, riders, vendors), 38+ products, 24 orders, 15 rides, reviews, wallet transactions, banners, promo codes and more."}
              </p>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-start gap-2">
                <Clock size={13} className="text-blue-500 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-700">
                  A full snapshot will be taken before this action runs.
                  You will have <strong>30 minutes</strong> to undo it.
                </p>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <p className="text-xs text-slate-500 mb-2">
                  Type <span className="font-mono font-bold text-slate-800">
                    {confirmDialog.type === "remove" ? "DELETE ALL" : "LOAD DEMO"}
                  </span> to confirm:
                </p>
                <input
                  type="text" value={confirmText} onChange={e => setConfirmText(e.target.value)}
                  placeholder={confirmDialog.type === "remove" ? "DELETE ALL" : "LOAD DEMO"}
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-300"
                  autoFocus
                />
              </div>

              <div className="flex gap-3">
                <button onClick={() => { setConfirmDialog(null); setConfirmText(""); }}
                  className="flex-1 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all">
                  Cancel
                </button>
                <button
                  disabled={
                    (confirmDialog.type === "remove" && confirmText !== "DELETE ALL") ||
                    (confirmDialog.type === "demo" && confirmText !== "LOAD DEMO") ||
                    !!actionLoading
                  }
                  onClick={() => {
                    if (confirmDialog.type === "remove") handleRemoveAll();
                    else handleSeedDemo();
                  }}
                  className={`flex-1 py-2 rounded-xl text-white text-sm font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-2
                    ${confirmDialog.type === "remove" ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>
                  {actionLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                  {actionLoading ? "Processing..." : "Confirm & Snapshot"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
