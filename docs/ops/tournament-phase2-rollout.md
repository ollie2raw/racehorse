# Tournament Phase 2 rollout checklist

Order (approved in Phase 2B.1; supersedes "M1 first"):

1. **Deploy the new server with `FRITZ_CUP_ENABLED=false`** while production
   still has the pre-M1 schema.
   - With the flag off, `POST /api/tournaments/fritz-cup` answers 403
     `tournaments_disabled` before any database call.
   - No other server path names an M1-only object (`kind`, `owner_user_id`,
     `start_fritz_cup`, `_tournament_user_conflict`) in a database request;
     `kind` is only read off returned rows, defaulting to `live`.
     `/upcoming` filters Fritz Cups in Node, not in the query.
   - Proven by `server/src/scheduledTournament/tournamentRolloutCompat.test.ts`.
2. **Verify ordinary Live Event behaviour** on that server: `/upcoming`, `/my`,
   `/me`, registration, withdrawal, start, results, recovery.
3. **Apply M1** (`supabase/migrations/2026-10-07_tournament_kind_fritz_cup.sql`).
   Verify locally first with `scripts/tournament-db-verify.sh`.
4. **Keep `FRITZ_CUP_ENABLED=false`** while M3 (orchestrator lease) and M2
   (cadence) are completed and deployed.
5. **Ship the Phase 3 client.**
6. **Enable Fritz Cup** (`FRITZ_CUP_ENABLED=true`) only once server, database
   and client are all ready.

## `register_for_tournament` across M1

M1 replaces `register_for_tournament` (same signature, same success shape)
with the overlap-aware version, which can also raise `overlapping_tournament`
and refuses Fritz Cups with `registration_closed`.

- Before M1, the new server talks to the old RPC, which never raises
  `overlapping_tournament`; nothing changes for it.
- After M1, the new server maps `overlapping_tournament` to HTTP 409 / socket
  ack with `conflict { tournamentId, kind, scheduledStart }`.
- The old (pre-Phase-2B) server is not taught the new error on purpose: in the
  order above it no longer serves traffic when M1 is applied. (If it did, it
  would answer the new error as a 500 — an error, never a false success.)

## Pre-start cancellation

The new server cancels a not-yet-started tournament only with a conditional
update (`status IN ('upcoming','registration_open')`), so a tournament another
process has started is never cancelled. This needs no migration
(`cancel_reason` exists since 2026-09-29). The pre-2B.1 server's unconditional
cancel is one more reason not to enable Fritz Cups until the new server is the
only one running.
