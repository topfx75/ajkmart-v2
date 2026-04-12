/* AJKMart Rider App — Service Worker v1 */
const CACHE = "rider-v1";
const STATIC = ["/rider/", "/rider/index.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(fetch(e.request).catch(() => new Response("Offline", { status: 503 })));
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
      if (res.ok && e.request.method === "GET") {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match("/rider/") || new Response("Offline", { status: 503 })))
  );
});

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "AJKMart Rider";
  const options = {
    body: data.body || "",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag: data.tag || "ajkmart-rider",
    data: data.data || {},
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rideId = event.notification.data?.rideId;
  const url = rideId ? `/rider/active/${rideId}` : "/rider/";
  event.waitUntil(clients.openWindow(url));
});
