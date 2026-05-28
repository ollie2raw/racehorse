# Board Surface First Ownership Move Plan

**Patch:** 27 (planning / audit only — no implementation)  
**Date:** 2026-05-28  
**Candidate rule:** base canvas structure (`.nbl-board-canvas, .rh-board-canvas`)  
**Source:** `client/src/practice/noBrainerLab.css`  
**Target:** `client/src/styles/board/board-surface.css`  
**Mode:** No-visual-change ownership migration  

**Related:** `docs/neutral-board-surface-bridge-checkpoint.md`, `docs/board-canvas-fit-alias-plan.md`

---

## Executive summary

**Verdict:** The base canvas structure rule is a **good first ownership candidate**. All eight declarations are structural (layout/stacking). No active route CSS overrides `display`, `align-items`, `justify-content`, `position`, or canvas `z-index` on `.nbl-board-canvas` / `.rh-board-canvas`. Route files only add **visual** properties (background, border, shadow) at higher specificity.

**Import-order risk:** **Low** for visual parity. Moving the rule into `board-surface.css` (loaded from `main.tsx` via `styles/board/index.css`) makes it apply **earlier and globally** instead of only when a component chunk imports `noBrainerLab.css`. That timing change is acceptable because nothing in the global bundle currently overrides these structural properties after the NBL import.

**Recommendation for Patch 28:** **Option 1** — add the full combined selector to `board-surface.css` and **delete** the legacy copy from `noBrainerLab.css` in the same patch, then run the browser matrix below. Keep **Option 2** (copy-only, leave legacy) as an immediate rollback path if any route fails verification.

**Do not** implement Option 3 (split selectors across files).

---

## A. Current source rule location

### File path

`client/src/practice/noBrainerLab.css`

### Line / location

**Lines 203–213** (between frame `::after` and watermark blocks).

### Full rule body

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

### Surrounding related rules (before / after)

**Immediately before (lines 169–201):**

- `.nbl-board-frame` — frame flex box + **visual skin** (gradients, border, shadow)
- `.nbl-board-frame::after` — inset bezel pseudo-layer (`z-index: 1`)

**Immediately after (lines 215–238):**

- `.nbl-board-watermark` — absolute positioning, size, opacity (visual)
- `.nbl-board-watermark img`
- `.practice-lab .nbl-board-canvas .board-container, .practice-lab .rh-board-canvas .board-container` — child stacking (`z-index: 4`)
- `.nbl-board-toolbar` — absolute controls (`z-index: 23`)

### Source-order dependencies nearby

| Concern | Assessment |
|---------|------------|
| Canvas rule must load **after** `.nbl-board-frame::after` | **No.** Pseudo is on frame; canvas is a child with `z-index: 2` > frame pseudo `z-index: 1`. Order between sibling blocks in same file does not affect stacking context here. |
| Canvas rule must load **before** watermark | **No hard dependency.** Watermark uses `z-index: 3` on a descendant; independent of block order in file. |
| Canvas rule must load **before** `.board-container` stacking | **Logical layering only.** Container rule targets a child; higher `z-index: 4` wins regardless of file order between parent and child rules at different specificity. |
| Practice `.board-container` rule in same file | **Independent.** Can remain in `noBrainerLab.css`; not part of this move. |

**Conclusion:** The canvas structure block is **logically isolated**. Safe to extract without moving adjacent frame/watermark/toolbar rules.

---

## B. Import order / cascade analysis

### Where `noBrainerLab.css` is imported

| Import path | Mechanism |
|-------------|-----------|
| `client/src/components/MatchNblBoardFrame.tsx` | `import '../practice/noBrainerLab.css'` |
| `client/src/match/InGameBoardShell.tsx` | `import '../practice/noBrainerLab.css'` |
| `client/src/practice/NoBrainerLabScreen.tsx` | `import './noBrainerLab.css'` |

**Not** imported from `client/src/main.tsx`. It is bundled with whichever JS module is evaluated first among the above (typically the frame component when a match route loads). Vite deduplicates a single CSS module per build.

### Where `styles/board/index.css` is imported

`client/src/main.tsx` line 18 — **global, synchronous, every session:**

```ts
import './styles/board/index.css';
```

### Where `board-surface.css` is imported

