# Dead Code Purge & Font System Normalization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete orphaned files, fix missing Barlow Condensed font load, and replace all legacy font-family declarations (Rajdhani, Space Grotesk, Montserrat) with design token variables across the codebase.

**Architecture:** Three independent cleanup passes — (1) file deletions that are pure dead weight, (2) fixing the Google Fonts link in index.html so Barlow Condensed actually loads, (3) mechanical sed-based replacement of legacy font strings with CSS custom properties. No logic changes, no layout changes, no behavior changes.

**Tech Stack:** Bash/sed for CSS edits, TypeScript compiler for verification. Working directory: `/Users/olivermorid/racehorse-dominoes`.

**Files protected — do NOT touch:**
- `client/src/styles/walnut-live.css` — live game tile rules, explicitly off-limits per CLAUDE.md
- `client/src/learn/` — active lesson player, off-limits per CLAUDE.md
- `client/src/learning/` — active coaching system, off-limits per CLAUDE.md
- `client/src/App.css` `:root {}` block — has 16 active variable references; needs separate migration

---

### Task 1: Delete dead files

**Files:**
- Delete: `_review/` (entire directory — 2.7 MB old audit snapshot, not source)
- Delete: `client/index.html.bak`

- [ ] **Step 1: Confirm `_review/` is not referenced by any build or CI config**

```bash
grep -r "_review" /Users/olivermorid/racehorse-dominoes --include="*.json" --include="*.yaml" --include="*.yml" --include="*.ts" -l 2>/dev/null | grep -v "node_modules"
```

Expected: no output (or only matches inside _review itself).

- [ ] **Step 2: Delete the `_review/` directory**

```bash
rm -rf /Users/olivermorid/racehorse-dominoes/_review
```

- [ ] **Step 3: Delete the bak file**

```bash
rm /Users/olivermorid/racehorse-dominoes/client/index.html.bak
```

- [ ] **Step 4: Verify deletions**

```bash
ls /Users/olivermorid/racehorse-dominoes/_review 2>&1
ls /Users/olivermorid/racehorse-dominoes/client/index.html.bak 2>&1
```

Expected: both print "No such file or directory".

- [ ] **Step 5: Commit**

```bash
cd /Users/olivermorid/racehorse-dominoes
git add -A
git commit -m "chore: delete _review snapshot dir and index.html.bak"
```

---

### Task 2: Fix Google Fonts — add Barlow Condensed, remove legacy fonts

**Files:**
- Modify: `client/index.html`

**Context:** `index.html` currently loads `Outfit + Montserrat + Inter`. CLAUDE.md mandates only **Barlow Condensed** (display) and **Outfit** (body). Barlow Condensed is used via `var(--font-display)` in production CSS but was never loaded — causing silent fallback to system fonts throughout the app.

- [ ] **Step 1: Read the current font link**

```bash
grep -n "fonts.googleapis" /Users/olivermorid/racehorse-dominoes/client/index.html
```

Expected output:
```
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&family=Montserrat:wght@900&family=Inter:wght@400;700;900&display=swap" rel="stylesheet">
```

- [ ] **Step 2: Replace the Google Fonts link**

In `client/index.html`, replace the entire fonts `<link>` line with:

```html
    <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800;900&family=Outfit:wght@400;600;700;800;900&display=swap" rel="stylesheet">
```

Use the Edit tool to make this change precisely.

- [ ] **Step 3: Verify the change**

```bash
grep "fonts.googleapis" /Users/olivermorid/racehorse-dominoes/client/index.html
```

Expected: single line containing `Barlow+Condensed` and `Outfit`, no `Montserrat`, no `Inter`.

- [ ] **Step 4: Commit**

```bash
cd /Users/olivermorid/racehorse-dominoes
git add client/index.html
git commit -m "fix: load Barlow Condensed in Google Fonts, drop Montserrat and Inter"
```

---

### Task 3: Replace legacy fonts in `ui/claudeMode.css` and `ui/leaderboardPage.css`

**Files:**
- Modify: `client/src/ui/claudeMode.css` (~17 occurrences)
- Modify: `client/src/ui/leaderboardPage.css` (~6 occurrences)

**Rule:** `'Rajdhani'` → `var(--font-display)` | `'Space Grotesk'` → `var(--font-body)`

