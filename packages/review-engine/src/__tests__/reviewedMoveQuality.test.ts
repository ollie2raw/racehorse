import { describe, expect, it } from 'vitest';
import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';
import {
  assertMoveQualityShareable,
  deriveReviewedMoveQuality,
  MoveQualityNotShareableError,
  type ReviewedMoveQuality,
} from '../reviewedMoveQuality';
import { createReviewCompletionJob, type ReviewCompletionJobRecord } from '../durableReviewCompletionRuntime';
import { computeGameAccuracyModel } from '../gameAccuracyModel';
import { evaluateReviewPosition, WALL_CLOCK_CEILING_DIAGNOSTIC } from '../evaluateReviewPosition';

const BASE_SNAPSHOT = REVIEW_FIXTURE_CORPUS[0]!.snapshot;
const BASE = evaluateReviewPosition(BASE_SNAPSHOT, {
  maxNodes: 4_000, maxHiddenStateSamples: 2, maxPlyDepth: 1, seed: 'move-quality-contract', maxWallClockMs: 100,
}, 0.02);

type Spec = { readonly loss: number; readonly forced?: boolean; readonly heuristic?: boolean };

function evaluationFor(id: string, spec: Spec): ReviewEvaluationV1 {
  const candidates = spec.forced
    ? [BASE.played]
    : [...BASE.candidates, { ...BASE.best, action: { kind: 'pass' as const } }];
  return {
    ...BASE,
    snapshotId: id,
    candidates,
    loss: { ...BASE.loss, expectedPointDifferential: spec.loss },
    evidence: { source: spec.heuristic ? 'heuristic' : 'search', confidence: 'medium', displayLabel: 'Review Engine search' } as ReviewEvaluationV1['evidence'],
    evaluationProvenance: { phase: 'completion', lifecycle: spec.forced ? 'FORCED' : 'SCORED' },
  };
}

/** A job the server finished: one decision per spec, in order. `override` makes it any other state. */
function jobOf(specs: readonly Spec[], override: Partial<ReviewCompletionJobRecord> = {}): ReviewCompletionJobRecord {
  const ids = specs.map((_, i) => `mq-${String(i + 1).padStart(3, '0')}`);
  const snapshots: ReviewPositionSnapshotV2[] = ids.map((id) => ({ ...BASE_SNAPSHOT, identifiers: { ...BASE_SNAPSHOT.identifiers, decisionId: id } }));
  const seeded = createReviewCompletionJob({
    gameDigest: 'mq-digest', sourceMatchId: 'mq-room', userId: 'mq-user', snapshots, expectedDecisionIds: ids,
  });
  const decisions = seeded.decisions.map((decision, i) => ({
    ...decision,
    lifecycle: specs[i]!.forced ? ('FORCED' as const) : ('SCORED' as const),
    evaluation: evaluationFor(ids[i]!, specs[i]!),
  }));
  return {
    ...seeded,
    status: 'complete',
    decisions,
    accuracyModelResult: computeGameAccuracyModel(decisions.map((d) => d.evaluation)),
    ...override,
  };
}

const GAME: readonly Spec[] = [
  { loss: 0 }, { loss: 1.5 }, { forced: true, loss: 0 }, { loss: 0.25 }, { loss: 4 }, { forced: true, loss: 0 }, { loss: 0 },
];