`client/src/styles/board/index.css` line 16:

```css
@import './board-surface.css';
```

**Order inside `board/index.css`:**

1. `board-layout.css`
2. `board-hud.css`
3. `board-shell.css` ← active shell structure (includes `.rh-board-frame` sizing)
4. **`board-surface.css`** ← target (currently comment-only)
5. `board-meta.css` … `board-modals.css`, `skins/racehorse-matte.css`

### Global CSS order in `main.tsx` (relevant tail)

1. `walnut-live.css`
2. `rh-glow-underline.css`
3. `game-interactions.css`
4. `match-hud-polish.css`
5. `match-board-architecture.css`
6. `match-standard-live-board.css`
7. `gameLayoutLayers.css`
8. `racehorse-background.css`
9. `rh-image-surface.css`
10. **`styles/board/index.css`** (shell + future surface)

Then **route/component CSS** loads with JS chunks (e.g. `noBrainerLab.css`, `botMatch.css`, `dailyFritzMatchBoard.css`, `learn.css` → `learnGuidedMatch.css`).

### Earlier or later after move?

| Today | After move to `board-surface.css` |
|-------|-----------------------------------|
| Structure rule loads with **component chunk** (often **after** entire `main.tsx` stack) | Structure rule loads in **main bundle** at step 10, **before** route chunks |
| Same rule is last “global” definition of these properties on canvas until route overrides | Same, but **earlier** in page lifecycle |

**Later CSS that touches `.nbl-board-canvas` (higher specificity, different properties):**

| File | Overrides on canvas element | Structural props touched? |
|------|----------------------------|-------------------------|
| `match-standard-live-board.css` | `border`, `border-radius`, `background-*`, `box-shadow` (`!important`) | **No** |
| `walnut-live.css` (bot-match blocks) | Same class of visual props | **No** |
| `learnGuidedMatch.css` (`.learn-guided-live-board-zone .nbl-board-canvas`) | Visual only | **No** |
| `learnGuidedMatch.css` (`.learn-guided-board-card .nbl-board-canvas`) | `width`, `height`, `min-height` (`!important`) | **Yes** — but **no TSX usage** of `.learn-guided-board-card` wrapper found (dead path; only `__hint` children exist) |
| `dailyFritzMatchBoard.css` | `::before` only on canvas | **No** (pseudo, not element box) |

**Nothing in `main.tsx` global stack** overrides `display`, `flex`, `align-items`, `justify-content`, `position`, or canvas `z-index: 2` on `.nbl-board-canvas` / `.rh-board-canvas`.

**`board-shell.css`** sets `width` / `height: 100%` on **frame** (`.nbl-board-frame`, `.rh-board-frame`), not on canvas — complementary, not conflicting.

### Cascade conclusion

Moving this rule to `board-surface.css` changes **when** the base structure applies (app init vs chunk load), not **what wins** on active routes. Route visual skins still win on their declared properties. **Import-order risk for visual parity: low.**

---

## C. Route impact

All listed routes use `MatchNblBoardFrame` and/or `InGameBoardFrame`, which import `noBrainerLab.css` today. The structure rule therefore already applies on every active board route once the frame module loads. After move, it applies from global `board-surface.css` even before the chunk import (harmless if no canvas in DOM).

| Route / mode | Frame emitter | Rule applies today? | After move | Notes |
|--------------|---------------|---------------------|------------|-------|
| **Daily Fritz** | `MatchNblBoardFrame` in `BotMatchScreen` | Yes (via NBL import + `dailyFritzMatchBoard.css` skin) | Yes (global + same skins) | Canvas `::before` / visual in DF CSS unchanged |
| **Play vs Fritz** | `MatchNblBoardFrame` | Yes | Yes | `walnut-live.css` bot canvas skin unchanged |
| **Ghost / bot match** | `MatchNblBoardFrame` | Yes | Yes | Same stack as PvF |
| **Daily Puzzle** | `InGameBoardFrame` via `InGameBoardShell` | Yes | Yes | `match-standard-live-board.css` zone skin unchanged |
| **Practice / No Brainer Lab** | `InGameBoardFrame` via `InGameBoardShell` + screen imports NBL | Yes | Yes | Frame **visual** still from `.nbl-board-frame` in same file |
| **Learn / Guided** | `MatchNblBoardFrame` in `.learn-guided-live-board-zone` | Yes | Yes | `learnGuidedMatch.css` visual overrides unchanged; tile `transform: scale` on board descendants, not canvas box model |

