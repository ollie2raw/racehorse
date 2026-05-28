# `.rh-live-hand-deck` Reconciliation Plan

**Patch:** 34 (planning / audit only — no implementation)  
**Date:** 2026-05-28  
**Goal:** Source-of-truth map for competing deck-shell CSS before any migration into `board-hand-dock.css`  
**Mode:** No-visual-change planning — not redesign  

**Related:** `docs/board-hand-dock-ownership-audit.md`, Patch 33 (`board-hand-dock.css` inner tray layout)

---

## Executive summary

| Finding | Detail |
|---------|--------|
| **Two bot-match deck blocks** | **v2/grid** (~2253–2317) and **v3/block** (~2543–2638) share selector `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck` |
| **Winner** | **v3 (later)** controls all overlapping deck-shell properties; v2 grid layout is **dead** (`display: block` overrides `display: grid`) |
| **v2 residue** | Only `min-height: 0` and `overflow: hidden` from v2 still apply (v3 does not set them) |
| **`__header` rules** | **CSS-only / stale** — no JSX/TSX reference to `.rh-live-hand-deck__header` |
| **Learn** | Uses `.rh-live-hand-deck.learn-guided-live-hand-deck` but bot `:not(.learn-lesson-screen)` rules **do not apply**; Learn deck owned by `learnGuidedMatch.css` |
| **Puzzle / Practice** | **Do not use** `.rh-live-hand-deck` |

**Recommended Patch 35:** Browser baseline capture, then **delete superseded v2 deck + `__header` blocks** while **merging** v2’s `min-height: 0` and `overflow: hidden` into the surviving v3 deck rule — still in `walnut-live.css` (no deck-shell move yet).

---

## A. All `.rh-live-hand-deck` rules

### A1. `client/src/styles/walnut-live.css`

#### Block 1 — v2 deck shell (older / grid era)

| Field | Value |
|-------|--------|
| **Lines** | 2253–2269 |
| **Selector** | `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck` |
| **Section context** | Precedes corner-pill batch; before v3 comment `Racehorse live board v3` (2339) |
| **Classification** | **Older v2 / grid** — superseded for most properties |

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck {
  flex: 0 0 178px;
  min-height: 0;
  display: grid;
  grid-template-columns: 148px minmax(0, 1fr);
  align-items: stretch;
  gap: 16px;
  padding: 14px 18px 20px;
  border-radius: 32px 32px 0 0;
  border: 1px solid rgba(88, 166, 255, 0.18);
  border-bottom: 0;
  background: rgba(4, 10, 19, 0.94);
  box-shadow:
    0 -26px 76px rgba(0, 0, 0, 0.46),
    inset 0 1px 0 rgba(255, 255, 255, 0.045);
  overflow: hidden;
}
```

#### Block 2 — v2 `__header` (stale)

| Field | Value |
|-------|--------|
| **Lines** | 2271–2294 |
| **Selectors** | `.rh-live-hand-deck__header`, `__header span`, `__header strong` |
| **Classification** | **Stale / CSS-only** — no runtime DOM |

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck__header {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  padding: 0 12px 0 2px;
  border-right: 1px solid rgba(88, 166, 255, 0.13);
  font-family: var(--font-display);
  text-transform: uppercase;
}
/* + span/strong color/typography rules */
```

#### Block 3 — v2 child reset (`.wl-hand-area` inside deck)

| Field | Value |
|-------|--------|
| **Lines** | 2296–2311 |
| **Selectors** | `.rh-live-hand-deck .wl-hand-area`, `.rh-live-hand-deck .wl-hand-area::before` |
| **Classification** | **v2 child strip** — partially superseded by v3 child block (2557+) |

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck .wl-hand-area {
  height: 100%;
  min-height: 0;
  max-height: none;
  flex-basis: auto;
  margin: 0 !important;
  padding: 0;
  border: 0 !important;
  border-radius: 0;
  background: transparent !important;
  box-shadow: none !important;
}

