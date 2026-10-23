import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Journey Chapter One — Stage 1 foundations, against the real client (anonymous, so the guest storage
 * namespace). Covers the nine-stage trail, the Journey match-context HUD (present for Journey matches,
 * absent for ordinary ones), the configured boss head start, and what a refresh or a Leave does to a
 * match attempt.
 *
 * The full play-through (win recorded at game over, rematch) takes minutes of real play, so it is
 * opt-in: JOURNEY_E2E_PLAY=1.
 */

const PROGRESS_KEY = 'rh_journey_progress_v1';
// One storage key per attempt: rh_journey_attempts_v1:<namespace>:a:<attemptId>
const ATTEMPTS_PREFIX = 'rh_journey_attempts_v1:guest:a:';

const NINE_STAGES = [
  'Read the Gate',
  'Dot’s Table',
  'Greedy Hands',
  'Count the Yard',
  'Open Book',
  'Quick Reads',
  'Doubles Aren’t Free',
  'Marlow’s Table',
  'Handicap Stakes',
];

const VIEWPORTS = [
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const;

function progressFixture(completedNodeIds: string[]) {
  return {
    version: 2,
    activeChapterId: 'ch1-fritz-trail',
    chapters: { 'ch1-fritz-trail': { layoutVersion: 2, completedNodeIds, lastVisitedNodeId: null, completedAt: null, completionCelebrated: false } },
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** Seeds progress only when none exists, so a reload keeps whatever the app itself wrote. */
async function seedProgress(page: Page, completedNodeIds: string[]) {
  await page.addInitScript(
    ([key, value]) => {
      if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
    },
    [PROGRESS_KEY, JSON.stringify(progressFixture(completedNodeIds))] as const,
  );
}

type StoredAttempt = { attemptId: string; nodeId: string; kind: string; outcome: string; detail: Record<string, unknown> };

async function readAttempts(page: Page): Promise<StoredAttempt[]> {
  return page.evaluate((prefix) => {
    const found: Array<StoredAttempt & { startedAt: string }> = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith(prefix)) found.push(JSON.parse(window.localStorage.getItem(key)!));
    }
    return found.sort((a, b) => a.startedAt.localeCompare(b.startedAt)) as StoredAttempt[];
  }, ATTEMPTS_PREFIX);
}

async function readCompleted(page: Page): Promise<string[]> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw).chapters?.['ch1-fritz-trail']?.completedNodeIds ?? []) : [];
  }, PROGRESS_KEY);
}

const chip = (page: Page) => page.locator('[data-ui="journey-match-context"]');

async function launchCurrentStage(page: Page, title: string) {
  await page.goto('/journey');
  const node = page.getByLabel(`${title}, Current`);
  await expect(node).toBeVisible({ timeout: 20_000 });
  await node.click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(chip(page)).toBeVisible({ timeout: 30_000 });
}

async function takePreGameDraw(page: Page) {
  const pickable = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
  for (let i = 0; i < 30 && (await page.locator('.hand-row .domino-tile').count()) === 0; i += 1) {
    if (await pickable.isVisible().catch(() => false)) await pickable.click({ timeout: 3000, force: true }).catch(() => {});
    await page.waitForTimeout(700);
  }
}

async function expectInsideViewport(locator: Locator, page: Page) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box, 'element has a box').not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
}

test.describe('Journey Chapter One trail (Stage 1)', () => {
  test('shows the nine stages in order, only Chapter One, and says Greedy Hands is in development', async ({ page }) => {
    await seedProgress(page, ['ch1-n07', 'ch1-n02']);
    await page.goto('/journey');
    await expect(page.locator('.rh-jt-map')).toBeVisible({ timeout: 20_000 });

    // Chapters 2–6 are hidden: one tab, no next-chapter teaser.
    await expect(page.getByRole('tab')).toHaveCount(1);
    await expect(page.locator('.rh-jt-teaser')).toHaveCount(0);

    // Truthful titles, in the approved order (every node button carries "<title>, <status>").
    const labels = await page.locator('.rh-jt-node button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') ?? ''));
    expect(labels.map((label) => label.replace(/, (Locked|Current|Unlocked|Completed)$/, ''))).toEqual(NINE_STAGES);
    expect(labels[0]).toMatch(/Completed$/);
    expect(labels[1]).toMatch(/Completed$/);
    expect(labels[2]).toMatch(/Current$/); // Greedy Hands — the unlock chain runs in trail order
    expect(labels[3]).toMatch(/Locked$/);

    // Greedy Hands has no runtime yet: it must say so instead of offering a Play that does nothing.
    await page.getByLabel('Greedy Hands, Current').click();
    const cta = page.locator('.rh-jt-mission__cta');
    await expect(cta).toHaveText('In development');
    await expect(cta).toBeDisabled();
    await expect(page.locator('.rh-jt-mission__eyebrow')).toContainText('Lesson');
  });

  test('a lesson stage still plays from its new position (Read the Gate is the first stage)', async ({ page }) => {
    await seedProgress(page, []);
    await page.goto('/journey');
    const node = page.getByLabel('Read the Gate, Current');
    await expect(node).toBeVisible({ timeout: 20_000 });
    await node.click();
    await expect(page.locator('.rh-jt-mission__eyebrow')).toContainText('Lesson');
    await expect(page.locator('.rh-jt-mission__cta')).toHaveText('Play');
    await expect(page.locator('.rh-jt-mission__cta')).toBeEnabled();
  });
});

