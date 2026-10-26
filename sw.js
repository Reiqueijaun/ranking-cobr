// Notificações do chat do clã. Não guarda nada em cache: o site sempre abre a versão mais nova.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Clã COBR', {
    body: d.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: d.tag,
    renotify: !!d.tag,
    data: { url: d.url || '/#chat' },
  }));
});

// tocou na notificação: abre o chat (ou traz a aba do site pra frente e vai pro chat)
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/#chat', self.registration.scope);
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((abas) => {
    const aba = abas.find((c) => new URL(c.url).origin === url.origin);
    if (aba) { aba.postMessage({ ir: url.hash || '#chat' }); return aba.focus(); }
    return self.clients.openWindow(url.href);
  }));
});
