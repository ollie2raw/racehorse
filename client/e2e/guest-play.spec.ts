/**
 * Guest play, the client half, in the real app (docs/guest-play-design.md; roadmap 1.14 G1c).
 *
 * The e2e dev server runs with VITE_ENABLE_GUEST_PLAY on (it is off in every shipped build), and the dev auth shim can stand in
 * as Supabase's anonymous user. These cover what a guest sees: the name in the nav, the menu, the sign-up dialog, the two-tap
 * leave, and no "choose your handle" prompt even though a guest's handle is a placeholder.
 */
import { expect, test, type Page } from '@playwright/test';

const GUEST_ID = '00000000-0000-4000-8000-00000000e2e6';
const PLACEHOLDER_HANDLE = 'user_ab12cd34';

async function seedSession(page: Page, { guest }: { guest: boolean }) {
  await page.addInitScript(
    ({ guest, id, handle }) => {
      window.localStorage.setItem('hasSeenWelcome', '1');
      window.localStorage.setItem('racehorse_e2e_user_id', id);
      window.localStorage.setItem('racehorse_e2e_bearer', 'e2e-daily-fritz');
      // localStorage is shared by every page of a context, so a permanent account must clear the marker explicitly
      if (guest) window.localStorage.setItem('racehorse_e2e_guest', '1');
      else window.localStorage.removeItem('racehorse_e2e_guest');
      // A placeholder handle, as the database trigger gives every new user until they pick one.
      window.localStorage.setItem(
        'racehorse_mobile_visual_identity_v1',
        JSON.stringify({ userId: id, username: handle, rating: 800, friends: [] }),
      );
    },
    { guest, id: GUEST_ID, handle: PLACEHOLDER_HANDLE },
  );
  // Nothing here needs a real server: every API call answers empty.
  await page.route((url) => url.pathname.startsWith('/api/'), (route) =>
    route.fulfill({ json: { ok: true, feed: [], friends: [], leaderboard: [], self: null, rivals: [], tournaments: [] } }));
}

const trigger = (page: Page) => page.getByRole('button', { name: 'Account menu' });

test.describe('a guest, on a phone in portrait', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('is called Guest, never by their placeholder handle', async ({ page }) => {
    await seedSession(page, { guest: true });
    await page.goto('/');
    await expect(trigger(page)).toContainText('Guest', { timeout: 20_000 });
    await expect(trigger(page)).not.toContainText(PLACEHOLDER_HANDLE);
  });

  test('is not asked to choose a handle, while a signed-in account with the same placeholder is', async ({ page }) => {
    await seedSession(page, { guest: true });
    await page.goto('/');
    await expect(trigger(page)).toContainText('Guest', { timeout: 20_000 });
    await page.waitForTimeout(1500);
    await expect(page.getByRole('dialog', { name: 'Choose your handle' })).toHaveCount(0);

    // the control: the very same placeholder handle on a permanent account does get the prompt
    const account = await page.context().newPage();
    await seedSession(account, { guest: false });
    await account.goto('/');
    await expect(account.getByRole('dialog', { name: 'Choose your handle' })).toBeVisible({ timeout: 20_000 });
  });
});

for (const vp of [
  { name: 'phone portrait', width: 390, height: 844, native: false },
  { name: 'native landscape', width: 844, height: 390, native: true },
]) {
  test.describe(`the guest account menu, ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: true });

    test.beforeEach(async ({ page }) => {
      if (vp.native) await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('rh-native')); });
      await seedSession(page, { guest: true });
      await page.goto('/');
      await expect(trigger(page)).toContainText('Guest', { timeout: 20_000 });
      await page.waitForTimeout(500);
      await trigger(page).click();
    });

    test('offers making an account first and leaving last, and fits on screen', async ({ page }) => {
      const items = await page.getByRole('menuitem').allTextContents();
      expect(items).toEqual(['Create account', 'My games', 'Settings', 'Privacy', 'Terms', 'Support', 'Leave guest session']);

      const menu = await page.getByRole('menu', { name: 'Account' }).boundingBox();
      expect(menu).not.toBeNull();
      expect(menu!.x).toBeGreaterThanOrEqual(0);
      expect(menu!.x + menu!.width).toBeLessThanOrEqual(vp.width);
      await page.screenshot({ path: `test-results/guest-menu-${vp.native ? 'native' : 'phone'}.png` });
    });

    test('Create account opens the sign-up dialog, and Sign in explains that it replaces the guest session', async ({ page }) => {
      await page.getByRole('menuitem', { name: 'Create account' }).click();
      const dialog = page.getByRole('dialog', { name: 'Create account' });
      await expect(dialog).toBeVisible();
      // The native landscape layout hides the subtitle on purpose (it would push the inputs under the keyboard), so the
      // guest sentences are only asserted where they render. That means an iPhone guest never sees them (roadmap note).
      const keeps = dialog.getByText('Create a free account and keep the games you have played.');
      const replaces = page.getByText('Signing in replaces your guest session. Games you played as a guest stay with it.');
      if (vp.native) await expect(keeps).toBeHidden();
      else await expect(keeps).toBeVisible();
      await page.screenshot({ path: `test-results/guest-signup-${vp.native ? 'native' : 'phone'}.png` });

      await dialog.getByRole('button', { name: /Already have an account/ }).click();
      await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeVisible();
      if (vp.native) await expect(replaces).toBeHidden();
      else await expect(replaces).toBeVisible();
    });

    test('leaving asks first, and the question starts over when the menu is reopened', async ({ page }) => {
      await page.getByRole('menuitem', { name: 'Leave guest session' }).click();
      const confirm = page.getByRole('menuitem', { name: 'Leave and lose these games?' });
      await expect(confirm).toBeVisible();
      await expect(page.getByRole('menu', { name: 'Account' })).toBeVisible();

      await trigger(page).click(); // close
      await trigger(page).click(); // reopen
      await expect(page.getByRole('menuitem', { name: 'Leave guest session' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Leave and lose these games?' })).toHaveCount(0);
    });
  });
}
