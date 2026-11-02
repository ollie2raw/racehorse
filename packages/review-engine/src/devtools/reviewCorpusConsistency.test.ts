import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ReviewAction, ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import { buildReviewCoachingFacts } from '../../../../client/src/analyzer/reviewCoachingFacts';
import { buildReviewCoachingProse } from '../../../../client/src/analyzer/reviewCoachingProse';
import {
  assertPresentationConsistency,
  buildReviewPresentationRecord,
  presentationLabel,
} from '../../../../client/src/analyzer/reviewPresentationRecord';

/**
 * The September production smoke failed on CONTRADICTIONS (a "Blunder" badge over "Best move" text), not on strength. `assertPresentationConsistency` and the spot
 * tests catch a contradiction someone thought of; this runs the whole real pipeline (evaluation -> coaching facts -> prose -> presentation record) over every
 * recorded decision in the committed corpus, all tiers, and requires no surface to disagree with another. A new class of contradiction should be added here as an
 * invariant, and this fails with the exact decision.
 *
 * The corpus is bot self-play (the recorded evaluations, including the heuristic ones), not human play.
 */
const CORPUS = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');

const same = (a: ReviewAction | null | undefined, b: ReviewAction | null | undefined) => JSON.stringify(a) === JSON.stringify(b);
const isForced = (e: ReviewEvaluationV1) => e.candidates.length <= 1;

type Audit = { violations: string[]; decisions: number; byTier: Record<string, number>; softened: number };

/**
 * The worst case for the second opinion: every search decision with a real choice comes back UNCONFIRMED (no rollouts needed to test the
 * presentation). The recorded corpus predates the field, so this is how the softened path meets real positions.
 */
function withUnconfirmedOpinion(evaluation: ReviewEvaluationV1): ReviewEvaluationV1 {
  if (evaluation.evidence.source !== 'search' || isForced(evaluation)) return evaluation;
  const kind = same(evaluation.played.action, evaluation.best.action) ? 'best' : 'error';
  return { ...evaluation, secondOpinion: { verdict: 'unconfirmed', kind, samples: 60, rolloutMargin: kind === 'best' ? 1.5 : -0.5 } };
}

/** Independent literal of the documented softening (one grade milder), not imported from the implementation. */
const ONE_GRADE_SOFTER: Record<string, string> = { Best: 'Good', Inaccuracy: 'Good', Mistake: 'Inaccuracy', Blunder: 'Inaccuracy' };

