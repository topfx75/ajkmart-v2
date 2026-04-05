# AJKMart Super App — Workspace

### Overview
AJKMart is a full-stack "Super App" designed for Azad Jammu & Kashmir (AJK), Pakistan. It integrates multiple services including Grocery Shopping (Mart), Food Delivery, Taxi/Bike Booking (Rides), Pharmacy, and Parcel Delivery, all unified by a digital wallet. The project aims to provide a comprehensive, localized service platform for the region.

### Guest-to-Auth Flow Audit & Hardening — Completed Changes

#### AuthGateSheet Component
- **`artifacts/ajkmart/components/AuthGateSheet.tsx`**: New bottom-sheet auth prompt with `AuthGateSheet` (sign-in prompt with "Sign In" and "Continue Browsing" buttons), `RoleBlockSheet` (blocks vendor/rider accounts from customer actions), and `useAuthGate`/`useRoleGate` hooks for consistent gating pattern.

#### Auth Gating Applied Across Screens
- **`app/food/index.tsx`**, **`app/mart/index.tsx`**, **`app/product/[id].tsx`**, **`app/search.tsx`**, **`app/pharmacy/index.tsx`**, **`components/WishlistHeart.tsx`**, **`components/ride/RideBookingForm.tsx`**, **`app/cart/index.tsx`**: All auth-required actions (add to cart, place order, book ride, wishlist toggle, prescription upload) now show `AuthGateSheet` for guests and `RoleBlockSheet` for vendor/rider accounts instead of crashing or silently failing.

#### Null/Undefined Crash Fixes
- **`app/(tabs)/profile.tsx`**: Optional chaining on `user.name.split`, `user.avatar.startsWith`, `user.username`, `user.city`, `user.area`, `user.address`, `user.latitude`, `user.longitude`, `user.cnic`.

#### Ghost Cart State on Logout
- **`context/AuthContext.tsx`**: Socket disconnect happens before state clear; `@ajkmart_cart` AsyncStorage key cleared in `doLogout`.
- **`context/CartContext.tsx`**: Watches token transition from truthy to null — resets in-memory cart items and ack state on logout.
- **`app/_layout.tsx`**: React Query cache cleared when user transitions from logged-in to logged-out.

#### Guest Browsing Routes
- **`app/_layout.tsx`**: `GUEST_BROWSABLE` route set allows guests to browse food, mart, ride, pharmacy, parcel, product, search, cart, and categories screens without forced redirect to auth. Auth-required actions within these screens are gated at the action level via AuthGateSheet.

#### Home Screen Service Navigation
- **`app/(tabs)/index.tsx`**: Service grid/list no longer redirects guests to `/auth`; guests navigate directly to service screens where action-level auth gates handle protected operations. Lock badge icons removed.

### Dynamic Categories System — Completed Changes

#### Database Schema
- **`lib/db/src/schema/categories.ts`**: New `categories` table with fields: id, name, icon, type (mart/food/pharmacy), parentId (self-referencing hierarchy), sortOrder, isActive, timestamps.

#### API Endpoints
- **`artifacts/api-server/src/routes/categories.ts`**: Replaced hardcoded category arrays with database-driven categories. Endpoints: GET `/categories` (hierarchical list with children and product counts), GET `/categories/tree` (full tree for admin), POST/PATCH/DELETE for CRUD, POST `/categories/reorder`. Auto-seeds initial categories from previous hardcoded data.
- **`artifacts/api-server/src/routes/admin.ts`**: Admin-specific category management routes: GET `/admin/categories/tree`, POST/PATCH/DELETE for admin CRUD.

#### Admin Panel
- **`artifacts/admin/src/pages/categories.tsx`**: Categories management page with expandable tree view, type filtering (mart/food/pharmacy), add/edit/delete dialogs, parent category selection, icon picker, active/inactive toggle, sort order management.
- **`artifacts/admin/src/App.tsx`**: Route registered at `/categories`.
- **`artifacts/admin/src/components/layout/AdminLayout.tsx`**: Navigation entry added under "Vendor Portal" group.

#### Mobile App
- **`artifacts/ajkmart/app/categories/index.tsx`**: Full-screen categories browsing with AliExpress-style sidebar navigation. Left sidebar shows top-level categories with active indicator, right panel shows sub-categories grid and product list filtered by selected category.
- **`artifacts/ajkmart/app/search.tsx`**: Enhanced filter panel with price range inputs, star rating filter chips (Any, 3★+, 3.5★+, 4★+, 4.5★+), clear all button, and apply filters button.

#### API Client
- **`lib/api-client-react/src/discovery.ts`**: Added `getHierarchicalCategories` function and `HierarchicalCategory` interface.
- **`lib/api-client-react/src/index.ts`**: Exported new function and type.

#### i18n
- **`lib/i18n/src/index.ts`**: Added `navCategories` translation key in English, Urdu, and Hindi sections.

### Product Reviews, Wishlist & Image Gallery — Completed Changes

#### Backend
- **`artifacts/api-server/src/routes/wishlist.ts`**: New wishlist API with POST add, DELETE remove, GET list, GET check endpoints (all auth-protected, user-scoped).
- **`artifacts/api-server/src/routes/reviews.ts`**: Extended with GET `/reviews/product/:productId` (paginated), GET `/reviews/product/:productId/summary` (avg/distribution), and new `orderType: "product"` branch in POST that validates product existence instead of order ownership. Duplicate check uses `productId + userId` for product reviews.

#### API Client
- **`lib/api-client-react/src/discovery.ts`**: Added `getWishlist`, `addToWishlist`, `removeFromWishlist`, `checkWishlist`, `getProductReviews`, `getProductReviewSummary`, `submitProductReview`, `uploadImage` functions with TypeScript types (`WishlistItem`, `ProductReview`, `ProductReviewsResponse`, `ReviewSummary`).

#### Mobile App (AJKMart)
- **`artifacts/ajkmart/components/WishlistHeart.tsx`**: Reusable heart toggle component with optimistic updates, scale animation, wishlist query cache hydration.
- **`artifacts/ajkmart/app/product/[id].tsx`**: Full rewrite with wishlist heart, full-screen image viewer, multi-image carousel with dot indicators, reviews section with rating bars/distribution, Write Review modal (star picker + text + up to 3 photos via image picker).
- **`artifacts/ajkmart/app/wishlist.tsx`**: Dedicated wishlist screen with 2-column grid, remove-with-animation, auth guard, empty/error/loading states.
- **`artifacts/ajkmart/app/(tabs)/profile.tsx`**: Added "My Wishlist" entry in activity section.
- **`artifacts/ajkmart/app/(tabs)/index.tsx`**: Heart icons on trending products and flash deal cards.
- **`artifacts/ajkmart/app/mart/index.tsx`**: Heart icons on FlashCard and ProductCard components.
- **`artifacts/ajkmart/app/search.tsx`**: Heart icons on search result cards.

### Step 3: UI/UX & Refactoring — Completed Changes

#### B-17/B-21: Admin Route Split
- **`artifacts/api-server/src/routes/admin.ts`**: Refactored from 5267-line monolith into a thin barrel file mounting 7 sub-routers.
- **`artifacts/api-server/src/routes/admin-shared.ts`**: Shared exports (AdminRequest type, stripUser, adminAuth, getPlatformSettings, revokeAllUserSessions, serializeSosAlert, notification key constants, DEFAULT_PLATFORM_SETTINGS, login attempt map, ride/location defaults).
- **`artifacts/api-server/src/routes/admin/auth.ts`**: Admin login/register/logout.
- **`artifacts/api-server/src/routes/admin/users.ts`**: User management, ban/unban, identity edits, KYC, debt.
- **`artifacts/api-server/src/routes/admin/orders.ts`**: Order management, status updates, rider assignment.
- **`artifacts/api-server/src/routes/admin/rides.ts`**: Ride management, service types, cancellation, refunds.
- **`artifacts/api-server/src/routes/admin/finance.ts`**: Payouts, commission, vendor/rider financials.
- **`artifacts/api-server/src/routes/admin/content.ts`**: Banners, FAQs, promos, categories, flash deals.
- **`artifacts/api-server/src/routes/admin/system.ts`**: Settings, notifications, audit, analytics, SOS.

#### B-20: Pino Structured Logging
- Replaced all `console.log/error/warn` with pino `logger.info/error/warn` in rider.ts (22), security.ts (10), rides.ts (6), wallet.ts (4), admin/finance.ts (4), reviews.ts.
- Logger imported from `artifacts/api-server/src/lib/logger.ts`.

#### B-18: TypeScript `any` Type Cleanup
- Replaced `catch (e: any)` → `catch (e: unknown)` across all route files.
- Replaced `(req as any).adminId` → `(req as AdminRequest).adminId` in admin sub-routers.
- Replaced `req.body as any` → `req.body as Record<string, unknown>` in content routes.
- Replaced loose `any[]` → `unknown[]` or typed arrays in finance, system routes.
- Remaining `as any` casts are legitimate Drizzle ORM dynamic query patterns.

#### A-04: ARIA Accessibility
- **`artifacts/admin/src/components/ui/dialog.tsx`**: Added `aria-describedby={undefined}` to suppress Radix warning, `aria-label="Close dialog"` on close button.
- **`artifacts/admin/src/components/ui/sheet.tsx`**: Same ARIA fixes for sheet overlay component.

### Step 2: API & Frontend Sync — Completed Changes

#### C-06: Payment Status Route Alias
- **`artifacts/api-server/src/routes/payments.ts`**: Added `GET /:orderId/status` route alias alongside legacy `GET /order-status/:orderId`. Customer app calls `/payments/{orderId}/status` — now correctly routed. Both paths share `handleOrderPaymentStatus()` handler.

#### S-02: Vehicle Registration Field Alias
- **`artifacts/api-server/src/routes/rider.ts`**: `profileSchema` now accepts `vehicleRegistration` as alias for `vehicleRegNo`. Uses Zod `.transform()` to normalize.

#### S-03: KYC Photo Field Aliases
- **`artifacts/api-server/src/routes/kyc.ts`**: `POST /kyc/submit` now accepts photo fields under multiple names: `frontIdPhoto`/`idFront`/`idPhoto`, `backIdPhoto`/`idBack`, `selfiePhoto`/`selfie`. Resolves mismatch between different clients.

#### S-04: Pharmacy Prescription — Already Working
- Customer app sends `prescriptionPhotoUri` which matches backend expectation. No fix needed.

#### Zod Validation Added
- **`users.ts`**: `profileUpdateSchema` with CNIC preprocess (strips dashes/spaces before validating 13 digits), `deleteAccountSchema`.
- **`wallet.ts`**: `depositSchema`, `sendSchema`, `withdrawSchema` — validates amount, paymentMethod, transactionId, receiverPhone, accountNumber.
- **`payments.ts`**: `paymentInitiateSchema` — validates gateway, amount, orderId.

#### Response Standardization
- Profile update, payment status endpoints now return `{ success: true, ... }` alongside flat fields for backward compatibility.

### Critical Bug Fixes (Step 1) — Completed Changes

#### D-01 & D-02: Foreign Key References + Cascade Deletes
- **All schema files in `lib/db/src/schema/`**: Added `.references(() => usersTable.id, { onDelete: "cascade" })` to all `userId` columns across 25+ tables. Added ride/product/route FK references with appropriate cascade/set-null behavior.
- **`lib/db/migrations/0018_add_foreign_keys.sql`**: SQL migration file for reference (schema was applied via `drizzle-kit push`).
- Created `ajkmart_system` user record to satisfy products FK constraint for system-generated products.

#### B-01: Ride Endpoint Auth Middleware
- **`artifacts/api-server/src/routes/rides.ts`**: Replaced inline JWT parsing on `GET /:id` and `GET /:id/track` with standard `customerAuth` middleware. Removed unused `verifyUserJwt` import.

#### B-02: SOS Admin Auth Guard
- **`artifacts/api-server/src/routes/sos.ts`**: Replaced custom `getAdminFromRequest()` helper with proper `adminAuth` middleware from `admin.ts` on all admin endpoints (`GET /alerts`, `PATCH /acknowledge`, `PATCH /resolve`). Also converted `POST /` SOS trigger to use `customerAuth` middleware.

#### B-03: Login Rate Limiting — Already Implemented
- `handleUnifiedLogin` already uses `checkLockout`/`recordFailedAttempt`/`resetAttempts` from `security.ts`. No changes needed.

#### B-04: Wallet Deposit Rate Limiting
- **`artifacts/api-server/src/routes/wallet.ts`**: Added `checkAvailableRateLimit` (10 requests per 15 minutes, keyed by IP+userId) to `POST /deposit` endpoint.

