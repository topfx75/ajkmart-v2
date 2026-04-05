import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Search, CheckCircle2, XCircle, Wallet, RefreshCw, Trash2,
  Activity, ShoppingBag, Car, Pill, Package, Shield, UserCog,
  Ban, KeyRound, Save, AlertTriangle, MapPin, CreditCard, Truck, Building2,
  Download, FileText, CalendarDays, Eye, AlertCircle, MessageSquare,
  Users as UsersIcon, Loader2, AtSign, Phone, Mail, User as UserIcon,
  Gavel,
} from "lucide-react";
import { useLanguage } from "@/lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PullToRefresh } from "@/components/PullToRefresh";
import { useUsers, useUpdateUser, useWalletTopup, useDeleteUser, useUserActivity, usePendingUsers, useApproveUser, useRejectUser, useRequestUserCorrection, useBulkBanUsers } from "@/hooks/use-admin";
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
import { MobileDrawer } from "@/components/MobileDrawer";

const ROLE_COLORS: Record<string, string> = {
  customer: "bg-blue-100 text-blue-700 border-blue-200",
  rider:    "bg-emerald-100 text-emerald-700 border-emerald-200",
  vendor:   "bg-orange-100 text-orange-700 border-orange-200",
  admin:    "bg-purple-100 text-purple-700 border-purple-200",
};

function SkeletonRow() {
  return (
    <TableRow className="animate-pulse">
      <TableCell><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-muted" /><div className="space-y-1.5"><div className="h-4 w-28 bg-muted rounded" /><div className="h-3 w-20 bg-muted rounded" /></div></div></TableCell>
      <TableCell><div className="h-4 w-24 bg-muted rounded" /></TableCell>
      <TableCell><div className="h-5 w-16 bg-muted rounded-full" /></TableCell>
      <TableCell className="text-right"><div className="h-4 w-16 bg-muted rounded ml-auto" /></TableCell>
      <TableCell className="text-center"><div className="h-5 w-12 bg-muted rounded-full mx-auto" /></TableCell>
      <TableCell className="text-right"><div className="h-4 w-20 bg-muted rounded ml-auto" /></TableCell>
      <TableCell className="text-right"><div className="h-8 w-32 bg-muted rounded ml-auto" /></TableCell>
    </TableRow>
  );
}

