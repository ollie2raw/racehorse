# Board Black Matte / Gold-Brass Skin Plan

**Patch:** 50 (planning only — no CSS implementation)  
**Date:** 2026-05-28  
**Target file:** `client/src/styles/board/skins/racehorse-matte.css`  
**Mode:** Design system + phased implementation roadmap — **not** a visual patch  

**Related:**

- `docs/board-phase-1-cleanup-checkpoint.md` (Phase 1 complete)
- `docs/match-board-target.md` + `docs/design-references/boardmock1.png`
- `docs/design-references/match-board-comp/` (static comp + `match-board.tokens.css`)
- `docs/agent-skills/racehorse-design-source-of-truth.md` (Play vs Fritz matte/neon canonical)
- `client/src/styles/tokens.css` (global `--rh-match-*`, `--rh-arena-*`, tier gold)

---

## Executive summary

Phase 1 moved **structure** into `client/src/styles/board/*`. Phase 2 moves **visual identity** into `skins/racehorse-matte.css` using tokens and scoped selectors, while legacy files (`walnut-live.css`, `match-hud-polish.css`, route sheets) are **overridden or retired incrementally** — not deleted in one shot.

**North star:** Black matte / obsidian match stage, smoked-glass depth, brass/gold Racehorse accents on Fritz paths, ivory tiles with readable contrast — premium strategy-table feel without casino brown, cyan mock colors, or glow overload.

**First implementation patch (51):** Token foundation + skin scope hook only — no broad visible restyle until approved.

---

## A. Design vision

### Target identity

The active in-game board should read as a **single premium product surface** — closer to a $100M-grade daily strategy platform (Chess.com Premium, NYT Games, Apple Arcade) than a patched prototype.

| Layer | Vision |
|-------|--------|
| **Shell** | Obsidian / near-black matte frame around the match; subtle vertical depth (darker mount, slightly lifted playfield). |
| **Arena** | Recessed digital table: matte navy-charcoal mat, faint grid/sheen, restrained brass rim energy — **not** cyan comp glow, not brown felt. |
| **HUD** | Matte panels integrated with shell; brass trim on Fritz-active side; ivory/warm white type; score and turn remain dominant. |
| **Meta / controls** | Smoked-glass pills with thin borders; gold values and Fritz accents; zoom + utility trays legible at a glance. |
| **Hand dock** | Continuous bottom “player station” — deck strip visually tied to arena, not a floating foreign card. |
| **Tiles** | Realistic ivory domino bodies; warm shadows; gold underline for playable — **clarity over decoration**. |

### Hierarchy goals

1. **Background / shell** — darkest, lowest contrast detail.  
2. **Board frame + mat** — mid depth; draws the eye to play.  
3. **Tiles + legal placement** — highest gameplay contrast.  
4. **HUD + meta** — readable chrome, never competing with tile faces.  
5. **Accents** — brass/gold for Fritz identity and active affordances only.

### Reference alignment

| Source | Use for |
|--------|---------|
| `boardmock1.png` | Layout, proportions, region placement, inset arena |
| `homepage-identity.png` / `AGENTS.md` | Brand colors, matte panels, ivory type |
| `match-board-comp/` tokens (`--mb-gold` `#c8a020`, `--mb-bg` `#060608`) | Starting numeric palette for matte skin |
| Play vs Fritz UI | Panel density, border restraint, selected states |
| `docs/match-board-target.md` | Region D mat, D3 meta, D4 utilities, E1 hand dock |

**Mock cyan → ship as brass/gold** on Fritz; electric blue remains available for Standard/Ghost/Puzzle mode tokens in later variants.

---

## B. Design principles

1. **Structure stays in base `board-*.css`** — layout, flex, z-index, pointer-events only.  
2. **Visual skin belongs in `skins/racehorse-matte.css`** — colors, borders, shadows, backdrop-filter, pseudo-element art.  
3. **No gameplay logic changes** — `Board.tsx`, bot engine, scoring, validation untouched.  
4. **No tile behavior changes** — selection, drag, placement, glow logic stay in JS + `game-interactions.css` until a dedicated tile pass.  
5. **Readability first** — if a skin choice hurts open-end count or pip contrast, revert.  
6. **Gold is accent, not flood** — brass borders, active pill rims, open-ends first-child hint; not full-screen gold wash.  
7. **Depth via material, not noise** — thin borders, inset highlights, 2–3 shadow layers max; avoid stacked gradients on every node.  
8. **Avoid glow overload** — no neon halos on rails; chain glow only where product already expects it (score track).  
9. **Fritz routes share one skin** — Daily Fritz, Play vs Fritz, ghost/bot studio path visually consistent; mode nuance via tokens, not one-off CSS per file.  
10. **Route-specific overrides only when necessary** — Puzzle (electric blue), Learn (green) get **variant token sets** later, not duplicated structure.  
11. **Override legacy deliberately** — new skin loads last (`board/index.css`); use equal or higher specificity + scoped root, then remove duplicate rules from legacy files in cleanup patches.  
12. **No gradients as default fill** — prefer matte solids per AGENTS.md; gradients only for subtle mat vignette if comp-approved.

