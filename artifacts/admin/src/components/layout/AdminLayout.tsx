import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  ShoppingBag,
  Car,
  Pill,
  Box,
  PackageSearch,
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandPalette } from "@/components/CommandPalette";
import { useLanguage } from "@/lib/useLanguage";
import { tDual, type TranslationKey, LANGUAGE_OPTIONS } from "@workspace/i18n";

type NavGroup = {
  labelKey: TranslationKey;
  items: { nameKey: TranslationKey; href: string; icon: any }[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: "navOverview",
    items: [
      { nameKey: "navDashboard",    href: "/dashboard",   icon: LayoutDashboard },
    ],
  },
  {
    labelKey: "navCustomerApp",
    items: [
      { nameKey: "navOrders",       href: "/orders",       icon: ShoppingBag },
      { nameKey: "navPharmacy",     href: "/pharmacy",     icon: Pill },
      { nameKey: "navParcels",      href: "/parcel",       icon: Box },
    ],
  },
  {
    labelKey: "navRiderApp",
    items: [
      { nameKey: "navRides",          href: "/rides",            icon: Car },
      { nameKey: "navRiders",         href: "/riders",           icon: Bike },
      { nameKey: "navLiveRidersMap",  href: "/live-riders-map",  icon: Navigation },
    ],
  },
  {
    labelKey: "navVendorPortal",
    items: [
      { nameKey: "navVendors",      href: "/vendors",      icon: Store },
      { nameKey: "navProducts",     href: "/products",     icon: PackageSearch },
      { nameKey: "navFlashDeals",   href: "/flash-deals",  icon: Zap },
      { nameKey: "navPromoCodes",   href: "/promo-codes",  icon: Ticket },
    ],
  },
  {
    labelKey: "navUserManagement",
    items: [
      { nameKey: "navUsers",        href: "/users",        icon: Users },
    ],
  },
  {
    labelKey: "navFinance",
    items: [
      { nameKey: "navTransactions",    href: "/transactions",     icon: Receipt },
      { nameKey: "navWithdrawals",     href: "/withdrawals",      icon: BanknoteIcon },
      { nameKey: "navDepositRequests", href: "/deposit-requests", icon: ArrowDownToLine },
    ],
  },
  {
    labelKey: "navCommunication",
    items: [
      { nameKey: "navNotifications", href: "/notifications",  icon: BellRing },
      { nameKey: "navBroadcast",     href: "/broadcast",      icon: Megaphone },
    ],
  },
  {
    labelKey: "navSecurity",
    items: [
      { nameKey: "navSecurityPage",  href: "/security",       icon: Shield },
      { nameKey: "navSosAlerts",     href: "/sos-alerts",     icon: AlertTriangle },
    ],
  },
  {
    labelKey: "navPlatform",
    items: [
      { nameKey: "navAppManagement", href: "/app-management", icon: AppWindow },
      { nameKey: "navSettings",      href: "/settings",       icon: Settings2 },
    ],
  },
];

const BOTTOM_NAV: { nameKey: TranslationKey; href: string; icon: any }[] = [
  { nameKey: "navDashboard", href: "/dashboard", icon: LayoutDashboard },
  { nameKey: "navOrders",    href: "/orders",    icon: ShoppingBag },
  { nameKey: "navRides",     href: "/rides",     icon: Car },
  { nameKey: "navUsers",     href: "/users",     icon: Users },
  { nameKey: "navMore",      href: "__more__",   icon: Menu },
];

