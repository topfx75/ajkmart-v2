import * as Sentry from "@sentry/react";

let _initialized = false;

export interface SentryConfig {
  dsn: string;
  environment: string;
  sampleRate: number;
  tracesSampleRate: number;
}

export function initSentry(cfg: SentryConfig): void {
  if (!cfg.dsn || _initialized) return;
  _initialized = true;
  Sentry.init({
    dsn: cfg.dsn,
    environment: cfg.environment || "production",
    sampleRate: cfg.sampleRate ?? 1.0,
    tracesSampleRate: cfg.tracesSampleRate ?? 0.1,
    integrations: [Sentry.browserTracingIntegration()],
    beforeSend(event) {
      if (event.exception) {
        console.debug("[Sentry] Captured exception:", event.exception.values?.[0]?.value);
      }
      return event;
    },
  });
  console.debug("[Sentry] Initialized for admin panel, env:", cfg.environment);
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!_initialized) return;
  Sentry.captureException(err, { extra: context });
}

export function setSentryUser(id: string, email?: string): void {
  if (!_initialized) return;
  Sentry.setUser({ id, email });
}

export function clearSentryUser(): void {
  if (!_initialized) return;
  Sentry.setUser(null);
}
