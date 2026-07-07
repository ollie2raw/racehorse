# Repository Census Refresh — July 2026

**Scope:** Mechanical rescan only. No source code was modified during this pass.  
**Baseline:** `docs/repo-health-audit-2026-07.md` (pre–multi-pass cleanup initiative)  
**Standard:** *Length is not the enemy — undifferentiated responsibility is.*  
**Date:** 2026-07-05

---

## Executive summary

The repo has materially changed since the July 2026 health audit. Several **Tier 1 god-files are resolved or dramatically shrunk** (`registerRoomSessionHandlers`, `DailyFritzScreen`, `PrivateMatchLobbyScreen`, `useTournamentMatchSession`). The **`shellBridgeRef` ref bridge is gone** from the client tree. Tier 2 items `statsApi`, `social/routes`, `LiveMatchScreen` prop grouping, and learning/journey unit tests are **done**.

**Remaining pressure** is now concentrated in: long-but-cohesive domain engines (`reasonTagging`, `lessonV2`, `botHeuristics`), the **app root orchestrator** (`App.tsx` 1,554 LOC), **multiplayer shell** (`MultiplayerGameShell.tsx` 1,037), **routing funnel** (`AppRoutes.tsx` 999), **board renderer instrumentation** (`Board.tsx` 1,152), and the **initiative-created Daily Fritz HTTP layer** (`http/routes/dailyFritz.ts` 931 — single-domain but monolithic route registration).

**Test suite (verified):** Client **71 vitest files / 562 tests PASS** · Server **77 vitest files / 513 tests PASS** · Client also has **30 `*.behaviorTests.ts`** files outside default vitest `include`.

---

## 1. Methodology

Same approach as the original audit, with these exclusions:

```bash
# Primary census (production src)
find client/src server/src -type f \( -name '*.ts' -o -name '*.tsx' \) \
  ! -path '*/node_modules/*' -exec wc -l {} + | sort -rn

# Whole-repo census (TS/TSX/JS) — excludes node_modules, .venv, dist, build
find . \( -path ./node_modules -o -path '*/node_modules' -o -path ./.venv \
  -o -path '*/.venv' -o -path ./dist -o -path '*/dist' -o -path ./build \
  -o -path '*/build' \) -prune -o \
  -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' \) \
  ! -name '*.lock' -print | while read f; do wc -l < "$f" | awk -v f="$f" '{print $1, f}'; done | sort -rn
```

Structural pass for files **>800 LOC**: list top-level exports and one-line single-domain vs multi-domain judgment. No deep behavioral audit.

---

## 2. Inventory deltas vs original audit

| Metric | Original audit | This refresh |
|--------|----------------|--------------|
| Client + server TS/TSX LOC | ~214,000 cited | **158,811** (`client/src` + `server/src`) |
| Client vitest | 60 files / 510 tests | **71 files / 562 tests** |
| Server vitest | 66 files / 490 tests | **77 files / 513 tests** |
| `client/src/multiplayer/` dir LOC | 14,187 | **14,743** (+556 — handler/test growth, not god-file regrowth) |
| `server/src/multiplayer/` dir LOC | 6,875 | **8,266** (+1,391 — session handler split + tests) |
| `client/src/dailyFritz/` dir LOC | 4,644 | **5,242** (+598 — hub decomposition + view models) |
| `client/src/match/` dir LOC | 7,500 | **8,071** (+571 — live match types + session work) |

---

## 3. LOC table — top ~40 TS/TSX/JS files

### 3.1 Primary: `client/src` + `server/src` (production source)

