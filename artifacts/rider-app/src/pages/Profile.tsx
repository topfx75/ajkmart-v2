import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Bell, MapPin, Circle, Bike, User, Landmark, Home, Wallet,
  ClipboardList, BarChart2, Pencil, Star, Rocket, Zap, Gem,
  Shield, Clock, CheckCircle, AlertTriangle, Lightbulb,
  CreditCard, Phone, Mail, Facebook, Instagram, MessageCircle,
  FileText, Lock, HelpCircle, Info, LogOut, RefreshCcw,
  ChevronRight, Award, TrendingUp, Target, Eye, EyeOff, X,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { usePlatformConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { LANGUAGE_OPTIONS, tDual, type Language, type TranslationKey } from "@workspace/i18n";

const fc = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;
const fd = (d: string | Date) => new Date(d).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });

const CITIES   = ["Muzaffarabad","Mirpur","Rawalakot","Bagh","Kotli","Bhimber","Jhelum","Rawalpindi","Islamabad","Other"];
const BANKS    = ["EasyPaisa","JazzCash","MCB","HBL","UBL","Meezan Bank","Bank Alfalah","NBP","Allied Bank","Other"];
const VEHICLES = ["Bike / Motorcycle","Car","Rickshaw / QingQi","Bicycle","On Foot"];

const INPUT  = "w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-400 focus:ring-2 focus:ring-green-100 focus:bg-white transition-all";
const SELECT = "w-full h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-400 focus:ring-2 focus:ring-green-100 appearance-none transition-all";
const LABEL  = "text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block";

type EditSection = "personal" | "vehicle" | "bank" | null;

type ProfilePayload = {
  name?: string; email?: string; cnic?: string; city?: string;
  address?: string; emergencyContact?: string;
  vehicleType?: string; vehiclePlate?: string;
  bankName?: string; bankAccount?: string; bankAccountTitle?: string;
};

function SectionCard({
  icon, title, subtitle, editLabel, isEditing, onToggleEdit, children,
}: {
  icon: React.ReactElement; title: string; subtitle: string;
  editLabel?: string; isEditing: boolean; onToggleEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden transition-all">
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-green-50 rounded-xl flex items-center justify-center">{icon}</div>
          <div>
            <p className="font-bold text-gray-900 text-[15px]">{title}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p>
          </div>
        </div>
        <button onClick={onToggleEdit}
          className={`text-sm font-bold py-1.5 px-3 rounded-xl transition-all flex items-center gap-1.5 ${
            isEditing ? "bg-gray-100 text-gray-600" : "bg-green-50 text-green-600 active:bg-green-100"
          }`}>
          {isEditing ? <><X size={13}/> Cancel</> : <><Pencil size={12}/> {editLabel || "Edit"}</>}
        </button>
      </div>
      <div className="border-t border-gray-50">{children}</div>
    </div>
  );
}

function InfoRow({ label, value, empty = "Not set", icon }: { label: string; value?: string | null; empty?: string; icon?: React.ReactElement }) {
  return (
    <div className="flex justify-between items-center py-3 border-b border-gray-50 last:border-0 gap-3 px-5">
      <span className="text-xs text-gray-400 font-semibold flex items-center gap-1.5 flex-shrink-0">
        {icon}{label}
      </span>
      <span className={`text-sm font-semibold text-right ${value ? "text-gray-800" : "text-gray-300 italic text-xs"}`}>
        {value || empty}
      </span>
    </div>
  );
}