---

## C. Token system proposal

Tokens live **primarily on the skin scope root** (see §G), with optional aliases to global `tokens.css` where values already match.

### Naming convention

Prefix: **`--rh-matte-*`** (board skin). Reuse global names where stable: `--font-display`, `--text-primary`, existing `--rh-match-board-*` during bridge.

### Core palette

```css
/* ── Obsidian shell ── */
--rh-matte-bg:              #04070c;   /* align --bg-obsidian */
--rh-matte-bg-deep:         #020509;   /* align --rh-match-shell-bg-bottom */
--rh-matte-panel:           rgba(8, 11, 18, 0.94);
--rh-matte-panel-strong:    rgba(5, 9, 16, 0.98);
--rh-matte-panel-glass:     rgba(10, 16, 28, 0.72);

/* ── Playfield / mat ── */
--rh-matte-mat-top:         #0f141c;   /* bridge --rh-match-board-bg-top */
--rh-matte-mat-mid:         #0c1119;
--rh-matte-mat-bottom:      #080d14;
--rh-matte-mat-grid:        rgba(91, 132, 180, 0.045);
--rh-matte-mat-sheen:       rgba(255, 247, 236, 0.022);

/* ── Brass / gold (Fritz) ── */
--rh-brass:                 #c8a020;   /* comp --mb-gold */
--rh-brass-bright:          #e7b64a;   /* comp --mb-gold-bright */
--rh-brass-soft:            rgba(231, 182, 74, 0.26);
--rh-brass-border:          rgba(226, 176, 72, 0.28);
--rh-brass-glow:            rgba(200, 160, 32, 0.14);
--rh-brass-inset:           rgba(255, 255, 255, 0.06);

/* ── Electric blue (secondary / Standard / Ghost / Puzzle variant) ── */
--rh-matte-blue:            rgba(88, 166, 255, 0.22);
--rh-matte-blue-border:     rgba(88, 166, 255, 0.24);
--rh-matte-blue-glow:       rgba(88, 166, 255, 0.08);

/* ── Borders ── */
--rh-obsidian-border:       rgba(255, 255, 255, 0.08);
--rh-obsidian-border-strong:rgba(255, 255, 255, 0.14);
--rh-frame-border:          var(--rh-brass-border);
--rh-frame-border-idle:     var(--rh-matte-blue-border);

/* ── Shadows (layered, restrained) ── */
--rh-board-shadow-1:        0 8px 24px rgba(0, 0, 0, 0.32);
--rh-board-shadow-2:        0 18px 48px rgba(0, 0, 0, 0.38);
--rh-board-shadow-inset-top: inset 0 1px 0 rgba(255, 255, 255, 0.055);
--rh-board-shadow-inset-brass: inset 0 1px 0 var(--rh-brass-inset);

/* ── Typography on chrome ── */
--rh-matte-text:            #f2eee8;
--rh-matte-text-muted:      rgba(216, 226, 241, 0.76);
--rh-matte-label:           rgba(196, 212, 232, 0.9);

/* ── Radii ── */
--rh-matte-radius-sm:       8px;
--rh-matte-radius-md:       12px;
--rh-matte-radius-lg:       18px;
--rh-matte-radius-pill:     999px;

/* ── HUD / pills ── */
--rh-matte-pill-bg:         var(--rh-matte-panel-glass);
--rh-matte-pill-border:     var(--rh-obsidian-border-strong);
--rh-matte-pill-min-height: 56px;
--rh-matte-pill-padding-x:  20px;
--rh-matte-pill-blur:       10px;

/* ── Hand dock ── */
--rh-matte-deck-bg:         rgba(5, 9, 18, 0.98);
--rh-matte-deck-border-top: var(--rh-brass-border);
--rh-matte-deck-shadow:     0 -10px 24px rgba(0, 0, 0, 0.22);

/* ── Tile contrast helpers (reference only in skin; tile rules later) ── */
--rh-matte-tile-ivory:      #fbf4e8;
--rh-matte-tile-border:     rgba(118, 102, 78, 0.94);
--rh-matte-tile-shadow:     0 9px 18px rgba(0, 0, 0, 0.34);
--rh-matte-playable-glow:   var(--rh-brass-glow);
```

