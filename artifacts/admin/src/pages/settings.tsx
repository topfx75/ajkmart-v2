import { useState, useEffect } from "react";
import {
  Settings2, Save, RefreshCw, Truck, Car, BarChart3,
  ShoppingCart, Globe, Users, Bike, Store, Zap, Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetcher } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface Setting {
  key: string;
  value: string;
  label: string;
  category: string;
}

const CATEGORY_CONFIG: Record<string, {
  label: string;
  icon: any;
  color: string;
  bg: string;
  description: string;
}> = {
  features: { label: "App Feature Toggles",     icon: Zap,          color: "text-violet-600",  bg: "bg-violet-100",  description: "Turn each service on or off across the entire app instantly" },
  customer: { label: "Customer Settings",        icon: Users,        color: "text-blue-600",    bg: "bg-blue-100",    description: "Wallet limits, loyalty points, referral bonuses and order caps for customers" },
  rider:    { label: "Rider Settings",           icon: Bike,         color: "text-green-600",   bg: "bg-green-100",   description: "Earnings %, acceptance radius, delivery limits and payout rules for riders" },
  vendor:   { label: "Vendor Settings",          icon: Store,        color: "text-orange-600",  bg: "bg-orange-100",  description: "Commission rates, menu limits, settlement cycles and approval rules for vendors" },
  delivery: { label: "Delivery Charges",         icon: Truck,        color: "text-sky-600",     bg: "bg-sky-100",     description: "Delivery fees per service and free delivery threshold" },
  rides:    { label: "Ride Pricing",             icon: Car,          color: "text-teal-600",    bg: "bg-teal-100",    description: "Base fare and per-km rates for bike and car rides" },
  finance:  { label: "Finance & Margins",        icon: BarChart3,    color: "text-purple-600",  bg: "bg-purple-100",  description: "Platform-wide commission percentage" },
  orders:   { label: "Order Rules",              icon: ShoppingCart, color: "text-amber-600",   bg: "bg-amber-100",   description: "Minimum order amounts and COD limits" },
  general:  { label: "General Settings",         icon: Globe,        color: "text-gray-600",    bg: "bg-gray-100",    description: "App name, support contact and maintenance mode" },
};

const TOGGLE_KEYS = new Set([
  "feature_mart","feature_food","feature_rides","feature_pharmacy",
  "feature_parcel","feature_wallet","feature_referral","feature_new_users",
  "rider_cash_allowed","vendor_auto_approve",
]);

const FEATURE_ICONS: Record<string, string> = {
  feature_mart:      "🛒",
  feature_food:      "🍔",
  feature_rides:     "🚗",
  feature_pharmacy:  "💊",
  feature_parcel:    "📦",
  feature_wallet:    "💰",
  feature_referral:  "🎁",
  feature_new_users: "👤",
};

