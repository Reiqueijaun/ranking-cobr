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
  -- só admin liga a própria conta direto (botão "Sou eu"); jogador passa por pedido e aprovação
  if not is_admin() then
    raise exception 'acesso negado' using errcode = '42501';
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


-- 5d) Pedidos pra entrar: toda conta nova espera um admin aprovar (Jogadores > Pedidos pra entrar),
--     com nick do elenco ou novo. O admin confere e escolhe de quem é o perfil.
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

-- A conta (com e-mail confirmado) pede o nick: vira pedido pra um admin aprovar (do elenco ou novo).
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
  -- nick do elenco também espera um admin conferir (senão qualquer um pega o perfil de outro)
  if pid is not null and exists(select 1 from player_contas where player_id = pid and user_id <> auth.uid()) then
    return 'tem_login';
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

-- Aprovar: a conta fica com o perfil que o admin escolheu (p_player) ou, sem escolha,
-- com o jogador desse nick (entra no elenco se for novo, volta se era ex-membro).
-- Devolve: ok | tem_login | nao_existe
drop function if exists public.admin_aprovar_pedido(uuid);
create or replace function public.admin_aprovar_pedido(p_user uuid, p_player uuid default null)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  r player_pedidos%rowtype;
  pid uuid := p_player;
begin
  select * into r from player_pedidos where user_id = p_user;
  perform exigir_admin('aprovar pedido', jsonb_build_object('user', p_user, 'nick', r.nick, 'perfil', p_player,
    'email', (select email from auth.users where id = p_user)));
  if r.user_id is null then return 'nao_existe'; end if;
  if pid is not null and not exists(select 1 from players where id = pid) then return 'nao_existe'; end if;
  if pid is null then
    select id into pid from players where lower(btrim(nick)) = lower(btrim(r.nick));
  end if;
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
revoke all on function public.admin_aprovar_pedido(uuid, uuid) from public, anon;
revoke all on function public.admin_recusar_pedido(uuid) from public, anon;
grant execute on function public.is_membro() to authenticated;
grant execute on function public.nick_status(text) to anon, authenticated;
grant execute on function public.jogador_pedir_nick(text) to authenticated;
grant execute on function public.meu_pedido() to authenticated;
grant execute on function public.admin_pedidos() to authenticated;
grant execute on function public.admin_aprovar_pedido(uuid, uuid) to authenticated;
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

-- 7) Chat do clã: só membro lê e escreve. Tudo passa pelas funções abaixo (ninguém grava direto).
--    Dono = quem está em "admins": manda no site todo e escolhe os ADMs do chat.
--    ADM do chat = só modera o chat (apaga, fixa, silencia, tira do chat, trava canal, filtro de palavrão).
--    Não registra massa, não aprova entrada e não pune outro ADM. Cada ação vai pro admin_log.
create table if not exists public.chat_mensagens (
  id          bigint generated always as identity primary key,
  canal       text not null check (canal in ('geral', 'bonde', 'recordes', 'avisos')),
  user_id     uuid references auth.users (id) on delete set null,
  player_id   uuid references public.players (id) on delete set null,
  nome        text not null default '' check (char_length(nome) <= 40),
  adm         boolean not null default false,
  tipo        text not null default 'msg' check (tipo in ('msg', 'bonde', 'massa', 'foto')),
  txt         text not null default '' check (char_length(txt) <= 500),
  dados       jsonb not null default '{}'::jsonb,
  resp        bigint references public.chat_mensagens (id) on delete set null,
  fixada      boolean not null default false,
  apagada     boolean not null default false,
  editada     boolean not null default false,
  created_at  timestamptz not null default now()
);
-- (pra quem criou a tabela antes das fotos e da edição)
alter table public.chat_mensagens add column if not exists editada boolean not null default false;
alter table public.chat_mensagens drop constraint if exists chat_mensagens_tipo_check;
alter table public.chat_mensagens add constraint chat_mensagens_tipo_check check (tipo in ('msg', 'bonde', 'massa', 'foto'));
create index if not exists chat_mensagens_canal_id on public.chat_mensagens (canal, id desc);
create index if not exists chat_mensagens_user on public.chat_mensagens (user_id, created_at desc);