.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck .wl-hand-area::before {
  content: none;
}
```

#### Block 4 — v2 era tray-rail chrome (between v2 and v3)

| Field | Value |
|-------|--------|
| **Lines** | 2313–2317 |
| **Selector** | `.screen…bot-match… .wl-hand-area .tray-rail` |
| **Classification** | **Mode-specific visual** — superseded by v3 strip at 2615–2624 |

#### Block 5 — v2 `@media (max-height: 760px)` deck height

| Field | Value |
|-------|--------|
| **Lines** | 2324–2337 (deck rule at 2329–2331) |
| **Selector** | `.rh-live-hand-deck { flex-basis: 142px; }` |
| **Classification** | **Responsive v2** — redundant at normal height (v3 uses `flex: 0 0 142px`); at short height **superseded** by v3 media (2636) |

#### Block 6 — v3 deck shell (active winner)

| Field | Value |
|-------|--------|
| **Lines** | 2543–2555 |
| **Selector** | `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck` |
| **Section context** | Under comment `Racehorse live board v3: cleaner premium table direction` (2339); after board-zone / watermark rules |
| **Classification** | **Newer v3 / block** — **active deck shell** |

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck {
  position: relative;
  flex: 0 0 142px;
  display: block;
  padding: 12px 20px 16px;
  border-radius: 28px 28px 0 0;
  border: 0;
  background: rgba(5, 11, 21, 0.86);
  box-shadow:
    0 -18px 58px rgba(0, 0, 0, 0.36),
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    inset 0 0 0 1px rgba(88, 166, 255, 0.11);
}
```

#### Block 7 — v3 child layout overrides (deck-scoped)

| Lines | Selector | Classification |
|-------|----------|----------------|
| 2557–2561 | `.rh-live-hand-deck .wl-hand-area` | **Structure** (partial; overlaps v2 child) |
| 2563–2568 | `.rh-live-hand-deck .tray-center` | **Structure** — overrides `board-hand-dock.css` |
| 2570–2575 | `.rh-live-hand-deck .hand-container` | **Structure** |
| 2577–2583 | `.rh-live-hand-deck .hand-container.is-scrollable` | **Structure / scroll** |
| 2586–2613 | `.has-single-row` + `.guided-tile-wrap` + `.domino-tile` | **Structure + interaction geometry** — defer |
| 2615–2624 | `.wl-hand-area .tray-rail` (transparent strip) | **Structure + visual reset** |
| 2626–2629 | `.wl-hand-area .hand-row` gap | **Structure** |

#### Block 8 — v3 `@media (max-height: 760px)`

| Field | Value |
|-------|--------|
| **Lines** | 2631–2638 |
| **Rules** | `--tray-height: 112px` on screen; `.rh-live-hand-deck { flex-basis: 116px; }` |
| **Classification** | **Responsive v3** — **wins** short-height deck basis |

### A2. Other files

| File | `.rh-live-hand-deck` usage |
|------|----------------------------|
| `client/src/match/board/InGameBoardFrame.tsx` | Emits `.rh-live-hand-deck` wrapper (`data-ui="live-hand-deck"`) |
| `client/src/bot/BotMatchScreen.tsx` | Lesson path: `rh-live-hand-deck learn-guided-live-hand-deck` (no `InGameBoardFrame` on lesson layout) |
| `client/src/match/InGameBoardShell.tsx` | Comment + integrated PVF uses `rh-live-hand-deck` class name on hand tray |
| `client/src/styles/board/board-hand-dock.css` | Comment reference only — **no deck rules yet** |
| `client/src/learn/learnGuidedMatch.css` | **`.learn-guided-live-hand-deck`** only (not `.rh-live-hand-deck` selector) |
| `client/src/dailyFritz/dailyFritzMatchBoard.css` | **No** `.rh-live-hand-deck` — only `.wl-hand-area` border accent |
| `client/src/bot/botMatch.css` | **No** `.rh-live-hand-deck` |

---

## B. Declaration-by-declaration winner map

**Scope:** Active bot match path — `.screen.game-screen.walnut-live.bot-match-screen` **without** `.learn-lesson-screen` (Daily Fritz, Play vs Fritz, ghost).

**DOM:** `InGameBoardFrame` → `.rh-live-hand-deck` → `.hand-area.wl-hand-area` → `.tray-rail` → `.tray-center` → `.hand-container` → `.hand-row`.

### B1. On `.rh-live-hand-deck` (outer deck element)

