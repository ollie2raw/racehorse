-- Fixtures for the Phase 1 sections of tournament-db-verify.sh (registration
-- RPCs and bracket repair). Throwaway DB only.

\set ON_ERROR_STOP on

insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),
  ('aaaaaaaa-0000-4000-8000-000000000002'),
  ('aaaaaaaa-0000-4000-8000-000000000003');

-- Open, 2 seats, closes in 10 minutes.
insert into public.scheduled_tournaments (id, scheduled_start, registration_open_at, registration_close_at, status, max_players)
values ('22222222-2222-4222-8222-222222222222', now() + interval '12 min', now() - interval '18 min', now() + interval '10 min', 'registration_open', 2);

-- Status still registration_open (the scheduler has not ticked yet) but the
-- close time has passed: the database clock must refuse.
insert into public.scheduled_tournaments (id, scheduled_start, registration_open_at, registration_close_at, status)
values ('33333333-3333-4333-8333-333333333333', now() + interval '1 min', now() - interval '29 min', now() - interval '1 min', 'registration_open');

-- What the old insert-by-insert path left after a crash: 4 unplayed QF rows,
-- tournament still registration_open, registrations still 'registered'.
insert into public.scheduled_tournaments (id, scheduled_start, registration_open_at, registration_close_at, status)
values ('44444444-4444-4444-8444-444444444444', now() + interval '1 min', now() - interval '29 min', now() - interval '1 min', 'registration_open');
insert into public.scheduled_tournament_registrations (tournament_id, user_id) values
  ('44444444-4444-4444-8444-444444444444', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('44444444-4444-4444-8444-444444444444', 'aaaaaaaa-0000-4000-8000-000000000002');
insert into public.scheduled_tournament_matches (tournament_id, round, match_number, player1_id, player2_id, room_code, status)
select '44444444-4444-4444-8444-444444444444', 1, g, 'aaaaaaaa-0000-4000-8000-000000000001', 'bot:fritz:stale:' || g, 'stale', 'waiting'
from generate_series(1, 4) g;

-- Partial state that includes a completed match: must never be overwritten.
insert into public.scheduled_tournaments (id, scheduled_start, registration_open_at, registration_close_at, status)
values ('55555555-5555-4555-8555-555555555555', now() + interval '1 min', now() - interval '29 min', now() - interval '1 min', 'registration_open');
insert into public.scheduled_tournament_registrations (tournament_id, user_id)
values ('55555555-5555-4555-8555-555555555555', 'aaaaaaaa-0000-4000-8000-000000000003');
insert into public.scheduled_tournament_matches (tournament_id, round, match_number, player1_id, player2_id, winner_id, room_code, status)
values ('55555555-5555-4555-8555-555555555555', 1, 1, 'aaaaaaaa-0000-4000-8000-000000000003', 'bot:fritz:played:1', 'aaaaaaaa-0000-4000-8000-000000000003', 'played', 'completed');
