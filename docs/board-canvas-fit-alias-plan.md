# Patch 24: Board Canvas Fit Alias Plan

## Purpose

Identify the next lowest-risk no-visual-change neutral selector alias after the first `.rh-board-canvas` base structure bridge.

This plan is limited to canvas/container fit and stacking. It intentionally avoids frame skin, watermark styling, pseudo-elements, tile rendering, and mode-specific visual surface work.

## A. Candidate next alias rules

### Low risk

#### 1. Shared standard-live board container stacking
- Source file: `client/src/styles/match-standard-live-board.css`
- Selector:
  ```css
  .screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .nbl-board-canvas .board-container
  ```
- Rule body:
  ```css
  .screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .nbl-board-canvas .board-container {
    position: relative;
    z-index: 4;
  }
  ```
- Purpose:
  - simple board-container stacking inside the shared standard-live board canvas
- Route/mode affected:
  - Daily Puzzle
  - rh-standard-live-board screens
  - Practice paths that reuse the standard-live board shell
- Risk level:
  - Low
- Whether `.rh-board-canvas` alias is safe:
  - Yes
- Why:
  - no color, border, shadow, texture, opacity, pseudo-element, or transform
  - directly analogous to the already-migrated `walnut-live` canvas stacking alias

#### 2. Practice-scoped board container stacking
- Source file: `client/src/practice/noBrainerLab.css`
- Selector:
  ```css
  .practice-lab .nbl-board-canvas .board-container
  ```
- Rule body:
  ```css
  .practice-lab .nbl-board-canvas .board-container {
    z-index: 4;
  }
  ```
- Purpose:
  - practice-only board-container stacking above the surface layer
- Route/mode affected:
  - Practice / No Brainer Lab
- Risk level:
  - Low
- Whether `.rh-board-canvas` alias is safe:
  - Yes
- Why:
  - single declaration
  - no visual skin
  - only widens the selector to recognize a neutral class already present on the same node

#### 3. Existing base canvas structure rule already bridged
- Source file: `client/src/practice/noBrainerLab.css`
- Selector:
  ```css
  .nbl-board-canvas,
  .rh-board-canvas
  ```
- Rule body:
  ```css
  .nbl-board-canvas,
  .rh-board-canvas {
    position: relative;
    z-index: 2;
    width: 100%;
    height: 100%;
    min-height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  ```
- Purpose:
  - base canvas box sizing and centering
- Route/mode affected:
  - Practice directly
  - shared runtime class bridge indirectly
- Risk level:
  - Already migrated
- Whether `.rh-board-canvas` alias is safe:
  - already proven safe

### Medium risk

#### 4. Mobile bot-match board sizing fallback
- Source file: `client/src/bot/botMatch.css`
- Selector:
  ```css
  @media (max-width: 768px) {
    .bot-match-screen .board-canvas,
    .bot-match-screen .board-container
  }
  ```
- Rule body:
  ```css
  @media (max-width: 768px) {
    .bot-match-screen .wl-stage-shell,
    .bot-match-screen .wl-board-area,
    .bot-match-screen .board-canvas,
    .bot-match-screen .board-container,
    .bot-match-screen .wl-stage,
    .bot-match-screen .game-board {
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      height: auto !important;
      overflow: hidden !important;
      transform-origin: top left;
    }
  }
  ```
- Purpose:
  - responsive fit behavior for the inner board engine on smaller screens
- Route/mode affected:
  - Daily Fritz
  - Play vs Fritz
  - ghost/bot match
- Risk level:
  - Medium
- Whether `.rh-board-canvas` alias is safe:
  - Not needed here yet
- Why:
  - this rule does not depend on `.nbl-board-canvas`
  - it affects zoom/pan feel and clipping behavior
  - changing or relocating it is higher risk than the simple canvas-container stacking aliases

#### 5. Base engine rules in `App.css`
- Source file: `client/src/App.css`
- Selectors:
  ```css
  .board-container
  .board-canvas
  ```
- Rule bodies:
  ```css
  .board-container {
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
    user-select: none;
  }

  .board-canvas {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    transition: none;
  }
  ```
- Purpose:
  - core board engine fit behavior
- Route/mode affected:
  - all board surfaces
- Risk level:
  - Medium
- Whether `.rh-board-canvas` alias is safe:
  - Not applicable directly
- Why:
  - these are already neutral engine rules and not tied to `nbl-*`
  - they should remain untouched in the first alias batches

### High risk

#### 6. Shared standard-live board canvas visual surface
- Source file: `client/src/styles/match-standard-live-board.css`
- Selector:
  ```css
  .screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .nbl-board-canvas,
  .screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .board-area.wl-board-area
  ```
- Rule summary:
  - border reset
  - border-radius
  - background-color
  - layered background-image
  - background-size
  - box-shadow
- Purpose:
  - actual board surface skin
- Route/mode affected:
  - Daily Puzzle
  - standard-live board surfaces
- Risk level:
  - High
- Whether `.rh-board-canvas` alias is safe:
  - not for the first batch

