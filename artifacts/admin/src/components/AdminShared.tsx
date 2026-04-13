import { useState } from "react";
import { AlertTriangle, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

/* ── SLabel — section heading used in settings ── */
export function SLabel({ children, icon: Icon }: { children: React.ReactNode; icon?: any }) {
  return (
    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
      {Icon && <Icon className="w-3.5 h-3.5" />} {children}
    </p>
  );
}

/* ── ModeBtn — pill-style toggle button for settings modes ── */
export function ModeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold border transition-all ${
        active ? "bg-primary text-white border-primary shadow-sm" : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/60"
      }`}
    >{children}</button>
  );
}

/* ── Toggle ── */
export function Toggle({ checked, onChange, label, icon, isDirty, danger, sub }: {
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

/* ── SecretInput ── */
export function SecretInput({ label, value, onChange, placeholder, isDirty }: {
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
        <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? "Hide secret" : "Show secret"} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm">
          {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

/* ── Field ── */
export function Field({ label, value, onChange, placeholder, isDirty, type = "text", suffix, mono, hint }: {
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

/* ── StatusBadge ── */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    live:             { label: "⚡ Live",         className: "bg-green-100 text-green-700 border-green-200" },
    scheduled:        { label: "🕐 Scheduled",    className: "bg-blue-100 text-blue-700 border-blue-200" },
    expired:          { label: "⏱ Expired",       className: "bg-gray-100 text-gray-600 border-gray-200" },
    sold_out:         { label: "✖ Sold Out",      className: "bg-red-100 text-red-600 border-red-200" },
    inactive:         { label: "○ Inactive",      className: "bg-gray-100 text-gray-500 border-gray-200" },
    active:           { label: "✓ Active",        className: "bg-green-100 text-green-700 border-green-200" },
    exhausted:        { label: "✖ Exhausted",     className: "bg-orange-100 text-orange-600 border-orange-200" },
    pending:          { label: "⏳ Pending",       className: "bg-amber-100 text-amber-700 border-amber-200" },
    confirmed:        { label: "✓ Confirmed",     className: "bg-blue-100 text-blue-700 border-blue-200" },
    preparing:        { label: "⚙ Preparing",    className: "bg-purple-100 text-purple-700 border-purple-200" },
    out_for_delivery: { label: "🚴 Delivering",   className: "bg-indigo-100 text-indigo-700 border-indigo-200" },
    delivered:        { label: "✅ Delivered",    className: "bg-green-100 text-green-700 border-green-200" },
    cancelled:        { label: "❌ Cancelled",    className: "bg-red-100 text-red-600 border-red-200" },
    completed:        { label: "✅ Completed",    className: "bg-green-100 text-green-700 border-green-200" },
    bargaining:       { label: "💬 Bargaining",   className: "bg-yellow-100 text-yellow-700 border-yellow-200" },
    searching:        { label: "🔍 Searching",    className: "bg-blue-100 text-blue-700 border-blue-200" },
    accepted:         { label: "✓ Accepted",      className: "bg-teal-100 text-teal-700 border-teal-200" },
    arrived:          { label: "📍 Arrived",      className: "bg-purple-100 text-purple-700 border-purple-200" },
    in_transit:       { label: "🚗 In Transit",   className: "bg-orange-100 text-orange-700 border-orange-200" },
  };
  const cfg = map[status] ?? { label: status, className: "bg-gray-100 text-gray-600 border-gray-200" };
  return <Badge variant="outline" className={`text-[10px] font-bold rounded-full px-2.5 py-0.5 uppercase tracking-wide border-0 ${cfg.className}`}>{cfg.label}</Badge>;
}

