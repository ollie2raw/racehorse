# Repository Health Audit — July 2026

**Scope:** Diagnostic only. No code was modified during this audit.  
**Standard:** *Length is not the enemy — undifferentiated responsibility is.*  
**Date:** 2026-07-05

---

## Executive summary

The repo is in materially better shape than pre-cleanup baselines. Major wins are real and verified:

- `useLiveMatchSession.ts` decomposed to **412 LOC** (controller-shaped).
- `server/src/index.ts` at **784 LOC** — bootstrap/orchestration, not a monolith.
- Daily Puzzle ladder/legacy render trees extracted; `DailyPuzzleLadderScreen.tsx` at **573 LOC**.
- Frozen multiplayer recovery/socket-bus systems and bot-match `modules/**` architecture are intact.

**Remaining pressure is concentrated in a handful of non-frozen surfaces:** multiplayer shell/lobby orchestration (including an active `shellBridgeRef` pattern), server socket session handlers, Daily Fritz screen (pre-cleanup analogue to old Daily Puzzle), giant route/prop funnels (`AppRoutes` / `App`), and a few long-but-cohesive domain files (learning engine, board renderer, puzzle generator).

**Test suite (verified runs):** Client **60 files / 510 tests PASS** · Server **66 files / 490 tests PASS** · Combined **1,000 tests PASS**.

---

## 1. Inventory

### 1.1 Totals (measured)

| Area | Metric | Value (command-measured) |
|------|--------|--------------------------|
| Client `client/src` | TS/TSX/CSS files (excl. `assets/`) | **172,008 LOC** |
| Server `server/src` | TS/TSX files | **41,917 LOC** |
| Client + server TS/TSX only | File count | **835 files** |
| Vitest client | Test files / tests | **60 / 510** |
| Vitest server | Test files / tests | **66 / 490** |
| Client `*.behaviorTests.ts` | Files (not in vitest `include`) | **30** |
| Client `src/**/*.test.*` on disk | Files | **90** (60 vitest + 30 behaviorTests) |

### 1.2 Client `client/src` — top-level directory LOC

| Directory | LOC (TS/TSX) | Notes |
|-----------|--------------|-------|
| `modules/` | 16,415 | **Frozen** — bot-match architecture |
| `multiplayer/` | 14,187 | Partially frozen (see §1.4) |
| `learn/` | 12,305 | Lesson/guided content + screens |
| `dailyPuzzle/` | 8,489 | **Frozen** — post sub-phase 8 cleanup |
| `match/` | 7,500 | Partially frozen (`session/**`) |
| `bot/` | 6,558 | **Frozen** |
| `journey/` | 5,843 | Campaign content + screens |
| `learning/` | 4,778 | Coach/analysis engine |
| `dailyFritz/` | 4,644 | Hub screen still large |
| `components/` | 4,112 | Shared UI including `Board.tsx` |
| `tournament/` | 3,433 | Scheduled tournament UI |
| `devtools/` | 3,081 | Dev-only tooling |
| `analyzer/` | 2,422 | Post-game analyzer |
| `social/` | 2,305 | Profiles, feed screens |
| `auth/` | 1,639 | Auth hook + modals |
| `training/` | 1,302 | Pivotal review |
| `matchmaking/` | 1,299 | Queue UI |
| `stats/` | 1,241 | Stats API + screens |
| `practice/` | 1,236 | No-brainer lab |
| `ghost/` | 1,217 | Ghost mode |
| `game/` | 1,077 | Client game geometry/utils |
| `ranking/` | 1,027 | Rating history |
| `friends/` | 877 | Friends screen |
| `screens/` | 857 | Home + hub screens |
| Root files | ~3,700 | `App.tsx` 1539, `AppRoutes.tsx` 973, CSS, hooks |

**Root-level client files (LOC):**

| File | LOC |
|------|-----|
| `App.tsx` | 1,539 |
| `App.css` | 4,718 |
| `AppRoutes.tsx` | 973 |
| `useAppRoutesProps.tsx` | 393 |
| `useAppRoutesInput.tsx` | 327 |
| `useAppSessionRuntime.ts` | 207 |
| `AppOverlays.tsx` | 93 |
| `types.ts` | 102 |

### 1.3 Server `server/src` — top-level directory LOC

