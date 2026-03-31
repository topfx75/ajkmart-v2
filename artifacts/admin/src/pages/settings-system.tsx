import { useState, useEffect, useCallback } from "react";
import {
  Database, Download, Upload, Trash2, HardDrive, RefreshCcw,
  FlaskConical, RotateCcw, Clock, AlertTriangle, Settings,
  Loader2, CheckCircle2, X, RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetcher } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/* ═══════════════════════════════════════════════════════════════════════════
   SystemSection — Database & System Management
═══════════════════════════════════════════════════════════════════════════ */
/* ── type for pending undo items ── */
type PendingUndo = { id: string; label: string; expiresAt: string; actionId: string };

function fmtCountdown(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return "00:00";
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function SystemSection() {
  const { toast } = useToast();
  const adminSecret = localStorage.getItem("ajkmart_admin_token") || "";

  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; label: string; description: string; endpoint: string; danger: boolean } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [pendingUndos, setPendingUndos] = useState<PendingUndo[]>([]);
  const [undoLoading, setUndoLoading] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  /* Live countdown tick */
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

  /* Load existing snapshots on mount (e.g. user navigated away and came back) */
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

  const runAction = async (endpoint: string, label: string, actionId: string) => {
    setActionLoading(endpoint);
    try {
      const data = await apiFetch(endpoint, { method: "POST" });
      toast({ title: `${label} — done`, description: "You have 30 minutes to undo this action." });
      setConfirm(null);
      setConfirmText("");
      if (data.snapshotId) {
        setPendingUndos(prev => [
          { id: data.snapshotId, label, expiresAt: data.expiresAt, actionId },
          ...prev,
        ]);
      }
      await loadStats();
    } catch (e: any) {
      toast({ title: `${label} failed`, description: e.message, variant: "destructive" });
    }
    setActionLoading(null);
  };

  const handleUndo = async (undo: PendingUndo) => {
    setUndoLoading(undo.id);
    try {
      const data = await apiFetch(`/undo/${undo.id}`, { method: "POST" });
      toast({ title: "Undo complete ✅", description: data.message });
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
      toast({ title: "Backup downloaded ✅", description: "Full database exported as JSON" });
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
      toast({ title: "Restore complete ✅", description: "You have 30 minutes to undo this." });
      if (data.snapshotId) {
        setPendingUndos(prev => [
          { id: data.snapshotId, label: "Import Restore", expiresAt: data.expiresAt, actionId: "restore" },
          ...prev,
        ]);
      }
      await loadStats();
    } catch (e: any) {
      setRestoreError(e.message);
      toast({ title: "Restore failed", description: e.message, variant: "destructive" });
    }
    setActionLoading(null);
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
    { key: "savedAddresses", label: "Saved Addresses", icon: "📍", color: "bg-lime-50 border-lime-200 text-lime-700" },
    { key: "settings",       label: "Settings",        icon: "⚙️", color: "bg-slate-50 border-slate-200 text-slate-700" },
    { key: "adminAccounts",  label: "Admin Accounts",  icon: "🛡️", color: "bg-red-50 border-red-200 text-red-700" },
  ];

  const ACTIONS = [
    {
      id: "reset-demo",
      label: "Reset Demo Content",
      icon: <FlaskConical size={18} />,
      description: "Clears all orders, rides, wallet history, reviews and notifications. Reseeds demo products. Resets all user wallets to Rs. 1,000.",
      endpoint: "/reset-demo",
      color: "border-amber-200 bg-amber-50",
      btnColor: "bg-amber-500 hover:bg-amber-600",
      danger: false,
      confirmPhrase: "RESET DEMO",
    },
    {
      id: "reset-transactional",
      label: "Clear Transactional Data",
      icon: <RotateCcw size={18} />,
      description: "Clears all orders, rides, pharmacy, parcel, wallet transactions, reviews and notifications. Users and products are preserved.",
      endpoint: "/reset-transactional",
      color: "border-orange-200 bg-orange-50",
      btnColor: "bg-orange-500 hover:bg-orange-600",
      danger: true,
      confirmPhrase: "CLEAR DATA",
    },
    {
      id: "reset-products",
      label: "Reseed Products",
      icon: <RefreshCcw size={18} />,
      description: "Deletes all current products and inserts fresh demo mart (25 items) and food (13 items) products.",
      endpoint: "/reset-products",
      color: "border-violet-200 bg-violet-50",
      btnColor: "bg-violet-500 hover:bg-violet-600",
      danger: false,
      confirmPhrase: "RESEED",
    },
    {
      id: "reset-settings",
      label: "Reset Platform Settings",
      icon: <Settings size={18} />,
      description: "Deletes all platform settings. They will be reseeded to factory defaults on your next admin panel visit.",
      endpoint: "/reset-settings",
      color: "border-red-200 bg-red-50",
      btnColor: "bg-red-500 hover:bg-red-600",
      danger: true,
      confirmPhrase: "RESET SETTINGS",
    },
    {
      id: "reset-all",
      label: "Full Database Reset",
      icon: <Trash2 size={18} />,
      description: "NUCLEAR RESET: Deletes ALL users, orders, rides, wallet data, reviews and all content. Platform settings and admin accounts are preserved.",
      endpoint: "/reset-all",
      color: "border-red-300 bg-red-50",
      btnColor: "bg-red-700 hover:bg-red-800",
      danger: true,
      confirmPhrase: "DELETE EVERYTHING",
    },
  ];

  return (
    <div className="space-y-6">

      {/* ══════════════════════════════════════════════════════
          UNDO BANNERS — shown after each action for 30 min
      ══════════════════════════════════════════════════════ */}
      {pendingUndos.length > 0 && (
        <div className="space-y-2">
          {pendingUndos.map(undo => {
            const countdown = fmtCountdown(undo.expiresAt, now);
            const urgentMs  = new Date(undo.expiresAt).getTime() - now;
            const isUrgent  = urgentMs < 5 * 60 * 1000; // last 5 min
            return (
              <div key={undo.id}
                className={`rounded-xl border-2 p-3 flex items-center gap-3 transition-all
                  ${isUrgent
                    ? "bg-red-50 border-red-300 animate-pulse"
                    : "bg-amber-50 border-amber-300"}`}>

                {/* Clock + countdown */}
                <div className={`flex items-center gap-1.5 shrink-0 font-mono text-sm font-bold tabular-nums
                  ${isUrgent ? "text-red-600" : "text-amber-700"}`}>
                  <Clock size={14} className={isUrgent ? "text-red-500" : "text-amber-500"} />
                  {countdown}
                </div>

                {/* Label */}
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold truncate ${isUrgent ? "text-red-800" : "text-amber-800"}`}>
                    "{undo.label}" — undo available
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Snapshot saved before this action. Tap Undo to reverse it completely.
                  </p>
                </div>

                {/* Actions */}
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

      {/* ── DB Stats ── */}
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

      {/* ── Backup & Restore ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <HardDrive size={15} className="text-slate-500" />
          <p className="font-semibold text-sm text-slate-700">Backup & Restore</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Backup */}
          <div className="border border-green-200 bg-green-50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Download size={16} className="text-green-700" />
              <p className="font-semibold text-sm text-green-800">Export Backup</p>
            </div>
            <p className="text-[11px] text-green-700 mb-4">Downloads the full database as a JSON file. Includes all users, orders, products and settings. Admin passwords are excluded for security.</p>
            <button onClick={handleBackup} disabled={actionLoading === "backup"}
              className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2 rounded-lg transition-all disabled:opacity-60">
              {actionLoading === "backup" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {actionLoading === "backup" ? "Exporting..." : "Download Backup (.json)"}
            </button>
          </div>

          {/* Restore */}
          <div className="border border-blue-200 bg-blue-50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Upload size={16} className="text-blue-700" />
              <p className="font-semibold text-sm text-blue-800">Import Restore</p>
            </div>
            <p className="text-[11px] text-blue-700 mb-3">Upload a previously exported backup JSON file. Platform settings and admin accounts are never overwritten. A snapshot is taken first — restore can be undone within 30 minutes.</p>
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

      {/* ── Data Management Actions ── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Database size={15} className="text-slate-500" />
          <p className="font-semibold text-sm text-slate-700">Data Management</p>
        </div>
        <p className="text-[11px] text-slate-400 mb-3 flex items-center gap-1">
          <Clock size={10} /> All actions create a snapshot first — you can undo within 30 minutes.
        </p>
        <div className="space-y-3">
          {ACTIONS.map(action => (
            <div key={action.id} className={`rounded-xl border p-4 ${action.color}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1">
                  <div className="mt-0.5 text-slate-600">{action.icon}</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm text-slate-800">{action.label}</p>
                      {action.danger && (
                        <span className="text-[10px] font-bold bg-red-100 text-red-600 border border-red-200 px-1.5 py-0.5 rounded-full">DESTRUCTIVE</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-600 mt-0.5">{action.description}</p>
                  </div>
                </div>
                <button
                  onClick={() => { setConfirm({ id: action.id, label: action.label, description: action.description, endpoint: action.endpoint, danger: action.danger }); setConfirmText(""); }}
                  disabled={!!actionLoading}
                  className={`shrink-0 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all disabled:opacity-50 ${action.btnColor}`}>
                  Run
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Confirm Modal ── */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className={`px-6 py-4 ${confirm.danger ? "bg-red-600" : "bg-amber-500"} text-white`}>
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} />
                <p className="font-bold">{confirm.label}</p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-600">{confirm.description}</p>

              {/* Undo notice */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-start gap-2">
                <Clock size={13} className="text-blue-500 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-700">
                  A full snapshot will be taken before this action runs.
                  You will have <strong>30 minutes</strong> to undo it from the undo banner at the top of this section.
                </p>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <p className="text-xs text-slate-500 mb-2">
                  Type <span className="font-mono font-bold text-slate-800">
                    {ACTIONS.find(a => a.id === confirm.id)?.confirmPhrase}
                  </span> to confirm:
                </p>
                <input
                  type="text" value={confirmText} onChange={e => setConfirmText(e.target.value)}
                  placeholder={ACTIONS.find(a => a.id === confirm.id)?.confirmPhrase}
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-300"
                  autoFocus
                />
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setConfirm(null); setConfirmText(""); }}
                  className="flex-1 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all">
                  Cancel
                </button>
                <button
                  disabled={confirmText !== ACTIONS.find(a => a.id === confirm.id)?.confirmPhrase || !!actionLoading}
                  onClick={() => {
                    const a = ACTIONS.find(ac => ac.id === confirm.id)!;
                    runAction(confirm.endpoint, confirm.label, a.id);
                  }}
                  className={`flex-1 py-2 rounded-xl text-white text-sm font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-2
                    ${confirm.danger ? "bg-red-600 hover:bg-red-700" : "bg-amber-500 hover:bg-amber-600"}`}>
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
