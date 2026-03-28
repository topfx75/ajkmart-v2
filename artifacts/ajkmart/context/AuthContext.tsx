import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  setAuthTokenGetter,
  setOnUnauthorized,
  setRefreshTokenGetter,
  setOnTokenRefreshed,
} from "@workspace/api-client-react";
import { useLanguage } from "./LanguageContext";

export type UserRole = "customer" | "rider" | "vendor";

export interface AppUser {
  id: string;
  phone: string;
  name?: string;
  email?: string;
  username?: string;
  role: UserRole;
  avatar?: string;
  walletBalance: number;
  isActive: boolean;
  createdAt: string;
  cnic?: string;
  city?: string;
}

interface AuthContextType {
  user: AppUser | null;
  token: string | null;
  isLoading: boolean;
  isSuspended: boolean;
  suspendedMessage: string;
  login: (user: AppUser, token: string, refreshToken?: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<AppUser>) => void;
  clearSuspended: () => void;
}

const TOKEN_KEY         = "@ajkmart_token";
const REFRESH_TOKEN_KEY = "@ajkmart_refresh_token";
const USER_KEY          = "@ajkmart_user";

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSuspended, setIsSuspended] = useState(false);
  const [suspendedMessage, setSuspendedMessage] = useState("");
  const { syncToServer } = useLanguage();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRefreshTimer = () => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  };

  const scheduleProactiveRefresh = (tok: string) => {
    clearRefreshTimer();
    try {
      const parts = tok.split(".");
      if (parts.length === 3) {
        const b64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
        const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
        const payload = JSON.parse(bin);
        if (payload.exp) {
          const expiresAt = payload.exp * 1000;
          const refreshIn = Math.max((expiresAt - Date.now()) - 60_000, 10_000);
          refreshTimerRef.current = setTimeout(async () => {
            try {
              const refreshToken = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
              if (!refreshToken) return;
              const base = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}`;
              const res = await fetch(`${base}/api/auth/refresh`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refreshToken }),
              });
              if (!res.ok) return;
              const data = await res.json() as { token?: string; refreshToken?: string };
              if (data.token) {
                setToken(data.token);
                await AsyncStorage.setItem(TOKEN_KEY, data.token);
                if (data.refreshToken) {
                  await AsyncStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
                  setRefreshTokenGetter(() => data.refreshToken!);
                }
                setAuthTokenGetter(() => data.token!);
                scheduleProactiveRefresh(data.token!);
              }
            } catch {}
          }, refreshIn);
        }
      }
    } catch {}
  };

  const doLogout = async () => {
    clearRefreshTimer();
    await AsyncStorage.multiRemove([USER_KEY, TOKEN_KEY, REFRESH_TOKEN_KEY]);
    setUser(null);
    setToken(null);
    setAuthTokenGetter(null);
    setRefreshTokenGetter(null);
    setOnTokenRefreshed(null);
    setOnUnauthorized(null);
  };

  const registerAuth = (tok: string, refreshTok: string | null) => {
    setAuthTokenGetter(() => tok);
    setRefreshTokenGetter(refreshTok ? () => refreshTok : null);

    setOnTokenRefreshed(async (newToken: string, newRefreshToken: string) => {
      setToken(newToken);
      await AsyncStorage.setItem(TOKEN_KEY, newToken);
      if (newRefreshToken) {
        await AsyncStorage.setItem(REFRESH_TOKEN_KEY, newRefreshToken);
        setRefreshTokenGetter(() => newRefreshToken);
      }
      setAuthTokenGetter(() => newToken);
      scheduleProactiveRefresh(newToken);
    });

    setOnUnauthorized((statusCode?: number, errorMsg?: string) => {
      if (statusCode === 403) {
        setIsSuspended(true);
        setSuspendedMessage(errorMsg || "Your account has been suspended. Contact support.");
        return;
      }
      doLogout();
    });

    scheduleProactiveRefresh(tok);
  };

  useEffect(() => {
    const loadAuth = async () => {
      try {
        const [[, storedUser], [, storedToken], [, storedRefresh]] = await AsyncStorage.multiGet([
          USER_KEY,
          TOKEN_KEY,
          REFRESH_TOKEN_KEY,
        ]);
        if (storedUser && storedToken) {
          const parsedUser = JSON.parse(storedUser);
          setUser(parsedUser);
          setToken(storedToken);
          registerAuth(storedToken, storedRefresh);
        }
      } catch {}
      setIsLoading(false);
    };
    loadAuth();
  }, []);

  const login = async (userData: AppUser, userToken: string, refreshToken?: string) => {
    const pairs: [string, string][] = [
      [USER_KEY, JSON.stringify(userData)],
      [TOKEN_KEY, userToken],
    ];
    if (refreshToken) pairs.push([REFRESH_TOKEN_KEY, refreshToken]);
    await AsyncStorage.multiSet(pairs);
    setUser(userData);
    setToken(userToken);
    registerAuth(userToken, refreshToken ?? null);
    syncToServer(userToken).catch(() => {});
  };

  const logout = async () => {
    await doLogout();
  };

  const updateUser = (updates: Partial<AppUser>) => {
    if (user) {
      const updated = { ...user, ...updates };
      setUser(updated);
      AsyncStorage.setItem(USER_KEY, JSON.stringify(updated));
    }
  };

  const clearSuspended = () => {
    setIsSuspended(false);
    setSuspendedMessage("");
    doLogout();
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, isSuspended, suspendedMessage, login, logout, updateUser, clearSuspended }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