#### B-05: Ride Wallet Transaction Atomicity — Already Implemented
- Wallet deduction + ride creation already wrapped in `db.transaction()`. Fixed `any` type on `rideRecord` to `typeof ridesTable.$inferSelect`.

#### B-06: P2P Transfer Race Condition Fix
- **`artifacts/api-server/src/routes/wallet.ts`**: Added `SELECT ... FOR UPDATE` on sender row in P2P transfer transaction to prevent concurrent overspend.

#### B-07: BroadcastRide Skip Busy Riders
- **`artifacts/api-server/src/routes/rides.ts`**: Added active-ride check in `broadcastRide()` to skip riders who already have an active ride (accepted/arrived/in_transit status).

### Pull-to-Refresh & UI Polish — Completed Changes

#### PullToRefresh Component (All 3 Web Apps)
- **`artifacts/vendor-app/src/components/PullToRefresh.tsx`**: Shared pull-to-refresh wrapper with touch gesture detection, animated spinner, "last updated" timestamp, and configurable accent color (orange for vendor).
- **`artifacts/rider-app/src/components/PullToRefresh.tsx`**: Same component with green accent for rider app.
- **`artifacts/admin/src/components/PullToRefresh.tsx`**: Same component with blue accent for admin panel.

#### Pull-to-Refresh Integration (All Data Pages)
- **Vendor App:** Dashboard, Orders, Products, Wallet — all wrapped with PullToRefresh. Each page invalidates its relevant React Query keys on pull.
- **Rider App:** History, Earnings, Wallet, Notifications — all wrapped with PullToRefresh.
- **Admin Panel:** Dashboard, Orders, Users, Riders, Vendors — all wrapped with PullToRefresh.

### Phase 4: Ride Booking & Fare Logic — Completed Changes

#### P4-T001 — DB Migration 0016 + rides schema update
- **`lib/db/migrations/0016_ride_phase4.sql`**: Added columns: `trip_otp`, `otp_verified`, `is_parcel`, `receiver_name`, `receiver_phone`, `package_type`, `arrived_at`, `started_at`, `completed_at`, `cancelled_at`.
- **`lib/db/src/schema/rides.ts`**: Schema updated with all new fields.

#### P4-T002 — Routing-provider road distance in fare engine
- **`artifacts/api-server/src/routes/rides.ts`**: `getRoadDistanceKm()` helper added — tries Google Directions → Mapbox Directions → haversine fallback. Used in `/estimate` and `POST /` ride creation. Response includes `distanceSource`.

#### P4-T003 — OTP system + parcel support + event timestamps
- **`artifacts/api-server/src/routes/rides.ts`**: `bookRideSchema` accepts `isParcel`, `receiverName`, `receiverPhone`, `packageType`. Parcel fields stored in DB.
- **`artifacts/api-server/src/routes/rider.ts`**: OTP generated on accept (both accept-bid and rider accept). `POST /rider/rides/:id/verify-otp` endpoint validates OTP, sets `otpVerified=true`. PATCH status records `arrivedAt/startedAt/completedAt/cancelledAt`. `in_transit` gated on `otpVerified`.
- **`artifacts/api-server/src/lib/socketio.ts`**: `emitRideOtp()` emits `ride:otp` event to customer's user room and the ride room.
- **`artifacts/api-server/src/routes/rides.ts`** `formatRide()`: Now includes all new timestamp fields + OTP/parcel fields in every response.

#### P4-T004 — Admin rides page enhanced with audit timestamps
- **`artifacts/admin/src/pages/rides.tsx`**: Detail modal now shows Parcel Info section (receiver, phone, package type), OTP Status badge (Verified/Pending with code), and full Event Timeline grid (Requested/Accepted/Arrived/Started/Completed/Cancelled + Last updated).
- **`artifacts/api-server/src/routes/admin.ts`**: `GET /admin/rides/:id` now returns all new fields: `arrivedAt`, `startedAt`, `completedAt`, `cancelledAt`, `tripOtp`, `otpVerified`, `isParcel`, `receiverName`, `receiverPhone`, `packageType`.

#### P4-T005 — Admin Fleet Map active-trip focus mode
- **`artifacts/admin/src/pages/live-riders-map.tsx`**: `makeRiderIcon` now accepts `hasActiveTrip` parameter. When a rider has a `currentTripId`, two concentric pulsing red rings animate around their marker. Icon cache key updated to include trip state.

#### P4-T006 — Rider App OTP entry step + parcel badge
- **`artifacts/rider-app/src/pages/Active.tsx`**: At `arrived` status with `!otpVerified` → shows blue "Verify OTP to Start" button. OTP modal with 4-digit input calls `POST /rider/rides/:id/verify-otp`. After verification, shows normal "Start Ride" button. `verifyOtpMut` mutation added.
- **`artifacts/rider-app/src/pages/Home.tsx`**: Parcel rides show `📦 Parcel` amber badge on request cards.
- **`artifacts/rider-app/src/lib/api.ts`**: `verifyRideOtp(id, otp)` method added.

#### P4-T007 — Customer Booking Web Portal (DELETED)
- **Removed**: `artifacts/customer` web portal was deleted at user's request.

### Step 1: Design System & Shared Components + Backend Foundation — Completed Changes

#### Frontend Design Tokens
- **`artifacts/ajkmart/constants/colors.ts`**: Added `gradients` export (primary, mart, food, ride, wallet, pharmacy, parcel, success, danger, dark), `serviceColors` lookup (main/light/dark per service), `xxxxl: 48` to spacing, service dark tint variants (martDark, foodDark, rideDark, walletDark, pharmacyDark, parcelDark).

#### New/Upgraded UI Components
- **`artifacts/ajkmart/components/ui/Avatar.tsx`**: New — initials fallback with deterministic color hash, supports xs/sm/md/lg/xl sizes, image URI or name-based rendering.
- **`artifacts/ajkmart/components/ui/Divider.tsx`**: New — horizontal divider with optional centered label, configurable color and spacing.
- **`artifacts/ajkmart/components/ui/Tag.tsx`**: New — pill tag with variant colors (success/warning/danger/info/neutral/primary), optional icon, removable with onRemove callback, outlined mode.
- **`artifacts/ajkmart/components/ui/ErrorState.tsx`**: New — error display with icon/emoji, title, subtitle, retry button.
- **`artifacts/ajkmart/components/ui/Modal.tsx`**: New — centered modal overlay with title, subtitle, close button, content slot.
- **`artifacts/ajkmart/components/ui/ScreenContainer.tsx`**: New — layout primitive wrapping SafeAreaView + scroll + keyboard avoidance. Configurable edges, scroll/static, background color.
- **`artifacts/ajkmart/components/ui/Input.tsx`**: Upgraded — added `success` state, `showCharCount`/`maxLength` char counter, `clearable` with clear button, `rightElement` slot, `onClear` callback.
- **`artifacts/ajkmart/components/ui/index.ts`**: Updated barrel export with all new components (Avatar, Divider, ErrorState, Modal, ScreenContainer, SkeletonBlock, SmartRefresh, Tag).

#### Backend API Response Standardization
- **`artifacts/api-server/src/lib/response.ts`**: New — shared response helpers: `sendSuccess`, `sendCreated`, `sendError`, `sendErrorWithData`, `sendValidationError`, `sendUnauthorized`, `sendForbidden`, `sendNotFound`, `sendTooManyRequests`, `sendInternalError`. All enforce `{ success, data?, error?, message? }` format with bilingual defaults (EN error + UR message via DEFAULT_UR lookup).
- **`artifacts/api-server/src/app.ts`**: Global error handler upgraded — maps error codes to bilingual messages (EN/UR), structured Pino logging with IP/code/method/url, standardized `{ success, error, message, code }` format.
- **`artifacts/api-server/src/routes/health.ts`**: Upgraded — returns DB status with latency, uptime seconds, timestamp, service health object. Uses `sendSuccess` helper. Returns 503 with full `data` payload on degraded status.
- **`artifacts/api-server/src/middleware/security.ts`**: All middleware responses (customerAuth, riderAuth, requireRole, rateLimitMiddleware, verifyCaptcha, idorGuard) standardized to `{ success: false, error, message }` format with bilingual EN/UR messages.
- **`artifacts/api-server/src/middleware/validate.ts`**: New — Zod validation middleware factory: `validate({ body?, query?, params? })`, `validateBody`, `validateQuery`, `validateParams`. Returns structured `{ success: false, error, message, code: "VALIDATION" }` with bilingual error messages and Pino logging.
- **Response helpers imported in 37/39 route files** (excluding `auth.ts` per user instruction and `admin.ts` barrel-only file). Fully converted routes: categories, wishlist, notifications, products, banners, addresses, reviews, users, health, push, uploads, sos, settings, platform-config. Remaining routes have imports ready for incremental body conversion.

### User Preferences
- I want iterative development.
- Ask before making major changes.
- Do not make changes to folder `artifacts/ajkmart`.
- Do not make changes to file `artifacts/api-server/src/routes/auth.ts`.
- Prefer clear and concise explanations.

### Phase 3: Live Tracking & Map Integration — Completed Changes

#### T001 — Socket.io: vehicleType + currentTripId in location broadcast
- **`artifacts/api-server/src/lib/socketio.ts`**: `emitRiderLocation` signature extended with optional `vehicleType?` and `currentTripId?` fields.
- **`artifacts/api-server/src/routes/locations.ts`**: `broadcastRiderLocation` now fetches `vehicleType` from the `users` table and includes it in the socket emission. `currentTripId` is broadcast when set.

#### T002 — Secure Map Config API endpoint
- **`artifacts/api-server/src/routes/maps.ts`**: `GET /api/maps/config` endpoint added. Returns `{ provider, token, searchProvider, searchToken, routingProvider, enabled, defaultLat, defaultLng }` from `platform_settings` (DB-managed). API keys are served per-request so they never appear in frontend build artifacts. The active provider's token is returned — never all keys at once.

#### T003 — Admin Maps & API Settings tab (fully rebuilt)
- **`artifacts/admin/src/pages/settings-integrations.tsx`**: Maps tab completely rewritten with:
  - **Active Map Provider** selector (OSM / Mapbox GL JS / Google Maps) with visual card-picker UI
  - **Mapbox token input** shown conditionally when Mapbox is selected
  - **Google API key input** shown conditionally when Google is selected
  - **Search/Autocomplete API** selector (Google Places / LocationIQ) with provider-specific key fields
  - **LocationIQ API key input** shown conditionally when LocationIQ is selected
  - **Routing Engine** selector (Mapbox Directions / Google Directions)
  - All existing Maps Usage toggles and Fare Calculation fields retained

#### T004 — UniversalMap component (lazy Mapbox loading)
- **`artifacts/admin/src/components/UniversalMap.tsx`**: Created. Provides a provider-agnostic map component:
  - **Leaflet implementation**: Uses react-leaflet MapContainer with OSM/Mapbox raster/Google tile URL switching. Supports normalised `MapMarkerData[]` and `MapPolylineData[]` props. Renders username labels above markers and 50%-opacity dimmed state.
  - **Mapbox GL JS implementation**: Lazily loaded via `React.lazy + import("react-map-gl")` — only downloaded when Mapbox provider is active, keeping the initial bundle lean. Uses GeoJSON Source/Layer for polylines and `<Marker>` for custom HTML markers.
  - **`artifacts/admin/src/global.d.ts`**: Ambient module declarations for `react-map-gl` and `mapbox-gl` to satisfy `tsc --noEmit` in the pnpm virtual-store layout.

#### T005 — Admin Fleet Map enhancements
- **`artifacts/admin/src/pages/live-riders-map.tsx`**:
  - **Dynamic tile layer**: Reads provider + token from `/api/maps/config` at runtime. Supports Mapbox raster, Google Maps, and OSM tile URLs — no hardcoded provider in source.
  - **Username labels**: `makeRiderIcon` now accepts an optional `label` string rendered as a floating dark pill above each marker. Toggleable via "Labels" button in the map toolbar.
  - **Dimmed offline markers**: Riders offline but active in the last 24 h render at 50% opacity via `wasRecentlyActive()` helper — visually distinct from never-seen riders.
  - **vehicleType + currentTripId from socket**: `rider:location` handler extracts both fields into `vehicleTypeOverrides` and `currentTripIdOverrides` state; applied when merging riders. Popup shows active trip ID when set.
  - **History Playback floating panel**: A frosted-glass overlay appears on the map when any rider is selected. Contains date picker, GPS point count, and a range slider for scrubbing through the route. Uses the existing `useRiderRoute` hook and `Polyline` render — no new endpoints needed.
  - **Icon cache updated**: Cache key now includes `dimmed`, `label`, and status to prevent stale icon reuse.

