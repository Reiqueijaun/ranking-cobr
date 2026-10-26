-- =============================================================
--  RANKING DO CLÃ — script do banco de dados (Supabase)
--  Cole TUDO no SQL Editor do Supabase e clique em "Run".
--  Pode rodar de novo sem problema: não apaga partidas nem jogadores.
--
--  Segurança:
--  - Qualquer um VÊ o ranking. Ninguém de fora consegue gravar nada.
--  - Registrar, editar e apagar: só quem entra com e-mail e senha
--    E está na tabela "admins". Quem confere isso é o banco, não o site.
--  - Como criar um admin: guia COMO-COLOCAR-NO-AR.html (passo 3).
-- =============================================================

-- 1) Tabela das pontuações
create table if not exists public.scores (
  id          uuid primary key default gen_random_uuid(),
  player      text not null check (char_length(btrim(player)) between 1 and 24),
  mass        integer not null check (mass between 10 and 1000000),
  print_path  text check (print_path is null or char_length(print_path) <= 200),
  created_at  timestamptz not null default now()
);
create index if not exists scores_created_at_idx on public.scores (created_at desc);

alter table public.scores enable row level security;
revoke all on public.scores from anon;
grant select on public.scores to authenticated;
revoke insert, update, delete on public.scores from authenticated;

-- Quem pode VER o ranking: só membro logado (política no passo 5e, "Site fechado")
drop policy if exists "todos leem" on public.scores;

-- Ninguém registra direto na tabela. Registrar e apagar: só admin, pelas funções do passo 3.
drop policy if exists "todos registram" on public.scores;


-- 2) Elenco do clã: todos os jogadores cadastrados, mesmo quem ainda não pontuou
create table if not exists public.players (
  id          uuid primary key default gen_random_uuid(),
  nick        text not null check (char_length(btrim(nick)) between 1 and 24),
  cargo       text not null default 'Membro' check (char_length(btrim(cargo)) between 1 and 24),
  ativo       boolean not null default true,     -- false = saiu do clã (some do ranking, histórico fica)
  created_at  timestamptz not null default now()
);
create unique index if not exists players_nick_idx on public.players (lower(btrim(nick)));

alter table public.players enable row level security;
revoke all on public.players from anon;
grant select on public.players to authenticated;
revoke insert, update, delete on public.players from authenticated;
drop policy if exists "todos leem jogadores" on public.players; -- quem lê: passo 5e

-- Quem já tem partida registrada entra no elenco (com o nick mais recente)
insert into public.players (nick, created_at)
select distinct on (lower(btrim(player))) btrim(player), min(created_at) over (partition by lower(btrim(player)))
from public.scores
order by lower(btrim(player)), created_at desc
on conflict do nothing;


-- 3) Administradores: login de verdade (e-mail + senha do Supabase Auth).
--    Não existe mais PIN. Cada admin tem a própria conta, e só quem está
--    na tabela "admins" consegue registrar, editar ou apagar.
--    Como criar um admin: veja o guia COMO-COLOCAR-NO-AR.html (passo 3).

-- o sistema antigo de PIN sai de vez
drop function if exists public.admin_check(text);
drop function if exists public.admin_delete_score(uuid, text);
drop function if exists public.admin_add_score(text, text, integer, text);
drop function if exists public.admin_add_players(text, text[], text);
drop function if exists public.admin_update_player(text, uuid, text, text, boolean);
drop function if exists public.admin_delete_player(text, uuid);
drop table if exists public.admin_config;

create table if not exists public.admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  nome        text not null default '' check (char_length(nome) <= 40),
  created_at  timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;
-- (sem políticas = ninguém de fora lê nem mexe nesta tabela)

-- Histórico de tudo que os admins fazem (veja em Table Editor > admin_log)
create table if not exists public.admin_log (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  email       text,
  acao        text not null,
  detalhe     jsonb,
  created_at  timestamptz not null default now()
);
alter table public.admin_log enable row level security;
revoke all on public.admin_log from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists(select 1 from admins where user_id = auth.uid());
$$;

