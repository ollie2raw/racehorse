# Neutral Board Surface Bridge Checkpoint

**Status:** Documentation checkpoint (Patch 44)  
**Date:** 2026-05-28  
**Mode:** No-visual-change migration — not redesign  
**Scope:** Patches 19–30 — surface bridge; Patches 32–43 — hand dock (see **`docs/board-hand-dock-ownership-checkpoint.md`**)

**Related plans:** `docs/board-surface-first-ownership-move-plan.md` (Patch 27–28), `docs/board-container-stacking-ownership-plan.md` (Patch 29–30), `docs/board-hand-dock-ownership-checkpoint.md` (Patch 44)

**Phase 1 complete:** See **`docs/board-phase-1-cleanup-checkpoint.md`** (Patch 49) for end-to-end ownership status and next fork (black matte skin planning).

---

## Current checkpoint (Patch 44)

| Layer | State |
|-------|--------|
| **Runtime neutral classes** | `.rh-board-stage`, `.rh-board-frame`, `.rh-board-canvas`, `.rh-board-watermark` exist on live board DOM alongside legacy `nbl-*` classes |
| **Shell structure** | Partially canonical in `client/src/styles/board/board-shell.css` (stage/frame sizing for standard-live + bot-match zones) |
| **Canvas structure + stacking** | **Canonical in `client/src/styles/board/board-surface.css`** (base canvas flex box + three scoped `.board-container` stacking rules) |
| **Hand dock structure** | **Canonical in `client/src/styles/board/board-hand-dock.css`** — inner tray + bot `.rh-live-hand-deck` shell (Patches 33, 39); details in **`docs/board-hand-dock-ownership-checkpoint.md`** |
| **Visual surface skin** | Still **legacy-owned** (frame/canvas backgrounds, pseudo-elements, watermark, route skins, hand dock chrome) |
| **Black matte redesign** | **Not started** — cleanup/ownership/bridge mode only |

---

## `board-surface.css` canonical ownership (Patches 28–30)

**File:** `client/src/styles/board/board-surface.css`  
**Loaded via:** `client/src/main.tsx` → `client/src/styles/board/index.css`

### 1. Base canvas structure

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

**Migrated from:** `client/src/practice/noBrainerLab.css` (Patch 28)

### 2. Board-container stacking inside canvas