create table if not exists public.chat_reacoes (
  msg_id      bigint not null references public.chat_mensagens (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  emoji       text not null check (emoji in ('🔥', '😂', '💀', '👑', '🐍', '💯', '👍', 'GG')),
  created_at  timestamptz not null default now(),
  primary key (msg_id, user_id, emoji)
);

-- quem entrou no bonde (chamada pra jogar junto)
create table if not exists public.chat_bonde (
  msg_id      bigint not null references public.chat_mensagens (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  player_id   uuid references public.players (id) on delete set null,
  nome        text not null default '',
  created_at  timestamptz not null default now(),
  primary key (msg_id, user_id)
);

-- "Tô jogando": o próprio membro liga (ou entra num bonde) e some sozinho depois de 90 min
create table if not exists public.chat_status (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  player_id   uuid references public.players (id) on delete set null,
  nome        text not null default '',
  jogando_ate timestamptz
);

-- silenciado (lê mas não fala) ou banido do chat (nem lê). ate null = até um ADM tirar
create table if not exists public.chat_punicoes (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  tipo        text not null check (tipo in ('silencio', 'ban')),
  ate         timestamptz,
  motivo      text not null default '' check (char_length(motivo) <= 120),
  por         text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.chat_denuncias (
  id          bigint generated always as identity primary key,
  msg_id      bigint not null references public.chat_mensagens (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  motivo      text not null default '' check (char_length(motivo) <= 120),
  created_at  timestamptz not null default now(),
  unique (msg_id, user_id)
);

-- ADMs do chat (o Dono promove e tira pelo site)
create table if not exists public.chat_adms (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  por         text not null default '',
  created_at  timestamptz not null default now()
);

-- canal travado (só ADM fala), modo lento (segundos entre mensagens de cada membro) e #recordes desligado (só o Dono)
create table if not exists public.chat_canais_cfg (
  canal       text primary key,
  travado     boolean not null default false,
  lento       integer not null default 0 check (lento between 0 and 3600)
);
alter table public.chat_canais_cfg add column if not exists desligado boolean not null default false;
alter table public.chat_canais_cfg drop constraint if exists chat_canais_cfg_canal_check;
alter table public.chat_canais_cfg add constraint chat_canais_cfg_canal_check check (canal in ('geral', 'bonde', 'recordes', 'avisos'));

-- palavras que viram *** (lista editada pelos ADMs)
create table if not exists public.chat_palavroes (
  palavra     text primary key check (char_length(palavra) between 2 and 40)
);

alter table public.chat_mensagens enable row level security;
alter table public.chat_reacoes enable row level security;
alter table public.chat_bonde enable row level security;
alter table public.chat_status enable row level security;
alter table public.chat_punicoes enable row level security;
alter table public.chat_denuncias enable row level security;
alter table public.chat_adms enable row level security;
alter table public.chat_canais_cfg enable row level security;
alter table public.chat_palavroes enable row level security;
revoke all on public.chat_mensagens, public.chat_reacoes, public.chat_bonde, public.chat_status, public.chat_punicoes,
  public.chat_denuncias, public.chat_adms, public.chat_canais_cfg, public.chat_palavroes from anon, authenticated;
grant select on public.chat_mensagens, public.chat_reacoes, public.chat_bonde, public.chat_status, public.chat_punicoes,
  public.chat_denuncias, public.chat_adms, public.chat_canais_cfg, public.chat_palavroes to authenticated;

-- ADM do chat (ou Dono)
create or replace function public.is_chat_adm()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists(select 1 from admins where user_id = auth.uid())
      or exists(select 1 from chat_adms where user_id = auth.uid());
$$;

-- conta que ninguém pune nem mexe nas mensagens (a não ser o Dono): Dono e ADMs
create or replace function public.chat_protegido(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists(select 1 from admins where user_id = p_user) or exists(select 1 from chat_adms where user_id = p_user);
$$;

-- confere se é ADM do chat e anota no histórico
create or replace function public.exigir_mod(p_acao text, p_detalhe jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_chat_adm() then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  insert into admin_log (user_id, email, acao, detalhe)
  values (auth.uid(), auth.jwt() ->> 'email', p_acao, p_detalhe);
end;
$$;

-- lê o chat: membro que não foi tirado do chat
create or replace function public.chat_pode_ler()
returns boolean
language sql stable security definer set search_path = public
as $$
  select is_membro() and not exists (
    select 1 from chat_punicoes where user_id = auth.uid() and tipo = 'ban' and (ate is null or ate > now()));
$$;

-- fala no chat: pode ler e não está silenciado (ADM nunca fica de fora)
create or replace function public.chat_exigir_voz()
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not is_membro() then raise exception 'acesso negado' using errcode = '42501'; end if;
  if not is_chat_adm() and exists (select 1 from chat_punicoes where user_id = auth.uid() and (ate is null or ate > now())) then
    raise exception 'silenciado' using errcode = 'P0001';
  end if;
end;
$$;

-- nome que aparece no chat: o nick do jogador, ou o nome de admin
create or replace function public.chat_nome(p_user uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select left(coalesce((select p.nick from player_contas c join players p on p.id = c.player_id where c.user_id = p_user),
                       (select nullif(btrim(nome), '') from admins where user_id = p_user), 'Membro'), 40);
$$;

-- troca os palavrões da lista por ***
create or replace function public.chat_filtrar(p_txt text)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare w text; t text := p_txt;
begin
  for w in select palavra from chat_palavroes loop
    t := regexp_replace(t, '(^|[^[:alnum:]_])(' || regexp_replace(w, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || ')(?![[:alnum:]_])',
                        '\1' || repeat('*', char_length(w)), 'gi');
  end loop;
  return t;
end;
$$;

drop policy if exists "membros leem o chat" on public.chat_mensagens;
create policy "membros leem o chat" on public.chat_mensagens for select to authenticated using ((select public.chat_pode_ler()));
drop policy if exists "membros leem reacoes" on public.chat_reacoes;
create policy "membros leem reacoes" on public.chat_reacoes for select to authenticated using ((select public.chat_pode_ler()));
drop policy if exists "membros leem bonde" on public.chat_bonde;
create policy "membros leem bonde" on public.chat_bonde for select to authenticated using ((select public.chat_pode_ler()));
drop policy if exists "membros leem status" on public.chat_status;
create policy "membros leem status" on public.chat_status for select to authenticated using ((select public.chat_pode_ler()));
drop policy if exists "membros leem adms" on public.chat_adms;
create policy "membros leem adms" on public.chat_adms for select to authenticated using ((select public.chat_pode_ler()));
drop policy if exists "membros leem canais" on public.chat_canais_cfg;
create policy "membros leem canais" on public.chat_canais_cfg for select to authenticated using ((select public.chat_pode_ler()));
-- a punição: a própria pessoa vê a dela; os ADMs veem todas
drop policy if exists "punicao propria ou adm" on public.chat_punicoes;
create policy "punicao propria ou adm" on public.chat_punicoes for select to authenticated using (user_id = (select auth.uid()) or (select public.is_chat_adm()));
-- denúncias e lista de palavrões: só ADM
drop policy if exists "adm le denuncias" on public.chat_denuncias;
create policy "adm le denuncias" on public.chat_denuncias for select to authenticated using ((select public.is_chat_adm()));
drop policy if exists "adm le palavroes" on public.chat_palavroes;
create policy "adm le palavroes" on public.chat_palavroes for select to authenticated using ((select public.is_chat_adm()));

-- quem é a conta logada no chat
create or replace function public.chat_eu()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'player_id', (select player_id from player_contas where user_id = auth.uid()),
    'nome', chat_nome(auth.uid()),
    'adm', is_chat_adm(),
    'dono', is_admin(),
    'punicao', (select to_jsonb(x) - 'user_id' from chat_punicoes x where x.user_id = auth.uid() and (x.ate is null or x.ate > now())));
$$;

-- Dono e ADMs (pras etiquetas no chat)
create or replace function public.chat_equipe()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case when not chat_pode_ler() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('user_id', user_id, 'papel', papel)) from (
      select user_id, 'dono' as papel from admins
      union all
      select user_id, 'adm' from chat_adms where user_id not in (select user_id from admins)) e), '[]'::jsonb) end;
$$;

-- manda mensagem, foto ou abre um bonde. Devolve o id.
create or replace function public.chat_enviar(p_canal text, p_txt text, p_resp bigint default null, p_tipo text default 'msg', p_dados jsonb default '{}'::jsonb)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_txt text := btrim(coalesce(p_txt, ''));
  v_player uuid := (select player_id from player_contas where user_id = auth.uid());
  v_nome text := chat_nome(auth.uid());
  v_mod boolean := is_chat_adm();
  v_cfg chat_canais_cfg;
  v_dados jsonb := '{}'::jsonb;
  novo bigint;
begin
  perform chat_exigir_voz();
  if p_canal not in ('geral', 'bonde', 'avisos') then raise exception 'canal invalido'; end if;
  if p_canal = 'avisos' and not v_mod then raise exception 'acesso negado' using errcode = '42501'; end if;
  select * into v_cfg from chat_canais_cfg where canal = p_canal;
  if coalesce(v_cfg.travado, false) and not v_mod then raise exception 'travado' using errcode = 'P0001'; end if;
  if p_tipo not in ('msg', 'bonde', 'foto') then raise exception 'tipo invalido'; end if;
  if p_tipo = 'msg' and (char_length(v_txt) < 1 or char_length(v_txt) > 500) then raise exception 'texto invalido'; end if;
  if p_tipo = 'bonde' then
    v_dados := jsonb_build_object('srv', left(btrim(coalesce(p_dados ->> 'srv', 'Servidor BR')), 40),
                                  'max', greatest(2, least(10, coalesce((p_dados ->> 'max')::int, 6))));
    v_txt := left(v_txt, 120);
  end if;
  if p_tipo = 'foto' then
    -- a foto já foi enviada pra pasta da própria conta no armazenamento "chat"
    if coalesce(p_dados ->> 'path', '') !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]+$') then raise exception 'foto invalida'; end if;
    v_dados := jsonb_build_object('path', p_dados ->> 'path', 'w', least(4000, greatest(1, coalesce((p_dados ->> 'w')::int, 1))),
                                  'h', least(4000, greatest(1, coalesce((p_dados ->> 'h')::int, 1))));
    v_txt := left(v_txt, 500);
  end if;
  if not v_mod then
    -- anti-flood: no máximo 5 mensagens em 10 segundos; e o modo lento do canal
    if (select count(*) from chat_mensagens where user_id = auth.uid() and created_at > now() - interval '10 seconds') >= 5 then
      raise exception 'devagar' using errcode = 'P0001';
    end if;
    if coalesce(v_cfg.lento, 0) > 0 and exists (select 1 from chat_mensagens where user_id = auth.uid() and canal = p_canal
        and created_at > now() - make_interval(secs => v_cfg.lento)) then
      raise exception 'lento' using errcode = 'P0001';
    end if;
  end if;
  if p_resp is not null and not exists (select 1 from chat_mensagens where id = p_resp) then p_resp := null; end if;
  insert into chat_mensagens (canal, user_id, player_id, nome, adm, tipo, txt, dados, resp)
  values (p_canal, auth.uid(), v_player, v_nome, v_mod, p_tipo, chat_filtrar(v_txt), v_dados, p_resp)
  returning id into novo;
  if p_tipo = 'bonde' then
    insert into chat_bonde (msg_id, user_id, player_id, nome) values (novo, auth.uid(), v_player, v_nome);
    insert into chat_status (user_id, player_id, nome, jogando_ate) values (auth.uid(), v_player, v_nome, now() + interval '90 minutes')
    on conflict (user_id) do update set jogando_ate = excluded.jogando_ate, player_id = excluded.player_id, nome = excluded.nome;
  end if;
  return novo;
end;
$$;

-- editar a própria mensagem (até 15 minutos depois)
create or replace function public.chat_editar(p_msg bigint, p_txt text)
returns text
language plpgsql security definer set search_path = public
as $$
declare v_txt text := btrim(coalesce(p_txt, '')); m chat_mensagens;
begin
  perform chat_exigir_voz();
  select * into m from chat_mensagens where id = p_msg;
  if m.id is null or m.user_id is distinct from auth.uid() or m.apagada or m.tipo not in ('msg', 'foto') then raise exception 'acesso negado' using errcode = '42501'; end if;
  if m.created_at < now() - interval '15 minutes' then raise exception 'tarde' using errcode = 'P0001'; end if;
  if char_length(v_txt) > 500 or (m.tipo = 'msg' and char_length(v_txt) < 1) then raise exception 'texto invalido'; end if;
  v_txt := chat_filtrar(v_txt);
  update chat_mensagens set txt = v_txt, editada = true where id = p_msg;
  return v_txt;
end;
$$;

-- põe ou tira uma reação. Devolve true se ficou com ela.
create or replace function public.chat_reagir(p_msg bigint, p_emoji text)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  perform chat_exigir_voz();
  if not exists (select 1 from chat_mensagens where id = p_msg and not apagada) then return false; end if;
  delete from chat_reacoes where msg_id = p_msg and user_id = auth.uid() and emoji = p_emoji;
  if found then return false; end if;
  insert into chat_reacoes (msg_id, user_id, emoji) values (p_msg, auth.uid(), p_emoji);
  return true;
end;
$$;

-- entra ou sai do bonde. Devolve: ok | lotado | fechado
create or replace function public.chat_bonde_entrar(p_msg bigint, p_entrar boolean)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  m chat_mensagens;
  v_player uuid := (select player_id from player_contas where user_id = auth.uid());
  v_nome text := chat_nome(auth.uid());
begin
  perform chat_exigir_voz();
  select * into m from chat_mensagens where id = p_msg and tipo = 'bonde' and not apagada;
  if m.id is null or m.created_at < now() - interval '3 hours' then return 'fechado'; end if;
  if not p_entrar then
    delete from chat_bonde where msg_id = p_msg and user_id = auth.uid();
    update chat_status set jogando_ate = null where user_id = auth.uid();
    return 'ok';
  end if;
  if exists (select 1 from chat_bonde where msg_id = p_msg and user_id = auth.uid()) then return 'ok'; end if;
  if (select count(*) from chat_bonde where msg_id = p_msg) >= coalesce((m.dados ->> 'max')::int, 6) then return 'lotado'; end if;
  insert into chat_bonde (msg_id, user_id, player_id, nome) values (p_msg, auth.uid(), v_player, v_nome);
  insert into chat_status (user_id, player_id, nome, jogando_ate) values (auth.uid(), v_player, v_nome, now() + interval '90 minutes')
  on conflict (user_id) do update set jogando_ate = excluded.jogando_ate, player_id = excluded.player_id, nome = excluded.nome;
  return 'ok';
end;
$$;

-- "Tô jogando" liga (90 min) ou desliga
create or replace function public.chat_jogando(p_ligar boolean)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare v_ate timestamptz := case when p_ligar then now() + interval '90 minutes' end;
begin
  if not chat_pode_ler() then raise exception 'acesso negado' using errcode = '42501'; end if;
  insert into chat_status (user_id, player_id, nome, jogando_ate)
  values (auth.uid(), (select player_id from player_contas where user_id = auth.uid()), chat_nome(auth.uid()), v_ate)
  on conflict (user_id) do update set jogando_ate = excluded.jogando_ate, player_id = excluded.player_id, nome = excluded.nome;
  return v_ate;
end;
$$;

-- membro denuncia uma mensagem pros ADMs olharem
create or replace function public.chat_denunciar(p_msg bigint, p_motivo text default '')
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not chat_pode_ler() then raise exception 'acesso negado' using errcode = '42501'; end if;
  insert into chat_denuncias (msg_id, user_id, motivo) values (p_msg, auth.uid(), left(btrim(coalesce(p_motivo, '')), 120))
  on conflict (msg_id, user_id) do nothing;
end;
$$;

-- apagar: o membro apaga a dele; ADM apaga a de membro; mensagem de ADM ou do Dono, só o Dono.
-- Devolve o caminho da foto (pro site apagar o arquivo também) ou null.
drop function if exists public.chat_apagar(bigint);
create function public.chat_apagar(p_msg bigint)
returns text
language plpgsql security definer set search_path = public
as $$
declare m chat_mensagens;
begin
  select * into m from chat_mensagens where id = p_msg;
  if m.id is null then return null; end if;
  if m.user_id is distinct from auth.uid() or not is_membro() then
    if m.tipo = 'massa' then raise exception 'acesso negado' using errcode = '42501'; end if;
    if chat_protegido(m.user_id) and not is_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
    perform exigir_mod('chat_apagar', jsonb_build_object('msg', m.id, 'canal', m.canal, 'autor', m.nome, 'texto', m.txt));
  end if;
  update chat_mensagens set apagada = true, fixada = false, txt = '' where id = p_msg;
  delete from chat_reacoes where msg_id = p_msg;
  delete from chat_denuncias where msg_id = p_msg;
  return case when m.tipo = 'foto' then m.dados ->> 'path' end;
end;
$$;

-- apaga as mensagens de alguém (p_horas null = todas). Devolve { qtd, fotos }
create or replace function public.chat_limpar(p_user uuid, p_horas integer default 24)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_fotos jsonb; v_qtd integer;
begin
  if chat_protegido(p_user) and not is_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  perform exigir_mod('chat_limpar', jsonb_build_object('quem', chat_nome(p_user), 'horas', p_horas));
  select coalesce(jsonb_agg(dados ->> 'path') filter (where tipo = 'foto'), '[]'::jsonb), count(*) into v_fotos, v_qtd
  from chat_mensagens where user_id = p_user and not apagada and (p_horas is null or created_at > now() - make_interval(hours => p_horas));
  delete from chat_reacoes where msg_id in (select id from chat_mensagens where user_id = p_user and not apagada and (p_horas is null or created_at > now() - make_interval(hours => p_horas)));
  update chat_mensagens set apagada = true, fixada = false, txt = ''
  where user_id = p_user and not apagada and (p_horas is null or created_at > now() - make_interval(hours => p_horas));
  return jsonb_build_object('qtd', v_qtd, 'fotos', v_fotos);
end;
$$;

create or replace function public.chat_fixar(p_msg bigint, p_fixar boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_canal text := (select canal from chat_mensagens where id = p_msg);
begin
  perform exigir_mod(case when p_fixar then 'chat_fixar' else 'chat_desafixar' end, jsonb_build_object('msg', p_msg, 'canal', v_canal));
  if p_fixar then update chat_mensagens set fixada = false where canal = v_canal and fixada; end if;
  update chat_mensagens set fixada = p_fixar where id = p_msg and not apagada;
end;
$$;

-- silenciar (p_tipo 'silencio') ou tirar do chat ('ban'). p_minutos null = até um ADM tirar.
-- Dono e ADMs não podem ser punidos. Devolve: ok | adm
create or replace function public.chat_punir(p_user uuid, p_tipo text, p_minutos integer default null, p_motivo text default '')
returns text
language plpgsql security definer set search_path = public
as $$
begin
  if p_tipo not in ('silencio', 'ban') then raise exception 'tipo invalido'; end if;
  if chat_protegido(p_user) then return 'adm'; end if;
  perform exigir_mod('chat_punir', jsonb_build_object('quem', chat_nome(p_user), 'tipo', p_tipo, 'minutos', p_minutos, 'motivo', p_motivo));
  insert into chat_punicoes (user_id, tipo, ate, motivo, por)
  values (p_user, p_tipo, case when p_minutos is not null then now() + make_interval(mins => p_minutos) end,
          left(btrim(coalesce(p_motivo, '')), 120), chat_nome(auth.uid()))
  on conflict (user_id) do update set tipo = excluded.tipo, ate = excluded.ate, motivo = excluded.motivo, por = excluded.por, created_at = now();
  return 'ok';
end;
$$;

create or replace function public.chat_perdoar(p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform exigir_mod('chat_perdoar', jsonb_build_object('quem', chat_nome(p_user)));
  delete from chat_punicoes where user_id = p_user;
end;
$$;

-- a denúncia não era nada: some da lista
create or replace function public.chat_ignorar_denuncia(p_msg bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform exigir_mod('chat_ignorar_denuncia', jsonb_build_object('msg', p_msg));
  delete from chat_denuncias where msg_id = p_msg;
end;
$$;

-- travar canal (só ADM fala) e modo lento (segundos; 0 = desligado)
create or replace function public.chat_config_canal(p_canal text, p_travado boolean, p_lento integer)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform exigir_mod('chat_canal', jsonb_build_object('canal', p_canal, 'travado', p_travado, 'lento', p_lento));
  insert into chat_canais_cfg (canal, travado, lento) values (p_canal, coalesce(p_travado, false), greatest(0, least(3600, coalesce(p_lento, 0))))
  on conflict (canal) do update set travado = excluded.travado, lento = excluded.lento;
end;
$$;

-- só o Dono: desliga o #recordes (some do chat e as massas param de cair lá) ou liga de volta
create or replace function public.dono_canal(p_canal text, p_ligado boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_canal is distinct from 'recordes' then raise exception 'canal invalido'; end if;
  perform exigir_admin('dono_canal', jsonb_build_object('canal', p_canal, 'ligado', p_ligado));
  insert into chat_canais_cfg (canal, desligado) values (p_canal, not coalesce(p_ligado, true))
  on conflict (canal) do update set desligado = excluded.desligado;
end;
$$;

create or replace function public.chat_salvar_palavroes(p_lista text[])
returns integer
language plpgsql security definer set search_path = public
as $$
begin
  perform exigir_mod('chat_palavroes', jsonb_build_object('qtd', coalesce(array_length(p_lista, 1), 0)));
  delete from chat_palavroes where true;
  insert into chat_palavroes (palavra)
  select distinct lower(btrim(x)) from unnest(coalesce(p_lista, '{}')) x where char_length(btrim(x)) between 2 and 40
  on conflict do nothing;
  return (select count(*) from chat_palavroes);
end;
$$;

-- painel de moderação: denúncias abertas, quem está punido, canais, palavrões e o histórico do chat
create or replace function public.chat_moderacao()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not is_chat_adm() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return jsonb_build_object(
    'denuncias', coalesce((select jsonb_agg(d order by d.ultima desc) from (
      select m.id as msg_id, m.canal, m.user_id, m.nome, m.txt, m.tipo, m.created_at,
             count(*) as qtd, max(x.created_at) as ultima,
             jsonb_agg(jsonb_build_object('quem', chat_nome(x.user_id), 'motivo', x.motivo)) as quem
      from chat_denuncias x join chat_mensagens m on m.id = x.msg_id
      group by m.id) d), '[]'::jsonb),
    'punidos', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'nome', chat_nome(x.user_id),
        'player_id', (select player_id from player_contas where user_id = x.user_id),
        'tipo', x.tipo, 'ate', x.ate, 'motivo', x.motivo, 'por', x.por, 'created_at', x.created_at) order by x.created_at desc)
      from chat_punicoes x where x.ate is null or x.ate > now()), '[]'::jsonb),
    'canais', coalesce((select jsonb_object_agg(canal, jsonb_build_object('travado', travado, 'lento', lento, 'desligado', desligado)) from chat_canais_cfg), '{}'::jsonb),
    'palavroes', coalesce((select jsonb_agg(palavra order by palavra) from chat_palavroes), '[]'::jsonb),
    'historico', coalesce((select jsonb_agg(h order by h.created_at desc) from (
      select l.acao, l.detalhe, l.created_at, coalesce(a.nome, chat_nome(l.user_id), l.email) as quem
      from admin_log l left join admins a on a.user_id = l.user_id
      where l.acao like 'chat_%' or l.acao like 'dono_%' order by l.created_at desc limit 50) h), '[]'::jsonb),
    'faxina', jsonb_build_object(
      'fotos', (select count(*) from chat_mensagens m where chat_foto_vencida(m) and not m.apagada),
      'msgs', (select count(*) from chat_mensagens m where chat_msg_vencida(m)),
      'ultima', (select max(created_at) from admin_log where acao = 'chat_faxina')));
end;
$$;

-- ---------- faxina: foto vence com 30 dias, mensagem com 90. #avisos e fixadas nunca vencem ----------
-- O banco não apaga arquivo do Storage, então são 3 passos, feitos pelo site quando um ADM abre o chat
-- (ou o Dono aperta "Limpar agora"): 1) chat_faxina_fotos() diz quais arquivos venceram,
-- 2) o ADM apaga esses arquivos (a regra "dono ou adm apaga foto do chat" deixa),
-- 3) chat_faxina() marca essas fotos como expiradas e apaga as mensagens vencidas.
create or replace function public.chat_foto_vencida(m public.chat_mensagens)
returns boolean
language sql stable set search_path = public
as $$
  select m.tipo = 'foto' and m.dados ? 'path' and not m.fixada and m.canal <> 'avisos' and m.created_at < now() - interval '30 days';
