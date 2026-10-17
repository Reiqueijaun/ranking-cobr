-- =============================================================
--  RANKING DO CLÃ — script do banco de dados (Supabase)
--  Cole TUDO no SQL Editor do Supabase e clique em "Run".
--  Pode rodar de novo sem problema se precisar.
--
--  Depois de rodar, defina o PIN do dono com o comando do guia
--  COMO-COLOCAR-NO-AR.html (passo 3). O PIN NÃO fica neste arquivo, assim ninguém descobre.
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
grant select on public.scores to anon, authenticated;
revoke insert, update, delete on public.scores from anon, authenticated;

-- Qualquer pessoa com o link pode VER o ranking
drop policy if exists "todos leem" on public.scores;
create policy "todos leem" on public.scores
  for select to anon, authenticated using (true);

-- Ninguém de fora registra direto. Só o DONO, pela função com PIN abaixo.
drop policy if exists "todos registram" on public.scores;
revoke insert on public.scores from anon, authenticated;

-- Registrar e apagar: só o dono, pelas funções com PIN abaixo.


-- 2) PIN do dono (fica guardado escondido, o site não consegue ler)
create table if not exists public.admin_config (
  id   int primary key default 1 check (id = 1),
  pin  text not null
);
alter table public.admin_config enable row level security;
revoke all on public.admin_config from anon, authenticated;
-- (sem políticas e sem permissão = ninguém de fora lê esta tabela)

-- Valor provisório. Enquanto não for trocado, a área do dono fica TRANCADA.
-- Para definir o seu PIN, rode no SQL Editor (fora deste arquivo):
--   update public.admin_config set pin = 'seu-pin-bem-longo' where id = 1;
insert into public.admin_config (id, pin)
values (1, 'TROQUE-ESTE-PIN')
on conflict (id) do nothing;

create or replace function public.admin_check(pin_try text)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare ok boolean;
begin
  select exists(select 1 from admin_config where id = 1 and pin = pin_try and pin <> 'TROQUE-ESTE-PIN') into ok;
  if not ok then perform pg_sleep(1); end if;   -- atrasa quem tenta adivinhar
  return ok;
end;
$$;

create or replace function public.admin_delete_score(score_id uuid, pin_try text)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not exists(select 1 from admin_config where id = 1 and pin = pin_try and pin <> 'TROQUE-ESTE-PIN') then
    perform pg_sleep(1);
    return false;
  end if;
  delete from scores where id = score_id;
  return true;
end;
$$;

create or replace function public.admin_add_score(pin_try text, p_player text, p_mass integer, p_print_path text default null)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not exists(select 1 from admin_config where id = 1 and pin = pin_try and pin <> 'TROQUE-ESTE-PIN') then
    perform pg_sleep(1);
    return false;
  end if;
  insert into scores (player, mass, print_path) values (btrim(p_player), p_mass, p_print_path);
  -- quem joga entra (ou volta) pro elenco do clã automaticamente
  update players set ativo = true where lower(btrim(nick)) = lower(btrim(p_player)) and not ativo;
  insert into players (nick) values (btrim(p_player)) on conflict do nothing;
  return true;
end;
$$;

revoke all on function public.admin_add_score(text, text, integer, text) from public;
grant execute on function public.admin_add_score(text, text, integer, text) to anon, authenticated;
revoke all on function public.admin_check(text) from public;
revoke all on function public.admin_delete_score(uuid, text) from public;
grant execute on function public.admin_check(text) to anon, authenticated;
grant execute on function public.admin_delete_score(uuid, text) to anon, authenticated;


-- 3) Pasta pública para os prints (até 3 MB, só imagens).
--    Um print só aparece no site quando o dono registra a partida.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('prints', 'prints', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "todos enviam print" on storage.objects;
create policy "todos enviam print" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'prints');


-- 4) Elenco do clã: todos os jogadores cadastrados, mesmo quem ainda não pontuou
create table if not exists public.players (
  id          uuid primary key default gen_random_uuid(),
  nick        text not null check (char_length(btrim(nick)) between 1 and 24),
  cargo       text not null default 'Membro' check (char_length(btrim(cargo)) between 1 and 24),
  ativo       boolean not null default true,     -- false = saiu do clã (some do ranking, histórico fica)
  created_at  timestamptz not null default now()
);
create unique index if not exists players_nick_idx on public.players (lower(btrim(nick)));

alter table public.players enable row level security;
grant select on public.players to anon, authenticated;
revoke insert, update, delete on public.players from anon, authenticated;
drop policy if exists "todos leem jogadores" on public.players;
create policy "todos leem jogadores" on public.players
  for select to anon, authenticated using (true);

-- Quem já tem partida registrada entra no elenco (com o nick mais recente)
insert into public.players (nick, created_at)
select distinct on (lower(btrim(player))) btrim(player), min(created_at) over (partition by lower(btrim(player)))
from public.scores
order by lower(btrim(player)), created_at desc
on conflict do nothing;

-- Cadastrar vários de uma vez. Devolve quantos entraram (-1 = PIN errado).
create or replace function public.admin_add_players(pin_try text, p_nicks text[], p_cargo text default 'Membro')
returns integer
language plpgsql security definer set search_path = public
as $$
declare n integer;
begin
  if not admin_check(pin_try) then return -1; end if;
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
-- Devolve: ok | pin | nick_em_uso | nao_existe
create or replace function public.admin_update_player(pin_try text, p_id uuid, p_nick text, p_cargo text, p_ativo boolean)
returns text
language plpgsql security definer set search_path = public
as $$
declare antigo text;
begin
  if not admin_check(pin_try) then return 'pin'; end if;
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
-- Devolve: ok | pin | tem_partidas
create or replace function public.admin_delete_player(pin_try text, p_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  if not admin_check(pin_try) then return 'pin'; end if;
  if exists(select 1 from scores s join players p on lower(btrim(s.player)) = lower(btrim(p.nick)) where p.id = p_id) then
    return 'tem_partidas';
  end if;
  delete from players where id = p_id;
  return 'ok';
end;
$$;

revoke all on function public.admin_add_players(text, text[], text) from public;
revoke all on function public.admin_update_player(text, uuid, text, text, boolean) from public;
revoke all on function public.admin_delete_player(text, uuid) from public;
grant execute on function public.admin_add_players(text, text[], text) to anon, authenticated;
grant execute on function public.admin_update_player(text, uuid, text, text, boolean) to anon, authenticated;
grant execute on function public.admin_delete_player(text, uuid) to anon, authenticated;


-- 5) Atualização ao vivo (o ranking muda sozinho na tela de todo mundo)
do $$
begin
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
end;
$$;

-- Pronto! Se apareceu "Success. No rows returned", deu certo.
