# Phase 11 — Bot Match Final Hardening, Cleanup, and Production Readiness

**Document type:** Principal engineer production hardening report  
**Date:** 2026-07-04  
**Scope:** Bot Match (`client/src/bot/`, `client/src/modules/` for match runtime)  
**Prerequisite:** Phase 10 architectural completion ([bot-match-architecture.md](./bot-match-architecture.md))  
**Status:** Complete — no further architecture phases justified

---

## Phase Charter

Bot Match structural architecture is **complete**. Phase 11 is **not** a refactor. It is a production hardening pass focused on:

- Correctness and diagnostics
- Compatibility cleanup (orphan shims only)
- Test harness reliability
- Type-safety hygiene
- Documented remaining debt

**Constraints observed:**

- No large-scale rewrites
- No file moves for cleanliness
- No architecture astronautics
- Public APIs preserved unless unreferenced
- Gameplay behavior preserved

---

## 1. Issues Found

### Critical

| ID | Issue | Location | Action |
|----|-------|----------|--------|
| — | None | — | — |

No critical production blockers identified in Bot Match runtime or composition path.

---

### High

| ID | Issue | Location | Action |
|----|-------|----------|--------|
| H-1 | `modules/guided/useGuidedMatchRuntimeTypes.ts` referenced `bot/guidedBotMatchHelpers.ts` in a `ReturnType<typeof import(...)>` — inverted dependency through a re-export stub | `modules/guided/useGuidedMatchRuntimeTypes.ts` | **Fixed** — points to `./guidedBotMatchHelpers.ts` |
| H-2 | `test:bot-hooks` failed under Node (`window is not defined`) — CI/script gap | `useMatchUiChrome.behaviorTests.ts`, `useAuthoringCapture.behaviorTests.ts` | **Fixed** — minimal `globalThis.window` polyfill |
| H-3 | Six bot re-export stubs had **zero repository references** — dead compatibility surface | `bot/botMatchApi.ts`, `botMatchHelpers.ts`, `botMatchDebug.ts`, `fairnessLog.ts`, `guidedBotMatchHelpers.ts`, `useAuthoringCapture.ts` | **Removed** |

---

### Medium

| ID | Issue | Location | Action |
|----|-------|----------|--------|
| M-1 | Legacy modal/portal components use `any` for post-game and guided props (18 occurrences across 6 files) | `bot/BotGameOverModal.tsx`, `BotPostGameCard.tsx`, `BotGuidedMatchPanel.tsx`, etc. | **Not changed** — requires coordinated type extraction from view-model; out of hardening scope |
| M-2 | Fire-and-forget `setTimeout` in player placement/draw animations without unmount guard | `modules/player-turn/usePlayerPlacementHandler.ts`, `usePlayerDrawAnimation.ts` | **Not changed** — low observed incidence; fix needs mounted-ref pattern across animation paths |
| M-3 | `PIVOTAL_REVIEW_WIZARD_ENABLED = false` — feature flag gates review UI but code paths remain | `modules/match/types/matchRuntimeTypes.ts`, `useReviewRuntime.ts`, `BotMatchModalLayer.tsx` | **Not changed** — intentional product gate; removal is a product decision |
| M-4 | Intentional `eslint-disable` on effect dependency arrays (guided/daily diagnostics) | `useDailyFritzDiagnostics.ts`, `useGuidedV2PlaybackEffects.ts`, `useAuthoringCapture.ts`, etc. | **Not changed** — each documents deliberate stale-closure tradeoff for match-state subscriptions |
| M-5 | Module test coverage gaps — no dedicated tests for `useMatchTurnStack`, `useGhostRuntime`, `useDailyFritzRuntime`, `useBotMatchBootstrap` | `modules/match/hooks/`, `modules/ghost/`, `modules/daily/` | **Not changed** — integration covered by vitest neighbors + manual QA; hook tests are expensive to mock |

---

### Low

