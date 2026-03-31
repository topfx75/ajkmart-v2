import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import React from "react";
import type { Language } from "@workspace/i18n";
import { LANGUAGE_OPTIONS, isRTL } from "@workspace/i18n";
import { api } from "./api";

const STORAGE_KEY = "ajkmart_rider_language";
const VALID_LANGS = new Set<string>(LANGUAGE_OPTIONS.map(o => o.value));

function getStoredLanguage(): Language | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && VALID_LANGS.has(stored)) return stored as Language;
  } catch {}
  return null;
}

function applyRTL(lang: Language) {
  const dir = isRTL(lang) ? "rtl" : "ltr";
  document.documentElement.setAttribute("dir", dir);
  document.documentElement.setAttribute("lang", lang === "ur" || lang === "en_ur" ? "ur" : "en");
}

interface LanguageCtx {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  loading: boolean;
  initialised: boolean;
}

const LanguageContext = createContext<LanguageCtx>({
  language: "en",
  setLanguage: async () => {},
  loading: false,
  initialised: false,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");
  const [loading, setLoading] = useState(false);
  const [initialised, setInitialised] = useState(false);

  useEffect(() => {
    const local = getStoredLanguage();
    if (local) {
      setLanguageState(local);
      applyRTL(local);
      setInitialised(true);
      api.getSettings()
        .then((data: { language?: string }) => {
          const serverLang = data?.language;
          if (serverLang && VALID_LANGS.has(serverLang) && serverLang !== local) {
            setLanguageState(serverLang as Language);
            applyRTL(serverLang as Language);
            try { localStorage.setItem(STORAGE_KEY, serverLang); } catch {}
          }
        })
        .catch(() => {});
    } else {
      api.getSettings()
        .then((data: { language?: string }) => {
          const serverLang = data?.language;
          if (serverLang && VALID_LANGS.has(serverLang)) {
            setLanguageState(serverLang as Language);
            applyRTL(serverLang as Language);
            try { localStorage.setItem(STORAGE_KEY, serverLang); } catch {}
          }
        })
        .catch(() => {})
        .finally(() => setInitialised(true));
    }
  }, []);

  const setLanguage = useCallback(async (lang: Language) => {
    setLoading(true);
    setLanguageState(lang);
    applyRTL(lang);
    try { localStorage.setItem(STORAGE_KEY, lang); } catch {}
    try {
      await api.updateSettings({ language: lang });
    } catch {}
    setLoading(false);
  }, []);

  return React.createElement(
    LanguageContext.Provider,
    { value: { language, setLanguage, loading, initialised } },
    children
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
