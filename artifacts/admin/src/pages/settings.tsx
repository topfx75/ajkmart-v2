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
  "security_otp_bypass","security_mfa_required","security_multi_device","security_gps_tracking",
  "security_geo_fence","security_spoof_detection","security_block_tor","security_block_vpn",
  "security_pwd_strong","security_allow_uploads","security_compress_images","security_scan_uploads",
  "security_fake_order_detect","security_auto_block_ip","security_phone_verify","security_single_phone",
  "security_audit_log",
  "integration_push_notif","integration_sms","integration_analytics","integration_email","integration_sentry","integration_whatsapp",
  "integration_maps","analytics_debug_mode","maps_distance_matrix","maps_places_autocomplete","maps_geocoding",
  "jazzcash_enabled","jazzcash_proof_required",
  "easypaisa_enabled","easypaisa_proof_required",
  "bank_enabled","bank_proof_required",
  "cod_enabled","cod_allowed_mart","cod_allowed_food","cod_allowed_pharmacy","cod_allowed_parcel","cod_fake_penalty",
  "payment_auto_cancel","payment_receipt_required",
  "wallet_p2p_enabled","wallet_kyc_required",
  "wallet_cashback_on_orders","wallet_cashback_on_rides","wallet_cashback_on_pharmacy",
  "content_show_banner",
]);

