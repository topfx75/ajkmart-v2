# AJKMart Super App

### Overview
AJKMart is a full-stack "Super App" for Azad Jammu & Kashmir (AJK), Pakistan, integrating diverse services like Grocery Shopping, Food Delivery, Taxi/Bike Booking, Pharmacy, and Parcel Delivery. It aims to provide a comprehensive, localized service platform unified by a digital wallet, enhancing daily life and commerce in the region.

### User Preferences
- I want iterative development.
- Ask before making major changes.
- Do not make changes to folder `artifacts/ajkmart`.
- Do not make changes to file `artifacts/api-server/src/routes/auth.ts`.
- Prefer clear and concise explanations.

### System Architecture

**Monorepo and Core Technologies:**
The project is a pnpm monorepo built with TypeScript. Frontend applications use Expo React Native (customer app) and React-Vite (admin, rider, vendor apps) with NativeWind. The backend is an Express 5 REST API using PostgreSQL and Drizzle ORM. Authentication is primarily phone number and OTP-based. API interactions are defined using OpenAPI 3.1, with Orval codegen generating React Query hooks and Zod schemas. State management relies on `AuthContext` and `CartContext` with AsyncStorage, and navigation is handled by `expo-router`.

**UI/UX and Theming:**
- **Color Scheme:** Primary blue (`#1A56DB`), accent amber (`#F59E0B`), and success green (`#10B981`). Rider app uses a "Dark Hero Design System."
- **Font:** Inter, with Noto Nastaliq Urdu for RTL text.
- **i18n:** Multi-language support (English, Urdu, Roman Urdu, and dual modes) with RTL support.
- **Application Structure:**
    - **Customer App (Expo React Native):** Features grocery, food delivery, ride booking, pharmacy, parcel delivery, digital wallet, and user profile. Includes a full auth system with seven login methods, a 5-step registration process, and deep link handling.
    - **Admin Dashboard (React-Vite):** Comprehensive management for users, vendors, riders, services, system configurations (delivery fees, feature toggles), and content.
    - **Rider App (React-Vite):** Mobile-first web app for drivers with a dark theme, including online/offline toggles, active deliveries/rides, history, earnings, and wallet. All modules are admin-controlled.
    - **Vendor App (React-Vite):** Mobile-first web app for store owners with an orange theme, featuring dashboard, order management, product CRUD, wallet, analytics, and store configuration.

**Key Features and Implementations:**
- **Authentication:** JWT-based, unified identity system (phone, email, username linked to one account). Supports multiple login methods (OTP, social, magic links, biometric) with role-specific registration, 2FA, and trusted device fingerprinting. Dynamic OTP routing (WhatsApp → SMS → Email). Dev OTP mode for testing. Account merging and linking.
- **Rating & Review System:** Full pipeline across all apps, including AI moderation using OpenAI's `gpt-5-mini`, vendor replies, admin moderation queues, and bulk export/import. Auto-suspension for low-rated riders/vendors.
- **Rider KYC Document Upload:** Mandatory document uploads (Vehicle Photo, CNIC Front/Back, Driving License Photo) during registration, with admin review and correction request features.
- **Dynamic Platform Settings:** Centralized management of operational parameters (fees, commissions, limits, feature toggles) via the Admin Dashboard, dynamically enforced across all applications.
- **Order and Delivery Management:** Comprehensive processing including dynamic fare/delivery fee calculation, GST, cashback/loyalty points, scheduled orders, and cancellation windows.
- **Digital Wallet:** Top-ups, P2P transfers, withdrawals, and transaction tracking. MPIN security with hide/unhide functionality and admin reset.
- **Ride Bargaining (Mol-Tol System):** Bidding system allowing customers to offer fares and riders to submit counter-bids. InDrive-style broadcast dispatch model to all nearby riders.
- **Product Management:** Vendor product CRUD, inventory tracking, and category assignments. Dynamic Categories System for database-driven category management.
- **Notifications:** In-app notifications for various events.
- **Location Services:** Integration with mapping services for autocomplete, geocoding, distance matrix, and real-time tracking. GPS Fraud-Stamp for orders.
- **Security:** Signed JWTs, Zod validation, role-based access control, server-side price verification, deposit transaction ID duplicate protection, and rate limiting.
- **Payment Provider Abstraction:** Centralized SDK for various payment gateways.
- **Product Variant System:** Support for product variants with SKU, price, stock, and attributes.
- **Wishlist & Image Gallery:** Wishlist functionality, multi-image carousels, and full-screen image viewers.
- **White Label Delivery Access Control:** Whitelisting system for vendors/users to control delivery eligibility, with admin management and vendor request workflows.
- **Scheduled Rides, Multi-Stop, Van Service & Pool Rides:** Support for scheduled rides, multiple stops per ride, a dedicated commercial van service, and ride-sharing/pool ride matching logic.
- **Pull-to-Refresh & UI Polish:** Consistent pull-to-refresh component across all apps, UI enhancements, and accessibility improvements (ARIA labels, keyboard navigation).
- **Socket.io:** Real-time communication for live tracking, notifications, wallet updates, SOS alerts, and in-app ride chat.
- **In-App Ride Chat:** Customer↔rider messaging during active rides via `ride_messages` table and Socket.io `ride:message` events. Chat bottom sheet in customer RideTracker, chat modal in rider Active page.
- **Saved Address Coordinates:** `lat`/`lng` decimal columns on `saved_addresses` table. Addresses with coordinates appear as quick-select chips in ride booking.

