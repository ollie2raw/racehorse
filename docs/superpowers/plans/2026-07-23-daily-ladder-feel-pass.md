# Daily Ladder Feel Pass Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Visual/CSS-first pass — unit tests only where copy/share contracts are deterministic.

**Goal:** Make the Daily Ladder arc feel like one finished premium blue/matte product (hub → play → overlays → leaderboard → share), matching the Daily Fritz feel-pass playbook with `--tier-standard` identity.

**Architecture:** CSS-first presentational changes scoped under `.dpl-*` / `.dpl-ladder-hub` / `.dflb-page--ladder`. Minimal TSX for CTA order, copy strings, and share text. No gameplay, scoring, or verification changes.

**Tech Stack:** React, Vite client, existing `dailyPuzzle.css` + shared `dailyFritzLeaderboardScreen.css` ladder overrides.

**Spec:** `docs/superpowers/specs/2026-07-23-daily-ladder-feel-pass.md`

## Global Constraints

- Mode accent: electric blue / `--tier-standard` only (no Elite gold, practice green, cyan drift, or DF brass bleed)
- Matte solids; no gradient fills on Ladder-owned result chrome
- Share never above primary CTAs; feedback label is `Copied` not `✓ Shared!`
- Honor `prefers-reduced-motion` for all new/changed motion
- Do not touch validator, submission APIs, session storage logic, legacy entry, or admin
- Do not regress Daily Fritz brass feel pass

## File map

| File | Responsibility |
|---|---|
| `client/src/dailyPuzzle/dailyPuzzle.css` | Hub CTA/progress, overlay matte/CTA, motion gates, practice button tint |
| `client/src/dailyPuzzle/DailyPuzzleLadderHubView.tsx` | Hub share button label; practice chip labels if needed |
| `client/src/dailyPuzzle/DailyPuzzleLadderOverlays.tsx` | CTA order, pending/share copy, practice exit chrome |
| `client/src/dailyPuzzle/DailyPuzzleLadderLeaderboardScreen.tsx` | Empty podium copy; remove Puzzle tier chip; share label |
| `client/src/dailyFritz/dailyFritzLeaderboardScreen.css` | Ladder-scoped eyebrow/chip → `--tier-standard` |
| `client/src/dailyPuzzle/ladderShareCard.ts` | Scrub emoji from share text |
| `client/src/dailyPuzzle/ladderShareCard.test.ts` | Create: share text contract |
| Match theme (only if needed) | Ladder/daily-puzzle scoped HUD blue check |

---

### Task 1: Share text scrub + test

**Files:**
- Modify: `client/src/dailyPuzzle/ladderShareCard.ts`
- Create: `client/src/dailyPuzzle/ladderShareCard.test.ts`

- [ ] **Step 1:** Add test expecting no emoji and clean lines

```ts
import { describe, expect, it } from 'vitest';
import { buildLadderShareText, type DailyPuzzleLadderShareData } from './ladderShareCard';

const sample: DailyPuzzleLadderShareData = {
  shareDate: 'July 23, 2026',
  totalScore: 240,
  rank: 4,
  slotLines: ['Setup 80', 'Strike 90', 'Master 70'],
  shareStreak: 3,
  shareRating: 1520,
};

describe('buildLadderShareText', () => {
  it('produces premium plain text without emoji', () => {
    const text = buildLadderShareText(sample);
    expect(text).toContain('Daily Puzzle Ladder · July 23, 2026');
    expect(text).toContain('240 PTS · Rank #4');
    expect(text).toContain('3-day streak');
    expect(text).not.toMatch(/[🧩🔥✓]/);
  });
});
```

- [ ] **Step 2:** Update `buildLadderShareText` / slot perfect mark to plain text (e.g. `PERFECT` or omit checkmark; streak `3-day streak`; title without 🧩)

- [ ] **Step 3:** Run `npx vitest run src/dailyPuzzle/ladderShareCard.test.ts` in `client/` — expect PASS

- [ ] **Step 4:** Commit share scrub only if user requests commits mid-pass; otherwise batch at end

---

### Task 2: Hub blue matte + CTA hierarchy

