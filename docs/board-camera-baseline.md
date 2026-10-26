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

## Readability floor: open question

The programme's rule is "the entire board is always visible and readable". The metric above lets that be a number. A candidate floor is 16–20 px for the tile's short edge; the baseline shows phones cannot meet it with today's layout, which is what Pass 1 has to solve (denser routing on short viewports, not a smaller camera).
