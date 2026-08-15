import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(__dirname, '..');
const artifactsDir = '/Users/olivermorid/.gemini/antigravity-cli/brain/0bbe7b98-cebc-49fb-a2ef-49f74a51044f';

const APP_URL = 'http://localhost:5173';

function ensureArtifactsDir() {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

function loadEnvFiles() {
  const serverEnv = path.resolve(clientRoot, '../server/.env');
  const clientEnv = path.resolve(clientRoot, '.env');
  [serverEnv, clientEnv].forEach(envFile => {
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf8');
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const idx = trimmed.indexOf('=');
          const key = trimmed.slice(0, idx).trim();
          const val = trimmed.slice(idx + 1).trim();
          process.env[key] = val;
        }
      });
    }
  });
}

async function provisionQAUser() {
  loadEnvFiles();
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) {
    throw new Error('Supabase configuration variables are missing in env files.');
  }

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const id = randomUUID();
  const username = `audit_${id.replace(/-/g, '').slice(0, 18)}`;
  const email = `audit-${id}@racehorse-test.invalid`;
  const password = `Audit-${randomUUID()}-Aa9!`;

  console.log(`[QA User] Creating user: ${email}...`);
  const { data: userData, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, preferred_username: username },
  });
  if (createError) throw new Error(`Create user failed: ${createError.message}`);
  const userId = userData.user?.id;
  if (!userId) throw new Error('Created user has no ID');

  console.log(`[QA User] Signing in user to get session...`);
  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) {
    await adminClient.auth.admin.deleteUser(userId);
    throw new Error(`Sign in failed: ${signInError.message}`);
  }

  const session = authData.session;
  if (!session) {
    await adminClient.auth.admin.deleteUser(userId);
    throw new Error('No session returned');
  }

  const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
  const storageKey = `sb-${projectRef}-auth-token`;

  return { userId, session, storageKey, adminClient };
}

async function takeScreenshot(page, filename, description) {
  const filePath = path.join(artifactsDir, filename);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`[SCREENSHOT] Saved ${filename} (${description})`);
}

function setupConsoleLogging(page, name) {
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[RenderProfiler]') || text.includes('Rendered ')) return; // skip noisy logs
    console.log(`[BROWSER CONSOLE - ${name}] ${msg.type().toUpperCase()}: ${text}`);
  });
  page.on('pageerror', err => {
    console.error(`[BROWSER UNCAUGHT ERROR - ${name}] ${err.stack || err.message}`);
  });
}

async function isPlayerTurn(page) {
  const activePill = await page.locator('.wl-player-pill.is-you.is-active-turn').isVisible().catch(() => false);
  const preGame = await page.locator('.pre-game-draw-board').isVisible().catch(() => false);
  return activePill && !preGame;
}

async function clickFirstPickablePreGameDraw(page) {
  const pickable = page.locator('.pre-game-draw-board__tile-slot.is-pickable');
  if (await pickable.count() > 0) {
    console.log('Pre-game draw is active. Picking a tile.');
    await pickable.first().click({ force: true });
    await page.waitForTimeout(500);
    return true;
  }
  return false;
}

async function tryMakeMove(page) {
  if (await clickFirstPickablePreGameDraw(page)) {
    return true;
  }

  const isHandOver = await page.getByTestId('hand-over-modal').isVisible().catch(() => false);
  const isGameOver = await page.locator('.game-over-modal').isVisible().catch(() => false);
  if (isHandOver || isGameOver) {
    console.log(`Match is in modal state: HandOver=${isHandOver}, GameOver=${isGameOver}`);
    return false;
  }

  const drawBtn = page.locator('button').filter({ hasText: /^Draw$/i });
  if (await drawBtn.isVisible().catch(() => false)) {
    if (await drawBtn.isEnabled().catch(() => false)) {
      console.log('Draw button visible and enabled. Clicking Draw.');
      await drawBtn.click();
      await page.waitForTimeout(800);
      return true;
    }
  }

  const passBtn = page.locator('button').filter({ hasText: /^Pass$/i });
  if (await passBtn.isVisible().catch(() => false)) {
    if (await passBtn.isEnabled().catch(() => false)) {
      console.log('Pass button visible and enabled. Clicking Pass.');
      await passBtn.click();
      await page.waitForTimeout(800);
      return true;
    }
  }

  const playable = page.locator('.hand-container button.domino-tile:not(.unplayable):not(.disabled)');
  const count = await playable.count();
  if (count === 0) {
    console.log('No playable tiles, no draw/pass button either. Waiting.');
    return false;
  }

  console.log(`Found ${count} playable tiles in hand. Clicking the first one.`);
  await playable.first().click({ force: true });
  await page.waitForTimeout(500);

  const activeZone = page.locator('.placement-zone.active');
  const zoneCount = await activeZone.count();
  if (zoneCount > 0) {
    console.log(`Found ${zoneCount} active placement zones. Placing tile at first zone.`);
    await activeZone.first().click({ force: true });
    await page.waitForTimeout(1000);
    return true;
  } else {
    console.log('No active placement zones highlighted after selecting tile. Clicking tile again to deselect.');
    await playable.first().click({ force: true });
    await page.waitForTimeout(300);
    return false;
  }
}

