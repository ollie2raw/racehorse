import {
  applyPlayMove,
  createFixedBotMatch,
  generateDoubleSixSet,
  getLegalMoves,
  passTurn,
  type BotActionResult,
  type BotMatchState,
} from '../runtime/botEngine.ts';

export type HandEndKind = 'domino-out' | 'scoring-finish' | 'blocked';

export interface PlayedHand {
  seed: number;
  kind: HandEndKind;
  /** The state after the last command: the hand is over. */
  final: BotMatchState;
  /** The state before the last command (what a request built "too early" would have seen). */
  beforeLast: BotMatchState;
  /** The engine result of the last command; carries `handEnded` for the reveal. */
  last: BotActionResult;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plays one real hand with the real engine, picking among the legal commands with a seeded generator.
 * The deal is 7 + 7 with the other 14 tiles dead (nobody can draw), which is what makes a blocked hand reachable.
 */
export function playHand(seed: number): PlayedHand | null {
  const random = mulberry32(seed);
  const set = generateDoubleSixSet();
  for (let i = set.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [set[i], set[j]] = [set[j], set[i]];
  }
  const rest = set.slice(14);
  let state = createFixedBotMatch({ player_tiles: set.slice(0, 7), fritz_tiles: set.slice(7, 14), boneyard: rest, locked: rest }, 60, 7);
  let beforeLast = state;
  let last: BotActionResult | null = null;
  for (let step = 0; step < 400 && !state.handOver; step += 1) {
    const player = state.currentPlayer;
    const moves = getLegalMoves(state, player);
    // getLegalMoves also offers `pass` when no tile plays; it has its own engine entry point.
    const move = moves[Math.floor(random() * moves.length)];
    if (!move) return null;
    const result = move.type === 'pass' ? passTurn(state, player) : applyPlayMove(state, player, move);
    if (result.error) return null;
    beforeLast = state;
    state = result.state;
    last = result;
  }
  if (!state.handOver || !last?.handEnded) return null;
  const kind: HandEndKind = last.handEnded.reason === 'blocked'
    ? 'blocked'
    : (last.scored?.points ?? 0) > 0 ? 'scoring-finish' : 'domino-out';
  return { seed, kind, final: state, beforeLast, last };
}

/** The first seed in [1, limit] whose hand ends the given way. */
export function findHand(kind: HandEndKind, limit = 600): PlayedHand {
  for (let seed = 1; seed <= limit; seed += 1) {
    const hand = playHand(seed);
    if (hand?.kind === kind) return hand;
  }
  throw new Error(`no ${kind} hand in ${limit} seeds`);
}
