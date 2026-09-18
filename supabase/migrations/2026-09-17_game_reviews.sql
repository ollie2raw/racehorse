-- E0a (docs/scoping/game-review-oracle-upgrade-2026-09-13.md, Phase E):
-- server-side versioned review persistence. New table only -- no writer
-- exists yet beyond E0c's idempotent insert route; E1 (PVF post-game
-- persist+load path) is a separate, later step.
--
-- Payload shape follows E0b's settled storage-shape decision (see the parent
-- doc's E0 entry, "E0b, settled 2026-09-17"): evaluations (ReviewEvaluationV1[])
-- + a content-addressing digest, not full ReviewPositionSnapshotV2[] --
-- GameReviewer's entire render path was traced and confirmed to read only
-- from evaluations, so persisting full snapshots would be ~3.6x the storage
-- for zero redisplay benefit.
--
-- The idempotency key deliberately includes both version columns
-- (review_engine_version, accuracy_model_version), not just game_digest: a
-- re-analysis of the same game under a newer engine or accuracy model must
-- insert a new row, never silently overwrite or dedupe against an older,
-- differently-versioned one -- this is exactly what "versioned" persistence
-- exists to guarantee (see rejection of the digest-only-recompute scheme in
-- the parent doc's E0b entry).
--
-- RLS follows daily_fritz_attempts's convention exactly (supabase/daily_fritz.sql):
-- a user reads only their own rows; all writes go through the server's
-- service-role key (insertGameReviewIdempotent), never a direct client POST.

create table if not exists public.game_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  game_digest text not null,
  review_engine_version text not null,
  accuracy_model_version text not null,

  evaluations jsonb not null,
  accuracy_model_result jsonb not null,

  mode text not null check (mode in ('pvf', 'mp')),
  source_match_id text null,

  created_at timestamptz not null default now()
);

create unique index if not exists idx_game_reviews_idempotency
  on public.game_reviews (user_id, game_digest, review_engine_version, accuracy_model_version);

create index if not exists idx_game_reviews_user_created
  on public.game_reviews (user_id, created_at);

alter table public.game_reviews enable row level security;

drop policy if exists "game_reviews_select_own" on public.game_reviews;
create policy "game_reviews_select_own"
  on public.game_reviews
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "game_reviews_no_client_write" on public.game_reviews;
create policy "game_reviews_no_client_write"
  on public.game_reviews
  for all
  to authenticated
  using (false)
  with check (false);
