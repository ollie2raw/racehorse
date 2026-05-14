# Casino-Green Purge & Font Load Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the casino-green board theme from the live game and fix the duplicate/banned Google Fonts load that survived the previous font purge.

**Architecture:** Two independent changes — (1) delete the CSS @import in index.css that still loads Rajdhani, Space Grotesk, and Montserrat despite us removing them from index.html; (2) replace the `.board-area` casino-green background in App.css with the correct dark obsidian token, then delete the now-unused `--bg-board*` `:root` vars.

**Tech Stack:** CSS, design tokens at `client/src/styles/tokens.css`. No TypeScript changes.

**Protected files — do NOT touch:**
- `client/src/styles/walnut-live.css` — live game tile rules, explicitly off-limits per CLAUDE.md
- `client/src/learn/` — off-limits per CLAUDE.md
- `client/src/learning/` — off-limits per CLAUDE.md

---

### Task 1: Remove banned font @import from index.css

**Files:**
- Modify: `client/src/index.css` (line 1 only)

**Context:** `index.css` line 1 contains a Google Fonts `@import` that loads five font families including the banned Rajdhani, Space Grotesk, and Montserrat. This means those fonts are still downloading in production despite us replacing all their CSS usages. The `<link>` tag in `index.html` already loads Barlow Condensed + Outfit correctly, so this `@import` is entirely redundant AND harmful.

- [ ] **Step 1: Confirm what line 1 of index.css looks like**

```bash
head -3 /Users/olivermorid/racehorse-dominoes/client/src/index.css
```

Expected output — line 1 is:
```
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Montserrat:wght@900&family=Outfit:wght@700;800;900&family=Rajdhani:wght@500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');
```

- [ ] **Step 2: Delete line 1 of index.css**

Use the Edit tool to remove the entire `@import url(...)` line from `client/src/index.css`. The file should start with `@tailwind base;` after the edit.

