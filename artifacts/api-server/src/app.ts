import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import router from "./routes";
import { logger } from "./lib/logger";
import { rateLimitMiddleware, securityHeadersMiddleware } from "./middleware/security.js";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

/* Security headers on all responses */
app.use(securityHeadersMiddleware);

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

/* Dynamic rate limiting — reads settings from DB (cached 30s) */
app.use(rateLimitMiddleware);

app.use("/api/uploads", express.static(path.resolve(process.cwd(), "uploads")));
app.use("/api", router);

/* ── Global error handler — catches any unhandled errors thrown in route handlers ── */
interface AppError { status?: number; statusCode?: number; code?: string; message?: string }
function isAppError(e: unknown): e is AppError {
  return typeof e === "object" && e !== null;
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const appErr    = isAppError(err) ? err : {};
  const statusCode = appErr.status ?? appErr.statusCode ?? 500;
  const code       = appErr.code ?? (statusCode === 404 ? "NOT_FOUND" : statusCode === 403 ? "FORBIDDEN" : statusCode < 500 ? "BAD_REQUEST" : "INTERNAL_ERROR");
  const message    = statusCode < 500
    ? (appErr.message ?? "Bad request")
    : "An unexpected error occurred. Please try again later.";

  logger.error({ err, method: req.method, url: req.url?.split("?")[0], statusCode }, "Unhandled route error");

  if (!res.headersSent) {
    res.status(statusCode).json({ error: { code, message } });
  }
});

export default app;
