# Tournament launch — production rollout runbook (Phase 4A)

Supersedes the step order in `../tournament-phase2-rollout.md` (that order
assumed separately deployed 2B.1 / 2C.1 servers; the branch now ships as one
server). Its rollback table and lease notes still hold.

Everything below is **owner-run**. Nothing here has been run against
production. Production project: `fisfadjqllojdzibcdfx`. Dev project (where all
of this was rehearsed on 2026-10-11): `nwodvcmlmailtgjblphu`.

**Strategy B — dark database, dark code, then switches.** Each stage is
independently reversible, and no stage needs a coordinated cut-over:

| Stage | What changes | Users see |
|---|---|---|
| 0 | Read-only preflight (`prod-preflight.sql`) | nothing |
| 1 | Database: (08-31 pieces A–D if missing) → M1 → CAS → M3 → guard → M2 | nothing (server flag off) |
| 1b | Database: M4 — the Live Event schedule becomes 6 pm and 9 pm Eastern (replaces M2's 5 pm / 8 pm Pacific) | nothing (server flag off) |
| 2 | Server deploy (this branch, merged to `main`), `TOURNAMENTS_ENABLED` still off | nothing |
| 3 | Server `TOURNAMENTS_ENABLED=true` (Live only; `FRITZ_CUP_ENABLED` off) | nothing yet (client flag off) |
| 4 | Client: Vercel `VITE_ENABLE_TOURNAMENTS=true`, redeploy | Tournament tab, Live Events |
| 5 | After the Live gate: `FRITZ_CUP_ENABLED=true` | Fritz Cup card |

Why this is safe: with `TOURNAMENTS_ENABLED` not `"true"`, both the current
production server (`main`) and this branch's server make **no** tournament
database calls (no scheduler, no lease, no seeding; read routes answer empty;
sockets ack `tournaments_disabled`). So the schema can change under either
server, and either server can run on either schema, while the flag is off.

---

## Mixed-version matrix (flags as stated)

| Server | Database | Client (web) | Tournaments flag | Result |
|---|---|---|---|---|
| `main` (today) | pre-M1 (today) | flag off | off | Today's production. No tournament traffic |
| `main` | migrated (stage 1) | flag off | off | Safe: `main` makes no tournament DB calls while off |
| branch | pre-M1 | any | off | Safe (dark), but **never turn the flag on**: lease table / `start_fritz_cup` missing → no orchestrator, cup 500s |
| branch | migrated | flag off | **on** | Live runs server-side; no UI yet (API only). Stage 3 |
| branch | migrated | flag on | on | Launch state (stage 4) |
| branch | migrated | flag on | off | Hub shows "not available"; avoid (stage 4 only after stage 3) |
| `main` | migrated | any | **on** | **Never.** `main` lacks the Phase 4A fixes (matches Fritz or the opponent starts never reach the player; deploy restarts split rooms) |
| old open tab | — | flag off bundle | any | Never calls tournament routes; picks up the new bundle on reload |

## Restarts and deploys (rehearsed in dev, 2026-10-11)

- **Graceful (deploy, `SIGTERM`)**, built server (`node dist/index.js`): the
  old process released the lease, flushed live sessions and closed its sockets
  in ≈ 0.6 s; the new one took the lease ≈ 0.9 s after boot; the player's
  client re-attached and the match continued ≈ 1 s later with no lobby trip
  and no missed turn charged.
- **Crash (no `SIGTERM`)**: the lease is only taken over when it expires
  (≤ 120 s). Players reconnecting meanwhile re-attach, and the server rebuilds
  the room from its live session on demand (no lease needed for that); the
  turn clock then restarts from a fresh deadline.
- Still: **do not deploy during a Live Event window** (18:00–19:00 and
  21:00–22:00 ET); check `select count(*) from public.scheduled_tournament_matches
  where status = 'in_progress'` is 0 first when Fritz Cups are on, or accept a
  ≈ 1 s blip for players mid-match.

## Hard gates before stage 3

1. **Always-on game server.** Production runs Render **Free**: it sleeps after
   15 idle minutes (kept awake only by the UptimeRobot `/ping` monitor), "may
   restart at any time", has 0.1 CPU (measured lag at ≈ 4 live matches). The
   orchestrator opens, closes, starts and dispatches events on a 30 s tick and
   runs every turn clock in memory; a sleeping or starved process means events
   that do not open, no-shows that are not the player's fault, and late turn
   clocks. Restarts themselves are survivable (rehearsed, below). **Owner
   decision:** move the web service to a paid always-on instance before
   stage 3, or accept the risk explicitly. Nothing has been purchased.
2. **One instance.** Render instance count = 1, no autoscaling. The lease
   makes orchestration safe with two processes, but rooms live in memory on
   the process that created them and there is no sticky routing or Socket.IO
   adapter. A deploy's brief overlap (new instance up before the old one
   stops) is covered: the old process drains (releases the lease, flushes live
   sessions to `room_live_sessions`), the new one restores rooms and clients
   reconnect. (Before Phase 4A the old process hung in `server.close()` with
   its websockets open, keeping rooms and turn clocks alive after it had
   handed the lease over: two authorities for one match. Fixed on the branch.)
