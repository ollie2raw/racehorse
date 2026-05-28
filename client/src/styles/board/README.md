# Racehorse Board CSS Namespace

## A. Purpose

This folder is the future canonical CSS namespace for the shared Racehorse in-game board system.

Its job is to provide a clean long-term home for the platform’s common in-game board architecture:

- outer match layout
- top HUD rail
- board shell
- board surface
- board meta pills
- board controls
- hand dock
- tile presentation
- interaction states
- overlays
- modals
- premium board skins

This namespace exists so future cleanup and redesign work has a clear destination instead of continuing to add more overrides to legacy global or mode-owned files.

## B. Why this exists

The active in-game board is currently layered across a large number of legacy, global, mode-specific, and experimental CSS files. That makes the board expensive to evolve and fragile to redesign.

Current active ownership is distributed across files such as:

- `walnut-live.css`
- `botMatch.css`
- `dailyFritzMatchBoard.css`
- `noBrainerLab.css`
- `match-hud-polish.css`
- `match-board-architecture.css`
- `match-standard-live-board.css`
- `game-interactions.css`
- `rh-glow-underline.css`
- `PlayVsFritz.css`
- `learn.css`
- `shared-ui.css`

Future redesign patches should not continue adding more overrides into those files for shared board concerns.

Instead:

- shared board structure should migrate into the `styles/board/` base files
- mode identity and premium surface direction should migrate into board skins

## C. File ownership map

### `board-layout.css`

Owns:

- viewport-level match layout
- outer board route layout
- vertical rhythm between HUD, board surface, and hand dock
- future ownership of `.walnut-match-layout` and `.game-layout-layer` responsibilities after migration

### `board-hud.css`

Owns:

- top HUD rail structure
- left / center / right HUD slots
- player score pills
- turn / status chip structure
- future ownership of `.wl-top-rail`, `.bot-top-rail`, `.wl-player-pill`, `.wl-center-status`, `.wl-turn-label` base styles

### `board-shell.css`

Owns:

- shared board shell composition
- studio shell
- board zone
- hand dock relationship
- future ownership of `.rh-live-studio-shell` and `.rh-live-board-zone` base structure

### `board-surface.css`

Owns:

- actual playfield / canvas visual surface
- board frame
- matte / felt / glass layer
- watermark / grid / board background
- future ownership of current `.nbl-board-frame` / `.nbl-board-canvas` visual responsibility after migration

### `board-meta.css`

Owns:

- board-adjacent metadata pills
- open ends pill
- boneyard count pill
- board status / meta bar
- future ownership of `.rh-board-meta-bar`, `.board-corner-pill`, `.open-ends-pill`, `.boneyard-pill`

### `board-controls.css`

Owns:

- zoom controls
- board utility buttons
- mute / fullscreen / home controls
- future ownership of `.board-zoom-tray`, `.wl-controls-tray`, `.control-pill`

### `board-hand-dock.css`

Owns:

- bottom hand dock shell
- tray rail
- hand row packing
- scroll behavior
- future ownership of `.rh-live-hand-deck`, `.wl-hand-area`, `.tray-rail`, `.tray-center`, `.hand-container`, `.hand-row` base layout

### `board-tiles.css`

Owns:

- shared domino tile presentation
- board tile vs hand tile visual treatment
- tile body / base sizing / polish
- future ownership of `.domino-tile`, `.domino-body`, and CSS-owned board/hand context styling where possible

### `board-interactions.css`

Owns:

- selected / playable / highlight / unplayable / disabled states
- hover / focus / active states
- glow underline behavior
- future ownership of tile interaction states currently split across `game-interactions.css` and `rh-glow-underline.css`

### `board-overlays.css`

Owns:

- board overlay layer
- flying tile overlay
- score track overlay shell
- portal overlay structure

### `board-modals.css`

Owns:

- board-related modal shell / card systems
- end-of-hand modal base
- game-over modal base
- Daily Fritz result modal base, with mode-specific accents delegated to skins

### `skins/racehorse-matte.css`

Owns:

- premium black matte / gold-brass Racehorse board identity
- mode accent variables
- board color tokens
- glow / shadow / texture values
- should eventually become the primary skin for Daily Fritz, Play vs Fritz, and Multiplayer
- should not own layout structure

## D. Legacy temporary owners

### `walnut-live.css`

Currently owns:

- major portions of match layout
- top HUD rail
- player score pills
- board shell
- board zone
- hand dock
- board surface overrides
- score track overlay shell

Should eventually stop owning:

- shared board layout
- shared HUD
- shared board shell
- shared hand dock
- shared board tile presentation

Should remain only as:

- a legacy compatibility layer until migration is complete

### `botMatch.css`

Currently owns:

- bot-specific HUD spacing
- Daily Fritz progress pill
- hand scroll behavior
- board meta pill typography
- flying tile overlay behavior

Should eventually stop owning:

- shared board HUD base
- shared hand dock structure
- shared board meta base

Should remain only as:

- bot-mode exceptions and mode-specific behavior styling

### `dailyFritzMatchBoard.css`

Currently owns:

- Daily Fritz-specific board overrides
- board meta/control polish
- Daily Fritz-specific board surface adjustments

Should eventually stop owning:

- shared board structure
- shared surface base
- shared board controls base

Should remain only as:

- Daily Fritz mode-specific accents until shared skin ownership is established

### `noBrainerLab.css`

Currently owns:

- `.nbl-board-frame`
- `.nbl-board-canvas`
- production board frame base imported through `MatchNblBoardFrame`

Should eventually stop owning:

- production in-game board surface outside Practice

Should remain only as:

- Practice / No Brainer Lab ownership, unless its board frame system is formally promoted and migrated into canonical board files

### `match-hud-polish.css`

Currently owns:

- shared control pill polish
- some board frame polish
- Daily Fritz result overlay styling

Should eventually stop owning:

- primary shared board chrome ownership

Should remain only as:

- temporary polish layer until those selectors migrate into canonical board files

### `match-board-architecture.css`

Currently owns:

- partial architectural board-playfield concepts
- overlapping shared board regions

Should eventually stop owning:

- ambiguous overlapping responsibilities

Should remain only as:

- either a clearly-scoped architecture helper or be retired after migration

### `match-standard-live-board.css`

Currently owns:

- parallel `.rh-standard-live-board` system
- board shell / surface / meta / controls for standard live board routes

Should eventually stop owning:

- duplicate canonical board responsibilities if the new namespace becomes primary

Should remain only as:

- a temporary parallel system until we decide whether it is promoted or retired

### `game-interactions.css`

Currently owns:

- shared hand tile state behavior
- selected / unplayable / highlight state motion
- hand dock row/scroll support

Should eventually stop owning:

- board-specific interaction ownership

Should remain only as:

- temporary shared interaction layer until board-interactions.css becomes primary

### `rh-glow-underline.css`

Currently owns:

- playable underline glow effect

Should eventually stop owning:

- board tile highlight effect for the shared in-game board

Should remain only as:

- a compatibility utility until glow underline behavior migrates into board-interactions.css

### `PlayVsFritz.css`

Currently owns:

- Play vs Fritz screen shell and shared Fritz panel language

Should eventually stop owning:

- shared in-game board base regions

Should remain only as:

- Play vs Fritz-specific screen, lobby, and mode-level styling

### `learn.css`

Currently owns:

- lesson-mode and guided board-route behavior

Should eventually stop owning:

- any shared non-lesson board base concerns

Should remain only as:

- lesson route ownership

### `shared-ui.css`

Currently owns:

- lesson/shared utility behaviors
- some hand-container and control adaptations

Should eventually stop owning:

- shared production board ownership outside its intended utility scope

Should remain only as:

- shared utility styling that is explicitly mode-safe

## E. Migration rules

- Move selectors only in small no-visual-change batches.
- Migrate one region per patch.
- Run build after every migration.
- Browser smoke test Daily Fritz, Play vs Fritz, Puzzle, Practice, Learn/Guided Match after each migration.
- Preserve selector names until parity is confirmed.
- Do not change visual values during migration patches.
- Do not delete legacy selectors until all mode references are confirmed.
- Mode-specific accents belong in skins.
- Shared layout / surface / tile structure belongs in base board files.
- Never mix gameplay logic with visual migration.

## F. Proposed migration order

1. Outer layout ownership
2. HUD rail base structure
3. Board shell wrappers
4. Board meta / controls
5. Hand dock
6. Overlays / modals
7. Board surface
8. Tile presentation / states
9. Final legacy cleanup
10. Black matte / gold-brass visual redesign using `skins/racehorse-matte.css`

## G. Current architecture relationship

Shared composition components now live in:

- `client/src/match/board/InGameBoardShell.tsx`
- `client/src/match/board/InGameBoardHud.tsx`
- `client/src/match/board/InGameBoardFrame.tsx`
- `client/src/match/board/InGameOverlayStack.tsx`

CSS migration should align with these component boundaries.

Suggested relationship:

- `InGameBoardShell.tsx` aligns with `board-layout.css`
- `InGameBoardHud.tsx` aligns with `board-hud.css`
- `InGameBoardFrame.tsx` aligns with:
  - `board-shell.css`
  - `board-surface.css`
  - `board-hand-dock.css`
  - `board-meta.css`
  - `board-controls.css`
- `InGameOverlayStack.tsx` aligns with:
  - `board-overlays.css`
  - `board-modals.css`

This should be treated as the canonical migration target going forward.
