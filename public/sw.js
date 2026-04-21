// Street Park Info — Service Worker
// Caches the shell for offline use, passes API calls through

const CACHE = "spi-v1";
const SHELL = ["/", "/index.html"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // Always pass API calls through — never cache live data
  if (url.hostname.includes("onrender.com") ||
      url.hostname.includes("openstreetmap") ||
      url.hostname.includes("open-meteo") ||
      url.hostname.includes("nominatim") ||
      url.hostname.includes("cityofnewyork") ||
      url.hostname.includes("nyc.gov")) {
    return;
  }

  // For navigation requests, serve the app shell
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Cache-first for static assets (JS, CSS, fonts)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok && e.request.method === "GET") {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
