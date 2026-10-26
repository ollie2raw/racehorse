# Draw and tile-play: diagnosis and plan

Written 2026-10-26, after the board camera passes (see `board-camera-baseline.md`). Same method: measure first, then decide. Nothing here changes behaviour; this is the evidence and the proposed passes, for approval before any build.

## How it was measured

A throwaway Playwright probe drove a real Play vs Fritz (Rookie) match in Chromium, logging every relevant UI state change with a timestamp each animation frame (board tile count, hand count, tappable tiles, active drop zones, the flying-tile overlay, the turn label), and marking each tap. About 2 minutes of play: 31 of the player's plays, 14 Fritz draw turns. Numbers are medians (p50) unless stated. It is one bot tier on one machine, so treat the shape as reliable and the exact milliseconds as indicative. The probe was not kept; building it properly is Pass 0 below.

Also read: `client/src/modules/bot-turn/botTurnGuards.ts` (Fritz's pacing constants), `useTileSelection.ts`, `usePlayAction.ts`, and the hand/tile components.

## Tile play

**What it is today.** Tap a tile in the hand (it becomes selected), the legal drop zones appear on the board, tap a zone to place. There is no drag: the `dragging` state in the code is only the "selected tile" flag broadcast to the opponent (`emitDraggingState`); no tile component is draggable.

**What is already good.**
- Response is instant (optimistic): drop zones appear **11 ms** after the tile tap, and the tile is on the board **12 ms** after the zone tap (max 19 ms).
- When the opponent's tile lands, the player's tiles are tappable in the same frame (**0 ms**).

**What is not.**
- **Half or more of plays have exactly one legal drop zone**: 70 % in the first sample (14 of 20), 53 % in the second (10 of 19; 8 had two zones, 1 had three). In those plays the second tap carries no information, since there is nothing to choose. **Decision (2026-10-26): keep two taps anyway.** On a phone the hand is a row of small tiles, and a mis-tap that plays a move irrevocably is worse than one extra tap. Select-then-confirm stays; the work is making it feel better, not removing it.
- No drag-and-drop, which is the expected gesture for placing a physical tile, and the natural way to choose between two zones.
- Selected-tile feedback and which zone is "the one" are plain; the camera now moves smoothly, but the placement itself (tile flight, landing, settle) is the older presentation.

## Draw

**What it is today.** Pre-game: pick a tile from the pool to decide who starts (labelled "TAP A TILE TO DRAW", then "YOU GO FIRST" / "FRITZ GOES FIRST" about 3 s later). In play, when a player has no legal move they draw from the boneyard until they can play. While a draw sequence runs, the hand is locked (`drawSequenceActive` disables every tile, and `flyingTiles` is part of the "gameplay action blocked" predicate).

**Measured.**
- The player's draw: **442 ms p50 / 817 ms p95** from tap to the tile being in hand, and the hand is locked while it runs.
- Fritz's draw turn: "FRITZ IS DRAWING…" was held **1.5 – 1.9 s** in the first sample but **4.3 s p50 (max 5.3 s)** in the second (n = 6), because the label covers every draw step until Fritz finds a play, and then "FRITZ IS THINKING…" follows for ~1.5 s before the play. The flying-tile animation is ~866 ms per tile. The spread is the number of draws, so a bad draw costs the player 5-7 s of waiting.

## Fritz's pacing (the largest block of waiting)

All of it is fixed "theater" timing in `botTurnGuards.ts`, the same on every tier and every move, with no speed setting:

| Constant | ms | Where it bites |
|---|---|---|
| `BOT_OPENING_THINK_DELAY_MS` | 1000 | every Fritz move |
| `BOT_PLAYER_HANDOFF_DELAY_MS` | 560 | after the player's play, before "thinking" |
| `BOT_PLACE_SETTLE_MS` | 650 | after each tile lands |
| `BOT_SCORE_HOLD_MS` | 1050 | when points are shown |
| `BOT_CHAIN_CONTINUE_DELAY_MS` | 825 | each continue in a scoring chain (a score keeps the turn) |
| `BOT_CHAIN_END_SETTLE_MS` | 1050 | when a chain ends |
| `BOT_FORCED_DRAW_THINK_DELAY_MS` | 1650 | when Fritz must dig the boneyard |
| `BOT_DRAW_STEP_MS` / `BOT_FLY_TILE_MS` | 861 | per drawn tile |
| `BOT_POST_DRAW_PLAY_DELAY_MS` | 900 | after the draw, before the play |
| `BOT_LAST_PLAYED_HOLD_MS` | 3400 | last-played highlight |

Measured reply (my tile lands → Fritz's tile lands): **1.58 s p50** in both samples, **2.7 s p95 / 4.0 s max** in the first and **4.9 s p95 / 7.0 s max** in the second (the tail is scoring chains and forced draws). A simple reply is `1000 + 560 = 1.56 s`, which matches the p50 to within 20 ms. Chains and draws are estimates from the constants, not yet separately measured: a two-step scoring chain is roughly `1000 + 650 + 1050 + 825 + 650 + 1050 ≈ 5.2 s`; a forced draw of three tiles roughly `1650 + 3 × 861 + 900 + 650 ≈ 5.8 s`. During all of it the player waits, and there is no way to speed it up. Over a full match with dozens of Fritz actions this is minutes.

(Multiplayer has no theater pacing: it is as fast as the other human.)

## Findings, ranked by what a player would feel

1. **Fritz's pacing is fixed and long**, and it grows on exactly the interesting turns (scores, draws): a 1.6 s p50 reply but 5-7 s tail.
2. ~~Single-zone plays take two taps where one would do~~ (decided: keep two taps).
3. **No drag-and-drop** for placement.
4. **The hand is locked during draws**, so the player cannot even pre-select while Fritz or they are drawing.
5. Placement and draw *presentation* (flight path, landing, settle) predates the new camera and is the next thing to look rough beside it.

## Proposed passes (one PR each, measured against the numbers above)

- **Pass 0, instrument.** *Done in #366:* the probe is now a kept, gated e2e tool (`PLAY_TRACE=1 npx playwright test e2e/play-trace.spec.ts`) with a pure, unit-tested analyzer (`src/devtools/playTraceAnalysis.ts`), so every later pass has a before/after: response latency, Fritz-turn duration, draw duration, turn-label hold times, legal zones per placement. Still to add: splitting Fritz's reply by turn type (simple / scoring chain / forced draw).
- ~~Pass 1, one-tap placement.~~ **Dropped by decision (2026-10-26): two taps stay, even with one legal zone.**
- **Pass 2, drag to place.** Press-and-drag a tile onto a zone (touch and mouse), tap-tap stays. Highlights the zone under the finger, snaps, cancels cleanly.
- **Pass 3, pacing.** Make the Fritz cadence adaptive and user-controllable: shorter holds, no dead time before moves with one obvious play, a game-speed setting (Normal / Fast), and the hand unlocked for pre-selection during Fritz's turn.
- **Pass 4, presentation.** Rework placement/draw motion on the new camera (tile flight, landing, the boneyard draw), with the same measure-then-tune loop. Native iOS QA included.

## Decisions

1. **One-tap placement: decided, no.** Two taps stay even with one legal zone (see Tile play).
2. **Speed setting (open):** ship a visible Normal/Fast toggle, or only retune the defaults?
3. **Scope of pacing (open):** change Play vs Fritz and Daily Fritz together, or Play vs Fritz first? (Daily Fritz is a verified daily result; its pacing must not change what is verified.)
