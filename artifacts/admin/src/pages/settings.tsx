import { useState, useEffect, useCallback } from "react";
import {
  Settings2, Save, RefreshCw, Truck, Car, BarChart3,
  ShoppingCart, Globe, Users, Bike, Store, Zap, Info,
  MessageSquare, Shield, Puzzle, Link, KeyRound,
  Wifi, AlertTriangle, CreditCard, CheckCircle2, XCircle,
  Loader2, Eye, EyeOff, ExternalLink, ChevronRight,
  Building2, Banknote, Wallet, Phone, FileText, Lock,
  ToggleRight, Settings, RotateCcw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetcher } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface Setting { key: string; value: string; label: string; category: string; }

const CAT_ORDER = [
  "features","customer","rider","vendor",
  "delivery","rides","finance","orders","general",
  "content","security","integrations","payment",
] as const;
type CatKey = typeof CAT_ORDER[number];

const CATEGORY_CONFIG: Record<CatKey, { label: string; icon: any; color: string; bg: string; activeBg: string; description: string }> = {
  features:     { label: "Feature Toggles",   icon: Zap,          color: "text-violet-600",  bg: "bg-violet-50",  activeBg: "bg-violet-600",  description: "Turn each service on or off instantly across the app" },
  customer:     { label: "Customer",           icon: Users,        color: "text-blue-600",    bg: "bg-blue-50",    activeBg: "bg-blue-600",    description: "Wallet limits, loyalty, referral bonuses and order caps" },
  rider:        { label: "Rider",              icon: Bike,         color: "text-green-600",   bg: "bg-green-50",   activeBg: "bg-green-600",   description: "Earnings %, acceptance radius, delivery limits and payouts" },
  vendor:       { label: "Vendor",             icon: Store,        color: "text-orange-600",  bg: "bg-orange-50",  activeBg: "bg-orange-600",  description: "Commission, menu limits, settlement and approval rules" },
  delivery:     { label: "Delivery Charges",   icon: Truck,        color: "text-sky-600",     bg: "bg-sky-50",     activeBg: "bg-sky-600",     description: "Delivery fees per service and free delivery threshold" },
  rides:        { label: "Ride Pricing",        icon: Car,          color: "text-teal-600",    bg: "bg-teal-50",    activeBg: "bg-teal-600",    description: "Base fare and per-km rates for bike and car rides" },
  finance:      { label: "Finance",            icon: BarChart3,    color: "text-purple-600",  bg: "bg-purple-50",  activeBg: "bg-purple-600",  description: "Platform-wide commission percentage" },
  orders:       { label: "Order Rules",        icon: ShoppingCart, color: "text-amber-600",   bg: "bg-amber-50",   activeBg: "bg-amber-600",   description: "Minimum order amounts and COD limits" },
  general:      { label: "General",            icon: Globe,        color: "text-gray-600",    bg: "bg-gray-50",    activeBg: "bg-gray-700",    description: "App name, support contact and maintenance mode" },
  content:      { label: "Content",            icon: MessageSquare,color: "text-pink-600",    bg: "bg-pink-50",    activeBg: "bg-pink-600",    description: "Banners, announcements, chat support and content links" },
  security:     { label: "Security & API",     icon: Shield,       color: "text-red-600",     bg: "bg-red-50",     activeBg: "bg-red-600",     description: "OTP modes, GPS tracking, rate limits and API credentials" },
  integrations: { label: "Integrations",       icon: Puzzle,       color: "text-indigo-600",  bg: "bg-indigo-50",  activeBg: "bg-indigo-600",  description: "Push notifications, analytics, email alerts and monitoring" },
  payment:      { label: "Payment Methods",    icon: CreditCard,   color: "text-emerald-600", bg: "bg-emerald-50", activeBg: "bg-emerald-600", description: "JazzCash, EasyPaisa, Bank Transfer, COD and AJK Wallet" },
};

const TOGGLE_KEYS = new Set([
  "feature_mart","feature_food","feature_rides","feature_pharmacy",
  "feature_parcel","feature_wallet","feature_referral","feature_new_users",
  "rider_cash_allowed","vendor_auto_approve",
  "feature_chat","feature_live_tracking","feature_reviews",
  "security_otp_bypass","security_gps_tracking",
  "integration_push_notif","integration_analytics","integration_email","integration_sentry","integration_whatsapp",
  "jazzcash_enabled","easypaisa_enabled","bank_enabled","cod_enabled",
  "payment_auto_cancel",
]);

const TEXT_KEYS = new Set([
  "app_name","app_status","support_phone",
  "content_banner","content_announcement","content_maintenance_msg","content_support_msg","content_tnc_url","content_privacy_url",
  "api_map_key","api_sms_gateway","api_firebase_key",
  "jazzcash_type","jazzcash_mode","jazzcash_merchant_id","jazzcash_password","jazzcash_salt","jazzcash_currency","jazzcash_return_url",
  "jazzcash_manual_name","jazzcash_manual_number","jazzcash_manual_instructions",
  "easypaisa_type","easypaisa_mode","easypaisa_store_id","easypaisa_merchant_id","easypaisa_hash_key","easypaisa_username","easypaisa_password",
  "easypaisa_manual_name","easypaisa_manual_number","easypaisa_manual_instructions",
  "bank_name","bank_account_title","bank_account_number","bank_iban","bank_branch_code","bank_instructions",
  "cod_restricted_areas","cod_notes",
  "wallet_topup_methods",
]);

const FEATURE_ICONS: Record<string,string> = {
  feature_mart:"🛒", feature_food:"🍔", feature_rides:"🚗", feature_pharmacy:"💊",
  feature_parcel:"📦", feature_wallet:"💰", feature_referral:"🎁", feature_new_users:"👤",
  integration_push_notif:"🔔", integration_analytics:"📊", integration_email:"📧", integration_sentry:"🐛", integration_whatsapp:"💬",
};

