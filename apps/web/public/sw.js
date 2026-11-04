/* Offline shell for MengYin Study. Registered only in production builds. */
const VERSION = 'mengyin-study-v7';
const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only the app shell belongs in the offline cache. /privacy/ and
          // /terms/ are standalone documents; storing one as the shell would
          // replace the offline app with a legal page.
          const url = new URL(request.url);
          if (url.pathname === new URL(self.registration.scope).pathname) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html').then((cached) => cached ?? caches.match('./'))),
    );
    return;
  }

  // The runtime manifest names versioned folders. Serving a stale one from
  // Cache Storage after a release would point at runtime files we pruned, so
  // this one file is network-first with an offline fallback.
  if (url.pathname.endsWith('/runtime-manifest.json')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached ?? new Response('', { status: 503, statusText: 'Offline' })),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? network;
    }),
  );
});
