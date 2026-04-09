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
- **Socket.io:** Real-time communication for live tracking, notifications, wallet updates, and SOS alerts.

**Database Schema Highlights:**
- Key tables: `usersTable`, `magicLinkTokensTable`, `productsTable`, `ordersTable`, `walletTransactionsTable`, `ridesTable`, `rideBidsTable`, `liveLocationsTable`, `rideRatingsTable`, `riderPenaltiesTable`, `popularLocationsTable`, `schoolRoutesTable`, `schoolSubscriptionsTable`, `productVariantsTable`, `bannersTable`, `userInteractionsTable`, `delivery_whitelist`, `delivery_access_requests`, `system_audit_log`, `categories`, `kyc_verifications`, `location_logs`, `vanRoutesTable`, `vanVehiclesTable`, `vanSchedulesTable`, `vanBookingsTable`.

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