| Directory | LOC (TS/TSX) | Notes |
|-----------|--------------|-------|
| `multiplayer/` | 6,875 | Includes `registerRoomSessionHandlers.ts` |
| `scheduledTournament/` | 6,488 | Engine + routes + tests |
| `game/` | 5,478 | Engine + tests + `generatePuzzles.ts` at root |
| `http/` | 3,668 | **Frozen** routes/stores (per task) |
| `league/` | 2,130 | League service |
| `social/` | 1,919 | Routes + handlers |
| `matchmaking/` | 1,225 | **Frozen** `roomShellHydration.ts` |
| `ghost/` | 1,011 | Ghost service |
| `ranking/` | 1,001 | Glicko + period service |
| `bot/` | 969 | Server bot |
| `stats/` | 736 | Match logging |
| `legacyTournament/` | 690 | **Frozen** handlers |
| `realtime/` | 653 | **Frozen** `gameOverPersistence.ts` |
| `shared/` | 573 | **Frozen** |
| `platform/` | 265 | Health + auth helpers |
| `scheduled/` | 244 | **Frozen** `dailyWarmup.ts` |
| Root files | ~3,400 | `index.ts` 784, `rooms.ts` 1068, `generatePuzzles.ts` 1791, `dailyFritz.ts` 426, `dailyPuzzle.ts` 459 |

### 1.4 Directory tree (depth 2 — domain boundaries)

#### Client (`client/src/`)

```
client/src/
├── App.tsx, AppRoutes.tsx, AppOverlays.tsx, appRouteTypes.ts
├── useAppRoutesInput.tsx, useAppRoutesProps.tsx, useAppSessionRuntime.ts
├── analyzer/          (moveAnalyzer, GameReviewer, consequenceChain, …)
├── api/               (client.ts)
├── auth/              (useAuth, modals, session helpers)
├── bot/               [FROZEN] (BotMatchScreen, view-model/, view/, …)
├── components/        (Board, GlobalNav, primitives/, handOver/, hub/)
├── dailyFritz/        (DailyFritzScreen, api, leaderboard, helpers)
├── dailyPuzzle/       [FROZEN] (screens, hooks, view models, overlays, hub)
├── devtools/          (debugHarness, benchmark, calibrationAudit)
├── features/          (homeDailySummaryApi)
├── friends/           (FriendsScreen)
├── game/              (openEndsGeometry, tileUtils)
├── ghost/             (GhostSetupScreen, logic)
├── journey/           (RacehorseJourneyScreen, chapters/, puzzles)
├── learn/             (lessonV2, LearnPlayer, guidedMatch/, data/lessons/)
├── learning/          (reasonTagging, moveAnalysis, coachMessaging, types)
├── lib/               (supabase)
├── match/             (LiveMatchScreen, board/, session/, preGameDraw/)
│   └── session/       [FROZEN] (useLiveMatchSession 412 LOC, actions/, viewModel/)
├── matchmaking/       (MatchmakingScreen, MultiplayerTopBar)
├── modules/           [FROZEN] (match/, bot-turn/, player-turn/, fritz/)
├── multiplayer/       (shell, connection, recovery*, socketEventBus*, …)
├── practice/          (NoBrainerLabScreen, noBrainerLogic)
├── ranking/           (RatingHistoryPage)
├── screens/           (HomeScreen, SinglePlayerHubScreen)
├── social/            (ActivityFeed, PublicProfile)
├── stats/             (StatsScreen, statsApi, WeeklyStats)
├── tournament/        (hub, bracket, result screens)
├── training/          (pivotalReview/)
├── ui/                (claudeMode, ScreenLoader, useDeferredAsset)
└── utils/             (sound, logger, handTileLegality)
```

#### Server (`server/src/`)

```
server/src/
├── index.ts           (784 LOC — bootstrap)
├── rooms.ts           (1068 LOC — in-memory room engine)
├── generatePuzzles.ts (1791 LOC — offline puzzle generator)
├── dailyFritz.ts, dailyPuzzle.ts (legacy domain modules, routes extracted)
├── bot/               (serverBot)
├── game/              (engine, scoring, openEndsGeometry, __tests__/)
├── ghost/             (service.ts)
├── http/              [FROZEN] (routes/, stores/, shared/)
├── league/            (service, schedule, forfeit, rollover)
├── legacyTournament/  [FROZEN] (registerLegacyTournamentHandlers)
├── matchmaking/       [FROZEN partial] (queue, pairing, roomShellHydration)
├── multiplayer/       (registerRoomSessionHandlers, roomSession, persistence)
├── platform/          (health, auth)
├── ranking/           (glicko2, cron, periodService)
├── realtime/          [FROZEN] (gameOverPersistence)
├── scheduled/         [FROZEN] (dailyWarmup)
├── scheduledTournament/ (engine, routes, socketHandlers, recovery)
├── shared/            [FROZEN]
├── social/            [FROZEN partial] (registerPresenceHandlers, routes)
└── stats/             (matchLog, recordUserMatch)
```

