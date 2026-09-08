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
  readServerStateLog,
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

  test('B2 — race window: a stale-tab MOVE fired concurrently with the second tab\'s takeover never mutates authoritative state after migration', async ({
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
    //
    // What this asserts, and why it is POST-migration only: see the long
    // comment on the invariant block near the end of the test.
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
    // Attach the authoritative-state probe BEFORE the match starts (as test A
    // does) so it captures the match-start `state:update` broadcast — the probe
    // only records events fired after its listener is attached, and no further
    // broadcast happens until the race.
    await attachServerStateProbe(guestPage);
    await startPrivateMatchFromLobby(primaryPage, guestPage);

    // Confirm the probe is actually receiving broadcasts before starting the
    // race, so the post-migration comparison below has real data.
    await expect
      .poll(async () => (await readLastServerStateSnapshot(guestPage))?.sequence ?? null, {
        timeout: 30_000,
      })
      .not.toBeNull();

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
    const [, staleRace] = await Promise.all([
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
        return { acks, attempts: attempt };
      })(),
    ]);

    expect(await readLastRoomCode(secondaryPage)).toBe(roomCode);
    await expect(guestPage.locator(GAME_SCREEN_LOCATOR)).toBeVisible();
    await expect(secondaryPage.locator(GAME_SCREEN_LOCATOR)).toBeVisible();

    // The race must actually have fired stale actions from the superseded
    // socket, or the invariant below is vacuous.
    expect(
      staleRace.attempts,
      'B2 fired zero stale actions — the race window collapsed before any MOVE was emitted',
    ).toBeGreaterThanOrEqual(1);

    // Fence: the old socket must be force-disconnected after supersession
    // (resource cleanup — roomSocketAttach.ts). Once it is, seat migration is
    // unambiguously complete and the old socket is neutralised.
    await expect
      .poll(async () => readE2eSocketConnected(primaryPage), { timeout: 20_000 })
      .toBe(false);

    // ── The invariant ──────────────────────────────────────────────────────
    //
    // WHY this asserts the POST-migration window ONLY, and never the
    // pre-migration one — do not "fix" this back to checking the whole race:
    //
    // The stale probe fires MOVE { tile: [0|0], position: 'left' }. BEFORE the
    // seat migrates, the primary socket is still the legitimate seat holder.
    // If it is that player's turn on an empty board and they happen to hold
    // [0|0] (~1 in 4 with a 7-tile hand from a double-six set), that early
    // "stale" MOVE is a perfectly legal move by the real player: the server
    // accepts it (ack.ok: true) and the board grows by a tile. That is not a
    // bug. Asserting "every ack across the race is a rejection" or "board
    // unchanged across the whole race" trips on this on ~25% of runs — it was
    // the original flake in this test.
    //
    // Only AFTER migration is the old socket definitively unauthorised, and
    // that is where "no stale action mutates authoritative state" is both true
    // and deterministic (neither real player is acting; the old socket is
    // disconnected; and resolveActorSeatId.test.ts proves the seat-mapping
    // side without timing luck). So: take the settled post-migration state,
    // fire more stale MOVEs at it, and require the state to be frozen.
    const settleForPostMigration = async () => {
      // Match is not progressing (both players idle) — a short settle is enough
      // for any in-flight state:update to land.
      await guestPage.waitForTimeout(2_000);
      const snap = await readLastServerStateSnapshot(guestPage);
      expect(snap, 'guest authoritative-state probe captured nothing post-migration').not.toBeNull();
      return snap!;
    };
    const settledPostMigration = await settleForPostMigration();
    const logLenAtSettle = (await readServerStateLog(guestPage)).length;

    // Best-effort: fire more stale MOVEs now that the seat has migrated. The
    // old socket is disconnected so these usually get no ack at all — that is
    // the safety property working (a neutralised socket cannot reach the
    // server). Any ack that DOES come back must not be an acceptance.
    const postMigrationAcks: Array<{ ok?: boolean; error?: string } | null> = [];
    for (let i = 0; i < 5; i += 1) {
      await primaryPage.evaluate(() => {
        (window as unknown as { __e2eStaleMoveAck?: unknown }).__e2eStaleMoveAck = undefined;
      });
      await emitStaleMoveNow(primaryPage, roomCode).catch(() => undefined);
      await primaryPage.waitForTimeout(300);
      postMigrationAcks.push(await readStaleMoveAck(primaryPage));
    }

    testInfo.annotations.push({
      type: 'b2-stale',
      description: JSON.stringify({
        attempts: staleRace.attempts,
        raceAcks: staleRace.acks,
        postMigrationAcks,
      }),
    });

    expect(
      postMigrationAcks.some((ack) => ack?.ok === true),
      'a stale-socket MOVE was ACCEPTED after seat migration — seat authority is broken',
    ).toBe(false);

    // Authoritative state is frozen against the post-migration stale actions:
    // the board did not grow, scores did not move, the turn did not change —
    // not at the end, and not transiently at any intermediate snapshot.
    const finalState = await readLastServerStateSnapshot(guestPage);
    const logSinceSettle = (await readServerStateLog(guestPage)).slice(logLenAtSettle - 1);
    expect(finalState?.boardLen).toBe(settledPostMigration.boardLen);
    expect(finalState?.scores).toEqual(settledPostMigration.scores);
    expect(finalState?.currentPlayerIndex).toBe(settledPostMigration.currentPlayerIndex);
    expect(
      Math.max(settledPostMigration.boardLen ?? 0, ...logSinceSettle.map((s) => s.boardLen ?? 0)),
      'a stale MOVE grew the authoritative board after migration (even if later reverted)',
    ).toBe(settledPostMigration.boardLen ?? 0);

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
