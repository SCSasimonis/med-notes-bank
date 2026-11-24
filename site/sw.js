/* Med Notes Bank service worker: offline use after the first visit. Content is stored encrypted. */
const VER = "943985dec4", SHELL = "mnb-shell-" + VER, DATA = "mnb-data-" + VER;
const SHELL_FILES = ["./", "index.html", "assets/app.css?v=" + VER, "assets/app.js?v=" + VER, "assets/vault.js?v=" + VER,
  "assets/fonts/ibm-plex-sans-latin-400-normal.woff2", "manifest.webmanifest", "favicon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => (k.startsWith("mnb-shell-") || k.startsWith("mnb-data-")) && k !== SHELL && k !== DATA).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const networkFirst = async (req, cacheName) => {
  const c = await caches.open(cacheName);
  try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }
  catch (e) { const hit = await c.match(req, { ignoreSearch: req.mode === "navigate" }); if (hit) return hit; throw e; }
};
const cacheFirst = async (req, cacheName) => {
  const c = await caches.open(cacheName); const hit = await c.match(req); if (hit) return hit;
  const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r;
};
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  if (e.request.mode === "navigate" || u.pathname.endsWith("/meta.json") || /\/(data|questions)\.enc$/.test(u.pathname)) e.respondWith(networkFirst(e.request, u.pathname.includes("/content/") ? DATA : SHELL));
  else if (u.pathname.includes("/content/")) e.respondWith(cacheFirst(e.request, DATA));
  else e.respondWith(cacheFirst(e.request, SHELL));
});
