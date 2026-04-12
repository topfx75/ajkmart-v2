import { useState, useEffect, useCallback } from "react";
import { api } from "./api";
import type { Language } from "@workspace/i18n";
import { DEFAULT_LANGUAGE, LANGUAGE_OPTIONS, isRTL } from "@workspace/i18n";

interface PlatformConfigResponse {
  language?: { defaultLanguage?: string; enabledLanguages?: string[] };
  [key: string]: unknown;
}

const VALID_LANGS = new Set<string>(LANGUAGE_OPTIONS.map(o => o.value));

function applyRTL(lang: Language) {
  const dir = isRTL(lang) ? "rtl" : "ltr";
  document.documentElement.setAttribute("dir", dir);
  document.documentElement.setAttribute("lang", lang === "ur" || lang === "en_ur" ? "ur" : "en");
}

export function useLanguage() {
  const [language, setLang] = useState<Language>(DEFAULT_LANGUAGE);
  const [loading, setLoading] = useState(false);
  const [initialised, setInitialised] = useState(false);

  useEffect(() => {
    api.getPlatformConfig()
      .then((s: PlatformConfigResponse) => {
        const serverLang = s?.language?.defaultLanguage;
        if (serverLang && VALID_LANGS.has(serverLang)) {
          const lang = serverLang as Language;
          setLang(lang);
          applyRTL(lang);
        }
      })
      .catch(() => {})
      .finally(() => setInitialised(true));
  }, []);

  const setLanguage = useCallback(async (lang: Language) => {
    setLoading(true);
    setLang(lang);
    applyRTL(lang);
    setLoading(false);
  }, []);

  return { language, setLanguage, loading, initialised };
}
