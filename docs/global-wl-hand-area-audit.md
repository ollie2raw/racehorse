# Global Bot-Match `.wl-hand-area` Block Audit

**Patch:** 40 (planning / audit only — no implementation)  
**Date:** 2026-05-28  
**Goal:** Determine whether the global bot-match `.wl-hand-area` block (~1950–1990 in `walnut-live.css`) is dead, overridden inside `.rh-live-hand-deck`, or still required on any runtime path  
**Mode:** Planning only — do not edit CSS, move selectors, or delete rules yet  

**Related:** Patches 35–39 (deck shell + child merge), `docs/rh-live-hand-deck-child-merge-plan.md`, `docs/rh-live-hand-deck-shell-migration-plan.md`

---

## Executive summary

| Finding | Detail |
|---------|--------|
| **Global block** | Four rules at `walnut-live.css` **~1950–1990**: `.wl-hand-area`, `::before`, `.tray-rail`, `.hand-row` |
| **Scope** | `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen)` only |
| **Active bot-match DOM** | Every non-lesson `.wl-hand-area` is **inside** `.rh-live-hand-deck` (`InGameBoardFrame` + `handTray`) |
| **Verdict** | For **studio bot routes** (Daily Fritz, PvF, ghost), the global block is **fully dead** for all declarations it sets — superseded by higher-specificity deck child rules and later v3 tray rules |
| **Learn** | Excluded by `:not(.learn-lesson-screen)` — uses `learnGuidedMatch.css` |
| **Other routes** | Daily Puzzle, multiplayer (`App.tsx`), Practice — **do not match** the bot-match selector |
| **Recommended Patch 41** | **Delete** rules ~1950–1990 after `rg`/browser proof — or **comment-only** first if conservative |
| **Do not** | Delete `.rh-live-hand-deck .wl-hand-area` child reset or `::before { content: none }` |

---

## A. Global bot-match `.wl-hand-area` rules

All rules live in **`client/src/styles/walnut-live.css`**, in the pre–v3 bot-match HUD/tray section (after `.wl-controls-tray button`, before `.domino-body` tile skin ~1992).

**Targeting:** Bot match only, excluding Learn lessons — **not** all walnut-live screens.

| # | Lines | Selector | Classification |
|---|-------|----------|----------------|
| 1 | 1950–1965 | `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-hand-area` | Global tray **shell chrome** (pre–deck era) |
| 2 | 1967–1977 | `… .wl-hand-area::before` | **Pseudo chrome** (hairline) |
| 3 | 1979–1986 | `… .wl-hand-area .tray-rail` | Tray-rail **skin** (superseded by v3 ~2555) |
| 4 | 1988–1990 | `… .wl-hand-area .hand-row` | Row **gap** (superseded by v3 ~2566) |

### A1. Rule 1 — `.wl-hand-area` shell

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-hand-area {
  height: var(--tray-height, 154px);
  min-height: var(--tray-height, 154px);
  max-height: var(--tray-height, 154px);
  flex-basis: var(--tray-height, 154px);
  margin: -2px 0 0 !important;
  padding: 12px 22px 18px;
  border-radius: 28px 28px 0 0;
  border: 1px solid rgba(88, 166, 255, 0.24) !important;
  border-bottom: 0 !important;
  background: #050b15 !important;
  box-shadow:
    0 -22px 64px rgba(0, 0, 0, 0.52),
    0 -1px 0 rgba(231, 182, 74, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.055) !important;
}
```

**Context:** Legacy “standalone tray” styling from before `.rh-live-hand-deck` owned the outer frame. `--tray-height` defaults to `132px` on screen (~2271) / `112px` short-height media (~2573).

### A2. Rule 2 — `::before` hairline

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-hand-area::before {
  content: '';
  position: absolute;
  left: 24px;
  right: 24px;
  top: 12px;
  height: 1px;
  background: rgba(88, 166, 255, 0.24);
  box-shadow: 0 0 28px rgba(88, 166, 255, 0.22);
  pointer-events: none;
}
```

**Context:** Decorative top line on the old standalone tray. **Suppressed inside deck** by Patch 37 rule ~2499–2501.

### A3. Rule 3 — `.tray-rail` chrome

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-hand-area .tray-rail {
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.045);
  background: rgba(2, 6, 13, 0.58);
  box-shadow:
    inset 0 14px 34px rgba(0, 0, 0, 0.36),
    inset 0 0 0 1px rgba(88, 166, 255, 0.05);
}
```

**Context:** Superseded for bot studio by v3 strip ~2555–2564 (transparent rail, no inset shadow).

### A4. Rule 4 — `.hand-row` gap

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .wl-hand-area .hand-row {
  gap: clamp(12px, 1.45vw, 24px);
}
```

