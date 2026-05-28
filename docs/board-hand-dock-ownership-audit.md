# Board Hand Dock Ownership Audit

**Patch:** 32 (planning / audit only — no implementation)  
**Date:** 2026-05-28  
**Target namespace:** `client/src/styles/board/board-hand-dock.css` (header-only today)  
**Mode:** No-visual-change structural migration planning — not redesign  

**Related:** `docs/neutral-board-surface-bridge-checkpoint.md`, `client/src/styles/board/README.md`

---

## Executive summary

The live match **hand dock** is a shared DOM pattern (`rh-live-hand-deck` → `wl-hand-area` → `tray-rail` → `tray-center` → `hand-container` → `hand-row` → `DominoTile`) used by **Daily Fritz, Play vs Fritz, ghost/bot, Daily Puzzle, and Learn/Guided**. **Practice / No Brainer Lab** uses a **separate** `nbl-tray` / `nbl-hand-row` path.

**CSS is heavily layered:** `App.css` provides generic tray primitives; `walnut-live.css` owns most match hand layout + skin (~80+ selectors); `botMatch.css`, `learnGuidedMatch.css`, `dailyFritzMatchBoard.css`, `dailyPuzzle.css`, `game-interactions.css`, and `rh-glow-underline.css` add route or interaction layers.

**Key risk:** `walnut-live.css` contains **two competing `rh-live-hand-deck` style generations** (grid “v2” ~2316 and block “v3” ~2606); the later block wins for bot-match. Do not move deck-shell rules until that duplication is understood.

**Recommended Patch 33:** Move a **tiny structure-only batch** — generic inner tray layout from `walnut-live.css` (`.wl-hand-area .tray-center`, `.hand-container`, `.hand-row`, scroll/stack modifiers ~661–746) into `board-hand-dock.css` and delete those lines from `walnut-live.css`. **Defer** `rh-live-hand-deck` shell, `.wl-hand-area` chrome, Learn/Guided decks, Daily Fritz accents, tile/interaction CSS.

---

## A. Active hand dock DOM paths

### A1. Daily Fritz / Play vs Fritz / ghost / bot (active match)

**Screen root:** `.screen.game-screen.walnut-live.bot-match-screen` (+ `.bot-match-mode-*`, optional `.df-board-has-play` for Daily Fritz)

| Layer | Source | Classes / `data-ui` |
|-------|--------|---------------------|
| Match shell | `client/src/match/board/InGameBoardShell.tsx` | `.walnut-match-layout.game-layout-layer` |
| Top HUD | `InGameBoardHud` in `BotMatchScreen.tsx` | `.wl-top-rail` / bot HUD variants |
| Studio column | `client/src/match/board/InGameBoardFrame.tsx` | `.rh-live-studio-shell` |
| Board zone | `InGameBoardFrame` | `.rh-live-board-zone` → `boardStage` |
| Board stage | `BotMatchScreen.tsx` | `.wl-stage-shell` → `MatchNblBoardFrame` → `.nbl-board-canvas` → `Board` |
| Hand deck shell | `InGameBoardFrame` | `.rh-live-hand-deck` (`data-ui="live-hand-deck"`) |
| Hand tray (inner) | `BotMatchScreen.tsx` `handTray` | `.hand-area.wl-hand-area` (`data-ui="tray"`) |
| Tray structure | same | `.tray-rail` → `.tray-center` (`ref={handAreaRef}`) |
| Rack | same | `.hand-container` + `.is-stacked?` + `.has-single-row` \| `.has-multiple-rows` |
| Rows | same | `.hand-row` per `normalHandRows` |
| Tile wrapper | guided / lesson | `.guided-tile-wrap` (+ badges) |
| Tile | `DominoTile` | `.domino-tile` + `selected` / `highlight` / `unplayable` / `disabled` / `new-draw` / guided classes |

**Props / state (hand tray only — do not change):**