3. **The deployed server and client both carry the Phase 4A fixes** (see the
   Phase 4A report): never enable tournaments on a `main` build from before
   this branch.
4. **`prod-preflight.sql` P6 `stale_backlog_rows`** is drained (see stage 3).
5. **Decide how player blocks apply to tournaments, then implement and test
   it.** Blocks (`user_blocks`, `server/src/moderation/`) are enforced for
   friend requests, invites, Quick Match and new private-room seats, but **not**
   for tournament bracket assignments or tournament-room reactions. Before
   `TOURNAMENTS_ENABLED` is turned on publicly, pick one and ship it:
   - **A.** Blocked humans are never bracket-paired (seeding/re-pairing
     changes in the bracket engine), or
   - **B.** Assigned opponents still play, but every social interaction
     between the blocked pair is suppressed in tournament rooms (reactions,
     friend/rematch prompts, profile links).

   Do not enable tournaments with the semantics left implicit.

## Stage 0 — read-only preflight (owner)

Paste `prod-preflight.sql` into the production SQL editor. Keep the output.
Expected before stage 1:

| Check | Expect | If not |
|---|---|---|
| P1 08-31 rows | `true` | If `false` (production lacked them on 2026-10-04): apply `../tournament-v2-preflight/` A, B, C, then D (verify) **first** — CAS and the completion guard call `complete_tournament_match`, `promote_tournament_match` and the `_tournament_*` helpers |
| P1 M1…M2 rows | `false` | Something was applied already: stop and send the output |
| P1 M4 row | `false` | `true` means the schedule is already 6 pm / 9 pm Eastern: skip stage 1b |
| P1 `room_live_sessions` | `true` | Restart restore needs it: stop |
| P2 | one row per name | Two rows = old overload: stop |
| P3 | 05-14/16 or 05-17 body | `unknown`: send the definition |
| P4 | `pg_cron_installed` | If true, run the commented `cron.job` query; a job calling `seed_future_tournaments` is harmless after M2 (it seeds the new cadence) but note it |
| P7 | `0 / 0` | Humans on not-finished rows: stop and send |
| P8 | no rows | Something is in progress while tournaments are off: stop |
| P9 | `0` | Fix the posture first |

Also confirm in the Render dashboard (read only): `TOURNAMENTS_ENABLED` is
unset or not `true`, `FRITZ_CUP_ENABLED` unset, instance count 1. In Vercel:
`VITE_ENABLE_TOURNAMENTS` unset or not `true` for Production.

### The "May migration"

`supabase/migrations/2026-05-17_tournament_registration_close_2_minutes.sql`
(30-minute cadence, registration T−30 / close T−2) is **fully superseded by
M2** and must **never** be applied after M2: it would restore the 48-a-day
cadence. Production running an older seed body (P3) is expected and needs no
action — M2 replaces it. The old `tournament-v2-preflight/E2-delete-v1-slots`
step is superseded too: M2 cancels legacy rows (`cancel_reason =
'cadence_replaced'`), never deletes.

## Stage 1 — migrations (owner, SQL editor, in this order)

Each file is one paste. Run `scripts/tournament-db-verify.sh` locally first if
the file changed since 2026-10-11.