**Files:**
- Modify: `client/src/dailyPuzzle/dailyPuzzle.css`
- Modify: `client/src/dailyPuzzle/DailyPuzzleLadderHubView.tsx` (share label `Copied`)

- [ ] **Step 1:** Strengthen `.dpl-pvf-start-btn` matte blue + restrained glow (mirror DF `.df-pvf-start-btn` pattern with `--tier-standard`)
- [ ] **Step 2:** Active progress-card emphasis + sibling dim via `:has(.dpl-puzzle-card--active)` or equivalent done/idle classes
- [ ] **Step 3:** Demote `.dpl-share-result-btn` to ghost; keep Start visually primary
- [ ] **Step 4:** Under `.dpl-ladder-hub`, retint `.df-pvf-leaderboard-link` from Elite gold → standard blue
- [ ] **Step 5:** Replace hub `✓ Shared!` → `Copied`
- [ ] **Step 6:** Soften practice chip labels if currently bare `P1`/`P2`/`P3` (presentation only)

---

### Task 3: In-play HUD blue check

**Files:**
- Modify: `client/src/dailyPuzzle/dailyPuzzle.css` and/or match-live theme **only** under daily-puzzle / ladder screen selectors

- [ ] **Step 1:** Inspect Ladder in-play wrappers (`daily-puzzle-screen`, room code, turn chips)
- [ ] **Step 2:** If brass/green bleed exists, add Ladder-scoped blue pill/border overrides
- [ ] **Step 3:** Touch no engine / hand dock playability

---

### Task 4: Overlays unify

**Files:**
- Modify: `client/src/dailyPuzzle/DailyPuzzleLadderOverlays.tsx`
- Modify: `client/src/dailyPuzzle/dailyPuzzle.css`

- [ ] **Step 1:** Pending copy: replace `Please wait.` with soft `Submitting…` / pulse class on pending modal
- [ ] **Step 2:** Final footer reorder: Leaderboard primary → Review → Home → Share last; Share class = secondary/ghost
- [ ] **Step 3:** Share label `Copied` not `✓ Shared!`
- [ ] **Step 4:** Matte `.dpl-ladder-result` / `.rh-result__head` (kill radial gradients under Ladder)
- [ ] **Step 5:** Practice overlay: use `.dpl-ladder-result`; kill green `.rh-btn-cancel` `!important` for Ladder practice primary
- [ ] **Step 6:** Overlay enter: ease like DF `df-result-enter`; add `prefers-reduced-motion` gates for `rh-pop` / `rh-fade` / loading shimmer under Ladder or globally in `dailyPuzzle.css`

---

### Task 5: Leaderboard empties + chips

**Files:**
- Modify: `client/src/dailyPuzzle/DailyPuzzleLadderLeaderboardScreen.tsx`
- Modify: `client/src/dailyFritz/dailyFritzLeaderboardScreen.css` (ladder-scoped only)

- [ ] **Step 1:** Empty podium → `—` / `Unclaimed`
- [ ] **Step 2:** Remove top-10 `.dflb-tier-chip--puzzle` / “Puzzle” chip render
- [ ] **Step 3:** `.dflb-eyebrow--ladder` and remaining puzzle chip styles → `--tier-standard` (not cyan)
- [ ] **Step 4:** Share button on LB → `Copied`
- [ ] **Step 5:** Soften any backend-ish you-strip empty copy if present

---

### Task 6: Verify

- [ ] **Step 1:** `npm run build` in `client/` — expect success
- [ ] **Step 2:** Spot-check Ladder arc mentally / browser if available
- [ ] **Step 3:** Confirm DF files not regressively edited beyond ladder-scoped CSS

## Spec coverage checklist

| Spec section | Task |
|---|---|
| Hub CTA / progress / share / LB link | 2 |
| In-play blue check | 3 |
| Overlays matte / CTA / pending / practice | 4 |
| Leaderboard empties / chips / motion | 5 (+ DF LB CSS motion already exists) |
| Share emoji scrub | 1 |
| Reduced motion | 4 |
| Verification / DF untouched | 6 |

## Execution

Inline execution in this session (user already approved spec + shipping intent).