- `handAreaRef`, `normalHandRows`, `handCompactStacked`, `handTileSize`
- Per tile: `selectedTile`, `handActive`, `botTurn`, `drawSequenceActive`, `getHandTileLegality` → `highlight` / `unplayable`
- Guided: `guidedScoringTiles`, `guided-tile-wrap`, `is-coached-recommended`
- Handlers: `onClick` → `setSelectedTile`, play pipeline; Daily Fritz trace hooks

**Learn / Guided (same `handTray`, different outer shell):**

When `isLessonLayoutMode`, board is embedded in guided cockpit; hand is wrapped as:

```html
<div class="rh-live-hand-deck learn-guided-live-hand-deck" data-ui="live-hand-deck">
  <!-- same .hand-area.wl-hand-area > tray-rail > ... -->
</div>
```

(`BotMatchScreen.tsx` ~7770 — not using `InGameBoardFrame` hand slot for lesson layout.)

### A2. Daily Puzzle

**Screen:** `.daily-puzzle-screen.rh-standard-live-board`  
**Shell:** `client/src/match/InGameBoardShell.tsx` (large layout file) with `hand={...}` prop.

**DOM:**

```
InGameBoardShell (studio)
  rh-live-studio-shell (via stage + hand in rh-match-body pattern)
    … board via InGameBoardFrameContent …
    InGameBoardHandTray → .hand-area.wl-hand-area
      .tray-rail → .tray-center → .hand-container → .hand-row → DominoTile
```

**Note:** Puzzle passes **only** `tray-rail` subtree as `hand` children; `InGameBoardHandTray` adds `.hand-area.wl-hand-area` wrapper (default `handOuterClassName`).

**Does not use** `match/board/InGameBoardFrame` or `.rh-live-hand-deck` unless a parent adds it — puzzle uses **legacy studio + `wl-hand-area`** directly.

### A3. Practice / No Brainer Lab

**Separate path — not `wl-hand-area`:**

```
NoBrainerLabScreen
  .nbl-tray
    .nbl-hand-row → DominoTile
```

CSS: `noBrainerLab.css` (`.nbl-tray`, `.nbl-hand-row`) — out of scope for first hand-dock batch except future convergence planning.

### A4. Multiplayer (`App.tsx`)

**DOM:** `.wl-stage-shell` → `MatchNblBoardFrame` → board; sibling `.hand-area.wl-hand-area` with same `tray-rail` / `tray-center` / `hand-container` pattern (`App.tsx` ~5602).

Uses generic walnut classes; **no** `.rh-live-hand-deck` unless added elsewhere.

### A5. Component file map

| File | Role |
|------|------|
| `client/src/bot/BotMatchScreen.tsx` | Builds `handTray`; bot/DF/PvF/ghost/learn |
| `client/src/match/board/InGameBoardFrame.tsx` | `.rh-live-studio-shell` + `.rh-live-hand-deck` wrapper |
| `client/src/match/board/InGameBoardShell.tsx` | Simple `.walnut-match-layout` + HUD + children |
| `client/src/match/InGameBoardShell.tsx` | Alternate shell with `hand` prop (Daily Puzzle) |
| `client/src/dailyPuzzle/DailyPuzzleScreen.tsx` | Puzzle hand subtree |
| `client/src/App.tsx` | Multiplayer hand tray |

---

## B. CSS ownership map

**Legend:** Active = on live routes; Stale = selector likely unused or superseded; Generic = applies broadly under `.walnut-live` or global.

### B1. Canonical namespace

| File | Status |
|------|--------|
| `client/src/styles/board/board-hand-dock.css` | **Header only** — documents future ownership |

### B2. Global engine — `client/src/App.css`

| Selector | Summary | Type | Routes |
|----------|---------|------|--------|
| `.tray-rail` | `display: grid`; 3-column template; full width/height | **Structure** | All tray users |
| `.tray-center` | flex center; `overflow: hidden`; min-width 0 | **Structure** | All |
| `.hand-container` | flex row; `height: 100px`; gap 8px; nowrap | **Structure** | All |
| `.hand-container.is-stacked` | 2-row grid; auto height | **Structure** | Stacked hands |
| `.hand-container.is-scrollable` | `overflow-x: auto`; flex-start | **Structure / responsive** | Long hands |
| `.hand-row` | flex row; center; gap 8px | **Structure** | All |
| `.hand-container .domino-tile` | flex-shrink + **enter animation** | **Interaction/visual** | All |
| `@media` blocks ~4417+ | `.wl-hand-area` height/flex overrides | **Responsive structure** | walnut screens |