### 1.5 Frozen / previously reviewed areas (skipped deep re-audit)

| Path | LOC (indicative) | Status |
|------|------------------|--------|
| `client/src/multiplayer/recoveryMachine.ts` | 870 | Reviewed — skip internals |
| `client/src/multiplayer/socketEventBus.ts` | 648 | Reviewed — skip internals |
| `client/src/multiplayer/useRoomSocketSync.ts` (projection gates) | 861 | Reviewed — skip internals |
| `client/src/modules/**` | 16,415 | 11-phase bot architecture |
| `client/src/modules/fritz/botHeuristics.ts` | 1,930 | Cohesive domain — confirmed fine |
| `client/src/bot/**` | 6,558 | Bot match UI/controller |
| `client/src/match/session/**` | ~2,500+ | Decomposed (`useLiveMatchSession` 412 LOC) |
| `client/src/dailyPuzzle/**` | 8,489 | Post sub-phases 1–8 |
| `client/src/App.tsx` | 1,539 | Post entanglement resolution |
| `server/src/http/routes/**`, `stores/**`, `shared/**` | 3,668+ | Phase 1–2 extraction |
| `server/src/scheduled/dailyWarmup.ts` | in `scheduled/` 244 | Extracted |
| `server/src/matchmaking/roomShellHydration.ts` | in matchmaking | Extracted |
| `server/src/multiplayer/registerRoomChatEmoteHandlers.ts` | — | Extracted |
| `server/src/social/registerPresenceHandlers.ts` | — | Extracted |
| `server/src/legacyTournament/registerLegacyTournamentHandlers.ts` | 690 dir | Extracted |
| `server/src/realtime/gameOverPersistence.ts` | in realtime 653 | Extracted |

---

## 2. God-file / god-hook scan (>500 LOC, non-frozen)

Files over 500 LOC were measured with `find … -exec wc -l`. Each non-frozen candidate was read (at minimum: imports, exports, structure, and representative mid-file sections). Classifications:

**(a)** Single cohesive domain — long but fine  
**(b)** Undifferentiated responsibility — multiple unrelated concerns  
**(c)** Uncertain — needs dedicated sizing pass

### 2.1 Client — non-frozen >500 LOC

| File | LOC | Class | Rationale |
|------|-----|-------|-----------|
| `learning/reasonTagging.ts` | 1,344 | **(a)** | Pure feature-extraction + tagging pipeline; header documents single purpose; no React/routing mixed in |
| `components/Board.tsx` | 1,246 | **(b)** | Board layout/render + camera/zoom + Daily Fritz interaction trace (`console.log`) + layout-debug paths — rendering mixed with dev instrumentation |
| `dailyFritz/DailyFritzScreen.tsx` | 1,211 | **(b)** | Hub UI + init/retry state machine + lazy `BotMatchScreen` embed + overlay orchestration — mirrors pre-cleanup Daily Puzzle |
| `multiplayer/PrivateMatchLobbyScreen.tsx` | 1,203 | **(b)** | 40+ prop interface; mixes connection UI, room lobby, chat/emotes, friend challenges, recovery — presentation + transport state |
| `learn/lessonV2.ts` | 1,160 | **(a)** | Lesson schema, playback validation, large content/runtime module — one domain |
| `match/session/useTournamentMatchSession.ts` | 1,110 | **(b)** | Tournament attach, bracket terminal, recovery signals, navigation, socket emits, persistence — session god-hook |
| `multiplayer/MultiplayerGameShell.tsx` | 1,037 | **(b)** | Composes `useRoomSocketSync`, `useLiveMatchSession`, presentation, analyzer, `shellBridgeRef` — orchestration + ref bridge |
| `match/LiveMatchScreen.tsx` | 1,028 | **(c)** | ~80-prop pure view for live PvP board; long but single render job; prop surface needs view-model grouping |
| `learn/guidedMatch/GuidedMatchRecorderScreen.tsx` | 978 | **(c)** | Authoring UI — likely cohesive but needs sizing pass |
| `AppRoutes.tsx` | 973 | **(b)** | Giant mode switch; `AppRoutesProps` has 80+ fields — routing + prop funnel |
| `learning/moveAnalysis.ts` | 914 | **(a)** | Pure grading engine; documented architecture; tests adjacent |
| `tournament/TournamentBracketScreen.tsx` | 912 | **(c)** | Tournament UI — needs sizing pass |
| `journey/journeyPuzzles.ts` | 815 | **(a)** | Static puzzle content bank |
| `learning/coachMessaging.ts` | 806 | **(a)** | Coach copy generation from analysis records |
| `auth/useAuth.ts` | 785 | **(c)** | Auth + profile bootstrap + Glicko normalization + timeouts — borderline; could split profile concerns |
| `learn/guidedAuthoring.ts` | 769 | **(a)** | Guided lesson authoring utilities |
| `analyzer/moveAnalyzer.ts` | 754 | **(c)** | Analyzer orchestration — needs sizing pass |
| `dailyFritz/DailyFritzLeaderboardScreen.tsx` | 715 | **(c)** | Leaderboard screen — likely view-heavy |
| `stats/statsApi.ts` | 709 | **(b)** | Many unrelated REST fetchers in one module (weekly, profile, rivals, history, …) |
| `journey/RacehorseJourneyScreen.tsx` | 623 | **(c)** | Journey hub screen |
| `matchmaking/MatchmakingScreen.tsx` | 618 | **(c)** | Matchmaking UI |
| `multiplayer/useMultiplayerConnection.ts` | 617 | **(c)** | Large but recently extracted; mostly connection domain |
| `learn/LearnHome.tsx` | 617 | **(c)** | Learn hub |
| `social/ActivityFeedScreen.tsx` | 586 | **(c)** | Social feed UI |
| `multiplayer/MultiplayerModeController.tsx` | 562 | **(c)** | Mode controller — moderate |
| `journey/journeyContentValidation.ts` | 550 | **(a)** | Validation rules for journey content |
| `game/openEndsGeometry.ts` | 549 | **(a)** | Geometry domain (paired with server copy) |
| `utils/sound.ts` | 547 | **(a)** | Audio asset map + playback |
| `ghost/GhostSetupScreen.tsx` | 539 | **(c)** | Ghost setup UI |
| `multiplayer/useMultiplayerRoomActions.ts` | 534 | **(c)** | Room actions hook |
| `tournament/TournamentHubScreen.tsx` | 504 | **(c)** | Tournament hub |

