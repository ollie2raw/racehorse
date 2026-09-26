import { expect, test } from '@playwright/test';
import { installMobileFixture } from './fixtures/mobile/loader';
import { MOBILE_CANONICAL_VIEWPORT, setMobileViewport, waitForMobileVisualStability } from './fixtures/mobile/visualHarness';
import type { MobileFixtureStateId } from './fixtures/mobile/schema';

const states: MobileFixtureStateId[] = [
  'home/not-played',
  'home/completed',
  'solo/empty',
  'solo/populated',
  'solo/journey-locked',
];

for (const stateId of states) {
  test(`deterministic ${stateId}`, async ({ page }) => {
    await setMobileViewport(page, MOBILE_CANONICAL_VIEWPORT);
    const setup = await installMobileFixture(page, stateId);
    await page.goto(setup.fixture.route);
    await expect(page.locator('.rh-nav-stats .rh-nav-stat-value').first()).toHaveText('1,428');
    await expect(page.locator('.rh-nav-stats .rh-nav-stat-value').nth(1)).toHaveText('2');
    await expect(page.locator('.rh-nav-account-name')).toHaveText('racehorse_qa');
    const content = page.locator('main');
    for (const text of setup.fixture.expected.visibleText) {
      await expect(content.getByText(text, { exact: text === "Today's Race" || text === 'Single Player' }).first()).toBeVisible();
    }
    for (const text of setup.fixture.expected.absentText ?? []) {
      const scope = stateId === 'home/completed' ? page.locator('[aria-label="Daily Fritz completed results"]') : content;
      await expect(scope.getByText(text).first()).toHaveCount(0);
    }
    if (stateId.startsWith('home/')) {
      setup.assertApiUsed('/api/home/daily-summary');
      setup.assertApiUsed('/api/daily-fritz/today');
      setup.assertApiUsed('/api/ranking/profile/e2e-mobile-user');
      if (stateId === 'home/completed') {
        const today = setup.fixture.apiResponses.find((response) => response.path === '/api/daily-fritz/today')?.body as {
          verification_status?: string;
          set_result?: { version: number; format: string; setWinner: string; games: Array<{ seed: string }> };
        };
        expect(today.verification_status).toBe('verified');
        expect(today.set_result).toMatchObject({ version: 2, format: 'best_of_3', setWinner: 'player' });
        expect(today.set_result?.games).toHaveLength(2);
        expect(today.set_result?.games.every((game) => game.seed.length > 0)).toBe(true);
      }
    } else {
      setup.assertApiUsed('/api/ranking/history/e2e-mobile-user');
      setup.assertApiUsed('/api/ghost/profile/e2e-mobile-user');
      if (stateId === 'solo/empty') {
        await expect(page.locator('.sp-solo-mode-card').first().getByText('—')).toHaveCount(2);
      }
      if (stateId === 'solo/journey-locked') {
        await expect(page.locator('.sp-solo-mode-card--locked')).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Coming Soon' })).toBeDisabled();
        await expect(page.locator('.sp-solo-mode-card').first().getByText('1', { exact: true })).toBeVisible();
      }
    }
    await waitForMobileVisualStability(page);
    setup.assertNoUnexpectedApiCalls();
  });
}

test('fixture contract rejects an unlisted API request', async ({ page }) => {
  const setup = await installMobileFixture(page, 'home/not-played');
  await page.goto('/');
  const status = await page.evaluate(async () => (await fetch('/api/mobile-fixture-unlisted')).status);
  expect(status).toBe(599);
  expect(() => setup.assertNoUnexpectedApiCalls()).toThrow(/Unmatched API calls/);
});
