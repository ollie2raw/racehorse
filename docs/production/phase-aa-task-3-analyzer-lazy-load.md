# Phase AA — Task 3: Defer Analyzer Until Post-Game Review

**Date:** 2026-07-06  
**Scope:** Remove eager loading of the `analyzer` chunk (~277 kB pre-fix) from standard bot-match entry  
**Architecture:** Frozen — no gameplay, API, visual, or multiplayer behavior changes

---

## 1. Problem

After Task 2 removed eager `lessonV2` loading, bot-match entry still fetched a large **`analyzer-*.js` chunk (~277 kB raw)** during normal Fritz play. The analyzer is only needed for:

- Post-game review / pivotal review
- Move analysis (`GameReviewer`)
- Review tooling

Standard gameplay only needs lightweight **move-log recording** (`MoveEntry`, `toTileTuple`, board snapshots) — not move rating, consequence chains, or replay oracle analysis.

| Symptom | Evidence |
|--------|----------|
| `analyzer-*.js` ~277 kB | Static import in `BotMatchScreen`, `bot-guided`, `bot-hand-lifecycle` dependency graphs |
| Normal Fritz play | Parsed Fritz heuristics + bot engine + review UI bundled inside `analyzer` manual chunk |
| `moveLogger` under `/src/analyzer/` | Vite `manualChunks` rule swept all gameplay logging into `analyzer` |

---

## 2. Root cause

1. **`moveLogger.ts` lived under `/src/analyzer/`** — Vite grouped it into the `analyzer` chunk even though bot play uses it on every turn.
2. **`moveAnalyzer.ts` statically imported `botEngine` and `botHeuristics`** — Rollup co-located ~170 kB engine + ~24 kB heuristics inside `analyzer`, and re-exported shared symbols back to `bot-guided` / `bot-hand-lifecycle`.
3. **`GameReviewer.tsx` under `/src/analyzer/`** — Board/DominoTile shared with in-match board were hoisted into `analyzer`, forcing `BotMatchScreen` to import review UI graph at entry.
4. **Review hooks had static analyzer imports** — `usePostGamePivotalReview` and `GameReviewer` were in the eager bot-match graph (partially fixed in prior session work; completed here).

---

## 3. Solution (smallest safe change)

### A. Relocate gameplay move logging

- **Moved** `client/src/analyzer/moveLogger.ts` → `client/src/game/moveLogger.ts`
- **Updated** ~40 import sites from `analyzer/moveLogger` → `game/moveLogger`
- **Updated** analyzer internals to import from `../game/moveLogger`

Gameplay logging stays synchronous; analysis code no longer owns the type.

### B. Granular `manualChunks` boundaries

Extended `client/vite.config.ts` so shared play modules cannot be absorbed by `analyzer`:

| Chunk | Purpose |
|-------|---------|
| `move-logger` | `game/moveLogger` — in-play logging helpers |
| `bot-engine` | `modules/match/runtime/botEngine` |
| `bot-heuristics` | `modules/fritz/botHeuristics` |
| `fritz-config` | `modules/fritz/fritzConfig` |
| `game-reviewer` | `GameReviewer` + `reviewSidebarCopy` (lazy UI) |
| `analyzer` | `moveAnalyzer`, `consequenceChain`, `handSegmentation`, `analysisTypes` only |

### C. Lazy analysis boundaries (preserved / completed)

- **`usePostGamePivotalReview`** — `import('../../analyzer/moveAnalyzer.ts')` for `analyzeMoveLogDeferred` after `gameOver`
- **`BotMatchInGameOverlays`** — `React.lazy(() => import('GameReviewer'))` gated on `analyzerOpen`
- **`pivotalTurnSelector`** — type-only analyzer imports; caller supplies `analysis` (no sync `analyzeMoveLog` fallback)

---

## 4. Files changed

