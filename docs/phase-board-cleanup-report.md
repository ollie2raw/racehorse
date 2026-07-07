# Phase: Board.tsx Debug Instrumentation Cleanup Report

**Date:** 2026-07-05  
**Task:** Remove/isolate debug `console.log` and layout-debug instrumentation from `client/src/components/Board.tsx` without forced structural decomposition.

---

## 1. Step 0 — Scope Check

### 1.1 Full console/debug inventory (before cleanup)

Grep of `git show HEAD:client/src/components/Board.tsx` for `console.` / `debugger`:

| Line | Statement | Category | Fires when | Gating (before) |
|------|-----------|----------|------------|-----------------|
| 44 | `console.log(tag, entry)` inside `traceDailyFritzBoardEvent` | Daily Fritz trace | Every call when `profileDailyFritz` paths invoke helper | **None** — always logged in production |
| 61 | `console.log(tag, { ...payload, timestamp })` inside `traceCameraDebug` | Camera debug | Camera/layout/zoom events when helper called | **localStorage** `BOARD_CAMERA_DEBUG === '1'` |
| 676 | `console.log('[layout-debug]', entry)` inside `logLayoutDebug` callback | Layout-debug (Daily Fritz profile) | `profileDailyFritz` + layout recompute | **None** — always logged when profiling prop on |
| 1092 | `console.log('[board-zone-click]', { position, selectedTile, hasOnPositionClick, pointerTargetInfo })` | Placement-zone click trace | Every placement-zone click | **None** |
| 1115 | `console.log('[board-zone-blocked] reason = missing-onPositionClick')` | Placement-zone click trace | Click when `onPositionClick` not a function | **None** |
| 1118 | `console.log('[board-zone-forward]', { position })` | Placement-zone click trace | Click immediately before `onPositionClick` | **None** |

No `console.warn`, `console.debug`, or `debugger` statements were present.

**Related non-console debug (unchanged):**

| Mechanism | Location (before) | Purpose | Gating |
|-----------|-------------------|---------|--------|
| `window.__dailyFritzInteractionTrace` bucket | `traceDailyFritzBoardEvent` L36–42 | Profiling/diagnostics export | Populated on trace calls; no console required |
| `window.__dailyFritzLayoutDebug` bucket | `logLayoutDebug` L668–675 | Layout sample collection | Populated when `profileDailyFritz` |
| `recordDailyFritzBoardMetric` | L64–88 | Silent render/layout timing metrics | `window.__dailyFritzProfileActive` |
| `showTargetDebug` visual overlay | L598–599, L1126–1130 | Placement zone lane/dir labels in DOM | **localStorage** `BOARD_TARGET_DEBUG === '1'` |
| `useRenderProfiler('Board')` | L585 | Dev render profiler | `import.meta.env.DEV` (via `renderProfiler.ts`) |

### 1.2 Category breakdown (actual contents)

| Category | Items | Notes |
|----------|-------|-------|
| **Daily Fritz trace** | `traceDailyFritzBoardEvent` console + bucket; `recordDailyFritzBoardMetric`; `logLayoutDebug` bucket+console; effect at L719–725; placement click trace at L1109–1112 | Driven by `profileDailyFritz` prop from `BotMatchBoardStage` |
| **Layout-debug** | `logLayoutDebug` callback `[layout-debug]` console | Overlaps Daily Fritz profiling path; separate from `client/src/match/layoutDebug.ts` (hand/flying-tile shell metrics) |
| **Camera debug** | `traceCameraDebug` at computeLayout, setCamera, wheel, drag, zoom buttons | Opt-in localStorage flag — intentional troubleshooting |
| **Placement-zone click trace** | `[board-zone-click]`, `[board-zone-blocked]`, `[board-zone-forward]` | General input debugging, not Daily-Fritz-specific |

### 1.3 Load-bearing vs cruft + codebase convention

**Load-bearing (preserve behavior):**

