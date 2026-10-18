/**
 * Integration gate: the three original R1 defects, written so they FAIL on the pre-fix solvers and PASS on the fixed ones.
 *
 *   A. a heuristic evaluation depended on object identity: the same position scored differently after serialization.
 *      Here: live snapshot, structuredClone, JSON round trip and a persistence-shaped reconstruction (keys reordered) must give
 *      EXACTLY the same candidate values, best set, played value, loss and whole-game grade.
 *   B. the stored ruleset was ignored (DEFAULT_CONFIG was used). Here: under non-default stored rules the production exact path
 *      must equal the independent oracle that plays by the stored rules; under default rules it must still equal it.
 *
 * (C, the legacy analyzer's placement-blind grading, is gated in client/src/analyzer/moveAnalyzer.positionAware.test.ts.)
 * Failures print `<namespace>:<n>@<action index>`.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Config } from '@racehorse/game-core';
import type { ReviewAction, ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { evaluateReviewPosition } from '../evaluateReviewPosition';
import { computeGameAccuracyModel } from '../gameAccuracyModel';
import { oracleFor } from './support/lockedYardOracle';
import { actionKey, makeGame } from './support/reviewIntegrityHarness';

const ZERO_CLOCK = () => 0;
const SMALL = { maxNodes: 300, maxHiddenStateSamples: 1, maxPlyDepth: 1, seed: 'gate-r1', maxWallClockMs: 60_000 } as const;
const BIG = { maxNodes: 400_000_000, maxHiddenStateSamples: 1_000_000, maxPlyDepth: 12, seed: 'gate-r1-exact', maxWallClockMs: 3_600_000 } as const;

/** Persistence-shaped copy: JSON text, parsed, every object's keys re-inserted in reverse order. */
function persistenceShaped<T>(value: T): T {
  const reverse = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(reverse);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).reverse().map(([k, x]) => [k, reverse(x)]));
    return v;
  };
  return reverse(JSON.parse(JSON.stringify(value))) as T;
}

const variants = (s: ReviewPositionSnapshotV2): Array<[string, ReviewPositionSnapshotV2]> => [
  ['live', s],
  ['structuredClone', structuredClone(s)],
  ['json', JSON.parse(JSON.stringify(s)) as ReviewPositionSnapshotV2],
  ['persistence-shaped', persistenceShaped(s)],
];

/** Key-order-independent action key (a persistence-shaped copy re-orders object keys; that is not a value change). */
const ck = (a: ReviewAction): string => (a.kind === 'play' ? `play:${Math.min(a.tile.low, a.tile.high)}-${Math.max(a.tile.low, a.tile.high)}@${a.position}` : a.kind);