| Rank | LOC | File | Notes |
|------|-----|------|-------|
| 1 | 1,930 | `client/src/modules/fritz/botHeuristics.ts` | Frozen bot evaluator |
| 2 | 1,791 | `server/src/generatePuzzles.ts` | Offline puzzle generator CLI |
| 3 | 1,760 | `server/src/game/__tests__/engine.test.ts` | Test suite |
| 4 | 1,554 | `client/src/App.tsx` | App root orchestrator |
| 5 | 1,344 | `client/src/learning/reasonTagging.ts` | Pure tagging pipeline |
| 6 | 1,160 | `client/src/learn/lessonV2.ts` | Guided lesson runtime |
| 7 | 1,152 | `client/src/components/Board.tsx` | Board renderer |
| 8 | 1,080 | `client/src/modules/match/runtime/botEngine.ts` | Frozen client bot engine |
| 9 | 1,068 | `server/src/rooms.ts` | In-memory room engine |
| 10 | 1,037 | `client/src/multiplayer/MultiplayerGameShell.tsx` | Multiplayer shell |
| 11 | 1,011 | `server/src/ghost/service.ts` | Ghost profile service |
| 12 | 1,004 | `client/src/dailyPuzzle/DailyPuzzleScreen.tsx` | Legacy daily puzzle screen |
| 13 | 999 | `client/src/AppRoutes.tsx` | Mode routing switch |
| 14 | 978 | `client/src/learn/guidedMatch/GuidedMatchRecorderScreen.tsx` | Authoring UI |
| 15 | 937 | `client/src/match/LiveMatchScreen.tsx` | Live PvP view |
| 16 | 931 | `server/src/http/routes/dailyFritz.ts` | Daily Fritz HTTP routes |
| 17 | 914 | `server/src/multiplayer/roomSession.ts` | Room session utilities |
| 18 | 914 | `client/src/learning/moveAnalysis.ts` | Move grading engine |
| 19 | 912 | `client/src/tournament/TournamentBracketScreen.tsx` | Tournament bracket UI |
| 20 | 888 | `server/src/scheduledTournament/engine.test.ts` | Test suite |
| 21 | 870 | `client/src/multiplayer/recoveryMachine.ts` | Frozen recovery FSM |
| 22 | 861 | `client/src/multiplayer/useRoomSocketSync.ts` | Frozen projection gates |
| 23 | 817 | `server/src/scheduledTournament/engine.ts` | Tournament bracket engine |
| 24 | 815 | `client/src/journey/journeyPuzzles.ts` | Static puzzle content bank |
| 25 | 806 | `client/src/learning/coachMessaging.ts` | Coach copy generation |
| 26 | 785 | `client/src/auth/useAuth.ts` | Auth + profile bootstrap |
| 27 | 784 | `server/src/index.ts` | Server bootstrap |
| 28 | 769 | `client/src/learn/guidedAuthoring.ts` | Guided authoring utilities |
| 29 | 754 | `client/src/analyzer/moveAnalyzer.ts` | Post-game analyzer |
| 30 | 741 | `server/src/bot/serverBot.ts` | Server bot |
| 31 | 735 | `client/src/devtools/debugHarness.ts` | Dev-only |
| 32 | 715 | `client/src/dailyFritz/DailyFritzLeaderboardScreen.tsx` | Leaderboard screen |
| 33 | 695 | `client/src/multiplayer/PrivateMatchLobbyControlPanel.tsx` | Lobby decomposition extract |
| 34 | 694 | `client/src/dailyPuzzle/api.ts` | Daily puzzle API client |
| 35 | 693 | `client/src/learn/data/lessons/level1.ts` | Lesson content data |
| 36 | 689 | `client/src/learn/LearnPlayer.tsx` | Learn playback screen |
| 37 | 687 | `server/src/seedDailyPuzzleLadder.ts` | Seeding script |
| 38 | 681 | `server/src/game/engine.ts` | Core domino engine |
| 39 | 678 | `client/src/dailyPuzzle/DailyPuzzleAdminScreen.tsx` | Admin screen |
| 40 | 671 | `client/src/dailyPuzzle/DailyPuzzleLadderLeaderboardScreen.tsx` | Ladder leaderboard |

### 3.2 Whole-repo additions (scripts only in top 40)

| LOC | File |
|-----|------|
| 2,178 | `client/scripts/socketSmoke.mjs` |
| 1,218 | `client/scripts/journeyPhase1Smoke.mjs` |

These are smoke/integration scripts, not production god-file candidates.

### 3.3 Notable shrinkages since original audit

