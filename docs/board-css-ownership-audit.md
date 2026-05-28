# Board CSS Ownership Audit

Scope: active shared in-game board path after patch 1, with focus on the non-lesson `BotMatchScreen` route now composed through:

- `client/src/match/board/InGameBoardShell.tsx`
- `client/src/match/board/InGameBoardHud.tsx`
- `client/src/match/board/InGameBoardFrame.tsx`
- `client/src/match/board/InGameOverlayStack.tsx`

This is an audit-only document. It does not propose runtime changes in this patch.

## Active path audited

Current active non-lesson board composition:

1. `BotMatchScreen.tsx`
2. `InGameBoardShell`
3. `InGameBoardHud`
4. `InGameBoardFrame`
5. `boardStage`
6. `MatchNblBoardFrame`
7. `Board`
8. `handTray`
9. `InGameOverlayStack`

## CSS load order that matters

Global load order from `client/src/main.tsx`:

1. `client/src/styles/tokens.css`
2. `client/src/index.css`
3. `client/src/premium-theme.css`
4. `client/src/styles/walnut-live.css`
5. `client/src/styles/rh-glow-underline.css`
6. `client/src/styles/game-interactions.css`
7. `client/src/styles/match-hud-polish.css`
8. `client/src/styles/match-board-architecture.css`
9. `client/src/styles/match-standard-live-board.css`
10. `client/src/match/gameLayoutLayers.css`
11. `client/src/styles/racehorse-background.css`
12. `client/src/styles/rh-image-surface.css`

Additional imports pulled by the active board path:

- `client/src/bot/botMatch.css`
- `client/src/dailyFritz/dailyFritzMatchBoard.css`
- `client/src/bot/PlayVsFritz.css`
- `client/src/styles/shared-ui.css`
- `client/src/learn/learn.css`
- `client/src/practice/noBrainerLab.css` via `MatchNblBoardFrame.tsx`

Implication: the active board is not owned by one stylesheet. It is the result of layered global match CSS, bot-specific CSS, Daily Fritz-specific overrides, and the imported No Brainer Lab board frame skin.

---

## 1. Outer match layout

### A. Active selectors

- `.walnut-match-layout`
- `.game-layout-layer`

### B. CSS owners

Primary owners:

- `client/src/match/gameLayoutLayers.css`
  - owns `.walnut-match-layout.game-layout-layer`
- `client/src/styles/walnut-live.css`
  - multiple non-lesson bot-match overrides for `.walnut-match-layout`
- `client/src/learn/learnGuidedMatch.css`
  - lesson-specific `.learn-lesson-screen .walnut-match-layout`
- `client/src/bot/PlayVsFritz.css`
  - broader Play vs Fritz shell/layout participation
- `client/src/styles/racehorse-background.css`
  - excludes `.game-layout-layer` from background positioning rule

DOM owners:

- `client/src/match/board/InGameBoardShell.tsx`
- `client/src/components/MatchLayout.tsx`
- `client/src/match/InGameBoardShell.tsx`
- `client/src/App.tsx`

### C. Conflict level

`Fragile`

Reason:

- multiple live owners
- same class names reused across bot, puzzle, learn, multiplayer-style layouts
- `walnut-live.css` contains repeated mode-specific overrides for the same shell class

### D. Recommended future owner

- `client/src/styles/board/board-layout.css`

This should become the canonical owner for:

- viewport/flex shell
- match vertical rhythm
- spacing between HUD, board surface, and hand dock

### E. Legacy files to quarantine later

- `client/src/styles/walnut-live.css`
  - should eventually stop owning high-level match layout for active board routes
- `client/src/bot/PlayVsFritz.css`
  - should keep mode-entry/lobby styles, not shared match layout ownership
- `client/src/learn/learnGuidedMatch.css`
  - should own only lesson variants

### F. Deletion risk

Do not delete yet:

- `client/src/components/MatchLayout.tsx`
- `client/src/match/InGameBoardShell.tsx`
- any `.walnut-match-layout` rules in `walnut-live.css`

They may still support Daily Puzzle, App-level match screens, and lesson layouts.

### G. Suggested patch 3

Document and centralize shell ownership first:

- define one canonical board layout file
- move no CSS yet
- add comments or an ownership header identifying `.walnut-match-layout` as legacy shared shell until migration

---

## 2. Top HUD rail

### A. Active selectors

- `.wl-top-rail`
- `.bot-top-rail`
- `.bot-hud-left-cluster`
- `.bot-hud-right-cluster`
- `.wl-player-pill`
- `.wl-player-pill-btn`
- `.score-card`
- `.wl-center-status`
- `.wl-turn-label`
- `.daily-fritz-progress-pill`
- `.wl-player-score`
- `.wl-player-label`

