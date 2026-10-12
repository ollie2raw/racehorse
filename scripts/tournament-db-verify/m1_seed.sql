-- Fixtures for the M1 (tournament kind / Fritz Cup / overlap) section of
-- tournament-db-verify.sh. Throwaway DB only.

\set ON_ERROR_STOP on

insert into auth.users (id)
select ('cccccccc-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid
from generate_series(1, 30) g;

-- A Live Event open for registration, starting in 30 minutes.
insert into public.scheduled_tournaments (id, scheduled_start, registration_open_at, registration_close_at, status)
values ('66666666-6666-4666-8666-666666666666',
        date_trunc('minute', now()) + interval '30 min 7 s', now() - interval '10 min',
        date_trunc('minute', now()) + interval '28 min', 'registration_open');

-- A Live Event open for registration, starting in 5 hours (no overlap with now).
insert into public.scheduled_tournaments (id, scheduled_start, registration_open_at, registration_close_at, status)
values ('77777777-7777-4777-8777-777777777777',
        date_trunc('minute', now()) + interval '5 hours 7 s', now() - interval '10 min',
        date_trunc('minute', now()) + interval '298 min', 'registration_open');
