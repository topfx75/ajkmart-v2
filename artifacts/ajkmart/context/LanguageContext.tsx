import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useCallback, useState } from "react";
import { I18nManager } from "react-native";
import type { Language } from "@workspace/i18n";

const LANG_STORAGE_KEY = "@ajkmart_language";
const DEFAULT_LANGUAGE: Language = "en_roman";

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  loading: boolean;
  syncToServer: (token: string) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: DEFAULT_LANGUAGE,
  setLanguage: async () => {},
  loading: false,
  syncToServer: async () => {},
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (I18nManager.isRTL) {
      I18nManager.forceRTL(false);
    }
    AsyncStorage.getItem(LANG_STORAGE_KEY)
      .then((stored) => {
        if (stored) {
          setLanguageState(stored as Language);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const setLanguage = useCallback(async (lang: Language) => {
    setLanguageState(lang);
    try {
      await AsyncStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {}
  }, []);

  const syncToServer = useCallback(async (token: string) => {
    if (!token) return;
    try {
      const base = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}`;
      await fetch(`${base}/api/users/profile`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ language }),
      });
    } catch {}
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, loading, syncToServer }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