**Context:** Superseded by v3 ~2566–2569 (`clamp(10px, 1.3vw, 22px)` — later in file wins).

### A5. Other files inspected

| File | Matching global bot `.wl-hand-area` shell? |
|------|---------------------------------------------|
| `board-hand-dock.css` | No — inner tray + deck shell structure only |
| `botMatch.css` | No `.wl-hand-area` shell (scroll/tile rules only) |
| `learnGuidedMatch.css` | `.learn-guided-live-hand-deck .wl-hand-area` — separate Learn path |
| `dailyFritzMatchBoard.css` | `border-top-color` accent on `.wl-hand-area` only (~181–184) — **inactive inside deck** (child sets `border: 0 !important`) |

---

## B. Runtime consumers

### B1. DOM hierarchy reference

**Studio bot path (canonical):**

```
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen)
  └── .walnut-match-layout (InGameBoardShell match/board)
        └── .rh-live-studio-shell (InGameBoardFrame)
              ├── .rh-live-board-zone → board stage
              └── .rh-live-hand-deck
                    └── .hand-area.wl-hand-area  ← handTray
                          └── .tray-rail → .tray-center → .hand-container → .hand-row
```

**Emitters:**

| Path | File | Notes |
|------|------|--------|
| Hand tray content | `BotMatchScreen.tsx` ~6625–6628 | `className="hand-area wl-hand-area"` |
| Deck wrapper | `match/board/InGameBoardFrame.tsx` ~29–35 | `rh-live-hand-deck` wraps `handDock` |
| Layout shell | `match/board/InGameBoardShell.tsx` | `topHud` + `children` only — **does not** emit `.wl-hand-area` |
| Active match UI | `BotMatchScreen.tsx` ~7781–7901 | `InGameBoardShell` → `InGameBoardFrame boardStage handDock={handTray}` |

### B2. Route matrix

| Route | Screen classes | `.wl-hand-area` present? | Inside `.rh-live-hand-deck`? | Global ~1950 applies? | Effective styling |
|-------|----------------|--------------------------|------------------------------|----------------------|-------------------|
| **Daily Fritz** | `bot-match-screen` + `bot-match-mode-daily-fritz` | Yes | Yes | Matches selector but **all props overridden** | Deck shell + child reset + v3 tray rules |
| **Play vs Fritz** | `bot-match-screen` (mode varies) | Yes | Yes | Same | Same |
| **Ghost / bot** | `bot-match-screen` | Yes | Yes | Same | Same |
| **Learn / Guided** | `bot-match-screen` + **`learn-lesson-screen`** | Yes | Yes (`learn-guided-live-hand-deck`) | **Selector fails** (`:not(.learn-lesson-screen)`) | `learnGuidedMatch.css` |
| **Daily Puzzle** | `daily-puzzle-screen` `rh-standard-live-board` | Yes (`InGameBoardShell` hand) | **No** | **Selector fails** (no `bot-match-screen`) | `walnut-live` + puzzle CSS; default `hand-area wl-hand-area` outer |
| **Multiplayer** | `walnut-live` only (`App.tsx` ~5256) | Yes (~5602) | **No** | **Selector fails** | Base `.wl-hand-area` ~435 + `.screen.game-screen.walnut-live` ~1351 |
| **Practice / NBL** | Not `bot-match-screen` | **No** `.wl-hand-area` in NBL main | — | **No** | `.nbl-tray` / practice path |
| **Bot loading error** | `bot-match-screen` (~6337) | **No hand rendered** | — | N/A | No tray |

### B3. Legacy / unknown routes

| Candidate | Status |
|-----------|--------|
| `match/InGameBoardShell.tsx` (older) `handOuterClassName` default `hand-area wl-hand-area` | Used by **Daily Puzzle** / layouts with `layout` prop — **not** `bot-match-screen` |
| PvF `integratedPvfPanel` `handOuterClassName` → `rh-live-hand-deck` on **outer** tray div | **Not** used by current `BotMatchScreen` path (uses `match/board/InGameBoardFrame` instead) |
| `App.tsx` multiplayer | No `bot-match-screen` |

**Conclusion:** On `bot-match-screen:not(.learn-lesson-screen)`, there is **no live DOM** where `.wl-hand-area` exists **outside** `.rh-live-hand-deck` during normal gameplay.

---

## C. Declaration-by-declaration winner map

**Context inside deck:**  
`.screen…bot-match…:not(.learn-lesson-screen) .rh-live-hand-deck .wl-hand-area` (specificity **0,5,2**) beats  
`.screen…bot-match…:not(.learn-lesson-screen) .wl-hand-area` (**0,4,1**).

**Deck height** comes from `board-hand-dock.css` `.rh-live-hand-deck { flex: 0 0 142px }` (structure), not from global tray height on `.wl-hand-area`.