async function leaveMatch(page) {
  const leaveBtn = page.locator('[aria-label*="leave" i], [class*="back-btn"], button:has-text("Back")').first();
  if (await leaveBtn.isVisible().catch(() => false)) {
    console.log('Clicking leave/back button.');
    await leaveBtn.click();
    await page.waitForTimeout(1000);
    const confirmBtn = page.locator('.rh-leave-modal__btn--leave, button:has-text("Leave Match"), button:has-text("Leave Game")').first();
    if (await confirmBtn.isVisible().catch(() => false)) {
      console.log('Clicking confirm leave button.');
      await confirmBtn.click();
      await page.waitForTimeout(2000);
    }
  }
}

async function runMultiplayerAudit() {
  console.log('=== PART 1: MULTIPLAYER AUDIT ===');
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });

  const hostContext = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const guestContext = await browser.newContext({ viewport: { width: 1000, height: 800 } });

  await hostContext.addInitScript(() => {
    window.localStorage.setItem('hasSeenWelcome', '1');
    window.localStorage.setItem('racehorse_guest_identity_v1', 'guest_auditor_host');
  });
  await guestContext.addInitScript(() => {
    window.localStorage.setItem('hasSeenWelcome', '1');
    window.localStorage.setItem('racehorse_guest_identity_v1', 'guest_auditor_guest');
  });

  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();

  setupConsoleLogging(hostPage, 'Host');
  setupConsoleLogging(guestPage, 'Guest');

  console.log('Host: opening home page...');
  await hostPage.goto(APP_URL);
  await hostPage.getByText('Multiplayer', { exact: false }).first().click();
  await hostPage.waitForTimeout(2000);

  console.log('Host: clicking Private lobby...');
  const hostPrivateTab = hostPage.getByRole('tab', { name: /Private/i });
  if (await hostPrivateTab.isVisible()) {
    await hostPrivateTab.click();
  } else {
    await hostPage.getByRole('button', { name: /^Private$/i }).click();
  }
  await hostPage.waitForTimeout(1000);

  console.log('Host: creating lobby...');
  await hostPage.getByRole('tab', { name: /Create lobby/i }).click();
  await hostPage.locator('.pml-panel-footer').getByRole('button', { name: /^Create lobby/i }).click();
  await hostPage.waitForTimeout(2000);

  await takeScreenshot(hostPage, 'mp_01_host_created_lobby.png', 'Host created private lobby');

  const roomCodeLocator = hostPage.locator('.pml-roomcode-bar-code');
  await roomCodeLocator.waitFor({ state: 'visible', timeout: 10000 });
  const roomCode = (await roomCodeLocator.innerText()).trim().toUpperCase();
  console.log(`[Multiplayer] Room Code is: ${roomCode}`);

  console.log('Guest: joining room...');
  await guestPage.goto(APP_URL);
  await guestPage.getByText('Multiplayer', { exact: false }).first().click();
  await guestPage.waitForTimeout(2000);

  const guestPrivateTab = guestPage.getByRole('tab', { name: /Private/i });
  if (await guestPrivateTab.isVisible()) {
    await guestPrivateTab.click();
  } else {
    await guestPage.getByRole('button', { name: /^Private$/i }).click();
  }
  await guestPage.waitForTimeout(1000);

  await guestPage.getByRole('tab', { name: /Join lobby/i }).click();
  await guestPage.getByPlaceholder('ROOM CODE').fill(roomCode);
  await guestPage.locator('.claude-mode-join-box').getByRole('button', { name: /^Join$/i }).click();
  await guestPage.waitForTimeout(3000);

  await takeScreenshot(guestPage, 'mp_02_guest_joined_lobby.png', 'Guest joined lobby');

  console.log('Host: starting match...');
  const startBtn = hostPage.getByRole('button', { name: /Start Match/i });
  await startBtn.waitFor({ state: 'visible', timeout: 10000 });
  await startBtn.click();
  await hostPage.waitForTimeout(2000);

  await hostPage.locator('.game-screen').waitFor({ state: 'visible', timeout: 10000 });
  await guestPage.locator('.game-screen').waitFor({ state: 'visible', timeout: 10000 });
  console.log('Multiplayer match started. Board loaded for both players.');

  console.log('Resolving pre-game draw...');
  await clickFirstPickablePreGameDraw(hostPage);
  await clickFirstPickablePreGameDraw(guestPage);
  await hostPage.waitForTimeout(6000); // wait for pre-game draw to resolve and hands to deal

  await takeScreenshot(hostPage, 'mp_03_match_hand_dealt.png', 'Match active and hand dealt');

  console.log('Playing turns...');
  for (let turn = 0; turn < 6; turn++) {
    const hostTurn = await isPlayerTurn(hostPage);
    const guestTurn = await isPlayerTurn(guestPage);
    console.log(`[Turn ${turn}] HostTurn=${hostTurn}, GuestTurn=${guestTurn}`);
    if (hostTurn) {
      await tryMakeMove(hostPage);
    } else if (guestTurn) {
      await tryMakeMove(guestPage);
    } else {
      await hostPage.waitForTimeout(1500);
    }
  }

  console.log('--- Disruption Scenario: Host Mid-match Refresh ---');
  await takeScreenshot(hostPage, 'mp_refresh_01_before.png', 'Host before refresh');
  await hostPage.reload({ waitUntil: 'domcontentloaded' });
  console.log('Host refreshed. Resuming multiplayer lobby rejoin...');
  await hostPage.waitForTimeout(3000);
  await hostPage.getByText('Multiplayer', { exact: false }).first().click();
  await hostPage.waitForTimeout(5000);
  await takeScreenshot(hostPage, 'mp_refresh_02_after.png', 'Host after refresh & rejoin');

  const hostMatchVisible = await hostPage.locator('.game-screen').isVisible().catch(() => false);
  console.log(`[Disruption] Rejoin Match Screen Visible: ${hostMatchVisible}`);

  console.log('--- Disruption Scenario: Second Tab Takeover for Guest ---');
  const guestPage2 = await guestContext.newPage();
  setupConsoleLogging(guestPage2, 'GuestTab2');
  await guestPage2.goto(APP_URL);
  await guestPage2.getByText('Multiplayer', { exact: false }).first().click();
  await guestPage2.waitForTimeout(4000);
  await takeScreenshot(guestPage2, 'mp_takeover_new_tab.png', 'Guest second tab after rejoining');
  await takeScreenshot(guestPage, 'mp_takeover_old_tab.png', 'Guest first tab after takeover');
  await guestPage2.close();

  console.log('--- Disruption Scenario: Rapid Double-Click Move ---');
  const activePage = (await isPlayerTurn(hostPage)) ? hostPage : guestPage;
  const playableTile = activePage.locator('.hand-container button.domino-tile:not(.unplayable):not(.disabled)').first();
  if (await playableTile.isVisible()) {
    await playableTile.click({ clickCount: 2, delay: 50 });
    console.log('Tile double clicked rapidly.');
    await activePage.waitForTimeout(1000);
  }

  console.log('--- Disruption Scenario: Going Offline / Online ---');
  const freshGuestPage = await guestContext.newPage();
  setupConsoleLogging(freshGuestPage, 'FreshGuest');
  await freshGuestPage.goto(APP_URL);
  await freshGuestPage.getByText('Multiplayer', { exact: false }).first().click();
  await freshGuestPage.waitForTimeout(4000);
  await takeScreenshot(freshGuestPage, 'mp_offline_01_before.png', 'Guest before going offline');
  await guestContext.setOffline(true);
  console.log('Guest context is now offline. Waiting 6 seconds...');
  await freshGuestPage.waitForTimeout(6000);
  await takeScreenshot(freshGuestPage, 'mp_offline_02_disconnected.png', 'Guest while offline');
  await guestContext.setOffline(false);
  console.log('Guest context is now online again. Waiting for reconnect...');
  await freshGuestPage.waitForTimeout(6000);
  await takeScreenshot(freshGuestPage, 'mp_offline_03_reconnected.png', 'Guest after coming online');
  await freshGuestPage.close();

  await hostContext.close();
  await guestContext.close();
  await browser.close();
  console.log('=== MULTIPLAYER AUDIT COMPLETED ===\n');
}