$$;
-- (foto que ainda tem arquivo fica até o arquivo sair, pra nunca sobrar arquivo perdido no Storage)
create or replace function public.chat_msg_vencida(m public.chat_mensagens)
returns boolean
language sql stable set search_path = public
as $$
  select not m.fixada and m.canal <> 'avisos' and not m.dados ? 'path' and m.created_at < now() - interval '90 days';
$$;

-- arquivos de foto vencidos (inclui foto apagada cujo arquivo pode ter ficado), de 200 em 200
create or replace function public.chat_faxina_fotos()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not is_chat_adm() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x.path) from (
    select m.dados ->> 'path' as path from chat_mensagens m where chat_foto_vencida(m) order by m.id limit 200) x), '[]'::jsonb);
end;
$$;

-- p_fotos: os arquivos que o site já apagou. p_manual: o Dono apertou "Limpar agora". Devolve { fotos, msgs }
create or replace function public.chat_faxina(p_fotos text[] default '{}', p_manual boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_fotos integer; v_msgs integer;
begin
  if not is_chat_adm() or (p_manual and not is_admin()) then raise exception 'acesso negado' using errcode = '42501'; end if;
  update chat_mensagens m set dados = (m.dados - 'path') || '{"expirada": true}'::jsonb
  where chat_foto_vencida(m) and m.dados ->> 'path' = any(coalesce(p_fotos, '{}'));
  get diagnostics v_fotos = row_count;
  delete from chat_mensagens m where chat_msg_vencida(m);
  get diagnostics v_msgs = row_count;
  if p_manual or v_fotos + v_msgs > 0 then
    insert into admin_log (user_id, email, acao, detalhe)
    values (auth.uid(), auth.jwt() ->> 'email', 'chat_faxina', jsonb_build_object('fotos', v_fotos, 'msgs', v_msgs, 'manual', p_manual));
  end if;
  return jsonb_build_object('fotos', v_fotos, 'msgs', v_msgs);
end;
$$;

-- ---------- Dono: equipe do chat e expulsão ----------
-- todas as contas de membro, com o papel de cada um
create or replace function public.dono_equipe()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not is_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(e order by e.ordem, lower(e.nome)) from (
    select c.user_id, c.player_id, p.nick as nome,
           case when exists (select 1 from admins a where a.user_id = c.user_id) then 'dono'
                when exists (select 1 from chat_adms d where d.user_id = c.user_id) then 'adm' else 'membro' end as papel,
           case when exists (select 1 from admins a where a.user_id = c.user_id) then 0
                when exists (select 1 from chat_adms d where d.user_id = c.user_id) then 1 else 2 end as ordem
    from player_contas c join players p on p.id = c.player_id
    union all
    select a.user_id, null, coalesce(nullif(btrim(a.nome), ''), 'Dono'), 'dono', 0
    from admins a where not exists (select 1 from player_contas c where c.user_id = a.user_id)) e), '[]'::jsonb);
