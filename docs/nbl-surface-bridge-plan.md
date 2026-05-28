# NBL Surface Bridge Plan

## A. Current NBL surface DOM/component map

### Components that emit `.nbl-stage`, `.walnut-nbl-stage`, `.nbl-board-frame`, `.nbl-board-canvas`, `.nbl-board-watermark`

#### 1. `client/src/components/MatchNblBoardFrame.tsx`

- Component: `MatchNblBoardFrame`
- Emits:
  - `.nbl-stage`
  - `.walnut-nbl-stage`
  - `.nbl-board-frame`
  - `.nbl-board-canvas`
  - `.nbl-board-watermark`
- Active for:
  - Daily Fritz
  - regular Play vs Fritz
  - ghost/bot match
- Used by:
  - `client/src/bot/BotMatchScreen.tsx`

#### 2. `client/src/match/InGameBoardShell.tsx`

- Component: internal `InGameBoardFrame`
- Emits:
  - `.nbl-stage`
  - `.walnut-nbl-stage`
  - `.nbl-board-frame`
  - `.nbl-board-canvas`
  - `.nbl-board-watermark`
- Active for:
  - Daily Puzzle
  - Daily Puzzle Ladder
  - Practice / No Brainer Lab through older shell usage
  - some older integrated match layouts

### Components that emit `.board-container`, `.board-canvas`

#### 3. `client/src/components/Board.tsx`

- Component: `Board`
- Emits:
  - `.board-container`
  - `.board-canvas`
- Active for:
  - Daily Fritz
  - regular Play vs Fritz
  - ghost/bot match
  - Daily Puzzle
  - Practice
  - Learn / Guided

### Route/mode mapping

- Daily Fritz:
  - `BotMatchScreen.tsx` → `MatchNblBoardFrame` → `Board`
- Play vs Fritz:
  - `BotMatchScreen.tsx` → `MatchNblBoardFrame` → `Board`
- Ghost/bot:
  - `BotMatchScreen.tsx` → `MatchNblBoardFrame` → `Board`
- Daily Puzzle / Ladder:
  - `DailyPuzzleScreen.tsx` / `DailyPuzzleLadderScreen.tsx` → older `match/InGameBoardShell.tsx` internal frame → `Board`
- Practice / No Brainer Lab:
  - `NoBrainerLabScreen.tsx` + older `match/InGameBoardShell.tsx` path and direct `.nbl-stage` wrapper usage
- Learn / Guided:
  - `Board` still emits `.board-container` / `.board-canvas`
  - `nbl-*` selectors are also referenced in `learnGuidedMatch.css` for the guided live board zone

## B. CSS ownership map

### `.nbl-stage`

Owners:

- `client/src/practice/noBrainerLab.css`
  - base structure
  - active/generic for NBL frame
- `client/src/styles/match-standard-live-board.css`
  - wrapper relationship / reset inside `rh-standard-live-board`
  - active
- `client/src/styles/match-board-architecture.css`
  - older playfield-card embedding
  - active on older shell consumers
- `client/src/styles/board/board-shell.css`
  - shared structure ownership for wrapper relationship only
  - newly canonicalized for shell layer
- `client/src/styles/walnut-live.css`
  - bot-route wrapper relationship / overflow / visual integration
  - active for bot routes
- `client/src/learn/learnGuidedMatch.css`
  - guided live board zone styling
  - active for Learn / Guided

Classification:

- mostly structure / relationship
- some route-specific layout-fit behavior

### `.walnut-nbl-stage`

Owners:

- `MatchNblBoardFrame` / older `InGameBoardShell` emitter
- `walnut-live.css`
  - bot-route and generic board integration
- `match-standard-live-board.css`
  - wrapper relationship inside `rh-standard-live-board`
- `match-board-architecture.css`
  - older embedded shell relationship
- `dailyFritzMatchBoard.css`
  - mode-specific surface accent at `.walnut-nbl-stage .nbl-board-frame`
- `learnGuidedMatch.css`
  - guided board zone
- `board-shell.css`
  - wrapper relationship ownership only

Classification:

- structure wrapper + route bridge
- not a surface owner by itself

### `.nbl-board-frame`

Owners:

- `client/src/practice/noBrainerLab.css`
  - original full frame structure + skin
  - active base source
- `client/src/styles/walnut-live.css`
  - bot-route visual shell/frame overrides
  - active
- `client/src/styles/match-standard-live-board.css`
  - rh-standard-live-board wrapper reset and integrated shell visual
  - active
- `client/src/styles/match-board-architecture.css`
  - older embedded card reset
  - active for older shell consumers
- `client/src/styles/match-hud-polish.css`
  - generic matte frame visual polish
  - active / overlapping
- `client/src/dailyFritz/dailyFritzMatchBoard.css`
  - Daily Fritz mode-specific frame skin
  - active for Daily Fritz