- `traceCameraDebug` — already opt-in via `BOARD_CAMERA_DEBUG` localStorage (production-safe).
- `recordDailyFritzBoardMetric` — silent; no console; gated by `__dailyFritzProfileActive` (wired from `useBotMatchWindowEvents.ts`).
- Window trace buckets (`__dailyFritzInteractionTrace`, `__dailyFritzLayoutDebug`) — consumed by Daily Fritz diagnostics (`client/src/modules/daily/dailyFritzMatchDiagnostics.ts`, bot match profiling hooks). **Buckets must keep populating in production when profiling is active.**

**Cruft in production (cleaned):**

- Unconditional `console.log` in `traceDailyFritzBoardEvent` (L44).
- Unconditional `console.log` in `logLayoutDebug` (L676).
- All three placement-zone `console.log` calls (L1092, L1115, L1118).

**Convention followed (not invented):**

| Pattern | Source in codebase |
|---------|-------------------|
| `import.meta.env.DEV` gate before layout `console.log` | `client/src/match/layoutDebug.ts` L28 |
| `import.meta.env.DEV \|\| VITE_DEBUG_DAILY_FRITZ` for Daily Fritz client logs | `client/src/dailyFritz/api.ts` L7–8 (`DAILY_FRITZ_CLIENT_DEBUG_LOGS`) |
| localStorage opt-in for board camera/target overlays | Pre-existing `BOARD_CAMERA_DEBUG`, `BOARD_TARGET_DEBUG` in Board.tsx |

### 1.4 Responsibility inventory — decomposition verdict

| Concern | Approx LOC (before) | Related? |
|---------|---------------------|----------|
| Daily Fritz / camera diagnostics helpers | ~65 | Debug adjunct to renderer |
| Layout engine (`computeLayout`, `layoutBranches`) | ~380 | Core board geometry |
| Camera auto-fit / pan / zoom | ~200 | Viewport over layout |
| DOM rendering (tiles, zones, glow, zoom tray) | ~280 | Presentation |
| Props memoization (`areBoardPropsEqual`) | ~20 | Performance |

**Verdict: cleanup-only — no structural decomposition warranted.** All concerns serve a single rendering domain (domino board layout → camera → DOM). Length (~1,246 LOC) is cohesive; there are not 5+ unrelated responsibilities. Debug helpers were isolated to `boardDiagnostics.ts` (90 LOC) to reduce noise in the renderer file without splitting the layout engine or component.

### 1.5 Call sites and public contract (grep-verified)

**Exports from `client/src/components/index.ts`:**

- `Board` (default memo forwardRef component)
- `BoardHandle` (`zoomIn`, `zoomOut`)

**`BoardProps` interface (unchanged):**

```typescript
interface BoardProps {
  board: BoardState | null;
  legalMoves: Move[];
  selectedTile: Tile | null;
  handNumber?: number;
  handOver?: boolean;
  gameOver?: boolean;
  lastPlayedTile?: Tile | null;
  highlightedPosition?: PlacementPosition | null;
  highlightedEnds?: number[] | null;
  onPositionClick: (position: PlacementPosition) => void;
  tileSize?: number;
  showOpenEndGlow?: boolean;
  profileDailyFritz?: boolean;
  fitMode?: 'default' | 'guided';
  showZoomTray?: boolean;
  staticView?: boolean;
  staticFitMainline?: boolean;
  staticSpineAnchor?: number;
}
```

**Direct `<Board` JSX render sites:**