1. (Only if P1 said the 08-31 rows are missing) `../tournament-v2-preflight/`
   `A-helpers.sql`, `B-complete-tournament-match.sql`,
   `C-promote-tournament-match.sql`, then `D-verify.sql` (all pass).
2. `supabase/migrations/2026-10-07_tournament_kind_fritz_cup.sql` (M1)
3. `supabase/migrations/2026-10-08_tournament_orchestrator_cas.sql` (CAS)
4. `supabase/migrations/2026-10-08_tournament_orchestrator_lease.sql` (M3)
5. `supabase/migrations/2026-10-09_tournament_completion_guard.sql` (guard)
6. `../tournament-m2/preflight.sql` — rows marked "expect 0" are 0; note the
   "will cancel" count.
7. `supabase/migrations/2026-10-10_tournament_live_event_cadence.sql` (M2)
8. `../tournament-m2/verify.sql` — M2 body true; expect-0 rows 0; next events
   at 17:00 and 20:00 America/Los_Angeles, registration opens 12 h before and
   closes 2 min before. (This is M2's own schedule; **stage 1b replaces it**
   before anything is switched on.)
9. `prod-preflight.sql` again: P1 all `true`, P9 `0`.

## Stage 1b — the Live Event schedule: 6 pm and 9 pm Eastern (M4, owner)

Owner decision 2026-10-31: the two daily Live Events are at **18:00 and 21:00
America/New_York** (written "6 pm / 9 pm EST"; as people say it, Eastern time
all year, so the events stay at 6 pm and 9 pm on an Eastern clock through
daylight saving). M2 seeded 17:00 and 20:00 Pacific, which is 8 pm and 11 pm
Eastern. M4 redefines the two schedule helpers M2 built for exactly this and
retires the old future inventory. Nothing in the server or the client names the
times: the server follows the stored timestamps and every player sees the event
in their own local time (a Pacific player sees 3 pm and 6 pm).

Run **after stage 1 and before stage 3**; each file is one paste, in this order:

