/*  Simple cache-first service-worker for Spelling-Bee-Meter  */
const CACHE   = 'bee-meter-v1';
const ASSETS  = [
  './',
  'index.html',
  'manifest.json',
  'service-worker.js',
  'intro.mp4',
  'BG-SPELLING-2025.jpg',
  'css/bee-id.png',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', evt => {
  evt.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', evt => {
  evt.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', evt => {
  evt.respondWith(
    caches.match(evt.request).then(res => res || fetch(evt.request))
  );
});
