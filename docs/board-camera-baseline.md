# Board camera: Pass 0 baseline

Measured 2026-10-26 on `main` @ 79b0ce1e, before any camera or routing change. This is the "before" for the board camera programme (readability, smoothness, whole board always visible).

## How it is measured

`client/src/components/board/boardQualityMetrics.ts` replays seeded engine games through the **real** layout engine (`computeBoardLayout`) and the **real** camera fit rules (`boardCameraFit.ts`, extracted unchanged from `useBoardCamera`). It is pure and browser-free, so it runs over hundreds of hands.

- Corpus: 2 rule variants × 4 policies × 8 seeded games = 454 hands, 7,459 tile placements (same recipe the routing tests use).
- Viewport profiles use the board-container sizes measured in the browser (`e2e/board-routing-geometry.spec.ts`) and the `tileSize={84}` that `LiveMatchScreen` passes to `Board`.
- Fidelity check (in the test suite): the model reproduces the camera scale the real browser reported for the same 19-tile fixture — 0.29 / 0.28 / 0.17 / 0.14 at the four profiles.
- Not modelled: the HUD and rack overlapping the container, and the match-board-enter animation. The container is the measured board area only.

Re-run:

```
cd client
BOARD_CAMERA_REPORT=1 npx vitest run src/components/board/boardQualityMetrics.test.ts --reporter=verbose
```

(`BOARD_CAMERA_GAMES=<n>` changes games per policy.) It is a measurement tool, not a gate.

## Baseline

Tile edge = on-screen short edge of a tile (px); pips are drawn inside it. "Late" = boards with 14+ tiles. Jump = largest screen-space move of an already-placed tile when the next tile arrives. Reflow = placements where routing moved an already-placed tile relative to the rest of the board.

| Profile | Tile edge min / p5 / p50 | Late p5 / p50 | Under 12 / 16 / 20 px | Board overflows container | Jump p50 / p95 / max (px) | Jump > 40 px | Routing reflow | Scale step p95 / max |
|---|---|---|---|---|---|---|---|---|
| Desktop 1512×982 | 21.0 / 31.0 / 51.4 | 26.3 / 35.3 | 0 / 0 / 0 % | 0.0 % | 42.8 / 95.0 / 101.8 | 52.6 % | 0.0 % | 13.2 / 19.3 % |
| Laptop 1280×720 | 18.5 / 24.6 / 41.0 | 21.2 / 27.7 | 0 / 0 / 0.5 % | 0.0 % | 30.3 / 73.1 / 353.6 | 40.3 % | 0.0 % | 15.9 / 39.8 % |
| Phone 932×430 | 11.8 / 13.3 / 24.4 | 11.8 / 16.0 | 1.8 / 17.3 / 41.9 % | 1.2 % | 15.6 / 43.2 / 334.8 | 7.1 % | 0.7 % | 18.9 / 23.9 % |
| Phone 844×390 | 11.8 / 11.8 / 20.4 | 11.8 / 13.7 | 11.2 / 28.6 / 45.4 % | 7.5 % | 12.9 / 38.5 / 279.9 | 3.9 % | 0.7 % | 19.3 / 23.9 % |

## What the numbers say

1. **Readability is a phone problem, not a desktop problem.** On desktop and laptop no placement drops under 16 px. At 844×390 the median tile edge is 20 px, 11 % of placements are under 12 px (the camera floor, 0.14 × 84 = 11.8 px, is what clamps them), and 28.6 % are under 16 px.
2. **"Off screen" is also a phone problem.** 7.5 % of placements at 844×390 (1.2 % at 932×430) ask the camera for a scale below its floor, so the board is larger than its container. The viewport-aware routing keeps desktop and laptop at 0 %.
3. **The board jumps because the camera moves, not because routing moves tiles.** Routing almost never repositions a placed tile (0.0 % desktop/laptop, 0.7 % phone). But about half of all desktop placements move some tile by more than 40 px, because the fit scale changes 13–19 % on a typical placement (p95) and the board re-centres. Occasional spikes of 280–350 px come from bend events and floor clamp transitions.
4. **Implication for the plan.** Freezing placed tiles (Pass 2) is mostly already true; its value is a guarantee, not a visible improvement. The visible improvement is the camera (Pass 1: spring motion, a readable-size floor, and smaller steps), and on phones the layout has to compact further to keep the whole board visible and readable.

## Readability floor (was an open question)

The programme's rule is "the entire board is always visible and readable". The metric above lets that be a number. A candidate floor is 16–20 px for the tile's short edge; the baseline shows phones cannot meet it with today's layout, which is what Pass 1 has to solve (denser routing on short viewports, not a smaller camera).

## Readability floor: decided

The product floor is **18 px** for a tile's short edge (decided 2026-10-26); `READABLE_FLOOR_PX` in `boardQualityMetrics.ts`. The report adds a column for "cannot be whole and readable": placements where the fit would need a tile edge under 18 px, split by which axis binds.

At the baseline (above), that was 41.3 % of placements at 844×390 and 27.5 % at 932×430, and **96 % of those were height-bound** (the board area on a phone is only ~200-250 px tall; width was nearly free).

## Pass 1a result: phone layout

Same 454 hands / 7,459 placements; overlays (controls tray, corner pills) are modelled with rectangles measured in the browser.

| Phone | Median tile edge | Cannot be whole and readable (<18 px) | Overflows container | Under 12 px |
|---|---|---|---|---|
| 844×390 | 20.4 → **24.4 px** | 41.3 % → **19.7 %** | 7.5 % → **0.9 %** | 11.2 % → **1.1 %** |
| 932×430 | 24.4 → **27.3 px** | 27.5 % → **7.6 %** | 1.2 % → **0.2 %** | 1.8 % → **0.2 %** |