### Token bridge strategy (Patch 51)

- Define `--rh-matte-*` on skin scope.  
- Optionally set `--rh-matte-*: var(--rh-match-board-bg-top)` etc. where globals already correct — reduces drift.  
- Do **not** duplicate entire `tokens.css` into skin file.  
- Comp tokens (`--mb-*`) are reference; ship as `--rh-matte-*` in product CSS.

---

## D. Target selector map

Selectors below are **eventual** `racehorse-matte.css` targets. Legacy owners today noted for migration/removal planning.

### 1. Whole screen / background

| Selector | Current owner (typical) | Skin intent |
|----------|-------------------------|-------------|
| `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen)` | `walnut-live.css`, `botMatch.css`, `match-board-architecture.css` | Shell bg, page atmosphere |
| `.rh-pvf-integrated-layout`, `.rh-pvf-cinematic-panel` | `PlayVsFritz.css`, `walnut-live.css` | Integrated PVF panel matte |
| `.rh-live-studio-shell`, `.rh-match-body` | `board-shell.css` (structure), `walnut-live` (skin) | Studio column background |
| `.home-bg` / halo (if visible on match) | Home art CSS | Dim or suppress on active match |

**Scope hook (recommended):** see §G.

### 2. HUD

| Selector | Current owner | Skin intent |
|----------|---------------|-------------|
| `.wl-top-rail`, `.bot-top-rail`, `.rh-match-hud` | `board-hud.css`, `walnut-live`, `botMatch.css` | Rail bg, border-bottom, spacing |
| `.wl-player-pill`, `.wl-player-pill-btn.score-card` | `walnut-live`, `match-hud-polish` | Matte cards, brass on active/you |
| `.wl-player-label`, `.wl-player-score` | `walnut-live`, `botMatch.css` | Type scale (skin only) |
| `.wl-turn-label`, `.wl-center-status` | `walnut-live` | Turn badge matte + gold active |
| `.wl-tiles-chip`, `.wl-tiles-count` | `walnut-live` | Opponent rack chip |
| `.daily-fritz-progress-pill` | `dailyFritzMatchBoard.css` | DF HUD pill — Patch 58 accent |
| `.rh-match-turn-module` | `match-board-architecture.css` | Turn module chrome |

### 3. Board shell / frame / surface

| Selector | Current owner | Skin intent |
|----------|---------------|-------------|
| `.rh-live-board-zone`, `.rh-match-arena` | `board-shell.css`, `walnut-live` | Zone mount, outer padding |
| `.rh-match-playfield-card` | `match-board-architecture.css`, `inGameBoardShell.css` | Playfield card matte |
| `.rh-board-stage`, `.nbl-stage` | `noBrainerLab.css`, `board-shell.css` | Stage wrapper |
| `.rh-board-frame`, `.nbl-board-frame` | `noBrainerLab.css`, `match-hud-polish`, `walnut-live` | Brass rim, inset shadow |
| `.rh-board-canvas`, `.nbl-board-canvas` | `board-surface.css`, `noBrainerLab.css` | Mat fill, grid pseudo |
| `.nbl-board-canvas::before` | `noBrainerLab.css`, routes | Grid / texture overlay |
| `.rh-board-watermark`, `.nbl-board-watermark` | `noBrainerLab.css` | Opacity, size, desaturate |
| `.wl-stage-shell` | `walnut-live` | Stage inset |

### 4. Meta / controls

