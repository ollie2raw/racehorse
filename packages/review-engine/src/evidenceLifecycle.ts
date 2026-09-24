import type {
  ReviewKnownMissingPipEvidence,
  ReviewPositionSnapshotV2,
  ReviewPublicActionEvent,
} from '@racehorse/game-core/review';
import { generateFullSet, tileEquals, type Tile } from '@racehorse/game-core';
import { tilesOnBoard } from '@racehorse/game-core/invariants';

/**
 * Causal missing-pip evidence lifecycle.
 *
 * Information semantics (1v1 public observation):
 * - `passed_on_open_end` at sequence S: opponent's hand at S contained no
 *   tile matching the then-open ends. Plays after S only remove tiles, so
 *   the exclusion remains valid until the opponent next draws.
 * - `drew_past_open_end` at sequence S: opponent lacked matching pips in the
 *   pre-draw hand, then acquired one unknown tile. That observation never
 *   constrains the post-draw hand — the drawn tile may carry the pip.
 * - Any later opponent draw at S' > S invalidates all prior pass evidence:
 *   the opponent may have drawn the previously-excluded pip.
 *
 * Evidence is never dropped merely because C(n,k)=0. If causal retention
 * still yields zero feasible worlds, we report the minimal conflicting set
 * for diagnostics (capture-integrity investigation), without silently
 * discarding still-valid constraints.
 */

export type EvidenceInvalidationReason =
  | 'draw_acquired_unknown_tile'
  | 'superseded_by_later_opponent_draw'
  | 'pre_draw_observation_only';

export type EvidenceInvalidation = {
  readonly evidence: ReviewKnownMissingPipEvidence;
  readonly reason: EvidenceInvalidationReason;
  readonly invalidatedBySequence: number | null;
};

export type EvidenceLifecycleResolution = {
  readonly effectiveEvidence: readonly ReviewKnownMissingPipEvidence[];
  readonly invalidated: readonly EvidenceInvalidation[];
  readonly policy: 'hard' | 'causal-epoch' | 'conflict-diagnosed';
  /** Present when retained evidence still yields C(n,k)=0. */
  readonly minimalConflictSet: readonly ReviewKnownMissingPipEvidence[] | null;
  readonly opponentDrawSequences: readonly number[];
  readonly lastOpponentDrawSequence: number | null;
};

function eligibleCount(
  hiddenPool: readonly Tile[],
  evidence: readonly ReviewKnownMissingPipEvidence[],
): number {
  const excludedPips = new Set(evidence.map((row) => row.pip));
  return hiddenPool.filter(
    (tile) => !excludedPips.has(tile.low) && !excludedPips.has(tile.high),
  ).length;
}

function opponentDrawSequencesFromHistory(
  history: readonly ReviewPublicActionEvent[] | undefined,
  opponentId: string,
): number[] {
  if (!history || history.length === 0) return [];
  return history
    .filter((event) => event.actorId === opponentId && event.kind === 'draw')
    .map((event) => event.sequence)
    .sort((a, b) => a - b);
}

/**
 * Fallback when publicActionHistory was not captured: treat each
 * `drew_past_open_end` observation as a draw marker at its sequence.
 */
function opponentDrawSequencesFromEvidence(
  evidence: readonly ReviewKnownMissingPipEvidence[],
  opponentId: string,
): number[] {
  const seqs = new Set<number>();
  for (const row of evidence) {
    if (row.opponentId !== opponentId) continue;
    if (row.reason === 'drew_past_open_end') seqs.add(row.observedSequence);
  }
  return [...seqs].sort((a, b) => a - b);
}

function findMinimalConflictSet(
  hiddenPool: readonly Tile[],
  evidence: readonly ReviewKnownMissingPipEvidence[],
  opponentTileCount: number,
): readonly ReviewKnownMissingPipEvidence[] | null {
  if (eligibleCount(hiddenPool, evidence) >= opponentTileCount) return null;
  // Greedy: drop one constraint at a time preferring highest sequence;
  // report the smallest suffix that still conflicts (diagnostic only).
  const ordered = [...evidence].sort(
    (a, b) => b.observedSequence - a.observedSequence || b.pip - a.pip,
  );
  let working = [...ordered];
  while (working.length > 0 && eligibleCount(hiddenPool, working) < opponentTileCount) {
    working = working.slice(0, -1);
  }
  // Conflict set = constraints that must be removed to restore feasibility.
  const kept = new Set(working.map((row) => `${row.pip}@${row.observedSequence}@${row.reason}`));
  return evidence.filter((row) => !kept.has(`${row.pip}@${row.observedSequence}@${row.reason}`));
}

