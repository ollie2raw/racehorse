# Gameplay-feel programme: results so far

Measured 2026-10-27 on `main` after the board camera passes (#358, #361, #363), the play-trace tooling (#366), Fast Fritz (#367, #371), drag-to-place (#368) and the tile flight (#369). Each number below comes from a tool that is in the repo and can be re-run; nothing here is an estimate unless it says so.

Before/after sources: `docs/board-camera-baseline.md` (the Pass 0 baseline and each pass) and `docs/draw-and-play-diagnosis.md` (the diagnosis the play passes started from).

## Board camera: readable, and it glides

Same corpus throughout: 454 hands, 7,459 tile placements, replayed through the real layout engine and camera fit rules (`BOARD_CAMERA_REPORT=1 npx vitest run src/components/board/boardQualityMetrics.test.ts --reporter=verbose`). The readability floor is 18 px for a tile's short edge.

| | Before | Now |
|---|---|---|
| **Desktop 1512×982**: board can't be whole and ≥ 18 px | 0 % | 0 % |
| **Laptop 1280×720**: same | 0 % | 0 % |
| **Phone 932×430**: same | 27.5 % | **7.6 %** |
| **Phone 844×390**: same | 41.3 % | **19.7 %** |
| Phone 844×390: board larger than its container | 7.5 % | **0.9 %** |
| Phone 844×390: placements with a tile under 12 px | 11.2 % | **1.1 %** |
| Phone 844×390: median tile edge | 20.4 px | **24.4 px** |
| Phone 932×430: median tile edge | 24.4 px | **27.3 px** |

Motion. Before, every placement moved tiles in a single frame (the camera snapped, and every tile also jumped because tiles were positioned from the bounds centre). Now the camera is a critically damped spring and tiles keep a stable world position:

| | One-frame move before (p95 / max) | Peak per-frame move now (p95 / max) | Frames over 8 px |
|---|---|---|---|
| Desktop | 95.0 / 101.8 px | **6.5 / 7.0 px** | 0.0 % |
| Laptop | 73.1 / 353.6 px | **5.0 / 19.9 px** | 0.0 % |
| Phone 932×430 | 84.3 / 415.6 px | **5.6 / 12.6 px** | 0.9 % |
| Phone 844×390 | 71.7 / 355.6 px | **4.9 / 10.5 px** | 0.5 % |

(The "before" columns for phones are after Pass 1a, because bigger phone tiles made the old snap worse: placements moving a tile more than 40 px went from 4 % to 20 %. The spring is what removed that cost.)

**Still not solved:** 19.7 % (844×390) and 7.6 % (932×430) of placements cannot be both whole and 18 px readable: the largest multi-hub boards. `docs/board-camera-baseline.md` ("Phone headroom") shows what closing it is worth: clearing the corner pills *and* adding ~40 px of board height takes 844×390 to 5.4 %. That is a phone match-HUD design decision.

## How the game answers a tap and how long it makes you wait

Real Play vs Fritz (Rookie) matches in Chromium, ~45 plays each, via `PLAY_TRACE=1 npx playwright test e2e/play-trace.spec.ts` (`PLAY_TRACE_SPEED=fast` for Fast Fritz). p50 unless stated.

| | Normal | Fast Fritz |
|---|---|---|
| Tap a tile → drop zones visible | 10 ms | 11 ms |
| Tap a zone → tile on the board | 13 ms | 13 ms |
| My tile lands → Fritz's tile lands | 1,579 ms | **638 ms** |
| "FRITZ IS THINKING…" held | 1,578 ms | **640 ms** |
| "FRITZ IS DRAWING…" held | 1,907 ms | **1,171 ms** |
| Fritz's reply, p95 | 7,045 ms* | 1,799 ms |

\* The 7 s tail in both runs is the gap between hands (the new deal), not a single reply; it is the same in both. A simple reply is exactly `1000 + 560 = 1.56 s` normally and `624 ms` at fast, matching the measurement.

Notes:

- The game already answered *the player* instantly (10-13 ms, optimistic) before any of this work; the waiting was Fritz's fixed theater pacing (`botTurnGuards.ts`), which is what Fast Fritz shortens. It is **opt-in** (Settings → Fast Fritz), applies to **Play vs Fritz only**, and never to Daily Fritz.
- Fritz's draw animation is shortened separately (861 → 517 ms per tile at fast pace). The trace tool merges consecutive draws and includes the player's own, so its "flying-tile overlay" figure is not a clean per-tile number; the per-tile length is pinned instead by `e2e/fritz-draw-pace.spec.ts`, which reads the real computed animation length (normal 1.138 s with no override, fast 0.683 s of CSS, cut at 517 ms).
- **60-88 % of placements have exactly one legal drop zone** (four samples: 70, 53, 76 and 60 %). Decision (2026-10-26): two taps stay anyway, so a mis-tap on a small phone tile can never play a move irrevocably.

## What a player can do and see now that they couldn't

- **Drag a tile** from the hand onto an open end (mouse, touch, pen). It is built from the same two clicks as tap-then-tap, so it cannot do anything a tap could not. A held copy follows the pointer, lifted above a fingertip; the zone it would land on gets a ring; a sideways touch still scrolls the rack. Tested with real mouse and real touch events (`e2e/drag-to-place.spec.ts`).
- **Placed tiles fly** from the hand, the drag release point, or Fritz's rack to their place, landing on the live (gliding) destination (`e2e/tile-flight.spec.ts`).
- **The camera glides** and the whole board stays readable on phones (above).

## Not built yet (and why)

| | Why |
|---|---|
| Select a tile while Fritz plays | Selecting also tells the opponent which tile you picked; needs a rule for multiplayer first. |
| Phone match-HUD redesign for board height | The biggest remaining lever on phones (above); touches the HUD and the iOS landscape layouts, so it needs a design review and native QA. |
| Per-draw animation speed for the *player's* own draws | Left unchanged on purpose: it is already ~0.44 s p50. |

## Not measured here

Feel. Every constant that decides how it feels, `CAMERA_SMOOTH_TIME_S` (0.18 s), `FAST_PACE_SCALE` (0.4), `FAST_DRAW_SCALE` (0.6), the drag pick-up (8 px), drop forgiveness (28 px), touch lift (44 px), the flight length (200-380 ms), was chosen from numbers, not from playing. Each is a single constant, and they should be tuned from real play on a phone and on desktop.
