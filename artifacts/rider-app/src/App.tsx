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
import { initSentry, setSentryUser } from "./lib/sentry";
import { initAnalytics, trackEvent, identifyUser } from "./lib/analytics";
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

  /* ── Identify user in Sentry/Analytics after login ── */
  useEffect(() => {
    if (user) {
      setSentryUser(String(user.id), user.email);
      identifyUser(String(user.id));
      trackEvent("rider_session_start");
    }
  }, [user?.id]);

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
        <img
          src={`${import.meta.env.BASE_URL}logo.svg`}
          alt="AJKMart"
          className="mx-auto mb-6"
          style={{ height: 80, width: "auto", maxWidth: 240, objectFit: "contain", filter: "brightness(0) invert(1)" }}
        />
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

  /* ── Approval status guard — shown after session rehydration if still pending/rejected ── */
  if (user.approvalStatus === "pending") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow-xl p-8 max-w-sm w-full text-center">
          <div className="text-5xl mb-4">⏳</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Account Under Review</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-6">Your rider account is pending admin approval. You will be able to access the app once your account is approved.</p>
          <button onClick={() => { api.clearTokens(); window.location.reload(); }}
            className="w-full py-3 rounded-2xl bg-gray-100 text-gray-700 font-semibold text-sm hover:bg-gray-200 transition-colors">
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  if (user.approvalStatus === "rejected") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-rose-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow-xl p-8 max-w-sm w-full text-center">
          <div className="text-5xl mb-4">❌</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Account Rejected</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-2">Your rider account application was not approved.</p>
          {user.rejectionReason && <p className="text-red-600 text-sm font-medium mb-6">Reason: {user.rejectionReason}</p>}
          <button onClick={() => { api.clearTokens(); window.location.reload(); }}
            className="w-full py-3 rounded-2xl bg-gray-100 text-gray-700 font-semibold text-sm hover:bg-gray-200 transition-colors">
            Sign Out
          </button>
        </div>
      </div>
    );
  }

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