### 2.2 Server — non-frozen >500 LOC

| File | LOC | Class | Rationale |
|------|-----|-------|-----------|
| `generatePuzzles.ts` | 1,791 | **(a)** | Offline puzzle search/generation CLI — single pipeline (board search, scoring, Supabase write) |
| `multiplayer/registerRoomSessionHandlers.ts` | 1,580 | **(b)** | Socket god-file: room create/join/spectate, tournament attach, abandon, ready, start, game actions, rematch, forfeit — multiple sub-domains |
| `rooms.ts` | 1,068 | **(a)** | In-memory room state machine — cohesive server domain (create/join/act/nextHand); large but one job |
| `ghost/service.ts` | 1,011 | **(c)** | Ghost profile + move log service — needs sizing pass |
| `multiplayer/roomSession.ts` | 914 | **(c)** | Session helpers/roster/masking — large utility surface |
| `scheduledTournament/engine.ts` | 817 | **(a)** | Tournament bracket engine — cohesive |
| `seedDailyPuzzleLadder.ts` | 687 | **(c)** | Seeding script |
| `game/engine.ts` | 681 | **(a)** | Core domino engine |
| `social/routes.ts` | 640 | **(b)** | Monolithic Express router: auth helper + leaderboard + friends + rivals + activity — many REST concerns |
| `http/stores/dailyFritzStore.ts` | 616 | **Frozen** | Listed for inventory only |
| `multiplayer/roomLivePersistence.ts` | 604 | **(c)** | Live persistence |
| `index.ts` | 784 | **(a)** | Bootstrap — see §7 |

### 2.3 Test-only large files (not god-file problems)

| File | LOC | Note |
|------|-----|------|
| `server/src/game/__tests__/engine.test.ts` | 1,760 | Test suite — healthy |
| `server/src/scheduledTournament/engine.test.ts` | 888 | Test suite |
| `client/src/multiplayer/recoveryMachine.production.invariantTests.ts` | 564 | Invariant tests |

---

## 3. Anti-pattern scan

### 3.1 Ref bridges (banned pattern)

**Found — active production ref bridge:**

| Location | Pattern | Assessment |
|----------|---------|------------|
| `client/src/multiplayer/useMultiplayerShellDelegates.ts` | `shellBridgeRef: MutableRefObject<MultiplayerGameShellBridge \| null>` — parent (`App.tsx` `gameShellBridgeRef`) passes ref; delegates call `shellBridgeRef.current?.setState(...)` etc. | **Tier 1** — classic ref bridge to let connection/session hooks mutate shell-internal React state without owning it |
| `client/src/multiplayer/MultiplayerGameShell.tsx` ~L1003 | `shellBridgeRef.current = bridge` on mount | Bridge population site |
| `client/src/multiplayer/multiplayerRuntime.ts` | Extensive `*Ref` bags (`stateRef`, `joinedRoomRef`, `applyJoinedRoomResponseRef`, …) | **Partially intentional** for socket/event-loop latency; distinct from shell bridge but high coupling surface |

