# Board Controls & Toolbar Ownership Audit

**Patch:** 47 (planning / audit only — no implementation)  
**Date:** 2026-05-28  
**Goal:** Map board toolbar, zoom controls, utility trays, and control-pill styling before structure migration into `board-controls.css`  
**Mode:** Planning only — do not edit CSS, move selectors, delete rules, or change components  

**Related:** `docs/board-meta-controls-ownership-audit.md` (Patch 45), `docs/board-hand-dock-ownership-checkpoint.md`, Patch 46 (`board-meta.css` owns meta bar structure)

**Implemented after this audit:** Patch 48 (toolbar wrappers → `board-controls.css`). **Phase 1 summary:** `docs/board-phase-1-cleanup-checkpoint.md` (Patch 49).

---

## Executive summary

| Finding | Detail |
|---------|--------|
| **Active studio controls (DF / PvF / ghost / multiplayer)** | Zoom: `Board.tsx` → `.board-zoom-tray.control-pill` inside `.board-container`. Utility: `.wl-controls-tray.control-pill` as **canvas sibling** of `Board` (not inside toolbar wrapper). |
| **Toolbar wrapper in DOM** | `.nbl-board-toolbar` only when `InGameBoardFrame` / `InGameBoardShell` receives `boardToolbar` — **Practice only** today. Bot studio uses `MatchNblBoardFrame` **without** `toolbar` prop. |
| **`.rh-board-toolbar`** | Defined in `match-board-architecture.css` only — **no TSX usage** (stale / future hook). |
| **Placement conflict** | `wl-controls-tray`: TSX inline `bottom/right` + `walnut-live` bot-match `!important` offsets — **CSS wins over inline**. Zoom: `match-hud-polish` `bottom/left` (no `!important` on position). |
| **Safest Patch 48 batch** | Move **`.nbl-board-toolbar` structure** from `match-board-architecture.css` → `board-controls.css`. Defer `rh-board-toolbar` (dead), zoom tray position (mixed in `match-hud-polish`), and all `wl-controls-tray` rules. |
| **Daily Puzzle** | Board zoom tray only (default `showZoomTray`); **no** canvas `wl-controls-tray`. Meta + HUD chrome elsewhere. |
| **Learn** | Bot path guards tray with `!isLessonLayoutMode`; `shared-ui.css` forces `display: none` on trays in lesson screen. |

---

## A. Active board controls DOM paths

### A1. Daily Fritz / Play vs Fritz / ghost — bot studio match

**Screen root:** `.screen.game-screen.walnut-live.bot-match-screen.bot-match-mode-{daily-fritz|bot|ghost}` (Learn adds `.learn-lesson-screen` on a separate branch).

**Board stack:**

```
wl-stage-shell
  └── MatchNblBoardFrame (nbl-board-canvas rh-board-canvas)   ← no toolbar prop
        ├── .rh-board-meta-bar [data-ui=board-meta]           ← Patch 46 structure
        │     ├── BoardOpenEndsPill → .open-ends-pill.board-corner-pill.board-corner-pill--tl
        │     └── BoneyardCountPill → .boneyard-pill.board-corner-pill.board-corner-pill--tr
        ├── (overlays: score toast, ghost, coach, debug — inline styles)
        ├── Board
        │     └── .board-container
        │           ├── .board-canvas (camera transform inline)
        │           └── .board-zoom-tray.control-pill          ← if showZoomTray (default true)
        │                 └── .board-zoom-btn ×2 (− / +)
        └── .wl-controls-tray.control-pill                    ← if !isLessonLayoutMode
              ├── .btn.icon-btn.volume-btn
              ├── .btn.icon-btn.fullscreen-btn
              └── leave button (home svg)
```

