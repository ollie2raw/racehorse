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

function removeOneTileKey(hand: string[], tileKey: string): string[] {
  const index = hand.indexOf(tileKey);
  if (index < 0) return [...hand];
  return hand.filter((_, i) => i !== index);
}

function addOneTileKey(hand: string[], tileKey: string): string[] {
  return [...hand, tileKey];
}

function isDrawBranch(branch: string | null | undefined): boolean {
  return branch === 'draw';
}

/** True when `actual` contains every tile in `expected` plus zero or more extra tiles (unlogged draws). */
function handAllowsLegacyUnloggedDraws(expected: string[], actual: string[]): boolean {
  if (handsMatch(expected, actual)) return true;
  if (actual.length < expected.length) return false;
  const expectedCopy = [...expected];
  for (const tile of actual) {
    const index = expectedCopy.indexOf(tile);
    if (index >= 0) expectedCopy.splice(index, 1);
  }
  return expectedCopy.length === 0;
}

export type VerifyPlayerMoveLogOptions = {
  /**
   * Only exact hand chains pass — no tolerance for unlogged boneyard draws
   * bridging one move's hand_after to the next move's hand_before.
   *
   * **Defaults to `true`.** A call site that needs the lenient legacy
   * behaviour must opt out *visibly* with `{ strictHandContinuity: false }`.
   * This inversion is Guardrail #4 (ENGINEERING_GUARDRAILS.md §4): RT-2 was
   * a call site that silently omitted this option and got leniency it never
   * meant to ask for. Omission now means strict; leniency is a deliberate,
   * reviewable act. INV-18 in `check:architecture` fails CI if this default
   * is ever flipped back.
   */
  strictHandContinuity?: boolean;
};

function logHasLegacyDrawCaptureShape(moveLog: GhostMoveLogEntry[]): boolean {
  return moveLog.some(
    (entry) =>
      isDrawBranch(entry.branch) &&
      (entry.drawn_tile == null || entry.drawn_tile === ''),
  );
}

function moveHasLoggedDrawSteps(
  moveLog: GhostMoveLogEntry[],
  moveIndex: number,
  handNumber: number | null,
): boolean {
  return moveLog.slice(moveIndex + 1).some((next) => {
    if (next.actor === 'ghost') return false;
    if (handNumber != null && next.hand_number != null && next.hand_number !== handNumber) return false;
    return isDrawBranch(next.branch) && next.drawn_tile != null && next.drawn_tile !== '';
  });
}

function multisetDiffAdded(actual: string[], base: string[]): string[] {
  const baseCopy = [...base];
  const added: string[] = [];
  for (const tile of actual) {
    const index = baseCopy.indexOf(tile);
    if (index >= 0) baseCopy.splice(index, 1);
    else added.push(tile);
  }
  return added;
}

function findNextPlayerHandAnchor(
  moveLog: GhostMoveLogEntry[],
  fromIndex: number,
  handNumber: number | null,
): GhostMoveLogEntry | null {
  for (let j = fromIndex + 1; j < moveLog.length; j += 1) {
    const next = moveLog[j];
    if (next.actor === 'ghost') continue;
    if (
      handNumber != null &&
      next.hand_number != null &&
      next.hand_number !== handNumber
    ) {
      return null;
    }
    if (isDrawBranch(next.branch)) continue;
    return next;
  }
  return null;
}

function inferLegacyDrawnTile(
  moveLog: GhostMoveLogEntry[],
  drawIndex: number,
  handBefore: string[],
): string | null {
  const drawHandNumber = moveLog[drawIndex]?.hand_number ?? null;
  for (let j = drawIndex + 1; j < moveLog.length; j += 1) {
    const next = moveLog[j];
    if (next.actor === 'ghost') continue;
    if (
      drawHandNumber != null &&
      next.hand_number != null &&
      next.hand_number !== drawHandNumber
    ) {
      break;
    }

    const added = multisetDiffAdded(next.hand_before, handBefore);
    if (added.length === 1) return added[0] ?? null;
    if (!isDrawBranch(next.branch)) break;
  }

  const nextAnchor = findNextPlayerHandAnchor(moveLog, drawIndex, drawHandNumber);
  if (nextAnchor && nextAnchor.tile_played != null) {
    const handAfterPlay = removeOneTileKey(nextAnchor.hand_before, nextAnchor.tile_played);
    const addedTiles = multisetDiffAdded(handAfterPlay, handBefore);
    if (addedTiles.length === 1) return addedTiles[0] ?? null;
  }

  return null;
}

