# Codebase Health — Context Dump

**Last updated:** June 2026  
**Scope:** `client/` (Racehorse Dominoes web app)  
**Purpose:** Single reference for current health scores, completed sprint work, remaining path to 9/10, and how to run all quality gates locally.

See also: [docs/architecture/ARCHITECTURE_OVERVIEW.md](./architecture/ARCHITECTURE_OVERVIEW.md) and ADR-001 through ADR-005 in `docs/architecture/`.

---

## Current health scores (June 2026)

| Category | Score | Notes |
|----------|-------|-------|
| Error handling | 8 | ErrorBoundary at root/route/component; Sentry + `logger.error` in production |
| Code organization | 7 | Key extractions done; `BotMatchScreen` still monolithic |
| Type safety | 8 | `strict: true`, `noUnusedLocals: true`, 0 typecheck errors |
| API consistency | 6 | Shared `api/client.ts` exists; not all fetch paths migrated |
| CSS consistency | 5 | `rh-*` + frozen `wl-*`; 23 grandfathered legacy CSS files |
| Dead code | 8 | `walnut-live.css` deletion deferred (cascade risk) |
| Test coverage | 7 | Vitest: 73 tests; coverage floors locked; branch coverage low |
| Duplication | 7 | Helpers extracted; mode logic still duplicated in bot shell |
| File size/complexity | 5 | `BotMatchScreen.tsx` ~7,171 lines; largest complexity risk |
| **Overall** | **7** | Solid foundation; complexity + CSS/API debt block 9/10 |

---

## What was completed this session (Sprints 1–7)

### Sprint 1 — Tooling enforcement
- **ESLint** (`client/.eslintrc.json`): TypeScript project linting, react-hooks as warnings, `--max-warnings 600`, ignores `*.behaviorTests.ts` and `src/devtools/**`
- **stylelint** (`client/.stylelintrc.json`): invalid hex + duplicate properties; baseline clean
- **TypeScript** (`tsconfig.app.json`): `noUnusedLocals: true`, `typecheck` script; fixed unused import/local errors
- **CI** (`.github/workflows/client-ci.yml`): typecheck, lint, lint:css, test, build pipeline

### Sprint 2 — Module extractions
- **Daily Puzzle:** preamble extracted to `DailyPuzzleLoadingScreen.tsx`, `dailyPuzzleScreenHelpers.ts`, `dailyPuzzleScreenTypes.ts`
- **Live match session:** types → `liveMatchSessionTypes.ts`; board utils → `boardSessionUtils.ts`; `useLiveMatchSession.ts` slimmed

### Sprint 3 — Walnut-live CSS freeze (deletion skipped)
- **Audit:** `walnut-live.css` has deep CSS cross-dependencies across 22+ files; blind deletion is high risk
- **Decision:** Skip deletion; freeze new `wl-*` introductions via stylelint
- **stylelint guard:** `selector-class-pattern` blocks `wl-*` in all CSS except 23 grandfathered files (see below)
- **Cascade audit:** documented which `wl-*` selectors each legacy file still references

### Sprint 4 — Vitest harness
- Installed Vitest, Testing Library, jsdom, coverage-v8
- `vite.config.ts` test block; `src/test/setup.ts`
- Scripts: `test`, `test:watch`, `test:coverage`, `test:all`
- First smoke test: `tileUtils.test.ts` (4 tests)

### Sprint 5 — Vitest expansion + coverage floors
- Added tests: `client.test.ts`, `multiplayerRuntime.test.ts`, `mutePreference.test.ts`, `dailyFritzScreenHelpers.test.ts`, `dailyPuzzleScreenHelpers.test.ts`, `boardSessionUtils.test.ts`, `ErrorBoundary.test.tsx`
- **73 tests** across 8 files
- Coverage thresholds locked in `vite.config.ts` (see below)
- CI Test step runs `npm run test:coverage`

