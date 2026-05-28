# Board Hand Dock Ownership Checkpoint

**Status:** Documentation checkpoint (Patch 44)  
**Date:** 2026-05-28  
**Mode:** No-visual-change cleanup — not redesign  
**Scope:** Patches 32–43 — hand dock structure ownership and dead-rule removal

**Related:** `docs/board-hand-dock-ownership-audit.md` (Patch 32), `docs/neutral-board-surface-bridge-checkpoint.md` (surface bridge), `client/src/styles/board/board-hand-dock.css`

---

## Current phase status

| Phase | State |
|-------|--------|
| **Phase 1 structural cleanup** | **Complete** for scoped structure — see **`docs/board-phase-1-cleanup-checkpoint.md`** (Patch 49) |
| **Layout / HUD / shell / surface structure** | Canonical homes in `client/src/styles/board/` (`board-layout.css`, `board-hud.css`, `board-shell.css`, `board-surface.css`) |
| **Hand dock structure** | **Canonical in `board-hand-dock.css`** (inner tray + bot studio deck shell) |
| **Visual skins** | **Intentionally legacy-owned** (`walnut-live.css`, route files, `match-hud-polish.css`, etc.) |
| **Black matte / gold redesign** | **Not started** |

---

## `board-hand-dock.css` — canonical structure

**File:** `client/src/styles/board/board-hand-dock.css`  
**Loaded via:** `client/src/main.tsx` → `client/src/styles/board/index.css` (after legacy globals)

### Shared inner tray layout (Patch 33)

Neutral `.wl-hand-area` descendants — all routes that use the walnut hand tray DOM:

- `.wl-hand-area .tray-rail`
- `.wl-hand-area .tray-center`
- `.wl-hand-area .hand-container`
- `.wl-hand-area .hand-container.is-stacked`
- `.wl-hand-area .hand-row`
- `.wl-hand-area .hand-container.is-scrollable`
- `.wl-hand-area .hand-container:not(.is-scrollable)`

### Bot-route live deck shell structure (Patch 39)

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck {
  /* position, flex: 0 0 142px, min-height, display, overflow */
}

@media (max-height: 760px) {
  /* flex-basis: 116px on .rh-live-hand-deck */
}
```

**Applies to:** Daily Fritz, Play vs Fritz, ghost/bot — studio path via `InGameBoardFrame` + `handTray` inside `.rh-live-hand-deck`.

**Does not apply to:** Learn (`learn-lesson-screen`), Daily Puzzle (no deck), Practice (`nbl-tray`).

---

## `walnut-live.css` — legacy hand dock ownership

Still owns (do not assume moved to `board-hand-dock.css`):

| Concern | Notes |
|---------|--------|
| `.rh-live-hand-deck` **visual skin** | padding, radius, background, box-shadow (~2431+) |
| `.rh-live-hand-deck .wl-hand-area` **child reset** | transparent inner wrapper; flex center (Patch 37 merge) |
| `.rh-live-hand-deck .wl-hand-area::before` | `content: none` — suppresses bot hairline inside deck |
| **v3 deck-scoped layout** | `.rh-live-hand-deck .tray-center`, `.hand-container`, scroll / `has-single-row` / `guided-tile-wrap` geometry |
| **Bot v3 tray strip** | `.wl-hand-area .tray-rail` / `.hand-row` under bot-match scope (not deck-prefixed) |
| **Base / global `.wl-hand-area`** | `.walnut-live .wl-hand-area`, `.screen.game-screen.walnut-live .wl-hand-area` — other modes |
| **Tile / interaction-adjacent** | Hand tile hooks in `walnut-live.css`; states in `game-interactions.css`, `rh-glow-underline.css` |

---

## Confirmed removed / dead (Patches 35, 41, 43)

| Removed | Patch | Notes |
|---------|-------|--------|
| Stale v2 `.rh-live-hand-deck` grid shell | 35 | `display: grid`, duplicate flex/height |
| Stale `.rh-live-hand-deck__header` (+ span/strong) | 35 | CSS-only; no DOM |
| Global bot-match `.wl-hand-area` + `::before` + `.tray-rail` + `.hand-row` (~1950–1990) | 41 | Dead inside deck; child + v3 rules win |
| Daily Fritz `.hand-area` / `.wl-hand-area` `border-top-color` | 43 | Dead vs `border: 0 !important` on deck child |

**Planning docs (audit only):** Patches 34–36, 38, 40, 42 — see `docs/rh-live-hand-deck-*.md`, `docs/global-wl-hand-area-audit.md`, `docs/daily-fritz-hand-accent-audit.md`.

---

## Explicitly untouched

- **Learn / Guided** hand dock — `learnGuidedMatch.css` (`.learn-guided-live-hand-deck`)
- **Practice / NBL** — `nbl-tray` / `nbl-hand-row` in `noBrainerLab.css`
- **Daily Puzzle** — `.wl-hand-area` without `.rh-live-hand-deck`; `match-standard-live-board.css` / puzzle CSS
- **Tile visuals**, selected/playable/hover/disabled — `game-interactions.css`, `rh-glow-underline.css`
- **Components**, gameplay logic
- **Black matte redesign** / `skins/racehorse-matte.css`

---

## Studio hand DOM (reference)

```
.rh-live-hand-deck
  └── .hand-area.wl-hand-area
        └── .tray-rail → .tray-center → .hand-container → .hand-row
