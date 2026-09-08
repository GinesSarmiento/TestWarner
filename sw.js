/** Service worker: shell cacheado para que la app abra sin cobertura. */

const CACHE = 'warner-tracker-v1';

const SHELL = [
  './',
  'index.html',
  'styles.css',
  'js/app.js',
  'js/api.js',
  'js/store.js',
  'js/geo.js',
  'js/map.js',
  'js/notify.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Los datos del parque y los tiles nunca se sirven de caché primero:
  // preferimos red y sólo caemos a lo guardado si falla.
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (url.hostname === 'pasecorrecaminos.es'
            || url.hostname.endsWith('openstreetmap.org')
            || url.hostname === 'cdnjs.cloudflare.com') {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
      return res;
    })),
  );
});
