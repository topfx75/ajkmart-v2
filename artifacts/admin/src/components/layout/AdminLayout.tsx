import React, { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  ShoppingBag,
  Car,
  Pill,
  PackageSearch,
  FolderTree,
  Receipt,
  Settings2,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Zap,
  Store,
  Ticket,
  BellRing,
  Search,
  Globe,
  Shield,
  Navigation,
  AlertTriangle,
  BadgeCheck,
  Layers,
  Wallet,
  CreditCard,
  FileText,
  Lock,
  ToggleLeft,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandPalette } from "@/components/CommandPalette";
import { useLanguage } from "@/lib/useLanguage";
import { tDual, type TranslationKey, LANGUAGE_OPTIONS } from "@workspace/i18n";
import { io, type Socket } from "socket.io-client";
import { fetcher } from "@/lib/api";

type NavGroup = {
  labelKey: TranslationKey;
  color: string;
  items: { nameKey: TranslationKey; href: string; icon: React.ElementType; sosBadge?: boolean }[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: "navOperations",
    color: "#6366F1",
    items: [
      { nameKey: "navDashboard",     href: "/dashboard",       icon: LayoutDashboard },
      { nameKey: "navOrders",        href: "/orders",          icon: ShoppingBag },
      { nameKey: "navRides",         href: "/rides",           icon: Car },
      { nameKey: "navPharmacy",      href: "/pharmacy",        icon: Pill },
      { nameKey: "navLiveRidersMap", href: "/live-riders-map", icon: Navigation },
    ],
  },
  {
    labelKey: "navInventory",
    color: "#0EA5E9",
    items: [
      { nameKey: "navVendors",    href: "/vendors",     icon: Store },
      { nameKey: "navProducts",   href: "/products",    icon: PackageSearch },
      { nameKey: "navCategories", href: "/categories",  icon: FolderTree },
      { nameKey: "navFlashDeals", href: "/flash-deals", icon: Zap },
    ],
  },
  {
    labelKey: "navFinancials",
    color: "#22C55E",
    items: [
      { nameKey: "navTransactions",    href: "/transactions",     icon: Receipt },
      { nameKey: "navWithdrawals",     href: "/withdrawals",      icon: Wallet },
      { nameKey: "navDepositRequests", href: "/deposit-requests", icon: CreditCard },
      { nameKey: "navKyc",             href: "/kyc",              icon: BadgeCheck },
    ],
  },
  {
    labelKey: "navSafetyAndSecurity",
    color: "#EF4444",
    items: [
      { nameKey: "navSosAlerts",       href: "/sos-alerts",  icon: AlertTriangle, sosBadge: true },
      { nameKey: "navAuditLogs",       href: "/security",    icon: FileText },
      { nameKey: "navUserPermissions", href: "/users",       icon: Lock },
    ],
  },
  {
    labelKey: "navConfig",
    color: "#F59E0B",
    items: [
      { nameKey: "navSettings",        href: "/settings",       icon: Settings2 },
      { nameKey: "navFeatureToggles",  href: "/app-management", icon: ToggleLeft },
      { nameKey: "navBanners",         href: "/banners",        icon: Layers },
    ],
  },
];

const BOTTOM_NAV: { nameKey: TranslationKey; href: string; icon: React.ElementType; isSos?: boolean }[] = [
  { nameKey: "navDashboard", href: "/dashboard",  icon: LayoutDashboard },
  { nameKey: "navOrders",    href: "/orders",     icon: ShoppingBag },
  { nameKey: "navRides",     href: "/rides",      icon: Car },
  { nameKey: "navSosAlerts", href: "/sos-alerts", icon: AlertTriangle, isSos: true },
  { nameKey: "navMore",      href: "__more__",    icon: Menu },
];

const navItems = NAV_GROUPS.flatMap(g => g.items);