| Selector | Current owner | Skin intent |
|----------|---------------|-------------|
| `.rh-board-meta-bar` | `board-meta.css` (structure) | No layout change; optional bar padding skin |
| `.board-corner-pill`, `.open-ends-pill`, `.boneyard-pill` | `App.css`, `walnut-live`, `botMatch.css` | Glass pills, brass on open-ends |
| `.open-ends-pill__label`, `.open-ends-count`, `.boneyard-meta`, `.boneyard-count` | `walnut-live`, `botMatch.css` | Label/count colors |
| `.board-zoom-tray.control-pill` | `match-hud-polish.css` | Position stays legacy until controls pass; skin colors |
| `.wl-controls-tray.control-pill` | `match-hud-polish`, `walnut-live`, inline TSX | Skin only first; placement later |
| `.board-zoom-btn` | `match-hud-polish` | Button hit area colors |
| `.rh-board-toolbar`, `.nbl-board-toolbar` | `board-controls.css` (structure) | No visual unless toolbar children skinned |

### 5. Hand dock

| Selector | Current owner | Skin intent |
|----------|---------------|-------------|
| `.rh-live-hand-deck` | `board-hand-dock.css` (structure), `walnut-live` (skin) | Deck strip matte + brass top edge |
| `.rh-live-hand-deck .wl-hand-area` | `walnut-live` | Inner transparent reset (keep) |
| `.wl-hand-area` (studio) | `walnut-live` | Tray border/hairline |
| `.tray-rail`, `.tray-center`, `.hand-container`, `.hand-row` | `board-hand-dock.css`, `walnut-live` v3 | Scroll chrome only if needed |

### 6. Tiles and interactions (later phase — Patch 57+)

| Selector | Current owner | Skin intent |
|----------|---------------|-------------|
| `.domino-tile`, `.domino-body` | `walnut-live`, global tile CSS | Ivory body, border, shadow |
| `.board-canvas .domino-tile.board-tile` | `walnut-live` bot scope | Board tile contrast |
| `.hand-container .domino-tile.highlight`, `.selected` | `walnut-live`, `game-interactions.css` | Selection border |
| `.rh-glow-underline` / playable underline | `rh-glow-underline.css` | Gold underline — tune, don’t rewrite logic |
| `.domino-tile.unplayable` | `game-interactions.css` | Dim opacity |
| `.placement-zone`, `.open-end-glow` | `game-interactions.css` | Placement feedback — minimal skin |

**Mark explicitly:** Tile/interaction skin is **Patch 57+** unless a prior patch risks unreadable board tiles after mat change (then minimal contrast-only hotfix in 53).

---

## E. What not to skin yet

| Area | Reason |
|------|--------|
| Gameplay logic, `Board.tsx` camera math | Out of scope |
| Bot AI, scoring, move validation | Out of scope |
| Drag/selection mechanics | Behavior in JS |
| **Learn / Guided** full skin | Separate variant; keep `shared-ui` hides; green accent system |
| **Practice / NBL** | `nbl-board-controls-pill`, `nbl-tray` — separate plan or Phase 2b unless explicitly unified |
| **Daily Puzzle** | Electric-blue variant after Fritz path stable |
| **Overlays / modals** | `board-overlays.css` later — end-of-hand, leave confirm, toasts |
| **Multiplayer** | Skin after bot studio signed off; same selectors, test reactions tray |
| **Full tile redesign** | Patch 57; only contrast guardrails in 53 if needed |
| **Controls placement unification** | Inline TSX + `!important` — coordinate in dedicated cleanup or Patch 56 |
| **Deleting legacy files** | Override first, delete duplicate rules in later maintenance patches |
| **`match-board-greenfield-masterplan` React rewrite** | Superseded; skin applies to current DOM |

---

## F. Proposed implementation phases

Adjusted for **safer cascade** (shell → arena → HUD → dock → chrome → tiles → mode → QA).

| Patch | Deliverable | Visible change | Notes |
|-------|-------------|----------------|-------|
| **51** | Token block + skin scope on `:root` or scoped selector; **no** property rules on components | None / negligible | Approve tokens before color lands |
| **52** | Shell / page background for bot studio scope only | Subtle outer darkening | `.bot-match-screen:not(.learn-lesson-screen)` |
| **53** | Frame + canvas + watermark + playfield card (obsidian mat, brass rim) | **Major** — arena identity | Preserve tile contrast; screenshot gate |
| **54** | HUD rail + player pills + turn label | HUD matches matte system | May need to override `botMatch.css` typography |
| **55** | `.rh-live-hand-deck` + tray hairlines | Hand dock tied to arena | Structure untouched |
| **56** | Meta pills + zoom + utility trays (skin only) | Corner chrome | Defer placement; override `match-hud-polish` colors |
| **57** | Tile + interaction contrast pass | Tile polish | Coordinate `game-interactions`, `rh-glow-underline` |
| **58** | Daily Fritz accent (`bot-match-mode-daily-fritz`) | Frosted → matte brass | Replace `dailyFritzMatchBoard.css` frosted block gradually |
| **59** | Responsive QA + legacy dedupe | Polish | Short height, narrow, `large-mode`; remove winning duplicates from `walnut-live` |

