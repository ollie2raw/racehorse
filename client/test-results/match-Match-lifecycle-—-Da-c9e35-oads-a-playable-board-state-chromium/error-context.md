# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: match.spec.ts >> Match lifecycle — Daily Puzzle >> daily puzzle loads a playable board state
- Location: e2e/match.spec.ts:71:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.game-screen, .board-area, .nbl-board-canvas').first()
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for locator('.game-screen, .board-area, .nbl-board-canvas').first()

```

```yaml
- navigation:
  - img "Racehorse Logo"
  - text: RACEHORSE
  - button "Multiplayer"
  - button "Single Player"
  - button "Tournament"
  - button "Social"
  - button "Learn"
  - img
  - text: — Rating
  - button "— Friends":
    - img
    - text: — Friends
  - button "View Stats": →
  - button "Sign In":
    - text: Sign In
    - img
- button "Back to home"
- text: DAILY PUZZLE
- heading "Daily Ladder" [level=1]
- paragraph: Three curated boards in a fixed sequence. One scored run posts to the global ladder — practice stays open after you lock it in.
- article "Daily Ladder overview":
  - img "Daily Ladder puzzle boards"
  - text: TODAY'S DAILY
  - heading "Ladder" [level=2]
  - text: Same boards One daily deal for everyone. Sequenced run Solve in order — no skipping slots. Live ladder Points lock on a single scored attempt.
