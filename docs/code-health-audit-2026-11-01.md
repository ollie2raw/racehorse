# Code-health audit, 2026-11-01

How each mode and the platform are built, judged against how chess.com's engineering would build the same thing. Companion to `launch-audit-2026-11-01.md` (UI, App Store and ops readiness).

**Method.** Seven independent read-only investigations, one per area, each reading the real code with file:line evidence, plus a repo-wide metrics scan. Nothing was run, profiled or changed. The reads were **sampled, not exhaustive**; every claim an investigator marked *unverified* is marked so below. Server-touching items are held until after the first tournament week (first events Mon 2026-11-02, 18:00 and 21:00 ET).

## Verdict

No P0 found anywhere: nothing that corrupts data or lets a client forge a result. The foundation is genuinely strong: strict TypeScript with zero `any` and zero `@ts-ignore`, a shared rules core, server-verified scoring, idempotent multiplayer actions with fenced persistence, a lease-based tournament orchestrator, and unusually strict CI gates. The gap to chess.com is not correctness, it is **consolidation**: the same thing is built twice or three times in several places, there is no runtime schema validation at the server boundary, a few files are far too large, and the CSS is several design systems layered together.

| Area | Structure | Correctness | Resilience | Testability | Maintainability |
|---|---|---|---|---|---|
| Game engine core | B- | B+ | | A- core / B- client | C+ |
| Multiplayer | B | A- | B | B (server A-, client C+) | B- |
| Tournaments | B | A- | A- | B+ | B- |
| Daily / Puzzle / Ghost | B+ | A- | A- | A- | B- |
| Fritz bot + review | B | B- | | C+ | C+ |
| Journey / Learn / Training | B- | B | | C+ | C |
| Platform / cross-cutting | B- | B | | A- | C+ |

Platform also: observability C+, security hygiene B-.

## What to keep (do not "refactor")

- `packages/game-core` as the single rules authority; the server re-exports it with no fork. Immutable readonly state, oracle-based seeded property tests, replay and parity tests.
- Multiplayer idempotency (per-seat request id, payload fingerprint, durable receipts) and persistence fencing (commit id, writer epoch, generation).
- Tournament orchestrator lease with token epochs and drain; compare-and-set writes; registration RPCs that lock the row; invariants enforced in Postgres.
- Server-derived scoring in Daily Fritz and Puzzle Rush from replayable evidence; the Daily Fritz client view-model split.
- Review job runner (lease, fenced heartbeat, kill switch, idempotent insert) and node-budgeted review-engine.
- Journey's versioned content contract, single completion core and recovery.
- The CI guardrails (architecture, dependency cycles, socket registry, godfile caps, bundle budgets).

## Cross-cutting themes

1. **Built more than once.** (a) A second client match-state engine (`client/src/modules/match/runtime/botEngine.ts`) with its own dealing and shuffle, beside game-core's. (b) `client/src/game/openEndsGeometry.ts` (554 lines) re-implements the scoring-critical function that game-core owns (532 lines); parity is checked on generated boards, not by construction. (c) `server/src/bot/serverBot.ts` is a hand-copied mirror of the client Fritz bot. (d) Three move-quality stacks: `analyzer`, `learning`, `review-engine`, each with its own thresholds. (e) Two Learn systems, one dead. (f) Three unsynced progress stores. (g) Two copies of the Journey lesson validator.
2. **Determinism leaks.** `startNewHand` and the pregame draw default to `Math.random` inside the "pure" core. Fritz's master search stops on wall-clock deadlines (`botHeuristics.ts:538, 555, 1298, 1739, 1753, 1767, 1869, 1872`), so review verdicts and corpus studies depend on CPU speed (the known contested-flag defect).
3. **No runtime schema validation** on socket events or on the 76 HTTP routes; no zod anywhere. Wire protocol is not typed or versioned (`match-protocol` covers commands only), so a stale tab after a deploy has no refusal path.
4. **God-files that mix concerns:** `botHeuristics.ts` 1,931; `generatePuzzles.ts` 1,786; tournament `engine.ts` 1,700; `roomLivePersistence.ts` 1,621; `rooms.ts` 1,509; `ghost/service.ts` 1,264; `MultiplayerGameShell.tsx` 1,222 (50 hooks); `lessonV2.ts` 1,160; `App.tsx` 1,131; `LiveMatchScreen.tsx` 1,050; `useHandLifecycle.ts` 888 (no direct test).
5. **CSS is layered competing systems:** 149 files, 71k lines, 2,823 `!important`, 939 hardcoded hex outside `tokens.css`, 406 gradients (against the matte rule), 32 files still referencing walnut; plus large dead CSS (below).
6. **Uneven tests.** Server and packages are deep (ratio above 1). Thin: `learning` 0.04, `learn` 0.09, `bot` 0.10, client `multiplayer` 0.21.
7. **Observability on HTTP is thin:** no request ids, 55 raw `console.*` calls in server code, raw error text returned in some 500s.