function UserActivityModal({ userId, userName, user: userData, onClose }: { userId: string; userName: string; user: any; onClose: () => void }) {
  const { data, isLoading, isError } = useUserActivity(userId);
  const userRoles = (userData.roles || userData.role || "customer").split(",").filter(Boolean);
  const isRider  = userRoles.includes("rider");
  const isVendor = userRoles.includes("vendor");

  return (
    <MobileDrawer
      open
      onClose={onClose}
      title={<><Activity className="w-5 h-5 text-indigo-600" /> Activity — {userName}</>}
      dialogClassName="w-[95vw] max-w-2xl max-h-[85dvh] overflow-y-auto rounded-2xl"
    >

        <div className="bg-gradient-to-r from-[#1A56DB]/5 to-blue-50 rounded-xl p-3 space-y-2 border border-blue-100">
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
                <MapPin className="w-3.5 h-3.5 text-[#1A56DB] flex-shrink-0" />
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
                <Truck className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span className="text-muted-foreground text-xs">Vehicle:</span>
                <span className="font-semibold text-xs capitalize">{userData.vehicleType}</span>
              </div>
            )}
            {isRider && userData.vehiclePlate && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">{userData.vehiclePlate}</span>
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
          <div className="h-40 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin text-[#1A56DB]" />
            <span className="text-sm">Loading activity...</span>
          </div>
        ) : isError ? (
          <div className="h-40 flex flex-col items-center justify-center gap-2 text-red-500">
            <AlertTriangle className="w-6 h-6" />
            <span className="text-sm">Failed to load activity data.</span>
          </div>
        ) : (
          <div className="space-y-5 mt-2">
            <div>
              <h3 className="text-sm font-bold flex items-center gap-2 mb-2"><ShoppingBag className="w-4 h-4 text-indigo-600" /> Recent Orders ({data?.orders?.length || 0})</h3>
              {data?.orders?.length === 0 ? <p className="text-xs text-muted-foreground italic">No orders yet.</p> : (
                <div className="space-y-2">
                  {data?.orders?.map((o: any) => (
                    <div key={o.id} className="flex justify-between items-center text-sm bg-muted/30 rounded-xl px-3 py-2 hover:bg-muted/50 transition-colors">
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
              <h3 className="text-sm font-bold flex items-center gap-2 mb-2"><Car className="w-4 h-4 text-emerald-600" /> Recent Rides ({data?.rides?.length || 0})</h3>
              {data?.rides?.length === 0 ? <p className="text-xs text-muted-foreground italic">No rides yet.</p> : (
                <div className="space-y-2">
                  {data?.rides?.map((r: any) => (
                    <div key={r.id} className="flex justify-between items-center text-sm bg-muted/30 rounded-xl px-3 py-2 hover:bg-muted/50 transition-colors">
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
                    <div key={p.id} className="flex justify-between text-sm bg-muted/30 rounded-xl px-3 py-2 hover:bg-muted/50 transition-colors">
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
                    <div key={p.id} className="flex justify-between text-sm bg-muted/30 rounded-xl px-3 py-2 hover:bg-muted/50 transition-colors">
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
              {data?.transactions?.length === 0 ? <p className="text-xs text-muted-foreground italic">No wallet activity.</p> : (
                <div className="space-y-1.5">
                  {data?.transactions?.map((t: any) => (
                    <div key={t.id} className="flex justify-between items-center text-sm bg-muted/30 rounded-xl px-3 py-2 hover:bg-muted/50 transition-colors">
                      <span className="text-muted-foreground truncate max-w-[180px]">{t.description}</span>
                      <span className={`font-bold ${t.type === 'credit' ? 'text-emerald-600' : 'text-red-600'}`}>{t.type === 'credit' ? '+' : '-'}{formatCurrency(t.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
    </MobileDrawer>
  );
}

const ALL_SERVICES = [
  { key: "mart",     label: "Mart",      icon: "🛒" },
  { key: "food",     label: "Food",      icon: "🍔" },
  { key: "rides",    label: "Rides",     icon: "🚗" },
  { key: "pharmacy", label: "Pharmacy",  icon: "💊" },
  { key: "parcel",   label: "Parcel",    icon: "📦" },
];
const ALL_ROLES = [
  { key: "customer", label: "Customer", icon: "👤", desc: "Can place orders, book rides" },
  { key: "rider",    label: "Rider",    icon: "🚴", desc: "Can accept & deliver orders" },
  { key: "vendor",   label: "Vendor",   icon: "🏪", desc: "Can manage a store/menu" },
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
  const [totpEnabled,     setTotpEnabled]     = useState<boolean>(user.totpEnabled || false);
  const [devOtpEnabled,   setDevOtpEnabled]   = useState<boolean>(user.devOtpEnabled || false);

  const [editUsername, setEditUsername] = useState<string>(user.username || "");
  const [editEmail,   setEditEmail]    = useState<string>(user.email || "");
  const [editName,    setEditName]     = useState<string>(user.name || "");

  const securityMutation = useMutation({
    mutationFn: (body: any) => fetcher(`/users/${user.id}/security`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (_data, vars: any) => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      const changedParts: string[] = [];
      const origRoles = (user.roles || user.role || "customer").split(",").map((r: string) => r.trim()).filter(Boolean);
      const newRoles  = (vars.roles || "customer").split(",").map((r: string) => r.trim()).filter(Boolean);
      if (newRoles.sort().join(",") !== origRoles.sort().join(",")) {
        const roleLabels = newRoles.map((r: string) => r.charAt(0).toUpperCase() + r.slice(1)).join(" + ");
        changedParts.push(`Roles: ${roleLabels}`);
      }
      if (vars.isActive !== user.isActive || vars.isBanned !== (user.isBanned || false)) {
        const statusLabel = vars.isBanned ? "Banned" : vars.isActive ? "Active" : "Blocked";
        changedParts.push(`Status: ${statusLabel}`);
      }
      if (vars.securityNote !== (user.securityNote || "")) changedParts.push("Security note updated");
      if (vars.blockedServices !== (user.blockedServices || "")) changedParts.push("Service restrictions updated");
      toast({
        title: "Security settings saved",
        description: changedParts.length ? changedParts.join(" · ") : undefined,
      });
      onClose();
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const resetOtpMutation = useMutation({
    mutationFn: () => fetcher(`/users/${user.id}/reset-otp`, { method: "POST", body: "{}" }),
    onSuccess: () => toast({ title: "OTP cleared", description: "User must re-authenticate on next login." }),
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const disable2faMutation = useMutation({
    mutationFn: () => fetcher(`/users/${user.id}/2fa/disable`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      setTotpEnabled(false);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: "2FA disabled", description: "Two-factor authentication has been turned off for this user." });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const identityMutation = useMutation({
    mutationFn: (body: any) => fetcher(`/users/${user.id}/identity`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: "Identity updated", description: "User identity fields saved successfully." });
    },
    onError: (e: any) => toast({ title: "Identity update failed", description: e.message, variant: "destructive" }),
  });

  const handleIdentitySave = () => {
    const body: Record<string, string> = {};
    if (editName.trim() !== (user.name || "")) body.name = editName.trim();
    if (editUsername.trim().toLowerCase() !== (user.username || "")) body.username = editUsername.trim();
    if (editEmail.trim().toLowerCase() !== (user.email || "")) body.email = editEmail.trim();
    if (Object.keys(body).length === 0) { toast({ title: "No changes", description: "No identity fields were modified." }); return; }
    identityMutation.mutate(body);
  };

  const toggleRole = (r: string) => {
    setRoles(prev => {
      if (prev.includes(r)) {
        if (prev.length <= 1) {
          toast({ title: "At least one role required", description: "A user must have at least one role assigned.", variant: "destructive" });
          return prev;
        }
        return prev.filter(x => x !== r);
      }
      return [...prev, r];
    });
  };
  const toggleService = (s: string) => {
    setBlockedServices(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const handleSave = () => {
    const newRoles = roles.length > 0 ? roles : ["customer"];
    securityMutation.mutate({
      isActive,
      isBanned,
      banReason: isBanned ? banReason : null,
      roles: newRoles.join(","),
      blockedServices: blockedServices.join(","),
      securityNote,
      devOtpEnabled,
      notify: isBanned && !user.isBanned,
    });
  };

  return (
    <MobileDrawer
      open
      onClose={onClose}
      title={<><Shield className="w-5 h-5 text-indigo-600" /> Security — {user.name || user.phone}</>}
      dialogClassName="w-[95vw] max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl"
    >
        <div className="space-y-5 mt-2">
          <div className="bg-gradient-to-r from-[#1A56DB]/5 to-blue-50 rounded-xl px-4 py-3 flex items-center gap-3 border border-blue-100">
            <div className="w-10 h-10 rounded-full bg-[#1A56DB]/10 flex items-center justify-center text-[#1A56DB] font-bold">
              {(user.name || user.phone || "U")[0].toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-sm">{user.name || user.phone}</p>
              <p className="text-xs text-muted-foreground">{user.phone} · Wallet: <strong>{formatCurrency(user.walletBalance)}</strong></p>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2"><AtSign className="w-4 h-4 text-[#1A56DB]"/> Identity Fields</h3>
            <div className="space-y-2">
              <div className="relative">
                <UserIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Full name" value={editName} onChange={e => setEditName(e.target.value)} className="h-10 pl-9 rounded-xl" />
              </div>
              <div className="relative">
                <AtSign className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Username (min 3 chars, lowercase)" value={editUsername} onChange={e => setEditUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} className="h-10 pl-9 rounded-xl font-mono" />
              </div>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Email address" type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} className="h-10 pl-9 rounded-xl" />
              </div>
              <div className="relative">
                <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={user.phone || ""} disabled className="h-10 pl-9 rounded-xl bg-muted/50 text-muted-foreground cursor-not-allowed" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">Primary (read-only)</span>
              </div>
            </div>
            <Button size="sm" onClick={handleIdentitySave} disabled={identityMutation.isPending} className="w-full h-9 rounded-xl bg-[#1A56DB] hover:bg-[#1A56DB]/90 text-white gap-2">
              {identityMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}
              Save Identity
            </Button>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2"><UserCog className="w-4 h-4 text-[#1A56DB]"/> Account Status</h3>
            <div className="grid grid-cols-2 gap-2">
              <div
                onClick={() => { setIsActive(true); setIsBanned(false); }}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${isActive && !isBanned ? "bg-emerald-50 border-emerald-400 shadow-sm" : "bg-muted/30 border-border hover:border-emerald-300"}`}
              >
                <CheckCircle2 className={`w-5 h-5 mb-1 ${isActive && !isBanned ? "text-emerald-600" : "text-muted-foreground"}`}/>
                <p className="text-sm font-bold">Active</p>
                <p className="text-xs text-muted-foreground">Full access</p>
              </div>
              <div
                onClick={() => { setIsActive(false); setIsBanned(false); }}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${!isActive && !isBanned ? "bg-amber-50 border-amber-400 shadow-sm" : "bg-muted/30 border-border hover:border-amber-300"}`}
              >
                <XCircle className={`w-5 h-5 mb-1 ${!isActive && !isBanned ? "text-amber-600" : "text-muted-foreground"}`}/>
                <p className="text-sm font-bold">Blocked</p>
                <p className="text-xs text-muted-foreground">Temp suspend</p>
              </div>
              <div
                onClick={() => { setIsBanned(true); setIsActive(false); }}
                className={`p-3 rounded-xl border cursor-pointer transition-all col-span-2 ${isBanned ? "bg-red-50 border-red-400 shadow-sm" : "bg-muted/30 border-border hover:border-red-300"}`}
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
                className="h-11 rounded-xl border-red-200 focus:ring-red-300"
              />
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-bold text-foreground">Roles <span className="text-xs font-normal text-muted-foreground ml-1">Multiple roles allowed</span></h3>
            <div className="space-y-2">
              {ALL_ROLES.map(r => (
                <div
                  key={r.key}
                  onClick={() => toggleRole(r.key)}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${roles.includes(r.key) ? "bg-[#1A56DB]/5 border-[#1A56DB]/30 shadow-sm" : "bg-muted/30 border-border hover:border-[#1A56DB]/20"}`}
                >
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${roles.includes(r.key) ? "bg-[#1A56DB] border-[#1A56DB]" : "border-gray-300"}`}>
                    {roles.includes(r.key) && <span className="text-white text-xs font-bold">✓</span>}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{r.icon} {r.label}</p>
                    <p className="text-xs text-muted-foreground">{r.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Wallet className="w-4 h-4 text-amber-600"/> Freeze Wallet
            </h3>
            <div
              onClick={() => toggleService("wallet")}
              className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${blockedServices.includes("wallet") ? "bg-amber-50 border-amber-400 shadow-sm" : "bg-muted/30 border-border hover:border-amber-300"}`}
            >
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${blockedServices.includes("wallet") ? "bg-amber-500 border-amber-500" : "border-gray-300"}`}>
                {blockedServices.includes("wallet") && <span className="text-white text-xs font-bold">✕</span>}
              </div>
              <div className="flex-1">
                <span className="text-sm font-semibold">🔒 Freeze Wallet</span>
                <p className="text-xs text-muted-foreground">Blocks all wallet operations (send, receive, topup, pay)</p>
              </div>
              {blockedServices.includes("wallet") && <Badge variant="outline" className="ml-auto text-[10px] bg-amber-50 text-amber-600 border-amber-200">FROZEN</Badge>}
            </div>
          </div>

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
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${isBlocked ? "bg-red-50 border-red-300 shadow-sm" : "bg-muted/30 border-border hover:border-red-200"}`}
                  >
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${isBlocked ? "bg-red-500 border-red-500" : "border-gray-300"}`}>
                      {isBlocked && <span className="text-white text-xs font-bold">✕</span>}
                    </div>
                    <span className="text-sm font-semibold">{s.icon} {s.label}</span>
                    {isBlocked && <Badge variant="outline" className="ml-auto text-[10px] bg-red-50 text-red-600 border-red-200">BLOCKED</Badge>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-sm font-bold text-foreground">Admin Security Note <span className="text-xs font-normal text-muted-foreground">(internal)</span></h3>
            <textarea
              rows={3}
              placeholder="e.g. Suspected fraud — monitor activity. Or: VIP user — do not block."
              value={securityNote}
              onChange={e => setSecurityNote(e.target.value)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#1A56DB]/30"
            />
          </div>

          <div
            onClick={() => setDevOtpEnabled(!devOtpEnabled)}
            className={`rounded-xl p-3 flex items-center gap-3 border cursor-pointer transition-all ${devOtpEnabled ? "bg-emerald-50 border-emerald-300 shadow-sm" : "bg-muted/30 border-border hover:border-emerald-200"}`}
          >
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${devOtpEnabled ? "bg-emerald-500 border-emerald-500" : "border-gray-300"}`}>
              {devOtpEnabled && <span className="text-white text-xs font-bold">✓</span>}
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Dev OTP Mode</p>
              <p className="text-xs text-muted-foreground">OTP will be returned in API response instead of sent via SMS — for testing only</p>
            </div>
            {devOtpEnabled && <Badge variant="outline" className="ml-auto text-[10px] bg-emerald-50 text-emerald-600 border-emerald-200">ENABLED</Badge>}
          </div>

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
              {resetOtpMutation.isPending ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Clearing...</> : "Reset OTP"}
            </Button>
          </div>

          {totpEnabled && (
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 flex items-center gap-3">
              <Shield className="w-5 h-5 text-purple-600 flex-shrink-0"/>
              <div className="flex-1">
                <p className="text-sm font-semibold text-purple-800">Two-Factor Authentication</p>
                <p className="text-xs text-purple-700">User has 2FA enabled — disable only if they lost access</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="border-purple-300 text-purple-700 hover:bg-purple-100 rounded-lg text-xs"
                onClick={() => disable2faMutation.mutate()}
                disabled={disable2faMutation.isPending}
              >
                {disable2faMutation.isPending ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Disabling...</> : "Disable 2FA"}
              </Button>
            </div>
          )}

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
              className="flex-1 rounded-xl gap-2 bg-[#1A56DB] hover:bg-[#1A56DB]/90"
            >
              {securityMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4"/>}
              {securityMutation.isPending ? "Saving..." : "Save Security"}
            </Button>
          </div>
        </div>
    </MobileDrawer>
  );
}

/* ── CSV Export helper ── */
function exportUsersCSV(users: any[]) {
  const header = "ID,Name,Phone,Email,Role,Status,Wallet,Joined";
  const rows = users.map((u: any) =>
    [u.id, u.name || "", u.phone || "", u.email || "", u.role || "customer",
     u.isBanned ? "banned" : u.isActive ? "active" : "blocked",
     u.walletBalance, u.createdAt?.slice(0,10) || ""].join(",")
  );
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `users-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

/* ── KYC Doc Viewer ── */
function parseUserDocuments(user: any): { files: { type: string; url: string; label: string }[]; note?: string } {
  const result: { files: { type: string; url: string; label: string }[]; note?: string } = { files: [] };
  const seenUrls = new Set<string>();
  if (user.vehiclePhoto) {
    result.files.push({ type: "vehicle_photo", url: user.vehiclePhoto, label: "Vehicle Photo" });
    seenUrls.add(user.vehiclePhoto);
  }
  if (user.documents) {
    try {
      const parsed = JSON.parse(user.documents);
      if (parsed.files && Array.isArray(parsed.files)) {
        for (const f of parsed.files) {
          if (f.url && !seenUrls.has(f.url)) {
            const label = DOC_TYPE_LABELS[f.type] || f.label || f.type;
            result.files.push({ type: f.type, url: f.url, label });
            seenUrls.add(f.url);
          }
        }
        if (parsed.note) result.note = parsed.note;
      } else if (Array.isArray(parsed)) {
        for (const f of parsed) {
          if (f.url && !seenUrls.has(f.url)) {
            const label = DOC_TYPE_LABELS[f.type] || f.label || f.type;
            result.files.push({ type: f.type, url: f.url, label });
            seenUrls.add(f.url);
          }
        }
      }
    } catch {}
  }
  return result;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  cnic_front: "CNIC Front",
  cnic_back: "CNIC Back",
  cnic: "CNIC Front",
  driving_license: "Driving License",
  vehicle_photo: "Vehicle Photo",
};

function KycDocModal({ user, onClose }: { user: any; onClose: () => void }) {
  const correctionMutation = useRequestUserCorrection();
  const { toast } = useToast();
  const [corrField, setCorrField] = useState("");
  const [corrNote, setCorrNote]   = useState("");
  const [showCorrForm, setShowCorrForm] = useState(false);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});

  const parsed = parseUserDocuments(user);
  const docs = parsed.files;
  const riderNote = parsed.note;

  const allChecked = ["cnic_legible", "photo_match", "details_correct", "not_expired"].every(k => checklist[k]);

  const handleRequestCorrection = () => {
    if (!user.id) return;
    correctionMutation.mutate({ id: user.id, field: corrField || "document", note: corrNote || undefined }, {
      onSuccess: () => {
        toast({ title: "Correction requested", description: "User will be notified to re-upload." });
        setShowCorrForm(false);
        onClose();
      },
      onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  const toggleCheck = (key: string) => setChecklist(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <MobileDrawer
      open
      onClose={onClose}
      title={<><FileText className="w-5 h-5 text-indigo-600" /> KYC Documents — {user.name || user.phone}</>}
      dialogClassName="w-[95vw] max-w-2xl max-h-[85dvh] overflow-y-auto rounded-2xl"
    >
        <div className="flex flex-wrap gap-3 mt-1">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg text-xs">
            <span className="font-semibold text-muted-foreground">CNIC:</span>
            <span className="font-mono">{user.cnic || "N/A"}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg text-xs">
            <span className="font-semibold text-muted-foreground">Vehicle:</span>
            <span>{user.vehicleType || "N/A"}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg text-xs">
            <span className="font-semibold text-muted-foreground">Plate:</span>
            <span className="font-mono">{user.vehiclePlate || user.vehicleRegNo || "N/A"}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg text-xs">
            <span className="font-semibold text-muted-foreground">License #:</span>
            <span className="font-mono">{user.drivingLicense || "N/A"}</span>
          </div>
        </div>

        {riderNote && (
          <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-xl">
            <p className="text-xs font-bold text-blue-800 uppercase tracking-wider mb-1 flex items-center gap-1">
              <MessageSquare className="w-3.5 h-3.5" /> Rider's Note
            </p>
            <p className="text-sm text-blue-900 leading-relaxed">{riderNote}</p>
          </div>
        )}

        {docs.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
            No documents uploaded yet.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mt-3 mb-1">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Uploaded Documents ({docs.length})
              </p>
              {docs.length < 4 && (
                <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                  {4 - docs.length} missing
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {docs.map((doc, i) => (
                <div key={`${doc.type}-${i}`} className="space-y-1 group">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {DOC_TYPE_LABELS[doc.type] || doc.label}
                  </p>
                  <a href={doc.url} target="_blank" rel="noopener noreferrer" className="block relative rounded-xl overflow-hidden border border-border/50">
                    <img src={doc.url} alt={doc.label} className="w-full h-32 object-cover group-hover:opacity-80 transition-opacity" />
                    <span className="absolute bottom-1.5 right-1.5 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full font-medium">
                      Click to zoom
                    </span>
                  </a>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="mt-4 space-y-2">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Verification Checklist</p>
          {[
            { key: "cnic_legible", label: "CNIC is legible and valid" },
            { key: "photo_match", label: "Photo matches ID / person" },
            { key: "details_correct", label: "Name, DOB, and details are correct" },
            { key: "not_expired", label: "Documents are not expired" },
          ].map(item => (
            <label key={item.key} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={!!checklist[item.key]} onChange={() => toggleCheck(item.key)} className="w-4 h-4 rounded accent-green-600" />
              <span className={checklist[item.key] ? "text-green-700 font-medium" : ""}>{item.label}</span>
            </label>
          ))}
          {allChecked && (
            <p className="text-xs text-green-600 font-semibold flex items-center gap-1 mt-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> All checks passed — ready to approve
            </p>
          )}
        </div>

        {!showCorrForm ? (
          <button onClick={() => setShowCorrForm(true)} className="mt-4 text-xs text-amber-600 flex items-center gap-1 hover:underline font-semibold">
            <AlertCircle className="w-3.5 h-3.5" /> Request document correction
          </button>
        ) : (
          <div className="mt-4 space-y-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
            <p className="text-xs font-bold text-amber-800">Request Correction</p>
            <select value={corrField} onChange={e => setCorrField(e.target.value)} className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
              <option value="">Select document</option>
              <option value="cnic_front">CNIC Front</option>
              <option value="cnic_back">CNIC Back</option>
              <option value="driving_license">Driving License</option>
              <option value="vehicle_photo">Vehicle Photo</option>
              <option value="all">All Documents</option>
            </select>
            <Input placeholder="Note to user (e.g., photo is blurry, CNIC not readable)..." value={corrNote} onChange={e => setCorrNote(e.target.value)} className="h-9 rounded-lg text-sm" />
            <div className="flex gap-2">
              <button onClick={() => setShowCorrForm(false)} className="flex-1 h-9 border border-border/50 rounded-lg text-xs font-semibold">Cancel</button>
              <button onClick={handleRequestCorrection} disabled={correctionMutation.isPending}
                className="flex-1 h-9 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold disabled:opacity-60">
                {correctionMutation.isPending ? "Sending..." : "Send Request"}
              </button>
            </div>
          </div>
        )}
    </MobileDrawer>
  );
}

/* ══════════ Main Users Page ══════════ */

export default function Users() {
  const [, navigate] = useLocation();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const [conditionTier, setConditionTier] = useState("all");
  const { data, isLoading, refetch, isFetching, isError } = useUsers(conditionTier !== "all" ? conditionTier : undefined);
  const { data: pendingData, refetch: refetchPending } = usePendingUsers();
  const updateMutation   = useUpdateUser();
  const topupMutation    = useWalletTopup();
  const deleteMutation   = useDeleteUser();
  const approveMutation  = useApproveUser();
  const rejectMutation   = useRejectUser();
  const bulkBanMutation  = useBulkBanUsers();
  const { toast } = useToast();
  const qc = useQueryClient();
  const waiveDebtMutation = useMutation({
    mutationFn: (userId: string) => fetcher(`/admin/users/${userId}/waive-debt`, { method: "PATCH" }),
    onSuccess: (data: any, userId: string) => {
      toast({ title: "Debt Waived", description: `${formatCurrency(Number(data.waived?.toFixed(0) || 0))} cancellation debt cleared.` });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");
  const [topupUser, setTopupUser] = useState<any>(null);
  const [topupAmount, setTopupAmount] = useState("");
  const [topupNote, setTopupNote] = useState("");
  const [deleteUser, setDeleteUser] = useState<any>(null);
  const [activityUser, setActivityUser] = useState<any>(null);
  const [securityUser, setSecurityUser] = useState<any>(null);
  const [rejectUser, setRejectUser]     = useState<any>(null);
  const [rejectNote, setRejectNote]     = useState("");
  const [kycUser, setKycUser]           = useState<any>(null);
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set());

  const pendingUsers = pendingData?.users || [];

  const handleApprove = (userId: string) => {
    approveMutation.mutate({ id: userId }, {
      onSuccess: () => { toast({ title: "User approved!", description: "User can now log in." }); },
      onError: err => toast({ title: "Failed to approve", description: err.message, variant: "destructive" }),
    });
  };

  const handleReject = () => {
    if (!rejectUser) return;
    rejectMutation.mutate({ id: rejectUser.id, note: rejectNote || "Rejected by admin" }, {
      onSuccess: () => {
        toast({ title: "User rejected", description: "Account rejected and user notified." });
        setRejectUser(null); setRejectNote("");
      },
      onError: err => toast({ title: "Failed to reject", description: err.message, variant: "destructive" }),
    });
  };

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
          toast({ title: "Wallet Topped Up!", description: `Rs. ${amt} added. New balance: ${formatCurrency(d.newBalance)}` });
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
      (u.phone || "").includes(search) ||
      (u.email?.toLowerCase() || "").includes(search.toLowerCase());
    const allUserRoles = new Set([
      ...(u.roles || "").split(",").map((r: string) => r.trim()).filter(Boolean),
      ...(u.role  || "").split(",").map((r: string) => r.trim()).filter(Boolean),
    ]);
    const matchRole = roleFilter === "all" || allUserRoles.has(roleFilter);
    const matchStatus = statusFilter === "all"
      || (statusFilter === "active"   && u.isActive && !u.isBanned)
      || (statusFilter === "blocked"  && !u.isActive && !u.isBanned)
      || (statusFilter === "banned"   && u.isBanned);
    const matchDate = (!dateFrom || new Date(u.createdAt) >= new Date(dateFrom))
                   && (!dateTo   || new Date(u.createdAt) <= new Date(dateTo + "T23:59:59"));
    return matchSearch && matchRole && matchStatus && matchDate;
  });

  const bannedCount  = users.filter((u: any) => u.isBanned).length;
  const blockedCount = users.filter((u: any) => !u.isActive && !u.isBanned).length;
  const activeCount  = users.filter((u: any) => u.isActive && !u.isBanned).length;

  const allSelected = filtered.length > 0 && filtered.every((u: any) => selectedIds.has(u.id));
  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((u: any) => u.id)));
    }
  };

  const handleBulkBan = (action: "ban" | "unban") => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    bulkBanMutation.mutate({ ids, action }, {
      onSuccess: (d: any) => {
        toast({ title: `${action === "ban" ? "Banned" : "Unbanned"} ${d.affected} user(s)` });
        setSelectedIds(new Set());
      },
      onError: e => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  const handlePullRefresh = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["admin-users"] }),
      qc.invalidateQueries({ queryKey: ["admin-pending"] }),
    ]);
  }, [qc]);

  return (
    <PullToRefresh onRefresh={handlePullRefresh} className="space-y-6">
      <div className="bg-gradient-to-r from-[#1A56DB] to-[#2563EB] rounded-2xl p-6 text-white shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <UsersIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Users</h1>
              <p className="text-sm text-blue-100 mt-0.5">
                {users.length} total
                {activeCount > 0 && <span> · {activeCount} active</span>}
                {bannedCount > 0 && <span className="text-red-200"> · {bannedCount} banned</span>}
                {blockedCount > 0 && <span className="text-amber-200"> · {blockedCount} blocked</span>}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportUsersCSV(filtered)}
            className="h-9 rounded-xl gap-2 bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white"
          >
            <Download className="w-4 h-4" /> Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-9 rounded-xl gap-2 bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {pendingUsers.length > 0 && (
        <Card className="p-4 rounded-2xl border-amber-200 bg-amber-50/60 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <h3 className="font-semibold text-amber-800 text-sm">Pending Approval ({pendingUsers.length})</h3>
              <span className="text-xs text-amber-600 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full">Action Required</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetchPending()} className="h-7 text-xs text-amber-700 hover:bg-amber-100">
              {T("refresh")}
            </Button>
          </div>
          <div className="space-y-2">
            {pendingUsers.map((u: any) => (
              <div key={u.id} className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-amber-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 font-bold text-sm flex items-center justify-center flex-shrink-0">
                    {(u.name || u.phone || "U")[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-foreground truncate">{u.name || "New User"}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs text-muted-foreground font-mono">{u.phone}</p>
                      {u.email && <p className="text-xs text-muted-foreground">· {u.email}</p>}
                      <Badge variant="outline" className={`text-[10px] capitalize px-1.5 border ${ROLE_COLORS[u.role] || ROLE_COLORS.customer}`}>{u.role || "customer"}</Badge>
                      {(() => { const d = parseUserDocuments(u); return d.files.length > 0 ? (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${d.files.length >= 4 ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                          {d.files.length} doc{d.files.length !== 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">No docs</span>
                      ); })()}
                      {(() => { const d = parseUserDocuments(u); return d.note ? <MessageSquare className="w-3 h-3 text-blue-500" /> : null; })()}
                      <p className="text-xs text-amber-600">{formatDate(u.createdAt)}</p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setKycUser(u)}
                    className="h-8 px-3 border-blue-200 text-blue-600 hover:bg-blue-50 rounded-lg text-xs gap-1"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Documents
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleApprove(u.id)}
                    disabled={approveMutation.isPending}
                    className="h-8 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs gap-1"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setRejectUser(u); setRejectNote(""); }}
                    disabled={rejectMutation.isPending}
                    className="h-8 px-3 border-red-200 text-red-600 hover:bg-red-50 rounded-lg text-xs gap-1"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {rejectUser && (
        <Dialog open onOpenChange={open => { if (!open) { setRejectUser(null); setRejectNote(""); } }}>
          <DialogContent className="max-w-sm rounded-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <XCircle className="w-5 h-5" /> Reject User
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Are you sure you want to reject <strong>{rejectUser.name || rejectUser.phone}</strong>? They will not be able to log in.
              </p>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Rejection Reason (optional)</label>
                <textarea
                  value={rejectNote}
                  onChange={e => setRejectNote(e.target.value)}
                  placeholder="e.g. Documents incomplete, suspicious activity..."
                  rows={3}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 rounded-xl" onClick={() => { setRejectUser(null); setRejectNote(""); }}>Cancel</Button>
                <Button onClick={handleReject} disabled={rejectMutation.isPending} className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 text-white gap-2">
                  {rejectMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                  {rejectMutation.isPending ? "Rejecting..." : "Confirm Reject"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Card className="p-4 rounded-2xl border-border/50 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search by name, phone, or email..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-11 rounded-xl bg-muted/30 border-border/50 focus:ring-[#1A56DB]/30" />
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
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="blocked">Blocked</SelectItem>
              <SelectItem value="banned">Banned</SelectItem>
            </SelectContent>
          </Select>
          <Select value={conditionTier} onValueChange={setConditionTier}>
            <SelectTrigger className="h-11 rounded-xl bg-muted/30 border-border/50 w-full sm:w-48">
              <SelectValue placeholder="Condition Tier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Conditions</SelectItem>
              <SelectItem value="clean">Clean (No Conditions)</SelectItem>
              <SelectItem value="has_conditions">Has Conditions</SelectItem>
              <SelectItem value="warnings">Warnings</SelectItem>
              <SelectItem value="restrictions">Restrictions</SelectItem>
              <SelectItem value="suspensions">Suspensions</SelectItem>
              <SelectItem value="bans">Bans</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="flex items-center gap-2 flex-1">
            <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 rounded-xl bg-muted/30 border-border/50 text-sm" />
            <span className="text-muted-foreground text-xs">to</span>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 rounded-xl bg-muted/30 border-border/50 text-sm" />
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-xs text-[#1A56DB] hover:underline shrink-0">Clear</button>
            )}
          </div>
          {/* Bulk actions */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted-foreground font-semibold">{selectedIds.size} selected</span>
              <button onClick={() => handleBulkBan("ban")} disabled={bulkBanMutation.isPending}
                className="px-3 py-1.5 bg-red-100 text-red-700 border border-red-200 rounded-lg text-xs font-bold hover:bg-red-200 disabled:opacity-60 transition-colors">
                Ban All
              </button>
              <button onClick={() => handleBulkBan("unban")} disabled={bulkBanMutation.isPending}
                className="px-3 py-1.5 bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold hover:bg-emerald-200 disabled:opacity-60 transition-colors">
                Unban All
              </button>
              <button onClick={() => setSelectedIds(new Set())} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Deselect</button>
            </div>
          )}
        </div>
      </Card>

      {isError ? (
        <Card className="rounded-2xl border-red-200 bg-red-50/60 shadow-sm p-8">
          <div className="flex flex-col items-center justify-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <div>
              <p className="font-semibold text-red-800">Failed to load users</p>
              <p className="text-sm text-red-600 mt-1">Check your connection and try again.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-2 rounded-xl border-red-200 text-red-700 hover:bg-red-100">
              <RefreshCw className="w-4 h-4 mr-2" /> Retry
            </Button>
          </div>
        </Card>
      ) : (
        <>
        {/* Mobile card list */}
        <div className="md:hidden space-y-3">
          {isLoading ? (
            [1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded-2xl animate-pulse" />)
          ) : filtered.length === 0 ? (
            <Card className="rounded-2xl p-12 text-center border-border/50">
              <UsersIcon className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-muted-foreground text-sm">No users found</p>
            </Card>
          ) : filtered.map((user: any) => {
            const userRoles = (user.roles || user.role || "customer").split(",").filter(Boolean);
            const isBanned  = user.isBanned;
            const isBlocked = !user.isActive && !isBanned;
            return (
              <Card key={user.id} className={`rounded-2xl border-border/50 shadow-sm p-4 ${isBanned ? "bg-red-50/30 border-red-200/60" : isBlocked ? "bg-amber-50/30 border-amber-200/60" : ""}`}>
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${isBanned ? "bg-red-100 text-red-600" : isBlocked ? "bg-amber-100 text-amber-600" : "bg-[#1A56DB]/10 text-[#1A56DB]"}`}>
                    {(user.name || user.phone || "U")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-foreground truncate">{user.name || user.phone}</p>
                      {isBanned && <Badge variant="outline" className="text-[9px] bg-red-50 text-red-600 border-red-200 px-1">BANNED</Badge>}
                      {isBlocked && <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-600 border-amber-200 px-1">BLOCKED</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">{user.phone}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {userRoles.map((r: string) => (
                        <Badge key={r} variant="outline" className={`text-[10px] capitalize px-1.5 border ${ROLE_COLORS[r] || "bg-gray-100 text-gray-700 border-gray-200"}`}>{r}</Badge>
                      ))}
                      <span className="text-xs text-muted-foreground">{formatCurrency(user.walletBalance)}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => setKycUser(user)} className="h-8 px-2.5 rounded-lg border-purple-200 text-purple-700 text-xs">
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setSecurityUser(user)} className="h-8 px-2.5 rounded-lg border-slate-200 text-slate-600 text-xs">
                      <Shield className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => navigate(`/account-conditions?userId=${user.id}`)} className="h-8 px-2.5 rounded-lg border-violet-200 text-violet-600 text-xs gap-1" title="Conditions">
                      <Gavel className="w-3.5 h-3.5" />
                      {user.conditionCount > 0 && <span className="text-[10px] font-bold bg-violet-100 text-violet-700 rounded-full px-1.5 min-w-[18px] text-center">{user.conditionCount}</span>}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { setTopupUser(user); setTopupAmount(""); setTopupNote(""); }} className="h-8 px-2.5 rounded-lg border-emerald-200 text-emerald-700 text-xs">
                      <Wallet className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Desktop table */}
        <Card className="hidden md:block rounded-2xl border-border/50 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow className="bg-gradient-to-r from-[#1A56DB]/5 to-blue-50/50 border-b border-blue-100">
                  <TableHead className="w-8 px-3">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-4 h-4 rounded" />
                  </TableHead>
                  <TableHead className="font-semibold text-[#1A56DB]/80">User</TableHead>
                  <TableHead className="font-semibold text-[#1A56DB]/80">Phone</TableHead>
                  <TableHead className="font-semibold text-[#1A56DB]/80">Roles</TableHead>
                  <TableHead className="font-semibold text-[#1A56DB]/80 text-right">Wallet</TableHead>
                  <TableHead className="font-semibold text-[#1A56DB]/80 text-center">Status</TableHead>
                  <TableHead className="font-semibold text-[#1A56DB]/80 text-right">Joined</TableHead>
                  <TableHead className="font-semibold text-[#1A56DB]/80 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <>
                    <SkeletonRow />
                    <SkeletonRow />
                    <SkeletonRow />
                    <SkeletonRow />
                    <SkeletonRow />
                  </>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-40">
                      <div className="flex flex-col items-center justify-center gap-2 text-center">
                        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                          <UsersIcon className="w-6 h-6 text-muted-foreground" />
                        </div>
                        <p className="font-medium text-muted-foreground">No users found</p>
                        {(search || roleFilter !== "all" || statusFilter !== "all" || conditionTier !== "all" || dateFrom || dateTo) && (
                          <p className="text-xs text-muted-foreground">Try adjusting your filters</p>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((user: any) => {
                    const userRoles = (user.roles || user.role || "customer").split(",").filter(Boolean);
                    const isBanned  = user.isBanned;
                    const isBlocked = !user.isActive && !isBanned;
                    const isChecked = selectedIds.has(user.id);
                    return (
                      <TableRow key={user.id} className={`hover:bg-muted/40 transition-colors ${isBanned ? "bg-red-50/40" : isBlocked ? "bg-amber-50/40" : ""} ${isChecked ? "bg-blue-50/40" : ""}`}>
                        <TableCell className="px-3">
                          <input type="checkbox" checked={isChecked}
                            onChange={e => {
                              const s = new Set(selectedIds);
                              e.target.checked ? s.add(user.id) : s.delete(user.id);
                              setSelectedIds(s);
                            }}
                            className="w-4 h-4 rounded" />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${isBanned ? "bg-red-100 text-red-600" : isBlocked ? "bg-amber-100 text-amber-600" : "bg-[#1A56DB]/10 text-[#1A56DB]"}`}>
                              {(user.name || user.phone || "U")[0].toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="font-semibold text-foreground truncate">{user.name || user.phone}</p>
                                {isBanned && <Badge variant="outline" className="text-[9px] bg-red-50 text-red-600 border-red-200 px-1">BANNED</Badge>}
                                {isBlocked && <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-600 border-amber-200 px-1">BLOCKED</Badge>}
                                {(user.blockedServices || "").split(",").map((s: string) => s.trim()).includes("wallet") && <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-600 border-amber-200 px-1">🔒 Wallet</Badge>}
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-xs text-muted-foreground font-mono">{user.id.slice(-8).toUpperCase()}</p>
                                {user.username && <span className="flex items-center gap-0.5 text-[10px] font-mono text-violet-600">@{user.username}</span>}
                                {user.email && <span className="flex items-center gap-0.5 text-[10px] text-blue-600 truncate max-w-[140px]"><Mail className="w-2.5 h-2.5 flex-shrink-0"/>{user.email}</span>}
                                {user.city && <span className="flex items-center gap-0.5 text-[10px] text-[#1A56DB]"><MapPin className="w-2.5 h-2.5"/>{user.city}</span>}
                                {userRoles.includes("rider") && user.vehiclePlate && <span className="text-[10px] font-mono font-bold bg-emerald-100 text-emerald-700 px-1.5 rounded">{user.vehiclePlate}</span>}
                                {userRoles.includes("vendor") && user.businessType && <span className="text-[10px] text-orange-600 capitalize">{user.businessType}</span>}
                                {user.cnic && <span className="flex items-center gap-0.5 text-[10px] text-amber-700"><CreditCard className="w-2.5 h-2.5"/>ID✓</span>}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="font-medium text-sm">{user.phone}</TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {userRoles.map((r: string) => (
                              <Badge key={r} variant="outline" className={`text-[10px] capitalize px-1.5 py-0.5 border ${ROLE_COLORS[r] || "bg-gray-100 text-gray-700 border-gray-200"}`}>{r}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-bold text-foreground">{formatCurrency(user.walletBalance)}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center gap-1">
                            {isBanned ? (
                              <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200 text-xs">Banned</Badge>
                            ) : (
                              <div className="flex items-center justify-center gap-2">
                                <Switch checked={user.isActive} onCheckedChange={(val) => handleUpdate(user.id, { isActive: val })} />
                                {user.isActive ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-red-400" />}
                              </div>
                            )}
                            {user.conditionCount > 0 && (
                              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${
                                user.maxConditionSeverity === "ban" ? "bg-red-50 text-red-600 border-red-200" :
                                user.maxConditionSeverity === "suspension" ? "bg-orange-50 text-orange-600 border-orange-200" :
                                (user.maxConditionSeverity === "restriction_normal" || user.maxConditionSeverity === "restriction_strict") ? "bg-amber-50 text-amber-600 border-amber-200" :
                                "bg-yellow-50 text-yellow-600 border-yellow-200"
                              }`}>
                                {user.conditionCount} {user.maxConditionSeverity === "restriction_normal" ? "restriction" : user.maxConditionSeverity === "restriction_strict" ? "strict restriction" : user.maxConditionSeverity}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{formatDate(user.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="outline" size="sm" onClick={() => setKycUser(user)} className="h-8 w-8 rounded-lg border-purple-200 text-purple-700 hover:bg-purple-50 hover:border-purple-300 p-0 flex items-center justify-center transition-colors" title="KYC Docs">
                              <Eye className="w-3.5 h-3.5"/>
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setSecurityUser(user)} className="h-8 w-8 rounded-lg border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 p-0 flex items-center justify-center transition-colors" title="Security Settings">
                              <Shield className="w-3.5 h-3.5"/>
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => navigate(`/account-conditions?userId=${user.id}`)} className="h-8 rounded-lg border-violet-200 text-violet-600 hover:bg-violet-50 hover:border-violet-300 px-2 flex items-center justify-center gap-1 transition-colors" title="Conditions">
                              <Gavel className="w-3.5 h-3.5"/>
                              {user.conditionCount > 0 && <span className="text-[10px] font-bold bg-violet-100 text-violet-700 rounded-full px-1.5 min-w-[18px] text-center">{user.conditionCount}</span>}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setActivityUser(user)} className="h-8 w-8 rounded-lg border-[#1A56DB]/20 text-[#1A56DB] hover:bg-[#1A56DB]/5 hover:border-[#1A56DB]/30 p-0 flex items-center justify-center transition-colors" title="Activity">
                              <Activity className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => { setTopupUser(user); setTopupAmount(""); setTopupNote(""); }} className="h-8 rounded-lg text-xs gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300 transition-colors">
                              <Wallet className="w-3.5 h-3.5" /> Top Up
                            </Button>
                            {parseFloat(user.cancellationDebt || "0") > 0 && (
                              <Button
                                variant="outline" size="sm"
                                onClick={() => waiveDebtMutation.mutate(user.id)}
                                disabled={waiveDebtMutation.isPending}
                                className="h-8 rounded-lg text-xs gap-1.5 border-orange-200 text-orange-700 hover:bg-orange-50 hover:border-orange-300 transition-colors"
                                title={`Waive Rs. ${parseFloat(user.cancellationDebt).toFixed(0)} debt`}
                              >
                                <span className="text-xs">⚡</span> Waive Debt
                              </Button>
                            )}
                            <Button variant="outline" size="sm" onClick={() => setDeleteUser(user)} className="h-8 w-8 rounded-lg border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 p-0 flex items-center justify-center transition-colors">
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
          {!isLoading && filtered.length > 0 && (
            <div className="border-t border-border/50 px-4 py-3 bg-muted/20 text-xs text-muted-foreground">
              Showing {filtered.length} of {users.length} users
            </div>
          )}
        </Card>
        </>
      )}

      <Dialog open={!!topupUser} onOpenChange={(open) => { if (!open) setTopupUser(null); }}>
        <DialogContent className="w-[95vw] max-w-md rounded-2xl p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2 text-emerald-700">
              <Wallet className="w-5 h-5" /> Wallet Top-up
            </DialogTitle>
          </DialogHeader>
          {topupUser && (
            <div className="mt-4 space-y-5">
              <div className="bg-gradient-to-r from-emerald-50 to-green-50 rounded-xl p-4 flex items-center gap-3 border border-emerald-100">
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold">{(topupUser.name || topupUser.phone || "U")[0].toUpperCase()}</div>
                <div>
                  <p className="font-semibold">{topupUser.name || topupUser.phone}</p>
                  <p className="text-sm text-muted-foreground">Balance: <span className="font-bold text-emerald-600">{formatCurrency(topupUser.walletBalance)}</span></p>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold">Amount (Rs.)</label>
                <Input type="number" min="1" placeholder="e.g. 500" value={topupAmount} onChange={e => setTopupAmount(e.target.value)} className="h-12 rounded-xl text-lg font-bold focus:ring-emerald-300" autoFocus />
                <div className="flex gap-2 mt-2">
                  {[100, 200, 500, 1000].map(amt => (
                    <button key={amt} type="button" onClick={() => setTopupAmount(String(amt))} className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-colors ${topupAmount === String(amt) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-muted/50 border-border/50 hover:border-emerald-400 hover:text-emerald-700'}`}>+{amt}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold">Note (optional)</label>
                <Input placeholder="e.g. Bonus for referral" value={topupNote} onChange={e => setTopupNote(e.target.value)} className="h-11 rounded-xl" />
              </div>
              {topupAmount && Number(topupAmount) > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm">
                  <p className="text-emerald-700 font-semibold">New balance: <span className="text-emerald-800 font-bold">{formatCurrency(topupUser.walletBalance + Number(topupAmount))}</span></p>
                </div>
              )}
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 h-11 rounded-xl" onClick={() => setTopupUser(null)}>Cancel</Button>
                <Button className="flex-1 h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 font-bold gap-2" onClick={handleTopup} disabled={topupMutation.isPending || !topupAmount || Number(topupAmount) <= 0}>
                  {topupMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {topupMutation.isPending ? "Processing..." : `Add ${topupAmount ? formatCurrency(Number(topupAmount)) : ""}`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteUser} onOpenChange={open => { if (!open) setDeleteUser(null); }}>
        <DialogContent className="w-[95vw] max-w-sm rounded-2xl p-6">
          <DialogHeader><DialogTitle className="text-red-600 flex items-center gap-2"><Trash2 className="w-5 h-5" /> Delete User?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground mt-2">Are you sure you want to permanently delete <strong>"{deleteUser?.name || deleteUser?.phone}"</strong>? This cannot be undone.</p>
          <div className="flex gap-3 mt-6">
            <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setDeleteUser(null)}>Cancel</Button>
            <Button variant="destructive" className="flex-1 rounded-xl gap-2" onClick={handleDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              {deleteMutation.isPending ? "Deleting..." : "Delete User"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {activityUser && <UserActivityModal userId={activityUser.id} userName={activityUser.name || activityUser.phone} user={activityUser} onClose={() => setActivityUser(null)} />}

      {securityUser && <SecurityModal user={securityUser} onClose={() => setSecurityUser(null)} />}

      {/* KYC Document Modal */}
      {kycUser && <KycDocModal user={kycUser} onClose={() => setKycUser(null)} />}
    </PullToRefresh>
  );
}
