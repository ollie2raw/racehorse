# D2 — `client/src/components/Board.tsx` decomposition scoping

**Status:** investigation only, no code changed. Produced 2026-09-10 so a
go / no-go / reorder call can be made without touching the file.

**Source:** `REFACTOR_OPPORTUNITIES.md` §3 D2.

---

## 1. What is actually in the file (1266 lines)

Three distinct things live in one module:

### 1a. Pure layout geometry (lines ~36–500, ~460 lines) — **no React**

| Export | Lines | What it does |
|---|---|---|
| `computeBoardLayout(board, validPositions)` → `BoardLayout` | 77–301 | The core: walks `board.mainLine` + `board.hubDoubles[].branches`, assigns each tile an `(x, y, rotation)` in board-units, emits `LayoutZone[]` for the open ends, tracks `minX/maxX/minY/maxY`. |
| `layoutBranches(hub, hubId, hubX, hubY, …)` | 322–~500 | Recursive helper for `computeBoardLayout` — positions the tiles hanging off a spinner (hub double), including nested branches. The recursion + the 4-direction geometry is the densest math in the file. |
| `calculateBoardFitScale({layout, tileSize, viewport…, targetFill, min/maxScale, multiplier})` → number | 302–321 | Pure: given a layout bounding box and a viewport, returns the camera scale that fits it. |
| `BoardLayoutTile`, `BoardLayout`, `LayoutZone`, `HubLookup` types | 36–76 | |

These are **already tested in isolation** — `boardDiagnostics.test.ts` and
`Board.reviewContainment.test.tsx` exercise `computeBoardLayout` /
`calculateBoardFitScale` directly. They have **zero dependency on the component**
below them; the component imports them like any other module would.

### 1b. `BoardComponent` (lines 555–1242, ~690 lines) — the React surface

One function component, wrapped `memo(forwardRef(BoardComponent), areBoardPropsEqual)`.
**32 hook calls** in the body. They cluster into four concerns:

| Concern | Hooks / lines | What it owns |
|---|---|---|
| **Viewport + camera state** | `viewportSize`, `camera`, `isDragging` `useState`; `manualCameraRef`, `manualCameraUntilRef`, `lastResetSignatureRef`, `dragStart`, `containerRef`, `fitRetryRafRef` `useRef` (lines 585–594) | pan/zoom position, whether the user has taken manual control, drag anchor |
| **Layout derivation** | `openEndPositions`, `validPositions`, `cameraFitPositions`, `layout`, `placementZones`, `glowLayout`, `resetSignature` `useMemo` (613–748) | memoised calls into 1a + derived render data (placement zones with pixel coords, open-end glow zones) |
| **Camera fitting** | `markManualCamera`, `fitCameraToContainer` `useCallback` (750–879); `fitCameraToContainerRef` mirror; the ResizeObserver + double-rAF auto-fit `useEffect` (889–938); the "tiles increased → auto-refit" `useEffect` (880–887) | the single authoritative "keep the board framed" loop — the part `c2fafb79` ("redesign camera") rewrote |
| **Pointer interaction** | `handleWheel`, `handleMouseDown/Move/Up`, `handleDoubleClick`, `applyZoomStep`, `resetCameraToFit` `useCallback` (941–1049) | wheel-zoom, drag-pan, double-click-to-fit, the zoom-tray +/− buttons |
| **Render** | JSX (1050–1242) | the `<div>` transform wrapper, `.domino-tile` map (via `DominoTile`), `.placement-zone` map, `.open-end-glow` map, the `.board-zoom-tray` control pill |

### 1c. `areBoardPropsEqual` (1243–1263) — a hand-written `memo` comparator

20 lines comparing 21 props by value, with `highlightedEndsEqual` /
`cameraStatesEqual` helpers (534–554). This is load-bearing for board render
performance — every mode re-renders its parent on socket ticks / bot moves.

---

## 2. Why it grew this way

`Board.tsx` is in the **initial commit** (`92b04591`). 49 commits since. The
growth is legible from git — it was not one bad decision, it was six reasonable
increments on a component that is genuinely one thing on screen:

1. Original: static layout + render.
2. `1b6ed62e` / `42a2e0d5` — game-review needed recursive branch containment →
   `layoutBranches` recursion + `containFullBoard`.
3. `ac8e7a14` — a11y: keyboard-operable placement zones + ARIA landmarks.
4. `c2fafb79` — **camera redesign**: auto re-fit, multiplicative zoom,
   fit-to-board. This is where the camera-fitting cluster (1c above) doubled in
   size and got its ref-mirror complexity.
5. `0cd403df` / `d370f47c` — camera follow-ups (targetFill, maxFitScale, gold
   zones, zoom tray restore).
6. `7f23a8ef` — hooks-correctness sweep touched it.

The `fitMode` / `staticView` / `staticFitMainline` / `staticSpineAnchor` /
`containFullBoard` prop cluster (5 of the 21 props) all exist to make the *same*
component serve both the **live interactive board** and the **static
game-review / guided-lesson board** — that dual duty is the single biggest
source of branching inside the component.

---

## 3. What a decomposition looks like (high level)

The pure/impure split is already 80% done by circumstance — 1a is a clean
already-tested module that just happens to share a file. The real work is 1b.

**Tier 0 — free, zero risk (do first, or as part of any other pass):**
Move 1a (`computeBoardLayout`, `layoutBranches`, `calculateBoardFitScale`, the
geometry types) into `client/src/components/board/boardLayout.ts`. `Board.tsx`
imports them. No behaviour change, TypeScript proves the move, the existing
`boardDiagnostics.test.ts` / `Board.reviewContainment.test.tsx` move with it or
keep importing by the new path. **~460 lines out of the file for a rename.**
This alone drops it under the `max-lines` budget and is not really "D2" — it's
an R-class cheap win that got filed under D2 because it lives in the same file.

