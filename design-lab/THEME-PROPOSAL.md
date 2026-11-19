# Theme abstraction proposal: swappable tile sets and board surfaces

Status: proposal only. Nothing here is implemented in the app. Every claim is labelled **[read]** (read from code in this repo), **[measured]** (a number this lab produced), or **[guess]**, with what would prove it wrong.

## 1. What the code does today

- **[read]** Tile paint is owned by `.screen.game-screen.walnut-live.rh-match-live:not(.learn-lesson-screen) .domino-body` and its `::before`/`::after`, `.pip`, `.domino-divider` rules in `client/src/match/match-live-theme.css` (lines ~459-540), all with literal values and `!important`. The older `racehorse-matte-skin` copy in `styles/board/skins/racehorse-matte.css` is a legacy alias for routes that do not use `.rh-match-live`. Learn, Journey, hand-over modal, pre-game draw and the practice lab each restyle `.domino-body` again in their own files (15 CSS files contain `.domino-body`).
- **[read]** Pip colour is **inline** `backgroundColor` per pip from `PIP_COLORS` in `client/src/components/DominoTile.tsx`; pip size is inline (`size/4.2`). So CSS cannot recolour a pip by value except by matching the serialised `style` attribute (what the lab does) or with `!important` on all pips.
- **[read]** Board surface is `.nbl-board-canvas, .board-area.wl-board-area` in `match-live-surface.css:47-60` (solid `#0c0e12` + two 26px linear-gradient grids + a 180deg linear gradient, all `!important`). Open-end markers are `.placement-zone.open-end-glow` (blue, `filter: blur(4px)`) in `styles/walnut-live.css:1327` and a green variant in `styles/match-gameplay.css:105`, overridden for `.active` by `match-live-theme.css:445`.
- **[read]** Rotation of board tiles is an inline `transform: rotate()` on the tile button, so any directional shadow rotates with it.

## 2. Mechanism

Two attributes on the match root (`.game-screen`), both optional; absent = the default theme:

```html
<div class="screen game-screen walnut-live rh-match-live"
     data-rh-tile-set="slab"          <!-- absent = classic -->
     data-rh-board-surface="midnight"> <!-- absent = classic -->
```

All themed values become CSS custom properties **with the current literal as the fallback**, in the existing rules:

```css
/* match-live-theme.css, step 0: same selector, same specificity, value now a variable with the old literal as fallback */
.screen.game-screen.walnut-live.rh-match-live:not(.learn-lesson-screen) .domino-body {
  border-radius: var(--rh-tile-radius, 7px);
  background-color: var(--rh-tile-face, #f4ebda) !important;
  background-image: var(--rh-tile-face-image, radial-gradient(...), radial-gradient(...), linear-gradient(...)) !important;
  border: var(--rh-tile-border, 2px solid rgba(108, 92, 68, 0.62)) !important;
  box-shadow: var(--rh-tile-shadow, inset 0 2px 0 rgba(255,255,255,.94), /* ...the current list verbatim */ ) !important;
}
```

A theme is then a file that sets variables only, no selectors that reach into components:

```css
/* styles/board/themes/tiles-slab.css */
.game-screen[data-rh-tile-set="slab"] {
  --rh-tile-face: #f4ebda;  --rh-tile-face-image: none;  --rh-tile-border: 1px solid #7c6c50;
  --rh-tile-shadow: inset 0 1.5px 0 #fff, 0 1px 0 #d9cdb0, 0 2px 0 #cbbd9b, 0 3px 0 #b9a987, 0 4px 0 #a08f6b, 0 8px 7px -2px rgba(0,0,0,.6);
  --rh-tile-noise: none;            /* the ::before overlay is `content: var(--rh-tile-noise-content, '')` => off */
  --rh-pip-scale: 1.22;  --rh-pip-1: #1e3a8a; --rh-pip-2: #0B5A3C; /* ... */
}
```

Variables the lab variants actually needed (so this list is evidence-based, not speculative): `--rh-tile-{face,face-image,border,radius,shadow}`, `--rh-tile-noise` (on/off), `--rh-tile-after` (on/off for the inset `::after` overlay), `--rh-tile-board-filter` (the board-tile `drop-shadow`, today always on), `--rh-pip-scale`, `--rh-pip-shadow`, `--rh-pip-{1..6}`, `--rh-divider-{width,color,shadow}`, `--rh-board-{bg-color,bg-image,bg-size,rim}`, `--rh-board-lane` (on/off: the `::before` lane in variant B), `--rh-end-{border,fill,border-active,fill-active,badge}`.

**One non-CSS change is required for pips**: stop emitting inline `backgroundColor` and emit a value class instead (`<div class="pip pip-3">`), with the default colours in one base rule `.pip-3 { background-color: var(--rh-pip-3, #38bdf8) }`. Pip size scaling then needs no change (`transform: scale(var(--rh-pip-scale, .98))`). For directional thickness the tile also needs its rotation exposed as a variable (`style={{'--rh-rot': rotation+'deg'}}`), because a downward side edge on a tile rotated 90 degrees points sideways (lab variant B uses `sin()/cos()` on that variable). **[guess]** both are a few lines in `DominoTile.tsx`; **wrong if** `DominoTile` has other callers that depend on the inline colour (e.g. a screenshot test or a `style` assertion). Run `grep -rn "backgroundColor" client/src --include=*.test.*` before doing it; I did not.

