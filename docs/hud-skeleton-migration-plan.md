# HUD Skeleton Migration Plan

Scope: planning-only audit for the first no-visual-change shared HUD migration into:

- `client/src/styles/board/board-hud.css`

This plan is intentionally limited to structural HUD rail selectors and excludes visual skin, mode accents, board shell, surface, hand dock, tiles, and overlays.

## A. Candidate HUD skeleton rules to migrate

These are the rules that are good candidates for the first migration batch because they are primarily structure/layout and map directly to the new shared board composition.

### Candidate 1

- Source file:
  - `client/src/styles/walnut-live.css`
- Current location:
  - line `2493`
- Selector:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-top-rail .wl-center-status
  ```
- Full rule body:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-top-rail .wl-center-status {
    position: relative !important;
    left: auto !important;
    top: auto !important;
    transform: none !important;
    grid-column: 2 !important;
    justify-self: center !important;
  }
  ```
- Structure/layout only or visual skin:
  - `Structure/layout only`
- Why it belongs in `board-hud.css`:
  - it controls slot placement of the center status cluster inside the shared HUD rail
  - it aligns directly with `InGameBoardHud.tsx`’s center slot
- Routes/modes affected:
  - non-lesson bot-match routes
  - Daily Fritz
  - regular Play vs Fritz
  - ghost/bot matches

### Candidate 2

- Source file:
  - `client/src/styles/walnut-live.css`
- Current location:
  - line `2502`
- Selector:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-hud-left-cluster
  ```
- Full rule body:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-hud-left-cluster {
    grid-column: 1 !important;
    justify-self: start !important;
    min-width: 0;
  }
  ```
- Structure/layout only or visual skin:
  - `Structure/layout only`
- Why it belongs in `board-hud.css`:
  - it defines the left HUD slot’s grid placement
  - it is directly tied to the shared left slot emitted by `InGameBoardHud.tsx`
- Routes/modes affected:
  - non-lesson bot-match routes
  - Daily Fritz
  - regular Play vs Fritz
  - ghost/bot matches

### Candidate 3

- Source file:
  - `client/src/styles/walnut-live.css`
- Current location:
  - line `2508`
- Selector:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-hud-right-cluster
  ```
- Full rule body:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-hud-right-cluster {
    grid-column: 3 !important;
    justify-self: end !important;
  }
  ```
- Structure/layout only or visual skin:
  - `Structure/layout only`
- Why it belongs in `board-hud.css`:
  - it defines the right HUD slot’s grid placement
  - it is directly tied to the shared right slot emitted by `InGameBoardHud.tsx`
- Routes/modes affected:
  - non-lesson bot-match routes
  - Daily Fritz
  - regular Play vs Fritz
  - ghost/bot matches

### Candidate 4

- Source file:
  - `client/src/styles/walnut-live.css`
- Current location:
  - line `2513`
- Selector:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-hud-left-cluster > div
  ```
- Full rule body:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-hud-left-cluster > div {
    gap: 14px !important;
    min-width: 0;
  }
  ```
- Structure/layout only or visual skin:
  - `Structure/layout only`
- Why it belongs in `board-hud.css`:
  - it controls left-cluster content spacing and shrink behavior
  - although it targets an inner wrapper, it is still slot structure rather than skin
- Routes/modes affected:
  - non-lesson bot-match routes
  - Daily Fritz
  - regular Play vs Fritz
  - ghost/bot matches

### Candidate 5

- Source file:
  - `client/src/styles/walnut-live.css`
- Current location:
  - line `2632`
- Selector:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-center-status
  ```
- Full rule body:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-center-status {
    gap: 0;
  }
  ```
- Structure/layout only or visual skin:
  - `Structure/layout only`
- Why it belongs in `board-hud.css`:
  - it adjusts internal spacing of the center status cluster
  - it is more structure than skin
- Routes/modes affected:
  - non-lesson bot-match routes
  - Daily Fritz
  - regular Play vs Fritz
  - ghost/bot matches

### Candidate 6

- Source file:
  - `client/src/bot/botMatch.css`
