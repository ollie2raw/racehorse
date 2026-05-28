# Board Phase 1 Cleanup Checkpoint

**Status:** Documentation checkpoint (Patch 49)  
**Date:** 2026-05-28  
**Mode:** Ownership / bridge complete for Phase 1 — **no further structure migration required** before skin planning  
**Scope:** Patches 1–48 — shared board composition, canonical CSS namespace, structural migrations, dead-rule removal

**Related checkpoints / audits:**

- `docs/neutral-board-surface-bridge-checkpoint.md` (surface bridge, Patches 19–30)
- `docs/board-hand-dock-ownership-checkpoint.md` (hand dock, Patches 32–44)
- `docs/board-meta-controls-ownership-audit.md` (Patch 45)
- `docs/board-controls-ownership-audit.md` (Patch 47)
- `client/src/styles/board/README.md` (namespace map)

---

## A. What Phase 1 accomplished

### Shared board composition (React)

Canonical in-game board layout lives under **`client/src/match/board/`** (and related match shell):

- `InGameBoardShell.tsx` — studio / walnut-hud / walnut-wrap layouts, meta bar slot, hand tray
- `InGameBoardFrame.tsx` — framed canvas, optional `nbl-board-toolbar` slot
- `MatchNblBoardFrame.tsx` — bot studio frame (same DOM classes, optional toolbar)
- Supporting shell/HUD/frame components as introduced in the board reset passes

Gameplay logic was **not** rewritten; composition was unified for live matches.

### Canonical board CSS namespace

**`client/src/styles/board/`** is the long-term home for shared board structure, loaded via `client/src/main.tsx` → `board/index.css` (after legacy globals such as `walnut-live.css` and `match-board-architecture.css`).

| File | Phase 1 ownership (structure) |
|------|----------------------------------|
| **`board-layout.css`** | Selected outer match layout structure |
| **`board-hud.css`** | Selected HUD rail / slot structure |
| **`board-shell.css`** | Shared board shell structure (studio shell, board zone) |
| **`board-surface.css`** | Base canvas structure + `.board-container` stacking inside canvas |
| **`board-hand-dock.css`** | Inner hand tray structure + bot `.rh-live-hand-deck` shell structure |
| **`board-meta.css`** | Shared `.rh-board-meta-bar` structure (Patch 46) |
| **`board-controls.css`** | Toolbar wrapper structure — `.rh-board-toolbar`, `.nbl-board-toolbar` (Patch 48) |
| **`board-tiles.css`** | Comment-only — future tile presentation |
| **`board-interactions.css`** | Comment-only — future interaction states |
| **`board-overlays.css`** / **`board-modals.css`** | Comment-only — future overlays |
| **`skins/racehorse-matte.css`** | Comment-only — future premium skin pass |

### Neutral runtime board classes

Live DOM carries **both** legacy and neutral aliases for bridge compatibility:

| Neutral class | Legacy alias | Role |
|---------------|--------------|------|
| `.rh-board-stage` | `.nbl-stage` | Board stage wrapper |
| `.rh-board-frame` | `.nbl-board-frame` | Inset frame / bezel |
| `.rh-board-canvas` | `.nbl-board-canvas` | Playfield canvas host |
| `.rh-board-watermark` | `.nbl-board-watermark` | Centered brand watermark |

Old **`nbl-*`** class names remain on elements for compatibility; selectors increasingly pair `nbl-*` with `rh-*`.

### Build discipline

Client build (`npm run build --prefix client`) has **continued to pass** after each implementation patch in Phase 1.

### Phase 1 patch map (high level)

| Range | Theme |
|-------|--------|
| **1–18** | Board reset planning, shell composition, namespace scaffolding |
| **19–30** | Neutral surface bridge → `board-surface.css`, shell structure → `board-shell.css` |
| **31–44** | Hand dock audits + structure → `board-hand-dock.css`, dead-rule deletion |
| **45** | Meta / controls ownership audit (planning) |
| **46** | Meta bar structure → `board-meta.css` |
| **47** | Controls ownership audit (planning) |
| **48** | Toolbar wrapper structure → `board-controls.css` |

---

## B. What was cleaned / deleted

