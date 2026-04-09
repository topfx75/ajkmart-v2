import http from "http";
import cron from "node-cron";
import app from "./app";
import { logger } from "./lib/logger";
import { startDispatchEngine, dispatchScheduledRides } from "./routes/rides.js";
import { migrateAdminSecrets } from "./services/adminSecretMigration.js";
import { initSocketIO } from "./lib/socketio.js";
import { ensureAuthMethodColumn, ensureRideBidsMigration, ensureOrdersGpsColumns, ensureIdempotencyTable, ensureWalletNormalizedTxId, ensureDefaultServiceZones, ensureDefaultPaymentMethods, ensureOtpSettings } from "./routes/admin.js";
import { initVapid } from "./lib/webpush.js";
import { db } from "@workspace/db";
import { getPlatformSettings } from "./routes/admin.js";
import { locationLogsTable, pendingOtpsTable } from "@workspace/db/schema";
import { lt } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = http.createServer(app);
initSocketIO(httpServer);
initVapid();

/* ── Cron: dispatch scheduled rides every minute ── */
cron.schedule("* * * * *", async () => {
  await dispatchScheduledRides();
}, { timezone: "Asia/Karachi" });

/* ── Cron: cleanup jobs (runs at midnight) ── */
cron.schedule("0 0 * * *", async () => {
  /* location_logs older than 30 days */
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await db.delete(locationLogsTable).where(lt(locationLogsTable.createdAt, cutoff));
    logger.info({ cutoff, result }, "[cron] location_logs cleanup complete");
  } catch (e) {
    logger.error({ err: e }, "[cron] location_logs cleanup failed");
  }
  /* pending_otps expired (phantom registration prevention) */
  try {
    const result = await db.delete(pendingOtpsTable).where(lt(pendingOtpsTable.otpExpiry, new Date()));
    logger.info({ result }, "[cron] pending_otps cleanup complete");
  } catch (e) {
    logger.error({ err: e }, "[cron] pending_otps cleanup failed");
  }
}, { timezone: "Asia/Karachi" });

async function assertSecureSettings() {
  const settings = await getPlatformSettings();
  if (settings["security_otp_bypass"] === "on") {
    logger.fatal("SECURITY: security_otp_bypass is enabled. OTP bypass has been removed; this setting no longer has any effect but must be disabled. Refusing to start.");
    process.exit(1);
  }
}

let _listenAttempt = 0;
const MAX_LISTEN_ATTEMPTS = 5;
const LISTEN_BASE_DELAY_MS = 1000;

function startListening(): void {
  _listenAttempt++;
  httpServer.listen({ port, exclusive: false }, () => {
    logger.info({ port }, "Server listening");
    startDispatchEngine();
    migrateAdminSecrets().catch(e => logger.error({ err: e }, "Admin secret migration failed"));
  });
}

httpServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE" && _listenAttempt < MAX_LISTEN_ATTEMPTS) {
    const delay = LISTEN_BASE_DELAY_MS * Math.pow(2, _listenAttempt - 1);
    logger.warn({ port, attempt: _listenAttempt, nextAttempt: _listenAttempt + 1, delayMs: delay }, "Port in use — retrying with exponential back-off");
    httpServer.close();
    setTimeout(() => startListening(), delay);
  } else {
    logger.error({ err, attempts: _listenAttempt }, "Fatal: could not bind to port after maximum retries");
    process.exit(1);
  }
});

ensureAuthMethodColumn()
  .then(() => ensureRideBidsMigration())
  .then(() => ensureOrdersGpsColumns())
  .then(() => ensureIdempotencyTable())
  .then(() => ensureWalletNormalizedTxId())
  .then(() => ensureDefaultServiceZones())
  .then(() => ensureDefaultPaymentMethods())
  .then(() => ensureOtpSettings())
  .then(() => assertSecureSettings())
  .then(() => startListening())
  .catch(e => {
    logger.error({ err: e }, "Failed to run startup migrations");
    process.exit(1);
  });
