import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { REVIEW_FIXTURE_CORPUS } from '../../../packages/game-core/src/reviewFixtureCorpus';
import { adaptiveEvaluateReviewPosition } from '../../../packages/review-engine/src/adaptiveEvaluateReviewPosition';
import { createReviewCompletionJob, InMemoryCheckpointStore } from '../../../packages/review-engine/src/durableReviewCompletionRuntime';
import { ENV_SPECS } from '../envSchema';
import { createLiveRoomProbe, type LiveRoomView } from './liveRoomProbe';
import {
  REVIEW_YIELD_CONFIG,
  configureReviewYieldForTests,
  getReviewYieldStatus,
  resetReviewYieldForTests,
  reviewYieldDecision,
  setReviewLagSourceForTests,
  setReviewLiveRoomProbe,
  setReviewYieldSleepForTests,
  shouldDeferClaims,
  waitForReviewSlot,
} from './reviewLivePlayYield';
import {
  registerReviewCompletionJobsRoute,
  setReviewCompletionStoreForTests,
  setReviewPositionEvaluatorForTests,
  sweepReviewCompletionJobs,
} from './reviewCompletionWorker';

vi.mock('../platform/auth/supabaseAuth', () => ({ getAuthenticatedUserId: async () => 'yield-user' }));

const POLICY = { maxAttempts: 5, backoffMs: (n: number) => 30_000 * 2 ** (n - 1) };
const MIN = 60_000;

const fastEval: typeof adaptiveEvaluateReviewPosition = (snapshot, options) =>
  adaptiveEvaluateReviewPosition(snapshot, { ...options, maxTier: 1 });

async function seed(store: InMemoryCheckpointStore, digest: string, count = 2) {
  const job = createReviewCompletionJob({
    gameDigest: digest,
    sourceMatchId: `m-${digest}`,
    userId: 'yield-user',
    snapshots: REVIEW_FIXTURE_CORPUS.slice(0, count).map((f) => f.snapshot),
    now: Date.now() - 1_000,
  });
  await store.put(job);
  return job;
}

beforeEach(() => {
  resetReviewYieldForTests();
});