Dead or duplicate rules removed during Phase 1 (no visual redesign intent):

| Item | Approx. patch | Notes |
|------|---------------|--------|
| Stale bot layout duplicate rules | Early layout passes | Reduced competing bot-match layout overrides |
| Stale HUD rail shell passes | HUD migration | Consolidated rail structure toward `board-hud.css` |
| Stale `.rh-live-hand-deck` v2 grid / `__header` | 35 | CSS-only; no matching DOM |
| Duplicate `.rh-live-hand-deck .wl-hand-area` child block | 37 | Merged into canonical walnut child reset |
| Dead global bot-match `.wl-hand-area` block | 41 | Superseded by deck-scoped + v3 rules |
| Inactive Daily Fritz hand-dock `border-top-color` | 43 | Dead vs `border: 0 !important` on deck child |

**Not deleted (deferred):** duplicate walnut bot-match pill/control blocks (~1893 vs ~2188), `wl-controls-tray` placement stacks, frame pseudo-elements, route visual skins.

---

## C. What remains intentionally legacy-owned

Do **not** migrate these casually; they belong in a **skin plan** or a dedicated high-risk pass.

### Visual board surface & frame

- Matte / glass / felt **surface skin** on frame and canvas
- **`.nbl-board-frame`** visual treatment (legacy name; paired with `.rh-board-frame`)
- **`.rh-board-frame`** visual ownership (borders, inset, shadows) — still split across route files
- Frame **pseudo-elements** (`::before`, `::after` on frame/canvas)
- **`.nbl-board-canvas::before`** (and route variants)
- **Watermark** sizing, opacity, filter
- **Daily Fritz** visual skin (`dailyFritzMatchBoard.css`, DF mode classes)

### Route-specific chrome

- **Learn / Guided** — `learnGuidedMatch.css`, `shared-ui.css`, `coach.css`, academy/player hides
- **Practice / NBL** — `nbl-board-controls-pill`, tray visuals, toolbar offsets in `noBrainerLab.css`
- **Daily Puzzle** — puzzle HUD + `match-standard-live-board.css` accents

### Tiles & interaction

- Tile body / pip visuals
- Selected, playable, hover, disabled states
- **`game-interactions.css`**
- **`rh-glow-underline.css`**

### Active controls (structure + skin still legacy)

- **`.wl-controls-tray`** — TSX inline `position` + `walnut-live` `!important` offsets
- **`.board-zoom-tray`** — position in `match-hud-polish.css` (mixed with skin)
- **`.control-pill`** visual skin (`match-hud-polish`, `walnut-live`, DF)
- **Inline TSX** on utility tray (`BotMatchScreen.tsx`, `App.tsx`)
- Zoom reset when inside `.rh-board-toolbar` — still in `match-board-architecture.css` (toolbar unused in DOM today)

### Other

- Meta / control **pill skins** (glass, brass open-ends accent, DF frosted HUD)
- Meta bar **counter typography** token in `match-board-architecture.css`
- **Overlays / modals** — end-of-hand, toasts, leave confirm, etc.
- **`botMatch.css`** meta pill typography/sizing

---

## D. Current risk status

| Area | Status |
|------|--------|
| **Board structure** | Much cleaner; shared layout has canonical files with predictable cascade |
| **Visual skins** | Still **legacy and layered** — random moves will cause regressions |
| **Controls** | **Partially risky** — inline styles + `!important` + duplicate walnut bot blocks |
| **Frame / watermark / tiles** | **Highest-risk** remaining CSS for any “cleanup” that touches appearance |
| **Black matte redesign** | **Much safer than at Phase 0 start**, but must go through **`skins/racehorse-matte.css`** and tokens — not ad-hoc overrides |

**Rule of thumb:** Phase 1 moved **structure**. Anything that changes **how it looks** is Phase 2+ skin work unless explicitly scoped as a no-visual ownership move.

---

## E. Suggested next fork

### Option A — Start black matte redesign planning (recommended)

Create a premium skin plan for **`client/src/styles/board/skins/racehorse-matte.css`** — **planning only, no implementation yet**.

Plan should define:

- Visual tokens (obsidian/matte surfaces, brass/gold accents, electric blue puzzle/multiplayer where applicable)
- Board hierarchy (shell → frame → canvas → tiles → HUD chrome)
- Matte/obsidian shell and frame depth
- HUD / pill treatment (meta bar, score rail, control pills)
- Hand dock treatment (deck strip vs inner tray)
- Frame depth, watermark restraint, tile ivory contrast

Align with homepage / Play vs Fritz matte-neon identity (`docs/agent-skills/racehorse-design-source-of-truth.md`).

### Option B — One more cleanup pass on active controls

Audit **`wl-controls-tray`**, **zoom tray**, **inline TSX placement**, and **duplicate walnut bot control rules** (`docs/board-controls-ownership-audit.md`).

Higher risk; useful if controls must be unified **before** skin work. Not required to start redesign.

### Option C — Frame visual ownership audit

Plan migration of **`.nbl-board-frame`**, **`.rh-board-frame`**, pseudo-elements, canvas skin, watermark into **`board-surface.css`** + **`skins/racehorse-matte.css`**.

High risk; directly gates board “premium table” look.

### Option D — Tile / interactions audit

Map tile visuals, selected/playable states, glow underline, disabled states → future split between **`board-tiles.css`** and **`board-interactions.css`**.

Medium–high visibility; best scheduled alongside skin plan.

---

## F. Recommendation

1. **Patch 50** = **black matte redesign planning only** (Option A). Deliverable: **`docs/board-black-matte-skin-plan.md`** — **no runtime CSS changes** (complete).
2. **Patch 51+** = implement visual skin in **small, route-verified passes** after the plan is approved (frame → canvas → pills → hand dock → tiles → interactions).

**Why stop auditing:** Phase 1 structure is sufficient to begin **product identity** work. Remaining high-risk layers should be touched **intentionally** as part of the skin system, not as endless ownership shuffles.

**Optional later (not Patch 50):** Option B controls dedupe, Option C frame audit, Option D tile audit — only if a specific regression or merge conflict forces them.

---

## G. Browser QA checklist before visual redesign

Run once on current `main` / branch after Patches 46–48 if not already done. Re-run after each skin implementation pass.

| Check | Routes / notes |
|-------|----------------|
| Daily Fritz active match | Meta bar, zoom, utility tray, hand dock, DF frosted pills |
| Play vs Fritz active match | Same studio path as bot |
| Ghost / bot match | Meta + controls + tile play |
| Daily Puzzle | Meta count-only, zoom, no utility tray on canvas |
| Practice / No Brainer Lab | `nbl-board-toolbar` + combined control pill |
| Learn / Guided | No canvas meta bar; trays hidden or not rendered |
| Desktop wide | ≥1440px |
| Laptop | ~1280×800 |
| Narrow width | ≤768px — tray scale/overlap |
| Short height | ≤760px — hand deck `flex-basis` compression |
| Long / scrollable hand | Scroll + stacked hand rows |
| Selected / playable underline | `rh-glow-underline`, hand highlight |
| Zoom controls | ± buttons, wheel zoom |
| Utility tray | Mute, fullscreen, leave (+ reactions in MP) |
| Open ends / boneyard meta pills | Values match game state |

---

## H. Canonical structure quick reference

```
client/src/styles/board/
  board-layout.css      ← outer layout (partial)
  board-hud.css         ← HUD structure (partial)
  board-shell.css       ← shell / zone structure
  board-surface.css     ← canvas + board-container stacking
  board-hand-dock.css   ← tray + rh-live-hand-deck shell
  board-meta.css        ← rh-board-meta-bar
  board-controls.css    ← rh-board-toolbar, nbl-board-toolbar
  board-tiles.css       ← (future)
  board-interactions.css← (future)
  skins/racehorse-matte.css ← (future visual pass)
```

**Still bridge / legacy for visuals:** `walnut-live.css`, `match-hud-polish.css`, `match-board-architecture.css` (typography + zoom-in-toolbar reset), `match-standard-live-board.css`, route CSS (`botMatch.css`, `dailyFritzMatchBoard.css`, `noBrainerLab.css`, …).

---

*End of Phase 1 checkpoint — Patch 49.*
