const CACHE_NAME = 'csrs-shell-v1';
const SHELL = [
  '/home.html', '/incidents.html', '/emergency.html',
  '/student-dashboard.html', '/dashboard.html',
  '/css/app.css', '/css/theme.css', '/css/dashboards.css',
  '/home.css', '/dashboard.css', '/config.js', '/js/csrs.js',
  '/home.js', '/incidents.js', '/emergency.js',
  '/student-dashboard.js', '/dashboard.js',
  '/manifest.webmanifest', '/icons/csrs-icon.svg', '/images/rp-logo.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('csrs-shell-') && key !== CACHE_NAME)
      .map((key) => caches.delete(key))
  )));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () =>
      (await caches.match(request)) || (await caches.match('/home.html'))
    ));
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