#### T006 — Rider App GPS interval: 4 min → 5 seconds
- **`artifacts/rider-app/src/pages/Home.tsx`**: `IDLE_INTERVAL_MS` changed from `4 * 60 * 1000` (4 minutes) to `5 * 1000` (5 seconds). Riders now emit their GPS position every 5 s even when stationary, giving the Admin fleet map near-real-time updates. The `MIN_DISTANCE_METERS = 25` filter is still active to suppress duplicate sends when the rider hasn't moved.

### Phase 2 Cleanup — Completed Changes

#### 1. Security Fixes (Critical)
- **`artifacts/api-server/src/services/password.ts`**: Removed hardcoded JWT secret fallback (`"ajkmart-secret-2024"`) and TOTP encryption key fallback (`"ajkmart-totp-default-key-2024"`). Both now call `resolveRequiredSecret()` which throws an explicit error at call time if the env vars are missing — no more silent weak-key fallbacks.
- **`artifacts/api-server/src/routes/auth.ts`**: Dev OTP is now gated by BOTH `NODE_ENV === "development"` AND `ALLOW_DEV_OTP === "true"` env var. A single misconfigured `NODE_ENV` can no longer leak OTP codes into production API responses.

#### 2. Code Consolidation — requireRole Factory
- **`artifacts/api-server/src/middleware/security.ts`**: Added `requireRole(role, opts?)` factory function. Replaces the four separate `customerAuth`, `riderAuth`, `vendorAuth` (local copy in vendor.ts), and `adminAuth` middlewares with a single, DRY, configurable pattern. Supports `opts.vendorApprovalCheck` for vendor-specific pending/rejected status messages. Sets `req.customerId`, `req.customerUser`, `req.riderId`/`riderUser`, and `req.vendorId`/`vendorUser` as appropriate.
- **`artifacts/api-server/src/routes/vendor.ts`**: Removed the 50-line duplicate local `vendorAuth` function. Now uses `router.use(requireRole("vendor", { vendorApprovalCheck: true }))` — one line.

#### 3. Ghost Rider Fix — Heartbeat Expiry
- **`artifacts/api-server/src/lib/socketio.ts`**: Enhanced the stale-location cleanup interval. It now:
  1. Queries for all riders whose `live_locations.updatedAt` is older than 5 minutes (before deleting).
  2. Emits `rider:offline` event to `admin-fleet` for each stale rider with `{ userId, isOnline: false, reason: "heartbeat_timeout" }`.
  3. Updates `users.is_online = false` in the database for all affected riders (prevents ghost-online status in DB).
  4. Deletes the stale `live_locations` rows to remove ghost markers from the Admin fleet map.

#### 4. New Profile Tables (Schema Refactor — Phase 2)
- **`lib/db/src/schema/rider_profiles.ts`**: New table `rider_profiles` — stores all rider-specific fields: `vehicleType`, `vehiclePlate`, `vehicleRegNo`, `drivingLicense`, `vehiclePhoto`, `documents`. Linked to `users` by `userId`.
- **`lib/db/src/schema/vendor_profiles.ts`**: New table `vendor_profiles` — stores all vendor/store-specific fields: `storeName`, `storeCategory`, `storeBanner`, `storeDescription`, `storeHours`, `storeAnnouncement`, `storeMinOrder`, `storeDeliveryTime`, `storeIsOpen`, `storeAddress`, `businessType`, `businessName`, `ntn`. Linked to `users` by `userId`.
- **`lib/db/src/schema/users.ts`**: Vendor and rider fields marked as `DEPRECATED` with clear comments. They are retained for backward compatibility. Phase 3 will remove them after all queries are updated to JOIN the new profile tables.
- **`lib/db/migrations/0011_rider_vendor_profiles.sql`**: Creates both tables and populates them from existing `users` data.

#### 5. Static Data — AJK Cities in Database
- **`lib/db/migrations/0012_seed_ajk_locations.sql`**: Seeds all 15 AJK fallback cities (Muzaffarabad, Mirpur, Rawalakot, etc.) into the `popular_locations` table. They can now be managed, edited, or extended from the Admin Panel. The hardcoded array in `maps.ts` remains as a last-resort safety net if the DB is unavailable.

#### Important Environment Variables Added
- `ALLOW_DEV_OTP=true` — must be explicitly set alongside `NODE_ENV=development` for dev OTP mode to expose codes in API responses. Default: not set (production-safe).

### System Architecture

**Monorepo and Core Technologies:**
The project is structured as a pnpm monorepo using TypeScript. The frontend leverages Expo React Native with NativeWind for mobile applications, while the backend is an Express 5 REST API utilizing PostgreSQL and Drizzle ORM. Authentication is primarily phone number and OTP-based. API interactions are defined using OpenAPI 3.1, with Orval codegen generating React Query hooks and Zod schemas for validation. State management uses `AuthContext` and `CartContext` with AsyncStorage for persistence, and navigation is handled by `expo-router`.

**UI/UX and Theming:**
- **Color Scheme:** Primary blue (`#1A56DB`), accent amber (`#F59E0B`), and success green (`#10B981`).
- **Font:** Inter (400, 500, 600, 700). Noto Nastaliq Urdu (400, 500, 600, 700) for Urdu RTL text.
- **i18n:** Multi-language support via `@workspace/i18n` shared library. Supports 5 language modes: English, Urdu, Roman Urdu, English+Roman Urdu (dual), English+Urdu (dual). Uses `tDual()` for dual-line translations and `t()` for single-line. RTL support via `isRTL()`. All user-facing strings across all 3 client apps use translation keys. Nastaliq font loaded via Google Fonts CDN (web) and `@expo-google-fonts/noto-nastaliq-urdu` (mobile).
- **Application Structure:**
    - **Customer App (Expo React Native):** Features include grocery, food delivery, ride booking, pharmacy, parcel delivery, cart, checkout, order history, digital wallet, and user profile. Full auth system with 7 login methods (Phone OTP, Email OTP, Username/Password, Google, Facebook, Magic Link, Biometric) gated by admin platform config toggles. Includes AliExpress-style 5-step registration (Phone Verify → Personal Details → Address/GPS/City → Security/CNIC → Success with Account Level Badge), forgot/reset password with 2FA, 2FA setup/disable in profile, deep link handling for magic links. Auth screens: `app/auth/index.tsx` (login), `app/auth/register.tsx` (register), `app/auth/forgot-password.tsx` (reset). Auth context (`context/AuthContext.tsx`) manages 2FA pending state, biometric credentials via expo-secure-store, and proactive token refresh. Packages: expo-local-authentication, expo-secure-store, expo-auth-session.
    - **Admin Dashboard (React-Vite):** Provides comprehensive management for users, vendors, riders, services, system configurations (delivery fees, feature toggles, loyalty programs, payout rules), and content. It includes professional renderers for settings management with live previews and validation.
    - **Rider App (React-Vite):** Mobile-first web app for drivers using the **Dark Hero Design System** across ALL pages — auth (Login, Register, ForgotPassword), main (Home, Active, Notifications, Profile, Wallet, Earnings, History), settings (SecuritySettings), utility (NotFound, MaintenanceScreen). Design tokens: `bg-[#F5F6F8]` page bg, dark gradient hero `from-gray-900 via-gray-900 to-gray-800` with `rounded-b-[2rem]`, frosted glass stat chips `bg-white/[0.06] backdrop-blur-sm`, `rounded-3xl` content cards, pill filter tabs `rounded-full bg-gray-900` active, `bg-gray-900` primary buttons, decorative circles (`bg-green-500/[0.04]`, `bg-white/[0.02]`). Auth pages use full-screen dark gradient with centered white card. BottomNav uses `bg-gray-900/10` active pill + `bg-gray-900` indicator bar. AnnouncementBar uses `bg-gray-900`. **Full multilingual support** — `useLanguage.ts` fetches user language from `/api/settings` on startup, saves language back to server on change, supports all 5 languages. Profile page shows a 5-language picker. Professionally redesigned Home, Active, Profile, Notifications, Wallet, Earnings, and History pages. Home: skeleton loading, time-based greeting, wallet card, premium toggle, gradient stats, request cards with gradient icons, typed toasts, press animations, ID-based new-request detection. Active: enhanced elapsed timer with progress bar, order-type-specific gradient headers (food=orange/red, mart=blue/indigo, parcel=teal/cyan), ride cards with violet/purple gradient, premium step progress with ring indicators and animated progress bars, gradient nav/call buttons, enhanced proof-of-delivery with overlay, glassmorphism cancel modal, gradient action buttons with press animations. Notifications: premium header with animated ping unread indicator, glassmorphism stat cards with staggered animations, enhanced filter tabs with gradient active state, individual notification cards with gradient icon backgrounds and unread dot indicators, enhanced empty state with View All CTA, "mark all read" success toast. All pages share: robust toast system with timer ref cleanup, gradient button design language, decorative background circles. Also includes: circular profile completion indicator, stats grid, date-grouped transactions and notifications, individual notification mark-as-read (PATCH /rider/notifications/:id/read), 7-day earnings chart, COD remittance tracking, pending withdrawal request cards with status badges, achievements system, and error-handled mutations. Full auth system with Login (Phone OTP, Email OTP, Username/Password, Google, Facebook, Magic Link, Biometric) and 4-step Registration (Personal Info with optional username → Vehicle & Documents → Security Setup → Verification). "Back to Login" link visible on all registration steps. Email OTP fallback on phone OTP step (if SMS fails). 2FA setup/disable in Profile security section (QR via backend data URL, manual key, backup codes). Uses Wouter routing, TanStack Query, Tailwind CSS, and Lucide icons. Features include online/offline toggles, active deliveries/rides, history, earnings, and wallet. **Rider App Modules** are admin-controlled via platform settings (`rider_module_wallet`, `rider_module_earnings`, `rider_module_history`, `rider_module_2fa_required`, `rider_module_gps_tracking`, `rider_module_profile_edit`, `rider_module_support_chat`); disabled modules hide routes and nav items. `getRiderModules()` helper in `useConfig.ts` provides typed access. It enforces max deliveries and manages withdrawal requests based on platform settings.
    - **Vendor App (React-Vite):** Mobile-first web app for store owners with an orange theme. Features include dashboard, order management, product CRUD (including bulk adds), wallet, analytics, store configuration (banner, hours, announcements, promos), and notifications. It enforces max product limits and manages withdrawals. Auth: login supports OTP bypass (auto-login when `otpRequired: false`), registration has required username with real-time `/auth/check-available` uniqueness check (auto-suggested from name), username persisted server-side via `/auth/vendor-register`.