| Piece | File | Classes / state (read-only) |
|-------|------|-----------------------------|
| Frame | `MatchNblBoardFrame.tsx` | `nbl-board-canvas`, children only — **no** `toolbar` |
| Meta bar | `BotMatchScreen.tsx` ~6792–6799 | `openEndsSum`, `match.board`, `match.boneyard.length` |
| Board + zoom | `Board.tsx` ~1004–1223 | `showZoomTray` (default `true`), `applyZoomStep`, camera `scale/x/y` inline on `.board-canvas` |
| Controls tray | `BotMatchScreen.tsx` ~6975–7017 | **Inline:** `position: 'absolute'`, `bottom: 12`, `right: 12`, `zIndex: 20`. Handlers: `setIsMuted`, `toggleFullscreen`, `setShowLeaveConfirm` |
| Shell (PVF integrated) | `match/InGameBoardShell.tsx` | `layout="walnut-wrap"`, `integratedPvfPanel` — board zone + hand; controls stay inside `boardStageInner` |

**`InGameBoardFrame` (`match/InGameBoardShell.tsx`):** Renders `nbl-board-toolbar` only when `toolbar` prop set — **not used** on bot `MatchNblBoardFrame` path.

**`InGameBoardShell` (`match/board/InGameBoardShell.tsx`):** Thin wrapper — HUD slot + children only; **no** controls.

### A2. Multiplayer (live match in `App.tsx`)

Same canvas pattern as bot studio:

```
MatchNblBoardFrame
  ├── rh-board-meta-bar (open ends + boneyard)
  ├── wl-controls-tray.control-pill (+ RoomReactions)
  │     inline: position absolute, bottom 12, right 12, zIndex 20
  └── Board (+ internal board-zoom-tray)
```

| Piece | File | Notes |
|-------|------|--------|
| Controls | `App.tsx` ~5544–5587 | Same classes/handlers as bot; extra `RoomReactions` child |
| Board | `App.tsx` ~5588–5596 | `showOpenEndGlow` prop; default zoom tray |

### A3. Daily Puzzle

**Screen:** `.daily-puzzle-screen` + `.rh-standard-live-board` + `.walnut-live`

**Path:** `DailyPuzzleScreen.tsx` → `InGameBoardShell` → `InGameBoardFrameContent` → meta bar + `Board` only.

```
InGameBoardFrame / nbl-board-canvas
  ├── .rh-board-meta-bar.rh-board-meta-bar--count-only
  │     └── BoneyardCountPill only
  └── Board (zoom tray on by default)
```

- **No** `wl-controls-tray` on canvas.
- **No** `boardToolbar` / `nbl-board-toolbar`.
- Leave / Play Again in puzzle HUD (`dailyPuzzle.css` `.rh-btn-leave`), not board control pills.

### A4. Practice / No Brainer Lab

**Screen:** `.practice-lab-screen.screen.game-screen.walnut-live.rh-standard-live-board`

```
InGameBoardShell (boardColumnOnly)
  └── InGameBoardFrame toolbar={boardToolbar}
        └── .nbl-board-toolbar
              └── .nbl-board-controls-pill.control-pill
                    ├── .board-zoom-btn ×2 (imperative zoom via boardRef)
                    ├── .nbl-board-controls-divider
                    ├── .nbl-board-control-btn (fullscreen)
                    └── .nbl-board-control-btn (home/back)
        └── Board showZoomTray={false}
```

| Piece | File | Notes |
|-------|------|--------|
| Toolbar slot | `NoBrainerLabScreen.tsx` ~328–383 | `boardToolbar` → `nbl-board-toolbar` |
| Zoom | Practice pill + `Board` ref | **Not** `.board-zoom-tray` on canvas |

### A5. Learn / Guided

| Path | Controls on canvas |
|------|-------------------|
| Bot lesson layout (`isLessonLayoutMode`) | `wl-controls-tray` **not rendered** (`!isLessonLayoutMode` guard) |
| `learn-lesson-screen` | `shared-ui.css` hides `.board-zoom-tray`, `.wl-controls-tray` (`display: none !important`) |
| Learn player embed | `learnPlayer.css` hides `.board-zoom-tray` in `.learn-player-board-wrap` |
| Academy doubles stage | `learnAcademy.css` hides `.board-zoom-tray` |
| Guided lesson board | `coach.css` `.learn-lesson-board-area .wl-controls-tray { opacity: 0.76 }` if present |
| `learnGuidedMatch.css` | **No** control-pill / tray selectors |

