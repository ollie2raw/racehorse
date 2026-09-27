import { expect, test } from '@playwright/test';
import { installMobileFixture } from './fixtures/mobile/loader';

const tabOrder = ['Multi', 'Solo', 'Tourny', 'Social', 'Learn'];
const visibleTabs = (page: import('@playwright/test').Page) => page.locator('.rh-bottom-tab-bar:visible .rh-bottom-tab');

for (const [route, area] of [
  ['/',''], ['/multiplayer','Multi'], ['/solo','Solo'], ['/tournament','Tourny'],
  ['/social','Social'], ['/learn','Learn'],
] as const) {
  test(`phone Hub chrome ${route}`, async ({ page }) => {
    if (route === '/') await installMobileFixture(page, 'home/not-played');
    if (route === '/solo') await installMobileFixture(page, 'solo/populated');
    await page.goto(route);
    await expect(page.locator('[data-surface-shell="hub"]')).toBeVisible();
    await expect(visibleTabs(page)).toHaveCount(5);
    expect(await visibleTabs(page).allTextContents()).toEqual(tabOrder);
    const selected = page.locator('.rh-bottom-tab-bar [aria-current="page"]');
    if (area) await expect(selected).toHaveText(area);
    else await expect(selected).toHaveCount(0);
    await expect(page.locator('.rh-global-nav')).toHaveCount(1);
    await expect(page.locator('.rh-nav-center-desktop')).toBeHidden();
  });
}

test('focused content has contextual chrome and no primary phone bar', async ({ page }) => {
  await page.goto('/daily-fritz');
  await expect(page.locator('[data-surface-shell="focused"]')).toBeVisible();
  await expect(page.locator('.rh-bottom-tab-bar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
});

test('focused signed-in chrome keeps account access but omits hub stats', async ({ page }) => {
  await installMobileFixture(page, 'solo/populated');
  await page.goto('/solo/fritz');
  await expect(page.locator('[data-surface-shell="focused"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
  await expect(page.locator('.rh-nav-rating')).toBeHidden();
  await expect(page.locator('.rh-nav-friends')).toBeHidden();
});

test('identity collapses Friends before Rating while account remains operable', async ({ page }) => {
  await installMobileFixture(page, 'home/not-played');
  await page.goto('/');
  const friends = page.locator('.rh-nav-friends');
  const rating = page.locator('.rh-nav-rating');
  const account = page.getByRole('button', { name: 'Account menu' });
  await expect(friends).toBeVisible();
  await expect(rating).toBeVisible();
  await expect(account).toBeVisible();
  await page.setViewportSize({ width: 740, height: 360 });
  await expect(friends).toBeHidden();
  await expect(rating).toBeVisible();
  await expect(account).toBeVisible();
  await page.setViewportSize({ width: 667, height: 375 });
  await expect(friends).toBeHidden();
  await expect(rating).toBeHidden();
  await expect(account).toBeVisible();
  await account.focus();
  await page.keyboard.press('Enter');
  await expect(account).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(account).toHaveAttribute('aria-expanded', 'false');
  await expect(account).toBeFocused();
});

test('compact and wide classification uses both viewport dimensions', async ({ page }) => {
  await installMobileFixture(page, 'home/not-played');
  await page.goto('/');
  for (const [width, height, wide] of [
    [667,375,false], [740,360,false], [844,390,false], [852,393,false],
    [915,412,false], [932,430,false], [390,844,false], [1000,500,false],
    [1280,720,true], [1440,900,true],
  ] as const) {
    await page.setViewportSize({ width, height });
    if (wide) {
      await expect(page.locator('.rh-bottom-tab-bar')).toBeHidden();
      await expect(page.locator('.rh-nav-center-desktop')).toBeVisible();
    } else {
      await expect(page.locator('.rh-bottom-tab-bar')).toBeVisible();
      await expect(page.locator('.rh-nav-center-desktop')).toBeHidden();
    }
  }
});

test('safe area is consumed once by header, content, and bottom tabs', async ({ page }) => {
  await installMobileFixture(page, 'home/not-played');
  await page.goto('/');
  await expect(page.locator('.rh-presentation')).toBeVisible();
  await page.addStyleTag({ content: '.app.rh-presentation { --rh-safe-top: 11px; --rh-safe-right: 13px; --rh-safe-bottom: 17px; --rh-safe-left: 19px; }' });
  const geometry = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    const header = box('.rh-global-nav');
    const content = box('.rh-presentation-content');
    const tabs = box('.rh-bottom-tab-bar');
    return { headerHeight: header.height, contentLeft: content.left, contentPaddingLeft: parseFloat(getComputedStyle(document.querySelector('.rh-presentation-content')!).paddingLeft), tabsBottom: tabs.bottom, tabsPaddingBottom: parseFloat(getComputedStyle(document.querySelector('.rh-bottom-tab-bar')!).paddingBottom) };
  });
  expect(geometry.headerHeight).toBe(67);
  expect(geometry.contentLeft).toBe(0);
  expect(geometry.contentPaddingLeft).toBe(19);
  expect(geometry.tabsBottom).toBe(390);
  expect(geometry.tabsPaddingBottom).toBe(17);
});

test('focused and gameplay shells allocate inset space without a second nav layer', async ({ page }) => {
  await page.goto('/solo/fritz');
  await expect(page.locator('[data-surface-shell="focused"]')).toBeVisible();
  await page.addStyleTag({ content: '.app.rh-presentation { --rh-safe-top: 11px; --rh-safe-right: 13px; --rh-safe-bottom: 17px; --rh-safe-left: 19px; }' });
  const content = page.locator('.rh-presentation-content');
  await expect(content).toHaveCSS('padding-bottom', '17px');
  await expect(content).toHaveCSS('padding-left', '19px');
  await page.getByText('Start Match', { exact: false }).first().click();
  await expect(page.locator('[data-surface-shell="gameplay"]')).toBeVisible();
  await expect(content).toHaveCSS('padding-top', '11px');
  await expect(content).toHaveCSS('padding-right', '13px');
  await expect(content).toHaveCSS('padding-bottom', '17px');
  await expect(page.locator('.rh-global-nav, .rh-bottom-tab-bar')).toHaveCount(0);
});

test('active bot match removes all global chrome without reloading the route', async ({ page }) => {
  await page.goto('/solo/fritz');
  await expect(page.locator('[data-surface-shell="focused"]')).toBeVisible();
  await page.getByText('Start Match', { exact: false }).first().click();
  await expect(page.locator('[data-surface-shell="gameplay"]')).toBeVisible();
  await expect(page.locator('.rh-global-nav, .rh-bottom-tab-bar')).toHaveCount(0);
});

test('wide desktop keeps the horizontal selected area and hides bottom tabs', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMobileFixture(page, 'solo/populated');
  await page.goto('/solo');
  await expect(page.locator('.rh-nav-center-desktop')).toBeVisible();
  await expect(page.locator('.rh-nav-center-desktop [aria-current="page"]')).toHaveText('Single Player');
  await expect(page.locator('.rh-bottom-tab-bar')).toBeHidden();
  await expect(page.locator('.rh-nav-center-desktop [aria-current="page"]')).toHaveCSS('color', 'rgb(231, 182, 74)');
});

test('signed-out Hub renders account access without empty stats', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-surface-shell="hub"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.locator('.rh-nav-stat-value')).toHaveCount(0);
});