**Key Features and Implementations:**
- **Authentication:** JWT-based authentication across all user roles (customer, rider, vendor). **Unified Identity System (Binance-style):** Phone, email, and username all link to one account with no duplicates. Unified `/auth/login` endpoint accepts `{ identifier, password }` where identifier is auto-detected as phone (0/3/+92 prefix), email (@), or username. Lockout keyed by user ID (prevents rotation bypass). Admin can edit identity fields via `PATCH /admin/users/:id/identity` with case-insensitive uniqueness checks. All 3 client login forms (customer, vendor, rider) accept phone/email/username in the identifier field. Supports multiple login methods including Phone OTP, Email OTP, Username/Password, Email Registration (with verification email via nodemailer/SMTP), Google Social Login, Facebook Social Login, and Passwordless Magic Links. Includes role-specific registration (customer/rider/vendor) with CNIC validation, password strength rules, reCAPTCHA v3 middleware (fail-closed), OTP-based password reset with email delivery, TOTP-based 2FA (RFC 6238) with backup codes, trusted device fingerprinting (30-day expiry), and admin force-disable 2FA. TOTP secrets encrypted at rest via AES-256-GCM. Magic link tokens are hashed and single-use with 15-min expiry. Per-role auth toggle enforcement via platform_settings (JSON format: `{"customer":"on","rider":"on","vendor":"on"}`). All auth toggle checks use `isAuthMethodEnabled()` for consistent parsing. User approval workflows for riders and vendors managed via the admin panel.
  - **Unified Multi-Role Auth Flow:** `POST /auth/check-identifier` discovers account and returns `action` (send_phone_otp, send_email_otp, login_password, force_google, force_facebook, register, no_method), `otpChannels`, `canMerge`, `deviceFlagged`, `hasGoogle`, `hasFacebook`. All 3 client apps use a single "Continue" entry point that calls check-identifier first.
  - **Dynamic OTP Routing:** `POST /auth/send-otp` tries WhatsApp → SMS → Email failover (role-aware channel selection via `isAuthMethodEnabled()`). Returns `{ channel, fallbackChannels }` — canonical values only (`sms`/`whatsapp`/`email`). Client passes optional `preferredChannel` to override priority. In production, returns 502 if all channels fail. All 3 client apps display delivery channel indicator and fallback buttons.
  - **Dev OTP Mode:** Admin-controlled per-user `devOtpEnabled` flag. When enabled via SecurityModal, `/auth/send-otp` returns `{ otp, devMode: true }` in response body (skips SMS if delivery fails). Customer app shows OTP via `DevOtpBanner` on all auth screens (login, register, forgot-password). Toggle persisted in `users.dev_otp_enabled` column.
  - **Force Social Login:** `force_google`/`force_facebook` actions hard-block login regardless of local feature toggles, showing clear error message if social provider isn't available in the app.
  - **Account Merge/Link:** `POST /auth/send-merge-otp` sends OTP to a new phone/email for linking (requires JWT auth), storing `pendingMergeIdentifier` to cryptographically bind the OTP to the target. `POST /auth/merge-account` verifies OTP AND identifier match before linking. Prevents linking identifiers already used by other accounts. `check-identifier` returns `canMerge: true` when the identifier is new and could be linked.
  - **Shared Auth Components:** `components/auth-shared.tsx` provides reusable components (`OtpDigitInput`, `AuthButton`, `PasswordStrengthBar`, `AlertBox`, `PhoneInput`, `InputField`, `StepProgress`, `ChannelBadge`, `FallbackChannelButtons`, `DevOtpBanner`, `Divider`, `SocialButton`) used across all 3 auth pages to eliminate duplication.
  - **Shared User-Area Components:** `components/user-shared.tsx` provides `AnimatedPressable`, `SectionHeader`, `SkeletonBlock`, `SkeletonRows`, `FilterChip`, `StatCard`, `ListItem`, `GradientCard`, `EmptyState`, `StatusBadge`, `Divider`, `CardSurface`, `SearchHeader`, `CategoryPill`, `CountdownTimer`, `SkeletonLoader` used across Home/Orders pages.
  - **Accessibility (Binance-quality redesign):** All 4 user-area pages (Home, Orders, Wallet, Profile) have comprehensive `accessibilityRole`, `accessibilityLabel`, and `accessibilityState` on every interactive Pressable — including main page elements, modal buttons (deposit/withdraw/send/QR/edit profile/notifications/privacy/2FA/addresses), filter chips, quick amount selectors, city/language pickers, action cards, error retry banners, sign-out confirmation, and address CRUD actions.
