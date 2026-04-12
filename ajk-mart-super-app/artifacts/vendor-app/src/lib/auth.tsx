import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export interface StoreHours { [day: string]: { open: string; close: string; closed?: boolean } }

export interface AuthUser {
  id: string; phone: string; name?: string; email?: string; avatar?: string;
  walletBalance: number;
  role?: string; roles?: string;
  storeName?: string; storeCategory?: string;
  storeBanner?: string; storeDescription?: string;
  storeHours?: StoreHours | null;
  storeAnnouncement?: string;
  storeMinOrder?: number;
  storeDeliveryTime?: string;
  storeIsOpen: boolean;
  storeLat?: string | null; storeLng?: string | null;
  lastLoginAt?: string; createdAt?: string;
  stats: { todayOrders: number; todayRevenue: number; totalOrders: number; totalRevenue: number };
  cnic?: string; city?: string; address?: string; businessType?: string;
  bankName?: string; bankAccount?: string; bankAccountTitle?: string;
  isVerified?: boolean; status?: string;
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
  const queryClient = useQueryClient();
  const [user, setUser]   = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const logoutCallbackRef = useRef<(() => void) | null>(null);

  useEffect((): (() => void) | void => {
    /* Try new namespaced key first, fall back to legacy key */
    const t = api.getToken();
    if (!t) { setLoading(false); return; }

    setToken(t);
    const controller = new AbortController();
    api.getMe(controller.signal).then((u: AuthUser) => {
      const roles = (u.roles || u.role || "").split(",").map((r) => r.trim());
      if ((u.roles || u.role) && !roles.includes("vendor")) {
        api.clearTokens();
        setToken(null);
        return;
      }
      setUser(u);
    }).catch((err: unknown) => {
      if (err instanceof Error && err.name === "AbortError") return;
      api.clearTokens();
      setToken(null);
      setUser(null);
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const clearAuth = () => { setToken(null); setUser(null); };
    logoutCallbackRef.current = clearAuth;

    const unregister = api.registerLogoutCallback(clearAuth);

    const handleLogout = () => clearAuth();
    window.addEventListener("ajkmart:logout", handleLogout);
    return () => {
      unregister();
      window.removeEventListener("ajkmart:logout", handleLogout);
    };
  }, []);

  const login = (t: string, u: AuthUser, refreshToken?: string) => {
    const roles = (u.roles || u.role || "").split(",").map((r) => r.trim());
    if ((u.roles || u.role) && !roles.includes("vendor")) {
      throw new Error("This app is for vendors only");
    }
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
    queryClient.clear();
  };

  const refreshUser = async () => {
    try {
      const u = await api.getMe();
      setUser(u);
    } catch (e) {
      if (import.meta.env.DEV) console.error("refreshUser failed:", e);
    }
  };

  return <Ctx.Provider value={{ user, token, loading, login, logout, refreshUser }}>{children}</Ctx.Provider>;
}
