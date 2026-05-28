# Board Container Stacking Ownership Plan

**Patch:** 29 (planning / audit only — no implementation)  
**Date:** 2026-05-28  
**Candidate rules:** three low-risk `.board-container` stacking alias groups under NBL canvas  
**Target owner:** `client/src/styles/board/board-surface.css`  
**Mode:** No-visual-change ownership migration  

**Related:** `docs/board-surface-first-ownership-move-plan.md`, `docs/neutral-board-surface-bridge-checkpoint.md`

---

## Executive summary

**Verdict:** All three stacking rules are **safe to move as-is** into `board-surface.css` and delete from legacy files in a single Patch 30, with one ordering note inside `board-surface.css`.

| Rule | Recommendation |
|------|----------------|
| 1. `walnut-live` global NBL canvas | **Move + delete** |
| 2. `rh-standard-live-board` zone | **Move + delete** |
| 3. `practice-lab` scoped | **Move + delete** |

**Import-order risk:** **Low.** Selectors and declarations stay identical. Moving rules into `board-surface.css` changes load timing (global main bundle vs component chunk for practice), but cascade outcomes are preserved because route-scoped specificity is unchanged and no later global CSS overrides `position` / `z-index` on these paths.

**Consolidation:** **Do not consolidate** the three selectors into one rule — scopes differ (`walnut-live` vs `rh-standard-live-board` + zone vs `practice-lab`).

**Patch 30:** Move all three blocks exactly as-is below the existing canvas structure rule in `board-surface.css`; remove from source files; run build + browser matrix.

---

## A. Current rule locations

### Rule 1 — `walnut-live.css`

| Field | Value |
|-------|--------|
| **File** | `client/src/styles/walnut-live.css` |
| **Lines** | 373–377 |
| **Body** | See below |

```css
.walnut-live .nbl-board-canvas .board-container,
.walnut-live .rh-board-canvas .board-container {
  position: relative;
  z-index: 4;
}
```

**Surrounding rules**

- **Before (368–371):** `.walnut-live .walnut-nbl-stage .nbl-board-frame` — frame flex (`flex`, `min-height` only).
- **After (379+):** `.wl-stage-shell` — stage shell layout (unrelated to `.board-container`).

**Source-order dependency:** **None.** Independent descendant selector; does not rely on preceding `.nbl-board-frame` block order.

**Related legacy (not in this move):** `.walnut-live .wl-board-area .board-container` at lines 436–439 — parallel **legacy board-area** path, not NBL canvas.

---

### Rule 2 — `match-standard-live-board.css`

| Field | Value |
|-------|--------|
| **File** | `client/src/styles/match-standard-live-board.css` |
| **Lines** | 80–84 |
| **Body** | See below |

```css
.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .nbl-board-canvas .board-container,
.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .rh-board-canvas .board-container {
  position: relative;
  z-index: 4;
}
```

**Surrounding rules**

- **Before (74–78):** `.nbl-board-watermark` size/opacity in standard-live zone (visual).
- **Before (60–72):** `.nbl-board-canvas` / `.board-area.wl-board-area` visual skin on canvas (background, border, shadow).
- **After (86+):** `.rh-board-meta-bar`, control pills — HUD chrome.

**Source-order dependency:** **None** for stacking. Canvas visual rules (60–72) target the **canvas element**; this rule targets **`.board-container` child** — no property conflict.

**Note:** `.rh-live-board-zone::after` uses `z-index: 4` on a **pseudo-element** (line 37), not `.board-container`.

---

### Rule 3 — `noBrainerLab.css`

| Field | Value |
|-------|--------|
| **File** | `client/src/practice/noBrainerLab.css` |
| **Lines** | 223–226 |
| **Body** | See below |

```css
.practice-lab .nbl-board-canvas .board-container,
.practice-lab .rh-board-canvas .board-container {
  z-index: 4;
}
```

**Surrounding rules**

- **Before (203–221):** `.nbl-board-watermark` + `img` (visual/positioning).
- **After (228+):** `.nbl-board-toolbar` — absolute controls (`z-index: 23`).

**Source-order dependency:** **None.** `App.css` already sets `.board-container { position: relative; }` (line 2959); this rule only adds `z-index`.

