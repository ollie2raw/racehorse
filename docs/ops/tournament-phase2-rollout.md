# Tournament Phase 2 rollout checklist

Order (approved in Phase 2D; supersedes the Phase 2C.1 order):

| # | Step | Server | Database |
|---|------|--------|----------|
| 1 | Deploy the **2B.1 server** with `FRITZ_CUP_ENABLED=false`; verify Live Events | 2B.1 | pre-M1 |
| 2 | Apply **M1** | 2B.1 | M1 |
| 3 | Apply the **CAS migration** (inert) | 2B.1 | + CAS |
| 4 | Apply **M3** (inert) | 2B.1 | + M3 |
| 5 | Apply the **completion guard** | 2B.1 | + guard |
| 6 | Deploy the **2C / 2C.1 server** and verify | 2C.1 | all of the above |
| 7 | Apply **M2** (Live Event cadence) — preflight first | 2C.1 | + M2 |
| 8 | Verify the new Live cadence | 2C.1 | |
| 9 | Phase 3 client | 2C.1 | |
| 10 | Final end-to-end verification | 2C.1 | |
| 11 | Enable Fritz Cup (`FRITZ_CUP_ENABLED=true`) — last | 2C.1 | |

Migrations are applied by hand, each after a local run of
`scripts/tournament-db-verify.sh` (`ALL CHECKS PASSED`). Nothing here is
applied by CI or by a deploy.

## 1. Deploy the 2B.1 server (flag off) and verify Live Events

Branch commit `2c7b100d`, against the pre-M1 production schema.

- With the flag off, `POST /api/tournaments/fritz-cup` answers 403
  `tournaments_disabled` before any database call.
- No 2B.1 server path names an M1-only object (`kind`, `owner_user_id`,
  `start_fritz_cup`, `_tournament_user_conflict`) in a database request;
  `kind` is only read off returned rows, defaulting to `live`. Its `/upcoming`
  filters Fritz Cups in Node, not in the query.
- Verify `/upcoming`, `/my`, `/me`, registration, withdrawal, start, results,
  recovery.

## 2. Apply M1

`supabase/migrations/2026-10-07_tournament_kind_fritz_cup.sql`: additive
columns (`kind` defaulting to `live`, `owner_user_id`), new functions, and a
replaced `register_for_tournament` (same signature and success shape; see
below).

## 3–4. Apply the CAS migration, then M3 (inert)

1. `supabase/migrations/2026-10-08_tournament_orchestrator_cas.sql` — three new
   functions (`complete_tournament_match_if_unchanged`,
   `cancel_tournament_if_no_entrants`, `cancel_tournament_if_bracket_unchanged`).
   Replaces nothing.
2. `supabase/migrations/2026-10-08_tournament_orchestrator_lease.sql` — the
   `tournament_orchestrator_leases` table (RLS on, no client grants) and the
   acquire / renew / release RPCs (service role only).

Both are inert under the 2B.1 server, which calls none of these objects.
Afterwards `assert_security_posture()` must still return `hard_fail_count = 0`.

## 5. Apply the completion guard

`supabase/migrations/2026-10-09_tournament_completion_guard.sql` replaces
`complete_tournament_match` (same signature and success shape) and the two
Phase 2C wrappers `complete_tournament_match_if_unchanged` and
`cancel_tournament_if_bracket_unchanged`:

- An unresolved match completes only while its tournament is `in_progress`.
  `cancelled` → `tournament_cancelled`; `completed`, `upcoming`,
  `registration_open` → `tournament_not_in_progress`. Nothing is written. A
  replay of an already-recorded result stays an idempotent no-op whatever the
  tournament's status.
- Every tournament RPC now locks the tournament row before its match rows (it
  was matches first in the two wrappers, a lock cycle with a completion that
  Postgres would abort as a deadlock; harness §12 reproduces it against the
  old bodies).

