create extension if not exists pgcrypto;

create table if not exists public.daily_fritz_runs (
  run_date date primary key,
  seed text not null,
  fritz_tier text not null,
  deal_size int not null check (deal_size in (7, 14)),
  winning_score int not null,
  status text not null check (status in ('live', 'archived', 'invalidated')),
  hand_deals jsonb not null,
  generated_at timestamptz not null default now(),
  invalidated_at timestamptz null,
  metadata jsonb null
);

create table if not exists public.daily_fritz_attempts (
  id uuid primary key default gen_random_uuid(),
  run_date date not null references public.daily_fritz_runs(run_date) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('started', 'completed', 'abandoned')),
  current_hand_index int not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  verified_match_id uuid null,
  completion_hash text null,
  result jsonb null,
  final_score int null,
  opponent_score int null,
  point_diff int null,
  won boolean null,
  moves_used int null,
  hands_played int null
);

create unique index if not exists idx_daily_fritz_attempts_run_user
  on public.daily_fritz_attempts (run_date, user_id);

create index if not exists idx_daily_fritz_attempts_run_status
  on public.daily_fritz_attempts (run_date, status, completed_at);

create table if not exists public.daily_fritz_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid null references public.daily_fritz_attempts(id) on delete cascade,
  run_date date null references public.daily_fritz_runs(run_date) on delete set null,
  user_id uuid null references auth.users(id) on delete set null,
  request_id text null,
  event_type text not null check (event_type in (
    'attempt_started', 'hand_verified', 'next_hand_replayed', 'game_recorded',
    'attempt_completed', 'attempt_abandoned', 'verification_failed',
    'request_failed', 'retry_request'
  )),
  game_number int null check (game_number is null or game_number between 1 and 3),
  hand_index int null check (hand_index is null or hand_index >= 0),
  status_code int null,
  verifier_code text null,
  transcript_digest text null,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_daily_fritz_events_idempotency
  on public.daily_fritz_events (idempotency_key);
create index if not exists idx_daily_fritz_events_attempt_created
  on public.daily_fritz_events (attempt_id, created_at);
create index if not exists idx_daily_fritz_events_run_type_created
  on public.daily_fritz_events (run_date, event_type, created_at);

create or replace view public.daily_fritz_event_metrics
  with (security_invoker = true) as
select
  event_type,
  verifier_code,
  count(*)::bigint as total
from public.daily_fritz_events
group by event_type, verifier_code;

revoke all on public.daily_fritz_event_metrics from anon, authenticated;
grant select on public.daily_fritz_event_metrics to service_role;

alter table public.daily_fritz_runs enable row level security;
alter table public.daily_fritz_attempts enable row level security;
alter table public.daily_fritz_events enable row level security;

drop policy if exists "daily_fritz_runs_read_all" on public.daily_fritz_runs;
create policy "daily_fritz_runs_read_all"
  on public.daily_fritz_runs
  for select
  to authenticated
  using (true);

drop policy if exists "daily_fritz_runs_no_client_write" on public.daily_fritz_runs;
create policy "daily_fritz_runs_no_client_write"
  on public.daily_fritz_runs
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "daily_fritz_attempts_select_own" on public.daily_fritz_attempts;
create policy "daily_fritz_attempts_select_own"
  on public.daily_fritz_attempts
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "daily_fritz_attempts_no_client_write" on public.daily_fritz_attempts;
create policy "daily_fritz_attempts_no_client_write"
  on public.daily_fritz_attempts
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "daily_fritz_events_no_client_access" on public.daily_fritz_events;
create policy "daily_fritz_events_no_client_access"
  on public.daily_fritz_events
  for all
  to authenticated
  using (false)
  with check (false);

-- Immutable challenge publication. Keep this canonical schema in sync with
-- migrations/2026-08-01_daily_fritz_published_challenges.sql.
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
  constraint daily_fritz_published_challenges_date_version_key unique (run_date, contract_version),
  constraint daily_fritz_published_challenges_digest_key unique (content_digest),
  constraint daily_fritz_published_challenges_digest_format check (content_digest ~ '^[0-9a-f]{64}$'),
  constraint daily_fritz_published_challenges_invalidation_check check (status <> 'invalidated' or invalidated_at is not null)
);