const TEXT_KEYS = new Set([
  "app_name","app_status","support_phone",
  "app_tagline","app_version","support_email","support_hours","business_address","social_facebook","social_instagram",
  "content_banner","content_announcement","content_maintenance_msg","content_support_msg",
  "content_vendor_notice","content_rider_notice",
  "content_tnc_url","content_privacy_url","content_refund_policy_url","content_faq_url","content_about_url",
  "api_map_key","api_sms_gateway","api_firebase_key",
  "security_session_days","security_admin_token_hrs","security_rider_token_days",
  "security_login_max_attempts","security_lockout_minutes",
  "security_rate_limit","security_rate_admin","security_rate_rider","security_rate_vendor","security_rate_burst",
  "security_gps_accuracy","security_gps_interval","security_max_speed_kmh",
  "security_pwd_min_length","security_pwd_expiry_days","security_jwt_rotation_days",
  "security_max_file_mb","security_allowed_types","security_img_quality",
  "security_max_daily_orders","security_new_acct_limit","security_same_addr_limit",
  "security_admin_ip_whitelist","security_maintenance_key",
  "fcm_server_key","fcm_project_id","fcm_sender_id","fcm_app_id","fcm_vapid_key",
  "sms_provider","sms_api_key","sms_account_sid","sms_sender_id","sms_msg91_key","sms_template_otp","sms_template_order",
  "smtp_host","smtp_port","smtp_user","smtp_password","smtp_from_email","smtp_from_name","smtp_secure","smtp_admin_alert_email",
  "wa_phone_number_id","wa_access_token","wa_verify_token","wa_business_account_id","wa_order_template","wa_otp_template",
  "analytics_platform","analytics_tracking_id","analytics_api_secret",
  "sentry_dsn","sentry_environment","sentry_sample_rate","sentry_traces_sample_rate",
  "maps_api_key",
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

const CONTENT_TEXTAREA_KEYS = new Set([
  "content_announcement","content_maintenance_msg","content_support_msg","content_banner",
  "content_vendor_notice","content_rider_notice",
]);
const CONTENT_CHAR_LIMITS: Record<string, number> = {
  content_banner:          80,
  content_announcement:    120,
  content_support_msg:     60,
  content_maintenance_msg: 200,
  content_vendor_notice:   150,
  content_rider_notice:    150,
};
const CONTENT_HINTS: Record<string, { hint: string; apps: string }> = {
  content_banner:           { hint: "Promo ribbon below service pills on home screen. Leave empty to hide", apps: "📱 Customer App" },
  content_announcement:     { hint: "Dismissable top bar. Leave empty to hide it in all apps", apps: "📱 Customer  •  🏪 Vendor  •  🏍️ Rider" },
  content_maintenance_msg:  { hint: "Full-screen message shown when app_status = maintenance", apps: "📱 Customer  •  🏪 Vendor  •  🏍️ Rider" },
  content_support_msg:      { hint: "Shown as subtitle in Call Support row and WhatsApp greeting", apps: "📱 Customer  •  🏪 Vendor  •  🏍️ Rider" },
  content_vendor_notice:    { hint: "Info/warning banner shown at top of vendor dashboard. Leave empty to hide", apps: "🏪 Vendor App only" },
  content_rider_notice:     { hint: "Info/warning banner shown at top of rider home screen. Leave empty to hide", apps: "🏍️ Rider App only" },
  content_tnc_url:          { hint: "Opens in browser when user taps Terms of Service. Leave empty to hide", apps: "📱 Customer  •  🏪 Vendor  •  🏍️ Rider" },
  content_privacy_url:      { hint: "Opens in browser when user taps Privacy Policy. Leave empty to hide", apps: "📱 Customer  •  🏪 Vendor  •  🏍️ Rider" },
  content_refund_policy_url:{ hint: "Refund & Returns policy page. Leave empty to hide the row", apps: "📱 Customer  •  🏪 Vendor  •  🏍️ Rider" },
  content_faq_url:          { hint: "Help Center or FAQ page. Leave empty to hide the row", apps: "📱 Customer  •  🏪 Vendor  •  🏍️ Rider" },
  content_about_url:        { hint: "About Us page. Leave empty to hide the row", apps: "📱 Customer  •  🏪 Vendor  •  🏍️ Rider" },
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

/* ─── Integrations Section ───────────────────────────────────────────────── */
type IntTab = "firebase" | "sms" | "email" | "whatsapp" | "analytics" | "sentry" | "maps";

const INT_TABS: { id: IntTab; label: string; emoji: string; color: string; active: string; desc: string }[] = [
  { id: "firebase",  label: "Firebase",  emoji: "🔥", color: "text-orange-700", active: "bg-orange-600", desc: "Push notifications for riders & customers" },
  { id: "sms",       label: "SMS",       emoji: "📱", color: "text-blue-700",   active: "bg-blue-600",   desc: "OTP, order alerts & ride updates" },
  { id: "email",     label: "Email",     emoji: "📧", color: "text-teal-700",   active: "bg-teal-600",   desc: "SMTP email alerts to admins" },
  { id: "whatsapp",  label: "WhatsApp",  emoji: "💬", color: "text-green-700",  active: "bg-green-600",  desc: "WhatsApp Business API notifications" },
  { id: "analytics", label: "Analytics", emoji: "📊", color: "text-purple-700", active: "bg-purple-600", desc: "Google Analytics or Mixpanel tracking" },
  { id: "sentry",    label: "Sentry",    emoji: "🐛", color: "text-red-700",    active: "bg-red-600",    desc: "Error monitoring & performance traces" },
  { id: "maps",      label: "Maps",      emoji: "🗺️", color: "text-sky-700",    active: "bg-sky-600",    desc: "Google Maps for routing & tracking" },
];

function IntStatusBadge({ enabled, configured }: { enabled: boolean; configured: boolean }) {
  if (!enabled) return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">DISABLED</span>;
  if (!configured) return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">NOT CONFIGURED</span>;
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">● ACTIVE</span>;
}

function IntCard({ title, emoji, description, enableKey, localValues, dirtyKeys, handleToggle, configured, children }: {
  title: string; emoji: string; description: string;
  enableKey: string; localValues: Record<string,string>; dirtyKeys: Set<string>;
  handleToggle: (k: string, v: boolean) => void; configured: boolean; children: React.ReactNode;
}) {
  const enabled = (localValues[enableKey] ?? "off") === "on";
  return (
    <div className={`rounded-2xl border-2 transition-all ${enabled ? "border-green-200 bg-white" : "border-dashed border-border bg-muted/20"}`}>
      {/* Card Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{emoji}</span>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-foreground text-sm">{title}</h4>
              <IntStatusBadge enabled={enabled} configured={configured} />
              {dirtyKeys.has(enableKey) && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold">CHANGED</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
        <div onClick={() => handleToggle(enableKey, !enabled)} className="cursor-pointer">
          <div className={`w-12 h-6 rounded-full relative transition-colors ${enabled ? "bg-green-500" : "bg-gray-300"}`}>
            <div className={`w-5 h-5 bg-white rounded-full shadow absolute top-0.5 transition-transform ${enabled ? "translate-x-6" : "translate-x-0.5"}`} />
          </div>
        </div>
      </div>
      {/* Card Body — only when enabled */}
      {enabled ? (
        <div className="p-4">{children}</div>
      ) : (
        <div className="p-4 text-center text-sm text-muted-foreground">Enable this integration to configure its settings</div>
      )}
    </div>
  );
}

function IntegrationsSection({ localValues, dirtyKeys, handleChange, handleToggle }: {
  localValues: Record<string,string>; dirtyKeys: Set<string>;
  handleChange: (k: string, v: string) => void;
  handleToggle: (k: string, v: boolean) => void;
}) {
  const [intTab, setIntTab] = useState<IntTab>("firebase");

  const val = (k: string) => localValues[k] ?? "";
  const dirty = (k: string) => dirtyKeys.has(k);
  const tog = (k: string) => (localValues[k] ?? "off") === "on";

  const F = ({ label, k, placeholder, mono, hint }: { label: string; k: string; placeholder?: string; mono?: boolean; hint?: string }) => (
    <Field label={label} value={val(k)} onChange={v => handleChange(k, v)} isDirty={dirty(k)} placeholder={placeholder} mono={mono} hint={hint} />
  );
  const S = ({ label, k, placeholder }: { label: string; k: string; placeholder?: string }) => (
    <SecretInput label={label} value={val(k)} onChange={v => handleChange(k, v)} isDirty={dirty(k)} placeholder={placeholder} />
  );
  const T = ({ label, k, sub }: { label: string; k: string; sub?: string }) => (
    <Toggle label={label} checked={tog(k)} onChange={v => handleToggle(k, v)} isDirty={dirty(k)} sub={sub} />
  );

  /* ── Firebase ── */
  const fcmConfigured = !!(val("fcm_server_key") || val("fcm_project_id"));
  /* ── SMS ── */
  const smsProvider = val("sms_provider") || "console";
  const smsConfigured = smsProvider !== "console" && !!(val("sms_api_key") || val("sms_msg91_key"));
  /* ── Email ── */
  const smtpConfigured = !!(val("smtp_host") && val("smtp_user"));
  /* ── WhatsApp ── */
  const waConfigured = !!(val("wa_phone_number_id") && val("wa_access_token"));
  /* ── Analytics ── */
  const analyticsPlatform = val("analytics_platform") || "none";
  const analyticsConfigured = analyticsPlatform !== "none" && !!val("analytics_tracking_id");
  /* ── Sentry ── */
  const sentryConfigured = !!val("sentry_dsn");
  /* ── Maps ── */
  const mapsConfigured = !!val("maps_api_key");

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex flex-wrap gap-1.5 bg-muted/50 p-1.5 rounded-xl">
        {INT_TABS.map(t => (
          <button key={t.id} onClick={() => setIntTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${intTab === t.id ? `${t.active} text-white shadow-sm` : `text-muted-foreground hover:bg-white`}`}>
            <span>{t.emoji}</span> {t.label}
          </button>
        ))}
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground px-1">{INT_TABS.find(t => t.id === intTab)?.desc}</p>

      {/* ─── Firebase FCM ─── */}
      {intTab === "firebase" && (
        <IntCard title="Firebase FCM" emoji="🔥" description="Real-time push notifications to mobile & web"
          enableKey="integration_push_notif" localValues={localValues} dirtyKeys={dirtyKeys} handleToggle={handleToggle} configured={fcmConfigured}>
          <div className="space-y-5">
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-xs text-orange-800 flex gap-2">
              <span className="text-lg flex-shrink-0">📋</span>
              <div>
                <strong>Setup:</strong> Go to <span className="font-mono bg-white/70 px-1 rounded">console.firebase.google.com</span> → Project Settings → Cloud Messaging → Server Key. Also note your Project ID and Sender ID.
              </div>
            </div>
            <div>
              <SLabel icon={KeyRound}>Core Credentials</SLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                <S label="FCM Server Key / Legacy API Key" k="fcm_server_key" placeholder="AAAA..." />
                <F label="Firebase Project ID" k="fcm_project_id" placeholder="ajkmart-12345" mono />
                <F label="Sender ID" k="fcm_sender_id" placeholder="123456789012" mono />
                <F label="App ID" k="fcm_app_id" placeholder="1:123456789:web:abc123" mono />
              </div>
            </div>
            <div>
              <SLabel icon={Globe}>Web Push (PWA)</SLabel>
              <div className="grid grid-cols-1 gap-4 mt-3">
                <S label="VAPID Web Push Key (for browser push)" k="fcm_vapid_key" placeholder="BPsc..." />
              </div>
            </div>
            <div>
              <SLabel icon={Phone}>Notification Channels</SLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                {[
                  { k: "notif_new_order", label: "New Order Received", sub: "Vendor receives" },
                  { k: "notif_order_ready", label: "Order Ready for Pickup", sub: "Rider receives" },
                  { k: "notif_ride_request", label: "New Ride Request", sub: "Rider receives" },
                  { k: "notif_promo", label: "Promotional Notifications", sub: "Customer receives" },
                ].map(({ k, label, sub }) => (
                  <Toggle key={k} label={label} sub={sub} checked={(localValues[k] ?? "on") === "on"}
                    onChange={v => handleToggle(k, v)} isDirty={dirty(k)} />
                ))}
              </div>
            </div>
          </div>
        </IntCard>
      )}

      {/* ─── SMS Gateway ─── */}
      {intTab === "sms" && (
        <IntCard title="SMS Gateway" emoji="📱" description="OTP verification, order & ride notifications via SMS"
          enableKey="integration_sms" localValues={localValues} dirtyKeys={dirtyKeys} handleToggle={handleToggle} configured={smsConfigured}>
          <div className="space-y-5">
            {/* Provider selector */}
            <div>
              <SLabel icon={Puzzle}>SMS Provider</SLabel>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                {[
                  { id: "console", label: "Console (Dev)", emoji: "🖥️", desc: "Logs to terminal only" },
                  { id: "twilio",  label: "Twilio",        emoji: "📞", desc: "International & PK" },
                  { id: "msg91",   label: "MSG91",          emoji: "🇮🇳", desc: "India & Pakistan" },
                  { id: "zong",    label: "Zong/CM.com",   emoji: "🇵🇰", desc: "AJK / Pakistan" },
                ].map(p => (
                  <button key={p.id} onClick={() => handleChange("sms_provider", p.id)}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${smsProvider === p.id ? "border-blue-500 bg-blue-50" : "border-border hover:bg-muted/30"}`}>
                    <div className="text-xl mb-1">{p.emoji}</div>
                    <div className="text-xs font-bold">{p.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{p.desc}</div>
                  </button>
                ))}
              </div>
            </div>
            {smsProvider === "console" && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 flex gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span><strong>Dev Mode:</strong> SMS messages are logged to the server console only. Choose a real provider above to send actual SMS.</span>
              </div>
            )}
            {smsProvider === "twilio" && (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex gap-2">
                  <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>Get credentials at <span className="font-mono bg-white/70 px-1 rounded">console.twilio.com</span> → Account Info</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <F label="Account SID" k="sms_account_sid" placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" mono />
                  <S label="Auth Token" k="sms_api_key" placeholder="your_auth_token" />
                  <F label="From Phone Number" k="sms_sender_id" placeholder="+12025551234" mono />
                </div>
              </div>
            )}
            {smsProvider === "msg91" && (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex gap-2">
                  <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>Get credentials at <span className="font-mono bg-white/70 px-1 rounded">msg91.com</span> → API → Auth Key</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <S label="MSG91 Auth Key" k="sms_msg91_key" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxx" />
                  <F label="Sender ID (6 chars)" k="sms_sender_id" placeholder="AJKMAR" mono />
                </div>
              </div>
            )}
            {smsProvider === "zong" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <S label="API Key" k="sms_api_key" placeholder="your_api_key" />
                  <F label="Sender ID" k="sms_sender_id" placeholder="AJKMart" mono />
                </div>
              </div>
            )}
            {smsProvider !== "console" && (
              <div>
                <SLabel icon={MessageSquare}>SMS Templates</SLabel>
                <div className="grid grid-cols-1 gap-4 mt-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">OTP Template <span className="text-muted-foreground font-normal">(use &#123;otp&#125; placeholder)</span></label>
                    <textarea value={val("sms_template_otp")} onChange={e => handleChange("sms_template_otp", e.target.value)}
                      rows={2} className={`w-full border rounded-lg p-2 text-sm resize-none font-mono ${dirty("sms_template_otp") ? "border-amber-300 bg-amber-50/50" : ""}`} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">Order Status Template <span className="text-muted-foreground font-normal">(use &#123;id&#125;, &#123;status&#125;)</span></label>
                    <textarea value={val("sms_template_order")} onChange={e => handleChange("sms_template_order", e.target.value)}
                      rows={2} className={`w-full border rounded-lg p-2 text-sm resize-none font-mono ${dirty("sms_template_order") ? "border-amber-300 bg-amber-50/50" : ""}`} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </IntCard>
      )}

      {/* ─── Email SMTP ─── */}
      {intTab === "email" && (
        <IntCard title="Email (SMTP)" emoji="📧" description="Send admin alerts, receipts and reports via email"
          enableKey="integration_email" localValues={localValues} dirtyKeys={dirtyKeys} handleToggle={handleToggle} configured={smtpConfigured}>
          <div className="space-y-5">
            <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 text-xs text-teal-800 flex gap-2">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div><strong>Quick Setup:</strong> For Gmail, use <span className="font-mono bg-white/70 px-1 rounded">smtp.gmail.com</span>, port 587, TLS mode, and an <em>App Password</em> (not your Gmail password). <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="underline">Create App Password →</a></div>
            </div>
            <div>
              <SLabel icon={Globe}>SMTP Server</SLabel>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
                <div className="sm:col-span-2">
                  <F label="SMTP Host" k="smtp_host" placeholder="smtp.gmail.com" mono />
                </div>
                <F label="Port" k="smtp_port" placeholder="587" mono />
              </div>
              {/* Encryption quick select */}
              <div className="mt-3">
                <label className="text-xs font-semibold text-foreground">Encryption Mode</label>
                <div className="flex gap-2 mt-1.5">
                  {["tls","ssl","none"].map(mode => (
                    <button key={mode} onClick={() => handleChange("smtp_secure", mode)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${val("smtp_secure") === mode ? "bg-teal-600 text-white border-teal-600" : "border-border hover:bg-muted/30"}`}>
                      {mode.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <SLabel icon={KeyRound}>Authentication</SLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                <F label="SMTP Username / Email" k="smtp_user" placeholder="alerts@ajkmart.pk" mono />
                <S label="Password / App Password" k="smtp_password" placeholder="xxxx xxxx xxxx xxxx" />
              </div>
            </div>
            <div>
              <SLabel icon={MessageSquare}>Sender Identity</SLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                <F label="From Email Address" k="smtp_from_email" placeholder="noreply@ajkmart.pk" mono />
                <F label="From Display Name" k="smtp_from_name" placeholder="AJKMart" />
                <div className="sm:col-span-2">
                  <F label="Admin Alert Recipient Email" k="smtp_admin_alert_email" placeholder="admin@ajkmart.pk" mono
                    hint="Where to send order alerts, low stock, fraud warnings etc." />
                </div>
              </div>
            </div>
            {/* Alert topics */}
            <div>
              <SLabel icon={AlertTriangle}>Alert Events</SLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                {[
                  { k: "email_alert_new_vendor", label: "New Vendor Registration" },
                  { k: "email_alert_high_value_order", label: "High Value Order Alert" },
                  { k: "email_alert_fraud", label: "Fraud / Fake Order Alert" },
                  { k: "email_alert_low_balance", label: "Low Wallet Balance Warning" },
                  { k: "email_alert_daily_summary", label: "Daily Summary Report" },
                  { k: "email_alert_weekly_report", label: "Weekly Revenue Report" },
                ].map(({ k, label }) => (
                  <Toggle key={k} label={label} checked={(localValues[k] ?? "on") === "on"}
                    onChange={v => handleToggle(k, v)} isDirty={dirty(k)} />
                ))}
              </div>
            </div>
          </div>
        </IntCard>
      )}

      {/* ─── WhatsApp Business ─── */}
      {intTab === "whatsapp" && (
        <IntCard title="WhatsApp Business API" emoji="💬" description="Send order updates, OTP & promotions via WhatsApp"
          enableKey="integration_whatsapp" localValues={localValues} dirtyKeys={dirtyKeys} handleToggle={handleToggle} configured={waConfigured}>
          <div className="space-y-5">
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-xs text-green-800 flex gap-2">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div><strong>Setup:</strong> Create a Meta Business account → WhatsApp Business API → Phone Numbers. Get your <em>Phone Number ID</em>, <em>Business Account ID</em> and a <em>Permanent Access Token</em> from <span className="font-mono bg-white/70 px-1 rounded">developers.facebook.com</span>.</div>
            </div>
            <div>
              <SLabel icon={KeyRound}>API Credentials</SLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                <F label="Phone Number ID" k="wa_phone_number_id" placeholder="123456789012345" mono />
                <F label="WhatsApp Business Account ID" k="wa_business_account_id" placeholder="987654321098765" mono />
                <div className="sm:col-span-2">
                  <S label="Permanent Access Token" k="wa_access_token" placeholder="EAAxxxxxxx..." />
                </div>
              </div>
            </div>
            <div>
              <SLabel icon={Globe}>Webhook Configuration</SLabel>
              <div className="grid grid-cols-1 gap-4 mt-3">
                <S label="Webhook Verify Token (set same in Meta Developer Console)" k="wa_verify_token" placeholder="my_secure_verify_token_123" />
                <div className="bg-muted/50 border border-border rounded-xl p-3 space-y-1">
                  <p className="text-xs font-semibold text-foreground">Webhook Callback URL (set in Meta console):</p>
                  <p className="text-xs font-mono text-muted-foreground">https://your-domain.replit.app/api/webhooks/whatsapp</p>
                  <p className="text-xs text-muted-foreground">Subscribe to: <span className="font-mono">messages, message_deliveries, message_reads</span></p>
                </div>
              </div>
            </div>
            <div>
              <SLabel icon={MessageSquare}>Message Templates</SLabel>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 mb-3 flex gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>Template names must be approved by Meta before use. Use only approved template names below.</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <F label="Order Notification Template" k="wa_order_template" placeholder="order_notification" mono />
                <F label="OTP Verification Template" k="wa_otp_template" placeholder="otp_verification" mono />
              </div>
            </div>
            {/* WA notification channels */}
            <div>
              <SLabel icon={ToggleRight}>Notification Channels</SLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                {[
                  { k: "wa_send_otp",         label: "OTP / Login Verification",  sub: "Customer receives" },
                  { k: "wa_send_order_update", label: "Order Status Updates",      sub: "Customer receives" },
                  { k: "wa_send_ride_update",  label: "Ride Status Updates",       sub: "Customer receives" },
                  { k: "wa_send_promo",        label: "Promotional Messages",      sub: "Marketing opt-in required" },
                  { k: "wa_send_rider_notif",  label: "Rider Assignment Alerts",   sub: "Rider receives" },
                  { k: "wa_send_vendor_notif", label: "New Order to Vendor",       sub: "Vendor receives" },
                ].map(({ k, label, sub }) => (
                  <Toggle key={k} label={label} sub={sub} checked={(localValues[k] ?? "off") === "on"}
                    onChange={v => handleToggle(k, v)} isDirty={dirty(k)} />
                ))}
              </div>
            </div>
          </div>
        </IntCard>
      )}

      {/* ─── Analytics ─── */}
      {intTab === "analytics" && (
        <IntCard title="Analytics & Tracking" emoji="📊" description="Track user behavior, orders and revenue"
          enableKey="integration_analytics" localValues={localValues} dirtyKeys={dirtyKeys} handleToggle={handleToggle} configured={analyticsConfigured}>
          <div className="space-y-5">
            {/* Platform selector */}
            <div>
              <SLabel icon={BarChart3}>Analytics Platform</SLabel>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                {[
                  { id: "none",      emoji: "🚫", label: "None",            desc: "No analytics" },
                  { id: "google",    emoji: "🔍", label: "Google Analytics",desc: "GA4 / gtag.js" },
                  { id: "mixpanel",  emoji: "🧪", label: "Mixpanel",        desc: "Event analytics" },
                  { id: "amplitude", emoji: "📈", label: "Amplitude",       desc: "Product analytics" },
                ].map(p => (
                  <button key={p.id} onClick={() => handleChange("analytics_platform", p.id)}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${analyticsPlatform === p.id ? "border-purple-500 bg-purple-50" : "border-border hover:bg-muted/30"}`}>
                    <div className="text-xl mb-1">{p.emoji}</div>
                    <div className="text-xs font-bold">{p.label}</div>
                    <div className="text-[10px] text-muted-foreground">{p.desc}</div>
                  </button>
                ))}
              </div>
            </div>
            {analyticsPlatform !== "none" && (
              <div className="space-y-4">
                {analyticsPlatform === "google" && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex gap-2">
                    <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>Go to <span className="font-mono bg-white/70 px-1 rounded">analytics.google.com</span> → Admin → Data Streams → Measurement ID (G-XXXXXXXXXX) and API Secret.</span>
                  </div>
                )}
                {analyticsPlatform === "mixpanel" && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex gap-2">
                    <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>Go to <span className="font-mono bg-white/70 px-1 rounded">mixpanel.com</span> → Project Settings → Project Token.</span>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <F label={analyticsPlatform === "google" ? "Measurement ID (G-XXXXXXXXXX)" : "Project Token / API Key"}
                    k="analytics_tracking_id"
                    placeholder={analyticsPlatform === "google" ? "G-XXXXXXXXXX" : "your_token"} mono />
                  <S label={analyticsPlatform === "google" ? "API Secret (for server-side events)" : "API Secret"}
                    k="analytics_api_secret" placeholder="your_api_secret" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <T label="Debug Mode (verbose logging)" k="analytics_debug_mode" sub="Disable in production" />
                </div>
              </div>
            )}
            {/* Tracked events */}
            <div>
              <SLabel icon={CheckCircle2}>Events to Track</SLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                {[
                  { k: "track_order_placed",   label: "Order Placed",           sub: "With value & category" },
                  { k: "track_ride_booked",    label: "Ride Booked",            sub: "With distance & fare" },
                  { k: "track_user_signup",    label: "User Signup",            sub: "Registration funnel" },
                  { k: "track_wallet_topup",   label: "Wallet Top-Up",          sub: "Payment amounts" },
                  { k: "track_screen_views",   label: "Screen Views",           sub: "Page hit tracking" },
                  { k: "track_search_queries", label: "Search Queries",         sub: "What users search" },
                ].map(({ k, label, sub }) => (
                  <Toggle key={k} label={label} sub={sub} checked={(localValues[k] ?? "on") === "on"}
                    onChange={v => handleToggle(k, v)} isDirty={dirty(k)} />
                ))}
              </div>
            </div>
          </div>
        </IntCard>
      )}

      {/* ─── Sentry ─── */}
      {intTab === "sentry" && (
        <IntCard title="Sentry — Error Monitoring" emoji="🐛" description="Capture crashes, JS errors & API failures in real time"
          enableKey="integration_sentry" localValues={localValues} dirtyKeys={dirtyKeys} handleToggle={handleToggle} configured={sentryConfigured}>
          <div className="space-y-5">
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800 flex gap-2">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div><strong>Setup:</strong> Create a project at <span className="font-mono bg-white/70 px-1 rounded">sentry.io</span> → Settings → Client Keys → DSN. Copy the full DSN URL including project ID.</div>
            </div>
            <div>
              <SLabel icon={KeyRound}>Sentry DSN</SLabel>
              <div className="mt-3">
                <S label="Sentry DSN URL" k="sentry_dsn" placeholder="https://examplePublicKey@o0.ingest.sentry.io/0" />
              </div>
            </div>
            <div>
              <SLabel icon={Globe}>Environment & Sampling</SLabel>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
                <div>
                  <label className="text-xs font-semibold text-foreground">Environment</label>
                  <div className="flex gap-2 mt-1.5">
                    {["production","staging","development"].map(env => (
                      <button key={env} onClick={() => handleChange("sentry_environment", env)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all ${val("sentry_environment") === env ? "bg-red-600 text-white border-red-600" : "border-border hover:bg-muted/30"}`}>
                        {env}
                      </button>
                    ))}
                  </div>
                </div>
                <Field label="Error Sample Rate (%)"
                  value={val("sentry_sample_rate")} onChange={v => handleChange("sentry_sample_rate", v)}
                  isDirty={dirty("sentry_sample_rate")} type="number" suffix="%" placeholder="100"
                  hint="100 = capture all errors" />
                <Field label="Performance Traces Rate (%)"
                  value={val("sentry_traces_sample_rate")} onChange={v => handleChange("sentry_traces_sample_rate", v)}
                  isDirty={dirty("sentry_traces_sample_rate")} type="number" suffix="%" placeholder="10"
                  hint="Keep low to avoid quota" />
              </div>
            </div>
            {/* Capture targets */}
            <div>
              <SLabel icon={Shield}>Capture Targets</SLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                {[
                  { k: "sentry_capture_api",     label: "API Server Errors",       sub: "Express 5xx errors" },
                  { k: "sentry_capture_admin",    label: "Admin Panel Errors",      sub: "React frontend" },
                  { k: "sentry_capture_vendor",   label: "Vendor App Errors",       sub: "React frontend" },
                  { k: "sentry_capture_rider",    label: "Rider App Errors",        sub: "React frontend" },
                  { k: "sentry_capture_unhandled",label: "Unhandled Rejections",    sub: "Promise failures" },
                  { k: "sentry_capture_perf",     label: "Performance Monitoring",  sub: "Slow API traces" },
                ].map(({ k, label, sub }) => (
                  <Toggle key={k} label={label} sub={sub} checked={(localValues[k] ?? "on") === "on"}
                    onChange={v => handleToggle(k, v)} isDirty={dirty(k)} />
                ))}
              </div>
            </div>
          </div>
        </IntCard>
      )}

      {/* ─── Google Maps ─── */}
      {intTab === "maps" && (
        <IntCard title="Google Maps" emoji="🗺️" description="Location services, routing, distance & address autocomplete"
          enableKey="integration_maps" localValues={localValues} dirtyKeys={dirtyKeys} handleToggle={handleToggle} configured={mapsConfigured}>
          <div className="space-y-5">
            <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 text-xs text-sky-800 flex gap-2">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div><strong>Setup:</strong> Go to <span className="font-mono bg-white/70 px-1 rounded">console.cloud.google.com</span> → APIs & Services → Credentials → Create API Key. Enable: <em>Maps JavaScript API, Distance Matrix API, Places API, Geocoding API</em>. Restrict key to your domain for security.</div>
            </div>
            <div>
              <SLabel icon={KeyRound}>API Key</SLabel>
              <div className="mt-3">
                <S label="Google Maps API Key" k="maps_api_key" placeholder="AIzaSy..." />
              </div>
            </div>
            <div>
              <SLabel icon={ToggleRight}>Enabled APIs</SLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <T label="Distance Matrix API" k="maps_distance_matrix" sub="Fare calculation & ETAs" />
                <T label="Places Autocomplete API" k="maps_places_autocomplete" sub="Address search for customers" />
                <T label="Geocoding API" k="maps_geocoding" sub="Convert addresses to coordinates" />
              </div>
            </div>
            <div>
              <SLabel icon={Car}>Maps Usage</SLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                {[
                  { k: "maps_use_customer_app", label: "Customer App Map",     sub: "Show map on order/ride screens" },
                  { k: "maps_use_rider_app",    label: "Rider Navigation Map", sub: "Live route for riders" },
                  { k: "maps_use_vendor_app",   label: "Vendor Area Map",      sub: "Delivery zone visualization" },
                  { k: "maps_live_tracking",    label: "Live Order Tracking",  sub: "Customer tracks rider in real time" },
                ].map(({ k, label, sub }) => (
                  <Toggle key={k} label={label} sub={sub} checked={(localValues[k] ?? "off") === "on"}
                    onChange={v => handleToggle(k, v)} isDirty={dirty(k)} />
                ))}
              </div>
            </div>
            <div>
              <SLabel icon={BarChart3}>Fare Calculation</SLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                <Field label="Per KM Rate (Rs)"
                  value={val("maps_per_km_rate")} onChange={v => handleChange("maps_per_km_rate", v)}
                  isDirty={dirty("maps_per_km_rate")} type="number" suffix="Rs" placeholder="25"
                  hint="Used in distance-based fare calculation" />
                <Field label="Base Fare (Rs)"
                  value={val("maps_base_fare")} onChange={v => handleChange("maps_base_fare", v)}
                  isDirty={dirty("maps_base_fare")} type="number" suffix="Rs" placeholder="50" />
                <Field label="Max Delivery Radius (KM)"
                  value={val("maps_max_radius_km")} onChange={v => handleChange("maps_max_radius_km", v)}
                  isDirty={dirty("maps_max_radius_km")} type="number" suffix="KM" placeholder="15" />
                <Field label="Surge Multiplier (peak hours)"
                  value={val("maps_surge_multiplier")} onChange={v => handleChange("maps_surge_multiplier", v)}
                  isDirty={dirty("maps_surge_multiplier")} type="number" suffix="×" placeholder="1.5" />
              </div>
            </div>
          </div>
        </IntCard>
      )}
    </div>
  );
}

/* ─── Security Section ────────────────────────────────────────────────────── */
type SecTab = "auth" | "ratelimit" | "gps" | "passwords" | "uploads" | "fraud" | "admin";

const SEC_TABS: { id: SecTab; label: string; emoji: string; active: string; desc: string }[] = [
  { id: "auth",      label: "Auth & Sessions", emoji: "🔐", active: "bg-indigo-600",  desc: "OTP, MFA, login lockout, session expiry" },
  { id: "ratelimit", label: "Rate Limiting",   emoji: "🛡️", active: "bg-blue-600",    desc: "API throttling, DDoS & VPN blocking" },
  { id: "gps",       label: "GPS & Location",  emoji: "📍", active: "bg-green-600",   desc: "Rider tracking, spoofing detection" },
  { id: "passwords", label: "Passwords",       emoji: "🔑", active: "bg-amber-600",   desc: "Password policy, JWT & token expiry" },
  { id: "uploads",   label: "File Uploads",    emoji: "📁", active: "bg-teal-600",    desc: "Upload limits, file types, compression" },
  { id: "fraud",     label: "Fraud Detection", emoji: "🚨", active: "bg-red-600",     desc: "Fake orders, IP blocking, account limits" },
  { id: "admin",     label: "Admin Access",    emoji: "👤", active: "bg-purple-600",  desc: "IP whitelist, audit log, maintenance key" },
];

function SecPanel({ title, icon: Icon, color, children }: { title: string; icon: React.ElementType; color: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5 space-y-4">
      <div className={`flex items-center gap-2 ${color}`}>
        <Icon className="w-4 h-4" />
        <h4 className="text-sm font-bold">{title}</h4>
      </div>
      {children}
    </div>
  );
}

function SecuritySection({ localValues, dirtyKeys, handleChange, handleToggle }: {
  localValues: Record<string,string>; dirtyKeys: Set<string>;
  handleChange: (k: string, v: string) => void;
  handleToggle: (k: string, v: boolean) => void;
}) {
  const [secTab, setSecTab] = useState<SecTab>("auth");
  const { toast } = useToast();

  /* ── Live Security State ── */
  const [secDash,    setSecDash]    = useState<any>(null);
  const [lockouts,   setLockouts]   = useState<any[]>([]);
  const [blockedIPsList, setBlockedIPsList] = useState<string[]>([]);
  const [auditEntries, setAuditEntries]   = useState<any[]>([]);
  const [secEvents,    setSecEvents]      = useState<any[]>([]);
  const [newBlockIP,   setNewBlockIP]     = useState("");
  const [liveLoading,  setLiveLoading]    = useState(false);

  /* ── MFA / TOTP State ── */
  const [mfaStatus,    setMfaStatus]    = useState<any>(null);
  const [mfaSetupData, setMfaSetupData] = useState<any>(null);
  const [mfaToken,     setMfaToken]     = useState("");
  const [disableToken, setDisableToken] = useState("");
  const [mfaLoading,   setMfaLoading]   = useState(false);

  const adminSecret = localStorage.getItem("ajkmart_admin_token") || "";
  const apiHeaders  = { "Content-Type": "application/json", "x-admin-secret": adminSecret };

  const fetchLiveData = useCallback(async () => {
    if (!adminSecret) return;
    setLiveLoading(true);
    try {
      const [dash, lockoutData, ipsData, auditData, eventsData] = await Promise.all([
        fetch(`${window.location.origin}/api/admin/security-dashboard`, { headers: apiHeaders }).then(r => r.json()),
        fetch(`${window.location.origin}/api/admin/login-lockouts`,     { headers: apiHeaders }).then(r => r.json()),
        fetch(`${window.location.origin}/api/admin/blocked-ips`,        { headers: apiHeaders }).then(r => r.json()),
        fetch(`${window.location.origin}/api/admin/audit-log?limit=50`, { headers: apiHeaders }).then(r => r.json()),
        fetch(`${window.location.origin}/api/admin/security-events?limit=50`, { headers: apiHeaders }).then(r => r.json()),
      ]);
      setSecDash(dash);
      setLockouts(lockoutData.lockouts ?? []);
      setBlockedIPsList(ipsData.blocked ?? []);
      setAuditEntries(auditData.entries ?? []);
      setSecEvents(eventsData.events ?? []);
    } catch {}
    setLiveLoading(false);
  }, [adminSecret]);

  useEffect(() => {
    if (secTab === "auth" || secTab === "fraud" || secTab === "admin") {
      fetchLiveData();
    }
  }, [secTab, fetchLiveData]);

  const unlockPhone = async (phone: string) => {
    await fetch(`${window.location.origin}/api/admin/login-lockouts/${encodeURIComponent(phone)}`, {
      method: "DELETE", headers: apiHeaders,
    });
    toast({ title: "Account Unlocked", description: `${phone} has been unlocked.` });
    fetchLiveData();
  };

  const blockIP = async () => {
    if (!newBlockIP.trim()) return;
    await fetch(`${window.location.origin}/api/admin/blocked-ips`, {
      method: "POST", headers: apiHeaders,
      body: JSON.stringify({ ip: newBlockIP.trim(), reason: "Manual block by admin" }),
    });
    setNewBlockIP("");
    toast({ title: "IP Blocked", description: `${newBlockIP} has been blocked.` });
    fetchLiveData();
  };

  const unblockIP = async (ip: string) => {
    await fetch(`${window.location.origin}/api/admin/blocked-ips/${encodeURIComponent(ip)}`, {
      method: "DELETE", headers: apiHeaders,
    });
    toast({ title: "IP Unblocked", description: `${ip} has been unblocked.` });
    fetchLiveData();
  };

  const fetchMfaStatus = useCallback(async () => {
    if (!adminSecret) return;
    try {
      const data = await fetch(`${window.location.origin}/api/admin/mfa/status`, { headers: apiHeaders }).then(r => r.json());
      setMfaStatus(data);
    } catch {}
  }, [adminSecret]);

  useEffect(() => {
    if (secTab === "admin") fetchMfaStatus();
  }, [secTab, fetchMfaStatus]);

  const startMfaSetup = async () => {
    setMfaLoading(true);
    try {
      const data = await fetch(`${window.location.origin}/api/admin/mfa/setup`, { method: "POST", headers: apiHeaders }).then(r => r.json());
      if (data.secret) { setMfaSetupData(data); setMfaToken(""); }
      else toast({ title: "Error", description: data.error ?? "Failed to start MFA setup", variant: "destructive" });
    } catch { toast({ title: "Error", description: "Network error", variant: "destructive" }); }
    setMfaLoading(false);
  };

  const verifyMfaToken = async () => {
    if (!mfaToken || mfaToken.length !== 6) return;
    setMfaLoading(true);
    try {
      const data = await fetch(`${window.location.origin}/api/admin/mfa/verify`, {
        method: "POST", headers: apiHeaders, body: JSON.stringify({ token: mfaToken }),
      }).then(r => r.json());
      if (data.success) {
        toast({ title: "MFA Activated!", description: "Two-factor authentication is now enabled for your account." });
        setMfaSetupData(null); setMfaToken(""); fetchMfaStatus();
      } else {
        toast({ title: "Invalid Code", description: data.error ?? "Wrong TOTP code. Please try again.", variant: "destructive" });
      }
    } catch {}
    setMfaLoading(false);
  };

  const disableMfa = async () => {
    setMfaLoading(true);
    try {
      const data = await fetch(`${window.location.origin}/api/admin/mfa/disable`, {
        method: "DELETE", headers: apiHeaders, body: JSON.stringify({ token: disableToken }),
      }).then(r => r.json());
      if (data.success) {
        toast({ title: "MFA Disabled", description: "Two-factor authentication has been disabled." });
        setDisableToken(""); fetchMfaStatus();
      } else {
        toast({ title: "Error", description: data.error ?? "Failed to disable MFA", variant: "destructive" });
      }
    } catch {}
    setMfaLoading(false);
  };

  const val  = (k: string, def = "")   => localValues[k] ?? def;
  const dirty = (k: string)            => dirtyKeys.has(k);
  const tog  = (k: string, def = "off") => (localValues[k] ?? def) === "on";

  const T = ({ k, label, sub, danger }: { k: string; label: string; sub?: string; danger?: boolean }) => (
    <Toggle label={label} sub={sub} checked={tog(k, danger ? "off" : "on")}
      onChange={v => handleToggle(k, v)} isDirty={dirty(k)} danger={danger} />
  );
  const N = ({ k, label, suffix, placeholder, hint, min }: { k: string; label: string; suffix?: string; placeholder?: string; hint?: string; min?: number }) => (
    <Field label={label} value={val(k)} onChange={v => handleChange(k, v)} isDirty={dirty(k)}
      type="number" suffix={suffix} placeholder={placeholder} hint={hint} />
  );
  const F = ({ k, label, placeholder, mono, hint }: { k: string; label: string; placeholder?: string; mono?: boolean; hint?: string }) => (
    <Field label={label} value={val(k)} onChange={v => handleChange(k, v)} isDirty={dirty(k)} placeholder={placeholder} mono={mono} hint={hint} />
  );
  const S = ({ k, label, placeholder }: { k: string; label: string; placeholder?: string }) => (
    <SecretInput label={label} value={val(k)} onChange={v => handleChange(k, v)} isDirty={dirty(k)} placeholder={placeholder} />
  );

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex flex-wrap gap-1.5 bg-muted/50 p-1.5 rounded-xl">
        {SEC_TABS.map(t => (
          <button key={t.id} onClick={() => setSecTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${secTab === t.id ? `${t.active} text-white shadow-sm` : "text-muted-foreground hover:bg-white"}`}>
            <span>{t.emoji}</span> {t.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground px-1">{SEC_TABS.find(t => t.id === secTab)?.desc}</p>

      {/* ─── Auth & Sessions ─── */}
      {secTab === "auth" && (
        <div className="space-y-4">
          {/* DANGER ZONE */}
          <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-5 space-y-3">
            <div className="flex items-center gap-2 text-red-700 mb-1">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-sm font-bold">DANGER ZONE — Development Only</span>
            </div>
            <T k="security_otp_bypass" label="OTP Bypass Mode" sub="All OTPs auto-accept (NEVER enable in production)" danger />
          </div>

          <SecPanel title="Multi-Factor Authentication" icon={Shield} color="text-indigo-700">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <T k="security_mfa_required" label="Two-Factor Auth for Admin Login" sub="Adds TOTP code requirement" />
              <T k="security_multi_device" label="Allow Multiple Device Logins" sub="One session or many" />
            </div>
          </SecPanel>

          <SecPanel title="Session & Token Expiry" icon={Lock} color="text-indigo-700">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <N k="security_session_days"     label="Customer Session Expiry"   suffix="days"  placeholder="30" />
              <N k="security_admin_token_hrs"  label="Admin Token Expiry"        suffix="hrs"   placeholder="24" hint="24 hrs = 1 day" />
              <N k="security_rider_token_days" label="Rider Token Expiry"        suffix="days"  placeholder="30" />
            </div>
          </SecPanel>

          <SecPanel title="Login Lockout Policy" icon={Lock} color="text-indigo-700">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex gap-2 mb-3">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>After <strong>Max Attempts</strong> failures, the account is locked for <strong>Lockout Duration</strong>. Applies to customer, rider, and vendor logins.</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <N k="security_login_max_attempts" label="Max Failed Login Attempts" placeholder="5"  hint="Before account lockout" />
              <N k="security_lockout_minutes"    label="Lockout Duration"          suffix="min" placeholder="30" hint="0 = permanent until admin unlocks" />
            </div>
          </SecPanel>

          {/* ── Live: Locked Accounts ── */}
          <SecPanel title="Live Account Lockouts" icon={Lock} color="text-indigo-700">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-muted-foreground">Real-time locked accounts due to failed OTP attempts</p>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={fetchLiveData} disabled={liveLoading}>
                <RefreshCw className={`w-3 h-3 ${liveLoading ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>
            {lockouts.length === 0 ? (
              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-700">
                <CheckCircle2 className="w-4 h-4" /> No accounts currently locked. All clear!
              </div>
            ) : (
              <div className="space-y-2">
                {lockouts.map(l => (
                  <div key={l.phone} className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-xl">
                    <div>
                      <p className="text-xs font-bold font-mono text-red-800">{l.phone}</p>
                      <p className="text-[10px] text-red-600 mt-0.5">
                        {l.minutesLeft ? `Locked — ${l.minutesLeft} min remaining` : `${l.attempts} failed attempts`}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" className="h-7 text-xs text-green-700 border-green-300 hover:bg-green-50"
                      onClick={() => unlockPhone(l.phone)}>Unlock</Button>
                  </div>
                ))}
              </div>
            )}
          </SecPanel>
        </div>
      )}

      {/* ─── Rate Limiting ─── */}
      {secTab === "ratelimit" && (
        <div className="space-y-4">
          <SecPanel title="Per-Role API Rate Limits" icon={Zap} color="text-blue-700">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex gap-2 mb-3">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Limits are per IP address per minute. Exceeding triggers HTTP 429 Too Many Requests. Burst allowance temporarily permits extra requests during short spikes.</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <N k="security_rate_limit"   label="General API (customers)"  suffix="req/min" placeholder="100" />
              <N k="security_rate_admin"   label="Admin Panel"              suffix="req/min" placeholder="60" />
              <N k="security_rate_rider"   label="Rider App API"            suffix="req/min" placeholder="200" />
              <N k="security_rate_vendor"  label="Vendor App API"           suffix="req/min" placeholder="150" />
              <N k="security_rate_burst"   label="Burst Allowance"          suffix="req"     placeholder="20"  hint="Extra requests allowed before block" />
            </div>
          </SecPanel>

          <SecPanel title="IP-Level Blocking" icon={Shield} color="text-blue-700">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 flex gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span><strong>Warning:</strong> VPN blocking may affect legitimate users. TOR blocking prevents anonymous access. Use carefully in Pakistan — some users may use VPNs for privacy.</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <T k="security_block_tor" label="Block TOR Exit Nodes"   sub="Prevents anonymous TOR access" />
              <T k="security_block_vpn" label="Block VPN/Proxy Users"  sub="Fraud prevention (may affect legit users)" />
            </div>
          </SecPanel>

          {/* Visual rate limit diagram */}
          <div className="rounded-2xl border border-border bg-muted/20 p-5">
            <SLabel icon={BarChart3}>Current Rate Limit Overview</SLabel>
            <div className="mt-3 space-y-2">
              {[
                { label: "Customer API",  key: "security_rate_limit",  color: "bg-green-500",  def: "100" },
                { label: "Rider API",     key: "security_rate_rider",   color: "bg-blue-500",   def: "200" },
                { label: "Vendor API",    key: "security_rate_vendor",  color: "bg-orange-500", def: "150" },
                { label: "Admin Panel",   key: "security_rate_admin",   color: "bg-purple-500", def: "60"  },
              ].map(({ label, key, color, def }) => {
                const v = parseInt(val(key, def)) || parseInt(def);
                const pct = Math.min(100, (v / 300) * 100);
                return (
                  <div key={key} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-24 flex-shrink-0">{label}</span>
                    <div className="flex-1 bg-muted rounded-full h-2">
                      <div className={`h-2 rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs font-bold text-foreground w-16 text-right">{v} req/min</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── GPS & Location ─── */}
      {secTab === "gps" && (
        <div className="space-y-4">
          <SecPanel title="GPS Tracking" icon={Bike} color="text-green-700">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <T k="security_gps_tracking"   label="Enable GPS Tracking"       sub="Rider location updates sent to server" />
              <T k="security_spoof_detection" label="GPS Spoofing Detection"    sub="Mock location / fake GPS app detection" />
              <T k="security_geo_fence"       label="Strict Geofence Mode"      sub="Riders must be within service area" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <N k="security_gps_accuracy" label="Min GPS Accuracy Required" suffix="m"   placeholder="50"  hint="Reject readings worse than this" />
              <N k="security_gps_interval" label="Location Update Interval"  suffix="sec" placeholder="10"  hint="How often rider sends GPS ping" />
              <N k="security_max_speed_kmh" label="Max Plausible Speed"       suffix="km/h" placeholder="150" hint="Above this = flag as suspicious" />
            </div>
          </SecPanel>

          <SecPanel title="Service Area & Coverage" icon={Globe} color="text-green-700">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex gap-2">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Service area boundaries are controlled per city in the Geofence settings. When Strict Mode is on, orders outside the defined zones are automatically rejected.</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
              <F k="security_service_city" label="Primary Service City" placeholder="Muzaffarabad, AJK" />
              <F k="security_service_radius_km" label="Max Service Radius (km)" placeholder="30" mono hint="From city center" />
            </div>
          </SecPanel>

          <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-xs text-green-800 space-y-1">
            <p className="font-bold flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> GPS Spoofing Detection checks for:</p>
            <ul className="list-disc list-inside space-y-0.5 ml-1 text-green-700">
              <li>Mock location apps (Developer Options enabled)</li>
              <li>Location jumping more than {val("security_max_speed_kmh","150")} km/h between pings</li>
              <li>Accuracy worse than {val("security_gps_accuracy","50")}m reported by device</li>
              <li>GPS coordinates matching known VPN/proxy datacenter locations</li>
            </ul>
          </div>
        </div>
      )}

      {/* ─── Password & Token Policy ─── */}
      {secTab === "passwords" && (
        <div className="space-y-4">
          <SecPanel title="Password Requirements" icon={KeyRound} color="text-amber-700">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
              <N k="security_pwd_min_length" label="Minimum Length" suffix="chars" placeholder="8" />
              <N k="security_pwd_expiry_days" label="Password Expiry" suffix="days" placeholder="0" hint="0 = never expires" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <T k="security_pwd_strong" label="Require Strong Password" sub="Must include uppercase, number & symbol" />
            </div>

            {/* Password strength preview */}
            <div className="mt-4 bg-muted/50 rounded-xl p-3 border border-border">
              <p className="text-xs font-semibold text-foreground mb-2">Current Password Rules Preview:</p>
              <div className="space-y-1">
                {[
                  { ok: parseInt(val("security_pwd_min_length","8")) >= 8, label: `At least ${val("security_pwd_min_length","8")} characters` },
                  { ok: tog("security_pwd_strong","on"), label: "Uppercase letter required (A-Z)" },
                  { ok: tog("security_pwd_strong","on"), label: "Number required (0-9)" },
                  { ok: tog("security_pwd_strong","on"), label: "Special character required (!@#$...)" },
                ].map(({ ok, label }) => (
                  <div key={label} className="flex items-center gap-2 text-xs">
                    {ok ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <XCircle className="w-3.5 h-3.5 text-muted-foreground" />}
                    <span className={ok ? "text-foreground" : "text-muted-foreground"}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </SecPanel>

          <SecPanel title="JWT & API Token Settings" icon={KeyRound} color="text-amber-700">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex gap-2 mb-3">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>JWT Secret is auto-generated and stored securely. Rotation invalidates all existing sessions — users must log in again. Keep rotation interval reasonable to avoid frequent logouts.</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <N k="security_jwt_rotation_days" label="JWT Secret Rotation"   suffix="days" placeholder="90" hint="All sessions invalidated on rotation" />
              <N k="security_admin_token_hrs"   label="Admin Token Expiry"    suffix="hrs"  placeholder="24" />
              <N k="security_session_days"      label="Customer Session"       suffix="days" placeholder="30" />
              <N k="security_rider_token_days"  label="Rider Token Expiry"    suffix="days" placeholder="30" />
            </div>
          </SecPanel>
        </div>
      )}

      {/* ─── File Uploads ─── */}
      {secTab === "uploads" && (
        <div className="space-y-4">
          <SecPanel title="Upload Permissions" icon={FileText} color="text-teal-700">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <T k="security_allow_uploads"  label="Allow File Uploads" sub="Photos, payment proofs, KYC docs" />
              <T k="security_compress_images" label="Auto-compress Images" sub="Reduces storage & bandwidth usage" />
              <T k="security_scan_uploads"   label="Virus/Malware Scan" sub="Scan uploads before saving (requires ClamAV)" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <N k="security_max_file_mb"  label="Max File Size"          suffix="MB"  placeholder="5"  hint="Per upload" />
              <N k="security_img_quality"  label="Compression Quality"    suffix="%"   placeholder="80" hint="80% = good balance" />
            </div>
          </SecPanel>

          <SecPanel title="Allowed File Types" icon={FileText} color="text-teal-700">
            <div className="space-y-3">
              <F k="security_allowed_types" label="Allowed Extensions (comma-separated)" placeholder="jpg,jpeg,png,pdf"
                mono hint="Reject all other file types at the upload API layer" />
              {/* Visual type badges */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {(val("security_allowed_types","jpg,jpeg,png,pdf")).split(",").map(t => t.trim()).filter(Boolean).map(ext => (
                  <span key={ext} className="px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full text-xs font-bold uppercase">{ext}</span>
                ))}
              </div>
            </div>
          </SecPanel>

          <SecPanel title="Upload Use Cases" icon={CheckCircle2} color="text-teal-700">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { k: "upload_payment_proof",  label: "Payment Proof Screenshots",   sub: "JazzCash / EasyPaisa receipts" },
                { k: "upload_kyc_docs",       label: "KYC Identity Documents",      sub: "CNIC photos for wallet KYC" },
                { k: "upload_rider_docs",     label: "Rider CNIC & License",        sub: "Registration documents" },
                { k: "upload_vendor_docs",    label: "Vendor Business Docs",        sub: "Shop license / registration" },
                { k: "upload_product_imgs",   label: "Product/Menu Images",         sub: "Vendor product photos" },
                { k: "upload_cod_proof",      label: "COD Cash Photo Proof",        sub: "High-value COD orders" },
              ].map(({ k, label, sub }) => (
                <Toggle key={k} label={label} sub={sub} checked={(localValues[k] ?? "on") === "on"}
                  onChange={v => handleToggle(k, v)} isDirty={dirty(k)} />
              ))}
            </div>
          </SecPanel>
        </div>
      )}

      {/* ─── Fraud Detection ─── */}
      {secTab === "fraud" && (
        <div className="space-y-4">
          <SecPanel title="Fake Order Prevention" icon={AlertTriangle} color="text-red-700">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <T k="security_fake_order_detect" label="Fake Order Auto-Detection"  sub="Flag suspicious order patterns" />
              <T k="security_auto_block_ip"     label="Auto-block Suspicious IPs"  sub="After repeated fake orders" />
              <T k="security_phone_verify"      label="Phone Verification Required" sub="Before placing first order" />
              <T k="security_single_phone"      label="One Account per Phone"       sub="Prevent multi-account fraud" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <N k="security_max_daily_orders" label="Max Orders per Day"         placeholder="20"  hint="Per customer account" />
              <N k="security_new_acct_limit"   label="New Account Order Limit"   placeholder="3"   hint="First 7 days after signup" />
              <N k="security_same_addr_limit"  label="Same-Address Hourly Limit" placeholder="5"   hint="Orders from same address per hour" />
            </div>
          </SecPanel>

          <SecPanel title="Fraud Risk Score" icon={Shield} color="text-red-700">
            <div className="bg-muted/50 rounded-xl p-4 border border-border">
              <p className="text-xs font-semibold text-foreground mb-3">Risk signals the system monitors:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { label: "Multiple orders cancelled without payment",    risk: "HIGH" },
                  { label: "COD orders placed & rejected repeatedly",      risk: "HIGH" },
                  { label: "Same phone number on multiple accounts",       risk: "MED" },
                  { label: "Orders placed from known VPN/proxy IPs",       risk: "MED" },
                  { label: "GPS location changing across cities rapidly",   risk: "MED" },
                  { label: "New account placing high-value orders day 1",  risk: "LOW" },
                ].map(({ label, risk }) => (
                  <div key={label} className="flex items-start gap-2 text-xs">
                    <span className={`px-1.5 py-0.5 rounded font-bold flex-shrink-0 text-[10px] ${
                      risk === "HIGH" ? "bg-red-100 text-red-700" : risk === "MED" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                    }`}>{risk}</span>
                    <span className="text-muted-foreground">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </SecPanel>

          {/* ── Live: IP Block Manager ── */}
          <SecPanel title="Live IP Block Manager" icon={Shield} color="text-red-700">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-muted-foreground">Manually block or unblock IP addresses in real-time</p>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={fetchLiveData} disabled={liveLoading}>
                <RefreshCw className={`w-3 h-3 ${liveLoading ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>
            <div className="flex gap-2 mb-3">
              <Input value={newBlockIP} onChange={e => setNewBlockIP(e.target.value)}
                placeholder="Enter IP address e.g. 192.168.1.100"
                className="h-8 text-xs font-mono flex-1"
                onKeyDown={e => e.key === "Enter" && blockIP()}
              />
              <Button size="sm" className="h-8 text-xs bg-red-600 hover:bg-red-700 text-white" onClick={blockIP}>Block IP</Button>
            </div>
            {blockedIPsList.length === 0 ? (
              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-700">
                <CheckCircle2 className="w-4 h-4" /> No IPs currently blocked.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {blockedIPsList.map(ip => (
                  <div key={ip} className="flex items-center justify-between px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                    <span className="text-xs font-mono font-bold text-red-800">{ip}</span>
                    <Button size="sm" variant="ghost" className="h-6 text-xs text-green-700 hover:text-green-800"
                      onClick={() => unblockIP(ip)}>Unblock</Button>
                  </div>
                ))}
              </div>
            )}
          </SecPanel>

          {/* ── Live: Recent Security Events ── */}
          {secEvents.length > 0 && (
            <SecPanel title="Recent Security Events" icon={AlertTriangle} color="text-red-700">
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {secEvents.slice(0, 20).map((e, i) => (
                  <div key={i} className={`flex items-start gap-2 p-2 rounded-lg text-xs border ${
                    e.severity === "critical" ? "bg-red-50 border-red-200" :
                    e.severity === "high"     ? "bg-orange-50 border-orange-200" :
                    e.severity === "medium"   ? "bg-amber-50 border-amber-200" :
                    "bg-gray-50 border-gray-200"
                  }`}>
                    <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] flex-shrink-0 mt-0.5 uppercase ${
                      e.severity === "critical" ? "bg-red-600 text-white" :
                      e.severity === "high"     ? "bg-orange-500 text-white" :
                      e.severity === "medium"   ? "bg-amber-500 text-white" :
                      "bg-gray-400 text-white"
                    }`}>{e.severity}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground truncate">{e.type.replace(/_/g, " ")}</p>
                      <p className="text-muted-foreground truncate">{e.details}</p>
                      <p className="text-[10px] text-muted-foreground/70">{new Date(e.timestamp).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </SecPanel>
          )}
        </div>
      )}

      {/* ─── Admin Access ─── */}
      {secTab === "admin" && (
        <div className="space-y-4">

          {/* ── Live Security Dashboard ── */}
          {secDash && (
            <div className={`rounded-2xl border-2 p-4 ${secDash.status === "critical" ? "border-red-400 bg-red-50" : secDash.status === "warning" ? "border-amber-400 bg-amber-50" : "border-green-300 bg-green-50"}`}>
              <div className="flex items-center justify-between mb-3">
                <div className={`flex items-center gap-2 font-bold text-sm ${secDash.status === "critical" ? "text-red-700" : secDash.status === "warning" ? "text-amber-700" : "text-green-700"}`}>
                  <Shield className="w-4 h-4" />
                  Security Status: {secDash.status === "critical" ? "🔴 CRITICAL" : secDash.status === "warning" ? "🟡 WARNING" : "🟢 HEALTHY"}
                </div>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={fetchLiveData} disabled={liveLoading}>
                  <RefreshCw className={`w-3 h-3 ${liveLoading ? "animate-spin" : ""}`} /> Refresh
                </Button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Blocked IPs", value: secDash.activeBlockedIPs, color: "text-red-700" },
                  { label: "Locked Accounts", value: secDash.activeAccountLockouts, color: "text-orange-700" },
                  { label: "Critical Events (24h)", value: secDash.last24hCriticalEvents, color: "text-red-700" },
                  { label: "High Events (24h)", value: secDash.last24hHighEvents, color: "text-amber-700" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-white/70 rounded-xl p-3 text-center">
                    <p className={`text-xl font-black ${color}`}>{value}</p>
                    <p className="text-[10px] text-muted-foreground font-medium">{label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-white/50 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {[
                  { label: "OTP Bypass",       val: secDash.settings?.otpBypass,       danger: true },
                  { label: "Auto-Block IPs",    val: secDash.settings?.autoBlockIP,      danger: false },
                  { label: "Spoof Detection",   val: secDash.settings?.spoofDetection,   danger: false },
                  { label: "Fake Order Detect", val: secDash.settings?.fakeOrderDetect,  danger: false },
                  { label: "IP Whitelist",      val: secDash.settings?.ipWhitelistActive,danger: false },
                  { label: "MFA Required",      val: secDash.settings?.mfaRequired,      danger: false },
                ].map(({ label, val: v, danger }) => (
                  <div key={label} className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg ${
                    danger && v ? "bg-red-200 text-red-800" : v ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"
                  }`}>
                    <span>{v ? (danger ? "⚠️" : "✅") : "⭕"}</span>
                    <span className="font-medium">{label}: {v ? "ON" : "OFF"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Live: MFA / TOTP Setup for Sub-Admins ── */}
          <SecPanel title="Two-Factor Authentication (MFA)" icon={Shield} color="text-purple-700">
            {mfaStatus?.note ? (
              <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-700">
                <Info className="w-4 h-4 flex-shrink-0" />
                <span>{mfaStatus.note}</span>
              </div>
            ) : mfaStatus?.mfaEnabled ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-700">
                  <CheckCircle2 className="w-4 h-4" /> MFA is <strong>active</strong> on your account. Your TOTP app is required for every login.
                </div>
                <div className="flex gap-2">
                  <Input value={disableToken} onChange={e => setDisableToken(e.target.value)} placeholder="Enter 6-digit TOTP code to disable MFA" className="h-8 text-xs flex-1 font-mono" maxLength={6} />
                  <Button size="sm" variant="destructive" className="h-8 text-xs" onClick={disableMfa} disabled={mfaLoading || disableToken.length !== 6}>
                    {mfaLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : "Disable MFA"}
                  </Button>
                </div>
              </div>
            ) : mfaSetupData ? (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex gap-2">
                  <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>Scan this QR code with <strong>Google Authenticator</strong> or <strong>Authy</strong>, then enter the 6-digit code below to activate MFA.</span>
                </div>
                <div className="flex flex-col sm:flex-row gap-4 items-start">
                  <img src={mfaSetupData.qrCodeDataUrl} alt="TOTP QR Code" className="w-40 h-40 rounded-xl border border-border shadow" />
                  <div className="flex-1 space-y-2">
                    <p className="text-xs font-semibold text-foreground">Manual Entry Key:</p>
                    <div className="bg-muted rounded-lg p-2 font-mono text-xs break-all text-foreground select-all">{mfaSetupData.secret}</div>
                    <p className="text-[10px] text-muted-foreground">Can't scan? Enter this key manually in your authenticator app.</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input value={mfaToken} onChange={e => setMfaToken(e.target.value.replace(/\D/g, ""))} placeholder="Enter 6-digit code from app" className="h-9 text-sm flex-1 font-mono tracking-widest text-center" maxLength={6} onKeyDown={e => e.key === "Enter" && verifyMfaToken()} />
                  <Button className="h-9 text-xs bg-green-600 hover:bg-green-700 text-white" onClick={verifyMfaToken} disabled={mfaLoading || mfaToken.length !== 6}>
                    {mfaLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : "Activate MFA"}
                  </Button>
                  <Button variant="outline" className="h-9 text-xs" onClick={() => setMfaSetupData(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
                  <AlertTriangle className="w-4 h-4" /> MFA is <strong>not enabled</strong> for your account. We strongly recommend enabling it.
                </div>
                <Button size="sm" className="h-8 text-xs bg-purple-600 hover:bg-purple-700 text-white gap-2" onClick={startMfaSetup} disabled={mfaLoading}>
                  {mfaLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                  Set Up Authenticator App
                </Button>
              </div>
            )}
          </SecPanel>

          <SecPanel title="Admin Access Control" icon={Users} color="text-purple-700">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <T k="security_audit_log"    label="Admin Action Audit Log"   sub="Log all admin changes with timestamp & IP" />
              <T k="security_mfa_required" label="Require 2FA for Admin"    sub="TOTP code required at every login" />
            </div>
            <div className="space-y-4">
              <F k="security_admin_ip_whitelist" label="IP Whitelist (comma-separated, blank = allow all)"
                placeholder="103.25.0.1, 123.123.123.123" mono
                hint="Only these IPs can access the admin panel. Leave blank for no restriction." />
              <div className="grid grid-cols-1 gap-2">
                {val("security_admin_ip_whitelist") && (
                  <div className="flex flex-wrap gap-1.5">
                    {val("security_admin_ip_whitelist").split(",").map(ip => ip.trim()).filter(Boolean).map(ip => (
                      <span key={ip} className="px-2.5 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-mono font-bold">{ip}</span>
                    ))}
                  </div>
                )}
                {!val("security_admin_ip_whitelist") && (
                  <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    <span>No IP restriction set — admin panel accessible from any IP. Add IPs above to restrict access.</span>
                  </div>
                )}
              </div>
            </div>
          </SecPanel>

          <SecPanel title="Maintenance Mode" icon={Settings} color="text-purple-700">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex gap-2 mb-3">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Set a <strong>Maintenance Key</strong> so that admins can bypass maintenance mode. Enter this key in the app URL as <span className="font-mono bg-white/70 px-1 rounded">?key=YOUR_KEY</span> to access during downtime.</span>
            </div>
            <S k="security_maintenance_key" label="Maintenance Mode Bypass Key" placeholder="maint-bypass-secret-2025" />
          </SecPanel>

          <SecPanel title="Legacy API Keys" icon={KeyRound} color="text-purple-700">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 flex gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span><strong>These keys are now managed in the Integrations tab.</strong> Values shown here are for reference only. Please update them in Settings → Integrations for full configuration.</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 opacity-70">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Google Maps API Key <span className="text-[10px] text-amber-600 font-normal">(→ Integrations › Maps)</span></label>
                <Input value={val("api_map_key")} disabled className="h-9 text-xs font-mono bg-gray-50" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Firebase Key <span className="text-[10px] text-amber-600 font-normal">(→ Integrations › Firebase)</span></label>
                <Input value={val("api_firebase_key")} disabled className="h-9 text-xs font-mono bg-gray-50" />
              </div>
            </div>
          </SecPanel>

          {/* ── Live: Audit Log ── */}
          <SecPanel title="Admin Audit Log" icon={FileText} color="text-purple-700">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-muted-foreground">Last 50 admin actions — updates automatically when refreshed</p>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={fetchLiveData} disabled={liveLoading}>
                <RefreshCw className={`w-3 h-3 ${liveLoading ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>
            {auditEntries.length === 0 ? (
              <div className="p-3 bg-muted/40 rounded-xl text-xs text-muted-foreground text-center">No audit entries yet. Actions will appear here after admin operations.</div>
            ) : (
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {auditEntries.map((e, i) => (
                  <div key={i} className={`flex items-start gap-2 p-2 rounded-lg text-xs ${e.result === "success" ? "bg-green-50" : e.result === "warn" ? "bg-amber-50" : "bg-red-50"}`}>
                    <span className={`text-[9px] font-black px-1 py-0.5 rounded mt-0.5 flex-shrink-0 uppercase ${
                      e.result === "success" ? "bg-green-600 text-white" : e.result === "warn" ? "bg-amber-500 text-white" : "bg-red-600 text-white"
                    }`}>{e.result}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-foreground">{e.action.replace(/_/g, " ")}</span>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">{new Date(e.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-muted-foreground truncate">{e.details}</p>
                      <p className="text-[10px] font-mono text-muted-foreground/60">{e.ip}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SecPanel>
        </div>
      )}
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
    const T = (key: string, label: string, sub?: string, danger = false) => (
      <Toggle key={key} checked={(localValues[key] ?? "on") === "on"}
        onChange={v => handleToggle(key, v)} label={label} sub={sub} isDirty={dirtyKeys.has(key)} danger={danger} />
    );

    const ContentField = ({ s }: { s: Setting }) => {
      const isDirty   = dirtyKeys.has(s.key);
      const val       = localValues[s.key] ?? s.value;
      const isUrl     = s.key.includes("_url");
      const isTA      = CONTENT_TEXTAREA_KEYS.has(s.key);
      const limit     = CONTENT_CHAR_LIMITS[s.key];
      const meta      = CONTENT_HINTS[s.key];
      const overLimit = limit ? val.length > limit : false;
      return (
        <div className={`rounded-xl border p-4 space-y-2.5 transition-all ${isDirty ? "border-amber-300 bg-amber-50/30" : "border-border bg-white"}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {isUrl
                ? <Link className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                : <MessageSquare className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
              <label className="text-sm font-semibold text-foreground leading-snug">{s.label}</label>
              {isDirty && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold flex-shrink-0">CHANGED</Badge>}
            </div>
            {limit && (
              <span className={`text-[10px] font-mono font-bold flex-shrink-0 ${overLimit ? "text-red-500" : val.length > limit * 0.8 ? "text-amber-500" : "text-muted-foreground"}`}>
                {val.length}/{limit}
              </span>
            )}
          </div>
          {isTA ? (
            <textarea
              value={val}
              onChange={e => handleChange(s.key, e.target.value)}
              placeholder={getPlaceholder(s.key)}
              rows={s.key === "content_maintenance_msg" ? 3 : 2}
              className={`w-full rounded-lg border text-sm p-3 resize-none focus:outline-none focus:ring-2 focus:ring-pink-200 transition-colors
                ${isDirty ? "border-amber-300 bg-amber-50/40" : "border-border"}
                ${overLimit ? "border-red-300 bg-red-50/40" : ""}`}
            />
          ) : (
            <Input type="text" value={val} onChange={e => handleChange(s.key, e.target.value)}
              placeholder={getPlaceholder(s.key)}
              className={`h-9 rounded-lg text-sm ${isDirty ? "border-amber-300 bg-amber-50/40" : ""} ${!val ? "border-dashed" : ""}`}
            />
          )}
          {meta && (
            <div className="flex flex-col gap-0.5">
              <p className="text-[11px] text-muted-foreground">{meta.hint}</p>
              <p className="text-[10px] font-semibold text-pink-600">{meta.apps}</p>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground/60 font-mono">{s.key}</p>
        </div>
      );
    };

    const getField = (key: string) => catSettings.find(s => s.key === key);
    const msgFields  = ["content_banner","content_announcement","content_maintenance_msg","content_support_msg"].map(k => getField(k)).filter(Boolean) as Setting[];
    const noticeFields = ["content_vendor_notice","content_rider_notice"].map(k => getField(k)).filter(Boolean) as Setting[];
    const linkFields = ["content_tnc_url","content_privacy_url","content_refund_policy_url","content_faq_url","content_about_url"].map(k => getField(k)).filter(Boolean) as Setting[];

    return (
      <div className="space-y-7">
        {/* ── Feature Switches ── */}
        <div>
          <SLabel icon={ToggleRight}>Feature Switches</SLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {T("content_show_banner",   "Show Promotional Banner Carousel",   "Slide-show banners on customer home screen")}
            {T("feature_chat",          "In-App Chat / WhatsApp Support",      "Chat icon in customer app → routes to WhatsApp")}
            {T("feature_live_tracking", "Live Order GPS Tracking",             "Customer can track rider in real time")}
            {T("feature_reviews",       "Customer Reviews & Ratings",          "Star ratings + reviews on orders / rides")}
          </div>
        </div>

        {/* ── App Messaging ── */}
        <div className="border-t border-border/40 pt-5">
          <SLabel icon={MessageSquare}>App Messaging</SLabel>
          <div className="grid grid-cols-1 gap-4">
            {msgFields.map(s => <ContentField key={s.key} s={s} />)}
          </div>
        </div>

        {/* ── Role-Specific Notices ── */}
        <div className="border-t border-border/40 pt-5">
          <SLabel icon={Info}>Role-Specific Notices</SLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {noticeFields.map(s => <ContentField key={s.key} s={s} />)}
          </div>
          <div className="mt-3 rounded-xl bg-blue-50 border border-blue-200 p-3 text-xs text-blue-700 flex gap-2">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>These notices appear as a dismissable banner at the top of the Vendor Dashboard and Rider Home screens. Leave empty to hide them.</span>
          </div>
        </div>

        {/* ── Legal & Policy Links ── */}
        <div className="border-t border-border/40 pt-5">
          <SLabel icon={FileText}>Legal & Policy Links</SLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {linkFields.map(s => <ContentField key={s.key} s={s} />)}
          </div>
          <div className="mt-3 rounded-xl bg-gray-50 border border-border p-3 text-xs text-muted-foreground flex gap-2">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>All URLs open in the device browser. Rows are automatically hidden when the URL is empty — no code changes needed.</span>
          </div>
        </div>
      </div>
    );
  }

  if (cat === "general") {
    const appStatus = localValues["app_status"] ?? "active";
    const appStatusDirty = dirtyKeys.has("app_status");

    const GENERAL_GROUPS: { label: string; icon: any; keys: string[] }[] = [
      { label: "App Identity",     icon: Globe,        keys: ["app_name","app_tagline","app_version","app_status"] },
      { label: "Support Contact",  icon: Phone,        keys: ["support_phone","support_email","support_hours"] },
      { label: "Business Info",    icon: Building2,    keys: ["business_address"] },
      { label: "Social Media",     icon: Link,         keys: ["social_facebook","social_instagram"] },
    ];
    const GENERAL_LABELS: Record<string,string> = {
      app_name:         "App Name",
      app_tagline:      "App Tagline",
      app_version:      "App Version",
      app_status:       "App Status",
      support_phone:    "Support Phone",
      support_email:    "Support Email",
      support_hours:    "Support Hours",
      business_address: "Business Address",
      social_facebook:  "Facebook Page URL",
      social_instagram: "Instagram Profile URL",
    };
    const GENERAL_PLACEHOLDERS: Record<string,string> = {
      app_name:         "AJKMart",
      app_tagline:      "Your super app for everything",
      app_version:      "1.0.0",
      support_phone:    "03001234567",
      support_email:    "support@ajkmart.pk",
      support_hours:    "Mon–Sat, 8AM–10PM",
      business_address: "Muzaffarabad, AJK, Pakistan",
      social_facebook:  "https://facebook.com/ajkmart",
      social_instagram: "https://instagram.com/ajkmart",
    };
    const GENERAL_HINTS: Record<string,string> = {
      app_name:         "Shown in all three apps — customer, vendor and rider",
      app_tagline:      "Subtitle on the customer login screen",
      app_version:      "Shown in customer profile app info footer",
      support_phone:    "Tappable call button in all 3 apps",
      support_email:    "Shown in support section (optional — leave blank to hide)",
      support_hours:    "Shown under Call Support row in all apps",
      business_address: "Shown on login screen footer (vendor) and profile footer",
      social_facebook:  "Leave blank to hide the Follow Us row",
      social_instagram: "Leave blank to hide if Facebook is also blank",
    };

    return (
      <div className="space-y-6">
        {GENERAL_GROUPS.map(grp => (
          <div key={grp.label} className="space-y-3">
            <SLabel icon={grp.icon}>{grp.label}</SLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {grp.keys.map(key => {
                if (key === "app_status") {
                  const isActive = appStatus === "active";
                  return (
                    <div key={key}
                      onClick={() => handleChange("app_status", isActive ? "maintenance" : "active")}
                      className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-all select-none sm:col-span-2
                        ${isActive ? "bg-green-50 border-green-200" : "bg-red-50 border-red-300"}
                        ${appStatusDirty ? "ring-2 ring-amber-300" : ""}`}
                    >
                      <div className="flex items-center gap-2.5">
                        {isActive
                          ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                          : <AlertTriangle className="w-4 h-4 text-red-500" />}
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {isActive ? "🟢 App is LIVE" : "🔴 Maintenance Mode"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {isActive ? "All users can access the app normally" : "All apps show the maintenance screen to users"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        {appStatusDirty && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold hidden sm:flex">CHANGED</Badge>}
                        <div className={`w-11 h-6 rounded-full relative transition-colors ${isActive ? "bg-green-500" : "bg-red-500"}`}>
                          <div className={`w-5 h-5 bg-white rounded-full shadow absolute top-0.5 transition-transform ${isActive ? "translate-x-5" : "translate-x-0.5"}`} />
                        </div>
                      </div>
                    </div>
                  );
                }
                const isDirty = dirtyKeys.has(key);
                const curVal = localValues[key] ?? "";
                const isUrl = key.startsWith("social_");
                return (
                  <div key={key} className={`rounded-xl border p-3.5 space-y-2 transition-all ${isDirty ? "border-amber-300 bg-amber-50/30" : "border-border"}`}>
                    <div className="flex items-center gap-2">
                      {isUrl ? <Link className="w-3.5 h-3.5 text-muted-foreground" /> : <Globe className="w-3.5 h-3.5 text-muted-foreground" />}
                      <label className="text-sm font-semibold text-foreground flex-1">{GENERAL_LABELS[key] ?? key}</label>
                      {isDirty && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold">CHANGED</Badge>}
                      {curVal && !isDirty && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
                    </div>
                    <Input
                      type={key === "support_email" ? "email" : "text"}
                      value={curVal}
                      onChange={e => handleChange(key, e.target.value)}
                      placeholder={GENERAL_PLACEHOLDERS[key] ?? ""}
                      className={`h-9 rounded-lg text-sm ${isDirty ? "border-amber-300 bg-amber-50/40" : ""} ${!curVal ? "border-dashed" : ""}`}
                    />
                    {GENERAL_HINTS[key] && <p className="text-[11px] text-muted-foreground">{GENERAL_HINTS[key]}</p>}
                    <p className="text-[10px] text-muted-foreground/60 font-mono">{key}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
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
              ) : activeTab === "integrations" ? (
                <IntegrationsSection
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
