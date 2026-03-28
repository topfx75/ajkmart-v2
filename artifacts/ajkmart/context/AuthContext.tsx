import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";
import {
  setAuthTokenGetter,
  setOnUnauthorized,
  setRefreshTokenGetter,
  setOnTokenRefreshed,
} from "@workspace/api-client-react";

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
  login: (user: AppUser, token: string, refreshToken?: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<AppUser>) => void;
}

const TOKEN_KEY         = "@ajkmart_token";
const REFRESH_TOKEN_KEY = "@ajkmart_refresh_token";
const USER_KEY          = "@ajkmart_user";

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const doLogout = async () => {
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
    });

    setOnUnauthorized(() => {
      doLogout();
    });
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

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
