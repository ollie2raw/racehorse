# Production Readiness Audit

Date: 2026-06-13  
Scope: repository-wide production-readiness audit after the recent App/AppRoutes extraction, performance hardening, social polling cleanup, and asset optimization passes.  
Policy: read-only audit except for this document. No application code, config, or schema changes were made in this pass.

## 1. Executive Summary

Racehorse Dominoes is a strong prototype with real game logic, meaningful server test coverage, and improving frontend performance, but it is **not yet a reliable self-serve production prototype**. The biggest remaining risks are not visual polish. They are:

- daily-mode result authority gaps
- broken route restoration / history semantics in the current frontend shell
- process-local live room, queue, and tournament runtime state
- weak release confidence on the client because lint is failing badly and browser coverage is narrow
- no concurrency certification through real load testing

### Resolved since the initial audit draft

- **Resolved 2026-06-13:** `GET /api/tournaments/my` no longer trusts query `userId`; it now requires bearer auth and derives identity from the token. Verified by `server/src/scheduledTournament/routes.test.ts`.
- **Resolved 2026-06-13:** `friend:invite` no longer trusts `payload.fromUserId` or `payload.fromUsername`, and now requires an authenticated room member inviter. Verified by `server/src/social/registerFriendInviteHandlers.test.ts`.

### Strongest areas

- Core server-side game rules and parity coverage are strong:
  - `server/src/game/__tests__/engine.test.ts`
  - `server/src/game/__tests__/racehorse-invariants.test.ts`
  - `server/src/game/__tests__/openEndsGeometry.test.ts`
  - `server/src/game/engineParity.test.ts`
  - `client/src/bot/engineParity.behaviorTests.ts`
- Private multiplayer session logic has good targeted server coverage:
  - `server/src/multiplayer/registerRoomSessionHandlers.private.test.ts`
  - `server/src/multiplayer/registerRoomSessionHandlers.abandon.test.ts`
  - `server/src/multiplayer/handMasking.test.ts`
  - `server/src/multiplayer/roomGameplayLock.test.ts`
- Tournament server coverage is materially better than earlier audits:
  - `server/src/scheduledTournament/routes.test.ts`
  - `server/src/scheduledTournament/recovery.test.ts`
  - `server/src/scheduledTournament/matchDispatch.test.ts`
  - `server/src/scheduledTournament/socketHandlers.auth.test.ts`
- Current build health is good:
  - `npm run build --prefix client`: pass
  - `npm run build --prefix server`: pass
  - `npm run test --prefix server`: pass, 49 files / 391 tests

### Weakest areas

- `server/src/index.ts` Daily Fritz endpoints trust client-reported progression and results
- `server/src/dailyPuzzleSubmissionValidation.ts`: validates legality and recomputes score, but does not enforce puzzle objective constraints
- `client/src/App.tsx` and `client/src/AppRoutes.tsx`: route/deep-link/history restoration is structurally incomplete
- live multiplayer and matchmaking remain single-process memory in `server/src/rooms.ts` and `server/src/matchmaking/queueService.ts`
- client lint baseline is failing (`npm run lint --prefix client` -> 363 errors / 97 warnings)

### Demo-readiness verdict

- **Operator-led demo:** yes, with caveats.
- **Investor / stakeholder hands-on prototype:** not yet. It is too easy to hit broken route restoration, missing deep-link restoration, or auth-sensitive edge cases without an operator guiding the session.

### Capacity-readiness verdict

These are **not proven** by code inspection. No concurrency tier is certified without load evidence.

| Tier | Verdict | Why |
|---|---|---|
| 10 simultaneous players | Not proven. Plausible for a controlled demo on one healthy instance. | Existing smoke/tests suggest low-scale viability, but no formal load result exists and live state is still process-local. |
| 100 simultaneous players | Not proven and currently risky. | Single-instance room/queue/scheduler assumptions, incomplete observability, and inefficient query paths become operational risks. |
| 1,000 simultaneous players | Not ready. | Current architecture is not horizontally safe for live rooms/tournaments, and no shared state, lease, or distributed limiter exists. |

## 2. Current Verified Baseline

### Commands run in this audit

