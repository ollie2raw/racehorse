import {
  canApplyNextHand,
  getHandLifecyclePhase,
  logHandLifecycle,
  resetHandLifecyclePhase,
  resolveDailyFritzNextHandCache,
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
  void rejectedNet.catch(() => {});
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
  void rejectedBoom.catch(() => {});
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
  testLifecyclePhaseAdvancesOnLog();
  await testResolveDailyFritzNextHandCache();
  console.log('handLifecycle.behaviorTests.ts: all passed');
}

void run();
