# Racehorse Dominoes — Architecture Journey Summary

**Document type:** Historical record and current-state snapshot  
**Date:** 2026-07-04  
**Scope:** Bot Match (`BotMatchScreen`) and Player vs Player (multiplayer recovery + client architecture)  
**Audience:** Engineers continuing feature work, bug fixes, or future extractions

---

## Executive summary

Two parallel architectural programs ran in 2026:

1. **Bot Match** — Decomposed a ~6,450 LOC god screen into a **8 LOC composition root** with runtime in `client/src/modules/`. Phases 1–11 are **complete and frozen**. Further Bot Match work is feature work or incremental cleanup only.

2. **Player vs Player (multiplayer)** — Started from an **`App.tsx` integration kernel** (~1,589 LOC) with strong server authority but weak client test coverage and a proven resync-drop bug. Phases **0 → B** extracted and fixed resync ownership; **D** extracted join-ack coordination; **E → O** hardened the recovery stack into a **certified, frozen** three-layer authority model. PvP gameplay/session decomposition (Phases C, E–G from the original extraction plan) remains **deferred**.

**Bottom line:** Bot Match is architecturally complete. Multiplayer **recovery** is production-certified. Multiplayer **App/session** decomposition is intentionally incomplete.

---

## Part 1 — Where we started

### Bot Match (`BotMatchScreen.tsx`)

| Dimension | Starting state (pre-refactor) |
|-----------|-------------------------------|
| **Size** | ~6,454 LOC in one file |
| **Ownership** | Session, game loop, hand lifecycle, bot AI, draw animation, Daily Fritz, Ghost, Guided Learn (v1/v2), authoring, coach, journey, replay, audio, overlays, networking, persistence, debug — all in one component |
| **Hooks** | ~49 `useState`, ~52 `useEffect`, ~43 `useCallback`, ~25 timer refs |
| **Partial extractions** | `botEngine.ts`, `handLifecycle.ts`, a few small hooks — insufficient to scale |
| **Risk** | Any mode change (Daily Fritz, Ghost, Guided, PvF) touched the same file; high regression surface |

Source: [godfilesAUDIT.md](../../godfilesAUDIT.md)

### Player vs Player (multiplayer client)

| Dimension | Starting state (Phase 1 audit) |
|-----------|------------------------------|
| **Integration kernel** | `App.tsx` (~1,589 LOC) — socket, recovery, resync, `fetchGameState`, `player:ready`, tournament attach, shell bridge |
| **Session god hook** | `useLiveMatchSession.ts` (~1,099 LOC) — gameplay actions, animation, rematch, move log |
| **Recovery** | `recoveryMachine.ts` existed and was well-tested, but wired through App + legacy ref shims |
| **Proven bug** | Indirect `RESYNC_NEEDED` was **dropped** when machine `state !== 'idle'` while `fetchGameState` still returned `true` |
| **Test gap** | Rich server multiplayer tests; thin client coverage (recovery behavior tests + normalize players only) |
| **Documented debt** | Nine `ENTANGLEMENT E2–E11` markers in `App.tsx` |

Source: [player-vs-player-architecture-audit.md](./player-vs-player-architecture-audit.md)

### Server (context only)

Server multiplayer (`rooms.ts`, `roomSession.ts`, handler registration) was already **authoritative and well-tested**. Client work did not rewrite gameplay rules or server models.

---

## Part 2 — Bot Match phases (complete)

Bot Match refactoring followed a **composition-root + modules** pattern modeled after premium game platforms (thin screen, fat runtime modules).

### Phases 1–9 — Decomposition (structural refactor)

**Goal:** Extract domains from `BotMatchScreen.tsx` without changing gameplay behavior.

| Phase focus | Outcome |
|-------------|---------|
| **Match kernel** | `modules/match/` — bootstrap, turn stack, hand lifecycle, navigation, presentation |
| **Turn orchestration** | `modules/player-turn/`, `modules/bot-turn/` — human and bot action pipelines |
| **Mode runtimes** | `modules/guided/`, `modules/ghost/`, `modules/daily/`, `modules/review/`, `modules/fritz/` |
| **View layer** | `bot/view/**` — board, HUD, modals (presentation only) |
| **View model** | `bot/view-model/`, `createBotMatchViewModel.ts` — semantic props grouped by UI responsibility |
| **Controller** | `useBotMatchScreenController.ts` — wires all subsystem hooks; no business rules |
| **Composition root** | `BotMatchScreen.tsx` reduced to mount + controller + view |

