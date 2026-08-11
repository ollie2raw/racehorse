-- Greenfield baseline for the Glicko ranking schema.
--
-- These objects were originally created out-of-band and were therefore absent
-- from the checked-in migration ledger. This migration records the exact
-- production schema required before the 2026-06-17 ranked-game idempotency and
-- 2026-06-30 atomic Glicko RPC migrations can run on a new database.
--
-- Source: read-only pg_catalog/information_schema introspection of production
-- on 2026-08-11. The source columns added by the 2026-06-17 migration and the
-- RPC created by the 2026-06-30 migration are intentionally not duplicated here.

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists glicko_rating double precision not null default 1500,
  add column if not exists glicko_rd double precision not null default 350,
  add column if not exists glicko_vol double precision not null default 0.06,
  add column if not exists glicko_last_period timestamptz null,
  add column if not exists provisional boolean not null default true,
  add column if not exists peak_rating double precision not null default 1500,
  add column if not exists ranked_games_played integer not null default 0;

create table if not exists public.ranked_games (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users(id) on delete cascade,
  opponent_id uuid not null,
  player_score integer not null,
  opponent_score integer not null,
  game_type text not null constraint ranked_games_game_type_check check (
    game_type = any (array[
      'multiplayer'::text,
      'fritz'::text,
      'fritz_rookie'::text,
      'fritz_standard'::text,
      'fritz_elite'::text
    ])
  ),
  played_at timestamptz not null default now(),
  rating_before double precision not null,
  rd_before double precision not null,
  rating_after double precision null,
  rd_after double precision null,
  delta double precision null
);

create index if not exists ranked_games_game_type_idx
  on public.ranked_games using btree (game_type);
create index if not exists ranked_games_played_at_idx
  on public.ranked_games using btree (played_at);
create index if not exists ranked_games_player_id_idx
  on public.ranked_games using btree (player_id);

create table if not exists public.rating_periods (
  id uuid primary key default gen_random_uuid(),
  player_id uuid null references auth.users(id) on delete cascade,
  period_start timestamptz null,
  period_end timestamptz null,
  games_in_period integer null default 0,
  rating_before double precision not null,
  rating_after double precision not null,
  rd_before double precision not null,
  rd_after double precision not null,
  processed_at timestamptz null,
  user_id uuid null,
  vol_before double precision null,
  vol_after double precision null
);

create index if not exists rating_periods_player_id_idx
  on public.rating_periods using btree (player_id);

alter table public.ranked_games enable row level security;
alter table public.rating_periods enable row level security;

drop policy if exists "Service role can insert ranked games" on public.ranked_games;
create policy "Service role can insert ranked games"
  on public.ranked_games
  for insert
  to public
  with check (true);

drop policy if exists "Users can read own ranked games" on public.ranked_games;
create policy "Users can read own ranked games"
  on public.ranked_games
  for select
  to public
  using (auth.uid() = player_id);

drop policy if exists "Service role can insert rating periods" on public.rating_periods;
create policy "Service role can insert rating periods"
  on public.rating_periods
  for insert
  to public
  with check (true);

drop policy if exists "Users can read own rating periods" on public.rating_periods;
create policy "Users can read own rating periods"
  on public.rating_periods
  for select
  to public
  using (auth.uid() = player_id);

grant all on table public.ranked_games to anon, authenticated, service_role;
grant all on table public.rating_periods to anon, authenticated, service_role;
