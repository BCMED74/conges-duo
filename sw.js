/* Congés Duo — l'app a déménagé sur https://duo.bltn.ch/app/
   Ce service worker remplace l'ancien et se retire tout seul : il vide les caches,
   désabonne les notifications de cette ancienne adresse (plus de doublons),
   se désinscrit, puis recharge les pages ouvertes sur la page « a déménagé ». */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch (err) { /* pas d'abonnement */ }
    await self.registration.unregister();
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const p of pages) { try { await p.navigate(p.url); } catch (err) { /* page déjà fermée */ } }
  })());
});

// Plus aucune interception : tout passe directement par le réseau.
self.addEventListener('fetch', () => {});
