# Neutral Board Surface Bridge Checkpoint

**Status:** Documentation / audit only (Patch 26)  
**Date:** 2026-05-28  
**Mode:** No-visual-change migration — not redesign  
**Scope:** Patches 19–25 neutral runtime bridge + low-risk CSS aliases

---

## A. Current bridge status

### Runtime DOM (neutral classes on the live board stack)

Two frame emitters render the same neutral class pairing on the same nodes (legacy `nbl-*` retained):

| Component | Path | DOM stack |
|-----------|------|-----------|
| `MatchNblBoardFrame` | `client/src/components/MatchNblBoardFrame.tsx` | `main.nbl-stage.walnut-nbl-stage.rh-board-stage` → `.nbl-board-frame.rh-board-frame` → `.nbl-board-canvas.rh-board-canvas` → `.nbl-board-watermark.rh-board-watermark` |
| `InGameBoardFrame` | `client/src/match/InGameBoardShell.tsx` | Same stack as above |

**Consumers:**

- `MatchNblBoardFrame`: `BotMatchScreen` `boardStage`, `App.tsx` multiplayer board shell
- `InGameBoardFrame` (via `InGameBoardShell`): Daily Puzzle, Daily Puzzle Ladder, No Brainer Lab, and `BotMatchScreen` studio path (`InGameBoardShell` + `board/InGameBoardFrame` zone wrapper)

`client/src/match/board/InGameBoardFrame.tsx` is a **zone/shell wrapper only** (`.rh-live-studio-shell` / `.rh-live-board-zone`); it does **not** emit `rh-board-*` surface classes.

All four neutral classes exist in runtime today:

- `.rh-board-stage`
- `.rh-board-frame`
- `.rh-board-canvas`
- `.rh-board-watermark`

**CSS recognition today:** neutral selectors are recognized only where explicitly aliased or listed in `board-shell.css`. There is **no** `.rh-board-watermark` CSS yet. There are **no** `.rh-board-frame` / `.rh-board-canvas` visual-surface aliases.

### Canonical namespace load order

From `client/src/main.tsx`:

1. Legacy globals (`walnut-live.css`, `match-hud-polish.css`, `match-board-architecture.css`, `match-standard-live-board.css`, …)
2. `client/src/styles/board/index.css` (last among board-related globals)

`styles/board/index.css` imports `board-shell.css` (active structural rules) and `board-surface.css` (**comment/header only — no runtime rules**).

Frame emitters also import `client/src/practice/noBrainerLab.css` directly (`MatchNblBoardFrame`, `InGameBoardShell`), so practice base frame/canvas/watermark rules apply on every route using those components unless overridden.

---

## B. Completed safe aliases

### 1. Shell structure (stage + frame sizing)

**File:** `client/src/styles/board/board-shell.css`

**Alias groups:**

```css
/* rh-standard-live-board */
... .nbl-stage, ... .rh-board-stage,
... .nbl-board-frame, ... .rh-board-frame { width/height/padding }

/* bot-match (not learn-lesson) */
... .nbl-stage, ... .rh-board-stage,
... .nbl-board-frame, ... .rh-board-frame { width/height/padding }
```

Plus bot-only `.rh-board-stage { min-height: 0; }`.

**Nature:** flex/sizing only — no background, border, shadow, or pseudo-elements.

### 2. Base canvas structure (centered flex box)

**File:** `client/src/practice/noBrainerLab.css`

