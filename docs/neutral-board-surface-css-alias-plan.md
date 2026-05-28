# Neutral Board Surface CSS Alias Plan

## A. Selector inventory

### `client/src/practice/noBrainerLab.css`

#### `.nbl-stage`
- Selector: `.nbl-stage`
- Summary:
  - `flex: 1 1 0;`
  - `min-height: 0;`
  - `display: flex;`
  - `flex-direction: column;`
  - `gap: 10px;`
- Purpose: structure
- Route/mode: Practice / No Brainer Lab base
- Risk: medium

#### `.nbl-board-frame`
- Selector: `.nbl-board-frame`
- Summary:
  - full frame padding, border-radius, border, background grid, shadows, overflow
- Purpose: frame surface + structure
- Route/mode: Practice base, also inherited by other routes through shared emitters
- Risk: high

#### `.nbl-board-frame::after`
- Purpose: frame inset skin
- Route/mode: Practice base
- Risk: high

#### `.nbl-board-canvas`
- Selector: `.nbl-board-canvas`
- Summary:
  - `position: relative; z-index: 2; width/height: 100%; display:flex; align-items:center; justify-content:center;`
- Purpose: canvas structure
- Route/mode: Practice base, reused everywhere the shared frame emitter is used
- Risk: medium

#### `.nbl-board-watermark`
- Selector: `.nbl-board-watermark`
- Summary:
  - absolute centering, size, opacity, pointer-events none
- Purpose: watermark
- Route/mode: Practice base, reused everywhere
- Risk: medium

#### `.practice-lab .nbl-board-canvas .board-container`
- Purpose: route-fit/z-index support
- Route/mode: Practice only
- Risk: medium

### `client/src/styles/walnut-live.css`

#### `.walnut-live .walnut-nbl-stage`
- Summary:
  - `flex: 1 1 0; min-height: 0; gap: 0;`
- Purpose: wrapper relationship / structure
- Route/mode: broad walnut-live board screens
- Risk: low/medium

#### `.walnut-live .walnut-nbl-stage .nbl-board-frame`
- Summary:
  - `flex: 1 1 0; min-height: 0;`
- Purpose: wrapper relationship / structure
- Route/mode: broad walnut-live board screens
- Risk: low

#### `.walnut-live .nbl-board-canvas .board-container`
- Summary:
  - `position: relative; z-index: 4;`
- Purpose: route fit / stacking
- Route/mode: broad walnut-live board screens
- Risk: medium

#### `.screen.game-screen.walnut-live .walnut-nbl-stage`
- Summary:
  - part of grouped shell sizing pass
- Purpose: route fit / structure
- Route/mode: broad game screens
- Risk: medium

#### Bot-route `.nbl-board-frame`
- Selector:
  - `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .nbl-board-frame`
- Summary:
  - full bot-route frame skin
- Purpose: frame surface
- Route/mode: Daily Fritz / Play vs Fritz / ghost
- Risk: high

#### Bot-route `.nbl-board-frame::before`, `.nbl-board-frame::after`
- Purpose: frame visual skin
- Risk: high

#### Bot-route `.nbl-board-canvas`, `.board-area.wl-board-area`
- Purpose: canvas surface
- Risk: high

#### Bot-route `.nbl-board-canvas::before`
- Purpose: inner surface skin
- Risk: high

#### Bot-route `.nbl-board-watermark`
- Purpose: watermark
- Risk: medium/high

#### `.rh-live-board-zone .walnut-nbl-stage`, `.nbl-stage`, `.nbl-board-frame`
- Currently split between:
  - `board-shell.css` structure ownership
  - `walnut-live.css` visual reset ownership
- Purpose: route relationship / visual reset
- Route/mode: bot routes
- Risk: medium

### `client/src/styles/match-standard-live-board.css`

#### `.rh-live-board-zone .walnut-nbl-stage`, `.nbl-stage`, `.nbl-board-frame`
- Summary:
  - visual reset remains here
  - structure relationship already partially moved to `board-shell.css`
- Purpose: relationship + visual reset
- Route/mode: Daily Puzzle / Practice / rh-standard-live-board
- Risk: medium

#### `.rh-live-board-zone .nbl-board-frame::before`, `::after`, `.nbl-board-canvas::before`
- Purpose: pseudo reset
- Route/mode: rh-standard-live-board
- Risk: high

#### `.rh-live-board-zone .nbl-board-canvas`, `.board-area.wl-board-area`
- Purpose: canvas surface
- Route/mode: Daily Puzzle / Practice
- Risk: high

#### `.rh-live-board-zone .nbl-board-watermark`
- Purpose: watermark
- Route/mode: Daily Puzzle / Practice
- Risk: medium

