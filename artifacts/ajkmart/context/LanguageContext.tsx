import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { I18nManager } from "react-native";
import type { Language } from "@workspace/i18n";
import { DEFAULT_LANGUAGE, isRTL } from "@workspace/i18n";

const API = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
const LANG_STORAGE_KEY = "@ajkmart_language";

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  loading: boolean;
  syncToServer: (token: string) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: DEFAULT_LANGUAGE,
  setLanguage: async () => {},
  loading: true,
  syncToServer: async () => {},
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLang] = useState<Language>(DEFAULT_LANGUAGE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(LANG_STORAGE_KEY)
      .then((stored) => {
        if (stored) {
          const lang = stored as Language;
          setLang(lang);
          const rtl = isRTL(lang);
          if (I18nManager.isRTL !== rtl) {
            I18nManager.forceRTL(rtl);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const setLanguage = useCallback(async (lang: Language) => {
    setLang(lang);
    const rtl = isRTL(lang);
    if (I18nManager.isRTL !== rtl) {
      I18nManager.forceRTL(rtl);
    }
    await AsyncStorage.setItem(LANG_STORAGE_KEY, lang).catch(() => {});
  }, []);

  const syncToServer = useCallback(async (token: string) => {
    if (!token) return;
    const stored = await AsyncStorage.getItem(LANG_STORAGE_KEY).catch(() => null);
    try {
      const r = await fetch(`${API}/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      if (d.language && !stored) {
        const serverLang = d.language as Language;
        setLang(serverLang);
        const rtl = isRTL(serverLang);
        if (I18nManager.isRTL !== rtl) {
          I18nManager.forceRTL(rtl);
        }
        await AsyncStorage.setItem(LANG_STORAGE_KEY, serverLang).catch(() => {});
      } else if (stored && stored !== d.language) {
        await fetch(`${API}/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ language: stored }),
        }).catch(() => {});
      }
    } catch {}
  }, []);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, loading, syncToServer }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
