import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  setAuthTokenGetter,
  setOnUnauthorized,
  setRefreshTokenGetter,
  setOnTokenRefreshed,
} from "@workspace/api-client-react";
import { useLanguage } from "./LanguageContext";
import { io, type Socket } from "socket.io-client";

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
  area?: string;
  address?: string;
  latitude?: string;
  longitude?: string;
  accountLevel?: string;
  kycStatus?: string;
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
  attemptBiometricLogin: () => Promise<string | null>;
  socket: Socket | null;
}

const TOKEN_KEY         = "ajkmart_token";
const REFRESH_TOKEN_KEY = "ajkmart_refresh_token";
const USER_KEY          = "@ajkmart_user";
const BIOMETRIC_KEY     = "@ajkmart_biometric_enabled";
const BIOMETRIC_TOKEN   = "ajkmart_biometric_token";

const LEGACY_TOKEN_KEY = "@ajkmart_token";
const LEGACY_REFRESH_KEY = "@ajkmart_refresh_token";

/* Auth tokens are stored exclusively in SecureStore. If SecureStore is unavailable
   the error propagates to the caller (login is blocked), preventing silent
   fallback to unencrypted AsyncStorage which is readable on rooted devices. */
async function secureSet(key: string, value: string) {
  await SecureStore.setItemAsync(key, value);
}
async function secureGet(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}
async function secureDelete(key: string) {
  try { await SecureStore.deleteItemAsync(key); } catch {}
  try { await AsyncStorage.removeItem(key); } catch {}
}

/* Migrate legacy AsyncStorage tokens to SecureStore and remove the unencrypted copies.
   Using a versioned SecureStore key ensures we only migrate once per device.
   Returns true if legacy tokens were found and migrated (or already migrated). */
const MIGRATED_KEY = "ajkmart_legacy_migration_v1";
async function migrateLegacyInsecureTokens(): Promise<boolean> {
  try {
    /* Check if already migrated on this device */
    const alreadyMigrated = await SecureStore.getItemAsync(MIGRATED_KEY).catch(() => null);
    if (alreadyMigrated === "1") return false;

    const [[, legacyToken], [, legacyRefresh]] = await AsyncStorage.multiGet([LEGACY_TOKEN_KEY, LEGACY_REFRESH_KEY]);
    const hadLegacy = !!(legacyToken || legacyRefresh);

    if (hadLegacy) {
      /* Migrate tokens to SecureStore if not already present */
      const existingToken = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
      const existingRefresh = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY).catch(() => null);
      if (!existingToken && legacyToken) {
        await SecureStore.setItemAsync(TOKEN_KEY, legacyToken).catch(() => {});
      }
      if (!existingRefresh && legacyRefresh) {
        await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, legacyRefresh).catch(() => {});
      }
      /* Remove the insecure copies */
      await AsyncStorage.multiRemove([LEGACY_TOKEN_KEY, LEGACY_REFRESH_KEY]).catch(() => {});
    }

    /* Mark migration as complete for this device */
    await SecureStore.setItemAsync(MIGRATED_KEY, "1").catch(() => {});
    return hadLegacy;
  } catch {
    return false;
  }
}

const AuthContext = createContext<AuthContextType | null>(null);

