import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { fetcher } from "@/lib/api";
import {
  LayoutDashboard, Users, ShoppingBag, Car, Pill, Box,
  PackageSearch, Megaphone, Receipt, Settings2, Zap,
  AppWindow, Store, Bike, Ticket, BellRing, BanknoteIcon,
  Banknote, Search, ArrowRight, X, User, Hash, Shield, Navigation,
  FolderTree, Star, Layers, BadgeCheck, ArrowDownToLine, AlertTriangle,
} from "lucide-react";

/* ─── Static nav pages ─────────────────────────────────────────────────── */
const PAGES = [
  { label: "Dashboard",         href: "/dashboard",        icon: LayoutDashboard, group: "Pages" },
  { label: "Orders",            href: "/orders",           icon: ShoppingBag,     group: "Pages" },
  { label: "Rides",             href: "/rides",            icon: Car,             group: "Pages" },
  { label: "Pharmacy",          href: "/pharmacy",         icon: Pill,            group: "Pages" },
  { label: "Parcels",           href: "/parcel",           icon: Box,             group: "Pages" },
  { label: "Users",             href: "/users",            icon: Users,           group: "Pages" },
  { label: "Vendors",           href: "/vendors",          icon: Store,           group: "Pages" },
  { label: "Riders",            href: "/riders",           icon: Bike,            group: "Pages" },
  { label: "Products",          href: "/products",         icon: PackageSearch,   group: "Pages" },
  { label: "Categories",        href: "/categories",       icon: FolderTree,      group: "Pages" },
  { label: "Reviews",           href: "/reviews",          icon: Star,            group: "Pages" },
  { label: "Banners",           href: "/banners",          icon: Layers,          group: "Pages" },
  { label: "Flash Deals",       href: "/flash-deals",      icon: Zap,             group: "Pages" },
  { label: "Promo Codes",       href: "/promo-codes",      icon: Ticket,          group: "Pages" },
  { label: "KYC",               href: "/kyc",              icon: BadgeCheck,      group: "Pages" },
  { label: "Transactions",      href: "/transactions",     icon: Receipt,         group: "Pages" },
  { label: "Withdrawals",       href: "/withdrawals",      icon: BanknoteIcon,    group: "Pages" },
  { label: "Deposit Requests",  href: "/deposit-requests", icon: ArrowDownToLine, group: "Pages" },
  { label: "Notifications",     href: "/notifications",    icon: BellRing,        group: "Pages" },
  { label: "Broadcast",         href: "/broadcast",        icon: Megaphone,       group: "Pages" },
  { label: "SOS Alerts",        href: "/sos-alerts",       icon: AlertTriangle,   group: "Pages" },
  { label: "App Management",    href: "/app-management",   icon: AppWindow,       group: "Pages" },
  { label: "Settings",          href: "/settings",         icon: Settings2,       group: "Pages" },
  { label: "Security",          href: "/security",         icon: Shield,          group: "Pages" },
  { label: "Live Riders Map",   href: "/live-riders-map",  icon: Navigation,      group: "Pages" },
];

/* ─── Settings sections as searchable items ───────────────────────────── */
const SETTINGS_ITEMS = [
  { label: "Settings → General",        href: "/settings", group: "Settings", icon: Settings2, hint: "App name, logo, tagline" },
  { label: "Settings → Ride Pricing",   href: "/settings", group: "Settings", icon: Car,       hint: "Bike, car, rickshaw fares, bargaining" },
  { label: "Settings → Payment",        href: "/settings", group: "Settings", icon: Receipt,   hint: "JazzCash, EasyPaisa, COD, wallet" },
  { label: "Settings → Orders",         href: "/settings", group: "Settings", icon: ShoppingBag, hint: "Delivery, order rules, cart limits" },
  { label: "Settings → Finance",        href: "/settings", group: "Settings", icon: Banknote,  hint: "Commission, rider share, payouts" },
  { label: "Security",                   href: "/security", group: "Settings", icon: Shield,    hint: "OTP, MFA, session expiry, IP blocking, audit log" },
  { label: "Settings → Features",       href: "/settings", group: "Settings", icon: Zap,       hint: "Toggle app features on/off" },
  { label: "Settings → Notifications",  href: "/settings", group: "Settings", icon: BellRing,  hint: "FCM, SMS, push notification settings" },
];

/* ─── Quick actions ────────────────────────────────────────────────────── */
const QUICK_ACTIONS = [
  { label: "Live Rides & Orders",     href: "/rides",          icon: Car,       group: "Quick Actions", hint: "View bargaining / searching rides" },
  { label: "Send Broadcast",          href: "/broadcast",      icon: Megaphone, group: "Quick Actions", hint: "Send push notification to all users" },
  { label: "Add Promo Code",          href: "/promo-codes",    icon: Ticket,    group: "Quick Actions", hint: "Create a new discount coupon" },
  { label: "Add Flash Deal",          href: "/flash-deals",    icon: Zap,       group: "Quick Actions", hint: "Create a time-limited offer" },
];