```css
.nbl-board-canvas,
.rh-board-canvas {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

**Nature:** layout/stacking only.

### 3. Board-container stacking (complete low-risk set)

| File | Selector pair |
|------|----------------|
| `client/src/styles/walnut-live.css` | `.walnut-live .nbl-board-canvas .board-container`, `.walnut-live .rh-board-canvas .board-container` → `position: relative; z-index: 4` |
| `client/src/styles/match-standard-live-board.css` | `.rh-standard-live-board .rh-live-board-zone .nbl-board-canvas .board-container`, same zone `.rh-board-canvas .board-container` → `position: relative; z-index: 4` |
| `client/src/practice/noBrainerLab.css` | `.practice-lab .nbl-board-canvas .board-container`, `.practice-lab .rh-board-canvas .board-container` → `z-index: 4` |

**Patch 25** completed the standard-live and practice entries; walnut-live stacking alias predates it.

### Not bridged (intentionally)

- `.rh-board-watermark` — zero CSS selectors
- `.rh-board-frame` — shell sizing only; no visual alias
- `.rh-board-canvas` — base structure + stacking only; route visual skins still `nbl-board-canvas` only
- Frame `::before` / `::after`, canvas `::before`, watermark opacity/filter/size

---

## C. What remains legacy-owned

All visual playfield identity still keys off `nbl-*` (and route wrappers). `board-surface.css` documents future ownership only.

### `.nbl-board-frame` (visual + structure)

| Owner file | Notes |
|------------|--------|
| `client/src/practice/noBrainerLab.css` | **Practice visual frame base** — grid matte background, inset shadow, `::after` bezel |
| `client/src/styles/match-hud-polish.css` | **Generic frame polish** — global `.screen.game-screen .nbl-board-frame` border/padding/background; `::after` inset; mobile padding tweak |
| `client/src/styles/match-board-architecture.css` | Playfield card frame reset + `::after` |
| `client/src/styles/match-standard-live-board.css` | Standard-live frame transparent reset (kills NBL skin inside zone) |
| `client/src/styles/walnut-live.css` | Bot-match frame skin, `::before`/`::after`, rh-live-board-zone overrides, duplicate blocks ~1895–2593 |
| `client/src/dailyFritz/dailyFritzMatchBoard.css` | **Daily Fritz** frame overrides on `.walnut-nbl-stage .nbl-board-frame` + `::after` |
| `client/src/learn/learnGuidedMatch.css` | **Learn/Guided** `.learn-guided-live-board-zone` + `.learn-guided-board-card` frame rules |
| `client/src/styles/board/board-shell.css` | Structural width/height only (paired with `.rh-board-frame`) |

### `.nbl-board-frame::before` / `::after`

| Owner file |
|------------|
| `match-standard-live-board.css` (disabled via `content: none` in standard-live zone) |
| `walnut-live.css` (bot-match decorative layers) |
| `learnGuidedMatch.css` |
| `noBrainerLab.css` (`::after` only; no `::before` in practice base) |
| `match-hud-polish.css` (`::after`) |
| `match-board-architecture.css` (`::after`) |
| `dailyFritzMatchBoard.css` (`::after`) |

### `.nbl-board-canvas` visual surface rules

| Owner file | Notes |
|------------|--------|
| `match-standard-live-board.css` | Standard-live felt/matte (`background-color`, `background-image`, `box-shadow`) + `.board-area.wl-board-area` |
| `walnut-live.css` | Bot-match canvas skin + `::before` texture layer (multiple selector blocks) |
| `learnGuidedMatch.css` | Guided live zone + board-card canvas/area skin, tile scale hooks |
| `dailyFritzMatchBoard.css` | `::before` layer only (mode skin accent) |

### `.nbl-board-canvas::before`

| Owner file |
|------------|
| `match-standard-live-board.css` (suppressed in zone) |
| `walnut-live.css` |
| `learnGuidedMatch.css` |
| `dailyFritzMatchBoard.css` |

### `.nbl-board-watermark`

| Owner file |
|------------|
| `noBrainerLab.css` (base position, size, opacity, color, `img`) |
| `match-standard-live-board.css` (standard-live opacity/size) |
| `walnut-live.css` (bot-match) |
| `learnGuidedMatch.css` |
| `dailyFritzMatchBoard.css` (+ `.df-board-has-play` variant) |

### Related legacy (not canvas aliases)

- `walnut-live.css` — `.walnut-live .walnut-nbl-stage .nbl-board-frame` flex hook (structural, no neutral alias)
- `walnut-live.css` — `.board-area.wl-board-area` parallel surface path
- `botMatch.css` — mobile `.board-canvas` / `.board-container` fit (`!important` overflow) — **not** `nbl-board-canvas` scoped
- Tile/highlight rules in `game-interactions.css`, `walnut-live.css` — out of surface bridge scope

---

## D. Risk classification for remaining work

### Low risk

- Additional **selector aliases** that mirror already-proven patterns:
  - structure/stacking only (`position`, `z-index`, `display`, `flex`, `width`, `height`, `min-height`, `padding` without visual tokens)
- Documenting import-order constraints before any move
- **Not recommended next:** aliasing visual surface selectors to `.rh-board-canvas` / `.rh-board-frame` without a dedicated plan and route matrix sign-off

**Low-risk alias queue is effectively empty** for `.board-container` stacking; the three-family bridge is complete.

### Medium risk

- **Watermark** changes that split positioning (`top`/`left`/`transform`/`width`) from opacity/color/filter — easy to desync route overrides
- **Route-fit** rules: `overflow`, `transform`, `transform-origin`, mobile `!important` sizing (`botMatch.css`, guided tile scale in `learnGuidedMatch.css`)
- **Generic frame resets** without background/shadow (e.g. `match-standard-live-board` transparent frame strip) if duplicated or reordered incorrectly
- `walnut-live .walnut-nbl-stage .nbl-board-frame` flex hook — structural but route-global

### High risk

- **Frame visual skin** (background gradients/images, border, `box-shadow`, `border-radius`)
- **Canvas backgrounds/textures** and `::before` overlay layers
- **Pseudo-elements** on frame or canvas
- **Daily Fritz** mode skin (`dailyFritzMatchBoard.css`)
- **Learn/Guided** skin (`learnGuidedMatch.css`) including tile transform/scaling blocks adjacent to canvas selectors
- **`match-hud-polish.css`** global frame polish (affects all `.screen.game-screen`)
- Anything touching **tile rendering**, highlights, or domino plane geometry
- Moving visual rules into `board-surface.css` without parity testing across all six routes

---

## E. Route matrix

| Route / mode | Screen / root signals | Frame emitter | Main CSS owners (surface) | Highest-risk selectors |
|--------------|----------------------|---------------|---------------------------|-------------------------|
| **Daily Fritz** | `.bot-match-screen.bot-match-mode-daily-fritz` (+ `.df-board-has-play`) | `MatchNblBoardFrame` in `BotMatchScreen` `boardStage` | `noBrainerLab.css` (imported) → `walnut-live.css` bot blocks → **`dailyFritzMatchBoard.css`** | `.bot-match-mode-daily-fritz .nbl-board-canvas::before`, `.nbl-board-frame::after`, watermark play-state |
| **Play vs Fritz** | `.bot-match-screen` (non-lesson, non-DF mode class) | `MatchNblBoardFrame` | `noBrainerLab.css` → **`walnut-live.css`** bot-match frame/canvas/`::before`/watermark (~1895–2593) → `match-hud-polish.css` global frame | `.bot-match-screen:not(.learn-lesson-screen) .nbl-board-canvas`, `::before`, frame `::before`/`::after` |
| **Ghost / bot match** | Same as PvF (mode class varies) | `MatchNblBoardFrame` | Same stack as PvF + `botMatch.css` mobile board-container fit | `walnut-live` canvas `background-image` layers; mobile `.board-container` `overflow`/`transform-origin` |
| **Daily Puzzle** | `.rh-standard-live-board.daily-puzzle-screen` | `InGameBoardFrame` via `InGameBoardShell` | `noBrainerLab.css` → **`match-standard-live-board.css`** (overrides NBL inside `.rh-live-board-zone`) → `board-shell.css` | `.rh-standard-live-board .nbl-board-canvas` visual block (background/box-shadow); pseudo suppression block |
| **Practice / No Brainer Lab** | `.practice-lab.rh-standard-live-board` | `InGameBoardFrame` via `InGameBoardShell` | **`noBrainerLab.css`** (owns base frame skin) + `match-standard-live-board.css` zone overrides + `board-shell.css` | `.nbl-board-frame` base gradients/shadows; practice lacks route-specific canvas skin file — relies on NBL base |
| **Learn / Guided** | `.learn-lesson-screen` + `.learn-guided-live-board-zone` | `MatchNblBoardFrame` inside guided layout (`boardStage` in zone) | `noBrainerLab.css` → **`learnGuidedMatch.css`** (zone + board-card) → lesson exclusions in `walnut-live` | `.learn-guided-live-board-zone .nbl-board-canvas`, tile scale selectors, watermark |

**Shared across routes:** `match-hud-polish.css` `.screen.game-screen .nbl-board-frame` applies unless a more specific route block overrides it.

---

## F. Recommended next fork (Patch 27)

### Options considered

| Option | Summary | Verdict |
|--------|---------|---------|
| **1 — Plan first `board-surface.css` ownership move (base canvas structure only)** | Move or copy-own the shared `.nbl-board-canvas, .rh-board-canvas` flex box (+ optionally the three `.board-container` stacking pairs) into `board-surface.css`; leave legacy files as re-export or thin forwarders in a later patch | **Recommended** |
| **2 — Watermark split audit** | Decompose opacity/size vs position across 4+ files | Defer — medium risk, no neutral CSS yet |
| **3 — Frame visual ownership audit** | Map `nbl-board-frame` vs `rh-board-frame` skin before any alias | Defer — high risk; do before visual aliases, not before structure move |
| **4 — Hand dock / tray cleanup** | Shift focus to `board-hand-dock.css` | Valid parallel track, but does not advance surface ownership |

### Recommendation: **Option 1 (planning only for Patch 27)**

**Patch 27 should be a written implementation plan** (not CSS edits) for the first real `board-surface.css` ownership move, limited to:

1. **Candidate rule:** `.nbl-board-canvas, .rh-board-canvas` base structure from `noBrainerLab.css` (the only cross-route neutral structure block today).
2. **Optional second candidate (same patch series, still low risk):** the three completed `.board-container` stacking alias groups — moved as-is into `board-surface.css`, with legacy files reduced to `@import` or duplicate selectors until deletion proof exists.

**Do not include in Patch 27 implementation:**

- Frame visuals (`.nbl-board-frame` backgrounds, `match-hud-polish` polish)
- Watermark rules
- Pseudo-elements
- Route skins (`match-standard-live-board`, `walnut-live` bot canvas, Daily Fritz, Learn/Guided)

**Reasoning:**

- Low-risk **alias** work for canvas/container stacking is **done**; further alias-only patches have diminishing returns.
- `board-surface.css` is the declared canonical owner but empty; the base canvas flex box is the smallest shared rule with neutral classes already in DOM and CSS.
- Moving structure before visuals avoids splitting skin across two owners prematurely.
- Import order must be planned explicitly: `board/index.css` loads **after** legacy globals, so moved rules may need to stay in legacy files as forwards until specificity/order is validated — the plan should document that.

**Suggested Patch 27 deliverable:** `docs/board-surface-first-move-plan.md` with move list, before/after ownership table, import-order notes, route verification checklist (from `docs/board-canvas-fit-alias-plan.md` §F), and explicit “no forward delete” until Patch 28+ parity proof.

---

## References

- `docs/board-canvas-fit-alias-plan.md` — Patch 24/25 alias scope
- `docs/board-css-ownership-audit.md` — broader ownership map
- `client/src/styles/board/README.md` — namespace file intents