| File | Audit LOC | Current LOC | Status |
|------|-----------|-------------|--------|
| `server/src/multiplayer/registerRoomSessionHandlers.ts` | 1,580 | **101** | Split into `registerRoomJoinHandlers`, `registerGameplayActionHandlers`, `registerMatchStartHandlers`, `registerTournamentAttachHandlers`, `registerRematchPregameHandlers`, `registerRoomAbandonHandlers`, `registerRoomLifecycleHandlers`, `registerRoomSpectateHandlers`, `registerRoomUtilityHandlers`, `roomSocketAttach.ts`, `roomForfeit.ts` |
| `client/src/dailyFritz/DailyFritzScreen.tsx` | 1,211 | **202** | Hub + init/run controllers + `DailyFritzHubView` / `DailyFritzEmbeddedMatchView` |
| `client/src/multiplayer/PrivateMatchLobbyScreen.tsx` | 1,203 | **186** | View model + `PrivateMatchLobbyControlPanel` (695) + `PrivateMatchLobbyMatchupView` |
| `client/src/match/session/useTournamentMatchSession.ts` | 1,110 | **145** | Extracted to `match/session/tournament/**` |
| `client/src/stats/statsApi.ts` | 709 | **309** | Types → `statsTypes.ts`, derivations → `statsDerivations.ts` |
| `server/src/social/routes.ts` | 640 | **100** | Split → `socialAuth`, `socialLeaderboard`, `socialFeed`, `socialFriends`, `socialProfile` |
| `client/src/match/LiveMatchScreen.tsx` | 1,028 | **937** | Props grouped into 11 bundles in `liveMatchScreenTypes.ts` |

---

## 4. Structural pass — files >800 LOC

