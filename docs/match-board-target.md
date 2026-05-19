# Match Board Target

## 1. Purpose

This document guides future in-game board redesign work for Racehorse Dominoes.

It is used together with `AGENTS.md`, `docs/agent-skills/racehorse-design-source-of-truth.md`, and the `racehorse-ui-fidelity` skill.

The intent is to define the target visual direction for the match board before implementation so future redesign passes stay aligned, scoped, and consistent with the Racehorse product identity.

## Design reference files

- `docs/design-references/homepage-identity.png`
  - Locked platform identity source of truth.
- `docs/design-references/match-board-old.png`
  - Old deployed in-game board design.
- `docs/design-references/match-board-current.png`
  - Current in-progress in-game board redesign.
- `docs/design-references/match-board-target.png`
  - Target/reference composition for the match board’s arena depth, HUD density, score track, tray integration, and game-table feel.

If there is conflict between `homepage-identity.png` and `match-board-target.png`, `homepage-identity.png` wins for brand identity, while `match-board-target.png` guides board layout, depth, and in-game composition.

## 2. Identity anchor

The Racehorse homepage is the source of truth for platform identity.

The in-game board should inherit and extend these platform signals:
- deep midnight navy / blue-black background
- electric blue/cyan accents for UI energy, active interaction, and gameplay focus
- restrained brass / warm gold accents for Racehorse scoring identity, competitive emphasis, and premium framing
- warm ivory typography for primary readability
- premium dark cards and glass-like containers
- subtle geometric linework and controlled environmental texture
- controlled glow, soft depth, and polished but restrained contrast

The separate board reference image may guide:
- arena layout
- frame depth
- layering
- HUD density
- overall game-table composition

But the final result must still feel like the homepage identity extended into live play, not a separate visual universe.

## 3. Target board feel

The target board should feel like a premium digital strategy table.

It should be:
- game-native
- focused
- competitive
- polished
- immersive without becoming theatrical

Relative to the homepage, the board can be more spatial and more immersive, but it must still feel like the same product family.

Desired qualities:
- layered arena depth
- beveled glass/metal framing
- recessed play surface
- compact, premium HUD treatment
- deliberate scoring/racing identity
- clean presentation of interactive pieces

The board should feel like the player has entered a live Racehorse match arena, not a generic game app shell.

## 4. Required screen regions

The target board direction must explicitly cover:
- global/top bar
- match HUD/player cards
- center turn badge
- race score track
- main board arena
- hand tray/domino row
- bottom action dock
- game state chips such as tiles left/open ends

## 5. Visual requirements by region

### Global/top bar

Desired look:
- a dark, integrated header that feels native to the homepage chrome
- midnight navy / blue-black base with subtle depth rather than flat black
- slim brass or blue edge highlights used sparingly
- compact but premium account/match framing

Practical implementation terms:
- use a dark layered background with low-contrast gradient separation
- keep branding crisp and left-anchored
- avoid oversized chrome or heavy framed containers
- use uppercase micro-labels only where they improve hierarchy
- preserve strong left/right alignment and reduce dead space

### Match HUD/player cards

Desired look:
- compact dark glass cards with clean hierarchy
- premium but restrained framing
- immediate score readability
- clear player/opponent distinction without noisy decoration

Practical implementation terms:
- use translucent dark surfaces or deep opaque navy cards with subtle border contrast
- apply thin brass or cool-blue trim selectively rather than glowing every edge
- make player names, score, and match state visually grouped
- compress spacing so the HUD reads as deliberate and competitive, not loose
- use warm ivory for primary text, cooler muted text for secondary metadata

### Center turn badge

Desired look:
- a signature state object that clearly communicates turn ownership and match urgency
- premium and branded, not a generic pill

Practical implementation terms:
- use a compact capsule or lozenge with stronger contrast than surrounding HUD elements
- use cyan/green for active-turn emphasis and brass for neutral framing or scoring-related context
- keep text short, uppercase where appropriate, and highly legible
- use a subtle glow or inset treatment rather than loud neon

### Race score track

Desired look:
- a signature Racehorse identity object
- premium, mechanical, intentional, and immediately legible

Practical implementation terms:
- keep the existing race-track mechanic exactly
- present it as a dark translucent capsule, bar, or mounted track with subtle brass trim
- refine peg/marker contrast so score positions are visible at a glance
- clean up holes, pips, dots, separators, and marker shadows
- avoid cartoon styling, bright toy colors, or decorative clutter
- ensure the score track feels more “product signature” than “utility widget”

### Main board arena

Desired look:
- a refined competitive table surface with physicality and depth
- more immersive than the homepage, but still brand-consistent

Practical implementation terms:
- replace warm brown/felt identity with espresso-black, walnut-black, or blue-black surface treatments
- use a recessed central arena with layered shadow and subtle inner bevel
- introduce restrained brass edging or frame lines to define the play field
- use very subtle geometric or track-inspired texture, not obvious patterns
- add soft blue-black inner shadow to give the board a premium inset feel
- preserve board readability over texture at all times

### Hand tray/domino row

Desired look:
- a dark navy glass dock visually related to the homepage bottom navigation dock
- strong sense of containment and interaction readiness

Practical implementation terms:
- use a wide bottom tray with subtle top-edge glow or highlight line
- keep tile spacing clean and deliberate
- make the tray feel like part of the arena, not a separate utility strip
- selected/playable states should use cyan or brass outlines/glows depending on context
- disabled/unplayable tiles should dim cleanly without becoming muddy or low-contrast

### Bottom action dock

Desired look:
- a compact premium control module rather than floating temporary buttons

Practical implementation terms:
- group controls into a consistent dark glass dock
- normalize icon size, stroke weight, padding, and hover behavior
- use active state emphasis sparingly and consistently
- avoid overbuilding the control area into a secondary dashboard
- ensure controls never compete visually with the board or hand tray

### Game state chips such as tiles left/open ends

Desired look:
- compact, readable state indicators that feel like part of the premium HUD system

Practical implementation terms:
- use small dark capsules, chips, or mini-panels with clear contrast
- apply brass for scoring/race emphasis and cyan for interactive/state emphasis
- keep labels concise and easy to scan
- use muted secondary text for labels and warm ivory for values
- avoid oversized badges or playful mobile-style counters

## 6. What to preserve

Future redesign work must preserve:
- gameplay logic
- score race track signature
- domino readability
- turn clarity
- action clarity
- board state readability

Visual upgrades must never make the game harder to read or the interaction model harder to understand.

## 7. What to avoid

Do not drift into:
- casino table
- western/racetrack cliché
- generic sci-fi HUD
- excessive neon
- brown felt identity
- generic SaaS dashboard
- overcomplicated controls
- redesigning away from the homepage identity

More specifically:
- do not make the board look like a poker table
- do not turn the HUD into a spaceship dashboard
- do not use brass everywhere
- do not use glow as a substitute for hierarchy
- do not sacrifice domino legibility for atmosphere

## 8. Pass plan

Use one pass at a time:

- Pass 1: layout, structure, proportions
- Pass 2: board arena depth and hand tray integration
- Pass 3: HUD, score track, controls
- Pass 4: final polish

Each pass should be evaluated against two anchors:
- the Racehorse homepage identity
- the target board composition and depth direction

If there is a conflict between the board reference and the homepage identity, the homepage identity wins.
