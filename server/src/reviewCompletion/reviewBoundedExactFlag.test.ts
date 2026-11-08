import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adaptiveEvaluateReviewPosition } from '@racehorse/review-engine';
import { REVIEW_FIXTURE_CORPUS } from '../../../packages/game-core/src/reviewFixtureCorpus';
import { ENV_SPECS } from '../envSchema';
import { isReviewBoundedExactEnabled, withBoundedExactOption } from './reviewBoundedExactFlag';
import { ReviewSearchRunner } from './reviewSearchRunner';

// The real worker thread loads the BUILT review-engine (the server's prebuild produces it), so this runs only where it exists.
const requireFromHere = createRequire(__filename);
const builtEngineAvailable = (() => {
  try {
    requireFromHere.resolve('@racehorse/review-engine');
    return true;
  } catch {
    return false;
  }
})();

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('REVIEW_BOUNDED_EXACT_ENABLED', () => {
  it('is off by default and off for anything but the exact text "true"', () => {
    vi.stubEnv('REVIEW_BOUNDED_EXACT_ENABLED', '');
    expect(isReviewBoundedExactEnabled()).toBe(false);
    for (const value of ['1', 'TRUE', 'True', 'yes', 'on', 'false', ' true']) {
      vi.stubEnv('REVIEW_BOUNDED_EXACT_ENABLED', value);
      expect(isReviewBoundedExactEnabled()).toBe(false);
    }
    vi.stubEnv('REVIEW_BOUNDED_EXACT_ENABLED', 'true');
    expect(isReviewBoundedExactEnabled()).toBe(true);
  });

  it('is registered in the env schema as a flag that is on only for "true"', () => {
    const spec = ENV_SPECS.find((entry) => entry.name === 'REVIEW_BOUNDED_EXACT_ENABLED');
    expect(spec).toBeDefined();
    expect(spec?.kind).toBe('flagTrue');
    expect(spec?.scope).toBe('runtime');
  });

  it('off: the evaluation options are passed on untouched (the same object); on: they gain boundedExact and nothing else changes', () => {
    const options = { startTier: 2 as const, maxTier: 4 as const, phase: 'completion' as const, allowProgressiveBeyondTier: true, progressiveSampleOffset: 10_000 };
    vi.stubEnv('REVIEW_BOUNDED_EXACT_ENABLED', '');
    expect(withBoundedExactOption(options)).toBe(options);
    expect('boundedExact' in withBoundedExactOption(options)).toBe(false);
    vi.stubEnv('REVIEW_BOUNDED_EXACT_ENABLED', 'true');
    const on = withBoundedExactOption(options);
    expect(on).not.toBe(options);
    expect(on).toEqual({ ...options, boundedExact: {} });
    // and the engine accepts exactly that shape
    const accepted: NonNullable<Parameters<typeof adaptiveEvaluateReviewPosition>[1]> = on;
    expect(accepted.boundedExact).toEqual({});
  });
});

describe.skipIf(!builtEngineAvailable)('REVIEW_BOUNDED_EXACT_ENABLED through the real search worker thread', () => {
  const runners: ReviewSearchRunner[] = [];
  afterEach(async () => {
    await Promise.all(runners.splice(0).map((runner) => runner.close()));
  });

  it('off: the worker evaluates as before (no bounded field); on: the same position comes back bounded, still "search" evidence, with a second opinion', async () => {
    const runner = new ReviewSearchRunner();
    runners.push(runner);
    const snapshot = REVIEW_FIXTURE_CORPUS.find((fixture) => fixture.snapshot.identifiers.decisionId === 'scoring-branch-chain')!.snapshot;
    const base = { phase: 'completion' as const };

    vi.stubEnv('REVIEW_BOUNDED_EXACT_ENABLED', '');
    const off = await runner.evaluate(snapshot, withBoundedExactOption(base));
    expect(off.evaluation.boundedSearch).toBeUndefined();
    expect(off.convergenceReason).toBe('exact-complete');

    vi.stubEnv('REVIEW_BOUNDED_EXACT_ENABLED', 'true');
    const on = await runner.evaluate(snapshot, withBoundedExactOption(base));
    expect(on.evaluation.boundedSearch).toBeDefined();
    expect(on.evaluation.boundedSearch?.totalHands).toBe(14);
    expect(on.evaluation.evidence.source).toBe('search');
    expect(on.lifecycle).toBe('SCORED');
    expect(on.evaluation.secondOpinion === undefined).toBe(off.evaluation.secondOpinion === undefined);
  }, 120_000);
});
