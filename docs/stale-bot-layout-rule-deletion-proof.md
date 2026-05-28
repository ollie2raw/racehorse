# Stale Bot Layout Rule Deletion Proof

Scope: proof-only audit for the two stale `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-match-layout` rules that still remain in `client/src/styles/walnut-live.css` after Patch 4.

This document does not delete the rules. It establishes whether they are genuinely dead or still require browser proof before removal.

## A. Exact stale rule locations

### Stale rule 1

- File path:
  - `client/src/styles/walnut-live.css`
- Current location:
  - line `1772`
- Selector:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-match-layout
  ```
- Full rule body:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-match-layout {
    position: relative;
    z-index: 2;
    padding: 14px 18px 0;
    gap: 12px;
  }
  ```
- Surrounding context:
  - sits immediately after:
    - `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen)::after`
  - before a heavier HUD card treatment block
  - represents an older bot-match cockpit/layout pass

### Stale rule 2

- File path:
  - `client/src/styles/walnut-live.css`
- Current location:
  - line `2163`
- Selector:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-match-layout
  ```
- Full rule body:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-match-layout {
    padding: 14px 22px 0;
    gap: 14px;
  }
  ```
- Surrounding context:
  - appears inside the “Racehorse live board v2: studio cockpit, not old table chrome” section
  - before the HUD rail reset block
  - represents a later but still superseded shell spacing pass

## B. Why each rule is stale

## Current canonical winner

After Patch 4, the canonical active rule now lives in:

- `client/src/styles/board/board-layout.css:27`

Selector:

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-match-layout
```

Rule body:

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-match-layout {
  padding: 18px 28px 0;
  gap: 16px;
}
```

Why it wins:

- exact same selector specificity as both stale rules
- `client/src/styles/board/index.css` is imported after `client/src/styles/walnut-live.css`
- therefore later source order makes the canonical board-layout rule the winner in all matching non-lesson bot routes

### Why stale rule 1 is stale

Before Patch 4:

- it was already superseded by the later stale rule at `walnut-live.css:2163`
- it was also superseded by the then-live winning rule that had:
  - `padding: 18px 28px 0;`
  - `gap: 16px;`

After Patch 4:

- it is superseded by:
  - `client/src/styles/board/board-layout.css:27`

Can it ever still win?

- Not under the current import order for any selector-matching route.
- It has the same specificity as the canonical rule and appears earlier.
- It is not wrapped in a media query.
- No route-class difference narrows it more than the canonical rule.

Conclusion:

- stale by both value history and current source order

### Why stale rule 2 is stale

Before Patch 4:

- it superseded stale rule 1 by later source order
- but it was itself superseded by the then-live winning rule with:
  - `padding: 18px 28px 0;`
  - `gap: 16px;`

After Patch 4:

- it is superseded by:
  - `client/src/styles/board/board-layout.css:27`

Can it ever still win?

- Not under the current import order for any selector-matching route.
- Same specificity as the canonical rule, earlier source order.
- No media-query wrapper.
- No route-class difference that excludes the canonical rule while keeping this one active.

Conclusion:

- stale by both value history and current source order

## C. Runtime route impact

