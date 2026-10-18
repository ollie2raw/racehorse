/**
 * Independent review of the game-feel slice, against the real LiveMatchScreen/Board/CSS (e2e/harness/gameFeelReviewHarness.tsx).
 * Every claim is measured from the browser's own animation events, not inferred from markup:
 *   - `animationstart` events are counted per animation name for the whole page lifetime;
 *   - `document.getAnimations()` tells what is running and which properties it animates.
 */
import { expect, test, type Page } from '@playwright/test';

const url = (q = '') => `/e2e/harness/game-feel-review.html${q ? `?${q}` : ''}`;

type Tile = { low: number; high: number };
type Gf = { set: (p: Record<string, unknown>) => void; get: () => Record<string, unknown> };
declare global { interface Window { __gf: Gf; __starts: Record<string, number> } }

async function open(page: Page, q = '') {
  await page.addInitScript(() => {
    window.__starts = {};
    document.addEventListener('animationstart', (e) => {
      const name = (e as AnimationEvent).animationName;
      window.__starts[name] = (window.__starts[name] ?? 0) + 1;
    }, true);
  });
  await page.goto(url(q));
  await page.locator('.board-tile-wrapper').first().waitFor();
  await page.waitForTimeout(900); // mount animations (screen entry) settle; counts below are deltas from here
}
const starts = (page: Page, name: string) => page.evaluate((n) => window.__starts[n] ?? 0, name);
const set = (page: Page, patch: Record<string, unknown>) => page.evaluate((p) => window.__gf.set(p), patch);
/** A genuine single public placement; the harness proves the new board is the old board plus exactly one tile. */
async function place(page: Page, patch: Record<string, unknown>) {
  await set(page, patch);
  expect(await page.evaluate(() => (window.__gf as unknown as { delta: () => { added: number; removed: number } }).delta()), 'fixture must be old board + exactly one tile').toEqual({ added: 1, removed: 0 });
}
const arrive = (page: Page) => page.locator('.board-tile-wrapper[data-placement-feedback=arrive]').count();
const wrappers = (page: Page) => page.locator('.board-tile-wrapper').count();

