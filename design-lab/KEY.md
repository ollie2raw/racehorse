# KEY (keep closed while judging the gallery blind)

The gallery (`design-lab/gallery/index.html`) and the PNGs (`design-lab/png/`) only use the letters below. File names:
`<viewport>-<set>.png`, viewports `desktop` 1440x900, `laptop` 1512x982, `phone` 844x390.

| PNG set | meaning |
|---|---|
| `ref` | Current app look (reference, not a variant) |
| `t-A`, `t-B`, `t-C` | Tile variant A/B/C on the CURRENT board, larger hand tiles on desktop/laptop |
| `b-A`, `b-B`, `b-C` | Board variant A/B/C with CURRENT tiles, larger hand |
| `AA-idle`, `BB-idle`, `CC-idle` | Tile X + board X + proposed HUD (boneyard, Fritz count), no tile selected: open ends marked |
| `AA-sel`, `BB-sel`, `CC-sel`, `ref-sel` | Same, a 5-pip tile selected: only the legal ends (5) show the active marker |

## Tile variants

| Letter | Design idea | Pips | Palette | Gradients? |
|---|---|---|---|---|
| A | "Chamfer rim": rotation-invariant two-ring thickness + contact shadow, solid ivory face | 1.2x | hue-faithful, darker for contrast on ivory (`#1b3fa0 #0a5c66 #0b86c9 #ee6a0a #2a8a3a #c01d24`) | none (matte-compliant) |
| B | "Stepped slab": 4-step directional side edge (light from top, counter-rotated with the tile), engraved pip wells with a light rim | 1.22x | current colours kept | none (matte-compliant) |
| C | "Edge-light": gradient rim highlight (the one gradient: only on the 2px tile border), dark outline | 1.2x | widest-spread (`#2a2a8c #0d6b5a #1581d1 #e8700e #23863d #a80f3a`) | **yes: rim only; DEPARTS from AGENTS.md section 3 (owner decision)** |
| SEL (perf control only) | current look re-expressed with the lab's pip attribute selectors | current | current | n/a, not in gallery |

All three drop the per-tile noise overlay (feTurbulence + mix-blend soft-light), the `::after` inset overlay and the board-tile `filter: drop-shadow`.

## Board variants

| Letter | Design idea | Playable-end marker | Gradients? |
|---|---|---|---|
| A | "Midnight linework": homepage navy `#0b1220`, big static geometric lines (SVG), thin blue rim, no grid | solid 2px electric-blue outline ghost tile; brighter + arrow when active | none (matte-compliant; the lines are an SVG background image) |
| B | "Lane bed": lighter charcoal surround `#131821`, a solid darker lane the tiles sit in, brass rim | dashed brass ghost tile with a pip-value badge | none (matte-compliant) |
| C | "Vignette felt": static radial vignette + dot grid | dashed cyan ghost tile with a centre dot + pip-value badge | **yes: radial vignette + dot grid; DEPARTS from the matte rule (owner decision)**. Note the CURRENT board already paints a 180deg linear gradient plus a grid made of two linear-gradients (read from `match-live-surface.css:51-55`), so "no gradients" is already not literally true today. |

## Detail page

`gallery/details.html`: boneyard and Fritz tile count. Option **X** = current (one outlined domino icon + number; row of blank ivory tile backs with no number). Option **Y** = proposed (three stacked tile icon + number + "BONEYARD DRAW" label; numeric chip "5 FRITZ TILES LEFT" + mini tile row).

## Motion page

`gallery/motion.html`: tile settle and score pulse. Buttons replay; a checkbox simulates `prefers-reduced-motion`.