| File | LOC | Top-level exports (summary) | Judgment |
|------|-----|----------------------------|----------|
| `modules/fritz/botHeuristics.ts` | 1,930 | `toBotVisibleState`, `evaluateMove`, `chooseBotMove` (+ large internal heuristic tables) | **Single-domain — fine** (frozen strategic evaluator) |
| `server/generatePuzzles.ts` | 1,791 | `createHighScorePuzzle`, `generateSetupAndStrikePuzzle`, `computeBestPossiblePuzzleScore`, `validateSetupAndStrikeGeneratedPuzzle` | **Single-domain — fine** (offline generation pipeline) |
| `game/__tests__/engine.test.ts` | 1,760 | Vitest suite | **N/A** (test file) |
| `App.tsx` | 1,554 | `export default function App` (+ `normalizeRoomCode` helper) | **Multi-domain** — auth, socket bus, multiplayer connection/recovery, tournament session, routing, toasts, room persistence; intentional app root but still the widest coupling surface |
| `learning/reasonTagging.ts` | 1,344 | `REASON_TO_CONCEPT`, `extractBoardContext`, `extractMoveFeatures`, `determinePrimaryReason`, `determineSecondaryReason`, `buildConceptTags`, `buildRiskFlags`, `generateShortExplanation`, `generateLongExplanation`, `tagMove` | **Single-domain — fine** (pure tagging pipeline) |
| `learn/lessonV2.ts` | 1,160 | Storage keys, `parseLessonV2BoardState`, `createV2Event`, authoring/frozen/playback loaders, `validateGuidedV2LessonPlayback`, … | **Single-domain — fine** (guided lesson schema + runtime) |
| `components/Board.tsx` | 1,152 | `BoardHandle`, `Board` (memo); internals: `computeLayout`, `layoutBranches`, `BoardComponent` | **Multi-domain** — layout/render/camera + Daily Fritz `traceDailyFritzBoardEvent` instrumentation still wired in render/input paths |
| `modules/match/runtime/botEngine.ts` | 1,080 | `createBotMatch`, `act`, hand lifecycle, scoring helpers | **Single-domain — fine** (frozen client bot engine) |
| `server/rooms.ts` | 1,068 | `createRoom`, `joinRoom`, `act`, `nextHand`, `startGame`, legal-move getters, pregame draw | **Single-domain — fine** (room state machine) |
| `multiplayer/MultiplayerGameShell.tsx` | 1,037 | `MultiplayerGameShell` (memo); single large component composing socket sync, live session, presentation | **Multi-domain** — orchestration shell (socket + session + presentation + analyzer); no ref bridge, but still a composition hub |
| `ghost/service.ts` | 1,011 | `computeFritzRatingChange`, `getGhostProfileSummary`, `getGhostProfileSummaryByUsername`, `completeGhostGame` | **Single-domain — fine** (ghost profiles + match completion); long helpers inside |
| `dailyPuzzle/DailyPuzzleScreen.tsx` | 1,004 | `export default function DailyPuzzleScreen` | **Multi-domain** — legacy daily puzzle hub still mixes init, gameplay, overlays, and submission in one screen (ladder path was decomposed; this screen was not) |
| `AppRoutes.tsx` | 999 | `export default function AppRoutes` | **Multi-domain** — giant mode switch + prop funnel (~87 fields via `useAppRoutesProps`) |
| `learn/guidedMatch/GuidedMatchRecorderScreen.tsx` | 978 | Default screen export only (authoring UI internals) | **Single-domain — fine** (authoring surface; view-heavy) |
| `match/LiveMatchScreen.tsx` | 937 | `LiveMatchScreen`, re-export `LiveMatchScreenProps` | **Single-domain — fine** (render-only live match view; props now bundled) |
| `http/routes/dailyFritz.ts` | 931 | `registerDailyFritzRoutes` — registers 10 `/api/daily-fritz/*` handlers inline | **Single-domain — fine** (all Daily Fritz HTTP); **long monolithic route file** — see §6 |
| `multiplayer/roomSession.ts` | 914 | Roster/reconnect/cleanup utilities, `initRoomSession`, `broadcastStateUpdate`, masking helpers | **Single-domain — fine** (room session infrastructure); large utility surface |
| `learning/moveAnalysis.ts` | 914 | `normalizeMoveId`, `classifyMoveByDelta`, `computeEngineConfidence`, `buildMoveEvaluationResult`, … | **Single-domain — fine** (grading engine; now has unit tests) |
| `tournament/TournamentBracketScreen.tsx` | 912 | Default screen export | **Single-domain — fine** (tournament UI; view-heavy) |
| `scheduledTournament/engine.test.ts` | 888 | Vitest suite | **N/A** (test file) |
| `multiplayer/recoveryMachine.ts` | 870 | `reduceRecovery`, `createRecoveryMachine`, episode helpers | **Single-domain — fine** (frozen recovery FSM) |
| `multiplayer/useRoomSocketSync.ts` | 861 | Projection gate pure functions + `useRoomSocketSync` hook | **Single-domain — fine** (frozen socket projection) |
| `scheduledTournament/engine.ts` | 817 | `generateBracket`, `applyMatchResult`, `completeTournament`, registration lifecycle | **Single-domain — fine** (bracket engine) |
| `journey/journeyPuzzles.ts` | 815 | `JOURNEY_PUZZLES` content record | **Single-domain — fine** (static content bank) |
| `learning/coachMessaging.ts` | 806 | `resolveInterventionDecision`, `buildPreMoveRecommendation`, `buildCoachingFeedback` | **Single-domain — fine** (coach copy from analysis) |

---

## 5. Tier 3 reconciliation (original audit §8)

| # | Original Tier 3 item | Still present? | Current assessment |
|---|---------------------|----------------|-------------------|
| 1 | `modules/fritz/botHeuristics.ts` (1,930) | **Yes** — 1,930 LOC | Unchanged; frozen cohesive evaluator — **still fine** |
| 2 | `learning/reasonTagging.ts` (1,344) | **Yes** — 1,344 LOC | Unchanged domain; **now has** `reasonTagging.test.ts` (Tier 2 resolved) — **still fine** |
| 3 | `server/generatePuzzles.ts` (1,791) | **Yes** — 1,791 LOC | Unchanged offline tool — **still fine** |
| 4 | `server/rooms.ts` (1,068) | **Yes** — 1,068 LOC | Unchanged room engine — **still fine** |
| 5 | `learn/lessonV2.ts`, `journeyPuzzles.ts` | **Yes** — 1,160 / 815 | Content/runtime length by nature — **still fine** |
| 6 | `devtools/debugHarness.ts` (735) | **Yes** — 735 LOC | Dev-only — **still fine** |
| 7 | `openEndsGeometry` client/server pair | **Yes** — client `game/openEndsGeometry.ts` 549 LOC; server mirror ~537 | Intentional parity — **still fine** |
| 8 | Test mock `any` usage | **Yes** | Widespread in handler tests — **still acceptable** |
| 9 | `@deprecated` JSDoc migration hints | **Yes** | Still present in learn/journey/components — **still fine** |
| 10 | `useLiveMatchSession.ts` (412) healthy | **Yes** — **412 LOC** | Controller-shaped — **still healthy** |

