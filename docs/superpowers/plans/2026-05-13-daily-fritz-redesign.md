# Daily Fritz Landing Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Daily Fritz landing screen to match the approved mock — massive Barlow Condensed title, gold eyebrow chip, larger Fritz hero, and spacious stat strip.

**Architecture:** Two independent changes — (1) CSS-only: update `dailyFritz.css` to increase the title size, add eyebrow chip styles, enlarge the Fritz hero image area, and tighten the overview card spacing; (2) TSX-only: update the landing `return` block in `DailyFritzScreen.tsx` to add the eyebrow chip element, rename "Skill" → "Tier" in the meta grid, swap the Fritz image to `/fritzwave.png`, and make the CTA button use `size="lg"`. All game logic, overlay states, leaderboard, loading screen, and API code are untouched.

**Tech Stack:** CSS with design tokens, React TSX. No TypeScript changes beyond JSX.

**Protected files — do NOT touch:**
- `client/src/styles/walnut-live.css`
- `client/src/learn/`
- `client/src/learning/`
- `client/src/dailyFritz/api.ts`
- `client/src/dailyFritz/DailyFritzLeaderboard.tsx`

**Design tokens reference** (`client/src/styles/tokens.css`):
- `var(--tier-elite)` = gold
- `var(--font-display)` = Barlow Condensed
- `var(--font-body)` = Outfit
- `var(--glass-bg)`, `var(--glass-blur)`, `var(--border-subtle)`, `var(--border-light)`
- `var(--radius-card)`, `var(--radius-md)`, `var(--radius-sm)`
- `var(--text-primary)`, `var(--text-secondary)`, `var(--text-dim)`
- `var(--tier-rookie)` = green, `var(--tier-standard)` = blue, `var(--tier-master)` = purple

---

### Task 1: CSS updates — title, eyebrow chip, Fritz hero, and spacing

**Files:**
- Modify: `client/src/dailyFritz/dailyFritz.css`

**Context:** The current CSS has a small title (`clamp(28px, 3.8dvh, 40px)`), no eyebrow chip class, and the Fritz image is capped at 152px. The mock requires a massive display title (~80px), an eyebrow chip, and a taller Fritz hero that fills the overview card better. All other structure (two-column layout, games panel, stats bar, info footer) is already correct — only these specific rules change.

Do the edits in order. Each uses the Edit tool with the exact `old_string` shown.

- [ ] **Step 1: Enlarge the title font size**

Read `client/src/dailyFritz/dailyFritz.css` lines 119–127. Current:

```css
.df-title {
  font-family: var(--font-display);
  font-size: clamp(28px, 3.8dvh, 40px);
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.04em;
  line-height: 0.95;
  margin: 0 0 4px;
}
```

Replace with:

```css
.df-title {
  font-family: var(--font-display);
  font-size: clamp(56px, 8dvh, 88px);
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.04em;
  line-height: 0.92;
  margin: 0 0 6px;
}
```

- [ ] **Step 2: Add eyebrow chip styles immediately after `.df-title`**

Read around line 128 (right after the `.df-title` block). Insert the following new block after `.df-title {}` and before `.df-subtitle {}`:

Find the exact text:
```css
.df-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.35;
  max-width: 36em;
}
```

Replace with:

```css
.df-eyebrow-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-display);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--tier-elite);
  text-transform: uppercase;
  margin-bottom: 8px;
}

.df-eyebrow-chip::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tier-elite);
  box-shadow: 0 0 8px var(--tier-elite);
  flex-shrink: 0;
}

.df-subtitle {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0 0 24px;
  line-height: 1.4;
  max-width: 36em;
}
```

- [ ] **Step 3: Enlarge the Fritz overview image**

Read `client/src/dailyFritz/dailyFritz.css` around lines 188–209. Find:

```css
.df-overview-fritz-wrap {
  flex: 0 0 auto;
  width: min(184px, 30vw);
  max-width: 200px;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  isolation: isolate;
}

.df-overview-fritz {
  width: 100%;
  height: auto;
  max-height: min(152px, 20dvh);
  object-fit: contain;
  object-position: center bottom;
  display: block;
  opacity: 1;
  filter: drop-shadow(0 10px 22px rgba(0, 0, 0, 0.55)) drop-shadow(0 0 1px rgba(0, 0, 0, 0.35));
  image-rendering: auto;
}
```

