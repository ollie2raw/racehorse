import seedrandom from 'seedrandom';
import {
  applyPlayMove,
  getLegalMoves,
  passTurn,
  type BotMatchState,
  type BotPlayerId,
} from '../bot/botEngine';
import type { BoardState, Move, Tile } from '../types';
import type { GauntletDifficulty, GauntletScenario, PublicGauntletScenario } from './types';

const DIFFICULTIES: GauntletDifficulty[] = ['intro', 'easy', 'medium', 'hard', 'brutal'];

interface DifficultyConfig {
  targetHandMin: number;
  boardTilesMin: number;
  optionsMin: number;
  simTurnsMin: number;
}

const DIFFICULTY_CONFIG: Record<GauntletDifficulty, DifficultyConfig> = {
  intro: { targetHandMin: 8, boardTilesMin: 4, optionsMin: 2, simTurnsMin: 8 },
  easy: { targetHandMin: 8, boardTilesMin: 5, optionsMin: 3, simTurnsMin: 10 },
  medium: { targetHandMin: 7, boardTilesMin: 7, optionsMin: 3, simTurnsMin: 12 },
  hard: { targetHandMin: 7, boardTilesMin: 9, optionsMin: 4, simTurnsMin: 14 },
  brutal: { targetHandMin: 6, boardTilesMin: 10, optionsMin: 5, simTurnsMin: 16 },
};

function generateDoubleSixSet(): Tile[] {
  const tiles: Tile[] = [];
  for (let high = 0; high <= 6; high += 1) {
    for (let low = 0; low <= high; low += 1) {
      tiles.push({ low, high });
    }
  }
  return tiles;
}

function pickIndex(rng: seedrandom.PRNG, max: number): number {
  return Math.floor(rng() * max);
}

