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


-- 4) Atualização ao vivo (o ranking muda sozinho na tela de todo mundo)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'scores'
  ) then
    alter publication supabase_realtime add table public.scores;
  end if;
end;
$$;

-- Pronto! Se apareceu "Success. No rows returned", deu certo.