**Not classified as new ref bridges (frozen / reviewed):** `useRoomSocketSync` projection gates, `recoveryMachine`, `socketEventBus`.

**Shared gameplay refs** (`SharedGameplayRefs` in `useMultiplayerShellDelegates.ts`) — refs for animation/hand-reveal timing; borderline but longstanding multiplayer pattern.

### 3.2 Prop-drilling smells (10+ props through 2+ layers unchanged)

| Surface | Prop count (approx.) | Path |
|---------|---------------------|------|
| `AppRoutesProps` | **~87 fields** | `useAppRoutesProps` → `AppRoutes` → lazy screens |
| `PrivateMatchLobbyScreenProps` | **~40+ fields** | `MultiplayerModeController` → lobby |
| `LiveMatchScreenProps` | **~80+ fields** | `useLiveMatchSession` view model → `LiveMatchScreen` |
| `MultiplayerGameShellProps` | **~30+ refs + props** | `App` → shell → session hooks |

Daily Puzzle cleanup established the **`viewModel` + `actions`** grouping precedent; multiplayer live match and lobby have not yet received equivalent treatment.

### 3.3 Duplicated logic (drift risk)

| Symbol / concern | Occurrences | Notes |
|----------------|-------------|-------|
| `formatDateLabel` | **6 implementations** | `dailyFritz/dailyFritzScreenHelpers.ts` (canonical + tested), `dailyPuzzle/ladderHelpers.ts` (canonical + tested), local copies in `DailyFritzLeaderboardScreen.tsx`, `buildFinalOverlayViewModel.ts`, `ladderShareCard.ts`, `DailyPuzzleLadderLeaderboardScreen.tsx` | Known from Daily Puzzle sub-phase 2 — **deferred** |
| `openEndsGeometry` | Client **549** + server **537** LOC | Intentional engine parity; drift risk managed by separate tests, not shared package |
| `getBoardTileCount` | `match/boardSessionUtils.ts` (typed) vs `multiplayer/useMultiplayerPresentation.ts` (local `board: any` duplicate) | **Tier 2** — unnecessary reimplementation |
| `botEngine` / `game/engine` | Client `modules/match/runtime/botEngine.ts` (1080) + server `game/engine.ts` (681) | Intentional parity for client/server authority |
| Daily Fritz / Daily Puzzle hub patterns | Similar PVF hub layout across modes | Visual reuse, not yet shared hub primitive |

### 3.4 Silent overrides / unclear precedence

| Area | Concern |
|------|---------|
| `multiplayer/` recovery + resync | Multiple handlers (`useMultiplayerResync`, `recoveryMachine`, `socketEventBus`) — **frozen**; precedence documented in behavior tests |
| `useTournamentMatchSession` | Tournament attach vs bracket terminal vs live match exit — multiple `useEffect` chains; **Tier 2** — needs explicit state machine doc or sizing |
| `server/src/index.ts` disconnect handler | Fritz forfeit on disconnect runs async IIFE alongside `handleRoomPlayerDisconnect` — order not obvious from single read |

### 3.5 Dev / production debug logging

| Location | Pattern | Severity |
|----------|---------|----------|
| `client/src/components/Board.tsx` | `traceDailyFritzBoardEvent` → unconditional `console.log(tag, entry)` when called; layout-debug logs | **Tier 2** — can fire in production Daily Fritz/board interactions |
| `client/src/game/openEndsGeometry.ts` | `console.warn` on invariant issues | Reasonable production signal |
| `client/src/dailyFritz/dailyFritzScreenHelpers.ts` | `dfInitLog` gated by `DEV \|\| VITE_DEBUG_DAILY_FRITZ` | **OK** — not production leak |
| `client/src/dailyFritz/api.ts` | `DAILY_FRITZ_CLIENT_DEBUG_LOGS` gated logs; one ungated `console.log` at ~L352 `[df-scripted-draw]` | **Tier 2** — verify guard |
| `server/src/multiplayer/registerRoomSessionHandlers.ts` | Extensive `console.log` for room/tournament join tracing | **Tier 2** — ops noise in production |
| `server/src/index.ts` | Socket connect/disconnect logs | Normal bootstrap logging |
| `client/src/devtools/**` | Heavy `console.log` | Dev-only — **Tier 3** |

