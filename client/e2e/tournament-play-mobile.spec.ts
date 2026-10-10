/**
 * Tournament play screens on phones (Phase 3D): the match HUD's turn clock,
 * missed-turn warning, Fritz opponent and disconnect notice; the bracket's
 * Your Path, round tabs, Fritz chips and long names; the result screen's Fritz
 * champion and next-match call; the post-match overlay. Rendered through the
 * e2e-only harness (e2e/harness/tournament-play.html) with fixture data — no
 * server and no network beyond the dev server.
 *
 * Checks: no horizontal overflow, no text collisions, 44px+ targets, larger
 * text still usable, and the clock / warning / banner never cover the hand.
 */
import { expect, test, type Page } from '@playwright/test';

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '320x640', width: 320, height: 640 },
] as const;

const HARNESS = '/e2e/harness/tournament-play.html';

async function open(page: Page, query: string) {
  // Only the dev server: nothing reaches Supabase or any other host.
  await page.route((url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1', (route) => route.abort());
  await page.goto(`${HARNESS}?${query}`);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Boxes of `a` that intersect boxes of `b` (visible elements only). */
async function overlaps(page: Page, a: string, b: string): Promise<string[]> {
  return page.evaluate(([sa, sb]) => {
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; };
    const hits: string[] = [];
    for (const x of document.querySelectorAll(sa)) {
      const rx = vis(x); if (!rx) continue;
      for (const y of document.querySelectorAll(sb)) {
        const ry = vis(y); if (!ry) continue;
        if (rx.left < ry.right && rx.right > ry.left && rx.top < ry.bottom && rx.bottom > ry.top) hits.push(`${x.className} × ${y.className}`);
      }
    }
    return hits;
  }, [a, b] as const);
}

async function expectTargets44(page: Page, selector: string) {
  const small = await page.evaluate((sel) => [...document.querySelectorAll(sel)]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0 && r.height < 44)
    .map((r) => r.height), selector);
  expect(small).toEqual([]);
}

const LARGE_TEXT = 'html { font-size: 130% !important; }';

// Matches are landscape on phones (portrait shows "Rotate to Play"). These are
// the canonical size and the narrowest supported landscape phone
// (fixtures/mobile/visualHarness MOBILE_LANDSCAPE_VIEWPORTS).
const LANDSCAPE = [
  { name: '844x390', width: 844, height: 390 },
  { name: '667x375', width: 667, height: 375 },
] as const;

for (const viewport of LANDSCAPE) {
  test.describe(`tournament match HUD ${viewport.name} (landscape)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, isMobile: true, hasTouch: true });

    test('portrait asks to rotate (the HUD is a landscape surface)', async ({ page }) => {
      await page.setViewportSize({ width: viewport.height, height: viewport.width });
      await open(page, 'view=hud&opp=fritz&turn=me');
      await expect(page.getByText('Rotate to Play')).toBeVisible();
    });

    test('HUD: your turn, 2-miss warning, Fritz chip — clear of the hand', async ({ page }, info) => {
      await open(page, 'view=hud&opp=fritz&turn=me&missed=2');
      await expect(page.locator('.tmh-turn__text')).toBeVisible();
      await expect(page.locator('.tmh-turn__text')).toHaveText(/Your turn · \d+s/);
      await expect(page.locator('.tmh-warning')).toBeVisible();
      await expect(page.locator('.rotate-phone-overlay')).toBeHidden();
      await expect(page.locator('.tmh-warning')).toContainText('2 missed turns · one more will forfeit the match');
      await expect(page.locator('.tmh-fritz-chip')).toHaveText('Fritz');
      await expectNoHorizontalOverflow(page);
      expect(await overlaps(page, '.tmh-turn, .tmh-warning', '.hand-container')).toEqual([]);
      // Nor the HUD row, and it is fully on screen.
      expect(await overlaps(page, '.tmh-warning', '.wl-player-pill, .tmh-turn, .daily-fritz-progress-pill')).toEqual([]);
      const warn = await page.locator('.tmh-warning').boundingBox();
      expect(warn!.x).toBeGreaterThanOrEqual(0);
      expect(warn!.x + warn!.width).toBeLessThanOrEqual(viewport.width);
      // The turn pill stays one line.
      const turn = await page.locator('.tmh-turn').boundingBox();
      expect(turn!.height).toBeLessThan(48);
      await page.screenshot({ path: info.outputPath(`hud-your-turn-missed2-${viewport.name}.png`) });
    });

    test('HUD: Fritz turn is "thinking" (no deadline); human opponent turn is timed', async ({ page }, info) => {
      await open(page, 'view=hud&opp=fritz&turn=opp');
      await expect(page.locator('.tmh-turn__text')).toBeVisible();
      await expect(page.locator('.tmh-turn__text')).toHaveText('Elite Fritz is thinking');
      await expect(page.locator('.tmh-clock-bar')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`hud-fritz-thinking-${viewport.name}.png`) });
      await open(page, 'view=hud&opp=human&turn=opp');
      await expect(page.locator('.tmh-turn__text')).toHaveText(/Opponent's turn · \d+s/);
      await expectNoHorizontalOverflow(page);
    });

    test('HUD: tournament disconnect notice + in-game ready banner do not cover the hand', async ({ page }, info) => {
      await open(page, 'view=hud&opp=human&turn=me&disconnect=1&banner=1');
      await expect(page.getByText('Opponent disconnected. The match continues on the turn clock.')).toBeVisible();
      await expect(page.getByText('Your Quarterfinal is ready')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Join' })).toHaveCount(0);
      expect(await overlaps(page, '.trb', '.hand-container')).toEqual([]);
      expect(await overlaps(page, '.trb', '.tmh-turn, .wl-player-pill')).toEqual([]);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: info.outputPath(`hud-disconnect-banner-${viewport.name}.png`) });
    });

    test('HUD: next hand countdown', async ({ page }) => {
      await open(page, 'view=hud&opp=human&clock=next_hand');
      await expect(page.locator('.tmh-turn__text')).toBeVisible();
      await expect(page.locator('.tmh-turn__text')).toHaveText(/Next hand in \d+s/);
      await expect(page.locator('.tmh-warning')).toHaveCount(0);
    });

  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`tournament play ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('bracket: Your Path + Semifinal tab, Fritz chips, long names, 44px tabs', async ({ page }, info) => {
      await open(page, 'view=bracket&stage=sf');
      const path = page.getByLabel('Your path');
      await expect(path).toContainText('Your Semifinal is ready');
      await expect(path.getByRole('button', { name: 'Join Match' })).toBeVisible();
      await expect(page.getByRole('tab', { name: /Semifinals/ })).toHaveAttribute('aria-selected', 'true');
      await expectTargets44(page, '.tb-round-tab, .tb-path__cta');
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: info.outputPath(`bracket-sf-${viewport.name}.png`) });

      await page.getByRole('tab', { name: 'Quarterfinals' }).click();
      await expect(page.locator('.tb-col[data-round="1"]')).toBeVisible();
      await expect(page.locator('.tb-col[data-round="2"]')).toBeHidden();
      await expect(page.getByText('Alexandria-Konstantinopoulou-Featherstonehaugh').first()).toBeVisible();
      await expect(page.locator('.tb-col[data-round="1"] .tb-fritz-chip').first()).toBeVisible();
      await expect(page.locator('.tb-col[data-round="1"]')).toContainText('Forfeit');
      await expect(page.locator('.tb-col[data-round="1"]')).toContainText('Missed turns');
      expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/bot:|fritz:/);
      expect(await overlaps(page, '.tb-fritz-chip, .tb-won-chip', '.tb-slot__score')).toEqual([]);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: info.outputPath(`bracket-qf-${viewport.name}.png`) });
    });

    test('bracket: Final tab with a Fritz champion', async ({ page }, info) => {
      await open(page, 'view=bracket&stage=final');
      await page.getByRole('tab', { name: 'Final', exact: true }).click();
      await expect(page.locator('.tb-champion-name')).toContainText('Master Fritz');
      await expect(page.locator('.tb-champion-name .tb-fritz-chip')).toHaveText('Fritz');
      // A closed bracket's own banner sums it up; Your Path does not repeat it.
      await expect(page.getByLabel('Your path')).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: info.outputPath(`bracket-final-${viewport.name}.png`) });
    });

    test('bracket: larger text stays usable', async ({ page }, info) => {
      await open(page, 'view=bracket&stage=sf');
      await page.addStyleTag({ content: LARGE_TEXT });
      await expectNoHorizontalOverflow(page);
      await expectTargets44(page, '.tb-round-tab, .tb-path__cta');
      expect(await overlaps(page, '.tb-path__cta', '.tb-path__headline, .tb-path__sub')).toEqual([]);
      await page.screenshot({ path: info.outputPath(`bracket-large-text-${viewport.name}.png`) });
    });

    test('result: Fritz champion, played loss to Master Fritz, next-match call', async ({ page }, info) => {
      await open(page, 'view=result&next=1');
      await expect(page.getByText('Runner-Up')).toBeVisible();
      await expect(page.getByText('Lost to Master Fritz in the Final')).toBeVisible();
      await expect(page.locator('.tr-chip')).toHaveText('Fritz');
      await expect(page.getByRole('button', { name: 'Join Final' })).toBeVisible();
      await expectTargets44(page, '.tr-back');
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: info.outputPath(`result-fritz-champion-${viewport.name}.png`) });
    });

    test('post-match: played win, administrative advance, Join next round', async ({ page }, info) => {
      await open(page, 'view=overlay&outcome=played&next=1');
      await expect(page.getByText('You won')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Join Semifinal' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: info.outputPath(`overlay-win-next-${viewport.name}.png`) });
      await open(page, 'view=overlay&outcome=administrative');
      await expect(page.getByText('You advanced')).toBeVisible();
      await expect(page.getByText('You won')).toHaveCount(0);
      await page.addStyleTag({ content: LARGE_TEXT });
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: info.outputPath(`overlay-admin-large-text-${viewport.name}.png`) });
    });
  });
}
