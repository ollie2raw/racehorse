-- Fritz Challenge authority primitives. This is additive: existing challenge
-- flows continue to operate until the transactional command cutover is enabled.

alter table public.fritz_challenge_attempts
  add column if not exists revision bigint not null default 0,
  add column if not exists authority_schema_version int not null default 1;

create index if not exists idx_fritz_challenge_attempts_active_revision
  on public.fritz_challenge_attempts (id, revision)
  where status = 'started';

create table if not exists public.fritz_challenge_attempt_operations (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.fritz_challenge_attempts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id uuid not null references public.fritz_challenges(id) on delete cascade,
  operation_id text not null check (char_length(operation_id) between 8 and 160),
  command_type text not null check (command_type in (
    'start_attempt', 'accept_verified_hand', 'record_verified_game', 'finalize_verified_attempt'
  )),
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  expected_revision bigint not null check (expected_revision >= 0),
  committed_revision bigint null check (committed_revision >= 0),
  status text not null check (status in ('committed', 'rejected')),
  response jsonb null,
  error_code text null,
  created_at timestamptz not null default now(),
  committed_at timestamptz null,
  unique (attempt_id, operation_id),
  unique (user_id, challenge_id, operation_id),
  check (
    (status = 'committed' and committed_revision is not null and response is not null and error_code is null)
    or (status = 'rejected' and error_code is not null)
  )
);

create table if not exists public.fritz_challenge_verified_hands (
  attempt_id uuid not null references public.fritz_challenge_attempts(id) on delete cascade,
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
  unique (attempt_id, operation_id)
);

create table if not exists public.fritz_challenge_verified_games (
  attempt_id uuid not null references public.fritz_challenge_attempts(id) on delete cascade,
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
  unique (attempt_id, operation_id)
);

create table if not exists public.fritz_challenge_outbox (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.fritz_challenge_attempts(id) on delete cascade,
  challenge_id uuid not null references public.fritz_challenges(id) on delete cascade,
  operation_id text not null,
  event_type text not null,
  payload jsonb not null,
  occurred_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  delivered_at timestamptz null,
  delivery_attempts int not null default 0 check (delivery_attempts >= 0),
  last_error text null,
  unique (attempt_id, operation_id, event_type)
);

create index if not exists idx_fritz_challenge_outbox_pending
  on public.fritz_challenge_outbox (available_at, occurred_at)
  where delivered_at is null;

alter table public.fritz_challenge_attempt_operations enable row level security;
alter table public.fritz_challenge_verified_hands enable row level security;
alter table public.fritz_challenge_verified_games enable row level security;
alter table public.fritz_challenge_outbox enable row level security;

create policy "fritz_challenge_attempt_operations_no_client_access"
  on public.fritz_challenge_attempt_operations for all to authenticated using (false) with check (false);
create policy "fritz_challenge_verified_hands_no_client_access"
  on public.fritz_challenge_verified_hands for all to authenticated using (false) with check (false);
create policy "fritz_challenge_verified_games_no_client_access"
  on public.fritz_challenge_verified_games for all to authenticated using (false) with check (false);
create policy "fritz_challenge_outbox_no_client_access"
  on public.fritz_challenge_outbox for all to authenticated using (false) with check (false);
