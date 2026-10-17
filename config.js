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
  SUPABASE_URL: "COLE_AQUI_A_PROJECT_URL",
  SUPABASE_KEY: "COLE_AQUI_A_CHAVE_ANON_OU_PUBLISHABLE",

  // Tag do clã que aparece antes do nome de cada jogador
  CLAN_TAG: "COBR",

  // ---------------- SISTEMA DE PONTOS ----------------
  // Cada partida registrada vale pontos pela massa. Os pontos somam.
  // Pode mudar os números à vontade (do maior pro menor ou não, tanto faz).
  PONTOS: [
    { minimo: 100000, pontos: 10 },  // 100K ou mais
    { minimo: 50000,  pontos: 5 },   // 50K a 99.999
    { minimo: 25000,  pontos: 2 },   // 25K a 49.999
    { minimo: 10000,  pontos: 1 },   // 10K a 24.999
  ],                                 // abaixo de 10K: 0 pontos

  // Patentes: o jogador sobe conforme junta pontos (pode mudar nomes e números)
  PATENTES: [
    { nome: "Recruta",     pontos: 0 },
    { nome: "Guerreiro",   pontos: 10 },
    { nome: "Elite",       pontos: 25 },
    { nome: "Mestre",      pontos: 50 },
    { nome: "Grão-Mestre", pontos: 100 },
    { nome: "Lendário",    pontos: 200 },
  ],

  // Massa que conta como "100K+" (o placar de quantas vezes cada um passou)
  MARCO: 100000,

  // Ranking abre ordenado por "pontos" ou por "massa" (maior massa)
  RANKING_POR: "pontos",

  // Exigir print da partida para registrar? (true = sim, false = não)
  PRINT_OBRIGATORIO: false,
};
