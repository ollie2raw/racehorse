import { applyPlayMove, getDisplayOpenEnds, getLegalMoves, type BotMatchState } from "../bot/botEngine";
import type { CuratedDailyPuzzle, PuzzleValidationResult } from "./types";

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
    currentPlayer: "you",
    consecutivePasses: 0,
    handNumber: 1,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: 999,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: 7,
  };
}

export function validatePuzzle(puzzle: CuratedDailyPuzzle): PuzzleValidationResult {
  const initial = createPuzzleMatchState(puzzle);
  const firstMoves = getLegalMoves(initial, "you").filter((move) => move.type === "play");

  let bestScore = 0;
  let exploredStates = 0;
  let hasScoringMove = false;
  const seen = new Set<string>();

  for (const move of firstMoves) {
    const res = applyPlayMove(initial, "you", move);
    if ((res.scored?.points ?? 0) > 0) {
      hasScoringMove = true;
      break;
    }
  }

  const keyOf = (state: BotMatchState, movesUsed: number): string => {
    const handKey = [...state.players.you.hand]
      .map((t) => `${t.low}-${t.high}`)
      .sort()
      .join(",");
    const boardKey = state.board
      ? state.board.mainLine.map((p) => `${p.tile.low}-${p.tile.high}-${p.orientation}`).join("|")
      : "empty";
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

    if (state.currentPlayer !== "you") {
      return false;
    }

    const legal = getLegalMoves(state, "you").filter((move) => move.type === "play");
    if (legal.length === 0) {
      return false;
    }

    for (const move of legal) {
      const next = applyPlayMove(state, "you", move).state;
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

  let reason = "OK";
  if (firstMoves.length === 0) {
    reason = "No legal opening moves.";
  } else if (!solvable) {
    reason = "Target score unreachable within max moves under racehorse turn flow.";
  }

  if (!solvable) {
    // eslint-disable-next-line no-console
    console.error("[DailyPuzzleValidator] invalid puzzle", {
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
