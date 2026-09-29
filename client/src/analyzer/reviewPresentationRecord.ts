import type { ReviewAction, ReviewEvaluationV1 } from '@racehorse/game-core/review';
import {
  classifyHeuristicResult,
  type HeuristicClassification,
} from './classifyHeuristicResult';
import { lossBandLabelForEvaluation } from './gameAccuracyModel';
import type { ReviewCoachingFacts } from './reviewCoachingFacts';

/**
 * One canonical user-facing presentation record per reviewed decision.
 * Classification, WHY-this-rating, coaching prose, and board "Best move"
 * must all agree with this record — never independent truth sources.
 */
export type ReviewPresentationRecord = {
  readonly primaryReferenceSource: 'oracle' | 'unavailable';
  readonly primaryReferenceAction: ReviewAction | null;
  readonly lossVsPrimary: number | null;
  readonly classification: HeuristicClassification | null;
  readonly evidenceSource: ReviewEvaluationV1['evidence']['source'] | null;
  readonly contested: boolean;
  readonly playedMatchesPrimary: boolean;
};

function actionsEqual(a: ReviewAction, b: ReviewAction): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Builds the canonical presentation record from the resolved evaluation and
 * (when available) coaching facts that already applied D2 reference policy.
 */
export function buildReviewPresentationRecord(
  evaluation: ReviewEvaluationV1 | null | undefined,
  _coachingFacts: ReviewCoachingFacts | null | undefined,
): ReviewPresentationRecord {
  if (!evaluation) {
    return {
      primaryReferenceSource: 'unavailable',
      primaryReferenceAction: null,
      lossVsPrimary: null,
      classification: null,
      evidenceSource: null,
      contested: false,
      playedMatchesPrimary: false,
    };
  }

  const evidenceSource = evaluation.evidence.source;
  // The persisted evaluation object is the only authority. Coaching facts
  // can be legacy artifacts that encoded a second recommendation.
  const primaryReferenceAction = evaluation.best.action;

  const primaryReferenceSource: ReviewPresentationRecord['primaryReferenceSource'] =
    primaryReferenceAction == null
      ? 'unavailable'
      : 'oracle';

  const playedMatchesPrimary =
    primaryReferenceAction != null && actionsEqual(evaluation.played.action, primaryReferenceAction);

  const contested = false;

  let classification: HeuristicClassification | null;
  if (evidenceSource === 'heuristic') {
    // D2: Fritz-primary only when Fritz was actually resolved. Never treat
    // oracle evaluation.best as a Fritz stand-in — that recreates Blunder↔Best
    // contradictions and false "Good" when fixtures set best === played.
    classification = classifyHeuristicResult(evaluation);
  } else {
    const label = lossBandLabelForEvaluation(evaluation);
    classification = label ? { kind: 'calibrated', label } : { kind: 'forced' };
  }

  // Exact/search: loss is oracle-calibrated expected-point differential.
  // Heuristic: no fabricated Fritz-relative point claim; null when matched,
  // otherwise leave null so WHY copy stays qualitative.
  const lossVsPrimary =
    evidenceSource === 'heuristic'
      ? null
      : classification?.kind === 'forced'
        ? null
        : evaluation.loss.expectedPointDifferential;

  return {
    primaryReferenceSource,
    primaryReferenceAction,
    lossVsPrimary,
    classification,
    evidenceSource,
    contested,
    playedMatchesPrimary,
  };
}

/** Hard invariant A/B/C surface checks used by tests and debug asserts. */
export function assertPresentationConsistency(
  record: ReviewPresentationRecord,
  coachingHeadline: string | null | undefined,
): readonly string[] {
  const violations: string[] = [];
  const label = presentationLabel(record);
  const headline = coachingHeadline ?? '';

  if (record.playedMatchesPrimary) {
    if (label === 'Mistake' || label === 'Blunder' || label === 'Inaccuracy' || label === 'Good') {
      violations.push('played matches primary reference but classification is a severity label');
    }
    if (/\b(weakest|significant miss|meaningful miss|costliest|noticeably weaker|major miss)\b/i.test(headline)) {
      violations.push('played matches primary but coaching headline describes a miss');
    }
  }

  if (
    (/^Best move\./i.test(headline) || /^Solid pick\b/i.test(headline) || /^Top score\b/i.test(headline))
    && (label === 'Mistake' || label === 'Blunder')
  ) {
    violations.push('coaching affirms the move but classification is Mistake/Blunder');
  }

  if ((label === 'Mistake' || label === 'Blunder') && /^Best move\./i.test(headline)) {
    violations.push('Mistake/Blunder cannot pair with Best move prose');
  }

  if ((label === 'Mistake' || label === 'Blunder') && /even overall/i.test(headline)) {
    violations.push('Mistake/Blunder cannot pair with true-equality prose');
  }

  return violations;
}

export function presentationLabel(record: ReviewPresentationRecord): string | null {
  const c = record.classification;
  if (!c) return null;
  switch (c.kind) {
    case 'bucket':
      return c.bucket;
    case 'calibrated':
      return c.label;
    case 'estimate':
      return 'Estimate';
    case 'unavailable':
      return 'Unavailable';
    case 'forced':
      return 'Forced';
    case 'unclear':
      return 'Unclear';
  }
}
