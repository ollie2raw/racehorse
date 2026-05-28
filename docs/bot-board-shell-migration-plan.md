# Bot Board Shell Migration Plan

## A. Current bot-route shell DOM path

### Active bot / Daily Fritz / ghost board path

- Component: `client/src/bot/BotMatchScreen.tsx`
- Shared wrapper: `client/src/match/board/InGameBoardShell.tsx`
- Shared frame: `client/src/match/board/InGameBoardFrame.tsx`
- Board frame wrapper: `client/src/components/MatchNblBoardFrame.tsx`
- Board renderer: `client/src/components/Board.tsx`

### Emitted class path

1. `.screen.game-screen.walnut-live.bot-match-screen.bot-match-mode-*`
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

### Modes affected

- Daily Fritz
- regular Play vs Fritz
- ghost/bot match

Excluded from this migration:

- Learn / Guided lesson layout branch
- Daily Puzzle / Practice `rh-standard-live-board` path

## B. Candidate bot shell rules

### 1. Older bot shell pass

- Source file: `client/src/styles/walnut-live.css`
- Location: around line `2236`
- Selectors:
  - `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-studio-shell`
  - `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone`
  - `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .wl-stage-shell, ... .walnut-nbl-stage, ... .nbl-stage, ... .nbl-board-frame`
- Rule bodies:

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-studio-shell {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  position: relative;
  overflow: hidden;
}

.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone {
  flex: 1 1 0;
  min-height: 0;
  position: relative;
  border-radius: 34px;
  padding: 12px;
  border: 1px solid rgba(88, 166, 255, 0.16);
  background: rgba(4, 10, 19, 0.86);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 30px 88px rgba(0, 0, 0, 0.44);
}

.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .wl-stage-shell,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .walnut-nbl-stage,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .nbl-stage,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .nbl-board-frame {
  width: 100% !important;
  height: 100%;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 24px !important;
  background: transparent !important;
  box-shadow: none !important;
}
```

- Status:
  - stale / superseded by later pass for overlapping declarations
- Classification:
  - mixed structure + visual shell skin

### 2. Current winning bot shell pass

- Source file: `client/src/styles/walnut-live.css`
- Location: around line `2579`
- Selectors:
  - `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-studio-shell`
  - `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone`
  - `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .wl-stage-shell, ... .walnut-nbl-stage, ... .nbl-stage, ... .nbl-board-frame`
- Rule bodies:

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-studio-shell {
  gap: 12px;
}

.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone {
  padding: 0;
  border: 0;
  border-radius: 30px;
  background: rgba(6, 12, 22, 0.7);
  box-shadow:
    0 24px 70px rgba(0, 0, 0, 0.34),
    inset 0 0 0 1px rgba(88, 166, 255, 0.12);
}

.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone::before,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone::after {
  content: none;
}

.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .wl-stage-shell,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .walnut-nbl-stage,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .nbl-stage,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .nbl-board-frame {
  border-radius: 30px !important;
}
```

- Status:
  - active / winning for overlapping declarations
- Classification:
  - mostly visual shell skin
  - one structural value: `gap: 12px`

### 3. Supporting stage-shell rule outside `.rh-live-board-zone`

- Source file: `client/src/styles/walnut-live.css`
- Location: around line `1890`
- Selector:
  - `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-stage-shell`
- Rule body:

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-stage-shell {
  padding: 0 !important;
  border-radius: 28px 28px 0 0;
  overflow: visible;
}
```

- Status:
  - active support rule
- Classification:
  - mixed
  - `padding: 0 !important` and `overflow: visible` are structural
  - `border-radius` is visual shell

### 4. Supporting stage-wrapper overflow rule

- Source file: `client/src/styles/walnut-live.css`
- Location: around line `1896`
- Selector:
  - `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-nbl-stage,`
  - `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .nbl-stage`
- Rule body:

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-nbl-stage,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .nbl-stage {
  overflow: visible;
}
```

- Status:
  - active supporting structural rule
- Classification:
  - structure/layout containment

### 5. Related files checked with no direct ownership of these exact selectors

- `client/src/bot/botMatch.css`
  - no direct `.rh-live-studio-shell` / `.rh-live-board-zone` rules
- `client/src/dailyFritz/dailyFritzMatchBoard.css`
  - no direct `.rh-live-studio-shell` / `.rh-live-board-zone` rules
  - only deeper NBL surface and meta/control styling

## C. Declaration classification

### `.rh-live-studio-shell`

From older pass:

- `flex: 1 1 0;` → move to `board-shell.css`
- `min-height: 0;` → move to `board-shell.css`
- `display: flex;` → move to `board-shell.css`
- `flex-direction: column;` → move to `board-shell.css`
- `gap: 14px;` → superseded by later `gap: 12px`; do not move this value
- `position: relative;` → move to `board-shell.css`
- `overflow: hidden;` → move to `board-shell.css`

From current winning pass:

- `gap: 12px;` → move to `board-shell.css`

### `.rh-live-board-zone`

From older pass:

- `flex: 1 1 0;` → move to `board-shell.css`
- `min-height: 0;` → move to `board-shell.css`
- `position: relative;` → move to `board-shell.css`
- `border-radius: 34px;` → leave in `walnut-live.css`
- `padding: 12px;` → superseded by later `padding: 0`; do not move this value
- `border: ...` → leave in `walnut-live.css`
- `background: ...` → leave in `walnut-live.css`
- `box-shadow: ...` → leave in `walnut-live.css`

From current winning pass:

- `padding: 0;` → leave in `walnut-live.css` for now
  - reason: ambiguous between structure reset and shell visual framing
- `border: 0;` → leave in `walnut-live.css`
- `border-radius: 30px;` → leave in `walnut-live.css`
- `background: ...` → leave in `walnut-live.css`
- `box-shadow: ...` → leave in `walnut-live.css`

### `.rh-live-board-zone .wl-stage-shell`

From supporting rule:

- `padding: 0 !important;` → move to `board-shell.css`
- `border-radius: 28px 28px 0 0;` → leave in `walnut-live.css`
- `overflow: visible;` → move to `board-shell.css`

### Grouped relationship rule for `.wl-stage-shell`, `.walnut-nbl-stage`, `.nbl-stage`, `.nbl-board-frame`

From older pass:

- `width: 100% !important;` → move to `board-shell.css`
- `height: 100%;` → move to `board-shell.css`
- `padding: 0 !important;` → move to `board-shell.css`
- `border: 0 !important;` → leave in `walnut-live.css`
- `border-radius: 24px !important;` → leave in `walnut-live.css`
- `background: transparent !important;` → leave in `walnut-live.css`
- `box-shadow: none !important;` → leave in `walnut-live.css`

### `.walnut-nbl-stage, .nbl-stage`

From supporting overflow rule:

- `overflow: visible;` → move to `board-shell.css`

## D. Conflict/cascade analysis

### Current winners

For the active non-lesson bot route:

- `.rh-live-studio-shell`
  - base structure comes from older pass at `2236`
  - winning `gap` comes from later pass at `2579`
- `.rh-live-board-zone`
  - structure base comes from older pass at `2246`
  - current shell visual reset comes from later pass at `2583`
- `.wl-stage-shell`
  - active support rule at `1890` still participates
- `.walnut-nbl-stage, .nbl-stage`
  - active overflow support rule at `1896` still participates
- grouped relationship rule for `.wl-stage-shell`, `.walnut-nbl-stage`, `.nbl-stage`, `.nbl-board-frame`
  - older pass at `2283` still participates for `width`, `height`, `padding`, and visual resets
  - later pass at `2598` only overrides `border-radius`

### Stale vs participating

Older pass is not fully dead.

Still participating from older bot shell pass:

- `.rh-live-studio-shell`
  - `flex`, `min-height`, `display`, `flex-direction`, `position`, `overflow`
- `.rh-live-board-zone`
  - `flex`, `min-height`, `position`
- grouped relationship rule
  - `width`, `height`, `padding`
- separate `wl-stage-shell` support rule
  - `padding`, `overflow`
- separate `.walnut-nbl-stage, .nbl-stage`
  - `overflow`

Superseded from older pass:

- `.rh-live-studio-shell gap: 14px` superseded by `gap: 12px`
- `.rh-live-board-zone padding: 12px` superseded by `padding: 0`
- `.rh-live-board-zone` visual frame skin superseded by later shell skin
- grouped `border-radius: 24px !important` superseded by later `border-radius: 30px !important`

### Daily Fritz interaction

`dailyFritzMatchBoard.css` does not override these exact wrapper selectors.
It starts deeper:

- `.walnut-nbl-stage .nbl-board-frame`
- `.nbl-board-canvas::before`
- `.nbl-board-watermark`
- controls/meta pill visual rules

So the bot shell wrappers are shared across:

- Daily Fritz
- Play vs Fritz
- ghost/bot match

## E. Proposed Patch 17 migration batch

### Safest actual migration batch

Move only these structure/layout declarations into `board-shell.css` under the bot-route selector set:

#### 1. `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-studio-shell`

Move:

- `flex: 1 1 0;`
- `min-height: 0;`
- `display: flex;`
- `flex-direction: column;`
- `position: relative;`
- `overflow: hidden;`
- `gap: 12px;`

Method:

- split across the two old/new source rules
- canonicalize as one structure owner in `board-shell.css`

#### 2. `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone`

Move:

- `flex: 1 1 0;`
- `min-height: 0;`
- `position: relative;`

Leave:

- `padding: 0;`
- `border: 0;`
- `border-radius: 30px;`
- `background: ...`
- `box-shadow: ...`

#### 3. `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-stage-shell`

Move:

- `padding: 0 !important;`
- `overflow: visible;`

Leave:

- `border-radius: 28px 28px 0 0;`

#### 4. Grouped relationship rule

Selector:

- `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .wl-stage-shell`
- `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .walnut-nbl-stage`
- `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .nbl-stage`
- `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-board-zone .nbl-board-frame`

Move:

- `width: 100% !important;`
- `height: 100%;`
- `padding: 0 !important;`

Leave:

- `border: 0 !important;`
- `border-radius: 30px !important;`
- `background: transparent !important;`
- `box-shadow: none !important;`

#### 5. Supporting stage wrapper rule

Selector:

- `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-nbl-stage,`
- `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .nbl-stage`

Move:

- `overflow: visible;`

### Why this batch

- mirrors what was already done safely for `rh-standard-live-board`
- avoids touching any NBL frame/canvas visual styling
- avoids touching bot hand dock, meta, or controls
- captures the real layout ownership currently spread across multiple stale/current passes

## F. Source handling

### `.rh-live-studio-shell`

- move structure declarations into `board-shell.css`
- delete those moved declarations from the older source block
- delete the later `gap: 12px` override block only if the selector becomes empty after migration
- if later block still contains other declarations, preserve remaining declarations only

### `.rh-live-board-zone`

- split structure vs skin
- move only `flex`, `min-height`, `position`
- leave current visual shell declarations in `walnut-live.css`

### `.wl-stage-shell`

- split structure vs skin
- move `padding: 0 !important;` and `overflow: visible;`
- leave `border-radius`

### Grouped relationship rule

- split structure vs visual reset
- move `width`, `height`, `padding`
- leave `border`, `border-radius`, `background`, `box-shadow`

### `.walnut-nbl-stage, .nbl-stage`

- move `overflow: visible;` into `board-shell.css`
- delete source copy if no declarations remain

## G. Risks

### Daily Fritz active match

- Medium risk
- uses this exact shell path
- but no direct Daily Fritz overrides exist on these wrapper selectors

### Play vs Fritz active match

- Medium risk
- same active shell path

### Ghost/bot match

- Medium risk
- same active shell path

### Narrow viewport

- Medium risk
- wrapper `flex`, `min-height`, `overflow`, and stage padding all affect fit/compression

### Short-height viewport

- Medium risk
- wrapper containment matters for vertical fit even though the short-height rules mostly target HUD/tray

### Learn / Guided exclusion

- Low risk if scope is followed
- these selectors explicitly exclude `.learn-lesson-screen`

### Puzzle / Practice non-impact

- Low risk
- Patch 17 would touch only bot-route selectors in `walnut-live.css`
- `rh-standard-live-board` rules already migrated separately

## H. Browser verification checklist

### Routes

- Daily Fritz active match
- regular Play vs Fritz active match
- ghost/bot match if available

### Viewports

- desktop wide
- laptop
- narrow landscape
- short-height viewport

### What to inspect

- `.rh-live-studio-shell`
  - still stretches full remaining height
  - same gap between board zone and hand deck
- `.rh-live-board-zone`
  - still fills available match body space
  - no collapse or unintended scroll
- `.wl-stage-shell`
  - still flush to board shell with no padding reintroduced
  - no clipping of zoom tray or placement zones
- `.walnut-nbl-stage` / `.nbl-stage`
  - overflow still allows board overlays/geometry to breathe

### Non-impact smoke checks

- Learn / Guided route: unchanged
- Daily Puzzle / Practice: unchanged

## I. Recommended Patch 17

Yes, I recommend doing the migration next.

Recommended Patch 17:

- structure-only migration of the active bot-route shell wrappers into `board-shell.css`
- specifically:
  - `.rh-live-studio-shell` structure + winning `gap: 12px`
  - `.rh-live-board-zone` structure only
  - `.wl-stage-shell` structural reset (`padding`, `overflow`)
  - grouped embedded-frame relationship rule (`width`, `height`, `padding`)
  - `.walnut-nbl-stage, .nbl-stage { overflow: visible; }`

Do **not** move next:

- `.rh-live-board-zone` visual shell skin
- `border-radius`
- pseudo-elements
- any `.nbl-board-frame`, `.nbl-board-canvas`, `.nbl-board-watermark`
- meta/control rules
- hand dock rules

