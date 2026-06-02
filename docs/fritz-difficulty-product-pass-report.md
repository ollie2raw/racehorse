# Fritz Difficulty Product Pass — Report

**Date:** 2026-06-01  
**Scope:** Product structure / UI copy only (no AI, skunk, tournament, or Classic difficulty changes).

---

## What changed

### 1. Play vs Fritz default → Standard

- New module `client/src/bot/pvfTierPreference.ts` persists tier in `localStorage` key `racehorse_bot_fritz_tier`.
- **Default:** `standard` when no stored value exists.
- **Respects stored choice:** returning users keep their last explicit tier selection.
- `PlayVsFritz.tsx` initializes from storage; writes on tier click and Start Match.
- `App.tsx` initializes `botFritzTier` from storage and syncs changes back to storage.

### 2. Difficulty label reframe (Play vs Fritz)

- Tier cards show **role labels** (Beginner / Balanced / Competitive / Expert) instead of raw Elo numbers.
- Approximate strength shown as secondary copy: `Approx. strength ~600` etc.
- Slider marks use role labels, not 600/1000/1800/2400.
- Match summary shows `Standard · Balanced` style pairing.
- `fritzConfig.ts` descriptions updated with `~` prefixed rating labels and role-first copy.

### 3. Daily Fritz Classic remains Elite

- Hub subtitle: *Best of 3 vs Elite Fritz — the competitive daily challenge.*
- Tier display: `Elite · Competitive` (no `(1800)` false precision).
- Opponent card copy emphasizes competitive daily challenge.
- **Server tier unchanged** — still `fritz_tier ?? 'elite'`.

### 4. Post-loss practice nudge (Classic only)

- After losing a game (between-set overlay) or losing the set (final overlay), shows:
  *Try Standard Fritz in Play vs Fritz for a softer practice matchup.*
- Text-only nudge — no forced navigation or mode switch.
- `practiceHint` field added to `DailyFritzSetOverlayViewModel`.

### 5. Casual Daily Fritz — **deferred**

- Assessed as too large for this pass (DB track column, API partitioning, separate leaderboard).
- Focused plan: `docs/casual-daily-fritz-implementation-plan.md`.

---

## What did not change

| Area | Status |
|------|--------|
| Fritz AI (`botHeuristics.ts`) | Unchanged |
| Skunk rules | Unchanged |
| Tournament bot tiers | Unchanged |
| Daily Fritz Classic difficulty (Elite) | Unchanged |
| Four daily tracks | Not added |
| Casual Daily Fritz implementation | Deferred (plan only) |

---

## Files changed

| File | Change |
|------|--------|
| `client/src/bot/pvfTierPreference.ts` | **New** — localStorage read/write, default Standard |
| `client/src/bot/PlayVsFritz.tsx` | Default Standard, tier copy, persistence |
| `client/src/bot/fritzConfig.ts` | Role-first descriptions, approximate ratings |
| `client/src/App.tsx` | Init/persist `botFritzTier` from storage |
| `client/src/dailyFritz/practiceHint.ts` | **New** — loss nudge copy helper |
| `client/src/dailyFritz/setOverlayViewModel.ts` | `practiceHint` field |
| `client/src/dailyFritz/DailyFritzScreen.tsx` | Classic copy, tier label, practice hints |
| `client/src/dailyFritz/DailyFritzFinalResultOverlay.tsx` | Render practice hint |
| `client/src/bot/BotMatchScreen.tsx` | Render practice hint on set interstitial |
| `client/src/styles/_pvf-layout.css` | Approx strength line styling |
| `client/src/bot/botMatch.css` | Practice hint styling |
| `docs/casual-daily-fritz-implementation-plan.md` | **New** — deferred track plan |
| `docs/fritz-difficulty-product-pass-report.md` | **New** — this report |

---

## Build / test results

| Check | Result |
|-------|--------|
| `npm run build --prefix client` | **Pass** |
| `npm run test:bot:tier` | **Pass** (3 tier differentiation tests) |
| `npm run test:bot` | Not run — pre-existing Test 6 failure in `botHeuristics.behaviorTests.ts` (unrelated) |

---

## Manual validation checklist

- [x] Open Play vs Fritz as new/cleared storage user → **Standard** selected by default.
- [x] Select Elite, leave and return → **Elite** still selected.
- [x] Tier cards show role labels + approximate strength, not bare Elo.
- [x] Daily Fritz hub shows Elite · Competitive; subtitle mentions competitive challenge.
- [x] Start Daily Fritz → match uses Elite Fritz (unchanged gameplay).
- [x] Lose a Daily Fritz game/set → practice hint appears (no forced redirect).

**Verified:** 2026-06-01 (manual QA pass).

---

## Recommended next pass

1. **Casual Daily Fritz** — execute `docs/casual-daily-fritz-implementation-plan.md` (migration + API + hub card).
2. **Tier details modal** — wire “View tier details ›” on Play vs Fritz (currently placeholder).
3. **Cross-surface copy audit** — matchmaking tier bands, stats page 2400 bar, share cards.
4. **Optional:** deep-link from Daily Fritz practice hint to Play vs Fritz with Standard pre-selected.