| Command | Result | Notes |
|---|---|---|
| `npm run build --prefix client` | Pass | Current bundle data captured below. |
| `npm run build --prefix server` | Pass | TypeScript server build completed successfully. |
| `npm run test --prefix server` | Pass | 49 files / 391 tests passed. |
| `npm run test:bot --prefix client` | Pass | Bot heuristics behavior tests passed. |
| `npm run test:hand-lifecycle --prefix client` | Pass | Hand lifecycle behavior tests passed. |
| `npm run test:open-ends --prefix client` | Pass | Open-ends geometry behavior tests passed. |
| `npm run lint --prefix client` | Fail | 460 problems total: 363 errors / 97 warnings. |

### Current bundle and chunk baseline

From the current `client` production build:

- eager entry: `dist/assets/index-BeavUABv.js` — `423.64 kB` minified, `127.55 kB` gzip
- route shell: `dist/assets/AppRoutes-f92EmTyN.js` — `1,354.10 kB` minified, `66.13 kB` gzip
- charts vendor chunk: `dist/assets/vendor-charts-Bd5iiNp4.js` — `396.62 kB` minified, `116.34 kB` gzip
- bot gameplay chunk: `dist/assets/BotMatchScreen-CqGmLMIT.js` — `179.07 kB` minified

The build still emits the large-chunk warning. `AppRoutes` remains lazy-loaded but still loads during home rendering because the home experience depends on it.

### Carry-forward verified context from the current hardening cycle

These were verified earlier in the current hardening cycle and were not contradicted by this audit:

- signed-out `GET /api/daily-fritz/today` 401 noise was removed by gating the home request on `authUser?.id`
- AppRoutes lazy-loading did not introduce a chunk-load regression in browser QA
- signed-in and signed-out homepage Daily Fritz behavior was browser-verified after that guard

### Environment and evidence limitations

- The worktree is dirty. This audit reflects the current tree, not a tagged release artifact.
- No live production load testing was performed.
- No destructive database tests were performed.
- No broad browser E2E suite was run in this pass.
- Render/Supabase runtime metrics, quotas, connection pool metrics, and prod incident history were not available from the repo alone.
- Static inspection cannot certify 10/100/1,000 concurrent-player readiness.

## 3. Feature Readiness Matrix

| Area | Status | Evidence | Remaining work | Priority |
|---|---|---|---|---|
| Authentication and session restoration | Partially verified | Auth-gated API patterns are common; homepage Daily Fritz signed-in/out behavior was previously verified. | Broader browser verification under expired sessions and reconnect states. | P1 |
| Signed-out experience | Partially verified | Signed-out homepage Daily Fritz 401 was fixed earlier; signed-out root/multiplayer rendered in prior QA. | Need broader signed-out sweep for other auth-required calls. | P2 |
| Home/dashboard | Partially verified | Build passes; prior browser checks succeeded. | Still tied to large `AppRoutes` chunk and incomplete route restoration semantics. | P1 |
| Play vs Fritz | Partially verified | Client behavior tests pass; core engine parity is strong. | Needs browser release QA on setup/result/resume and older-device perf. | P2 |
| Daily Fritz | Partially verified | UI lifecycle tests exist; server auth exists. | Server authority gap is a blocker for reliability claims. | P0 |
| Daily Puzzle Ladder | Partially verified | Server submission validation and ladder stabilization tests pass. | Objective enforcement gap and competitive-integrity review remain. | P1 |
| Learn lessons / guided matches | Untested | Code exists; no adjacent automated coverage found for guided flows. | Add regression coverage and browser QA. | P2 |
| Multiplayer Quick Match | Partially verified | Queue logic and pairing tests exist. | Signed-out ranked flow mismatch and no full end-to-end queue smoke. | P1 |
| Private Match / room codes | Partially verified | Strong private-room tests and socket smoke coverage. | Still process-local; room options mostly cosmetic. | P1 |
| Friend challenges / social activity | Partially verified | Social routes and presence tests exist; inviter identity and room authorization are now covered by `server/src/social/registerFriendInviteHandlers.test.ts`. | Still needs broader end-to-end challenge flow coverage. | P1 |
| Ghost mode | Partially verified | `/api/ghost/complete` is now auth-checked. | Coverage remains thin; mode still needs dedicated tests. | P2 |
| Scheduled tournaments | Partially verified | Strong server test coverage for auth, dispatch, recovery, attach, and completion. `/api/tournaments/my` is now auth-derived and covered by route tests. | Multi-instance race risks and browser QA gaps remain. | P1 |
| Leaderboards | Partially verified | Ranking payload tests and server routes exist. | Idempotency gaps and heavy query paths remain. | P1 |
| Friends | Partially verified | Friends/social polling was hardened in prior passes. | Accessibility semantics and browser UX coverage remain weak. | P2 |
| League | Untested | Server league logic exists. | No current browser/product verification in this pass. | P2 |
| Navigation / route restoration | Broken | `client/src/App.tsx`, `client/src/appRouteTypes.ts`, `client/src/AppRoutes.tsx`. | Fix path mapping and history semantics. | P0 |
| Loading / empty / offline / reconnect / error states | Partially verified | Multiplayer has some recovery surfaces; `ScreenLoader` is accessible. | Global offline awareness and broad browser QA still missing. | P2 |
| Mobile and desktop usability | Untested | No automated mobile/browser suite found. | Add viewport/browser release coverage. | P2 |
| Accessibility / older-audience readability | Partially verified | Some accessible primitives exist, but modal semantics are inconsistent. | Fix semantics and run keyboard/screen-reader checks. | P1 |

