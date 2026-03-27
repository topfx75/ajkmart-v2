import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { api } from "./api";

export interface StoreHours { [day: string]: { open: string; close: string; closed?: boolean } }

export interface AuthUser {
  id: string; phone: string; name?: string; email?: string; avatar?: string;
  walletBalance: number;
  storeName?: string; storeCategory?: string;
  storeBanner?: string; storeDescription?: string;
  storeHours?: StoreHours | null;
  storeAnnouncement?: string;
  storeMinOrder?: number;
  storeDeliveryTime?: string;
  storeIsOpen: boolean;
  lastLoginAt?: string; createdAt?: string;
  stats: { todayOrders: number; todayRevenue: number; totalOrders: number; totalRevenue: number };
  cnic?: string; city?: string; address?: string; businessType?: string;
  bankName?: string; bankAccount?: string; bankAccountTitle?: string;
}

interface AuthCtx {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (token: string, user: AuthUser, refreshToken?: string) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]   = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    /* Try new namespaced key first, fall back to legacy key */
    const t = localStorage.getItem("ajkmart_vendor_token") || localStorage.getItem("vendor_token");
    if (t) {
      setToken(t);
      api.getMe().then(u => {
        setUser(u);
        /* Migrate legacy key to new key on successful load */
        if (!localStorage.getItem("ajkmart_vendor_token")) {
          localStorage.setItem("ajkmart_vendor_token", t);
          localStorage.removeItem("vendor_token");
        }
      }).catch(() => {
        api.clearTokens();
      }).finally(() => setLoading(false));
    } else { setLoading(false); }

    /* Listen for session-expired events from apiFetch */
    const handleLogout = () => { setToken(null); setUser(null); };
    window.addEventListener("ajkmart:logout", handleLogout);
    return () => window.removeEventListener("ajkmart:logout", handleLogout);
  }, []);

  const login = (t: string, u: AuthUser, refreshToken?: string) => {
    api.storeTokens(t, refreshToken);
    setToken(t);
    setUser(u);
  };

  const logout = () => {
    const refreshTok = api.getRefreshToken();
    if (refreshTok) api.logout(refreshTok).catch(() => {});
    else api.clearTokens();
    setToken(null);
    setUser(null);
  };

  const refreshUser = async () => { const u = await api.getMe(); setUser(u); };

  return <Ctx.Provider value={{ user, token, loading, login, logout, refreshUser }}>{children}</Ctx.Provider>;
}
