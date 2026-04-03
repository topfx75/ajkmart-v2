import { useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PwaInstallBanner } from "@/components/PwaInstallBanner";
import { useLanguage } from "@/lib/useLanguage";
import { ErrorBoundary } from "@/components/ErrorBoundary";

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
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

/* Auto-logout on any 401 from the API */
queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const err = event.action.error as any;
    if (err?.message?.toLowerCase().includes("unauthorized") || err?.status === 401) {
      localStorage.removeItem("ajkmart_admin_token");
      window.location.href = window.location.pathname.includes("/admin") ? "/admin/login" : "/login";
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
      <Route path="/" component={Login} />

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

      <Route component={NotFound} />
    </Switch>
  );
}

function LanguageInit() {
  useLanguage();
  return null;
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <LanguageInit />
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
