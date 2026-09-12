import { getLegalMoves, type BotMatchState } from '../bot/botEngine';
import type { JourneyPuzzle, JourneyPuzzleTile } from './journeyPuzzles';
import { puzzleToBoardState } from './puzzleBoardAdapter';

/**
 * Proves a puzzle's claimed correct answer is actually legal per the real
 * `packages/game-core` engine — not just hand-typed and hoped-correct, which
 * is how every current Journey puzzle is authored today. See
 * docs/scoping/journey-overhaul-2026-09-12.md §3/§6 (PR 4): this is the
 * "cheaper engine-verified-puzzle tier" — legality checked by the engine,
 * not a claim about which legal move is objectively *best*. Domino strategy
 * judgment (is this really the strongest play, not just a legal one) is
 * still a human authoring call this tool cannot make.
 */
export type JourneyPuzzleEngineVerificationIssueCode =
  | 'missing_interactive_fields'
  | 'correct_tile_not_in_hand'
  | 'correct_tile_illegal';

export type JourneyPuzzleEngineVerificationIssue = {
  code: JourneyPuzzleEngineVerificationIssueCode;
  message: string;
};

function tilesMatch(a: JourneyPuzzleTile, b: JourneyPuzzleTile): boolean {
  return (a.high === b.high && a.low === b.low) || (a.high === b.low && a.low === b.high);
}

/** Minimal synthetic match state sufficient for legal-*play*-move computation: only the board and the acting player's hand matter for that. */
function buildSyntheticMatchState(
  board: ReturnType<typeof puzzleToBoardState>,
  playerHand: JourneyPuzzleTile[],
): BotMatchState {
  return {
    players: {
      you: { hand: playerHand.map((t) => ({ ...t })), score: 0 },
      bot: { hand: [], score: 0 },
    },
    board,
    boneyard: [],
    deadTiles: [],
    handOpen: true,
    currentPlayer: 'you',
    consecutivePasses: 0,
    handNumber: 1,
    turnIndex: 0,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: 60,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: 7,
  };
}

export function verifyJourneyPuzzleAgainstEngine(puzzle: JourneyPuzzle): JourneyPuzzleEngineVerificationIssue[] {
  const { boardState, playerHand, correctTile } = puzzle;

  if (!boardState || !playerHand || !correctTile) {
    return [{
      code: 'missing_interactive_fields',
      message: `${puzzle.nodeId}: not an interactive puzzle (missing boardState, playerHand, or correctTile) — nothing to engine-verify.`,
    }];
  }

  if (!playerHand.some((tile) => tilesMatch(tile, correctTile))) {
    return [{
      code: 'correct_tile_not_in_hand',
      message: `${puzzle.nodeId}: correctTile ${correctTile.high}-${correctTile.low} is not in playerHand.`,
    }];
  }

  const board = puzzleToBoardState(boardState.placedTiles, boardState.ends);
  const state = buildSyntheticMatchState(board, playerHand);
  const legalPlayTiles = getLegalMoves(state, 'you')
    .filter((move) => move.type === 'play' && move.tile)
    .map((move) => move.tile!);

  if (!legalPlayTiles.some((tile) => tilesMatch(tile, correctTile))) {
    return [{
      code: 'correct_tile_illegal',
      message: `${puzzle.nodeId}: correctTile ${correctTile.high}-${correctTile.low} is not a legal move against the stated board.`,
    }];
  }

  return [];
}
