# Gameplay mobile specification

Gameplay is a distinct shell and workstream. Keep game rules, scoring, draw/pass, move validation, bot policy, multiplayer protocol, persistence and server behavior unchanged.

## Current pipeline and layout owners

Fritz/Ghost: `BotMatchRoute` / `GhostMatchRoute` → `BotMatchScreen` → session/action hooks → `LiveMatchScreen` → `MatchLiveLayout`, `MatchBoardCanvas`, `InGameBoardFrame`, `InGameBoardShell`, `InGameBoardHud`, `Board` and `useBoardCamera`. Daily Fritz/Tournament/Learn enter the same game infrastructure through their own session and callbacks. Board geometry is in `client/src/components/board/boardLayout.ts` and `useBoardCamera.ts`; hand and controls have separate component/CSS ownership. `match-live.css`, `match-live-theme.css`, `match-live-solo.css`, `gameLayoutLayers.css`, `styles/board/*`, and legacy `styles/walnut-live.css` all contribute styles.

Do not collapse these into a single giant mobile page component. A game presentation adapter can allocate named regions; existing owner components continue to render controls and game state.

## Target allocation at 844×390

Use safe-area-adjusted inner rectangle. Initial budgeting to validate with a live board fixture:

| Region | Height target | Required contents |
|---|---:|---|
| Match top HUD | 48–56px | both player identity/score, turn state/timer; may place turn state as compact center badge |
| Board | ~205–225px | open ends, played chain, placement affordances and watermark/background; receives measured box for camera |
| Hand/action tray | ~76–92px | every tile selectable, clear selected/legal state; draw/pass controls are not buried by hand |
| Controls / gaps | remaining ~17–35px distributed | zoom/reset, sound, boneyard count, pass/draw, safe padding; secondary controls can move into an accessible overflow sheet |

This is a constraint envelope, not fixed coordinates. On 667×375 and 740×360, preserve full usable board and legal touch controls first. Compact secondary names/stats, not tile interaction. **Frozen usability minima:** measured board viewport ≥430×160 CSS px, hand tray ≥72 px high, tile short edge ≥36 px, and legal action hitboxes ≥44×44 px. In portrait gameplay only, falling below any minimum triggers a dismissible rotate recommendation while play remains available; in short landscape, use board fit/hand rail adjustments and treat failure as a layout defect. Rotation must preserve match state and remeasure/refit the camera without reload.

## Interaction audit and touch behavior

Existing hover selectors (`:hover` across Home/Solo/Learn/Ghost/Tournament/Daily Fritz/Social, e.g. `SinglePlayerModes.css`, `learn.css`, `ghostMode.css`) communicate elevation/brightness but should not contain unique information. Ensure selected, focus-visible, pressed, disabled and legal-move states are persistent/available on touch. Use `@media (hover:hover) and (pointer:fine)` only for hover enhancement.

Repo-level reachability QA treats 44px minimum targets as its preferred bar (WCAG 2.5.5 legacy target; spatial exemption under 2.5.8 is coded). Important game controls, nav, draw/pass, and exit should be 44×44 CSS px where practical. If boneyard/zoom/audio are compact, separate hitbox from icon size. Audit all controls with the existing reachability function.

- Domino input should be tap tile → tap legal placement zone as the primary path. Drag can remain a progressive enhancement; game action cannot require drag, hover, right-click or hover tooltip.
- Keep an explicit accessible list/action path for legal endpoints if the board is canvas/positioned and endpoints are difficult to hit. Screen reader names should describe tile and placement side.
- Selected tile has strong outline/elevation and does not obscure hand neighbors. Unplayable tile must remain visible and explain disabled state without relying on color alone.
- Draw/pass is explicit and state-labeled; do not infer pass solely from a disabled hand.
- Pinch zoom/pan should not prevent taps or accidentally scroll the page. If one-finger panning exists, retain a dedicated zoom/pan control alternative.
- Eliminate hover-only tooltip facts; use persistent count/label or an explicit tap sheet. Right-click context actions need overflow menu equivalents.
- Inputs/forms/dialogs use native keyboard, focus order, and internal scroll; no custom control should lose focus when match state updates.

## Camera, sizing, touch and animation

`useBoardCamera` already measures a container with ResizeObserver-like viewport dimensions and calls board layout fitting, so use actual mobile available rectangle rather than scale the entire interface. Determine minimum tile geometry with a playability test across 7-tile and larger hands, board chain length, doubles, edge placements and zoom levels. Tile body must remain recognizable and individually tappable; if full-width hand cannot fit at usable tile width, use controlled overlapping/scrolling carousel with visible adjacent tiles and explicit selected tile, validated against max hand count. Never hide tiles through overflow clipping.

The current camera input hook is mouse-oriented: wheel zoom, left-button drag-pan and double-click fit are in `useBoardPointerControls.ts`/`Board.tsx`; explicit on-screen zoom controls exist. Do not assume pinch works. Keep tap-tile/tap-endpoint as the canonical action and make pan/zoom optional touch gestures with controls retained as a deterministic alternative. Right-button pan is ignored; no right-click-only board action was found in these camera handlers.

Use compositor transforms for short interactions, avoid layout-triggering animation across all pieces on each move, pause/nonessentially simplify ambient effects for `prefers-reduced-motion`, and ensure socket/state updates do not remount board or destroy camera/focus. Reconnect and background/resume must return the same match with the same selection safely cleared or restored.

## Required live fixtures

Capture normal Fritz, Ghost, Daily Fritz, Learn guided and tournament/multiplayer match if current contexts differ. States: opening draw, ordinary legal turn, both open ends, double placement, selected tile, draw available, forced pass, opponent turn, disconnect/reconnect overlay, confirmation dialog, completed match, review/result. For each, assert shell layout does not alter resulting move or game state; use existing behavior/invariant tests, not visual snapshots alone.