test.describe('Journey progress saved under the old ten-node layout (corrective fixes)', () => {
  async function seedOldLayout(page: Page, chapter: Record<string, unknown>) {
    await page.addInitScript(
      ([key, value]) => {
        if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
      },
      [PROGRESS_KEY, JSON.stringify({ version: 2, activeChapterId: 'ch1-fritz-trail', chapters: { 'ch1-fritz-trail': chapter }, updatedAt: '2026-01-01T00:00:00.000Z' })] as const, // no layoutVersion: the old layout
    );
  }
  const labelsOf = (page: Page) => page.locator('.rh-jt-node button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') ?? ''));

  test('old partial progress: reused IDs do not read as completed new stages', async ({ page }) => {
    await seedOldLayout(page, { completedNodeIds: ['ch1-n01', 'ch1-n02', 'ch1-n03', 'ch1-n04', 'ch1-n05'], lastVisitedNodeId: 'ch1-n05', completedAt: null, completionCelebrated: false });
    await page.goto('/journey');
    await expect(page.locator('.rh-jt-map')).toBeVisible({ timeout: 20_000 });
    const labels = await labelsOf(page);
    expect(labels[0]).toBe('Read the Gate, Current');
    expect(labels.slice(1).every((label) => label.endsWith('Locked'))).toBe(true); // incl. Dot’s Table, which reused ch1-n02
    expect(labels.some((label) => label.endsWith('Completed'))).toBe(false);
    // durable: stamped with the new layout, invalidation persisted
    const after = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key)!).chapters['ch1-fritz-trail'], PROGRESS_KEY);
    expect(after).toMatchObject({ layoutVersion: 2, completedNodeIds: [], completedAt: null });
  });

  test('old fully-completed progress: no chapter-complete banner or modal for a sequence that was never played', async ({ page }) => {
    await seedOldLayout(page, {
      completedNodeIds: ['ch1-n01', 'ch1-n02', 'ch1-n03', 'ch1-n04', 'ch1-n05', 'ch1-n06', 'ch1-n07', 'ch1-n08', 'ch1-n09', 'ch1-n10'],
      lastVisitedNodeId: 'ch1-n10', completedAt: '2026-02-02T00:00:00.000Z', completionCelebrated: false,
    });
    await page.goto('/journey');
    await expect(page.locator('.rh-jt-map')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.rh-journey-chapter-complete-banner')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0); // the celebration modal
    expect((await labelsOf(page))[0]).toBe('Read the Gate, Current');
    expect((await labelsOf(page)).some((label) => label === 'Handicap Stakes, Completed')).toBe(false);
  });

  test('new progress made after the migration sticks across reloads (no reset loop)', async ({ page }) => {
    await seedOldLayout(page, { completedNodeIds: ['ch1-n01', 'ch1-n02'], lastVisitedNodeId: 'ch1-n02', completedAt: null, completionCelebrated: false });
    await page.goto('/journey');
    await expect(page.locator('.rh-jt-map')).toBeVisible({ timeout: 20_000 });
    await page.evaluate((key) => {
      const progress = JSON.parse(window.localStorage.getItem(key)!);
      progress.chapters['ch1-fritz-trail'].completedNodeIds = ['ch1-n07'];
      window.localStorage.setItem(key, JSON.stringify(progress)); // what a completed lesson writes (stamp retained)
    }, PROGRESS_KEY);
    await page.reload();
    await page.goto('/journey');
    await expect(page.locator('.rh-jt-map')).toBeVisible({ timeout: 20_000 });
    expect((await labelsOf(page))[0]).toBe('Read the Gate, Completed');
    expect(await readCompleted(page)).toEqual(['ch1-n07']);
  });
});

