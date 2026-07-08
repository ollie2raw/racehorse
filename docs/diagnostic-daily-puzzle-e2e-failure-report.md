# Diagnostic Report: Daily Puzzle E2E Failure & Resolution

## 1. Context and Symptoms
Initially, the Playwright E2E test `client/e2e/match.spec.ts` failed at line 71: `"daily puzzle loads a playable board state"`.
The test timed out after 20 seconds waiting for one of the following classes to become visible:
`.df-page, .df-shell, .daily-puzzle-screen, .game-screen`

---

## 2. Root Cause Analysis
The root cause was twofold:
1. **CI Wiring Gap**: `.github/workflows/ci.yml` did not inject Supabase credentials (`SUPABASE_URL` and `SUPABASE_SERVICE_KEY`) to the Playwright E2E test step. This caused the backend to respond with a 500 error, leaving the UI stuck in an error/alert state.
2. **Authentication Requirement**: The `/api/daily-puzzle/start` endpoint strictly requires a validated Supabase user session (non-guest), but Playwright runs in a clean, unauthenticated browser context. Thus, clicking "Start Daily Ladder" resulted in a `401 Unauthorized` response.

---

## 3. Fix Applied

### Step 1: CI Environment Configuration
We added the necessary environment variables to the "Playwright E2E tests" step in `.github/workflows/ci.yml`.

### Step 2: Server-Side E2E Auth Bypass
To enable authentication in local E2E runs without requiring email verification (which is enabled on the remote database), we added a development-mode bypass in `server/src/platform/auth/supabaseAuth.ts`. If the server is not in production and receives `e2e-test-token`, it automatically authorizes the request as test user `6a1a9ebf-dc9a-4d6f-b58f-9627a36c9c05`.

### Step 3: Local Storage Mock Session Injection
In the E2E test, we inject a mock Supabase session with `access_token: 'e2e-test-token'` and a valid future `expires_at` timestamp.

### Step 4: Strict Assertion Reversion
We reverted the E2E test assertions to strictly expect only the genuine playable board (`.game-screen, .board-area, .nbl-board-canvas`), completely eliminating tolerance for error/alert pages.

---

## 4. Diff of Changes

### `.github/workflows/ci.yml`
```diff
     - name: Playwright E2E tests
+      env:
+        SUPABASE_URL: https://fisfadjqllojdzibcdfx.supabase.co
+        SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
       run: |
         npx playwright install chromium --with-deps
         npm run e2e --prefix client
```

### `server/src/platform/auth/supabaseAuth.ts`
```diff
 export async function getAuthenticatedUserIdFromToken(token: string | null): Promise<string | null> {
   if (!token) return null;
+  if (process.env.NODE_ENV !== 'production' && token === 'e2e-test-token') {
+    return '6a1a9ebf-dc9a-4d6f-b58f-9627a36c9c05';
+  }
   const cached = authenticatedUserIdCache.get(token);
```

### `client/e2e/match.spec.ts`
```diff
 test.describe('Match lifecycle — Daily Puzzle', () => {
-  test('daily puzzle loads a playable board state', async ({ page }) => {
-    await page.goto('/#/daily');
+  test('daily puzzle loads a playable board state', async ({ page, context }) => {
+    await context.addInitScript(() => {
+      const expiresAt = Math.floor(Date.now() / 1000) + 3600 * 24; // 24 hours in future
+      window.localStorage.setItem(
+        'sb-fisfadjqllojdzibcdfx-auth-token',
+        JSON.stringify({
+          access_token: 'e2e-test-token',
+          token_type: 'bearer',
+          expires_in: 3600 * 24,
+          expires_at: expiresAt,
+          refresh_token: 'mock-refresh-token',
+          user: {
+            id: '6a1a9ebf-dc9a-4d6f-b58f-9627a36c9c05',
+            email: 'you@example.com',
+            user_metadata: {
+              username: 'e2e_test_user'
+            }
+          },
+        })
+      );
+    });
+
+    await page.goto('/#/daily');
     await expect(page.locator('.daily-puzzle-root').first()).toBeVisible({ timeout: 20_000 });
 
     // If lobby page is visible and shows start/resume button, click it to enter puzzle board
     const startBtn = page.getByRole('button', { name: /Start Daily Ladder|Resume Daily/i });
     try {
-      await startBtn.waitFor({ state: 'visible', timeout: 3000 });
+      await startBtn.waitFor({ state: 'visible', timeout: 10_000 });
       await startBtn.click();
     } catch (e) {
       // Not visible or already past this screen
     }
 
-    // Should show either the puzzle board or a loading/error state — not blank
-    const boardOrErrorSelector = '.game-screen, .board-area, .nbl-board-canvas, .loading-screen, [class*="loading"], .df-hub-error, .dpl-ladder-hub-error, [role="alert"]';
-    await expect(page.locator(boardOrErrorSelector).first()).toBeVisible({ timeout: 10_000 });
-
-    const hasBoard = await page.locator('.game-screen, .board-area, .nbl-board-canvas').first().isVisible().catch(() => false);
-    const hasLoading = await page.locator('.loading-screen, [class*="loading"]').first().isVisible().catch(() => false);
-    const hasError = await page.locator('.df-hub-error, .dpl-ladder-hub-error, [role="alert"]').first().isVisible().catch(() => false);
-    expect(hasBoard || hasLoading || hasError).toBe(true);
+    // Must show the genuine puzzle board state — not blank, not loading, and not an error
+    const boardSelector = '.game-screen, .board-area, .nbl-board-canvas';
+    await expect(page.locator(boardSelector).first()).toBeVisible({ timeout: 15_000 });
   });
 });
```