Boneyard/open ends: HUD summary strip, not board meta bar (Patch 45).

### A6. Selectors not found in codebase

These names from the migration brief **do not appear** as classes in TS/CSS today:

- `.wl-control-pill`
- `.board-controls`
- `.board-actions`
- `.mute-button` / `.fullscreen-button` / `.home-button` / `.utility-button` / `.zoom-button`

Actual button classes: `.board-zoom-btn`, `.volume-btn`, `.fullscreen-btn`, `.icon-btn`, `.nbl-board-control-btn`.

---

## B. CSS ownership map

### B1. `board-controls.css`

**Status:** Header comment only — **no runtime rules**.

### B2. `match-board-architecture.css` — primary structure candidate (lines 190–224)

| Selector | Full rule (summary) | Classification | Routes |
|----------|---------------------|----------------|--------|
| `.screen.game-screen.walnut-live .rh-board-toolbar` | `position:absolute; right:10px; bottom:10px; z-index:12; display:flex; align-items:flex-end; gap:10px; pointer-events:none` | **Structure** — toolbar cluster | **No DOM** — stale |
| `.rh-board-toolbar > *` | `pointer-events:auto` | **Structure** | Stale |
| `.rh-board-toolbar .board-zoom-tray.control-pill` | `position:static; bottom:auto; left:auto` | **Structure** — zoom reset inside toolbar | Stale (toolbar unused) |
| `.screen.game-screen.walnut-live .nbl-board-toolbar` | `position:absolute; inset:auto 10px 10px auto; z-index:12; display:flex; align-items:flex-end; gap:10px; pointer-events:none` | **Structure** | Practice + any future `boardToolbar` |
| `.nbl-board-toolbar > *` | `pointer-events:auto` | **Structure** | Same |

### B3. `match-hud-polish.css` — shared pill chrome (lines 130–223)

| Selector | Declarations (summary) | Classification |
|----------|------------------------|----------------|
| `.board-zoom-tray.control-pill`, `.wl-controls-tray.control-pill` | `display:inline-flex; align-items:center; border-radius; background; border; backdrop-filter; box-shadow; transition` | **Visual skin** |
| `.board-zoom-tray.control-pill` | `position:absolute; bottom:14px; left:14px; z-index:20; gap; padding` | **Mixed** — layout + skin in one rule |
| `.board-zoom-tray.control-pill .board-zoom-btn` | min size, padding, border none, color, cursor, flex | **Mixed** — layout + skin |
| `.board-zoom-btn:hover` / `:active` | background, transform | **Interaction** → future `board-interactions.css` |
| `.board-zoom-divider` | `display:none` | **Structure** (trivial) |
| `.wl-controls-tray.control-pill` | gap, padding | **Mixed** |
| `.wl-controls-tray.control-pill > button, > .btn, .rr-pill` | flex, opacity 0.65, no border/bg, cursor | **Mixed** |
| `:hover` / `:active` on tray buttons | opacity, transform | **Interaction** |
| `svg, .icon-svg` | 20×20, stroke color | **Visual skin** |

### B4. `walnut-live.css`

| Lines (approx) | Selector | Classification |
|----------------|----------|----------------|
| 1388–1397 | `.board-corner-pill`, `.boneyard-pill`, `.board-zoom-tray`, `.wl-controls-tray` | **Visual skin** — border, bg, blur, shadow `!important` |
| 1488–1509 | `.app.large-mode` trays/zoom | **Responsive skin** |
| 1900–1912 | Bot `:not(.learn-lesson-screen)` pills + `.wl-controls-tray` in group | **Visual skin** (shared pill chrome) |
| 1940–1944 | Bot `.wl-controls-tray` | **Mixed** — `right/bottom !important`, `gap` |
| 1946–1948 | Bot `.wl-controls-tray button` | **Visual** — color |
| 2194–2205 | Bot v3 pill group (includes tray) | **Visual skin** — later era |
| 2211–2214 | Bot v3 `.wl-controls-tray` | **Mixed** — `right:32px !important; bottom:30px !important` — **wins** over TSX inline |

