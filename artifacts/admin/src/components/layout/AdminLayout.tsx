import React, { useState, useEffect, useRef, useCallback } from "react";
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
  Bus,
  Truck,
  Heart,
  Trash2,
  ShieldOff,
  BellOff,
  DollarSign,
  Bike,
  Package,
  Star,
  Megaphone,
  Bell,
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
      { nameKey: "navVanService",    href: "/van",             icon: Bus },
      { nameKey: "navPharmacy",      href: "/pharmacy",        icon: Pill },
      { nameKey: "navParcels" as TranslationKey,      href: "/parcel",          icon: Package },
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
      { nameKey: "navWishlists" as TranslationKey,   href: "/wishlists",    icon: Heart },
      { nameKey: "navPromoCodes" as TranslationKey,  href: "/promo-codes",  icon: Ticket },
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
      { nameKey: "navReviews" as TranslationKey,        href: "/reviews",     icon: Star },
    ],
  },
  {
    labelKey: "navRiderControls",
    color: "#F97316",
    items: [
      { nameKey: "navRiders" as TranslationKey,          href: "/riders",            icon: Bike },
      { nameKey: "navGpsAlerts",        href: "/gps-alerts",        icon: ShieldOff },
      { nameKey: "navVanBoarding",      href: "/van-boarding",      icon: Bus },
      { nameKey: "navCodVerifications", href: "/cod-verifications", icon: DollarSign },
      { nameKey: "navSilenceMode",      href: "/silence-mode",      icon: BellOff },
    ],
  },
  {
    labelKey: "navAccountConditions",
    color: "#8B5CF6",
    items: [
      { nameKey: "navConditionsHub",   href: "/account-conditions", icon: Shield },
      { nameKey: "navConditionRules",  href: "/condition-rules",    icon: Settings2 },
      { nameKey: "navDeletionRequests" as TranslationKey, href: "/deletion-requests", icon: Trash2 },
    ],
  },
  {
    labelKey: "navConfig",
    color: "#F59E0B",
    items: [
      { nameKey: "navSettings",        href: "/settings",        icon: Settings2 },
      { nameKey: "navFeatureToggles",  href: "/app-management",  icon: ToggleLeft },
      { nameKey: "navDeliveryAccess",  href: "/delivery-access", icon: Truck },
      { nameKey: "navBanners",         href: "/banners",         icon: Layers },
      { nameKey: "navBroadcast" as TranslationKey,       href: "/broadcast",       icon: Megaphone },
      { nameKey: "navNotifications" as TranslationKey,   href: "/notifications",   icon: Bell },
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
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("ajkmart_sidebar_collapsed") === "true"; } catch { return false; }
  });
  const [cmdOpen, setCmdOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { language, setLanguage, loading: langLoading } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    const active = NAV_GROUPS.find(g => g.items.some(i => isActivePath(location, i.href)));
    return new Set(active ? [active.labelKey] : [NAV_GROUPS[0].labelKey]);
  });

  const [sosCount, setSosCount] = useState(0);
  const [socketToken, setSocketToken] = useState(() => localStorage.getItem("ajkmart_admin_token") ?? "");
  const socketRef = useRef<Socket | null>(null);
  const langRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const mobileDrawerRef = useRef<HTMLDivElement>(null);

  const toggleCollapsed = useCallback(() => {
    setCollapsed(c => {
      const next = !c;
      try { localStorage.setItem("ajkmart_sidebar_collapsed", String(next)); } catch {}
      return next;
    });
  }, []);

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "ajkmart_admin_token") setSocketToken(e.newValue ?? "");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    fetcher("/sos/alerts?limit=1")
      .then((data: { activeCount?: number }) => { if (typeof data.activeCount === "number") setSosCount(data.activeCount); })
      .catch(() => {});

    const getAdminToken = () => localStorage.getItem("ajkmart_admin_token") ?? "";
    const socket = io(window.location.origin, {
      path: "/api/socket.io",
      query: { rooms: "admin-fleet" },
      auth: (cb: (data: Record<string, string>) => void) => cb({ adminToken: getAdminToken() }),
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
  }, [socketToken]);

  useEffect(() => {
    setIsMobileMenuOpen(false);
    const active = NAV_GROUPS.find(g => g.items.some(i => isActivePath(location, i.href)));
    if (active) {
      setExpandedGroups(prev => {
        if (prev.has(active.labelKey)) return prev;
        const next = new Set(prev);
        next.add(active.labelKey);
        return next;
      });
    }
  }, [location]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); setCmdOpen(o => !o); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isMobileMenuOpen]);

  const handleLogout = () => {
    localStorage.removeItem("ajkmart_admin_token");
    setLocation("/login");
  };

  const isActive = (href: string) => isActivePath(location, href);

  const currentItem = navItems.find(i => isActive(i.href));
  const currentPageName = currentItem ? T(currentItem.nameKey) : "AJKMart Admin";
  const currentLangLabel = LANGUAGE_OPTIONS.find(o => o.value === language)?.label || language.toUpperCase();

  const sidebarWidth = collapsed ? 72 : 264;

  const SidebarContent = ({ mini, isMobile }: { mini?: boolean; isMobile?: boolean }) => (
    <div
      className="flex flex-col h-full select-none"
      style={{
        width: isMobile ? 280 : mini ? 72 : 264,
        background: "linear-gradient(180deg, #0F172A 0%, #0B1120 50%, #0F172A 100%)",
        borderRight: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center shrink-0"
        style={{
          height: 64,
          padding: mini ? "0 16px" : "0 20px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)",
            boxShadow: "0 4px 16px rgba(99,102,241,0.4), inset 0 1px 1px rgba(255,255,255,0.15)",
          }}
        >
          <ShoppingBag className="w-5 h-5 text-white" />
        </div>
        {(!mini || isMobile) && (
          <div className="ml-3 overflow-hidden">
            <span className="font-bold text-[17px] tracking-tight text-white leading-tight block">AJKMart</span>
            <span className="text-[10px] font-semibold tracking-[0.15em] uppercase" style={{ color: "#818CF8" }}>Admin Console</span>
          </div>
        )}
        {isMobile && (
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="ml-auto w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4 text-white/50" />
          </button>
        )}
      </div>

      {/* SOS alert banner */}
      {sosCount > 0 && (
        <Link href="/sos-alerts" onClick={() => isMobile && setIsMobileMenuOpen(false)}>
          <div
            className="relative overflow-hidden flex items-center gap-2.5 cursor-pointer transition-opacity hover:opacity-90"
            style={{
              margin: mini ? "8px 8px" : "10px 12px",
              background: "linear-gradient(135deg, #DC2626, #B91C1C)",
              borderRadius: 14,
              padding: mini ? "10px" : "10px 14px",
              boxShadow: "0 4px 20px rgba(220,38,38,0.35)",
            }}
          >
            <span className="absolute inset-0 rounded-xl animate-ping" style={{ background: "rgba(239,68,68,0.2)", animationDuration: "2s" }} />
            <AlertTriangle className="w-4 h-4 text-white animate-pulse relative z-10 shrink-0" />
            {(!mini || isMobile) && (
              <div className="flex-1 min-w-0 relative z-10">
                <p className="text-[11px] font-bold text-white leading-tight">{sosCount} Active SOS</p>
                <p className="text-[10px] leading-tight" style={{ color: "rgba(255,255,255,0.7)" }}>Tap to respond</p>
              </div>
            )}
            <span
              className="relative z-10 text-[10px] font-black rounded-full flex items-center justify-center shrink-0"
              style={{ background: "rgba(255,255,255,0.2)", color: "#fff", minWidth: 22, height: 22, padding: "0 5px" }}
            >
              {sosCount}
            </span>
          </div>
        </Link>
      )}

      {/* Nav groups */}
      <div
        className="flex-1 overflow-y-auto py-2"
        style={{ scrollbarWidth: "none" }}
      >
        {NAV_GROUPS.map(group => {
          const isExpanded = expandedGroups.has(group.labelKey);
          const showMini = mini && !isMobile;
          const hasActiveItem = group.items.some(i => isActive(i.href));

          return (
            <div key={group.labelKey} className="mb-0.5" style={{ padding: showMini ? "0 8px" : "0 10px" }}>
              {/* Group header */}
              {showMini ? (
                <div className="flex justify-center py-2">
                  <div className="w-6 h-[2px] rounded-full" style={{ background: `${group.color}40` }} />
                </div>
              ) : (
                <button
                  onClick={() => toggleGroup(group.labelKey)}
                  className="flex items-center w-full gap-2 px-2.5 py-2 mt-1 rounded-lg transition-colors hover:bg-white/[0.04] group/header"
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0 transition-all" style={{ background: hasActiveItem ? group.color : `${group.color}60` }} />
                  <span
                    className="text-[10px] font-bold uppercase tracking-[0.12em] truncate flex-1 text-left transition-colors"
                    style={{ color: hasActiveItem ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.25)" }}
                  >
                    {T(group.labelKey)}
                  </span>
                  <ChevronDown
                    className="w-3 h-3 shrink-0 transition-transform duration-200"
                    style={{
                      color: "rgba(255,255,255,0.2)",
                      transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)",
                    }}
                  />
                </button>
              )}

              {/* Group items */}
              <div
                className="overflow-hidden transition-all duration-200 ease-out"
                style={{
                  maxHeight: showMini ? "none" : isExpanded ? `${group.items.length * 44}px` : "0px",
                  opacity: showMini ? 1 : isExpanded ? 1 : 0,
                }}
              >
                <div className="space-y-0.5 pb-1">
                  {group.items.map(item => {
                    const active = isActive(item.href);
                    const Icon = item.icon;
                    const showSosBadge = item.sosBadge && sosCount > 0;

                    return (
                      <Link key={item.href} href={item.href} onClick={() => isMobile && setIsMobileMenuOpen(false)}>
                        <div
                          title={showMini ? T(item.nameKey) : undefined}
                          className="flex items-center transition-all duration-150 cursor-pointer group relative"
                          style={{
                            borderRadius: 10,
                            padding: showMini ? "10px 0" : "8px 10px",
                            justifyContent: showMini ? "center" : "flex-start",
                            background: active
                              ? `linear-gradient(135deg, ${group.color}18 0%, ${group.color}0A 100%)`
                              : "transparent",
                            border: active ? `1px solid ${group.color}30` : "1px solid transparent",
                          }}
                          onMouseEnter={e => {
                            if (!active) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
                          }}
                          onMouseLeave={e => {
                            if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
                          }}
                        >
                          {active && !showMini && (
                            <span
                              className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full"
                              style={{ background: group.color }}
                            />
                          )}

                          <div className="relative shrink-0" style={{ margin: showMini ? 0 : "0 10px 0 6px" }}>
                            <Icon
                              className="w-[18px] h-[18px] transition-colors duration-150"
                              style={{ color: active ? group.color : showSosBadge ? "#EF4444" : "rgba(255,255,255,0.38)" }}
                            />
                            {showSosBadge && (
                              <>
                                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 animate-ping opacity-75" />
                                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-600 text-white text-[9px] font-black rounded-full flex items-center justify-center">
                                  {sosCount > 9 ? "9+" : sosCount}
                                </span>
                              </>
                            )}
                          </div>

                          {!showMini && (
                            <>
                              <span
                                className="text-[13px] flex-1 truncate transition-colors"
                                style={{
                                  color: active ? "#E0E7FF" : "rgba(255,255,255,0.58)",
                                  fontWeight: active ? 600 : 400,
                                }}
                              >
                                {T(item.nameKey)}
                              </span>
                              {showSosBadge && (
                                <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full" style={{ background: "rgba(239,68,68,0.2)", color: "#FCA5A5" }}>
                                  {sosCount > 9 ? "9+" : sosCount}
                                </span>
                              )}
                              {active && !showSosBadge && (
                                <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: `${group.color}60` }} />
                              )}
                            </>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom section */}
      <div className="shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: showMiniFooter(mini, isMobile) ? "12px 10px" : "14px 14px" }}>
        {/* Profile card */}
        <div
          className="flex items-center rounded-xl transition-all duration-150"
          style={{
            padding: showMiniFooter(mini, isMobile) ? "8px 0" : "10px 12px",
            justifyContent: showMiniFooter(mini, isMobile) ? "center" : "flex-start",
            background: showMiniFooter(mini, isMobile) ? "transparent" : "rgba(255,255,255,0.03)",
            border: showMiniFooter(mini, isMobile) ? "none" : "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
            style={{
              background: "linear-gradient(135deg, #6366F1, #8B5CF6)",
              color: "#fff",
              boxShadow: "0 2px 10px rgba(99,102,241,0.35)",
            }}
          >
            A
          </div>
          {!showMiniFooter(mini, isMobile) && (
            <div className="ml-2.5 flex-1 min-w-0">
              <p className="text-[12px] font-semibold truncate" style={{ color: "rgba(255,255,255,0.85)" }}>Administrator</p>
              <p className="text-[10px] truncate" style={{ color: "rgba(255,255,255,0.3)" }}>admin@ajkmart.pk</p>
            </div>
          )}
        </div>

        {/* Logout button */}
        <button
          onClick={handleLogout}
          title={showMiniFooter(mini, isMobile) ? "Logout" : undefined}
          className="flex items-center w-full rounded-xl transition-all duration-200 mt-2 group/logout"
          style={{
            padding: showMiniFooter(mini, isMobile) ? "9px 0" : "9px 12px",
            justifyContent: showMiniFooter(mini, isMobile) ? "center" : "flex-start",
            color: "rgba(255,255,255,0.3)",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.1)";
            (e.currentTarget as HTMLElement).style.color = "#F87171";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.3)";
          }}
        >
          <LogOut className="w-[17px] h-[17px] shrink-0" style={{ margin: showMiniFooter(mini, isMobile) ? 0 : "0 10px 0 4px" }} />
          {!showMiniFooter(mini, isMobile) && <span className="text-[13px] font-medium">{T("logout")}</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#F1F5F9" }}>
      {/* Desktop sidebar */}
      <div
        className="hidden lg:block h-full z-20 shrink-0 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{ width: sidebarWidth }}
      >
        <SidebarContent mini={collapsed} />
      </div>

      {/* Mobile drawer overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-[6px] transition-opacity duration-300"
            onClick={() => setIsMobileMenuOpen(false)}
            style={{ animation: "fadeIn 200ms ease-out" }}
          />
          <div
            ref={mobileDrawerRef}
            className="relative z-10 h-full"
            style={{
              width: 280,
              animation: "slideInLeft 250ms cubic-bezier(0.16,1,0.3,1)",
              boxShadow: "4px 0 32px rgba(0,0,0,0.3)",
            }}
          >
            <SidebarContent isMobile />
          </div>
        </div>
      )}

      {/* Main content area */}
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
            background: "rgba(255,255,255,0.95)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            borderBottom: "1px solid rgba(0,0,0,0.06)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
          }}
        >
          {/* Left */}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleCollapsed}
              className="hidden lg:flex w-8 h-8 items-center justify-center rounded-lg transition-all duration-150 hover:bg-slate-100 text-slate-400 hover:text-slate-600"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>

            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden w-9 h-9 flex items-center justify-center rounded-xl hover:bg-slate-100 transition-colors text-slate-500"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="lg:hidden w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}>
              <ShoppingBag className="w-3.5 h-3.5 text-white" />
            </div>

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
              borderColor: "rgba(0,0,0,0.08)",
              minWidth: 200,
              maxWidth: 340,
              boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(99,102,241,0.3)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,0,0,0.08)"}
          >
            <Search className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
            <span className="text-xs flex-1 text-left text-slate-400">{T("search_placeholder")}</span>
            <kbd
              className="hidden md:inline-flex items-center gap-0.5 px-1.5 rounded text-[10px] font-mono"
              style={{ background: "rgba(0,0,0,0.04)", color: "#94A3B8", border: "1px solid rgba(0,0,0,0.06)" }}
            >
              ⌘K
            </kbd>
          </button>

          {/* Right actions */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              onClick={() => setCmdOpen(true)}
              className="sm:hidden w-8 h-8 flex items-center justify-center rounded-xl border hover:bg-slate-50 transition-colors"
              style={{ borderColor: "rgba(0,0,0,0.08)" }}
            >
              <Search className="w-4 h-4 text-slate-400" />
            </button>

            {/* Live indicator */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.12)" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[11px] font-semibold text-emerald-600">{T("live")}</span>
            </div>

            {/* SOS badge */}
            {sosCount > 0 && (
              <Link href="/sos-alerts">
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg cursor-pointer transition-all animate-pulse"
                  style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#DC2626" }}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-bold">{sosCount} SOS</span>
                </div>
              </Link>
            )}

            {/* Language selector */}
            <div className="relative hidden sm:block" ref={langRef}>
              <button
                onClick={() => setLangOpen(o => !o)}
                disabled={langLoading}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all duration-150 hover:bg-slate-50"
                style={{ borderColor: "rgba(0,0,0,0.08)", color: "#64748B" }}
              >
                <Globe className="w-3.5 h-3.5" />
                {currentLangLabel}
                <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${langOpen ? "rotate-180" : ""}`} />
              </button>
              {langOpen && (
                <div
                  className="absolute right-0 top-full mt-1.5 rounded-xl overflow-hidden z-50"
                  style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 8px 30px rgba(0,0,0,0.12)", minWidth: 150 }}
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

            {/* User menu */}
            <div className="relative hidden sm:block" ref={userRef}>
              <button
                onClick={() => setUserMenuOpen(o => !o)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-xl transition-all duration-150 hover:bg-slate-50"
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "#fff", boxShadow: "0 2px 6px rgba(99,102,241,0.3)" }}
                >
                  A
                </div>
                <ChevronDown className={`w-3 h-3 transition-transform duration-200 text-slate-400 ${userMenuOpen ? "rotate-180" : ""}`} />
              </button>
              {userMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-1.5 rounded-xl overflow-hidden z-50"
                  style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 8px 30px rgba(0,0,0,0.12)", minWidth: 190 }}
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
              className="sm:hidden w-8 h-8 flex items-center justify-center rounded-xl hover:bg-red-50 transition-colors text-slate-400 hover:text-red-500"
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
            borderColor: "rgba(0,0,0,0.06)",
            boxShadow: "0 -2px 20px rgba(0,0,0,0.04)",
          }}
        >
          <div className="flex items-stretch h-16 max-w-md mx-auto">
            {BOTTOM_NAV.map(item => {
              const active = item.href !== "__more__" && isActive(item.href);
              const Icon = item.icon;
              const hasSosAlert = item.isSos && sosCount > 0;

              if (item.href === "__more__") {
                return (
                  <button
                    key="more"
                    onClick={() => setIsMobileMenuOpen(true)}
                    className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors"
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
                    style={{ color: hasSosAlert ? "#DC2626" : active ? "#6366F1" : "#94A3B8" }}
                  >
                    {hasSosAlert ? (
                      <div className="relative">
                        <div className="absolute inset-0 rounded-full animate-ping" style={{ background: "rgba(220,38,38,0.2)" }} />
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center shadow-lg"
                          style={{ background: "linear-gradient(135deg, #DC2626, #EF4444)", boxShadow: "0 4px 12px rgba(220,38,38,0.4)" }}
                        >
                          <Icon className="w-4 h-4 text-white" />
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
                          <span className="absolute -inset-1.5 rounded-xl" style={{ background: "rgba(99,102,241,0.10)" }} />
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

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideInLeft {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}

function isActivePath(location: string, href: string): boolean {
  if (href === "/dashboard") return location === "/dashboard" || location === "/";
  return location.startsWith(href);
}

function showMiniFooter(mini?: boolean, isMobile?: boolean): boolean {
  return !!mini && !isMobile;
}
