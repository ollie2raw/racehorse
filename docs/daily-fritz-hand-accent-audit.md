# Daily Fritz `.wl-hand-area` Hand Accent Audit

**Patch:** 42 (planning / audit only — no implementation)  
**Date:** 2026-05-28  
**Goal:** Determine whether the Daily Fritz `border-top-color` accent on `.wl-hand-area` is dead inside the active `.rh-live-hand-deck` studio path, and whether it should be deleted, retargeted, or deferred  
**Mode:** Planning only — do not edit CSS, move selectors, or delete rules yet  

**Related:** Patch 40 (`docs/global-wl-hand-area-audit.md`), Patch 41 (global bot `.wl-hand-area` delete)

---

## Executive summary

| Finding | Detail |
|---------|--------|
| **Rule under review** | `dailyFritzMatchBoard.css` **~181–184** — `border-top-color` on `.hand-area` / `.wl-hand-area` |
| **Matches DOM?** | **Yes** — Daily Fritz uses same `hand-area wl-hand-area` inside `.rh-live-hand-deck` |
| **Wins cascade?** | **No** — loses to `.rh-live-hand-deck .wl-hand-area { border: 0 !important; }` (~2449) |
| **Visible brass from this rule?** | **No** — zero border width on inner hand wrapper; accent cannot paint |
| **Visible DF brass today** | HUD pills, race track, turn label, board frame, score header — **not** this hand rule |
| **Recommended Patch 43** | **Delete** lines 181–184 (Option 1) — aligns with user preference; defer retarget to final skin pass |

---

## A. Daily Fritz `.wl-hand-area` accent rules

### A1. Hand dock accent (only hand-targeted rule in file)

| Field | Value |
|-------|--------|
| **Source file** | `client/src/dailyFritz/dailyFritzMatchBoard.css` |
| **Lines** | 181–184 |
| **Section** | End of **Pass B: play mat + watermark** (after watermark opacity rules) |
| **Targets** | `.hand-area` and `.wl-hand-area` (same element carries both classes) |
| **Not targeted** | `.rh-live-hand-deck` |

**Full rule body:**

```css
.bot-match-screen.bot-match-mode-daily-fritz .hand-area,
.bot-match-screen.bot-match-mode-daily-fritz .wl-hand-area {
  border-top-color: rgba(231, 182, 74, 0.14) !important;
}
```

**Intent (historical):** Subtle brass/gold top edge on the hand tray during Daily Fritz, from the pre–deck-shell era when `.wl-hand-area` was the outer tray chrome.

### A2. Other Daily Fritz rules (context — not hand dock accent)

These provide **live** brass/gold mode identity elsewhere; listed so Patch 43 does not confuse them with the dead hand rule:

| Lines (approx) | Selector focus | Live brass? |
|----------------|----------------|-------------|
| 15–19 | `.df-match-score-header-wrap .wl-score-header` | Yes — `border-bottom` brass |
| 31–33 | `.bot-top-rail` | Yes — `border-bottom-color` |
| 35–42 | `.wl-turn-label.your-turn` | Yes |
| 137–157 | `.nbl-board-frame` / `::after` | Yes — play mat frame |
| 51–66 | HUD pills (frosted glass) | Yes — white/glass, not hand tray |

**Import:** `BotMatchScreen.tsx` line 113 imports `dailyFritzMatchBoard.css` for all bot-match modes when that screen mounts; rules are gated by `.bot-match-mode-daily-fritz` on the screen root.

---

## B. Runtime DOM path — Daily Fritz hand dock

### B1. Screen / route classes

From `BotMatchScreen.tsx` ~7068:

```html
<div class="screen game-screen walnut-live theme-green bot-match-screen bot-match-mode-daily-fritz [df-board-has-play]">
```

- `mode === 'daily-fritz'` → `bot-match-mode-daily-fritz`
- Non-lesson active match uses `InGameBoardShell` → `InGameBoardFrame` (not lesson layout)

### B2. Hand dock hierarchy (canonical studio path)

