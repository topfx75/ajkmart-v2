import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./lib/auth";
import { BottomNav } from "./components/BottomNav";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Orders from "./pages/Orders";
import Products from "./pages/Products";
import Store from "./pages/Store";
import Profile from "./pages/Profile";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10000, refetchOnWindowFocus: true } },
});

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) return (
    <div
      className="min-h-screen bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center"
      style={{ paddingTop: "env(safe-area-inset-top,0px)", paddingBottom: "env(safe-area-inset-bottom,0px)" }}
    >
      <div className="text-center">
        <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center mx-auto mb-5 shadow-2xl">
          <span className="text-4xl">🏪</span>
        </div>
        <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-white mt-4 font-semibold text-lg">Loading Vendor Portal...</p>
        <p className="text-orange-100 text-sm mt-1">AJKMart Business Partner</p>
      </div>
    </div>
  );

  if (!user) return <Login />;

  return (
    <div className="max-w-md mx-auto relative bg-gray-50 min-h-screen flex flex-col">
      {/* Main content - padded bottom for nav bar */}
      <div
        className="flex-1 scroll-momentum"
        style={{
          paddingBottom: "calc(68px + max(8px, env(safe-area-inset-bottom, 8px)))",
          overflowY: "auto",
        }}
      >
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/orders" component={Orders} />
          <Route path="/products" component={Products} />
          <Route path="/store" component={Store} />
          <Route path="/profile" component={Profile} />
        </Switch>
      </div>
      <BottomNav />
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