1. `../tournament-m4/preflight.sql` — read-only. First query shows
   `America/Los_Angeles` and the Pacific slot times (M2's schedule). Rows
   marked "expect 0" are 0; note the "will cancel" count (the remaining future
   5 pm / 8 pm PT rows of the seeded window: two per day) and check the last
   query lists them as `cancel (schedule_changed)`.
2. `supabase/migrations/2026-10-31_tournament_live_event_times_eastern.sql` (M4).
3. `../tournament-m4/verify.sql` — read-only. Shows `America/New_York` and
   `{18:00, 21:00}`; every "expect 0" row is 0; the next 10 events list 18:00
   and 21:00 ET with registration opening 12 h before (06:00 / 09:00 ET) and
   closing 2 min before.

M4 is one transaction, idempotent, and never deletes. It cancels (reason
`schedule_changed`) only future `upcoming` Live rows more than 35 minutes away,
off the new slots, with no registration and no match row. Anything somebody has
already entered keeps its old time. Rehearsed against a throwaway PostgreSQL 16
by `scripts/tournament-db-verify.sh` (section 14/14), including both DST changes,
the awkward-row matrix, idempotency and these two scripts. Rollback is forward
only: a new migration that restores the helpers (`_live_event_timezone()`,
`_live_event_slot_times()`) and reseeds; never delete rows.

Dev rehearsal (2026-10-11): all applied cleanly with only expected notices;
M2 cancelled 1,079 legacy rows; verify all green; posture 0.

## Stage 2 — server deploy, flags off

Merge the branch to `main`; Render deploys. Keep `TOURNAMENTS_ENABLED` off.
Check: `GET /health` 200; `GET /api/tournaments/upcoming` →
`features: { tournaments: false, fritzCup: false }`; logs show
`tournaments DISABLED`. Rollback: Render "Rollback" to the previous deploy
(safe on the migrated schema while the flag is off).

## Stage 3 — enable Live Events on the server

Set `TOURNAMENTS_ENABLED=true` (leave `FRITZ_CUP_ENABLED` unset), restart.
Do it **at least 1 hour before** the next 18:00 or 21:00 ET event.

- The first ticks drain the stale backlog: every past-due `upcoming` row is
  opened and cancelled (`not_enough_players`) about 50 per 30-second tick. On
  dev, 312 rows took ≈ 4 minutes and delayed the current event opening until
  done. Re-run P6 until `stale_backlog_rows = 0`.
- Logs: exactly one `lease acquired` (epoch 1), renewals about every 60 s, no
  `close-and-start failed` loops.
- `GET /api/tournaments/upcoming` lists the next events at 18:00 / 21:00 ET
  with `features.tournaments: true, fritzCup: false`.

## Stage 4 — client release

Vercel → Production env: `VITE_ENABLE_TOURNAMENTS=true`, redeploy `main`.
Only after stage 3 (with the server off, the tab would show a "not available"
hub). Rollback: unset and redeploy, or Vercel instant rollback.

The native app is not released to any store; nothing to ship there. Old web
bundles in open tabs were built with the flag off and never call tournament
routes; they pick up the new bundle on reload.

## Live gate (before stage 5)

- At least two real Live Events opened, closed and started on time (or were
  cancelled for lack of players) with no `close-and-start failed` escalations.
- One staffed event: two real accounts registered, bracket generated at close
  with Fritz fill, both received `match_ready`, joined by tap, played to a
  result, the next round dispatched, a result page and `/history` row exist.
- No stuck matches (monitoring query below returns nothing).

## Stage 5 — Fritz Cup

`FRITZ_CUP_ENABLED=true`, restart (no client rebuild: the card follows
`features.fritzCup`). Check with a staff account: start a cup, play round 1,
cooldown (a second start within 60 s → 429 `fritz_cup_cooldown`), and an
overlap (a cup starting within 2 h of a registered Live Event → 409 with
`conflict`). Rollback: unset the flag and restart — new cups stop, existing
cups play out.

## Fritz gate

Fritz Cup may be enabled (stage 5) once all of these hold — no fixed waiting
period beyond them:

1. The new migrations, server and client are healthy in production.
2. Live Events were enabled first (stage 3–4).
3. Both daily Live Event slots have completed successfully at least once
   under controlled observation — preferably one 18:00 ET and one 21:00 ET
   event. If traffic is too low for organic players, controlled accounts may
   staff them.
4. About 24 hours of production monitoring (below) show no stuck events, no
   orchestrator lease failures, no duplicate rooms or results, and no
   unexplained recovery or dispatch failures.
5. Then enable Fritz Cup on its own and run one controlled Cup smoke test
   (stage 5 checks).

Also: the always-on server is in place (cups add load at any hour, not just at
18:00 / 21:00 ET).

## Monitoring

Render logs (contexts): `tournament:scheduler` (`lease acquired`/`lost`,
`close-and-start failed`, escalation cancel), `tournament:dispatch`
(`match ready`), `tournament:turn-clock` (timeouts, forfeits),
`room-forfeit`, `tournament:routes` (`tournament request failed` → also in
Sentry). Read-only SQL, every few hours on event days:

```sql
-- Stuck: ready past its deadline, or in progress past the 20-minute cap.
select id, tournament_id, round, status, ready_deadline_at, started_at
from public.scheduled_tournament_matches
where (status = 'ready' and ready_deadline_at < now() - interval '2 minutes')
   or (status = 'in_progress' and started_at < now() - interval '25 minutes');
-- Events that should have started but have not.
select id, status, scheduled_start from public.scheduled_tournaments
where status in ('upcoming', 'registration_open') and scheduled_start < now() - interval '2 minutes';
-- The orchestrator lease (one row, renewed within the last 2 minutes).
select owner_id, leased_until, renewed_at from public.tournament_orchestrator_leases;
```

## Rollback (summary)

| Situation | Action |
|---|---|
| Bad Fritz Cup behaviour | `FRITZ_CUP_ENABLED` off + restart (existing cups finish) |
| Bad Live behaviour | Between events: `TOURNAMENTS_ENABLED` off + restart. During an event this strands in-flight matches (sockets ack `tournaments_disabled`); prefer waiting for the event to end |
| Client problem | Unset `VITE_ENABLE_TOURNAMENTS` and redeploy (or Vercel instant rollback) |
| Server code problem | Render rollback to the previous deploy, with `TOURNAMENTS_ENABLED` off first |
| Schema | Forward-fix only (see `../tournament-phase2-rollout.md` § Rollback); never re-apply the 05-17 migration |
