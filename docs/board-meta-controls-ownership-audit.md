# Board Meta & Controls Ownership Audit

**Patch:** 45 (planning / audit only — no implementation)  
**Date:** 2026-05-28  
**Goal:** Map board metadata pills, zoom trays, utility controls, and related chrome before structure migration into `board-meta.css` and `board-controls.css`  
**Mode:** Planning only — do not edit CSS, move selectors, or delete rules yet  

**Related:** `docs/board-hand-dock-ownership-checkpoint.md` (Patches 32–44), `client/src/styles/board/board-meta.css`, `client/src/styles/board/board-controls.css`

**Implemented after this audit:** Patch 46 (meta bar → `board-meta.css`), Patch 48 (toolbar wrappers → `board-controls.css`). **Phase 1 summary:** `docs/board-phase-1-cleanup-checkpoint.md` (Patch 49).

---

## Executive summary

| Finding | Detail |
|---------|--------|
| **Meta bar DOM** | Shared `.rh-board-meta-bar` with `BoardOpenEndsPill` + `BoneyardCountPill` inside `nbl-board-canvas` / `boardStageInner` |
| **Zoom** | `.board-zoom-tray.control-pill` rendered by `Board.tsx` (bottom-left of canvas) |
| **Utility tray** | `.wl-controls-tray.control-pill` in bot match + multiplayer — often **inline `position: absolute`** in TSX plus CSS offsets |
| **Best structure batch** | `match-board-architecture.css` **`.rh-board-meta-bar` layout block** (~162–194) → `board-meta.css` |
| **Controls structure** | `match-board-architecture.css` **`.rh-board-toolbar` / `.nbl-board-toolbar`** (~219–253) → `board-controls.css` (Patch 46b or combined) |
| **Heavy duplication** | Bot-match pill skin split across `walnut-live.css` (×2 sections), `botMatch.css`, `dailyFritzMatchBoard.css`, `match-hud-polish.css`, `App.css` |
| **Recommended Patch 46** | Migrate **meta bar structure only** from `match-board-architecture.css`; defer pill skin, DF accents, hover states |

---

## A. Active meta / control DOM paths

### A1. Daily Fritz / Play vs Fritz / ghost — active studio match

**Screen root:** `.screen.game-screen.walnut-live.bot-match-screen.bot-match-mode-{bot|ghost|daily-fritz}`

**Board stack:**

```
MatchNblBoardFrame (nbl-board-canvas)
  └── boardStageInner (BotMatchScreen)
        ├── .rh-board-meta-bar [data-ui=board-meta]     ← when !gameOver && !lesson
        │     ├── BoardOpenEndsPill → .open-ends-pill.board-corner-pill.board-corner-pill--tl
        │     └── BoneyardCountPill   → .boneyard-pill.board-corner-pill.board-corner-pill--tr
        ├── Board (tiles, placement)
        │     └── .board-zoom-tray.control-pill         ← if showZoomTray
        │           └── .board-zoom-btn ×2
        └── .wl-controls-tray.control-pill              ← inline style: bottom/right/zIndex
              ├── volume-btn, fullscreen-btn, leave (home) svg
              └── (optional dev/capture overlays elsewhere)
```

| Piece | File | Classes / handlers (read-only) |
|-------|------|--------------------------------|
| Meta bar | `BotMatchScreen.tsx` ~6792–6799 | `openEndsSum`, `match.board`, `match.boneyard.length`, `boneyardRef` |
| Open ends pill | `BoardOpenEndsPill.tsx` | `computeOpenEndsSum(board)` display |
| Boneyard pill | `BoneyardCountPill.tsx` | `count`, `lockedThreshold`, ref for draw animations |
| Board + zoom | `Board.tsx` ~1165+ | `applyZoomStep`, `resolvedShowZoomTray`, camera scale |
| Controls tray | `BotMatchScreen.tsx` ~6975+ | `setIsMuted`, `toggleFullscreen`, `setShowLeaveConfirm` |

**Wrapper:** `boardStage` → `wl-stage-shell` → `MatchNblBoardFrame` → `InGameBoardFrame` hand dock separate.

### A2. Daily Puzzle

**Screen:** `.daily-puzzle-screen.rh-standard-live-board`