#### `.rh-live-board-zone .nbl-board-canvas .board-container`
- Purpose: stacking/fit
- Route/mode: Daily Puzzle / Practice
- Risk: medium

#### `.screen.game-screen.walnut-live.practice-lab-screen.rh-standard-live-board .nbl-stage`
- Purpose: practice route-fit override
- Route/mode: Practice
- Risk: medium

### `client/src/styles/match-board-architecture.css`

#### `.rh-match-playfield-card .walnut-nbl-stage`, `.nbl-stage`
- Summary:
  - `flex: 1 1 0; min-height: 0; height: 100%;`
- Purpose: structure / route fit
- Route/mode: older shell consumers
- Risk: medium

#### `.rh-match-playfield-card .nbl-board-frame`
- Summary:
  - visual reset (`border:none; border-radius:0; padding:4px; background:transparent; box-shadow:none;`)
- Purpose: frame visual reset
- Route/mode: older shell consumers
- Risk: medium/high

#### `.rh-match-playfield-card .nbl-board-frame::after`
- Purpose: pseudo visual tuning
- Risk: high

### `client/src/styles/match-hud-polish.css`

#### `.screen.game-screen .nbl-board-frame`
- Summary:
  - generic matte frame visual polish
- Purpose: frame surface
- Route/mode: broad game screens
- Risk: medium/high

#### `.screen.game-screen .nbl-board-frame::after`
- Purpose: inset frame visual
- Route/mode: broad game screens
- Risk: high

### `client/src/dailyFritz/dailyFritzMatchBoard.css`

#### `.bot-match-screen.bot-match-mode-daily-fritz .walnut-nbl-stage .nbl-board-frame`
- Purpose: Daily Fritz mode skin
- Route/mode: Daily Fritz only
- Risk: high

#### `.bot-match-screen.bot-match-mode-daily-fritz .walnut-nbl-stage .nbl-board-frame::after`
- Purpose: Daily Fritz mode skin
- Risk: high

#### `.bot-match-screen.bot-match-mode-daily-fritz .nbl-board-canvas::before`
- Purpose: Daily Fritz mode skin
- Risk: high

#### `.bot-match-screen.bot-match-mode-daily-fritz .nbl-board-watermark`
- Purpose: Daily Fritz watermark mode behavior
- Risk: medium/high

### `client/src/learn/learnGuidedMatch.css`

#### `.learn-guided-live-board-zone .walnut-nbl-stage`, `.nbl-stage`, `.nbl-board-frame`
- Purpose: guided board relationship + visual reset
- Route/mode: Learn / Guided
- Risk: high

#### `.learn-guided-live-board-zone .nbl-board-frame::before`, `::after`, `.nbl-board-canvas::before`
- Purpose: guided board visual resets
- Risk: high

#### `.learn-guided-live-board-zone .nbl-board-canvas`
- Purpose: guided board surface
- Risk: high

#### `.learn-guided-live-board-zone .nbl-board-watermark`
- Purpose: guided board watermark
- Risk: medium/high

#### `.learn-guided-board-card .nbl-board-frame`, `.nbl-board-canvas`, `.nbl-board-watermark`
- Purpose: guided board card mode skin
- Risk: high

### `client/src/styles/board/board-shell.css`

#### Existing canonical relationship rules
- `.rh-standard-live-board .rh-live-board-zone .walnut-nbl-stage, .nbl-stage, .nbl-board-frame`
- `.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .walnut-nbl-stage, .nbl-stage, .nbl-board-frame`
- `.bot-match-screen:not(.learn-lesson-screen) .walnut-nbl-stage, .nbl-stage`
- Purpose: shared wrapper relationship / structure only
- Route/mode: shared shell layer
- Risk: low

### `client/src/styles/board/board-surface.css`

- No active selectors yet.
- Current status: namespace stub only.

## B. Best first alias candidates

### Safest first alias candidates

These are the safest because they are already structural or neutral relationship rules, not visual surface ownership:

1. `board-shell.css` grouped relationship selectors
   - before:
     - `.rh-live-board-zone .walnut-nbl-stage`
     - `.rh-live-board-zone .nbl-stage`
     - `.rh-live-board-zone .nbl-board-frame`
   - safe alias target:
     - add `.rh-board-stage`
     - add `.rh-board-frame`

2. `board-shell.css` bot-route overflow relationship
   - before:
     - `.walnut-nbl-stage`
     - `.nbl-stage`
   - safe alias target:
     - `.walnut-nbl-stage, .nbl-stage, .rh-board-stage`

3. `board-shell.css` rh-standard-live-board relationship rules
   - same alias strategy as above

### Why these are safest

