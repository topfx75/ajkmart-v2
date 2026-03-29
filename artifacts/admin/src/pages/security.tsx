import { useState, useEffect, useCallback } from "react";
import {
  Shield, Save, RefreshCw, Info, AlertTriangle,
  CheckCircle2, XCircle, Eye, EyeOff, Lock,
  KeyRound, FileText, Zap, Bike, BarChart3, Globe,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetcher } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type SecTab = "auth" | "authmethods" | "ratelimit" | "gps" | "passwords" | "uploads" | "fraud";

const SEC_TABS: { id: SecTab; label: string; emoji: string; active: string; desc: string }[] = [
  { id: "auth",        label: "Auth & Sessions",  emoji: "🔐", active: "bg-indigo-600",  desc: "OTP bypass, MFA, login lockout, session durations" },
  { id: "authmethods", label: "Auth Methods",      emoji: "🔑", active: "bg-cyan-600",    desc: "Per-role login method toggles: Phone OTP, Email OTP, Username/Password, Social, Magic Link, 2FA, Biometric" },
  { id: "ratelimit",   label: "Rate Limiting",     emoji: "🛡️", active: "bg-blue-600",    desc: "API throttling and VPN/TOR blocking" },
  { id: "gps",         label: "GPS & Location",    emoji: "📍", active: "bg-green-600",   desc: "Rider tracking, spoof detection, geofence" },
  { id: "passwords",   label: "Passwords",         emoji: "🔑", active: "bg-amber-600",   desc: "Password policy, JWT rotation, token expiry" },
  { id: "uploads",     label: "File Uploads",      emoji: "📁", active: "bg-teal-600",    desc: "Upload limits, allowed file types, compression" },
  { id: "fraud",       label: "Fraud Detection",   emoji: "🚨", active: "bg-red-600",     desc: "Fake orders, IP auto-block, account limits, IP whitelist" },
];