**Duplicate:** Bot pill/tray blocks ~1893–1948 and ~2188–2214 overlap; **v3 (~2188+) wins** on shared properties.

### B5. `App.css`

| Selector | Classification |
|----------|----------------|
| `.board-zoom-tray`, `.wl-controls-tray` (4133–4137) | **Structure** — `display:inline-flex; align-items:center; gap:7px` |
| `.large-mode .wl-controls-tray` / `button` (4238–4247) | **Responsive skin** — overridden by walnut-live opt-out on live match |
| `.large-mode .board-zoom-tray` / `.board-zoom-btn` (4266–4280) | **Responsive skin** |
| `@media` block (4509–4517) | **Responsive** — padding, gap, bottom/right `!important`, `transform:scale(0.85)` on both trays |

### B6. `dailyFritzMatchBoard.css` (51–105)

| Target | Classification |
|--------|----------------|
| `.board-zoom-tray.control-pill`, `.wl-controls-tray.control-pill` in DF mode | **Visual skin** — frosted glass `!important` |
| DF zoom/tray button colors + `:hover` | **Skin + interaction** |

### B7. `match-standard-live-board.css` (86–95)

| Selector | Classification |
|----------|----------------|
| `.rh-standard-live-board .wl-controls-tray.control-pill` | **Visual skin** — min-height, padding, border-radius, bg, shadow |

Applies to puzzle + practice screen roots that include `rh-standard-live-board`; puzzle has **no** tray in DOM (rule inert unless tray added).

### B8. `noBrainerLab.css` (223–270, 617–620)

| Selector | Classification |
|----------|----------------|
| `.nbl-board-toolbar` | **Structure** — `right:14px; bottom:14px; z-index:23` — **overrides** architecture `10px/ z-index 12` when both apply |
| `.practice-lab .nbl-board-controls-pill.control-pill` | **Practice-specific** — gap, padding |
| `.nbl-board-controls-pill .board-zoom-btn` + hover/active | **Practice skin + interaction** |
| `.nbl-board-controls-divider` | **Structure** — 1px divider |
| `.nbl-board-control-btn` | Practice utility buttons (read further in file for skin) |
| `@media` `.nbl-board-toolbar` | **Responsive structure** — `right/bottom: 12px` |

### B9. `botMatch.css`

**No** `board-zoom-tray`, `wl-controls-tray`, `rh-board-toolbar`, or `nbl-board-toolbar` selectors.

### B10. `learnGuidedMatch.css`

**No** board control / toolbar selectors.

### B11. Other files

| File | Selector | Classification |
|------|----------|----------------|
| `shared-ui.css` 807–810 | `.learn-lesson-screen` trays | **Route override** — `display:none !important` |
| `learnPlayer.css` 642–644 | `.learn-player-board-wrap .board-zoom-tray` | **Route override** — hide zoom |
| `learnAcademy.css` 1137–1138 | academy board zoom | **Route override** — hide |
| `learning/coach.css` 675–677 | lesson area tray opacity | **Visual** — minor |
| `App.css` | (see B5) | Global base + mobile shrink |

---

## C. Cascade / conflict analysis

### CSS load order (`main.tsx`)

1. `walnut-live.css`
2. `match-hud-polish.css`
3. `match-board-architecture.css`
4. `match-standard-live-board.css`
5. `board/index.css` (includes empty `board-controls.css`, active `board-meta.css`)

Route CSS (e.g. `dailyFritzMatchBoard.css`, `noBrainerLab.css`, `botMatch.css`) loads via components — typically **after** global stack.

### Controls tray final position (bot / multiplayer)