## P1: do these (ranked)

| # | Item | Where | Size | Server? |
|---|---|---|---|---|
| 1 | Tournament bracket: refetch on reconnect/tab return, and show a "data may be old" strip with retry when a refresh fails | `client/src/tournament/useTournament.ts:353,361`; `TournamentBracketScreen.tsx:644-646` | S | No: **ship before Monday** |
| 2 | Raw error text in 500 responses; add one shared error handler and a request-id middleware (also fixes tracing on event night) | `server/src/http/routes/botMatches.ts:83-85,148,181,229`; `dailyFritzAdminRoutes.ts:160` | M | Yes: after week |
| 3 | Remove `Math.random` defaults from game-core (`engine.ts:38`, `pregameDraw.ts:17`); make rng or deck required | game-core | S | Low risk; client+server call sites |
| 4 | Replace client geometry copy with game-core's `computeOpenEndsSum` and friends (keep only client logging wrappers) | `client/src/game/openEndsGeometry.ts` | M | No |
| 5 | Node-budget Fritz search; inject a node budget for review and tests, keep wall-clock only as production safety net. Needs owner sign-off (changes bot strength; rerun fairnessSim/calibrationAudit) | `botHeuristics.ts` | M | No |
| 6 | Zod schemas at every socket event and HTTP route, starting with money paths; shadow-validate first and keep current ack codes | server | L | Yes: after week |
| 7 | Typed, versioned wire protocol in `match-protocol` (event maps, acks, `PROTOCOL_VERSION` in the handshake, explicit `upgrade_required`). Client half is safe now, enforcement after week | `registerGameplayActionHandlers.ts:109` | M-L | Partly |
| 8 | Turn clock / idle-forfeit for casual and rated games (today only tournaments have one; a connected player can stall forever). Needs a product decision | new, reuse `tournamentTurnClock.ts` design | M | Yes: after week |
| 9 | Crash-restart test: kill mid-hand and assert timers, receipts and turn state recover (grace and bot timers appear not to re-arm on rehydrate, *unverified*) | `roomLivePersistence.ts`, `disconnectGrace.ts` | M | Test only |
| 10 | Delete dead Learn v1 and dead CSS (list below) | learn, journey | S+M | No |
| 11 | Guided-match loader: top-level `await fetch` with no catch can take down LearnHome; make it a lazy loader with an error state. Guard `saveLearnProgress` writes with try/catch. Gate the recorder/annotator tools out of the production bundle | `guidedMatchLessonLoader.ts:11-14`; `learn/progress/storage.ts:36` | S-M | No |
| 12 | Dependency advisories (transitive via Express 5.2.1 `proxy-addr`, `body-parser`, `socket.io-parser`, `engine.io`, `compression`; client `dompurify` not imported directly, check `npm ls dompurify`) | package.json | S | Server half after week |
| 13 | Tests for the riskiest untested logic: `coachMessaging.ts` (806 lines of user-facing prose), `learningStore.ts`, `lessonV2.ts` `resolveGuidedMatchStart` and `restoreMatchStateBeforeEvent`, then `useHandLifecycle` | learning, learn | M | No |
| 14 | CSS ratchets in stylelint (`!important` budget, hex ban outside `tokens.css`, gradient ban), then retire `walnut-live.css` and `premium-theme.css` screen by screen | client styles | L in S pieces | No |
| 15 | Daily/Rush: leaderboard dedupes best-run-per-user in memory after a capped fetch, no pagination, own rank beyond 50 not computed (scan limit *unverified*); no per-puzzle minimum solve time | `puzzleRushStore.ts:346-351`, `leaderboard.ts:15-26`, `grading.ts:214-218` | M | Yes: after week |

## P2: structural, schedule after launch-critical work