### Sprint 6 — Sentry + structured logger
- `@sentry/react` installed; init in `main.tsx` (prod-only when `VITE_SENTRY_DSN` set)
- `src/utils/logger.ts`: `error` / `warn` / `info`
- Replaced production `console.error` in 11 files with `logger.error`
- `client/.env.example` documents `VITE_SENTRY_DSN`
- ADR-005 documents logger contract

### Sprint 7 — Architecture boundaries + documentation
- **dependency-cruiser** (`.dependency-cruiser.json`): 4 forbidden rules (api↔components, game↔react, devtools, test utils)
- `npm run check:deps` script; CI **Dependency boundaries** step
- ADR-001 through ADR-005 + `ARCHITECTURE_OVERVIEW.md` populated
- This document (`CODEBASE-HEALTH.md`)

---

## What remains for 9/10

Target overall score **9** requires closing gaps in the lowest-scoring categories: **file size/complexity (5)**, **CSS consistency (5)**, **API consistency (6)**, and **branch coverage**.

### Sprint 3B — `wl-*` → `rh-*` migration (CSS consistency → 8+)
- Component-by-component migration with visual QA per screen
- Do **not** bulk-delete `walnut-live.css` until each consumer is migrated and compound selectors in grandfathered files are updated
- Ratchet stylelint grandfather list down as files are cleaned
- End state: delete `walnut-live.css` global import from `main.tsx`

### Sprint 5 (remaining) — Behavior test consolidation
- Existing `*.behaviorTests.ts` runners (ts-node/tsx) are **outside** Vitest and **outside** coverage
- Migrate high-value behavior tests into Vitest (`src/**/*.test.ts`) or wire a unified `test:all` that runs both suites in CI
- Priority targets: bot heuristics, analyzer, pre-game draw, recovery machine

### Branch coverage (test coverage → 8+)
- Current Vitest coverage is statement-heavy; **branches ~17–20%** on included files
- Add branch-targeted tests for: `api/client.ts` (401 refresh path), `normalizeSetResult`, `normalizeRoomPlayers` edge cases, `getBoardEnds` with populated boards
- Ratchet coverage floors each sprint (see below)

### API consistency (6 → 8+)
- Audit remaining direct `fetch` calls outside `api/client.ts`
- Migrate to `apiGet` / `apiPost` / `apiDelete`
- Align ADR-001 wording with actual `ApiResult<T>` shape (`{ data, error, status }` — not `{ ok, data, error }`)
- Extend `client.test.ts` for auth-header + 401 refresh paths

### BotMatchScreen decomposition (file size/complexity → 7+)
See dedicated section below — **not** a quick refactor; needs its own sprint with visual QA on all three render sites.

---

## Quality gates

All commands run from `client/` unless noted.

| Gate | Command | CI step | Pass criteria |
|------|---------|---------|---------------|
| TypeScript | `npm run typecheck` | Typecheck | 0 errors |
| ESLint | `npm run lint` | Lint | 0 errors, warnings ≤ ceiling |
| CSS lint | `npm run lint:css` | Lint CSS | 0 errors |
| Dependency boundaries | `npm run check:deps` | Dependency boundaries | 0 forbidden violations |
| Unit tests | `npm test` | (subset of Test) | All tests pass |
| Coverage + thresholds | `npm run test:coverage` | Test | All tests pass + floors met |
| Production build | `npm run build` | Build | `tsc -b && vite build` success |

### Full local pre-PR checklist

```bash
cd client
npm run typecheck
npm run lint
npm run lint:css
npm run check:deps
npm run test:coverage
npm run build
```

### CI workflow

File: `.github/workflows/client-ci.yml`  
Triggers: PRs touching `client/**`  
Steps (in order): Install → Typecheck → Lint → Lint CSS → Dependency boundaries → Test (`test:coverage`) → Build

### Legacy behavior tests (not in Vitest CI gate)

These still run via individual npm scripts and are excluded from Vitest coverage:

