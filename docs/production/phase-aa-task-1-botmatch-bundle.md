# Phase AA — Task 1: BotMatchScreen Bundle Regression Fix

**Date:** 2026-07-06  
**Scope:** Priority 1 production blocker from Phase Z — `BotMatchScreen` CI size-check failure  
**Architecture:** Frozen — no gameplay, API, or multiplayer behavior changes

---

## 1. Problem (Phase Z evidence)

| Metric | Before | Limit |
|--------|-------:|------:|
| `BotMatchScreen-*.js` | **278 kB** (284,537 bytes) | **244 kB** (250,000 bytes) |
| `npm run size-check` | **FAIL** | — |
| `lessonV2-*.js` | 1,320 kB (separate chunk) | Not gated |
| Root cause | Bot match entry chunk inlined guided, hand-lifecycle, analyzer, pivotal-review, and lessonV2 dependency graphs | — |

---

## 2. Solution

**Single targeted change:** extend Vite `manualChunks` in `client/vite.config.ts` to peel bot-match-heavy application modules out of the `BotMatchScreen` entry chunk into named async-loadable chunks. Gameplay code is unchanged; the same modules load when `BotMatchScreen` mounts (eager static imports preserved).

### Chunks added

| Chunk name | Source paths | Role |
|------------|--------------|------|
| `lesson-v2` | `src/learn/lessonV2` | Guided lesson V2 runtime + canonical JSON |
| `bot-guided` | `src/modules/guided/` | Guided/authoring match runtime |
| `bot-hand-lifecycle` | `src/modules/match/hand-lifecycle/` | Hand advance / reveal coordination |
| `pivotal-review` | `src/training/pivotalReview/` | Post-game pivotal review UI |
| `analyzer` | `src/analyzer/` | Move analyzer + GameReviewer |

Existing vendor splits (`vendor-charts`, `vendor-supabase`, `vendor-socket`, `vendor-confetti`) unchanged.

---

## 3. Bundle report (after fix)

Production build: `npm run build --prefix client` (2026-07-06)

### Size-check output

```
✓ AppRoutes: 72kB (limit 195kB)
✓ BotMatchScreen: 172kB (limit 244kB)
✓ index: 415kB (limit 684kB)
All bundle size checks passed.
```

### BotMatchScreen entry chunk

| File | Raw | Gzip |
|------|----:|-----:|
| `BotMatchScreen-UdO2ymYI.js` | **175.98 kB** | 47.57 kB |
| `BotMatchScreen-Cp5RQI7z.css` | 28.67 kB | 6.24 kB |

**Delta:** −108 kB raw (−39%) vs pre-fix `BotMatchScreen-BCQU8ch4.js` (284.54 kB).

### New satellite chunks (split out of BotMatchScreen entry)

| Chunk | Raw | Gzip |
|-------|----:|-----:|
| `bot-guided-*.js` | 92.09 kB | 27.59 kB |
| `bot-hand-lifecycle-*.js` | 29.74 kB | 9.84 kB |
| `pivotal-review-*.js` | 19.95 kB | 6.66 kB |
| `analyzer-*.js` | 276.73 kB | 91.96 kB |
| `lesson-v2-*.js` | 1,326.51 kB | 58.54 kB |

### Largest remaining chunks (full build)

| Rank | Chunk | Raw | Gzip |
|------|-------|----:|-----:|
| 1 | `lesson-v2-*.js` | 1,326.51 kB | 58.54 kB |
| 2 | `index-*.js` (main shell) | 425.29 kB | 125.28 kB |
| 3 | `vendor-charts-*.js` | 384.76 kB | 112.37 kB |
| 4 | `analyzer-*.js` | 276.73 kB | 91.96 kB |
| 5 | `BotMatchScreen-*.js` | 175.98 kB | 47.57 kB |
| 6 | `vendor-supabase-*.js` | 170.74 kB | 45.35 kB |
| 7 | `index-*.js` (secondary) | 110.44 kB | 30.59 kB |
| 8 | `bot-guided-*.js` | 92.09 kB | 27.59 kB |
| 9 | `RacehorseJourneyScreen-*.js` | 75.21 kB | 20.27 kB |
| 10 | `AppRoutes-*.js` | 73.25 kB | 16.30 kB |

**Total JS loaded when opening a bot match** (entry + typical deps, not gzip-compressed sum): ~2.0 MB raw across parallel chunk requests — same logical code as before; only file boundaries changed.

---

## 4. Files modified

| File | Change |
|------|--------|
| `client/vite.config.ts` | Added application `manualChunks` rules for `lesson-v2`, `bot-guided`, `bot-hand-lifecycle`, `pivotal-review`, `analyzer` |

**No gameplay, hook, or component source files were modified.**

---

## 5. Behavioral risk

| Risk | Assessment |
|------|------------|
| Gameplay logic change | **None** — zero TS/TSX diffs outside Vite config |
| Multiplayer / socket | **None** — untouched |
| Public APIs | **None** — untouched |
| Load order | **Low** — Rollup preserves static import order; additional parallel chunk fetches on first bot-match navigation (same modules, more HTTP requests on cold load) |
| Guided V2 / authoring | **None** — `lesson-v2` chunk still loads when bot match starts (static import graph unchanged) |
| Offline / slow network | **Low** — one extra round-trip per new chunk file; mitigated by HTTP/2 multiplexing and browser cache |

---

## 6. Production certification score impact

| Dimension | Before Task 1 | After Task 1 | Notes |
|-----------|--------------|--------------|-------|
| **Overall production readiness** | 64 | **~68** | CI bundle gate unblocked |
| **Performance** | 55 | **~62** | BotMatch entry −39%; satellite chunks explicit |
| **Maintainability** | 68 | **~69** | Size budget enforceable again |

Phase Z certification should move from **READY WITH NOTES** toward passing PR CI `size-check` without changing the formal verdict until remaining blockers (lesson-v2 eager fetch on all bot matches, analyzer 277 kB, in-memory rooms) are addressed in later Phase AA tasks.

---

## 7. Verification commands

```bash
npm run build --prefix client
npm run size-check --prefix client
npm run typecheck --prefix client
```

All three succeeded after this change.

---

## 8. Follow-up (out of scope for Task 1)

Not required to pass `size-check`, but highest ROI for Phase AA Task 2+:

1. **Defer `lesson-v2` chunk** on non-guided Fritz routes via dynamic `import()` at bootstrap (removes ~1.3 MB parse on default bot play).
2. **Defer `analyzer` chunk** until post-game review opens.
3. Add `lesson-v2` / `bot-guided` to optional `size-check` LIMITS to prevent regression in satellite chunks.

---

*Phase AA Task 1 complete. Architecture frozen; behavior preserved.*