test.describe('Journey match context HUD (Stage 1)', () => {
  for (const viewport of VIEWPORTS) {
    test(`Dot’s Table shows stage, rival and target at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await seedProgress(page, ['ch1-n07']);
      await launchCurrentStage(page, 'Dot’s Table');

      const hud = chip(page);
      await expect(hud).toContainText('Dot’s Table');
      await expect(hud).toContainText('vs Dot');
      await expect(hud).toContainText('Race to 30');
      await expect(hud.locator('[data-ui="journey-head-start"]')).toHaveCount(0);
      await expectInsideViewport(hud, page);
      // Presentation only: it must never intercept a tap meant for the board.
      expect(await hud.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe('none');
      await page.screenshot({ path: testInfo.outputPath(`dot-hud-${viewport.width}.png`) });

      // Still correct after the pre-game draw hands the match over to play.
      await takePreGameDraw(page);
      await expect(hud).toContainText('Race to 30');
      await expectInsideViewport(hud, page);
    });

    test(`the boss shows its configured head start at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await seedProgress(page, ['ch1-n07', 'ch1-n02', 'ch1-n11', 'ch1-n08', 'ch1-n04', 'ch1-n05', 'ch1-n09', 'ch1-n12']);
      await launchCurrentStage(page, 'Handicap Stakes');

      const hud = chip(page);
      await expect(hud).toContainText('Handicap Stakes');
      await expect(hud).toContainText('vs Fritz');
      await expect(hud).toContainText('Race to 60');
      await expect(hud.locator('[data-ui="journey-head-start"]')).toHaveText('You start +15');
      await expectInsideViewport(hud, page);

      // The head start is real state, not just a label: the scoreboard starts at Fritz 0 / You 15.
      await takePreGameDraw(page);
      await expect.poll(async () => (await page.locator('.rh-hud-score').allInnerTexts()).map((text) => text.trim()), { timeout: 15_000 }).toEqual(['0', '15']);
      await expect(hud.locator('[data-ui="journey-head-start"]')).toHaveText('You start +15');
      await page.screenshot({ path: testInfo.outputPath(`boss-hud-${viewport.width}.png`) });
    });
  }

  test('an ordinary Play vs Fritz match has no Journey HUD', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto('/');
    await page.getByText(/^(Single Player|Solo)$/).filter({ visible: true }).first().click();
    await page.getByText('Play vs Fritz', { exact: false }).filter({ visible: true }).first().click();
    await page.locator('.pvf-tier-name', { hasText: 'Rookie' }).click();
    await page.locator('.pvf-deal-card', { hasText: '7 Tiles' }).click();
    await page.getByText('Start Match', { exact: false }).first().click();
    await expect(page.locator('.pre-game-draw-board__tile-slot, .hand-row .domino-tile').first()).toBeVisible({ timeout: 30_000 });
    await takePreGameDraw(page);
    await expect(page.locator('.hand-row .domino-tile').first()).toBeVisible();
    await expect(chip(page)).toHaveCount(0);
  });
});

test.describe('Journey match attempts: refresh and leave (Stage 1)', () => {
  test('refreshing mid-match never awards the stage; the attempt is settled as abandoned when the trail reloads', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedProgress(page, ['ch1-n07']);
    await launchCurrentStage(page, 'Dot’s Table');
    expect((await readAttempts(page)).map((attempt) => [attempt.nodeId, attempt.outcome])).toEqual([['ch1-n02', 'in_progress']]);

    await page.reload(); // the match is not resumable in the slice
    await page.goto('/journey');
    await expect(page.locator('.rh-jt-map')).toBeVisible({ timeout: 20_000 });

    expect(await readCompleted(page)).not.toContain('ch1-n02');
    await expect(page.getByLabel('Dot’s Table, Current')).toBeVisible();
    await expect.poll(async () => (await readAttempts(page)).map((attempt) => attempt.outcome)).toEqual(['abandoned']);
  });

  test('leaving a match abandons the attempt and awards nothing', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedProgress(page, ['ch1-n07']);
    await launchCurrentStage(page, 'Dot’s Table');
    await takePreGameDraw(page);

    await page.getByLabel('Leave game').click();
    await page.getByRole('button', { name: 'Leave Game', exact: true }).click();

    await expect(page.locator('.rh-jt-map')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel('Dot’s Table, Current')).toBeVisible();
    expect(await readCompleted(page)).not.toContain('ch1-n02');
    const attempts = await readAttempts(page);
    expect(attempts.map((attempt) => attempt.outcome)).toEqual(['abandoned']);
    expect(attempts[0].detail).toMatchObject({ rival: 'Dot', winningScore: 30 });
  });
});

