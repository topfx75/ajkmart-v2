import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { sendSuccess, sendErrorWithData } from "../lib/response.js";

const router: IRouter = Router();

const startTime = Date.now();

router.get("/healthz", async (_req, res) => {
  let dbStatus: "ok" | "error" = "ok";
  let dbLatencyMs = 0;

  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    dbLatencyMs = Date.now() - start;
  } catch (err) {
    dbStatus = "error";
    logger.warn({ err }, "Health check: database unreachable");
  }

  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const status = dbStatus === "ok" ? "ok" : "degraded";

  const data = {
    status,
    uptime: uptimeSeconds,
    timestamp: new Date().toISOString(),
    services: {
      database: { status: dbStatus, latencyMs: dbLatencyMs },
    },
  };

  if (status === "ok") {
    sendSuccess(res, data);
  } else {
    sendErrorWithData(res, "Service degraded", data, 503, "سروس دستیاب نہیں ہے۔ ڈیٹا بیس تک رسائی نہیں ہو سکی۔");
  }
});

export default router;