| ID | Issue | Location | Action |
|----|-------|----------|--------|
| L-1 | `botMatchScreenTypes.ts` duplicates re-exports from `modules/match/types` | `bot/botMatchScreenTypes.ts` | **Kept** — composition-root import ergonomics |
| L-2 | Six remaining bot stubs (`botEngine`, `botHeuristics`, `fritzConfig`, `handLifecycle`, `publicDrawCost`, `usePostGamePivotalReview`) serve external features | learn/, devtools/, journey/, analyzer/, App.tsx | **Kept** — referenced externally |
| L-3 | Contract bridges still reach `dailyFritz/api.ts` and `ghost/logic.ts` | `modules/daily/*Contracts`, `modules/ghost/*` | **Kept** — bounded integration per Phase 10 |
| L-4 | `MatchEventBus` / `MatchSessionStore` partially adopted; hooks remain primary integration | `modules/match/` | **Kept** — optional future unify, not production risk |
| L-5 | Wide `CreateBotMatchViewModelArgs` prop bag | `bot/view-model/` | **Kept** — ergonomics debt, not correctness |
| L-6 | No `TODO` / `FIXME` / `HACK` in `bot/` or `modules/` match tree | — | Clean |
| L-7 | `as any` in `botEngine.test.ts` (fixture shortcut) | `modules/match/runtime/botEngine.test.ts` | **Not changed** — test-only |

---

## 2. Audit Results by Category

### Architecture

| Check | Result |
|-------|--------|
| Duplicate runtime logic | None found — single `botEngine`, single hand-lifecycle rules |
| Dead code (orphan stubs) | 6 removed (see H-3) |
| Unreachable branches | `PIVOTAL_REVIEW_WIZARD_ENABLED` paths unreachable at `false` — intentional |
| Obsolete compatibility code | 6 orphan stubs removed; 6 external stubs retained |
| Accidental Phase 1–10 abstractions | None requiring removal |
| Redundant re-export chains | Reduced from 12 → 6 stubs |
| `modules/*` → `bot/*` imports | **Zero** (H-1 was type-only reference; fixed) |

### Runtime Safety

| Check | Result |
|-------|--------|
| Timer cleanup in match presentation / bot turn / hand lifecycle | Proper `clearTimeout` in effect cleanups |
| `pagehide` / `resize` listener cleanup | Present in `useDailyFritzSessionPersistence`, `useMatchPresentation`, `useStandaloneFritzRatingSession` |
| Stale closure risks | Mitigated via refs in bootstrap/turn stack; some intentional dep-array suppressions |
| Race conditions | Hand advance retry + draw sequence use explicit guards (`shouldApplyBotActionResult`, bot turn guards) |
| React StrictMode | No double-mount hazards identified in turn orchestration |
| Animation timer leaks (M-2) | Theoretical only; documented |

### TypeScript

| Check | Result |
|-------|--------|
| `any` in `modules/` | 1 (test fixture) |
| `any` in `bot/` view modals | 18 (legacy portals — M-1) |
| Duplicate interfaces | `botMatchScreenTypes` re-exports canonical types — acceptable |
| Unsafe casting | No new issues in runtime path |

### Performance

| Check | Result |
|-------|--------|
| Obvious render hotspots | None requiring change — view-model assembly is single pass per controller render |
| Duplicate board calculations | Engine calls centralized in `botEngine` / turn orchestration |
| Unnecessary memoization | No removals warranted — existing `useCallback`/`useMemo` tied to stable child props |

### Testing

| Suite | Result |
|-------|--------|
| Vitest (`npm test`) | 347 / 347 pass |
| Behavior tests (`run-behavior-tests.mjs`) | Pass (engine, heuristics, hand lifecycle, tier, etc.) |
| `test:bot-hooks` | Pass (after H-2 fix) |
| Client build | Pass |
| Server build | Pass |

**Coverage inventory:** 16 unit tests under `modules/`; 10+ behavior test files under `bot/`; engine parity and tier calibration covered.

---

## 3. Exactly What Was Changed

| File | Change |
|------|--------|
| `modules/guided/useGuidedMatchRuntimeTypes.ts` | `ReturnType` import path: `bot/guidedBotMatchHelpers` → `./guidedBotMatchHelpers` |
| `bot/useMatchUiChrome.behaviorTests.ts` | Added `globalThis.window` polyfill for Node execution |
| `bot/useAuthoringCapture.behaviorTests.ts` | Window polyfill; hook path → `modules/match/hooks/useAuthoringCapture.ts` |
| **Deleted** `bot/botMatchApi.ts` | Orphan stub |
| **Deleted** `bot/botMatchHelpers.ts` | Orphan stub |
| **Deleted** `bot/botMatchDebug.ts` | Orphan stub |
| **Deleted** `bot/fairnessLog.ts` | Orphan stub |
| **Deleted** `bot/guidedBotMatchHelpers.ts` | Orphan stub |
| **Deleted** `bot/useAuthoringCapture.ts` | Orphan stub |
| `docs/architecture/phase-11-bot-match-hardening-report.md` | This report |
| `docs/architecture/bot-match-architecture.md` | Phase 11 status note (below) |

