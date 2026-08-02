create table if not exists public.daily_fritz_published_challenges (
  challenge_id text primary key,
  run_date date not null,
  contract_version int not null,
  generation_version int not null,
  seed_version int not null,
  product_rules_version int not null,
  game_rules_version int not null,
  transcript_protocol_version int not null,
  verifier_version int not null,
  fritz_policy_version int not null,
  fritz_policy_contract text not null,
  ranking_version int not null,
  time_zone text not null,
  content_digest text not null,
  package jsonb not null,
  status text not null check (status in ('live', 'archived', 'invalidated')),
  published_at timestamptz not null default now(),
  invalidated_at timestamptz null,
  invalidation_reason text null,
  constraint daily_fritz_published_challenges_date_version_key
    unique (run_date, contract_version),
  constraint daily_fritz_published_challenges_digest_key
    unique (content_digest),
  constraint daily_fritz_published_challenges_digest_format
    check (content_digest ~ '^[0-9a-f]{64}$'),
  constraint daily_fritz_published_challenges_invalidation_check
    check (status <> 'invalidated' or invalidated_at is not null)
);

create index if not exists idx_daily_fritz_published_challenges_date_status
  on public.daily_fritz_published_challenges (run_date desc, status);

alter table public.daily_fritz_published_challenges enable row level security;

create or replace function public.protect_daily_fritz_published_challenge()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'invalidated' and new is distinct from old then
    raise exception 'daily_fritz_invalidated_challenge_is_final';
  end if;
  if old.challenge_id <> new.challenge_id
    or old.run_date <> new.run_date
    or old.contract_version <> new.contract_version
    or old.generation_version <> new.generation_version
    or old.seed_version <> new.seed_version
    or old.product_rules_version <> new.product_rules_version
    or old.game_rules_version <> new.game_rules_version
    or old.transcript_protocol_version <> new.transcript_protocol_version
    or old.verifier_version <> new.verifier_version
    or old.fritz_policy_version <> new.fritz_policy_version
    or old.fritz_policy_contract <> new.fritz_policy_contract
    or old.ranking_version <> new.ranking_version
    or old.time_zone <> new.time_zone
    or old.content_digest <> new.content_digest
    or old.package <> new.package
    or old.published_at <> new.published_at then
    raise exception 'daily_fritz_published_challenge_is_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_daily_fritz_published_challenge
  on public.daily_fritz_published_challenges;
create trigger protect_daily_fritz_published_challenge
before update on public.daily_fritz_published_challenges
for each row execute function public.protect_daily_fritz_published_challenge();

create or replace function public.prevent_daily_fritz_published_challenge_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'daily_fritz_published_challenge_delete_forbidden';
end;
$$;

drop trigger if exists prevent_daily_fritz_published_challenge_delete
  on public.daily_fritz_published_challenges;
create trigger prevent_daily_fritz_published_challenge_delete
before delete on public.daily_fritz_published_challenges
for each row execute function public.prevent_daily_fritz_published_challenge_delete();

drop policy if exists "daily_fritz_published_challenges_read" on public.daily_fritz_published_challenges;
create policy "daily_fritz_published_challenges_read"
  on public.daily_fritz_published_challenges
  for select
  to authenticated
  using (true);

drop policy if exists "daily_fritz_published_challenges_no_client_write" on public.daily_fritz_published_challenges;
create policy "daily_fritz_published_challenges_no_client_write"
  on public.daily_fritz_published_challenges
  for all
  to authenticated
  using (false)
  with check (false);

create or replace function public.publish_daily_fritz_challenge(
  p_challenge_id text,
  p_run_date date,
  p_contract_version int,
  p_generation_version int,
  p_seed_version int,
  p_product_rules_version int,
  p_game_rules_version int,
  p_transcript_protocol_version int,
  p_verifier_version int,
  p_fritz_policy_version int,
  p_fritz_policy_contract text,
  p_ranking_version int,
  p_time_zone text,
  p_content_digest text,
  p_package jsonb,
  p_published_at timestamptz
)
returns setof public.daily_fritz_published_challenges
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  published public.daily_fritz_published_challenges%rowtype;
begin
  insert into public.daily_fritz_published_challenges (
    challenge_id,
    run_date,
    contract_version,
    generation_version,
    seed_version,
    product_rules_version,
    game_rules_version,
    transcript_protocol_version,
    verifier_version,
    fritz_policy_version,
    fritz_policy_contract,
    ranking_version,
    time_zone,
    content_digest,
    package,
    status,
    published_at
  ) values (
    p_challenge_id,
    p_run_date,
    p_contract_version,
    p_generation_version,
    p_seed_version,
    p_product_rules_version,
    p_game_rules_version,
    p_transcript_protocol_version,
    p_verifier_version,
    p_fritz_policy_version,
    p_fritz_policy_contract,
    p_ranking_version,
    p_time_zone,
    p_content_digest,
    p_package,
    'live',
    p_published_at
  )
  on conflict (challenge_id) do nothing;

  select * into published
    from public.daily_fritz_published_challenges
    where challenge_id = p_challenge_id
    for share;

  if not found then
    raise exception 'daily_fritz_challenge_publication_failed';
  end if;
  if published.content_digest <> p_content_digest or published.package <> p_package then
    raise exception 'daily_fritz_challenge_identity_conflict';
  end if;

  return next published;
end;
$$;

revoke all on function public.publish_daily_fritz_challenge(
  text, date, int, int, int, int, int, int, int, int, text, int, text, text, jsonb, timestamptz
) from public;
revoke all on function public.publish_daily_fritz_challenge(
  text, date, int, int, int, int, int, int, int, int, text, int, text, text, jsonb, timestamptz
) from authenticated;
grant execute on function public.publish_daily_fritz_challenge(
  text, date, int, int, int, int, int, int, int, int, text, int, text, text, jsonb, timestamptz
) to service_role;

create or replace function public.invalidate_daily_fritz_challenge(
  p_run_date date,
  p_reason text
)
returns setof public.daily_fritz_published_challenges
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  published public.daily_fritz_published_challenges%rowtype;
  v_invalidated_at timestamptz := now();
begin
  select * into published
    from public.daily_fritz_published_challenges
    where run_date = p_run_date
    for update;
  if not found then raise exception 'daily_fritz_published_challenge_missing'; end if;
  if published.status = 'invalidated' then return next published; return; end if;

  update public.daily_fritz_runs
    set status = 'invalidated',
        invalidated_at = v_invalidated_at,
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object('invalidation_reason', nullif(trim(p_reason), ''))
    where run_date = p_run_date;
  if not found then raise exception 'daily_fritz_legacy_run_missing'; end if;

  update public.daily_fritz_published_challenges
    set status = 'invalidated',
        invalidated_at = v_invalidated_at,
        invalidation_reason = nullif(trim(p_reason), '')
    where challenge_id = published.challenge_id
    returning * into published;
  return next published;
end;
$$;

revoke all on function public.invalidate_daily_fritz_challenge(date, text) from public;
revoke all on function public.invalidate_daily_fritz_challenge(date, text) from authenticated;
grant execute on function public.invalidate_daily_fritz_challenge(date, text) to service_role;

comment on table public.daily_fritz_published_challenges is
  'Immutable, content-addressed Daily Fritz challenge packages. Rows are never updated except explicit status invalidation metadata.';
