import { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle, Info, CheckCircle2, XCircle, Shield,
  RefreshCw, Lock, Eye, EyeOff, Loader2,
  ShieldCheck, UserPlus, MapPin, FileText, Clock,
  Zap, BarChart3, Bike, Globe, KeyRound, Users, Settings,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Toggle, Field, SecretInput, SLabel } from "@/components/AdminShared";

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

export function SecuritySection({ localValues, dirtyKeys, handleChange, handleToggle }: {
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
  const apiHeaders  = { "Content-Type": "application/json", "x-admin-token": adminSecret };

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

          <SecPanel title="Integration Status" icon={KeyRound} color="text-purple-700">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex gap-2 mb-3">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Configure API keys and toggles in the <strong>Integrations tab</strong>. Status shown here reflects live values.</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: "Google Maps API Key",    key: "maps_api_key",   tab: "Maps" },
                { label: "Firebase FCM Server Key", key: "fcm_server_key",  tab: "Firebase" },
                { label: "SMS Provider",            key: "sms_provider",    tab: "SMS", isText: true },
                { label: "Sentry DSN",              key: "sentry_dsn",      tab: "Sentry" },
              ].map(({ label, key, tab, isText }) => {
                const v = localValues[key] ?? "";
                const configured = isText ? (v && v !== "console" && v !== "none") : !!v;
                return (
                  <div key={key} className={`rounded-xl border p-3 flex items-center gap-3 ${configured ? "border-green-200 bg-green-50" : "border-border bg-muted/20"}`}>
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${configured ? "bg-green-500" : "bg-gray-300"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground">{label}</p>
                      <p className="text-[10px] text-muted-foreground">{configured ? (isText ? v : "Configured ✓") : `Not set — go to Integrations › ${tab}`}</p>
                    </div>
                  </div>
                );
              })}
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
