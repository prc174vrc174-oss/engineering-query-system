const CACHE_NAME = 'engineering-query-pwa-v223-cloudflare-date-first';
const APP_SHELL = [
  './',
  './engineering-query.html',
  './fold-tool-pointed.html',
  './fold-tool-117.html',
  './engineering-coefficients.js',
  './nail-excel-upload.js',
  './nail-data.js',
  './common-words.js',
  './engineering-records-d1.js?v=223',
  './vendor/katex/katex-0.19.0.min.js',
  './favicon.svg',
  './app-icon-192.png',
  './app-icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // Remove the retired browser full-text cache when this update installs.
  if (self.indexedDB) self.indexedDB.deleteDatabase('engineering-records-cache-v2');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(APP_SHELL.map((path) => cache.add(path))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => {
        if (key !== CACHE_NAME) return caches.delete(key);
      })))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isHtml = request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/') || url.pathname === '';

  if (isHtml) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('./') || caches.match('./engineering-query.html')))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