create or replace function public.exigir_admin(p_acao text, p_detalhe jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  insert into admin_log (user_id, email, acao, detalhe)
  values (auth.uid(), auth.jwt() ->> 'email', p_acao, p_detalhe);
end;
$$;

-- Devolve o nome do admin logado (ou null se não for admin)
create or replace function public.admin_eu()
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(nullif(btrim(nome), ''), auth.jwt() ->> 'email') from admins where user_id = auth.uid();
$$;

create or replace function public.admin_add_score(p_player text, p_mass integer, p_print_path text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare novo uuid;
begin
  perform exigir_admin('registrar', jsonb_build_object('jogador', p_player, 'massa', p_mass));
  insert into scores (player, mass, print_path) values (btrim(p_player), p_mass, p_print_path)
  returning id into novo;
  -- quem joga entra (ou volta) pro elenco do clã automaticamente
  update players set ativo = true where lower(btrim(nick)) = lower(btrim(p_player)) and not ativo;
  insert into players (nick) values (btrim(p_player)) on conflict do nothing;
  return novo;
end;
$$;

-- Devolve o print_path da partida apagada (pro site apagar a imagem também)
create or replace function public.admin_delete_score(p_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare r scores%rowtype;
begin
  select * into r from scores where id = p_id;
  -- confere o admin antes de responder qualquer coisa
  perform exigir_admin('apagar partida', jsonb_build_object('id', p_id, 'jogador', r.player, 'massa', r.mass, 'data', r.created_at));
  if r.id is null then return null; end if;
  delete from scores where id = p_id;
  return coalesce(r.print_path, '');
end;
$$;

-- Cadastrar vários de uma vez. Devolve quantos entraram.
create or replace function public.admin_add_players(p_nicks text[], p_cargo text default 'Membro')
returns integer
language plpgsql security definer set search_path = public
as $$
declare n integer;
begin
  perform exigir_admin('cadastrar jogadores', jsonb_build_object('nicks', p_nicks, 'cargo', p_cargo));
  -- ex-membro cadastrado de novo volta pro clã
  update players set ativo = true
    where not ativo and lower(btrim(nick)) in (select lower(btrim(x)) from unnest(p_nicks) x);
  insert into players (nick, cargo)
    select distinct on (lower(btrim(x))) btrim(x), coalesce(nullif(btrim(p_cargo), ''), 'Membro')
    from unnest(p_nicks) x
    where char_length(btrim(x)) between 1 and 24
    order by lower(btrim(x))
    on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Editar nick, cargo e se ainda está no clã. Trocar o nick troca nas partidas também.
-- Devolve: ok | nick_em_uso | nao_existe
create or replace function public.admin_update_player(p_id uuid, p_nick text, p_cargo text, p_ativo boolean)
returns text
language plpgsql security definer set search_path = public
as $$
declare antigo text;
begin
  perform exigir_admin('editar jogador', jsonb_build_object('id', p_id, 'nick', p_nick, 'cargo', p_cargo, 'ativo', p_ativo));
  select nick into antigo from players where id = p_id;
  if not found then return 'nao_existe'; end if;
  if exists(select 1 from players where lower(btrim(nick)) = lower(btrim(p_nick)) and id <> p_id) then
    return 'nick_em_uso';
  end if;
  update players
    set nick = btrim(p_nick), cargo = coalesce(nullif(btrim(p_cargo), ''), cargo), ativo = coalesce(p_ativo, ativo)
    where id = p_id;
  if btrim(p_nick) <> antigo then
    update scores set player = btrim(p_nick) where lower(btrim(player)) = lower(btrim(antigo));
  end if;
  return 'ok';
end;
$$;

-- Apagar do elenco (só quem não tem partida, pra corrigir cadastro errado).
-- Devolve: ok | tem_partidas
create or replace function public.admin_delete_player(p_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  perform exigir_admin('apagar jogador', jsonb_build_object('id', p_id));
  if exists(select 1 from scores s join players p on lower(btrim(s.player)) = lower(btrim(p.nick)) where p.id = p_id) then
    return 'tem_partidas';
  end if;
  -- resultado lançado em torneio também conta como partida
  if to_regclass('public.torneio_lancamentos') is not null
     and exists(select 1 from torneio_lancamentos where player_id = p_id) then
    return 'tem_partidas';
  end if;
  delete from players where id = p_id;
  return 'ok';
end;
$$;

-- Visitante (anon) não executa nada disso; admin logado (authenticated) sim,
-- e mesmo assim cada função confere se ele está na tabela admins.
revoke all on function public.is_admin() from public;
revoke all on function public.exigir_admin(text, jsonb) from public;
revoke all on function public.admin_eu() from public;
revoke all on function public.admin_add_score(text, integer, text) from public;
revoke all on function public.admin_delete_score(uuid) from public;
revoke all on function public.admin_add_players(text[], text) from public;
revoke all on function public.admin_update_player(uuid, text, text, boolean) from public;
revoke all on function public.admin_delete_player(uuid) from public;
revoke all on function public.exigir_admin(text, jsonb) from anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_eu() to authenticated;
grant execute on function public.admin_add_score(text, integer, text) to authenticated;
grant execute on function public.admin_delete_score(uuid) to authenticated;
grant execute on function public.admin_add_players(text[], text) to authenticated;
grant execute on function public.admin_update_player(uuid, text, text, boolean) to authenticated;
grant execute on function public.admin_delete_player(uuid) to authenticated;


-- 4) Pasta pública para os prints (até 3 MB, só imagens).
--    Todo mundo vê os prints; só admin logado envia ou apaga.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('prints', 'prints', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "todos enviam print" on storage.objects;
drop policy if exists "admins enviam print" on storage.objects;
drop policy if exists "admins veem print" on storage.objects;
drop policy if exists "admins apagam print" on storage.objects;
create policy "admins enviam print" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'prints' and public.is_admin());
create policy "admins veem print" on storage.objects
  for select to authenticated
  using (bucket_id = 'prints' and public.is_admin());
create policy "admins apagam print" on storage.objects
  for delete to authenticated
  using (bucket_id = 'prints' and public.is_admin());


-- 5) Torneios e campeonatos. O dono cria pelo site (Área do admin):
--    formato, o que conta (pontos, massa, kills...), datas, prêmios e quem joga.
create table if not exists public.torneios (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (char_length(btrim(nome)) between 1 and 60),
  -- soma = quem soma mais · melhor = maior partida · melhores = soma das N melhores
  -- meta = corrida até um número · mata = mata-mata (chaveamento 1 contra 1)
  -- hora = quem está em 1º no ranking na hora marcada · livre = regras próprias (o dono escolhe o pódio)
  formato       text not null default 'soma' check (formato in ('soma', 'melhor', 'melhores', 'meta', 'mata', 'hora', 'livre')),
  -- pontos e massa saem das partidas; custom = outra coisa (kills, abates...), com o nome em "unidade"
  metrica       text not null default 'pontos' check (metrica in ('pontos', 'massa', 'custom')),
  unidade       text not null default '' check (char_length(unidade) <= 20),
  auto          boolean not null default true,   -- conta sozinho as partidas registradas no ranking
  qtd           integer check (qtd is null or qtd between 1 and 100),          -- "melhores N"
  meta          integer check (meta is null or meta between 1 and 100000000),  -- corrida
  semente       text not null default 'ranking' check (semente in ('ranking', 'sorteio')),
  inicio        timestamptz not null default now(),
  fim           timestamptz,
  encerrado_em  timestamptz,                    -- encerrado na mão antes da hora
  todos         boolean not null default true,  -- true = o clã inteiro joga
  participantes uuid[] not null default '{}' check (cardinality(participantes) <= 256),
  premios       text[] not null default '{}' check (cardinality(premios) <= 5),
  regras        text not null default '' check (char_length(regras) <= 2000),
  chave         jsonb,                          -- chaveamento do mata-mata
  publicado     boolean not null default true,  -- false = rascunho, só admin vê
  created_at    timestamptz not null default now(),
  check (fim is null or fim > inicio)
);
create index if not exists torneios_inicio_idx on public.torneios (inicio desc);
-- formatos "hora" e "livre" (pra quem criou a tabela antes deles existirem)
alter table public.torneios drop constraint if exists torneios_formato_check;
alter table public.torneios add constraint torneios_formato_check
  check (formato in ('soma', 'melhor', 'melhores', 'meta', 'mata', 'hora', 'livre'));
-- "hora": qual ranking vale (geral, temporada do mês ou semana)
alter table public.torneios add column if not exists base text not null default 'geral';
alter table public.torneios drop constraint if exists torneios_base_check;
alter table public.torneios add constraint torneios_base_check check (base in ('geral', 'mes', 'semana'));
-- "livre": campeão, vice e 3º escolhidos pelo dono (ids dos jogadores, nessa ordem)
alter table public.torneios add column if not exists podio uuid[] not null default '{}';
alter table public.torneios drop constraint if exists torneios_podio_check;
alter table public.torneios add constraint torneios_podio_check check (cardinality(podio) <= 3);

-- Resultados lançados pelo dono (kills, massa de partida especial...)
create table if not exists public.torneio_lancamentos (
  id          uuid primary key default gen_random_uuid(),
  torneio_id  uuid not null references public.torneios (id) on delete cascade,
  player_id   uuid not null references public.players (id),
  valor       integer not null check (valor between 0 and 100000000),
  nota        text not null default '' check (char_length(nota) <= 80),
  print_path  text check (print_path is null or char_length(print_path) <= 200),
  created_at  timestamptz not null default now()
);
create index if not exists torneio_lanc_idx on public.torneio_lancamentos (torneio_id, created_at desc);

alter table public.torneios enable row level security;
alter table public.torneio_lancamentos enable row level security;
revoke all on public.torneios, public.torneio_lancamentos from anon;
grant select on public.torneios, public.torneio_lancamentos to authenticated;
revoke insert, update, delete on public.torneios, public.torneio_lancamentos from authenticated;

-- Quem vê os torneios (membro vê os publicados, rascunho só admin): passo 5e
drop policy if exists "todos veem torneios" on public.torneios;
drop policy if exists "admins veem rascunhos" on public.torneios;
drop policy if exists "todos veem resultados" on public.torneio_lancamentos;

-- Criar (p_id null) ou editar um torneio. Não mexe no chaveamento.
create or replace function public.admin_salvar_torneio(p_id uuid, p_dados jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare novo uuid;
begin
  perform exigir_admin(case when p_id is null then 'criar torneio' else 'editar torneio' end,
    jsonb_build_object('id', p_id, 'nome', p_dados ->> 'nome'));
  if p_id is null then
    insert into torneios (nome) values (btrim(p_dados ->> 'nome')) returning id into novo;
  else
    novo := p_id;
    if not exists(select 1 from torneios where id = novo) then return null; end if;
  end if;
  update torneios set
    nome          = btrim(p_dados ->> 'nome'),
    formato       = coalesce(p_dados ->> 'formato', 'soma'),
    metrica       = coalesce(p_dados ->> 'metrica', 'pontos'),
    unidade       = left(coalesce(btrim(p_dados ->> 'unidade'), ''), 20),
    auto          = coalesce((p_dados ->> 'auto')::boolean, true),
    qtd           = (p_dados ->> 'qtd')::integer,
    meta          = (p_dados ->> 'meta')::integer,
    semente       = coalesce(p_dados ->> 'semente', 'ranking'),
    inicio        = coalesce((p_dados ->> 'inicio')::timestamptz, now()),
    fim           = (p_dados ->> 'fim')::timestamptz,
    encerrado_em  = (p_dados ->> 'encerrado_em')::timestamptz,
    todos         = coalesce((p_dados ->> 'todos')::boolean, true),
    participantes = coalesce(array(select distinct x::uuid from jsonb_array_elements_text(coalesce(p_dados -> 'participantes', '[]')) x), '{}'),
    premios       = coalesce(array(select left(btrim(x), 60) from jsonb_array_elements_text(coalesce(p_dados -> 'premios', '[]')) with ordinality as e(x, n) order by n), '{}'),
    regras        = left(coalesce(p_dados ->> 'regras', ''), 2000),
    publicado     = coalesce((p_dados ->> 'publicado')::boolean, true),
    -- só muda quando vem no pedido (assim a versão antiga do site não apaga o pódio)
    base          = case when p_dados ? 'base' then coalesce(p_dados ->> 'base', 'geral') else base end,
    podio         = case when p_dados ? 'podio'
                      then coalesce(array(select x::uuid from jsonb_array_elements_text(coalesce(p_dados -> 'podio', '[]')) with ordinality as e(x, n) order by n), '{}')
                      else podio end
  where id = novo;
  return novo;
end;
$$;

-- Salvar o chaveamento do mata-mata (montar, lançar resultado de duelo, refazer)
create or replace function public.admin_salvar_chave(p_id uuid, p_chave jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform exigir_admin('chaveamento', jsonb_build_object('torneio', p_id));
  if p_chave is not null and octet_length(p_chave::text) > 100000 then
    raise exception 'chaveamento grande demais';
  end if;
  update torneios set chave = p_chave where id = p_id;
end;
$$;

-- Apagar um torneio. Devolve os prints dos resultados (pro site apagar as imagens).
create or replace function public.admin_apagar_torneio(p_id uuid)
returns text[]
language plpgsql security definer set search_path = public
as $$
declare caminhos text[];
begin
  perform exigir_admin('apagar torneio', (select jsonb_build_object('id', id, 'nome', nome) from torneios where id = p_id));
  select coalesce(array_agg(print_path) filter (where print_path is not null), '{}') into caminhos
    from torneio_lancamentos where torneio_id = p_id;
  delete from torneios where id = p_id;
  return caminhos;
end;
$$;

-- Lançar resultado. Quem ainda não estava inscrito entra no torneio.
create or replace function public.admin_add_lancamento(p_torneio uuid, p_player uuid, p_valor integer, p_nota text default '', p_print_path text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare novo uuid;
begin
  perform exigir_admin('lançar resultado', jsonb_build_object('torneio', p_torneio, 'jogador', p_player, 'valor', p_valor));
  insert into torneio_lancamentos (torneio_id, player_id, valor, nota, print_path)
    values (p_torneio, p_player, p_valor, left(coalesce(btrim(p_nota), ''), 80), p_print_path)
    returning id into novo;
  update torneios set participantes = array_append(participantes, p_player)
    where id = p_torneio and not todos and not (p_player = any(participantes));
  return novo;
end;
$$;

-- Apagar resultado. Devolve o print_path (pro site apagar a imagem).
create or replace function public.admin_apagar_lancamento(p_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare r torneio_lancamentos%rowtype;
begin
  select * into r from torneio_lancamentos where id = p_id;
  -- confere o admin antes de responder qualquer coisa
  perform exigir_admin('apagar resultado', jsonb_build_object('id', p_id, 'torneio', r.torneio_id, 'jogador', r.player_id, 'valor', r.valor));
  if r.id is null then return null; end if;
  delete from torneio_lancamentos where id = p_id;
  return coalesce(r.print_path, '');
end;
$$;

revoke all on function public.admin_salvar_torneio(uuid, jsonb) from public;
revoke all on function public.admin_salvar_chave(uuid, jsonb) from public;
revoke all on function public.admin_apagar_torneio(uuid) from public;
revoke all on function public.admin_add_lancamento(uuid, uuid, integer, text, text) from public;
revoke all on function public.admin_apagar_lancamento(uuid) from public;
-- O Supabase libera toda função nova pro visitante (anon) por padrão; aqui tira de todas as de admin
revoke all on function public.is_admin() from anon;
revoke all on function public.exigir_admin(text, jsonb) from anon;
revoke all on function public.admin_eu() from anon;
revoke all on function public.admin_add_score(text, integer, text) from anon;
revoke all on function public.admin_delete_score(uuid) from anon;
revoke all on function public.admin_add_players(text[], text) from anon;
revoke all on function public.admin_update_player(uuid, text, text, boolean) from anon;
revoke all on function public.admin_delete_player(uuid) from anon;
revoke all on function public.admin_salvar_torneio(uuid, jsonb) from anon;
revoke all on function public.admin_salvar_chave(uuid, jsonb) from anon;
revoke all on function public.admin_apagar_torneio(uuid) from anon;
revoke all on function public.admin_add_lancamento(uuid, uuid, integer, text, text) from anon;
revoke all on function public.admin_apagar_lancamento(uuid) from anon;
grant execute on function public.admin_salvar_torneio(uuid, jsonb) to authenticated;
grant execute on function public.admin_salvar_chave(uuid, jsonb) to authenticated;
grant execute on function public.admin_apagar_torneio(uuid) to authenticated;
grant execute on function public.admin_add_lancamento(uuid, uuid, integer, text, text) to authenticated;
grant execute on function public.admin_apagar_lancamento(uuid) to authenticated;


-- 5b) Prêmios (Pix da temporada e das patentes): o dono e os admins mudam pelo site
create table if not exists public.config_site (
  chave         text primary key,
  valor         jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.config_site enable row level security;
revoke all on public.config_site from anon;
grant select on public.config_site to authenticated;
revoke insert, update, delete on public.config_site from authenticated;
drop policy if exists "todos leem config" on public.config_site; -- quem lê: passo 5e

create or replace function public.admin_salvar_config(p_chave text, p_valor jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform exigir_admin('prêmios', jsonb_build_object('chave', p_chave, 'valor', p_valor));
  if p_chave is distinct from 'premios' then
    raise exception 'configuração desconhecida';
  end if;
  if p_valor is null or jsonb_typeof(p_valor) <> 'object' or octet_length(p_valor::text) > 20000 then
    raise exception 'valor inválido';
  end if;
  insert into config_site (chave, valor, atualizado_em) values (p_chave, p_valor, now())
  on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
end;
$$;
revoke all on function public.admin_salvar_config(text, jsonb) from public;
revoke all on function public.admin_salvar_config(text, jsonb) from anon;
grant execute on function public.admin_salvar_config(text, jsonb) to authenticated;


-- 5c) Login dos jogadores: cada um cria a conta com o próprio e-mail e senha,
--     confirma pelo link que chega no e-mail e escolhe o nick dele no clã.
--     Login de jogador não dá poder nenhum: só deixa o site saber quem ele é
--     ("Meu perfil" em qualquer aparelho). Admin continua sendo só quem está em "admins".
--     Precisa ligar no painel: Authentication > Sign In / Providers > "Allow new users to sign up"
--     e "Confirm email" ligados; Authentication > URL Configuration > Site URL = endereço do site.
create table if not exists public.player_contas (
  player_id   uuid primary key references public.players (id) on delete cascade,
  user_id     uuid not null unique references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.player_contas enable row level security;
revoke all on public.player_contas from anon, authenticated;

-- (versão de teste com código do admin: nunca foi usada, sai)
drop function if exists public.admin_gerar_codigo(uuid);
drop function if exists public.jogador_ativar(uuid, text, text);
drop function if exists public.email_jogador(uuid);
drop function if exists public.admin_vincular_eu(uuid);
drop function if exists public.admin_logins();
drop table if exists public.player_codigos;

-- Qual jogador é a conta logada (null se não for de nenhum)
create or replace function public.jogador_eu()
returns uuid
language sql stable security definer set search_path = public
as $$
  select player_id from player_contas where user_id = auth.uid();
$$;

drop function if exists public.nick_livre(uuid); -- virou nick_status (passo 5d)

-- A conta logada (com e-mail confirmado) fica com esse jogador.
-- Quem já tinha um jogador troca (ex.: escolheu o nick errado).
-- Devolve: ok | tem_login | nao_existe | sem_confirmar
create or replace function public.jogador_vincular(p_player uuid)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  if not exists(select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null) then
    return 'sem_confirmar';
  end if;
  if not exists(select 1 from players where id = p_player) then return 'nao_existe'; end if;
  if exists(select 1 from player_contas where player_id = p_player and user_id <> auth.uid()) then
    return 'tem_login';
  end if;
  delete from player_contas where user_id = auth.uid() and player_id <> p_player;
  insert into player_contas (player_id, user_id) values (p_player, auth.uid()) on conflict (player_id) do nothing;
  return 'ok';
end;
$$;

-- Pra tela do admin: quem já tem login (e-mail e último acesso)
create or replace function public.admin_logins()
returns table (player_id uuid, email text, admin boolean, ultimo_acesso timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  return query
    select c.player_id, u.email::text, a.user_id is not null, u.last_sign_in_at
    from player_contas c
    join auth.users u on u.id = c.user_id
    left join admins a on a.user_id = c.user_id;
end;
$$;

-- Admin tira o login de um jogador (alguém pegou o nick errado). A conta continua existindo,
-- só fica sem jogador; se for de outra pessoa, ela escolhe o nick certo ao entrar de novo.
create or replace function public.admin_tirar_login(p_player uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform exigir_admin('tirar login', jsonb_build_object('jogador', p_player, 'nick', (select nick from players where id = p_player),
    'email', (select u.email from player_contas c join auth.users u on u.id = c.user_id where c.player_id = p_player)));
  delete from player_contas where player_id = p_player;
end;
$$;

revoke all on function public.jogador_eu() from public, anon;
revoke all on function public.jogador_vincular(uuid) from public, anon;
revoke all on function public.admin_logins() from public, anon;
revoke all on function public.admin_tirar_login(uuid) from public, anon;
grant execute on function public.jogador_eu() to authenticated;
grant execute on function public.jogador_vincular(uuid) to authenticated;
grant execute on function public.admin_logins() to authenticated;
grant execute on function public.admin_tirar_login(uuid) to authenticated;


-- 5d) Pedidos de nick novo: quem cria conta com um nick que não está no elenco
--     fica esperando um admin aprovar (Jogadores > Pedidos pra entrar).
create table if not exists public.player_pedidos (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  nick        text not null check (char_length(btrim(nick)) between 1 and 24),
  created_at  timestamptz not null default now()
);
alter table public.player_pedidos enable row level security;
revoke all on public.player_pedidos from anon, authenticated;

-- Membro = conta ligada a um jogador do clã, ou admin. Só membro lê o site (passo 5e).
create or replace function public.is_membro()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists(select 1 from player_contas where user_id = auth.uid())
      or exists(select 1 from admins where user_id = auth.uid());
$$;

-- Antes de criar a conta: livre (do elenco, sem dono) | tem_login | novo (vai pra aprovação)
create or replace function public.nick_status(p_nick text)
returns text
language sql stable security definer set search_path = public
as $$
  select case when p.id is null then 'novo'
              when exists(select 1 from player_contas c where c.player_id = p.id) then 'tem_login'
              else 'livre' end
  from (select 1) x
  left join players p on lower(btrim(p.nick)) = lower(btrim(p_nick));
$$;

-- A conta (com e-mail confirmado) pede o nick: do elenco liga na hora; nick novo vira pedido.
-- Devolve: ok | pedido | tem_login | sem_confirmar | invalido
create or replace function public.jogador_pedir_nick(p_nick text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  n text := btrim(coalesce(p_nick, ''));
  pid uuid;
begin
  if auth.uid() is null then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  if not exists(select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null) then
    return 'sem_confirmar';
  end if;
  if char_length(n) not between 1 and 24 then return 'invalido'; end if;
  select id into pid from players where lower(btrim(nick)) = lower(n);
  if pid is not null then
    if exists(select 1 from player_contas where player_id = pid and user_id <> auth.uid()) then
      return 'tem_login';
    end if;
    delete from player_contas where user_id = auth.uid() and player_id <> pid;
    insert into player_contas (player_id, user_id) values (pid, auth.uid()) on conflict (player_id) do nothing;
    delete from player_pedidos where user_id = auth.uid();
    return 'ok';
  end if;
  insert into player_pedidos (user_id, nick) values (auth.uid(), n)
  on conflict (user_id) do update set nick = excluded.nick, created_at = now();
  return 'pedido';
end;
$$;

-- Nick que a conta logada está esperando aprovar (null se nenhum)
create or replace function public.meu_pedido()
returns text
language sql stable security definer set search_path = public
as $$
  select nick from player_pedidos where user_id = auth.uid();
$$;

create or replace function public.admin_pedidos()
returns table (user_id uuid, email text, nick text, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  return query
    select p.user_id, u.email::text, p.nick, p.created_at
    from player_pedidos p join auth.users u on u.id = p.user_id
    order by p.created_at;
end;
$$;

-- Aprovar: entra no elenco (ou volta, se já tinha esse nick) e a conta fica com ele.
-- Devolve: ok | tem_login | nao_existe
create or replace function public.admin_aprovar_pedido(p_user uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  r player_pedidos%rowtype;
  pid uuid;
begin
  select * into r from player_pedidos where user_id = p_user;
  perform exigir_admin('aprovar pedido', jsonb_build_object('user', p_user, 'nick', r.nick));
  if r.user_id is null then return 'nao_existe'; end if;
  select id into pid from players where lower(btrim(nick)) = lower(btrim(r.nick));
  if pid is not null and exists(select 1 from player_contas where player_id = pid and user_id <> p_user) then
    return 'tem_login';
  end if;
  if pid is null then
    insert into players (nick) values (btrim(r.nick)) returning id into pid;
  else
    update players set ativo = true where id = pid and not ativo;
  end if;
  delete from player_contas where user_id = p_user;
  insert into player_contas (player_id, user_id) values (pid, p_user);
  delete from player_pedidos where user_id = p_user;
  return 'ok';
end;
$$;

-- Recusar: apaga o pedido e a conta (quem é de fora não fica com conta parada)
create or replace function public.admin_recusar_pedido(p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform exigir_admin('recusar pedido', jsonb_build_object('user', p_user,
    'nick', (select nick from player_pedidos where user_id = p_user),
    'email', (select email from auth.users where id = p_user)));
  delete from player_pedidos where user_id = p_user;
  delete from auth.users where id = p_user
    and id not in (select user_id from admins)
    and id not in (select user_id from player_contas);
end;
$$;

revoke all on function public.is_membro() from public, anon;
revoke all on function public.nick_status(text) from public;
revoke all on function public.jogador_pedir_nick(text) from public, anon;
revoke all on function public.meu_pedido() from public, anon;
revoke all on function public.admin_pedidos() from public, anon;
revoke all on function public.admin_aprovar_pedido(uuid) from public, anon;
revoke all on function public.admin_recusar_pedido(uuid) from public, anon;
grant execute on function public.is_membro() to authenticated;
grant execute on function public.nick_status(text) to anon, authenticated;
grant execute on function public.jogador_pedir_nick(text) to authenticated;
grant execute on function public.meu_pedido() to authenticated;
grant execute on function public.admin_pedidos() to authenticated;
grant execute on function public.admin_aprovar_pedido(uuid) to authenticated;
grant execute on function public.admin_recusar_pedido(uuid) to authenticated;


-- 5e) Site fechado: o ranking, os jogadores e os torneios só aparecem pra membro logado.
--     Visitante sem login (anon) não lê nada. Conta sem nick ou com pedido esperando também não.
drop policy if exists "membros leem" on public.scores;
create policy "membros leem" on public.scores
  for select to authenticated using ((select public.is_membro()));
drop policy if exists "membros leem jogadores" on public.players;
create policy "membros leem jogadores" on public.players
  for select to authenticated using ((select public.is_membro()));
drop policy if exists "membros leem config" on public.config_site;
create policy "membros leem config" on public.config_site
  for select to authenticated using ((select public.is_membro()));
-- torneio publicado: membro vê; rascunho: só admin
drop policy if exists "membros veem torneios" on public.torneios;
create policy "membros veem torneios" on public.torneios
  for select to authenticated using ((publicado and (select public.is_membro())) or (select public.is_admin()));
drop policy if exists "membros veem resultados" on public.torneio_lancamentos;
create policy "membros veem resultados" on public.torneio_lancamentos
  for select to authenticated
  using ((select public.is_membro()) and exists (select 1 from public.torneios t where t.id = torneio_id));


-- 6) Atualização ao vivo (o ranking muda sozinho na tela de todo mundo)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'torneios'
  ) then
    alter publication supabase_realtime add table public.torneios;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'torneio_lancamentos'
  ) then
    alter publication supabase_realtime add table public.torneio_lancamentos;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'scores'
  ) then
    alter publication supabase_realtime add table public.scores;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'players'
  ) then
    alter publication supabase_realtime add table public.players;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'config_site'
  ) then
    alter publication supabase_realtime add table public.config_site;
  end if;
end;
$$;

-- Pronto! Se apareceu "Success. No rows returned", deu certo.
--
-- Pra dar acesso de admin a alguém (depois de criar a conta em
-- Authentication > Users > Add user), rode, trocando o e-mail e o nome:
--
--   insert into public.admins (user_id, nome)
--   select id, 'Denes' from auth.users where email = 'seu@email.com'
--   on conflict (user_id) do update set nome = excluded.nome;
--
-- Pra tirar o acesso:
--   delete from public.admins where user_id = (select id from auth.users where email = 'email@dele.com');
