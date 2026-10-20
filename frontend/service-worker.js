const CACHE_NAME = 'csrs-shell-v5';
const SHELL = [
  '/home.html', '/incidents.html', '/emergency.html', '/forgot-password.html', '/reset-password.html',
  '/student-dashboard.html', '/dashboard.html',
  '/css/app.css', '/css/theme.css', '/css/dashboards.css',
  '/home.css', '/dashboard.css', '/config.js', '/js/csrs.js',
  '/home.js', '/incidents.js', '/emergency.js',
  '/student-dashboard.js', '/dashboard.js', '/forgot-password.js', '/reset-password.js',
  '/manifest.webmanifest', '/icons/csrs-icon.svg', '/images/rp-logo.jpg',
  '/pwa.js', '/i18n/en.json', '/i18n/rw.json'
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

  // Prefer the deployed asset while online; old cache-first entries kept
  // dashboard fixes and language resources stale for returning users.
  event.respondWith(fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  }).catch(async () => (await caches.match(request)) || Response.error()));
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) {}
  const title = payload.title || 'CSRS alert';
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.message || 'You have a new campus safety notification.',
    icon: '/icons/csrs-icon.svg',
    badge: '/icons/csrs-icon.svg',
    data: { url: payload.link || '/home.html' },
    tag: payload.type === 'emergency' ? 'csrs-emergency' : undefined,
    renotify: payload.type === 'emergency'
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data?.url || '/home.html';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    return existing ? existing.navigate(path).then(() => existing.focus()) : self.clients.openWindow(path);
  }));
});
