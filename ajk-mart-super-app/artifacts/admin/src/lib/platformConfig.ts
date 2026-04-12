import { fetcher } from "./api";

export const PLATFORM_DEFAULTS = {
  currencySymbol: "Rs.",
  vendorCommissionPct: 15,
  defaultLat: 33.7215,
  defaultLng: 73.0433,
} as const;

let _currencySymbol: string = PLATFORM_DEFAULTS.currencySymbol;

export const setCurrencySymbol = (sym: string) => {
  _currencySymbol = sym || PLATFORM_DEFAULTS.currencySymbol;
};

export const getCurrencySymbol = () => _currencySymbol;

export const loadPlatformConfig = async () => {
  // Skip the API call if there is no admin token — this function is called
  // at app startup (main.tsx), which runs before login. Making an
  // unauthenticated request here causes a 401 that the api.ts handler could
  // use to clear a freshly-saved login token (race condition).
  if (!localStorage.getItem("ajkmart_admin_token")) return;
  try {
    const data = await fetcher("/platform-settings");
    const settings: { key: string; value: string }[] = data.settings || [];
    const sym = settings.find(s => s.key === "currency_symbol")?.value;
    if (sym) setCurrencySymbol(sym);
  } catch {
    // silently fall back to default
  }
};
