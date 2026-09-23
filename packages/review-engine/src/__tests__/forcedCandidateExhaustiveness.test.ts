import { afterEach, describe, expect, it, vi } from 'vitest';
import { isForcedDecision, countDistinctLegalActions } from '@racehorse/game-core/review';
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';
import {
  evaluateReviewPosition,
  WALL_CLOCK_CEILING_DIAGNOSTIC,
  type ReviewDispatchBudget,
} from '../evaluateReviewPosition';
import * as midgame from '../solveMidgameDeterminization';
import { isScorable } from '../reviewAccuracy';

afterEach(() => vi.restoreAllMocks());

const MULTI_ACTION = REVIEW_FIXTURE_CORPUS.find(
  (f) => f.snapshot.legalActions.length >= 2 && f.snapshot.preAction.boneyard.drawableCount > 0,
)!;

const SAME_TILE_MULTI = REVIEW_FIXTURE_CORPUS.find((f) => {
  const plays = f.snapshot.legalActions.filter((a) => a.kind === 'play');
  if (plays.length < 2) return false;
  const keys = new Set(
    plays.map((a) =>
      a.kind === 'play'
        ? `${Math.min(a.tile.low, a.tile.high)}-${Math.max(a.tile.low, a.tile.high)}`
        : '',
    ),
  );
  return keys.size === 1;
});

const BASE_BUDGET: ReviewDispatchBudget = {
  maxNodes: 10_000,
  maxHiddenStateSamples: 10,
  maxPlyDepth: 2,
  seed: 'forced-exhaustiveness',
  maxWallClockMs: 100,
};

describe('forced predicate — candidate exhaustiveness', () => {
  it('every fixture evaluation candidates mirror snapshot.legalActions 1:1', () => {
    for (const fixture of REVIEW_FIXTURE_CORPUS) {
      const evaluation = evaluateReviewPosition(fixture.snapshot, {
        maxNodes: 50_000,
        maxHiddenStateSamples: 40,
        maxPlyDepth: 2,
        seed: `exhaust-${fixture.id}`,
      }, 0.02);
      expect(evaluation.candidates.length).toBe(fixture.snapshot.legalActions.length);
      const candKeys = new Set(evaluation.candidates.map((c) => JSON.stringify(c.action)));
      const legalKeys = new Set(fixture.snapshot.legalActions.map((a) => JSON.stringify(a)));
      expect(candKeys).toEqual(legalKeys);
      expect(isForcedDecision(evaluation.candidates)).toBe(
        fixture.snapshot.legalActions.length <= 1,
      );
      expect(countDistinctLegalActions(evaluation.candidates)).toBe(
        fixture.snapshot.legalActions.length,
      );
    }
  });

  it('wall-clock incomplete midgame cannot turn multi-action into FORCED', () => {
    expect(MULTI_ACTION.snapshot.legalActions.length).toBeGreaterThan(1);
    let clock = 0;
    const baseline = evaluateReviewPosition(MULTI_ACTION.snapshot, BASE_BUDGET, 0, () => clock);
    const original = midgame.solveMidgameDeterminization;
    vi.spyOn(midgame, 'solveMidgameDeterminization').mockImplementation((...args) => {
      const result = original(...args);
      clock = 101;
      return result;
    });
    const overrun = evaluateReviewPosition(MULTI_ACTION.snapshot, BASE_BUDGET, 0, () => clock);
    expect(overrun.search.complete).toBe(false);
    expect(overrun.diagnostics).toContain(WALL_CLOCK_CEILING_DIAGNOSTIC);
    expect(overrun.candidates.length).toBe(MULTI_ACTION.snapshot.legalActions.length);
    expect(overrun.candidates).toEqual(baseline.candidates);
    expect(isForcedDecision(overrun.candidates)).toBe(false);
    expect(isScorable(overrun, overrun.candidates) || overrun.evidence.source === 'heuristic').toBe(
      true,
    );
  });

  it('same-tile multi-placement remains NOT forced under incomplete search', () => {
    expect(SAME_TILE_MULTI).toBeDefined();
    const snapshot = SAME_TILE_MULTI!.snapshot;
    expect(snapshot.legalActions.length).toBeGreaterThan(1);
    let n = 0;
    const clock = () => {
      n += 1;
      return n === 1 ? 0 : 1_000_000;
    };
    const result = evaluateReviewPosition(
      snapshot,
      {
        ...BASE_BUDGET,
        maxNodes: 500,
        maxHiddenStateSamples: 2,
        maxWallClockMs: 1,
      },
      0.99,
      clock,
    );
    expect(result.candidates.length).toBe(snapshot.legalActions.length);
    expect(isForcedDecision(result.candidates)).toBe(false);
  });
});
