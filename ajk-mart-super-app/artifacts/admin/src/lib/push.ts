const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export async function registerPush(): Promise<void> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  try {
    const reg = await navigator.serviceWorker.register(`${BASE}/sw.js`);
    const existing = await reg.pushManager.getSubscription();
    if (existing) return;

    const vapidRes = await fetch(`${BASE}/api/push/vapid-key`);
    if (!vapidRes.ok) return;
    const vj = await vapidRes.json();
    const { publicKey } = (vj?.success === true && "data" in vj ? vj.data : vj) as { publicKey: string };
    if (!publicKey) return;

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const adminToken = localStorage.getItem("ajkmart_admin_token") ?? "";
    await fetch(`${BASE}/api/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ endpoint: sub.endpoint, p256dh: sub.toJSON().keys?.p256dh, auth: sub.toJSON().keys?.auth, role: "admin" }),
    });
  } catch (e) {
    if (import.meta.env.DEV) console.warn("[push] registration failed:", e);
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}
