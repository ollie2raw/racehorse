import type { Tile } from '../../types.ts';
import {
  createBotMatch,
  generateDoubleSixSet,
  placeTileOnBoard,
  type BotMatchState,
} from '../match/runtime/botEngine.ts';

/**
 * Deterministic late-hand fixture for the embedded forced-draw chain (test support only).
 *
 * Board (8 tiles, no interior double, so no hub branches), left -> right:
 *   [5|2][2|3][3|5][5|4][4|6][6|5][5|0][0|1]  -> open ends 5 (left) and 1 (right).
 * Fritz holds 1-5 (right end). Playing it scores (ends 5|5), and every 5-tile is on the board,
 * in Fritz's hand, or locked (5-5 is a dead tile), so Fritz has no follow-up play, drains every
 * drawable boneyard tile, and the engine closes the chain with Fritz's pass. The human holds no
 * 5, so the human is also blocked: their forced pass ends the hand (blocked-hand rule).
 * (1-5 could also be played on the left end for no score; Fritz picks the scoring side.)
 */
const key = (t: Tile) => `${Math.min(t.low, t.high)}-${Math.max(t.low, t.high)}`;
const t = (a: number, b: number): Tile => ({ low: Math.min(a, b), high: Math.max(a, b) });

/** Built right-to-left: [0|1] first (left pip 0, right pip 1), then each tile on the left. */
const BOARD_CHAIN: Array<[number, number]> = [
  [0, 1], [5, 0], [6, 5], [4, 6], [5, 4], [3, 5], [2, 3], [5, 2],
];

/** Tiles Fritz may hold before the play: no 1 (right end) and no 5 (left end). */
export const POOL_TILES: Tile[] = [
  t(0, 2), t(0, 3), t(0, 4), t(0, 6), t(2, 2), t(2, 4), t(2, 6), t(3, 3), t(3, 4), t(3, 6), t(4, 4), t(6, 6),
];

const sum = (tiles: Tile[]) => tiles.reduce((n, x) => n + x.low + x.high, 0);

export type EmbeddedChainFixtureOptions = {
  /** Pool tiles Fritz holds besides the scoring 1-5. */
  fritzPool: Tile[];
  /** Pool tiles in the drawable boneyard (order = draw order). */
  boneyardPool: Tile[];
  winningScore?: number;
  /** Human keeps 5-5 (so they have a play after Fritz's pass); dead tiles become 0-0 and 1-1. */
  humanHoldsFive?: boolean;
  scores?: { you: number; bot: number };
};

export function buildEmbeddedChainFixture(options: EmbeddedChainFixtureOptions): BotMatchState {
  const base = createBotMatch(options.winningScore ?? 100, 7);
  let board = null as BotMatchState['board'];
  const boardTiles: Tile[] = [];
  for (const [a, b] of BOARD_CHAIN) {
    board = placeTileOnBoard(board, t(a, b), 'left');
    boardTiles.push(t(a, b));
  }
  const fritzScoring = t(1, 5);
  const dead = options.humanHoldsFive ? [t(1, 1), t(0, 0)] : [t(5, 5), t(0, 0)];
  const used = new Set([...boardTiles, fritzScoring, ...dead, ...options.fritzPool, ...options.boneyardPool].map(key));
  const humanHand = generateDoubleSixSet().filter((x) => !used.has(key(x)));
  const boneyard = [...options.boneyardPool, ...dead];

  const all = [...boardTiles, fritzScoring, ...options.fritzPool, ...boneyard, ...humanHand];
  if (all.length !== 28 || new Set(all.map(key)).size !== 28) {
    throw new Error('embedded chain fixture: invalid inventory');
  }
  if (!options.humanHoldsFive && humanHand.some((x) => x.low === 5 || x.high === 5)) {
    throw new Error('embedded chain fixture: human must hold no 5 tile');
  }
  return {
    ...base,
    board,
    handOpen: true,
    boneyard,
    deadTiles: dead,
    players: {
      you: { ...base.players.you, hand: humanHand, score: options.scores?.you ?? 0 },
      bot: { ...base.players.bot, hand: [fritzScoring, ...options.fritzPool], score: options.scores?.bot ?? 0 },
    },
    currentPlayer: 'bot',
    consecutivePasses: 0,
    handOver: false,
    gameOver: false,
    turnIndex: 20,
    handNumber: 1,
  };
}

export { sum as tilePips };
