# Responsive breakpoints — the one system

All responsive CSS in `client/src/` uses **three** named breakpoints. Do not
write raw `@media (max-width: …)` / `(min-width: …)` queries in new code.

| Custom media          | Resolves to                                          | Meaning |
|-----------------------|------------------------------------------------------|---------|
| `--phone`             | `(max-width: 768px)`                                  | Phone. One column, bottom tab bar, full-bleed panels. |
| `--desk`              | `(min-width: 769px)`                                  | Desktop and up. The complement of `--phone` — together they tile the whole range with no gap or overlap. This is the existing "769px desk line". |
| `--below-wide`        | `(max-width: 900px)`                                  | Not a wide viewport. Collapse multi-column grids to a single column; used by hub/landing layouts that need to reflow earlier than the phone breakpoint. |

The in-game rendering subsystem is **not** part of this system — its landscape
rules keep the literal `(max-width: 900px) and (orientation: landscape)` query.
See "Excluded from the system" below.

## Usage

```css
@media (--phone) {
  .rh-thing { grid-template-columns: 1fr; }
}

/* Compound conditions still work — the custom media expands in place: */
@media (--phone) and (orientation: portrait) { … }
@media (--desk) and (max-width: 1279px) and (min-height: 600px) { … }
```

## Mechanism

CSS custom properties (`var(--x)`) cannot appear inside a `@media` condition,
so breakpoints are `@custom-media` at-rules, declared in
`client/src/styles/tokens.css` and resolved **at build time**:

- `postcss-custom-media` expands `@media (--phone)` → `@media (max-width: 768px)`.
- `@csstools/postcss-global-data` (configured in `client/postcss.config.js` with
  `files: ['./src/styles/tokens.css']`) makes the `@custom-media` declarations
  visible to every CSS file, since PostCSS processes each file in isolation.

Both plugins run **before** `tailwindcss` and `autoprefixer` in
`postcss.config.js`. stylelint (`npm run lint:css`) accepts both `@custom-media`
and `@media (--name)`.

## Why these four values

The codebase had ~35 distinct `max-width` values expressing three real intents:

1. **"this is a phone"** — a 600–768px cluster (~66 uses). Folded to `--phone`
   at 768, the exact complement of the pre-existing 769px desk line, so phone +
   desktop is now a single seam.
2. **"not a wide viewport"** — an 860–980px cluster (~33 uses). Folded to
   `--below-wide` at 900.
3. **"cap the container on a big monitor"** — 1100px+ — left as literal values,
   out of scope for this system.

Folding a range to a single value shifts some individual breakpoints (e.g. a
rule previously at `max-width: 640px` now triggers at 768px; one at 980px now at
900px). This was an accepted tradeoff to make the migration a mechanical
find/replace. The rules whose *body* looked width-range-specific rather than
generically phone-shaped are listed below for visual verification.

## Landscape query — unchanged (no `--landscape-short`)

