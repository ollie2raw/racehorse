import type { BoardState, PlacementPosition, Tile } from '../../../types.ts';
import { applyPlayMove, computeOpenEndsSum, getLegalMoves, getMatchableOpenEnds, previewPlayMove } from '../../../modules/match/runtime/botEngine.ts';
import { createJourneyScenarioState, type JourneyAuthoredMoveAction, type JourneyAuthoredScenario } from '../../journeyAuthoredLessonBundle.ts';

/**
 * Engine-derived facts for Greedy Hands. Nothing here is a second rules engine: legality, scoring, "does the turn
 * go on" and "can that tile score" all come from `botEngine` (`getLegalMoves`, `previewPlayMove`, `applyPlayMove`).
 *
 * WHAT IS MODELLED, AND WHAT IS NOT
 *
 * A score (or a double) keeps the SAME player's turn going in this ruleset — `applyPlayMove` leaves
 * `currentPlayer` on the mover. So "take the points, then the opponent replies" is only true once your turn has
 * actually ended. These helpers therefore play out the rest of the turn, and only accept positions where that rest
 * is DETERMINISTIC: after the chosen play every further play is forced (exactly one legal play), and the turn ends
 * on a play that neither scores nor is a double — never on a draw, whose result is unknowable, and never by going
 * out. Positions that cannot be played out that way are rejected, not approximated.
 *
 * The "reply" is deliberately LOCAL: for each tile that is neither on the board nor in your rack, the most it
 * scores in ONE play on the ends you leave. It is a floor on what a real opponent might take back (their own
 * scores would also keep their turn going), and it is "could", not "will": the opponent holds only some of those
 * tiles. It is not a claim about any opponent's strategy.
 */

export const tileLabel = (tile: Tile): string => `${Math.min(tile.low, tile.high)}-${Math.max(tile.low, tile.high)}`;
const sameTile = (a: Tile, b: Tile): boolean => tileLabel(a) === tileLabel(b);
export const actionKey = (action: { tile: Tile; position: PlacementPosition }): string => `${action.tile.low}-${action.tile.high}@${action.position}`;

export type GreedyTurnStep = {
  tile: Tile;
  position: PlacementPosition;
  /** Points this play scored. */
  points: number;
  /** What the open ends add up to after this play (doubles on an end count both halves). */
  endTotal: number;
  /** Whether the same player plays again after it (a score or a double). */
  turnGoesOn: boolean;
};

export type GreedyReplyFacts = {
  /** Tiles that are neither on the board nor in your rack. */
  unseenCount: number;
  /** Distinct unseen tiles that would score at once on the ends you leave. */
  scoringTileCount: number;
  /** The most any single unseen tile scores in one play (0 if none can). */
  bestPoints: number;
  /** The best-scoring tile and the open end it would go on (value of that end), or null. */
  bestTile: { tile: Tile; onEnd: number } | null;
};

export type GreedyLineFacts = {
  action: JourneyAuthoredMoveAction;
  steps: GreedyTurnStep[];
  /** Everything scored across the whole turn. */
  turnPoints: number;
  /** The board after each play of the turn, in order (the last is `finalBoard`). */
  stepBoards: BoardState[];
  finalBoard: BoardState;
  /** The two open ends once your turn is over — what the opponent faces. */
  finalEnds: [number, number];
  finalEndTotal: number;
  finalEndDoubles: [boolean, boolean];
  reply: GreedyReplyFacts;
  /** Points you took minus the most one unseen tile could take back. Positive = you come out ahead of that reply. */
  net: number;
};

export type GreedyLineResult = { kind: 'line'; facts: GreedyLineFacts } | { kind: 'unresolvable'; reason: string };

export function boardTiles(board: BoardState): Tile[] {
  return board.mainLine.map((entry) => entry.tile);
}

const ALL_TILES: Tile[] = (() => {
  const tiles: Tile[] = [];
  for (let low = 0; low <= 6; low += 1) for (let high = low; high <= 6; high += 1) tiles.push({ low, high });
  return tiles;
})();

export function unseenTiles(scenario: Pick<JourneyAuthoredScenario, 'board' | 'playerHand'>): Tile[] {
  const known = [...boardTiles(scenario.board), ...scenario.playerHand];
  return ALL_TILES.filter((tile) => !known.some((other) => sameTile(other, tile)));
}

export function legalFirstActions(scenario: JourneyAuthoredScenario): JourneyAuthoredMoveAction[] {
  return getLegalMoves(createJourneyScenarioState(scenario), 'you')
    .filter((move) => move.type === 'play' && move.tile && move.position)
    .map((move) => ({ tile: move.tile!, position: move.position as PlacementPosition }));
}

