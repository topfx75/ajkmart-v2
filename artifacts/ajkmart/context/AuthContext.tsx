import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
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
  totpEnabled?: boolean;
}

interface TwoFactorPending {
  tempToken: string;
  userId: string;
}

interface AuthContextType {
  user: AppUser | null;
  token: string | null;
  isLoading: boolean;
  isSuspended: boolean;
  suspendedMessage: string;
  biometricEnabled: boolean;
  twoFactorPending: TwoFactorPending | null;
  login: (user: AppUser, token: string, refreshToken?: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<AppUser>) => void;
  clearSuspended: () => void;
  setBiometricEnabled: (enabled: boolean) => Promise<void>;
  setTwoFactorPending: (pending: TwoFactorPending | null) => void;
  completeTwoFactorLogin: (user: AppUser, token: string, refreshToken?: string) => Promise<void>;
  attemptBiometricLogin: () => Promise<boolean>;
}

const TOKEN_KEY         = "@ajkmart_token";
const REFRESH_TOKEN_KEY = "@ajkmart_refresh_token";
const USER_KEY          = "@ajkmart_user";
const BIOMETRIC_KEY     = "@ajkmart_biometric_enabled";
const BIOMETRIC_TOKEN   = "@ajkmart_biometric_token";

const AuthContext = createContext<AuthContextType | null>(null);

