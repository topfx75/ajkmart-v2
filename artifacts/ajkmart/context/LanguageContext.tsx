import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { I18nManager } from "react-native";
import type { Language } from "@workspace/i18n";
import { DEFAULT_LANGUAGE, isRTL } from "@workspace/i18n";
import { useAuth } from "./AuthContext";

const API = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  loading: boolean;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: DEFAULT_LANGUAGE,
  setLanguage: async () => {},
  loading: false,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const { token, user } = useAuth();
  const [language, setLang] = useState<Language>(DEFAULT_LANGUAGE);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token || !user?.id) return;
    fetch(`${API}/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => {
        if (d.language) {
          setLang(d.language as Language);
          const rtl = isRTL(d.language as Language);
          if (I18nManager.isRTL !== rtl) {
            I18nManager.forceRTL(rtl);
          }
        }
      })
      .catch(() => {});
  }, [token, user?.id]);

  const setLanguage = useCallback(async (lang: Language) => {
    setLoading(true);
    try {
      setLang(lang);
      const rtl = isRTL(lang);
      if (I18nManager.isRTL !== rtl) {
        I18nManager.forceRTL(rtl);
      }
      if (token) {
        await fetch(`${API}/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ language: lang }),
        });
      }
    } catch {}
    setLoading(false);
  }, [token]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, loading }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
