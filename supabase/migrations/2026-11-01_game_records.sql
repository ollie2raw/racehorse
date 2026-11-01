-- Saved game record (docs/review-game-record-architecture.md, Phase 2).
--
-- The chess.com model: the game itself is saved on the server when it ends, and analysis is derived from that saved
-- game later. A record is the minimum needed to replay a game deterministically: the settings, the deal seed (when
-- the server issued one), the ordered actions and the final result. Analysis, coaching prose and board snapshots are
-- NOT stored here; they are derived from the record.
--
-- Writes go through the server's service-role key only (POST /api/game-records). A user reads only their own rows.
-- Idempotent by (user_id, source_match_id), so a retried or double-delivered save is a no-op.
--
-- `verification` says how much the server could check:
--   replay_verified   the server owns the deal (ranked seed) and replayed the actions to exactly this result
--   replay_mismatch   the server owns the deal but the actions do not replay to this result (kept, flagged)
--   unverified        no server-owned deal exists for this game (unranked), so the record is client-reported
-- Only replay_verified records may ever feed anything competitive. Additive and idempotent; no backfill.

create table if not exists public.game_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  source_match_id text not null,
  local_match_id text null,
  mode text not null check (mode in ('pvf')),

  fritz_tier text null,
  deal_size smallint null check (deal_size in (7, 14)),
  winning_score smallint null check (winning_score between 1 and 200),
  match_starter text null check (match_starter in ('you', 'bot')),
  deal_seed text null,

  result jsonb not null,
  moves jsonb not null,
  move_count integer not null check (move_count between 1 and 4000),

  record_version smallint not null default 1,
  verification text not null check (verification in ('replay_verified', 'replay_mismatch', 'unverified')),

  played_at timestamptz null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_game_records_idempotency
  on public.game_records (user_id, source_match_id);

create index if not exists idx_game_records_user_created
  on public.game_records (user_id, created_at desc);

alter table public.game_records enable row level security;

drop policy if exists "game_records_select_own" on public.game_records;
create policy "game_records_select_own"
  on public.game_records
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "game_records_no_client_write" on public.game_records;
create policy "game_records_no_client_write"
  on public.game_records
  for all
  to authenticated
  using (false)
  with check (false);
