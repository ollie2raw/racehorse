-- Correct the outbox idempotency scope installed on 2026-08-01.
-- Operation IDs such as hand:1:0 intentionally repeat across players, so
-- challenge-level uniqueness suppressed every player's event after the first.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.daily_fritz_outbox'::regclass
      and conname = 'daily_fritz_outbox_attempt_operation_event_key'
  ) then
    alter table public.daily_fritz_outbox
      add constraint daily_fritz_outbox_attempt_operation_event_key
      unique (attempt_id, operation_id, event_type);
  end if;
end;
$$;

do $$
declare
  routine record;
  definition text;
  old_conflict_target constant text :=
    'on conflict (challenge_id, operation_id, event_type) do nothing';
  new_conflict_target constant text :=
    'on conflict (attempt_id, operation_id, event_type) do nothing';
begin
  for routine in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'start_daily_fritz_attempt_command',
        'commit_daily_fritz_attempt_command'
      )
  loop
    definition := pg_get_functiondef(routine.oid);
    if position(old_conflict_target in definition) = 0 then
      raise exception 'daily_fritz_outbox_conflict_target_not_found:%', routine.proname;
    end if;
    execute replace(definition, old_conflict_target, new_conflict_target);
  end loop;
end;
$$;

do $$
declare
  legacy_constraint text;
begin
  select c.conname into legacy_constraint
  from pg_constraint c
  where c.conrelid = 'public.daily_fritz_outbox'::regclass
    and c.contype = 'u'
    and (
      select array_agg(a.attname order by key.ordinality)
      from unnest(c.conkey) with ordinality as key(attnum, ordinality)
      join pg_attribute a
        on a.attrelid = c.conrelid and a.attnum = key.attnum
    ) = array['challenge_id', 'operation_id', 'event_type']::name[]
  limit 1;

  if legacy_constraint is not null then
    execute format(
      'alter table public.daily_fritz_outbox drop constraint %I',
      legacy_constraint
    );
  end if;
end;
$$;

-- Repair analytics for any commands committed while the global challenge key
-- was active. The insert trigger projects these rows into canonical events.
insert into public.daily_fritz_outbox (
  attempt_id,
  challenge_id,
  operation_id,
  event_type,
  payload,
  occurred_at
)
select
  operation.attempt_id,
  operation.challenge_id,
  operation.operation_id,
  case operation.command_type
    when 'start_attempt' then
      case when coalesce((operation.response->>'created')::boolean, false)
        then 'attempt_started' else 'attempt_resumed' end
    when 'accept_verified_hand' then 'hand_verified'
    when 'record_verified_game' then 'game_recorded'
    when 'finalize_verified_attempt' then 'attempt_completed'
    when 'abandon_attempt' then 'attempt_abandoned'
  end,
  jsonb_strip_nulls(jsonb_build_object(
    'revision', operation.committed_revision,
    'gameNumber', case
      when operation.operation_id ~ '^(hand|game):[1-3]:'
        then split_part(operation.operation_id, ':', 2)::int
      else null
    end,
    'handIndex', case
      when operation.operation_id ~ '^hand:[1-3]:[0-9]+$'
        then split_part(operation.operation_id, ':', 3)::int
      else null
    end,
    'backfilled', true
  )),
  coalesce(operation.committed_at, operation.created_at)
from public.daily_fritz_attempt_operations operation
where operation.status = 'committed'
  and not exists (
    select 1
    from public.daily_fritz_outbox existing
    where existing.attempt_id = operation.attempt_id
      and existing.operation_id = operation.operation_id
      and existing.event_type = case operation.command_type
        when 'start_attempt' then
          case when coalesce((operation.response->>'created')::boolean, false)
            then 'attempt_started' else 'attempt_resumed' end
        when 'accept_verified_hand' then 'hand_verified'
        when 'record_verified_game' then 'game_recorded'
        when 'finalize_verified_attempt' then 'attempt_completed'
        when 'abandon_attempt' then 'attempt_abandoned'
      end
  )
on conflict (attempt_id, operation_id, event_type) do nothing;