## 4. Gameplay Correctness Audit

### What is well-covered

- Core move legality, draw/pass behavior, end-of-hand rules, and open-end geometry are the most trustworthy part of the codebase today.
- Evidence:
  - `server/src/game/__tests__/engine.test.ts`
  - `server/src/game/__tests__/invariants.test.ts`
  - `server/src/game/__tests__/racehorse-invariants.test.ts`
  - `server/src/game/__tests__/openEndsGeometry.test.ts`
  - `server/src/game/engineParity.test.ts`
  - `client/src/bot/engineParity.behaviorTests.ts`
  - `client/src/game/openEndsGeometry.behaviorTests.ts`
- Bot fairness and legality are also materially covered:
  - `server/src/bot/serverBot.fairness.test.ts`
  - `client/src/bot/botHonesty.behaviorTests.ts`

### Gameplay findings

#### P0 — Daily Fritz result authority is too client-trusting

- **Type:** Confirmed defect
- **Affected system or mode:** Daily Fritz
- **Evidence:**
  - `server/src/index.ts:4001` (`/api/daily-fritz/next-hand`) advances `attempt.currentHandIndex` after checking request shape, not a server-validated hand terminal state.
  - `server/src/index.ts:4119` (`/api/daily-fritz/record-game`) accepts client `player_score`, `fritz_score`, `moves_used`, and `hands_played` and appends them into persisted set results.
  - `server/src/index.ts:4231` (`/api/daily-fritz/complete`) verifies only a client-computable hash over client-supplied fields.
  - `server/src/dailyFritz.ts:184` contains the completion-hash builder, but not authoritative move replay.
- **User impact:** incorrect Daily Fritz results, false streaks, or fabricated set outcomes can be recorded.
- **Likely root cause or risk mechanism:** the server authenticates the caller and binds attempts to dates, but it does not replay the deterministic hand stream or independently verify the submitted set result.
- **Recommended action:** move Daily Fritz completion to a server-authoritative verification path that replays or validates the submitted match against the seeded hands and verified session.
- **Verification required:** targeted server tests for forged progression, forged set scores, hand skipping, and replayed completion.
- **Estimated effort:** large
- **Dependencies or blockers:** deterministic replay contract for Daily Fritz and a clear verified-match snapshot model.

#### P1 — Daily Puzzle submission validation does not enforce puzzle objective constraints

- **Type:** Confirmed defect
- **Affected system or mode:** Daily Puzzle Ladder
- **Evidence:**
  - `server/src/dailyPuzzleSubmissionValidation.ts:131-205`
  - validation recomputes legality and score from `submittedLine`, but never checks `slot.maxMoves` or `slot.targetScore`
  - it returns `solved: rawScore > 0`
- **User impact:** a legal line can be accepted even if it misses the intended puzzle target or uses too many moves.
- **Likely root cause or risk mechanism:** validation currently proves “legal line from the given state,” not “line satisfies the authored puzzle objective.”
- **Recommended action:** enforce authored objective fields during validation and make completion/awarded points depend on those constraints.
- **Verification required:** new server tests for too-many-moves, wrong-target-score, and alternate-legal-but-unsolved lines.
- **Estimated effort:** medium
- **Dependencies or blockers:** clear puzzle-authoring contract for target score and max-move semantics.