Under the still-running 2B.1 server this is safe: its completions behave as
before, except that a result racing a cancellation is now refused instead of
landing in a cancelled bracket. The 2B.1 server does not know the new codes,
so such a game-over retries 4 times and gives up with one
`game_over_persist_exhausted` alert — noisy, rare, and nothing is written.
The 2C.1 server treats both codes as terminal (below).

## 6. Deploy the 2C / 2C.1 server and verify

The 2C.1 server **requires** M1, CAS and M3; the completion guard is
recommended first but not required by it (without it the refusals simply
never happen):

| Missing | Effect on the 2C.1 server |
|---------|---------------------------|
| M1 | `/upcoming` queries `kind=eq.live`: 500 `internal` |
| CAS | the no-show, empty-event cancel and backstop cancel RPCs fail: those steps alert (Sentry) and retry each tick; nothing is written |
| M3 | the lease cannot be acquired, so **no process orchestrates** (no open, start, dispatch, reconcile, recovery); `orchestrator_lease_unavailable` alerts after 3 ticks (~90 s) |
| guard | a result racing a cancellation can still complete a match of a cancelled tournament (the pre-2C.1 gap) |

**Deploy when no tournament is near its start** (no registration about to
close, nothing `in_progress`). During this one deploy the old 2B.1 instance
(no lease, unconditional orchestrator writes) keeps ticking until Render sends
it SIGTERM, alongside the new instance that holds the lease. Every later
deploy is 2C.1 → 2C.1: the new instance stands by until the old one drains
and releases on SIGTERM — or, if it could not drain in time or crashed, until
the lease expires (120 s by default).

Verify:

- Logs: one `orchestrator lease acquired` (epoch 1) on the new instance; no
  `orchestrator_lease_lost` or `orchestrator_lease_unavailable` Sentry issue.
- The lease row (SQL editor, read-only):
  `select owner_id, acquired_at, renewed_at, leased_until from public.tournament_orchestrator_leases;`
  — one row; `owner_id` is the new instance (`<host>:<pid>:<boot uuid>`);
  `renewed_at` advances about every 30 s; `leased_until` ≈ `renewed_at` + TTL.
- On the next deploy: the old owner logs `orchestration drained` with
  `released: true`, and the new instance acquires within one tick (30 s).
- A Live Event lifecycle: registration opens on time; the event starts or is
  cancelled `not_enough_players`; matches dispatch; results advance the
  bracket; recovery after a restart.
- `/upcoming` lists only Live Events.
- Every tournament REST body (success and error) carries `serverNow`
  (ISO 8601 UTC, milliseconds); so do `tournament:match_ready`, the attach ack
  and the register / withdraw acks. Unexpected failures are 500
  `{ ok: false, error: 'internal', serverNow }`, with no database text.

`TOURNAMENT_ORCHESTRATOR_LEASE_TTL_MS` (default 120000, clamped to
30000..600000; the database is asked for whole seconds) sets the lease TTL.
The heartbeat renews every 30 s, independently of the tick. A process stops
treating itself as owner 10 s before the lease could expire: its deadline is
measured on a monotonic clock from when the acquire / renew request was sent,
plus the granted TTL — never from the host wall clock or the database's
`leased_until`, so host clock drift or a clock step cannot extend it.

### A result after a cancellation (2C.1 server)

`tournament_cancelled` and `tournament_not_in_progress` are terminal for the
result path: the game-over persist does not retry; one log line, and one
Sentry event per match (a warning for a cancellation, an invariant-violation
error for a completed / not-started parent); the room's game-over persist
settles so the room is cleaned up normally. The result is not reinterpreted
and the tournament is not revived.

## 7. Apply M2 — two Live Events a Pacific day

`supabase/migrations/2026-10-10_tournament_live_event_cadence.sql`. One
transaction:

