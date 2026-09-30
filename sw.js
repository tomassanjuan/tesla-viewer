// Network-first app shell (offline falls back to cache). VERSION is stamped with the build sha by scripts/version.mjs.
const VERSION = 'dev';
const CACHE = `tesla-viewer-${VERSION}`;
const SHELL = ['./', 'index.html', 'style.css', 'icon.svg', 'manifest.webmanifest',
  'js/app.js', 'js/blur.js', 'js/decrypt-ui.js', 'js/export.js', 'js/graph.js', 'js/hevc.js', 'js/i18n.js', 'js/insights.js', 'js/layout.js', 'js/library.js', 'js/locales/de.js', 'js/locales/en.js', 'js/locales/es.js', 'js/locales/fr.js', 'js/locales/it.js', 'js/locales/ja.js', 'js/locales/nl.js', 'js/locales/pl.js', 'js/locales/pt.js', 'js/locales/zh.js', 'js/map.js', 'js/md5.js', 'js/mp4.js', 'js/protobuf.js', 'js/perf.js', 'js/progress.js', 'js/pwa.js', 'js/sei.js', 'js/seg.js', 'js/telemetry-worker.js', 'js/tesla-crypto.js', 'js/ui.js', 'js/version.js'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
