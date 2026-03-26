import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";

const items = [
  { href: "/",           label: "Dashboard",   icon: "📊", desc: "Overview & stats"     },
  { href: "/orders",     label: "Orders",      icon: "📦", desc: "Manage orders"        },
  { href: "/products",   label: "Products",    icon: "🍽️", desc: "Your menu & stock"    },
  { href: "/wallet",     label: "Wallet",      icon: "💰", desc: "Earnings & payouts"   },
  { href: "/analytics",  label: "Analytics",   icon: "📈", desc: "Sales & performance"  },
  { href: "/store",      label: "My Store",    icon: "🏪", desc: "Settings & hours"     },
  { href: "/profile",    label: "Account",     icon: "👤", desc: "Profile & security"   },
];

export function SideNav() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const { data: notifData } = useQuery({
    queryKey: ["vendor-notifs-count"],
    queryFn: () => api.getNotifications(),
    refetchInterval: 60000,
    staleTime: 30000,
  });
  const unread: number = notifData?.unread || 0;

  return (
    <aside className="hidden md:flex flex-col w-64 bg-white border-r border-gray-200 min-h-screen fixed left-0 top-0 z-30">
      {/* Brand */}
      <div className="px-5 py-5 bg-gradient-to-br from-orange-500 to-amber-600">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-md flex-shrink-0">
            <span className="text-xl">🏪</span>
          </div>
          <div className="min-w-0">
            <p className="font-extrabold text-white text-sm leading-tight truncate">{user?.storeName || "My Store"}</p>
            <p className="text-orange-100 text-xs font-medium">AJKMart Vendor</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${user?.storeIsOpen ? "bg-green-400/90 text-white" : "bg-red-400/90 text-white"}`}>
            {user?.storeIsOpen ? "🟢 Open" : "🔴 Closed"}
          </span>
          <span className="text-xs text-orange-100 font-medium">85% commission</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {items.map(item => {
          const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-150 group
                ${active ? "bg-orange-50 border border-orange-200" : "hover:bg-gray-50"}`}>
              <span className={`text-xl w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 transition-all
                ${active ? "bg-orange-100" : "bg-gray-100 group-hover:bg-orange-50"}`}>
                {item.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-bold truncate ${active ? "text-orange-600" : "text-gray-700"}`}>{item.label}</p>
                <p className="text-xs text-gray-400 truncate">{item.desc}</p>
              </div>
              {item.href === "/profile" && unread > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-extrabold rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
              {active && <div className="ml-auto w-1.5 h-6 bg-orange-500 rounded-full flex-shrink-0" />}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-gray-100 space-y-2">
        <Link href="/wallet">
          <div className="px-3 py-2.5 bg-orange-50 rounded-xl cursor-pointer hover:bg-orange-100 transition-colors">
            <p className="text-xs text-gray-500 font-medium">Wallet Balance</p>
            <p className="text-lg font-extrabold text-orange-600">Rs. {Math.round(user?.walletBalance || 0).toLocaleString()}</p>
          </div>
        </Link>
        <button onClick={logout} className="w-full flex items-center gap-2 px-3 py-2.5 text-red-500 hover:bg-red-50 rounded-xl text-sm font-semibold transition-colors">
          <span>🚪</span> Logout
        </button>
      </div>
    </aside>
  );
}
