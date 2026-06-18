import {
  applyPlayMove,
  getDisplayOpenEnds,
  getLegalMoves,
  type BotMatchState,
} from '../bot/botEngine';
import type { CuratedDailyPuzzle, PuzzleValidationResult } from './types';
import type { Move } from '../types';

function isPlayMove(move: Move): move is Move & { type: 'play'; tile: NonNullable<Move['tile']> } {
  return move.type === 'play' && Boolean(move.tile);
}

function cloneState(state: BotMatchState): BotMatchState {
  return {
    ...state,
    board: state.board
      ? {
          ...state.board,
          mainLine: [...state.board.mainLine],
          hubDoubles: [...state.board.hubDoubles],
        }
      : null,
    boneyard: [...state.boneyard],
    deadTiles: [...state.deadTiles],
    players: {
      you: { hand: [...state.players.you.hand], score: state.players.you.score },
      bot: { hand: [...state.players.bot.hand], score: state.players.bot.score },
    },
  };
}

export function createPuzzleMatchState(puzzle: CuratedDailyPuzzle): BotMatchState {
  const normalizedDealSize = puzzle.dealSize === 14 ? 14 : 7;
  return {
    players: {
      you: { hand: [...puzzle.startingHand], score: 0 },
      bot: { hand: [], score: 0 },
    },
    board: {
      ...puzzle.startingBoard,
      mainLine: [...puzzle.startingBoard.mainLine],
      hubDoubles: [...puzzle.startingBoard.hubDoubles],
    },
    boneyard: [],
    deadTiles: [],
    handOpen: true,
    currentPlayer: 'you',
    consecutivePasses: 0,
    handNumber: 1,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: 999,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: normalizedDealSize,
  };
}

export function validatePuzzle(puzzle: CuratedDailyPuzzle): PuzzleValidationResult {
  const initial = createPuzzleMatchState(puzzle);
  const firstMoves = getLegalMoves(initial, 'you').filter((move) => move.type === 'play');

  let bestScore = 0;
  let exploredStates = 0;
  let hasScoringMove = false;
  const seen = new Set<string>();

  for (const move of firstMoves) {
    const res = applyPlayMove(initial, 'you', move);
    if ((res.scored?.points ?? 0) > 0) {
      hasScoringMove = true;
      break;
    }
  }

  // One-turn high-score puzzles do not have a target/max-moves requirement.
  // They are valid as long as there is at least one legal opening play.
  if (puzzle.puzzleType === 'one_turn_high_score') {
    const solvable = firstMoves.length > 0;
    const bestScore = computeBestPossiblePuzzleScore(puzzle);
    return {
      solvable,
      bestScore,
      hasScoringMove,
      exploredStates: firstMoves.length,
      reason: solvable ? 'OK' : 'No legal opening moves.',
    };
  }

  if (puzzle.puzzleType === 'setup_and_strike') {
    const validation = validateSetupAndStrikePuzzle(puzzle);
    const solvable = validation.solvable;
    if (!solvable) {
       
      console.error('[DailyPuzzleValidator] invalid setup_and_strike puzzle', {
        puzzleId: puzzle.id,
        date: puzzle.puzzleDate,
        bestScore: validation.bestScore,
        reason: validation.reason,
      });
    }
    return validation;
  }

  const keyOf = (state: BotMatchState, movesUsed: number): string => {
    const handKey = [...state.players.you.hand]
      .map((t) => `${t.low}-${t.high}`)
      .sort()
      .join(',');
    const boardKey = state.board
      ? state.board.mainLine.map((p) => `${p.tile.low}-${p.tile.high}-${p.orientation}`).join('|')
      : 'empty';
    return `${movesUsed}::${state.currentPlayer}::${state.players.you.score}::${handKey}::${boardKey}`;
  };

  const dfs = (state: BotMatchState, movesUsed: number) => {
    exploredStates += 1;
    bestScore = Math.max(bestScore, state.players.you.score);

    if (state.players.you.score >= puzzle.targetScore) {
      return true;
    }

    if (movesUsed >= puzzle.maxMoves) {
      return false;
    }

    if (state.currentPlayer !== 'you') {
      return false;
    }

    const legal = getLegalMoves(state, 'you').filter((move) => move.type === 'play');
    if (legal.length === 0) {
      return false;
    }

    for (const move of legal) {
      const next = applyPlayMove(state, 'you', move).state;
      const key = keyOf(next, movesUsed + 1);
      if (seen.has(key)) continue;
      seen.add(key);
      if (dfs(cloneState(next), movesUsed + 1)) {
        return true;
      }
    }

    return false;
  };

  const solvable = dfs(initial, 0);

  let reason = 'OK';
  if (firstMoves.length === 0) {
    reason = 'No legal opening moves.';
  } else if (!solvable) {
    reason = 'Target score unreachable within max moves under racehorse turn flow.';
  }

  if (!solvable) {
     
    console.error('[DailyPuzzleValidator] invalid puzzle', {
      puzzleId: puzzle.id,
      date: puzzle.puzzleDate,
      bestScore,
      hasScoringMove,
      firstOpenEnds: getDisplayOpenEnds(initial),
      maxMoves: puzzle.maxMoves,
      targetScore: puzzle.targetScore,
      reason,
      exploredStates,
    });
  }

  return {
    solvable,
    bestScore,
    hasScoringMove,
    exploredStates,
    reason,
  };
}

