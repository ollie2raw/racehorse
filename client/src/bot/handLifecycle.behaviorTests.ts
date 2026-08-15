import {
  canApplyNextHand,
  DAILY_FRITZ_HAND_AUTO_ADVANCE_MS,
  DAILY_FRITZ_HAND_REVEAL_DELAY_MS,
  getDailyFritzWatchdogDelayMs,
  getHandLifecyclePhase,
  isChallengeHandOnlyGameOver,
  isDailyFritzAdvanceLocked,
  isDailyFritzSetTerminal,
  logHandLifecycle,
  resetHandLifecyclePhase,
  resolveDailyFritzNextHandCache,
  resolveHandRevealScheduleMode,
  shouldAllowBotAction,
  shouldApplyBotActionResult,
  shouldDailyFritzWatchdogAdvance,
  shouldShowHandRevealForHand,
} from './handLifecycle.ts';

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
}

function testCanApplyNextHand(): void {
  assertEqual(canApplyNextHand({ handOver: true, gameOver: false }), true, 'handOver only');
  assertEqual(canApplyNextHand({ handOver: false, gameOver: false }), false, 'active hand');
  assertEqual(canApplyNextHand({ handOver: true, gameOver: true }), false, 'game over');
}

function testLifecyclePhaseAdvancesOnLog(): void {
  resetHandLifecyclePhase();
  assertEqual(getHandLifecyclePhase(), 'playing', 'initial phase');
  logHandLifecycle({ phase: 'showing-hand-result', handNumber: 1 });
  assertEqual(getHandLifecyclePhase(), 'showing-hand-result', 'after reveal');
}

function testDailyFritzAdvanceLockWindow(): void {
  const minAdvanceAt = 10_000;
  assertEqual(
    isDailyFritzAdvanceLocked(minAdvanceAt, 9_999),
    true,
    'daily fritz guard stays locked before reveal window ends',
  );
  assertEqual(
    isDailyFritzAdvanceLocked(minAdvanceAt, 10_000),
    false,
    'daily fritz guard unlocks exactly at min-advance gate',
  );
  assertEqual(
    isDailyFritzAdvanceLocked(null, 9_000),
    false,
    'daily fritz guard does not block without a gate',
  );
}

function testShouldAllowBotAction(): void {
  assertEqual(
    shouldAllowBotAction({ currentPlayer: 'bot', handOver: false, gameOver: false }),
    true,
    'bot turn active hand',
  );
  assertEqual(
    shouldAllowBotAction({ currentPlayer: 'bot', handOver: true, gameOver: false }),
    false,
    'bot ignored when hand over',
  );
  assertEqual(
    shouldAllowBotAction({ currentPlayer: 'bot', handOver: false, gameOver: true }),
    false,
    'bot ignored when game over',
  );
  assertEqual(
    shouldAllowBotAction({ currentPlayer: 'you', handOver: false, gameOver: false }),
    false,
    'bot ignored on player turn',
  );
}

function testShouldApplyBotActionResult(): void {
  assertEqual(
    shouldApplyBotActionResult(
      { handOver: true, gameOver: false },
      { state: { handOver: false, gameOver: false } },
    ),
    false,
    'stale play after hand over without handEnded',
  );
  assertEqual(
    shouldApplyBotActionResult(
      { handOver: false, gameOver: true },
      { state: { handOver: false, gameOver: false } },
    ),
    false,
    'stale play after game over',
  );
  assertEqual(
    shouldApplyBotActionResult(
      { handOver: false, gameOver: false },
      {
        handEnded: { winner: 'you' },
        state: { handOver: true, gameOver: false },
      },
    ),
    true,
    'hand-ending move still applies',
  );
}

function testDailyFritzSetTerminal(): void {
  assertEqual(isDailyFritzSetTerminal(null), false, 'no set');
  assertEqual(isDailyFritzSetTerminal({ setWinner: 'player' }), true, 'set won');
  assertEqual(isDailyFritzSetTerminal({ setWinner: null }), false, 'live set');
}

function testChallengeHandOnlyGameOver(): void {
  assertEqual(
    isChallengeHandOnlyGameOver({ gameOver: true, youScore: 15, botScore: 8, winningScore: 60 }),
    true,
    'challenge hand end below game target remains a hand transition',
  );
  assertEqual(
    isChallengeHandOnlyGameOver({ gameOver: true, youScore: 60, botScore: 8, winningScore: 60 }),
    false,
    'challenge game target remains terminal',
  );
  assertEqual(
    isChallengeHandOnlyGameOver({ gameOver: true, youScore: 15, botScore: 8, winningScore: null }),
    false,
    'ordinary daily Fritz does not reinterpret game over',
  );
}

function testShouldShowHandRevealForHand(): void {
  assertEqual(shouldShowHandRevealForHand(2, 2), true, 'same hand');
  assertEqual(shouldShowHandRevealForHand(3, 2), false, 'stale reveal timer');
}