```
.screen.bot-match-screen.bot-match-mode-daily-fritz
  └── .walnut-match-layout
        └── .rh-live-studio-shell                    (InGameBoardFrame)
              ├── .rh-live-board-zone → board stage
              └── .rh-live-hand-deck                 (deck shell — skin in walnut-live.css)
                    └── .hand-area.wl-hand-area      (handTray, BotMatchScreen ~6627)
                          └── .tray-rail
                                └── .tray-center
                                      └── .hand-container
                                            └── .hand-row → tiles
```

### B3. Emitters

| Piece | File | Notes |
|-------|------|--------|
| `handTray` | `BotMatchScreen.tsx` ~6625–6628 | `className="hand-area wl-hand-area"` |
| Deck wrapper | `match/board/InGameBoardFrame.tsx` ~29–35 | `.rh-live-hand-deck` wraps `handDock` |
| Match shell | `match/board/InGameBoardShell.tsx` | Layout wrapper only |
| Daily Fritz entry | `DailyFritzScreen.tsx` → `BotMatchScreen` `mode="daily-fritz"` | Same hand DOM as PvF/ghost |

**No alternate Daily Fritz hand path** in `client/src/dailyFritz/*.tsx` that omits `.rh-live-hand-deck`.

---

## C. Cascade / winner analysis

### C1. Does the Daily Fritz rule match?

**Yes.** Element has `.wl-hand-area` (and `.hand-area`) under `.bot-match-screen.bot-match-mode-daily-fritz`.

Selector specificity: **0,3,1** (`.bot-match-screen` + `.bot-match-mode-daily-fritz` + `.wl-hand-area`).

### C2. Does it win?

**No** for border painting on the active studio path.

**Winning rule** (`walnut-live.css` ~2442–2449):

```css
.screen.game-screen.walnut-live.bot-match-screen:not(.learn-lesson-screen) .rh-live-hand-deck .wl-hand-area {
  /* … */
  border: 0 !important;
  /* … */
}
```

Specificity: **0,5,2** — strictly higher than the DF rule.

### C3. Why `border-top-color` cannot show

| Mechanism | Effect |
|-----------|--------|
| `border: 0 !important` on child | Sets **border-width** to 0 on all sides |
| `border-top-color` only (DF rule) | Sets color for top border **without** restoring width |
| CSS painting | No border width → **no visible border**, regardless of `border-top-color` |

The DF `!important` on `border-top-color` does **not** beat `border: 0 !important` on the shorthand — different properties, but shorthand already zeroed width.

### C4. Declaration-level status (DF hand rule)

| Declaration | DF rule sets | Effective on `.rh-live-hand-deck .wl-hand-area` | Status |
|-------------|--------------|--------------------------------------------------|--------|
| `border-top-color` | `rgba(231, 182, 74, 0.14) !important` | Overridden by `border: 0 !important` (no width) | **Dead / non-participating** |

### C5. What owns visible hand dock chrome today?

| Layer | Owner | Visible effect |
|-------|--------|----------------|
| **Deck shell** | `walnut-live.css` `.rh-live-hand-deck` ~2431–2439 | Matte panel: padding, radius, `background`, **inset blue** `box-shadow` / `1px` ring |
| **Deck structure** | `board-hand-dock.css` `.rh-live-hand-deck` | Height, flex basis, `overflow: hidden` |
| **Inner hand reset** | `walnut-live.css` `.rh-live-hand-deck .wl-hand-area` | Transparent, borderless inner wrapper |
| **Tray rail** | `walnut-live.css` v3 ~2513–2521 | Transparent rail, no brass border |
| **DF board frame** | `dailyFritzMatchBoard.css` Pass B | Brass on **play mat**, not hand dock |

**No brass top line** on hand dock from any active rule; deck uses **electric blue** inset ring (`rgba(88, 166, 255, 0.11)`), shared with other bot studio modes.

### C6. `board-hand-dock.css`

No Daily Fritz–specific rules. Neutral inner tray only.

### C7. Base `.wl-hand-area` (~435)

Still applies properties **not** reset by deck child (e.g. `position`, `z-index`). Does not restore border width for DF accent.

---

## D. Options compared