### Additional gameplay gaps

- Ghost mode correctness is not obviously broken, but it is under-tested relative to its surface area:
  - `server/src/ghost/service.ts`
  - `client/src/bot/BotMatchScreen.tsx`
- Learn/guided matches rely on client-only rules adaptation and recording flows with little regression coverage:
  - `client/src/learn/engine/rulesAdapter.ts`
  - `client/src/learn/guidedMatch/guidedMatchRecorderEngine.ts`

## 5. Multiplayer and Tournament Audit

### What is well-covered

- Private room create/join/start/action handling:
  - `server/src/multiplayer/registerRoomSessionHandlers.private.test.ts`
- Abandon/forfeit flow:
  - `server/src/multiplayer/registerRoomSessionHandlers.abandon.test.ts`
- Hidden-hand masking:
  - `server/src/multiplayer/handMasking.test.ts`
- Per-room serialization:
  - `server/src/multiplayer/roomGameplayLock.test.ts`
- Tournament attach/recovery/auth/dispatch:
  - `server/src/multiplayer/registerRoomSessionHandlers.tournament.test.ts`
  - `server/src/scheduledTournament/recovery.test.ts`
  - `server/src/scheduledTournament/matchDispatch.test.ts`
  - `server/src/scheduledTournament/routes.test.ts`
  - `server/src/scheduledTournament/socketHandlers.auth.test.ts`

### Multiplayer/tournament findings

#### P0 — Live multiplayer, matchmaking, and tournament rooms remain single-process memory

- **Type:** Confirmed missing capability
- **Affected system or mode:** Quick Match, Private Match, live match recovery, scheduled tournaments
- **Evidence:**
  - `server/src/rooms.ts:103` uses an in-memory `Map<RoomCode, Room>`
  - `server/src/matchmaking/queueService.ts:19` explicitly documents an in-memory single-instance queue
  - `server/src/index.ts:1375` describes post-restart matchmaking shell rehydration but explicitly says full game state is not restored
  - `server/src/scheduledTournament/scheduler.ts:25-27` documents single-instance first-release assumptions
- **User impact:** deploys, crashes, or horizontal scaling can drop live rooms, active hands, queue state, reconnect state, and tournament runtime continuity.
- **Likely root cause or risk mechanism:** live authority exists in Node process memory rather than a shared durable runtime.
- **Recommended action:** either keep the product explicitly single-instance for prototype use with disruptive deploy windows, or add shared room state / queue state / scheduler lease before claiming reliability.
- **Verification required:** forced-restart recovery tests and multi-instance staging verification.
- **Estimated effort:** large
- **Dependencies or blockers:** shared state store or durable room snapshot design, scheduler lease design, reconnect contract.

#### Resolution Record — 2026-06-13

- **Resolved:** `GET /api/tournaments/my` now requires bearer auth and derives the user exclusively from the token, ignoring any query `userId`.
  - Verification:
    - `server/src/scheduledTournament/routes.test.ts`
    - full server suite pass: `49 files / 391 tests`
- **Resolved:** `friend:invite` now derives inviter identity from authenticated socket state only and requires the inviter to belong to the referenced room.
  - Verification:
    - `server/src/social/registerFriendInviteHandlers.test.ts`
    - full server suite pass: `49 files / 391 tests`

#### P1 — Ranked quick match is inconsistent for signed-out users

- **Type:** Confirmed defect
- **Affected system or mode:** Quick Match / matchmaking
- **Evidence:**
  - `client/src/App.tsx:270` gives multiplayer a guest id when signed out
  - `client/src/matchmaking/useMatchmaking.ts:127` blocks only on missing identity, not on signed-out guest identity
  - `server/src/matchmaking/index.ts:48-76` explicitly accepts non-UUID guest queue identities
  - `supabase/migrations/2026-05-13_matchmaking.sql:7` expects authenticated UUID users in persisted matchmaking rows
  - `server/src/matchmaking/persistence.ts:39` swallows insert failures and still lets the match play
- **User impact:** a signed-out user can enter a “ranked” queue while persistence and rating semantics diverge from authenticated expectations.
- **Likely root cause or risk mechanism:** the UI and backend disagree on whether quick match is authenticated competitive play or guest casual play.
- **Recommended action:** make quick match explicitly authenticated, or split guest casual queue and ranked queue semantics end to end.
- **Verification required:** browser/socket smoke for signed-out quick match and persistence assertions.
- **Estimated effort:** medium
- **Dependencies or blockers:** product decision on guest quick-match support.