function decodeJwtExp(tok: string): number | null {
  try {
    const parts = tok.split(".");
    if (parts.length !== 3) return null;
    const b64 = (parts[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
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
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AppUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSuspended, setIsSuspended] = useState(false);
  const [suspendedMessage, setSuspendedMessage] = useState("");
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [twoFactorPending, setTwoFactorPending] = useState<TwoFactorPending | null>(null);
  const [socketState, setSocketState] = useState<Socket | null>(null);
  const { syncToServer, setAuthToken } = useLanguage();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* FIX 4: Refs so callbacks always see the latest user/token without stale closure */
  const userRef  = useRef<AppUser | null>(null);
  const tokenRef = useRef<string | null>(null);
  useEffect(() => { userRef.current  = user;  }, [user]);
  useEffect(() => { tokenRef.current = token; }, [token]);

  /* Ref to doLogout so registerAuth (empty-deps useCallback) can always call latest version */
  const doLogoutRef = useRef<() => Promise<void>>(async () => {});

  const clearRefreshTimer = () => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  };

  const refreshingRef = useRef(false);

  const scheduleProactiveRefresh = (tok: string) => {
    clearRefreshTimer();
    const exp = decodeJwtExp(tok);
    if (!exp) return;
    const expiresAt = exp * 1000;
    const refreshIn = Math.max((expiresAt - Date.now()) - 60_000, 10_000);
    refreshTimerRef.current = setTimeout(async () => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      try {
        const refreshToken = await secureGet(REFRESH_TOKEN_KEY);
        if (!refreshToken) {
          /* FIX 4: Use ref so we always call the latest doLogout */
          await doLogoutRef.current();
          return;
        }
        const base = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}`;
        const res = await fetch(`${base}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) {
          await doLogoutRef.current();
          return;
        }
        const data = await res.json() as { token?: string; refreshToken?: string };
        if (!data.token) {
          await doLogoutRef.current();
          return;
        }
        const meRes = await fetch(`${base}/api/users/profile`, {
          headers: { Authorization: `Bearer ${data.token}` },
        });
        if (meRes.ok) {
          const meData = await meRes.json();
          const freshUser: AppUser = meData.data || meData.user || meData;
          setUser(freshUser);
          await AsyncStorage.setItem(USER_KEY, JSON.stringify(freshUser));
        }
        setToken(data.token);
        await secureSet(TOKEN_KEY, data.token);
        if (data.refreshToken) {
          await secureSet(REFRESH_TOKEN_KEY, data.refreshToken);
          setRefreshTokenGetter(() => data.refreshToken!);
        }
        setAuthTokenGetter(() => data.token!);
        scheduleProactiveRefresh(data.token!);
      } catch {
        await doLogoutRef.current();
      } finally {
        refreshingRef.current = false;
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
    const tok = tokenRef.current;
    const u   = userRef.current;
    if (u?.role === "customer" && tok) {
      clearCustomerLocation(u.id, tok).catch(() => {});
    }

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setSocketState(null);
    }

    clearRefreshTimer();
    await AsyncStorage.multiRemove([USER_KEY, "@ajkmart_cart", "@ajkmart_auth_return_to"]);
    await secureDelete(TOKEN_KEY);
    await secureDelete(REFRESH_TOKEN_KEY);
    await secureDelete(BIOMETRIC_TOKEN);
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
    queryClient.clear();
  };

  /* FIX 4: Keep doLogoutRef always pointing to the latest doLogout */
  useEffect(() => { doLogoutRef.current = doLogout; });

  const registerAuth = useCallback((tok: string, refreshTok: string | null) => {
    setAuthTokenGetter(() => tok);
    setRefreshTokenGetter(refreshTok ? () => refreshTok : null);

    setOnTokenRefreshed(async (newToken: string, newRefreshToken: string) => {
      setToken(newToken);
      await secureSet(TOKEN_KEY, newToken);
      if (newRefreshToken) {
        await secureSet(REFRESH_TOKEN_KEY, newRefreshToken);
        setRefreshTokenGetter(() => newRefreshToken);
      }
      setAuthTokenGetter(() => newToken);
      scheduleProactiveRefresh(newToken);
    });

    /* FIX 4 + FIX 8: Use doLogoutRef so we always call the latest doLogout, and await it */
    setOnUnauthorized(async (statusCode?: number, errorMsg?: string) => {
      if (statusCode === 403) {
        setIsSuspended(true);
        setSuspendedMessage(errorMsg || "Your account has been suspended. Contact support.");
        return;
      }
      await doLogoutRef.current();
    });

    scheduleProactiveRefresh(tok);
  }, []);

  useEffect(() => {
    const loadAuth = async () => {
      try {
        /* Migrate any legacy unencrypted AsyncStorage tokens to SecureStore.
           If migration succeeds the tokens are now available via SecureStore below. */
        await migrateLegacyInsecureTokens();

        const [[, storedUser], [, bioPref]] = await AsyncStorage.multiGet([
          USER_KEY,
          BIOMETRIC_KEY,
        ]);

        /* If SecureStore is unavailable, secureGet throws. Catch separately to
           distinguish hardware encryption failure from other errors — in both cases
           we clear stored session data and require fresh login. */
        let storedToken: string | null = null;
        let storedRefresh: string | null = null;
        try {
          storedToken = await secureGet(TOKEN_KEY);
          storedRefresh = await secureGet(REFRESH_TOKEN_KEY);
        } catch {
          await AsyncStorage.multiRemove([USER_KEY, BIOMETRIC_KEY]);
          setIsLoading(false);
          return;
        }

        if (bioPref === "true") setBiometricEnabledState(true);
        if (storedUser && storedToken) {
          const parsedUser = JSON.parse(storedUser);
          const exp = decodeJwtExp(storedToken);
          const isExpired = exp ? exp * 1000 < Date.now() : false;

          if (isExpired && storedRefresh) {
            try {
              const base = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}`;
              const refreshRes = await fetch(`${base}/api/auth/refresh`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refreshToken: storedRefresh }),
              });
              if (refreshRes.ok) {
                const data = await refreshRes.json() as { token?: string; refreshToken?: string; user?: AppUser };
                if (data.token) {
                  await secureSet(TOKEN_KEY, data.token);
                  if (data.refreshToken) await secureSet(REFRESH_TOKEN_KEY, data.refreshToken);
                  const freshUser = data.user || parsedUser;
                  await AsyncStorage.setItem(USER_KEY, JSON.stringify(freshUser));
                  setUser(freshUser);
                  setToken(data.token);
                  setAuthToken(data.token);
                  registerAuth(data.token, data.refreshToken ?? storedRefresh);
                  syncToServer(data.token).catch(() => {});
                  setIsLoading(false);
                  return;
                }
              }
            } catch {}
            await AsyncStorage.multiRemove([USER_KEY]);
            await secureDelete(TOKEN_KEY);
            await secureDelete(REFRESH_TOKEN_KEY);
          } else if (isExpired) {
            await AsyncStorage.multiRemove([USER_KEY]);
            await secureDelete(TOKEN_KEY);
            await secureDelete(REFRESH_TOKEN_KEY);
          } else {
            setUser(parsedUser);
            setToken(storedToken);
            setAuthToken(storedToken);
            registerAuth(storedToken, storedRefresh);
            syncToServer(storedToken).catch(() => {});
          }
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
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(userData));
    await secureSet(TOKEN_KEY, userToken);
    if (refreshToken) await secureSet(REFRESH_TOKEN_KEY, refreshToken);
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

  const clearSuspended = async () => {
    setIsSuspended(false);
    setSuspendedMessage("");
    await doLogout();
  };

  const setBiometricEnabled = async (enabled: boolean) => {
    setBiometricEnabledState(enabled);
    await AsyncStorage.setItem(BIOMETRIC_KEY, enabled ? "true" : "false");
    /* biometric pref is non-sensitive — stays in AsyncStorage */
    if (enabled && token) {
      try {
        const refreshTok = await secureGet(REFRESH_TOKEN_KEY);
        if (refreshTok) {
          await secureSet(BIOMETRIC_TOKEN, refreshTok);
        }
      } catch {}
    } else if (!enabled) {
      try {
        await secureDelete(BIOMETRIC_TOKEN);
      } catch {}
    }
  };

  const attemptBiometricLogin = async (): Promise<string | null> => {
    if (!biometricEnabled) return null;
    try {
      const LocalAuth = await import("expo-local-authentication");
      const hasHardware = await LocalAuth.hasHardwareAsync();
      if (!hasHardware) return null;
      const isEnrolled = await LocalAuth.isEnrolledAsync();
      if (!isEnrolled) return null;

      const result = await LocalAuth.authenticateAsync({
        promptMessage: "Login with Biometrics",
        cancelLabel: "Cancel",
        fallbackLabel: "Use password",
        disableDeviceFallback: false,
      });
      if (!result.success) {
        /* FIX 7: Only permanently disable biometric on actual hardware/lockout failures.
           User cancel or fallback should NOT disable it. */
        const nonFatalErrors = ["user_cancel", "system_cancel", "user_fallback", "app_cancel"];
        const isFatal = !result.error || !nonFatalErrors.includes(result.error as string);
        if (isFatal) {
          await setBiometricEnabled(false);
        }
        return null;
      }

      const storedRefreshToken = await secureGet(BIOMETRIC_TOKEN);
      if (!storedRefreshToken) return null;

      const base = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}`;
      const res = await fetch(`${base}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: storedRefreshToken }),
      });
      if (!res.ok) {
        await secureDelete(BIOMETRIC_TOKEN);
        setBiometricEnabledState(false);
        await AsyncStorage.setItem(BIOMETRIC_KEY, "false");
        return null;
      }
      const data = await res.json() as any;
      if (!data.token) return null;

      const meRes = await fetch(`${base}/api/users/profile`, {
        headers: { Authorization: `Bearer ${data.token}` },
      });
      if (!meRes.ok) return null;
      const meData = await meRes.json();
      const freshUser: AppUser = meData.data || meData.user || meData;

      await login(freshUser, data.token, data.refreshToken);
      if (data.refreshToken) {
        await secureSet(BIOMETRIC_TOKEN, data.refreshToken);
      }
      return freshUser.role ?? "customer";
    } catch {
      return null;
    }
  };

  const socketRef = useRef<Socket | null>(null);
  useEffect(() => {
    if (!token || !user?.id) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }
    const base = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}`;
    const socket = io(base, {
      path: "/api/socket.io",
      auth: { token },
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;
    setSocketState(socket);

    const handleWalletBalance = (payload: { balance: number }) => {
      if (typeof payload?.balance === "number") {
        setUser(prev => prev ? { ...prev, walletBalance: payload.balance } : prev);
        AsyncStorage.getItem(USER_KEY).then(stored => {
          if (!stored) return;
          try {
            const parsed = JSON.parse(stored);
            AsyncStorage.setItem(USER_KEY, JSON.stringify({ ...parsed, walletBalance: payload.balance }));
          } catch {}
        });
      }
    };

    socket.on("wallet:update", handleWalletBalance);
    socket.on("wallet:balance", handleWalletBalance);

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setSocketState(null);
    };
  }, [token, user?.id]);

  return (
    <AuthContext.Provider value={{
      user, token, isLoading, isSuspended, suspendedMessage,
      biometricEnabled, twoFactorPending,
      login, logout, updateUser, clearSuspended,
      setBiometricEnabled, setTwoFactorPending,
      completeTwoFactorLogin, attemptBiometricLogin,
      socket: socketState,
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