test.describe('Journey challenge lifecycle and tabs (corrective fixes)', () => {
  test('leaving a Journey match by browser history, then starting an ordinary match, leaks no Journey context or configuration', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedProgress(page, ['ch1-n07']);
    await launchCurrentStage(page, 'Dot’s Table'); // Rookie, 7 tiles, race to 30

    await page.goBack(); // browser history: none of the in-app exit handlers run
    await expect(page.locator('.rh-jt-map')).toBeVisible({ timeout: 20_000 });
    expect((await readAttempts(page)).map((attempt) => attempt.outcome)).toEqual(['abandoned']);

    // Client-side navigation only (no reload), so any leftover in-memory challenge would still be there.
    await page.getByText(/^Single Player$/).filter({ visible: true }).first().click();
    await page.getByText('Play vs Fritz', { exact: false }).filter({ visible: true }).first().click();
    await page.locator('.pvf-tier-name', { hasText: 'Elite' }).click();
    // Deliberately different from the stale Dot challenge (7 tiles): a leaked challenge would force 7.
    await page.locator('.pvf-deal-card', { hasText: '14 Tiles' }).click();
    await page.getByText('Start Match', { exact: false }).first().click();

    await expect(page.locator('.hand-row .domino-tile').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.hand-row .domino-tile')).toHaveCount(14);
    await expect(chip(page)).toHaveCount(0);
    // and nothing was recorded against Journey for it
    expect((await readAttempts(page)).map((attempt) => attempt.outcome)).toEqual(['abandoned']);
  });

  test('a second tab opening Journey does not take over the first tab’s live match attempt, and its heartbeat keeps running', async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(([key, value]) => {
      window.localStorage.setItem('hasSeenWelcome', '1');
      if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
    }, [PROGRESS_KEY, JSON.stringify(progressFixture(['ch1-n07']))] as const);
    try {
      const tabA = await context.newPage();
      await launchCurrentStage(tabA, 'Dot’s Table');
      const [started] = await readAttempts(tabA);
      expect(started.outcome).toBe('in_progress');

      const tabB = await context.newPage(); // same browser profile => same localStorage
      await tabB.goto('/journey');
      await expect(tabB.locator('.rh-jt-map')).toBeVisible({ timeout: 20_000 });
      await tabB.bringToFront();

      // B's mount sweep must not touch A's live attempt.
      const afterB = await readAttempts(tabB);
      expect(afterB.map((attempt) => [attempt.attemptId, attempt.outcome])).toEqual([[started.attemptId, 'in_progress']]);
      await expect(chip(tabA)).toBeVisible(); // A is still in its match

      // The owner keeps confirming it is alive (15 s heartbeat): the timestamp moves while B is in front.
      const beat = async () => (await readAttempts(tabA) as Array<StoredAttempt & { heartbeatAt: number }>)[0]?.heartbeatAt ?? 0;
      const first = await beat();
      await tabB.waitForTimeout(17_000);
      expect(await beat()).toBeGreaterThan(first);
      expect((await readAttempts(tabB))[0].outcome).toBe('in_progress');
    } finally {
      await context.close();
    }
  });
});

test.describe('Journey attempt liveness across tabs: stale is not abandoned (corrective fixes)', () => {
  test('another tab opening Journey and starting its own attempt does NOT abandon an owner whose heartbeat looks stale', async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(([key, value]) => {
      window.localStorage.setItem('hasSeenWelcome', '1');
      if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
    }, [PROGRESS_KEY, JSON.stringify(progressFixture(['ch1-n07']))] as const);
    try {
      const tabA = await context.newPage();
      await launchCurrentStage(tabA, 'Dot’s Table');
      const [started] = await readAttempts(tabA);

      // Make A look frozen for 10 minutes: older than the 3-minute stale mark. (A real frozen tab's timers do
      // not run; here A's next 15 s beat would repair it, so the other tab is checked straight away.)
      await tabA.evaluate(([prefix, id]) => {
        const key = `${prefix}${id}`;
        const record = JSON.parse(window.localStorage.getItem(key)!);
        record.heartbeatAt = Date.now() - 10 * 60_000;
        window.localStorage.setItem(key, JSON.stringify(record));
      }, [ATTEMPTS_PREFIX, started.attemptId] as const);

      const tabB = await context.newPage();
      await tabB.goto('/journey');
      await expect(tabB.locator('.rh-jt-map')).toBeVisible({ timeout: 20_000 });
      // B also starts a match of its own (the trail's other tab "opens Journey and starts another attempt").
      await tabB.getByLabel('Dot’s Table, Current').click();
      await tabB.getByRole('button', { name: 'Play', exact: true }).click();
      await expect(chip(tabB)).toBeVisible({ timeout: 30_000 });

      const seen = await readAttempts(tabB);
      expect(seen.find((attempt) => attempt.attemptId === started.attemptId)?.outcome).toBe('in_progress'); // not abandoned
      expect(seen.filter((attempt) => attempt.outcome === 'in_progress')).toHaveLength(2); // and B was not blocked
      await expect(chip(tabA)).toBeVisible(); // A is still in its match, free to finish it
    } finally {
      await context.close();
    }
  });
});

