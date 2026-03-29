# AJKMart Super App — Workspace

### Overview
AJKMart is a full-stack "Super App" designed for Azad Jammu & Kashmir (AJK), Pakistan. It integrates multiple services including Grocery Shopping (Mart), Food Delivery, Taxi/Bike Booking (Rides), Pharmacy, and Parcel Delivery, all unified by a digital wallet. The project aims to provide a comprehensive, localized service platform for the region.

### User Preferences
- I want iterative development.
- Ask before making major changes.
- Do not make changes to folder `artifacts/ajkmart`.
- Do not make changes to file `artifacts/api-server/src/routes/auth.ts`.
- Prefer clear and concise explanations.

### System Architecture

**Monorepo and Core Technologies:**
The project is structured as a pnpm monorepo using TypeScript. The frontend leverages Expo React Native with NativeWind for mobile applications, while the backend is an Express 5 REST API utilizing PostgreSQL and Drizzle ORM. Authentication is primarily phone number and OTP-based. API interactions are defined using OpenAPI 3.1, with Orval codegen generating React Query hooks and Zod schemas for validation. State management uses `AuthContext` and `CartContext` with AsyncStorage for persistence, and navigation is handled by `expo-router`.

**UI/UX and Theming:**
- **Color Scheme:** Primary blue (`#1A56DB`), accent amber (`#F59E0B`), and success green (`#10B981`).
- **Font:** Inter (400, 500, 600, 700). Noto Nastaliq Urdu (400, 500, 600, 700) for Urdu RTL text.
- **i18n:** Multi-language support via `@workspace/i18n` shared library. Supports 5 language modes: English, Urdu, Roman Urdu, English+Roman Urdu (dual), English+Urdu (dual). Uses `tDual()` for dual-line translations and `t()` for single-line. RTL support via `isRTL()`. All user-facing strings across all 3 client apps use translation keys. Nastaliq font loaded via Google Fonts CDN (web) and `@expo-google-fonts/noto-nastaliq-urdu` (mobile).
- **Application Structure:**
    - **Customer App (Expo React Native):** Features include grocery, food delivery, ride booking, pharmacy, parcel delivery, cart, checkout, order history, digital wallet, and user profile. Full auth system with 7 login methods (Phone OTP, Email OTP, Username/Password, Google, Facebook, Magic Link, Biometric) gated by admin platform config toggles. Includes 4-step registration, forgot/reset password with 2FA, 2FA setup/disable in profile, deep link handling for magic links. Auth screens: `app/auth/index.tsx` (login), `app/auth/register.tsx` (register), `app/auth/forgot-password.tsx` (reset). Auth context (`context/AuthContext.tsx`) manages 2FA pending state, biometric credentials via expo-secure-store, and proactive token refresh. Packages: expo-local-authentication, expo-secure-store, expo-auth-session.
    - **Admin Dashboard (React-Vite):** Provides comprehensive management for users, vendors, riders, services, system configurations (delivery fees, feature toggles, loyalty programs, payout rules), and content. It includes professional renderers for settings management with live previews and validation.
    - **Rider App (React-Vite):** Mobile-first web app for drivers using the **Dark Hero Design System** across ALL pages — auth (Login, Register, ForgotPassword), main (Home, Active, Notifications, Profile, Wallet, Earnings, History), settings (SecuritySettings), utility (NotFound, MaintenanceScreen). Design tokens: `bg-[#F5F6F8]` page bg, dark gradient hero `from-gray-900 via-gray-900 to-gray-800` with `rounded-b-[2rem]`, frosted glass stat chips `bg-white/[0.06] backdrop-blur-sm`, `rounded-3xl` content cards, pill filter tabs `rounded-full bg-gray-900` active, `bg-gray-900` primary buttons, decorative circles (`bg-green-500/[0.04]`, `bg-white/[0.02]`). Auth pages use full-screen dark gradient with centered white card. BottomNav uses `bg-gray-900/10` active pill + `bg-gray-900` indicator bar. AnnouncementBar uses `bg-gray-900`. **Language hardcoded to English** (`useLanguage.ts` returns `"en"` always; profile language picker removed). Professionally redesigned Home, Active, Profile, Notifications, Wallet, Earnings, and History pages. Home: skeleton loading, time-based greeting, wallet card, premium toggle, gradient stats, request cards with gradient icons, typed toasts, press animations, ID-based new-request detection. Active: enhanced elapsed timer with progress bar, order-type-specific gradient headers (food=orange/red, mart=blue/indigo, parcel=teal/cyan), ride cards with violet/purple gradient, premium step progress with ring indicators and animated progress bars, gradient nav/call buttons, enhanced proof-of-delivery with overlay, glassmorphism cancel modal, gradient action buttons with press animations. Notifications: premium header with animated ping unread indicator, glassmorphism stat cards with staggered animations, enhanced filter tabs with gradient active state, individual notification cards with gradient icon backgrounds and unread dot indicators, enhanced empty state with View All CTA, "mark all read" success toast. All pages share: robust toast system with timer ref cleanup, gradient button design language, decorative background circles. Also includes: circular profile completion indicator, stats grid, date-grouped transactions and notifications, individual notification mark-as-read (PATCH /rider/notifications/:id/read), 7-day earnings chart, COD remittance tracking, pending withdrawal request cards with status badges, achievements system, and error-handled mutations. Full auth system with Login (Phone OTP, Email OTP, Username/Password, Google, Facebook, Magic Link, Biometric) and 4-step Registration (Personal Info with optional username → Vehicle & Documents → Security Setup → Verification). "Back to Login" link visible on all registration steps. Email OTP fallback on phone OTP step (if SMS fails). 2FA setup/disable in Profile security section (QR via backend data URL, manual key, backup codes). Uses Wouter routing, TanStack Query, Tailwind CSS, and Lucide icons. Features include online/offline toggles, active deliveries/rides, history, earnings, and wallet. **Rider App Modules** are admin-controlled via platform settings (`rider_module_wallet`, `rider_module_earnings`, `rider_module_history`, `rider_module_2fa_required`, `rider_module_gps_tracking`, `rider_module_profile_edit`, `rider_module_support_chat`); disabled modules hide routes and nav items. `getRiderModules()` helper in `useConfig.ts` provides typed access. It enforces max deliveries and manages withdrawal requests based on platform settings.
    - **Vendor App (React-Vite):** Mobile-first web app for store owners with an orange theme. Features include dashboard, order management, product CRUD (including bulk adds), wallet, analytics, store configuration (banner, hours, announcements, promos), and notifications. It enforces max product limits and manages withdrawals.

