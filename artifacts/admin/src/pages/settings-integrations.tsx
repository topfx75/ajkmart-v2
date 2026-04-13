import { useState } from "react";
import {
  AlertTriangle, Info, ExternalLink, CheckCircle2, XCircle, Wifi, Loader2,
  MessageSquare, Phone, Globe, MapPin, BarChart3, Shield, Bug, Link,
  KeyRound, Puzzle, ToggleRight, Car, Send, FlaskConical,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetcher } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Toggle, Field, SecretInput, SLabel } from "@/components/AdminShared";
import { MapsMgmtSection } from "@/components/MapsMgmtSection";

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
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-bold text-foreground text-sm">{title}</h4>
              <IntStatusBadge enabled={enabled} configured={configured} />
              {dirtyKeys.has(enableKey) && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-bold">CHANGED</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => handleToggle(enableKey, !enabled)}
          aria-label={enabled ? `Disable ${title}` : `Enable ${title}`}
          className="ml-3 flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full"
        >
          <div className={`w-12 h-6 rounded-full relative transition-colors ${enabled ? "bg-green-500" : "bg-gray-300"}`}>
            <div className={`w-5 h-5 bg-white rounded-full shadow absolute top-0.5 transition-transform ${enabled ? "translate-x-6" : "translate-x-0.5"}`} />
          </div>
        </button>
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

export function IntegrationsSection({ localValues, dirtyKeys, handleChange, handleToggle }: {
  localValues: Record<string,string>; dirtyKeys: Set<string>;
  handleChange: (k: string, v: string) => void;
  handleToggle: (k: string, v: boolean) => void;
}) {
  const [intTab, setIntTab] = useState<IntTab>("firebase");

  /* Per-integration test state (keyed by type) */
  const [testPhones, setTestPhones] = useState<Record<string, string>>({});
  const [testingMap, setTestingMap] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; msg: string } | null>>({});
  const [fcmDeviceToken, setFcmDeviceToken] = useState("");

  const { toast } = useToast();

  const val = (k: string) => localValues[k] ?? "";
  const dirty = (k: string) => dirtyKeys.has(k);
  const tog = (k: string, def: string = "off") => (localValues[k] ?? def) === "on";

  /* Clear stale test results when switching tabs */
  const switchTab = (tab: IntTab) => {
    setIntTab(tab);
  };

  async function runTest(type: "email" | "sms" | "whatsapp" | "fcm" | "maps") {
    setTestingMap(prev => ({ ...prev, [type]: true }));
    setTestResults(prev => ({ ...prev, [type]: null }));
    try {
      const body: Record<string, string> = {};
      if (type === "sms" || type === "whatsapp") {
        const phone = (testPhones[type] ?? "").trim();
        if (!phone) {
          toast({ title: "Phone required", description: "Enter a phone number to test SMS/WhatsApp", variant: "destructive" });
          setTestingMap(prev => ({ ...prev, [type]: false }));
          return;
        }
        body["phone"] = phone;
      }
      if (type === "fcm") {
        const token = fcmDeviceToken.trim();
        if (!token) {
          toast({ title: "Device token required", description: "Enter an FCM device token to test push notifications", variant: "destructive" });
          setTestingMap(prev => ({ ...prev, [type]: false }));
          return;
        }
        body["deviceToken"] = token;
      }
      const data = await fetcher(`/system/test-integration/${type}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const msg = (data as any)?.message ?? `${type} test sent successfully`;
      setTestResults(prev => ({ ...prev, [type]: { ok: true, msg } }));
      toast({ title: "Test Passed ✅", description: msg });
    } catch (err: any) {
      const msg = err?.message ?? `${type} test failed`;
      setTestResults(prev => ({ ...prev, [type]: { ok: false, msg } }));
      toast({ title: "Test Failed ❌", description: msg, variant: "destructive" });
    } finally {
      setTestingMap(prev => ({ ...prev, [type]: false }));
    }
  }

  function TestRow({ type, label }: { type: "email" | "sms" | "whatsapp"; label: string }) {
    const needsPhone = type !== "email";
    const isTesting = !!testingMap[type];
    const result = testResults[type] ?? null;
    return (
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 p-3 bg-muted/30 rounded-xl border border-border/50">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <FlaskConical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <span className="text-xs font-semibold text-foreground">{label}</span>
          {result && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${result.ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
              {result.ok ? "✓ PASSED" : "✗ FAILED"}
            </span>
          )}
        </div>
        {needsPhone && (
          <Input
            value={testPhones[type] ?? ""}
            onChange={e => setTestPhones(prev => ({ ...prev, [type]: e.target.value }))}
            placeholder="03xxxxxxxxx"
            className="h-7 text-xs w-40 font-mono"
          />
        )}
        <button
          type="button"
          onClick={() => runTest(type)}
          disabled={isTesting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all focus-visible:ring-2 focus-visible:ring-primary focus:outline-none">
          {isTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          {isTesting ? "Sending…" : "Send Test"}
        </button>
        {result && (
          <p className="text-[10px] text-muted-foreground w-full sm:w-auto truncate max-w-xs" title={result.msg}>{result.msg}</p>
        )}
      </div>
    );
  }

  const F = ({ label, k, placeholder, mono, hint }: { label: string; k: string; placeholder?: string; mono?: boolean; hint?: string }) => (
    <Field label={label} value={val(k)} onChange={v => handleChange(k, v)} isDirty={dirty(k)} placeholder={placeholder} mono={mono} hint={hint} />
  );
  const S = ({ label, k, placeholder }: { label: string; k: string; placeholder?: string }) => (
    <SecretInput label={label} value={val(k)} onChange={v => handleChange(k, v)} isDirty={dirty(k)} placeholder={placeholder} />
  );
  const T = ({ label, k, sub, def = "off" }: { label: string; k: string; sub?: string; def?: string }) => (
    <Toggle label={label} checked={tog(k, def)} onChange={v => handleToggle(k, v)} isDirty={dirty(k)} sub={sub} />
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
  const mapsEnabled = (localValues["integration_maps"] ?? "off") === "on";
  const mapsConfigured = !!(val("maps_api_key") || val("mapbox_api_key") || val("google_maps_api_key") || val("locationiq_api_key"));

  /* Dynamic webhook URL */
  const webhookBaseUrl = window.location.origin;
  const whatsappWebhookUrl = `${webhookBaseUrl}/api/webhooks/whatsapp`;

  return (
    <div className="space-y-4">
      {/* Sub-tab bar — horizontally scrollable on mobile */}
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="flex gap-1.5 bg-muted/50 p-1.5 rounded-xl w-max min-w-full">
          {INT_TABS.map(t => (
            <button key={t.id} type="button" onClick={() => switchTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap flex-shrink-0 transition-all focus-visible:ring-2 focus-visible:ring-primary focus:outline-none ${intTab === t.id ? `${t.active} text-white shadow-sm` : `text-muted-foreground hover:bg-white`}`}>
              <span>{t.emoji}</span> {t.label}
            </button>
          ))}
        </div>
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
                  <Toggle key={k} label={label} sub={sub} checked={tog(k, "on")}
                    onChange={v => handleToggle(k, v)} isDirty={dirty(k)} />
                ))}
              </div>
            </div>
            {fcmConfigured && (
              <div>
                <SLabel icon={FlaskConical}>Test Push Notification</SLabel>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 p-3 bg-muted/30 rounded-xl border border-border/50 mt-3">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <FlaskConical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-xs font-semibold text-foreground">Send test push to FCM device token</span>
                    {testResults["fcm"] && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${testResults["fcm"]!.ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {testResults["fcm"]!.ok ? "✓ PASSED" : "✗ FAILED"}
                      </span>
                    )}
                  </div>
                  <Input
                    value={fcmDeviceToken}
                    onChange={e => setFcmDeviceToken(e.target.value)}
                    placeholder="FCM device registration token"
                    className="h-7 text-xs w-52 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => runTest("fcm")}
                    disabled={!!testingMap["fcm"]}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all focus-visible:ring-2 focus-visible:ring-primary focus:outline-none">
                    {testingMap["fcm"] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    {testingMap["fcm"] ? "Sending…" : "Send Test Push"}
                  </button>
                  {testResults["fcm"] && (
                    <p className="text-[10px] text-muted-foreground w-full sm:w-auto truncate max-w-xs" title={testResults["fcm"]!.msg}>{testResults["fcm"]!.msg}</p>
                  )}
                </div>
              </div>
            )}
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
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
                {[
                  { id: "twilio",  label: "Twilio",        emoji: "📞", desc: "International & PK" },
                  { id: "msg91",   label: "MSG91",          emoji: "🇮🇳", desc: "India & Pakistan" },
                  { id: "zong",    label: "Zong/CM.com",   emoji: "🇵🇰", desc: "AJK / Pakistan" },
                ].map(p => (
                  <button key={p.id} type="button" onClick={() => handleChange("sms_provider", p.id)}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${smsProvider === p.id ? "border-blue-500 bg-blue-50" : "border-border hover:bg-muted/30"} ${dirty("sms_provider") ? "ring-1 ring-amber-300" : ""}`}>
                    <div className="text-xl mb-1">{p.emoji}</div>
                    <div className="text-xs font-bold">{p.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{p.desc}</div>
                  </button>
                ))}
              </div>
              {smsProvider === "console" && (
                <div className="bg-red-50 border border-red-300 rounded-xl p-3 text-xs text-red-800 flex gap-2 mt-3">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span><strong>Action Required:</strong> Console provider is no longer supported. Please select Twilio, MSG91, or Zong above to send real SMS messages.</span>
                </div>
              )}
            </div>
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
            {smsConfigured && (
              <div>
                <SLabel icon={FlaskConical}>Test Connection</SLabel>
                <div className="mt-3">
                  <TestRow type="sms" label="Send test OTP SMS (OTP: 123456)" />
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
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-foreground">Encryption Mode</label>
                  {dirty("smtp_secure") && <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-700 border-amber-200 font-bold">CHANGED</Badge>}
                </div>
                <div className="flex gap-2 mt-1.5">
                  {["tls","ssl","none"].map(mode => (
                    <button key={mode} type="button" onClick={() => handleChange("smtp_secure", mode)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${val("smtp_secure") === mode ? "bg-teal-600 text-white border-teal-600" : "border-border hover:bg-muted/30"} ${dirty("smtp_secure") ? "ring-1 ring-amber-300" : ""}`}>
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
            {smtpConfigured && (
              <div>
                <SLabel icon={FlaskConical}>Test Connection</SLabel>
                <div className="mt-3">
                  <TestRow type="email" label="Send test alert email to admin recipient" />
                </div>
              </div>
            )}
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
                  <p className="text-xs font-mono text-muted-foreground break-all">{whatsappWebhookUrl}</p>
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
                  { k: "wa_send_otp",         label: "OTP / Login Verification",  sub: "Customer receives",   def: "on" },
                  { k: "wa_send_order_update", label: "Order Status Updates",      sub: "Customer receives",   def: "on" },
                  { k: "wa_send_ride_update",  label: "Ride Status Updates",       sub: "Customer receives",   def: "on" },
                  { k: "wa_send_promo",        label: "Promotional Messages",      sub: "Marketing opt-in required", def: "off" },
                  { k: "wa_send_rider_notif",  label: "Rider Assignment Alerts",   sub: "Rider receives",      def: "on" },
                  { k: "wa_send_vendor_notif", label: "New Order to Vendor",       sub: "Vendor receives",     def: "on" },
                ].map(({ k, label, sub, def }) => (
                  <Toggle key={k} label={label} sub={sub} checked={tog(k, def)}
                    onChange={v => handleToggle(k, v)} isDirty={dirty(k)} />
                ))}
              </div>
            </div>
            {waConfigured && (
              <div>
                <SLabel icon={FlaskConical}>Test Connection</SLabel>
                <div className="mt-3">
                  <TestRow type="whatsapp" label="Send test OTP via WhatsApp (OTP: 123456)" />
                </div>
              </div>
            )}
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
                  <button key={p.id} type="button" onClick={() => handleChange("analytics_platform", p.id)}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${analyticsPlatform === p.id ? "border-purple-500 bg-purple-50" : "border-border hover:bg-muted/30"} ${dirty("analytics_platform") ? "ring-1 ring-amber-300" : ""}`}>
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
                {analyticsPlatform === "amplitude" && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex gap-2">
                    <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>Go to <span className="font-mono bg-white/70 px-1 rounded">amplitude.com</span> → Settings → Projects → select your project → API Key.</span>
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
                  { k: "track_order_placed",   label: "Order Placed",           sub: "With value & category", def: "on" },
                  { k: "track_ride_booked",    label: "Ride Booked",            sub: "With distance & fare", def: "on" },
                  { k: "track_user_signup",    label: "User Signup",            sub: "Registration funnel",  def: "on" },
                  { k: "track_wallet_topup",   label: "Wallet Top-Up",          sub: "Payment amounts",      def: "on" },
                  { k: "track_screen_views",   label: "Screen Views",           sub: "Page hit tracking",    def: "on" },
                  { k: "track_search_queries", label: "Search Queries",         sub: "What users search",    def: "off" },
                ].map(({ k, label, sub, def }) => (
                  <Toggle key={k} label={label} sub={sub} checked={tog(k, def)}
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
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-foreground">Environment</label>
                    {dirty("sentry_environment") && <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-700 border-amber-200 font-bold">CHANGED</Badge>}
                  </div>
                  <div className="flex gap-2 mt-1.5">
                    {["production","staging","development"].map(env => (
                      <button key={env} type="button" onClick={() => handleChange("sentry_environment", env)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all ${val("sentry_environment") === env ? "bg-red-600 text-white border-red-600" : "border-border hover:bg-muted/30"} ${dirty("sentry_environment") ? "ring-1 ring-amber-300" : ""}`}>
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
                  { k: "sentry_capture_api",     label: "API Server Errors",       sub: "Express 5xx errors",  def: "on" },
                  { k: "sentry_capture_admin",    label: "Admin Panel Errors",      sub: "React frontend",     def: "on" },
                  { k: "sentry_capture_vendor",   label: "Vendor App Errors",       sub: "React frontend",     def: "off" },
                  { k: "sentry_capture_rider",    label: "Rider App Errors",        sub: "React frontend",     def: "off" },
                  { k: "sentry_capture_unhandled",label: "Unhandled Rejections",    sub: "Promise failures",   def: "on" },
                  { k: "sentry_capture_perf",     label: "Performance Monitoring",  sub: "Slow API traces",    def: "on" },
                ].map(({ k, label, sub, def }) => (
                  <Toggle key={k} label={label} sub={sub} checked={tog(k, def)}
                    onChange={v => handleToggle(k, v)} isDirty={dirty(k)} />
                ))}
              </div>
            </div>
          </div>
        </IntCard>
      )}

      {/* ─── Maps ─── */}
      {intTab === "maps" && (
        <IntCard
          title="Maps Management"
          emoji="🗺️"
          description="Multi-provider map configuration, routing engine, fare settings, usage analytics & geocoding cache"
          enableKey="integration_maps"
          localValues={localValues}
          dirtyKeys={dirtyKeys}
          handleToggle={handleToggle}
          configured={mapsConfigured}
        >
          <div className="space-y-5">
            <MapsMgmtSection
              localValues={localValues}
              dirtyKeys={dirtyKeys}
              handleChange={handleChange}
              handleToggle={handleToggle}
            />
            {mapsEnabled && mapsConfigured && (
              <div>
                <SLabel icon={FlaskConical}>Test Geocoding</SLabel>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 p-3 bg-muted/30 rounded-xl border border-border/50 mt-3">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <FlaskConical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-xs font-semibold text-foreground">Geocode "Muzaffarabad, Azad Kashmir"</span>
                    {testResults["maps"] && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${testResults["maps"]!.ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {testResults["maps"]!.ok ? "✓ PASSED" : "✗ FAILED"}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => runTest("maps")}
                    disabled={!!testingMap["maps"]}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all focus-visible:ring-2 focus-visible:ring-primary focus:outline-none">
                    {testingMap["maps"] ? <Loader2 className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}
                    {testingMap["maps"] ? "Testing…" : "Test Geocoding"}
                  </button>
                  {testResults["maps"] && (
                    <p className="text-[10px] text-muted-foreground w-full sm:w-auto truncate max-w-xs" title={testResults["maps"]!.msg}>{testResults["maps"]!.msg}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </IntCard>
      )}
    </div>
  );
}