Daily Puzzle sub-phase 4 cleaned `[daily-puzzle:*]` logs; **Daily Fritz and Board traces remain**.

### 3.6 Placeholder / TODO / FIXME comments

`grep -i 'TODO|FIXME|HACK|XXX'` across `client/src` and `server/src` production code found **no unresolved TODO/FIXME markers** in source (excluding test fixtures like `'TODO-123'` in `guidedMatchValidation.test.ts`).

**`@deprecated` JSDoc** (migration hints, not debt tickets):

| File | Line | Text |
|------|------|------|
| `learn/lessonV2.ts` | 757 | `@deprecated Prefer canStartGuidedV2Lesson + validateGuidedV2LessonPlayback` |
| `learn/LearnHowToPlayDiagrams.tsx` | 116–118 | `@deprecated Prefer scoreLine` |
| `components/MatchNblBoardFrame.tsx` | 10 | `@deprecated Prefer MatchLiveLayout` |
| `components/MatchBoardTurnBar.tsx` | 8 | `@deprecated Dev cross-check` |
| `journey/journeyTypes.ts` | 83 | v1 shape migration |
| `journey/journeyNodes.ts` | 1 | Import from `./chapters` |
| `journey/chapters/index.ts` | 36 | Deprecated export alias |
| `journey/journeyTrailPath.ts` | 101 | Deprecated layout alias |

Guided-match validators treat `'todo'` / `'fixme'` as **banned coaching title patterns** (content policy), not code debt.

---

## 4. Test coverage map

### 4.1 Verified suite totals

```
Client:  npm test  → 60 files, 510 tests PASS
Server:  npm test  → 66 files, 490 tests PASS
Total:                     1,000 tests PASS
```

Vitest client `include`: `src/**/*.test.ts`, `src/**/*.test.tsx` only — **30 `*.behaviorTests.ts` files exist but are not in the default vitest run**.

### 4.2 Coverage by domain (src files vs test files)

| Domain | Src files | Test files | Assessment |
|--------|-----------|------------|------------|
| `client/src/multiplayer/` | 49 | 17 | Good on protocol/recovery; thin on lobby/shell UI |
| `client/src/modules/` | 131 | 16 | Frozen — adequate for extracted architecture |
| `client/src/dailyPuzzle/` | 32 | 14 | Strong after cleanup (pure helpers + views) |
| `client/src/bot/` | 51 | 15 | Behavior tests + engine parity |
| `client/src/match/` | 31 | 9 | Session decomposition tested; `LiveMatchScreen` untested (thin JSX) |
| `client/src/learn/` | 62 | 4 | **Gap** — large content surface, few tests |
| `client/src/learning/` | 11 | 0 | **Gap** — pure logic (`reasonTagging`, `moveAnalysis`) lacks direct unit tests |
| `client/src/journey/` | 31 | 0 | **Gap** — content validation exists (550 LOC) but no test file |
| `client/src/dailyFritz/` | 18 | 2 | **Gap** — only helpers/skunk; screen/API orchestration untested |
| `client/src/auth/` | 8 | 0 | Thin wiring — lower priority |
| `client/src/components/` | 37 | 1 | **Gap** — only `ErrorBoundary`; `Board.tsx` untested |
| `client/src/screens/` | 3 | 0 | Hub JSX — lower priority per precedent |
| `server/src/multiplayer/` | 13 | 15 | Strong handler tests |
| `server/src/scheduledTournament/` | 14 | 18 | Strong |
| `server/src/game/` | 5 | 5 | Strong engine coverage |
| `server/src/social/` | 6 | 5 | Adequate |
| `server/src/http/` | 11 | 0 | Routes/stores — integration-heavy, frozen |

### 4.3 Priority interpretation (per Daily Puzzle precedent)

- **Real gaps:** Pure functions without tests (`learning/*`, `journeyContentValidation`, duplicated `formatDateLabel` copies).
- **Lower priority:** Large JSX hubs (`DailyFritzScreen`, `PrivateMatchLobbyScreen`) and hook wiring — test via extracted view models when decomposed.

Client vitest coverage thresholds (from `vite.config.ts`): statements 35%, branches 17%, functions 50%, lines 38%.

---

## 5. Type safety scan

**No `@ts-ignore` or `@ts-expect-error` anywhere in client or server src** (verified grep).

### Production `any` / `as any` (excluding test files)

