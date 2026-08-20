import { expect, test } from '@playwright/test';
import { assertDesktopNavRegionsDoNotOverlap } from './helpers/navOverlap';

test.describe('browser routing', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('hasSeenWelcome', '1'));
  });

  test('root and in-app navigation use real paths', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: "Today's Race" })).toBeVisible();

    await page
      .getByRole('region', { name: 'Daily Fritz' })
      .getByRole('button', { name: /play|continue|view results/i })
      .click();

    await expect(page).toHaveURL(/\/daily-fritz$/);
    await expect(page.getByRole('heading', { name: 'Daily Fritz' })).toBeVisible();
  });

  test('direct deep load and refresh keep the route', async ({ page }) => {
    await page.goto('/daily');
    await expect(page).toHaveURL(/\/daily$/);
    await expect(page.locator('.df-page, .df-shell, .daily-puzzle-screen, .loading-screen').first()).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(page).toHaveURL(/\/daily$/);
    await expect(page.locator('.df-page, .df-shell, .daily-puzzle-screen, .loading-screen').first()).toBeVisible({ timeout: 15_000 });
  });

  test('legacy hash bookmarks are promoted to browser paths', async ({ page }) => {
    await page.goto('/#/learn');
    await expect(page).toHaveURL(/\/learn$/);
    await expect(page.getByRole('heading', { name: 'Learn' })).toBeVisible({ timeout: 15_000 });
  });

  test('approved routes survive direct loads and refreshes', async ({ page }) => {
    const paths = [
      '/multiplayer',
      '/multiplayer/private',
      '/solo/fritz',
      '/solo/ghost',
      '/social',
      '/players/route-smoke',
      '/daily-fritz/leaderboard',
      '/daily/leaderboard',
      '/learn/how-to-play',
      '/tournament/route-smoke',
      '/tournament/route-smoke/result',
    ];

    for (const path of paths) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`));
      await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });
    }

    await page.reload();
    await expect(page).toHaveURL(/\/tournament\/route-smoke\/result$/);
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });
  });

  test('browser back restores the previous routed screen', async ({ page }) => {
    await page.goto('/solo');
    await page.locator('.sp-solo-mode-card').filter({ hasText: 'Play vs Fritz' }).click();
    await expect(page).toHaveURL(/\/solo\/fritz$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/solo$/);
    await expect(page.getByRole('heading', { name: /single player/i })).toBeVisible();
  });

  test('Social opens the global rating leaderboard', async ({ page }) => {
    await page.goto('/social');
    await page.getByRole('button', { name: 'View Leaderboard' }).click();

    await expect(page.getByRole('heading', { name: 'Leaderboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Global', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'By Mode', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/social$/);
  });

  test('desktop nav regions keep separate hit targets at common widths', async ({ page }) => {
    for (const width of [769, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 720 });
      await page.goto('/solo', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Single Player' })).toBeVisible({ timeout: 15_000 });
      await assertDesktopNavRegionsDoNotOverlap(page);

      await page.getByRole('button', { name: 'Learn', exact: true }).click();
      await expect(page).toHaveURL(/\/learn$/);
      await expect(page.getByRole('heading', { name: 'Learn' })).toBeVisible({ timeout: 15_000 });
      await assertDesktopNavRegionsDoNotOverlap(page);

      await page.getByRole('button', { name: 'Racehorse home' }).click();
      await expect(page).toHaveURL(/\/$/);
    }
  });

  for (const path of [
    '/social',
    '/daily-fritz',
    '/daily-fritz/leaderboard',
    '/daily',
    '/daily/leaderboard',
    '/solo',
    '/solo/fritz',
    '/solo/ghost',
    '/multiplayer',
    '/multiplayer/private',
    '/journey',
    '/learn',
    '/learn/how-to-play',
    '/tournament',
  ]) {
    test(`the shared logo returns ${path} to the current homepage without a reload`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      const logo = page.getByRole('button', { name: 'Racehorse home' });
      await expect(logo).toBeVisible({ timeout: 15_000 });

      const marker = `logo-navigation:${path}`;
      await page.evaluate((value) => {
        (window as Window & { __logoNavigationMarker?: string }).__logoNavigationMarker = value;
      }, marker);
      const documentRequests: string[] = [];
      page.on('request', (request) => {
        if (request.resourceType() === 'document') documentRequests.push(request.url());
      });

      await logo.click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('heading', { name: "Today's Race" })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Multiplayer Online', { exact: true })).not.toBeVisible();
      expect(await page.evaluate(
        (value) => (window as Window & { __logoNavigationMarker?: string }).__logoNavigationMarker === value,
        marker,
      )).toBe(true);
      expect(documentRequests).toEqual([]);
    });
  }
});
