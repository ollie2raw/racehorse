-- EXPAND. Old code may still create unassigned runs while deployment drains.
-- Its direct report/finalization writes fail closed; the new server cancels
-- those runs and starts assigned replacements. Contract cleanup comes later.
begin;

alter table public.rush_runs
  add column if not exists assigned_puzzle_ids uuid[] null,
  add column if not exists completion_claimed_at timestamptz null,
  add column if not exists completion_client_score integer null;

alter table public.rush_runs
  add constraint rush_runs_assignment_size_check
  check (assigned_puzzle_ids is null or
    cardinality(assigned_puzzle_ids) between 1 and 15)
  not valid;

create or replace function public.enforce_rush_writer_v2()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('racehorse.rush_writer_v2', true) = 'on' then return new; end if;
  if tg_table_name = 'rush_run_puzzles' then
    raise exception 'rush_legacy_writer_fenced';
  end if;
  if new.status is distinct from old.status or
     new.total_score is distinct from old.total_score or
     new.puzzles_solved is distinct from old.puzzles_solved or
     new.assigned_puzzle_ids is distinct from old.assigned_puzzle_ids or
     new.completion_claimed_at is distinct from old.completion_claimed_at then
    raise exception 'rush_legacy_writer_fenced';
  end if;
  return new;
end $$;
drop trigger if exists rush_run_puzzles_writer_v2_gate on public.rush_run_puzzles;
create trigger rush_run_puzzles_writer_v2_gate before insert or update on public.rush_run_puzzles
  for each row execute function public.enforce_rush_writer_v2();
drop trigger if exists rush_runs_writer_v2_gate on public.rush_runs;
create trigger rush_runs_writer_v2_gate before update on public.rush_runs
  for each row execute function public.enforce_rush_writer_v2();
revoke execute on function public.enforce_rush_writer_v2() from public,anon,authenticated;

