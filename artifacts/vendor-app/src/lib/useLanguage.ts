import { useState, useEffect, useCallback } from "react";
import { api } from "./api";
import type { Language } from "@workspace/i18n";
import { DEFAULT_LANGUAGE, LANGUAGE_OPTIONS, isRTL } from "@workspace/i18n";

interface SettingsResponse {
  language?: string;
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
    api.getSettings()
      .then((s: SettingsResponse) => {
        if (s?.language && VALID_LANGS.has(s.language)) {
          const lang = s.language as Language;
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
    try {
      await api.updateSettings({ language: lang });
    } catch {}
    setLoading(false);
  }, []);

  return { language, setLanguage, loading, initialised };
}