function decodeJwtExp(tok: string): number | null {
  try {
    const parts = tok.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    let jsonStr: string;
    if (typeof atob === "function") {
      jsonStr = atob(b64);
    } else {
      jsonStr = Buffer.from(b64, "base64").toString("binary");
    }
    const payload = JSON.parse(jsonStr);
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSuspended, setIsSuspended] = useState(false);
  const [suspendedMessage, setSuspendedMessage] = useState("");
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [twoFactorPending, setTwoFactorPending] = useState<TwoFactorPending | null>(null);
  const { syncToServer, setAuthToken } = useLanguage();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRefreshTimer = () => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  };

  const scheduleProactiveRefresh = (tok: string) => {
    clearRefreshTimer();
    const exp = decodeJwtExp(tok);
    if (!exp) return;
    const expiresAt = exp * 1000;
    const refreshIn = Math.max((expiresAt - Date.now()) - 60_000, 10_000);
    refreshTimerRef.current = setTimeout(async () => {
      try {
        const refreshToken = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
        if (!refreshToken) {
          doLogout();
          return;
        }
        const base = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}`;
        const res = await fetch(`${base}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) {
          doLogout();
          return;
        }
        const data = await res.json() as { token?: string; refreshToken?: string };
        if (!data.token) {
          doLogout();
          return;
        }
        const meRes = await fetch(`${base}/api/users/profile`, {
          headers: { Authorization: `Bearer ${data.token}` },
        });
        if (meRes.ok) {
          const meData = await meRes.json();
          const freshUser: AppUser = meData.user || meData;
          setUser(freshUser);
          await AsyncStorage.setItem(USER_KEY, JSON.stringify(freshUser));
        }
        setToken(data.token);
        await AsyncStorage.setItem(TOKEN_KEY, data.token);
        if (data.refreshToken) {
          await AsyncStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
          setRefreshTokenGetter(() => data.refreshToken!);
        }
        setAuthTokenGetter(() => data.token!);
        scheduleProactiveRefresh(data.token!);
      } catch {
        doLogout();
      }
    }, refreshIn);
  };

  const clearCustomerLocation = async (userId: string, userToken: string) => {
    try {
      const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}/api`;
      await fetch(`${API_BASE}/locations/clear`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({ userId }),
      });
    } catch {}
  };

  const doLogout = async () => {
    /* Clear customer location before logging out */
    const tok = token;
    const u = user;
    if (u?.role === "customer" && tok) {
      clearCustomerLocation(u.id, tok).catch(() => {});
    }
    clearRefreshTimer();
    await AsyncStorage.multiRemove([USER_KEY, TOKEN_KEY, REFRESH_TOKEN_KEY]);
    try {
      const SecureStore = await import("expo-secure-store");
      await SecureStore.deleteItemAsync(BIOMETRIC_TOKEN);
    } catch {}
    setBiometricEnabledState(false);
    await AsyncStorage.setItem(BIOMETRIC_KEY, "false");
    setUser(null);
    setToken(null);
    setTwoFactorPending(null);
    setAuthToken(null);
    setAuthTokenGetter(null);
    setRefreshTokenGetter(null);
    setOnTokenRefreshed(null);
    setOnUnauthorized(null);
  };

  const registerAuth = useCallback((tok: string, refreshTok: string | null) => {
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
  }, []);

  useEffect(() => {
    const loadAuth = async () => {
      try {
        const [[, storedUser], [, storedToken], [, storedRefresh], [, bioPref]] = await AsyncStorage.multiGet([
          USER_KEY,
          TOKEN_KEY,
          REFRESH_TOKEN_KEY,
          BIOMETRIC_KEY,
        ]);
        if (bioPref === "true") setBiometricEnabledState(true);
        if (storedUser && storedToken) {
          const parsedUser = JSON.parse(storedUser);
          setUser(parsedUser);
          setToken(storedToken);
          setAuthToken(storedToken);
          registerAuth(storedToken, storedRefresh);
          syncToServer(storedToken).catch(() => {});
        }
      } catch {}
      setIsLoading(false);
    };
    loadAuth();
  }, [registerAuth]);

  const captureCustomerLocation = async (userId: string, userToken: string) => {
    try {
      const Location = await import("expo-location");
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}/api`;
      await fetch(`${API_BASE}/locations/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({
          userId,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          role: "customer",
        }),
      });
    } catch {}
  };

  const login = async (userData: AppUser, userToken: string, refreshToken?: string) => {
    const pairs: [string, string][] = [
      [USER_KEY, JSON.stringify(userData)],
      [TOKEN_KEY, userToken],
    ];
    if (refreshToken) pairs.push([REFRESH_TOKEN_KEY, refreshToken]);
    await AsyncStorage.multiSet(pairs);
    setUser(userData);
    setToken(userToken);
    setTwoFactorPending(null);
    setAuthToken(userToken);
    registerAuth(userToken, refreshToken ?? null);
    syncToServer(userToken).catch(() => {});
    /* Capture customer location on login (foreground only) */
    if (userData.role === "customer") {
      captureCustomerLocation(userData.id, userToken).catch(() => {});
    }
  };

  const completeTwoFactorLogin = async (userData: AppUser, userToken: string, refreshToken?: string) => {
    setTwoFactorPending(null);
    await login(userData, userToken, refreshToken);
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

  const setBiometricEnabled = async (enabled: boolean) => {
    setBiometricEnabledState(enabled);
    await AsyncStorage.setItem(BIOMETRIC_KEY, enabled ? "true" : "false");
    if (enabled && token) {
      try {
        const SecureStore = await import("expo-secure-store");
        const refreshTok = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
        if (refreshTok) {
          await SecureStore.setItemAsync(BIOMETRIC_TOKEN, refreshTok);
        }
      } catch {}
    } else if (!enabled) {
      try {
        const SecureStore = await import("expo-secure-store");
        await SecureStore.deleteItemAsync(BIOMETRIC_TOKEN);
      } catch {}
    }
  };

  const attemptBiometricLogin = async (): Promise<boolean> => {
    if (!biometricEnabled) return false;
    try {
      const LocalAuth = await import("expo-local-authentication");
      const hasHardware = await LocalAuth.hasHardwareAsync();
      if (!hasHardware) return false;
      const isEnrolled = await LocalAuth.isEnrolledAsync();
      if (!isEnrolled) return false;

      const result = await LocalAuth.authenticateAsync({
        promptMessage: "Login with Biometrics",
        cancelLabel: "Cancel",
        fallbackLabel: "Use password",
        disableDeviceFallback: false,
      });
      if (!result.success) {
        await setBiometricEnabled(false);
        return false;
      }

      const SecureStore = await import("expo-secure-store");
      const storedRefreshToken = await SecureStore.getItemAsync(BIOMETRIC_TOKEN);
      if (!storedRefreshToken) return false;

      const base = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}`;
      const res = await fetch(`${base}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: storedRefreshToken }),
      });
      if (!res.ok) {
        await SecureStore.deleteItemAsync(BIOMETRIC_TOKEN);
        setBiometricEnabledState(false);
        await AsyncStorage.setItem(BIOMETRIC_KEY, "false");
        return false;
      }
      const data = await res.json() as any;
      if (!data.token) return false;

      const meRes = await fetch(`${base}/api/users/profile`, {
        headers: { Authorization: `Bearer ${data.token}` },
      });
      if (!meRes.ok) return false;
      const meData = await meRes.json();
      const freshUser: AppUser = meData.user || meData;

      await login(freshUser, data.token, data.refreshToken);
      if (data.refreshToken) {
        await SecureStore.setItemAsync(BIOMETRIC_TOKEN, data.refreshToken);
      }
      return true;
    } catch {
      return false;
    }
  };

  return (
    <AuthContext.Provider value={{
      user, token, isLoading, isSuspended, suspendedMessage,
      biometricEnabled, twoFactorPending,
      login, logout, updateUser, clearSuspended,
      setBiometricEnabled, setTwoFactorPending,
      completeTwoFactorLogin, attemptBiometricLogin,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
