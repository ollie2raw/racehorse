-- Player reporting and blocking (App Store Guideline 1.2 minimum moderation).
--
-- Both tables are server-owned: RLS on, no policies, and no client grants, so
-- only the game server's service role can read or write them. Clients go
-- through /api/moderation/* (server/src/moderation/routes.ts), which takes the
-- reporter / blocker id from the verified bearer token — a client cannot spoof
-- it and cannot read anyone's reports.
--
-- Every user FK cascades from auth.users (Guardrail #6,
-- supabase/cascade-delete-allowlist.json): deleting an account removes the
-- reports it filed, reports about it, and both sides of its blocks.
--
-- Reports hold no free text and no email: a fixed category and the app
-- surface it came from.
--
-- Friend requests are created by the client directly in public.friends (RLS
-- friends_insert_own), not only through the server, so the block rule for
-- them lives here: a trigger refuses a request or acceptance between a
-- blocked pair, whichever path wrote it.
--
-- NOT YET APPLIED TO PRODUCTION. Apply to dev first; production is an owner
-- step after review.

create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  reported_user_id uuid not null references auth.users(id) on delete cascade,
  category text not null
    check (category in ('inappropriate_username', 'harassment', 'cheating', 'other')),
  source text not null
    check (source in ('profile', 'live_match')),
  created_at timestamptz not null default now(),
  constraint user_reports_not_self check (reporter_user_id <> reported_user_id),
  -- One row per reporter, target and category: repeating a report is a no-op,
  -- so one person can't inflate the count against someone.
  constraint user_reports_once_per_category unique (reporter_user_id, reported_user_id, category)
);

create index if not exists user_reports_reported_created_idx
  on public.user_reports (reported_user_id, created_at desc);
create index if not exists user_reports_reporter_created_idx
  on public.user_reports (reporter_user_id, created_at desc);

create table if not exists public.user_blocks (
  blocker_user_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  constraint user_blocks_not_self check (blocker_user_id <> blocked_user_id)
);

create index if not exists user_blocks_blocked_idx
  on public.user_blocks (blocked_user_id);

alter table public.user_reports enable row level security;
alter table public.user_blocks enable row level security;

revoke all on table public.user_reports from anon, authenticated, public;
revoke all on table public.user_blocks from anon, authenticated, public;
grant select, insert, update, delete on table public.user_reports to service_role;
grant select, insert, update, delete on table public.user_blocks to service_role;

comment on table public.user_reports is
  'Player reports (fixed categories, no free text). Service role only; reviewed by the owner.';
comment on table public.user_blocks is
  'Player blocks. Service role only; enforced by the game server for friends, invites, Quick Match and private rooms.';

-- Friend requests / acceptances never cross a block, in either direction.
-- SECURITY DEFINER so it can read user_blocks (which clients cannot); it only
-- runs as a trigger. The error code is deliberately neutral.
create or replace function public.friends_refuse_blocked_pair()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and not (new.status = 'accepted' and old.status is distinct from 'accepted') then
    return new;
  end if;
  if exists (
    select 1 from public.user_blocks b
     where (b.blocker_user_id = new.user_id and b.blocked_user_id = new.friend_user_id)
        or (b.blocker_user_id = new.friend_user_id and b.blocked_user_id = new.user_id)
  ) then
    raise exception 'friend_request_unavailable' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.friends_refuse_blocked_pair() from public, anon, authenticated;

drop trigger if exists friends_refuse_blocked_pair on public.friends;
create trigger friends_refuse_blocked_pair
  before insert or update of status on public.friends
  for each row execute procedure public.friends_refuse_blocked_pair();

