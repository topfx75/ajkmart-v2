import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

interface NavItem { href: string; label: string; icon: string; }

const items: NavItem[] = [
  { href: "/",               label: "Home",     icon: "🏠" },
  { href: "/active",         label: "Active",   icon: "📍" },
  { href: "/wallet",         label: "Wallet",   icon: "💰" },
  { href: "/notifications",  label: "Alerts",   icon: "🔔" },
  { href: "/profile",        label: "Profile",  icon: "👤" },
];

export function BottomNav() {
  const [location] = useLocation();

  const { data } = useQuery({
    queryKey: ["rider-notifs-count"],
    queryFn: () => api.getNotifications(),
    refetchInterval: 60000,
    staleTime: 30000,
  });
  const unread: number = data?.unread || 0;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-100 shadow-lg"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom, 8px))" }}>
      <div className="flex max-w-md mx-auto">
        {items.map(item => {
          const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href}
              className="flex-1 flex flex-col items-center pt-2.5 pb-1 gap-0.5 relative android-press min-h-0">
              {active && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-green-600 rounded-full"/>}
              <div className="relative">
                <span className={`text-xl leading-none flex items-center justify-center w-10 h-7 rounded-xl ${active ? "bg-green-50" : ""}`}>
                  {item.icon}
                </span>
                {item.href === "/notifications" && unread > 0 && (
                  <span className="absolute -top-1 -right-0.5 bg-red-500 text-white text-[9px] font-extrabold rounded-full w-4 h-4 flex items-center justify-center">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </div>
              <span className={`text-[10px] font-bold leading-none ${active ? "text-green-600" : "text-gray-400"}`}>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
