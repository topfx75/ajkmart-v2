import { Component, type ReactNode, useEffect, useState, useRef } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./lib/auth";
import { usePlatformConfig } from "./lib/useConfig";
import { useLanguage } from "./lib/useLanguage";
import { registerPush } from "./lib/push";
import { initSentry, setSentryUser } from "./lib/sentry";
import { initAnalytics, trackEvent, identifyUser } from "./lib/analytics";
import { BottomNav } from "./components/BottomNav";
import { PwaInstallBanner } from "./components/PwaInstallBanner";
import { SideNav } from "./components/SideNav";
import { BOTTOM_PADDING } from "./lib/ui";
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
import Reviews from "./pages/Reviews";
import Promos from "./pages/Promos";

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-xl">
            <div className="text-5xl mb-4">⚠️</div>
            <h2 className="text-xl font-extrabold text-gray-800 mb-2">Kuch galat ho gaya / Something went wrong</h2>
            <p className="text-sm text-gray-500 mb-4">
              {this.state.error?.message || "An unexpected error occurred."}
            </p>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              className="w-full h-11 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl text-sm">
              Dobara koshish karein / Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10000, refetchOnWindowFocus: true } },
});

function AppRoutes() {
  const { user, loading } = useAuth();
  const { config } = usePlatformConfig();
  useLanguage(); /* initialises RTL + language from API on mount */

  /* ── Sentry + Analytics init from platform config ── */
  useEffect(() => {
    const integ = config?.integrations;
    if (!integ) return;
    if (integ.sentry && integ.sentryDsn) {
      initSentry(integ.sentryDsn, integ.sentryEnvironment, integ.sentrySampleRate, integ.sentryTracesSampleRate);
    }
    if (integ.analytics && integ.analyticsTrackingId) {
      initAnalytics(integ.analyticsPlatform, integ.analyticsTrackingId, integ.analyticsDebug ?? false);
    }
  }, [config?.integrations?.sentryDsn, config?.integrations?.analyticsTrackingId]);

  /* ── Identify vendor in Sentry/Analytics after login ── */
  useEffect(() => {
    if (user) {
      setSentryUser(String(user.id), user.email);
      identifyUser(String(user.id));
      trackEvent("vendor_session_start");
    }
  }, [user?.id]);

  useEffect(() => {
    if (user) {
      Notification.requestPermission().then(perm => {
        if (perm === "granted") registerPush().catch(() => {});
      }).catch(() => {});
    }
  }, [user]);

  const MAINTENANCE_GRACE_MS = 5 * 60 * 1000; /* 5-minute grace period */
  const maintenanceSince = useRef<number | null>(null);
  const [maintenanceBlocked, setMaintenanceBlocked] = useState(false);
  const [maintenanceSecs, setMaintenanceSecs] = useState(0);

  useEffect(() => {
    if (config.platform.appStatus !== "maintenance") {
      maintenanceSince.current = null;
      setMaintenanceBlocked(false);
      return;
    }
    if (maintenanceSince.current === null) {
      maintenanceSince.current = Date.now();
    }
    const tick = () => {
      const elapsed = Date.now() - (maintenanceSince.current ?? Date.now());
      const remaining = Math.max(0, Math.ceil((MAINTENANCE_GRACE_MS - elapsed) / 1000));
      setMaintenanceSecs(remaining);
      if (elapsed >= MAINTENANCE_GRACE_MS) setMaintenanceBlocked(true);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [config.platform.appStatus]);

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
      {/* ── Maintenance overlay: shown immediately but blocks after 5-min grace ── */}
      {config.platform.appStatus === "maintenance" && maintenanceBlocked && (
        <MaintenanceScreen message={config.content.maintenanceMsg} appName={config.platform.appName} />
      )}
      {config.platform.appStatus === "maintenance" && !maintenanceBlocked && maintenanceSecs > 0 && (
        <div className="fixed top-0 inset-x-0 z-50 bg-amber-500 text-white text-center py-2 px-4 text-xs font-bold shadow">
          ⚠️ {config.platform.appName} is in maintenance mode. Full screen in {Math.floor(maintenanceSecs / 60)}:{String(maintenanceSecs % 60).padStart(2, "0")}
        </div>
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
            style={{ paddingBottom: BOTTOM_PADDING }}
            id="main-scroll"
          >
            <div className="md:max-w-5xl md:mx-auto md:px-6 md:pb-8">
              <Switch>
                <Route path="/" component={Dashboard} />
                <Route path="/orders" component={Orders} />
                <Route path="/products" component={Products} />
                <Route path="/wallet" component={Wallet} />
                <Route path="/analytics" component={Analytics} />
                <Route path="/reviews" component={Reviews} />
                <Route path="/promos" component={Promos} />
                <Route path="/store" component={Store} />
                <Route path="/notifications" component={Notifications} />
                <Route path="/profile" component={Profile} />
                <Route>
                  <div className="flex items-center justify-center h-64">
                    <div className="text-center">
                      <p className="text-4xl mb-3">🔍</p>
                      <p className="text-lg font-extrabold text-gray-700">Page not found</p>
                      <p className="text-sm text-gray-400 mt-1">This page doesn't exist</p>
                      <a href="/" className="mt-4 inline-block h-10 px-6 bg-orange-500 text-white font-bold rounded-xl text-sm leading-10">← Go Home</a>
                    </div>
                  </div>
                </Route>
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
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AppRoutes />
          </WouterRouter>
          <PwaInstallBanner />
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
