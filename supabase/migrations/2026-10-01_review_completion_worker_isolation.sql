-- Review completion: due check at claim time, job-level attempt cap with
-- backoff, fenced lease renewal, and retirement of pre-fix jobs.
-- Additive on 2026-09-23_review_completion_jobs_claim_rpc.sql.
--
-- Why (2026-09-30 / 2026-10-01 outages): review passes ran on the web
-- server's event loop and a stuck job was re-claimed forever.
--   * claim_review_completion_job (v1) never checks next_attempt_at, and lets
--     the same claim token re-claim a live lease. A sweep that listed a job
--     before an operator pushed next_attempt_at out still claimed it after
--     (job 43da2288, 2026-10-01 17:17:55 UTC).
--   * There was no job-level attempt limit, so a poison job looped forever.
--
-- claim_review_completion_job_v2 decides everything from the locked row at
-- the moment of claiming, never from a list built earlier:
--   status pending/running, next_attempt_at <= now(), and no live lease
--   (lease_expires_at null or past). Otherwise it returns no row.
--   attempt_count >= p_max_attempts: the job is failed_fatal with
--   failure_reason 'max_attempts_exceeded' and no row is returned.
--   Otherwise attempt_count + 1, claim_generation + 1, lease = now + lease,
--   next_attempt_at = now + lease + backoff, where backoff doubles per
--   attempt: p_backoff_base_ms * 2^(attempt - 1), capped at p_backoff_max_ms.
--   A pass that dies without a final checkpoint therefore cannot be retried
--   before its lease plus backoff.
--
-- renew_review_completion_lease: heartbeat, fenced on claim token AND
-- generation, returns false once the claim is gone (the pass must stop).
--
-- Every job still pending/running when this migration is applied is retired:
-- status failed_fatal, failure_reason 'pre_isolation_outage'. The cutoff is
-- the moment of applying (created_at < now()). Completed jobs are untouched.
-- A failed review cannot be re-requested from the app (job ids are fixed per
-- player and game), and nothing in the app would show a late result.
--
-- v1 (claim_review_completion_job) is left in place unchanged so the server
-- currently deployed keeps working until the new one is live and a rollback
-- stays possible. Drop it in a follow-up once the new server is stable.
--
-- Apply BEFORE deploying the server that calls these RPCs, with
-- REVIEW_SWEEP_ENABLED unset (the default since #318).

begin;

alter table public.review_completion_jobs
  add column if not exists attempt_count integer not null default 0;

alter table public.review_completion_jobs
  add column if not exists failure_reason text null;

comment on column public.review_completion_jobs.attempt_count is
  'Job-level claims so far. claim_review_completion_job_v2 fails the job at the cap.';
comment on column public.review_completion_jobs.failure_reason is
  'Why the job is failed_fatal, e.g. max_attempts_exceeded, pre_isolation_outage.';

-- ─────────────────────────────────────────────────────────────────────────────
-- claim_review_completion_job_v2
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.claim_review_completion_job_v2(
  p_job_id          text,
  p_claim_token     text,
  p_lease_ms        integer default 60000,
  p_max_attempts    integer default 5,
  p_backoff_base_ms integer default 30000,
  p_backoff_max_ms  integer default 900000
)
returns public.review_completion_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     public.review_completion_jobs;
  v_now     timestamptz := now();
  v_lease   interval := make_interval(secs => greatest(1, p_lease_ms) / 1000.0);
  v_attempt integer;
  v_backoff interval;
begin
  if p_claim_token is null or length(p_claim_token) = 0 then
    raise exception 'claim_token required';
  end if;

  select * into v_row
    from public.review_completion_jobs
   where id = p_job_id
   for update;
  if not found then
    return null;
  end if;

  -- Due check against the locked row, at the moment of acting.
  if v_row.status not in ('pending', 'running')
     or v_row.next_attempt_at > v_now
     or (v_row.lease_expires_at is not null and v_row.lease_expires_at > v_now)
  then
    return null;
  end if;

  if v_row.attempt_count >= greatest(1, p_max_attempts) then
    update public.review_completion_jobs
       set status = 'failed_fatal',
           failure_reason = 'max_attempts_exceeded',
           claim_token = null,
           lease_expires_at = null,
           updated_at = v_now
     where id = p_job_id;
    return null;
  end if;

  v_attempt := v_row.attempt_count + 1;
  v_backoff := make_interval(secs => least(
    greatest(0, p_backoff_max_ms)::numeric,
    greatest(0, p_backoff_base_ms)::numeric * power(2::numeric, v_attempt - 1)
  ) / 1000.0);

  update public.review_completion_jobs
     set status = 'running',
         claim_token = p_claim_token,
         claim_generation = claim_generation + 1,
         attempt_count = v_attempt,
         lease_expires_at = v_now + v_lease,
         next_attempt_at = v_now + v_lease + v_backoff,
         updated_at = v_now
   where id = p_job_id
  returning * into v_row;

  return v_row;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- renew_review_completion_lease
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.renew_review_completion_lease(
  p_job_id           text,
  p_claim_token      text,
  p_claim_generation bigint,
  p_lease_ms         integer default 60000
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now   timestamptz := now();
  v_lease interval := make_interval(secs => greatest(1, p_lease_ms) / 1000.0);
begin
  update public.review_completion_jobs
     set lease_expires_at = v_now + v_lease,
         next_attempt_at = greatest(next_attempt_at, v_now + v_lease),
         updated_at = v_now
   where id = p_job_id
     and claim_token = p_claim_token
     and claim_generation = p_claim_generation
     and status in ('pending', 'running');
  return found;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Retire every job left non-terminal by the pre-isolation server.
-- ─────────────────────────────────────────────────────────────────────────────
update public.review_completion_jobs
   set status = 'failed_fatal',
       failure_reason = 'pre_isolation_outage',
       claim_token = null,
       lease_expires_at = null,
       updated_at = now()
 where status in ('pending', 'running')
   and created_at < now();

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants: server (service_role) only, asserted like 2026-09-24.
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function public.claim_review_completion_job_v2(text, text, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_review_completion_job_v2(text, text, integer, integer, integer, integer)
  to service_role;

revoke all on function public.renew_review_completion_lease(text, text, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.renew_review_completion_lease(text, text, bigint, integer)
  to service_role;

do $$
declare
  fn regprocedure;
  targets regprocedure[] := array[
    'public.claim_review_completion_job_v2(text, text, integer, integer, integer, integer)',
    'public.renew_review_completion_lease(text, text, bigint, integer)'
  ]::regprocedure[];
begin
  foreach fn in array targets
  loop
    if exists (
      select 1
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
       where p.oid = fn::oid
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
    ) then
      raise exception 'review completion RPC remains executable by PUBLIC: %', fn;
    end if;
    if has_function_privilege('anon', fn, 'EXECUTE')
       or has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'review completion RPC remains executable by a client role: %', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'service_role lost EXECUTE on review completion RPC: %', fn;
    end if;
  end loop;
end $$;

commit;