**Verdict:** All ten Tier 3 items remain valid. None regressed into Tier 1 territory. Item 2 gained tests but did not change architectural character.

---

## 6. Daily Fritz HTTP cohesion check (initiative-created files)

These files were created during the http extraction initiative and have not been individually re-examined until this pass.

### 6.1 `server/src/http/routes/dailyFritz.ts` — **931 LOC**

**What it contains:**

| Section | Approx. scope |
|---------|---------------|
| `registerDailyFritzRoutes(app)` | Single exported registrar |
| `GET /api/daily-fritz/today` | Auth, debug date, run summary/cache, attempt hydration, timed init diagnostics, heavy `console.log` tracing |
| `POST /api/daily-fritz/start` | Begin attempt + verified match bootstrap |
| `POST /api/daily-fritz/next-hand` | Hand advancement within set |
| `POST /api/daily-fritz/record-game` | Per-game result append (skunk/set logic via `dailyFritzSkunk`) |
| `POST /api/daily-fritz/complete` | Set completion, streak, activity write, leaderboard fields |
| `POST /api/daily-fritz/abandon` | Attempt abandon |
| `GET /api/daily-fritz/leaderboard/:date` | Leaderboard read |
| `POST /api/daily-fritz/generate` | Admin generate |
| `POST /api/daily-fritz/invalidate` | Admin invalidate |
| `POST /api/daily-fritz/reset-attempt` | Admin/debug reset |

**Imports:** Daily Fritz domain (`../../dailyFritz`, `dailyFritzSkunk`), auth, verified single-player match, social activity writer, store layer.

**Verdict:** **Single-domain-and-fine.** All endpoints serve Daily Fritz run/attempt lifecycle. Length comes from inline per-route auth, validation, logging, and Supabase orchestration — not mixed unrelated REST domains. Optional future split would be **per-route files** or shared route middleware (same pattern as `social/routes` → `socialFeed.ts` etc.), not a responsibility emergency.

### 6.2 `server/src/http/stores/dailyFritzStore.ts` — **616 LOC**

**What it contains:**

| Layer | Symbols |
|-------|---------|
| Row/record types | `DailyFritzRunRow`, `DailyFritzAttemptRow`, `DailyFritzRunRecord`, `DailyFritzRunSummary`, `DailyFritzAttemptRecord` |
| In-memory cache | `dailyFritzRunCache` |
| Normalizers | `normalizeDailyFritzTier`, `normalizeDailyFritzStatus`, tile/hand/set normalizers, `normalizeDailyFritzSetResult`, … |
| Row mappers | `toDailyFritzRunRecord`, `toDailyFritzRunRow`, `toDailyFritzAttemptRecord`, `toDailyFritzAttemptRow` |
| Set helpers | `getDailyFritzSetPointDiff`, `getCurrentDailyFritzGameNumber`, `getDailyFritzHandForGame` |
| Supabase CRUD | `getDailyFritzRun`, `getDailyFritzRunSummary`, `upsertDailyFritzRun`, `ensureDailyFritzRunForDate`, attempt CRUD, `listDailyFritzAttemptsForDate` |
| Aggregations | `fetchProfileNames`, `buildDailyFritzLeaderboard`, `getDailyFritzStreak` |
| Error helper | `isMissingDailyFritzTable` |

**Verdict:** **Single-domain-and-fine.** One persistence/aggregation module for Daily Fritz tables. Normalizers + CRUD + leaderboard belong together. A cosmetic split (types/normalizers vs queries) would be optional only.

---