| Property | Winning value | Winning source | v2 status | Structure vs skin |
|----------|---------------|----------------|-----------|-------------------|
| `position` | `relative` | v3 · 2544 | v2 unset | Structure |
| `display` | `block` | v3 · 2546 | v2 `grid` **dead** | Structure |
| `flex` | `0 0 142px` | v3 · 2545 | v2 `0 0 178px` **stale** | Structure |
| `flex-basis` (short ≤760px) | `116px` | v3 media · 2636 | v2 media 142px **stale** at short height | Structure |
| `min-height` | `0` | v2 · 2255 only | Still **active** (v3 omits) | Structure |
| `overflow` | `hidden` | v2 · 2268 only | Still **active** (v3 omits) | Structure |
| `padding` | `12px 20px 16px` | v3 · 2547 | v2 padding **stale** | Structure |
| `gap` | — | — | v2 `16px` **dead** (not grid) | — |
| `grid-template-columns` | — | — | v2 **dead** | — |
| `align-items` (deck) | — | — | v2 `stretch` **dead** | — |
| `border-radius` | `28px 28px 0 0` | v3 · 2548 | v2 32px **stale** | Visual skin |
| `border` | `0` | v3 · 2549 | v2 border **stale** | Visual skin |
| `background` | `rgba(5, 11, 21, 0.86)` | v3 · 2550 | v2 bg **stale** | Visual skin |
| `box-shadow` | v3 inset + drop | v3 · 2551–2554 | v2 shadow **stale** | Visual skin |
| `backdrop-filter` | — | — | — | — |
| `z-index` | — | — | — | — |

### B2. CSS custom properties (screen root, bot path)

| Variable | Winning value | Source | Notes |
|----------|---------------|--------|-------|
| `--tray-height` | `132px` (default); `112px` at ≤760px | v3 block · 2341; media · 2633 | Used by `.wl-hand-area` rule at 1950 when **not** fully overridden by deck child |
| `--match-hud-min-height` | `82px` (84px short) | v3 · 2342; media · 2326 | HUD, not deck |
| `--match-score-size` | clamp | v3 · 2343 | HUD |
| `--match-counter-value-size` | clamp | v3 · 2344 / 2540 | Meta bar |

### B3. On `.rh-live-hand-deck .wl-hand-area` (child strip)

| Property | Winner | Source | Notes |
|----------|--------|--------|-------|
| `height` | `100%` | v3 · 2558 (later) | Beats bot `.wl-hand-area` fixed tray height for this subtree |
| `display` | `flex` | v3 · 2559 | |
| `align-items` | `center` | v3 · 2560 | |
| `margin/padding/border/background/box-shadow` | stripped | v2 · 2296–2306 (still applies where v3 silent) | Higher specificity than bot `.wl-hand-area` chrome at 1950 |
| `::before` | `content: none` | v2 · 2309–2311 | Kills bot hand-area top line pseudo |

### B4. Layering vs `board-hand-dock.css` (Patch 33)

Generic `.wl-hand-area .tray-center` / `.hand-container` / `.hand-row` live in **`board-hand-dock.css`**.

Bot-scoped rules at **2563+** (specificity 0,5,0+) **override** generic (0,2,0) for:

- `.rh-live-hand-deck .tray-center`
- `.rh-live-hand-deck .hand-container` (+ scroll / single-row)
- `.wl-hand-area .tray-rail` / `.hand-row` (0,4,0 bot selectors)

**Winner for inner layout on bot deck path:** `board-hand-dock.css` base + **walnut v3 bot overrides**.

---

## C. Route impact

| Route | Uses `.rh-live-hand-deck`? | Active deck CSS | Notes |
|-------|---------------------------|-----------------|-------|
| **Daily Fritz** | **Yes** — `InGameBoardFrame` | v3 + v2 residue + bot child overrides | DF adds `border-top-color` on `.wl-hand-area` only (`dailyFritzMatchBoard.css`) |
| **Play vs Fritz** | **Yes** | Same | |
| **Ghost / bot** | **Yes** | Same | |
| **Learn / Guided** | **Class on node** (`rh-live-hand-deck learn-guided-live-hand-deck`) but **bot `:not(.learn-lesson-screen)` rules do not apply** | `learnGuidedMatch.css` `.learn-guided-live-hand-deck` | Lesson screen has `.learn-lesson-screen` |
| **Daily Puzzle** | **No** | `InGameBoardShell` hand → `.hand-area.wl-hand-area` only | No `InGameBoardFrame` deck wrapper |
| **Practice / NBL** | **No** | `.nbl-tray` / `.nbl-hand-row` | Separate practice DOM |
| **Multiplayer (`App.tsx`)** | **No** | Direct `.wl-hand-area` | |

---

## D. Relationship to `.wl-hand-area` and inner tray

### DOM hierarchy (bot / DF / PvF)

```
.rh-live-studio-shell          ← board-shell.css (column flex)
  .rh-live-board-zone
    … board …
  .rh-live-hand-deck           ← deck shell (walnut v3 + v2 overflow/min-height)
    .hand-area.wl-hand-area    ← tray chrome stripped inside deck; bot chrome outside deck
      .tray-rail
        .tray-center
          .hand-container
            .hand-row
              .guided-tile-wrap? / .domino-tile
```

