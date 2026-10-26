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
- **70 % of plays have exactly one legal drop zone** (14 of 20 measured: 1 zone 14×, 2 zones 3×, 3 zones 3×). In those plays the second tap carries no information: there is nothing to choose. It is the largest piece of interaction friction in the game, repeated every turn.
- No drag-and-drop, which is the expected gesture for placing a physical tile, and the natural way to choose between two zones.
- Selected-tile feedback and which zone is "the one" are plain; the camera now moves smoothly, but the placement itself (tile flight, landing, settle) is the older presentation.

## Draw

**What it is today.** Pre-game: pick a tile from the pool to decide who starts (labelled "TAP A TILE TO DRAW", then "YOU GO FIRST" / "FRITZ GOES FIRST" about 3 s later). In play, when a player has no legal move they draw from the boneyard until they can play. While a draw sequence runs, the hand is locked (`drawSequenceActive` disables every tile, and `flyingTiles` is part of the "gameplay action blocked" predicate).

**Measured.**
- The player's draw: **442 ms p50 / 817 ms p95** from tap to the tile being in hand, and the hand is locked while it runs.
- Fritz's draw turn: "FRITZ IS DRAWING…" holds **1.5 – 1.9 s** per draw step (3.4 s at the long end), followed by another "FRITZ IS THINKING…" of about 1.5 s before the play. The flying-tile animation is 861 ms.

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

Measured reply (my tile lands → Fritz's tile lands): **1.58 s p50, 2.7 s p95, 4.0 s max**. A simple reply is `1000 + 560 = 1.56 s`, which matches exactly. A two-step scoring chain is roughly `1000 + 650 + 1050 + 825 + 650 + 1050 ≈ 5.2 s`; a forced draw of three tiles is roughly `1650 + 3 × 861 + 900 + 650 ≈ 5.8 s`. During all of it the player waits, and there is no way to speed it up. Over a full match with dozens of Fritz actions this is minutes.

(Multiplayer has no theater pacing: it is as fast as the other human.)

## Findings, ranked by what a player would feel

1. **Single-zone plays take two taps where one would do** (70 % of plays).
2. **Fritz's pacing is fixed and long**, and it grows on exactly the interesting turns (scores, draws).
3. **No drag-and-drop** for placement.
4. **The hand is locked during draws**, so the player cannot even pre-select while Fritz or they are drawing.
5. Placement and draw *presentation* (flight path, landing, settle) predates the new camera and is the next thing to look rough beside it.

## Proposed passes (one PR each, measured against the numbers above)

- **Pass 0, instrument.** Turn the probe into a kept, gated e2e tool plus an analyzer (like `BOARD_CAMERA_REPORT`), and add a pure model of a turn's cost from the pacing constants, so every later pass has a before/after: taps per play, response latency, Fritz-turn duration by turn type, draw duration, locked-hand time.
- **Pass 1, one-tap placement.** When there is exactly one legal zone, a tile tap places it (with the selection still cancellable by a quick second action / undo window or an explicit setting, see decision 1). Multi-zone plays unchanged.
- **Pass 2, drag to place.** Press-and-drag a tile onto a zone (touch and mouse), tap-tap stays. Highlights the zone under the finger, snaps, cancels cleanly.
- **Pass 3, pacing.** Make the Fritz cadence adaptive and user-controllable: shorter holds, no dead time before moves with one obvious play, a game-speed setting (Normal / Fast), and the hand unlocked for pre-selection during Fritz's turn.
- **Pass 4, presentation.** Rework placement/draw motion on the new camera (tile flight, landing, the boneyard draw), with the same measure-then-tune loop. Native iOS QA included.

## Decisions needed before building

1. **One-tap placement:** safe default is *place on tile tap when there is one zone, with a short undo*. Alternative: keep tap-tap but make the zone auto-highlight and accept tapping anywhere on the board. Which risk of accidental plays is acceptable?
2. **Speed setting:** ship a visible Normal/Fast toggle, or only retune the defaults?
3. **Scope of pacing:** change Play vs Fritz and Daily Fritz together, or Play vs Fritz first? (Daily Fritz is a verified daily result; its pacing must not change what is verified.)
