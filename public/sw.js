// Bump these on any change so old caches are purged on activate.
const VERSION = 'v2';
const RUNTIME_CACHE = `hustlers-way-runtime-${VERSION}`;
const STATIC_CACHE = `hustlers-way-static-${VERSION}`;

const STATIC_ASSETS = [
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-512.svg',
  '/apple-touch-icon.png',
  '/skyline.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache API / auth / function traffic — always live.
  if (
    url.pathname.includes('/api/') ||
    url.pathname.includes('/functions/') ||
    url.hostname.includes('supabase')
  ) {
    return;
  }

  // Only handle same-origin requests.
  if (url.origin !== self.location.origin) return;

  // Pages (navigations): NETWORK-FIRST so a new deploy is picked up immediately;
  // fall back to cache, then to the cached shell, when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/'))
        )
    );
    return;
  }

  // Static assets (hashed JS/CSS, images, fonts): STALE-WHILE-REVALIDATE —
  // serve fast from cache but refresh in the background so it never goes stale.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
