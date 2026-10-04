-- Tournament v2 preflight, piece F2 (writes; reversible). Run ONLY if F1 printed
-- the "seed-tournaments-daily" job with active=true.
-- Undo: update cron.job set active = true where jobname = 'seed-tournaments-daily';
-- Phase 1 drops the v1 seed functions; after that migration, remove the job
-- for good with: select cron.unschedule('seed-tournaments-daily');
update cron.job set active = false where jobname = 'seed-tournaments-daily';
select jobname, active from cron.job where jobname = 'seed-tournaments-daily';
