-- Tournament v2 preflight, piece F1 (read-only): does a pg_cron job re-seed v1 slots?
-- Works whether or not pg_cron is installed. Look at the NOTICE lines in the output.
do $$
declare
  r record;
  n integer := 0;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron is not installed: no database job seeds tournaments. Nothing to disable.';
    return;
  end if;
  for r in execute $q$
    select jobid, jobname, schedule, command, active
      from cron.job
     where command ilike '%tournament%' or jobname ilike '%tournament%'
  $q$ loop
    n := n + 1;
    raise notice 'cron job % "%" schedule "%" active=% command: %', r.jobid, r.jobname, r.schedule, r.active, r.command;
  end loop;
  if n = 0 then
    raise notice 'pg_cron is installed but no tournament job exists. Nothing to disable.';
  end if;
end $$;
