import webpush from "web-push";
import { db } from "@workspace/db";
import { pushSubscriptionsTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

let vapidInitialized = false;

export function initVapid() {
  if (vapidInitialized) return;
  const pub  = process.env["VAPID_PUBLIC_KEY"]  ?? "";
  const priv = process.env["VAPID_PRIVATE_KEY"] ?? "";
  const mail = process.env["VAPID_CONTACT_EMAIL"] ?? "mailto:admin@ajkmart.app";
  if (!pub || !priv) {
    console.warn("[webpush] VAPID keys not set — web push disabled");
    return;
  }
  webpush.setVapidDetails(mail, pub, priv);
  vapidInitialized = true;
  console.log("[webpush] VAPID initialized");
}

export function getVapidPublicKey(): string {
  return process.env["VAPID_PUBLIC_KEY"] ?? "";
}

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  data?: Record<string, unknown>;
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!vapidInitialized) return;
  const subs = await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, userId));
  await sendPushToSubs(subs, payload);
}

export async function sendPushToRole(role: string, payload: PushPayload): Promise<void> {
  if (!vapidInitialized) return;
  const subs = await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.role, role));
  await sendPushToSubs(subs, payload);
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (!vapidInitialized || userIds.length === 0) return;
  const subs = await db.select().from(pushSubscriptionsTable).where(inArray(pushSubscriptionsTable.userId, userIds));
  await sendPushToSubs(subs, payload);
}

async function sendPushToSubs(subs: typeof pushSubscriptionsTable.$inferSelect[], payload: PushPayload): Promise<void> {
  if (subs.length === 0) return;
  const json = JSON.stringify(payload);
  const stale: string[] = [];
  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.authKey } },
          json,
        );
      } catch (err: any) {
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          stale.push(sub.id);
        } else {
          console.warn("[webpush] send failed:", err?.message);
        }
      }
    }),
  );
  if (stale.length > 0) {
    await db.delete(pushSubscriptionsTable).where(inArray(pushSubscriptionsTable.id, stale)).catch((err) => { console.error("[webpush] Stale subscription cleanup failed:", err); });
  }
}