test.describe('Journey win → progress recovery (win-progress consistency fix)', () => {
  const PENDING_PREFIX = 'rh_journey_pending_completion_v1:guest:p:';
  const wonDotAttempt = (attemptId: string) => ({
    attemptId, nodeId: 'ch1-n02', kind: 'match', outcome: 'won',
    startedAt: '2026-03-01T12:00:00.000Z', endedAt: '2026-03-01T12:10:00.000Z', ownerId: null, heartbeatAt: null,
    detail: { stage: 'Dot’s Table', rival: 'Dot', fritzTier: 'rookie', dealSize: 7, winningScore: 30, chapterLayout: 2 },
  });
  async function seedStorage(page: Page, entries: Record<string, unknown>) {
    await page.addInitScript((seed) => {
      for (const [key, value] of Object.entries(seed as Record<string, unknown>)) {
        if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, JSON.stringify(value));
      }
    }, entries);
  }
  const pendingKeys = (page: Page) => page.evaluate((prefix) => {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
    return keys;
  }, PENDING_PREFIX);

  test('a win recorded but not yet applied to progress (the crash window) is completed when the trail loads, and survives a reload', async ({ page }) => {
    await seedStorage(page, {
      [PROGRESS_KEY]: progressFixture(['ch1-n07']), // Dot's Table is current; its completion never landed
      [`${ATTEMPTS_PREFIX}jat_e2e_crash`]: wonDotAttempt('jat_e2e_crash'),
      [`${PENDING_PREFIX}jat_e2e_crash`]: { version: 1, attemptId: 'jat_e2e_crash', nodeId: 'ch1-n02', createdAt: '2026-03-01T12:10:00.000Z' },
    });
    await page.goto('/journey');
    await expect(page.locator('.rh-jt-map')).toBeVisible({ timeout: 20_000 });
    const labels = await page.locator('.rh-jt-node button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') ?? ''));
    expect(labels[1]).toBe('Dot’s Table, Completed'); // repaired before the trail rendered
    expect(labels[2]).toBe('Greedy Hands, Current'); // and the next stage unlocked
    expect(await readCompleted(page)).toEqual(['ch1-n07', 'ch1-n02']);
    expect(await pendingKeys(page)).toEqual([]);

    await page.reload();
    await page.goto('/journey');
    await expect(page.locator('.rh-jt-map')).toBeVisible({ timeout: 20_000 });
    expect(await readCompleted(page)).toEqual(['ch1-n07', 'ch1-n02']); // idempotent: not duplicated, not reset
  });

  test('an arbitrary "won" attempt entry with no obligation, and a loss with one, complete nothing', async ({ page }) => {
    await seedStorage(page, {
      [PROGRESS_KEY]: progressFixture(['ch1-n07']),
      [`${ATTEMPTS_PREFIX}jat_forged_win`]: wonDotAttempt('jat_forged_win'), // no obligation record: history, not a grant
      [`${ATTEMPTS_PREFIX}jat_loss`]: { ...wonDotAttempt('jat_loss'), outcome: 'lost' },
      [`${PENDING_PREFIX}jat_loss`]: { version: 1, attemptId: 'jat_loss', nodeId: 'ch1-n02', createdAt: '2026-03-01T12:10:00.000Z' },
    });
    await page.goto('/journey');
    await expect(page.locator('.rh-jt-map')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel('Dot’s Table, Current')).toBeVisible();
    expect(await readCompleted(page)).toEqual(['ch1-n07']);
    expect(await pendingKeys(page)).toEqual([]); // the loss's record was invalid and removed
  });
});