### B. CSS owners

Primary owners:

- `client/src/bot/botMatch.css`
  - direct bot HUD sizing and placement
  - left/right cluster behavior
  - Daily Fritz progress pill sizing
- `client/src/styles/walnut-live.css`
  - repeated non-lesson bot-match overrides for:
    - `.wl-top-rail`
    - `.bot-top-rail`
    - `.bot-hud-left-cluster`
    - `.bot-hud-right-cluster`
    - `.wl-player-pill`
    - `.wl-center-status`
    - `.wl-turn-label`
- `client/src/dailyFritz/dailyFritzMatchBoard.css`
  - Daily Fritz-specific active board polish overrides that also affect HUD-adjacent controls and score header pieces
- `client/src/styles/match-hud-polish.css`
  - shared HUD polish and control pill rules
- `client/src/bot/PlayVsFritz.css`
  - related HUD language and Fritz panel system, especially for non-Daily flows

DOM owners:

- `client/src/match/board/InGameBoardHud.tsx`
- slot content built in `client/src/bot/BotMatchScreen.tsx`

### C. Conflict level

`Dangerous`

Reason:

- same selector family is shared across multiple modes
- bot HUD classes are styled in both `botMatch.css` and `walnut-live.css`
- Daily Fritz adds another override layer
- some center-status behavior is inline-positioned in JSX
- this region is likely to regress across Play vs Fritz and lesson flows if restyled blindly

### D. Recommended future owner

- `client/src/styles/board/board-hud.css`
- mode-specific accents later in `client/src/styles/board/skins/racehorse-matte.css`

### E. Legacy files to quarantine later

- `client/src/styles/walnut-live.css`
  - should stop owning shared HUD rail visuals
- `client/src/bot/botMatch.css`
  - should shrink toward bot-only behavior and mode exceptions, not base HUD ownership
- `client/src/bot/PlayVsFritz.css`
  - should keep Fritz screen/lobby identity, not shared in-game rail ownership

### F. Deletion risk

Do not delete yet:

- `.wl-top-rail` and `.wl-player-pill` rules in `walnut-live.css`
- `.daily-fritz-progress-pill` rules in `botMatch.css`

They are still active and reused across more than one match surface.

### G. Suggested patch 3

Safest first consolidation:

- produce a HUD selector matrix showing which file is intended to own:
  - structure
  - sizing
  - tone/accent
  - responsive behavior
- do not move styles yet
- identify one future base owner and one mode-skin owner

---

## 3. Board shell and body

### A. Active selectors

Shared shell:

- `.rh-live-studio-shell`
- `.rh-live-board-zone`
- `.wl-stage-shell`

Board frame:

- `.nbl-stage`
- `.walnut-nbl-stage`
- `.nbl-board-frame`
- `.nbl-board-canvas`
- `.nbl-board-watermark`

Board-stage content:

- `.rh-board-meta-bar`
- `.board-corner-pill`
- `.open-ends-pill`
- `.open-ends-pill__label`
- `.open-ends-count`
- `.boneyard-pill`
- `.boneyard-icon`
- `.boneyard-count`
- `.boneyard-meta`
- `.board-zoom-tray`
- `.wl-controls-tray`
- `.control-pill`

### B. CSS owners

Primary owners:

- `client/src/practice/noBrainerLab.css`
  - base owner for:
    - `.nbl-board-frame`
    - `.nbl-board-canvas`
    - embedded board container assumptions
- `client/src/styles/walnut-live.css`
  - strong non-lesson bot-match ownership of:
    - `.rh-live-studio-shell`
    - `.rh-live-board-zone`
    - `.wl-stage-shell`
    - `.nbl-board-frame`
    - `.nbl-board-canvas`
    - `.rh-board-meta-bar`
    - `.wl-controls-tray`
- `client/src/styles/match-standard-live-board.css`
  - parallel board shell system for `.rh-standard-live-board`
  - conceptually overlaps the same board regions
- `client/src/styles/match-board-architecture.css`
  - architectural board-playfield layer, partially overlapping the same surface concerns
- `client/src/styles/match-hud-polish.css`
  - control pill and board frame polish
- `client/src/bot/botMatch.css`
  - board meta pills and open/boneyard count styling
- `client/src/dailyFritz/dailyFritzMatchBoard.css`
  - active Daily Fritz overrides for:
    - board pills
    - control pills
    - NBL frame/canvas presentation

DOM/component owners:

- `client/src/match/board/InGameBoardFrame.tsx`
- `client/src/components/MatchNblBoardFrame.tsx`
- `client/src/components/Board.tsx`
- `client/src/components/BoardOpenEndsPill.tsx`
- `client/src/components/BoneyardCountPill.tsx`

### C. Conflict level

`Dangerous`

Reason:

- shell structure comes from shared wrappers
- actual board frame visuals come from No Brainer Lab CSS
- bot/live board shell is then re-skinned by `walnut-live.css`
- Daily Fritz adds another override layer
- `match-standard-live-board.css` and `match-board-architecture.css` represent overlapping future/canonical systems that are not yet the sole owners

### D. Recommended future owner

- `client/src/styles/board/board-shell.css`
- `client/src/styles/board/board-surface.css`
- `client/src/styles/board/board-meta.css`
- `client/src/styles/board/board-controls.css`

### E. Legacy files to quarantine later

- `client/src/practice/noBrainerLab.css`
  - should stop owning the production in-game board shell outside Practice
- `client/src/styles/walnut-live.css`
  - should stop being the active owner of board shell visuals
- `client/src/styles/match-standard-live-board.css`
  - should either become canonical later or be retired as a parallel system
- `client/src/styles/match-board-architecture.css`
  - should be either promoted to clear architecture ownership or trimmed

### F. Deletion risk

Do not delete yet:

- `client/src/components/MatchNblBoardFrame.tsx`
- `client/src/practice/noBrainerLab.css`
- `.nbl-board-*` rules in `walnut-live.css`
- `match-standard-live-board.css`
- `match-board-architecture.css`

These are still active or structurally important, even if they are not the desired long-term owner.

### G. Suggested patch 3

Safest first consolidation:

- create a board shell ownership matrix:
  - shell wrapper owner
  - frame/base owner
  - Daily Fritz override owner
  - control/meta owner
- then comment or document which current file is temporary owner versus future owner

---

## 4. Hand dock

### A. Active selectors

- `.rh-live-hand-deck`
- `.wl-hand-area`
- `.tray-rail`
- `.tray-center`
- `.hand-container`
- `.hand-container.is-scrollable`
- `.hand-container.has-single-row`
- `.hand-container.has-multiple-rows`
- `.hand-row`
- `.guided-tile-wrap`

### B. CSS owners

Primary owners:

- `client/src/styles/walnut-live.css`
  - strong non-lesson bot-match ownership of:
    - `.rh-live-hand-deck`
    - `.rh-live-hand-deck .wl-hand-area`
    - `.tray-center`
    - `.hand-container`
    - single-row layout variants
- `client/src/styles/game-interactions.css`
  - shared tray/hand structure behavior:
    - `.hand-area`
    - `.wl-hand-area`
    - `.tray-rail`
    - `.tray-center`
    - `.hand-row`
    - `.hand-container`
    - `.is-scrollable`
- `client/src/bot/botMatch.css`
  - `.hand-container.is-scrollable`
  - `.hand-container .domino-tile`
- `client/src/dailyFritz/dailyFritzMatchBoard.css`
  - Daily Fritz-specific `.wl-hand-area` override
- `client/src/styles/shared-ui.css`
  - lesson-specific hand-container rules
- `client/src/learn/learnGuidedMatch.css`
  - lesson-specific live hand deck variants

DOM owners:

- hand tray JSX in `client/src/bot/BotMatchScreen.tsx`
- wrapper class from `client/src/match/board/InGameBoardFrame.tsx`

### C. Conflict level

`Fragile`

Reason:

- shared structure is understandable
- but active ownership is split between `walnut-live.css`, `game-interactions.css`, and `botMatch.css`
- lesson-specific styles also target similar tray and hand selectors

### D. Recommended future owner

- `client/src/styles/board/board-hand-dock.css`
- interaction-only state layering should remain in `client/src/styles/board/board-interactions.css`

### E. Legacy files to quarantine later

- `client/src/styles/walnut-live.css`
  - should stop owning baseline hand dock visuals
- `client/src/bot/botMatch.css`
  - should keep only bot-mode exceptions
- `client/src/styles/shared-ui.css`
  - should remain lesson/shared utility only

### F. Deletion risk

Do not delete yet:

- `.wl-hand-area` and `.tray-*` rules in `game-interactions.css`
- `.rh-live-hand-deck` rules in `walnut-live.css`

They are clearly active in current non-lesson gameplay.

### G. Suggested patch 3

Safest first consolidation:

- separate structure from state in documentation:
  - tray shell and spacing
  - scroll behavior
  - row packing
  - tile state visuals

