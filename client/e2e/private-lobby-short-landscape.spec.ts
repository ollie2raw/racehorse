import { expect, test, type Locator, type Page } from '@playwright/test';
import { makeRunIdentity, seedPlayerIdentity, waitForMultiplayerSocketConnected } from './helpers/multiplayerMatch';

/**
 * Private lobby on short landscape phones. The footer used to stack a 44px button over a 28px "Leave Room" row, which the
 * viewport-locked panel clipped (Leave Room was cut off, the room code sat under the bottom nav). These checks measure boxes and
 * hit-testing, not pixels, so they hold in Chromium (CI) and WebKit (local only, see playwright.config.ts: CI installs Chromium).
 */
const SIZES = [
  { w: 844, h: 390 }, // iPhone 14 / 15
  { w: 932, h: 430 }, // iPhone 14 / 15 Pro Max
  { w: 667, h: 375 }, // iPhone SE / 8
  { w: 568, h: 320 }, // iPhone 5 / SE 1st gen
];

/** Whole control inside the viewport, at least 44 x 44, and not under another element at its centre and four inner points. */
async function expectFullyReachable(page: Page, control: Locator, label: string) {
  const box = await control.boundingBox();
  expect(box, `${label} has a box`).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(44);
  expect(box!.width, `${label} width`).toBeGreaterThanOrEqual(44);
  expect(box!.y, `${label} top edge on screen`).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, `${label} bottom edge on screen`).toBeLessThanOrEqual(viewport.height);
  expect(box!.x, `${label} left edge on screen`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${label} right edge on screen`).toBeLessThanOrEqual(viewport.width);
  const covered = await control.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return [[0.5, 0.5], [0.1, 0.2], [0.9, 0.2], [0.1, 0.8], [0.9, 0.8]].filter(([fx, fy]) => {
      const hit = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
      // A disabled button takes no pointer events, so the hit lands on whatever holds it: accept its own parent, never a sibling overlay.
      const owner = (el as HTMLButtonElement).disabled ? el.parentElement! : el;
      return !(hit && owner.contains(hit));
    }).length;
  });
  expect(covered, `${label}: points of it that another element covers`).toBe(0);
}

async function openPrivateCreateTab(page: Page) {
  await page.goto('/multiplayer');
  await waitForMultiplayerSocketConnected(page);
  const privateTab = page.getByRole('tab', { name: /Private/i });
  if (await privateTab.count()) await privateTab.first().tap();
  else await page.getByRole('button', { name: /^Private$/i }).first().tap();
  const createTab = page.getByRole('tab', { name: /Create lobby/i });
  if (await createTab.count()) await createTab.first().tap();
}

for (const { w, h } of SIZES) {
  test.describe(`private lobby at ${w}x${h}`, () => {
    test.use({ viewport: { width: w, height: h }, hasTouch: true });
    // Room creation is a live socket round trip; the retry window below (45 s) must fit inside the test's own limit.
    test.setTimeout(90_000);

    test('Waiting for opponent and Leave Room are fully visible and tappable', async ({ page, context }) => {
      await seedPlayerIdentity(context, makeRunIdentity('a', `lobby${w}x${h}${Date.now()}`));
      await openPrivateCreateTab(page);

      // Before a room exists the hub shows its hero above the form, so Create lobby sits below the fold at these heights and
      // is reached by scrolling (tap scrolls it into view). That layout is not part of this fix; the room screen below is.
      const create = page.getByRole('button', { name: /^Create lobby/i }).first();
      await expect(create).toBeVisible({ timeout: 20_000 });
      const waiting = page.getByRole('button', { name: /Waiting for opponent/i });
      // Setup, not the assertion: locally about 1 run in 20 loses the first Create lobby tap right after the socket connects
      // (cause not found; the button stays enabled and no room is made). Tap again only while the button is still there.
      await expect(async () => {
        if (await create.isVisible()) await create.tap();
        await expect(waiting).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 45_000 });
      const leave = page.getByRole('button', { name: /Leave Room/i });
      await expect(leave).toBeVisible();
      await expectFullyReachable(page, waiting, 'Waiting for opponent');
      await expectFullyReachable(page, leave, 'Leave Room');

      // Tappable, not just on screen: leaving the room returns to the Create lobby form.
      await leave.tap();
      await expect(page.getByRole('button', { name: /^Create lobby/i }).first()).toBeVisible({ timeout: 20_000 });
    });
  });
}
