-- Move scheduled tournaments from 2-hour cadence to 30-minute cadence.
-- This is the forward migration that affects already-deployed environments.

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

  if future_count < 1440 then
    inserted := public.seed_future_tournaments(30);
  end if;

  return inserted;
end;
$$;

comment on function public.ensure_tournament_seed_window() is
  'Tops up tournament slots if fewer than 1440 future rows exist. Safe to call repeatedly.';

-- Immediate backfill so the next 7 days show 30-minute cadence right away.
select public.seed_future_tournaments(7);