Selector under discussion:

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-match-layout
```

This selector matches only screens that have:

- `.screen`
- `.game-screen`
- `.walnut-live`
- `.bot-match-screen`
- and do **not** have `.learn-lesson-screen`

### Matches

#### Daily Fritz

- Yes
- `BotMatchScreen` non-lesson path uses:
  - `.screen game-screen walnut-live ... bot-match-screen bot-match-mode-daily-fritz`

#### Regular Play vs Fritz

- Yes
- non-lesson `BotMatchScreen` path

#### Ghost / bot match

- Yes
- still uses `bot-match-screen` non-lesson path

### Does not match

#### Multiplayer

- No, unless a route explicitly uses `bot-match-screen`
- current main App live match path uses `.walnut-match-layout game-layout-layer`, but not this bot selector family

#### Learn / guided branch

- No
- excluded by `:not(.learn-lesson-screen)`

#### Puzzle

- No
- does not use `bot-match-screen`

#### Practice / No Brainer Lab

- No
- does not use `bot-match-screen`

## D. Computed-style expectation

For any matching non-lesson bot route, expected computed values should now be:

- `padding: 18px 28px 0`
- `gap: 16px`

Responsive exceptions from `client/src/styles/board/board-layout.css`:

### Narrow landscape

Under:

```css
@media (max-width: 900px) and (orientation: landscape)
```

Expected:

- `padding: 8px 10px 0`
- `gap: 7px`

### Short-height viewport

Under:

```css
@media (max-height: 760px)
```

Expected:

- `padding-top: 10px`
- `gap: 10px`
- left/right/bottom padding still inherited from the non-media canonical rule

### Can the stale values still become computed?

Known current answer:

- No, not if the current import order remains:
  - `walnut-live.css` first
  - `board/index.css` later

Reasons:

- same selector specificity
- canonical rule imported later
- responsive overrides also now live later in `board-layout.css`

Only scenarios where stale values could reappear:

- `board/index.css` import removed or moved earlier
- canonical rule removed from `board-layout.css`
- selector changed so canonical no longer matches but stale rules still do

No known viewport or route state currently makes the stale values win.

## E. Safe deletion recommendation

### Stale rule 1

- Safe to delete now?
  - **Probably yes from cascade logic**
- Safe to delete only after browser computed-style check?
  - **Recommended**
- Final recommendation:
  - safe to delete after one browser computed-style confirmation on non-lesson bot routes

### Stale rule 2

- Safe to delete now?
  - **Probably yes from cascade logic**
- Safe to delete only after browser computed-style check?
  - **Recommended**
- Final recommendation:
  - safe to delete after one browser computed-style confirmation on non-lesson bot routes

Why still recommend browser proof:

- both rules live in a historically messy stylesheet with repeated cockpit passes
- deletion is likely safe, but a real computed-style check is cheap and gives high confidence before pruning legacy noise

## F. Suggested browser/devtools proof

### Route

Check at least:

1. `#/daily-fritz` active match
2. regular Play vs Fritz active match
3. ghost/bot match if available

### Element selector to inspect

Inspect:

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-match-layout
```

In practice:

- select the outer layout wrapper rendered by the active non-lesson board path

### Computed styles to verify

On desktop/laptop:

- `padding-top: 18px`
- `padding-right: 28px`
- `padding-bottom: 0px`
- `padding-left: 28px`
- `gap: 16px`

On narrow landscape:

- `padding-top: 8px`
- `padding-right: 10px`
- `padding-bottom: 0px`
- `padding-left: 10px`
- `gap: 7px`

On short-height viewport:

- `padding-top: 10px`
- `padding-right: 28px`
- `padding-bottom: 0px`
- `padding-left: 28px`
- `gap: 10px`

### What to verify in the Styles panel

Confirm that:

- the winning declarations come from `client/src/styles/board/board-layout.css`
- the two `walnut-live.css` stale blocks appear crossed out if shown

## G. Proposed Patch 7

If browser computed-style checks confirm the above:

### Recommended Patch 7

- delete these two stale rules from `client/src/styles/walnut-live.css`:

1.
```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-match-layout {
  position: relative;
  z-index: 2;
  padding: 14px 18px 0;
  gap: 12px;
}
```

2.
```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-match-layout {
  padding: 14px 22px 0;
  gap: 14px;
}
```

Constraints for Patch 7:

- delete only those two blocks
- do not touch:
  - broad `.walnut-match-layout`
  - grouped z-index rule containing `.walnut-match-layout`
  - lesson-specific layout rules
  - any HUD / shell / hand / tile / overlay selectors

If browser proof is not available:

- do not delete yet
- next step should be a targeted live cascade verification rather than more source-only cleanup
