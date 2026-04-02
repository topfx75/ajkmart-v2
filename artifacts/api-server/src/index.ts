import http from "http";
import cron from "node-cron";
import app from "./app";
import { logger } from "./lib/logger";
import { startDispatchEngine } from "./routes/rides.js";
import { migrateAdminSecrets } from "./services/adminSecretMigration.js";
import { initSocketIO } from "./lib/socketio.js";
import { ensureAuthMethodColumn } from "./routes/admin.js";
import { initVapid } from "./lib/webpush.js";
import { db } from "@workspace/db";
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

ensureAuthMethodColumn()
  .then(() => {
    httpServer.listen(port, () => {
      logger.info({ port }, "Server listening");
      startDispatchEngine();
      migrateAdminSecrets().catch(e => logger.error({ err: e }, "Admin secret migration failed"));
    });
  })
  .catch(e => {
    logger.error({ err: e }, "Failed to run auth_method column migration");
    process.exit(1);
  });

httpServer.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});