-- Lock the run row for every report. A completion claim takes the same lock,
-- so no report can become visible after the frozen result set is chosen.
create or replace function public.record_rush_report_v2(
  p_run_id uuid, p_user_id uuid, p_puzzle_id uuid, p_ordinal integer,
  p_client_raw_score integer, p_submitted_line jsonb, p_stage_reached_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_run public.rush_runs%rowtype; v_row public.rush_run_puzzles%rowtype;
begin
  perform set_config('racehorse.rush_writer_v2', 'on', true);
  select * into v_run from public.rush_runs
   where id = p_run_id and user_id = p_user_id for update;
  if not found then raise exception 'rush_run_not_found'; end if;
  if v_run.status <> 'in_progress' or v_run.completion_claimed_at is not null then
    raise exception 'rush_run_closed';
  end if;
  if p_ordinal < 1 or p_ordinal > coalesce(cardinality(v_run.assigned_puzzle_ids), 0)
     or v_run.assigned_puzzle_ids[p_ordinal] is distinct from p_puzzle_id then
    raise exception 'rush_assignment_mismatch';
  end if;
  insert into public.rush_run_puzzles
    (run_id,puzzle_id,ordinal,client_raw_score,submitted_line,stage_reached_key)
  values (p_run_id,p_puzzle_id,p_ordinal,greatest(0,p_client_raw_score),p_submitted_line,p_stage_reached_key)
  on conflict (run_id,ordinal) do nothing returning * into v_row;
  if not found then
    select * into v_row from public.rush_run_puzzles
     where run_id = p_run_id and ordinal = p_ordinal;
    if v_row.puzzle_id <> p_puzzle_id or v_row.submitted_line <> p_submitted_line then
      raise exception 'rush_duplicate_ordinal';
    end if;
  end if;
  return to_jsonb(v_row);
end $$;

create or replace function public.claim_rush_completion_v2(
  p_run_id uuid, p_user_id uuid, p_client_reported_score integer
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_run public.rush_runs%rowtype;
begin
  perform set_config('racehorse.rush_writer_v2', 'on', true);
  select * into v_run from public.rush_runs
   where id = p_run_id and user_id = p_user_id for update;
  if not found then raise exception 'rush_run_not_found'; end if;
  if v_run.status <> 'in_progress' then
    return jsonb_build_object('outcome','already_completed','run',to_jsonb(v_run));
  end if;
  if v_run.assigned_puzzle_ids is null then raise exception 'rush_assignment_missing'; end if;
  if v_run.completion_claimed_at is null then
    update public.rush_runs
       set completion_claimed_at = now(),
           completion_client_score = greatest(0,p_client_reported_score), updated_at = now()
     where id = p_run_id returning * into v_run;
    return jsonb_build_object('outcome','claimed','run',to_jsonb(v_run));
  end if;
  return jsonb_build_object('outcome','resuming','run',to_jsonb(v_run));
end $$;

create or replace function public.finalize_rush_run_v2(
  p_run_id uuid, p_user_id uuid, p_status text,
  p_total_score integer, p_puzzles_solved integer,
  p_invalidated_reason text, p_graded_puzzles jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_run public.rush_runs%rowtype; v_grade jsonb; v_ordinal integer;
begin
  perform set_config('racehorse.rush_writer_v2', 'on', true);
  select * into v_run from public.rush_runs
   where id = p_run_id and user_id = p_user_id for update;
  if not found then raise exception 'rush_run_not_found'; end if;
  if v_run.status <> 'in_progress' then
    return jsonb_build_object('outcome','already_completed','run',to_jsonb(v_run));
  end if;
  if v_run.completion_claimed_at is null then raise exception 'rush_completion_not_claimed'; end if;
  if p_status not in ('completed','invalidated') or p_total_score < 0 or p_puzzles_solved < 0
     or jsonb_typeof(p_graded_puzzles) <> 'array' then
    raise exception 'rush_invalid_grade';
  end if;
  for v_grade in select value from jsonb_array_elements(p_graded_puzzles) loop
    v_ordinal := (v_grade->>'ordinal')::integer;
    if v_ordinal < 1 or v_ordinal > cardinality(v_run.assigned_puzzle_ids)
       or v_run.assigned_puzzle_ids[v_ordinal]::text <> v_grade->>'puzzleId' then
      raise exception 'rush_assignment_mismatch';
    end if;
    update public.rush_run_puzzles
       set raw_score = (v_grade->>'rawScore')::integer,
           awarded_points = (v_grade->>'awardedPoints')::integer,
           solved = (v_grade->>'solved')::boolean,
           perfect = (v_grade->>'perfect')::boolean,
           moves_used = (v_grade->>'movesUsed')::integer,
           bonus_seconds = (v_grade->>'bonusSeconds')::integer,
           submitted_line = v_grade->'submittedLine',
           graded_at = now(), grading_error = v_grade->>'gradingError'
     where run_id = p_run_id and ordinal = v_ordinal;
    if not found then raise exception 'rush_report_missing'; end if;
  end loop;
  update public.rush_runs
     set status = p_status, ended_at = completion_claimed_at,
         total_score = p_total_score, puzzles_solved = p_puzzles_solved,
         client_reported_score = completion_client_score,
         invalidated_reason = p_invalidated_reason, updated_at = now()
   where id = p_run_id returning * into v_run;
  return jsonb_build_object('outcome','applied','run',to_jsonb(v_run));
end $$;

-- Do not reconstruct an assignment that the old server never stored.
create or replace function public.invalidate_unassigned_rush_run_v2(
  p_run_id uuid, p_user_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_run public.rush_runs%rowtype; v_invalidated boolean := false;
begin
  perform set_config('racehorse.rush_writer_v2', 'on', true);
  select * into v_run from public.rush_runs
   where id = p_run_id and user_id = p_user_id for update;
  if not found then raise exception 'rush_run_not_found'; end if;
  if v_run.status = 'in_progress' and v_run.assigned_puzzle_ids is null then
    update public.rush_runs
       set status = 'invalidated', ended_at = now(),
           is_official = false, invalidated_reason = 'assignment_not_recorded',
           updated_at = now()
     where id = p_run_id returning * into v_run;
    v_invalidated := true;
  end if;
  return jsonb_build_object('invalidated',v_invalidated,'run',to_jsonb(v_run));
end $$;

revoke all on function public.record_rush_report_v2(uuid,uuid,uuid,integer,integer,jsonb,text) from public,anon,authenticated;
revoke all on function public.claim_rush_completion_v2(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.finalize_rush_run_v2(uuid,uuid,text,integer,integer,text,jsonb) from public,anon,authenticated;
revoke all on function public.invalidate_unassigned_rush_run_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function public.record_rush_report_v2(uuid,uuid,uuid,integer,integer,jsonb,text) to service_role;
grant execute on function public.claim_rush_completion_v2(uuid,uuid,integer) to service_role;
grant execute on function public.finalize_rush_run_v2(uuid,uuid,text,integer,integer,text,jsonb) to service_role;
grant execute on function public.invalidate_unassigned_rush_run_v2(uuid,uuid) to service_role;

commit;