/** Everything a reader can see of one evaluation: candidate set+values, best set, played, loss, grade. */
function visible(ev: ReviewEvaluationV1) {
  const byKey = [...ev.candidates].map((c) => [ck(c.action), c.value.expectedPointDifferential, c.immediatePoints] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const bestValue = ev.best.value.expectedPointDifferential;
  const bestSet = ev.candidates.filter((c) => c.value.expectedPointDifferential === bestValue).map((c) => ck(c.action)).sort();
  return {
    source: ev.evidence.source, candidates: byKey, bestSet, played: [ck(ev.played.action), ev.played.value.expectedPointDifferential],
    loss: ev.loss.expectedPointDifferential, grade: computeGameAccuracyModel([ev]).grade,
  };
}

describe('R1-A: evaluations are identical for live, cloned, JSON and persistence-shaped snapshots', { timeout: 900_000 }, () => {
  it('heuristic-regime positions (opening / midgame, both seats): same values, best set, played value, loss and grade', () => {
    let positions = 0;
    let heuristic = 0;
    for (let n = 0; n < 24; n += 1) {
      const game = makeGame('gate-r1a-5d2', n);
      for (const a of game.actions.slice(0, 14)) {
        if (a.snapshot.legalActions.length < 2) continue;
        const [, live] = variants(a.snapshot)[0]!;
        const base = evaluateReviewPosition(live, SMALL, 0.02, ZERO_CLOCK);
        if (base.evidence.source === 'heuristic') heuristic += 1;
        const want = visible(base);
        for (const [name, copy] of variants(a.snapshot).slice(1)) {
          const got = visible(evaluateReviewPosition(copy, SMALL, 0.02, ZERO_CLOCK));
          expect(got, `${game.id}@${a.index} (${name} vs live)`).toEqual(want);
        }
        positions += 1;
      }
    }
    expect(positions).toBeGreaterThan(100);
    expect(heuristic, 'the heuristic path must actually be exercised').toBeGreaterThan(20);
  });

  it('exact-regime positions are also serialization-stable', () => {
    let exact = 0;
    for (let n = 0; n < 30; n += 1) {
      const game = makeGame('gate-r1a-exact-5d2', n);
      for (const a of game.actions) {
        if (a.snapshot.preAction.boneyard.drawableCount !== 0 || a.snapshot.legalActions.length < 2 || a.snapshot.preAction.actorHand.length > 5) continue;
        const want = visible(evaluateReviewPosition(a.snapshot, BIG, 0.02, ZERO_CLOCK));
        if (want.source === 'exact') exact += 1;
        for (const [name, copy] of variants(a.snapshot).slice(1)) {
          expect(visible(evaluateReviewPosition(copy, BIG, 0.02, ZERO_CLOCK)), `${game.id}@${a.index} (${name})`).toEqual(want);
        }
      }
    }
    expect(exact).toBeGreaterThan(10);
  });
});

const RULESETS: Array<[string, Partial<Config>]> = [
  ['default', {}],
  ['blocked hands score nothing', { blockedHandRule: 'noScore' }],
  ['no end-of-hand bonus', { endHandBonus: 'none' }],
  ['scoring multiple 10', { scoringMultiple: 10 }],
];

describe('R1-B: the review plays by the ruleset the game was played under', { timeout: 900_000 }, () => {
  for (const [name, config] of RULESETS) {
    it(`${name}: exact values, best set and loss equal the independent oracle (stored rules)`, () => {
      let compared = 0;
      let nonDefaultDiffers = 0;
      for (let n = 0; n < 40; n += 1) {
        const game = makeGame('gate-r1b-9c1', n, { config });
        for (const a of game.actions) {
          const s = a.snapshot;
          if (s.preAction.boneyard.drawableCount !== 0 || s.legalActions.length < 2) continue;
          const oracle = oracleFor(s);
          if (!oracle) continue;
          const ev = evaluateReviewPosition(s, BIG, 0.02, ZERO_CLOCK);
          const where = `${game.id}@${a.index} (${name})`;
          expect(ev.evidence.source, where).toBe('exact');
          for (const c of ev.candidates) expect(c.value.expectedPointDifferential, `${where} ${actionKey(c.action)}`).toBeCloseTo(oracle.values.get(actionKey(c.action))!, 9);
          expect(ev.loss.expectedPointDifferential, `${where} loss`).toBeCloseTo(oracle.max - oracle.values.get(actionKey(a.action))!, 9);
          compared += 1;
          if (s.rulesetConfig && (s.rulesetConfig.blockedHandRule !== 'lowestPips' || s.rulesetConfig.endHandBonus !== 'sumOpponentPenalties' || s.rulesetConfig.scoringMultiple !== 5)) nonDefaultDiffers += 1;
        }
      }
      expect(compared).toBeGreaterThan(10);
      if (name !== 'default') expect(nonDefaultDiffers, 'the stored ruleset really is non-default').toBe(compared);
    });
  }

  it('default-ruleset evaluations are numerically unchanged by the ruleset fix (digest printed for pre/post comparison)', () => {
    const hash = createHash('sha256');
    let count = 0;
    for (let n = 0; n < 40; n += 1) {
      for (const a of makeGame('gate-r1b-default-digest', n).actions) {
        if (a.snapshot.legalActions.length < 2) continue;
        hash.update(JSON.stringify(visible(evaluateReviewPosition(a.snapshot, SMALL, 0.02, ZERO_CLOCK))));
        count += 1;
      }
    }
    console.log(`GATE-DIGEST default-ruleset evaluations=${count} sha256=${hash.digest('hex')}`);
    expect(count).toBeGreaterThan(500);
  });
});
