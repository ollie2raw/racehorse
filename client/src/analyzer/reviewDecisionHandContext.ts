import type { TileTuple } from '../game/moveLogger';
import { sameTileTuple } from '../game/moveLogger';
import type { AnalyzedMove } from './moveAnalyzer';

/**
 * Tile-level role for the Game Review "Your hand" strip.
 *
 * A tile may have multiple legal placement actions (different ends/branches).
 * This contract is intentionally tile-level only — Playable means "at least one
 * legal play action exists for this tile identity." Exact end/branch remains
 * the job of the reference / best-move UI.
 */
export type ReviewDecisionHandTileRole = 'played' | 'playable' | 'held';

export type ReviewDecisionHandTile = {
  readonly tile: TileTuple;
  readonly role: ReviewDecisionHandTileRole;
};

/**
 * Normalized decision-context hand for live and historical GameReviewer.
 *
 * Source of truth: `AnalyzedMove.handBefore` (pre-move actor hand) +
 * `AnalyzedMove.validMoves` (tile identities with ≥1 legal play). Artifact v1
 * already persists these via `analysis.analyzedMoves[]` — no separate hand
 * field is required on the replay artifact.
 */
export type ReviewDecisionHandContext = {
  readonly action: AnalyzedMove['action'];
  readonly actorHand: readonly TileTuple[];
  readonly playedTile: TileTuple | null;
  readonly tiles: readonly ReviewDecisionHandTile[];
};

function isPlayableTile(tile: TileTuple, validMoves: readonly TileTuple[]): boolean {
  return validMoves.some((candidate) => sameTileTuple(candidate, tile));
}

/**
 * Build the actor-visible pre-move hand context for a selected analyzed move.
 * Preserves `handBefore` order (deterministic, scrub-stable). Marks at most one
 * tile as Played (first matching identity) and only for place actions.
 */
export function buildReviewDecisionHandContext(move: AnalyzedMove): ReviewDecisionHandContext {
  const playedTile =
    move.action === 'place' && move.playedTile ? move.playedTile : null;

  let playedMarked = false;
  const tiles: ReviewDecisionHandTile[] = move.handBefore.map((tile) => {
    const isPlayed = Boolean(playedTile) && !playedMarked && sameTileTuple(tile, playedTile!);
    if (isPlayed) playedMarked = true;
    if (isPlayed) {
      return { tile, role: 'played' };
    }
    if (isPlayableTile(tile, move.validMoves)) {
      return { tile, role: 'playable' };
    }
    return { tile, role: 'held' };
  });

  return {
    action: move.action,
    actorHand: move.handBefore,
    playedTile,
    tiles,
  };
}
