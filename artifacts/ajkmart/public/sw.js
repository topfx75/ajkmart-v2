/**
 * AJKMart PWA Service Worker
 * Cache-first strategy for static assets; network-first for API calls.
 */

const CACHE_NAME = "ajkmart-v1";
const API_PATTERN = /\/api\//;

/* Files to pre-cache on install */
const PRECACHE_URLS = ["/", "/favicon.ico"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  /* Skip non-GET and API requests (always go to network for live data) */
  if (request.method !== "GET" || API_PATTERN.test(request.url)) {
    event.respondWith(fetch(request));
    return;
  }

  /* Cache-first for static assets */
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
          }
          return response;
        })
        .catch(() => caches.match("/"));
    })
  );
});
