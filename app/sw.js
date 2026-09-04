/* 新媒体运营工作台 — Service Worker（离线缓存 App 外壳） */
const CACHE = "xiaoshang-shell-v2";
const ASSETS = [
  "/",
  "/index.html",
  "/assets/css/tokens.css",
  "/assets/css/base.css",
  "/assets/css/layout.css",
  "/assets/css/components.css",
  "/assets/css/responsive.css",
  "/assets/js/main.js",
  "/assets/js/router.js",
  "/manifest.webmanifest",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(ks =>
      Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(fetch(e.request));
    return;
  }
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("/index.html")));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r =>
      r || fetch(e.request).then(resp => {
        const cp = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, cp));
        return resp;
      }).catch(() => caches.match("/index.html"))
    )
  );
});
