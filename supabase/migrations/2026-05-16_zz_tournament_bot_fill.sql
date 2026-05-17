do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.scheduled_tournament_matches'::regclass
      and contype = 'f'
      and conkey && array[
        (
          select attnum
          from pg_attribute
          where attrelid = 'public.scheduled_tournament_matches'::regclass
            and attname = 'player1_id'
        ),
        (
          select attnum
          from pg_attribute
          where attrelid = 'public.scheduled_tournament_matches'::regclass
            and attname = 'player2_id'
        ),
        (
          select attnum
          from pg_attribute
          where attrelid = 'public.scheduled_tournament_matches'::regclass
            and attname = 'winner_id'
        )
      ]
  loop
    execute format('alter table public.scheduled_tournament_matches drop constraint if exists %I', constraint_name);
  end loop;
end $$;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.scheduled_tournament_matches'::regclass
      and contype = 'f'
      and conkey && array[
        (
          select attnum
          from pg_attribute
          where attrelid = 'public.scheduled_tournament_matches'::regclass
            and attname = 'forfeit_user_id'
        ),
        (
          select attnum
          from pg_attribute
          where attrelid = 'public.scheduled_tournament_matches'::regclass
            and attname = 'no_show_user_id'
        )
      ]
  loop
    execute format('alter table public.scheduled_tournament_matches drop constraint if exists %I', constraint_name);
  end loop;
end $$;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.scheduled_tournaments'::regclass
      and contype = 'f'
      and conkey && array[
        (
          select attnum
          from pg_attribute
          where attrelid = 'public.scheduled_tournaments'::regclass
            and attname = 'winner_id'
        )
      ]
  loop
    execute format('alter table public.scheduled_tournaments drop constraint if exists %I', constraint_name);
  end loop;
end $$;

alter table public.scheduled_tournament_matches
  alter column player1_id type text using player1_id::text,
  alter column player2_id type text using player2_id::text,
  alter column winner_id type text using winner_id::text,
  alter column forfeit_user_id type text using forfeit_user_id::text,
  alter column no_show_user_id type text using no_show_user_id::text,
  add column if not exists bot_tier text
    check (bot_tier in ('standard', 'elite', 'master'));

alter table public.scheduled_tournaments
  alter column winner_id type text using winner_id::text;