```bash
npm run test:bot
npm run test:analyzer
npm run test:hand-lifecycle
npm run test:pre-game-draw
npm run test:recovery-machine
# … see package.json for full list
```

---

## Ratchet targets (update each sprint)

### ESLint warning ceiling

| Setting | Value | Location |
|---------|-------|----------|
| Max warnings | **600** | `package.json` → `lint` script (`--max-warnings 600`) |
| Current warnings | **~489** (0 errors) | Run `npm run lint` |

**Policy:** Lower `--max-warnings` each sprint (e.g. 600 → 500 → 400) until warnings are near zero. `no-console` warns on `console.log` / `console.info` in production code — use `logger.warn` / `logger.info` in dev-only paths.

### Vitest coverage floors

Locked in `client/vite.config.ts` → `test.coverage.thresholds`:

| Metric | Floor | Last measured (approx.) |
|--------|-------|-------------------------|
| Statements | **35%** | ~36–37% |
| Branches | **17%** | ~19–20% |
| Functions | **50%** | ~53% |
| Lines | **38%** | ~40% |

**Policy:** After each sprint that adds tests, bump floors to ~2% below current totals so CI prevents regression. Branch floor should rise fastest (currently the weakest metric).

Coverage excludes: `src/devtools/**`, `src/test/**`, `**/*.behaviorTests.ts`

---

## CSS: 23 grandfathered `wl-*` files

New `wl-*` selectors are **blocked** by stylelint in all CSS files **except** this list (second override block in `client/.stylelintrc.json` sets `selector-class-pattern: null`):

| # | Glob in stylelintrc | Typical path |
|---|---------------------|--------------|
| 1 | `**/walnut-live.css` | `src/styles/walnut-live.css` |
| 2 | `**/App.css` | `src/App.css` |
| 3 | `**/botMatch.css` | `src/bot/botMatch.css` |
| 4 | `**/match-score-header.css` | `src/components/match-score-header.css` |
| 5 | `**/dailyFritzMatchBoard.css` | `src/dailyFritz/dailyFritzMatchBoard.css` |
| 6 | `**/dailyPuzzle.css` | `src/dailyPuzzle/dailyPuzzle.css` |
| 7 | `**/learn.css` | `src/learn/learn.css` |
| 8 | `**/learnGuidedMatch.css` | `src/learn/learnGuidedMatch.css` |
| 9 | `**/learnPlayer.css` | `src/learn/learnPlayer.css` |
| 10 | `**/coach.css` | `src/learning/coach.css` |
| 11 | `**/match-live-solo.css` | `src/match/match-live-solo.css` |
| 12 | `**/match-live-surface.css` | `src/match/match-live-surface.css` |
| 13 | `**/match-live-theme.css` | `src/match/match-live-theme.css` |
| 14 | `**/noBrainerLab.css` | `src/practice/noBrainerLab.css` |
| 15 | `**/board-hand-dock.css` | `src/styles/board/board-hand-dock.css` |
| 16 | `**/board-hud.css` | `src/styles/board/board-hud.css` |
| 17 | `**/board-shell.css` | `src/styles/board/board-shell.css` |
| 18 | `**/racehorse-matte.css` | `src/styles/board/skins/racehorse-matte.css` |
| 19 | `**/game-interactions.css` | `src/styles/game-interactions.css` |
| 20 | `**/match-board-architecture.css` | `src/styles/match-board-architecture.css` |
| 21 | `**/match-hud-polish.css` | `src/styles/match-hud-polish.css` |
| 22 | `**/match-standard-live-board.css` | `src/styles/match-standard-live-board.css` |
| 23 | `**/shared-ui.css` | `src/styles/shared-ui.css` |
| 24 | `**/tournamentMatchHud.css` | `src/tournament/tournamentMatchHud.css` |

Note: stylelintrc lists **24 globs** (walnut-live + 23 legacy files). ADR-003 rounds to “23 legacy files” excluding `walnut-live.css` itself.