### Optional reorder

If HUD fights arena in screenshots, swap **54 before 53** only for background rails — **not** arena mat before shell. Comp order: shell → HUD → arena → hand (boardmock1 top-to-bottom).

### Per-patch legacy touch policy

| Legacy file | When to edit |
|-------------|--------------|
| `racehorse-matte.css` | Every implementation patch |
| `walnut-live.css` | Remove superseded rules **after** skin wins in QA (59) |
| `match-hud-polish.css` | Neutralize pill colors when 56 lands |
| `dailyFritzMatchBoard.css` | Patch 58 — DF-only |
| `botMatch.css` | Trim meta/HUD duplicates after 54–56 |
| `match-standard-live-board.css` | Puzzle variant later |
| `noBrainerLab.css` | Out of Fritz sequence |

---

## G. Scope strategy

### Recommended primary scope (Patch 51–59 v1)

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen)
```

**Includes:** Daily Fritz (`bot-match-mode-daily-fritz`), Play vs Fritz (`bot`), ghost (`ghost`) — shared `BotMatchScreen` + `MatchNblBoardFrame` studio path.

**Excludes:** Learn (`.learn-lesson-screen`), Practice (`.practice-lab-screen`), Daily Puzzle (`.daily-puzzle-screen`) unless explicitly enabled later.

### Optional opt-in class (recommended for Patch 51)

Add to `BotMatchScreen` root **in a later patch** (not Patch 50/51 planning requirement):

```html
<div class="screen ... bot-match-screen racehorse-matte-skin">
```

**Benefits:**

- Kill-switch without removing `walnut-live` classes.  
- A/B vs legacy skin during QA.  
- Clearer specificity: `.racehorse-matte-skin .rh-board-frame`.

**Patch 51 without TSX change:** Scope tokens to:

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) {
  /* --rh-matte-* definitions only */
}
```

### Mode-specific tokens

Use **attribute/class modifiers** on the same root, not separate CSS files:

| Modifier | Accent emphasis |
|----------|-----------------|
| `.bot-match-mode-daily-fritz` | Brass + DF progress pill (Patch 58) |
| `.bot-match-mode-bot` | Brass primary |
| `.bot-match-mode-ghost` | Slightly more blue secondary (`--rh-matte-blue-*`) |

### Multiplayer

Same skin selectors apply (`.walnut-live` + meta + trays in `App.tsx`). Enable in **Patch 56 or 59** after bot studio approval — add `.game-screen` multiplayer root to scope or share bot scope if class list matches.

### Avoiding breakage on Puzzle / Practice / Learn

| Route | Strategy |
|-------|----------|
| **Learn** | Scope exclusion + existing `display:none` on trays |
| **Practice** | Do not apply bot-match scope; future `.racehorse-matte-skin--practice` or keep NBL CSS |
| **Daily Puzzle** | Future `racehorse-matte-skin--puzzle` with `--rh-matte-blue` dominant |
| **`large-mode`** | Test after each patch; walnut already opts live match out of inflation |

### Cascade order (unchanged)

`walnut-live.css` → `match-hud-polish.css` → `match-board-architecture.css` → `board/index.css` (includes `racehorse-matte.css` **last**).

Skin rules should use scoped root + same specificity as legacy, or +1 where needed.

---

## H. Risk analysis

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Tile unreadable on dark mat** | High | Patch 53 screenshot gate; keep ivory bodies; minimal mat luminance |
| **`!important` wars** | High | Skin loads last; then delete legacy duplicates in 59 |
| **DF frosted vs matte clash** | Medium | Patch 58 replaces DF block; don’t half-apply |
| **Controls overlap zoom** | Medium | Don’t move placement in skin patches; visual only in 56 |
| **Duplicate walnut ~1893 vs ~2188** | Medium | Dedupe in 59 after skin wins |
| **backdrop-filter perf** | Medium | Limit blur to pills; avoid full-screen blur |
| **Learn regression** | Low | Hard exclude `.learn-lesson-screen` |
| **Practice regression** | Low | Out of scope |
| **Puzzle color identity** | Low | Defer to puzzle variant |
| **Short/narrow viewport** | Medium | QA each patch at ≤760px height, ≤768px width |
| **Open ends / boneyard wrong** | None (React) | CSS cannot break counts |
| **Multiplayer reactions tray** | Low | Extra width in tray — test in 56/59 |

