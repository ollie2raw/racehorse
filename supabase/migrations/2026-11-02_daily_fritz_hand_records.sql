-- Daily Fritz hand records (docs/daily-fritz-review-design.md, DF-2; roadmap 3.14).
--
-- Today the server verifies every Daily Fritz hand but keeps only a digest and a summary of it (the "authority ledger" inside the attempt's `result`), so a
-- finished game can never be rebuilt, and so can never be reviewed. This table keeps the verified transcript itself: the ordered actions of one hand, exactly as
-- the server's verifier parsed and accepted them, so the post-game review (DF-3 onward) can replay the hand.
--
-- Written only by the server (service role), best-effort, right after a hand verifies, and only while DF_HAND_RECORDS_ENABLED is "true" (which must not be set
-- before this is applied). It never takes part in scoring, ranking or the leaderboard: nothing reads it back except the review.
--
-- A hand can verify more than once (a retried request), and only the version written to the attempt's ledger is authoritative. So each row is keyed by the
-- transcript's own digest too; the ledger records that digest per hand, and the review picks the row whose digest matches it. A retry with identical evidence is
-- a no-op (ignore-duplicates), a retry with different evidence is a second row that the ledger never points at.
--
-- Clients get no access at all: RLS is on and every client operation is denied. Rows go when the account goes (cascade). Additive and idempotent; no backfill
-- (hands verified before this are gone: only their digests were kept).

create table if not exists public.daily_fritz_hand_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  attempt_id uuid not null,
  challenge_id text not null check (char_length(challenge_id) between 1 and 80),
  game_number smallint not null check (game_number between 1 and 3),
  hand_index integer not null check (hand_index between 0 and 255),

  transcript_digest text not null check (transcript_digest ~ '^[0-9a-f]{64}$'),
  verification_version smallint not null,
  fritz_policy_version smallint not null,
  action_count integer not null check (action_count between 1 and 512),

  transcript jsonb not null check (octet_length(transcript::text) <= 70000),

  created_at timestamptz not null default now()
);

create unique index if not exists idx_daily_fritz_hand_records_idempotency
  on public.daily_fritz_hand_records (user_id, attempt_id, game_number, hand_index, transcript_digest);

create index if not exists idx_daily_fritz_hand_records_attempt
  on public.daily_fritz_hand_records (user_id, attempt_id, game_number, hand_index);

alter table public.daily_fritz_hand_records enable row level security;

drop policy if exists "daily_fritz_hand_records_no_client_access" on public.daily_fritz_hand_records;
create policy "daily_fritz_hand_records_no_client_access"
  on public.daily_fritz_hand_records
  for all
  to authenticated
  using (false)
  with check (false);

-- Rollback (nothing else depends on it):
-- drop table if exists public.daily_fritz_hand_records;
