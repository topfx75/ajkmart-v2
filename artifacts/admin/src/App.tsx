import { useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PwaInstallBanner } from "@/components/PwaInstallBanner";
import { useLanguage } from "@/lib/useLanguage";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { initSentry, setSentryUser } from "@/lib/sentry";
import { initAnalytics, identifyUser } from "@/lib/analytics";
import { registerPush } from "@/lib/push";

// Layout & Pages
import { AdminLayout } from "@/components/layout/AdminLayout";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Users from "@/pages/users";
import Orders from "@/pages/orders";
import Rides from "@/pages/rides";
import Pharmacy from "@/pages/pharmacy";
import Parcel from "@/pages/parcel";
import Products from "@/pages/products";
import Broadcast from "@/pages/broadcast";
import Transactions from "@/pages/transactions";
import Settings from "@/pages/settings";
import FlashDeals from "@/pages/flash-deals";
import Categories from "@/pages/categories";
import Banners from "@/pages/banners";
import AppManagement from "@/pages/app-management";
import Vendors from "@/pages/vendors";
import Riders from "@/pages/riders";
import PromoCodes from "@/pages/promo-codes";
import Notifications from "@/pages/notifications";
import Withdrawals from "@/pages/Withdrawals";
import DepositRequests from "@/pages/DepositRequests";
import Security from "@/pages/security";
import LiveRidersMap from "@/pages/live-riders-map";
import SosAlerts from "@/pages/sos-alerts";
import ReviewsPage from "@/pages/reviews";
import KycPage from "@/pages/kyc";
import VanService from "@/pages/van";
import DeliveryAccess from "@/pages/delivery-access";
import AccountConditions from "@/pages/account-conditions";
import ConditionRules from "@/pages/condition-rules";
import Wishlists from "@/pages/wishlists";
import DeletionRequests from "@/pages/deletion-requests";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

/* Auto-logout when an authenticated query returns 401.
   Guard: only remove token + redirect if a token was actually present — this
   prevents pre-login query failures (expected 401s) from wiping a token that
   the user just saved after logging in. */
queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const err = event.action.error as any;
    const is401 =
      err?.message?.toLowerCase().includes("unauthorized") ||
      err?.status === 401;
    if (is401 && localStorage.getItem("ajkmart_admin_token")) {
      localStorage.removeItem("ajkmart_admin_token");
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      window.location.href = `${base}/login`;
    }
  }
});

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const [location, setLocation] = useLocation();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("ajkmart_admin_token");
    if (!token) {
      setLocation("/login");
    } else {
      setIsChecking(false);
    }
  }, [location, setLocation]);

  if (isChecking) return <div className="min-h-screen flex items-center justify-center bg-background"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <AdminLayout>
      <Component />
    </AdminLayout>
  );
}

function Router() {
  return (
    <Switch>
      {/* Public Route */}
      <Route path="/login" component={Login} />
      <Route path="/">
        {() => {
          const token = localStorage.getItem("ajkmart_admin_token");
          if (token) {
            window.location.replace((import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/dashboard");
            return null;
          }
          return <Login />;
        }}
      </Route>

      {/* Protected Routes */}
      <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
      <Route path="/users"><ProtectedRoute component={Users} /></Route>
      <Route path="/orders"><ProtectedRoute component={Orders} /></Route>
      <Route path="/rides"><ProtectedRoute component={Rides} /></Route>
      <Route path="/pharmacy"><ProtectedRoute component={Pharmacy} /></Route>
      <Route path="/parcel"><ProtectedRoute component={Parcel} /></Route>
      <Route path="/products"><ProtectedRoute component={Products} /></Route>
      <Route path="/broadcast"><ProtectedRoute component={Broadcast} /></Route>
      <Route path="/transactions"><ProtectedRoute component={Transactions} /></Route>
      <Route path="/settings"><ProtectedRoute component={Settings} /></Route>
      <Route path="/flash-deals"><ProtectedRoute component={FlashDeals} /></Route>
      <Route path="/categories"><ProtectedRoute component={Categories} /></Route>
      <Route path="/banners"><ProtectedRoute component={Banners} /></Route>
      <Route path="/app-management"><ProtectedRoute component={AppManagement} /></Route>
      <Route path="/vendors"><ProtectedRoute component={Vendors} /></Route>
      <Route path="/riders"><ProtectedRoute component={Riders} /></Route>
      <Route path="/promo-codes"><ProtectedRoute component={PromoCodes} /></Route>
      <Route path="/notifications"><ProtectedRoute component={Notifications} /></Route>
      <Route path="/withdrawals"><ProtectedRoute component={Withdrawals} /></Route>
      <Route path="/deposit-requests"><ProtectedRoute component={DepositRequests} /></Route>
      <Route path="/security"><ProtectedRoute component={Security} /></Route>
      <Route path="/sos-alerts"><ProtectedRoute component={SosAlerts} /></Route>
      <Route path="/live-riders-map"><ProtectedRoute component={LiveRidersMap} /></Route>
      <Route path="/reviews"><ProtectedRoute component={ReviewsPage} /></Route>
      <Route path="/kyc"><ProtectedRoute component={KycPage} /></Route>
      <Route path="/van"><ProtectedRoute component={VanService} /></Route>
      <Route path="/delivery-access"><ProtectedRoute component={DeliveryAccess} /></Route>
      <Route path="/account-conditions"><ProtectedRoute component={AccountConditions} /></Route>
      <Route path="/condition-rules"><ProtectedRoute component={ConditionRules} /></Route>
      <Route path="/wishlists"><ProtectedRoute component={Wishlists} /></Route>
      <Route path="/deletion-requests"><ProtectedRoute component={DeletionRequests} /></Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function LanguageInit() {
  useLanguage();
  return null;
}

function IntegrationsInit() {
  useEffect(() => {
    const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    fetch(`${base}/api/platform-config`)
      .then(r => r.ok ? r.json() : null)
      .then(raw => {
        if (!raw) return;
        const d = raw?.data ?? raw;
        const integ = d?.integrations;
        if (!integ) return;
        if (integ.sentry && integ.sentryDsn) {
          initSentry({
            dsn: integ.sentryDsn,
            environment: integ.sentryEnvironment || "production",
            sampleRate: integ.sentrySampleRate ?? 1.0,
            tracesSampleRate: integ.sentryTracesSampleRate ?? 0.1,
          });
        }
        if (integ.analytics && integ.analyticsTrackingId) {
          initAnalytics(integ.analyticsPlatform, integ.analyticsTrackingId, integ.analyticsDebug ?? false);
        }
      })
      .catch(() => {});

    /* Register admin push when token present */
    const token = localStorage.getItem("ajkmart_admin_token");
    if (token) {
      Notification.requestPermission()
        .then(perm => { if (perm === "granted") registerPush().catch(() => {}); })
        .catch(() => {});
      setSentryUser("admin");
      identifyUser("admin");
    }

    /* Also listen for post-login storage events to init push */
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "ajkmart_admin_token" && e.newValue) {
        Notification.requestPermission()
          .then(perm => { if (perm === "granted") registerPush().catch(() => {}); })
          .catch(() => {});
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);
  return null;
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <LanguageInit />
            <IntegrationsInit />
            <Router />
          </WouterRouter>
          <Toaster />
          <PwaInstallBanner />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
