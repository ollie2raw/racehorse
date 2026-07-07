# Bot Match — Engineering Excellence Audit

**Document type:** Staff/Principal engineer pre-production review  
**Date:** 2026-07-04  
**Scope:** Bot Match system (`client/src/bot/`, `client/src/modules/` match runtime)  
**Stance:** Architecture phases are complete — evaluate correctness, tooling, DX, and production readiness without inventing refactor work

---

## Executive Summary

Bot Match is **production-ready** and reflects **above-average engineering maturity** for a solo-to-small-team game client: strict TypeScript, a real CI pipeline (typecheck, lint, dep boundaries, vitest, behavior tests, Playwright, build), strong engine/heuristic test coverage, and a genuine composition-root architecture.

It is **not yet exemplary** by $100M-studio standards. Gaps are concentrated in **automated architectural enforcement**, **async effect hygiene**, **legacy modal typing**, and **eslint rigor** — all fixable incrementally without new architecture phases.

**No additional architecture phases are recommended.**

---

## A. Critical Issues

*None identified that genuinely threaten correctness in normal production flows.*

The red-team and hardening passes were re-validated. Specifically:

| Risk area | Why it is not Critical |
|-----------|------------------------|
| Stale bot actions during hand advance | `shouldApplyBotActionResult` + `canApplyNextHand` are centralized in `handLifecycleRules.ts` and covered by `handLifecycle.behaviorTests.ts` |
| Daily Fritz double submission | `completeKeyRef`, `submitSucceededRef`, and `autoSubmitBlockedRef` dedupe in `useDailyFritzCompletion.ts` |
| Duplicate match state authority | Single `MatchSessionStore` via `useMatchRuntimeBridge`; `matchRef` kept in sync |
| Engine rule drift | `engineParity.behaviorTests.ts`, `botEngine.test.ts` (20 tests), tier/honesty behavior suites |

**Closest to Critical (downgraded to High-value):** async completion effects without unmount guards (see B.1). These can produce React warnings or rare state updates after navigation — not demonstrated data corruption or double-rating in code review.

---

## B. High-Value Improvements

Improvements with clear engineering ROI. Each includes problem, bug prevented, why current design is insufficient, cost, and benefit.

### B.1 — Async completion effects need cancellation guards

| Field | Detail |
|-------|--------|
| **Problem** | `useGhostMatchCompletion.ts` and `useDailyFritzCompletion.ts` fire `void completeGhostGame(...)` / `void (async () => { ... completeDailyFritz })` inside `useEffect` with **no cleanup** and no `cancelled` flag |
| **Bug prevented** | setState-after-unmount; profile patch / ghost result applied after user left match; duplicate loading spinner state on StrictMode re-run edge cases |
| **Why insufficient** | `useGhostMatchSessionStart.ts` already uses the correct `let cancelled = false` + cleanup pattern — completion hooks do not |
| **Cost** | 2–4 hours |
| **Benefit** | Eliminates a class of production console noise and rare race bugs; aligns with React StrictMode (enabled in `main.tsx`) |

**Contrast:** `useGhostRuntime.ts` clears its display timer correctly (`return () => window.clearTimeout(timer)`).

---

### B.2 — CI: enforce `modules/*` must not import `bot/*`

| Field | Detail |
|-------|--------|
| **Problem** | Bot Match dependency law (`modules ↛ bot`) is documented but **not** in `dependency-cruiser.json` |
| **Bug prevented** | Architectural regression reintroducing inverted dependencies (the primary failure mode of Phases 1–10) |
| **Why insufficient** | Manual review and grep do not scale with team size |
| **Cost** | ~1 hour to add forbidden rule + fail CI |
| **Benefit** | Permanent guardrail; zero ongoing review tax |

**Suggested rule:**

```json
{
  "name": "no-modules-from-bot",
  "severity": "error",
  "from": { "path": "^src/modules/" },
  "to": { "path": "^src/bot/" }
}
```

---

### B.3 — CI: circular dependency detection for `modules/`

