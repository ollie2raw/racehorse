# Bot Match — Final Verification Audit (Red Team)

**Document type:** Independent principal-engineer red-team review  
**Date:** 2026-07-04  
**Auditor stance:** Assume Phases 1–11 conclusions may be wrong; try to disprove architectural completeness  
**Scope:** `client/src/bot/`, `client/src/modules/` (match runtime tree), and cross-boundary couplings that affect Bot Match  
**Method:** Fresh grep, import tracing, LOC sampling, effect/timer review, build/test reconfirmation — prior reports not taken as ground truth

---

## Executive Summary

**The red team could not disprove architectural completeness for Bot Match.**

The composition root is genuinely thin (8 LOC). Runtime logic lives under `modules/` with a single engine authority (`modules/match/runtime/botEngine.ts`). There are **zero** `modules/* → bot/*` runtime imports. Ref-bridge patterns (`useMatchTurnPortWiring`, mutable callback patching) are absent.

What remains is **bounded integration complexity**, **typing debt in legacy modals**, and **a handful of async-effect hygiene gaps** — none of which justify another architecture phase. These are fix-on-touch or product-priority items.

| Severity | Count | Blocks production? |
|----------|-------|-------------------|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 8 | No |
| Low | 12 | No |

**Verdict:** Bot Match architecture is **complete**. Future engineering should prioritize **product features**, not additional refactoring. **No further architecture phases are recommended.**

---

## Audit Methodology

1. Re-scanned import graph (`bot/`, `modules/`, `dailyFritz/`, `ghost/`, external consumers)
2. Ranked files by LOC to hunt hidden god objects
3. Searched for ref bridges, circular patterns, duplicate engine paths, stale stubs
4. Reviewed timer/effect cleanup in ghost completion, daily completion, player animations
5. Re-ran `npm test` (347 pass), `npm run build --prefix client` (pass)
6. Challenged Phase 10/11 claims (stub inventory, dependency law, production readiness)

---

## Issues Found

### Critical

*None.*

No hidden god screen, no duplicated authoritative match state, no modules importing bot runtime, no circular import chains detected in manual trace of match/daily/ghost/fritz/guided/bot-turn/player-turn.

---

### High

*None.*

`useHandLifecycle` (500 LOC) and `useMatchTurnStack` (265 LOC) are large but **delegating orchestrators**, not monolithic state owners. Complexity is proportional to Daily Fritz hand advance + guided + turn wiring. Splitting them would be a **refactor for LOC**, not a correctness fix.

---

### Medium

#### M-1: View-model types bypass contract facades

| Field | Value |
|-------|-------|
| **Location** | `bot/view-model/botMatchViewModelTypes.ts` lines 7–12 |
| **What** | Imports `DailyFritzStartResponse`, `DailyFritzLeaderboardRow` from `dailyFritz/api.ts` and `GhostCompletionResult` from `ghost/api.ts` directly |
| **Why it's a problem** | Runtime modules were standardized on `modules/daily/*Contracts` and `modules/ghost/*Contracts` in Phase 10. The view-model layer reintroduces a **second integration path** into feature folders. If API types move, two surfaces must update. |
| **Worth fixing?** | Yes, when touching view-model types — not urgent |
| **Cost** | ~1 hour; swap three import paths to facades |
| **Tradeoff** | Slightly more indirection in types vs. consistent boundary |
| **Cosmetic?** | No — real ownership inconsistency, low runtime risk |

---

#### M-2: Async ghost completion lacks effect cleanup / stale-response guard

| Field | Value |
|-------|-------|
| **Location** | `modules/ghost/useGhostMatchCompletion.ts` — `useEffect` with `void completeGhostGame(...).then(...)` |
| **What** | No `return () => { cancelled = true }` or AbortController; promise handlers call `setGhostResult`, `setGhostResultLoading`, `onProfilePatch` after unmount/navigation |
| **Why it's a problem** | Fast exit after game over (back button, route change) can trigger React state updates on an unmounted tree. Same pattern in `modules/daily/useDailyFritzCompletion.ts`. |
| **Worth fixing?** | Yes — standard async-effect hygiene |
| **Cost** | ~2–4 hours across ghost + daily completion hooks |
| **Tradeoff** | Minor effect complexity vs. eliminating rare post-unmount warnings/races |
| **Cosmetic?** | No — real but **low incidence** runtime hazard |

