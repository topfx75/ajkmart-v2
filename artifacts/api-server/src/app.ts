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

app.use(securityHeadersMiddleware);

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(rateLimitMiddleware);

app.use("/api/uploads", express.static(path.resolve(process.cwd(), "uploads")));
app.use("/api", router);

interface AppError { status?: number; statusCode?: number; code?: string; message?: string }
function isAppError(e: unknown): e is AppError {
  return typeof e === "object" && e !== null;
}

const ERROR_MESSAGES: Record<string, { en: string; ur: string }> = {
  NOT_FOUND:       { en: "Resource not found.",                                    ur: "وسیلہ نہیں ملا۔" },
  FORBIDDEN:       { en: "Access denied.",                                          ur: "رسائی سے انکار۔" },
  UNAUTHORIZED:    { en: "Authentication required. Please log in.",                ur: "تصدیق ضروری ہے۔ براہ کرم لاگ ان کریں۔" },
  BAD_REQUEST:     { en: "Bad request.",                                            ur: "غلط درخواست۔" },
  VALIDATION:      { en: "Validation error. Please check your input.",             ur: "توثیق کی خرابی۔ اپنا ان پٹ چیک کریں۔" },
  RATE_LIMITED:    { en: "Too many requests. Please slow down.",                   ur: "بہت زیادہ درخواستیں۔ براہ کرم آہستہ کریں۔" },
  INTERNAL_ERROR:  { en: "An unexpected error occurred. Please try again later.",  ur: "ایک غیر متوقع خرابی ہوئی۔ براہ کرم بعد میں دوبارہ کوشش کریں۔" },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const appErr     = isAppError(err) ? err : {};
  const statusCode = appErr.status ?? appErr.statusCode ?? 500;
  const code       = appErr.code ?? (
    statusCode === 401 ? "UNAUTHORIZED" :
    statusCode === 404 ? "NOT_FOUND" :
    statusCode === 403 ? "FORBIDDEN" :
    statusCode === 429 ? "RATE_LIMITED" :
    statusCode < 500   ? "BAD_REQUEST" :
    "INTERNAL_ERROR"
  );

  const msgs = ERROR_MESSAGES[code] ?? ERROR_MESSAGES["INTERNAL_ERROR"];
  const message = statusCode < 500
    ? (appErr.message ?? msgs.en)
    : msgs.en;

  logger.error({
    err,
    method: req.method,
    url: req.url?.split("?")[0],
    statusCode,
    code,
    ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
  }, "Unhandled route error");

  if (!res.headersSent) {
    res.status(statusCode).json({
      success: false,
      error: message,
      message: msgs.ur,
      code,
    });
  }
});

export default app;
