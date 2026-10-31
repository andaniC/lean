// Offline support: app shell is served from cache and refreshed in the background.
const CACHE = "lean-v5";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "ai.js",
  "barcode.js",
  "camera.js",
  "capture.js",
  "config.js",
  "db.js",
  "flows.js",
  "icons.js",
  "onboarding.js",
  "plan.js",
  "progress.js",
  "store.js",
  "ui.js",
  "util.js",
  "vendor/zxing.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Google Fonts: cache first, they never change.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === "opaque") c.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // App files: network first (fresh after every deploy), cache when offline or slow.
  event.respondWith(
    caches.open(CACHE).then(async (c) => {
      const cached = () =>
        c.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === "navigate" ? c.match("index.html") : undefined));
      const network = fetch(req).then((res) => {
        if (res.ok) c.put(req, res.clone());
        return res;
      });
      const first = await Promise.race([network.catch(() => null), new Promise((r) => setTimeout(r, 4000, null))]);
      if (first) return first;
      return (await cached()) || network.catch(() => Response.error());
    })
  );
});
