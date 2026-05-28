# Stale HUD Rail Shell Deletion Proof

Scope: proof-only audit for the two older full HUD rail shell passes still remaining in `client/src/styles/walnut-live.css` after the current winning rail shell was split into:

- structure in `client/src/styles/board/board-hud.css`
- visual shell declarations in `client/src/styles/walnut-live.css`

This document does not delete the rules yet.

## A. Exact stale rail shell rule locations

## Stale block 1: earlier heavy HUD pass

- File path:
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
- Surrounding context:
  - immediately follows the first large bot-match cockpit ambient shell pass
  - before `.wl-top-rail::before` decorative inner frame
  - clearly part of an older “heavy card” HUD treatment

## Stale block 2: later transparent/reset pass

- File path:
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
- Surrounding context:
  - inside the later “Racehorse live board v2” cockpit section
  - before later cluster/slot positioning rules
  - part of a later pass that flattened the HUD card into a transparent shell

## Current split winners

### Structure owner

- File:
  - `client/src/styles/board/board-hud.css`
- Current location:
  - line `49`
- Selector:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-top-rail,
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-top-rail
  ```
- Rule body:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-top-rail,
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-top-rail {
    display: grid !important;
    grid-template-columns: minmax(420px, 1fr) auto minmax(220px, 1fr) !important;
    align-items: center !important;
    min-height: 82px !important;
    padding: 0 !important;
    gap: 22px !important;
  }
  ```

### Visual owner

- File:
  - `client/src/styles/walnut-live.css`
- Current location:
  - line `2480`
- Selector:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-top-rail,
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-top-rail
  ```
- Rule body:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-top-rail,
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-top-rail {
    background: transparent !important;
    border: 0 !important;
    box-shadow: none !important;
  }
  ```

## B. Why each block is stale or still participating

## Stale block 1: declaration analysis

### `min-height: var(--match-hud-min-height, 118px) !important;`

- Status:
  - superseded by current structure owner
- Current winner:
  - `min-height: 82px !important;` in `board-hud.css`

### `padding: 14px 22px !important;`

- Status:
  - superseded by current structure owner
- Current winner:
  - `padding: 0 !important;` in `board-hud.css`

### `border: 1px solid rgba(88, 166, 255, 0.16);`

- Status:
  - superseded by current visual owner
- Current winner:
  - `border: 0 !important;` in `walnut-live.css` line `2480`

### `border-radius: 22px;`

- Status:
  - potentially still participating
- Why:
  - no later rule in the same selector family explicitly overrides `border-radius`
  - current split owner does not define `border-radius`
- Risk:
  - if the rail still computes `border-radius: 22px`, deleting this block could change shape

### `background: rgba(5, 10, 19, 0.94) !important;`

- Status:
  - superseded by current visual owner
- Current winner:
  - `background: transparent !important;`

### `box-shadow: ...`

- Status:
  - superseded by current visual owner
- Current winner:
  - `box-shadow: none !important;`

## Stale block 2: declaration analysis

### `min-height: 104px !important;`

- Status:
  - superseded by current structure owner
- Current winner:
  - `min-height: 82px !important;`

### `padding: 0 !important;`

- Status:
  - duplicated by current structure owner
- Current winner:
  - `padding: 0 !important;`

### `border: 0;`

- Status:
  - superseded by current visual owner
- Current winner:
  - `border: 0 !important;`

### `border-radius: 0;`

- Status:
  - potentially still participating
- Why:
  - no later split owner currently sets `border-radius`
  - this may be the live winner that neutralizes the earlier `border-radius: 22px`
- Risk:
  - deleting this block without replacing `border-radius: 0` somewhere later could reintroduce the earlier rounded shape

### `background: transparent !important;`

- Status:
  - duplicated by current visual owner
- Current winner:
  - `background: transparent !important;`

### `box-shadow: none !important;`

- Status:
  - duplicated by current visual owner
- Current winner:
  - `box-shadow: none !important;`

### `overflow: visible;`

- Status:
  - potentially still participating
- Why:
  - no later split owner currently sets `overflow`
- Risk:
  - deleting this block could allow an earlier/default overflow value to apply

## C. Declaration-by-declaration comparison

## Earlier heavy HUD block vs current split

| Stale declaration | Current winning declaration | Owner |
|---|---|---|
| `min-height: var(--match-hud-min-height, 118px) !important;` | `min-height: 82px !important;` | `board-hud.css` |
| `padding: 14px 22px !important;` | `padding: 0 !important;` | `board-hud.css` |
| `border: 1px solid rgba(88, 166, 255, 0.16);` | `border: 0 !important;` | `walnut-live.css` split visual owner |
| `border-radius: 22px;` | no current split replacement | none |
| `background: rgba(5, 10, 19, 0.94) !important;` | `background: transparent !important;` | `walnut-live.css` split visual owner |
| `box-shadow: ...` | `box-shadow: none !important;` | `walnut-live.css` split visual owner |