- **Rider Profile Image Upload:** Riders can upload profile photos from Profile page via camera icon overlay on avatar. Photos uploaded as base64, stored via `/api/uploads/`, URL saved to `avatar` column via `PATCH /rider/profile`. Server validates avatar URLs must start with `/api/uploads/`. Avatar displayed in profile card and included in `/rider/me` response for customer-facing ride data.
- **Rating & Review System (Full):** Complete review pipeline across all 4 apps. DB schema: `reviewsTable` and `rideRatingsTable` both have soft-delete columns (`hidden`, `deletedAt`, `deletedBy`). Security: IDOR fix (userId filter on GET /reviews), self-rating guard on ride ratings (customerId !== riderId). Endpoints: `GET /reviews/my` (customer's own order + ride reviews merged), `GET /vendor/reviews` (auth'd, paginated, star breakdown, masked names), `GET /rider/reviews` (returns avg + total + list), admin endpoints `GET/PATCH/DELETE /admin/reviews/:id`, `GET/PATCH/DELETE /admin/ride-ratings/:id` (hide + soft-delete). UI: Vendor app has dedicated Reviews page (`/reviews`) with sidebar link, star breakdown chart, filters; Admin has Review Management page (`/reviews`) with type/stars/status filters, hide/show toggle, soft-delete action; Rider Profile.tsx shows reviews section with empty state polish; Customer Expo app has My Reviews screen (`/my-reviews`) reachable from profile. i18n: new keys `reviews`, `customerFeedback`, `noReviews`, `myReviews`, `reviewManagement`, `allReviews`, `hideReview`, `unhideReview`, `deleteReview`, `reviewHidden`, `reviewDeleted`, `rideReviews`, `orderReviews`, `reviewType`, `reviewStatus`, `navReviews`, `navReviewsMgmt` added in English, Urdu, and Roman Urdu.
- **Advanced Review & Rating System (Task #2):**
  - **AI Moderation:** Review submissions go through OpenAI (Replit-proxied `gpt-5-mini`) content moderation. Flagged reviews are saved with `status = "pending_moderation"` and hidden from public. Reviews with no AI credentials fall through as `status = "visible"`.
  - **Vendor Replies:** Vendors can POST/PUT/DELETE replies on their reviews via `/reviews/:id/vendor-reply` (vendor auth required). Reply + timestamp stored in `vendorReply`/`vendorRepliedAt` columns.
  - **Admin Moderation Queue:** `GET /admin/reviews/moderation-queue` returns all pending reviews. `PATCH /admin/reviews/:id/approve` and `reject` manage moderation decisions.
  - **Bulk CSV Export/Import:** `GET /admin/reviews/export` streams a CSV with auth header. `POST /admin/reviews/import` accepts CSV text, imports with de-duplication.
  - **Auto-Suspension Job:** `POST /admin/jobs/rating-suspension` checks riders/vendors with <2.5 avg rating in last 30 days (min 10 reviews), suspends them, sends in-app notification. Respects `adminOverrideSuspension` flag. Override endpoints for riders and vendors. Thresholds configurable in platform settings.
  - **Schema changes:** `reviewsTable` gained `status`, `moderationNote`, `vendorReply`, `vendorRepliedAt` (plus `hidden`, `deletedAt`, `deletedBy` from Task #1). `usersTable` gained `autoSuspendedAt`, `autoSuspendReason`, `adminOverrideSuspension`.
  - **Admin Panel:** `/reviews` page enhanced with moderation queue modal, bulk export/import, run-auto-suspend button. Riders/Vendors pages show "Override Suspend" button for auto-suspended accounts.
  - **Vendor App:** `/reviews` page enhanced with reply form (post/edit/delete), review status badges. `postVendorReply/updateVendorReply/deleteVendorReply` APIs added.
- **Rider KYC Document Upload System:** All 4 documents mandatory during registration: Vehicle Photo, CNIC Front, CNIC Back, and Driving License Photo. Documents stored as structured JSON in `documents` column: `{files: [{type, url, label}...], note?: string}`. Vehicle photo also stored in separate `vehiclePhoto` column. Riders can attach optional notes during registration. Admin KYC review modal (`KycDocModal` in `users.tsx`) parses both `vehiclePhoto` and `documents` JSON with URL-based deduplication, backward compatible with legacy array format `[{type, url}]`. Admin pending approval list shows doc count badge (green=4+, amber=partial, red=none) and note indicator. Admin verification checklist with interactive checkboxes and "all checks passed" indicator. Correction request supports actual document types (cnic_front, cnic_back, driving_license, vehicle_photo, all).
- **Dynamic Platform Settings:** Almost all operational parameters (delivery fees, commission rates, minimum order values, withdrawal limits, feature toggles, loyalty points, cashback, etc.) are centrally managed via the Admin Dashboard and dynamically enforced across the API and client applications.
- **Order and Delivery Management:** Comprehensive order processing, including fare calculation (dynamic based on service type and distance), delivery fee application (mart, food, pharmacy, parcel), GST calculation, and cashback/loyalty point integration. Supports scheduled orders and cancellation windows.
- **Digital Wallet:** Functionality for top-ups, transfers (P2P), withdrawals for riders and vendors, and tracking of transactions (e.g., earnings, bonuses, loyalty points, cashback). Wallet limits and withdrawal availability are dynamically configured.
- **Ride Bargaining (Mol-Tol System):** An advanced bidding system for rides where customers can offer a fare, and multiple riders can submit bids. Customers can accept bids live, leading to dynamic fare negotiation.
- **Product Management:** Vendors can manage products, including bulk additions with image and description support, inventory tracking, and category assignments.
- **Notifications:** In-app notification systems for various events across all applications.
- **Location Services:** Integration with mapping services for autocomplete, geocoding, distance matrix calculations, and real-time location tracking for rides/deliveries.
- **Security:** Implementation of signed JWTs for authentication, input validation using Zod schemas, and role-based access control for API endpoints. Admin endpoints use a separate `ADMIN_JWT_SECRET` (required env var, minimum 32 chars enforced at startup, server will not start without it). `JWT_SECRET` also enforced to ≥32 chars. Server-side price verification on order placement. Deposit TxID duplicate protection with normalized case-insensitive matching. OTP bypass is only allowed when `NODE_ENV` is explicitly `"development"` or `"test"` (never when unset). TOTP secrets encrypted at rest using AES-256-GCM. `GET /rides/:id/event-logs` uses timing-safe secret comparison. Route shadowing fixed: `/admin/system` router is mounted before `/admin` router. Platform settings PUT/PATCH endpoints validate numeric and boolean keys before persisting. Email delivery via nodemailer. **Critical Bug Fixes (Task #4):** Admin cannot cancel/refund delivered/completed orders (free-goods exploit closed). Rider order status transitions enforced via `ORDER_RIDER_TRANSITIONS` state machine (prevents skipping states like confirmed→delivered). Ride/order delivery financial operations (rider earnings, platform fees) are now atomic — status update and wallet operations in ONE database transaction (prevents "completed but unpaid" state). All wallet deductions in rides.ts use atomic SQL (`wallet_balance - X` with `gte` floor guard) instead of JavaScript math (eliminates double-spending race conditions). Cancel-fee deduction verifies row-update success before inserting ledger entry.

- **Payment Provider Abstraction:** Centralized payment SDK in `api-server/src/lib/payment-providers.ts` with `getProviderConfig()`, `validatePaymentAmount()`, hash builders for JazzCash/EasyPaisa, and `SUPPORTED_GATEWAYS` type. Payments route refactored to use abstraction layer.
- **Rider Order Rejection:** Riders can reject delivery orders via `POST /rider/orders/:id/reject` with reason. Rider app Home has Reject button alongside Accept/Ignore on order request cards.
- **Order Ready Notifications:** When vendor marks order "ready", socket broadcasts `order:update` to admin/vendor/rider rooms and notifies all online riders of available pickups via `rider:new-request`.
- **AI/ML Recommendations:** API endpoints at `/api/recommendations/trending`, `/for-you`, `/similar/:productId`, `/frequently-bought`. Interaction tracking via `POST /recommendations/track`. Customer app home screen shows "Trending Now" horizontal product carousel. Product detail auto-tracks views.
- **Dynamic Banner Management:** Admin CRUD at `/api/banners` with placement (home/mart/food), gradient colors, date ranges, sort order. Customer app home screen renders dynamic banners from API with auto-scroll carousel.
- **Product Variant System:** DB schema `product_variants` (label, sku, price, stock, attributes JSONB). API endpoints at `/api/variants/product/:productId`. Product detail page shows variant selector chips with price/stock info. Search page enhanced with sort options (price, rating, newest) and price/rating filter bar.

**Database Schema Highlights:**
- `usersTable`: Stores user details, including auth-related fields (nationalId, googleId, facebookId, totpSecret, totpEnabled, backupCodes, trustedDevices, biometricEnabled), rider fields (vehicleRegNo, drivingLicense), vendor fields (businessName, storeAddress, ntn), approval status, and roles.
- `magicLinkTokensTable`: Stores magic link tokens for passwordless login (id, userId, tokenHash unique, expiresAt, usedAt, createdAt).
- `productsTable`, `ordersTable`: Core commerce data.
- `walletTransactionsTable`: Records all financial movements within the digital wallet.
- `ridesTable`, `rideBidsTable`, `liveLocationsTable`: For ride-hailing and tracking. Rides table includes dispatch fields: `dispatched_rider_id`, `dispatch_attempts` (JSON), `dispatch_loop_count`, `dispatched_at`, `expires_at`.
- `rideRatingsTable`: Post-ride customer ratings (1-5 stars + comment). Unique index on ride_id prevents duplicates.
- `riderPenaltiesTable`: Tracks rider ignore/cancel penalties with daily limits and wallet deductions.
- `popularLocationsTable`: Admin-managed points of interest for quick selection.
- `schoolRoutesTable`, `schoolSubscriptionsTable`: For managing school transport services.
- `productVariantsTable`: Product variants with label, SKU, price, stock, attributes (JSONB), and inStock flag.
- `bannersTable`: Dynamic promotional banners with placement, service targeting, gradient colors, date ranges, and sort order.
- `userInteractionsTable`: Tracks user product interactions (view/cart/purchase/wishlist) for recommendation engine.

### Shared Auth Utilities (`@workspace/auth-utils`)
- **Location:** `lib/auth-utils/`
- **CAPTCHA:** `executeCaptcha(action, siteKey?)` for web (reCAPTCHA v3 invisible); `CaptchaModal` WebView component for Expo mobile (import from `@workspace/auth-utils/captcha/native`)
- **OAuth:** `useGoogleLogin()` and `useFacebookLogin()` hooks for web; `useGoogleLoginNative()` and `useFacebookLoginNative()` hooks for Expo (import from `@workspace/auth-utils/oauth/native`)
- **2FA Components:** `TwoFactorSetup` (QR code, manual key copy, 6-digit TOTP input with auto-submit, backup codes with download/copy); `TwoFactorVerify` (TOTP input, backup code toggle, trust device checkbox)
- **Magic Link:** `MagicLinkSender` component with email input, rate-limit-aware countdown, and status feedback
- **Environment secrets needed:** `RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`

### External Dependencies

- **PostgreSQL:** Primary database.
- **Drizzle ORM:** Object-Relational Mapper for database interactions.
- **Express 5:** Backend web framework.
- **Expo React Native:** Frontend framework for customer mobile app.
- **React-Vite:** Frontend framework for Admin, Rider, and Vendor web apps.
- **NativeWind:** Utility-first CSS framework for React Native.
- **OpenAPI 3.1:** API specification.
- **Orval codegen:** Generates API client and hooks.
- **React Query:** Data fetching and caching for frontend.
- **Zod:** Schema validation library.
- **AsyncStorage:** For client-side data persistence in React Native (non-sensitive: user profile cache, biometric preference, language).
- **expo-secure-store:** Encrypted storage for auth tokens (access token, refresh token, biometric token). Fallback to AsyncStorage on unsupported platforms.
- **jsonwebtoken:** For JWT generation and verification.
- **crypto.scryptSync:** For password hashing.
- **react-native-qrcode-svg:** For generating real QR codes in the wallet Receive Money modal.

### Order-to-Delivery Stabilization (Task #1 Rider-Admin Sync + Order Reliability)

**Server-Side (API Server):**
- `orders.ts`: Socket.io broadcast on order creation (`order:new`) and update (`order:update`) to admin-fleet and vendor rooms. Wallet balance broadcast (`wallet:update`) after wallet payment deduction. **Critical bugfix**: Cancel handler now atomically refunds wallet inside a DB transaction (was calculating refund amount but never crediting it). Retry-safe 4xx vs 5xx distinction.
- `wallet.ts`: Added `broadcastWalletUpdate()` after admin topup, auto-approved deposits, and P2P transfers. Both sender and receiver get real-time balance updates via Socket.io.
- `rides.ts`: Added `broadcastWalletUpdate()` after ride cancellation refund/fee deduction.
- `socketio.ts`: Added `rider:heartbeat` server handler — validates rider JWT, rebroadcasts batteryLevel to admin-fleet. Added `emitRiderStatus()` for instant online/offline status changes.

**Rider App (`Home.tsx`):**
- Socket.io heartbeat: 30-second interval emitting `rider:heartbeat` with battery level. Auto-joins personal `rider:{userId}` room for admin chat and push notifications.
- Battery API integration: reads `navigator.getBattery()` level, includes in GPS location updates and heartbeat payloads.
- GPS location updates now include `batteryLevel` field.

**Admin Map (`live-riders-map.tsx`):**
- Real-time `rider:status` listener: updates isOnline without page refresh when riders toggle online/offline.
- `rider:heartbeat` and `rider:location` listeners: update battery level in real-time.
- `order:new` / `order:update` listeners: invalidate order queries for instant admin notification.
- Sidebar: search input (by name/phone/vehicle), status filter buttons (All/Online/Busy/Offline), battery level display with color coding (red ≤20%, amber ≤50%, green >50%).
- Selected rider detail panel: battery level display.

**Vendor App (`Orders.tsx`):**
- `order:new` and `order:update` Socket.io listeners: invalidate vendor order queries for instant notification without polling.

**Customer App (`AuthContext.tsx`):**
- Socket.io connection: connects when logged in, auto-joins personal room via JWT auth.
- `wallet:update` listener: instantly updates user wallet balance in AuthContext and persists to AsyncStorage. No page refresh needed.

**Customer App (`cart/index.tsx`):**
- Exponential backoff retry: `placeOrder` retries up to 3 times with 1s/2s/4s delays on 5xx errors. 4xx errors (validation) fail immediately without retry. Cart only clears after confirmed 200 OK response.

**Offline GPS Queue (Rider App `api.ts`):**
- IndexedDB-based offline GPS ping queue (`enqueueGpsPing`/`drainGpsQueue`). Location updates queue when offline, drain via `POST /rider/location/batch` on reconnect.

### Auth Security Hardening (Customer Mobile App Audit)

**Files modified:** `context/AuthContext.tsx`, `app/_layout.tsx`, `app/auth/index.tsx`, `app/auth/register.tsx`, `app/auth/forgot-password.tsx`, `api-server/src/routes/auth.ts`

**Critical Security Fixes:**
1. Server-side OTP verification before password reset — new `POST /auth/verify-reset-otp` endpoint validates OTP against server before allowing password step (was client-only check)
2. Duplicate magic link listener removed from `auth/index.tsx` — centralized in `_layout.tsx` `MagicLinkHandler` to prevent double API calls and race conditions
3. Cryptographically secure nonce for Google OAuth — uses `crypto.getRandomValues(Uint8Array(16))` with `expo-crypto` SHA-256 fallback (no Math.random)
4. Stale closure fixes in `AuthContext` — `userRef`/`tokenRef`/`doLogoutRef` pattern ensures callbacks always see latest state
5. Auth tokens (access + refresh + biometric) migrated from AsyncStorage to SecureStore (hardware-encrypted on iOS/Android); fallback to AsyncStorage on web
6. Registration partial token cleaned up on back-navigation (prevents stale token reuse)
7. OTP bypass blocked server-side for new users; existing users redirected to password auth
8. OTP removed from ALL dev API responses (5 occurrences in auth.ts)
9. Account enumeration removed from check-identifier (generic responses)
10. Account deletion PII scrub: phone scrambled, email/username/cnic/address/area/city/lat/lng all cleared
11. Address endpoint enforces max 5 addresses + field length limits server-side

**Medium Fixes:**
5. All `doLogout()` calls properly awaited (unauthorized handler, proactive refresh, `clearSuspended`)
6. Biometric cancel vs fatal failure — only hardware/lockout failures disable biometric; user cancel/system cancel/fallback do NOT
7. Proactive token refresh uses `doLogoutRef.current()` to always call latest logout implementation
8. `handleCompleteProfile` loading state fix — proper error handling prevents infinite spinner
9. `setOtpSent(true)` placement in register flow — set inside registration block to prevent half-registered state on retry

**UI/UX Fixes:**
10. Confirm password fields added to both register (Step 3) and forgot-password flows with real-time mismatch feedback
11. Email regex validation (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) applied consistently across all auth screens
12. `AuthGuard` segments dependency — effect now includes `segments` in deps for proper re-evaluation on navigation
13. Unused imports cleaned up (`TextInput`, `ActivityIndicator`, dead `loginResultRef`)

### Live Fleet Tracking — Complete System (Task #3)

**API Server:**
- `rider.ts`: Added `POST /rider/sos` — broadcasts SOS alert (with GPS coordinates, rideId, rider info) to admin-fleet via Socket.io. Added `GET /rider/osrm-route` — proxy endpoint that fetches turn-by-turn directions from the free public OSRM router (router.project-osrm.org), returns `{distanceM, durationSec, geometry, steps}`.
- `admin.ts`: Added `GET /admin/fleet-analytics?from=&to=` — returns heatmap ping data (up to 10K points), average ride response time, per-rider haversine distance totals, and active rider count for the date range.
- `socketio.ts`: Added `rider:sos` event relay (rider→admin-fleet broadcast), `admin:chat` event relay (admin→rider:{userId} personal room), auto-join personal room for JWT-authenticated riders on connect. Added `emitRiderSOS()` and `emitAdminChatReply()` exports.

**Admin Map (`live-riders-map.tsx`) — Complete Rewrite:**
- Correct color logic: Green=Online/idle, **Red=Busy/On Trip** (was incorrectly Orange), Grey=Offline
- Vehicle-type service icons: 🏍️ Bike/motorcycle, 🚗 Car, 🛺 Rickshaw, 🚐 Van, 🚛 Truck, 🔧 Service provider, 👤 Customer
- SOS banner: real-time red alert bar at top when any rider sends SOS. Shows rider name/phone/coordinates/time, Reply/Dismiss buttons.
- SOS chat modal: admin can type reply → emitted via `admin:chat` socket to `rider:{userId}` room. Chat history displayed per rider.
- SOS markers: 🆘 Leaflet markers at SOS coordinates on the map.
- Analytics tab: fleet heatmap (Leaflet Circle overlays per ping), top-rider distance bar chart (Recharts), stat cards for total pings, avg response time, active rider count. Configurable date range.
- Socket.io live connection now attempts join on connect, handles pruning of >500 rider overrides.

**Rider Web App (`Active.tsx`):**
- `SosButton` updated to capture current GPS position (via `navigator.geolocation.getCurrentPosition` with fallback to `riderPos` from `watchPosition`) before POSTing to `/rider/sos` with lat/lng.
- `TurnByTurnPanel` component: collapsible accordion that calls `/rider/osrm-route` and renders numbered step-by-step directions with distance. Shown for: pickup (ride accepted), drop-off (ride arrived/in_transit), store (order pickup phase), customer (order delivery phase).

**Mobile Rider App (`RiderLocationContext.tsx`) — previously completed:**
- Dual-mode tracking: 4min idle / 8sec active order intervals
- AsyncStorage persistence of `isOnline` for auto-resume on reboot
- `hasActiveTask` polling every 15s via `/rider/active`
- Sends `action: "on_trip"` during active delivery

### Admin Panel UI/UX & Bug Fix (Task #4)

All changes are in `artifacts/admin/src/`:

**Shared Component Library (`components/AdminShared.tsx`)**
- `Toggle`, `Field`, `SecretInput`, `StatusBadge` — shared across settings, security, flash-deals
- Added `SLabel` (section heading) and `ModeBtn` (pill mode button) — previously duplicated inline in settings.tsx

**Mobile Card-Views**
- `orders.tsx`, `users.tsx`, `products.tsx`: Added `sm:hidden` card layouts for mobile and `hidden sm:block` for desktop tables

**Mobile Header Declutter (`AdminLayout.tsx`)**
- Language selector hidden from header on mobile (`hidden sm:block`), shown in sidebar on mobile (`lg:hidden`)

**Live Riders Map (`live-riders-map.tsx`)**
- Fully rewritten using `react-leaflet` (MapContainer/TileLayer/Marker/Popup) — no more script tag injection
- Map center reads from platform settings (`map_default_lat`, `map_default_lng`)

**Currency De-hardcoding**
- `formatCurrency()` from `lib/format.ts` used everywhere in place of hardcoded `` `Rs. ${n}` `` strings
- Files updated: `orders.tsx`, `users.tsx`, `rides.tsx`, `parcel.tsx`, `pharmacy.tsx`, `CodRemittances.tsx`, `Withdrawals.tsx`, `DepositRequests.tsx`
- `CodRemittances.tsx`, `Withdrawals.tsx`, `DepositRequests.tsx`: replaced local `fc` helper with `const fc = formatCurrency`

**Button Loading States**
- All mutation buttons across all pages use `isPending`/`isLoading` + `disabled` + spinner pattern (was already consistent; confirmed across all 8+ pages)

**Settings.tsx Split (5232 → 2435 lines)**
- `settings-payment.tsx` (~1027 lines): GatewayCard, BankSection, CODSection, WalletSection, PaymentRules, PaymentSection
- `settings-integrations.tsx` (~574 lines): IntCard, IntStatusBadge, IntegrationsSection  
- `settings-security.tsx` (~764 lines): SecPanel, SecuritySection
- `settings-system.tsx` (~481 lines): SystemSection (DB management)
- settings.tsx imports from sub-files via `import { X } from "./settings-*"`

**StatusBadge Adoption**
- `orders.tsx` and `rides.tsx` now import and use `StatusBadge` from AdminShared for read-only status displays
- SelectTrigger status coloring still uses `getStatusColor` (requires CSS class string, not a component)

**Vendor Commission Centralization**
- `vendors.tsx`: added `DEFAULT_VENDOR_COMMISSION_PCT = 15` named constant; fallback reads from it instead of inline `"15"`

### Customer App — 33-Issue Deep Trace Fix (Task #10)

All changes are client-side only (`artifacts/ajkmart/`):

**AuthContext (`context/AuthContext.tsx`)**
- Proactive token refresh uses `refreshTimerRef` and re-schedules after each successful refresh (sliding window — prevents single-run expiry).
- Biometric save now resets loading state in `finally` block (no stuck spinner).

**LanguageContext (`context/LanguageContext.tsx`)**
- Was a stub returning only `"en"`. Now fully implemented: reads from AsyncStorage, supports all 5 modes (en, ur, roman, dual-en, dual-ur), syncs to server after login. Applies `I18nManager.forceRTL` for Urdu modes.

**CartContext (`context/CartContext.tsx`)**
- Now uses `useAuth()` internally (no prop drilling of `authToken`).
- `authTokenRef` pattern retained — always reads latest token without re-running effects, with AsyncStorage fallback for pre-hydration edge cases.
- Cart type conflict (mart vs food) banner added; UI warns user when mixing service types.

**PlatformConfigContext (`context/PlatformConfigContext.tsx`)**
- Polling interval previously ignored admin-configured value; now correctly uses `platform_config_poll_interval_sec` setting.
- Added cleanup on unmount to prevent memory leaks from orphaned interval.

**useApiCall (`hooks/useApiCall.ts`)**
- Has retry logic with `retryCount` / `retrying` state exposed to callers.
- `retry()` callback allows manual re-execution after failure.

**useRideStatus (`hooks/useRideStatus.ts`)**
- Replaced native `EventSource` (which cannot send custom headers) with a `fetch`-based streaming reader using `ReadableStream` and `AbortController`. Auth token is now sent via `Authorization: Bearer` header — no longer exposed in the URL query string.
- `closeSse()` now aborts the `AbortController` — cleans up the in-flight fetch stream on reconnect/unmount.
- `closeSse()` called before `connectSse()` in `reconnect()` — prevents duplicate streams.
- Memory leak fixed: `mountedRef` checked before every `setRide`/`setConnectionType` call inside the stream reader loop.
- Falls back to polling after 3 consecutive SSE failures.

**useMaps (`hooks/useMaps.ts`)**
- `resolveLocation()` now accepts optional `showError` callback and returns `null` on failure (instead of throwing) — prevents unhandled promise rejections.
- Null-island coordinates (0,0) are rejected and treated as geocode failures.

**RideBookingForm (`components/ride/RideBookingForm.tsx`)**
- `selectPickup` / `selectDrop`: switched from try/catch throw to null-return pattern from `resolveLocation`, with inline `showToast` error callback.
- `showToast` added to `useCallback` dependency arrays.
- Fare estimate type now validated against allowed values before API call.
- `debouncedEstimate` timer properly cleared on unmount via `useRef`.

**ride/index.tsx (`app/ride/index.tsx`)**
- On failed ride-load by URL param, now correctly sets `setRideLoadError(true)` (was incorrectly resetting booked state to `unknown`).
- Error state UI shown to user instead of silent failure.
- "Try Again" button now increments `retryNonce` state which is in the fetch `useEffect` deps — actually re-fetches the ride instead of just clearing the error flag.

**order/index.tsx (`app/order/index.tsx`)**
- Cancellation window now uses the server `Date` response header (`serverNow` state) instead of `Date.now()` — closes client clock-manipulation loophole.

**orders.tsx (`app/(tabs)/orders.tsx`)**
- `readyForPickup` status label was missing — added translated label in all 3 language sections of `@workspace/i18n`.
- Server-side timestamps used for order time display (no more client clock drift).
- `authHeaders` type fixed (was `any`, now properly typed).

**wallet.tsx (`app/(tabs)/wallet.tsx`)**
- Deposit min/max limits now read from `PlatformConfigContext` (not hardcoded).
- Transaction icon selected by `tx.type` field (not tx.amount sign — avoids wrong icon on refunds).
- Duplicate submission guard added via `isSubmittingRef` — prevents double-tap deposit.

**profile.tsx (`app/(tabs)/profile.tsx`)**
- Data export button now shows `Alert.alert` confirmation dialog before calling API.
- Cooldown timer (60 seconds) prevents re-export spam; button disabled and shows countdown.
- Cooldown interval cleared on unmount via `exportCooldownRef`.

**mart/index.tsx (`app/mart/index.tsx`)**
- Flash deals discount % now uses `Number(p.originalPrice)` safety cast to avoid NaN on string values.
- `addedTimerRef` uses `useRef` (not a plain variable) so timer is properly cleared on unmount — no stale-closure memory leak.
- `allProducts` now includes flash deal items in all views (previously excluded them from the main grid).
- Cart type banner shown when user tries to add mart item with active food cart (and vice versa).

**food/index.tsx (`app/food/index.tsx`)**
- Same `useRef` animation timer fix as mart.
- Cart type banner shown when user tries to add food item with active mart cart.

---

### Customer App Full-Stack Overhaul (Task #5)
1. **Pre-login Language Selector:** English/Urdu/Mixed toggle on auth screen. Language persists in AsyncStorage before login, syncs to server after login. RTL support for Urdu via `I18nManager.forceRTL`. LanguageProvider wraps AuthProvider in `_layout.tsx`.
2. **Robust Session Management:** `custom-fetch` retries network errors and 5xx with exponential backoff (up to 3 retries). Proactive token refresh 60s before JWT expiry via `scheduleProactiveRefresh` in AuthContext. Only forced logout on genuine 401 after refresh token failure. Access token TTL: 1 hour (short-lived for security). Refresh token TTL: 90 days (long-lived for persistent sessions). On app load, if stored access token is expired but refresh token exists, proactively calls `/api/auth/refresh` before restoring session. If expired with no refresh token, clears auth state and requires fresh login. All `expiresAt` responses in auth routes use `ACCESS_TOKEN_TTL_SEC` constant (no hardcoded values). All auth screen buttons use `TouchableOpacity` instead of `Pressable` for reliable web compatibility inside ScrollView.
3. **P2P Topup with Admin Approval:** New `/api/wallet/p2p-topup` endpoint creates pending deposit with `paymentMethod: "p2p"`. Admin approves via existing DepositRequests page. Wallet screen shows "P2P Topup" button and pending topup count banner.
4. **QR/Barcode Payment:** Real QR code generation in Receive Money modal using `react-native-qrcode-svg` (encodes phone, ID, name as JSON). Decoded QR data pre-fills Send Money form.
5. **Admin Settings Enforcement:** Maintenance mode overlay in `_layout.tsx`. Service toggles on home screen already enforced. Cart uses `PlatformConfigContext` for delivery fees instead of redundant API fetch. Pharmacy checkout enforces COD limit from `orderRules.maxCodAmount` and auto-switches to wallet when exceeded. Wallet feature toggle controls wallet payment option visibility.
6. **Audit & Bug Fixes:** Eliminated redundant platform-config API fetch in cart checkout (now uses context). Consistent error handling across screens.
7. **Dynamic Service Architecture:** Centralized service registry in `constants/serviceRegistry.ts` (imports shared metadata from `@workspace/service-constants` in `lib/service-constants/`). All service definitions (icons, colors, gradients, routes, labels, banners, quick actions) live in one place. Home screen adapts layout: single-service mode (full-page hero with service-specific branding), two-service mode (dual hero cards), multi-service mode (hero + grid cards). BannerCarousel and quick actions derived from registry via `getActiveBanners()` and `getActiveQuickActions()`. Bottom tab bar is dynamic — adapts labels and visibility based on active services (hides wallet tab if wallet off, changes tab labels contextually). ServiceGuard uses registry-backed labels with shared `ServiceKey` type. Admin panel imports `ADMIN_SERVICE_LIST` from `@workspace/service-constants` for service management cards. Adding a new service only requires: (1) adding to the shared metadata, (2) adding to the service registry, (3) creating the route, (4) adding the feature flag. Deep-link protection via `withServiceGuard` HOC — wraps each service screen's default export. Applied to all 5 service screens: mart, food, ride, pharmacy, parcel.
### InDrive-Style Ride Dispatch Framework
- **Broadcast Dispatch Model:** When a ride is requested, notifications are sent to ALL nearby online riders within admin-configured radius (not one-at-a-time). Every 10s dispatch cycle re-broadcasts to catch newly-online riders. First rider to accept wins via atomic `WHERE riderId IS NULL`. After `dispatch_broadcast_timeout_sec` (default 120s) with no acceptance, ride is expired with customer notification.
- **Dispatch Settings (Admin-configurable):** `dispatch_broadcast_timeout_sec` (120), `dispatch_min_radius_km` (5), `dispatch_avg_speed_kmh` (25), `dispatch_ride_start_proximity_m` (200).
- **Radius-Filtered Requests:** `GET /rider/requests` now filters rides by rider's distance within `dispatch_min_radius_km`, sorted by proximity (nearest first). Riders only see rides they can realistically reach.
- **Ignore Penalty System:** `POST /rider/rides/:id/ignore` tracks daily ignores via `rider_penalties` table. Exceeding `rider_ignore_limit_daily` triggers wallet penalty (`rider_ignore_penalty_amount`). Optional account restriction via `rider_ignore_restrict_enabled`. Warning notification at limit, penalty notification above.
- **Cancel Penalty System:** Pre-existing `handleCancelPenalty()` in `rider.ts` uses `rider_cancel_limit_daily`, `rider_cancel_penalty_amount`, `rider_cancel_restrict_enabled`.
- **Post-Ride Rating:** `POST /rides/:id/rate` (customer auth). 1-5 stars + optional comment. Unique DB constraint prevents duplicates. Customer app submits rating on tap with response.ok validation.
- **Professional Cancel Flow:** `CancelModal` component in orders.tsx provides reason selection (order/ride-specific), refund/fee info display, loading state, and dismiss protection while loading. Both `PATCH /orders/:id/cancel` and `PATCH /rides/:id/cancel` accept optional `reason` field. API response (refundAmount, cancellationFee) used for authoritative post-cancel toast messages.
- **Payment Method Filtering:** `GET /rides/payment-methods` returns only admin-enabled payment methods (cash, wallet, jazzcash, easypaisa). Customer app filters displayed options by these settings. Ride booking payment UI renders each method with its own label, icon, and color (Cash=green/cash-outline, Wallet=blue/wallet-outline, JazzCash=red/phone-portrait, EasyPaisa=green/phone-portrait).
- **Notification Sound:** Professional 8-tone double-burst in `notificationSound.ts`. Silence mode API: `silenceFor(minutes)`, `isSilenced()`, `unsilence()`, `getSilenceRemaining()` using localStorage. Rider App Home shows mute button with 15/30/60min duration picker.
- **Customer App Theme:** Ride tracker searching screen uses rider app dark theme (gray-900 gradient, green accents) for consistent brand experience.
- **Dispatch Status:** `GET /rides/:id/status` returns dispatch metadata (loop count, attempts, expiry) for customer polling.
- **Ride State Machine:** `RIDE_STATUS_TRANSITIONS` map in `rider.ts` enforces valid status transitions: `accepted→[arrived,cancelled]`, `arrived→[in_transit,cancelled]`, `in_transit→[completed,cancelled]`. Prevents status jumps (e.g. `accepted→completed` is blocked).
- **Arrival Proximity Validation:** When a rider marks "arrived", the server validates their GPS distance from the pickup point using Haversine formula against `dispatch_ride_start_proximity_m` (default 500m). Prefers server-stored `live_locations` (trusted) over client-supplied coordinates. Rejects if no location is available or distance exceeds threshold.

### Real-Time Fleet Tracking (Task #5)

**DB layer:**
- `location_logs` table added (`lib/db/src/schema/location_logs.ts`): userId, role, lat/lng, accuracy, speed, heading, batteryLevel, isSpoofed, createdAt. Compound index on `(user_id, created_at)` for time-range queries. Migrated via `pnpm run push`.

**Backend (`artifacts/api-server/`):**
- `socket.io` installed; `lib/socketio.ts` initialises Socket.io on the shared `http.Server` at path `/api/socket.io`. Rooms: `admin-fleet`, `ride:{rideId}`, `vendor:{vendorId}`.
- `routes/locations.ts` upgraded: every `POST /locations/update` pings are logged to `location_logs`, server-side Haversine distance throttle (25m via `gps_min_distance_meters` setting), emits `customer:location` to `admin-fleet`, new `DELETE /locations/clear` endpoint clears a user's live location on logout (authenticated by Bearer JWT).
- `routes/rider.ts` upgraded: every `PATCH /rider/location` ping logs to `location_logs`, emits `rider:location` to `admin-fleet` + `ride:{rideId}` rooms; `rideId` passed in request body. Fixed duplicate `const now` variable by renaming inner one to `nowDate`.
- `routes/admin.ts`: `GET /admin/riders/:userId/route?date=YYYY-MM-DD` fleet history API returns hourly buckets from `location_logs`.

**Admin map (`artifacts/admin/src/pages/live-riders-map.tsx`):**
- Socket.io client (`socket.io-client`) connects to `admin-fleet` room, receives live `rider:location` events.
- Green (online <2min) / orange (stale 2-10min) / gray (offline >10min) color-coded Leaflet markers.
- Toggleable blue customer location layer.
- Breadcrumb polyline for selected rider; time-slider route playback (`useRiderRoute` hook).
- "Last seen X min ago" shown for offline riders.

**Rider web app (`artifacts/rider-app/`):**
- `Active.tsx`: `updateLocation` now passes `rideId: data?.ride?.id` so socket room `ride:{rideId}` receives real-time events.
- `lib/api.ts` `updateLocation` signature extended with optional `rideId`.

**Vendor app (`artifacts/vendor-app/src/pages/Orders.tsx`):**
- Connects to `vendor:{userId}` socket room on mount; displays live "Rider X km away, ETA ~Y min" badge computed via Haversine distance from vendor's browser geolocation.

**Customer mobile app (`artifacts/ajkmart/`):**
- `context/AuthContext.tsx`: On login, if role=customer, requests foreground location permission (non-blocking) and posts location to `POST /locations/update`; on logout, calls `DELETE /locations/clear` to remove customer from the live map.
- `components/ride/RideTracker.tsx`: Socket.io client installed (`socket.io-client` added to ajkmart). While ride is in active status, connects to `ride:{rideId}` room and listens for `rider:location`. Live socket position is preferred over polling data in the distance/ETA badge (green dot indicator when live position is active).

### Accordion Components
- **Customer App (Expo):** Custom `Accordion` component at `artifacts/ajkmart/components/Accordion.tsx` with animated chevron rotation, `LayoutAnimation` transitions, icon/badge support. `AccordionGroup` wrapper for grouped sections. Used in: Profile (Help & Support sections), Privacy Modal (Notification/Privacy/Security/Account sections), Orders (expandable item lists on OrderCard and PharmacyCard).
- **Rider App (React-Vite):** Radix-based `AccordionGroup` component at `artifacts/rider-app/src/components/Accordion.tsx`. Used in: Earnings (breakdown sections), SecuritySettings (info sections).
- **Vendor App (React-Vite):** Uses `@radix-ui/react-accordion` directly. Used in: Store (operating hours sections), Profile (bank details, payout policy).

### Safe Area / Edge-to-Edge Display
- **Customer App (Expo):** Uses `SafeAreaProvider` + `useSafeAreaInsets` with `topPad = Platform.OS === "web" ? 67 : insets.top` pattern on all tab and service screens.
- **Rider App (React-Vite):** `index.html` has `viewport-fit=cover` + PWA/iOS meta tags. `index.css` defines `--sat/--sar/--sab/--sal` CSS variables. All page headers use `style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 3.5rem)" }}` instead of fixed `pt-14`. BottomNav and App.tsx content area use `env(safe-area-inset-bottom)` for bottom spacing.
- **Vendor App (React-Vite):** `index.html` has `viewport-fit=cover`. `Header.tsx` component centrally applies `paddingTop: calc(env(safe-area-inset-top, 0px) + 2.5rem)`. BottomNav uses `env(safe-area-inset-bottom)`.

- **Mapping APIs:** Google Maps Platform (or similar) for autocomplete, geocoding, and distance calculations (gated by `maps_places_autocomplete`, `maps_geocoding`, `maps_distance_matrix` settings).
- **Sentry:** For error tracking and performance monitoring (configured via `sentry_dsn`, `sentry_env`, etc.).
- **Analytics Platform:** For tracking user behavior (configured via `analytics_platform`, `tracking_id`).

### KYC (Know Your Customer) System — Completed

#### Database
- **`lib/db/src/schema/kyc_verifications.ts`**: `kyc_verifications` table. Fields: `id`, `userId`, `status` (`pending|approved|rejected|resubmit`), personal info (`fullName`, `cnic`, `dateOfBirth`, `gender`, `address`, `city`), document photos (`frontIdPhoto`, `backIdPhoto`, `selfiePhoto`), review fields (`rejectionReason`, `reviewedBy`, `reviewedAt`), timestamps. Migrated via `pnpm --filter @workspace/db push`.

#### Backend (`artifacts/api-server/src/routes/kyc.ts`)
- `GET  /api/kyc/status` — Customer: returns current KYC status + submitted record details
- `POST /api/kyc/submit` — Customer: multipart form with personal info + 3 photos (CNIC front/back, selfie). Saves to `uploads/kyc/`. Validates CNIC is 13 digits. Updates `users.kycStatus = "pending"`.
- `GET  /api/kyc/admin/list` — Admin: paginated list with status filter, joined with user data
- `GET  /api/kyc/admin/:id` — Admin: full detail of one record with photo URLs
- `POST /api/kyc/admin/:id/approve` — Admin: sets status `approved`, syncs `users.kycStatus = "verified"`, copies CNIC/name/city to users table
- `POST /api/kyc/admin/:id/reject` — Admin: sets status `rejected` with reason, updates `users.kycStatus = "rejected"`

#### Customer Portal (`artifacts/customer/src/pages/Profile.tsx`)
- New **KYC tab** (4th tab, with red `!` badge if not verified or rejected)
- **Step 0**: Status view — shows verified badge, pending review message, rejection reason, benefit list, or start button
- **Step 1**: Personal Info form (fullName, CNIC, DOB, gender, address, city)
- **Step 2**: CNIC front + back photo upload with preview
- **Step 3**: Selfie with CNIC photo upload
- **Step 4**: Review all data + submit
- `KycSection` component fetches status from `GET /api/kyc/status`, submits via `FormData` to `POST /api/kyc/submit`

#### Admin Panel (`artifacts/admin/src/pages/kyc.tsx` + `App.tsx` + `AdminLayout.tsx`)
- Route `/kyc` added to `App.tsx`
- **KYC** nav item added under "User Management" in sidebar (`AdminLayout.tsx`, uses `BadgeCheck` icon)
- `navKyc` translation key added to all 3 language blocks in `lib/i18n/src/index.ts`
- Admin page: stats cards (Total/Pending/Approved/Rejected), filter tabs, sortable table with user info + CNIC + status + submission date
- Click row → slide-in detail panel with personal details, zoomable document photos (fullscreen modal), approve/reject buttons
- Reject modal with quick-select rejection reasons + custom reason textarea
### Task #6 — Full QA & Security Audit (Completed)

#### XSS Vulnerabilities Fixed

All user-supplied string fields sanitized with `stripHtml()` (strips HTML tags via `s.replace(/<[^>]*>/g, "").trim()`):

| Route | Fields Fixed | Session |
|-------|-------------|---------|
| `/parcel-bookings` (POST) | `senderName`, `receiverName`, `pickupAddress`, `dropAddress`, `description` | Previous |
| `/pharmacy-orders` (POST) | `deliveryAddress` | Previous |
| `/addresses` (POST + PUT) | `label`, `address`, `city` | Task #6 |
| `/orders` (POST) | `deliveryAddress` | Task #6 |
| `/users/profile` (PUT) | `address`, `city` | Task #6 |
| `/rides` (POST) | `pickupAddress`, `dropAddress`, `bargainNote`, `receiverName`, `packageType`, `rateRide.comment` | Task #6 |
| `/reviews` (POST) | `comment` | Task #6 |

#### Security Audit Results (All PASSING)

- **JWT alg:none**: Blocked (401) — algorithm whitelist enforced
- **Expired JWT**: Blocked (401)
- **IDOR** (orders/rides/addresses/pharmacy/parcels): Blocked (403/404) — userId scope enforced on all queries
- **SQL injection**: Safe — all queries use Drizzle ORM parameterized statements; injection strings return empty results
- **Mass assignment** (isAdmin, role, walletBalance): Blocked — Zod `.strip()` on profile schema
- **Negative price injection**: Blocked — per-item validation on all order routes
- **Cart price injection**: Server overrides with DB price; returns 409 if mismatch
- **OTP brute force**: Blocked — rate limiter + single-use OTP enforcement
- **Admin endpoints with user token**: Blocked (401) — separate `adminAuth` middleware
- **New account order limit**: 3 orders in first 7 days (configurable via `security_new_acct_limit`)
- **Same-address rate limit**: Enforced on orders, pharmacy orders
- **Wallet negative deposit**: Blocked (400 validation)
- **Large wallet deposit**: Max limit enforced per settings

#### Functional Testing Summary

All 23 core user flows tested and verified:
Auth (OTP send/verify) → Profile (GET/PUT) → Products/Categories/Flash deals → Banners → Cart validate → Mart order → Food order → Order cancel → Wallet balance → Wallet payment order → Address CRUD → Ride estimate → Ride book → Ride cancel → Pharmacy order → Parcel booking (wallet + COD) → Review submit → Notifications list → Mark all read

#### Route Clarifications Documented

- Categories: `GET /api/categories?type=mart|food` (not `/products/categories`)
- Flash deals: `GET /api/products/flash-deals`
- Seed: `POST /api/seed/products` with `x-admin-token` header
- Parcel: requires `senderPhone`, `parcelType` (not `packageType`)
- Reviews: require `orderType` field; product reviews require delivered/completed order
- Pharmacy: items must include `price` and `quantity` (digital pharmacy catalog model)
- Notifications unread count: returned as `unreadCount` in `GET /api/notifications` response

### Map Pin Location, Scheduled Rides, Van Service & Pool Rides — Completed

#### T001: Map Pin Location Picker
- **`artifacts/api-server/src/routes/maps.ts`**: `/api/maps/picker` serves a full HTML+Leaflet page with `window.parent.postMessage` for location selection.
- **`artifacts/ajkmart/components/ride/MapPickerModal.tsx`**: Native WebView-based modal wrapper that captures `postMessage` events from the map picker.
- **`artifacts/ajkmart/components/ride/MapPickerModal.web.tsx`**: Web-specific implementation using `<iframe>` instead of WebView, with origin validation (`event.origin === PICKER_ORIGIN`), `allow="geolocation"` attribute, and proper sandbox permissions.
- **`artifacts/ajkmart/components/ride/RideBookingForm.tsx`**: Integrated MapPickerModal for both pickup and drop location selection via map pins. Layout compacted: reduced gradient header padding, smaller inputs/icons, compact service type cards (130px width, 120px minHeight), GPS button in header bar, tighter scroll area padding (16px vs 20px).

#### T002: Scheduled Rides + Multi-Stop
- **`artifacts/api-server/src/routes/rides.ts`**: Both wallet and cash ride INSERT calls persist `isScheduled`, `scheduledAt`, `stops`, `isPoolRide`; scheduled rides get status `"scheduled"`; broadcast skipped at booking.
- **`dispatchScheduledRides()`**: Exported function activates scheduled rides within 15-minute window; cron in `index.ts` runs every minute.

#### T003: Commercial Van Service (Full Stack)
- **`artifacts/api-server/src/routes/van.ts`**: Complete van API — customer booking (`GET /routes`, `GET /routes/:id`, `GET /schedules/:id/availability`, `POST /bookings`, `GET /bookings`, `PATCH /bookings/:id/cancel`), rider driver endpoints (`GET /driver/today`, passenger manifest, board/complete), admin CRUD (routes/vehicles/schedules/bookings).
- **`lib/db/src/schema/van_service.ts`**: Four tables: `vanRoutesTable`, `vanVehiclesTable`, `vanSchedulesTable`, `vanBookingsTable`.
- **`artifacts/ajkmart/app/van/index.tsx`**: 5-step multi-step customer booking screen (routes → schedules → date → seats → confirm).
- **`artifacts/ajkmart/app/van/bookings.tsx`**: My Van Bookings history screen with cancel support.
- **`artifacts/ajkmart/app/van/_layout.tsx`**: Stack navigator for van screens.
- **`artifacts/admin/src/pages/van.tsx`**: Admin van management page with 4 tabs (Routes/Schedules/Vehicles/Bookings).
- **`artifacts/rider-app/src/pages/VanDriver.tsx`**: Rider van driver screen — today's schedules, passenger manifest, board/complete actions.
- Van added to admin sidebar and customer home screen Quick Actions.

#### T004: Ride Sharing / Pool Rides
- **Pool matching logic** in `rides.ts`: On `isPoolRide=true` booking, searches within 500m radius and 20-min window for same-direction, same-type pool rides with under 3 passengers; groups them under shared `poolGroupId` or creates new group.
- **`GET /api/rides/pool/:groupId`**: Returns all rides in a pool group with passenger count.
- **`artifacts/rider-app/src/pages/Home.tsx`**: Pool ride requests show "👥 Pool" badge.
- **`artifacts/rider-app/src/pages/Active.tsx`**: Active pool rides show "POOL" indicator badge in ride header.
- Pool fields (`isPoolRide`, `poolGroupId`) included in all ride API responses via `formatRide` spread.

### Security, QA & Stability Audit — Session Fixes

#### Ghost State on Logout (React Query Cache)
- **`artifacts/ajkmart/context/AuthContext.tsx`**: Added `useQueryClient` import and `queryClient.clear()` call at end of `doLogout()` — ensures all React Query cached data (orders, profile, wishlist etc.) is wiped on logout, preventing stale data from flashing when another session starts.
- **`artifacts/vendor-app/src/lib/auth.tsx`**: Same fix — `useQueryClient` + `queryClient.clear()` added to `logout()` function.
- **`artifacts/rider-app/src/lib/auth.tsx`**: Same fix — `useQueryClient` + `queryClient.clear()` added to `logout()` function.

#### Product Detail Discount Badge Position
- **`artifacts/ajkmart/app/product/[id].tsx`**: Moved `discountBadge` style from `top: 16, left: 16` (overlapping the floating back button) to `bottom: 24, left: 16` (bottom-left of the image carousel, clear of all navigation buttons). Badge now shows correctly below the dot indicators row at a different horizontal position.

#### Admin Panel Password Form Accessibility
- **`artifacts/admin/src/pages/login.tsx`**: Added a hidden `<input type="text" name="username" autoComplete="username" value="admin" readOnly hidden />` field before the admin secret password input, silencing browser accessibility warnings about password forms without associated username fields.

#### API Security Audit (Verified Correct)
- All vendor routes protected by `requireRole("vendor", { vendorApprovalCheck: true })` at router level.
- All rider routes protected by `riderAuth` at router level.
- All wallet routes use `customerAuth` per-endpoint.
- Seed routes protected by `adminAuth`.
- Admin routes protected by `adminAuth` from `admin-shared.ts`.
- JWT middleware: hard 401 on missing/invalid token, role check, ban check, token version check (session revocation).

#### Screens Audited & Verified Clean
- Customer app: Home (guest), Mart, Pharmacy, Search, Product Detail, Cart, Food, Ride, Parcel screens — all load correctly, no crashes.
- Auth gates: Orders, Wallet, Profile properly redirect guests to login.
- Admin panel: `/dashboard`, `/users`, and all 25+ protected routes redirect to login without token.
- Vendor app: All routes behind global `!user → <Login />` guard; multi-step registration embedded in Login component.
- Rider app: `/dashboard` and all routes redirect to login; `/register` and `/forgot-password` are public.

#### Bug Fix: Orders Tab Auth Gate (Consistency)
- **`artifacts/ajkmart/app/(tabs)/orders.tsx`**: Replaced `AuthGateSheet` bottom-sheet modal (dark overlay) with the same inline full-screen gate pattern used in Wallet and Profile tabs — receipt icon, bold title, subtitle, "Sign In / Register" button, and "Continue Browsing" link. Uses `AsyncStorage.setItem("@ajkmart_auth_return_to", ...)` for deep-link return on login.

#### Bug Fix: Wallet Deposit Modal Error Message
- **`artifacts/ajkmart/app/(tabs)/wallet.tsx`**: When no deposit methods are configured (JazzCash/EasyPaisa/Bank all disabled in platform settings), the modal now says "Deposit Not Available — JazzCash, EasyPaisa, and Bank Transfer are not yet enabled. Please contact support to add funds." instead of the misleading "Could not load payment methods. Please try again."

#### Bug Fix: Profile City Chip Active State
- **`artifacts/ajkmart/app/(tabs)/profile.tsx`**: `chip.active` style was empty `{}` — no visual feedback when a city chip is selected in the registration/edit profile modal. Fixed to `{ backgroundColor: C.primarySoft, borderColor: C.primary }` and `chip.textActive` to `{ color: C.primary }` so the selected city is visually distinct.

#### Payment Method Seeding
- **`artifacts/api-server/src/routes/seed.ts`**: Seed endpoint (`POST /api/seed/products`) now upserts 15 platform settings to enable JazzCash (manual), EasyPaisa (manual), and Bank Transfer as payment methods with placeholder account details. Uses `onConflictDoUpdate` to ensure the demo always has working deposit methods. Admin can override these values in the admin panel at any time.

#### Bug Fix: Profile `fetchAll` Stale Token (Bug #4)
- **`artifacts/ajkmart/app/(tabs)/profile.tsx`**: `fetchAll` `useCallback` was declared with `[user?.id]` as its dependency array, but the callback closes over `token` from `useAuth()`. After a token refresh, the old stale token was used for all profile API calls. Fixed by adding `token` to the dependency array: `}, [user?.id, token])`.

#### Bug Fix: Wallet Send — Receiver Not Found Not Caught (Bug #5)
- **`artifacts/ajkmart/app/(tabs)/wallet.tsx`**: `handleSendContinue` called `POST /wallet/resolve-phone`, but did not check the `found` field in the response. When a phone number had no AJKMart account, the app silently advanced to the send confirmation screen with a blank receiver name — allowing the user to attempt a transfer to a non-existent account. Fixed by checking `!data.found` after the API call and showing a toast error ("No AJKMart account found with this phone number.") and returning early. Also added a `catch` block that shows a toast on network errors and returns early, preventing the confirm step from being reached.

#### Bug Fix: AuthContext Token Refresh — Wrong User Shape (Bug #6, Critical)
- **`artifacts/ajkmart/context/AuthContext.tsx`** line 207 (proactive refresh) and line 505 (biometric login): After token refresh, the profile endpoint `/api/users/profile` returns `{ success, data: {...user fields...} }`. Both occurrences of `const freshUser: AppUser = meData.user || meData` were wrong — `meData.user` is `undefined` because the user is nested under `meData.data`, causing the entire API response envelope to be stored as the user object. Fixed both to `meData.data || meData.user || meData`. This bug caused incorrect user state after any background token refresh.

#### Bug Fix: ActiveTrackerStrip Never Shows (Bug #8)
- **`artifacts/ajkmart/app/(tabs)/index.tsx`** lines 279-280: `ActiveTrackerStrip` fetches `GET /api/orders?status=active` and `GET /api/rides?status=active`, both returning `{ orders: [...] }` and `{ rides: [...] }` objects (not arrays). The code checked `Array.isArray(ordersData)` which was always false, so `activeOrders` and `activeRides` were always empty — the strip never appeared even when the user had active orders or rides. Fixed to `(ordersData?.orders ?? []).filter(...)` and `(ridesData?.rides ?? []).filter(...)` with `Array.isArray` fallback for defensive compatibility.

### Profile Section Full Audit & Fix — Completed (19 Tasks)

#### Backend Security (api-server)

- **`artifacts/api-server/src/routes/users.ts`**:
  - Task 1: Session revocation now targets only the specific session (not all refresh tokens for the user)
  - Task 2: delete-account uses `GDEL_` prefix with `isBanned: false` so the original phone can re-register
  - Task 3: Email uniqueness enforced on profile update — rejects if email already belongs to another user
  - Task 5: Avatar field stripped from `profileUpdateSchema` — avatar can only be changed via `POST /avatar`
  - Task 14: export-data DB queries wrapped in try/catch with proper error logging
  - Task 15: In-memory per-user rate limiting (10 req/min) on `/profile` and `/avatar` endpoints

- **`artifacts/api-server/src/routes/kyc.ts`**:
  - Task 6: base64 MIME validation — GIF/unknown types rejected; magic byte check rejects unknown format (null) AND MIME mismatch; 5MB cap per photo
  - Task 7: Duplicate CNIC blocked across different users (within same transaction)
  - Task 8: KYC re-submission wrapped in DB transaction for race-condition safety
  - Task 9: KYC admin approval only syncs name if user's current name is null
  - Task 10: adminId fallback "admin" removed — 403 if adminId missing from JWT
  - Task 11: Role guard added — customers allowed only if `wallet_kyc_required=on` OR `upload_kyc_docs=on` in platform config

- **`artifacts/api-server/src/routes/addresses.ts`**:
  - Task 12: set-default and add/update operations wrapped in DB transactions for atomicity
  - Task 13: Hardcoded "Muzaffarabad" city default replaced with null

#### Frontend (ajkmart)

- **`artifacts/ajkmart/app/(tabs)/profile.tsx`**:
  - Task 4: CNIC format — profileUpdateSchema accepts both `1234567890123` and `12345-1234567-8` formats
  - Task 16: Address limit UX — Add Address button already had opacity + toast when list.length >= 5 (confirmed working)
  - Task 17: Reset unsaved avatar state on modal dismiss — `avatarUri` and `pendingAsset` cleared when modal closes
  - Task 18: DOB input replaced with smart auto-formatter (`formatDob`) that inserts hyphens at positions 4/7 (YYYYMMDD → YYYY-MM-DD) and shows human-readable date confirmation
  - Task 19: Auto-scroll to Add Address form (form already at top of modal, confirmed correct position)

#### Typography Notes
- Use `Typ.button` (not `Typ.buttonMedium`). Available styles: `T.subtitle`, `T.body`, `T.bodyMedium`, `T.caption`, `T.small`, `T.smallMedium`, `T.button`, `T.buttonSmall`
- Error response format: `{"success":false,"error":"English","message":"Urdu"}` — always use `data.error` first in UI
- Image upload pattern: `base64: false` in ImagePicker, then `LegacyFileSystem.readAsStringAsync(uri, { encoding: "base64" as const })`

### Wallet Full Audit & Deep Fix — Completed (17 Tasks)

#### Backend (api-server)

- **`artifacts/api-server/src/routes/wallet.ts`**:
  - Task 10: Receiver row locked with `.for("update")` inside transaction in `/wallet/send` — prevents double-spend under concurrent requests
  - Task 11: `/wallet/send` accepts optional `idempotencyKey` (in-memory TTL cache; `sendSchema` updated with `z.string().uuid().optional()`)
  - Task 12: `amountSchema` enforces max 2 decimal places via `z.string().refine` — rejects dust/overly-precise amounts before any DB operation
  - Task 13: Sender frozen check moved inside the DB transaction (after FOR UPDATE lock) — admin freeze mid-transfer now correctly blocks it
  - Task 14: `catch` blocks in `/send` and `/withdraw` detect DB-level errors (deadlock/timeout) and return generic 500 without leaking raw error message
  - Task 15: `deriveStatus` skipped (already prefix-based; low risk)
  - Task 16: `/simulate-topup` guarded by `DISABLE_SIMULATION` env var + `NODE_ENV !== "development"` — protected from production misuse

- **`artifacts/api-server/src/routes/admin/users.ts`**:
  - Task 17: `getIO` imported from `../../lib/socketio.js`; emits `wallet:frozen` / `wallet:unfrozen` socket events when user's `blockedServices` field changes

#### Frontend (ajkmart)

- **`artifacts/ajkmart/app/(tabs)/wallet.tsx`**:
  - Task 1: DepositModal race condition guarded by `submitting` ref lock; idempotency key regenerated on each `goToConfirm` call
  - Task 2: `KeyboardAvoidingView` (Platform-aware: `padding` iOS / `height` Android) added to DepositModal, WithdrawModal, and SendModal
  - Task 3: WithdrawModal now has a two-step flow — "Enter Details" → "Confirm" summary step (amount, method, IBAN/account) → final submit
  - Task 4: `isDebitType` and `isCreditType` now use exhaustive `Set<string>` including `"insurance"`, `"bonus"`, `"simulated_topup"`, `"referral"`, `"cashback"`, `"refund"`. Rejected tx renders in amber (`C.amberSoft` / `C.amber`) not red
  - Task 5: `setSocketBalance(null)` moved to START of `onRefresh`; `socket.on("wallet:frozen")` / `socket.on("wallet:unfrozen")` listeners added via `useAuth().socket` in a dedicated `useEffect`
  - Task 6: QR payload truncates `user.name` to 32 chars: `(user?.name || "").slice(0, 32)`
  - Task 7: `handleSendContinue` guards `isNaN(num)`, `num <= 0`, and `typeof minTransfer !== "number"` — falls back to 100 if min is undefined
  - Task 8: Phone resolution network errors set `sendPhoneNetErr` state, showing a "Retry" button inline instead of a toast-only dead end
  - Task 9: AsyncStorage `.catch` in DepositModal now always logs warning (removed `__DEV__` guard); in-memory dedup still active as fallback
  - Send idempotency: `sendIdempotencyKey` state generated at confirm step; included in `/wallet/send` request body

#### Admin Panel

- **`artifacts/admin/src/pages/DepositRequests.tsx`**: Confirmed working — lists pending/approved/rejected with approve/reject action buttons
- **`artifacts/admin/src/pages/Withdrawals.tsx`**: Confirmed working — lists all withdrawal requests with user detail and action buttons
