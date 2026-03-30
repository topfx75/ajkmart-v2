import { useState, useCallback, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Bell, MapPin, Circle, Bike, User, Landmark, Home, Wallet,
  ClipboardList, BarChart2, Pencil, Star, Camera,
  Shield, Clock, CheckCircle, AlertTriangle,
  CreditCard, Phone, Mail, Facebook, Instagram, MessageCircle,
  FileText, Lock, HelpCircle, Info, LogOut, RefreshCcw,
  ChevronRight, ChevronDown,
  Languages, Settings,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { usePlatformConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";

const fc = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;

const CITIES   = ["Muzaffarabad","Mirpur","Rawalakot","Bagh","Kotli","Bhimber","Jhelum","Rawalpindi","Islamabad","Other"];
const BANKS    = ["EasyPaisa","JazzCash","MCB","HBL","UBL","Meezan Bank","Bank Alfalah","NBP","Allied Bank","Other"];
const VEHICLES = ["Bike / Motorcycle","Car","Rickshaw / QingQi","Bicycle","On Foot"];

const INPUT  = "w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-200 focus:bg-white transition-all";
const SELECT = "w-full h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-200 appearance-none transition-all";
const LABEL  = "text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block";

type EditSection = "personal" | "vehicle" | "bank" | null;

type ProfilePayload = {
  name?: string; email?: string; cnic?: string; city?: string;
  address?: string; emergencyContact?: string;
  vehicleType?: string; vehiclePlate?: string;
  vehicleRegNo?: string; drivingLicense?: string;
  bankName?: string; bankAccount?: string; bankAccountTitle?: string;
};

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded-xl ${className || ""}`} />;
}

function SkeletonProfile() {
  return (
    <div className="bg-[#F5F6F8] pb-24 min-h-screen">
      <div className="bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 px-5 pt-14 pb-24 rounded-b-[2rem]" />
      <div className="px-4 -mt-20 space-y-4">
        <div className="bg-white rounded-3xl shadow-lg p-5">
          <div className="flex items-start gap-4">
            <SkeletonBlock className="w-16 h-16 rounded-2xl" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-5 w-32" />
              <SkeletonBlock className="h-3 w-24" />
              <SkeletonBlock className="h-3 w-20" />
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {[1,2,3,4].map(i => <SkeletonBlock key={i} className="flex-1 h-20 rounded-2xl" />)}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[1,2,3,4,5,6].map(i => <SkeletonBlock key={i} className="h-20 rounded-2xl" />)}
        </div>
        <SkeletonBlock className="h-48 rounded-3xl" />
      </div>
    </div>
  );
}

function InfoRow({ label, value, empty, icon }: { label: string; value?: string | null; empty?: string; icon?: React.ReactElement }) {
  return (
    <div className="flex justify-between items-center py-3.5 border-b border-gray-50 last:border-0 gap-3 px-5">
      <span className="text-xs text-gray-500 font-semibold flex items-center gap-2 flex-shrink-0">
        {icon}{label}
      </span>
      <span className={`text-sm font-semibold text-right ${value ? "text-gray-800" : "text-gray-300 italic text-xs"}`}>
        {value || empty || "—"}
      </span>
    </div>
  );
}

function SavedCheckmark({ show, label }: { show: boolean; label: string }) {
  if (!show) return null;
  return (
    <span className="inline-flex items-center gap-1 text-green-600 text-xs font-bold animate-[fadeIn_0.3s_ease-out]">
      <CheckCircle size={14} className="text-green-500" /> {label}
    </span>
  );
}

export default function Profile() {
  const { user, logout, refreshUser, loading: authLoading } = useAuth();
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
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<"personal" | "vehicle" | "bank">("personal");
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [savedSection, setSavedSection] = useState<EditSection>(null);
  const [fadeIn, setFadeIn] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: reviewsData } = useQuery({
    queryKey: ["rider-my-reviews"],
    queryFn: () => api.getMyReviews(),
    staleTime: 60000,
  });

  const { language, setLanguage } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  const [name, setName]             = useState(user?.name || "");
  const [email, setEmail]           = useState(user?.email || "");
  const [cnic, setCnic]             = useState(user?.cnic || "");
  const [city, setCity]             = useState(user?.city || "");
  const [address, setAddress]       = useState(user?.address || "");
  const [emergency, setEmergency]   = useState(user?.emergencyContact || "");

  const [vehicleType, setVehicleType]       = useState(user?.vehicleType || "");
  const [vehiclePlate, setVehiclePlate]     = useState(user?.vehiclePlate || "");
  const [vehicleRegNo, setVehicleRegNo]     = useState(user?.vehicleRegNo || "");
  const [drivingLicense, setDrivingLicense] = useState(user?.drivingLicense || "");

  const [bankName, setBankName]               = useState(user?.bankName || "");
  const [bankAccount, setBankAccount]         = useState(user?.bankAccount || "");
  const [bankAccountTitle, setBankAccountTitle] = useState(user?.bankAccountTitle || "");

  useEffect(() => {
    requestAnimationFrame(() => setFadeIn(true));
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const showToast = (m: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(m);
    toastTimerRef.current = setTimeout(() => setToast(""), 3500);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast("Image too large (max 5MB)"); return; }
    setAvatarUploading(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const uploadRes = await api.uploadFile({ file: base64, filename: file.name, mimeType: file.type });
      if (!uploadRes?.url) { showToast("Upload failed — no URL returned"); setAvatarUploading(false); return; }
      await api.updateProfile({ avatar: uploadRes.url });
      await refreshUser();
      showToast("Profile photo updated");
    } catch {
      showToast("Failed to upload photo");
    }
    setAvatarUploading(false);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  };

  const startEdit = (section: EditSection) => {
    if (section === "personal") {
      setName(user?.name || ""); setEmail(user?.email || ""); setCnic(user?.cnic || "");
      setCity(user?.city || ""); setAddress(user?.address || ""); setEmergency(user?.emergencyContact || "");
    } else if (section === "vehicle") {
      setVehicleType(user?.vehicleType || ""); setVehiclePlate(user?.vehiclePlate || "");
      setVehicleRegNo(user?.vehicleRegNo || ""); setDrivingLicense(user?.drivingLicense || "");
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
            showToast(T("cnicFormatError"));
            setSaving(false);
            return;
          }
        }
        Object.assign(payload, { name, email, cnic: cnic.trim(), city, address, emergencyContact: emergency });
      }
      if (section === "vehicle")  Object.assign(payload, { vehicleType, vehiclePlate, vehicleRegNo, drivingLicense });
      if (section === "bank")     Object.assign(payload, { bankName, bankAccount, bankAccountTitle });
      await api.updateProfile(payload);
      await refreshUser();
      setEditing(null);
      setSavedSection(section);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSavedSection(null), 3000);
      showToast(T("changesSaved"));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : T("saveFailedMsg");
      showToast(msg);
    }
    setSaving(false);
  };

  const completionFieldMap: { key: string; label: string; val: unknown }[] = [
    { key: "name",         label: T("fullName"),       val: user?.name },
    { key: "cnic",         label: T("cnicNationalId"), val: user?.cnic },
    { key: "city",         label: T("cityLabel"),      val: user?.city },
    { key: "vehicleType",  label: T("vehicleType"),    val: user?.vehicleType },
    { key: "vehiclePlate", label: T("vehiclePlate"),   val: user?.vehiclePlate },
    { key: "bankName",     label: T("bankDetails"),    val: user?.bankName },
  ];
  const completionFilled = completionFieldMap.filter(f => Boolean(f.val));
  const completionPct    = Math.round((completionFilled.length / completionFieldMap.length) * 100);
  const missingCount     = completionFieldMap.length - completionFilled.length;

  const totalDeliveries = user?.stats?.totalDeliveries || 0;
  const totalEarnings = user?.stats?.totalEarnings || 0;
  const rating = reviewsData?.avgRating ?? user?.stats?.rating ?? 5.0;

  const quickActions = [
    { href: "/wallet",        icon: <Wallet size={20}/>,       label: T("wallet"),            bg: "bg-emerald-50 text-emerald-600" },
    { href: "/earnings",      icon: <BarChart2 size={20}/>,    label: T("yourEarnings"),      bg: "bg-amber-50 text-amber-600"     },
    { href: "/history",       icon: <ClipboardList size={20}/>,label: T("myOrders"),          bg: "bg-purple-50 text-purple-600"   },
    { href: "/",              icon: <Home size={20}/>,         label: T("dashboard"),         bg: "bg-blue-50 text-blue-600"       },
    { href: "/notifications", icon: <Bell size={20}/>,         label: T("notifications"),     bg: "bg-indigo-50 text-indigo-600",  badge: unread },
    { href: "/settings/security", icon: <Shield size={20}/>,   label: T("securitySettingsLink"), bg: "bg-red-50 text-red-600"     },
  ];

  const handleLogout = () => {
    if (!logoutConfirm) {
      setLogoutConfirm(true);
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
      logoutTimerRef.current = setTimeout(() => setLogoutConfirm(false), 4000);
      return;
    }
    logout();
  };

  const maskAccount = useCallback((acc: string) => {
    if (!acc || acc.length <= 4) return acc || "****";
    return "•••• " + acc.slice(-4);
  }, []);

  if (authLoading) return <SkeletonProfile />;

  return (
    <div className={`bg-[#F5F6F8] pb-24 min-h-screen transition-opacity duration-500 ${fadeIn ? "opacity-100" : "opacity-0"}`}>

      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold flex items-center gap-2 animate-[slideDown_0.3s_ease-out] max-w-[90vw]">
          <CheckCircle size={15} className="text-green-400 flex-shrink-0"/> {toast}
        </div>
      )}

      <div className="bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 px-5 pt-14 pb-24 rounded-b-[2rem] relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-green-500/[0.04]"/>
        <div className="absolute bottom-10 -left-16 w-56 h-56 rounded-full bg-white/[0.02]"/>
        <div className="relative flex items-center justify-between mb-2">
          <div>
            <p className="text-white/40 text-xs font-semibold tracking-widest uppercase mb-1">{T("riderProfileSettings")}</p>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">{T("myAccountTitle")}</h1>
          </div>
          <Link href="/notifications" className="relative h-10 w-10 flex items-center justify-center bg-white/[0.06] backdrop-blur-sm text-white rounded-xl border border-white/[0.06]">
            <Bell size={18}/>
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-extrabold rounded-full w-[18px] h-[18px] flex items-center justify-center shadow-sm">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Link>
        </div>
      </div>

      <div className="px-4 -mt-20 space-y-4">

        <div className="bg-white rounded-3xl shadow-lg border border-gray-100 p-5 relative overflow-hidden animate-[slideUp_0.4s_ease-out]">
          <div className="absolute -top-8 -right-8 w-24 h-24 bg-gray-50 rounded-full opacity-50"/>
          <div className="relative flex items-start gap-4">
            <input type="file" accept="image/*" ref={avatarInputRef} onChange={handleAvatarUpload} className="hidden" />
            <button
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarUploading}
              className="relative w-16 h-16 rounded-2xl flex-shrink-0 shadow-lg ring-4 ring-gray-200 overflow-hidden group"
            >
              {user?.avatar ? (
                <img src={user.avatar} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gray-900 flex items-center justify-center text-2xl font-extrabold text-white">
                  {(user?.name || user?.phone || "R")[0].toUpperCase()}
                </div>
              )}
              {avatarUploading ? (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <div className="absolute bottom-0 right-0 w-6 h-6 bg-gray-900 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                  <Camera size={10} className="text-white" />
                </div>
              )}
            </button>
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
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 ${
                  user?.isOnline ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                }`}>
                  <Circle size={7} className={user?.isOnline ? "fill-green-500 text-green-500" : "fill-gray-400 text-gray-400"}/>
                  {user?.isOnline ? T("onlineLabel") : T("offlineLabel")}
                </span>
                <span className="text-[11px] bg-gray-900 text-white px-2.5 py-1 rounded-full font-bold flex items-center gap-1">
                  <Bike size={11}/> {T("riderBadge")}
                </span>
                {user?.vehicleType && (
                  <span className="text-[11px] bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full font-bold">
                    {user.vehicleType.split("/")[0].trim()}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5">
                {[1,2,3,4,5].map(s => (
                  <Star key={s} size={13} className={s <= Math.round(rating) ? "fill-yellow-400 text-yellow-400" : "text-gray-200 fill-gray-200"}/>
                ))}
              </div>
              <span className="text-xs text-gray-500 font-semibold">{rating.toFixed(1)} {T("ratingLabel")}</span>
            </div>
            {user?.createdAt && (
              <p className="text-[10px] text-gray-400 flex items-center gap-1">
                <Clock size={10}/> {T("memberSince")} {new Date(user.createdAt).toLocaleDateString("en-PK", { month: "short", year: "numeric" })}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 animate-[slideUp_0.5s_ease-out]">
          {[
            { label: T("deliveriesLabel"), value: String(totalDeliveries), icon: <ClipboardList size={15} className="text-blue-500"/>,   bg: "bg-blue-50",   border: "border-blue-100" },
            { label: T("earnedStat"),      value: fc(totalEarnings),       icon: <BarChart2 size={15} className="text-green-500"/>,      bg: "bg-green-50",  border: "border-green-100" },
            { label: T("walletStat"),      value: fc(Number(user?.walletBalance || 0)), icon: <Wallet size={15} className="text-amber-500"/>, bg: "bg-amber-50",  border: "border-amber-100" },
            { label: T("ratingStat"),      value: rating.toFixed(1),       icon: <Star size={15} className="text-yellow-500"/>,          bg: "bg-yellow-50", border: "border-yellow-100" },
          ].map(s => (
            <div key={s.label} className={`flex-1 ${s.bg} rounded-2xl p-3 border ${s.border} text-center`}>
              <div className="flex justify-center mb-1">{s.icon}</div>
              <p className="text-[15px] font-extrabold text-gray-800 leading-tight">{s.value}</p>
              <p className="text-[9px] text-gray-500 mt-0.5 font-semibold truncate">{s.label}</p>
            </div>
          ))}
        </div>

        {completionPct < 100 && (
          <div className="bg-amber-50 border border-amber-200 rounded-3xl px-4 py-3 animate-[slideUp_0.55s_ease-out]">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-amber-800 font-bold">{T("completeProfileLabel")}</p>
              <span className="text-[11px] text-amber-600 font-semibold">{missingCount} {T("itemsRemaining")}</span>
            </div>
            <div className="w-full bg-amber-200 rounded-full h-2">
              <div
                className="bg-amber-500 h-2 rounded-full transition-all duration-700"
                style={{ width: `${completionPct}%` }}
              />
            </div>
          </div>
        )}

        <div className="animate-[slideUp_0.6s_ease-out]">
          <p className="text-[13px] font-bold text-gray-700 mb-2 px-1">{T("quickActionsLabel")}</p>
          <div className="grid grid-cols-3 gap-2">
            {quickActions.map(item => (
              <Link key={item.href} href={item.href}
                className="bg-white rounded-3xl border border-gray-100 p-3.5 flex flex-col items-center gap-2 active:bg-gray-50 transition-all relative shadow-sm">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${item.bg}`}>
                  {item.icon}
                </div>
                <span className="text-[11px] font-semibold text-gray-700 text-center leading-tight">{item.label}</span>
                {(item.badge ?? 0) > 0 && (
                  <span className="absolute top-2 right-2 bg-red-500 text-white text-[9px] font-extrabold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {item.badge! > 9 ? "9+" : item.badge}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden animate-[slideUp_0.65s_ease-out]">
          <div className="flex border-b border-gray-100">
            {(["personal", "vehicle", "bank"] as const).map(tab => (
              <button key={tab}
                onClick={() => { setActiveTab(tab); if (editing && editing !== tab) setEditing(null); }}
                className={`flex-1 py-3.5 text-sm font-bold transition-all relative ${
                  activeTab === tab
                    ? "text-gray-900"
                    : "text-gray-400"
                }`}>
                {tab === "personal" ? T("personalTab") : tab === "vehicle" ? T("vehicleTab") : T("bankTab")}
                {activeTab === tab && (
                  <div className="absolute bottom-0 left-1/4 right-1/4 h-[3px] bg-gray-900 rounded-t-full" />
                )}
                {savedSection === tab && (
                  <span className="absolute top-1 right-2">
                    <CheckCircle size={12} className="text-green-500 animate-[fadeIn_0.3s_ease-out]" />
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="transition-all duration-300">
            {activeTab === "personal" && (
              <div className="animate-[fadeIn_0.25s_ease-out]">
                <div className="px-5 py-3 flex items-center justify-between border-b border-gray-50">
                  <div className="flex items-center gap-2">
                    <User size={15} className="text-gray-900"/>
                    <div>
                      <p className="font-bold text-gray-900 text-[14px]">{T("personalInformation")}</p>
                      <p className="text-[10px] text-gray-400">{T("identityContact")}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <SavedCheckmark show={savedSection === "personal"} label={T("savedFeedback")} />
                    <button onClick={() => editing === "personal" ? setEditing(null) : startEdit("personal")}
                      className={`text-sm font-bold py-1.5 px-3 rounded-xl transition-all flex items-center gap-1.5 ${
                        editing === "personal" ? "bg-gray-100 text-gray-600" : "bg-gray-100 text-gray-900 active:bg-gray-200"
                      }`}>
                      {editing === "personal" ? <><span className="text-xs">✕</span> {T("cancel")}</> : <><Pencil size={12}/> {T("edit")}</>}
                    </button>
                  </div>
                </div>
                {editing === "personal" ? (
                  <div className="p-5 space-y-3.5 animate-[slideDown_0.3s_ease-out]">
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
                      <p className="text-[10px] text-gray-400 mt-1">{T("cnicFormatHint")}</p>
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
                      <input value={address} onChange={e => setAddress(e.target.value)} placeholder={T("addressPlaceholder")} className={INPUT}/>
                    </div>
                    <div>
                      <label className={LABEL}>{T("emergencyContactLabel")}</label>
                      <input value={emergency} onChange={e => setEmergency(e.target.value)} inputMode="tel" placeholder={T("emergencyPlaceholder")} className={INPUT}/>
                    </div>
                    <button onClick={() => saveSection("personal")} disabled={saving}
                      className="w-full h-12 bg-gray-900 text-white font-bold rounded-xl disabled:opacity-60 flex items-center justify-center gap-2 active:bg-gray-800 transition-colors shadow-sm">
                      {saving ? <><RefreshCcw size={15} className="animate-spin"/> {T("saving")}</> : <><CheckCircle size={15}/> {T("saveChangesBtn")}</>}
                    </button>
                  </div>
                ) : (
                  <div className="py-1">
                    <InfoRow label={T("fullName")}            value={user?.name}             empty={T("notSet")} icon={<User size={12} className="text-gray-500"/>}/>
                    <InfoRow label={T("phoneNumber")}         value={user?.phone}            empty={T("notSet")} icon={<Phone size={12} className="text-blue-500"/>}/>
                    <InfoRow label={T("emailAddress")}        value={user?.email}            empty={T("notSet")} icon={<Mail size={12} className="text-purple-500"/>}/>
                    <InfoRow label={T("cnicNationalId")}      value={user?.cnic}             empty={T("notSet")} icon={<FileText size={12} className="text-amber-500"/>}/>
                    <InfoRow label={T("cityLabel")}           value={user?.city}             empty={T("notSet")} icon={<MapPin size={12} className="text-red-500"/>}/>
                    <InfoRow label={T("homeAddress")}         value={user?.address}          empty={T("notSet")} icon={<Home size={12} className="text-teal-500"/>}/>
                    <InfoRow label={T("emergencyContactLabel")} value={user?.emergencyContact} empty={T("notSet")} icon={<Phone size={12} className="text-orange-500"/>}/>
                  </div>
                )}
              </div>
            )}

            {activeTab === "vehicle" && (
              <div className="animate-[fadeIn_0.25s_ease-out]">
                <div className="px-5 py-3 flex items-center justify-between border-b border-gray-50">
                  <div className="flex items-center gap-2">
                    <Bike size={15} className="text-gray-900"/>
                    <div>
                      <p className="font-bold text-gray-900 text-[14px]">{T("vehicleDetails")}</p>
                      <p className="text-[10px] text-gray-400">{T("yourDeliveryVehicle")}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <SavedCheckmark show={savedSection === "vehicle"} label={T("savedFeedback")} />
                    <button onClick={() => editing === "vehicle" ? setEditing(null) : startEdit("vehicle")}
                      className={`text-sm font-bold py-1.5 px-3 rounded-xl transition-all flex items-center gap-1.5 ${
                        editing === "vehicle" ? "bg-gray-100 text-gray-600" : "bg-gray-100 text-gray-900 active:bg-gray-200"
                      }`}>
                      {editing === "vehicle" ? <><span className="text-xs">✕</span> {T("cancel")}</> : <><Pencil size={12}/> {T("edit")}</>}
                    </button>
                  </div>
                </div>
                {editing === "vehicle" ? (
                  <div className="p-5 space-y-3.5 animate-[slideDown_0.3s_ease-out]">
                    <div>
                      <label className={LABEL}>{T("vehicleTypeRequired")}</label>
                      <select value={vehicleType} onChange={e => setVehicleType(e.target.value)} className={SELECT}>
                        <option value="">{T("selectVehicle")}</option>
                        {VEHICLES.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL}>{T("vehiclePlateRequired")}</label>
                      <input value={vehiclePlate} onChange={e => setVehiclePlate(e.target.value)} placeholder="ABC-1234" className={INPUT}/>
                    </div>
                    <div>
                      <label className={LABEL}>Vehicle Registration No.</label>
                      <input value={vehicleRegNo} onChange={e => setVehicleRegNo(e.target.value)} placeholder="REG-12345" className={INPUT}/>
                    </div>
                    <div>
                      <label className={LABEL}>Driving License No.</label>
                      <input value={drivingLicense} onChange={e => setDrivingLicense(e.target.value)} placeholder="DL-12345678" className={INPUT}/>
                    </div>
                    <button onClick={() => saveSection("vehicle")} disabled={saving}
                      className="w-full h-12 bg-gray-900 text-white font-bold rounded-xl disabled:opacity-60 flex items-center justify-center gap-2 active:bg-gray-800 transition-colors shadow-sm">
                      {saving ? <><RefreshCcw size={15} className="animate-spin"/> {T("saving")}</> : <><CheckCircle size={15}/> {T("saveChangesBtn")}</>}
                    </button>
                  </div>
                ) : user?.vehicleType ? (
                  <div className="p-4">
                    <div className="bg-gradient-to-r from-gray-800 to-gray-900 rounded-2xl p-4 text-white relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-20 h-20 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2"/>
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">{T("registeredVehicle")}</span>
                        <Bike size={18} className="text-green-400"/>
                      </div>
                      <p className="text-xl font-extrabold tracking-wide mb-1">{user.vehiclePlate || "---"}</p>
                      <p className="text-sm text-gray-300 font-medium">{user.vehicleType}</p>
                      <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-gray-400">{T("plateNumber")}</span>
                          <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                            <CheckCircle size={9}/> {T("activeVerified")}
                          </span>
                        </div>
                        {user.vehicleRegNo && (
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-gray-400">Reg. No.</span>
                            <span className="text-[10px] text-gray-300 font-medium">{user.vehicleRegNo}</span>
                          </div>
                        )}
                        {user.drivingLicense && (
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-gray-400">License</span>
                            <span className="text-[10px] text-gray-300 font-medium">{user.drivingLicense}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-8 text-center">
                    <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-2">
                      <Bike size={28} className="text-gray-200"/>
                    </div>
                    <p className="text-sm font-bold text-gray-600">{T("noVehicle")}</p>
                    <p className="text-xs text-gray-400 mt-1">{T("addVehicleInfo")}</p>
                    <button onClick={() => startEdit("vehicle")}
                      className="mt-3 px-5 py-2 bg-gray-100 text-gray-900 font-bold rounded-xl text-sm active:bg-gray-200 transition-colors">
                      + {T("addVehicle")}
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === "bank" && (
              <div className="animate-[fadeIn_0.25s_ease-out]">
                <div className="px-5 py-3 flex items-center justify-between border-b border-gray-50">
                  <div className="flex items-center gap-2">
                    <Landmark size={15} className="text-gray-900"/>
                    <div>
                      <p className="font-bold text-gray-900 text-[14px]">{T("bankDetails")}</p>
                      <p className="text-[10px] text-gray-400">{T("withdrawalAccount")}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <SavedCheckmark show={savedSection === "bank"} label={T("savedFeedback")} />
                    <button onClick={() => editing === "bank" ? setEditing(null) : startEdit("bank")}
                      className={`text-sm font-bold py-1.5 px-3 rounded-xl transition-all flex items-center gap-1.5 ${
                        editing === "bank" ? "bg-gray-100 text-gray-600" : "bg-gray-100 text-gray-900 active:bg-gray-200"
                      }`}>
                      {editing === "bank" ? <><span className="text-xs">✕</span> {T("cancel")}</> : <><Pencil size={12}/> {T("edit")}</>}
                    </button>
                  </div>
                </div>
                {editing === "bank" ? (
                  <div className="p-5 space-y-3.5 animate-[slideDown_0.3s_ease-out]">
                    <div>
                      <label className={LABEL}>{T("selectBank")}</label>
                      <select value={bankName} onChange={e => setBankName(e.target.value)} className={SELECT}>
                        <option value="">{T("selectBank")}</option>
                        {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL}>{T("accountNoRequired")}</label>
                      <input value={bankAccount} onChange={e => setBankAccount(e.target.value)} inputMode="numeric" placeholder={T("bankAccPlaceholder")} className={INPUT}/>
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
                      className="w-full h-12 bg-gray-900 text-white font-bold rounded-xl disabled:opacity-60 flex items-center justify-center gap-2 active:bg-gray-800 transition-colors shadow-sm">
                      {saving ? <><RefreshCcw size={15} className="animate-spin"/> {T("saving")}</> : <><CheckCircle size={15}/> {T("saveChangesBtn")}</>}
                    </button>
                  </div>
                ) : user?.bankName ? (
                  <div className="p-4">
                    <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-4 text-white relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2"/>
                      <div className="absolute bottom-0 left-0 w-16 h-16 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2"/>
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">{T("paymentAccount")}</span>
                        <CreditCard size={18} className="text-green-300"/>
                      </div>
                      <p className="text-lg font-mono font-bold tracking-wider mb-1">{maskAccount(user.bankAccount || "")}</p>
                      <p className="text-sm text-gray-300 font-medium">{user.bankName}</p>
                      {user.bankAccountTitle && (
                        <p className="text-xs text-gray-400 mt-1">{user.bankAccountTitle}</p>
                      )}
                      <div className="mt-3 pt-3 border-t border-white/15 flex items-center justify-between">
                        <span className="text-[10px] text-gray-400">{T("accountTitle")}</span>
                        <span className="text-[10px] bg-white/15 text-white px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                          <CheckCircle size={9}/> {T("activeVerified")}
                        </span>
                      </div>
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
                      className="mt-3 px-5 py-2 bg-gray-100 text-gray-900 font-bold rounded-xl text-sm active:bg-gray-200 transition-colors">
                      + {T("addAccount")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden animate-[slideUp_0.7s_ease-out]">
          <div className="px-5 py-3.5">
            <p className="font-bold text-gray-900 text-[15px] flex items-center gap-2"><Settings size={15} className="text-gray-500"/> {T("settingsLabel")}</p>
          </div>
          <div className="border-t border-gray-100">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-50">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-indigo-50 rounded-xl flex items-center justify-center">
                  <Languages size={17} className="text-indigo-500"/>
                </div>
                <span className="text-sm font-semibold text-gray-800">{T("languageLabel")}</span>
              </div>
              <div className="flex bg-gray-100 rounded-xl p-0.5 gap-0.5">
                <button
                  onClick={() => setLanguage("en")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${language === "en" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>
                  EN
                </button>
                <button
                  onClick={() => setLanguage("ur")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${language === "ur" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>
                  اردو
                </button>
              </div>
            </div>

            <Link href="/settings/security"
              className="flex items-center justify-between px-5 py-3.5 border-b border-gray-50 active:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-red-50 rounded-xl flex items-center justify-center">
                  <Shield size={17} className="text-red-500"/>
                </div>
                <div>
                  <span className="text-sm font-semibold text-gray-800 block">{T("securitySettingsLink")}</span>
                  <span className="text-[10px] text-gray-400">{T("manageSecuritySettings")}</span>
                </div>
              </div>
              <ChevronRight size={16} className="text-gray-300"/>
            </Link>

            <Link href="/notifications"
              className="flex items-center justify-between px-5 py-3.5 active:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center relative">
                  <Bell size={17} className="text-blue-500"/>
                  {unread > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] font-extrabold rounded-full w-4 h-4 flex items-center justify-center">
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-sm font-semibold text-gray-800 block">{T("notificationsLink")}</span>
                  <span className="text-[10px] text-gray-400">{T("viewNotifications")}</span>
                </div>
              </div>
              <ChevronRight size={16} className="text-gray-300"/>
            </Link>
          </div>
        </div>

        <div className="bg-gray-900 rounded-3xl overflow-hidden animate-[slideUp_0.75s_ease-out]">
          <button
            onClick={() => setPayoutOpen(!payoutOpen)}
            className="w-full px-5 py-4 flex items-center justify-between active:bg-gray-800 transition-colors">
            <p className="font-bold text-white text-[15px] flex items-center gap-2">
              <Info size={15} className="text-white/50"/> {T("payoutPolicyLabel")}
            </p>
            <ChevronDown size={18} className={`text-white/50 transition-transform duration-300 ${payoutOpen ? "rotate-180" : ""}`}/>
          </button>
          <div className={`overflow-hidden transition-all duration-300 ${payoutOpen ? "max-h-60 opacity-100" : "max-h-0 opacity-0"}`}>
            <div className="px-5 pb-4 space-y-2.5">
              {[
                { icon: <CheckCircle size={13}/>, text: T("payoutEarningsPct").replace("{keepPct}", String(riderKeepPct)).replace("{feePct}", String(100 - riderKeepPct)) },
                { icon: <CreditCard size={13}/>,  text: T("payoutMinWithdrawal").replace("{amount}", String(config.rider?.minPayout ?? 500)) },
                { icon: <Clock size={13}/>,       text: T("payoutProcessingTime") },
                { icon: <Lock size={13}/>,        text: T("payoutVerificationReq") },
              ].map((p, i) => (
                <div key={i} className="flex gap-2.5 items-start text-xs text-white/60">
                  <span className="text-green-400 mt-0.5">{p.icon}</span>
                  <span className="font-medium">{p.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {(reviewsData?.reviews?.length ?? 0) > 0 && (
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden animate-[slideUp_0.7s_ease-out]">
            <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-yellow-50 flex items-center justify-center">
                  <Star size={16} className="text-yellow-500" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">Customer Reviews</p>
                  <p className="text-[11px] text-gray-400">{reviewsData.total} review{reviewsData.total !== 1 ? "s" : ""} · {reviewsData.avgRating?.toFixed(1)} avg</p>
                </div>
              </div>
              <div className="flex items-center gap-0.5">
                {[1,2,3,4,5].map(s => (
                  <Star key={s} size={12} className={s <= Math.round(reviewsData.avgRating || 0) ? "fill-yellow-400 text-yellow-400" : "text-gray-200 fill-gray-200"} />
                ))}
              </div>
            </div>
            <div className="divide-y divide-gray-50">
              {reviewsData.reviews.slice(0, 5).map((r: any) => (
                <div key={r.id} className="px-5 py-3.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-[11px] font-bold text-gray-500">
                        {(r.customerName || "C")[0].toUpperCase()}
                      </div>
                      <span className="text-xs font-semibold text-gray-700">{r.customerName || "Customer"}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {[1,2,3,4,5].map(s => (
                        <Star key={s} size={10} className={s <= r.rating ? "fill-yellow-400 text-yellow-400" : "text-gray-200 fill-gray-200"} />
                      ))}
                    </div>
                  </div>
                  {r.comment && (
                    <p className="text-xs text-gray-600 leading-relaxed pl-9">{r.comment}</p>
                  )}
                  <p className="text-[10px] text-gray-300 mt-1 pl-9">
                    {new Date(r.createdAt).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })}
                    {r.orderType && <span className="ml-1.5 text-gray-400">· {r.orderType === "delivery" ? "Delivery" : "Ride"}</span>}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <button onClick={handleLogout}
          className={`w-full h-12 font-bold rounded-3xl text-sm flex items-center justify-center gap-2 transition-all duration-300 ${
            logoutConfirm
              ? "bg-red-600 text-white shadow-md active:bg-red-700"
              : "border-2 border-red-200 text-red-500 active:bg-red-50"
          }`}>
          <LogOut size={16}/>
          {logoutConfirm ? T("tapAgainLogout") : T("logoutFromDevice")}
        </button>

        <div className="bg-white rounded-3xl border border-gray-100 p-5 space-y-3">
          <p className="text-center text-xs text-gray-500 leading-relaxed font-medium">
            {config.platform.appName} {T("riderPortal")} · {T("contactSupport")}:{" "}
            <a href={`tel:${config.platform.supportPhone}`} className="text-gray-900 font-semibold">{config.platform.supportPhone}</a>
          </p>
          {config.platform.supportHours && (
            <p className="text-xs text-gray-400 text-center flex items-center justify-center gap-1"><Clock size={11}/> {config.platform.supportHours}</p>
          )}
          {config.platform.supportEmail && (
            <p className="text-xs text-gray-500 text-center flex items-center justify-center gap-1">
              <Mail size={11}/>
              <a href={`mailto:${config.platform.supportEmail}`} className="text-gray-900 hover:text-gray-700">{config.platform.supportEmail}</a>
            </p>
          )}
          {(config.platform.socialFacebook || config.platform.socialInstagram) && (
            <div className="flex gap-3 justify-center pt-1">
              {config.platform.socialFacebook && (
                <a href={config.platform.socialFacebook} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 flex items-center gap-1 font-medium">
                  <Facebook size={13}/> {T("followUsLabel")}
                </a>
              )}
              {config.platform.socialInstagram && (
                <a href={config.platform.socialInstagram} target="_blank" rel="noopener noreferrer" className="text-xs text-pink-600 flex items-center gap-1 font-medium">
                  <Instagram size={13}/> {T("followUsLabel")}
                </a>
              )}
            </div>
          )}
          {(config.content.tncUrl || config.content.privacyUrl || config.content.refundPolicyUrl || config.content.faqUrl || config.content.aboutUrl || config.features.chat) && (
            <div className="flex flex-wrap gap-x-3 gap-y-1.5 justify-center pt-1">
              {config.content.tncUrl && (
                <a href={config.content.tncUrl} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-gray-600 underline underline-offset-2 flex items-center gap-0.5"><FileText size={10}/> {T("termsConditions")}</a>
              )}
              {config.content.privacyUrl && (
                <a href={config.content.privacyUrl} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-gray-600 underline underline-offset-2 flex items-center gap-0.5"><Lock size={10}/> {T("privacyPolicy")}</a>
              )}
              {config.content.refundPolicyUrl && (
                <a href={config.content.refundPolicyUrl} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-gray-600 underline underline-offset-2 flex items-center gap-0.5"><RefreshCcw size={10}/> {T("refundPolicy")}</a>
              )}
              {config.content.faqUrl && (
                <a href={config.content.faqUrl} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-gray-600 underline underline-offset-2 flex items-center gap-0.5"><HelpCircle size={10}/> {T("faqLabel")}</a>
              )}
              {config.content.aboutUrl && (
                <a href={config.content.aboutUrl} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-gray-600 underline underline-offset-2 flex items-center gap-0.5"><Info size={10}/> {T("aboutLabel")}</a>
              )}
              {config.features.chat && (
                <a href={`https://wa.me/${config.platform.supportPhone.replace(/^0/, "92")}`} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-gray-600 underline underline-offset-2 flex items-center gap-0.5"><MessageCircle size={10}/> {T("liveChatLabel")}</a>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
