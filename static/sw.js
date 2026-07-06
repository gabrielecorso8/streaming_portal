/* SC Portal — service worker minimale.
   Serve solo a rendere installabili le app in home (telecomando + download).
   NON tocca /api/ né i media: quelli devono sempre passare dal server live. */
const SHELL = "scp-shell-v2";
const ASSETS = [
  "/index.html", "/app.js", "/styles.css",
  "/remote.html", "/remote.js",
  "/sc-192.png", "/sc-512.png", "/remote-192.png", "/remote-512.png",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS).catch(() => {})));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Mai intercettare API, media o richieste non-GET: sempre live dal server.
  if (req.method !== "GET" || url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/proxy") || url.pathname.startsWith("/covers")) {
    return;
  }
  // Shell statico: network-first, fallback alla cache se offline.
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok && (res.type === "basic" || res.type === "default")) {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req).then((m) => m || caches.match("/index.html")))
  );
});