function validateSetupAndStrikePuzzle(puzzle: CuratedDailyPuzzle): PuzzleValidationResult {
  const initial = createPuzzleMatchState(puzzle);
  const firstMoves = getLegalMoves(initial, 'you').filter(
    (move): move is Move & { type: 'play'; tile: NonNullable<Move['tile']> } => isPlayMove(move),
  );
  let bestStrikeScore = 0;

  for (const move of firstMoves) {
    const setupApplied = applyPlayMove(initial, 'you', move);
    const setupScore = setupApplied.scored?.points ?? 0;
    if (setupScore !== 0) continue;
    if (move.tile.low !== move.tile.high) continue;
    if (setupApplied.state.currentPlayer !== 'you') continue;

    const beforeEnds = getDisplayOpenEnds(initial).join(',');
    const afterEnds = getDisplayOpenEnds(setupApplied.state).join(',');
    if (beforeEnds === afterEnds) continue;

    const followUpMoves = getLegalMoves(setupApplied.state, 'you').filter(
      (nextMove): nextMove is Move & { type: 'play'; tile: NonNullable<Move['tile']> } =>
        isPlayMove(nextMove),
    );
    for (const strikeMove of followUpMoves) {
      const strikeApplied = applyPlayMove(setupApplied.state, 'you', strikeMove);
      const strikeScore = strikeApplied.scored?.points ?? 0;
      bestStrikeScore = Math.max(bestStrikeScore, strikeScore);
      if (strikeScore < 5) continue;

      const directStrike = firstMoves.find(
        (candidate) =>
          candidate.tile.low === strikeMove.tile.low &&
          candidate.tile.high === strikeMove.tile.high,
      );

      if (directStrike) {
        const directApplied = applyPlayMove(initial, 'you', directStrike);
        const directScore = directApplied.scored?.points ?? 0;
        if (directScore >= Math.max(3, strikeScore - 2)) continue;
      }

      return {
        solvable: true,
        bestScore: strikeScore,
        hasScoringMove: true,
        exploredStates: firstMoves.length + followUpMoves.length,
        reason: 'OK',
      };
    }
  }

  return {
    solvable: false,
    bestScore: bestStrikeScore,
    hasScoringMove: bestStrikeScore > 0,
    exploredStates: firstMoves.length,
    reason: 'No setup+strike sequence found',
  };
}

function boardKey(state: BotMatchState): string {
  if (!state.board) return 'empty';
  const mainLine = state.board.mainLine
    .map((p) => `${p.tile.low}-${p.tile.high}-${p.orientation}`)
    .join('|');
  const hubs = state.board.hubDoubles
    .map((hub, idx) => {
      const hubId = hub.hubId ?? idx;
      const branches = hub.branches
        .map((branch, branchIdx) => {
          if (!branch) return `b${branchIdx}:none`;
          const tiles = branch.tiles
            .map((t) => `${t.tile.low}-${t.tile.high}-${t.orientation}`)
            .join(',');
          return `b${branchIdx}:${branch.openEnd}:${branch.openEndIsDouble ? 1 : 0}:${tiles}`;
        })
        .join(';');
      return `${hubId}:${hub.hubValue}:${hub.isCrossed ? 1 : 0}:${branches}`;
    })
    .join('||');
  return `${mainLine}::${hubs}`;
}

function stateKey(state: BotMatchState): string {
  const handKey = [...state.players.you.hand]
    .map((t) => `${t.low}-${t.high}`)
    .sort()
    .join(',');
  return `${state.currentPlayer}::${state.players.you.score}::${handKey}::${boardKey(state)}`;
}

export function computeBestPossiblePuzzleScore(puzzle: CuratedDailyPuzzle): number {
  const initial = createPuzzleMatchState(puzzle);
  const memo = new Map<string, number>();

  const dfs = (state: BotMatchState): number => {
    const key = stateKey(state);
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    let best = state.players.you.score;
    if (state.currentPlayer !== 'you') {
      memo.set(key, best);
      return best;
    }

    const legalMoves = getLegalMoves(state, 'you').filter((move) => move.type === 'play');
    if (legalMoves.length === 0) {
      memo.set(key, best);
      return best;
    }

    for (const move of legalMoves) {
      const nextState = applyPlayMove(state, 'you', move).state;
      best = Math.max(best, dfs(nextState));
    }

    memo.set(key, best);
    return best;
  };

  return dfs(initial);
}