**Tier 1 — the actual component decomposition (this is D2):**

| New unit | Extracts | Interface |
|---|---|---|
| `useBoardCamera(containerRef, layout, opts)` | the viewport + camera state, `markManualCamera`, `fitCameraToContainer` + its ref-mirror, the ResizeObserver / double-rAF auto-fit effect, the tile-count auto-refit effect | `{ camera, viewportSize, isManual, fitNow(), setCameraManual() }` |
| `useBoardPointerControls(camera setters, markManual)` | `handleWheel` / `handleMouseDown/Move/Up` / `handleDoubleClick` / `applyZoomStep` / `resetCameraToFit` + `isDragging` / `dragStart` | `{ handlers, applyZoomStep, resetToFit }` |
| `useBoardRenderLayout(board, legalMoves, selectedTile, …)` | the 7 `useMemo` layout-derivation calls | `{ layout, placementZones, glowLayout, resetSignature }` |
| `Board.tsx` (stays) | the JSX, the prop contract, `memo`/`forwardRef`/`areBoardPropsEqual`, wiring the three hooks together | unchanged public API |

Net: `Board.tsx` becomes ~250–300 lines of "compose three hooks + render",
each hook is independently testable, and the static-vs-live branching lives in
`useBoardCamera` (which already takes `resolvedFitMode` / `staticView` etc.)
rather than being smeared across the component body.

**Explicitly NOT in scope:** splitting the *component* into
`<LiveBoard>` / `<ReviewBoard>`. Tempting (kills the `staticView` prop family)
but it doubles the JSX and the `memo` comparator, and the two really do share
95% of the render. The hook extraction gets most of the legibility win without
that duplication.

---

## 4. What could break

- **Camera behaviour is the whole risk.** `c2fafb79`'s redesign is subtle:
  `manualCameraRef` + `manualCameraUntilRef` gate whether an auto-fit is allowed
  to move the camera; `fitCameraToContainerRef` is a ref-mirror so the
  ResizeObserver callback (created once) can call the latest closure; the
  double-rAF is a deliberate "wait for layout to settle" hack. Splitting the
  state from the effect that drives it is exactly where a "board doesn't
  re-centre after a tile is placed" or "board jumps while you're panning"
  regression hides. **This needs board-interaction e2e coverage in place
  first** — there is currently none (`match.spec.ts` checks the board *renders*,
  not that pan/zoom/auto-fit behave).
- **`areBoardPropsEqual` + render perf.** If the hook extraction changes the
  identity stability of anything passed to `DominoTile` in the map, every mode's
  board re-renders on every parent tick. Measure render count before/after
  (the file already calls `useRenderProfiler('Board')` — use it).
- **`walnut-live.css` coupling.** `Board.tsx` emits `.domino-tile`,
  `.placement-zone`, `.placement-zone.active`, `.open-end-glow`,
  `.board-zoom-tray`, `.control-pill`. `walnut-live.css` (CLAUDE.md-protected,
  bottom ~2525–2577 + scattered) styles them per mode with long
  `.screen.game-screen.walnut-live.bot-match-screen:not(...)` selectors. **Do
  not rename any emitted class.** A decomposition that keeps the same DOM
  structure + classes is safe here; one that restructures the wrapper divs is
  not.
- **`profileDailyFritz` telemetry** (`recordDailyFritzBoardMetric('boardRenderCount')`)
  — keep it wherever the render lands.
- **5 consumers**: `BotMatchBoardStage`, `MultiplayerGameShell`,
  `NoBrainerLabScreen`, `BotMatchBoardControlsTray`, plus the review path via
  `liveMatchScreenTypes` / `botMatchViewModelTypes`. The public API (`BoardProps`,
  `BoardHandle`, `Board` default export) must not change.

---

## 5. Realistic step sequence (if approved)

1. **Pre-req PR — board-interaction e2e.** A `board-camera.spec.ts` that: plays
   3–4 tiles in Play vs Fritz and asserts the board stays framed (bounding box
   of `.domino-tile` group stays within the container); drags the board and
   asserts it moved and did *not* snap back; clicks a zoom-tray button and
   asserts scale changed; double-clicks and asserts it re-fit. This is the
   safety net and it does not exist. ~1 day.
2. **PR 1 — Tier 0 geometry move** (`boardLayout.ts`). Pure rename, TS-proven,
   existing tests repoint. Drops the file ~460 lines. Low risk, ship
   independently even if the rest of D2 is deferred.
3. **PR 2 — `useBoardRenderLayout`.** The 7 `useMemo`s. Pure derivation, easiest
   of the three hooks, no effects. Snapshot the derived shapes in a test.
4. **PR 3 — `useBoardPointerControls`.** The event handlers. Contained; the
   e2e from step 1 covers the behaviour.
5. **PR 4 — `useBoardCamera`.** The hard one — state + the auto-fit effect +
   the ref-mirror. Do last, alone, with the e2e green before and after, and a
   render-count check.
6. Each PR: full client bar + `check:architecture` 20/20 + the new e2e.

**Estimated size:** step 1 ~1 day, step 2 ~half a day, steps 3–5 ~1 day each
with careful review. Call it **4–5 focused days**, PR 4 being the one that
genuinely needs a human watching.

**Recommendation for the go/no-go:** step 2 (Tier 0) is worth doing on its own
regardless — it's an R-class cheap win mislabelled as D2. Steps 3–5 (real D2)
are only worth it once step 1's e2e exists; without that safety net the camera
regression risk outweighs the legibility gain.