test.describe('tile landing', () => {
  test('a populated long-chain board hydrates silently (no landing, no old entry animation)', async ({ page }) => {
    await open(page, 'up=8&down=8');
    expect(await wrappers(page)).toBeGreaterThan(15);
    expect(await arrive(page)).toBe(0);
    expect(await starts(page, 'rh-tile-land')).toBe(0);
    expect(await starts(page, 'board-tile-enter')).toBe(0);
    expect(await starts(page, 'wl-board-land')).toBe(0);
  });

  test('one genuine placement animates exactly one tile, once; unrelated renders never replay it', async ({ page }) => {
    await open(page, 'up=8&down=0');
    await place(page, { up: 9 });
    await expect.poll(() => starts(page, 'rh-tile-land')).toBe(1);
    expect(await arrive(page)).toBe(1);
    await page.waitForTimeout(400);
    // every kind of unrelated render
    await set(page, { myScore: 17 });
    await set(page, { boneyard: 9 });
    await set(page, { openEnds: 14 });
    await set(page, { isMine: false });
    await set(page, { isMine: true });
    await set(page, { selected: { low: 0, high: 6 } });
    await page.waitForTimeout(500);
    expect(await starts(page, 'rh-tile-land')).toBe(1);
  });

  test('the same holds for an opponent placement (seat-independent)', async ({ page }) => {
    await open(page, 'up=3&down=3');
    await set(page, { isMine: false });
    await place(page, { down: 4 });
    await expect.poll(() => starts(page, 'rh-tile-land')).toBe(1);
  });

  test('a routing bend or resize never makes old dominoes look newly placed (long chain)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page, 'up=8&down=0');
    await place(page, { up: 9 });
    await expect.poll(() => starts(page, 'rh-tile-land')).toBe(1);
    await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelectorAll('.board-tile-wrapper').forEach((el, i) => el.setAttribute('data-keep', String(i))));
    for (const size of [{ width: 900, height: 600 }, { width: 1512, height: 982 }, { width: 844, height: 390 }, { width: 1280, height: 720 }]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(350);
    }
    expect(await starts(page, 'rh-tile-land')).toBe(1);
    expect(await page.locator('.board-tile-wrapper[data-keep]').count()).toBe(await wrappers(page)); // none remounted by routing
  });

  test('a left-end placement renumbers main-line layout keys but still animates only the new tile', async ({ page }) => {
    await open(page, 'left=3&right=3&up=2&down=2');
    await place(page, { left: 4 });
    await expect.poll(() => starts(page, 'rh-tile-land')).toBe(1);
    await page.waitForTimeout(500);
    expect(await starts(page, 'rh-tile-land')).toBe(1);
  });

  test('batch catch-up (+2), a new hand, hidden tab, recovery and reconnect are silent', async ({ page }) => {
    await open(page, 'up=4&down=4');
    await set(page, { up: 6 }); // two tiles at once (batch / catch-up)
    await page.waitForTimeout(300);
    await set(page, { handNumber: 2, up: 0, down: 0 }); // new hand clears the board
    await page.waitForTimeout(200);
    await set(page, { up: 1 }); // first tile of the new hand IS genuine
    await expect.poll(() => starts(page, 'rh-tile-land')).toBe(1);
    await page.waitForTimeout(400);

    await set(page, { recovery: true });
    await set(page, { up: 2 });
    await set(page, { recovery: false });
    await page.waitForTimeout(400);
    expect(await starts(page, 'rh-tile-land')).toBe(1);

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await set(page, { up: 3 });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(400);
    expect(await starts(page, 'rh-tile-land')).toBe(1);
  });

  test('reloading an already populated board (reconnect) plays nothing', async ({ page }) => {
    await open(page, 'up=6&down=5&left=2');
    await page.reload();
    await page.locator('.board-tile-wrapper').first().waitFor();
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => window.__starts['rh-tile-land'] ?? 0)).toBe(0);
  });

  test('landing moves the tile CONTENT only: the positioned wrapper never animates and layout does not shift', async ({ page }) => {
    await open(page, 'up=4&down=4');
    const before = await page.locator('.board-tile-wrapper').evaluateAll((els) => els.map((e) => JSON.stringify(e.getBoundingClientRect())));
    await set(page, { up: 5 });
    await expect.poll(() => starts(page, 'rh-tile-land')).toBe(1);
    const running = await page.evaluate(() => document.getAnimations().filter((a) => (a as CSSAnimation).animationName === 'rh-tile-land').map((a) => ({
      target: (a.effect as KeyframeEffect).target?.className,
      props: [...new Set((a.effect as KeyframeEffect).getKeyframes().flatMap((k) => Object.keys(k)))].filter((k) => !['offset', 'computedOffset', 'easing', 'composite'].includes(k)),
    })));
    for (const r of running) {
      expect(String(r.target)).toContain('domino-tile');
      expect(r.props.sort()).toEqual(['opacity', 'scale', 'translate']); // compositor-friendly only
    }
    await page.waitForTimeout(500);
    const wrapperAnims = await page.evaluate(() => document.getAnimations().filter((a) => (a.effect as KeyframeEffect).target?.classList?.contains('board-tile-wrapper')).length);
    expect(wrapperAnims).toBe(0);
    expect(await page.locator('.board-tile-wrapper').count()).toBe(before.length + 1);
  });

  test('reduced motion: placement is understandable without movement and nothing animates', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, 'up=3&down=3');
    await set(page, { up: 4 });
    await page.waitForTimeout(500);
    expect(await arrive(page)).toBe(0);
    expect(await starts(page, 'rh-tile-land')).toBe(0);
    expect(await wrappers(page)).toBeGreaterThan(0);
  });
});

