import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Home, MapPin, Wallet, Bell, User } from "lucide-react";
import { useLanguage } from "../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";

import type { LucideProps } from "lucide-react";
interface NavItem { href: string; labelKey: TranslationKey; Icon: React.ComponentType<LucideProps>; }

const navItems: NavItem[] = [
  { href: "/",               labelKey: "home",              Icon: Home    },
  { href: "/active",         labelKey: "active",            Icon: MapPin  },
  { href: "/wallet",         labelKey: "wallet",            Icon: Wallet  },
  { href: "/notifications",  labelKey: "alerts",            Icon: Bell    },
  { href: "/profile",        labelKey: "profile",           Icon: User    },
];

export function BottomNav() {
  const [location] = useLocation();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  const { data: notifData } = useQuery({
    queryKey: ["rider-notifs-count"],
    queryFn: () => api.getNotifications(),
    refetchInterval: 60000,
    staleTime: 30000,
  });
  const unread: number = notifData?.unread || 0;

  const { data: activeData } = useQuery({
    queryKey: ["rider-active"],
    queryFn: () => api.getActive(),
    refetchInterval: 8000,
    staleTime: 5000,
  });
  const hasActive = !!(activeData?.order || activeData?.ride);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-100 shadow-lg"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom, 8px))" }}>
      <div className="flex max-w-md mx-auto">
        {navItems.map(item => {
          const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          const { Icon } = item;
          return (
            <Link key={item.href} href={item.href}
              className="flex-1 flex flex-col items-center pt-2.5 pb-1 gap-0.5 relative android-press min-h-0">
              {active && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-green-600 rounded-full"/>}
              <div className="relative">
                <span className={`flex items-center justify-center w-10 h-7 rounded-xl ${active ? "bg-green-50" : ""}`}>
                  <Icon size={20} strokeWidth={active ? 2.5 : 1.8} className={active ? "text-green-600" : "text-gray-400"} />
                </span>
                {item.href === "/notifications" && unread > 0 && (
                  <span className="absolute -top-1 -right-0.5 bg-red-500 text-white text-[9px] font-extrabold rounded-full w-4 h-4 flex items-center justify-center">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
                {item.href === "/active" && hasActive && (
                  <span className="absolute -top-1 -right-0.5 flex items-center justify-center">
                    <span className="w-3.5 h-3.5 bg-green-500 rounded-full flex items-center justify-center">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative w-2.5 h-2.5 bg-green-500 rounded-full"></span>
                    </span>
                  </span>
                )}
              </div>
              <span className={`text-[10px] font-bold leading-none ${active ? "text-green-600" : "text-gray-400"}`}>{T(item.labelKey)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
