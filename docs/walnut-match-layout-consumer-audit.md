# Walnut Match Layout Consumer Audit

Scope: focused audit of `.walnut-match-layout` and related outer-shell usage after Patch 4.

This is an audit-only document. No selectors were moved in this patch.

## A. All DOM/component emitters of `.walnut-match-layout`

### 1. `client/src/components/MatchLayout.tsx`

- Component/function: `MatchLayout`
- Exact className usage:
  ```tsx
  <div className="walnut-match-layout" data-ui="match-board">
  ```
- Includes `.game-layout-layer`: `No`
- Likely route/mode affected:
  - legacy/unknown shared match layout helper
  - no direct runtime consumer found in current repo search
- Classification:
  - `Legacy/unknown`

### 2. `client/src/match/InGameBoardShell.tsx`

This older shared shell abstraction emits `.walnut-match-layout game-layout-layer` in multiple branches.

#### a. `layout === 'walnut-hud'`

- Component/function: `InGameBoardShell`
- Exact className usage:
  ```tsx
  className={matchLayoutClassName ?? 'walnut-match-layout game-layout-layer'}
  ```
- Includes `.game-layout-layer`: `Yes`
- Likely route/mode affected:
  - shared in-game board shell
  - documented in file as multiplayer-style “walnut-hud”
- Classification:
  - `Shared in-game board shell`
  - `Multiplayer` later/likely

#### b. `layout === 'walnut-wrap' && integratedPvfPanel && matchBody == null`

- Component/function: `InGameBoardShell`
- Exact className usage:
  ```tsx
  className={
    matchLayoutClassName ??
    'walnut-match-layout game-layout-layer rh-pvf-integrated-layout rh-pvf-pass-a'
  }
  ```
- Includes `.game-layout-layer`: `Yes`
- Likely route/mode affected:
  - Play vs Fritz / integrated PVF panel layouts
- Classification:
  - `Bot / Play vs Fritz / Daily Fritz`

#### c. `layout === 'walnut-wrap'`

- Component/function: `InGameBoardShell`
- Exact className usage:
  ```tsx
  className={matchLayoutClassName ?? 'walnut-match-layout game-layout-layer'}
  ```
- Includes `.game-layout-layer`: `Yes`
- Likely route/mode affected:
  - shared wrapper around top HUD + studio shell
  - Daily Puzzle / Fritz / other shared match routes depending on caller
- Classification:
  - `Shared in-game board shell`

### 3. `client/src/match/board/InGameBoardShell.tsx`

- Component/function: `InGameBoardShell`
- Exact className usage:
  ```tsx
  className={className ?? 'walnut-match-layout game-layout-layer'}
  ```
- Includes `.game-layout-layer`: `Yes`
- Likely route/mode affected:
  - active shared match-board composition after Patch 1
  - currently used by active non-lesson `BotMatchScreen`
- Classification:
  - `Shared in-game board shell`
  - `Bot / Play vs Fritz / Daily Fritz`

### 4. `client/src/App.tsx`

- Component/function: `App` main active match render branch
- Exact className usage:
  ```tsx
  <div className="walnut-match-layout game-layout-layer">
  ```
- Includes `.game-layout-layer`: `Yes`
- Likely route/mode affected:
  - main in-app live match board path
  - likely multiplayer / live game / tournament-adjacent active board route
- Classification:
  - `Multiplayer`

### 5. `client/src/bot/BotMatchScreen.tsx`

#### a. Lesson branch

- Component/function: `BotMatchScreen`
- Exact className usage:
  ```tsx
  <div className="walnut-match-layout game-layout-layer">
  ```
- Includes `.game-layout-layer`: `Yes`
- Likely route/mode affected:
  - learn / guided lesson cockpit path inside bot match screen
- Classification:
  - `Learn / Guided Match`

#### b. Non-lesson branch

- Current state:
  - no direct hardcoded `.walnut-match-layout` JSX anymore
  - now emitted through `client/src/match/board/InGameBoardShell.tsx`
- Classification:
  - `Bot / Play vs Fritz / Daily Fritz`