**Key Features and Implementations:**
- **Authentication:** JWT-based authentication across all user roles (customer, rider, vendor). Supports multiple login methods including Phone OTP, Email OTP, Username/Password, Email Registration (with verification email via nodemailer/SMTP), Google Social Login, Facebook Social Login, and Passwordless Magic Links. Includes role-specific registration (customer/rider/vendor) with CNIC validation, password strength rules, reCAPTCHA v3 middleware (fail-closed), OTP-based password reset with email delivery, TOTP-based 2FA (RFC 6238) with backup codes, trusted device fingerprinting (30-day expiry), and admin force-disable 2FA. TOTP secrets encrypted at rest via AES-256-GCM. Magic link tokens are hashed and single-use with 15-min expiry. Per-role auth toggle enforcement via platform_settings (JSON format: `{"customer":"on","rider":"on","vendor":"on"}`). All auth toggle checks use `isAuthMethodEnabled()` for consistent parsing. User approval workflows for riders and vendors managed via the admin panel.
- **Dynamic Platform Settings:** Almost all operational parameters (delivery fees, commission rates, minimum order values, withdrawal limits, feature toggles, loyalty points, cashback, etc.) are centrally managed via the Admin Dashboard and dynamically enforced across the API and client applications.
- **Order and Delivery Management:** Comprehensive order processing, including fare calculation (dynamic based on service type and distance), delivery fee application (mart, food, pharmacy, parcel), GST calculation, and cashback/loyalty point integration. Supports scheduled orders and cancellation windows.
- **Digital Wallet:** Functionality for top-ups, transfers (P2P), withdrawals for riders and vendors, and tracking of transactions (e.g., earnings, bonuses, loyalty points, cashback). Wallet limits and withdrawal availability are dynamically configured.
- **Ride Bargaining (Mol-Tol System):** An advanced bidding system for rides where customers can offer a fare, and multiple riders can submit bids. Customers can accept bids live, leading to dynamic fare negotiation.
- **Product Management:** Vendors can manage products, including bulk additions with image and description support, inventory tracking, and category assignments.
- **Notifications:** In-app notification systems for various events across all applications.
- **Location Services:** Integration with mapping services for autocomplete, geocoding, distance matrix calculations, and real-time location tracking for rides/deliveries.
- **Security:** Implementation of signed JWTs for authentication, input validation using Zod schemas, and role-based access control for API endpoints. Admin endpoints use a separate `ADMIN_JWT_SECRET` (required env var, server will not start without it). Server-side price verification on order placement. Deposit TxID duplicate protection with normalized case-insensitive matching. OTP bypass is hard-disabled in production (`NODE_ENV=production`). TOTP secrets encrypted at rest using AES-256-GCM (key derived from `TOTP_ENCRYPTION_KEY` or `JWT_SECRET`). Email delivery via nodemailer (SMTP configured via `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` env vars).