**Winning order:** Base here (0,1,0) → overridden by `walnut-live` (0,2,0+) and route files.

### B3. Primary owner — `client/src/styles/walnut-live.css`

| Selector / block | Lines (approx) | Type | Scope |
|------------------|----------------|------|--------|
| `.wl-hand-area` (z-index stack list) | 88–91 | Structure | Generic walnut |
| `.wl-hand-area` shell | 435–461 | **Visual + structure** (`--tray-height`, border, background, shadow) | Generic |
| `.wl-hand-area .tray-rail` | 467–474 | **Structure** (grid columns) | Generic |
| `.wl-hand-area .tray-center` | 661–668 | **Structure** | Generic |
| `.rh-tile-rack` + `__tile` | 671–708 | **Visual** (opponent rack pills) | HUD — not player hand |
| `.wl-hand-area .hand-container` | 710–717 | **Structure** | Generic |
| `.wl-hand-area .hand-container.is-stacked` | 720–726 | **Structure** | Multi-row |
| `.wl-hand-area .hand-row` | 728–733 | **Structure** | Generic |
| `.wl-hand-area .hand-container.is-scrollable` | 735–741 | **Structure** | Scroll |
| `.wl-hand-area .hand-container:not(.is-scrollable)` | 743–746 | **Structure** | Center when not scrolling |
| `.wl-hand-area .domino-body` | 748–753 | **Tile visual** | Hand tiles |
| `.walnut-live .hand-container .domino-tile` hover/selected | 645–655 | **Interaction** | Generic |
| `.screen…walnut-live .wl-hand-area` width reset | 1389–1394 | Structure | Generic |
| `.screen…walnut-live .wl-hand-area` background/border | 1414–1417 | **Visual** | Generic |
| `.screen…bot-match… .wl-hand-area` | 2013–2028 | **Visual shell** | Bot/DF/PvF/ghost |
| `.screen…bot-match… .wl-hand-area::before` | 2030–2040 | **Pseudo / visual** | Bot |
| `.screen…bot-match… .wl-hand-area .tray-rail` | 2042–2049, 2376+, 2678+ | **Visual** (later blocks strip to transparent) | Bot |
| `.screen…bot-match… .wl-hand-area .hand-row` | 2051+, 2689+ | **Structure** (gap clamp) | Bot |
| `.screen…bot-match… .rh-live-hand-deck` (grid v2) | 2316–2332 | **Visual shell** | Bot — **partially superseded** |
| `.rh-live-hand-deck__header` (+ span/strong) | 2334–2357 | **Visual** | **Stale?** — no TSX reference found |
| `.screen…bot-match… .rh-live-hand-deck .wl-hand-area` reset | 2359–2374 | Structure strip | Bot |
| `.screen…bot-match… .rh-live-hand-deck` (block v3) | 2606–2618 | **Visual shell** | Bot — **wins over v2** |
| `.screen…bot-match… .rh-live-hand-deck .wl-hand-area` | 2620–2624 | **Structure** | Bot |
| `.screen…bot-match… .rh-live-hand-deck .tray-center` | 2626–2631 | **Structure** | Bot |
| `.screen…bot-match… .rh-live-hand-deck .hand-container` (+ scroll/single-row) | 2633–2676 | **Structure** (+ guided wrap layout) | Bot |
| `@media (max-height: 760px)` deck/tray | 2387+, 2694+ | **Responsive structure** | Bot |

### B4. `client/src/bot/botMatch.css`

| Selector | Type | Routes |
|----------|------|--------|
| `.bot-match-screen .hand-container.is-scrollable` | **Structure** (scroll + hide scrollbar) | Bot family |
| `.bot-match-screen .hand-container .domino-tile` | **Structure** (`flex-shrink: 0`) | Bot |
| `.learn-lesson-screen…learn-guided-live-hand-deck` … `.domino-body` | **Interaction/visual** | Learn |

