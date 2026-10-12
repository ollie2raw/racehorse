-- M3: tournament orchestrator lease (Phase 2C).
--
-- One DB-backed lease decides which server process runs the Node tournament
-- orchestration (lifecycle, start dispatch, reconcile, match cap, event
-- backstop, seed fallback, boot recovery). Additive and inert until a server
-- that calls these RPCs is deployed.
--
-- Ownership is an EPOCH, not a name: every successful acquisition mints a new
-- lease_token. Renew and release need owner AND token, so a process whose
-- lease expired (and was taken over) can never renew or release the new
-- owner's lease, even if an owner id were ever reused.
--
-- All times are the database clock (clock_timestamp()); callers never pass a
-- time. TTL is bounded: 5..600 seconds, else `invalid_lease_ttl`.
--
-- acquire_tournament_orchestrator_lease(key, owner, ttl_seconds)
--   Succeeds only if there is no lease for the key or it has expired; mints a
--   new token. A process that already holds a valid lease does not re-acquire
--   (acquired=false, owner = itself): it renews.
--   -> {acquired, owner, lease_token (when acquired), leased_until}
-- renew_tournament_orchestrator_lease(key, owner, token, ttl_seconds)
--   Extends only an unexpired lease with exactly this owner and token.
--   -> {renewed, leased_until}
-- release_tournament_orchestrator_lease(key, owner, token)
--   Ends only an unexpired lease with exactly this owner and token (the key is
--   immediately acquirable). -> {released}
--
-- This lease prevents duplicate orchestration in normal operation. It does not
-- fence individual database writes: an operation issued before ownership was
-- lost may still complete. Those writes are compare-and-set / row-locked /
-- idempotent on their own (2026-10-08_tournament_orchestrator_cas.sql). It is
-- not Socket.IO room ownership either.

begin;

create table if not exists public.tournament_orchestrator_leases (
  lease_key    text primary key check (lease_key <> ''),
  owner_id     text not null check (owner_id <> ''),
  lease_token  uuid not null,
  leased_until timestamptz not null,
  acquired_at  timestamptz not null,
  renewed_at   timestamptz not null
);

-- Server-only: RLS on with no client policy, and no client grants.
alter table public.tournament_orchestrator_leases enable row level security;
revoke all on table public.tournament_orchestrator_leases from anon, authenticated;

create or replace function public._tournament_lease_ttl(p_ttl_seconds integer)
returns interval
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_ttl_seconds is null or p_ttl_seconds < 5 or p_ttl_seconds > 600 then
    raise exception 'invalid_lease_ttl' using detail = coalesce(p_ttl_seconds::text, 'null');
  end if;
  return make_interval(secs => p_ttl_seconds);
end;
$$;

create or replace function public.acquire_tournament_orchestrator_lease(
  p_key         text,
  p_owner       text,
  p_ttl_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ttl interval := public._tournament_lease_ttl(p_ttl_seconds);
  v_now timestamptz := clock_timestamp();
  v_row tournament_orchestrator_leases%rowtype;
begin
  if coalesce(p_key, '') = '' or coalesce(p_owner, '') = '' then
    raise exception 'invalid_lease_request';
  end if;
  insert into tournament_orchestrator_leases as l
    (lease_key, owner_id, lease_token, leased_until, acquired_at, renewed_at)
  values (p_key, p_owner, gen_random_uuid(), v_now + v_ttl, v_now, v_now)
  on conflict (lease_key) do update
     set owner_id     = excluded.owner_id,
         lease_token  = excluded.lease_token,
         leased_until = excluded.leased_until,
         acquired_at  = excluded.acquired_at,
         renewed_at   = excluded.renewed_at
   -- Only an expired lease is taken over (re-checked after waiting on a
   -- concurrent acquirer's row lock, so at most one wins).
   where l.leased_until <= clock_timestamp()
  returning * into v_row;
  if found then
    return jsonb_build_object('acquired', true, 'owner', v_row.owner_id,
      'lease_token', v_row.lease_token, 'leased_until', v_row.leased_until);
  end if;
  select * into v_row from tournament_orchestrator_leases where lease_key = p_key;
  return jsonb_build_object('acquired', false, 'owner', v_row.owner_id, 'leased_until', v_row.leased_until);
end;
$$;

create or replace function public.renew_tournament_orchestrator_lease(
  p_key         text,
  p_owner       text,
  p_token       uuid,
  p_ttl_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ttl   interval := public._tournament_lease_ttl(p_ttl_seconds);
  v_until timestamptz;
begin
  update tournament_orchestrator_leases
     set leased_until = clock_timestamp() + v_ttl,
         renewed_at   = clock_timestamp()
   where lease_key = p_key
     and owner_id = p_owner
     and lease_token = p_token
     and leased_until > clock_timestamp()
  returning leased_until into v_until;
  return jsonb_build_object('renewed', v_until is not null, 'leased_until', v_until);
end;
$$;

create or replace function public.release_tournament_orchestrator_lease(
  p_key   text,
  p_owner text,
  p_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_released integer;
begin
  update tournament_orchestrator_leases
     set leased_until = clock_timestamp()
   where lease_key = p_key
     and owner_id = p_owner
     and lease_token = p_token
     and leased_until > clock_timestamp();
  get diagnostics v_released = row_count;
  return jsonb_build_object('released', v_released > 0);
end;
$$;

revoke execute on function
  public._tournament_lease_ttl(integer),
  public.acquire_tournament_orchestrator_lease(text, text, integer),
  public.renew_tournament_orchestrator_lease(text, text, uuid, integer),
  public.release_tournament_orchestrator_lease(text, text, uuid)
  from public, anon, authenticated;

grant execute on function
  public._tournament_lease_ttl(integer),
  public.acquire_tournament_orchestrator_lease(text, text, integer),
  public.renew_tournament_orchestrator_lease(text, text, uuid, integer),
  public.release_tournament_orchestrator_lease(text, text, uuid)
  to service_role;

commit;
