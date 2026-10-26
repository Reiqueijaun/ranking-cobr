// Entrega as notificações do chat. Quem chama é o próprio banco (gatilho chat_avisar_push, passo 7 do SQL),
// mandando o segredo, as chaves e a lista de aparelhos. Aqui não fica guardado nada: só confere o segredo.
const crypto = require('crypto');
const webpush = require('web-push');

// sha256 do segredo que está na tabela push_config (o segredo mesmo nunca vai pro repositório)
const HASH_SEGREDO = '23d835f8b7cc4135b041a0b0c7cd144b7d85eb0a8ba51fb24433f16e2439fb1e';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  const h = crypto.createHash('sha256').update(String(b.segredo || '')).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(h), Buffer.from(HASH_SEGREDO))) return res.status(403).end();
  webpush.setVapidDetails(b.sujeito, b.publica, b.privada);
  const envios = Array.isArray(b.envios) ? b.envios.slice(0, 500) : [];
  const mortos = [];
  await Promise.all(envios.map(async (e) => {
    try {
      await webpush.sendNotification({ endpoint: e.endpoint, keys: { p256dh: e.p256dh, auth: e.auth } }, JSON.stringify(e.payload || {}), { TTL: 3600, urgency: 'high' });
    } catch (err) {
      // aparelho que não existe mais (desinstalou, trocou de celular): sai da lista
      if (err && (err.statusCode === 404 || err.statusCode === 410)) mortos.push(e.endpoint);
    }
  }));
  if (mortos.length && /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(String(b.sb || ''))) {
    await fetch(`${b.sb}/rest/v1/rpc/push_remover`, {
      method: 'POST',
      headers: { apikey: b.chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_segredo: b.segredo, p_endpoints: mortos }),
    }).catch(() => {});
  }
  res.status(200).json({ enviados: envios.length - mortos.length, removidos: mortos.length });
};