| File | Lines | Assessment |
|------|-------|------------|
| `client/src/multiplayer/useMultiplayerPresentation.ts` | 5, 15, 22 | **Gap** — `board: any`, `players: any[]`, `any[]` flying tiles |
| `client/src/bot/BotGameOverModal.tsx` | 21, 30, 33, 38, 43, 48, 59 | **Gap** — modal props untyped (`any`) |
| `client/src/bot/BotPostGameCard.tsx` | 21–22, 25 | **Gap** |
| `client/src/bot/BotReviewSummaryPortal.tsx` | 7–9 | **Gap** |
| `client/src/bot/BotPivotalReviewPortal.tsx` | 7–8 | **Gap** |
| `client/src/bot/BotGuidedMatchPanel.tsx` | 9, 18 | **Gap** |
| `client/src/bot/BotHandOverModal.tsx` | 28 | Minor |
| `server/src/index.ts` | 526, 653, 685 | Hook `room: any`; `stats:weekly` cb; `supabaseFetch<any[]>` — **Tier 2** |
| `server/src/multiplayer/registerRoomSessionHandlers.ts` | 277, 1323, 1574 | Socket `__leaveTrackedRoom`; `(room as any).config` |
| `server/src/shared/fritzMatchLifecycle.ts` | 26 | `(room as any).config` |
| `server/src/multiplayer/disconnectGrace.ts` | 121, 134 | Roster typing escape |
| `server/src/ranking/periodService.ts` | 287, 311 | `catch (err: any)` |
| `server/src/stats/matchLog.ts` | 221–231 | Leaderboard aggregation casts |
| `server/src/legacyTournament/registerLegacyTournamentHandlers.ts` | many | Global tournament maps — **frozen** |

**Test-only `any`:** Widespread in handler mocks (`registerRoomSessionHandlers.*.test.ts`, scheduled tournament tests) — **Tier 3** acceptable.

---

## 6. Consistency scan

| Concern | Variants observed | Impact |
|---------|-------------------|--------|
| **View decomposition pattern** | Daily Puzzle: `viewModel` + `actions` + colocated views; Multiplayer: flat props + ref bags | Inconsistent — increases cost of next extractions |
| **Date formatting** | 6× `formatDateLabel` | Duplication / drift |
| **API error handling** | `dailyPuzzle/api.ts` structured errors; `statsApi.ts` ad-hoc throws; server routes mix `res.status` patterns | Moderate inconsistency |
| **Logging** | `utils/logger.ts` in multiplayer session; raw `console.log` in Board/server handlers; gated `dfInitLog` | Inconsistent observability |
| **Screen naming** | `*Screen.tsx`, `*View.tsx`, `*Route.tsx` coexist | Cosmetic — acceptable |
| **Test naming** | `*.test.ts` (vitest) vs `*.behaviorTests.ts` (manual/non-vitest) | Two-tier test execution — document for contributors |
| **CSS systems** | `dailyFritz.css` / `PlayVsFritz` PVF + legacy `walnut-live` on ladder in-play | Visual debt — ladder in-play still uses `walnut-live` class chain |
| **Auth profile fetch** | `useAuth.ts` inline Supabase vs `statsApi` REST | Parallel paths — not incorrect |

---

## 7. Server `index.ts` specific check

| Metric | Value |
|--------|-------|
| **Current LOC** | **784** (unchanged from post Phase 2 report) |
| **Exported symbols** | 0 — file is bootstrap only |
| **Local functions** | 11 (`installSocketRateLimit`, `resolveSocketIdentity`, `notifyRoomPlayersInGame`, `onAfterMatchStarted`, shutdown helpers, …) |

### What remains inline (not re-extracted domains)

| Block | ~LOC | Verdict |
|-------|------|---------|
| CORS + rate limits + JSON middleware | ~80 | Appropriate bootstrap |
| Route registration calls (`register*Routes`) | ~60 | Delegated correctly |
| `initRoomSession` + handler registration | ~30 | Delegated |
| Socket connection wiring | ~110 | Mostly delegated |
| **Inline `friend:invite:decline` handler** | ~20 | Minor creep — could move to `registerFriendInviteHandlers` |
| **Inline `stats:weekly` socket handler** | ~10 | Minor creep — could move to `registerStatsRoutes` or socket module |
| **Inline disconnect Fritz forfeit IIFE** | ~35 | Moderate creep — Fritz lifecycle domain |
| Process shutdown / Sentry / listen | ~80 | Appropriate |

**No new large unextracted domains** have regrown into `index.ts`. Residual inline handlers are small. **`registerRoomSessionHandlers.ts` (1,580 LOC)** is the server-side concentration problem, not `index.ts`.

---

## 8. Prioritized findings

### TIER 1 — Next cleanup candidates (god-files, ref bridges, high-risk coupling)