---

## 5. Domino tiles

### A. Active selectors

DOM-origin classes from `DominoTile.tsx`:

- `.domino-tile`
- `.double`
- `.selected`
- `.highlight`
- `.unplayable`
- `.disabled`
- `.domino-body`
- `.domino-divider.vertical`
- `.pip-half`
- `.pip`

Board and hand context selectors:

- `.board-canvas .domino-tile.board-tile .domino-body`
- `.hand-container .domino-tile`
- `.hand-container .domino-tile.selected`
- `.hand-container .domino-tile.highlight:not(.unplayable)`
- `.hand-container .domino-tile.unplayable`

Underline/glow:

- `.hand-container .domino-tile.highlight:not(.unplayable)::after`
- `.rh-glow-underline`

### B. CSS owners

Structural/render owner:

- `client/src/components/DominoTile.tsx`
  - tile DOM structure
  - pip colors
  - inline pip/body styling
  - selected/highlight/unplayable class assignment

State/interaction owners:

- `client/src/styles/game-interactions.css`
  - shared hand tile motion/state logic:
    - selected
    - highlight
    - unplayable
    - row interaction behavior
- `client/src/styles/rh-glow-underline.css`
  - playable underline glow via `::after`
- `client/src/styles/walnut-live.css`
  - board-tile and hand-tile visual overrides:
    - `.domino-body`
    - board tile body
    - selected/highlight hand tile body
- `client/src/bot/botMatch.css`
  - hand tile size/spacing influence
- `client/src/styles/shared-ui.css`
  - lesson-specific selected/hover variants
- `client/src/learn/learnGuidedMatch.css`
  - lesson-guided hand tile overrides
- `client/src/practice/noBrainerLab.css`
  - Practice-only tile hover/selected variants

### C. Conflict level

`Dangerous`

Reason:

- DOM structure is inline in React, not CSS-owned
- state classes are assigned in component logic but restyled in several CSS files
- board tiles and hand tiles use overlapping selectors
- lesson, practice, and bot modes all touch the same tile classes

### D. Recommended future owner

- `client/src/styles/board/board-tiles.css`
- `client/src/styles/board/board-interactions.css`

Longer-term:

- tile structure should eventually have fewer inline visual styles, but not in this phase

### E. Legacy files to quarantine later

- `client/src/styles/walnut-live.css`
  - should stop owning generic tile presentation
- `client/src/styles/shared-ui.css`
  - should stop affecting non-lesson tile states
- `client/src/practice/noBrainerLab.css`
  - should stay Practice-only

### F. Deletion risk

Do not delete yet:

- `game-interactions.css`
- `rh-glow-underline.css`
- inline visual styling in `DominoTile.tsx`

These are definitely active, even if they are not ideal long-term ownership.

### G. Suggested patch 3

Safest first consolidation:

- document the distinction between:
  - tile DOM/inline structure
  - global board tile treatment
  - hand tile interaction states
  - lesson/practice mode exceptions

---

## 6. Overlays and modals

### A. Active selectors

Portal/overlay:

- `.flying-tile-overlay`
- `.score-track-overlay`
- `.game-over-overlay`
- `.game-over-card`

Hand-over:

- `.hand-over-modal-overlay`
- `.hand-over-modal`
- `.hand-over-modal__*`
- `.hand-over-error-zone`
- `.hand-over-error-text`

Daily Fritz final:

- `.df-result-overlay`
- `.df-result-card`
- `.df-result-panel`
- `.df-result-*`
- `.df-share-card`
- `.df-share-btn`
- `.df-share-hint`

Daily Fritz set interstitial still inline in `BotMatchScreen`:

- `.daily-fritz-set-overlay`
- `.daily-fritz-set-overlay-card`
- `.daily-fritz-inline-preview*`

Portal root behavior:

- `GameOverlayPortal` portals directly to `document.body`
- no custom `.game-overlay-portal-root` wrapper class currently emitted

### B. CSS owners

Primary owners:

- `client/src/match/gameLayoutLayers.css`
  - active flying tile overlay layer
- `client/src/bot/botMatch.css`
  - `.flying-tile-overlay`
  - hand-over error zone text helpers reused in overlays
- `client/src/styles/walnut-live.css`
  - `.score-track-overlay`
  - broader game-over overlay/card ecosystem
- `client/src/components/handOver/handOverModal.css`
  - clear owner for Hand Over modal visual system
- `client/src/styles/match-hud-polish.css`
  - owner for:
    - `.df-result-overlay`
    - `.df-result-card`
    - `.df-share-*`