**Dependency law established:** `modules/*` must not import `bot/*`. Cross-feature APIs integrate through contract facades (`dailyFritzContracts`, `ghostContracts`, etc.).

### Phase 10 — Architectural validation and cleanup

**Goal:** Prove the decomposition is real, not cosmetic.

- Removed re-export façades with zero references
- Eliminated `modules → dailyFritz/ghost` direct cross-feature imports (bridges only)
- Architecture validation checklist (composition root &lt; 20 LOC, no ref bridges, single engine ownership)
- Canonical doc: [bot-match-architecture.md](./bot-match-architecture.md)

### Phase 11 — Production hardening (no refactor)

**Goal:** Ship-readiness pass — correctness, diagnostics, test harness, documented debt.

- Fixed inverted guided types dependency
- Fixed `test:bot-hooks` Node environment (`window` polyfill)
- Removed six orphan bot stubs (`botMatchApi`, `botMatchHelpers`, `botMatchDebug`, `fairnessLog`, `guidedBotMatchHelpers`, `useAuthoringCapture`)
- Red-team verification audit
- Report: [phase-11-bot-match-hardening-report.md](./phase-11-bot-match-hardening-report.md)

### Bot Match — where we stand now

```
BotMatchScreen.tsx (8 LOC)
  └─ useBotMatchScreenController
       ├─ useGuidedLessonBoot / useGuidedMatchRuntime
       ├─ useBotMatchBootstrap (match kernel)
       ├─ useMatchTurnStack (player + bot turns)
       ├─ useGhostRuntime / useDailyFritzRuntime / useReviewRuntime
       └─ createBotMatchViewModel → BotMatchScreenView
```

| Metric | Before | After |
|--------|--------|-------|
| `BotMatchScreen.tsx` | ~6,454 LOC | **8 LOC** |
| Runtime location | Monolith screen | `client/src/modules/**` |
| Vitest (client) | ~347 | **391+** (grew with module tests) |
| Architecture status | God screen | **Complete — frozen** |

**Remaining Bot Match debt (non-blocking):** six external-facing re-export stubs in `bot/`, contract bridges to `dailyFritz/` and `ghost/` feature folders, wide view-model args bag, partial `MatchEventBus` adoption.

---

## Part 3 — Multiplayer phases 0 → O

Multiplayer work split into two tracks:

- **Extraction track** (original [player-vs-player-extraction-plan.md](./player-vs-player-extraction-plan.md)) — move ownership out of `App.tsx`
- **Recovery hardening track** (Phases E–O) — make reconnect/resync deterministic under chaos

> **Note on phase letters:** The extraction plan assigned E–M to App/session teardown. During implementation, **E–O were reused** for the recovery pipeline hardening sequence below. This document uses the **implemented** lettering.

---

### Phase 1 — PvP architecture audit

- Full client + server multiplayer audit
- Identified H-1–H-5 hazards and ENTANGLEMENT E2–E11
- Verdict: production-viable server; **client not architecturally complete**
- Doc: [player-vs-player-architecture-audit.md](./player-vs-player-architecture-audit.md)

---

### Phase 0 — PvP client test harness ✅

| | |
|---|---|
| **Goal** | CI coverage before any production moves |
| **Production changes** | **None** |
| **Added** | `socketGuards.test.ts` (20), `boardSnapshotGuards.test.ts` (24), `multiplayerResyncContract.behaviorTests.ts`, +6 recovery integration scenarios |
| **Vitest delta** | +44 tests (347 → 391) |
| **Doc** | [phase-0-pvp-test-harness-report.md](./phase-0-pvp-test-harness-report.md) |

---

### Phase A — Resync ownership extraction ✅

| | |
|---|---|
| **Goal** | Move `fetchGameState`, resync refs, quick-match stall watchdog out of `App.tsx` |
| **Created** | `useMultiplayerResync.ts` |
| **Behavior** | **Unchanged** (structural move only) |
| **App.tsx** | ~1,589 → ~1,536 LOC (−53 net) |
| **Doc** | [phase-a-pvp-resync-extraction-report.md](./phase-a-pvp-resync-extraction-report.md) |

