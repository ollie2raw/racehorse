-- Live multiplayer room snapshots for restart / rejoin recovery.
-- Authoritative server-only writes (service role). Terminal matches archive to
-- room_match_logs, then delete the live row.
--
-- game_state stores the FULL server GameState (unmasked):
--   - boneyard[] tile order (draw order preserved)
--   - deadTiles[] protected tail
--   - all players[].hand[] (both seats, not maskStateForRecipient output)

create table if not exists public.room_live_sessions (
  room_code text primary key,
  match_id uuid not null unique,

  status text not null check (status in (
    'lobby',
    'playing',
    'hand_over',
    'game_over',
    'abandoned'
  )),

  source_type text not null check (source_type in (
    'private',
    'matchmaking',
    'tournament'
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
