import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import type { HandMoveSegment, HandVerdict } from './analysisTypes';

/**
 * Authoritative per-hand scoring for the review.
 *
 * The move log's `pointsScored` is the score of each PLAY. It never contains the end-of-hand award the engine applies when a
 * hand is won by going out (sum of the opponent's remaining tile penalties) or blocked (blocked-hand rule), so a verdict built
 * from log points reports the wrong winner, margin and totals for most hands. The engine's own scoreboard is authoritative:
 * the captured snapshot of the first decision of hand N+1 carries both players' scores exactly as the engine had them when
 * hand N ended, and the final hand ends at the final match score.
 */
export type SeatScores = { you: number; opponent: number };
export type HandScoreBoundary = { start: SeatScores; end: SeatScores | null };

const DEFAULT_YOU_SEAT = 'you';

function seatScores(snapshot: ReviewPositionSnapshotV2, youActorId: string): SeatScores | null {
  const actorId = snapshot?.identifiers?.actorId;
  const opponentId = snapshot?.identifiers?.opponentId;
  const actor = snapshot?.preAction?.scores?.actor;
  const opponent = snapshot?.preAction?.scores?.opponent;
  if (typeof actor !== 'number' || typeof opponent !== 'number') return null;
  if (actorId === youActorId) return { you: actor, opponent };
  if (opponentId === youActorId) return { you: opponent, opponent: actor };
  return null;
}

/** hand number -> engine scores at its start, and at its end when the next hand (or the final score) is known. */
export function authoritativeHandBoundaries(
  snapshots: readonly ReviewPositionSnapshotV2[],
  finalScores?: SeatScores | null,
  youActorId: string = DEFAULT_YOU_SEAT,
): Map<number, HandScoreBoundary> {
  const firstByHand = new Map<number, { actionNumber: number; scores: SeatScores }>();
  for (const snapshot of snapshots) {
    const scores = seatScores(snapshot, youActorId);
    if (!scores) continue;
    const hand = snapshot.identifiers.handNumber ?? Number.NaN;
    if (!Number.isFinite(hand)) continue;
    const seen = firstByHand.get(hand);
    if (!seen || snapshot.identifiers.actionNumber < seen.actionNumber) {
      firstByHand.set(hand, { actionNumber: snapshot.identifiers.actionNumber, scores });
    }
  }
  const hands = [...firstByHand.keys()].sort((a, b) => a - b);
  const result = new Map<number, HandScoreBoundary>();
  hands.forEach((hand, index) => {
    const next = hands[index + 1];
    const end = next !== undefined ? firstByHand.get(next)!.scores : (finalScores ?? null);
    result.set(hand, { start: firstByHand.get(hand)!.scores, end });
  });
  return result;
}

export function verdictFromScores(start: SeatScores, end: SeatScores): HandVerdict {
  const pointsYou = end.you - start.you;
  const pointsOpponent = end.opponent - start.opponent;
  const margin = pointsYou - pointsOpponent;
  return {
    winner: margin > 0 ? 'you' : margin < 0 ? 'opponent' : 'tie',
    pointsYou,
    pointsOpponent,
    margin: Math.abs(margin),
    source: 'engine-scoreboard',
  };
}

/** Replace log-derived scores with the engine scoreboard wherever it is known; otherwise keep the log-derived segment. */
export function applyAuthoritativeScores(
  segments: readonly HandMoveSegment[],
  boundaries: ReadonlyMap<number, HandScoreBoundary>,
): HandMoveSegment[] {
  return segments.map((segment) => {
    const boundary = boundaries.get(segment.handNumber);
    if (!boundary?.end) return segment;
    return { ...segment, startingScores: boundary.start, endingScores: boundary.end };
  });
}
