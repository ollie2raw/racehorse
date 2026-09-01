-- Seed a full 8-player bracket for the two-session FOR UPDATE test.
-- Runs against the throwaway DB only.

\set ON_ERROR_STOP on

insert into auth.users (id)
select ('00000000-0000-4000-8000-00000000000' || g)::uuid
from generate_series(1, 8) g;

insert into public.scheduled_tournaments (id, scheduled_start, registration_open_at, registration_close_at, status)
values (
  '11111111-1111-4111-8111-111111111111',
  now() - interval '5 min', now() - interval '35 min', now() - interval '7 min',
  'registration_open'
);

insert into public.scheduled_tournament_registrations (tournament_id, user_id)
select '11111111-1111-4111-8111-111111111111',
       ('00000000-0000-4000-8000-00000000000' || g)::uuid
from generate_series(1, 8) g;

-- generate the bracket (QF1..4 waiting, SF1/2 + Final waiting, tournament -> in_progress)
select public.generate_tournament_bracket(
  '11111111-1111-4111-8111-111111111111',
  jsonb_build_array(
    jsonb_build_object('match_number', 1, 'player1_id', '00000000-0000-4000-8000-000000000001', 'player2_id', '00000000-0000-4000-8000-000000000008'),
    jsonb_build_object('match_number', 2, 'player1_id', '00000000-0000-4000-8000-000000000004', 'player2_id', '00000000-0000-4000-8000-000000000005'),
    jsonb_build_object('match_number', 3, 'player1_id', '00000000-0000-4000-8000-000000000003', 'player2_id', '00000000-0000-4000-8000-000000000006'),
    jsonb_build_object('match_number', 4, 'player1_id', '00000000-0000-4000-8000-000000000002', 'player2_id', '00000000-0000-4000-8000-000000000007')
  ),
  jsonb_build_array(
    jsonb_build_object('user_id', '00000000-0000-4000-8000-000000000001', 'seed', 1),
    jsonb_build_object('user_id', '00000000-0000-4000-8000-000000000008', 'seed', 8),
    jsonb_build_object('user_id', '00000000-0000-4000-8000-000000000004', 'seed', 4),
    jsonb_build_object('user_id', '00000000-0000-4000-8000-000000000005', 'seed', 5),
    jsonb_build_object('user_id', '00000000-0000-4000-8000-000000000003', 'seed', 3),
    jsonb_build_object('user_id', '00000000-0000-4000-8000-000000000006', 'seed', 6),
    jsonb_build_object('user_id', '00000000-0000-4000-8000-000000000002', 'seed', 2),
    jsonb_build_object('user_id', '00000000-0000-4000-8000-000000000007', 'seed', 7)
  ),
  'db-verify'
);

-- drive QF1 (round 1, match 1) to in_progress so a game_over completion is valid
select public.promote_tournament_match(id, 'ready', now(), now() + interval '2 min', 'QFONE', null, 'db-verify')
from public.scheduled_tournament_matches
where tournament_id = '11111111-1111-4111-8111-111111111111' and round = 1 and match_number = 1;

select public.promote_tournament_match(id, 'in_progress', null, null, null, now(), 'db-verify')
from public.scheduled_tournament_matches
where tournament_id = '11111111-1111-4111-8111-111111111111' and round = 1 and match_number = 1;