- [ ] **Step 1: Count occurrences before replacing**

```bash
grep -c "Rajdhani\|Space Grotesk" /Users/olivermorid/racehorse-dominoes/client/src/ui/claudeMode.css
grep -c "Rajdhani\|Space Grotesk" /Users/olivermorid/racehorse-dominoes/client/src/ui/leaderboardPage.css
```

- [ ] **Step 2: Replace in claudeMode.css**

```bash
sed -i '' \
  -e "s/font-family: 'Rajdhani', system-ui, sans-serif/font-family: var(--font-display)/g" \
  -e "s/font-family: 'Rajdhani', sans-serif/font-family: var(--font-display)/g" \
  -e "s/font-family:'Rajdhani',sans-serif/font-family: var(--font-display)/g" \
  -e "s/font-family: 'Rajdhani', system-ui/font-family: var(--font-display)/g" \
  -e "s/font-family: 'Space Grotesk', system-ui, sans-serif/font-family: var(--font-body)/g" \
  -e "s/font-family: 'Space Grotesk', sans-serif/font-family: var(--font-body)/g" \
  -e "s/font-family:'Space Grotesk', system-ui, sans-serif/font-family: var(--font-body)/g" \
  /Users/olivermorid/racehorse-dominoes/client/src/ui/claudeMode.css
```

- [ ] **Step 3: Replace in leaderboardPage.css**

```bash
sed -i '' \
  -e "s/font-family: 'Rajdhani', system-ui, sans-serif/font-family: var(--font-display)/g" \
  -e "s/font-family: 'Rajdhani', sans-serif/font-family: var(--font-display)/g" \
  -e "s/font-family: 'Space Grotesk', system-ui, sans-serif/font-family: var(--font-body)/g" \
  -e "s/font-family: 'Space Grotesk', sans-serif/font-family: var(--font-body)/g" \
  /Users/olivermorid/racehorse-dominoes/client/src/ui/leaderboardPage.css
```

- [ ] **Step 4: Verify — zero legacy font strings remain**

```bash
grep "Rajdhani\|Space Grotesk" /Users/olivermorid/racehorse-dominoes/client/src/ui/claudeMode.css
grep "Rajdhani\|Space Grotesk" /Users/olivermorid/racehorse-dominoes/client/src/ui/leaderboardPage.css
```

Expected: no output from either command.

- [ ] **Step 5: Commit**

```bash
cd /Users/olivermorid/racehorse-dominoes
git add client/src/ui/claudeMode.css client/src/ui/leaderboardPage.css
git commit -m "chore: replace legacy fonts with design tokens in ui/ CSS"
```

---

### Task 4: Replace legacy fonts in `ghost/`, `styles/`, `components/`

**Files:**
- Modify: `client/src/ghost/ghostMode.css`
- Modify: `client/src/styles/shared-ui.css`
- Modify: `client/src/components/leaveGameModal.css`

- [ ] **Step 1: Replace in ghostMode.css**

```bash
sed -i '' \
  -e "s/font-family: 'Rajdhani', system-ui, sans-serif/font-family: var(--font-display)/g" \
  -e "s/font-family: 'Rajdhani', sans-serif/font-family: var(--font-display)/g" \
  -e "s/font-family:'Rajdhani', system-ui, sans-serif/font-family: var(--font-display)/g" \
  -e "s/font-family: 'Space Grotesk', system-ui, sans-serif/font-family: var(--font-body)/g" \
  -e "s/font-family: 'Space Grotesk', sans-serif/font-family: var(--font-body)/g" \
  /Users/olivermorid/racehorse-dominoes/client/src/ghost/ghostMode.css
```

- [ ] **Step 2: Replace in shared-ui.css**

```bash
sed -i '' \
  -e "s/font-family: 'Rajdhani', sans-serif/font-family: var(--font-display)/g" \
  -e "s/font-family: 'Space Grotesk', sans-serif/font-family: var(--font-body)/g" \
  /Users/olivermorid/racehorse-dominoes/client/src/styles/shared-ui.css
```

- [ ] **Step 3: Replace in leaveGameModal.css**

