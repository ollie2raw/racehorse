-- Make ranking state and pending Fritz-match state server-authoritative.
--
-- The browser only needs to read authenticated profiles and update its own
-- username. Ranked games, rating periods, Glicko fields, the atomic Glicko
-- RPC, and bot_match_pending are exclusively accessed by the application
-- server with the service-role key.

begin;

alter table public.ranked_games enable row level security;
alter table public.rating_periods enable row level security;
alter table public.bot_match_pending enable row level security;

drop policy if exists "Service role can insert ranked games" on public.ranked_games;
drop policy if exists "Users can read own ranked games" on public.ranked_games;
drop policy if exists "Service role can insert rating periods" on public.rating_periods;
drop policy if exists "Users can read own rating periods" on public.rating_periods;
drop policy if exists "ranked_games_no_client_access" on public.ranked_games;
drop policy if exists "rating_periods_no_client_access" on public.rating_periods;
drop policy if exists "bot_match_pending_no_client_access" on public.bot_match_pending;

create policy "ranked_games_no_client_access"
  on public.ranked_games
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "rating_periods_no_client_access"
  on public.rating_periods
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "bot_match_pending_no_client_access"
  on public.bot_match_pending
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all privileges on table public.ranked_games from public, anon, authenticated;
revoke all privileges on table public.rating_periods from public, anon, authenticated;
revoke all privileges on table public.bot_match_pending from public, anon, authenticated;

grant all privileges on table public.ranked_games to service_role;
grant all privileges on table public.rating_periods to service_role;
grant all privileges on table public.bot_match_pending to service_role;

-- Keep profile reads and username updates available, while
-- preventing direct writes to Glicko/ranking columns.
revoke all privileges on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (username) on table public.profiles to authenticated;
grant all privileges on table public.profiles to service_role;

-- SECURITY DEFINER functions are executable by PUBLIC unless explicitly
-- revoked. Only the server may commit authoritative ranking updates.
revoke execute on function public.commit_glicko_game_update(
  uuid,
  double precision,
  double precision,
  double precision,
  timestamp with time zone,
  boolean,
  double precision,
  integer,
  uuid,
  double precision,
  double precision,
  double precision,
  double precision
) from public, anon, authenticated;

grant execute on function public.commit_glicko_game_update(
  uuid,
  double precision,
  double precision,
  double precision,
  timestamp with time zone,
  boolean,
  double precision,
  integer,
  uuid,
  double precision,
  double precision,
  double precision,
  double precision
) to service_role;

commit;
