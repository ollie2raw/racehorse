-- CONTRACT. Apply only after the old Puzzle Rush writer is confirmed gone.
-- A legacy run has no trustworthy served assignment, so close it without a
-- result and free its official slot before requiring assignment on new runs.
begin;

select set_config('racehorse.rush_writer_v2', 'on', true);

update public.rush_runs
   set status = 'invalidated', ended_at = now(), is_official = false,
       invalidated_reason = 'assignment_not_recorded', updated_at = now()
 where status = 'in_progress' and assigned_puzzle_ids is null;

alter table public.rush_runs
  add constraint rush_runs_open_assignment_required
  check (status <> 'in_progress' or assigned_puzzle_ids is not null)
  not valid;
alter table public.rush_runs validate constraint rush_runs_open_assignment_required;
alter table public.rush_runs validate constraint rush_runs_assignment_size_check;

commit;
