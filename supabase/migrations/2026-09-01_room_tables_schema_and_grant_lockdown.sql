-- Codify the multiplayer room tables into the migration chain, and revoke the
-- client write grants (MP-G1 + MP-G2, HARDENING_PLAN.md §2.4.2).
--
-- room_live_sessions and room_match_logs exist in prod (RLS + the 3 policies
-- were confirmed against prod on 2026-09-01, Decisions D-8) but their DDL only
-- ever lived in supabase/room_live_sessions.sql / supabase/room_match_logs.sql,
-- never in supabase/migrations/ — the 4th instance of the "reviewed SQL never
-- reaches the migration chain / prod silently diverges" root cause (T-1, the
-- ghost/bot RLS tables, commit_glicko, the content-lifecycle RPCs).
--
-- This file SUPERSEDES supabase/room_live_sessions.sql and
-- supabase/room_match_logs.sql as the source of truth for these two tables.
--
-- Idempotent by construction:
--   * the create table / add column / create index / policy statements match
--     current prod exactly and are no-ops there;
--   * MP-G2 — `revoke insert, update, delete, truncate ... from anon,
--     authenticated` on both tables IS a real change, not yet applied to prod.
--     SELECT is intentionally left for `authenticated` on room_match_logs
--     (room_match_logs_select_own needs it — a participant reading their own
--     *terminal* row is the deliberate, ratified behaviour, HARDENING_PLAN
--     MP-G17). room_live_sessions additionally has SELECT revoked from every
--     client role (no policy grants any client a read — small defence-in-depth
--     extension beyond MP-G2's "write grants" wording).
--
-- Self-asserting: raises unless RLS is on, the deny-all policies exist, no
-- client role holds a write privilege, and service_role still does.

begin;

-- ---------------------------------------------------------------------------
-- room_live_sessions
-- ---------------------------------------------------------------------------

create table if not exists public.room_live_sessions (
  room_code text primary key,
  match_id uuid not null unique,
  status text not null check (status in (
    'lobby', 'playing', 'hand_over', 'game_over', 'abandoned'
  )),
  source_type text not null check (source_type in (
    'private', 'matchmaking', 'tournament'
  )),
  game_state jsonb null,
  game_state_sequence integer not null default 0,
  room_shell jsonb not null default '{}'::jsonb,
  engine_seat_ids text[] not null default '{}',
  roster jsonb not null default '[]'::jsonb,
  event_log_version integer not null default 1,
  last_event_sequence integer not null default 0,
  events jsonb not null default '[]'::jsonb,
  participant_user_ids uuid[] not null default '{}',
  matchmaking_match_id uuid null,
  scheduled_tournament_id uuid null,
  scheduled_tournament_match_id uuid null,
  started_at timestamptz null,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.room_live_sessions
  add column if not exists game_state jsonb null,
  add column if not exists game_state_sequence integer not null default 0,
  add column if not exists room_shell jsonb not null default '{}'::jsonb,
  add column if not exists engine_seat_ids text[] not null default '{}',
  add column if not exists roster jsonb not null default '[]'::jsonb,
  add column if not exists event_log_version integer not null default 1,
  add column if not exists last_event_sequence integer not null default 0,
  add column if not exists events jsonb not null default '[]'::jsonb,
  add column if not exists participant_user_ids uuid[] not null default '{}',
  add column if not exists matchmaking_match_id uuid null,
  add column if not exists scheduled_tournament_id uuid null,
  add column if not exists scheduled_tournament_match_id uuid null,
  add column if not exists started_at timestamptz null,
  add column if not exists updated_at timestamptz not null default timezone('utc', now()),
  add column if not exists created_at timestamptz not null default timezone('utc', now());

create index if not exists idx_room_live_sessions_status_updated
  on public.room_live_sessions (status, updated_at desc)
  where status in ('lobby', 'playing', 'hand_over');

create index if not exists idx_room_live_sessions_tournament_match
  on public.room_live_sessions (scheduled_tournament_match_id)
  where scheduled_tournament_match_id is not null;

create index if not exists idx_room_live_sessions_matchmaking
  on public.room_live_sessions (matchmaking_match_id)
  where matchmaking_match_id is not null;

create index if not exists idx_room_live_sessions_participants
  on public.room_live_sessions using gin (participant_user_ids);

alter table public.room_live_sessions enable row level security;

drop policy if exists "room_live_sessions_no_client_write" on public.room_live_sessions;
create policy "room_live_sessions_no_client_write"
  on public.room_live_sessions
  for all
  to authenticated
  using (false)
  with check (false);

-- MP-G2 + defence-in-depth: no client role reads or writes this table (RLS
-- already denies; the grants are the belt-and-braces).
revoke insert, update, delete, truncate, select
  on public.room_live_sessions from anon, authenticated;
grant all on public.room_live_sessions to service_role;

-- ---------------------------------------------------------------------------
-- room_match_logs
-- ---------------------------------------------------------------------------

create table if not exists public.room_match_logs (
  match_id uuid primary key,
  room_code text not null,
  status text not null check (status in ('completed', 'abandoned')),
  event_log_version integer not null,
  last_event_sequence integer not null,
  event_count integer not null,
  started_at timestamptz null,
  archived_at timestamptz not null default timezone('utc', now()),
  participant_user_ids uuid[] not null default '{}',
  participants jsonb not null default '[]'::jsonb,
  summary jsonb null,
  state_snapshot jsonb null,
  events jsonb not null default '[]'::jsonb
);

alter table public.room_match_logs
  add column if not exists started_at timestamptz null,
  add column if not exists archived_at timestamptz not null default timezone('utc', now()),
  add column if not exists participant_user_ids uuid[] not null default '{}',
  add column if not exists participants jsonb not null default '[]'::jsonb,
  add column if not exists summary jsonb null,
  add column if not exists state_snapshot jsonb null,
  add column if not exists events jsonb not null default '[]'::jsonb;

create index if not exists idx_room_match_logs_room_code_archived
  on public.room_match_logs (room_code, archived_at desc);

create index if not exists idx_room_match_logs_participant_user_ids
  on public.room_match_logs using gin (participant_user_ids);

alter table public.room_match_logs enable row level security;

drop policy if exists "room_match_logs_select_own" on public.room_match_logs;
create policy "room_match_logs_select_own"
  on public.room_match_logs
  for select
  using (auth.uid() = any(participant_user_ids));

drop policy if exists "room_match_logs_no_client_write" on public.room_match_logs;
create policy "room_match_logs_no_client_write"
  on public.room_match_logs
  for all
  using (false)
  with check (false);

-- MP-G2: revoke client writes; keep SELECT for `authenticated` so
-- room_match_logs_select_own keeps working (MP-G17 — deliberate).
revoke insert, update, delete, truncate on public.room_match_logs from anon, authenticated;
revoke select on public.room_match_logs from anon;
grant select on public.room_match_logs to authenticated;
grant all on public.room_match_logs to service_role;

-- ---------------------------------------------------------------------------
-- self-assert
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  tables text[] := array['room_live_sessions', 'room_match_logs'];
  priv text;
  writes text[] := array['INSERT', 'UPDATE', 'DELETE'];
  client_role text;
  clients text[] := array['anon', 'authenticated'];
begin
  foreach t in array tables loop
    if not (
      select c.relrowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = t
    ) then
      raise exception 'lockdown failed: RLS not enabled on public.%', t;
    end if;

    foreach client_role in array clients loop
      foreach priv in array writes loop
        if has_table_privilege(client_role, format('public.%I', t), priv) then
          raise exception 'lockdown failed: % still holds % on public.%', client_role, priv, t;
        end if;
      end loop;
    end loop;

    if not has_table_privilege('service_role', format('public.%I', t), 'INSERT') then
      raise exception 'lockdown failed: service_role lost INSERT on public.%', t;
    end if;
  end loop;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'room_live_sessions'
       and policyname = 'room_live_sessions_no_client_write'
  ) then
    raise exception 'lockdown failed: room_live_sessions_no_client_write missing';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'room_match_logs'
       and policyname = 'room_match_logs_no_client_write'
  ) or not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'room_match_logs'
       and policyname = 'room_match_logs_select_own'
  ) then
    raise exception 'lockdown failed: room_match_logs policies missing';
  end if;

  raise notice 'room_live_sessions / room_match_logs: schema codified, client write grants revoked, RLS + policies asserted';
end $$;

commit;