function ToggleSwitch({
  checked, onChange, label, icon, isDirty,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; icon?: string; isDirty: boolean }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all select-none
        ${checked
          ? "bg-green-50 border-green-200 hover:bg-green-100"
          : "bg-red-50 border-red-200 hover:bg-red-100"}
        ${isDirty ? "ring-2 ring-amber-300" : ""}
      `}
    >
      <div className="flex items-center gap-3">
        {icon && <span className="text-2xl">{icon}</span>}
        <div>
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <p className={`text-xs font-bold ${checked ? "text-green-600" : "text-red-500"}`}>
            {checked ? "● Active" : "○ Disabled"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isDirty && (
          <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold">
            CHANGED
          </Badge>
        )}
        <div className={`w-12 h-6 rounded-full transition-colors relative ${checked ? "bg-green-500" : "bg-gray-300"}`}>
          <div className={`w-5 h-5 bg-white rounded-full shadow absolute top-0.5 transition-transform ${checked ? "translate-x-6" : "translate-x-0.5"}`} />
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());

  const loadSettings = async () => {
    setLoading(true);
    try {
      const data = await fetcher("/platform-settings");
      setSettings(data.settings || []);
      const vals: Record<string, string> = {};
      for (const s of data.settings || []) vals[s.key] = s.value;
      setLocalValues(vals);
      setDirtyKeys(new Set());
    } catch (e: any) {
      toast({ title: "Failed to load settings", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  };

  useEffect(() => { loadSettings(); }, []);

  const handleChange = (key: string, value: string) => {
    setLocalValues(prev => ({ ...prev, [key]: value }));
    setDirtyKeys(prev => { const n = new Set(prev); n.add(key); return n; });
  };

  const handleToggle = (key: string, val: boolean) => {
    handleChange(key, val ? "on" : "off");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const changed = Array.from(dirtyKeys).map(key => ({ key, value: localValues[key] ?? "" }));
      await fetcher("/platform-settings", {
        method: "PUT",
        body: JSON.stringify({ settings: changed }),
      });
      setDirtyKeys(new Set());
      toast({ title: "Settings saved! ✅", description: `${changed.length} change(s) applied instantly across the app.` });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const handleReset = async () => {
    await loadSettings();
    toast({ title: "Settings reloaded" });
  };

  const grouped: Record<string, Setting[]> = {};
  for (const s of settings) {
    if (!grouped[s.category]) grouped[s.category] = [];
    grouped[s.category].push(s);
  }

  const getInputType = (key: string) => {
    if (key === "app_status" || key === "app_name" || key === "support_phone") return "text";
    return "number";
  };

  const getInputSuffix = (key: string) => {
    if (key.includes("pct") || key.includes("_pct")) return "%";
    if (key.includes("phone") || key === "app_name" || key === "app_status") return "";
    if (key.includes("_km") || key === "rider_acceptance_km") return "KM";
    if (key.includes("_day") || key.includes("_days")) return "days";
    if (key.includes("_pts") || key.includes("_items") || key.includes("_deliveries")) return "#";
    return "Rs.";
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-64 bg-muted rounded-lg" />
        {[1,2,3,4].map(i => <div key={i} className="h-40 bg-muted rounded-2xl" />)}
      </div>
    );
  }

  const catOrder = ["features","customer","rider","vendor","delivery","rides","finance","orders","general"];

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-slate-100 text-slate-600 rounded-xl flex items-center justify-center">
            <Settings2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">App Settings</h1>
            <p className="text-muted-foreground text-sm">Role-based controls — manage every function of the app</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleReset} disabled={loading} className="h-10 rounded-xl gap-2">
            <RefreshCw className="w-4 h-4" />
            Reset
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || dirtyKeys.size === 0}
            className="h-10 rounded-xl gap-2 shadow-md"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving..." : `Save${dirtyKeys.size > 0 ? ` (${dirtyKeys.size})` : ""}`}
          </Button>
        </div>
      </div>

      {/* Unsaved changes banner */}
      {dirtyKeys.size > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2 text-amber-800 text-sm font-medium">
          <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
          {dirtyKeys.size} unsaved change{dirtyKeys.size > 1 ? "s" : ""} — click Save to apply
        </div>
      )}

      {/* Category Cards */}
      {catOrder.map(cat => {
        const cfg = CATEGORY_CONFIG[cat];
        const catSettings = grouped[cat];
        if (!cfg || !catSettings || catSettings.length === 0) return null;
        const Icon = cfg.icon;
        const isFeatureCat = cat === "features";

        return (
          <Card key={cat} className="rounded-2xl border-border/50 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-border/50 flex items-start gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
                <Icon className={`w-5 h-5 ${cfg.color}`} />
              </div>
              <div>
                <h2 className="font-bold text-foreground">{cfg.label}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{cfg.description}</p>
              </div>
            </div>
            <CardContent className="p-5">
              {isFeatureCat ? (
                /* Feature toggles — 2 columns grid */
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {catSettings.map(s => (
                    <ToggleSwitch
                      key={s.key}
                      checked={(localValues[s.key] ?? s.value) === "on"}
                      onChange={v => handleToggle(s.key, v)}
                      label={s.label}
                      icon={FEATURE_ICONS[s.key]}
                      isDirty={dirtyKeys.has(s.key)}
                    />
                  ))}
                </div>
              ) : (
                /* Regular settings — number/text inputs */
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {catSettings.map(s => {
                    const isDirty = dirtyKeys.has(s.key);
                    const isToggle = TOGGLE_KEYS.has(s.key);
                    const suffix = getInputSuffix(s.key);

                    if (isToggle) {
                      return (
                        <ToggleSwitch
                          key={s.key}
                          checked={(localValues[s.key] ?? s.value) === "on"}
                          onChange={v => handleToggle(s.key, v)}
                          label={s.label}
                          isDirty={isDirty}
                        />
                      );
                    }

                    return (
                      <div key={s.key} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <label className="text-sm font-semibold text-foreground">{s.label}</label>
                          {isDirty && (
                            <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold">
                              CHANGED
                            </Badge>
                          )}
                        </div>
                        <div className="relative">
                          <Input
                            type={getInputType(s.key)}
                            value={localValues[s.key] ?? s.value}
                            onChange={e => handleChange(s.key, e.target.value)}
                            className={`h-11 rounded-xl ${suffix ? "pr-14" : ""} ${isDirty ? "border-amber-300 bg-amber-50/50 ring-1 ring-amber-200" : ""}`}
                            min={0}
                          />
                          {suffix && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">
                              {suffix}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground font-mono">{s.key}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Info Card */}
      <Card className="rounded-2xl border-blue-200 bg-blue-50/50">
        <CardContent className="p-5 flex gap-3">
          <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-blue-800 mb-2">How Settings Work</h3>
            <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
              <li>All changes take effect <strong>immediately</strong> — no restart needed</li>
              <li><strong>Feature Toggles</strong> instantly enable/disable services app-wide</li>
              <li><strong>Customer</strong> settings control wallet, referral, and order limits</li>
              <li><strong>Rider</strong> settings control earnings split, radius, and payout rules</li>
              <li><strong>Vendor</strong> settings control commission, menu size, and settlement</li>
              <li>Delivery fees and ride fares auto-apply to all new transactions</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
