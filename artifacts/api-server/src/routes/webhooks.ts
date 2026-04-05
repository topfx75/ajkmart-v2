import { Router } from "express";
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
  const body = req.body as any;

  if (body?.object !== "whatsapp_business_account") {
    res.status(400).send("Not a WhatsApp event");
    return;
  }

  const entries: any[] = body?.entry ?? [];

  for (const entry of entries) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (!value) continue;

      const messages: any[] = value?.messages ?? [];
      const statuses: any[] = value?.statuses ?? [];

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
