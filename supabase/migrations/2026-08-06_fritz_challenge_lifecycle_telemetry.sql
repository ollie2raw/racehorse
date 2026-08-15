-- Project the two lifecycle events that happen before an attempt exists.
-- Attempt commands continue to project through the transactional outbox.
-- This keeps analytics complete without making analytics part of gameplay authority.

create or replace function public.project_fritz_challenge_created_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.fritz_challenge_events (
    challenge_id,
    user_id,
    event_type,
    source,
    event_version,
    idempotency_key,
    payload,
    occurred_at
  ) values (
    new.id,
    new.creator_user_id,
    'challenge_created',
    'server',
    1,
    'challenge_created:' || new.id::text,
    jsonb_build_object(
      'challenge_id', new.id,
      'format', new.format,
      'fritz_tier', new.fritz_tier,
      'deal_size', new.deal_size,
      'winning_score', new.winning_score,
      'rules_version', new.rules_version,
      'fritz_policy_version', new.fritz_policy_version,
      'verifier_version', new.verifier_version,
      'generator_version', new.generator_version
    ),
    coalesce(new.created_at, now())
  ) on conflict (idempotency_key) do nothing;
  return new;
end;
$$;

drop trigger if exists project_fritz_challenge_created_event on public.fritz_challenges;
create trigger project_fritz_challenge_created_event
after insert on public.fritz_challenges
for each row execute function public.project_fritz_challenge_created_event();

create or replace function public.project_fritz_challenge_joined_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.accepted_at is null and new.accepted_at is not null then
    insert into public.fritz_challenge_events (
      challenge_id,
      user_id,
      event_type,
      source,
      event_version,
      idempotency_key,
      payload,
      occurred_at
    ) values (
      new.id,
      new.opponent_user_id,
      'challenge_joined',
      'server',
      1,
      'challenge_joined:' || new.id::text,
      jsonb_build_object(
        'challenge_id', new.id,
        'creator_user_id', new.creator_user_id,
        'opponent_user_id', new.opponent_user_id
      ),
      new.accepted_at
    ) on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists project_fritz_challenge_joined_event on public.fritz_challenges;
create trigger project_fritz_challenge_joined_event
after update of accepted_at on public.fritz_challenges
for each row execute function public.project_fritz_challenge_joined_event();

