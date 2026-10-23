/* Congés Duo — service worker : réseau d'abord, cache en secours (hors ligne),
   et affichage des notifications de rappel. Changer la version à chaque mise à jour importante. */
const CACHE = 'conges-duo-v6', NOTIF = 'cd-notifs', LAST = './__derniere-notification';
const ASSETS = ['./', './index.html', './app.js', './manifest.json', './icon-192.png', './icon-512.png', './manrope.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== NOTIF).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  const last = { title: d.title || 'Congés Duo', body: d.body || '', at: Date.now() };
  e.waitUntil(Promise.all([
    self.registration.showNotification(last.title, {
      body: last.body, icon: 'icon-192.png', badge: 'icon-192.png', tag: d.tag || undefined, requireInteraction: true,
      vibrate: [200, 100, 200], data: { url: d.url || './' },
    }),
    // Garde le dernier rappel : l'app l'affiche sur l'accueil, même si la notification a été fermée.
    caches.open(NOTIF).then(c => c.put(LAST, new Response(JSON.stringify(last), { headers: { 'Content-Type': 'application/json' } }))),
  ]));
});

// Au toucher : l'app s'ouvre et réaffiche le message en grand.
self.addEventListener('notificationclick', e => {
  const n = e.notification;
  n.close();
  const msg = { type: 'notif', title: n.title, body: n.body };
  const url = './?notif=' + encodeURIComponent(JSON.stringify({ t: n.title, b: n.body }));
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async list => {
    for (const c of list) {
      // L'app est déjà ouverte : on la recharge avec le message, pour qu'il s'affiche même si elle était en arrière-plan.
      if ('navigate' in c) { try { const w = await c.navigate(url); if (w) return w.focus(); } catch (err) { /* on tente autrement */ } }
      if ('focus' in c) { c.postMessage(msg); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
