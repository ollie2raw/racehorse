-- Apply two multiplayer tables that were written but never reached prod
-- (MP-G6, HARDENING_PLAN.md §2.3 Tier B). Confirmed absent from prod 2026-09-01:
-- service_role GET -> PGRST205 for both; neither in the PostgREST OpenAPI spec
-- (room_live_sessions / room_match_logs ARE); assert_security_posture() (runs
-- server-side, sees pg_catalog) shows no trace. 5th and 6th instances of the
-- "reviewed migration never runs / no CI migration runner" drift pattern.
--
-- Supersedes:
--   supabase/migrations/2026-08-01_room_command_receipts.sql   (commit 5947dd36)
--   supabase/migrations/2026-08-20_mp_authority_events.sql     (commit 420be2b7)
-- Corrections vs those originals:
--   * room_command_receipts — add the explicit `revoke ... from anon,
--     authenticated` + `grant ... to service_role` the original relied on
--     Supabase defaults for.
--   * mp_authority_events — DROP the `event` CHECK constraint. The original
--     hard-coded 14 event names; the server already emits 4 more
--     (private_disconnect_auto_act_{deferred,paused},
--      private_game_over_persist_{failed,succeeded}) and the write is
--     best-effort/swallowed, so a stale CHECK would silently drop telemetry
--     rows. A funnel table does not need a value-locked event column.
--
-- Self-asserting: raises unless both tables exist with RLS on, deny-all client
-- policies, no client write privilege, and service_role can insert.

begin;

-- ---------------------------------------------------------------------------
-- room_command_receipts  (game:action idempotency receipts; §2.1.10)
-- ---------------------------------------------------------------------------

create table if not exists public.room_command_receipts (
  room_code text not null,
  player_seat_id text not null,
  request_id text not null,
  match_id uuid null,
  ack jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (room_code, player_seat_id, request_id)
);

create index if not exists idx_room_command_receipts_expires
  on public.room_command_receipts (expires_at);

create index if not exists idx_room_command_receipts_room_code
  on public.room_command_receipts (room_code);

alter table public.room_command_receipts enable row level security;

drop policy if exists "room_command_receipts_no_client_write" on public.room_command_receipts;
create policy "room_command_receipts_no_client_write"
  on public.room_command_receipts
  for all
  to authenticated
  using (false)
  with check (false);

revoke all on public.room_command_receipts from anon, authenticated;
grant all on public.room_command_receipts to service_role;

-- ---------------------------------------------------------------------------
-- mp_authority_events  (durable mp.authority funnel; best-effort service-role
-- inserts) + the daily funnel view
-- ---------------------------------------------------------------------------

create table if not exists public.mp_authority_events (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  ts timestamptz not null default now(),
  room_code text null,
  seat_id text null,
  request_id text null,
  failure_code text null,
  payload jsonb not null default '{}'::jsonb,
  source_type text null check (
    source_type is null or source_type in ('private', 'quick', 'tournament')
  )
);

create index if not exists idx_mp_authority_events_event_ts
  on public.mp_authority_events (event, ts);

create index if not exists idx_mp_authority_events_room_ts
  on public.mp_authority_events (room_code, ts);

alter table public.mp_authority_events enable row level security;

drop policy if exists "mp_authority_events_no_client_access" on public.mp_authority_events;
create policy "mp_authority_events_no_client_access"
  on public.mp_authority_events
  for all
  to authenticated
  using (false)
  with check (false);

revoke all on public.mp_authority_events from anon, authenticated;
grant insert, select on public.mp_authority_events to service_role;

create or replace view public.mp_authority_funnel_metrics
  with (security_invoker = true) as
select
  (ts at time zone 'America/Los_Angeles')::date as event_date,
  event,
  count(*)::bigint as total
from public.mp_authority_events
group by 1, 2;

revoke all on public.mp_authority_funnel_metrics from anon, authenticated;
grant select on public.mp_authority_funnel_metrics to service_role;

-- ---------------------------------------------------------------------------
-- self-assert
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  tables text[] := array['room_command_receipts', 'mp_authority_events'];
  priv text;
  writes text[] := array['INSERT', 'UPDATE', 'DELETE'];
  client_role text;
  clients text[] := array['anon', 'authenticated'];
begin
  foreach t in array tables loop
    if to_regclass(format('public.%I', t)) is null then
      raise exception 'apply failed: public.% does not exist', t;
    end if;
    if not (
      select c.relrowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = t
    ) then
      raise exception 'apply failed: RLS not enabled on public.%', t;
    end if;
    foreach client_role in array clients loop
      foreach priv in array writes loop
        if has_table_privilege(client_role, format('public.%I', t), priv) then
          raise exception 'apply failed: % still holds % on public.%', client_role, priv, t;
        end if;
      end loop;
    end loop;
    if not has_table_privilege('service_role', format('public.%I', t), 'INSERT') then
      raise exception 'apply failed: service_role cannot INSERT on public.%', t;
    end if;
  end loop;

  if to_regclass('public.mp_authority_funnel_metrics') is null then
    raise exception 'apply failed: view public.mp_authority_funnel_metrics missing';
  end if;

  raise notice 'room_command_receipts + mp_authority_events (+ funnel view) created, RLS on, client writes denied, service_role can insert';
end $$;

commit;