The `old_string` to remove is exactly:
```
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Montserrat:wght@900&family=Outfit:wght@700;800;900&family=Rajdhani:wght@500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');

```
(include the trailing newline so the file doesn't gain a blank line)

- [ ] **Step 3: Verify**

```bash
head -3 /Users/olivermorid/racehorse-dominoes/client/src/index.css
```

Expected: first line is `@tailwind base;` — no `@import` anywhere at the top.

```bash
grep "@import" /Users/olivermorid/racehorse-dominoes/client/src/index.css
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd /Users/olivermorid/racehorse-dominoes
git add client/src/index.css
git commit -m "fix: remove banned font @import from index.css (Rajdhani, Space Grotesk, Montserrat still loading)"
```

---

### Task 2: Replace casino-green board background with dark obsidian

**Files:**
- Modify: `client/src/App.css` (lines ~2903–2935, the `.board-area` block)

**Context:** `.board-area` in App.css uses `var(--bg-board-gradient)` as its background — a radial gradient rendering pure casino-green felt (`#2a7a42 → #1e5631 → #174525`). Its `::before` pseudo-element applies `var(--bg-board-pattern)` — a repeating green grid. The Racehorse manifesto explicitly lists "gambling app" and "casino-like" as forbidden aesthetics. The board should feel like "a futuristic competitive game table."

Replace both with the dark obsidian design token. The `::before` pseudo-element (the green grid overlay) should be removed entirely — it has no place in the dark aesthetic.

- [ ] **Step 1: Read the current .board-area block**

```bash
sed -n '2900,2940p' /Users/olivermorid/racehorse-dominoes/client/src/App.css
```

Confirm it matches this structure:
```css
.board-area {
  flex: 0 0 auto;
  width: 100vw;
  height: calc(100dvh - var(--tray-height));
  min-height: 0;
  background: var(--bg-board-gradient);
  border-radius: 0 0 16px 16px;
  box-shadow: none;
  overflow: hidden;
  position: relative;
}

.board-area::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--bg-board-pattern);
  pointer-events: none;
  opacity: 0.22;
  z-index: 0;
}
```

- [ ] **Step 2: Replace .board-area background and remove .board-area::before**

Use the Edit tool. Replace:
```css
.board-area {
  flex: 0 0 auto;
  width: 100vw;
  height: calc(100dvh - var(--tray-height));
  min-height: 0;
  background: var(--bg-board-gradient);
  border-radius: 0 0 16px 16px;
  box-shadow: none;
  overflow: hidden;
  position: relative;
}

.board-area::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--bg-board-pattern);
  pointer-events: none;
  opacity: 0.22;
  z-index: 0;
}
```

With:
```css
.board-area {
  flex: 0 0 auto;
  width: 100vw;
  height: calc(100dvh - var(--tray-height));
  min-height: 0;
  background: var(--bg-obsidian);
  border-radius: 0 0 16px 16px;
  box-shadow: none;
  overflow: hidden;
  position: relative;
}
```

- [ ] **Step 3: Verify no more references to --bg-board-gradient or --bg-board-pattern**

```bash
grep "bg-board" /Users/olivermorid/racehorse-dominoes/client/src/App.css
```

Expected: no output (no remaining references).

- [ ] **Step 4: Commit the board background fix**

```bash
cd /Users/olivermorid/racehorse-dominoes
git add client/src/App.css
git commit -m "fix: replace casino-green board background with var(--bg-obsidian)"
```

---

### Task 3: Delete the casino-green :root vars from App.css

**Files:**
- Modify: `client/src/App.css` (`:root {}` block at the top of the file)

**Context:** After Task 2, `--bg-board-gradient` and `--bg-board-pattern` have no more callers. `--bg-board` (the base color) was never referenced anywhere. All three are dead casino-green vars polluting the global `:root`. Delete them.

- [ ] **Step 1: Confirm the three vars are in App.css :root and are unreferenced**

```bash
grep "bg-board" /Users/olivermorid/racehorse-dominoes/client/src/App.css
```

Expected: only matches inside the `:root {}` block (the variable definitions), zero matches elsewhere in the file.

```bash
grep -rn "var(--bg-board" /Users/olivermorid/racehorse-dominoes/client/src --include="*.css" --include="*.tsx"
```

Expected: no output.

- [ ] **Step 2: Read the :root block to identify the exact lines**

```bash
grep -n "bg-board\|bg-board-gradient\|bg-board-pattern\|Premium felt\|felt green" /Users/olivermorid/racehorse-dominoes/client/src/App.css
```

This will show the line numbers of the three vars and the comment above them.

- [ ] **Step 3: Delete the casino-green vars and their comment from :root**

Use the Edit tool. The block to remove looks like:

```css
  /* Premium felt green table */
  --bg-board: #1e5631;
  --bg-board-gradient: radial-gradient(ellipse at center, #2a7a42 0%, #1e5631 50%, #174525 100%);
  --bg-board-pattern: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0, 0, 0, 0.03) 2px,
    rgba(0, 0, 0, 0.03) 4px
  );

```

Replace with nothing (empty string — delete the block entirely including the trailing blank line).

- [ ] **Step 4: Verify**

```bash
grep "bg-board\|felt green\|felt table" /Users/olivermorid/racehorse-dominoes/client/src/App.css
```

Expected: no output.

- [ ] **Step 5: TypeScript check**

```bash
cd /Users/olivermorid/racehorse-dominoes/client && npx tsc --noEmit 2>&1
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
cd /Users/olivermorid/racehorse-dominoes
git add client/src/App.css
git commit -m "chore: delete casino-green :root vars from App.css (--bg-board, --bg-board-gradient, --bg-board-pattern)"
```

---

### Task 4: Final verification

- [ ] **Step 1: No banned fonts loading**

```bash
grep "@import\|Rajdhani\|Space Grotesk\|Montserrat" /Users/olivermorid/racehorse-dominoes/client/src/index.css
```

Expected: no output.

- [ ] **Step 2: No casino-green vars in codebase**

```bash
grep -rn "bg-board\|#1e5631\|#2a7a42\|#174525\|felt green\|felt table" \
  /Users/olivermorid/racehorse-dominoes/client/src --include="*.css"
```

Expected: no output.

- [ ] **Step 3: board-area uses correct token**

```bash
grep -A 5 "\.board-area {" /Users/olivermorid/racehorse-dominoes/client/src/App.css | head -8
```

Expected: `background: var(--bg-obsidian);`

- [ ] **Step 4: TypeScript still clean**

```bash
cd /Users/olivermorid/racehorse-dominoes/client && npx tsc --noEmit 2>&1
```

Expected: no output.

- [ ] **Step 5: Git log shows clean commits**

```bash
cd /Users/olivermorid/racehorse-dominoes && git log --oneline -5
```