export function resolveCausalEvidence(
  snapshot: ReviewPositionSnapshotV2,
  maxPips = 6,
): EvidenceLifecycleResolution {
  const { actorHand, board, knownMissingPipEvidence, opponentTileCount } = snapshot.preAction;
  const opponentId = snapshot.identifiers.opponentId;
  const knownTiles = [...actorHand, ...tilesOnBoard(board)];
  const hiddenPool = generateFullSet(maxPips).filter(
    (tile) => !knownTiles.some((known) => tileEquals(known, tile)),
  );

  const fromHistory = opponentDrawSequencesFromHistory(
    snapshot.publicActionHistory,
    opponentId,
  );
  const opponentDrawSequences =
    fromHistory.length > 0
      ? fromHistory
      : opponentDrawSequencesFromEvidence(knownMissingPipEvidence, opponentId);
  const lastOpponentDrawSequence =
    opponentDrawSequences.length > 0
      ? opponentDrawSequences[opponentDrawSequences.length - 1]!
      : null;

  const effective: ReviewKnownMissingPipEvidence[] = [];
  const invalidated: EvidenceInvalidation[] = [];

  for (const row of knownMissingPipEvidence) {
    if (row.opponentId !== opponentId) {
      // Evidence about other seats is not applied to this decision's opponent pool.
      invalidated.push({
        evidence: row,
        reason: 'superseded_by_later_opponent_draw',
        invalidatedBySequence: null,
      });
      continue;
    }

    if (row.reason === 'drew_past_open_end') {
      // Pre-draw observation only — post-draw hand may hold the pip.
      invalidated.push({
        evidence: row,
        reason: 'pre_draw_observation_only',
        invalidatedBySequence: row.observedSequence,
      });
      continue;
    }

    if (row.reason === 'authority_observation') {
      // Authority observations are treated as hard for the observed epoch;
      // still invalidate if a later draw could have reintroduced the pip.
      if (lastOpponentDrawSequence !== null && row.observedSequence <= lastOpponentDrawSequence) {
        invalidated.push({
          evidence: row,
          reason: 'superseded_by_later_opponent_draw',
          invalidatedBySequence: lastOpponentDrawSequence,
        });
        continue;
      }
      effective.push(row);
      continue;
    }

    // passed_on_open_end
    if (lastOpponentDrawSequence !== null && row.observedSequence <= lastOpponentDrawSequence) {
      invalidated.push({
        evidence: row,
        reason: 'superseded_by_later_opponent_draw',
        invalidatedBySequence: lastOpponentDrawSequence,
      });
      continue;
    }

    effective.push(row);
  }

  const feasible = eligibleCount(hiddenPool, effective) >= opponentTileCount;
  if (feasible) {
    const policy =
      invalidated.length === 0 && effective.length === knownMissingPipEvidence.length
        ? 'hard'
        : 'causal-epoch';
    return {
      effectiveEvidence: effective,
      invalidated,
      policy,
      minimalConflictSet: null,
      opponentDrawSequences,
      lastOpponentDrawSequence,
    };
  }

  return {
    effectiveEvidence: effective,
    invalidated,
    policy: 'conflict-diagnosed',
    minimalConflictSet: findMinimalConflictSet(hiddenPool, effective, opponentTileCount),
    opponentDrawSequences,
    lastOpponentDrawSequence,
  };
}

/**
 * Snapshot view with causally-valid evidence applied (additive, non-mutating).
 */
export function snapshotWithCausalEvidence(
  snapshot: ReviewPositionSnapshotV2,
  maxPips = 6,
): {
  readonly snapshot: ReviewPositionSnapshotV2;
  readonly resolution: EvidenceLifecycleResolution;
} {
  const resolution = resolveCausalEvidence(snapshot, maxPips);
  if (
    resolution.policy === 'hard'
    && resolution.effectiveEvidence === snapshot.preAction.knownMissingPipEvidence
  ) {
    return { snapshot, resolution };
  }
  return {
    snapshot: {
      ...snapshot,
      preAction: {
        ...snapshot.preAction,
        knownMissingPipEvidence: resolution.effectiveEvidence,
      },
    },
    resolution,
  };
}