Selection of the theme: one hook (e.g. `useBoardTheme()`), reading a local preference with `'classic'` as the default, sets the two attributes on the match root. It must not live in `client/src/multiplayer/` (restricted); the match screen (`client/src/match/`) already owns the root class list. Theme CSS files should be code-split and loaded only when selected, so the default path adds zero bytes. **[guess]** about 1-2 KB per theme file; the lab's `tiles.css` + `boards.css` are 11 KB raw (with comments) before minification, so measure before promising.

## 3. Keeping the default theme pixel-identical

The risk is that replacing literals with `var(--x, literal)` changes nothing in the computed style but something subtle in the cascade (e.g. a variable defined higher up leaking in). The plan, in order:

1. **Step 0 lands alone** (a pure refactor PR): literals become `var(--rh-*, literal)`; no theme file exists; no attribute is ever set. The existing baselines must pass **without regenerating them**.
2. **Do not trust the 2% tolerance.** **[read]** `e2e/board-routing-visual.spec.ts` uses `maxDiffPixelRatio: 0.02`, which is loose enough to hide a one-pixel shadow change across a whole board. For the step-0 PR add a one-off stricter check (not committed to the suite): run the same specs with `maxDiffPixels: 0` locally and a computed-style dump (`getComputedStyle` of `.domino-body`, `.pip`, `.domino-divider`, `.nbl-board-canvas`, `.placement-zone`, each in hand/board/selected/unplayable states) diffed before vs after. Both must be exactly equal.
3. The theme variables are only ever **set under the attribute selector**, never on `:root`, so the default (no attribute) cannot see them. Add an architecture check: no `--rh-tile-*`/`--rh-board-*` definition outside `styles/board/themes/`.
4. A computed-style test per theme: with the attribute set to `classic` explicitly the result must equal the no-attribute result.

**[read]** the pixel baselines are opt-in (`MOBILE_VISUAL=1`, project `chromium-mobile-visual`), stored with no platform suffix at `e2e/screenshots/board-routing/*.png` (`snapshotPathTemplate: '{testDir}/screenshots/{arg}{ext}'`), and `board-camera.spec.ts` / `board-routing-geometry.spec.ts` are numeric (no screenshots), so they are unaffected by any paint change **[read]**; they could only break if a variant changed layout (tile size, hand dock height). The lab's larger-hand proposal does change layout, so it must be a separate decision and PR from the paint themes.

## 4. How a variant theme gets its own baselines

- Parameterise the visual spec by theme: the harness already takes a query string (`openRoutingHarness(page, 'fixture=longDown')`); add `&theme=slab` that sets the two attributes before first paint. The default run (no `theme`) is untouched.
- Baseline path per theme: `['board-routing', theme, name.png]`, i.e. `e2e/screenshots/board-routing/slab/<name>.png`, keeping the default directory byte-for-byte unchanged. Because `snapshotPathTemplate` has no platform suffix, theme baselines are as portable as the default ones.
- Variant themes run only in an opt-in project (e.g. `chromium-mobile-visual-themes`), not on every PR; the default theme stays in the existing project.
- **Operational traps (from this repo's own notes)**: local Playwright reuses whatever dev server is on :5173 and rewrites baselines on `--update-snapshots`; never update baselines for a variant by running the whole suite. Update one theme directory at a time and review the PNG diff by eye.

## 5. Risks and what would prove this wrong

| Claim | Label | Proven wrong by |
|---|---|---|
| `var(--x, literal)` is pixel-identical to the literal | read (CSS spec) | the `maxDiffPixels: 0` + computed-style check in step 0 showing any difference |
| Themes cost no bytes for the default path | guess | the production bundle size diff with a theme file present but unselected |
| A theme can be swapped with no code change outside CSS | **partly false today**: pips (inline colour) and rotation need a small `DominoTile.tsx` change | the `grep` above finding callers that break |
| Other screens that restyle `.domino-body` (Learn, Journey, hand-over) are unaffected | guess | opening each in the lab with a theme attribute set on `<html>`; they are scoped by their own class chains, so most should ignore the attribute, but I did not verify |
| Attribute selector substring matching on `style` (the lab's trick) is acceptable | measured: see the perf report; production would use classes | the SEL control row in `REPORT.md` |

## 6. Owner decisions

1. Are gradients allowed in a variant at all? The current board already paints gradients (a 180deg linear vignette and a gradient grid), so AGENTS.md section 3 is already not literally true on the board; tile variant C (rim gradient) and board variant C (radial vignette) are flagged departures.
2. Is the pip palette allowed to change (it is the most visible and most contested part of the tile)? It is the only change that needs a component edit.
3. Is a user-facing theme picker wanted, or is this one global change (then no abstraction is needed, only a replacement)?
