/**
 * The Play vs Fritz end-of-match card: one card, the score once (in the line under the headline), the review as the main action with an honest status,
 * Rematch second, and quiet exits. Rendered through the e2e-only harness (e2e/harness/fritz-result.html) with fixture review states; no server.
 *
 * The old layout fails this: it had a four-tile stat grid and a standings list repeating the score, a Rating block that read "syncing…", and the
 * review as a text link. Here every action must be reachable and 44px tall at phone, landscape and desktop sizes, with no horizontal overflow.
 */
import { expect, test, type Page } from '@playwright/test';

const VIEWPORTS = [
  { name: 'phone portrait', width: 390, height: 844 },
  { name: 'small phone', width: 320, height: 640 },
  { name: 'phone landscape', width: 844, height: 390 },
  { name: 'desktop', width: 1280, height: 720 },
] as const;

const HARNESS = '/e2e/harness/fritz-result.html';

async function open(page: Page, query: string) {
  // Only the dev server: nothing reaches Supabase or any other host.
  await page.route((url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1', (route) => route.abort());
  await page.goto(`${HARNESS}?${query}`);
  await expect(page.getByRole('dialog', { name: 'Play vs Fritz result' })).toBeVisible();
}

async function expectReachableAndTall(page: Page, names: string[]) {
  const card = page.getByRole('dialog', { name: 'Play vs Fritz result' });
  for (const name of names) {
    const button = card.getByRole('button', { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box, `${name} has a box`).not.toBeNull();
    expect(box!.height, `${name} is at least 44px tall`).toBeGreaterThanOrEqual(44 - 0.5);
    expect(box!.x, `${name} is inside the viewport horizontally`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${name} does not overflow right`).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(box!.y + box!.height, `${name} can be scrolled into view`).toBeLessThanOrEqual(viewport.height + 0.5);
  }
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('is one card with the score once, the review first, and nothing that repeats it', async ({ page }) => {
      await open(page, 'view=ready&rating=1');
      const card = page.getByRole('dialog', { name: 'Play vs Fritz result' });
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await expect(card.locator('.dfd__headline')).toHaveText('Victory');
      await expect(card.locator('.dfd__sub')).toHaveText('You beat Fritz, 67–23.');
      // The old card repeated the score as a stat grid and a standings list, and a margin tile.
      await expect(card.locator('.dfd__stats')).toHaveCount(0);
      await expect(card.locator('[aria-label="Final standings"]')).toHaveCount(0);
      await expect(card.getByText('Margin')).toHaveCount(0);
      // Accuracy and grade only because they exist; a confirmed rating is one quiet line.
      await expect(card.getByText('87.2%')).toBeVisible();
      await expect(card.getByText('Rating +12 · 2256')).toBeVisible();
      // Review is the primary action and comes before Rematch.
      const review = card.getByRole('button', { name: 'Review game', exact: true });
      await expect(review).toHaveClass(/dfd__btn--primary/);
      const rematch = card.getByRole('button', { name: 'Rematch', exact: true });
      await expect(rematch).not.toHaveClass(/dfd__btn--primary/);
      const [reviewBox, rematchBox] = [await review.boundingBox(), await rematch.boundingBox()];
      expect(reviewBox!.y).toBeLessThan(rematchBox!.y);
      await expectReachableAndTall(page, ['Review game', 'Rematch', 'Change setup', 'Home']);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test('says what the analysis is doing without blocking the review', async ({ page }) => {
      await open(page, 'view=running&lost=1');
      const card = page.getByRole('dialog', { name: 'Play vs Fritz result' });
      await expect(card.locator('.dfd__headline')).toHaveText('Defeat');
      await expect(card.locator('.dfd__sub')).toHaveText('Fritz won, 66–47.');
      await expect(card.getByText('Analyzing 12 of 50 moves')).toBeVisible();
      await expect(card.getByRole('progressbar', { name: 'Analysis progress' })).toHaveAttribute('aria-valuenow', '12');
      // The old card put "Analyzing game…" where the accuracy figure goes and sat on it for minutes.
      await expect(card.getByText('Analyzing game…')).toHaveCount(0);
      await expect(card.getByText('syncing')).toHaveCount(0);
      await expect(card.getByRole('button', { name: 'Review game', exact: true })).toBeEnabled();
      await expectReachableAndTall(page, ['Review game', 'Rematch', 'Change setup', 'Home']);
    });

    test('a review that is not ready cannot be opened, and one that failed can be retried', async ({ page }) => {
      await open(page, 'view=preparing');
      const card = page.getByRole('dialog', { name: 'Play vs Fritz result' });
      await expect(card.getByRole('button', { name: 'Review game', exact: true })).toBeDisabled();
      await expect(card.getByText('Preparing your review…')).toBeVisible();

      await open(page, 'view=unavailable');
      await expect(card.getByRole('button', { name: 'Analyze again', exact: true })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Review game', exact: true })).toBeEnabled();
      await expectReachableAndTall(page, ['Analyze again', 'Review game', 'Rematch', 'Change setup', 'Home']);
    });

    test('says Queued before the analysis starts, and offers Try again once it stalls', async ({ page }) => {
      await open(page, 'view=queued');
      const card = page.getByRole('dialog', { name: 'Play vs Fritz result' });
      await expect(card.getByText(/^Queued/)).toBeVisible();
      await expect(card.getByRole('progressbar')).toHaveCount(0);
      await expect(card.getByRole('button', { name: 'Review game', exact: true })).toBeEnabled();

      await open(page, 'view=stalled');
      await expect(card.getByText(/taking longer than expected/i).first()).toBeVisible();
      await expect(card.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Review game', exact: true })).toHaveClass(/dfd__btn--primary/);
      await expectReachableAndTall(page, ['Try again', 'Review game', 'Rematch', 'Change setup', 'Home']);
    });

    test('a game with no review leaves Rematch as the main action', async ({ page }) => {
      await open(page, 'view=plain');
      const card = page.getByRole('dialog', { name: 'Play vs Fritz result' });
      await expect(card.getByRole('button', { name: 'Review game', exact: true })).toHaveCount(0);
      await expect(card.getByRole('button', { name: 'Rematch', exact: true })).toHaveClass(/dfd__btn--primary/);
      await expectReachableAndTall(page, ['Rematch', 'Change setup', 'Home']);
    });
  });
}
