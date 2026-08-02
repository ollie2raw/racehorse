import { test, expect } from '@playwright/test';
import {
  GAME_SCREEN_LOCATOR,
  makeRunIdentity,
  createPrivateLobbyAsHost,
  forceSocketTransportDown,
  joinPrivateLobby,
  restoreSocketTransport,
  readHudScorePair,
  readLastRoomCode,
  resumeMultiplayerAfterReload,
  seedPlayerIdentity,
  startPrivateMatchFromLobby,
  waitForActiveMatch,
  waitForGameServerReady,
  waitForHostBackInMatch,
  waitForHostRecoveryUi,
  waitForGuestDisconnectSignal,
} from './helpers/multiplayerMatch';

test.describe.configure({ mode: 'serial', timeout: 360_000 });

function numericScores(scores: { you: string; opponent: string }) {
  const read = (value: string) => value.match(/(\d+)\s*$/)?.[1] ?? '';
  return { you: read(scores.you), opponent: read(scores.opponent) };
}

test.beforeAll(async () => {
  await waitForGameServerReady();
});

test.describe('Multiplayer in-match reconnect E2E', () => {
  test('transport loss — host reconnects and both players stay in sync', async ({ browser }, testInfo) => {
    const runId = testInfo.testId;
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    await seedPlayerIdentity(hostContext, makeRunIdentity('a', runId));
    await seedPlayerIdentity(guestContext, makeRunIdentity('b', runId));

    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    const roomCode = await createPrivateLobbyAsHost(hostPage);
    await joinPrivateLobby(guestPage, roomCode);
    await startPrivateMatchFromLobby(hostPage, guestPage);

    const hostScoresBefore = await readHudScorePair(hostPage);
    const guestScoresBefore = await readHudScorePair(guestPage);
    expect(hostScoresBefore.you).not.toEqual('');
    expect(guestScoresBefore.you).not.toEqual('');

    await forceSocketTransportDown(hostPage, hostContext);
    await waitForHostRecoveryUi(hostPage);
    await waitForGuestDisconnectSignal(guestPage);

    await restoreSocketTransport(hostPage, hostContext);
    await waitForHostBackInMatch(hostPage);
    await expect(hostPage.locator(GAME_SCREEN_LOCATOR)).toBeVisible();
    await expect(guestPage.locator(GAME_SCREEN_LOCATOR)).toBeVisible();

    const hostScoresAfter = await readHudScorePair(hostPage);
    const guestScoresAfter = await readHudScorePair(guestPage);
    expect(numericScores(hostScoresAfter)).toEqual(numericScores(hostScoresBefore));
    expect(numericScores(guestScoresAfter)).toEqual(numericScores(guestScoresBefore));
    expect(await readLastRoomCode(hostPage)).toBe(roomCode);

    await hostContext.close();
    await guestContext.close();
  });

  test('refresh recovery — mid-match reload rejoins same room with live state', async ({ browser }, testInfo) => {
    const runId = testInfo.testId;
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    await seedPlayerIdentity(hostContext, makeRunIdentity('a', runId));
    await seedPlayerIdentity(guestContext, makeRunIdentity('b', runId));

    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    const roomCode = await createPrivateLobbyAsHost(hostPage);
    await joinPrivateLobby(guestPage, roomCode);
    await startPrivateMatchFromLobby(hostPage, guestPage);

    const scoresBeforeRefresh = await readHudScorePair(hostPage);
    expect(await readLastRoomCode(hostPage)).toBe(roomCode);

    await hostPage.reload();
    await resumeMultiplayerAfterReload(hostPage, roomCode);
    await waitForActiveMatch(hostPage);
    await expect(hostPage.locator('.wl-turn-label, .rh-turn-label').first()).toBeVisible({
      timeout: 30_000,
    });

    expect(await readLastRoomCode(hostPage)).toBe(roomCode);
    const scoresAfterRefresh = await readHudScorePair(hostPage);
    expect(numericScores(scoresAfterRefresh)).toEqual(numericScores(scoresBeforeRefresh));
    await expect(guestPage.locator(GAME_SCREEN_LOCATOR)).toBeVisible();

    await hostContext.close();
    await guestContext.close();
  });

  test('superseded session — second tab for same player takes over without crashing', async ({
    browser,
  }, testInfo) => {
    const runId = testInfo.testId;
    const context = await browser.newContext();
    await seedPlayerIdentity(context, makeRunIdentity('a', runId));

    const primaryPage = await context.newPage();
    const roomCode = await createPrivateLobbyAsHost(primaryPage);

    const guestContext = await browser.newContext();
    await seedPlayerIdentity(guestContext, makeRunIdentity('b', runId));
    const guestPage = await guestContext.newPage();
    await joinPrivateLobby(guestPage, roomCode);
    await startPrivateMatchFromLobby(primaryPage, guestPage);

    const secondaryPage = await context.newPage();
    await secondaryPage.goto('/');
    await expect(secondaryPage.getByText('RACEHORSE', { exact: false })).toBeVisible({
      timeout: 20_000,
    });
    await secondaryPage.getByText('Multiplayer', { exact: false }).first().click();
    await waitForActiveMatch(secondaryPage);
    expect(await readLastRoomCode(secondaryPage)).toBe(roomCode);
    await expect(guestPage.locator(GAME_SCREEN_LOCATOR)).toBeVisible();

    await context.close();
    await guestContext.close();
  });
});