- Current location:
  - line `82`
- Selector:
  ```css
  @media (max-width: 600px) {
    .bot-match-screen .bot-top-rail
  }
  ```
- Full rule body:
  ```css
  @media (max-width: 600px) {
    .bot-match-screen .bot-top-rail {
      grid-template-columns: 1fr 1fr !important;
      row-gap: 8px !important;
    }
  }
  ```
- Structure/layout only or visual skin:
  - `Structure/layout only`
- Why it belongs in `board-hud.css`:
  - it is pure responsive rail structure
- Routes/modes affected:
  - non-lesson and lesson bot-match shells if they use `.bot-top-rail`
  - likely Daily Fritz / regular Play vs Fritz / ghost routes on narrow widths

### Candidate 7

- Source file:
  - `client/src/bot/botMatch.css`
- Current location:
  - line `87`
- Selector:
  ```css
  @media (max-width: 600px) {
    .bot-match-screen .bot-hud-left-cluster
  }
  ```
- Full rule body:
  ```css
  @media (max-width: 600px) {
    .bot-match-screen .bot-hud-left-cluster {
      grid-column: 1;
    }
  }
  ```
- Structure/layout only or visual skin:
  - `Structure/layout only`
- Why it belongs in `board-hud.css`:
  - responsive slot placement for the left cluster
- Routes/modes affected:
  - bot-match routes on narrow widths

### Candidate 8

- Source file:
  - `client/src/bot/botMatch.css`
- Current location:
  - line `91`
- Selector:
  ```css
  @media (max-width: 600px) {
    .bot-match-screen .bot-hud-right-cluster
  }
  ```
- Full rule body:
  ```css
  @media (max-width: 600px) {
    .bot-match-screen .bot-hud-right-cluster {
      grid-column: 2;
      justify-self: end !important;
    }
  }
  ```
- Structure/layout only or visual skin:
  - `Structure/layout only`
- Why it belongs in `board-hud.css`:
  - responsive slot placement for the right cluster
- Routes/modes affected:
  - bot-match routes on narrow widths

### Candidate 9

- Source file:
  - `client/src/bot/botMatch.css`
- Current location:
  - line `96`
- Selector:
  ```css
  @media (max-width: 600px) {
    .bot-match-screen .bot-top-rail .wl-center-status
  }
  ```
- Full rule body:
  ```css
  @media (max-width: 600px) {
    .bot-match-screen .bot-top-rail .wl-center-status {
      grid-column: 1 / -1;
      position: relative !important;
      left: auto !important;
      transform: none !important;
      justify-self: center;
      margin: 0 auto;
    }
  }
  ```
- Structure/layout only or visual skin:
  - `Structure/layout only`
- Why it belongs in `board-hud.css`:
  - responsive center-slot positioning
- Routes/modes affected:
  - bot-match routes on narrow widths

## B. Rules that look HUD-related but should NOT move yet

### Generic `.wl-top-rail` base in `walnut-live.css`

- File:
  - `client/src/styles/walnut-live.css`
- Selector:
  ```css
  .wl-top-rail
  ```
- Why not yet:
  - mixed structure and legacy visual skin
  - shared beyond the active bot-match HUD
  - likely affects Puzzle and other non-bot screens

### Generic `.screen.game-screen.walnut-live .wl-top-rail, .bot-top-rail`

- File:
  - `client/src/styles/walnut-live.css`
- Selector:
  ```css
  .screen.game-screen.walnut-live .wl-top-rail,
  .screen.game-screen.walnut-live .bot-top-rail
  ```
- Why not yet:
  - mixes structure with background, border-bottom, and shadow
  - shared across non-bot routes

### Current active full rail winner

- File:
  - `client/src/styles/walnut-live.css`
