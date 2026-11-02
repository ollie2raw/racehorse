/**
 * Deterministic self-play for the Fritz search tests and the node-budget calibration (devtools and tests only).
 * Everything is seeded except Fritz's own search bound, which is exactly what is being measured.
 */
import {
  applyPlayMove,
  drawUntilPlayableOrEmpty,
  getLegalMoves,
  type BotMatchState,
  type BotPlayerId,
} from '../match/runtime/botEngine.ts';
import type { Tile } from '../../types.ts';
import { chooseBotMove, toBotVisibleState, type BotDifficulty } from './botHeuristics.ts';

const WINNING_SCORE = 60;

function createRng(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    const t = Math.imul(s ^ (s >>> 15), 1 | s);
    const u = t + (Math.imul(t ^ (t >>> 7), 61 | t) ^ t);
    return ((u ^ (u >>> 14)) >>> 0) / 4294967296;
  };
}

const FULL_DECK: Tile[] = [];
for (let high = 0; high <= 6; high++) for (let low = 0; low <= high; low++) FULL_DECK.push({ low, high });

function shuffled(rng: () => number): Tile[] {
  const out = [...FULL_DECK];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function swapPlayers(state: BotMatchState): BotMatchState {
  return {
    ...state,
    players: { bot: state.players.you, you: state.players.bot },
    currentPlayer: state.currentPlayer === 'bot' ? 'you' : 'bot',
    lastHandWinner: state.lastHandWinner === 'bot' ? 'you' : state.lastHandWinner === 'you' ? 'bot' : null,
    winnerId: state.winnerId === 'bot' ? 'you' : state.winnerId === 'you' ? 'bot' : null,
    opponentPassedOnEnds: [],
    opponentKnownMissing: [],
    opponentMissingEvidence: [],
  };
}

function dealHand(rng: () => number, scores: { you: number; bot: number }, handNumber: number): BotMatchState {
  const deck = shuffled(rng);
  const boneyard = deck.slice(14);
  return {
    players: { you: { hand: deck.slice(0, 7), score: scores.you }, bot: { hand: deck.slice(7, 14), score: scores.bot } },
    board: null,
    boneyard,
    deadTiles: boneyard.slice(boneyard.length - 2),
    handOpen: false,
    currentPlayer: handNumber % 2 === 1 ? 'you' : 'bot',
    consecutivePasses: 0,
    handNumber,
    turnIndex: 0,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: WINNING_SCORE,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: 7,
    opponentPassedOnEnds: [],
    opponentDrawCount: 0,
    opponentKnownMissing: [],
    opponentMissingEvidence: [],
  };
}

export interface SelfPlayResult {
  /** Every move chosen, as "player:low-high", in order: two runs agree exactly when these are equal. */
  readonly moves: string[];
  readonly bot: number;
  readonly you: number;
}

/** One seeded match to 60. `bot` is player one, `you` player two. */
export function playSeededMatch(seed: number, botLevel: BotDifficulty, youLevel: BotDifficulty): SelfPlayResult {
  const rng = createRng(seed);
  const level: Record<BotPlayerId, BotDifficulty> = { bot: botLevel, you: youLevel };
  let state = dealHand(rng, { you: 0, bot: 0 }, 1);
  const moves: string[] = [];

  while (!state.gameOver) {
    if (state.handOver) {
      state = dealHand(rng, { you: state.players.you.score, bot: state.players.bot.score }, state.handNumber + 1);
      continue;
    }
    const player = state.currentPlayer;
    const legal = getLegalMoves(state, player);
    if (legal.length === 0 || (legal.length === 1 && legal[0].type === 'pass')) {
      state = drawUntilPlayableOrEmpty(state, player).state;
      continue;
    }
    const visible = player === 'bot' ? toBotVisibleState(state) : toBotVisibleState(swapPlayers(state));
    const choice = chooseBotMove(visible, level[player]);
    if (!choice) {
      state = drawUntilPlayableOrEmpty(state, player).state;
      continue;
    }
    moves.push(`${player}:${choice.move.tile?.low}-${choice.move.tile?.high}`);
    state = applyPlayMove(state, player, choice.move).state;
  }
  return { moves, bot: state.players.bot.score, you: state.players.you.score };
}