**Redundancy note:** `NoBrainerLabScreen` root also has `rh-standard-live-board` (see Route impact). Rule 2 **supersedes** rule 3 on practice for both `position` and `z-index` when all classes present. Rule 3 remains a valid scoped fallback if `practice-lab` is ever used without `rh-standard-live-board`.

---

## B. Import order / cascade analysis

### Global imports (`client/src/main.tsx`)

| Order | Stylesheet | Contains audited rule today? |
|-------|------------|------------------------------|
| 9 | `walnut-live.css` | **Rule 1** |
| 14 | `match-standard-live-board.css` | **Rule 2** |
| 18 | `styles/board/index.css` | → `board-surface.css` (canvas structure only; **Patch 28**) |

Between rules 14 and 18: `gameLayoutLayers.css`, `racehorse-background.css`, `rh-image-surface.css`, then `board-layout`, `board-hud`, `board-shell` — **none** reference `.board-container`.

### Component / chunk imports

| File | Import mechanism |
|------|------------------|
| `noBrainerLab.css` | `MatchNblBoardFrame.tsx`, `InGameBoardShell.tsx`, `NoBrainerLabScreen.tsx` — **not** in `main.tsx` |
| `botMatch.css` | `BotMatchScreen.tsx` — loads **after** main bundle |

**Rule 3 today** loads with the NBL CSS chunk (often **late**). After move, it loads with **main** `board-surface.css` (**earlier**). On practice screens, rule 2 (`rh-standard-live-board`, specificity 0,6,0) still wins over rule 3 (0,3,0) — **no behavior change** on current DOM.

### Where `board-surface.css` is imported

`main.tsx` → `styles/board/index.css` (line 16: `@import './board-surface.css';'`).

### Earlier or later after move?

| Rule | Today (first load) | After move to `board-surface.css` |
|------|-------------------|-----------------------------------|
| **1** | `main` step 9 (`walnut-live.css`) | `main` step 18 (`board-surface.css`) — **later** |
| **2** | `main` step 14 (`match-standard-live-board.css`) | `main` step 18 — **later** (~4 global files later) |
| **3** | Component chunk (late) | `main` step 18 — **earlier** on practice |

**Between old rule 2 position (14) and board-surface (18):** no `.board-container` `position` / `z-index` overrides found.

**After `board-surface.css` in main:** only remaining board-namespace imports in `index.css` (`board-meta` through `skins/racehorse-matte.css`) — **no** `.board-container` hits in `styles/board/`.

### Later overrides on `.board-container` (relevant paths)

| Source | Properties | Overrides `position` / `z-index` on NBL path? |
|--------|------------|-----------------------------------------------|
| `App.css` `.board-container` | `position: relative`, no z-index | Base; our rules add `z-index: 4` |
| `walnut-live.css` `.walnut-live .wl-board-area .board-container` | `position: relative; z-index: 4` | **Different ancestor** (`.wl-board-area`, not `.nbl-board-canvas`) |
| `botMatch.css` `@media` `.bot-match-screen .board-container` | `width`, `height`, `overflow`, etc. | **No** `position` / `z-index` |
| `dailyPuzzle.css` mobile `.daily-puzzle-screen .board-container` | fit/sizing | **No** `z-index` on audited path |
| Learn/academy/player CSS | lesson-specific wrappers | **Different routes/DOM** |

**Specificity preserved:** moving rules does not change selector strings. Route-scoped selectors keep the same winning rules on the same screens.

**Recommended order inside `board-surface.css` after Patch 30** (documentation only; all three are distinct specificity tiers where they overlap):

1. Existing canvas structure (Patch 28)
2. Rule 1 — `walnut-live` (0,3,0)
3. Rule 3 — `practice-lab` (0,3,0)
4. Rule 2 — `rh-standard-live-board` + zone (0,6,0) — highest; list last among the three for readability

---

## C. Route impact

### Rule 1 — `.walnut-live .nbl-board-canvas .board-container` (+ rh alias)