PR #110's commit message and an earlier draft of this doc claimed a
`--landscape-short` `(orientation: landscape) and (max-height: 480px)` token
had *replaced* the in-game `(max-width: 900px) and (orientation: landscape)`
query. **That never shipped** (issue #111): no rule ever consumed the token,
the in-game landscape rules were never touched (excluded subsystem), and
`rotate-overlay.css`'s only change resolved to byte-identical CSS. The dead
token was removed here.

If the height-gated query is worth adopting for the in-game subsystem later,
that's a deliberate, separately-scoped change to
`match/match-live-theme.css`, `styles/match-live-hud.css`,
`styles/walnut-live.css`, and `styles/board/board-layout.css` — not a token
reinstatement.

## Needs visual check

These rule bodies changed trigger width and are not obviously
resolution-agnostic. Verify at 768px once browser tooling is available.

**HIGH — structural layout change, most likely to regress:**

- `friends/friendsScreen.css` — master/detail two-pane → single-pane collapse.
  Was `max-width: 767px`, now `--phone` (768). The 1px shift is trivial; the
  reason it's HIGH is that the rule flips a two-pane layout to one pane with a
  list/detail toggle — a structural change, not a sizing tweak — so it's the
  one most able to actually break something at the seam.

**MEDIUM — sizing/reflow at a shifted trigger:**

- `tournament/tournamentMatchHud.css` — in-game HUD pill repositioning, was
  `max-width: 600px`, now 768. Widens the compact-pill treatment by 168px.
- `styles/home-hub.css`, `styles/responsive.css`, `ui/leaderboardPage.css`,
  `ui/claudeMode.css` — multiple grid/padding reflows previously at 640–720px,
  now 768.
- `social/*` and `learn/*` files folding from 640–720 → 768.

## Reachability harness

`client/e2e/mobile-reachability.spec.ts` asserts two contracts on 20 top-level
routes at three viewports (phone portrait 390×844, tablet portrait 834×1112,
phone landscape 844×390):

1. **Tap targets** — every visible interactive element has a computed
   `getBoundingClientRect()` whose smaller side is ≥ 44px, unless it clears the
   WCAG 2.5.8 spacing exemption: its centre is ≥ 24px from the centre of every
   other target (24px circles centred on each do not overlap). Centre-to-centre,
   the actual standard — an earlier centre-to-edge variant flaked near its
   threshold. Measured on the element, never a container.
2. **Horizontal overflow** — `documentElement.scrollWidth ≤ clientWidth`.

**Determinism** (it's a blocking gate — a flaky assertion is worse than none):
each route settles past `document.fonts.ready` + a geometry-quiet window (12s
cap for live-socket routes that never fully quiet), then is measured **twice,
500ms apart**; only violations in both samples count. Per-test timeout 90s.

Run: `npm run e2e:reachability` (opt-in via `REACHABILITY=1` / its own
Playwright project). **This is a blocking CI gate** (as of 2026-09-07) — the
matrix is green and any regression fails the Client Validation job. Writes
`matrix.json` / `matrix.txt` + per-cell screenshots to
`e2e/screenshots/mobile-reachability/` (gitignored); CI uploads the matrix as
an artifact.

**Server isolation (load-bearing):** the harness runs on port **5233** with
`reuseExistingServer: false` and `vite --strictPort`, so every run builds a
fresh dev server. A stale server on :5173 — one left running from before a
`postcss.config.js` or `tokens.css` breakpoint change — serves `@media
(--phone)` *unresolved*; the browser silently drops the unknown feature, no
phone rules apply, and the matrix comes back green over a broken app. The first
green matrix for this work was exactly that false pass; the `.rh-hub-filter`
defect below only surfaced once the harness got its own fresh server.

### Status: green, 20 routes × 3 viewports (2026-09-07, verified on a
### freshly-started :5233 server — `lsof :5233` confirmed empty pre-run)

`/learn/recorder` is **exempt** and not in the route list — it is an internal
content-authoring tool (records the fixed Standard Fritz match into
guided-lesson JSON, reached only from the Learn screen's AUTHOR column) with no
mobile use case.

The defects found in the post-migration baseline are fixed:

- **`.rh-nav-tab`** (top-nav tabs) was 41px tall — 3px under, and the entire
  `tablet-portrait` column (834 ≥ 769 → `--desk` nav shown). Fixed:
  `min-height: 44px` + flex centering in `rh-mobile-chrome.css`.
- **`.rh-back-button`** (shared, all "← Back" buttons) was ~34px — the rule in
  `home-hub.css` zeroes the `Button` primitive's `height: 44px`. Fixed:
  `min-height: 44px` on that rule.
- **`.pml-start-btn.rh-btn`** (private-lobby footer: "Create lobby", "Start
  Match", …) forced `height: 36px`. Fixed: restored to 44px (`Button` md).
- **`.rh-hub-filter`** (shared `FilterPills.tsx` — the `.dfl-page` leaderboard
  boards for Daily Fritz *and* Puzzle Rush) was 36px base / 30px under
  `.dfl-page`. Fixed: `min-height: 44px` on both rules. `/social`'s feed uses
  `rh-sb-*` pills, not these.
- `/learn/recorder`'s 32×32 zoom + 36px sidebar buttons — exempted, see above.

No horizontal overflow anywhere. Auth-gated routes are measured as a guest
(signed-out gate); the gates themselves pass.

## Excluded from the system (kept literal breakpoints)

The in-game rendering subsystem tunes breakpoints to the board geometry, not to
device classes. These files keep their literal `@media` queries:

- `styles/walnut-live.css` (frozen — do not touch)
- `styles/match-gameplay.css`, `styles/match-hud-polish.css`,
  `styles/match-in-game.css`, `styles/match-live-hud.css`
- `styles/board/board-hud.css`, `styles/board/board-layout.css`
- `match/match-live-theme.css`
- `bot/botMatch.css`
- `styles/tokens.css` (declares the custom media; no consuming queries)