**Database Schema Highlights:**
- Key tables: `usersTable`, `magicLinkTokensTable`, `productsTable`, `ordersTable`, `walletTransactionsTable`, `ridesTable`, `rideBidsTable`, `liveLocationsTable`, `rideRatingsTable`, `riderPenaltiesTable`, `popularLocationsTable`, `schoolRoutesTable`, `schoolSubscriptionsTable`, `productVariantsTable`, `bannersTable`, `userInteractionsTable`, `delivery_whitelist`, `delivery_access_requests`, `system_audit_log`, `categories`, `kyc_verifications`, `location_logs`, `vanRoutesTable`, `vanVehiclesTable`, `vanSchedulesTable`, `vanBookingsTable`, `rideMessagesTable`.

### External Dependencies

- **PostgreSQL:** Primary relational database.
- **Drizzle ORM:** Object-Relational Mapper.
- **Express 5:** Backend web framework.
- **Expo React Native:** Customer mobile application framework.
- **React-Vite:** Admin, Rider, and Vendor web application framework.
- **NativeWind:** Utility-first CSS for React Native.
- **OpenAPI 3.1 & Orval codegen:** API specification and client generation.
- **React Query:** Data fetching and caching.
- **Zod:** Schema validation.
- **AsyncStorage:** Client-side data persistence (non-sensitive).
- **expo-secure-store:** Encrypted storage for sensitive auth tokens.
- **jsonwebtoken:** JWT generation and verification.
- **crypto.scryptSync:** Password hashing.
- **react-native-qrcode-svg:** QR code generation for mobile.
- **OpenAI (via Replit proxy):** Content moderation for reviews.
- **Google Maps Platform (or similar):** Autocomplete, geocoding, distance calculations.
- **OSRM:** Public routing service for turn-by-turn directions.
- **Open-Meteo API:** Weather data for the customer app.
- **Sentry:** Error tracking and performance monitoring.
- **Analytics Platform:** User behavior tracking.
- **Socket.io:** Real-time bidirectional communication.

### Recent Bug Fixes (Auth & Registration)

1. **Customer App Refresh Loop (Task #3):** `custom-fetch.ts` passes `errorCode` as 3rd param; `AuthContext` handles `PROFILE_INCOMPLETE` via logout not suspension; `PlatformConfigContext` throttles AppState force-refresh to 10s minimum.
2. **Customer Registration `check-identifier` action:** `register.tsx` was blocking new users with `action !== "register"` check; API now returns `"send_phone_otp"` for all phones — fixed to accept both actions.
3. **Rider App `usernameStatus` idle block:** `validateStep1()` in `Register.tsx` was blocking Step 1 Next button when `usernameStatus === "idle"` — fixed to only block on `"checking"` (still running) and `"taken"` (duplicate).
4. **Vendor App BASE URL wrong:** `api.ts` was using `${import.meta.env.BASE_URL}/api` = `/vendor/api` which routed to the Vite dev server (returning HTML). Fixed to `/api` matching rider-app pattern.
5. **`verify-otp` cross-role guard blocks rider/vendor registration:** Guard was firing before `pending_otps` check, blocking any non-customer role from creating new users via `verify-otp`. Fixed to check `pending_otps.payload._source === "register"` first — if the OTP came from `/auth/register` flow, allow the role through; only block non-customers arriving via raw `send-otp` without registration payload.
6. **Rider photo uploads mandatory in UI:** Made optional (`Documents recommended but not required`) — backend was already not enforcing them.
7. **DB:** Added missing `cod_photo_url` and `cod_verified` columns to `orders` table (were causing 500 errors on `/api/admin/stats`).
8. **Web Session Persistence (`AuthContext.tsx`):** `expo-secure-store` on web is a no-op stub — all reads return `null`, clearing sessions on every reload. Fixed by platform-branching to `AsyncStorage` with a `@ajkmart_ws_` prefix on web; native SecureStore unchanged.

### Ride Module Bug Fixes

1. **ProgressiveImage crash in RideTracker:** `ProgressiveImage` component was referenced but never imported — replaced with native `Image` from react-native with type-safe string check on `riderPhoto`.
2. **Pickup location validation:** `canProceedFromLocation` in `RideBookingForm` only checked `dropObj`, allowing users to proceed without a resolved pickup — fixed to require both `pickupObj && dropObj`.
3. **Maps API URL undefined:** `useMaps.ts` constructed `https://undefined/api/maps` when `EXPO_PUBLIC_DOMAIN` was unset — now falls back to `API_BASE` from `utils/api.ts`.
4. **NegotiationScreen skeleton delay:** Reduced init timeout from 3.5s to 1.5s with early dismissal when bids arrive.

### Development Notes

**Dev-only Hash Auth (`_layout.tsx`):**  
`_layout.tsx` includes a URL hash token injection block gated with `if (typeof window !== "undefined" && __DEV__)`. It reads `#_da=TOKEN|REFRESH|USER_JSON` from the URL on first load, writes the auth credentials to `localStorage`, and clears the hash — enabling developer tools (screenshots, E2E runners) to pre-seed auth state without a login UI interaction. This block compiles out entirely in production Expo builds (`__DEV__ = false`). It should remain strictly for local/dev usage and never be used as a production auth bypass.