1. **TSX inline** (`BotMatchScreen.tsx`, `App.tsx`): `bottom: 12px`, `right: 12px`, `z-index: 20`.
2. **`match-hud-polish.css`**: gap/padding/skin — no position on `.wl-controls-tray` (zoom tray gets left position only).
3. **`walnut-live.css` bot v3** (~2211): `right: 32px !important; bottom: 30px !important` — **wins** over inline.
4. **`App.css` mobile** (~4513): `bottom/right: 8px !important` + `scale(0.85)` — may apply on narrow viewports.

**Implication:** Migrating tray **position** to `board-controls.css` without reconciling `!important` in `walnut-live` and inline TSX will not change winning values until those layers are edited.

### Zoom tray final position

1. **`match-hud-polish.css`**: `position:absolute; bottom:14px; left:14px; z-index:20` on `.board-zoom-tray.control-pill`.
2. **`walnut-live`**: skin only on `.board-zoom-tray` (no position override in bot blocks).
3. **Architecture** `.rh-board-toolbar .board-zoom-tray` static reset — **inactive** (no toolbar in DOM).
4. **DF** `dailyFritzMatchBoard.css` — frosted skin only.

Zoom is **inside** `.board-container` (Board.tsx); controls tray is **sibling** outside Board — bottom-left vs bottom-right separation is intentional.

### Practice toolbar cascade

1. `match-board-architecture.css` `.nbl-board-toolbar` — base cluster.
2. `noBrainerLab.css` `.nbl-board-toolbar` — higher z-index (23), different offsets (14px).
3. `noBrainerLab` `@media` — 12px offsets.

Moving architecture block to `board-controls.css` without touching `noBrainerLab.css` preserves Practice winning offsets where they differ.

### Stale / duplicate inventory

| Item | Assessment |
|------|------------|
| `.rh-board-toolbar` rules | **Stale** — zero TSX references |
| Walnut bot pill/tray ~1893 vs ~2188 | **Duplicate era** — v3 wins |
| `App.css` `.board-corner-pill` absolute | Fallback when **outside** meta bar; meta bar uses `board-meta.css` static reset |
| `match-standard-live-board` tray skin | **Inert on puzzle** (no tray DOM) |

---

## D. Structure vs skin split (future ownership)

### → `board-controls.css` (structure, later)

- `.nbl-board-toolbar` flex cluster + pointer-events (from architecture)
- `.rh-board-toolbar` + child pointer-events (optional — currently unused DOM)
- `.rh-board-toolbar .board-zoom-tray.control-pill` static reset (only relevant if toolbar adopted in TSX)
- Shared **layout-only** extracts from `match-hud-polish` if split: zoom `position/inset/z-index/gap` without colors
- `App.css` base `display:inline-flex; gap` for trays — **defer** (global, used outside match)

### → Legacy / skin (stay for now)

- Pill backgrounds, borders, blur, shadows (`match-hud-polish`, `walnut-live`, `dailyFritzMatchBoard`, `match-standard-live-board`)
- Bot-match `!important` tray offsets (`walnut-live` ~1940, ~2211)
- DF frosted glass on trays
- Practice `.nbl-board-controls-pill` visual rules (`noBrainerLab.css`)
- `App.css` large-mode and mobile scale rules

### → `board-interactions.css` (later)

- `:hover`, `:active` on `.board-zoom-btn` and tray buttons (`match-hud-polish`, `noBrainerLab`, DF)

### → Leave legacy / route-specific / inline-dependent

- TSX inline `style` on `.wl-controls-tray` until component pass removes duplication
- Learn hides (`shared-ui`, `learnPlayer`, `learnAcademy`)
- `coach.css` lesson tray opacity
- Multiplayer `RoomReactions` inside tray (DOM, not CSS)

---

## E. Risk assessment

