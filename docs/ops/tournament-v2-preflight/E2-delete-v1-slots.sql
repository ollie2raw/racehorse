-- Tournament v2 preflight, piece E2 (writes: deletes unstarted v1 slots that have no children; aborts otherwise). NOT RUN. See docs/ops/tournament-v2-preflight.md §3.

-- ── E2. Delete the never-used v1 slots. Recommended. ───────────────────────
-- They are generated rows (48 a day) with no registrations, matches or history.
-- Deleting rather than cancelling keeps 1,400 empty rows out of every list
-- query and frees scheduled_start values for v2 events (v1 has a unique
-- constraint on scheduled_start). Rows with any registration or match are
-- never touched: the guard aborts instead.
begin;
do $$
declare
  v_children integer;
  v_deleted  integer;
begin
  select count(*) into v_children
    from public.scheduled_tournaments t
   where t.status in ('upcoming', 'registration_open')
     and (exists (select 1 from public.scheduled_tournament_registrations r where r.tournament_id = t.id)
       or exists (select 1 from public.scheduled_tournament_matches m where m.tournament_id = t.id));
  if v_children > 0 then
    raise exception 'abort: % unstarted event(s) have registrations or matches; not deleting', v_children;
  end if;

  delete from public.scheduled_tournaments t
   where t.status in ('upcoming', 'registration_open')
     and not exists (select 1 from public.scheduled_tournament_registrations r where r.tournament_id = t.id)
     and not exists (select 1 from public.scheduled_tournament_matches m where m.tournament_id = t.id);
  get diagnostics v_deleted = row_count;
  raise notice 'deleted % v1 slot(s)', v_deleted;
end $$;
commit;

-- E2 alternative (if you'd rather keep the rows): cancel instead of delete.
-- update public.scheduled_tournaments
--    set status = 'cancelled', cancel_reason = 'retired_v1_schedule'
--  where status in ('upcoming', 'registration_open');
-- Note: v2's scheduler must then not reuse those scheduled_start values while
-- the v1 unique (scheduled_start) constraint exists (Phase 1 replaces it).
