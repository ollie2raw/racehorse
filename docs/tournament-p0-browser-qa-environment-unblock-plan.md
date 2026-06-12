# Tournament P0 Browser QA Environment Unblock Plan

Date: 2026-06-03  
Scope: unblock honest Tournament P0 browser QA in local or staging without changing tournament gameplay logic, bot AI, Racehorse rules, or unrelated modes.

## 1. Why The Previous QA Pass Was Blocked

The previous browser pass proved the outer shell, but not the live tournament path:

- Anonymous Tournament hub loaded correctly in a real browser.
- Registration countdown rendered and ticked down correctly.
- Tournament automated coverage remained green:
  - server tournament suite
  - `tournamentPostgamePolicy.behaviorTests`
  - `tournamentBracketDisplay.behaviorTests`
  - `displayNames.behaviorTests`
- The pass was blocked at the first authenticated boundary:
  - no authenticated browser account/session was available in the clean local browser
  - no safe seeded human registration path existed
  - no live assigned-match state could be reached honestly
- Because of that, the following could not be executed:
  - live quarterfinal / semifinal / final attach
  - match HUD target-30 verification in browser
  - draw animation visibility
  - rack spacing perception
  - game-over overlay persistence
  - return-to-bracket flow
  - reload recovery in lobby / bracket / live match / overlay
  - disconnect and slow-network scenarios

Conclusion: the previous pass was not blocked by a newly proven tournament defect. It was blocked by missing QA environment setup.

## 2. Recommended Smallest Safe Unblock Strategy

### Preferred approach

Use a local-only seeded QA tournament path driven by a dev-only server helper plus one non-production QA user account.

Core shape:

- Gate the harness behind both:
  - `NODE_ENV !== 'production'`
  - `ENABLE_QA_TOURNAMENT_SEED=1`
- Use one explicit QA user identity:
  - prefer `QA_TOURNAMENT_USER_ID` from env
  - optionally allow a one-time local/staging creation step if the user does not exist yet
- Seed a near-start 8-player tournament in non-production data only.
- Register the QA user into that tournament.
- Build the remaining seven seats as bot fixture entrants using existing tournament engine conventions.
- Let the browser sign in normally with the QA account.
- Avoid client-side auth spoofing by default.

### Why this is the safest option

This is the smallest approach that unblocks real browser QA while preserving real tournament code paths:

- It uses the existing auth model instead of bypassing it.
- It exercises the real tournament registration, bracket, attach, room, overlay, and recovery logic.
- It avoids production mutation by hard-gating to non-production.
- It avoids a permanent public admin surface if implemented as a script or dev-only route disabled by default.
- It keeps the harness removable after QA.

### Why this is better than the alternatives

`Manual real auth account only`

- Too fragile.
- Still leaves no deterministic tournament state or registration window.
- Requires waiting on real wall-clock tournaments or ad hoc DB edits.

`Using existing Supabase auth manually`

- Better than anonymous QA, but still incomplete by itself.
- Solves login only, not deterministic bracket state, assigned matches, or near-terminal fixtures.

`Temporary admin route`

- Higher risk.
- Easy to leave exposed accidentally.
- Encourages state mutation through HTTP instead of a controlled QA-only harness.

`Directly mutating DB rows`

- Fast but unsafe and hard to repeat cleanly.
- Encourages one-off state surgery outside the tournament engine.
- Weak auditability.

`Jumping straight to Playwright`

- Premature.
- Browser automation still needs a deterministic signed-in tournament fixture first.
- It does not solve the environment problem by itself.

## 3. Exact Implementation Proposal

Do not implement in this pass. If requested later, keep the change surface small and tournament-only.

### Preferred shape

Use two pieces:

1. A server-side QA seed helper that prepares deterministic tournament states.
2. A thin entry point to invoke it locally or on staging under explicit guards.

### Likely minimal files

Server:

- `server/src/scheduledTournament/qaSeed.ts`
  - new helper with all tournament QA fixture logic
  - builds one seeded 8-player tournament
  - inserts only the QA human into `scheduled_tournament_registrations`
  - fills remaining bracket entrants with bot ids that already match tournament naming conventions
  - optionally advances the seeded tournament into specific QA states

- `server/src/scheduledTournament/qaSeed.test.ts`
  - narrow tests for guardrails and fixture creation

- `server/src/scheduledTournament/persistence.ts`
  - only if the helper needs one or two tiny persistence utilities not already exposed
  - avoid touching runtime logic

- `server/src/index.ts`
  - register a dev-only harness entry point only if a route is truly needed
  - preferred alternative: expose no route and use a script instead

- `server/package.json`
  - optional script such as `qa:tournament:seed`

Documentation:

- `docs/tournament-p0-browser-qa-environment-unblock-plan.md`
  - this plan
- optional follow-up usage doc if the harness is implemented

Optional client surface, only if absolutely necessary:

- `client/src/auth/useAuth.ts`
  - avoid changes if normal sign-in is viable
- `client/src/lib/supabase.ts`
  - avoid changes if normal sign-in is viable

