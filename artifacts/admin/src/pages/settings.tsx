import { useState, useEffect, useCallback, useRef } from "react";
import {
  Settings2, Save, RefreshCw, Truck, Car, BarChart3,
  ShoppingCart, Globe, Users, Bike, Store, Zap, Info,
  MessageSquare, Shield, Puzzle, Link, KeyRound,
  Wifi, AlertTriangle, CreditCard, CheckCircle2, XCircle,
  Loader2, Eye, EyeOff, ExternalLink, ChevronRight,
  Building2, Banknote, Wallet, Phone, FileText, Lock,
  ToggleRight, Settings, RotateCcw, Package,
  Gift, Star, Percent, ShieldCheck, UserPlus, Server,
  Database, Download, Upload, Trash2, HardDrive, RefreshCcw, FlaskConical,
  Clock, X, SlidersHorizontal,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetcher } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Toggle, Field, SecretInput, SLabel, ModeBtn } from "@/components/AdminShared";
import { PaymentSection } from "./settings-payment";
import { IntegrationsSection } from "./settings-integrations";
import { SecuritySection } from "./settings-security";
import { SystemSection } from "./settings-system";
import { renderSection, Setting, CatKey, TEXT_KEYS } from "./settings-render";

/* ─── Types ──────────────────────────────────────────────────────────────── */

const CAT_ORDER = [
  "general","features",
  "rides","orders","delivery",
  "customer","rider","vendor",
  "finance","payment",
  "content","integrations",
  "security","system",
] as const;

const NAV_GROUPS: { label: string; emoji: string; items: CatKey[] }[] = [
  { label: "App & Platform",  emoji: "🏢", items: ["general", "features"] },
  { label: "Service Config",  emoji: "⚙️", items: ["rides", "orders", "delivery"] },
  { label: "Role Settings",   emoji: "👤", items: ["customer", "rider", "vendor"] },
  { label: "Finance",         emoji: "💰", items: ["finance", "payment"] },
  { label: "Communication",   emoji: "📢", items: ["content", "integrations"] },
  { label: "Security",        emoji: "🔒", items: ["security"] },
  { label: "System",          emoji: "🔧", items: ["system"] },
];

const CATEGORY_CONFIG: Record<CatKey, { label: string; icon: any; color: string; bg: string; activeBg: string; description: string }> = {
  general:      { label: "General",             icon: Globe,        color: "text-gray-600",    bg: "bg-gray-50",    activeBg: "bg-gray-700",    description: "App name, support contact, version and maintenance mode" },
  features:     { label: "Feature Toggles",     icon: Zap,          color: "text-violet-600",  bg: "bg-violet-50",  activeBg: "bg-violet-600",  description: "Enable or disable each service across the entire platform instantly" },
  rides:        { label: "Ride Pricing & Rules", icon: Car,          color: "text-teal-600",    bg: "bg-teal-50",    activeBg: "bg-teal-600",    description: "Bike & car pricing, surge, Mol-Tol bargaining and cancellation rules — for live operations use Rides in the main menu" },
  orders:       { label: "Order Rules",          icon: ShoppingCart, color: "text-amber-600",   bg: "bg-amber-50",   activeBg: "bg-amber-600",   description: "Min/max cart amounts, scheduling, timing and auto-cancel rules" },
  delivery:     { label: "Delivery Charges",     icon: Truck,        color: "text-sky-600",     bg: "bg-sky-50",     activeBg: "bg-sky-600",     description: "Delivery charges per service and free delivery thresholds" },
  customer:     { label: "Customer App",         icon: Users,        color: "text-blue-600",    bg: "bg-blue-50",    activeBg: "bg-blue-600",    description: "Wallet limits, loyalty points, referral bonuses and order caps for customers" },
  rider:        { label: "Rider App",            icon: Bike,         color: "text-green-600",   bg: "bg-green-50",   activeBg: "bg-green-600",   description: "Earnings %, acceptance radius, payout limits and withdrawal rules for riders" },
  vendor:       { label: "Vendor Portal",        icon: Store,        color: "text-orange-600",  bg: "bg-orange-50",  activeBg: "bg-orange-600",  description: "Commission rate, menu limits, settlement cycle and approval rules — for live vendors use Vendors in the main menu" },
  finance:      { label: "Finance & Tax",        icon: BarChart3,    color: "text-purple-600",  bg: "bg-purple-50",  activeBg: "bg-purple-600",  description: "GST/tax, cashback, platform commissions, invoicing and payouts" },
  payment:      { label: "Payment Methods",      icon: CreditCard,   color: "text-emerald-600", bg: "bg-emerald-50", activeBg: "bg-emerald-600", description: "JazzCash, EasyPaisa, Bank Transfer, COD and AJK Wallet settings" },
  content:      { label: "Content & Banners",    icon: MessageSquare,color: "text-pink-600",    bg: "bg-pink-50",    activeBg: "bg-pink-600",    description: "Banners, announcements, notices for riders & vendors, policy links" },
  integrations: { label: "Integrations",         icon: Puzzle,       color: "text-indigo-600",  bg: "bg-indigo-50",  activeBg: "bg-indigo-600",  description: "Push notifications, SMS, WhatsApp, analytics, maps and monitoring" },
  security:     { label: "Security",             icon: Shield,       color: "text-red-600",     bg: "bg-red-50",     activeBg: "bg-red-600",     description: "OTP modes, GPS tracking, rate limits, sessions and API credentials" },
  system:       { label: "System & Data",        icon: Database,     color: "text-rose-600",    bg: "bg-rose-50",    activeBg: "bg-rose-600",    description: "Database stats, backup, restore and data management tools" },
};

