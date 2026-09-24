-- Durable review-completion jobs: snapshots + per-decision checkpoints.
-- Server worker owns progress; client polls. Completed artifacts remain in
-- game_reviews; this table holds in-flight state (snapshots may be cleared
-- after complete).
--
-- RELEASE / ROLLING DEPLOY NOTES (do not apply outside normal deploy path):
--   1. Additive only — no ALTER of historical game_reviews / replay rows.
--   2. Empty table is valid: new workers create jobs on demand.
--   3. Old app versions ignore this table (no client writes; RLS deny-all).
--   4. Apply base table before claim/checkpoint/list RPCs
--      (2026-09-23_review_completion_jobs_claim_rpc.sql).
--   5. Rollback: DROP TABLE review_completion_jobs CASCADE after dropping
--      RPCs; completed reviews in game_reviews are unaffected.
--   6. Multi-instance safety requires the claim RPC migration (CAS leases).

create table if not exists public.review_completion_jobs (
  id text primary key,
  user_id uuid null references auth.users (id) on delete set null,
  game_digest text not null,
  source_match_id text not null,
  status text not null check (status in ('pending', 'running', 'complete', 'failed_fatal')),
  job_payload jsonb not null,
  claim_token text null,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_review_completion_jobs_user_digest
  on public.review_completion_jobs (user_id, game_digest);

create index if not exists idx_review_completion_jobs_claim
  on public.review_completion_jobs (status, next_attempt_at)
  where status in ('pending', 'running');

alter table public.review_completion_jobs enable row level security;

drop policy if exists "review_completion_jobs_select_own" on public.review_completion_jobs;
create policy "review_completion_jobs_select_own"
  on public.review_completion_jobs
  for select
  using (auth.uid() = user_id);

drop policy if exists "review_completion_jobs_no_client_write" on public.review_completion_jobs;
create policy "review_completion_jobs_no_client_write"
  on public.review_completion_jobs
  for all
  using (false)
  with check (false);

comment on table public.review_completion_jobs is
  'Durable review-completion jobs: snapshots + per-decision checkpoints. Server worker owns progress; client polls.';