---

#### M-3: `match` ↔ `daily` bidirectional module coupling

| Field | Value |
|-------|-------|
| **Location** | `modules/match/hooks/useBotMatchBootstrap.ts`, `useHandLifecycle.ts`, `useMatchTurnStack.ts` ↔ `modules/daily/useDailyFritzRuntime.ts`, `useDailyFritzDiagnostics.ts` |
| **What** | Match kernel imports daily runtime types, diagnostics, contracts; daily runtime imports match engine, bootstrap types, pre-game draw |
| **Why it's a problem** | Changes to Daily Fritz in-match behavior require reasoning across two module trees. This is **integration hub coupling**, not inversion — but it increases merge-conflict surface. |
| **Worth fixing?** | Not as a standalone phase — only if Daily Fritz is extracted to a separate package |
| **Cost** | High (days–weeks) to invert behind events or a dedicated integration module |
| **Tradeoff** | Purity vs. pragmatic single-match orchestration |
| **Cosmetic?** | No — structural, but **accepted** for a multi-mode match shell |

---

#### M-4: `fritz` module depends on `ghost` runtime shape

| Field | Value |
|-------|-------|
| **Location** | `modules/fritz/useFritzRatingDisplay.ts` |
| **What** | Takes `UseGhostRuntimeResult` as input; imports `roundedRatingDelta` from `modules/ghost/ghostMatchHelpers.ts` |
| **Why it's a problem** | Play-vs-Fritz rating display is coupled to ghost runtime's return type. Fritz cannot be understood without ghost module types. |
| **Worth fixing?** | Only if Fritz rating is reused outside ghost matches |
| **Cost** | ~4–8 hours to introduce a narrow `RatingSessionPort` interface |
| **Tradeoff** | Extra interface vs. current single consumer (controller wires both) |
| **Cosmetic?** | Borderline — pragmatic wiring, not a violation of match kernel ownership |

---

#### M-5: View-model assembly runs on every controller render (no memoization)

| Field | Value |
|-------|-------|
| **Location** | `bot/useBotMatchScreenController.ts` → `createBotMatchViewModel(...)`; `assembleBotMatchViewModel.ts` (337 LOC) |
| **What** | Full view-model object graph rebuilt whenever any wired hook state changes |
| **Why it's a problem** | Any chrome toggle, toast, or turn-side-effect state triggers ~300-line projection. Could amplify render cost during animated sequences. |
| **Worth fixing?** | Only if profiling shows jank — not preemptively |
| **Cost** | ~4–12 hours to segment memoization by view region |
| **Tradeoff** | Memo complexity vs. simpler mental model (single projection pass) |
| **Cosmetic?** | Partially — architectural smell, not yet a measured perf bug |

---

#### M-6: Legacy post-game modals use `any` (18 occurrences)

| Field | Value |
|-------|-------|
| **Location** | `BotGameOverModal.tsx`, `BotPostGameCard.tsx`, `BotGuidedMatchPanel.tsx`, `BotPivotalReviewPortal.tsx`, `BotReviewSummaryPortal.tsx`, `BotHandOverModal.tsx` |
| **Why it's a problem** | Weak compile-time guarantees on post-game data flow; regressions won't be caught by TypeScript |
| **Worth fixing?** | When editing those modals |
| **Cost** | ~1–2 days to wire modal props from `botMatchViewModelTypes` nested sections |
| **Tradeoff** | Typing effort vs. legacy portal components predating view-model |
| **Cosmetic?** | No for maintainability; **yes** for current production stability (runtime works) |

---

#### M-7: Ecosystem still routes through `bot/` stubs

| Field | Value |
|-------|-------|
| **Location** | `dailyFritz/api.ts`, `learn/*`, `devtools/*`, `analyzer/*`, `App.tsx` (~40 import sites) |
| **What** | External features import `bot/botEngine`, `bot/botHeuristics`, `bot/fritzConfig` rather than `modules/` |
| **Why it's a problem** | Dual public entry points to the same runtime; stubs must be maintained until migrated |
| **Worth fixing?** | Incrementally per feature — not Bot Match–scoped |
| **Cost** | ~2–4 hours per consumer cluster |
| **Tradeoff** | Cleaner graph vs. churn across learn/devtools/journey |
| **Cosmetic?** | No for platform hygiene; **not** a Bot Match internal defect |