### Ownership by concern

| Concern | Owner today |
|---------|-------------|
| **Outer dock placement** (studio column, flex shrink) | `board-shell.css` (`.rh-live-studio-shell`); deck `flex: 0 0 142px` |
| **Deck shell visual chrome** | v3 `.rh-live-hand-deck` (background, shadow, radius) |
| **Tray visual chrome** (when not inside deck reset) | Generic `.wl-hand-area` (435) + bot `.wl-hand-area` (1950–1977) — **stripped inside deck** by `.rh-live-hand-deck .wl-hand-area` |
| **Inner tray layout** | **`board-hand-dock.css`** + bot v3 overrides (2563–2629) |
| **Tile row packing** | `board-hand-dock.css` `.hand-row` + bot `gap: clamp` |
| **Scrolling** | `board-hand-dock.css` `.is-scrollable` + bot deck-scoped scroll overrides + `game-interactions.css` overflow visible |
| **Tile visuals / interaction** | `walnut-live`, `game-interactions.css`, `rh-glow-underline.css` |

---

## E. Structure vs skin split (future `board-hand-dock.css`)

### Move later to `board-hand-dock.css`

| Candidate | From | Why |
|-----------|------|-----|
| Deck `position`, `flex`, `display`, `min-height`, `overflow` | Consolidated v3 + v2 residue | Pure structure |
| `@media` `flex-basis` 116px / `--tray-height` 112px | v3 media 2631–2638 | Responsive structure |
| `.rh-live-hand-deck .wl-hand-area` height/flex strip | 2557–2561 (+ v2 2296 fields v3 omits) | Child layout |
| `.rh-live-hand-deck .tray-center` / `.hand-container` / scroll | 2563–2583 | Already overrides Patch 33 — belongs with deck namespace |
| `.wl-hand-area .tray-rail` transparent flex strip | 2615–2624 | Structure reset on bot path |
| `.wl-hand-area .hand-row` gap clamp | 2626–2629 | Structure |

### Leave in legacy / skin (for now)

| Item | Location |
|------|----------|
| Deck `background`, `box-shadow`, `border-radius`, inset border | v3 2548–2554 |
| Bot `.wl-hand-area` chrome (1950–1977) | Applies when tray **not** under deck reset |
| DF `border-top-color` | `dailyFritzMatchBoard.css` |
| `has-single-row` / `guided-tile-wrap` geometry tied to glow | v3 2586–2613 — coordinate with `board-interactions.css` |
| Learn `.learn-guided-live-hand-deck` | `learnGuidedMatch.css` |
| Generic `.wl-hand-area` (435–461) | Until shell split planned |

### Defer

- Tile visuals, selected/playable, glow
- Practice NBL tray
- `__header` typography (or delete if stale confirmed)

---

## F. Stale deletion candidates (do not delete in Patch 34)

### F1. Fully superseded — safe to delete **after** merging survivors into v3

| Block | Lines | Proof |
|-------|-------|-------|
| **v2 deck shell** | 2253–2269 | v3 wins all overlaps; grid dead — **preserve** `min-height: 0` + `overflow: hidden` on v3 first |
| **v2 `__header` trio** | 2271–2294 | **Zero** TSX/HTML references |
| **v2 media `flex-basis: 142px`** | 2329–2331 | Redundant with v3 `flex: 0 0 142px`; short height covered by 2636 |

### F2. Partially superseded — do not delete whole block yet

| Block | Lines | Keep because |
|-------|-------|--------------|
| v2 `.rh-live-hand-deck .wl-hand-area` | 2296–2311 | v3 child block shorter — v2 still supplies strip props v3 omits until merged |
| v2 tray-rail chrome | 2313–2317 | Superseded by 2615–2624 — delete **with** v2 cleanup after visual check |

### F3. Active — do not delete

| Block | Lines |
|-------|-------|
| v3 deck shell | 2543–2555 (+ merge min-height/overflow) |
| v3 child + tray overrides | 2557–2629 |
| v3 media | 2631–2638 |

### F4. Proof required before deletion

1. **Screenshot** bot match deck (DF + PvF) before/after v2 removal  
2. **Confirm** no product plan to restore left-column “YOUR HAND” header grid  
3. **Grep** `rh-live-hand-deck__header` stays zero in `client/src`  
4. **Short-height** check: `flex-basis: 116px` still from v3 media only  

---

