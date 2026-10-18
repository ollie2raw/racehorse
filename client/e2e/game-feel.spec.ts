import { expect, test } from '@playwright/test';

const fixture = '/e2e/harness/game-feel.html';

test('incremental placement, scoring, draws and hand-end keep presentation responsive', async ({ page }) => {
  await page.goto(fixture);
  const board = page.getByRole('region', { name: 'Domino board', exact: true });
  await expect(board.locator('[data-placement-feedback=arrive]')).toHaveCount(0);
  const turn = page.locator('.rh-turn-status');
  await expect(turn).toHaveText('Your move');
  await page.getByRole('button', { name: 'Fritz thinking', exact: true }).click();
  await expect(turn).toHaveText('Opponent thinking');
  await page.getByRole('button', { name: 'Selected', exact: true }).click();
  await expect(page.locator('.hand-container .domino-tile.selected')).toHaveCount(1);
  await expect(page.locator('.hand-container .domino-tile.selected')).toHaveAttribute('aria-pressed', 'true');
  const neighbour = page.getByRole('button', { name: /Domino 1-6/ });
  await neighbour.evaluate(el => el.setAttribute('data-preserved-neighbour', 'yes'));
  await page.getByRole('button', { name: 'Placement', exact: true }).click();
  await expect(board.locator('[data-placement-feedback=arrive]')).toHaveCount(1);
  await expect(board.locator('.board-tile-wrapper')).toHaveCount(2);
  await expect(neighbour).toHaveAttribute('data-preserved-neighbour', 'yes');
  // Camera-position wrapper must never own the local landing animation.
  expect(await board.locator('[data-placement-feedback=arrive]').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.getByRole('button', { name: 'Score', exact: true }).click();
  await expect(page.getByRole('status', { name: 'You scored +2' })).toBeVisible();
  await expect(page.locator('.is-you .rh-score-value')).toHaveAccessibleName('17');
  await expect(page.locator('.is-you .rh-score-value')).toHaveText('17');
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await expect(page.locator('.hand-container .new-draw')).toHaveCount(1);
  await expect(page.locator('.boneyard-count')).toHaveText('9');
  await expect(page.locator('.rh-tile-rack')).toHaveAccessibleName('6 tiles in hand');
  await expect(page.locator('.rh-tile-rack .domino-tile')).toHaveCount(0);
  await page.getByRole('button', { name: 'Recovery', exact: true }).click();
  await expect(board.locator('[data-placement-feedback=arrive]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Placement', exact: true }).click();
  await expect(board.locator('[data-placement-feedback=arrive]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Hand end', exact: true }).click();
  await expect(page.getByTestId('hand-over-modal')).toContainText('You emptied your hand and collected 2 points.');
});

test('reduced motion has exact scores, no landing or handoff movement, and visible keyboard focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Selected', exact: true }).click();
  const tile = page.getByRole('button', { name: /Domino 0-6/ }).first();
  await page.keyboard.press('Tab');
  await tile.focus();
  await expect(tile).toBeFocused();
  expect(await tile.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  await page.getByRole('button', { name: 'Placement', exact: true }).click();
  await expect(page.locator('[data-placement-feedback=arrive]')).toHaveCount(0);
  expect(await page.locator('.rh-turn-status__content').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.getByRole('button', { name: 'Score', exact: true }).click();
  await expect(page.locator('.is-you .rh-score-value')).toHaveText('17');
  expect(await page.locator('.is-you.score-hit').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  expect(await page.locator('.is-you .rh-score-value__digits').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  expect(await page.locator('.new-draw').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
});
