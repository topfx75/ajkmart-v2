export * from "./generated/api";
export * from "./generated/api.schemas";
export {
  customFetch,
  setBaseUrl,
  setAuthTokenGetter,
  setOnUnauthorized,
  setRefreshTokenGetter,
  setOnTokenRefreshed,
} from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";
export { rateRide, getDispatchStatus, retryRideDispatch } from "./ride-dispatch";
export {
  getBanners, getTrending, getForYou, getSimilar,
  trackInteraction, getProductVariants,
  getFlashDeals, getTrendingSearches,
} from "./discovery";
export type { Banner, RecommendationProduct, FlashDealProduct } from "./discovery";