| File | Change |
|------|--------|
| `client/src/game/moveLogger.ts` | **New location** — moved from `analyzer/moveLogger.ts` |
| `client/src/analyzer/moveLogger.ts` | **Deleted** |
| `client/vite.config.ts` | Granular chunks: `move-logger`, `bot-engine`, `bot-heuristics`, `fritz-config`, `game-reviewer`, `analyzer` |
| `client/src/analyzer/moveAnalyzer.ts` | Import paths → `modules/fritz/*`, `modules/match/runtime/botEngine`, `game/moveLogger` |
| `client/src/analyzer/GameReviewer.tsx` | Import `moveLogger` from `game/moveLogger` |
| `client/src/analyzer/analysisTypes.ts` | Fix `fritzConfig` import path |
| `client/src/analyzer/*.ts` | `moveLogger` imports → `../game/moveLogger` |
| `client/src/modules/review/usePostGamePivotalReview.ts` | Dynamic `moveAnalyzer` import; type-only `GameAnalysis` |
| `client/src/training/pivotalReview/pivotalTurnSelector.ts` | Type-only analyzer imports; `analysis` required in options |
| `client/src/bot/view/overlays/BotMatchInGameOverlays.tsx` | Lazy `GameReviewer` behind `analyzerOpen` |
| `client/src/bot/view-model/botMatchViewModelTypes.ts` | Type-only `GameAnalysis`; `MoveEntry` from `game/moveLogger` |
| `client/src/training/pivotalReview/PivotalTurnReviewCard.tsx` | `sameTileTuple` from `game/moveLogger` |
| **~35 modules** (`bot-turn`, `player-turn`, `match/*`, `guided`, `daily`, `ghost`, `replay`, `multiplayer`, `match/session`) | `analyzer/moveLogger` → `game/moveLogger` |

---

## 5. Bundle report

Production build: `npm run build --prefix client` (2026-07-06)

### Size-check

```
✓ AppRoutes: 72kB (limit 195kB)
✓ BotMatchScreen: 167kB (limit 244kB)
✓ index: 416kB (limit 684kB)
All bundle size checks passed.
```

### Before vs after

| Chunk | Before (Task 3 start) | After Task 3 | Notes |
|-------|----------------------:|-------------:|-------|
| `analyzer-*.js` | **~277 kB** | **14 kB** | Engine/heuristics/logger/reviewer split out |
| `move-logger-*.js` | (inside analyzer) | **3.5 kB** | In-play logging — expected on bot path |
| `bot-engine-*.js` | (inside analyzer) | **170 kB** | Gameplay engine — expected on bot path |
| `bot-heuristics-*.js` | (inside analyzer) | **24 kB** | Fritz AI — expected on bot path |
| `game-reviewer-*.js` | (inside analyzer) | **64 kB** | Review UI shell; Board hoisted here |
| `fritz-config-*.js` | (inside analyzer) | **1 kB** | Tier metadata |
| `BotMatchScreen-*.js` | ~171 kB | **171 kB** | Unchanged budget |

**Net deferral from initial bot path:** ~**263 kB** of analysis-engine JavaScript no longer fetched at match entry.

### Static `analyzer` dependency (critical verification)

| Chunk | Static `import from './analyzer-*'` |
|-------|-------------------------------------|
| `BotMatchScreen-*.js` | **None** |
| `bot-guided-*.js` | **None** |
| `bot-hand-lifecycle-*.js` | **None** |
| `pivotal-review-*.js` | **None** |
| `game-reviewer-*.js` | **None** |

`BotMatchScreen-*.js` lists `analyzer-*.js` only in `__vite__mapDeps` (lazy preload metadata for dynamic imports).

---

## 6. Bot-match initial network requests

### Before Task 3 (standard Fritz)

Typical lazy route chain included:

- `BotMatchScreen-*.js`
- `bot-guided-*.js` → **statically pulled `analyzer-*.js` (~277 kB)**
- `bot-hand-lifecycle-*.js` → **statically pulled `analyzer-*.js`**
- `pivotal-review-*.js` → **statically pulled `analyzer-*.js`**
- `move-logger` symbols forwarded through `analyzer` chunk