```bash
sed -i '' \
  -e "s/font-family: 'Rajdhani', sans-serif/font-family: var(--font-display)/g" \
  /Users/olivermorid/racehorse-dominoes/client/src/components/leaveGameModal.css
```

- [ ] **Step 4: Verify**

```bash
grep "Rajdhani\|Space Grotesk" \
  /Users/olivermorid/racehorse-dominoes/client/src/ghost/ghostMode.css \
  /Users/olivermorid/racehorse-dominoes/client/src/styles/shared-ui.css \
  /Users/olivermorid/racehorse-dominoes/client/src/components/leaveGameModal.css
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
cd /Users/olivermorid/racehorse-dominoes
git add client/src/ghost/ghostMode.css client/src/styles/shared-ui.css client/src/components/leaveGameModal.css
git commit -m "chore: replace legacy fonts with design tokens in ghost/, styles/, components/"
```

---

### Task 5: Replace legacy fonts in `bot/` CSS files

**Files:**
- Modify: `client/src/bot/PlayVsFritz.css`
- Modify: `client/src/bot/botMatch.css`

**Note:** `PlayVsFritz.css` also contains one `Montserrat` reference → replace with `var(--font-display)`.

- [ ] **Step 1: Replace in PlayVsFritz.css**

```bash
sed -i '' \
  -e "s/font-family: 'Rajdhani', sans-serif/font-family: var(--font-display)/g" \
  -e "s/font-family:'Rajdhani',sans-serif/font-family: var(--font-display)/g" \
  -e "s/font-family: 'Rajdhani', system-ui, sans-serif/font-family: var(--font-display)/g" \
  -e "s/font-family: 'Montserrat', sans-serif/font-family: var(--font-display)/g" \
  -e "s/font-family: 'Space Grotesk', system-ui, sans-serif/font-family: var(--font-body)/g" \
  /Users/olivermorid/racehorse-dominoes/client/src/bot/PlayVsFritz.css
```

- [ ] **Step 2: Replace in botMatch.css**

```bash
sed -i '' \
  -e "s/font-family: 'Rajdhani', sans-serif !important/font-family: var(--font-display) !important/g" \
  -e "s/font-family: 'Rajdhani', system-ui, sans-serif/font-family: var(--font-display)/g" \
  -e "s/font-family: 'Rajdhani', sans-serif/font-family: var(--font-display)/g" \
  -e "s/font-family: 'Space Grotesk', sans-serif/font-family: var(--font-body)/g" \
  /Users/olivermorid/racehorse-dominoes/client/src/bot/botMatch.css
```

- [ ] **Step 3: Verify**

```bash
grep "Rajdhani\|Space Grotesk\|Montserrat" \
  /Users/olivermorid/racehorse-dominoes/client/src/bot/PlayVsFritz.css \
  /Users/olivermorid/racehorse-dominoes/client/src/bot/botMatch.css
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd /Users/olivermorid/racehorse-dominoes
git add client/src/bot/PlayVsFritz.css client/src/bot/botMatch.css
git commit -m "chore: replace legacy fonts with design tokens in bot/ CSS"
```

---

### Task 6: Replace legacy fonts in `dailyPuzzle/`, `friends/`, `stats/`, `App.css`

**Files:**
- Modify: `client/src/dailyPuzzle/dailyPuzzle.css`
- Modify: `client/src/friends/friendsScreen.css`
- Modify: `client/src/stats/statsScreen.css`
- Modify: `client/src/App.css` (font-family lines only — do NOT touch the `:root {}` block)

- [ ] **Step 1: Replace in dailyPuzzle.css**

```bash
sed -i '' \
  -e "s/font-family: 'Rajdhani', sans-serif/font-family: var(--font-display)/g" \
  -e "s/font-family: 'Space Grotesk', sans-serif/font-family: var(--font-body)/g" \
  /Users/olivermorid/racehorse-dominoes/client/src/dailyPuzzle/dailyPuzzle.css
```

- [ ] **Step 2: Replace in friendsScreen.css**

```bash
sed -i '' \
  -e "s/font-family: 'Rajdhani', system-ui, sans-serif/font-family: var(--font-display)/g" \
  -e "s/font-family: 'Space Grotesk', system-ui, sans-serif/font-family: var(--font-body)/g" \
  /Users/olivermorid/racehorse-dominoes/client/src/friends/friendsScreen.css
```

