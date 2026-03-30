import app from "./app";
import { logger } from "./lib/logger";
import { startDispatchEngine } from "./routes/rides.js";
import { migrateAdminSecrets } from "./services/adminSecretMigration.js";

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

app.listen({ port, reusePort: true }, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startDispatchEngine();
  migrateAdminSecrets().catch(e => logger.error({ err: e }, "Admin secret migration failed"));
});
