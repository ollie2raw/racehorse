import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adaptiveEvaluateReviewPosition } from '@racehorse/review-engine';
import { REVIEW_FIXTURE_CORPUS } from '../../../packages/game-core/src/reviewFixtureCorpus';
import { ENV_SPECS } from '../envSchema';
import { withBoundedExactOption } from './reviewBoundedExactFlag';
import { isReviewCutHonestyEnabled, withCutHonestyOption } from './reviewCutHonestyFlag';
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

describe('REVIEW_CUT_HONESTY_ENABLED', () => {
  it('is off by default and off for anything but the exact text "true"', () => {
    vi.stubEnv('REVIEW_CUT_HONESTY_ENABLED', '');
    expect(isReviewCutHonestyEnabled()).toBe(false);
    for (const value of ['1', 'TRUE', 'True', 'yes', 'on', 'false', ' true']) {
      vi.stubEnv('REVIEW_CUT_HONESTY_ENABLED', value);
      expect(isReviewCutHonestyEnabled()).toBe(false);
    }
    vi.stubEnv('REVIEW_CUT_HONESTY_ENABLED', 'true');
    expect(isReviewCutHonestyEnabled()).toBe(true);
  });

  it('is registered in the env schema as a flag that is on only for "true"', () => {
    const spec = ENV_SPECS.find((entry) => entry.name === 'REVIEW_CUT_HONESTY_ENABLED');
    expect(spec).toBeDefined();
    expect(spec?.kind).toBe('flagTrue');
    expect(spec?.scope).toBe('runtime');
  });

  it('off: the evaluation options are passed on untouched (the same object); on: they gain cutHonesty and nothing else changes', () => {
    const options = { startTier: 2 as const, maxTier: 4 as const, phase: 'completion' as const, allowProgressiveBeyondTier: true, progressiveSampleOffset: 10_000 };
    vi.stubEnv('REVIEW_CUT_HONESTY_ENABLED', '');
    expect(withCutHonestyOption(options)).toBe(options);
    expect('cutHonesty' in withCutHonestyOption(options)).toBe(false);
    vi.stubEnv('REVIEW_CUT_HONESTY_ENABLED', 'true');
    const on = withCutHonestyOption(options);
    expect(on).not.toBe(options);
    expect(on).toEqual({ ...options, cutHonesty: true });
    // and the engine accepts exactly that shape
    const accepted: NonNullable<Parameters<typeof adaptiveEvaluateReviewPosition>[1]> = on;
    expect(accepted.cutHonesty).toBe(true);
  });

  it('composes with the bounded exact flag: both on gives both options, either alone gives only its own', () => {
    const base = { phase: 'completion' as const };
    vi.stubEnv('REVIEW_BOUNDED_EXACT_ENABLED', 'true');
    vi.stubEnv('REVIEW_CUT_HONESTY_ENABLED', 'true');
    expect(withCutHonestyOption(withBoundedExactOption(base))).toEqual({ phase: 'completion', boundedExact: {}, cutHonesty: true });
    vi.stubEnv('REVIEW_CUT_HONESTY_ENABLED', '');
    expect(withCutHonestyOption(withBoundedExactOption(base))).toEqual({ phase: 'completion', boundedExact: {} });
    vi.stubEnv('REVIEW_BOUNDED_EXACT_ENABLED', '');
    vi.stubEnv('REVIEW_CUT_HONESTY_ENABLED', 'true');
    expect(withCutHonestyOption(withBoundedExactOption(base))).toEqual({ phase: 'completion', cutHonesty: true });
  });
});

describe.skipIf(!builtEngineAvailable)('REVIEW_CUT_HONESTY_ENABLED through the real search worker thread', () => {
  const runners: ReviewSearchRunner[] = [];
  afterEach(async () => {
    await Promise.all(runners.splice(0).map((runner) => runner.close()));
  });

  it('a result that is not cut comes back byte-identical with the flag on or off (the option crosses the thread boundary and changes nothing it should not)', async () => {
    const runner = new ReviewSearchRunner();
    runners.push(runner);
    const snapshot = REVIEW_FIXTURE_CORPUS.find((fixture) => fixture.snapshot.identifiers.decisionId === 'scoring-branch-chain')!.snapshot;
    const base = { phase: 'completion' as const };

    vi.stubEnv('REVIEW_CUT_HONESTY_ENABLED', '');
    const off = await runner.evaluate(snapshot, withCutHonestyOption(base));
    expect(off.evaluation.partialSearch).toBeUndefined();

    vi.stubEnv('REVIEW_CUT_HONESTY_ENABLED', 'true');
    const on = await runner.evaluate(snapshot, withCutHonestyOption(base));
    expect(on.evaluation.search.complete).toBe(true);
    expect(JSON.stringify(on)).toBe(JSON.stringify(off));
  }, 120_000);
});
