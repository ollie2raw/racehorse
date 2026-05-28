# `.rh-live-hand-deck` Shell Structure Migration Plan

**Patch:** 38 (planning / audit only — no implementation)  
**Date:** 2026-05-28  
**Goal:** Plan the first structure-only migration of the bot-match v3 `.rh-live-hand-deck` shell into `board-hand-dock.css` without visual change  
**Mode:** Planning only — do not edit CSS, move selectors, or delete rules yet  

**Related:** Patch 33 (inner tray → `board-hand-dock.css`), Patch 35–37 (deck shell + child merge in `walnut-live.css`)

---

## Executive summary

| Finding | Detail |
|---------|--------|
| **Single shell rule** | One bot-match v3 `.rh-live-hand-deck` block in `walnut-live.css` (~2473–2487) |
| **Structure vs skin** | **5 structure** props + **5 skin** props — clean split, no overlapping keys |
| **Media** | One short-height structural override: `flex-basis: 116px` (~2581–2583); `--tray-height: 112px` on screen root stays legacy |
| **Load order** | `walnut-live.css` loads **before** `styles/board/index.css` in `main.tsx` → board namespace **wins** on equal specificity if added later |
| **Learn safety** | Bot rules use `:not(.learn-lesson-screen)`; Learn uses `.learn-guided-live-hand-deck` in `learnGuidedMatch.css` — do **not** introduce bare `.rh-live-hand-deck` structure without scoping |
| **Recommended Patch 39** | Move structure + short-height `flex-basis` to `board-hand-dock.css` with **same selector**; leave skin in `walnut-live.css`; do not touch child rules |

---

## A. Current `.rh-live-hand-deck` shell rule

### A1. Canonical v3 shell

| Field | Value |
|-------|--------|
| **Source file** | `client/src/styles/walnut-live.css` |
| **Lines** | 2473–2487 |
| **Section** | `Racehorse live board v3` — immediately after `.wl-controls-tray` counter sizing (~2460–2471) |
| **Selector** | `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck` |
| **Classification** | **Bot-match v3 deck shell** (studio hand dock wrapper) |