/* ─── Ride & Order status color ───────────────────────────────────────── */
const STATUS_COLORS: Record<string, string> = {
  searching:   "bg-blue-100 text-blue-700",
  bargaining:  "bg-orange-100 text-orange-700",
  accepted:    "bg-purple-100 text-purple-700",
  arrived:     "bg-indigo-100 text-indigo-700",
  in_transit:  "bg-cyan-100 text-cyan-700",
  completed:   "bg-green-100 text-green-700",
  delivered:   "bg-green-100 text-green-700",
  cancelled:   "bg-red-100 text-red-700",
  pending:     "bg-yellow-100 text-yellow-700",
};

/* ─── Highlight matching text ─────────────────────────────────────────── */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 2) return <span>{text}</span>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 text-yellow-900 rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </span>
  );
}

/* ─── Component ───────────────────────────────────────────────────────── */
interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef  = useRef<HTMLInputElement>(null);
  const listRef   = useRef<HTMLDivElement>(null);

  /* ── Live search from backend (debounced 300ms) ── */
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: liveData, isFetching } = useQuery({
    queryKey: ["cmd-search", debouncedQ],
    queryFn:  () => fetcher(`/admin/search?q=${encodeURIComponent(debouncedQ)}`),
    enabled:  debouncedQ.length >= 2,
    staleTime: 5_000,
  });

  /* ── Build flat result list ── */
  const q = query.trim().toLowerCase();

  const staticItems = q.length < 1 ? [
    ...QUICK_ACTIONS,
    ...PAGES.slice(0, 8),
  ] : [
    ...PAGES.filter(p => p.label.toLowerCase().includes(q)),
    ...SETTINGS_ITEMS.filter(s => s.label.toLowerCase().includes(q) || s.hint.toLowerCase().includes(q)),
    ...QUICK_ACTIONS.filter(a => a.label.toLowerCase().includes(q) || a.hint.toLowerCase().includes(q)),
  ];

  const liveUsers:    any[] = liveData?.users    ?? [];
  const liveRides:    any[] = liveData?.rides    ?? [];
  const liveOrders:   any[] = liveData?.orders   ?? [];
  const livePharmacy: any[] = liveData?.pharmacy ?? [];

  /* All items in display order */
  const allItems = [
    ...staticItems,
    ...liveUsers.map((u: any) => ({ _type: "user",     ...u })),
    ...liveRides.map((r: any) => ({ _type: "ride",     ...r })),
    ...liveOrders.map((o: any) => ({ _type: "order",   ...o })),
    ...livePharmacy.map((p: any) => ({ _type: "pharm", ...p })),
  ];

  /* ── Reset selection when list changes ── */
  useEffect(() => { setSelected(0); }, [allItems.length, debouncedQ]);

  /* ── Reset & focus on open ── */
  useEffect(() => {
    if (open) {
      setQuery("");
      setDebouncedQ("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  /* ── Navigate to item ── */
  const navigate = useCallback((item: any) => {
    if (item.href) {
      setLocation(item.href);
    } else if (item._type === "user") {
      setLocation("/users");
    } else if (item._type === "ride") {
      setLocation("/rides");
    } else if (item._type === "order" || item._type === "pharm") {
      setLocation("/orders");
    }
    onClose();
  }, [setLocation, onClose]);

  /* ── Keyboard navigation ── */
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setSelected(s => Math.min(s + 1, allItems.length - 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
      if (e.key === "Enter" && allItems[selected]) { e.preventDefault(); navigate(allItems[selected]); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, allItems, selected, navigate, onClose]);

  /* ── Scroll selected into view ── */
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  /* ── Group headers ── */
  const getGroup = (item: any, idx: number) => {
    const cur  = item.group ?? (item._type === "user" ? "Users" : item._type === "ride" ? "Rides" : item._type === "order" ? "Orders" : item._type === "pharm" ? "Pharmacy" : null);
    const prev = idx > 0 ? (allItems[idx - 1].group ?? (allItems[idx-1]._type === "user" ? "Users" : allItems[idx-1]._type === "ride" ? "Rides" : allItems[idx-1]._type === "order" ? "Orders" : allItems[idx-1]._type === "pharm" ? "Pharmacy" : null)) : null;
    return cur !== prev ? cur : null;
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[10vh] px-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-border/60 overflow-hidden flex flex-col"
        style={{ maxHeight: "70vh" }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Search input ── */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border/50">
          <Search className="w-5 h-5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search pages, users, rides, orders..."
            className="flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground/60"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="flex items-center gap-1.5 shrink-0">
            {isFetching && debouncedQ.length >= 2 && (
              <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            )}
            {query && (
              <button onClick={() => setQuery("")} className="p-0.5 rounded-md hover:bg-muted transition-colors">
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            )}
            <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
              ESC
            </kbd>
          </div>
        </div>

        {/* ── Results ── */}
        <div ref={listRef} className="overflow-y-auto flex-1">
          {allItems.length === 0 && debouncedQ.length >= 2 && !isFetching && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Search className="w-8 h-8 mx-auto mb-3 opacity-20" />
              <p className="font-medium">Koi nateeja nahi mila</p>
              <p className="text-xs mt-1 opacity-70">"{query}" ke liye kuch nahi mila — kuch aur try karein</p>
            </div>
          )}

          {allItems.map((item, idx) => {
            const groupLabel = getGroup(item, idx);
            const isSelected = idx === selected;

            return (
              <div key={idx}>
                {/* Group header */}
                {groupLabel && (
                  <div className="px-4 pt-3 pb-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">{groupLabel}</p>
                  </div>
                )}

                {/* Static page / action item */}
                {!item._type && (() => {
                  const Icon = item.icon;
                  return (
                    <button
                      data-idx={idx}
                      key={idx}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isSelected ? "bg-primary/8 text-primary" : "hover:bg-muted/50"}`}
                      onClick={() => navigate(item)}
                      onMouseEnter={() => setSelected(idx)}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isSelected ? "bg-primary/12" : "bg-muted"}`}>
                        <Icon className={`w-4 h-4 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold truncate ${isSelected ? "text-primary" : ""}`}>
                          <Highlight text={item.label} query={query} />
                        </p>
                        {item.hint && <p className="text-xs text-muted-foreground truncate">{item.hint}</p>}
                      </div>
                      {isSelected && <ArrowRight className="w-3.5 h-3.5 text-primary shrink-0" />}
                    </button>
                  );
                })()}

                {/* User result */}
                {item._type === "user" && (
                  <button
                    data-idx={idx}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isSelected ? "bg-primary/8" : "hover:bg-muted/50"}`}
                    onClick={() => navigate(item)}
                    onMouseEnter={() => setSelected(idx)}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-bold ${isSelected ? "bg-primary text-white" : "bg-primary/10 text-primary"}`}>
                      {(item.name || "?").slice(0, 1).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold truncate"><Highlight text={item.name || "Unnamed"} query={query} /></p>
                        {item.role && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground uppercase">{item.role}</span>}
                      </div>
                      <p className="text-xs text-muted-foreground"><Highlight text={item.phone || item.email || "—"} query={query} /></p>
                    </div>
                    <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  </button>
                )}

                {/* Ride result */}
                {item._type === "ride" && (
                  <button
                    data-idx={idx}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isSelected ? "bg-primary/8" : "hover:bg-muted/50"}`}
                    onClick={() => navigate(item)}
                    onMouseEnter={() => setSelected(idx)}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isSelected ? "bg-blue-100" : "bg-muted"}`}>
                      <Car className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-mono text-muted-foreground">#{item.id?.slice(-8).toUpperCase()}</p>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md capitalize ${STATUS_COLORS[item.status] ?? "bg-muted text-muted-foreground"}`}>{item.status}</span>
                        {item.offeredFare && <span className="text-[10px] text-orange-600 font-bold">💬 Rs.{Math.round(item.offeredFare)}</span>}
                      </div>
                      <p className="text-sm font-medium truncate"><Highlight text={item.pickupAddress || "—"} query={query} /></p>
                      <p className="text-xs text-muted-foreground truncate">→ {item.dropAddress}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold">Rs. {Math.round(parseFloat(item.fare || "0"))}</p>
                    </div>
                  </button>
                )}

                {/* Order result */}
                {(item._type === "order" || item._type === "pharm") && (
                  <button
                    data-idx={idx}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isSelected ? "bg-primary/8" : "hover:bg-muted/50"}`}
                    onClick={() => navigate(item)}
                    onMouseEnter={() => setSelected(idx)}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isSelected ? "bg-green-100" : "bg-muted"}`}>
                      {item._type === "pharm" ? <Pill className="w-4 h-4 text-green-600" /> : <ShoppingBag className="w-4 h-4 text-green-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-mono text-muted-foreground">#{item.id?.slice(-8).toUpperCase()}</p>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md capitalize ${STATUS_COLORS[item.status] ?? "bg-muted text-muted-foreground"}`}>{item.status}</span>
                        {item._type === "pharm" && <span className="text-[10px] text-purple-600 font-bold">Pharmacy</span>}
                      </div>
                      <p className="text-sm font-medium truncate"><Highlight text={item.deliveryAddress || "—"} query={query} /></p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold">Rs. {Math.round(parseFloat(item.total || "0"))}</p>
                    </div>
                  </button>
                )}
              </div>
            );
          })}

          {/* Footer hints */}
          {allItems.length > 0 && (
            <div className="border-t border-border/30 px-4 py-2.5 flex items-center gap-4 text-[10px] text-muted-foreground/50">
              <span className="flex items-center gap-1"><kbd className="bg-muted border border-border rounded px-1 font-mono">↑↓</kbd> navigate</span>
              <span className="flex items-center gap-1"><kbd className="bg-muted border border-border rounded px-1 font-mono">↵</kbd> select</span>
              <span className="flex items-center gap-1"><kbd className="bg-muted border border-border rounded px-1 font-mono">esc</kbd> close</span>
              <span className="ml-auto flex items-center gap-1">
                <Hash className="w-3 h-3" /> {allItems.length} results
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Backdrop */}
      <div className="fixed inset-0 -z-10 bg-black/40 backdrop-blur-sm" />
    </div>
  );
}