### C1. Global rule 1 — `.wl-hand-area` properties

| Property | Global value | Winner inside `.rh-live-hand-deck` | Status | Kind |
|----------|--------------|--------------------------------------|--------|------|
| `height` | `var(--tray-height)` | `100%` (child ~2485) | **Dead** | Structure |
| `min-height` | `var(--tray-height)` | `0` (child) | **Dead** | Structure |
| `max-height` | `var(--tray-height)` | `none` (child) | **Dead** | Structure |
| `flex-basis` | `var(--tray-height)` | `auto` (child) | **Dead** | Structure |
| `margin` | `-2px 0 0 !important` | `0 !important` (child) | **Dead** | Structure |
| `padding` | `12px 22px 18px` | `0` (child) | **Dead** | Visual skin |
| `border-radius` | `28px 28px 0 0` | `0` (child) | **Dead** | Visual skin |
| `border` | blue border `!important` | `0 !important` (child) | **Dead** | Visual skin |
| `background` | `#050b15 !important` | `transparent !important` (child) | **Dead** | Visual skin |
| `box-shadow` | multi-layer `!important` | `none !important` (child) | **Dead** | Visual skin |

**Still active on `.wl-hand-area` inside deck** (from other rules, not global block):

| Property | Source |
|----------|--------|
| `width` / horizontal margin reset | `.screen.game-screen.walnut-live .wl-hand-area` ~1326–1330 |
| `position`, `z-index` | `.wl-hand-area` ~435–460 |
| `display: flex`, `align-items: center` | Deck child ~2495–2496 |
| `overflow` | Base `visible` (~451) — not set by child |

### C2. Global rule 2 — `::before`

| Property | Global | Winner inside deck | Status |
|----------|--------|-------------------|--------|
| `content` | `''` | `none` (`.rh-live-hand-deck .wl-hand-area::before` ~2500) | **Dead** |
| Hairline geometry/colors | set | never paints | **Dead** |

### C3. Global rules 3–4 — descendants

| Rule | Global | Winner inside deck | Status |
|------|--------|-------------------|--------|
| `.tray-rail` border/background/shadow | ~1979 | v3 ~2555–2564 (same specificity, **later**) | **Dead** |
| `.hand-row` gap | `clamp(12px, 1.45vw, 24px)` | v3 `clamp(10px, 1.3vw, 22px)` ~2567 (**later**) | **Dead** |

### C4. `board-hand-dock.css` inner tray

Neutral `.wl-hand-area .tray-rail` / `.hand-container` / `.hand-row` apply everywhere; bot v3 overrides win where declared later in `walnut-live.css`.

### C5. Daily Fritz accent

```css
.bot-match-screen.bot-match-mode-daily-fritz .wl-hand-area {
  border-top-color: rgba(231, 182, 74, 0.14) !important;
}
```

**Inside deck:** child `border: 0 !important` wins over DF `border-top-color` (specificity 0,5,2 vs 0,2,1). **Accent is dead** on studio path today.

---

## D. Route impact of delete / narrow / gate

| Route | Delete ~1950–1990? |
|-------|---------------------|
| **Daily Fritz / PvF / ghost (studio)** | **No visual change** if child + deck + v3 rules remain |
| **Learn** | **No effect** (selector excluded) |
| **Daily Puzzle** | **No effect** (not `bot-match-screen`) |
| **Practice** | **No effect** |
| **Multiplayer** | **No effect** |
| **Hypothetical future** bot tray **without** `.rh-live-hand-deck` | Would lose standalone tray chrome — would fall back to `.walnut-live .wl-hand-area` ~435, **not** this block unless re-added |

**Risk:** Low for current codebase; medium if a future feature renders `bot-match-screen` + bare `.wl-hand-area` without the deck wrapper.

---

## E. Safe cleanup options

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **1. Comment only** | Document “dead inside `.rh-live-hand-deck`; kept for reference” | Safest zero-risk | Noise, duplicate cascade confusion |
| **2. Delete block** | Remove ~1950–1990 entirely | Cleanest ownership story | Regression if unknown route exists |
| **3. Narrow selector** | e.g. only apply when not in deck — **no pure CSS parent filter** without `:has()` gymnastics | Theoretically future-proof | Fragile; empty set today |
| **4. Move structure to board-hand-dock** | N/A — block is **visual chrome**, not neutral structure | — | Wrong layer; deck structure already migrated Patch 39 |

**Recommendation:** **Option 2 (delete)** after verification, with a one-line comment at v3 deck child section pointing to deck-owned chrome. Option 1 acceptable for one release if team wants extra browser proof before delete.

---

## F. Recommended Patch 41

**Primary:** Delete global bot-match `.wl-hand-area` rules **~1950–1990** (all four blocks) from `walnut-live.css`.

