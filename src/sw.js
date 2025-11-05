// /sw.js
const VERSION = "v7"; // bump this whenever UI changes
const ASSET_CACHE = "vinet-assets-" + VERSION;

self.addEventListener("install", (e) => {
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== ASSET_CACHE ? caches.delete(k) : null)));
    await self.clients.claim();
  })());
});

// For HTML routes, ALWAYS go to network first (avoid stale UI)
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  const isHTML =
    req.method === "GET" &&
    req.headers.get("accept")?.includes("text/html") &&
    url.origin === location.origin;

  if (isHTML) {
    event.respondWith((async () => {
      try {
        // Bypass cache for HTML
        return await fetch(req, { cache: "no-store" });
      } catch {
        // Fallback to cache/offline if you want
        const cache = await caches.open(ASSET_CACHE);
        const hit = await cache.match("/offline.html");
        return hit || new Response("Offline", { status: 503 });
      }
    })());
    return;
  }

  // Static assets: cache-first
  event.respondWith((async () => {
    const cache = await caches.open(ASSET_CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && req.method === "GET" && url.origin === location.origin) {
        cache.put(req, res.clone());
      }
      return res;
    } catch {
      return new Response("Network error", { status: 502 });
    }
  })());
});
