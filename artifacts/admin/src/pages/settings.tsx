import { useState, useEffect, useCallback } from "react";
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
  Clock, X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetcher } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-slate-100 rounded-xl flex items-center justify-center">
            <Settings2 className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">App Settings</h1>
            <p className="text-sm">
              {dirtyKeys.size > 0
                ? <span className="text-amber-600 font-medium">{dirtyKeys.size} unsaved change{dirtyKeys.size > 1 ? "s" : ""}</span>
                : <span className="text-muted-foreground">All settings saved</span>}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { loadSettings(); toast({ title: "Reloaded" }); }} disabled={loading} className="h-9 rounded-xl gap-2">
            <RefreshCw className="w-4 h-4" /> Reset
          </Button>
          <Button onClick={handleSave} disabled={saving || dirtyKeys.size === 0 || appNameBlank} title={appNameBlank ? "App Name cannot be blank" : undefined} className="h-9 rounded-xl gap-2 shadow-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? "Saving..." : `Save${dirtyKeys.size > 0 ? ` (${dirtyKeys.size})` : ""}`}
          </Button>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="flex gap-4 items-start">
        {/* LEFT sidebar */}
        <div className="w-56 flex-shrink-0 bg-white rounded-2xl border border-border/60 shadow-sm overflow-hidden sticky top-4">
          {/* Sidebar header */}
          <div className="px-4 pt-4 pb-2 border-b border-border/30">
            <div className="flex items-center gap-2">
              <Settings2 className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Settings</p>
            </div>
          </div>

          <nav className="p-2 pb-3 space-y-1 max-h-[calc(100vh-200px)] overflow-y-auto">
            {NAV_GROUPS.map((group, gi) => {
              const visibleItems = group.items.filter(cat => {
                const count = grouped[cat]?.length ?? 0;
                return count > 0 || cat === "payment" || cat === "system" || cat === "security";
              });
              if (visibleItems.length === 0) return null;

              const groupDirty = visibleItems.reduce((sum, cat) => sum + (dirtyCounts[cat] || 0), 0);

              return (
                <div key={group.label} className={gi > 0 ? "pt-1" : ""}>
                  {/* Group header */}
                  <div className="flex items-center gap-1.5 px-2 py-1.5 mb-0.5">
                    <span className="text-[11px]">{group.emoji}</span>
                    <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider flex-1">{group.label}</p>
                    {groupDirty > 0 && (
                      <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1 py-0.5 rounded-full">{groupDirty}</span>
                    )}
                  </div>

                  {/* Group items */}
                  <div className="space-y-0.5">
                    {visibleItems.map(cat => {
                      const cfg = CATEGORY_CONFIG[cat];
                      const Icon = cfg.icon;
                      const isActive = activeTab === cat;
                      const dirty = dirtyCounts[cat] || 0;
                      return (
                        <button key={cat} onClick={() => setActiveTab(cat)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-all group ${
                            isActive ? `${cfg.activeBg} text-white shadow-sm` : "hover:bg-muted/50 text-foreground"
                          }`}
                        >
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${isActive ? "bg-white/20" : cfg.bg}`}>
                            <Icon className={`w-3 h-3 ${isActive ? "text-white" : cfg.color}`} />
                          </div>
                          <span className={`text-xs font-semibold flex-1 truncate ${isActive ? "text-white" : "text-foreground"}`}>{cfg.label}</span>
                          {dirty > 0
                            ? <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${isActive ? "bg-white/25 text-white" : "bg-amber-100 text-amber-700"}`}>{dirty}</span>
                            : <ChevronRight className={`w-3 h-3 flex-shrink-0 ${isActive ? "text-white/60" : "text-muted-foreground/30 group-hover:text-muted-foreground/60"}`} />
                          }
                        </button>
                      );
                    })}
                  </div>

                  {/* Divider between groups */}
                  {gi < NAV_GROUPS.length - 1 && (
                    <div className="mx-2 mt-2 border-t border-border/30" />
                  )}
                </div>
              );
            })}
          </nav>

          <div className="px-4 py-2.5 border-t border-border/40 bg-muted/20">
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
            <div className="p-6">
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
