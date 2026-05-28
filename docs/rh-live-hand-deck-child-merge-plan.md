# `.rh-live-hand-deck .wl-hand-area` Child Merge Plan

**Patch:** 36 (planning / audit only — no implementation)  
**Date:** 2026-05-28  
**Goal:** Map duplicate pre-v3 vs v3 child ownership for `.rh-live-hand-deck .wl-hand-area` before a no-visual-change merge (Patch 37)  
**Mode:** Planning only — do not edit CSS, move selectors, or delete rules yet  

**Related:** `docs/rh-live-hand-deck-reconciliation-plan.md` (Patch 34), Patch 35 (deck shell cleanup)

---

## Executive summary

| Finding | Detail |
|---------|--------|
| **Duplicate child blocks** | Pre-v3 strip at **~2253–2268** and v3 child at **~2506–2510** share the same selector |
| **Winner for overlaps** | **v3 (later)** wins `height`, and adds `display: flex` + `align-items: center` |
| **Pre-v3-only winners** | `min-height`, `max-height`, `flex-basis`, margin/padding/border/background/box-shadow resets — **v3 does not set these**; pre-v3 still applies |
| **`::before`** | Pre-v3 `content: none` **suppresses** bot-match global tray hairline (~1967); **must be preserved** in v3 before deleting pre-v3 |
| **Patch 33 interaction** | Inner tray structure lives in `board-hand-dock.css`; deck-scoped bot rules in v3 section **override** neutral structure for tray-center/hand-container/scroll |
| **Learn / Puzzle / Practice** | Unaffected by bot `:not(.learn-lesson-screen)` deck-child rules |
| **Recommended Patch 37** | Merge pre-v3-only declarations + `::before` into v3 child rule → delete pre-v3 pair → browser verify |

---

## A. Remaining `.rh-live-hand-deck .wl-hand-area` rules

### A1. Pre-v3 child strip (older / v2-era residue)

| Field | Value |
|-------|--------|
| **Source file** | `client/src/styles/walnut-live.css` |
| **Lines** | 2253–2264 |
| **Selector** | `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck .wl-hand-area` |
| **Section context** | Immediately after `.board-corner-pill:first-child` brass border tweak; **before** v3 comment block (`Racehorse live board v3`, ~2286) |
| **Classification** | **Pre-v3 / v2 child strip** — left intentionally in Patch 35 |

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
```

| Field | Value |
|-------|--------|
| **Lines** | 2266–2268 |
| **Selector** | `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck .wl-hand-area::before` |
| **Classification** | **Pre-v3 pseudo strip** |

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck .wl-hand-area::before {
  content: none;
}
```

---

### A2. V3 child rule (canonical section)

