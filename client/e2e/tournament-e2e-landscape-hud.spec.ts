/**
 * The tournament match HUD in the REAL app on landscape phones (Phase 3E,
 * TOURNAMENT_E2E mode) — the full app shell, routes and styles, not the 3D
 * harness. Checks the round pill vs the opponent's tile rack, both score
 * pills on screen, a one-line timer, the 2-miss warning clear of the hand and
 * the HUD row, and a long opponent name. Screenshots for review.
 */
import { expect, test, type Page } from '@playwright/test';
import { admin, backendState, signIn } from './tournament-backend/journey';

const VIEWPORTS = [
  { name: '844x390', width: 844, height: 390 },
  { name: '667x375', width: 667, height: 375 },
] as const;

type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };
async function box(page: Page, selector: string): Promise<Box | null> {
  return page.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  }, selector);
}
const overlap = (a: Box | null, b: Box | null) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);

async function measure(page: Page, viewport: { width: number; height: number }) {
  const pills = await page.evaluate(() => [...document.querySelectorAll('.wl-player-pill')].map((e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right }; }));
  const stage = await box(page, '.tmh .daily-fritz-progress-pill');
  const rack = await box(page, '.rh-tile-rack, [class*="tile-rack"]');
  const turn = await box(page, '.tmh-turn');
  const warning = await box(page, '.tmh-warning');
  const hand = await box(page, '.hand-container');
  return { pills, stage, rack, turn, warning, hand, viewport };
}

/** The native app (Capacitor) marks <html> with rh-native, which brings its compact landscape HUD. */
async function asNative(page: Page) {
  await page.addInitScript(() => {
    const mark = () => document.documentElement.classList.add('rh-native');
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mark);
    else mark();
  });
}

for (const shell of ['native app', 'mobile web'] as const)
for (const viewport of VIEWPORTS) {
  test.describe(`real-app tournament HUD, ${shell}, ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, isMobile: true, hasTouch: true });
    test.describe.configure({ timeout: 90_000 });
    test.beforeEach(async ({ page }) => { if (shell === 'native app') await asNative(page); });

    test('Fritz Cup: timer, 2-miss warning, round pill, rack, scores', async ({ page }, info) => {
      await admin('/__e2e/reset', { live: [] });
      await signIn(page);
      await page.goto('/tournament');
      await page.getByRole('article', { name: 'Fritz Cup' }).getByRole('button', { name: 'Play Fritz Cup' }).click();
      await expect(page.locator('.tmh-turn__text')).toHaveText(/Your turn · \d+s/, { timeout: 15_000 });
      // The server's count arrives with its next state; re-send until this
      // client's (possibly just-replaced) socket has it.
      await expect.poll(async () => {
        await admin('/__e2e/missed-turns', { count: 2 });
        return (await page.locator('.tmh-warning').textContent().catch(() => null)) ?? '';
      }, { timeout: 15_000 }).toContain('2 missed turns · one more will forfeit the match');
      await page.waitForTimeout(500);
      const m = await measure(page, viewport);
      await page.screenshot({ path: info.outputPath(`real-hud-fritz-${shell.replace(' ', '-')}-${viewport.name}.png`) });
      info.annotations.push({ type: 'layout', description: JSON.stringify(m) });

      // Both score pills fully on screen.
      for (const p of m.pills) {
        expect(p.left).toBeGreaterThanOrEqual(0);
        expect(p.right).toBeLessThanOrEqual(viewport.width);
      }
      // One-line timer; the warning clear of the hand and of the HUD row.
      expect(m.turn!.height).toBeLessThan(48);
      expect(overlap(m.warning, m.hand)).toBe(false);
      expect(overlap(m.warning, m.turn)).toBe(false);
      expect(overlap(m.warning, m.stage)).toBe(false);
      expect(m.warning!.left).toBeGreaterThanOrEqual(0);
      expect(m.warning!.right).toBeLessThanOrEqual(viewport.width);
      // The round pill and the timer clear of the opponent's tile rack.
      expect(overlap(m.stage, m.rack)).toBe(false);
      expect(overlap(m.turn, m.rack)).toBe(false);
    });

    test('Live Event: a long human opponent name and the timer', async ({ page }, info) => {
      await admin('/__e2e/reset', { live: [{ id: 'live-h', startsInMin: 60, registeredCount: 4, registered: true }] });
      await admin('/__e2e/rival-name', { name: 'Alexandria-Konstantinopoulou-Featherstonehaugh' });
      await signIn(page);
      await page.goto('/tournament');
      await expect(page.getByRole('article', { name: /^Live Event/ })).toContainText('Registered');
      await admin('/__e2e/live/live-h/start', { opponent: 'human' });
      await page.getByRole('article', { name: /^Live Event/ }).getByRole('button', { name: 'Join Match' }).click();
      await expect(page.locator('.tmh-turn__text')).toHaveText(/Your turn · \d+s/, { timeout: 15_000 });
      await page.waitForTimeout(500);
      const m = await measure(page, viewport);
      await page.screenshot({ path: info.outputPath(`real-hud-long-name-${shell.replace(' ', '-')}-${viewport.name}.png`) });
      info.annotations.push({ type: 'layout', description: JSON.stringify(m) });
      for (const p of m.pills) {
        expect(p.left).toBeGreaterThanOrEqual(0);
        expect(p.right).toBeLessThanOrEqual(viewport.width);
      }
      expect(overlap(m.turn, m.rack)).toBe(false);
      expect(overlap(m.stage, m.rack)).toBe(false);
      expect((await backendState()).counters.attach).toBe(1);
    });
  });
}