### B5. `client/src/learn/learnGuidedMatch.css`

| Selector | Type | Routes |
|----------|------|--------|
| `.learn-guided-live-hand-deck` | **Visual shell** | Learn/Guided |
| `.learn-guided-live-hand-deck .wl-hand-area` | Structure strip | Learn |
| `.learn-guided-live-hand-deck .tray-rail` / `.tray-center` | Mixed | Learn |
| `.learn-guided-live-hand-deck .hand-container` (+ scroll) | **Structure** | Learn |
| `.learn-lesson-screen…` hand-deck tile/highlight rules | **Interaction** | Learn |

### B6. Other route / support files

| File | Hand-related | Type |
|------|----------------|------|
| `match-standard-live-board.css` | `.wl-controls-tray.control-pill` only | Meta/control — not dock layout |
| `match-board-architecture.css` | `.rh-match-tray-shell .wl-hand-area` margin/border reset | Structure strip |
| `match-hud-polish.css` | `.rh-tile-rack__tile` mobile size; not player dock | HUD rack |
| `dailyFritzMatchBoard.css` | `.bot-match-mode-daily-fritz .wl-hand-area` `border-top-color` | **DF skin accent** |
| `dailyPuzzle.css` | `.daily-puzzle-screen .wl-hand-area { padding-bottom }` | **Route tweak** |
| `game-interactions.css` | tile selected/highlight/unplayable; **overflow: visible** on tray chain | **Interaction + layout** |
| `rh-glow-underline.css` | `.hand-container .domino-tile.highlight::after` | **Interaction** |
| `noBrainerLab.css` | `.nbl-tray`, `.nbl-hand-row` | **Separate practice dock** |

### B7. Stale / duplicate signals

| Item | Assessment |
|------|------------|
| `.rh-live-hand-deck__header` | **Likely stale** — CSS without matching JSX |
| `rh-live-hand-deck` grid block (2316) vs block (2606) | **Duplicate generations** — same specificity; later (v3) wins |
| `.hand-container.is-scrollable` in bot TSX | **Not toggled in BotMatchScreen** — scroll rules apply only if class added elsewhere |
| `has-multiple-rows` class | Emitted by bot; **no dedicated CSS** located (only `has-single-row` styled) |

---

## C. Current cascade / conflict analysis

### Load order (globals)

`main.tsx`: `walnut-live.css` → … → `match-standard-live-board.css` → `board/index.css` (includes empty `board-hand-dock.css`).

**Route chunks:** `botMatch.css`, `dailyFritzMatchBoard.css`, `learn.css` → `learnGuidedMatch.css`, `noBrainerLab.css` (frame only for bot), component CSS.

### How bot-match hand dock gets its final look

1. **`App.css`** — base grid/flex for `.tray-rail`, `.tray-center`, `.hand-container`, `.hand-row`.
2. **`walnut-live.css`** — `.wl-hand-area` height/border/background; inner flex/scroll; bot-match overrides on `.wl-hand-area` and `.rh-live-hand-deck` (v3 block wins).
3. **`botMatch.css`** — scroll behavior when `.is-scrollable`; tile `flex-shrink`.
4. **`dailyFritzMatchBoard.css`** — brass `border-top-color` on `.wl-hand-area` when DF mode.
5. **`game-interactions.css`** — selected/highlight bodies, `translateY` on selected, **forces `overflow: visible`** on tray chain (coordinates with glow).
6. **`rh-glow-underline.css`** — playable underline `::after` on hand tiles.
7. **`learnGuidedMatch.css`** — when lesson layout: replaces deck shell with `.learn-guided-live-hand-deck` rules.

### Puzzle

Inherits walnut + `App.css` base; **`match-standard-live-board`** does not define hand dock; **`dailyPuzzle.css`** adds bottom padding on `.wl-hand-area`. No `.rh-live-hand-deck`.

### Practice

**Bypasses** walnut hand dock stack — `nbl-hand-row` only.

### Conflicts to respect in migration

