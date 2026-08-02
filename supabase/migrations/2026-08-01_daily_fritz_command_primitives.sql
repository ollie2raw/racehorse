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
  if not exists (
    select 1 from pg_constraint
    where conname = 'daily_fritz_attempts_challenge_id_fkey'
      and conrelid = 'public.daily_fritz_attempts'::regclass
  ) then
    alter table public.daily_fritz_attempts
      add constraint daily_fritz_attempts_challenge_id_fkey
      foreign key (challenge_id)
      references public.daily_fritz_published_challenges(challenge_id)
      not valid;
  end if;
end;
$$;

create index if not exists idx_daily_fritz_attempts_challenge_user
  on public.daily_fritz_attempts (challenge_id, user_id);
create index if not exists idx_daily_fritz_attempts_active_revision
  on public.daily_fritz_attempts (id, revision)
  where status = 'started';

create table if not exists public.daily_fritz_attempt_operations (
  id uuid primary key default gen_random_uuid(),
  operation_id text not null check (char_length(operation_id) between 8 and 160),
  attempt_id uuid not null references public.daily_fritz_attempts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id text not null references public.daily_fritz_published_challenges(challenge_id),
  command_type text not null check (command_type in (
    'start_attempt', 'accept_verified_hand', 'record_verified_game',
    'finalize_verified_attempt', 'abandon_attempt'
  )),
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  expected_revision bigint not null check (expected_revision >= 0),
  committed_revision bigint null check (committed_revision is null or committed_revision >= 0),
  status text not null check (status in ('committed', 'rejected')),
  response jsonb null,
  error_code text null,
  created_at timestamptz not null default now(),
  committed_at timestamptz null,
  constraint daily_fritz_attempt_operations_attempt_operation_key
    unique (attempt_id, operation_id),
  constraint daily_fritz_attempt_operations_user_challenge_operation_key
    unique (user_id, challenge_id, operation_id),
  constraint daily_fritz_attempt_operations_terminal_shape check (
    (status = 'committed' and committed_revision is not null and response is not null and error_code is null)
    or (status = 'rejected' and error_code is not null)
  )
);

create index if not exists idx_daily_fritz_attempt_operations_replay
  on public.daily_fritz_attempt_operations (attempt_id, operation_id, request_digest);
create index if not exists idx_daily_fritz_attempt_operations_created
  on public.daily_fritz_attempt_operations (created_at desc);

create table if not exists public.daily_fritz_verified_hands (
  attempt_id uuid not null references public.daily_fritz_attempts(id) on delete cascade,
  game_number int not null check (game_number between 1 and 3),
  hand_index int not null check (hand_index >= 0),
  operation_id text not null,
  transcript_digest text not null check (transcript_digest ~ '^[0-9a-f]{64}$'),
  action_count int not null check (action_count > 0),
  player_score_after int not null check (player_score_after >= 0),
  fritz_score_after int not null check (fritz_score_after >= 0),
  winner text null check (winner is null or winner in ('player', 'fritz')),
  verifier_version int not null,
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  primary key (attempt_id, game_number, hand_index),
  constraint daily_fritz_verified_hands_operation_key unique (attempt_id, operation_id)
);

create index if not exists idx_daily_fritz_verified_hands_attempt_game
  on public.daily_fritz_verified_hands (attempt_id, game_number, hand_index);

create table if not exists public.daily_fritz_verified_games (
  attempt_id uuid not null references public.daily_fritz_attempts(id) on delete cascade,
  game_number int not null check (game_number between 1 and 3),
  operation_id text not null,
  player_score int not null check (player_score >= 0),
  fritz_score int not null check (fritz_score >= 0),
  point_diff int not null,
  player_won boolean not null,
  action_count int not null check (action_count > 0),
  hands_played int not null check (hands_played > 0),
  result_digest text not null check (result_digest ~ '^[0-9a-f]{64}$'),
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  primary key (attempt_id, game_number),
  constraint daily_fritz_verified_games_operation_key unique (attempt_id, operation_id)
);

create table if not exists public.daily_fritz_outbox (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid null references public.daily_fritz_attempts(id) on delete cascade,
  challenge_id text not null references public.daily_fritz_published_challenges(challenge_id),
  operation_id text not null,
  event_type text not null,
  event_version int not null default 1,
  payload jsonb not null,
  occurred_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  delivered_at timestamptz null,
  delivery_attempts int not null default 0 check (delivery_attempts >= 0),
  last_error text null,
  constraint daily_fritz_outbox_operation_event_key
  constraint daily_fritz_outbox_attempt_operation_event_key
    unique (attempt_id, operation_id, event_type)
);

create index if not exists idx_daily_fritz_outbox_pending
  on public.daily_fritz_outbox (available_at, occurred_at)
  where delivered_at is null;

alter table public.daily_fritz_attempt_operations enable row level security;
alter table public.daily_fritz_verified_hands enable row level security;
alter table public.daily_fritz_verified_games enable row level security;
alter table public.daily_fritz_outbox enable row level security;

drop policy if exists "daily_fritz_attempt_operations_no_client_access" on public.daily_fritz_attempt_operations;
create policy "daily_fritz_attempt_operations_no_client_access"
  on public.daily_fritz_attempt_operations for all to authenticated using (false) with check (false);

drop policy if exists "daily_fritz_verified_hands_no_client_access" on public.daily_fritz_verified_hands;
create policy "daily_fritz_verified_hands_no_client_access"
  on public.daily_fritz_verified_hands for all to authenticated using (false) with check (false);

drop policy if exists "daily_fritz_verified_games_no_client_access" on public.daily_fritz_verified_games;
create policy "daily_fritz_verified_games_no_client_access"
  on public.daily_fritz_verified_games for all to authenticated using (false) with check (false);

drop policy if exists "daily_fritz_outbox_no_client_access" on public.daily_fritz_outbox;
create policy "daily_fritz_outbox_no_client_access"
  on public.daily_fritz_outbox for all to authenticated using (false) with check (false);

comment on column public.daily_fritz_attempts.revision is
  'Monotonic compare-and-swap revision. Every committed authority transition increments exactly once.';
comment on table public.daily_fritz_attempt_operations is
  'Durable idempotency receipts. The same operation and digest replays its response; digest reuse conflicts.';
comment on table public.daily_fritz_outbox is
  'Transactional event outbox. Analytics and social side effects consume this table and never own authority.';