| Option | Action | Pros | Cons |
|--------|--------|------|------|
| **1. Delete** | Remove ~181–184 | Removes dead code; matches Patch 41 discipline; user preference | None for current DOM |
| **2. Retarget** | e.g. `.rh-live-hand-deck` brass `box-shadow` / `border-top` | Could restore intentional DF hand accent | **Visual change**; conflicts with “defer skin pass” |
| **3. Comment only** | “Dead inside deck; kept for reference” | Zero risk | Noise |
| **4. Defer to `skins/racehorse-matte.css`** | Document only | Future centralized brass | Rule stays dead until then |

---

## E. Recommendation

**Patch 43: Option 1 — delete** `dailyFritzMatchBoard.css` lines **181–184**.

Rationale:

- Rule is **provably inactive** on the only live Daily Fritz hand DOM path.
- Deleting is **no-visual-change** for current studio UI.
- User preference: do **not** retarget brass/gold hand accents until final skin pass.
- Brass mode identity remains on race track, HUD, turn pill, and board frame.

**Do not** in Patch 43: retarget to `.rh-live-hand-deck`, edit `walnut-live.css` deck skin, or touch `board-hand-dock.css`.

---

## F. Exact proposed Patch 43 (delete path)

### F1. File to edit

- `client/src/dailyFritz/dailyFritzMatchBoard.css` **only**

### F2. Delete block

```css
.bot-match-screen.bot-match-mode-daily-fritz .hand-area,
.bot-match-screen.bot-match-mode-daily-fritz .wl-hand-area {
  border-top-color: rgba(231, 182, 74, 0.14) !important;
}
```

(Lines 181–184 inclusive; blank line after line 179 may remain.)

### F3. Verification searches

```bash
rg 'wl-hand-area|hand-area' client/src/dailyFritz/dailyFritzMatchBoard.css
# Expected: no matches after delete

rg 'border-top-color.*231, 182, 74' client/src/dailyFritz/dailyFritzMatchBoard.css
# Expected: no hand-tray match; may still hit score-header / board-frame rules

rg 'bot-match-mode-daily-fritz' client/src/dailyFritz/dailyFritzMatchBoard.css
# Expected: remaining Pass A/B rules unchanged
```

### F4. Build

```bash
npm run build --prefix client
```

### F5. Browser proof (recommended)

Side-by-side or before/after screenshot of **Daily Fritz in-match hand dock** — expect **no change** (accent was already invisible).

---

## G. What not to touch (Patch 43)

- `walnut-live.css` — `.rh-live-hand-deck` shell skin, child reset, `::before`, v3 tray rules  
- `board-hand-dock.css`  
- Other `dailyFritzMatchBoard.css` rules (HUD, mat, watermark)  
- `botMatch.css`, Learn, Practice, Puzzle  
- Components, gameplay, tile/interaction CSS  
- Black matte / `skins/racehorse-matte.css` redesign  

---

## H. Browser verification checklist

After Patch 43 delete:

- [ ] **Daily Fritz active match** — hand dock unchanged; race track / turn pill / board frame brass still present  
- [ ] **Play vs Fritz** — unchanged (rule did not apply — no `bot-match-mode-daily-fritz`)  
- [ ] **Ghost / bot** — unchanged  
- [ ] **Short / narrow viewport** — hand layout OK  
- [ ] **Scrollable hand + underline** — OK  
- [ ] **Learn / Guided** — unchanged  
- [ ] **Daily Puzzle / Practice** — unchanged  

---

## Appendix: Specificity reference

| Selector | Specificity |
|----------|-------------|
| `.bot-match-screen.bot-match-mode-daily-fritz .wl-hand-area` | 0,3,1 |
| `.screen…bot-match…:not(.learn) .rh-live-hand-deck .wl-hand-area` | 0,5,2 |

---

## Recommended follow-up (post Patch 43)

| Patch | Scope |
|-------|--------|
| **44+** | Plan deck-scoped layout migration (`.rh-live-hand-deck .tray-center` / `.hand-container`) — separate from DF accent |
| **Skin pass** | If DF hand dock needs brass emphasis, design on `.rh-live-hand-deck` in `skins/racehorse-matte.css` with explicit product sign-off |
