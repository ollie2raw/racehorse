# Board Shell / Body Migration Plan

## A. Active board shell/body DOM path

### 1. Bot / Daily Fritz / Play vs Fritz active board path

- File: `client/src/bot/BotMatchScreen.tsx`
- Component: `BotMatchScreen`
- Route/modes:
  - Daily Fritz
  - regular Play vs Fritz
  - ghost/bot match
- Active structure:
  - `InGameBoardShell` from `client/src/match/board/InGameBoardShell.tsx`
  - `InGameBoardFrame` from `client/src/match/board/InGameBoardFrame.tsx`
  - `boardStage` from `BotMatchScreen.tsx`
  - `MatchNblBoardFrame` from `client/src/components/MatchNblBoardFrame.tsx`
  - `Board` from `client/src/components/Board.tsx`

DOM/class path:

1. `.screen.game-screen.walnut-live.bot-match-screen`
2. `.walnut-match-layout.game-layout-layer`
3. `.rh-live-studio-shell`
4. `.rh-live-board-zone`
5. `.wl-stage-shell`
6. `.nbl-stage.walnut-nbl-stage`
7. `.nbl-board-frame`
8. `.nbl-board-canvas`
9. `.nbl-board-watermark`
10. `.board-container`
11. `.board-canvas`

Adjacent coupled elements:

- `.rh-board-meta-bar`
- `.board-corner-pill`
- `.board-zoom-tray`
- `.wl-controls-tray`
- `.rh-live-hand-deck` (do not migrate in this phase)

### 2. Daily Puzzle / Daily Puzzle Ladder path

- File: `client/src/dailyPuzzle/DailyPuzzleScreen.tsx`
- File: `client/src/dailyPuzzle/DailyPuzzleLadderScreen.tsx`
- Component: older `client/src/match/InGameBoardShell.tsx`
- Route/modes:
  - Daily Puzzle
  - Daily Puzzle Ladder

DOM/class path:

1. `.screen.game-screen.walnut-live.daily-puzzle-screen.rh-standard-live-board`
2. `.walnut-match-layout.game-layout-layer`
3. `.rh-match-playfield-card`
4. `.rh-live-board-zone.rh-match-arena`
5. `.wl-stage-shell`
6. `.nbl-stage.walnut-nbl-stage`
7. `.nbl-board-frame`
8. `.nbl-board-canvas`
9. `.nbl-board-watermark`
10. `.board-container`
11. `.board-canvas`

### 3. Practice / No Brainer Lab path

- File: `client/src/practice/NoBrainerLabScreen.tsx`
- Component: older `client/src/match/InGameBoardShell.tsx` with `boardColumnOnly`
- Route/mode:
  - Practice / No Brainer Lab

DOM/class path:

1. `.practice-lab.practice-lab-screen.screen.game-screen.walnut-live.rh-standard-live-board`
2. `.nbl-stage.rh-live-studio-shell` wrapper from the screen
3. `.rh-match-playfield-card.rh-match-playfield-card--embed`
4. `.rh-live-board-zone.rh-match-arena`
5. `.wl-stage-shell`
6. `.nbl-stage.walnut-nbl-stage`
7. `.nbl-board-frame`
8. `.nbl-board-canvas`
9. `.nbl-board-watermark`
10. `.board-container`
11. `.board-canvas`

### 4. Learn / Guided path

- File: `client/src/bot/BotMatchScreen.tsx`
- Mode:
  - Learn / Guided Match lesson layout branch
- Important difference:
  - uses `.rh-live-board-zone.learn-guided-live-board-zone`
  - has lesson-specific `.learn-lesson-board-area` and shared-ui ownership
- This path should not be touched in the first board-body migration batch.

## B. CSS owner map

### Shared shell/body selectors

#### `.rh-live-studio-shell`

- `client/src/styles/walnut-live.css`
  - non-lesson bot-match at multiple passes:
    - older v2/v3 style passes
    - current later pass around lines `2579+`
  - role: structure + shell skin
  - status: layered, bot-mode active
- `client/src/styles/match-standard-live-board.css`
  - `.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-studio-shell`
  - role: structure + shell skin
  - status: active for Daily Puzzle / Practice
- `client/src/match/board/InGameBoardFrame.tsx`
  - emits class only
- `client/src/match/InGameBoardShell.tsx`
  - older shell emitter

Current winning summary:

- Bot/Daily Fritz/Play vs Fritz:
  - later `walnut-live.css` bot-match block wins