| Field | Value |
|-------|--------|
| **Source file** | `client/src/styles/walnut-live.css` |
| **Lines** | 2506–2510 |
| **Selector** | `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck .wl-hand-area` |
| **Section context** | Inside `/* ─── Racehorse live board v3 … */` block, directly after canonical v3 `.rh-live-hand-deck` shell (~2490–2504) |
| **Classification** | **v3 child layout** |

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck .wl-hand-area {
  height: 100%;
  display: flex;
  align-items: center;
}
```

**Note:** v3 section has **no** `.rh-live-hand-deck .wl-hand-area::before` rule today.

---

### A3. Related bot-match rules (not deck-scoped, but cascade into deck)

#### Global bot-match `.wl-hand-area` shell (would apply without deck child override)

| Lines | Selector | Role |
|-------|----------|------|
| 1950–1965 | `.screen…bot-match…:not(.learn-lesson-screen) .wl-hand-area` | Standalone tray chrome: `--tray-height`, border, background, shadow, padding |
| 1967–1977 | `.screen…bot-match…:not(.learn-lesson-screen) .wl-hand-area::before` | Decorative top hairline pseudo |
| 1979–1986 | `.screen…bot-match…:not(.learn-lesson-screen) .wl-hand-area .tray-rail` | Tray-rail skin (superseded later in v3 by ~2564) |
| 1988–1990 | `.screen…bot-match…:not(.learn-lesson-screen) .wl-hand-area .hand-row` | Row gap (superseded later in v3 by ~2575) |

**Specificity:** `.rh-live-hand-deck .wl-hand-area` (5 classes + 2 elements) **beats** `.wl-hand-area` (4 classes + 1 element) for the same property.

Inside `.rh-live-hand-deck`, the **1950 block is inactive** for properties set by the deck-child strip. If the deck-child strip is removed without merging, **1950 + 1967 would become active again** → visual regression (double chrome, hairline, fixed tray height).

#### V3 deck-scoped inner tray overrides (same v3 section)

| Lines | Selector | Classification |
|-------|----------|----------------|
| 2512–2517 | `.rh-live-hand-deck .tray-center` | v3 child structure |
| 2519–2524 | `.rh-live-hand-deck .hand-container` | v3 child structure |
| 2526–2532 | `.rh-live-hand-deck .hand-container.is-scrollable` | v3 scroll behavior |
| 2535–2562 | `.rh-live-hand-deck .hand-container.has-single-row` (+ descendants) | v3 single-row / glow geometry |
| 2564–2573 | `.wl-hand-area .tray-rail` (bot-match scoped, not `.rh-live-hand-deck` prefix) | v3 tray-rail strip inside bot match |
| 2575–2578 | `.wl-hand-area .hand-row` | v3 row gap |
| 2580–2588 | `@media (max-height: 760px)` `.rh-live-hand-deck` | v3 short-height deck shell |

---

### A4. Canonical v3 deck shell (reference only — Patch 37 does not edit)

| Lines | Selector | Notes |
|-------|----------|-------|
| 2490–2504 | `.rh-live-hand-deck` | Post–Patch 35: includes `min-height: 0`, `overflow: hidden`, `display: block`, visual chrome |

---

### A5. Other files inspected

| File | `.rh-live-hand-deck .wl-hand-area` | Notes |
|------|-----------------------------------|--------|
| `client/src/styles/board/board-hand-dock.css` | **None** | Owns generic `.wl-hand-area .tray-rail` etc. (structure only) |
| `client/src/bot/botMatch.css` | **None** | No deck/hand-deck selectors |
| `client/src/learn/learnGuidedMatch.css` | **Parallel pattern** on `.learn-guided-live-hand-deck .wl-hand-area` (~628–639) | Learn-owned; excluded by `:not(.learn-lesson-screen)` |
| `client/src/dailyFritz/dailyFritzMatchBoard.css` | **None** | Only `border-top-color` on `.wl-hand-area` for DF mode (~181–184) — still applies to element inside deck |

---

### A6. Runtime DOM (for selector reach)

```
.rh-live-hand-deck                    ← InGameBoardFrame hand dock wrapper
  └── .hand-area.wl-hand-area         ← handTray from BotMatchScreen (~6627)
        └── .tray-rail
              └── .tray-center
                    └── .hand-container
                          └── .hand-row → DominoTile
