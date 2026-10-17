// =============================================================
//  CONFIGURAÇÃO DO RANKING — só precisa mexer neste arquivo
// =============================================================
//  Pegue os dois valores abaixo no Supabase:
//  Project Settings  >  API Keys   (ou "Connect" no topo do projeto)
//
//  - SUPABASE_URL:  o "Project URL", algo como https://abcdxyz.supabase.co
//  - SUPABASE_KEY:  a chave "anon public" ou "publishable"
//                   (NUNCA use a "service_role" / "secret" aqui!)
//
//  Enquanto estiver com "COLE_AQUI", o site roda em MODO DEMONSTRAÇÃO
//  com dados de exemplo, sem salvar nada. Passo a passo completo:
//  abra o arquivo COMO-COLOCAR-NO-AR.html
// =============================================================

window.RANKING_CONFIG = {
  SUPABASE_URL: "https://gntibfbrdplmbdgdreeq.supabase.co",
  SUPABASE_KEY: "sb_publishable_AsSQLui_xg_NZT_6bx16Mg_Atv4IEGt",

  // Tag do clã que aparece antes do nome de cada jogador
  CLAN_TAG: "COBR",

  // ---------------- SISTEMA DE PONTOS ----------------
  // Cada partida registrada vale pontos pela massa. Os pontos somam.
  // Ex.: 99.000 = 99 pts · 100.000 = 100 + 30 = 130 pts · 250.000 = 250 + 60 = 310 pts
  PONTOS: {
    POR_MIL: 1,        // pontos a cada 1.000 de massa
    META: 100000,      // a cada meta batida (100K, 200K, 300K ... 1M)
    BONUS_META: 30,    // ganha esse bônus por meta
  },

  // Patentes: o jogador sobe conforme junta pontos (pode mudar nomes e números)
  PATENTES: [
    { nome: "Recruta",     pontos: 0 },
    { nome: "Guerreiro",   pontos: 100 },
    { nome: "Elite",       pontos: 300 },
    { nome: "Mestre",      pontos: 600 },
    { nome: "Grão-Mestre", pontos: 1200 },
    { nome: "Lendário",    pontos: 2500 },
  ],

  // Massa que conta como "100K+" (o placar de quantas vezes cada um passou)
  MARCO: 100000,

  // Ranking abre ordenado por "pontos" ou por "massa" (maior massa)
  RANKING_POR: "pontos",

  // Exigir print da partida para registrar? (true = sim, false = não)
  PRINT_OBRIGATORIO: false,
};
