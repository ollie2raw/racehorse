import { getLegalMoves } from '../game/engine';
import { computePlayScore, simulatePlacement } from '../game/scoring';
import type { PlacementPosition, Tile } from '../game/types';
import { buildAnalysisState, parseGhostBoardState, parseTileKey } from './service';
import type { GhostMoveLogEntry } from './service';

export type GhostMoveLogVerificationResult =
  | { ok: true }
  | { ok: false; reason: string; entryIndex: number };

function tilesEqual(a: Tile, b: Tile): boolean {
  return a.low === b.low && a.high === b.high;
}

function isPlacementPosition(value: string | null): value is PlacementPosition {
  return value === 'left' || value === 'right' || /^branch-\d+-\d+$/.test(value ?? '');
}

function handsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

/**
 * Replays the submitting player's own moves through the authoritative game-core
 * engine (getLegalMoves / simulatePlacement / computePlayScore — the same rules
 * used server-side for Daily Fritz and for ghost style analysis) to confirm that:
 *   - Each played tile/position was actually legal given the board and hand at
 *     that point.
 *   - A claimed draw/pass only occurs when no legal play existed.
 *   - Hand contents are internally consistent turn-to-turn within a hand.
 *   - The reported score_delta for any move that does NOT empty the player's
 *     hand (i.e. cannot trigger a go-out bonus) exactly matches the score the
 *     engine computes for that placement.
 *
 * Note: the go-out and blocked-hand end-of-hand bonuses (config.endHandBonus =
 * 'sumOpponentPenalties') depend on the opponent's hand at that moment, which
 * this transcript format does not capture, so score_delta on a hand-ending
 * move is only checked as a lower bound. This keeps legitimate wins from being
 * rejected while still rejecting fabricated mid-hand scores and illegal moves.
 */
export function verifyPlayerMoveLog(moveLog: GhostMoveLogEntry[]): GhostMoveLogVerificationResult {
  let previousHand: string[] | null = null;
  let previousHandNumber: number | null = null;
  let previousTilePlayed: string | null = null;

  for (let i = 0; i < moveLog.length; i += 1) {
    const entry = moveLog[i];
    if (entry.actor === 'ghost') continue;

    const handNumber = entry.hand_number ?? null;
    const sameHand = previousHandNumber != null && handNumber === previousHandNumber;

    if (sameHand && previousHand != null) {
      const expectedHand = previousTilePlayed
        ? previousHand.filter((tile, index) => {
            const removedIndex = previousHand!.indexOf(previousTilePlayed!);
            return index !== removedIndex;
          })
        : previousHand;
      if (!handsMatch(expectedHand, entry.hand_before)) {
        return { ok: false, reason: 'hand_before is not consistent with the prior move in this hand.', entryIndex: i };
      }
    }

    const board = parseGhostBoardState(entry.board_state);
    const hand = entry.hand_before
      .map((tileKey) => parseTileKey(tileKey))
      .filter((tile): tile is Tile => tile != null);

    if (entry.tile_played == null) {
      const state = buildAnalysisState(board, hand);
      const legalPlays = getLegalMoves(state, 'you').filter((move) => move.type === 'play');
      if (legalPlays.length > 0) {
        return {
          ok: false,
          reason: 'Move claims a draw/pass but a legal play existed for the reported hand and board.',
          entryIndex: i,
        };
      }
    } else {
      const tile = parseTileKey(entry.tile_played);
      if (!tile) {
        return { ok: false, reason: 'tile_played could not be parsed.', entryIndex: i };
      }
      if (!isPlacementPosition(entry.branch)) {
        return { ok: false, reason: 'branch is not a valid placement position.', entryIndex: i };
      }
      const position = entry.branch as PlacementPosition;
      const state = buildAnalysisState(board, hand);
      const legalPlays = getLegalMoves(state, 'you').filter(
        (move): move is Extract<typeof move, { type: 'play' }> => move.type === 'play',
      );
      const isLegal = legalPlays.some((move) => tilesEqual(move.tile, tile) && move.position === position);
      if (!isLegal) {
        return {
          ok: false,
          reason: 'Reported tile/position is not a legal move for the reported hand and board.',
          entryIndex: i,
        };
      }

      const afterBoard = simulatePlacement(board, tile, position);
      const computedScore = computePlayScore(afterBoard, state.config);
      const goesOut = hand.length === 1;
      if (goesOut) {
        if (entry.score_delta < computedScore) {
          return {
            ok: false,
            reason: 'score_delta is lower than the engine-computed score for this placement.',
            entryIndex: i,
          };
        }
      } else if (entry.score_delta !== computedScore) {
        return {
          ok: false,
          reason: `score_delta (${entry.score_delta}) does not match engine-computed score (${computedScore}) for this placement.`,
          entryIndex: i,
        };
      }
    }

    previousHand = entry.hand_before;
    previousHandNumber = handNumber;
    previousTilePlayed = entry.tile_played;
  }

  return { ok: true };
}
