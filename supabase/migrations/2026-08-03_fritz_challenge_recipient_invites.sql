-- A Fritz Challenge is a pre-committed invitation, not a shareable result.
-- The creator must bind one accepted friend before their first verified action.

alter table public.fritz_challenges
  add column if not exists invited_at timestamptz null,
  add column if not exists accepted_at timestamptz null;

-- Preserve the meaning of existing paired challenges without granting legacy,
-- unpaired records the ability to start under the new invitation contract.
update public.fritz_challenges
  set invited_at = coalesce(invited_at, created_at)
  where opponent_user_id is not null;

update public.fritz_challenges
  set accepted_at = coalesce(accepted_at, created_at)
  where opponent_user_id is not null
    and status = 'active';

create index if not exists idx_fritz_challenges_creator_pending_invite
  on public.fritz_challenges (creator_user_id, expires_at)
  where status in ('open', 'active') and opponent_user_id is not null;

create or replace function public.create_fritz_challenge_invite(
  p_creator_user_id uuid,
  p_recipient_user_id uuid,
  p_share_code text,
  p_seed text,
  p_fritz_tier text,
  p_deal_size int,
  p_winning_score int,
  p_rules_version int,
  p_fritz_policy_version int,
  p_verifier_version int,
  p_generator_version int,
  p_expires_at timestamptz
)
returns setof public.fritz_challenges
language plpgsql security definer set search_path = public as $$
declare
  created public.fritz_challenges%rowtype;
begin
  if p_creator_user_id = p_recipient_user_id then
    raise exception 'fritz_challenge_recipient_must_differ';
  end if;

  -- Serializes invite creation for a creator so they cannot open multiple
  -- concurrent sets and selectively share a favorable completed attempt.
  perform pg_advisory_xact_lock(hashtextextended(p_creator_user_id::text, 4815162342));

  if not exists (
    select 1 from public.friends
      where status = 'accepted'
        and (
          (user_id = p_creator_user_id and friend_user_id = p_recipient_user_id)
          or (user_id = p_recipient_user_id and friend_user_id = p_creator_user_id)
        )
  ) then
    raise exception 'fritz_challenge_recipient_not_friend';
  end if;

  if exists (
    select 1 from public.fritz_challenges
      where creator_user_id = p_creator_user_id
        and opponent_user_id is not null
        and status in ('open', 'active')
        and expires_at > now()
  ) then
    raise exception 'fritz_challenge_active_invite_exists';
  end if;

  insert into public.fritz_challenges (
    share_code, creator_user_id, opponent_user_id, invited_at,
    seed, format, fritz_tier, deal_size, winning_score,
    rules_version, fritz_policy_version, verifier_version, generator_version,
    status, expires_at
  ) values (
    p_share_code, p_creator_user_id, p_recipient_user_id, now(),
    p_seed, 'best_of_3', p_fritz_tier, p_deal_size, p_winning_score,
    p_rules_version, p_fritz_policy_version, p_verifier_version, p_generator_version,
    'open', p_expires_at
  ) returning * into created;

  return next created;
end;
$$;

revoke all on function public.create_fritz_challenge_invite(uuid, uuid, text, text, text, int, int, int, int, int, int, timestamptz) from public, authenticated;
grant execute on function public.create_fritz_challenge_invite(uuid, uuid, text, text, text, int, int, int, int, int, int, timestamptz) to service_role;

create or replace function public.claim_fritz_challenge_opponent(
  p_challenge_id uuid,
  p_user_id uuid
)
returns table (
  challenge_id uuid,
  opponent_user_id uuid,
  challenge_status text
)
language plpgsql security definer set search_path = public as $$
declare
  current_challenge public.fritz_challenges%rowtype;
begin
  select * into current_challenge from public.fritz_challenges
    where id = p_challenge_id for update;
  if not found or current_challenge.expires_at <= now() then
    if found then
      update public.fritz_challenges set status = 'expired'
        where id = p_challenge_id and status in ('open', 'active');
    end if;
    return;
  end if;

  -- New challenges are addressed to a specific player. A copied invite link
  -- never grants another account the opponent slot.
  if current_challenge.opponent_user_id is null
    or current_challenge.invited_at is null
    or current_challenge.creator_user_id = p_user_id
    or current_challenge.opponent_user_id <> p_user_id then
    return;
  end if;

  if current_challenge.status = 'open' then
    update public.fritz_challenges
      set status = 'active', accepted_at = coalesce(accepted_at, now())
      where id = p_challenge_id and status = 'open'
      returning * into current_challenge;
  elsif current_challenge.status <> 'active' then
    return;
  end if;

  return query select current_challenge.id, current_challenge.opponent_user_id, current_challenge.status;
end;
$$;

revoke all on function public.claim_fritz_challenge_opponent(uuid, uuid) from public, authenticated;
grant execute on function public.claim_fritz_challenge_opponent(uuid, uuid) to service_role;

create or replace function public.assert_fritz_challenge_attempt_invite()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  challenge public.fritz_challenges%rowtype;
begin
  select * into challenge from public.fritz_challenges where id = new.challenge_id;
  if not found or challenge.opponent_user_id is null or challenge.invited_at is null then
    raise exception 'fritz_challenge_invite_required';
  end if;
  if new.user_id = challenge.opponent_user_id and challenge.accepted_at is null then
    raise exception 'fritz_challenge_invite_not_accepted';
  end if;
  return new;
end;
$$;

drop trigger if exists require_fritz_challenge_attempt_invite on public.fritz_challenge_attempts;
create trigger require_fritz_challenge_attempt_invite
before insert on public.fritz_challenge_attempts
for each row execute function public.assert_fritz_challenge_attempt_invite();