## 7. New >600 LOC candidates in untouched areas

“Untouched” = domains outside the cleanup initiative’s main passes (bot match modules, multiplayer recovery/socket bus, `useLiveMatchSession`, server `index.ts`, `App.tsx` entanglements, Tier 1 items 1–7, Tier 2 bundle). Initiative work on Daily Fritz **client** and **http** is excluded from this bucket.

| File | LOC | Domain | Notes |
|------|-----|--------|-------|
| `dailyPuzzle/DailyPuzzleScreen.tsx` | **1,004** | `dailyPuzzle/` (legacy path) | **Genuinely new top-40 entrant** — ladder/hub were decomposed; legacy screen remains a large mixed hub |
| `learn/guidedMatch/GuidedMatchRecorderScreen.tsx` | 978 | `learn/` | Was Tier 2 “needs sizing”; unchanged |
| `tournament/TournamentBracketScreen.tsx` | 912 | `tournament/` | Was Tier 2 uncertain; unchanged |
| `learn/LearnPlayer.tsx` | 689 | `learn/` | Playback screen — not previously in audit top list |
| `learn/data/lessons/level1.ts` | 693 | `learn/` | Lesson **content data**, not logic |
| `dailyPuzzle/api.ts` | 694 | `dailyPuzzle/` | API client module — cohesive but large |
| `dailyPuzzle/DailyPuzzleAdminScreen.tsx` | 678 | `dailyPuzzle/` | Admin UI |
| `dailyPuzzle/DailyPuzzleLadderLeaderboardScreen.tsx` | 671 | `dailyPuzzle/` | Leaderboard UI |
| `friends/FriendsScreen.tsx` | 657 | `friends/` | Social friends hub — view-heavy |
| `devtools/calibrationAudit.ts` | 641 | `devtools/` | Dev-only |
| `auth/useAuth.ts` | 785 | `auth/` | Borderline multi-concern (auth + profile + Glicko bootstrap) |

**Not counted as “new untouched”** (initiative-touched): `PrivateMatchLobbyControlPanel.tsx` (695), `http/routes/dailyFritz.ts` (931), shrunk `DailyFritzScreen.tsx` (202).

---

## 8. Tier 1 / Tier 2 reconciliation (audit vs now)

### Tier 1 — original “next cleanup candidates”

| # | Original target | Audit LOC | Current LOC | Status |
|---|-----------------|-----------|-------------|--------|
| 1 | `registerRoomSessionHandlers.ts` | 1,580 | **101** (+ split modules) | **Resolved** |
| 2 | `MultiplayerGameShell` + `shellBridgeRef` | 1,037 | 1,037 | **Partially resolved** — `shellBridgeRef` **removed** (grep finds zero matches); shell still large orchestrator |
| 3 | `DailyFritzScreen.tsx` | 1,211 | **202** | **Resolved** |
| 4 | `PrivateMatchLobbyScreen.tsx` | 1,203 | **186** (+ ControlPanel 695) | **Resolved** |
| 5 | `AppRoutes.tsx` + prop funnel | 973 | **999** | **Open** — slight growth; prop funnel still wide |
| 6 | `useTournamentMatchSession.ts` | 1,110 | **145** | **Resolved** |
| 7 | `Board.tsx` | 1,246 | **1,152** | **Open** — shrunk slightly; Daily Fritz trace instrumentation still present |

### Tier 2 — selected items

| Item | Status |
|------|--------|
| `formatDateLabel` ×6 | **Open** — still duplicated across dailyFritz/dailyPuzzle copies |
| `useMultiplayerPresentation` duplicate `getBoardTileCount` | **Resolved** — uses `boardSessionUtils.getBoardTileCount` |
| `LiveMatchScreen` flat props | **Resolved** — 11 prop bundles in `liveMatchScreenTypes.ts` |
| `statsApi.ts` split | **Resolved** |
| `server/social/routes.ts` split | **Resolved** |
| `learning/` + `journey/` tests | **Resolved** — `moveAnalysis.test.ts`, `reasonTagging.test.ts`, `journeyContentValidation.test.ts`, `statsDerivations.test.ts` |
| `Board.tsx` / server room `console.log` | **Open** |
| Bot post-game modal `any` props | **Open** (frozen `bot/` leaves) |
| `index.ts` inline `stats:weekly`, `friend:invite:decline` | **Open** — still inline at ~L631–653 |