---

#### M-8: `match-turn-stack/` builder shard proliferation

| Field | Value |
|-------|-------|
| **Location** | 17 files under `modules/match/match-turn-stack/` including `buildBotTurnPorts`, `buildMatchTurnCommandPorts`, etc. |
| **What** | Several builders are **pass-through wrappers** (copy input fields to output object) |
| **Why it's a problem** | Navigation cost for new contributors; some files exist only to satisfy Phase 8/9 port extraction |
| **Worth fixing?** | No — collapsing them is LOC refactor, not hardening |
| **Cost** | Medium refactor with regression risk |
| **Tradeoff** | Fewer files vs. explicit port construction at turn-stack boundary |
| **Cosmetic?** | **Subjective** — trade acceptable explicitness for file count |

---

### Low

#### L-1: Large domain files (pre-existing, not refactor regressions)

| File | LOC | Note |
|------|-----|------|
| `modules/fritz/botHeuristics.ts` | 1,930 | Fritz AI domain — concentrated by nature |
| `modules/match/runtime/botEngine.ts` | 1,080 | Engine authority — correct location |
| `modules/match/hooks/useAuthoringCapture.ts` | 397 | Feature complexity |

**Worth fixing?** No — splitting without product motive is refactor theater.

---

#### L-2: Six remaining `bot/` re-export stubs

`botEngine`, `botHeuristics`, `fritzConfig`, `handLifecycle`, `publicDrawCost`, `usePostGamePivotalReview` — all externally referenced. Correct to keep.

---

#### L-3: `PIVOTAL_REVIEW_WIZARD_ENABLED = false`

Dead UI paths remain in `useReviewRuntime`, `BotMatchModalLayer`. Intentional product gate. Removal is product decision.

---

#### L-4: Fire-and-forget animation timers without unmount guard

`modules/player-turn/usePlayerPlacementHandler.ts`, `usePlayerDrawAnimation.ts` — `setTimeout` for ghost feedback and flying tiles. Theoretical setState-after-unmount during fast navigation.

**Worth fixing?** Only if devtools show warnings. **Cost:** ~2 hours.

---

#### L-5: `useGuidedWindowDebugApis.ts` (286 LOC)

Mounts debug APIs on `window` in learn/academy modes. Dev-facing; gated by mode flags. Not production risk.

---

#### L-6: `MatchEventBus` / `MatchSessionStore` partially adopted

Infrastructure exists; hooks + `useMatchRuntimeBridge` remain primary integration. Aspirational, not broken. Unifying is optional platform work.

---

#### L-7: Intentional `eslint-disable` on complex effect deps

`useDailyFritzDiagnostics`, `useGuidedV2PlaybackEffects`, `useAuthoringCapture` — document stale-closure tradeoffs. Correct if reviewed; wrong if deps drift.

---

#### L-8: `botMatchScreenTypes.ts` duplicates `modules/match/types` re-exports

Composition ergonomics. Low duplication cost.

---

#### L-9: `computeNormalHandRows` in `BotMatchScreenView` on every render

Hand sizes are small (≤7 tiles typical). Not a hotspot without profiling.

---

#### L-10: `dependency-cruiser` has no Bot Match–specific rules

CI enforces game/devtools boundaries but not `modules ↛ bot`. Currently satisfied by convention. Adding a rule would be ~1 hour hardening.

---

#### L-11: Contract bridges still reach `dailyFritz/` and `ghost/` feature folders

Documented in Phase 10. Bounded, intentional until package extraction.

---

#### L-12: `bot/view/**` imports `modules/` for diagnostics/debug types

View layer reaches into runtime modules for `traceDailyFritzEvent`, `HandLifecycleDebugSnapshot`. Acceptable for debug/diagnostic surfaces.

---

## Category Checklist (Red-Team Answers)