```css
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

**Migrated from:** `walnut-live.css`, `match-standard-live-board.css`, `noBrainerLab.css` (Patch 30)

**Nature:** structure/stacking only — engine tile plane above canvas (`z-index: 2`) and watermark (`z-index: 3`).

---

## Legacy files that no longer own safe canvas/stacking rules

These files **previously** held the rules above; ownership moved to `board-surface.css`. They still own visual skins, frame polish, and other concerns listed below.

| File | No longer owns |
|------|----------------|
| `client/src/styles/walnut-live.css` | NBL `.board-container` stacking under `.nbl-board-canvas` / `.rh-board-canvas` |
| `client/src/styles/match-standard-live-board.css` | Standard-live zone `.board-container` stacking |
| `client/src/practice/noBrainerLab.css` | Base canvas structure; practice-scoped `.board-container` stacking |

**Still imported at runtime:** `noBrainerLab.css` remains required via `MatchNblBoardFrame` / `InGameBoardShell` for **frame visuals**, watermark, and toolbar — not for canvas/stacking structure.

---

## Explicitly untouched and legacy-owned

Do **not** assume these are in `board-surface.css` or safe to move without a dedicated high-risk plan:

| Item | Primary legacy owner(s) |
|------|-------------------------|
| `.wl-board-area .board-container` | **`walnut-live.css`** — different DOM path (legacy board-area, not NBL canvas) |
| `.nbl-board-frame` / `.rh-board-frame` visual skin | `noBrainerLab.css`, `match-hud-polish.css`, `walnut-live.css`, `match-standard-live-board.css`, route files |
| `.nbl-board-frame::before` / `::after` | `walnut-live.css`, `learnGuidedMatch.css`, `match-hud-polish.css`, `match-standard-live-board.css`, `dailyFritzMatchBoard.css`, `noBrainerLab.css` |
| `.nbl-board-canvas::before` | `walnut-live.css`, `match-standard-live-board.css`, `learnGuidedMatch.css`, `dailyFritzMatchBoard.css` |
| `.nbl-board-watermark` / `.rh-board-watermark` | `noBrainerLab.css`, `walnut-live.css`, `match-standard-live-board.css`, `learnGuidedMatch.css`, `dailyFritzMatchBoard.css` — **no `.rh-board-watermark` CSS yet** |
| **Daily Fritz** surface skin | `dailyFritzMatchBoard.css` |
| **Learn/Guided** surface skin | `learnGuidedMatch.css` |
| **Practice frame visuals** | `noBrainerLab.css` (`.nbl-board-frame` base grid/matte) |
| Generic frame polish | `match-hud-polish.css` (`.screen.game-screen .nbl-board-frame`) |
| **Tile styling** | `game-interactions.css`, `walnut-live.css`, route hand/tile hooks |
| **Hand dock structure** | **`board-hand-dock.css`** (inner tray + bot deck shell) — see hand dock checkpoint |
| **Hand dock skin / deck child / tiles** | `walnut-live.css`, `learnGuidedMatch.css`, `game-interactions.css`, route files |
| **Meta / controls** | `match-standard-live-board.css`, `noBrainerLab.css`, HUD/control pills |

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
- `InGameBoardFrame` (via `InGameBoardShell`): Daily Puzzle, Daily Puzzle Ladder, No Brainer Lab, and `BotMatchScreen` studio path

`client/src/match/board/InGameBoardFrame.tsx` is a **zone/shell wrapper only**; it does **not** emit `rh-board-*` surface classes.

### CSS recognition today

| Neutral class | Structural CSS | Visual CSS |
|---------------|----------------|------------|
| `.rh-board-stage` | `board-shell.css` (sizing) | Legacy route/shell |
| `.rh-board-frame` | `board-shell.css` (sizing) | Legacy frame skin (see untouched list) |
| `.rh-board-canvas` | **`board-surface.css`** (structure + child stacking scopes) | Legacy route canvas skins (`nbl-board-canvas` selectors) |
| `.rh-board-watermark` | None | Legacy `nbl-board-watermark` only |

### Canonical namespace load order

From `client/src/main.tsx`:

1. Legacy globals (`walnut-live.css`, `match-hud-polish.css`, `match-board-architecture.css`, `match-standard-live-board.css`, …)
2. `client/src/styles/board/index.css` → `board-shell.css` + **`board-surface.css`** (active structure/stacking rules)

Frame emitters still import `noBrainerLab.css` for **frame/watermark/toolbar** visuals on routes using `MatchNblBoardFrame` / `InGameBoardShell`.

---

## B. Completed safe work (aliases + ownership)

### 1. Shell structure (stage + frame sizing) — `board-shell.css`

Neutral aliases for `.rh-board-stage` and `.rh-board-frame` in standard-live and bot-match zones (flex/sizing only).

### 2. Canvas structure + board-container stacking — `board-surface.css`

| Milestone | Patch | What moved |
|-----------|-------|------------|
| Base canvas flex box | 28 | `.nbl-board-canvas, .rh-board-canvas` |
| Container stacking (3 scopes) | 30 | walnut-live, practice-lab, rh-standard-live-board zone |

Low-risk **alias** work on `.rh-board-canvas .board-container` preceded ownership moves (Patches 24–25); rules now live only in `board-surface.css`.

### Not bridged / not canonical yet

- `.rh-board-watermark` — no neutral CSS
- `.rh-board-frame` — visual skin remains `nbl-board-frame`-keyed
- Route **canvas visual** skins — still `nbl-board-canvas` in legacy files
- Frame/canvas pseudo-elements, watermark styling

---

## C. What remains legacy-owned (visual + parallel paths)

All **visual** playfield identity still keys off `nbl-*` and route wrappers. See **Explicitly untouched** table above.

### Quick reference — high-traffic legacy owners

| Concern | Owner files |
|---------|-------------|
| Frame visual skin | `noBrainerLab.css`, `match-hud-polish.css`, `walnut-live.css`, `match-standard-live-board.css`, `dailyFritzMatchBoard.css`, `learnGuidedMatch.css` |
| Canvas visual skin + `::before` | `walnut-live.css`, `match-standard-live-board.css`, `learnGuidedMatch.css`, `dailyFritzMatchBoard.css` |
| Watermark | `noBrainerLab.css`, `walnut-live.css`, `match-standard-live-board.css`, `learnGuidedMatch.css`, `dailyFritzMatchBoard.css` |
| Parallel board-area path | `walnut-live.css` — `.board-area.wl-board-area`, **`.wl-board-area .board-container`** |
| Mobile board fit | `botMatch.css` — `.bot-match-screen .board-container` (sizing/overflow, not NBL stacking) |

---

## D. Risk classification for remaining work

### Low risk

- **Done** for NBL canvas path: structure + `.board-container` stacking under canvas
- Future structural moves in **`board-hand-dock.css`**, **`board-layout.css`**, **`board-hud.css`** (tray/HUD geometry without visual tokens)
- Documentation and ownership audits

### Medium risk

- Watermark position vs opacity split across files
- Route-fit `overflow` / `transform` (`botMatch.css`, guided tile scale)
- Generic frame resets without skin duplication

### High risk

- Frame visual skin, canvas backgrounds/textures, pseudo-elements
- Daily Fritz / Learn/Guided mode skins
- `match-hud-polish.css` global frame polish
- Tile rendering and highlights
- Moving **visual** rules into `board-surface.css` before route matrix sign-off

---

## E. Route matrix

| Route / mode | Frame emitter | Structure/stacking owner | Visual surface owners (unchanged) |
|--------------|---------------|---------------------------|-----------------------------------|
| **Daily Fritz** | `MatchNblBoardFrame` | **`board-surface.css`** | `noBrainerLab.css`, `walnut-live.css`, **`dailyFritzMatchBoard.css`** |
| **Play vs Fritz** | `MatchNblBoardFrame` | **`board-surface.css`** | `noBrainerLab.css`, `walnut-live.css`, `match-hud-polish.css` |
| **Ghost / bot** | `MatchNblBoardFrame` | **`board-surface.css`** | Same as PvF + `botMatch.css` mobile fit |
| **Daily Puzzle** | `InGameBoardFrame` | **`board-surface.css`** (standard-live stacking scope) | `noBrainerLab.css`, **`match-standard-live-board.css`**, `board-shell.css` |
| **Practice / NBL** | `InGameBoardFrame` | **`board-surface.css`** | `noBrainerLab.css` frame skin, `match-standard-live-board.css` zone skin |
| **Learn / Guided** | `MatchNblBoardFrame` in guided zone | **`board-surface.css`** (walnut-live stacking scope) | `noBrainerLab.css`, **`learnGuidedMatch.css`** |

---

## F. Recommended next track (Patch 45+)

Hand dock structure cleanup (**Patches 32–43**) is documented in **`docs/board-hand-dock-ownership-checkpoint.md`**.

### Options

| Option | Focus | Risk | Notes |
|--------|--------|------|-------|
| **A — Remaining deck-scoped hand layout** | `.rh-live-hand-deck .tray-center` / `.hand-container` / scroll / single-row → `board-hand-dock.css` | Low–medium | Left in `walnut-live.css` after Patches 37–39 |
| **B — Board meta / controls audit** | `board-meta.css`, `board-controls.css` — pills, zoom tray, controls tray, meta bars | **Medium** | Likely still scattered; visible on every match |
| **C — Frame visual ownership audit** | `.nbl-board-frame` skin, pseudo-elements, `match-hud-polish.css`, route skins | **High** | Defer until redesign plan |

### Recommendation: **Option B — board meta / controls audit** (Patch 45 planning)

**Reasoning:** Phase 1 structure for surface, shell, and hand dock is largely in `styles/board/`. Meta/controls are the next high-visibility scattered area. Frame visuals (Option C) remain high-risk. Remaining hand overrides (Option A) are lower priority unless a quick win is obvious.

**Defer:** Frame visual migration, black matte redesign, hand dock skin pass.

---

## Patch history (surface bridge)

| Patch | Deliverable |
|-------|-------------|
| 24–25 | Low-risk `.rh-board-canvas .board-container` aliases in legacy files |
| 26 | This checkpoint (initial) |
| 27 | `docs/board-surface-first-ownership-move-plan.md` |
| 28 | Canvas structure → `board-surface.css` |
| 29 | `docs/board-container-stacking-ownership-plan.md` |
| 30 | Container stacking → `board-surface.css` |
| **31** | Surface checkpoint update |
| 32–43 | Hand dock structure + dead-rule cleanup — see **`docs/board-hand-dock-ownership-checkpoint.md`** |
| **44** | Surface checkpoint cross-reference + hand dock pointer |

---

## References

- `docs/board-hand-dock-ownership-checkpoint.md` — hand dock canonical ownership (Patches 32–43)
- `docs/board-canvas-fit-alias-plan.md`
- `docs/board-surface-first-ownership-move-plan.md`
- `docs/board-container-stacking-ownership-plan.md`
- `docs/board-css-ownership-audit.md`
- `client/src/styles/board/README.md`
- `client/src/styles/board/board-surface.css` — live canonical structure/stacking rules