**Full rule body:**

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck {
  position: relative;
  flex: 0 0 142px;
  min-height: 0;
  display: block;
  overflow: hidden;
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

### A2. Surrounding child / related rules (same file, v3 section)

| Lines | Selector | Role (Patch 39 scope) |
|-------|----------|------------------------|
| 2489–2502 | `.rh-live-hand-deck .wl-hand-area` | Child reset + flex center — **stay legacy** |
| 2504–2506 | `.rh-live-hand-deck .wl-hand-area::before` | Hairline suppression — **stay legacy** |
| 2508–2513 | `.rh-live-hand-deck .tray-center` | Deck-scoped inner layout — **stay legacy** (Patch 39+) |
| 2515–2558 | `.rh-live-hand-deck .hand-container` (+ scroll / single-row) | Deck-scoped layout / glow geometry — **stay legacy** |
| 2560–2574 | `.wl-hand-area .tray-rail` / `.hand-row` (bot-match scoped) | Tray strip inside deck — **stay legacy** |
| 2576–2584 | `@media (max-height: 760px)` | Screen `--tray-height` + deck `flex-basis` — **partial** (see §C) |

**Parent flex context** (`board-shell.css` ~51–58):

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-studio-shell {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  ...
}
```

The hand deck is a **column flex child** with fixed flex-basis (`142px` default, `116px` short-height).

### A3. Per-declaration kind (shell rule)

| Declaration | Kind |
|-------------|------|
| `position: relative` | **Structure** |
| `flex: 0 0 142px` | **Structure** |
| `min-height: 0` | **Structure** |
| `display: block` | **Structure** |
| `overflow: hidden` | **Structure** (layout clipping; enables deck to clip inner overflow) |
| `padding: 12px 20px 16px` | **Visual skin** (inset / frame breathing room) |
| `border-radius: 28px 28px 0 0` | **Visual skin** |
| `border: 0` | **Visual skin** (explicit zero border is part of matte frame treatment) |
| `background: rgba(5, 11, 21, 0.86)` | **Visual skin** |
| `box-shadow: …` | **Visual skin** |

---

## B. Declaration-by-declaration classification

**Active path:** `.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck`  
**Runtime:** `InGameBoardFrame` wraps `handTray` in `.rh-live-hand-deck` (`BotMatchScreen.tsx` + `InGameBoardFrame.tsx`).

| Property | Current value | Winning source | Move to `board-hand-dock.css`? | Stay in `walnut-live.css`? | Notes |
|----------|---------------|----------------|-------------------------------|---------------------------|--------|
| `position` | `relative` | Shell ~2474 | **Yes** | No | Stacking context for deck contents |
| `flex` | `0 0 142px` | Shell ~2475 | **Yes** | No | Fixed dock height in studio column |
| `min-height` | `0` | Shell ~2476 | **Yes** | No | Flex shrink participation |
| `display` | `block` | Shell ~2477 | **Yes** | No | Deck is block container; child `.wl-hand-area` is flex |
| `overflow` | `hidden` | Shell ~2478 | **Yes** | No | Structural clip; not a color effect |
| `padding` | `12px 20px 16px` | Shell ~2479 | No | **Yes** | Affects visible matte inset |
| `border-radius` | `28px 28px 0 0` | Shell ~2480 | No | **Yes** | Frame shape |
| `border` | `0` | Shell ~2481 | No | **Yes** | Frame edge treatment |
| `background` | `rgba(5, 11, 21, 0.86)` | Shell ~2482 | No | **Yes** | Matte panel fill |
| `box-shadow` | multi-layer | Shell ~2483–2486 | No | **Yes** | Depth / glow |

### B1. Ambiguous properties

| Property | Assessment |
|----------|------------|
| `padding` | Treated as **skin** for Patch 39 — changes content inset inside the visible frame; moving without skin can change perceived tile placement relative to deck edge |
| `overflow: hidden` | Treated as **structure** — required for flex column layout; pairs with child `min-height: 0` chain |
| `flex-basis` in media | **Structure** — responsive dock height |

**No property appears on both structure and skin lists** — split migration is safe if both rule blocks keep the **same selector**.

### B2. Other files — `.rh-live-hand-deck` shell

| File | Shell rules? |
|------|----------------|
| `board-hand-dock.css` | None (header comment only) |
| `botMatch.css` | None |
| `dailyFritzMatchBoard.css` | None (DF accent on `.wl-hand-area` only) |
| `learnGuidedMatch.css` | `.learn-guided-live-hand-deck` only — parallel Learn deck, not bot selector |

---

## C. Media query ownership

### C1. Short-height `@media (max-height: 760px)` — v3 block

**Location:** `walnut-live.css` ~2576–2584

```css
@media (max-height: 760px) {
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) {
    --tray-height: 112px;
  }

  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck {
    flex-basis: 116px;
  }
}
```

| Rule | Kind | Patch 39 recommendation |
|------|------|-------------------------|
| Screen `--tray-height: 112px` | **Token / legacy screen** — mostly affects global `.wl-hand-area` ~1950 (inactive inside deck) | **Stay in `walnut-live.css`** |
| `.rh-live-hand-deck { flex-basis: 116px; }` | **Structure** — overrides `flex: 0 0 142px` shorthand’s basis | **Move with shell structure** to `board-hand-dock.css` |

**Note:** `flex-basis` in media overrides only the basis component of `flex: 0 0 142px`; `flex-grow`/`flex-shrink` remain `0`.

### C2. Other media touching `.rh-live-hand-deck`

| Location | Status |
|----------|--------|
| Pre-v3 `@media` deck `flex-basis: 142px` | **Deleted** in Patch 35 |
| `learnGuidedMatch.css` `@media (max-width: 820px)` `.learn-guided-live-hand-deck` | Learn-only — **out of scope** |

### C3. Screen-level `--tray-height: 132px`

**Location:** `walnut-live.css` ~2270–2271 (v3 screen block)

Not part of the shell rule but related: sets default tray token for bot-match. **Do not move** in Patch 39; optional future token audit (Patch 40+).

---

## D. Relationship to child / chrome rules

### D1. Cascade stack (inside studio hand dock)

```
.rh-live-studio-shell          ← board-shell.css (flex column)
  └── .rh-live-hand-deck       ← shell (THIS migration: structure → board-hand-dock, skin → walnut-live)
        └── .wl-hand-area      ← child reset (walnut-live) — NOT Patch 39
              └── .tray-rail   ← board-hand-dock base + walnut-live bot overrides
                    └── .tray-center / .hand-container / .hand-row
