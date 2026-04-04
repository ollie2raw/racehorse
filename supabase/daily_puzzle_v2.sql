-- Curated Daily Puzzles (v2)
-- Safe migration from v1 schema to support multiple puzzle types per date.
-- Replace the admin email literal below with your actual admin email
-- and keep it in sync with VITE_ADMIN_EMAIL in the client.

create extension if not exists pgcrypto;

alter table if exists public.daily_puzzles
  add column if not exists puzzle_type text not null default 'one_turn_high_score';

alter table if exists public.daily_puzzles
  add column if not exists deal_size int not null default 14;

do $$
declare
  constraint_name text;
begin
  select tc.constraint_name
    into constraint_name
  from information_schema.table_constraints tc
  join information_schema.constraint_column_usage ccu
    on tc.constraint_name = ccu.constraint_name
   and tc.table_schema = ccu.table_schema
  where tc.table_schema = 'public'
    and tc.table_name = 'daily_puzzles'
    and tc.constraint_type = 'UNIQUE'
    and ccu.column_name = 'puzzle_date'
    and tc.constraint_name not in (
      select tc2.constraint_name
      from information_schema.table_constraints tc2
      join information_schema.key_column_usage kcu2
        on tc2.constraint_name = kcu2.constraint_name
       and tc2.table_schema = kcu2.table_schema
      where tc2.table_schema = 'public'
        and tc2.table_name = 'daily_puzzles'
        and tc2.constraint_type = 'UNIQUE'
      group by tc2.constraint_name
      having count(*) > 1
    )
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.daily_puzzles drop constraint %I', constraint_name);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'daily_puzzles'
      and constraint_name = 'daily_puzzles_puzzle_date_puzzle_type_key'
  ) then
    alter table public.daily_puzzles
      add constraint daily_puzzles_puzzle_date_puzzle_type_key
      unique (puzzle_date, puzzle_type);
  end if;
end $$;

alter table public.daily_puzzles enable row level security;

drop policy if exists "daily_puzzles_select_all" on public.daily_puzzles;
create policy "daily_puzzles_select_all"
  on public.daily_puzzles
  for select
  to anon, authenticated
  using (true);

drop policy if exists "daily_puzzles_insert_admin" on public.daily_puzzles;
create policy "daily_puzzles_insert_admin"
  on public.daily_puzzles
  for insert
  to authenticated
  with check ((auth.jwt() ->> 'email') = 'admin@example.com');

drop policy if exists "daily_puzzles_update_admin" on public.daily_puzzles;
create policy "daily_puzzles_update_admin"
  on public.daily_puzzles
  for update
  to authenticated
  using ((auth.jwt() ->> 'email') = 'admin@example.com')
  with check ((auth.jwt() ->> 'email') = 'admin@example.com');

drop policy if exists "daily_puzzles_delete_admin" on public.daily_puzzles;
create policy "daily_puzzles_delete_admin"
  on public.daily_puzzles
  for delete
  to authenticated
  using ((auth.jwt() ->> 'email') = 'admin@example.com');