- **Schedule.** Every America/Los_Angeles day at 17:00 and 20:00 local time
  (20:00 / 23:00 Eastern today; the UTC instant moves with DST). Registration
  opens 12 h before (05:00 / 08:00 PT) and closes 2 min before. Each rule is
  defined once, in an internal helper (`_live_event_timezone`,
  `_live_event_slot_times`, `_live_event_registration_window`,
  `_is_live_event_slot`, `_live_event_slots`); a future schedule change is
  one `create or replace`.
- **Seeding.** `seed_future_tournaments(days_ahead integer default 30)` and
  `ensure_tournament_seed_window()` keep their signatures, so pg_cron (if a
  job exists) and every deployed server produce the new cadence the moment M2
  commits. `ensure` now inserts the desired slot set of the next 30 local days
  (about 60 rows; `ON CONFLICT (scheduled_start) DO NOTHING`) instead of
  topping up below a row count, so a hole is always refilled. A row already at
  a slot time — including a cancelled one — is never changed or revived.
- **Legacy inventory: cancelled, never deleted.** `status='cancelled'`,
  `cancel_reason='cadence_replaced'`, only for Live rows that are `upcoming`,
  start more than 35 minutes from now, are not at 17:00 / 20:00 PT, and have no
  registration and no match row. Everything else is left exactly as it is.
  (Do **not** run piece E2 of `docs/ops/tournament-v2-preflight.md`, which
  deletes these rows; M2 supersedes it.)
- **Existing rows at 17:00 / 20:00 PT** keep their id, start and status; if
  `upcoming` / `registration_open` and without match rows, their window becomes
  12 h / 2 min. One whose new opening time has already passed stays `upcoming`
  and is opened by the orchestrator's next ordinary tick.
- M2 locks `scheduled_tournaments` in SHARE ROW EXCLUSIVE mode for its
  duration (reads continue; writes wait a few seconds), so no old-body seed
  can slip old-cadence rows in between the cleanup and the commit.
- **No server change is needed.** The lifecycle acts on the stored
  timestamps (`fetchDueLifecycleTournaments`, `openRegistrationIfDue`), the
  seed fallback calls the same RPC, `/upcoming` already filters `kind='live'`,
  and the overlap rule uses the 2-hour window at `scheduled_start`, not the
  registration period (a player registered 12 h ahead can still play a Fritz
  Cup earlier that day). Fritz Cups are never touched.

Before applying, run **`docs/ops/tournament-m2/preflight.sql`** (read-only) in
the SQL editor and keep its output. "Expect 0" rows should be 0; if one is not,
M2 still leaves those rows untouched, but look at them first.

Production as last observed (2026-10-04, `tournament-v2-preflight.md` §3):
~1,402 `upcoming` 30-minute rows through 2026-11-01 PT with no registrations
or matches, one long-past `registration_open` row, and a seed body that still
opens at T−30 / closes at T−5 (the 05-17 migration was never applied). M2
replaces that body regardless.

## 8. Verify the new Live cadence

Run **`docs/ops/tournament-m2/verify.sql`** (read-only): both seed functions
are the M2 bodies with unchanged signatures; every desired slot of the next 30
local days has a Live row; slot-time rows have 12 h / 2 min windows; no
eligible legacy row remains; `cadence_replaced` touched no Fritz Cup, no row
with a registration or match, no slot-time row; and the next 10 Live Events in
UTC, Pacific and Eastern. Then, on the 2C.1 server: `/upcoming` lists only
17:00 / 20:00 PT events (plus any transition row), each opening 12 h before.

**Transition.** Rows M2 deliberately keeps can still appear briefly: an
`upcoming` old-cadence event starting within 35 minutes of the migration
(plays out or is cancelled `not_enough_players` by the ordinary lifecycle),
any `registration_open` event (production had one stale, long-past row: the
lifecycle closes it and cancels it for lack of entrants once tournaments are
enabled), and any anomaly the preflight listed. Nothing re-creates old-cadence
rows after M2.

## 9–11. Later