- Daily Puzzle / Practice:
  - `match-standard-live-board.css` owns

#### `.rh-live-board-zone`

- `client/src/styles/walnut-live.css`
  - multiple bot-match passes:
    - older v2/v3 surface/shell treatments
    - current later pass around `2583+`
  - role: structure + shell skin
  - status: layered, bot-mode active
- `client/src/styles/match-standard-live-board.css`
  - `.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone`
  - role: structure + shell skin
  - status: active for Daily Puzzle / Practice
- `client/src/match/InGameBoardShell.tsx`
  - emits class only
- `client/src/match/board/InGameBoardFrame.tsx`
  - emits class only

#### `.wl-stage-shell`

- `client/src/styles/walnut-live.css`
  - generic structural base:
    - flex
    - min-height
    - padding
    - overflow
  - bot-match overrides:
    - `padding: 0 !important;`
    - `border-radius`
    - `overflow: visible`
  - status: active, layered
- `client/src/styles/match-standard-live-board.css`
  - `.rh-live-board-zone .wl-stage-shell`
  - role: structure only
  - status: active for rh-standard-live-board screens
- `client/src/styles/match-board-architecture.css`
  - `.rh-match-playfield-card .wl-stage-shell`
  - role: structure wrapper
  - status: active for older `InGameBoardShell` consumers
- `client/src/bot/botMatch.css`
  - viewport squeeze / fit rules touching `.wl-stage-shell`
  - status: responsive support

### NBL/current playfield frame selectors

#### `.nbl-stage`, `.walnut-nbl-stage`

- `client/src/practice/noBrainerLab.css`
  - canonical original NBL structure
  - role: structure + practice visual base
  - status: active everywhere the frame component is used
- `client/src/styles/walnut-live.css`
  - bot-match scoped overrides
  - role: structure reset / mode-specific adaptation
  - status: active in bot routes
- `client/src/styles/match-standard-live-board.css`
  - `.rh-live-board-zone .walnut-nbl-stage, .nbl-stage`
  - role: structure reset
  - status: active in Daily Puzzle / Practice
- `client/src/styles/match-board-architecture.css`
  - `.rh-match-playfield-card .walnut-nbl-stage, .nbl-stage`
  - role: older structure wrapper

#### `.nbl-board-frame`

- `client/src/practice/noBrainerLab.css`
  - full original NBL frame skin and structure:
    - padding
    - border-radius
    - background grid
    - box-shadow
    - overflow
  - status: base source
- `client/src/styles/walnut-live.css`
  - bot-match overrides for frame:
    - older and newer passes
    - heavy visual ownership
  - status: active for bot routes
- `client/src/styles/match-standard-live-board.css`
  - resets frame inside `.rh-live-board-zone`
  - role: structure reset + shell integration
  - status: active for rh-standard-live-board screens
- `client/src/styles/match-board-architecture.css`
  - `.rh-match-playfield-card .nbl-board-frame`
  - role: older embedding reset
  - status: active for older shell consumers
- `client/src/styles/match-hud-polish.css`
  - generic matte frame treatment on `.screen.game-screen .nbl-board-frame`
  - role: visual polish layer
  - status: active and overlapping
- `client/src/dailyFritz/dailyFritzMatchBoard.css`
  - Daily Fritz mode-specific overrides on `.walnut-nbl-stage .nbl-board-frame`
  - role: mode skin only
  - status: active on Daily Fritz

#### `.nbl-board-canvas`

- `client/src/practice/noBrainerLab.css`
  - structure container for watermark + children
- `client/src/styles/walnut-live.css`
  - bot route visual surface overrides
- `client/src/styles/match-standard-live-board.css`
  - rh-standard-live-board visual surface ownership
- `client/src/styles/match-board-architecture.css`
  - indirect older embedding support
- `client/src/dailyFritz/dailyFritzMatchBoard.css`
  - Daily Fritz mode-specific pseudo/surface changes

#### `.nbl-board-watermark`

- `client/src/practice/noBrainerLab.css`
  - base watermark placement/opacity
- `client/src/styles/walnut-live.css`
  - bot-mode opacity/size overrides
- `client/src/styles/match-standard-live-board.css`
  - rh-standard-live-board opacity/size override
- `client/src/dailyFritz/dailyFritzMatchBoard.css`
  - Daily Fritz mode-specific opacity transitions

### Board engine descendants

#### `.board-container`

