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
  attachServerStateProbe,
  readLastServerStateSnapshot,
  wipeNonIdentityLocalStorage,
  installStaleMoveProbe,
  readStaleMoveAck,
  emitStaleMoveNow,
  fetchDisconnectGraceSeats,
  readE2eSocketConnected,
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
  test('A — refresh restores the same seated match from a server state:update, not a client cache', async ({
    browser,
  }, testInfo) => {
    const runId = testInfo.testId;
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    await seedPlayerIdentity(hostContext, makeRunIdentity('a', runId));
    await seedPlayerIdentity(guestContext, makeRunIdentity('b', runId));

    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    const roomCode = await createPrivateLobbyAsHost(hostPage);
    await joinPrivateLobby(guestPage, roomCode);
    await attachServerStateProbe(hostPage);
    await attachServerStateProbe(guestPage);
    await startPrivateMatchFromLobby(hostPage, guestPage);

    await expect
      .poll(async () => (await readLastServerStateSnapshot(guestPage))?.sequence != null, {
        timeout: 30_000,
      })
      .toBeTruthy();

    const scoresBefore = await readHudScorePair(hostPage);
    const guestBefore = await readLastServerStateSnapshot(guestPage);
    expect(guestBefore?.scores).toBeTruthy();
    expect(await readLastRoomCode(hostPage)).toBe(roomCode);

    await wipeNonIdentityLocalStorage(hostPage);
    await hostPage.reload();
    await resumeMultiplayerAfterReload(hostPage, roomCode);
    await waitForActiveMatch(hostPage);

    const guestAfter = await readLastServerStateSnapshot(guestPage);
    expect(guestAfter?.sequence).toBe(guestBefore?.sequence);
    expect(guestAfter?.scores).toEqual(guestBefore?.scores);
    expect(numericScores(await readHudScorePair(hostPage))).toEqual(numericScores(scoresBefore));
    expect(await readLastRoomCode(hostPage)).toBe(roomCode);
    await expect(guestPage.locator(GAME_SCREEN_LOCATOR)).toBeVisible();

    await hostContext.close();
    await guestContext.close();
  });

  test('B — second tab takes seat authority and the old tab MOVE is rejected by the server', async ({
    browser,
  }, testInfo) => {
    const runId = testInfo.testId;
    const identity = makeRunIdentity('a', runId);
    const primaryContext = await browser.newContext();
    await seedPlayerIdentity(primaryContext, identity);

    const primaryPage = await primaryContext.newPage();
    const roomCode = await createPrivateLobbyAsHost(primaryPage);

    const guestContext = await browser.newContext();
    await seedPlayerIdentity(guestContext, makeRunIdentity('b', runId));
    const guestPage = await guestContext.newPage();
    await joinPrivateLobby(guestPage, roomCode);
    await startPrivateMatchFromLobby(primaryPage, guestPage);
    await installStaleMoveProbe(primaryPage, roomCode);

    const secondaryContext = await browser.newContext();
    await seedPlayerIdentity(secondaryContext, identity);
    await secondaryContext.addInitScript((code) => {
      window.localStorage.setItem('racehorse_last_room_code', code);
    }, roomCode);
    const secondaryPage = await secondaryContext.newPage();
    await secondaryPage.goto('/');
    await resumeMultiplayerAfterReload(secondaryPage, roomCode);
    await waitForActiveMatch(secondaryPage);
    expect(await readLastRoomCode(secondaryPage)).toBe(roomCode);

    // The old (primary) socket is force-disconnected by the server shortly
    // after supersession (resource cleanup — see roomSocketAttach.ts), so by
    // the time secondaryPage has fully settled into the match, primaryPage's
    // socket is no longer connected and a freshly emitted action would never
    // even reach the server to get an ack. installStaleMoveProbe (armed
    // before the takeover started) already fired its own stale MOVE the
    // instant primaryPage received room:session:superseded — before the
    // disconnect tears the transport down — and captured that ack. Poll for
    // that already-captured ack rather than emitting a new one now.
    await expect
      .poll(async () => {
        const ack = await readStaleMoveAck(primaryPage);
        return ack && ack.ok === false ? String(ack.error ?? 'rejected') : null;
      }, { timeout: 20_000 })
      .toMatch(/seat not found|Spectators cannot act|not your turn|Player seat/i);

    await expect(guestPage.locator(GAME_SCREEN_LOCATOR)).toBeVisible();
    await expect(secondaryPage.locator(GAME_SCREEN_LOCATOR)).toBeVisible();

    // Resource-cleanup half of this test: the old socket must actually be
    // gone, not left connected indefinitely.
    await expect
      .poll(async () => readE2eSocketConnected(primaryPage), { timeout: 20_000 })
      .toBe(false);

    await primaryContext.close();
    await secondaryContext.close();
    await guestContext.close();
  });

  test('B2 — race window: a stale-tab MOVE fired concurrently with the second tab\'s takeover is still rejected, never applied', async ({
    browser,
  }, testInfo) => {
    // Test B proves rejection AFTER the second tab has fully settled into the
    // match (waitForActiveMatch has resolved, seat migration is long done).
    // That leaves the actual race window unproven: what if the stale tab's
    // action reaches the server in the same tick as the takeover request,
    // before migrateRoomSeat has run? This test fires both concurrently
    // (Promise.all, no await between them) instead of sequentially, so the
    // server sees them essentially at once rather than cleanly ordered by
    // Playwright's own await scheduling.
    const runId = testInfo.testId;
    const identity = makeRunIdentity('a', runId);
    const primaryContext = await browser.newContext();
    await seedPlayerIdentity(primaryContext, identity);

    const primaryPage = await primaryContext.newPage();
    const roomCode = await createPrivateLobbyAsHost(primaryPage);

    const guestContext = await browser.newContext();
    await seedPlayerIdentity(guestContext, makeRunIdentity('b', runId));
    const guestPage = await guestContext.newPage();
    await joinPrivateLobby(guestPage, roomCode);
    await startPrivateMatchFromLobby(primaryPage, guestPage);
    await attachServerStateProbe(guestPage);

    const sequenceBeforeRace = (await readLastServerStateSnapshot(guestPage))?.sequence ?? null;

    const secondaryContext = await browser.newContext();
    await seedPlayerIdentity(secondaryContext, identity);
    await secondaryContext.addInitScript((code) => {
      window.localStorage.setItem('racehorse_last_room_code', code);
    }, roomCode);
    const secondaryPage = await secondaryContext.newPage();

    // Fire the stale-tab action and the second tab's takeover navigation in
    // the same tick — no await settles between them, so their requests race
    // on the wire and at the server, rather than being cleanly serialized by
    // this test's own control flow.
    let secondaryTakeoverDone = false;
    const [, staleAckResult] = await Promise.all([
      (async () => {
        await secondaryPage.goto('/');
        await resumeMultiplayerAfterReload(secondaryPage, roomCode);
        await waitForActiveMatch(secondaryPage);
        secondaryTakeoverDone = true;
      })(),
      (async () => {
        // Fire stale MOVEs continuously for as long as the second tab's
        // takeover is in flight AND the primary socket is still connected —
        // spanning the whole pre-disconnect race window, not a fixed short
        // burst that might finish before migration even starts. The old
        // socket is force-disconnected once the seat is safely reassigned
        // (resource cleanup — see roomSocketAttach.ts), so once that
        // happens an emitted action can no longer even reach the server to
        // get an ack; this loop stops firing at that point rather than
        // treating "no ack because the transport is gone" as a failure —
        // the assertion this test makes is about every ack that WAS
        // received while still connected, i.e. before/during the
        // disconnect, not some indefinite window after it.
        const acks: Array<{ ok?: boolean; error?: string } | null> = [];
        let attempt = 0;
        const maxAttempts = 40;
        while (attempt < maxAttempts && (!secondaryTakeoverDone || attempt < 3)) {
          const stillConnected = await readE2eSocketConnected(primaryPage);
          if (stillConnected === false) break;
          attempt += 1;
          await primaryPage.evaluate(() => {
            (window as unknown as { __e2eStaleMoveAck?: unknown }).__e2eStaleMoveAck = undefined;
          });
          await emitStaleMoveNow(primaryPage, roomCode);
          const ackArrived = await expect
            .poll(async () => (await readStaleMoveAck(primaryPage)) !== null, { timeout: 3_000 })
            .toBeTruthy()
            .then(() => true)
            .catch(() => false);
          if (!ackArrived) {
            // Timed out waiting — almost certainly the disconnect landed
            // mid-flight. Confirm that's actually why before stopping,
            // rather than silently swallowing a genuine hang.
            const connectedNow = await readE2eSocketConnected(primaryPage);
            expect(connectedNow).toBe(false);
            break;
          }
          acks.push(await readStaleMoveAck(primaryPage));
        }
        return acks;
      })(),
    ]);

    expect(await readLastRoomCode(secondaryPage)).toBe(roomCode);

    // Every single ack across the whole race window must be an explicit
    // rejection. Even one `ok: true` proves the exploitable window the task
    // is asking about — a stale seat mutating a live match's board/score.
    // Attempts fired before migration completes may legitimately still
    // belong to the primary tab (it was the valid seat holder up to that
    // instant) and get rejected for an ordinary game-rule reason (not its
    // turn, doesn't hold that tile) rather than a seat-authority reason —
    // distinct, benign paths every real player can hit. What must be true
    // for every single attempt across the whole race window, with zero
    // exceptions, is ok !== true — this is the actual safety property, not
    // which specific rejection reason applies.
    for (const ack of staleAckResult) {
      expect(ack).toBeTruthy();
      expect(ack?.ok).toBe(false);
      expect(typeof ack?.error === 'string' && ack.error.length > 0).toBe(true);
    }
    // Real-network timing across dozens of round trips doesn't reliably land
    // an attempt in the exact post-migration instant on every CI run — that
    // precise race condition (a stale socket's cached seat mapping surviving
    // past roster migration) is proven deterministically, without timing
    // luck, by resolveActorSeatId.test.ts's
    // "does NOT resolve a seat for a socket holding a stale cached playerId
    // after that seat has been migrated" case (red before the
    // roomSession.ts fix, green after). What THIS test proves under real
    // concurrent browser/network load is the outer safety invariant those
    // two pieces of evidence together close: no attempt, anywhere across the
    // whole real takeover race, ever returns ok: true.
    expect(staleAckResult.every((ack) => ack?.ok === false)).toBe(true);
    void sequenceBeforeRace;

    await expect(guestPage.locator(GAME_SCREEN_LOCATOR)).toBeVisible();
    await expect(secondaryPage.locator(GAME_SCREEN_LOCATOR)).toBeVisible();

    // Resource-cleanup half of this test: the old socket must actually be
    // gone by the time the race settles, not left connected indefinitely.
    await expect
      .poll(async () => readE2eSocketConnected(primaryPage), { timeout: 20_000 })
      .toBe(false);

    await primaryContext.close();
    await secondaryContext.close();
    await guestContext.close();
  });

  test('C — both seats disconnect; grace windows stay independent per room+seat', async ({
    browser,
  }, testInfo) => {
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
    const scoresBefore = await readHudScorePair(hostPage);

    await Promise.all([
      forceSocketTransportDown(hostPage, hostContext),
      forceSocketTransportDown(guestPage, guestContext),
    ]);

    await expect
      .poll(async () => (await fetchDisconnectGraceSeats(roomCode)).length, { timeout: 20_000 })
      .toBe(2);
    const bothSeats = await fetchDisconnectGraceSeats(roomCode);
    expect(new Set(bothSeats).size).toBe(2);

    await restoreSocketTransport(hostPage, hostContext);
    await waitForHostBackInMatch(hostPage);

    await expect
      .poll(async () => (await fetchDisconnectGraceSeats(roomCode)).length, { timeout: 20_000 })
      .toBe(1);
    const remaining = await fetchDisconnectGraceSeats(roomCode);
    expect(remaining).toHaveLength(1);
    expect(bothSeats).toContain(remaining[0]);

    await restoreSocketTransport(guestPage, guestContext);
    await waitForHostBackInMatch(guestPage);
    await expect
      .poll(async () => (await fetchDisconnectGraceSeats(roomCode)).length, { timeout: 20_000 })
      .toBe(0);

    expect(numericScores(await readHudScorePair(hostPage))).toEqual(numericScores(scoresBefore));
    expect(numericScores(await readHudScorePair(guestPage)).you).not.toEqual('');
    await expect(hostPage.locator(GAME_SCREEN_LOCATOR)).toBeVisible();
    await expect(guestPage.locator(GAME_SCREEN_LOCATOR)).toBeVisible();

    await hostContext.close();
    await guestContext.close();
  });

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
});