| Route | Toolbar structure migration | Zoom tray migration | Controls tray migration |
|-------|----------------------------|---------------------|-------------------------|
| **Daily Fritz** | N/A (no toolbar) | Medium — position in `match-hud-polish` + DF skin stack | **High** — inline + walnut `!important` |
| **Play vs Fritz / ghost** | N/A | Medium | **High** |
| **Multiplayer** | N/A | Medium | **High** |
| **Daily Puzzle** | N/A | Low–medium (zoom only) | N/A (no tray) |
| **Practice** | **Medium** — duplicate `nbl-board-toolbar` in `noBrainerLab.css` | N/A (`showZoomTray={false}`) | N/A (uses `nbl-board-controls-pill`) |
| **Learn** | N/A | Low (hidden) | Low (not rendered / hidden) |
| **Mobile / narrow** | Low for architecture-only move | Medium — `App.css` scales trays | Medium — overlap with zoom |
| **Short height** | Low | Low unless new media queries added | Low |
| **Disabled/active buttons** | N/A | **Do not move** in structure patch | **Do not move** |
| **Gameplay handlers** | No CSS risk | No CSS risk | No CSS risk |

---

## F. Recommended first controls migration batch (Patch 48)

### Safest: **`nbl-board-toolbar` structure from `match-board-architecture.css`**

Move **exact copy** (no value changes):

```css
.screen.game-screen.walnut-live .nbl-board-toolbar { ... }
.screen.game-screen.walnut-live .nbl-board-toolbar > * { ... }
```

**Why safe:** Used in DOM (Practice via `InGameBoardShell`). Practice-specific overrides in `noBrainerLab.css` remain later in cascade where selectors are more specific or equal with later file order.

### Optional same patch (zero visual, dead code): **`.rh-board-toolbar` block**

Move the three `.rh-board-toolbar` rules for ownership consistency even though **no current DOM** — document as reserved for future `boardToolbar` wrapper on bot canvas.

### Defer Patch 48 / later patches

| Item | Reason |
|------|--------|
| `.board-zoom-tray.control-pill` position from `match-hud-polish` | Mixed skin + layout in one rule; needs split |
| `.wl-controls-tray` anything | Inline TSX + walnut `!important` placement |
| `match-hud-polish` hover/active | Interaction ownership |
| `walnut-live` bot tray offsets | Skin/placement stack; dedupe ~1893 vs ~2188 first |
| `App.css` tray base + mobile block | Global scope |
| `noBrainerLab` practice pill skin | Route-specific |
| `dailyFritzMatchBoard` DF tray skin | Mode accent |

---

## G. Rules not to move yet

- All **visual** pill/tray styling in `match-hud-polish.css`, `walnut-live.css`, `dailyFritzMatchBoard.css`, `match-standard-live-board.css`
- **`:hover` / `:active` / `:focus`** on zoom and utility buttons
- **TSX inline** positioning on `.wl-controls-tray` (`BotMatchScreen.tsx`, `App.tsx`)
- **`walnut-live` `!important`** `right`/`bottom` on bot `.wl-controls-tray`
- **`App.css` mobile** tray shrink/position (4509–4517) until tray ownership unified
- Practice **`.nbl-board-controls-pill`** rules (`noBrainerLab.css`)
- Learn **hide** rules (`shared-ui`, `learnPlayer`, `learnAcademy`, `coach.css`)
- Duplicate walnut bot blocks **~1893 vs ~2188** — dedupe audit before moving offsets
- Components, gameplay logic, `board-meta.css` (already migrated Patch 46)
- `board-interactions.css` (comment-only), black matte skin pass

---

## H. Recommended Patch 48

**Migrate a tiny structure-only toolbar batch** into `board-controls.css`:

1. **Primary:** `.nbl-board-toolbar` + `> *` from `match-board-architecture.css`
2. **Optional:** `.rh-board-toolbar` trio (dead DOM today; zero visual impact)
3. **Do not** migrate zoom tray or `wl-controls-tray` in Patch 48
4. **Do not** split `match-hud-polish` yet

**Alternative:** Pause for browser checks after Patch 46 meta migration before Patch 48 — reasonable if QA has not run meta bar pass yet.

**Not recommended for Patch 48:** Full zoom tray migration or `wl-controls-tray` structure migration.