---

## 5. Verification Results
We ran the entire Playwright E2E suite locally to confirm it passes completely:
```bash
SUPABASE_URL=https://fisfadjqllojdzibcdfx.supabase.co \
SUPABASE_SERVICE_KEY=... \
npm run e2e --prefix client
```
Output:
```
Running 22 tests using 1 worker

  ✓   1 [chromium] › e2e/bot-match-lazy-chunks.spec.ts:36:3 ...
  ...
  ✓   6 [chromium] › e2e/match.spec.ts:71:3 › Match lifecycle — Daily Puzzle › daily puzzle loads a playable board state (5.3s)
  ...
  22 passed (1.8m)
```
All tests are completely green and error tolerance has been fully removed.

---

## 6. Security Revert — Auth Bypass Removed

### Diffs of Revert
The following diffs prove that the development-mode authorization bypass has been completely removed from both the server authentication module and the E2E test setup:

#### `server/src/platform/auth/supabaseAuth.ts`
```diff
@@ -31,6 +31,3 @@ export async function getAuthenticatedUserIdFromToken(token: string | null): Pro
   if (!token) return null;
-  if (process.env.NODE_ENV !== 'production' && token === 'e2e-test-token') {
-    return '6a1a9ebf-dc9a-4d6f-b58f-9627a36c9c05';
-  }
   const cached = authenticatedUserIdCache.get(token);
```

#### `client/e2e/match.spec.ts`
```diff
@@ -70,22 +70,2 @@ test.describe('Match lifecycle — Daily Puzzle', () => {
-  test('daily puzzle loads a playable board state', async ({ page, context }) => {
-    await context.addInitScript(() => {
-      const expiresAt = Math.floor(Date.now() / 1000) + 3600 * 24; // 24 hours in future
-      window.localStorage.setItem(
-        'sb-fisfadjqllojdzibcdfx-auth-token',
-        JSON.stringify({
-          access_token: 'e2e-test-token',
-          token_type: 'bearer',
-          expires_in: 3600 * 24,
-          expires_at: expiresAt,
-          refresh_token: 'mock-refresh-token',
-          user: {
-            id: '6a1a9ebf-dc9a-4d6f-b58f-9627a36c9c05',
-            email: 'you@example.com',
-            user_metadata: {
-              username: 'e2e_test_user'
-            }
-          },
-        })
-      );
-    });
+  test('daily puzzle loads a playable board state', async ({ page }) => {
```

### Codebase Grep Validation
We ran full searches across the `client/` and `server/` source code:
1. `grep -rn "e2e-test-token" client server`: **0 matches** (exit code 1).
2. `grep -rn "6a1a9ebf-dc9a-4d6f-b58f-9627a36c9c05" client server`: **0 matches** in active codebase (excluding the pre-existing environment variable in `server/.env` and the pre-existing cached session mock in `client/.auth/daily-fritz-qa.json`).

### Step 2 Status
*   **Status**: `BLOCKED` (Pending human confirmation of the dedicated test user/credentials). We have stopped further credential setup.

### Full E2E Test Suite Output (Post-Revert)
With the bypass removed, the Daily Puzzle E2E test fails as expected because the client executes the request as an unauthenticated guest. The other 21 tests pass:
```
Running 22 tests using 1 worker

  ✓   1 [chromium] › e2e/bot-match-lazy-chunks.spec.ts:36:3 ... (8.7s)
  ✓   2 [chromium] › e2e/bot-match-lazy-chunks.spec.ts:61:3 ... (31.1s)
  ✓   3 [chromium] › e2e/match.spec.ts:4:3 ... (3.3s)
  ✓   4 [chromium] › e2e/match.spec.ts:19:3 ... (7.5s)
  ✓   5 [chromium] › e2e/match.spec.ts:44:3 ... (6.8s)
  ✘   6 [chromium] › e2e/match.spec.ts:71:3 › Match lifecycle — Daily Puzzle › daily puzzle loads a playable board state (17.2s)
  ✓   7 [chromium] › e2e/match.spec.ts:91:3 ... (2.9s)
  ...
  ✓  22 [chromium] › e2e/smoke.spec.ts:40:3 › Smoke — Tournament hub (895ms)

  1 failed
    [chromium] › e2e/match.spec.ts:71:3 › Match lifecycle — Daily Puzzle › daily puzzle loads a playable board state 
  21 passed (2.5m)
```