**Database Schema Highlights:**
- `usersTable`: Stores user details, including auth-related fields (nationalId, googleId, facebookId, totpSecret, totpEnabled, backupCodes, trustedDevices, biometricEnabled), rider fields (vehicleRegNo, drivingLicense), vendor fields (businessName, storeAddress, ntn), approval status, and roles.
- `magicLinkTokensTable`: Stores magic link tokens for passwordless login (id, userId, tokenHash unique, expiresAt, usedAt, createdAt).
- `productsTable`, `ordersTable`: Core commerce data.
- `walletTransactionsTable`: Records all financial movements within the digital wallet.
- `ridesTable`, `rideBidsTable`, `liveLocationsTable`: For ride-hailing and tracking.
- `popularLocationsTable`: Admin-managed points of interest for quick selection.
- `schoolRoutesTable`, `schoolSubscriptionsTable`: For managing school transport services.

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
- **AsyncStorage:** For client-side data persistence in React Native (including pre-login language preference).
- **jsonwebtoken:** For JWT generation and verification.
- **crypto.scryptSync:** For password hashing.
- **react-native-qrcode-svg:** For generating real QR codes in the wallet Receive Money modal.

### Customer App Full-Stack Overhaul (Task #5)
1. **Pre-login Language Selector:** English/Urdu/Mixed toggle on auth screen. Language persists in AsyncStorage before login, syncs to server after login. RTL support for Urdu via `I18nManager.forceRTL`. LanguageProvider wraps AuthProvider in `_layout.tsx`.
2. **Robust Session Management:** `custom-fetch` retries network errors and 5xx with exponential backoff (up to 3 retries). Proactive token refresh 60s before JWT expiry via `scheduleProactiveRefresh` in AuthContext. Only forced logout on genuine 401 after refresh token failure.
3. **P2P Topup with Admin Approval:** New `/api/wallet/p2p-topup` endpoint creates pending deposit with `paymentMethod: "p2p"`. Admin approves via existing DepositRequests page. Wallet screen shows "P2P Topup" button and pending topup count banner.
4. **QR/Barcode Payment:** Real QR code generation in Receive Money modal using `react-native-qrcode-svg` (encodes phone, ID, name as JSON). Decoded QR data pre-fills Send Money form.
5. **Admin Settings Enforcement:** Maintenance mode overlay in `_layout.tsx`. Service toggles on home screen already enforced. Cart uses `PlatformConfigContext` for delivery fees instead of redundant API fetch. Pharmacy checkout enforces COD limit from `orderRules.maxCodAmount` and auto-switches to wallet when exceeded. Wallet feature toggle controls wallet payment option visibility.
6. **Audit & Bug Fixes:** Eliminated redundant platform-config API fetch in cart checkout (now uses context). Consistent error handling across screens.
7. **Dynamic Service Visibility:** Disabled services are completely hidden (not greyed out) from the home screen. Service grid dynamically reflows with 2-up rows or full-width single cards. Quick pills and banners filtered by service flags. Empty state shown when all 5 core services are disabled. Deep-link protection via `withServiceGuard` HOC (`components/ServiceGuard.tsx`) — wraps each service screen's default export so the inner component never mounts (no hooks/effects fire) when the service is disabled, showing a "Service Unavailable" screen with back button and home link. Applied to all 5 service screens: mart, food, ride, pharmacy, parcel.
- **Mapping APIs:** Google Maps Platform (or similar) for autocomplete, geocoding, and distance calculations (gated by `maps_places_autocomplete`, `maps_geocoding`, `maps_distance_matrix` settings).
- **Sentry:** For error tracking and performance monitoring (configured via `sentry_dsn`, `sentry_env`, etc.).
- **Analytics Platform:** For tracking user behavior (configured via `analytics_platform`, `tracking_id`).