---

### Phase B — Resync queue correctness ✅

| | |
|---|---|
| **Goal** | Fix H-3: stop dropping `RESYNC_NEEDED` while machine non-idle |
| **Changed** | `recoveryMachine.ts` — `pendingResyncRoomCode` queue; flush on `ROOM_JOIN_OK` / `RESYNC_OK` |
| **Behavior** | **Intentional fix** — indirect resync requests coalesce and flush as exactly one resync |
| **Tests** | `multiplayerResyncQueue.behaviorTests.ts` (5 scenarios) |
| **Doc** | [phase-b-pvp-resync-queue-report.md](./phase-b-pvp-resync-queue-report.md) |

---

### Phase C — Shell bridge queue ⏭️ SKIPPED

| | |
|---|---|
| **Planned goal** | Queue shell delegate calls before `MultiplayerGameShell` mounts |
| **Status** | **Not implemented** — no reproduced pre-mount drop in production |
| **Decision** | Document invariant; implement only if Sentry proves H-5 |

---

### Phase D — Join ack coordinator ✅

| | |
|---|---|
| **Goal** | Single authority for `room:join` ack handling (E5) |
| **Created** | `joinAckCoordinator.ts`, `useJoinAckCoordinator.ts`, behavior tests |
| **Owns** | Roster projection, snapshot apply, `ROOM_JOIN_OK` dispatch, hand-identity mismatch → `RESYNC_NEEDED`, `player:ready` scheduling hooks |
| **Routing** | `App.applyJoinedRoomResponse` → `dispatchSocketEvent(ROOM_JOIN_OK)` → `handleJoinAck` |
| **Still in App** | `emitCreateRoom`, tournament terminal join policy, shell `applySnapshot` bridge |

---

### Phase E — Normalized socket event bus ✅

| | |
|---|---|
| **Goal** | Single interpreter for inbound socket events affecting recovery |
| **Created** | `socketEventBus.ts` |
| **Owns** | `dispatchSocketEvent`, `registerNormalizedSocketRouter`, `attachSocketEventBus`, raw handler registry |
| **Events** | `ROOM_JOIN_OK`, `STATE_UPDATE`, `RESYNC_NEEDED`, `TRANSPORT_FAIL`, `ROOM_JOIN_TERMINAL` |
| **Tests** | `socketEventBus.behaviorTests.ts` |

---

### Phase F — Ingestion dedup and projection gates ✅

| | |
|---|---|
| **Goal** | Burst dedup + pre-projection replay drops |
| **Changed** | `socketEventBus` fingerprint window; `useRoomSocketSync` sequence watermark guards |
| **Tests** | `socketEventBus.dedup.behaviorTests.ts` |

---

### Phase G — Episode ordering ✅

| | |
|---|---|
| **Goal** | Cross-episode stale event rejection |
| **Changed** | `episodeSequence` stamping; stale cross-episode `ROOM_JOIN_OK` drop |
| **Tests** | `socketEventBus.episodeOrdering.behaviorTests.ts` |

---

### Phase H — Transport replay immunity ✅

| | |
|---|---|
| **Goal** | Bounded replay registry for duplicate `state:update` / transport IDs |
| **Changed** | `TRANSPORT_REPLAY_MAX_SIZE` (500), eviction, raw + normalized ingress paths |
| **Tests** | `socketEventBus.transportReplay.behaviorTests.ts` |

---

### Phase I — Concurrency stabilization ✅

| | |
|---|---|
| **Goal** | Single-threaded dispatch queue; no re-entrant socket bus corruption |
| **Changed** | `isDispatching` queue in `socketEventBus`; reducer `_transitionLock` / `dispatchEpoch` in machine |
| **Extracted** | `registerMultiplayerConnectionSocketHandlers.ts` from `useMultiplayerConnection.ts` |
| **Tests** | `socketEventBus.concurrency.behaviorTests.ts` |

---

### Phase J — Recovery machine contract finalization ✅

| | |
|---|---|
| **Goal** | Deterministic episode lifecycle; eliminate post-success pending ambiguity |
| **Changed** | `closeRecoveryEpisode()`, `lastEpisodeClosedAt`, projection gate `shouldDropClosedEpisodeProjection`, episode closure on terminal paths |
| **Tests** | `recoveryMachine.contract.final.behaviorTests.ts` |

