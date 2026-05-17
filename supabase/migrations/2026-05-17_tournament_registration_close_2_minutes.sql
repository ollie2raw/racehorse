-- Registration closes 2 minutes before scheduled_start (was 5 minutes).
-- Bracket lobby runs from registration_close_at through scheduled_start.

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
          (slot, slot - interval '30 minutes', slot - interval '2 minutes', 'upcoming')
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
  'Idempotently inserts 30-minute PST tournament slots from today through today + days_ahead. Registration opens 30 minutes before start and closes 2 minutes before start.';

update public.scheduled_tournaments
set registration_close_at = scheduled_start - interval '2 minutes'
where status in ('upcoming', 'registration_open')
  and scheduled_start > now();
