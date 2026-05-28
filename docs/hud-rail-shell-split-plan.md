# HUD Rail Shell Split Plan

Scope: planning-only audit for splitting the current winning full HUD rail shell rules into:

1. shared HUD structure/layout for `client/src/styles/board/board-hud.css`
2. visual skin that should remain legacy for now or later move to `client/src/styles/board/skins/racehorse-matte.css`

This document does not move selectors yet.

## A. Current full rail shell rules

## 1. Generic base rail shell

- Source file:
  - `client/src/styles/walnut-live.css`
- Current location:
  - line `93`
- Selector:
  ```css
  .wl-top-rail
  ```
- Full rule body:
  ```css
  .wl-top-rail {
    display: grid;
    width: 100%;
    max-width: none;
    margin: 0;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 12px;
    min-height: var(--match-hud-min-height, 92px);
    padding: 12px 16px 9px;
    box-sizing: border-box;
  }
  ```
- Status:
  - `generic`

## 2. Generic game-screen rail shell

- Source file:
  - `client/src/styles/walnut-live.css`
- Current location:
  - line `1369`
- Selector:
  ```css
  .screen.game-screen.walnut-live .wl-top-rail,
  .screen.game-screen.walnut-live .bot-top-rail
  ```
- Full rule body:
  ```css
  .screen.game-screen.walnut-live .wl-top-rail,
  .screen.game-screen.walnut-live .bot-top-rail {
    width: 100% !important;
    max-width: none !important;
    margin: 0 !important;
    box-sizing: border-box;
    min-height: var(--match-hud-min-height, 92px);
    padding: 12px 16px 9px !important;
    background: rgba(7, 12, 22, 0.96) !important;
    border-bottom: 1px solid rgba(110, 132, 170, 0.2);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 8px 20px rgba(0, 0, 0, 0.12);
  }
  ```
- Status:
  - `generic`
- Notes:
  - this is a shared shell layer across walnut-live game screens

## 3. Large-mode generic rail shell adjustment

- Source file:
  - `client/src/styles/walnut-live.css`
- Current location:
  - line `1469`
- Selector:
  ```css
  .app.large-mode .screen.game-screen.walnut-live .wl-top-rail,
  .app.large-mode .screen.game-screen.walnut-live .bot-top-rail
  ```
- Full rule body:
  ```css
  .app.large-mode .screen.game-screen.walnut-live .wl-top-rail,
  .app.large-mode .screen.game-screen.walnut-live .bot-top-rail {
    min-height: var(--match-hud-min-height, 92px) !important;
    gap: 12px !important;
  }
  ```
- Status:
  - `generic`

## 4. Older non-lesson bot-match HUD shell pass

- Source file:
  - `client/src/styles/walnut-live.css`
- Current location:
  - line `1772`
- Selector:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-top-rail,
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-top-rail
  ```
- Full rule body:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-top-rail,
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-top-rail {
    min-height: var(--match-hud-min-height, 118px) !important;
    padding: 14px 22px !important;
    border: 1px solid rgba(88, 166, 255, 0.16);
    border-radius: 22px;
    background: rgba(5, 10, 19, 0.94) !important;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.05),
      inset 0 -1px 0 rgba(88, 166, 255, 0.08),
      0 20px 54px rgba(0, 0, 0, 0.42);
  }
  ```
- Status:
  - `stale`

## 5. Later non-lesson bot-match HUD shell pass

- Source file:
  - `client/src/styles/walnut-live.css`
- Current location:
  - line `2156`
- Selector:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-top-rail,
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-top-rail
  ```
- Full rule body:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-top-rail,
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-top-rail {
    min-height: 104px !important;
    padding: 0 !important;
    border: 0;
    border-radius: 0;
    background: transparent !important;
    box-shadow: none !important;
    overflow: visible;
  }
  ```
- Status:
  - `stale but still participating`
- Notes:
  - some declarations here are still effectively part of the current end result unless overridden later

## 6. Current winning non-lesson bot-match rail shell rule

- Source file:
  - `client/src/styles/walnut-live.css`
- Current location:
  - line `2480`
- Selector:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-top-rail,
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-top-rail
  ```
- Full rule body:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-top-rail,
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-top-rail {
    display: grid !important;
    grid-template-columns: minmax(420px, 1fr) auto minmax(220px, 1fr) !important;
    align-items: center !important;
    min-height: 82px !important;
    padding: 0 !important;
    gap: 22px !important;
    background: transparent !important;
    border: 0 !important;
    box-shadow: none !important;
  }
  ```