Replace with:

```css
.df-overview-fritz-wrap {
  flex: 0 0 auto;
  width: min(200px, 32vw);
  max-width: 220px;
  margin: -12px -14px -10px -14px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  isolation: isolate;
  overflow: hidden;
}

.df-overview-fritz {
  width: 100%;
  height: auto;
  max-height: min(260px, 34dvh);
  object-fit: contain;
  object-position: center bottom;
  display: block;
  opacity: 1;
  filter: drop-shadow(0 10px 28px rgba(0, 0, 0, 0.6)) drop-shadow(0 0 1px rgba(0, 0, 0, 0.35));
  image-rendering: auto;
}
```

- [ ] **Step 4: Update overview card body spacing**

Read the `.df-overview-body` block:

```css
.df-overview-body {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 8px;
}
```

Replace with:

```css
.df-overview-body {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  margin-bottom: 10px;
}
```

- [ ] **Step 5: Make the START SET button larger**

Read the `.df-start-btn.rh-btn` block:

```css
.df-start-btn.rh-btn {
  min-height: 42px;
  height: 42px;
  padding: 0 22px;
  font-size: 13px;
  letter-spacing: 0.07em;
  border-radius: 10px;
}
```

Replace with:

```css
.df-start-btn.rh-btn {
  min-height: 52px;
  height: 52px;
  padding: 0 28px;
  font-size: 14px;
  letter-spacing: 0.08em;
  border-radius: 12px;
}
```

- [ ] **Step 6: Verify no hardcoded hex values introduced**

```bash
grep -n "#[0-9a-fA-F]\{3,6\}" /Users/olivermorid/racehorse-dominoes/client/src/dailyFritz/dailyFritz.css | grep -v "rgba\|color-mix\|linear-gradient\|radial-gradient\|18\|21\|040b17\|050c18\|040912\|03080f"
```

Expected: Only existing gradient hex values. No new hardcoded hex you added.

- [ ] **Step 7: Commit CSS changes**

```bash
cd /Users/olivermorid/racehorse-dominoes
git add client/src/dailyFritz/dailyFritz.css
git commit -m "style: Daily Fritz landing — larger title, eyebrow chip, enlarged Fritz hero"
```

---

### Task 2: TSX updates — eyebrow chip, Tier label, fritzwave image, lg button

**Files:**
- Modify: `client/src/dailyFritz/DailyFritzScreen.tsx`

**Context:** The landing `return` block (starting around line 968) needs four targeted changes: (1) add the `.df-eyebrow-chip` element above the `<h1>`; (2) rename the "Skill" meta label to "Tier"; (3) swap the Fritz image import from `fritzpngtiles.png` to the public `/fritzwave.png` path; (4) upgrade the CTA button to `size="lg"`. Do NOT touch any other branches (activeRun, leaderboardOpen, loading), state logic, or helper functions.

Work top-to-bottom through the file.

- [ ] **Step 1: Replace the Fritz image import**

Read `client/src/dailyFritz/DailyFritzScreen.tsx` line 13. Current:

```ts
import fritzTilesArt from '../assets/home/fritzpngtiles.png';
```

Delete this line (the new code uses a string literal path, no import needed).

- [ ] **Step 2: Add the eyebrow chip above the title**

Read around lines 990–996. Current:

```tsx
            <div className="df-page-head">
              <Button type="button" variant="ghost" className="df-back-btn" onClick={onBack}>
                ← Back to Home
              </Button>
              <h1 className="df-title">Daily Fritz</h1>
              <p className="df-subtitle">Best-of-3 set. Same deal for everyone.</p>
            </div>
```

Replace with:

```tsx
            <div className="df-page-head">
              <Button type="button" variant="ghost" className="df-back-btn" onClick={onBack}>
                ← Back to Home
              </Button>
              <div className="df-eyebrow-chip">Daily Fritz</div>
              <h1 className="df-title">Daily Fritz</h1>
              <p className="df-subtitle">Best-of-3 set. Same deal for everyone.</p>
            </div>
```