- already canonical structure ownership
- already in `board-shell.css`
- no route-specific skin values involved
- no pseudo-elements
- no Practice-only or Daily Fritz-only visuals
- no Learn-only styling

### Not safe as first alias candidates

Avoid initially:

- `.nbl-board-frame` visual skin rules in `noBrainerLab.css`
- `.nbl-board-canvas` surface rules in `walnut-live.css`
- `.nbl-board-watermark` route-specific opacity rules
- any `::before` / `::after`
- `dailyFritzMatchBoard.css` mode-specific surface skin
- `learnGuidedMatch.css` guided board visuals
- `match-hud-polish.css` generic frame polish

## C. Alias strategy options

### Option 1: Add neutral aliases to legacy CSS files

Pros:
- fastest
- no runtime markup change needed

Cons:
- keeps ownership scattered across legacy files
- does not advance canonical namespace cleanly
- easy to deepen the mess

### Option 2: Copy/move small neutral alias rules into `board-surface.css`

Pros:
- starts canonical surface namespace
- keeps old `nbl-*` selectors untouched
- can be no-visual-change if done with safe selectors only

Cons:
- if done too early with visual rules, high risk
- `board-surface.css` should not become a dumping ground for mixed ownership

### Option 3: Do not alias CSS yet; first create `RacehorseBoardFrame`

Pros:
- cleaner naming story

Cons:
- unnecessary indirection before selector migration starts
- Patch 19 already gave us the dual classes we needed

### Option 4: Start with only `board-shell.css` relationship selectors

Pros:
- lowest risk
- already canonical structure ownership
- no visual values involved
- creates first neutral selector bridge safely

Cons:
- does not yet move actual surface ownership
- narrow progress

## D. Recommended Patch 21

Recommended Patch 21:

- alias only the existing canonical relationship selectors in `board-shell.css`
- do **not** touch `board-surface.css` yet
- do **not** touch visual surface files yet

Why:

- this matches your preference
- it is the smallest safe neutral CSS alias step
- it starts using `.rh-board-stage` / `.rh-board-frame` without moving any visual ownership
- it proves the bridge approach before touching actual frame/canvas/watermark surface rules

## E. Exact proposed Patch 21

### File to edit

- `client/src/styles/board/board-shell.css`

### Exact selectors to change

#### 1. rh-standard-live-board grouped relationship rule

Before:

```css
.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .wl-stage-shell,
.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .walnut-nbl-stage,
.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .nbl-stage,
.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .nbl-board-frame
```

After:

```css
.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .wl-stage-shell,
.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .walnut-nbl-stage,
.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .nbl-stage,
.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .rh-board-stage,
.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .nbl-board-frame,
.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .rh-board-frame
```

Declarations:
- unchanged

#### 2. bot-route grouped relationship rule

Before:

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .wl-stage-shell,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .walnut-nbl-stage,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .nbl-stage,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .nbl-board-frame
```

After:

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .wl-stage-shell,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .walnut-nbl-stage,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .nbl-stage,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .rh-board-stage,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .nbl-board-frame,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .rh-board-frame
```

Declarations:
- unchanged

#### 3. bot-route overflow rule

Before:

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-nbl-stage,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .nbl-stage
```

After:

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-nbl-stage,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .nbl-stage,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-board-stage
```

Declarations:
- unchanged

### Whether any declarations move

- No.
- This is selector aliasing only.

### Whether any old selector remains

- Yes.
- All original `nbl-*` selectors remain intact.

### Why this is no-visual-change

- The DOM already has both old and neutral classes.
- The declarations are unchanged.
- The existing `nbl-*` selectors remain.
- We are only teaching the canonical shell file to recognize the new neutral class names too.

## F. What not to touch

Do not touch yet:

- `noBrainerLab.css` frame/canvas/watermark rules
- `walnut-live.css` surface rules
- `match-standard-live-board.css` surface rules
- `match-board-architecture.css` frame reset rules
- `match-hud-polish.css` `nbl-board-frame` polish
- `dailyFritzMatchBoard.css`
- `learnGuidedMatch.css`
- any `::before` / `::after`
- `.nbl-board-canvas`
- `.nbl-board-watermark`
- `Board.tsx`
- tile styling
- hand dock
- meta/controls
- visual redesign

## G. Browser verification checklist

- Daily Fritz active match
  - confirm no board surface/layout change
- Play vs Fritz active match
  - confirm same board frame relationship
- ghost/bot match
  - confirm no change
- Daily Puzzle
  - confirm board still fills the same wrapper
- Practice / No Brainer Lab
  - confirm no board regressions
- Learn / Guided Match
  - confirm guided board unchanged
- Viewports:
  - desktop
  - laptop
  - narrow
  - short-height