**Do not delete:**

- `.rh-live-hand-deck` shell skin (~2473–2482)
- `.rh-live-hand-deck .wl-hand-area` + `::before` (~2484–2501)
- v3 deck-scoped tray/hand rules (~2503–2569)
- `board-hand-dock.css` deck structure
- Base `.wl-hand-area` ~435 or `.screen.game-screen.walnut-live .wl-hand-area` ~1351 (other routes)

**Optional conservative Patch 41a:** Add comment-only at ~1950 without delete; **Patch 42** delete after browser pass.

**Defer:** Neutral `.wl-hand-area` base migration; Learn deck parity; DF `border-top-color` (already dead — remove in separate DF audit if desired).

---

## G. Exact proposed Patch 41 (delete path)

### G1. File to edit

- `client/src/styles/walnut-live.css` **only**

### G2. Delete these blocks (contiguous ~1950–1990)

1. `.screen…bot-match…:not(.learn-lesson-screen) .wl-hand-area { … }` (1950–1965)  
2. `… .wl-hand-area::before { … }` (1967–1977)  
3. `… .wl-hand-area .tray-rail { … }` (1979–1986)  
4. `… .wl-hand-area .hand-row { … }` (1988–1990)  

### G3. Optional add (comment at deck child, ~2484)

```css
/* Standalone bot-match .wl-hand-area tray chrome removed Patch 41; studio routes use .rh-live-hand-deck shell + child reset below. */
```

### G4. Preserve unchanged

- Everything from `.rh-live-hand-deck` shell skin downward in v3 section  
- `dailyFritzMatchBoard.css` DF accent (harmless if dead; separate cleanup optional)  
- All `board-hand-dock.css` rules  

### G5. Verification searches

```bash
rg 'bot-match-screen:not\(\.learn-lesson-screen\) \.wl-hand-area' client/src/styles/walnut-live.css
# Expected: only .rh-live-hand-deck .wl-hand-area and descendants

rg 'wl-hand-area::before' client/src/styles/walnut-live.css
# Expected: only .rh-live-hand-deck .wl-hand-area::before for bot scoped

rg 'hand-area wl-hand-area' client/src --glob '*.tsx'
# Confirm bot-match paths still use InGameBoardFrame + handTray inside deck
```

### G6. Build

```bash
npm run build --prefix client
```

---

## H. What not to touch (Patch 41)

- `.rh-live-hand-deck` shell structure (`board-hand-dock.css`) and visual skin  
- `.rh-live-hand-deck .wl-hand-area` child reset and `::before { content: none }`  
- `.rh-live-hand-deck .tray-center` / `.hand-container` / single-row geometry  
- Global `.wl-hand-area` ~435 / `.screen.game-screen.walnut-live` ~1351 (non–bot-match routes)  
- `board-hand-dock.css` inner tray  
- Tile / interaction CSS  
- Learn / Practice / Puzzle paths  
- Components / gameplay  

---

## I. Browser verification checklist

After Patch 41 (delete):

- [ ] **Daily Fritz** — deck matte frame unchanged; no hairline inside tray; rail transparent; hand row gap unchanged  
- [ ] **Play vs Fritz** — same  
- [ ] **Ghost / bot** — same  
- [ ] **Short-height** — deck 116px basis; hand fills deck  
- [ ] **Narrow width** — layout OK  
- [ ] **Long / scrollable hand** — scroll + centering OK  
- [ ] **Selected / playable underline** — not clipped  
- [ ] **Learn / Guided** — unchanged (different CSS file)  
- [ ] **Daily Puzzle** — tray unchanged (never used global block)  
- [ ] **Practice** — unchanged  

---

## Appendix: Specificity cheat sheet

| Selector | Specificity |
|----------|-------------|
| `.screen…bot-match…:not(.learn) .wl-hand-area` | 0,4,1 |
| `.screen…bot-match…:not(.learn) .rh-live-hand-deck .wl-hand-area` | 0,5,2 |
| `.screen…bot-match…:not(.learn) .wl-hand-area .tray-rail` | 0,4,2 |
| `.screen…bot-match…:not(.learn) .wl-hand-area .tray-rail` (v3 ~2555) | 0,4,2 — **later file order wins** |
| `.bot-match-mode-daily-fritz .wl-hand-area` | 0,2,1 — loses to deck child |

---

## Recommended Patch 42+

| Patch | Scope |
|-------|--------|
| **42** | Audit whether DF `border-top-color` on `.wl-hand-area` (~181–184) should be removed or retargeted to `.rh-live-hand-deck` |
| **43+** | Plan migration of deck-scoped `.rh-live-hand-deck .tray-center` / `.hand-container` layout to `board-hand-dock.css` (separate from this global block) |