**Meta:** `InGameBoardShell` passes `boardMeta={<BoneyardCountPill />}` into `rh-board-meta-bar` via `InGameBoardFrameContent` (`match/InGameBoardShell.tsx` ~73–79). **Open ends pill omitted** — `boardMetaBarClassName="rh-board-meta-bar--count-only"` (boneyard only, right-aligned).

**Board:** `Board` inside `board` prop — includes zoom tray when enabled.

**Controls:** Typically via shell/toolbar patterns in puzzle screen (grep: less prominent than bot; puzzle uses standard-live offsets in `match-standard-live-board.css` for `.wl-controls-tray`).

### A3. Practice / No Brainer Lab

**Screen:** `.practice-lab-screen` (not bot-match)

**Meta:** No `rh-board-meta-bar` on practice main path (board column only).

**Controls:** `nbl-board-controls-pill.control-pill` in `nbl-board-toolbar` slot (`NoBrainerLabScreen.tsx` ~328–352) — **zoom only**, practice-specific class name.

### A4. Learn / Guided

**Lesson layout:** Board in `.learn-guided-live-board-zone`; **no** `rh-board-meta-bar` on canvas.

**Boneyard / open ends:** HUD summary strip (`.learn-guided-summary-item`, `guided-boneyard-draw-anchor`) — `learnGuidedMatch.css`, not board-meta selectors.

### A5. Multiplayer (`App.tsx`)

Same pattern as bot: `rh-board-meta-bar` + both pills inside canvas; `.wl-controls-tray` with inline absolute positioning (~5544–5551); no `Board` zoom dependency varies by setup.

---

## B. CSS ownership map (by file)

### B1. `board-meta.css` / `board-controls.css`

**Status:** Header comments only — **no runtime rules yet**.

### B2. `match-board-architecture.css` — **primary structure candidate**

| Lines | Selector | Kind | Routes |
|-------|----------|------|--------|
| 162–174 | `.screen.game-screen.walnut-live .rh-board-meta-bar` | **Structure** — absolute flex bar, padding, z-index | All walnut live with meta bar |
| 176–178 | `.rh-board-meta-bar > *` | **Structure** — pointer-events | Same |
| 180–185 | `.rh-board-meta-bar .board-corner-pill` | **Structure** — reset absolute corners to static | Meta bar layout mode |
| 187–190 | `.rh-board-meta-bar .open-ends-count`, `.boneyard-count` | **Typography sizing** (token) | Same |
| 192–194 | `.rh-board-meta-bar--count-only` | **Structure** — flex justify end | Daily Puzzle |
| 219–253 | `.rh-board-toolbar`, `.nbl-board-toolbar` | **Structure** — bottom-right flex cluster | Puzzle shell / NBL toolbar |
| 235–239 | `.rh-board-toolbar .board-zoom-tray` | **Structure** — static position in toolbar | When toolbar used |

### B3. `App.css` — global primitives

| Selector | Kind | Notes |
|----------|------|--------|
| `.board-corner-pill` | **Mixed** — absolute `top/left/right`, glass skin | Fallback when **not** in meta bar |
| `.board-corner-pill--tl/tr` | **Structure** — corner offsets | Overridden by meta bar `position: static` |
| `.open-ends-pill__label`, `.open-ends-count` | **Typography** | Base label/count |
| `.boneyard-pill`, `.board-zoom-tray`, `.wl-controls-tray` | **Structure** — `display: inline-flex; gap` | Shared flex row |
| `.boneyard-icon`, `.boneyard-count`, `.boneyard-meta` | **Mixed** | Icon sizing + count |
| `.large-mode` variants | **Responsive / a11y** | Live-match opt-out in walnut-live |

**Load order:** `App.css` early — walnut-live and architecture override for match screens.

### B4. `walnut-live.css` — largest live-match skin layer

