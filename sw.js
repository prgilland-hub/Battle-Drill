/* Battle Drill service worker: serves the app from the cache so it works offline.
   Updates are installed by the page itself (Settings gear > Check for update). */
const CACHE = 'battle-drill';
const SHELL = ['index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== location.origin) return;
  if (u.pathname.endsWith('/version.json') || u.search) return; /* version checks and update downloads always use the network */
  if (r.mode === 'navigate' || u.pathname.endsWith('/') || u.pathname.endsWith('/index.html')) {
    e.respondWith(caches.match(new URL('index.html', self.registration.scope).href).then(m => m || fetch(r)));
    return;
  }
  e.respondWith(caches.match(r).then(m => m || fetch(r)));
});
