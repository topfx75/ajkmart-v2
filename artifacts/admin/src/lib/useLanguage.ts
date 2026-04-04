import { useState, useCallback, useEffect } from "react";
import type { Language } from "@workspace/i18n";
import { DEFAULT_LANGUAGE, LANGUAGE_OPTIONS, isRTL } from "@workspace/i18n";
import { fetcher, getToken } from "./api";

const VALID_LANGS = new Set<string>(LANGUAGE_OPTIONS.map(o => o.value));
const STORAGE_KEY = "ajkmart_admin_language";

function applyRTL(lang: Language) {
  const dir = isRTL(lang) ? "rtl" : "ltr";
  document.documentElement.setAttribute("dir", dir);
  document.documentElement.setAttribute("lang", lang === "ur" || lang === "en_ur" ? "ur" : "en");
}

function getSavedLanguage(): Language | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && VALID_LANGS.has(saved)) return saved as Language;
  } catch {}
  return null;
}

export function useLanguage() {
  const [language, setLang] = useState<Language>(() => {
    const local = getSavedLanguage() ?? DEFAULT_LANGUAGE;
    applyRTL(local);
    return local;
  });
  const [loading, setLoading] = useState(false);
  const [initialised, setInitialised] = useState(false);

  useEffect(() => {
    const bootstrap = async () => {
      // If there is no auth token the user is on the login page — skip all
      // API calls entirely.  Making unauthenticated calls here triggered a
      // race condition: the in-flight 401 response arrived after the user
      // logged in and api.ts would delete the freshly-stored token, causing
      // an immediate logout.
      if (!getToken()) {
        const local = getSavedLanguage();
        if (local) {
          setLang(local);
          applyRTL(local);
        }
        setInitialised(true);
        return;
      }

      try {
        const data = await fetcher("/me/language");
        const serverLang: string | null = data?.language ?? null;
        if (serverLang && VALID_LANGS.has(serverLang)) {
          setLang(serverLang as Language);
          applyRTL(serverLang as Language);
          try { localStorage.setItem(STORAGE_KEY, serverLang); } catch {}
          setInitialised(true);
          return;
        }
      } catch {}

      const local = getSavedLanguage();
      if (local) {
        setInitialised(true);
        return;
      }

      try {
        const data = await fetcher("/platform-settings") as { settings?: { key: string; value: string }[] };
        const settings: { key: string; value: string }[] = data?.settings || [];
        const platformLang = settings.find(s => s.key === "default_language")?.value;
        if (platformLang && VALID_LANGS.has(platformLang)) {
          setLang(platformLang as Language);
          applyRTL(platformLang as Language);
        }
      } catch {}

      setInitialised(true);
    };

    bootstrap();
  }, []);

  const setLanguage = useCallback(async (lang: Language) => {
    setLoading(true);
    setLang(lang);
    applyRTL(lang);
    try { localStorage.setItem(STORAGE_KEY, lang); } catch {}
    try {
      await fetcher("/me/language", { method: "PUT", body: JSON.stringify({ language: lang }) });
    } catch {}
    setLoading(false);
  }, []);

  return { language, setLanguage, loading, initialised };
}