| Section (approx) | Selectors | Kind |
|------------------|-----------|------|
| 1388–1397 | `.board-corner-pill`, `.boneyard-pill`, `.board-zoom-tray`, `.wl-controls-tray` | **Visual skin** — border, background, blur |
| 1458–1509 | `.app.large-mode` variants | **Responsive skin** |
| 1511–1569 | Corner pills, labels, counts | **Visual skin** + absolute fallback positions |
| 1893–1938 | Bot-match `:not(.learn-lesson-screen)` meta offsets + pill skin | **Mixed** — layout offsets + skin |
| 1940–1948 | `.wl-controls-tray` position + button color | **Mixed** — placement + skin |
| 2188–2214 | **Duplicate** bot-match v3 meta/control placement + pill skin | **Later wins** over ~1893 for overlapping props |
| 2418+ | `.rh-board-meta-bar` (lesson/bot scoped) | Check if active |

**Stale signal:** Bot-match pill rules at **~1900 and ~2194** — same selectors; **v3 block (~2188+) wins** for `min-height`, `padding`, `border-radius`, `background`, `box-shadow`.

### B5. `botMatch.css` — bot meta pill sizing

| Lines | Selector | Kind |
|-------|----------|------|
| 1062–1124 | `.rh-board-meta-bar .board-corner-pill`, labels, counts, icon | **Mixed** — flex layout + **visual skin** + typography |

Applies to **all** `.bot-match-screen` including Learn lesson screen if meta bar present — but lesson layout **omits** meta bar in DOM.

### B6. `dailyFritzMatchBoard.css` — mode skin (hand rule deleted Patch 43)

| Lines | Targets | Kind |
|-------|---------|------|
| 51–66 | Pills + trays frosted glass | **Visual skin** (DF) |
| 68–88 | Meta label/count colors | **Visual skin** |
| 91–103 | Control/zoom button colors + hover | **Interaction + skin** |

### B7. `match-standard-live-board.css`

| Lines | Selector | Kind |
|-------|----------|------|
| 80–84 | `.rh-standard-live-board .rh-board-meta-bar` | **Structure** — top/left/right offsets |
| 86–95 | `.wl-controls-tray.control-pill` | **Visual skin** (puzzle-aligned with bot v3) |

### B8. `match-hud-polish.css` — control tray chrome

| Lines | Selector | Kind |
|-------|----------|------|
| 131–142 | `.board-zoom-tray`, `.wl-controls-tray.control-pill` | **Visual skin** |
| 144–151 | `.board-zoom-tray` position bottom-left | **Structure** |
| 153–214 | `.board-zoom-btn`, hover/active, `.wl-controls-tray` buttons | **Interaction + layout** |

**Conflict:** Bot-match `walnut-live` sets `.wl-controls-tray { right/bottom !important }` — **wins** over polish left placement for controls (controls on **right**). Zoom tray uses polish **left** bottom unless overridden.

### B9. `noBrainerLab.css` — practice only

| Selector | Kind |
|----------|------|
| `.nbl-board-controls-pill.control-pill` | **Practice-specific** zoom pill skin + btn hover |

### B10. `learnGuidedMatch.css`

**No** `rh-board-meta-bar`, `board-zoom-tray`, or `wl-controls-tray` selectors.

---

## C. Cascade / conflict analysis (bot studio path)

### Meta bar final look (Daily Fritz / PvF / ghost)

1. **`match-board-architecture.css`** — positions meta bar across top of canvas; flex row; children `pointer-events: auto`; pills `position: static`.
2. **`walnut-live.css`** — bot-match offsets (`top/left/right` ~2188); pill glass skin (~2194+); open-ends **brass** border on `:first-child` (~2207).
3. **`botMatch.css`** — meta-bar-scoped pill **min-width**, flex, typography (~1062+) — often **wins** on font-size/count due to specificity + `!important`.
4. **`dailyFritzMatchBoard.css`** (DF only) — frosted glass overrides on pills/trays (~51–66).

**Open ends / boneyard accuracy:** Driven by React (`BoardOpenEndsPill`, `BoneyardCountPill`) — CSS does not affect counts.

### Zoom tray

1. **`match-hud-polish.css`** — `position: absolute; bottom: 14px; left: 14px` on `.board-zoom-tray`.
2. **`Board.tsx`** renders inside canvas — no meta bar conflict.
3. DF adds frosted styling when `bot-match-mode-daily-fritz`.

### Controls tray (bot)

