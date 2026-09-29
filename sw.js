// Cache-first app shell. Bump VERSION on any shipped change to invalidate.
const VERSION = 'v2';
const CACHE = `tesla-viewer-${VERSION}`;
const SHELL = ['./', 'index.html', 'style.css', 'icon.svg', 'manifest.webmanifest',
  'js/app.js', 'js/library.js', 'js/md5.js', 'js/mp4.js', 'js/protobuf.js', 'js/sei.js', 'js/tesla-crypto.js', 'js/decrypt-ui.js', 'js/pwa.js', 'js/export.js', 'js/map.js'];
// ponytail: modules added by other features are cached at runtime on first fetch; add them to SHELL for offline-first-load.

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  })));
});