**Multiplayer (`App.tsx` + `MatchNblBoardFrame`):** Same as bot/PvF — structure rule required; move does not remove `noBrainerLab.css` import (frame skin still there).

---

## D. Declaration-by-declaration risk

| Declaration | Pure structure? | Source-order sensitive? | Route override? | Safe to move? |
|-------------|-----------------|-------------------------|-----------------|---------------|
| `position: relative` | Yes — stacking context for watermark/children | No active override on canvas | None found | **Yes** |
| `z-index: 2` | Yes — above frame `::after` (1), below watermark (3) | No | None on canvas element | **Yes** |
| `width: 100%` | Yes | No | `.learn-guided-board-card` sets `100% !important` — **dead selector** | **Yes** |
| `height: 100%` | Yes | No | Same dead card rule | **Yes** |
| `min-height: 200px` | Yes — floor for empty/small playfield | No | Dead card rule would use `min-height: 0 !important` if that wrapper existed | **Yes** |
| `display: flex` | Yes — centers engine | No | None | **Yes** |
| `align-items: center` | Yes | No | None | **Yes** |
| `justify-content: center` | Yes | No | None | **Yes** |

**Child note:** `.board-container` stacking (`z-index: 4`) is a **separate rule** — stays in legacy files for this patch series.

---

## E. Migration options

### Option 1: Move to `board-surface.css` and delete legacy copy

| Pros | Cons |
|------|------|
| Single owner; matches namespace intent | Rule loads earlier (global vs chunk) — analyzed as safe |
| No duplicate maintenance | Requires one browser matrix before merge |
| User-preferred if risk low | `noBrainerLab.css` import must remain for frame skin |

### Option 2: Copy to `board-surface.css`; keep legacy temporarily

| Pros | Cons |
|------|------|
| Zero cascade change until delete | Duplicate rules; audit noise |
| Easy rollback (remove copy) | Two sources of truth during gap |
| Good if team wants proof before delete | Slightly larger CSS until Patch 29 |

### Option 3: Move only `.rh-board-canvas` to `board-surface.css`; leave `.nbl-board-canvas` in NBL

| Pros | Cons |
|------|------|
| None meaningful | Same element has **both** classes — both rules still needed or redundant |
| | Splits ownership arbitrarily; worse for migration |
| | **Not recommended** |

### Option 4: Do not move; continue legacy aliasing only

| Pros | Cons |
|------|------|
| Zero move risk | No progress on `board-surface.css` ownership |
| | Alias queue already exhausted |
| | **Not recommended** now |

---

## F. Recommended Patch 28

**Primary: Option 1** — one implementation patch:

1. Add the exact combined rule to `board-surface.css` with an ownership comment.
2. Remove lines 203–213 from `noBrainerLab.css` (do not remove frame/watermark/toolbar).
3. Update `board/index.css` header comment: `board-surface.css` is no longer comment-only.
4. Run verification searches + client build + browser matrix (Section I).

**Why not wait on Option 2:** Cascade analysis shows no structural overrides downstream. Option 2 is the **rollback strategy** if any route fails visual/stacking checks — re-add the block to `noBrainerLab.css` and remove from `board-surface.css`.

**Why not Option 3 or 4:** Undermines neutral bridge and delays canonical ownership without reducing risk.

---

## G. Exact proposed Patch 28 (implementation spec)

### Files to edit

| File | Action |
|------|--------|
| `client/src/styles/board/board-surface.css` | **Add** rule + ownership comment |
| `client/src/practice/noBrainerLab.css` | **Remove** lines 203–213 only |
| `client/src/styles/board/index.css` | **Update** “comment-only” note in file header (optional but recommended) |

### Do **not** edit in Patch 28

- `MatchNblBoardFrame.tsx` / `InGameBoardShell.tsx` — keep `noBrainerLab.css` import (frame skin still required)
- `board-container` stacking aliases
- Any visual surface, pseudo, watermark, or route skin files

### Rule to add to `board-surface.css`

Place after the existing file header block:

```css
/*
 * Canonical owner: shared playfield canvas structure (neutral + legacy class).
 * Migrated from noBrainerLab.css (Patch 28). Visual skins remain in route legacy files.
 */
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

### Rule to remove from `noBrainerLab.css`

Delete the entire block at lines 203–213 (inclusive). **Do not** delete the blank line gap in a way that merges unrelated rules; leave one blank line between `::after` and watermark sections.

### Ownership comment in `noBrainerLab.css` (optional, at former site)

```css
/* Base canvas structure: canonical owner board-surface.css (.nbl-board-canvas, .rh-board-canvas) */
```

### Verification searches (post-implementation)

```bash
# Rule should appear exactly once in board-surface (plus this doc)
rg '\.nbl-board-canvas,\s*\n\.rh-board-canvas' client/src --glob '*.css'

# Legacy file should NOT define the structure block (may still reference in comments)
rg 'min-height: 200px' client/src/practice/noBrainerLab.css

# Confirm frame/watermark still in NBL
rg '\.nbl-board-frame \{' client/src/practice/noBrainerLab.css
rg '\.nbl-board-watermark' client/src/practice/noBrainerLab.css

# Confirm route skins untouched
rg '\.nbl-board-canvas' client/src/styles/match-standard-live-board.css
rg '\.nbl-board-canvas' client/src/styles/walnut-live.css
```

### Build

```bash
npm run build --prefix client
```

---

## H. What not to touch (Patch 28 scope fence)

- `.nbl-board-frame` / `.rh-board-frame` visual skin and flex padding
- `.nbl-board-frame::before` / `.nbl-board-frame::after`
- `.nbl-board-canvas::before` (all routes)
- `.nbl-board-watermark` / `.rh-board-watermark`
- Daily Fritz surface skin (`dailyFritzMatchBoard.css`)
- Learn/Guided surface skin (`learnGuidedMatch.css`)
- Practice frame visuals (`.nbl-board-frame` block in `noBrainerLab.css`)
- `match-hud-polish.css` generic frame polish
- `.board-container` / `.board-canvas` engine rules (`App.css`, etc.)
- `.practice-lab … .board-container` / walnut / standard-live stacking aliases
- Tile styling, highlights, interactions
- Hand dock / tray (`board-hand-dock.css`, `wl-hand-area`, etc.)
- Meta / controls / overlays / modals
- React components and gameplay logic

---

## I. Browser verification checklist

After Patch 28 implementation, verify **no change** in board centering, playfield fill, or tile plane stacking.

### Routes

- [ ] Daily Fritz active match (`bot-match-mode-daily-fritz`)
- [ ] Play vs Fritz active match
- [ ] Ghost / bot match
- [ ] Daily Puzzle play screen (`rh-standard-live-board`)
- [ ] Practice / No Brainer Lab (`practice-lab`)
- [ ] Learn / Guided lesson board (`learn-lesson-screen`, guided zone)
- [ ] Multiplayer match (`App.tsx` + `MatchNblBoardFrame`) if easily reachable

### Viewports

- [ ] Desktop wide
- [ ] Laptop
- [ ] Narrow width (≤768px)
- [ ] Short height (`dvh` constrained)

### Per route, inspect

- [ ] Board engine centered in playfield (flex centering)
- [ ] Canvas fills frame; no collapse below ~200px min-height where expected
- [ ] Watermark behind tiles, toolbar above surface
- [ ] Tiles render above felt (no z-index inversion)
- [ ] Route-specific **visual** skin unchanged (colors, inset shadow, DF brass, puzzle blue felt)
- [ ] No new clipping at canvas edge after first tile played
- [ ] Learn guided tile scale (1.08) still correct

---

## Patch series map

| Patch | Role |
|-------|------|
| 25 | Low-risk `.board-container` stacking aliases |
| 26 | Bridge checkpoint doc |
| **27** | **This plan (audit only)** |
| **28** | Implement first `board-surface.css` ownership move (structure only) |
| 29+ | Optional: move `.board-container` stacking triad; later visual ownership plans |

---

## References

- `docs/neutral-board-surface-bridge-checkpoint.md`
- `docs/board-canvas-fit-alias-plan.md`
- `client/src/styles/board/README.md`