/** The most one unseen tile scores in a single play on `finalState`'s open ends. */
export function replyFacts(finalState: ReturnType<typeof createJourneyScenarioState>, unseen: Tile[]): GreedyReplyFacts {
  let bestPoints = 0;
  let bestTile: GreedyReplyFacts['bestTile'] = null;
  const scoring = new Set<string>();
  const board = finalState.board;
  if (!board) return { unseenCount: unseen.length, scoringTileCount: 0, bestPoints: 0, bestTile: null };
  for (const tile of unseen) {
    const probe = JSON.parse(JSON.stringify(finalState)) as typeof finalState;
    probe.currentPlayer = 'bot';
    probe.players.bot.hand = [{ ...tile }];
    // every placement the ENGINE offers that tile on this board — not an assumption that there are two ends
    for (const move of getLegalMoves(probe, 'bot')) {
      if (move.type !== 'play' || !move.tile || !move.position) continue;
      const preview = previewPlayMove(probe, 'bot', { type: 'play', tile, position: move.position });
      if (!preview || preview.immediateScore <= 0) continue;
      scoring.add(tileLabel(tile));
      if (preview.immediateScore > bestPoints) {
        bestPoints = preview.immediateScore;
        bestTile = { tile: { low: Math.min(tile.low, tile.high), high: Math.max(tile.low, tile.high) }, onEnd: move.position === 'left' ? board.leftEnd : board.rightEnd };
      }
    }
  }
  return { unseenCount: unseen.length, scoringTileCount: scoring.size, bestPoints, bestTile };
}

/** Plays `first` and then, while the turn goes on, the single forced play each time; see the module comment. */
export function analyzeGreedyLine(scenario: JourneyAuthoredScenario, first: JourneyAuthoredMoveAction): GreedyLineResult {
  let state = createJourneyScenarioState(scenario);
  let next: JourneyAuthoredMoveAction = first;
  const steps: GreedyTurnStep[] = [];
  const stepBoards: BoardState[] = [];
  for (let index = 0; index < 6; index += 1) {
    const move = { type: 'play' as const, tile: next.tile, position: next.position };
    const preview = previewPlayMove(state, 'you', move);
    if (!preview) return { kind: 'unresolvable', reason: `${actionKey(next)} is not legal` };
    const applied = applyPlayMove(state, 'you', move);
    if (applied.error) return { kind: 'unresolvable', reason: `${actionKey(next)} was refused: ${String(applied.error)}` };
    state = applied.state;
    const board = state.board;
    if (!board) return { kind: 'unresolvable', reason: 'the play left no board' };
    stepBoards.push(board);
    steps.push({ tile: next.tile, position: next.position, points: preview.immediateScore, endTotal: preview.openSum, turnGoesOn: preview.turnContinues });
    if (state.players.you.hand.length === 0) return { kind: 'unresolvable', reason: 'the turn would end by going out' };
    if (state.currentPlayer !== 'you') {
      // The copy talks about "the two open ends"; a turn that leaves extra arms (a buried double opens branches)
      // would make that false, so it is not a position this lesson can honestly describe.
      if (getMatchableOpenEnds(board).length !== 2) return { kind: 'unresolvable', reason: 'the turn would leave more than two open ends' };
      const reply = replyFacts(state, unseenTiles(scenario));
      const turnPoints = steps.reduce((sum, step) => sum + step.points, 0);
      return {
        kind: 'line',
        facts: {
          action: first,
          steps,
          turnPoints,
          stepBoards,
          finalBoard: board,
          finalEnds: [board.leftEnd, board.rightEnd],
          finalEndTotal: computeOpenEndsSum(board),
          finalEndDoubles: [Boolean(board.leftEndIsDouble), Boolean(board.rightEndIsDouble)],
          reply,
          net: turnPoints - reply.bestPoints,
        },
      };
    }
    const plays = getLegalMoves(state, 'you').filter((candidate) => candidate.type === 'play' && candidate.tile && candidate.position);
    if (plays.length === 0) return { kind: 'unresolvable', reason: 'the turn would go on with no play, i.e. a draw of unknown result' };
    if (plays.length > 1) return { kind: 'unresolvable', reason: 'the turn would go on with a choice, not a forced play' };
    next = { tile: plays[0].tile!, position: plays[0].position as PlacementPosition };
  }
  return { kind: 'unresolvable', reason: 'the turn did not end within six plays' };
}