### 6. `client/src/dailyPuzzle/DailyPuzzleScreen.tsx`

- Component/function: `DailyPuzzleScreen`
- Exact className usage:
  - indirect via `match/InGameBoardShell`
- Includes `.game-layout-layer`: `Yes` via default shell path
- Likely route/mode affected:
  - Daily Puzzle
- Classification:
  - `Puzzle`

### 7. `client/src/dailyPuzzle/DailyPuzzleLadderScreen.tsx`

- Component/function: `DailyPuzzleLadderScreen`
- Exact className usage:
  - indirect via `match/InGameBoardShell`
- Includes `.game-layout-layer`: `Yes` via default shell path
- Likely route/mode affected:
  - Daily Puzzle Ladder
- Classification:
  - `Puzzle`

### 8. `client/src/practice/NoBrainerLabScreen.tsx`

- Component/function: `NoBrainerLabScreen`
- Exact className usage:
  - indirect via `match/InGameBoardShell`
- Includes `.game-layout-layer`: depends on `InGameBoardShell` path used by `boardColumnOnly`; outer shell remains `nbl-stage rh-live-studio-shell` around it
- Likely route/mode affected:
  - Practice / No Brainer Lab
- Classification:
  - `Practice / No Brainer Lab`

## B. All CSS rules targeting `.walnut-match-layout`

### 1. `client/src/styles/board/board-layout.css`

#### Rule 1

- Selector:
  ```css
  .walnut-match-layout.game-layout-layer
  ```
- Purpose:
  - canonical migrated shared outer shell structure
  - flex column, min-height protection, overflow hidden, stacking context
- Status:
  - `active/current`

#### Rule 2

- Selector:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-match-layout
  ```
- Purpose:
  - active non-lesson bot-match outer shell spacing
- Status:
  - `active/current`

#### Rule 3

- Selector:
  ```css
  @media (max-width: 900px) and (orientation: landscape) {
    .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-match-layout
  }
  ```
- Purpose:
  - active narrow landscape spacing override for bot-match shell
- Status:
  - `active/current`

#### Rule 4

- Selector:
  ```css
  @media (max-height: 760px) {
    .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-match-layout
  }
  ```
- Purpose:
  - active short-height spacing override for bot-match shell
- Status:
  - `active/current`

### 2. `client/src/styles/walnut-live.css`

#### Rule 1

- Selector:
  ```css
  .walnut-match-layout,
  .wl-score-header,
  .wl-top-rail,
  .wl-stage-shell,
  .wl-hand-area
  ```
- Purpose:
  - grouped `position: relative; z-index: 2` shell/board stack rule
- Status:
  - `active/current`
- Notes:
  - related to outer shell, but mixed with HUD, stage, and hand tray

#### Rule 2

- Selector:
  ```css
  .walnut-match-layout
  ```
- Rule body:
  ```css
  .walnut-match-layout {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-height: 0;
    width: 100%;
    gap: 0;
  }
  ```
- Purpose:
  - broad legacy base shell rule
- Status:
  - `active/current`
- Notes:
  - this is the rule under audit for future migration

#### Rule 3

- Selector:
  ```css
  .walnut-match-layout .wl-stage-shell
  ```
- Purpose:
  - descendant stage adjustment (`border-top: none`)
- Status:
  - `active/current`
- Notes:
  - related to shell ancestry, but not an outer-shell ownership rule

#### Rule 4

- Selector:
  ```css
  .screen.game-screen.walnut-live .walnut-match-layout .wl-stage-shell .board-area.wl-board-area,
  .screen.game-screen.walnut-live.theme-brown .walnut-match-layout .wl-stage-shell .board-area.wl-board-area,
  .screen.game-screen.walnut-live.bot-match-screen .walnut-match-layout .wl-stage-shell .board-area.wl-board-area,
  .screen.game-screen.walnut-live.theme-brown.bot-match-screen .walnut-match-layout .wl-stage-shell .board-area.wl-board-area
  ```
- Purpose:
  - board surface descendant ownership
- Status:
  - `active/current`
- Notes:
  - not outer shell
  - should not move with layout

#### Rule 5

- Selector:
  ```css
  .screen.game-screen.walnut-live .walnut-match-layout .wl-stage-shell .board-area.wl-board-area .board-container,
  .screen.game-screen.walnut-live .walnut-match-layout .wl-stage-shell .board-area.wl-board-area .board-canvas,
  .screen.game-screen.walnut-live .walnut-match-layout .wl-stage-shell .board-area.wl-board-area .game-board,
  .screen.game-screen.walnut-live .walnut-match-layout .wl-stage-shell .board-area.wl-board-area .wl-stage,
  ...
  ```
- Purpose:
  - deeper board descendant layout/size ownership
- Status:
  - `active/current`
- Notes:
  - not outer shell

#### Rule 6

- Selector:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-match-layout
  ```
