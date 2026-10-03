-- Jobs created after the migration (the new server's jobs).
insert into public.review_completion_jobs
  (id, user_id, game_digest, source_match_id, status, job_payload, claim_token,
   claim_generation, lease_expires_at, next_attempt_at)
values
  ('due-paused',  null, 'd1', 'm', 'pending', '{}', null,      0, null,                          now() - interval '1 second'),
  ('live-lease',  null, 'd2', 'm', 'running', '{}', 'tok-live', 1, now() + interval '45 seconds', now() - interval '1 second'),
  ('fresh',       null, 'd3', 'm', 'pending', '{}', null,      0, null,                          now() - interval '1 second'),
  ('backoff-cap', null, 'd4', 'm', 'pending', '{}', null,      0, null,                          now() - interval '1 second'),
  ('renew',       null, 'd5', 'm', 'pending', '{}', null,      0, null,                          now() - interval '1 second'),
  ('race',        null, 'd6', 'm', 'pending', '{}', null,      0, null,                          now() - interval '1 second'),
  ('stale',       null, 'd7', 'm', 'pending', '{}', null,      0, null,                          now() - interval '1 second');
