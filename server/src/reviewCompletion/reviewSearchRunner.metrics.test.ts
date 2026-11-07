import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { REVIEW_FIXTURE_CORPUS } from '../../../packages/game-core/src/reviewFixtureCorpus';
import { ReviewSearchRunner } from './reviewSearchRunner';

// The real worker thread loads the BUILT review-engine (the server's prebuild produces it), so these run only where it exists.
const requireFromHere = createRequire(__filename);
const builtEngineAvailable = (() => {
  try {
    requireFromHere.resolve('@racehorse/review-engine');
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!builtEngineAvailable)('ReviewSearchRunner with the real worker thread: the diagnostics', () => {
  const runners: ReviewSearchRunner[] = [];
  afterEach(async () => {
    await Promise.all(runners.splice(0).map((runner) => runner.close()));
  });

  it('runs the fixed-position CPU benchmark in the worker and reports its median, total and CPU', async () => {
    const runner = new ReviewSearchRunner();
    runners.push(runner);
    const result = await runner.benchmark(3);
    expect(result.snapshotId).toBe('hidden-allocation-ambiguous-midgame');
    expect(result.runs).toBe(3);
    expect(result.medianMs).toBeGreaterThan(0);
    expect(result.minMs).toBeLessThanOrEqual(result.medianMs);
    expect(result.maxMs).toBeGreaterThanOrEqual(result.medianMs);
    expect(result.totalMs).toBeGreaterThanOrEqual(result.maxMs);
  }, 120_000);

  it('surfaces what the worker measured about each decision: its wall time, its heap against the cap', async () => {
    const runner = new ReviewSearchRunner();
    runners.push(runner);
    expect(runner.lastMetrics).toBeNull();
    const snapshot = REVIEW_FIXTURE_CORPUS.find((fixture) => fixture.snapshot.identifiers.decisionId === 'scoring-branch-chain')!.snapshot;
    await runner.evaluate(snapshot, { phase: 'completion' });
    expect(runner.lastMetrics).not.toBeNull();
    expect(runner.lastMetrics!.wallMs).toBeGreaterThanOrEqual(0);
    expect(runner.lastMetrics!.heapUsedMb).toBeGreaterThan(0);
    // the worker's resourceLimits cap, not the process's
    expect(runner.lastMetrics!.heapLimitMb).toBeGreaterThan(0);
    expect(runner.workerRestarts).toBe(0);
    expect(runner.workerOomCount).toBe(0);
  }, 120_000);

  it('counts a worker that is killed (an exceeded time limit) as a restart', async () => {
    const runner = new ReviewSearchRunner({ timeoutMs: 100 });
    runners.push(runner);
    const snapshot = REVIEW_FIXTURE_CORPUS.find((fixture) => fixture.snapshot.identifiers.decisionId === 'hidden-allocation-ambiguous-midgame')!.snapshot;
    await expect(runner.evaluate(snapshot, { phase: 'completion' })).rejects.toThrow();
    // the terminated worker's exit arrives after the rejection
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(runner.workerRestarts).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
