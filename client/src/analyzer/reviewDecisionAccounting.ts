import { dedupeCandidatesByTile } from '@racehorse/game-core/review';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import type { MoveEntry } from '../game/moveLogger';
import type { AnalyzedMove } from './moveAnalyzer';

/**
 * Canonical user-facing review unit = one player decision.
 * Raw telemetry / moveLog.moveNumber / snapshot actionNumber are internal.
 */
export type PlayerDecisionStatus =
  | 'scored' // exact|search, non-forced
  | 'estimate' // heuristic, non-forced
  | 'forced'
  | 'unavailable'
  | 'pending';

export type PlayerDecisionLedgerEntry = {
  /** 1-based sequential index across the reviewed player-decision list. */
  readonly decisionIndex: number;
  /** Internal moveLog moveNumber (may include opponent gaps; never shown as the primary ID). */
  readonly rawMoveNumber: number;
  readonly decisionId: string | null;
  readonly status: PlayerDecisionStatus;
  readonly evidenceSource: ReviewEvaluationV1['evidence']['source'] | null;
};

export type PlayerDecisionLedgerSummary = {
  readonly scoredCount: number;
  readonly estimateCount: number;
  readonly forcedCount: number;
  readonly unavailableCount: number;
  readonly pendingCount: number;
  readonly totalDecisions: number;
  readonly entries: readonly PlayerDecisionLedgerEntry[];
};

function isForcedFromEvaluation(evaluation: ReviewEvaluationV1): boolean {
  return dedupeCandidatesByTile(evaluation.candidates).length <= 1;
}

function isForcedFromMove(move: AnalyzedMove | MoveEntry): boolean {
  // validMoves lists distinct legal tiles (not placements). One tile ⇒ forced.
  return Array.isArray(move.validMoves) && move.validMoves.length === 1;
}

/**
 * Builds the player-decision ledger for Game Review.
 *
 * Identity (must hold for a complete modern review once the batch is done):
 *   totalDecisions
 *     = scored + estimate + forced + unavailable
 *     = analyzedMoves.length (every human decision appears exactly once)
 *
 * Nothing may silently disappear from the sidebar.
 */
export function buildPlayerDecisionLedger(args: {
  readonly analyzedMoves: readonly AnalyzedMove[];
  readonly decisionIdByMoveNumber: ReadonlyMap<number, string> | null | undefined;
  readonly resultsByDecisionId: ReadonlyMap<string, ReviewEvaluationV1>;
  readonly errorsByDecisionId: ReadonlyMap<string, unknown>;
  readonly pendingDecisionIds: ReadonlySet<string>;
  readonly batchDone: boolean;
}): PlayerDecisionLedgerSummary {
  const {
    analyzedMoves,
    decisionIdByMoveNumber,
    resultsByDecisionId,
    errorsByDecisionId,
    pendingDecisionIds,
    batchDone,
  } = args;

  const entries: PlayerDecisionLedgerEntry[] = analyzedMoves.map((move, idx) => {
    const decisionId = decisionIdByMoveNumber?.get(move.moveNumber) ?? null;
    const evaluation = decisionId ? resultsByDecisionId.get(decisionId) : undefined;
    const errored = decisionId ? errorsByDecisionId.has(decisionId) : false;
    const pending = decisionId ? pendingDecisionIds.has(decisionId) : false;

    let status: PlayerDecisionStatus;
    let evidenceSource: ReviewEvaluationV1['evidence']['source'] | null = null;

    if (evaluation) {
      evidenceSource = evaluation.evidence.source;
      if (isForcedFromEvaluation(evaluation)) {
        status = 'forced';
      } else if (evidenceSource === 'heuristic') {
        status = 'estimate';
      } else {
        status = 'scored';
      }
    } else if (!batchDone && (pending || (decisionId != null && !errored))) {
      status = 'pending';
    } else if (isForcedFromMove(move)) {
      // Batch done (or no modern batch) and no evaluation: still recognize
      // forced from the move log so forced never silently becomes "scored."
      status = decisionId == null || errored || batchDone ? 'forced' : 'pending';
    } else if (!decisionId || errored || batchDone) {
      status = 'unavailable';
    } else {
      status = 'pending';
    }

    return {
      decisionIndex: idx + 1,
      rawMoveNumber: move.moveNumber,
      decisionId,
      status,
      evidenceSource,
    };
  });

  return summarizeLedger(entries);
}

export function summarizeLedger(entries: readonly PlayerDecisionLedgerEntry[]): PlayerDecisionLedgerSummary {
  let scoredCount = 0;
  let estimateCount = 0;
  let forcedCount = 0;
  let unavailableCount = 0;
  let pendingCount = 0;
  for (const entry of entries) {
    switch (entry.status) {
      case 'scored':
        scoredCount += 1;
        break;
      case 'estimate':
        estimateCount += 1;
        break;
      case 'forced':
        forcedCount += 1;
        break;
      case 'unavailable':
        unavailableCount += 1;
        break;
      case 'pending':
        pendingCount += 1;
        break;
    }
  }
  return {
    scoredCount,
    estimateCount,
    forcedCount,
    unavailableCount,
    pendingCount,
    totalDecisions: entries.length,
    entries,
  };
}

/**
 * Explicit accounting copy for the post-game summary.
 * Replaces ambiguous "N of M moves analyzed".
 */
export function formatDecisionAccountingSummary(summary: PlayerDecisionLedgerSummary): string {
  const parts: string[] = [`${summary.scoredCount} scored`];
  if (summary.estimateCount > 0) parts.push(`${summary.estimateCount} estimate`);
  if (summary.forcedCount > 0) parts.push(`${summary.forcedCount} forced`);
  if (summary.unavailableCount > 0) parts.push(`${summary.unavailableCount} unavailable`);
  if (summary.pendingCount > 0) parts.push(`${summary.pendingCount} pending`);
  parts.push(`${summary.totalDecisions} total decisions`);
  return parts.join(' · ');
}

/**
 * Legacy accuracyModel coverage line meaning (pre-integrity fix), kept for
 * audit/docs: scorableNonForced / totalNonForced among worker evaluations only.
 * Forced decisions were already excluded from both sides; the gap was
 * heuristic-tier non-forced decisions — not forced moves.
 */
export function legacyCoverageCounts(accuracyModel: {
  readonly totalNonForcedMoveCount: number;
  readonly heuristicMoveCount: number;
}): { readonly scorableNonForced: number; readonly totalNonForced: number } {
  return {
    scorableNonForced: accuracyModel.totalNonForcedMoveCount - accuracyModel.heuristicMoveCount,
    totalNonForced: accuracyModel.totalNonForcedMoveCount,
  };
}