---

## 9. Prioritized follow-up list (reconnaissance only — no action taken)

Ranked: **genuinely new / risky** first, then **known / lower urgency**.

| Priority | Target | Why | New vs known |
|----------|--------|-----|--------------|
| **P1** | `dailyPuzzle/DailyPuzzleScreen.tsx` (1,004) | Legacy daily puzzle path still a monolithic screen while ladder/hub were decomposed; multi-domain hub risk | **Genuinely new** top-40 entrant |
| **P1** | `App.tsx` (1,554) | Widest live coupling surface (socket, recovery, tournament, routing); grew +15 LOC since audit | **Known**, still central |
| **P2** | `MultiplayerGameShell.tsx` (1,037) | Composition hub without ref bridge but still mixes sync + session + presentation | **Known** Tier 1 residual |
| **P2** | `AppRoutes.tsx` (999) + `useAppRoutesProps` (374) | Prop funnel / mode switch undifferentiated | **Known** Tier 1 residual |
| **P2** | `Board.tsx` (1,152) | Renderer + `traceDailyFritzBoardEvent` production tracing | **Known** Tier 1/2 |
| **P3** | `http/routes/dailyFritz.ts` (931) | Single-domain; optional per-route file split + logging trim | **Known** (initiative artifact) — low risk |
| **P3** | `learn/guidedMatch/GuidedMatchRecorderScreen.tsx` (978) | Large authoring UI in untouched learn domain | **Known** from audit |
| **P3** | `tournament/TournamentBracketScreen.tsx` (912) | Large tournament UI | **Known** from audit |
| **P4** | `formatDateLabel` duplication | Six implementations — deferred when dailyFritz/dailyPuzzle frozen | **Known** Tier 2 |
| **P4** | `auth/useAuth.ts` (785) | Auth + profile + rating bootstrap borderline | **Known** uncertain |
| **P4** | `dailyPuzzle/api.ts` (694), admin/leaderboard screens | Cohesive but large frozen-adjacent surfaces | **Known** / minor |
| **P4** | `friends/FriendsScreen.tsx` (657) | View-heavy social screen | **Low** — new in >600 list only |
| **P5** | `index.ts` inline socket handlers | Small bootstrap creep | **Known** Tier 2 |
| **P5** | Manual multiplayer smoke (hub-branch tile sound) | From Tier 2 follow-up — not automatable | **Known** operational |

**Explicitly not recommended for near-term cleanup:** Tier 3 frozen/cohesive engines (`botHeuristics`, `reasonTagging`, `rooms.ts`, `generatePuzzles.ts`, `recoveryMachine`, `useRoomSocketSync`, `useLiveMatchSession`), `dailyFritzStore.ts` (616), devtools scripts.

---

## 10. Commands run (reproducibility)

```bash
# LOC census
find client/src server/src -type f \( -name '*.ts' -o -name '*.tsx' \) \
  ! -path '*/node_modules/*' -exec wc -l {} + | sort -rn | head -45

find client/src -name '*.test.*' | wc -l    # → 71
find server/src -name '*.test.*' | wc -l    # → 77
find client/src -name '*.behaviorTests.ts' | wc -l  # → 30

# Structural export scans
rg '^export (async )?function |^export const |^export (type|interface)' <large-files>

# Tier 1 pattern checks
rg 'shellBridgeRef|gameShellBridgeRef' client/src   # → no matches
wc -l server/src/multiplayer/registerRoomSessionHandlers.ts  # → 101

# Tests (spot-check; full runs optional)
cd client && npm test   # 562 passed, 71 files
cd server && npm test   # 513 passed, 77 files
```

---

## 11. Files touched by this pass

| File | Action |
|------|--------|
| `docs/phase-repo-census-refresh-report.md` | **Created** — this report |

**No source code files were modified.**

---

*End of census refresh. Findings are reconnaissance only; no cleanup was executed.*