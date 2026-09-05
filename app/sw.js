/* 新媒体运营工作台 — Service Worker（离线缓存 App 外壳） */
const CACHE = "xiaoshang-shell-v4";
const ASSETS = [
  "/",
  "/index.html",
  "/assets/css/tokens.css",
  "/assets/css/base.css",
  "/assets/css/layout.css",
  "/assets/css/components.css",
  "/assets/css/responsive.css",
  "/assets/css/pages/home.css",
  "/assets/css/pages/inspirations.css",
  "/assets/css/pages/contents.css",
  "/assets/css/pages/calendar.css",
  "/assets/css/pages/analytics.css",
  "/assets/css/pages/reports.css",
  "/assets/css/pages/observations.css",
  "/assets/css/pages/settings.css",
  "/assets/js/main.js",
  "/assets/js/router.js",
  "/assets/js/api/client.js",
  "/assets/js/components/chart.js",
  "/assets/js/components/modal.js",
  "/assets/js/components/shell.js",
  "/assets/js/components/toast.js",
  "/assets/js/pages/index.js",
  "/assets/js/pages/home.js",
  "/assets/js/pages/inspirations.js",
  "/assets/js/pages/contents.js",
  "/assets/js/pages/calendar.js",
  "/assets/js/pages/analytics.js",
  "/assets/js/pages/reports.js",
  "/assets/js/pages/observations.js",
  "/assets/js/pages/settings.js",
  "/assets/js/shared/dom.js",
  "/assets/js/shared/forms.js",
  "/assets/js/shared/format.js",
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