- [ ] **Step 3: Swap the Fritz image src**

Read around lines 1001–1003. Current:

```tsx
                  <figure className="df-overview-fritz-wrap">
                    <img src={fritzTilesArt} alt="Fritz" className="df-overview-fritz" />
                  </figure>
```

Replace with:

```tsx
                  <figure className="df-overview-fritz-wrap">
                    <img src="/fritzwave.png" alt="Fritz" className="df-overview-fritz" />
                  </figure>
```

- [ ] **Step 4: Change "Skill" label to "Tier"**

Read around line 1032–1035. Current:

```tsx
                <div className="df-meta-text">
                  <div className="df-meta-label">Skill</div>
                  <div className="df-meta-value df-meta-value--tier">{tierLabel}</div>
                </div>
```

Replace with:

```tsx
                <div className="df-meta-text">
                  <div className="df-meta-label">Tier</div>
                  <div className="df-meta-value df-meta-value--tier">{tierLabel}</div>
                </div>
```

- [ ] **Step 5: Upgrade CTA button to size="lg"**

Read around lines 1062–1075. Current:

```tsx
                <Button
                  variant="tier-elite"
                  size="md"
                  className="df-start-btn"
                  onClick={() => void beginRun()}
                  disabled={startActionPending || isComplete}
                >
```

Replace with:

```tsx
                <Button
                  variant="tier-elite"
                  size="lg"
                  className="df-start-btn"
                  onClick={() => void beginRun()}
                  disabled={startActionPending || isComplete}
                >
```

- [ ] **Step 6: TypeScript check**

```bash
cd /Users/olivermorid/racehorse-dominoes/client && npx tsc --noEmit 2>&1
```

Expected: no output (zero errors).

If there are errors about `fritzTilesArt`, confirm the import on line 13 was deleted. If there are any other errors, read them carefully and fix.

- [ ] **Step 7: Commit TSX changes**

```bash
cd /Users/olivermorid/racehorse-dominoes
git add client/src/dailyFritz/DailyFritzScreen.tsx
git commit -m "feat: Daily Fritz landing — eyebrow chip, Tier label, fritzwave hero, lg CTA"
```

---

### Task 3: Final verification

**Files:** Read-only verification pass.

- [ ] **Step 1: Confirm eyebrow chip is in the TSX**

```bash
grep -n "df-eyebrow-chip" /Users/olivermorid/racehorse-dominoes/client/src/dailyFritz/DailyFritzScreen.tsx
```

Expected: one match (the `<div className="df-eyebrow-chip">` line).

- [ ] **Step 2: Confirm eyebrow chip styles exist in CSS**

```bash
grep -n "df-eyebrow-chip" /Users/olivermorid/racehorse-dominoes/client/src/dailyFritz/dailyFritz.css
```

Expected: two matches (`.df-eyebrow-chip` rule + `.df-eyebrow-chip::before` rule).

- [ ] **Step 3: Confirm fritzwave is used, fritzTilesArt is gone**

```bash
grep -n "fritzTilesArt\|fritzpngtiles\|fritzwave" /Users/olivermorid/racehorse-dominoes/client/src/dailyFritz/DailyFritzScreen.tsx
```

Expected: one match — `/fritzwave.png`. Zero matches for `fritzTilesArt` or `fritzpngtiles`.

- [ ] **Step 4: Confirm "Tier" label**

```bash
grep -n '"Tier"\|"Skill"' /Users/olivermorid/racehorse-dominoes/client/src/dailyFritz/DailyFritzScreen.tsx
```

Expected: one match for `"Tier"`, zero for `"Skill"`.

- [ ] **Step 5: TypeScript final check**

```bash
cd /Users/olivermorid/racehorse-dominoes/client && npx tsc --noEmit 2>&1
```

Expected: no output.

- [ ] **Step 6: Git log**

```bash
cd /Users/olivermorid/racehorse-dominoes && git log --oneline -4
```

Expected: shows the two redesign commits at the top.