- Rule body:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-match-layout {
    position: relative;
    z-index: 2;
    padding: 14px 18px 0;
    gap: 12px;
  }
  ```
- Purpose:
  - older bot-match shell spacing/layout pass
- Status:
  - `stale`

#### Rule 7

- Selector:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-match-layout
  ```
- Rule body:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-match-layout {
    padding: 14px 22px 0;
    gap: 14px;
  }
  ```
- Purpose:
  - newer but still superseded bot-match shell spacing pass
- Status:
  - `stale`

#### Rule 8

- Selector:
  ```css
  @media (max-width: 900px) and (orientation: landscape)
  ```
- Purpose:
  - contains unrelated active viewport variable changes for bot-match shell context
- Status:
  - `active/current`
- Notes:
  - the old `.walnut-match-layout` narrow override was removed in Patch 4
  - the media block still exists because other rules inside it are active

#### Rule 9

- Selector:
  ```css
  @media (max-height: 760px)
  ```
- Purpose:
  - contains unrelated active short-height bot-match shell adjustments
- Status:
  - `active/current`
- Notes:
  - the old `.walnut-match-layout` short-height override was removed in Patch 4
  - the media block still exists because other rules inside it are active

### 3. `client/src/styles/match-board-architecture.css`

#### Rule 1

- Selector:
  ```css
  .screen.game-screen.walnut-live .walnut-match-layout
  ```
- Rule body:
  ```css
  .screen.game-screen.walnut-live .walnut-match-layout {
    gap: 0;
  }
  ```
- Purpose:
  - broad structural hierarchy reset
- Status:
  - `active/current` but often overridden later on bot-match routes

### 4. `client/src/learn/learnGuidedMatch.css`

#### Rule 1

- Selector:
  ```css
  .learn-lesson-screen .walnut-match-layout
  ```
- Rule body:
  ```css
  .learn-lesson-screen .walnut-match-layout {
    flex: 1 1 0;
    min-height: 0;
    max-height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 0;
  }
  ```
- Purpose:
  - lesson-specific outer shell behavior
- Status:
  - `lesson-only`

## C. Route/mode ownership classification

### Shared in-game board shell

- `client/src/match/board/InGameBoardShell.tsx`
- `client/src/match/InGameBoardShell.tsx` in `walnut-hud` and `walnut-wrap` layouts

### Bot / Play vs Fritz / Daily Fritz

- `client/src/match/board/InGameBoardShell.tsx` via non-lesson `BotMatchScreen`
- `client/src/match/InGameBoardShell.tsx` integrated PVF panel branch
- `client/src/styles/board/board-layout.css` active route-specific spacing rules

### Multiplayer

- `client/src/App.tsx`
  - direct `.walnut-match-layout game-layout-layer` emitter in the main active match render path
- `client/src/match/InGameBoardShell.tsx`
  - file-level comment explicitly says `walnut-hud` is multiplayer

### Puzzle

- `client/src/dailyPuzzle/DailyPuzzleScreen.tsx`
- `client/src/dailyPuzzle/DailyPuzzleLadderScreen.tsx`
- both indirect via `client/src/match/InGameBoardShell.tsx`

### Practice / No Brainer Lab

- `client/src/practice/NoBrainerLabScreen.tsx`
- indirect via `client/src/match/InGameBoardShell.tsx`
- also wrapped by `nbl-stage rh-live-studio-shell`

### Learn / Guided Match

- `client/src/bot/BotMatchScreen.tsx`
  - direct lesson branch emitter of `.walnut-match-layout game-layout-layer`
- `client/src/learn/learnGuidedMatch.css`
  - lesson-only shell rule

### Legacy/unknown

- `client/src/components/MatchLayout.tsx`
  - emits bare `.walnut-match-layout`
  - no direct runtime consumer found in current search

## D. Migration recommendation for the broad base rule

Rule under audit:

```css
.walnut-match-layout {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
  gap: 0;
}
```

### Recommendation

Do **not** move this rule to `board-layout.css` yet.

### Why

It is still broader than the new shared shell contract.

It currently reaches:

- legacy `MatchLayout`
- older shared `match/InGameBoardShell`
- Puzzle routes
- Practice routes
- Multiplayer-like route in `App.tsx`
- lesson/guided branch context through shared ancestry

Moving it now could still be safe if copied exactly, but deleting it from `walnut-live.css` would be risky because:

- not every consumer has been normalized to the new `match/board/InGameBoardShell.tsx`
- some routes use `.walnut-match-layout` indirectly through the older `match/InGameBoardShell.tsx`
- `MatchLayout.tsx` still emits bare `.walnut-match-layout` without `.game-layout-layer`

### Best current stance

- keep it in `walnut-live.css` for now
- do not copy it into `board-layout.css` yet
- do not narrow it to `.walnut-match-layout.game-layout-layer` because that work is already partially done and does not cover all existing consumers

### What could break if moved/deleted now

- Daily Puzzle shell spacing/fit if an older `InGameBoardShell` branch depends on the broad base rule
- Practice / NBL shell fit
- Multiplayer / main App live match shell
- any unknown consumer of `MatchLayout.tsx`

## E. Stale duplicate rule analysis

### Stale duplicate 1

- File: [client/src/styles/walnut-live.css](/Users/olivermorid/racehorse-dominoes/client/src/styles/walnut-live.css:1772)
- Selector:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-match-layout
  ```
