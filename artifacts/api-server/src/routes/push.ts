import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { pushSubscriptionsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { customerAuth } from "../middleware/security.js";
import { getVapidPublicKey } from "../lib/webpush.js";
import { z } from "zod/v4";
import { sendSuccess, sendError, sendValidationError } from "../lib/response.js";

const router: IRouter = Router();

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  p256dh:   z.string().min(1),
  auth:     z.string().min(1),
  role:     z.enum(["customer", "rider", "vendor", "admin"]).default("customer"),
});

router.get("/vapid-key", (_req, res) => {
  const key = getVapidPublicKey();
  if (!key) { sendError(res, "Push notifications not configured", 503); return; }
  sendSuccess(res, { publicKey: key });
});

router.post("/subscribe", customerAuth, async (req, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error.issues[0]?.message ?? "Invalid subscription data"); return; }
  const userId = req.customerId!;
  const { endpoint, p256dh, auth, role } = parsed.data;

  await db.delete(pushSubscriptionsTable)
    .where(and(eq(pushSubscriptionsTable.userId, userId), eq(pushSubscriptionsTable.endpoint, endpoint)));

  const id = generateId();
  await db.insert(pushSubscriptionsTable).values({ id, userId, role, endpoint, p256dh, authKey: auth });
  sendSuccess(res, { id });
});

router.delete("/unsubscribe", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const { endpoint } = req.body as { endpoint?: string };
  if (endpoint) {
    await db.delete(pushSubscriptionsTable)
      .where(and(eq(pushSubscriptionsTable.userId, userId), eq(pushSubscriptionsTable.endpoint, endpoint)));
  } else {
    await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, userId));
  }
  sendSuccess(res);
});

export default router;
