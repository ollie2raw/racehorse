-- Fixes a live, reproduced bug: `matches_insert_participant`'s RLS policy was
-- the entire client-side gate on writing this table, and it permitted the
-- exact forgery System 11's SA-2 (HARDENING_PLAN.md §11.3) fixed at the
-- application layer -- a registered-vs-registered win/loss claim against a
-- real other user, with no room_code, no reference to any authoritative
-- game-over event, nothing beyond "the caller is one of the two named
-- participants." SA-2's fix lives entirely inside the Express
-- `/api/stats/record-match` handler (`server/src/stats/recordUserMatch.ts`);
-- it never touched the database, so a direct authenticated PostgREST call --
-- bypassing the Express server entirely -- still forged a row (HARDENING_PLAN.md
-- §13.1.2, reproduced live: a throwaway attacker inserted a fabricated win
-- against a throwaway victim, 201, no room_code, cleaned up net-zero).
--
-- This mirrors SA-2's own logic exactly, at the layer that actually enforces
-- it: a client INSERT is only permitted when at most one of
-- winner_user_id/loser_user_id is non-null -- the legitimate guest-opponent
-- self-report case (MultiplayerGameShell.tsx's own guard means a real
-- registered-vs-registered match never submits both ids from the client in
-- the first place). A genuine registered-vs-registered match's row comes
-- from `recordPublicMatch.ts`'s `recordPublicOnlineMatch`, which writes via
-- the server's service-role key and therefore bypasses RLS entirely -- it
-- does not need, and was never granted, a path through this client-facing
-- policy.
--
-- Confirmed safe before writing this: grepped every INSERT call site into
-- `matches` in both client/src and server/src. The only two writers are
-- `recordUserMatch.ts` (service-role, backs the client-callable
-- guest-opponent self-report route) and `recordPublicMatch.ts` (service-role,
-- the real game-over event) -- both authenticate as service_role via
-- `supabaseFetch`, which bypasses RLS unconditionally, so neither is affected
-- by this policy at all. No direct client-side `supabase.from('matches').insert(...)`
-- exists anywhere in client/src -- the one client-side `.from('matches')` call
-- (`stats/statsApi.ts`) is a `.select()`, not a write. This policy is
-- therefore only ever consulted for a direct, non-Express PostgREST call --
-- exactly the reproduction above -- never a legitimate app code path.

drop policy if exists "matches_insert_participant" on public.matches;
create policy "matches_insert_participant"
  on public.matches
  for insert
  to authenticated
  with check (
    (auth.uid() = winner_user_id or auth.uid() = loser_user_id)
    and (winner_user_id is null or loser_user_id is null)
  );
