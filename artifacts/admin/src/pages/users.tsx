import { useState } from "react";
import {
  Search, CheckCircle2, XCircle, Wallet, RefreshCw, Trash2,
  Activity, ShoppingBag, Car, Pill, Package, Shield, UserCog,
  Ban, KeyRound, Save, AlertTriangle, MapPin, CreditCard, Truck, Building2,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUsers, useUpdateUser, useWalletTopup, useDeleteUser, useUserActivity } from "@/hooks/use-admin";
import { fetcher } from "@/lib/api";
import { formatCurrency, formatDate, getStatusColor } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/* ── Activity Modal ── */
function UserActivityModal({ userId, userName, user: userData, onClose }: { userId: string; userName: string; user: any; onClose: () => void }) {
  const { data, isLoading } = useUserActivity(userId);
  const userRoles = (userData.roles || userData.role || "customer").split(",").filter(Boolean);
  const isRider  = userRoles.includes("rider");
  const isVendor = userRoles.includes("vendor");

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-2xl max-h-[85dvh] overflow-y-auto rounded-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" /> Activity — {userName}
          </DialogTitle>
        </DialogHeader>

        {/* Profile Info Section */}
        <div className="bg-muted/40 rounded-2xl p-3 space-y-2 border border-border/50">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Profile Details</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {userData.email && (
              <div className="flex items-center gap-2 col-span-2">
                <span className="text-muted-foreground">✉</span>
                <span className="text-foreground">{userData.email}</span>
              </div>
            )}
            {userData.cnic && (
              <div className="flex items-center gap-2">
                <CreditCard className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                <span className="text-muted-foreground text-xs">CNIC:</span>
                <span className="font-mono text-xs font-semibold">{userData.cnic}</span>
              </div>
            )}
            {userData.city && (
              <div className="flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                <span className="text-muted-foreground text-xs">City:</span>
                <span className="font-semibold text-xs">{userData.city}</span>
              </div>
            )}
            {userData.address && (
              <div className="flex items-center gap-2 col-span-2">
                <MapPin className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                <span className="text-xs text-muted-foreground truncate">{userData.address}</span>
              </div>
            )}
            {isRider && userData.vehicleType && (
              <div className="flex items-center gap-2">
                <Truck className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                <span className="text-muted-foreground text-xs">Vehicle:</span>
                <span className="font-semibold text-xs capitalize">{userData.vehicleType}</span>
              </div>
            )}
            {isRider && userData.vehiclePlate && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-bold bg-green-100 text-green-800 px-2 py-0.5 rounded">{userData.vehiclePlate}</span>
              </div>
            )}
            {isRider && userData.emergencyContact && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">Emergency:</span>
                <span className="text-xs font-semibold">{userData.emergencyContact}</span>
              </div>
            )}
            {isVendor && userData.businessType && (
              <div className="flex items-center gap-2">
                <Building2 className="w-3.5 h-3.5 text-orange-600 flex-shrink-0" />
                <span className="text-muted-foreground text-xs">Business:</span>
                <span className="font-semibold text-xs capitalize">{userData.businessType}</span>
              </div>
            )}
            {(isRider || isVendor) && userData.bankName && (
              <div className="flex items-center gap-2 col-span-2 bg-sky-50 border border-sky-200 rounded-xl px-2 py-1.5">
                <span className="text-xs font-bold text-sky-700">Bank:</span>
                <span className="text-xs text-sky-800">{userData.bankName}</span>
                {userData.bankAccountTitle && <span className="text-xs text-muted-foreground">· {userData.bankAccountTitle}</span>}
                {userData.bankAccount && <span className="font-mono text-xs font-bold text-sky-900">{userData.bankAccount}</span>}
              </div>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="h-40 flex items-center justify-center text-muted-foreground">Loading...</div>
        ) : (
          <div className="space-y-5 mt-2">
            <div>
              <h3 className="text-sm font-bold flex items-center gap-2 mb-2"><ShoppingBag className="w-4 h-4 text-indigo-600" /> Recent Orders ({data?.orders?.length || 0})</h3>
              {data?.orders?.length === 0 ? <p className="text-xs text-muted-foreground">No orders yet.</p> : (
                <div className="space-y-2">
                  {data?.orders?.map((o: any) => (
                    <div key={o.id} className="flex justify-between items-center text-sm bg-muted/30 rounded-xl px-3 py-2">
                      <div><span className="font-mono font-bold text-xs">{o.id.slice(-6).toUpperCase()}</span><span className="ml-2 text-muted-foreground capitalize">{o.type}</span></div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getStatusColor(o.status)}`}>{o.status.replace('_',' ')}</span>
                        <span className="font-bold">{formatCurrency(o.total)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold flex items-center gap-2 mb-2"><Car className="w-4 h-4 text-green-600" /> Recent Rides ({data?.rides?.length || 0})</h3>
              {data?.rides?.length === 0 ? <p className="text-xs text-muted-foreground">No rides yet.</p> : (
                <div className="space-y-2">
                  {data?.rides?.map((r: any) => (
                    <div key={r.id} className="flex justify-between items-center text-sm bg-muted/30 rounded-xl px-3 py-2">
                      <div><span className="font-mono font-bold text-xs">{r.id.slice(-6).toUpperCase()}</span><span className="ml-2 text-muted-foreground capitalize">{r.type}</span><span className="ml-2 text-muted-foreground">{r.distance}km</span></div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getStatusColor(r.status)}`}>{r.status.replace('_',' ')}</span>
                        <span className="font-bold">{formatCurrency(r.fare)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {(data?.pharmacy?.length || 0) > 0 && (
              <div>
                <h3 className="text-sm font-bold flex items-center gap-2 mb-2"><Pill className="w-4 h-4 text-pink-600" /> Pharmacy Orders ({data.pharmacy.length})</h3>
                <div className="space-y-2">
                  {data.pharmacy.map((p: any) => (
                    <div key={p.id} className="flex justify-between text-sm bg-muted/30 rounded-xl px-3 py-2">
                      <span className="font-mono text-xs">{p.id.slice(-6).toUpperCase()}</span>
                      <div className="flex gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getStatusColor(p.status)}`}>{p.status}</span>
                        <span className="font-bold">{formatCurrency(p.total)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(data?.parcels?.length || 0) > 0 && (
              <div>
                <h3 className="text-sm font-bold flex items-center gap-2 mb-2"><Package className="w-4 h-4 text-orange-600" /> Parcel Bookings ({data.parcels.length})</h3>
                <div className="space-y-2">
                  {data.parcels.map((p: any) => (
                    <div key={p.id} className="flex justify-between text-sm bg-muted/30 rounded-xl px-3 py-2">
                      <span className="font-mono text-xs">{p.id.slice(-6).toUpperCase()}</span>
                      <div className="flex gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getStatusColor(p.status)}`}>{p.status}</span>
                        <span className="font-bold">{formatCurrency(p.fare)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <h3 className="text-sm font-bold flex items-center gap-2 mb-2"><Wallet className="w-4 h-4 text-sky-600" /> Wallet History ({data?.transactions?.length || 0})</h3>
              {data?.transactions?.length === 0 ? <p className="text-xs text-muted-foreground">No wallet activity.</p> : (
                <div className="space-y-1.5">
                  {data?.transactions?.map((t: any) => (
                    <div key={t.id} className="flex justify-between items-center text-sm bg-muted/30 rounded-xl px-3 py-2">
                      <span className="text-muted-foreground truncate max-w-[180px]">{t.description}</span>
                      <span className={`font-bold ${t.type === 'credit' ? 'text-green-600' : 'text-red-600'}`}>{t.type === 'credit' ? '+' : '-'}{formatCurrency(t.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Security Modal ── */
const ALL_SERVICES = [
  { key: "mart",     label: "🛒 Mart",      color: "blue" },
  { key: "food",     label: "🍔 Food",      color: "orange" },
  { key: "rides",    label: "🚗 Rides",     color: "green" },
  { key: "pharmacy", label: "💊 Pharmacy",  color: "pink" },
  { key: "parcel",   label: "📦 Parcel",    color: "amber" },
];
const ALL_ROLES = [
  { key: "customer", label: "👤 Customer", desc: "Can place orders, book rides" },
  { key: "rider",    label: "🚴 Rider",    desc: "Can accept & deliver orders" },
  { key: "vendor",   label: "🏪 Vendor",   desc: "Can manage a store/menu" },
];

function SecurityModal({ user, onClose }: { user: any; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const userRoles  = (user.roles || user.role || "customer").split(",").map((r: string) => r.trim()).filter(Boolean);
  const blockedSvc = (user.blockedServices || "").split(",").map((s: string) => s.trim()).filter(Boolean);

  const [roles,           setRoles]           = useState<string[]>(userRoles);
  const [isActive,        setIsActive]        = useState<boolean>(user.isActive);
  const [isBanned,        setIsBanned]        = useState<boolean>(user.isBanned || false);
  const [banReason,       setBanReason]       = useState<string>(user.banReason || "");
  const [blockedServices, setBlockedServices] = useState<string[]>(blockedSvc);
  const [securityNote,    setSecurityNote]    = useState<string>(user.securityNote || "");

  const securityMutation = useMutation({
    mutationFn: (body: any) => fetcher(`/users/${user.id}/security`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: "Security settings saved ✅" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const resetOtpMutation = useMutation({
    mutationFn: () => fetcher(`/users/${user.id}/reset-otp`, { method: "POST", body: "{}" }),
    onSuccess: () => toast({ title: "OTP cleared ✅", description: "User must re-authenticate on next login." }),
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const toggleRole = (r: string) => {
    setRoles(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
  };
  const toggleService = (s: string) => {
    setBlockedServices(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const handleSave = () => {
    const primaryRole = roles.includes("vendor") ? "vendor" : roles.includes("rider") ? "rider" : "customer";
    securityMutation.mutate({
      isActive,
      isBanned,
      banReason: isBanned ? banReason : null,
      roles: roles.join(",") || "customer",
      role: primaryRole,
      blockedServices: blockedServices.join(","),
      securityNote,
      notify: isBanned && !user.isBanned,
    });
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            Security — {user.name || user.phone}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* User info strip */}
          <div className="bg-muted/50 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
              {(user.name || "U")[0].toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-sm">{user.name || "Unknown"}</p>
              <p className="text-xs text-muted-foreground">{user.phone} · Wallet: <strong>{formatCurrency(user.walletBalance)}</strong></p>
            </div>
          </div>

          {/* ─ Account Status ─ */}
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2"><UserCog className="w-4 h-4"/> Account Status</h3>
            <div className="grid grid-cols-2 gap-2">
              <div
                onClick={() => { setIsActive(true); setIsBanned(false); }}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${isActive && !isBanned ? "bg-green-50 border-green-400" : "bg-muted/30 border-border hover:border-green-300"}`}
              >
                <CheckCircle2 className={`w-5 h-5 mb-1 ${isActive && !isBanned ? "text-green-600" : "text-muted-foreground"}`}/>
                <p className="text-sm font-bold">Active</p>
                <p className="text-xs text-muted-foreground">Full access</p>
              </div>
              <div
                onClick={() => { setIsActive(false); setIsBanned(false); }}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${!isActive && !isBanned ? "bg-amber-50 border-amber-400" : "bg-muted/30 border-border hover:border-amber-300"}`}
              >
                <XCircle className={`w-5 h-5 mb-1 ${!isActive && !isBanned ? "text-amber-600" : "text-muted-foreground"}`}/>
                <p className="text-sm font-bold">Blocked</p>
                <p className="text-xs text-muted-foreground">Temp suspend</p>
              </div>
              <div
                onClick={() => { setIsBanned(true); setIsActive(false); }}
                className={`p-3 rounded-xl border cursor-pointer transition-all col-span-2 ${isBanned ? "bg-red-50 border-red-400" : "bg-muted/30 border-border hover:border-red-300"}`}
              >
                <div className="flex items-center gap-2">
                  <Ban className={`w-5 h-5 ${isBanned ? "text-red-600" : "text-muted-foreground"}`}/>
                  <div>
                    <p className="text-sm font-bold">Permanently Banned</p>
                    <p className="text-xs text-muted-foreground">Cannot log in at all — requires ban reason</p>
                  </div>
                </div>
              </div>
            </div>
            {isBanned && (
              <Input
                placeholder="Ban reason (required — shown to user)"
                value={banReason}
                onChange={e => setBanReason(e.target.value)}
                className="h-11 rounded-xl border-red-200"
              />
            )}
          </div>

          {/* ─ Role Management ─ */}
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-foreground">Roles <span className="text-xs font-normal text-muted-foreground ml-1">Multiple roles allowed</span></h3>
            <div className="space-y-2">
              {ALL_ROLES.map(r => (
                <div
                  key={r.key}
                  onClick={() => toggleRole(r.key)}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${roles.includes(r.key) ? "bg-blue-50 border-blue-300" : "bg-muted/30 border-border hover:border-blue-200"}`}
                >
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${roles.includes(r.key) ? "bg-blue-600 border-blue-600" : "border-gray-300"}`}>
                    {roles.includes(r.key) && <span className="text-white text-xs font-bold">✓</span>}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{r.label}</p>
                    <p className="text-xs text-muted-foreground">{r.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ─ Service Restrictions ─ */}
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              Service Restrictions
              <span className="text-xs font-normal text-muted-foreground">Checked = blocked for this user</span>
            </h3>
            <div className="grid grid-cols-1 gap-2">
              {ALL_SERVICES.map(s => {
                const isBlocked = blockedServices.includes(s.key);
                return (
                  <div
                    key={s.key}
                    onClick={() => toggleService(s.key)}
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${isBlocked ? "bg-red-50 border-red-300" : "bg-muted/30 border-border hover:border-red-200"}`}
                  >
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${isBlocked ? "bg-red-500 border-red-500" : "border-gray-300"}`}>
                      {isBlocked && <span className="text-white text-xs font-bold">✕</span>}
                    </div>
                    <span className="text-sm font-semibold">{s.label}</span>
                    {isBlocked && <Badge variant="outline" className="ml-auto text-[10px] bg-red-50 text-red-600 border-red-200">BLOCKED</Badge>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ─ Security Note ─ */}
          <div className="space-y-1.5">
            <h3 className="text-sm font-bold text-foreground">Admin Security Note <span className="text-xs font-normal text-muted-foreground">(internal)</span></h3>
            <textarea
              rows={3}
              placeholder="e.g. Suspected fraud — monitor activity. Or: VIP user — do not block."
              value={securityNote}
              onChange={e => setSecurityNote(e.target.value)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* ─ Reset OTP ─ */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-3">
            <KeyRound className="w-5 h-5 text-amber-600 flex-shrink-0"/>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800">Force Re-Authentication</p>
              <p className="text-xs text-amber-700">Clears saved OTP — user must verify phone again</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-300 text-amber-700 hover:bg-amber-100 rounded-lg text-xs"
              onClick={() => resetOtpMutation.mutate()}
              disabled={resetOtpMutation.isPending}
            >
              {resetOtpMutation.isPending ? "Clearing..." : "Reset OTP"}
            </Button>
          </div>

          {/* Warning for ban */}
          {isBanned && !user.isBanned && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5"/>
              <p className="text-xs text-red-700">User will be permanently banned and notified via push notification.</p>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={securityMutation.isPending || (isBanned && !banReason)}
              className="flex-1 rounded-xl gap-2"
            >
              <Save className="w-4 h-4"/>
              {securityMutation.isPending ? "Saving..." : "Save Security"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════ Main Users Page ══════════ */
export default function Users() {
  const { data, isLoading, refetch, isFetching } = useUsers();
  const updateMutation = useUpdateUser();
  const topupMutation = useWalletTopup();
  const deleteMutation = useDeleteUser();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [topupUser, setTopupUser] = useState<any>(null);
  const [topupAmount, setTopupAmount] = useState("");
  const [topupNote, setTopupNote] = useState("");
  const [deleteUser, setDeleteUser] = useState<any>(null);
  const [activityUser, setActivityUser] = useState<any>(null);
  const [securityUser, setSecurityUser] = useState<any>(null);

  const handleUpdate = (id: string, updates: any) => {
    updateMutation.mutate({ id, ...updates }, {
      onSuccess: () => toast({ title: "User updated" }),
      onError: err => toast({ title: "Update failed", description: err.message, variant: "destructive" })
    });
  };

  const handleTopup = () => {
    const amt = Number(topupAmount);
    if (!amt || amt <= 0) { toast({ title: "Enter a valid amount", variant: "destructive" }); return; }
    topupMutation.mutate(
      { id: topupUser.id, amount: amt, description: topupNote || `Admin top-up: Rs. ${amt}` },
      {
        onSuccess: (d: any) => {
          toast({ title: "Wallet Topped Up! 💰", description: `Rs. ${amt} added. New balance: ${formatCurrency(d.newBalance)}` });
          setTopupUser(null); setTopupAmount(""); setTopupNote("");
        },
        onError: err => toast({ title: "Top-up failed", description: err.message, variant: "destructive" })
      }
    );
  };

  const handleDelete = () => {
    if (!deleteUser) return;
    deleteMutation.mutate(deleteUser.id, {
      onSuccess: () => { toast({ title: "User deleted" }); setDeleteUser(null); },
      onError: err => toast({ title: "Delete failed", description: err.message, variant: "destructive" })
    });
  };

  const users = data?.users || [];
  const filtered = users.filter((u: any) => {
    const matchSearch =
      (u.name?.toLowerCase() || "").includes(search.toLowerCase()) ||
      (u.phone || "").includes(search);
    const matchRole = roleFilter === "all" || u.role === roleFilter || (u.roles || "").includes(roleFilter);
    const matchStatus = statusFilter === "all"
      || (statusFilter === "active"   && u.isActive && !u.isBanned)
      || (statusFilter === "blocked"  && !u.isActive && !u.isBanned)
      || (statusFilter === "banned"   && u.isBanned);
    return matchSearch && matchRole && matchStatus;
  });

  const bannedCount  = users.filter((u: any) => u.isBanned).length;
  const blockedCount = users.filter((u: any) => !u.isActive && !u.isBanned).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Users</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {users.length} total · {bannedCount > 0 && <span className="text-red-600 font-semibold">{bannedCount} banned · </span>}
            {blockedCount > 0 && <span className="text-amber-600 font-semibold">{blockedCount} blocked</span>}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-9 rounded-xl gap-2">
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card className="p-4 rounded-2xl border-border/50 shadow-sm flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by name or phone..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-11 rounded-xl bg-muted/30 border-border/50" />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-11 rounded-xl bg-muted/30 border-border/50 w-full sm:w-40">
            <SelectValue placeholder="All Roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="customer">Customer</SelectItem>
            <SelectItem value="rider">Rider</SelectItem>
            <SelectItem value="vendor">Vendor</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-11 rounded-xl bg-muted/30 border-border/50 w-full sm:w-44">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">✓ Active</SelectItem>
            <SelectItem value="blocked">⊘ Blocked</SelectItem>
            <SelectItem value="banned">✕ Banned</SelectItem>
          </SelectContent>
        </Select>
      </Card>

      {/* Users Table */}
      <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="min-w-[760px]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="font-semibold">User</TableHead>
                <TableHead className="font-semibold">Phone</TableHead>
                <TableHead className="font-semibold">Roles</TableHead>
                <TableHead className="font-semibold text-right">Wallet</TableHead>
                <TableHead className="font-semibold text-center">Status</TableHead>
                <TableHead className="font-semibold text-right">Joined</TableHead>
                <TableHead className="font-semibold text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">Loading users...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">No users found.</TableCell></TableRow>
              ) : (
                filtered.map((user: any) => {
                  const userRoles = (user.roles || user.role || "customer").split(",").filter(Boolean);
                  const isBanned  = user.isBanned;
                  const isBlocked = !user.isActive && !isBanned;
                  return (
                    <TableRow key={user.id} className={`hover:bg-muted/30 ${isBanned ? "bg-red-50/30" : isBlocked ? "bg-amber-50/30" : ""}`}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${isBanned ? "bg-red-100 text-red-600" : isBlocked ? "bg-amber-100 text-amber-600" : "bg-primary/10 text-primary"}`}>
                            {(user.name || "U")[0].toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <p className="font-semibold text-foreground">{user.name || "Unknown"}</p>
                              {isBanned && <Badge variant="outline" className="text-[9px] bg-red-50 text-red-600 border-red-200 px-1">BANNED</Badge>}
                              {isBlocked && <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-600 border-amber-200 px-1">BLOCKED</Badge>}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-xs text-muted-foreground font-mono">{user.id.slice(-8).toUpperCase()}</p>
                              {user.city && <span className="flex items-center gap-0.5 text-[10px] text-blue-600"><MapPin className="w-2.5 h-2.5"/>{user.city}</span>}
                              {userRoles.includes("rider") && user.vehiclePlate && <span className="text-[10px] font-mono font-bold bg-green-100 text-green-700 px-1.5 rounded">{user.vehiclePlate}</span>}
                              {userRoles.includes("vendor") && user.businessType && <span className="text-[10px] text-orange-600 capitalize">{user.businessType}</span>}
                              {user.cnic && <span className="flex items-center gap-0.5 text-[10px] text-amber-700"><CreditCard className="w-2.5 h-2.5"/>ID✓</span>}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{user.phone}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {userRoles.map((r: string) => (
                            <Badge key={r} variant="secondary" className="text-[10px] capitalize px-1.5 py-0.5">{r}</Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-bold text-foreground">{formatCurrency(user.walletBalance)}</span>
                      </TableCell>
                      <TableCell className="text-center">
                        {isBanned ? (
                          <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200 text-xs">Banned</Badge>
                        ) : (
                          <div className="flex items-center justify-center gap-2">
                            <Switch checked={user.isActive} onCheckedChange={(val) => handleUpdate(user.id, { isActive: val })} />
                            {user.isActive ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">{formatDate(user.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="outline" size="sm" onClick={() => setSecurityUser(user)} className="h-8 w-8 rounded-lg border-slate-200 text-slate-600 hover:bg-slate-50 p-0 flex items-center justify-center" title="Security Settings">
                            <Shield className="w-3.5 h-3.5"/>
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setActivityUser(user)} className="h-8 w-8 rounded-lg border-blue-200 text-blue-700 hover:bg-blue-50 p-0 flex items-center justify-center" title="Activity">
                            <Activity className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => { setTopupUser(user); setTopupAmount(""); setTopupNote(""); }} className="h-8 rounded-lg text-xs gap-1.5 border-green-200 text-green-700 hover:bg-green-50">
                            <Wallet className="w-3.5 h-3.5" /> Top Up
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setDeleteUser(user)} className="h-8 w-8 rounded-lg border-red-200 text-red-600 hover:bg-red-50 p-0 flex items-center justify-center">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Wallet Top-up Modal */}
      <Dialog open={!!topupUser} onOpenChange={(open) => { if (!open) setTopupUser(null); }}>
        <DialogContent className="w-[95vw] max-w-md rounded-3xl p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <Wallet className="w-5 h-5 text-green-600" /> Wallet Top-up
            </DialogTitle>
          </DialogHeader>
          {topupUser && (
            <div className="mt-4 space-y-5">
              <div className="bg-muted/50 rounded-2xl p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">{(topupUser.name || "U")[0].toUpperCase()}</div>
                <div>
                  <p className="font-semibold">{topupUser.name}</p>
                  <p className="text-sm text-muted-foreground">Balance: <span className="font-bold text-green-600">{formatCurrency(topupUser.walletBalance)}</span></p>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold">Amount (Rs.)</label>
                <Input type="number" min="1" placeholder="e.g. 500" value={topupAmount} onChange={e => setTopupAmount(e.target.value)} className="h-12 rounded-xl text-lg font-bold" autoFocus />
                <div className="flex gap-2 mt-2">
                  {[100, 200, 500, 1000].map(amt => (
                    <button key={amt} type="button" onClick={() => setTopupAmount(String(amt))} className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-colors ${topupAmount === String(amt) ? 'bg-primary text-white border-primary' : 'bg-muted/50 border-border/50 hover:border-primary hover:text-primary'}`}>+{amt}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold">Note (optional)</label>
                <Input placeholder="e.g. Bonus for referral" value={topupNote} onChange={e => setTopupNote(e.target.value)} className="h-11 rounded-xl" />
              </div>
              {topupAmount && Number(topupAmount) > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm">
                  <p className="text-green-700 font-semibold">New balance: <span className="text-green-800 font-bold">{formatCurrency(topupUser.walletBalance + Number(topupAmount))}</span></p>
                </div>
              )}
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 h-11 rounded-xl" onClick={() => setTopupUser(null)}>Cancel</Button>
                <Button className="flex-1 h-11 rounded-xl bg-green-600 hover:bg-green-700 font-bold" onClick={handleTopup} disabled={topupMutation.isPending || !topupAmount || Number(topupAmount) <= 0}>
                  {topupMutation.isPending ? "Processing..." : `Add ${topupAmount ? formatCurrency(Number(topupAmount)) : ""}`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteUser} onOpenChange={open => { if (!open) setDeleteUser(null); }}>
        <DialogContent className="w-[95vw] max-w-sm rounded-3xl p-6">
          <DialogHeader><DialogTitle className="text-red-600">Delete User?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground mt-2">Are you sure you want to permanently delete <strong>"{deleteUser?.name}"</strong> ({deleteUser?.phone})? This cannot be undone.</p>
          <div className="flex gap-3 mt-6">
            <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setDeleteUser(null)}>Cancel</Button>
            <Button variant="destructive" className="flex-1 rounded-xl" onClick={handleDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting..." : "Delete User"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Activity Modal */}
      {activityUser && <UserActivityModal userId={activityUser.id} userName={activityUser.name || activityUser.phone} user={activityUser} onClose={() => setActivityUser(null)} />}

      {/* Security Modal */}
      {securityUser && <SecurityModal user={securityUser} onClose={() => setSecurityUser(null)} />}
    </div>
  );
}
