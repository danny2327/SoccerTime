importScripts('./js/version.js');
const CACHE_NAME = 'soccertime-cache-' + APP_VERSION;
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/version.js',
  './js/utils.js',
  './js/storage.js',
  './js/field.js',
  './js/session.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // {cache: 'reload'} forces each of these past the browser's own HTTP cache - without it,
      // a precache built shortly after a previous deploy could silently pull one or two files
      // (whichever the browser's heuristic cache still considered "fresh") from that old
      // deploy instead of the one this CACHE_NAME is supposed to represent.
      .then((cache) => cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first, falling back to cache only when offline. This app is under active
// development - a cache-first strategy would silently keep serving stale JS/CSS after every
// update, which is worse than a slightly slower load while there's a live connection.
//
// `cache: 'no-store'` on the fetch itself is load-bearing, not decorative: without it, this
// "network-first" fetch can still be quietly satisfied out of the browser's own HTTP cache
// (distinct from the Cache Storage above) whenever it judges the response still fresh - so one
// file can come back stale even though this handler genuinely believes it just went to the
// network. That's exactly how a page can show the latest app.js while still running a session.js
// from a build ago.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => {
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('./index.html');
      }))
  );
});
