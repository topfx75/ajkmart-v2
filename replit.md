# AJKMart Super App — Workspace
<!-- Last updated: 2026-03-26 — ADMIN AUDIT: Integrations/Delivery/Rides/Orders/Finance/Customer/Rider sections fully wired.
  21 new enforcement fixes across 7 sections:

  INTEGRATIONS (45 settings):
  - maps_places_autocomplete / maps_geocoding / maps_distance_matrix: now gate specific Maps API endpoints (autocomplete/geocode/directions)
  - analytics_platform/tracking_id/debug + sentry_dsn/env/sample_rate/traces_sample_rate → exposed in platform-config integrations block
  - Integrations block added to customer app PlatformConfigContext (interface + DEFAULT + mapper for 17 fields)
  - Optional integrations type added to vendor-app and rider-app useConfig.ts

  DELIVERY (7 settings — all 7 now enforced):
  - delivery_fee_mart/food/pharmacy/parcel + delivery_parcel_per_kg → calculated and added to order total on every POST /orders
  - delivery_free_enabled + free_delivery_above → free delivery applied when itemsTotal ≥ threshold
  - Response now includes deliveryFee breakdown field

  RIDES (9 settings — 1 was missing):
  - ride_cancellation_fee → new PATCH /rides/:id/cancel route; charges cancellation fee from wallet when ride status is "ongoing"

  ORDERS (8 settings — 5 were missing):
  - order_max_cart_value → cart value limit enforced in POST /orders
  - order_schedule_enabled → gates scheduledAt field in POST /orders
  - order_preptime_min → drives estimatedTime field (replaces hardcoded "30-45 min")
  - order_cancel_window_min → enforced in PATCH /orders/:id when userId present
  - order_rating_window_hours → enforced in POST /reviews (checks order age vs window)
  Response now includes gstAmount breakdown field

  FINANCE (7 settings — 4 were missing):
  - finance_gst_enabled + finance_gst_pct → GST calculated on itemsTotal and added to order total
  - finance_cashback_enabled + finance_cashback_pct + finance_cashback_max_rs → cashback credited to customer wallet on order delivery in rider.ts

  CUSTOMER (6 settings — 1 was missing):
  - customer_signup_bonus → credited to wallet + wallet_transactions + notification on very first login (lastLoginAt was null)

  RIDER (9 settings — 1 was missing):
  - rider_cash_allowed → blocks rider from accepting COD (cash) orders when set to "off"

  DEAD / ASPIRATIONAL SETTINGS (not fixable without scheduled jobs or major infra):
  - order_auto_cancel_min (needs background job scheduler)
  - order_refund_days (needs explicit refund request flow)
  - customer_referral_enabled/bonus (needs referral code lookup flow)
  - customer_loyalty_enabled/pts (needs loyalty points schema and accumulation logic)
  - vendor_min_order (needs vendorId at order creation time — not in current customer flow)
  - vendor_settlement_days (informational only — displayed in vendor dashboard)
  - rider_acceptance_km (needs GPS-based distance filtering on rider's position)
  - vendor_auto_approve / rider_auto_approve (would need approval workflow in auth)
  -->
<!-- Last updated: 2026-03-26 — ADMIN AUDIT ROUND 3 COMPLETE: 4 bugs found and fixed.
  1. Dead `max_cod_amount` key removed from orders renderer AMOUNT_KEYS — key never existed in DB (real key is `cod_max_amount` in payment category); filter silently skipped it, causing no UI render — cleaned up.
  2. `riderKeep` stale reads fixed in both Delivery and Rides fare-preview renderers — both read from `settings` (server-saved) not `localValues`; fixed to use `localValues ?? settings` so live preview reflects pending changes.
  3. `wallet_cashback_pct` / `wallet_cashback_on_*` ghost settings wired — admin had 4 wallet-cashback settings (pct + orders/rides/pharmacy flags) but platform-config never exposed them so client apps couldn't use them. Fixed:
     - platform-config.ts: 4 new fields in `payment` block (walletCashbackPct, walletCashbackOrders, walletCashbackRides, walletCashbackPharm)
     - PlatformConfigContext.tsx: 4 new fields added to `customer` block (interface + DEFAULT + parser reads from `raw.payment.*`)
     - cart/index.tsx: `walletCashbackApplies` + `walletCashbackAmt` computed; blue 💰 banner shown in order summary when wallet is selected and cashback > 0
  4. Dirty-count tab badge attribution fixed for cross-category keys — `vendor_min_payout` (DB category: vendor) is displayed in Finance tab; dirty badge incorrectly showed on Vendor tab. Added `DISPLAY_CAT_OVERRIDE` map so dirty count for `vendor_min_payout` is attributed to `finance` tab.
  -->
<!-- Last updated: 2026-03-26 — FEATURE TOGGLES: Full-stack enforcement for all 8 Feature Toggle seeds + professional admin UI.
  BUG FIXED: Customer app PlatformConfigContext.tsx was only parsing 4 of 11 feature flags (chat/wallet/liveTracking/reviews). Added mart/food/rides/pharmacy/parcel/referral/newUsers — home screen service buttons now correctly enable/disable from admin toggle.
  API GAPS CLOSED:
    - orders.ts: feature_mart gate added (line 73) — HTTP 503 when mart service disabled
    - orders.ts: feature_food gate added (line 76) — HTTP 503 when food delivery disabled
    - reviews.ts: feature_reviews gate added — HTTP 503 when reviews disabled globally
  ADMIN RENDERER UPGRADED: Feature Toggles changed from simple 2-col grid to professional full-detail renderer:
    - Group 1 Core Services: mart/food/rides/pharmacy/parcel — each card shows affected apps, enforcement badge (✅ API Enforced), and red warning banner when OFF
    - Group 2 Account & Business: wallet/referral/new_users — wallet shows "API + Client", referral shows "📱 Client-Side", new_users shows "✅ API Enforced"
    - Global status banner: green "All services active" or red "X services disabled" at top
    - API Enforcement Summary table: 8 rows with feature name, seed key, enforcement type, live on/off status
  ICONS ADDED: UserPlus, Server (alongside existing icons)
  ALL 6 SERVICES: Running clean, zero TypeScript errors
  -->
<!-- Last updated: 2026-03-26 — CUSTOMER SETTINGS COMPLETE: Full-stack customer management — admin → API → customer app, zero loopholes.
  - New seeds: customer_referral_enabled (on), customer_loyalty_enabled (on), customer_signup_bonus (0)
  - TOGGLE_KEYS updated: customer_referral_enabled + customer_loyalty_enabled added
  - platform-config API: customer block added with 10 fields: walletMax, minTopup, minTransfer, referralEnabled, referralBonus, loyaltyEnabled, loyaltyPtsPerRs100, maxOrdersDay, signupBonus, p2pEnabled
  - Admin Customer Settings Renderer (5 groups):
    * Account Controls: maxOrdersDay + signupBonus + dual-limit info card showing security_max_daily_orders
    * Wallet Limits: minTopup, walletMax, minTransfer, p2p toggle, Wallet Limits Overview table (4 rows with live values and seed key references)
    * Referral Program: referralEnabled toggle, referralBonus (disabled when off), dynamic info card explaining flow
    * Loyalty Program: loyaltyEnabled toggle, loyaltyPts (disabled when off), Loyalty Simulation table (Rs.100/500/1000/2000/5000 → pts earned + est. value)
    * Cashback Settings: 3 category toggles (orders/rides/pharmacy), cashback %, Finance Settings cross-reference note, amber summary banner when active
  - API enforcement:
    * orders.ts: customer_max_orders_day always enforced before security block (separate daily count query)
    * wallet.ts topup: reads customer_min_topup first (fallback to wallet_min_topup), customer_wallet_max first (fallback to wallet_max_balance)
    * wallet.ts send: reads customer_min_withdrawal first (fallback to wallet_min_withdrawal), gates on wallet_p2p_enabled (403 when disabled)
  - Customer app PlatformConfigContext.tsx: customer block added (10 fields) with interface, DEFAULT, and parser
  - Customer app wallet.tsx: dynamic minTopup, walletMax, minTransfer; Send button hidden when p2pEnabled=false; modal info text uses live minTransfer value
  - Customer app profile.tsx: Referral card (purple, gift icon, shows referral code = last 8 chars of userId) shown when referralEnabled; Loyalty card (amber, star icon, shows pts/Rs.100 rate) shown when loyaltyEnabled; rc StyleSheet added
  -->
<!-- Last updated: 2026-03-26 — RIDER SETTINGS COMPLETE: Full-stack rider management — admin → API → rider app, zero loopholes.
  - New seeds: rider_auto_approve (off), rider_withdrawal_enabled (on), rider_max_payout (50000)
  - TOGGLE_KEYS updated: rider_auto_approve + rider_withdrawal_enabled added
  - platform-config API: rider block added with 8 fields: keepPct, bonusPerTrip, minPayout, maxPayout, maxDeliveries, cashAllowed, withdrawalEnabled, autoApprove
  - Admin Rider Settings: 5-group professional renderer — Onboarding (auto_approve + manual review card), Earnings & Compensation (keepPct + bonusPerTrip + live green/blue split visualizer with bonus preview), Payout Rules (min/max with min>max validation error), Operational Limits (maxDeliveries + acceptanceKm + API enforcement note), Feature Controls (cashAllowed toggle + withdrawalEnabled with danger state + amber warning), Earnings Simulation Table (Rs.50/80/100/150/200 delivery fees showing rider earnings + bonus + total)
  - API enforcement in rider.ts:
    * POST /rider/orders/:id/accept: checks active order+ride count vs rider_max_deliveries (429 if limit hit)
    * POST /rider/rides/:id/accept: same max deliveries check
    * PATCH /rider/orders/:id/status (delivered): applies rider_bonus_per_trip as separate "bonus" wallet transaction
    * PATCH /rider/rides/:id/status (completed): same bonus per trip
    * POST /rider/wallet/withdraw: checks rider_withdrawal_enabled (403), uses dynamic rider_min_payout + rider_max_payout (no hardcoded 500 anymore)
  - rider-app/useConfig.ts: rider? block added to interface and used with optional chaining throughout
  - rider-app/Wallet.tsx: uses config.rider?.keepPct, minPayout, maxPayout, withdrawalEnabled; shows "🔒 Withdrawals Paused" when disabled; red disabled banner; maxPayout limit shown in modal; modal validates both min and max; info card shows range
  - rider-app/Home.tsx: shows amber notice when config.rider?.cashAllowed === false
  -->
<!-- Last updated: 2026-03-26 — VENDOR SETTINGS COMPLETE: Full-stack vendor management system — admin → API → vendor app, no loopholes.
  - New seeds: vendor_promo_enabled (on), vendor_withdrawal_enabled (on), vendor_min_payout (500), vendor_max_payout (50000)
  - platform-config API: vendor block added with 9 fields: commissionPct, settleDays, minPayout, maxPayout, minOrder, maxItems, autoApprove, promoEnabled, withdrawalEnabled
  - Admin Vendor Settings: Professional 5-group renderer — Onboarding (auto_approve toggle + context banner), Commission & Revenue (commission_pct + settlement_days + live split visualizer bar), Payout Rules (min/max payout with validation warning), Store Rules (min_order + max_items with API enforcement note), Feature Controls (promo_enabled + withdrawal_enabled toggles with danger state), Earnings Summary table (Rs.500/1000/2000/5000 scenarios live)
  - API enforcement in vendor.ts: POST /products checks product count vs vendor_max_items; POST /products/bulk same + tells vendor how many slots left; POST /promos checks vendor_promo_enabled and returns 403 if disabled; POST /wallet/withdraw checks vendor_withdrawal_enabled (403), vendor_min_payout, vendor_max_payout (all dynamic from settings, no hardcoded values)
  - vendor-app/useConfig.ts: vendor block added to interface, DEFAULT_CONFIG, and API parse
  - vendor-app/Wallet.tsx: uses config.vendor.minPayout + maxPayout + withdrawalEnabled; shows "Withdrawals Paused" button when disabled; shows red disabled banner; WithdrawModal validates against both min and max; settlement info shows both limits
  - vendor-app/Store.tsx: uses config.vendor.promoEnabled; shows locked notice when disabled; promos tab entirely hidden behind promoEnabled flag
  -->
<!-- Last updated: 2026-03-26 — DELIVERY CHARGES COMPLETE: Full-stack delivery fee wiring across admin, API, customer app, vendor app, rider app. No hardcoded values, no loopholes.
  - New seeds: delivery_parcel_per_kg (Rs.40), delivery_free_enabled (on/off toggle)
  - platform-config API: deliveryFee block now has 7 fields: mart, food, pharmacy, parcel, parcelPerKg, freeEnabled, freeDeliveryAbove
  - Admin Delivery Settings: Professional 3-group renderer — Per-Service Fees (5 fields with emojis+hints), Free Delivery Rules (toggle + conditional threshold), Live Checkout Preview (dynamic table showing fee by cart amount for all 3 types + parcel pricing examples)
  - Customer cart: Now uses all 4 fee types (mart/food/pharmacy/parcel) by cartType; respects freeEnabled toggle; no hardcoded fees
  - Customer parcel: Hardcoded Rs.40/kg → config.deliveryFee.parcelPerKg; UI also updates
  - Vendor orders: Expanded order detail now shows Delivery Fee chip (by order type) + rider earnings breakdown
  - Rider home: Delivery earnings now = (deliveryFee[o.type] × riderEarningPct%) instead of wrong (o.total × riderEarningPct%) — much more accurate
  - All 3 useConfig.ts / PlatformConfigContext.tsx: deliveryFee block added to interface, DEFAULT, and API parse
  -->
<!-- Previous: CONTENT WIRING COMPLETE: All admin Content settings fully propagate to all 3 client apps with no loopholes or hardcoded values.
  - Admin Content section: 4 professional groups — Feature Switches (showBanner, chat, liveTracking, reviews), App Messaging (banner, announcement, maintenanceMsg, supportMsg), Role-Specific Notices (vendorNotice, riderNotice), Legal & Policy Links (tnc, privacy, refund, faq, about).
  - Customer home: showBanner toggle gates BannerCarousel; contentBanner shows as promo ribbon below service pills.
  - Vendor dashboard: vendorNotice shows as dismissable banner; commission % is now dynamic from config (not hardcoded 85%).
  - Rider home: riderNotice shows as dismissable banner inside stats card area.
  - All 3 profile pages: refundPolicyUrl, faqUrl, aboutUrl added as tappable rows / footer links (hidden when empty).
  - Previous: General Settings (appTagline, appVersion, supportEmail, supportHours, businessAddress, socialFacebook, socialInstagram) all wired. app_status is live/maintenance toggle. Vendor login footer uses dynamic commission % and businessAddress. -->
<!-- Previous: Content Settings fully wired: all 9 content fields (6 text + 3 feature toggles) now propagate admin → API → all 3 apps with no loopholes. Customer profile support section fixed (phone dialer + WhatsApp). Admin Content section upgraded with textarea, char counters, app coverage hints. -->

## Project Overview

**AJKMart** is a full-stack "Super App" combining Grocery Shopping (Mart), Food Delivery, Taxi/Bike Booking, Pharmacy, and Parcel Delivery with a unified digital wallet. Built for Azad Jammu & Kashmir (AJK), Pakistan.

### Artifacts
- **`artifacts/ajkmart`** — Expo React Native mobile app (web-compatible via Expo Go) → customer-facing
- **`artifacts/api-server`** — Express 5 REST API backend
- **`artifacts/admin`** — React-Vite Admin Dashboard (at `/admin/`)
- **`artifacts/rider-app`** — React-Vite mobile-first web app for riders (at `/rider/`, green theme 🏍️)
- **`artifacts/vendor-app`** — React-Vite mobile-first web app for vendors (at `/vendor/`, orange theme 🏪)

### User Roles
- `customer` — shops, orders food, books rides (uses Expo app)
- `rider` — delivery/taxi driver (uses Rider Portal at `/rider/`)
- `vendor` — store owner (uses Vendor Portal at `/vendor/`)

### Rider App Key Info
- Auth: phone OTP → token stored in `localStorage` as `rider_token`
- Token format: `Buffer.from(userId:phone:timestamp).toString("base64")`
- Rider earns `rider_keep_pct`% (default 80%) of each order/ride total — from platform settings
- API routes: `/api/rider/*` (auth middleware checks `roles` includes "rider")
- Pages: Login, Home (online toggle), Active delivery, History, Earnings, Profile

### Vendor App Key Info
- Auth: phone OTP → token stored in `localStorage` as `vendor_token`
- Vendor earns `100% - vendor_commission_pct`% of revenue (default 15% platform fee) — from platform settings
- API routes: `/api/vendor/*` (auth middleware checks `roles` includes "vendor")
- Pages: Login, Dashboard, Orders, Products (CRUD + enhanced bulk add with description/image/paste support), Wallet (balance, history, withdrawal modal), Analytics (revenue/order charts, top products), Store (banner, hours, announcement, promos), Notifications, Profile (quick links, security)
- BottomNav: 5 tabs — Dashboard, Orders, Products, Wallet, Account
- SideNav (desktop): Dashboard, Orders, Products, Wallet, Analytics, My Store, Account + notification badge
- Promo codes: vendor-scoped, created and managed per vendor
- Wallet: transaction history (credits/debits), secure withdrawal request modal (min Rs. 500, bank/EasyPaisa/JazzCash, admin processes in 24-48h)
- Analytics: daily revenue + orders bar charts, KPIs (revenue, orders, avg order value, completion rate), top products, order status breakdown, performance tips
- Notifications: in-app notification list with unread count, mark all read
- Bulk Add Products: improved with description + image URL fields, default category selector, paste-from-spreadsheet parser (tab/comma separated), mobile card view, desktop table view, inline validation, row count summary
- Store fields: storeBanner, storeDescription, storeHours (JSON, per-day), storeAnnouncement, storeMinOrder, storeDeliveryTime, storeIsOpen
- Product fields: stock (inventory tracking), updatedAt

---

## Tech Stack

- **Monorepo**: pnpm workspaces (TypeScript composite projects)
- **Frontend**: Expo React Native + NativeWind, Blue/White theme
- **Backend**: Express 5 + PostgreSQL + Drizzle ORM
- **Auth**: Phone number + OTP (dev mode returns OTP in response)
- **API**: OpenAPI 3.1 → Orval codegen → React Query hooks + Zod schemas
- **State**: AuthContext + CartContext (AsyncStorage persistence)
- **Navigation**: expo-router file-based routing with native tabs

---

## Theme & Design

- Primary: `#1A56DB` (blue)
- Accent: `#F59E0B` (amber)
- Success: `#10B981` (green)
- Font: Inter (400, 500, 600, 700)

---

## Structure

```
artifacts/
├── ajkmart/             # Expo mobile app
│   ├── app/
│   │   ├── index.tsx           # Root redirect (auth or tabs)
│   │   ├── _layout.tsx         # Root stack layout + providers
│   │   ├── auth/index.tsx      # Phone + OTP auth screen
│   │   ├── mart/index.tsx      # Grocery shopping screen
│   │   ├── food/index.tsx      # Food delivery screen
│   │   ├── ride/index.tsx      # Bike/car booking screen
│   │   ├── pharmacy/index.tsx  # On-demand pharmacy (medicine ordering)
│   │   ├── parcel/index.tsx    # Parcel delivery booking (4-step flow)
│   │   ├── cart/index.tsx      # Cart + checkout
│   │   └── (tabs)/
│   │       ├── _layout.tsx     # Tab navigation (Liquid Glass / Classic)
│   │       ├── index.tsx       # Home dashboard
│   │       ├── orders.tsx      # Order history
│   │       ├── wallet.tsx      # AJKMart Wallet
│   │       └── profile.tsx     # User profile (role-aware)
│   ├── context/
│   │   ├── AuthContext.tsx     # Auth state + OTP flow
│   │   └── CartContext.tsx     # Cart state + AsyncStorage
│   └── constants/colors.ts    # Blue/white theme tokens
│
└── api-server/          # Express REST API
    └── src/routes/
        ├── auth.ts         # POST /auth/send-otp, /auth/verify-otp
        ├── products.ts     # GET /products (filter by type/category/search)
        ├── orders.ts       # GET/POST /orders
        ├── wallet.ts       # GET /wallet/:userId, POST /wallet/topup
        ├── rides.ts        # POST /rides/estimate, POST /rides, GET /rides/:id
        ├── locations.ts    # Location tracking
        └── categories.ts  # GET /categories (mart/food)

lib/
├── db/src/schema/         # Drizzle schemas: users, products, orders,
│                          #   wallet_transactions, rides, live_locations
├── api-spec/openapi.yaml  # OpenAPI 3.1 spec for all endpoints
├── api-client-react/      # Generated React Query hooks + fetch client
└── api-zod/               # Generated Zod schemas

scripts/src/
└── seed.ts                # Seeds 20 demo products (12 mart + 8 food)
```

---

## Key API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/send-otp` | Send OTP (returns OTP in dev) |
| POST | `/api/auth/verify-otp` | Verify OTP, returns token + user |
| GET | `/api/products?type=mart&category=&search=` | List products |
| GET | `/api/categories?type=mart` | List categories |
| GET | `/api/orders?userId=` | User orders |
| POST | `/api/orders` | Place order |
| GET | `/api/wallet/:userId` | Wallet balance + transactions |
| POST | `/api/wallet/topup` | Add funds to wallet |
| POST | `/api/rides/estimate` | Fare estimate (distance/fare/duration) |
| POST | `/api/rides` | Book a ride |

---

## Ride Fare Formula
- **Bike**: Rs. 15 base + Rs. 8/km
- **Car**: Rs. 25 base + Rs. 12/km

---

## Running Locally

```bash
# API server (port from $PORT, default 8080)
pnpm --filter @workspace/api-server run dev

# Expo app (web preview via Expo)
pnpm --filter @workspace/ajkmart run dev

# Seed demo products
pnpm --filter @workspace/scripts run seed

# Push DB schema changes
pnpm --filter @workspace/db run push

# Regenerate API client (after changing openapi.yaml)
pnpm --filter @workspace/api-spec run codegen
```

---

## Root Scripts

- `pnpm run build` — typecheck then build all packages
- `pnpm run typecheck` — `tsc --build --emitDeclarationOnly`

---

## Packages

### `lib/db` (`@workspace/db`)
Drizzle ORM + PostgreSQL. Exports `db` client and schema tables. Schema includes: `usersTable`, `productsTable`, `ordersTable`, `walletTransactionsTable`, `ridesTable`, `liveLocationsTable`.

### `lib/api-spec` (`@workspace/api-spec`)
OpenAPI 3.1 spec (`openapi.yaml`) + Orval codegen config. Run `pnpm --filter @workspace/api-spec run codegen` to regenerate client.

### `lib/api-client-react` (`@workspace/api-client-react`)
Generated React Query hooks (e.g. `useGetProducts`, `useGetWallet`) and raw fetch functions (e.g. `estimateFare`, `bookRide`, `topUpWallet`). Also exports `setBaseUrl` for configuring the API base URL.

### `lib/api-zod` (`@workspace/api-zod`)
Generated Zod schemas from OpenAPI spec used in the API server for validation.

### `scripts` (`@workspace/scripts`)
Utility scripts. Run via `pnpm --filter @workspace/scripts run <script>`. Current scripts:
- `seed` — seeds demo products and food items
