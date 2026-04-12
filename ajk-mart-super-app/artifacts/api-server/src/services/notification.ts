/**
 * NotificationService — OTP delivery abstraction.
 *
 * Routes OTP sends to the correct provider based on admin-configured
 * `primary_otp_channel` and `provider_credentials` platform settings.
 *
 * Debug / dev mode:
 *  - OTP codes are NEVER logged in production (NODE_ENV === "production"),
 *    even when `otp_debug_mode` is "on".
 *  - When NODE_ENV is not "production" AND `otp_debug_mode` is "on", the OTP
 *    is written to the structured logger for developer inspection.
 *
 * provider_credentials:
 *  - Stored as a JSON object in the `provider_credentials` platform setting.
 *  - Keys mirror the existing sms_, wa_, smtp_ platform setting keys.
 *  - Values in `provider_credentials` OVERRIDE the corresponding flat keys at
 *    runtime, enabling credential rotation without a deploy.
 *  - Example: { "sms_api_key": "SK_live_...", "wa_access_token": "EAA..." }
 *
 * Channel priority:
 *  1. Caller-supplied `preferredChannel` (if available and enabled)
 *  2. Admin-set `primary_otp_channel` (sms / whatsapp / email / all)
 *  3. Falls back through remaining enabled channels on failure
 */

import { logger } from "../lib/logger.js";
import { sendOtpSMS } from "./sms.js";
import { sendWhatsAppOTP } from "./whatsapp.js";
import { sendPasswordResetEmail } from "./email.js";

export type OtpChannel = "sms" | "whatsapp" | "email" | "all";

export interface SendOtpOptions {
  phone: string | undefined;
  otp: string;
  settings: Record<string, string>;
  userLanguage?: string;
  userEmail?: string;
  userName?: string;
  preferredChannel?: string;
}

export interface SendOtpResult {
  sent: boolean;
  channel: string;
  provider: string;
  debugMode: boolean;
  error?: string;
}

/**
 * Returns true when OTP debug logging is allowed.
 *
 * IMPORTANT: OTP codes are NEVER written to logs in production.
 * Debug logging is only enabled when ALL of the following are true:
 *   - NODE_ENV is not "production"
 *   - `otp_debug_mode` admin setting is "on"
 */
export function isOtpDebugMode(settings: Record<string, string>): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return settings["otp_debug_mode"] === "on";
}

/**
 * Merge provider_credentials JSON overrides into the settings map.
 * Returns a new map; the original is not mutated.
 * If `provider_credentials` is not valid JSON, it is silently ignored.
 */
export function mergeProviderCredentials(settings: Record<string, string>): Record<string, string> {
  const raw = settings["provider_credentials"];
  if (!raw || raw === "{}") return settings;
  try {
    const overrides = JSON.parse(raw) as Record<string, unknown>;
    const merged = { ...settings };
    for (const [k, v] of Object.entries(overrides)) {
      if (typeof v === "string") merged[k] = v;
    }
    return merged;
  } catch {
    logger.warn("[NotificationService] provider_credentials is not valid JSON — ignoring overrides");
    return settings;
  }
}

/**
 * Build the ordered list of channels to attempt based on admin config and
 * optional caller preference.
 */
function resolveChannelOrder(
  settings: Record<string, string>,
  preferredChannel: string | undefined,
  userEmail: string | undefined,
): string[] {
  const primaryOtpChannel = (settings["primary_otp_channel"] ?? "sms") as OtpChannel;

  const smsEnabled      = settings["integration_sms"] === "on";
  const whatsappEnabled = settings["integration_whatsapp"] === "on";
  const emailEnabled    = settings["integration_email"] === "on" && !!userEmail;

  const allEnabled: string[] = [];
  if (whatsappEnabled) allEnabled.push("whatsapp");
  if (smsEnabled)      allEnabled.push("sms");
  if (emailEnabled)    allEnabled.push("email");

  if (!allEnabled.length) {
    return ["sms"];
  }

  if (preferredChannel && allEnabled.includes(preferredChannel)) {
    const rest = allEnabled.filter(ch => ch !== preferredChannel);
    return [preferredChannel, ...rest];
  }

  if (primaryOtpChannel === "all") {
    return allEnabled;
  }

  if (allEnabled.includes(primaryOtpChannel)) {
    const rest = allEnabled.filter(ch => ch !== primaryOtpChannel);
    return [primaryOtpChannel, ...rest];
  }

  return allEnabled;
}

/**
 * Send an OTP via the configured channel(s).
 *
 * - Merges `provider_credentials` overrides into settings before dispatching.
 * - Reads `primary_otp_channel` to determine delivery order.
 * - Falls back through remaining channels on failure.
 * - Logs the OTP via the structured logger ONLY in non-production + debug mode.
 * - NEVER logs the raw OTP in production.
 */
export async function sendOtp(options: SendOtpOptions): Promise<SendOtpResult> {
  const { phone, otp, userLanguage, userEmail, userName, preferredChannel } = options;

  const effectiveSettings = mergeProviderCredentials(options.settings);
  const debugMode = isOtpDebugMode(effectiveSettings);

  if (debugMode) {
    logger.info({ phone, otp, channel: "debug" }, "[OTP:debug] OTP generated (non-production debug mode)");
  }

  const channelOrder = resolveChannelOrder(effectiveSettings, preferredChannel, userEmail);

  for (const channel of channelOrder) {
    if (channel === "whatsapp" && phone) {
      const result = await sendWhatsAppOTP(phone, otp, effectiveSettings, userLanguage);
      if (result.sent) {
        return { sent: true, channel: "whatsapp", provider: "whatsapp", debugMode };
      }
      logger.warn({ phone, err: result.error }, "[OTP] WhatsApp send failed, trying next channel");
    } else if (channel === "sms" && phone) {
      const result = await sendOtpSMS(phone, otp, effectiveSettings, userLanguage);
      if (result.sent) {
        return { sent: true, channel: "sms", provider: result.provider ?? "sms", debugMode };
      }
      logger.warn({ phone, err: result.error }, "[OTP] SMS send failed, trying next channel");
    } else if (channel === "email" && userEmail) {
      const result = await sendPasswordResetEmail(userEmail, otp, userName ?? undefined, userLanguage, effectiveSettings);
      if (result.sent) {
        return { sent: true, channel: "email", provider: "email", debugMode };
      }
      logger.warn({ phone, email: userEmail, err: result.reason }, "[OTP] Email send failed");
    }
  }

  if (debugMode) {
    logger.warn({ phone }, "[OTP] All delivery channels failed — debug mode active, OTP was logged above");
    return { sent: false, channel: "dev", provider: "console", debugMode, error: "All channels failed (dev mode)" };
  }

  return { sent: false, channel: "none", provider: "none", debugMode, error: "All OTP delivery channels failed" };
}