/* ─── Group label color dots ─── */
const GROUP_DOT: Record<string, string> = {
  navOperations: "#6366F1",
  navInventory: "#0EA5E9",
  navFinancials: "#22C55E",
  navSafetyAndSecurity: "#EF4444",
  navConfig: "#F59E0B",
};

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { language, setLanguage, loading: langLoading } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  const [sosCount, setSosCount] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const langRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetcher("/sos/alerts?limit=1")
      .then((data: { activeCount?: number }) => { if (typeof data.activeCount === "number") setSosCount(data.activeCount); })
      .catch(() => {});

    const token = localStorage.getItem("ajkmart_admin_token") ?? "";
    const socket = io(window.location.origin, {
      path: "/api/socket.io",
      query: { rooms: "admin-fleet" },
      auth: { adminToken: token },
      extraHeaders: { "x-admin-token": token },
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;
    socket.on("connect", () => socket.emit("join", "admin-fleet"));
    socket.on("sos:new", () => {
      setSosCount(c => c + 1);
      if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
    });
    socket.on("sos:resolved", () => setSosCount(c => Math.max(0, c - 1)));
    return () => { socket.disconnect(); socketRef.current = null; };
  }, []);

  useEffect(() => { setIsMobileMenuOpen(false); }, [location]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); setCmdOpen(o => !o); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  /* Close dropdowns on outside click */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("ajkmart_admin_token");
    setLocation("/login");
  };

  const isActive = (href: string) => {
    if (href === "/dashboard") return location === "/dashboard" || location === "/";
    return location.startsWith(href);
  };

  const currentItem = navItems.find(i => isActive(i.href));
  const currentPageName = currentItem ? T(currentItem.nameKey) : "AJKMart Admin";
  const currentLangLabel = LANGUAGE_OPTIONS.find(o => o.value === language)?.label || language.toUpperCase();

  /* ─── Sidebar ─── */
  const SidebarContent = ({ mini }: { mini?: boolean }) => (
    <div
      className="flex flex-col h-full shadow-2xl transition-all duration-300"
      style={{
        width: mini ? 68 : 256,
        background: "linear-gradient(180deg, #0F172A 0%, #0D1526 100%)",
        borderRight: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center shrink-0 transition-all duration-300"
        style={{
          height: 64,
          padding: mini ? "0 14px" : "0 20px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-lg"
          style={{ background: "linear-gradient(135deg, #6366F1, #818CF8)", boxShadow: "0 4px 14px rgba(99,102,241,0.35)" }}
        >
          <ShoppingBag className="w-5 h-5 text-white" />
        </div>
        {!mini && (
          <div className="ml-3 overflow-hidden">
            <span className="font-bold text-[17px] tracking-tight text-white leading-tight block">AJKMart</span>
            <span className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: "#818CF8" }}>Admin Console</span>
          </div>
        )}
      </div>

      {/* SOS alert banner */}
      {sosCount > 0 && (
        <Link href="/sos-alerts">
          <div
            className="relative overflow-hidden flex items-center gap-2 cursor-pointer transition-opacity hover:opacity-90"
            style={{
              margin: mini ? "8px 10px" : "8px 12px",
              background: "linear-gradient(135deg, #DC2626, #B91C1C)",
              borderRadius: 12,
              padding: mini ? "8px 10px" : "8px 12px",
              boxShadow: "0 4px 14px rgba(220,38,38,0.35)",
            }}
          >
            <span className="absolute inset-0 rounded-xl animate-ping" style={{ background: "rgba(239,68,68,0.25)", animationDuration: "1.5s" }} />
            <AlertTriangle className="w-4 h-4 text-white animate-pulse relative z-10 shrink-0" />
            {!mini && (
              <div className="flex-1 min-w-0 relative z-10">
                <p className="text-[11px] font-bold text-white leading-tight">{sosCount} Active SOS Alert{sosCount !== 1 ? "s" : ""}</p>
                <p className="text-[10px] leading-tight" style={{ color: "rgba(255,255,255,0.75)" }}>Tap to respond immediately</p>
              </div>
            )}
            <span
              className="relative z-10 text-[10px] font-black rounded-full flex items-center justify-center shrink-0"
              style={{ background: "rgba(255,255,255,0.2)", color: "#fff", minWidth: 20, height: 20, padding: "0 4px" }}
            >
              {sosCount}
            </span>
          </div>
        </Link>
      )}

      {/* Nav groups */}
      <div className="flex-1 overflow-y-auto py-3 space-y-1" style={{ scrollbarWidth: "none" }}>
        {NAV_GROUPS.map(group => (
          <div key={group.labelKey} style={{ padding: mini ? "0 8px" : "0 10px" }}>
            {/* Group label */}
            {!mini && (
              <div className="flex items-center gap-2 px-2 mb-1 mt-2">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: GROUP_DOT[group.labelKey] }} />
                <span
                  className="text-[10px] font-bold uppercase tracking-widest truncate"
                  style={{ color: "rgba(255,255,255,0.28)" }}
                >
                  {T(group.labelKey)}
                </span>
              </div>
            )}
            {mini && <div className="my-2 mx-1" style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />}

            <div className="space-y-0.5">
              {group.items.map(item => {
                const active = isActive(item.href);
                const Icon = item.icon;
                const showSosBadge = item.sosBadge && sosCount > 0;
                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      title={mini ? T(item.nameKey) : undefined}
                      className="flex items-center transition-all duration-150 cursor-pointer group relative"
                      style={{
                        borderRadius: 10,
                        padding: mini ? "9px 0" : "9px 10px",
                        justifyContent: mini ? "center" : "flex-start",
                        background: active
                          ? "linear-gradient(135deg, rgba(99,102,241,0.20) 0%, rgba(99,102,241,0.10) 100%)"
                          : "transparent",
                        border: active ? "1px solid rgba(99,102,241,0.25)" : "1px solid transparent",
                      }}
                      onMouseEnter={e => {
                        if (!active) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.055)";
                      }}
                      onMouseLeave={e => {
                        if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
                      }}
                    >
                      {/* Active left bar */}
                      {active && !mini && (
                        <span
                          className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full"
                          style={{ background: "#6366F1" }}
                        />
                      )}

                      {/* Icon */}
                      <div className="relative shrink-0" style={{ margin: mini ? 0 : "0 10px 0 6px" }}>
                        <Icon
                          className="w-[18px] h-[18px] transition-colors duration-150"
                          style={{ color: active ? "#818CF8" : showSosBadge ? "#EF4444" : "rgba(255,255,255,0.42)" }}
                        />
                        {showSosBadge && (
                          <>
                            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 animate-ping opacity-75" />
                            <span
                              className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-600 text-white text-[9px] font-black rounded-full flex items-center justify-center"
                            >
                              {sosCount > 9 ? "9+" : sosCount}
                            </span>
                          </>
                        )}
                      </div>

                      {!mini && (
                        <>
                          <span
                            className="text-[13px] flex-1 truncate"
                            style={{
                              color: active ? "#C7D2FE" : "rgba(255,255,255,0.62)",
                              fontWeight: active ? 600 : 400,
                            }}
                          >
                            {T(item.nameKey)}
                          </span>
                          {showSosBadge && active && (
                            <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full" style={{ background: "rgba(239,68,68,0.25)", color: "#FCA5A5" }}>
                              {sosCount > 9 ? "9+" : sosCount}
                            </span>
                          )}
                          {active && !showSosBadge && (
                            <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: "rgba(99,102,241,0.6)" }} />
                          )}
                        </>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom: user profile + logout */}
      <div className="shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: mini ? "12px 10px" : "12px" }}>
        {/* Language — mobile only (inside sidebar) */}
        {!mini && (
          <div className="lg:hidden mb-3 px-1">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5 px-1" style={{ color: "rgba(255,255,255,0.28)" }}>Language</p>
            <div className="flex flex-wrap gap-1">
              {LANGUAGE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setLanguage(opt.value as "en" | "ur")}
                  disabled={langLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: language === opt.value ? "#6366F1" : "rgba(255,255,255,0.07)",
                    color: language === opt.value ? "#fff" : "rgba(255,255,255,0.55)",
                  }}
                >
                  <Globe className="w-3 h-3" />{opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Profile row */}
        <div
          className="flex items-center rounded-xl transition-all duration-150 cursor-default"
          style={{
            padding: mini ? "8px 0" : "8px 10px",
            justifyContent: mini ? "center" : "flex-start",
          }}
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
            style={{ background: "linear-gradient(135deg, #6366F1, #818CF8)", color: "#fff", boxShadow: "0 2px 8px rgba(99,102,241,0.3)" }}
          >
            A
          </div>
          {!mini && (
            <div className="ml-2.5 flex-1 min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: "rgba(255,255,255,0.85)" }}>Administrator</p>
              <p className="text-[10px] truncate" style={{ color: "rgba(255,255,255,0.35)" }}>admin@ajkmart.pk</p>
            </div>
          )}
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          title={mini ? "Logout" : undefined}
          className="flex items-center w-full rounded-xl transition-all duration-150 mt-1"
          style={{
            padding: mini ? "9px 0" : "9px 10px",
            justifyContent: mini ? "center" : "flex-start",
            color: "rgba(255,255,255,0.38)",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.12)";
            (e.currentTarget as HTMLElement).style.color = "#F87171";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.38)";
          }}
        >
          <LogOut className="w-[17px] h-[17px] shrink-0" style={{ margin: mini ? 0 : "0 10px 0 6px" }} />
          {!mini && <span className="text-[13px] font-medium">{T("logout")}</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#F1F5F9" }}>

      {/* Desktop sidebar — collapsible */}
      <div className="hidden lg:block h-full z-20 shrink-0 transition-all duration-300" style={{ width: collapsed ? 68 : 256 }}>
        <SidebarContent mini={collapsed} />
      </div>

      {/* Mobile drawer */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <div className="relative z-10 flex flex-col h-full" style={{ width: 256 }}>
            <SidebarContent mini={false} />
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="absolute top-4 left-[268px] w-9 h-9 bg-white/15 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-white/25 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* SOS top banner */}
        {sosCount > 0 && (
          <Link href="/sos-alerts">
            <div
              className="relative overflow-hidden flex items-center justify-center gap-2 text-white cursor-pointer z-20"
              style={{ background: "linear-gradient(90deg, #B91C1C, #DC2626, #B91C1C)", padding: "7px 16px" }}
            >
              <span className="absolute inset-0 animate-pulse" style={{ background: "rgba(239,68,68,0.30)", animationDuration: "1s" }} />
              <AlertTriangle className="w-3.5 h-3.5 relative z-10" />
              <span className="relative z-10 text-xs font-bold tracking-wide">
                {sosCount} Active SOS Alert{sosCount !== 1 ? "s" : ""} — Tap for immediate response
              </span>
              <AlertTriangle className="w-3.5 h-3.5 relative z-10" />
            </div>
          </Link>
        )}

        {/* Header */}
        <header
          className="flex items-center justify-between shrink-0 z-10"
          style={{
            height: 60,
            padding: "0 20px 0 16px",
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            borderBottom: "1px solid rgba(99,102,241,0.10)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          {/* Left: collapse toggle + page name */}
          <div className="flex items-center gap-2">
            {/* Desktop collapse button */}
            <button
              onClick={() => setCollapsed(c => !c)}
              className="hidden lg:flex w-8 h-8 items-center justify-center rounded-lg transition-all duration-150 hover:bg-slate-100 text-slate-500 hover:text-slate-700"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed
                ? <PanelLeftOpen className="w-4 h-4" />
                : <PanelLeftClose className="w-4 h-4" />
              }
            </button>

            {/* Mobile hamburger */}
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors text-slate-500"
            >
              <Menu className="w-4.5 h-4.5" />
            </button>

            {/* Mobile logo */}
            <div className="lg:hidden w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #6366F1, #818CF8)" }}>
              <ShoppingBag className="w-4 h-4 text-white" />
            </div>

            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5">
              <span className="hidden sm:block text-xs text-slate-400 font-medium">AJKMart</span>
              <ChevronRight className="hidden sm:block w-3 h-3 text-slate-300" />
              <span className="text-sm font-semibold text-slate-700">{currentPageName}</span>
            </div>
          </div>

          {/* Center: command palette */}
          <button
            onClick={() => setCmdOpen(true)}
            className="hidden sm:flex items-center gap-2.5 px-3.5 py-2 rounded-xl border transition-all duration-150 group"
            style={{
              background: "rgba(248,250,252,0.9)",
              borderColor: "rgba(99,102,241,0.18)",
              minWidth: 200,
              maxWidth: 340,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(99,102,241,0.4)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(99,102,241,0.18)"}
          >
            <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#6366F1" }} />
            <span className="text-xs flex-1 text-left" style={{ color: "#94A3B8" }}>{T("search_placeholder")}</span>
            <kbd
              className="hidden md:inline-flex items-center gap-0.5 px-1.5 rounded text-[10px] font-mono"
              style={{ background: "rgba(99,102,241,0.08)", color: "#A5B4FC", border: "1px solid rgba(99,102,241,0.15)" }}
            >
              ⌘K
            </kbd>
          </button>

          {/* Right actions */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Mobile search */}
            <button
              onClick={() => setCmdOpen(true)}
              className="sm:hidden w-8 h-8 flex items-center justify-center rounded-lg border hover:bg-slate-50 transition-colors"
              style={{ borderColor: "rgba(99,102,241,0.18)" }}
            >
              <Search className="w-4 h-4" style={{ color: "#6366F1" }} />
            </button>

            {/* Live indicator */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.15)" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[11px] font-semibold text-emerald-600">{T("live")}</span>
            </div>

            {/* SOS badge in header */}
            {sosCount > 0 && (
              <Link href="/sos-alerts">
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg cursor-pointer transition-all animate-pulse"
                  style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)", color: "#DC2626" }}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-bold">{sosCount} SOS</span>
                </div>
              </Link>
            )}

            {/* Language selector — desktop */}
            <div className="relative hidden sm:block" ref={langRef}>
              <button
                onClick={() => setLangOpen(o => !o)}
                disabled={langLoading}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all duration-150 hover:bg-slate-50"
                style={{ borderColor: "rgba(0,0,0,0.08)", color: "#64748B" }}
              >
                <Globe className="w-3.5 h-3.5" />
                {currentLangLabel}
                <ChevronDown className={`w-3 h-3 transition-transform ${langOpen ? "rotate-180" : ""}`} />
              </button>
              {langOpen && (
                <div
                  className="absolute right-0 top-full mt-1.5 rounded-xl overflow-hidden z-50"
                  style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", minWidth: 140 }}
                >
                  {LANGUAGE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setLanguage(opt.value as "en" | "ur"); setLangOpen(false); }}
                      className="w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2"
                      style={{
                        fontWeight: language === opt.value ? 600 : 400,
                        color: language === opt.value ? "#6366F1" : "#374151",
                        background: language === opt.value ? "rgba(99,102,241,0.06)" : "transparent",
                      }}
                      onMouseEnter={e => { if (language !== opt.value) (e.currentTarget as HTMLElement).style.background = "#F8FAFC"; }}
                      onMouseLeave={e => { if (language !== opt.value) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                    >
                      <Globe className="w-3.5 h-3.5" />
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* User avatar + menu */}
            <div className="relative hidden sm:block" ref={userRef}>
              <button
                onClick={() => setUserMenuOpen(o => !o)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-xl transition-all duration-150 hover:bg-slate-50"
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: "linear-gradient(135deg, #6366F1, #818CF8)", color: "#fff", boxShadow: "0 2px 6px rgba(99,102,241,0.3)" }}
                >
                  A
                </div>
                <ChevronDown className={`w-3 h-3 transition-transform text-slate-400 ${userMenuOpen ? "rotate-180" : ""}`} />
              </button>
              {userMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-1.5 rounded-xl overflow-hidden z-50"
                  style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", minWidth: 180 }}
                >
                  <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                    <p className="text-sm font-semibold text-slate-700">Administrator</p>
                    <p className="text-xs text-slate-400">admin@ajkmart.pk</p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 text-red-500 transition-colors"
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.06)"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                  >
                    <LogOut className="w-4 h-4" />
                    {T("logout")}
                  </button>
                </div>
              )}
            </div>

            {/* Mobile logout */}
            <button
              onClick={handleLogout}
              className="sm:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 transition-colors text-slate-400 hover:text-red-500"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto pb-20 lg:pb-6" style={{ background: "#F1F5F9" }}>
          <div className="max-w-7xl mx-auto p-3 sm:p-5 lg:p-7 animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out">
            {children}
          </div>
        </main>

        {/* Mobile bottom nav */}
        <nav
          className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t safe-area-inset-bottom"
          style={{
            background: "rgba(255,255,255,0.97)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            borderColor: "rgba(99,102,241,0.10)",
            boxShadow: "0 -4px 24px rgba(0,0,0,0.06)",
          }}
        >
          <div className="flex items-stretch h-16">
            {BOTTOM_NAV.map(item => {
              const active = item.href !== "__more__" && isActive(item.href);
              const Icon = item.icon;
              const hasSosAlert = item.isSos && sosCount > 0;

              if (item.href === "__more__") {
                return (
                  <button
                    key="more"
                    onClick={() => setIsMobileMenuOpen(true)}
                    className="flex-1 flex flex-col items-center justify-center gap-1"
                    style={{ color: "#94A3B8" }}
                  >
                    <Menu className="w-5 h-5" />
                    <span className="text-[10px] font-semibold">{T("navMore")}</span>
                  </button>
                );
              }

              return (
                <Link key={item.href} href={item.href} className="flex-1">
                  <div
                    className="flex flex-col items-center justify-center h-full gap-1 transition-all"
                    style={{
                      color: hasSosAlert ? "#DC2626" : active ? "#6366F1" : "#94A3B8",
                    }}
                  >
                    {hasSosAlert ? (
                      <div className="relative">
                        <div className="absolute inset-0 rounded-full animate-ping" style={{ background: "rgba(220,38,38,0.2)" }} />
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center shadow-lg"
                          style={{ background: "linear-gradient(135deg, #DC2626, #EF4444)", boxShadow: "0 4px 12px rgba(220,38,38,0.4)" }}
                        >
                          <Icon className="w-4.5 h-4.5 text-white" />
                        </div>
                        <span
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 text-white text-[9px] font-black rounded-full flex items-center justify-center"
                          style={{ background: "#fff", color: "#DC2626", border: "1.5px solid #FECACA", boxShadow: "0 1px 4px rgba(0,0,0,0.1)" }}
                        >
                          {sosCount > 9 ? "9+" : sosCount}
                        </span>
                      </div>
                    ) : (
                      <div className="relative">
                        {active && (
                          <span
                            className="absolute -inset-1.5 rounded-xl"
                            style={{ background: "rgba(99,102,241,0.10)" }}
                          />
                        )}
                        <Icon className="w-5 h-5 relative z-10" />
                      </div>
                    )}
                    <span className="text-[10px] font-semibold">
                      {hasSosAlert ? "SOS!" : T(item.nameKey)}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
