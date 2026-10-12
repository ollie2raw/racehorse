-- Production SMOKE for the moderation migrations. Runs inside a transaction
-- that ROLLS BACK: nothing is kept. Uses two existing profiles only as FK
-- targets for throwaway rows; no auth users are created and no usernames are
-- changed. Any failed expectation raises and aborts.

begin;

do $$
declare
  a uuid;
  b uuid;
begin
  select id into a from public.profiles order by created_at limit 1;
  select id into b from public.profiles where id <> a order by created_at limit 1;
  if a is null or b is null then raise exception 'need two existing profiles'; end if;

  -- Username policy: reserved rejected, ordinary accepted.
  if public.username_policy_violation('racehorse_support') is distinct from 'reserved' then
    raise exception 'reserved name not rejected';
  end if;
  if public.username_policy_violation('domino_king') is not null then
    raise exception 'ordinary name rejected';
  end if;

  -- Report and block between two real accounts.
  insert into public.user_reports (reporter_user_id, reported_user_id, category, source)
  values (a, b, 'other', 'profile');
  insert into public.user_blocks (blocker_user_id, blocked_user_id) values (a, b);

  -- Self-report and self-block are refused.
  begin
    insert into public.user_reports (reporter_user_id, reported_user_id, category, source)
    values (a, a, 'other', 'profile');
    raise exception 'self-report allowed';
  exception when check_violation then null;
  end;
  begin
    insert into public.user_blocks (blocker_user_id, blocked_user_id) values (b, b);
    raise exception 'self-block allowed';
  exception when check_violation then null;
  end;

  -- A friend request across the block is refused.
  begin
    insert into public.friends (user_id, friend_user_id, status) values (b, a, 'pending');
    raise exception 'friend request across a block allowed';
  exception when insufficient_privilege then
    if sqlerrm <> 'friend_request_unavailable' then raise; end if;
  end;
end $$;

select 'moderation smoke passed (rolling back)' as result;

rollback;