---

## I. Visual QA checklist

Capture **before** (current build) and **after each implementation patch** (51–59).

### Routes

- [ ] Daily Fritz — active hand, your turn  
- [ ] Daily Fritz — bot turn  
- [ ] Play vs Fritz — active match  
- [ ] Ghost / bot match  
- [ ] Multiplayer live match (if enabled in scope)  
- [ ] Daily Puzzle — regression (should look unchanged in v1)  
- [ ] No Brainer Lab — regression  
- [ ] Learn / Guided lesson — regression (no trays)  

### States

- [ ] Long hand / scrollable hand  
- [ ] Short hand (≤3 tiles)  
- [ ] Selected tile  
- [ ] Playable tile (gold underline)  
- [ ] Unplayable / disabled tile  
- [ ] Open ends + boneyard meta visible  
- [ ] Zoom tray visible (−/+)  
- [ ] Utility tray (mute, fullscreen, leave)  
- [ ] Hand over / between hands (if easy)  

### Viewports

- [ ] Desktop wide (≥1440px)  
- [ ] Laptop (1280×800)  
- [ ] Narrow (≤768px)  
- [ ] Short height (≤760px)  
- [ ] `large-mode` accessibility (if on)  

### Quality bar

- [ ] Board reads darker/deeper than HUD chrome  
- [ ] Brass visible but not loud  
- [ ] No cyan mock bleed  
- [ ] No brown casino table  
- [ ] Peg/score track still visible (region C)  

---

## J. Recommended Patch 51

### Goal

Add **conservative token foundation** to `racehorse-matte.css` scoped to the active bot studio route — **no component visual rules** (or at most a comment-only placeholder block).

### Files to edit (implementation patch 51 only)

1. `client/src/styles/board/skins/racehorse-matte.css`  
2. Optionally update header comment in `client/src/styles/board/index.css` (state: skin tokens active) — **not required for Patch 50**

### Do not edit in Patch 51

- `walnut-live.css`, `match-hud-polish.css`, route CSS, components, `tokens.css` (unless adding documented global aliases in a separate approved change)

### Exact Patch 51 content sketch

```css
/* Racehorse matte board skin — tokens (Patch 51) */
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) {
  /* --rh-matte-* definitions from §C */
  /* optional aliases: --rh-matte-mat-top: var(--rh-match-board-bg-top); */
}
```

No `background`, `border`, or `box-shadow` on child selectors in Patch 51.

### Verification

```bash
npm run build --prefix client
# Visual: bot match should look unchanged vs Patch 50 baseline
rg '--rh-matte-' client/src/styles/board/skins/racehorse-matte.css
```

### Gate before Patch 52

Product/design approves token list (§C) against `boardmock1.png` + Play vs Fritz reference.

---

## Appendix: Legacy visual ownership (reference)

| File | Role today | Phase 2 action |
|------|------------|----------------|
| `walnut-live.css` | Largest live-match skin (~106 board-related hits) | Override + dedupe |
| `match-hud-polish.css` | Control pill chrome + zoom position | Override colors in 56; position later |
| `botMatch.css` | Meta pill sizing/typography | Override/conflict resolve in 54–56 |
| `dailyFritzMatchBoard.css` | DF frosted pills | Replace in 58 |
| `match-standard-live-board.css` | Puzzle/live-board offsets | Puzzle variant later |
| `noBrainerLab.css` | Practice frame/toolbar | Out of v1 scope |
| `learnGuidedMatch.css` | Learn hand/summary | Out of v1 scope |
| `App.css` | Global pill fallbacks | Keep until meta fully scoped |
| `game-interactions.css` | Interaction behavior + some visual | Patch 57 |
| `rh-glow-underline.css` | Playable underline | Patch 57 tune |

---

## Appendix: Phase 2 relationship to greenfield

`docs/match-board-greenfield-masterplan.md` is **superseded** for DOM rewrite. This plan **skins the current Phase 1 DOM** (`InGameBoardShell`, `MatchNblBoardFrame`, existing HUD classes). A future greenfield port would **reuse** `racehorse-matte.css` tokens and selector map.

---

*End of Patch 50 plan — no runtime CSS changed.*