| File | Notes |
|------|-------|
| `client/src/match/LiveMatchScreen.tsx` | Multiplayer live match |
| `client/src/bot/view/board/BotMatchBoardStage.tsx` | Bot/Daily Fritz match (`profileDailyFritz`) |
| `client/src/learn/components/LearnBoard.tsx` | Learn wrapper |
| `client/src/learn/LearnScenarioScreen.tsx` | Learn scenarios |
| `client/src/learn/guidedMatch/GuidedMatchSourceEditor.tsx` | Guided authoring |
| `client/src/learn/guidedMatch/GuidedMatchRecorderScreen.tsx` | Guided recorder |
| `client/src/analyzer/GameReviewer.tsx` | Post-game analyzer |
| `client/src/training/pivotalReview/PivotalTurnReviewCard.tsx` | Pivotal review |
| `client/src/journey/InteractivePuzzleModal.tsx` | Journey puzzles |
| `client/src/practice/NoBrainerLabScreen.tsx` | No Brainer Lab |
| `client/src/dailyPuzzle/DailyPuzzleLegacyInPlayView.tsx` | Daily Puzzle (frozen module — call site only) |
| `client/src/dailyPuzzle/DailyPuzzleLadderScreen.tsx` | Daily Puzzle ladder (frozen) |
| `client/src/dailyPuzzle/DailyPuzzleAdminScreen.tsx` | Admin builder (frozen) |

**`BoardHandle` ref consumers (no prop changes):** `MultiplayerGameShell.tsx`, `LiveMatchScreen.tsx`, `BotMatchBoardStage.tsx`, `BotMatchBoardControlsTray.tsx`, `NoBrainerLabScreen.tsx`, `useBotMatchRefs.ts`, `multiplayerGameSnapshot.ts`, `MultiplayerModeController.tsx`.

**Blocking-boundary check:** No caller/consumer files were modified. Prop contract and `BoardHandle` API unchanged.

---

## 2. Changes made

### 2.1 New file: `client/src/components/boardDiagnostics.ts` (90 LOC)

Extracted diagnostics helpers with gated logging:

**Before** (`Board.tsx` L44):

```typescript
  console.log(tag, entry);
```

**After** (`boardDiagnostics.ts` L31–33):

```typescript
  if (DAILY_FRITZ_BOARD_DEBUG_LOGS) {
    console.log(tag, entry);
  }
```

where `DAILY_FRITZ_BOARD_DEBUG_LOGS = import.meta.env.DEV === true || import.meta.env.VITE_DEBUG_DAILY_FRITZ === 'true'` (matches `dailyFritz/api.ts`).

**Before** (`Board.tsx` L668–676):

```typescript
      const bucket = (win.__dailyFritzLayoutDebug ??= []);
      bucket.push(entry);
      if (bucket.length > 300) {
        bucket.splice(0, bucket.length - 300);
      }
      console.log('[layout-debug]', entry);
```

**After** — `recordDailyFritzLayoutDebug()` in `boardDiagnostics.ts` L78–90:

```typescript
  const bucket = (win.__dailyFritzLayoutDebug ??= []);
  bucket.push(entry);
  if (bucket.length > 300) {
    bucket.splice(0, bucket.length - 300);
  }
  if (import.meta.env.DEV) {
    console.log('[layout-debug]', entry);
  }
```

**Before** (placement zone handler, L1088–1119):

```typescript
              onClick={(e) => {
                e.stopPropagation();
                const target = e.target instanceof HTMLElement ? e.target : null;
                const currentTarget = e.currentTarget instanceof HTMLElement ? e.currentTarget : null;
                console.log('[board-zone-click]', {
                  position: zone.position,
                  selectedTile: selectedTile ? `${selectedTile.low}|${selectedTile.high}` : null,
                  hasOnPositionClick: typeof onPositionClick === 'function',
                  pointerTargetInfo: {
                    targetTag: target?.tagName ?? null,
                    targetClass: target?.className ?? null,
                    currentTargetTag: currentTarget?.tagName ?? null,
                    currentTargetClass: currentTarget?.className ?? null,
                    targetPointerEvents:
                      target && typeof window !== 'undefined' ? window.getComputedStyle(target).pointerEvents : null,
                    currentTargetPointerEvents:
                      currentTarget && typeof window !== 'undefined'
                        ? window.getComputedStyle(currentTarget).pointerEvents
                        : null,
                  },
                });
                if (profileDailyFritz) {
                  traceDailyFritzBoardEvent('[input] placement click', {
                    position: zone.position,
                  });
                }
                if (typeof onPositionClick !== 'function') {
                  console.log('[board-zone-blocked] reason = missing-onPositionClick');
                  return;
                }
                console.log('[board-zone-forward]', { position: zone.position });
                onPositionClick(zone.position);
              }}
```

