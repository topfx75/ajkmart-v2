import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { api } from "./api";

interface AuthUser {
  id: string; phone: string; name?: string; email?: string;
  avatar?: string; isOnline: boolean; walletBalance: number;
  createdAt?: string; lastLoginAt?: string;
  stats: { deliveriesToday: number; earningsToday: number; totalDeliveries: number; totalEarnings: number; rating?: number };
  cnic?: string; city?: string; address?: string; emergencyContact?: string;
  vehicleType?: string; vehiclePlate?: string;
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
    const t = localStorage.getItem("ajkmart_rider_token") || localStorage.getItem("rider_token");
    if (t) {
      setToken(t);
      api.getMe().then(u => {
        setUser(u);
        /* Migrate legacy key to new key on successful load */
        if (!localStorage.getItem("ajkmart_rider_token")) {
          localStorage.setItem("ajkmart_rider_token", t);
          localStorage.removeItem("rider_token");
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