```

Emitter: `InGameBoardFrame.tsx`, `BotMatchScreen.tsx` (`handTray` + `<InGameBoardFrame handDock={handTray} />`).

Learn lesson path uses `rh-live-hand-deck learn-guided-live-hand-deck` with **separate** CSS file — not targeted by bot `:not(.learn-lesson-screen)` rules.

---

## B. Declaration-by-declaration winner map

**Scope:** Active path = `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen)` with `.rh-live-hand-deck` ancestor (Daily Fritz, Play vs Fritz, ghost/bot — any route using `InGameBoardFrame` + studio hand deck).

**Cascade order (simplified):**

1. Base `.walnut-live .wl-hand-area` (~435) — low specificity  
2. `.screen.game-screen.walnut-live .wl-hand-area` (~1351) — background/border skin  
3. Bot-match `.wl-hand-area` (~1950) — **loses** to deck-child for same properties  
4. Pre-v3 `.rh-live-hand-deck .wl-hand-area` (~2253) — **wins** over (3) for listed properties  
5. V3 `.rh-live-hand-deck .wl-hand-area` (~2506) — **wins** over (4) only where it redeclares  

### B1. `.rh-live-hand-deck .wl-hand-area`

| Property | Winning value | Winning source | Pre-v3 vs v3 | Kind |
|----------|---------------|----------------|--------------|------|
| `height` | `100%` | v3 ~2507 (same as pre-v3) | Tie; v3 later redundant | **Structure** |
| `min-height` | `0` | pre-v3 ~2255 | **Pre-v3 only** — v3 omits | **Structure** |
| `max-height` | `none` | pre-v3 ~2256 | **Pre-v3 only** | **Structure** |
| `flex-basis` | `auto` | pre-v3 ~2257 | **Pre-v3 only** | **Structure** |
| `margin` | `0 !important` | pre-v3 ~2258 | **Pre-v3 only** | **Structure** (cancels bot-match `-2px 0 0`) |
| `padding` | `0` | pre-v3 ~2259 | **Pre-v3 only** | **Structure** |
| `border` | `0 !important` | pre-v3 ~2260 | **Pre-v3 only** | **Visual skin strip** |
| `border-radius` | `0` | pre-v3 ~2261 | **Pre-v3 only** | **Visual skin strip** |
| `background` | `transparent !important` | pre-v3 ~2262 | **Pre-v3 only** | **Visual skin strip** |
| `box-shadow` | `none !important` | pre-v3 ~2263 | **Pre-v3 only** | **Visual skin strip** |
| `display` | `flex` | v3 ~2508 | **v3 only** | **Structure** |
| `align-items` | `center` | v3 ~2509 | **v3 only** | **Structure** |
| `width` | `100% !important` (from ~1326) | `.screen.game-screen.walnut-live .wl-hand-area` | Still applies (no deck-child override) | **Structure** |
| `position` | `relative !important` (~435) | `.walnut-live .wl-hand-area` | Still applies | **Structure** |
| `z-index` | `2` (~88 stack) / `5` (~435) | Global walnut | Still applies | **Structure** |
| `overflow` | `visible` (~435) | Base `.wl-hand-area` | Not overridden by deck-child | **Structure** |

**If pre-v3 block deleted without merge:** bot-match ~1950 restores `height/min-height/max-height/flex-basis` to `--tray-height`, padding, border, background, shadow — **regression**.

### B2. `.rh-live-hand-deck .wl-hand-area::before`

| Property | Winning value | Winning source | Notes | Kind |
|----------|---------------|----------------|-------|------|
| `content` | `none` | pre-v3 ~2267 | Suppresses bot-match ~1968 `content: ''` | **Pseudo visual kill** |
| (all other pseudo props) | — | inactive | Hairline from ~1967 never paints | — |

**If pre-v3 `::before` deleted without merge:** bot-match hairline pseudo **returns** inside deck — **regression**.

### B3. Related child selectors (tray chrome / placement)

| Target | Winning block | vs `board-hand-dock.css` | vs bot-match ~1979 |
|--------|---------------|--------------------------|-------------------|
| `.tray-rail` | v3 ~2564–2573 (bot-match scoped) | Overrides neutral structure (border 0, transparent) | v3 later → wins |
| `.tray-center` | v3 ~2512–2517 (deck-scoped) | Higher specificity than `.wl-hand-area .tray-center` | Deck-scoped wins |
| `.hand-container` | v3 ~2519+ | Overrides width/justify from dock base | Deck-scoped wins |
| `.hand-container.is-scrollable` | v3 ~2526–2532 | Overrides dock `justify-content: flex-start` / width 100% | Deck-scoped wins |
| `.hand-row` gap | v3 ~2575–2578 | Overrides dock `gap: 6px` | v3 later than ~1988 |

**Patch 37 scope:** Only merge/delete **pre-v3 `.rh-live-hand-deck .wl-hand-area` (+ `::before`)** pair — not v3 tray-center/hand-container blocks.

---

## C. Relationship to Patch 33 (`board-hand-dock.css`)

Patch 33 moved **structure-only** inner tray rules to:

```css
.wl-hand-area .tray-rail       /* grid columns, gap, align */
.wl-hand-area .tray-center     /* flex center, padding, overflow visible */
.wl-hand-area .hand-container  /* flex, height, overflow visible */
.wl-hand-area .hand-row        /* flex, gap 6px */
.wl-hand-area .hand-container.is-scrollable  /* scroll + safe center */
.wl-hand-area .hand-container:not(.is-scrollable)
```

**Load order:** `board-hand-dock.css` is imported via `client/src/styles/board/index.css` in `main.tsx` **before** legacy globals including `walnut-live.css` (typical pattern: later legacy wins).

**Interaction with deck-child strip:**

| Layer | What it does |
|-------|----------------|
| `board-hand-dock.css` | Default flex/grid packing for any `.wl-hand-area` tray |
| Pre-v3 + v3 deck child | Strip **outer** `.wl-hand-area` chrome so deck shell (~2490) owns visual frame; set `height: 100%` to fill deck |
| v3 `.rh-live-hand-deck .tray-center` / `.hand-container` / `.is-scrollable` | Bot-studio **layout tuning** on top of dock base (centering, scroll width, single-row glow geometry) |
| v3 `.wl-hand-area .tray-rail` | Removes rail chrome so tiles read against deck interior |

**Do not move** deck-child strip to `board-hand-dock.css` in Patch 37 — it is bot-match + deck-context specific, not neutral shared structure.

---

## D. Route impact

| Route | Uses `.rh-live-hand-deck`? | Affected by duplicate child rules? | Notes |
|-------|---------------------------|-------------------------------------|-------|
| **Daily Fritz** | Yes (`InGameBoardFrame`) | **Yes** | `bot-match-screen` + `:not(.learn-lesson-screen)`; DF adds brass `border-top-color` on `.wl-hand-area` via `dailyFritzMatchBoard.css` |
| **Play vs Fritz** | Yes | **Yes** | Same studio shell path |
| **Ghost / bot match** | Yes | **Yes** | Same |
| **Learn / Guided** | Yes (DOM) but **different CSS** | **No** (these rules) | `learn-lesson-screen` excludes bot block; `learnGuidedMatch.css` owns `.learn-guided-live-hand-deck .wl-hand-area` |
| **Daily Puzzle** | **No** | **No** | `InGameBoardShell` — `.wl-hand-area` only, no deck wrapper |
| **Practice / NBL** | **No** | **No** | `.nbl-tray` / `.nbl-hand-row` path |

---

## E. Cleanup recommendation (Patch 37)

| Option | Recommendation |
|--------|----------------|
| Delete pre-v3 child if fully superseded | **No** — not fully superseded; v3 only covers 3 of 11 properties |
| Merge pre-v3 into v3, then delete pre-v3 | **Yes — preferred** |
| Leave `::before` for later | **No** — must merge `content: none` into v3 (new rule or combined) |
| Delete `::before` without merge | **Unsafe** — bot-match hairline returns |
| Do nothing until browser proof | Valid if Patch 37 blocked; baseline screenshots recommended before edit |

**Risk level:** Low **if** merged declaration set is exact; medium if any pre-v3 line omitted.

**Do not** in Patch 37:

- Edit `.rh-live-hand-deck` shell block (unless reporting only)
- Touch `board-hand-dock.css`, components, Learn CSS, Practice tray, tile/interaction CSS
- Remove bot-match global ~1950 block (still needed for non-deck paths if any exist — verify none in studio routes)

---

## F. Exact proposed Patch 37 (if approved)

### F1. File to edit

- `client/src/styles/walnut-live.css` **only**

### F2. Expand v3 child rule (~2506–2510)

Replace v3 block body with **union** of pre-v3 + v3 (no value changes):

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
  display: flex;
  align-items: center;
}
```