/* ─── Shared UI Atoms ────────────────────────────────────────────────────── */
function Toggle({ checked, onChange, label, icon, isDirty, danger, sub }: {
  checked: boolean; onChange: (v: boolean) => void;
  label: string; icon?: string; isDirty: boolean; danger?: boolean; sub?: string;
}) {
  return (
    <div onClick={() => onChange(!checked)}
      className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-all select-none
        ${checked ? danger ? "bg-red-50 border-red-300" : "bg-green-50 border-green-200" : "bg-white border-border hover:bg-muted/30"}
        ${isDirty ? "ring-2 ring-amber-300" : ""}`}
    >
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        {icon && <span className="text-xl flex-shrink-0">{icon}</span>}
        {danger && !icon && <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground leading-snug truncate">{label}</p>
          {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
          <p className={`text-xs font-bold ${checked ? (danger ? "text-red-600" : "text-green-600") : "text-muted-foreground"}`}>
            {checked ? (danger ? "⚠ ENABLED" : "● Active") : "○ Disabled"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
        {isDirty && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold hidden sm:flex">CHANGED</Badge>}
        <div className={`w-11 h-6 rounded-full relative transition-colors ${checked ? (danger ? "bg-red-500" : "bg-green-500") : "bg-gray-300"}`}>
          <div className={`w-5 h-5 bg-white rounded-full shadow absolute top-0.5 transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
        </div>
      </div>
    </div>
  );
}