---

## 4. What Was Intentionally NOT Changed

- **Gameplay logic** — engine, heuristics, draw/pass, scoring, hand lifecycle rules
- **Composition structure** — `BotMatchScreen` (8 LOC), controller (170 LOC), view-model, view tree
- **External-facing stubs** — `botEngine`, `botHeuristics`, `fritzConfig`, `handLifecycle`, `publicDrawCost`, `usePostGamePivotalReview` (still imported by learn/, devtools/, journey/, analyzer/, App.tsx)
- **Legacy modal `any` props** — would require view-model type wiring across 6 components
- **Feature flag** — `PIVOTAL_REVIEW_WIZARD_ENABLED`
- **Contract bridges** — `dailyFritzContracts`, `ghostContracts`, `ghostMoveLogic`
- **Event bus partial adoption** — infrastructure exists; hook wiring is stable
- **Animation timer unmount guards** — low priority; no reported production incidents
- **eslint-disable comments** on complex match-state effects — documented tradeoffs

---

## 5. Remaining Technical Debt (Bot Match)

| Priority | Item | Recommendation |
|----------|------|----------------|
| Medium | Modal `any` props | Type from `botMatchViewModelTypes` when touching post-game UI |
| Medium | Hook integration tests | Add when a regression occurs — not preemptive |
| Low | 6 external bot stubs | Migrate learn/devtools imports to `modules/` over time |
| Low | Contract bridge → shared package | Platform-wide effort, not Bot Match–only |
| Low | Event bus as primary integration | Optional; only if merge conflicts in turn stack increase |
| Low | Animation unmount guards | Fix if StrictMode warnings appear in dev |

---

## 6. Production Readiness

### Verdict: **Production-ready for Bot Match**

| Criterion | Status |
|-----------|--------|
| Structural architecture | Complete (Phase 10) |
| Build | Pass |
| Unit + behavior tests | Pass |
| No critical/high open issues | Yes (H-1–H-3 resolved) |
| Dependency law (`modules` ↛ `bot`) | Enforced |
| Observable runtime hazards | None blocking ship |

Bot Match is suitable for production deployment. Remaining debt is **maintainability and typing polish**, not structural risk.

---

## 7. Additional Architecture Phases — Justified?

**No.** No meaningful architecture work remains inside Bot Match.

| Proposed future work | Classification |
|---------------------|----------------|
| Migrate learn/devtools off bot stubs | Incremental cleanup — not a phase |
| Extract `dailyFritz`/`ghost` APIs to package | Platform initiative — not Bot Match–scoped |
| Tighten modal TypeScript | UI typing pass — feature-adjacent |
| Event bus unification | Optional optimization — not required |

**Future engineering on Bot Match should focus on product features** (new modes, UX, Fritz tuning) **rather than refactoring.**

---

## 8. Updated Stub Inventory (Post-Phase 11)

| Remaining stub | Canonical target | External callers |
|----------------|------------------|------------------|
| `bot/botEngine.ts` | `modules/match/runtime/botEngine.ts` | learn/, devtools/, dailyPuzzle/, analyzer/, App.tsx, journey/, components/Board.tsx |
| `bot/botHeuristics.ts` | `modules/fritz/botHeuristics.ts` | learn/, devtools/, analyzer/ |
| `bot/fritzConfig.ts` | `modules/fritz/fritzConfig.ts` | learn/, stats/, journey/, App.tsx, dailyFritz/api.ts |
| `bot/handLifecycle.ts` | `modules/match/hand-lifecycle/handLifecycleRules.ts` | `handLifecycle.behaviorTests.ts` |
| `bot/publicDrawCost.ts` | `modules/fritz/publicDrawCost.ts` | `publicDrawCost.behaviorTests.ts` |
| `bot/usePostGamePivotalReview.ts` | `modules/review/usePostGamePivotalReview.ts` | `usePostGamePivotalReview.behaviorTests.ts` |
| `bot/botMatchScreenTypes.ts` | `modules/match/types`, `modules/match/contracts` | Composition root + view |

**Removed in Phase 11:** `botMatchApi`, `botMatchHelpers`, `botMatchDebug`, `fairnessLog`, `guidedBotMatchHelpers`, `useAuthoringCapture` (all zero-reference).

---

## 9. Related Documentation

- [bot-match-architecture.md](./bot-match-architecture.md) — canonical architecture (Phase 10)
- [ARCHITECTURE_OVERVIEW.md](./ARCHITECTURE_OVERVIEW.md) — platform-wide context