#### 7. Bot-route board canvas visual surface
- Source file: `client/src/styles/walnut-live.css`
- Selectors:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .nbl-board-canvas,
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .board-area.wl-board-area
  ```
- Rule summary:
  - route-specific border-radius
  - background-color
  - background-image
  - box-shadow
- Purpose:
  - active Daily Fritz / Play vs Fritz / ghost board surface skin
- Route/mode affected:
  - Daily Fritz
  - Play vs Fritz
  - ghost/bot match
- Risk level:
  - High
- Whether `.rh-board-canvas` alias is safe:
  - not for the first batch

#### 8. Watermark rules
- Source files:
  - `client/src/styles/match-standard-live-board.css`
  - `client/src/styles/walnut-live.css`
  - `client/src/practice/noBrainerLab.css`
  - `client/src/learn/learnGuidedMatch.css`
- Selectors:
  - `.nbl-board-watermark`
- Purpose:
  - brand watermark size/opacity/filter
- Route/mode affected:
  - all board modes using the NBL surface
- Risk level:
  - High
- Whether `.rh-board-watermark` alias is safe:
  - not in the first surface alias batch

#### 9. Pseudo-element surface layers
- Source files:
  - `client/src/styles/match-standard-live-board.css`
  - `client/src/styles/walnut-live.css`
  - `client/src/learn/learnGuidedMatch.css`
  - `client/src/dailyFritz/dailyFritzMatchBoard.css`
- Selectors:
  - `.nbl-board-frame::before`
  - `.nbl-board-frame::after`
  - `.nbl-board-canvas::before`
- Purpose:
  - frame and canvas visual overlay layers
- Route/mode affected:
  - multiple routes, highly style-coupled
- Risk level:
  - High
- Whether `.rh-board-canvas` alias is safe:
  - no

## B. Rules to avoid

These should stay untouched in the first post-canvas base alias batch:

- `client/src/styles/match-standard-live-board.css`
  - `.nbl-board-canvas::before`
  - `.nbl-board-canvas, .board-area.wl-board-area` visual surface rule
  - `.nbl-board-watermark`
- `client/src/styles/walnut-live.css`
  - all bot-route `.nbl-board-canvas` visual surface rules
  - all `.nbl-board-canvas::before` rules
  - all `.nbl-board-watermark` rules
- `client/src/dailyFritz/dailyFritzMatchBoard.css`
  - Daily Fritz-specific `.nbl-board-canvas::before` skin
- `client/src/learn/learnGuidedMatch.css`
  - guided-match `.nbl-board-canvas`
  - guided-match `.nbl-board-watermark`
  - guided-match transform/scale rules
- `client/src/bot/botMatch.css`
  - the mobile `.board-canvas` / `.board-container` fallback block
- any `.board-canvas .domino-tile...` or tile highlight rules

## C. Best next alias batch

Recommended Patch 25: alias only the remaining low-risk canvas-container stacking rules.

Exact batch:

1. `client/src/styles/match-standard-live-board.css`
   - alias:
     ```css
     .screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .nbl-board-canvas .board-container
     ```
     to:
     ```css
     .screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .nbl-board-canvas .board-container,
     .screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .rh-board-canvas .board-container
     ```

2. `client/src/practice/noBrainerLab.css`
   - alias:
     ```css
     .practice-lab .nbl-board-canvas .board-container
     ```
     to:
     ```css
     .practice-lab .nbl-board-canvas .board-container,
     .practice-lab .rh-board-canvas .board-container
     ```

Why this is the best next batch:
- it completes the low-risk board-container stacking bridge across the main live board families
- it mirrors the already-safe alias added in `walnut-live.css`
- it does not touch frame visuals, canvas visuals, watermark, pseudo-elements, or route-specific skins

## D. Exact proposed Patch 25

### File 1
- File to edit: `client/src/styles/match-standard-live-board.css`
- Before:
  ```css
  .screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .nbl-board-canvas .board-container {
    position: relative;
    z-index: 4;
  }
  ```
- After:
  ```css
  .screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .nbl-board-canvas .board-container,
  .screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .rh-board-canvas .board-container {
    position: relative;
    z-index: 4;
  }
  ```
- Declarations:
  - unchanged
- Whether declarations move:
  - no
- Whether old selector remains:
  - yes
- Why no visual output changes:
  - the same element still matches the original selector
  - the new alias only adds support for the neutral class already present on the same canvas node

### File 2
- File to edit: `client/src/practice/noBrainerLab.css`
- Before:
  ```css
  .practice-lab .nbl-board-canvas .board-container {
    z-index: 4;
  }
  ```
- After:
  ```css
  .practice-lab .nbl-board-canvas .board-container,
  .practice-lab .rh-board-canvas .board-container {
    z-index: 4;
  }
  ```
- Declarations:
  - unchanged
- Whether declarations move:
  - no
- Whether old selector remains:
  - yes
- Why no visual output changes:
  - same reasoning as above

## E. Whether `board-surface.css` should still wait

Yes. `board-surface.css` should still wait.

Reason:
- the remaining safe work is still selector aliasing, not ownership migration
- the current low-risk candidates are route-scoped legacy rules
- moving tiny pieces into `board-surface.css` now would split ownership earlier than necessary without reducing risk
- the first real `board-surface.css` move should wait until:
  - more neutral selectors exist in runtime and CSS
  - the shared fit/stacking aliases are broader and proven
  - there is a clear shared base rule worth owning canonically

## F. Verification checklist

Routes:
- Daily Fritz active match
- Play vs Fritz active match
- ghost/bot match
- Daily Puzzle
- Practice / No Brainer Lab
- Learn / Guided

Viewport checks:
- desktop wide
- laptop
- narrow width
- short-height viewport

What to inspect:
- board surface still fills the wrapper correctly
- no change in board centering
- no change in tile plane stacking above the canvas
- no new clipping around the board container
- no mode-specific regressions in practice or puzzle
- guided/learn routes remain unchanged

## Recommendation

Proceed with Patch 25 as a narrow alias-only patch in legacy files:
- `client/src/styles/match-standard-live-board.css`
- `client/src/practice/noBrainerLab.css`

Do not touch `board-surface.css` yet.
