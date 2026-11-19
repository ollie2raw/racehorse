/**
 * AUDIT 2026-11-17 (docs/audit-parts/C-review-sweep.md): reproductions of defects in the review sweep's live-play yield (#515).
 * Each `it.fails` asserts the behavior we WANT; it is marked `.fails` because today's code does not do it, so the suite stays
 * green while documenting the defect. When a fix lands, vitest will report the `.fails` test as unexpectedly passing:
 * flip it to a plain `it`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVIEW_FIXTURE_CORPUS } from '../../../packages/game-core/src/reviewFixtureCorpus';
import { adaptiveEvaluateReviewPosition } from '../../../packages/review-engine/src/adaptiveEvaluateReviewPosition';
import { createReviewCompletionJob, InMemoryCheckpointStore } from '../../../packages/review-engine/src/durableReviewCompletionRuntime';
import {
  REVIEW_YIELD_CONFIG,
  resetReviewYieldForTests,
  reviewYieldDecision,
  setReviewLiveRoomProbe,
  setReviewYieldSleepForTests,
  shouldDeferClaims,
} from './reviewLivePlayYield';
import {
  setReviewCompletionStoreForTests,
  setReviewPositionEvaluatorForTests,
  sweepReviewCompletionJobs,
} from './reviewCompletionWorker';
import { closeProcessAdmission, resetProcessLifecycleForTests } from '../platform/processLifecycle';

const POLICY = { maxAttempts: 5, backoffMs: (n: number) => 30_000 * 2 ** (n - 1) };
const MIN = 60_000;
const fastEval: typeof adaptiveEvaluateReviewPosition = (snapshot, options) =>
  adaptiveEvaluateReviewPosition(snapshot, { ...options, maxTier: 1 });

async function seed(store: InMemoryCheckpointStore, digest: string, count: number) {
  const job = createReviewCompletionJob({
    gameDigest: digest,
    sourceMatchId: `m-${digest}`,
    userId: 'audit-user',
    snapshots: REVIEW_FIXTURE_CORPUS.slice(0, count).map((f) => f.snapshot),
    now: Date.now() - 1_000,
  });
  await store.put(job);
  return job;
}

beforeEach(() => resetReviewYieldForTests());
afterEach(() => {
  setReviewPositionEvaluatorForTests(null);
  resetReviewYieldForTests();
  resetProcessLifecycleForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AUDIT C1: the starvation slice can be phase-locked away from the 15 s claim tick', () => {
  it.fails('a QUEUED job gets at least one claim opportunity within 2 hours of continuous live play', () => {
    setReviewLiveRoomProbe(() => 1);
    // The player waiting for the review polls the job every 5 s (client REVIEW_POLL_MAX_MS); the poll handler calls
    // reviewYieldDecision(now), so the FIRST live observation (which starts the 10-minute clock) is a poll at t = 7 s.
    // Claims are only attempted by the periodic sweep tick (REVIEW_COMPLETION_SWEEP_INTERVAL_MS = 15 s).
    const TICK = 15_000;
    let claimOpportunities = 0;
    const events: Array<{ t: number; kind: 'poll' | 'tick' }> = [];
    for (let t = 7_000; t < 120 * MIN; t += 5_000) events.push({ t, kind: 'poll' });
    for (let t = TICK; t < 120 * MIN; t += TICK) events.push({ t, kind: 'tick' });
    events.sort((a, b) => a.t - b.t || (a.kind === 'poll' ? -1 : 1));
    for (const e of events) {
      if (e.kind === 'poll') reviewYieldDecision(e.t);
      else if (!shouldDeferClaims(e.t)) claimOpportunities += 1;
    }
    // Starvation guard promise (#515): after 10 min the gate opens 5 s of every 60 s. 110 minutes of slices = ~110 openings.
    expect(claimOpportunities).toBeGreaterThan(0);
  });

  it('control: when the 10-minute clock is started by a tick itself, ticks DO land in slices (why the PR tests pass)', () => {
    setReviewLiveRoomProbe(() => 1);
    let claimOpportunities = 0;
    for (let t = 15_000; t < 30 * MIN; t += 15_000) if (!shouldDeferClaims(t)) claimOpportunities += 1;
    expect(claimOpportunities).toBeGreaterThan(0);
    expect(REVIEW_YIELD_CONFIG.sliceOnMs).toBeLessThan(15_000);
  });
});

describe('AUDIT C2: a decision released from a hold because the lease was lost still runs a full search', () => {
  it.fails('after the heartbeat reports the lease lost during a hold, no further position is evaluated', async () => {
    const store = new InMemoryCheckpointStore(POLICY);
    // The renewal is fenced and fails: some other claimant holds the job now (or the row was reset).
    store.renewLease = async () => false;
    setReviewCompletionStoreForTests(store);
    await seed(store, 'audit-lease-lost-hold', 2);

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let live = 0;
    setReviewLiveRoomProbe(() => live);
    let evaluations = 0;
    setReviewPositionEvaluatorForTests(async (snapshot, options) => {
      evaluations += 1;
      if (evaluations === 1) live = 1; // a game starts while decision 1 runs; decision 2 will be held
      return fastEval(snapshot, options);
    });
    // Each 1 s hold poll lets 20 s of interval time pass, so the 20 s lease heartbeat fires and learns the lease is lost.
    setReviewYieldSleepForTests(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
      await new Promise((resolve) => setImmediate(resolve));
    });

    await sweepReviewCompletionJobs();

    // Desired: the hold notices the lost lease and the pass stops; today the hold returns and evaluate() runs anyway
    // (ReviewSearchRunner strips shouldAbort before posting to the worker, reviewSearchRunner.ts:134), so in production a
    // search of up to 180 s runs on a lease nobody holds, during live play.
    expect(evaluations).toBe(1);
  });
});

describe('AUDIT C3: a review pass keeps evaluating after shutdown begins (pre-existing; #515 shouldStop releases into it)', () => {
  it.fails('once process admission closes, the running pass evaluates no further decisions', async () => {
    const store = new InMemoryCheckpointStore(POLICY);
    setReviewCompletionStoreForTests(store);
    await seed(store, 'audit-shutdown', 3);
    let evaluations = 0;
    setReviewPositionEvaluatorForTests(async (snapshot, options) => {
      evaluations += 1;
      if (evaluations === 1) closeProcessAdmission(); // SIGTERM arrives during decision 1
      return fastEval(snapshot, options);
    });

    await sweepReviewCompletionJobs();

    // Desired: 1. Today all 3 run: runReviewCompletionPass only checks shouldAbort (= lease lost), never isProcessClosing,
    // and the yield hold exits immediately on isProcessClosing, so the remaining decisions run back to back.
    expect(evaluations).toBe(1);
  });
});