| Field | Detail |
|-------|--------|
| **Problem** | `check:deps` runs but has no circular-dependency rule for the match module tree |
| **Bug prevented** | Subtle import cycles causing undefined exports, duplicate module evaluation, or test flakiness |
| **Why insufficient** | match↔daily coupling is intentional but acyclic today; nothing prevents a future cycle |
| **Cost** | ~1–2 hours (`dependency-cruiser` `no-circular` option scoped to `src/modules`) |
| **Benefit** | Catches regressions at PR time |

---

### B.4 — Vitest architecture test: import boundary smoke test

| Field | Detail |
|-------|--------|
| **Problem** | No automated test asserts module boundary contracts |
| **Bug prevented** | Same as B.2/B.3 — inverted imports, accidental `bot/` reach-through in runtime |
| **Why insufficient** | depcruise alone may not be run locally; a vitest test fails in `npm test` which every dev runs |
| **Cost** | ~2 hours (small test file scanning import graph or running depcruise as subprocess) |
| **Benefit** | Fails in the same command as unit tests; improves discoverability |

---

### B.5 — Align view-model types with contract facades

| Field | Detail |
|-------|--------|
| **Problem** | `bot/view-model/botMatchViewModelTypes.ts` imports `dailyFritz/api` and `ghost/api` directly; runtime uses `modules/daily/*Contracts` and `modules/ghost/*Contracts` |
| **Bug prevented** | Type drift when API shapes change in one path but not the other; compile passes but wrong assumptions in view projection |
| **Why insufficient** | Two integration surfaces for the same contracts |
| **Cost** | ~1 hour |
| **Benefit** | Single source of truth for cross-feature types in Bot Match |

---

### B.6 — Type post-game modal props from view-model sections

| Field | Detail |
|-------|--------|
| **Problem** | 18 `any` usages across 6 legacy modal/portal components (`BotGameOverModal`, `BotPostGameCard`, etc.) |
| **Bug prevented** | Silent prop shape regressions during post-game flow changes |
| **Why insufficient** | `botMatchViewModelTypes.ts` already defines strong nested view models; modals do not consume them |
| **Cost** | 1–2 days (touch 6 components + wire from `assembleBotMatchViewModel`) |
| **Benefit** | Compile-time protection on highest-value user-facing transition (game over) |

---

### B.7 — Expand E2E coverage for Daily Fritz in-match and Ghost mode entry

| Field | Detail |
|-------|--------|
| **Problem** | `e2e/match.spec.ts` covers Play vs Fritz lifecycle well; Daily Fritz **in-bot-match** and Ghost paths have smoke-level or no coverage |
| **Bug prevented** | Mode-specific regressions in hand advance, rating completion, ghost overlay — areas with the most integration complexity |
| **Why insufficient** | Unit tests do not mount the full controller chain |
| **Cost** | 1–2 days per mode (auth/fixture dependent) |
| **Benefit** | Catches integration regressions that unit tests cannot |

---

### B.8 — Tighten ESLint warning budget for `bot/` and `modules/`

| Field | Detail |
|-------|--------|
| **Problem** | `eslint --max-warnings 600` allows substantial lint debt |
| **Bug prevented** | Latent `exhaustive-deps` mistakes in match effects (13 `eslint-disable` instances in modules) |
| **Why insufficient** | Disables are intentional in places but not audited per-line in CI |
| **Cost** | Phase down warnings for match paths only: ~4–8 hours initial, then ratchet |
| **Benefit** | Prevents new effect-dependency bugs in turn orchestration |

---

## C. Low-Value Improvements

Optional or subjective. Do not prioritize unless touching adjacent code.

