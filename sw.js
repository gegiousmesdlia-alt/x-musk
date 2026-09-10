/* sw.js — X Club v7 — bump cache version to force refresh */
const CACHE = 'xclub-v7';
const ASSETS = [
  './index.html',
  './style.css',
  './firebase.js',
  './cloudinary.js',
  './manifest.json',
  './config.js',
  './utils.js',
  './router.js',
  './auth.js',
  './feed.js',
  './discover.js',
  './profile.js',
  './notifications.js',
  './messages.js',
  './business.js',
  './sidebar.js',
  './admin.js',
  './boot.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isLocal = url.origin === self.location.origin;
  const isGet = e.request.method === 'GET';
  if (!isGet || !isLocal) { e.respondWith(fetch(e.request)); return; }
  // Network first — always get fresh JS/CSS, fall back to cache offline
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