- `client/src/dailyFritz/DailyFritzFinalResultOverlay.tsx`
  - Daily Fritz final overlay DOM
- `client/src/components/ScoreTrackOverlay.tsx`
  - Score track overlay DOM
- `client/src/components/GameOverlayPortal.tsx`
  - portal behavior owner

### C. Conflict level

`Layered`

Reason:

- ownership is split, but mostly by overlay type
- hand-over modal has a relatively clear CSS owner
- Daily Fritz final overlay has a relatively clear CSS owner
- score track still depends on older shared overlay styles in `walnut-live.css`

### D. Recommended future owner

- `client/src/styles/board/board-overlays.css`
- `client/src/styles/board/board-modals.css`

Mode-specific additions later:

- `client/src/styles/board/skins/racehorse-matte.css`

### E. Legacy files to quarantine later

- `client/src/styles/walnut-live.css`
  - should stop owning the generic score-track/modal shell once migrated
- `client/src/bot/botMatch.css`
  - should stop owning generic overlay visuals outside bot-specific animation cases

### F. Deletion risk

Do not delete yet:

- `client/src/components/handOver/handOverModal.css`
- `client/src/styles/match-hud-polish.css` Daily Fritz result rules
- `client/src/match/gameLayoutLayers.css` flying overlay rules

All are active.

### G. Suggested patch 3

Safest first consolidation:

- separate shared overlay shell ownership from mode-specific content ownership
- keep portal behavior in `GameOverlayPortal.tsx`
- identify one future CSS file for all board overlays and one for large modal cards

---

## Legacy files to quarantine later

These should eventually stop owning active board visuals, but should not be removed yet:

- `client/src/styles/walnut-live.css`
  - keep only legacy/global compatibility until migration is complete
- `client/src/practice/noBrainerLab.css`
  - should be Practice-only, not production match-board shell owner
- `client/src/bot/botMatch.css`
  - should shrink to bot-mode exceptions, not shared board ownership
- `client/src/bot/PlayVsFritz.css`
  - should keep Play vs Fritz-specific shell/lobby language, not canonical board ownership
- `client/src/styles/match-standard-live-board.css`
  - parallel board system that needs explicit keep-or-replace decision later
- `client/src/styles/match-board-architecture.css`
  - overlapping architectural attempt that needs clear future role
- `client/src/styles/shared-ui.css`
  - lesson/shared utilities only
- `client/src/learn/learnGuidedMatch.css`
  - lesson-mode visual ownership only

---

## Files/selectors that look suspicious but should NOT be deleted yet

High caution:

- `client/src/match/InGameBoardShell.tsx`
  - older shell abstraction still used by other routes
- `client/src/components/MatchLayout.tsx`
  - still referenced
- `client/src/components/MatchNblBoardFrame.tsx`
  - active in current board stage
- `client/src/styles/match-standard-live-board.css`
  - active for `.rh-standard-live-board` routes
- `client/src/styles/match-board-architecture.css`
  - still imported globally
- all `.walnut-match-layout`, `.wl-top-rail`, `.wl-player-pill`, `.rh-live-board-zone`, `.rh-live-hand-deck`, `.nbl-board-frame`, `.nbl-board-canvas` rules in `walnut-live.css`
- `client/src/bot/RacehorseMatchArena.tsx`
- `client/src/bot/RacehorseMatchArena.css`

The last two look unused from import search, but should still be confirmed by runtime/import review before deletion.

---

## Suggested patch 3

Safest no-visual-change CSS consolidation step:

1. Create documentation-only ownership headers for the active board CSS regions.
   - no selector moves yet
   - no value changes yet

2. Define target file buckets without migrating styles yet:
   - `styles/board/board-layout.css`
   - `styles/board/board-hud.css`
   - `styles/board/board-shell.css`
   - `styles/board/board-surface.css`
   - `styles/board/board-hand-dock.css`
   - `styles/board/board-tiles.css`
   - `styles/board/board-interactions.css`
   - `styles/board/board-overlays.css`
   - `styles/board/skins/racehorse-matte.css`

3. First actual consolidation should be metadata-only, not visual:
   - identify one future canonical owner for each current selector family
   - annotate the legacy files as temporary owners
   - avoid moving any selectors that are currently shared across Daily Fritz, Play vs Fritz, Daily Puzzle, Learn, and Practice until parity is validated

4. Best first migration candidate after that:
   - move only the outer layout and shared HUD structure ownership into canonical board files
   - leave board surface, tiles, and hand dock for later because those are more coupled and more fragile

This gives the safest path toward a shared Racehorse board design system without risking gameplay or visual regressions prematurely.
