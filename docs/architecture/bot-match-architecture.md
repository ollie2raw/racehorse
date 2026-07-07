# Bot Match Architecture

**Status:** Canonical source of truth (Phase 10 complete, Phase 11 hardened)  
**Scope:** `client/src/bot/` (composition + view) and `client/src/modules/` (runtime)  
**Last updated:** 2026-07-04  
**Hardening report:** [phase-11-bot-match-hardening-report.md](./phase-11-bot-match-hardening-report.md)  
**Red-team verification:** [bot-match-final-verification-audit.md](./bot-match-final-verification-audit.md)  
**Engineering excellence audit:** [bot-match-engineering-excellence-audit.md](./bot-match-engineering-excellence-audit.md)  
**Contrast (PvP audit):** [player-vs-player-architecture-audit.md](./player-vs-player-architecture-audit.md)

---

## 1. Summary

Bot Match is decomposed into a thin **composition root** (`BotMatchScreen.tsx`), a **controller** (`useBotMatchScreenController.ts`), a **view model** layer, and a **view** layer — with all runtime logic owned under `client/src/modules/`.

The refactor goal is met: `BotMatchScreen` assembles subsystems; it does not own business rules or authoritative game state.

| Layer | Location | Responsibility |
|-------|----------|----------------|
| Composition root | `bot/BotMatchScreen.tsx` | Mount screen, pass props to controller |
| Controller | `bot/useBotMatchScreenController.ts` | Wire subsystem hooks, return view model |
| View model | `bot/view-model/`, `bot/createBotMatchViewModel.ts` | Derive render-ready props from hook outputs |
| View | `bot/BotMatchScreenView.tsx`, `bot/view/**` | Pure presentation; no runtime ownership |
| Runtime | `modules/**` | Match engine, turns, modes, API contracts |

---

## 2. Composition Flow

```
BotMatchScreen (props)
  └─ useBotMatchScreenController
       ├─ useGuidedLessonBoot          [modules/guided]
       ├─ useBotMatchBootstrap         [modules/match]  ← MatchRuntimeBridge, engine state
       ├─ useBotMatchRefs              [modules/match]
       ├─ useMatchUiChrome             [bot/ — UI chrome only]
       ├─ useReplayRecorder            [modules/replay]
       ├─ useLocalRunSession           [modules/bot-turn]
       ├─ useAuthoringCapture          [modules/match]
       ├─ useMatchPresentation         [modules/match]
       ├─ useGhostRuntime              [modules/ghost]
       ├─ useDailyFritzRuntime         [modules/daily]
       ├─ useReviewRuntime             [modules/review]
       ├─ useMatchTurnStack            [modules/match]  ← player + bot turn orchestration
       ├─ useFritzRatingDisplay        [modules/fritz]
       ├─ useDailyPuzzleLeaderboardSync [modules/daily-puzzle]
       ├─ useMatchNavigation           [modules/match]
       └─ createBotMatchViewModel → BotMatchScreenView
```

**Data flow:** Props flow down; hook return values are collected into `CreateBotMatchViewModelArgs` and projected into `BotMatchScreenViewProps`. Turn actions flow through `useMatchTurnStack`, which delegates to `usePlayerTurnOrchestration` and `useBotTurnOrchestration`.

**State authority:** `BotMatchState` lives in bootstrap (`useBotMatchBootstrap` / `MatchSessionStore`). Subsystems receive refs and setters; they do not maintain parallel copies of match state.

---

## 3. Module Ownership

| Module | Owns | Does not own |
|--------|------|--------------|
| **match** | Bootstrap, refs, presentation, navigation, turn stack, hand lifecycle, engine runtime, match API, authoring capture | Ghost/Daily API transport (delegates to feature modules) |
| **bot-turn** | Bot scheduling, draw sequence, bot move execution, bot ghost sync, local run session | Engine rules (uses `match/runtime/botEngine`) |
| **player-turn** | Human input orchestration, player ghost sync, move snapshots | Board rendering |
| **fritz** | Heuristics, tier config, public draw cost, rating display | Engine (imports from `match/runtime`) |
| **guided** | Lesson boot, coach presentation, V1/V2 playback, placement handlers | Match bootstrap |
| **ghost** | Ghost runtime, session start, completion, move resolution helpers | Ghost feature UI (`ghost/` screens) |
| **daily** | Daily Fritz in-match runtime, persistence, completion, diagnostics | Daily Fritz hub UI (`dailyFritz/` screens) |
| **review** | Post-game pivotal review runtime | Review UI components |
| **replay** | Move log recorder | — |
| **daily-puzzle** | Leaderboard sync inside bot shell | Daily puzzle screens |