create index if not exists idx_daily_fritz_published_challenges_date_status
  on public.daily_fritz_published_challenges (run_date desc, status);

alter table public.daily_fritz_published_challenges enable row level security;

create or replace function public.protect_daily_fritz_published_challenge()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'invalidated' and new is distinct from old then
    raise exception 'daily_fritz_invalidated_challenge_is_final';
  end if;
  if old.challenge_id <> new.challenge_id or old.run_date <> new.run_date
    or old.contract_version <> new.contract_version or old.generation_version <> new.generation_version
    or old.seed_version <> new.seed_version or old.product_rules_version <> new.product_rules_version
    or old.game_rules_version <> new.game_rules_version or old.transcript_protocol_version <> new.transcript_protocol_version
    or old.verifier_version <> new.verifier_version or old.fritz_policy_version <> new.fritz_policy_version
    or old.fritz_policy_contract <> new.fritz_policy_contract or old.ranking_version <> new.ranking_version
    or old.time_zone <> new.time_zone or old.content_digest <> new.content_digest
    or old.package <> new.package or old.published_at <> new.published_at then
    raise exception 'daily_fritz_published_challenge_is_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_daily_fritz_published_challenge on public.daily_fritz_published_challenges;
create trigger protect_daily_fritz_published_challenge
before update on public.daily_fritz_published_challenges
for each row execute function public.protect_daily_fritz_published_challenge();

create or replace function public.prevent_daily_fritz_published_challenge_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'daily_fritz_published_challenge_delete_forbidden';
end;
$$;
drop trigger if exists prevent_daily_fritz_published_challenge_delete on public.daily_fritz_published_challenges;
create trigger prevent_daily_fritz_published_challenge_delete
before delete on public.daily_fritz_published_challenges
for each row execute function public.prevent_daily_fritz_published_challenge_delete();

drop policy if exists "daily_fritz_published_challenges_read" on public.daily_fritz_published_challenges;
create policy "daily_fritz_published_challenges_read"
  on public.daily_fritz_published_challenges for select to authenticated using (true);

drop policy if exists "daily_fritz_published_challenges_no_client_write" on public.daily_fritz_published_challenges;
create policy "daily_fritz_published_challenges_no_client_write"
  on public.daily_fritz_published_challenges for all to authenticated using (false) with check (false);

-- Transaction command primitives. Keep this canonical schema in sync with
-- migrations/2026-08-01_daily_fritz_command_primitives.sql.
alter table public.daily_fritz_attempts
  add column if not exists revision bigint not null default 0,
  add column if not exists challenge_id text null,
  add column if not exists current_game_number int not null default 1 check (current_game_number between 1 and 3),
  add column if not exists challenge_contract_version int null,
  add column if not exists generation_version int null,
  add column if not exists game_rules_version int null,
  add column if not exists transcript_protocol_version int null,
  add column if not exists fritz_policy_version int null,
  add column if not exists ranking_version int null,
  add column if not exists authority_schema_version int not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'daily_fritz_attempts_challenge_id_fkey' and conrelid = 'public.daily_fritz_attempts'::regclass) then
    alter table public.daily_fritz_attempts add constraint daily_fritz_attempts_challenge_id_fkey
      foreign key (challenge_id) references public.daily_fritz_published_challenges(challenge_id) not valid;
  end if;
end;
$$;

create index if not exists idx_daily_fritz_attempts_challenge_user on public.daily_fritz_attempts (challenge_id, user_id);
create index if not exists idx_daily_fritz_attempts_active_revision on public.daily_fritz_attempts (id, revision) where status = 'started';

create table if not exists public.daily_fritz_attempt_operations (
  id uuid primary key default gen_random_uuid(),
  operation_id text not null check (char_length(operation_id) between 8 and 160),
  attempt_id uuid not null references public.daily_fritz_attempts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id text not null references public.daily_fritz_published_challenges(challenge_id),
  command_type text not null check (command_type in ('start_attempt', 'accept_verified_hand', 'record_verified_game', 'finalize_verified_attempt', 'abandon_attempt')),
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  expected_revision bigint not null check (expected_revision >= 0),
  committed_revision bigint null check (committed_revision is null or committed_revision >= 0),
  status text not null check (status in ('committed', 'rejected')),
  response jsonb null,
  error_code text null,
  created_at timestamptz not null default now(),
  committed_at timestamptz null,
  unique (attempt_id, operation_id),
  unique (user_id, challenge_id, operation_id),
  check ((status = 'committed' and committed_revision is not null and response is not null and error_code is null) or (status = 'rejected' and error_code is not null))
);