- emitted by `client/src/components/Board.tsx`
- CSS owners:
  - `noBrainerLab.css`: `.practice-lab .nbl-board-canvas .board-container`
  - `walnut-live.css`: `.nbl-board-canvas .board-container`, `.wl-board-area .board-container`
  - `match-standard-live-board.css`: `.nbl-board-canvas .board-container`
  - `shared-ui.css`: lesson-only board-area descendants
- role: structure only

#### `.board-canvas`

- emitted by `client/src/components/Board.tsx`
- CSS owners:
  - mostly descendant layout fit rules via `botMatch.css`, `walnut-live.css`, `shared-ui.css`
- role: structure only

#### `.board-area`, `.wl-board-area`

- alternative older board-surface path not used by the current bot live route, but still active in Daily Puzzle / Learn / older layouts
- major owners:
  - `walnut-live.css`
  - `match-standard-live-board.css`
  - `match-board-architecture.css`
  - `shared-ui.css` (lesson)
- role: surface + structure
- status: high-risk legacy overlap

### Meta / controls selectors tightly coupled to shell

#### `.rh-board-meta-bar`

- `client/src/styles/match-board-architecture.css`
  - base absolute meta bar ownership
- `client/src/styles/walnut-live.css`
  - bot-mode placements and later overrides
- `client/src/styles/match-standard-live-board.css`
  - rh-standard-live-board placement override
- `client/src/bot/botMatch.css`
  - pill typography/details
- `client/src/dailyFritz/dailyFritzMatchBoard.css`
  - Daily Fritz mode-specific visual accents

#### `.board-corner-pill`

- `walnut-live.css`
- `botMatch.css`
- `dailyFritzMatchBoard.css`
- `match-board-architecture.css`
- status: meta UI, not shell

#### `.board-zoom-tray`, `.wl-controls-tray`

- `client/src/components/Board.tsx`
  - emits `board-zoom-tray control-pill`
- `client/src/styles/match-hud-polish.css`
  - strong base owner for control pill structure/skin
- `client/src/styles/walnut-live.css`
  - board-screen positioning and skin overrides
- `client/src/styles/match-standard-live-board.css`
  - rh-standard-live-board control skin
- `client/src/dailyFritz/dailyFritzMatchBoard.css`
  - Daily Fritz mode skin
- status: controls, not first board-body batch

## C. Conflict analysis

### What currently comes from `walnut-live.css`

For bot / Daily Fritz / Play vs Fritz, `walnut-live.css` is still the dominant owner of:

- `.rh-live-studio-shell`
- `.rh-live-board-zone`
- `.wl-stage-shell` bot-route overrides
- `.nbl-board-frame` bot-route reset / later shell integration
- `.nbl-board-canvas` bot-route surface treatment
- `.nbl-board-watermark` bot-route sizing/opacity
- `.rh-board-meta-bar` bot-route placement
- `.board-corner-pill`, `.wl-controls-tray` bot-route placement/skin

It contains multiple historical passes:

- older “studio cockpit / live board v2”
- later “cleaner premium table / live board v3”
- earlier embedded board-area path
- direct NBL frame overrides

This is why the board body is still fragile.

### What currently comes from `noBrainerLab.css`

`noBrainerLab.css` still supplies the base shape and semantics of:

- `.nbl-stage`
- `.nbl-board-frame`
- `.nbl-board-frame::after`
- `.nbl-board-canvas`
- `.nbl-board-watermark`
- `.nbl-board-toolbar`

The production board uses these classes through `MatchNblBoardFrame`, even outside Practice.

This is both:

- naming debt
- real dependency

### What currently comes from `dailyFritzMatchBoard.css`

`dailyFritzMatchBoard.css` does **not** own shared shell structure.

It currently acts as a mode skin layer for Daily Fritz:

- `.bot-match-mode-daily-fritz .walnut-nbl-stage .nbl-board-frame`
- `.nbl-board-canvas::before`
- `.nbl-board-watermark`
- control/meta pill visual accents

This is mostly surface/skin, not layout structure.

### What currently comes from `match-standard-live-board.css`

This file is effectively the closest thing to the shared board-shell prototype for:

- Daily Puzzle
- Practice
- other `rh-standard-live-board` screens

It owns:

- `.rh-live-studio-shell`
- `.rh-live-board-zone`
- relationship to `.wl-stage-shell`, `.nbl-stage`, `.nbl-board-frame`
- `.nbl-board-canvas` surface rules
- `.nbl-board-watermark`
- some board-meta/control placement

This is the strongest candidate source for future shared board shell/body migration patterns.

### What currently comes from `match-board-architecture.css`