| ID | Item | Notes |
|----|------|-------|
| C-1 | Memoize `assembleBotMatchViewModel` | **Subjective** until profiling shows jank; 337 LOC object build is likely cheap vs. board render |
| C-2 | Collapse `match-turn-stack/` builder files | Refactor for LOC; 17 files aid port explicitness |
| C-3 | Migrate learn/devtools off `bot/` stubs (~40 sites) | Platform hygiene; not Bot Match correctness |
| C-4 | Animation timer unmount guards in `usePlayerDrawAnimation` / `usePlayerPlacementHandler` | Theoretical setState-after-unmount; low incidence |
| C-5 | Replace `PIVOTAL_REVIEW_WIZARD_ENABLED` dead paths | Product decision, not engineering |
| C-6 | Unify `MatchEventBus` as primary integration | Explicitly out of scope — no measurable bug today |
| C-7 | `computeNormalHandRows` in view on every render | Hand size ≤7; not a hotspot |
| C-8 | Add `readonly` to more view-model types | Marginal compile-time gain |
| C-9 | Property-based testing for `botEngine` | Nice-to-have; behavior tests already extensive |
| C-10 | Reduce `useHandLifecycle` LOC | Splitting is refactor theater unless a bug is found |

---

## D. CI Guardrails to Add

Concrete automated checks ranked by ROI. **No new architecture — enforcement only.**

| Priority | Guardrail | Tool | Implementation |
|----------|-----------|------|----------------|
| P0 | `modules/` cannot import `bot/` | dependency-cruiser | Add `no-modules-from-bot` forbidden rule |
| P0 | No circular deps in `src/modules` | dependency-cruiser | `forbidden` or `options.report.cyclic` |
| P1 | Vitest architecture boundary test | vitest | `src/modules/architecture.boundary.test.ts` |
| P1 | `bot/` stubs must re-export only (no logic) | custom script or eslint | Fail if stub file > N lines or contains functions |
| P2 | Orphan `bot/*.ts` stub detection | script in CI | grep importers; fail on zero-reference stubs |
| P2 | Ratchet ESLint warnings for `src/modules/**` | eslint | `--max-warnings` per-path override, decrease quarterly |
| P3 | Dead export check for `modules/*/index.ts` | knip or ts-prune | Optional; catches barrel drift |
| P3 | Duplicate `botEngine` implementation detection | script | Fail if `createBotMatch` defined outside `modules/match/runtime/botEngine.ts` |

**Already in CI (praise):** typecheck (`strict: true`), lint, `check:deps`, vitest coverage, behavior tests (`run-behavior-tests.mjs`), Playwright e2e, build, bundle size check.

**CI gap:** `test:all` runs vitest twice (via `test:coverage` then `test:all` → vitest again). Low-cost fix: `test:all` could skip vitest if coverage step ran. **Cosmetic CI efficiency**, not correctness.

---

## E. Production Readiness

### Verdict: **Yes — ready for production**

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Build | ✅ | `tsc -b && vite build` passes |
| Strict TypeScript | ✅ | `strict`, `noUnusedLocals`, `noUnusedParameters` in `tsconfig.app.json` |
| Unit tests | ✅ | 347 vitest tests; 16 under `modules/` |
| Behavior / parity tests | ✅ | Engine parity, hand lifecycle, tier, honesty, fixed starter |
| E2E smoke | ✅ | Play vs Fritz lifecycle in `e2e/match.spec.ts` |
| Error reporting | ✅ | Sentry in production (`main.tsx`, 10% trace sample) |
| Debug diagnostics | ✅ | `fairnessLog`, `botMatchDebugLog`, `traceDailyFritzEvent` — env-gated |
| Architecture | ✅ | 8 LOC composition root; single engine authority |
| CI pipeline | ✅ | `.github/workflows/client-ci.yml` on PR |

**Caveats (non-blocking):**

1. Async completion cleanup (B.1) — fix on next touch of ghost/daily completion
2. Modal `any` types (B.6) — compile-time gap, not runtime failure
3. Architectural rules not fully automated (D) — team-scale risk, not solo-ship risk

---

## F. World-Class Engineering Score

Scores reflect Bot Match specifically, not the entire Racehorse client.