- Values:
  ```css
  position: relative;
  z-index: 2;
  padding: 14px 18px 0;
  gap: 12px;
  ```
- Can it be deleted later:
  - probably yes
- Proof needed:
  - confirm it is never the winning computed style on any active bot-match route
  - browser devtools or computed-style snapshot on Daily Fritz / Play vs Fritz / ghost match

### Stale duplicate 2

- File: [client/src/styles/walnut-live.css](/Users/olivermorid/racehorse-dominoes/client/src/styles/walnut-live.css:2163)
- Selector:
  ```css
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .walnut-match-layout
  ```
- Values:
  ```css
  padding: 14px 22px 0;
  gap: 14px;
  ```
- Can it be deleted later:
  - probably yes
- Proof needed:
  - confirm it is not the winning computed style on any current bot-match route
  - verify no intermediate media state or mode branch still depends on it

### Important note

These are stale by value ordering, but not yet proven dead by runtime inspection.

They should not be deleted on code search alone.

## F. Recommended Patch 6

Recommended next step: **another audit first**, not selector migration yet.

Specifically:

1. audit every runtime consumer of `client/src/match/InGameBoardShell.tsx`
2. classify which layout branch each route uses:
   - `studio`
   - `walnut-hud`
   - `walnut-wrap`
3. identify whether any runtime path still depends on the broad `.walnut-match-layout` base rule without the new shared shell contract
4. separately prove the two stale bot-match duplicates are never winning in runtime

After that, the safest Patch 6 would likely be one of:

- migrate the broad `.walnut-match-layout` rule only if all consumers are understood
- or delete the stale duplicate bot-match spacing rules if runtime proof confirms they are dead

Current recommendation:

- **Do not migrate the broad base rule yet**
- **Do not delete stale duplicate bot-match layout rules yet**
- **Do one more selector-specific consumer/runtime audit first**