---

### Phase K — Production verification gate ✅

| | |
|---|---|
| **Goal** | Formal proof layer; minimal production guards only |
| **Created** | `recoveryAuthorityContract.ts`, `recoveryMachine.production.invariantTests.ts` (chaos scenarios A–D) |
| **Guards** | `isEpisodeStaleRecoveryEvent` dispatch drop; DEV invariant checks |

**Recovery authority contract (frozen):**

```
recoveryMachine snapshot
  + socketEventBus episodeSequence gate
  + socketEventBus projection gate
```

---

### Phase L — Freeze audit ✅ (analysis only)

| | |
|---|---|
| **Goal** | Pre-merge safety audit; identify dead paths and shadow writers |
| **Production changes** | **None** |
| **Findings** | Complementary redundant guards (keep); shadow UI `setRoomRecoveryState` in `useRoomSocketSync`; lobby leave uses `SET_POLICY` not always `USER_LEAVE`; deferred cleanup items documented |

---

### Phase M — Post-merge cleanup ✅

| | |
|---|---|
| **Goal** | Remove **proven** dead code only |
| **Removed** | `ROOM_JOIN_OK.needsResync`, unused `closeRecoveryEpisode(reason)`, dead reducer branches |
| **Aligned** | `RESYNC_NEEDED` while `resyncing` → explicit no-op (matches dispatch guard) |
| **Behavior** | **None** (deletion only) |

---

### Phase N — Real-world stress validation ✅

| | |
|---|---|
| **Goal** | Break recovery under real multiplayer conditions |
| **Production changes** | **None** |
| **Method** | `reconnectProductionQa.mjs` + ephemeral Playwright harness on https://playracehorse.com |
| **Result** | No reproducible recovery defects; scenarios 2–8 passed; host disconnect recovery steps passed (harness false-positive on expected network console noise) |
| **Gaps** | 30–60 min soak, DevTools throttling profiles, socket-level injection — not run |

---

### Phase O — Production certification & freeze ✅

| | |
|---|---|
| **Goal** | Final audit; certify or block release |
| **Production changes** | **None** |
| **Verdict** | **CERTIFIED FOR PRODUCTION** |
| **Frozen** | Recovery architecture; bug-fix-only policy going forward |

---

## Part 4 — Multiplayer: where we stand now

### Recovery pipeline (frozen)

```
Socket ingress
  └─ attachSocketEventBus (raw events)
       └─ socketEventBus.dispatchSocketEvent
            ├─ transport replay + dedup + episode sequence
            └─ normalized router
                 ├─ ROOM_JOIN_OK → joinAckCoordinator
                 ├─ STATE_UPDATE → useRoomSocketSync
                 ├─ RESYNC_NEEDED / TRANSPORT_FAIL / ROOM_JOIN_TERMINAL
                 │    → registerMultiplayerConnectionSocketHandlers → recoveryMachine
                 └─ (lifecycle raw handlers in connection module)

recoveryMachine.dispatch
  └─ effects → useMultiplayerConnection (connect / room_join / resync)
       └─ syncRecoveryLegacyRefs → App UI state (shim)
```

### Key files and approximate size

| File | LOC (approx) | Role |
|------|--------------|------|
| `recoveryMachine.ts` | 870 | Recovery FSM — **authority** |
| `socketEventBus.ts` | 648 | Event routing, replay, episode gate |
| `useMultiplayerConnection.ts` | 621 | Socket lifecycle, effect execution |
| `useRoomSocketSync.ts` | 860+ | Gameplay projection, draw choreography |
| `joinAckCoordinator.ts` | 162 | Join ack pure coordinator |
| `useMultiplayerResync.ts` | 158 | `fetchGameState`, resync refs |
| `recoveryConnectionBridge.ts` | 40 | Legacy ref sync shim |
| `App.tsx` | 1,507 | Still integration kernel for PvP |

### Client test surface (multiplayer)

| Suite | Count |
|-------|-------|
| Behavior + invariant test files | **31** (via `run-behavior-tests.mjs`) |
| Vitest unit tests | **391** |
| Production reconnect QA | `client/scripts/reconnectProductionQa.mjs` |

### PvP extraction plan — deferred phases

