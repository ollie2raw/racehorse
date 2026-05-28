# Board Surface First Alias Plan

## A. Candidate surface rules by risk level

### Low risk

These are the only selectors that currently look safe enough for the first neutral alias patch:

#### 1. `client/src/practice/noBrainerLab.css`

Selector:

```css
.nbl-board-canvas {
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

- Purpose: base structural canvas rule
- Routes affected:
  - Practice directly
  - indirectly reused by routes using `MatchNblBoardFrame` / old `InGameBoardShell`
- Risk: low/medium
- Why relatively safe:
  - no colors, gradients, borders, or shadows
  - pure layout/stacking container

#### 2. `client/src/practice/noBrainerLab.css`

Selector:

```css
.practice-lab .nbl-board-canvas .board-container {
  z-index: 4;
}
```

- Purpose: route fit / stacking support
- Routes affected: Practice only
- Risk: low
- Why relatively safe:
  - no visual styling
  - not shared enough to be a first cross-route canonical alias target, but technically safe

#### 3. `client/src/styles/walnut-live.css`

Selector:

```css
.walnut-live .nbl-board-canvas .board-container {
  position: relative;
  z-index: 4;
}
```

- Purpose: generic board engine stacking support
- Routes affected:
  - bot routes
  - other walnut-live board screens using NBL frame
- Risk: low/medium
- Why relatively safe:
  - structure/stacking only
  - no visual skin values

### Medium risk

#### 4. `client/src/practice/noBrainerLab.css`

Selector:

```css
.nbl-board-watermark {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 3;
  width: min(165px, 31.5%);
  height: min(165px, 31.5%);
  transform: translate(-50%, -50%);
  color: #58a6ff;
  opacity: 0.065;
  pointer-events: none;
}
```

- Purpose: base watermark positioning
- Routes affected: broad, because the frame emitter is shared
- Risk: medium
- Why not first:
  - even though positioning is structural, `color` and `opacity` are visual
  - route-specific watermark overrides already exist in bot, Daily Puzzle, Daily Fritz, and Learn

#### 5. `client/src/styles/match-board-architecture.css`

Selector:

```css
.screen.game-screen.walnut-live .rh-match-playfield-card .nbl-board-frame {
  border: none;
  border-radius: 0;
  padding: 4px;
  background: transparent;
  box-shadow: none;
}
```

- Purpose: embedded-frame reset
- Routes affected: older shell consumers
- Risk: medium/high
- Why not first:
  - mixes structural reset and visual reset
  - route-specific ancestry

#### 6. `client/src/styles/match-standard-live-board.css`

Selector:

```css
.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .nbl-board-canvas .board-container {
  position: relative;
  z-index: 4;
}
```

- Purpose: route-specific stacking support
- Routes affected: Daily Puzzle / Practice
- Risk: medium
- Why not first:
  - route-scoped
  - could be aliased later, but `walnut-live .nbl-board-canvas .board-container` is the cleaner first shared candidate

### High risk

These should not be touched in the first surface alias patch.

#### Base frame skin

- `client/src/practice/noBrainerLab.css`
  - `.nbl-board-frame`
  - `.nbl-board-frame::after`

Reason:
- contains frame padding, border-radius, border, background texture, box-shadow, overflow

#### Bot-route surface skin

- `client/src/styles/walnut-live.css`
  - `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .nbl-board-frame`
  - `.nbl-board-frame::before`
  - `.nbl-board-frame::after`
  - `.nbl-board-canvas`
  - `.nbl-board-canvas::before`
  - `.nbl-board-watermark`

Reason:
- heavy frame/canvas/watermark skin

#### rh-standard-live-board shared surface skin

- `client/src/styles/match-standard-live-board.css`
  - `.nbl-board-frame::before/::after`
  - `.nbl-board-canvas`
  - `.nbl-board-watermark`

Reason:
- actual board surface ownership, not just structure

#### Global matte frame polish

- `client/src/styles/match-hud-polish.css`
  - `.screen.game-screen .nbl-board-frame`
  - `.screen.game-screen .nbl-board-frame::after`

Reason:
- broad visual polish layer

#### Daily Fritz mode skin

- `client/src/dailyFritz/dailyFritzMatchBoard.css`
  - `.walnut-nbl-stage .nbl-board-frame`
  - `.nbl-board-canvas::before`
  - `.nbl-board-watermark`

Reason:
- explicit mode-specific surface skin

#### Learn / Guided surface skin

- `client/src/learn/learnGuidedMatch.css`
  - `.learn-guided-live-board-zone .nbl-board-frame`
  - `.nbl-board-canvas`
  - `.nbl-board-watermark`
  - all pseudo-element rules

Reason:
- guided route-specific surface styling

## B. First alias candidates

### Candidate 1: shared canvas structure

- Source file: `client/src/practice/noBrainerLab.css`
- Before:

```css
.nbl-board-canvas {
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

- Proposed alias:

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

- Why safe:
  - pure structure
  - no visual surface values
  - shared runtime bridge already exists
- Routes affected:
  - all routes using the shared frame emitter

### Candidate 2: shared board-container stacking support

- Source file: `client/src/styles/walnut-live.css`
- Before:

```css
.walnut-live .nbl-board-canvas .board-container {
  position: relative;
  z-index: 4;
}
```

- Proposed alias:

```css
.walnut-live .nbl-board-canvas .board-container,
.walnut-live .rh-board-canvas .board-container {
  position: relative;
  z-index: 4;
}
```

- Why safe:
  - structure/stacking only
  - no visual values
- Routes affected:
  - bot routes
  - Daily Puzzle / Practice walnut-live board screens

### Candidate 3: optional route-specific container alias

- Source file: `client/src/styles/match-standard-live-board.css`
- Before:

```css
.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .nbl-board-canvas .board-container {
  position: relative;
  z-index: 4;
}
```

- Proposed alias:

```css
.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .nbl-board-canvas .board-container,
.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .rh-board-canvas .board-container {
  position: relative;
  z-index: 4;
}
```

- Why safe:
  - structure/stacking only
- Why lower priority:
  - route-specific duplication of Candidate 2
  - less useful as the first canonical surface alias

## C. Rules to avoid

Do not touch in the first surface alias patch:

- `.nbl-board-frame::before`
- `.nbl-board-frame::after`
- `.nbl-board-canvas::before`
- Daily Fritz-specific `.walnut-nbl-stage .nbl-board-frame`
- Learn/guided `.nbl-board-frame`
- Learn/guided `.nbl-board-canvas`
- Learn/guided `.nbl-board-watermark`
- `match-hud-polish.css` generic `.nbl-board-frame`
- any frame rule with:
  - `background`
  - `box-shadow`
  - `border`
  - `border-radius`
  - texture/grid layers
  - opacity/color values

## D. Strategy options

### Option 1: Alias low-risk selectors in existing legacy files

Pros:
- lowest risk
- preserves current ownership
- no cascade surprises from moving declarations

Cons:
- ownership remains legacy
- less progress toward the canonical board namespace

### Option 2: Copy/move low-risk shared surface rules into `board-surface.css`

Pros:
- starts the canonical surface namespace
- future home becomes real

Cons:
- if moved too early, can alter cascade
- even “simple” canvas rules are currently anchored in route/base files

### Option 3: Do not touch surface CSS yet; first create `RacehorseBoardFrame`

Pros:
- cleaner naming narrative

Cons:
- unnecessary now because runtime neutral classes already exist

### Option 4: Start with watermark or canvas structure only

Pros:
- narrow

Cons:
- watermark is more visual than it looks
- canvas structure is safer than watermark

## E. Recommendation

Recommended next patch:

- start with canvas structure only
- do **not** start with frame visuals
- do **not** start with watermark
- keep the first patch as selector aliasing in existing legacy files, not a declaration move into `board-surface.css`

Why:

- the truly low-risk rules are:
  - `.nbl-board-canvas`
  - `.nbl-board-canvas .board-container`
- the frame and watermark layers are still too mixed with route-specific visual ownership

## F. Exact proposed Patch 23

### Recommended implementation

#### Edit 1

- File: `client/src/practice/noBrainerLab.css`

Before:

```css
.nbl-board-canvas {
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

After:

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

Declarations:
- unchanged

Old selector:
- remains as part of the combined selector

Why no visual change:
- same declarations
- same DOM still has `.nbl-board-canvas`
- neutral class just becomes equivalent

#### Edit 2

- File: `client/src/styles/walnut-live.css`

Before:

```css
.walnut-live .nbl-board-canvas .board-container {
  position: relative;
  z-index: 4;
}
```

After:

```css
.walnut-live .nbl-board-canvas .board-container,
.walnut-live .rh-board-canvas .board-container {
  position: relative;
  z-index: 4;
}
```

Declarations:
- unchanged

Why no visual change:
- same declarations
- current DOM still matches old selector
- future neutral canvas also matches

### What Patch 23 should not do

- do not edit `board-surface.css` yet
- do not touch `.nbl-board-frame`
- do not touch `.nbl-board-watermark`
- do not alias any pseudo-elements

## G. Verification checklist

- Daily Fritz active match
  - confirm board surface unchanged
- Play vs Fritz active match
  - confirm board surface unchanged
- ghost/bot match
  - confirm board surface unchanged
- Daily Puzzle
  - confirm board surface unchanged
- Practice / No Brainer Lab
  - confirm board surface unchanged
- Learn / Guided
  - confirm no board regression
- Viewports:
  - desktop
  - laptop
  - narrow
  - short-height

