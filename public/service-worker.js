const CACHE_NAME = 'spelling-bee-3d-20260611-073000';
const RUNTIME_CACHE = `${CACHE_NAME}-runtime`;
const CORE_ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => key.startsWith('spelling-bee-3d-') && key !== CACHE_NAME && key !== RUNTIME_CACHE ? caches.delete(key) : null)))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isLocal = url.origin === self.location.origin;
  const isVisualAsset = url.pathname === '/' || url.pathname.endsWith('.html') || url.pathname.includes('/assets/') || url.pathname.endsWith('.webp') || url.pathname.endsWith('.png') || url.pathname.endsWith('.svg');

  if (isLocal && url.pathname.includes('/splats/')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }

  if (isLocal && isVisualAsset) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(response => response)
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('/index.html')))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(RUNTIME_CACHE).then(cache => cache.put(event.request, copy)).catch(() => null);
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('/index.html')))
  );
});