- Status:
  - `active/winning`

## 7. Bot-match base rail shell

- Source file:
  - `client/src/bot/botMatch.css`
- Current location:
  - line `43`
- Selector:
  ```css
  .bot-match-screen .bot-top-rail
  ```
- Full rule body:
  ```css
  .bot-match-screen .bot-top-rail {
    display: grid !important;
    grid-template-columns: 1fr auto 1fr !important;
    align-items: center !important;
    gap: 12px !important;
    width: 100% !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 10px 16px 8px !important;
    box-sizing: border-box;
    position: relative !important;
    min-height: 92px !important;
    background: rgba(7, 12, 22, 0.96) !important;
    border-bottom: 1px solid rgba(110, 132, 170, 0.16);
  }
  ```
- Status:
  - `base but partially superseded on active non-lesson bot routes`

## 8. Small global rail-shell adjustments

### a. `match-hud-polish.css`

- Source file:
  - `client/src/styles/match-hud-polish.css`
- Current location:
  - line `108`
- Selector:
  ```css
  .screen.game-screen.walnut-live .wl-top-rail,
  .screen.game-screen.walnut-live .bot-top-rail,
  .app.large-mode .screen.game-screen.walnut-live .wl-top-rail,
  .app.large-mode .screen.game-screen.walnut-live .bot-top-rail
  ```
- Full rule body:
  ```css
  .screen.game-screen.walnut-live .wl-top-rail,
  .screen.game-screen.walnut-live .bot-top-rail,
  .app.large-mode .screen.game-screen.walnut-live .wl-top-rail,
  .app.large-mode .screen.game-screen.walnut-live .bot-top-rail {
    min-height: var(--match-hud-min-height, 86px);
    padding-bottom: 7px !important;
  }
  ```
- Status:
  - `generic helper`

### b. `match-hud-polish.css`

- Source file:
  - `client/src/styles/match-hud-polish.css`
- Current location:
  - line `225`
- Selector:
  ```css
  .wl-top-rail
  ```
- Full rule body:
  ```css
  .wl-top-rail {
    grid-template-columns: auto 1fr auto;
  }
  ```
- Status:
  - `generic helper`

## 9. Daily Fritz mode accent

- Source file:
  - `client/src/dailyFritz/dailyFritzMatchBoard.css`
- Current location:
  - line `31`
- Selector:
  ```css
  .bot-match-screen.bot-match-mode-daily-fritz .bot-top-rail
  ```
- Full rule body:
  ```css
  .bot-match-screen.bot-match-mode-daily-fritz .bot-top-rail {
    border-bottom-color: rgba(231, 182, 74, 0.14) !important;
  }
  ```
- Status:
  - `mode-specific`

## B. Declaration classification

Classification applies to the current winning rule at `client/src/styles/walnut-live.css:2480`.