**Any new CSS file** not on this list cannot introduce `wl-*` classes. New work uses `rh-*` and `tokens.css`.

---

## BotMatchScreen — complexity hotspot

| Metric | Value |
|--------|-------|
| File | `client/src/bot/BotMatchScreen.tsx` |
| Lines | **~7,171** (session audit: ~7,190) |
| Mode-branch occurrences | **~267** (mode props, `isDailyFritz*`, ghost/guided/journey branches) |
| Render sites | **3** |

### Three render sites (same component, different product modes)

1. **Play vs Fritz / Learn / Journey** — `AppRoutes.tsx` when `appMode === 'bot'`  
   Props: deal size, Fritz tier, guided/authoring flags, journey trial, Glicko profile, etc.

2. **Ghost replay** — `AppRoutes.tsx` when `appMode === 'ghost'`  
   Props: `mode="ghost"`, ghost profile, opponent identity

3. **Daily Fritz** — `DailyFritzScreen.tsx` (lazy `BotMatchScreen`)  
   Props: Daily Fritz set lifecycle, scripted draw, set result overlays

### Why it has not been split yet

- Single component encodes Fritz, Ghost, Daily Fritz, Guided/Learn, Journey trial, and authoring capture
- Mode conditionals touch render, hooks, hand lifecycle, rating POST, and board chrome
- CSS still depends on `wl-*` / `bot-match-screen` classes tied to this shell
- Any decomposition requires **route-level wrappers** (thin entry components per mode) that share extracted hooks — not a blind file split

### Recommended path (dedicated sprint + visual QA)

1. Extract **mode-specific hooks** already started (`useMatchUiChrome`, `usePostGamePivotalReview`, `useAuthoringCapture`, `guidedBotMatchHelpers`, `botMatchGhostHelpers`, `botMatchDailyFritz`)
2. Introduce **route wrappers**: `FritzMatchScreen`, `GhostMatchScreen`, `DailyFritzMatchScreen` — each passes a narrow prop surface to a slimmer shared `MatchBoardShell`
3. Visual QA matrix: all 3 render sites × hand lifecycle × pre-game draw × game over / pivotal review
4. Only then reduce `BotMatchScreen.tsx` to orchestration or delete it in favor of wrappers

**Do not** attempt drive-by extractions without the QA matrix — regressions surface in Daily Fritz set transitions and ghost rating flows first.

---

## Key foundation files (line counts)

| File | Lines | Role |
|------|-------|------|
| `src/api/client.ts` | 180 | Shared HTTP + auth + 401 refresh |
| `src/auth/useAuthSession.ts` | 93 | Supabase session |
| `src/multiplayer/multiplayerRuntime.ts` | 402 | `RoomPlayer`, `normalizeRoomPlayers` |
| `src/components/ErrorBoundary.tsx` | 47 | Render error containment |
| `src/utils/mutePreference.ts` | 12 | localStorage mute flag |
| `src/utils/logger.ts` | 14 | Console + Sentry |

---

## Quick reference — npm scripts

```json
"typecheck": "tsc -b --noEmit"
"lint": "eslint … --max-warnings 600"
"lint:css": "stylelint \"src/**/*.css\""
"check:deps": "depcruise src --config .dependency-cruiser.json"
"test": "vitest run"
"test:coverage": "vitest run --coverage"
"build": "tsc -b && vite build"
```

---

## Summary

The codebase moved from **ad hoc tooling** to **enforced gates** in one session: lint, types, tests, coverage floors, dependency boundaries, structured logging, and architecture ADRs. Overall health is **7/10**. The path to **9/10** is blocked primarily by **BotMatchScreen complexity**, **CSS dual-system debt (`wl-*`)**, **low branch coverage**, and **incomplete API client adoption** — each needs a dedicated sprint with explicit QA, not drive-by refactors.