function Toggle({ checked, onChange, label, isDirty, danger, sub }: {
  checked: boolean; onChange: (v: boolean) => void;
  label: string; isDirty: boolean; danger?: boolean; sub?: string;
}) {
  return (
    <div onClick={() => onChange(!checked)}
      className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-all select-none
        ${checked ? danger ? "bg-red-50 border-red-300" : "bg-green-50 border-green-200" : "bg-white border-border hover:bg-muted/30"}
        ${isDirty ? "ring-2 ring-amber-300" : ""}`}
    >
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        {danger && <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />}
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
        <button type="button" onClick={() => setShow(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
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

export default function SecurityPage() {
  const { toast } = useToast();
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const [secTab, setSecTab] = useState<SecTab>("auth");

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetcher("/platform-settings");
      const vals: Record<string, string> = {};
      for (const s of (data.settings || [])) vals[s.key] = s.value;
      setLocalValues(vals);
      setDirtyKeys(new Set());
    } catch (e: unknown) {
      toast({ title: "Failed to load settings", description: (e as Error).message, variant: "destructive" });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const handleChange = (key: string, value: string) => {
    setLocalValues(prev => ({ ...prev, [key]: value }));
    setDirtyKeys(prev => { const n = new Set(prev); n.add(key); return n; });
  };
  const handleToggle = (key: string, v: boolean) => handleChange(key, v ? "on" : "off");

  const handleSave = async () => {
    setSaving(true);
    try {
      const changed = Array.from(dirtyKeys).map(key => ({ key, value: localValues[key] ?? "" }));
      await fetcher("/platform-settings", { method: "PUT", body: JSON.stringify({ settings: changed }) });
      setDirtyKeys(new Set());
      toast({ title: "Security settings saved ✅", description: `${changed.length} change(s) applied instantly.` });
    } catch (e: unknown) {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    }
    setSaving(false);
  };

  const val   = (k: string, def = "")    => localValues[k] ?? def;
  const dirty = (k: string)              => dirtyKeys.has(k);
  const tog   = (k: string, def = "off") => (localValues[k] ?? def) === "on";

  const T = ({ k, label, sub, danger }: { k: string; label: string; sub?: string; danger?: boolean }) => (
    <Toggle label={label} sub={sub} checked={tog(k, danger ? "off" : "on")}
      onChange={v => handleToggle(k, v)} isDirty={dirty(k)} danger={danger} />
  );
  const N = ({ k, label, suffix, placeholder, hint }: { k: string; label: string; suffix?: string; placeholder?: string; hint?: string }) => (
    <Field label={label} value={val(k)} onChange={v => handleChange(k, v)} isDirty={dirty(k)}
      type="number" suffix={suffix} placeholder={placeholder} hint={hint} />
  );
  const F = ({ k, label, placeholder, mono, hint }: { k: string; label: string; placeholder?: string; mono?: boolean; hint?: string }) => (
    <Field label={label} value={val(k)} onChange={v => handleChange(k, v)} isDirty={dirty(k)} placeholder={placeholder} mono={mono} hint={hint} />
  );
  const S = ({ k, label, placeholder }: { k: string; label: string; placeholder?: string }) => (
    <SecretInput label={label} value={val(k)} onChange={v => handleChange(k, v)} isDirty={dirty(k)} placeholder={placeholder} />
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-red-100 rounded-xl flex items-center justify-center">
            <Shield className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Security</h1>
            <p className="text-sm text-muted-foreground">
              {dirtyKeys.size > 0
                ? <span className="text-amber-600 font-medium">{dirtyKeys.size} unsaved change{dirtyKeys.size > 1 ? "s" : ""}</span>
                : <span>OTP, sessions, rate limits, GPS, fraud detection, IP whitelist, audit log</span>}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { loadSettings(); toast({ title: "Reloaded" }); }} disabled={loading} className="h-9 rounded-xl gap-2">
            <RefreshCw className="w-4 h-4" /> Reset
          </Button>
          <Button onClick={handleSave} disabled={saving || dirtyKeys.size === 0} className="h-9 rounded-xl gap-2 shadow-sm">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? "Saving..." : `Save${dirtyKeys.size > 0 ? ` (${dirtyKeys.size})` : ""}`}
          </Button>
        </div>
      </div>

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
              <T k="security_multi_device" label="Allow Multiple Device Logins"    sub="One session or many" />
            </div>
          </SecPanel>

          <SecPanel title="Session & Token Expiry" icon={Lock} color="text-indigo-700">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <N k="security_session_days"     label="Customer Session Expiry" suffix="days" placeholder="30" />
              <N k="security_admin_token_hrs"  label="Admin Token Expiry"      suffix="hrs"  placeholder="24" hint="24 hrs = 1 day" />
              <N k="security_rider_token_days" label="Rider Token Expiry"      suffix="days" placeholder="30" />
            </div>
          </SecPanel>

          <SecPanel title="Login Lockout Policy" icon={Lock} color="text-indigo-700">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex gap-2 mb-3">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>After <strong>Max Attempts</strong> failures, the account is locked for <strong>Lockout Duration</strong>. Applies to customer, rider, and vendor logins.</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <N k="security_login_max_attempts" label="Max Failed Login Attempts" placeholder="5"  hint="Before account lockout" />
              <N k="security_lockout_minutes"    label="Lockout Duration"          suffix="min"     placeholder="30" hint="0 = permanent until admin unlocks" />
            </div>
          </SecPanel>
        </div>
      )}

      {/* ─── Auth Methods (per-role) ─── */}
      {secTab === "authmethods" && (
        <div className="space-y-4">
          <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-3 text-xs text-cyan-800 flex gap-2 mb-1">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              Each auth method can be enabled or disabled per role (Customer, Rider, Vendor).
              Values are stored as JSON: <code className="font-mono bg-white/60 px-1 rounded">{`{"customer":"on","rider":"on","vendor":"off"}`}</code>.
              Changes take effect immediately for all apps.
            </span>
          </div>

          {(() => {
            const ROLE_AUTH_KEYS: { key: string; label: string; sub: string }[] = [
              { key: "auth_phone_otp_enabled",         label: "Phone OTP Login",          sub: "Send OTP via SMS to verify phone number" },
              { key: "auth_email_otp_enabled",         label: "Email OTP Login",          sub: "Send OTP via email to verify address" },
              { key: "auth_username_password_enabled", label: "Username / Password Login", sub: "Traditional username + password credentials" },
              { key: "auth_email_register_enabled",    label: "Email Registration",       sub: "Allow sign-up with email (no phone OTP)" },
              { key: "auth_magic_link_enabled",        label: "Magic Link Login",         sub: "Send one-click login link via email" },
              { key: "auth_2fa_enabled",               label: "Two-Factor Auth (TOTP)",   sub: "Require authenticator app code after login" },
              { key: "auth_biometric_enabled",         label: "Biometric Login",          sub: "Fingerprint / Face ID on mobile devices" },
            ];
            const ROLES = ["customer", "rider", "vendor"] as const;
            const ROLE_LABELS: Record<string, string> = { customer: "Customer", rider: "Rider", vendor: "Vendor" };
            const ROLE_COLORS: Record<string, { on: string; off: string; bg: string }> = {
              customer: { on: "bg-blue-500",   off: "bg-gray-300", bg: "text-blue-700"  },
              rider:    { on: "bg-green-500",  off: "bg-gray-300", bg: "text-green-700" },
              vendor:   { on: "bg-orange-500", off: "bg-gray-300", bg: "text-orange-700" },
            };

            function parseRoleVal(raw: string | undefined, def: string): Record<string, boolean> {
              if (!raw) return { customer: def === "on", rider: def === "on", vendor: def === "on" };
              try {
                const parsed = JSON.parse(raw) as Record<string, string>;
                return { customer: parsed.customer === "on", rider: parsed.rider === "on", vendor: parsed.vendor === "on" };
              } catch {
                return { customer: raw === "on", rider: raw === "on", vendor: raw === "on" };
              }
            }

            function toggleRole(settingKey: string, role: string, current: Record<string, boolean>) {
              const updated = { ...current, [role]: !current[role] };
              const jsonVal = JSON.stringify({
                customer: updated.customer ? "on" : "off",
                rider:    updated.rider    ? "on" : "off",
                vendor:   updated.vendor   ? "on" : "off",
              });
              handleChange(settingKey, jsonVal);
            }

            return (
              <SecPanel title="Login Methods (Per Role)" icon={KeyRound} color="text-cyan-700">
                <div className="space-y-3">
                  {ROLE_AUTH_KEYS.map(({ key, label, sub }) => {
                    const def = key.includes("2fa") || key.includes("biometric") || key.includes("magic_link") ? "off" : "on";
                    const roles = parseRoleVal(localValues[key], def);
                    const isDirty = dirtyKeys.has(key);
                    return (
                      <div key={key} className={`p-3.5 rounded-xl border transition-all ${isDirty ? "ring-2 ring-amber-300 border-amber-200 bg-amber-50/30" : "border-border bg-white hover:bg-muted/20"}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground leading-snug">{label}</p>
                            <p className="text-xs text-muted-foreground">{sub}</p>
                          </div>
                          {isDirty && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold flex-shrink-0 ml-2">CHANGED</Badge>}
                        </div>
                        <div className="flex gap-2">
                          {ROLES.map(role => {
                            const on = roles[role];
                            const colors = ROLE_COLORS[role];
                            return (
                              <button key={role} onClick={() => toggleRole(key, role, roles)}
                                className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-all border ${
                                  on ? `${colors.bg} bg-opacity-10 border-current` : "text-gray-400 bg-gray-50 border-gray-200"
                                }`}>
                                <div className={`w-3 h-3 rounded-full ${on ? colors.on : colors.off}`} />
                                {ROLE_LABELS[role]}
                                <span className="text-[10px] font-bold">{on ? "ON" : "OFF"}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SecPanel>
            );
          })()}

          <SecPanel title="Social Login (Global)" icon={Globe} color="text-cyan-700">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex gap-2 mb-3">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Social logins require Client ID / App ID to be configured below. The per-role toggles above control availability; these are the global legacy toggles.</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <Toggle label="Google Login (legacy)" sub="Global on/off for Google Sign-In" checked={tog("auth_social_google")}
                onChange={v => handleToggle("auth_social_google", v)} isDirty={dirty("auth_social_google")} />
              <Toggle label="Facebook Login (legacy)" sub="Global on/off for Facebook Login" checked={tog("auth_social_facebook")}
                onChange={v => handleToggle("auth_social_facebook", v)} isDirty={dirty("auth_social_facebook")} />
            </div>

            {(() => {
              const GLOBAL_AUTH_KEYS: { key: string; label: string; sub: string }[] = [
                { key: "auth_google_enabled",   label: "Google Login (per-role)", sub: "Per-role control for Google Sign-In" },
                { key: "auth_facebook_enabled", label: "Facebook Login (per-role)", sub: "Per-role control for Facebook Login" },
              ];
              const ROLES = ["customer", "rider", "vendor"] as const;
              const ROLE_LABELS: Record<string, string> = { customer: "Customer", rider: "Rider", vendor: "Vendor" };
              const ROLE_COLORS: Record<string, { on: string; off: string; bg: string }> = {
                customer: { on: "bg-blue-500",   off: "bg-gray-300", bg: "text-blue-700"  },
                rider:    { on: "bg-green-500",  off: "bg-gray-300", bg: "text-green-700" },
                vendor:   { on: "bg-orange-500", off: "bg-gray-300", bg: "text-orange-700" },
              };
              function parseRoleVal(raw: string | undefined): Record<string, boolean> {
                if (!raw) return { customer: false, rider: false, vendor: false };
                try {
                  const parsed = JSON.parse(raw) as Record<string, string>;
                  return { customer: parsed.customer === "on", rider: parsed.rider === "on", vendor: parsed.vendor === "on" };
                } catch { return { customer: raw === "on", rider: raw === "on", vendor: raw === "on" }; }
              }
              function toggleRole(settingKey: string, role: string, current: Record<string, boolean>) {
                const updated = { ...current, [role]: !current[role] };
                handleChange(settingKey, JSON.stringify({ customer: updated.customer ? "on" : "off", rider: updated.rider ? "on" : "off", vendor: updated.vendor ? "on" : "off" }));
              }
              return (
                <div className="space-y-3">
                  {GLOBAL_AUTH_KEYS.map(({ key, label, sub }) => {
                    const roles = parseRoleVal(localValues[key]);
                    const isDirtyK = dirtyKeys.has(key);
                    return (
                      <div key={key} className={`p-3.5 rounded-xl border transition-all ${isDirtyK ? "ring-2 ring-amber-300 border-amber-200 bg-amber-50/30" : "border-border bg-white hover:bg-muted/20"}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div><p className="text-sm font-semibold text-foreground">{label}</p><p className="text-xs text-muted-foreground">{sub}</p></div>
                          {isDirtyK && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold">CHANGED</Badge>}
                        </div>
                        <div className="flex gap-2">
                          {ROLES.map(role => {
                            const on = roles[role]; const colors = ROLE_COLORS[role];
                            return (
                              <button key={role} onClick={() => toggleRole(key, role, roles)}
                                className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-all border ${on ? `${colors.bg} bg-opacity-10 border-current` : "text-gray-400 bg-gray-50 border-gray-200"}`}>
                                <div className={`w-3 h-3 rounded-full ${on ? colors.on : colors.off}`} />
                                {ROLE_LABELS[role]}
                                <span className="text-[10px] font-bold">{on ? "ON" : "OFF"}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </SecPanel>

          <SecPanel title="Captcha & API Keys" icon={Shield} color="text-cyan-700">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <Toggle label="reCAPTCHA v3 Verification" sub="Require captcha on login / register / OTP" checked={tog("auth_captcha_enabled")}
                onChange={v => handleToggle("auth_captcha_enabled", v)} isDirty={dirty("auth_captcha_enabled")} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SecretInput label="reCAPTCHA Site Key" value={val("recaptcha_site_key")} onChange={v => handleChange("recaptcha_site_key", v)}
                isDirty={dirty("recaptcha_site_key")} placeholder="6Lc..." />
              <SecretInput label="reCAPTCHA Secret Key" value={val("recaptcha_secret_key")} onChange={v => handleChange("recaptcha_secret_key", v)}
                isDirty={dirty("recaptcha_secret_key")} placeholder="6Lc..." />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <SecretInput label="Google Client ID" value={val("google_client_id")} onChange={v => handleChange("google_client_id", v)}
                isDirty={dirty("google_client_id")} placeholder="xxxx.apps.googleusercontent.com" />
              <SecretInput label="Facebook App ID" value={val("facebook_app_id")} onChange={v => handleChange("facebook_app_id", v)}
                isDirty={dirty("facebook_app_id")} placeholder="123456789" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <Field label="reCAPTCHA Min Score" value={val("recaptcha_min_score", "0.5")} onChange={v => handleChange("recaptcha_min_score", v)}
                isDirty={dirty("recaptcha_min_score")} type="number" placeholder="0.5" hint="0.0 to 1.0 (higher = stricter)" />
              <Field label="OTP Resend Cooldown" value={val("security_otp_cooldown_sec", "60")} onChange={v => handleChange("security_otp_cooldown_sec", v)}
                isDirty={dirty("security_otp_cooldown_sec")} type="number" suffix="sec" placeholder="60" hint="Seconds between OTP sends" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <Field label="Trusted Device Expiry" value={val("auth_trusted_device_days", "30")} onChange={v => handleChange("auth_trusted_device_days", v)}
                isDirty={dirty("auth_trusted_device_days")} type="number" suffix="days" placeholder="30" hint="Skip 2FA on trusted devices" />
            </div>
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
              <N k="security_rate_limit"  label="General API (customers)" suffix="req/min" placeholder="100" />
              <N k="security_rate_admin"  label="Admin Panel"             suffix="req/min" placeholder="60" />
              <N k="security_rate_rider"  label="Rider App API"           suffix="req/min" placeholder="200" />
              <N k="security_rate_vendor" label="Vendor App API"          suffix="req/min" placeholder="150" />
              <N k="security_rate_burst"  label="Burst Allowance"         suffix="req"     placeholder="20"  hint="Extra requests allowed before block" />
            </div>
          </SecPanel>

          <SecPanel title="IP-Level Blocking" icon={Shield} color="text-blue-700">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 flex gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span><strong>Warning:</strong> VPN blocking may affect legitimate users. TOR blocking prevents anonymous access. Use carefully in Pakistan — some users may use VPNs for privacy.</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <T k="security_block_tor" label="Block TOR Exit Nodes"  sub="Prevents anonymous TOR access" />
              <T k="security_block_vpn" label="Block VPN/Proxy Users" sub="Fraud prevention (may affect legit users)" />
            </div>
          </SecPanel>

          <div className="rounded-2xl border border-border bg-muted/20 p-5">
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5" /> Current Rate Limit Overview
            </p>
            <div className="space-y-2">
              {[
                { label: "Customer API", key: "security_rate_limit",  color: "bg-green-500",  def: "100" },
                { label: "Rider API",    key: "security_rate_rider",  color: "bg-blue-500",   def: "200" },
                { label: "Vendor API",   key: "security_rate_vendor", color: "bg-orange-500", def: "150" },
                { label: "Admin Panel",  key: "security_rate_admin",  color: "bg-purple-500", def: "60"  },
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
              <T k="security_gps_tracking"    label="Enable GPS Tracking"    sub="Rider location updates sent to server" />
              <T k="security_spoof_detection" label="GPS Spoofing Detection" sub="Mock location / fake GPS app detection" />
              <T k="security_geo_fence"       label="Strict Geofence Mode"   sub="Riders must be within service area" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <N k="security_gps_accuracy"  label="Min GPS Accuracy Required" suffix="m"    placeholder="50"  hint="Reject readings worse than this" />
              <N k="security_gps_interval"  label="Location Update Interval"  suffix="sec"  placeholder="10"  hint="How often rider sends GPS ping" />
              <N k="security_max_speed_kmh" label="Max Plausible Speed"       suffix="km/h" placeholder="150" hint="Above this = flag as suspicious" />
            </div>
          </SecPanel>

          <SecPanel title="Service Area & Coverage" icon={Globe} color="text-green-700">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex gap-2">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Service area boundaries are controlled per city in the Geofence settings. When Strict Mode is on, orders outside the defined zones are automatically rejected.</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
              <F k="security_service_city"      label="Primary Service City"    placeholder="Muzaffarabad, AJK" />
              <F k="security_service_radius_km" label="Max Service Radius (km)" placeholder="30" mono hint="From city center" />
            </div>
          </SecPanel>

          <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-xs text-green-800 space-y-1">
            <p className="font-bold flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> GPS Spoofing Detection checks for:</p>
            <ul className="list-disc list-inside space-y-0.5 ml-1 text-green-700">
              <li>Mock location apps (Developer Options enabled)</li>
              <li>Location jumping more than {val("security_max_speed_kmh", "150")} km/h between pings</li>
              <li>Accuracy worse than {val("security_gps_accuracy", "50")}m reported by device</li>
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
              <N k="security_pwd_min_length"  label="Minimum Length"  suffix="chars" placeholder="8" />
              <N k="security_pwd_expiry_days" label="Password Expiry" suffix="days"  placeholder="0" hint="0 = never expires" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <T k="security_pwd_strong" label="Require Strong Password" sub="Must include uppercase, number & symbol" />
            </div>
            <div className="mt-4 bg-muted/50 rounded-xl p-3 border border-border">
              <p className="text-xs font-semibold text-foreground mb-2">Current Password Rules Preview:</p>
              <div className="space-y-1">
                {[
                  { ok: parseInt(val("security_pwd_min_length", "8")) >= 8, label: `At least ${val("security_pwd_min_length", "8")} characters` },
                  { ok: tog("security_pwd_strong", "on"), label: "Uppercase letter required (A-Z)" },
                  { ok: tog("security_pwd_strong", "on"), label: "Number required (0-9)" },
                  { ok: tog("security_pwd_strong", "on"), label: "Special character required (!@#$...)" },
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
              <span>JWT Secret is auto-generated and stored securely. Rotation invalidates all existing sessions — users must log in again.</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <N k="security_jwt_rotation_days" label="JWT Secret Rotation" suffix="days" placeholder="90" hint="All sessions invalidated on rotation" />
              <N k="security_admin_token_hrs"   label="Admin Token Expiry"  suffix="hrs"  placeholder="24" />
              <N k="security_session_days"      label="Customer Session"     suffix="days" placeholder="30" />
              <N k="security_rider_token_days"  label="Rider Token Expiry"  suffix="days" placeholder="30" />
            </div>
          </SecPanel>
        </div>
      )}

      {/* ─── File Uploads ─── */}
      {secTab === "uploads" && (
        <div className="space-y-4">
          <SecPanel title="Upload Permissions" icon={FileText} color="text-teal-700">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <T k="security_allow_uploads"   label="Allow File Uploads"   sub="Photos, payment proofs, KYC docs" />
              <T k="security_compress_images" label="Auto-compress Images" sub="Reduces storage & bandwidth usage" />
              <T k="security_scan_uploads"    label="Virus/Malware Scan"   sub="Scan uploads before saving (requires ClamAV)" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <N k="security_max_file_mb" label="Max File Size"        suffix="MB" placeholder="5"  hint="Per upload" />
              <N k="security_img_quality" label="Compression Quality"  suffix="%" placeholder="80" hint="80% = good balance" />
            </div>
          </SecPanel>

          <SecPanel title="Allowed File Types" icon={FileText} color="text-teal-700">
            <F k="security_allowed_types" label="Allowed Extensions (comma-separated)" placeholder="jpg,jpeg,png,pdf"
              mono hint="Reject all other file types at the upload API layer" />
            <div className="flex flex-wrap gap-1.5">
              {val("security_allowed_types", "jpg,jpeg,png,pdf").split(",").map(t => t.trim()).filter(Boolean).map(ext => (
                <span key={ext} className="px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full text-xs font-bold uppercase">{ext}</span>
              ))}
            </div>
          </SecPanel>

          <SecPanel title="Upload Use Cases" icon={CheckCircle2} color="text-teal-700">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { k: "upload_payment_proof", label: "Payment Proof Screenshots", sub: "JazzCash / EasyPaisa receipts" },
                { k: "upload_kyc_docs",      label: "KYC Identity Documents",    sub: "CNIC photos for wallet KYC" },
                { k: "upload_rider_docs",    label: "Rider CNIC & License",      sub: "Registration documents" },
                { k: "upload_vendor_docs",   label: "Vendor Business Docs",      sub: "Shop license / registration" },
                { k: "upload_product_imgs",  label: "Product/Menu Images",       sub: "Vendor product photos" },
                { k: "upload_cod_proof",     label: "COD Cash Photo Proof",      sub: "High-value COD orders" },
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
              <T k="security_fake_order_detect" label="Fake Order Auto-Detection"   sub="Flag suspicious order patterns" />
              <T k="security_auto_block_ip"     label="Auto-block Suspicious IPs"   sub="After repeated fake orders" />
              <T k="security_phone_verify"      label="Phone Verification Required" sub="Before placing first order" />
              <T k="security_single_phone"      label="One Account per Phone"       sub="Prevent multi-account fraud" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <N k="security_max_daily_orders" label="Max Orders per Day"         placeholder="20" hint="Per customer account" />
              <N k="security_new_acct_limit"   label="New Account Order Limit"   placeholder="3"  hint="First 7 days after signup" />
              <N k="security_same_addr_limit"  label="Same-Address Hourly Limit" placeholder="5"  hint="Orders from same address per hour" />
            </div>
          </SecPanel>

          <SecPanel title="Admin Access & Audit Log" icon={Shield} color="text-red-700">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <T k="security_audit_log"    label="Admin Action Audit Log" sub="Log all admin changes with timestamp & IP" />
              <T k="security_mfa_required" label="Require 2FA for Admin"  sub="TOTP code required at every login" />
            </div>
            <F k="security_admin_ip_whitelist" label="Admin IP Whitelist (comma-separated, blank = allow all)"
              placeholder="103.25.0.1, 123.123.123.123" mono
              hint="Only these IPs can access the admin panel. Leave blank for no restriction." />
            {val("security_admin_ip_whitelist") && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {val("security_admin_ip_whitelist").split(",").map(ip => ip.trim()).filter(Boolean).map(ip => (
                  <span key={ip} className="px-2.5 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-mono font-bold">{ip}</span>
                ))}
              </div>
            )}
            {!val("security_admin_ip_whitelist") && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 mt-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>No IP restriction set — admin panel accessible from any IP.</span>
              </div>
            )}
          </SecPanel>

          <SecPanel title="Maintenance Bypass Key" icon={Shield} color="text-red-700">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex gap-2 mb-3">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Admins can bypass maintenance mode by appending <span className="font-mono bg-white/70 px-1 rounded">?key=YOUR_KEY</span> to the app URL.</span>
            </div>
            <S k="security_maintenance_key" label="Maintenance Mode Bypass Key" placeholder="maint-bypass-secret-2025" />
          </SecPanel>
        </div>
      )}

      <div className="bg-blue-50/60 border border-blue-200/60 rounded-xl p-4 flex gap-3">
        <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-blue-700">
          <strong className="text-blue-800">Changes apply instantly</strong> after saving — no restart needed.
        </p>
      </div>
    </div>
  );
}