export default function SettingsPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [localValues, setLocalValues] = useState<Record<string,string>>({});
  const [savedValues, setSavedValues] = useState<Record<string,string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<CatKey>(() => {
    const p = new URLSearchParams(window.location.search);
    const cat = p.get("cat");
    return (cat && (CAT_ORDER as readonly string[]).includes(cat)) ? (cat as CatKey) : "features";
  });

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetcher("/platform-settings");
      setSettings(data.settings || []);
      const vals: Record<string,string> = {};
      for (const s of data.settings || []) vals[s.key] = s.value;
      setLocalValues(vals);
      setSavedValues(vals);
      setDirtyKeys(new Set());
    } catch (e: any) {
      toast({ title: "Failed to load settings", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const handleChange = (key: string, value: string) => {
    setLocalValues(prev => ({ ...prev, [key]: value }));
    setDirtyKeys(prev => {
      const n = new Set(prev);
      if (value === savedValues[key]) { n.delete(key); } else { n.add(key); }
      return n;
    });
  };
  const handleToggle = (key: string, val: boolean) => handleChange(key, val ? "on" : "off");

  const handleSave = async () => {
    setSaving(true);
    try {
      const changed = Array.from(dirtyKeys).map(key => ({ key, value: localValues[key] ?? "" }));
      await fetcher("/platform-settings", { method: "PUT", body: JSON.stringify({ settings: changed }) });
      setSavedValues(prev => {
        const updated = { ...prev };
        for (const c of changed) updated[c.key] = c.value;
        return updated;
      });
      setDirtyKeys(new Set());
      toast({ title: "Settings saved ✅", description: `${changed.length} change(s) applied instantly.` });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleBackup = async () => {
    setBackingUp(true);
    try {
      const data = await fetcher("/platform-settings/backup");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.href = url;
      a.download = `ajkmart-settings-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Backup downloaded ✅", description: `${data.count ?? data.settings?.length ?? 0} settings exported.` });
    } catch (e: any) {
      toast({ title: "Backup failed", description: e.message, variant: "destructive" });
    }
    setBackingUp(false);
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!fileInputRef.current) return;
    fileInputRef.current.value = "";
    if (!file) return;
    if (!window.confirm(`Restore settings from "${file.name}"?\n\nThis will overwrite existing values with the backup. Your current settings will be replaced. Continue?`)) return;
    setRestoring(true);
    try {
      const text = await file.text();
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { throw new Error("Invalid JSON file."); }
      const settingsArr = parsed?.settings ?? parsed;
      if (!Array.isArray(settingsArr)) throw new Error("Backup file must contain a settings array.");
      const payload = settingsArr.map((s: any) => ({ key: String(s.key ?? ""), value: String(s.value ?? "") }));
      const result = await fetcher("/platform-settings/restore", { method: "POST", body: JSON.stringify({ settings: payload }) });
      await loadSettings();
      toast({ title: "Settings restored ✅", description: `${result.restored ?? payload.length} settings applied${result.skipped ? `, ${result.skipped} skipped` : ""}.` });
    } catch (e: any) {
      toast({ title: "Restore failed", description: e.message, variant: "destructive" });
    }
    setRestoring(false);
  };

  const grouped: Record<string,Setting[]> = {};
  for (const s of settings) {
    if (!grouped[s.category]) grouped[s.category] = [];
    grouped[s.category].push(s);
  }

  const getInputType = (key: string) => TEXT_KEYS.has(key) ? "text" : "number";
  const getInputSuffix = (key: string) => {
    if (key.includes("_pct") || key.includes("pct")) return "%";
    if (TEXT_KEYS.has(key)) return "";
    if (key.includes("_km") || key === "rider_acceptance_km") return "KM";
    if (key.includes("_day") || key.includes("_days") || key === "security_session_days") return "days";
    if (key.includes("_pts") || key.includes("_items") || key.includes("_deliveries")) return "#";
    if (key === "security_rate_limit") return "req/min";
    if (key === "payment_timeout_mins") return "min";
    return "Rs.";
  };
  const getPlaceholder = (key: string) => {
    if (key.includes("_url")) return "https://...";
    if (key === "content_announcement") return "Leave empty to hide the bar in all apps";
    if (key === "content_banner") return "Free delivery on your first order! 🎉";
    if (key === "content_maintenance_msg") return "We're performing scheduled maintenance. Back soon!";
    if (key === "content_support_msg") return "Need help? Chat with us on WhatsApp!";
    if (key === "content_vendor_notice") return "Leave empty to hide. E.g. New settlement policy starting May 1.";
    if (key === "content_rider_notice") return "Leave empty to hide. E.g. Bonus Rs.200 for 10+ deliveries today!";
    if (key === "content_refund_policy_url") return "https://ajkmart.pk/refund-policy";
    if (key === "content_faq_url") return "https://ajkmart.pk/help";
    if (key === "content_about_url") return "https://ajkmart.pk/about";
    return "";
  };

  const activeCfg = CATEGORY_CONFIG[activeTab];
  const ActiveIcon = activeCfg.icon;
  const activeSettings = grouped[activeTab] || [];

  /* keys that appear in a different tab than their DB category */
  const DISPLAY_CAT_OVERRIDE: Record<string,string> = {
    vendor_min_payout:        "finance",
    customer_referral_bonus:  "payment",
    customer_signup_bonus:    "payment",
  };
  const dirtyCounts: Record<string,number> = {};
  for (const k of dirtyKeys) {
    const s = settings.find(x => x.key === k);
    if (s) {
      const displayCat = DISPLAY_CAT_OVERRIDE[k] ?? s.category;
      dirtyCounts[displayCat] = (dirtyCounts[displayCat] || 0) + 1;
    }
  }

  if (loading) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Settings2 className="w-6 h-6 text-primary animate-spin" style={{ animationDuration: "3s" }} />
          </div>
          <p className="text-muted-foreground text-sm font-medium">Loading settings...</p>
        </div>
      </div>
    );
  }

  const appNameValue = (localValues["app_name"] ?? settings.find(s => s.key === "app_name")?.value ?? "").trim();
  const appNameBlank = appNameValue === "";

  /* helper: is a category visible */
  const isCatVisible = (cat: CatKey) =>
    (grouped[cat]?.length ?? 0) > 0 || cat === "payment" || cat === "system" || cat === "security";

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Hidden file input for restore */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleRestoreFile}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 sm:w-11 sm:h-11 bg-slate-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <Settings2 className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-display font-bold text-foreground">App Settings</h1>
            <p className="text-sm">
              {dirtyKeys.size > 0
                ? <span className="text-amber-600 font-medium">{dirtyKeys.size} unsaved change{dirtyKeys.size > 1 ? "s" : ""}</span>
                : <span className="text-muted-foreground">All settings saved</span>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button
            variant="outline"
            onClick={handleBackup}
            disabled={backingUp || loading}
            title="Download all settings as a JSON backup file"
            className="h-9 rounded-xl gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
          >
            {backingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            <span className="hidden sm:inline">Backup</span>
          </Button>
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={restoring || loading}
            title="Restore settings from a JSON backup file"
            className="h-9 rounded-xl gap-2 border-amber-200 text-amber-700 hover:bg-amber-50"
          >
            {restoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            <span className="hidden sm:inline">Restore</span>
          </Button>
          <Button variant="outline" onClick={() => { loadSettings(); toast({ title: "Reloaded" }); }} disabled={loading} className="h-9 rounded-xl gap-2">
            <RefreshCw className="w-4 h-4" /> <span className="hidden xs:inline">Reset</span>
          </Button>
          <Button onClick={handleSave} disabled={saving || dirtyKeys.size === 0 || appNameBlank} title={appNameBlank ? "App Name cannot be blank" : undefined} className="h-9 rounded-xl gap-2 shadow-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? "Saving..." : `Save${dirtyKeys.size > 0 ? ` (${dirtyKeys.size})` : ""}`}
          </Button>
        </div>
      </div>

      {/* ── Mobile: sticky section bar with drawer trigger ── */}
      <div className="md:hidden sticky top-0 z-20 -mx-3 sm:-mx-5 px-3 sm:px-5 py-2 bg-slate-50/95 backdrop-blur-sm border-b border-border/40">
        <div className="flex items-center gap-3">
          {/* Active section indicator */}
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${activeCfg.bg}`}>
            <ActiveIcon className={`w-4 h-4 ${activeCfg.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{activeCfg.label}</p>
            {dirtyCounts[activeTab] > 0 && (
              <p className="text-[11px] text-amber-600 font-medium leading-tight">{dirtyCounts[activeTab]} unsaved</p>
            )}
          </div>
          {/* Reset shortcut on mobile */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => { loadSettings(); toast({ title: "Reloaded" }); }}
            disabled={loading}
            className="h-8 rounded-xl px-2.5 shrink-0"
            title="Reset all changes"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          {/* Save shortcut on mobile */}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || dirtyKeys.size === 0 || appNameBlank}
            className="h-8 rounded-xl gap-1.5 px-3 text-xs shrink-0"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            {dirtyKeys.size > 0 ? `Save (${dirtyKeys.size})` : "Save"}
          </Button>
          {/* All settings trigger */}
          <button
            onClick={() => setMobileDrawerOpen(true)}
            className="flex items-center gap-1.5 px-3 h-8 rounded-xl border border-border/60 bg-white text-xs font-semibold text-foreground hover:bg-muted/40 transition-colors shrink-0"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
            All Settings
          </button>
        </div>
      </div>

      {/* ── Mobile bottom sheet drawer ── */}
      <Sheet open={mobileDrawerOpen} onOpenChange={setMobileDrawerOpen}>
        <SheetContent side="bottom" className="md:hidden p-0 rounded-t-2xl max-h-[85vh] flex flex-col">
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1 shrink-0">
            <div className="w-10 h-1 rounded-full bg-border/60" />
          </div>
          {/* Sheet title (accessible, visually styled) */}
          <div className="px-5 pb-3 pt-1 border-b border-border/30 shrink-0">
            <SheetTitle className="flex items-center gap-2 text-base font-bold text-foreground">
              <Settings2 className="w-4 h-4 text-muted-foreground" />
              All Settings
              {dirtyKeys.size > 0 && (
                <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold ml-auto">
                  {dirtyKeys.size} unsaved
                </Badge>
              )}
            </SheetTitle>
          </div>
          {/* Grouped category list */}
          <div className="overflow-y-auto flex-1 px-3 py-3 space-y-3 pb-8">
            {NAV_GROUPS.map((group) => {
              const visibleItems = group.items.filter(isCatVisible);
              if (visibleItems.length === 0) return null;
              const groupDirty = visibleItems.reduce((sum, cat) => sum + (dirtyCounts[cat] || 0), 0);
              return (
                <div key={group.label}>
                  {/* Group header */}
                  <div className="flex items-center gap-2 px-2 pb-1.5">
                    <span className="text-base leading-none">{group.emoji}</span>
                    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest flex-1">{group.label}</p>
                    {groupDirty > 0 && (
                      <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{groupDirty}</span>
                    )}
                  </div>
                  {/* Items */}
                  <div className="space-y-0.5">
                    {visibleItems.map(cat => {
                      const cfg = CATEGORY_CONFIG[cat];
                      const Icon = cfg.icon;
                      const isActive = activeTab === cat;
                      const dirty = dirtyCounts[cat] || 0;
                      return (
                        <button
                          key={cat}
                          onClick={() => { setActiveTab(cat); setMobileDrawerOpen(false); }}
                          className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all relative ${
                            isActive ? "bg-slate-900 text-white shadow-sm" : "hover:bg-muted/50 text-foreground bg-transparent"
                          }`}
                        >
                          {/* Left accent stripe */}
                          {isActive && (
                            <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full" style={{ background: "var(--color-accent, #6366F1)" }} />
                          )}
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${isActive ? "bg-white/15" : cfg.bg}`}>
                            <Icon className={`w-4 h-4 ${isActive ? "text-white" : cfg.color}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold truncate ${isActive ? "text-white" : "text-foreground"}`}>{cfg.label}</p>
                            <p className={`text-[11px] truncate mt-0.5 ${isActive ? "text-white/60" : "text-muted-foreground"}`}>{cfg.description.split("—")[0].trim()}</p>
                          </div>
                          {dirty > 0 ? (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${isActive ? "bg-white/25 text-white" : "bg-amber-100 text-amber-700"}`}>{dirty}</span>
                          ) : (
                            <ChevronRight className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-white/40" : "text-muted-foreground/30"}`} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>

      {/* Two-panel layout */}
      <div className="flex gap-4 items-start">
        {/* LEFT sidebar — desktop only */}
        <div className="hidden md:flex w-60 flex-shrink-0 flex-col bg-white rounded-2xl border border-border/60 shadow-sm overflow-hidden sticky top-4">
          {/* Sidebar header */}
          <div className="px-4 pt-4 pb-3 border-b border-border/40 bg-slate-50/80">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
                <Settings2 className="w-3.5 h-3.5 text-slate-600" />
              </div>
              <p className="text-[12px] font-bold text-slate-600 tracking-wide">Settings</p>
            </div>
          </div>

          <nav className="p-2.5 pb-3 max-h-[calc(100vh-200px)] overflow-y-auto" style={{ scrollbarWidth: "none" }}>
            {NAV_GROUPS.map((group, gi) => {
              const visibleItems = group.items.filter(isCatVisible);
              if (visibleItems.length === 0) return null;

              const groupDirty = visibleItems.reduce((sum, cat) => sum + (dirtyCounts[cat] || 0), 0);

              return (
                <div key={group.label} className={gi > 0 ? "mt-3" : ""}>
                  {/* Group header — subtle left-border accent */}
                  <div className="flex items-center gap-2 px-2 py-1.5 mb-1 rounded-lg bg-slate-50/70 border-l-[3px] border-slate-200">
                    <span className="text-[12px] leading-none">{group.emoji}</span>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex-1">{group.label}</p>
                    {groupDirty > 0 && (
                      <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{groupDirty}</span>
                    )}
                  </div>

                  {/* Group items */}
                  <div className="space-y-0.5 ml-1">
                    {visibleItems.map(cat => {
                      const cfg = CATEGORY_CONFIG[cat];
                      const Icon = cfg.icon;
                      const isActive = activeTab === cat;
                      const dirty = dirtyCounts[cat] || 0;
                      return (
                        <button key={cat} onClick={() => setActiveTab(cat)}
                          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all group relative overflow-hidden ${
                            isActive
                              ? "bg-slate-900 text-white shadow-md"
                              : "hover:bg-slate-50 text-foreground"
                          }`}
                        >
                          {/* Active left accent stripe */}
                          {isActive && (
                            <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-indigo-400" />
                          )}
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${isActive ? "bg-white/15" : cfg.bg}`}>
                            <Icon className={`w-3 h-3 ${isActive ? "text-white" : cfg.color}`} />
                          </div>
                          <span className={`text-xs font-semibold flex-1 truncate ${isActive ? "text-white" : "text-slate-700"}`}>{cfg.label}</span>
                          {dirty > 0
                            ? <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${isActive ? "bg-white/25 text-white" : "bg-amber-100 text-amber-700"}`}>{dirty}</span>
                            : <ChevronRight className={`w-3 h-3 flex-shrink-0 transition-colors ${isActive ? "text-white/40" : "text-slate-300 group-hover:text-slate-400"}`} />
                          }
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="px-4 py-2.5 border-t border-border/40 bg-slate-50/60">
            <p className="text-[10px] text-muted-foreground">{settings.length} settings</p>
          </div>
        </div>

        {/* RIGHT content */}
        <div className="flex-1 min-w-0 space-y-4">
          <div className="bg-white rounded-2xl border border-border/60 shadow-sm overflow-hidden">
            {/* Section header */}
            <div className="px-6 py-4 border-b border-border/40 flex items-start gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${activeCfg.bg}`}>
                <ActiveIcon className={`w-5 h-5 ${activeCfg.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-bold text-foreground">{activeCfg.label}</h2>
                  {activeSettings.length > 0 && (
                    <Badge variant="outline" className="text-[10px] bg-muted/50 text-muted-foreground border-border">
                      {activeSettings.length} settings
                    </Badge>
                  )}
                  {dirtyCounts[activeTab] > 0 && (
                    <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold">
                      {dirtyCounts[activeTab]} changed
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{activeCfg.description}</p>
              </div>
            </div>
            {/* Section body */}
            <div className="p-4 sm:p-6">
              {activeTab === "payment" ? (
                <PaymentSection
                  localValues={localValues} dirtyKeys={dirtyKeys}
                  handleChange={handleChange} handleToggle={handleToggle}
                  onNavigateFeatures={() => setActiveTab("features")}
                />
              ) : activeTab === "integrations" ? (
                <IntegrationsSection
                  localValues={localValues} dirtyKeys={dirtyKeys}
                  handleChange={handleChange} handleToggle={handleToggle}
                />
              ) : activeTab === "security" ? (
                <SecuritySection
                  localValues={localValues} dirtyKeys={dirtyKeys}
                  handleChange={handleChange} handleToggle={handleToggle}
                />
              ) : activeTab === "system" ? (
                <SystemSection />
              ) : activeSettings.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Settings2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No settings in this section</p>
                </div>
              ) : renderSection(
                activeTab, activeSettings, settings, localValues, dirtyKeys,
                handleChange, handleToggle, getInputType, getInputSuffix, getPlaceholder
              )}
            </div>
          </div>
          <div className="bg-blue-50/60 border border-blue-200/60 rounded-xl p-4 flex gap-3">
            <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700">
              <strong className="text-blue-800">Changes apply instantly</strong> after saving — no restart needed.
              Payment gateways: use Manual mode without API credentials, or API mode for automated payments.
              Sandbox mode works without real credentials for testing.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
