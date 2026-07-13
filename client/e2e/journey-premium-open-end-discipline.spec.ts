import { test, expect, type Page, type TestInfo } from '@playwright/test';

const progressFixture = {
  version: 2,
  activeChapterId: 'ch1-fritz-trail',
  chapters: {
    'ch1-fritz-trail': {
      completedNodeIds: ['ch1-n01', 'ch1-n02', 'ch1-n03', 'ch1-n04', 'ch1-n05', 'ch1-n06'],
      lastVisitedNodeId: 'ch1-n07',
      completedAt: null,
      completionCelebrated: false,
    },
  },
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function attachRuntimeGuards(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (url.includes('5173') || url.includes('3001')) errors.push(`requestfailed: ${url} ${request.failure()?.errorText ?? ''}`);
  });
  return errors;
}

async function assertNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(name), fullPage: true });
}

async function openLesson(page: Page) {
  await page.goto('/#/journey');
  const nodeLabel = page.getByLabel('The Fritz Trail map').getByText('Double Trouble', { exact: true });
  await expect(nodeLabel).toBeVisible({ timeout: 15_000 });
  await nodeLabel.click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByText('Fritz’s Table', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /take a seat/i }).click();
  await page.getByRole('button', { name: /i see the open ends/i }).click();
  await expect(page.locator('[data-stage-id="guided-decision"]')).toHaveAttribute('data-scenario-id', 'scenario:open-end-guided');
}

async function chooseByPointer(page: Page, tile: string, end: RegExp) {
  await page.getByRole('button', { name: tile }).click();
  await page.getByRole('button', { name: end }).click();
  await page.getByRole('button', { name: /submit move/i }).click();
}

async function chooseByKeyboard(page: Page, tile: string, end: RegExp) {
  const tileButton = page.getByRole('button', { name: tile });
  await tileButton.focus();
  await page.keyboard.press('Space');
  await expect(tileButton).toHaveAttribute('aria-pressed', 'true');
  const endButton = page.getByRole('button', { name: end });
  await endButton.focus();
  await page.keyboard.press('Enter');
  await expect(endButton).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /submit move/i }).focus();
  await page.keyboard.press('Enter');
}

async function completeLesson(page: Page, testInfo: TestInfo) {
  await page.getByRole('button', { name: 'Domino 3-6' }).click();
  await page.getByRole('button', { name: /play on right end/i }).click();
  await page.getByRole('button', { name: /submit move/i }).click();
  await expect(page.getByText('Fritz got the wider reply.', { exact: true })).toBeVisible();
  await capture(page, testInfo, 'guided-wrong-feedback.png');
  await page.getByRole('button', { name: /try again/i }).click();
  await expect(page.locator('[data-stage-id="guided-decision"]')).toHaveAttribute('data-scenario-id', 'scenario:open-end-guided');
  await chooseByKeyboard(page, 'Domino 1-4', /play on left end/i);
  await page.getByRole('button', { name: /continue/i }).click();

  await expect(page.locator('[data-stage-id="independent-practice"]')).toHaveAttribute('data-scenario-id', 'scenario:open-end-practice-1');
  await chooseByPointer(page, 'Domino 3-4', /play on right end/i);
  await expect(page.getByText('Two open ends gave Fritz more room.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /new position/i }).click();
  await expect(page.locator('[data-stage-id="independent-practice"]')).toHaveAttribute('data-scenario-id', 'scenario:open-end-practice-2');
  await capture(page, testInfo, 'practice-fresh-variant.png');
  await chooseByPointer(page, 'Domino 2-5', /play on left end/i);
  await page.getByRole('button', { name: /continue/i }).click();

  await expect(page.locator('[data-stage-id="proof"]')).toHaveAttribute('data-scenario-id', 'scenario:open-end-proof');
  await capture(page, testInfo, 'proof-judgment.png');
  await chooseByPointer(page, 'Domino 4-1', /play on right end/i);
  await expect(page.getByText('Two open ends gave Fritz more room.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /try again/i }).click();
  await expect(page.locator('[data-stage-id="proof"]')).toHaveAttribute('data-scenario-id', 'scenario:open-end-proof');
  await chooseByPointer(page, 'Domino 2-2', /play on left end/i);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByRole('heading', { name: 'Proof challenge passed' })).toBeVisible();
}

test.describe('Journey premium Open-End Discipline', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((progress) => localStorage.setItem('rh_journey_progress_v1', JSON.stringify(progress)), progressFixture);
  });

  test('desktop completes, replays, abandons, and preserves completion', async ({ page }, testInfo) => {
    const runtimeErrors = attachRuntimeGuards(page);
    await openLesson(page);
    await capture(page, testInfo, 'opening-guided-board.png');
    await completeLesson(page, testInfo);
    await capture(page, testInfo, 'completion.png');
    await page.getByRole('button', { name: /return to journey/i }).click();
    const completedNode = page.getByLabel('Double Trouble, Completed');
    await expect(completedNode).toBeVisible();
    await completedNode.click();
    await expect(page.getByRole('button', { name: /replay lesson/i })).toBeVisible();
    await page.getByRole('button', { name: /replay lesson/i }).click();
    await expect(page.getByText('Fritz’s Table', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /take a seat/i })).toBeVisible();
    await page.getByRole('button', { name: 'Exit lesson' }).click();
    await expect(page.getByLabel('Double Trouble, Completed')).toBeVisible();
    await expect(runtimeErrors).toEqual([]);
  });

  test('mobile completes the full authored lesson without overflow', async ({ page }, testInfo) => {
    const runtimeErrors = attachRuntimeGuards(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openLesson(page);
    await assertNoHorizontalOverflow(page);
    await capture(page, testInfo, 'opening-guided-board-mobile.png');
    await completeLesson(page, testInfo);
    await assertNoHorizontalOverflow(page);
    await capture(page, testInfo, 'completion-mobile.png');
    await page.getByRole('button', { name: /return to journey/i }).click();
    await expect(page.getByLabel('Double Trouble, Completed')).toBeVisible();
    await expect(runtimeErrors).toEqual([]);
  });
});