function SecretInput({ label, value, onChange, placeholder, isDirty }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; isDirty: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <label className="text-xs font-semibold text-foreground">{label}</label>
        {isDirty && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold">CHANGED</Badge>}
        {value && !isDirty && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
      </div>
      <div className="relative">
        <Input type={show ? "text" : "password"} value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder || "Not configured"}
          className={`h-9 rounded-lg text-sm font-mono pr-8 ${isDirty ? "border-amber-300 bg-amber-50/50" : ""} ${!value ? "border-dashed" : ""}`}
        />
        <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
          {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, isDirty, type = "text", suffix, mono, hint }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; isDirty: boolean; type?: string;
  suffix?: string; mono?: boolean; hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <label className="text-xs font-semibold text-foreground">{label}</label>
        {isDirty && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold">CHANGED</Badge>}
        {value && !isDirty && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
      </div>
      <div className="relative">
        <Input type={type} value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder || ""}
          className={`h-9 rounded-lg text-sm ${mono ? "font-mono" : ""} ${suffix ? "pr-14" : ""} ${isDirty ? "border-amber-300 bg-amber-50/50" : ""} ${!value ? "border-dashed" : ""}`}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">{suffix}</span>}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SLabel({ children, icon: Icon }: { children: React.ReactNode; icon?: any }) {
  return (
    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
      {Icon && <Icon className="w-3.5 h-3.5" />} {children}
    </p>
  );
}

function ModeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold border transition-all ${
        active ? "bg-primary text-white border-primary shadow-sm" : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/60"
      }`}
    >{children}</button>
  );
}

/* ─── Payment Sub-tabs ────────────────────────────────────────────────────── */
type PayTab = "jazzcash" | "easypaisa" | "bank" | "cod" | "wallet" | "rules";

const PAY_TABS: { id: PayTab; label: string; icon: string; color: string; activeBg: string }[] = [
  { id: "jazzcash",  label: "JazzCash",    icon: "🔴", color: "text-red-600",     activeBg: "bg-red-500" },
  { id: "easypaisa", label: "EasyPaisa",   icon: "🟢", color: "text-green-600",   activeBg: "bg-green-600" },
  { id: "bank",      label: "Bank Transfer",icon:"🏦", color: "text-blue-600",    activeBg: "bg-blue-600" },
  { id: "cod",       label: "Cash on Delivery", icon:"💵", color: "text-amber-600", activeBg: "bg-amber-600" },
  { id: "wallet",    label: "AJK Wallet",  icon: "💰", color: "text-purple-600",  activeBg: "bg-purple-600" },
  { id: "rules",     label: "Payment Rules", icon:"⚙️", color: "text-gray-600",  activeBg: "bg-gray-700" },
];

/* ─── JazzCash & EasyPaisa unified gateway card ─────────────────────────── */
function GatewayCard({
  prefix, name, logo, accentColor, accentBg, accentBorder,
  localValues, dirtyKeys, handleChange, handleToggle,
}: {
  prefix: "jazzcash" | "easypaisa"; name: string; logo: string;
  accentColor: string; accentBg: string; accentBorder: string;
  localValues: Record<string,string>; dirtyKeys: Set<string>;
  handleChange: (k: string, v: string) => void;
  handleToggle: (k: string, v: boolean) => void;
}) {
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const enabled  = (localValues[`${prefix}_enabled`] ?? "off") === "on";
  const modeType = localValues[`${prefix}_type`] ?? "manual";    // "api" | "manual"
  const apiEnv   = localValues[`${prefix}_mode`]  ?? "sandbox";  // "sandbox" | "live"

  const v = (k: string) => localValues[`${prefix}_${k}`] ?? "";
  const d = (k: string) => dirtyKeys.has(`${prefix}_${k}`);
  const set = (k: string) => (val: string) => handleChange(`${prefix}_${k}`, val);

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await fetch(`/api/payments/test-connection/${prefix}`, {
        headers: { "x-admin-secret": localStorage.getItem("ajkmart_admin_token") || "" },
      });
      const data = await r.json() as any;
      setTestResult({ ok: data.ok, message: data.message });
      toast({ title: data.ok ? `${name} OK ✅` : `${name} not ready`, description: data.message, variant: data.ok ? "default" : "destructive" });
    } catch {
      setTestResult({ ok: false, message: "Connection failed — check if API server is running" });
    }
    setTesting(false);
  };

  return (
    <div className={`rounded-2xl border-2 ${accentBorder} overflow-hidden bg-white shadow-sm`}>
      {/* ── Header ── */}
      <div className={`${accentBg} px-5 py-4 flex items-center justify-between gap-3`}>
        <div className="flex items-center gap-3">
          <span className="text-4xl">{logo}</span>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className={`font-bold text-base ${accentColor}`}>{name}</h3>
              <Badge variant="outline" className={`text-[10px] font-bold border ${
                !enabled ? "bg-muted text-muted-foreground border-border" :
                modeType === "api"
                  ? apiEnv === "live" ? "bg-green-50 text-green-700 border-green-300" : "bg-yellow-50 text-yellow-700 border-yellow-300"
                  : "bg-blue-50 text-blue-700 border-blue-300"
              }`}>
                {!enabled ? "Off" : modeType === "api" ? (apiEnv === "live" ? "🟢 API Live" : "🟡 API Sandbox") : "🔵 Manual"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {prefix === "jazzcash" ? "Jazz/Mobilink mobile wallet payment" : "Telenor Microfinance mobile wallet payment"}
            </p>
          </div>
        </div>
        {/* Enable toggle */}
        <div onClick={() => handleToggle(`${prefix}_enabled`, !enabled)}
          className={`flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-xl border transition-all
            ${enabled ? "bg-green-50 border-green-300" : "bg-white/70 border-border"}`}
        >
          <div className={`w-10 h-5 rounded-full relative transition-colors ${enabled ? "bg-green-500" : "bg-gray-300"}`}>
            <div className={`w-4 h-4 bg-white rounded-full shadow absolute top-0.5 transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
          </div>
          <span className={`text-xs font-bold ${enabled ? "text-green-700" : "text-muted-foreground"}`}>
            {enabled ? "Active" : "Inactive"}
          </span>
        </div>
      </div>

      {/* Test result */}
      {testResult && (
        <div className={`px-5 py-2.5 flex items-center gap-2 text-sm border-b ${testResult.ok ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"}`}>
          {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          {testResult.message}
        </div>
      )}

      {/* ── Body ── */}
      <div className="p-5 space-y-5">
        {/* Mode type: API vs Manual */}
        <div>
          <SLabel icon={Settings}>Integration Mode</SLabel>
          <div className="flex gap-2">
            <ModeBtn active={modeType === "manual"} onClick={() => handleChange(`${prefix}_type`, "manual")}>
              📱 Manual Transfer
            </ModeBtn>
            <ModeBtn active={modeType === "api"} onClick={() => handleChange(`${prefix}_type`, "api")}>
              ⚡ API Integration
            </ModeBtn>
          </div>
        </div>

        {/* ── MANUAL MODE ── */}
        {modeType === "manual" && (
          <div className="space-y-4">
            <div className="bg-blue-50 rounded-xl px-4 py-3 border border-blue-200">
              <p className="text-xs text-blue-800 font-semibold mb-1">📱 Manual Transfer Mode</p>
              <p className="text-xs text-blue-700">
                Customer will see your {name} number and transfer manually. Admin verifies payment from transactions.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Account Holder Name" value={v("manual_name")} onChange={set("manual_name")} placeholder={`e.g. Muhammad Ali`} isDirty={d("manual_name")} hint="Name shown to customer" />
              <Field label={`${name} Number`} value={v("manual_number")} onChange={set("manual_number")} placeholder="03XX-XXXXXXX" isDirty={d("manual_number")} hint="Number customer will send to" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-foreground">Payment Instructions</label>
                {dirtyKeys.has(`${prefix}_manual_instructions`) && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold">CHANGED</Badge>}
              </div>
              <textarea
                value={localValues[`${prefix}_manual_instructions`] ?? ""}
                onChange={e => handleChange(`${prefix}_manual_instructions`, e.target.value)}
                rows={3}
                placeholder="Instructions shown to customer after payment..."
                className={`w-full rounded-lg border text-sm p-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 ${dirtyKeys.has(`${prefix}_manual_instructions`) ? "border-amber-300 bg-amber-50/50" : "border-border"}`}
              />
            </div>
          </div>
        )}

        {/* ── API MODE ── */}
        {modeType === "api" && (
          <div className="space-y-4">
            {/* API Environment */}
            <div>
              <SLabel>API Environment</SLabel>
              <div className="flex gap-2">
                {["sandbox","live"].map(env => (
                  <button key={env} onClick={() => handleChange(`${prefix}_mode`, env)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                      apiEnv === env
                        ? env === "live" ? "bg-green-500 text-white border-green-600 shadow-sm" : "bg-yellow-100 text-yellow-800 border-yellow-300"
                        : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/60"
                    }`}
                  >
                    {env === "live" ? "🟢 Live (Production)" : "🟡 Sandbox (Testing)"}
                  </button>
                ))}
              </div>
              {apiEnv === "live" && (
                <div className="flex items-center gap-1.5 mt-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  <strong>Live mode</strong> — Real money transactions. Verify all credentials carefully.
                </div>
              )}
              {apiEnv === "sandbox" && (
                <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 border border-emerald-200 mt-2">
                  ✅ Sandbox mode — payments simulated without real money. Safe for testing.
                </p>
              )}
            </div>

            {/* Credentials */}
            <div>
              <SLabel icon={KeyRound}>API Credentials</SLabel>
              {prefix === "jazzcash" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Merchant ID" value={v("merchant_id")} onChange={set("merchant_id")} placeholder="MC12345" isDirty={d("merchant_id")} mono />
                  <SecretInput label="Password" value={v("password")} onChange={set("password")} placeholder="••••••••" isDirty={d("password")} />
                  <SecretInput label="Integrity Salt (Hash Key)" value={v("salt")} onChange={set("salt")} placeholder="Your JazzCash salt" isDirty={d("salt")} />
                  <Field label="Currency" value={v("currency")} onChange={set("currency")} placeholder="PKR" isDirty={d("currency")} />
                  <div className="sm:col-span-2">
                    <Field label="Return URL (Callback)" value={v("return_url")} onChange={set("return_url")} placeholder="https://yourdomain.com/api/payments/callback/jazzcash" isDirty={d("return_url")} />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Store ID" value={v("store_id")} onChange={set("store_id")} placeholder="12345" isDirty={d("store_id")} mono />
                  <Field label="Merchant Account No." value={v("merchant_id")} onChange={set("merchant_id")} placeholder="03XX-XXXXXXX" isDirty={d("merchant_id")} />
                  <SecretInput label="Hash Key (Secret)" value={v("hash_key")} onChange={set("hash_key")} placeholder="••••••••" isDirty={d("hash_key")} />
                  <Field label="API Username" value={v("username")} onChange={set("username")} placeholder="easypaisa_api_user" isDirty={d("username")} mono />
                  <SecretInput label="API Password" value={v("password")} onChange={set("password")} placeholder="••••••••" isDirty={d("password")} />
                </div>
              )}
            </div>

            {/* Test connection */}
            <div className="flex items-center justify-between pt-2 border-t border-border/40">
              <div className="flex items-center gap-2">
                <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                <a href={prefix === "jazzcash"
                  ? "https://sandbox.jazzcash.com.pk/sandbox/documentation"
                  : "https://easypaystg.easypaisa.com.pk/easypay-service/rest/documentation"}
                  target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                  {name} Developer Docs
                </a>
              </div>
              <Button size="sm" variant="outline" onClick={handleTest} disabled={testing} className="h-8 rounded-lg text-xs gap-1.5">
                {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wifi className="w-3 h-3" />}
                {testing ? "Testing..." : "Test Connection"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Bank Transfer Section ──────────────────────────────────────────────── */
function BankSection({ localValues, dirtyKeys, handleChange, handleToggle }: {
  localValues: Record<string,string>; dirtyKeys: Set<string>;
  handleChange: (k: string, v: string) => void; handleToggle: (k: string, v: boolean) => void;
}) {
  const enabled = (localValues["bank_enabled"] ?? "off") === "on";
  const v = (k: string) => localValues[k] ?? "";
  const d = (k: string) => dirtyKeys.has(k);

  const BANKS = ["HBL","UBL","MCB","ABL","NBP","Meezan Bank","Bank Alfalah","Faysal Bank","Habib Metro","Summit Bank","Other"];

  return (
    <div className="rounded-2xl border-2 border-blue-200 overflow-hidden bg-white shadow-sm">
      {/* Header */}
      <div className="bg-blue-50 px-5 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-4xl">🏦</span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base text-blue-700">Bank Transfer</h3>
              <Badge variant="outline" className={`text-[10px] font-bold border ${enabled ? "bg-blue-50 text-blue-700 border-blue-300" : "bg-muted text-muted-foreground border-border"}`}>
                {enabled ? "● Active" : "○ Disabled"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Direct bank account transfer for large orders</p>
          </div>
        </div>
        <div onClick={() => handleToggle("bank_enabled", !enabled)}
          className={`flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-xl border transition-all ${enabled ? "bg-blue-50 border-blue-300" : "bg-white/70 border-border"}`}
        >
          <div className={`w-10 h-5 rounded-full relative transition-colors ${enabled ? "bg-blue-500" : "bg-gray-300"}`}>
            <div className={`w-4 h-4 bg-white rounded-full shadow absolute top-0.5 transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
          </div>
          <span className={`text-xs font-bold ${enabled ? "text-blue-700" : "text-muted-foreground"}`}>{enabled ? "Active" : "Inactive"}</span>
        </div>
      </div>
      <div className="p-5 space-y-4">
        <div className="bg-blue-50 rounded-xl px-4 py-3 border border-blue-100">
          <p className="text-xs text-blue-800">
            🏦 Customer transfers directly to your bank account. You verify the payment slip manually before confirming the order.
          </p>
        </div>
        {/* Bank name select */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Bank Name</label>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {BANKS.map(b => (
              <button key={b} onClick={() => handleChange("bank_name", b)}
                className={`py-2 px-2 text-xs font-semibold rounded-xl border transition-all truncate ${
                  v("bank_name") === b ? "bg-blue-600 text-white border-blue-700 shadow-sm" : "bg-muted/30 border-border text-foreground hover:bg-muted/60"
                }`}
              >{b}</button>
            ))}
          </div>
          {v("bank_name") === "Other" && (
            <Input value={v("bank_name")} onChange={e => handleChange("bank_name", e.target.value)}
              placeholder="Enter bank name" className={`h-9 rounded-lg text-sm mt-2 ${d("bank_name") ? "border-amber-300 bg-amber-50/50" : ""}`} />
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Account Title (Holder Name)" value={v("bank_account_title")} onChange={v2 => handleChange("bank_account_title", v2)} placeholder="e.g. Muhammad Ali Khan" isDirty={d("bank_account_title")} hint="Exactly as on bank account" />
          <Field label="Account Number" value={v("bank_account_number")} onChange={v2 => handleChange("bank_account_number", v2)} placeholder="0123-4567890-01" isDirty={d("bank_account_number")} mono />
          <div className="sm:col-span-2">
            <Field label="IBAN" value={v("bank_iban")} onChange={v2 => handleChange("bank_iban", v2)} placeholder="PK00XXXX0000000000000000" isDirty={d("bank_iban")} mono hint="International Bank Account Number (24 chars)" />
          </div>
          <Field label="Branch Code" value={v("bank_branch_code")} onChange={v2 => handleChange("bank_branch_code", v2)} placeholder="0001" isDirty={d("bank_branch_code")} mono />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-foreground">Transfer Instructions</label>
            {d("bank_instructions") && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold">CHANGED</Badge>}
          </div>
          <textarea value={v("bank_instructions")} onChange={e => handleChange("bank_instructions", e.target.value)}
            rows={3} placeholder="Instructions shown to customer..."
            className={`w-full rounded-lg border text-sm p-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 ${d("bank_instructions") ? "border-amber-300 bg-amber-50/50" : "border-border"}`}
          />
        </div>
      </div>
    </div>
  );
}

/* ─── COD Section ────────────────────────────────────────────────────────── */
function CODSection({ localValues, dirtyKeys, handleChange, handleToggle }: {
  localValues: Record<string,string>; dirtyKeys: Set<string>;
  handleChange: (k: string, v: string) => void; handleToggle: (k: string, v: boolean) => void;
}) {
  const enabled = (localValues["cod_enabled"] ?? "on") === "on";
  const v = (k: string) => localValues[k] ?? "";
  const d = (k: string) => dirtyKeys.has(k);

  return (
    <div className="rounded-2xl border-2 border-amber-200 overflow-hidden bg-white shadow-sm">
      <div className="bg-amber-50 px-5 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-4xl">💵</span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base text-amber-700">Cash on Delivery</h3>
              <Badge variant="outline" className={`text-[10px] font-bold border ${enabled ? "bg-green-50 text-green-700 border-green-300" : "bg-muted text-muted-foreground border-border"}`}>
                {enabled ? "● Active" : "○ Disabled"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Rider collects payment in cash at delivery</p>
          </div>
        </div>
        <div onClick={() => handleToggle("cod_enabled", !enabled)}
          className={`flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-xl border transition-all ${enabled ? "bg-green-50 border-green-300" : "bg-white/70 border-border"}`}
        >
          <div className={`w-10 h-5 rounded-full relative transition-colors ${enabled ? "bg-green-500" : "bg-gray-300"}`}>
            <div className={`w-4 h-4 bg-white rounded-full shadow absolute top-0.5 transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
          </div>
          <span className={`text-xs font-bold ${enabled ? "text-green-700" : "text-muted-foreground"}`}>{enabled ? "Active" : "Inactive"}</span>
        </div>
      </div>
      <div className="p-5 space-y-4">
        {/* Stats at a glance */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Max Order", value: `Rs. ${v("cod_max_amount") || "5000"}`, icon: "📦" },
            { label: "COD Fee", value: v("cod_fee") === "0" || !v("cod_fee") ? "Free" : `Rs. ${v("cod_fee")}`, icon: "🏷️" },
            { label: "Free Above", value: `Rs. ${v("cod_free_above") || "2000"}`, icon: "🎁" },
            { label: "Restricted", value: v("cod_restricted_areas") ? "Some areas" : "None", icon: "🚫" },
          ].map(s => (
            <div key={s.label} className="bg-amber-50/50 rounded-xl p-3 text-center border border-amber-100">
              <div className="text-xl mb-1">{s.icon}</div>
              <p className="text-xs font-bold text-foreground">{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Maximum COD Order (Rs.)" value={v("cod_max_amount")} onChange={v2 => handleChange("cod_max_amount", v2)} placeholder="5000" isDirty={d("cod_max_amount")} type="number" hint="Orders above this must pay online" />
          <Field label="COD Service Fee (Rs.)" value={v("cod_fee")} onChange={v2 => handleChange("cod_fee", v2)} placeholder="0" isDirty={d("cod_fee")} type="number" hint="Extra fee charged for COD orders" />
          <Field label="Free COD Above (Rs.)" value={v("cod_free_above")} onChange={v2 => handleChange("cod_free_above", v2)} placeholder="2000" isDirty={d("cod_free_above")} type="number" hint="No COD fee above this amount" />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-foreground">Restricted Areas (comma-separated)</label>
            {d("cod_restricted_areas") && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold">CHANGED</Badge>}
          </div>
          <Input value={v("cod_restricted_areas")} onChange={e => handleChange("cod_restricted_areas", e.target.value)}
            placeholder="e.g. Rawalpindi, Islamabad (leave empty for all areas)"
            className={`h-9 rounded-lg text-sm ${d("cod_restricted_areas") ? "border-amber-300 bg-amber-50/50" : "border-dashed"}`}
          />
          <p className="text-[11px] text-muted-foreground">Areas where COD is NOT available. Leave empty for all areas.</p>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-foreground">Customer Instructions</label>
            {d("cod_notes") && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold">CHANGED</Badge>}
          </div>
          <textarea value={v("cod_notes")} onChange={e => handleChange("cod_notes", e.target.value)}
            rows={2} placeholder="Message shown to customer when they select COD..."
            className={`w-full rounded-lg border text-sm p-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 ${d("cod_notes") ? "border-amber-300 bg-amber-50/50" : "border-border"}`}
          />
        </div>
      </div>
    </div>
  );
}

/* ─── AJK Wallet Section ─────────────────────────────────────────────────── */
function WalletSection({ localValues, dirtyKeys, handleChange, handleToggle }: {
  localValues: Record<string,string>; dirtyKeys: Set<string>;
  handleChange: (k: string, v: string) => void; handleToggle: (k: string, v: boolean) => void;
}) {
  const enabled = (localValues["feature_wallet"] ?? "on") === "on";
  const v = (k: string) => localValues[k] ?? "";
  const d = (k: string) => dirtyKeys.has(k);
  const methods = v("wallet_topup_methods").split(",").map(m => m.trim()).filter(Boolean);
  const METHODS = ["jazzcash","easypaisa","bank","cash","rider"];

  const toggleMethod = (m: string) => {
    const current = methods.includes(m) ? methods.filter(x => x !== m) : [...methods, m];
    handleChange("wallet_topup_methods", current.join(","));
  };

  const METHOD_LABELS: Record<string,string> = {
    jazzcash: "JazzCash 🔴", easypaisa: "EasyPaisa 🟢",
    bank: "Bank Transfer 🏦", cash: "Cash Deposit 💵", rider: "Via Rider 🛵",
  };

  return (
    <div className="rounded-2xl border-2 border-purple-200 overflow-hidden bg-white shadow-sm">
      <div className="bg-purple-50 px-5 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-4xl">💰</span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base text-purple-700">AJK Wallet</h3>
              <Badge variant="outline" className={`text-[10px] font-bold border ${enabled ? "bg-green-50 text-green-700 border-green-300" : "bg-muted text-muted-foreground border-border"}`}>
                {enabled ? "● Active" : "○ Disabled"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Digital wallet for instant payments within the app</p>
          </div>
        </div>
        <div onClick={() => handleToggle("feature_wallet", !enabled)}
          className={`flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-xl border transition-all ${enabled ? "bg-purple-50 border-purple-300" : "bg-white/70 border-border"}`}
        >
          <div className={`w-10 h-5 rounded-full relative transition-colors ${enabled ? "bg-purple-500" : "bg-gray-300"}`}>
            <div className={`w-4 h-4 bg-white rounded-full shadow absolute top-0.5 transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
          </div>
          <span className={`text-xs font-bold ${enabled ? "text-purple-700" : "text-muted-foreground"}`}>{enabled ? "Active" : "Inactive"}</span>
        </div>
      </div>
      <div className="p-5 space-y-5">
        {/* Quick stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Max Balance", value: `Rs. ${v("wallet_max_balance") || "50000"}`, icon: "💎" },
            { label: "Daily Limit", value: `Rs. ${v("wallet_daily_limit") || "20000"}`, icon: "📅" },
            { label: "Cashback", value: `${v("wallet_cashback_pct") || "0"}%`, icon: "🎁" },
            { label: "Min Top-Up", value: `Rs. ${v("wallet_min_topup") || "100"}`, icon: "⬆️" },
          ].map(s => (
            <div key={s.label} className="bg-purple-50/60 rounded-xl p-3 text-center border border-purple-100">
              <div className="text-xl mb-1">{s.icon}</div>
              <p className="text-xs font-bold text-foreground">{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Limits grid */}
        <div>
          <SLabel icon={Banknote}>Balance & Limits</SLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Maximum Wallet Balance (Rs.)" value={v("wallet_max_balance")} onChange={v2 => handleChange("wallet_max_balance", v2)} placeholder="50000" isDirty={d("wallet_max_balance")} type="number" hint="Max a customer can hold" />
            <Field label="Daily Transaction Limit (Rs.)" value={v("wallet_daily_limit")} onChange={v2 => handleChange("wallet_daily_limit", v2)} placeholder="20000" isDirty={d("wallet_daily_limit")} type="number" hint="Total per day (in + out)" />
          </div>
        </div>

        <div>
          <SLabel>Top-Up Rules</SLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Minimum Top-Up (Rs.)" value={v("wallet_min_topup")} onChange={v2 => handleChange("wallet_min_topup", v2)} placeholder="100" isDirty={d("wallet_min_topup")} type="number" />
            <Field label="Maximum Single Top-Up (Rs.)" value={v("wallet_max_topup")} onChange={v2 => handleChange("wallet_max_topup", v2)} placeholder="25000" isDirty={d("wallet_max_topup")} type="number" />
          </div>
        </div>

        <div>
          <SLabel>Withdrawal Rules</SLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Minimum Withdrawal (Rs.)" value={v("wallet_min_withdrawal")} onChange={v2 => handleChange("wallet_min_withdrawal", v2)} placeholder="200" isDirty={d("wallet_min_withdrawal")} type="number" />
            <Field label="Maximum Single Withdrawal (Rs.)" value={v("wallet_max_withdrawal")} onChange={v2 => handleChange("wallet_max_withdrawal", v2)} placeholder="10000" isDirty={d("wallet_max_withdrawal")} type="number" />
          </div>
        </div>

        <div>
          <SLabel>Rewards & Bonuses</SLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Wallet Cashback (%)" value={v("wallet_cashback_pct")} onChange={v2 => handleChange("wallet_cashback_pct", v2)} placeholder="0" isDirty={d("wallet_cashback_pct")} type="number" hint="% cashback on wallet payments" suffix="%" />
            <Field label="Referral Bonus to Wallet (Rs.)" value={v("wallet_referral_bonus")} onChange={v2 => handleChange("wallet_referral_bonus", v2)} placeholder="100" isDirty={d("wallet_referral_bonus")} type="number" hint="Credited when referral joins" />
          </div>
        </div>

        <div>
          <SLabel icon={Phone}>Accepted Top-Up Methods</SLabel>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {METHODS.map(m => (
              <button key={m} onClick={() => toggleMethod(m)}
                className={`py-2.5 px-3 text-xs font-semibold rounded-xl border transition-all text-left ${
                  methods.includes(m) ? "bg-purple-600 text-white border-purple-700 shadow-sm" : "bg-muted/30 border-border text-foreground hover:bg-muted/60"
                }`}
              >
                {METHOD_LABELS[m]}
              </button>
            ))}
          </div>
          {d("wallet_topup_methods") && <p className="text-[11px] text-amber-600 mt-1.5">● Unsaved changes</p>}
          <p className="text-[11px] text-muted-foreground mt-1">Methods customers can use to add money to their wallet</p>
        </div>
      </div>
    </div>
  );
}

/* ─── Payment Rules Section ──────────────────────────────────────────────── */
function PaymentRules({ localValues, dirtyKeys, handleChange, handleToggle }: {
  localValues: Record<string,string>; dirtyKeys: Set<string>;
  handleChange: (k: string, v: string) => void; handleToggle: (k: string, v: boolean) => void;
}) {
  const autoCancelOn = (localValues["payment_auto_cancel"] ?? "on") === "on";
  const v = (k: string) => localValues[k] ?? "";
  const d = (k: string) => dirtyKeys.has(k);

  return (
    <div className="space-y-4">
      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
        <p className="text-xs text-slate-600 font-medium">⚙️ Global rules that apply to all payment methods across the platform.</p>
      </div>
      <Toggle
        checked={autoCancelOn}
        onChange={v2 => handleToggle("payment_auto_cancel", v2)}
        label="Auto-Cancel Unpaid Orders"
        sub="Automatically cancel orders that are not paid within the timeout period"
        isDirty={d("payment_auto_cancel")}
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Payment Timeout (minutes)" value={v("payment_timeout_mins")} onChange={v2 => handleChange("payment_timeout_mins", v2)} placeholder="15" isDirty={d("payment_timeout_mins")} type="number" suffix="min" hint="Time to complete online payment" />
        <Field label="Minimum Online Payment (Rs.)" value={v("payment_min_online")} onChange={v2 => handleChange("payment_min_online", v2)} placeholder="50" isDirty={d("payment_min_online")} type="number" hint="Below this: only COD or wallet" />
        <Field label="Maximum Online Payment (Rs.)" value={v("payment_max_online")} onChange={v2 => handleChange("payment_max_online", v2)} placeholder="100000" isDirty={d("payment_max_online")} type="number" hint="Above this: contact support" />
      </div>
    </div>
  );
}

/* ─── Full Payment Section (with sub-tabs) ───────────────────────────────── */
function PaymentSection({ localValues, dirtyKeys, handleChange, handleToggle }: {
  localValues: Record<string,string>; dirtyKeys: Set<string>;
  handleChange: (k: string, v: string) => void; handleToggle: (k: string, v: boolean) => void;
}) {
  const [payTab, setPayTab] = useState<PayTab>("jazzcash");

  const activeMethods = PAY_TABS.filter(t => {
    if (t.id === "jazzcash") return (localValues["jazzcash_enabled"] ?? "off") === "on";
    if (t.id === "easypaisa") return (localValues["easypaisa_enabled"] ?? "off") === "on";
    if (t.id === "bank") return (localValues["bank_enabled"] ?? "off") === "on";
    if (t.id === "cod") return (localValues["cod_enabled"] ?? "on") === "on";
    if (t.id === "wallet") return (localValues["feature_wallet"] ?? "on") === "on";
    return true;
  });

  const PAY_DIRTY: Partial<Record<PayTab, number>> = {};
  for (const k of dirtyKeys) {
    if (k.startsWith("jazzcash")) PAY_DIRTY.jazzcash = (PAY_DIRTY.jazzcash || 0) + 1;
    else if (k.startsWith("easypaisa")) PAY_DIRTY.easypaisa = (PAY_DIRTY.easypaisa || 0) + 1;
    else if (k.startsWith("bank")) PAY_DIRTY.bank = (PAY_DIRTY.bank || 0) + 1;
    else if (k.startsWith("cod")) PAY_DIRTY.cod = (PAY_DIRTY.cod || 0) + 1;
    else if (k.startsWith("wallet") || k === "feature_wallet") PAY_DIRTY.wallet = (PAY_DIRTY.wallet || 0) + 1;
    else if (k.startsWith("payment")) PAY_DIRTY.rules = (PAY_DIRTY.rules || 0) + 1;
  }

  return (
    <div className="space-y-4">
      {/* Active methods summary */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {PAY_TABS.map(t => {
          const isOn = activeMethods.find(m => m.id === t.id);
          return (
            <button key={t.id} onClick={() => setPayTab(t.id)}
              className={`rounded-xl p-2.5 text-center border transition-all ${
                payTab === t.id
                  ? `${t.activeBg} text-white border-transparent shadow-md`
                  : isOn ? "bg-white border-green-200 hover:border-green-300" : "bg-muted/20 border-border/50 opacity-60 hover:opacity-80"
              }`}
            >
              <div className="text-xl mb-1">{t.icon}</div>
              <p className={`text-[10px] font-bold leading-tight ${payTab === t.id ? "text-white" : "text-foreground"}`}>{t.label}</p>
              {(PAY_DIRTY[t.id] ?? 0) > 0 && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold mt-1 inline-block ${payTab === t.id ? "bg-white/25 text-white" : "bg-amber-100 text-amber-700"}`}>
                  {PAY_DIRTY[t.id]} changed
                </span>
              )}
              {isOn && payTab !== t.id && !(PAY_DIRTY[t.id] ?? 0) && (
                <p className="text-[9px] text-green-600 font-bold mt-0.5">● ON</p>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div>
        {payTab === "jazzcash" && (
          <GatewayCard prefix="jazzcash" name="JazzCash" logo="🔴" accentColor="text-red-700" accentBg="bg-red-50" accentBorder="border-red-200"
            localValues={localValues} dirtyKeys={dirtyKeys} handleChange={handleChange} handleToggle={handleToggle} />
        )}
        {payTab === "easypaisa" && (
          <GatewayCard prefix="easypaisa" name="EasyPaisa" logo="🟢" accentColor="text-green-700" accentBg="bg-green-50" accentBorder="border-green-200"
            localValues={localValues} dirtyKeys={dirtyKeys} handleChange={handleChange} handleToggle={handleToggle} />
        )}
        {payTab === "bank" && (
          <BankSection localValues={localValues} dirtyKeys={dirtyKeys} handleChange={handleChange} handleToggle={handleToggle} />
        )}
        {payTab === "cod" && (
          <CODSection localValues={localValues} dirtyKeys={dirtyKeys} handleChange={handleChange} handleToggle={handleToggle} />
        )}
        {payTab === "wallet" && (
          <WalletSection localValues={localValues} dirtyKeys={dirtyKeys} handleChange={handleChange} handleToggle={handleToggle} />
        )}
        {payTab === "rules" && (
          <PaymentRules localValues={localValues} dirtyKeys={dirtyKeys} handleChange={handleChange} handleToggle={handleToggle} />
        )}
      </div>
    </div>
  );
}

/* ─── Other section renderers ────────────────────────────────────────────── */
function renderSection(
  cat: CatKey, catSettings: Setting[],
  localValues: Record<string,string>, dirtyKeys: Set<string>,
  handleChange: (k: string, v: string) => void,
  handleToggle: (k: string, v: boolean) => void,
  getInputType: (k: string) => string,
  getInputSuffix: (k: string) => string,
  getPlaceholder: (k: string) => string,
) {
  const toggles = catSettings.filter(s => TOGGLE_KEYS.has(s.key));
  const inputs  = catSettings.filter(s => !TOGGLE_KEYS.has(s.key));

  const NumField = ({ s }: { s: Setting }) => {
    const isDirty = dirtyKeys.has(s.key);
    const suffix = getInputSuffix(s.key);
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-foreground">{s.label}</label>
          {isDirty && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold">CHANGED</Badge>}
        </div>
        <div className="relative">
          <Input type={getInputType(s.key)} value={localValues[s.key] ?? s.value} onChange={e => handleChange(s.key, e.target.value)}
            placeholder={getPlaceholder(s.key)}
            className={`h-10 rounded-xl ${suffix ? "pr-16" : ""} ${isDirty ? "border-amber-300 bg-amber-50/50 ring-1 ring-amber-200" : ""}`}
            min={0}
          />
          {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">{suffix}</span>}
        </div>
        <p className="text-[11px] text-muted-foreground font-mono">{s.key}</p>
      </div>
    );
  };

  if (cat === "features" || cat === "integrations") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {catSettings.map(s => (
          <Toggle key={s.key} checked={(localValues[s.key] ?? s.value) === "on"}
            onChange={v => handleToggle(s.key, v)} label={s.label} icon={FEATURE_ICONS[s.key]} isDirty={dirtyKeys.has(s.key)} />
        ))}
      </div>
    );
  }

  if (cat === "security") {
    return (
      <div className="space-y-5">
        {toggles.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {toggles.map(s => (
              <Toggle key={s.key} checked={(localValues[s.key] ?? s.value) === "on"}
                onChange={v => handleToggle(s.key, v)} label={s.label} isDirty={dirtyKeys.has(s.key)} danger={s.key === "security_otp_bypass"} />
            ))}
          </div>
        )}
        {inputs.length > 0 && (
          <div className="border-t border-border/40 pt-4">
            <SLabel icon={KeyRound}>API Credentials & Keys</SLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {inputs.map(s => {
                const isDirty = dirtyKeys.has(s.key);
                return (
                  <div key={s.key} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-semibold text-foreground">{s.label}</label>
                      {isDirty && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold">CHANGED</Badge>}
                    </div>
                    <Input type="text" value={localValues[s.key] ?? s.value} onChange={e => handleChange(s.key, e.target.value)}
                      placeholder={getPlaceholder(s.key)}
                      className={`h-10 rounded-xl font-mono text-sm ${isDirty ? "border-amber-300 bg-amber-50/50" : ""}`}
                    />
                    {s.key.startsWith("api_") && !(localValues[s.key] ?? s.value) && (
                      <p className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Not configured</p>
                    )}
                    <p className="text-[11px] text-muted-foreground font-mono">{s.key}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (cat === "content") {
    return (
      <div className="space-y-5">
        {toggles.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {toggles.map(s => (
              <Toggle key={s.key} checked={(localValues[s.key] ?? s.value) === "on"}
                onChange={v => handleToggle(s.key, v)} label={s.label} isDirty={dirtyKeys.has(s.key)} />
            ))}
          </div>
        )}
        {inputs.length > 0 && (
          <div className={toggles.length > 0 ? "border-t border-border/40 pt-4" : ""}>
            <SLabel icon={MessageSquare}>Text Content & Links</SLabel>
            <div className="grid grid-cols-1 gap-4">
              {inputs.map(s => {
                const isDirty = dirtyKeys.has(s.key);
                return (
                  <div key={s.key} className="space-y-2">
                    <div className="flex items-center gap-2">
                      {s.key.includes("_url") && <Link className="w-3.5 h-3.5 text-muted-foreground" />}
                      <label className="text-sm font-semibold text-foreground">{s.label}</label>
                      {isDirty && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold">CHANGED</Badge>}
                    </div>
                    <Input type="text" value={localValues[s.key] ?? s.value} onChange={e => handleChange(s.key, e.target.value)}
                      placeholder={getPlaceholder(s.key)}
                      className={`h-10 rounded-xl ${isDirty ? "border-amber-300 bg-amber-50/50" : ""}`}
                    />
                    <p className="text-[11px] text-muted-foreground font-mono">{s.key}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Default
  return (
    <div className="space-y-5">
      {toggles.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {toggles.map(s => (
            <Toggle key={s.key} checked={(localValues[s.key] ?? s.value) === "on"}
              onChange={v => handleToggle(s.key, v)} label={s.label} isDirty={dirtyKeys.has(s.key)} />
          ))}
        </div>
      )}
      {inputs.length > 0 && (
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-5 ${toggles.length > 0 ? "border-t border-border/40 pt-4" : ""}`}>
          {inputs.map(s => <NumField key={s.key} s={s} />)}
        </div>
      )}
    </div>
  );
}

/* ─── Main Settings Page ─────────────────────────────────────────────────── */
export default function SettingsPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [localValues, setLocalValues] = useState<Record<string,string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<CatKey>("features");

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetcher("/platform-settings");
      setSettings(data.settings || []);
      const vals: Record<string,string> = {};
      for (const s of data.settings || []) vals[s.key] = s.value;
      setLocalValues(vals);
      setDirtyKeys(new Set());
    } catch (e: any) {
      toast({ title: "Failed to load settings", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const handleChange = (key: string, value: string) => {
    setLocalValues(prev => ({ ...prev, [key]: value }));
    setDirtyKeys(prev => { const n = new Set(prev); n.add(key); return n; });
  };
  const handleToggle = (key: string, val: boolean) => handleChange(key, val ? "on" : "off");

  const handleSave = async () => {
    setSaving(true);
    try {
      const changed = Array.from(dirtyKeys).map(key => ({ key, value: localValues[key] ?? "" }));
      await fetcher("/platform-settings", { method: "PUT", body: JSON.stringify({ settings: changed }) });
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
    if (key === "api_map_key") return "AIza...";
    if (key === "api_firebase_key") return "AAAA...";
    if (key === "api_sms_gateway") return "console";
    if (key.includes("_url")) return "https://...";
    if (key === "content_announcement") return "Leave empty to hide";
    return "";
  };

  const activeCfg = CATEGORY_CONFIG[activeTab];
  const ActiveIcon = activeCfg.icon;
  const activeSettings = grouped[activeTab] || [];

  const dirtyCounts: Record<string,number> = {};
  for (const k of dirtyKeys) {
    const s = settings.find(x => x.key === k);
    if (s) dirtyCounts[s.category] = (dirtyCounts[s.category] || 0) + 1;
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
          <Button onClick={handleSave} disabled={saving || dirtyKeys.size === 0} className="h-9 rounded-xl gap-2 shadow-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? "Saving..." : `Save${dirtyKeys.size > 0 ? ` (${dirtyKeys.size})` : ""}`}
          </Button>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="flex gap-4 items-start">
        {/* LEFT sidebar */}
        <div className="w-52 flex-shrink-0 bg-white rounded-2xl border border-border/60 shadow-sm overflow-hidden sticky top-4">
          <div className="px-3 pt-3 pb-1">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-2 mb-1">Sections</p>
          </div>
          <nav className="p-2 space-y-0.5">
            {CAT_ORDER.map(cat => {
              const cfg = CATEGORY_CONFIG[cat];
              const Icon = cfg.icon;
              const isActive = activeTab === cat;
              const count = grouped[cat]?.length ?? 0;
              const dirty = dirtyCounts[cat] || 0;
              if (count === 0 && cat !== "payment") return null;
              return (
                <button key={cat} onClick={() => setActiveTab(cat)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all group ${
                    isActive ? `${cfg.activeBg} text-white shadow-sm` : "hover:bg-muted/50 text-foreground"
                  }`}
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${isActive ? "bg-white/20" : cfg.bg}`}>
                    <Icon className={`w-3.5 h-3.5 ${isActive ? "text-white" : cfg.color}`} />
                  </div>
                  <span className={`text-xs font-semibold flex-1 truncate ${isActive ? "text-white" : "text-foreground"}`}>{cfg.label}</span>
                  {dirty > 0
                    ? <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? "bg-white/25 text-white" : "bg-amber-100 text-amber-700"}`}>{dirty}</span>
                    : <ChevronRight className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? "text-white/60" : "text-muted-foreground/30 group-hover:text-muted-foreground/60"}`} />
                  }
                </button>
              );
            })}
          </nav>
          <div className="p-3 border-t border-border/40">
            <p className="text-[10px] text-muted-foreground text-center">{settings.length} settings · {Object.keys(grouped).length} sections</p>
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
                />
              ) : activeSettings.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Settings2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No settings in this section</p>
                </div>
              ) : renderSection(
                activeTab, activeSettings, localValues, dirtyKeys,
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