These were planned in [player-vs-player-extraction-plan.md](./player-vs-player-extraction-plan.md) but **not executed** (recovery hardening took priority):

| Planned phase | Goal | Status |
|---------------|------|--------|
| **C** | Shell bridge pending-update queue | Skipped (no repro) |
| **E** (plan) | Room teardown coordinator | Not started |
| **F** (plan) | Match exit orchestration | Not started |
| **G** (plan) | `useMultiplayerAppHost` — Bot Match parity for App | Not started |
| **H** (plan) | CI dependency-cruiser boundary rules | Not started |
| **I** (plan) | `useLiveMatchActions` extraction | Not started |
| **J** (plan) | Draw presentation split | Rejected (high risk / low gain) |
| **K–M** (plan) | Persistence policy, feed connect, legacy shim removal | Skipped / rejected |

---

## Part 5 — Side-by-side maturity

| Dimension | Bot Match | Multiplayer (PvP) |
|-----------|-----------|-----------------|
| Composition root | `BotMatchScreen` 8 LOC ✅ | `App.tsx` ~1,507 LOC — still kernel |
| Session hook | Decomposed `modules/*` ✅ | `useLiveMatchSession` ~1,099 LOC — god hook |
| Recovery | N/A | **Certified, frozen** ✅ |
| Client tests | 391+ vitest, module tests | 31 behavior suites + 391 vitest |
| Server authority | N/A (local/bot) | Strong ✅ (unchanged) |
| Architectural completeness | **Complete** | **Recovery complete; App/session incomplete** |
| Recommended next work | Features, stub migration | Features, isolated bug fixes; optional App host sprint |

---

## Part 6 — Policies going forward

### Bot Match

- **Frozen** at Phase 11
- Add modes via `modules/<mode>/use*Runtime.ts` + controller wiring
- Do not add logic to `BotMatchScreen.tsx`
- Canonical reference: [bot-match-architecture.md](./bot-match-architecture.md)

### Multiplayer recovery

- **Frozen** at Phase O
- Authority: `recoveryMachine` + `episodeSequence` + `projectionGate`
- Changes require regression tests in behavior + invariant suites
- No recovery refactors without proven production defect

### Multiplayer App / session (optional future sprint)

- Only if product prioritizes maintainability over feature velocity
- Recommended entry: Phase G (`useMultiplayerAppHost`) after test harness confidence
- Do not conflate with recovery work

---

## Part 7 — Verification commands

```bash
# Client behavior tests (31 multiplayer suites)
cd client && node run-behavior-tests.mjs

# Full vitest
cd client && npm test

# Client build
npm run build --prefix client

# Production reconnect QA
cd client && QA_BASE_URL=https://playracehorse.com node scripts/reconnectProductionQa.mjs
```

---

## Reference documents

### Bot Match

- [bot-match-architecture.md](./bot-match-architecture.md)
- [phase-11-bot-match-hardening-report.md](./phase-11-bot-match-hardening-report.md)
- [bot-match-final-verification-audit.md](./bot-match-final-verification-audit.md)
- [bot-match-engineering-excellence-audit.md](./bot-match-engineering-excellence-audit.md)
- [godfilesAUDIT.md](../../godfilesAUDIT.md) — starting-state audit

### Multiplayer / PvP

- [player-vs-player-architecture-audit.md](./player-vs-player-architecture-audit.md) — Phase 1
- [player-vs-player-extraction-plan.md](./player-vs-player-extraction-plan.md) — roadmap
- [phase-0-pvp-test-harness-report.md](./phase-0-pvp-test-harness-report.md)
- [phase-a-pvp-resync-extraction-report.md](./phase-a-pvp-resync-extraction-report.md)
- [phase-b-pvp-resync-queue-report.md](./phase-b-pvp-resync-queue-report.md)

### Key implementation files

**Bot Match:** `client/src/bot/BotMatchScreen.tsx`, `useBotMatchScreenController.ts`, `client/src/modules/`

**Multiplayer recovery:** `recoveryMachine.ts`, `socketEventBus.ts`, `useRoomSocketSync.ts`, `useMultiplayerConnection.ts`, `joinAckCoordinator.ts`, `useJoinAckCoordinator.ts`, `recoveryConnectionBridge.ts`, `registerMultiplayerConnectionSocketHandlers.ts`, `recoveryAuthorityContract.ts`