- Moving rules **earlier** (into `board-hand-dock` in `main` bundle) vs **later** (chunk) changes timing; prefer **identical selectors**.
- **`game-interactions.css` `overflow: visible`** must remain effective for underline glow — do not reintroduce clipping on `.tray-center` / `.hand-container` without testing.
- **Do not merge** v2 and v3 `rh-live-hand-deck` blocks in migration — audit/collapse in a later patch.

---

## D. Structure vs skin split (future ownership)

### → `board-hand-dock.css` (later)

| Category | Examples |
|----------|----------|
| Dock layout | `.rh-live-hand-deck` flex/grid basis (after dedupe) |
| Tray shell layout | `.wl-hand-area` height/flex **only if** split from border/background |
| Tray rail / center | `.tray-rail` grid, `.tray-center` flex |
| Rack layout | `.hand-container`, `.is-stacked`, `.is-scrollable`, `:not(.is-scrollable)` |
| Row packing | `.hand-row` flex, gap, `clamp()` gaps on bot |
| Scroll behavior | `botMatch.css` scroll rules; walnut scroll modifiers |
| Responsive structure | `@media` tray-height, deck `flex-basis`, `max-height` deck shrink |
| Guided wrap geometry | `.hand-container.has-single-row .guided-tile-wrap` (layout only) |

### → `board-tiles.css` (later)

- `.domino-body` in hand context
- `.hand-container .domino-tile` enter animation (`App.css`)
- Tile sizing if standardized globally
- `rh-tile-rack` opponent rack visuals

### → `board-interactions.css` (later)

- `game-interactions.css` selected / highlight / unplayable / `translateY`
- `rh-glow-underline.css` hand highlight `::after`
- Bot/lesson coached recommendation borders

### → future skin / `skins/racehorse-matte.css`

- Black matte/gold treatment
- Border/background/box-shadow on `.wl-hand-area`, `.rh-live-hand-deck`
- Daily Fritz brass accents
- Pseudo-elements (`::before` on hand area)

### Leave legacy for now

- Full **Learn/Guided** `.learn-guided-live-hand-deck` block
- **Daily Fritz** `dailyFritzMatchBoard.css` hand accent
- **`match-hud-polish`** global frame polish (unrelated but adjacent)
- **Practice** `nbl-tray` path
- **`rh-live-hand-deck` v2/v3** until deduplicated
- **`rh-live-hand-deck__header`** until DOM exists or CSS removed

---

## E. Risk assessment

| Area | Risk | Notes |
|------|------|-------|
| **Daily Fritz** | Medium | DF border accent + bot deck v3 + glow underline |
| **Play vs Fritz / ghost** | Medium | Same as bot; mobile `App.css` + `botMatch` scroll |
| **Daily Puzzle** | Low–medium | No `rh-live-hand-deck`; relies on `wl-hand-area` + puzzle padding |
| **Practice** | **Out of scope** | Different DOM |
| **Learn / Guided** | **High** | Separate deck class; many interaction overrides |
| **Mobile / narrow** | Medium | `App.css` media + bot `@media max-height` |
| **Short height** | Medium | `--tray-height` + deck `flex-basis` shrink |
| **Long hands / many tiles** | Medium | `.is-scrollable` rules (class rarely set on bot — verify) |
| **Selected / playable** | **High if touched** | `game-interactions` + `rh-glow-underline` + bot `::after` |
| **Duplicate deck CSS** | **High** | Moving one block without the other breaks bot dock |

---

## F. Recommended first migration batch (Patch 33 candidate)

**Smallest safe structure-only batch** — move **as-is** from `walnut-live.css`, delete source copy:

```css
/* Inner tray layout — walnut-live scoped (Patch 33) */
.wl-hand-area .tray-center { … }          /* 661-668 */
.wl-hand-area .hand-container { … }       /* 710-717 */
.wl-hand-area .hand-container.is-stacked { … }
.wl-hand-area .hand-row { … }
.wl-hand-area .hand-container.is-scrollable { … }
.wl-hand-area .hand-container:not(.is-scrollable) { … }
```

**Optional same patch (still structure):**

