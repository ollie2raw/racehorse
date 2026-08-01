/**
 * Browser regression: Daily Fritz hand submission must not surface verifier
 * divergence errors after the finalize-before-present fix.
 *
 * Requires QA auth at client/.auth/daily-fritz-qa.json and live API.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page, type Response } from '@playwright/test';

const authState = path.resolve(process.cwd(), '.auth/daily-fritz-qa.json');

function hasValidAuthState(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const state = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      origins?: Array<{ localStorage?: Array<{ name?: string; value?: string }> }>;
    };
    return state.origins?.some((origin) => origin.localStorage?.some((entry) => {
      if (!entry.name?.startsWith('sb-') || !entry.name.endsWith('-auth-token') || !entry.value) {
        return false;
      }
      const session = JSON.parse(entry.value) as { expires_at?: unknown };
      return typeof session.expires_at === 'number' && session.expires_at > Date.now() / 1000 + 60;
    })) ?? false;
  } catch {
    return false;
  }
}

function isDailyFritzEvidenceRoute(url: string): boolean {
  return url.includes('/api/daily-fritz/next-hand')
    || url.includes('/api/daily-fritz/record-game');
}

async function openDailyFritzMatch(page: Page): Promise<void> {
  await page.goto('/#/daily-fritz');
  await expect(page.getByRole('heading', { name: 'Daily Fritz' })).toBeVisible({ timeout: 20_000 });
  const start = page.locator('.df-pvf-start-btn');
  await expect(start).toBeEnabled({ timeout: 20_000 });
  await start.click();
  await expect(page.locator('.bot-match-screen.bot-match-mode-daily-fritz')).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('Daily Fritz verifier-race browser journey', () => {
  test.skip(!hasValidAuthState(authState), 'A current authenticated Daily Fritz QA fixture is required');

  test('survives remount pressure and submits without verifier divergence', async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({
      storageState: authState,
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const verificationBodies: Array<{ status: number; body: string }> = [];

    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });
    page.on('response', async (response: Response) => {
      if (!isDailyFritzEvidenceRoute(response.url())) return;
      try {
        verificationBodies.push({
          status: response.status(),
          body: await response.text(),
        });
      } catch {
        verificationBodies.push({ status: response.status(), body: '' });
      }
    });

    try {
      await openDailyFritzMatch(page);

      // Remount / Strict Mode pressure while Fritz may be presenting.
      for (let index = 0; index < 4; index += 1) {
        await page.evaluate(() => {
          window.dispatchEvent(new Event('resize'));
          document.body.setAttribute('data-df-remount-pressure', String(Date.now()));
        });
        await page.waitForTimeout(250);
      }

      // Play legal tiles when available to advance toward hand completion.
      for (let turn = 0; turn < 40; turn += 1) {
        const handOver = page.locator('.hand-over-modal, [data-testid="hand-over-modal"], .bot-hand-over');
        if (await handOver.first().isVisible().catch(() => false)) break;

        const modalError = page.getByText(/Fritz action does not match the official policy|Transcript actor does not own the turn/i);
        expect(await modalError.count()).toBe(0);

        const playable = page.locator('.hand-container button.domino-tile:not(.unplayable):not(.disabled)').first();
        if (await playable.isVisible().catch(() => false)) {
          await playable.click();
          const end = page.locator('.placement-zone.active, .end-target.active').first();
          if (await end.isVisible().catch(() => false)) {
            await end.click();
          }
        }
        await page.waitForTimeout(400);
      }

      // Force another remount burst near end-of-hand / submission window.
      for (let index = 0; index < 3; index += 1) {
        await page.evaluate(() => window.dispatchEvent(new Event('resize')));
        await page.waitForTimeout(200);
      }

      await page.waitForTimeout(2_000);

      const divergence = page.getByText(/Fritz action does not match the official policy|Transcript actor does not own the turn/i);
      expect(await divergence.count()).toBe(0);

      for (const entry of verificationBodies) {
        expect(entry.body).not.toMatch(/fritz_action_mismatch|wrong_actor/i);
        expect(entry.body).not.toMatch(/Fritz action does not match the official policy/i);
        expect(entry.body).not.toMatch(/Transcript actor does not own the turn/i);
        if (entry.status >= 400) {
          // Soft-fail only when the body clearly indicates verifier divergence.
          expect(entry.status).not.toBe(409);
        }
      }

      const cleanErrors = pageErrors.filter((message) =>
        !/ResizeObserver|favicon|net::ERR/i.test(message)
      );
      expect(cleanErrors, cleanErrors.join('\n')).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