#### P1 — Tournament multi-instance progression remains unsafe

- **Type:** Operational risk
- **Affected system or mode:** Scheduled tournaments
- **Evidence:**
  - `server/src/scheduledTournament/engine.ts:461+` performs read/update advancement logic
  - `server/src/scheduledTournament/scheduler.ts:27` states multi-instance requires a DB lease/lock
- **User impact:** duplicate dispatch, duplicate advancement, or inconsistent no-show handling can occur if multiple schedulers run.
- **Likely root cause or risk mechanism:** scheduler and advancement were built for a single live server instance.
- **Recommended action:** add a DB-backed lease or authoritative scheduler lock before multi-instance tournament operation.
- **Verification required:** two-instance staging test with overlapping scheduler ticks.
- **Estimated effort:** medium-large
- **Dependencies or blockers:** shared lease design.

## 6. Backend, Database, Auth, and Security Audit

### Overall assessment

The backend is stronger than some older audits imply. Current code already has:

- REST rate limiting in `server/src/index.ts`
- socket event rate limiting in `server/src/index.ts`
- auth on `/api/ghost/complete` in `server/src/index.ts:788+`
- strong tournament socket auth tests in `server/src/scheduledTournament/socketHandlers.auth.test.ts`

But the remaining security posture is still not ready for a confident public beta.

### Findings

#### P1 — REST per-IP rate limiting is spoofable behind raw `x-forwarded-for`

- **Type:** Confirmed defect
- **Affected system or mode:** API abuse protection
- **Evidence:** `server/src/rateLimit.ts:58` trusts raw `x-forwarded-for` without a trusted-proxy boundary.
- **User impact:** abusive clients may evade or pollute per-IP limits if the edge does not sanitize headers exactly as expected.
- **Likely root cause or risk mechanism:** the limiter assumes trustworthy proxy headers inside app code.
- **Recommended action:** trust only the platform proxy path, or derive rate-limit identity from trusted proxy configuration rather than raw header parsing.
- **Verification required:** reverse-proxy integration test with spoofed header values.
- **Estimated effort:** small-medium
- **Dependencies or blockers:** deployment edge behavior.

#### P1 — Ranked/public match idempotency is still incomplete

- **Type:** Confirmed missing capability
- **Affected system or mode:** Rankings, stats, public match logging
- **Evidence:**
  - `server/src/stats/recordPublicMatch.ts:12+` does read-then-insert
  - `server/src/index.ts:4733+` and `server/src/ghost/service.ts:893+` create ranked-game payloads
  - `server/src/ranking/rankedGamePayload.ts:39` makes source columns conditional on env
  - `docs/db-idempotency-uniqueness-audit.md`
- **User impact:** retries or duplicate events can create duplicate ranked/public match records, corrupting ratings or history.
- **Likely root cause or risk mechanism:** application-level dedupe exists without hard DB uniqueness guarantees for every ranking path.
- **Recommended action:** add DB-backed uniqueness and make all ranking writes idempotent at the database layer.
- **Verification required:** concurrent duplicate-submit tests and schema assertion tests.
- **Estimated effort:** medium
- **Dependencies or blockers:** migration rollout and environment parity.

#### P1 — Service-role Supabase access makes route auth correctness critical

- **Type:** Operational risk
- **Affected system or mode:** All authenticated backend routes
- **Evidence:**
  - `server/src/supabaseUtils.ts:38` uses service-role-backed calls
  - SQL comments in `server/sql/social/001_player_presence.sql:33` assume service-role bypass
- **User impact:** any missed authz check becomes a real data exposure because RLS is not protecting server calls.
- **Likely root cause or risk mechanism:** the server is the trust boundary.
- **Recommended action:** audit every server route/event that accepts user IDs or usernames from clients and add route tests for wrong-user access.
- **Verification required:** targeted authz test matrix across tournament, social, profile, and ranking routes.
- **Estimated effort:** medium
- **Dependencies or blockers:** none

### Additional backend risks

- No checked-in external alerting, metrics sink, or error tracker was found. `docs/production-observability-and-release-runbook.md` describes the missing setup rather than proving it exists.
- Backup/restore and rollback readiness were not proven from the repository alone.

