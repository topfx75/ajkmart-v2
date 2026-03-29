import { useState, useCallback } from "react";
import type { Language } from "@workspace/i18n";

export function useLanguage() {
  const [language] = useState<Language>("en");
  const [loading] = useState(false);
  const [initialised] = useState(true);

  const setLanguage = useCallback(async (_lang: Language) => {
  }, []);

  return { language, setLanguage, loading, initialised };
}