- **Derive app mode from the router** instead of `appMode` state plus `setAppMode` threaded through 30 files (`App.tsx:101`); move room/socket/match state into a session provider. High risk, do incrementally and cap `App.tsx` LOC in `check:architecture`.
- **One match engine on the client:** reduce `BotMatchState` to a thin view over core `GameState`; make core own dealing, starters and hand lifecycle with an injected rng. Replace `handOpen/handOver/gameOver` booleans with a `phase` union (needs a state-version bump and stored-game migration). Re-export core types from `client/src/types.ts` instead of the hand-mirrored guard.
- **Extract the Fritz engine** into a shared package so the server bot is not a copy; in the meantime add a parity test over a fixed position corpus (S, can go in now).
- **Pull `useHandLifecycle` into a pure reducer** (state + event to state + effects) with an injected clock; pull controller hooks out of `MultiplayerGameShell` and run `recoveryMachine` through a fake-socket reorder/duplicate/disconnect fuzzer.
- **Split god-files by seam:** `botHeuristics.ts` (eval / search / tiers, public API unchanged), `generatePuzzles.ts` (offline generate, validate, small runtime scorer; add a CI check that the shipped pool validates), `ghost/service.ts` (pure analysis out of the DB module), tournament `engine.ts` (pure `decideStaleMatch`), `rooms.ts`, `roomLivePersistence.ts`, `useAuth.ts` (964 lines), `usePostGamePivotalReview.ts`.
- **One "which analysis stack owns what" doc**, then a differential test between the learning coach and review-engine quality thresholds; stamp engine/ruleset/heuristic versions on saved reviews.
- **Tournament server hygiene:** project the public bracket endpoint to a public DTO (it spreads raw match rows incl. `room_code`; the room-join ACL, not read here, is the real defence); paginate or batch `/api/tournaments/history` (3 fetches per completed registration, unbounded); record bot-vs-bot results with an explicit winner source, not `game_over`.
- **Schema single source of truth:** baseline snapshot, everything under `supabase/migrations/`, CI applies migrations to a clean DB and diffs.
- **Boot-time config validation** (zod env schema; prod requires cron secret and CORS; `getEnvInt` currently falls back silently on NaN).
- **Consolidate the 15 raw `fetch` callers** onto `api/client.ts`; consider a query cache for lists.
- **Unify Learn / Journey / learning progress** into a versioned, optionally synced store.
- **Bundle budgets** should ratchet from a committed baseline, not be hand-raised each release.
- **Fixtures out of production `src/`:** `packages/game-core/src/reviewFixtureCorpus.ts` (1,026 lines).
- Doc drift: `orchestratorLease.ts:28` comment says 5..600 s, code clamps 30..600; `HARDENING_PLAN.md` is about 6.4k lines and hard to navigate.

## Delete list (safe-looking, verify with `tsc -b` and `check:architecture`)

- `client/src/learn/LearnScenarioScreen.tsx`, `LessonDebugPanel.tsx`, `LessonCoachPanel.tsx`, `data/lessons.ts`, then `learn/types.ts`
- `client/src/learn/learnHowToPlayPvf.css` (776 lines) and `learnHowToPlayV2.css` (864), no importer anywhere
- `client/src/journey/journeyNodes.ts` (deprecated 2-line shim), `journey/chapters/chapterTemplate.example.ts`
- Duplicate `validateJourneyLessonDefinitionPrimitive` (`journeyContentValidationPrimitives.ts:126`)
- Unreferenced selectors, by substring grep (dynamic class names could inflate these, spot checks held): `racehorseJourney.css` 167 of 242, `learnHowToPlayRacehorse.css` 170 of 205, `learnPlayer.css` 100 of 128, `learn.css` 30 of 94. Roughly 5k of the 12k Learn CSS lines. Use a purge tool and review the diff.
- *Unverified:* whether `LearnPlayer` (level-1 path via `soloPlayRoutes.tsx:133`) is still reachable from the Learn UI.

## Suggested programme (each item its own PR)

1. **Before Monday (client only, small):** bracket reconnect refetch and stale-data strip (#1).
2. **During the event week (client only, no server):** delete list (#10), guided-match loader and storage guards (#11), client geometry de-duplication (#4), seeded-deal cleanup of game-core call sites (#3, client first), parity test for server bot, CSS lint ratchets (#14, first step), tests for `learning` and `lessonV2` (#13).
3. **Week after (server unfrozen):** error handler and request ids (#2), dependency updates (#12), then zod validation and protocol versioning (#6, #7), turn clock (#8, needs your product call), crash-restart test (#9), Rush leaderboard (#15).
4. **Then, one at a time:** node-budgeted Fritz (#5, needs your sign-off), shared Fritz engine, one client match engine, router-owned app mode, god-file splits, schema baseline.

## Caveats

Reads were sampled. Not read in depth: `recoveryMachine.ts`, `MultiplayerGameShell.tsx`, most of `rooms.ts`, `dailyFritzStore.ts`, `ghost/service.ts` internals, the `complete_tournament_match` SQL body, the socket room-join ACL, per-route auth consistency, and whether `logger.ts` is structured. No tests, builds or profiling were run for this audit.
