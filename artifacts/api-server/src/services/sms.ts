/**
 * SMS Service — supports Twilio, MSG91, and Zong (CM.com) providers.
 * Provider is selected via the `sms_provider` platform setting.
 *
 * Phone numbers are assumed to be Pakistani (03xxxxxxxxx format).
 * They are converted to E.164 (+92xxxxxxxxx) before sending.
 *
 * Security: raw message content (which may include OTP codes) is NEVER
 * written to logs in production. Only real SMS providers are supported.
 */

import { t } from "@workspace/i18n";
import type { Language } from "@workspace/i18n";

const isProd = process.env.NODE_ENV === "production";

function toE164Pakistan(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("92")) return `+${digits}`;
  if (digits.startsWith("0"))  return `+92${digits.slice(1)}`;
  return `+92${digits}`;
}

function applyTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

function resolveLanguage(language?: string): Language {
  const valid: Language[] = ["en", "ur", "roman", "en_roman", "en_ur"];
  if (language && valid.includes(language as Language)) return language as Language;
  return "en";
}

export interface SMSResult {
  sent: boolean;
  provider: string;
  error?: string;
}

async function dispatchSMS(phone: string, message: string, settings: Record<string, string>): Promise<SMSResult> {
  const integrationOn = settings["integration_sms"] === "on";
  const provider      = settings["sms_provider"] ?? "console";

  if (!integrationOn) {
    return { sent: false, provider: provider || "none", error: "SMS integration is disabled. Enable it in Admin → Integrations → SMS." };
  }

  if (provider === "console") {
    return { sent: false, provider: "console", error: "Console SMS provider is not supported. Please configure Twilio, MSG91, or Zong in Admin → Integrations → SMS." };
  }

  const e164 = toE164Pakistan(phone);

  /* ── Twilio ── */
  if (provider === "twilio") {
    const accountSid = settings["sms_account_sid"]?.trim();
    const authToken  = settings["sms_api_key"]?.trim();
    const from       = settings["sms_sender_id"]?.trim();

    if (!accountSid || !authToken || !from) {
      if (otpDebugMode) {
        console.log(`[SMS:twilio] Credentials not configured — logging: ${message}`);
      }
      return { sent: false, provider: "twilio", error: "Twilio credentials not configured. Set sms_account_sid, sms_api_key, sms_sender_id in Integrations." };
    }

    try {
      const { default: twilio } = await import("twilio");
      const client = twilio(accountSid, authToken);
      await client.messages.create({ body: message, from, to: e164 });
      console.log(`[SMS:twilio] Sent to ${e164}`);
      return { sent: true, provider: "twilio" };
    } catch (err: unknown) {
      console.error(`[SMS:twilio] Error:`, (err instanceof Error ? err.message : String(err)));
      return { sent: false, provider: "twilio", error: (err instanceof Error ? err.message : String(err)) };
    }
  }

  /* ── MSG91 ── */
  if (provider === "msg91") {
    const authKey    = settings["sms_msg91_key"]?.trim();
    const senderId   = (settings["sms_sender_id"] ?? "AJKMAT").trim();

    if (!authKey) {
      if (otpDebugMode) {
        console.log(`[SMS:msg91] Auth key not configured — logging: ${message}`);
      }
      return { sent: false, provider: "msg91", error: "MSG91 auth key not configured. Set sms_msg91_key in Integrations." };
    }

    try {
      const resp = await fetch(`https://api.msg91.com/api/sendhttp.php?country=92&sender=${senderId}&route=4&mobiles=${e164.replace("+", "")}&authkey=${authKey}&sms=${encodeURIComponent(message)}`);
      const body = await resp.text();
      if (body.includes("success") || resp.ok) {
        return { sent: true, provider: "msg91" };
      }
      return { sent: false, provider: "msg91", error: body };
    } catch (err: unknown) {
      console.error(`[SMS:msg91] Error:`, (err instanceof Error ? err.message : String(err)));
      return { sent: false, provider: "msg91", error: (err instanceof Error ? err.message : String(err)) };
    }
  }

  /* ── Zong / CM.com Pakistan ── */
  if (provider === "zong") {
    const apiKey   = settings["sms_api_key"]?.trim();
    const senderId = (settings["sms_sender_id"] ?? "AJKMart").trim();

    if (!apiKey) {
      if (otpDebugMode) {
        console.log(`[SMS:zong] API key not configured — logging: ${message}`);
      }
      return { sent: false, provider: "zong", error: "Zong API key not configured. Set sms_api_key in Integrations." };
    }

    try {
      const resp = await fetch("https://api.cm.com/v1.0/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CM-PRODUCTTOKEN": apiKey,
        },
        body: JSON.stringify({
          messages: {
            authentication: { producttoken: apiKey },
            msg: [{
              from: senderId,
              to: [{ number: e164 }],
              body: { type: "AUTO", content: message },
            }],
          },
        }),
      });

      if (resp.ok || resp.status === 202) {
        console.log(`[SMS:zong] Sent to ${e164}`);
        return { sent: true, provider: "zong" };
      }
      const errText = await resp.text().catch(() => `HTTP ${resp.status}`);
      return { sent: false, provider: "zong", error: errText };
    } catch (err: unknown) {
      console.error(`[SMS:zong] Error:`, (err instanceof Error ? err.message : String(err)));
      return { sent: false, provider: "zong", error: (err instanceof Error ? err.message : String(err)) };
    }
  }

  if (otpDebugMode) {
    console.log(`[SMS:unknown] Unknown provider "${provider}" — logging: ${message}`);
  }
  return { sent: false, provider, error: `Unknown provider: ${provider}` };
}

export async function sendOtpSMS(
  phone: string,
  otp: string,
  settings: Record<string, string>,
  userLanguage?: string
): Promise<SMSResult> {
  const lang = resolveLanguage(userLanguage);
  const i18nDefault = t("smsOtpText", lang).replace("{otp}", otp);
  const adminTemplate = settings["sms_template_otp"] ?? i18nDefault;
  const message = applyTemplate(adminTemplate, { otp });
  return dispatchSMS(phone, message, settings);
}

export async function sendOrderSMS(
  phone: string,
  orderId: string,
  status: string,
  settings: Record<string, string>,
  userLanguage?: string
): Promise<SMSResult> {
  const lang = resolveLanguage(userLanguage);
  const i18nDefault = t("smsOrderText", lang).replace("{id}", orderId).replace("{status}", status);
  const adminTemplate = settings["sms_template_order"] ?? i18nDefault;
  const message = applyTemplate(adminTemplate, { id: orderId, status });
  return dispatchSMS(phone, message, settings);
}
