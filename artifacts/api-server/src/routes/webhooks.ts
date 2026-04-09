import { Router } from "express";
import crypto from "crypto";
import { getPlatformSettings } from "./admin.js";
import { sendSuccess, sendError } from "../lib/response.js";

const router = Router();

/* ─── WhatsApp Business API Webhook ─────────────────────────────────────────
 *
 * Two endpoints:
 *   GET  /webhooks/whatsapp  — Meta verification handshake
 *   POST /webhooks/whatsapp  — Incoming message events
 *
 * Setup in Meta Developer Console:
 *   Webhook URL:   https://<your-domain>/api/webhooks/whatsapp
 *   Verify Token:  value stored in platform setting "wa_verify_token"
 *   Subscriptions: messages, message_deliveries, message_reads
 */

router.get("/whatsapp", async (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode !== "subscribe") {
    sendError(res, "Invalid hub.mode", 403);
    return;
  }

  const settings = await getPlatformSettings();
  const verifyToken = settings["wa_verify_token"]?.trim();

  if (!verifyToken) {
    console.warn("[WhatsApp webhook] wa_verify_token not set in platform settings");
    sendError(res, "Webhook verify token not configured. Set wa_verify_token in Integrations → WhatsApp.", 403);
    return;
  }

  if (token !== verifyToken) {
    sendError(res, "Token mismatch", 403);
    return;
  }

  res.status(200).send(challenge);
});

router.post("/whatsapp", async (req, res) => {
  const appSecret = process.env["WHATSAPP_APP_SECRET"] ?? "";
  if (!appSecret) {
    console.error("[WhatsApp webhook] WHATSAPP_APP_SECRET not set — rejecting POST");
    sendError(res, "Webhook signature secret not configured", 500);
    return;
  }

  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  if (!signature || !signature.startsWith("sha256=")) {
    res.status(403).json({ success: false, error: "Missing signature" });
    return;
  }

  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  const bodyBuf = rawBody ?? Buffer.from(JSON.stringify(req.body));
  const expectedSig = "sha256=" + crypto.createHmac("sha256", appSecret).update(bodyBuf).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    res.status(403).json({ success: false, error: "Invalid signature" });
    return;
  }

  interface WABody { object?: string; entry?: Array<{ changes?: Array<{ value?: { messages?: Array<{ from?: string; type?: string; text?: { body?: string } }>; statuses?: Array<{ id?: string; status?: string; timestamp?: string; recipient_id?: string }> } }> }> }
  const body = req.body as WABody;

  if (body?.object !== "whatsapp_business_account") {
    res.status(400).send("Not a WhatsApp event");
    return;
  }

  const entries = body?.entry ?? [];

  for (const entry of entries) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (!value) continue;

      const messages = value?.messages ?? [];
      const statuses = value?.statuses ?? [];

      for (const msg of messages) {
        const from = msg?.from;
        const type = msg?.type;
        const text = msg?.text?.body ?? "";

        console.log(`[WhatsApp webhook] Incoming message from ${from} — type: ${type}`);
      }

      for (const status of statuses) {
        const msgId    = status?.id;
        const statusVal = status?.status;
        const recipient = status?.recipient_id;
        console.log(`[WhatsApp webhook] Message ${msgId} to ${recipient} — status: ${statusVal}`);
      }
    }
  }

  res.status(200).json({ success: true });
});

export default router;
