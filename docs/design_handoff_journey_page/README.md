# Handoff: Single Player Journey Page

## Overview
Redesign of the "Journey" screen for the Single Player mode of the Racehorse dominoes app. Shows a chapter's nodes (matches/trials) as a winding vertical path the player progresses down, replacing a sparser earlier version with tighter spacing, distinct node types, and small navigation polish.

## About the Design Files
The bundled file (`Journey Page.dc.html`) is a **design reference built in HTML** — a working prototype of look, layout, and behavior, not production code to copy directly. The task is to recreate this design in the target codebase's existing environment (whatever framework/UI library the app already uses) following its existing component and state patterns. If no environment exists yet, pick the framework that best fits the app.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and node states are final; treat pixel values and hex colors below as the spec.

## Screens / Views

### Journey Page (single view, vertically scrolling)

**Layout (top to bottom):**
1. Top nav bar — full width, `#0d0f12` background, 1px bottom border `rgba(255,255,255,0.06)`, 18px vertical / 40px horizontal padding. Contains: logo mark + wordmark (left), nav links Multiplayer/Single Player/Tournament/Social/Learn (center, "Single Player" active in gold `#e8b23c` with 2px bottom border), rating/friends/profile chip (right).
2. Header row — max-width 1180px centered container, 32px top padding. Flex row, `justify-content: space-between`, wraps on narrow widths.
   - Left: "← Single Player" back button (dark card, `#12151a` bg, 1px border `rgba(255,255,255,0.1)`, 8px radius, 10px/16px padding) + title block (chapter number "01" in gold 14px bold, "Fritz Trail" H1 in Oswald 700 32px, subtitle "Chapter 1 · Proving Ground" in `#7c8492` 14px).
   - Right: stat chip card (`#12151a` bg, border `rgba(255,255,255,0.08)`, 10px radius, 14px/20px padding) with two stat groups separated by a 1px divider: icon circle + "9 / 12" / "NODES CLEARED" caption, and icon circle + current node name / "CURRENT NODE" caption.
3. Chapter tabs row — max-width 1180px, top border separator `rgba(255,255,255,0.06)`, 36px top margin, 24px top padding, horizontal scroll on overflow. 6 tabs, each: label (13px bold, gold `#e8b23c` if active / `#5c626c` if not) above a 3px progress track (`rgba(255,255,255,0.06)` bg) with a gold fill bar showing % complete (75% for the active chapter, 0% for locked chapters).
4. Trail map — max-width 900px centered container, 20px/24px padding, textured background: `repeating-linear-gradient(135deg, rgba(255,255,255,0.025) 0px 1px, transparent 1px 26px)`, 16px border radius.
   - An SVG path (viewBox `0 0 100 {height}`, `preserveAspectRatio="none"`) draws the winding trail as smooth cubic-bezier S-curves between node coordinates: a wide soft stroke (`rgba(255,255,255,0.05)`, 10px, non-scaling) underneath a dashed gold stroke (`#e8b23c`, 3px, dash `0.6 2.2`, non-scaling) on top.
   - 12 nodes positioned absolutely along the path, alternating x = 18% / 82% (last node centered at 50%), y spaced 168px apart starting at 90px.
5. Locked chapter teaser card below the path — dimmed (`opacity:0.6`) card, `#101216` bg, showing "02 HIGH LINE · LOCKED" and a dashed locked-circle icon.
6. Fixed vertical scroll rail on the right edge (22px from edge, vertically centered) — one small dot per node (6px, 10px if it's the node nearest viewport center), colored gold/gold-bright/translucent by state. Updates on scroll via a scroll listener comparing each node's bounding rect to viewport center.

### Node types (4 states, each a distinct shape/treatment)
- **Done**: 46px circle, `#14181d` fill, 2px border `rgba(232,178,60,0.55)`, green (`#4ADE80`) checkmark SVG polyline inside. Name label below in `#c7cbd1` 13px semibold.
- **Current**: small caption above ("FRITZ TRAIL · N", 11px bold, letterspaced, `#7c8492`), 74px circle with radial gradient (`#ffdd8a` → `#e8b23c` → `#b9860f`) + two-layer glow (`box-shadow: 0 0 0 6px rgba(232,178,60,0.14), 0 0 40px rgba(232,178,60,0.55)`). Name below in `#f4c94f` 15px bold.
- **Locked**: 38px circle, faint fill `rgba(255,255,255,0.03)`, 1.5px dashed border `rgba(255,255,255,0.18)`, no name shown — caption reads "LOCKED" in `#454b54` 11px bold. This is the "silhouette" treatment: existence is visible, identity is hidden until unlocked.
- **Boss (chapter finale)**: 92px hexagon (`clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)`), gradient fill (`rgba(155,124,255,0.12)` → `rgba(232,178,60,0.1)`), 1.5px dashed gold border. Caption "CHAPTER FINALE · LOCKED" in `#6a5f80` 11px bold.

## Interactions & Behavior
- The right-edge rail highlights the node currently nearest the vertical center of the viewport as the user scrolls the trail map (throttled scroll listener, recomputed via `getBoundingClientRect`).
- Chapter tabs are horizontally scrollable if they overflow.
- No modal/side panel opens on node click in this version — node click behavior (e.g. opening a match setup screen like the existing "Play vs Fritz" screen) should be wired to the real navigation stack; the design only specifies the map, not the destination screen.
- Locked nodes and the locked next-chapter teaser are visual-only in this prototype — real unlock logic (progression rules, node dependencies) lives in the app's existing game-state logic and should gate what's rendered as done/current/locked.

## State Management
- `activeIdx` — index of the node nearest viewport center, drives the scroll rail highlight. Recompute on scroll.
- Node list — array of `{ name, type }` per node for the current chapter; `type` drives which of the 4 visual states renders. In production this should come from the player's real progress data for the chapter (cleared nodes, current node, locked nodes, chapter boss), not a hardcoded array.
- Per-chapter progress percentage for the tab progress bars — derived from cleared-nodes / total-nodes per chapter.

## Design Tokens
**Colors**
- Background: `#0a0b0d` (page), `#0d0f12` (nav), `#12151a` (cards), `#101216` (locked teaser card)
- Borders: `rgba(255,255,255,0.06–0.1)` depending on emphasis
- Gold accent: `#e8b23c` (primary), `#f4c94f` (bright/current-label), `#ffdd8a` (highlight), `#b9860f` (shadow)
- Green (done check): `#4ADE80`
- Text: `#f5f6f7` (primary), `#c7cbd1` (secondary), `#7c8492` (muted/caption), `#5c626c` / `#454b54` / `#6a5f80` (locked/disabled captions)

**Typography**
- Headings / wordmark: Oswald, 500–700 weight
- Body / UI: Inter, 400–700 weight
- Scale used: 32px (H1), 20px (chapter teaser heading), 15–18px (labels/values), 13–14px (body/nav), 11px (uppercase captions, letter-spacing ~0.6–1px)

**Spacing / radii**
- Card radius: 8–16px depending on size
- Node vertical spacing: 168px
- Container max-widths: 1180px (nav-aligned sections), 900px (trail map)

## Assets
No image assets used — all node shapes are CSS (circles, hexagon via `clip-path`, checkmark via inline SVG polyline). If the production app uses illustrated node icons or chapter banner art elsewhere, those should be layered in separately; this design intentionally keeps the map graphical language minimal and code-drawn to match the rest of the app's clean card-based UI.

## Files
- `Journey Page.dc.html` — full prototype (structure + logic combined). Logic of note: node position/path generation and the scroll-based active-node tracking (`updateActive` in the component's `componentDidMount`/scroll listener).
