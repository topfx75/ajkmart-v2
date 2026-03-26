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
  "jazzcash_enabled","jazzcash_proof_required",
  "easypaisa_enabled","easypaisa_proof_required",
  "bank_enabled","bank_proof_required",
  "cod_enabled","cod_allowed_mart","cod_allowed_food","cod_allowed_pharmacy","cod_allowed_parcel","cod_fake_penalty",
  "payment_auto_cancel","payment_receipt_required",
  "wallet_p2p_enabled","wallet_kyc_required",
  "wallet_cashback_on_orders","wallet_cashback_on_rides","wallet_cashback_on_pharmacy",
]);

const TEXT_KEYS = new Set([
  "app_name","app_status","support_phone",
  "content_banner","content_announcement","content_maintenance_msg","content_support_msg","content_tnc_url","content_privacy_url",
  "api_map_key","api_sms_gateway","api_firebase_key",
  "jazzcash_type","jazzcash_mode","jazzcash_merchant_id","jazzcash_password","jazzcash_salt","jazzcash_currency","jazzcash_return_url",
  "jazzcash_manual_name","jazzcash_manual_number","jazzcash_manual_instructions",
  "easypaisa_type","easypaisa_mode","easypaisa_store_id","easypaisa_merchant_id","easypaisa_hash_key","easypaisa_username","easypaisa_password",
  "easypaisa_manual_name","easypaisa_manual_number","easypaisa_manual_instructions",
  "bank_name","bank_account_title","bank_account_number","bank_iban","bank_branch_code","bank_swift_code","bank_instructions",
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
  prefix, name, logo, accentColor, accentBg, accentBorder, accentBtn,
  localValues, dirtyKeys, handleChange, handleToggle,
}: {
  prefix: "jazzcash" | "easypaisa"; name: string; logo: string;
  accentColor: string; accentBg: string; accentBorder: string; accentBtn: string;
  localValues: Record<string,string>; dirtyKeys: Set<string>;
  handleChange: (k: string, v: string) => void;
  handleToggle: (k: string, v: boolean) => void;
}) {
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const enabled      = (localValues[`${prefix}_enabled`]        ?? "off") === "on";
  const modeType     = localValues[`${prefix}_type`]            ?? "manual";
  const apiEnv       = localValues[`${prefix}_mode`]            ?? "sandbox";
  const proofReq     = (localValues[`${prefix}_proof_required`] ?? "on")  === "on";

  const v   = (k: string) => localValues[`${prefix}_${k}`] ?? "";
  const d   = (k: string) => dirtyKeys.has(`${prefix}_${k}`);
  const set = (k: string) => (val: string) => handleChange(`${prefix}_${k}`, val);

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await fetch(`/api/payments/test-connection/${prefix}`, {
        headers: { "x-admin-secret": localStorage.getItem("ajkmart_admin_token") || "" },
      });
      const data = await r.json() as any;
      setTestResult({ ok: data.ok, message: data.message });
      toast({ title: data.ok ? `${name} Connected ✅` : `${name} Failed`, description: data.message, variant: data.ok ? "default" : "destructive" });
    } catch {
      setTestResult({ ok: false, message: "Connection failed — check if API server is running" });
    }
    setTesting(false);
  };

  const shortDesc = prefix === "jazzcash"
    ? "Jazz/Warid mobile wallet · Pakistan's #1 digital wallet"
    : "Telenor Microfinance · Telenor subscribers' mobile wallet";

  return (
    <div className={`rounded-2xl border-2 ${accentBorder} overflow-hidden bg-white shadow-sm`}>

      {/* ── Header ── */}
      <div className={`${accentBg} px-5 py-4 flex items-center justify-between gap-3`}>
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-4xl flex-shrink-0">{logo}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className={`font-bold text-base ${accentColor}`}>{name}</h3>
              <Badge variant="outline" className={`text-[10px] font-bold border flex-shrink-0 ${
                !enabled ? "bg-muted text-muted-foreground border-border" :
                modeType === "api"
                  ? apiEnv === "live" ? "bg-green-50 text-green-700 border-green-300" : "bg-yellow-50 text-yellow-700 border-yellow-300"
                  : "bg-blue-50 text-blue-700 border-blue-300"
              }`}>
                {!enabled ? "○ Off" : modeType === "api" ? (apiEnv === "live" ? "🟢 API Live" : "🟡 API Sandbox") : "🔵 Manual"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{shortDesc}</p>
          </div>
        </div>
        <div onClick={() => handleToggle(`${prefix}_enabled`, !enabled)}
          className={`flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-xl border transition-all flex-shrink-0
            ${enabled ? "bg-green-50 border-green-300" : "bg-white/70 border-border"}`}
        >
          <div className={`w-10 h-5 rounded-full relative transition-colors ${enabled ? "bg-green-500" : "bg-gray-300"}`}>
            <div className={`w-4 h-4 bg-white rounded-full shadow absolute top-0.5 transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
          </div>
          <span className={`text-xs font-bold ${enabled ? "text-green-700" : "text-muted-foreground"}`}>{enabled ? "Active" : "Inactive"}</span>
        </div>
      </div>

      {/* Test result banner */}
      {testResult && (
        <div className={`px-5 py-2.5 flex items-center gap-2 text-sm border-b ${testResult.ok ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"}`}>
          {testResult.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
          {testResult.message}
        </div>
      )}

      <div className="p-5 space-y-5">
        {/* ── Mode selector ── */}
        <div>
          <SLabel icon={Settings}>Integration Mode</SLabel>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => handleChange(`${prefix}_type`, "manual")}
              className={`relative py-3 px-4 rounded-xl border-2 text-left transition-all ${modeType === "manual" ? "bg-blue-600 border-blue-700 text-white shadow-md" : "bg-white border-border text-foreground hover:border-blue-300 hover:bg-blue-50/30"}`}
            >
              <p className="text-xs font-bold leading-tight">📱 Manual Transfer</p>
              <p className={`text-[10px] mt-0.5 ${modeType === "manual" ? "text-blue-100" : "text-muted-foreground"}`}>
                Admin ke number par send karein
              </p>
              {modeType === "manual" && <CheckCircle2 className="w-3.5 h-3.5 absolute top-2.5 right-2.5 text-blue-200" />}
            </button>
            <button onClick={() => handleChange(`${prefix}_type`, "api")}
              className={`relative py-3 px-4 rounded-xl border-2 text-left transition-all ${modeType === "api" ? `${accentBtn} border-transparent text-white shadow-md` : "bg-white border-border text-foreground hover:border-primary/40 hover:bg-primary/5"}`}
            >
              <p className="text-xs font-bold leading-tight">⚡ API Integration</p>
              <p className={`text-[10px] mt-0.5 ${modeType === "api" ? "text-white/70" : "text-muted-foreground"}`}>
                {name} portal se direct
              </p>
              {modeType === "api" && <CheckCircle2 className="w-3.5 h-3.5 absolute top-2.5 right-2.5 text-white/60" />}
            </button>
          </div>
        </div>

        {/* ── MANUAL MODE ── */}
        {modeType === "manual" && (
          <div className="space-y-4">
            <div className="bg-blue-50 rounded-xl px-4 py-3 border border-blue-200 flex gap-3">
              <div className="text-xl flex-shrink-0">📋</div>
              <div>
                <p className="text-xs text-blue-800 font-semibold">Manual Transfer Mode Active</p>
                <p className="text-xs text-blue-700 mt-0.5">
                  Customer apke {name} number par paise transfer karega. App mein aapka naam aur number dikh'ga. Admin manually payment verify karega.
                </p>
              </div>
            </div>

            {/* Account details */}
            <div>
              <SLabel icon={Phone}>Aapka {name} Account</SLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field
                  label="Account Holder Name"
                  value={v("manual_name")}
                  onChange={set("manual_name")}
                  placeholder="e.g. Muhammad Ali Khan"
                  isDirty={d("manual_name")}
                  hint="Customer ko yeh naam dikhega"
                />
                <Field
                  label={`${name} Number`}
                  value={v("manual_number")}
                  onChange={set("manual_number")}
                  placeholder="03XX-XXXXXXX"
                  isDirty={d("manual_number")}
                  hint="Customer is number par paise bhejega"
                  mono
                />
              </div>
            </div>

            {/* Proof required */}
            <div onClick={() => handleToggle(`${prefix}_proof_required`, !proofReq)}
              className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-all select-none
                ${proofReq ? "bg-orange-50 border-orange-200" : "bg-white border-border hover:bg-muted/30"}
                ${d("proof_required") ? "ring-2 ring-amber-300" : ""}`}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">📸 Payment Screenshot Required</p>
                <p className="text-xs text-muted-foreground mt-0.5">Customer ko payment screenshot ya transaction ID submit karna hoga</p>
                <p className={`text-xs font-bold mt-0.5 ${proofReq ? "text-orange-600" : "text-muted-foreground"}`}>{proofReq ? "● Zaruri hai" : "○ Optional"}</p>
              </div>
              <div className={`w-11 h-6 rounded-full relative transition-colors flex-shrink-0 ml-3 ${proofReq ? "bg-orange-500" : "bg-gray-300"}`}>
                <div className={`w-5 h-5 bg-white rounded-full shadow absolute top-0.5 transition-transform ${proofReq ? "translate-x-5" : "translate-x-0.5"}`} />
              </div>
            </div>

            {/* Instructions */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-foreground">Customer Instructions</label>
                {d("manual_instructions") && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold">CHANGED</Badge>}
              </div>
              <textarea
                value={localValues[`${prefix}_manual_instructions`] ?? ""}
                onChange={e => handleChange(`${prefix}_manual_instructions`, e.target.value)}
                rows={3}
                placeholder="Customer ko kya karna hoga..."
                className={`w-full rounded-lg border text-sm p-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 ${d("manual_instructions") ? "border-amber-300 bg-amber-50/50" : "border-border"}`}
              />
              <p className="text-[11px] text-muted-foreground">Yeh message customer ko payment method select karne ke baad dikhega</p>
            </div>

            {/* Payment limits */}
            <div>
              <SLabel>Payment Limits</SLabel>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Minimum (Rs.)" value={v("min_amount")} onChange={set("min_amount")} placeholder="100" isDirty={d("min_amount")} type="number" hint="Minimum payment via this method" />
                <Field label="Maximum (Rs.)" value={v("max_amount")} onChange={set("max_amount")} placeholder="50000" isDirty={d("max_amount")} type="number" hint="Maximum payment allowed" />
              </div>
            </div>

            {/* Customer preview */}
            <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50/30 p-4">
              <p className="text-[11px] font-bold text-blue-700 mb-2.5">👁 Customer App Preview</p>
              <div className="bg-white rounded-xl border border-blue-200 p-3 shadow-sm max-w-sm mx-auto">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">{logo}</span>
                  <div>
                    <p className="text-xs font-bold text-foreground">{name} — Manual Transfer</p>
                    <p className="text-[10px] text-muted-foreground">Haath se transfer karein</p>
                  </div>
                </div>
                {v("manual_name") || v("manual_number") ? (
                  <div className="bg-muted/40 rounded-lg p-2.5 space-y-1">
                    {v("manual_name") && <p className="text-[11px]"><span className="font-semibold">Naam:</span> {v("manual_name")}</p>}
                    {v("manual_number") && <p className="text-[11px] font-mono"><span className="font-semibold font-sans">Number:</span> {v("manual_number")}</p>}
                    {proofReq && <p className="text-[10px] text-orange-600 font-semibold">📸 Screenshot required</p>}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground italic">Account details set karein — customer ko yahan dikheinge</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── API MODE ── */}
        {modeType === "api" && (
          <div className="space-y-4">
            {/* API Environment */}
            <div>
              <SLabel>API Environment</SLabel>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "sandbox", label: "🟡 Sandbox", sub: "Test mode — real paisa nahi katega", cls: "bg-yellow-100 text-yellow-800 border-yellow-300" },
                  { id: "live",    label: "🟢 Live",    sub: "Production — real transactions",       cls: "bg-green-500 text-white border-green-600" },
                ].map(env => (
                  <button key={env.id} onClick={() => handleChange(`${prefix}_mode`, env.id)}
                    className={`py-2.5 px-3 rounded-xl text-sm font-semibold border-2 transition-all text-left ${
                      apiEnv === env.id ? env.cls + " shadow-sm" : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/60"
                    }`}
                  >
                    <p className="text-xs font-bold">{env.label}</p>
                    <p className={`text-[10px] mt-0.5 ${apiEnv === env.id && env.id === "live" ? "text-green-100" : "text-muted-foreground"}`}>{env.sub}</p>
                  </button>
                ))}
              </div>
              {apiEnv === "live" && (
                <div className="flex items-start gap-2 mt-2 text-xs text-amber-800 bg-amber-50 rounded-xl px-3 py-2.5 border border-amber-200">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span><strong>Live Mode:</strong> Real paise kat'te hain. Sab credentials achi tarah check karein pehle.</span>
                </div>
              )}
            </div>

            {/* Credentials */}
            <div>
              <SLabel icon={KeyRound}>API Credentials ({apiEnv === "sandbox" ? "Sandbox" : "Production"})</SLabel>
              {prefix === "jazzcash" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Merchant ID" value={v("merchant_id")} onChange={set("merchant_id")} placeholder="MC12345" isDirty={d("merchant_id")} mono />
                  <SecretInput label="Password" value={v("password")} onChange={set("password")} placeholder="••••••••" isDirty={d("password")} />
                  <SecretInput label="Integrity Salt (Hash Key)" value={v("salt")} onChange={set("salt")} placeholder="Your JazzCash salt" isDirty={d("salt")} />
                  <Field label="Currency" value={v("currency")} onChange={set("currency")} placeholder="PKR" isDirty={d("currency")} />
                  <div className="sm:col-span-2">
                    <Field label="Return / Callback URL" value={v("return_url")} onChange={set("return_url")} placeholder="https://yourdomain.com/api/payments/callback/jazzcash" isDirty={d("return_url")} hint="JazzCash portal mein yahi URL enter karein" />
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

            {/* Payment limits */}
            <div>
              <SLabel>Payment Limits</SLabel>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Minimum (Rs.)" value={v("min_amount")} onChange={set("min_amount")} placeholder="100" isDirty={d("min_amount")} type="number" />
                <Field label="Maximum (Rs.)" value={v("max_amount")} onChange={set("max_amount")} placeholder="50000" isDirty={d("max_amount")} type="number" />
              </div>
            </div>

            {/* Test connection */}
            <div className="flex items-center justify-between pt-2 border-t border-border/40">
              <a href={prefix === "jazzcash"
                ? "https://sandbox.jazzcash.com.pk/sandbox/documentation"
                : "https://easypaystg.easypaisa.com.pk/easypay-service/rest/documentation"}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
              >
                <ExternalLink className="w-3.5 h-3.5" /> {name} Developer Docs
              </a>
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
  const enabled   = (localValues["bank_enabled"]       ?? "off") === "on";
  const proofReq  = (localValues["bank_proof_required"] ?? "on") === "on";
  const v = (k: string) => localValues[k] ?? "";
  const d = (k: string) => dirtyKeys.has(k);

  const BANKS = ["HBL","UBL","MCB","ABL","NBP","Meezan Bank","Bank Alfalah","Faysal Bank","Habib Metro","Summit Bank","Other"];

  return (
    <div className="rounded-2xl border-2 border-blue-200 overflow-hidden bg-white shadow-sm">
      {/* Header */}
      <div className="bg-blue-50 px-5 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-4xl flex-shrink-0">🏦</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-base text-blue-700">Bank Transfer</h3>
              <Badge variant="outline" className={`text-[10px] font-bold border flex-shrink-0 ${enabled ? "bg-blue-50 text-blue-700 border-blue-300" : "bg-muted text-muted-foreground border-border"}`}>
                {enabled ? "● Active" : "○ Disabled"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Direct bank account transfer · Large amount orders</p>
          </div>
        </div>
        <div onClick={() => handleToggle("bank_enabled", !enabled)}
          className={`flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-xl border transition-all flex-shrink-0 ${enabled ? "bg-blue-50 border-blue-300" : "bg-white/70 border-border"}`}
        >
          <div className={`w-10 h-5 rounded-full relative transition-colors ${enabled ? "bg-blue-500" : "bg-gray-300"}`}>
            <div className={`w-4 h-4 bg-white rounded-full shadow absolute top-0.5 transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
          </div>
          <span className={`text-xs font-bold ${enabled ? "text-blue-700" : "text-muted-foreground"}`}>{enabled ? "Active" : "Inactive"}</span>
        </div>
      </div>

      <div className="p-5 space-y-5">
        <div className="bg-blue-50 rounded-xl px-4 py-3 border border-blue-100 flex gap-3">
          <span className="text-xl flex-shrink-0">🏦</span>
          <p className="text-xs text-blue-800">
            Customer directly apke bank account mein transfer karega. Aap payment slip verify karke order confirm karenge. Bara transactions ke liye best option.
          </p>
        </div>

        {/* Bank name select */}
        <div>
          <SLabel icon={Building2}>Bank Select Karein</SLabel>
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
              placeholder="Bank ka naam likhein" className={`h-9 rounded-lg text-sm mt-2 ${d("bank_name") ? "border-amber-300 bg-amber-50/50" : ""}`} />
          )}
        </div>

        {/* Account details */}
        <div>
          <SLabel icon={Banknote}>Account Details</SLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Account Title / Holder Name" value={v("bank_account_title")} onChange={v2 => handleChange("bank_account_title", v2)} placeholder="e.g. Muhammad Ali Khan" isDirty={d("bank_account_title")} hint="Bank account mein jo naam hai bilkul waisi spelling" />
            <Field label="Account Number" value={v("bank_account_number")} onChange={v2 => handleChange("bank_account_number", v2)} placeholder="0123-4567890-01" isDirty={d("bank_account_number")} mono />
            <div className="sm:col-span-2">
              <Field label="IBAN (International Bank Account Number)" value={v("bank_iban")} onChange={v2 => handleChange("bank_iban", v2)} placeholder="PK00XXXX0000000000000000" isDirty={d("bank_iban")} mono hint="24 characters — PK se shuru hota hai" />
            </div>
            <Field label="Branch Code" value={v("bank_branch_code")} onChange={v2 => handleChange("bank_branch_code", v2)} placeholder="0001" isDirty={d("bank_branch_code")} mono hint="4-digit branch code" />
            <Field label="SWIFT / BIC Code" value={v("bank_swift_code")} onChange={v2 => handleChange("bank_swift_code", v2)} placeholder="HABBPKKA" isDirty={d("bank_swift_code")} mono hint="International wire transfers ke liye" />
          </div>
        </div>

        {/* Settings */}
        <div>
          <SLabel>Transfer Settings</SLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Minimum Bank Transfer (Rs.)" value={v("bank_min_amount")} onChange={v2 => handleChange("bank_min_amount", v2)} placeholder="500" isDirty={d("bank_min_amount")} type="number" hint="Is se kum order bank se nahi hogi" />
            <Field label="Processing Time (hours)" value={v("bank_processing_hours")} onChange={v2 => handleChange("bank_processing_hours", v2)} placeholder="24" isDirty={d("bank_processing_hours")} type="number" hint="Payment verify hone mein kitna time lagta hai" suffix="hrs" />
          </div>
        </div>

        {/* Proof required toggle */}
        <div onClick={() => handleToggle("bank_proof_required", !proofReq)}
          className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-all select-none
            ${proofReq ? "bg-orange-50 border-orange-200" : "bg-white border-border hover:bg-muted/30"}
            ${d("bank_proof_required") ? "ring-2 ring-amber-300" : ""}`}
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">📄 Bank Slip / Screenshot Required</p>
            <p className="text-xs text-muted-foreground mt-0.5">Customer ko payment screenshot ya transaction reference submit karna hoga</p>
            <p className={`text-xs font-bold mt-0.5 ${proofReq ? "text-orange-600" : "text-muted-foreground"}`}>{proofReq ? "● Zaruri hai" : "○ Optional"}</p>
          </div>
          <div className={`w-11 h-6 rounded-full relative transition-colors flex-shrink-0 ml-3 ${proofReq ? "bg-orange-500" : "bg-gray-300"}`}>
            <div className={`w-5 h-5 bg-white rounded-full shadow absolute top-0.5 transition-transform ${proofReq ? "translate-x-5" : "translate-x-0.5"}`} />
          </div>
        </div>

        {/* Instructions */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-foreground">Customer Instructions</label>
            {d("bank_instructions") && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold">CHANGED</Badge>}
          </div>
          <textarea value={v("bank_instructions")} onChange={e => handleChange("bank_instructions", e.target.value)}
            rows={3} placeholder="Customer ko kya karna hoga — transfer ke baad kya steps hain..."
            className={`w-full rounded-lg border text-sm p-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 ${d("bank_instructions") ? "border-amber-300 bg-amber-50/50" : "border-border"}`}
          />
          <p className="text-[11px] text-muted-foreground">Yeh message customer ko bank transfer select karne ke baad dikhega</p>
        </div>

        {/* Preview */}
        {(v("bank_account_title") || v("bank_account_number") || v("bank_iban")) && (
          <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50/30 p-4">
            <p className="text-[11px] font-bold text-blue-700 mb-2.5">👁 Customer App Preview</p>
            <div className="bg-white rounded-xl border border-blue-200 p-3 shadow-sm max-w-sm mx-auto space-y-1.5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">🏦</span>
                <p className="text-xs font-bold">{v("bank_name") || "Bank Transfer"}</p>
              </div>
              {v("bank_account_title") && <p className="text-[11px]"><span className="font-semibold">Account:</span> {v("bank_account_title")}</p>}
              {v("bank_account_number") && <p className="text-[11px] font-mono"><span className="font-semibold font-sans">No.:</span> {v("bank_account_number")}</p>}
              {v("bank_iban") && <p className="text-[11px] font-mono"><span className="font-semibold font-sans">IBAN:</span> {v("bank_iban")}</p>}
              {proofReq && <p className="text-[10px] text-orange-600 font-semibold">📄 Slip screenshot required</p>}
              {v("bank_processing_hours") && <p className="text-[10px] text-muted-foreground">⏱ {v("bank_processing_hours")} hours mein confirm hogi</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── COD Section ────────────────────────────────────────────────────────── */
function CODSection({ localValues, dirtyKeys, handleChange, handleToggle }: {
  localValues: Record<string,string>; dirtyKeys: Set<string>;
  handleChange: (k: string, v: string) => void; handleToggle: (k: string, v: boolean) => void;
}) {
  const enabled     = (localValues["cod_enabled"]         ?? "on") === "on";
  const fakePenalty = (localValues["cod_fake_penalty"]    ?? "on") === "on";
  const martOn      = (localValues["cod_allowed_mart"]    ?? "on") === "on";
  const foodOn      = (localValues["cod_allowed_food"]    ?? "on") === "on";
  const pharmacyOn  = (localValues["cod_allowed_pharmacy"]?? "on") === "on";
  const parcelOn    = (localValues["cod_allowed_parcel"]  ?? "off") === "on";
  const v = (k: string) => localValues[k] ?? "";
  const d = (k: string) => dirtyKeys.has(k);

  const services = [
    { key: "cod_allowed_mart",     label: "Mart / Grocery",  icon: "🛒", on: martOn     },
    { key: "cod_allowed_food",     label: "Food Delivery",   icon: "🍔", on: foodOn     },
    { key: "cod_allowed_pharmacy", label: "Pharmacy",        icon: "💊", on: pharmacyOn },
    { key: "cod_allowed_parcel",   label: "Parcel Delivery", icon: "📦", on: parcelOn   },
  ];

  return (
    <div className="rounded-2xl border-2 border-amber-200 overflow-hidden bg-white shadow-sm">
      {/* Header */}
      <div className="bg-amber-50 px-5 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-4xl flex-shrink-0">💵</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-base text-amber-700">Cash on Delivery (COD)</h3>
              <Badge variant="outline" className={`text-[10px] font-bold border flex-shrink-0 ${enabled ? "bg-green-50 text-green-700 border-green-300" : "bg-muted text-muted-foreground border-border"}`}>
                {enabled ? "● Active" : "○ Disabled"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Rider delivery par cash wapas leta hai</p>
          </div>
        </div>
        <div onClick={() => handleToggle("cod_enabled", !enabled)}
          className={`flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-xl border transition-all flex-shrink-0 ${enabled ? "bg-green-50 border-green-300" : "bg-white/70 border-border"}`}
        >
          <div className={`w-10 h-5 rounded-full relative transition-colors ${enabled ? "bg-green-500" : "bg-gray-300"}`}>
            <div className={`w-4 h-4 bg-white rounded-full shadow absolute top-0.5 transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
          </div>
          <span className={`text-xs font-bold ${enabled ? "text-green-700" : "text-muted-foreground"}`}>{enabled ? "Active" : "Inactive"}</span>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Quick stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Max Order",   value: `Rs. ${v("cod_max_amount") || "5000"}`, icon: "📦" },
            { label: "COD Fee",     value: !v("cod_fee") || v("cod_fee") === "0" ? "Free" : `Rs. ${v("cod_fee")}`, icon: "🏷️" },
            { label: "Free Above",  value: `Rs. ${v("cod_free_above") || "2000"}`, icon: "🎁" },
            { label: "Services",    value: `${[martOn,foodOn,pharmacyOn,parcelOn].filter(Boolean).length}/4 on`, icon: "✅" },
          ].map(s => (
            <div key={s.label} className="bg-amber-50/50 rounded-xl p-3 text-center border border-amber-100">
              <div className="text-xl mb-1">{s.icon}</div>
              <p className="text-xs font-bold text-foreground">{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Service availability */}
        <div>
          <SLabel>COD Kaun Si Services Mein Available Hai</SLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {services.map(s => (
              <button key={s.key} onClick={() => handleToggle(s.key, !s.on)}
                className={`relative py-3 px-3 rounded-xl border-2 text-left transition-all ${
                  s.on
                    ? "bg-green-50 border-green-400 shadow-sm"
                    : "bg-muted/20 border-border/60 opacity-70 hover:opacity-100"
                } ${dirtyKeys.has(s.key) ? "ring-2 ring-amber-300" : ""}`}
              >
                <div className="text-2xl mb-1">{s.icon}</div>
                <p className="text-[11px] font-bold text-foreground leading-tight">{s.label}</p>
                <p className={`text-[10px] font-bold mt-0.5 ${s.on ? "text-green-600" : "text-muted-foreground"}`}>{s.on ? "✓ On" : "✗ Off"}</p>
                <div className={`absolute top-2 right-2 w-2.5 h-2.5 rounded-full ${s.on ? "bg-green-500" : "bg-gray-300"}`} />
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">COD band karne ke liye service card tap karein</p>
        </div>

        {/* Fees & Limits */}
        <div>
          <SLabel icon={Banknote}>Fees & Limits</SLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Maximum COD Order (Rs.)" value={v("cod_max_amount")} onChange={v2 => handleChange("cod_max_amount", v2)} placeholder="5000" isDirty={d("cod_max_amount")} type="number" hint="Is se zyada order COD se nahi hogi" />
            <Field label="COD Service Fee (Rs.)" value={v("cod_fee")} onChange={v2 => handleChange("cod_fee", v2)} placeholder="0" isDirty={d("cod_fee")} type="number" hint="0 = free COD" />
            <Field label="Free COD Above (Rs.)" value={v("cod_free_above")} onChange={v2 => handleChange("cod_free_above", v2)} placeholder="2000" isDirty={d("cod_free_above")} type="number" hint="Is se zyada order mein COD fee nahi" />
            <Field label="COD Advance Deposit (%)" value={v("cod_advance_pct")} onChange={v2 => handleChange("cod_advance_pct", v2)} placeholder="0" isDirty={d("cod_advance_pct")} type="number" hint="0 = advance nahi, 100 = puri raqam pehle" suffix="%" />
          </div>
        </div>

        {/* High-value verification */}
        <div>
          <SLabel icon={Shield}>High-Value Order Verification</SLabel>
          <Field label="Photo Verification Required Above (Rs.)" value={v("cod_verification_threshold")} onChange={v2 => handleChange("cod_verification_threshold", v2)} placeholder="3000" isDirty={d("cod_verification_threshold")} type="number" hint="Is se zyada COD order mein rider cash photo lega" />
          <p className="text-[11px] text-muted-foreground mt-1">Rider ko high-value COD delivery par cash ki photo leni hogi — fraud se bachane ke liye</p>
        </div>

        {/* Fake order penalty */}
        <div onClick={() => handleToggle("cod_fake_penalty", !fakePenalty)}
          className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-all select-none
            ${fakePenalty ? "bg-red-50 border-red-200" : "bg-white border-border hover:bg-muted/30"}
            ${d("cod_fake_penalty") ? "ring-2 ring-amber-300" : ""}`}
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">🚫 Repeat Fake COD Customers Block Karein</p>
            <p className="text-xs text-muted-foreground mt-0.5">Baar baar COD order cancel karne wale customers ko automatically block karein</p>
            <p className={`text-xs font-bold mt-0.5 ${fakePenalty ? "text-red-600" : "text-muted-foreground"}`}>{fakePenalty ? "● Active — Fraud protection ON" : "○ Disabled"}</p>
          </div>
          <div className={`w-11 h-6 rounded-full relative transition-colors flex-shrink-0 ml-3 ${fakePenalty ? "bg-red-500" : "bg-gray-300"}`}>
            <div className={`w-5 h-5 bg-white rounded-full shadow absolute top-0.5 transition-transform ${fakePenalty ? "translate-x-5" : "translate-x-0.5"}`} />
          </div>
        </div>

        {/* Restricted areas */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-foreground">Restricted Areas (comma se alag karein)</label>
            {d("cod_restricted_areas") && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold">CHANGED</Badge>}
          </div>
          <Input value={v("cod_restricted_areas")} onChange={e => handleChange("cod_restricted_areas", e.target.value)}
            placeholder="e.g. Rawalpindi, Islamabad — khaali chhorein agar sab jagah COD available hai"
            className={`h-9 rounded-lg text-sm ${d("cod_restricted_areas") ? "border-amber-300 bg-amber-50/50" : "border-dashed"}`}
          />
          <p className="text-[11px] text-muted-foreground">Jin areas mein COD available NAHI hogi. Empty = sab jagah available</p>
        </div>

        {/* Customer instructions */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-foreground">Customer Instructions</label>
            {d("cod_notes") && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold">CHANGED</Badge>}
          </div>
          <textarea value={v("cod_notes")} onChange={e => handleChange("cod_notes", e.target.value)}
            rows={2} placeholder="COD select karne ke baad customer ko kya message dikhana hai..."
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
  const enabled       = (localValues["feature_wallet"]           ?? "on") === "on";
  const p2pEnabled    = (localValues["wallet_p2p_enabled"]       ?? "on") === "on";
  const kycRequired   = (localValues["wallet_kyc_required"]      ?? "off") === "on";
  const cbOrders      = (localValues["wallet_cashback_on_orders"]?? "on") === "on";
  const cbRides       = (localValues["wallet_cashback_on_rides"] ?? "off") === "on";
  const cbPharmacy    = (localValues["wallet_cashback_on_pharmacy"] ?? "off") === "on";
  const v = (k: string) => localValues[k] ?? "";
  const d = (k: string) => dirtyKeys.has(k);

  const methods = v("wallet_topup_methods").split(",").map(m => m.trim()).filter(Boolean);
  const toggleMethod = (m: string) => {
    const current = methods.includes(m) ? methods.filter(x => x !== m) : [...methods, m];
    handleChange("wallet_topup_methods", current.join(","));
  };

  const TOPUP_METHODS = [
    { id: "jazzcash",  label: "JazzCash",     icon: "🔴" },
    { id: "easypaisa", label: "EasyPaisa",    icon: "🟢" },
    { id: "bank",      label: "Bank Transfer",icon: "🏦" },
    { id: "cash",      label: "Cash Deposit", icon: "💵" },
    { id: "rider",     label: "Via Rider",    icon: "🛵" },
  ];

  return (
    <div className="rounded-2xl border-2 border-purple-200 overflow-hidden bg-white shadow-sm">
      {/* Header */}
      <div className="bg-purple-50 px-5 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-4xl flex-shrink-0">💰</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-base text-purple-700">AJK Wallet</h3>
              <Badge variant="outline" className={`text-[10px] font-bold border flex-shrink-0 ${enabled ? "bg-green-50 text-green-700 border-green-300" : "bg-muted text-muted-foreground border-border"}`}>
                {enabled ? "● Active" : "○ Disabled"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">In-app digital wallet · instant payments · P2P transfer</p>
          </div>
        </div>
        <div onClick={() => handleToggle("feature_wallet", !enabled)}
          className={`flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-xl border transition-all flex-shrink-0 ${enabled ? "bg-purple-50 border-purple-300" : "bg-white/70 border-border"}`}
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
            { label: "Cashback",    value: `${v("wallet_cashback_pct") || "0"}%`, icon: "🎁" },
            { label: "Signup Bonus",value: v("wallet_signup_bonus") && v("wallet_signup_bonus") !== "0" ? `Rs. ${v("wallet_signup_bonus")}` : "None", icon: "🎊" },
          ].map(s => (
            <div key={s.label} className="bg-purple-50/60 rounded-xl p-3 text-center border border-purple-100">
              <div className="text-xl mb-1">{s.icon}</div>
              <p className="text-xs font-bold text-foreground">{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Feature flags */}
        <div>
          <SLabel icon={ToggleRight}>Wallet Features</SLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { key: "wallet_p2p_enabled",  label: "P2P Money Transfer",    sub: "Customer dusre ko paise bhej sake", on: p2pEnabled,  toggle: () => handleToggle("wallet_p2p_enabled",  !p2pEnabled)  },
              { key: "wallet_kyc_required", label: "KYC Before Activation", sub: "Wallet chalane se pehle ID verify", on: kycRequired, toggle: () => handleToggle("wallet_kyc_required", !kycRequired) },
            ].map(f => (
              <div key={f.key} onClick={f.toggle}
                className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all select-none
                  ${f.on ? "bg-purple-50 border-purple-200" : "bg-white border-border hover:bg-muted/30"}
                  ${d(f.key) ? "ring-2 ring-amber-300" : ""}`}
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">{f.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{f.sub}</p>
                </div>
                <div className={`w-9 h-5 rounded-full relative transition-colors flex-shrink-0 ml-2 ${f.on ? "bg-purple-500" : "bg-gray-300"}`}>
                  <div className={`w-4 h-4 bg-white rounded-full shadow absolute top-0.5 transition-transform ${f.on ? "translate-x-4" : "translate-x-0.5"}`} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Balance limits */}
        <div>
          <SLabel icon={Banknote}>Balance & Transaction Limits</SLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Max Wallet Balance (Rs.)" value={v("wallet_max_balance")} onChange={v2 => handleChange("wallet_max_balance", v2)} placeholder="50000" isDirty={d("wallet_max_balance")} type="number" hint="Ek customer itna hold kar sakta hai" />
            <Field label="Daily Transaction Limit (Rs.)" value={v("wallet_daily_limit")} onChange={v2 => handleChange("wallet_daily_limit", v2)} placeholder="20000" isDirty={d("wallet_daily_limit")} type="number" hint="Roz ka total in + out" />
          </div>
        </div>

        {/* Top-Up rules */}
        <div>
          <SLabel>Top-Up Rules</SLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Minimum Top-Up (Rs.)" value={v("wallet_min_topup")} onChange={v2 => handleChange("wallet_min_topup", v2)} placeholder="100" isDirty={d("wallet_min_topup")} type="number" />
            <Field label="Maximum Single Top-Up (Rs.)" value={v("wallet_max_topup")} onChange={v2 => handleChange("wallet_max_topup", v2)} placeholder="25000" isDirty={d("wallet_max_topup")} type="number" />
          </div>
        </div>

        {/* Withdrawal rules */}
        <div>
          <SLabel>Withdrawal / Payout Rules</SLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Minimum Withdrawal (Rs.)" value={v("wallet_min_withdrawal")} onChange={v2 => handleChange("wallet_min_withdrawal", v2)} placeholder="200" isDirty={d("wallet_min_withdrawal")} type="number" />
            <Field label="Maximum Single Withdrawal (Rs.)" value={v("wallet_max_withdrawal")} onChange={v2 => handleChange("wallet_max_withdrawal", v2)} placeholder="10000" isDirty={d("wallet_max_withdrawal")} type="number" />
            <Field label="Withdrawal Processing Time (hrs)" value={v("wallet_withdrawal_processing")} onChange={v2 => handleChange("wallet_withdrawal_processing", v2)} placeholder="24" isDirty={d("wallet_withdrawal_processing")} type="number" hint="Admin process karne mein kitna time" suffix="hrs" />
          </div>
        </div>

        {/* P2P limit */}
        {p2pEnabled && (
          <div>
            <SLabel>P2P Transfer Limit</SLabel>
            <Field label="P2P Daily Send Limit (Rs.)" value={v("wallet_p2p_daily_limit")} onChange={v2 => handleChange("wallet_p2p_daily_limit", v2)} placeholder="10000" isDirty={d("wallet_p2p_daily_limit")} type="number" hint="Customer roz kitna transfer kar sakta hai" />
          </div>
        )}

        {/* Rewards & Bonuses */}
        <div>
          <SLabel>Rewards & Bonuses</SLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Wallet Cashback (%)" value={v("wallet_cashback_pct")} onChange={v2 => handleChange("wallet_cashback_pct", v2)} placeholder="0" isDirty={d("wallet_cashback_pct")} type="number" hint="Wallet se payment par % cashback" suffix="%" />
            <Field label="Referral Bonus (Rs.)" value={v("wallet_referral_bonus")} onChange={v2 => handleChange("wallet_referral_bonus", v2)} placeholder="100" isDirty={d("wallet_referral_bonus")} type="number" hint="Naye referral join karne par milta hai" />
            <Field label="New User Signup Bonus (Rs.)" value={v("wallet_signup_bonus")} onChange={v2 => handleChange("wallet_signup_bonus", v2)} placeholder="0" isDirty={d("wallet_signup_bonus")} type="number" hint="Account banane par wallet mein milega" />
            <Field label="Balance Expiry (days, 0=never)" value={v("wallet_expiry_days")} onChange={v2 => handleChange("wallet_expiry_days", v2)} placeholder="0" isDirty={d("wallet_expiry_days")} type="number" hint="0 = kabhi expire nahi hoga" suffix="days" />
          </div>
        </div>

        {/* Cashback on which services */}
        <div>
          <SLabel>Cashback Kaun Si Services Mein Milega</SLabel>
          <div className="grid grid-cols-3 gap-2">
            {[
              { key: "wallet_cashback_on_orders",   label: "Orders",   icon: "🛒", on: cbOrders   },
              { key: "wallet_cashback_on_rides",    label: "Rides",    icon: "🚗", on: cbRides    },
              { key: "wallet_cashback_on_pharmacy", label: "Pharmacy", icon: "💊", on: cbPharmacy },
            ].map(cb => (
              <button key={cb.key} onClick={() => handleToggle(cb.key, !cb.on)}
                className={`py-2.5 px-3 rounded-xl border-2 text-center transition-all ${
                  cb.on ? "bg-purple-600 text-white border-purple-700 shadow-sm" : "bg-muted/30 border-border text-foreground hover:bg-muted/60"
                } ${d(cb.key) ? "ring-2 ring-amber-300" : ""}`}
              >
                <div className="text-xl mb-1">{cb.icon}</div>
                <p className="text-[11px] font-bold">{cb.label}</p>
                <p className={`text-[10px] font-bold ${cb.on ? "text-purple-100" : "text-muted-foreground"}`}>{cb.on ? "ON" : "Off"}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Top-Up methods */}
        <div>
          <SLabel icon={Phone}>Accepted Top-Up Methods</SLabel>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {TOPUP_METHODS.map(m => (
              <button key={m.id} onClick={() => toggleMethod(m.id)}
                className={`py-2.5 px-3 text-xs font-semibold rounded-xl border-2 transition-all text-left ${
                  methods.includes(m.id) ? "bg-purple-600 text-white border-purple-700 shadow-sm" : "bg-muted/30 border-border text-foreground hover:bg-muted/60"
                } ${dirtyKeys.has("wallet_topup_methods") ? "ring-1 ring-amber-300" : ""}`}
              >
                <span className="text-lg mr-1.5">{m.icon}</span> {m.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">Tap to toggle — customer in methods se wallet mein paise daal sakta hai</p>
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
  const autoCancelOn   = (localValues["payment_auto_cancel"]    ?? "on") === "on";
  const receiptReq     = (localValues["payment_receipt_required"]?? "on") === "on";
  const v = (k: string) => localValues[k] ?? "";
  const d = (k: string) => dirtyKeys.has(k);

  return (
    <div className="space-y-5">
      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex gap-3">
        <span className="text-xl flex-shrink-0">⚙️</span>
        <p className="text-xs text-slate-700">Yeh rules sab payment methods par apply hote hain — platform-wide global settings.</p>
      </div>

      <div>
        <SLabel>Global Toggles</SLabel>
        <div className="space-y-2">
          <Toggle
            checked={autoCancelOn}
            onChange={v2 => handleToggle("payment_auto_cancel", v2)}
            label="Auto-Cancel Unpaid Orders"
            sub="Online payment timeout ke baad order automatically cancel hoga"
            isDirty={d("payment_auto_cancel")}
          />
          <Toggle
            checked={receiptReq}
            onChange={v2 => handleToggle("payment_receipt_required", v2)}
            label="Manual Payment Receipt Required"
            sub="JazzCash/EasyPaisa/Bank manual payment mein proof submit karna hoga"
            isDirty={d("payment_receipt_required")}
          />
        </div>
      </div>

      <div>
        <SLabel>Timing & Limits</SLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Online Payment Timeout (min)" value={v("payment_timeout_mins")} onChange={v2 => handleChange("payment_timeout_mins", v2)} placeholder="15" isDirty={d("payment_timeout_mins")} type="number" suffix="min" hint="Kitne time mein payment complete ho" />
          <Field label="Manual Verify Window (hrs)" value={v("payment_verify_window_hours")} onChange={v2 => handleChange("payment_verify_window_hours", v2)} placeholder="4" isDirty={d("payment_verify_window_hours")} type="number" suffix="hrs" hint="Manual payment verify karne ka time" />
          <Field label="Minimum Online Payment (Rs.)" value={v("payment_min_online")} onChange={v2 => handleChange("payment_min_online", v2)} placeholder="50" isDirty={d("payment_min_online")} type="number" hint="Is se kum = sirf COD ya wallet" />
          <Field label="Maximum Online Payment (Rs.)" value={v("payment_max_online")} onChange={v2 => handleChange("payment_max_online", v2)} placeholder="100000" isDirty={d("payment_max_online")} type="number" hint="Is se zyada = support se contact" />
        </div>
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
          <GatewayCard prefix="jazzcash" name="JazzCash" logo="🔴" accentColor="text-red-700" accentBg="bg-red-50" accentBorder="border-red-200" accentBtn="bg-red-600"
            localValues={localValues} dirtyKeys={dirtyKeys} handleChange={handleChange} handleToggle={handleToggle} />
        )}
        {payTab === "easypaisa" && (
          <GatewayCard prefix="easypaisa" name="EasyPaisa" logo="🟢" accentColor="text-green-700" accentBg="bg-green-50" accentBorder="border-green-200" accentBtn="bg-green-600"
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