**After** (`Board.tsx`):

```typescript
              onClick={(e) => {
                e.stopPropagation();
                if (profileDailyFritz) {
                  traceDailyFritzBoardEvent('[input] placement click', {
                    position: zone.position,
                  });
                }
                if (typeof onPositionClick !== 'function') {
                  return;
                }
                onPositionClick(zone.position);
              }}
```

**Unchanged:** `traceCameraDebug` (localStorage-gated), `recordDailyFritzBoardMetric` (silent profiling), `showTargetDebug` visual overlay, all layout/camera/render logic.

### 2.2 Post-cleanup console grep on `Board.tsx`

```
(no matches)
```

All remaining `console.log` calls live in `boardDiagnostics.ts` behind DEV / `VITE_DEBUG_DAILY_FRITZ` / `BOARD_CAMERA_DEBUG` gates.

### 2.3 Files touched

| File | Action |
|------|--------|
| `client/src/components/Board.tsx` | Removed inline debug helpers; gated layout trace; stripped zone click logs |
| `client/src/components/boardDiagnostics.ts` | **New** — extracted gated diagnostics |
| `client/src/components/boardDiagnostics.test.ts` | **New** — 4 tests for bucket + gating behavior |

**Frozen paths touched:** none.

---

## 3. Tests and build

### 3.1 New tests (`boardDiagnostics.test.ts`)

- `traceDailyFritzBoardEvent` always pushes to `__dailyFritzInteractionTrace`; console only when `import.meta.env.DEV`
- `traceCameraDebug` silent unless `BOARD_CAMERA_DEBUG=1`
- `recordDailyFritzBoardMetric` accumulates only when `__dailyFritzProfileActive`
- `recordDailyFritzLayoutDebug` pushes to `__dailyFritzLayoutDebug`; console only when `import.meta.env.DEV`

### 3.2 Build

```
npm run build --prefix client
```

Result: **PASS** (`tsc -b && vite build`, exit code 0)

### 3.3 Full client test suite

```
Test Files  67 passed (67)
     Tests  537 passed (537)
  Duration  12.68s
```

Result: **PASS** — +1 test file, +4 tests; 0 regressions.

---

## 4. LOC summary

| File | Before | After | Delta |
|------|--------|-------|-------|
| `Board.tsx` | 1,246 | 1,152 | −94 |
| `boardDiagnostics.ts` | 0 | 90 | +90 |
| `boardDiagnostics.test.ts` | 0 | 71 | +71 |
| **Net production LOC** | 1,246 | 1,242 | −4 |

---

## 5. Behavioral equivalence

- Board layout, camera fit, pan/zoom, tile/zone rendering: **unchanged**
- `onPositionClick` still invoked on valid placement-zone clicks: **unchanged**
- Daily Fritz profiling buckets and silent metrics still populate when `profileDailyFritz` / `__dailyFritzProfileActive`: **unchanged**
- Production console noise from Board paths: **removed** (except opt-in `BOARD_CAMERA_DEBUG`)
- No caller files modified; no prop contract changes

---

## 6. Remaining risks

1. **Profiling workflows** that relied on production `console.log` from `traceDailyFritzBoardEvent` must use `VITE_DEBUG_DAILY_FRITZ=true` or dev build — window buckets still capture events.
2. **Layout-debug console** now dev-only; bucket `__dailyFritzLayoutDebug` still available for scripted profiling.
3. **No visual/layout regression test** for Board — reliance on existing suite pass + manual play verification.