- `client/src/learn/learnGuidedMatch.css`
  - guided board card/live board zone
  - active for Learn / Guided

Classification:

- heavy real styling dependency
- structure + surface skin + mode-specific overrides

### `.nbl-board-canvas`

Owners:

- `noBrainerLab.css`
  - base canvas structure
- `walnut-live.css`
  - bot-route surface visuals
- `match-standard-live-board.css`
  - rh-standard-live-board surface visuals
- `dailyFritzMatchBoard.css`
  - Daily Fritz mode pseudo-layer and watermark relationship
- `learnGuidedMatch.css`
  - guided board surface styling

Classification:

- surface skin + canvas container
- strongly active

### `.nbl-board-watermark`

Owners:

- `noBrainerLab.css`
  - base watermark position/size/opacity
- `walnut-live.css`
  - bot-route watermark opacity/size
- `match-standard-live-board.css`
  - rh-standard-live-board watermark opacity/size
- `dailyFritzMatchBoard.css`
  - Daily Fritz watermark behavior / fade when play exists
- `learnGuidedMatch.css`
  - guided board watermark tuning

Classification:

- watermark only
- active and route-specific

### `.board-container`

Owners:

- emitted by `Board.tsx`
- CSS owners:
  - `noBrainerLab.css`
  - `walnut-live.css`
  - `match-standard-live-board.css`
  - `shared-ui.css`
  - `dailyPuzzle.css`
  - `learnPlayer.css`
  - `learnAcademy.css`
  - `botMatch.css`

Classification:

- board engine container
- structure/layout fit
- very shared

### `.board-canvas`

Owners:

- emitted by `Board.tsx`
- CSS owners:
  - `walnut-live.css`
  - `shared-ui.css`
  - `dailyPuzzle.css`
  - `learnPlayer.css`
  - `learnAcademy.css`
  - `botMatch.css`

Classification:

- board engine viewport canvas
- layout fit + descendant interaction styling

## C. Current active visual stack by route

### Daily Fritz

- Base surface emitter:
  - `MatchNblBoardFrame`
- Base CSS source:
  - `noBrainerLab.css`
- Shared wrapper layer:
  - `board-shell.css`
- Main surface override layer:
  - `walnut-live.css`
- Mode skin layer:
  - `dailyFritzMatchBoard.css`
- Highest-risk selectors:
  - `.nbl-board-frame`
  - `.nbl-board-canvas`
  - `.nbl-board-watermark`
  - `.board-container`

### Regular Play vs Fritz

- Base surface emitter:
  - `MatchNblBoardFrame`
- Base CSS source:
  - `noBrainerLab.css`
- Shared wrapper layer:
  - `board-shell.css`
- Main surface override layer:
  - `walnut-live.css`
- Mode skin layer:
  - none beyond shared bot-route shell/surface rules
- Highest-risk selectors:
  - same as Daily Fritz, minus `dailyFritzMatchBoard.css`

### Ghost/bot match

- Same as Play vs Fritz

### Daily Puzzle

- Base surface emitter:
  - older `match/InGameBoardShell.tsx` internal frame
- Base CSS source:
  - `noBrainerLab.css`
- Shared wrapper layer:
  - `board-shell.css`
- Main surface override layer:
  - `match-standard-live-board.css`
- Supporting architectural layer:
  - `match-board-architecture.css`
- Additional route styling:
  - `dailyPuzzle.css`
- Highest-risk selectors:
  - `.nbl-board-frame`
  - `.nbl-board-canvas`
  - `.board-area.wl-board-area`
  - `.board-container`

### Practice / No Brainer Lab

- Base surface emitter:
  - older `match/InGameBoardShell.tsx` internal frame plus screen-level `.nbl-stage`
- Base CSS source:
  - `noBrainerLab.css`
- Shared wrapper layer:
  - `match-standard-live-board.css`
  - `board-shell.css`
- Additional practice-specific layout:
  - `noBrainerLab.css`
- Highest-risk selectors:
  - `.nbl-stage`
  - `.nbl-board-frame`
  - `.nbl-board-canvas`

### Learn / Guided Match

- Board engine:
  - `Board.tsx`
- NBL frame usage:
  - yes, through `.learn-guided-live-board-zone` selectors and guided board card variants
- Base surface owners:
  - `learnGuidedMatch.css`
  - `shared-ui.css`
- Highest-risk selectors:
  - `.nbl-board-frame`
  - `.nbl-board-canvas`
  - `.nbl-board-watermark`
  - `.board-container`
  - `.board-canvas`

## D. NBL dependency risk

### Is `nbl-*` just naming debt?

No.

It is:

- naming debt
- and real production styling dependency

### Which modes depend on it?

- Daily Fritz
- Play vs Fritz
- ghost/bot match
- Daily Puzzle
- Practice / No Brainer Lab
- Learn / Guided Match

