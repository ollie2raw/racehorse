/**
 * Tournament Hub on phones (Phase 3C): the Fritz Cup card and the primary
 * Live Event fit without horizontal overflow, the second Live Event stays
 * reachable, controls are at least 44px tall, larger text does not make
 * controls overlap their status text, and the loading state is not blank.
 *
 * Runs only when live tournaments are built in (VITE_ENABLE_TOURNAMENTS=true),
 * like the other tournament-on checks. API responses are the mobile fixtures
 * (tournament/open, tournament/registered); the e2e sign-in bypass can fall
 * back to signed-out, so assertions hold either way.
 */
import { expect, test, type Page } from '@playwright/test';
import { installMobileFixture } from './fixtures/mobile/loader';

test.skip(process.env.VITE_ENABLE_TOURNAMENTS !== 'true', 'live tournaments are switched off in this build');

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '320x640', width: 320, height: 640 },
] as const;

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function expectControlsUsable(page: Page) {
  const buttons = page.locator('.th-event button');
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const box = await buttons.nth(i).boundingBox();
    expect(box, 'button is rendered').not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  // No control overlaps the status text on its card.
  const overlaps = await page.evaluate(() => {
    const hits: string[] = [];
    for (const card of document.querySelectorAll('.th-event')) {
      const status = card.querySelector('.th-event__status')?.getBoundingClientRect();
      if (!status) continue;
      for (const button of card.querySelectorAll('button')) {
        const b = button.getBoundingClientRect();
        const intersects = b.left < status.right && b.right > status.left && b.top < status.bottom && b.bottom > status.top;
        if (intersects) hits.push(`${card.getAttribute('aria-label')}: ${button.textContent}`);
      }
    }
    return hits;
  });
  expect(overlaps).toEqual([]);
}

for (const viewport of VIEWPORTS) {
  test.describe(`tournament hub ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('Fritz Cup + primary Live Event fit; the second Live Event is reachable', async ({ page }, info) => {
      const setup = await installMobileFixture(page, 'tournament/open');
      await page.goto(setup.fixture.route);
      for (const text of setup.fixture.expected.visibleText) await expect(page.getByText(text).first()).toBeVisible();
      for (const text of setup.fixture.expected.absentText ?? []) await expect(page.getByText(text)).toHaveCount(0);
      await expect(page.getByRole('article', { name: 'Fritz Cup' })).toBeVisible();
      const live = page.getByRole('article', { name: /^Live Event/ });
      await expect(live).toHaveCount(2);
      await live.nth(1).scrollIntoViewIfNeeded();
      await expect(live.nth(1)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectControlsUsable(page);
      await page.screenshot({ path: info.outputPath(`hub-open-${viewport.name}.png`), fullPage: false });
      setup.assertNoUnexpectedApiCalls();
    });

    test('larger text: controls stay usable and nothing overflows', async ({ page }, info) => {
      const setup = await installMobileFixture(page, 'tournament/registered');
      await page.goto(setup.fixture.route);
      await page.addStyleTag({ content: 'html { font-size: 130% !important; } .th-event__status, .th-event__when, .th-event .th-cta { font-size: 1.3em !important; }' });
      await expect(page.getByRole('article', { name: /^Live Event/ }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectControlsUsable(page);
      await page.screenshot({ path: info.outputPath(`hub-registered-large-text-${viewport.name}.png`), fullPage: false });
    });

    test('loading: placeholders, not a blank screen', async ({ page }, info) => {
      const setup = await installMobileFixture(page, 'tournament/open');
      // Hold the hub's data so the loading state is visible.
      await page.route((url) => url.pathname.startsWith('/api/tournaments/'), async () => { /* never answered */ });
      await page.goto(setup.fixture.route);
      await expect(page.locator('.th-event--skeleton')).toHaveCount(2);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: info.outputPath(`hub-loading-${viewport.name}.png`), fullPage: false });
    });
  });
}
