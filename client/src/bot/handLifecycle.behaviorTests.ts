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
}

async function run(): Promise<void> {
  testCanApplyNextHand();
  testLifecyclePhaseAdvancesOnLog();
  await testResolveDailyFritzNextHandCache();
  console.log('handLifecycle.behaviorTests.ts: all passed');
}

void run();