end;
$$;

-- promover a ADM do chat (p_adm true) ou tirar
create or replace function public.dono_promover(p_user uuid, p_adm boolean)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  perform exigir_admin(case when p_adm then 'dono_promover' else 'dono_rebaixar' end, jsonb_build_object('quem', chat_nome(p_user)));
  if exists (select 1 from admins where user_id = p_user) then return 'dono'; end if;
  if not exists (select 1 from player_contas where user_id = p_user) then return 'nao_existe'; end if;
  if p_adm then
    insert into chat_adms (user_id, por) values (p_user, chat_nome(auth.uid())) on conflict (user_id) do nothing;
    delete from chat_punicoes where user_id = p_user;
  else
    delete from chat_adms where user_id = p_user;
  end if;
  return 'ok';
end;
$$;

-- expulsar do clã: a conta é apagada e o jogador vira ex-membro (as partidas ficam no ranking)
create or replace function public.dono_expulsar(p_user uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare v_player uuid := (select player_id from player_contas where user_id = p_user);
begin
  perform exigir_admin('dono_expulsar', jsonb_build_object('quem', chat_nome(p_user)));
  if exists (select 1 from admins where user_id = p_user) then return 'dono'; end if;
  if v_player is not null then update players set ativo = false where id = v_player; end if;
  delete from auth.users where id = p_user;
  return 'ok';
end;
$$;

-- massa registrada no ranking cai sozinha no #recordes, se o Dono não desligou (e no #geral quando passa de 100k)
create or replace function public.chat_massa_nova()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_dados jsonb;
begin
  if tg_op = 'DELETE' then
    delete from chat_mensagens where tipo = 'massa' and dados ->> 'score_id' = old.id::text;
    return old;
  end if;
  v_dados := jsonb_build_object('score_id', new.id, 'player', new.player, 'mass', new.mass);
  if not exists (select 1 from chat_canais_cfg where canal = 'recordes' and desligado) then
    insert into chat_mensagens (canal, nome, tipo, dados, created_at) values ('recordes', 'COBR', 'massa', v_dados, new.created_at);
  end if;
  if new.mass >= 100000 then
    insert into chat_mensagens (canal, nome, tipo, dados, created_at) values ('geral', 'COBR', 'massa', v_dados, new.created_at);
  end if;
  return new;
exception when others then
  -- o chat nunca atrapalha registrar ou apagar partida
  return coalesce(new, old);
end;
$$;
drop trigger if exists chat_massa_nova on public.scores;
create trigger chat_massa_nova after insert or delete on public.scores
  for each row execute function public.chat_massa_nova();

-- fotos do chat: pasta fechada (só membro vê), cada um envia na própria pasta, até 2 MB
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat', 'chat', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "membros veem fotos do chat" on storage.objects;
drop policy if exists "membros enviam fotos do chat" on storage.objects;
drop policy if exists "dono ou adm apaga foto do chat" on storage.objects;
create policy "membros veem fotos do chat" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat' and public.chat_pode_ler());
create policy "membros enviam fotos do chat" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat' and (storage.foldername(name))[1] = auth.uid()::text and public.chat_pode_ler()
              and not exists (select 1 from public.chat_punicoes where user_id = auth.uid() and (ate is null or ate > now())));