### Shared primitives (not feature-owned)

| Artifact | Location | Used by |
|----------|----------|---------|
| Tile key helpers | `game/tileKeys.ts` | match, player-turn, bot-turn, ghost |
| Board state serialization (ghost) | `modules/ghost/ghostMoveLogic.ts` → `ghost/logic.ts` | authoring, snapshots, ghost helpers |

---

## 4. Dependency Direction

**Allowed (inward toward domain):**

```
bot/view → bot/view-model → bot/controller → modules/* → game/*, types, analyzer
```

**Forbidden (resolved in Phase 9–10):**

- `modules/*` → `bot/*` — **none remain**
- Cross-feature direct imports from `dailyFritz/*` or `ghost/*` inside non-bridge modules

**Integration bridges (intentional):**

Feature folders (`dailyFritz/`, `ghost/`) retain UI and HTTP API implementations. Bot Match modules integrate through **contract facades**:

| Facade | Bridges to | Consumed by |
|--------|------------|-------------|
| `modules/daily/dailyFritzContracts.ts` | `dailyFritz/api.ts` | daily runtime, hand lifecycle, completion |
| `modules/daily/dailyFritzUiContracts.ts` | `dailyFritz/setOverlayViewModel.ts`, `shareCard.ts` | daily runtime (share overlay) |
| `modules/daily/dailyFritzMatchDiagnostics.ts` | (owned runtime) | match, daily, bot-turn |
| `modules/ghost/ghostContracts.ts` | `ghost/api.ts` | ghost runtime, turn stacks |
| `modules/ghost/ghostMoveLogic.ts` | `ghost/logic.ts` | bot-turn, player-turn, ghost helpers |
| `modules/ghost/ghostMatchHelpers.ts` | ghost logic + contracts | ghost runtime, fritz rating |

Cross-module imports use `modules/<feature>/` paths (e.g. `modules/ghost/ghostContracts.ts`), never `ghost/api.ts` directly from `modules/match/` or `modules/bot-turn/`.

---

## 5. Runtime Layering

```
┌─────────────────────────────────────────────────────────┐
│  View (bot/view/**)          — React presentation       │
├─────────────────────────────────────────────────────────┤
│  View model (bot/view-model) — derived UI state         │
├─────────────────────────────────────────────────────────┤
│  Controller hooks            — composition, no rules    │
├─────────────────────────────────────────────────────────┤
│  Feature runtimes            — ghost, daily, guided,    │
│  (modules/*/use*Runtime)       review, fritz display    │
├─────────────────────────────────────────────────────────┤
│  Turn orchestration          — player-turn, bot-turn    │
├─────────────────────────────────────────────────────────┤
│  Match kernel                — bootstrap, turn stack,     │
│  (modules/match)             hand lifecycle, navigation │
├─────────────────────────────────────────────────────────┤
│  Engine + heuristics         — botEngine, botHeuristics │
│  (modules/match/runtime,     fritzConfig                 │
│   modules/fritz)                                        │
├─────────────────────────────────────────────────────────┤
│  game/, types/               — pure domain helpers      │
└─────────────────────────────────────────────────────────┘
```

### Match kernel internals

- **Bootstrap** (`useBotMatchBootstrap`): creates match, wires `MatchRuntimeBridge`, resolves mode flags.
- **Turn stack** (`useMatchTurnStack`): composes player and bot turn hooks; single entry for turn side-effects.
- **Hand lifecycle** (`useHandLifecycle`, `hand-lifecycle/*`): hand advance, reveal, prefetch, Daily Fritz hand service.
- **Infrastructure** (partial adoption): `MatchEventBus`, `MatchSessionStore`, `MatchLifecycleController` — wired via `useMatchRuntimeBridge`; primary integration remains hook return values and refs.

---

## 6. `bot/` Re-export Façade

Thin stubs in `client/src/bot/*.ts` re-export canonical implementations for **external callers** that predate the module tree. Phase 11 removed six orphan stubs with zero repository references.

