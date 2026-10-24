import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { createDeterministicDoubleSixDeal } = createRequire(import.meta.url)('@racehorse/game-core') as typeof import('@racehorse/game-core');

// Real non-admin session created by local QA setup. Never embed credentials.
const sessionFile = process.env.QUALITY_QA_SESSION_FILE;
test.skip(!sessionFile, 'Requires a temporary nonproduction QA session and production preview');

async function start(page: Page) {
  await page.goto('/solo/fritz');
  await page.locator('.pvf-tier-name', { hasText: 'Rookie' }).click();
  await page.getByText('Start Match', { exact: false }).first().click();
}
async function pickStarter(page: Page, done: () => boolean) {
  for (let i = 0; i < 60 && !done(); i++) {
    const pick = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
    if (await pick.isVisible()) await pick.click();
    await page.waitForTimeout(200);
  }
}
async function completeMatch(page: Page) {
  const end = Date.now() + 600_000;
  let actions = 0;
  let lastLogged = 0;
  while (Date.now() < end) {
    if (await page.getByRole('dialog', { name: 'Play vs Fritz result' }).isVisible()) { console.log(`Completed real game: ${actions} player actions`); return; }
    if (await page.getByTestId('hand-over-modal').isVisible()) { await page.waitForTimeout(400); continue; }
    const tile = page.locator('.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)').first();
    if (await tile.isVisible()) {
      await tile.click();
      const zone = page.locator('.placement-zone.active').first();
      if (await zone.isVisible()) {
        // Long boards expose zoom-out; keep target genuinely inside the viewport.
        for (let n = 0; n < 6; n++) {
          const box = await zone.boundingBox();
          if (box && box.y > 90 && box.x > 0 && box.y + box.height < 780) break;
          const zoom = page.getByRole('button', { name: /Zoom out/i });
          if (await zoom.isVisible() && await zoom.isEnabled()) await zoom.click();
          else break;
        }
        await zone.click({ timeout: 5000 });
        actions++;
      }
    } else {
      const boneyard = page.locator('[class*="boneyard"]').first();
      if (await boneyard.isVisible()) await boneyard.click();
    }
    if (actions > lastLogged && actions % 20 === 0) { console.log(`Played ${actions} actions`); lastLogged = actions; }
    await page.waitForTimeout(150);
  }
  throw new Error('Real match did not complete within the QA budget');
}

