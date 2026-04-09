import type { Request } from "express";
import type { Language } from "@workspace/i18n";
import { getUserLanguage, getPlatformDefaultLanguage } from "./getUserLanguage.js";

const VALID_LANGUAGES: Language[] = ["en", "ur", "roman", "en_roman", "en_ur"];

const ACCEPT_LANGUAGE_MAP: Record<string, Language> = {
  ur: "ur",
  "ur-PK": "ur",
  "ur-pk": "ur",
  en: "en",
  "en-US": "en",
  "en-GB": "en",
  "en-us": "en",
  "en-gb": "en",
};

export function parseAcceptLanguage(header: string | undefined): Language | null {
  if (!header) return null;
  const tags = header.split(",").map(s => s.trim().split(";")[0]!.trim());
  for (const tag of tags) {
    const mapped = ACCEPT_LANGUAGE_MAP[tag];
    if (mapped) return mapped;
    const primary = tag.split("-")[0]!.toLowerCase();
    if (primary === "ur") return "ur";
    if (primary === "en") return "en";
  }
  return null;
}

export async function getRequestLocale(req: Request, userId?: string | null): Promise<Language> {
  const fromHeader = parseAcceptLanguage(req.headers["accept-language"] as string | undefined);
  if (fromHeader) return fromHeader;

  if (userId) {
    try {
      return await getUserLanguage(userId);
    } catch {}
  }

  return getPlatformDefaultLanguage();
}
