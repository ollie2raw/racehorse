-- Tournament v2 preflight, piece E1 (read-only preview; also the after-check: expect 0 in the first two columns after E2). NOT RUN. See docs/ops/tournament-v2-preflight.md §3.

-- ── E1. Preview (read-only). Note the four numbers. ─────────────────────────
select
  (select count(*) from public.scheduled_tournaments t
    where t.status in ('upcoming', 'registration_open'))                         as v1_unstarted_events,
  (select count(*) from public.scheduled_tournaments t
    where t.status in ('upcoming', 'registration_open')
      and (exists (select 1 from public.scheduled_tournament_registrations r where r.tournament_id = t.id)
        or exists (select 1 from public.scheduled_tournament_matches m where m.tournament_id = t.id)))
                                                                                  as unstarted_with_children,
  (select count(*) from public.scheduled_tournament_matches m
     join public.scheduled_tournaments t on t.id = m.tournament_id
    where t.status = 'cancelled' and m.status in ('waiting', 'ready', 'in_progress')) as open_matches_in_cancelled,
  (select count(*) from public.scheduled_tournament_registrations r
     join public.scheduled_tournaments t on t.id = r.tournament_id
    where t.status = 'cancelled' and r.status in ('registered', 'active'))           as live_regs_in_cancelled;
-- 2026-10-04 21:00 UTC (read-only REST counts): v1_unstarted_events = 1,403
-- (1,402 upcoming + 1 registration_open), unstarted_with_children = 0,
-- open_matches_in_cancelled = 28, live_regs_in_cancelled = 19.