### Which CSS files would break if renamed without compatibility?

- `client/src/practice/noBrainerLab.css`
- `client/src/styles/walnut-live.css`
- `client/src/styles/match-standard-live-board.css`
- `client/src/styles/match-board-architecture.css`
- `client/src/styles/match-hud-polish.css`
- `client/src/dailyFritz/dailyFritzMatchBoard.css`
- `client/src/learn/learnGuidedMatch.css`
- possibly route helpers like `dailyPuzzle.css`, `shared-ui.css`, and learning CSS that rely on `.board-container` / `.board-canvas`

### Which components would need bridge support?

- `client/src/components/MatchNblBoardFrame.tsx`
- older `client/src/match/InGameBoardShell.tsx` internal frame emitter
- any future shared board frame abstraction

### What would break if renamed directly?

- board surface rendering across multiple routes
- route-specific watermark behavior
- embedded toolbar positioning
- board fit/height behavior inside shell wrappers
- guided board card appearance

## E. Neutral bridge proposal

### Recommended bridge strategy

1. Keep existing `nbl-*` classes temporarily.
2. Add neutral shared classes alongside them.
3. Migrate CSS gradually to neutral selectors.
4. Remove old `nbl-*` selectors only after every route has been confirmed.

### Proposed dual-class bridge

Example:

- `className="nbl-stage walnut-nbl-stage rh-board-stage"`
- `className="nbl-board-frame rh-board-frame"`
- `className="nbl-board-canvas rh-board-canvas"`
- `className="nbl-board-watermark rh-board-watermark"`

For Board engine nodes, consider later:

- `className="board-container rh-board-engine-container"`
- `className="board-canvas rh-board-engine-canvas"`

### Component strategy

Safest approach:

- keep `MatchNblBoardFrame` for now
- add neutral classes there first
- optionally later introduce `RacehorseBoardFrame` as the canonical name while `MatchNblBoardFrame` becomes a compatibility wrapper or alias

## F. Recommended neutral class names

### Component name

- Future canonical component:
  - `RacehorseBoardFrame`

### Class names

- Stage class:
  - `.rh-board-stage`
- Frame class:
  - `.rh-board-frame`
- Canvas class:
  - `.rh-board-canvas`
- Watermark class:
  - `.rh-board-watermark`
- Optional toolbar wrapper:
  - `.rh-board-toolbar`

### Inner engine bridge classes (later, optional)

- `.rh-board-engine-container`
- `.rh-board-engine-canvas`

These should remain separate from wrapper/frame classes because `Board.tsx` owns the actual zoom/pan/placement engine.

## G. First safe implementation patch

### Recommendation

Option 1 is the safest:

- Add neutral classes alongside existing `nbl-*` classes in `MatchNblBoardFrame`
- Make no CSS changes yet

Why:

- zero visual change
- immediately creates the future neutral selector destination in runtime DOM
- preserves all current CSS owners
- allows future CSS alias/migration patches to target both old and new classes safely

### Why not start with CSS aliases first?

- Without neutral classes in the DOM, aliasing CSS has no effect
- It also doesn’t reduce dependency on `nbl-*`

### Why not create `RacehorseBoardFrame.tsx` first?

- That adds another component name and indirection before the class bridge exists
- It is a reasonable later step, but not the smallest safe first patch

## H. What not to touch yet

Do not touch yet:

- visual redesign
- matte / gold skin work
- `Board.tsx` structure or layout logic
- tile styling
- hand dock
- meta/controls
- Daily Fritz mode skin
- Practice-specific page layout
- guided/lesson surface styling
- old `board-area.wl-board-area` legacy surface rules
- `noBrainerLab.css` values
- `walnut-live.css` surface values

## I. Recommended migration sequence

1. Add neutral classes to the live frame emitter(s) with no CSS changes.
2. Add neutral classes to the older `match/InGameBoardShell.tsx` internal frame emitter too, so Puzzle / Practice share the bridge.
3. Begin alias migration in CSS:
   - first shared structure relationships
   - then frame/canvas/watermark surface selectors
4. Move neutral shared surface ownership into `board-surface.css`.
5. Keep route/mode overrides in legacy/mode files during transition.
6. Audit every route for live parity.
7. Only after all routes are migrated, remove old `nbl-*` selectors.
8. Later optionally rename `MatchNblBoardFrame` to `RacehorseBoardFrame` or make it a wrapper alias.

## J. Recommended Patch 19

Recommended Patch 19:

- implementation patch
- add neutral dual classes alongside existing `nbl-*` classes in:
  - `client/src/components/MatchNblBoardFrame.tsx`
  - older `client/src/match/InGameBoardShell.tsx` internal frame emitter
- no CSS changes yet
- no component behavior changes

This creates the bridge without changing visuals and gives future `board-surface.css` migrations a neutral runtime target.

