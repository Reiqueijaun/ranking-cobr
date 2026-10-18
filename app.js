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
  // prêmio em Pix pro top 3 em pontos de cada temporada (vale a partir de outubro de 2026)
  const PREMIOS = [30, 15, 5];
  const PREMIOS_DESDE = new Date(2026, 9, 1).getTime();
  const temPremio = (t) => t.inicio >= PREMIOS_DESDE;
  // doação pro clã: chave Pix (celular) e o mesmo código do pix-qr.svg, pra copiar e colar no banco
  const PIX_CHAVE = '91984127730';
  const PIX_COPIA_COLA = '00020126360014br.gov.bcb.pix0114+55919841277305204000053039865802BR5908CLA COBR6005BELEM62070503***63041B13';

  const $ = (id) => document.getElementById(id);
  let sb = null;
  let partidas = [];          // todas as pontuações, mais novas primeiro
  let periodo = 'mes';        // abre na temporada (mês atual)
  let modo = CFG.RANKING_POR === 'massa' ? 'massa' : 'pontos';
  let admin = null;           // { nome } quando quem está usando é admin (login do Supabase)
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
    cachePts = null;
    cacheTrofeus = null;
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
    renderPatentes(ctx);
    renderTemporadas(ctx);
    renderHall();
    renderPartidas();
    renderJogadores();

    // só admin vê os formulários (e o banco confere de novo em cada ação)
    $('registrar').hidden = !admin;
    $('comoEntrar').hidden = !!admin;
    $('btnTopoRegistrar').hidden = !admin;
    $('bbRegistrar').hidden = !admin;
    $('bbBusca').hidden = !!admin;
    $('formCadastro').hidden = !admin || !elencoOk;
    $('avisoElenco').hidden = !admin || elencoOk;
    document.body.classList.toggle('modo-dono', !!admin);

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
        avatarDe(r.nick, s ? s.pontos : 0),
        el('span', { class: 'busca-info' },
          el('span', { class: 'busca-nome' }, el('span', { class: 'busca-nick', text: r.nick }), !r.ativo ? el('span', { class: 'ex-chip', text: 'EX' }) : null),
          el('span', { class: 'busca-sub', text: s ? `${ptsTxt(s.pontos)} · recorde ${fmt(s.melhor.mass)} · ${s.qtd} ${s.qtd === 1 ? 'partida' : 'partidas'}` : 'ainda sem partida' })),
        chipPatente(s ? s.pontos : 0, 'busca-pat')))));
  }
  function irPerfil(k) {
    $('dlgBusca').close();
    abrirPerfil(k);
  }

  // ---------- barra de baixo (celular) ----------
  function irRegistrar() {
    $('registrar').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('fNome').focus({ preventScroll: true });
  }
  function ligarBarraBaixo() {
    const links = [...document.querySelectorAll('#barraBaixo a[data-sec]')];
    // qual seção da página conta como qual botão
    const alvos = [['torneios', 'torneios'], ['ranking', 'ranking'], ['tabela', 'ranking'], ['temporadas', 'ranking'], ['patentes', 'patentes'], ['jogadores', 'jogadores'], ['hall', 'partidas'], ['partidas', 'partidas']];
    let pedido = false;
    const marcar = () => {
      pedido = false;
      const linha = innerHeight * 0.4;
      let atual = null, maior = -Infinity;
      for (const [id, sec] of alvos) {
        const n = $(id);
        if (!n || n.hidden) continue;
        const t = n.getBoundingClientRect().top;
        if (t <= linha && t > maior) { maior = t; atual = sec; }
      }
      if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) atual = 'partidas';
      links.forEach((a) => a.classList.toggle('ativo', a.dataset.sec === atual));
    };
    addEventListener('scroll', () => { if (!pedido) { pedido = true; requestAnimationFrame(marcar); } }, { passive: true });
    marcar();
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
    const geral = new Map(montarRanking('geral', 'pontos', true).map((j) => [j.chave, j]));
    const ptsGeral = (k) => (geral.get(k) || { pontos: 0 }).pontos;
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
    $('jogResumo').textContent = `${fmt(ativos.length)} ${ativos.length === 1 ? 'jogador' : 'jogadores'} no clã${ex ? ` · ${fmt(ex)} ${ex === 1 ? 'ex-membro' : 'ex-membros'}` : ''}. Toque no nome pra ver o perfil.`;
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
      { id: 'ptsGeral', rot: 'PATENTE', ord: true, titulo: 'Patente pelos pontos de todas as partidas' },
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
    $('notaJog').textContent = perJog === 'geral'
      ? `Pontos, partidas e recorde de todas as partidas. A patente sempre conta tudo.`
      : `Pontos, partidas e recorde só ${textoPer[perJog]}. A patente sempre conta tudo.`;

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
    $('notaJog').textContent = `Pontos por ${tipo === 'semanas' ? 'semana (segunda a domingo)' : 'mês'}. O número pequeno é quantas partidas. Destaque laranja = quem mais pontuou naquela ${tipo === 'semanas' ? 'semana' : 'mês'}.`;

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

  function geralPts(j) {
    if (periodo === 'geral') return j.pontos;
    const g = montarRanking('geral', 'pontos').find((x) => x.chave === j.chave);
    return g ? g.pontos : 0;
  }

  function renderPodio(rank, ctx) {
    const box = $('podio');
    if (!rank.length) {
      const ultima = ctx.temps.find((t) => !t.atual);
      const msg = periodo === 'geral'
        ? `Ninguém entrou no ranking ainda. Joga com a tag [${TAG}] que o dono puxa sua massa do servidor!`
        : periodo === 'mes'
          ? `A temporada de ${nomeMes(Date.now())} começou e ninguém pontuou ainda. O pódio está livre!${ultima ? ` Campeão de ${nomeMes(ultima.inicio)}: ${comTag(ultima.top[0].nome)}.` : ''}`
          : 'Ninguém registrou massa nesta semana ainda.';
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
      return el('article', { class: `lugar l${i + 1}` },
        i === 0 ? svg(ICONE_COROA, 40, 'class="coroa"') : null,
        el('div', { class: 'avatar', 'aria-hidden': 'true', text: j.nome.charAt(0).toUpperCase() }),
        el('div', null,
          el('div', { class: 'lugar-pos', text: i === 0 ? '1º LUGAR · REI DO CLÃ' : `${i + 1}º LUGAR` }),
          btnPerfil(j, 'lugar-nome'),
          el('div', { class: 'lugar-pat' }, chipPatente(geralPts(j)))),
        el('div', { class: 'lugar-massa', text: fmt(valor(j)) }),
        el('div', { class: 'lugar-data', text: linha }),
        j.cem ? el('div', { class: 'cem-selo', text: `${j.cem}× ${marcoTxt}` }) : null,
        periodo === 'mes' && modo === 'pontos' ? el('div', { class: `premio-selo pv${i + 1}`, text: `VALE R$ ${PREMIOS[i]} NO PIX` }) : null,
        el('div', { class: 'barra', 'aria-hidden': 'true' }, el('span', { style: `width:${Math.max(4, Math.round(valor(j) / topo * 100))}%` })),
        url ? el('button', { type: 'button', class: 'ver-print', text: 'Ver print do recorde', onclick: () => abrirPrint(j.melhor) }) : null
      );
    }));
  }

  function chipTitulos(n) {
    if (!n) return null;
    return el('span', { class: 'titulo-chip', title: `${n}× campeão de temporada` }, svg(ICONE_TROFEU, 12), n > 1 ? `${n}×` : null);
  }

  function renderTabela(rank, ctx) {
    const corpo = $('corpoTabela');
    $('thPontos').classList.toggle('ativo', modo === 'pontos');
    $('thRecorde').classList.toggle('ativo', modo === 'massa');
    if (!rank.length) {
      corpo.replaceChildren(el('tr', null, el('td', { colspan: '6', class: 'vazio-cel', text: 'A tabela aparece aqui assim que a primeira massa for registrada.' })));
      return;
    }
    const doisDias = Date.now() - 24 * 3600 * 1000;
    corpo.replaceChildren(...rank.map((j, i) => {
      const novo = new Date(j.melhor.created_at).getTime() > doisDias;
      return el('tr', { class: i === 0 ? 'topo1' : null },
        el('td', { class: `pos p${i + 1}`, text: `#${i + 1}` }),
        el('td', { class: 'nome-cel' }, el('div', { class: 'nome-linha' }, avatarDe(j.nome, geralPts(j), 'av-p'), btnPerfil(j, 'link-nome forte'), chipPatente(geralPts(j)), chipTitulos(ctx.titulos.get(j.chave)), ...chipTorneios(j.chave, true), novo ? el('span', { class: 'chip', text: '▲ RECORDE NOVO' }) : null),
          el('div', { class: 'nome-melhor' }, 'melhor: ', b(ptsTxt(pontosDe(j.melhor.mass))), ` · ${fmt(j.melhor.mass)} massa`)),
        el('td', { class: `dir ${modo === 'pontos' ? 'num' : 'sec'}`, text: fmt(j.pontos) }),
        el('td', { class: 'dir' }, j.cem ? el('span', { class: 'cem-chip', text: `${j.cem}×` }) : el('span', { class: 'sec', text: '—' })),
        el('td', { class: `dir ${modo === 'massa' ? 'num' : 'sec'}`, text: fmt(j.melhor.mass) }),
        el('td', { class: 'dir sec', text: fmt(j.qtd) })
      );
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

  function renderPartidas() {
    const ul = $('listaPartidas');
    $('adminTag').hidden = !admin;
    const lista = partidas.slice(0, admin ? 200 : 12);
    if (!lista.length) { ul.replaceChildren(el('li', { class: 'vazio', text: 'Nenhuma partida registrada ainda.' })); return; }
    ul.replaceChildren(...lista.map((p) => {
      const url = urlPrint(p);
      const pts = pontosDe(p.mass);
      return el('li', { class: `partida ${p.mass >= MARCO ? 'cem' : ''}` },
        url
          ? el('button', { type: 'button', class: 'mini', 'aria-label': `Ver print de ${limparNick(p.player)}`, onclick: () => abrirPrint(p) },
              el('img', { src: url, alt: '', loading: 'lazy' }))
          : el('span', { class: 'mini', text: 'sem print' }),
        el('div', { class: 'partida-info' },
          el('span', { class: 'partida-nome', text: comTag(limparNick(p.player)) }),
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
  const PATENTES = (Array.isArray(CFG.PATENTES) && CFG.PATENTES.length ? CFG.PATENTES : [
    { nome: 'Recruta', pontos: 0 },
    { nome: 'Guerreiro', pontos: 100 },
    { nome: 'Elite', pontos: 300 },
    { nome: 'Mestre', pontos: 600 },
    { nome: 'Grão-Mestre', pontos: 1200 },
    { nome: 'Lendário', pontos: 2500 },
  ]).map((x) => ({ nome: String(x.nome || '?'), pontos: Number(x.pontos) || 0 }))
    .sort((a, b) => a.pontos - b.pontos)
    .map((x, i) => ({ ...x, nivel: i, cor: CORES_PATENTE[i % CORES_PATENTE.length] }));
  if (PATENTES[0].pontos > 0) PATENTES[0].pontos = 0;

  function patenteDe(pontos) {
    let atual = PATENTES[0];
    for (const t of PATENTES) if (pontos >= t.pontos) atual = t;
    const prox = PATENTES[atual.nivel + 1] || null;
    const progresso = prox ? (pontos - atual.pontos) / (prox.pontos - atual.pontos) : 1;
    return { atual, prox, progresso: Math.max(0, Math.min(1, progresso)) };
  }
  function chipPatente(pontos, extra = '') {
    const { atual } = patenteDe(pontos);
    return el('span', { class: `patente ${extra}`, style: `--pc:${atual.cor}` }, svg(ICONE_PATENTE, 12), atual.nome);
  }
  const ICONE_PATENTE = '<path d="M12 3l8 3.5v5.5c0 4.5-3.4 8-8 9.5-4.6-1.5-8-5-8-9.5V6.5z"/><path d="M8 10.5l4 3 4-3"/>';
  function avatarDe(nome, pontos, tam = '') {
    const { atual } = patenteDe(pontos);
    return el('span', { class: `av ${tam}`, style: `--pc:${atual.cor}`, 'aria-hidden': 'true', text: nome.charAt(0).toUpperCase() });
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
        ? el('div', { class: 'dq-corpo' }, avatarDe(s1.nome, montarRanking('geral', 'pontos').find((x) => x.chave === s1.chave)?.pontos || 0, 'av-m'),
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
  function renderPatentes(ctx) {
    const porNivel = new Map();
    for (const j of ctx.pontos) {
      const n = patenteDe(j.pontos).atual.nivel;
      if (!porNivel.has(n)) porNivel.set(n, []);
      porNivel.get(n).push(j);
    }
    $('escadaPatentes').replaceChildren(...[...PATENTES].reverse().map((t) => {
      const gente = porNivel.get(t.nivel) || [];
      return el('li', { class: `degrau ${gente.length ? '' : 'vazio-d'}`, style: `--pc:${t.cor}` },
        el('span', { class: 'degrau-ins', 'aria-hidden': 'true' }, svg(ICONE_PATENTE, 18)),
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

  // ---------- campeões das temporadas ----------
  function fechaTemporadaTxt(fim) {
    const h = Math.max(0, Math.round((fim - Date.now()) / 3600000));
    if (h < 24) return h < 1 ? 'fecha em instantes' : `fecha em ${h} h`;
    const d = Math.round(h / 24);
    return `fecha em ${d} ${d === 1 ? 'dia' : 'dias'}`;
  }
  // sala de troféus: a taça em disputa primeiro, depois as já entregues
  function renderTemporadas(ctx) {
    const temps = ctx.temps;
    $('temporadas').hidden = !temps.length;
    const fechadas = temps.filter((t) => !t.atual).length;
    $('tempQtd').textContent = fechadas ? `${fechadas} ${fechadas === 1 ? 'taça entregue' : 'taças entregues'}` : 'a primeira taça está em disputa';
    $('listaTemporadas').replaceChildren(...temps.map((t, i) => {
      const c = t.top[0];
      const num = temps.length - i;
      return el('li', { class: `tr-item ${t.atual ? 'tr-disputa' : ''}`, style: `--gema:${gemaDe(t)[1]}` },
        el('button', { type: 'button', class: 'tr-vitrine', onclick: () => abrirTrofeu(chaveTemp(t)), 'aria-label': t.atual ? `Taça de ${nomeMes(t.inicio)}, em disputa` : `Taça de ${nomeMes(t.inicio)}: ${comTag(c.nome)} campeão` },
          trofeuDe(t),
          t.atual ? el('span', { class: 'tr-selo', text: 'EM DISPUTA' }) : null),
        el('div', { class: 'tr-info' },
          el('div', { class: 'tr-mes' }, el('span', { text: rotTemp(t) }), el('small', { text: t.atual ? fechaTemporadaTxt(t.fim) : `temporada ${num}` })),
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
        el('span', { class: 'cer-rot', text: festa && !t.atual ? `A TEMPORADA DE ${nomeMes(t.inicio).toUpperCase()} FECHOU!` : `TEMPORADA ${temps.length - i} · ${nomeMes(t.inicio).toUpperCase()} ${ano}` }),
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
          k < 3 && temPremio(t) ? el('span', { class: `tt-premio pv${k + 1}`, title: t.atual ? 'prêmio em Pix se fechar assim' : 'prêmio em Pix', text: `R$ ${PREMIOS[k]}` }) : null,
          el('span', { class: 'tt-pts', text: ptsTxt(j.pontos) })))),
        t.top.length > 5 ? el('p', { class: 'cer-mais', text: `${t.top.length} jogadores pontuaram nessa temporada` }) : null,
        el('p', { class: 'cer-gema' }, el('span', { class: 'cer-gema-cor', 'aria-hidden': 'true' }), `Pedra da temporada: ${gemaNome}`),
        el('div', { class: 'linha-btns' },
          el('button', { type: 'button', class: 'btn btn-sec', onclick: () => compartilharTrofeu(t) }, svg(ICONE_LINK, 18), 'Compartilhar'),
          el('button', { type: 'button', class: 'btn btn-pri', onclick: () => abrirPerfil(c.chave) }, t.atual ? 'Ver o líder' : 'Ver o campeão'))));
    const dlg = $('dlgTrofeu');
    dlg.style.setProperty('--gema', gemaCor);
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
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

  // ---------- hall da fama ----------
  function renderHall() {
    const lista = partidas.filter((p) => p.mass >= MARCO).sort((a, b) => b.mass - a.mass);
    $('hall').hidden = !lista.length;
    $('hallMarco').textContent = marcoTxt;
    $('hallQtd').textContent = `${lista.length} ${lista.length === 1 ? 'partida' : 'partidas'} no clã`;
    const pts = new Map(montarRanking('geral', 'pontos').map((j) => [j.chave, j]));
    $('listaHall').replaceChildren(...lista.slice(0, 12).map((p, i) => {
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

  // "este sou eu": cada um marca o próprio perfil no aparelho e acha ele no topo
  function lerEu() { try { return localStorage.getItem('ranking_eu') || null; } catch (e) { return null; } }
  function guardarEu(k) { try { if (k) localStorage.setItem('ranking_eu', k); else localStorage.removeItem('ranking_eu'); } catch (e) {} }
  function renderEu() {
    const k = lerEu();
    const r = k && listaElenco().find((x) => x.chave === k);
    const btn = $('btnEu');
    btn.hidden = !r;
    if (!r) return;
    const pts = (montarRanking('geral', 'pontos', true).find((x) => x.chave === k) || { pontos: 0 }).pontos;
    btn.replaceChildren(avatarDe(r.nick, pts, 'av-p'), el('span', { class: 'btn-txt', text: 'Meu perfil' }));
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
  function mostrarRota(novo = false) {
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
      if (novo || antes !== k) scrollTo(0, 0);
    } else if (tn) {
      renderTorneioPagina();
      tickContagens();
      if (novo || antesTn !== tn) scrollTo(0, 0);
    } else {
      document.title = `Ranking Clã ${TAG}`;
      if (antes || antesTn) scrollTo(0, rolagemAntes);
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
        el('button', { type: 'button', class: `btn btn-sec ${lerEu() === k ? 'pp-eu-on' : ''}`, 'aria-pressed': String(lerEu() === k), onclick: () => {
          guardarEu(lerEu() === k ? null : k);
          renderEu();
          renderPerfil();
          toast(lerEu() === k ? 'Pronto! Seu perfil fica no botão do topo.' : 'Perfil desmarcado.');
        } }, svg(ICONE_EU, 18), el('span', { class: 'btn-txt', text: lerEu() === k ? 'Este sou eu' : 'Sou eu' })),
        el('button', { type: 'button', class: 'btn btn-sec', onclick: () => compartilharPerfil(nome) }, svg(ICONE_LINK, 18), el('span', { class: 'btn-txt', text: 'Compartilhar' }))) : null);

    if (!nome) {
      document.title = `Jogador não encontrado · Ranking Clã ${TAG}`;
      box.replaceChildren(barra, el('p', { class: 'vazio', text: 'Não achei esse jogador. Confere o nick no link ou procure na busca.' }));
      return;
    }
    document.title = `${comTag(nome)} · Ranking Clã ${TAG}`;

    const pts = j ? j.pontos : 0;
    const pat = patenteDe(pts);
    const ativo = !r || r.ativo;

    // cabeçalho
    const posGeral = posicao(ctx.pontos, k);
    const topo = el('header', { class: 'pp-topo', style: `--pc:${pat.atual.cor}` },
      el('div', { class: 'pp-id' },
        avatarDe(nome, pts, 'av-xg'),
        el('div', { class: 'pp-nome-box' },
          el('span', { class: 'pp-tag', text: `[${TAG}]` }),
          el('h1', { id: 'perfilNome', class: 'pp-nome', text: nome }),
          el('div', { class: 'perfil-chips' }, chipPatente(pts, 'patente-g'), chipTitulos(ctx.titulos.get(k)), ...chipTorneios(k), ...chipsCadastro(r)))),
      posGeral ? el('div', { class: `pp-pos-geral p${posGeral}` },
        el('span', { class: 'pp-pos-num', text: `#${posGeral}` }),
        el('span', { class: 'pp-pos-rot', text: `de ${ctx.pontos.length} no ranking geral` })) : null);

    if (!j) {
      box.replaceChildren(barra, topo, el('p', { class: 'vazio perfil-vazio', text: 'Ainda não tem partida registrada. Joga com a tag no nick que o dono puxa a massa do servidor!' }));
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

    // patente
    const prog = el('div', { class: 'perfil-prog', style: `--pc:${pat.atual.cor}` },
      el('div', { class: 'prog-linha' },
        el('span', { text: pat.atual.nome }),
        el('span', { class: 'sec', text: pat.prox ? `${fmt(pts)} / ${fmt(pat.prox.pontos)} pts` : `${fmt(pts)} pts` }),
        el('span', { text: pat.prox ? pat.prox.nome : 'NÍVEL MÁXIMO' })),
      el('div', { class: 'barra barra-pat', role: 'progressbar', 'aria-label': 'Progresso da patente', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pat.progresso * 100)) },
        el('span', { style: `width:${Math.round(pat.progresso * 100)}%` })),
      el('div', { class: 'prog-sub', text: pat.prox ? `Faltam ${ptsTxt(pat.prox.pontos - pts)} pra virar ${pat.prox.nome}${partidasPara(pat.prox.pontos - pts)}` : 'Chegou no topo. Agora é defender o trono.' }));

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
        el('div', { class: 'pp-col' }, secaoTrofeusPerfil(k, ctx), secaoTorneiosPerfil(k), momentos, historico)));
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

  // pontos do ranking geral de cada um (pra cor da patente no avatar e pra montar a chave)
  let cachePts = null;
  function ptsGeralDe(k) {
    if (!cachePts) cachePts = new Map(montarRanking('geral', 'pontos', true).map((j) => [j.chave, j.pontos]));
    return cachePts.get(k) || 0;
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
    $('bbTorneios').hidden = !tem;
    $('bbPatentes').hidden = tem;
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
    history.pushState({}, '', location.pathname + '#torneios');
    mostrarRota();
    if (!$('torneios').hidden) $('torneios').scrollIntoView();
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
    else ids.sort((a, b) => ptsGeralDe(chave(nickId(b))) - ptsGeralDe(chave(nickId(a))) || nickId(a).localeCompare(nickId(b), 'pt-BR'));
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
      const ptsAntes = (montarRanking('geral', 'pontos').find((x) => x.chave === chave(nome)) || { pontos: 0 }).pontos;
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
      const ptsDepois = (montarRanking('geral', 'pontos').find((x) => x.chave === chave(nome)) || { pontos: 0 }).pontos;
      const patAntes = patenteDe(ptsAntes).atual, patDepois = patenteDe(ptsDepois).atual;
      if (patDepois.nivel > patAntes.nivel) {
        toast(`⬆ ${comTag(nome)} subiu pra ${patDepois.nome.toUpperCase()}!${ganhou}`);
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
  async function lerAdmin() {
    if (DEMO) return admin;
    const { data } = await sb.auth.getSession();
    if (!data.session) return null;
    const r = await sb.rpc('admin_eu');
    return !r.error && r.data ? { nome: r.data } : null;
  }
  function aplicarAdmin(novo) {
    admin = novo;
    $('btnAdmin').textContent = admin ? `Sair da área do admin (${admin.nome})` : 'Área do admin';
    render();
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

  function msgLogin(error) {
    if (error.status === 429 || /rate limit|too many/i.test(error.message)) return 'Muitas tentativas. Espera alguns minutos e tenta de novo.';
    if (/invalid login credentials/i.test(error.message)) return 'E-mail ou senha errados.';
    if (/email not confirmed/i.test(error.message)) return 'Esse e-mail ainda não foi confirmado.';
    return 'Não consegui entrar agora. Tenta de novo.';
  }

  async function entrarAdmin(ev) {
    ev.preventDefault();
    const email = $('fEmail').value.trim();
    const senha = $('fSenha').value;
    const erro = $('erroAdmin');
    const btn = $('btnEntrar');
    const falhar = (msg) => { erro.textContent = msg; erro.hidden = false; };
    erro.hidden = true;
    if (!email || !senha) return falhar('Preencha o e-mail e a senha.');
    btn.disabled = true;
    try {
      let novo;
      if (DEMO) {
        if (senha !== '1234') return falhar('E-mail ou senha errados. (Na demonstração, a senha é 1234.)');
        novo = { nome: email.split('@')[0] };
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password: senha });
        if (error) return falhar(msgLogin(error));
        novo = await lerAdmin();
        if (!novo) { await sb.auth.signOut(); return falhar('Essa conta não tem acesso de admin.'); }
      }
      $('fSenha').value = '';
      $('dlgAdmin').close();
      aplicarAdmin(novo);
      toast(`Bem-vindo, ${novo.nome}. Área do admin liberada.`);
      if (!perfilAtual) $('registrar').scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
      console.error(e);
      falhar('Não consegui entrar agora. Confere a internet e tenta de novo.');
    } finally {
      btn.disabled = false;
    }
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
    admin = null;
    if (!DEMO && sb) await sb.auth.signOut().catch(() => {});
    aplicarAdmin(null);
    if (era && !silencioso) toast('Você saiu da área do admin.');
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
      espera = setTimeout(() => carregar().then(render).catch(() => {}), 400);
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
    setInterval(() => { if (!document.hidden) carregar().then(render).catch(() => {}); }, 60000);
  }

  // ---------- início ----------
  function iniciar() {
    document.querySelectorAll('[data-tag]').forEach((n) => { n.textContent = TAG; });
    document.title = `Ranking Clã ${TAG}`;
    const mes = new Date().toLocaleDateString('pt-BR', { month: 'long' });
    $('seloPeriodo').textContent = `TEMPORADA DE ${mes.toUpperCase()}`;
    $('printOpc').textContent = PRINT_OBRIGATORIO ? '' : '(opcional)';

    renderTabelaPontos();
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
    // doação
    $('btnPixChave').addEventListener('click', () => copiarTexto(PIX_CHAVE, 'Chave Pix copiada. Valeu pelo apoio!'));
    $('btnPixCola').addEventListener('click', () => copiarTexto(PIX_COPIA_COLA, 'Pix copia e cola copiado. Cola no app do banco.'));
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
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
      if (e.target.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      abrirBusca();
    });
    ligarBarraBaixo();

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
    $('btnAdmin').addEventListener('click', () => {
      if (admin) { sairAdmin(); return; }
      $('fSenha').value = '';
      $('erroAdmin').hidden = true;
      $('dlgAdmin').showModal();
      ($('fEmail').value ? $('fSenha') : $('fEmail')).focus();
    });
    $('btnCancelarAdmin').addEventListener('click', () => $('dlgAdmin').close());
    $('formAdmin').addEventListener('submit', entrarAdmin);
    $('btnNaoApagar').addEventListener('click', () => $('dlgConfirma').close());
    $('btnSimApagar').addEventListener('click', confirmou);
    // o PIN antigo ficava salvo no aparelho; não serve mais pra nada
    try { localStorage.removeItem('ranking_pin'); sessionStorage.removeItem('ranking_pin'); } catch (e) {}

    // perfil: página com link próprio, botão voltar do celular/navegador funciona
    $('btnEu').addEventListener('click', () => { const k = lerEu(); if (k) abrirPerfil(k); });
    addEventListener('popstate', () => mostrarRota());
    // atalhos (#ranking, #jogadores...) com o perfil aberto: volta pro ranking e rola até lá
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a || (!perfilAtual && !torneioAtual)) return;
      e.preventDefault();
      history.pushState({}, '', location.pathname + a.getAttribute('href'));
      mostrarRota();
      const alvo = a.getAttribute('href').length > 1 && document.querySelector(a.getAttribute('href'));
      if (alvo) alvo.scrollIntoView(); else scrollTo(0, 0);
    });
    // fechar janelas tocando fora delas
    // fechou a taça aberta pelo link: tira o ?trofeu= pra não abrir de novo no F5
    $('dlgTrofeu').addEventListener('close', () => {
      if (new URLSearchParams(location.search).has('trofeu')) history.replaceState({}, '', location.pathname + '#temporadas');
    });
    ['dlgPrint', 'dlgBusca', 'dlgTrofeu'].forEach((id) => $(id).addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const fora = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if (e.target === e.currentTarget && fora) e.currentTarget.close();
    }));

    if (DEMO) {
      $('avisoDemo').hidden = false;
      partidas = dadosDemo();
      jogadores = elencoDemo();
      indexarElenco();
      const tn = torneiosDemo();
      torneios = tn.lista;
      lancamentos = tn.lanc;
      render();
      mostrarRota();
      cerimoniaAutomatica();
      ligarTempoReal();
      return;
    }

    if (!window.supabase) {
      $('podio').replaceChildren(el('p', { class: 'vazio', text: 'Não consegui carregar o sistema do ranking. Confere a internet e recarrega a página.' }));
      return;
    }
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
    // sessão expirou ou saiu em outra aba: some o modo admin
    sb.auth.onAuthStateChange((evento) => { if (evento === 'SIGNED_OUT' && admin) setTimeout(() => aplicarAdmin(null), 0); });
    carregar()
      .then(async () => {
        admin = await lerAdmin().catch(() => null);
        aplicarAdmin(admin);
        mostrarRota();
        cerimoniaAutomatica();
        ligarTempoReal();
      })
      .catch((e) => {
        console.error(e);
        $('podio').replaceChildren(el('p', { class: 'vazio', text: 'Não consegui ler o ranking. Se você é o admin, confere o config.js e se o script do banco foi rodado no Supabase.' }));
      });
  }

  iniciar();
})();
