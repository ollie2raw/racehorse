-- Auto-reseed scheduled tournaments so the table always carries ≥ 30 future days.
--
-- - `seed_future_tournaments(days_ahead)` inserts every-30-minute PST slots from
--   today through today + days_ahead. Idempotent via ON CONFLICT.
-- - `ensure_tournament_seed_window()` checks future-slot count and tops up if low.
-- - Optional pg_cron job runs `ensure_tournament_seed_window` daily at 03:00.
-- - Server-side scheduler also fires the RPC every 24h as a fallback for
--   deployments where pg_cron isn't enabled.

-- ── seed_future_tournaments ──────────────────────────────────────────────────

create or replace function public.seed_future_tournaments(days_ahead integer default 30)
returns integer
language plpgsql
as $$
declare
  inserted_count integer := 0;
  d date;
  end_d date;
  hh integer;
  mm integer;
  slot timestamptz;
begin
  -- Today's date in America/Los_Angeles (DST-aware).
  d := (now() at time zone 'America/Los_Angeles')::date;
  end_d := d + days_ahead;

  while d < end_d loop
    for hh in 0..23 loop
      foreach mm in array array[0, 30] loop
        slot := (
          d::text || ' ' ||
          lpad(hh::text, 2, '0') || ':' ||
          lpad(mm::text, 2, '0') || ':00'
        )::timestamp at time zone 'America/Los_Angeles';

        insert into public.scheduled_tournaments
          (scheduled_start, registration_open_at, registration_close_at, status)
        values
          (slot, slot - interval '30 minutes', slot - interval '5 minutes', 'upcoming')
        on conflict (scheduled_start) do nothing;

        -- FOUND is true only when the INSERT actually wrote a row (ON CONFLICT
        -- DO NOTHING with a conflict produces zero rows affected).
        if found then
          inserted_count := inserted_count + 1;
        end if;
      end loop;
    end loop;
    d := d + 1;
  end loop;

  return inserted_count;
end;
$$;

comment on function public.seed_future_tournaments(integer) is
  'Idempotently inserts 30-minute PST tournament slots from today through today + days_ahead. Returns the number of new rows inserted.';

-- ── ensure_tournament_seed_window ────────────────────────────────────────────

create or replace function public.ensure_tournament_seed_window()
returns integer
language plpgsql
as $$
declare
  future_count integer;
  inserted integer := 0;
begin
  select count(*) into future_count
    from public.scheduled_tournaments
   where scheduled_start > now();

  -- 1440 = 48 slots/day × 30 days. If we've dipped below that, top up.
  if future_count < 1440 then
    inserted := public.seed_future_tournaments(30);
  end if;

  return inserted;
end;
$$;

comment on function public.ensure_tournament_seed_window() is
  'Tops up tournament slots if fewer than 1440 future rows exist. Safe to call repeatedly.';

-- ── Run once now so the migration immediately tops up the window ─────────────
select public.ensure_tournament_seed_window();

-- ── Optional: pg_cron daily job ──────────────────────────────────────────────
-- Only registers if pg_cron is installed. On Supabase Free this is usually not
-- enabled; on Pro/team it is. The server-side scheduler covers both cases.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Unschedule any prior version of this job so the migration is idempotent.
    perform cron.unschedule(jobid)
      from cron.job
     where jobname = 'seed-tournaments-daily';

    perform cron.schedule(
      'seed-tournaments-daily',
      '0 3 * * *',
      $cron$select public.ensure_tournament_seed_window();$cron$
    );

    raise notice 'pg_cron job "seed-tournaments-daily" scheduled at 03:00 daily.';
  else
    raise notice 'pg_cron not installed — relying on the server-side fallback scheduler.';
  end if;
end $$;