```

### D2. If only shell **structure** moves

| Layer | Behavior |
|-------|----------|
| **Structure in `board-hand-dock.css`** | Same selector, loads after `walnut-live.css` → applies `position`, `flex`, `min-height`, `display`, `overflow` (+ media `flex-basis`) |
| **Skin in `walnut-live.css`** | Same selector, fewer properties → `padding`, `border-radius`, `border`, `background`, `box-shadow` unchanged |
| **`.rh-live-hand-deck .wl-hand-area`** | Unchanged; still strips inner tray chrome so skin applies to **deck** not inner wrapper |
| **`::before { content: none }`** | Unchanged; still suppresses global bot hairline ~1967 |
| **`board-hand-dock.css` inner tray** | Unchanged; neutral structure under `.wl-hand-area` |
| **Global `.wl-hand-area` ~1950** | Still dead inside deck (lower specificity than deck child ~2489); **do not delete** in Patch 39 |

### D3. Load order (critical)

`main.tsx` order:

1. `walnut-live.css` (line 9)  
2. … other legacy …  
3. `styles/board/index.css` (line 18) → includes `board-hand-dock.css`

**Implication:** Structure moved to `board-hand-dock.css` will apply **after** legacy skin partial rule in `walnut-live.css` for the **same selector** — no conflict because property sets are disjoint.

**Anti-pattern:** Moving skin to `board-hand-dock.css` before structure in walnut-live would let legacy structure win — avoid.

### D4. Learn DOM caveat

Learn lesson markup uses **both** classes: `rh-live-hand-deck learn-guided-live-hand-deck`.

Bot shell selector requires `:not(.learn-lesson-screen)` on the **screen** — Learn lesson screens are excluded.

**Do not** add unscoped `.rh-live-hand-deck { flex: 0 0 142px; … }` in `board-hand-dock.css` in Patch 39 — would leak into Learn where Learn-specific shell differs (`flex: 0 0 auto`, `display: grid`, etc.).

---

## E. Route impact

| Route | Uses `.rh-live-hand-deck`? | Patch 39 impact if scoped correctly |
|-------|---------------------------|-------------------------------------|
| **Daily Fritz** | Yes (`InGameBoardFrame`) | **Yes** — structure file ownership only; no visual intent change |
| **Play vs Fritz** | Yes | **Yes** |
| **Ghost / bot match** | Yes | **Yes** |
| **Learn / Guided** | DOM has class; CSS via `.learn-guided-live-hand-deck` | **No** — bot selector excluded |
| **Daily Puzzle** | No deck wrapper | **No** |
| **Practice / NBL** | `.nbl-tray` path | **No** |
| **Short-height** | `flex-basis: 116px` media | **Yes** — move structural media with shell |
| **Narrow width** | No deck-specific width media | **No** shell change |
| **Long / scrollable hand** | `.hand-container.is-scrollable` rules | **No** — not shell migration |
| **Underline / glow** | `has-single-row` / `guided-tile-wrap` | **No** |

**Daily Fritz accent:** `dailyFritzMatchBoard.css` `border-top-color` on `.wl-hand-area` still applies inside deck — unaffected.

---

## F. Recommended Patch 39

| Decision | Recommendation |
|----------|----------------|
| **Scope** | Move **structure-only** shell declarations + short-height `flex-basis` override |
| **Selector** | Keep full bot-match selector in **both** files (no neutralization yet) |
| **Skin** | Remain in `walnut-live.css` |
| **Child rules** | Do not move `.wl-hand-area` reset, `::before`, tray-center, hand-container, etc. |
| **Media** | Move **only** `.rh-live-hand-deck { flex-basis: 116px; }` — leave `--tray-height` on screen in legacy |
| **Pre-work** | Optional baseline screenshots (DF, PvF, ghost, short viewport) |
| **Defer** | Global `.wl-hand-area` ~1950 dead-code audit → Patch 40 planning |
| **Defer** | Neutral `.rh-live-hand-deck` unscoped structure → after Learn + all routes mapped |

**Risk:** Low if property split is exact and selectors unchanged.

---

## G. Exact proposed Patch 39 (if approved)

### G1. Files to edit

| File | Action |
|------|--------|
| `client/src/styles/board/board-hand-dock.css` | **Add** structure shell block + media |
| `client/src/styles/walnut-live.css` | **Remove** moved declarations from shell; **remove** moved media deck rule |

### G2. Add to `board-hand-dock.css` (after inner tray section, with comment)

```css
/* Bot-match studio hand deck shell (structure only).
   Visual skin remains in walnut-live.css. */
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck {
  position: relative;
  flex: 0 0 142px;
  min-height: 0;
  display: block;
  overflow: hidden;
}

