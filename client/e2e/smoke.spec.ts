import { test, expect } from '@playwright/test';

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
  test('daily puzzle screen loads board', async ({ page }) => {
    await page.goto('/daily');
    // Should show puzzle UI or a loading state — not a blank screen or error
    await expect(page.locator('.df-page, .df-shell, .screen, [data-ui], .daily-puzzle-screen, .loading-screen').first()).toBeVisible({ timeout: 15_000 });
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
