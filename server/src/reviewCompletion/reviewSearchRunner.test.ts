import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ReviewPositionBudgetExceeded } from '@racehorse/review-engine';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { REVIEW_FIXTURE_CORPUS } from '../../../packages/game-core/src/reviewFixtureCorpus';
import { ReviewSearchRunner, ReviewSearchWorkerExited } from './reviewSearchRunner';

const FAKE_WORKER = path.resolve(__dirname, '__fixtures__/fakeSearchWorker.cjs');
const fake = (value: Record<string, unknown>) => value as unknown as ReviewPositionSnapshotV2;

/** Largest gap between 10ms ticks while `work` runs: the event-loop probe. */
async function maxLoopGapDuring(work: Promise<unknown>): Promise<number> {
  let last = performance.now();
  let maxGap = 0;
  const probe = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 10);
  try {
    await work.catch(() => undefined);
  } finally {
    clearInterval(probe);
  }
  return maxGap;
}

describe('ReviewSearchRunner', () => {
  const runners: ReviewSearchRunner[] = [];
  const make = (options: ConstructorParameters<typeof ReviewSearchRunner>[0] = {}) => {
    const runner = new ReviewSearchRunner({ workerPath: FAKE_WORKER, ...options });
    runners.push(runner);
    return runner;
  };
  afterEach(async () => {
    await Promise.all(runners.splice(0).map((runner) => runner.close()));
  });

  it('keeps the event loop responsive (< 200ms) while a 1.5s search runs', async () => {
    const runner = make();
    const gap = await maxLoopGapDuring(runner.evaluate(fake({ mode: 'spin', ms: 1_500 })));
    expect(gap).toBeLessThan(200);
  });

  it('terminates a position past its time limit and fails it as a budget overrun', async () => {
    const runner = make({ timeoutMs: 300 });
    const started = Date.now();
    await expect(runner.evaluate(fake({ mode: 'spin' }))).rejects.toBeInstanceOf(ReviewPositionBudgetExceeded);
    expect(Date.now() - started).toBeLessThan(2_000);
    // A fresh worker serves the next position.
    await expect(runner.evaluate(fake({ mode: 'ok' }))).resolves.toMatchObject({ echoed: 'ok' });
  });

  it('turns a worker crash into a retryable error and recovers', async () => {
    const runner = make();
    await expect(runner.evaluate(fake({ mode: 'crash' }))).rejects.toBeInstanceOf(ReviewSearchWorkerExited);
    await expect(runner.evaluate(fake({ mode: 'ok' }))).resolves.toMatchObject({ echoed: 'ok' });
  });

  it('abort() stops the position in flight', async () => {
    const runner = make();
    const pending = runner.evaluate(fake({ mode: 'spin' }));
    setTimeout(() => runner.abort('lease lost'), 100);
    await expect(pending).rejects.toBeInstanceOf(ReviewSearchWorkerExited);
  });

  it('runs one position at a time', async () => {
    const runner = make();
    const order: string[] = [];
    await Promise.all([
      runner.evaluate(fake({ mode: 'spin', ms: 200 })).then(() => order.push('first')),
      runner.evaluate(fake({ mode: 'ok' })).then(() => order.push('second')),
    ]);
    expect(order).toEqual(['first', 'second']);
  });

  it('evaluates a real position in the production worker', async () => {
    const runner = new ReviewSearchRunner();
    runners.push(runner);
    const result = await runner.evaluate(REVIEW_FIXTURE_CORPUS[0]!.snapshot, { maxTier: 1, phase: 'completion' });
    expect(result.positionHash).toBeTruthy();
    expect(['SCORED', 'FORCED', 'FAILED_RETRYABLE']).toContain(result.lifecycle);
  });
});
