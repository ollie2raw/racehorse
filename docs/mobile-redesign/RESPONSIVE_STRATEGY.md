# Responsive strategy

## Layout model

Use **available container width and height** as the primary inputs for page composition, with aspect ratio/orientation as context and viewport width for global shell changes. Landscape phones are height constrained even when their width exceeds the existing 768px phone boundary. Pages should receive a bounded flex region beneath shared chrome; content that must scroll owns one named internal scroll region.

### Proposed primitive rules

- `.app`: `height:100dvh` with fallback; `min-height:0`; safe-area-aware shell variables; no document scroll while an app surface is active.
- `.screen-shell`: `flex:1 1 0`, `min-height:0`, `max-height:100%`, `overflow:hidden`, flex column. Header/nav are non-shrinking; page content is the explicitly bounded region.
- `env(safe-area-inset-*)`: read once into shell custom properties with fallback 0. Safe-area padding must have a single owner per edge; child page components use `--content-inset-*`, not raw env values.
- Grid for fixed content relationships: home/solo feature rows and hub 2-column compositions; flex for header/toolbars/CTA rows; `minmax(0, …)` so long copy can shrink instead of forcing overflow.
- Use `clamp()` only within measured type/spacing ranges. Use `min()`/`max()` to bound content max-width and safe padding. Use `aspect-ratio` for stable art/tile card frames, not for the entire app.
- Container queries only for reusable components whose layout depends on actual card/container width (feature card art/text and stat rows). Media queries select shell/nav policy and short-height density modes.
- CSS custom properties define spacing, type roles, chrome heights, safe insets, and content budgets. A screen may tune semantic variants, not add arbitrary pixel values per breakpoint.

## Breakpoint philosophy

**Frozen policy:** wide shell iff viewport width ≥769 CSS px **and** viewport height ≥600 CSS px. Otherwise use compact shell. Short landscape is a cross-cutting density mode at height ≤430 and landscape orientation; it does not select shell. `client/config/responsivePolicy.js` is the future single query source for Tailwind `desk:` and PostCSS custom media, with an invariant guarding parity. Details and deletion order are in `FIXTURE_AND_CSS_FREEZE.md`. At 844×390 the compact layout applies, even though width exceeds 768. The following content bands supplement the shell policy:

| Layout class | Input | Desired behavior |
|---|---|---|
| Compact narrow content | bounded card width ≤~240px or viewport ≤740px | bottom tabs on Hub, reduced gutters, account collapse, page-specific rail/scroll when card minimums fail |
| Compact short landscape | compact shell plus landscape height ≤430px | height-compressed card/HUD content; no desktop header assumption |
| Wide shell | viewport width ≥769px and height ≥600px | existing desktop horizontal primary nav and wider page grids |
| Short viewport (cross-cutting) | viewport block size ≤430px | remove secondary decoration/copy first; preserve CTA and interaction minimums; gameplay recommendation only if board/hand measured thresholds fail |
| Standard/tall | content height ≥~500px | roomier spacing and optional secondary detail |

The six requested viewports (667×375, 740×360, 844×390, 852×393, 915×412, 932×430) all select compact shell. Orientation is not a device classifier. Container queries determine card internals, and bounded height determines whether secondary content compresses or named internal scrolling activates.

## Viewport units and scrolling

- `dvh` tracks dynamic browser chrome and is appropriate for app shells, but it can resize as bars collapse. `svh` can provide a stable minimum for browser UI-visible states; use `dvh` for live available height with safe fallback and verify iOS Safari/Android Chrome.
- Avoid `min-height:100vh` on direct app screens. The current app shell is `100dvh`; `.layout-screen` auto-height and `min-height:100dvh` patterns can break that contract.
- Do not place a tall stack beneath `.app` and rely on `body` scroll; body is hidden. Long-form screens such as settings, full activity history, leaderboard, and lesson article intentionally scroll inside a bounded region.
- In gameplay, use ResizeObserver on actual board viewport/hand region and feed those dimensions to camera fit. React window dimensions alone do not account for HUD or safe insets.

## Spacing and mobile type proposal

Map current 8/16/24/40/64 spacing tokens to a phone-aware semantic set: 4/8/12/16/20/24/32 with shell gutters 16px (minimum 12px after safe inset) and compact gaps 8–12. Do not rewrite desktop tokens globally; introduce responsive role tokens.

| Role | Proposed landscape-phone range | Existing font |
|---|---:|---|
| Display/title | 28–38px, one or two lines max | Barlow Condensed Bold/ExtraBold, or current Outfit bold where references use geometric sans |
| Page title | 24–32px | current Outfit/Barlow choices; standardize per shell |
| Card heading | 18–24px | Outfit 700/800 |
| Body | 14–16px, line height 1.35–1.5 | Outfit 400–500 |
| Label/metadata | 11–13px; never low contrast | Outfit 600–700; uppercase only for short metadata |
| Navigation | 11–13px label + 20–24px icon, 44–60px control | current icon styles are handcrafted SVG |
| CTA | 15–17px text, ≥44px target | Outfit 700 |
| Score/timer | 20–32px depending importance and width | Barlow Condensed or Outfit tabular numerals |

Current `--font-display: Barlow Condensed` and `--font-body: Outfit` are sufficient; `index.html` loads both. The references' rounded editorial title treatment may be more Outfit-heavy than some current condensed headings, so make a page-level type decision from source files, not a new font download.

## Acceptance dimensions and actual behavior

Baseline screenshots at six sizes show `document.scrollWidth == clientWidth` and `document.scrollHeight == clientHeight` for all seven captured routes, but `.app` and fixed bottom bar mask content. At 844×390 the screen offers ~274 CSS px between 56px header and 60px bottom nav before page padding; page modules can be clipped inside their own viewport wrappers. H-scroll assertion alone is insufficient. Future layout metrics must include visible primary CTA, reachable bottom content, no overlap with header/tab bars/safe inset, and bounded scroll owner.