test('ordinary production player: authoritative Fritz deal, complete review, history and reload', async ({ page }) => {
  test.setTimeout(900_000);
  const saved = JSON.parse(readFileSync(sessionFile!, 'utf8'));
  expect(new URL(saved.url).hostname).toBe('nwodvcmlmailtgjblphu.supabase.co');
  await page.addInitScript(({ session }) => {
    localStorage.setItem('hasSeenWelcome', '1');
    localStorage.setItem('sb-nwodvcmlmailtgjblphu-auth-token', JSON.stringify(session));
  }, saved);
  const errors: string[] = [];
  const failures: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => { if (response.status() >= 400 && /\/api\//.test(response.url())) failures.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  let requests = 0;
  let responseBody: Record<string, unknown> | null = null;
  let release!: () => void;
  const responseGate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/bot-matches/local/start', async (route) => {
    requests++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    responseBody = await response.json();
    await responseGate;
    await route.fulfill({ response });
  });
  await start(page);
  await pickStarter(page, () => requests > 0);
  await expect.poll(() => responseBody).not.toBeNull();
  await expect(page.getByText('Preparing your match…')).toBeVisible();
  for (let n = 0; n < 8; n++) {
    expect(await page.locator('.hand-area .domino-tile').count()).toBe(0);
    await page.waitForTimeout(150);
  }
  release();
  await expect(page.locator('.hand-area .domino-tile').first()).toBeVisible();
  const expected = createDeterministicDoubleSixDeal({ seed: `${responseBody!.seed}:h1`, tilesPerPlayer: 7, deadTileCount: 2 }).playerTiles.map((tile) => `${tile.low}-${tile.high}`).sort();
  const visible = (await page.locator('.hand-area .domino-tile').evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute('aria-label')?.match(/(\d)-(\d)/)?.[0]))).sort();
  expect(visible).toEqual(expected);
  expect(requests).toBe(1);
  await completeMatch(page);
  const snapshots = await page.evaluate(() => JSON.parse(localStorage.getItem('racehorse_review_snapshots_v1') ?? '[]'));
  expect(snapshots.length).toBeGreaterThan(0);
  const drawCounts = new Map<string, number>();
  for (const snapshot of snapshots) if (snapshot.actualAction.kind === 'draw') {
    const key = `${snapshot.identifiers.handNumber}:${snapshot.identifiers.actorId}:${JSON.stringify(snapshot.preAction.board)}`;
    drawCounts.set(key, (drawCounts.get(key) ?? 0) + 1);
  }
  expect([...drawCounts.values()].some((count) => count > 1), 'completed game contains a genuine multi-draw turn').toBe(true);
  const prompt = page.getByRole('dialog', { name: 'Post-game review' });
  await expect(prompt).toBeVisible({ timeout: 180_000 });
  await prompt.getByRole('button', { name: 'Review Game' }).click();
  const reviewer = page.getByRole('dialog', { name: 'Game reviewer' });
  await expect(reviewer).toBeVisible();
  await expect(reviewer.locator('.gr-evidence-label')).toContainText(/Review Engine analysis/i, { timeout: 180_000 });
  await expect(reviewer.locator('.gr-move-row').first()).toBeVisible();
  await expect(reviewer.getByRole('button', { name: 'Previous move', exact: true })).toBeDisabled();
  let moves = 0;
  const hands = reviewer.getByRole('tablist', { name: 'Hands' }).getByRole('button');
  for (let h = 0; h < await hands.count(); h++) {
    await hands.nth(h).click();
    await expect(reviewer.locator('.gr-move-row-rating.is-unavailable')).toHaveCount(0);
    await expect(reviewer.getByRole('button', { name: 'Previous move', exact: true })).toBeDisabled();
    moves++;
    const next = reviewer.getByRole('button', { name: 'Next move', exact: true });
    while (await next.isEnabled() && moves < 500) { await next.click(); moves++; }
    await expect(next).toBeDisabled();
  }
  expect(moves).toBeGreaterThan(5);
  console.log(`Reviewed ${moves} decisions; captured ${snapshots.length} canonical actions; start requests=${requests}`);
  await page.goto('/rating-history');
  const history = page.getByLabel('Recent game reviews');
  await expect(history.getByRole('button', { name: 'Review Game' }).first()).toBeVisible({ timeout: 30_000 });
  await history.getByRole('button', { name: 'Review Game' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Game reviewer' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('review')).toBeTruthy();
  const exactUrl = page.url();
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Game reviewer' })).toBeVisible();
  expect(page.url()).toBe(exactUrl);
  await page.goto('/stats');
  await expect(page.getByText('Human-v-human', { exact: true })).toBeVisible();
  await expect(page.getByText('Rated games', { exact: true })).toBeVisible();
  await expect(page.getByText('Play a human-v-human match to start a record here.')).toBeVisible();
  const username = await page.locator('.rh-stats-hero-name').innerText();
  await page.goto(`/players/${encodeURIComponent(username.replace('@', ''))}`);
  await expect(page.getByText('HUMAN-V-HUMAN WIN RATE', { exact: true })).toBeVisible();
  await expect(page.getByText('rated games (Fritz + multiplayer)', { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
});

test('guest Fritz keeps its local deal and makes no rated start request', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hasSeenWelcome', '1'));
  let starts = 0;
  page.on('request', (request) => { if (request.url().endsWith('/api/bot-matches/local/start')) starts++; });
  await start(page);
  let dealt = false;
  for (let n = 0; n < 60; n++) {
    if (await page.locator('.hand-area .domino-tile').count() === 7) { dealt = true; break; }
    const pick = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
    if (await pick.isVisible()) await pick.click();
    await page.waitForTimeout(200);
  }
  expect(dealt).toBe(true);
  expect(starts).toBe(0);
  expect(await page.getByText('Preparing your match…').count()).toBe(0);
});

test('Daily Fritz retains its first dealt hand', async ({ page }) => {
  test.setTimeout(120_000);
  const saved = JSON.parse(readFileSync(sessionFile!, 'utf8'));
  await page.addInitScript(({ session }) => {
    localStorage.setItem('hasSeenWelcome', '1');
    localStorage.setItem('sb-nwodvcmlmailtgjblphu-auth-token', JSON.stringify(session));
  }, saved);
  await page.goto('/daily-fritz');
  const button = page.locator('.df-start-match-btn');
  await expect(button).toBeEnabled({ timeout: 60_000 });
  await button.click();
  for (let n = 0; n < 80; n++) {
    if (await page.locator('.hand-area .domino-tile').count() > 0) break;
    const pick = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
    if (await pick.isVisible()) await pick.click();
    await page.waitForTimeout(200);
  }
  const hand = page.locator('.hand-area .domino-tile');
  await expect(hand.first()).toBeVisible();
  const identities = await hand.evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute('aria-label')?.match(/(\d)-(\d)/)?.[0]));
  await page.waitForTimeout(2500);
  expect(await hand.evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute('aria-label')?.match(/(\d)-(\d)/)?.[0]))).toEqual(identities);
});