- region "Daily Ladder":
  - text: 1. TODAY'S LADDER
  - list "Ladder details":
    - listitem: July 8, 2026 Date
    - listitem: 0 Ladder pts
    - listitem: 0 days Streak
    - listitem: 800 pts Available
  - text: 2. LADDER PROGRESS
  - list "Ladder progress":
    - listitem:
      - text: Warm-up
      - heading "Puzzle 1" [level=3]
      - paragraph: Available now
      - paragraph: Up to 150 pts
      - text: Available now
    - listitem:
      - text: Challenge
      - heading "Puzzle 2" [level=3]
      - paragraph: Locked
      - paragraph: Complete puzzle 1 to unlock
      - text: Locked
    - listitem:
      - text: Final
      - heading "Puzzle 3" [level=3]
      - paragraph: Locked
      - paragraph: Complete puzzle 2 to unlock
      - text: Locked
  - text: 3. RUN SUMMARY Daily Ladder Mode Ready to start State 800 pts Available One attempt Run
  - alert: Session expired. Please sign in again.
  - button "Start Daily Ladder"
  - button "View Leaderboard →"
  - paragraph: Leaderboard updates after a scored run.
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | test.describe('Match lifecycle — Play vs Fritz', () => {
  4   |   test('pre-game draw screen appears before hand starts', async ({ page }) => {
  5   |     await page.goto('/');
  6   |     await page.getByText('Single Player', { exact: false }).first().click();
  7   |     await page.getByText('Play vs Fritz', { exact: false }).first().click();
  8   |     await page.getByText('Start Match', { exact: false }).first().click();
  9   | 
  10  |     // Wait for bot match screen to mount
  11  |     await expect(page.locator('.bot-match-screen, .game-screen')).toBeVisible({ timeout: 15_000 });
  12  | 
  13  |     // Either pre-game draw OR the hand is already dealt — both are valid initial states
  14  |     const hasDraw = await page.locator('.pre-game-draw-board').isVisible().catch(() => false);
  15  |     const hasHand = await page.locator('.hand-area:not(.pre-game-draw-hand-dock)').isVisible().catch(() => false);
  16  |     expect(hasDraw || hasHand).toBe(true);
  17  |   });
  18  | 
  19  |   test('HUD elements are present during a match', async ({ page }) => {
  20  |     await page.goto('/');
  21  |     await page.getByText('Single Player', { exact: false }).first().click();
  22  |     await page.getByText('Play vs Fritz', { exact: false }).first().click();
  23  |     await page.getByText('Start Match', { exact: false }).first().click();
  24  |     await expect(page.locator('.game-screen')).toBeVisible({ timeout: 15_000 });
  25  | 
  26  |     // Complete pre-game draw if active
  27  |     const drawTile = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
  28  |     if (await drawTile.isVisible()) {
  29  |       await drawTile.click();
  30  |       // Wait for hand to deal
  31  |       await expect(page.locator('.hand-area:not(.pre-game-draw-hand-dock)')).toBeVisible({ timeout: 10_000 });
  32  |     }
  33  | 
  34  |     // Score pills
  35  |     await expect(page.locator('.wl-player-pill, .rh-player-pill').first()).toBeVisible({ timeout: 10_000 });
  36  | 
  37  |     // Turn label
  38  |     await expect(page.locator('.wl-turn-label, .rh-turn-label')).toBeVisible({ timeout: 10_000 });
  39  | 
  40  |     // Hand tray
  41  |     await expect(page.locator('.wl-hand-area, .hand-area')).toBeVisible({ timeout: 10_000 });
  42  |   });
  43  | 
  44  |   test('tile rack is interactive — clicking a tile selects it', async ({ page }) => {
  45  |     await page.goto('/');
  46  |     await page.getByText('Single Player', { exact: false }).first().click();
  47  |     await page.getByText('Play vs Fritz', { exact: false }).first().click();
  48  |     await page.getByText('Start Match', { exact: false }).first().click();
  49  |     await expect(page.locator('.game-screen')).toBeVisible({ timeout: 15_000 });
  50  | 
  51  |     // Complete pre-game draw if active
  52  |     const drawTile = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
  53  |     if (await drawTile.isVisible()) {
  54  |       await drawTile.click();
  55  |     }
  56  | 
  57  |     // Wait for hand to be dealt
  58  |     await expect(page.locator('.hand-area .domino-body, .hand-area [class*="domino"]').first()).toBeVisible({ timeout: 15_000 });
  59  | 
  60  |     // Click the first tile in hand (using force: true since guided-tile-wrap overlays/intercepts pointer events)
  61  |     const firstTile = page.locator('.hand-area .domino-body, .hand-area [class*="domino"]').first();
  62  |     await firstTile.click({ force: true });
  63  | 
  64  |     // After click, either a tile is selected (has active/selected class) or it was placed
  65  |     // We just verify no crash occurred and the game screen is still mounted
  66  |     await expect(page.locator('.game-screen')).toBeVisible();
  67  |   });
  68  | });
  69  | 
  70  | test.describe('Match lifecycle — Daily Puzzle', () => {
  71  |   test('daily puzzle loads a playable board state', async ({ page }) => {
  72  |     await page.goto('/#/daily');
  73  |     await expect(page.locator('.daily-puzzle-root').first()).toBeVisible({ timeout: 20_000 });
  74  | 
  75  |     // If lobby page is visible and shows start/resume button, click it to enter puzzle board
  76  |     const startBtn = page.getByRole('button', { name: /Start Daily Ladder|Resume Daily/i });
  77  |     try {
  78  |       await startBtn.waitFor({ state: 'visible', timeout: 10_000 });
  79  |       await startBtn.click();
  80  |     } catch (e) {
  81  |       // Not visible or already past this screen
  82  |     }
  83  | 
  84  |     // Must show the genuine puzzle board state — not blank, not loading, and not an error
  85  |     const boardSelector = '.game-screen, .board-area, .nbl-board-canvas';
> 86  |     await expect(page.locator(boardSelector).first()).toBeVisible({ timeout: 15_000 });
      |                                                       ^ Error: expect(locator).toBeVisible() failed
  87  |   });
  88  | });
  89  | 
  90  | test.describe('Match lifecycle — Navigation', () => {
  91  |   test('back navigation from bot match returns to hub', async ({ page }) => {
  92  |     await page.goto('/');
  93  |     await page.getByText('Single Player', { exact: false }).first().click();
  94  |     await page.getByText('Play vs Fritz', { exact: false }).first().click();
  95  |     await page.getByText('Start Match', { exact: false }).first().click();
  96  |     await expect(page.locator('.game-screen')).toBeVisible({ timeout: 15_000 });
  97  | 
  98  |     // Find and click back button
  99  |     const backBtn = page.locator('[aria-label*="back" i], [class*="back-btn"], button:has-text("Back")').first();
  100 |     if (await backBtn.isVisible()) {
  101 |       await backBtn.click();
  102 |       // Should return to hub or home — not crash
  103 |       await expect(page.locator('.screen, .sp-page').first()).toBeVisible({ timeout: 5_000 });
  104 |     } else {
  105 |       // Back button not visible yet (match in progress) — just verify no crash
  106 |       await expect(page.locator('.game-screen')).toBeVisible();
  107 |     }
  108 |   });
  109 | 
  110 |   test('multiplayer lobby loads without auth', async ({ page }) => {
  111 |     await page.goto('/');
  112 |     await page.getByText('Multiplayer', { exact: false }).first().click();
  113 |     // Should show matchmaking or sign-in prompt — not crash
  114 |     await expect(page.locator('.screen, .mm-page, .multiplayer-hub').first()).toBeVisible({ timeout: 10_000 });
  115 |   });
  116 | });
  117 | 
```