- Selector:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-top-rail,
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-top-rail
  ```
- Why not yet:
  - mixed structure and skin in the same block
  - contains:
    - `display`
    - `grid-template-columns`
    - `align-items`
    - `min-height`
    - `padding`
    - `gap`
    - but also `background`, `border`, `box-shadow`
  - migrating this safely requires either:
    - splitting one rule into structure vs skin declarations
    - or a slightly broader value-preserving refactor

### `.bot-match-screen .bot-top-rail` base in `botMatch.css`

- File:
  - `client/src/bot/botMatch.css`
- Why not yet:
  - same issue: mixed structure and visual chrome
  - currently not the winning desktop non-lesson rule

### All `.wl-player-pill` and `.wl-player-pill-btn` rules

- Files:
  - `walnut-live.css`
  - `botMatch.css`
  - `match-hud-polish.css`
  - `dailyFritzMatchBoard.css`
- Why not yet:
  - mostly visual skin and score-card presentation
  - even “layout-looking” properties like `min-width`, `padding`, and `border-radius` are tightly coupled to visual card design

### `.daily-fritz-progress-pill`

- Files:
  - `botMatch.css`
  - `dailyFritzMatchBoard.css`
  - `match-board-architecture.css`
- Why not yet:
  - mode-specific content and accent ownership
  - explicitly excluded from this migration scope

### Learn/guided HUD variants

- Files searched:
  - `client/src/learn/learn.css`
  - `client/src/learn/learnGuidedMatch.css`
  - `client/src/styles/shared-ui.css`
- Result:
  - no active shared HUD skeleton ownership for the target selectors was found here
- Why not yet:
  - lesson cockpit uses different layout conventions and should remain separate until explicitly migrated

### Match architecture HUD system

- File:
  - `client/src/styles/match-board-architecture.css`
- Selectors:
  - `.screen.game-screen.walnut-live .wl-top-rail.rh-match-hud`
  - `.bot-match-screen.rh-match-hud-active .bot-top-rail.rh-match-hud`
  - `.bot-match-screen .bot-hud-left-cluster`
  - `.bot-match-screen .bot-hud-right-cluster`
- Why not yet:
  - parallel architecture layer
  - not clearly the active owner for the current shared board wrappers

## C. Current cascade/conflict analysis

### `walnut-live.css`

Owns:

- global `.wl-top-rail` base
- generic game-screen rail treatment
- multiple non-lesson bot-match HUD passes
- current winning non-lesson bot-match structural rules for:
  - `.bot-top-rail .wl-center-status`
  - `.bot-hud-left-cluster`
  - `.bot-hud-right-cluster`
  - `.bot-hud-left-cluster > div`
  - `.wl-center-status` gap

Conflict level:

- `Dangerous`
- repeated legacy passes with the same selector families

### `botMatch.css`

Owns:

- bot-specific rail base
- responsive rail collapse under `max-width: 600px`
- left/right cluster base layout
- center-status responsive behavior
- Daily Fritz progress pill structure

Conflict level:

- `Layered`
- some rules are active, some are superseded by later `walnut-live.css` desktop rules

### `dailyFritzMatchBoard.css`

Owns:

- Daily Fritz-specific HUD skin
- border-bottom accent
- turn-label color treatment
- score-card visual overrides

Conflict level:

- `Mode skin only`

### `match-hud-polish.css`

Owns:

- score-card polish
- some generic `.wl-top-rail` sizing adjustment
- shared control chrome

Conflict level:

- `Layered`
- but not the primary owner of the target skeleton rules

### `PlayVsFritz.css`

- No direct target-selector ownership found for:
  - `.wl-top-rail`
  - `.bot-top-rail`
  - `.bot-hud-left-cluster`
  - `.bot-hud-right-cluster`
  - `.wl-center-status`
  - `.wl-player-pill`

### `learn.css` / `learnGuidedMatch.css` / `shared-ui.css`

- No direct active ownership found for the target shared HUD skeleton selectors in this audit
- lesson HUD is structurally separate enough that it should not drive this migration batch

## D. Proposed first HUD migration batch

Recommended smallest low-risk migration batch:

1. `walnut-live.css`
   - `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-top-rail .wl-center-status`
   - `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-hud-left-cluster`
   - `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-hud-right-cluster`
   - `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-hud-left-cluster > div`
   - `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-center-status`

2. `botMatch.css`
   - responsive `@media (max-width: 600px)` rules for:
     - `.bot-top-rail`
     - `.bot-hud-left-cluster`
     - `.bot-hud-right-cluster`
     - `.bot-top-rail .wl-center-status`

Why this batch:

- all are layout/slot/placement behavior
- none are primary score-pill skin or mode accent ownership
- all align directly with `InGameBoardHud.tsx`
- avoids touching mixed visual blocks like the full rail shell rule

## E. Import-order impact

Because `client/src/styles/board/index.css` is imported after legacy CSS:

- moving a structural rule into `board-hud.css` and deleting the legacy source preserves parity if:
  - the selector is copied exactly
  - the declarations are copied exactly
  - media query wrappers are preserved exactly

Why this is safe for the proposed batch:

- the selected rules are already the winning rules in their contexts
- later import order in `board-hud.css` will keep them winning

Why the full rail shell rule is not safe yet:

- the winning `walnut-live.css` `.wl-top-rail, .bot-top-rail` block mixes:
  - layout
  - spacing
  - visual chrome
- moving only part of that block would require splitting declarations, which is still safe but not the smallest possible first migration

## F. Migration method

### Move and delete source

Recommended for:

- `walnut-live.css` current winner:
  - `.bot-top-rail .wl-center-status`
  - `.bot-hud-left-cluster`
  - `.bot-hud-right-cluster`
  - `.bot-hud-left-cluster > div`
  - `.wl-center-status { gap: 0; }`
- `botMatch.css` responsive `max-width: 600px` structural rules for those same areas

Reason:

- they are narrow, currently active, and mostly pure structure

### Leave in legacy for now

Recommended for:

- generic `.wl-top-rail`
- generic `.screen.game-screen.walnut-live .wl-top-rail, .bot-top-rail`
- full active non-lesson rail shell block in `walnut-live.css`
- all `.wl-player-pill` rules
- all `.daily-fritz-progress-pill` rules

Reason:

- mixed structure/skin
- shared route impact is broader

### Do not migrate yet

Recommended for:

- `match-board-architecture.css` HUD rules

Reason:

- parallel system, not clearly the active owner for the current shared HUD path

## G. Risk assessment

### Daily Fritz

- Low risk if only cluster/center structure rules move
- Medium risk if any player-pill or progress-pill rules are included

### Play vs Fritz

- Low risk for cluster/center structure migration
- higher risk if full rail shell styles are touched

### Ghost/bot matches

- Same risk profile as Play vs Fritz

### Learn/guided branch

- Low risk if migration is restricted to non-lesson bot-match selector rules only
- higher risk if generic `.wl-top-rail` rules are moved too early

### Puzzle / Practice

- Very low risk if the migration does not touch generic `.wl-top-rail` or `.wl-player-pill` base rules

### Narrow viewport behavior

- Must include the `botMatch.css` `max-width: 600px` structural overrides if the center/left/right cluster rules move
- otherwise desktop may stay stable while mobile regresses

## H. Browser verification checklist

### Routes

- `#/daily-fritz` active match
- regular Play vs Fritz active match
- ghost/bot match if available
- Learn / Guided Match smoke check
- Daily Puzzle smoke check
- Practice / No Brainer Lab smoke check

### What to inspect

Desktop/laptop:

- left cluster still anchors to column 1
- center status still centers in column 2
- right cluster still anchors to column 3
- no unintended shift in the top rail layout

Narrow width:

- center status should collapse to the shared centered row
- left/right clusters should occupy columns 1 and 2 as before

### What not to expect from this migration

- no visual color/glow changes
- no score-card skin changes
- no Daily Fritz progress pill changes

## I. Recommendation

Yes, I recommend doing the HUD skeleton migration next, but only for the narrow structural batch listed in section D.

I do **not** recommend migrating the full `.wl-top-rail, .bot-top-rail` winning shell block yet. It still mixes too much visual chrome with structural layout and should wait for either:

1. a second HUD-specific audit on rail shell vs rail skin ownership, or
2. a slightly larger but still controlled migration patch that intentionally splits those declarations into structure vs skin.