function shuffleWithRng<T>(rng: seedrandom.PRNG, arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = pickIndex(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function cloneMove(move: Move): Move {
  return {
    type: move.type,
    tile: move.tile ? { ...move.tile } : undefined,
    position: move.position,
  };
}

function countBoardTiles(board: BoardState | null): number {
  if (!board) return 0;
  let count = board.mainLine.length;
  for (const hub of board.hubDoubles) {
    for (const branch of hub.branches) {
      if (branch) count += branch.tiles.length;
    }
  }
  return count;
}

function cloneBoard(board: BoardState | null): BoardState {
  if (!board) {
    return {
      mainLine: [],
      leftEnd: 0,
      rightEnd: 0,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    };
  }
  return {
    ...board,
    mainLine: [...board.mainLine],
    hubDoubles: [...board.hubDoubles],
  };
}

function buildInitialState(rng: seedrandom.PRNG): BotMatchState {
  const deck = shuffleWithRng(rng, generateDoubleSixSet());
  const you = deck.slice(0, 14);
  const bot = deck.slice(14, 28);
  const currentPlayer: BotPlayerId = rng() < 0.5 ? 'you' : 'bot';

  return {
    players: {
      you: { hand: you, score: 0 },
      bot: { hand: bot, score: 0 },
    },
    board: null,
    boneyard: [],
    deadTiles: [],
    handOpen: false,
    currentPlayer,
    consecutivePasses: 0,
    handNumber: 1,
    turnIndex: 0,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: 999,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: 14,
  };
}

function evaluateMove(state: BotMatchState, move: Move): number {
  const played = applyPlayMove(state, state.currentPlayer, move).state;
  const scorer = played.currentPlayer === state.currentPlayer;
  const nextPlayer: BotPlayerId = scorer ? state.currentPlayer : (state.currentPlayer === 'you' ? 'bot' : 'you');
  const nextOptions = getLegalMoves(played, nextPlayer).filter((m) => m.type === 'play').length;
  const yourOptions = getLegalMoves(played, 'you').filter((m) => m.type === 'play').length;
  const boardComplexity = countBoardTiles(played.board);
  const scoreDelta = played.players[state.currentPlayer].score - state.players[state.currentPlayer].score;

  return nextOptions * 4 + yourOptions * 5 + boardComplexity * 0.5 + scoreDelta * 3 + (scorer ? 3 : 0);
}

function pickRichMove(rng: seedrandom.PRNG, state: BotMatchState, moves: Move[]): Move {
  const scored = moves.map((move) => ({ move, score: evaluateMove(state, move) }));
  scored.sort((a, b) => b.score - a.score);

  // Pick from top slice for variety while keeping tactical richness.
  const topN = Math.max(1, Math.min(3, scored.length));
  return scored[pickIndex(rng, topN)].move;
}

function toScenarioState(state: BotMatchState): { playerHand: Tile[]; boardState: BoardState; opponentTiles: number } {
  return {
    playerHand: [...state.players.you.hand],
    boardState: cloneBoard(state.board),
    opponentTiles: state.players.bot.hand.length,
  };
}

function normalizeForSolver(playerHand: Tile[], boardState: BoardState): BotMatchState {
  const hasBoard = boardState.mainLine.length > 0;
  return {
    players: {
      you: { hand: [...playerHand], score: 0 },
      bot: { hand: [], score: 0 },
    },
    board: hasBoard ? cloneBoard(boardState) : null,
    boneyard: [],
    deadTiles: [],
    handOpen: hasBoard,
    currentPlayer: 'you',
    consecutivePasses: 0,
    handNumber: 1,
    turnIndex: 0,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: 999,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: 14,
  };
}

function computeOptimalSolution(playerHand: Tile[], boardState: BoardState): Move[] {
  const initial = normalizeForSolver(playerHand, boardState);
  let bestScore = -1;
  let bestMoves: Move[] = [];

  function dfs(state: BotMatchState, path: Move[]): void {
    const score = state.players.you.score;
    if (score > bestScore || (score === bestScore && (bestMoves.length === 0 || path.length < bestMoves.length))) {
      bestScore = score;
      bestMoves = path.map(cloneMove);
    }

    if (path.length >= 12 || state.handOver || state.gameOver || state.currentPlayer !== 'you') {
      return;
    }

    const legal = getLegalMoves(state, 'you').filter((m) => m.type === 'play' && m.tile && m.position);
    for (const move of legal) {
      const next = applyPlayMove(state, 'you', move);
      dfs(next.state, [...path, cloneMove(move)]);
    }
  }

  dfs(initial, []);
  return bestMoves;
}

function scoreSequence(playerHand: Tile[], boardState: BoardState, sequence: Move[]): number {
  let state = normalizeForSolver(playerHand, boardState);
  for (const move of sequence) {
    const result = applyPlayMove(state, 'you', move);
    state = result.state;
    if (state.currentPlayer !== 'you' || state.handOver || state.gameOver) break;
  }
  return state.players.you.score;
}

function generateMidHandState(rng: seedrandom.PRNG, difficulty: GauntletDifficulty): { playerHand: Tile[]; boardState: BoardState; opponentTiles: number } {
  const cfg = DIFFICULTY_CONFIG[difficulty];

  for (let attempt = 0; attempt < 180; attempt += 1) {
    let state = buildInitialState(rng);
    let turns = 0;

    while (!state.handOver && !state.gameOver && turns < 120) {
      const player = state.currentPlayer;
      const playMoves = getLegalMoves(state, player).filter((m) => m.type === 'play' && m.tile && m.position);

      if (playMoves.length > 0) {
        const move = pickRichMove(rng, state, playMoves);
        state = applyPlayMove(state, player, move).state;
      } else {
        state = passTurn(state, player).state;
      }

      turns += 1;

      const yourOptions = getLegalMoves(state, 'you').filter((m) => m.type === 'play').length;
      const boardTiles = countBoardTiles(state.board);
      const yourHand = state.players.you.hand.length;

      if (
        !state.handOver &&
        !state.gameOver &&
        state.currentPlayer === 'you' &&
        turns >= cfg.simTurnsMin &&
        yourHand >= cfg.targetHandMin &&
        boardTiles >= cfg.boardTilesMin &&
        yourOptions >= cfg.optionsMin
      ) {
        return toScenarioState(state);
      }
    }
  }

  // Last-resort fallback if search misses constraints.
  const fallback = buildInitialState(rng);
  return {
    playerHand: fallback.players.you.hand.slice(0, 10),
    boardState: {
      mainLine: [{ tile: { low: 2, high: 5 }, orientation: 'horizontal-normal' }],
      leftEnd: 2,
      rightEnd: 5,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    opponentTiles: fallback.players.bot.hand.length,
  };
}

function generateRound(rng: seedrandom.PRNG, round: number): GauntletScenario {
  const difficulty = DIFFICULTIES[round - 1] ?? 'intro';
  const tactical = generateMidHandState(rng, difficulty);

  const optimalSolution = computeOptimalSolution(tactical.playerHand, tactical.boardState);
  const optimalScore = scoreSequence(tactical.playerHand, tactical.boardState, optimalSolution);

  return {
    round,
    difficulty,
    playerHand: tactical.playerHand,
    boardState: tactical.boardState,
    opponentTiles: tactical.opponentTiles,
    optimalSolution,
    optimalScore,
  };
}

export function generateDailyGauntlet(seed: string): GauntletScenario[] {
  const rng = seedrandom(seed);
  return [1, 2, 3, 4, 5].map((round) => generateRound(rng, round));
}

export function toPublicGauntletScenarios(rounds: GauntletScenario[]): PublicGauntletScenario[] {
  return rounds.map(({ optimalSolution, ...rest }) => rest);
}
