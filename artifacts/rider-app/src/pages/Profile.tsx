import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Bell, MapPin, Circle, Bike, User, Landmark, Home, Wallet,
  ClipboardList, BarChart2, Pencil, Star, Rocket, Zap, Gem,
  Shield, Clock, CheckCircle, AlertTriangle, Lightbulb,
  CreditCard, Phone, Mail, Facebook, Instagram, MessageCircle,
  FileText, Lock, HelpCircle, Info, LogOut, RefreshCcw,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { usePlatformConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { LANGUAGE_OPTIONS, type Language } from "@workspace/i18n";

const fc = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;
const fd = (d: string | Date) => new Date(d).toLocaleDateString("en-PK", { day:"numeric", month:"long", year:"numeric" });

const CITIES   = ["Muzaffarabad","Mirpur","Rawalakot","Bagh","Kotli","Bhimber","Jhelum","Rawalpindi","Islamabad","Other"];
const BANKS    = ["EasyPaisa","JazzCash","MCB","HBL","UBL","Meezan Bank","Bank Alfalah","NBP","Allied Bank","Other"];
const VEHICLES = ["Bike / Motorcycle","Car","Rickshaw / QingQi","Bicycle","On Foot"];

const INPUT  = "w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-400 focus:bg-white transition-colors";
const SELECT = "w-full h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-400 appearance-none";
const LABEL  = "text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5 block";

type EditSection = "personal" | "vehicle" | "bank" | null;

type ProfilePayload = {
  name?: string; email?: string; cnic?: string; city?: string;
  address?: string; emergencyContact?: string;
  vehicleType?: string; vehiclePlate?: string;
  bankName?: string; bankAccount?: string; bankAccountTitle?: string;
};

function InfoRow({ label, value, empty = "Not set" }: { label: string; value?: string | null; empty?: string }) {
  return (
    <div className="flex justify-between items-start py-2.5 border-b border-gray-50 last:border-0 gap-3">
      <span className="text-xs text-gray-400 font-semibold flex-shrink-0">{label}</span>
      <span className={`text-sm font-semibold text-right ${value ? "text-gray-800" : "text-gray-300 italic text-xs"}`}>{value || empty}</span>
    </div>
  );
}

type QuickLink = { href: string; icon: React.ReactElement; label: string; badge?: number };

export default function Profile() {
  const { user, logout, refreshUser } = useAuth();
  const { config } = usePlatformConfig();
  const riderKeepPct = config.rider?.keepPct ?? config.finance.riderEarningPct ?? 80;

  const { data: notifData } = useQuery({
    queryKey: ["rider-notifs-count"],
    queryFn: () => api.getNotifications(),
    refetchInterval: 60000,
    staleTime: 30000,
  });
  const unread: number = notifData?.unread || 0;

  const [editing, setEditing]   = useState<EditSection>(null);
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState("");
  const [showLangPicker, setShowLangPicker] = useState(false);

  const { language, setLanguage, loading: langLoading } = useLanguage();

  const [name, setName]             = useState(user?.name || "");
  const [email, setEmail]           = useState(user?.email || "");
  const [cnic, setCnic]             = useState(user?.cnic || "");
  const [city, setCity]             = useState(user?.city || "");
  const [address, setAddress]       = useState(user?.address || "");
  const [emergency, setEmergency]   = useState(user?.emergencyContact || "");

  const [vehicleType, setVehicleType]   = useState(user?.vehicleType || "");
  const [vehiclePlate, setVehiclePlate] = useState(user?.vehiclePlate || "");

  const [bankName, setBankName]               = useState(user?.bankName || "");
  const [bankAccount, setBankAccount]         = useState(user?.bankAccount || "");
  const [bankAccountTitle, setBankAccountTitle] = useState(user?.bankAccountTitle || "");

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const startEdit = (section: EditSection) => {
    if (section === "personal") {
      setName(user?.name || ""); setEmail(user?.email || ""); setCnic(user?.cnic || "");
      setCity(user?.city || ""); setAddress(user?.address || ""); setEmergency(user?.emergencyContact || "");
    } else if (section === "vehicle") {
      setVehicleType(user?.vehicleType || ""); setVehiclePlate(user?.vehiclePlate || "");
    } else if (section === "bank") {
      setBankName(user?.bankName || ""); setBankAccount(user?.bankAccount || ""); setBankAccountTitle(user?.bankAccountTitle || "");
    }
    setEditing(section);
  };

  const saveSection = async (section: EditSection) => {
    setSaving(true);
    try {
      const payload: ProfilePayload = {};
      if (section === "personal") {
        if (cnic && cnic.trim()) {
          const cnicPattern = /^\d{5}-\d{7}-\d{1}$/;
          if (!cnicPattern.test(cnic.trim())) {
            showToast("CNIC format galat hai — sahi format: XXXXX-XXXXXXX-X");
            setSaving(false);
            return;
          }
        }
        Object.assign(payload, { name, email, cnic: cnic.trim(), city, address, emergencyContact: emergency });
      }
      if (section === "vehicle")  Object.assign(payload, { vehicleType, vehiclePlate });
      if (section === "bank")     Object.assign(payload, { bankName, bankAccount, bankAccountTitle });
      await api.updateProfile(payload);
      await refreshUser();
      setEditing(null);
      showToast("Changes saved successfully!");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      showToast(msg);
    }
    setSaving(false);
  };

  const completionFields = [user?.name, user?.cnic, user?.city, user?.vehicleType, user?.vehiclePlate, user?.bankName];
  const completionPct    = Math.round((completionFields.filter(Boolean).length / completionFields.length) * 100);

  const quickLinks: QuickLink[] = [
    { href: "/",              icon: <Home size={16}/>,          label: "Home & Dashboard"    },
    { href: "/wallet",        icon: <Wallet size={16}/>,        label: "Wallet & Withdrawals" },
    { href: "/notifications", icon: <Bell size={16}/>,          label: "Notifications", badge: unread },
    { href: "/history",       icon: <ClipboardList size={16}/>, label: "Delivery History"    },
    { href: "/earnings",      icon: <BarChart2 size={16}/>,     label: "Earnings Report"     },
  ];

  return (
    <div className="bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-br from-green-600 to-emerald-700 px-5 pt-12 pb-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-white">My Account</h1>
          <div className="flex gap-2">
            <Link href="/notifications" className="relative h-9 w-9 flex items-center justify-center bg-white/20 text-white rounded-xl">
              <Bell size={18}/>
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-extrabold rounded-full w-4 h-4 flex items-center justify-center">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
            <button onClick={logout} className="h-9 px-4 bg-white/20 text-white text-sm font-bold rounded-xl">Logout</button>
          </div>
        </div>
        <p className="text-green-200 text-sm">Rider profile & account settings</p>
      </div>

      <div className="px-4 -mt-2 space-y-4">

        {/* Rider Identity Card */}
        <div className="bg-white rounded-3xl shadow-md p-5 flex items-start gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-3xl font-extrabold text-white flex-shrink-0">
            {(user?.name || user?.phone || "R")[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-extrabold text-gray-900 leading-tight">{user?.name || "Rider"}</h2>
            <p className="text-sm text-gray-500">{user?.phone}</p>
            {user?.city && (
              <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                <MapPin size={11}/> {user.city}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${user?.isOnline ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                <Circle size={8} className={user?.isOnline ? "fill-green-500 text-green-500" : "fill-gray-400 text-gray-400"}/>
                {user?.isOnline ? "Online" : "Offline"}
              </span>
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                <Bike size={11}/> Rider
              </span>
              {user?.vehicleType && (
                <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">{user.vehicleType.split("/")[0].trim()}</span>
              )}
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Deliveries",   value: String(user?.stats?.totalDeliveries || 0), icon: <ClipboardList size={18} className="text-blue-600"/>,  bg: "bg-blue-50"   },
            { label: "Total Earned", value: fc(user?.stats?.totalEarnings || 0),        icon: <CreditCard size={18} className="text-green-600"/>,    bg: "bg-green-50"  },
            { label: "Wallet",       value: fc(Number(user?.walletBalance || 0)),        icon: <Wallet size={18} className="text-orange-600"/>,       bg: "bg-orange-50" },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-2xl p-3 text-center`}>
              <div className="flex justify-center mb-1">{s.icon}</div>
              <p className="text-sm font-extrabold text-gray-800 leading-tight">{s.value}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Rating & Achievements */}
        {((user?.stats?.totalDeliveries || 0) > 0) && (
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <p className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-1.5">
              <Star size={15} className="text-yellow-400"/> Rating &amp; Achievements
            </p>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="flex items-center gap-0.5 justify-center">
                  {[1,2,3,4,5].map(s => (
                    <Star key={s} size={20} className={s <= Math.round(user?.stats?.rating || 5) ? "fill-yellow-400 text-yellow-400" : "text-gray-200 fill-gray-200"}/>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-1 font-medium">{(user?.stats?.rating || 5.0).toFixed(1)} / 5.0</p>
              </div>
              <div className="flex-1 flex gap-2 flex-wrap">
                {(user?.stats?.totalDeliveries || 0) >= 1 && (
                  <span className="text-xs font-bold bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full flex items-center gap-1"><Rocket size={11}/> First Delivery</span>
                )}
                {(user?.stats?.totalDeliveries || 0) >= 50 && (
                  <span className="text-xs font-bold bg-green-100 text-green-700 px-2.5 py-1 rounded-full flex items-center gap-1"><Zap size={11}/> 50 Deliveries</span>
                )}
                {(user?.stats?.totalDeliveries || 0) >= 100 && (
                  <span className="text-xs font-bold bg-purple-100 text-purple-700 px-2.5 py-1 rounded-full flex items-center gap-1"><Gem size={11}/> Century Rider</span>
                )}
                {(user?.stats?.totalEarnings || 0) >= 10000 && (
                  <span className="text-xs font-bold bg-orange-100 text-orange-700 px-2.5 py-1 rounded-full flex items-center gap-1"><CreditCard size={11}/> Rs. 10K+ Earned</span>
                )}
                {(user?.stats?.rating || 5) >= 4.8 && (
                  <span className="text-xs font-bold bg-yellow-100 text-yellow-700 px-2.5 py-1 rounded-full flex items-center gap-1"><Star size={11}/> Top Rated</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Profile Completion */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold text-gray-700">Profile Completion</p>
            <span className={`text-sm font-extrabold ${completionPct >= 80 ? "text-green-600" : completionPct >= 50 ? "text-orange-500" : "text-red-500"}`}>{completionPct}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
            <div className="h-2 rounded-full bg-gradient-to-r from-green-400 to-emerald-500 transition-all" style={{ width: `${completionPct}%` }}/>
          </div>
          {completionPct < 100 && <p className="text-xs text-gray-400 mt-2">Complete your profile to build trust with customers</p>}
        </div>

        {/* Personal Information */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <div>
              <p className="font-bold text-gray-800 text-sm flex items-center gap-1.5"><User size={14}/> Personal Information</p>
              <p className="text-xs text-gray-400 mt-0.5">Identity &amp; contact details</p>
            </div>
            <button onClick={() => editing === "personal" ? setEditing(null) : startEdit("personal")}
              className="text-green-600 text-sm font-bold py-1 flex items-center gap-1">
              {editing === "personal" ? "Cancel" : <><Pencil size={13}/> Edit</>}
            </button>
          </div>

          {editing === "personal" ? (
            <div className="p-4 space-y-3">
              <div>
                <label className={LABEL}>Full Name *</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" className={INPUT}/>
              </div>
              <div>
                <label className={LABEL}>Email Address</label>
                <input value={email} onChange={e => setEmail(e.target.value)} type="email" inputMode="email" placeholder="email@example.com" className={INPUT}/>
              </div>
              <div>
                <label className={LABEL}>CNIC / National ID</label>
                <input value={cnic} onChange={e => setCnic(e.target.value)} inputMode="numeric" placeholder="XXXXX-XXXXXXX-X" className={INPUT}/>
                <p className="text-[10px] text-gray-400 mt-1">Format: XXXXX-XXXXXXX-X (dashes ke saath) — account verification ke liye zaroori hai</p>
              </div>
              <div>
                <label className={LABEL}>City</label>
                <select value={city} onChange={e => setCity(e.target.value)} className={SELECT}>
                  <option value="">Select city</option>
                  {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL}>Home Address</label>
                <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Street, Area, City" className={INPUT}/>
              </div>
              <div>
                <label className={LABEL}>Emergency Contact Number</label>
                <input value={emergency} onChange={e => setEmergency(e.target.value)} inputMode="tel" placeholder="03XX-XXXXXXX (family member)" className={INPUT}/>
                <p className="text-[10px] text-gray-400 mt-1">In case of emergency during delivery</p>
              </div>
              <button onClick={() => saveSection("personal")} disabled={saving}
                className="w-full h-12 bg-green-600 text-white font-bold rounded-2xl disabled:opacity-60 flex items-center justify-center gap-2">
                {saving ? <><RefreshCcw size={15} className="animate-spin"/> Saving...</> : <><CheckCircle size={15}/> Save Personal Info</>}
              </button>
            </div>
          ) : (
            <div className="px-4 py-2">
              <InfoRow label="Full Name"  value={user?.name}             />
              <InfoRow label="Phone"      value={user?.phone}            />
              <InfoRow label="Email"      value={user?.email}            />
              <InfoRow label="CNIC"       value={user?.cnic}             />
              <InfoRow label="City"       value={user?.city}             />
              <InfoRow label="Address"    value={user?.address}          />
              <InfoRow label="Emergency"  value={user?.emergencyContact} />
            </div>
          )}
        </div>

        {/* Vehicle Details */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <div>
              <p className="font-bold text-gray-800 text-sm flex items-center gap-1.5"><Bike size={14}/> Vehicle Details</p>
              <p className="text-xs text-gray-400 mt-0.5">Your delivery vehicle info</p>
            </div>
            <button onClick={() => editing === "vehicle" ? setEditing(null) : startEdit("vehicle")}
              className="text-green-600 text-sm font-bold py-1 flex items-center gap-1">
              {editing === "vehicle" ? "Cancel" : <><Pencil size={13}/> Edit</>}
            </button>
          </div>

          {editing === "vehicle" ? (
            <div className="p-4 space-y-3">
              <div>
                <label className={LABEL}>Vehicle Type *</label>
                <select value={vehicleType} onChange={e => setVehicleType(e.target.value)} className={SELECT}>
                  <option value="">Select vehicle type</option>
                  {VEHICLES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL}>Registration Number (Plate)</label>
                <input value={vehiclePlate} onChange={e => setVehiclePlate(e.target.value.toUpperCase())} placeholder="e.g. AJK 1234" className={`${INPUT} uppercase`}/>
                <p className="text-[10px] text-gray-400 mt-1">As printed on your registration documents</p>
              </div>
              <button onClick={() => saveSection("vehicle")} disabled={saving}
                className="w-full h-12 bg-green-600 text-white font-bold rounded-2xl disabled:opacity-60 flex items-center justify-center gap-2">
                {saving ? <><RefreshCcw size={15} className="animate-spin"/> Saving...</> : <><CheckCircle size={15}/> Save Vehicle Info</>}
              </button>
            </div>
          ) : (
            <div className="px-4 py-2">
              {user?.vehicleType ? (
                <>
                  <InfoRow label="Vehicle Type"       value={user.vehicleType}  />
                  <InfoRow label="Registration No."   value={user.vehiclePlate} />
                </>
              ) : (
                <div className="py-6 text-center">
                  <Bike size={40} className="text-gray-200 mx-auto mb-2"/>
                  <p className="text-sm font-bold text-gray-600">No vehicle info added</p>
                  <p className="text-xs text-gray-400 mt-1">Add your vehicle details for identity verification</p>
                  <button onClick={() => startEdit("vehicle")}
                    className="mt-3 px-4 py-2 bg-green-50 text-green-600 font-bold rounded-xl text-sm">
                    + Add Vehicle
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bank / Withdrawal Account */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <div>
              <p className="font-bold text-gray-800 text-sm flex items-center gap-1.5"><Landmark size={14}/> Withdrawal Account</p>
              <p className="text-xs text-gray-400 mt-0.5">Bank or mobile wallet for payouts</p>
            </div>
            <button onClick={() => editing === "bank" ? setEditing(null) : startEdit("bank")}
              className="text-green-600 text-sm font-bold py-1 flex items-center gap-1">
              {editing === "bank" ? "Cancel" : <><Pencil size={13}/> Edit</>}
            </button>
          </div>

          {editing === "bank" ? (
            <div className="p-4 space-y-3">
              <div>
                <label className={LABEL}>Bank / Mobile Wallet *</label>
                <select value={bankName} onChange={e => setBankName(e.target.value)} className={SELECT}>
                  <option value="">Select bank or wallet</option>
                  {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL}>Account / Phone Number *</label>
                <input value={bankAccount} onChange={e => setBankAccount(e.target.value)} inputMode="numeric" placeholder="03XX-XXXXXXX or IBAN" className={INPUT}/>
              </div>
              <div>
                <label className={LABEL}>Account Holder Name *</label>
                <input value={bankAccountTitle} onChange={e => setBankAccountTitle(e.target.value)} placeholder="Full name as on account" className={INPUT}/>
              </div>
              <div className="bg-amber-50 rounded-xl p-3 flex gap-2">
                <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5"/>
                <p className="text-xs text-amber-700 font-medium">Ensure details match your bank records. Incorrect info may delay withdrawals.</p>
              </div>
              <button onClick={() => saveSection("bank")} disabled={saving}
                className="w-full h-12 bg-green-600 text-white font-bold rounded-2xl disabled:opacity-60 flex items-center justify-center gap-2">
                {saving ? <><RefreshCcw size={15} className="animate-spin"/> Saving...</> : <><CheckCircle size={15}/> Save Account Details</>}
              </button>
            </div>
          ) : (
            <div className="px-4 py-2">
              {user?.bankName ? (
                <>
                  <div className="flex items-center gap-3 bg-green-50 rounded-xl p-3 mb-3">
                    <Landmark size={24} className="text-green-600 flex-shrink-0"/>
                    <div>
                      <p className="font-bold text-gray-800 text-sm">{user.bankName}</p>
                      <p className="text-xs text-gray-500">{user.bankAccount}</p>
                      <p className="text-xs text-gray-500">{user.bankAccountTitle}</p>
                    </div>
                    <span className="ml-auto text-xs bg-green-100 text-green-700 font-bold px-2 py-0.5 rounded-full flex items-center gap-0.5">
                      <CheckCircle size={10}/> Set
                    </span>
                  </div>
                  <InfoRow label="Bank"          value={user.bankName}         />
                  <InfoRow label="Account No."   value={user.bankAccount}      />
                  <InfoRow label="Account Title" value={user.bankAccountTitle} />
                </>
              ) : (
                <div className="py-6 text-center">
                  <Landmark size={40} className="text-gray-200 mx-auto mb-2"/>
                  <p className="text-sm font-bold text-gray-600">No withdrawal account set</p>
                  <p className="text-xs text-gray-400 mt-1">Add your account to receive payouts</p>
                  <button onClick={() => startEdit("bank")}
                    className="mt-3 px-4 py-2 bg-green-50 text-green-600 font-bold rounded-xl text-sm">
                    + Add Account
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quick Links */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3.5 border-b border-gray-100">
            <p className="font-bold text-gray-800 text-sm flex items-center gap-1.5"><Zap size={14}/> Quick Links</p>
          </div>
          <div className="p-3 space-y-1">
            {quickLinks.map(item => (
              <Link key={item.href} href={item.href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-green-50 transition-colors relative">
                <span className="text-gray-500">{item.icon}</span>
                <span className="text-sm font-semibold text-gray-700">{item.label}</span>
                {(item.badge ?? 0) > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-extrabold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {item.badge}
                  </span>
                )}
                <span className="ml-auto text-gray-300 text-sm">›</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Security */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3.5 border-b border-gray-100">
            <p className="font-bold text-gray-800 text-sm flex items-center gap-1.5"><Shield size={14}/> Security &amp; Session</p>
          </div>
          <div className="px-4 py-2">
            <InfoRow label="Member Since" value={user?.createdAt ? fd(user.createdAt) : "—"}         />
            <InfoRow label="Last Login"   value={user?.lastLoginAt ? fd(user.lastLoginAt) : "Now"}   />
            <InfoRow label="Status"       value="Active & Verified"                                   />
            <div className="bg-blue-50 rounded-xl p-3 my-3 flex gap-2">
              <Lock size={14} className="text-blue-500 flex-shrink-0 mt-0.5"/>
              <p className="text-xs text-blue-700 font-medium">Your account is secured with encrypted OTP authentication. All session data is protected.</p>
            </div>
          </div>
        </div>

        {/* Payout Policy */}
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-100 rounded-2xl p-4">
          <p className="font-bold text-green-700 text-sm mb-2 flex items-center gap-1.5"><Lightbulb size={14}/> Payout Policy</p>
          <div className="space-y-2">
            {[
              { icon: <CheckCircle size={12} className="text-green-600 flex-shrink-0 mt-0.5"/>, text: `${riderKeepPct}% earnings — ${100 - riderKeepPct}% platform fee` },
              { icon: <CreditCard  size={12} className="text-green-600 flex-shrink-0 mt-0.5"/>, text: `Minimum withdrawal: Rs. ${config.rider?.minPayout ?? 500}` },
              { icon: <Clock       size={12} className="text-green-600 flex-shrink-0 mt-0.5"/>, text: "Processed in 24–48 hours by admin" },
              { icon: <Lock        size={12} className="text-green-600 flex-shrink-0 mt-0.5"/>, text: "CNIC + vehicle details required for verification" },
            ].map((p, i) => (
              <div key={i} className="flex gap-2 text-xs text-green-700">
                {p.icon}
                <span>{p.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Language Picker */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <button
            onClick={() => setShowLangPicker(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">🌐</span>
              <div className="text-left">
                <div className="text-sm font-bold text-gray-800">Language / زبان</div>
                <div className="text-xs text-gray-400">{LANGUAGE_OPTIONS.find(o => o.value === language)?.label || "Select Language"}</div>
              </div>
            </div>
            <span className="text-gray-400 text-sm">{showLangPicker ? "▲" : "▼"}</span>
          </button>
          {showLangPicker && (
            <div className="border-t border-gray-100 p-3 space-y-2">
              {LANGUAGE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  disabled={langLoading}
                  onClick={async () => {
                    await setLanguage(opt.value as Language);
                    setShowLangPicker(false);
                    setToast("Language save ho gayi!");
                    setTimeout(() => setToast(""), 2500);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border-2 transition-colors text-left ${
                    language === opt.value
                      ? "border-green-400 bg-green-50"
                      : "border-gray-100 bg-gray-50 hover:border-green-200"
                  }`}
                >
                  <div>
                    <div className={`text-sm font-semibold ${language === opt.value ? "text-green-700" : "text-gray-700"}`}>{opt.label}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{opt.nativeLabel}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {opt.rtl && <span className="text-xs bg-amber-100 text-amber-600 font-bold px-1.5 py-0.5 rounded">RTL</span>}
                    {language === opt.value && <span className="text-green-500 text-lg">✓</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <button onClick={logout} className="w-full h-12 border-2 border-red-200 text-red-500 font-bold rounded-2xl hover:bg-red-50 transition-colors text-sm flex items-center justify-center gap-2">
          <LogOut size={16}/> Logout from This Device
        </button>

        <div className="bg-gray-100 rounded-2xl p-4 space-y-3">
          <p className="text-center text-xs text-gray-500 leading-relaxed">
            {config.platform.appName} Rider Portal · Contact:{" "}
            <a href={`tel:${config.platform.supportPhone}`} className="text-green-600 font-semibold">{config.platform.supportPhone}</a>
          </p>
          {config.platform.supportHours && (
            <p className="text-xs text-gray-400 text-center flex items-center justify-center gap-1">
              <Clock size={11}/> {config.platform.supportHours}
            </p>
          )}
          {config.platform.supportEmail && (
            <p className="text-xs text-gray-500 text-center flex items-center justify-center gap-1">
              <Mail size={11}/>
              <a href={`mailto:${config.platform.supportEmail}`} className="text-green-600 hover:text-green-800">{config.platform.supportEmail}</a>
            </p>
          )}
          {(config.platform.socialFacebook || config.platform.socialInstagram) && (
            <div className="flex gap-3 justify-center">
              {config.platform.socialFacebook && (
                <a href={config.platform.socialFacebook} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
                  <Facebook size={12}/> Facebook
                </a>
              )}
              {config.platform.socialInstagram && (
                <a href={config.platform.socialInstagram} target="_blank" rel="noopener noreferrer" className="text-xs text-pink-600 hover:text-pink-800 flex items-center gap-1">
                  <Instagram size={12}/> Instagram
                </a>
              )}
            </div>
          )}
          {(config.content.tncUrl || config.content.privacyUrl || config.content.refundPolicyUrl || config.content.faqUrl || config.content.aboutUrl || config.features.chat) && (
            <div className="flex flex-wrap gap-2 justify-center">
              {config.content.tncUrl && (
                <a href={config.content.tncUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-green-600 underline underline-offset-2 hover:text-green-800 transition-colors flex items-center gap-1">
                  <FileText size={11}/> Terms of Service
                </a>
              )}
              {config.content.privacyUrl && (
                <a href={config.content.privacyUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-green-600 underline underline-offset-2 hover:text-green-800 transition-colors flex items-center gap-1">
                  <Lock size={11}/> Privacy Policy
                </a>
              )}
              {config.content.refundPolicyUrl && (
                <a href={config.content.refundPolicyUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-green-600 underline underline-offset-2 hover:text-green-800 transition-colors flex items-center gap-1">
                  <RefreshCcw size={11}/> Refund Policy
                </a>
              )}
              {config.content.faqUrl && (
                <a href={config.content.faqUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-green-600 underline underline-offset-2 hover:text-green-800 transition-colors flex items-center gap-1">
                  <HelpCircle size={11}/> Help &amp; FAQs
                </a>
              )}
              {config.content.aboutUrl && (
                <a href={config.content.aboutUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-green-600 underline underline-offset-2 hover:text-green-800 transition-colors flex items-center gap-1">
                  <Info size={11}/> About Us
                </a>
              )}
              {config.features.chat && (
                <a href={`https://wa.me/${config.platform.supportPhone.replace(/^0/, "92")}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-green-600 underline underline-offset-2 hover:text-green-800 transition-colors flex items-center gap-1">
                  <MessageCircle size={11}/> {config.content.supportMsg || "Live Support"}
                </a>
              )}
            </div>
          )}
          <p className="text-xs text-gray-400 text-center">{config.platform.businessAddress}</p>
        </div>
      </div>

      {toast && (
        <div className="fixed top-0 left-0 right-0 z-50 flex justify-center"
          style={{ paddingTop: "calc(env(safe-area-inset-top,0px) + 8px)", paddingLeft: "16px", paddingRight: "16px" }}>
          <div className="bg-gray-900 text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-2xl max-w-sm w-full text-center">{toast}</div>
        </div>
      )}
    </div>
  );
}