Recommendation: do not add a client dev-only auth injector unless normal QA sign-in proves impossible in local/staging.

### Preferred invocation model

Best option:

- CLI-style server seed script, for example:
  - `npm run qa:tournament:seed --prefix server -- --state waiting_room`

Fallback option if CLI proves too awkward for staging:

- a dev-only POST route such as `/api/dev/tournament-qa/seed`
- only mounted when both guards are true
- never documented as a public API

### Supported QA fixture states

The helper should support a small explicit state enum, not arbitrary mutation:

- `waiting_room`
- `bracket_lock`
- `assigned_qf`
- `live_qf`
- `near_30_qf`
- `overlay_qf_win`
- `overlay_qf_loss`
- `post_qf_bracket`
- `assigned_sf`
- `assigned_final`
- `champion_path`

Important constraint:

- default fixtures should preserve real gameplay
- near-terminal fixtures are acceptable only for overlay / reload / slow-network verification
- do not fabricate impossible bracket states

## 4. Safety Guardrails

The harness must satisfy all of the following:

- Impossible or clearly disabled in production.
- Requires explicit `ENABLE_QA_TOURNAMENT_SEED=1`.
- Uses only local or non-production staging data.
- Uses an explicit QA user, never a real player account.
- Never touches production tournaments.
- Never exposes a permanent public API surface by default.
- Logs clearly when used:
  - who seeded
  - which tournament id
  - which fixture state
  - which QA user id
- Does not bypass gameplay rules for normal play-path verification.
- Does not fake match results unless explicitly creating a near-terminal fixture for overlay / reload testing.
- Is easy to remove after Tournament P0 browser sign-off.

Recommended additional guard:

- Refuse to run unless `SUPABASE_URL` clearly points at local/staging, or unless an explicit `QA_ALLOW_NONLOCAL_STAGING=1` override is present.

## 5. QA States The Harness Should Support

The harness should support the minimum states needed to finish the blocked matrix honestly:

`Registered user in waiting room`

- proves signed-in registration, waiting room rendering, and reload-in-lobby behavior

`Bracket lock`

- proves transition from registration to bracket lobby without stale controls

`Assigned QF match`

- proves match-ready attach and reload-before-join

`Active live tournament match`

- proves HUD target, draw animation, rack spacing, reconnect, and live reload

`Near-score-30 live match`

- proves final-move timing, slow-network behavior, and tournament end trigger

`Game-over overlay state`

- proves overlay visibility, persistence, and reload-during-overlay recovery

`Post-match bracket return`

- proves return-to-bracket navigation and staged reveal

`Human loss path`

- proves elimination state and no stale next-match prompt

`Human win path`

- proves progression from QF to SF to Final

`Mostly-bot tournament through champion`

- proves the full single-human bracket path without requiring a second tester

## 6. Minimal Next Execution Plan

After the harness exists:

1. Sign in with the non-production QA account in a clean browser.
2. Seed `waiting_room` and rerun:
   - `TQ-01` through `TQ-06`
   - `TQ-19`
3. Seed `assigned_qf` and rerun:
   - `TQ-06`
   - `TQ-20`
   - `TQ-21`
   - `TQ-25`
   - `TQ-27`
4. Seed `live_qf` and rerun:
   - `TQ-07`
   - `TQ-08`
   - `TQ-09`
   - `TQ-22`
   - `TQ-26`
5. Seed `near_30_qf` and rerun:
   - `TQ-10`
   - `TQ-11`
   - `TQ-28`
6. Seed `overlay_qf_win` and `post_qf_bracket` and rerun:
   - `TQ-12`
   - `TQ-13`
   - `TQ-23`
   - `TQ-24`
7. Seed win/loss progression states and rerun:
   - `TQ-14`
   - `TQ-15`
   - `TQ-16`
   - `TQ-17`
   - `TQ-18`
   - `TQ-29`
8. Update:
   - [docs/tournament-p0-browser-qa-results.md](/Users/olivermorid/racehorse-dominoes/docs/tournament-p0-browser-qa-results.md)

Recommendation on execution order:

- First prove one honest end-to-end mostly-bot run.
- Then use targeted fixture states only for reload / disconnect / overlay edge cases that are too slow to reach manually.

## 7. Do Not Touch

- No P1 waiting room polish
- No bracket redesign
- No `ranked_games` migration
- No durable rooms work
- No public auth changes
- No production DB mutation
- No bot AI changes
- No server engine rewrite
- No broad `App.tsx` refactor
- No Daily Fritz changes
- No Daily Puzzle changes
- No Ghost changes
- No Quick Match changes
- No Private Multiplayer changes
- No Learn changes
- No Social / Leaderboards / Share changes unless a direct Tournament QA harness dependency is proven

## Recommended Decision

If implementation is requested, build the harness in this order:

1. Non-production QA user identification via env
2. Server-side tournament QA seed helper
3. CLI entry point
4. Optional dev-only route only if staging needs remote triggering
5. Only then rerun the blocked Tournament P0 browser matrix

This keeps the unblock work small, auditable, and honest, while avoiding tournament gameplay changes or risky long-lived backdoors.

