import { createTransport, type Transporter } from "nodemailer";
import { t } from "@workspace/i18n";
import type { Language } from "@workspace/i18n";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;

  const host = process.env["SMTP_HOST"];
  const port = parseInt(process.env["SMTP_PORT"] ?? "587", 10);
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];

  if (!host || !user || !pass) {
    return null;
  }

  transporter = createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return transporter;
}

export function resetTransporter(): void {
  transporter = null;
}

const FROM_ADDRESS = process.env["SMTP_FROM"] || "AJKMart <noreply@ajkmart.com>";

export interface EmailResult {
  sent: boolean;
  reason?: string;
  error?: string;
}

function resolveLanguage(language?: string): Language {
  const valid: Language[] = ["en", "ur", "roman", "en_roman", "en_ur"];
  if (language && valid.includes(language as Language)) return language as Language;
  return "en";
}

export async function sendVerificationEmail(
  to: string,
  verificationLink: string,
  name?: string,
  language?: string,
): Promise<{ sent: boolean; reason?: string }> {
  const lang = resolveLanguage(language);
  const dir = lang === "ur" ? "rtl" : "ltr";
  const greeting = name ? `, ${name}` : "";

  const subject  = t("emailVerifySubject", lang);
  const heading  = t("emailVerifyHeading", lang).replace("{name}", greeting);
  const body     = t("emailVerifyBody", lang);
  const button   = t("emailVerifyButton", lang);
  const expiry   = t("emailVerifyExpiry", lang);
  const ignore   = t("emailVerifyIgnore", lang);

  const tr = getTransporter();
  if (!tr) {
    console.log(`[EMAIL] Verification email for ${to} — SMTP not configured. Link: ${verificationLink}`);
    return { sent: false, reason: "SMTP not configured" };
  }

  try {
    await tr.sendMail({
      from: FROM_ADDRESS,
      to,
      subject,
      html: `
        <div dir="${dir}" style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>${heading}</h2>
          <p>${body}</p>
          <p><a href="${verificationLink}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">${button}</a></p>
          <p style="color:#6b7280;font-size:13px;">${verificationLink}</p>
          <p>${expiry}</p>
          <p style="color:#9ca3af;font-size:12px;">${ignore}</p>
        </div>
      `,
      text: `${heading}\n\n${body}\n${verificationLink}\n\n${expiry}\n${ignore}`,
    });
    return { sent: true };
  } catch (err: any) {
    console.error(`[EMAIL] Failed to send verification email to ${to}:`, err?.message);
    return { sent: false, reason: err?.message };
  }
}

export async function sendPasswordResetEmail(
  to: string,
  otp: string,
  name?: string,
  language?: string,
): Promise<{ sent: boolean; reason?: string }> {
  const lang = resolveLanguage(language);
  const dir = lang === "ur" ? "rtl" : "ltr";
  const greeting = name ? ` — ${name}` : "";

  const subject = t("emailResetSubject", lang);
  const heading = t("emailResetHeading", lang).replace("{name}", greeting);
  const body    = t("emailResetBody", lang);
  const expiry  = t("emailResetExpiry", lang);
  const ignore  = t("emailResetIgnore", lang);

  const tr = getTransporter();
  if (!tr) {
    console.log(`[EMAIL] Password reset OTP for ${to} — SMTP not configured.`);
    return { sent: false, reason: "SMTP not configured" };
  }

  try {
    await tr.sendMail({
      from: FROM_ADDRESS,
      to,
      subject,
      html: `
        <div dir="${dir}" style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>${heading}</h2>
          <p>${body}</p>
          <h1 style="font-size:32px;letter-spacing:8px;text-align:center;padding:16px;background:#f3f4f6;border-radius:8px;">${otp}</h1>
          <p>${expiry}</p>
          <p style="color:#9ca3af;font-size:12px;">${ignore}</p>
        </div>
      `,
      text: `${heading}\n\n${body} ${otp}\n\n${expiry}\n${ignore}`,
    });
    return { sent: true };
  } catch (err: any) {
    console.error(`[EMAIL] Failed to send reset email to ${to}:`, err?.message);
    return { sent: false, reason: err?.message };
  }
}

export async function sendMagicLinkEmail(
  email: string,
  token: string,
  settings: Record<string, string>,
  language?: string,
): Promise<EmailResult> {
  const appName = settings["app_name"] ?? "AJKMart";

  const baseUrl = process.env["APP_BASE_URL"]
    ?? (process.env["REPLIT_DEV_DOMAIN"]
      ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
      : "http://localhost:3000");
  const magicUrl = `${baseUrl}/auth/magic-link?token=${encodeURIComponent(token)}`;

  const lang = resolveLanguage(language);
  const dir = lang === "ur" ? "rtl" : "ltr";

  const subject = t("emailMagicSubject", lang).replace("{app}", appName);
  const body    = t("emailMagicBody", lang);
  const button  = t("emailMagicButton", lang);
  const ignore  = t("emailMagicIgnore", lang);

  const html = `
    <div dir="${dir}" style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #2563eb;">${appName}</h2>
      <p>${body}</p>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${magicUrl}" style="background: #2563eb; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: bold;">
          ${button}
        </a>
      </div>
      <p style="color: #6b7280; font-size: 13px;">${ignore}</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="color: #9ca3af; font-size: 12px;">— ${appName} Team</p>
    </div>
  `;

  const tr = getTransporter();
  if (!tr) {
    console.log(`[EMAIL] Magic link for ${email}: ${magicUrl}`);
    return { sent: false, error: "SMTP not configured — logged to console" };
  }

  try {
    await tr.sendMail({
      from: FROM_ADDRESS,
      to: email,
      subject,
      html,
    });
    return { sent: true };
  } catch (err: any) {
    console.error(`[EMAIL] Failed to send magic link to ${email}:`, err.message);
    return { sent: false, error: err.message };
  }
}