| Category | Finding |
|----------|---------|
| Hidden god objects | **None blocking.** Largest hooks orchestrate; they don't own parallel state |
| Dependency violations | **None inside Bot Match runtime** (`modules ↛ bot`). View-model bypasses facades (M-1) |
| Circular imports | **None found** in match/daily/ghost/fritz/guided/bot-turn/player-turn trace |
| Duplicated business logic | **None** — hand lifecycle rules centralized; single engine |
| Accidental coupling | match↔daily (M-3), fritz→ghost (M-4) — integration, not inversion |
| Stale compatibility layers | 6 stubs retained with external refs; 6 orphans correctly removed in Phase 11 |
| Unnecessary abstractions | Thin port builders (M-8) — subjective |
| Architectural hotspots | `useHandLifecycle`, `assembleBotMatchViewModel`, `useMatchTurnStack` — manageable |
| Dead code | `PIVOTAL_REVIEW` paths at `false` — intentional gate |
| Hidden runtime risks | Async completion without cleanup (M-2); animation timers (L-4) |
| Render performance | Unmemoized view-model (M-5) — unproven hotspot |
| Maintainability | Modal `any` types (M-6); large authoring hook (L-1) |
| Ownership violations | View-model → feature APIs (M-1); ecosystem → bot stubs (M-7) |
| Modules that know too much | `useMatchTurnStack` — **by design** as turn integration hub |
| SRP violations | `assembleBotMatchViewModel` is large but single-purpose (projection) |
| Refactor regressions | Ref bridges **eliminated** (verified). No restored god screen |

---

## What Was Intentionally NOT Flagged as Issues

| Item | Reason |
|------|--------|
| `botHeuristics.ts` size | Domain concentration; pre-dates refactor; tests exist |
| `PlayVsFritz.tsx` hub screen in `bot/` | Separate product surface, not match runtime |
| `BotGameOverModal.tsx` size | UI component; typing debt noted separately |
| Collapsing `match-turn-stack/` | Would be refactor, not verification finding |
| Migrating all learn/devtools imports | Platform cleanup, not Bot Match completeness |

---

## Reconfirmation of Prior Phase Claims

| Phase 10/11 Claim | Red-Team Result |
|-------------------|-----------------|
| Composition root 8 LOC | ✅ Verified |
| Zero `modules → bot` imports | ✅ Verified |
| No ref-bridge wiring | ✅ Verified |
| Orphan stubs removed | ✅ Verified (6 deleted, none orphaned remain) |
| `test:bot-hooks` passes | ✅ Verified (Phase 11 polyfill) |
| Production-ready | ✅ Confirmed with M-2 caveat (low incidence) |

---

## Remaining Technical Debt (Honest Inventory)

| Priority | Item | Recommended action |
|----------|------|-------------------|
| Medium | M-2 async effect cleanup | Fix on next ghost/daily touch |
| Medium | M-1 view-model facade alignment | Fix when editing view-model types |
| Medium | M-6 modal typing | Fix when editing post-game UI |
| Low | M-7 external stub migration | Per-feature incremental |
| Low | M-5 view-model memoization | Profile first |
| Low | L-4 animation unmount guards | Fix if StrictMode warnings appear |
| Low | L-10 depcruiser rule | Optional CI hardening |

---

## Production Readiness (Red-Team Verdict)

**Bot Match is production-ready.**

- Build passes
- 347 unit tests pass
- No critical or high architectural defects
- Medium issues are **maintainability and hygiene**, not structural failure
- Gameplay authority is singular and test-covered

The M-2 async cleanup gap is the strongest runtime concern and is still **low incidence** (post-game-over navigation edge case).

---

## Are Additional Architecture Phases Justified?

**No.**

| Proposed work | Red-team classification |
|---------------|------------------------|
| Phase 12: split `useHandLifecycle` | Refactor theater — high regression risk, no user value |
| Phase 12: collapse `match-turn-stack/` | LOC cleanup — violates hardening mandate |
| Phase 12: migrate all bot stubs | Platform incremental work — not architecture |
| Phase 12: event bus unification | Optional optimization — not required |
| Phase 12: package extraction for dailyFritz/ghost | Platform initiative — spans beyond Bot Match |

**Explicit statement:**

> **Bot Match architecture is complete.**  
> **Future engineering effort should prioritize product features instead of additional refactoring.**  
> **No further architecture phases are recommended.**

The red team attempted to disprove completeness by hunting god objects, inversion, duplication, and regressions. What remains does not reconstitute a god screen or violate the dependency law inside the match runtime. Do not invent work to justify Phase 12.

---

## Related Documents

- [bot-match-architecture.md](./bot-match-architecture.md) — canonical structure (Phase 10)
- [phase-11-bot-match-hardening-report.md](./phase-11-bot-match-hardening-report.md) — hardening pass (Phase 11)