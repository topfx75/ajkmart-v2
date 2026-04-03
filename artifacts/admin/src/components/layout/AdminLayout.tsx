import React, { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  ShoppingBag,
  Car,
  Pill,
  Box,
  PackageSearch,
  FolderTree,
  Megaphone,
  Receipt,
  Settings2,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Zap,
  AppWindow,
  Store,
  Bike,
  Ticket,
  BellRing,
  BanknoteIcon,
  ArrowDownToLine,
  Search,
  Globe,
  Shield,
  Navigation,
  AlertTriangle,
  Star,
  BadgeCheck,
  Layers,
  Wallet,
  CreditCard,
  FileText,
  Lock,
  ToggleLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandPalette } from "@/components/CommandPalette";
import { useLanguage } from "@/lib/useLanguage";
import { tDual, type TranslationKey, LANGUAGE_OPTIONS } from "@workspace/i18n";
import { io, type Socket } from "socket.io-client";
import { fetcher } from "@/lib/api";

type NavGroup = {
  labelKey: TranslationKey;
  items: { nameKey: TranslationKey; href: string; icon: React.ElementType; sosBadge?: boolean }[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: "navOperations",
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
    items: [
      { nameKey: "navVendors",    href: "/vendors",     icon: Store },
      { nameKey: "navProducts",   href: "/products",    icon: PackageSearch },
      { nameKey: "navCategories", href: "/categories",  icon: FolderTree },
      { nameKey: "navFlashDeals", href: "/flash-deals", icon: Zap },
    ],
  },
  {
    labelKey: "navFinancials",
    items: [
      { nameKey: "navTransactions",    href: "/transactions",     icon: Receipt },
      { nameKey: "navWithdrawals",     href: "/withdrawals",      icon: Wallet },
      { nameKey: "navDepositRequests", href: "/deposit-requests", icon: CreditCard },
      { nameKey: "navKyc",             href: "/kyc",              icon: BadgeCheck },
    ],
  },
  {
    labelKey: "navSafetyAndSecurity",
    items: [
      { nameKey: "navSosAlerts",       href: "/sos-alerts",  icon: AlertTriangle, sosBadge: true },
      { nameKey: "navAuditLogs",       href: "/security",    icon: FileText },
      { nameKey: "navUserPermissions", href: "/users",       icon: Lock },
    ],
  },
  {
    labelKey: "navConfig",
    items: [
      { nameKey: "navSettings",        href: "/settings",      icon: Settings2 },
      { nameKey: "navFeatureToggles",  href: "/app-management", icon: ToggleLeft },
      { nameKey: "navBanners",         href: "/banners",       icon: Layers },
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

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const { language, setLanguage, loading: langLoading } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  /* ── Live SOS badge count ── */
  const [sosCount, setSosCount] = useState(0);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    /* Initial fetch of unresolved SOS count (pending + acknowledged) */
    fetcher("/sos/alerts?limit=1")
      .then((data: { activeCount?: number }) => { if (typeof data.activeCount === "number") setSosCount(data.activeCount); })
      .catch(() => {});

    /* Subscribe to real-time SOS events for badge updates */
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
      /* Haptic feedback on mobile */
      if ("vibrate" in navigator) {
        navigator.vibrate([200, 100, 200]);
      }
    });
    socket.on("sos:acknowledged", () => { /* unresolved count unchanged — still active */ });
    socket.on("sos:resolved", () => setSosCount(c => Math.max(0, c - 1)));

    return () => { socket.disconnect(); socketRef.current = null; };
  }, []);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen(o => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
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

  const SidebarContent = () => (
    <div className="flex flex-col h-full w-64 shadow-2xl" style={{ background: "#0F172A" }}>
      <div className="h-16 flex items-center px-6 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center mr-3 shadow-lg shadow-indigo-500/20">
          <ShoppingBag className="w-5 h-5 text-white" />
        </div>
        <span className="font-display font-bold text-xl tracking-tight text-white">AJKMart</span>
        <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded-md">Admin</span>
      </div>

      {/* Live SOS alert banner — pulsing red */}
      {sosCount > 0 && (
        <Link href="/sos-alerts">
          <div className="mx-3 mt-2 relative overflow-hidden flex items-center gap-2 bg-red-600 text-white rounded-xl px-3 py-2 cursor-pointer hover:bg-red-700 transition-colors">
            {/* Ripple animation */}
            <span className="absolute inset-0 rounded-xl animate-ping bg-red-500/30" style={{ animationDuration: "1.5s" }} />
            <AlertTriangle className="w-4 h-4 flex-shrink-0 animate-pulse relative z-10" />
            <div className="flex-1 min-w-0 relative z-10">
              <p className="text-[11px] font-bold leading-tight">
                {sosCount} Active SOS Alert{sosCount !== 1 ? "s" : ""}
              </p>
              <p className="text-[10px] text-red-200 leading-tight">Tap to respond</p>
            </div>
            <span className="text-xs font-black bg-white text-red-600 rounded-full min-w-[20px] h-5 flex items-center justify-center px-1 relative z-10">
              {sosCount}
            </span>
          </div>
        </Link>
      )}

      <div className="flex-1 overflow-y-auto py-3 px-3 space-y-5">
        {NAV_GROUPS.map(group => (
          <div key={group.labelKey}>
            <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.30)" }}>{T(group.labelKey)}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href);
                const Icon = item.icon;
                const showSosBadge = item.sosBadge && sosCount > 0;
                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      className={`
                        flex items-center px-3 py-2.5 rounded-xl transition-all duration-150 cursor-pointer group
                        ${active
                          ? "bg-indigo-600 text-white shadow-md font-semibold"
                          : "hover:bg-white/8"
                        }
                      `}
                      style={!active ? { color: "rgba(255,255,255,0.65)" } : {}}
                    >
                      <div className="relative mr-3 flex-shrink-0">
                        <Icon className={`w-[18px] h-[18px] ${active ? "text-white" : "group-hover:text-white/90"}`}
                          style={!active ? { color: "rgba(255,255,255,0.45)" } : {}} />
                        {showSosBadge && !active && (
                          <>
                            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-500 animate-ping opacity-75" />
                            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-600 text-white text-[9px] font-black rounded-full flex items-center justify-center">
                              {sosCount > 9 ? "9+" : sosCount}
                            </span>
                          </>
                        )}
                      </div>
                      <span className="text-sm flex-1">{T(item.nameKey)}</span>
                      {showSosBadge && active && (
                        <span className="text-[10px] font-black bg-white/25 text-white px-1.5 py-0.5 rounded-full">
                          {sosCount > 9 ? "9+" : sosCount}
                        </span>
                      )}
                      {!showSosBadge && active && <ChevronRight className="w-4 h-4 text-white/70 ml-1" />}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="p-3 shrink-0 space-y-1" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        {/* Language selector — visible in sidebar on mobile only */}
        <div className="lg:hidden">
          <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.30)" }}>Language</p>
          <div className="flex flex-wrap gap-1 px-1">
            {LANGUAGE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setLanguage(opt.value as any)}
                disabled={langLoading}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                  language === opt.value
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "hover:bg-white/10"
                }`}
                style={language !== opt.value ? { color: "rgba(255,255,255,0.60)" } : {}}
              >
                <Globe className="w-3.5 h-3.5" />
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center w-full px-3 py-2.5 rounded-xl transition-colors text-sm hover:bg-red-500/15 hover:text-red-400"
          style={{ color: "rgba(255,255,255,0.55)" }}
        >
          <LogOut className="w-[18px] h-[18px] mr-3" />
          {T("logout")}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#F8FAFC" }}>
      <div className="hidden lg:block h-full z-20 shrink-0">
        <SidebarContent />
      </div>

      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <div className="relative z-10 flex flex-col">
            <SidebarContent />
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="absolute top-4 right-4 w-10 h-10 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Glassmorphism sticky header */}
        {sosCount > 0 && (
          <div className="relative overflow-hidden bg-red-600 text-white text-center text-xs font-bold py-1.5 z-20">
            <span className="absolute inset-0 animate-pulse bg-red-500/40" style={{ animationDuration: "1s" }} />
            <span className="relative z-10 flex items-center justify-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5" />
              {sosCount} Active SOS Alert{sosCount !== 1 ? "s" : ""} — Immediate response required
              <AlertTriangle className="w-3.5 h-3.5" />
            </span>
          </div>
        )}

        <header
          className="h-14 sm:h-16 flex items-center justify-between px-3 sm:px-5 lg:px-8 z-10 sticky top-0 shrink-0 border-b"
          style={{
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            background: "rgba(248, 250, 252, 0.85)",
            borderColor: "rgba(99, 102, 241, 0.12)",
          }}
        >
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden h-9 w-9"
              onClick={() => setIsMobileMenuOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 lg:hidden rounded-lg bg-indigo-600 flex items-center justify-center">
                <ShoppingBag className="w-4 h-4 text-white" />
              </div>
              <h1 className="font-display font-semibold text-base sm:text-lg text-foreground">
                {currentPageName}
              </h1>
            </div>
          </div>

          {/* Command Palette — center, prominent */}
          <button
            onClick={() => setCmdOpen(true)}
            className="hidden sm:flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl border bg-white/70 hover:bg-white transition-colors text-muted-foreground hover:text-foreground group shadow-sm"
            style={{ borderColor: "rgba(99,102,241,0.20)", minWidth: 200, maxWidth: 360 }}
          >
            <Search className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline text-xs font-medium flex-1 text-left">{T("search_placeholder")}</span>
            <kbd className="hidden md:inline-flex items-center gap-0.5 rounded border px-1.5 font-mono text-[10px] text-muted-foreground/70"
              style={{ borderColor: "rgba(99,102,241,0.20)", background: "rgba(99,102,241,0.06)" }}>
              Ctrl/⌘K
            </kbd>
          </button>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Mobile search icon */}
            <button
              onClick={() => setCmdOpen(true)}
              className="sm:hidden h-9 w-9 flex items-center justify-center rounded-xl border hover:bg-muted/60 transition-colors"
              style={{ borderColor: "rgba(99,102,241,0.20)" }}
            >
              <Search className="w-4 h-4 text-indigo-500" />
            </button>

            <div className="hidden sm:flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-medium text-muted-foreground">{T("live")}</span>
            </div>

            {/* SOS alert badge in header */}
            {sosCount > 0 && (
              <Link href="/sos-alerts">
                <div className="flex items-center gap-1.5 bg-red-100 text-red-700 border border-red-200 rounded-xl px-2.5 py-1.5 cursor-pointer hover:bg-red-200 transition-colors animate-pulse">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="text-xs font-bold">{sosCount}</span>
                </div>
              </Link>
            )}

            {/* Language Selector — desktop only */}
            <div className="relative hidden sm:block">
              <button
                onClick={() => setLangOpen(o => !o)}
                disabled={langLoading}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-lg hover:bg-muted border border-border/50"
                title="Change language"
              >
                <Globe className="w-3.5 h-3.5" />
                <span className="font-medium">{currentLangLabel}</span>
              </button>
              {langOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-border rounded-xl shadow-lg z-50 min-w-[140px] overflow-hidden">
                  {LANGUAGE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setLanguage(opt.value as any); setLangOpen(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 ${language === opt.value ? "font-bold text-indigo-600 bg-indigo-50" : "text-foreground"}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="hidden sm:flex w-9 h-9 rounded-full bg-indigo-100 items-center justify-center text-indigo-600 font-bold text-sm shadow-inner">
              A
            </div>

            {/* Mobile-only compact logout */}
            <button
              onClick={handleLogout}
              className="sm:hidden p-2 rounded-xl hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />

        <main className="flex-1 overflow-y-auto p-3 sm:p-5 lg:p-8 pb-20 lg:pb-8" style={{ background: "#F8FAFC" }}>
          <div className="max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out">
            {children}
          </div>
        </main>

        {/* Mobile bottom nav */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t safe-area-inset-bottom"
          style={{
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            background: "rgba(255,255,255,0.96)",
            borderColor: "rgba(99,102,241,0.12)",
          }}
        >
          <div className="flex items-stretch h-16">
            {BOTTOM_NAV.map((item) => {
              const active = item.href !== "__more__" && isActive(item.href);
              const Icon = item.icon;
              const hasSosAlert = item.isSos && sosCount > 0;

              if (item.href === "__more__") {
                return (
                  <button
                    key="more"
                    onClick={() => setIsMobileMenuOpen(true)}
                    className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors text-muted-foreground relative"
                  >
                    <Menu className="w-5 h-5" />
                    <span className="text-[10px] font-semibold">{T("navMore")}</span>
                  </button>
                );
              }

              return (
                <Link key={item.href} href={item.href} className="flex-1">
                  <div className={`flex flex-col items-center justify-center h-full gap-1 transition-colors ${
                    hasSosAlert ? "text-red-600" : active ? "text-indigo-600" : "text-muted-foreground"
                  }`}>
                    <div className={`relative ${active && !hasSosAlert ? "after:absolute after:-bottom-1 after:left-1/2 after:-translate-x-1/2 after:w-4 after:h-0.5 after:bg-indigo-600 after:rounded-full" : ""}`}>
                      {hasSosAlert ? (
                        <div className="relative">
                          <div className="absolute inset-0 rounded-full bg-red-500/20 animate-ping" />
                          <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center shadow-lg shadow-red-500/40">
                            <Icon className="w-4 h-4 text-white" />
                          </div>
                          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white text-red-600 text-[9px] font-black rounded-full flex items-center justify-center border border-red-200 shadow">
                            {sosCount > 9 ? "9+" : sosCount}
                          </span>
                        </div>
                      ) : (
                        <Icon className={`w-5 h-5 ${active ? "text-indigo-600" : ""}`} />
                      )}
                    </div>
                    <span className={`text-[10px] font-semibold ${hasSosAlert ? "text-red-600" : active ? "text-indigo-600" : ""}`}>
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