function auditCorpus(mode: 'as-recorded' | 'all-unconfirmed' = 'as-recorded'): Audit {
  const violations: string[] = [];
  const byTier: Record<string, number> = {};
  let decisions = 0;
  let softened = 0;
  for (const { snapshot, evaluation: recorded, file } of replayRecordedSelfPlay(CORPUS)) {
    const evaluation = mode === 'all-unconfirmed' ? withUnconfirmedOpinion(recorded) : recorded;
    const ctx = `${file}#${snapshot.identifiers.decisionId}`;
    const facts = buildReviewCoachingFacts(evaluation, snapshot, true);
    const record = buildReviewPresentationRecord(evaluation, facts);
    const label = presentationLabel(record);
    const headline = buildReviewCoachingProse(facts, true).headline;
    const source = evaluation.evidence.source;
    decisions += 1;
    byTier[source] = (byTier[source] ?? 0) + 1;
    const add = (message: string) => violations.push(`${ctx} [${source}] ${message} (label=${label}, headline="${headline}")`);

    if (isForced(evaluation)) continue;

    // A. the existing cross-surface assertions, on real data
    for (const v of assertPresentationConsistency(record, headline)) add(v);

    // B. every non-forced decision has a label
    if (!label) add('non-forced decision has no label');

    // C. a heuristic result never wears a calibrated severity badge (it has no calibrated loss)
    if (source === 'heuristic' && record.classification?.kind === 'calibrated') add('heuristic result carries a calibrated badge');

    // D. the board's "best move" (the record) is the evaluation's best move
    if (!same(record.primaryReferenceAction, evaluation.best.action)) add('presentation reference differs from the evaluation best');

    // E. the coaching facts' reference is the same move the board shows (the second-recommendation bug class). Heuristic results may name Fritz's read by design.
    if (source !== 'heuristic' && !same(facts.best.action, evaluation.best.action)) add('coaching facts name a different best move than the board');

    // F. the played move in the facts is the move that was played
    if (!same(facts.played.action, evaluation.played.action)) add('coaching facts describe a different played move');

    // G. for exact/search, the reported loss is best minus played, and never negative
    if (source !== 'heuristic') {
      const gap = evaluation.best.value.expectedPointDifferential - evaluation.played.value.expectedPointDifferential;
      if (evaluation.loss.expectedPointDifferential < -1e-9) add(`negative loss ${evaluation.loss.expectedPointDifferential}`);
      if (Math.abs(evaluation.loss.expectedPointDifferential - Math.max(0, gap)) > 0.01) add(`loss ${evaluation.loss.expectedPointDifferential} is not best minus played (${gap})`);
    }

    // H. playing the reference move is never graded below Best, except a Best the whole-hand second opinion did not confirm (shown as Good on purpose)
    const softenedBest = record.softenedBySecondOpinion === true && label === 'Good';
    if (record.playedMatchesPrimary && !softenedBest && label && label !== 'Best' && label !== 'Estimate' && label !== 'Forced' && label !== 'Unclear' && label !== 'Unavailable') {
      add('played the reference move but graded below Best');
    }

    // I. a softened verdict is strictly milder than the same decision without the opinion, never states a gap as settled, and never claims "Best move."
    if (record.softenedBySecondOpinion) {
      softened += 1;
      const unsoftened = presentationLabel(buildReviewPresentationRecord(recorded, buildReviewCoachingFacts(recorded, snapshot, true)));
      if (ONE_GRADE_SOFTER[unsoftened ?? ''] !== label) add(`softened label is not exactly one grade softer than ${unsoftened}`);
      if (/\bby about\b|^Best move\.|\b(weakest|significant miss|meaningful miss|costliest|noticeably weaker|major miss)\b/i.test(headline)) add('softened verdict still states the severity in the headline');
    } else if (mode === 'all-unconfirmed' && evaluation.secondOpinion && label !== 'Best' && source === 'search') {
      // a search decision given an unconfirmed opinion was softened or was a Best-tolerance error: either way it must be flagged when it changed
      if (label !== presentationLabel(buildReviewPresentationRecord(recorded, buildReviewCoachingFacts(recorded, snapshot, true)))) add('label changed without the softened flag');
    }
  }
  return { violations, decisions, byTier, softened };
}

describe('review presentation: no surface contradicts another, on the whole recorded corpus', () => {
  const audit = auditCorpus();

  it('audits a real corpus across every tier (so a clean result means something)', () => {
    expect(audit.decisions).toBeGreaterThan(1000);
    expect(Object.keys(audit.byTier).sort()).toEqual(['exact', 'heuristic', 'search']);
  });

  it('finds no contradiction between the badge, the prose, the board and the numbers', () => {
    // Printed in full on failure, so the failing decision is identifiable from the report alone.
    expect(audit.violations.slice(0, 25)).toEqual([]);
    expect(audit.violations.length).toBe(0);
  });
});

describe('review presentation: still no contradiction when EVERY search verdict is softened by the second opinion', () => {
  const audit = auditCorpus('all-unconfirmed');

  it('softens a real share of the corpus (so a clean result means something)', () => {
    expect(audit.softened).toBeGreaterThan(200);
  });

  it('finds no contradiction between the softened badge, the prose, the board and the numbers', () => {
    expect(audit.violations.slice(0, 25)).toEqual([]);
    expect(audit.violations.length).toBe(0);
  });
});
