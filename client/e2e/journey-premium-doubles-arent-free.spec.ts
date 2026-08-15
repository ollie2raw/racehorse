import { test, expect, type Page, type TestInfo } from '@playwright/test';

const progress = { version: 2, activeChapterId: 'ch1-fritz-trail', chapters: { 'ch1-fritz-trail': { completedNodeIds: ['ch1-n01','ch1-n02','ch1-n03','ch1-n04','ch1-n05','ch1-n06','ch1-n07','ch1-n08'], lastVisitedNodeId: 'ch1-n09', completedAt: null, completionCelebrated: false } }, updatedAt: '2026-01-01T00:00:00.000Z' };
function guard(page: Page) { const errors: string[] = []; page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`)); page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); }); page.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()}`)); return errors; }
async function shot(page: Page, info: TestInfo, name: string) { await page.screenshot({ path: info.outputPath(name), fullPage: true }); }
async function open(page: Page) {
  await page.goto('/journey');
  await page.getByLabel('Pressure Hand, Current').click();
  await page.locator('.rh-journey-detail__actions').getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Doubles Aren’t Free' })).toBeVisible();
  await page.getByRole('button', { name: /take a seat/i }).click();
  await expect(page.getByText('Step 1 / 3')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Step 2 / 3')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Step 3 / 3')).toBeVisible();
  await page.getByRole('button', { name: /continue to decision/i }).click();
}
async function move(page: Page, tile: string, end: RegExp, keyboard = false) {
  const tileButton = page.getByRole('button', { name: tile });
  if (keyboard) { await tileButton.focus(); await page.keyboard.press('Space'); } else await tileButton.click();
  const endButton = page.getByRole('button', { name: end });
  if (keyboard) { await endButton.focus(); await page.keyboard.press('Enter'); } else await endButton.click();
  await page.getByRole('button', { name: /submit move/i }).click();
}
async function finish(page: Page, info: TestInfo) {
  await expect(page.locator('[data-stage-id="guided-decision"]')).toHaveAttribute('data-scenario-id', 'scenario:doubles-guided');
  await move(page, 'Domino 4-4', /right end/i); await expect(page.getByText('The double narrowed your follow-up.', { exact: true })).toBeVisible(); await shot(page, info, 'guided-wrong-double.png');
  await page.getByRole('button', { name: /try again/i }).click(); await move(page, 'Domino 3-6', /left end/i, true); await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.locator('[data-stage-id="independent-practice"]')).toHaveAttribute('data-scenario-id', 'scenario:doubles-practice-hold-1'); await shot(page, info, 'practice-hold-double.png');
  await move(page, 'Domino 4-4', /right end/i); await expect(page.getByText('The double narrowed your follow-up.', { exact: true })).toBeVisible(); await page.getByRole('button', { name: /new position/i }).click();
  await expect(page.locator('[data-stage-id="independent-practice"]')).toHaveAttribute('data-scenario-id', 'scenario:doubles-practice-hold-2'); await move(page, 'Domino 3-6', /left end/i); await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.locator('[data-stage-id="proof"]')).toHaveAttribute('data-scenario-id', 'scenario:doubles-proof-hold-1'); await shot(page, info, 'proof-hold-position.png');
  await move(page, 'Domino 4-4', /right end/i); await expect(page.getByText('The double narrowed your follow-up.', { exact: true })).toBeVisible(); await page.getByRole('button', { name: /new position/i }).click();
  await expect(page.locator('[data-stage-id="proof"]')).toHaveAttribute('data-scenario-id', 'scenario:doubles-proof-hold-2'); await page.getByRole('button', { name: 'Domino 4-4' }).click(); await page.getByRole('button', { name: /play on right end/i }).click(); await page.getByRole('button', { name: /submit move/i }).click(); await page.getByRole('button', { name: /new position/i }).click();
  await expect(page.locator('[data-stage-id="proof"]')).toHaveAttribute('data-scenario-id', 'scenario:doubles-proof-play-1'); await shot(page, info, 'proof-play-position.png'); await move(page, 'Domino 4-4', /right end/i); await page.getByRole('button', { name: /continue/i }).click(); await expect(page.getByRole('heading', { name: 'Proof challenge passed' })).toBeVisible();
}
test.describe('Journey premium Doubles Aren’t Free', () => {
  test.beforeEach(async ({ page }) => { await page.addInitScript((fixture) => localStorage.setItem('rh_journey_progress_v1', JSON.stringify(fixture)), progress); });
  test('desktop completes, replays, abandons, and preserves completion', async ({ page }, info) => { const errors = guard(page); await open(page); await shot(page, info, 'demo-step.png'); await finish(page, info); await shot(page, info, 'completion.png'); await page.getByRole('button', { name: /return to journey/i }).click(); await expect(page.getByLabel('Pressure Hand, Completed')).toBeVisible(); await page.getByLabel('Pressure Hand, Completed').click(); await page.getByRole('button', { name: /replay lesson/i }).click(); await page.getByRole('button', { name: 'Exit lesson' }).click(); await expect(page.getByLabel('Pressure Hand, Completed')).toBeVisible(); expect(errors).toEqual([]); });
  test('mobile completes the full lesson without horizontal overflow', async ({ page }, info) => { const errors = guard(page); await page.setViewportSize({ width: 390, height: 844 }); await open(page); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true); await shot(page, info, 'demo-mobile.png'); await finish(page, info); await shot(page, info, 'completion-mobile.png'); await page.getByRole('button', { name: /return to journey/i }).click(); await expect(page.getByLabel('Pressure Hand, Completed')).toBeVisible(); expect(errors).toEqual([]); });
});
