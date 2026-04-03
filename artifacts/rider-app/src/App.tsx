import { Switch, Route, Router as WouterRouter } from "wouter";
import { useState, useEffect, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./lib/auth";
import { usePlatformConfig, getRiderModules } from "./lib/useConfig";
import { useLanguage, LanguageProvider } from "./lib/useLanguage";
import { SocketProvider } from "./lib/socket";
import { registerDrainHandler, type QueuedPing } from "./lib/gpsQueue";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { registerPush } from "./lib/push";
import { api } from "./lib/api";
import { BottomNav } from "./components/BottomNav";
import { AnnouncementBar } from "./components/AnnouncementBar";
import { PwaInstallBanner } from "./components/PwaInstallBanner";
import { MaintenanceScreen } from "./components/MaintenanceScreen";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import Home from "./pages/Home";
import Active from "./pages/Active";
import History from "./pages/History";
import Earnings from "./pages/Earnings";
import Profile from "./pages/Profile";
import Wallet from "./pages/Wallet";
import Notifications from "./pages/Notifications";
import SecuritySettings from "./pages/SecuritySettings";
import VanDriver from "./pages/VanDriver";
import NotFound from "./pages/not-found";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, networkMode: 'offlineFirst' } } });

function AppRoutes() {
  const { user, loading } = useAuth();
  const { config } = usePlatformConfig();
  const modules = getRiderModules(config);
  useLanguage();

  useEffect(() => {
    return registerDrainHandler(async (pings: QueuedPing[]) => {
      await api.batchLocation(pings.map(({ id, ...rest }) => rest));
    });
  }, []);

  useEffect(() => {
    if (user) {
      Notification.requestPermission().then(perm => {
        if (perm === "granted") registerPush().catch(() => {});
      }).catch(() => {});
    }
  }, [user]);

  /* Show a subtle toast whenever refreshUser fails persistently */
  const [refreshFailToast, setRefreshFailToast] = useState(false);
  const refreshFailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const handler = () => {
      setRefreshFailToast(true);
      if (refreshFailTimer.current) clearTimeout(refreshFailTimer.current);
      refreshFailTimer.current = setTimeout(() => setRefreshFailToast(false), 4000);
    };
    window.addEventListener("ajkmart:refresh-user-failed", handler);
    return () => {
      window.removeEventListener("ajkmart:refresh-user-failed", handler);
      if (refreshFailTimer.current) clearTimeout(refreshFailTimer.current);
    };
  }, []);

  if (loading) return (
    <div className="min-h-screen bg-gradient-to-br from-green-600 to-emerald-800 flex items-center justify-center">
      <div className="text-center">
        <div className="text-5xl mb-4">🏍️</div>
        <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p className="text-white mt-3 font-medium">Loading Rider Portal...</p>
      </div>
    </div>
  );

  if (!user) return (
    <Switch>
      <Route path="/register" component={Register} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route><Login /></Route>
    </Switch>
  );

  if (config.platform.appStatus === "maintenance") {
    return <MaintenanceScreen message={config.content.maintenanceMsg} appName={config.platform.appName} />;
  }

  return (
    <div className="max-w-md mx-auto relative flex flex-col min-h-screen">
      {/* ── Subtle sync-failure toast ── */}
      {refreshFailToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] bg-amber-500 text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg pointer-events-none">
          Connection issue — profile sync failed
        </div>
      )}

      {/* ── Sticky header stack: announcement + any future system bars.
            max-h caps combined height so stacked bars never push content
            off-screen on small viewports; overflow-y-auto scrolls if needed. ── */}
      <div className="sticky top-0 z-50 flex flex-col max-h-[30vh] overflow-y-auto">
        <AnnouncementBar message={config.content.announcement} />
      </div>

      <div className="flex-1" style={{ paddingBottom: "calc(64px + max(8px, env(safe-area-inset-bottom, 8px)))" }}>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/active" component={Active} />
          {modules.history && <Route path="/history" component={History} />}
          {modules.earnings && <Route path="/earnings" component={Earnings} />}
          {modules.wallet && <Route path="/wallet" component={Wallet} />}
          <Route path="/notifications" component={Notifications} />
          <Route path="/profile" component={Profile} />
          <Route path="/settings/security" component={SecuritySettings} />
          <Route path="/van" component={VanDriver} />
          <Route component={NotFound} />
        </Switch>
      </div>
      <BottomNav />
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <AuthProvider>
            <SocketProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <AppRoutes />
              </WouterRouter>
              <PwaInstallBanner />
            </SocketProvider>
          </AuthProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