describe('deriveReviewedMoveQuality (the V2 definition of avgMoveQuality)', () => {
  it('is the V2 headline accuracy over the non-forced decisions, unrounded', () => {
    const q = deriveReviewedMoveQuality(jobOf(GAME));
    const expected = computeGameAccuracyModel(jobOf(GAME).decisions.map((d) => d.evaluation!));
    expect(q.status).toBe('available');
    if (q.status !== 'available') return;
    expect(q.avgMoveQuality).toBe(expected.accuracy);
    expect(q.avgMoveQuality).toBeGreaterThan(0);
    expect(q.avgMoveQuality).toBeLessThanOrEqual(100);
    expect(q.gradedDecisionCount).toBe(5);
    expect(q.forcedDecisionCount).toBe(2);
    expect(q.accuracyModelVersion).toBe(expected.accuracyModelVersion);
  });

  it('forced decisions never move the number (the same choices plus forced plays score the same)', () => {
    const choices: Spec[] = [{ loss: 0 }, { loss: 2 }, { loss: 0.5 }];
    const withForced: Spec[] = [{ forced: true, loss: 0 }, ...choices, { forced: true, loss: 0 }, { forced: true, loss: 0 }];
    expect(deriveReviewedMoveQuality(jobOf(withForced))).toMatchObject({
      status: 'available', avgMoveQuality: (deriveReviewedMoveQuality(jobOf(choices)) as { avgMoveQuality: number }).avgMoveQuality,
    });
  });

  it('a perfect game is 100 and tied-optimal moves (zero loss) count as optimal', () => {
    expect(deriveReviewedMoveQuality(jobOf([{ loss: 0 }, { loss: 0 }, { loss: 0 }]))).toMatchObject({ status: 'available', avgMoveQuality: 100 });
  });

  it('a worse game scores strictly lower, monotonically in the mean loss', () => {
    const a = deriveReviewedMoveQuality(jobOf([{ loss: 0.5 }, { loss: 0.5 }])) as { avgMoveQuality: number };
    const b = deriveReviewedMoveQuality(jobOf([{ loss: 3 }, { loss: 3 }])) as { avgMoveQuality: number };
    const c = deriveReviewedMoveQuality(jobOf([{ loss: 9 }, { loss: 9 }])) as { avgMoveQuality: number };
    expect(a.avgMoveQuality).toBeGreaterThan(b.avgMoveQuality);
    expect(b.avgMoveQuality).toBeGreaterThan(c.avgMoveQuality);
    expect(c.avgMoveQuality).toBeGreaterThanOrEqual(0);
  });

  it('is identical on repeat, across a JSON round trip, and whatever order the evaluations arrive in', () => {
    const job = jobOf(GAME);
    const first = deriveReviewedMoveQuality(job);
    expect(deriveReviewedMoveQuality(job)).toEqual(first);
    expect(deriveReviewedMoveQuality(JSON.parse(JSON.stringify(job)) as ReviewCompletionJobRecord)).toEqual(first);
    // the decisions array is the arrival order: every rotation and the reverse give the same bits
    const orders: ReviewCompletionJobRecord[] = [];
    for (let r = 1; r < job.decisions.length; r += 1) {
      orders.push({ ...job, decisions: [...job.decisions.slice(r), ...job.decisions.slice(0, r)] });
    }
    orders.push({ ...job, decisions: [...job.decisions].reverse() });
    for (const permuted of orders) expect(deriveReviewedMoveQuality(permuted)).toEqual(first);
  });

  it('ignores the stored accuracyModelResult: it is recomputed from the evaluations', () => {
    const job = jobOf(GAME);
    const honest = deriveReviewedMoveQuality(job);
    const forged = { ...job, accuracyModelResult: { ...job.accuracyModelResult!, accuracy: 100, grade: 'S' as const } };
    expect(deriveReviewedMoveQuality(forged)).toEqual(honest);
    expect(deriveReviewedMoveQuality({ ...job, accuracyModelResult: null })).toEqual(honest);
  });

  describe('unavailable is explicit, never 0 or 100', () => {
    it('a job that is not finished', () => {
      const done = jobOf(GAME);
      for (const status of ['pending', 'running', 'failed_fatal'] as const) {
        expect(deriveReviewedMoveQuality({ ...done, status })).toMatchObject({ status: 'unavailable', avgMoveQuality: null, reason: 'review-incomplete' });
      }
    });

    it('a job with a decision still unresolved (partial coverage is never averaged as if complete)', () => {
      const done = jobOf(GAME);
      const partial = { ...done, decisions: done.decisions.map((d, i) => (i === 3 ? { ...d, lifecycle: 'PENDING' as const, evaluation: null } : d)) };
      expect(deriveReviewedMoveQuality(partial)).toMatchObject({ status: 'unavailable', avgMoveQuality: null, reason: 'review-incomplete' });
    });

    it('a job whose decisions do not cover the expected set', () => {
      const done = jobOf(GAME);
      expect(deriveReviewedMoveQuality({ ...done, decisions: done.decisions.slice(0, 4) })).toMatchObject({ status: 'unavailable', reason: 'review-incomplete' });
    });

    it('a heuristic-only decision means the job cannot be authoritatively complete', () => {
      const done = jobOf(GAME);
      const heuristic = { ...done, decisions: done.decisions.map((d, i) => (i === 1 ? { ...d, evaluation: evaluationFor(d.decisionId, { loss: 1.5, heuristic: true }) } : d)) };
      expect(deriveReviewedMoveQuality(heuristic)).toMatchObject({ status: 'unavailable', avgMoveQuality: null });
    });

    it('a decision whose search was cut by the wall-clock ceiling makes the stat unavailable, never a speed-dependent average', () => {
      const done = jobOf(GAME);
      const cut = (decision: (typeof done.decisions)[number], extra: Partial<ReviewEvaluationV1['search']>, diagnostic: string[]) => ({
        ...decision,
        evaluation: {
          ...decision.evaluation!,
          search: { ...decision.evaluation!.search, ...extra },
          diagnostics: [...decision.evaluation!.diagnostics, ...diagnostic],
        },
      });
      const truncated = { ...done, decisions: done.decisions.map((d, i) => (i === 1 ? cut(d, { complete: false }, [WALL_CLOCK_CEILING_DIAGNOSTIC]) : d)) };
      expect(deriveReviewedMoveQuality(truncated)).toMatchObject({ status: 'unavailable', avgMoveQuality: null, reason: 'wall-clock-truncated' });
      // node-budget exhaustion alone is machine-independent (seeded, same on any machine), so it does not suppress the stat
      const nodeBound = { ...done, decisions: done.decisions.map((d, i) => (i === 1 ? cut(d, { complete: false }, []) : d)) };
      expect(deriveReviewedMoveQuality(nodeBound)).toEqual(deriveReviewedMoveQuality(done));
      expect(deriveReviewedMoveQuality(nodeBound).status).toBe('available');
    });

    it('a player with no graded decision (every decision forced) has no number', () => {
      expect(deriveReviewedMoveQuality(jobOf([{ forced: true, loss: 0 }, { forced: true, loss: 0 }]))).toMatchObject({
        status: 'unavailable', avgMoveQuality: null, reason: 'no-graded-decisions',
      });
    });

    it('no decisions at all', () => {
      expect(deriveReviewedMoveQuality({ ...jobOf(GAME), decisions: [], expectedDecisionIds: [] })).toMatchObject({ status: 'unavailable', avgMoveQuality: null });
    });
  });

  describe('trust level: owner-only, the played action is client-asserted', () => {
    const everyShape: ReviewedMoveQuality[] = [
      deriveReviewedMoveQuality(jobOf(GAME)),
      deriveReviewedMoveQuality({ ...jobOf(GAME), status: 'pending' }),
      deriveReviewedMoveQuality(jobOf([{ forced: true, loss: 0 }])),
    ];

    it('every result, available or not, carries provenance and ownerOnly', () => {
      for (const quality of everyShape) {
        expect(quality.ownerOnly).toBe(true);
        expect(quality.provenance).toEqual({ candidateSet: 'server-derived', evaluation: 'server-evaluated', playedAction: 'client-asserted' });
      }
    });

    it('assertMoveQualityShareable refuses everything this module produces', () => {
      for (const quality of everyShape) {
        expect(() => assertMoveQualityShareable(quality)).toThrow(MoveQualityNotShareableError);
      }
      expect(() => assertMoveQualityShareable(everyShape[0]!)).toThrow(/client-asserted/);
      expect(() => assertMoveQualityShareable(everyShape[1]!)).toThrow(/unavailable \(review-incomplete\)/);
    });

    it('the gate opens only when provenance says the played action is server-authoritative (a real gate, not a hard throw)', () => {
      const available = everyShape[0]! as Extract<ReviewedMoveQuality, { status: 'available' }>;
      const attested: ReviewedMoveQuality = { ...available, provenance: { ...available.provenance, playedAction: 'server-authoritative' } };
      const shareable = assertMoveQualityShareable(attested);
      expect(shareable.avgMoveQuality).toBe(available.avgMoveQuality);
      expect(shareable.provenance.playedAction).toBe('server-authoritative');
      // an attested but unavailable value still has nothing to share
      expect(() => assertMoveQualityShareable({ ...everyShape[1]!, provenance: { ...everyShape[1]!.provenance, playedAction: 'server-authoritative' } })).toThrow(MoveQualityNotShareableError);
    });
  });
});
