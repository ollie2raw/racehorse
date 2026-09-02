import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('hasSeenWelcome', '1'));
});

test.describe('Smoke — Home', () => {
  test('home screen loads with key nav elements', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('RACEHORSE', { exact: false })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Single Player', { exact: false })).toBeVisible();
    await expect(page.getByText('Multiplayer', { exact: false })).toBeVisible();
  });
});

test.describe('Smoke — Single Player hub', () => {
  test('single player hub shows Play vs Fritz and Daily modes', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Single Player', { exact: false }).first().click();
    await expect(page.getByText('Play vs Fritz', { exact: false })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Ghost Mode', { exact: false })).toBeVisible();
  });
});

test.describe('Smoke — Daily Puzzle', () => {
  // The Daily Puzzle is Puzzle Rush (the 5-slot ladder was retired 2026-08-20).
  // Puzzle Rush has no URL route — it is reached from the Home card.
  test('daily puzzle (Puzzle Rush) hub loads from the Home card', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('region', { name: /Daily Puzzle/ })
      .getByRole('button', { name: /play|continue|view results/i })
      .click();
    // Show the Puzzle Rush hub shell or a loading state — not a blank screen.
    await expect(
      page.locator('.df-page, .df-shell, [data-ui="rush-start-button"], .loading-screen').first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Smoke — Play vs Fritz', () => {
  test('bot match screen loads without crash', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Single Player', { exact: false }).first().click();
    await page.getByText('Play vs Fritz', { exact: false }).first().click();
    await page.getByText('Start Match', { exact: false }).first().click();
    await expect(page.locator('.bot-match-screen, .screen-loader, .loading-screen, .game-screen')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Smoke — Tournament hub', () => {
  test('tournament screen loads', async ({ page }) => {
    await page.goto('/tournament');
    await expect(page.locator('.th-page, .th-shell, .screen, [data-ui="tournament"], .tournament-hub').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Tournament', { exact: false }).first()).toBeVisible();
  });
});