| Route | Applies? | Notes |
|-------|----------|--------|
| Daily Fritz | **Yes** | `walnut-live` + `bot-match-screen`; no `rh-standard-live-board` |
| Play vs Fritz | **Yes** | Same |
| Ghost / bot match | **Yes** | Same |
| Daily Puzzle | **Partial** | Also has `rh-standard-live-board` — **rule 2 wins** (higher specificity) |
| Practice / NBL | **Partial** | `walnut-live` + `practice-lab` + `rh-standard-live-board` — **rule 2 wins** |
| Learn / Guided | **Yes** | `walnut-live` + `learn-lesson-screen`; typically **no** `rh-standard-live-board` |

### Rule 2 — `rh-standard-live-board` … `.rh-live-board-zone` …

| Route | Applies? | DOM signal |
|-------|----------|------------|
| Daily Fritz | **No** | No `rh-standard-live-board` on `BotMatchScreen` |
| Play vs Fritz | **No** | |
| Ghost / bot | **No** | |
| Daily Puzzle | **Yes** | `rh-standard-live-board` on screen root |
| Practice / NBL | **Yes** | Same class on `NoBrainerLabScreen` |
| Learn / Guided | **No** | Lesson uses guided zone, not standard-live board shell |

### Rule 3 — `.practice-lab` …

| Route | Applies? | Notes |
|-------|----------|--------|
| Daily Fritz | **No** | |
| Play vs Fritz | **No** | |
| Ghost / bot | **No** | |
| Daily Puzzle | **No** | |
| Practice / NBL | **Yes** | `practice-lab` on root; superseded by rule 2 when `rh-standard-live-board` present |
| Learn / Guided | **No** | |

---

## D. Rule-by-rule recommendation

| # | Rule | Recommendation | Rationale |
|---|------|----------------|-----------|
| 1 | `walnut-live` NBL canvas | **Move + delete** | Structural only; bot/PvF/DF/learn depend on it; later load in main is safe |
| 2 | `rh-standard-live-board` zone | **Move + delete** | Puzzle + practice; slight later load vs today — no intervening overrides |
| 3 | `practice-lab` scoped | **Move + delete** | Subset of rule 2 on current practice DOM; move for ownership cohesion |

**Copy-first not required** unless Patch 30 browser matrix fails — cascade analysis does not show ambiguous conflicts.

---

## E. Combined migration option

### Can we consolidate into fewer selectors?

| Consolidation idea | Safe? |
|--------------------|-------|
| Single rule for all routes | **No** — would drop required scoping (`practice-lab`, `rh-live-board-zone`, `rh-standard-live-board`) |
| Merge rule 1 + rule 3 | **No** — `practice-lab` must not apply to bot-only routes |
| Merge rule 1 + rule 2 | **No** — rule 2 requires extra ancestors; bot routes must not require `rh-standard-live-board` |
| Drop rule 3 as redundant | **Tempting but avoid in Patch 30** — practice-scoped intent; zero cost to keep as-is |

**Recommendation:** Move **three separate rule blocks exactly as-is** (same selectors, same declarations, same blank-line style). Optional comment grouping in `board-surface.css` only.

---

## F. Recommended Patch 30

**Primary: Move all three rules to `board-surface.css` and delete legacy copies in one patch** (matches user preference).

1. Append three blocks under the Patch 28 canvas structure rule in `board-surface.css` with a shared ownership comment.
2. Remove lines 373–377 from `walnut-live.css`.
3. Remove lines 80–84 from `match-standard-live-board.css`.
4. Remove lines 223–226 from `noBrainerLab.css`.
5. `npm run build --prefix client`
6. Browser matrix (Section I).

**Fallback:** If any route shows tile-plane or watermark stacking inversion, restore the failing block to its legacy file (Option 2 copy-back) and file a Patch 30b before retrying delete.

**Do not** remove `walnut-live .wl-board-area .board-container` — out of scope.

---

## G. Exact proposed Patch 30 (implementation spec)

### Files to edit

| File | Action |
|------|--------|
| `client/src/styles/board/board-surface.css` | Add three rule blocks + comment |
| `client/src/styles/walnut-live.css` | Delete rule 1 |
| `client/src/styles/match-standard-live-board.css` | Delete rule 2 |
| `client/src/practice/noBrainerLab.css` | Delete rule 3 |

