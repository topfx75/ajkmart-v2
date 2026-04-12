import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AppWindow, Users, ShoppingBag, Car, Pill, Package,
  Wallet, Shield, Plus, Pencil, Trash2, Save, X,
  ToggleRight, ToggleLeft, RefreshCw, CheckCircle2,
  AlertTriangle, WrenchIcon, Eye, EyeOff, ScrollText, CalendarDays, ChevronLeft, ChevronRight,
  Zap, Activity, Download,
} from "lucide-react";
import { useLanguage } from "@/lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { useToast } from "@/hooks/use-toast";
import { fetcher } from "@/lib/api";
import { useAuditLog } from "@/hooks/use-admin";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ADMIN_SERVICE_LIST } from "@workspace/service-constants";

/* ── Types ── */
interface AdminAccount {
  id: string; name: string; role: string; permissions: string;
  isActive: boolean; lastLoginAt: string | null; createdAt: string;
}
interface AppOverview {
  users: { total: number; active: number; banned: number };
  orders: { total: number; pending: number };
  rides: { total: number; active: number };
  pharmacy: { total: number };
  parcel: { total: number };
  adminAccounts: number;
  appStatus: string;
  appName: string;
  features: Record<string, string>;
}

const ADMIN_ROLES = [
  { val: "super",    label: "Super Admin",    desc: "Full access to everything", color: "bg-red-100 text-red-700" },
  { val: "manager",  label: "Manager",         desc: "Orders, rides, users", color: "bg-blue-100 text-blue-700" },
  { val: "finance",  label: "Finance Admin",   desc: "Transactions & wallet", color: "bg-green-100 text-green-700" },
  { val: "support",  label: "Support Admin",   desc: "Users & broadcast only", color: "bg-amber-100 text-amber-700" },
];

const PERMISSIONS = ["users","orders","rides","pharmacy","parcel","products","transactions","settings","broadcast","flash-deals"];

const SERVICE_MAP = [
  ...ADMIN_SERVICE_LIST,
  { key: "wallet", label: "Wallet", description: "Digital wallet for payments & transfers", icon: "💰", setting: "feature_wallet", color: "#1A56DB", colorLight: "#E5EDFF" },
];

const EMPTY_ADMIN = { name: "", secret: "", role: "manager", permissions: PERMISSIONS.join(","), isActive: true };

