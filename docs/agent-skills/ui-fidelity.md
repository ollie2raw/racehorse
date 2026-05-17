# Racehorse UI Fidelity Skill

Use this whenever changing page layout, visual design, CSS, UI polish, mockup implementation, responsive layout, HUDs, modals, cards, tabs, leaderboards, social pages, tournament screens, or game-screen presentation.

## Goal

Make Racehorse UI changes feel premium, polished, on-brand, and complete.

Do not ship rough first-pass UI.

## Racehorse visual identity

Racehorse should feel like:
- premium dark esports
- futuristic but clean
- dark navy / near-black background
- gold primary accent
- blue/cyan secondary accent
- subtle glow, not overdone neon
- rounded glassy panels
- strong hierarchy
- bold chunky headlines
- small uppercase eyebrow labels with letter spacing
- dense but readable competition UI

Avoid:
- flat black empty boxes
- huge dead space
- weak gray-only panels
- random colors
- generic dashboard look
- unfinished placeholder-feeling rows
- over-glowing everything
- changing unrelated screens accidentally

## Required audit before implementation

Before editing, answer:

1. What page/component is being changed?
2. What existing design patterns should be reused?
3. What current screenshot problems are being solved?
4. What parts of the layout need structure changes, not just CSS?
5. What data states must be handled?
6. What sparse/empty state exists?
7. What responsive breakpoints matter?
8. What unrelated screens might share these classes?

## Files to inspect

Common:
- client/src/App.tsx
- client/src/App.css
- client/src/styles/walnut-live.css
- client/src/styles/match-hud-polish.css
- client/src/styles/racehorse-background.css
- client/src/styles/game-interactions.css

Feature-specific:
- relevant component .tsx
- relevant feature CSS
- shared card/button/pill components
- images/assets used by similar pages

## Implementation rules

- Do not just restyle broken structure; fix layout structure if needed.
- Do not leave giant empty areas.
- Handle sparse data gracefully.
- Use real data first.
- If placeholder rows are needed, make them clearly muted/skeleton/non-clickable.
- Use existing Racehorse tokens/styles where possible.
- Scope CSS to the feature page to avoid global regressions.
- Avoid broad selectors like `.screen > *` unless absolutely necessary.
- Do not use CSS that breaks fixed overlays, portals, or game animation layers.
- Do not change gameplay logic or backend logic during UI polish.

## Required visual checks

After implementation, inspect:

1. Does the page look premium at first glance?
2. Is there strong hierarchy?
3. Is spacing consistent?
4. Are panels/cards balanced?
5. Are important actions obvious?
6. Are empty states polished?
7. Are rows/cards dense enough?
8. Are accents used intentionally?
9. Does it look native to Racehorse?
10. Did any unrelated screen change?

## Screenshot review loop

Do not stop after first implementation.

Required process:
1. Implement first pass.
2. Run local app.
3. Capture or inspect screenshot.
4. Compare against goal/current problem.
5. Do a polish pass fixing obvious issues:
   - spacing
   - density
   - alignment
   - weak hierarchy
   - card proportions
   - text size
   - glow strength
   - empty space
   - responsive issues
6. Only then report done.

## Common Racehorse UI patterns to preserve

- gold active nav underline
- dark glass panels with subtle border
- small uppercase section labels
- glowing gold selected states
- blue/cyan informational accents
- green success
- red/pink loss/error
- chunky white headings
- pill buttons with compact uppercase labels
- rounded 2xl cards
- subtle background gradients

## Tests/build

For UI-only changes, run:

npm run build --prefix client

If shared components or logic changed, also consider:

npm run build --prefix server
npm run test --prefix server

## Final report format

UI Fidelity Review

What changed:
...

Screens affected:
...

Current issue fixed:
...

Design patterns reused:
...

Sparse/empty states:
...

Responsive behavior:
...

Files changed:
...

Build result:
...

Remaining visual risks:
...