@media (max-height: 760px) {
  .screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck {
    flex-basis: 116px;
  }
}
```

### G3. Leave in `walnut-live.css` (shell skin only)

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck {
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

### G4. Delete from `walnut-live.css`

From shell rule (~2473–2487): remove `position`, `flex`, `min-height`, `display`, `overflow` lines only.

From `@media (max-height: 760px)` (~2576–2584): remove **only** the `.rh-live-hand-deck { flex-basis: 116px; }` nested rule — keep screen `--tray-height: 112px` block.

### G5. Empty blocks?

| Block | After Patch 39 |
|-------|----------------|
| Shell rule in `walnut-live.css` | **Not empty** — 5 skin properties remain |
| Shell rule in `board-hand-dock.css` | **New** — 5 structure properties |
| Short-height media in `walnut-live.css` | **Not empty** — screen token rule remains |

### G6. Search verification

```bash
rg '\.rh-live-hand-deck' client/src/styles/board/board-hand-dock.css client/src/styles/walnut-live.css
rg 'flex: 0 0 142px' client/src/styles
rg 'flex-basis: 116px' client/src/styles
```

**Expected:**

- Structure `flex: 0 0 142px` only in `board-hand-dock.css` (bot-match selector)
- Skin `background: rgba(5, 11, 21, 0.86)` only in `walnut-live.css` shell block
- `flex-basis: 116px` for bot deck only in `board-hand-dock.css` media
- `--tray-height: 112px` still in `walnut-live.css` screen media

### G7. Build

```bash
npm run build --prefix client
```

---

## H. What not to touch (Patch 39)

- `.rh-live-hand-deck .wl-hand-area` and `::before` child rules
- `.wl-hand-area` global shell ~1950–1990 (audit deferred)
- `.rh-live-hand-deck .tray-center`, `.hand-container`, `.hand-row`, scroll / single-row / guided-wrap
- `board-hand-dock.css` existing inner tray rules (unless adding below them)
- Tile visuals, `game-interactions.css`, `rh-glow-underline.css`
- `learnGuidedMatch.css`, Practice / NBL tray
- `dailyFritzMatchBoard.css` DF accent
- `board-shell.css` studio shell (separate ownership)
- Components, gameplay
- Black matte redesign

---

## I. Browser verification checklist

Before/after Patch 39:

- [ ] **Daily Fritz** — deck height, matte frame, brass accent on hand area still visible
- [ ] **Play vs Fritz** — same deck shell geometry
- [ ] **Ghost / bot match** — same
- [ ] **Short-height** (`max-height: 760px`) — deck compresses to 116px basis; no double-shrink glitch
- [ ] **Narrow viewport** — hand row + deck width OK
- [ ] **Long / scrollable hand** — horizontal scroll unchanged
- [ ] **Selected / playable underline** — not clipped by deck `overflow: hidden`
- [ ] **Learn / Guided** — lesson deck unchanged
- [ ] **Daily Puzzle** — no `.rh-live-hand-deck`; tray OK
- [ ] **Practice / NBL** — separate tray OK

---

## Appendix: DOM reference

```tsx
// InGameBoardFrame.tsx
<div className="rh-live-hand-deck" data-ui="live-hand-deck">
  {handDock}  // typically .hand-area.wl-hand-area → tray-rail → …
</div>
```

```tsx
// BotMatchScreen.tsx (Learn lesson — excluded from bot shell CSS)
<div className="rh-live-hand-deck learn-guided-live-hand-deck" …>
```

---

## Recommended follow-up patches

| Patch | Scope |
|-------|--------|
| **39** | Structure-only shell split per §G |
| **40** | Planning audit: global bot-match `.wl-hand-area` ~1950–1990 dead vs live paths |
| **41+** | Optional deck-scoped child layout migration (tray-center / hand-container) — separate plan |
| **Future** | Neutral `.rh-live-hand-deck` structure + route skins — only after Learn/Puzzle/Practice matrix documented |
