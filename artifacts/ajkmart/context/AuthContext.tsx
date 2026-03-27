import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

export type UserRole = "customer" | "rider" | "vendor";

export interface AppUser {
  id: string;
  phone: string;
  name?: string;
  email?: string;
  role: UserRole;
  avatar?: string;
  walletBalance: number;
  isActive: boolean;
  createdAt: string;
}

interface AuthContextType {
  user: AppUser | null;
  token: string | null;
  isLoading: boolean;
  login: (user: AppUser, token: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<AppUser>) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /* Register the token getter so all generated API hooks get auth automatically */
  const registerToken = (tok: string | null) => {
    setAuthTokenGetter(tok ? () => tok : null);
  };

  useEffect(() => {
    const loadAuth = async () => {
      try {
        const [storedUser, storedToken] = await AsyncStorage.multiGet(["@ajkmart_user", "@ajkmart_token"]);
        if (storedUser[1] && storedToken[1]) {
          const parsedUser = JSON.parse(storedUser[1]);
          const parsedToken = storedToken[1];
          setUser(parsedUser);
          setToken(parsedToken);
          registerToken(parsedToken);
        }
      } catch {}
      setIsLoading(false);
    };
    loadAuth();
  }, []);

  const login = async (userData: AppUser, userToken: string) => {
    await AsyncStorage.multiSet([
      ["@ajkmart_user", JSON.stringify(userData)],
      ["@ajkmart_token", userToken],
    ]);
    setUser(userData);
    setToken(userToken);
    registerToken(userToken);
  };

  const logout = async () => {
    await AsyncStorage.multiRemove(["@ajkmart_user", "@ajkmart_token"]);
    setUser(null);
    setToken(null);
    registerToken(null);
  };

  const updateUser = (updates: Partial<AppUser>) => {
    if (user) {
      const updated = { ...user, ...updates };
      setUser(updated);
      AsyncStorage.setItem("@ajkmart_user", JSON.stringify(updated));
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