## 7. Frontend, UX, Accessibility, and Performance Audit

### Frontend correctness and UX findings

#### P0 — Route restoration, deep-linking, and browser history are structurally broken

- **Type:** Confirmed defect
- **Affected system or mode:** Navigation and route restoration across the app
- **Evidence:**
  - `client/src/App.tsx:125-145`
    - `SOCKET_MODES` includes `bot`, `botSetup`, `ghost`, and `ghostSetup`
    - `MODE_TO_PATH` omits valid `AppMode`s such as `leaderboard`, `profile`, and `feed`
  - `client/src/App.tsx:159-166` initializes `appMode` from a partial hash map and falls back to `home`
  - `client/src/App.tsx:203-206` rewrites the URL with `navigate(path, { replace: true })`
  - `client/src/appRouteTypes.ts:20-36` includes modes that are not restorable by path
  - `client/src/AppRoutes.tsx:679`, `715`, `745` use in-memory `profileTarget` flows that do not restore by URL and do not return the user to their prior screen
- **User impact:** refresh, bookmark, and back-button behavior are wrong for several real user flows.
- **Likely root cause or risk mechanism:** app-local `appMode` remains the source of truth while routing is only a partial projection.
- **Recommended action:** make route state authoritative for restorable screens and stop flattening navigation history via `replace: true` for ordinary screen transitions.
- **Verification required:** browser tests for back/forward, refresh, direct deep-links, and profile/friends/feed close behavior.
- **Estimated effort:** medium-large
- **Dependencies or blockers:** navigation contract decision for socket/live-match screens.

#### P1 — Client quality gate is failing

- **Type:** Confirmed defect
- **Affected system or mode:** Frontend release confidence
- **Evidence:** `npm run lint --prefix client` fails with `363 errors / 97 warnings`, including hook dependency and manual memoization issues in:
  - `client/src/App.tsx`
  - `client/src/useAppSessionRuntime.ts`
- **User impact:** lower confidence in the recent runtime extraction surface; easier regression risk during further changes.
- **Likely root cause or risk mechanism:** the build is the only consistently enforced client gate; lint is not release-clean.
- **Recommended action:** restore a passing lint baseline, starting with the routing/runtime surface and genuine hook/memoization issues before stylistic cleanup.
- **Verification required:** clean lint run in CI/local release gate.
- **Estimated effort:** medium
- **Dependencies or blockers:** none

#### P1 — Accessibility semantics are inconsistent

- **Type:** Product polish
- **Affected system or mode:** Friends/profile overlays, custom dialogs
- **Evidence:**
  - `client/src/friends/FriendsScreen.tsx:311` uses `role="dialog" aria-modal="true"` while rendering as a full route in `client/src/AppRoutes.tsx:667`
  - `client/src/AppRoutes.tsx:946` implements a custom welcome dialog without using the shared modal primitive
  - shared modal already handles Escape close: `client/src/components/primitives/Modal.tsx:14`
- **User impact:** keyboard/screen-reader behavior can be confusing or incorrect.
- **Likely root cause or risk mechanism:** modal semantics are applied inconsistently across route screens and overlays.
- **Recommended action:** normalize modal semantics and run keyboard-only / screen-reader smoke on critical flows.
- **Verification required:** manual accessibility QA and targeted browser tests.
- **Estimated effort:** medium
- **Dependencies or blockers:** none

### Performance baseline

Recent passes materially improved timer-driven rerenders, image payload, and social polling noise. Remaining frontend performance concerns are now:

- `AppRoutes` chunk still too large for the home path
- `vendor-charts` still heavy
- `BotMatchScreen` remains a large gameplay UI chunk
- no global offline awareness found in `client/src`

## 8. Capacity Readiness

### Current architectural limits

- live rooms: process-local (`server/src/rooms.ts`)
- queue: process-local (`server/src/matchmaking/queueService.ts`)
- scheduler: single-instance assumption (`server/src/scheduledTournament/scheduler.ts`)
- rate limiting: process-local memory (`server/src/rateLimit.ts`)
- observability: no proven external metrics/alerting sink in repo

### Tier verdicts

#### 10 simultaneous players