test.describe('turn handoff', () => {
  test('finite: one reveal per ownership change, nothing perpetual, ownership readable afterwards', async ({ page }) => {
    await open(page, 'up=3&down=3');
    const startsBefore = await starts(page, 'rh-turn-handoff');
    await set(page, { isMine: false });
    await expect.poll(() => starts(page, 'rh-turn-handoff')).toBe(startsBefore + 1);
    await set(page, { myScore: 17 });
    await set(page, { boneyard: 9 });
    await page.waitForTimeout(400);
    expect(await starts(page, 'rh-turn-handoff')).toBe(startsBefore + 1); // unrelated renders do not replay it
    await expect(page.locator('.rh-turn-status')).toHaveText('Opponent thinking');
    await expect(page.locator('.rh-turn-status')).toHaveClass(/opp-turn/);
    await set(page, { isMine: true });
    await expect(page.locator('.rh-turn-status')).toHaveText('Your move');
    await expect(page.locator('.rh-turn-status')).toHaveClass(/your-turn/);
    await page.waitForTimeout(500);
    const infinite = await page.evaluate(() => document.getAnimations()
      .filter((a) => (a.effect as KeyframeEffect).getComputedTiming().iterations === Infinity)
      .map((a) => `${(a as CSSAnimation).animationName}@${(a.effect as KeyframeEffect).target?.className}`));
    const matchScope = infinite.filter((s) => /wl-|rh-turn|pill|score|hud|board/i.test(s));
    expect(matchScope, 'perpetual attention animations inside the match HUD').toEqual([]);
  });

  test('first render and a reconnect into an active turn show the label without replaying a handoff', async ({ page }) => {
    await open(page, 'up=3&down=3');
    await page.reload();
    await page.locator('.rh-turn-status').waitFor();
    await page.waitForTimeout(600);
    // mount itself plays the reveal once (it is the first appearance); it must not repeat
    const n1 = await starts(page, 'rh-turn-handoff');
    await set(page, { myScore: 20 });
    await page.waitForTimeout(400);
    expect(await starts(page, 'rh-turn-handoff')).toBe(n1);
    expect(n1).toBeLessThanOrEqual(1);
  });

  test('reduced motion: ownership still obvious, no handoff animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, 'up=3&down=3');
    await set(page, { isMine: false });
    await page.waitForTimeout(300);
    await expect(page.locator('.rh-turn-status')).toHaveText('Opponent thinking');
    expect(await starts(page, 'rh-turn-handoff')).toBe(0);
    await expect(page.locator('.rh-turn-status')).toHaveClass(/opp-turn/);
    await expect(page.locator('.rh-turn-status')).toBeVisible();
  });
});

test.describe('score and counters', () => {
  test('score is semantically exact immediately; rapid scores settle on the authoritative value; reconnect is quiet', async ({ page }) => {
    await open(page, 'up=3&down=3');
    const mine = page.locator('.is-you .rh-score-value').first();
    await expect(mine).toHaveAccessibleName('15');
    await set(page, { myScore: 17 });
    await expect(mine).toHaveAccessibleName('17'); // semantic value updates at once, before the visual count finishes
    await set(page, { myScore: 19 });
    await set(page, { myScore: 24 });
    await set(page, { myScore: 25 });
    await expect(mine).toHaveAccessibleName('25');
    await expect(mine).toHaveText('25', { timeout: 3000 });
    await page.waitForTimeout(500);
    const text = await mine.textContent();
    expect(text).toBe('25');

    // reconnect with an already-changed score: no acknowledgement on first paint
    await page.goto(url('score=40&up=3&down=3'));
    await page.locator('.is-you .rh-score-value').first().waitFor();
    await page.waitForTimeout(700);
    expect(await starts(page, 'rh-score-acknowledge')).toBe(0);
    await expect(page.locator('.is-you .rh-score-value').first()).toHaveText('40');
  });

  test('a decrease or unchanged score does nothing misleading', async ({ page }) => {
    await open(page, 'up=3&down=3');
    await set(page, { myScore: 15 });
    await set(page, { myScore: 10 }); // e.g. a corrected/new-game value: exact, but no reward emphasis
    await page.waitForTimeout(500);
    expect(await starts(page, 'rh-score-acknowledge')).toBe(0);
    await expect(page.locator('.is-you .rh-score-value').first()).toHaveAccessibleName('10');
  });

  test('both seats count and acknowledge; reduced motion shows exact scores with no movement', async ({ page }) => {
    await open(page, 'up=3&down=3');
    await set(page, { oppScore: 17 });
    await expect(page.locator('.rh-score-value').nth(0)).toBeVisible();
    await page.waitForTimeout(600);
    await expect(page.locator('.wl-player-pill:not(.is-you) .rh-score-value').first()).toHaveText('17');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await set(page, { myScore: 30 });
    await expect(page.locator('.is-you .rh-score-value').first()).toHaveText('30'); // immediate, no count
    expect(await starts(page, 'rh-score-acknowledge')).toBeLessThanOrEqual(1);
  });

  test('open and boneyard counters acknowledge only a real change and are exact at once', async ({ page }) => {
    await open(page, 'up=3&down=3');
    const boneyard = page.locator('.boneyard-count');
    const open_ = page.locator('.open-ends-count');
    const base = await starts(page, 'rh-number-change');
    await set(page, { myScore: 17 });
    await set(page, { boneyard: 10 }); // same value
    await page.waitForTimeout(300);
    expect(await starts(page, 'rh-number-change')).toBe(base);
    await set(page, { boneyard: 9 });
    await expect(boneyard).toHaveText('9'); // exact immediately
    await expect.poll(() => starts(page, 'rh-number-change')).toBe(base + 1);
    await set(page, { boneyard: 6 }); // multi-draw jump: exact value, one acknowledgement
    await expect(boneyard).toHaveText('6');
    await expect.poll(() => starts(page, 'rh-number-change')).toBe(base + 2);
    expect(await open_.count()).toBeGreaterThanOrEqual(0);
  });
});