## Implemented Harness

The first harness pass is now implemented as a server-side CLI helper only. No client auth spoofing was added, and no dev HTTP seed route was introduced.

### Required env vars

- `ENABLE_QA_TOURNAMENT_SEED=1`
- `QA_TOURNAMENT_USER_ID=<non-production Supabase user UUID>`
- `SUPABASE_URL=<local or staging Supabase URL>`
- `SUPABASE_SERVICE_KEY=<service role key>`

Optional override:

- `QA_ALLOW_NONLOCAL_STAGING=1`
  - required when `SUPABASE_URL` is an obvious non-local hosted Supabase URL such as `*.supabase.co`

### Safety guards

The implemented helper refuses to run when:

- `NODE_ENV === "production"`
- `ENABLE_QA_TOURNAMENT_SEED` is missing
- `QA_TOURNAMENT_USER_ID` is missing or invalid
- `SUPABASE_URL` is missing
- `SUPABASE_URL` looks like a non-local hosted Supabase environment and `QA_ALLOW_NONLOCAL_STAGING=1` is not set

The harness also cancels prior active QA fixtures for the same QA user before creating a new one, but only for tournaments created with the harness marker format.

### Commands

Build the server first:

```bash
npm run build --prefix server
```

Then run one of:

```bash
npm run qa:tournament:seed --prefix server -- --state waiting_room
npm run qa:tournament:seed --prefix server -- --state bracket_lock
npm run qa:tournament:seed --prefix server -- --state assigned_qf
```

### Supported states

- `waiting_room`
- `bracket_lock`
- `assigned_qf`
- `live_qf` — DB `in_progress` + `qa_fixture:live_qf`; running server applies mid-game snapshot on attach
- `near_30_qf` — DB `in_progress` + `qa_fixture:near_30_qf`; human score 29 on attach
- `overlay_qf_win` — DB `in_progress` + `qa_fixture:overlay_qf_win`; `gameOver` overlay snapshot on attach

### Unsupported states

These currently fail fast with explicit `fixture_state_not_implemented:*` errors:

- `overlay_qf_loss`
- `post_qf_bracket`
- `assigned_sf`
- `assigned_final`
- `champion_path`

### What each implemented state does

`waiting_room`

- creates a non-production 8-player QA tournament
- inserts exactly one `scheduled_tournament_registrations` row for the QA user UUID
- does not insert bot ids into `scheduled_tournament_registrations`
- prepares the remaining seven seats conceptually as Fritz fixture entrants for later bracket generation
- leaves the tournament in registration-open waiting-room state

`bracket_lock`

- creates the same 8-player QA field
- inserts exactly one real registration row for the QA user
- builds the other seven bot entrants only in the bracket-generation fixture input
- generates the bracket
- leaves the tournament in bracket-lobby state after registration close and before scheduled start

`assigned_qf`

- creates the same 8-player QA field
- inserts exactly one real registration row for the QA user
- builds the other seven bot entrants only in the bracket-generation fixture input
- generates the bracket
- resolves bot-only quarterfinals that would already be valid after scheduled start
- dispatches the QA user’s quarterfinal into `ready` state with a room code in DB
- note: because this runs as a separate CLI process, the live room is not expected to persist in the CLI process; the real server attach path can repair/recreate the in-memory room from match DB state

### Bot registration bug fix

The first harness version incorrectly tried to insert bot ids like `bot:fritz:<tournamentId>:1` into `scheduled_tournament_registrations.user_id`.

That failed because:

- `scheduled_tournament_registrations.user_id` is a UUID column
- tournament bot ids are string tokens, not `auth.users.id` UUIDs

The harness now uses the correct model:

- only the QA human is inserted into `scheduled_tournament_registrations`
- bots exist only as seeded fixture entrants passed into tournament bracket generation
- cleanup cancels prior active QA fixtures by the harness format marker `qa_browser_p0`, including failed partial fixtures with zero registrations

### Exact next browser QA steps

1. Sign in normally with the QA account in the browser.
2. Run:
   - `npm run qa:tournament:seed --prefix server -- --state waiting_room`
3. Execute:
   - `TQ-01` partial registration path
   - `TQ-02`
   - `TQ-03`
   - `TQ-19`
4. Run:
   - `npm run qa:tournament:seed --prefix server -- --state bracket_lock`
5. Execute:
   - `TQ-04`
   - `TQ-05`
   - `TQ-20`
6. Run:
   - `npm run qa:tournament:seed --prefix server -- --state assigned_qf`
7. Execute:
   - `TQ-06`
   - `TQ-07`
   - `TQ-21`
   - `TQ-25`
   - `TQ-27`
8. Update:
   - [docs/tournament-p0-browser-qa-results.md](/Users/olivermorid/racehorse-dominoes/docs/tournament-p0-browser-qa-results.md)

Current unblock status:

- `waiting_room`: unblocked
- `bracket_lock`: unblocked
- `assigned_qf`: unblocked at the DB + attach-repair level
- later progression fixtures (`post_qf_bracket`, `assigned_sf`, `champion_path`, etc.): still not implemented
