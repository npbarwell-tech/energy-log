// Offline support: the whole app (including PDF and barcode libraries) is cached on install.
const CACHE = "pat-log-v1";
const FILES = ["./", "index.html", "app.css", "app.js", "standards.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png",
  "vendor/jspdf.umd.min.js", "vendor/jspdf.plugin.autotable.min.js", "vendor/zxing.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("pat-log-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // Network first for the app's own code so updates arrive; fall back to cache offline.
  const url = new URL(e.request.url);
  const own = url.origin === location.origin && !url.pathname.includes("/vendor/");
  if (own) {
    e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(h => h || caches.match("index.html"))));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