const navItems = NAV_GROUPS.flatMap(g => g.items);

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const { language, setLanguage, loading: langLoading } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

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
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground w-64 shadow-2xl">
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border/50 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center mr-3 shadow-lg shadow-primary/20">
          <ShoppingBag className="w-5 h-5 text-white" />
        </div>
        <span className="font-display font-bold text-xl tracking-tight">AJKMart</span>
        <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 px-1.5 py-0.5 rounded-md">Admin</span>
      </div>

      <div className="flex-1 overflow-y-auto py-3 px-3 space-y-4">
        {NAV_GROUPS.map(group => (
          <div key={group.labelKey}>
            <p className="px-3 mb-1.5 text-[10px] font-bold text-sidebar-foreground/35 uppercase tracking-widest">{T(group.labelKey)}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href);
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      className={`
                        flex items-center px-3 py-2.5 rounded-xl transition-all duration-150 cursor-pointer group
                        ${active
                          ? "bg-primary text-primary-foreground shadow-md shadow-primary/20 font-semibold"
                          : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        }
                      `}
                    >
                      <Icon className={`w-[18px] h-[18px] mr-3 shrink-0 ${active ? "text-white" : "text-sidebar-foreground/50 group-hover:text-sidebar-accent-foreground"}`} />
                      <span className="text-sm flex-1">{T(item.nameKey)}</span>
                      {active && <ChevronRight className="w-4 h-4 text-white/70 ml-1" />}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-sidebar-border/50 shrink-0 space-y-1">
        {/* Language selector — visible in sidebar on mobile only */}
        <div className="lg:hidden">
          <p className="px-3 mb-1.5 text-[10px] font-bold text-sidebar-foreground/35 uppercase tracking-widest">Language</p>
          <div className="flex flex-wrap gap-1 px-1">
            {LANGUAGE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setLanguage(opt.value as any)}
                disabled={langLoading}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                  language === opt.value
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center w-full px-3 py-2.5 rounded-xl text-sidebar-foreground/70 hover:bg-red-500/10 hover:text-red-500 transition-colors text-sm"
        >
          <LogOut className="w-[18px] h-[18px] mr-3" />
          {T("logout")}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
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
        <header className="h-14 sm:h-16 flex items-center justify-between px-3 sm:px-5 lg:px-8 bg-white/90 backdrop-blur-md border-b border-border/50 z-10 sticky top-0 shrink-0">
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
              <div className="w-7 h-7 lg:hidden rounded-lg bg-primary flex items-center justify-center">
                <ShoppingBag className="w-4 h-4 text-white" />
              </div>
              <h1 className="font-display font-semibold text-base sm:text-lg text-foreground">
                {currentPageName}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => setCmdOpen(true)}
              className="hidden sm:flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-xl border border-border/60 bg-muted/50 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground group"
            >
              <Search className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-xs font-medium">{T("search_placeholder")}</span>
              <kbd className="hidden md:inline-flex items-center gap-0.5 rounded border border-border bg-white px-1.5 font-mono text-[10px] text-muted-foreground/70 group-hover:border-primary/30">
                ⌘K
              </kbd>
            </button>

            <div className="hidden sm:flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs font-medium text-muted-foreground">{T("live")}</span>
            </div>

            {/* Language Selector — desktop only; on mobile it's in the sidebar menu */}
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
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 ${language === opt.value ? "font-bold text-primary bg-primary/5" : "text-foreground"}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="hidden sm:flex w-9 h-9 rounded-full bg-primary/10 items-center justify-center text-primary font-bold text-sm shadow-inner">
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

        <main className="flex-1 overflow-y-auto p-3 sm:p-5 lg:p-8 pb-20 lg:pb-8">
          <div className="max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out">
            {children}
          </div>
        </main>

        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-border/50 safe-area-inset-bottom">
          <div className="flex items-stretch h-16">
            {BOTTOM_NAV.map((item) => {
              const active = item.href !== "__more__" && isActive(item.href);
              const Icon = item.icon;

              if (item.href === "__more__") {
                return (
                  <button
                    key="more"
                    onClick={() => setIsMobileMenuOpen(true)}
                    className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors text-muted-foreground"
                  >
                    <Menu className="w-5 h-5" />
                    <span className="text-[10px] font-semibold">{T("navMore")}</span>
                  </button>
                );
              }

              return (
                <Link key={item.href} href={item.href} className="flex-1">
                  <div className={`flex flex-col items-center justify-center h-full gap-1 transition-colors ${active ? "text-primary" : "text-muted-foreground"}`}>
                    <div className={`relative ${active ? "after:absolute after:-bottom-1 after:left-1/2 after:-translate-x-1/2 after:w-4 after:h-0.5 after:bg-primary after:rounded-full" : ""}`}>
                      <Icon className={`w-5 h-5 ${active ? "text-primary" : ""}`} />
                    </div>
                    <span className={`text-[10px] font-semibold ${active ? "text-primary" : ""}`}>{T(item.nameKey)}</span>
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
