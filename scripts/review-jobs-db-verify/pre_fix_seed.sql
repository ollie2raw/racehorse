-- Jobs left by the pre-isolation server, inserted before the 2026-10-01
-- migration is applied. created_at is in the past so they fall before the
-- apply-time cutoff.
insert into public.review_completion_jobs
  (id, user_id, game_digest, source_match_id, status, job_payload, claim_token,
   claim_generation, lease_expires_at, next_attempt_at, created_at, updated_at, completed_at)
values
  ('prefix-pending',   null, 'd-pending',   'm', 'pending', '{}', null,        0,  null,                         now() - interval '1 minute', now() - interval '2 hours', now() - interval '2 hours', null),
  ('prefix-running-a', null, 'd-running-a', 'm', 'running', '{}', 'sweep-85-1', 7, now() - interval '30 minutes', now() + interval '7 days',    now() - interval '2 hours', now() - interval '1 hour',  null),
  ('prefix-running-b', null, 'd-running-b', 'm', 'running', '{}', 'sweep-85-2', 14, now() + interval '30 seconds', now() + interval '30 seconds', now() - interval '1 day',  now(),                       null),
  ('prefix-complete',  null, 'd-complete',  'm', 'complete', '{}', null,       3,  null,                         now() - interval '1 hour',   now() - interval '3 hours', now() - interval '3 hours', now() - interval '3 hours');
