# Tournament launch: the owner's checklist

The short version of `README.md` (read that for the why, the rollback and the monitoring queries). Everything here is
**owner-run**: nothing touches production unless you do it. Decisions already made (2026-10-31): Live Events at
**6 pm and 9 pm Eastern**, launch on the **free** Render instance (upgrade later), player blocks = **option B**
(nothing social passes between a blocked pair inside a match). Fritz Cup stays **off** for now.

Each step is reversible. Do them in order; stop and send me the output if anything differs from "expect".

## A. Before anything is switched on (any time, nothing visible changes)

1. **Merge** the two PRs: the schedule change (M4, #387) and the tournament-block reactions. Render and Vercel deploy `main`.
   Check `GET /health` is 200 and `GET /api/tournaments/upcoming` still says `features: { tournaments: false }`.
2. **Production readiness** (`prod-readiness-one-result.sql`, read-only, one result table; use this rather than the multi-panel
   `prod-preflight.sql`, because the Supabase editor shows only the last result of a script). Expect: P1 08-31, M1, CAS, M3 and M2 rows `true`
   (applied 2026-10-11); the **M4 row `false`**; `room_live_sessions` `true`; P2 one row per name; P7 `0 / 0`; P8 no rows; P9 `0`.
3. **M4, the new schedule** (`README.md` stage 1b), three pastes in the SQL editor:
   `../tournament-m4/preflight.sql`, then `supabase/migrations/2026-10-31_tournament_live_event_times_eastern.sql`,
   then `../tournament-m4/verify.sql`. Expect: verify shows `America/New_York` `{18:00, 21:00}`, every "expect 0" row is 0, and
   the next events list 18:00 and 21:00 ET.
4. **Keep the free server awake.** In UptimeRobot, confirm the `/ping` monitor is active at its shortest interval and that it
   alerts you. It is the only thing keeping the free instance from sleeping.

## B. Turning tournaments on (do this in the afternoon, never inside an event window)

Event windows are **18:00 to 19:00 and 21:00 to 22:00 Eastern**. Start at least an hour before an event, e.g. mid-afternoon
Eastern, so the 6 pm event is the first one.

5. **Render** environment: set `TOURNAMENTS_ENABLED=true`. Leave `FRITZ_CUP_ENABLED` unset. Confirm instance count is **1**.
   Restart. Expect in the logs: exactly one `lease acquired`, renewals about every 60 s, no `close-and-start failed`.
6. The first ticks cancel the stale backlog of past events (about 50 per 30 s tick). Re-run P6 until `stale_backlog_rows = 0`.
7. `GET /api/tournaments/upcoming` now lists the next events at 18:00 and 21:00 ET with `features.tournaments: true, fritzCup: false`.
8. **Vercel** (Production): set `VITE_ENABLE_TOURNAMENTS=true` and redeploy `main`. This is the step where the
   **"Soon" label disappears** and the Tournament tab becomes real. (Open tabs pick it up on reload.)

## C. The first events (about a week of care)

9. A few minutes before 18:00 ET, open `/ping` yourself until you trust the monitor (a cold start takes tens of seconds, and
   registration closes 2 minutes before the start).
10. **Run one staffed event:** register two real accounts. At close the bracket is generated, empty seats are filled with Fritz
    (so one human alone still gets a bracket), both players get `match_ready`, join by tap, play to a result, the next round
    dispatches, and a result page and a `/history` row exist.
11. Before, during (every 10 to 15 minutes) and after each event, for the first week, paste `monitor-one-result.sql` into the
    SQL editor: ONE read-only table, six rows. The `verdict` column should read OK or INFO on every row. `MISSING` / `STALE`
    on the lease means the scheduler is not running (check Render and `/ping`); `LOOK` on overdue or stuck names what to
    open in the logs (`README.md`, "Monitoring"). It is the three queries in the README combined, because the editor shows
    only the last result of a script.

## D. When to upgrade the server (the only part that costs money)

Move the Render service to an always-on paid instance (count still 1; no code change) when **any one** of these happens: an
event opened or started late, a `close-and-start failed` escalation, a match stranded by a restart, or regular events with 4 or
more human matches live at once (measured lag at about 4).

## E. Later, separately

12. **Fritz Cup** (`FRITZ_CUP_ENABLED=true`): only after the live gate in `README.md` holds and about 24 hours of clean
    monitoring, and preferably after the server upgrade (cups add load at any hour).

## Rollback, if anything looks wrong

Between events: unset `TOURNAMENTS_ENABLED` in Render and restart, **and** unset `VITE_ENABLE_TOURNAMENTS` in Vercel and
redeploy (with only the server flag off, the hub would show "not available" instead of going back to "Soon"). During an event,
wait for it to end first:
turning the server flag off mid-event strands in-flight matches. The schedule migration is forward-only (never re-apply the
05-17 migration).
