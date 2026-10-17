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
  let periodo = 'geral';
  let modo = CFG.RANKING_POR === 'massa' ? 'massa' : 'pontos';
  let pinAdmin = null;
  let arquivoPrint = null;
  let apagarId = null;

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
    for (const f of filhos.flat()) if (f != null) n.append(f.nodeType ? f : document.createTextNode(String(f)));
    return n;
  }
  function svg(path, size = 20, extra = '') {
    const w = document.createElement('span');
    w.innerHTML = `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${path}</svg>`;
    return w.firstChild;
  }
  const ICONE_COROA = '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z"/>';
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
  // PIN do dono: "lembrar" guarda no aparelho; senão só até fechar a aba
  function guardarPin(pin, lembrar) {
    try { localStorage.removeItem('ranking_pin'); sessionStorage.removeItem('ranking_pin'); } catch (e) {}
    if (!pin) return;
    try { (lembrar ? localStorage : sessionStorage).setItem('ranking_pin', pin); } catch (e) {}
  }
  function lerPin() {
    try { return localStorage.getItem('ranking_pin') || sessionStorage.getItem('ranking_pin'); } catch (e) { return null; }
  }

  function urlPrint(p) {
    if (p.print_url) return p.print_url;
    if (!p.print_path || !sb) return null;
    return sb.storage.from(BUCKET).getPublicUrl(p.print_path).data.publicUrl;
  }

  // ---------- cálculo do ranking ----------
  function inicioPeriodo(per) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    if (per === 'semana') { const dia = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dia); return d.getTime(); }
    if (per === 'mes') { d.setDate(1); return d.getTime(); }
    return 0;
  }

  // ---------- pontos ----------
  const MARCO = Number(CFG.MARCO) || 100000;
  const FAIXAS = (Array.isArray(CFG.PONTOS) && CFG.PONTOS.length ? CFG.PONTOS : [
    { minimo: 100000, pontos: 10 },
    { minimo: 50000, pontos: 5 },
    { minimo: 25000, pontos: 2 },
    { minimo: 10000, pontos: 1 },
  ]).map((f) => ({ minimo: Number(f.minimo) || 0, pontos: Number(f.pontos) || 0 }))
    .sort((a, b) => b.minimo - a.minimo);
  function pontosDe(massa) {
    const f = FAIXAS.find((x) => massa >= x.minimo);
    return f ? f.pontos : 0;
  }
  const marcoTxt = fmtK(MARCO) + '+';
  function fmtK(n) { return n >= 1000 && n % 1000 === 0 ? `${n / 1000}K` : fmt(n); }
  const ptsTxt = (n) => `${fmt(n)} ${n === 1 ? 'pt' : 'pts'}`;

  function montarRanking(per, ordem = modo) {
    const desde = inicioPeriodo(per);
    const mapa = new Map();
    // percorre do mais antigo pro mais novo para o nome mais recente prevalecer
    for (let i = partidas.length - 1; i >= 0; i--) {
      const p = partidas[i];
      if (new Date(p.created_at).getTime() < desde) continue;
      const k = chave(p.player);
      let j = mapa.get(k);
      if (!j) { j = { chave: k, nome: limparNick(p.player), melhor: p, qtd: 0, pontos: 0, cem: 0 }; mapa.set(k, j); }
      j.nome = limparNick(p.player);
      j.qtd += 1;
      j.pontos += pontosDe(p.mass);
      if (p.mass >= MARCO) j.cem += 1;
      if (p.mass > j.melhor.mass) j.melhor = p;
    }
    const porMassa = (a, b) => b.melhor.mass - a.melhor.mass || new Date(a.melhor.created_at) - new Date(b.melhor.created_at);
    const porPontos = (a, b) => b.pontos - a.pontos || b.cem - a.cem || porMassa(a, b);
    return [...mapa.values()].sort(ordem === 'massa' ? porMassa : porPontos);
  }

  function montarConquistas() {
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
        eventos.push({ tipo: 'cem', quando: p.created_at, partes: [b(nome), ' fez ', b(marcoTxt), ` (${fmt(p.mass)})`, n > 1 ? ` · ${n}ª vez` : ' pela primeira vez'] });
        marcou = true;
      }
      const antes = melhores.get(k) || 0;
      if (p.mass <= antes) continue;
      melhores.set(k, p.mass);
      if (!lider || p.mass > lider.massa) {
        if (!lider) eventos.push({ tipo: 'topo', quando: p.created_at, partes: [b(nome), ' abriu o ranking com ', b(fmt(p.mass))] });
        else if (lider.chave === k) eventos.push({ tipo: 'topo', quando: p.created_at, partes: [b(nome), ' aumentou o recorde do clã para ', b(fmt(p.mass))] });
        else eventos.push({ tipo: 'topo', quando: p.created_at, partes: [b(nome), ' passou ', b(lider.nome), ' e agora tem o recorde do clã: ', b(fmt(p.mass))] });
        lider = { chave: k, nome, massa: p.mass };
      } else if (antes > 0 && !marcou) {
        eventos.push({ tipo: 'recorde', quando: p.created_at, partes: [b(nome), ' bateu o próprio recorde: ', b(fmt(p.mass))] });
      }
    }
    return eventos.reverse().slice(0, 6);
  }
  function b(t) { return el('b', { text: t }); }

  // ---------- desenho da página ----------
  function render() {
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

    const ctx = { pontos: geralPontos, massa: geralMassa, semana: montarRanking('semana', 'pontos') };
    renderDestaques(ctx);
    renderPodio(rank);
    renderTabela(rank);
    renderConquistas();
    renderPatentes(ctx);
    renderHall();
    renderPartidas();

    // só o dono vê o formulário
    $('registrar').hidden = !pinAdmin;
    $('comoEntrar').hidden = !!pinAdmin;
    $('btnTopoRegistrar').hidden = !pinAdmin;
    document.body.classList.toggle('modo-dono', !!pinAdmin);

    const dl = $('listaNomes');
    dl.replaceChildren(...geralMassa.map((j) => el('option', { value: j.nome })));
  }

  function geralPts(j) {
    if (periodo === 'geral') return j.pontos;
    const g = montarRanking('geral', 'pontos').find((x) => x.chave === j.chave);
    return g ? g.pontos : 0;
  }

  function renderPodio(rank) {
    const box = $('podio');
    if (!rank.length) {
      const msg = periodo === 'geral'
        ? 'Ninguém entrou no ranking ainda. Manda o print da sua melhor partida pro dono do clã!'
        : `Ninguém registrou massa ${periodo === 'semana' ? 'nesta semana' : 'neste mês'} ainda.`;
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
        el('div', { class: 'barra', 'aria-hidden': 'true' }, el('span', { style: `width:${Math.max(4, Math.round(valor(j) / topo * 100))}%` })),
        url ? el('button', { type: 'button', class: 'ver-print', text: 'Ver print do recorde', onclick: () => abrirPrint(j.melhor) }) : null
      );
    }));
  }

  function renderTabela(rank) {
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
        el('td', { class: 'nome-cel' }, el('div', { class: 'nome-linha' }, avatarDe(j.nome, geralPts(j), 'av-p'), btnPerfil(j, 'link-nome forte'), chipPatente(geralPts(j)), novo ? el('span', { class: 'chip', text: '▲ RECORDE NOVO' }) : null)),
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
    $('adminTag').hidden = !pinAdmin;
    const lista = partidas.slice(0, pinAdmin ? 200 : 12);
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
        pinAdmin ? el('button', { type: 'button', class: 'apagar', 'aria-label': `Apagar pontuação de ${limparNick(p.player)}`, onclick: () => pedirApagar(p) }, svg(ICONE_LIXO)) : null
      );
    }));
  }

  function renderTabelaPontos() {
    const linhas = FAIXAS.map((f, i) => el('li', { class: i === 0 ? 'topo' : null },
      el('span', { text: i === 0 ? `${fmtK(f.minimo)} ou mais` : `${fmtK(f.minimo)} a ${fmt(FAIXAS[i - 1].minimo - 1)}` }),
      el('b', { text: ptsTxt(f.pontos) })));
    const menor = FAIXAS[FAIXAS.length - 1];
    if (menor && menor.minimo > 0) linhas.push(el('li', null, el('span', { text: `abaixo de ${fmtK(menor.minimo)}` }), el('b', { text: '0 pts' })));
    $('tabelaPontos').replaceChildren(...linhas);
  }

  // ---------- patentes ----------
  const CORES_PATENTE = ['#A8998B', '#B98BFF', '#3BA4FF', '#FFB347', '#FF7A1A', '#FFD84D', '#FF5AA0', '#3DDC84'];
  const PATENTES = (Array.isArray(CFG.PATENTES) && CFG.PATENTES.length ? CFG.PATENTES : [
    { nome: 'Recruta', pontos: 0 },
    { nome: 'Guerreiro', pontos: 10 },
    { nome: 'Elite', pontos: 25 },
    { nome: 'Mestre', pontos: 50 },
    { nome: 'Grão-Mestre', pontos: 100 },
    { nome: 'Lendário', pontos: 200 },
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
  function medalhasDe(j, ctx) {
    const sem = ctx.semana.find((x) => x.chave === j.chave);
    return [
      { id: 'rei', nome: 'Rei do clã', como: '1º lugar em pontos', ok: ctx.pontos[0] && ctx.pontos[0].chave === j.chave, icone: ICONE_COROA },
      { id: 'recorde', nome: 'Recordista', como: 'maior massa do clã', ok: ctx.massa[0] && ctx.massa[0].chave === j.chave, icone: '<path d="M12 2l3 6 6 1-4.5 4.5 1 6.5L12 17l-5.5 3 1-6.5L3 9l6-1z"/>' },
      { id: 'semana', nome: 'Cobra da semana', como: 'mais pontos na semana', ok: ctx.semana[0] && ctx.semana[0].chave === j.chave && ctx.semana[0].pontos > 0, icone: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-6 2 1 3 2 3 4"/>' },
      { id: 'clube', nome: `Clube ${marcoTxt}`, como: `1 partida de ${marcoTxt}`, ok: j.cem >= 1, icone: '<circle cx="12" cy="12" r="8"/><path d="M8 12l3 3 5-6"/>' },
      { id: 'maquina', nome: `Máquina de ${fmtK(MARCO)}`, como: `5 partidas de ${marcoTxt}`, ok: j.cem >= 5, icone: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>' },
      { id: 'chamas', nome: 'Em chamas', como: '3 partidas na mesma semana', ok: !!sem && sem.qtd >= 3, icone: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-6 2 1 3 2 3 4"/>' },
      { id: 'fiel', nome: 'Fiel ao clã', como: '10 partidas registradas', ok: j.qtd >= 10, icone: '<path d="M12 21s-7-4.5-7-11a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 6.5-7 11-7 11z"/>' },
    ];
  }
  function contexto() {
    return { pontos: montarRanking('geral', 'pontos'), massa: montarRanking('geral', 'massa'), semana: montarRanking('semana', 'pontos') };
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
    // quantas partidas da faixa mais alta cobrem a diferença
    const topo = FAIXAS[0];
    if (!topo || !topo.pontos) return '';
    const n = Math.ceil(falta / topo.pontos);
    return ` (${n} ${n === 1 ? 'partida' : 'partidas'} de ${fmtK(topo.minimo)}+)`;
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

  function abrirPerfil(k) {
    const ctx = contexto();
    const j = ctx.pontos.find((x) => x.chave === k);
    if (!j) return;
    const posP = ctx.pontos.findIndex((x) => x.chave === k) + 1;
    const posM = ctx.massa.findIndex((x) => x.chave === k) + 1;
    const pat = patenteDe(j.pontos);
    const minhas = partidas.filter((p) => chave(p.player) === k); // mais novas primeiro
    const media = Math.round(minhas.reduce((s, p) => s + p.mass, 0) / Math.max(1, minhas.length));
    const meds = medalhasDe(j, ctx);
    const ganhas = meds.filter((m) => m.ok).length;
    const ultimas = minhas.slice(0, 20).reverse();

    const g = document.createElement('div');
    g.className = 'grafico-box';
    g.innerHTML = grafico(ultimas);

    $('perfilCorpo').replaceChildren(
      el('div', { class: 'perfil-topo', style: `--pc:${pat.atual.cor}` },
        avatarDe(j.nome, j.pontos, 'av-g'),
        el('div', { class: 'perfil-id' },
          el('h2', { id: 'perfilNome', text: comTag(j.nome) }),
          el('div', { class: 'perfil-chips' }, chipPatente(j.pontos, 'patente-g'),
            el('span', { class: 'sec', text: `#${posP} em pontos · #${posM} em massa` })))),
      el('div', { class: 'perfil-prog', style: `--pc:${pat.atual.cor}` },
        el('div', { class: 'prog-linha' },
          el('span', { text: pat.atual.nome }),
          el('span', { class: 'sec', text: pat.prox ? `${fmt(j.pontos)} / ${fmt(pat.prox.pontos)} pts` : `${fmt(j.pontos)} pts` }),
          el('span', { text: pat.prox ? pat.prox.nome : 'NÍVEL MÁXIMO' })),
        el('div', { class: 'barra barra-pat', 'aria-hidden': 'true' }, el('span', { style: `width:${Math.round(pat.progresso * 100)}%` })),
        el('div', { class: 'prog-sub', text: pat.prox ? `Faltam ${ptsTxt(pat.prox.pontos - j.pontos)} pra virar ${pat.prox.nome}${partidasPara(pat.prox.pontos - j.pontos)}` : 'Chegou no topo. Agora é defender o trono.' })),
      el('div', { class: 'perfil-stats' },
        ...[['PONTOS', fmt(j.pontos), 'laranja'], [marcoTxt, `${j.cem}×`, j.cem ? 'laranja' : ''], ['RECORDE', fmt(j.melhor.mass), ''], ['MÉDIA', fmt(media), ''], ['PARTIDAS', fmt(j.qtd), '']]
          .map(([r, v, c]) => el('div', { class: 'pstat' }, el('span', { class: 'pstat-rot', text: r }), el('span', { class: `pstat-num ${c}`, text: v })))),
      el('h3', { class: 'perfil-h3', text: ultimas.length > 1 ? `ÚLTIMAS ${ultimas.length} PARTIDAS` : 'PARTIDAS' }),
      g,
      el('h3', { class: 'perfil-h3' }, `MEDALHAS `, el('span', { class: 'sec', text: `${ganhas}/${meds.length}` })),
      el('ul', { class: 'medalhas' }, ...meds.map((m) => el('li', { class: `medalha ${m.ok ? 'ok' : 'trancada'}`, title: m.como },
        el('span', { class: 'med-ic', 'aria-hidden': 'true' }, svg(m.icone, 20)),
        el('span', { class: 'med-txt' }, el('b', { text: m.nome }), el('span', { text: m.ok ? 'conquistada' : m.como })))))
    );
    const dlg = $('dlgPerfil');
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
  }

  // ---------- print ----------
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
    const massa = parseInt(String($('fMassa').value).replace(/\D/g, ''), 10);
    if (!nome) return mostrarErro('Escreve o nick do jogador.');
    if (!massa || massa < MASSA_MIN) return mostrarErro('Escreve a massa final da partida (só números, ex: 52000).');
    if (massa > MASSA_MAX) return mostrarErro(`Massa acima de ${fmt(MASSA_MAX)}? Confere o número.`);
    if (PRINT_OBRIGATORIO && !arquivoPrint) return mostrarErro('Escolhe o print da partida. Ele é a prova da massa.');
    if (!pinAdmin) return mostrarErro('Entre na área do dono para registrar.');
    mostrarErro(null);

    const btn = $('btnEnviar');
    btn.disabled = true;
    btn.textContent = 'ENVIANDO…';
    try {
      // quem era o 1º antes deste envio
      const reiAntes = montarRanking('geral')[0];
      const ptsAntes = (montarRanking('geral', 'pontos').find((x) => x.chave === chave(nome)) || { pontos: 0 }).pontos;
      let print_path = null;
      let print_url = null;
      if (arquivoPrint) {
        const blob = await comprimir(arquivoPrint);
        if (DEMO) {
          print_url = URL.createObjectURL(blob);
        } else {
          const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
          print_path = `${new Date().toISOString().slice(0, 10)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const up = await sb.storage.from(BUCKET).upload(print_path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
          if (up.error) throw new Error('print: ' + up.error.message);
        }
      }
      if (DEMO) {
        partidas.unshift({ id: 'demo-' + Date.now(), player: nome, mass: massa, print_path: null, print_url, created_at: new Date().toISOString() });
      } else {
        const ins = await sb.rpc('admin_add_score', { pin_try: pinAdmin, p_player: nome, p_mass: massa, p_print_path: print_path });
        if (ins.error) throw new Error(ins.error.message);
        if (ins.data !== true) { sairAdmin(); toast('O PIN mudou. Entre de novo na área do dono.', true); return; }
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
      const ganhou = pontosDe(massa) ? ` +${ptsTxt(pontosDe(massa))}.` : '';
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
      $('valePontos').textContent = '';
      $('fNome').focus();
    } catch (e) {
      console.error(e);
      mostrarErro('Não deu pra enviar agora. Confere a internet e tenta de novo. (' + (e.message || 'erro') + ')');
    } finally {
      btn.disabled = false;
      btn.textContent = 'COLOCAR NO RANKING';
    }
  }

  // ---------- admin ----------
  async function conferirPin(pin) {
    if (DEMO) return pin === '1234';
    const r = await sb.rpc('admin_check', { pin_try: pin });
    if (r.error) throw new Error(r.error.message);
    return r.data === true;
  }

  async function entrarAdmin(ev) {
    ev.preventDefault();
    const pin = $('fPin').value.trim();
    const erro = $('erroAdmin');
    erro.hidden = true;
    try {
      if (await conferirPin(pin)) {
        pinAdmin = pin;
        guardarPin(pin, $('fLembrar').checked);
        $('dlgAdmin').close();
        $('btnAdmin').textContent = 'Sair da área do dono';
        render();
        toast('Área do dono liberada. Já pode registrar massas.');
        $('registrar').scrollIntoView({ behavior: 'smooth' });
      } else {
        erro.textContent = 'PIN errado.';
        erro.hidden = false;
      }
    } catch (e) {
      erro.textContent = 'Não consegui conferir o PIN agora. Tenta de novo.';
      erro.hidden = false;
    }
  }

  function pedirApagar(p) {
    apagarId = p.id;
    $('txtConfirma').textContent = `${comTag(limparNick(p.player))} · ${fmt(p.mass)} de massa (${haQuanto(p.created_at)}). Isso não pode ser desfeito.`;
    $('dlgConfirma').showModal();
  }

  async function confirmarApagar() {
    const id = apagarId;
    $('dlgConfirma').close();
    if (!id) return;
    try {
      if (DEMO) {
        partidas = partidas.filter((p) => p.id !== id);
      } else {
        const r = await sb.rpc('admin_delete_score', { score_id: id, pin_try: pinAdmin });
        if (r.error) throw new Error(r.error.message);
        if (r.data !== true) { sairAdmin(); toast('O PIN mudou. Entre de novo na área do dono.', true); return; }
        await carregar();
      }
      render();
      toast('Pontuação apagada.');
    } catch (e) {
      toast('Não deu pra apagar agora. Tenta de novo.', true);
    }
  }

  function sairAdmin() {
    pinAdmin = null;
    guardarPin(null);
    $('btnAdmin').textContent = 'Área do dono';
    render();
  }

  // ---------- dados ----------
  async function carregar() {
    if (DEMO) return;
    const r = await sb.from('scores').select('id, player, mass, print_path, created_at').order('created_at', { ascending: false }).limit(2000);
    if (r.error) throw new Error(r.error.message);
    partidas = r.data || [];
  }

  function dadosDemo() {
    const h = (horas) => new Date(Date.now() - horas * 3600 * 1000).toISOString();
    const lista = [
      ['VENO', 112430, 2], ['Mamba', 15400, 5], ['VETERANO', 18420, 9], ['Kaiser', 27800, 20], ['Shawdow', 104210, 30],
      ['VETERANO', 52040, 48], ['Kaiser', 35100, 70], ['VENO', 61877, 80], ['Mamba', 9800, 100], ['VETERANO', 41902, 120],
      ['Shawdow', 54105, 150], ['Mamba', 25300, 170], ['VENO', 101990, 200], ['Kaiser', 12900, 230], ['Shawdow', 22310, 260],
      ['VETERANO', 33700, 300], ['VENO', 104500, 320], ['Shawdow', 66780, 350], ['VENO', 58200, 400], ['Shawdow', 51200, 450],
      ['VENO', 73400, 500], ['Shawdow', 30100, 560], ['VETERANO', 26700, 600], ['VENO', 120880, 640],
    ];
    return lista.map(([player, mass, horas], i) => ({ id: 'd' + i, player, mass, created_at: h(horas) }));
  }

  let realtimeOk = false;
  function ligarTempoReal() {
    const aoVivo = $('aoVivo');
    if (DEMO) { aoVivo.lastChild.textContent = 'demonstração'; return; }
    let espera;
    sb.channel('scores-ao-vivo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, () => {
        clearTimeout(espera);
        espera = setTimeout(() => carregar().then(render).catch(() => {}), 400);
      })
      .subscribe((status) => {
        realtimeOk = status === 'SUBSCRIBED';
        aoVivo.classList.toggle('on', realtimeOk);
      });
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
    $('fMassa').addEventListener('input', () => {
      const m = parseInt(String($('fMassa').value).replace(/\D/g, ''), 10);
      $('valePontos').textContent = m ? `Vale ${ptsTxt(pontosDe(m))}${m >= MARCO ? ' · conta como ' + marcoTxt : ''}` : '';
    });

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
      if (pinAdmin) { sairAdmin(); return; }
      $('fPin').value = '';
      $('erroAdmin').hidden = true;
      $('dlgAdmin').showModal();
    });
    $('btnCancelarAdmin').addEventListener('click', () => $('dlgAdmin').close());
    $('formAdmin').addEventListener('submit', entrarAdmin);
    $('btnNaoApagar').addEventListener('click', () => $('dlgConfirma').close());
    $('btnSimApagar').addEventListener('click', confirmarApagar);
    // fechar janelas tocando fora delas
    ['dlgPrint', 'dlgPerfil'].forEach((id) => $(id).addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const fora = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if (e.target === e.currentTarget && fora) e.currentTarget.close();
    }));

    if (DEMO) {
      $('avisoDemo').hidden = false;
      partidas = dadosDemo();
      render();
      ligarTempoReal();
      return;
    }

    if (!window.supabase) {
      $('podio').replaceChildren(el('p', { class: 'vazio', text: 'Não consegui carregar o sistema do ranking. Confere a internet e recarrega a página.' }));
      return;
    }
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
    const pinSalvo = lerPin();
    carregar()
      .then(async () => {
        if (pinSalvo && await conferirPin(pinSalvo).catch(() => false)) {
          pinAdmin = pinSalvo;
          $('btnAdmin').textContent = 'Sair da área do dono';
        }
        render();
        ligarTempoReal();
      })
      .catch((e) => {
        console.error(e);
        $('podio').replaceChildren(el('p', { class: 'vazio', text: 'Não consegui ler o ranking. Se você é o admin, confere o config.js e se o script do banco foi rodado no Supabase.' }));
      });
  }

  iniciar();
})();
