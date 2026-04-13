import type { CapacitorConfig } from "@capacitor/cli";

/*
 * Capacitor configuration for AJKMart Rider Android APK.
 *
 * APK build sequence:
 *   1. pnpm --filter @workspace/rider-app build:cap   — Vite build with BASE_PATH=/
 *   2. pnpm --filter @workspace/rider-app cap:sync    — sync web assets to Android project
 *   3. Open android/ in Android Studio and generate the signed APK
 *
 * Set VITE_API_BASE_URL (e.g. https://api.ajkmart.com) in the .env.capacitor
 * file or as a CI environment variable before running build:cap so REST calls
 * and the socket.io connection resolve correctly inside the native WebView.
 */
const config: CapacitorConfig = {
  appId: "com.ajkmart.rider",
  appName: "AJKMart Rider",
  webDir: "dist/public",
  server: {
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: "#ffffff",
      showSpinner: false,
    },
  },
};

export default config;