```

Emitters: `BotMatchScreen.tsx` `handTray`, `match/board/InGameBoardFrame.tsx`.

---

## Recommended next tracks (Patch 45+)

| Option | Focus | Risk | Notes |
|--------|--------|------|-------|
| **A — Remaining deck-scoped hand layout** | Migrate `.rh-live-hand-deck .tray-center` / `.hand-container` / scroll / single-row from `walnut-live.css` → `board-hand-dock.css` | Low–medium | Visible but structural; duplicate with inner tray in places |
| **B — Board meta / controls audit** | `board-meta.css`, `board-controls.css` — corner pills, open ends, boneyard, zoom tray, controls tray | Medium | Likely scattered; high user visibility |
| **C — Frame visual ownership audit** | `.nbl-board-frame` / `.rh-board-frame`, pseudo-elements, `match-hud-polish.css`, route skins | **High** | Wait for redesign plan |

### Recommendation: **Option B — board meta / controls audit**

Hand dock **structure** for the active bot studio path is in good shape. Remaining deck-scoped overrides (Option A) are feasible but smaller payoff than meta/controls, which are still spread across `match-standard-live-board.css`, `walnut-live.css`, `noBrainerLab.css`, and route files.

Frame visual work (Option C) should stay **plan-only** until black matte / gold skin pass is scoped.

**Suggested Patch 45:** Planning doc only — meta/controls ownership audit (`docs/board-meta-controls-ownership-audit.md` or similar). **No CSS edits** until approved.

---

## Patch history (hand dock)

| Patch | Deliverable |
|-------|-------------|
| 32 | `docs/board-hand-dock-ownership-audit.md` |
| 33 | Inner tray structure → `board-hand-dock.css` |
| 34–36 | `rh-live-hand-deck` shell/child reconciliation plans |
| 35 | Delete stale v2 deck grid + `__header` |
| 37 | Merge `.rh-live-hand-deck .wl-hand-area` child + `::before` |
| 38–39 | Deck shell structure → `board-hand-dock.css` |
| 40–41 | Delete dead global bot `.wl-hand-area` block |
| 42–43 | Delete dead Daily Fritz hand `border-top-color` |
| **44** | **This checkpoint** |

---

## References

- `client/src/styles/board/board-hand-dock.css`
- `client/src/styles/board/README.md`
- `docs/neutral-board-surface-bridge-checkpoint.md`