- [ ] **Step 3: Replace in statsScreen.css**

```bash
sed -i '' \
  -e "s/font-family: 'Rajdhani', system-ui, sans-serif/font-family: var(--font-display)/g" \
  -e "s/font-family: 'Space Grotesk', system-ui, sans-serif/font-family: var(--font-body)/g" \
  /Users/olivermorid/racehorse-dominoes/client/src/stats/statsScreen.css
```

- [ ] **Step 4: Replace in App.css (font-family lines only)**

```bash
sed -i '' \
  -e "s/font-family: 'Space Grotesk', system-ui, sans-serif/font-family: var(--font-body)/g" \
  -e "s/font-family: 'Space Grotesk', sans-serif/font-family: var(--font-body)/g" \
  -e "s/font-family: 'Rajdhani', system-ui, sans-serif/font-family: var(--font-display)/g" \
  -e "s/font-family: 'Rajdhani', sans-serif/font-family: var(--font-display)/g" \
  /Users/olivermorid/racehorse-dominoes/client/src/App.css
```

- [ ] **Step 5: Verify — check for any remaining legacy font strings across entire src/**

```bash
grep -rn "font-family.*Rajdhani\|font-family.*Space Grotesk\|font-family.*Montserrat\|font-family.*Inter\b" \
  /Users/olivermorid/racehorse-dominoes/client/src \
  --include="*.css" \
  | grep -v "walnut-live.css\|learn/\|learning/"
```

Expected: no output. If any remain, fix them before committing.

- [ ] **Step 6: TypeScript check — verify no type errors introduced**

```bash
cd /Users/olivermorid/racehorse-dominoes/client && npx tsc --noEmit 2>&1
```

Expected: no output (clean compile).

- [ ] **Step 7: Commit**

```bash
cd /Users/olivermorid/racehorse-dominoes
git add client/src/dailyPuzzle/dailyPuzzle.css client/src/friends/friendsScreen.css \
        client/src/stats/statsScreen.css client/src/App.css
git commit -m "chore: replace legacy fonts with design tokens in dailyPuzzle/, friends/, stats/, App.css"
```

---

### Task 7: Final verification

- [ ] **Step 1: Zero legacy font strings in non-protected src/**

```bash
grep -rn "font-family.*Rajdhani\|font-family.*Space Grotesk\|font-family.*Montserrat\|font-family.*'Inter'" \
  /Users/olivermorid/racehorse-dominoes/client/src \
  --include="*.css"
```

Expected: output only from `walnut-live.css`, `learn/`, or `learning/` (protected). Nothing else.

- [ ] **Step 2: Barlow Condensed is loading**

```bash
grep "Barlow" /Users/olivermorid/racehorse-dominoes/client/index.html
```

Expected: single line with `Barlow+Condensed`.

- [ ] **Step 3: No dead directories remain**

```bash
ls /Users/olivermorid/racehorse-dominoes/_review 2>&1
```

Expected: "No such file or directory".

- [ ] **Step 4: TypeScript still clean**

```bash
cd /Users/olivermorid/racehorse-dominoes/client && npx tsc --noEmit 2>&1
```

Expected: no output.

- [ ] **Step 5: Final commit if anything was missed**

If the above steps are all clean, no additional commit needed. Otherwise fix and commit with:
```bash
git commit -m "chore: dead code purge final cleanup"
```

---

## Out of Scope (separate plan)

These were identified but intentionally excluded — they need their own migration:

- **App.css `:root {}` block** — contains `--bg-primary`, `--bg-secondary`, `--bg-board` (casino-green), `--tray-height`, `--space-*` variables with 16 active references across the codebase. Removing them requires updating all call sites in a coordinated pass.
- **`walnut-live.css` `body {}` and `:root {}`** — protected per CLAUDE.md; contains a `font-family: 'Avenir Next'` body override and `--wl-*` token block.
- **`!important` remediation** — App.css (181), league.css (82), premium-theme.css (74) need a dedicated specificity-fixing pass.
- **Competing `:root` token deduplication** — App.css, walnut-live.css, RacehorseMatchArena.css all define `:root` blocks. Consolidation into `tokens.css` only is a larger refactor.
