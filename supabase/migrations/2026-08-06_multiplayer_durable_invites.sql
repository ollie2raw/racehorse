-- Durable private-match invitations. Socket delivery is an optimization;
-- this row is the source of truth across offline recipients and restarts.
create table if not exists public.multiplayer_invites (
  invite_id text primary key check (char_length(invite_id) between 1 and 128),
  sender_user_id uuid not null,
  recipient_user_id uuid not null,
  room_code text not null,
  inviter_username text not null check (char_length(inviter_username) between 1 and 80),
  invite_url text not null check (char_length(invite_url) <= 2048),
  match_summary text not null check (char_length(match_summary) between 1 and 160),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  delivered_at timestamptz null,
  resolved_at timestamptz null,
  check (sender_user_id <> recipient_user_id),
  check (expires_at > created_at)
);

create unique index if not exists uq_multiplayer_invites_pending_pair_room
  on public.multiplayer_invites (sender_user_id, recipient_user_id, room_code)
  where status = 'pending';
create index if not exists idx_multiplayer_invites_recipient_pending
  on public.multiplayer_invites (recipient_user_id, expires_at)
  where status = 'pending';

alter table public.multiplayer_invites enable row level security;
drop policy if exists "multiplayer_invites_no_client_access" on public.multiplayer_invites;
create policy "multiplayer_invites_no_client_access"
  on public.multiplayer_invites for all to authenticated using (false) with check (false);

create or replace function public.create_multiplayer_invite(
  p_invite_id text,
  p_sender_user_id uuid,
  p_recipient_user_id uuid,
  p_room_code text,
  p_inviter_username text,
  p_invite_url text,
  p_match_summary text,
  p_expires_at timestamptz
)
returns setof public.multiplayer_invites
language plpgsql security definer set search_path = public as $$
declare
  existing public.multiplayer_invites%rowtype;
begin
  if p_sender_user_id = p_recipient_user_id then raise exception 'cannot_invite_self'; end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '24 hours' then
    raise exception 'invalid_multiplayer_invite_expiry';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_sender_user_id::text || ':' || p_recipient_user_id::text || ':' || upper(trim(p_room_code)), 0
  ));
  update public.multiplayer_invites set status = 'expired', resolved_at = now()
    where status = 'pending' and expires_at <= now()
      and sender_user_id = p_sender_user_id
      and recipient_user_id = p_recipient_user_id
      and room_code = upper(trim(p_room_code));
  select * into existing from public.multiplayer_invites
    where status = 'pending'
      and sender_user_id = p_sender_user_id
      and recipient_user_id = p_recipient_user_id
      and room_code = upper(trim(p_room_code))
    for update;
  if found then return next existing; return; end if;
  return query insert into public.multiplayer_invites (
    invite_id, sender_user_id, recipient_user_id, room_code,
    inviter_username, invite_url, match_summary, expires_at
  ) values (
    btrim(p_invite_id), p_sender_user_id, p_recipient_user_id, upper(trim(p_room_code)),
    left(btrim(p_inviter_username), 80), left(p_invite_url, 2048),
    left(p_match_summary, 160), p_expires_at
  ) returning *;
end;
$$;

create or replace function public.resolve_multiplayer_invite(
  p_invite_id text,
  p_recipient_user_id uuid,
  p_status text
)
returns setof public.multiplayer_invites
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('accepted', 'declined') then raise exception 'invalid_multiplayer_invite_status'; end if;
  update public.multiplayer_invites set status = 'expired', resolved_at = now()
    where invite_id = p_invite_id and status = 'pending' and expires_at <= now();
  return query update public.multiplayer_invites set
    status = p_status,
    resolved_at = now()
  where invite_id = p_invite_id
    and recipient_user_id = p_recipient_user_id
    and status = 'pending'
    and expires_at > now()
  returning *;
end;
$$;

revoke all on function public.create_multiplayer_invite(text, uuid, uuid, text, text, text, text, timestamptz) from public;
grant execute on function public.create_multiplayer_invite(text, uuid, uuid, text, text, text, text, timestamptz) to service_role;
revoke all on function public.resolve_multiplayer_invite(text, uuid, text) from public;
grant execute on function public.resolve_multiplayer_invite(text, uuid, text) to service_role;

-- Rollback: disable durable invite call sites first, then drop the two RPCs,
-- indexes, and table. Pending invitations will be lost after rollback.