1. **TSX inline** — `bottom: 12; right: 12; zIndex: 20` (`BotMatchScreen.tsx` ~6978).
2. **`walnut-live.css`** — `right: 32px !important; bottom: 30px !important` (v3 ~2211) — **wins** over inline and polish.
3. **`match-hud-polish.css`** — gap, padding, button reset, hover/active.

### Stale / duplicate candidates

| Item | Assessment |
|------|------------|
| Walnut bot-match meta/pill block ~1893 vs ~2188 | **Duplicate era** — v3 later wins |
| `App.css` absolute `.board-corner-pill` when inside meta bar | **Overridden** by architecture `position: static` — not stale, fallback for non-meta paths |
| Global bot `.wl-hand-area` block | **Deleted** Patch 41 |

---

## D. Structure vs skin split (future ownership)

### → `board-meta.css` (structure later)

- `.rh-board-meta-bar` flex/absolute layout, padding, z-index, pointer-events
- `.rh-board-meta-bar--count-only` alignment
- `.rh-board-meta-bar .board-corner-pill` position reset (static in bar)
- Route-specific **structural** offsets if shared (optional; may stay scoped per route file initially)

### → `board-controls.css` (structure later)

- `.rh-board-toolbar` / `.nbl-board-toolbar` flex clusters
- `.board-zoom-tray` / `.wl-controls-tray` **layout-only**: `display`, `gap`, `position`, `z-index` (where not inline in TSX)
- Button group **spacing** / min sizes without colors

### → Legacy / skin (stay for now)

- Pill backgrounds, borders, blur, shadows (`walnut-live`, `match-hud-polish`, DF)
- Brass open-ends accent (`:first-child` border-color)
- Typography fonts/colors on labels/counts (`botMatch.css`, walnut-live)
- `dailyFritzMatchBoard.css` frosted HUD pills

### → `board-interactions.css` (later)

- `:hover`, `:active`, `:focus` on `.board-zoom-btn`, tray buttons
- Currently in `match-hud-polish.css`

### → Leave legacy / route-specific

- Learn/Guided HUD boneyard (not board-meta)
- Practice `nbl-board-controls-pill`
- Daily Fritz mode accents until skin pass
- `App.css` large-mode accessibility overrides

---

## E. Risk assessment

| Route | Meta migration risk | Controls migration risk |
|-------|---------------------|-------------------------|
| **Daily Fritz** | Low for structure-only meta bar move | Medium — DF + walnut placement stacks |
| **Play vs Fritz / ghost** | Low | Medium — inline + `!important` offsets |
| **Daily Puzzle** | Low — uses same meta bar structure + `--count-only` | Medium |
| **Practice** | None (no meta bar) | High — separate `nbl-board-controls-pill` |
| **Learn** | None on canvas | None |
| **Multiplayer** | Low | Medium — same as bot |
| **Mobile / narrow / short** | Low if tokens unchanged | Medium — test tray overlap with zoom |
| **Open ends / boneyard accuracy** | **No CSS risk** — React-driven | — |
| **Disabled/active buttons** | N/A | **Do not move** in Patch 46 |

---

## F. Recommended first migration batch (Patch 46)

### Safest batch: **meta bar structure from `match-board-architecture.css`**

**Move to `board-meta.css` (exact copy, move-as-is):**

```css
/* From match-board-architecture.css ~162-194 */
.screen.game-screen.walnut-live .rh-board-meta-bar { ... }
.screen.game-screen.walnut-live .rh-board-meta-bar > * { ... }
.screen.game-screen.walnut-live .rh-board-meta-bar .board-corner-pill { ... }
.screen.game-screen.walnut-live .rh-board-meta-bar--count-only { ... }
```

**Optional in same patch or Patch 46b:** Move **typography token** rules for counts (~187–190) — low risk but borderline structure vs skin; **defer** if conservative.

**Do NOT move in Patch 46:**

- Any `border`, `background`, `box-shadow`, `backdrop-filter`
- `botMatch.css` / `walnut-live` / `dailyFritzMatchBoard.css` pill skin
- `match-hud-polish.css` zoom/control skin and `:hover`
- Bot-match-only offset duplicates in `walnut-live` (~2188–2192) — separate dedup patch later

### Second batch (Patch 47): **toolbar structure → `board-controls.css`**

Move from `match-board-architecture.css` ~219–253:

