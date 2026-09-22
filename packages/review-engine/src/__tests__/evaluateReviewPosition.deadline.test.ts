import { afterEach, describe, expect, it, vi } from 'vitest';
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';
import {
  DEFAULT_REVIEW_WALL_CLOCK_CEILING_MS,
  evaluateReviewPosition,
  WALL_CLOCK_CEILING_DIAGNOSTIC,
  type ReviewDispatchBudget,
} from '../evaluateReviewPosition';
import * as midgame from '../solveMidgameDeterminization';

afterEach(() => vi.restoreAllMocks());

const MIDGAME_SNAPSHOT = REVIEW_FIXTURE_CORPUS.find(
  (fixture) => fixture.snapshot.preAction.boneyard.drawableCount > 0,
)!.snapshot;

const LOCKED_SNAPSHOT = REVIEW_FIXTURE_CORPUS.find(
  (fixture) => fixture.snapshot.preAction.boneyard.drawableCount === 0,
)!.snapshot;

const BASE_BUDGET: ReviewDispatchBudget = {
  maxNodes: 10_000,
  maxHiddenStateSamples: 10,
  maxPlyDepth: 2,
  seed: 'f4b-deadline',
  maxWallClockMs: 100,
};

/** First now() = start; every later call reports past the ceiling. */
function forceOverrunClock(): () => number {
  let calls = 0;
  return () => {
    calls += 1;
    return calls === 1 ? 0 : 1_000_000;
  };
}

describe('F4b whole-decision wall-clock ceiling', () => {
  it('comfortably under deadline keeps a normal midgame result complete', () => {
    const result = evaluateReviewPosition(MIDGAME_SNAPSHOT, BASE_BUDGET, 0, () => 0);
    expect(result.search.complete).toBe(true);
    expect(result.diagnostics).not.toContain(WALL_CLOCK_CEILING_DIAGNOSTIC);
  });

  it('normal path with generous ceiling matches pre-deadline semantics (selected action + candidate order)', () => {
    const withCeiling = evaluateReviewPosition(
      MIDGAME_SNAPSHOT,
      { ...BASE_BUDGET, maxWallClockMs: DEFAULT_REVIEW_WALL_CLOCK_CEILING_MS },
      0,
      () => 0,
    );
    const frozenClock = evaluateReviewPosition(MIDGAME_SNAPSHOT, { ...BASE_BUDGET, maxWallClockMs: 1e9 }, 0, () => 0);
    expect(withCeiling.best).toEqual(frozenClock.best);
    expect(withCeiling.candidates).toEqual(frozenClock.candidates);
    expect(withCeiling.search.complete).toBe(true);
    expect(frozenClock.search.complete).toBe(true);
  });

  it('forced-slow midgame overrun sets search.complete=false without reordering candidates', () => {
    let clock = 0;
    const baseline = evaluateReviewPosition(MIDGAME_SNAPSHOT, BASE_BUDGET, 0, () => clock);
    const original = midgame.solveMidgameDeterminization;
    vi.spyOn(midgame, 'solveMidgameDeterminization').mockImplementation((...args) => {
      const result = original(...args);
      clock = 101; // deterministic forced-slow after real search
      return result;
    });
    const overrun = evaluateReviewPosition(MIDGAME_SNAPSHOT, BASE_BUDGET, 0, () => clock);
    expect(overrun.search.complete).toBe(false);
    expect(overrun.candidates).toEqual(baseline.candidates);
    expect(overrun.best).toEqual(baseline.best);
    expect(overrun.diagnostics).toContain(WALL_CLOCK_CEILING_DIAGNOSTIC);
    expect(overrun.played.action).toEqual(baseline.played.action);
  });

  it('deadline during nested midgame propagates to the decision result without throwing', () => {
    const result = evaluateReviewPosition(MIDGAME_SNAPSHOT, BASE_BUDGET, 1, forceOverrunClock());
    expect(result.search.complete).toBe(false);
    expect(result.diagnostics).toContain(WALL_CLOCK_CEILING_DIAGNOSTIC);
    expect(result.candidates.length).toBe(MIDGAME_SNAPSHOT.legalActions.length);
  });

  it('exact-path nested deadline uses the shared decision ceiling (no fresh nested allowance)', () => {
    const result = evaluateReviewPosition(
      LOCKED_SNAPSHOT,
      { ...BASE_BUDGET, maxWallClockMs: 1 },
      0,
      forceOverrunClock(),
    );
    expect(result.search.complete).toBe(false);
    expect(result.diagnostics).toContain(WALL_CLOCK_CEILING_DIAGNOSTIC);
  });

  it('exact deadline boundary uses strict greater-than (elapsed === ceiling is still complete)', () => {
    let calls = 0;
    const now = () => {
      calls += 1;
      // startedAt=0; subsequent checks report exactly ceiling (100) — not exceeded
      return calls === 1 ? 0 : 100;
    };
    const result = evaluateReviewPosition(MIDGAME_SNAPSHOT, BASE_BUDGET, 0, now);
    expect(result.search.complete).toBe(true);
    expect(result.diagnostics).not.toContain(WALL_CLOCK_CEILING_DIAGNOSTIC);
  });

  it('independent per-decision deadlines: one forced overrun does not change another decision', () => {
    const normal = evaluateReviewPosition(MIDGAME_SNAPSHOT, BASE_BUDGET, 0, () => 0);
    const overrun = evaluateReviewPosition(MIDGAME_SNAPSHOT, BASE_BUDGET, 0, forceOverrunClock());
    expect(normal.search.complete).toBe(true);
    expect(overrun.search.complete).toBe(false);
    expect(normal.diagnostics).not.toContain(WALL_CLOCK_CEILING_DIAGNOSTIC);
    // Second call with frozen clock still complete — no shared mutable timer.
    const again = evaluateReviewPosition(MIDGAME_SNAPSHOT, BASE_BUDGET, 0, () => 0);
    expect(again.search.complete).toBe(true);
    expect(again.candidates).toEqual(normal.candidates);
  });

  it('rejects a negative maxWallClockMs', () => {
    expect(() =>
      evaluateReviewPosition(MIDGAME_SNAPSHOT, { ...BASE_BUDGET, maxWallClockMs: -1 }, 0, () => 0),
    ).toThrow(/non-negative/);
  });
});