### Ownership comment + rules to add (`board-surface.css`)

Place immediately after the existing canvas structure block (after line 31):

```css
/* Board engine container stacking above canvas (z-index 2) and watermark (z-index 3).
   Route scopes preserved from legacy files (Patch 30). Visual skins remain legacy-owned. */

.walnut-live .nbl-board-canvas .board-container,
.walnut-live .rh-board-canvas .board-container {
  position: relative;
  z-index: 4;
}

.practice-lab .nbl-board-canvas .board-container,
.practice-lab .rh-board-canvas .board-container {
  z-index: 4;
}

.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .nbl-board-canvas .board-container,
.screen.game-screen.walnut-live.rh-standard-live-board .rh-live-board-zone .rh-board-canvas .board-container {
  position: relative;
  z-index: 4;
}
```

*(Order: walnut → practice → standard-live — highest specificity last among equals for maintainability.)*

### Rules to remove

| File | Remove |
|------|--------|
| `walnut-live.css` | Lines 373–377 (inclusive); keep blank line hygiene between neighbors |
| `match-standard-live-board.css` | Lines 80–84 |
| `noBrainerLab.css` | Lines 223–226 |

### Verification commands

```bash
# All three patterns should appear only in board-surface.css
rg 'nbl-board-canvas \.board-container' client/src --glob '*.css'
rg 'rh-board-canvas \.board-container' client/src --glob '*.css'

# Legacy files should not define these stacking blocks
rg 'z-index: 4' client/src/styles/walnut-live.css | rg 'board-container'
rg 'board-container' client/src/styles/match-standard-live-board.css
rg 'practice-lab .rh-board-canvas .board-container' client/src/practice/noBrainerLab.css

# Canvas structure still owned in board-surface
rg 'min-height: 200px' client/src/styles/board/board-surface.css

npm run build --prefix client
```

---

## H. What not to touch (Patch 30 fence)

- `.nbl-board-frame` / `.rh-board-frame` (visual + shell)
- `.nbl-board-frame::before` / `::after`
- `.nbl-board-canvas::before`
- `.nbl-board-watermark` / `.rh-board-watermark`
- Daily Fritz surface skin (`dailyFritzMatchBoard.css`)
- Learn/Guided surface skin (`learnGuidedMatch.css`)
- Practice frame visuals (`.nbl-board-frame` in `noBrainerLab.css`)
- `walnut-live .wl-board-area .board-container` (legacy parallel path)
- `Board.tsx` / engine markup
- `App.css` base `.board-container` / `.board-canvas` engine rules
- `botMatch.css` mobile fit block (unless regressions force review — out of scope for move)
- Tile styling, hand dock, meta/controls, overlays
- React components and gameplay logic

---

## I. Browser verification checklist

After Patch 30, confirm tiles render **above** felt/watermark and engine remains centered.

### Routes

- [ ] Daily Fritz active match
- [ ] Play vs Fritz active match
- [ ] Ghost / bot match
- [ ] Daily Puzzle play
- [ ] Practice / No Brainer Lab
- [ ] Learn / Guided lesson board
- [ ] Multiplayer (`App.tsx` + `MatchNblBoardFrame`) if reachable

### Viewports

- [ ] Desktop wide
- [ ] Laptop
- [ ] Narrow (≤768px) — bot mobile `.board-container` fit still OK
- [ ] Short height (`dvh`)

### Per route

- [ ] No tiles hidden under watermark
- [ ] No inversion vs toolbar (toolbar stays above at z-index 23)
- [ ] Puzzle/practice standard-live zone unchanged
- [ ] Bot/DF felt and brass accents unchanged (visual rules untouched)
- [ ] Learn guided tile scale unchanged

---

## Patch series map

| Patch | Role |
|-------|------|
| 28 | Canvas structure → `board-surface.css` |
| **29** | **This plan** |
| **30** | Implement container stacking ownership move |
| 31+ | Doc checkpoint update; frame visual ownership plan; watermark audit |

---

## References

- `docs/board-surface-first-ownership-move-plan.md`
- `docs/neutral-board-surface-bridge-checkpoint.md`
- `client/src/styles/board/board-surface.css` (current Patch 28 owner)