create index if not exists idx_daily_fritz_attempt_operations_replay on public.daily_fritz_attempt_operations (attempt_id, operation_id, request_digest);
create index if not exists idx_daily_fritz_attempt_operations_created on public.daily_fritz_attempt_operations (created_at desc);

create table if not exists public.daily_fritz_verified_hands (
  attempt_id uuid not null references public.daily_fritz_attempts(id) on delete cascade,
  game_number int not null check (game_number between 1 and 3), hand_index int not null check (hand_index >= 0),
  operation_id text not null, transcript_digest text not null check (transcript_digest ~ '^[0-9a-f]{64}$'),
  action_count int not null check (action_count > 0), player_score_after int not null check (player_score_after >= 0),
  fritz_score_after int not null check (fritz_score_after >= 0), winner text null check (winner is null or winner in ('player', 'fritz')),
  verifier_version int not null, receipt jsonb not null, created_at timestamptz not null default now(),
  primary key (attempt_id, game_number, hand_index), unique (attempt_id, operation_id)
);

create table if not exists public.daily_fritz_verified_games (
  attempt_id uuid not null references public.daily_fritz_attempts(id) on delete cascade,
  game_number int not null check (game_number between 1 and 3), operation_id text not null,
  player_score int not null check (player_score >= 0), fritz_score int not null check (fritz_score >= 0), point_diff int not null,
  player_won boolean not null, action_count int not null check (action_count > 0), hands_played int not null check (hands_played > 0),
  result_digest text not null check (result_digest ~ '^[0-9a-f]{64}$'), receipt jsonb not null,
  created_at timestamptz not null default now(), primary key (attempt_id, game_number), unique (attempt_id, operation_id)
);

create table if not exists public.daily_fritz_outbox (
  id uuid primary key default gen_random_uuid(), attempt_id uuid null references public.daily_fritz_attempts(id) on delete cascade,
  challenge_id text not null references public.daily_fritz_published_challenges(challenge_id), operation_id text not null,
  event_type text not null, event_version int not null default 1, payload jsonb not null,
  occurred_at timestamptz not null default now(), available_at timestamptz not null default now(), delivered_at timestamptz null,
  delivery_attempts int not null default 0 check (delivery_attempts >= 0), last_error text null,
  constraint daily_fritz_outbox_attempt_operation_event_key
    unique (attempt_id, operation_id, event_type)
);

create index if not exists idx_daily_fritz_outbox_pending on public.daily_fritz_outbox (available_at, occurred_at) where delivered_at is null;

alter table public.daily_fritz_attempt_operations enable row level security;
alter table public.daily_fritz_verified_hands enable row level security;
alter table public.daily_fritz_verified_games enable row level security;
alter table public.daily_fritz_outbox enable row level security;

drop policy if exists "daily_fritz_attempt_operations_no_client_access" on public.daily_fritz_attempt_operations;
create policy "daily_fritz_attempt_operations_no_client_access" on public.daily_fritz_attempt_operations for all to authenticated using (false) with check (false);
drop policy if exists "daily_fritz_verified_hands_no_client_access" on public.daily_fritz_verified_hands;
create policy "daily_fritz_verified_hands_no_client_access" on public.daily_fritz_verified_hands for all to authenticated using (false) with check (false);
drop policy if exists "daily_fritz_verified_games_no_client_access" on public.daily_fritz_verified_games;
create policy "daily_fritz_verified_games_no_client_access" on public.daily_fritz_verified_games for all to authenticated using (false) with check (false);
drop policy if exists "daily_fritz_outbox_no_client_access" on public.daily_fritz_outbox;
create policy "daily_fritz_outbox_no_client_access" on public.daily_fritz_outbox for all to authenticated using (false) with check (false);