---

## I. Exact proposed Patch 48 (if approved)

### Files to edit

1. `client/src/styles/board/board-controls.css`
2. `client/src/styles/match-board-architecture.css`

### Selectors to move (exact lines in architecture today: 191–224)

**Block A — optional dead hook:**

```css
.screen.game-screen.walnut-live .rh-board-toolbar { ... }
.screen.game-screen.walnut-live .rh-board-toolbar > * { ... }
.screen.game-screen.walnut-live .rh-board-toolbar .board-zoom-tray.control-pill { ... }
```

**Block B — active Practice toolbar:**

```css
.screen.game-screen.walnut-live .nbl-board-toolbar { ... }
.screen.game-screen.walnut-live .nbl-board-toolbar > * { ... }
```

### Declarations to leave behind (do not move in Patch 48)

- Entire `match-hud-polish.css` control section (130–223)
- All `walnut-live` tray/pill skin and `!important` offsets
- `dailyFritzMatchBoard.css` DF tray/zoom rules
- `match-standard-live-board.css` tray skin
- `noBrainerLab.css` practice toolbar offsets and pill skin (keep; wins over architecture)
- `App.css` tray rules
- Bot-match HUD grid rules in architecture (226+) — **not** part of toolbar migration

### Ownership comment for `board-controls.css`

```css
/* Shared board toolbar / control-tray structure.
   Visual pill skins, mode accents, and interaction states remain legacy-owned until the skin pass. */
```

### Verification searches (after Patch 48)

```bash
rg 'rh-board-toolbar|nbl-board-toolbar' client/src/styles
rg 'board-controls\.css' client/src/styles/board
rg 'board-zoom-tray|wl-controls-tray' client/src/styles/board/board-controls.css
# Expect: toolbar structure only in board-controls.css; zoom/tray not in board-controls yet
```

### Build

```bash
npm run build --prefix client
```

---

## J. Browser verification checklist

Use after Patch 48 (and re-check Patch 46 meta if not yet done):

| Check | Routes |
|-------|--------|
| Meta bar layout (open ends left, boneyard right) | DF, PvF, ghost, multiplayer |
| Meta bar count-only (boneyard right) | Daily Puzzle |
| Zoom tray bottom-left, ± works | DF, PvF, ghost, puzzle, multiplayer |
| Utility tray bottom-right (mute, fullscreen, leave) | DF, PvF, ghost, multiplayer |
| Tray does not block placement / hand | All active matches |
| Practice combined pill (zoom + fullscreen + home) | No Brainer Lab |
| Learn lesson — no stray trays | Learn / Guided bot lesson |
| Desktop / laptop | 1280×800, 1440×900 |
| Narrow / short | ≤768px width; ≤760px height |
| `large-mode` accessibility | If enabled — trays should not blow layout (walnut opt-out) |
| Disabled/active button feedback | Hover/active on zoom and icon buttons |
| DF frosted pills vs standard bot | Visual parity unchanged |

---

## Appendix: `match-board-architecture.css` toolbar excerpt (source of truth for Patch 48)

```css
/* ─── Board toolbar (controls + zoom alignment) ─── */
.screen.game-screen.walnut-live .rh-board-toolbar {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 12;
  display: flex;
  align-items: flex-end;
  gap: 10px;
  pointer-events: none;
}

.screen.game-screen.walnut-live .rh-board-toolbar > * {
  pointer-events: auto;
}

.screen.game-screen.walnut-live .rh-board-toolbar .board-zoom-tray.control-pill {
  position: static;
  bottom: auto;
  left: auto;
}

.screen.game-screen.walnut-live .nbl-board-toolbar {
  position: absolute;
  inset: auto 10px 10px auto;
  z-index: 12;
  display: flex;
  align-items: flex-end;
  gap: 10px;
  pointer-events: none;
}

.screen.game-screen.walnut-live .nbl-board-toolbar > * {
  pointer-events: auto;
}
```

---

*End of Patch 47 audit.*
