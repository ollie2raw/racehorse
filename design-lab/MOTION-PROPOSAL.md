# Micro-motion proposal: tile settle and score pulse

Labels: **[read]** from code, **[measured]** by a lab run (numbers in `results/motion-bench.md`), **[guess]**. Prototype: `design-lab/gallery/motion.html` (replay buttons, a "current app motion" selector, a reduced-motion simulation checkbox). Not wired to the app.

## 0. What already exists (read this before judging the proposal)

- **[read]** A motion vocabulary exists: `client/src/ui/motion.css` defines `--rh-motion-micro 120ms`, `-state 180ms`, `-tile 220ms`, `-result 300ms`, `-reward 360ms`, and an ease `cubic-bezier(.2,.8,.2,1)`.
- **[read]** Tile arrival already animates: `components/board/placementFeedback.css` runs `rh-tile-land` (opacity .65 to 1, `translate` 0 -6px to 0, `scale` 1.035 to 1) over 220 ms on `.board-tile-wrapper[data-placement-feedback='arrive'] > .domino-tile`, plus a flying tile clone (`useTileFlight.ts`, which uses `filter: drop-shadow` and `will-change: transform`) and a thin ivory contact ring (`contactRing.ts`).
- **[read]** Score digits already pulse: `animatedScore.css` `rh-score-acknowledge` (scale 1.08 over 360 ms) and `feedbackNumber.css` `rh-number-change` (opacity/translateY 2px, 180 ms).
- **[read]** `prefers-reduced-motion: reduce` is already handled in each of those files (animation: none); 43 occurrences of the media query exist across the client CSS.

So the honest framing is: **this is a small tuning of existing motion, and it is only worth doing if a tile variant with real thickness is adopted** (a thick tile that lands with no shadow response reads as a sticker). If the owner keeps the current tile, keep the current motion.

## 1. Proposed deltas (prototype shows both versions side by side)

| Motion | Current (read) | Proposed | Why |
|---|---|---|---|
| Tile settle | 220 ms, from -6px / 1.035x, opacity .65 | 180 ms, from -10px / 1.06x, 62% keyframe undershoot (+1px, .995x), contact-shadow sibling fades in (opacity only) | thicker tile reads as "dropped onto the table"; shadow responds without animating `box-shadow` |
| Score pulse | 360 ms, scale 1.08 on the digits | 240 ms, digits 1.14x then back, plus a 2px brass ring that fades 0 to .85 to 0 while growing 1.12x (the ring is a pseudo-element: transform + opacity) | readable at a glance on a phone; ring is the only new element |
| Open-end markers | (static in the proposal) | **no animation**. The current gold zone pulse animates `box-shadow` forever (`wl-zone-pulse-gold`, `walnut-live.css:1365`, **[read]**) which repaints continuously | steady state should cost nothing |

## 2. Rules (the budget)

1. Only `transform` and `opacity` (and the individual `translate`/`scale` properties the app already uses). No `box-shadow`, `filter`, `width/height`, `top/left`, `background` in any keyframe.
2. `will-change` is set while the animation runs and removed on `animationend` (the prototype does this); no permanent layers.
3. At most 2 concurrent animated elements per placement (one tile, one score pill). A hand-over or multi-score burst must queue, not stack.
4. Duration caps: settle <= 180 ms, pulse <= 240 ms; nothing infinite.
5. Perf budget on the phone-4x profile (iPhone 14 landscape, CDP CPU 4x): **[proposed gate]** over the 40-settle bench, style recalc + layout must not exceed the current-motion row by more than 10%, and frames over 25 ms must be 0 more than current. **[measured]** results are in `results/motion-bench.md` and summarised in `REPORT.md`; the bench measures main-thread cost only, because headless Chromium rasterises in software and cannot show real GPU compositing cost (that gap is the main way this could be wrong; the check is a Safari/WebKit run on a real phone, see `docs/ios-device-checklist.md`).

## 3. prefers-reduced-motion plan

| Path | Behaviour |
|---|---|
| `no-preference` | the proposed animations above |
| `reduce` (media query, also covered by a `data-reduce` hook in the lab for preview) | **tile settle**: no translate/scale; a 120 ms opacity fade of the tile only. **score pulse**: no digit scaling; the ring fades 0 to .85 to 0 over 240 ms with no growth. Nothing moves, so no vestibular trigger; the change is still perceivable. |
| in-app setting (if one exists or is added) | same as `reduce`; keep the media query as the default source of truth and do not add a second switch unless asked |

**[read]** the current app's reduced path is `animation: none` (no feedback at all). The proposal adds a non-motion cue; **wrong if** the owner's accessibility reading is that reduced motion should mean no animation of any kind: then use `animation: none` exactly as today and drop the fade rows.

## 4. What would prove this wrong

- Main-thread numbers equal or better than current but the animation janks on a real iPhone: the lab cannot see GPU compositing; run `docs/ios-device-checklist.md` on a real iPhone.
- Placement already feels fine to the owner with the current 220 ms land: then the tile-settle delta is not worth the diff; keep only the contact-shadow fade if tile variant B/A is adopted.