/* ── Audit Log Tab Component ── */
function AuditLogTab() {
  const [page, setPage]     = useState(1);
  const [action, setAction] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");
  const { data, isLoading, refetch, isFetching } = useAuditLog({ page, action: action || undefined, from: dateFrom || undefined, to: dateTo || undefined });

  const logs: any[]  = data?.logs || [];
  const total: number = data?.total || 0;
  const pages: number = data?.pages || 1;

  const fd = (d: string) => new Date(d).toLocaleString("en-PK", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <Input placeholder="Filter by action..." value={action} onChange={e => { setAction(e.target.value); setPage(1); }} className="h-9 rounded-xl text-sm sm:w-56" />
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
          <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} className="h-9 rounded-xl text-xs w-32" />
          <span className="text-xs text-muted-foreground">–</span>
          <Input type="date" value={dateTo}   onChange={e => { setDateTo(e.target.value); setPage(1); }}   className="h-9 rounded-xl text-xs w-32" />
          {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-xs text-primary hover:underline">Clear</button>}
        </div>
        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={() => {
            const blob = new Blob([JSON.stringify(logs, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = `audit-log-${new Date().toISOString().slice(0,10)}.json`; a.click();
            URL.revokeObjectURL(url);
          }} disabled={logs.length === 0} className="h-9 rounded-xl gap-2">
            <Download className="w-4 h-4" /> Export
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-9 rounded-xl gap-2">
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <Card className="rounded-2xl border-border/50 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading audit log...</div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center">
            <ScrollText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">No audit log entries found</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {logs.map((log: any) => (
              <div key={log.id} className="flex items-start gap-4 p-4 hover:bg-muted/30">
                <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                  <Shield className="w-4 h-4 text-slate-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm">{log.adminName || "Unknown Admin"}</p>
                    <Badge variant="outline" className="text-[10px] font-mono bg-blue-50 text-blue-700 border-blue-200">{log.action}</Badge>
                    {log.targetId && <span className="text-xs text-muted-foreground font-mono">{log.targetId}</span>}
                  </div>
                  {log.details && <p className="text-xs text-muted-foreground mt-0.5 truncate">{typeof log.details === "string" ? log.details : JSON.stringify(log.details)}</p>}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{fd(log.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{total} entries · page {page} of {pages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="h-8 rounded-xl gap-1">
              <ChevronLeft className="w-3.5 h-3.5" /> Prev
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="h-8 rounded-xl gap-1">
              Next <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AppManagement() {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"overview"|"admins"|"maintenance"|"audit-log">("overview");
  const [adminForm, setAdminForm] = useState({ ...EMPTY_ADMIN });
  const [editingAdmin, setEditingAdmin] = useState<AdminAccount | null>(null);
  const [adminDialog, setAdminDialog] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [maintenanceMsg, setMaintenanceMsg] = useState("");
  const [savingMaintenance, setSavingMaintenance] = useState(false);

  /* ── Queries ── */
  const { data: overview, isLoading: overviewLoading, refetch: refetchOverview } = useQuery<AppOverview>({
    queryKey: ["admin-app-overview"],
    queryFn: () => fetcher("/app-overview"),
    refetchInterval: 30000,
  });

  const { data: adminsData, isLoading: adminsLoading, refetch: refetchAdmins } = useQuery({
    queryKey: ["admin-accounts"],
    queryFn: () => fetcher("/admin-accounts"),
  });

  const { data: settingsData } = useQuery({
    queryKey: ["admin-platform-settings"],
    queryFn: () => fetcher("/platform-settings"),
  });

  const admins: AdminAccount[] = adminsData?.accounts || [];
  const settings: any[] = settingsData?.settings || [];
  const appStatus = settings.find((s: any) => s.key === "app_status")?.value || "active";
  const maintenanceMsgSaved = settings.find((s: any) => s.key === "content_maintenance_msg")?.value || "";

  /* ── Admin Mutations ── */
  const saveAdmin = useMutation({
    mutationFn: async (body: any) => {
      if (editingAdmin) return fetcher(`/admin-accounts/${editingAdmin.id}`, { method: "PATCH", body: JSON.stringify(body) });
      return fetcher("/admin-accounts", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-accounts"] });
      qc.invalidateQueries({ queryKey: ["admin-app-overview"] });
      setAdminDialog(false); setEditingAdmin(null); setAdminForm({ ...EMPTY_ADMIN });
      toast({ title: editingAdmin ? "Admin updated ✅" : "Admin account created ✅" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteAdmin = useMutation({
    mutationFn: (id: string) => fetcher(`/admin-accounts/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-accounts"] }); toast({ title: "Admin removed" }); },
  });

  const toggleAdmin = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      fetcher(`/admin-accounts/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-accounts"] }),
  });

  /* ── Feature toggle ── */
  const toggleFeature = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) =>
      fetcher("/platform-settings", { method: "PUT", body: JSON.stringify({ settings: [{ key, value }] }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-platform-settings"] });
      qc.invalidateQueries({ queryKey: ["admin-app-overview"] });
    },
  });

  /* ── Maintenance mode ── */
  const handleMaintenanceSave = async () => {
    setSavingMaintenance(true);
    try {
      const newStatus = appStatus === "maintenance" ? "active" : "maintenance";
      await fetcher("/platform-settings", { method: "PUT", body: JSON.stringify({ settings: [{ key: "app_status", value: newStatus }] }) });
      qc.invalidateQueries({ queryKey: ["admin-platform-settings"] });
      qc.invalidateQueries({ queryKey: ["admin-app-overview"] });
      toast({ title: newStatus === "maintenance" ? "🔧 Maintenance mode ON" : "✅ App is now Live", description: newStatus === "maintenance" ? "Users will see the maintenance screen." : "App is back to normal." });
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    setSavingMaintenance(false);
  };

  /* ── Form handlers ── */
  const openNewAdmin = () => {
    setEditingAdmin(null); setAdminForm({ ...EMPTY_ADMIN }); setShowSecret(false); setAdminDialog(true);
  };
  const openEditAdmin = (a: AdminAccount) => {
    setEditingAdmin(a);
    setAdminForm({ name: a.name, secret: "", role: a.role, permissions: a.permissions, isActive: a.isActive });
    setShowSecret(false); setAdminDialog(true);
  };
  const togglePermission = (p: string) => {
    const perms = adminForm.permissions.split(",").filter(Boolean);
    const next = perms.includes(p) ? perms.filter(x => x !== p) : [...perms, p];
    setAdminForm(f => ({ ...f, permissions: next.join(",") }));
  };

  const submitAdmin = () => {
    if (!adminForm.name) { toast({ title: "Name required", variant: "destructive" }); return; }
    if (!editingAdmin && !adminForm.secret) { toast({ title: "Secret required", variant: "destructive" }); return; }
    const body: any = { name: adminForm.name, role: adminForm.role, permissions: adminForm.permissions, isActive: adminForm.isActive };
    if (adminForm.secret) body.secret = adminForm.secret;
    saveAdmin.mutate(body);
  };

  const roleCfg = (role: string) => ADMIN_ROLES.find(r => r.val === role) || ADMIN_ROLES[1]!;

  /* ── Stat Card ── */
  function StatCard({ icon: Icon, label, value, sub, color }: any) {
    return (
      <div className="bg-white rounded-2xl border border-border/50 p-4 shadow-sm">
        <div className="flex items-start justify-between">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}><Icon className="w-5 h-5"/></div>
        </div>
        <p className="text-2xl font-display font-bold mt-3">{value}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
        {sub && <p className="text-xs text-muted-foreground/70 mt-0.5">{sub}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-slate-100 text-slate-600 rounded-xl flex items-center justify-center">
            <AppWindow className="w-6 h-6"/>
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold">App Management</h1>
            <p className="text-sm text-muted-foreground">Control the entire app — status, admins, services</p>
          </div>
        </div>
        <div className="flex gap-2">
          {tab === "admins" && (
            <Button onClick={openNewAdmin} className="h-10 rounded-xl gap-2">
              <Plus className="w-4 h-4"/> New Admin
            </Button>
          )}
          <Button variant="outline" onClick={() => { refetchOverview(); refetchAdmins(); }} className="h-10 rounded-xl gap-2">
            <RefreshCw className="w-4 h-4"/> Refresh
          </Button>
        </div>
      </div>

      {/* App Status Banner */}
      {appStatus === "maintenance" && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl px-5 py-4 flex items-center gap-3">
          <WrenchIcon className="w-6 h-6 text-amber-600 flex-shrink-0"/>
          <div className="flex-1">
            <p className="font-bold text-amber-800">🔧 Maintenance Mode is ON</p>
            <p className="text-sm text-amber-700">The app is currently in maintenance — users cannot access it.</p>
          </div>
          <Button size="sm" onClick={handleMaintenanceSave} className="bg-green-600 hover:bg-green-700 rounded-xl text-xs">Go Live</Button>
        </div>
      )}

      {/* Tabs — scrollable on mobile */}
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="flex gap-1 bg-muted p-1 rounded-xl w-max min-w-full">
          {[
            { id: "overview",    label: "📊 Overview" },
            { id: "admins",      label: "👥 Admin Accounts" },
            { id: "maintenance", label: "🔧 Services & Maintenance" },
            { id: "audit-log",   label: "📋 Audit Log" },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as any)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap flex-shrink-0 ${tab === t.id ? "bg-white shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ══ Overview Tab ══ */}
      {tab === "overview" && (
        <div className="space-y-5">
          {overviewLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">{[1,2,3,4,5,6].map(i=><div key={i} className="h-28 bg-muted rounded-2xl animate-pulse"/>)}</div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                <StatCard icon={Users}     label="Total Users"    value={overview?.users.total ?? 0}    sub={`${overview?.users.active} active · ${overview?.users.banned} banned`}  color="bg-blue-100 text-blue-600"/>
                <StatCard icon={ShoppingBag} label="Total Orders" value={overview?.orders.total ?? 0}  sub={`${overview?.orders.pending} pending`}  color="bg-indigo-100 text-indigo-600"/>
                <StatCard icon={Car}       label="Total Rides"    value={overview?.rides.total ?? 0}    sub={`${overview?.rides.active} active now`} color="bg-green-100 text-green-600"/>
                <StatCard icon={Pill}      label="Pharmacy Orders" value={overview?.pharmacy.total ?? 0} sub="all time"                               color="bg-pink-100 text-pink-600"/>
                <StatCard icon={Package}   label="Parcel Bookings" value={overview?.parcel.total ?? 0}  sub="all time"                               color="bg-orange-100 text-orange-600"/>
                <StatCard icon={Shield}    label="Admin Accounts"  value={overview?.adminAccounts ?? 0} sub="active sub-admins"                      color="bg-violet-100 text-violet-600"/>
              </div>

              {/* Feature status grid */}
              <Card className="rounded-2xl border-border/50">
                <div className="p-5 border-b border-border/50 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center"><Activity className="w-5 h-5 text-emerald-600"/></div>
                  <div>
                    <h2 className="font-bold">Service Status</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Live status of all app services</p>
                  </div>
                </div>
                <CardContent className="p-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {SERVICE_MAP.map(svc => {
                      const featureVal = settings.find((s: any) => s.key === svc.setting)?.value || "on";
                      const isOn = featureVal === "on";
                      return (
                        <div key={svc.key} className={`relative overflow-hidden rounded-xl border p-4 transition-all ${isOn ? "bg-gradient-to-br from-green-50 to-emerald-50 border-green-200" : "bg-gradient-to-br from-red-50 to-rose-50 border-red-200"}`}>
                          <div className="flex items-start gap-3">
                            <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0 ${isOn ? "bg-green-100" : "bg-red-100"}`}>
                              {svc.icon}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold truncate">{svc.label}</p>
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{svc.description}</p>
                              <div className="flex items-center gap-1.5 mt-2">
                                <span className={`w-2 h-2 rounded-full ${isOn ? "bg-green-500 animate-pulse" : "bg-red-400"}`}/>
                                <span className={`text-xs font-bold ${isOn ? "text-green-600" : "text-red-500"}`}>{isOn ? "Online" : "Offline"}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {/* ══ Admin Accounts Tab ══ */}
      {tab === "admins" && (
        <div className="space-y-4">
          {/* Master Admin info */}
          <Card className="rounded-2xl border-red-200 bg-red-50/50">
            <CardContent className="p-4 flex items-start gap-3">
              <Shield className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5"/>
              <div>
                <p className="font-bold text-red-800">Super Admin (Master)</p>
                <p className="text-sm text-red-700">Secret stored in env var <code className="bg-red-100 px-1 rounded">ADMIN_SECRET</code>. Full access to all features. Cannot be managed here.</p>
              </div>
            </CardContent>
          </Card>

          {adminsLoading ? (
            <div className="space-y-3">{[1,2].map(i=><div key={i} className="h-20 bg-muted rounded-2xl animate-pulse"/>)}</div>
          ) : admins.length === 0 ? (
            <Card className="rounded-2xl border-border/50">
              <CardContent className="p-12 text-center">
                <Users className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3"/>
                <p className="font-medium text-muted-foreground">No sub-admin accounts yet</p>
                <p className="text-sm text-muted-foreground/60 mt-1">Create accounts for managers, support, finance staff</p>
                <Button onClick={openNewAdmin} className="mt-4 rounded-xl gap-2"><Plus className="w-4 h-4"/>Add Admin Account</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {admins.map(a => {
                const cfg = roleCfg(a.role);
                return (
                  <Card key={a.id} className="rounded-2xl border-border/50 shadow-sm">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center font-bold text-slate-600 flex-shrink-0">
                          {a.name[0]?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold text-foreground">{a.name}</p>
                            <Badge variant="outline" className={`text-xs ${cfg.color}`}>{cfg.label}</Badge>
                            {!a.isActive && <Badge variant="outline" className="text-xs bg-gray-100 text-gray-500">Inactive</Badge>}
                          </div>
                          <div className="flex gap-3 mt-1 flex-wrap">
                            <p className="text-xs text-muted-foreground">Permissions: {a.permissions ? a.permissions.split(",").slice(0,4).join(", ") + (a.permissions.split(",").length > 4 ? `... +${a.permissions.split(",").length - 4} more` : "") : "all"}</p>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Last login: {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString("en-PK", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => toggleAdmin.mutate({ id: a.id, isActive: !a.isActive })} className="p-2 hover:bg-muted rounded-lg">
                            {a.isActive ? <ToggleRight className="w-5 h-5 text-green-600"/> : <ToggleLeft className="w-5 h-5 text-muted-foreground"/>}
                          </button>
                          <button onClick={() => openEditAdmin(a)} className="p-2 hover:bg-muted rounded-lg">
                            <Pencil className="w-4 h-4 text-blue-600"/>
                          </button>
                          <button onClick={() => deleteAdmin.mutate(a.id)} className="p-2 hover:bg-red-50 rounded-lg">
                            <Trash2 className="w-4 h-4 text-red-500"/>
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══ Services & Maintenance Tab ══ */}
      {tab === "maintenance" && (
        <div className="space-y-5">
          {/* Maintenance Mode */}
          <Card className="rounded-2xl border-border/50 shadow-sm">
            <div className="p-5 border-b border-border/50 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center"><WrenchIcon className="w-5 h-5 text-amber-600"/></div>
              <h2 className="font-bold">Maintenance Mode</h2>
            </div>
            <CardContent className="p-5 space-y-4">
              <div className={`flex items-center justify-between p-4 rounded-xl border ${appStatus === "maintenance" ? "bg-amber-50 border-amber-300" : "bg-green-50 border-green-200"}`}>
                <div className="flex items-center gap-3">
                  {appStatus === "maintenance"
                    ? <WrenchIcon className="w-6 h-6 text-amber-600"/>
                    : <CheckCircle2 className="w-6 h-6 text-green-600"/>}
                  <div>
                    <p className="font-bold">{appStatus === "maintenance" ? "🔧 App is in Maintenance" : "✅ App is Live"}</p>
                    <p className="text-sm text-muted-foreground">{appStatus === "maintenance" ? "Users see the maintenance screen and cannot use the app." : "All services are running normally."}</p>
                  </div>
                </div>
                <Button
                  onClick={handleMaintenanceSave}
                  disabled={savingMaintenance}
                  className={`rounded-xl ${appStatus === "maintenance" ? "bg-green-600 hover:bg-green-700" : "bg-amber-500 hover:bg-amber-600"}`}
                >
                  {savingMaintenance ? "..." : appStatus === "maintenance" ? "Go Live" : "Enable Maintenance"}
                </Button>
              </div>
              {appStatus === "maintenance" && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5"/>
                  <p className="text-sm text-amber-700">While in maintenance mode, only admin panel is accessible. Mobile app shows a maintenance screen.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Service Toggles */}
          <Card className="rounded-2xl border-border/50 shadow-sm">
            <div className="p-5 border-b border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center"><Zap className="w-5 h-5 text-blue-600"/></div>
                <div>
                  <h2 className="font-bold">Live Service Control</h2>
                  <p className="text-xs text-muted-foreground">Toggle services on/off instantly — changes apply immediately</p>
                </div>
              </div>
              <Badge variant="outline" className="text-xs">
                {SERVICE_MAP.filter(svc => (settings.find((s: any) => s.key === svc.setting)?.value || "on") === "on").length}/{SERVICE_MAP.length} Active
              </Badge>
            </div>
            <CardContent className="p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {SERVICE_MAP.map(svc => {
                  const featureVal = settings.find((s: any) => s.key === svc.setting)?.value || "on";
                  const isOn = featureVal === "on";
                  return (
                    <div
                      key={svc.key}
                      className={`group relative overflow-hidden rounded-2xl border-2 transition-all duration-200 ${isOn ? "border-green-200 bg-white hover:border-green-300 hover:shadow-md" : "border-gray-200 bg-gray-50/50 hover:border-gray-300"}`}
                    >
                      <div className={`absolute inset-x-0 top-0 h-1 transition-colors ${isOn ? "bg-green-500" : "bg-gray-300"}`}/>
                      <div className="p-5">
                        <div className="flex items-start gap-4">
                          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 transition-all ${isOn ? "bg-gradient-to-br from-green-50 to-emerald-100 shadow-sm" : "bg-gray-100"}`}>
                            {svc.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-bold text-sm">{svc.label}</p>
                              <Badge className={`text-[10px] px-1.5 py-0 h-4 ${isOn ? "bg-green-100 text-green-700 border-green-200" : "bg-red-100 text-red-600 border-red-200"}`} variant="outline">
                                {isOn ? "Live" : "Off"}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">{svc.description}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${isOn ? "bg-green-500 animate-pulse" : "bg-gray-400"}`}/>
                            <span className={`text-xs font-semibold ${isOn ? "text-green-600" : "text-gray-500"}`}>
                              {isOn ? "Running" : "Stopped"}
                            </span>
                          </div>
                          <button
                            onClick={() => toggleFeature.mutate({ key: svc.setting, value: isOn ? "off" : "on" })}
                            className={`relative w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 ${isOn ? "bg-green-500 focus:ring-green-300" : "bg-gray-300 focus:ring-gray-300"}`}
                          >
                            <span className={`absolute w-5 h-5 bg-white rounded-full shadow-md top-0.5 transition-transform duration-200 ${isOn ? "translate-x-6" : "translate-x-0.5"}`}/>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ══ Admin Account Dialog ══ */}
      <Dialog open={adminDialog} onOpenChange={v => { setAdminDialog(v); if (!v) { setEditingAdmin(null); setAdminForm({ ...EMPTY_ADMIN }); } }}>
        <DialogContent className="w-[95vw] max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600"/>
              {editingAdmin ? "Edit Admin Account" : "Create Admin Account"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {/* Name */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Full Name <span className="text-red-500">*</span></label>
              <Input placeholder="e.g. Ahmed Khan" value={adminForm.name} onChange={e => setAdminForm(f=>({...f, name: e.target.value}))} className="h-11 rounded-xl"/>
            </div>

            {/* Secret */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">
                Admin Secret {!editingAdmin && <span className="text-red-500">*</span>}
                {editingAdmin && <span className="text-xs font-normal text-muted-foreground ml-1">(leave blank to keep current)</span>}
              </label>
              <div className="relative">
                <Input
                  type={showSecret ? "text" : "password"}
                  placeholder="Create a strong secret key"
                  value={adminForm.secret}
                  onChange={e => setAdminForm(f=>({...f, secret: e.target.value}))}
                  className="h-11 rounded-xl pr-10 font-mono"
                />
                <button onClick={() => setShowSecret(!showSecret)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showSecret ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">This secret is used to log in to the admin panel. Keep it secure.</p>
            </div>

            {/* Role */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Role</label>
              <div className="grid grid-cols-2 gap-2">
                {ADMIN_ROLES.filter(r => r.val !== "super").map(r => (
                  <div
                    key={r.val}
                    onClick={() => setAdminForm(f=>({...f, role: r.val}))}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${adminForm.role === r.val ? "border-blue-400 bg-blue-50" : "border-border hover:border-blue-200 bg-muted/30"}`}
                  >
                    <Badge variant="outline" className={`text-xs mb-1.5 ${r.color}`}>{r.label}</Badge>
                    <p className="text-xs text-muted-foreground">{r.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Permissions */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Page Access</label>
              <div className="flex flex-wrap gap-2">
                {PERMISSIONS.map(p => {
                  const active = adminForm.permissions.split(",").includes(p);
                  return (
                    <button
                      key={p}
                      onClick={() => togglePermission(p)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all capitalize ${active ? "bg-blue-600 text-white border-blue-600" : "bg-muted border-border text-muted-foreground hover:border-blue-300"}`}
                    >
                      {p.replace("-", " ")}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Active toggle */}
            <div
              onClick={() => setAdminForm(f=>({...f, isActive: !f.isActive}))}
              className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer ${adminForm.isActive ? "bg-green-50 border-green-200" : "bg-gray-50 border-gray-200"}`}
            >
              <span className="text-sm font-semibold">Account Active</span>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${adminForm.isActive ? "bg-green-500" : "bg-gray-300"}`}>
                <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 shadow transition-transform ${adminForm.isActive ? "translate-x-5" : "translate-x-0.5"}`}/>
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setAdminDialog(false)}>Cancel</Button>
              <Button onClick={submitAdmin} disabled={saveAdmin.isPending} className="flex-1 rounded-xl gap-2">
                <Save className="w-4 h-4"/>
                {saveAdmin.isPending ? "Saving..." : (editingAdmin ? "Update" : "Create Admin")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ══ Audit Log Tab ══ */}
      {tab === "audit-log" && <AuditLogTab />}
    </div>
  );
}