- **Verdict:** not proven; plausible for a controlled demo/beta on one healthy instance
- **What supports that:** current server test suite, existing socket smoke scripts, single-instance architecture, and recent performance hardening
- **What blocks certification:** no formal load result, no restart/recovery certification, no browser E2E release suite

#### 100 simultaneous players

- **Verdict:** not proven and currently risky
- **Primary blockers:**
  - single-instance live room/queue state
  - incomplete observability
  - expensive leaderboard/social query patterns
  - tournament multi-instance unsafety
  - no reconnect-storm evidence

#### 1,000 simultaneous players

- **Verdict:** not ready
- **Primary blockers:**
  - no horizontally safe live-state model
  - no distributed limiter
  - no multi-instance scheduler lease
  - no capacity data for Socket.IO fan-out, Supabase query rates, or reconnect storms

### Proposed load-testing plan

#### Tools

- Already available:
  - `client/scripts/socketSmoke.mjs`
  - `client/scripts/stressTest.mjs`
  - `npm run test:smoke:sockets --prefix client`
  - `npm run test:smoke:sockets:stress --prefix client`
- Recommended additions for real capacity work:
  - k6 or Artillery for HTTP + websocket orchestration
  - a dedicated staging stack with isolated Supabase project and non-production auth users

#### Scenarios

1. **Quick Match churn**
   - signed-in users join/leave queue repeatedly
   - steady state matches active, some reconnects, some abandoned games
2. **Private match stability**
   - room create/join/start/move/hand-ready/rematch under moderate concurrency
3. **Reconnect storm**
   - 20-30% of active sockets disconnect and reconnect within 30 seconds
4. **Tournament dispatch window**
   - concentrated registration plus simultaneous match dispatch/attach
5. **Leaderboard/social read pressure**
   - repeated feed/friends/leaderboard loads during active play windows
6. **Cold-start + live traffic**
   - instance wake-up followed by burst joins and daily-mode reads

#### Metrics to collect

- server CPU and memory
- event loop lag
- Socket.IO connected count
- room count, queue length, active match count
- per-event ack latency (`queue:join`, `room:join`, `game:action`, `hand:ready`, `tournament:attach_assigned_match`)
- HTTP p50/p95/p99 latency
- Supabase request count, timeout rate, 4xx/5xx rate
- reconnect success rate and time-to-recover
- duplicate match/tournament completion count

#### Ramp-up pattern

- **10-player certification:** ramp 2 -> 5 -> 10 over 10 minutes, hold 15 minutes
- **100-player certification:** ramp 10 -> 25 -> 50 -> 100 over 20 minutes, hold 30 minutes
- **1,000-player certification:** only after architecture changes; ramp 100 -> 250 -> 500 -> 1,000 over 30 minutes, hold 60 minutes

#### Failure thresholds

- no incorrect winners, duplicate completions, or stuck active matches
- no unbounded queue growth
- no crash/restart
- no more than 1% failed socket joins/acks at target tier
- reconnect recovery succeeds for at least 95% of simulated reconnects within 10 seconds
- no sustained Supabase timeout spike

#### Data cleanup plan

- use isolated QA/staging users only
- write test data into staging only
- record generated room codes, attempt IDs, tournament IDs, and user IDs per run
- truncate or delete staging matchmaking, match-history, daily-attempt, tournament, and social artifacts after each certification run

#### Certification criteria

- **10 players:** all scenarios above pass on one staging instance with no duplicate or lost match results
- **100 players:** same, plus reconnect storm and tournament dispatch pass with acceptable latency and no state loss
- **1,000 players:** only after horizontal-scaling architecture changes and multi-instance staging validation

## 9. Testing and Observability Gaps

- No general `client` test script beyond targeted behavior tests (`client/package.json`)
- No checked-in browser E2E suite for route restoration, friends/profile flows, quick-match end-to-end, or tournament attach/reconnect
- Existing browser QA scripts are bespoke and environment-sensitive:
  - `client/scripts/dailyFritzHandLifecycleQa.mjs`
  - `client/scripts/browserOnlineSmoke.mjs`
- No full quick-match smoke from `queue:join` -> `queue:matched` -> auto-join -> completion
- No friend-challenge socket tests
- No daily-mode authority tests proving forged submissions are rejected
- No proven external error tracking, dashboards, or alerts
- No load-test certification results for any concurrency tier

## 10. Prioritized Remaining Backlog

### P0