### After Task 3 (standard Fritz)

Typical chain:

- `BotMatchScreen-*.js`
- `game-reviewer-*.js` (Board/DominoTile shared shell — **not** analysis engine)
- `bot-guided-*.js`, `bot-hand-lifecycle-*.js`
- `bot-engine-*.js`, `bot-heuristics-*.js`, `move-logger-*.js`, `fritz-config-*.js`
- `pivotal-review-*.js` (post-game UI shell)
- vendors, CSS

**`analyzer-*.js` is not statically requested on match entry.**

### When analysis loads

| Trigger | Chunks loaded |
|---------|---------------|
| Hand ends / game over (eligible review) | Dynamic `import('analyzer/moveAnalyzer')` → `analyzer` + deps |
| User opens Game Reviewer (`analyzerOpen`) | Lazy `GameReviewer` → `game-reviewer` (+ `analyzer` via mapDeps) |
| Pivotal review wizard | `pivotal-review` (no static `analyzer` import) |

---

## 7. Verification commands

| Command | Result |
|---------|--------|
| `npm run build --prefix client` | **Pass** |
| `npm run size-check --prefix client` | **Pass** |
| `npm run typecheck --prefix client` | **Pass** |
| `npm run test:bot-hooks --prefix client` | **Pass** (`usePostGamePivotalReview.behaviorTests` included) |

---

## 8. Behavioral risk assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Post-game analysis delayed until dynamic import resolves | Low | Existing pending UI (`postGameAnalysisPending`); unchanged semantics |
| Game Reviewer first open shows brief Suspense gap | Low | `fallback={null}`; chunk prefetched in mapDeps after game over |
| `moveLogger` path change breaks type imports | Low | Typecheck + behavior tests pass |
| Board hoisted into `game-reviewer` chunk (64 kB eager) | Info | Review UI shell, not analysis engine; follow-up could isolate `Board` |
| Circular chunk warning (`bot-guided ↔ bot-hand-lifecycle`) | Info | Pre-existing `manualChunks` interaction; no functional regression |
| Multiplayer `GameReviewer` still static in `MultiplayerGameShell` | Info | Out of bot-match scope; unchanged |

**Overall:** Low risk. Gameplay, scoring, bot engine, and post-game review behavior preserved. Largest win is removing ~263 kB analysis engine from default Fritz entry.

---

## 9. Production impact assessment

| Metric | Before | After |
|--------|--------|-------|
| Analyzer on standard bot entry | **~277 kB fetched/parsed** | **0 kB** (not in static graph) |
| Analyzer on post-game review | Already needed | **~14 kB** engine chunk + shared deps on demand |
| BotMatchScreen CI budget | 167 kB / 244 kB | **Unchanged — pass** |
| Initial Fritz time-to-interactive (JS) | Penalized by analysis + engine duplication | **~263 kB less analysis JS** on cold bot entry |
| Post-game review fidelity | Full `analyzeMoveLogDeferred` | **Unchanged** — same API, deferred load |

**Cumulative Phase AA (Tasks 1–3):** BotMatch entry no longer pulls `lesson-v2` (~1.3 MB) on standard play (Task 2) and no longer pulls the analysis engine (~277 kB → deferred) on standard play (Task 3).

---

## 10. Remaining follow-ups (out of scope)

- Isolate `Board`/`DominoTile` from `game-reviewer` chunk to avoid 64 kB review-shell eager load on every bot match.
- Lazy-load `BotPivotalReviewPortal` / `BotReviewSummaryPortal` to defer `pivotal-review` until post-game overlays show.
- Multiplayer `GameReviewer` static import in `MultiplayerGameShell` — separate lazy boundary.
- Optional Playwright network assertion: standard Fritz route does not request `analyzer-*.js` before `gameOver`.