function assertHandContinuity(
  expectedHand: string[],
  actualHand: string[],
  moveLog: GhostMoveLogEntry[],
  entryIndex: number,
  previousEntry: GhostMoveLogEntry | null,
  handNumber: number | null,
  strictHandContinuity: boolean,
): GhostMoveLogVerificationResult | null {
  if (handsMatch(expectedHand, actualHand)) return null;
  if (strictHandContinuity) {
    return {
      ok: false,
      reason: 'hand_before is not consistent with the prior move in this hand.',
      entryIndex,
    };
  }

  const legacyDrawCapture =
    logHasLegacyDrawCaptureShape(moveLog) ||
    Boolean(previousEntry?.forced_draw && !moveHasLoggedDrawSteps(moveLog, entryIndex - 1, previousEntry.hand_number ?? null)) ||
    (handNumber != null && actualHand.length > expectedHand.length);

  if (
    legacyDrawCapture &&
    handAllowsLegacyUnloggedDraws(expectedHand, actualHand)
  ) {
    return null;
  }

  return {
    ok: false,
    reason: 'hand_before is not consistent with the prior move in this hand.',
    entryIndex,
  };
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
 *
 * Legacy live-room logs may omit per-tile draw steps or drawn_tile on draw
 * branches; those gaps are tolerated only when hand_before remains a superset
 * of the expected post-move hand (unlogged boneyard draws).
 */
export function verifyPlayerMoveLog(
  moveLog: GhostMoveLogEntry[],
  options: VerifyPlayerMoveLogOptions = {},
): GhostMoveLogVerificationResult {
  // Guardrail #4: defaults to strict. Lenient is opt-out only — see
  // VerifyPlayerMoveLogOptions. INV-18 pins this `?? true`.
  const strictHandContinuity = options.strictHandContinuity ?? true;
  let previousHand: string[] | null = null;
  let previousHandNumber: number | null = null;
  let previousTilePlayed: string | null = null;
  let previousEntry: GhostMoveLogEntry | null = null;

  for (let i = 0; i < moveLog.length; i += 1) {
    const entry = moveLog[i];
    if (entry.actor === 'ghost') continue;

    const handNumber = entry.hand_number ?? null;
    const sameHand = previousHandNumber != null && handNumber === previousHandNumber;

    if (isDrawBranch(entry.branch)) {
      const drawnTile = entry.drawn_tile?.trim() || inferLegacyDrawnTile(moveLog, i, entry.hand_before);
      const nextAnchor = drawnTile
        ? null
        : findNextPlayerHandAnchor(moveLog, i, handNumber);
      if (!drawnTile && !nextAnchor) {
        return { ok: false, reason: 'draw entry is missing drawn_tile.', entryIndex: i };
      }
      if (sameHand && previousHand != null) {
        const expectedBefore = previousTilePlayed
          ? removeOneTileKey(previousHand, previousTilePlayed)
          : previousHand;
        const continuityFailure = assertHandContinuity(
          expectedBefore,
          entry.hand_before,
          moveLog,
          i,
          previousEntry,
          handNumber,
          strictHandContinuity,
        );
        if (continuityFailure) return continuityFailure;
      }
      const board = parseGhostBoardState(entry.board_state);
      const hand = entry.hand_before
        .map((tileKey) => parseTileKey(tileKey))
        .filter((tile): tile is Tile => tile != null);
      const state = buildAnalysisState(board, hand);
      const legalPlays = getLegalMoves(state, 'you').filter((move) => move.type === 'play');
      if (legalPlays.length > 0) {
        return {
          ok: false,
          reason: 'Move claims a draw but a legal play existed for the reported hand and board.',
          entryIndex: i,
        };
      }

      if (drawnTile) {
        previousHand = addOneTileKey(entry.hand_before, drawnTile);
      } else if (nextAnchor) {
        previousHand = [...nextAnchor.hand_before];
      } else {
        previousHand = [...entry.hand_before];
      }
      previousHandNumber = handNumber;
      previousTilePlayed = null;
      previousEntry = entry;
      continue;
    }

    if (sameHand && previousHand != null) {
      const expectedHand = previousTilePlayed
        ? removeOneTileKey(previousHand, previousTilePlayed)
        : previousHand;
      const continuityFailure = assertHandContinuity(
        expectedHand,
        entry.hand_before,
        moveLog,
        i,
        previousEntry,
        handNumber,
        strictHandContinuity,
      );
      if (continuityFailure) return continuityFailure;
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
    previousEntry = entry;
  }

  return { ok: true };
}
