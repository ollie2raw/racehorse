-- Harden review_completion_jobs for multi-instance durable completion.
-- Additive on 2026-09-23_review_completion_jobs.sql.
--
-- Mixed-version / rolling deploy:
--   Forward: base table migration then this RPC migration.
--   Rollback: DROP FUNCTION the three RPCs; lease_expires_at / claim_generation /
--     completed_at columns may remain (nullable/defaulted) — older workers that
--     only PATCH job_payload/status/claim_token keep working.
--   Old workers without claim RPC cannot take atomic leases; new workers win.
--   lease_expires_at NULL ⇒ claimable by new claim RPC.
--   Terminal status complete/failed_fatal: claim/checkpoint refuse mutation.
--   Historical game_reviews.replay_artifact unchanged; completed jobs may clear
--   snapshots in job_payload while retaining decision evaluations.
--   RPCs are security definer, EXECUTE granted to service_role only.

alter table public.review_completion_jobs
  add column if not exists lease_expires_at timestamptz null;

alter table public.review_completion_jobs
  add column if not exists claim_generation bigint not null default 0;

alter table public.review_completion_jobs
  add column if not exists completed_at timestamptz null;

comment on column public.review_completion_jobs.lease_expires_at is
  'Worker lease expiry. Expired leases may be claimed by another worker.';
comment on column public.review_completion_jobs.claim_generation is
  'Monotonic claim generation for CAS checkpoint writes.';
comment on column public.review_completion_jobs.completed_at is
  'Set when status becomes complete; payload snapshots may be cleared after.';

create index if not exists idx_review_completion_jobs_lease
  on public.review_completion_jobs (status, lease_expires_at)
  where status in ('pending', 'running');

-- Atomic claim: returns the claimed row or empty set if lost race / already done.
create or replace function public.claim_review_completion_job(
  p_job_id text,
  p_claim_token text,
  p_lease_ms integer default 60000
)
returns public.review_completion_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.review_completion_jobs;
  v_now timestamptz := now();
begin
  if p_claim_token is null or length(p_claim_token) = 0 then
    raise exception 'claim_token required';
  end if;

  update public.review_completion_jobs j
  set
    status = 'running',
    claim_token = p_claim_token,
    claim_generation = j.claim_generation + 1,
    lease_expires_at = v_now + make_interval(secs => greatest(1, p_lease_ms) / 1000.0),
    next_attempt_at = v_now + make_interval(secs => greatest(1, p_lease_ms) / 1000.0),
    updated_at = v_now
  where j.id = p_job_id
    and j.status in ('pending', 'running')
    and (
      j.claim_token is null
      or j.claim_token = p_claim_token
      or j.lease_expires_at is null
      or j.lease_expires_at <= v_now
    )
  returning j.* into v_row;

  return v_row;
end;
$$;

revoke all on function public.claim_review_completion_job(text, text, integer) from public;
grant execute on function public.claim_review_completion_job(text, text, integer) to service_role;

-- CAS checkpoint: only writer with matching claim_token + generation may persist.
create or replace function public.checkpoint_review_completion_job(
  p_job_id text,
  p_claim_token text,
  p_claim_generation bigint,
  p_job_payload jsonb,
  p_status text,
  p_lease_ms integer default 60000,
  p_next_attempt_at timestamptz default null
)
returns public.review_completion_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.review_completion_jobs;
  v_now timestamptz := now();
begin
  if p_status not in ('pending', 'running', 'complete', 'failed_fatal') then
    raise exception 'invalid status %', p_status;
  end if;

  update public.review_completion_jobs j
  set
    job_payload = p_job_payload,
    status = p_status,
    updated_at = v_now,
    lease_expires_at = case
      when p_status in ('complete', 'failed_fatal') then null
      else v_now + make_interval(secs => greatest(1, p_lease_ms) / 1000.0)
    end,
    next_attempt_at = coalesce(
      p_next_attempt_at,
      case
        when p_status in ('complete', 'failed_fatal') then v_now
        else v_now + make_interval(secs => greatest(1, p_lease_ms) / 1000.0)
      end
    ),
    claim_token = case
      when p_status in ('complete', 'failed_fatal') then null
      else p_claim_token
    end,
    completed_at = case
      when p_status = 'complete' then coalesce(j.completed_at, v_now)
      else j.completed_at
    end
  where j.id = p_job_id
    and j.claim_token = p_claim_token
    and j.claim_generation = p_claim_generation
    and j.status in ('pending', 'running')
  returning j.* into v_row;

  return v_row;
end;
$$;

revoke all on function public.checkpoint_review_completion_job(text, text, bigint, jsonb, text, integer, timestamptz) from public;
grant execute on function public.checkpoint_review_completion_job(text, text, bigint, jsonb, text, integer, timestamptz) to service_role;

-- List claimable jobs for sweep (service role only via RLS deny-all + security definer optional).
create or replace function public.list_claimable_review_completion_jobs(
  p_limit integer default 8
)
returns setof public.review_completion_jobs
language sql
security definer
set search_path = public
as $$
  select *
  from public.review_completion_jobs j
  where j.status in ('pending', 'running')
    and (j.lease_expires_at is null or j.lease_expires_at <= now() or j.claim_token is null)
    and j.next_attempt_at <= now()
  order by j.next_attempt_at asc, j.created_at asc
  limit greatest(1, least(p_limit, 64));
$$;

revoke all on function public.list_claimable_review_completion_jobs(integer) from public;
grant execute on function public.list_claimable_review_completion_jobs(integer) to service_role;
