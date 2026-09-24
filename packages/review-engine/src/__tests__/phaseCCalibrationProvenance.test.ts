import { describe, expect, it } from 'vitest';
import { dedupeCandidatesByTile, isForcedDecision } from '@racehorse/game-core/review';
import { LOSS_BAND_BOUNDARIES } from '../accuracyModelCalibration';
import {
  RECORDED_CLIENT_POLICY_DIR,
  RECORDED_SELF_PLAY_DIR,
  evaluateFixtureCorpus,
  fitBoundaries,
  fitKLeastSquares,
  readCorpusDir,
} from '../devtools/calibrateAccuracyModel';

/** Frozen v4 published K — provenance only; not the live production constant. */
const V4_PUBLISHED_K = 0.19770906562806756;

/**
 * Provenance regression: published v4 constants are recoverable under
 * tile-level forced on the committed recorded corpora. Action-level forced
 * on the same corpora does NOT recover those constants / historical [65,85]
 * check. Diagnostic only — live production uses action-level + refit K.
 *
 * Live `evaluateFixtureCorpus()` deliberately_poor losses are no longer the
 * historical fit input (evidence/completion architecture changed opening
 * coverage budgets). K recovery below uses the published-fit poor mean;
 * live fixtures are still evaluated for the action-level divergence check.
 */
describe('Phase C calibration provenance (diagnostic)', () => {
  const selfPlay = readCorpusDir(RECORDED_SELF_PLAY_DIR);
  const client = readCorpusDir(RECORDED_CLIENT_POLICY_DIR);
  const strong = selfPlay.filter((r) => r.batchTag === 'strong-policy-top-tier');
  const ordinary = client.filter((r) => r.tier === 'standard');
  const worstLegal = evaluateFixtureCorpus().filter((f) => f.category === 'deliberately_poor');

  /** Published-fit poor mean under tile-level forced (v4 lock input). */
  const V4_PUBLISHED_FIT_POOR_MEAN_LOSS = 9.292142862412533;

  function scorableLosses(
    records: typeof strong,
    forced: 'tile' | 'action',
  ): number[] {
    return records
      .filter((r) => {
        const isForced =
          forced === 'tile'
            ? dedupeCandidatesByTile(r.evaluation.candidates).length <= 1
            : isForcedDecision(r.evaluation.candidates);
        return !isForced && r.evaluation.evidence.source !== 'heuristic';
      })
      .map((r) => r.evaluation.loss.expectedPointDifferential);
  }

  it('tile-level forced re-fit reproduces historical v4 K within 1e-9; bands stay policy-retained', () => {
    const strongLosses = scorableLosses(strong, 'tile');
    const ordinaryLosses = scorableLosses(ordinary, 'tile');

    const k = fitKLeastSquares([
      {
        label: 'strong',
        meanLoss: strongLosses.reduce((s, v) => s + v, 0) / strongLosses.length,
        targetAccuracy: 95,
      },
      {
        label: 'poor',
        meanLoss: V4_PUBLISHED_FIT_POOR_MEAN_LOSS,
        targetAccuracy: 15,
      },
    ]);

    expect(Math.abs(k - V4_PUBLISHED_K)).toBeLessThan(1e-9);
    // Bands are policy-retained (not live-refit) under the v5 migration.
    expect(LOSS_BAND_BOUNDARIES.bestTolerance).toBeCloseTo(0.13, 10);
    expect(LOSS_BAND_BOUNDARIES.inaccuracyToMistake).toBe(0.79);
    expect(LOSS_BAND_BOUNDARIES.mistakeToBlunder).toBe(5.98);

    const ordinaryMean = ordinaryLosses.reduce((s, v) => s + v, 0) / ordinaryLosses.length;
    const ordinaryPred = 100 * Math.exp(-k * ordinaryMean);
    expect(ordinaryPred).toBeGreaterThanOrEqual(65);
    expect(ordinaryPred).toBeLessThanOrEqual(85);
  });

  it('action-level forced on the same corpus moves ordinary predicted accuracy outside historical [65,85]', () => {
    const strongLosses = scorableLosses(strong, 'action');
    const ordinaryLosses = scorableLosses(ordinary, 'action');
    const poorLosses = worstLegal
      .filter((f) => !isForcedDecision(f.evaluation.candidates))
      .filter((f) => f.evaluation.evidence.source !== 'heuristic')
      .map((f) => f.evaluation.loss.expectedPointDifferential);
    expect(poorLosses.length).toBeGreaterThanOrEqual(2);

    const k = fitKLeastSquares([
      {
        label: 'strong',
        meanLoss: strongLosses.reduce((s, v) => s + v, 0) / strongLosses.length,
        targetAccuracy: 95,
      },
      {
        label: 'poor',
        meanLoss: poorLosses.reduce((s, v) => s + v, 0) / poorLosses.length,
        targetAccuracy: 15,
      },
    ]);
    const ordinaryMean = ordinaryLosses.reduce((s, v) => s + v, 0) / ordinaryLosses.length;
    const ordinaryPred = 100 * Math.exp(-k * ordinaryMean);
    // Historical v4 empirical range — not a v5 gate; still documents the break.
    expect(ordinaryPred).toBeGreaterThan(85);

    const bands = fitBoundaries(strongLosses, ordinaryLosses, poorLosses);
    expect(bands.bestTolerance).toBe(0);
  });
});