function testHandRevealScheduleMode(): void {
  assertEqual(resolveHandRevealScheduleMode(true), 'delayed', 'daily fritz delayed reveal');
  assertEqual(resolveHandRevealScheduleMode(false), 'delayed', 'non-daily delayed reveal');
  assertEqual(DAILY_FRITZ_HAND_REVEAL_DELAY_MS, 2000, 'hand-over waits 2s after last tile');
}

function testDailyFritzWatchdogGuards(): void {
  assertEqual(
    getDailyFritzWatchdogDelayMs(false),
    DAILY_FRITZ_HAND_REVEAL_DELAY_MS + 3000,
    'watchdog waits for reveal when hidden',
  );
  assertEqual(
    getDailyFritzWatchdogDelayMs(true),
    DAILY_FRITZ_HAND_AUTO_ADVANCE_MS + 4000,
    'watchdog waits through countdown when visible',
  );
  assertEqual(
    shouldDailyFritzWatchdogAdvance({
      handOver: true,
      gameOver: false,
      handRevealVisible: false,
      minAdvanceAt: null,
      nowMs: 1000,
    }),
    false,
    'watchdog cannot skip missing reveal',
  );
  assertEqual(
    shouldDailyFritzWatchdogAdvance({
      handOver: true,
      gameOver: false,
      handRevealVisible: true,
      minAdvanceAt: 20_000,
      nowMs: 10_000,
    }),
    false,
    'watchdog respects min-advance gate',
  );
  assertEqual(
    shouldDailyFritzWatchdogAdvance({
      handOver: true,
      gameOver: false,
      handRevealVisible: true,
      minAdvanceAt: 10_000,
      nowMs: 10_000,
    }),
    true,
    'watchdog may advance after reveal gate',
  );
  assertEqual(
    shouldDailyFritzWatchdogAdvance({
      handOver: true,
      gameOver: true,
      challengeHandOnlyGameOver: true,
      handRevealVisible: true,
      minAdvanceAt: 10_000,
      nowMs: 10_000,
    }),
    true,
    'challenge watchdog advances a hand marked game over below the game target',
  );
}

async function testResolveDailyFritzNextHandCache(): Promise<void> {
  let created = 0;
  const create = async () => {
    created += 1;
    return { index: 2 };
  };
  const settled = await resolveDailyFritzNextHandCache(
    { promise: Promise.resolve({ index: 1 }), result: { index: 1 }, error: null, startedAt: 0 },
    create,
  );
  assertEqual(settled, { index: 1 }, 'prefers settled result');
  assertEqual(created, 0, 'no create when cached result');

  const inflight = await resolveDailyFritzNextHandCache(
    { promise: Promise.resolve({ index: 3 }), result: null, error: null, startedAt: 0 },
    create,
  );
  assertEqual(inflight, { index: 3 }, 'awaits inflight promise');
  assertEqual(created, 0, 'no create when inflight');

  const fresh = await resolveDailyFritzNextHandCache(null, create);
  assertEqual(fresh, { index: 2 }, 'creates when empty cache');
  assertEqual(created, 1, 'create called once');

  // Failed prefetch: stale rejected promise must not block a retrying fetch.
  let retryCreated = 0;
  const createRetry = async () => {
    retryCreated += 1;
    return { index: 99 };
  };
  const rejectedNet = Promise.reject(new Error('network'));
  void rejectedNet.catch((_expectedNetworkError) => undefined);
  const failedPrefetch = await resolveDailyFritzNextHandCache(
    {
      promise: rejectedNet,
      result: null,
      error: new Error('network'),
      startedAt: 0,
    },
    createRetry,
  );
  assertEqual(failedPrefetch, { index: 99 }, 'after prefetch failure, createRequest runs');
  assertEqual(retryCreated, 1, 'createRequest after failed prefetch');

  let afterThrowCreated = 0;
  const createAfterThrow = async () => {
    afterThrowCreated += 1;
    return { index: 7 };
  };
  const rejectedBoom = Promise.reject(new Error('boom'));
  void rejectedBoom.catch((_expectedLifecycleError) => undefined);
  const afterThrow = await resolveDailyFritzNextHandCache(
    {
      promise: rejectedBoom,
      result: null,
      error: null,
      startedAt: 0,
    },
    createAfterThrow,
  );
  assertEqual(afterThrow, { index: 7 }, 'rejected promise without error flag still falls back');
  assertEqual(afterThrowCreated, 1, 'createRequest after await rejection');
}

async function run(): Promise<void> {
  testCanApplyNextHand();
  testShouldAllowBotAction();
  testShouldApplyBotActionResult();
  testDailyFritzSetTerminal();
  testChallengeHandOnlyGameOver();
  testShouldShowHandRevealForHand();
  testHandRevealScheduleMode();
  testDailyFritzWatchdogGuards();
  testLifecyclePhaseAdvancesOnLog();
  testDailyFritzAdvanceLockWindow();
  await testResolveDailyFritzNextHandCache();
  console.log('handLifecycle.behaviorTests.ts: all passed');
}

void run();