create policy "dono ou adm apaga foto do chat" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_chat_adm()));

-- ---------- notificações no celular ----------
-- O banco monta quem recebe e chama /api/push do site (Vercel), que entrega as notificações.
-- As chaves e o segredo ficam só na tabela push_config (ninguém de fora lê);
-- são preenchidas uma vez à mão, fora deste arquivo.
create extension if not exists pg_net with schema extensions;
create table if not exists public.push_config (
  id            integer primary key default 1 check (id = 1),
  url           text,
  segredo       text,
  sujeito       text,
  vapid_publica text,
  vapid_privada text,
  sb_url        text,
  sb_chave      text
);
create table if not exists public.push_inscricoes (
  endpoint    text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
create table if not exists public.push_prefs (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  mencao      boolean not null default true,
  resposta    boolean not null default true,
  aviso       boolean not null default true,
  bonde       boolean not null default true
);
alter table public.push_config enable row level security;
alter table public.push_inscricoes enable row level security;
alter table public.push_prefs enable row level security;
revoke all on public.push_config, public.push_inscricoes, public.push_prefs from anon, authenticated;

create or replace function public.push_chave()
returns text
language sql stable security definer set search_path = public
as $$
  select case when is_membro() then (select vapid_publica from push_config where id = 1) end;
$$;

-- este aparelho recebe (ou não) as notificações da conta logada
create or replace function public.push_inscrever(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_membro() then raise exception 'acesso negado' using errcode = '42501'; end if;
  insert into push_inscricoes (endpoint, user_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;
create or replace function public.push_sair(p_endpoint text)
returns void
language sql security definer set search_path = public
as $$
  delete from push_inscricoes where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- o que a conta quer receber, e se este aparelho está inscrito
create or replace function public.push_eu(p_endpoint text default null)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'prefs', coalesce((select to_jsonb(p) - 'user_id' from push_prefs p where p.user_id = auth.uid()),
                      '{"mencao": true, "resposta": true, "aviso": true, "bonde": true}'::jsonb),
    'inscrito', exists (select 1 from push_inscricoes where endpoint = p_endpoint and user_id = auth.uid()));
$$;
create or replace function public.push_salvar_prefs(p_mencao boolean, p_resposta boolean, p_aviso boolean, p_bonde boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_membro() then raise exception 'acesso negado' using errcode = '42501'; end if;
  insert into push_prefs (user_id, mencao, resposta, aviso, bonde) values (auth.uid(), p_mencao, p_resposta, p_aviso, p_bonde)
  on conflict (user_id) do update set mencao = excluded.mencao, resposta = excluded.resposta, aviso = excluded.aviso, bonde = excluded.bonde;
end;
$$;

-- /api/push devolve os aparelhos que não existem mais (celular trocado, app desinstalado)
create or replace function public.push_remover(p_segredo text, p_endpoints text[])
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_segredo is null or p_segredo is distinct from (select segredo from push_config where id = 1) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  delete from push_inscricoes where endpoint = any (p_endpoints);
end;
$$;

-- mensagem nova: quem foi marcado, quem recebeu a resposta, aviso do ADM e bonde chamado
create or replace function public.chat_avisar_push()
returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare
  cfg push_config;
  v_autor text;
  v_envios jsonb;
begin
  select * into cfg from push_config where id = 1;
  if cfg.url is null or cfg.vapid_privada is null or new.tipo not in ('msg', 'bonde', 'foto') then return new; end if;
  if new.canal <> 'avisos' and new.tipo <> 'bonde' and new.resp is null and position('@' in new.txt) = 0 then return new; end if;
  v_autor := coalesce((select nick from players where id = new.player_id), nullif(new.nome, ''), 'Alguém');
  with membros as (
    select user_id from player_contas union select user_id from admins
  ), alvo as (
    select m.user_id, 'aviso' as motivo, 3 as ordem from membros m where new.canal = 'avisos'
    union all
    select m.user_id, 'bonde', 4 from membros m where new.tipo = 'bonde'
    union all
    select c.user_id, 'mencao', 1 from player_contas c join players p on p.id = c.player_id
      where new.txt ~* ('(^|[^[:alnum:]_])@' || regexp_replace(p.nick, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '(?![[:alnum:]_])')
    union all
    select r.user_id, 'resposta', 2 from chat_mensagens r where r.id = new.resp and r.user_id is not null
  ), um as (
    select distinct on (a.user_id) a.user_id, a.motivo from alvo a
    where a.user_id is distinct from new.user_id
      and not exists (select 1 from chat_punicoes x where x.user_id = a.user_id and x.tipo = 'ban' and (x.ate is null or x.ate > now()))
    order by a.user_id, a.ordem
  ), quer as (
    select u.user_id, u.motivo from um u left join push_prefs p on p.user_id = u.user_id
    where case u.motivo when 'mencao' then coalesce(p.mencao, true) when 'resposta' then coalesce(p.resposta, true)
                        when 'aviso' then coalesce(p.aviso, true) else coalesce(p.bonde, true) end
  )
  select jsonb_agg(jsonb_build_object('endpoint', i.endpoint, 'p256dh', i.p256dh, 'auth', i.auth, 'payload', jsonb_build_object(
      'title', case q.motivo when 'mencao' then v_autor || ' te marcou no #' || new.canal
                             when 'resposta' then v_autor || ' respondeu você'
                             when 'aviso' then 'Aviso do clã · ' || v_autor
                             else v_autor || ' chamou o bonde' end,
      'body', case when new.tipo = 'bonde' then coalesce(new.dados ->> 'srv', 'Servidor BR') || case when new.txt <> '' then ' · ' || new.txt else '' end
                   when new.tipo = 'foto' and new.txt = '' then '📷 Foto'
                   else left(new.txt, 160) end,
      'tag', 'chat-' || new.canal,
      'url', '/#chat')))
  into v_envios
  from quer q join push_inscricoes i on i.user_id = q.user_id;
  if v_envios is null then return new; end if;
  perform net.http_post(
    url := cfg.url,
    body := jsonb_build_object('segredo', cfg.segredo, 'sujeito', cfg.sujeito, 'publica', cfg.vapid_publica, 'privada', cfg.vapid_privada,
                               'sb', cfg.sb_url, 'chave', cfg.sb_chave, 'envios', v_envios),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 8000);
  return new;
exception when others then
  -- notificação nunca atrapalha mandar mensagem
  return new;
end;
$$;
drop trigger if exists chat_avisar_push on public.chat_mensagens;
create trigger chat_avisar_push after insert on public.chat_mensagens
  for each row execute function public.chat_avisar_push();

-- quem executa o quê
revoke all on function public.chat_exigir_voz() from public, anon, authenticated;
revoke all on function public.chat_massa_nova() from public, anon, authenticated;
revoke all on function public.chat_avisar_push() from public, anon, authenticated;
revoke all on function public.exigir_mod(text, jsonb) from public, anon, authenticated;
revoke all on function public.chat_nome(uuid) from public, anon, authenticated;
revoke all on function public.chat_filtrar(text) from public, anon, authenticated;
revoke all on function public.chat_protegido(uuid) from public, anon, authenticated;
revoke all on function public.chat_foto_vencida(public.chat_mensagens) from public, anon, authenticated;
revoke all on function public.chat_msg_vencida(public.chat_mensagens) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'is_chat_adm()', 'chat_pode_ler()', 'chat_eu()', 'chat_equipe()',
    'chat_enviar(text, text, bigint, text, jsonb)', 'chat_editar(bigint, text)', 'chat_reagir(bigint, text)',
    'chat_bonde_entrar(bigint, boolean)', 'chat_jogando(boolean)', 'chat_denunciar(bigint, text)', 'chat_apagar(bigint)',
    'chat_limpar(uuid, integer)', 'chat_fixar(bigint, boolean)', 'chat_punir(uuid, text, integer, text)', 'chat_perdoar(uuid)',
    'chat_ignorar_denuncia(bigint)', 'chat_config_canal(text, boolean, integer)', 'chat_salvar_palavroes(text[])', 'chat_moderacao()',
    'chat_faxina_fotos()', 'chat_faxina(text[], boolean)',
    'dono_equipe()', 'dono_promover(uuid, boolean)', 'dono_expulsar(uuid)', 'dono_canal(text, boolean)',
    'push_chave()', 'push_inscrever(text, text, text)', 'push_sair(text)', 'push_eu(text)', 'push_salvar_prefs(boolean, boolean, boolean, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
-- /api/push chama sem login (anon), protegido pelo segredo
revoke all on function public.push_remover(text, text[]) from public;
grant execute on function public.push_remover(text, text[]) to anon, authenticated;

-- chat ao vivo
do $$
declare t text;
begin
  foreach t in array array['chat_mensagens', 'chat_reacoes', 'chat_bonde', 'chat_status', 'chat_punicoes', 'chat_denuncias', 'chat_adms', 'chat_canais_cfg'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- 8) Painel do Dono: quantas pessoas usam o site, quais telas, que horas e em que aparelho.
--    O site de cada membro avisa quando abre, quando troca de tela e a cada minuto que fica aberto
--    na tela. Uma linha por pessoa por dia (horário de Brasília). Só o Dono lê (dono_painel).
create table if not exists public.site_uso (
  user_id     uuid not null references auth.users (id) on delete cascade,
  dia         date not null,
  aberturas   integer not null default 0,
  minutos     integer not null default 0,
  telas       jsonb not null default '{}'::jsonb,   -- tela -> vezes que abriu
  horas       jsonb not null default '{}'::jsonb,   -- hora do dia (0 a 23) -> minutos com o site aberto
  aparelho    text not null default '' check (aparelho in ('', 'celular', 'computador')),
  app         boolean not null default false,       -- abriu pelo app instalado
  tela_atual  text not null default '',
  ultimo      timestamptz not null default now(),
  ultimo_ping timestamptz,
  primary key (user_id, dia)
);
create index if not exists site_uso_dia on public.site_uso (dia);
create index if not exists site_uso_ultimo on public.site_uso (ultimo desc);
alter table public.site_uso enable row level security;
revoke all on public.site_uso from anon, authenticated;
-- (sem políticas = ninguém lê direto; o Dono vê tudo pelo dono_painel)

-- p_tipo: abriu (abriu o site) | tela (trocou de tela) | ping (mais um minuto com o site aberto)
create or replace function public.site_marcar(p_tela text, p_tipo text, p_aparelho text default '', p_app boolean default false)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_agora timestamp := now() at time zone 'America/Sao_Paulo';
  v_tipo text := case when p_tipo in ('abriu', 'tela', 'ping') then p_tipo else 'ping' end;
  v_tela text := case when p_tela in ('ranking', 'chat', 'torneios', 'trofeus', 'jogadores', 'partidas', 'patentes',
                                       'perfil', 'torneio', 'painel') then p_tela else 'outra' end;
  v_hora text := extract(hour from v_agora)::int::text;
  v_aparelho text := case when p_aparelho in ('celular', 'computador') then p_aparelho else '' end;
begin
  if auth.uid() is null or not is_membro() then return; end if;
  insert into site_uso as s (user_id, dia, aberturas, minutos, telas, horas, aparelho, app, tela_atual, ultimo, ultimo_ping)
  values (auth.uid(), v_agora::date, (v_tipo = 'abriu')::int, (v_tipo = 'ping')::int,
          case when v_tipo = 'ping' then '{}'::jsonb else jsonb_build_object(v_tela, 1) end,
          case when v_tipo = 'tela' then '{}'::jsonb else jsonb_build_object(v_hora, 1) end,
          v_aparelho, coalesce(p_app, false), v_tela, now(), case when v_tipo = 'ping' then now() end)
  on conflict (user_id, dia) do update set
    aberturas = s.aberturas + excluded.aberturas,
    -- minuto só conta 1 vez por minuto (duas abas abertas não contam em dobro)
    minutos = s.minutos + case when v_tipo = 'ping' and (s.ultimo_ping is null or s.ultimo_ping < now() - interval '45 seconds') then 1 else 0 end,
    ultimo_ping = case when v_tipo = 'ping' and (s.ultimo_ping is null or s.ultimo_ping < now() - interval '45 seconds') then now() else s.ultimo_ping end,
    telas = case when v_tipo = 'ping' then s.telas
                 else s.telas || jsonb_build_object(v_tela, coalesce((s.telas ->> v_tela)::int, 0) + 1) end,
    horas = case when v_tipo = 'tela' or (v_tipo = 'ping' and s.ultimo_ping >= now() - interval '45 seconds') then s.horas
                 else s.horas || jsonb_build_object(v_hora, coalesce((s.horas ->> v_hora)::int, 0) + 1) end,
    aparelho = coalesce(nullif(excluded.aparelho, ''), s.aparelho),
    app = s.app or excluded.app,
    tela_atual = v_tela,
    ultimo = now();
  -- guarda pouco mais de 1 ano
  if v_tipo = 'abriu' then
    delete from site_uso where user_id = auth.uid() and dia < v_agora::date - 400;
  end if;
end;
$$;

-- tudo do painel de uma vez. p_dias: 1 (hoje), 7 ou 30. Os dias voltam em dobro pra comparar com o período anterior.
create or replace function public.dono_painel(p_dias integer default 7)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_dias integer := least(greatest(coalesce(p_dias, 7), 1), 90);
  v_ini date := v_hoje - (v_dias - 1);
  v_de date := v_hoje - (2 * v_dias - 1);
  v_arquivos jsonb := '{}'::jsonb;
begin
  if not is_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  begin
    select coalesce(jsonb_object_agg(bucket_id, total), '{}'::jsonb) into v_arquivos
    from (select bucket_id, sum(coalesce((metadata ->> 'size')::bigint, 0)) as total from storage.objects group by bucket_id) x;
  exception when others then v_arquivos := '{}'::jsonb;
  end;
  return jsonb_build_object(
    'hoje', v_hoje,
    'desde', (select min(dia) from site_uso),
    'pessoas', (select count(distinct user_id) from site_uso where dia >= v_ini),
    'pessoas_antes', (select count(distinct user_id) from site_uso where dia >= v_de and dia < v_ini),
    'agora', coalesce((select jsonb_agg(a order by a.ultimo desc) from (
        select distinct on (s.user_id) s.user_id, c.player_id, chat_nome(s.user_id) as nome, s.tela_atual as tela, s.aparelho, s.ultimo
        from site_uso s left join player_contas c on c.user_id = s.user_id
        where s.ultimo > now() - interval '3 minutes'
        order by s.user_id, s.ultimo desc) a), '[]'::jsonb),
    'dias', (select jsonb_agg(jsonb_build_object(
        'dia', d.dia,
        'pessoas', (select count(*) from site_uso s where s.dia = d.dia),
        'visitas', (select coalesce(sum(s.aberturas), 0) from site_uso s where s.dia = d.dia),
        'minutos', (select coalesce(sum(s.minutos), 0) from site_uso s where s.dia = d.dia),
        'massas', (select count(*) from scores x where (x.created_at at time zone 'America/Sao_Paulo')::date = d.dia),
        'msgs', (select count(*) from chat_mensagens m where m.user_id is not null and m.tipo <> 'massa'
                   and (m.created_at at time zone 'America/Sao_Paulo')::date = d.dia),
        'contas', (select count(*) from auth.users u where (u.created_at at time zone 'America/Sao_Paulo')::date = d.dia)
      ) order by d.dia)
      from (select generate_series(v_de, v_hoje, interval '1 day')::date as dia) d),
    'telas', coalesce((select jsonb_object_agg(k, n) from (
        select t.key as k, sum(t.value::int) as n from site_uso s, jsonb_each_text(s.telas) t
        where s.dia >= v_ini group by t.key) x), '{}'::jsonb),
    'horas', coalesce((select jsonb_object_agg(k, n) from (
        select t.key as k, sum(t.value::int) as n from site_uso s, jsonb_each_text(s.horas) t
        where s.dia >= v_ini group by t.key) x), '{}'::jsonb),
    'aparelhos', coalesce((select jsonb_object_agg(a, n) from (
        select coalesce(nullif(aparelho, ''), 'outro') as a, count(distinct user_id) as n
        from site_uso where dia >= v_ini group by 1) x), '{}'::jsonb),
    'app', (select count(distinct user_id) from site_uso where dia >= v_ini and app),
    'membros', coalesce((select jsonb_agg(m) from (
        select c.user_id, c.player_id, chat_nome(c.user_id) as nome,
               case when exists (select 1 from admins a where a.user_id = c.user_id) then 'dono'
                    when exists (select 1 from chat_adms d where d.user_id = c.user_id) then 'adm' else 'membro' end as papel,
               u.created_at as conta_desde,
               greatest((select max(s.ultimo) from site_uso s where s.user_id = c.user_id), u.last_sign_in_at) as ultimo,
               (select count(*) from site_uso s where s.user_id = c.user_id and s.dia >= v_ini) as dias,
               (select coalesce(sum(s.minutos), 0) from site_uso s where s.user_id = c.user_id and s.dia >= v_ini) as minutos,
               (select coalesce(sum(s.aberturas), 0) from site_uso s where s.user_id = c.user_id and s.dia >= v_ini) as visitas
        from (select user_id, player_id from player_contas
              union
              select a.user_id, null::uuid from admins a where not exists (select 1 from player_contas p where p.user_id = a.user_id)) c
        join auth.users u on u.id = c.user_id) m), '[]'::jsonb),
    'pedidos', (select count(*) from player_pedidos),
    'denuncias', (select count(distinct msg_id) from chat_denuncias),
    'punidos', (select count(*) from chat_punicoes where ate is null or ate > now()),
    'espaco', jsonb_build_object('banco', pg_database_size(current_database()), 'arquivos', v_arquivos),
    'historico', coalesce((select jsonb_agg(h order by h.created_at desc) from (
        select l.acao, l.detalhe, l.created_at, coalesce(nullif(btrim(a.nome), ''), chat_nome(l.user_id), l.email) as quem
        from admin_log l left join admins a on a.user_id = l.user_id
        order by l.created_at desc limit 40) h), '[]'::jsonb));
end;
$$;

revoke all on function public.site_marcar(text, text, text, boolean) from public, anon;
revoke all on function public.dono_painel(integer) from public, anon;
grant execute on function public.site_marcar(text, text, text, boolean) to authenticated;
grant execute on function public.dono_painel(integer) to authenticated;

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
