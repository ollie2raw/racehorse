-- Close the public tables a 2026-09-01 Supabase advisor sweep flagged with
-- RLS disabled. When RLS is off, the default GRANT ALL TO anon, authenticated
-- (applied at table creation) is the only gate — i.e. any anonymous caller
-- could read/write/delete every row.
--
-- Exactly four public tables had relrowsecurity = false:
--   bot_match_pending   -- server-only pending-Fritz-match state
--   ghost_games         -- ghost-opponent match records
--   ghost_profiles      -- ghost rating / style profile
--   ranked_games_backup_bugfix  -- undocumented one-off dashboard backup
--
-- Lockdown SQL for the first three already existed but never reached prod:
--   bot_match_pending -> 2026-08-11_authoritative_ranking_and_bot_pending.sql
--   ghost_games       -> supabase/ghost.sql (standalone file, not in migrations/)
--   ghost_profiles    -> supabase/ghost.sql
-- Root cause of the drift: no CI migration runner + no schema-posture check.
--
-- ranked_games_backup_bugfix has zero code / migration / git-history
-- references — a rating-decay bug investigation artifact from April 2026
-- (8 rows, one dev account). Backed up outside the repo, then dropped.
--
-- Self-asserting: raises and rolls back the whole transaction if any of the
-- three surviving tables still has RLS off or a client-writable grant, or if
-- the backup table still exists — so this file cannot silently no-op the way
-- the first tournament-registration lockdown attempt did.

begin;

-- ── 1. bot_match_pending — server-only; no client access of any kind ─────────
--     Only touched by the app server via the service-role key
--     (fritzMatchLifecycle.ts, botMatches.ts, ghost.ts). No client references.
alter table public.bot_match_pending enable row level security;

drop policy if exists "bot_match_pending_no_client_access" on public.bot_match_pending;
create policy "bot_match_pending_no_client_access"
  on public.bot_match_pending
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all privileges on table public.bot_match_pending from public, anon, authenticated;
grant all privileges on table public.bot_match_pending to service_role;

-- ── 2. ghost_games — client reads its own rows; server (service_role) writes ──
--     Client access is SELECT-only, own-row (statsApi.ts). Server inserts via
--     the service-role key (ghost/service.ts) and bypasses RLS. The
--     insert/update policies that supabase/ghost.sql also defines are
--     deliberately omitted: nothing client-side writes these tables, and
--     leaving them out removes a self-tampering surface (fake ghost_games
--     rows / self-bumped ghost_rating).
alter table public.ghost_games enable row level security;

drop policy if exists "ghost_games_select_own" on public.ghost_games;
create policy "ghost_games_select_own"
  on public.ghost_games
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke all privileges on table public.ghost_games from public, anon, authenticated;
grant select on table public.ghost_games to authenticated;
grant all privileges on table public.ghost_games to service_role;

-- ── 3. ghost_profiles — same shape ─────────────────────────────────────────
alter table public.ghost_profiles enable row level security;

drop policy if exists "ghost_profiles_select_own" on public.ghost_profiles;
create policy "ghost_profiles_select_own"
  on public.ghost_profiles
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke all privileges on table public.ghost_profiles from public, anon, authenticated;
grant select on table public.ghost_profiles to authenticated;
grant all privileges on table public.ghost_profiles to service_role;

-- ── 4. ranked_games_backup_bugfix — dead table, drop it ────────────────────
--     Backed up to ~/racehorse-security-backups/ (JSON + CSV) before this ran.
drop table if exists public.ranked_games_backup_bugfix;

-- ── 5. Assert the end state ───────────────────────────────────────────────
do $$
declare
  bad_rls    int;
  bad_grant  int;
  backup_present int;
begin
  select count(*) into bad_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('bot_match_pending', 'ghost_games', 'ghost_profiles')
     and c.relrowsecurity is false;

  select count(*) into bad_grant
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('bot_match_pending', 'ghost_games', 'ghost_profiles')
     and grantee in ('anon', 'authenticated', 'public')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

  select count(*) into backup_present
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'ranked_games_backup_bugfix';

  if bad_rls > 0 then
    raise exception 'lockdown failed: % table(s) still have RLS disabled', bad_rls;
  end if;
  if bad_grant > 0 then
    raise exception 'lockdown failed: % client-writable grant(s) survive', bad_grant;
  end if;
  if backup_present > 0 then
    raise exception 'lockdown failed: ranked_games_backup_bugfix still exists';
  end if;

  raise notice 'lockdown verified: bot_match_pending / ghost_games / ghost_profiles closed; backup table dropped';
end $$;

commit;