## Later transparent/reset block vs current split

| Stale declaration | Current winning declaration | Owner |
|---|---|---|
| `min-height: 104px !important;` | `min-height: 82px !important;` | `board-hud.css` |
| `padding: 0 !important;` | `padding: 0 !important;` | `board-hud.css` |
| `border: 0;` | `border: 0 !important;` | `walnut-live.css` split visual owner |
| `border-radius: 0;` | no current split replacement | none |
| `background: transparent !important;` | `background: transparent !important;` | `walnut-live.css` split visual owner |
| `box-shadow: none !important;` | `box-shadow: none !important;` | `walnut-live.css` split visual owner |
| `overflow: visible;` | no current split replacement | none |

## D. Runtime route impact

Selector under audit:

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-top-rail,
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-top-rail
```

### Matches

- Daily Fritz
- regular Play vs Fritz
- ghost/bot match

### Does not match

- Learn / Guided
  - excluded by `:not(.learn-lesson-screen)`
- Puzzle
  - not `bot-match-screen`
- Practice
  - not `bot-match-screen`
- Multiplayer
  - current main match path is not `bot-match-screen`

## E. Safe deletion recommendation

## Earlier heavy HUD block

- Safe to delete now?
  - **Not fully safe yet**
- Why:
  - `border-radius: 22px` has no explicit later split replacement
- Recommendation:
  - not safe until computed-style check confirms `border-radius` is no longer coming from this block

## Later transparent/reset block

- Safe to delete now?
  - **Not fully safe yet**
- Why:
  - `border-radius: 0` and `overflow: visible` may still be participating
- Recommendation:
  - not safe until computed-style check confirms:
    - `border-radius` is still `0` from another later winner or irrelevant
    - `overflow` is still `visible` from another winner or irrelevant

## Overall recommendation

- Do **not** delete either block yet.
- First prove in browser whether `border-radius` and `overflow` are still being inherited from the later stale/reset block, and whether the earlier rounded block is now fully neutralized.

## F. Browser/devtools proof checklist

### Route

Check at least:

1. `#/daily-fritz` active match
2. regular Play vs Fritz active match
3. ghost/bot match if available

### Element selector

Inspect the active rail element matching:

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .bot-top-rail
```

and/or:

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-top-rail
```

### Computed values to verify

Confirm on desktop/laptop:

- `display: grid`
- `grid-template-columns: minmax(420px, 1fr) auto minmax(220px, 1fr)` or browser-equivalent computed track syntax
- `min-height: 82px`
- `padding: 0`
- `gap: 22px`
- `background: transparent`
- `border: 0`
- `box-shadow: none`
- `border-radius: 0`
- `overflow: visible`

### Styles panel expected winners

Expected winners after split:

- structure declarations from `client/src/styles/board/board-hud.css`
- visual declarations from `client/src/styles/walnut-live.css` line `2480`

Critical proof needed:

- if `border-radius: 0` is still shown from the stale line `2156`, then that declaration cannot be deleted yet without replacement
- if `overflow: visible` is still shown from the stale line `2156`, then that declaration cannot be deleted yet without replacement
- if `border-radius: 22px` from the earlier heavy block is crossed out and no longer computing, that part is safe

### Viewports

- desktop wide
- laptop
- narrow viewport
- short-height viewport

## G. Proposed Patch 13

If browser proof confirms that:

- `border-radius: 0` is still needed
- and `overflow: visible` is still needed

then Patch 13 should **not** be deletion-only. It should be a no-visual-change migration patch:

1. move `border-radius: 0;` and `overflow: visible;` into the current split selector ownership
   - likely leave them in `walnut-live.css` under the current winning visual selector at line `2480`
   - or, if treated as structure, move them into `board-hud.css`
2. then delete the older stale blocks

If browser proof shows that:

- `border-radius: 0` is not computed from the stale block
- `overflow: visible` is not computed from the stale block

then Patch 13 can delete:

### Delete block 1 entirely

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

### Delete block 2 entirely

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

### Leave untouched

- generic `.wl-top-rail`
- generic `.screen.game-screen.walnut-live .wl-top-rail, .bot-top-rail`
- current split structure owner in `board-hud.css`
- current split visual owner in `walnut-live.css` line `2480`