This file owns older architectural embedding around:

- `.rh-match-playfield-card`
- `.wl-stage-shell`
- `.walnut-nbl-stage`, `.nbl-stage`
- `.nbl-board-frame`
- `.rh-board-meta-bar`
- `.rh-board-toolbar`

This is active for older `client/src/match/InGameBoardShell.tsx` consumers, especially Daily Puzzle / Practice / some guided layouts.

It is structural, but not yet the canonical source.

## D. NBL dependency analysis

### Why production board uses NBL naming

The live production board is wrapped by:

- `client/src/components/MatchNblBoardFrame.tsx`
- older `client/src/match/InGameBoardShell.tsx` embedded frame

Both deliberately import `../practice/noBrainerLab.css` and emit:

- `.nbl-stage`
- `.walnut-nbl-stage`
- `.nbl-board-frame`
- `.nbl-board-canvas`
- `.nbl-board-watermark`

So the live board is not merely “inspired by NBL”; it directly reuses the NBL frame component and its CSS.

### Is this just naming debt or actual Practice-mode coupling?

It is both.

Naming debt:

- `nbl-*` is clearly the wrong long-term semantic name for shared production board primitives.

Actual coupling:

- removing or renaming those classes would immediately affect bot, Daily Fritz, Daily Puzzle, and Practice surfaces.
- multiple CSS files depend on them, not just Practice.

### What is risky about changing/removing it

- `MatchNblBoardFrame` is used in the active bot route.
- older `InGameBoardShell` also emits the same NBL frame.
- `walnut-live.css`, `match-standard-live-board.css`, `match-board-architecture.css`, `match-hud-polish.css`, `dailyFritzMatchBoard.css`, and `noBrainerLab.css` all target NBL selectors.
- renaming without a compatibility layer would break board surface rendering across several modes.

### Should we eventually migrate it to a neutral board frame?

Yes.

Recommended end state:

- neutral shared frame component
- neutral class namespace
  - example: `.rh-board-frame`, `.rh-board-canvas`, `.rh-board-watermark`
- compatibility bridge phase where old `nbl-*` classes coexist

But this should happen only after shell/body ownership is more consolidated and selector consumers are mapped.

## E. Structure vs skin split

### `board-shell.css`

Should eventually own:

- `.rh-live-studio-shell`
- `.rh-live-board-zone`
- `.wl-stage-shell` as a shared shell-stage wrapper
- relationship between shell and embedded frame wrappers
- possibly `.rh-match-playfield-card` later, once older shell architecture is addressed

Structure examples:

- `flex`
- `min-height`
- `display`
- `flex-direction`
- `gap`
- `position`
- `overflow` where used as layout containment
- wrapper `padding` only if it is structural, not decorative frame inset

### `board-surface.css`

Should eventually own:

- `.nbl-board-frame`
- `.nbl-board-canvas`
- `.nbl-board-watermark`
- `.board-area.wl-board-area` surface identity where still needed
- shell frame pseudo-elements used for board bezel/surface

Surface examples:

- `border`
- `border-radius`
- `background`
- `box-shadow`
- watermark opacity/size
- grid/texture/watermark layers
- inset frame pseudo-elements

### `board-meta.css`

Should eventually own:

- `.rh-board-meta-bar`
- `.board-corner-pill`
- `.open-ends-pill`
- `.boneyard-pill`

### `board-controls.css`

Should eventually own:

- `.board-zoom-tray`
- `.wl-controls-tray`
- `.control-pill` board-control alignment

### `skins/racehorse-matte.css`

Should eventually own:

- black matte / gold-brass final visual identity values
- mode-specific accent variables
- branded board color/glow/shadow values

### Leave in legacy for now

- `dailyFritzMatchBoard.css` mode-specific surface accents
- `shared-ui.css` lesson board area rules
- `match-hud-polish.css` generic NBL frame visual polish
- broader `.wl-board-area` legacy surface rules
- hand dock rules
- any `board-area`/lesson hybrid paths

## F. Recommended first board-body migration batch

### Safest first no-visual-change batch

Move only shared wrapper structure rules first:

1. `.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-studio-shell`
2. `.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone`
3. `.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .wl-stage-shell`
4. `.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .wl-stage-shell,
   .screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .walnut-nbl-stage,
   .screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .nbl-stage,
   .screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .nbl-board-frame`

Why these first:

- they are already the cleanest shared shell/body contract
- they map directly to `InGameBoardFrame` / older `InGameBoardShell` wrapper boundaries
- they are less entangled with bot-only surface visuals than the `walnut-live.css` bot route copies
- they can move to `board-shell.css` without forcing NBL surface migration yet

### Candidate structure-only subset

If even narrower is preferred, move only the declarations that are clearly structural:

- on `.rh-live-studio-shell`
  - `flex: 1 1 0`
  - `min-height: 0`
  - `display: flex`
  - `flex-direction: column`
  - `gap: 14px`
  - `position: relative`
  - `overflow: hidden`

- on `.rh-live-board-zone`
  - `flex: 1 1 0`
  - `min-height: 0`
  - `position: relative`

- on `.rh-live-board-zone .wl-stage-shell`
  - `flex: 1 1 0`
  - `min-height: 0`
  - `padding: 0 !important`
  - `overflow: visible`

- on the grouped embedded frame selector
  - `width: 100% !important`
  - `height: 100%`
  - `padding: 0 !important`

Leave border radius / background / border / box-shadow behind for now if we want a purer structure batch.

## G. Rules not to move yet

Do not move yet:

- `.nbl-board-frame`
- `.nbl-board-frame::before`
- `.nbl-board-frame::after`
- `.nbl-board-canvas`
- `.nbl-board-canvas::before`
- `.nbl-board-watermark`
- `.board-area.wl-board-area`
- `.rh-live-hand-deck`
- `.wl-hand-area`
- `.tray-rail`
- `.rh-board-meta-bar`
- `.board-corner-pill`
- `.board-zoom-tray`
- `.wl-controls-tray`
- `dailyFritzMatchBoard.css` mode-specific frame/canvas overrides
- lesson-specific `.learn-lesson-board-area` descendants
- `match-hud-polish.css` generic `.nbl-board-frame` visual polish until NBL surface ownership is better isolated

These are either:

- visual surface skin
- hand dock ownership
- metadata/control ownership
- mode-specific overrides
- lesson/older-path compatibility rules

## H. Risk assessment

### Daily Fritz

- High sensitivity.
- Uses shared shell wrappers from `match/board`, but still depends on `MatchNblBoardFrame` + NBL classes for the actual board surface.
- Also has Daily Fritz-specific surface overrides in `dailyFritzMatchBoard.css`.

### Regular Play vs Fritz

- High sensitivity.
- Same shell/body path as Daily Fritz, minus Daily Fritz mode accents.
- `walnut-live.css` bot route rules still dominate.

### Ghost/bot match

- High sensitivity.
- Same active path as Play vs Fritz.

### Puzzle

- Medium sensitivity.
- Uses older `client/src/match/InGameBoardShell.tsx`.
- `match-standard-live-board.css` and `match-board-architecture.css` are more relevant than bot-route `walnut-live.css`.

### Practice / No Brainer Lab

- High sensitivity for NBL frame selectors.
- This is the source namespace of the shared frame, so changing NBL selectors too early can break Practice immediately.

### Learn / Guided Match

- Medium/high sensitivity.
- Has hybrid shell/body ownership and lesson-specific board-area rules.
- Not in scope for the first migration batch.

### Narrow / short viewport layout

- Medium sensitivity.
- Shell wrappers and stage wrappers participate in height compression and viewport containment.
- Any migration involving `min-height`, `flex`, `overflow`, or stage wrapper padding needs a smoke check across:
  - desktop
  - laptop
  - narrow landscape
  - short-height viewport

## I. Recommended Patch 15

Recommended Patch 15:

- migrate `.rh-live-studio-shell` and `.rh-live-board-zone` **structure only** into `client/src/styles/board/board-shell.css`
- use `match-standard-live-board.css` as the first source batch, not `walnut-live.css`
- leave all NBL frame/canvas/watermark surface rules untouched
- leave meta/controls untouched
- leave hand dock untouched

Why:

- this is the smallest safe board-body migration that advances the shared architecture
- it avoids prematurely touching the NBL surface coupling
- it avoids bot-mode-only CSS until the shared shell contract is more stable

Not recommended yet:

- migrating `.nbl-board-frame` / `.nbl-board-canvas`
- migrating `.board-area.wl-board-area`
- migrating `.rh-board-meta-bar` / controls
- renaming NBL classes

If you want one more proof step before migration, the alternative Patch 15 is:

- a focused audit of all current winning `.rh-live-studio-shell` / `.rh-live-board-zone` declarations across `walnut-live.css` vs `match-standard-live-board.css`
- then migrate the shared rh-standard-live-board structure first

