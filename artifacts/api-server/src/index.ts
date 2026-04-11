import http from "http";
import cron from "node-cron";
import app from "./app";
import { logger } from "./lib/logger";
import { startDispatchEngine, dispatchScheduledRides } from "./routes/rides.js";
import { migrateAdminSecrets } from "./services/adminSecretMigration.js";
import { initSocketIO } from "./lib/socketio.js";
import { ensureAuthMethodColumn, ensureRideBidsMigration, ensureOrdersGpsColumns, ensureIdempotencyTable, ensureWalletNormalizedTxId, ensureTwoFactorEnforcedAt, ensureSilenceModeColumns, ensureDefaultServiceZones, ensureDefaultPaymentMethods, ensureOtpSettings, ensureProfileCompleteColumn, ensureOrdersItemsNullable } from "./routes/admin.js";
import { initVapid } from "./lib/webpush.js";
import { db } from "@workspace/db";
import { getPlatformSettings } from "./routes/admin.js";
import { locationLogsTable, pendingOtpsTable, ordersTable, notificationsTable, usersTable, walletTransactionsTable } from "@workspace/db/schema";
import { lt, eq, and, lte, sql } from "drizzle-orm";
import { getIO } from "./lib/socketio.js";
import { generateId } from "./lib/id.js";

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

/* ── Cron: auto-cancel unaccepted pending orders every minute ── */
cron.schedule("* * * * *", async () => {
  try {
    const settings = await getPlatformSettings();
    const cancelMin = parseInt(settings["order_auto_cancel_min"] ?? "15");
    if (!cancelMin || cancelMin <= 0) return;

    const cutoff = new Date(Date.now() - cancelMin * 60 * 1000);
    const expired = await db
      .select({ id: ordersTable.id, userId: ordersTable.userId, paymentMethod: ordersTable.paymentMethod, total: ordersTable.total })
      .from(ordersTable)
      .where(and(eq(ordersTable.status, "pending"), lte(ordersTable.createdAt, cutoff)));

    if (!expired.length) return;

    const io = getIO();
    for (const order of expired) {
      await db.transaction(async (tx) => {
        await tx.update(ordersTable).set({ status: "cancelled", updatedAt: new Date() }).where(eq(ordersTable.id, order.id));
        if (order.paymentMethod === "wallet") {
          const refundAmt = parseFloat(order.total ?? "0");
          if (refundAmt > 0) {
            await tx.update(usersTable)
              .set({ walletBalance: sql`wallet_balance + ${refundAmt.toFixed(2)}` })
              .where(eq(usersTable.id, order.userId));
            await tx.insert(walletTransactionsTable).values({ id: generateId(), userId: order.userId, type: "credit", amount: refundAmt.toFixed(2), description: "Auto-refund: order cancelled (vendor did not accept)" });
          }
        }
        await tx.insert(notificationsTable).values({ id: generateId(), userId: order.userId, title: "Order Cancelled", body: "Your order was cancelled because no vendor accepted it in time. If paid, refund has been processed.", type: "order", icon: "close-circle-outline" });
      });
      if (io) {
        io.to(`user:${order.userId}`).emit("order:update", { id: order.id, status: "cancelled" });
      }
    }
    if (expired.length > 0) {
      logger.info({ count: expired.length }, "[cron] auto-cancelled unaccepted pending orders");
    }
  } catch (e) {
    logger.error({ err: e }, "[cron] auto-cancel pending orders failed");
  }
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
  .then(() => ensureTwoFactorEnforcedAt())
  .then(() => ensureSilenceModeColumns())
  .then(() => ensureProfileCompleteColumn())
  .then(() => ensureOrdersItemsNullable())
  .then(() => ensureDefaultServiceZones())
  .then(() => ensureDefaultPaymentMethods())
  .then(() => ensureOtpSettings())
  .then(() => assertSecureSettings())
  .then(() => startListening())
  .catch(e => {
    logger.error({ err: e }, "Failed to run startup migrations");
    process.exit(1);
  });