| Area | Score | Rationale |
|------|-------|-----------|
| **Architecture** | **8.5** | Genuine composition root; clear module ownership; bounded cross-feature facades; no god screen |
| **Maintainability** | **7.5** | `modules/` tree is navigable; large orchestration hooks are delegated; modal typing debt; dual stub entry points |
| **Correctness** | **7.5** | Strong engine guards and tests; async effect gaps; StrictMode on |
| **Testing** | **8.0** | Engine parity + behavior suites are elite for indie/small studio; limited integration/e2e depth for secondary modes |
| **Performance** | **7.5** | No proven hotspots; unmemoized view-model assembly unprofiled; hand sizes small |
| **Type Safety** | **7.0** | Strict TS project-wide; 18 `any` in legacy modals; 1 `as any` in engine test |
| **Developer Experience** | **7.5** | Good docs (`bot-match-architecture.md`); `match-turn-stack/` navigation cost; stubs vs modules confusion for newcomers |
| **Observability** | **7.0** | Sentry prod; rich dev-only fairness/debug logs; limited structured telemetry in match runtime itself |
| **Tooling** | **7.0** | Solid CI; depcruise partial; eslint warning budget loose (600) |
| **Long-term Scalability** | **8.0** | Parallel ownership per module is viable; match↔daily coupling is the main merge-conflict surface |

### Overall Engineering Maturity: **7.6 / 10**

**Interpretation:** Strong production-grade client engineering — above typical indie/small-team bar, not yet at exemplary AAA live-ops standard. Gap is primarily **automation and hygiene**, not architecture.

---

## G. $100M+ Studio Internal Review Simulation

> *If this repository were submitted for internal review at a $100M+ game studio, what would senior engineers praise, criticize, and ask to improve before calling it exemplary?*

### They would praise

1. **Real decomposition, not cosmetic.** An 8-line composition root and 170-line controller that wires subsystems without owning rules — rare in game clients.
2. **Engine test discipline.** `engineParity.behaviorTests.ts`, tier/honesty suites, and 20 unit tests on `botEngine` show Fritz is treated as a **product surface**, not a black box.
3. **Hand lifecycle centralization.** `shouldApplyBotActionResult` / `canApplyNextHand` as shared rules with behavior tests — correct pattern for race-prone turn games.
4. **CI that actually runs.** Typecheck, lint, depcruise, vitest, behavior tests, Playwright, and build on PR — many studios stop at typecheck + build.
5. **Strict TypeScript with unused symbol checks.** Harder than industry average.
6. **Replay ownership.** `ReplayRecorder` as a small owned class with tests — clean move-log authority.
7. **Debug/fairness instrumentation.** Env-gated `fairnessLog` and match debug trails support live calibration — aligns with trust-sensitive AI product.

### They would criticize

1. **Architecture rules live in markdown, not CI.** A senior engineer would ask: *"What stops the next PR from importing `bot/botEngine` inside `modules/match`?"* Answer today: code review.
2. **Async effects inconsistent.** Session start has cancellation; completion does not. *"StrictMode is on — why don't all effects follow the same contract?"*
3. **Post-game UI typed with `any`.** *"The view-model is strongly typed; the modals aren't. That's where players see bugs."*
4. **ESLint allows 600 warnings.** *"Effect dependency suppressions in turn orchestration should be rare and audited."*
5. **E2E depth vs. mode complexity.** Play vs Fritz is covered; Daily Fritz in-match hand advance and Ghost rating paths are undertested relative to their integration surface.
6. **Observability is dev-console heavy.** Production has Sentry, but match runtime lacks structured event hooks for hand-advance failures, rating completion errors, or prefetch timeouts — operations would want dashboards.

### They would ask improved before calling it exemplary

| Ask | Effort | Blocking exemplary? |
|-----|--------|---------------------|
| Add depcruiser `modules ↛ bot` + circular rules to CI | 1–2 hours | Yes — table stakes for team scale |
| Cancellation guards on ghost/daily completion effects | 2–4 hours | Yes — StrictMode hygiene |
| Type game-over modals from view-model | 1–2 days | Yes — ship-confidence on money path |
| One integration test for `useMatchTurnStack` happy path (mocked ports) | 1 day | Recommended |
| Ratchet ESLint warnings on `modules/` | 4–8 hours | Recommended |
| Structured telemetry for hand-advance failure + rating completion | 2–3 days | Recommended for live ops |