test.describe('Journey lesson and sprint completion contract (Stage 2, phases 1-2)', () => {
  const PENDING_PREFIX = 'rh_journey_pending_completion_v1:guest:p:';
  const OPEN_END_CONTENT_ID = 'journey:ch1:open-end-discipline';
  const lessonProof = (over: Record<string, unknown> = {}) => JSON.stringify({
    v: 2, sessionId: 'session:e2e', startedAt: '2026-03-01T12:05:00.000Z', contentId: OPEN_END_CONTENT_ID, nodeId: 'ch1-n07', contentVersion: 1, rule: 'required_stages',
    completedAt: '2026-03-01T12:10:00.000Z',
    stages: [{ stageId: 'independent-practice', outcome: 'passed', attempts: 1, executionId: 'exec:e2e-1' }, { stageId: 'proof', outcome: 'passed', attempts: 1, executionId: 'exec:e2e-2' }],
    retries: 0, ...over,
  });
  const wonLessonAttempt = (attemptId: string, detail: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
    attemptId, nodeId: 'ch1-n07', kind: 'lesson', outcome: 'won',
    startedAt: '2026-03-01T12:00:00.000Z', endedAt: '2026-03-01T12:10:00.000Z', ownerId: null, heartbeatAt: null,
    detail: { stage: 'Read the Gate', contentId: OPEN_END_CONTENT_ID, chapterLayout: 2, completionProof: lessonProof(), sessionId: 'session:e2e', ...detail },
    ...over,
  });
  async function seedStorage(page: Page, entries: Record<string, unknown>) {
    await page.addInitScript((seed) => {
      for (const [key, value] of Object.entries(seed as Record<string, unknown>)) {
        if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, JSON.stringify(value));
      }
    }, entries);
  }
  const pendingKeys = (page: Page) => page.evaluate((prefix) => {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
    return keys;
  }, PENDING_PREFIX);

  async function openReadTheGate(page: Page) {
    await page.goto('/journey');
    const node = page.getByLabel('Read the Gate, Current');
    await expect(node).toBeVisible({ timeout: 20_000 });
    await node.click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByText('Fritz’s Table', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /take a seat/i }).click();
    await page.getByRole('button', { name: /i see the open ends/i }).click();
    await expect(page.locator('[data-stage-id="guided-decision"]')).toBeVisible();
  }
  async function move(page: Page, tile: string, end: RegExp) {
    await page.getByRole('button', { name: tile }).click();
    await page.getByRole('button', { name: end }).click();
    await page.getByRole('button', { name: /submit move/i }).click();
  }
  /** The authored Open-End Discipline path, with deliberate misses so the proof records retries. */
  async function playReadTheGate(page: Page) {
    await move(page, 'Domino 3-6', /play on right end/i);
    await page.getByRole('button', { name: /try again/i }).click();
    await move(page, 'Domino 1-4', /play on left end/i);
    await page.getByRole('button', { name: /continue/i }).click();
    await move(page, 'Domino 3-4', /play on right end/i);
    await page.getByRole('button', { name: /new position/i }).click();
    await move(page, 'Domino 2-5', /play on left end/i);
    await page.getByRole('button', { name: /continue/i }).click();
    await move(page, 'Domino 4-1', /play on right end/i);
    await page.getByRole('button', { name: /try again/i }).click();
    await move(page, 'Domino 2-2', /play on left end/i);
    await page.getByRole('button', { name: /continue/i }).click();
    await expect(page.getByRole('heading', { name: 'Proof challenge passed' })).toBeVisible();
  }

  test('finishing a lesson on the real screen records a won attempt with its proof, credits the node, and leaves no obligation', async ({ page }) => {
    await seedProgress(page, []);
    await openReadTheGate(page);
    await playReadTheGate(page);
    await page.getByRole('button', { name: /return to journey/i }).click();
    await expect(page.getByLabel('Read the Gate, Completed')).toBeVisible();
    expect(await readCompleted(page)).toEqual(['ch1-n07']);
    expect(await pendingKeys(page)).toEqual([]);
    const lessonAttempts = (await readAttempts(page)).filter((attempt) => attempt.kind === 'lesson');
    expect(lessonAttempts).toHaveLength(1);
    expect(lessonAttempts[0]).toMatchObject({ outcome: 'won', nodeId: 'ch1-n07', detail: { contentId: OPEN_END_CONTENT_ID, stage: 'Read the Gate', chapterLayout: 2 } });
    const proof = JSON.parse(String(lessonAttempts[0].detail.completionProof));
    expect(proof.stages.map((stage: { stageId: string }) => stage.stageId)).toEqual(['independent-practice', 'proof']);
    expect(proof.v).toBe(2);
    expect(lessonAttempts[0].detail.sessionId).toBe(proof.sessionId); // the attempt records the session it ran
    expect(Date.parse(proof.startedAt)).toBeGreaterThanOrEqual(Date.parse(String((lessonAttempts[0] as unknown as { startedAt: string }).startedAt)));
    expect(proof.retries).toBeGreaterThan(0); // the misses on the way are on the record, not hidden
    // the credit survives a reload and a second visit does not duplicate it
    await page.reload();
    await expect(page.getByLabel('Read the Gate, Completed')).toBeVisible({ timeout: 20_000 });
    expect(await readCompleted(page)).toEqual(['ch1-n07']);
  });

  test('leaving a lesson part-way, by Exit or by refresh, earns nothing and records no win', async ({ page }) => {
    await seedProgress(page, []);
    await openReadTheGate(page);
    await move(page, 'Domino 1-4', /play on left end/i); // a correct first answer, then the player leaves
    await page.getByRole('button', { name: 'Exit lesson' }).click();
    await expect(page.getByLabel('Read the Gate, Current')).toBeVisible();
    expect(await readCompleted(page)).toEqual([]);
    let attempts = (await readAttempts(page)).filter((attempt) => attempt.kind === 'lesson');
    expect(attempts.map((attempt) => attempt.outcome)).toEqual(['abandoned']);

    await openReadTheGate(page);
    await page.reload(); // refresh in the middle of the lesson
    await expect(page.getByLabel('Read the Gate, Current')).toBeVisible({ timeout: 20_000 });
    expect(await readCompleted(page)).toEqual([]);
    attempts = (await readAttempts(page)).filter((attempt) => attempt.kind === 'lesson');
    expect(attempts.some((attempt) => attempt.outcome === 'won')).toBe(false);
    expect(await pendingKeys(page)).toEqual([]);
  });

  test('a lesson win recorded but never applied to progress is completed when the trail loads', async ({ page }) => {
    await seedProgress(page, []);
    await seedStorage(page, {
      [`${ATTEMPTS_PREFIX}jat_e2e_lesson`]: wonLessonAttempt('jat_e2e_lesson'),
      [`${PENDING_PREFIX}jat_e2e_lesson`]: { version: 1, attemptId: 'jat_e2e_lesson', nodeId: 'ch1-n07', createdAt: '2026-03-01T12:10:00.000Z' },
    });
    await page.goto('/journey');
    await expect(page.locator('.rh-jt-map')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel('Read the Gate, Completed')).toBeVisible();
    expect(await readCompleted(page)).toEqual(['ch1-n07']);
    expect(await pendingKeys(page)).toEqual([]);
  });

  test('forged, hollow or mismatched lesson records complete nothing', async ({ page }) => {
    await seedProgress(page, []);
    const pending = (id: string) => ({ version: 1, attemptId: id, nodeId: 'ch1-n07', createdAt: '2026-03-01T12:10:00.000Z' });
    await seedStorage(page, {
      [`${ATTEMPTS_PREFIX}jat_f1`]: wonLessonAttempt('jat_f1', { completionProof: undefined }), // no proof
      [`${PENDING_PREFIX}jat_f1`]: pending('jat_f1'),
      [`${ATTEMPTS_PREFIX}jat_f2`]: wonLessonAttempt('jat_f2', { completionProof: JSON.stringify({ v: 1, requiredStagesPassed: true }) }), // a flag is not evidence
      [`${PENDING_PREFIX}jat_f2`]: pending('jat_f2'),
      [`${ATTEMPTS_PREFIX}jat_f3`]: wonLessonAttempt('jat_f3', { completionProof: lessonProof({ stages: [{ stageId: 'independent-practice', outcome: 'passed', attempts: 1, executionId: 'exec:e2e-1' }, { stageId: 'proof', outcome: 'failed', attempts: 1, executionId: 'exec:e2e-2' }] }) }),
      [`${PENDING_PREFIX}jat_f3`]: pending('jat_f3'),
      [`${ATTEMPTS_PREFIX}jat_f4`]: wonLessonAttempt('jat_f4', { contentId: 'journey:ch1:counting-whats-left' }), // wrong content
      [`${PENDING_PREFIX}jat_f4`]: pending('jat_f4'),
      [`${ATTEMPTS_PREFIX}jat_f5`]: wonLessonAttempt('jat_f5', {}, { outcome: 'abandoned' }), // abandoned, valid-looking proof
      [`${PENDING_PREFIX}jat_f5`]: pending('jat_f5'),
      [`${ATTEMPTS_PREFIX}jat_f6`]: wonLessonAttempt('jat_f6', { sessionId: 'session:someone-else' }), // proof belongs to another session
      [`${PENDING_PREFIX}jat_f6`]: pending('jat_f6'),
      [`${ATTEMPTS_PREFIX}jat_f7`]: wonLessonAttempt('jat_f7', {}, { startedAt: '2026-03-01T13:00:00.000Z' }), // the session began before this attempt
      [`${PENDING_PREFIX}jat_f7`]: pending('jat_f7'),
    });
    await page.goto('/journey');
    await expect(page.locator('.rh-jt-map')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel('Read the Gate, Current')).toBeVisible();
    expect(await readCompleted(page)).toEqual([]);
    expect(await pendingKeys(page)).toEqual([]); // every invalid obligation was removed
  });

  test.describe('Quick Reads sprint', () => {
    const PRIOR = ['ch1-n07', 'ch1-n02', 'ch1-n11', 'ch1-n08', 'ch1-n04'];
    async function openSprint(page: Page) {
      await seedProgress(page, PRIOR);
      await page.goto('/journey');
      const node = page.getByLabel('Quick Reads, Current');
      await expect(node).toBeVisible({ timeout: 20_000 });
      await node.click();
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      await expect(page.getByText('Puzzle 1 of 3')).toBeVisible();
    }
    const pick = async (page: Page, tile: string, next: string | null) => {
      await page.getByRole('button', { name: tile }).click();
      if (next) await expect(page.getByText(next)).toBeVisible({ timeout: 5_000 });
    };

    test('two reads of three pass: a won attempt carrying the result, and the node is credited', async ({ page }) => {
      await openSprint(page);
      await pick(page, 'Play 2-6', 'Puzzle 2 of 3');
      await pick(page, 'Play 5-6', 'Puzzle 3 of 3'); // a miss
      await pick(page, 'Play 5-2', null);
      await expect(page.getByLabel('Quick Reads, Completed')).toBeVisible({ timeout: 10_000 });
      expect(await readCompleted(page)).toContain('ch1-n05');
      expect(await pendingKeys(page)).toEqual([]);
      const sprints = (await readAttempts(page)).filter((attempt) => attempt.kind === 'sprint');
      expect(sprints).toHaveLength(1);
      expect(sprints[0]).toMatchObject({ outcome: 'won', nodeId: 'ch1-n05', detail: { correct: 2, total: 3, stage: 'Quick Reads', chapterLayout: 2 } });
    });

    test('one read of three fails: recorded as lost, nothing credited, nothing owed', async ({ page }) => {
      await openSprint(page);
      await pick(page, 'Play 4-6', 'Puzzle 2 of 3');
      await pick(page, 'Play 5-6', 'Puzzle 3 of 3');
      await pick(page, 'Play 5-2', null);
      await expect(page.getByText(/Puzzle \d of 3/)).toBeHidden({ timeout: 10_000 }); // the sprint has finished and reported
      await expect(page.getByLabel('Quick Reads, Current')).toBeVisible();
      expect(await readCompleted(page)).not.toContain('ch1-n05');
      expect(await pendingKeys(page)).toEqual([]);
      const sprints = (await readAttempts(page)).filter((attempt) => attempt.kind === 'sprint');
      expect(sprints.map((attempt) => attempt.outcome)).toEqual(['lost']);
    });

    test('leaving the sprint part-way records an abandonment and credits nothing', async ({ page }) => {
      await openSprint(page);
      await pick(page, 'Play 2-6', 'Puzzle 2 of 3');
      await page.keyboard.press('Escape'); // the modal's own close
      await expect(page.getByText(/Puzzle \d of 3/)).toBeHidden({ timeout: 10_000 });
      await expect(page.getByLabel('Quick Reads, Current')).toBeVisible();
      expect(await readCompleted(page)).not.toContain('ch1-n05');
      const sprints = (await readAttempts(page)).filter((attempt) => attempt.kind === 'sprint');
      expect(sprints.every((attempt) => attempt.outcome !== 'won')).toBe(true);
    });
  });
});