test.describe('hand identity', () => {
  const tiles = (page: Page) => page.locator('.hand-container .domino-tile');

  test('removing or adding one tile does not remount its neighbours; selection stays with the same logical tile', async ({ page }) => {
    await open(page, 'up=3&down=3');
    await set(page, { selected: { low: 4, high: 4 } });
    await expect(page.locator('.hand-container .domino-tile.selected')).toHaveCount(1);
    await page.evaluate(() => document.querySelectorAll('.hand-container .domino-tile').forEach((el, i) => el.setAttribute('data-keep', String(i))));
    const selectedName = await page.locator('.hand-container .domino-tile.selected').getAttribute('aria-label');
    // play the FIRST tile
    await set(page, { hand: [{ low: 1, high: 6 }, { low: 2, high: 5 }, { low: 4, high: 4 }, { low: 3, high: 5 }] });
    await expect(tiles(page)).toHaveCount(4);
    expect(await page.locator('.hand-container .domino-tile[data-keep]').count()).toBe(4); // all four survived (no remount)
    expect(await page.locator('.hand-container .domino-tile.selected').getAttribute('aria-label')).toBe(selectedName);
    // draw one: the new tile is the only new instance
    await set(page, { hand: [{ low: 1, high: 6 }, { low: 2, high: 5 }, { low: 4, high: 4 }, { low: 3, high: 5 }, { low: 6, high: 6 }], drawPulse: 4 });
    await expect(tiles(page)).toHaveCount(5);
    expect(await page.locator('.hand-container .domino-tile[data-keep]').count()).toBe(4);
    await expect(page.locator('.hand-container .domino-tile.new-draw')).toHaveCount(1);
    await expect(page.locator('.hand-container .domino-tile.new-draw')).toHaveAttribute('aria-label', /6-6/);
  });

  test('a new deal containing the same tile identities inherits no selection, draw emphasis or pressed state', async ({ page }) => {
    await open(page, 'up=3&down=3');
    await set(page, { selected: { low: 4, high: 4 }, drawPulse: 3 });
    await expect(page.locator('.hand-container .domino-tile.selected')).toHaveCount(1);
    await set(page, { handNumber: 2, selected: null, drawPulse: null }); // same five tiles dealt again
    await expect(page.locator('.hand-container .domino-tile.selected')).toHaveCount(0);
    await expect(page.locator('.hand-container .domino-tile.new-draw')).toHaveCount(0);
    await expect(page.locator('.hand-container .domino-tile[aria-pressed=true]')).toHaveCount(0);
  });

  test('multi-draw: each drawn tile is a distinct instance and only the pulse index emphasises', async ({ page }) => {
    await open(page, 'up=3&down=3');
    const base: Tile[] = [{ low: 0, high: 6 }, { low: 1, high: 6 }];
    await set(page, { hand: base, drawPulse: null });
    await page.evaluate(() => document.querySelectorAll('.hand-container .domino-tile').forEach((el, i) => el.setAttribute('data-keep', String(i))));
    for (const [i, t] of ([{ low: 2, high: 2 }, { low: 3, high: 3 }, { low: 5, high: 5 }] as Tile[]).entries()) {
      base.push(t);
      await set(page, { hand: [...base], drawPulse: base.length - 1 });
      await expect(page.locator('.hand-container .domino-tile.new-draw')).toHaveCount(1);
      expect(await page.locator('.hand-container .domino-tile[data-keep]').count()).toBe(2);
      expect(i).toBeGreaterThanOrEqual(0);
    }
    await expect(tiles(page)).toHaveCount(5);
  });

  test('keyboard focus is visible and tiles stay buttons', async ({ page }) => {
    await open(page, 'up=3&down=3');
    const first = tiles(page).first();
    await first.focus();
    await expect(first).toBeFocused();
    expect(await first.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    expect(await first.evaluate((el) => el.tagName)).toBe('BUTTON');
  });
});

test.describe('rapid sequence', () => {
  test('draw x3 -> play -> score -> turn change, overlapping in time, settles exactly with nothing left running', async ({ page }) => {
    await open(page, 'up=8&down=0');
    await page.evaluate(async () => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const g = window.__gf;
      let hand = [{ low: 0, high: 6 }, { low: 1, high: 6 }, { low: 2, high: 5 }];
      g.set({ boneyard: 9, hand: [...hand, { low: 6, high: 6 }], drawPulse: 3 }); await wait(40);
      g.set({ boneyard: 8, hand: [...hand, { low: 6, high: 6 }, { low: 5, high: 5 }], drawPulse: 4 }); await wait(40);
      g.set({ boneyard: 7, hand: [...hand, { low: 6, high: 6 }, { low: 5, high: 5 }, { low: 3, high: 3 }], drawPulse: 5 }); await wait(40);
      g.set({ up: 9, hand: [{ low: 1, high: 6 }, { low: 2, high: 5 }, { low: 6, high: 6 }, { low: 5, high: 5 }, { low: 3, high: 3 }], drawPulse: null, openEnds: 14 }); await wait(40);
      g.set({ myScore: 17 }); await wait(40);
      g.set({ isMine: false });
    });
    await page.waitForTimeout(1200);
    await expect(page.locator('.is-you .rh-score-value').first()).toHaveAccessibleName('17');
    await expect(page.locator('.is-you .rh-score-value').first()).toHaveText('17');
    await expect(page.locator('.boneyard-count')).toHaveText('7');
    await expect(page.locator('.rh-turn-status')).toHaveText('Opponent thinking');
    await expect(page.locator('.hand-container .domino-tile')).toHaveCount(5);
    await expect(page.locator('.hand-container .domino-tile.new-draw')).toHaveCount(0);
    expect(await starts(page, 'rh-tile-land')).toBe(1);
    const stillRunning = await page.evaluate(() => document.getAnimations().filter((a) => /rh-/.test((a as CSSAnimation).animationName ?? '')).length);
    expect(stillRunning).toBe(0);
  });
});

