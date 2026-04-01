import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react";
import { api } from "./api";

export interface AuthUser {
  id: string; phone: string; name?: string; email?: string;
  avatar?: string; isOnline: boolean; walletBalance: number;
  isRestricted?: boolean;
  role?: string;
  createdAt?: string; lastLoginAt?: string;
  stats: { deliveriesToday: number; earningsToday: number; totalDeliveries: number; totalEarnings: number; rating?: number };
  cnic?: string; city?: string; address?: string; emergencyContact?: string;
  vehicleType?: string; vehiclePlate?: string; vehiclePhoto?: string;
  vehicleRegNo?: string; drivingLicense?: string;
  bankName?: string; bankAccount?: string; bankAccountTitle?: string;
  twoFactorEnabled?: boolean;
  /** Document photo URLs — uploaded separately for admin verification */
  cnicDocUrl?: string | null;
  licenseDocUrl?: string | null;
  /** Registration document photo URL */
  regDocUrl?: string | null;
}

interface AuthCtx {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  twoFactorPending: boolean;
  setTwoFactorPending: (v: boolean) => void;
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
  const [twoFactorPending, setTwoFactorPending] = useState(false);
  const refreshFailCountRef = useRef(0);

  useEffect((): (() => void) | void => {
    /* Try sessionStorage first (new approach), fall back to localStorage for existing sessions */
    const t = api.getToken();
    if (!t) { setLoading(false); return; }

    setToken(t);
    const controller = new AbortController();
    api.getMe(controller.signal).then(u => {
      if (u.role && u.role !== "rider") {
        api.clearTokens();
        setToken(null);
        return;
      }
      setUser(u);
      refreshFailCountRef.current = 0;
    }).catch((err: unknown) => {
      if (err instanceof Error && err.name === "AbortError") return;
      api.clearTokens();
      setToken(null);
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  /* Register module-level logout callback so api.ts can trigger logout directly
     without relying only on the CustomEvent system. Also keep the CustomEvent
     listener as a secondary mechanism (it's useful for cross-tab scenarios). */
  useEffect(() => {
    const clearAuth = () => { setToken(null); setUser(null); };

    const unregister = api.registerLogoutCallback(clearAuth);

    const handleLogoutEvent = () => clearAuth();
    window.addEventListener("ajkmart:logout", handleLogoutEvent);

    return () => {
      unregister();
      window.removeEventListener("ajkmart:logout", handleLogoutEvent);
    };
  }, []);

  const login = (t: string, u: AuthUser, refreshToken?: string) => {
    if (u.role && u.role !== "rider") {
      throw new Error("This app is for riders only");
    }
    api.storeTokens(t, refreshToken);
    setToken(t);
    setUser(u);
    refreshFailCountRef.current = 0;
  };

  const logout = () => {
    const refreshTok = api.getRefreshToken();
    if (refreshTok) {
      api.logout(refreshTok).catch((err: Error) => {
        console.warn("[auth] Server logout failed (token already expired or network):", err.message);
      });
    } else {
      api.clearTokens();
    }
    setToken(null);
    setUser(null);
  };

  const refreshUser = async () => {
    try {
      const u = await api.getMe();
      setUser(u);
      refreshFailCountRef.current = 0;
    } catch {
      refreshFailCountRef.current += 1;
      if (refreshFailCountRef.current >= 3) {
        window.dispatchEvent(new CustomEvent("ajkmart:refresh-user-failed", {
          detail: { count: refreshFailCountRef.current },
        }));
      }
    }
  };

  return <Ctx.Provider value={{ user, token, loading, twoFactorPending, setTwoFactorPending, login, logout, refreshUser }}>{children}</Ctx.Provider>;
}
