import { createTransport, type Transporter } from "nodemailer";
import { t } from "@workspace/i18n";
import type { Language } from "@workspace/i18n";

let envTransporter: Transporter | null = null;

function getEnvTransporter(): Transporter | null {
  if (envTransporter) return envTransporter;

  const host = process.env["SMTP_HOST"];
  const port = parseInt(process.env["SMTP_PORT"] ?? "587", 10);
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];

  if (!host || !user || !pass) return null;

  envTransporter = createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  return envTransporter;
}

export function resetTransporter(): void {
  envTransporter = null;
}

function buildTransporterFromSettings(settings: Record<string, string>): Transporter | null {
  const host     = settings["smtp_host"]?.trim();
  const port     = parseInt(settings["smtp_port"] ?? "587", 10);
  const user     = settings["smtp_user"]?.trim();
  const pass     = settings["smtp_password"]?.trim();
  const secMode  = settings["smtp_secure"] ?? "tls";

  if (!host || !user || !pass) return null;

  const secure = secMode === "ssl" || port === 465;
  const requireTls = secMode === "tls";

  return createTransport({
    host,
    port,
    secure,
    requireTLS: requireTls,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
}

function resolveFrom(settings?: Record<string, string>): string {
  if (settings) {
    const name  = settings["smtp_from_name"]?.trim()  || "AJKMart";
    const email = settings["smtp_from_email"]?.trim() || settings["smtp_user"]?.trim() || "";
    if (email) return `${name} <${email}>`;
  }
  return process.env["SMTP_FROM"] || "AJKMart <noreply@ajkmart.com>";
}

function resolveLanguage(language?: string): Language {
  const valid: Language[] = ["en", "ur", "roman", "en_roman", "en_ur"];
  if (language && valid.includes(language as Language)) return language as Language;
  return "en";
}

export interface EmailResult {
  sent: boolean;
  reason?: string;
  error?: string;
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

  const tr = getEnvTransporter();
  if (!tr) {
    console.log(`[EMAIL] Verification email for ${to} — SMTP not configured. Link: ${verificationLink}`);
    return { sent: false, reason: "SMTP not configured" };
  }

  try {
    await tr.sendMail({
      from: resolveFrom(),
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[EMAIL] Failed to send verification email to ${to}:`, msg);
    return { sent: false, reason: msg };
  }
}

export async function sendPasswordResetEmail(
  to: string,
  otp: string,
  name?: string,
  language?: string,
  settings?: Record<string, string>,
): Promise<{ sent: boolean; reason?: string }> {
  const lang = resolveLanguage(language);
  const dir = lang === "ur" ? "rtl" : "ltr";
  const greeting = name ? ` — ${name}` : "";

  const subject = t("emailResetSubject", lang);
  const heading = t("emailResetHeading", lang).replace("{name}", greeting);
  const body    = t("emailResetBody", lang);
  const expiry  = t("emailResetExpiry", lang);
  const ignore  = t("emailResetIgnore", lang);

  const tr = settings ? buildTransporterFromSettings(settings) : getEnvTransporter();
  if (!tr) {
    return { sent: false, reason: "SMTP not configured" };
  }

  try {
    await tr.sendMail({
      from: resolveFrom(settings),
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[EMAIL] Failed to send reset email to ${to}:`, msg);
    return { sent: false, reason: msg };
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

  const tr = getEnvTransporter();
  if (!tr) {
    console.log(`[EMAIL] Magic link for ${email}: ${magicUrl}`);
    return { sent: false, error: "SMTP not configured — logged to console" };
  }

  try {
    await tr.sendMail({ from: resolveFrom(), to: email, subject, html });
    return { sent: true };
  } catch (err: unknown) {
    console.error(`[EMAIL] Failed to send magic link to ${email}:`, (err instanceof Error ? err.message : String(err)));
    return { sent: false, error: (err instanceof Error ? err.message : String(err)) };
  }
}

/* ─── Admin Alert Emails ─────────────────────────────────────────────────────
 * Sends admin alert emails using platform settings (SMTP config from DB).
 * Called from order/ride/vendor events when integration_email=on.
 *
 * Alert types must match email_alert_* keys in platform settings.
 */
export type AdminAlertType =
  | "new_vendor"
  | "high_value_order"
  | "fraud"
  | "low_balance"
  | "daily_summary"
  | "weekly_report";

export async function sendAdminAlert(
  alertType: AdminAlertType,
  subject: string,
  htmlBody: string,
  settings: Record<string, string>,
): Promise<EmailResult> {
  if ((settings["integration_email"] ?? "off") !== "on") {
    return { sent: false, reason: "Email integration disabled" };
  }

  const alertKey = `email_alert_${alertType}`;
  if ((settings[alertKey] ?? "on") !== "on") {
    return { sent: false, reason: `Alert type "${alertType}" is disabled` };
  }

  const to = settings["smtp_admin_alert_email"]?.trim();
  if (!to) {
    return { sent: false, reason: "Admin alert recipient email not configured (smtp_admin_alert_email)" };
  }

  const tr = buildTransporterFromSettings(settings);
  if (!tr) {
    console.log(`[EMAIL:admin-alert] SMTP not configured — logging alert: ${subject}`);
    return { sent: false, reason: "SMTP credentials not configured. Set smtp_host, smtp_user, smtp_password in Integrations → Email." };
  }

  const appName = settings["app_name"] ?? "AJKMart";
  const from = resolveFrom(settings);

  const fullHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #1e40af; color: #fff; padding: 16px 24px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-size: 18px;">⚡ ${appName} Admin Alert</h2>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 8px 8px; background: #fff;">
        ${htmlBody}
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #9ca3af; font-size: 12px; margin: 0;">
          This is an automated alert from ${appName}. Do not reply to this email.
        </p>
      </div>
    </div>
  `;

  try {
    await tr.sendMail({ from, to, subject: `[${appName}] ${subject}`, html: fullHtml });
    console.log(`[EMAIL:admin-alert] Sent "${alertType}" alert to ${to}`);
    return { sent: true };
  } catch (err: unknown) {
    console.error(`[EMAIL:admin-alert] Failed to send "${alertType}" alert:`, (err instanceof Error ? err.message : String(err)));
    return { sent: false, error: (err instanceof Error ? err.message : String(err)) };
  }
}

/* ─── Convenience wrappers for each alert type ─────────────────────────────── */

export async function alertNewVendor(
  vendorName: string,
  vendorPhone: string,
  shopName: string,
  settings: Record<string, string>,
): Promise<EmailResult> {
  return sendAdminAlert(
    "new_vendor",
    `New Vendor Registration — ${shopName}`,
    `
      <h3 style="color: #059669;">🏪 New Vendor Registered</h3>
      <table style="width:100%; border-collapse: collapse;">
        <tr><td style="padding:6px 0; color:#6b7280; width:140px;">Vendor Name</td><td style="padding:6px 0; font-weight:bold;">${vendorName}</td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Shop Name</td><td style="padding:6px 0; font-weight:bold;">${shopName}</td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Phone</td><td style="padding:6px 0; font-family:monospace;">${vendorPhone}</td></tr>
      </table>
      <p>Please review and approve/reject this vendor application from the Admin Panel → Vendors section.</p>
    `,
    settings,
  );
}

export async function alertHighValueOrder(
  orderId: string,
  amount: number,
  customerPhone: string,
  settings: Record<string, string>,
): Promise<EmailResult> {
  return sendAdminAlert(
    "high_value_order",
    `High Value Order — Rs. ${amount.toFixed(0)}`,
    `
      <h3 style="color: #d97706;">⚠️ High Value Order Alert</h3>
      <table style="width:100%; border-collapse: collapse;">
        <tr><td style="padding:6px 0; color:#6b7280; width:140px;">Order ID</td><td style="padding:6px 0; font-family:monospace;">#${orderId.slice(-8).toUpperCase()}</td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Amount</td><td style="padding:6px 0; font-weight:bold; color:#059669;">Rs. ${amount.toFixed(0)}</td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Customer</td><td style="padding:6px 0; font-family:monospace;">${customerPhone}</td></tr>
      </table>
      <p>Please verify this order in the Admin Panel → Orders section.</p>
    `,
    settings,
  );
}

export async function alertFraudSuspect(
  orderId: string,
  reason: string,
  customerPhone: string,
  settings: Record<string, string>,
): Promise<EmailResult> {
  return sendAdminAlert(
    "fraud",
    `Fraud Suspect — Order #${orderId.slice(-8).toUpperCase()}`,
    `
      <h3 style="color: #dc2626;">🚨 Possible Fraud / Fake Order Detected</h3>
      <table style="width:100%; border-collapse: collapse;">
        <tr><td style="padding:6px 0; color:#6b7280; width:140px;">Order ID</td><td style="padding:6px 0; font-family:monospace;">#${orderId.slice(-8).toUpperCase()}</td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Customer</td><td style="padding:6px 0; font-family:monospace;">${customerPhone}</td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Reason</td><td style="padding:6px 0; color:#dc2626; font-weight:bold;">${reason}</td></tr>
      </table>
      <p>Please investigate and take appropriate action from the Admin Panel.</p>
    `,
    settings,
  );
}

export async function alertLowWalletBalance(
  vendorName: string,
  balance: number,
  threshold: number,
  settings: Record<string, string>,
): Promise<EmailResult> {
  return sendAdminAlert(
    "low_balance",
    `Low Wallet Balance — ${vendorName}`,
    `
      <h3 style="color: #d97706;">💰 Low Balance Warning</h3>
      <table style="width:100%; border-collapse: collapse;">
        <tr><td style="padding:6px 0; color:#6b7280; width:140px;">Vendor</td><td style="padding:6px 0; font-weight:bold;">${vendorName}</td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Current Balance</td><td style="padding:6px 0; font-weight:bold; color:#dc2626;">Rs. ${balance.toFixed(0)}</td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Alert Threshold</td><td style="padding:6px 0;">Rs. ${threshold.toFixed(0)}</td></tr>
      </table>
      <p>The vendor's wallet balance has fallen below the alert threshold.</p>
    `,
    settings,
  );
}