| Stub | Canonical target | External callers |
|------|------------------|------------------|
| `botEngine.ts` | `modules/match/runtime/botEngine.ts` | learn/, devtools/, dailyPuzzle/, analyzer/, App.tsx, journey/ |
| `botHeuristics.ts` | `modules/fritz/botHeuristics.ts` | learn/, devtools/, analyzer/ |
| `fritzConfig.ts` | `modules/fritz/fritzConfig.ts` | learn/, stats/, journey/, App.tsx |
| `handLifecycle.ts` | `modules/match/hand-lifecycle/handLifecycleRules.ts` | behavior tests |
| `publicDrawCost.ts` | `modules/fritz/publicDrawCost.ts` | behavior tests |
| `usePostGamePivotalReview.ts` | `modules/review/usePostGamePivotalReview.ts` | behavior tests |

**Bot Match internals** (controller, view-model, key UI) import from `modules/` directly. Stubs are not used inside the composition path.

**Deletion policy:** Remove a stub only when all external importers are migrated. Stubs are compatibility shims, not architectural layers.

---

## 7. Extension Points

### Adding a new in-match mode

1. Create `modules/<mode>/use<Mode>Runtime.ts` with explicit args/result types.
2. Wire in `useBotMatchScreenController` between bootstrap and turn stack (or inside turn stack if turn-affecting).
3. Extend `CreateBotMatchViewModelArgs` and view-model builders if the UI needs new props.
4. Add mode flags to `useBotMatchBootstrap` / `matchCapabilitiesFromProps` if boot behavior changes.
5. Do **not** add logic to `BotMatchScreen.tsx` or view components.

### Adding engine or heuristic behavior

- Engine rules → `modules/match/runtime/botEngine.ts`
- Fritz AI / tiers → `modules/fritz/botHeuristics.ts`, `modules/fritz/fritzConfig.ts`
- Keep `game/` free of React imports.

### Integrating a new cross-feature API (e.g. new leaderboard)

1. Add `modules/<feature>/<feature>Contracts.ts` facade over the feature folder's `api.ts`.
2. Import the facade from runtime modules — never from `modules/match/` directly into `feature/api.ts`.

### Testing

- Unit tests colocated with modules (`*.test.ts` under `modules/`).
- Engine/heuristic behavior tests may remain under `bot/*.behaviorTests.ts` (import via stubs or direct module paths).
- Vitest suite: `npm test` in `client/`.

---

## 8. Validation Checklist (Phase 10)

| Check | Result |
|-------|--------|
| No `modules/*` → `bot/*` imports | ✅ Pass |
| No ref-bridge / `useMatchTurnPortWiring` | ✅ Pass |
| No mutable callback patching in turn stack | ✅ Pass |
| Cross-feature runtime via facades only | ✅ Pass (see §4 bridges) |
| Single engine ownership (`modules/match/runtime/botEngine`) | ✅ Pass |
| Composition root < 20 LOC | ✅ Pass (8 LOC) |
| Client build | ✅ Pass |
| Vitest (347 tests) | ✅ Pass |

---

## 9. Remaining Debt (Bot Match only)

Low severity; does not block architectural completeness:

1. **Re-export stubs** — 6 thin `bot/*.ts` files remain for learn/, devtools/, journey/, analyzer/, and behavior tests (Phase 11 removed 6 orphan stubs). Migrate callers incrementally; no rush.
2. **Contract bridges** — `dailyFritzContracts`, `ghostContracts`, and `ghostMoveLogic` still reach into `dailyFritz/` and `ghost/` feature folders. Acceptable until those APIs move to a shared package.
3. **View-model prop bag** — `CreateBotMatchViewModelArgs` is wide; acceptable for a composition screen. Future tightening is ergonomics, not architecture.
4. **Event bus adoption** — `MatchEventBus` exists but hooks remain primary integration. Optional future unify.
5. **Hook behavior tests** — `test:bot-hooks` passes under Node after Phase 11 polyfill fix.

---

## 10. Architectural Completeness

**Bot Match can be considered architecturally complete.**

- Composition root, controller, modules, and view layers have clear ownership.
- Dependency law is enforced: modules do not import from `bot/`.
- Cross-feature coupling is bounded by explicit contract facades.
- No circular imports, ref bridges, or duplicated runtime ownership were found in audit.

Further work is **incremental cleanup** (stub migration, bridge extraction to packages), not structural refactor. Do not start Phase 11 unless new product requirements demand it.