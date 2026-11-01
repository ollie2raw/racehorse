/**
 * Differential test between the two move-quality scales the product shows (docs/analysis-stack-ownership.md).
 *
 * The in-game coach (client/src/learning) grades a move by the Fritz heuristic's SCORE DELTA against the best move, in
 * score units where 1 scoring unit (5 points) = 34 (see DEFAULT_THRESHOLD_CONFIG). The post-game review
 * (packages/review-engine, shown through client/src/analyzer) grades a move by EXPECTED-POINT LOSS from a search, in calibrated
 * bands (LOSS_BAND_BOUNDARIES). They are not the same quantity: the coach delta includes strategic terms of +-5 to +-40 that
 * are not points. But a player sees both on the same game, so the two must not contradict each other badly, and a retune of
 * either must be a visible decision rather than a silent drift.
 *
 * This test converts the coach's score units to points (the only conversion the coach documents), sweeps the whole range, and
 * pins (1) the properties that must always hold, and (2) the exact table of where the two disagree today.
 */
import { describe, expect, it } from 'vitest';
import { LOSS_BAND_BOUNDARIES } from '@racehorse/review-engine';
import { lossBandLabel, type LossBandLabel } from '../analyzer/gameAccuracyModel';
import { classifyMoveByDelta } from './moveAnalysis';
import { DEFAULT_THRESHOLD_CONFIG, type MoveCategory } from './types';

/** 1 scoring unit = 5 points = 34 coach score units (types.ts, "Scale reference"). */
const POINTS_PER_SCORE_UNIT = 5 / 34;

type Pair = { coach: MoveCategory; review: LossBandLabel };

/** Runs of constant (coach, review) pairs across a 0..80 score-unit sweep, with the point range each covers. */
function agreementTable(): Array<Pair & { fromPoints: number }> {
  const table: Array<Pair & { fromPoints: number }> = [];
  for (let tenths = 0; tenths <= 800; tenths += 1) {
    const delta = tenths / 10;
    const pair: Pair = {
      coach: classifyMoveByDelta(delta, DEFAULT_THRESHOLD_CONFIG),
      review: lossBandLabel(delta * POINTS_PER_SCORE_UNIT),
    };
    const last = table[table.length - 1];
    if (!last || last.coach !== pair.coach || last.review !== pair.review) {
      table.push({ ...pair, fromPoints: Math.round(delta * POINTS_PER_SCORE_UNIT * 100) / 100 });
    }
  }
  return table;
}

describe('coach score-delta categories vs review expected-point-loss bands', () => {
  const table = agreementTable();

  it('never calls a move bad on one scale and fine on the other', () => {
    for (const { coach, review } of table) {
      // a coach blunder is at least a review Mistake
      if (coach === 'blunder') expect(['Mistake', 'Blunder']).toContain(review);
      // a review Blunder is at least a coach dubious
      if (review === 'Blunder') expect(['dubious', 'blunder']).toContain(coach);
      // a coach best/excellent is never a review Blunder
      if (coach === 'best' || coach === 'excellent') expect(review).not.toBe('Blunder');
    }
  });

  it('stays ordered: a bigger loss never gets a milder label on either scale', () => {
    const coachRank: Record<MoveCategory, number> = { best: 0, excellent: 1, good: 2, dubious: 3, blunder: 4 };
    const reviewRank: Record<LossBandLabel, number> = { Best: 0, Inaccuracy: 1, Mistake: 2, Blunder: 3 };
    for (let i = 1; i < table.length; i += 1) {
      expect(coachRank[table[i].coach]).toBeGreaterThanOrEqual(coachRank[table[i - 1].coach]);
      expect(reviewRank[table[i].review]).toBeGreaterThanOrEqual(reviewRank[table[i - 1].review]);
    }
  });

  it('pins today\'s boundaries in points, so retuning either scale is a visible decision', () => {
    const t = DEFAULT_THRESHOLD_CONFIG;
    const points = (units: number) => Math.round(units * POINTS_PER_SCORE_UNIT * 100) / 100;
    // coach: where each category ends, in points
    expect([points(t.excellentDelta), points(t.goodDelta), points(t.dubiousDelta)]).toEqual([0.88, 2.65, 5]);
    // review: where each band ends, in points
    expect([
      LOSS_BAND_BOUNDARIES.bestTolerance,
      LOSS_BAND_BOUNDARIES.inaccuracyToMistake,
      LOSS_BAND_BOUNDARIES.mistakeToBlunder,
    ].map((n) => Math.round(n * 100) / 100)).toEqual([0.13, 0.79, 5.98]);
  });

  it('records exactly where the two scales disagree on the label today', () => {
    expect(table).toMatchInlineSnapshot(`
      [
        {
          "coach": "best",
          "fromPoints": 0,
          "review": "Best",
        },
        {
          "coach": "excellent",
          "fromPoints": 0.01,
          "review": "Best",
        },
        {
          "coach": "excellent",
          "fromPoints": 0.13,
          "review": "Inaccuracy",
        },
        {
          "coach": "excellent",
          "fromPoints": 0.79,
          "review": "Mistake",
        },
        {
          "coach": "good",
          "fromPoints": 0.9,
          "review": "Mistake",
        },
        {
          "coach": "dubious",
          "fromPoints": 2.66,
          "review": "Mistake",
        },
        {
          "coach": "blunder",
          "fromPoints": 5.01,
          "review": "Mistake",
        },
        {
          "coach": "blunder",
          "fromPoints": 5.99,
          "review": "Blunder",
        },
      ]
    `);
  });
});