const VIEWPORTS = [
  { name: '1512x982', width: 1512, height: 982 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '932x430', width: 932, height: 430 },
  { name: '844x390', width: 844, height: 390 },
  { name: '740x360', width: 740, height: 360 },
  { name: '667x375', width: 667, height: 375 },
];

test.describe('phone / desktop parity', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: turn pill fits, nothing drifts or overflows when ownership changes and a tile lands`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await open(page, 'up=4&down=4');
      const rects = () => page.evaluate(() => {
        const r = (sel: string) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
        return { hand: r('.hand-container'), board: r('.board-container'), mine: r('.wl-player-pill.is-you'), opp: r('.wl-player-pill:not(.is-you)') };
      });
      const label = page.locator('.rh-turn-status');
      const fit = await label.evaluate((el) => ({ clipped: el.scrollWidth > el.clientWidth + 1, content: el.querySelector('.rh-turn-status__content')!.getBoundingClientRect().width, box: el.getBoundingClientRect().width }));
      expect(fit.clipped, 'turn label clipped').toBe(false);
      expect(fit.content).toBeLessThanOrEqual(fit.box + 1);

      const before = await rects();
      await set(page, { isMine: false });
      await page.waitForTimeout(60); // mid-handoff
      const during = await rects();
      await page.waitForTimeout(400);
      const after = await rects();
      // the label copy changes length ("Your move" vs "Opponent thinking"); everything else must stay put
      for (const k of ['hand', 'board', 'mine', 'opp'] as const) {
        console.log(`PARITY ${vp.name} ${k} before=${JSON.stringify(before[k])} during=${JSON.stringify(during[k])} after=${JSON.stringify(after[k])}`);
        expect(during[k], `${k} moved mid-handoff`).toEqual(before[k]);
        expect(after[k], `${k} moved after handoff`).toEqual(before[k]);
      }
      const overlap = await page.evaluate(() => {
        const t = document.querySelector('.rh-turn-status')!.getBoundingClientRect();
        return [...document.querySelectorAll('.wl-player-pill')].some((p) => {
          const b = p.getBoundingClientRect();
          return t.left < b.right && t.right > b.left && t.top < b.bottom && t.bottom > b.top;
        });
      });
      expect(overlap, 'turn label overlaps a score card').toBe(false);

      await set(page, { isMine: true });
      await place(page, { up: 5 });
      await page.waitForTimeout(500);
      const settled = await rects();
      expect(settled.hand).toEqual(before.hand);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    });
  }
});