```css
.wl-hand-area .tray-rail { … }              /* 467-474 — grid columns, no color */
```

**Also safe candidate from `botMatch.css`:**

```css
.bot-match-screen .hand-container.is-scrollable { … }  /* 204-219 */
.bot-match-screen .hand-container .domino-tile { flex-shrink: 0; }
```

### Avoid in Patch 33

- `.wl-hand-area` shell (435–461) — border/background/shadow
- Any `.rh-live-hand-deck` rule (v2 or v3)
- `.screen…bot-match… .wl-hand-area` visual blocks
- `learn-guided-live-hand-deck` *
- `dailyFritz` hand accent
- `game-interactions.css` / `rh-glow-underline.css`
- `App.css` base rules (move only after inner walnut batch proven — larger blast radius)
- `guided-tile-wrap` / `has-single-row` bot block (2648–2676) — coordinate with interactions

---

## G. Rules not to move yet

- `.rh-live-hand-deck` (all variants) and `__header`
- `.wl-hand-area` border/background/shadow/`::before`/`--tray-height` chrome (until structural/visual split planned)
- `.walnut-live .wl-board-area .board-container` (different path)
- Learn/Guided `.learn-guided-live-hand-deck` *
- Daily Fritz `.bot-match-mode-daily-fritz .wl-hand-area`
- `game-interactions.css`, `rh-glow-underline.css` hand tile states
- `match-hud-polish.css` frame polish
- Practice `.nbl-tray` / `.nbl-hand-row`
- Tile `.domino-body` hand appearance
- `rh-tile-rack` (HUD opponent rack)
- `App.css` responsive walnut hand overrides (until deliberate pass)
- Pseudo-elements on hand dock

---

## H. Recommended Patch 33

**Proceed with: migrate tiny structure-only hand dock batch into `board-hand-dock.css`** (Section F), mirroring Patches 28–30 discipline:

1. Add ownership comment + walnut-scoped inner tray rules to `board-hand-dock.css`.
2. Remove exact copies from `walnut-live.css` (and optionally `botMatch.css` scroll/shrink lines).
3. `npm run build --prefix client`
4. Browser matrix: bot match (DF + PvF), puzzle, learn guided (smoke), multiplayer if easy, narrow + short height.

**Do not:**

- Switch to tile/interactions audit yet (that's Patch 34+).
- Pause only for browser checks if team wants Patch 32 review first — one quick bot + puzzle pass is enough before Patch 33 implementation.

**Not recommended for Patch 33:**

- Full `App.css` tray extraction (larger cascade shift).
- `rh-live-hand-deck` ownership (requires duplicate-block reconciliation doc first).

---

## I. Browser verification checklist (post–Patch 33)

- [ ] Daily Fritz — hand dock height, tile centering, underline glow, DF top border accent unchanged
- [ ] Play vs Fritz — same
- [ ] Ghost / bot match — same
- [ ] Daily Puzzle — `wl-hand-area` padding, stacked hand if many tiles
- [ ] Learn / Guided — deck shell unchanged (only inner layout if shared rules hit)
- [ ] Desktop / laptop / narrow / short-height (`max-height: 760px`)
- [ ] Long hand (many tiles) — scroll if `.is-scrollable` ever applied
- [ ] Selected + playable tiles — glow not clipped

---

## J. Suggested follow-up docs (Patch 34+)

| Patch | Topic |
|-------|--------|
| 34 | `rh-live-hand-deck` duplicate-block reconciliation (v2 vs v3) |
| 35 | `App.css` generic tray primitives → `board-hand-dock.css` |
| 36 | Tile/interactions audit → `board-tiles.css` / `board-interactions.css` |
| 37+ | Learn deck + DF skin migration plans |

---

## References

- `client/src/styles/board/board-hand-dock.css`
- `docs/neutral-board-surface-bridge-checkpoint.md` — recommends Option B (this audit)
- `client/src/bot/BotMatchScreen.tsx` — `handTray` (~6625)
- `client/src/match/board/InGameBoardFrame.tsx` — `.rh-live-hand-deck` wrapper
