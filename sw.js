// Notificações do chat do clã. Não guarda nada em cache: o site sempre abre a versão mais nova.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// iPhone e Mac cortam as notificações do site que recebe aviso sem mostrar nada
const APPLE = /iPhone|iPad|iPod|Macintosh/.test(self.navigator.userAgent) && !/Chrome|CriOS|Firefox|FxiOS|Edg/.test(self.navigator.userAgent);

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    // com o site aberto na frente, quem avisa é o próprio site (igual WhatsApp aberto)
    if (!APPLE) {
      const abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (abas.some((c) => c.visibilityState === 'visible' && c.focused)) return;
    }
    // várias do mesmo canal viram uma só: "#geral · 3 mensagens" com as últimas linhas
    let titulo = d.title || 'Clã COBR', corpo = d.body || '', linhas = d.linha ? [d.linha] : [], qtd = 1;
    if (d.tag && d.linha) {
      const antes = await self.registration.getNotifications({ tag: d.tag });
      for (const n of antes) {
        const x = n.data || {};
        if (Array.isArray(x.linhas)) { linhas = [...x.linhas, ...linhas]; qtd += x.qtd || x.linhas.length; }
      }
      linhas = linhas.slice(-5);
      if (qtd > 1) { titulo = `${d.grupo || titulo} · ${qtd} mensagens`; corpo = linhas.join('\n'); }
    }
    await self.registration.showNotification(titulo, {
      body: corpo,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: d.tag,
      renotify: !!d.tag,
      data: { url: d.url || '/#chat', canal: d.canal || null, linhas, qtd },
    });
  })());
});

// tocou na notificação: abre o chat no canal dela (ou traz a aba do site pra frente e vai pra lá)
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const dados = e.notification.data || {};
  const url = new URL(dados.url || '/#chat', self.registration.scope);
  if (dados.canal) url.searchParams.set('canal', dados.canal);
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((abas) => {
    const aba = abas.find((c) => new URL(c.url).origin === url.origin);
    if (aba) { aba.postMessage({ ir: url.hash || '#chat', canal: dados.canal || null }); return aba.focus(); }
    return self.clients.openWindow(url.href);
  }));
});
