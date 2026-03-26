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
} from "lucide-react";
import { Button } from "@/components/ui/button";

const navGroups = [
  {
    label: "Operations",
    items: [
      { name: "Dashboard",    href: "/dashboard",   icon: LayoutDashboard },
      { name: "Orders",       href: "/orders",       icon: ShoppingBag },
      { name: "Rides",        href: "/rides",        icon: Car },
      { name: "Pharmacy",     href: "/pharmacy",     icon: Pill },
      { name: "Parcels",      href: "/parcel",       icon: Box },
    ],
  },
  {
    label: "People",
    items: [
      { name: "Users",        href: "/users",        icon: Users },
      { name: "Vendors",      href: "/vendors",      icon: Store },
      { name: "Riders",       href: "/riders",       icon: Bike },
    ],
  },
  {
    label: "Catalog & Promos",
    items: [
      { name: "Products",     href: "/products",     icon: PackageSearch },
      { name: "Flash Deals",  href: "/flash-deals",  icon: Zap },
      { name: "Promo Codes",  href: "/promo-codes",  icon: Ticket },
    ],
  },
  {
    label: "Finance & System",
    items: [
      { name: "Transactions", href: "/transactions", icon: Receipt },
      { name: "Broadcast",    href: "/broadcast",    icon: Megaphone },
      { name: "App Management", href: "/app-management", icon: AppWindow },
      { name: "Settings",     href: "/settings",     icon: Settings2 },
    ],
  },
];

// Flat list for backward compat (active detection etc.)
const navItems = navGroups.flatMap(g => g.items);

// Bottom nav items (most used pages for mobile)
const bottomNavItems = [
  { name: "Home", href: "/dashboard", icon: LayoutDashboard },
  { name: "Orders", href: "/orders", icon: ShoppingBag },
  { name: "Rides", href: "/rides", icon: Car },
  { name: "Users", href: "/users", icon: Users },
  { name: "More", href: "__more__", icon: Menu },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Close mobile menu on location change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location]);

  const handleLogout = () => {
    localStorage.removeItem("ajkmart_admin_token");
    setLocation("/login");
  };

  const isActive = (href: string) => {
    if (href === "/dashboard") return location === "/dashboard" || location === "/";
    return location.startsWith(href);
  };

  const currentPageName = navItems.find(i => isActive(i.href))?.name || "AJKMart Admin";

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground w-64 shadow-2xl">
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border/50 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center mr-3 shadow-lg shadow-primary/20">
          <ShoppingBag className="w-5 h-5 text-white" />
        </div>
        <span className="font-display font-bold text-xl tracking-tight">AJKMart</span>
        <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 px-1.5 py-0.5 rounded-md">Admin</span>
      </div>

      {/* Nav Items — grouped */}
      <div className="flex-1 overflow-y-auto py-3 px-3 space-y-4">
        {navGroups.map(group => (
          <div key={group.label}>
            <p className="px-3 mb-1.5 text-[10px] font-bold text-sidebar-foreground/35 uppercase tracking-widest">{group.label}</p>
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
                      <span className="text-sm flex-1">{item.name}</span>
                      {active && <ChevronRight className="w-4 h-4 text-white/70 ml-1" />}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Logout */}
      <div className="p-3 border-t border-sidebar-border/50 shrink-0">
        <button
          onClick={handleLogout}
          className="flex items-center w-full px-3 py-2.5 rounded-xl text-sidebar-foreground/70 hover:bg-red-500/10 hover:text-red-500 transition-colors text-sm"
        >
          <LogOut className="w-[18px] h-[18px] mr-3" />
          Logout
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Desktop Sidebar — hidden on mobile */}
      <div className="hidden lg:block h-full z-20 shrink-0">
        <SidebarContent />
      </div>

      {/* Mobile / Tablet Full Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <div className="relative z-10 flex flex-col">
            <SidebarContent />
          </div>
          {/* Close button */}
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="absolute top-4 right-4 w-10 h-10 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
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

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs font-medium text-muted-foreground">Live</span>
            </div>
            <button
              onClick={handleLogout}
              className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground hover:text-red-500 transition-colors px-2 py-1 rounded-lg hover:bg-red-50"
            >
              <LogOut className="w-3.5 h-3.5" />
              Logout
            </button>
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shadow-inner">
              A
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-5 lg:p-8 pb-20 lg:pb-8">
          <div className="max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out">
            {children}
          </div>
        </main>

        {/* Mobile Bottom Navigation (shown on mobile/tablet only) */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-border/50 safe-area-inset-bottom">
          <div className="flex items-stretch h-16">
            {bottomNavItems.map((item) => {
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
                    <span className="text-[10px] font-semibold">More</span>
                  </button>
                );
              }

              return (
                <Link key={item.href} href={item.href} className="flex-1">
                  <div className={`flex flex-col items-center justify-center h-full gap-1 transition-colors ${active ? "text-primary" : "text-muted-foreground"}`}>
                    <div className={`relative ${active ? "after:absolute after:-bottom-1 after:left-1/2 after:-translate-x-1/2 after:w-4 after:h-0.5 after:bg-primary after:rounded-full" : ""}`}>
                      <Icon className={`w-5 h-5 ${active ? "text-primary" : ""}`} />
                    </div>
                    <span className={`text-[10px] font-semibold ${active ? "text-primary" : ""}`}>{item.name}</span>
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
