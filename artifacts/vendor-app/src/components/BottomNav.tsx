import { Link, useLocation } from "wouter";

const items = [
  { href: "/",         label: "Dashboard", icon: "📊" },
  { href: "/orders",   label: "Orders",    icon: "📦" },
  { href: "/products", label: "Products",  icon: "🍽️" },
  { href: "/store",    label: "My Store",  icon: "🏪" },
  { href: "/profile",  label: "Profile",   icon: "👤" },
];

export function BottomNav() {
  const [location] = useLocation();
  return (
    <nav
      className="fixed bottom-0 z-40 bg-white"
      style={{
        left: "50%",
        transform: "translateX(-50%)",
        width: "100%",
        maxWidth: "480px",
        boxShadow: "0 -1px 0 rgba(0,0,0,0.07), 0 -6px 16px rgba(0,0,0,0.07)",
        paddingBottom: "max(8px, env(safe-area-inset-bottom, 8px))",
      }}
    >
      <div className="flex">
        {items.map(item => {
          const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 flex flex-col items-center pt-2 pb-1.5 gap-0.5 relative android-press min-h-0"
            >
              {active && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-orange-500 rounded-full" />}
              <span
                className={`flex items-center justify-center w-11 h-7 rounded-xl transition-all duration-200 text-xl
                  ${active ? "bg-orange-50" : ""}`}
              >
                {item.icon}
              </span>
              <span
                className={`text-[10px] font-bold leading-none transition-colors duration-200
                  ${active ? "text-orange-500" : "text-gray-400"}`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