async function runDailyFritzAudit(sessionData) {
  console.log('=== PART 2: DAILY FRITZ AUDIT ===');
  if (!sessionData) {
    console.log('[ERROR] Dynamic QA user registration failed! Skipping Daily Fritz.');
    return;
  }

  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });

  await context.addInitScript(() => {
    window.localStorage.setItem('hasSeenWelcome', '1');
    window.localStorage.setItem('username_onboarding_dismissed', Date.now().toString());
  });

  const page = await context.newPage();
  setupConsoleLogging(page, 'DailyFritz');

  console.log('Daily Fritz: Injecting dynamic QA session into localStorage...');
  await page.goto(APP_URL);
  await page.evaluate(({ key, val }) => {
    window.localStorage.setItem(key, JSON.stringify(val));
    window.localStorage.setItem('hasSeenWelcome', '1');
    window.localStorage.setItem('username_onboarding_dismissed', Date.now().toString());
  }, { key: sessionData.storageKey, val: sessionData.session });

  console.log('Daily Fritz: navigating to /#/daily-fritz...');
  await page.goto(`${APP_URL}/#/daily-fritz`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Daily Fritz' }).waitFor({ state: 'visible', timeout: 15000 });
  await takeScreenshot(page, 'df_01_hub_screen.png', 'Daily Fritz Hub page');

  const playBtn = page.locator('.df-pvf-start-btn');
  await playBtn.waitFor({ state: 'visible', timeout: 10000 });
  const isPlayBtnVisible = await playBtn.isVisible();
  console.log(`[Daily Fritz] Play button visible: ${isPlayBtnVisible}`);

  if (isPlayBtnVisible) {
    console.log('Clicking play to start Daily Fritz run...');
    await playBtn.click();
    await page.waitForTimeout(3000);

    await takeScreenshot(page, 'df_02_board_loaded.png', 'Daily Fritz match board loaded');

    await clickFirstPickablePreGameDraw(page);
    await page.waitForTimeout(6000); // wait for pre-game draw to resolve and hands to deal

    console.log('Playing first turn in Daily Fritz...');
    if (await isPlayerTurn(page)) {
      await tryMakeMove(page);
    }
    await page.waitForTimeout(1000);
    await takeScreenshot(page, 'df_03_first_move_made.png', 'First move played');

    console.log('--- Disruption Scenario: Daily Fritz Mid-run Refresh ---');
    await page.reload({ waitUntil: 'domcontentloaded' });
    console.log('Daily Fritz page reloaded. Waiting for auto-resume...');
    await page.waitForTimeout(4000);
    await takeScreenshot(page, 'df_04_after_refresh.png', 'Daily Fritz board after reload');

    const boardReplaced = await page.locator('.bot-match-screen.bot-match-mode-daily-fritz').isVisible().catch(() => false);
    console.log(`[Daily Fritz] Mid-run recovery successful: ${boardReplaced}`);

    console.log('Daily Fritz: attempting second move...');
    if (await isPlayerTurn(page)) {
      await tryMakeMove(page);
    }
    await page.waitForTimeout(1000);
    await takeScreenshot(page, 'df_05_second_move_made.png', 'Second move played');
  }

  console.log('Navigating back to Daily Fritz hub...');
  await page.goto(`${APP_URL}/#/daily-fritz`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await takeScreenshot(page, 'df_06_hub_revisited.png', 'Revisited Daily Fritz Hub');

  await context.close();
  await browser.close();
  console.log('=== DAILY FRITZ AUDIT COMPLETED ===\n');
}

async function runFritzBotAudit(sessionData) {
  console.log('=== PART 3: FRITZ BOT MATCH AUDIT (PLAY VS FRITZ) ===');
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  
  await context.addInitScript(() => {
    window.localStorage.setItem('hasSeenWelcome', '1');
    window.localStorage.setItem('username_onboarding_dismissed', Date.now().toString());
  });

  const page = await context.newPage();
  setupConsoleLogging(page, 'FritzBot');

  try {
    if (sessionData) {
      console.log('Fritz Bot: Injecting dynamic QA session into localStorage for Rated Practice...');
      await page.goto(APP_URL);
      await page.evaluate(({ key, val }) => {
        window.localStorage.setItem(key, JSON.stringify(val));
        window.localStorage.setItem('hasSeenWelcome', '1');
        window.localStorage.setItem('username_onboarding_dismissed', Date.now().toString());
      }, { key: sessionData.storageKey, val: sessionData.session });
    }

    console.log('Navigating to solo hub...');
    // We are on the Home page, click "Single Player" button on the bottom nav tab to transition safely
    const singlePlayerTab = page.getByRole('button', { name: 'Single Player', exact: true }).first();
    await singlePlayerTab.waitFor({ state: 'visible', timeout: 10000 });
    await singlePlayerTab.click();
    await page.waitForTimeout(2000);

    console.log('Clicking Play vs Fritz...');
    await page.getByText('Play vs Fritz', { exact: false }).first().click();
    await page.waitForTimeout(1000);

    console.log('Configuring bot settings...');
    const startBtn = page.getByRole('button', { name: /Start Match/i });
    await startBtn.waitFor({ state: 'visible', timeout: 5000 });
    await takeScreenshot(page, 'bot_standard_setup.png', 'Bot Setup Screen');
    await startBtn.click();
    await page.waitForTimeout(2000);

    await page.locator('.game-screen').waitFor({ state: 'visible', timeout: 10000 });
    console.log('Fritz standard match started.');

    await clickFirstPickablePreGameDraw(page);
    await page.waitForTimeout(6000); // wait for pre-game draw to resolve and hands to deal
    await takeScreenshot(page, 'bot_standard_match_started.png', 'Bot Standard Match Active');

    console.log('Playing 5 moves in Standard match...');
    for (let turn = 0; turn < 5; turn++) {
      if (await isPlayerTurn(page)) {
        await tryMakeMove(page);
      } else {
        console.log('Waiting for Bot...');
        await page.waitForTimeout(2000);
      }
    }
    await takeScreenshot(page, 'bot_standard_mid_match.png', 'Bot Standard Mid-match');

    console.log('Leaving match...');
    await leaveMatch(page);

    // Tier 2: Elite difficulty
    console.log('Re-entering Play vs Fritz to test Elite difficulty...');
    // We should be back in Single Player hub, or click the Single Player tab just in case
    const singlePlayerTab2 = page.getByRole('button', { name: 'Single Player', exact: true }).first();
    if (await singlePlayerTab2.isVisible()) {
      await singlePlayerTab2.click();
      await page.waitForTimeout(1500);
    }

    // Wait for the Play vs Fritz option to appear in Solo hub
    await page.getByText('Play vs Fritz', { exact: false }).first().waitFor({ state: 'visible', timeout: 10000 });
    await page.getByText('Play vs Fritz', { exact: false }).first().click();
    await page.waitForTimeout(1500);

    // Select Elite difficulty
    const eliteBtn = page.locator('button').filter({ hasText: /^Elite$/i });
    if (await eliteBtn.count() > 0) {
      console.log('Selecting Elite difficulty...');
      await eliteBtn.first().click();
      await page.waitForTimeout(1000);
    }
    
    await takeScreenshot(page, 'bot_elite_setup.png', 'Bot Elite Setup Screen');
    await page.getByRole('button', { name: /Start Match/i }).click();
    await page.waitForTimeout(2000);

    await clickFirstPickablePreGameDraw(page);
    await page.waitForTimeout(6000); // wait for pre-game draw to resolve and hands to deal
    await takeScreenshot(page, 'bot_elite_match_started.png', 'Bot Elite Match Active');

    console.log('Playing 5 moves in Elite match...');
    for (let turn = 0; turn < 5; turn++) {
      if (await isPlayerTurn(page)) {
        await tryMakeMove(page);
      } else {
        console.log('Waiting for Bot...');
        await page.waitForTimeout(2000);
      }
    }
    await takeScreenshot(page, 'bot_elite_mid_match.png', 'Bot Elite Mid-match');
    await leaveMatch(page);
  } catch (error) {
    console.error('Fritz bot audit error:', error);
    await takeScreenshot(page, 'bot_error_state.png', 'Bot error page state');
  } finally {
    await context.close();
    await browser.close();
    console.log('=== FRITZ BOT MATCH AUDIT COMPLETED ===\n');
  }
}

async function main() {
  ensureArtifactsDir();

  let sessionData = null;
  try {
    sessionData = await provisionQAUser();
  } catch (error) {
    console.error('Failed to provision dynamic QA user:', error);
  }

  try {
    await runMultiplayerAudit();
  } catch (error) {
    console.error('Multiplayer audit failed:', error);
  }

  try {
    await runDailyFritzAudit(sessionData);
  } catch (error) {
    console.error('Daily Fritz audit failed:', error);
  }

  try {
    await runFritzBotAudit(sessionData);
  } catch (error) {
    console.error('Fritz bot audit failed:', error);
  }

  if (sessionData) {
    console.log(`[QA User] Cleaning up user: ${sessionData.userId}...`);
    try {
      await sessionData.adminClient.auth.admin.deleteUser(sessionData.userId);
      console.log('[QA User] Deleted successfully.');
    } catch (error) {
      console.error('[QA User] Deletion failed:', error);
    }
  }
}

main().catch(console.error);
