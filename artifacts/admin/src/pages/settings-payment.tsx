import { useState } from "react";
import {
  AlertTriangle, ExternalLink, Loader2, CheckCircle2, XCircle, Wifi,
  Settings, KeyRound, Phone, Building2, Banknote, Wallet,
  Gift, Star, Percent, CreditCard, ToggleRight, Shield,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetcher } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Toggle, Field, SecretInput, SLabel, ModeBtn } from "@/components/AdminShared";

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
        headers: { "x-admin-token": localStorage.getItem("ajkmart_admin_token") || "" },
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

        {/* Service availability */}
        <div>
          <SLabel>Kaun Si Services Mein Available Hai</SLabel>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              { key: `${prefix}_allowed_mart`,     label: "Mart / Grocery",  icon: "🛒", on: (localValues[`${prefix}_allowed_mart`]     ?? "on") === "on" },
              { key: `${prefix}_allowed_food`,     label: "Food Delivery",   icon: "🍔", on: (localValues[`${prefix}_allowed_food`]     ?? "on") === "on" },
              { key: `${prefix}_allowed_pharmacy`, label: "Pharmacy",        icon: "💊", on: (localValues[`${prefix}_allowed_pharmacy`] ?? "on") === "on" },
              { key: `${prefix}_allowed_parcel`,   label: "Parcel Delivery", icon: "📦", on: (localValues[`${prefix}_allowed_parcel`]   ?? "on") === "on" },
              { key: `${prefix}_allowed_rides`,    label: "Rides",           icon: "🚗", on: (localValues[`${prefix}_allowed_rides`]    ?? "on") === "on" },
            ].map(s => (
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
          <p className="text-[11px] text-muted-foreground mt-1.5">{name} band karne ke liye service card tap karein</p>
        </div>

        {/* ── IP Allowlist (callback security) ── */}
        <div className="rounded-xl border border-orange-200 bg-orange-50/40 p-4 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-4 h-4 text-orange-600 flex-shrink-0" />
            <p className="text-sm font-semibold text-foreground">Callback IP Allowlist</p>
            {dirtyKeys.has(`${prefix}_allowed_ips`) && <span className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">CHANGED</span>}
          </div>
          <p className="text-xs text-muted-foreground">
            Only requests from these IPs will be accepted on the callback URL. Leave empty to allow all IPs (current behavior).
            Enter comma-separated IPv4 addresses (e.g. <span className="font-mono text-xs">203.0.113.5, 198.51.100.12</span>).
          </p>
          <textarea
            value={localValues[`${prefix}_allowed_ips`] ?? ""}
            onChange={e => handleChange(`${prefix}_allowed_ips`, e.target.value)}
            rows={2}
            placeholder="e.g. 203.0.113.5, 198.51.100.12"
            className={`w-full rounded-lg border text-xs font-mono p-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-orange-400/40 ${dirtyKeys.has(`${prefix}_allowed_ips`) ? "border-amber-300 bg-amber-50/50" : "border-border bg-white"}`}
          />
          <p className="text-[11px] text-orange-700 font-medium">
            ⚠ If set, requests from unlisted IPs will be rejected with 403 in both sandbox and production modes.
          </p>
        </div>

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

        {/* Service availability */}
        <div>
          <SLabel>Kaun Si Services Mein Available Hai</SLabel>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              { key: "bank_allowed_mart",     label: "Mart / Grocery",  icon: "🛒", on: (v("bank_allowed_mart")     || "on") === "on" },
              { key: "bank_allowed_food",     label: "Food Delivery",   icon: "🍔", on: (v("bank_allowed_food")     || "on") === "on" },
              { key: "bank_allowed_pharmacy", label: "Pharmacy",        icon: "💊", on: (v("bank_allowed_pharmacy") || "on") === "on" },
              { key: "bank_allowed_parcel",   label: "Parcel Delivery", icon: "📦", on: (v("bank_allowed_parcel")   || "on") === "on" },
              { key: "bank_allowed_rides",    label: "Rides",           icon: "🚗", on: (v("bank_allowed_rides")    || "on") === "on" },
            ].map(s => (
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
          <p className="text-[11px] text-muted-foreground mt-1.5">Bank Transfer band karne ke liye service card tap karein</p>
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
  const ridesOn     = (localValues["cod_allowed_rides"]   ?? "on") === "on";
  const v = (k: string) => localValues[k] ?? "";
  const d = (k: string) => dirtyKeys.has(k);

  const services = [
    { key: "cod_allowed_mart",     label: "Mart / Grocery",  icon: "🛒", on: martOn     },
    { key: "cod_allowed_food",     label: "Food Delivery",   icon: "🍔", on: foodOn     },
    { key: "cod_allowed_pharmacy", label: "Pharmacy",        icon: "💊", on: pharmacyOn },
    { key: "cod_allowed_parcel",   label: "Parcel Delivery", icon: "📦", on: parcelOn   },
    { key: "cod_allowed_rides",    label: "Rides",           icon: "🚗", on: ridesOn    },
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
            { label: "Services",    value: `${[martOn,foodOn,pharmacyOn,parcelOn,ridesOn].filter(Boolean).length}/5 on`, icon: "✅" },
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
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
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
function WalletSection({ localValues, dirtyKeys, handleChange, handleToggle, onNavigateFeatures }: {
  localValues: Record<string,string>; dirtyKeys: Set<string>;
  handleChange: (k: string, v: string) => void; handleToggle: (k: string, v: boolean) => void;
  onNavigateFeatures?: () => void;
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
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <Badge variant="outline" className={`text-[11px] font-bold border px-2.5 py-1 ${enabled ? "bg-green-50 text-green-700 border-green-300" : "bg-red-50 text-red-600 border-red-300"}`}>
            {enabled ? "● Enabled" : "○ Disabled"}
          </Badge>
          {onNavigateFeatures ? (
            <button onClick={onNavigateFeatures} className="text-[10px] text-blue-600 hover:underline flex items-center gap-0.5">
              Change in Feature Toggles ↗
            </button>
          ) : (
            <p className="text-[10px] text-muted-foreground/70">Toggle in Features tab</p>
          )}
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Quick stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Max Balance", value: `Rs. ${v("wallet_max_balance") || "50000"}`, icon: "💎" },
            { label: "Daily Limit", value: `Rs. ${v("wallet_daily_limit") || "20000"}`, icon: "📅" },
            { label: "Cashback",    value: `${v("wallet_cashback_pct") || "0"}%`, icon: "🎁" },
            { label: "Signup Bonus",value: v("customer_signup_bonus") && v("customer_signup_bonus") !== "0" ? `Rs. ${v("customer_signup_bonus")}` : "None", icon: "🎊" },
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
            <SLabel>P2P Transfer Settings</SLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="P2P Daily Send Limit (Rs.)" value={v("wallet_p2p_daily_limit")} onChange={v2 => handleChange("wallet_p2p_daily_limit", v2)} placeholder="10000" isDirty={d("wallet_p2p_daily_limit")} type="number" hint="Customer roz kitna transfer kar sakta hai" />
              <Field label="P2P Fee (%)" value={v("wallet_p2p_fee_pct")} onChange={v2 => handleChange("wallet_p2p_fee_pct", v2)} placeholder="0" isDirty={d("wallet_p2p_fee_pct")} type="number" suffix="%" hint="Har P2P transfer par platform fee (0 = no fee)" />
            </div>
          </div>
        )}

        {/* Deposit Auto-Approve */}
        <div>
          <SLabel>Deposit Auto-Approval</SLabel>
          <Field label="Auto-Approve Threshold (Rs.)" value={v("wallet_deposit_auto_approve")} onChange={v2 => handleChange("wallet_deposit_auto_approve", v2)} placeholder="0" isDirty={d("wallet_deposit_auto_approve")} type="number" hint="Is amount tak ke deposits auto-approve honge (0 = sab manual review)" suffix="Rs." />
        </div>

        {/* Rewards & Bonuses */}
        <div>
          <SLabel>Rewards & Bonuses</SLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Wallet Cashback (%)" value={v("wallet_cashback_pct")} onChange={v2 => handleChange("wallet_cashback_pct", v2)} placeholder="0" isDirty={d("wallet_cashback_pct")} type="number" hint="Wallet se payment par % cashback" suffix="%" />
            <Field label="Referral Bonus (Rs.)" value={v("customer_referral_bonus")} onChange={v2 => handleChange("customer_referral_bonus", v2)} placeholder="100" isDirty={d("customer_referral_bonus")} type="number" hint="Naye referral join karne par milta hai (Customer settings ke saath sync)" />
            <Field label="New User Signup Bonus (Rs.)" value={v("customer_signup_bonus")} onChange={v2 => handleChange("customer_signup_bonus", v2)} placeholder="0" isDirty={d("customer_signup_bonus")} type="number" hint="Account banane par wallet mein milega (Customer settings ke saath sync)" />
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

        {/* Service availability */}
        <div>
          <SLabel>Kaun Si Services Mein Available Hai</SLabel>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              { key: "wallet_allowed_mart",     label: "Mart / Grocery",  icon: "🛒", on: (v("wallet_allowed_mart")     || "on") === "on" },
              { key: "wallet_allowed_food",     label: "Food Delivery",   icon: "🍔", on: (v("wallet_allowed_food")     || "on") === "on" },
              { key: "wallet_allowed_pharmacy", label: "Pharmacy",        icon: "💊", on: (v("wallet_allowed_pharmacy") || "on") === "on" },
              { key: "wallet_allowed_parcel",   label: "Parcel Delivery", icon: "📦", on: (v("wallet_allowed_parcel")   || "on") === "on" },
              { key: "wallet_allowed_rides",    label: "Rides",           icon: "🚗", on: (v("wallet_allowed_rides")    || "on") === "on" },
            ].map(s => (
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
          <p className="text-[11px] text-muted-foreground mt-1.5">Wallet payment band karne ke liye service card tap karein</p>
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
export function PaymentSection({ localValues, dirtyKeys, handleChange, handleToggle, onNavigateFeatures }: {
  localValues: Record<string,string>; dirtyKeys: Set<string>;
  handleChange: (k: string, v: string) => void; handleToggle: (k: string, v: boolean) => void;
  onNavigateFeatures?: () => void;
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
          <WalletSection localValues={localValues} dirtyKeys={dirtyKeys} handleChange={handleChange} handleToggle={handleToggle} onNavigateFeatures={onNavigateFeatures} />
        )}
        {payTab === "rules" && (
          <PaymentRules localValues={localValues} dirtyKeys={dirtyKeys} handleChange={handleChange} handleToggle={handleToggle} />
        )}
      </div>
    </div>
  );
}
