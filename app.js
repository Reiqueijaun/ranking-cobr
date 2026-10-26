// Ranking do clã — lógica do site. Não precisa mexer aqui;
// as configurações ficam no config.js.
(() => {
  'use strict';

  const CFG = window.RANKING_CONFIG || {};
  const TAG = (CFG.CLAN_TAG || 'COBR').trim();
  const PRINT_OBRIGATORIO = CFG.PRINT_OBRIGATORIO !== false;
  const configurado = !!CFG.SUPABASE_URL && !!CFG.SUPABASE_KEY &&
    !CFG.SUPABASE_URL.includes('COLE_AQUI') && !CFG.SUPABASE_KEY.includes('COLE_AQUI');
  const DEMO = !configurado;
  const BUCKET = 'prints';
  const MASSA_MIN = 10;
  const MASSA_MAX = 1000000;
  const $ = (id) => document.getElementById(id);
  let sb = null;
  let partidas = [];          // todas as pontuações, mais novas primeiro
  let periodo = 'mes';        // abre na temporada (mês atual)
  let modo = CFG.RANKING_POR === 'massa' ? 'massa' : 'pontos';
  let admin = null;           // { nome } quando quem está usando é admin (login do Supabase)
  let euId = null;            // id no elenco do jogador logado (login de jogador ou admin ligado ao jogador)
  let logins = new Map();     // só pro admin: id do jogador -> { email, admin, ultimo_acesso }
  let arquivoPrint = null;
  let jogadores = [];         // elenco do clã (tabela players)
  let elenco = new Map();     // chave do nick -> jogador do elenco
  let elencoOk = true;        // false se a tabela players ainda não existe no banco
  let jogPorId = new Map();   // id do elenco -> jogador (torneios guardam o id, não o nick)
  let torneios = [];          // tabela torneios (rascunho só vem pra admin)
  let lancamentos = [];       // resultados lançados na mão nos torneios (kills, massa extra...)
  let torneiosOk = true;      // false se as tabelas de torneio ainda não existem no banco
  let torneioAtual = null;    // id do torneio aberto na página própria
  const CARGOS = (Array.isArray(CFG.CARGOS) && CFG.CARGOS.length ? CFG.CARGOS : ['Líder', 'Vice-líder', 'Membro'])
    .map((c) => String(c).trim().slice(0, 24)).filter(Boolean);
  const CARGO_PADRAO = CARGOS.includes('Membro') ? 'Membro' : CARGOS[CARGOS.length - 1];

  // ---------- utilidades ----------
  const fmt = (n) => Number(n).toLocaleString('pt-BR');
  const dataCurta = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  function haQuanto(iso) {
    const s = (new Date(iso).getTime() - Date.now()) / 1000;
    const a = Math.abs(s);
    if (a < 60) return 'agora';
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
    return dataCurta(iso);
  }
  const reTag = new RegExp('^\\[?\\s*' + TAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\]?\\s*', 'i');
  const limparNick = (v) => String(v || '').replace(reTag, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  const chave = (nome) => limparNick(nome).toLocaleLowerCase('pt-BR');
  const comTag = (nome) => `[${TAG}] ${nome}`;
  function indexarElenco() {
    elenco = new Map(jogadores.map((r) => [chave(r.nick), r]));
    jogPorId = new Map(jogadores.map((r) => [r.id, r]));
  }
  const exMembro = (k) => { const r = elenco.get(k); return !!r && !r.ativo; };
  const nomeDe = (k, bruto) => (elenco.get(k) ? elenco.get(k).nick : limparNick(bruto));
  // pra busca: sem acento e sem maiúscula ("Grão" acha com "grao")
  const busca = (v) => chave(v).normalize('NFD').replace(/[̀-ͯ]/g, '');

  function el(tag, props, ...filhos) {
    const n = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'style') n.setAttribute('style', v);
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos.flat()) if (f != null && f !== false) n.append(f.nodeType ? f : document.createTextNode(String(f)));
    return n;
  }
  // replaceChildren que ignora os vazios (null vira texto "null" no replaceChildren puro)
  function trocar(box, ...filhos) { box.replaceChildren(...filhos.flat().filter((f) => f != null && f !== false)); }
  function svg(path, size = 20, extra = '') {
    const w = document.createElement('span');
    w.innerHTML = `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${path}</svg>`;
    return w.firstChild;
  }
  const ICONE_COROA = '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z"/>';
  const ICONE_TROFEU = '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>';
  const ICONE_MEDALHA = '<path d="M7.5 3h9M7.5 3l3.5 6.3M16.5 3L13 9.3"/><circle cx="12" cy="15" r="6"/><circle cx="12" cy="15" r="2.5"/>';
  const ICONE_LIXO = '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>';

  let toastTimer;
  function toast(msg, ruim = false) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('ruim', ruim);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3800);
  }
  function urlPrint(p) {
    if (p.print_url) return p.print_url;
    if (!p.print_path || !sb) return null;
    return sb.storage.from(BUCKET).getPublicUrl(p.print_path).data.publicUrl;
  }

  // ---------- cálculo do ranking ----------
  // base = instante de referência (o torneio "hora H" olha o ranking como estava naquela hora)
  function inicioPeriodo(per, base = Date.now()) {
    const d = new Date(base);
    d.setHours(0, 0, 0, 0);
    if (per === 'semana') { const dia = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dia); return d.getTime(); }
    if (per === 'mes') { d.setDate(1); return d.getTime(); }
    return 0;
  }

  // ---------- pontos ----------
  // 1 ponto a cada 1.000 de massa + bônus a cada meta batida (100K, 200K ... 1M).
  // O bônus cresce: 1ª meta +30, 2ª +40, 3ª +50...
  const MARCO = Number(CFG.MARCO) || 100000;
  const REGRA = CFG.PONTOS && !Array.isArray(CFG.PONTOS) ? CFG.PONTOS : {};
  const num = (v, padrao) => (v != null && isFinite(v) ? Number(v) : padrao);
  const POR_MIL = num(REGRA.POR_MIL, 1);
  const META = Number(REGRA.META) || 100000;
  const BONUS_META = num(REGRA.BONUS_META, 30);
  const BONUS_SOBE = num(REGRA.BONUS_SOBE, 10);
  const bonusDaMeta = (n) => BONUS_META + (n - 1) * BONUS_SOBE; // bônus da n-ésima meta
  function detalhePontos(massa) {
    const base = Math.floor(massa / 1000) * POR_MIL;
    const metas = Math.floor(massa / META);
    const bonus = metas * BONUS_META + BONUS_SOBE * metas * (metas - 1) / 2;
    return { base, metas, bonus, total: base + bonus };
  }
  const pontosDe = (massa) => detalhePontos(massa).total;
  const marcoTxt = fmtK(MARCO) + '+';
  function fmtK(n) {
    if (n >= 1e6 && n % 1e6 === 0) return `${n / 1e6}M`;
    return n >= 1000 && n % 1000 === 0 ? `${n / 1000}K` : fmt(n);
  }
  const ptsTxt = (n) => `${fmt(n)} ${n === 1 ? 'pt' : 'pts'}`;

  // ---------- leitura da massa ----------
  // Aceita do jeito que o pessoal escreve: 52430, 52.430, 52 430, 52 mil, 52k, 52,4k, 1 milhão.
  // Devolve { valor } ou { vazio | erro | decimal } e, se o número parecer curto demais, { pequeno, sugestao }.
  const SUFIXOS = [
    [/(milhoes|milhões|milhao|milhão|mi|kk)$/, 1e6],
    [/(mil|k)$/, 1e3],
    [/m$/, 0], // "m" sozinho: mil ou milhão, decide pelo tamanho
  ];
  function lerMassa(txt) {
    let s = String(txt || '').toLowerCase().replace(/\s+/g, '').replace(/(de)?massa$/, '');
    if (!s) return { vazio: true };
    let mult = 1;
    for (const [re, m] of SUFIXOS) if (re.test(s)) { s = s.replace(re, ''); mult = m; break; }
    if (!/^\d[\d.,]*$/.test(s) || /[.,]$/.test(s)) return { erro: true };
    let valor;
    if (mult !== 1) {
      // com "mil"/"k": vírgula ou ponto é casa decimal (52,4k = 52.400)
      if ((s.match(/[.,]/g) || []).length > 1) return { erro: true };
      const n = parseFloat(s.replace(',', '.'));
      if (!isFinite(n)) return { erro: true };
      if (mult === 0) mult = n * 1e6 > MASSA_MAX ? 1e3 : 1e6;
      valor = Math.round(n * mult);
    } else if (/^\d+$/.test(s)) {
      valor = parseInt(s, 10);
    } else if (/^\d{1,3}([.,]\d{3})+$/.test(s)) {
      valor = parseInt(s.replace(/[.,]/g, ''), 10); // 52.430 ou 52,430
    } else if (/^\d+[.,]\d{1,2}$/.test(s)) {
      // 52,4 sem "mil": massa não tem casa decimal, provavelmente faltou o "mil"
      return { decimal: true, sugestao: Math.round(parseFloat(s.replace(',', '.')) * 1000) };
    } else {
      return { erro: true };
    }
    const r = { valor };
    if (mult === 1 && valor > 0 && valor < 1000) { r.pequeno = true; r.sugestao = valor * 1000; }
    return r;
  }

  // todos = true inclui quem saiu do clã (ex-membros ficam fora do ranking)
  // per pode ser 'geral' | 'semana' | 'mes' ou um instante de início; ate = fim (exclusivo)
  function montarRanking(per, ordem = modo, todos = false, ate = Infinity) {
    const desde = typeof per === 'number' ? per : inicioPeriodo(per);
    const mapa = new Map();
    // percorre do mais antigo pro mais novo para o nome mais recente prevalecer
    for (let i = partidas.length - 1; i >= 0; i--) {
      const p = partidas[i];
      const t = new Date(p.created_at).getTime();
      if (t < desde || t >= ate) continue;
      const k = chave(p.player);
      if (!todos && exMembro(k)) continue;
      let j = mapa.get(k);
      if (!j) { j = { chave: k, nome: '', melhor: p, qtd: 0, pontos: 0, cem: 0, soma: 0, ultima: p.created_at }; mapa.set(k, j); }
      j.nome = nomeDe(k, p.player);
      j.qtd += 1;
      j.pontos += pontosDe(p.mass);
      j.soma += p.mass;
      j.ultima = p.created_at;
      if (p.mass >= MARCO) j.cem += 1;
      if (p.mass > j.melhor.mass) j.melhor = p;
    }
    const porMassa = (a, b) => b.melhor.mass - a.melhor.mass || new Date(a.melhor.created_at) - new Date(b.melhor.created_at);
    const porPontos = (a, b) => b.pontos - a.pontos || b.cem - a.cem || porMassa(a, b);
    return [...mapa.values()].sort(ordem === 'massa' ? porMassa : porPontos);
  }

  // ---------- temporadas (uma por mês) ----------
  // Da mais nova pra mais velha; a do mês atual vem marcada como em andamento.
  function montarTemporadas() {
    if (!partidas.length) return [];
    const velha = new Date(partidas[partidas.length - 1].created_at);
    const limite = new Date(velha.getFullYear(), velha.getMonth(), 1).getTime();
    const hoje = new Date();
    const lista = [];
    for (let d = new Date(hoje.getFullYear(), hoje.getMonth(), 1); d.getTime() >= limite; d = new Date(d.getFullYear(), d.getMonth() - 1, 1)) {
      const fim = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
      const top = montarRanking(d.getTime(), 'pontos', true, fim).filter((j) => j.pontos > 0);
      if (top.length) lista.push({ inicio: d.getTime(), fim, atual: fim > Date.now(), top });
    }
    return lista;
  }
  // quantas temporadas (já fechadas) cada jogador ganhou
  function contarTitulos(temps) {
    const n = new Map();
    for (const t of temps) if (!t.atual) n.set(t.top[0].chave, (n.get(t.top[0].chave) || 0) + 1);
    return n;
  }
  const nomeMes = (t) => new Date(t).toLocaleDateString('pt-BR', { month: 'long' });

  // ---------- troféus das temporadas ----------
  // Cada temporada tem a pedra do mês dela nas faixas da base, nos olhos das cobras e no globo.
  const GEMAS = [
    ['Granada', '#C21E3A'], ['Ametista', '#9B5DE5'], ['Água-marinha', '#4FD1E6'], ['Diamante', '#DCEBFF'],
    ['Esmeralda', '#14C36B'], ['Pérola', '#EFE4D2'], ['Rubi', '#E8174F'], ['Peridoto', '#A3D930'],
    ['Safira', '#2F63E0'], ['Turmalina', '#FF4FA3'], ['Topázio', '#FF8A2B'], ['Turquesa', '#22C7B8'],
  ];
  function misturar(hex, alvo, t) {
    const a = parseInt(hex.slice(1), 16), b = parseInt(alvo.slice(1), 16);
    const c = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
    return '#' + ((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1);
  }
  const escXml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let trofeuSeq = 0;
  // mes 0-11; nick vazio = troféu ainda em disputa
  function trofeuSVG(mes, ano, nick) {
    const id = 'tf' + (++trofeuSeq);
    const g = GEMAS[mes % 12][1];
    const gc = misturar(g, '#FFFFFF', 0.55), ge = misturar(g, '#000000', 0.55);
    const mesTxt = new Date(ano, mes, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase();
    const bruto = nick ? nick.toUpperCase() : 'EM DISPUTA';
    const placa = escXml(bruto);
    const fonte = Math.min(15, Math.round(80 / (bruto.length * 0.47) * 10) / 10); // nick grande diminui pra caber na placa
    // largura da base cresce pra baixo (estilo taça do mundo)
    const faixa = (y1, y2, fill) => {
      const w = (y) => 30 + (y - 236) * 0.2;
      return `<path d="M${100 - w(y1)} ${y1}H${100 + w(y1)}L${100 + w(y2)} ${y2}H${100 - w(y2)}Z" fill="${fill}"/>`;
    };
    const cobraLow = 'M76 254C68 226 124 222 120 196';
    const cobraUp = 'M120 196C117 166 58 168 56 134C54 112 42 94 48 70C53 48 64 34 80 31';
    const cobra = (d) => `<path d="${d}" stroke="#3E2304" stroke-width="15"/>`
      + `<path d="${d}" stroke="url(#${id}o)" stroke-width="12"/>`
      + `<path d="${d}" stroke="#5A3305" stroke-opacity=".5" stroke-width="7" stroke-dasharray="1.5 4.5"/>`
      + `<path d="${d}" stroke="#FFF8D8" stroke-opacity=".6" stroke-width="2.2" transform="translate(-1.6 -2)"/>`;
    const cabeca = `<g transform="translate(80 31) rotate(-12)">`
      + `<path d="M-7 -9C1 -11 8 -6 13 -3.2C16 -1.6 16 1.6 13 3.2C8 6 1 11 -7 9Z" fill="url(#${id}h)" stroke="#3E2304" stroke-width="1.4"/><path d="M-3 -6C3 -6 8 -3 11 -1" stroke="#FFF8D8" stroke-opacity=".7" stroke-width="1.2" fill="none"/>`
      + `<circle cx="7" cy="2.2" r="2.2" fill="${gc}"/><circle cx="7.3" cy="2.2" r="1.1" fill="${ge}"/>`
      + `<path d="M15.5 0H19M19 0L21 -1.8M19 0L21 1.8" stroke="#FF4D3D" stroke-width="1.1" fill="none"/></g>`;
    const lado = (inv) => `<g${inv ? ' transform="translate(200 0) scale(-1 1)"' : ''}>`;
    return `<svg class="trofeu-svg" viewBox="0 0 200 340" role="img" aria-label="Troféu da temporada de ${mesTxt} ${ano}${nick ? ', campeão ' + escXml(nick) : ''}" xmlns="http://www.w3.org/2000/svg">
<defs>
<linearGradient id="${id}o" gradientUnits="userSpaceOnUse" x1="36" y1="0" x2="164" y2="0">
<stop offset="0" stop-color="#6B3F07"/><stop offset=".28" stop-color="#F2C64A"/><stop offset=".42" stop-color="#FFF3C0"/><stop offset=".58" stop-color="#E3A92B"/><stop offset="1" stop-color="#5E3505"/></linearGradient>
<linearGradient id="${id}c" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="#4A2A04"/><stop offset=".45" stop-color="#C98E1E"/><stop offset="1" stop-color="#3E2304"/></linearGradient>
<radialGradient id="${id}s" cx=".36" cy=".3" r=".75">
<stop offset="0" stop-color="#FFF8D6"/><stop offset=".25" stop-color="#F6CF56"/><stop offset=".7" stop-color="#B57812"/><stop offset="1" stop-color="#4E2B04"/></radialGradient>
<linearGradient id="${id}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF0B0"/><stop offset=".5" stop-color="#D99A22"/><stop offset="1" stop-color="#6B3F07"/></linearGradient>
<linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${gc}"/><stop offset=".45" stop-color="${g}"/><stop offset="1" stop-color="${ge}"/></linearGradient>
<linearGradient id="${id}p" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#2E2016"/><stop offset="1" stop-color="#0C0806"/></linearGradient>
<linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1">
<stop offset=".35" stop-color="#FFF" stop-opacity="0"/><stop offset=".5" stop-color="#FFF" stop-opacity=".75"/><stop offset=".65" stop-color="#FFF" stop-opacity="0"/></linearGradient>
<clipPath id="${id}k"><circle cx="100" cy="78" r="44"/><path d="M84 236C93 220 95 205 95 190C95 165 86 140 78 120H122C114 140 105 165 105 190C105 205 107 220 116 236Z"/><path d="M70 236H130L142 296H58Z"/></clipPath>
</defs>
<ellipse cx="100" cy="334" rx="74" ry="5" fill="#000" opacity=".55"/>
<path d="M84 236C93 220 95 205 95 190C95 165 86 140 78 120H122C114 140 105 165 105 190C105 205 107 220 116 236Z" fill="url(#${id}c)"/>
<circle cx="100" cy="78" r="44" fill="url(#${id}s)"/>
<g fill="none" stroke="#6B3A06" stroke-opacity=".45" stroke-width="1.4">
<ellipse cx="100" cy="78" rx="18" ry="44"/><ellipse cx="100" cy="78" rx="33" ry="44"/><path d="M56 78H144M61 56C85 64 115 64 139 56M61 100C85 92 115 92 139 100"/></g>
<path d="M100 62L113 74L100 98L87 74Z" fill="url(#${id}g)" stroke="#3E2304" stroke-width="1.2"/>
<path d="M87 74H113M100 62L95 74L100 98L105 74Z" fill="none" stroke="#FFF" stroke-opacity=".45" stroke-width=".8"/>
<ellipse cx="84" cy="56" rx="13" ry="8" fill="#FFF" opacity=".45" transform="rotate(-30 84 56)"/>
<g fill="none" stroke-linecap="round">
${lado(true)}${cobra(cobraLow)}</g>
${lado(false)}${cobra(cobraLow)}${cobra(cobraUp)}</g>
${lado(true)}${cobra(cobraUp)}</g>
</g>
${lado(false)}${cabeca}</g>${lado(true)}${cabeca}</g>
${faixa(236, 245, `url(#${id}o)`)}${faixa(245, 261, `url(#${id}g)`)}${faixa(261, 267, `url(#${id}o)`)}${faixa(267, 283, `url(#${id}g)`)}${faixa(283, 296, `url(#${id}o)`)}
<path d="M72 248H128M70 274H130" stroke="#FFF" stroke-opacity=".35" stroke-width="1"/>
<g class="trofeu-brilho" clip-path="url(#${id}k)"><rect x="-200" y="0" width="160" height="340" fill="url(#${id}b)"/></g>
<path d="M44 296H156L164 332H36Z" fill="url(#${id}p)" stroke="#8A5A14" stroke-width="1.5"/>
<rect x="58" y="303" width="84" height="25" rx="3" fill="url(#${id}o)" stroke="#3E2304" stroke-width="1"/>
<text x="100" y="312.5" text-anchor="middle" font-family="Chakra Petch, sans-serif" font-size="7" font-weight="700" letter-spacing="1.5" fill="#3E2304">${mesTxt} · ${ano}</text>
<text x="100" y="325" text-anchor="middle" font-family="Teko, Impact, sans-serif" font-weight="700" fill="#2A1703" font-size="${fonte}">${placa}</text>
</svg>`;
  }
  function trofeuDe(t, cls = '') {
    const d = new Date(t.inicio);
    const w = el('span', { class: `trofeu ${cls}` });
    w.innerHTML = trofeuSVG(d.getMonth(), d.getFullYear(), t.atual ? '' : t.top[0].nome);
    return w;
  }
  // "2026-09": vai no link ?trofeu= e marca qual cerimônia já foi vista
  const chaveTemp = (t) => { const d = new Date(t.inicio); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const gemaDe = (t) => GEMAS[new Date(t.inicio).getMonth()];
  function rotTemp(t) {
    const ano = new Date(t.inicio).getFullYear();
    return `${nomeMes(t.inicio).toUpperCase()}${ano !== new Date().getFullYear() ? ' ' + ano : ''}`;
  }

  // k0 = só os momentos de um jogador; limite = quantos devolver
  function montarConquistas(k0 = null, limite = 6) {
    const eventos = [];
    const melhores = new Map();
    const cems = new Map();
    let lider = null; // {chave, nome, massa}
    for (let i = partidas.length - 1; i >= 0; i--) {
      const p = partidas[i];
      const k = chave(p.player);
      const nome = limparNick(p.player);
      let marcou = false;
      if (p.mass >= MARCO) {
        const n = (cems.get(k) || 0) + 1;
        cems.set(k, n);
        eventos.push({ chave: k, tipo: 'cem', quando: p.created_at, partes: [b(nome), ' fez ', b(marcoTxt), ` (${fmt(p.mass)})`, n > 1 ? ` · ${n}ª vez` : ' pela primeira vez'] });
        marcou = true;
      }
      const antes = melhores.get(k) || 0;
      if (p.mass <= antes) continue;
      melhores.set(k, p.mass);
      if (!lider || p.mass > lider.massa) {
        if (!lider) eventos.push({ chave: k, tipo: 'topo', quando: p.created_at, partes: [b(nome), ' abriu o ranking com ', b(fmt(p.mass))] });
        else if (lider.chave === k) eventos.push({ chave: k, tipo: 'topo', quando: p.created_at, partes: [b(nome), ' aumentou o recorde do clã para ', b(fmt(p.mass))] });
        else eventos.push({ chave: k, tipo: 'topo', quando: p.created_at, partes: [b(nome), ' passou ', b(lider.nome), ' e agora tem o recorde do clã: ', b(fmt(p.mass))] });
        lider = { chave: k, nome, massa: p.mass };
      } else if (antes > 0 && !marcou) {
        eventos.push({ chave: k, tipo: 'recorde', quando: p.created_at, partes: [b(nome), ' bateu o próprio recorde: ', b(fmt(p.mass))] });
      }
    }
    return eventos.filter((e) => !k0 || e.chave === k0).reverse().slice(0, limite);
  }
  function b(t) { return el('b', { text: t }); }

  // ---------- desenho da página ----------
  function render() {
    cachePat = null;
    cacheTrofeus = null;
    cacheRei = undefined;
    const geralMassa = montarRanking('geral', 'massa');
    const geralPontos = montarRanking('geral', 'pontos');
    const rank = montarRanking(periodo, modo);

    // números do topo
    const recordista = geralMassa[0];
    $('stRecorde').textContent = recordista ? fmt(recordista.melhor.mass) : '—';
    $('stRecordeDono').textContent = recordista ? 'por ' + comTag(recordista.nome) : 'ninguém ainda';
    const lider = geralPontos[0];
    $('stLider').textContent = lider ? ptsTxt(lider.pontos) : '—';
    $('stLiderDono').textContent = lider ? comTag(lider.nome) : 'ninguém ainda';
    $('stCem').textContent = fmt(partidas.filter((p) => p.mass >= MARCO).length);
    $('stCemSub').textContent = 'somando o clã todo';

    const temps = montarTemporadas();
    const ctx = { pontos: geralPontos, massa: geralMassa, semana: montarRanking('semana', 'pontos'), temps, titulos: contarTitulos(temps) };
    renderDestaques(ctx);
    renderTorneios();
    renderPodio(rank, ctx);
    renderTabela(rank, ctx);
    renderConquistas();
    renderPatentes();
    renderFimTemporada();
    renderRei();
    renderTemporadas(ctx);
    renderHall();
    renderPartidas();
    renderJogadores();
    if (chat.eu && chatVisivel()) desenharMembrosChat();

    // só admin vê os formulários (e o banco confere de novo em cada ação)
    $('registrar').hidden = !admin;
    $('comoEntrar').hidden = !!admin;
    $('btnTopoRegistrar').hidden = !admin;
    $('bbRegistrar').hidden = !admin;
    $('bbBusca').hidden = !!admin;
    $('formCadastro').hidden = !admin || !elencoOk;
    $('avisoElenco').hidden = !admin || elencoOk;
    document.body.classList.toggle('modo-dono', !!admin);

    // página que ficou vazia (ex.: o único torneio foi apagado) volta pro ranking
    $('menuTrofeus').hidden = $('temporadas').hidden && $('hall').hidden;
    if ($('menuTrofeus').hidden) $('bbTrofeus').hidden = true;
    if (pagAtual && !temConteudo(pagAtual)) mostrarPagina(!perfilAtual && !torneioAtual);
    else marcarMenu();

    if (admin) renderSugNick();
    if ($('dlgBusca').open) renderBusca();
    if (perfilAtual) renderPerfil();
    if (torneioAtual) renderTorneioPagina();
    renderEu();
    tickContagens();
  }

  // ---------- nicks pra tocar e preencher no registro ----------
  // quem jogou por último aparece primeiro; depois o resto do elenco
  function nicksConhecidos() {
    const mapa = new Map();
    for (const p of partidas) { const k = chave(p.player); if (!mapa.has(k) && !exMembro(k)) mapa.set(k, nomeDe(k, p.player)); }
    for (const r of jogadores) if (r.ativo && !mapa.has(chave(r.nick))) mapa.set(chave(r.nick), r.nick);
    return [...mapa.values()];
  }
  function renderSugNick() {
    const q = busca($('fNome').value);
    let lista = nicksConhecidos();
    if (q) {
      lista = lista.filter((n) => busca(n).includes(q) && busca(n) !== q)
        .sort((a, b) => busca(b).startsWith(q) - busca(a).startsWith(q));
    }
    $('sugNick').replaceChildren(...lista.slice(0, q ? 6 : 8).map((n) => el('button', {
      type: 'button', class: 'sug', text: n,
      onclick: () => { $('fNome').value = n; $('fNome').dispatchEvent(new Event('input')); $('fMassa').focus(); },
    })));
  }

  // ---------- campo de massa: mostra como vai entrar antes de enviar ----------
  let confirmarPequena = null;
  function mostrarMassa() {
    const r = lerMassa($('fMassa').value);
    const box = $('valePontos');
    box.className = 'massa-lida';
    $('btnMil').classList.toggle('chama', !!r.sugestao);
    const usar = (v) => el('button', { type: 'button', class: 'usar', text: `Usar ${fmt(v)}`, onclick: () => aplicarMassa(v) });
    if (r.vazio) { box.replaceChildren(); return; }
    if (r.erro) { box.classList.add('ruim'); box.replaceChildren('Não entendi esse número. Escreve tipo 52430 ou 52 mil.'); return; }
    if (r.decimal) { box.classList.add('alerta'); box.replaceChildren(el('span', { class: 'ml-aviso', text: `Massa não tem vírgula. Era ${fmt(r.sugestao)}?` }), usar(r.sugestao)); return; }
    if (r.valor > MASSA_MAX) { box.classList.add('ruim'); box.replaceChildren(`${fmt(r.valor)} passa de ${fmt(MASSA_MAX)}. Confere o número.`); return; }
    const d = detalhePontos(r.valor);
    box.replaceChildren(...[
      el('span', { class: 'ml-rot', text: 'VAI ENTRAR COMO' }),
      el('b', { text: fmt(r.valor) }),
      el('span', { class: 'ml-pts', text: `${d.total ? '+' + ptsTxt(d.total) : 'sem pontos'}${d.bonus ? ` (${fmt(d.base)} + ${fmt(d.bonus)} de bônus)` : ''}${r.valor >= MARCO ? ' · ' + marcoTxt : ''}` }),
      r.pequeno ? el('span', { class: 'ml-aviso' }, `Só ${fmt(r.valor)} de massa? Se for ${fmt(r.sugestao)}: `, usar(r.sugestao)) : null,
    ].filter(Boolean));
    if (r.pequeno) box.classList.add('alerta');
  }
  function aplicarMassa(v) {
    $('fMassa').value = fmt(v);
    confirmarPequena = null;
    mostrarErro(null);
    mostrarMassa();
  }
  function multiplicarMil() {
    const r = lerMassa($('fMassa').value);
    if (r.sugestao) { aplicarMassa(r.sugestao); return; }
    if (r.vazio) { $('fMassa').focus(); toast('Digita o número primeiro, tipo 52, e depois toca em × MIL.'); return; }
    if (r.valor) toast(`${fmt(r.valor)} já está completo, não precisa do × MIL.`);
  }

  // ---------- busca rápida de jogador ----------
  let achados = [];
  function abrirBusca() {
    const dlg = $('dlgBusca');
    $('fBuscaGlobal').value = '';
    renderBusca();
    if (!dlg.open) dlg.showModal();
    $('listaBusca').scrollTop = 0;
    $('fBuscaGlobal').focus();
  }
  function renderBusca() {
    const bruto = $('fBuscaGlobal').value.trim();
    const q = busca(bruto);
    const stats = new Map(montarRanking('geral', 'pontos', true).map((j) => [j.chave, j]));
    const pos = new Map(montarRanking('geral', 'pontos').map((j, i) => [j.chave, i + 1]));
    achados = listaElenco()
      .filter((r) => !q || busca(r.nick).includes(q))
      .map((r) => ({ r, s: stats.get(r.chave), pos: pos.get(r.chave) || 0, comeca: !!q && busca(r.nick).startsWith(q) }))
      .sort((a, b) => (b.comeca - a.comeca) || (b.r.ativo - a.r.ativo) || ((a.pos || 1e9) - (b.pos || 1e9)) || a.r.nick.localeCompare(b.r.nick, 'pt-BR'));
    $('buscaAtalhos').hidden = !!q;
    $('buscaAtalhos').querySelector('[href="#hall"]').hidden = $('hall').hidden;
    $('buscaAtalhos').querySelector('[href="#temporadas"]').hidden = $('temporadas').hidden;
    $('buscaAtalhos').querySelector('[href="#torneios"]').hidden = $('torneios').hidden;
    const ul = $('listaBusca');
    if (!achados.length) {
      ul.replaceChildren(el('li', { class: 'busca-vazio', text: q ? `Ninguém com "${bruto}" no nick.` : 'Nenhum jogador ainda.' }));
      return;
    }
    ul.replaceChildren(...achados.slice(0, 80).map(({ r, s, pos: p }) => el('li', null,
      el('button', { type: 'button', class: 'busca-item', onclick: () => irPerfil(r.chave) },
        el('span', { class: `busca-pos pos p${p}`, text: p ? `#${p}` : '–' }),
        avatarDe(r.nick, ptsPat(r.chave)),
        el('span', { class: 'busca-info' },
          el('span', { class: 'busca-nome' }, el('span', { class: 'busca-nick', text: r.nick }), !r.ativo ? el('span', { class: 'ex-chip', text: 'EX' }) : null),
          el('span', { class: 'busca-sub', text: s ? `${ptsTxt(s.pontos)} · recorde ${fmt(s.melhor.mass)} · ${s.qtd} ${s.qtd === 1 ? 'partida' : 'partidas'}` : 'ainda sem partida' })),
        chipPatente(ptsPat(r.chave), 'busca-pat')))));
  }
  function irPerfil(k) {
    $('dlgBusca').close();
    abrirPerfil(k);
  }

  // ---------- páginas ----------
  // Em vez de uma rolagem só com tudo empilhado, cada item do menu abre a sua página
  // (as seções com data-pag="..."). O #endereço diz qual: #torneios, #jogadores...;
  // sem # (ou com um # que não existe) abre o ranking. #hall, #tabela etc. abrem a
  // página de quem eles fazem parte e rolam até lá.
  const PAG_INICIO = 'ranking';
  const RAIZES = new Set(['ranking', 'torneios', 'temporadas', 'jogadores', 'partidas', 'patentes', 'chat']); // abrem no topo da página
  let pagAtual = null;
  function alvoDoEndereco(hash) {
    const id = decodeURIComponent(String(hash || '').slice(1));
    const n = id ? document.getElementById(id) : null;
    const sec = n && n.closest('#principal [data-pag]');
    return sec ? { pag: sec.dataset.pag, n, raiz: RAIZES.has(id) } : { pag: PAG_INICIO, n: null, raiz: true };
  }
  const secoesDa = (pag) => [...document.querySelectorAll(`#principal [data-pag="${pag}"]`)];
  const temConteudo = (pag) => secoesDa(pag).some((s) => !s.hidden);
  // pula direto, sem a rolagem suave do site (trocar de página não é rolar)
  function rolarJa(destino) {
    const h = document.documentElement;
    h.style.scrollBehavior = 'auto';
    if (typeof destino === 'number') scrollTo(0, destino); else destino.scrollIntoView({ block: 'start' });
    h.style.scrollBehavior = '';
  }
  function mostrarPagina(rolar = true) {
    let { pag, n, raiz } = alvoDoEndereco(location.hash);
    if (!temConteudo(pag)) { pag = PAG_INICIO; n = null; raiz = true; }
    const mudou = pag !== pagAtual;
    pagAtual = pag;
    document.querySelectorAll('#principal [data-pag]').forEach((s) => s.classList.toggle('fora', s.dataset.pag !== pag));
    document.body.dataset.pag = pag;
    marcarMenu();
    if (pag === 'chat') abrirChatPagina();
    if (mudou) {
      const m = $('principal');
      m.classList.remove('pag-entra');
      void m.offsetWidth; // reinicia a animação de entrada
      m.classList.add('pag-entra');
    }
    if (rolar) rolarJa(n && !raiz && !n.hidden ? n : 0);
  }
  // menu de cima, barra de baixo e janela "Mais" marcam a página aberta
  function marcarMenu() {
    const pag = perfilAtual || torneioAtual ? null : pagAtual;
    let naBarra = false;
    document.querySelectorAll('.menu a, #barraBaixo a, #maisGrade a').forEach((a) => {
      const sim = !!pag && alvoDoEndereco(a.getAttribute('href')).pag === pag && a.getAttribute('href') !== '#hall';
      a.classList.toggle('ativo', sim);
      if (sim) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      if (sim && !a.hidden && a.closest('#barraBaixo')) naBarra = true;
    });
    $('bbMais').classList.toggle('ativo', !!pag && !naBarra && pag !== PAG_INICIO);
  }
  // abre uma página do site (vale também de dentro do perfil ou do torneio)
  function irPara(hash) {
    const url = location.pathname + (hash && hash.length > 1 ? hash : '');
    if (location.pathname + location.search + location.hash !== url) history.pushState({}, '', url);
    mostrarRota(false, false);
  }
  function irRegistrar() {
    irPara('#registrar');
    $('fNome').focus({ preventScroll: true });
  }
  function abrirMais() {
    const dlg = $('dlgMais');
    $('maisTorneios').hidden = $('torneios').hidden || !$('bbTorneios').hidden;
    $('maisTrofeus').hidden = $('temporadas').hidden || !$('bbTrofeus').hidden;
    $('maisHall').hidden = $('hall').hidden;
    if (!dlg.open) dlg.showModal();
    dlg.focus(); // sem anel de foco no X logo de cara
  }

  // ---------- jogadores do clã (elenco + tabelas) ----------
  let perJog = 'geral';
  let vistaJog = 'resumo';
  let filtroJog = 'ativos';
  let buscaJog = '';
  let ordJog = { campo: 'pontos', desc: true };
  let planilha = null;        // o que está na tabela agora, pronto para baixar
  const ICONE_LAPIS = '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>';
  const textoPer = { geral: 'desde o início', semana: 'nesta semana', mes: 'neste mês' };

  // elenco + quem tem partida mas não está cadastrado (não deveria acontecer, mas não some ninguém)
  function listaElenco() {
    const lista = jogadores.map((r) => ({ ...r, chave: chave(r.nick) }));
    const vistos = new Set(lista.map((r) => r.chave));
    for (const p of partidas) {
      const k = chave(p.player);
      if (vistos.has(k)) continue;
      vistos.add(k);
      lista.push({ id: null, nick: limparNick(p.player), cargo: '', ativo: true, created_at: null, chave: k, semCadastro: true });
    }
    return lista;
  }

  function filtrarElenco(lista, temPartida) {
    const q = chave(buscaJog);
    return lista.filter((r) => {
      if (q && !r.chave.includes(q)) return false;
      if (filtroJog === 'ativos') return r.ativo;
      if (filtroJog === 'ex') return !r.ativo;
      if (filtroJog === 'parados') return r.ativo && !temPartida(r.chave);
      return true;
    });
  }

  // Líder primeiro, depois a ordem do CARGOS; cargo desconhecido vai pro fim
  function ordemCargo(c) { const i = CARGOS.indexOf(c); return i < 0 ? CARGOS.length + (c ? 0 : 1) : i; }
  function chipCargo(r) {
    if (!r.cargo) return null;
    const lider = CARGOS.indexOf(r.cargo);
    return el('span', { class: `cargo ${lider === 0 ? 'cargo-1' : lider === 1 && CARGOS.length > 2 ? 'cargo-2' : ''}`, text: r.cargo });
  }

  function cabecalho(colunas) {
    $('cabJog').replaceChildren(el('tr', null, ...colunas.map((c) => {
      if (!c.ord) return el('th', { class: c.dir ? 'dir' : null, text: c.rot });
      const ativo = ordJog.campo === c.id;
      return el('th', { class: `${c.dir ? 'dir' : ''} ${ativo ? 'ativo' : ''}`, 'aria-sort': ativo ? (ordJog.desc ? 'descending' : 'ascending') : 'none' },
        el('button', { type: 'button', class: 'ord', title: c.titulo || null, onclick: () => {
          ordJog = ativo ? { campo: c.id, desc: !ordJog.desc } : { campo: c.id, desc: !c.texto };
          renderJogadores();
        } }, c.rot, el('span', { class: 'seta', 'aria-hidden': 'true', text: ativo ? (ordJog.desc ? '▼' : '▲') : '' })));
    })));
  }

  function ordenar(linhas) {
    const { campo, desc } = ordJog;
    const nome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');
    return linhas.sort((a, b) => {
      const va = a[campo], vb = b[campo];
      const c = typeof va === 'string' ? va.localeCompare(vb, 'pt-BR') : va - vb;
      return (desc ? -c : c) || b.pontos - a.pontos || nome(a, b);
    });
  }

  function celNome(r, ptsGeral) {
    return el('td', { class: 'nome-cel' }, el('div', { class: 'nome-linha' },
      avatarDe(r.nick, ptsGeral, 'av-p'),
      el('button', { type: 'button', class: 'link-nome forte', onclick: () => abrirPerfil(r.chave), 'aria-label': `Ver perfil de ${comTag(r.nick)}` }, r.nick),
      !r.ativo ? el('span', { class: 'ex-chip', text: 'EX-MEMBRO' }) : null,
      r.semCadastro && admin && elencoOk ? el('span', { class: 'ex-chip', text: 'SEM CADASTRO' }) : null));
  }
  function celEditar(r) {
    if (!admin) return null;
    return el('td', { class: 'dir' }, r.id
      ? el('button', { type: 'button', class: 'editar', 'aria-label': `Editar ${r.nick}`, onclick: () => abrirEditar(r) }, svg(ICONE_LAPIS, 18))
      : null);
  }

  function renderJogadores() {
    const lista = listaElenco();
    const ptsGeral = ptsPat; // a patente é a da temporada
    document.querySelectorAll('.aba[data-vista]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.vista === vistaJog)));
    document.querySelectorAll('.aba[data-perjog]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.perjog === perJog)));
    $('abasPerJog').hidden = vistaJog !== 'resumo';

    // números do período
    const doPer = new Map(montarRanking(perJog, 'pontos', true).map((j) => [j.chave, j]));
    const ativos = lista.filter((r) => r.ativo);
    const pontuaram = ativos.filter((r) => (doPer.get(r.chave) || {}).pontos > 0).length;
    const parados = ativos.filter((r) => !doPer.has(r.chave)).length;
    const somaPts = ativos.reduce((s, r) => s + ((doPer.get(r.chave) || {}).pontos || 0), 0);
    const ex = lista.length - ativos.length;
    $('jogResumo').textContent = `${fmt(ativos.length)} ${ativos.length === 1 ? 'jogador' : 'jogadores'} no clã${ex ? ` · ${fmt(ex)} ${ex === 1 ? 'ex-membro' : 'ex-membros'}` : ''}`;
    const quando = vistaJog === 'resumo' ? textoPer[perJog] : textoPer.geral;
    $('jogNumeros').replaceChildren(...[
      ['MEMBROS', fmt(ativos.length), 'no elenco do clã', ''],
      ['PONTUARAM', fmt(pontuaram), quando, 'laranja'],
      ['SEM PARTIDA', fmt(parados), quando, ''],
      ['PONTOS DO CLÃ', fmt(somaPts), `somados ${quando}`, 'laranja'],
    ].map(([r, v, s, c]) => el('div', { class: 'stat' }, el('span', { class: 'stat-rot', text: r }), el('span', { class: `stat-num ${c}`, text: v }), el('span', { class: 'stat-sub', text: s }))));

    if (vistaJog === 'resumo') renderResumo(lista, doPer, ptsGeral);
    else renderPorPeriodo(lista, vistaJog, ptsGeral);
  }

  function renderResumo(lista, doPer, ptsGeral) {
    const colunas = [
      { rot: 'POS' },
      { id: 'nome', rot: 'JOGADOR', ord: true, texto: true },
      { id: 'cargo', rot: 'CARGO', ord: true, texto: true },
      { id: 'ptsGeral', rot: 'PATENTE', ord: true, titulo: 'Patente nesta temporada' },
      { id: 'pontos', rot: 'PONTOS', ord: true, dir: true },
      { id: 'qtd', rot: 'PARTIDAS', ord: true, dir: true },
      { id: 'recorde', rot: 'RECORDE', ord: true, dir: true },
      { id: 'media', rot: 'MÉDIA', ord: true, dir: true },
      { id: 'cem', rot: marcoTxt, ord: true, dir: true },
      { id: 'ultima', rot: 'ÚLTIMA', ord: true, dir: true },
    ];
    if (admin) colunas.push({ rot: '' });
    if (!colunas.some((c) => c.id === ordJog.campo)) ordJog = { campo: 'pontos', desc: true };
    cabecalho(colunas);

    const linhas = ordenar(filtrarElenco(lista, (k) => doPer.has(k)).map((r) => {
      const s = doPer.get(r.chave);
      return {
        r, nome: r.nick, cargo: ordemCargo(r.cargo), ptsGeral: ptsGeral(r.chave),
        pontos: s ? s.pontos : 0, qtd: s ? s.qtd : 0, recorde: s ? s.melhor.mass : 0,
        media: s ? Math.round(s.soma / s.qtd) : 0, cem: s ? s.cem : 0, ultima: s ? Date.parse(s.ultima) : 0,
      };
    }));

    const corpo = $('corpoJog');
    if (!linhas.length) {
      corpo.replaceChildren(el('tr', null, el('td', { colspan: String(colunas.length), class: 'vazio-cel', text: msgVazio() })));
    } else {
      corpo.replaceChildren(...linhas.map((l, i) => el('tr', { class: l.r.ativo ? null : 'ex' },
        el('td', { class: `pos p${l.qtd ? i + 1 : 0}`, text: `#${i + 1}` }),
        celNome(l.r, l.ptsGeral),
        el('td', null, chipCargo(l.r) || el('span', { class: 'sec', text: '—' })),
        el('td', null, chipPatente(l.ptsGeral)),
        el('td', { class: 'dir num', text: fmt(l.pontos) }),
        el('td', { class: 'dir', text: l.qtd ? fmt(l.qtd) : '—' }),
        el('td', { class: 'dir', text: l.qtd ? fmt(l.recorde) : '—' }),
        el('td', { class: 'dir sec', text: l.qtd ? fmt(l.media) : '—' }),
        el('td', { class: 'dir' }, l.cem ? el('span', { class: 'cem-chip', text: `${l.cem}×` }) : el('span', { class: 'sec', text: '—' })),
        el('td', { class: 'dir sec nowrap', text: l.ultima ? haQuanto(l.ultima) : 'nunca' }),
        celEditar(l.r)
      )));
    }
    $('notaJog').textContent = '';

    const dia = (ms) => (ms ? new Date(ms).toLocaleDateString('pt-BR') : '');
    planilha = {
      nome: `jogadores-${perJog}`,
      linhas: [
        ['Posição', 'Jogador', 'Cargo', 'No clã', 'Patente', 'Pontos', 'Partidas', 'Recorde', 'Média', `Partidas ${marcoTxt}`, 'Última partida', 'Cadastrado em'],
        ...linhas.map((l, i) => [i + 1, comTag(l.nome), l.r.cargo || '', l.r.ativo ? 'sim' : 'não', patenteDe(l.ptsGeral).atual.nome,
          l.pontos, l.qtd, l.recorde || '', l.media || '', l.cem, dia(l.ultima), l.r.created_at ? dia(Date.parse(l.r.created_at)) : '']),
      ],
    };
  }

  // colunas de semanas (segunda a domingo) ou meses, da mais nova pra mais antiga
  function colunasPeriodo(tipo) {
    const cols = [];
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    if (tipo === 'semanas') {
      hoje.setDate(hoje.getDate() - (hoje.getDay() + 6) % 7);
      for (let i = 0; i < 8; i++) {
        const ini = new Date(hoje); ini.setDate(hoje.getDate() - 7 * i);
        const fim = new Date(ini); fim.setDate(ini.getDate() + 7);
        const ult = new Date(fim); ult.setDate(fim.getDate() - 1);
        const dm = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        cols.push({ ini: ini.getTime(), fim: fim.getTime(), rot: i === 0 ? 'ESTA' : dm(ini), titulo: `${dm(ini)} a ${dm(ult)}`, csv: `Semana ${dm(ini)} a ${dm(ult)}` });
      }
    } else {
      for (let i = 0; i < 6; i++) {
        const ini = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
        const fim = new Date(hoje.getFullYear(), hoje.getMonth() - i + 1, 1);
        const mes = ini.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
        const longo = ini.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        cols.push({ ini: ini.getTime(), fim: fim.getTime(), rot: i === 0 ? 'ESTE MÊS' : mes.toUpperCase(), titulo: longo, csv: longo });
      }
    }
    return cols;
  }

  function renderPorPeriodo(lista, tipo, ptsGeral) {
    const cols = colunasPeriodo(tipo);
    const desde = cols[cols.length - 1].ini;
    // pontos de cada jogador em cada coluna
    const grade = new Map();
    for (const p of partidas) {
      const t = new Date(p.created_at).getTime();
      if (t < desde) continue;
      const c = cols.findIndex((x) => t >= x.ini && t < x.fim);
      if (c < 0) continue;
      const k = chave(p.player);
      if (!grade.has(k)) grade.set(k, cols.map(() => ({ pontos: 0, qtd: 0, melhor: 0 })));
      const g = grade.get(k)[c];
      g.pontos += pontosDe(p.mass);
      g.qtd += 1;
      g.melhor = Math.max(g.melhor, p.mass);
    }

    const colunas = [
      { rot: 'POS' },
      { id: 'nome', rot: 'JOGADOR', ord: true, texto: true },
      { id: 'total', rot: 'TOTAL', ord: true, dir: true, titulo: tipo === 'semanas' ? 'Pontos das últimas 8 semanas' : 'Pontos dos últimos 6 meses' },
      ...cols.map((c, i) => ({ id: `c${i}`, rot: c.rot, ord: true, dir: true, titulo: c.titulo })),
    ];
    if (admin) colunas.push({ rot: '' });
    if (!colunas.some((c) => c.id === ordJog.campo)) ordJog = { campo: 'total', desc: true };
    cabecalho(colunas);

    const vazio = cols.map(() => ({ pontos: 0, qtd: 0, melhor: 0 }));
    const linhas = ordenar(filtrarElenco(lista, (k) => grade.has(k)).map((r) => {
      const g = grade.get(r.chave) || vazio;
      const l = { r, nome: r.nick, g, total: g.reduce((s, x) => s + x.pontos, 0), ptsGeral: ptsGeral(r.chave) };
      l.pontos = l.total;
      g.forEach((x, i) => { l[`c${i}`] = x.pontos; });
      return l;
    }));
    // quem fez mais pontos em cada coluna ganha destaque
    const maior = cols.map((_, i) => Math.max(0, ...linhas.map((l) => l.g[i].pontos)));

    const corpo = $('corpoJog');
    if (!linhas.length) {
      corpo.replaceChildren(el('tr', null, el('td', { colspan: String(colunas.length), class: 'vazio-cel', text: msgVazio() })));
    } else {
      corpo.replaceChildren(...linhas.map((l, i) => el('tr', { class: l.r.ativo ? null : 'ex' },
        el('td', { class: `pos p${l.total ? i + 1 : 0}`, text: `#${i + 1}` }),
        celNome(l.r, l.ptsGeral),
        el('td', { class: 'dir num', text: fmt(l.total) }),
        ...l.g.map((x, c) => el('td', {
          class: `dir cel-per ${x.qtd ? '' : 'sem'} ${maior[c] && x.pontos === maior[c] ? 'melhor-col' : ''}`,
          title: x.qtd ? `${cols[c].titulo}: ${ptsTxt(x.pontos)} em ${x.qtd} ${x.qtd === 1 ? 'partida' : 'partidas'} · maior massa ${fmt(x.melhor)}` : `${cols[c].titulo}: sem partida`,
        }, x.qtd ? [el('b', { text: fmt(x.pontos) }), el('small', { text: `${x.qtd}p` })] : '·')),
        celEditar(l.r)
      )));
    }
    $('notaJog').textContent = `número pequeno = partidas · laranja = quem mais pontuou ${tipo === 'semanas' ? 'na semana' : 'no mês'}`;

    planilha = {
      nome: `jogadores-por-${tipo === 'semanas' ? 'semana' : 'mes'}`,
      linhas: [
        ['Posição', 'Jogador', 'Cargo', 'No clã', 'Total', ...cols.map((c) => `${c.csv} (pontos)`), ...cols.map((c) => `${c.csv} (partidas)`)],
        ...linhas.map((l, i) => [i + 1, comTag(l.nome), l.r.cargo || '', l.r.ativo ? 'sim' : 'não', l.total, ...l.g.map((x) => x.pontos), ...l.g.map((x) => x.qtd)]),
      ],
    };
  }

  function msgVazio() {
    if (buscaJog) return `Ninguém com "${buscaJog}" no nome.`;
    if (filtroJog === 'ex') return 'Nenhum ex-membro.';
    if (filtroJog === 'parados') return 'Todo mundo jogou nesse período. Clã ativo!';
    return admin ? 'Nenhum jogador cadastrado ainda. Cadastre o elenco no quadro acima.' : 'Nenhum jogador cadastrado ainda.';
  }

  // ---------- baixar planilha (CSV que abre no Excel e no Google Planilhas) ----------
  function baixarCsv(nome, linhas) {
    const cel = (v) => { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const txt = '﻿' + linhas.map((l) => l.map(cel).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
    const hoje = new Date().toLocaleDateString('pt-BR').split('/').reverse().join('-');
    const a = el('a', { href: url, download: `${TAG.toLowerCase()}-${nome}-${hoje}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function baixarPartidas() {
    if (!partidas.length) { toast('Ainda não tem partida pra baixar.', true); return; }
    baixarCsv('partidas', [
      ['Data', 'Hora', 'Jogador', 'Massa', 'Pontos', `${marcoTxt}`],
      ...partidas.map((p) => {
        const d = new Date(p.created_at);
        const k = chave(p.player);
        return [d.toLocaleDateString('pt-BR'), d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), comTag(nomeDe(k, p.player)), p.mass, pontosDe(p.mass), p.mass >= MARCO ? 'sim' : ''];
      }),
    ]);
  }

  // ---------- cadastro e edição de jogadores (só o dono) ----------
  function nicksDoTexto(txt) {
    const mapa = new Map();
    for (const n of String(txt).split(/[\n,;]+/).map(limparNick).filter(Boolean)) if (!mapa.has(chave(n))) mapa.set(chave(n), n);
    return [...mapa.values()];
  }
  function previaCadastro() {
    const nicks = nicksDoTexto($('fNicks').value);
    if (!nicks.length) { $('previaCadastro').textContent = ''; return; }
    let novos = 0, voltam = 0, ja = 0;
    for (const n of nicks) { const r = elenco.get(chave(n)); if (!r) novos++; else if (!r.ativo) voltam++; else ja++; }
    $('previaCadastro').textContent = [
      novos ? `${novos} ${novos === 1 ? 'novo' : 'novos'}` : '',
      voltam ? `${voltam} ${voltam === 1 ? 'volta' : 'voltam'} pro clã` : '',
      ja ? `${ja} já ${ja === 1 ? 'cadastrado' : 'cadastrados'}` : '',
    ].filter(Boolean).join(' · ');
  }
  function erroCadastro(msg) { $('erroCadastro').textContent = msg || ''; $('erroCadastro').hidden = !msg; }

  async function cadastrar(ev) {
    ev.preventDefault();
    const nicks = nicksDoTexto($('fNicks').value);
    const cargo = $('fCargo').value || CARGO_PADRAO;
    if (!nicks.length) return erroCadastro('Escreve pelo menos um nick.');
    if (nicks.length > 200) return erroCadastro('No máximo 200 de uma vez.');
    if (!admin) return erroCadastro('Entre na área do admin para cadastrar.');
    erroCadastro(null);
    const voltam = nicks.filter((n) => exMembro(chave(n))).length;
    const btn = $('btnCadastrar');
    btn.disabled = true;
    btn.textContent = 'CADASTRANDO…';
    try {
      let n = 0;
      if (DEMO) {
        for (const nick of nicks) {
          const r = elenco.get(chave(nick));
          if (r) { r.ativo = true; continue; }
          jogadores.push({ id: 'dj-' + Date.now() + '-' + n, nick, cargo, ativo: true, created_at: new Date().toISOString() });
          n++;
        }
        indexarElenco();
      } else {
        n = await rpcAdmin('admin_add_players', { p_nicks: nicks, p_cargo: cargo });
        await carregar();
      }
      $('fNicks').value = '';
      $('previaCadastro').textContent = '';
      render();
      const ja = nicks.length - n - voltam;
      const partes = [
        n ? `${n} ${n === 1 ? 'jogador cadastrado' : 'jogadores cadastrados'}` : '',
        voltam ? `${voltam} ${voltam === 1 ? 'voltou' : 'voltaram'} pro clã` : '',
        ja ? `${ja} já ${ja === 1 ? 'estava' : 'estavam'} no elenco` : '',
      ].filter(Boolean);
      toast(partes.join(' · ') + '.');
    } catch (e) {
      console.error(e);
      if (erroSessao(e)) return;
      erroCadastro('Não deu pra cadastrar agora. (' + (e.message || 'erro') + ')');
    } finally {
      btn.disabled = false;
      btn.textContent = 'CADASTRAR';
    }
  }

  let editJog = null;
  let confirmarApagarJog = false;
  function opcoesCargo(select, atual) {
    const lista = atual && !CARGOS.includes(atual) ? [...CARGOS, atual] : CARGOS;
    select.replaceChildren(...lista.map((c) => el('option', { value: c, text: c })));
    select.value = atual || CARGO_PADRAO;
  }
  function abrirEditar(r) {
    editJog = r;
    confirmarApagarJog = false;
    const qtd = partidas.filter((p) => chave(p.player) === r.chave).length + lancamentos.filter((l) => l.player_id === r.id).length;
    $('fJogNick').value = r.nick;
    opcoesCargo($('fJogCargo'), r.cargo);
    $('fJogAtivo').checked = r.ativo;
    $('erroJogador').hidden = true;
    $('btnApagarJog').hidden = qtd > 0;
    $('btnApagarJog').textContent = 'Apagar';
    $('notaJogador').textContent = qtd
      ? `Tem ${qtd} ${qtd === 1 ? 'partida' : 'partidas'}. Se saiu do clã, desmarque "Ainda está no clã": ele some do ranking e o histórico fica guardado.`
      : 'Ainda não tem partida. Se foi cadastro errado, pode apagar.';
    renderLoginJog(r);
    $('dlgJogador').showModal();
  }
  function erroJogador(msg) { $('erroJogador').textContent = msg || ''; $('erroJogador').hidden = !msg; }

  async function salvarJogador(ev) {
    ev.preventDefault();
    const r = editJog;
    if (!r) return;
    const nick = limparNick($('fJogNick').value);
    const cargo = $('fJogCargo').value;
    const ativo = $('fJogAtivo').checked;
    if (!nick) return erroJogador('Escreve o nick.');
    const outro = elenco.get(chave(nick));
    if (outro && outro.id !== r.id) return erroJogador(`Já existe ${comTag(outro.nick)} no elenco.`);
    const btn = $('btnSalvarJog');
    btn.disabled = true;
    try {
      if (DEMO) {
        const antigo = r.chave;
        const alvo = jogadores.find((x) => x.id === r.id);
        Object.assign(alvo, { nick, cargo, ativo });
        partidas.forEach((p) => { if (chave(p.player) === antigo) p.player = nick; });
        indexarElenco();
      } else {
        const res = await rpcAdmin('admin_update_player', { p_id: r.id, p_nick: nick, p_cargo: cargo, p_ativo: ativo });
        if (res === 'nick_em_uso') return erroJogador('Esse nick já está no elenco.');
        if (res !== 'ok') throw new Error(res);
        await carregar();
      }
      $('dlgJogador').close();
      render();
      toast(ativo === r.ativo ? `${comTag(nick)} atualizado.` : ativo ? `${comTag(nick)} voltou pro clã.` : `${comTag(nick)} agora é ex-membro.`);
    } catch (e) {
      console.error(e);
      if (erroSessao(e)) { $('dlgJogador').close(); return; }
      erroJogador('Não deu pra salvar agora. (' + (e.message || 'erro') + ')');
    } finally {
      btn.disabled = false;
    }
  }

  async function apagarJogador() {
    const r = editJog;
    if (!r) return;
    if (!confirmarApagarJog) { confirmarApagarJog = true; $('btnApagarJog').textContent = 'Toque de novo pra apagar'; return; }
    try {
      if (DEMO) {
        jogadores = jogadores.filter((x) => x.id !== r.id);
        indexarElenco();
      } else {
        const res = await rpcAdmin('admin_delete_player', { p_id: r.id });
        if (res === 'tem_partidas') return erroJogador('Ele tem partidas. Desmarque "Ainda está no clã" em vez de apagar.');
        await carregar();
      }
      $('dlgJogador').close();
      render();
      toast(`${comTag(r.nick)} saiu do elenco.`);
    } catch (e) {
      console.error(e);
      if (erroSessao(e)) { $('dlgJogador').close(); return; }
      erroJogador('Não deu pra apagar agora. (' + (e.message || 'erro') + ')');
    }
  }

  const geralPts = (j) => ptsPat(j.chave); // pontos que valem pra patente (a da temporada)

  // no pódio: o escudo da patente (se tiver) ou a bolinha com a cor do lugar
  function avatarPodio(j) {
    const { atual } = patenteDe(geralPts(j));
    const letra = j.nome.charAt(0).toUpperCase();
    if (!atual.nivel) return coroar(el('div', { class: 'avatar', 'aria-hidden': 'true', text: letra }), j.chave);
    const a = el('div', { class: `avatar avatar-esc ${atual.diamante ? 'esc-dia' : ''}`, style: `--pc:${atual.cor}`, 'aria-hidden': 'true' });
    a.innerHTML = escudoSVG(atual, letra);
    return coroar(a, j.chave);
  }
  function renderPodio(rank, ctx) {
    const box = $('podio');
    if (!rank.length) {
      const ultima = ctx.temps.find((t) => !t.atual);
      const msg = periodo === 'geral'
        ? 'Ninguém no ranking ainda.'
        : periodo === 'mes'
          ? `Pódio livre na ${nomeTemp(Date.now())}.${ultima ? ` Último campeão: ${comTag(ultima.top[0].nome)}.` : ''}`
          : 'Ninguém pontuou nesta semana ainda.';
      box.replaceChildren(el('p', { class: 'vazio', text: msg }));
      return;
    }
    const valor = (j) => (modo === 'massa' ? j.melhor.mass : j.pontos);
    const topo = Math.max(1, valor(rank[0]));
    const ordem = [1, 0, 2].filter((i) => rank[i]); // 2º, 1º, 3º
    box.replaceChildren(...ordem.map((i) => {
      const j = rank[i];
      const url = urlPrint(j.melhor);
      const linha = modo === 'massa'
        ? `recorde · ${dataCurta(j.melhor.created_at)} · ${ptsTxt(j.pontos)}`
        : `pontos · recorde ${fmt(j.melhor.mass)}`;
      // no celular os três ficam lado a lado: a tag e as partes "longas" somem pelo CSS
      return el('article', { class: `lugar l${i + 1}` },
        i === 0 ? svg(ICONE_COROA, 40, 'class="coroa"') : null,
        avatarPodio(j),
        el('div', { class: 'lugar-id' },
          el('div', { class: 'lugar-pos' }, `${i + 1}º LUGAR`, i === 0 ? el('span', { class: 'lugar-rei', text: ' · REI DO CLÃ' }) : null),
          btnPerfil(j, 'lugar-nome', [el('span', { class: 'lugar-tag', text: `[${TAG}] ` }), j.nome]),
          el('div', { class: 'lugar-pat' }, chipPatente(geralPts(j)))),
        el('div', { class: 'lugar-massa', text: fmt(valor(j)) }),
        el('div', { class: 'lugar-data', text: linha }),
        j.cem ? el('div', { class: 'cem-selo', text: `${j.cem}× ${marcoTxt}` }) : null,
        el('div', { class: 'barra', 'aria-hidden': 'true' }, el('span', { style: `width:${Math.max(4, Math.round(valor(j) / topo * 100))}%` })),
        url ? el('button', { type: 'button', class: 'ver-print', text: 'Ver print do recorde', onclick: () => abrirPrint(j.melhor) }) : null
      );
    }));
  }

  function chipTitulos(n) {
    if (!n) return null;
    return el('span', { class: 'titulo-chip', title: `${n}× campeão de temporada` }, svg(ICONE_TROFEU, 12), n > 1 ? `${n}×` : null);
  }

  // a tabela abre com o top 10 (e a sua linha, se você marcou "sou eu"); o resto num toque
  const TABELA_TOPO = 10;
  let tabelaToda = false;
  function renderTabela(rank, ctx) {
    const corpo = $('corpoTabela');
    $('thPontos').classList.toggle('ativo', modo === 'pontos');
    $('thRecorde').classList.toggle('ativo', modo === 'massa');
    $('tabelaMaisBox').hidden = true;
    if (!rank.length) {
      corpo.replaceChildren(el('tr', null, el('td', { colspan: '6', class: 'vazio-cel', text: 'A tabela aparece aqui assim que a primeira massa for registrada.' })));
      return;
    }
    const doisDias = Date.now() - 24 * 3600 * 1000;
    const eu = lerEu();
    const iEu = rank.findIndex((j) => j.chave === eu);
    const cortar = !tabelaToda && rank.length > TABELA_TOPO + 2;
    const linhas = rank.map((j, i) => [j, i]).filter(([, i]) => !cortar || i < TABELA_TOPO || i === iEu);
    if (rank.length > TABELA_TOPO + 2) {
      $('tabelaMaisBox').hidden = false;
      $('btnTabelaToda').textContent = tabelaToda ? 'Mostrar só o top 10' : `Ver todos os ${rank.length} jogadores`;
    }
    trocar(corpo, linhas.flatMap(([j, i]) => {
      const novo = new Date(j.melhor.created_at).getTime() > doisDias;
      const pulo = cortar && i === iEu && i > TABELA_TOPO
        ? el('tr', { class: 'pulo', 'aria-hidden': 'true' }, el('td', { colspan: '6', text: '⋯' })) : null;
      return [pulo, el('tr', { class: [i === 0 ? 'topo1' : '', j.chave === eu ? 'eu-linha' : '', patenteDe(geralPts(j)).atual.diamante ? 'linha-dia' : '', ehRei(j.chave) ? 'linha-rei' : ''].join(' ').trim() || null },
        el('td', { class: `pos p${i + 1}`, text: `#${i + 1}` }),
        el('td', { class: 'nome-cel' }, el('div', { class: 'nome-linha' }, avatarDe(j.nome, geralPts(j), 'av-p'), btnPerfil(j, 'link-nome forte', [el('span', { class: 'tag-nick', text: `[${TAG}] ` }), j.nome]), chipPatente(geralPts(j)), chipRei(j.chave), chipTitulos(ctx.titulos.get(j.chave)), ...chipTorneios(j.chave, true), novo ? el('span', { class: 'chip', title: 'Recorde novo nas últimas 24 horas' }, '▲', el('span', { class: 'chip-longo', text: ' RECORDE NOVO' })) : null),
          el('div', { class: 'nome-melhor' }, 'melhor: ', b(ptsTxt(pontosDe(j.melhor.mass))), ` · ${fmt(j.melhor.mass)} massa`)),
        el('td', { class: `dir ${modo === 'pontos' ? 'num' : 'sec'}`, text: fmt(j.pontos) }),
        el('td', { class: 'dir' }, j.cem ? el('span', { class: 'cem-chip', text: `${j.cem}×` }) : el('span', { class: 'sec', text: '—' })),
        el('td', { class: `dir ${modo === 'massa' ? 'num' : 'sec'}`, text: fmt(j.melhor.mass) }),
        el('td', { class: 'dir sec', text: fmt(j.qtd) }))];
    }));
  }

  function renderConquistas() {
    const ev = montarConquistas();
    const ul = $('listaConquistas');
    if (!ev.length) { ul.replaceChildren(el('li', { class: 'sec', text: 'As conquistas do clã aparecem aqui.' })); return; }
    ul.replaceChildren(...ev.map((e) => el('li', null,
      el('span', { class: `bola ${e.tipo}`, 'aria-hidden': 'true' }),
      el('span', { class: 'txt' }, e.partes),
      el('span', { class: 'quando', text: haQuanto(e.quando) })
    )));
  }

  // partidas aparecem aos poucos: 12 e depois mais 24 a cada toque
  const PARTIDAS_PASSO = 24;
  let partidasQtd = 12;
  function renderPartidas() {
    const ul = $('listaPartidas');
    $('adminTag').hidden = !admin;
    const lista = partidas.slice(0, partidasQtd);
    const resto = partidas.length - lista.length;
    $('partidasMaisBox').hidden = resto <= 0;
    $('btnPartidasMais').textContent = `Ver mais ${fmt(Math.min(resto, PARTIDAS_PASSO))} ${Math.min(resto, PARTIDAS_PASSO) === 1 ? 'partida' : 'partidas'}`;
    if (!lista.length) { ul.replaceChildren(el('li', { class: 'vazio', text: 'Nenhuma partida registrada ainda.' })); return; }
    ul.replaceChildren(...lista.map((p) => {
      const url = urlPrint(p);
      const pts = pontosDe(p.mass);
      const nome = nomeDe(chave(p.player), p.player);
      return el('li', { class: `partida ${p.mass >= MARCO ? 'cem' : ''}` },
        url
          ? el('button', { type: 'button', class: 'mini', 'aria-label': `Ver print de ${nome}`, onclick: () => abrirPrint(p) },
              el('img', { src: url, alt: '', loading: 'lazy' }))
          : el('span', { class: 'mini mini-av' }, avatarDe(nome, ptsPat(chave(p.player)))),
        el('div', { class: 'partida-info' },
          el('span', { class: 'partida-nome', text: comTag(nome) }),
          el('span', { class: 'partida-massa' }, fmt(p.mass), p.mass >= MARCO ? el('span', { class: 'cem-chip', text: marcoTxt }) : null),
          el('span', { class: 'partida-data', text: `${pts ? '+' + ptsTxt(pts) : 'sem pontos'} · ${haQuanto(p.created_at)}` })),
        admin ? el('button', { type: 'button', class: 'apagar', 'aria-label': `Apagar pontuação de ${limparNick(p.player)}`, onclick: () => pedirApagar(p) }, svg(ICONE_LIXO)) : null
      );
    }));
  }

  function renderTabelaPontos() {
    const linha = (rot, val, cls) => el('li', { class: cls }, el('span', { text: rot }), el('b', { text: val }));
    const exemplo = (m) => {
      const d = detalhePontos(m);
      return linha(`${fmt(m)} de massa`, d.bonus ? `${fmt(d.base)} + ${fmt(d.bonus)} = ${ptsTxt(d.total)}` : ptsTxt(d.total), d.bonus ? 'topo' : null);
    };
    const exemplos = [50000, META - 1000, META, META * 2, META * 5, MASSA_MAX].filter((m, i, a) => m > 0 && m <= MASSA_MAX && a.indexOf(m) === i);
    const metas = [1, 2, 3].filter((n) => bonusDaMeta(n) > 0);
    $('tabelaPontos').replaceChildren(...[
      linha('a cada 1.000 de massa', ptsTxt(POR_MIL)),
      ...metas.map((n) => linha(`bônus ao passar de ${fmtK(META * n)}`, `+${ptsTxt(bonusDaMeta(n))}`, 'topo')),
      BONUS_SOBE && metas.length ? el('li', { class: 'tp-nota', text: `…e cada meta seguinte vale +${fmt(BONUS_SOBE)} a mais, até ${fmtK(MASSA_MAX)}.` }) : null,
      el('li', { class: 'tp-sep', text: 'EXEMPLOS' }),
      ...exemplos.map(exemplo),
    ].filter(Boolean));
  }

  // ---------- patentes ----------
  const CORES_PATENTE = ['#A8998B', '#B98BFF', '#3BA4FF', '#FFB347', '#FF7A1A', '#FFD84D', '#FF5AA0', '#3DDC84'];
  const COR_DIAMANTE = '#7DF9FF';
  const DIAMANTES = { nome: 'Diamantes', pontos: 10000 };
  const ehDiamante = (nome) => /diamante/i.test(String(nome || ''));
  const listaPatentes = Array.isArray(CFG.PATENTES) && CFG.PATENTES.length ? [...CFG.PATENTES] : [
    { nome: 'Recruta', pontos: 0 },
    { nome: 'Guerreiro', pontos: 100 },
    { nome: 'Elite', pontos: 300 },
    { nome: 'Mestre', pontos: 600 },
    { nome: 'Grão-Mestre', pontos: 1200 },
    { nome: 'Lendário', pontos: 2500 },
  ];
  // Diamantes entra mesmo se o config.js tiver a lista antiga
  if (!listaPatentes.some((x) => x && ehDiamante(x.nome))) listaPatentes.push(DIAMANTES);
  const PATENTES = listaPatentes.map((x) => ({ nome: String(x.nome || '?'), pontos: Number(x.pontos) || 0 }))
    .sort((a, b) => a.pontos - b.pontos)
    .map((x, i) => {
      const diamante = ehDiamante(x.nome);
      return { ...x, nivel: i, diamante, chave: busca(x.nome), cor: diamante ? COR_DIAMANTE : CORES_PATENTE[i % CORES_PATENTE.length] };
    });
  if (PATENTES[0].pontos > 0) PATENTES[0].pontos = 0;

  const mesChave = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  function patenteDe(pontos) {
    let atual = PATENTES[0];
    for (const t of PATENTES) if (pontos >= t.pontos) atual = t;
    const prox = PATENTES[atual.nivel + 1] || null;
    const progresso = prox ? (pontos - atual.pontos) / (prox.pontos - atual.pontos) : 1;
    return { atual, prox, progresso: Math.max(0, Math.min(1, progresso)) };
  }

  // ---------- patente por temporada (igual ao ranqueado do Free Fire) ----------
  // A patente vale só na temporada (o mês). Na virada, quem terminou cai 2 patentes e
  // começa a nova no piso dela; os pontos do mês somam em cima disso. Recruta continua Recruta.
  const CAI_NA_VIRADA = 2;
  // Temporada 1 = outubro de 2026 (no modo demonstração, o mês da partida mais velha)
  function inicioTemp1() {
    if (!DEMO || !partidas.length) return new Date(2026, 9, 1);
    const d = new Date(partidas[partidas.length - 1].created_at);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  function numTemp(ms) {
    const d = new Date(ms), t1 = inicioTemp1();
    return (d.getFullYear() - t1.getFullYear()) * 12 + d.getMonth() - t1.getMonth() + 1;
  }
  const nomeTemp = (ms) => (numTemp(ms) >= 1 ? `Temporada ${numTemp(ms)}` : `Temporada de ${nomeMes(ms)}`);
  const fimDoMes = (ms = Date.now()) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(); };
  // em que nível começa a próxima temporada quem terminou em "nivel"
  const nivelNaVirada = (nivel) => Math.max(0, nivel - CAI_NA_VIRADA);

  // "2026-10" -> Map(chave -> { chave, nome, ini, ganho, pts, fim, qtd }); ini/fim = nível da patente
  let cachePat = null;
  function patentesPorTemporada() {
    if (cachePat) return cachePat;
    cachePat = new Map();
    if (!partidas.length) return cachePat;
    const velha = new Date(partidas[partidas.length - 1].created_at);
    let comeca = new Map(); // chave -> { ini, nome } de quem não começa em Recruta
    for (let d = new Date(velha.getFullYear(), velha.getMonth(), 1); d.getTime() <= Date.now(); d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const doMes = new Map(montarRanking(d.getTime(), 'pontos', true, fimDoMes(d.getTime())).map((j) => [j.chave, j]));
      const mapa = new Map();
      for (const k of new Set([...comeca.keys(), ...doMes.keys()])) {
        const ini = comeca.has(k) ? comeca.get(k).ini : 0;
        const j = doMes.get(k);
        const ganho = j ? j.pontos : 0;
        const pts = PATENTES[ini].pontos + ganho;
        mapa.set(k, { chave: k, nome: j ? j.nome : comeca.get(k).nome, ini, ganho, pts, fim: patenteDe(pts).atual.nivel, qtd: j ? j.qtd : 0 });
      }
      cachePat.set(mesChave(d), mapa);
      comeca = new Map();
      for (const [k, x] of mapa) if (nivelNaVirada(x.fim) > 0) comeca.set(k, { ini: nivelNaVirada(x.fim), nome: x.nome });
    }
    return cachePat;
  }
  // como o jogador está na temporada de "ms" (null = nunca pontuou e começou em Recruta)
  const patTemp = (k, ms = Date.now()) => (patentesPorTemporada().get(mesChave(ms)) || new Map()).get(k) || null;
  // pontos que valem pra patente agora: o piso de onde começou + os pontos do mês
  function ptsPat(k) { const x = patTemp(k); return x ? x.pts : 0; }
  function chipPatente(pontos, extra = '') {
    const { atual } = patenteDe(pontos);
    return el('span', { class: `patente ${atual.diamante ? 'pat-dia' : ''} ${extra}`, style: `--pc:${atual.cor}` }, svg(atual.diamante ? ICONE_DIAMANTE : ICONE_PATENTE, 12), atual.nome);
  }
  const ICONE_PATENTE = '<path d="M12 3l8 3.5v5.5c0 4.5-3.4 8-8 9.5-4.6-1.5-8-5-8-9.5V6.5z"/><path d="M8 10.5l4 3 4-3"/>';
  const ICONE_DIAMANTE = '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20M10 3 8 9l4 12 4-12-2-6"/>';
  // quem tem patente ganha o escudo dela no lugar da bolinha (Recruta continua com a bolinha)
  function avatarDe(nome, pontos, tam = '') {
    const { atual } = patenteDe(pontos);
    const letra = nome.charAt(0).toUpperCase();
    if (!atual.nivel) return coroar(el('span', { class: `av ${tam}`, style: `--pc:${atual.cor}`, 'aria-hidden': 'true', text: letra }), chave(nome));
    const a = el('span', { class: `av av-esc ${tam} ${atual.diamante ? 'esc-dia' : ''}`, style: `--pc:${atual.cor}`, 'aria-hidden': 'true' });
    a.innerHTML = escudoSVG(atual, letra);
    return coroar(a, chave(nome));
  }

  // ---------- coroa do rei ----------
  // o campeão da temporada que acabou de fechar usa a coroa a temporada seguinte inteira;
  // na virada ela vai pro novo campeão (se ele ganhar de novo, continua com ela)
  let cacheRei;
  function reiAtual() {
    if (cacheRei !== undefined) return cacheRei;
    const ini = new Date(fimDoMes() - 1);
    const atual = new Date(ini.getFullYear(), ini.getMonth(), 1).getTime();
    const ant = new Date(ini.getFullYear(), ini.getMonth() - 1, 1).getTime();
    const top = montarRanking(ant, 'pontos', true, atual).find((j) => j.pontos > 0);
    cacheRei = top && !exMembro(top.chave) ? { chave: top.chave, nome: top.nome, ms: ant } : null;
    return cacheRei;
  }
  const ehRei = (k) => { const r = reiAtual(); return !!r && r.chave === k; };
  let numCoroa = 0;
  function coroaSVG(cls = 'coroa-rei') {
    const id = 'cr' + (++numCoroa);
    const w = el('span', { class: cls, 'aria-hidden': 'true' });
    const corpo = 'M12 54L4 16L18 38L27 7L38 33L50 1L62 33L73 7L82 38L96 16L88 54Z';
    const faixa = 'M9 51Q50 44 91 51L91 66Q50 59 9 66Z';
    const tr = 'stroke="#4A2600" stroke-width="1.8" stroke-linejoin="round"';
    w.innerHTML = `<svg viewBox="-8 -12 116 84">
<defs>
<linearGradient id="${id}o" x1="0" y1="0" x2=".5" y2="1"><stop offset="0" stop-color="#FFF7C2"/><stop offset=".3" stop-color="#FFD84D"/><stop offset=".7" stop-color="#F29A00"/><stop offset="1" stop-color="#8A4300"/></linearGradient>
<linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE98A"/><stop offset=".5" stop-color="#E08A00"/><stop offset="1" stop-color="#7A3A00"/></linearGradient>
<radialGradient id="${id}p" cx=".35" cy=".35" r=".7"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".6" stop-color="#FFF1C9"/><stop offset="1" stop-color="#D9B26A"/></radialGradient>
<linearGradient id="${id}e" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="${id}k"><path d="${corpo}"/><path d="${faixa}"/></clipPath>
</defs>
<path d="${corpo}" fill="url(#${id}o)" ${tr}/>
<path d="M14 50L8 24M27 13L30 46M50 8V46M73 13L70 46M86 24L92 50" stroke="#FFF7C2" stroke-opacity=".55" stroke-width="1.4" fill="none"/>
<path d="${faixa}" fill="url(#${id}f)" ${tr}/>
<path d="M11 54Q50 47 89 54" stroke="#FFF7C2" stroke-opacity=".7" stroke-width="1.3" fill="none"/>
${[[4, 16, 4.6], [27, 7, 4.6], [50, 1, 5.8], [73, 7, 4.6], [96, 16, 4.6]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${id}p)" ${tr}/>`).join('')}
<path d="M50 49L57 56.5L50 64L43 56.5Z" fill="#E8174F" ${tr}/><path d="M48 52L50 50L52 52L50 55Z" fill="#fff" fill-opacity=".85"/>
<ellipse cx="29" cy="58" rx="5.2" ry="4" fill="#2F63E0" ${tr}/><ellipse cx="71" cy="58" rx="5.2" ry="4" fill="#2F63E0" ${tr}/>
<circle cx="15" cy="59.5" r="3" fill="#14C36B" ${tr}/><circle cx="85" cy="59.5" r="3" fill="#14C36B" ${tr}/>
<path d="M50 20L55 28L50 36L45 28Z" fill="#E8174F" ${tr}/>
<g clip-path="url(#${id}k)"><g class="cr-reflexo"><rect x="-70" y="-20" width="26" height="110" fill="url(#${id}e)" transform="skewX(-22)"/></g></g>
<path class="cr-faisca" d="${faisca(-2, 2, 7)}" fill="#FFF7C2"/>
<path class="cr-faisca" style="animation-delay:-.6s" d="${faisca(103, -2, 6)}" fill="#fff"/>
<path class="cr-faisca" style="animation-delay:-1.2s" d="${faisca(64, -8, 4.5)}" fill="#FFE98A"/>
</svg>`;
    return w;
  }
  // põe a coroa na "cabeça" do avatar de quem é o rei
  function coroar(a, k) {
    if (!ehRei(k)) return a;
    a.classList.add('av-rei');
    a.append(coroaSVG());
    a.title = `Dono da coroa · campeão da ${nomeTemp(reiAtual().ms)}`;
    return a;
  }
  // banner do rei (ou da coroa vaga) no ranking: quem tem a coroa e quem tá tomando ela
  function renderRei() {
    const box = $('reiTemporada');
    const rei = reiAtual();
    const mes = montarRanking('mes', 'pontos').filter((j) => j.pontos > 0);
    const lider = mes[0];
    if (!rei && !lider) { box.replaceChildren(); return; }
    const eu = lerEu();
    const pos = rei ? mes.findIndex((j) => j.chave === rei.chave) + 1 : 0;
    const defende = rei && pos === 1;
    const cta = !rei ? 'VALENDO A COROA'
      : eu === rei.chave ? 'DEFENDA A COROA'
        : lider && eu === lider.chave && !defende ? 'TOMANDO A COROA'
          : 'DESTRONE O REI';
    const status = rei
      ? [el('span', { class: `rei-chip ${defende ? 'rei-ok' : 'rei-risco'}`, text: defende ? 'DEFENDENDO · #1' : pos ? `AMEAÇADO · #${pos}` : 'AMEAÇADO · SEM PONTOS' }),
        lider && !defende ? el('span', { class: 'rei-lider' }, el('span', { class: 'rei-lider-rot', text: '1º AGORA' }), btnPerfil(lider, 'rei-lider-nome', [avatarDe(lider.nome, ptsPat(lider.chave), 'av-p'), comTag(lider.nome)])) : null]
      : [el('span', { class: 'rei-lider' }, el('span', { class: 'rei-lider-rot', text: '1º AGORA' }), btnPerfil(lider, 'rei-lider-nome', [avatarDe(lider.nome, ptsPat(lider.chave), 'av-p'), comTag(lider.nome)]))];
    trocar(box, el('div', { class: `rei-box ${rei ? '' : 'rei-vago'} ${eu && rei && eu === rei.chave ? 'rei-eu' : ''}` },
      el('span', { class: 'rei-raios', 'aria-hidden': 'true' }),
      el('span', { class: 'dia-faiscas rei-faiscas', 'aria-hidden': 'true' }, ...Array.from({ length: 10 }, () => el('i'))),
      rei
        ? btnPerfil(rei, 'rei-av', avatarDe(rei.nome, ptsPat(rei.chave), 'av-g'))
        : el('span', { class: 'rei-av' }, coroaSVG('coroa-vaga')),
      el('div', { class: 'rei-txt' },
        el('span', { class: 'rei-rot' }, svg(ICONE_COROA, 14), rei ? `DONO DA COROA · CAMPEÃO DA ${nomeTemp(rei.ms).toUpperCase()}` : `COROA EM JOGO · ${nomeTemp(Date.now()).toUpperCase()}`,
          el('button', { type: 'button', class: 'info-btn', 'data-info': 'temporada', 'aria-label': 'Como funciona a coroa', text: 'i' })),
        rei ? btnPerfil(rei, 'rei-nome', comTag(rei.nome)) : el('b', { class: 'rei-nome', text: 'SEM DONO' }),
        el('div', { class: 'rei-status' }, ...status)),
      el('b', { class: 'rei-cta', text: cta })));
  }
  function chipRei(k) {
    if (!ehRei(k)) return null;
    const n = numTemp(reiAtual().ms);
    return el('span', { class: 'rei-tag', title: `Dono da coroa · campeão da ${nomeTemp(reiAtual().ms)}` }, svg(ICONE_COROA, 12), n >= 1 ? `REI T${n}` : 'REI');
  }

  // ---------- escudo de cada patente ----------
  // sobe de enfeite a cada patente: divisas, filete, asas, estrela e coroa; Diamantes é de cristal
  const tom = (hex, t) => { // t > 0 clareia, t < 0 escurece
    const n = parseInt(hex.slice(1), 16), alvo = t > 0 ? 255 : 0, a = Math.abs(t);
    return '#' + [16, 8, 0].map((s) => { const c = (n >> s) & 255; return Math.round(c + (alvo - c) * a).toString(16).padStart(2, '0'); }).join('');
  };
  function formaEscudo(w, h, t) {
    const l = 60 - w / 2, r = 60 + w / 2, y = (f) => +(t + h * f).toFixed(1);
    return `M60 ${t}L${r} ${y(.1)}L${r} ${y(.48)}C${r} ${y(.76)} ${60 + w * .22} ${y(.9)} 60 ${t + h}C${60 - w * .22} ${y(.9)} ${l} ${y(.76)} ${l} ${y(.48)}L${l} ${y(.1)}Z`;
  }
  const estrela = (cx, cy, r) => Array.from({ length: 10 }, (_, i) => {
    const a = Math.PI / 5 * i - Math.PI / 2, d = i % 2 ? r * .45 : r;
    return `${(cx + d * Math.cos(a)).toFixed(1)},${(cy + d * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  // por nível: tamanho do escudo (w, h, topo t), divisas, filete, asas (escala) e enfeite em cima.
  // O último é o Lendário (o Diamantes usa ele em cristal): espadas, asas grandes, coroa, raios
  const ESC_NIVEIS = [
    { w: 84, h: 100, t: 10, div: 0 },
    { w: 84, h: 100, t: 10, div: 1 },
    { w: 84, h: 100, t: 10, div: 2, filete: true },
    { w: 74, h: 90, t: 16, div: 2, filete: true, asa: .62 },
    { w: 68, h: 84, t: 27, div: 2, filete: true, asa: .9, topo: 'estrela' },
    { w: 64, h: 80, t: 34, div: 0, filete: true, lenda: true },
  ];
  const ASA = '<path d="M0 -6C-10 -18 -22 -26 -34 -30C-30 -16 -20 -4 0 6Z"/><path d="M0 4C-12 -2 -24 -6 -36 -8C-30 4 -18 12 0 14Z"/><path d="M0 12C-10 12 -20 14 -30 18C-22 26 -10 26 0 22Z"/>';
  const ASA_G = '<path d="M0 -10C-8 -24 -20 -34 -38 -40C-34 -24 -22 -12 0 0Z"/><path d="M0 -2C-12 -12 -26 -20 -42 -22C-36 -8 -22 2 0 6Z"/><path d="M0 6C-14 2 -28 -2 -42 -2C-34 10 -20 14 0 14Z"/><path d="M0 13C-12 12 -24 12 -36 16C-28 24 -14 24 0 20Z"/><path d="M0 19C-10 21 -18 24 -26 30C-16 34 -6 30 0 25Z"/>';
  // as duas asas: a esquerda e a mesma espelhada
  const parAsas = (desenho, x, y, s, extra = '') => `<g transform="translate(${x} ${y}) scale(${s})${extra}">${desenho}</g><g transform="translate(120 0) scale(-1 1)"><g transform="translate(${x} ${y}) scale(${s})${extra}">${desenho}</g></g>`;
  const faisca = (x, y, r) => `M${x} ${y - r}L${x + r * .28} ${y - r * .28}L${x + r} ${y}L${x + r * .28} ${y + r * .28}L${x} ${y + r}L${x - r * .28} ${y + r * .28}L${x - r} ${y}L${x - r * .28} ${y - r * .28}Z`;
  const gema = (x, y, r) => `M${x} ${y - r}L${x + r * .8} ${y}L${x} ${y + r}L${x - r * .8} ${y}Z`;
  let numEsc = 0;
  function escudoSVG(p, letra = '') {
    const id = 'es' + (++numEsc);
    const dia = p.diamante;
    const n = ESC_NIVEIS[dia ? ESC_NIVEIS.length - 1 : Math.min(p.nivel, ESC_NIVEIS.length - 1)];
    const { w, h, t } = n;
    const c = p.cor;
    const aro = dia ? ['#FFFFFF', '#7DF9FF', '#C6A8FF', '#3A6FD8'] : [tom(c, .65), c, tom(c, -.3), tom(c, -.62)];
    const escuro = dia ? '#06202B' : tom(c, -.8);
    const claro = dia ? '#EFFFFF' : tom(c, .72);
    const campo = dia ? ['#2C6F8A', '#07151D'] : n.lenda ? ['#6A1426', '#16030A'] : [tom(c, -.55), tom(c, -.86)];
    const pedra = dia ? '#FF9FE0' : '#FF3B4A'; // joias da coroa, das espadas e do escudo
    const fora = formaEscudo(w, h, t), dentro = formaEscudo(w - 16, h - 18, t + 8);
    const cy = t + h * (n.div || n.lenda ? .43 : .48);
    const fs = w * .64 * (letra.length > 2 ? .58 : letra.length > 1 ? .76 : 1);
    const l = 60 - w / 2;
    const traco = `stroke="${escuro}" stroke-linejoin="round"`;
    let defs = '', fx = '', atras = '', frente = '';
    let asa = n.asa ? `<g fill="url(#${id}a)" ${traco} stroke-width="1.4">${parAsas(ASA, l + 6, t + h * .3, n.asa)}</g>` : '';
    let topo = n.topo === 'estrela' ? `<polygon points="${estrela(60, t - 11, 12)}" fill="url(#${id}a)" ${traco} stroke-width="1.4"/>` : '';
    if (n.lenda) {
      const meio = t + h * .45;
      // raios de luz girando atrás (dourados no Lendário, arco-íris no Diamantes) e um halo pulsando
      const cores = dia ? ['#7DF9FF', '#FF9FE0', '#C6A8FF', '#FFFFFF'] : ['#FFE58A', '#FFB347'];
      const raios = Array.from({ length: 16 }, (_, i) => {
        const a = Math.PI * 2 * i / 16, pt = (b) => `${(60 + 60 * Math.cos(b)).toFixed(1)},${(meio + 60 * Math.sin(b)).toFixed(1)}`;
        return `<polygon points="60,${meio} ${pt(a - .09)} ${pt(a + .09)}" fill="${cores[i % cores.length]}"/>`;
      }).join('');
      defs += `<radialGradient id="${id}m" gradientUnits="userSpaceOnUse" cx="60" cy="${meio}" r="60"><stop offset=".2" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>`
        + `<mask id="${id}r"><rect x="-20" y="-20" width="160" height="160" fill="url(#${id}m)"/></mask>`
        + `<radialGradient id="${id}h"><stop offset="0" stop-color="${dia ? '#7DF9FF' : '#FFD84D'}" stop-opacity=".75"/><stop offset="1" stop-color="${dia ? '#C6A8FF' : '#FF7A1A'}" stop-opacity="0"/></radialGradient>`
        + `<linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${dia ? '#9FF6FF' : '#E9EEF3'}"/><stop offset=".5" stop-color="#FFFFFF"/><stop offset="1" stop-color="${dia ? '#3A8FD8' : '#7D8A99'}"/></linearGradient>`
        + `<linearGradient id="${id}v" x1="0" y1="0" x2=".7" y2="1"><stop offset="0" stop-color="${dia ? '#FFFFFF' : '#FF7B6B'}"/><stop offset=".5" stop-color="${dia ? '#C6A8FF' : '#C21A30'}"/><stop offset="1" stop-color="${dia ? '#4B3BC8' : '#4A0610'}"/></linearGradient>`;
      fx = `<g class="esc-fx"><circle class="esc-halo" cx="60" cy="${meio}" r="${dia ? 58 : 50}" fill="url(#${id}h)"/>`
        + `<g mask="url(#${id}r)" opacity="${dia ? .8 : .6}"><g class="esc-raios" style="transform-origin:60px ${meio}px">${raios}</g></g></g>`;
      // duas espadas cruzadas por cima das asas, atrás do escudo
      const espada = (ang) => `<g transform="translate(60 ${meio}) rotate(${ang})">`
        + `<path d="M0 -66L5 -54L5 32L-5 32L-5 -54Z" fill="url(#${id}s)" ${traco} stroke-width="1.2"/><path d="M0 -53V28" stroke="#fff" stroke-opacity=".6" stroke-width="1"/>`
        + `<rect x="-14" y="30" width="28" height="5.5" rx="2.7" fill="url(#${id}a)" ${traco} stroke-width="1.2"/>`
        + `<rect x="-2.6" y="35.5" width="5.2" height="11" fill="${escuro}"/><circle cy="50" r="4" fill="${pedra}" ${traco} stroke-width="1.2"/></g>`;
      atras = espada(54) + espada(-54);
      // asas grandes: uma camada de trás (carmesim / lilás) e as penas da frente
      asa = `<g fill="url(#${id}v)" ${traco} stroke-width="1.2">${parAsas(ASA_G, l + 4, t + h * .36, 1.02, ' rotate(-10)')}</g>`
        + `<g fill="url(#${id}a)" ${traco} stroke-width="1.3">${parAsas(ASA_G, l + 5, t + h * .32, .86)}</g>`;
      // coroa de 5 pontas com pedras
      const pontas = [[34, t - 14], [49, t - 20], [60, t - 27], [71, t - 20], [86, t - 14]];
      topo = `<path d="M40 ${t + 5}L34 ${t - 14}L45 ${t - 4}L49 ${t - 20}L56 ${t - 7}L60 ${t - 27}L64 ${t - 7}L71 ${t - 20}L75 ${t - 4}L86 ${t - 14}L80 ${t + 5}Z" fill="url(#${id}a)" ${traco} stroke-width="1.4"/>`
        + pontas.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === 2 ? 4 : 3.2}" fill="${i % 2 ? (dia ? '#7DF9FF' : '#FFF3B0') : pedra}" ${traco} stroke-width="1.1"/>`).join('')
        + `<path d="${gema(60, t - 6, 6)}" fill="${pedra}" ${traco} stroke-width="1.1"/><path d="${gema(58.6, t - 8, 1.8)}" fill="#fff" fill-opacity=".8"/>`;
      // pedra no pé do escudo
      frente = `<path d="${gema(60, t + h * .8, 5.5)}" fill="${pedra}" ${traco} stroke-width="1.1"/><path d="${gema(58.8, t + h * .8 - 1.8, 1.6)}" fill="#fff" fill-opacity=".8"/>`;
      // Lendário: brasas subindo · Diamantes: faíscas piscando em volta
      const pts = dia
        ? [[14, 30, 6], [106, 26, 5], [110, 86, 6], [10, 94, 5], [94, 112, 4], [28, 8, 4]]
        : [[30, 104], [42, 110], [55, 106], [66, 111], [78, 105], [90, 109]];
      frente += `<g class="esc-fx">${pts.map(([x, y, r], i) => (dia
        ? `<path class="esc-faisca" style="animation-delay:-${(i * .37).toFixed(2)}s" d="${faisca(x, y, r)}" fill="#fff"/>`
        : `<circle class="esc-brasa" style="animation-delay:-${(i * .47).toFixed(2)}s" cx="${x}" cy="${y}" r="1.7" fill="${i % 2 ? '#FFD84D' : '#FF7A1A'}"/>`)).join('')}</g>`;
    }
    const divisas = Array.from({ length: n.div }, (_, i) => {
      const y = t + h * .7 + i * 8, m = w * .18;
      return `<path d="M${60 - m} ${y}L60 ${y + 7}L${60 + m} ${y}" fill="none" stroke="${aro[0]}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join('');
    // lapidação do cristal: linhas do centro pras pontas do escudo
    const facetas = dia ? `<path d="M60 ${t + 8}L60 ${t + h - 10}M${l + 8} ${t + h * .14}L60 ${t + h * .5}L${120 - l - 8} ${t + h * .14}M${l + 8} ${t + h * .5}L60 ${t + h * .5}L${120 - l - 8} ${t + h * .5}" stroke="#BFFBFF" stroke-opacity=".22" stroke-width="1.2" fill="none"/>` : '';
    const meio = letra
      ? `<text x="60" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="${fs.toFixed(1)}" fill="${claro}" stroke="${escuro}" stroke-width="3" paint-order="stroke">${letra.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>`
      : `<polygon points="${estrela(60, cy, w * .2)}" fill="${claro}" stroke="${escuro}" stroke-width="2" stroke-linejoin="round"/>`;
    return `<svg class="esc" viewBox="0 0 120 120" aria-hidden="true">
<defs>
<linearGradient id="${id}a" x1="0" y1="0" x2=".7" y2="1"><stop offset="0" stop-color="${aro[0]}"/><stop offset=".35" stop-color="${aro[1]}"/><stop offset=".7" stop-color="${aro[2]}"/><stop offset="1" stop-color="${aro[3]}"/></linearGradient>
<radialGradient id="${id}b" cx=".5" cy=".38" r=".7"><stop offset="0" stop-color="${campo[0]}"/><stop offset="1" stop-color="${campo[1]}"/></radialGradient>
<linearGradient id="${id}c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset=".48" stop-color="#fff" stop-opacity=".06"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="${id}k"><path d="${fora}"/></clipPath>${defs}
</defs>
${fx}<g class="esc-cristal">${asa}${atras}${topo}<path d="${fora}" fill="url(#${id}a)" stroke="${escuro}" stroke-width="1.6" stroke-linejoin="round"/></g>
<path d="${dentro}" fill="url(#${id}b)" stroke="${escuro}" stroke-width="1.2"/>
${n.filete ? `<path d="${formaEscudo(w - 8, h - 9, t + 4)}" fill="none" stroke="${aro[0]}" stroke-opacity=".75" stroke-width="1.3"/>` : ''}
${facetas}${divisas}
<path d="${fora}" fill="url(#${id}c)"/>
${meio}
<g clip-path="url(#${id}k)"><g transform="skewX(-20)"><rect class="esc-reflexo" x="-40" y="0" width="20" height="130" fill="#fff" fill-opacity=".38"/></g></g>
${frente}
</svg>`;
  }
  // diamante lapidado (brilhante) com faíscas e um reflexo que passa por cima
  let numGema = 0;
  function diamanteSVG(cls = '') {
    const id = 'gd' + (++numGema);
    const w = el('span', { class: `gema-dia ${cls}`, 'aria-hidden': 'true' });
    w.innerHTML = `<svg viewBox="0 0 100 92" width="100%" height="100%">
<defs>
<linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".5" stop-color="#B8FBFF"/><stop offset="1" stop-color="#55D8FF"/></linearGradient>
<linearGradient id="${id}b" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9D9FF"/><stop offset="1" stop-color="#8E7BFF"/></linearGradient>
<linearGradient id="${id}c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7DF9FF"/><stop offset="1" stop-color="#1F6FD6"/></linearGradient>
<linearGradient id="${id}d" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFC6EC"/><stop offset="1" stop-color="#5B8CFF"/></linearGradient>
<linearGradient id="${id}e" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="${id}k"><path d="M25 10H75L95 34L50 88L5 34Z"/></clipPath>
</defs>
<path d="M25 10L5 34H32Z" fill="url(#${id}b)"/>
<path d="M25 10L32 34L50 10Z" fill="url(#${id}a)"/>
<path d="M50 10L32 34H68Z" fill="#F4FEFF"/>
<path d="M50 10L68 34L75 10Z" fill="url(#${id}a)"/>
<path d="M75 10L68 34H95Z" fill="url(#${id}d)"/>
<path d="M5 34H32L50 88Z" fill="url(#${id}c)"/>
<path d="M32 34H68L50 88Z" fill="url(#${id}a)"/>
<path d="M68 34H95L50 88Z" fill="url(#${id}b)"/>
<g clip-path="url(#${id}k)"><g class="gd-reflexo"><rect x="-60" y="-10" width="34" height="120" fill="url(#${id}e)" transform="rotate(20 50 46)"/></g></g>
<path d="M25 10H75L95 34L50 88L5 34Z M5 34H95 M25 10L32 34L50 88L68 34L75 10 M50 10L32 34 M50 10L68 34" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.2" stroke-linejoin="round"/>
<path class="gd-faisca f1" d="M84 4l2.2 6.8L93 13l-6.8 2.2L84 22l-2.2-6.8L75 13l6.8-2.2z" fill="#fff"/>
<path class="gd-faisca f2" d="M12 50l1.4 4.1 4.1 1.4-4.1 1.4L12 61l-1.4-4.1L6.5 55.5l4.1-1.4z" fill="#fff"/>
<path class="gd-faisca f3" d="M70 60l1.2 3.3 3.3 1.2-3.3 1.2L70 69l-1.2-3.3-3.3-1.2 3.3-1.2z" fill="#fff"/>
</svg>`;
    return w;
  }
  function btnPerfil(j, classe, conteudo) {
    return el('button', { type: 'button', class: classe, onclick: () => abrirPerfil(j.chave), 'aria-label': `Ver perfil de ${comTag(j.nome)}` }, conteudo || comTag(j.nome));
  }

  // ---------- medalhas ----------
  // prog = [quanto tem, quanto precisa] pras trancadas; quando = data em que conquistou (quando dá pra saber)
  function medalhasDe(j, ctx) {
    const sem = ctx.semana.find((x) => x.chave === j.chave);
    const recorde = j.melhor ? j.melhor.mass : 0;
    const titulos = (ctx.titulos && ctx.titulos.get(j.chave)) || 0;
    const tnVit = vitoriasTorneio(j.chave), tnVice = vicesTorneio(j.chave);
    const minhas = j.chave ? partidas.filter((p) => chave(p.player) === j.chave).reverse() : []; // mais antigas primeiro
    const quando = (teste, n = 1) => { let c = 0; for (const p of minhas) if (teste(p) && ++c >= n) return p.created_at; return null; };
    const clube = (vezes, id, icone) => ({
      id, nome: `Clube ${fmtK(MARCO * vezes)}`, como: `1 partida de ${fmtK(MARCO * vezes)}+`, ok: recorde >= MARCO * vezes, icone,
      prog: [recorde, MARCO * vezes], quando: quando((p) => p.mass >= MARCO * vezes),
    });
    return [
      { id: 'rei', nome: 'Rei do clã', como: '1º lugar em pontos', ok: ctx.pontos[0] && ctx.pontos[0].chave === j.chave, icone: ICONE_COROA },
      { id: 'recorde', nome: 'Recordista', como: 'maior massa do clã', ok: ctx.massa[0] && ctx.massa[0].chave === j.chave, icone: '<path d="M12 2l3 6 6 1-4.5 4.5 1 6.5L12 17l-5.5 3 1-6.5L3 9l6-1z"/>' },
      { id: 'semana', nome: 'Cobra da semana', como: 'mais pontos na semana', ok: ctx.semana[0] && ctx.semana[0].chave === j.chave && ctx.semana[0].pontos > 0, icone: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-6 2 1 3 2 3 4"/>' },
      { id: 'clube', nome: `Clube ${marcoTxt}`, como: `1 partida de ${marcoTxt}`, ok: j.cem >= 1, icone: '<circle cx="12" cy="12" r="8"/><path d="M8 12l3 3 5-6"/>', prog: [recorde, MARCO], quando: quando((p) => p.mass >= MARCO) },
      { id: 'maquina', nome: `Máquina de ${fmtK(MARCO)}`, como: `5 partidas de ${marcoTxt}`, ok: j.cem >= 5, icone: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>', prog: [j.cem, 5], quando: quando((p) => p.mass >= MARCO, 5) },
      clube(2, 'clube2', '<path d="M7 17l5-5 5 5M7 11l5-5 5 5"/>'),
      clube(5, 'clube5', '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20M9 3l3 18 3-18"/>'),
      clube(10, 'clube10', '<path d="M3 20l6-10 4 6 3-4 5 8z"/><path d="M9 10V4l4 2-4 2"/>'),
      { id: 'campeao', nome: titulos > 1 ? `Campeão ${titulos}×` : 'Campeão de temporada', como: 'ganhar uma temporada (1º do mês)', ok: titulos > 0, icone: ICONE_TROFEU },
      { id: 'torneio', nome: tnVit > 1 ? `Rei dos torneios ${tnVit}×` : 'Campeão de torneio', como: 'ganhar um torneio do clã', ok: tnVit > 0, icone: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.7V17c0 .6-.5 1-1 1.2C7.8 18.8 7 20.2 7 22M14 14.7V17c0 .6.5 1 1 1.2 1.2.6 2 2 2 3.8M18 2H6v7a6 6 0 0 0 12 0V2z"/>' },
      { id: 'vice', nome: tnVice > 1 ? `Prata ${tnVice}×` : 'Vice de torneio', como: 'ficar em 2º num torneio do clã', ok: tnVice > 0, icone: ICONE_MEDALHA },
      { id: 'chamas', nome: 'Em chamas', como: '3 partidas na mesma semana', ok: !!sem && sem.qtd >= 3, icone: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-6 2 1 3 2 3 4"/>', prog: [sem ? sem.qtd : 0, 3] },
      { id: 'fiel', nome: 'Fiel ao clã', como: '10 partidas registradas', ok: j.qtd >= 10, icone: '<path d="M12 21s-7-4.5-7-11a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 6.5-7 11-7 11z"/>', prog: [j.qtd, 10], quando: quando(() => true, 10) },
    ];
  }
  function contexto() {
    const temps = montarTemporadas();
    return { pontos: montarRanking('geral', 'pontos'), massa: montarRanking('geral', 'massa'), semana: montarRanking('semana', 'pontos'), temps, titulos: contarTitulos(temps) };
  }

  // ---------- destaques ----------
  function fechaSemanaTxt() {
    const fim = inicioPeriodo('semana') + 7 * 86400000;
    const h = Math.max(0, Math.round((fim - Date.now()) / 3600000));
    if (h < 1) return 'a semana fecha em instantes';
    if (h < 24) return `a semana fecha em ${h} h`;
    const d = Math.floor(h / 24);
    return `a semana fecha em ${d} ${d === 1 ? 'dia' : 'dias'}${h % 24 ? ` e ${h % 24} h` : ''}`;
  }
  function partidasPara(falta) {
    // quantas partidas de 100K cobrem a diferença
    const vale = pontosDe(META);
    if (!vale) return '';
    const n = Math.ceil(falta / vale);
    return ` (${n} ${n === 1 ? 'partida' : 'partidas'} de ${fmtK(META)})`;
  }

  function renderDestaques(ctx) {
    // cobra da semana
    const s1 = ctx.semana[0];
    $('dqSemana').replaceChildren(
      el('span', { class: 'dq-rot' }, svg(medalhasDe({ chave: '', cem: 0, qtd: 0 }, ctx)[2].icone, 16), 'COBRA DA SEMANA'),
      s1 && s1.pontos > 0
        ? el('div', { class: 'dq-corpo' }, avatarDe(s1.nome, ptsPat(s1.chave), 'av-m'),
            el('div', null, btnPerfil(s1, 'dq-nome'), el('div', { class: 'dq-num', text: `+${ptsTxt(s1.pontos)}` }),
              el('div', { class: 'dq-sub', text: `em ${s1.qtd} ${s1.qtd === 1 ? 'partida' : 'partidas'} nesta semana` })))
        : el('div', { class: 'dq-corpo' }, el('div', null, el('div', { class: 'dq-num', text: 'Vaga aberta' }), el('div', { class: 'dq-sub', text: 'Ninguém pontuou nesta semana ainda.' }))),
      el('div', { class: 'dq-pe', text: fechaSemanaTxt() })
    );

    // caça ao recorde
    const r1 = ctx.massa[0], r2 = ctx.massa[1];
    $('dqRecorde').replaceChildren(
      el('span', { class: 'dq-rot' }, svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>', 16), 'CAÇA AO RECORDE'),
      r1
        ? el('div', { class: 'dq-corpo' }, el('div', null, el('div', { class: 'dq-num laranja', text: fmt(r1.melhor.mass) }),
            el('div', { class: 'dq-sub' }, 'recorde de ', btnPerfil(r1, 'link-nome'), ` · ${dataCurta(r1.melhor.created_at)}`)))
        : el('div', { class: 'dq-corpo' }, el('div', { class: 'dq-num', text: '—' })),
      el('div', { class: 'dq-pe' }, r2 ? [`Mais perto: `, btnPerfil(r2, 'link-nome', r2.nome), `, falta ${fmt(r1.melhor.mass - r2.melhor.mass + 1)} de massa`] : 'Quem passar desse número vira o recordista.')
    );

    // disputa pelo topo
    const p1 = ctx.pontos[0], p2 = ctx.pontos[1];
    const disputa = $('dqDisputa');
    if (!p1) { disputa.replaceChildren(el('span', { class: 'dq-rot', text: 'DISPUTA PELO TOPO' }), el('div', { class: 'dq-sub', text: 'O primeiro a pontuar assume o trono.' })); return; }
    const tot = Math.max(1, p1.pontos + (p2 ? p2.pontos : 0));
    disputa.replaceChildren(
      el('span', { class: 'dq-rot' }, svg('<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5L21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2"/>', 16), 'DISPUTA PELO TOPO'),
      p2
        ? el('div', { class: 'versus' },
            el('div', { class: 'vs-lado' }, btnPerfil(p1, 'dq-nome', p1.nome), el('span', { class: 'vs-pts laranja', text: fmt(p1.pontos) })),
            el('span', { class: 'vs-x', text: '×' }),
            el('div', { class: 'vs-lado dir' }, btnPerfil(p2, 'dq-nome', p2.nome), el('span', { class: 'vs-pts azul', text: fmt(p2.pontos) })))
        : el('div', { class: 'dq-corpo' }, el('div', null, btnPerfil(p1, 'dq-nome'), el('div', { class: 'dq-num laranja', text: ptsTxt(p1.pontos) }))),
      p2 ? el('div', { class: 'vs-barra', 'aria-hidden': 'true' }, el('span', { style: `width:${Math.round(p1.pontos / tot * 100)}%` })) : null,
      el('div', { class: 'dq-pe', text: p2
        ? (p1.pontos === p2.pontos ? 'Empate em pontos! Quem tem mais 100K+ leva.' : `${p2.nome} precisa de ${ptsTxt(p1.pontos - p2.pontos + 1)} pra virar${partidasPara(p1.pontos - p2.pontos + 1)}`)
        : `${p1.nome} reina sozinho por enquanto.` })
    );
  }

  // ---------- escada de patentes ----------
  function renderPatentes() {
    // quem está em cada degrau nesta temporada (quem desceu na virada já aparece no novo degrau)
    const porNivel = new Map();
    const agora = [...(patentesPorTemporada().get(mesChave(Date.now())) || new Map()).values()]
      .filter((x) => !exMembro(x.chave)).sort((a, b) => b.pts - a.pts);
    for (const x of agora) {
      const j = { chave: x.chave, nome: x.nome, pontos: x.pts };
      if (!porNivel.has(x.fim)) porNivel.set(x.fim, []);
      porNivel.get(x.fim).push(j);
    }
    $('escadaPatentes').replaceChildren(...[...PATENTES].reverse().map((t) => {
      const gente = porNivel.get(t.nivel) || [];
      return el('li', { class: `degrau ${gente.length ? '' : 'vazio-d'} ${t.diamante ? 'degrau-dia' : ''}`, style: `--pc:${t.cor}` },
        t.diamante ? el('span', { class: 'dia-faiscas', 'aria-hidden': 'true' }, ...Array.from({ length: 9 }, () => el('i'))) : null,
        t.diamante ? diamanteSVG('degrau-gema') : degrauEscudo(t),
        el('div', { class: 'degrau-info' },
          el('span', { class: 'degrau-nome', text: t.nome }),
          el('span', { class: 'degrau-pts', text: t.pontos ? `a partir de ${ptsTxt(t.pontos)}` : 'todo mundo começa aqui' })),
        el('div', { class: 'degrau-gente' },
          gente.length
            ? [...gente.slice(0, 4).map((j) => btnPerfil(j, 'av-btn', avatarDe(j.nome, j.pontos))), gente.length > 4 ? el('span', { class: 'mais', text: `+${gente.length - 4}` }) : null]
            : el('span', { class: 'ninguem', text: 'ninguém ainda' }))
      );
    }));
  }

  function degrauEscudo(t) {
    const s = el('span', { class: 'degrau-ins', 'aria-hidden': 'true' });
    s.innerHTML = escudoSVG(t);
    return s;
  }

  // ---------- campeões das temporadas ----------
  function fechaTemporadaTxt(fim) {
    const h = Math.max(0, Math.round((fim - Date.now()) / 3600000));
    if (h < 24) return h < 1 ? 'fecha em instantes' : `fecha em ${h} h`;
    const d = Math.round(h / 24);
    return `fecha em ${d} ${d === 1 ? 'dia' : 'dias'}`;
  }
  // contagem até a virada da temporada (no ranking e na página de patentes)
  function renderFimTemporada() {
    const agora = Date.now();
    const mes = nomeMes(agora).toUpperCase();
    $('seloPeriodo').textContent = `${nomeTemp(agora).toUpperCase()} · ${mes}`;
    const eu = lerEu();
    const x = eu && !exMembro(eu) ? patTemp(eu) : null;
    const pat = PATENTES[x ? x.fim : 0];
    // cria de novo pra cada caixa (o mesmo nó não pode ficar em dois lugares)
    // "você": patente agora ▸ patente no dia 1 (a queda aparece, sem precisar explicar)
    const minha = () => (eu && elenco.has(eu)
      ? el('span', { class: 'ft-eu', title: pat.nivel ? `No dia 1 você cai pra ${PATENTES[nivelNaVirada(pat.nivel)].nome}` : 'Sua patente nesta temporada' },
          el('span', { class: 'ft-eu-rot', text: 'VOCÊ' }), chipPatente(pat.pontos),
          pat.nivel ? [el('span', { class: 'ft-seta', 'aria-hidden': 'true', text: '▸' }), el('span', { class: 'ft-dia1', text: 'DIA 1' }), chipPatente(PATENTES[nivelNaVirada(pat.nivel)].pontos, 'pat-apagada')] : null)
      : null);
    const montar = () => el('div', { class: 'ft-box' },
      el('div', { class: 'ft-txt' },
        el('span', { class: 'ft-rot' }, el('span', { class: 'ft-vivo', 'aria-hidden': 'true' }), `${nomeTemp(agora).toUpperCase()} · ${mes}`,
          el('button', { type: 'button', class: 'info-btn', 'data-info': 'temporada', 'aria-label': 'Como funciona a temporada', text: 'i' })),
        el('b', { class: 'ft-titulo', text: 'TERMINA EM' }),
        minha()),
      contagem(fimDoMes(agora), ''));
    for (const id of ['fimTemporada', 'fimTemporadaPat']) trocar($(id), montar());
  }

  // ---------- como funciona (regras em abas, no lugar dos textos no meio do site) ----------
  const REGRA_ABAS = ['temporada', 'patentes', 'pontos', 'chat'];
  let regraAba = 'temporada';
  // linha de regra: ícone/rótulo curto à esquerda, valor à direita (como tela de regras de jogo)
  const linhaRegra = (rot, ...val) => el('li', { class: 'rg-linha' }, el('span', { class: 'rg-rot', text: rot }), el('span', { class: 'rg-val' }, ...val));
  const tituloRegra = (t) => el('h3', { class: 'rg-h', text: t });
  function abrirRegras(aba = regraAba) {
    regraAba = REGRA_ABAS.includes(aba) ? aba : 'temporada';
    document.querySelectorAll('.aba[data-regra]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.regra === regraAba)));
    const corpo = { temporada: regrasTemporada, patentes: regrasPatentes, pontos: regrasPontos, chat: regrasChat }[regraAba]();
    trocar($('regrasCorpo'), corpo);
    const dlg = $('dlgRegras');
    if (!dlg.open) dlg.showModal();
    $('regrasCorpo').scrollTop = 0;
    dlg.focus();
  }
  function regrasTemporada() {
    const agora = Date.now();
    return [
      el('div', { class: 'rg-destaque' },
        el('span', { class: 'rg-num', text: nomeTemp(agora).toUpperCase() }),
        el('span', { class: 'sec', text: `${nomeMes(agora)} · termina dia 1º às 00:00` })),
      el('ul', { class: 'rg-lista' },
        linhaRegra('Duração', '1 mês'),
        linhaRegra('Campeão', 'mais pontos no mês leva a taça'),
        linhaRegra('Coroa', 'o campeão usa a temporada seguinte inteira'),
        linhaRegra('Perde a coroa', 'se não ganhar de novo'),
        linhaRegra('Pontos do mês', 'zeram no dia 1'),
        linhaRegra('Patente', `cai ${CAI_NA_VIRADA} no dia 1`),
        linhaRegra('Insígnia', 'a patente final fica no perfil'),
        linhaRegra('Ranking geral', 'nunca zera')),
      tituloRegra('NA VIRADA'),
      el('ul', { class: 'rg-virada' }, ...[...PATENTES].reverse().filter((p) => p.nivel).map((p) => {
        const vai = PATENTES[nivelNaVirada(p.nivel)];
        return el('li', null, chipPatente(p.pontos), el('span', { class: 'ft-seta', 'aria-hidden': 'true', text: '▸' }), chipPatente(vai.pontos, 'pat-apagada'),
          el('span', { class: 'rg-mini', text: ptsTxt(vai.pontos) }));
      })),
    ];
  }
  function regrasPatentes() {
    return [
      el('ul', { class: 'rg-escada' }, ...[...PATENTES].reverse().map((p) => el('li', { style: `--pc:${p.cor}` },
        chipPatente(p.pontos),
        el('span', { class: 'rg-mini', text: p.pontos ? ptsTxt(p.pontos) : 'início' })))),
      el('ul', { class: 'rg-lista' },
        linhaRegra('Conta', 'pontos da temporada'),
        linhaRegra('Começo do mês', 'piso da patente que sobrou')),
    ];
  }
  function regrasPontos() {
    const vale = (m) => { const d = detalhePontos(m); return d.bonus ? `${fmt(d.base)} + ${fmt(d.bonus)} = ${ptsTxt(d.total)}` : ptsTxt(d.total); };
    return [
      el('ul', { class: 'rg-lista' },
        linhaRegra('1.000 de massa', ptsTxt(POR_MIL)),
        ...[1, 2, 3].filter((n) => bonusDaMeta(n) > 0).map((n) => linhaRegra(`Passou de ${fmtK(META * n)}`, el('b', { class: 'laranja', text: `+${ptsTxt(bonusDaMeta(n))}` }))),
        BONUS_SOBE ? linhaRegra('Metas seguintes', `+${fmt(BONUS_SOBE)} a mais cada`) : null),
      tituloRegra('EXEMPLOS'),
      el('ul', { class: 'rg-lista' }, ...[50000, META, META * 2, META * 5].filter((m) => m <= MASSA_MAX).map((m) => linhaRegra(`${fmtK(m)}`, vale(m)))),
      tituloRegra('ENTRAR NO RANKING'),
      el('ul', { class: 'rg-lista' },
        linhaRegra('Nick', `com a tag [${TAG}]`),
        linhaRegra('Massa', 'vem do servidor, sem print')),
    ];
  }
  // sala de troféus: a taça em disputa primeiro, depois as já entregues
  function renderTemporadas(ctx) {
    const temps = ctx.temps;
    $('temporadas').hidden = !temps.length;
    const fechadas = temps.filter((t) => !t.atual).length;
    $('tempQtd').textContent = fechadas ? `${fechadas} ${fechadas === 1 ? 'taça entregue' : 'taças entregues'}` : 'a primeira taça está em disputa';
    $('listaTemporadas').replaceChildren(...temps.map((t) => {
      const c = t.top[0];
      return el('li', { class: `tr-item ${t.atual ? 'tr-disputa' : ''}`, style: `--gema:${gemaDe(t)[1]}` },
        el('button', { type: 'button', class: 'tr-vitrine', onclick: () => abrirTrofeu(chaveTemp(t)), 'aria-label': t.atual ? `Taça de ${nomeMes(t.inicio)}, em disputa` : `Taça de ${nomeMes(t.inicio)}: ${comTag(c.nome)} campeão` },
          trofeuDe(t),
          t.atual ? el('span', { class: 'tr-selo', text: 'EM DISPUTA' }) : null),
        el('div', { class: 'tr-info' },
          el('span', { class: 'tr-num', text: nomeTemp(t.inicio).toUpperCase() }),
          el('div', { class: 'tr-mes' }, el('span', { text: rotTemp(t) }), el('small', { text: t.atual ? fechaTemporadaTxt(t.fim) : 'encerrada' })),
          el('div', { class: 'tr-campeao' },
            el('span', { class: 'tr-rot', text: t.atual ? 'liderando' : 'campeão' }),
            btnPerfil(c, 'link-nome', c.nome),
            el('span', { class: 'tr-pts', text: ptsTxt(c.pontos) })),
          t.top.length > 1 ? el('div', { class: 'tr-vices' }, ...t.top.slice(1, 3).map((j, k) => el('span', { class: `tr-vice v${k + 2}` }, `${k + 2}º `, btnPerfil(j, 'link-nome', j.nome)))) : null)
      );
    }));
  }

  // ---------- cerimônia da taça ----------
  function abrirTrofeu(kt, festa = false) {
    const temps = montarTemporadas();
    const i = temps.findIndex((t) => chaveTemp(t) === kt);
    if (i < 0) return false;
    const t = temps[i];
    const c = t.top[0], vice = t.top[1];
    const [gemaNome, gemaCor] = gemaDe(t);
    const ano = new Date(t.inicio).getFullYear();
    const minha = !t.atual && lerEu() === c.chave;
    const confete = t.atual ? null : el('div', { class: 'cer-confete', 'aria-hidden': 'true' },
      ...Array.from({ length: 70 }, (_, n) => el('i', { style: `--x:${Math.random() * 100}%;--d:${(Math.random() * 2.4).toFixed(2)}s;--t:${(2.6 + Math.random() * 2.2).toFixed(2)}s;--r:${Math.round(Math.random() * 720 - 360)}deg;--c:${['#FFD84D', '#FFB347', '#FFF3C0', gemaCor, '#FF7A1A'][n % 5]}` })));
    const stat = (rot, v) => el('div', { class: 'cer-stat' }, el('span', { class: 'pstat-rot', text: rot }), el('b', { text: v }));
    trocar($('trofeuCorpo'),
      confete,
      el('div', { class: 'cer-palco', style: `--gema:${gemaCor}` },
        el('div', { class: 'cer-raios', 'aria-hidden': 'true' }),
        trofeuDe(t, `cer-trofeu ${t.atual ? 'tr-fantasma' : ''}`)),
      el('div', { class: 'cer-info' },
        el('span', { class: 'cer-rot', text: festa && !t.atual ? `A ${nomeTemp(t.inicio).toUpperCase()} (${nomeMes(t.inicio).toUpperCase()}) FECHOU!` : `${nomeTemp(t.inicio).toUpperCase()} · ${nomeMes(t.inicio).toUpperCase()} ${ano}` }),
        minha ? el('span', { class: 'cer-eu', text: '👑 ESSA TAÇA É SUA!' }) : null,
        el('span', { class: 'cer-titulo', text: t.atual ? 'LIDERANDO A DISPUTA' : 'CAMPEÃO' }),
        el('h2', { class: 'cer-nome', id: 'cerNome' }, el('span', { class: 'cer-tag', text: `[${TAG}] ` }), c.nome),
        el('p', { class: 'cer-sub', text: t.atual
          ? `A taça de ${nomeMes(t.inicio)} ainda não tem dono. ${fechaTemporadaTxt(t.fim).replace(/^f/, 'F')}.`
          : vice ? `Levou a taça com ${ptsTxt(c.pontos - vice.pontos)} de vantagem sobre ${vice.nome}.` : 'Levou a taça sozinho: ninguém mais pontuou.' }),
        el('div', { class: 'cer-stats' },
          stat('PONTOS', fmt(c.pontos)), stat('PARTIDAS', fmt(c.qtd)), stat('MAIOR MASSA', fmt(c.melhor.mass)), stat(marcoTxt, `${c.cem}×`)),
        el('ol', { class: 'cer-podio' }, ...t.top.slice(0, 5).map((j, k) => el('li', { class: `tt tt${k + 1}` },
          el('span', { class: 'tt-pos', text: `${k + 1}º` }),
          el('span', { class: 'tt-nome' }, btnPerfil(j, 'link-nome', j.nome)),
          el('span', { class: 'tt-pts', text: ptsTxt(j.pontos) })))),
        t.top.length > 5 ? el('p', { class: 'cer-mais', text: `${t.top.length} jogadores pontuaram nessa temporada` }) : null,
        t.atual ? null : patentesDaCerimonia(t),
        el('p', { class: 'cer-gema' }, el('span', { class: 'cer-gema-cor', 'aria-hidden': 'true' }), `Pedra da temporada: ${gemaNome}`),
        el('div', { class: 'linha-btns' },
          el('button', { type: 'button', class: 'btn btn-sec', onclick: () => compartilharTrofeu(t) }, svg(ICONE_LINK, 18), 'Compartilhar'),
          el('button', { type: 'button', class: 'btn btn-pri', onclick: () => abrirPerfil(c.chave) }, t.atual ? 'Ver o líder' : 'Ver o campeão'))));
    const dlg = $('dlgTrofeu');
    dlg.classList.remove('dlg-dia');
    dlg.style.setProperty('--gema', gemaCor);
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    return true;
  }
  // fim de temporada: a sua insígnia (se marcou "sou eu") e a patente final de cada um
  function patentesDaCerimonia(t) {
    const mapa = patentesPorTemporada().get(chaveTemp(t));
    if (!mapa) return null;
    const pos = new Map(t.top.map((j, i) => [j.chave, i + 1]));
    const lista = [...mapa.values()].filter((x) => x.qtd || x.fim).sort((a, b) => b.fim - a.fim || b.pts - a.pts);
    if (!lista.length) return null;
    const ms = t.inicio;
    const eu = mapa.get(lerEu());
    const minha = eu && (eu.qtd || eu.fim) ? (() => {
      const x = { ...eu, ms, atual: false, pat: PATENTES[eu.fim] };
      const prox = PATENTES[nivelNaVirada(eu.fim)];
      return el('div', { class: 'cer-minha', style: `--pc:${x.pat.cor}` },
        insignia(x, 'ins-g'),
        el('div', { class: 'cer-minha-txt' },
          el('span', { class: 'cer-minha-rot', text: 'SUA TEMPORADA' }),
          el('b', { text: `Fechou como ${x.pat.nome}` }),
          el('span', { text: `${pos.get(eu.chave) ? `${pos.get(eu.chave)}º lugar · ` : ''}${ptsTxt(eu.ganho)}` }),
          el('span', { class: 'cer-minha-vai' }, el('span', { class: 'ft-seta', 'aria-hidden': 'true', text: '▸' }), `T${numTemp(fimDoMes(ms))} `, chipPatente(prox.pontos, 'pat-apagada'))));
    })() : null;
    return el('div', { class: 'cer-pats' },
      minha,
      el('span', { class: 'cer-pats-rot', text: 'PATENTES FINAIS' }),
      el('ul', { class: 'cer-pats-lista' }, ...lista.slice(0, 12).map((x) => {
        const p = PATENTES[x.fim];
        return el('li', { style: `--pc:${p.cor}` },
          el('span', { class: 'tt-nome' }, btnPerfil(x, 'link-nome', x.nome)),
          chipPatente(p.pontos),
          el('span', { class: 'cer-pats-vai', title: `começou a ${nomeTemp(fimDoMes(ms))} como ${PATENTES[nivelNaVirada(x.fim)].nome}`, text: `→ ${PATENTES[nivelNaVirada(x.fim)].nome}` }));
      })),
      null);
  }

  // cerimônia de quem virou Diamantes: cacos de diamante explodindo e raios
  function abrirDiamante(k, festa = false) {
    const x = patTemp(k);
    const pat = x && PATENTES[x.fim];
    if (!pat || !pat.diamante) return false;
    // números da temporada (só chega em Diamantes jogando no mês)
    const j = montarRanking('mes', 'pontos', true).find((y) => y.chave === k) || { nome: x.nome, qtd: 0, melhor: { mass: 0 }, cem: 0 };
    const minha = lerEu() === k;
    const cacos = el('div', { class: 'dia-cacos', 'aria-hidden': 'true' },
      ...Array.from({ length: 48 }, (_, n) => el('i', { style: `--a:${Math.round(n * 7.5 + Math.random() * 6)}deg;--l:${Math.round(150 + Math.random() * 260)}px;--d:${(Math.random() * .5).toFixed(2)}s;--s:${(0.5 + Math.random()).toFixed(2)};--c:${['#7DF9FF', '#FFFFFF', '#C6A8FF', '#FF9FE0', '#5BC8FF'][n % 5]}` })));
    const stat = (rot, v) => el('div', { class: 'cer-stat' }, el('span', { class: 'pstat-rot', text: rot }), el('b', { text: v }));
    trocar($('trofeuCorpo'),
      cacos,
      el('div', { class: 'cer-palco dia-palco' },
        el('div', { class: 'dia-raios', 'aria-hidden': 'true' }),
        el('div', { class: 'dia-anel', 'aria-hidden': 'true' }),
        el('span', { class: 'dia-faiscas', 'aria-hidden': 'true' }, ...Array.from({ length: 16 }, () => el('i'))),
        diamanteSVG('dia-gema-cer')),
      el('div', { class: 'cer-info' },
        el('span', { class: 'cer-rot', text: festa ? 'NOVA PATENTE DESBLOQUEADA' : `PATENTE MÁXIMA · ${ptsTxt(pat.pontos).toUpperCase()}+` }),
        minha ? el('span', { class: 'cer-eu dia-eu', text: '💎 VOCÊ É DIAMANTE!' }) : null,
        el('span', { class: 'cer-titulo dia-virou', text: 'VIROU' }),
        el('span', { class: 'dia-titulo', text: pat.nome.toUpperCase() }),
        el('h2', { class: 'cer-nome dia-nome', id: 'cerNome' }, el('span', { class: 'cer-tag', text: `[${TAG}] ` }), j.nome),
        el('p', { class: 'cer-sub', text: `${nomeTemp(Date.now())} · pouca gente chega aqui.` }),
        el('div', { class: 'cer-stats' },
          stat('PONTOS', fmt(x.pts)), stat('PARTIDAS', fmt(j.qtd)), stat('MAIOR MASSA', fmt(j.melhor.mass)), stat(marcoTxt, `${j.cem}×`)),
        el('div', { class: 'linha-btns' },
          el('button', { type: 'button', class: 'btn btn-sec', onclick: () => $('dlgTrofeu').close() }, 'Fechar'),
          el('button', { type: 'button', class: 'btn btn-dia', onclick: () => { $('dlgTrofeu').close(); abrirPerfil(k); } }, 'Ver o perfil'))));
    const dlg = $('dlgTrofeu');
    dlg.classList.add('dlg-dia');
    dlg.style.setProperty('--gema', COR_DIAMANTE);
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    return true;
  }
  // quem marcou "sou eu" e virou Diamantes ganha a cerimônia uma vez no aparelho, em cada temporada
  function diamanteAutomatico() {
    const eu = lerEu();
    if (!eu) return false;
    const x = patTemp(eu);
    if (!x || !PATENTES[x.fim].diamante) return false;
    const marca = `${eu}|${mesChave(Date.now())}`;
    try {
      if (localStorage.getItem('ranking_dia_visto') === marca) return false;
      localStorage.setItem('ranking_dia_visto', marca);
    } catch (e) { return false; }
    setTimeout(() => { if (!document.querySelector('dialog[open]') && !perfilAtual && !torneioAtual) abrirDiamante(eu, true); }, 900);
    return true;
  }
  async function compartilharTrofeu(t) {
    const url = `${location.origin}${location.pathname}?trofeu=${chaveTemp(t)}`;
    const txt = t.atual
      ? `A taça de ${nomeMes(t.inicio)} do clã ${TAG} tá em disputa. Quem leva?`
      : `${comTag(t.top[0].nome)} é o campeão de ${nomeMes(t.inicio)} do clã ${TAG}!`;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ title: `Taça de ${nomeMes(t.inicio)} · Clã ${TAG}`, text: txt, url }); return; }
      await navigator.clipboard.writeText(url);
      toast('Link da taça copiado.');
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      prompt('Copie o link da taça:', url);
    }
  }
  // link ?trofeu=2026-09 abre a cerimônia; e a temporada que acabou de fechar
  // é entregue sozinha uma vez em cada aparelho (até 10 dias depois)
  function cerimoniaAutomatica() {
    const q = new URLSearchParams(location.search).get('trofeu');
    if (q) { abrirTrofeu(q, true); return; }
    if (perfilAtual || torneioAtual) return;
    if (diamanteAutomatico()) return;
    const ultima = montarTemporadas().find((t) => !t.atual);
    if (!ultima || Date.now() - ultima.fim > 10 * 86400000) return;
    const kt = chaveTemp(ultima);
    try {
      if (localStorage.getItem('ranking_taca_vista') === kt) return;
      localStorage.setItem('ranking_taca_vista', kt);
    } catch (e) { return; }
    setTimeout(() => { if (!document.querySelector('dialog[open]') && !perfilAtual && !torneioAtual) abrirTrofeu(kt, true); }, 900);
  }

  // troféus que o jogador ganhou, pro perfil
  function secaoTrofeusPerfil(k, ctx) {
    const ganhas = ctx.temps.filter((t) => !t.atual && t.top[0].chave === k);
    if (!ganhas.length) return null;
    return el('section', { class: 'pp-sec', 'aria-labelledby': 'ppTrof' },
      el('h2', { class: 'perfil-h3', id: 'ppTrof' }, 'TROFÉUS ', el('span', { class: 'sec', text: `${ganhas.length} ${ganhas.length === 1 ? 'taça' : 'taças'}` })),
      el('ul', { class: 'pp-trofeus' }, ...ganhas.map((t) => el('li', null,
        el('button', { type: 'button', class: 'pp-trofeu', style: `--gema:${gemaDe(t)[1]}`, onclick: () => abrirTrofeu(chaveTemp(t)), 'aria-label': `Taça de ${nomeMes(t.inicio)}` },
          trofeuDe(t),
          el('span', { text: rotTemp(t) }))))));
  }

  // insígnias: a patente com que o jogador fechou cada temporada (ficam pra sempre)
  function insigniasDe(k) {
    const lista = [];
    for (const [mc, mapa] of patentesPorTemporada()) {
      const x = mapa.get(k);
      if (!x || (!x.qtd && !x.fim)) continue;
      const [a, m] = mc.split('-').map(Number);
      const ms = new Date(a, m - 1, 1).getTime();
      lista.push({ ...x, ms, atual: fimDoMes(ms) > Date.now(), pat: PATENTES[x.fim] });
    }
    return lista.reverse(); // mais nova primeiro
  }
  function insignia(x, cls = '') {
    const n = numTemp(x.ms);
    const ano = new Date(x.ms).getFullYear();
    const escudo = el('span', { class: 'ins-escudo', 'aria-hidden': 'true' });
    escudo.innerHTML = escudoSVG(x.pat, n >= 1 ? `T${n}` : nomeMes(x.ms).slice(0, 3).toUpperCase());
    return el('div', { class: `insignia ${x.pat.diamante ? 'ins-dia' : ''} ${x.atual ? 'ins-atual' : ''} ${cls}`, style: `--pc:${x.pat.cor}`, title: `${nomeTemp(x.ms)} (${nomeMes(x.ms)} ${ano}): ${x.atual ? 'está' : 'fechou'} como ${x.pat.nome}` },
      escudo,
      el('span', { class: 'ins-nome', text: x.pat.nome }),
      el('span', { class: 'ins-mes', text: `${nomeMes(x.ms).slice(0, 3)} ${String(ano).slice(2)}${x.atual ? ' · agora' : ''}` }));
  }
  function secaoInsigniasPerfil(k) {
    const lista = insigniasDe(k);
    if (!lista.length) return null;
    const fechadas = lista.filter((x) => !x.atual);
    const melhor = fechadas.reduce((m, x) => (!m || x.fim > m.fim ? x : m), null);
    return el('section', { class: 'pp-sec', 'aria-labelledby': 'ppIns' },
      el('h2', { class: 'perfil-h3', id: 'ppIns' }, 'INSÍGNIAS DE TEMPORADA ', melhor ? el('span', { class: 'sec', text: `melhor: ${melhor.pat.nome}` }) : null),
      el('div', { class: 'insignias' }, ...lista.map((x) => insignia(x))));
  }

  // ---------- hall da fama ----------
  let hallQtd = 6;
  function renderHall() {
    const lista = partidas.filter((p) => p.mass >= MARCO).sort((a, b) => b.mass - a.mass);
    $('hall').hidden = !lista.length;
    $('hallMarco').textContent = marcoTxt;
    $('hallQtd').textContent = `${lista.length} ${lista.length === 1 ? 'partida' : 'partidas'} no clã`;
    const resto = lista.length - hallQtd;
    $('hallMaisBox').hidden = resto <= 0;
    $('btnHallMais').textContent = `Ver mais ${Math.min(resto, 12)}`;
    const pts = new Map(montarRanking('geral', 'pontos').map((j) => [j.chave, j]));
    $('listaHall').replaceChildren(...lista.slice(0, hallQtd).map((p, i) => {
      const j = pts.get(chave(p.player));
      const url = urlPrint(p);
      return el('li', { class: `fama ${i === 0 ? 'fama-1' : ''}` },
        el('span', { class: 'fama-pos', text: `#${i + 1}` }),
        el('div', { class: 'fama-info' },
          el('span', { class: 'fama-massa', text: fmt(p.mass) }),
          j ? btnPerfil(j, 'link-nome fama-nome') : el('span', { class: 'fama-nome', text: comTag(limparNick(p.player)) }),
          el('span', { class: 'fama-data', text: new Date(p.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/\./g, '') })),
        url ? el('button', { type: 'button', class: 'fama-print', onclick: () => abrirPrint(p), 'aria-label': 'Ver print' }, el('img', { src: url, alt: '', loading: 'lazy' })) : null
      );
    }));
  }

  // ---------- perfil do jogador ----------
  function grafico(lista) {
    const W = 560, H = 180, pl = 4, pr = 46, pt = 12, pb = 24;
    const maxV = Math.max(MARCO * 1.12, ...lista.map((p) => p.mass)) * 1.04;
    const y = (v) => pt + (H - pt - pb) * (1 - v / maxV);
    const bw = (W - pl - pr) / Math.max(lista.length, 8);
    const barras = lista.map((p, i) => {
      const x = pl + i * bw + bw * 0.16, w = bw * 0.68, top = y(p.mass);
      const cem = p.mass >= MARCO;
      return `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${(y(0) - top).toFixed(1)}" rx="3" class="${cem ? 'b-cem' : 'b'}"><title>${fmt(p.mass)} · ${dataCurta(p.created_at)}</title></rect>`;
    }).join('');
    const ym = y(MARCO).toFixed(1);
    const d0 = lista[0] ? dataCurta(lista[0].created_at) : '';
    const d1 = lista.length > 1 ? dataCurta(lista[lista.length - 1].created_at) : '';
    const xUlt = pl + (lista.length - 1) * bw + bw / 2;
    return `<svg viewBox="0 0 ${W} ${H}" class="grafico" role="img" aria-label="Massa das últimas ${lista.length} partidas">
      <line x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}" class="g-base"/>
      ${barras}
      <line x1="${pl}" x2="${W - pr + 4}" y1="${ym}" y2="${ym}" class="g-marco"/>
      <text x="${W - pr + 8}" y="${(+ym + 4).toFixed(1)}" class="g-marco-txt">${fmtK(MARCO)}</text>
      <text x="${pl}" y="${H - 6}" class="g-txt">${d0}</text>
      ${d1 ? `<text x="${Math.min(xUlt, W - pr).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="g-txt">${d1}</text>` : ''}
    </svg>`;
  }

  function chipsCadastro(r) {
    if (!r) return [];
    const desde = r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '') : '';
    return [chipCargo(r), !r.ativo ? el('span', { class: 'ex-chip', text: 'EX-MEMBRO' }) : null, desde ? el('span', { class: 'sec', text: `no clã desde ${desde}` }) : null];
  }


  const SEMANA_MS = 7 * 86400000;
  let perfilAtual = null;     // chave do jogador aberto
  let rolagemAntes = 0;       // onde a pessoa estava no ranking antes de abrir
  let perfilMais = false;     // histórico completo aberto
  const ICONE_VOLTAR = '<path d="M15 5l-7 7 7 7"/>';
  const ICONE_LINK = '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>';
  const ICONE_EU = '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>';
  const ICONE_SAIR = '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>';

  // "eu": quem entrou com o login de jogador (vale em qualquer aparelho); pelo id, então trocar o nick não perde
  function lerEu() { const r = euId && jogPorId.get(euId); return r ? chave(r.nick) : null; }
  function renderEu() {
    const k = lerEu();
    const btn = $('btnEu');
    // admin sem jogador ligado não precisa do botão (liga em "Editar jogador" > Sou eu)
    btn.hidden = !elencoOk || (!k && !!admin);
    if (!k) {
      const txt = contaSemJogador ? 'Escolher nick' : 'Entrar';
      btn.replaceChildren(svg(ICONE_EU, 20), el('span', { class: 'btn-txt', text: txt }));
      btn.setAttribute('aria-label', contaSemJogador ? 'Escolher o seu nick' : 'Entrar ou criar conta');
      return;
    }
    const r = elenco.get(k);
    btn.replaceChildren(avatarDe(r.nick, ptsPat(k), 'av-p'), el('span', { class: 'btn-txt', text: 'Meu perfil' }));
    btn.setAttribute('aria-label', `Meu perfil: ${comTag(r.nick)}`);
  }

  function chaveDaUrl() {
    const q = new URLSearchParams(location.search).get('jogador');
    return q ? chave(q) : null;
  }
  function linkPerfil(nome) { return `${location.origin}${location.pathname}?jogador=${encodeURIComponent(nome)}`; }

  function abrirPerfil(k) {
    if (document.querySelector('dialog[open]')) document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    if (!perfilAtual && !torneioAtual) rolagemAntes = scrollY;
    const r = elenco.get(k);
    const nome = r ? r.nick : (montarRanking('geral', 'pontos', true).find((x) => x.chave === k) || {}).nome;
    if (!nome) return;
    history.pushState({ perfil: k, doSite: true }, '', `?jogador=${encodeURIComponent(nome)}`);
    perfilMais = false;
    mostrarRota(true);
  }
  function fecharPerfil() {
    if (history.state && history.state.doSite) { history.back(); return; }
    history.pushState({}, '', location.pathname);
    mostrarRota();
  }
  // voltar = true: saiu do perfil/torneio pelo "voltar", então volta pro ponto onde estava
  function mostrarRota(novo = false, voltar = true) {
    const k = chaveDaUrl();
    const tn = k ? null : torneioDaUrl();
    const antes = perfilAtual, antesTn = torneioAtual;
    perfilAtual = k;
    torneioAtual = tn;
    $('principal').hidden = !!(k || tn);
    $('perfilPagina').hidden = !k;
    $('torneioPagina').hidden = !tn;
    document.body.classList.toggle('vendo-perfil', !!(k || tn));
    if (k) {
      renderPerfil();
      marcarMenu();
      if (novo || antes !== k) rolarJa(0);
    } else if (tn) {
      renderTorneioPagina();
      tickContagens();
      marcarMenu();
      if (novo || antesTn !== tn) rolarJa(0);
    } else {
      document.title = `Ranking Clã ${TAG}`;
      if ((antes || antesTn) && voltar) { mostrarPagina(false); rolarJa(rolagemAntes); }
      else mostrarPagina(true);
    }
  }

  async function compartilharPerfil(nome) {
    const url = linkPerfil(nome);
    const dados = { title: `${comTag(nome)} · Ranking Clã ${TAG}`, text: `Perfil de ${comTag(nome)} no ranking do clã`, url };
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share(dados); return; }
      await navigator.clipboard.writeText(url);
      toast('Link do perfil copiado.');
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      prompt('Copie o link do perfil:', url);
    }
  }

  // posição do jogador num ranking e quanto mudou desde uma data
  function posicao(lista, k) { const i = lista.findIndex((x) => x.chave === k); return i < 0 ? 0 : i + 1; }

  function renderPerfil() {
    const k = perfilAtual;
    const box = $('perfilCorpo');
    const r = elenco.get(k);
    const ctx = contexto();
    const j = ctx.pontos.find((x) => x.chave === k) || montarRanking('geral', 'pontos', true).find((x) => x.chave === k);
    const nome = j ? j.nome : r ? r.nick : null;

    const barra = el('div', { class: 'pp-barra' },
      el('button', { type: 'button', class: 'btn btn-sec pp-voltar', onclick: fecharPerfil }, svg(ICONE_VOLTAR, 18), 'Ranking'),
      nome ? el('div', { class: 'pp-acoes' },
        lerEu() === k ? el('button', { type: 'button', class: 'btn btn-sec', 'aria-label': 'Sair da conta', onclick: () => sairConta() }, svg(ICONE_SAIR, 18), el('span', { class: 'btn-txt', text: 'Sair' })) : null,
        el('button', { type: 'button', class: 'btn btn-sec', onclick: () => compartilharPerfil(nome) }, svg(ICONE_LINK, 18), el('span', { class: 'btn-txt', text: 'Compartilhar' }))) : null);

    if (!nome) {
      document.title = `Jogador não encontrado · Ranking Clã ${TAG}`;
      box.replaceChildren(barra, el('p', { class: 'vazio', text: 'Não achei esse jogador. Confere o nick no link ou procure na busca.' }));
      return;
    }
    document.title = `${comTag(nome)} · Ranking Clã ${TAG}`;

    const pts = j ? j.pontos : 0;            // pontos gerais (todas as partidas)
    const ptsP = ptsPat(k);                   // pontos que valem pra patente nesta temporada
    const pat = patenteDe(ptsP);
    const ativo = !r || r.ativo;

    // cabeçalho
    const posGeral = posicao(ctx.pontos, k);
    const dia = pat.atual.diamante;
    const topo = el('header', { class: `pp-topo ${dia ? 'pp-dia' : pat.atual.nivel >= ESC_NIVEIS.length - 1 ? 'pp-len' : ''} ${ehRei(k) ? 'pp-rei' : ''}`, style: `--pc:${pat.atual.cor}` },
      dia ? el('div', { class: 'pp-dia-fx', 'aria-hidden': 'true' }, el('span', { class: 'pp-dia-raios' }), el('span', { class: 'dia-faiscas' }, ...Array.from({ length: 14 }, () => el('i')))) : null,
      dia ? el('button', { type: 'button', class: 'pp-dia-gema', title: 'Ver a cerimônia de Diamantes', 'aria-label': 'Ver a cerimônia de Diamantes', onclick: () => abrirDiamante(k) }, diamanteSVG()) : null,
      el('div', { class: 'pp-id' },
        avatarDe(nome, ptsP, 'av-xg'),
        el('div', { class: 'pp-nome-box' },
          el('span', { class: 'pp-tag', text: `[${TAG}]` }),
          el('h1', { id: 'perfilNome', class: 'pp-nome', text: nome }),
          el('div', { class: 'perfil-chips' }, chipPatente(ptsP, 'patente-g'), chipRei(k), chipTitulos(ctx.titulos.get(k)), ...chipTorneios(k), ...chipsCadastro(r)))),
      posGeral ? el('div', { class: `pp-pos-geral p${posGeral}` },
        el('span', { class: 'pp-pos-num', text: `#${posGeral}` }),
        el('span', { class: 'pp-pos-rot', text: `de ${ctx.pontos.length} no ranking geral` })) : null);

    if (!j) {
      box.replaceChildren(barra, topo, el('p', { class: 'vazio perfil-vazio', text: 'Sem partidas ainda.' }));
      return;
    }

    // posições: geral, temporada, semana, maior massa (com quanto subiu/caiu na última semana)
    const semanaPassada = Date.now() - SEMANA_MS;
    const antes = montarRanking('geral', 'pontos', false, semanaPassada);
    const mov = (() => {
      const a = posicao(antes, k);
      if (!posGeral) return null;
      if (!a) return { cls: 'novo', txt: 'novo no ranking' };
      const d = a - posGeral;
      return d > 0 ? { cls: 'sobe', txt: `▲ subiu ${d} em 7 dias` } : d < 0 ? { cls: 'desce', txt: `▼ caiu ${-d} em 7 dias` } : { cls: 'igual', txt: 'estável em 7 dias' };
    })();
    const mes = montarRanking('mes', 'pontos');
    const sem = ctx.semana;
    const cartao = (rot, pos, total, sub, extra) => el('div', { class: `pp-posc ${pos ? 'p' + pos : 'sem-pos'}` },
      el('span', { class: 'pstat-rot', text: rot }),
      el('span', { class: 'pp-posc-num', text: pos ? `#${pos}` : '—' }),
      el('span', { class: 'pp-posc-sub', text: pos ? `de ${total} · ${sub}` : sub }),
      extra || null);
    const jMes = mes.find((x) => x.chave === k), jSem = sem.find((x) => x.chave === k);
    const posicoes = el('section', { class: 'pp-sec', 'aria-labelledby': 'ppPos' },
      el('h2', { class: 'perfil-h3', id: 'ppPos', text: 'POSIÇÕES' }),
      el('div', { class: 'pp-posicoes' },
        cartao('GERAL', posGeral, ctx.pontos.length, ptsTxt(pts), mov ? el('span', { class: `pp-mov ${mov.cls}`, text: mov.txt }) : null),
        cartao('TEMPORADA', posicao(mes, k), mes.length, jMes ? ptsTxt(jMes.pontos) : 'sem partida neste mês'),
        cartao('SEMANA', posicao(sem, k), sem.length, jSem ? ptsTxt(jSem.pontos) : 'sem partida nesta semana'),
        cartao('MAIOR MASSA', posicao(ctx.massa, k), ctx.massa.length, `recorde ${fmt(j.melhor.mass)}`)));

    // patente (da temporada)
    const xt = patTemp(k);
    const desce = PATENTES[nivelNaVirada(pat.atual.nivel)];
    const prog = el('div', { class: 'perfil-prog', style: `--pc:${pat.atual.cor}` },
      el('span', { class: 'prog-temp' }, `PATENTE · ${nomeTemp(Date.now()).toUpperCase()}`,
        el('button', { type: 'button', class: 'info-btn', 'data-info': 'patentes', 'aria-label': 'Como funcionam as patentes', text: 'i' })),
      el('div', { class: 'prog-linha' },
        el('span', { text: pat.atual.nome }),
        el('span', { class: 'sec', text: pat.prox ? `${fmt(ptsP)} / ${fmt(pat.prox.pontos)} pts` : `${fmt(ptsP)} pts` }),
        el('span', { text: pat.prox ? pat.prox.nome : 'NÍVEL MÁXIMO' })),
      el('div', { class: 'barra barra-pat', role: 'progressbar', 'aria-label': 'Progresso da patente', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pat.progresso * 100)) },
        el('span', { style: `width:${Math.round(pat.progresso * 100)}%` })),
      el('div', { class: 'prog-sub', text: pat.prox
        ? `Faltam ${ptsTxt(pat.prox.pontos - ptsP)} pra virar ${pat.prox.nome}${partidasPara(pat.prox.pontos - ptsP)}`
        : 'Chegou no topo. Agora é defender o trono.' }),
      // começo do mês ▸ agora ▸ dia 1, em chips (sem frase)
      el('div', { class: 'prog-virada' },
        xt && xt.ini ? el('span', { class: 'pv-item', title: `Começou a temporada como ${PATENTES[xt.ini].nome}` }, el('span', { class: 'ft-dia1', text: 'INÍCIO' }), chipPatente(PATENTES[xt.ini].pontos, 'pat-apagada')) : null,
        pat.atual.nivel ? el('span', { class: 'pv-item', title: `No dia 1 cai pra ${desce.nome}` }, el('span', { class: 'ft-dia1', text: 'DIA 1' }), el('span', { class: 'ft-seta', 'aria-hidden': 'true', text: '▸' }), chipPatente(desce.pontos, 'pat-apagada')) : null));
    if (!prog.lastChild.childNodes.length) prog.lastChild.remove();
    if ((pat.prox && pat.prox.diamante) || pat.atual.diamante) prog.classList.add('prog-dia');

    // números
    const minhas = partidas.filter((p) => chave(p.player) === k); // mais novas primeiro
    const media = Math.round(minhas.reduce((s, p) => s + p.mass, 0) / Math.max(1, minhas.length));
    const numeros = el('div', { class: 'perfil-stats' },
      ...[['PONTOS', fmt(pts), 'laranja'], ['RECORDE', fmt(j.melhor.mass), ''], ['MÉDIA', fmt(media), ''], ['PARTIDAS', fmt(j.qtd), ''], [marcoTxt, `${j.cem}×`, j.cem ? 'laranja' : ''], ['ÚLTIMA', haQuanto(j.ultima), 'pstat-txt']]
        .map(([rot, v, c]) => el('div', { class: 'pstat' }, el('span', { class: 'pstat-rot', text: rot }), el('span', { class: `pstat-num ${c}`, text: v }))));

    // medalhas: conquistadas primeiro; as trancadas mostram quanto falta
    const meds = medalhasDe(j, ctx);
    const ganhas = meds.filter((m) => m.ok);
    const ordem = [...ganhas, ...meds.filter((m) => !m.ok).sort((a, b) => progMed(b) - progMed(a))];
    const medalhas = el('section', { class: 'pp-sec', 'aria-labelledby': 'ppMed' },
      el('h2', { class: 'perfil-h3', id: 'ppMed' }, 'MEDALHAS ', el('span', { class: 'sec', text: `${ganhas.length} de ${meds.length}` })),
      el('ul', { class: 'medalhas' }, ...ordem.map((m) => el('li', { class: `medalha ${m.ok ? 'ok' : 'trancada'}`, title: m.como },
        el('span', { class: 'med-ic', 'aria-hidden': 'true' }, svg(m.icone, 20)),
        el('span', { class: 'med-txt' },
          el('b', { text: m.nome }),
          el('span', { text: m.ok ? (m.quando ? `conquistada ${haQuanto(m.quando)}` : 'conquistada') : m.como }),
          !m.ok && m.prog ? el('span', { class: 'med-prog', 'aria-label': `${m.prog[0]} de ${m.prog[1]}` },
            el('span', { class: 'med-prog-barra', 'aria-hidden': 'true' }, el('span', { style: `width:${Math.round(progMed(m) * 100)}%` })),
            el('span', { class: 'med-prog-txt', text: progTxt(m.prog) })) : null)))));

    // evolução
    const ultimas = minhas.slice(0, 20).reverse();
    const g = document.createElement('div');
    g.className = 'grafico-box';
    g.innerHTML = grafico(ultimas);

    // momentos marcantes do jogador
    const ev = montarConquistas(k, 8);
    const momentos = ev.length ? el('section', { class: 'pp-sec', 'aria-labelledby': 'ppMom' },
      el('h2', { class: 'perfil-h3', id: 'ppMom', text: 'MOMENTOS' }),
      el('ul', { class: 'pp-momentos conquistas-lista' }, ...ev.map((e) => el('li', null,
        el('span', { class: `bola ${e.tipo}`, 'aria-hidden': 'true' }),
        el('span', { class: 'txt' }, e.partes),
        el('span', { class: 'quando', text: dataCurta(e.quando) }))))) : null;

    // histórico de partidas
    const recordeId = j.melhor.id;
    const mostrar = perfilMais ? minhas : minhas.slice(0, 10);
    const historico = el('section', { class: 'pp-sec', 'aria-labelledby': 'ppHist' },
      el('h2', { class: 'perfil-h3', id: 'ppHist' }, 'PARTIDAS ', el('span', { class: 'sec', text: fmt(minhas.length) })),
      el('ul', { class: 'pp-hist' }, ...mostrar.map((p) => {
        const url = urlPrint(p);
        const pp = pontosDe(p.mass);
        return el('li', { class: `pp-hist-item ${p.mass >= MARCO ? 'cem' : ''}` },
          url
            ? el('button', { type: 'button', class: 'mini', 'aria-label': `Ver print de ${fmt(p.mass)}`, onclick: () => abrirPrint(p) }, el('img', { src: url, alt: '', loading: 'lazy' }))
            : el('span', { class: 'mini', text: 'sem print' }),
          el('div', { class: 'pp-hist-info' },
            el('span', { class: 'partida-massa' }, fmt(p.mass),
              p.id === recordeId ? el('span', { class: 'chip', text: 'RECORDE' }) : null,
              p.mass >= MARCO ? el('span', { class: 'cem-chip', text: marcoTxt }) : null),
            el('span', { class: 'partida-data', text: new Date(p.created_at).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(/\./g, '') })),
          el('span', { class: 'pp-hist-pts', text: pp ? `+${ptsTxt(pp)}` : '0 pts' }));
      })),
      minhas.length > mostrar.length ? el('button', { type: 'button', class: 'btn btn-sec pp-mais', onclick: () => { perfilMais = true; renderPerfil(); } }, `Ver todas as ${fmt(minhas.length)} partidas`) : null);

    box.replaceChildren(barra, topo,
      el('div', { class: 'pp-grade' },
        el('div', { class: 'pp-col' }, posicoes, prog, numeros,
          el('section', { class: 'pp-sec', 'aria-labelledby': 'ppEvo' }, el('h2', { class: 'perfil-h3', id: 'ppEvo', text: ultimas.length > 1 ? `EVOLUÇÃO · ÚLTIMAS ${ultimas.length} PARTIDAS` : 'EVOLUÇÃO' }), g),
          medalhas),
        el('div', { class: 'pp-col' }, secaoTrofeusPerfil(k, ctx), secaoInsigniasPerfil(k), secaoTorneiosPerfil(k), momentos, historico)));
  }
  // troféu (campeão) e medalha de prata (vice) de torneio; curto = só o número (tabela do ranking)
  function chipTorneios(k, curto = false) {
    const v = vitoriasTorneio(k), p = vicesTorneio(k);
    return [
      v ? el('span', { class: 'titulo-chip tn-chip', title: `${v}× campeão de torneio` }, svg(ICONE_TROFEU, 12), curto ? (v > 1 ? `${v}×` : null) : `${v}× torneio`) : null,
      p ? el('span', { class: 'titulo-chip tn-chip-vice', title: `${p}× vice-campeão de torneio` }, svg(ICONE_MEDALHA, 12), curto ? (p > 1 ? `${p}×` : null) : `${p}× vice`) : null,
    ];
  }
  // massa vira 121K/200K pra caber; contagem fica 4/5
  const progTxt = ([a, b]) => (b >= 10000 ? `${fmt(Math.floor(Math.min(a, b) / 1000))}K/${fmtK(b)}` : `${fmt(Math.min(a, b))}/${fmt(b)}`);
  const progMed = (m) => (m.prog ? Math.min(1, m.prog[0] / m.prog[1]) : 0);

  // ============================================================
  //  TORNEIOS E CAMPEONATOS
  //  O dono monta pelo site: formato, o que conta, datas, quem joga e prêmios.
  //  A classificação é calculada aqui, do mesmo jeito que o ranking.
  // ============================================================
  const ICONE_ESPADAS = '<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5L21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2"/>';
  const ICONE_RELOGIO = '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>';
  const ICONE_CONVERSA = '<path d="M4 20l1.4-4.2A8 8 0 1 1 8.2 18.6z"/>';
  const ICONE_BANDEIRA = '<path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/>';
  const FORMATOS = {
    soma: { nome: 'Quem soma mais', curto: 'SOMA TUDO', icone: '<path d="M5 20V12M12 20V5M19 20v-9"/>', desc: 'Todas as partidas somam. Vence o maior total.' },
    melhor: { nome: 'Maior partida', curto: 'MAIOR PARTIDA', icone: '<path d="M12 2l3 6 6 1-4.5 4.5 1 6.5L12 17l-5.5 3 1-6.5L3 9l6-1z"/>', desc: 'Vale só a melhor partida de cada um.' },
    melhores: { nome: 'Melhores partidas', curto: 'MELHORES', icone: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>', desc: 'Soma só as melhores de cada um. Jogar mais não dá vantagem.' },
    meta: { nome: 'Corrida até a meta', curto: 'CORRIDA', icone: ICONE_BANDEIRA, desc: 'O primeiro a chegar no número vence.' },
    mata: { nome: 'Mata-mata', curto: 'MATA-MATA', icone: ICONE_ESPADAS, desc: 'Duelos 1 contra 1. Perdeu, tá fora.' },
    hora: { nome: 'Líder na hora H', curto: 'HORA H', icone: ICONE_RELOGIO, desc: 'Quem estiver em 1º no ranking do clã na hora marcada é o campeão.' },
    livre: { nome: 'Regras próprias', curto: 'REGRAS PRÓPRIAS', icone: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 12h6M9 16h4"/>', desc: 'Você escreve as regras e, no fim, escolhe o campeão e o vice.' },
  };
  const formatoDe = (t) => FORMATOS[t.formato] || FORMATOS.soma;
  // como o "hora H" conta: no ranking por pontos soma tudo, no de massa vale a maior partida
  const regraTn = (t) => (t.formato === 'hora' ? (t.metrica === 'massa' ? 'melhor' : 'soma') : t.formato);
  const BASES = { geral: 'ranking geral', mes: 'temporada do mês', semana: 'ranking da semana' };
  const NA_BASE = { geral: 'no ranking geral', mes: 'na temporada do mês', semana: 'no ranking da semana' };
  const baseDe = (t) => (BASES[t.base] ? t.base : 'geral');

  // pontos da patente de cada um (pra cor do avatar)
  const ptsGeralDe = (k) => ptsPat(k);
  // pontos do ranking geral (pra montar a chave do mata-mata pelo ranking)
  let cacheGeral = null;
  function ptsRankingDe(k) {
    if (!cacheGeral || cacheGeral.n !== partidas.length || cacheGeral.p !== partidas[0]) {
      cacheGeral = { n: partidas.length, p: partidas[0], m: new Map(montarRanking('geral', 'pontos', true).map((j) => [j.chave, j.pontos])) };
    }
    return cacheGeral.m.get(k) || 0;
  }

  // até quando valem as partidas: o fim marcado ou a hora em que o dono encerrou
  const fimTn = (t) => Math.min(t.fim ? Date.parse(t.fim) : Infinity, t.encerrado_em ? Date.parse(t.encerrado_em) : Infinity);
  function statusTn(t) {
    const agora = Date.now();
    if (t.formato === 'mata') {
      if (t.encerrado_em || campeaoMata(t)) return 'fim';
    } else if (agora >= fimTn(t) || (t.formato === 'livre' && podioLivre(t)[0])) return 'fim';
    return agora < Date.parse(t.inicio) ? 'breve' : 'vivo';
  }
  const torneiosVisiveis = () => (torneiosOk ? torneios.filter((t) => t.publicado || admin) : []);

  function unidadeTn(t, n = 2) {
    if (t.metrica === 'pontos') return n === 1 ? 'pt' : 'pts';
    if (t.metrica === 'massa') return 'de massa';
    return String(t.unidade || '').trim() || 'pts';
  }
  const valorTn = (t, v) => `${fmt(v)} ${unidadeTn(t, v)}`;
  const nomeMetrica = (t) => (t.metrica === 'pontos' ? 'pontos' : t.metrica === 'massa' ? 'massa' : String(t.unidade || '').trim() || 'pontos');
  const rotMetrica = (t) => nomeMetrica(t).toUpperCase();
  const nickId = (id) => { const r = jogPorId.get(id); return r ? r.nick : '?'; };

  function idsInscritos(t) {
    if (t.todos) return jogadores.filter((r) => r.ativo).map((r) => r.id);
    return [...new Set(t.participantes || [])].filter((id) => jogPorId.has(id));
  }
  // chave do nick -> nome de quem está inscrito
  function inscritosTn(t) {
    return new Map(idsInscritos(t).map((id) => { const r = jogPorId.get(id); return [chave(r.nick), r.nick]; }));
  }

  // tudo que conta no torneio: partidas do ranking no período (se ligado) + resultados lançados na mão
  function entradasTn(t) {
    const lista = [];
    if (t.formato === 'livre') return lista;
    const hora = t.formato === 'hora';
    if (hora || (t.auto && t.metrica !== 'custom' && t.formato !== 'mata')) {
      // hora H: vale o ranking escolhido (geral, do mês ou da semana) como estava na hora marcada
      const fim = fimTn(t);
      const ini = hora ? inicioPeriodo(baseDe(t), isFinite(fim) ? fim : Date.now()) : Date.parse(t.inicio);
      const insc = t.todos ? null : inscritosTn(t);
      for (const p of partidas) {
        const q = Date.parse(p.created_at);
        if (q < ini || q >= fim) continue;
        const k = chave(p.player);
        if (insc && !insc.has(k)) continue;
        lista.push({ id: p.id, k, nome: nomeDe(k, p.player), bruto: p.mass, quando: p.created_at, partida: p });
      }
    }
    for (const l of lancamentos) {
      if (l.torneio_id !== t.id || hora) continue;
      const r = jogPorId.get(l.player_id);
      if (!r) continue;
      lista.push({ id: l.id, k: chave(r.nick), nome: r.nick, bruto: l.valor, quando: l.created_at, lanc: l });
    }
    // em "pontos", o que entra é a massa e vira ponto pela mesma regra do ranking
    for (const e of lista) e.valor = t.metrica === 'pontos' ? pontosDe(e.bruto) : e.bruto;
    return lista.sort((a, b) => Date.parse(b.quando) - Date.parse(a.quando));
  }

  // classificação de torneio por pontos (todos os formatos menos o mata-mata)
  function classificarTn(t, ents = entradasTn(t)) {
    const regra = regraTn(t);
    const mapa = new Map();
    const linha = (k, nome) => {
      let l = mapa.get(k);
      if (!l) { l = { chave: k, nome, ents: [], total: 0, qtd: 0, quando: 0, chegou: null, contadas: new Set() }; mapa.set(k, l); }
      return l;
    };
    for (const [k, nome] of inscritosTn(t)) linha(k, nome);
    for (const e of ents) linha(e.k, e.nome).ents.push(e);
    for (const l of mapa.values()) {
      const crono = [...l.ents].sort((a, b) => Date.parse(a.quando) - Date.parse(b.quando));
      let contam = crono;
      if (regra === 'melhor') contam = crono.length ? [crono.reduce((m, e) => (e.valor > m.valor ? e : m))] : [];
      else if (regra === 'melhores') contam = [...crono].sort((a, b) => b.valor - a.valor || Date.parse(a.quando) - Date.parse(b.quando)).slice(0, Math.max(1, t.qtd || 3));
      l.qtd = crono.length;
      l.contadas = new Set(contam.map((e) => e.id));
      l.total = contam.reduce((s, e) => s + e.valor, 0);
      l.quando = contam.reduce((m, e) => Math.max(m, Date.parse(e.quando)), 0);
      if (t.formato === 'meta' && t.meta) {
        let s = 0;
        for (const e of crono) { s += e.valor; if (s >= t.meta) { l.chegou = Date.parse(e.quando); break; } }
      }
    }
    // empate: ganha quem chegou naquele número primeiro
    const lista = [...mapa.values()].sort((a, b) => {
      if (t.formato === 'meta' && (a.chegou || b.chegou)) return a.chegou && b.chegou ? a.chegou - b.chegou : a.chegou ? -1 : 1;
      return b.total - a.total || (a.quando || Infinity) - (b.quando || Infinity) || a.nome.localeCompare(b.nome, 'pt-BR');
    });
    lista.forEach((l, i) => { l.pos = i + 1; });
    return lista;
  }

  // ---------- mata-mata ----------
  // posições na chave: 1º pega o último, 2º o penúltimo... os favoritos só se cruzam no fim
  function ordemSementes(n) {
    let s = [1, 2];
    while (s.length < n) { const m = s.length * 2 + 1; s = s.flatMap((x) => [x, m - x]); }
    return s;
  }
  function montarSlots(ids) {
    let tam = 2;
    while (tam < ids.length) tam *= 2;
    return ordemSementes(tam).map((sd) => ids[sd - 1] || null); // null = folga (passa direto)
  }
  // A chave guarda só a 1ª rodada e os resultados; as rodadas seguintes saem dos vencedores.
  // Se um resultado antigo muda, o duelo seguinte volta a ficar em aberto sozinho.
  function rodadasMata(t) {
    const c = t.chave;
    if (!c || !Array.isArray(c.slots) || c.slots.length < 2) return null;
    const res = c.res || {};
    const rodadas = [];
    let atuais = c.slots;
    for (let r = 0; atuais.length >= 2; r++) {
      const jogos = [];
      for (let i = 0; i < atuais.length; i += 2) {
        const a = atuais[i] || null, b = atuais[i + 1] || null;
        const j = { id: `${r}-${i / 2}`, r, a, b, va: null, vb: null, v: null, wo: false, bye: false };
        if (r === 0 && (!a || !b)) { j.bye = true; j.v = a || b; }
        else if (a && b) {
          const x = res[j.id];
          if (x && x.a === a && x.b === b && (x.v === a || x.v === b)) Object.assign(j, { va: x.va ?? null, vb: x.vb ?? null, v: x.v, wo: !!x.wo });
        }
        jogos.push(j);
      }
      rodadas.push(jogos);
      atuais = jogos.map((j) => j.v);
    }
    return rodadas;
  }
  function campeaoMata(t) { const rs = rodadasMata(t); return rs ? rs[rs.length - 1][0].v : null; }
  function nomeRodada(r, total) {
    const falta = total - r;
    return falta === 1 ? 'FINAL' : falta === 2 ? 'SEMIFINAL' : falta === 3 ? 'QUARTAS' : falta === 4 ? 'OITAVAS' : `${r + 1}ª RODADA`;
  }
  function naRodada(r, total) {
    const falta = total - r;
    return falta === 1 ? 'na final' : falta === 2 ? 'na semifinal' : falta === 3 ? 'nas quartas' : falta === 4 ? 'nas oitavas' : `na ${r + 1}ª rodada`;
  }
  // até onde cada um chegou: última rodada em que aparece e se perdeu nela
  function chegadaMata(rodadas) {
    const m = new Map();
    for (const jogos of rodadas) for (const j of jogos) for (const id of [j.a, j.b]) if (id) m.set(id, { r: j.r, fora: !!j.v && j.v !== id, jogo: j });
    return m;
  }
  // 1 = campeão, 2 = vice, 3 = semifinal, 0 = o resto
  function lugarMata(rodadas, id) {
    const c = chegadaMata(rodadas).get(id);
    if (!c) return null;
    const total = rodadas.length;
    if (rodadas[total - 1][0].v === id) return { pos: 1, txt: 'Campeão' };
    if (c.fora) return { pos: c.r === total - 1 ? 2 : c.r === total - 2 ? 3 : 0, txt: c.r === total - 1 ? 'Vice-campeão' : `Caiu ${naRodada(c.r, total)}` };
    return { pos: 0, txt: `Está ${naRodada(c.r, total)}` };
  }

  // regras próprias: campeão, vice e 3º escolhidos pelo dono (só quem ainda está no elenco)
  const podioLivre = (t) => (t.podio || []).map((id) => (id && jogPorId.has(id) ? id : null));
  // campeão, vice e 3º de um torneio encerrado: [{chave, nome, txt}] (posição vazia = null)
  function podioTn(t) {
    if (statusTn(t) !== 'fim') return [];
    const doId = (id, txt = '') => (id && jogPorId.has(id) ? { chave: chave(nickId(id)), nome: nickId(id), txt } : null);
    if (t.formato === 'livre') return podioLivre(t).map((id) => doId(id));
    if (t.formato === 'mata') {
      const rs = rodadasMata(t);
      const fin = rs && rs[rs.length - 1][0];
      if (!fin || !fin.v) return [];
      const vice = fin.v === fin.a ? fin.b : fin.a;
      const pl = (j, id) => (j.va != null && j.vb != null ? `${fmt(id === j.a ? j.va : j.vb)} × ${fmt(id === j.a ? j.vb : j.va)} na final` : '');
      return [doId(fin.v, pl(fin, fin.v)), doId(vice, pl(fin, vice))];
    }
    return classificarTn(t).filter((l) => l.qtd).slice(0, 3).map((l) => ({ chave: l.chave, nome: l.nome, txt: valorTn(t, l.total) }));
  }
  function vencedorTn(t) { return podioTn(t)[0] || null; }

  // troféus de torneio (campeão) e medalhas de prata (vice) de cada jogador, dos torneios publicados.
  // Calculado uma vez por desenho da página (render() limpa o cache).
  let cacheTrofeus = null;
  function trofeusDe(k) {
    if (!cacheTrofeus) {
      cacheTrofeus = new Map();
      for (const t of torneiosVisiveis()) {
        if (!t.publicado) continue;
        podioTn(t).slice(0, 2).forEach((p, i) => {
          if (!p) return;
          if (!cacheTrofeus.has(p.chave)) cacheTrofeus.set(p.chave, []);
          cacheTrofeus.get(p.chave).push({ t, pos: i + 1, txt: p.txt, quando: isFinite(fimTn(t)) ? Math.min(fimTn(t), Date.now()) : Date.parse((t.chave && t.chave.em) || t.inicio) });
        });
      }
      for (const l of cacheTrofeus.values()) l.sort((a, b) => a.pos - b.pos || b.quando - a.quando);
    }
    return (k && cacheTrofeus.get(k)) || [];
  }
  const vitoriasTorneio = (k) => trofeusDe(k).filter((x) => x.pos === 1).length;
  const vicesTorneio = (k) => trofeusDe(k).filter((x) => x.pos === 2).length;

  // ---------- textos ----------
  function tempoAte(alvo) {
    const min = Math.max(0, Math.round((alvo - Date.now()) / 60000));
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} h${min % 60 ? ` e ${min % 60} min` : ''}`;
    const d = Math.floor(h / 24);
    return `${d} ${d === 1 ? 'dia' : 'dias'}${h % 24 ? ` e ${h % 24} h` : ''}`;
  }
  const dataHora = (ms) => new Date(ms).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(/\./g, '');
  function periodoTn(t) {
    const ini = Date.parse(t.inicio);
    if (t.formato === 'hora' && t.fim) return `hora H: ${dataHora(Date.parse(t.fim))}`;
    return t.fim ? `${dataHora(ini)} até ${dataHora(Date.parse(t.fim))}` : `começa ${dataHora(ini)} · sem data pra acabar`;
  }
  function statusTxt(t, st) {
    if (st === 'breve') return `começa em ${tempoAte(Date.parse(t.inicio))}`;
    if (st === 'fim') return 'encerrado';
    if (t.formato === 'hora') return `hora H em ${tempoAte(fimTn(t))}`;
    return isFinite(fimTn(t)) ? `termina em ${tempoAte(fimTn(t))}` : 'rolando agora';
  }
  // as regras em frases curtas, montadas pela configuração do torneio
  function resumoTn(t) {
    const m = nomeMetrica(t);
    const itens = [];
    const quem = t.todos ? 'O clã inteiro joga.' : `${idsInscritos(t).length} ${idsInscritos(t).length === 1 ? 'jogador inscrito' : 'jogadores inscritos'}.`;
    if (t.formato === 'hora') {
      const h = t.fim ? `na hora H (${dataHora(Date.parse(t.fim))})` : 'na hora marcada';
      itens.push(`Quem estiver em 1º ${NA_BASE[baseDe(t)]} (${t.metrica === 'massa' ? 'por massa' : 'por pontos'}) ${h} é o campeão. O 2º leva a medalha de vice.`);
      itens.push(t.metrica === 'massa' ? 'Vale a maior partida de cada um, igualzinho ao ranking.' : 'Contam todas as partidas registradas no ranking, com os mesmos pontos.');
      itens.push('Partida registrada depois da hora H não conta. Até lá, a classificação mostra como está agora.');
      itens.push(quem);
      return itens;
    }
    if (t.formato === 'livre') {
      itens.push('Regras próprias: o dono do clã confere e escolhe o campeão e o vice no fim.');
      if (!t.regras) itens.push('As regras são combinadas no grupo.');
      itens.push(quem);
      return itens;
    }
    if (t.formato === 'soma') itens.push(`Vence quem somar mais ${m} durante o torneio.`);
    if (t.formato === 'melhor') itens.push(t.metrica === 'massa' ? 'Vale só a maior massa de cada um. Vence quem fizer a maior partida.' : `Vale só a melhor partida de cada um. Vence quem fizer mais ${m} numa partida.`);
    if (t.formato === 'melhores') itens.push(`Contam só as ${t.qtd || 3} melhores partidas de cada um, e vence quem somar mais ${m} nelas. Jogar mais não dá vantagem: jogar melhor sim.`);
    if (t.formato === 'meta') itens.push(`Corrida: o primeiro a juntar ${t.meta ? valorTn(t, t.meta) : 'a meta'} vence. Quem chegar depois fica em 2º, 3º…`);
    if (t.formato === 'mata') {
      itens.push('Mata-mata 1 contra 1: quem vence o duelo avança, quem perde tá fora. Até sobrar o campeão.');
      itens.push(`Cada duelo é decidido por ${m}. ${t.semente === 'sorteio' ? 'A chave é sorteada.' : 'A chave segue o ranking: os melhores só se cruzam no fim.'}`);
    } else {
      if (t.auto && t.metrica !== 'custom') itens.push(t.metrica === 'pontos' ? 'Toda partida registrada no ranking durante o torneio conta sozinha, com os mesmos pontos do ranking.' : 'Toda partida registrada no ranking durante o torneio conta sozinha.');
      else itens.push('Os resultados são conferidos e lançados pelo dono do clã.');
      itens.push(t.formato === 'meta' ? 'Se ninguém chegar na meta, ganha quem estiver mais perto no fim.' : 'Empate: ganha quem chegou naquele número primeiro.');
    }
    itens.push(t.todos ? 'O clã inteiro joga.' : `${idsInscritos(t).length} ${idsInscritos(t).length === 1 ? 'jogador inscrito' : 'jogadores inscritos'}.`);
    return itens;
  }
  const linkTorneio = (t) => `${location.origin}${location.pathname}?torneio=${encodeURIComponent(t.id)}`;
  // texto pronto pra colar no grupo do WhatsApp
  function textoGrupo(t) {
    const st = statusTn(t);
    const linhas = [`🏆 *${t.nome.toUpperCase()}*`, `${formatoDe(t).nome} · ${statusTxt(t, st)}`, ''];
    if (t.formato === 'mata') {
      const rs = rodadasMata(t);
      if (!rs) linhas.push('A chave ainda vai ser montada.');
      else {
        const camp = rs[rs.length - 1][0].v;
        if (camp) linhas.push(`🏆 Campeão: ${comTag(nickId(camp))}`);
        const vice = podioTn(t)[1];
        if (vice) linhas.push(`🥈 Vice: ${comTag(vice.nome)}`);
        const atual = rs.find((js) => js.some((j) => !j.v));
        if (atual) {
          linhas.push(`*${nomeRodada(atual[0].r, rs.length)}*`);
          for (const j of atual) if (!j.bye) linhas.push(`${j.a ? nickId(j.a) : '?'} x ${j.b ? nickId(j.b) : '?'}${j.v ? `  ✅ ${nickId(j.v)}` : ''}`);
        }
      }
    } else if (t.formato === 'livre') {
      const pod = podioTn(t);
      if (pod[0]) ['🏆 Campeão', '🥈 Vice', '🥉 3º'].forEach((r, i) => { if (pod[i]) linhas.push(`${r}: ${comTag(pod[i].nome)}`); });
      else linhas.push(t.regras ? t.regras.slice(0, 400) : 'Valendo! As regras estão no site.');
    } else {
      const cls = classificarTn(t).filter((l) => l.qtd);
      if (st === 'fim' && cls[0]) linhas.push(`🏆 Campeão: ${comTag(cls[0].nome)}${cls[1] ? ` · 🥈 Vice: ${comTag(cls[1].nome)}` : ''}`, '');
      if (!cls.length) linhas.push(st === 'breve' ? 'Prepara a cobra que já vai começar!' : 'Ninguém pontuou ainda. A liderança tá aberta!');
      const med = ['🥇', '🥈', '🥉'];
      cls.slice(0, 10).forEach((l, i) => linhas.push(`${med[i] || `${i + 1}º`} ${l.nome} — ${valorTn(t, l.total)}`));
    }
    if (t.premios && t.premios[0]) linhas.push('', `Prêmio: ${t.premios[0]}`);
    linhas.push('', `Acompanhe ao vivo: ${linkTorneio(t)}`);
    return linhas.join('\n');
  }
  const linkZap = (texto) => `https://wa.me/?text=${encodeURIComponent(texto)}`;

  // ---------- contagem regressiva (atualiza a cada segundo) ----------
  function contagem(alvo, rotulo) {
    if (!isFinite(alvo) || alvo <= Date.now()) return null;
    const un = [['d', 'DIAS'], ['h', 'HORAS'], ['m', 'MIN'], ['s', 'SEG']];
    return el('div', { class: 'tn-conta', 'data-conta': String(alvo) },
      el('span', { class: 'tn-conta-rot', text: rotulo }),
      el('div', { class: 'tn-conta-num', role: 'timer', 'aria-label': `${rotulo.toLowerCase()} ${tempoAte(alvo)}` },
        ...un.map(([u, r]) => el('span', { class: 'tn-cel' }, el('b', { 'data-u': u, text: '--' }), el('small', { text: r })))));
  }
  function contaCurta(alvo) {
    if (!isFinite(alvo) || alvo <= Date.now()) return null;
    return el('span', { class: 'tn-curta', 'data-conta': String(alvo) }, el('span', { 'data-curto': '' }));
  }
  function tickContagens() {
    const agora = Date.now();
    const dd = (x) => String(x).padStart(2, '0');
    let virou = false;
    for (const n of document.querySelectorAll('[data-conta]')) {
      const s = Math.floor((Number(n.dataset.conta) - agora) / 1000);
      if (s < 0) { virou = true; continue; }
      const v = { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
      for (const b of n.querySelectorAll('[data-u]')) b.textContent = dd(v[b.dataset.u]);
      const c = n.querySelector('[data-curto]');
      if (c) c.textContent = v.d ? `${v.d}d ${dd(v.h)}h ${dd(v.m)}m` : `${dd(v.h)}:${dd(v.m)}:${dd(v.s)}`;
    }
    // começou ou acabou agora: redesenha pra trocar o status
    if (virou) render();
  }

  // ---------- pedaços visuais ----------
  function pilulaStatus(t, st) {
    const txt = { vivo: 'AO VIVO', breve: 'EM BREVE', fim: 'ENCERRADO' }[st];
    return el('span', { class: `tn-pill ${st}` }, st === 'vivo' ? el('span', { class: 'ponto', 'aria-hidden': 'true' }) : null, txt);
  }
  const chipFormato = (t) => el('span', { class: 'tn-fmt' }, svg(formatoDe(t).icone, 14), formatoDe(t).curto);
  const chipRascunho = (t) => (t.publicado ? null : el('span', { class: 'tn-pill rascunho', text: 'RASCUNHO · SÓ ADMIN VÊ' }));
  function linkTn(t, classe, ...filhos) {
    return el('a', {
      href: `?torneio=${encodeURIComponent(t.id)}`, class: classe,
      onclick: (e) => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return; e.preventDefault(); abrirTorneio(t.id); },
    }, ...filhos);
  }

  // ---------- seção de torneios na página inicial ----------
  function renderTorneios() {
    const lista = torneiosVisiveis();
    const sec = $('torneios');
    const tem = lista.length > 0;
    sec.hidden = !tem && !admin;
    $('avisoTorneios').hidden = torneiosOk || !admin;
    $('btnNovoTorneio').hidden = !admin || !torneiosOk;
    $('menuTorneios').hidden = sec.hidden;
    // sem torneio, o lugar dele na barra de baixo fica com a sala de troféus
    $('bbTorneios').hidden = !tem;
    $('bbTrofeus').hidden = tem;
    $('faixaTnBox').hidden = true;
    if (sec.hidden) return;
    const box = $('listaTorneios');
    if (!torneiosOk) { trocar(box); return; }
    if (!tem) {
      trocar(box, el('p', { class: 'vazio', text: 'Nenhum torneio ainda. Toque em "Criar torneio": escolha o formato, as datas e os prêmios, e o clã acompanha o placar ao vivo aqui.' }));
      return;
    }
    const comSt = lista.map((t) => ({ t, st: statusTn(t) }));
    const ativos = comSt.filter((x) => x.st !== 'fim')
      .sort((a, b) => (a.st === b.st ? 0 : a.st === 'vivo' ? -1 : 1) || Date.parse(a.t.inicio) - Date.parse(b.t.inicio));
    renderFaixaTn(ativos);
    const quandoAcabou = (t) => (isFinite(fimTn(t)) ? fimTn(t) : Date.parse((t.chave && t.chave.em) || t.inicio));
    const fechados = comSt.filter((x) => x.st === 'fim').sort((a, b) => quandoAcabou(b.t) - quandoAcabou(a.t));
    trocar(box,
      ativos.length
        ? el('div', { class: 'tn-grade' }, ...ativos.map(({ t, st }) => cardTorneio(t, st)))
        : el('p', { class: 'vazio', text: 'Nenhum torneio rolando agora. O próximo aparece aqui.' }),
      fechados.length ? el('div', { class: 'tn-fechados' },
        el('h3', { class: 'perfil-h3', text: 'JÁ ACABARAM' }),
        el('div', { class: 'tn-grade-p' }, ...fechados.slice(0, 6).map(({ t }) => cardFechado(t)))) : null);
  }

  // aviso curto no ranking: tem torneio rolando? um toque leva pra página dos torneios
  function renderFaixaTn(ativos) {
    const vivos = ativos.filter((x) => x.st === 'vivo');
    const lista = vivos.length ? vivos : ativos;
    if (!lista.length) return;
    const { t, st } = lista[0];
    const conta = contaCurta(st === 'breve' ? Date.parse(t.inicio) : fimTn(t));
    const outros = lista.length - 1;
    trocar($('faixaTn'),
      pilulaStatus(t, st),
      el('span', { class: 'faixa-tn-txt' },
        el('b', { text: t.nome }),
        conta ? el('span', { class: 'faixa-tn-conta' }, st === 'breve' ? 'começa em ' : t.formato === 'hora' ? 'hora H em ' : 'termina em ', conta) : null),
      outros > 0 ? el('span', { class: 'faixa-tn-mais', text: `+${outros} ${st === 'vivo' ? 'rolando' : 'vindo aí'}` }) : null,
      el('span', { class: 'faixa-tn-ver', text: 'Ver torneios →' }));
    $('faixaTnBox').hidden = false;
  }

  function cardTorneio(t, st) {
    const alvo = st === 'breve' ? Date.parse(t.inicio) : fimTn(t);
    let corpo;
    if (t.formato === 'mata') {
      const rs = rodadasMata(t);
      const atual = rs && rs.find((js) => js.some((j) => !j.v));
      const nome = (id) => el('span', { class: 'tn-card-lado', text: id ? nickId(id) : 'a definir' });
      corpo = !rs || !atual
        ? el('p', { class: 'tn-card-info', text: `${idsInscritos(t).length} jogadores · ${rs ? 'chave pronta' : 'a chave sai antes de começar'}` })
        : el('div', { class: 'tn-card-mata' },
            el('span', { class: 'tn-card-rod', text: `${nomeRodada(atual[0].r, rs.length)} · ${atual.filter((j) => !j.v).length} ${atual.filter((j) => !j.v).length === 1 ? 'duelo' : 'duelos'} pra rolar` }),
            ...atual.filter((j) => !j.bye && !j.v).slice(0, 3).map((j) => el('div', { class: 'tn-card-duelo' }, nome(j.a), el('span', { class: 'vs-x', text: '×' }), nome(j.b))));
    } else if (t.formato === 'livre') {
      corpo = el('p', { class: 'tn-card-info tn-card-regras', text: t.regras || 'Regras próprias, combinadas no grupo. O dono escolhe o campeão no fim.' });
    } else {
      const cls = classificarTn(t).filter((l) => l.qtd);
      corpo = cls.length
        ? el('ol', { class: 'tn-mini' }, ...cls.slice(0, 3).map((l, i) => el('li', { class: `tt tt${i + 1}` },
            el('span', { class: 'tt-pos', text: `${i + 1}º` }),
            el('span', { class: 'tt-nome' }, el('span', { class: 'tn-mini-nome', text: l.nome })),
            el('span', { class: 'tt-pts', text: valorTn(t, l.total) }))))
        : el('p', { class: 'tn-card-info', text: st === 'breve' ? `${t.todos ? 'O clã inteiro' : `${idsInscritos(t).length} jogadores`} na disputa.` : 'Ninguém pontuou ainda. A liderança tá aberta!' });
    }
    const conta = contaCurta(alvo);
    return linkTn(t, `tn-card st-${st}`,
      el('div', { class: 'tn-card-topo' }, pilulaStatus(t, st), chipFormato(t), chipRascunho(t)),
      el('h3', { class: 'tn-card-nome', text: t.nome }),
      conta ? el('div', { class: 'tn-card-conta' }, el('span', { text: st === 'breve' ? 'começa em' : t.formato === 'hora' ? 'hora H em' : 'termina em' }), conta) : null,
      corpo,
      t.premios && t.premios[0] ? el('div', { class: 'tn-card-premio' }, svg(ICONE_TROFEU, 16), el('span', { text: t.premios[0] })) : null,
      el('span', { class: 'tn-card-ver', text: 'Ver torneio →' }));
  }

  function cardFechado(t) {
    const [v, vice] = podioTn(t);
    return linkTn(t, 'tn-fechado',
      el('span', { class: 'tn-fechado-ic', 'aria-hidden': 'true' }, svg(ICONE_TROFEU, 20)),
      el('span', { class: 'tn-fechado-info' },
        el('b', { text: t.nome }),
        el('span', { text: v ? `${comTag(v.nome)} campeão${v.txt ? ` · ${v.txt}` : ''}` : 'encerrado sem campeão' }),
        vice ? el('span', { class: 'tn-fechado-vice' }, svg(ICONE_MEDALHA, 13), `vice: ${vice.nome}`) : null),
      chipRascunho(t));
  }

  // ---------- página do torneio ----------
  function abrirTorneio(id) {
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    if (!perfilAtual && !torneioAtual) rolagemAntes = scrollY;
    history.pushState({ torneio: id, doSite: true }, '', `?torneio=${encodeURIComponent(id)}`);
    mostrarRota(true);
  }
  function fecharTorneio() {
    if (history.state && history.state.doSite) { history.back(); return; }
    irPara('#torneios');
  }
  function torneioDaUrl() { return new URLSearchParams(location.search).get('torneio'); }

  async function copiarTexto(texto, ok) {
    try {
      await navigator.clipboard.writeText(texto);
      toast(ok);
    } catch (e) {
      prompt('Copie:', texto);
    }
  }

  let formLanc = null;        // formulário de lançar resultado (fica no HTML; a página só muda ele de lugar)
  const fl = (id) => formLanc.querySelector('#' + id);

  function renderTorneioPagina() {
    const box = $('torneioCorpo');
    const t = torneios.find((x) => x.id === torneioAtual && (x.publicado || admin));
    const voltar = el('button', { type: 'button', class: 'btn btn-sec pp-voltar', onclick: fecharTorneio }, svg(ICONE_VOLTAR, 18), 'Torneios');
    if (!t) {
      document.title = `Torneio não encontrado · Ranking Clã ${TAG}`;
      formLanc.hidden = true;
      trocar(box, el('div', { class: 'pp-barra' }, voltar), el('p', { class: 'vazio', text: 'Não achei esse torneio. Pode ter sido apagado ou ainda não foi publicado.' }));
      return;
    }
    document.title = `${t.nome} · Torneio Clã ${TAG}`;
    const st = statusTn(t);
    const mata = t.formato === 'mata';
    const livre = t.formato === 'livre';
    const rodadas = mata ? rodadasMata(t) : null;
    const ents = mata || livre ? [] : entradasTn(t);
    const cls = mata || livre ? null : classificarTn(t, ents);
    const eu = lerEu();

    const barra = el('div', { class: 'pp-barra' }, voltar,
      el('div', { class: 'pp-acoes' },
        el('a', { class: 'btn btn-sec', href: linkZap(textoGrupo(t)), target: '_blank', rel: 'noopener' }, svg(ICONE_CONVERSA, 18), el('span', { class: 'btn-txt', text: 'Mandar no grupo' })),
        el('button', { type: 'button', class: 'btn btn-sec', 'aria-label': 'Copiar link do torneio', onclick: () => copiarTexto(linkTorneio(t), 'Link do torneio copiado.') }, svg(ICONE_LINK, 18), el('span', { class: 'btn-txt', text: 'Link' })),
        admin ? el('button', { type: 'button', class: 'btn btn-pri', onclick: () => abrirBuilder(t) }, svg(ICONE_LAPIS, 18), el('span', { class: 'btn-txt', text: 'Editar' })) : null));

    // topo: nome, status e contagem regressiva (ou o campeão)
    const [camp, vice] = podioTn(t);
    let lado;
    if (st === 'breve') lado = contagem(Date.parse(t.inicio), 'COMEÇA EM');
    else if (st === 'vivo') {
      lado = contagem(fimTn(t), t.formato === 'hora' ? 'HORA H EM' : 'TERMINA EM');
      const atual = rodadas && rodadas.find((js) => js.some((j) => !j.v));
      if (!lado && atual) lado = el('div', { class: 'tn-conta' }, el('span', { class: 'tn-conta-rot', text: 'RODADA ATUAL' }), el('b', { class: 'tn-rodada', text: nomeRodada(atual[0].r, rodadas.length) }));
      if (!lado && livre) lado = el('div', { class: 'tn-conta' }, el('span', { class: 'tn-conta-rot', text: 'VALENDO' }), el('b', { class: 'tn-rodada', text: 'O DONO DÁ O RESULTADO' }));
    } else {
      lado = camp
        ? el('div', { class: 'tn-campeao' },
            el('span', { class: 'tn-taca', 'aria-hidden': 'true' }, svg(ICONE_TROFEU, 40)),
            avatarDe(camp.nome, ptsGeralDe(camp.chave), 'av-g'),
            el('span', { class: 'tn-campeao-rot', text: 'CAMPEÃO' }),
            el('button', { type: 'button', class: 'tn-campeao-nome', onclick: () => abrirPerfil(camp.chave), text: camp.nome }),
            camp.txt ? el('span', { class: 'tn-campeao-val', text: camp.txt }) : null,
            vice ? el('button', { type: 'button', class: 'tn-vice', onclick: () => abrirPerfil(vice.chave) },
              el('span', { class: 'tn-vice-ic', 'aria-hidden': 'true' }, svg(ICONE_MEDALHA, 18)),
              el('span', { class: 'tn-vice-txt' }, el('small', { text: 'VICE' }), el('b', { text: vice.nome }))) : null)
        : el('div', { class: 'tn-campeao' }, el('span', { class: 'tn-campeao-rot', text: 'ENCERRADO SEM CAMPEÃO' }),
            admin && livre ? el('span', { class: 'tn-campeao-val', text: 'Escolha o campeão logo abaixo.' }) : null);
    }
    const hero = el('header', { class: `tn-hero st-${st}` },
      el('div', { class: 'tn-hero-txt' },
        el('div', { class: 'tn-chips' }, pilulaStatus(t, st), chipFormato(t), chipRascunho(t)),
        el('h1', { class: 'tn-nome', text: t.nome }),
        el('p', { class: 'tn-periodo' }, svg(ICONE_RELOGIO, 16), periodoTn(t))),
      lado);

    const conteudo = [barra, hero, cartaoEu(t, st, cls, rodadas, eu), admin ? barraAdminTn(t, st, rodadas) : null];

    const regras = el('section', { class: 'pp-sec', 'aria-label': 'Regras' },
      el('h2', { class: 'perfil-h3', text: 'REGRAS' }),
      el('div', { class: 'tn-regras' },
        el('ul', null, ...resumoTn(t).map((x) => el('li', { text: x }))),
        t.regras ? el('p', { class: 'tn-regras-txt', text: t.regras }) : null));
    const lateral = [regras, blocoPremios(t, st, cls, rodadas), blocoInscritos(t)];

    if (mata) {
      formLanc.hidden = true;
      conteudo.push(blocoChave(t, st, rodadas, eu), el('div', { class: 'tn-info-grade' }, ...lateral));
      trocar(box, conteudo);
      return;
    }
    if (livre) {
      formLanc.hidden = true;
      conteudo.push(el('div', { class: 'pp-grade' },
        el('div', { class: 'pp-col' }, blocoResultadoLivre(t, st), admin ? blocoEscolherPodio(t) : null),
        el('div', { class: 'pp-col' }, ...lateral.filter(Boolean))));
      trocar(box, conteudo);
      return;
    }
    const esq = el('div', { class: 'pp-col' }, blocoClassificacao(t, st, cls, eu));
    if (admin) { esq.append(formLanc); formLanc.hidden = false; prepararLanc(t); } else formLanc.hidden = true;
    const res = blocoResultados(t, ents, cls);
    if (res) esq.append(res);
    conteudo.push(el('div', { class: 'pp-grade' }, esq, el('div', { class: 'pp-col' }, ...lateral.filter(Boolean))));
    trocar(box, conteudo);
  }

  // "você": a posição de quem marcou "Sou eu" no perfil
  function cartaoEu(t, st, cls, rodadas, eu) {
    const r = eu ? elenco.get(eu) : null;
    const inscrito = r && (t.todos ? r.ativo : (t.participantes || []).includes(r.id));
    const card = (rot, forte, fraco, extra) => el('div', { class: 'tn-eu' },
      r ? avatarDe(r.nick, ptsGeralDe(eu), 'av-m') : null,
      el('div', { class: 'tn-eu-txt' }, el('span', { class: 'tn-eu-rot', text: rot }), el('b', { text: forte }), fraco ? el('span', { text: fraco }) : null),
      extra || null);
    const convite = () => {
      if (st === 'fim' || t.todos || admin) return null;
      const msg = `Quero entrar no torneio "${t.nome}"! Meu nick: ${r ? comTag(r.nick) : comTag('')}`;
      return el('div', { class: 'tn-eu convite' },
        el('div', { class: 'tn-eu-txt' }, el('span', { class: 'tn-eu-rot', text: 'QUER JOGAR?' }), el('b', { text: 'Pede pro dono do clã te colocar.' }), el('span', { text: 'A mensagem já vai pronta com o seu nick.' })),
        el('a', { class: 'btn btn-pri', href: linkZap(msg), target: '_blank', rel: 'noopener' }, svg(ICONE_CONVERSA, 18), 'Pedir pra entrar'));
    };
    if (t.formato === 'mata') {
      if (!r) return convite();
      if (!rodadas) return inscrito ? card('VOCÊ', 'Você está inscrito.', 'A chave sai antes de começar. Fica de olho!') : convite();
      const c = chegadaMata(rodadas).get(r.id);
      if (!c) return inscrito ? card('VOCÊ', 'Você está inscrito, mas ficou fora da chave.', 'Fala com o dono do clã.') : convite();
      const total = rodadas.length;
      const outro = c.jogo.a === r.id ? c.jogo.b : c.jogo.a;
      if (rodadas[total - 1][0].v === r.id) return card('VOCÊ', 'Você é o CAMPEÃO! 👑', 'Ninguém te parou.');
      if (c.fora) return card('VOCÊ', c.r === total - 1 ? 'Vice-campeão. Bateu na trave!' : `Você caiu ${naRodada(c.r, total)}.`, outro ? `Quem te tirou: ${nickId(outro)}.` : null);
      return card('VOCÊ', c.jogo.bye ? 'Você passou direto pra próxima rodada.' : outro ? `Seu duelo ${naRodada(c.r, total)}: contra ${nickId(outro)}.` : `Você está ${naRodada(c.r, total)}.`, outro ? 'Vence e avança. Perde e tá fora.' : 'Esperando o adversário.');
    }
    if (t.formato === 'livre') {
      if (!r) return convite();
      const i = podioLivre(t).indexOf(r.id);
      if (i === 0) return card('VOCÊ', 'Você é o CAMPEÃO! 🏆', 'O troféu já está no seu perfil.');
      if (i === 1) return card('VOCÊ', 'Vice-campeão! 🥈', 'A medalha de prata já está no seu perfil.');
      if (i === 2) return card('VOCÊ', '3º lugar! 🥉', 'Pódio garantido.');
      return inscrito ? (st === 'fim' ? null : card('VOCÊ', 'Você está no torneio.', 'Lê as regras e manda ver!')) : convite();
    }
    if (!r) return convite();
    const i = cls.findIndex((l) => l.chave === eu);
    if (i < 0) return inscrito ? null : convite();
    const l = cls[i];
    if (!l.qtd) return card('VOCÊ', st === 'breve' ? 'Você está no torneio.' : 'Você ainda não pontuou.', st === 'breve' ? 'Quando começar, cada partida conta. Prepara a cobra!' : 'Joga com a tag no nick: o dono puxa as massas do servidor.');
    const n = cls.filter((x) => x.qtd).length;
    const acima = cls[i - 1];
    let fraco;
    if (i === 0) fraco = st === 'fim' ? 'Você ganhou o torneio! 🏆 O troféu já está no seu perfil.' : t.formato === 'hora' ? 'Você está em 1º. Segura até a hora H!' : 'Você lidera. Segura o trono!';
    else if (i === 1 && st === 'fim') fraco = 'Vice-campeão! 🥈 A medalha de prata já está no seu perfil.';
    else if (t.formato === 'meta' && t.meta && !l.chegou) fraco = `Faltam ${valorTn(t, t.meta - l.total)} pra meta.`;
    else if (acima.total > l.total) fraco = `Faltam ${valorTn(t, acima.total - l.total)} pra alcançar ${acima.nome} (${i}º).`;
    else fraco = `Empatado com ${acima.nome}, que chegou primeiro.`;
    return card('SUA POSIÇÃO', `#${i + 1} de ${n} · ${valorTn(t, l.total)}`, fraco);
  }

  function barraAdminTn(t, st, rodadas) {
    const salvar = (mud, msg) => salvarTn(t, mud).then(() => toast(msg)).catch((e) => { if (!erroSessao(e)) toast('Não deu pra salvar agora. (' + (e.message || 'erro') + ')', true); });
    const itens = [el('span', { class: 'admin-tag', text: 'ADMIN' })];
    if (!t.publicado) itens.push(el('button', { type: 'button', class: 'btn btn-pri', onclick: () => salvar({ publicado: true }, 'Publicado! Agora o clã inteiro vê.') }, 'Publicar pro clã'));
    if (st !== 'fim') itens.push(el('button', { type: 'button', class: 'btn btn-sec', onclick: () => confirmar('ENCERRAR AGORA?', `"${t.nome}" acaba agora e o placar congela. Dá pra reabrir depois.`, 'Encerrar', () => salvar({ encerrado_em: new Date().toISOString() }, 'Torneio encerrado.')) }, 'Encerrar agora'));
    else if (t.encerrado_em && !(t.fim && Date.parse(t.fim) <= Date.now()) && !(t.formato === 'mata' && campeaoMata(t))) {
      itens.push(el('button', { type: 'button', class: 'btn btn-sec', onclick: () => salvar({ encerrado_em: null }, 'Torneio reaberto.') }, 'Reabrir'));
    }
    if (t.formato === 'mata' && rodadas) {
      itens.push(el('button', { type: 'button', class: 'btn btn-sec', onclick: () => confirmar('REFAZER A CHAVE?', `A chave de "${t.nome}" é montada de novo com os inscritos de agora (${t.semente === 'sorteio' ? 'novo sorteio' : 'pelo ranking'}). Os resultados já lançados somem.`, 'Refazer', () => montarChaveTn(t)) }, 'Refazer a chave'));
    }
    const fora = t.formato === 'mata' && rodadas ? idsInscritos(t).filter((id) => !t.chave.slots.includes(id)) : [];
    return el('div', { class: 'tn-admin' }, ...itens,
      fora.length ? el('p', { class: 'tn-admin-aviso', text: `${fora.map(nickId).join(', ')} ${fora.length === 1 ? 'está inscrito mas ficou' : 'estão inscritos mas ficaram'} fora da chave. Pra incluir, refaça a chave.` }) : null);
  }

  function blocoClassificacao(t, st, cls, eu) {
    const com = cls.filter((l) => l.qtd);
    const sem = cls.filter((l) => !l.qtd);
    const meta = t.formato === 'meta' && t.meta;
    const pctMeta = (l) => Math.min(100, Math.round((l.total / t.meta) * 100));
    const podio = com.length
      ? el('div', { class: 'podio tn-podio' }, ...[1, 0, 2].filter((i) => com[i]).map((i) => {
          const l = com[i];
          return el('article', { class: `lugar l${i + 1}` },
            i === 0 ? svg(st === 'fim' ? ICONE_TROFEU : ICONE_COROA, 34, 'class="coroa"') : i === 1 && st === 'fim' ? svg(ICONE_MEDALHA, 26, 'class="tn-med-ic"') : null,
            el('div', { class: 'avatar', 'aria-hidden': 'true', text: l.nome.charAt(0).toUpperCase() }),
            el('div', null,
              el('div', { class: 'lugar-pos', text: i === 0 ? (st === 'fim' ? '1º · CAMPEÃO' : '1º · LIDERANDO') : i === 1 && st === 'fim' ? '2º · VICE' : `${i + 1}º LUGAR` }),
              btnPerfil(l, 'lugar-nome', l.nome)),
            el('div', { class: 'lugar-massa', text: fmt(l.total) }),
            el('div', { class: 'lugar-data', text: `${unidadeTn(t, l.total)} · ${l.qtd} ${l.qtd === 1 ? 'partida' : 'partidas'}` }),
            meta ? el('div', { class: 'barra', 'aria-hidden': 'true' }, el('span', { style: `width:${Math.max(4, pctMeta(l))}%` })) : null,
            t.premios && t.premios[i] ? el('div', { class: 'cem-selo', text: t.premios[i] }) : null);
        }))
      : el('p', { class: 'vazio', text: st === 'breve' ? 'O placar abre quando o torneio começar.' : 'Ninguém pontuou ainda. O primeiro resultado já assume a liderança!' });

    const lider = com[0];
    const linhas = com.map((l, i) => {
      let sub = null;
      if (meta) sub = l.chegou ? `chegou na meta ${dataHora(l.chegou)}` : `faltam ${valorTn(t, t.meta - l.total)} · ${pctMeta(l)}%`;
      else if (i > 0) sub = lider.total > l.total ? `a ${valorTn(t, lider.total - l.total)} do 1º` : 'empatado com o 1º (vale quem chegou antes)';
      return el('tr', { class: `${i === 0 ? 'topo1' : ''} ${l.chave === eu ? 'tn-eu-linha' : ''}` },
        el('td', { class: `pos p${i + 1}`, text: `#${i + 1}` }),
        el('td', { class: 'nome-cel' },
          el('div', { class: 'nome-linha' },
            avatarDe(l.nome, ptsGeralDe(l.chave), 'av-p'),
            btnPerfil(l, 'link-nome forte', l.nome),
            l.chave === eu ? el('span', { class: 'chip', text: 'VOCÊ' }) : null,
            meta && l.chegou ? el('span', { class: 'cem-chip', text: '✓ META' }) : null),
          meta ? el('div', { class: 'tn-prog', 'aria-hidden': 'true' }, el('span', { style: `width:${pctMeta(l)}%` })) : null,
          sub ? el('div', { class: 'nome-melhor', text: sub }) : null),
        el('td', { class: 'dir num', text: fmt(l.total) }),
        el('td', { class: 'dir sec', text: t.formato === 'melhores' ? `${Math.min(l.qtd, t.qtd || 3)} de ${l.qtd}` : fmt(l.qtd) }));
    });
    const semTxt = sem.length ? el('p', { class: 'tn-sem', text: `${sem.length} ${sem.length === 1 ? 'ainda sem resultado' : 'ainda sem resultado'}: ${sem.slice(0, 15).map((l) => l.nome).join(', ')}${sem.length > 15 ? '…' : ''}` }) : null;
    return el('section', { class: 'pp-sec', 'aria-label': 'Classificação' },
      el('h2', { class: 'perfil-h3' }, 'CLASSIFICAÇÃO ', el('span', { class: 'sec', text: st !== 'vivo' ? '' : t.formato === 'hora' ? `· ${BASES[baseDe(t)]} agora` : '· ao vivo' })),
      podio,
      com.length || sem.length ? el('div', { class: 'painel tn-tabela' },
        com.length ? el('div', { class: 'tabela-box' }, el('table', null,
          el('thead', null, el('tr', null,
            el('th', { text: 'POS' }), el('th', { text: 'JOGADOR' }),
            el('th', { class: 'dir', text: rotMetrica(t) }),
            el('th', { class: 'dir', text: t.formato === 'melhores' ? 'CONTAM' : 'PARTIDAS' }))),
          el('tbody', null, ...linhas))) : null,
        semTxt) : null);
  }

  let tnMaisRes = null;       // torneio com a lista completa de resultados aberta
  function blocoResultados(t, ents, cls) {
    if (!ents.length) return null;
    const porJog = new Map(cls.map((l) => [l.chave, l]));
    const soma = t.formato !== 'melhor' && t.metrica !== 'massa';
    return el('section', { class: 'pp-sec', 'aria-label': 'Últimos resultados' },
      el('h2', { class: 'perfil-h3' }, 'ÚLTIMOS RESULTADOS ', el('span', { class: 'sec', text: fmt(ents.length) })),
      el('ul', { class: 'pp-hist' }, ...ents.slice(0, tnMaisRes === t.id ? 300 : 8).map((e) => {
        const conta = (porJog.get(e.k) || { contadas: new Set() }).contadas.has(e.id);
        const fonte = e.partida || e.lanc;
        const url = urlPrint(fonte);
        const detalhe = [haQuanto(e.quando), e.partida ? 'do ranking' : e.lanc.nota, t.metrica === 'pontos' ? `${fmt(e.bruto)} de massa` : null].filter(Boolean).join(' · ');
        return el('li', { class: `pp-hist-item ${conta ? '' : 'nao-conta'}` },
          url
            ? el('button', { type: 'button', class: 'mini', 'aria-label': `Ver print de ${e.nome}`, onclick: () => abrirPrintLivre(url, `${comTag(e.nome)} · ${valorTn(t, e.valor)} · ${t.nome}`) }, el('img', { src: url, alt: '', loading: 'lazy' }))
            : el('span', { class: 'mini' }, avatarDe(e.nome, ptsGeralDe(e.k), 'av-p')),
          el('div', { class: 'pp-hist-info' },
            el('span', { class: 'tn-res-nome' }, btnPerfil({ chave: e.k, nome: e.nome }, 'link-nome forte', e.nome), !conta ? el('span', { class: 'ex-chip', text: 'NÃO CONTA' }) : null),
            el('span', { class: 'partida-data', text: detalhe })),
          el('span', { class: 'pp-hist-pts', text: `${soma ? '+' : ''}${valorTn(t, e.valor)}` }),
          admin && e.lanc ? el('button', { type: 'button', class: 'apagar', 'aria-label': `Apagar resultado de ${e.nome}`, onclick: () => pedirApagarLanc(t, e) }, svg(ICONE_LIXO)) : null);
      })),
      ents.length > 8 && tnMaisRes !== t.id ? el('button', { type: 'button', class: 'btn btn-sec pp-mais', onclick: () => { tnMaisRes = t.id; renderTorneioPagina(); } }, `Ver todos os ${fmt(ents.length)} resultados`) : null,
      regraTn(t) === 'melhor' || t.formato === 'melhores' ? el('p', { class: 'form-nota tn-nota', text: '"Não conta" = partida que ficou fora das que valem pro torneio.' }) : null);
  }

  function blocoPremios(t, st, cls, rodadas) {
    if (!t.premios || !t.premios.some(Boolean)) return null;
    let ganhou = [];
    if (st === 'fim') {
      if (rodadas) {
        const fin = rodadas[rodadas.length - 1][0];
        const semi = rodadas.length > 1 ? rodadas[rodadas.length - 2].map((j) => (j.v && j.v === j.a ? j.b : j.a)).filter(Boolean) : [];
        ganhou = [fin.v ? nickId(fin.v) : null, fin.v ? nickId(fin.v === fin.a ? fin.b : fin.a) : null, semi.length ? semi.map(nickId).join(' e ') : null];
      } else ganhou = podioTn(t).map((p) => (p ? p.nome : null));
    }
    return el('section', { class: 'pp-sec', 'aria-label': 'Prêmios' },
      el('h2', { class: 'perfil-h3', text: 'PRÊMIOS' }),
      el('ol', { class: 'tn-premios-lista' }, ...t.premios.map((p, i) => (p ? el('li', { class: `tn-pr p${i + 1}` },
        el('span', { class: 'tn-pr-pos', text: `${i + 1}º` }),
        el('span', { class: 'tn-pr-txt' }, el('b', { text: p }), ganhou[i] ? el('span', { text: `ficou com ${ganhou[i]}` }) : null)) : null))));
  }

  // ---------- regras próprias: resultado escolhido pelo dono ----------
  const ROT_PODIO = ['CAMPEÃO', 'VICE', '3º LUGAR'];
  function blocoResultadoLivre(t, st) {
    const pod = podioTn(t);
    const eu = lerEu();
    return el('section', { class: 'pp-sec', 'aria-label': 'Resultado' },
      el('h2', { class: 'perfil-h3', text: 'RESULTADO' }),
      pod[0]
        ? el('div', { class: 'podio tn-podio' }, ...[1, 0, 2].filter((i) => pod[i]).map((i) => {
            const p = pod[i];
            return el('article', { class: `lugar l${i + 1}` },
              i === 0 ? svg(ICONE_TROFEU, 34, 'class="coroa"') : svg(ICONE_MEDALHA, 26, 'class="tn-med-ic"'),
              el('div', { class: 'avatar', 'aria-hidden': 'true', text: p.nome.charAt(0).toUpperCase() }),
              el('div', null,
                el('div', { class: 'lugar-pos', text: `${i + 1}º · ${ROT_PODIO[i]}` }),
                btnPerfil(p, 'lugar-nome', p.nome),
                p.chave === eu ? el('span', { class: 'chip', text: 'VOCÊ' }) : null),
              t.premios && t.premios[i] ? el('div', { class: 'cem-selo', text: t.premios[i] }) : null);
          }))
        : el('p', { class: 'vazio', text: st === 'breve' ? 'O torneio ainda não começou. Lê as regras e se prepara!' : 'Valendo! Quando acabar, o dono do clã confere e o campeão e o vice aparecem aqui com troféu e medalha.' }));
  }
  // admin escolhe campeão, vice e 3º (pode ser depois do evento: já entrega o troféu e a medalha)
  function blocoEscolherPodio(t) {
    const atual = podioLivre(t);
    const ids = new Set([...idsInscritos(t), ...atual.filter(Boolean)]);
    const lista = [...ids].map((id) => jogPorId.get(id)).filter(Boolean).sort((a, b) => a.nick.localeCompare(b.nick, 'pt-BR'));
    const sels = [0, 1, 2].map((i) => el('select', { id: `tnPodio${i}`, 'aria-label': ROT_PODIO[i] },
      el('option', { value: '', text: i === 0 ? '— escolha —' : '— ninguém —' }),
      ...lista.map((r) => el('option', { value: r.id, text: r.nick, selected: atual[i] === r.id }))));
    const erro = el('p', { class: 'erro', role: 'alert', hidden: true });
    const salvar = async (podio) => {
      erro.hidden = true;
      try {
        await salvarTn(t, { podio });
        toast(podio.length ? `Pronto! ${nickId(podio[0])} levou o troféu${podio[1] ? ` e ${nickId(podio[1])} a medalha de vice` : ''}.` : 'Resultado apagado. O torneio voltou a valer.');
      } catch (e) {
        if (!erroSessao(e)) { erro.textContent = 'Não deu pra salvar agora. (' + (e.message || 'erro') + ')'; erro.hidden = false; }
      }
    };
    return el('section', { class: 'pp-sec tn-escolhe-podio', 'aria-label': 'Definir resultado' },
      el('h2', { class: 'perfil-h3' }, el('span', { class: 'admin-tag', text: 'ADMIN' }), ' DEFINIR RESULTADO'),
      el('form', { class: 'painel tn-podio-form', onsubmit: (ev) => {
        ev.preventDefault();
        const v = sels.map((s) => s.value);
        if (!v[0]) { erro.textContent = 'Escolhe pelo menos o campeão.'; erro.hidden = false; return; }
        if (!v[1] && v[2]) { erro.textContent = 'Escolhe o vice antes do 3º.'; erro.hidden = false; return; }
        const podio = v.filter(Boolean);
        if (new Set(podio).size !== podio.length) { erro.textContent = 'O mesmo jogador não pode ficar em dois lugares.'; erro.hidden = false; return; }
        salvar(podio);
      } },
        ...sels.map((s, i) => el('label', { class: `tn-premio p${i + 1}` }, el('span', { text: `${i + 1}º` }), s)),
        el('p', { class: 'form-nota', text: lista.length ? 'Salvou o campeão, o torneio encerra e o troféu (e a medalha do vice) aparece no perfil deles.' : 'Ninguém inscrito. Edite o torneio e escolha quem joga.' }),
        erro,
        el('div', { class: 'tn-podio-acoes' },
          atual[0] ? el('button', { type: 'button', class: 'btn btn-sec', onclick: () => confirmar('APAGAR RESULTADO?', `O pódio de "${t.nome}" some e os troféus saem dos perfis.`, 'Apagar', () => salvar([])) }, 'Apagar resultado') : null,
          el('button', { type: 'submit', class: 'btn btn-pri' }, svg(ICONE_TROFEU, 18), atual[0] ? 'Salvar resultado' : 'Entregar troféus'))));
  }

  function blocoInscritos(t) {
    const ids = idsInscritos(t);
    return el('section', { class: 'pp-sec', 'aria-label': 'Quem joga' },
      el('h2', { class: 'perfil-h3' }, 'QUEM JOGA ', el('span', { class: 'sec', text: t.todos ? `o clã inteiro · ${ids.length}` : fmt(ids.length) })),
      ids.length
        ? el('div', { class: 'tn-inscritos' }, ...ids.slice(0, 64).map((id) => {
            const r = jogPorId.get(id);
            const k = chave(r.nick);
            return btnPerfil({ chave: k, nome: r.nick }, 'tn-insc', [avatarDe(r.nick, ptsGeralDe(k), 'av-p'), el('span', { text: r.nick })]);
          }), ids.length > 64 ? el('span', { class: 'mais', text: `+${ids.length - 64}` }) : null)
        : el('p', { class: 'sec', text: 'Ninguém inscrito ainda.' }));
  }

  // ---------- chave do mata-mata ----------
  function blocoChave(t, st, rodadas, eu) {
    if (!rodadas) {
      const n = idsInscritos(t).length;
      return el('section', { class: 'pp-sec', 'aria-label': 'Chave' },
        el('h2', { class: 'perfil-h3', text: 'CHAVE' }),
        el('div', { class: 'painel tn-chave-vazia' },
          el('p', { class: 'vazio', text: n < 2 ? 'O mata-mata precisa de pelo menos 2 jogadores inscritos.' : `${n} jogadores inscritos. A chave aparece aqui quando o dono montar.` }),
          admin && n >= 2 ? el('button', { type: 'button', class: 'btn btn-pri btn-grande', onclick: () => montarChaveTn(t) }, svg(ICONE_ESPADAS, 20), t.semente === 'sorteio' ? 'SORTEAR A CHAVE' : 'MONTAR A CHAVE PELO RANKING') : null));
    }
    const total = rodadas.length;
    const euR = eu ? elenco.get(eu) : null;
    const euId = euR ? euR.id : null;
    const cols = rodadas.map((jogos, r) => {
      const ultima = r === total - 1;
      const pares = [];
      for (let i = 0; i < jogos.length; i += 2) pares.push(jogos.slice(i, i + 2));
      return el('div', { class: `mm-rod ${ultima ? 'mm-final' : ''}` },
        el('div', { class: 'mm-rod-tit', text: nomeRodada(r, total) }),
        el('div', { class: 'mm-jogos' }, ...(ultima
          ? [el('div', { class: 'mm-dupla mm-unica' }, cartaoJogo(t, jogos[0], euId, total))]
          : pares.map((p) => el('div', { class: 'mm-dupla' }, ...p.map((j) => cartaoJogo(t, j, euId, total)))))));
    });
    const camp = rodadas[total - 1][0].v;
    cols.push(el('div', { class: 'mm-rod mm-camp-col' },
      el('div', { class: 'mm-rod-tit', text: 'CAMPEÃO' }),
      el('div', { class: 'mm-jogos' }, el('div', { class: `mm-campeao ${camp ? 'ok' : ''}` },
        svg(ICONE_COROA, 30),
        camp ? el('b', { text: nickId(camp) }) : el('span', { text: 'quem vai ser?' })))));
    const abertos = rodadas.flat().filter((j) => j.a && j.b && !j.v).length;
    return el('section', { class: 'pp-sec', 'aria-label': 'Chave' },
      el('h2', { class: 'perfil-h3' }, 'CHAVE ', el('span', { class: 'sec', text: camp ? '· encerrada' : `· ${abertos} ${abertos === 1 ? 'duelo' : 'duelos'} pra rolar` })),
      el('div', { class: 'painel tn-chave' },
        el('p', { class: 'dica-arrastar tn-dica', 'aria-hidden': 'true', text: 'Arraste pro lado pra ver a chave toda →' }),
        el('div', { class: 'mm' }, ...cols),
        el('p', { class: 'jog-nota', text: admin ? 'Toque num duelo pra lançar o resultado. Quem vence avança sozinho pra próxima rodada.' : 'Folga = passou direto pra próxima rodada.' })));
  }

  function cartaoJogo(t, j, euId, total) {
    const lado = (id, v) => {
      const ganhou = !!j.v && j.v === id;
      return el('div', { class: `mm-lado ${ganhou ? 'ganhou' : j.v && id ? 'perdeu' : ''} ${id && id === euId ? 'eu' : ''}` },
        id ? avatarDe(nickId(id), ptsGeralDe(chave(nickId(id))), 'av-p') : el('span', { class: 'av av-p mm-vazio', 'aria-hidden': 'true', text: '?' }),
        el('span', { class: 'mm-nome', text: id ? nickId(id) : j.bye ? 'folga' : 'a definir' }),
        el('span', { class: 'mm-val', text: v != null ? fmt(v) : ganhou && j.wo ? 'W.O.' : '' }));
    };
    const filhos = [lado(j.a, j.va), lado(j.b, j.vb)];
    const cls = `mm-jogo ${j.bye ? 'bye' : ''} ${j.v ? 'feito' : j.a && j.b ? 'aberto' : ''}`;
    if (admin && j.a && j.b && !j.bye) {
      return el('button', { type: 'button', class: cls, onclick: () => abrirDuelo(t, j, total), 'aria-label': `${nomeRodada(j.r, total)}: ${nickId(j.a)} contra ${nickId(j.b)}. Lançar resultado` }, ...filhos);
    }
    return el('div', { class: cls }, ...filhos);
  }

  function embaralhar(lista) {
    const a = [...lista];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  async function gravarChave(t, c) {
    if (DEMO) { const alvo = torneios.find((x) => x.id === t.id); if (alvo) alvo.chave = c; }
    else { await rpcAdmin('admin_salvar_chave', { p_id: t.id, p_chave: c }); await carregar(); }
    render();
  }
  async function montarChaveTn(t) {
    let ids = idsInscritos(t);
    if (ids.length < 2) { toast('Precisa de pelo menos 2 jogadores inscritos.', true); return; }
    if (ids.length > 64) { toast('O mata-mata aceita até 64 jogadores. Tira alguns da lista.', true); return; }
    if (t.semente === 'sorteio') ids = embaralhar(ids);
    else ids.sort((a, b) => ptsRankingDe(chave(nickId(b))) - ptsRankingDe(chave(nickId(a))) || nickId(a).localeCompare(nickId(b), 'pt-BR'));
    try {
      await gravarChave(t, { slots: montarSlots(ids), res: {}, em: new Date().toISOString() });
      toast(t.semente === 'sorteio' ? 'Chave sorteada! Boa sorte pra todos.' : 'Chave montada pelo ranking. Que vença o melhor!');
    } catch (e) {
      console.error(e);
      if (!erroSessao(e)) toast('Não deu pra salvar a chave. (' + (e.message || 'erro') + ')', true);
    }
  }

  // ---------- resultado de duelo (só admin) ----------
  let duelo = null;           // { t, j, total, v }
  function lerInteiro(txt) {
    const s = String(txt || '').replace(/[\s.]/g, '');
    if (!s) return { vazio: true };
    return /^\d{1,9}$/.test(s) ? { valor: parseInt(s, 10) } : { erro: true };
  }
  // massa aceita "52 mil"; o resto é número inteiro
  function lerValorTn(t, txt) {
    if (t.metrica !== 'massa') return lerInteiro(txt);
    const r = lerMassa(txt);
    if (r.vazio || r.erro) return r;
    if (r.decimal) return { erro: true };
    return { valor: r.valor };
  }
  function abrirDuelo(t, j, total) {
    duelo = { t, j, total, v: j.v };
    $('dueloRodada').textContent = `${t.nome} · ${nomeRodada(j.r, total)}`;
    const lado = (id, val, campo) => el('div', { class: 'duelo-lado', 'data-id': id },
      avatarDe(nickId(id), ptsGeralDe(chave(nickId(id))), 'av-m'),
      el('b', { class: 'duelo-nome', text: nickId(id) }),
      el('label', { class: 'duelo-rot', for: campo, text: rotMetrica(t) }),
      el('input', { id: campo, type: 'text', inputmode: t.metrica === 'massa' ? 'decimal' : 'numeric', autocomplete: 'off', placeholder: '—', value: val != null ? fmt(val) : null, oninput: autoVencedor }),
      el('button', { type: 'button', class: 'duelo-venceu', 'aria-pressed': 'false', onclick: () => { duelo.v = id; marcarVencedor(); } }, svg(ICONE_COROA, 16), 'Venceu'));
    trocar($('dueloLados'), lado(j.a, j.va, 'dueloVa'), el('span', { class: 'vs-x', text: '×' }), lado(j.b, j.vb, 'dueloVb'));
    $('dueloWo').checked = !!j.wo;
    $('btnLimparDuelo').hidden = !j.v;
    erroDuelo(null);
    marcarVencedor();
    $('dlgDuelo').showModal();
  }
  function autoVencedor() {
    if (!duelo) return;
    const a = lerValorTn(duelo.t, $('dueloVa').value), b = lerValorTn(duelo.t, $('dueloVb').value);
    if (a.valor != null && b.valor != null && a.valor !== b.valor) duelo.v = a.valor > b.valor ? duelo.j.a : duelo.j.b;
    marcarVencedor();
  }
  function marcarVencedor() {
    for (const n of $('dueloLados').querySelectorAll('.duelo-lado')) {
      const sim = n.dataset.id === duelo.v;
      n.classList.toggle('venc', sim);
      n.querySelector('.duelo-venceu').setAttribute('aria-pressed', String(sim));
    }
    const prox = duelo.j.r + 1 < duelo.total ? naRodada(duelo.j.r + 1, duelo.total).replace(/^na/, 'pra') : null;
    $('dueloNota').textContent = duelo.v
      ? (prox ? `${nickId(duelo.v)} vai ${prox}.` : `${nickId(duelo.v)} vira o CAMPEÃO.`)
      : 'Escreve o resultado de cada um (quem fizer mais vence) ou toque em quem venceu.';
  }
  function erroDuelo(msg) { $('erroDuelo').textContent = msg || ''; $('erroDuelo').hidden = !msg; }
  async function salvarDuelo(ev) {
    ev.preventDefault();
    if (!duelo) return;
    const { t, j } = duelo;
    const a = lerValorTn(t, $('dueloVa').value), b = lerValorTn(t, $('dueloVb').value);
    if (a.erro || b.erro) return erroDuelo('Só número no resultado. Ex: 12' + (t.metrica === 'massa' ? ' ou 52 mil' : '') + '.');
    if (!duelo.v) return erroDuelo('Toque em "Venceu" de quem ganhou o duelo.');
    if (!admin) return erroDuelo('Entre na área do admin.');
    const atual = torneios.find((x) => x.id === t.id);
    if (!atual || !atual.chave) return erroDuelo('A chave mudou. Fecha e abre de novo.');
    const c = { ...atual.chave, res: { ...(atual.chave.res || {}) } };
    c.res[j.id] = { a: j.a, b: j.b, va: a.valor ?? null, vb: b.valor ?? null, v: duelo.v, wo: $('dueloWo').checked };
    const btn = $('btnSalvarDuelo');
    btn.disabled = true;
    try {
      const venc = duelo.v;
      await gravarChave(atual, c);
      $('dlgDuelo').close();
      const camp = campeaoMata(torneios.find((x) => x.id === t.id) || atual);
      toast(camp === venc ? `👑 ${comTag(nickId(venc))} é o CAMPEÃO de ${t.nome}!` : `${comTag(nickId(venc))} venceu e avançou!`);
    } catch (e) {
      console.error(e);
      if (erroSessao(e)) { $('dlgDuelo').close(); return; }
      erroDuelo('Não deu pra salvar agora. (' + (e.message || 'erro') + ')');
    } finally {
      btn.disabled = false;
    }
  }
  async function limparDuelo() {
    if (!duelo) return;
    const atual = torneios.find((x) => x.id === duelo.t.id);
    if (!atual || !atual.chave) return;
    const c = { ...atual.chave, res: { ...(atual.chave.res || {}) } };
    delete c.res[duelo.j.id];
    try {
      await gravarChave(atual, c);
      $('dlgDuelo').close();
      toast('Resultado apagado. O duelo voltou a ficar em aberto.');
    } catch (e) {
      if (erroSessao(e)) { $('dlgDuelo').close(); return; }
      erroDuelo('Não deu pra limpar agora. (' + (e.message || 'erro') + ')');
    }
  }

  // ---------- lançar resultado (kills, massa de partida especial...) ----------
  let arquivoLanc = null;
  function prepararLanc(t) {
    const insc = idsInscritos(t).map((id) => jogPorId.get(id));
    const porNome = (a, b) => a.nick.localeCompare(b.nick, 'pt-BR');
    const resto = t.todos ? [] : jogadores.filter((r) => r.ativo && !insc.includes(r)).sort(porNome);
    const sel = fl('lancJog');
    const antes = formLanc.dataset.torneio === t.id ? sel.value : '';
    trocar(sel,
      el('option', { value: '', text: 'Escolhe o jogador' }),
      el('optgroup', { label: t.todos ? 'Clã' : 'Inscritos' }, ...[...insc].sort(porNome).map((r) => el('option', { value: r.id, text: r.nick }))),
      resto.length ? el('optgroup', { label: 'Outros (entram no torneio)' }, ...resto.map((r) => el('option', { value: r.id, text: r.nick }))) : null);
    sel.value = [...sel.options].some((o) => o.value === antes) ? antes : '';
    if (formLanc.dataset.torneio !== t.id) {
      fl('lancValor').value = '';
      fl('lancNota').value = '';
      limparPrintLanc();
      erroLanc(null);
    }
    formLanc.dataset.torneio = t.id;
    const massa = t.metrica !== 'custom';
    fl('lancValorRot').textContent = massa ? 'MASSA DA PARTIDA' : `QUANTOS ${rotMetrica(t)}`;
    fl('lancValor').placeholder = massa ? 'ex: 52.430 ou 52 mil' : 'ex: 12';
    fl('lancValor').inputMode = massa ? 'decimal' : 'numeric';
    fl('lancSub').textContent = t.auto && massa
      ? 'As partidas registradas no ranking já entram sozinhas. Use aqui só pra resultado extra, que vale só no torneio.'
      : `Confere o print e escreve ${massa ? 'a massa' : `quantos ${nomeMetrica(t)}`} que o jogador fez. Vale só pro torneio, não mexe no ranking.`;
    mostrarLanc();
  }
  function lerLanc(t) {
    if (t.metrica === 'custom') return lerInteiro(fl('lancValor').value);
    return lerMassa(fl('lancValor').value);
  }
  function mostrarLanc() {
    const t = torneios.find((x) => x.id === formLanc.dataset.torneio);
    if (!t) return;
    const r = lerLanc(t);
    const box = fl('lancLido');
    if (r.vazio) { box.textContent = ''; return; }
    if (r.erro) { box.textContent = 'Não entendi esse número.'; return; }
    if (r.decimal) { box.textContent = `Massa não tem vírgula. Era ${fmt(r.sugestao)}? Escreve "${fl('lancValor').value.trim()} mil".`; return; }
    const v = r.valor;
    box.textContent = t.metrica === 'custom' ? `Vai entrar: ${valorTn(t, v)}`
      : `Vai entrar: ${fmt(v)} de massa${t.metrica === 'pontos' ? ` = ${ptsTxt(pontosDe(v))} no torneio` : ''}${r.pequeno ? ` · só ${fmt(v)}? Se for ${fmt(r.sugestao)}, escreve "${fmt(v)} mil"` : ''}`;
  }
  function erroLanc(msg) { fl('erroLanc').textContent = msg || ''; fl('erroLanc').hidden = !msg; }
  function limparPrintLanc() { arquivoLanc = null; fl('lancPrint').value = ''; fl('lancPrintNome').textContent = ''; }

  // sobe a imagem no armazenamento (só admin logado consegue)
  async function subirPrint(blob, pasta) {
    const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
    const caminho = `${pasta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const up = await sb.storage.from(BUCKET).upload(caminho, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
    if (up.error) {
      if (/row-level security|unauthorized|jwt/i.test(up.error.message)) { await sairAdmin(true); throw Object.assign(new Error('sessão'), { sessao: true }); }
      throw new Error('print: ' + up.error.message);
    }
    return caminho;
  }

  async function lancar(ev) {
    ev.preventDefault();
    const t = torneios.find((x) => x.id === formLanc.dataset.torneio);
    if (!t) return;
    const id = fl('lancJog').value;
    const r = lerLanc(t);
    const massa = t.metrica !== 'custom';
    if (!id) return erroLanc('Escolhe o jogador.');
    if (r.vazio) return erroLanc(massa ? 'Escreve a massa da partida. Ex: 52430 ou 52 mil.' : `Escreve quantos ${nomeMetrica(t)} ele fez.`);
    if (r.erro || r.decimal || r.valor == null) return erroLanc('Não entendi o número.');
    if (massa && (r.valor < MASSA_MIN || r.valor > MASSA_MAX)) return erroLanc(`A massa tem que ficar entre ${fmt(MASSA_MIN)} e ${fmt(MASSA_MAX)}.`);
    if (!admin) return erroLanc('Entre na área do admin.');
    erroLanc(null);
    const btn = fl('btnLanc');
    btn.disabled = true;
    btn.textContent = 'LANÇANDO…';
    try {
      const nota = fl('lancNota').value.replace(/\s+/g, ' ').trim().slice(0, 80);
      let print_path = null, print_url = null;
      if (arquivoLanc) {
        const blob = await comprimir(arquivoLanc);
        if (DEMO) print_url = URL.createObjectURL(blob);
        else print_path = await subirPrint(blob, `torneios/${t.id}`);
      }
      if (DEMO) {
        lancamentos.unshift({ id: 'dl-' + Date.now(), torneio_id: t.id, player_id: id, valor: r.valor, nota, print_path: null, print_url, created_at: new Date().toISOString() });
        if (!t.todos && !t.participantes.includes(id)) t.participantes.push(id);
      } else {
        await rpcAdmin('admin_add_lancamento', { p_torneio: t.id, p_player: id, p_valor: r.valor, p_nota: nota, p_print_path: print_path });
        await carregar();
      }
      fl('lancValor').value = '';
      fl('lancNota').value = '';
      limparPrintLanc();
      render();
      const atual = torneios.find((x) => x.id === t.id) || t;
      const nick = nickId(id);
      const l = classificarTn(atual).find((x) => x.chave === chave(nick));
      const vale = t.metrica === 'pontos' ? pontosDe(r.valor) : r.valor;
      toast(`Lançado! ${comTag(nick)} ${valorTn(t, vale)}${l && l.qtd ? ` · agora em ${l.pos}º` : ''}.`);
      fl('lancValor').focus();
    } catch (e) {
      console.error(e);
      if (erroSessao(e)) return;
      erroLanc('Não deu pra lançar agora. (' + (e.message || 'erro') + ')');
    } finally {
      btn.disabled = false;
      btn.textContent = 'LANÇAR';
    }
  }

  function pedirApagarLanc(t, e) {
    confirmar('APAGAR RESULTADO?', `${comTag(e.nome)} · ${valorTn(t, e.valor)} no torneio "${t.nome}" (${haQuanto(e.quando)}). Isso não pode ser desfeito.`, 'Apagar', async () => {
      try {
        if (DEMO) lancamentos = lancamentos.filter((l) => l.id !== e.lanc.id);
        else {
          const caminho = await rpcAdmin('admin_apagar_lancamento', { p_id: e.lanc.id });
          if (caminho) await sb.storage.from(BUCKET).remove([caminho]);
          await carregar();
        }
        render();
        toast('Resultado apagado.');
      } catch (err) {
        if (!erroSessao(err)) toast('Não deu pra apagar agora. Tenta de novo.', true);
      }
    });
  }

  // ---------- criar / editar torneio (só admin) ----------
  let editTn = null;          // torneio sendo editado (null = novo)
  let confirmaApagarTn = false;
  const tnEstado = { formato: 'soma', metrica: 'pontos', todos: true, sel: new Set() };
  const paraInput = (ms) => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const doInput = (v) => (v ? new Date(v).getTime() : NaN); // "2026-10-20T20:00" = hora local
  function fimDaSemana(base = Date.now()) { const d = new Date(base); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); d.setHours(23, 59, 0, 0); return d.getTime(); }
  function dadosDe(t) {
    const { nome, formato, metrica, unidade, auto, qtd, meta, semente, inicio, fim, encerrado_em, todos, participantes, premios, regras, publicado } = t;
    return { nome, formato, metrica, unidade, auto, qtd, meta, semente, inicio, fim, encerrado_em, todos, participantes, premios, regras, publicado, base: baseDe(t), podio: (t.podio || []).filter(Boolean) };
  }
  async function salvarTn(t, mudancas) {
    const dados = { ...dadosDe(t), ...mudancas };
    if (DEMO) { const alvo = torneios.find((x) => x.id === t.id); if (alvo) Object.assign(alvo, dados); }
    else { await rpcAdmin('admin_salvar_torneio', { p_id: t.id, p_dados: dados }); await carregar(); }
    render();
  }

  function montarFormatos() {
    trocar($('tnFormatos'), Object.entries(FORMATOS).map(([id, f]) => el('button', {
      type: 'button', class: 'tn-formato', role: 'radio', 'data-formato': id, 'aria-checked': 'false',
      onclick: () => { tnEstado.formato = id; atualizarBuilder(); },
    }, el('span', { class: 'tn-formato-ic', 'aria-hidden': 'true' }, svg(f.icone, 22)), el('b', { text: f.nome }), el('span', { text: f.desc }))));
    trocar($('tnUnidadeSug'), ['kills', 'abates', 'vitórias', 'tops', 'mortes'].map((u) => el('button', {
      type: 'button', class: 'sug', text: u, onclick: () => { $('tnUnidade').value = u; atualizarBuilder(); },
    })));
  }

  function abrirBuilder(t = null) {
    editTn = t;
    confirmaApagarTn = false;
    const agora = new Date();
    agora.setSeconds(0, 0);
    tnEstado.formato = t ? t.formato : 'soma';
    tnEstado.metrica = t ? t.metrica : 'pontos';
    tnEstado.todos = t ? t.todos : true;
    tnEstado.sel = new Set(t ? (t.participantes || []).filter((id) => jogPorId.has(id)) : []);
    $('tituloTn').textContent = t ? 'EDITAR TORNEIO' : 'NOVO TORNEIO';
    $('btnSalvarTn').textContent = t ? 'Salvar' : 'Criar torneio';
    $('btnApagarTn').hidden = !t;
    $('btnApagarTn').textContent = 'Apagar';
    $('tnNome').value = t ? t.nome : '';
    $('tnUnidade').value = t ? t.unidade || '' : '';
    $('tnAuto').checked = t ? t.auto : true;
    $('tnQtd').value = t && t.qtd ? t.qtd : 3;
    $('tnMeta').value = t && t.meta ? fmt(t.meta) : '';
    $('tnSemente').value = t ? t.semente || 'ranking' : 'ranking';
    $('tnBase').value = t ? baseDe(t) : periodo === 'semana' || periodo === 'geral' ? periodo : 'mes';
    $('tnInicio').value = paraInput(t ? Date.parse(t.inicio) : agora.getTime());
    $('tnFim').value = t ? (t.fim ? paraInput(Date.parse(t.fim)) : '') : paraInput(fimDaSemana(agora.getTime() + 86400000));
    [1, 2, 3].forEach((i) => { $('tnPremio' + i).value = (t && t.premios && t.premios[i - 1]) || ''; });
    $('tnRegras').value = t ? t.regras || '' : '';
    $('tnPublicado').checked = t ? t.publicado : true;
    $('tnBuscaJog').value = '';
    erroTn(null);
    atualizarBuilder();
    $('dlgTorneio').showModal();
    $('dlgTorneio').querySelector('.tn-form-corpo').scrollTop = 0;
    // no celular não abre o teclado sozinho (deixa ver os formatos primeiro)
    if (!t && matchMedia('(pointer: fine)').matches) $('tnNome').focus({ preventScroll: true });
  }

  function atualizarBuilder() {
    const { formato, metrica, todos } = tnEstado;
    const mata = formato === 'mata';
    const hora = formato === 'hora', livre = formato === 'livre';
    // hora H só olha o ranking (pontos ou massa); regras próprias não tem métrica
    if (hora && metrica === 'custom') { tnEstado.metrica = 'pontos'; return atualizarBuilder(); }
    document.querySelectorAll('.tn-formato').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.formato === formato)));
    document.querySelectorAll('#tnMetricas [data-metrica]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.metrica === metrica)));
    document.querySelectorAll('#tnQuem [data-todos]').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.todos === '1') === todos)));
    $('tnMetricaRot').textContent = mata ? 'O QUE DECIDE O DUELO' : hora ? 'QUAL RANKING VALE' : 'O QUE CONTA';
    $('tnMetricaBloco').hidden = livre;
    document.querySelector('#tnMetricas [data-metrica="custom"]').hidden = hora;
    $('tnBaseBox').hidden = !hora;
    $('tnUnidadeBox').hidden = metrica !== 'custom';
    $('tnAutoBox').hidden = mata || hora || metrica === 'custom';
    $('tnFimRot').textContent = hora ? 'HORA H (VALE O 1º DESSA HORA)' : livre ? 'TERMINA (OPCIONAL)' : 'TERMINA';
    $('tnRegrasRot').replaceChildren(livre ? 'REGRAS DO TORNEIO ' : 'REGRAS EXTRAS ', el('span', { class: 'sec', text: livre ? '(obrigatório: explica como ganha)' : '(opcional)' }));
    $('tnRegras').placeholder = livre ? 'ex: às 21h quem estiver em 1º na sala do clã é o campeão. Vale print com o horário.' : 'ex: só vale print com o nick visível. Partida em sala lotada.';
    $('tnQtdBox').hidden = formato !== 'melhores';
    $('tnMetaBox').hidden = formato !== 'meta';
    $('tnSementeBox').hidden = !mata;
    $('tnEscolherBox').hidden = todos;
    $('tnMeta').placeholder = metrica === 'massa' ? 'ex: 500 mil' : metrica === 'pontos' ? 'ex: 1000' : 'ex: 50';
    const meta = lerMetaBuilder();
    $('tnMetaLida').textContent = formato === 'meta' && meta ? `Meta: ${valorTn({ metrica, unidade: $('tnUnidade').value }, meta)}` : '';
    renderAtalhosData();
    renderEscolher();
    renderResumoBuilder();
  }

  function lerMetaBuilder() {
    const txt = $('tnMeta').value;
    if (tnEstado.metrica === 'massa') { const r = lerMassa(txt); return r.valor > 0 ? Math.min(r.valor, 100000000) : null; }
    const r = lerInteiro(txt);
    return r.valor > 0 ? Math.min(r.valor, 100000000) : null;
  }

  function renderAtalhosData() {
    const ini = doInput($('tnInicio').value);
    const base = isFinite(ini) ? ini : Date.now();
    const fimEm = (ms) => { $('tnFim').value = paraInput(ms); };
    const ops = [
      ['Começa agora', () => { const d = new Date(); d.setSeconds(0, 0); $('tnInicio').value = paraInput(d.getTime()); }],
      ['Até domingo', () => fimEm(fimDaSemana(base + 3600000))],
      ['7 dias', () => fimEm(base + 7 * 86400000)],
      ['15 dias', () => fimEm(base + 15 * 86400000)],
      ['Até o fim do mês', () => { const d = new Date(base); fimEm(new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59).getTime()); }],
      tnEstado.formato === 'mata' || tnEstado.formato === 'livre' ? ['Sem data pra acabar', () => { $('tnFim').value = ''; }] : null,
    ].filter(Boolean);
    if (tnEstado.formato === 'hora') {
      const hj = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.getTime(); };
      ops.splice(1, ops.length,
        ['Daqui 1 hora', () => { const d = new Date(); d.setSeconds(0, 0); fimEm(d.getTime() + 3600000); }],
        ['Hoje às 21h', () => fimEm(hj(21))],
        ['Hoje às 23h', () => fimEm(hj(23))],
        ['Domingo 23:59', () => fimEm(fimDaSemana(base + 3600000))]);
    }
    trocar($('tnAtalhosData'), ops.map(([rot, f]) => el('button', { type: 'button', class: 'sug', text: rot, onclick: () => { f(); atualizarBuilder(); } })));
  }

  function renderEscolher() {
    if (tnEstado.todos) return;
    const q = busca($('tnBuscaJog').value);
    const lista = jogadores.filter((r) => r.ativo || tnEstado.sel.has(r.id))
      .filter((r) => !q || busca(r.nick).includes(q))
      .sort((a, b) => a.nick.localeCompare(b.nick, 'pt-BR'));
    trocar($('tnListaJog'), lista.length
      ? lista.map((r) => el('button', {
          type: 'button', class: 'tn-jog', 'aria-pressed': String(tnEstado.sel.has(r.id)),
          onclick: (e) => {
            if (tnEstado.sel.has(r.id)) tnEstado.sel.delete(r.id); else tnEstado.sel.add(r.id);
            e.currentTarget.setAttribute('aria-pressed', String(tnEstado.sel.has(r.id)));
            contarSel();
            renderResumoBuilder();
          },
        }, avatarDe(r.nick, ptsGeralDe(chave(r.nick)), 'av-p'), r.nick))
      : el('span', { class: 'sec', text: jogadores.length ? 'Ninguém com esse nome.' : 'Cadastre o elenco em "Jogadores do clã" primeiro.' }));
    contarSel();
  }
  function contarSel() {
    const n = tnEstado.sel.size;
    $('tnQtdSel').textContent = n ? `${n} ${n === 1 ? 'jogador escolhido' : 'jogadores escolhidos'}` : 'Toque nos jogadores que vão jogar.';
  }

  // o torneio do jeito que está no formulário (pra mostrar o resumo antes de salvar)
  function tnDoForm() {
    const ini = doInput($('tnInicio').value), fim = doInput($('tnFim').value);
    return {
      id: editTn ? editTn.id : '', formato: tnEstado.formato, metrica: tnEstado.metrica, unidade: $('tnUnidade').value.trim(),
      auto: $('tnAuto').checked, qtd: parseInt($('tnQtd').value, 10) || 3, meta: lerMetaBuilder(), semente: $('tnSemente').value, base: $('tnBase').value, podio: [],
      inicio: new Date(isFinite(ini) ? ini : Date.now()).toISOString(), fim: isFinite(fim) ? new Date(fim).toISOString() : null,
      todos: tnEstado.todos, participantes: [...tnEstado.sel], premios: [], regras: $('tnRegras').value.trim(), publicado: true, chave: null,
    };
  }
  function renderResumoBuilder() {
    const t = tnDoForm();
    const ini = Date.parse(t.inicio), fim = t.fim ? Date.parse(t.fim) : null;
    const dur = fim && fim > ini ? Math.round((fim - ini) / 3600000) : 0;
    const durTxt = !fim ? 'sem data pra acabar' : dur < 1 ? null : dur < 48 ? `dura ${dur} h` : `dura ${Math.round(dur / 24)} dias`;
    trocar($('tnResumo'),
      el('b', { text: 'COMO VAI FUNCIONAR' }),
      el('ul', null, ...resumoTn(t).map((x) => el('li', { text: x })),
        el('li', { text: `${fim && fim <= ini ? 'Atenção: o fim está antes do começo.' : `${periodoTn(t)}${durTxt ? ` (${durTxt})` : ''}.`}` })));
  }

  function erroTn(msg) { $('erroTn').textContent = msg || ''; $('erroTn').hidden = !msg; }
  function lerBuilder() {
    const { formato, metrica, todos, sel } = tnEstado;
    const nome = $('tnNome').value.replace(/\s+/g, ' ').trim();
    if (!nome) return { erro: 'Dá um nome pro torneio.', campo: 'tnNome' };
    const unidade = $('tnUnidade').value.replace(/\s+/g, ' ').trim().slice(0, 20);
    if (metrica === 'custom' && formato !== 'livre' && !unidade) return { erro: 'Escreve o que vai ser contado (ex: kills).', campo: 'tnUnidade' };
    const qtd = parseInt($('tnQtd').value, 10);
    if (formato === 'melhores' && !(qtd >= 1 && qtd <= 100)) return { erro: 'Quantas partidas contam? De 1 a 100.', campo: 'tnQtd' };
    const meta = lerMetaBuilder();
    if (formato === 'meta' && !meta) return { erro: 'Escreve a meta da corrida.', campo: 'tnMeta' };
    const ini = doInput($('tnInicio').value);
    if (!isFinite(ini)) return { erro: 'Escolhe quando o torneio começa.', campo: 'tnInicio' };
    const fim = doInput($('tnFim').value);
    if (!$('tnFim').value && formato === 'hora') return { erro: 'Escolhe a hora H: quem estiver em 1º nessa hora é o campeão.', campo: 'tnFim' };
    if (!$('tnFim').value && formato !== 'mata' && formato !== 'livre') return { erro: 'Escolhe quando o torneio termina.', campo: 'tnFim' };
    if (formato === 'livre' && !$('tnRegras').value.trim()) return { erro: 'Escreve as regras: como se ganha esse torneio?', campo: 'tnRegras' };
    if ($('tnFim').value && !(fim > ini)) return { erro: 'O fim tem que ser depois do começo.', campo: 'tnFim' };
    const ids = [...sel].filter((id) => jogPorId.has(id));
    if (!todos && ids.length < (formato === 'mata' ? 2 : 1)) return { erro: formato === 'mata' ? 'Escolhe pelo menos 2 jogadores pro mata-mata.' : 'Escolhe quem vai jogar.', campo: 'tnBuscaJog' };
    const qtdJog = todos ? jogadores.filter((r) => r.ativo).length : ids.length;
    if (formato === 'mata' && qtdJog > 64) return { erro: `O mata-mata aceita até 64 jogadores (tem ${qtdJog}). Escolhe quem joga.` };
    if (ids.length > 256) return { erro: 'No máximo 256 jogadores escolhidos.' };
    const premios = [1, 2, 3].map((i) => $('tnPremio' + i).value.replace(/\s+/g, ' ').trim().slice(0, 60));
    while (premios.length && !premios[premios.length - 1]) premios.pop();
    return { dados: {
      nome: nome.slice(0, 60), formato, metrica: formato === 'livre' ? 'pontos' : metrica, unidade: metrica === 'custom' && formato !== 'livre' ? unidade : '',
      auto: formato === 'hora' || (formato !== 'mata' && formato !== 'livre' && metrica !== 'custom' && $('tnAuto').checked),
      base: BASES[$('tnBase').value] ? $('tnBase').value : 'geral', podio: editTn ? (editTn.podio || []).filter(Boolean) : [],
      qtd: formato === 'melhores' ? qtd : null, meta: formato === 'meta' ? meta : null,
      semente: $('tnSemente').value === 'sorteio' ? 'sorteio' : 'ranking',
      inicio: new Date(ini).toISOString(), fim: $('tnFim').value ? new Date(fim).toISOString() : null,
      encerrado_em: editTn ? editTn.encerrado_em || null : null,
      todos, participantes: ids, premios, regras: $('tnRegras').value.trim().slice(0, 2000), publicado: $('tnPublicado').checked,
    } };
  }

  async function salvarBuilder(ev) {
    ev.preventDefault();
    const r = lerBuilder();
    if (r.erro) { erroTn(r.erro); if (r.campo) $(r.campo).focus(); return; }
    if (!admin) return erroTn('Entre na área do admin.');
    erroTn(null);
    const btn = $('btnSalvarTn');
    btn.disabled = true;
    try {
      let id;
      if (DEMO) {
        if (editTn) { id = editTn.id; Object.assign(torneios.find((x) => x.id === id), r.dados); }
        else { id = 'dt-' + Date.now(); torneios.unshift({ id, ...r.dados, chave: null, created_at: new Date().toISOString() }); }
      } else {
        id = await rpcAdmin('admin_salvar_torneio', { p_id: editTn ? editTn.id : null, p_dados: r.dados });
        if (!id) throw new Error('torneio não encontrado');
        await carregar();
      }
      const novo = !editTn;
      $('dlgTorneio').close();
      render();
      if (novo) abrirTorneio(id);
      toast(novo ? (r.dados.publicado ? 'Torneio criado! Manda no grupo pelo botão "Mandar no grupo".' : 'Rascunho salvo. Só admin vê até você publicar.') : 'Torneio atualizado.');
    } catch (e) {
      console.error(e);
      if (erroSessao(e)) { $('dlgTorneio').close(); return; }
      erroTn('Não deu pra salvar agora. (' + (e.message || 'erro') + ')');
    } finally {
      btn.disabled = false;
    }
  }

  async function apagarTn() {
    const t = editTn;
    if (!t) return;
    if (!confirmaApagarTn) { confirmaApagarTn = true; $('btnApagarTn').textContent = 'Toque de novo pra apagar'; return; }
    try {
      if (DEMO) {
        torneios = torneios.filter((x) => x.id !== t.id);
        lancamentos = lancamentos.filter((l) => l.torneio_id !== t.id);
      } else {
        const caminhos = await rpcAdmin('admin_apagar_torneio', { p_id: t.id });
        if (caminhos && caminhos.length) await sb.storage.from(BUCKET).remove(caminhos);
        await carregar();
      }
      $('dlgTorneio').close();
      if (torneioAtual === t.id) { history.replaceState({}, '', location.pathname + '#torneios'); mostrarRota(); }
      render();
      toast(`Torneio "${t.nome}" apagado.`);
    } catch (e) {
      console.error(e);
      if (erroSessao(e)) { $('dlgTorneio').close(); return; }
      erroTn('Não deu pra apagar agora. (' + (e.message || 'erro') + ')');
    }
  }

  // ---------- torneios no perfil do jogador ----------
  function torneiosDoJogador(k) {
    const r = elenco.get(k);
    const out = [];
    for (const t of torneiosVisiveis()) {
      if (!t.publicado) continue;
      const st = statusTn(t);
      if (t.formato === 'mata') {
        const rs = rodadasMata(t);
        const lg = rs && r ? lugarMata(rs, r.id) : null;
        if (!lg) continue;
        out.push({ t, st, pos: lg.pos, txt: lg.txt });
      } else if (t.formato === 'livre') {
        const i = r ? podioLivre(t).indexOf(r.id) : -1;
        const insc = r && idsInscritos(t).includes(r.id);
        if (i < 0 && !(insc && st !== 'fim')) continue;
        out.push({ t, st, pos: i + 1, txt: i >= 0 ? ['Campeão', 'Vice-campeão', '3º lugar'][i] : 'Inscrito · regras próprias' });
      } else {
        const cls = classificarTn(t);
        const l = cls.find((x) => x.chave === k);
        if (!l || !l.qtd) continue;
        out.push({ t, st, pos: l.pos, txt: `${l.pos}º de ${cls.filter((x) => x.qtd).length} · ${valorTn(t, l.total)}` });
      }
    }
    const peso = { vivo: 0, breve: 1, fim: 2 };
    return out.sort((a, b) => peso[a.st] - peso[b.st] || Date.parse(b.t.inicio) - Date.parse(a.t.inicio));
  }
  function secaoTorneiosPerfil(k) {
    const lista = torneiosDoJogador(k);
    const premios = trofeusDe(k);
    if (!lista.length && !premios.length) return null;
    // estante: um troféu por título e uma medalha de prata por vice
    const estante = premios.length ? el('ul', { class: 'tnt-estante', 'aria-label': 'Troféus e medalhas de torneio' }, ...premios.map(({ t, pos }) => el('li', null,
      linkTn(t, `tnt-item tnt-p${pos}`,
        el('span', { class: 'tnt-ic', 'aria-hidden': 'true' }, svg(pos === 1 ? ICONE_TROFEU : ICONE_MEDALHA, 30)),
        el('b', { class: 'tnt-rot', text: pos === 1 ? 'CAMPEÃO' : 'VICE' }),
        el('span', { class: 'tnt-nome', text: t.nome }))))) : null;
    const v = vitoriasTorneio(k), p = vicesTorneio(k);
    const conta = [v ? `${v} ${v === 1 ? 'troféu' : 'troféus'}` : null, p ? `${p} ${p === 1 ? 'medalha' : 'medalhas'} de vice` : null].filter(Boolean).join(' · ');
    return el('section', { class: 'pp-sec', 'aria-labelledby': 'ppTn' },
      el('h2', { class: 'perfil-h3', id: 'ppTn' }, 'TORNEIOS ', el('span', { class: 'sec', text: conta || fmt(lista.length) })),
      estante,
      lista.length ? el('ul', { class: 'pp-tns' }, ...lista.map(({ t, st, pos, txt }) => {
        const ganhou = pos === 1 && st === 'fim';
        const vice = pos === 2 && st === 'fim';
        return el('li', null, linkTn(t, `pp-tn ${ganhou ? 'campeao' : vice ? 'vice' : ''}`,
          el('span', { class: `pp-tn-pos p${pos}` }, ganhou ? svg(ICONE_TROFEU, 20) : vice ? svg(ICONE_MEDALHA, 20) : pos ? `${pos}º` : '–'),
          el('span', { class: 'pp-tn-info' }, el('b', { text: t.nome }), el('span', { text: ganhou && !/^Campeão/.test(txt) ? `Campeão · ${txt}` : vice && !/^Vice/.test(txt) ? `Vice-campeão · ${txt}` : txt })),
          pilulaStatus(t, st)));
      })) : null);
  }

  // ---------- print ----------
  function abrirPrintLivre(url, legenda) {
    $('imgPrint').src = url;
    $('legendaPrint').textContent = legenda;
    $('dlgPrint').showModal();
  }
  function abrirPrint(p) {
    const url = urlPrint(p);
    if (!url) return;
    $('imgPrint').src = url;
    $('legendaPrint').textContent = `${comTag(limparNick(p.player))} · ${fmt(p.mass)} de massa · ${new Date(p.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`;
    $('dlgPrint').showModal();
  }

  async function comprimir(arquivo) {
    try {
      const bmp = await createImageBitmap(arquivo);
      const max = 1400;
      const esc = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * esc);
      c.height = Math.round(bmp.height * esc);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
      return blob || arquivo;
    } catch (e) {
      return arquivo;
    }
  }

  function escolherArquivo(f) {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { mostrarErro('O print precisa ser uma imagem PNG, JPG ou WEBP.'); return; }
    if (f.size > 15 * 1024 * 1024) { mostrarErro('Essa imagem é grande demais (máximo 15 MB).'); return; }
    arquivoPrint = f;
    const prev = $('previaPrint');
    if (prev.dataset.url) URL.revokeObjectURL(prev.dataset.url);
    prev.dataset.url = URL.createObjectURL(f);
    prev.src = prev.dataset.url;
    prev.hidden = false;
    $('txtPrint').hidden = true;
    mostrarErro(null);
  }

  // ---------- registrar ----------
  function mostrarErro(msg) {
    const e = $('erroForm');
    e.textContent = msg || '';
    e.hidden = !msg;
  }

  async function enviar(ev) {
    ev.preventDefault();
    const nome = limparNick($('fNome').value);
    const lida = lerMassa($('fMassa').value);
    const massa = lida.valor;
    if (!nome) return mostrarErro('Escreve o nick do jogador.');
    if (lida.vazio) return mostrarErro('Escreve a massa final da partida. Ex: 52430 ou 52 mil.');
    if (lida.erro) return mostrarErro('Não entendi a massa. Escreve só o número (52430) ou com "mil" (52 mil).');
    if (lida.decimal) return mostrarErro(`Massa não tem vírgula. Se for ${fmt(lida.sugestao)}, toque em × MIL.`);
    if (massa < MASSA_MIN) return mostrarErro(lida.sugestao ? `Massa baixa demais. Se for ${fmt(lida.sugestao)}, toque em × MIL.` : 'Escreve a massa final da partida. Ex: 52430 ou 52 mil.');
    if (massa > MASSA_MAX) return mostrarErro(`Massa acima de ${fmt(MASSA_MAX)}? Confere o número.`);
    if (lida.pequeno && confirmarPequena !== massa) {
      confirmarPequena = massa;
      return mostrarErro(`Só ${fmt(massa)} de massa? Se for ${fmt(lida.sugestao)}, toque em × MIL. Se for ${fmt(massa)} mesmo, toque em COLOCAR NO RANKING de novo.`);
    }
    if (PRINT_OBRIGATORIO && !arquivoPrint) return mostrarErro('Escolhe o print da partida. Ele é a prova da massa.');
    if (!admin) return mostrarErro('Entre na área do admin para registrar.');
    mostrarErro(null);

    const btn = $('btnEnviar');
    btn.disabled = true;
    btn.textContent = 'ENVIANDO…';
    try {
      // quem era o 1º antes deste envio
      const reiAntes = montarRanking('geral')[0];
      const ptsAntes = ptsPat(chave(nome));
      const jogNovo = elencoOk && !elenco.has(chave(nome));
      let print_path = null;
      let print_url = null;
      if (arquivoPrint) {
        const blob = await comprimir(arquivoPrint);
        if (DEMO) {
          print_url = URL.createObjectURL(blob);
        } else {
          print_path = await subirPrint(blob, new Date().toISOString().slice(0, 10));
        }
      }
      if (DEMO) {
        partidas.unshift({ id: 'demo-' + Date.now(), player: nome, mass: massa, print_path: null, print_url, created_at: new Date().toISOString() });
        const r = elenco.get(chave(nome));
        if (r) r.ativo = true;
        else jogadores.push({ id: 'dj-' + Date.now(), nick: nome, cargo: CARGO_PADRAO, ativo: true, created_at: new Date().toISOString() });
        indexarElenco();
      } else {
        await rpcAdmin('admin_add_score', { p_player: nome, p_mass: massa, p_print_path: print_path });
        await carregar();
      }
      $('fNome').value = '';
      $('fMassa').value = '';
      arquivoPrint = null;
      $('fPrint').value = '';
      $('previaPrint').hidden = true;
      $('txtPrint').hidden = false;
      render();
      const reiAgora = montarRanking('geral')[0];
      const ganhou = (pontosDe(massa) ? ` +${ptsTxt(pontosDe(massa))}.` : '') + (jogNovo ? ' Novo no elenco do clã!' : '');
      const ptsDepois = ptsPat(chave(nome));
      const patAntes = patenteDe(ptsAntes).atual, patDepois = patenteDe(ptsDepois).atual;
      if (patDepois.nivel > patAntes.nivel) {
        toast(`${patDepois.diamante ? '💎' : '⬆'} ${comTag(nome)} subiu pra ${patDepois.nome.toUpperCase()}!${ganhou}`);
        if (patDepois.diamante) abrirDiamante(chave(nome), true);
      } else if (reiAgora && chave(reiAgora.nome) === chave(nome) && (!reiAntes || chave(reiAntes.nome) !== chave(nome))) {
        toast(`👑 ${comTag(nome)} agora é o REI DO CLÃ!${ganhou}`);
      } else if (massa >= MARCO) {
        toast(`🔥 ${comTag(nome)} fez ${marcoTxt}!${ganhou}`);
      } else {
        const pos = montarRanking(periodo).findIndex((j) => j.chave === chave(nome)) + 1;
        toast(`Registrado!${ganhou} ${comTag(nome)} está em ${pos}º lugar.`);
      }
      confirmarPequena = null;
      mostrarMassa();
      $('avisoNick').textContent = '';
      renderSugNick();
      $('fNome').focus();
    } catch (e) {
      console.error(e);
      if (erroSessao(e)) return;
      mostrarErro('Não deu pra enviar agora. Confere a internet e tenta de novo. (' + (e.message || 'erro') + ')');
    } finally {
      btn.disabled = false;
      btn.textContent = 'COLOCAR NO RANKING';
    }
  }

  // ---------- admin (login com e-mail e senha, pelo Supabase Auth) ----------
  // Quem decide se a conta é admin é o banco (tabela admins): cada função de
  // registrar/apagar confere de novo lá. O site só mostra ou esconde os botões.
  function aplicarAdmin(novo) {
    admin = novo;
    if (!admin) logins = new Map();
    $('btnAdmin').textContent = admin ? `Sair da área do admin (${admin.nome})` : 'Área do admin';
    render();
    if (admin) carregarLogins();
  }

  // chama uma função de admin no banco; se a sessão caiu, sai do modo admin
  async function rpcAdmin(nome, args) {
    const r = await sb.rpc(nome, args);
    if (r.error) {
      if (r.error.code === '42501' || /jwt|permission denied|acesso negado/i.test(r.error.message)) {
        await sairAdmin(true);
        throw Object.assign(new Error('sessão de admin acabou'), { sessao: true });
      }
      throw new Error(r.error.message);
    }
    return r.data;
  }
  function erroSessao(e) {
    if (!e || !e.sessao) return false;
    toast('Sua sessão de admin acabou. Entre de novo.', true);
    return true;
  }

  // janela de "tem certeza?" (apagar partida, apagar resultado, encerrar torneio...)
  let acaoConfirma = null;
  function confirmar(titulo, texto, botao, acao) {
    $('tituloConfirma').textContent = titulo;
    $('txtConfirma').textContent = texto;
    $('btnSimApagar').textContent = botao;
    acaoConfirma = acao;
    $('dlgConfirma').showModal();
  }
  function confirmou() {
    const acao = acaoConfirma;
    acaoConfirma = null;
    $('dlgConfirma').close();
    if (acao) acao();
  }

  function pedirApagar(p) {
    confirmar('APAGAR PONTUAÇÃO?', `${comTag(limparNick(p.player))} · ${fmt(p.mass)} de massa (${haQuanto(p.created_at)}). Isso não pode ser desfeito.`, 'Apagar', () => apagarPartida(p.id));
  }

  async function apagarPartida(id) {
    if (!id) return;
    try {
      if (DEMO) {
        partidas = partidas.filter((p) => p.id !== id);
      } else {
        const caminho = await rpcAdmin('admin_delete_score', { p_id: id });
        // apaga o print junto pra não sobrar imagem perdida no armazenamento
        if (caminho) await sb.storage.from(BUCKET).remove([caminho]);
        await carregar();
      }
      render();
      toast('Pontuação apagada.');
    } catch (e) {
      if (!erroSessao(e)) toast('Não deu pra apagar agora. Tenta de novo.', true);
    }
  }

  async function sairAdmin(silencioso = false) {
    const era = admin;
    await sairDaConta();
    if (era && !silencioso) toast('Você saiu da área do admin.');
  }

  // ---------- portão: o site é só pra membro do clã logado ----------
  // Sem login (ou com a conta esperando aprovação) aparece só a tela de entrada.
  // Quem fecha de verdade é o banco: visitante e conta sem nick não leem nada (passo 5e do SQL).
  let siteAberto = false;   // já carregou os dados e ligou o tempo real uma vez
  const podeVer = () => !!admin || !!euId;
  function trancar(estado) {
    const st = estado || (meuPedido ? 'pedido' : contaSemJogador ? 'sem-nick' : 'visitante');
    document.body.classList.add('trancado');
    $('portao').hidden = false;
    $('portao').dataset.estado = st;
    $('portaoTxt').replaceChildren(...({
      carregando: ['Carregando…'],
      visitante: ['O ranking do clã é só pra membros. Entre ou crie a sua conta.'],
      'sem-nick': ['Falta escolher o seu nick no clã.'],
      pedido: ['Pedido enviado: ', el('b', { text: comTag(meuPedido || '') }), '. Um admin do clã vai aprovar e aí você entra.'],
    })[st]);
    document.querySelectorAll('#portao [data-portao]').forEach((b) => { b.hidden = !b.dataset.portao.split(' ').includes(st); });
    montarEscadaPortao();
    ligarFundo();
  }
  function destrancar() {
    document.body.classList.remove('trancado');
    $('portao').hidden = true;
    pararFundo();
  }

  // escudos das patentes, crescendo até Diamantes (vitrine do que dá pra conquistar)
  function montarEscadaPortao() {
    const box = $('portaoPatentes');
    if (box.childElementCount) return;
    const lista = PATENTES.filter((p) => p.nivel > 0);
    lista.forEach((p, i) => {
      const tam = Math.round(34 + 30 * (i / Math.max(1, lista.length - 1)));
      const a = el('span', { class: `av av-esc ${i >= lista.length - 2 ? 'av-g' : 'av-m'} ${p.diamante ? 'esc-dia' : ''}`, title: p.nome,
        style: `--pc:${p.cor};width:${tam}px;height:${tam}px;animation-delay:${(.45 + i * .09).toFixed(2)}s` });
      a.innerHTML = escudoSVG(p, '');
      box.append(a);
    });
    const ult = lista[lista.length - 1];
    $('portaoEscada').replaceChildren(`DE ${lista[0].nome.toUpperCase()} A `, el('b', { text: ult.nome.toUpperCase() }));
  }

  // ---------- fundo do portão: cobras neon deslizando (estilo slither.io) ----------
  const fundo = { raf: 0, ctx: null, w: 0, h: 0, cobras: [], comida: [], sprites: {} };
  const CORES_COBRA = [['#FF7A1A', '#B34A06'], ['#FFD84D', '#B88A12'], ['#FF3B4A', '#9E1622'], ['#C6A8FF', '#6E4FC2'], ['#7DF9FF', '#2A8FA8'], ['#FFB347', '#A8620F']];
  const quieto = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function medirFundo() {
    const cv = $('portaoFundo');
    const dpr = Math.min(devicePixelRatio || 1, 2);
    fundo.w = innerWidth;
    fundo.h = innerHeight;
    cv.width = Math.round(fundo.w * dpr);
    cv.height = Math.round(fundo.h * dpr);
    fundo.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  // bolinha de comida brilhando, desenhada uma vez por cor
  function spriteComida(cor) {
    if (fundo.sprites[cor]) return fundo.sprites[cor];
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    rg.addColorStop(0, '#FFFFFF');
    rg.addColorStop(.18, cor);
    rg.addColorStop(.45, cor + '55');
    rg.addColorStop(1, cor + '00');
    g.fillStyle = rg;
    g.fillRect(0, 0, 32, 32);
    return (fundo.sprites[cor] = c);
  }
  function novaComida() {
    const cor = CORES_COBRA[Math.floor(Math.random() * CORES_COBRA.length)][0];
    return { x: Math.random() * fundo.w, y: Math.random() * fundo.h, r: 2 + Math.random() * 3, fase: Math.random() * 6.3, img: spriteComida(cor) };
  }
  function novaCobra(i) {
    const [cor, escura] = CORES_COBRA[i % CORES_COBRA.length];
    const x = Math.random() * fundo.w, y = Math.random() * fundo.h, a = Math.random() * Math.PI * 2;
    const vel = 1.3 + Math.random() * 1.3;
    const corpo = Array.from({ length: Math.round(70 + Math.random() * 110) }, (_, k) => ({ x: x - Math.cos(a) * k * vel, y: y - Math.sin(a) * k * vel }));
    return { cor, escura, r: 5 + Math.random() * 6, a, vel, giro: 0, t: Math.random() * 100, corpo };
  }
  function passoFundo() {
    const { w, h } = fundo;
    for (const c of fundo.cobras) {
      const cab = c.corpo[0];
      const m = 160;
      c.t += .016;
      if (cab.x < -m || cab.x > w + m || cab.y < -m || cab.y > h + m) {
        // saiu da tela: faz a curva e volta
        const d = Math.atan2(h / 2 - cab.y, w / 2 - cab.x) - c.a;
        c.a += Math.atan2(Math.sin(d), Math.cos(d)) * .05;
      } else {
        c.giro = Math.max(-.045, Math.min(.045, (c.giro + (Math.random() - .5) * .018) * .97));
        c.a += c.giro + Math.sin(c.t * 1.4) * .01;
      }
      c.corpo.unshift({ x: cab.x + Math.cos(c.a) * c.vel, y: cab.y + Math.sin(c.a) * c.vel });
      c.corpo.pop();
      // come a comida que passa perto da cabeça
      for (const f of fundo.comida) {
        if (Math.abs(f.x - cab.x) < c.r + 6 && Math.abs(f.y - cab.y) < c.r + 6) Object.assign(f, novaComida());
      }
    }
  }
  function desenharFundo() {
    const { ctx, w, h } = fundo;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (const f of fundo.comida) {
      f.fase += .05;
      const s = f.r * (1 + .3 * Math.sin(f.fase)) * 3;
      ctx.globalAlpha = .45 + .35 * Math.sin(f.fase);
      ctx.drawImage(f.img, f.x - s, f.y - s, s * 2, s * 2);
    }
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const c of fundo.cobras) {
      // rastro de luz em volta do corpo
      ctx.beginPath();
      c.corpo.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = c.cor;
      ctx.globalAlpha = .07;
      ctx.lineWidth = c.r * 5;
      ctx.stroke();
      ctx.globalAlpha = .1;
      ctx.lineWidth = c.r * 2.6;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const c of fundo.cobras) {
      // gomos listrados do rabo pra cabeça (o rabo some aos poucos)
      const n = c.corpo.length;
      for (let k = n - 1; k >= 0; k -= 3) {
        const p = c.corpo[k], f = 1 - k / n;
        const r = c.r * (.5 + .5 * Math.min(1, f * 2.5));
        ctx.globalAlpha = .18 + .62 * f;
        ctx.fillStyle = Math.floor(k / 9) % 2 ? c.escura : c.cor;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, 6.2832);
        ctx.fill();
      }
      // olhos
      const cab = c.corpo[0], px = Math.cos(c.a + 1.57), py = Math.sin(c.a + 1.57);
      const fx = Math.cos(c.a) * c.r * .35, fy = Math.sin(c.a) * c.r * .35;
      ctx.globalAlpha = .95;
      for (const lado of [-1, 1]) {
        const ox = cab.x + px * c.r * .5 * lado + fx, oy = cab.y + py * c.r * .5 * lado + fy;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath(); ctx.arc(ox, oy, c.r * .38, 0, 6.2832); ctx.fill();
        ctx.fillStyle = '#0B0806';
        ctx.beginPath(); ctx.arc(ox + Math.cos(c.a) * c.r * .14, oy + Math.sin(c.a) * c.r * .14, c.r * .2, 0, 6.2832); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  function ligarFundo() {
    if (fundo.raf) return;
    const cv = $('portaoFundo');
    if (!fundo.ctx) {
      fundo.ctx = cv.getContext('2d');
      if (!fundo.ctx) return;
      addEventListener('resize', () => { if (fundo.ctx && !$('portao').hidden) { medirFundo(); if (quieto()) desenharFundo(); } });
    }
    medirFundo();
    if (!fundo.cobras.length) {
      const qtd = Math.max(5, Math.min(10, Math.round(fundo.w * fundo.h / 110000)));
      fundo.cobras = Array.from({ length: qtd }, (_, i) => novaCobra(i));
      fundo.comida = Array.from({ length: Math.round(qtd * 9) }, novaComida);
    }
    if (quieto()) { desenharFundo(); return; } // movimento reduzido: só a foto parada
    const quadro = () => { passoFundo(); desenharFundo(); fundo.raf = requestAnimationFrame(quadro); };
    fundo.raf = requestAnimationFrame(quadro);
  }
  function pararFundo() {
    cancelAnimationFrame(fundo.raf);
    fundo.raf = 0;
  }
  // carrega tudo e mostra o site (depois de entrar ou ao abrir já logado)
  async function abrirSite() {
    await carregar();
    destrancar();
    aplicarAdmin(admin);
    mostrarRota();
    ligarChat();
    if (!siteAberto) {
      siteAberto = true;
      cerimoniaAutomatica();
      ligarTempoReal();
    }
  }
  // sai da conta e esconde tudo de novo (num aparelho emprestado, ninguém vê o que ficou)
  async function sairDaConta() {
    admin = null;
    euId = null;
    meuPedido = null;
    contaSemJogador = false;
    logins = new Map();
    pedidos = [];
    desligarChat();
    if (!DEMO && sb) await sb.auth.signOut().catch(() => {});
    if (!DEMO) { partidas = []; jogadores = []; torneios = []; lancamentos = []; indexarElenco(); }
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    $('btnAdmin').textContent = 'Área do admin';
    trancar('visitante');
  }

  // ---------- entrar (jogador e admin usam a mesma conta: e-mail + senha) ----------
  // O jogador cria a conta com o e-mail dele e o nick. Depois de confirmar o e-mail:
  // nick do elenco liga na hora; nick novo fica esperando um admin aprovar.
  // Admin é quem está na tabela admins: o banco confere em cada ação.
  let modoEntrar = 'entrar';
  let contaSemJogador = false; // logou, mas a conta não tem nick (o escolhido já tinha dono)
  let meuPedido = null;        // nick novo esperando aprovação
  let linkEmail = null;        // { tipo: 'signup' | 'recovery' } quando a pessoa chegou pelo link do e-mail
  let pedidos = [];            // só pro admin: contas esperando aprovação
  // demonstração: VENO já tem conta (veno@demo.com, senha 1234); outro e-mail com 1234 entra como admin
  const demoContas = new Map([['veno@demo.com', { senha: '1234', player: 'dj0' }]]);
  const TEXTO_ENTRAR = {
    entrar: { titulo: 'ENTRAR', botao: 'Entrar', campos: ['email', 'senha'] },
    criar: { titulo: 'CRIAR CONTA', botao: 'Criar conta', campos: ['nick', 'email', 'senha'] },
    esqueci: { titulo: 'ESQUECI A SENHA', botao: 'Mandar link', campos: ['email'], txt: 'Mandamos um link pro seu e-mail pra você criar uma senha nova.' },
    nova: { titulo: 'SENHA NOVA', botao: 'Salvar senha', campos: ['senha'] },
    nick: { titulo: 'QUAL É O SEU NICK?', botao: 'Pronto', campos: ['nick'], txt: 'O seu nick no clã. Um admin confere e libera a sua entrada.' },
    enviado: { titulo: 'OLHA O SEU E-MAIL', botao: null, campos: [] },
  };

  // lê quem está logado: admin, jogador, pedido esperando; e manda o nick escolhido no cadastro
  async function lerConta() {
    if (DEMO) return;
    const { data } = await sb.auth.getSession();
    const s = data.session;
    admin = null; euId = null; meuPedido = null; contaSemJogador = false;
    if (!s) return;
    const [ra, rj, rp] = await Promise.all([sb.rpc('admin_eu'), sb.rpc('jogador_eu'), sb.rpc('meu_pedido')]);
    admin = !ra.error && ra.data ? { nome: ra.data } : null;
    euId = !rj.error && rj.data ? rj.data : null;
    meuPedido = !rp.error && rp.data ? rp.data : null;
    const meta = (s.user && s.user.user_metadata) || {};
    if (!euId && !admin && !meuPedido && meta.nick) {
      // primeira vez depois de confirmar o e-mail: vira pedido pra um admin aprovar
      const rv = await sb.rpc('jogador_pedir_nick', { p_nick: meta.nick });
      if (!rv.error && rv.data === 'pedido') meuPedido = meta.nick;
    }
    contaSemJogador = !euId && !admin && !meuPedido;
  }

  function trocarModoEntrar(m) {
    modoEntrar = m;
    const t = TEXTO_ENTRAR[m];
    $('tituloEntrar').textContent = t.titulo;
    $('abasEntrar').hidden = m !== 'entrar' && m !== 'criar';
    document.querySelectorAll('[data-entrar]').forEach((a) => a.setAttribute('aria-selected', String(a.dataset.entrar === m)));
    document.querySelectorAll('#formEntrar [data-campo]').forEach((n) => { n.hidden = !t.campos.includes(n.dataset.campo); });
    const nova = m === 'criar' || m === 'nova';
    $('rotEntSenha').textContent = m === 'nova' ? 'SENHA NOVA' : nova ? 'CRIE UMA SENHA' : 'SENHA';
    $('fEntSenha').autocomplete = nova ? 'new-password' : 'current-password';
    $('fEntSenha').placeholder = nova ? 'mínimo 6 caracteres' : '';
    $('txtEntrar').hidden = !t.txt;
    if (t.txt) $('txtEntrar').textContent = t.txt;
    $('btnEntrarJog').hidden = !t.botao;
    if (t.botao) $('btnEntrarJog').textContent = t.botao;
    $('btnCancelarEntrar').textContent = t.botao ? 'Cancelar' : 'Fechar';
    $('btnEsqueci').hidden = m !== 'entrar';
    $('erroEntrar').hidden = true;
  }
  function focoEntrar() {
    const campo = TEXTO_ENTRAR[modoEntrar].campos.map((c) => $({ nick: 'fEntNick', email: 'fEntEmail', senha: 'fEntSenha' }[c])).find((n) => !n.value);
    (campo || $('btnEntrarJog')).focus();
  }
  function abrirEntrar(m = 'entrar') {
    if (document.querySelector('dialog[open]')) document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    // quem tinha marcado "Sou eu" no aparelho (sistema antigo) já vem com o nick preenchido
    if (!$('fEntNick').value) { const k = lerEuAntigo(); if (k) $('fEntNick').value = k; }
    $('fEntSenha').value = '';
    trocarModoEntrar(m);
    $('dlgEntrar').showModal();
    focoEntrar();
  }
  function lerEuAntigo() { try { return localStorage.getItem('ranking_eu'); } catch (e) { return null; } }

  function msgLogin(error) {
    if (error.status === 429 || /rate limit|too many/i.test(error.message)) return 'Muitas tentativas agora. Espera um pouco e tenta de novo.';
    if (/invalid login credentials/i.test(error.message)) return 'E-mail ou senha errados.';
    if (/email not confirmed/i.test(error.message)) return 'Falta confirmar o e-mail: abra o link que mandamos (olhe no spam também).';
    if (/password/i.test(error.message) && /(least|short|weak)/i.test(error.message)) return 'A senha precisa ter pelo menos 6 caracteres.';
    if (/invalid.*email|email.*invalid/i.test(error.message)) return 'Esse e-mail não parece certo. Confere.';
    return 'Não deu certo agora. Tenta de novo.';
  }

  async function enviarEntrar(ev) {
    ev.preventDefault();
    const erro = $('erroEntrar');
    const falhar = (msg) => { erro.textContent = msg; erro.hidden = false; };
    erro.hidden = true;
    const m = modoEntrar;
    const campos = TEXTO_ENTRAR[m].campos;
    const email = $('fEntEmail').value.trim().toLowerCase();
    const senha = $('fEntSenha').value;
    const nick = limparNick($('fEntNick').value);
    if (campos.includes('nick') && !nick) return falhar('Escreve o seu nick no clã.');
    if (campos.includes('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return falhar('Escreve o seu e-mail.');
    if (campos.includes('senha')) {
      if (!senha) return falhar('Escreve a senha.');
      if ((m === 'criar' || m === 'nova') && senha.length < 6) return falhar('A senha precisa ter pelo menos 6 caracteres.');
    }
    const btn = $('btnEntrarJog');
    btn.disabled = true;
    try {
      if (m === 'entrar') await fazerLogin(email, senha, falhar);
      else if (m === 'criar') await criarConta(nick, email, senha, falhar);
      else if (m === 'esqueci') await esqueciSenha(email, falhar);
      else if (m === 'nova') await salvarSenhaNova(senha, falhar);
      else if (m === 'nick') await escolherNick(nick, falhar);
    } catch (e) {
      console.error(e);
      falhar('Não consegui agora. Confere a internet e tenta de novo.');
    } finally {
      btn.disabled = false;
    }
  }

  // demonstração: o nick digitado vira o jogador do elenco (ou pedido, se for novo)
  function demoNick(nick) { return jogadores.find((r) => chave(r.nick) === chave(nick)) || null; }
  function demoLer(c) {
    euId = c ? c.player : null;
    meuPedido = c && !c.player ? c.pedido : null;
    contaSemJogador = !!c && !c.player && !c.pedido;
  }

  async function fazerLogin(email, senha, falhar) {
    if (DEMO) {
      const c = demoContas.get(email);
      if (c ? c.senha !== senha : senha !== '1234') return falhar('E-mail ou senha errados. (Na demonstração, a senha é 1234.)');
      admin = c ? null : { nome: email.split('@')[0] };
      demoLer(c);
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password: senha });
      if (error) return falhar(msgLogin(error));
      await lerConta();
    }
    $('fEntSenha').value = '';
    $('dlgEntrar').close();
    await depoisDeEntrar();
  }
  // depois de entrar (senha ou link do e-mail): abre o site, ou mostra o que falta
  async function depoisDeEntrar(confirmou = false) {
    if (!podeVer()) {
      trancar();
      if (contaSemJogador) abrirEntrar('nick');
      else if (meuPedido && confirmou) toast('E-mail confirmado! Agora é só esperar um admin aprovar.');
      return;
    }
    try { if (euId) localStorage.removeItem('ranking_eu'); } catch (e) {}
    await abrirSite();
    const r = euId && jogPorId.get(euId);
    if (admin) {
      const n = pedidos.length;
      toast(`Bem-vindo, ${admin.nome}.` + (n ? ` ${n} ${n === 1 ? 'pedido esperando' : 'pedidos esperando'} aprovação em Jogadores.` : ' Área do admin liberada.'));
    } else if (r) {
      toast(confirmou ? `E-mail confirmado! Bem-vindo, ${comTag(r.nick)}.` : `Bem-vindo, ${comTag(r.nick)}!`);
    }
  }

  async function criarConta(nick, email, senha, falhar) {
    if (DEMO) {
      const r = demoNick(nick);
      if (r && [...demoContas.values()].some((c) => c.player === r.id)) return falhar('Esse nick já tem conta. Se é você, fala com um admin do clã.');
      if (demoContas.has(email)) return falhar('Esse e-mail já tem conta. Toque em "Entrar".');
      demoContas.set(email, { senha, player: null, pedido: nick });
    } else {
      const st = await sb.rpc('nick_status', { p_nick: nick });
      if (st.error) throw new Error(st.error.message);
      if (st.data === 'tem_login') return falhar('Esse nick já tem conta. Se é você, fala com um admin do clã.');
      const { data, error } = await sb.auth.signUp({
        email, password: senha,
        options: { emailRedirectTo: location.origin + location.pathname, data: { nick } },
      });
      if (error) {
        // o e-mail grátis do Supabase manda poucos por hora
        if (error.status === 429 || /rate limit/i.test(error.message)) return falhar('Muita gente se cadastrando agora e o e-mail de confirmação não saiu. Tenta de novo daqui a uma hora.');
        return falhar(msgLogin(error));
      }
      // e-mail que já tinha conta: o Supabase finge que deu certo, mas não manda nada
      if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) return falhar('Esse e-mail já tem conta. Toque em "Entrar".');
    }
    $('fEntSenha').value = '';
    trocarModoEntrar('enviado');
    $('txtEntrar').hidden = false;
    $('txtEntrar').replaceChildren('Mandamos um link pra ', el('b', { text: email }), '. Abra e toque nele pra confirmar (olhe no spam também).',
      ' Depois um admin do clã confere e libera a sua entrada.');
  }

  async function esqueciSenha(email, falhar) {
    if (!DEMO) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (error) return falhar(error.status === 429 || /rate limit/i.test(error.message) ? 'O e-mail não saiu agora (limite por hora). Tenta de novo mais tarde.' : msgLogin(error));
    }
    trocarModoEntrar('enviado');
    $('txtEntrar').hidden = false;
    $('txtEntrar').replaceChildren('Se ', el('b', { text: email }), ' tem conta, o link pra criar a senha nova chegou lá. Olhe no spam também.');
  }

  async function salvarSenhaNova(senha, falhar) {
    if (!DEMO) {
      const { error } = await sb.auth.updateUser({ password: senha });
      if (error) return falhar(/different from the old/i.test(error.message) ? 'Essa é a senha antiga. Escolha outra.' : msgLogin(error));
      await lerConta();
    }
    $('fEntSenha').value = '';
    $('dlgEntrar').close();
    toast('Senha nova salva!');
    if (podeVer() && siteAberto) { aplicarAdmin(admin); return; }
    await depoisDeEntrar();
  }

  async function escolherNick(nick, falhar) {
    let res;
    if (DEMO) {
      res = 'pedido';
      meuPedido = nick;
      const c = [...demoContas.values()].find((x) => !x.player && !x.pedido);
      if (c) c.pedido = nick;
    } else {
      const rv = await sb.rpc('jogador_pedir_nick', { p_nick: nick });
      if (rv.error) throw new Error(rv.error.message);
      res = rv.data;
      if (res === 'tem_login') return falhar('Esse nick já tem conta. Se é você, fala com um admin do clã.');
      if (res === 'pedido') meuPedido = nick;
      else return falhar('Não deu certo. Tenta de novo.');
    }
    contaSemJogador = false;
    $('dlgEntrar').close();
    await depoisDeEntrar();
    if (res === 'pedido') toast('Pedido enviado! Um admin do clã vai aprovar.');
  }

  // "Já fui aprovado": confere de novo sem precisar sair e entrar
  async function conferirPedido() {
    const btn = $('btnPortaoConferir');
    btn.disabled = true;
    try {
      if (DEMO) { const c = [...demoContas.values()].find((x) => x.pedido === meuPedido || (x.player && jogPorId.get(x.player) && chave(jogPorId.get(x.player).nick) === chave(meuPedido || ''))); demoLer(c); }
      else await lerConta();
      if (podeVer()) await depoisDeEntrar(); else { trancar(); toast('Ainda não foi aprovado. Tenta de novo mais tarde.'); }
    } catch (e) {
      console.error(e);
      toast('Não consegui conferir agora.', true);
    } finally {
      btn.disabled = false;
    }
  }

  async function sairConta() {
    await sairDaConta();
    toast('Você saiu.');
  }

  // ---------- admin: quem já tem login e quem pediu pra entrar ----------
  async function carregarLogins() {
    if (DEMO) { pedidos = [...demoContas.entries()].filter(([, c]) => c.pedido).map(([email, c]) => ({ user_id: email, email, nick: c.pedido, created_at: new Date().toISOString() })); renderPedidos(); return; }
    if (!admin) return;
    const [r, rp] = await Promise.all([sb.rpc('admin_logins'), sb.rpc('admin_pedidos')]);
    if (r.error) console.warn('logins:', r.error.message);
    else logins = new Map((r.data || []).map((x) => [x.player_id, x]));
    if (rp.error) console.warn('pedidos:', rp.error.message);
    else pedidos = rp.data || [];
    renderPedidos();
    if ($('dlgJogador').open && editJog) renderLoginJog(editJog);
  }
  // cada pedido: quem é (e-mail), o nick que digitou e de quem é o perfil (o admin confere e escolhe)
  function renderPedidos() {
    const box = $('pedidos');
    box.hidden = !admin;
    if (box.hidden) return;
    $('qtdPedidos').textContent = pedidos.length || '';
    $('qtdPedidos').hidden = !pedidos.length;
    if (!pedidos.length) { $('listaPedidos').replaceChildren(el('li', { class: 'pedido-vazio', text: 'Nenhum pedido esperando.' })); return; }
    const qtdPartidas = (r) => partidas.filter((x) => chave(x.player) === chave(r.nick)).length;
    // perfis que ainda não têm dono, quem está no clã primeiro
    const livres = jogadores.filter((r) => !loginDe(r.id)).sort((a, b) => (b.ativo - a.ativo) || a.nick.localeCompare(b.nick, 'pt-BR'));
    $('listaPedidos').replaceChildren(...pedidos.map((p) => {
      const nick = limparNick(p.nick);
      const igual = elenco.get(chave(nick));
      const sel = el('select', { class: 'pedido-perfil', 'aria-label': `Perfil de ${p.email}` },
        el('option', { value: '', text: `Jogador novo: ${nick}` }),
        ...livres.map((r) => { const n = qtdPartidas(r); return el('option', { value: r.id, text: `${r.nick}${n ? ` · ${n} ${n === 1 ? 'partida' : 'partidas'}` : ''}${r.ativo ? '' : ' · ex-membro'}` }); }));
      if (igual && !loginDe(igual.id)) sel.value = igual.id;
      const aviso = el('small', { class: 'pedido-aviso' });
      const avisar = () => {
        const r = jogPorId.get(sel.value);
        aviso.textContent = r ? `Vai ficar com o perfil de ${comTag(r.nick)}${qtdPartidas(r) ? ' e as partidas dele' : ''}. Confere se é ele mesmo.` : 'Entra no elenco como jogador novo.';
      };
      sel.addEventListener('change', avisar);
      avisar();
      return el('li', { class: 'pedido' },
        el('div', { class: 'pedido-txt' },
          el('b', { text: p.email }),
          el('small', { text: `Digitou ${comTag(nick)}${igual && loginDe(igual.id) ? ' (esse já tem dono)' : ''} · ${haQuanto(p.created_at)}` })),
        el('label', { class: 'pedido-campo' }, el('span', { text: 'PERFIL' }), sel),
        aviso,
        el('div', { class: 'pedido-btns' },
          el('button', { type: 'button', class: 'btn btn-perigo-sec', onclick: () => confirmar('RECUSAR PEDIDO?', `${p.email} não entra no site e a conta é apagada.`, 'Recusar', () => responderPedido(p, false)) }, 'Recusar'),
          el('button', { type: 'button', class: 'btn btn-pri', onclick: (e) => { e.currentTarget.disabled = true; responderPedido(p, true, sel.value || null); } }, 'Aprovar')));
    }));
  }
  async function responderPedido(p, aprovar, perfil = null) {
    try {
      if (DEMO) {
        const c = demoContas.get(p.user_id);
        if (aprovar) {
          let id = perfil;
          if (!id) {
            id = 'dj' + (jogadores.length + 10);
            jogadores.push({ id, nick: limparNick(p.nick), cargo: CARGO_PADRAO, ativo: true, created_at: new Date().toISOString() });
            indexarElenco();
          }
          c.player = id; c.pedido = null;
        } else demoContas.delete(p.user_id);
      } else {
        if (aprovar) {
          const res = await rpcAdmin('admin_aprovar_pedido', { p_user: p.user_id, p_player: perfil });
          if (res === 'tem_login') { toast('Esse perfil já tem conta de outra pessoa. Escolha outro ou tire o login dele antes.', true); await carregarLogins(); return; }
        } else await rpcAdmin('admin_recusar_pedido', { p_user: p.user_id });
        await carregar();
      }
      await carregarLogins();
      render();
      const dono = perfil && jogPorId.get(perfil);
      toast(aprovar ? `${p.email} aprovado como ${comTag(dono ? dono.nick : limparNick(p.nick))}. Já pode entrar.` : 'Pedido recusado.');
    } catch (e) {
      console.error(e);
      if (!erroSessao(e)) { toast('Não deu agora. Tenta de novo.', true); renderPedidos(); }
    }
  }

  function loginDe(id) {
    if (!DEMO) return logins.get(id) || null;
    const e = [...demoContas.entries()].find(([, c]) => c.player === id);
    return e ? { email: e[0], admin: false, ultimo_acesso: null } : null;
  }
  function renderLoginJog(r) {
    const l = loginDe(r.id);
    $('jogLogin').hidden = !r.id;
    $('jogLoginTxt').replaceChildren(...(l
      ? [el('b', { text: l.email }), l.admin ? ' · conta de admin' : '', l.ultimo_acesso ? ` · entrou ${haQuanto(l.ultimo_acesso)}` : '']
      : ['Ainda não criou a conta.']));
    $('btnTirarLogin').hidden = !l;
    $('btnTirarLogin').textContent = 'Tirar login';
    confirmarTirar = false;
    // admin que também joga: liga a própria conta ao jogador dele
    $('btnSouEuAdmin').hidden = DEMO || !!l || !!euId;
  }

  let confirmarTirar = false;
  async function tirarLogin() {
    const r = editJog;
    if (!r) return;
    if (!confirmarTirar) { confirmarTirar = true; $('btnTirarLogin').textContent = 'Toque de novo pra tirar'; return; }
    try {
      if (DEMO) {
        for (const c of demoContas.values()) if (c.player === r.id) c.player = null;
      } else {
        await rpcAdmin('admin_tirar_login', { p_player: r.id });
        await carregarLogins();
      }
      if (euId === r.id) euId = null;
      renderLoginJog(r);
      render();
      toast(`${comTag(r.nick)} ficou sem login. Quem tinha a conta escolhe outro nick ao entrar.`);
    } catch (e) {
      console.error(e);
      if (erroSessao(e)) { $('dlgJogador').close(); return; }
      erroJogador('Não deu agora. (' + (e.message || 'erro') + ')');
    }
  }

  async function souEuAdmin() {
    const r = editJog;
    if (!r) return;
    try {
      const res = await rpcAdmin('jogador_vincular', { p_player: r.id });
      if (res === 'tem_login') return erroJogador('Esse jogador já tem conta própria.');
      if (res !== 'ok') throw new Error(res);
      euId = r.id;
      await carregarLogins();
      renderLoginJog(r);
      render();
      toast(`Sua conta agora é a de ${comTag(r.nick)}. "Meu perfil" fica no topo.`);
    } catch (e) {
      console.error(e);
      if (erroSessao(e)) { $('dlgJogador').close(); return; }
      erroJogador('Não deu agora. (' + (e.message || 'erro') + ')');
    }
  }

  // ---------- dados ----------
  // o Supabase entrega no máximo 1000 linhas por vez; lê em páginas pra não cortar ninguém
  async function lerTudo(consulta) {
    const todos = [];
    for (let de = 0; de < 50000; de += 1000) {
      const r = await consulta().range(de, de + 999);
      if (r.error) return r;
      todos.push(...(r.data || []));
      if (!r.data || r.data.length < 1000) break;
    }
    return { data: todos, error: null };
  }

  async function carregar() {
    if (DEMO) return;
    const [r, rj, rt, rl] = await Promise.all([
      lerTudo(() => sb.from('scores').select('id, player, mass, print_path, created_at').order('created_at', { ascending: false }).order('id')),
      lerTudo(() => sb.from('players').select('id, nick, cargo, ativo, created_at').order('nick').order('id')),
      lerTudo(() => sb.from('torneios').select('*').order('inicio', { ascending: false }).order('id')),
      lerTudo(() => sb.from('torneio_lancamentos').select('id, torneio_id, player_id, valor, nota, print_path, created_at').order('created_at', { ascending: false }).order('id')),
    ]);
    if (r.error) throw new Error(r.error.message);
    partidas = r.data || [];
    // sem a tabela players (script novo ainda não rodado) o site continua funcionando
    elencoOk = !rj.error;
    if (rj.error) console.warn('elenco:', rj.error.message);
    jogadores = rj.data || [];
    indexarElenco();
    // mesma coisa com os torneios: sem as tabelas, a seção só some
    torneiosOk = !rt.error && !rl.error;
    if (!torneiosOk) console.warn('torneios:', (rt.error || rl.error).message);
    torneios = (rt.data || []).map((t) => ({ ...t, participantes: t.participantes || [], premios: t.premios || [] }));
    lancamentos = rl.data || [];
  }

  function dadosDemo() {
    const h = (horas) => new Date(Date.now() - horas * 3600 * 1000).toISOString();
    const lista = [
      ['VENO', 112430, 2], ['Mamba', 15400, 5], ['VETERANO', 18420, 9], ['Kaiser', 27800, 20], ['Shawdow', 104210, 30],
      ['VETERANO', 52040, 48], ['Kaiser', 35100, 70], ['VENO', 61877, 80], ['Mamba', 9800, 100], ['VETERANO', 41902, 120],
      ['Shawdow', 54105, 150], ['Mamba', 25300, 170], ['VENO', 101990, 200], ['Kaiser', 12900, 230], ['Shawdow', 22310, 260],
      ['VETERANO', 33700, 300], ['VENO', 104500, 320], ['Shawdow', 66780, 350], ['VENO', 58200, 400], ['Shawdow', 51200, 450],
      ['VENO', 73400, 500], ['Shawdow', 30100, 560], ['VETERANO', 26700, 600], ['VENO', 120880, 640],
      ['Shawdow', 215000, 1000], ['Kaiser', 88000, 1100], ['Shawdow', 78000, 1200], ['VENO', 64000, 1300],
      ['Mamba', 47000, 1500], ['Kaiser', 39000, 1600], ['VETERANO', 31000, 1700],
      // Shawdow passa de 10.000 pts: mostra a patente Diamantes no modo demonstração
      ['Shawdow', 1000000, 1250], ['Shawdow', 980000, 1300], ['Shawdow', 1000000, 1350], ['Shawdow', 990000, 1400], ['Shawdow', 1000000, 1450], ['Shawdow', 1000000, 1550],
    ];
    return lista.map(([player, mass, horas], i) => ({ id: 'd' + i, player, mass, created_at: h(horas) }));
  }
  function elencoDemo() {
    const d = (dias) => new Date(Date.now() - dias * 86400000).toISOString();
    return [
      ['VENO', 'Líder', true, 60], ['Shawdow', 'Vice-líder', true, 55], ['VETERANO', 'Membro', true, 50], ['Kaiser', 'Membro', true, 40],
      ['Mamba', 'Membro', true, 30], ['Naja', 'Membro', true, 6], ['Cascavel', 'Membro', true, 2], ['Sucuri', 'Membro', false, 45],
    ].map(([nick, cargo, ativo, dias], i) => ({ id: 'dj' + i, nick, cargo, ativo, created_at: d(dias) }));
  }
  // dj0 VENO · dj1 Shawdow · dj2 VETERANO · dj3 Kaiser · dj4 Mamba · dj5 Naja · dj6 Cascavel
  function torneiosDemo() {
    const h = (horas) => new Date(Date.now() + horas * 3600 * 1000).toISOString();
    const base = { unidade: '', auto: true, qtd: null, meta: null, semente: 'ranking', fim: null, encerrado_em: null, todos: true, participantes: [], premios: [], regras: '', chave: null, publicado: true, base: 'geral', podio: [] };
    const lista = [
      { ...base, id: 'dt1', nome: 'Copa COBR de Outubro', formato: 'soma', metrica: 'pontos', inicio: h(-240), fim: h(53.2),
        premios: ['Cargo Elite por 1 mês', 'Destaque no grupo', 'Respeito'], regras: 'Só vale partida com print mostrando o nick com a tag.\nQuem for pego com print editado é eliminado.' },
      { ...base, id: 'dt2', nome: 'X1 dos Brabos', formato: 'mata', metrica: 'custom', unidade: 'kills', auto: false, inicio: h(-48), fim: h(120), todos: false,
        participantes: ['dj0', 'dj1', 'dj2', 'dj3', 'dj4', 'dj5'], premios: ['Título de Brabo do Clã', 'Vice-Brabo'],
        regras: 'Duelo na mesma sala, 10 minutos. Vence quem matar mais.',
        chave: { slots: ['dj0', null, 'dj2', 'dj4', 'dj1', null, 'dj3', 'dj5'], em: h(-47), res: {
          '0-1': { a: 'dj2', b: 'dj4', va: 14, vb: 9, v: 'dj2' },
          '0-3': { a: 'dj3', b: 'dj5', va: 7, vb: 11, v: 'dj5' },
          '1-0': { a: 'dj0', b: 'dj2', va: 18, vb: 12, v: 'dj0' },
        } } },
      { ...base, id: 'dt3', nome: 'Caça às Kills', formato: 'melhores', metrica: 'custom', unidade: 'kills', auto: false, qtd: 3, inicio: h(-30), fim: h(90), todos: false,
        participantes: ['dj0', 'dj1', 'dj3', 'dj5', 'dj6'], premios: ['Skin escolhida pelo campeão'] },
      { ...base, id: 'dt4', nome: 'Rei da Massa', formato: 'melhor', metrica: 'massa', inicio: h(74), fim: h(242), premios: ['Coroa no nick por 1 semana'] },
      { ...base, id: 'dt6', nome: 'Rei das 21h', formato: 'hora', metrica: 'pontos', base: 'semana', inicio: h(-30), fim: h(-1.5), premios: ['Cargo Elite por 1 semana', 'Destaque no grupo'] },
      { ...base, id: 'dt7', nome: 'Primeiro da Sala', formato: 'livre', inicio: h(-6), fim: null, todos: true, podio: ['dj1', 'dj3'],
        regras: 'Às 22h em ponto, quem estiver em 1º no placar da sala do clã é o campeão. Vale print com o horário aparecendo.', premios: ['Coroa no nick por 1 semana'] },
      { ...base, id: 'dt8', nome: 'Topo da Temporada às 23h', formato: 'hora', metrica: 'pontos', base: 'mes', inicio: h(-2), fim: h(4.5) },
      { ...base, id: 'dt9', nome: 'Desafio do Dono', formato: 'livre', inicio: h(-3), fim: h(20), todos: false, participantes: ['dj0', 'dj2', 'dj4', 'dj5'],
        regras: 'Quem fizer mais kills usando só a skin padrão. Manda o print pro dono até o fim do dia.' },
      { ...base, id: 'dt5', nome: 'Corrida dos 250K', formato: 'meta', metrica: 'massa', meta: 250000, inicio: h(-1680), fim: h(-720), premios: ['Cargo Vice-líder honorário'] },
    ];
    const lanc = [['dt3', 'dj0', 12, -26], ['dt3', 'dj1', 15, -20], ['dt3', 'dj5', 9, -18], ['dt3', 'dj0', 8, -12], ['dt3', 'dj5', 11, -9], ['dt3', 'dj5', 4, -6], ['dt3', 'dj3', 6, -3], ['dt3', 'dj0', 13, -1]]
      .map(([torneio_id, player_id, valor, horas], i) => ({ id: 'dl' + i, torneio_id, player_id, valor, nota: i % 3 === 0 ? 'sala lotada' : '', print_path: null, created_at: h(horas) }));
    return { lista, lanc };
  }

  let realtimeOk = false;
  function ligarTempoReal() {
    const aoVivo = $('aoVivo');
    if (DEMO) { aoVivo.lastChild.textContent = 'demonstração'; return; }
    let espera;
    const recarregar = () => {
      clearTimeout(espera);
      espera = setTimeout(() => { if (podeVer()) carregar().then(render).catch(() => {}); }, 400);
    };
    sb.channel('scores-ao-vivo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, recarregar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, recarregar)
      .subscribe((status) => {
        realtimeOk = status === 'SUBSCRIBED';
        aoVivo.classList.toggle('on', realtimeOk);
      });
    // canal separado: se as tabelas de torneio ainda não existem, não derruba o do ranking
    if (torneiosOk) {
      sb.channel('torneios-ao-vivo')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'torneios' }, recarregar)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'torneio_lancamentos' }, recarregar)
        .subscribe();
    }
    // reserva: atualiza a cada minuto mesmo sem tempo real
    setInterval(() => {
      if (document.hidden || !podeVer()) return;
      carregar().then(render).catch(() => {});
      if (admin) carregarLogins().catch(() => {});
    }, 60000);
  }

  // ---------- chat do clã ----------
  // Só membro lê e fala (o banco confere, passo 7 do SQL). Mensagens, reações, bonde e "tô jogando"
  // chegam ao vivo; quem está com o site aberto aparece online (presença do Supabase).
  // A moderação é do ADM: apaga, fixa, silencia, tira do chat e resolve as denúncias.
  const ICONE_HASH = '<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>';
  const ICONE_BONDE = '<path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><path d="M17.3 5H6.7a4 4 0 0 0-4 3.6l-.7 6.5A2.7 2.7 0 0 0 6.6 17l2.1-2h6.6l2.1 2a2.7 2.7 0 0 0 4.6-1.9l-.7-6.5A4 4 0 0 0 17.3 5z"/>';
  const ICONE_CHAMA = '<path d="M12 22c4 0 7-3 7-7 0-5-4-6-5-11-3 2-4 5-4 8-1-1-2-2-2-4-2 2-3 4-3 7 0 4 3 7 7 7z"/>';
  const ICONE_MEGAFONE = '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 9a3 3 0 0 1 0 6M18 6a7 7 0 0 1 0 12"/>';
  const ICONE_TRAVA = '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>';
  const ICONE_ENVIAR = '<path d="M4 12 20 4l-4 16-4-7z"/><path d="M12 13 20 4"/>';
  const ICONE_SORRISO = '<circle cx="12" cy="12" r="9"/><path d="M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>';
  const ICONE_RESPONDER = '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v4"/>';
  const ICONE_FIXAR = '<path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4z"/>';
  const ICONE_GENTE = '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-5-6.7"/>';
  const ICONE_CITA = '<path d="M4 4v7a4 4 0 0 0 4 4h12"/><path d="M16 11l4 4-4 4"/>';
  const ICONE_MUDO = '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/>';
  const ICONE_MODERAR = '<path d="M12 3l8 3.5v5.5c0 4.5-3.4 8-8 9.5-4.6-1.5-8-5-8-9.5V6.5z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>';
  const ICONE_SETA = '<path d="M5 12h14M13 6l6 6-6 6"/>';
  const ICONE_DESCE = '<path d="M12 5v14M6 13l6 6 6-6"/>';
  const CANAIS_CHAT = [
    { id: 'geral', nome: 'geral', ico: ICONE_HASH, vazio: 'Manda o primeiro oi pro clã.' },
    { id: 'bonde', nome: 'bonde', ico: ICONE_BONDE, vazio: 'Toque no controle pra chamar o bonde.' },
    { id: 'recordes', nome: 'recordes', ico: ICONE_CHAMA, soSite: true, vazio: 'Cada massa registrada aparece aqui.' },
    { id: 'avisos', nome: 'avisos', ico: ICONE_MEGAFONE, soAdm: true, vazio: 'Nenhum aviso ainda.' },
  ];
  const REACOES_CHAT = ['🔥', '😂', '💀', '👑', '🐍', '💯', '👍', 'GG'];
  const POR_CANAL = 80;               // mensagens que carrega de cada canal
  const BONDE_DURA = 3 * 3600000;     // depois disso o bonde fecha
  const chat = {
    ligado: false, eu: null, canal: 'geral', resp: null, rt: null, presenca: null, conectou: false,
    msgs: Object.fromEntries(CANAIS_CHAT.map((c) => [c.id, []])),
    porId: new Map(),                 // id -> mensagem
    reac: new Map(),                  // id -> Map(emoji -> Set(user_id))
    bonde: new Map(),                 // id -> [{ user_id, player_id, nome }]
    status: new Map(),                // user_id -> { player_id, nome, jogando_ate }
    online: new Map(),                // user_id -> { player_id, nome, adm }
    digitando: new Map(), lido: {}, novas: 0, denuncias: 0,
  };
  const euChat = () => (chat.eu && chat.eu.user_id) || null;
  const admChat = () => !!(chat.eu && chat.eu.adm);
  const canalChat = (id) => CANAIS_CHAT.find((c) => c.id === id);
  const horaChat = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nickDoPlayer = (pid, nome) => (pid && jogPorId.get(pid) ? jogPorId.get(pid).nick : nome || 'Membro');
  const nickMsg = (m) => (m.tipo === 'massa' ? 'COBR' : nickDoPlayer(m.player_id, m.nome));
  const meuNick = () => (chat.eu ? nickDoPlayer(chat.eu.player_id, chat.eu.nome) : '');
  const jogandoAte = (s) => (s && s.jogando_ate && Date.parse(s.jogando_ate) > Date.now() ? s.jogando_ate : null);
  function punicaoAtiva() {
    const p = chat.eu && chat.eu.punicao;
    return p && (!p.ate || Date.parse(p.ate) > Date.now()) ? p : null;
  }
  const foraDoChat = () => { const p = punicaoAtiva(); return !!p && p.tipo === 'ban'; };
  function ateTxt(iso) {
    if (!iso) return 'até o ADM liberar';
    const d = new Date(iso);
    return d.toDateString() === new Date().toDateString() ? `até ${horaChat(iso)}` : `até ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${horaChat(iso)}`;
  }
  function rotDia(iso) {
    const d = new Date(iso).toDateString(), ontem = new Date(Date.now() - 86400000).toDateString();
    return d === new Date().toDateString() ? 'HOJE' : d === ontem ? 'ONTEM' : dataCurta(iso).toUpperCase();
  }
  const meMarcou = (m) => !!m.txt && !!meuNick() && new RegExp('@' + escRe(meuNick()) + '(?![\\p{L}\\p{N}_])', 'iu').test(m.txt);
  const chatVisivel = () => pagAtual === 'chat' && !perfilAtual && !torneioAtual && !document.hidden && !document.body.classList.contains('trancado');
  const podeFalar = (c) => !!chat.eu && !punicaoAtiva() && !canalChat(c).soSite && (!canalChat(c).soAdm || admChat());

  // ---------- falar com o banco (na demonstração tudo fica só nesta tela) ----------
  async function chatRpc(nome, args) {
    if (DEMO) return demoChatRpc(nome, args);
    const r = await sb.rpc(nome, args);
    if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
    return r.data;
  }
  function erroChat(e) {
    const t = String((e && e.message) || '');
    if (/silenciado/.test(t)) { toast('Você está silenciado no chat.', true); recarregarEuChat(); }
    else if (/devagar/.test(t)) toast('Calma! Espera uns segundos pra mandar de novo.', true);
    else if ((e && e.code === '42501') || /acesso negado/.test(t)) toast('Sem permissão pra isso.', true);
    else toast('Não deu agora. Tenta de novo.', true);
  }

  // ---------- carregar ----------
  function limparChat() {
    for (const c of CANAIS_CHAT) chat.msgs[c.id] = [];
    chat.porId.clear(); chat.reac.clear(); chat.bonde.clear(); chat.status.clear(); chat.digitando.clear();
    chat.resp = null; chat.novas = 0; chat.denuncias = 0;
  }
  function guardarMsg(m) {
    chat.porId.set(m.id, m);
    const l = chat.msgs[m.canal];
    let i = l.length;
    while (i > 0 && l[i - 1].id > m.id) i--;
    l.splice(i, 0, m);
    return i;
  }
  async function carregarChat() {
    if (DEMO) { demoChatSemear(); return depoisDeCarregarChat(); }
    const re = await sb.rpc('chat_eu');
    if (re.error) throw new Error(re.error.message);
    chat.eu = re.data;
    limparChat();
    if (!foraDoChat()) {
      const rs = await Promise.all(CANAIS_CHAT.map((c) => sb.from('chat_mensagens').select('*').eq('canal', c.id).order('id', { ascending: false }).limit(POR_CANAL)));
      for (const r of rs) {
        if (r.error) throw new Error(r.error.message);
        for (const m of r.data) guardarMsg(m);
      }
      const ids = [...chat.porId.keys()], bondes = ids.filter((id) => chat.porId.get(id).tipo === 'bonde');
      const [rr, rb, rst] = await Promise.all([
        ids.length ? sb.from('chat_reacoes').select('msg_id, user_id, emoji').in('msg_id', ids) : { data: [] },
        bondes.length ? sb.from('chat_bonde').select('msg_id, user_id, player_id, nome').in('msg_id', bondes).order('created_at') : { data: [] },
        sb.from('chat_status').select('user_id, player_id, nome, jogando_ate').gt('jogando_ate', new Date().toISOString()),
      ]);
      for (const r of rr.data || []) mexerReac(r.msg_id, r.emoji, r.user_id, true, false);
      for (const b of rb.data || []) mexerBonde(b, true, false);
      for (const s of rst.data || []) chat.status.set(s.user_id, s);
      if (admChat()) await contarDenuncias(false);
    }
    depoisDeCarregarChat();
  }
  function depoisDeCarregarChat() {
    lerLidosChat();
    atualizarBadgesChat();
    if (chatVisivel()) desenharChat();
  }
  async function recarregarEuChat() {
    if (DEMO) return;
    const antes = foraDoChat();
    const re = await sb.rpc('chat_eu');
    if (re.error) return;
    chat.eu = re.data;
    if (antes !== foraDoChat()) { carregarChat().catch(() => {}); return; }
    if (chatVisivel()) { desenharComporChat(); desenharTopoChat(); desenharMsgsChat(); }
  }
  async function contarDenuncias(redesenhar = true) {
    if (DEMO) { chat.denuncias = new Set(demoChat.denuncias.map((d) => d.msg_id)).size; }
    else {
      const r = await sb.from('chat_denuncias').select('msg_id');
      chat.denuncias = r.error ? 0 : new Set(r.data.map((d) => d.msg_id)).size;
    }
    if (redesenhar && chatVisivel()) desenharTopoChat();
  }

  // ---------- ao vivo ----------
  function ligarChat() {
    if (chat.ligado) return;
    chat.ligado = true;
    carregarChat()
      .then(() => { if (!DEMO) ligarChatAoVivo(); })
      .catch((e) => { console.warn('chat:', e.message); chat.ligado = false; });
  }
  function ligarChatAoVivo() {
    const tabela = (t, fn) => ['postgres_changes', { event: '*', schema: 'public', table: t }, fn];
    chat.rt = sb.channel('chat-ao-vivo')
      .on(...tabela('chat_mensagens', (p) => { if (p.eventType === 'DELETE') sumiuMsg(p.old.id); else chegouMsg(p.new); }))
      .on(...tabela('chat_reacoes', (p) => { const r = p.eventType === 'DELETE' ? p.old : p.new; mexerReac(r.msg_id, r.emoji, r.user_id, p.eventType !== 'DELETE'); }))
      .on(...tabela('chat_bonde', (p) => mexerBonde(p.eventType === 'DELETE' ? p.old : p.new, p.eventType !== 'DELETE')))
      .on(...tabela('chat_status', (p) => { if (p.new && p.new.user_id) { chat.status.set(p.new.user_id, p.new); if (chatVisivel()) { desenharMembrosChat(); desenharTopoChat(); } } }))
      .on(...tabela('chat_punicoes', () => { recarregarEuChat(); if (admChat() && $('dlgModeracao').open) abrirModeracao(); }))
      .on(...tabela('chat_denuncias', (p) => {
        if (!admChat()) return;
        contarDenuncias();
        if (p.eventType === 'INSERT') toast('Nova denúncia no chat. Veja em Moderação.');
        if ($('dlgModeracao').open) abrirModeracao();
      }))
      .subscribe((st) => {
        if (st !== 'SUBSCRIBED') return;
        // voltou depois de cair (celular em segundo plano): pega o que chegou nesse meio tempo
        if (chat.conectou) carregarChat().catch(() => {});
        chat.conectou = true;
      });
    const pr = sb.channel('chat-online', { config: { presence: { key: euChat() } } });
    pr.on('presence', { event: 'sync' }, () => {
      chat.online = new Map(Object.entries(pr.presenceState()).map(([k, l]) => [k, l[0] || {}]));
      if (chatVisivel()) desenharMembrosChat();
    })
      .on('broadcast', { event: 'digitando' }, ({ payload }) => alguemDigitando(payload))
      .subscribe((st) => { if (st === 'SUBSCRIBED') pr.track({ player_id: chat.eu.player_id, nome: meuNick(), adm: chat.eu.adm }); });
    chat.presenca = pr;
  }
  function desligarChat() {
    if (sb && chat.rt) sb.removeChannel(chat.rt);
    if (sb && chat.presenca) sb.removeChannel(chat.presenca);
    chat.rt = null; chat.presenca = null; chat.conectou = false; chat.ligado = false; chat.eu = null;
    chat.online.clear();
    limparChat();
    atualizarBadgesChat();
  }

  function chegouMsg(m) {
    if (chat.porId.has(m.id)) { atualizarMsg(m); return; }
    if (!chat.msgs[m.canal]) return;
    if (m.fixada) for (const x of chat.msgs[m.canal]) x.fixada = false;
    chat.digitando.delete(m.user_id);
    const i = guardarMsg(m), l = chat.msgs[m.canal];
    const meu = !!m.user_id && m.user_id === euChat();
    if (chatVisivel() && chat.canal === m.canal) {
      if (i !== l.length - 1) { desenharMsgsChat(); return; }
      const box = $('chatMsgs'), fim = pertoDoFimChat() || meu;
      const ant = l[i - 1];
      if (!ant) box.replaceChildren();
      if (!ant || new Date(ant.created_at).toDateString() !== new Date(m.created_at).toDateString()) box.append(el('div', { class: 'ch-dia', text: rotDia(m.created_at) }));
      if (m.tipo === 'massa') m._conta = true;
      const n = linhaChat(m, ant && new Date(ant.created_at).toDateString() === new Date(m.created_at).toDateString() ? ant : null);
      n.classList.add('entra');
      box.append(n);
      if (fim) { descerChat(true); marcarLidoChat(); } else mostrarNovasChat();
      desenharDigitando();
      if (m.fixada) desenharFixadaChat();
    } else if (!meu && meMarcou(m)) {
      toast(`${nickMsg(m)} te marcou no #${m.canal}`);
    }
    atualizarBadgesChat();
  }
  function atualizarMsg(novo) {
    const m = chat.porId.get(novo.id);
    if (!m) return;
    if (novo.fixada && !m.fixada) for (const x of chat.msgs[m.canal]) x.fixada = false;
    Object.assign(m, novo);
    if (m.apagada) chat.reac.delete(m.id);
    trocarLinhaChat(m);
    if (chatVisivel() && chat.canal === m.canal) desenharFixadaChat();
    atualizarBadgesChat();
  }
  function sumiuMsg(id) {
    const m = chat.porId.get(id);
    if (!m) return;
    chat.porId.delete(id);
    chat.msgs[m.canal] = chat.msgs[m.canal].filter((x) => x.id !== id);
    if (chatVisivel() && chat.canal === m.canal) desenharMsgsChat();
    atualizarBadgesChat();
  }
  function mexerReac(id, emoji, user, liga, redesenhar = true) {
    let r = chat.reac.get(id);
    if (!r) chat.reac.set(id, (r = new Map()));
    let s = r.get(emoji);
    if (!s) { s = new Set(); r.set(emoji, s); }
    const tinha = s.has(user);
    if (liga) s.add(user); else s.delete(user);
    if (redesenhar && tinha !== liga && chat.porId.has(id)) trocarLinhaChat(chat.porId.get(id), liga ? emoji : null);
  }
  function mexerBonde(b, entra, redesenhar = true) {
    const l = (chat.bonde.get(b.msg_id) || []).filter((x) => x.user_id !== b.user_id);
    if (entra) l.push({ user_id: b.user_id, player_id: b.player_id, nome: b.nome });
    chat.bonde.set(b.msg_id, l);
    if (redesenhar && chat.porId.has(b.msg_id)) trocarLinhaChat(chat.porId.get(b.msg_id));
  }

  // ---------- não lidas (guardado neste aparelho) ----------
  function lerLidosChat() {
    let salvo = null;
    try { salvo = JSON.parse(localStorage.getItem('chat_lido_' + euChat()) || 'null'); } catch (e) {}
    chat.lido = salvo || {};
    // primeira vez neste aparelho: começa sem nada pendente
    for (const c of CANAIS_CHAT) if (!(c.id in chat.lido)) { const l = chat.msgs[c.id]; chat.lido[c.id] = l.length ? l[l.length - 1].id : 0; }
    salvarLidosChat();
  }
  function salvarLidosChat() { try { localStorage.setItem('chat_lido_' + euChat(), JSON.stringify(chat.lido)); } catch (e) {} }
  const naoLidasChat = (c) => chat.msgs[c].filter((m) => m.id > (chat.lido[c] || 0) && m.user_id !== euChat() && !m.apagada).length;
  function marcarLidoChat() {
    if (!chatVisivel()) return;
    const l = chat.msgs[chat.canal];
    const ult = l.length ? l[l.length - 1].id : 0;
    if ((chat.lido[chat.canal] || 0) >= ult) return;
    chat.lido[chat.canal] = ult;
    salvarLidosChat();
    atualizarBadgesChat();
  }
  function atualizarBadgesChat() {
    const total = chat.eu ? CANAIS_CHAT.reduce((s, c) => s + naoLidasChat(c.id), 0) : 0;
    document.querySelectorAll('[data-badge-chat]').forEach((b) => { b.hidden = !total; b.textContent = total > 99 ? '99+' : String(total); });
    if (chatVisivel()) desenharCanaisChat();
  }

  // ---------- desenho ----------
  function avatarChat(nick, tam = '') {
    if (nick === 'COBR') { const a = el('span', { class: `av av-bot ${tam}`, 'aria-hidden': 'true' }); a.append(el('img', { src: 'logo-cobr.webp', alt: '' })); return a; }
    return avatarDe(nick, ptsPat(chave(nick)), tam);
  }
  function escudoDe(p, letra, tam = 'av-m') {
    if (!p.nivel) return el('span', { class: `av ${tam}`, style: `--pc:${p.cor}`, 'aria-hidden': 'true', text: letra });
    const a = el('span', { class: `av av-esc ${tam} ${p.diamante ? 'esc-dia' : ''}`, style: `--pc:${p.cor}`, 'aria-hidden': 'true' });
    a.innerHTML = escudoSVG(p, letra);
    return a;
  }
  function tagsChat(m, nick) {
    if (nick === 'COBR') return [el('span', { class: 'ch-tag ch-tag-bot', text: 'AUTOMÁTICO' })];
    const k = chave(nick), r = m.player_id && jogPorId.get(m.player_id);
    const lider = r && /l[ií]der/i.test(r.cargo || '') ? r.cargo : null;
    return [chipPatente(ptsPat(k)), chipRei(k),
      lider ? el('span', { class: 'ch-tag ch-tag-lider', text: lider.toUpperCase() }) : null,
      m.adm ? el('span', { class: 'ch-tag ch-tag-adm', text: 'ADM' }) : null];
  }
  function textoChat(txt) {
    const s = el('div', { class: 'ch-txt' });
    const eu = chave(meuNick());
    for (const parte of String(txt || '').split(/(@[\p{L}\p{N}_.-]+)/u)) {
      const k = parte.startsWith('@') ? chave(parte.slice(1)) : null;
      if (k && elenco.has(k)) s.append(el('span', { class: `ch-mencao ${k === eu ? 'eu' : ''}`, text: parte }));
      else if (parte) s.append(parte);
    }
    return s;
  }
  function resumoChat(m) {
    if (m.apagada) return 'mensagem apagada';
    if (m.tipo === 'massa') return `${nomeDe(chave(m.dados.player || ''), m.dados.player || '')} fez ${fmt(m.dados.mass || 0)} de massa`;
    if (m.tipo === 'bonde') return `bonde · ${(m.dados && m.dados.srv) || 'Servidor BR'}`;
    return m.txt;
  }
  // a partida dessa massa fez o jogador subir de patente na temporada?
  function subidaDe(id) {
    const p = partidas.find((x) => x.id === id);
    if (!p) return null;
    const k = chave(p.player), t = Date.parse(p.created_at), d = new Date(t);
    const x = patTemp(k, t), desde = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    let antes = PATENTES[x ? x.ini : 0].pontos;
    for (const q of partidas) {
      const tq = Date.parse(q.created_at);
      if (q !== p && chave(q.player) === k && tq >= desde && tq <= t && (tq < t || q.id < p.id)) antes += pontosDe(q.mass);
    }
    const de = patenteDe(antes).atual, para = patenteDe(antes + pontosDe(p.mass)).atual;
    return para.nivel > de.nivel ? { de, para } : null;
  }
  function recordeDoMes(id) {
    const p = partidas.find((x) => x.id === id);
    if (!p) return false;
    const mk = mesChave(Date.parse(p.created_at));
    return !partidas.some((q) => q !== p && q.mass > p.mass && mesChave(Date.parse(q.created_at)) === mk);
  }
  function contarAte(span, alvo) {
    const ini = performance.now(), dur = 1200;
    const passo = (t) => {
      const k = Math.min(1, (t - ini) / dur);
      span.textContent = fmt(Math.round(alvo * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }
  function cartaoMassa(m) {
    const d = m.dados || {}, k = chave(d.player || ''), nick = nomeDe(k, d.player || '');
    const num = el('span', { text: fmt(d.mass || 0) });
    if (m._conta) { m._conta = false; contarAte(num, d.mass || 0); }
    const sobe = subidaDe(d.score_id);
    return el('div', { class: 'ch-cv ch-cv-massa' },
      el('div', { class: 'ch-cv-rot' }, svg(ICONE_CHAMA, 14), 'NOVA MASSA NO RANKING'),
      el('button', { type: 'button', class: 'ch-cv-quem', onclick: () => abrirPerfil(k) }, avatarChat(nick, 'av-p'), el('b', { text: nick })),
      el('div', { class: 'ch-cv-num' }, num, el('small', { text: 'MASSA' })),
      el('div', { class: 'ch-cv-linha' },
        el('span', { class: 'ch-cv-pts', text: `+${ptsTxt(pontosDe(d.mass || 0))}` }),
        d.mass >= META ? el('span', { text: `passou de ${fmtK(Math.floor(d.mass / META) * META)}` }) : null,
        recordeDoMes(d.score_id) ? el('span', { class: 'ch-selo', text: 'RECORDE DO MÊS' }) : null),
      sobe ? el('div', { class: 'ch-sobe', style: `--pc:${sobe.para.cor}` },
        escudoDe(sobe.de, nick.charAt(0).toUpperCase(), 'av-m ch-sobe-de'),
        el('span', { class: 'ch-sobe-seta' }, svg(ICONE_SETA, 22)),
        escudoDe(sobe.para, nick.charAt(0).toUpperCase(), 'av-m ch-sobe-para'),
        el('span', { class: 'ch-sobe-txt' }, 'SUBIU PRA', chipPatente(sobe.para.pontos))) : null);
  }
  function cartaoBonde(m) {
    const d = m.dados || {}, max = d.max || 6, gente = chat.bonde.get(m.id) || [];
    const dentro = gente.some((g) => g.user_id === euChat());
    const fechado = Date.now() - Date.parse(m.created_at) > BONDE_DURA;
    const cheio = gente.length >= max;
    const pode = !fechado && !punicaoAtiva() && (dentro || !cheio);
    return el('div', { class: `ch-cv ch-cv-bonde ${fechado ? 'fechado' : ''}` },
      el('div', { class: 'ch-cv-rot' }, svg(ICONE_BONDE, 14), m.user_id === euChat() ? 'SEU BONDE' : `BONDE DO ${nickMsg(m).toUpperCase()}`),
      el('div', { class: 'ch-cv-tit', text: d.srv || 'Servidor BR' }),
      m.txt ? el('div', { class: 'ch-cv-nota', text: m.txt }) : null,
      el('div', { class: 'ch-bonde-gente' },
        ...gente.map((g) => { const n = nickDoPlayer(g.player_id, g.nome); return el('span', { class: 'ch-bonde-av', title: n }, avatarChat(n, 'av-p')); }),
        ...Array.from({ length: Math.max(0, max - gente.length) }, () => el('span', { class: 'ch-vaga' }))),
      el('div', { class: 'ch-bonde-pe' },
        el('span', { class: 'ch-bonde-cont' }, `${gente.length}/${max}`, el('small', { text: fechado ? 'ENCERRADO' : cheio ? 'LOTADO' : 'NO BONDE' })),
        pode ? el('button', { type: 'button', class: `btn ${dentro ? 'btn-sec' : 'btn-bonde'}`, onclick: () => entrarNoBonde(m, !dentro), text: dentro ? 'Sair' : 'Tô dentro' }) : null));
  }
  function acoesChat(m, nick, meu) {
    const b = (ico, rot, fn, cls = '') => el('button', { type: 'button', class: cls, title: rot, 'aria-label': rot, onclick: fn }, svg(ico, 17));
    const voz = !!chat.eu && !punicaoAtiva();
    return el('div', { class: 'ch-acoes' },
      voz ? b(ICONE_SORRISO, 'Reagir', (e) => abrirEmojisChat(e.currentTarget, (x) => reagirChat(m, x))) : null,
      podeFalar(m.canal) ? b(ICONE_RESPONDER, 'Responder', () => responderChat(m)) : null,
      admChat() && m.tipo !== 'massa' ? b(ICONE_FIXAR, m.fixada ? 'Desafixar' : 'Fixar no topo', () => fixarChat(m, !m.fixada), m.fixada ? 'on' : '') : null,
      admChat() && m.user_id && !meu && !m.adm ? b(ICONE_MUDO, `Punir ${nick}`, () => abrirPunir({ user_id: m.user_id, nick })) : null,
      !admChat() && !meu && m.user_id ? b(ICONE_BANDEIRA, 'Denunciar pro ADM', () => denunciarChat(m, nick)) : null,
      (meu || admChat()) && m.tipo !== 'massa' ? b(ICONE_LIXO, 'Apagar', () => apagarChat(m, nick, meu), 'perigo') : null);
  }
  function linhaChat(m, ant, pop = null) {
    const nick = nickMsg(m), meu = !!m.user_id && m.user_id === euChat();
    const cont = !!ant && !!m.user_id && ant.user_id === m.user_id && m.tipo === 'msg' && ant.tipo === 'msg' && m.canal !== 'avisos'
      && !m.resp && Date.parse(m.created_at) - Date.parse(ant.created_at) < 4 * 60000;
    const n = el('div', { class: `ch-m ${cont ? 'cont' : ''} ${!m.apagada && !meu && meMarcou(m) ? 'mencao' : ''}`, 'data-id': m.id });
    n.append(el('div', { class: 'ch-m-av' }, cont ? el('span', { class: 'ch-hora-lado', text: horaChat(m.created_at) }) : avatarChat(nick)));
    const corpo = el('div', { class: 'ch-m-corpo' });
    if (!cont) {
      const temPerfil = nick !== 'COBR' && elenco.has(chave(nick));
      corpo.append(el('div', { class: 'ch-m-cab' },
        el('button', { type: 'button', class: 'ch-nick', disabled: !temPerfil, style: `--pc:${nick === 'COBR' ? 'var(--laranja-claro)' : patenteDe(ptsPat(chave(nick))).atual.cor}`, onclick: () => abrirPerfil(chave(nick)), text: nick }),
        ...tagsChat(m, nick), el('span', { class: 'ch-hora', text: horaChat(m.created_at) })));
    }
    if (m.resp) {
      const r = chat.porId.get(m.resp);
      corpo.append(el('button', { type: 'button', class: 'ch-cita', onclick: () => r && irParaMsg(r.id) },
        svg(ICONE_CITA, 13), r ? el('b', { text: nickMsg(r) }) : null, el('span', { text: r ? resumoChat(r) : 'mensagem antiga' })));
    }
    if (m.apagada) corpo.append(el('div', { class: 'ch-txt apagada', text: 'mensagem apagada' }));
    else if (m.tipo === 'massa') corpo.append(cartaoMassa(m));
    else if (m.tipo === 'bonde') corpo.append(cartaoBonde(m));
    else if (m.canal === 'avisos') corpo.append(el('div', { class: 'ch-cv ch-cv-aviso' }, el('div', { class: 'ch-cv-rot' }, svg(ICONE_MEGAFONE, 14), 'AVISO'), textoChat(m.txt)));
    else corpo.append(textoChat(m.txt));
    const reacs = [...(chat.reac.get(m.id) || new Map())].filter(([, s]) => s.size);
    if (reacs.length && !m.apagada) corpo.append(el('div', { class: 'ch-reacoes' }, ...reacs.map(([e, s]) =>
      el('button', { type: 'button', class: `ch-reac ${s.has(euChat()) ? 'minha' : ''} ${pop === e ? 'pop' : ''}`, 'aria-label': `${e} ${s.size}`, onclick: () => reagirChat(m, e) },
        el('span', { class: e === 'GG' ? 'ch-gg' : '', text: e }), String(s.size)))));
    n.append(corpo);
    if (!m.apagada) n.append(acoesChat(m, nick, meu));
    return n;
  }
  function anteriorNoDia(m) {
    const l = chat.msgs[m.canal], i = l.indexOf(m), a = l[i - 1];
    return a && new Date(a.created_at).toDateString() === new Date(m.created_at).toDateString() ? a : null;
  }
  function trocarLinhaChat(m, pop = null) {
    if (!chatVisivel() || chat.canal !== m.canal) return;
    const velho = $('chatMsgs').querySelector(`.ch-m[data-id="${m.id}"]`);
    if (!velho) return;
    const novo = linhaChat(m, anteriorNoDia(m), pop);
    if (velho.classList.contains('ativa')) novo.classList.add('ativa');
    velho.replaceWith(novo);
  }
  const pertoDoFimChat = () => { const b = $('chatMsgs'); return b.scrollHeight - b.scrollTop - b.clientHeight < 140; };
  const descerChat = (suave) => { const b = $('chatMsgs'); b.scrollTo({ top: b.scrollHeight, behavior: suave ? 'smooth' : 'auto' }); };
  function mostrarNovasChat() {
    chat.novas++;
    const b = $('chatNovas');
    trocar(b, svg(ICONE_DESCE, 14), `${chat.novas} ${chat.novas > 1 ? 'NOVAS' : 'NOVA'}`);
    b.hidden = false;
  }
  function irParaMsg(id) {
    const n = $('chatMsgs').querySelector(`.ch-m[data-id="${id}"]`);
    if (!n) return;
    n.scrollIntoView({ behavior: 'smooth', block: 'center' });
    n.classList.remove('brilha'); void n.offsetWidth; n.classList.add('brilha');
  }

  function desenharChat() {
    if (!chat.eu) { trocar($('chatMsgs'), el('div', { class: 'ch-vazio', text: 'Carregando o chat…' })); return; }
    desenharCanaisChat(); desenharTopoChat(); desenharMsgsChat(); desenharComporChat(); desenharMembrosChat(); desenharDigitando();
  }
  function desenharCanaisChat() {
    trocar($('chatCanais'), el('div', { class: 'ch-lado-rot', text: 'CANAIS' }), ...CANAIS_CHAT.map((c) => {
      const n = chat.eu ? naoLidasChat(c.id) : 0;
      return el('button', { type: 'button', class: `ch-canal ${n ? 'tem' : ''}`, 'aria-current': String(c.id === chat.canal), onclick: () => abrirCanalChat(c.id) },
        svg(c.ico, 17), el('span', { class: 'ch-canal-nome', text: c.nome }),
        c.soAdm ? svg(ICONE_TRAVA, 13, 'class="ch-trava"') : null,
        n ? el('span', { class: 'ch-badge', text: n > 99 ? '99+' : String(n) }) : null);
    }));
  }
  function desenharTopoChat() {
    trocar($('chatTitulo'), el('span', { class: 'laranja', text: '#' }), canalChat(chat.canal).nome);
    const ate = jogandoAte(chat.status.get(euChat()));
    const b = $('chatJogando');
    b.hidden = !chat.eu || foraDoChat();
    b.classList.toggle('on', !!ate);
    b.setAttribute('aria-pressed', String(!!ate));
    trocar(b, el('i', { class: 'ch-bola' }), ate ? `JOGANDO · até ${horaChat(ate)}` : 'TÔ JOGANDO');
    const mod = $('chatModBtn');
    mod.hidden = !admChat();
    trocar(mod, svg(ICONE_MODERAR, 18), el('span', { class: 'ch-mod-rot', text: 'Moderação' }), chat.denuncias ? el('span', { class: 'ch-badge', text: String(chat.denuncias) }) : null);
  }
  function desenharMsgsChat() {
    const box = $('chatMsgs');
    chat.novas = 0; $('chatNovas').hidden = true;
    if (foraDoChat()) {
      const p = punicaoAtiva();
      trocar(box, el('div', { class: 'ch-fora' }, svg(ICONE_TRAVA, 34), el('b', { text: 'VOCÊ ESTÁ FORA DO CHAT' }), el('span', { text: ateTxt(p.ate) + (p.motivo ? ` · ${p.motivo}` : '') })));
      $('chatFixada').hidden = true;
      return;
    }
    const lista = chat.msgs[chat.canal], filhos = [];
    let ant = null, dia = null;
    if (!lista.length) filhos.push(el('div', { class: 'ch-vazio' }, svg(canalChat(chat.canal).ico, 30), el('span', { text: canalChat(chat.canal).vazio })));
    for (const m of lista) {
      const d = new Date(m.created_at).toDateString();
      if (d !== dia) { dia = d; ant = null; filhos.push(el('div', { class: 'ch-dia', text: rotDia(m.created_at) })); }
      filhos.push(linhaChat(m, ant));
      ant = m;
    }
    trocar(box, filhos);
    box.scrollTop = box.scrollHeight;
    desenharFixadaChat();
    marcarLidoChat();
  }
  function desenharFixadaChat() {
    const f = $('chatFixada'), m = foraDoChat() ? null : chat.msgs[chat.canal].find((x) => x.fixada && !x.apagada);
    f.hidden = !m;
    if (m) trocar(f, svg(ICONE_FIXAR, 15), el('b', { text: 'FIXADA' }), el('span', { text: `${nickMsg(m)}: ${resumoChat(m).replace(/\n/g, ' ')}` }));
    f.onclick = () => m && irParaMsg(m.id);
  }
  function desenharComporChat() {
    const c = canalChat(chat.canal), p = punicaoAtiva();
    const trava = !chat.eu ? 'Carregando…'
      : p ? (p.tipo === 'ban' ? 'Você está fora do chat' : `Você está silenciado ${ateTxt(p.ate)}`)
      : c.soSite ? 'O site posta aqui quando alguém registra massa'
      : c.soAdm && !admChat() ? 'Só ADM escreve em #avisos' : null;
    $('chatCaixa').hidden = !!trava;
    $('chatTrancado').hidden = !trava;
    if (trava) trocar($('chatTrancado'), svg(p ? ICONE_MUDO : ICONE_TRAVA, 15), trava);
    $('chatTxt').placeholder = c.id === 'avisos' ? 'Escreva um aviso pro clã' : `Mensagem em #${c.nome}`;
    $('chatBondeBtn').hidden = c.id === 'avisos';
  }
  function desenharDigitando() {
    const agora = Date.now();
    const l = [...chat.digitando.values()].filter((d) => d.ate > agora && d.canal === chat.canal);
    if (!l.length) { $('chatDigitando').replaceChildren(); return; }
    const nomes = l.slice(0, 2).map((d) => d.nome).join(' e ');
    trocar($('chatDigitando'), el('span', { class: 'ch-pontinhos' }, el('i'), el('i'), el('i')), el('b', { text: nomes }), l.length > 1 ? ' estão digitando…' : ' está digitando…');
  }

  // quem está jogando, online e offline (online = com o site aberto agora)
  function membrosChat() {
    const jogP = new Map(), jogU = new Map(), onP = new Set(), semPerfil = [];
    for (const s of chat.status.values()) { const ate = jogandoAte(s); if (!ate) continue; if (s.player_id) jogP.set(s.player_id, ate); jogU.set(s.user_id, ate); }
    for (const [u, o] of chat.online) { if (o.player_id) onP.add(o.player_id); else semPerfil.push({ user_id: u, nome: o.nome || 'ADM' }); }
    const lista = jogadores.filter((r) => r.ativo).map((r) => ({ nick: r.nick, k: chave(r.nick), st: jogP.has(r.id) ? 'jogo' : onP.has(r.id) ? 'on' : 'off', ate: jogP.get(r.id) }));
    for (const o of semPerfil) lista.push({ nick: o.nome, k: chave(o.nome), st: jogU.has(o.user_id) ? 'jogo' : 'on', ate: jogU.get(o.user_id), semPerfil: true });
    return lista.sort((a, b) => ptsPat(b.k) - ptsPat(a.k) || a.nick.localeCompare(b.nick, 'pt-BR'));
  }
  function desenharMembrosChat() {
    const lista = membrosChat();
    const grupo = (st, rot) => {
      const l = lista.filter((x) => x.st === st);
      return l.length ? [el('div', { class: 'ch-lado-rot', text: `${rot} — ${l.length}` }), ...l.map(membroChat)] : [];
    };
    trocar($('chatMembros'),
      el('div', { class: 'ch-membros-topo' }, el('b', { text: 'MEMBROS' }), el('button', { type: 'button', class: 'tn-x', 'aria-label': 'Fechar', onclick: () => $('chatMembros').classList.remove('aberto'), text: '×' })),
      ...grupo('jogo', 'JOGANDO'), ...grupo('on', 'ONLINE'), ...grupo('off', 'OFFLINE'));
    trocar($('chatMembrosBtn'), svg(ICONE_GENTE, 18), el('span', { text: String(lista.filter((x) => x.st !== 'off').length) }));
  }
  function membroChat(x) {
    const p = patenteDe(ptsPat(x.k)).atual;
    return el('button', { type: 'button', class: `ch-membro ${x.st}`, disabled: !!x.semPerfil, onclick: () => abrirPerfil(x.k) },
      el('span', { class: 'ch-membro-av' }, avatarChat(x.nick), el('span', { class: `ch-st ${x.st}` })),
      el('span', { class: 'ch-membro-txt' }, el('b', { style: `--pc:${p.cor}`, text: x.nick }),
        el('span', { class: 'ch-membro-sub', text: x.st === 'jogo' ? (x.ate ? `jogando · até ${horaChat(x.ate)}` : 'jogando') : p.nome })));
  }

  // ---------- página ----------
  function abrirChatPagina() {
    $('chatMembros').classList.remove('aberto');
    desenharChat();
    ajustarChat();
  }
  function abrirCanalChat(id) {
    chat.canal = id;
    cancelarRespChat();
    $('chatMencoes').hidden = true;
    desenharChat();
  }
  // o chat ocupa a tela toda entre o topo e a barra de baixo
  function ajustarChat() {
    if (pagAtual !== 'chat') return;
    const app = $('chatApp'), bb = $('barraBaixo');
    const alto = window.visualViewport ? visualViewport.height : innerHeight;
    const topo = app.getBoundingClientRect().top + (window.visualViewport ? visualViewport.offsetTop : 0);
    const baixo = getComputedStyle(bb).display === 'none' ? 16 : bb.offsetHeight + 8;
    app.style.height = Math.max(340, Math.round(alto - Math.max(0, topo) - baixo)) + 'px';
    if (pertoDoFimChat()) descerChat();
  }

  // ---------- ações ----------
  async function enviarChat() {
    const campo = $('chatTxt'), txt = campo.value.trim();
    if (!txt || !podeFalar(chat.canal)) return;
    const resp = chat.resp;
    campo.value = '';
    $('chatEnviar').disabled = true;
    $('chatMencoes').hidden = true;
    cancelarRespChat();
    try {
      const id = await chatRpc('chat_enviar', { p_canal: chat.canal, p_txt: txt, p_resp: resp ? resp.id : null });
      await buscarMsgChat(id);
    } catch (e) {
      if (!campo.value) campo.value = txt;
      $('chatEnviar').disabled = !campo.value.trim();
      erroChat(e);
    }
  }
  // não espera o tempo real pra mostrar o que a própria pessoa mandou
  async function buscarMsgChat(id) {
    if (DEMO || !id || chat.porId.has(id)) return;
    const { data } = await sb.from('chat_mensagens').select('*').eq('id', id).maybeSingle();
    if (data) chegouMsg(data);
  }
  async function reagirChat(m, e) {
    try {
      const ficou = await chatRpc('chat_reagir', { p_msg: m.id, p_emoji: e });
      mexerReac(m.id, e, euChat(), !!ficou);
    } catch (err) { erroChat(err); }
  }
  function responderChat(m) {
    chat.resp = m;
    trocar($('chatResp'), svg(ICONE_RESPONDER, 14), el('span', null, 'Respondendo ', el('b', { text: nickMsg(m) }), ` · ${resumoChat(m)}`),
      el('button', { type: 'button', 'aria-label': 'Cancelar resposta', onclick: cancelarRespChat }, '×'));
    $('chatResp').hidden = false;
    $('chatTxt').focus();
  }
  function cancelarRespChat() { chat.resp = null; $('chatResp').hidden = true; }
  async function entrarNoBonde(m, entra) {
    try {
      const r = await chatRpc('chat_bonde_entrar', { p_msg: m.id, p_entrar: entra });
      if (r === 'lotado') { toast('Esse bonde lotou.', true); return; }
      if (r === 'fechado') { toast('Esse bonde já acabou.', true); trocarLinhaChat(m); return; }
      mexerBonde({ msg_id: m.id, user_id: euChat(), player_id: chat.eu.player_id, nome: meuNick() }, entra);
      meuStatusChat(entra ? new Date(Date.now() + 90 * 60000).toISOString() : null);
      if (entra) toast('Você entrou no bonde. Bom jogo!');
    } catch (e) { erroChat(e); }
  }
  function meuStatusChat(ate) {
    chat.status.set(euChat(), { user_id: euChat(), player_id: chat.eu.player_id, nome: meuNick(), jogando_ate: ate });
    if (chatVisivel()) { desenharTopoChat(); desenharMembrosChat(); }
  }
  async function alternarJogando() {
    const liga = !jogandoAte(chat.status.get(euChat()));
    try {
      const ate = await chatRpc('chat_jogando', { p_ligar: liga });
      meuStatusChat(ate || null);
      toast(liga ? `Status: jogando ${ateTxt(ate)}.` : 'Status de jogando desligado.');
    } catch (e) { erroChat(e); }
  }
  function abrirBonde() {
    if (!podeFalar(chat.canal === 'geral' ? 'geral' : 'bonde')) { toast('Você está silenciado no chat.', true); return; }
    $('fBondeSrv').value = $('fBondeSrv').value || 'Servidor BR';
    $('fBondeNota').value = '';
    document.querySelectorAll('[data-vagas]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.vagas === '6')));
    $('dlgBonde').showModal();
  }
  async function chamarBonde() {
    const vagas = Number((document.querySelector('[data-vagas][aria-checked="true"]') || {}).dataset?.vagas || 6);
    const canal = chat.canal === 'geral' ? 'geral' : 'bonde';
    $('dlgBonde').close();
    try {
      const id = await chatRpc('chat_enviar', { p_canal: canal, p_txt: $('fBondeNota').value.trim(), p_tipo: 'bonde', p_dados: { srv: $('fBondeSrv').value.trim() || 'Servidor BR', max: vagas } });
      if (!DEMO) {
        const { data } = await sb.from('chat_bonde').select('msg_id, user_id, player_id, nome').eq('msg_id', id);
        for (const b of data || []) mexerBonde(b, true, false);
      }
      if (canal !== chat.canal) abrirCanalChat(canal);
      await buscarMsgChat(id);
      meuStatusChat(new Date(Date.now() + 90 * 60000).toISOString());
    } catch (e) { erroChat(e); }
  }
  function apagarChat(m, nick, meu) {
    confirmar('APAGAR MENSAGEM?', meu ? 'Ela some pra todo mundo.' : `Mensagem de ${nick}. Some pra todo mundo e fica no histórico da moderação.`, 'Apagar', async () => {
      try {
        await chatRpc('chat_apagar', { p_msg: m.id });
        atualizarMsg({ id: m.id, apagada: true, fixada: false, txt: '' });
        toast('Mensagem apagada.');
        if (admChat()) contarDenuncias();
      } catch (e) { erroChat(e); }
    });
  }
  async function fixarChat(m, fixar) {
    try {
      await chatRpc('chat_fixar', { p_msg: m.id, p_fixar: fixar });
      if (fixar) for (const x of chat.msgs[m.canal]) if (x.fixada && x !== m) { x.fixada = false; trocarLinhaChat(x); }
      atualizarMsg({ id: m.id, fixada: fixar });
      toast(fixar ? 'Mensagem fixada no topo do canal.' : 'Mensagem desafixada.');
    } catch (e) { erroChat(e); }
  }
  function denunciarChat(m, nick) {
    confirmar('DENUNCIAR MENSAGEM?', `O ADM vai olhar essa mensagem de ${nick}.`, 'Denunciar', async () => {
      try { await chatRpc('chat_denunciar', { p_msg: m.id, p_motivo: '' }); toast('Denúncia enviada pro ADM.'); }
      catch (e) { erroChat(e); }
    });
  }

  // ---------- moderação (só ADM) ----------
  let punindo = null;
  const PRAZOS = [['10 min', 10], ['1 hora', 60], ['1 dia', 1440], ['7 dias', 10080], ['Sem prazo', null]];
  function abrirPunir(alvo) {
    punindo = { ...alvo, tipo: 'silencio', min: 60 };
    $('tituloPunir').textContent = `PUNIR ${alvo.nick.toUpperCase()}`;
    $('fPunirMotivo').value = '';
    desenharPunir();
    if ($('dlgModeracao').open) $('dlgModeracao').close();
    $('dlgPunir').showModal();
  }
  function desenharPunir() {
    const opc = (atual, valor, txt, fn) => el('button', { type: 'button', class: 'aba', role: 'radio', 'aria-checked': String(atual === valor), onclick: fn, text: txt });
    trocar($('punirTipo'),
      opc(punindo.tipo, 'silencio', 'Silenciar', () => { punindo.tipo = 'silencio'; desenharPunir(); }),
      opc(punindo.tipo, 'ban', 'Tirar do chat', () => { punindo.tipo = 'ban'; desenharPunir(); }));
    trocar($('punirPrazo'), ...PRAZOS.map(([t, v]) => opc(punindo.min, v, t, () => { punindo.min = v; desenharPunir(); })));
    $('punirExplica').textContent = punindo.tipo === 'ban' ? 'Não lê nem escreve no chat.' : 'Lê o chat, mas não escreve nem reage.';
  }
  async function aplicarPunicao() {
    const p = punindo;
    if (!p) return;
    try {
      const r = await chatRpc('chat_punir', { p_user: p.user_id, p_tipo: p.tipo, p_minutos: p.min, p_motivo: $('fPunirMotivo').value.trim() });
      $('dlgPunir').close();
      if (r === 'adm') { toast('ADM não pode ser punido.', true); return; }
      const prazo = PRAZOS.find(([, v]) => v === p.min)[0].toLowerCase();
      toast(`${p.nick} ${p.tipo === 'ban' ? 'saiu do chat' : 'foi silenciado'} · ${p.min ? prazo : 'até você liberar'}.`);
    } catch (e) { erroChat(e); }
  }
  let abaMod = 'denuncias';
  async function abrirModeracao(aba = abaMod) {
    abaMod = aba;
    document.querySelectorAll('[data-mod]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mod === abaMod)));
    const dlg = $('dlgModeracao');
    if (!dlg.open) { trocar($('modCorpo'), el('p', { class: 'sec', text: 'Carregando…' })); dlg.showModal(); }
    let d;
    try { d = await chatRpc('chat_moderacao', {}); } catch (e) { erroChat(e); return; }
    chat.denuncias = new Set(d.denuncias.map((x) => x.msg_id)).size;
    desenharTopoChat();
    const n = { denuncias: d.denuncias.length, punidos: d.punidos.length };
    document.querySelectorAll('[data-mod]').forEach((b) => { const q = n[b.dataset.mod]; b.querySelector('i').textContent = q ? String(q) : ''; });
    const vazio = (t) => el('div', { class: 'mod-vazio' }, svg(ICONE_MODERAR, 28), el('span', { text: t }));
    let corpo;
    if (abaMod === 'denuncias') corpo = d.denuncias.length ? d.denuncias.map(itemDenuncia) : [vazio('Nenhuma denúncia aberta.')];
    else if (abaMod === 'punidos') corpo = d.punidos.length ? d.punidos.map(itemPunido) : [vazio('Ninguém punido agora.')];
    else corpo = d.historico.length ? [el('ul', { class: 'mod-hist' }, ...d.historico.map(itemHistorico))] : [vazio('Nada feito ainda.')];
    trocar($('modCorpo'), corpo);
  }
  function itemDenuncia(x) {
    const nick = nickDoPlayer(null, x.nome);
    const m = chat.porId.get(x.msg_id);
    const acao = (txt, cls, fn) => el('button', { type: 'button', class: `btn ${cls}`, onclick: fn, text: txt });
    return el('div', { class: 'mod-item' },
      el('div', { class: 'mod-cab' }, avatarChat(nick, 'av-p'), el('b', { text: nick }),
        el('span', { class: 'mod-sub', text: `#${x.canal} · ${haQuanto(x.created_at)}` }),
        el('span', { class: 'mod-qtd', text: `${x.qtd} ${x.qtd > 1 ? 'denúncias' : 'denúncia'}` })),
      el('p', { class: 'mod-txt', text: x.tipo === 'bonde' ? `[bonde] ${x.txt || ''}` : x.txt || '—' }),
      el('div', { class: 'mod-sub', text: 'denunciou: ' + x.quem.map((q) => q.quem).join(', ') }),
      el('div', { class: 'linha-btns' },
        acao('Ignorar', 'btn-sec', async () => { try { await chatRpc('chat_ignorar_denuncia', { p_msg: x.msg_id }); abrirModeracao(); } catch (e) { erroChat(e); } }),
        x.user_id ? acao('Punir', 'btn-sec', () => abrirPunir({ user_id: x.user_id, nick })) : null,
        acao('Apagar', 'btn-perigo', async () => {
          try { await chatRpc('chat_apagar', { p_msg: x.msg_id }); if (m) atualizarMsg({ id: m.id, apagada: true, fixada: false, txt: '' }); toast('Mensagem apagada.'); abrirModeracao(); }
          catch (e) { erroChat(e); }
        })));
  }
  function itemPunido(x) {
    const nick = nickDoPlayer(x.player_id, x.nome);
    return el('div', { class: 'mod-item mod-linha' },
      avatarChat(nick, 'av-p'),
      el('div', { class: 'mod-linha-txt' },
        el('b', { text: nick }),
        el('span', { class: `mod-pena ${x.tipo}`, text: x.tipo === 'ban' ? 'FORA DO CHAT' : 'SILENCIADO' }),
        el('span', { class: 'mod-sub', text: [ateTxt(x.ate), x.motivo, x.por ? `por ${x.por}` : null].filter(Boolean).join(' · ') })),
      el('button', { type: 'button', class: 'btn btn-sec', text: 'Liberar', onclick: async () => {
        try { await chatRpc('chat_perdoar', { p_user: x.user_id }); toast(`${nick} liberado no chat.`); abrirModeracao(); } catch (e) { erroChat(e); }
      } }));
  }
  function itemHistorico(h) {
    const d = h.detalhe || {};
    const prazo = d.minutos ? (PRAZOS.find(([, v]) => v === d.minutos) || [`${d.minutos} min`])[0] : 'sem prazo';
    const txt = {
      chat_apagar: `apagou mensagem de ${d.autor || '?'}${d.texto ? `: "${String(d.texto).slice(0, 60)}"` : ''}`,
      chat_fixar: 'fixou uma mensagem', chat_desafixar: 'desafixou uma mensagem',
      chat_punir: `${d.tipo === 'ban' ? 'tirou do chat' : 'silenciou'} ${d.quem || '?'} · ${prazo}${d.motivo ? ` · ${d.motivo}` : ''}`,
      chat_perdoar: `liberou ${d.quem || '?'}`, chat_ignorar_denuncia: 'ignorou uma denúncia',
    }[h.acao] || h.acao;
    return el('li', null, el('b', { text: h.quem || 'ADM' }), ` ${txt}`, el('span', { class: 'mod-sub', text: haQuanto(h.created_at) }));
  }

  // ---------- digitando, @menção e emojis ----------
  let ultDigitou = 0;
  function avisarDigitando() {
    if (DEMO || !chat.presenca || Date.now() - ultDigitou < 2500) return;
    ultDigitou = Date.now();
    chat.presenca.send({ type: 'broadcast', event: 'digitando', payload: { user_id: euChat(), nome: meuNick(), canal: chat.canal } });
  }
  function alguemDigitando(p) {
    if (!p || p.user_id === euChat()) return;
    chat.digitando.set(p.user_id, { ...p, ate: Date.now() + 3500 });
    if (chatVisivel()) { desenharDigitando(); setTimeout(desenharDigitando, 3600); }
  }
  function sugerirMencao() {
    const campo = $('chatTxt'), caixa = $('chatMencoes');
    const m = campo.value.slice(0, campo.selectionStart).match(/@([\p{L}\p{N}_.-]*)$/u);
    if (!m) { caixa.hidden = true; return; }
    const q = busca(m[1]);
    const lista = jogadores.filter((r) => r.ativo && busca(r.nick).startsWith(q) && r.id !== (chat.eu && chat.eu.player_id)).slice(0, 6);
    if (!lista.length) { caixa.hidden = true; return; }
    trocar(caixa, lista.map((r, i) => el('button', {
      type: 'button', class: i === 0 ? 'sel' : '',
      onclick: () => {
        const ini = campo.selectionStart - m[0].length;
        campo.value = campo.value.slice(0, ini) + '@' + r.nick + ' ' + campo.value.slice(campo.selectionStart);
        caixa.hidden = true;
        $('chatEnviar').disabled = false;
        campo.focus();
      },
    }, avatarChat(r.nick, 'av-p'), el('b', { text: r.nick }), chipPatente(ptsPat(chave(r.nick))))));
    caixa.hidden = false;
  }
  function abrirEmojisChat(alvo, escolher) {
    const pop = $('chatEmojis');
    trocar(pop, REACOES_CHAT.map((e) => el('button', { type: 'button', class: e === 'GG' ? 'ch-gg' : '', 'aria-label': e, onclick: () => { pop.hidden = true; escolher(e); }, text: e })));
    pop.hidden = false;
    const r = alvo.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
    pop.style.top = (r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8) + 'px';
  }

  function ligarControlesChat() {
    $('chatBondeBtn').append(svg(ICONE_BONDE, 20));
    $('chatEmojiBtn').append(svg(ICONE_SORRISO, 20));
    $('chatEnviar').append(svg(ICONE_ENVIAR, 18));
    const campo = $('chatTxt');
    campo.addEventListener('input', () => { $('chatEnviar').disabled = !campo.value.trim(); sugerirMencao(); if (campo.value) avisarDigitando(); });
    campo.addEventListener('keydown', (e) => {
      const caixa = $('chatMencoes');
      if (caixa.hidden) { if (e.key === 'Escape' && chat.resp) cancelarRespChat(); return; }
      const bs = [...caixa.querySelectorAll('button')], i = bs.findIndex((b) => b.classList.contains('sel'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const k = (i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length; bs.forEach((b, j) => b.classList.toggle('sel', j === k)); }
      else if ((e.key === 'Enter' || e.key === 'Tab') && i >= 0) { e.preventDefault(); bs[i].click(); }
      else if (e.key === 'Escape') caixa.hidden = true;
    });
    $('chatCompor').addEventListener('submit', (e) => { e.preventDefault(); enviarChat(); });
    $('chatEmojiBtn').addEventListener('click', (e) => abrirEmojisChat(e.currentTarget, (x) => {
      const i = campo.selectionStart ?? campo.value.length;
      campo.value = campo.value.slice(0, i) + x + ' ' + campo.value.slice(i);
      $('chatEnviar').disabled = false;
      campo.focus();
    }));
    $('chatBondeBtn').addEventListener('click', abrirBonde);
    $('formBonde').addEventListener('submit', (e) => { e.preventDefault(); chamarBonde(); });
    $('btnCancelarBonde').addEventListener('click', () => $('dlgBonde').close());
    document.querySelectorAll('[data-vagas]').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('[data-vagas]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    }));
    $('chatJogando').addEventListener('click', alternarJogando);
    $('chatModBtn').addEventListener('click', () => abrirModeracao('denuncias'));
    $('chatMembrosBtn').addEventListener('click', () => $('chatMembros').classList.toggle('aberto'));
    $('chatNovas').addEventListener('click', () => descerChat(true));
    $('chatMsgs').addEventListener('scroll', () => { if (pertoDoFimChat()) { $('chatNovas').hidden = true; chat.novas = 0; marcarLidoChat(); } });
    // no celular: tocar na mensagem mostra as ações dela
    $('chatMsgs').addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const n = e.target.closest('.ch-m');
      const ja = n && n.classList.contains('ativa');
      $('chatMsgs').querySelectorAll('.ch-m.ativa').forEach((x) => x.classList.remove('ativa'));
      if (n && !ja) n.classList.add('ativa');
    });
    document.addEventListener('pointerdown', (e) => {
      const pop = $('chatEmojis');
      if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.ch-acoes, #chatEmojiBtn')) pop.hidden = true;
    });
    document.querySelectorAll('[data-mod]').forEach((b) => b.addEventListener('click', () => abrirModeracao(b.dataset.mod)));
    $('btnFecharMod').addEventListener('click', () => $('dlgModeracao').close());
    $('btnCancelarPunir').addEventListener('click', () => $('dlgPunir').close());
    $('btnAplicarPunir').addEventListener('click', aplicarPunicao);
    addEventListener('resize', ajustarChat);
    if (window.visualViewport) visualViewport.addEventListener('resize', ajustarChat);
    document.addEventListener('visibilitychange', () => { if (chatVisivel()) marcarLidoChat(); });
    // bonde que fecha, "jogando" que vence, silêncio que acaba: a tela acompanha
    setInterval(() => {
      if (!chat.eu || !chatVisivel()) return;
      desenharTopoChat(); desenharMembrosChat(); desenharComporChat();
    }, 30000);
  }

  // ---------- demonstração: o chat funciona só nesta tela ----------
  const demoChat = { id: 0, denuncias: [], punidos: [], historico: [] };
  function demoChatSemear() {
    limparChat();
    const nomeEu = admin && !euId ? admin.nome : nickDoPlayer(euId, 'Você');
    chat.eu = { user_id: 'eu', player_id: euId, nome: nomeEu, adm: !!admin, punicao: null };
    const min = (m) => new Date(Date.now() - m * 60000).toISOString();
    const u = (pid) => 'u-' + pid;
    const msg = (canal, pid, txt, m, extra = {}) => {
      const r = jogPorId.get(pid);
      const x = { id: ++demoChat.id, canal, user_id: u(pid), player_id: pid, nome: r ? r.nick : '', adm: pid === 'dj0', tipo: 'msg', txt, dados: {}, resp: null, fixada: false, apagada: false, created_at: min(m), ...extra };
      guardarMsg(x);
      return x;
    };
    const massa = (canal, p) => guardarMsg({ id: ++demoChat.id, canal, user_id: null, player_id: null, nome: 'COBR', adm: false, tipo: 'massa', txt: '', dados: { score_id: p.id, player: p.player, mass: p.mass }, resp: null, fixada: false, apagada: false, created_at: p.created_at });
    const recentes = partidas.slice(0, 6).reverse();
    for (const p of recentes) massa('recordes', p);
    let a = msg('geral', 'dj1', 'boa noite família 🐍', 300);
    msg('geral', 'dj3', 'boa! hoje tem treino pra copa?', 296);
    a = msg('geral', 'dj0', 'tem sim, 21h no servidor BR. quem for da copa cola', 290);
    a.fixada = true;
    mexerReac(a.id, '🔥', u('dj1'), true, false); mexerReac(a.id, '🔥', u('dj3'), true, false); mexerReac(a.id, '👍', u('dj4'), true, false);
    const big = recentes.filter((p) => p.mass >= 100000).pop();
    let mm = null;
    if (big) { mm = massa('geral', big); mexerReac(mm.id, '🔥', u('dj4'), true, false); mexerReac(mm.id, 'GG', u('dj3'), true, false); }
    const b = msg('geral', 'dj4', mm ? '100k?? tá de hack kkkk' : 'alguém on?', 100, { resp: mm ? mm.id : null });
    mexerReac(b.id, '😂', u('dj1'), true, false);
    const bonde = msg('geral', 'dj3', '', 20, { tipo: 'bonde', dados: { srv: 'Servidor BR · 21h', max: 6 } });
    for (const pid of ['dj3', 'dj4', 'dj5']) mexerBonde({ msg_id: bonde.id, user_id: u(pid), player_id: pid, nome: jogPorId.get(pid).nick }, true, false);
    msg('geral', 'dj5', `@${nickDoPlayer('dj3', '')} guarda vaga pra mim`, 12);
    msg('bonde', 'dj6', 'alguém pra jogar de madrugada?', 50);
    msg('avisos', 'dj0', 'Copa COBR no sábado às 21h. Cada um com a tag [COBR] no nick.', 900);
    for (const pid of ['dj3', 'dj4', 'dj5']) chat.status.set(u(pid), { user_id: u(pid), player_id: pid, nome: jogPorId.get(pid).nick, jogando_ate: new Date(Date.now() + 70 * 60000).toISOString() });
    chat.online = new Map([['eu', { player_id: euId, nome: nomeEu }], ...['dj0', 'dj1', 'dj6'].map((pid) => [u(pid), { player_id: pid, nome: jogPorId.get(pid).nick }])]);
    demoChat.denuncias = [{ msg_id: b.id, user_id: u('dj2') }];
  }
  function demoChatRpc(nome, a) {
    const agora = new Date().toISOString();
    const eu = chat.eu;
    const m = a && a.p_msg ? chat.porId.get(a.p_msg) : null;
    const punicao = (u) => demoChat.punidos.find((p) => p.user_id === u && (!p.ate || Date.parse(p.ate) > Date.now()));
    const log = (acao, detalhe) => demoChat.historico.unshift({ acao, detalhe, created_at: agora, quem: eu.nome });
    switch (nome) {
      case 'chat_enviar': {
        const x = { id: ++demoChat.id, canal: a.p_canal, user_id: eu.user_id, player_id: eu.player_id, nome: meuNick(), adm: eu.adm, tipo: a.p_tipo || 'msg', txt: a.p_txt || '', dados: a.p_dados || {}, resp: a.p_resp || null, fixada: false, apagada: false, created_at: agora };
        if (x.tipo === 'bonde') chat.bonde.set(x.id, [{ user_id: eu.user_id, player_id: eu.player_id, nome: meuNick() }]);
        chegouMsg(x);
        return x.id;
      }
      case 'chat_reagir': { const s = chat.reac.get(a.p_msg)?.get(a.p_emoji); return !(s && s.has(eu.user_id)); }
      case 'chat_bonde_entrar': return 'ok';
      case 'chat_jogando': return a.p_ligar ? new Date(Date.now() + 90 * 60000).toISOString() : null;
      case 'chat_denunciar': demoChat.denuncias.push({ msg_id: a.p_msg, user_id: eu.user_id }); return null;
      case 'chat_apagar': if (m && m.user_id !== eu.user_id) log('chat_apagar', { autor: m.nome, texto: m.txt }); demoChat.denuncias = demoChat.denuncias.filter((d) => d.msg_id !== a.p_msg); return null;
      case 'chat_fixar': log(a.p_fixar ? 'chat_fixar' : 'chat_desafixar', {}); return null;
      case 'chat_punir': {
        const quem = (chat.msgs.geral.concat(...Object.values(chat.msgs)).find((x) => x.user_id === a.p_user) || {}).nome || '?';
        demoChat.punidos = demoChat.punidos.filter((p) => p.user_id !== a.p_user);
        demoChat.punidos.unshift({ user_id: a.p_user, nome: quem, player_id: a.p_user.replace('u-', ''), tipo: a.p_tipo, ate: a.p_minutos ? new Date(Date.now() + a.p_minutos * 60000).toISOString() : null, motivo: a.p_motivo, por: eu.nome, created_at: agora });
        log('chat_punir', { quem, tipo: a.p_tipo, minutos: a.p_minutos, motivo: a.p_motivo });
        return 'ok';
      }
      case 'chat_perdoar': { const p = demoChat.punidos.find((x) => x.user_id === a.p_user); demoChat.punidos = demoChat.punidos.filter((x) => x.user_id !== a.p_user); log('chat_perdoar', { quem: p && p.nome }); return null; }
      case 'chat_ignorar_denuncia': demoChat.denuncias = demoChat.denuncias.filter((d) => d.msg_id !== a.p_msg); log('chat_ignorar_denuncia', {}); return null;
      case 'chat_moderacao': {
        const grupos = new Map();
        for (const d of demoChat.denuncias) {
          const x = chat.porId.get(d.msg_id);
          if (!x) continue;
          const g = grupos.get(d.msg_id) || { msg_id: x.id, canal: x.canal, user_id: x.user_id, nome: x.nome, txt: x.txt, tipo: x.tipo, created_at: x.created_at, qtd: 0, quem: [] };
          g.qtd++; g.quem.push({ quem: d.user_id === eu.user_id ? meuNick() : nickDoPlayer(d.user_id.replace('u-', ''), 'membro'), motivo: '' });
          grupos.set(d.msg_id, g);
        }
        return { denuncias: [...grupos.values()], punidos: demoChat.punidos.filter((p) => punicao(p.user_id)), historico: demoChat.historico };
      }
    }
    return null;
  }

  // regras do chat (aba "Chat" do Como funciona)
  function regrasChat() {
    return [
      el('ul', { class: 'rg-lista' },
        linhaRegra('#geral', 'papo do clã'),
        linhaRegra('#bonde', 'chamada pra jogar junto'),
        linhaRegra('#recordes', 'cada massa registrada cai sozinha'),
        linhaRegra('#avisos', 'só ADM escreve'),
        linhaRegra('Massa de 100k+', 'aparece também no #geral')),
      tituloRegra('STATUS'),
      el('ul', { class: 'rg-lista' },
        linhaRegra('Online', 'com o site aberto'),
        linhaRegra('Jogando', 'tocou em "Tô jogando" ou entrou num bonde'),
        linhaRegra('Jogando some', 'sozinho depois de 90 min'),
        linhaRegra('Bonde', 'fecha 3 h depois de criado')),
      tituloRegra('MODERAÇÃO'),
      el('ul', { class: 'rg-lista' },
        linhaRegra('Denunciar', 'manda a mensagem pro ADM olhar'),
        linhaRegra('Silenciado', 'lê, mas não escreve nem reage'),
        linhaRegra('Fora do chat', 'não lê nem escreve'),
        linhaRegra('Apagar', 'a sua mensagem, ou qualquer uma pelo ADM'),
        linhaRegra('Limite', '5 mensagens a cada 10 segundos')),
    ];
  }

  // ---------- início ----------
  function iniciar() {
    // volta do link do e-mail (confirmar conta / senha nova): o Supabase manda tudo depois do #
    const h = new URLSearchParams(location.hash.slice(1));
    linkEmail = h.has('access_token') ? { tipo: h.get('type') } : null;
    if (h.has('error_code') || h.has('error_description')) {
      history.replaceState(null, '', location.pathname + location.search);
      setTimeout(() => toast(h.get('error_code') === 'otp_expired'
        ? 'Esse link venceu ou já foi usado. Entre com e-mail e senha, ou peça outro.'
        : 'Não deu pra abrir esse link. Tenta entrar de novo.', true), 600);
    }
    document.querySelectorAll('[data-tag]').forEach((n) => { n.textContent = TAG; });
    document.title = `Ranking Clã ${TAG}`;
    const mes = new Date().toLocaleDateString('pt-BR', { month: 'long' });
    $('seloPeriodo').textContent = `TEMPORADA DE ${mes.toUpperCase()}`;
    $('printOpc').textContent = PRINT_OBRIGATORIO ? '' : '(opcional)';

    renderTabelaPontos();
    ligarControlesChat();
    $('stCemRot').textContent = `PARTIDAS ${marcoTxt}`;
    $('thCem').textContent = marcoTxt;

    // abas de período e de ordem
    document.querySelectorAll('.aba[data-periodo]').forEach((a) => a.addEventListener('click', () => {
      periodo = a.dataset.periodo;
      document.querySelectorAll('.aba[data-periodo]').forEach((x) => x.setAttribute('aria-selected', String(x === a)));
      render();
    }));
    document.querySelectorAll('.aba[data-modo]').forEach((a) => {
      a.setAttribute('aria-selected', String(a.dataset.modo === modo));
      a.addEventListener('click', () => {
        modo = a.dataset.modo;
        document.querySelectorAll('.aba[data-modo]').forEach((x) => x.setAttribute('aria-selected', String(x === a)));
        render();
      });
    });
    $('fNome').addEventListener('input', () => {
      const k = chave($('fNome').value);
      const r = elenco.get(k);
      $('avisoNick').textContent = !k || !elencoOk ? '' : !r ? 'Jogador novo: entra no elenco do clã ao registrar.' : !r.ativo ? 'Era ex-membro: volta pro clã ao registrar.' : '';
      renderSugNick();
    });
    $('fNome').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('fMassa').focus(); } });

    // jogadores do clã
    opcoesCargo($('fCargo'), CARGO_PADRAO);
    document.querySelectorAll('.aba[data-perjog]').forEach((a) => a.addEventListener('click', () => { perJog = a.dataset.perjog; renderJogadores(); }));
    document.querySelectorAll('.aba[data-vista]').forEach((a) => a.addEventListener('click', () => { vistaJog = a.dataset.vista; renderJogadores(); }));
    $('fBusca').addEventListener('input', () => { buscaJog = $('fBusca').value.trim(); renderJogadores(); });
    $('fFiltro').addEventListener('change', () => { filtroJog = $('fFiltro').value; renderJogadores(); });
    $('btnCsv').addEventListener('click', () => {
      if (!planilha || planilha.linhas.length < 2) { toast('A tabela está vazia.', true); return; }
      baixarCsv(planilha.nome, planilha.linhas);
    });
    $('btnCsvPartidas').addEventListener('click', baixarPartidas);
    $('formCadastro').addEventListener('submit', cadastrar);
    $('fNicks').addEventListener('input', previaCadastro);
    $('formJogador').addEventListener('submit', salvarJogador);
    $('btnCancelarJog').addEventListener('click', () => $('dlgJogador').close());
    $('btnApagarJog').addEventListener('click', apagarJogador);

    // torneios
    formLanc = $('formLanc');
    montarFormatos();
    $('btnNovoTorneio').addEventListener('click', () => abrirBuilder());
    $('formTorneio').addEventListener('submit', salvarBuilder);
    $('btnCancelarTn').addEventListener('click', () => $('dlgTorneio').close());
    $('btnFecharTn').addEventListener('click', () => $('dlgTorneio').close());
    $('btnApagarTn').addEventListener('click', apagarTn);
    document.querySelectorAll('#tnMetricas [data-metrica]').forEach((b) => b.addEventListener('click', () => { tnEstado.metrica = b.dataset.metrica; atualizarBuilder(); }));
    document.querySelectorAll('#tnQuem [data-todos]').forEach((b) => b.addEventListener('click', () => { tnEstado.todos = b.dataset.todos === '1'; atualizarBuilder(); }));
    ['tnUnidade', 'tnQtd', 'tnMeta', 'tnInicio', 'tnFim', 'tnAuto', 'tnSemente', 'tnBase'].forEach((id) => $(id).addEventListener(id === 'tnAuto' || id === 'tnSemente' || id === 'tnBase' ? 'change' : 'input', atualizarBuilder));
    $('tnRegras').addEventListener('change', renderResumoBuilder);
    $('tnMeta').addEventListener('blur', () => { const v = lerMetaBuilder(); if (v) $('tnMeta').value = fmt(v); });
    $('tnBuscaJog').addEventListener('input', renderEscolher);
    $('tnBuscaJog').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    $('tnMarcarTodos').addEventListener('click', () => {
      const q = busca($('tnBuscaJog').value);
      jogadores.filter((r) => r.ativo && (!q || busca(r.nick).includes(q))).forEach((r) => tnEstado.sel.add(r.id));
      renderEscolher();
      renderResumoBuilder();
    });
    $('tnLimpar').addEventListener('click', () => { tnEstado.sel.clear(); renderEscolher(); renderResumoBuilder(); });
    formLanc.addEventListener('submit', lancar);
    fl('lancValor').addEventListener('input', mostrarLanc);
    fl('lancValor').addEventListener('blur', () => {
      const t = torneios.find((x) => x.id === formLanc.dataset.torneio);
      const r = t ? lerLanc(t) : {};
      if (r.valor != null && !r.erro) fl('lancValor').value = fmt(r.valor);
    });
    fl('lancPrint').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { limparPrintLanc(); erroLanc('O print precisa ser PNG, JPG ou WEBP.'); return; }
      if (f.size > 15 * 1024 * 1024) { limparPrintLanc(); erroLanc('Imagem grande demais (máximo 15 MB).'); return; }
      arquivoLanc = f;
      fl('lancPrintNome').textContent = f.name;
      erroLanc(null);
    });
    $('formDuelo').addEventListener('submit', salvarDuelo);
    $('btnCancelarDuelo').addEventListener('click', () => $('dlgDuelo').close());
    $('btnLimparDuelo').addEventListener('click', limparDuelo);
    setInterval(tickContagens, 1000);

    $('fMassa').addEventListener('input', () => { confirmarPequena = null; mostrarMassa(); });
    // ao sair do campo, deixa o número no formato certo (52 mil -> 52.000)
    $('fMassa').addEventListener('blur', () => {
      const r = lerMassa($('fMassa').value);
      if (r.valor && r.valor <= MASSA_MAX) $('fMassa').value = fmt(r.valor);
    });
    $('btnMil').addEventListener('mousedown', (e) => e.preventDefault()); // não fecha o teclado do celular
    $('btnMil').addEventListener('click', multiplicarMil);

    // busca rápida e barra de baixo
    $('btnBusca').addEventListener('click', abrirBusca);
    $('bbBusca').addEventListener('click', abrirBusca);
    $('bbRegistrar').addEventListener('click', irRegistrar);
    $('btnFecharBusca').addEventListener('click', () => $('dlgBusca').close());
    $('fBuscaGlobal').addEventListener('input', renderBusca);
    $('fBuscaGlobal').addEventListener('keydown', (e) => { if (e.key === 'Enter' && achados[0]) { e.preventDefault(); irPerfil(achados[0].r.chave); } });
    $('buscaAtalhos').addEventListener('click', (e) => { if (e.target.closest('a')) $('dlgBusca').close(); });
    $('bbMais').addEventListener('click', abrirMais);
    $('btnTabelaToda').addEventListener('click', () => {
      tabelaToda = !tabelaToda;
      render();
      if (!tabelaToda) rolarJa($('tabela'));
    });
    $('btnPartidasMais').addEventListener('click', () => { partidasQtd += PARTIDAS_PASSO; renderPartidas(); });
    $('btnHallMais').addEventListener('click', () => { hallQtd += 12; renderHall(); });
    $('btnFecharMais').addEventListener('click', () => $('dlgMais').close());
    // botões ⓘ (data-info="temporada" | "patentes" | "pontos") abrem as regras
    document.addEventListener('click', (e) => {
      const bt = e.target.closest('[data-info]');
      if (!bt) return;
      e.preventDefault();
      if ($('dlgMais').open) $('dlgMais').close();
      abrirRegras(bt.dataset.info);
    });
    document.querySelectorAll('.aba[data-regra]').forEach((a) => a.addEventListener('click', () => abrirRegras(a.dataset.regra)));
    $('btnFecharRegras').addEventListener('click', () => $('dlgRegras').close());
    $('maisGrade').addEventListener('click', (e) => { if (e.target.closest('a')) $('dlgMais').close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
      if (e.target.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      abrirBusca();
    });
    // já abre na página certa, antes mesmo dos dados chegarem
    mostrarPagina(false);

    // formulário
    $('registrar').addEventListener('submit', enviar);
    $('fPrint').addEventListener('change', (e) => escolherArquivo(e.target.files[0]));
    const zona = $('zonaPrint');
    zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('arrastando'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('arrastando'));
    zona.addEventListener('drop', (e) => { e.preventDefault(); zona.classList.remove('arrastando'); escolherArquivo(e.dataTransfer.files[0]); });
    document.addEventListener('paste', (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) escolherArquivo(item.getAsFile());
    });

    // admin
    $('btnAdmin').addEventListener('click', () => { if (admin) sairAdmin(); else abrirEntrar('entrar'); });
    $('btnNaoApagar').addEventListener('click', () => $('dlgConfirma').close());
    $('btnSimApagar').addEventListener('click', confirmou);
    // o PIN antigo ficava salvo no aparelho; não serve mais pra nada
    try { localStorage.removeItem('ranking_pin'); sessionStorage.removeItem('ranking_pin'); } catch (e) {}

    // perfil: página com link próprio, botão voltar do celular/navegador funciona
    $('btnEu').addEventListener('click', () => { const k = lerEu(); if (k) abrirPerfil(k); else abrirEntrar(contaSemJogador ? 'nick' : 'entrar'); });
    // entrar / criar conta
    $('formEntrar').addEventListener('submit', enviarEntrar);
    $('btnCancelarEntrar').addEventListener('click', () => $('dlgEntrar').close());
    $('btnEsqueci').addEventListener('click', () => { trocarModoEntrar('esqueci'); focoEntrar(); });
    document.querySelectorAll('[data-entrar]').forEach((a) => a.addEventListener('click', () => { trocarModoEntrar(a.dataset.entrar); focoEntrar(); }));
    $('btnTirarLogin').addEventListener('click', tirarLogin);
    $('btnSouEuAdmin').addEventListener('click', souEuAdmin);
    addEventListener('popstate', () => mostrarRota());
    // links do menu (#ranking, #jogadores...): o site troca de página sozinho, de qualquer lugar
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
      e.preventDefault();
      irPara(a.getAttribute('href'));
    });
    // fechou a taça aberta pelo link: tira o ?trofeu= pra não abrir de novo no F5 e mostra a sala de troféus
    $('dlgTrofeu').addEventListener('close', () => {
      if (new URLSearchParams(location.search).has('trofeu')) { history.replaceState({}, '', location.pathname + '#temporadas'); mostrarRota(false, false); }
    });
    // fechar janelas tocando fora delas
    ['dlgPrint', 'dlgBusca', 'dlgTrofeu', 'dlgMais', 'dlgRegras'].forEach((id) => $(id).addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const fora = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if (e.target === e.currentTarget && fora) e.currentTarget.close();
    }));

    // portão: entrar, criar conta, escolher nick, conferir pedido, sair
    $('btnPortaoEntrar').addEventListener('click', () => abrirEntrar('entrar'));
    $('btnPortaoCriar').addEventListener('click', () => abrirEntrar('criar'));
    $('btnPortaoNick').addEventListener('click', () => abrirEntrar('nick'));
    $('btnPortaoConferir').addEventListener('click', conferirPedido);
    $('btnPortaoSair').addEventListener('click', sairConta);
    trancar('carregando');

    if (DEMO) {
      $('avisoDemo').hidden = false;
      partidas = dadosDemo();
      jogadores = elencoDemo();
      indexarElenco();
      const tn = torneiosDemo();
      torneios = tn.lista;
      lancamentos = tn.lanc;
      trancar('visitante');
      return;
    }

    if (!window.supabase) {
      $('portaoTxt').textContent = 'Não consegui carregar o sistema do ranking. Confere a internet e recarrega a página.';
      return;
    }
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
    // sessão expirou ou saiu em outra aba: fecha o site de novo
    // link de senha nova do e-mail: abre a janela pra criar a senha
    sb.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT' && (admin || euId || meuPedido || contaSemJogador)) setTimeout(() => sairDaConta(), 0);
      if (evento === 'PASSWORD_RECOVERY') setTimeout(() => { if (!($('dlgEntrar').open && modoEntrar === 'nova')) abrirEntrar('nova'); }, 0);
    });
    lerConta()
      .catch((e) => { console.error(e); admin = null; euId = null; meuPedido = null; contaSemJogador = false; })
      .then(async () => {
        if (/access_token=/.test(location.hash)) history.replaceState(history.state, '', location.pathname + location.search);
        if (linkEmail && linkEmail.tipo === 'recovery') {
          if (podeVer()) await abrirSite(); else trancar();
          if (!$('dlgEntrar').open) abrirEntrar('nova');
        } else if (linkEmail && linkEmail.tipo === 'signup') {
          await depoisDeEntrar(true);
        } else if (podeVer()) {
          await abrirSite();
        } else {
          trancar();
          if (contaSemJogador) abrirEntrar('nick');
        }
      })
      .catch((e) => {
        console.error(e);
        trancar(podeVer() ? 'carregando' : undefined);
        $('portaoTxt').textContent = 'Não consegui ler o ranking agora. Confere a internet e recarrega a página.';
      });
  }

  iniciar();
})();
