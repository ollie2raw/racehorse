#!/usr/bin/env node
/**
 * Daily Fritz checkpoint durability checks against a built client + server (phone profile):
 *   reload   : play, reload mid-hand, board/rack restore from the local snapshot
 *   hide     : play, hide the tab (visibilitychange) right after a move, then resume in a fresh context (no local storage)
 *              from the SERVER checkpoint alone; the restored board must equal the board at hide time
 *   offline  : go offline, play, come back online; the latest revision must reach the server
 *   node scripts/perf/checkpointResume.mjs --base http://127.0.0.1:5422 [--browser webkit]
 *   Caveat: the reload scenario relies on the beacon replay below being an ASYNC fetch; WebKit cancels it during unload, so a WebKit reload result is not meaningful (it needs a real JWT in a native beacon, a device test).
 */
import { chromium, devices, webkit } from '@playwright/test';

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])));
const BASE = args.base;
const BROWSER = args.browser ?? 'chromium';
const browser = await (BROWSER === 'webkit' ? webkit : chromium).launch();
const userId = crypto.randomUUID();
const mk = async () => {
  const context = await browser.newContext(devices['iPhone 14 landscape']);
  await context.addInitScript((uid) => {
    localStorage.setItem('hasSeenWelcome', '1');
    localStorage.setItem('racehorse_e2e_user_id', uid);
    localStorage.setItem('racehorse_e2e_bearer', 'e2e-daily-fritz');
  }, userId);
  await context.addInitScript(() => {
    window.__beacons = 0;
    const orig = navigator.sendBeacon?.bind(navigator);
    // The e2e auth shim needs an x-e2e-daily-fritz-user header, which a beacon cannot carry (production sends the JWT in the
    // body instead). So replay each beacon as a keepalive fetch with that header: this checks WHAT is flushed and WHEN,
    // not the browser's beacon transport.
    if (orig) navigator.sendBeacon = (url, blob) => {
      window.__beacons++;
      const uid = localStorage.getItem('racehorse_e2e_user_id');
      blob.text().then((body) => fetch(url, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer e2e-daily-fritz', 'x-e2e-daily-fritz-user': uid }, body }));
      return true;
    };
  });
  const page = await context.newPage();
  const posts = [];
  page.on('request', (r) => { if (r.url().includes('/api/daily-fritz/checkpoint')) posts.push({ t: Date.now(), rev: Number(/"checkpointRevision":(\d+)/.exec(r.postData() ?? '')?.[1] ?? -1) }); });
  return { context, page, posts };
};
const start = async (page) => {
  await page.goto(`${BASE}/daily-fritz`);
  await page.getByRole('heading', { name: 'Daily Fritz' }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  await page.locator('.df-pvf-start-btn').click();
  await page.locator('.bot-match-screen.bot-match-mode-daily-fritz').waitFor({ timeout: 30000 });
};
const play = async (page, moves) => {
  const playable = page.locator('.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)').first();
  const zone = page.locator('.placement-zone.active').first();
  const boneyard = page.locator('[class*="boneyard"]').first();
  const pick = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
  let done = 0;
  for (let i = 0; i < 200 && done < moves; i++) {
    if (await pick.isVisible().catch(() => false)) await pick.tap({ force: true, timeout: 3000 }).catch(() => {});
    else if ((await playable.count().catch(() => 0)) > 0) {
      await playable.tap({ force: true, timeout: 3000 }).catch(() => {});
      if (await zone.isVisible({ timeout: 1200 }).catch(() => false)) { await zone.tap({ force: true, timeout: 3000 }).catch(() => {}); done++; }
    } else if (await boneyard.isVisible().catch(() => false)) await boneyard.tap({ force: true, timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2500); // let Fritz answer
};
const board = (page) => page.evaluate(() => ({
  boardTiles: document.querySelectorAll('.board-tile').length,
  rack: document.querySelectorAll('.hand-area .domino-tile').length,
}));
const localRev = (page) => page.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => x.startsWith('racehorse:daily-fritz:v3:'));
  return k ? JSON.parse(localStorage.getItem(k)).checkpointRevision : null;
});
const settle = async (page) => {
  let last = '';
  for (let i = 0; i < 20; i++) { const cur = JSON.stringify(await board(page)); if (cur === last) return; last = cur; await page.waitForTimeout(1500); }
};
const out = {};

{ // reload
  const { context, page } = await mk();
  await start(page); await play(page, 4);
  await settle(page);
  const before = await board(page); const revBefore = await localRev(page);
  await page.reload(); await page.waitForTimeout(3000);
  const resume = page.getByRole('button', { name: /resume|continue/i }).first();
  if (await resume.isVisible().catch(() => false)) await resume.tap({ force: true }).catch(() => {});
  else await page.locator('.df-pvf-start-btn').click().catch(() => {});
  await page.locator('.bot-match-screen.bot-match-mode-daily-fritz').waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);
  out.reload = { before, after: await board(page), localRevBefore: revBefore, localRevAfter: await localRev(page) };
  await context.close();
}
{ // hide -> server-only resume
  const a = await mk();
  await start(a.page); await play(a.page, 3);
  for (let i = 0; i < 40 && a.posts.length === 0; i++) await a.page.waitForTimeout(500);
  const postsAtWindow = a.posts.length;
  await a.page.waitForTimeout(700);
  await play(a.page, 1); // one more move AFTER the last window post, hide before the next window closes
  await settle(a.page);
  const before = await board(a.page);
  const revLocal = await localRev(a.page);
  const postsBefore = a.posts.length;
  const lastWindowAt = a.posts.at(-1)?.t ?? 0;
  await a.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await a.page.waitForTimeout(1500);
  out.hide = { before, localRev: revLocal, postsAtFirstWindow: postsAtWindow, msSinceLastPost: Date.now() - lastWindowAt, postsOnHide: a.posts.length - postsBefore, beaconsOnHide: await a.page.evaluate(() => window.__beacons), lastPostedRev: a.posts.at(-1)?.rev ?? null };
  await a.context.close();
  const b = await mk(); // no local storage: only the server checkpoint can restore
  await b.page.goto(`${BASE}/daily-fritz`);
  await b.page.getByRole('heading', { name: 'Daily Fritz' }).waitFor({ timeout: 30000 });
  await b.page.waitForTimeout(1500);
  await b.page.locator('.df-pvf-start-btn').click();
  await b.page.locator('.bot-match-screen.bot-match-mode-daily-fritz').waitFor({ timeout: 30000 });
  await b.page.waitForTimeout(3500);
  out.hide.restoredFromServer = await board(b.page);
  out.hide.restoredLocalRev = await localRev(b.page);
  await b.context.close();
}
{ // offline
  const { context, page, posts } = await mk();
  await start(page); await play(page, 2);
  await page.waitForTimeout(13000); // first window closes online
  const online0 = posts.length;
  await context.setOffline(true);
  await play(page, 3);
  await page.waitForTimeout(14000); // window closes while offline: post fails
  const revLocal = await localRev(page);
  const offlineAttempts = posts.length - online0;
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(8000);
  out.offline = { localRev: revLocal, attemptsWhileOffline: offlineAttempts, postsAfterReconnect: posts.length - online0 - offlineAttempts, lastPostedRev: posts.at(-1)?.rev ?? null };
  await context.close();
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