- `.rh-board-toolbar`
- `.nbl-board-toolbar`
- `.rh-board-toolbar .board-zoom-tray.control-pill`

Defer `match-hud-polish.css` zoom position until tray ownership is unified (mixed skin + interaction).

---

## G. Rules not to move yet

- All pill **visual** styling in `walnut-live.css`, `botMatch.css`, `dailyFritzMatchBoard.css`, `match-hud-polish.css`
- `botMatch.css` `.rh-board-meta-bar` flex/sizing (overlaps skin) — dedupe plan first
- Duplicate walnut bot-match blocks ~1893 vs ~2188 — audit/dedupe before move
- TSX **inline** `style={{ position: 'absolute', bottom, right }}` on `.wl-controls-tray` — requires component change to remove
- `App.css` global `.board-corner-pill` glass fallback — used outside meta bar contexts
- Practice `nbl-board-controls-pill`
- Learn/Guided summary HUD
- Hand dock (`board-hand-dock.css`, `walnut-live` deck rules)
- Tile / `game-interactions.css` / `rh-glow-underline.css`

---

## H. Recommended Patch 46

**Migrate meta bar structure only** from `match-board-architecture.css` → `board-meta.css`; delete moved lines from architecture file.

**Do not** migrate controls yet (Option: Patch 47) unless combining — controls have more placement conflicts (`!important`, inline styles, polish).

**Alternative:** Comment-only checkpoint in `board-meta.css` — **not recommended**; structure block is isolated and low-risk.

---

## I. Exact proposed Patch 46 (if approved)

### Files to edit

1. `client/src/styles/board/board-meta.css` — **add** rules below  
2. `client/src/styles/match-board-architecture.css` — **remove** same rules (~162–194)

### Declarations to move (structure only)

```css
.screen.game-screen.walnut-live .rh-board-meta-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  pointer-events: none;
}

.screen.game-screen.walnut-live .rh-board-meta-bar > * {
  pointer-events: auto;
}

.screen.game-screen.walnut-live .rh-board-meta-bar .board-corner-pill {
  position: static !important;
  top: auto !important;
  left: auto !important;
  right: auto !important;
}

.screen.game-screen.walnut-live .rh-board-meta-bar--count-only {
  justify-content: flex-end;
}
```

**Leave in `match-board-architecture.css` (defer to later patch):**

```css
.screen.game-screen.walnut-live .rh-board-meta-bar .open-ends-count,
.screen.game-screen.walnut-live .rh-board-meta-bar .boneyard-count {
  font-size: var(--match-counter-value-size, ...);
}
```

### Leave untouched

- All `walnut-live.css`, `botMatch.css`, `dailyFritzMatchBoard.css`, `match-hud-polish.css`, `App.css` rules  
- `match-board-architecture.css` toolbar section (~219+) until Patch 47  

### Verification

```bash
rg 'rh-board-meta-bar' client/src/styles/board/board-meta.css
rg 'rh-board-meta-bar' client/src/styles/match-board-architecture.css
# architecture: should only show count font-size + unrelated rules, not flex layout block

npm run build --prefix client
```

### Browser checks required after Patch 46

See section J.

---

## J. Browser verification checklist

- [ ] **Daily Fritz** — open ends + boneyard pills in top bar; brass border on open ends; no overlap with board
- [ ] **Play vs Fritz / ghost** — same meta bar layout
- [ ] **Daily Puzzle** — boneyard-only bar right-aligned (`--count-only`)
- [ ] **Practice** — no regression (no meta bar)
- [ ] **Learn / Guided** — unchanged
- [ ] **Multiplayer** — both pills + controls/zoom unchanged
- [ ] **Desktop / narrow / short-height** — pills not clipped; trays still reachable
- [ ] **Zoom tray** — still bottom-left inside board
- [ ] **Controls tray** — still bottom-right (mute/fullscreen/leave)
- [ ] **Open ends / boneyard counts** — still accurate during play

---

## References

- `client/src/components/BoardOpenEndsPill.tsx`
- `client/src/components/BoneyardCountPill.tsx`
- `client/src/components/Board.tsx`
- `client/src/bot/BotMatchScreen.tsx`
- `docs/board-hand-dock-ownership-checkpoint.md`