- **9. Phase 3 client.** The current client still says "every 30 minutes" /
  "registration opens 30 minutes before start" (`TournamentHubScreen.tsx`,
  `hubState.ts`); Phase 3 replaces that copy.
- **10. Final end-to-end verification.**
- **11. `FRITZ_CUP_ENABLED=true`** — only once server, database and client are
  all ready and verified end to end.

M2 relies on the completion guard: once a tournament is
`status = 'cancelled'`, no match of it can be completed by any path (game over,
forfeit, no-show, backstop, bye), whatever the reason for the cancellation and
whatever state its bracket is in.

## Rollback

| From | Rollback | Notes |
|------|----------|-------|
| 11 (cups on) | `FRITZ_CUP_ENABLED=false` | Stops new cups at once; existing cups play out (the scheduler, results and recovery treat them like any tournament). |
| 7 (M2) | Forward-fix preferred | Change the schedule with a new migration replacing the helpers. The legacy rows stay cancelled (`cadence_replaced` marks them); restoring the old 48-a-day body would re-seed that cadence and is not recommended. |
| 6 (2C.1 server) | Redeploy the 2B.1 server | The schema stays (all additive). The 2B.1 server ignores the lease row and the CAS functions and is back to the single-instance assumption with unconditional orchestrator writes: run one instance only. A later 2C deploy takes over the left-over lease once it has expired (≤ TTL). |
| 5 (guard) | Forward-fix preferred | Reverting means restoring the 2026-08-31 `complete_tournament_match` and the 2026-10-08 wrapper bodies — which reopens the cancelled-result gap and the lock cycle. |
| 3–4 (CAS, M3) | Normally none (inert) | Drop the three CAS functions and the lease RPCs and table **only** when no 2C server is running. |
| 2 (M1) | Forward-fix preferred | The 2C.1 server needs M1. Before any Fritz Cup exists, M1 can be reverted (restore the pre-M1 `register_for_tournament`, drop the new functions and columns) only after rolling back to the 2B.1 server. Once cups exist, do not revert. |
| any | `TOURNAMENTS_ENABLED=false` | Global switch: no scheduler (so no lease calls), no tournament database traffic; the read routes answer an empty state. |

## What the lease does and does not do

- It makes one process at a time run tournament orchestration (lifecycle,
  start dispatch, reconcile, event backstop, seed fallback, recovery), with
  recovery once per ownership epoch.
- It does **not** fence individual writes: a write issued just before
  ownership was lost may still land. Every orchestrator write is safe on its
  own — compare-and-set, row-locked, or idempotent
  (`2026-10-08_tournament_orchestrator_cas.sql`, harness §10).
- It is **not** Socket.IO room ownership. Rooms and live games live in memory
  on the process that created them; with more than one instance, the lease
  owner need not host a match's room. Running several instances still needs
  room routing (sticky sessions or an adapter). Production runs one.

## `register_for_tournament` across M1

M1 replaces `register_for_tournament` (same signature, same success shape)
with the overlap-aware version, which can also raise `overlapping_tournament`
and refuses Fritz Cups with `registration_closed`.

- Before M1, the 2B.1 server talks to the old RPC, which never raises
  `overlapping_tournament`; nothing changes for it.
- After M1, the server maps `overlapping_tournament` to HTTP 409 / socket ack
  with `conflict { tournamentId, kind, scheduledStart }`.
- The pre-Phase-2B server is not taught the new error on purpose: in the order
  above it no longer serves traffic when M1 is applied. (If it did, it would
  answer the new error as a 500 — an error, never a false success.)

## Pre-start cancellation

The 2B.1 server cancels a not-yet-started tournament only with a conditional
update (`status IN ('upcoming','registration_open')`), so a tournament another
process has started is never cancelled. The 2C server goes further: an empty
event is cancelled by `cancel_tournament_if_no_entrants`, which re-checks the
registrations and the database-clock close time in the same transaction as
the cancel, so a last-moment registration is never lost.