1. **Fix route restoration / history semantics**
   - Type: Confirmed defect
   - Critical path because it affects basic browser reliability across multiple screens.
2. **Make Daily Fritz server-authoritative**
   - Type: Confirmed defect
3. **Define and enforce live-room reliability posture**
   - Type: Confirmed missing capability
   - Either explicitly single-instance/operator-managed for prototype use, or add durable/shared runtime before claiming reliability.

### P1

1. **Enforce Daily Puzzle objective constraints server-side**
   - Type: Confirmed defect
2. **Resolve quick-match guest/ranked identity mismatch**
   - Type: Confirmed defect
3. **Restore passing client lint baseline**
   - Type: Confirmed defect
4. **Close ranked/public match idempotency gaps**
   - Type: Confirmed missing capability
5. **Add tournament multi-instance lease plan and tests**
   - Type: Operational risk
6. **Add browser coverage for queue, tournament attach/reconnect, and route restoration**
   - Type: Testing gap
7. **Harden rate-limit identity behind trusted proxy behavior**
   - Type: Confirmed defect
8. **Ship real error tracking and alerting**
   - Type: Confirmed missing capability

### P2

- Add Ghost and Learn regression coverage
- Improve accessibility semantics for dialogs/full-screen routes
- Add global offline awareness and broader empty/error-state QA
- Reduce `AppRoutes` and chart startup weight further if it remains a measured bottleneck
- Optimize heavy leaderboard/social query patterns before broader beta

### P3

- Further maintainability cleanup in large runtime files once correctness and operational issues are closed
- Additional non-critical UI polish and analytics funnel improvements

## 11. Prototype Completion Plan

### Phase 1: Correctness and State Integrity

- Make Daily Fritz server-authoritative
- Enforce Daily Puzzle objective constraints
- Close ranked/public match idempotency gaps

### Phase 2: Core-Mode Browser Reliability

- Repair route restoration, deep-linking, and browser history behavior
- Add browser QA for:
  - home/dashboard
  - Play vs Fritz
  - Daily Fritz
  - quick match
  - private match
  - tournament hub/bracket/attach/reconnect/result
  - friends/profile/feed close/back flows
- Restore passing client lint baseline

### Phase 3: Security and Operational Readiness

- Harden rate-limit identity for real proxy deployment
- Audit authz across service-role-backed server routes/events
- Add structured error tracking and alerting
- Document explicit deploy/restart policy for live rooms

### Phase 4: Load Testing and Scaling

- Run staging load tests for the 10-player tier
- Decide whether the prototype stays intentionally single-instance
- If not, add shared room/queue state and tournament scheduler lease
- Only then attempt 100-player and 1,000-player certification

### Phase 5: Final Prototype Polish

- Accessibility cleanup
- Offline/slow-network UX improvements
- Additional bundle and mobile polish as needed from measurement

## 12. Definition of Done

### Demo-ready prototype

- Core signed-in and signed-out flows work in browser QA without operator intervention
- Route restoration and back-button behavior work for all major restorable screens
- No known P0 defects remain
- Client and server builds pass
- Targeted client behavior tests and full server suite pass
- Client lint passes or remaining exceptions are explicitly waived and documented

### Reliable for 10 simultaneous players

- Demo-ready checklist complete
- Single-instance live-room policy is explicit and tested
- Staging load test at 10 concurrent players passes with no duplicate/lost results
- Reconnect storm scenario passes
- Error tracking and dashboards are active

### Reliable for 100 simultaneous players

- 10-player certification complete
- 100-player staging load passes
- Tournament dispatch/attach passes under concurrent load
- Query hotspots are measured and acceptable
- Operational response playbook exists for deploys, reconnect storms, and Supabase degradation

### Reliable for 1,000 simultaneous players

- 100-player certification complete
- Live-state architecture is horizontally safe
- Distributed limiter and scheduler lease exist
- Multi-instance staging load passes at 1,000 simulated players
- Observability covers Socket.IO, tournaments, daily modes, and Supabase saturation

## Critical Path Recommendation

The next implementation pass should not be another broad refactor. It should be a correctness/security pass with this order:

1. make Daily Fritz authoritative
2. fix route restoration/history behavior
3. close quick-match auth semantics
4. close ranked/public match idempotency gaps

That sequence removes the highest-risk defects without reopening the architecture extraction work just for readability.