**They would not ask for:** another architecture phase, event bus unification, file splits, or package extraction — unless product scope changes.

---

## H. Audit Category Notes

### 1. Correctness (detailed)

| Finding | Severity | Worth fixing? |
|---------|----------|---------------|
| Ghost/daily async completion no cleanup | High (B.1) | Yes |
| `useGhostMatchSessionStart` cancelled flag | ✅ Good pattern | — |
| `shouldApplyBotActionResult` stale bot guard | ✅ Tested | — |
| Player animation `setTimeout` without cleanup | Low (C-4) | If warnings appear |
| `matchRef.current` read in async bot turn | ✅ Guarded by `shouldApplyBotActionResult` | — |
| Daily Fritz dedup refs | ✅ Adequate | — |

### 2. Type Safety

- **Runtime modules:** essentially `any`-free (1 test fixture `as any`)
- **View modals:** 18 `any` — high-value fix (B.6)
- **View-model → feature API bypass** — consistency fix (B.5)
- No recommendation for speculative discriminated unions — existing types are adequate where used

### 3. Architectural Enforcement

- Documented ✅ | Automated ❌ (for Bot Match-specific rules)
- See Section D

### 4. Testing

| Strength | Gap |
|----------|-----|
| Engine parity, tier, honesty, hand lifecycle behavior tests | No `useMatchTurnStack` integration test |
| 16 module unit tests | Ghost/daily completion hooks untested |
| Playwright PvF lifecycle | Daily Fritz in-match, Ghost e2e shallow |
| AI determinism via seeded PRNG in heuristics + parity tests | No property-based fuzzing (optional) |
| Replay recorder unit test | No full match replay e2e |

**High-value test addition:** one integration test asserting player pass → bot turn → hand over does not double-apply (uses real `handLifecycleRules`). Cost ~1 day.

### 5. Performance

- **No evidence** of user-visible jank from view-model assembly
- Board/tile rendering dominates; not audited here
- **Do not memoize preemptively** (C-1)
- `ReplayRecorder.recordMove` clones array (`[...this.moveLog, entry]`) — O(n) per move; acceptable for match length (<200 moves typical)

### 6. Developer Experience

| Good | Friction |
|------|----------|
| `docs/architecture/bot-match-architecture.md` | `bot/` stubs vs `modules/` dual entry |
| Module index exports | 17-file `match-turn-stack/` navigation |
| Consistent `use*Runtime` naming | `eslint-disable` without per-line justification comments |

### 7. Runtime Diagnostics

| Capability | Status |
|------------|--------|
| Dev fairness replay log | ✅ `fairnessLog` |
| Match debug | ✅ `botMatchDebugLog` + localStorage flags |
| Daily Fritz trace | ✅ `traceDailyFritzEvent` |
| Hand lifecycle debug snapshot | ✅ `HandLifecycleDebugSnapshot` in debug overlay |
| Production errors | ✅ Sentry |
| Structured prod telemetry for match events | ❌ Gap for live ops |
| Feature flags | `PIVOTAL_REVIEW_WIZARD_ENABLED` hardcoded `false` — acceptable |

### 8. Build & CI

See Section D. Current pipeline is strong; Bot Match-specific boundaries are the main addition.

---

## Final Statement

**Bot Match architecture is complete.**

Future engineering effort should prioritize:

1. **CI guardrails** (B.2, B.3, D) — highest ROI
2. **Async effect hygiene** (B.1) — correctness hardening
3. **Post-game typing** (B.6) — when touching modals
4. **Product features** — new modes, Fritz tuning, UX

**No further architecture phases are recommended.** Objective evidence does not support them.

---

## Related Documents

- [bot-match-architecture.md](./bot-match-architecture.md)
- [phase-11-bot-match-hardening-report.md](./phase-11-bot-match-hardening-report.md)
- [bot-match-final-verification-audit.md](./bot-match-final-verification-audit.md)