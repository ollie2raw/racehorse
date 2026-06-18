/**
 * Production QA: recovery banner on home vs mid-match offline reconnect.
 * Usage: node client/scripts/reconnectProductionQa.mjs
 */
import { chromium } from 'playwright';

const BASE_URL = process.env.QA_BASE_URL || 'https://racehorsedoms.vercel.app';
const OFFLINE_MS = Number(process.env.QA_OFFLINE_MS || 10_000);

const RECOVERY_BANNER_RE = /Reconnecting…|Syncing room…|Reconnect failed|Syncing game state/i;

async function dismissWelcome(page) {
  const close = page.getByRole('button', { name: /close|got it|continue|dismiss/i });
  if (await close.count()) {
    try {
      await close.first().click({ timeout: 2000 });
    } catch {
      // no-op
    }
  }
}

async function openMultiplayerPrivate(page) {
  const navMultiplayer = page.getByRole('button', { name: 'Multiplayer', exact: true });
  if (await navMultiplayer.count()) {
    await navMultiplayer.click();
  }
  await page.getByRole('tab', { name: 'Private', exact: true }).click();
  await page.getByRole('heading', { name: /Private Match/i }).waitFor({ timeout: 45_000 });

  const connectBtn = page.getByRole('button', { name: /Connect to Server/i });
  if (await connectBtn.count()) {
    await connectBtn.click();
    await page.getByRole('button', { name: /^Create lobby/i }).waitFor({ timeout: 90_000 });
  }
}

async function hasRecoveryBanner(page) {
  return page.locator('body').evaluate((body, reSource) => {
    const re = new RegExp(reSource, 'i');
    const text = body.innerText || '';
    if (!re.test(text)) return false;
    const candidates = Array.from(body.querySelectorAll('*')).filter((el) => {
      const t = (el.textContent || '').trim();
      return t.length > 0 && t.length < 80 && re.test(t);
    });
    return candidates.some((el) => {
      const style = window.getComputedStyle(el);
      const pos = style.position;
      return pos === 'fixed' || pos === 'sticky' || el.closest('[class*="recovery"]');
    }) || re.test(text);
  }, RECOVERY_BANNER_RE.source);
}

async function waitForBanner(page, visible, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const on = await hasRecoveryBanner(page);
    if (on === visible) return on;
    await page.waitForTimeout(500);
  }
  return hasRecoveryBanner(page);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = { baseUrl: BASE_URL, offlineMs: OFFLINE_MS, steps: [] };

  try {
    const homeCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    await homeCtx.addInitScript(() => {
      localStorage.setItem('hasSeenWelcome', '1');
    });
    const homePage = await homeCtx.newPage();
    await homePage.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await homePage.waitForTimeout(2500);
    await dismissWelcome(homePage);

    const homeBanner = await hasRecoveryBanner(homePage);
    results.steps.push({
      name: 'home_clean_navigation',
      pass: !homeBanner,
      detail: homeBanner ? 'Recovery banner visible on home' : 'No recovery banner on home',
    });

    await homePage.getByRole('button', { name: 'Single Player', exact: true }).click();
    await homePage.waitForTimeout(1500);
    const spBanner = await hasRecoveryBanner(homePage);
    results.steps.push({
      name: 'single_player_hub_clean',
      pass: !spBanner,
      detail: spBanner ? 'Recovery banner on Single Player hub' : 'No recovery banner on Single Player hub',
    });

    await homePage.locator('nav').getByText('RACEHORSE', { exact: true }).click();
    await homePage.waitForTimeout(1000);
    await homeCtx.close();

    const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const guestCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    for (const ctx of [hostCtx, guestCtx]) {
      await ctx.addInitScript(() => {
        localStorage.setItem('hasSeenWelcome', '1');
        const id = `qa-guest-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem('racehorse_guest_identity_v1', JSON.stringify({ userId: id, username: `QA${id.slice(-4)}` }));
      });
    }

    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    await host.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await guest.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await host.waitForTimeout(2000);
    await guest.waitForTimeout(2000);

    await openMultiplayerPrivate(host);
    await host.getByRole('button', { name: 'Create lobby', exact: true }).last().click();
    await host.getByText('Your room code', { exact: false }).waitFor({ timeout: 45_000 });
    const roomCode = await host.locator('.pml-roomcode-bar-code').first().textContent();
    if (!roomCode?.trim()) throw new Error('Could not read room code');
    const code = roomCode.trim().toUpperCase();
    results.roomCode = code;

    await openMultiplayerPrivate(guest);
    await guest.getByRole('tab', { name: 'Join lobby' }).click();
    await guest.getByPlaceholder('ROOM CODE').fill(code);
    await guest.getByRole('button', { name: /^Join$/i }).click();
    await guest.getByText('Your room code', { exact: false }).waitFor({ timeout: 45_000 });

    await host.getByRole('button', { name: /Start Match/i }).click();
    await host.waitForTimeout(4000);

    const inMatch =
      (await host.locator('.rh-match-live, .game-screen, .match-live-root, .pvf-root').count()) > 0 ||
      (await host.getByText(/Boneyard|Pass|Draw/i).count()) > 0;
    results.steps.push({
      name: 'match_started',
      pass: inMatch,
      detail: inMatch ? 'Host appears in live match UI' : 'Could not confirm live match UI',
    });

    if (!inMatch) {
      throw new Error('Match did not start — cannot run offline reconnect test');
    }

    await hostCtx.setOffline(true);
    const bannerDuring = await waitForBanner(host, true, 20_000);
    results.steps.push({
      name: 'banner_during_offline',
      pass: bannerDuring,
      detail: bannerDuring ? 'Recovery banner appeared while offline' : 'No recovery banner while offline',
    });

    await host.waitForTimeout(OFFLINE_MS);
    await hostCtx.setOffline(false);

    const bannerCleared = !(await waitForBanner(host, false, 45_000));
    results.steps.push({
      name: 'banner_cleared_after_reconnect',
      pass: bannerCleared,
      detail: bannerCleared
        ? 'Recovery banner cleared after network restored'
        : 'Recovery banner still visible after reconnect window',
    });

    const gameplayResumed = await host.evaluate(() => {
      const body = document.body.innerText || '';
      return !/Reconnect failed/i.test(body);
    });
    results.steps.push({
      name: 'no_failed_state',
      pass: gameplayResumed,
      detail: gameplayResumed ? 'No reconnect failed state' : 'Reconnect failed banner/message present',
    });

    await hostCtx.close();
    await guestCtx.close();
  } finally {
    await browser.close();
  }

  const pass = results.steps.every((s) => s.pass);
  console.log(JSON.stringify({ ok: pass, ...results }, null, 2));
  if (!pass) process.exit(1);
}

main().catch((error) => {
  console.error('[reconnectProductionQa] FAILED', error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