Current winning rule:

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-top-rail,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-top-rail {
  display: grid !important;
  grid-template-columns: minmax(420px, 1fr) auto minmax(220px, 1fr) !important;
  align-items: center !important;
  min-height: 82px !important;
  padding: 0 !important;
  gap: 22px !important;
  background: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
}
```

### Structure/layout: should eventually move to `board-hud.css`

- `display: grid !important;`
- `grid-template-columns: minmax(420px, 1fr) auto minmax(220px, 1fr) !important;`
- `align-items: center !important;`
- `min-height: 82px !important;`
- `padding: 0 !important;`
- `gap: 22px !important;`

Reason:

- all are rail composition / slot-sizing / vertical rhythm decisions

### Visual skin: should eventually move to `racehorse-matte.css` or remain legacy until redesign

- `background: transparent !important;`
- `border: 0 !important;`
- `box-shadow: none !important;`

Reason:

- these declarations define the current visual shell treatment, not just structure
- they participate in how the rail looks relative to the page background and matte shell identity

### Ambiguous: needs caution

For the current winning rule itself:

- none are strongly ambiguous

But across the full shell stack, these related declarations are ambiguous and should be treated carefully:

- `overflow: visible;` from the earlier stale rule at line `2156`
- `position: relative` when present in base bot rail rule
- any future `z-index` or `isolation` declarations that affect layered status chips

These are structure-adjacent but can affect visual layering and overlap behavior.

## C. Split strategy options

## Option 1

Move the entire current winning rail shell rule to `board-hud.css` unchanged.

### Pros

- simplest implementation
- exact selector/value parity
- one clear shared owner for the active bot rail shell winner

### Cons

- mixes structure and skin in the canonical base HUD file
- weakens the long-term architecture by putting visual shell identity into `board-hud.css`
- makes later matte/brass skin extraction harder

## Option 2

Split the current winning rule now:

- structure declarations to `board-hud.css`
- visual declarations remain in legacy for now, or later move to `racehorse-matte.css`

### Pros

- matches the target architecture cleanly
- creates a real distinction between shared HUD layout and mode/skin surface treatment
- keeps `board-hud.css` focused on composition ownership

### Cons

- requires careful source-order handling so partial rule movement does not change computed output
- more moving pieces than Option 1
- must account for older upstream rules that still supply visual values

## Option 3

Leave the full rail shell in legacy for now and migrate board shell/body next instead.

### Pros

- avoids touching one of the most layered visible regions
- board shell/body may have cleaner ownership seams in some places

### Cons

- leaves HUD ownership fragmented longer
- delays progress on the shared `InGameBoardHud.tsx` boundary that already exists
- the HUD skeleton has already started migrating, so stopping now leaves that work half-finished

## D. Import-order/cascade risk

Current order:

- `walnut-live.css`
- `match-hud-polish.css`
- `match-board-architecture.css`
- later `board/index.css`

Implications:

- any rule added to `board-hud.css` will load after the legacy stack
- if a selector is copied exactly and the old source is removed, the migrated rule becomes the winner
- if only part of a mixed rule is moved, the remaining declarations in `walnut-live.css` still apply earlier, and the new later declarations in `board-hud.css` can safely override only the moved properties

### Option 1 risk

- low parity risk
- high architecture debt risk

### Option 2 risk

- manageable parity risk if the split uses:
  - same selectors
  - exact declaration values
  - no change to unrelated declarations
- best long-term architecture outcome

### Option 3 risk

- no immediate cascade risk
- highest delay/ownership fragmentation cost

## E. Recommended Patch 11

Recommended next patch:

- **Option 2: split structure vs skin**

Why:

- Patch 9 already established `board-hud.css` as the owner for HUD slot placement
- the next logical step is to move only the structural rail-shell declarations into `board-hud.css`
- this preserves the architecture direction without prematurely moving the rail’s visual treatment

## F. Exact proposed Patch 11 if recommended

### Selectors to add to `board-hud.css`

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-top-rail,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-top-rail
```

### Declarations to move into `board-hud.css`

```css
display: grid !important;
grid-template-columns: minmax(420px, 1fr) auto minmax(220px, 1fr) !important;
align-items: center !important;
min-height: 82px !important;
padding: 0 !important;
gap: 22px !important;
```

### Declarations to leave behind in legacy for now

Keep in `walnut-live.css` under the same selector:

```css
background: transparent !important;
border: 0 !important;
box-shadow: none !important;
```

### Source rule handling

Do **not** delete the whole source rule in one shot.

Instead:

- split the existing source block in `walnut-live.css`
- leave only the visual declarations there
- move only the structural declarations into `board-hud.css`

### Temporary duplicate needed?

- No full duplicate needed if the split is done carefully.
- The same selector can exist in both files:
  - structure declarations in `board-hud.css`
  - visual declarations left in `walnut-live.css`
- Because `board-hud.css` loads later, moved structural declarations will remain authoritative without changing the visual declarations left behind.

## G. Browser verification checklist

### Routes

- `#/daily-fritz` active match
- regular Play vs Fritz active match
- ghost/bot match if available
- Learn / Guided Match smoke check
- Daily Puzzle smoke check
- Practice / No Brainer Lab smoke check

### Viewports

- desktop wide
- laptop
- narrow viewport
- short-height viewport

### What to inspect

On active non-lesson bot routes:

- rail remains 3-column grid
- left / center / right alignment remains unchanged
- rail height remains unchanged
- rail padding remains unchanged
- rail gap remains unchanged
- visual treatment still appears identical because the `background/border/box-shadow` declarations are still coming from legacy

On non-bot routes:

- no change expected

On lesson/guided route:

- no change expected