test.describe('Journey match play-through (opt-in: JOURNEY_E2E_PLAY=1)', () => {
  test.skip(!process.env.JOURNEY_E2E_PLAY, 'plays full Fritz matches to completion — minutes of real play');

  async function playToResult(page: Page): Promise<'continue' | 'retry'> {
    const continueTrail = page.getByRole('button', { name: 'Continue Trail' });
    const tryAgain = page.getByRole('button', { name: 'Try Again' });
    for (let step = 0; step < 4000; step += 1) {
      if (await continueTrail.isVisible().catch(() => false)) return 'continue';
      if (await tryAgain.isVisible().catch(() => false)) return 'retry';
      const pickable = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
      if (await pickable.isVisible().catch(() => false)) {
        await pickable.click({ timeout: 2000, force: true }).catch(() => {});
        await page.waitForTimeout(600);
        continue;
      }
      // Heaviest playable tile first (labels read "Domino a-b"): a sensible, deterministic policy.
      const playables = page.locator('.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)');
      const labels = await playables.evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute('aria-label') ?? ''));
      const pips = labels.map((label) => (label.match(/\d+/g) ?? []).reduce((sum, digit) => sum + Number(digit), 0));
      const best = pips.length ? pips.indexOf(Math.max(...pips)) : -1;
      const playable = playables.nth(best >= 0 ? best : 0);
      if (best >= 0 && (await playable.isVisible().catch(() => false))) {
        await playable.click({ timeout: 2000 }).catch(() => {});
        const zone = page.locator('.placement-zone.active').first();
        if (await zone.isVisible().catch(() => false)) await zone.click({ timeout: 2000 }).catch(() => {});
      } else {
        // No playable tile: draw / pass by tapping the boneyard (a no-op when it is not our turn).
        await page.locator('[class*="boneyard"]').first().click({ timeout: 1000 }).catch(() => {});
      }
      await page.waitForTimeout(300);
    }
    throw new Error('match did not reach a result');
  }

  test('a win is recorded at game over (before Continue Trail); a loss can be rematched as a new attempt', async ({ page }) => {
    test.setTimeout(25 * 60_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedProgress(page, ['ch1-n07']);
    await launchCurrentStage(page, 'Dot’s Table');

    let rematches = 0;
    for (let game = 0; game < 5; game += 1) {
      const result = await playToResult(page);
      // Authoritative state has settled the attempt BEFORE the player presses anything.
      const attempts = await readAttempts(page);
      const last = attempts[attempts.length - 1];
      if (result === 'continue') {
        expect(last.outcome).toBe('won');
        expect(await readCompleted(page)).toContain('ch1-n02');
        // duplicate game-over callbacks cannot duplicate the attempt
        expect(attempts.filter((attempt) => attempt.outcome === 'won')).toHaveLength(1);
        await page.getByRole('button', { name: 'Continue Trail' }).click();
        await expect(page.getByLabel('Dot’s Table, Completed')).toBeVisible({ timeout: 20_000 });
        expect(await readCompleted(page)).toContain('ch1-n02');
        expect(rematches).toBe(attempts.length - 1);
        return;
      }
      expect(last.outcome).toBe('lost');
      expect(await readCompleted(page)).not.toContain('ch1-n02');
      const lostId = last.attemptId;
      await page.getByRole('button', { name: 'Try Again' }).click();
      rematches += 1;
      await expect(chip(page)).toBeVisible({ timeout: 30_000 });
      await expect(chip(page)).toContainText('Race to 30');
      const afterRematch = await readAttempts(page);
      const fresh = afterRematch[afterRematch.length - 1];
      expect(fresh.attemptId).not.toBe(lostId);
      expect(fresh.outcome).toBe('in_progress');
      expect(fresh.detail).toMatchObject({ rival: 'Dot', winningScore: 30 });
      expect(afterRematch.find((attempt) => attempt.attemptId === lostId)?.outcome).toBe('lost');
    }
    throw new Error('no win in five games — rerun, or play the match by hand');
  });
});