### F3. Add v3 pseudo rule (immediately after F2 block)

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck .wl-hand-area::before {
  content: none;
}
```

### F4. Delete pre-v3 blocks

| Lines (current) | Content |
|-----------------|---------|
| 2253–2264 | Pre-v3 `.rh-live-hand-deck .wl-hand-area` |
| 2266–2268 | Pre-v3 `.rh-live-hand-deck .wl-hand-area::before` |

### F5. Leave behind (unchanged)

- Canonical v3 `.rh-live-hand-deck` shell (~2490–2504)
- All v3 `.rh-live-hand-deck .tray-center` / `.hand-container` / single-row / scroll rules
- v3 `.wl-hand-area .tray-rail` and `.hand-row` (~2564–2578)
- Bot-match global `.wl-hand-area` ~1950–1990 (inactive inside deck but harmless; separate cleanup optional later)
- `board-hand-dock.css`, Learn, Practice, components

### F6. Search verification (post-edit)

```bash
rg '\.rh-live-hand-deck \.wl-hand-area' client/src/styles/walnut-live.css
rg 'rh-live-hand-deck \.wl-hand-area::before' client/src/styles/walnut-live.css
rg 'rh-live-hand-deck__header' client/src
```

**Expected:**

- One `.rh-live-hand-deck .wl-hand-area` rule in v3 section  
- One `::before` rule adjacent in v3 section  
- Zero pre-v3 duplicate blocks  
- `__header` still zero in `client/src`

### F7. Build

```bash
npm run build --prefix client
```

---

## G. What not to touch

- `.rh-live-hand-deck` shell rule (report-only unless future patch)
- `client/src/styles/board/board-hand-dock.css`
- Global `.wl-hand-area` chrome outside `.rh-live-hand-deck` child context (~435, ~1351, ~1950) — defer separate audit
- Tile visuals, selected/playable/hover/disabled
- `game-interactions.css`, `rh-glow-underline.css`
- `learnGuidedMatch.css` / Learn lesson DOM
- Practice / NBL tray (`noBrainerLab.css`)
- Components, gameplay logic
- Black matte redesign

---

## H. Browser verification checklist

Before Patch 37 (optional baseline) and after Patch 37 (required):

- [ ] **Daily Fritz** active match — hand dock fills deck; no double border/shadow on `.wl-hand-area`; no blue hairline inside deck
- [ ] **Play vs Fritz** active match — same
- [ ] **Ghost / bot match** — same
- [ ] **Short-height viewport** (`max-height: 760px`) — deck `flex-basis: 116px`; hand still vertically centered
- [ ] **Narrow viewport** — tray layout intact
- [ ] **Long / scrollable hand** — horizontal scroll; `is-scrollable` centering unchanged
- [ ] **Selected / playable underline** — not clipped (`has-single-row` / `guided-tile-wrap` overflow visible)
- [ ] **Learn / Guided** smoke — lesson deck unchanged (separate CSS)
- [ ] **Daily Puzzle** smoke — no `.rh-live-hand-deck`; tray unchanged
- [ ] **Practice / NBL** smoke — separate tray path unchanged

---

## Appendix: Specificity reference

| Selector | Approx. specificity |
|----------|---------------------|
| `.walnut-live .wl-hand-area` | 0,2,1 |
| `.screen.game-screen.walnut-live .wl-hand-area` | 0,3,1 |
| `.screen…bot-match…:not(.learn-lesson-screen) .wl-hand-area` | 0,4,1 |
| `.screen…bot-match…:not(.learn-lesson-screen) .rh-live-hand-deck .wl-hand-area` | 0,5,2 |
| `.screen…bot-match…:not(.learn-lesson-screen) .rh-live-hand-deck .tray-center` | 0,5,2 |
| `.wl-hand-area .tray-rail` (`board-hand-dock.css`) | 0,2,1 |

Later rule wins at **equal** specificity.

---

## Recommended next patches

| Patch | Scope |
|-------|--------|
| **37** | Merge + delete duplicate `.rh-live-hand-deck .wl-hand-area` (+ `::before`) per §F |
| **38+** | Audit whether bot-match global `.wl-hand-area` ~1950 is dead for all studio routes; consider structure-only migration of consolidated deck shell to `board-hand-dock.css` (visual skin stays legacy) |