## G. Recommended Patch 35

**Recommended: browser proof first, then stale-only CSS cleanup in `walnut-live.css` — not deck migration to `board-hand-dock.css` yet.**

| Step | Action | Risk |
|------|--------|------|
| 1 | Capture baseline screenshots (bot DF, PvF, narrow, short) | — |
| 2 | Add `min-height: 0` + `overflow: hidden` to **v3 deck rule** (2543–2555) | Low |
| 3 | **Delete** v2 deck block (2253–2269) | Low if step 2 done |
| 4 | **Delete** `__header` blocks (2271–2294) | Low (no DOM) |
| 5 | **Delete** redundant v2 media flex-basis 142px (2329–2331) | Low |
| 6 | **Delete** superseded v2 tray-rail chrome (2313–2317) if v3 strip confirmed | Low–medium |
| 7 | Optionally merge v2 `.wl-hand-area` strip into v3 child rule, then delete 2296–2311 duplicate | Medium — test strip/`::before` |

**Do not in Patch 35:**

- Move v3 deck shell to `board-hand-dock.css` (wait until single consolidated rule exists)
- Touch Learn guided deck
- Touch `has-single-row` / guided-wrap blocks

**Alternative (more conservative Patch 35):** Browser proof + doc update only; defer deletion to Patch 36.

**Not recommended yet:** Audit `.wl-hand-area` global shell (435) — higher blast radius than deleting dead v2 deck.

---

## H. Exact proposed Patch 35 (implementation spec — if approved)

### Files to edit

| File | Action |
|------|--------|
| `client/src/styles/walnut-live.css` | Merge + delete stale blocks only |
| `docs/neutral-board-surface-bridge-checkpoint.md` | Optional one-line note |

**Do not edit:** `board-hand-dock.css`, components, `learnGuidedMatch.css`, `dailyFritzMatchBoard.css`, `botMatch.css`

### 1. Extend v3 deck rule (2543–2555) — add from v2 before delete

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck {
  position: relative;
  flex: 0 0 142px;
  min-height: 0;        /* ← from v2 */
  display: block;
  overflow: hidden;     /* ← from v2 */
  padding: 12px 20px 16px;
  /* … rest unchanged … */
}
```

### 2. Delete blocks

- Lines **2253–2269** (v2 deck)
- Lines **2271–2294** (`__header`)
- Lines **2313–2317** (v2 tray-rail chrome) — optional after visual confirm
- Lines **2329–2331** (v2 media flex-basis 142px only)

### 3. Leave unchanged

- v3 deck visual declarations (2550–2554)
- v3 child blocks 2557–2629
- v3 media 2631–2638
- v2 `.rh-live-hand-deck .wl-hand-area` (2296–2311) until Patch 36 merge into 2557–2561

### Verification searches

```bash
rg 'rh-live-hand-deck__header' client/src
rg 'display: grid' client/src/styles/walnut-live.css | rg hand-deck
rg 'flex: 0 0 178px' client/src
rg '\.rh-live-hand-deck' client/src/styles/walnut-live.css
npm run build --prefix client
```

### Build

```bash
npm run build --prefix client
```

---

## I. Browser verification checklist

- [ ] Daily Fritz — deck height, radius, shadow, DF top border on hand area
- [ ] Play vs Fritz — same
- [ ] Ghost / bot — same
- [ ] Learn / Guided — **unchanged** (lesson uses `learn-guided-live-hand-deck`)
- [ ] Daily Puzzle — **unchanged** (no deck wrapper)
- [ ] Practice — **unchanged**
- [ ] Narrow viewport
- [ ] Short height (≤760px) — deck `flex-basis: 116px`, tray not clipped
- [ ] Long hand / scrollable class if applicable
- [ ] Playable underline not clipped under deck
- [ ] No phantom left column where `__header` grid was planned

---

## J. Patch series after 35

| Patch | Topic |
|-------|--------|
| **35** | Stale v2 + `__header` deletion (with v3 merge) |
| **36** | Merge `.rh-live-hand-deck .wl-hand-area` v2→v3; delete duplicate child strip |
| **37** | Move consolidated **structure-only** `.rh-live-hand-deck` + bot child layout overrides to `board-hand-dock.css`; leave skin in legacy |
| **38** | Plan `.wl-hand-area` shell/chrome split |

---

## References

- `docs/board-hand-dock-ownership-audit.md`
- `client/src/match/board/InGameBoardFrame.tsx`
- `client/src/styles/walnut-live.css` (lines cited above reflect post–Patch 33 file)
