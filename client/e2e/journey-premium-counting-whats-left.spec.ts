import { test, expect, type Page, type TestInfo } from '@playwright/test';

const progress = { version: 2, activeChapterId: 'ch1-fritz-trail', chapters: { 'ch1-fritz-trail': { completedNodeIds: ['ch1-n01','ch1-n02','ch1-n03','ch1-n04','ch1-n05','ch1-n06','ch1-n07'], lastVisitedNodeId: 'ch1-n08', completedAt: null, completionCelebrated: false } }, updatedAt: '2026-01-01T00:00:00.000Z' };

function guard(page: Page) { const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message)); page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); }); return errors; }
async function shot(page: Page, info: TestInfo, name: string) { await page.screenshot({ path: info.outputPath(name), fullPage: true }); }
async function open(page: Page) {
  await page.goto('/#/journey');
  await page.getByLabel('Puzzle Gate, Current').click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Counting What’s Left' })).toBeVisible();
  await page.getByRole('button', { name: /take a seat/i }).click();
  await page.getByRole('button', { name: /i see the known tiles/i }).click();
}
async function chooseCount(page: Page, value: number) { await page.getByRole('radio', { name: String(value) }).check(); }
async function chooseMove(page: Page, tile: string, end: RegExp) { await page.getByRole('button', { name: tile }).click(); await page.getByRole('button', { name: end }).click(); }
async function complete(page: Page, info: TestInfo) {
  await expect(page.locator('[data-stage-id="guided-count"]')).toHaveAttribute('data-scenario-id', 'scenario:counting-guided');
  await chooseCount(page, 2); await page.getByRole('button', { name: /submit count/i }).click();
  await expect(page.getByText('The double is one tile.', { exact: true })).toBeVisible(); await shot(page, info, 'guided-wrong-count.png');
  await page.getByRole('button', { name: /try again/i }).click();
  const correct = page.getByRole('radio', { name: '3' }); await correct.focus(); await page.keyboard.press('Space'); await expect(correct).toHaveAttribute('aria-checked', 'true'); await page.getByRole('button', { name: /submit count/i }).click(); await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.locator('[data-stage-id="independent-practice"]')).toHaveAttribute('data-scenario-id', 'scenario:counting-practice-1');
  await chooseCount(page, 2); await chooseMove(page, 'Domino 1-6', /left end/i); await page.getByRole('button', { name: /submit move/i }).click(); await expect(page.getByText('The move works, but the count does not.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /new position/i }).click(); await expect(page.locator('[data-stage-id="independent-practice"]')).toHaveAttribute('data-scenario-id', 'scenario:counting-practice-2'); await shot(page, info, 'practice-fresh-variant.png');
  await chooseCount(page, 4); await chooseMove(page, 'Domino 0-6', /left end/i); await page.getByRole('button', { name: /submit move/i }).click(); await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.locator('[data-stage-id="proof"]')).toHaveAttribute('data-scenario-id', 'scenario:counting-proof-1'); await shot(page, info, 'proof-trap.png');
  await chooseCount(page, 3); await chooseMove(page, 'Domino 2-5', /right end/i); await page.getByRole('button', { name: /submit move/i }).click(); await expect(page.getByText('The count was right; the continuation was not.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /new position/i }).click(); await expect(page.locator('[data-stage-id="proof"]')).toHaveAttribute('data-scenario-id', 'scenario:counting-proof-2');
  await chooseCount(page, 4); await chooseMove(page, 'Domino 0-4', /left end/i); await page.getByRole('button', { name: /submit move/i }).click(); await page.getByRole('button', { name: /continue/i }).click(); await expect(page.getByRole('heading', { name: 'Proof challenge passed' })).toBeVisible();
}

test.describe('Journey premium Counting What’s Left', () => {
  test.beforeEach(async ({ page }) => { await page.addInitScript((fixture) => localStorage.setItem('rh_journey_progress_v1', JSON.stringify(fixture)), progress); });
  test('desktop completes, replays, and preserves completion', async ({ page }, info) => { const errors = guard(page); await open(page); await shot(page, info, 'guided-count.png'); await complete(page, info); await shot(page, info, 'completion.png'); await page.getByRole('button', { name: /return to journey/i }).click(); await page.getByLabel('Puzzle Gate, Completed').click(); await page.getByRole('button', { name: /replay lesson/i }).click(); await page.getByRole('button', { name: 'Exit lesson' }).click(); await expect(page.getByLabel('Puzzle Gate, Completed')).toBeVisible(); expect(errors).toEqual([]); });
  test('mobile completes without horizontal overflow', async ({ page }, info) => { const errors = guard(page); await page.setViewportSize({ width: 390, height: 844 }); await open(page); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true); await shot(page, info, 'guided-count-mobile.png'); await complete(page, info); await shot(page, info, 'completion-mobile.png'); await page.getByRole('button', { name: /return to journey/i }).click(); await expect(page.getByLabel('Puzzle Gate, Completed')).toBeVisible(); expect(errors).toEqual([]); });
});
