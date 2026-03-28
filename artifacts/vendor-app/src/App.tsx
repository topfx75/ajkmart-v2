import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./lib/auth";
import { usePlatformConfig } from "./lib/useConfig";
import { useLanguage } from "./lib/useLanguage";
import { BottomNav } from "./components/BottomNav";
import { SideNav } from "./components/SideNav";
import { AnnouncementBar } from "./components/AnnouncementBar";
import { MaintenanceScreen } from "./components/MaintenanceScreen";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Orders from "./pages/Orders";
import Products from "./pages/Products";
import Store from "./pages/Store";
import Profile from "./pages/Profile";
import Wallet from "./pages/Wallet";
import Analytics from "./pages/Analytics";
import Notifications from "./pages/Notifications";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10000, refetchOnWindowFocus: true } },
});

function AppRoutes() {
  const { user, loading } = useAuth();
  const { config } = usePlatformConfig();
  useLanguage(); /* initialises RTL + language from API on mount */

  if (loading) return (
    <div className="min-h-screen bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center">
      <div className="text-center">
        <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center mx-auto mb-5 shadow-2xl">
          <span className="text-4xl">🏪</span>
        </div>
        <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-white mt-4 font-semibold text-lg">Loading Vendor Portal...</p>
        <p className="text-orange-100 text-sm mt-1">{config.platform.appName} Business Partner</p>
      </div>
    </div>
  );

  if (!user) return <Login />;

  return (
    <div className="h-screen bg-gray-100 flex flex-col overflow-hidden">
      {/* ── Maintenance overlay (fullscreen) ── */}
      {config.platform.appStatus === "maintenance" && (
        <MaintenanceScreen message={config.content.maintenanceMsg} appName={config.platform.appName} />
      )}

      {/* ── Announcement bar (top, dismissable) ── */}
      <AnnouncementBar message={config.content.announcement} />

      <div className="flex flex-1 overflow-hidden">
        {/* ── Desktop Sidebar (hidden on mobile) ── */}
        <div className="hidden md:flex md:w-64 md:flex-shrink-0">
          <SideNav />
        </div>

        {/* ── Main Content ── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div
            className="flex-1 overflow-y-auto scroll-momentum"
            style={{ paddingBottom: "calc(64px + max(8px, env(safe-area-inset-bottom, 8px)))" }}
            id="main-scroll"
          >
            <div className="md:max-w-5xl md:mx-auto md:px-6 md:pb-8">
              <Switch>
                <Route path="/" component={Dashboard} />
                <Route path="/orders" component={Orders} />
                <Route path="/products" component={Products} />
                <Route path="/wallet" component={Wallet} />
                <Route path="/analytics" component={Analytics} />
                <Route path="/store" component={Store} />
                <Route path="/notifications" component={Notifications} />
                <Route path="/profile" component={Profile} />
              </Switch>
            </div>
          </div>

          {/* Mobile Bottom Nav */}
          <BottomNav />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppRoutes />
        </WouterRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