function CircularProgress({ pct }: { pct: number }) {
  const r = 28, c = 2 * Math.PI * r;
  return (
    <div className="relative w-[72px] h-[72px] flex-shrink-0">
      <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#e5e7eb" strokeWidth="5"/>
        <circle cx="32" cy="32" r={r} fill="none"
          stroke={pct >= 80 ? "#10b981" : pct >= 50 ? "#f59e0b" : "#ef4444"}
          strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-sm font-extrabold ${pct >= 80 ? "text-green-600" : pct >= 50 ? "text-amber-500" : "text-red-500"}`}>
          {pct}%
        </span>
      </div>
    </div>
  );
}

type QuickLink = { href: string; icon: React.ReactElement; label: string; badge?: number; desc?: string };

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
  const T = (key: TranslationKey) => tDual(key, language);

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

  const totalDeliveries = user?.stats?.totalDeliveries || 0;
  const totalEarnings = user?.stats?.totalEarnings || 0;
  const rating = user?.stats?.rating || 5.0;

  const quickLinks: QuickLink[] = [
    { href: "/",              icon: <Home size={18} className="text-green-600"/>,          label: T("dashboard"),     desc: T("trackActivity")     },
    { href: "/wallet",        icon: <Wallet size={18} className="text-emerald-600"/>,      label: T("wallet"),        desc: T("transactions")      },
    { href: "/notifications", icon: <Bell size={18} className="text-blue-600"/>,           label: T("notifications"), badge: unread },
    { href: "/history",       icon: <ClipboardList size={18} className="text-purple-600"/>,label: T("myOrders"),      desc: T("pastOrders")        },
    { href: "/earnings",      icon: <BarChart2 size={18} className="text-amber-600"/>,     label: T("yourEarnings"),  desc: T("transactionHistory") },
  ];

  const achievements = [
    totalDeliveries >= 1   && { icon: <Rocket size={12}/>, label: T("firstDeliveryBadge"),  bg: "bg-blue-100",   text: "text-blue-700"   },
    totalDeliveries >= 50  && { icon: <Zap size={12}/>,    label: "50+ " + T("deliveriesLabel"), bg: "bg-green-100",  text: "text-green-700"  },
    totalDeliveries >= 100 && { icon: <Gem size={12}/>,    label: T("centuryRiderBadge"),    bg: "bg-purple-100", text: "text-purple-700" },
    totalEarnings >= 10000 && { icon: <CreditCard size={12}/>, label: "Rs. 10K+",            bg: "bg-orange-100", text: "text-orange-700" },
    rating >= 4.8          && { icon: <Star size={12}/>,   label: T("topRatedBadge"),        bg: "bg-yellow-100", text: "text-yellow-700" },
  ].filter(Boolean) as { icon: React.ReactElement; label: string; bg: string; text: string }[];

  return (
    <div className="bg-gray-50 pb-24 min-h-screen">

      {/* ══ HEADER ══ */}
      <div className="bg-gradient-to-br from-green-600 via-emerald-600 to-teal-700 px-5 pt-12 pb-28 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.07]">
          <div className="absolute top-0 right-0 w-56 h-56 bg-white rounded-full -translate-y-1/3 translate-x-1/4"/>
          <div className="absolute bottom-0 left-0 w-40 h-40 bg-white rounded-full translate-y-1/3 -translate-x-1/4"/>
        </div>
        <div className="relative flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">{T("myAccountTitle")}</h1>
            <p className="text-green-200 text-sm mt-0.5">{T("riderProfileSettings")}</p>
          </div>
          <div className="flex gap-2">
            <Link href="/notifications" className="relative h-10 w-10 flex items-center justify-center bg-white/15 backdrop-blur-sm text-white rounded-xl border border-white/10">
              <Bell size={18}/>
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-extrabold rounded-full w-[18px] h-[18px] flex items-center justify-center shadow-sm">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
            <button onClick={logout} className="h-10 px-4 bg-white/15 backdrop-blur-sm text-white text-sm font-bold rounded-xl border border-white/10 active:bg-white/25 transition-colors">
              {T("logout")}
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 -mt-20 space-y-4">

        {/* ══ RIDER IDENTITY CARD ══ */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-5 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-24 h-24 bg-green-50 rounded-full opacity-50"/>
          <div className="relative flex items-start gap-4">
            <div className="w-[68px] h-[68px] rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-3xl font-extrabold text-white flex-shrink-0 shadow-md">
              {(user?.name || user?.phone || "R")[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-extrabold text-gray-900 leading-tight">{user?.name || "Rider"}</h2>
              <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
                <Phone size={12}/> {user?.phone}
              </p>
              {user?.city && (
                <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                  <MapPin size={11}/> {user.city}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 ${
                  user?.isOnline ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                }`}>
                  <Circle size={7} className={user?.isOnline ? "fill-green-500 text-green-500" : "fill-gray-400 text-gray-400"}/>
                  {user?.isOnline ? "Online" : "Offline"}
                </span>
                <span className="text-[11px] bg-blue-50 text-blue-600 px-2.5 py-1 rounded-full font-bold flex items-center gap-1">
                  <Bike size={11}/> Rider
                </span>
                {user?.vehicleType && (
                  <span className="text-[11px] bg-emerald-50 text-emerald-600 px-2.5 py-1 rounded-full font-bold">
                    {user.vehicleType.split("/")[0].trim()}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ══ STATS + COMPLETION ══ */}
        <div className="flex gap-3">
          <div className="flex-1 grid grid-cols-2 gap-2">
            {[
              { label: T("deliveriesLabel"), value: String(totalDeliveries), icon: <ClipboardList size={16} className="text-blue-500"/>, bg: "bg-blue-50" },
              { label: T("earnedStat"),      value: fc(totalEarnings),       icon: <TrendingUp size={16} className="text-green-500"/>,   bg: "bg-green-50" },
              { label: T("walletStat"),      value: fc(Number(user?.walletBalance || 0)), icon: <Wallet size={16} className="text-amber-500"/>, bg: "bg-amber-50" },
              { label: T("ratingStat"),      value: rating.toFixed(1),       icon: <Star size={16} className="text-yellow-500"/>,        bg: "bg-yellow-50" },
            ].map(s => (
              <div key={s.label} className={`${s.bg} rounded-xl p-3 border border-white`}>
                <div className="flex items-center gap-1.5 mb-1">{s.icon}</div>
                <p className="text-[15px] font-extrabold text-gray-800 leading-tight">{s.value}</p>
                <p className="text-[10px] text-gray-500 mt-0.5 font-medium">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 flex flex-col items-center justify-center min-w-[96px]">
            <CircularProgress pct={completionPct}/>
            <p className="text-[10px] text-gray-400 font-bold mt-1 text-center leading-tight">{T("profileComplete")}</p>
          </div>
        </div>

        {completionPct < 100 && (
          <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5 flex items-center gap-2">
            <Target size={14} className="text-amber-500 flex-shrink-0"/>
            <p className="text-xs text-amber-700 font-medium">{T("profileCompleteMsg")}</p>
          </div>
        )}

        {/* ══ RATING & ACHIEVEMENTS ══ */}
        {totalDeliveries > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[15px] font-bold text-gray-900 flex items-center gap-2">
                <Award size={16} className="text-yellow-500"/> {T("achievementsLabel")}
              </p>
              <div className="flex items-center gap-0.5">
                {[1,2,3,4,5].map(s => (
                  <Star key={s} size={14} className={s <= Math.round(rating) ? "fill-yellow-400 text-yellow-400" : "text-gray-200 fill-gray-200"}/>
                ))}
                <span className="text-xs text-gray-500 ml-1 font-semibold">{rating.toFixed(1)}</span>
              </div>
            </div>
            {achievements.length > 0 ? (
              <div className="flex gap-2 flex-wrap">
                {achievements.map((a, i) => (
                  <span key={i} className={`text-[11px] font-bold ${a.bg} ${a.text} px-2.5 py-1.5 rounded-full flex items-center gap-1`}>
                    {a.icon} {a.label}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">Complete more deliveries to earn achievement badges!</p>
            )}
          </div>
        )}

        {/* ══ PERSONAL INFORMATION ══ */}
        <SectionCard
          icon={<User size={16} className="text-green-600"/>}
          title={T("personalInformation")}
          subtitle={T("identityContact")}
          isEditing={editing === "personal"}
          onToggleEdit={() => editing === "personal" ? setEditing(null) : startEdit("personal")}
        >
          {editing === "personal" ? (
            <div className="p-5 space-y-3.5">
              <div>
                <label className={LABEL}>{T("fullNameRequired")}</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder={T("enterFullName")} className={INPUT}/>
              </div>
              <div>
                <label className={LABEL}>{T("emailAddress")}</label>
                <input value={email} onChange={e => setEmail(e.target.value)} type="email" inputMode="email" placeholder="email@example.com" className={INPUT}/>
              </div>
              <div>
                <label className={LABEL}>{T("cnicNationalId")}</label>
                <input value={cnic} onChange={e => setCnic(e.target.value)} inputMode="numeric" placeholder="XXXXX-XXXXXXX-X" className={INPUT}/>
                <p className="text-[10px] text-gray-400 mt-1">Format: XXXXX-XXXXXXX-X</p>
              </div>
              <div>
                <label className={LABEL}>{T("cityLabel")}</label>
                <select value={city} onChange={e => setCity(e.target.value)} className={SELECT}>
                  <option value="">{T("selectCity")}</option>
                  {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL}>{T("homeAddress")}</label>
                <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Street, Area, City" className={INPUT}/>
              </div>
              <div>
                <label className={LABEL}>{T("emergencyContactLabel")}</label>
                <input value={emergency} onChange={e => setEmergency(e.target.value)} inputMode="tel" placeholder="03XX-XXXXXXX" className={INPUT}/>
              </div>
              <button onClick={() => saveSection("personal")} disabled={saving}
                className="w-full h-12 bg-green-600 text-white font-bold rounded-xl disabled:opacity-60 flex items-center justify-center gap-2 active:bg-green-700 transition-colors shadow-sm">
                {saving ? <><RefreshCcw size={15} className="animate-spin"/> {T("saving")}</> : <><CheckCircle size={15}/> {T("saveChangesBtn")}</>}
              </button>
            </div>
          ) : (
            <div className="py-1">
              <InfoRow label={T("fullName")}            value={user?.name}             icon={<User size={11} className="text-gray-300"/>}/>
              <InfoRow label={T("phoneNumber")}         value={user?.phone}            icon={<Phone size={11} className="text-gray-300"/>}/>
              <InfoRow label={T("emailAddress")}        value={user?.email}            icon={<Mail size={11} className="text-gray-300"/>}/>
              <InfoRow label={T("cnicNationalId")}      value={user?.cnic}             icon={<FileText size={11} className="text-gray-300"/>}/>
              <InfoRow label={T("cityLabel")}           value={user?.city}             icon={<MapPin size={11} className="text-gray-300"/>}/>
              <InfoRow label={T("homeAddress")}         value={user?.address}          icon={<Home size={11} className="text-gray-300"/>}/>
              <InfoRow label={T("emergencyContactLabel")} value={user?.emergencyContact} icon={<Phone size={11} className="text-gray-300"/>}/>
            </div>
          )}
        </SectionCard>

        {/* ══ VEHICLE DETAILS ══ */}
        <SectionCard
          icon={<Bike size={16} className="text-green-600"/>}
          title={T("vehicleDetails")}
          subtitle={T("yourDeliveryVehicle")}
          isEditing={editing === "vehicle"}
          onToggleEdit={() => editing === "vehicle" ? setEditing(null) : startEdit("vehicle")}
        >
          {editing === "vehicle" ? (
            <div className="p-5 space-y-3.5">
              <div>
                <label className={LABEL}>{T("vehicleTypeRequired")}</label>
                <select value={vehicleType} onChange={e => setVehicleType(e.target.value)} className={SELECT}>
                  <option value="">{T("selectVehicle")}</option>
                  {VEHICLES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL}>{T("registrationNumber")}</label>
                <input value={vehiclePlate} onChange={e => setVehiclePlate(e.target.value.toUpperCase())} placeholder="e.g. AJK 1234" className={`${INPUT} uppercase`}/>
              </div>
              <button onClick={() => saveSection("vehicle")} disabled={saving}
                className="w-full h-12 bg-green-600 text-white font-bold rounded-xl disabled:opacity-60 flex items-center justify-center gap-2 active:bg-green-700 transition-colors shadow-sm">
                {saving ? <><RefreshCcw size={15} className="animate-spin"/> {T("saving")}</> : <><CheckCircle size={15}/> {T("saveChangesBtn")}</>}
              </button>
            </div>
          ) : user?.vehicleType ? (
            <div className="py-1">
              <InfoRow label={T("vehicleSection")} value={user.vehicleType}  icon={<Bike size={11} className="text-gray-300"/>}/>
              <InfoRow label={T("vehiclePlateRequired")} value={user.vehiclePlate} icon={<FileText size={11} className="text-gray-300"/>}/>
            </div>
          ) : (
            <div className="py-8 text-center">
              <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-2">
                <Bike size={28} className="text-gray-200"/>
              </div>
              <p className="text-sm font-bold text-gray-600">{T("noVehicle")}</p>
              <p className="text-xs text-gray-400 mt-1">{T("addVehicleInfo")}</p>
              <button onClick={() => startEdit("vehicle")}
                className="mt-3 px-5 py-2 bg-green-50 text-green-600 font-bold rounded-xl text-sm active:bg-green-100 transition-colors">
                + {T("addVehicle")}
              </button>
            </div>
          )}
        </SectionCard>

        {/* ══ WITHDRAWAL ACCOUNT ══ */}
        <SectionCard
          icon={<Landmark size={16} className="text-green-600"/>}
          title={T("withdrawalAccount")}
          subtitle={T("bankMobileWallet")}
          isEditing={editing === "bank"}
          onToggleEdit={() => editing === "bank" ? setEditing(null) : startEdit("bank")}
        >
          {editing === "bank" ? (
            <div className="p-5 space-y-3.5">
              <div>
                <label className={LABEL}>{T("bankNameLabel")} *</label>
                <select value={bankName} onChange={e => setBankName(e.target.value)} className={SELECT}>
                  <option value="">{T("selectBank")}</option>
                  {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL}>{T("accountNoRequired")}</label>
                <input value={bankAccount} onChange={e => setBankAccount(e.target.value)} inputMode="numeric" placeholder="03XX-XXXXXXX or IBAN" className={INPUT}/>
              </div>
              <div>
                <label className={LABEL}>{T("accountTitle")} *</label>
                <input value={bankAccountTitle} onChange={e => setBankAccountTitle(e.target.value)} placeholder={T("enterFullName")} className={INPUT}/>
              </div>
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex gap-2">
                <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5"/>
                <p className="text-xs text-amber-700 font-medium">{T("bankMobileWallet")}</p>
              </div>
              <button onClick={() => saveSection("bank")} disabled={saving}
                className="w-full h-12 bg-green-600 text-white font-bold rounded-xl disabled:opacity-60 flex items-center justify-center gap-2 active:bg-green-700 transition-colors shadow-sm">
                {saving ? <><RefreshCcw size={15} className="animate-spin"/> {T("saving")}</> : <><CheckCircle size={15}/> {T("saveChangesBtn")}</>}
              </button>
            </div>
          ) : user?.bankName ? (
            <div>
              <div className="mx-5 my-3 flex items-center gap-3 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-3.5 border border-green-100">
                <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm">
                  <Landmark size={20} className="text-green-600"/>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-gray-800 text-sm">{user.bankName}</p>
                  <p className="text-xs text-gray-500 font-mono">{user.bankAccount}</p>
                </div>
                <span className="text-[10px] bg-green-100 text-green-700 font-bold px-2 py-1 rounded-full flex items-center gap-0.5">
                  <CheckCircle size={10}/> {T("activeVerified")}
                </span>
              </div>
              <div className="py-1">
                <InfoRow label={T("accountTitle")} value={user.bankAccountTitle} icon={<User size={11} className="text-gray-300"/>}/>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center">
              <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-2">
                <Landmark size={28} className="text-gray-200"/>
              </div>
              <p className="text-sm font-bold text-gray-600">{T("noWithdrawalAccount")}</p>
              <p className="text-xs text-gray-400 mt-1">{T("addVehicleInfo")}</p>
              <button onClick={() => startEdit("bank")}
                className="mt-3 px-5 py-2 bg-green-50 text-green-600 font-bold rounded-xl text-sm active:bg-green-100 transition-colors">
                + {T("addAccount")}
              </button>
            </div>
          )}
        </SectionCard>

        {/* ══ QUICK LINKS ══ */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3.5">
            <p className="font-bold text-gray-900 text-[15px] flex items-center gap-2"><Zap size={15} className="text-amber-500"/> {T("quickNavigation")}</p>
          </div>
          <div className="border-t border-gray-50">
            {quickLinks.map(item => (
              <Link key={item.href} href={item.href}
                className="flex items-center gap-3.5 px-5 py-3.5 border-b border-gray-50 last:border-0 active:bg-gray-50 transition-colors">
                <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center flex-shrink-0">{item.icon}</div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold text-gray-800 block">{item.label}</span>
                  {item.desc && <span className="text-[11px] text-gray-400">{item.desc}</span>}
                </div>
                {(item.badge ?? 0) > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-extrabold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5">
                    {item.badge}
                  </span>
                )}
                <ChevronRight size={16} className="text-gray-300"/>
              </Link>
            ))}
          </div>
        </div>

        {/* ══ SECURITY ══ */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3.5">
            <p className="font-bold text-gray-900 text-[15px] flex items-center gap-2"><Shield size={15} className="text-blue-500"/> {T("securitySession")}</p>
          </div>
          <div className="border-t border-gray-50 py-1">
            <InfoRow label={T("memberSince")} value={user?.createdAt ? fd(user.createdAt) : "—"} icon={<Clock size={11} className="text-gray-300"/>}/>
            <InfoRow label={T("lastLogin")}   value={user?.lastLoginAt ? fd(user.lastLoginAt) : "Now"} icon={<Clock size={11} className="text-gray-300"/>}/>
            <InfoRow label={T("statusLabel")} value={T("activeVerified")} icon={<CheckCircle size={11} className="text-green-400"/>}/>
          </div>
          <div className="px-5 pb-4">
            <div className="bg-blue-50 rounded-xl p-3 flex gap-2 border border-blue-100">
              <Lock size={14} className="text-blue-500 flex-shrink-0 mt-0.5"/>
              <p className="text-xs text-blue-700 font-medium">Your account is secured with encrypted OTP authentication. All session data is protected.</p>
            </div>
          </div>
        </div>

        {/* ══ PAYOUT POLICY ══ */}
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-100 rounded-2xl p-5">
          <p className="font-bold text-green-800 text-[15px] mb-3 flex items-center gap-2"><Lightbulb size={15}/> {T("payoutPolicyLabel")}</p>
          <div className="space-y-2.5">
            {[
              { icon: <CheckCircle size={13}/>, text: `${riderKeepPct}% earnings — ${100 - riderKeepPct}% platform fee` },
              { icon: <CreditCard size={13}/>,  text: `Minimum withdrawal: Rs. ${config.rider?.minPayout ?? 500}` },
              { icon: <Clock size={13}/>,       text: "Processed in 24–48 hours by admin" },
              { icon: <Lock size={13}/>,        text: "CNIC + vehicle details required for verification" },
            ].map((p, i) => (
              <div key={i} className="flex gap-2.5 items-start text-xs text-green-700">
                <span className="text-green-500 mt-0.5">{p.icon}</span>
                <span className="font-medium">{p.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ══ LANGUAGE PICKER ══ */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <button
            onClick={() => setShowLangPicker(v => !v)}
            className="w-full flex items-center justify-between px-5 py-4 active:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center text-xl">🌐</div>
              <div className="text-left">
                <div className="text-sm font-bold text-gray-800">Language / زبان</div>
                <div className="text-xs text-gray-400">{LANGUAGE_OPTIONS.find(o => o.value === language)?.label || "Select Language"}</div>
              </div>
            </div>
            <ChevronRight size={16} className={`text-gray-400 transition-transform ${showLangPicker ? "rotate-90" : ""}`}/>
          </button>
          {showLangPicker && (
            <div className="border-t border-gray-100 p-3.5 space-y-2">
              {LANGUAGE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  disabled={langLoading}
                  onClick={async () => {
                    await setLanguage(opt.value as Language);
                    setShowLangPicker(false);
                    showToast("Language save ho gayi!");
                  }}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all text-left ${
                    language === opt.value
                      ? "border-green-400 bg-green-50"
                      : "border-gray-100 bg-gray-50 active:border-green-200"
                  }`}
                >
                  <div>
                    <div className={`text-sm font-semibold ${language === opt.value ? "text-green-700" : "text-gray-700"}`}>{opt.label}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{opt.nativeLabel}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {opt.rtl && <span className="text-[10px] bg-amber-100 text-amber-600 font-bold px-1.5 py-0.5 rounded">RTL</span>}
                    {language === opt.value && <CheckCircle size={18} className="text-green-500"/>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ══ LOGOUT ══ */}
        <button onClick={logout} className="w-full h-12 border-2 border-red-200 text-red-500 font-bold rounded-xl active:bg-red-50 transition-colors text-sm flex items-center justify-center gap-2">
          <LogOut size={16}/> Logout from This Device
        </button>

        {/* ══ FOOTER ══ */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
          <p className="text-center text-xs text-gray-500 leading-relaxed font-medium">
            {config.platform.appName} Rider Portal · Contact:{" "}
            <a href={`tel:${config.platform.supportPhone}`} className="text-green-600 font-semibold">{config.platform.supportPhone}</a>
          </p>
          {config.platform.supportHours && (
            <p className="text-xs text-gray-400 text-center flex items-center justify-center gap-1"><Clock size={11}/> {config.platform.supportHours}</p>
          )}
          {config.platform.supportEmail && (
            <p className="text-xs text-gray-500 text-center flex items-center justify-center gap-1">
              <Mail size={11}/>
              <a href={`mailto:${config.platform.supportEmail}`} className="text-green-600 hover:text-green-800">{config.platform.supportEmail}</a>
            </p>
          )}
          {(config.platform.socialFacebook || config.platform.socialInstagram) && (
            <div className="flex gap-3 justify-center pt-1">
              {config.platform.socialFacebook && (
                <a href={config.platform.socialFacebook} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 flex items-center gap-1 font-medium">
                  <Facebook size={13}/> Facebook
                </a>
              )}
              {config.platform.socialInstagram && (
                <a href={config.platform.socialInstagram} target="_blank" rel="noopener noreferrer" className="text-xs text-pink-600 flex items-center gap-1 font-medium">
                  <Instagram size={13}/> Instagram
                </a>
              )}
            </div>
          )}
          {(config.content.tncUrl || config.content.privacyUrl || config.content.refundPolicyUrl || config.content.faqUrl || config.content.aboutUrl || config.features.chat) && (
            <div className="flex flex-wrap gap-x-3 gap-y-1.5 justify-center pt-1">
              {config.content.tncUrl && (
                <a href={config.content.tncUrl} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-green-600 underline underline-offset-2 flex items-center gap-0.5"><FileText size={10}/> Terms</a>
              )}
              {config.content.privacyUrl && (
                <a href={config.content.privacyUrl} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-green-600 underline underline-offset-2 flex items-center gap-0.5"><Lock size={10}/> Privacy</a>
              )}
              {config.content.refundPolicyUrl && (
                <a href={config.content.refundPolicyUrl} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-green-600 underline underline-offset-2 flex items-center gap-0.5"><RefreshCcw size={10}/> Refund</a>
              )}
              {config.content.faqUrl && (
                <a href={config.content.faqUrl} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-green-600 underline underline-offset-2 flex items-center gap-0.5"><HelpCircle size={10}/> FAQs</a>
              )}
              {config.content.aboutUrl && (
                <a href={config.content.aboutUrl} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-green-600 underline underline-offset-2 flex items-center gap-0.5"><Info size={10}/> About</a>
              )}
              {config.features.chat && (
                <a href={`https://wa.me/${config.platform.supportPhone.replace(/^0/, "92")}`} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-green-600 underline underline-offset-2 flex items-center gap-0.5"><MessageCircle size={10}/> {config.content.supportMsg || "Support"}</a>
              )}
            </div>
          )}
          <p className="text-[10px] text-gray-400 text-center">{config.platform.businessAddress}</p>
        </div>
      </div>

      {/* ══ TOAST ══ */}
      {toast && (
        <div className="fixed top-0 left-0 right-0 z-50 flex justify-center pointer-events-none"
          style={{ paddingTop: "calc(env(safe-area-inset-top,0px) + 12px)", paddingLeft: "16px", paddingRight: "16px" }}>
          <div className="bg-gray-900 text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-2xl max-w-sm w-full text-center pointer-events-auto">{toast}</div>
        </div>
      )}
    </div>
  );
}