| # | Target | LOC | One-line reason |
|---|--------|-----|-----------------|
| 1 | `server/src/multiplayer/registerRoomSessionHandlers.ts` | 1,580 | Socket god-file mixing room lifecycle, tournament attach, matchmaking auto-start, abandon, ready/start, and game actions |
| 2 | `client/src/multiplayer/MultiplayerGameShell.tsx` + `useMultiplayerShellDelegates.ts` | 1,037 + 108 | **`shellBridgeRef` ref bridge** + shell orchestrates socket sync, live session, presentation, and analyzer in one component |
| 3 | `client/src/dailyFritz/DailyFritzScreen.tsx` | 1,211 | Pre-cleanup Daily Puzzle analogue — hub + init state machine + embedded bot match not yet decomposed |
| 4 | `client/src/multiplayer/PrivateMatchLobbyScreen.tsx` | 1,203 | 40+ prop lobby god-view mixing connection, room, chat, challenges, and recovery UI |
| 5 | `client/src/AppRoutes.tsx` + `appRouteTypes.ts` prop funnel | 973 + 137 | Route switch with ~87 props — entanglement resolved in `App.tsx` but routing layer still undifferentiated |
| 6 | `client/src/match/session/useTournamentMatchSession.ts` | 1,110 | Tournament session god-hook — attach, terminal bracket, navigation, and socket orchestration |
| 7 | `client/src/components/Board.tsx` | 1,246 | Core renderer mixed with Daily Fritz trace logging and layout-debug instrumentation |

### TIER 2 — Real but lower urgency

| # | Issue | Notes |
|---|-------|-------|
| 1 | `formatDateLabel` ×6 | Consolidate to shared helper (known deferred item) |
| 2 | `useMultiplayerPresentation.ts` duplicate `getBoardTileCount` + `any` types | Small extraction + import from `boardSessionUtils` |
| 3 | `LiveMatchScreen` ~80 flat props | Apply view-model grouping (Daily Puzzle precedent) |
| 4 | `statsApi.ts` aggregation | Split by domain or typed client modules |
| 5 | `server/src/social/routes.ts` monolith | Split leaderboard vs friends vs profile routers |
| 6 | `learning/` pure modules without tests | `reasonTagging.ts`, `moveAnalysis.ts`, `coachMessaging.ts` |
| 7 | `journey/` no tests | `journeyContentValidation.ts` is test-worthy pure logic |
| 8 | Production `console.log` in `Board.tsx` + verbose server room logs | Observability noise |
| 9 | Bot post-game modals (`BotGameOverModal`, portals) — `any` props | Type safety debt in frozen `bot/` UI leaf components |
| 10 | `index.ts` inline `stats:weekly`, `friend:invite:decline`, disconnect Fritz block | Small extractions when touching server bootstrap |

### TIER 3 — Noted, likely fine to leave

| # | Item | Notes |
|---|------|-------|
| 1 | `modules/fritz/botHeuristics.ts` (1,930) | Frozen — cohesive strategic evaluator |
| 2 | `learning/reasonTagging.ts` (1,344) | Pure cohesive domain |
| 3 | `server/generatePuzzles.ts` (1,791) | Offline tool — cohesive |
| 4 | `server/rooms.ts` (1,068) | Room engine — cohesive server domain |
| 5 | `learn/lessonV2.ts`, `journeyPuzzles.ts` | Content/runtime — long by nature |
| 6 | `devtools/debugHarness.ts` (735) | Dev-only |
| 7 | `openEndsGeometry` client/server pair | Intentional parity |
| 8 | Test mock `any` usage | Standard for socket handler tests |
| 9 | `@deprecated` JSDoc migration hints | Documented API evolution |
| 10 | `useLiveMatchSession.ts` (412) | **Healthy** post-decomposition |

---

## 9. Files touched by this audit

| File | Action |
|------|--------|
| `docs/repo-health-audit-2026-07.md` | **Created** — this report |

**No source code files were modified.**

---

## 10. Commands run (reproducibility)

```bash
# LOC inventory
find client/src server/src -type f \( -name "*.ts" -o -name "*.tsx" \) ! -path "*/node_modules/*" -exec wc -l {} + | sort -rn
wc -l server/src/index.ts client/src/dailyPuzzle/DailyPuzzleLadderScreen.tsx

# Tests
cd client && npm test
cd server && npm test

# Greps
rg '@ts-ignore|@ts-expect-error|: any|as any' client/src server/src
rg 'TODO|FIXME|HACK' client/src server/src -i
rg 'formatDateLabel' --glob '*.{ts,tsx}'
rg 'shellBridgeRef' client/src
```

---

*End of audit. Sub-phase prompts should be derived from Tier 1 items after human review — not auto-generated here.*