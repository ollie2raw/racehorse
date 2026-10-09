# Tournament Phase 2 rollout checklist

Order (approved in Phase 2C; supersedes the Phase 2B.1 order):

| # | Step | Server | Database |
|---|------|--------|----------|
| 1 | Deploy the **2B.1 server** with `FRITZ_CUP_ENABLED=false` | 2B.1 | pre-M1 |
| 2 | Verify ordinary Live Event behaviour | 2B.1 | pre-M1 |
| 3 | Apply **M1** | 2B.1 | M1 |
| 4 | Apply **CAS + M3** (inert) | 2B.1 | M1, CAS, M3 |
| 5 | Deploy the **2C server** and verify | 2C | M1, CAS, M3 |
| 6 | M2 (cadence) — later | 2C | + M2 |
| 7 | Phase 3 client — later | 2C | |
| 8 | Enable Fritz Cup (`FRITZ_CUP_ENABLED=true`) — last | 2C | |

Migrations are applied by hand, each after a local run of
`scripts/tournament-db-verify.sh` (`ALL CHECKS PASSED`). Nothing here is
applied by CI or by a deploy.

## 1. Deploy the 2B.1 server (flag off)

Branch commit `2c7b100d`, against the pre-M1 production schema.

- With the flag off, `POST /api/tournaments/fritz-cup` answers 403
  `tournaments_disabled` before any database call.
- No 2B.1 server path names an M1-only object (`kind`, `owner_user_id`,
  `start_fritz_cup`, `_tournament_user_conflict`) in a database request;
  `kind` is only read off returned rows, defaulting to `live`. Its `/upcoming`
  filters Fritz Cups in Node, not in the query.

## 2. Verify Live Events on the 2B.1 server

`/upcoming`, `/my`, `/me`, registration, withdrawal, start, results, recovery.

## 3. Apply M1

`supabase/migrations/2026-10-07_tournament_kind_fritz_cup.sql`: additive
columns (`kind` defaulting to `live`, `owner_user_id`), new functions, and a
replaced `register_for_tournament` (same signature and success shape; see
below).

## 4. Apply the CAS migration and M3 (inert)

In this order:

1. `supabase/migrations/2026-10-08_tournament_orchestrator_cas.sql` — three new
   functions (`complete_tournament_match_if_unchanged`,
   `cancel_tournament_if_no_entrants`, `cancel_tournament_if_bracket_unchanged`).
   Replaces nothing.
2. `supabase/migrations/2026-10-08_tournament_orchestrator_lease.sql` — the
   `tournament_orchestrator_leases` table (RLS on, no client grants) and the
   acquire / renew / release RPCs (service role only).

Both are inert under the 2B.1 server, which calls none of these objects.
Afterwards `assert_security_posture()` must still return `hard_fail_count = 0`.

## 5. Deploy the 2C server and verify

The 2C server **requires** M1, CAS and M3:

| Missing | Effect on the 2C server |
|---------|-------------------------|
| M1 | `/upcoming` queries `kind=eq.live`: 500 `internal` |
| CAS | the no-show, empty-event cancel and backstop cancel RPCs fail: those steps alert (Sentry) and retry each tick; nothing is written |
| M3 | the lease cannot be acquired, so **no process orchestrates** (no open, start, dispatch, reconcile, recovery); `orchestrator_lease_unavailable` alerts after 3 ticks (~90 s) |

**Deploy when no tournament is near its start** (no registration about to
close, nothing `in_progress`). During this one deploy the old 2B.1 instance
(no lease, unconditional orchestrator writes) keeps ticking until Render sends
it SIGTERM, alongside the new instance that holds the lease. Every later
deploy is 2C → 2C: the new instance stands by until the old one drains and
releases on SIGTERM — or, if it could not drain in time or crashed, until the
lease expires (120 s by default).

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
30000..600000) sets the lease TTL. The heartbeat renews every 30 s,
independently of the tick, and a process stops treating itself as owner 10 s
before its last confirmed expiry.

## 6–8. Later

- **6. M2 (cadence)** — its own phase.
- **7. Phase 3 client.**
- **8. `FRITZ_CUP_ENABLED=true`** — only once server, database and client are
  all ready.

## Rollback

| From | Rollback | Notes |
|------|----------|-------|
| 8 (cups on) | `FRITZ_CUP_ENABLED=false` | Stops new cups at once; existing cups play out (the scheduler, results and recovery treat them like any tournament). |
| 5 (2C server) | Redeploy the 2B.1 server | The schema stays (all additive). The 2B.1 server ignores the lease row and the CAS functions and is back to the single-instance assumption with unconditional orchestrator writes: run one instance only. A later 2C deploy takes over the left-over lease once it has expired (≤ TTL). |
| 4 (CAS, M3) | Normally none (inert) | Drop the three CAS functions and the lease RPCs and table **only** when no 2C server is running. |
| 3 (M1) | Forward-fix preferred | The 2C server needs M1. Before any Fritz Cup exists, M1 can be reverted (restore the pre-M1 `register_for_tournament`, drop the new functions and columns) only after rolling back to the 2B.1 server. Once cups exist, do not revert. |
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
