/**
 * Part I — authoritative fresh-legal-game completion contract.
 * Completeness is proven via analyzeGame (full adaptive ladder). Structural
 * fields are checked on every snapshot without a second full search pass.
 */
import { describe, expect, it } from 'vitest';
import { analyzeGame, playRandomGame } from '../devtools/coverageSoakLib';
import { LOSS_BAND_BOUNDARIES } from '../accuracyModelCalibration';
import { computePublicPositionHash } from '../publicPositionHash';
import { adaptiveEvaluateReviewPosition } from '../adaptiveEvaluateReviewPosition';
import { evaluateReviewPosition } from '../evaluateReviewPosition';

function calibratedBand(loss: number): 'Best' | 'Inaccuracy' | 'Mistake' | 'Blunder' {
  const { bestTolerance, inaccuracyToMistake, mistakeToBlunder } = LOSS_BAND_BOUNDARIES;
  if (loss <= bestTolerance) return 'Best';
  if (loss <= inaccuracyToMistake) return 'Inaccuracy';
  if (loss <= mistakeToBlunder) return 'Mistake';
  return 'Blunder';
}

const GAMES = Number(process.env.REVIEW_ACCEPTANCE_GAMES ?? 6);

describe('authoritative fresh legal game completion contract', () => {
  it(
    `COMPLETE games satisfy reviewed==total, forced+scored==total, zero failure states (${GAMES} games)`,
    () => {
      let totalDecisionCount = 0;
      let scoredDecisionCount = 0;
      let forcedDecisionCount = 0;
      let estimateCount = 0;
      let unavailableCount = 0;
      let pendingCount = 0;
      let failedRetryableCount = 0;
      let failedFatalCount = 0;
      let evidenceInvalidations = 0;
      let evidenceItemsCreated = 0;

      for (let i = 0; i < GAMES; i += 1) {
        const seed = 5000 + i * 131;
        const opts = {
          preferDraw: i % 2 === 0,
          preferPass: i % 3 === 0,
          winningScore: 30,
          depleteHighTiles: true,
          maxHands: 2,
        };
        const played = playRandomGame(seed, opts);
        evidenceItemsCreated += played.evidenceItemsCreated;

        const r = analyzeGame(seed, opts, 4);

        totalDecisionCount += r.decisions;
        scoredDecisionCount += r.scored;
        forcedDecisionCount += r.forced;
        estimateCount += r.estimates;
        unavailableCount += r.unavailable;
        pendingCount += r.pending;
        failedRetryableCount += r.retryable;
        failedFatalCount += r.fatal;
        evidenceInvalidations += r.evidenceInvalidations;

        expect(r.failures, JSON.stringify(r.failures.slice(0, 2))).toEqual([]);
        expect(r.forced + r.scored).toBe(r.decisions);

        for (const snapshot of played.snapshots) {
          const hash = computePublicPositionHash(snapshot);
          expect(hash).toMatch(/^position-v\d+-sha256:[a-f0-9]{64}$/);
          expect(snapshot.integrity.positionHash).toBe(hash);
          expect(snapshot.legalActions.length).toBeGreaterThan(0);
        }

        // One non-forced decision: full engine-backed calibrated score fields.
        if (r.scored > 0) {
          const snapshot = played.snapshots.find((s) => s.legalActions.length > 1) ?? played.snapshots[0]!;
          const adaptive = adaptiveEvaluateReviewPosition(snapshot, {
            startTier: 1,
            maxTier: 4,
            phase: 'completion',
            allowProgressiveBeyondTier: true,
            evaluate: (snap, budget, threshold) =>
              evaluateReviewPosition(
                snap,
                {
                  ...budget,
                  maxWallClockMs: Math.min(budget.maxWallClockMs ?? 30_000, 8_000),
                },
                threshold,
              ),
          });
          if (adaptive.lifecycle !== 'FORCED') {
            expect(adaptive.lifecycle).toBe('SCORED');
            const evaluation = adaptive.evaluation;
            expect(
              evaluation.evidence.source === 'exact' || evaluation.evidence.source === 'search',
            ).toBe(true);
            expect(evaluation.played).toBeDefined();
            expect(evaluation.best).toBeDefined();
            expect(evaluation.loss).toBeDefined();
            expect(evaluation.evaluationProvenance?.lifecycle).toBe('SCORED');
            const band = calibratedBand(evaluation.loss.expectedPointDifferential);
            expect(['Best', 'Inaccuracy', 'Mistake', 'Blunder']).toContain(band);
          }
        }
      }

      const reviewedDecisionCount = forcedDecisionCount + scoredDecisionCount;
      expect(reviewedDecisionCount).toBe(totalDecisionCount);
      expect(estimateCount).toBe(0);
      expect(unavailableCount).toBe(0);
      expect(pendingCount).toBe(0);
      expect(failedRetryableCount).toBe(0);
      expect(failedFatalCount).toBe(0);
      expect(evidenceItemsCreated).toBeGreaterThan(0);
      expect(evidenceInvalidations).toBeGreaterThan(0);

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            mode: 'acceptance-contract',
            games: GAMES,
            totalDecisionCount,
            reviewedDecisionCount,
            scoredDecisionCount,
            forcedDecisionCount,
            estimateCount,
            unavailableCount,
            pendingCount,
            failedRetryableCount,
            failedFatalCount,
            evidenceItemsCreated,
            evidenceInvalidations,
          },
          null,
          2,
        ),
      );
    },
    900_000,
  );
});
