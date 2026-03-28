import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./lib/auth";
import { usePlatformConfig } from "./lib/useConfig";
import { useLanguage } from "./lib/useLanguage";
import { BottomNav } from "./components/BottomNav";
import { AnnouncementBar } from "./components/AnnouncementBar";
import { MaintenanceScreen } from "./components/MaintenanceScreen";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Active from "./pages/Active";
import History from "./pages/History";
import Earnings from "./pages/Earnings";
import Profile from "./pages/Profile";
import Wallet from "./pages/Wallet";
import Notifications from "./pages/Notifications";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

function AppRoutes() {
  const { user, loading } = useAuth();
  const { config } = usePlatformConfig();
  useLanguage(); /* initialises RTL + language from API on mount */

  if (loading) return (
    <div className="min-h-screen bg-gradient-to-br from-green-600 to-emerald-800 flex items-center justify-center">
      <div className="text-center">
        <div className="text-5xl mb-4">🏍️</div>
        <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p className="text-white mt-3 font-medium">Loading Rider Portal...</p>
      </div>
    </div>
  );

  if (!user) return <Login />;

  return (
    <div className="max-w-md mx-auto relative flex flex-col min-h-screen">
      {/* ── Maintenance overlay (fullscreen) ── */}
      {config.platform.appStatus === "maintenance" && (
        <MaintenanceScreen message={config.content.maintenanceMsg} appName={config.platform.appName} />
      )}

      {/* ── Announcement bar (top, dismissable) ── */}
      <AnnouncementBar message={config.content.announcement} />

      <div className="flex-1 pb-20">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/active" component={Active} />
          <Route path="/history" component={History} />
          <Route path="/earnings" component={Earnings} />
          <Route path="/wallet" component={Wallet} />
          <Route path="/notifications" component={Notifications} />
          <Route path="/profile" component={Profile} />
        </Switch>
      </div>
      <BottomNav />
    </div>
  );
}

function App() {
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

export default App;