Desktop and laptop are unchanged (0 % cannot-be-readable; their code paths are untouched).

What changed, phone-landscape only:

1. Vertical arms turn after **one** tile instead of two (`SHORT_BOARD_MAX_VERTICAL_ARM_TILES`).
2. The flat 2.5-unit bounds pad is replaced by the **exact envelope** of every tile and every possible drop-zone footprint plus 0.4 units (`boardBounds.ts`). A corpus test asserts no zone is ever clipped and that selecting a tile never moves the bounds.
3. Large boards may fill 97 % of the container instead of 92 % (`TIGHT_FIT_FILL`).
4. The camera picks the largest scale at which no tile **and no drop zone** touches the controls tray or a corner pill (`boardCameraReserve.ts`). Without this the larger board ran under the tray.

**Found by CI, and why zones are in the clearance.** The first version of (4) only cleared tiles. `web-rack-breakpoint.spec.ts` (932×430) then got stuck at a 10-tile hand: the drop zone past an arm tip had ended up under the tray, so a valid placement could not be tapped. Zones are now kept clear too (`BoardLayout.dropZoneFootprints`, every open end whatever is selected). It costs ~3 px of tile size at 844×390 (27.5 → 24.4 px median) and is the reason the numbers above are lower than the first Pass 1a measurement. A corpus test asserts that on every phone placement above the camera floor, no tile or zone touches an overlay.

**Follow-up that gives the size back:** the tray and pills sit on the board. Moving them off it (or collapsing the tray) lets the board use the full height; that is a chrome decision for Pass 3/4.

**Cost, and why Pass 2 is next:** bigger tiles mean bigger steps. Phone placements that move a tile more than 40 px went from 4 % to 20 % (844×390) and 7 % to 26 % (932×430), and the p95 scale step from ~19 % to ~35-42 %. A spring camera is what turns that into smooth motion.

**What remains:** 19.7 % (844×390) and 7.6 % (932×430) of placements still cannot be both whole and 18 px readable; they are the largest multi-hub boards. Closing that gap needs one of: further layout compaction for the worst boards, more board height on phones, or accepting a lower floor on the smallest phone. That is a product decision, recorded separately.

## Pass 2 result: a camera that glides

**Why the board felt rough.** Two things changed in the same frame on every placement. (1) The camera scale snapped to a new fit. (2) Every tile jumped in canvas space, because tiles were positioned from the *bounds centre* (`(tile - boundsCentre) * unit`), and the bounds centre changes on every placement. A spring on the scale alone would have left (2) as a teleport.

**What changed** (all live boards; static diagrams and lessons keep the old behaviour):

1. **Stable world frame** (`boardWorldFrame.ts`, `useBoardWorldFrame.ts`). Tiles are positioned against an origin that moves *with* the tiles: when the next layout is the previous one plus a uniform shift, the origin shifts by the same vector, so a placed tile keeps exactly the same canvas position. A corpus test over real games asserts a tile only ever moves in the world frame if routing moved it.
2. **The camera carries all recentring.** The fit now sets the camera translate as well as scale (`screen = centre + camera + scale * (tile - origin)`), so the whole transition is one animatable transform.
3. **Critically damped spring** (`cameraSpring.ts`, `useBoardCameraSpring.ts`). x, y and ln(scale) glide to the target: no overshoot, frame-rate independent, interruptible (a placement mid-glide keeps its velocity), scale animated in log space so zooming in and out feel the same. It writes the canvas transform imperatively per frame, so React does not re-render at 60 fps.
4. **Snaps where gliding would be wrong:** the first fit and the short warm-up window after mount or a reset (the camera fits several times in the first frames), a new hand, a container resize (dragging a window edge tracks 1:1), manual pan/zoom (gestures stay direct), and `useMotionAllowed()` false (reduced motion or a hidden tab).
5. `data-camera-settled` on the canvas, so tests and tools wait for the glide to finish.

**Measured** (same 454 hands; spring simulated at 60 fps over the real camera targets). Before = the old snap, which moved tiles by the full jump in one frame:

| Profile | One-frame jump p95 / max (before) | Peak per-frame move p95 / max (after) | Over 8 px/frame | Settle p50 / p95 |
|---|---|---|---|---|
| Desktop 1512×982 | 95.0 / 101.8 px | 6.5 / 7.0 px | 0.0 % | 683 / 767 ms |
| Laptop 1280×720 | 73.1 / 353.6 px | 5.0 / 19.9 px | 0.0 % | 667 / 750 ms |
| Phone 932×430 | 84.3 / 415.6 px | 5.6 / 12.6 px | 0.9 % | 667 / 800 ms |
| Phone 844×390 | 71.7 / 355.6 px | 4.9 / 10.5 px | 0.5 % | 650 / 817 ms |

That removes the cost Pass 1a introduced (phone jumps went from 4 % to 20 % over 40 px) and then some: the worst frame is now a fraction of what the typical frame was.

**Tuning notes.** `CAMERA_SMOOTH_TIME_S = 0.18`. Most of the move is done by ~0.3 s; the settle time above uses a strict 0.2 px criterion, so it overstates how long the board *looks* like it is moving. A lower value (0.14) is snappier but raises the peak per-frame move ~28 %, which would push phones' over-8-px share up.

**Verified in the real browser:** a per-frame probe tracks one already-placed tile while later tiles arrive (`e2e/board-camera.spec.ts`); it must never move more than 20 px between frames. The geometry and routing specs are unchanged and still pass.