afterEach(() => {
  setReviewPositionEvaluatorForTests(null);
  resetReviewYieldForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('what counts as live play', () => {
  const NOW = Date.parse('2026-11-15T12:00:00Z');
  const room = (over: Partial<LiveRoomView> = {}): LiveRoomView => ({
    state: { gameOver: false },
    events: [{ timestamp: new Date(NOW - 5_000).toISOString() }],
    lastHandEndedAtMs: null,
    ...over,
  });
  const probe = (rooms: Record<string, LiveRoomView>, sockets: Record<string, number>) =>
    createLiveRoomProbe({
      roomCodes: () => Object.keys(rooms),
      peekRoom: (code) => rooms[code],
      connectedSockets: (code) => sockets[code] ?? 0,
      activityWindowMs: REVIEW_YIELD_CONFIG.activityWindowMs,
    })(NOW);

  it('counts a started match with a connected player and a recent event', () => {
    expect(probe({ A: room() }, { A: 2 })).toBe(1);
  });

  it('does not count stored rooms nobody is connected to, finished or abandoned matches, unstarted rooms, or stale ones', () => {
    expect(probe({ A: room() }, { A: 0 })).toBe(0);
    expect(probe({ A: room({ state: { gameOver: true } }) }, { A: 2 })).toBe(0);
    expect(probe({ A: room({ abandonedAt: '2026-11-15T11:59:00Z' }) }, { A: 2 })).toBe(0);
    expect(probe({ A: room({ state: null }) }, { A: 2 })).toBe(0);
    expect(probe({ A: room({ events: [{ timestamp: new Date(NOW - 5 * MIN).toISOString() }] }) }, { A: 2 })).toBe(0);
  });

  it('a hand that just ended keeps the room live while players read the result', () => {
    expect(probe({ A: room({ events: [], lastHandEndedAtMs: NOW - 10_000 }) }, { A: 2 })).toBe(1);
  });
});

describe('the gate', () => {
  it('yields while a room is live, and says why', () => {
    setReviewLiveRoomProbe(() => 1);
    expect(reviewYieldDecision(1_000)).toMatchObject({ allowed: false, reason: 'live_rooms', liveRooms: 1 });
    expect(shouldDeferClaims(2_000)).toBe(true);
  });

  it('resumes the moment the room goes quiet', () => {
    let live = 1;
    setReviewLiveRoomProbe(() => live);
    expect(reviewYieldDecision(1_000).allowed).toBe(false);
    live = 0;
    expect(reviewYieldDecision(2_000)).toMatchObject({ allowed: true, reason: 'idle' });
  });

  it('yields on event-loop lag over the threshold even with no live room', () => {
    let lag = REVIEW_YIELD_CONFIG.lagThresholdMs + 1;
    setReviewLagSourceForTests(() => lag);
    expect(reviewYieldDecision(1_000)).toMatchObject({ allowed: false, reason: 'event_loop_lag' });
    lag = REVIEW_YIELD_CONFIG.lagThresholdMs;
    expect(reviewYieldDecision(2_000).allowed).toBe(true);
  });

  it('fails open: a probe that throws is no live play', () => {
    setReviewLiveRoomProbe(() => { throw new Error('probe broke'); });
    expect(reviewYieldDecision(1_000)).toMatchObject({ allowed: true, reason: 'idle' });
  });

  it('is off when REVIEW_YIELD_TO_LIVE_PLAY_ENABLED is exactly "false", and on for anything else', () => {
    setReviewLiveRoomProbe(() => 3);
    vi.stubEnv('REVIEW_YIELD_TO_LIVE_PLAY_ENABLED', 'false');
    expect(reviewYieldDecision(1_000)).toMatchObject({ allowed: true, reason: 'disabled' });
    for (const value of ['', '0', 'FALSE', 'true', 'off']) {
      vi.stubEnv('REVIEW_YIELD_TO_LIVE_PLAY_ENABLED', value);
      expect(reviewYieldDecision(2_000).allowed).toBe(false);
    }
    expect(ENV_SPECS.some((spec) => spec.name === 'REVIEW_YIELD_TO_LIVE_PLAY_ENABLED')).toBe(true);
  });
});

describe('the starvation guard', () => {
  it('after 10 minutes of continuous live play it opens for 5 s out of every 60 s, and closes again in between', () => {
    setReviewLiveRoomProbe(() => 1);
    const { starvationAfterMs, sliceOnMs, slicePeriodMs } = REVIEW_YIELD_CONFIG;
    expect(starvationAfterMs).toBe(10 * MIN);
    expect(sliceOnMs).toBe(5_000);
    expect(slicePeriodMs).toBe(MIN);
    // Observe every second, as a held decision does.
    const at = (t: number) => reviewYieldDecision(t);
    let t = 0;
    for (; t < starvationAfterMs; t += 1_000) expect(at(t).allowed).toBe(false);
    // Slice 0 opens at exactly the starvation point.
    expect(at(starvationAfterMs)).toMatchObject({ allowed: true, reason: 'starvation_slice' });
    expect(at(starvationAfterMs + sliceOnMs - 1_000).allowed).toBe(true);
    expect(at(starvationAfterMs + sliceOnMs).allowed).toBe(false);
    // Held decisions look every second, so the stretch stays continuous through the closed part of the minute.
    for (let gap = sliceOnMs + 1_000; gap < slicePeriodMs; gap += 1_000) expect(at(starvationAfterMs + gap).allowed).toBe(false);
    // The next slice.
    expect(at(starvationAfterMs + slicePeriodMs).allowed).toBe(true);
    expect(getReviewYieldStatus(starvationAfterMs + slicePeriodMs).starvationSlices).toBe(2);
  });

  it('over a long game the open time is about 8% (5 s of every 60 s) once starvation starts', () => {
    setReviewLiveRoomProbe(() => 1);
    let open = 0;
    const total = 30 * MIN;
    for (let t = 0; t < total; t += 1_000) if (reviewYieldDecision(t).allowed) open += 1_000;
    const afterStarvation = total - REVIEW_YIELD_CONFIG.starvationAfterMs;
    expect(open / afterStarvation).toBeCloseTo(REVIEW_YIELD_CONFIG.sliceOnMs / REVIEW_YIELD_CONFIG.slicePeriodMs, 2);
  });

  it('a hold caused only by event-loop lag (no live room) is bounded too: reviews cannot be blocked indefinitely on a lagging server', () => {
    setReviewLiveRoomProbe(() => 0);
    setReviewLagSourceForTests(() => 5_000); // permanently lagging, nobody playing
    const { starvationAfterMs } = REVIEW_YIELD_CONFIG;
    for (let t = 0; t < starvationAfterMs; t += 1_000) expect(reviewYieldDecision(t)).toMatchObject({ allowed: false, reason: 'event_loop_lag' });
    expect(reviewYieldDecision(starvationAfterMs)).toMatchObject({ allowed: true, reason: 'starvation_slice' });
  });

  it('a held decision on a permanently lagging server is released after the starvation point (the real wait loop, simulated clock)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    setReviewLiveRoomProbe(() => 0);
    setReviewLagSourceForTests(() => 5_000);
    let polls = 0;
    setReviewYieldSleepForTests(async (ms) => { polls += 1; vi.setSystemTime(Date.now() + ms); });

    await waitForReviewSlot();

    expect(Date.now()).toBe(REVIEW_YIELD_CONFIG.starvationAfterMs);
    expect(polls).toBe(REVIEW_YIELD_CONFIG.starvationAfterMs / REVIEW_YIELD_CONFIG.pollMs);
  });

  it('a quiet moment resets it: the 10 minutes start over', () => {
    let live = 1;
    setReviewLiveRoomProbe(() => live);
    for (let t = 0; t < 9 * MIN; t += 1_000) reviewYieldDecision(t);
    live = 0;
    expect(reviewYieldDecision(9 * MIN).allowed).toBe(true);
    live = 1;
    expect(reviewYieldDecision(9 * MIN + 1_000).allowed).toBe(false);
    // Eleven minutes after the first sighting, but only two since the quiet moment: still held.
    for (let t = 9 * MIN + 2_000; t < 11 * MIN; t += 1_000) expect(reviewYieldDecision(t).allowed).toBe(false);
  });

  it('a long gap with nobody asking does not count as continuous live play', () => {
    setReviewLiveRoomProbe(() => 1);
    reviewYieldDecision(0);
    // Nothing asked for an hour (no review jobs): the next sighting starts a fresh stretch rather than starving at once.
    expect(reviewYieldDecision(60 * MIN).allowed).toBe(false);
  });
});

describe('a held decision', () => {
  it('holds while live, resumes when idle, and stops holding when told to stop', async () => {
    let live = 1;
    setReviewLiveRoomProbe(() => live);
    let slept = 0;
    setReviewYieldSleepForTests(async () => {
      slept += 1;
      if (slept === 3) live = 0;
    });
    await waitForReviewSlot();
    expect(slept).toBe(3);
    expect(getReviewYieldStatus()).toMatchObject({ decisionsHeld: 1 });

    live = 1;
    let stop = false;
    setReviewYieldSleepForTests(async () => { stop = true; });
    await waitForReviewSlot({ shouldStop: () => stop });
  });
});

describe('the sweep', { timeout: 60_000 }, () => {
  it('claims nothing while a game is live: the job is untouched and no attempt is burned', async () => {
    const store = new InMemoryCheckpointStore(POLICY);
    setReviewCompletionStoreForTests(store);
    const job = await seed(store, 'live-no-claim');
    const claim = vi.spyOn(store, 'claim');
    let evaluations = 0;
    setReviewPositionEvaluatorForTests(async (snapshot, options) => { evaluations += 1; return fastEval(snapshot, options); });
    setReviewLiveRoomProbe(() => 1);

    for (let i = 0; i < 5; i += 1) expect(await sweepReviewCompletionJobs()).toMatchObject({ ran: 0, yielded: true });

    expect(claim).not.toHaveBeenCalled();
    expect(evaluations).toBe(0);
    const stored = await store.get(job.jobId);
    expect(stored).toMatchObject({ status: 'pending', claimToken: null });
    expect(stored?.attemptCount ?? 0).toBe(0);
    expect(getReviewYieldStatus().claimsDeferred).toBeGreaterThanOrEqual(5);
  });

  it('runs the queued job to completion once the room goes quiet, on its first attempt', async () => {
    const store = new InMemoryCheckpointStore(POLICY);
    setReviewCompletionStoreForTests(store);
    const job = await seed(store, 'resume-after-idle');
    setReviewPositionEvaluatorForTests(async (snapshot, options) => fastEval(snapshot, options));
    let live = 1;
    setReviewLiveRoomProbe(() => live);

    expect(await sweepReviewCompletionJobs()).toMatchObject({ ran: 0, yielded: true });
    live = 0;
    const result = await sweepReviewCompletionJobs();

    expect(result).toMatchObject({ ran: 1, completed: 1 });
    expect(await store.get(job.jobId)).toMatchObject({ status: 'complete', attemptCount: 1 });
  });

  it('a job already running holds before its next decision and finishes on the SAME claim: no abort, no extra attempt, lease kept', async () => {
    const store = new InMemoryCheckpointStore(POLICY);
    setReviewCompletionStoreForTests(store);
    const job = await seed(store, 'hold-midjob', 2);
    const claim = vi.spyOn(store, 'claim');
    const evaluated: string[] = [];
    let live = 0;
    setReviewLiveRoomProbe(() => live);
    let held = 0;
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    setReviewYieldSleepForTests(async () => {
      held += 1;
      await released;
    });
    setReviewPositionEvaluatorForTests(async (snapshot, options) => {
      evaluated.push(snapshot.identifiers.decisionId);
      // A game starts after the first decision has been evaluated.
      if (evaluated.length === 1) live = 1;
      return fastEval(snapshot, options);
    });

    const sweep = sweepReviewCompletionJobs();
    await vi.waitFor(() => expect(held).toBeGreaterThanOrEqual(1));
    // Held: one decision done, the others not started, the job still claimed by the running pass.
    expect(evaluated).toHaveLength(1);
    const mid = await store.get(job.jobId);
    expect(mid).toMatchObject({ status: 'running', attemptCount: 1 });
    expect(mid?.claimToken).toBeTruthy();
    expect(mid?.leaseExpiresAt ?? 0).toBeGreaterThan(Date.now());

    live = 0;
    release();
    const result = await sweep;

    expect(result).toMatchObject({ ran: 1, completed: 1 });
    expect(evaluated).toHaveLength(2);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(await store.get(job.jobId)).toMatchObject({ status: 'complete', attemptCount: 1 });
  });

  it('does not claim the next job in the same round if a game starts while the first one runs', async () => {
    const store = new InMemoryCheckpointStore(POLICY);
    setReviewCompletionStoreForTests(store);
    const first = await seed(store, 'round-first', 1);
    const second = await seed(store, 'round-second', 1);
    let live = 0;
    setReviewLiveRoomProbe(() => live);
    setReviewYieldSleepForTests(async () => undefined);
    setReviewPositionEvaluatorForTests(async (snapshot, options) => {
      const result = await fastEval(snapshot, options);
      live = 1; // a game starts as the first job finishes its only decision
      return result;
    });

    const result = await sweepReviewCompletionJobs();

    expect(result).toMatchObject({ ran: 1, yielded: true });
    const statuses = await Promise.all([store.get(first.jobId), store.get(second.jobId)]);
    expect(statuses.filter((j) => j?.status === 'complete')).toHaveLength(1);
    const untouched = statuses.find((j) => j?.status !== 'complete');
    expect(untouched?.attemptCount ?? 0).toBe(0);
  });
});

describe('the lag sampler config', () => {
  it('has the numbers the report quotes', () => {
    expect(REVIEW_YIELD_CONFIG).toMatchObject({
      activityWindowMs: 60_000,
      lagThresholdMs: 100,
      starvationAfterMs: 600_000,
      sliceOnMs: 5_000,
      slicePeriodMs: 60_000,
      pollMs: 1_000,
    });
    configureReviewYieldForTests({ lagThresholdMs: 50 });
    setReviewLagSourceForTests(() => 60);
    expect(reviewYieldDecision(1_000).allowed).toBe(false);
  });
});

describe('what the client polls', () => {
  let server: Server | null = null;
  afterAll(() => { server?.close(); server = null; });

  async function poll(jobId: string): Promise<Record<string, any>> {
    if (!server) {
      const app = express();
      app.use(express.json());
      registerReviewCompletionJobsRoute(app);
      server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    }
    const port = (server.address() as { port: number }).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/review-completion-jobs/${encodeURIComponent(jobId)}`, { headers: { Authorization: 'Bearer test' } });
    return response.json();
  }

  it('says "paused while games are live" for a queued job while a room is live, and stops saying it when the room goes quiet', async () => {
    vi.stubEnv('REVIEW_SWEEP_ENABLED', 'true');
    const store = new InMemoryCheckpointStore(POLICY);
    setReviewCompletionStoreForTests(store);
    const job = await seed(store, 'poll-paused');
    let live = 1;
    setReviewLiveRoomProbe(() => live);

    expect(await poll(job.jobId)).toMatchObject({ stage: 'queued', pausedForLivePlay: true, unavailable: false });
    live = 0;
    expect(await poll(job.jobId)).toMatchObject({ stage: 'queued', pausedForLivePlay: false });
  });

  it('never says it for a finished job', async () => {
    vi.stubEnv('REVIEW_SWEEP_ENABLED', 'true');
    const store = new InMemoryCheckpointStore(POLICY);
    setReviewCompletionStoreForTests(store);
    const job = await seed(store, 'poll-complete', 1);
    setReviewPositionEvaluatorForTests(async (snapshot, options) => fastEval(snapshot, options));
    await sweepReviewCompletionJobs();
    setReviewLiveRoomProbe(() => 1);
    expect(await poll(job.jobId)).toMatchObject({ complete: true, pausedForLivePlay: false });
  });
});
