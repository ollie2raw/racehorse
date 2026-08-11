/**
 * Racehorse Journey Phase 1 browser smoke test (Playwright).
 * Run: node scripts/journeyPhase1Smoke.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.JOURNEY_SMOKE_BASE ?? 'http://127.0.0.1:4174';
const STORAGE_KEY = 'rh_journey_progress_v1';

const results = [];

function record(id, pass, detail = '') {
  results.push({ id, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id}${detail ? ` — ${detail}` : ''}`);
}

async function clearJourneyProgress(page) {
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
}

async function readProgress(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.version === 2 && parsed.chapters) {
      const chapter =
        parsed.chapters['ch1-fritz-trail'] ??
        Object.values(parsed.chapters)[0] ??
        null;
      return {
        ...parsed,
        chapterId: parsed.activeChapterId,
        completedNodeIds: chapter?.completedNodeIds ?? [],
        lastVisitedNodeId: chapter?.lastVisitedNodeId ?? null,
      };
    }
    return parsed;
  }, STORAGE_KEY);
}

async function readChapterProgress(page, chapterId) {
  return page.evaluate(
    ({ key, chapterId: id }) => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed.chapters?.[id] ?? null;
    },
    { key: STORAGE_KEY, chapterId },
  );
}

async function getConsoleErrors(page) {
  return page.evaluate(() => window.__journeySmokeErrors ?? []);
}

async function browserPath(page) {
  return new URL(page.url()).pathname;
}

/** Hard-reset SPA route: clear JS state, load path, reload, wait for it to match. */
async function gotoAppRoute(page, base, path) {
  await page.goto('about:blank');
  await page.goto(`${base}${path}`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(
    (expectedPath) => window.location.pathname === expectedPath,
    path,
    { timeout: 8000 },
  );
  await page.waitForTimeout(300);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(String(err));
  });
  await page.addInitScript(() => {
    window.__journeySmokeErrors = [];
    const orig = console.error;
    console.error = (...args) => {
      window.__journeySmokeErrors.push(args.map(String).join(' '));
      orig.apply(console, args);
    };
  });

  // 1–2: Home + Single Player Hub
  await page.goto(`${BASE}/solo`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const soloTitle = page.getByRole('heading', { name: 'Single Player' });
  record('2-single-player-hub-loads', await soloTitle.isVisible());

  // 3–4: Journey card → journey route
  const journeyCard = page.getByRole('heading', { name: 'Racehorse Journey' });
  record('3-journey-card-visible', await journeyCard.isVisible());
  await page.getByRole('button', { name: /Start Journey|Continue Journey/i }).click();
  await page.waitForTimeout(600);
  record('4-journey-route', new URL(page.url()).pathname === '/journey', page.url());

  // 5: Direct load / refresh
  await page.goto(`${BASE}/journey`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  record('5-direct-journey-load', new URL(page.url()).pathname === '/journey');

  record(
    '3d-chapter-selector-visible',
    await page.locator('.rh-journey-chapter-card__title', { hasText: 'The High Line' }).isVisible(),
  );
  record(
    '3d-chapter2-locked-before-ch1-complete',
    await page
      .locator('[data-chapter-id="ch2-high-line"] .rh-journey-chapter-card__status', { hasText: 'Locked' })
      .isVisible(),
  );
  record(
    '3h-chapter-rail-scrolls-horizontal',
    await page.locator('.rh-journey-chapters__row').evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style.overflowX === 'auto' || style.overflowX === 'scroll';
    }),
  );
  await page.setViewportSize({ width: 390, height: 720 });
  await gotoAppRoute(page, BASE, '/journey');
  await page.waitForTimeout(500);
  const ch4CardNarrow = page.locator('[data-chapter-id="ch4-pressure-circuit"]');
  await ch4CardNarrow.scrollIntoViewIfNeeded();
  record('3h-ch4-accessible-via-scroll', await ch4CardNarrow.isVisible());
  const ch5CardNarrow = page.locator('[data-chapter-id="ch5-iron-mile"]');
  await ch5CardNarrow.scrollIntoViewIfNeeded();
  record('3h-ch5-accessible-via-scroll', await ch5CardNarrow.isVisible());
  const ch6CardNarrow = page.locator('[data-chapter-id="ch6-master-table"]');
  await ch6CardNarrow.scrollIntoViewIfNeeded();
  record('3h-ch6-accessible-via-scroll', await ch6CardNarrow.isVisible());
  await page.setViewportSize({ width: 1280, height: 720 });
  await gotoAppRoute(page, BASE, '/journey');
  await page.waitForTimeout(500);

  await clearJourneyProgress(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // 6: Node 1 current/unlocked
  const node1 = page.getByRole('button', { name: /Trailhead Briefing/i });
  const node2 = page.getByRole('button', { name: /First Score/i });
  record('6-node1-interactive', await node1.isEnabled());
  record('6-node2-locked', !(await node2.isEnabled()));
  record(
    '3h-node-clicks-at-720px',
    await node1
      .click({ timeout: 8000 })
      .then(() => true)
      .catch(() => false),
  );

  // 7: Checkpoint nodes use briefing, not QA mark complete
  if (!(await page.getByRole('button', { name: /Open Briefing/i }).isVisible().catch(() => false))) {
    await node1.click();
  }
  const markComplete = page.getByRole('button', { name: /Mark Complete \(QA\)/i });
  record('7-checkpoint-no-qa-mark-complete', !(await markComplete.isVisible().catch(() => false)));

  // 8–10: Briefing modal for node 1
  await page.getByRole('button', { name: /Open Briefing/i }).click();
  const modal = page.getByRole('dialog');
  record('2b-node1-briefing-opens', await modal.isVisible());
  record('9-begin-modal', await page.getByText(/Trail Notes/i).isVisible());
  await page.locator('.rh-modal-body .rh-btn--secondary').click();
  record('10-modal-closed', !(await modal.isVisible()));

  // 11–12: Complete Briefing → node 2 unlocks
  await page.getByRole('button', { name: /Open Briefing/i }).click();
  await page.getByRole('button', { name: /Complete Briefing/i }).click();
  await page.waitForTimeout(300);
  record('12-node1-completed-ui', (await node1.getAttribute('aria-label'))?.includes('Completed'));
  record('12-node2-unlocked', await node2.isEnabled());

  const progressAfterComplete = await readProgress(page);
  record(
    '12-storage-has-node1',
    progressAfterComplete?.completedNodeIds?.includes('ch1-n01') === true,
    JSON.stringify(progressAfterComplete?.completedNodeIds),
  );

  // 13–14: Refresh persists
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const progressAfterReload = await readProgress(page);
  record(
    '14-progress-persists',
    progressAfterReload?.completedNodeIds?.includes('ch1-n01') === true,
  );
  record('14-node2-still-unlocked', await node2.isEnabled());

  // 15–16: Reset
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const progressAfterReset = await readProgress(page);
  record(
    '16-reset-clears-storage',
    !progressAfterReset || progressAfterReset.completedNodeIds?.length === 0,
  );
  record('16-node2-locked-after-reset', !(await node2.isEnabled()));

  // Phase 2B: Node 7 briefing + review completed node 1 + puzzle placeholder
  await page.evaluate(
    (key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          chapterId: 'ch1-fritz-trail',
          completedNodeIds: ['ch1-n01', 'ch1-n02', 'ch1-n03', 'ch1-n04', 'ch1-n05', 'ch1-n06'],
          lastVisitedNodeId: 'ch1-n07',
          updatedAt: new Date().toISOString(),
        }),
      );
    },
    STORAGE_KEY,
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const node7 = page.getByRole('button', { name: /Double Trouble, Current/i });
  await node7.scrollIntoViewIfNeeded();
  await node7.click();
  await page.getByRole('button', { name: /Open Briefing/i }).click();
  record('2b-node7-briefing-opens', await page.getByText(/Tempo beats flash/i).isVisible());
  await page.getByRole('button', { name: /Complete Briefing/i }).click();
  await page.waitForTimeout(300);
  const progressAfterNode7 = await readProgress(page);
  record(
    '2b-node7-completes',
    progressAfterNode7?.completedNodeIds?.includes('ch1-n07') === true,
    JSON.stringify(progressAfterNode7?.completedNodeIds),
  );

  await page.getByRole('button', { name: /Trailhead Briefing/i }).click();
  await page.getByRole('button', { name: /Review Briefing/i }).click();
  await page.locator('.rh-journey-briefing__actions .rh-btn--secondary').click();
  const progressAfterReview = await readProgress(page);
  record(
    '2b-review-briefing-no-dupe',
    progressAfterReview?.completedNodeIds?.filter((id) => id === 'ch1-n01').length === 1,
    JSON.stringify(progressAfterReview?.completedNodeIds),
  );

  await page.evaluate(
    (key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          chapterId: 'ch1-fritz-trail',
          completedNodeIds: ['ch1-n01', 'ch1-n02'],
          lastVisitedNodeId: 'ch1-n03',
          updatedAt: new Date().toISOString(),
        }),
      );
    },
    STORAGE_KEY,
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const node3 = page.getByRole('button', { name: /Open Ends Trial, Current/i });
  await node3.scrollIntoViewIfNeeded();
  await node3.click();
  await page.getByRole('button', { name: /Open Challenge/i }).click();
  record('2c-node3-puzzle-opens', await page.getByText(/Read both open ends/i).isVisible());

  await page.getByRole('option', { name: /Strike fast on 3-4/i }).click();
  record(
    '2c-wrong-answer-no-complete-btn',
    !(await page.getByRole('button', { name: /Complete Puzzle/i }).isVisible().catch(() => false)),
  );
  await page.getByRole('button', { name: /Leave Challenge/i }).click();
  const progressAfterWrongClose = await readProgress(page);
  record(
    '2c-close-does-not-complete',
    !progressAfterWrongClose?.completedNodeIds?.includes('ch1-n03'),
    JSON.stringify(progressAfterWrongClose?.completedNodeIds),
  );

  await page.getByRole('button', { name: /Open Challenge/i }).click();
  await page.getByRole('option', { name: /Read both open ends/i }).click();
  await page.getByRole('button', { name: /Complete Puzzle/i }).click();
  await page.waitForTimeout(300);
  const node4 = page.getByRole('button', { name: /Draw Escape/i });
  record('2c-node3-completes-unlocks-node4', await node4.isEnabled());
  const progressAfterNode3 = await readProgress(page);
  record(
    '2c-node3-in-storage',
    progressAfterNode3?.completedNodeIds?.includes('ch1-n03') === true,
    JSON.stringify(progressAfterNode3?.completedNodeIds),
  );

  await page.getByRole('button', { name: /Open Ends Trial/i }).click();
  await page.getByRole('button', { name: /Review Challenge/i }).click();
  record('2c-review-shows-correct', await page.getByText(/Correct read/i).isVisible());
  await page.locator('.rh-journey-puzzle__actions .rh-btn--secondary').click();
  const progressAfterPuzzleReview = await readProgress(page);
  record(
    '2c-review-no-dupe',
    progressAfterPuzzleReview?.completedNodeIds?.filter((id) => id === 'ch1-n03').length === 1,
    JSON.stringify(progressAfterPuzzleReview?.completedNodeIds),
  );

  await page.evaluate(
    (key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          chapterId: 'ch1-fritz-trail',
          completedNodeIds: [
            'ch1-n01',
            'ch1-n02',
            'ch1-n03',
            'ch1-n04',
            'ch1-n05',
            'ch1-n06',
            'ch1-n07',
          ],
          lastVisitedNodeId: 'ch1-n08',
          updatedAt: new Date().toISOString(),
        }),
      );
    },
    STORAGE_KEY,
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Puzzle Gate, Current/i }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: /Puzzle Gate, Current/i }).click();
  await page.getByRole('button', { name: /Open Challenge/i }).click();
  record(
    '2c-node8-puzzle-opens',
    await page.getByText(/This gate decides whether you enter the late trail/i).isVisible(),
  );
  await page.locator('.rh-journey-puzzle__actions .rh-btn--secondary').click();

  await page.evaluate(
    (key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          chapterId: 'ch1-fritz-trail',
          completedNodeIds: [
            'ch1-n01',
            'ch1-n02',
            'ch1-n03',
            'ch1-n04',
            'ch1-n05',
            'ch1-n06',
            'ch1-n07',
            'ch1-n08',
          ],
          lastVisitedNodeId: 'ch1-n09',
          updatedAt: new Date().toISOString(),
        }),
      );
    },
    STORAGE_KEY,
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Pressure Hand, Current/i }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: /Pressure Hand, Current/i }).click();
  await page.getByRole('button', { name: /Open Challenge/i }).click();
  record(
    '2c-node9-puzzle-opens',
    await page.getByText(/With Elite Warmup ahead/i).isVisible(),
  );
  await page.locator('.rh-journey-puzzle__actions .rh-btn--secondary').click();

  await page.evaluate(
    (key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 2,
          activeChapterId: 'ch1-fritz-trail',
          chapters: {
            'ch1-fritz-trail': {
              completedNodeIds: [
                'ch1-n01',
                'ch1-n02',
                'ch1-n03',
                'ch1-n04',
                'ch1-n05',
                'ch1-n06',
                'ch1-n07',
                'ch1-n08',
                'ch1-n09',
                'ch1-n10',
                'ch1-n11',
                'ch1-n12',
              ],
              lastVisitedNodeId: 'ch1-n12',
              completedAt: new Date().toISOString(),
              completionCelebrated: true,
            },
          },
          updatedAt: new Date().toISOString(),
        }),
      );
    },
    STORAGE_KEY,
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  record('3d-ch1-complete-banner', await page.getByText(/Chapter 1 Complete/i).isVisible());
  record(
    '3d-not-whole-journey-complete',
    !(await page.getByText(/^Journey Complete$/i).isVisible().catch(() => false)),
  );
  record(
    '3d-ch2-available-after-ch1',
    await page
      .locator('[data-chapter-id="ch2-high-line"] .rh-journey-chapter-card__status', { hasText: 'Available' })
      .isVisible(),
  );
  record(
    '3e-ch3-locked-before-ch2-complete',
    await page
      .locator('[data-chapter-id="ch3-long-march"] .rh-journey-chapter-card__status', { hasText: 'Locked' })
      .isVisible(),
  );
  record(
    '3e-ch4-locked-before-ch2-complete',
    await page
      .locator('[data-chapter-id="ch4-pressure-circuit"] .rh-journey-chapter-card__status', { hasText: 'Locked' })
      .isVisible(),
  );
  record(
    '3e-ch5-locked-before-ch2-complete',
    await page
      .locator('[data-chapter-id="ch5-iron-mile"] .rh-journey-chapter-card__status', { hasText: 'Locked' })
      .isVisible(),
  );
  record(
    '3e-ch6-locked-before-ch2-complete',
    await page
      .locator('[data-chapter-id="ch6-master-table"] .rh-journey-chapter-card__status', { hasText: 'Locked' })
      .isVisible(),
  );

  // Chapter 2 playable flow (after Chapter 1 complete seed)
  await page.locator('[data-chapter-id="ch2-high-line"]').click();
  await page.waitForTimeout(500);
  record(
    '3e-ch2-map-visible',
    await page.locator('.rh-journey-map-panel__title', { hasText: 'The High Line' }).isVisible(),
  );
  record(
    '3e-ch2-node1-enabled',
    await page.getByRole('button', { name: /High Line Briefing/i }).isEnabled(),
  );
  record(
    '3e-ch2-node2-locked',
    !(await page.getByRole('button', { name: /No Free End/i }).isEnabled()),
  );

  await page.getByRole('button', { name: /High Line Briefing/i }).click();
  await page.getByRole('button', { name: /Open Briefing/i }).click();
  await page.getByRole('button', { name: /Complete Briefing/i }).click();
  await page.waitForTimeout(300);
  const ch2AfterN1 = await readChapterProgress(page, 'ch2-high-line');
  const ch1AfterCh2N1 = await readChapterProgress(page, 'ch1-fritz-trail');
  record(
    '3e-ch2-node1-completed',
    ch2AfterN1?.completedNodeIds?.includes('ch2-n01'),
    JSON.stringify(ch2AfterN1?.completedNodeIds),
  );
  record(
    '3e-ch1-progress-unchanged',
    ch1AfterCh2N1?.completedNodeIds?.length === 12,
    JSON.stringify(ch1AfterCh2N1?.completedNodeIds?.length),
  );
  record(
    '3e-ch2-node2-unlocked',
    await page.getByRole('button', { name: /No Free End/i }).isEnabled(),
  );

  await page.getByRole('button', { name: /No Free End/i }).click();
  await page.getByRole('button', { name: /Open Challenge/i }).click();
  await page.getByRole('option', { name: /Open the 2 end/i }).click();
  record(
    '3e-ch2-puzzle-wrong-no-complete',
    !(await page.getByRole('button', { name: /Complete Puzzle/i }).isVisible().catch(() => false)),
  );
  await page.getByRole('option', { name: /Deny the free end Fritz wants/i }).click();
  await page.getByRole('button', { name: /Complete Puzzle/i }).click();
  await page.waitForTimeout(300);
  record(
    '3e-ch2-node3-unlocked',
    await page.getByRole('button', { name: /Count Before Contact/i }).isEnabled(),
  );

  await page.getByRole('button', { name: /Count Before Contact/i }).click();
  await page.getByRole('button', { name: /Open Challenge/i }).click();
  await page.getByRole('option', { name: /Count both ends and trace Fritz/i }).click();
  await page.getByRole('button', { name: /Complete Puzzle/i }).click();
  await page.waitForTimeout(300);
  record(
    '3e-ch2-match-node-unlocked',
    await page.getByRole('button', { name: /Tight Board/i }).isEnabled(),
  );
  await page.getByRole('button', { name: /Tight Board/i }).click();
  await page.getByRole('button', { name: /Begin Trial/i }).click();
  const fritzLaunched = await page
    .getByRole('button', { name: /Leave game/i })
    .waitFor({ state: 'visible', timeout: 12000 })
    .then(() => true)
    .catch(() => false);
  record('3e-ch2-match-launches-fritz', fritzLaunched, page.url());
  if (fritzLaunched) {
    await page.getByRole('button', { name: /Leave game/i }).click();
    await page.waitForTimeout(800);
  }
  await gotoAppRoute(page, BASE, '/journey');
  await page.locator('[data-chapter-id="ch1-fritz-trail"]').click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Trailhead Briefing/i }).click();
  record(
    '3e-ch1-still-reviewable',
    await page.getByRole('button', { name: /Review Briefing/i }).isVisible(),
  );

  // Chapter 3 unlock + playable flow (after Chapter 2 complete seed)
  await page.evaluate((key) => {
    const ch1Ids = Array.from({ length: 12 }, (_, i) => `ch1-n${String(i + 1).padStart(2, '0')}`);
    const ch2Ids = Array.from({ length: 12 }, (_, i) => `ch2-n${String(i + 1).padStart(2, '0')}`);
    const now = new Date().toISOString();
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 2,
        activeChapterId: 'ch2-high-line',
        chapters: {
          'ch1-fritz-trail': {
            completedNodeIds: ch1Ids,
            lastVisitedNodeId: 'ch1-n12',
            completedAt: now,
            completionCelebrated: true,
          },
          'ch2-high-line': {
            completedNodeIds: ch2Ids,
            lastVisitedNodeId: 'ch2-n12',
            completedAt: now,
            completionCelebrated: true,
          },
        },
        updatedAt: now,
      }),
    );
  }, STORAGE_KEY);
  await gotoAppRoute(page, BASE, '/journey');
  record(
    '3f-ch3-available-after-ch2',
    await page
      .locator('[data-chapter-id="ch3-long-march"] .rh-journey-chapter-card__status', { hasText: 'Available' })
      .isVisible(),
  );
  record(
    '3f-ch4-locked-before-ch3-complete',
    await page
      .locator('[data-chapter-id="ch4-pressure-circuit"] .rh-journey-chapter-card__status', { hasText: 'Locked' })
      .isVisible(),
  );
  record(
    '3f-ch5-locked-before-ch3-complete',
    await page
      .locator('[data-chapter-id="ch5-iron-mile"] .rh-journey-chapter-card__status', { hasText: 'Locked' })
      .isVisible(),
  );
  record(
    '3f-ch6-locked-before-ch3-complete',
    await page
      .locator('[data-chapter-id="ch6-master-table"] .rh-journey-chapter-card__status', { hasText: 'Locked' })
      .isVisible(),
  );
  await page.locator('[data-chapter-id="ch3-long-march"]').click();
  await page.waitForTimeout(500);
  record(
    '3f-ch3-map-visible',
    await page.locator('.rh-journey-map-panel__title', { hasText: 'The Long March' }).isVisible(),
  );
  record(
    '3f-ch3-node1-enabled',
    await page.getByRole('button', { name: /Long March Briefing/i }).isEnabled(),
  );
  record(
    '3f-ch3-node2-locked',
    !(await page.getByRole('button', { name: /Bad Deal Recovery/i }).isEnabled()),
  );
  await page.getByRole('button', { name: /Long March Briefing/i }).click();
  await page.getByRole('button', { name: /Open Briefing/i }).click();
  await page.getByRole('button', { name: /Complete Briefing/i }).click();
  await page.waitForTimeout(300);
  const ch3AfterN1 = await readChapterProgress(page, 'ch3-long-march');
  const ch2AfterCh3N1 = await readChapterProgress(page, 'ch2-high-line');
  record(
    '3f-ch3-node1-completed',
    ch3AfterN1?.completedNodeIds?.includes('ch3-n01'),
    JSON.stringify(ch3AfterN1?.completedNodeIds),
  );
  record(
    '3f-ch2-progress-unchanged',
    ch2AfterCh3N1?.completedNodeIds?.length === 12,
    JSON.stringify(ch2AfterCh3N1?.completedNodeIds?.length),
  );
  record(
    '3f-ch3-node2-unlocked',
    await page.getByRole('button', { name: /Bad Deal Recovery/i }).isEnabled(),
  );
  await page.getByRole('button', { name: /Bad Deal Recovery/i }).click();
  await page.getByRole('button', { name: /Open Challenge/i }).click();
  await page.getByRole('option', { name: /Force the highest score this hand/i }).click();
  record(
    '3f-ch3-puzzle-wrong-no-complete',
    !(await page.getByRole('button', { name: /Complete Puzzle/i }).isVisible().catch(() => false)),
  );
  await page.getByRole('option', { name: /Play for tempo and board control/i }).click();
  await page.getByRole('button', { name: /Complete Puzzle/i }).click();
  await page.waitForTimeout(300);
  record(
    '3f-ch3-match-node-unlocked',
    await page.getByRole('button', { name: /Slow Start/i }).isEnabled(),
  );
  await page.getByRole('button', { name: /Slow Start/i }).click();
  await page.getByRole('button', { name: /Begin Trial/i }).click();
  const ch3FritzLaunched = await page
    .getByRole('button', { name: /Leave game/i })
    .waitFor({ state: 'visible', timeout: 12000 })
    .then(() => true)
    .catch(() => false);
  record('3f-ch3-match-launches-fritz', ch3FritzLaunched, page.url());
  if (ch3FritzLaunched) {
    await page.getByRole('button', { name: /Leave game/i }).click();
    await page.waitForTimeout(800);
  }
  await gotoAppRoute(page, BASE, '/journey');
  await page.locator('[data-chapter-id="ch1-fritz-trail"]').click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Trailhead Briefing/i }).click();
  record(
    '3f-ch1-still-reviewable-after-ch3',
    await page.getByRole('button', { name: /Review Briefing/i }).isVisible(),
  );
  await page.locator('[data-chapter-id="ch2-high-line"]').click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /High Line Briefing/i }).click();
  record(
    '3f-ch2-still-reviewable',
    await page.getByRole('button', { name: /Review Briefing/i }).isVisible(),
  );

  // Chapter 4 unlock + playable flow (after Chapter 3 complete seed)
  await page.evaluate((key) => {
    const ch1Ids = Array.from({ length: 12 }, (_, i) => `ch1-n${String(i + 1).padStart(2, '0')}`);
    const ch2Ids = Array.from({ length: 12 }, (_, i) => `ch2-n${String(i + 1).padStart(2, '0')}`);
    const ch3Ids = Array.from({ length: 20 }, (_, i) => `ch3-n${String(i + 1).padStart(2, '0')}`);
    const now = new Date().toISOString();
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 2,
        activeChapterId: 'ch3-long-march',
        chapters: {
          'ch1-fritz-trail': {
            completedNodeIds: ch1Ids,
            lastVisitedNodeId: 'ch1-n12',
            completedAt: now,
            completionCelebrated: true,
          },
          'ch2-high-line': {
            completedNodeIds: ch2Ids,
            lastVisitedNodeId: 'ch2-n12',
            completedAt: now,
            completionCelebrated: true,
          },
          'ch3-long-march': {
            completedNodeIds: ch3Ids,
            lastVisitedNodeId: 'ch3-n20',
            completedAt: now,
            completionCelebrated: true,
          },
        },
        updatedAt: now,
      }),
    );
  }, STORAGE_KEY);
  await gotoAppRoute(page, BASE, '/journey');
  record(
    '3g-ch4-available-after-ch3',
    await page
      .locator('[data-chapter-id="ch4-pressure-circuit"] .rh-journey-chapter-card__status', { hasText: 'Available' })
      .isVisible(),
  );
  record(
    '3g-ch5-locked-before-ch4-complete',
    await page
      .locator('[data-chapter-id="ch5-iron-mile"] .rh-journey-chapter-card__status', { hasText: 'Locked' })
      .isVisible(),
  );
  record(
    '3g-ch6-locked-before-ch4-complete',
    await page
      .locator('[data-chapter-id="ch6-master-table"] .rh-journey-chapter-card__status', { hasText: 'Locked' })
      .isVisible(),
  );
  await page.locator('[data-chapter-id="ch4-pressure-circuit"]').click();
  await page.waitForTimeout(500);
  record(
    '3g-ch4-map-visible',
    await page.locator('.rh-journey-map-panel__title', { hasText: 'The Pressure Circuit' }).isVisible(),
  );
  record(
    '3g-ch4-node1-enabled',
    await page.getByRole('button', { name: /Pressure Circuit Briefing/i }).isEnabled(),
  );
  record(
    '3g-ch4-node2-locked',
    !(await page.getByRole('button', { name: /Hold the Line/i }).isEnabled()),
  );
  await page.getByRole('button', { name: /Pressure Circuit Briefing/i }).click();
  await page.getByRole('button', { name: /Open Briefing/i }).click();
  await page.getByRole('button', { name: /Complete Briefing/i }).click();
  await page.waitForTimeout(300);
  const ch4AfterN1 = await readChapterProgress(page, 'ch4-pressure-circuit');
  const ch3AfterCh4N1 = await readChapterProgress(page, 'ch3-long-march');
  record(
    '3g-ch4-node1-completed',
    ch4AfterN1?.completedNodeIds?.includes('ch4-n01'),
    JSON.stringify(ch4AfterN1?.completedNodeIds),
  );
  record(
    '3g-ch3-progress-unchanged',
    ch3AfterCh4N1?.completedNodeIds?.length === 20,
    JSON.stringify(ch3AfterCh4N1?.completedNodeIds?.length),
  );
  record(
    '3g-ch4-node2-unlocked',
    await page.getByRole('button', { name: /Hold the Line/i }).isEnabled(),
  );
  await page.getByRole('button', { name: /Hold the Line/i }).click();
  await page.getByRole('button', { name: /Open Challenge/i }).click();
  await page.getByRole('option', { name: /Press for max score/i }).click();
  record(
    '3g-ch4-puzzle-wrong-no-complete',
    !(await page.getByRole('button', { name: /Complete Puzzle/i }).isVisible().catch(() => false)),
  );
  await page.getByRole('option', { name: /Take the modest score and deny Fritz the 4 end/i }).click();
  await page.getByRole('button', { name: /Complete Puzzle/i }).click();
  await page.waitForTimeout(300);
  record(
    '3g-ch4-match-node-unlocked',
    await page.getByRole('button', { name: /Early Squeeze/i }).isEnabled(),
  );
  await page.getByRole('button', { name: /Early Squeeze/i }).click();
  await page.getByRole('button', { name: /Begin Trial/i }).click();
  const ch4FritzLaunched = await page
    .getByRole('button', { name: /Leave game/i })
    .waitFor({ state: 'visible', timeout: 12000 })
    .then(() => true)
    .catch(() => false);
  record('3g-ch4-match-launches-fritz', ch4FritzLaunched, page.url());
  if (ch4FritzLaunched) {
    await page.getByRole('button', { name: /Leave game/i }).click();
    await page.waitForTimeout(800);
  }
  await gotoAppRoute(page, BASE, '/journey');
  await page.locator('[data-chapter-id="ch1-fritz-trail"]').click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Trailhead Briefing/i }).click();
  record(
    '3g-ch1-still-reviewable-after-ch4',
    await page.getByRole('button', { name: /Review Briefing/i }).isVisible(),
  );
  await page.locator('[data-chapter-id="ch2-high-line"]').click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /High Line Briefing/i }).click();
  record(
    '3g-ch2-still-reviewable-after-ch4',
    await page.getByRole('button', { name: /Review Briefing/i }).isVisible(),
  );
  await page.locator('[data-chapter-id="ch3-long-march"]').click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Long March Briefing/i }).click();
  record(
    '3g-ch3-still-reviewable-after-ch4',
    await page.getByRole('button', { name: /Review Briefing/i }).isVisible(),
  );

  // Chapter 5 unlock + playable flow (after Chapter 4 complete seed)
  await page.evaluate((key) => {
    const ch1Ids = Array.from({ length: 12 }, (_, i) => `ch1-n${String(i + 1).padStart(2, '0')}`);
    const ch2Ids = Array.from({ length: 12 }, (_, i) => `ch2-n${String(i + 1).padStart(2, '0')}`);
    const ch3Ids = Array.from({ length: 20 }, (_, i) => `ch3-n${String(i + 1).padStart(2, '0')}`);
    const ch4Ids = Array.from({ length: 24 }, (_, i) => `ch4-n${String(i + 1).padStart(2, '0')}`);
    const now = new Date().toISOString();
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 2,
        activeChapterId: 'ch4-pressure-circuit',
        chapters: {
          'ch1-fritz-trail': {
            completedNodeIds: ch1Ids,
            lastVisitedNodeId: 'ch1-n12',
            completedAt: now,
            completionCelebrated: true,
          },
          'ch2-high-line': {
            completedNodeIds: ch2Ids,
            lastVisitedNodeId: 'ch2-n12',
            completedAt: now,
            completionCelebrated: true,
          },
          'ch3-long-march': {
            completedNodeIds: ch3Ids,
            lastVisitedNodeId: 'ch3-n20',
            completedAt: now,
            completionCelebrated: true,
          },
          'ch4-pressure-circuit': {
            completedNodeIds: ch4Ids,
            lastVisitedNodeId: 'ch4-n24',
            completedAt: now,
            completionCelebrated: true,
          },
        },
        updatedAt: now,
      }),
    );
  }, STORAGE_KEY);
  await gotoAppRoute(page, BASE, '/journey');
  record(
    '3h-ch5-available-after-ch4',
    await page
      .locator('[data-chapter-id="ch5-iron-mile"] .rh-journey-chapter-card__status', { hasText: 'Available' })
      .isVisible(),
  );
  record(
    '3h-ch6-locked-before-ch5-complete',
    await page
      .locator('[data-chapter-id="ch6-master-table"] .rh-journey-chapter-card__status', { hasText: 'Locked' })
      .isVisible(),
  );
  const ch5Card = page.locator('[data-chapter-id="ch5-iron-mile"]');
  await ch5Card.scrollIntoViewIfNeeded();
  record(
    '3h-ch5-active-visible-in-rail',
    await ch5Card.isVisible(),
  );
  await ch5Card.click();
  await page.waitForTimeout(500);
  record(
    '3h-ch5-map-visible',
    await page.locator('.rh-journey-map-panel__title', { hasText: 'The Iron Mile' }).isVisible(),
  );
  record(
    '3h-ch5-node1-enabled',
    await page.getByRole('button', { name: /Iron Mile Briefing/i }).isEnabled(),
  );
  record(
    '3h-ch5-node2-locked',
    !(await page.getByRole('button', { name: /Protect the Lead/i }).isEnabled()),
  );
  await page.getByRole('button', { name: /Iron Mile Briefing/i }).click();
  await page.getByRole('button', { name: /Open Briefing/i }).click();
  await page.getByRole('button', { name: /Complete Briefing/i }).click();
  await page.waitForTimeout(300);
  const ch5AfterN1 = await readChapterProgress(page, 'ch5-iron-mile');
  const ch4AfterCh5N1 = await readChapterProgress(page, 'ch4-pressure-circuit');
  record(
    '3h-ch5-node1-completed',
    ch5AfterN1?.completedNodeIds?.includes('ch5-n01'),
    JSON.stringify(ch5AfterN1?.completedNodeIds),
  );
  record(
    '3h-ch4-progress-unchanged',
    ch4AfterCh5N1?.completedNodeIds?.length === 24,
    JSON.stringify(ch4AfterCh5N1?.completedNodeIds?.length),
  );
  record(
    '3h-ch5-node2-unlocked',
    await page.getByRole('button', { name: /Protect the Lead/i }).isEnabled(),
  );
  await page.getByRole('button', { name: /Protect the Lead/i }).click();
  await page.getByRole('button', { name: /Open Challenge/i }).click();
  await page.getByRole('option', { name: /Press for max score/i }).click();
  record(
    '3h-ch5-puzzle-wrong-no-complete',
    !(await page.getByRole('button', { name: /Complete Puzzle/i }).isVisible().catch(() => false)),
  );
  await page.getByRole('option', { name: /Take the modest score and deny Fritz the 5 end/i }).click();
  await page.getByRole('button', { name: /Complete Puzzle/i }).click();
  await page.waitForTimeout(300);
  record(
    '3h-ch5-match-node-unlocked',
    await page.getByRole('button', { name: /First Mile/i }).isEnabled(),
  );
  await page.getByRole('button', { name: /First Mile/i }).click();
  await page.getByRole('button', { name: /Begin Trial/i }).click();
  const ch5FritzLaunched = await page
    .getByRole('button', { name: /Leave game/i })
    .waitFor({ state: 'visible', timeout: 12000 })
    .then(() => true)
    .catch(() => false);
  record('3h-ch5-match-launches-fritz', ch5FritzLaunched, page.url());
  if (ch5FritzLaunched) {
    await page.getByRole('button', { name: /Leave game/i }).click();
    await page.waitForTimeout(800);
  }
  await gotoAppRoute(page, BASE, '/journey');
  await page.locator('[data-chapter-id="ch1-fritz-trail"]').click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Trailhead Briefing/i }).click();
  record(
    '3h-ch1-still-reviewable-after-ch5',
    await page.getByRole('button', { name: /Review Briefing/i }).isVisible(),
  );
  await page.locator('[data-chapter-id="ch2-high-line"]').click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /High Line Briefing/i }).click();
  record(
    '3h-ch2-still-reviewable-after-ch5',
    await page.getByRole('button', { name: /Review Briefing/i }).isVisible(),
  );
  await page.locator('[data-chapter-id="ch3-long-march"]').click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Long March Briefing/i }).click();
  record(
    '3h-ch3-still-reviewable-after-ch5',
    await page.getByRole('button', { name: /Review Briefing/i }).isVisible(),
  );
  await page.locator('[data-chapter-id="ch4-pressure-circuit"]').click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Pressure Circuit Briefing/i }).click();
  record(
    '3h-ch4-still-reviewable-after-ch5',
    await page.getByRole('button', { name: /Review Briefing/i }).isVisible(),
  );

  // Chapter 6 unlock + playable flow (after Chapter 5 complete seed)
  await page.evaluate((key) => {
    const ch1Ids = Array.from({ length: 12 }, (_, i) => `ch1-n${String(i + 1).padStart(2, '0')}`);
    const ch2Ids = Array.from({ length: 12 }, (_, i) => `ch2-n${String(i + 1).padStart(2, '0')}`);
    const ch3Ids = Array.from({ length: 20 }, (_, i) => `ch3-n${String(i + 1).padStart(2, '0')}`);
    const ch4Ids = Array.from({ length: 24 }, (_, i) => `ch4-n${String(i + 1).padStart(2, '0')}`);
    const ch5Ids = Array.from({ length: 24 }, (_, i) => `ch5-n${String(i + 1).padStart(2, '0')}`);
    const now = new Date().toISOString();
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 2,
        activeChapterId: 'ch5-iron-mile',
        chapters: {
          'ch1-fritz-trail': {
            completedNodeIds: ch1Ids,
            lastVisitedNodeId: 'ch1-n12',
            completedAt: now,
            completionCelebrated: true,
          },
          'ch2-high-line': {
            completedNodeIds: ch2Ids,
            lastVisitedNodeId: 'ch2-n12',
            completedAt: now,
            completionCelebrated: true,
          },
          'ch3-long-march': {
            completedNodeIds: ch3Ids,
            lastVisitedNodeId: 'ch3-n20',
            completedAt: now,
            completionCelebrated: true,
          },
          'ch4-pressure-circuit': {
            completedNodeIds: ch4Ids,
            lastVisitedNodeId: 'ch4-n24',
            completedAt: now,
            completionCelebrated: true,
          },
          'ch5-iron-mile': {
            completedNodeIds: ch5Ids,
            lastVisitedNodeId: 'ch5-n24',
            completedAt: now,
            completionCelebrated: true,
          },
        },
        updatedAt: now,
      }),
    );
  }, STORAGE_KEY);
  await gotoAppRoute(page, BASE, '/journey');
  record(
    '3i-ch6-available-after-ch5',
    await page
      .locator('[data-chapter-id="ch6-master-table"] .rh-journey-chapter-card__status', { hasText: 'Available' })
      .isVisible(),
  );
  const ch6Card = page.locator('[data-chapter-id="ch6-master-table"]');
  await ch6Card.scrollIntoViewIfNeeded();
  record('3i-ch6-active-visible-in-rail', await ch6Card.isVisible());
  await ch6Card.click();
  await page.waitForTimeout(500);
  record(
    '3i-ch6-map-visible',
    await page.locator('.rh-journey-map-panel__title', { hasText: 'The Master Table' }).isVisible(),
  );
  record(
    '3i-ch6-node1-enabled',
    await page.getByRole('button', { name: /Master Table Briefing/i }).isEnabled(),
  );
  record(
    '3i-ch6-node2-locked',
    !(await page.getByRole('button', { name: /No Gifts/i }).isEnabled()),
  );
  await page.getByRole('button', { name: /Master Table Briefing/i }).click();
  await page.getByRole('button', { name: /Open Briefing/i }).click();
  await page.getByRole('button', { name: /Complete Briefing/i }).click();
  await page.waitForTimeout(300);
  const ch6AfterN1 = await readChapterProgress(page, 'ch6-master-table');
  const ch5AfterCh6N1 = await readChapterProgress(page, 'ch5-iron-mile');
  record(
    '3i-ch6-node1-completed',
    ch6AfterN1?.completedNodeIds?.includes('ch6-n01'),
    JSON.stringify(ch6AfterN1?.completedNodeIds),
  );
  record(
    '3i-ch5-progress-unchanged',
    ch5AfterCh6N1?.completedNodeIds?.length === 24,
    JSON.stringify(ch5AfterCh6N1?.completedNodeIds?.length),
  );
  record(
    '3i-ch6-node2-unlocked',
    await page.getByRole('button', { name: /No Gifts/i }).isEnabled(),
  );
  await page.getByRole('button', { name: /No Gifts/i }).click();
  await page.getByRole('button', { name: /Open Challenge/i }).click();
  await page.getByRole('option', { name: /Take the six/i }).click();
  record(
    '3i-ch6-puzzle-wrong-no-complete',
    !(await page.getByRole('button', { name: /Complete Puzzle/i }).isVisible().catch(() => false)),
  );
  await page.getByRole('option', { name: /Take the modest score and deny Fritz the end/i }).click();
  await page.getByRole('button', { name: /Complete Puzzle/i }).click();
  await page.waitForTimeout(300);
  record(
    '3i-ch6-match-node-unlocked',
    await page.getByRole('button', { name: /Control Trial/i }).isEnabled(),
  );
  await page.getByRole('button', { name: /Control Trial/i }).click();
  await page.getByRole('button', { name: /Begin Trial/i }).click();
  const ch6FritzLaunched = await page
    .getByRole('button', { name: /Leave game/i })
    .waitFor({ state: 'visible', timeout: 12000 })
    .then(() => true)
    .catch(() => false);
  record('3i-ch6-match-launches-fritz', ch6FritzLaunched, page.url());
  if (ch6FritzLaunched) {
    await page.getByRole('button', { name: /Leave game/i }).click();
    await page.waitForTimeout(800);
  }
  await gotoAppRoute(page, BASE, '/journey');
  await page.locator('[data-chapter-id="ch1-fritz-trail"]').click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Trailhead Briefing/i }).click();
  record(
    '3i-ch1-still-reviewable-after-ch6',
    await page.getByRole('button', { name: /Review Briefing/i }).isVisible(),
  );
  await page.locator('[data-chapter-id="ch2-high-line"]').click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /High Line Briefing/i }).click();
  record(
    '3i-ch2-still-reviewable-after-ch6',
    await page.getByRole('button', { name: /Review Briefing/i }).isVisible(),
  );
  await page.locator('[data-chapter-id="ch3-long-march"]').click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Long March Briefing/i }).click();
  record(
    '3i-ch3-still-reviewable-after-ch6',
    await page.getByRole('button', { name: /Review Briefing/i }).isVisible(),
  );
  await page.locator('[data-chapter-id="ch4-pressure-circuit"]').click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Pressure Circuit Briefing/i }).click();
  record(
    '3i-ch4-still-reviewable-after-ch6',
    await page.getByRole('button', { name: /Review Briefing/i }).isVisible(),
  );
  await page.locator('[data-chapter-id="ch5-iron-mile"]').click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Iron Mile Briefing/i }).click();
  record(
    '3i-ch5-still-reviewable-after-ch6',
    await page.getByRole('button', { name: /Review Briefing/i }).isVisible(),
  );

  await clearJourneyProgress(page);
  await page.goto(`${BASE}/journey`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Trailhead Briefing/i }).click();
  await page.getByRole('button', { name: /Open Briefing/i }).click();
  await page.getByRole('button', { name: /Complete Briefing/i }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /First Score/i }).click();
  await page.getByRole('button', { name: /Begin Trial/i }).click();
  await page.waitForTimeout(1500);
  const leaveButton = page.getByRole('button', { name: /Leave game/i });
  record('2a-journey-launches-bot-match', await leaveButton.isVisible());
  await leaveButton.click();
  await page.getByRole('button', { name: 'Leave Game', exact: true }).click();
  await page.waitForTimeout(800);
  record('2a-exit-returns-to-journey', new URL(page.url()).pathname === '/journey');
  const progressAfterExit = await readProgress(page);
  record(
    '2a-exit-does-not-complete-node',
    !progressAfterExit?.completedNodeIds?.includes('ch1-n02'),
    JSON.stringify(progressAfterExit?.completedNodeIds),
  );

  // Normal Play vs Fritz setup still reachable
  await clearJourneyProgress(page);
  await gotoAppRoute(page, BASE, '/solo');
  await page.getByRole('heading', { name: 'Single Player' }).waitFor({ state: 'visible', timeout: 10000 });
  await page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Play vs Fritz' }) })
    .getByRole('button', { name: /^Play$/i })
    .click();
  await page.waitForTimeout(1000);
  record('2a-normal-bot-setup-loads', await page.getByText(/Rookie|Standard|Elite|Master/i).first().isVisible().catch(() => false), page.url());

  // Route spot-checks — reset out of botSetup (socket modes map appMode URL to /).
  await gotoAppRoute(page, BASE, '/');
  const routes = [
    { path: '/', label: 'home' },
    { path: '/solo', label: 'solo' },
    { path: '/daily-fritz', label: 'daily-fritz' },
    { path: '/learn', label: 'learn' },
  ];
  for (const route of routes) {
    await gotoAppRoute(page, BASE, route.path);
    const currentPath = await browserPath(page);
    const routeOk =
      route.label === 'solo'
        ? await page
            .getByRole('heading', { name: 'Single Player' })
            .waitFor({ state: 'visible', timeout: 8000 })
            .then(() => true)
            .catch(() => false)
        : route.label === 'learn'
          ? (await page
              .getByRole('heading', { name: /Learn/i })
              .waitFor({ state: 'visible', timeout: 8000 })
              .catch(() => false)) || currentPath === route.path
          : currentPath === route.path;
    record(`18-route-${route.label}`, routeOk, `${currentPath} (${page.url()})`);
  }

  // bot is a socket mode — URL syncs to /; only verify navigation does not crash.
  await page.goto('about:blank');
  await page.goto(`${BASE}/bot`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);
  record('18-route-bot-no-crash', true, `url=${page.url()}`);

  const filteredErrors = consoleErrors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('Failed to load resource') &&
      !e.includes('net::ERR') &&
      !e.includes('401') &&
      !e.includes('Supabase'),
  );
  record('17-no-console-errors', filteredErrors.length === 0, filteredErrors.join(' | ') || 'none');

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log('\n--- Summary ---');
  console.log(`Passed: ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    console.log('Failures:', failed);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
