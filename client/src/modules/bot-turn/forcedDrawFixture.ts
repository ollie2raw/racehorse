import type { Tile } from '../../types.ts';
import {
  createBotMatch,
  generateDoubleSixSet,
  placeTileOnBoard,
  type BotMatchState,
} from '../match/runtime/botEngine.ts';

/**
 * Deterministic 5/5 forced-draw fixture (test support only).
 *
 * Board: [5|5][5|0][0|1][1|5] -> both open ends are 5, three 5-tiles on board.
 * Human holds the other four 5-tiles. Fritz hand + boneyard contain no 5 unless
 * `fivesInBoneyard` places one at a chosen boneyard index (control case).
 */
export type FiveFiveFixtureOptions = {
  /** Total boneyard size including the 2 locked dead tiles. */
  boneyardSize: number;
  /** Boneyard index at which to hide a playable 5-tile (control case). */
  playableAtBoneyardIndex?: number;
  currentPlayer?: 'you' | 'bot';
  /**
   * Embedded variant: the final 1-5 is in Fritz's hand and not yet on the board.
   * Playing it scores and leaves 5/5 with no play, so the engine resolves the whole
   * forced-draw chain (and the closing pass) inside applyMove.
   */
  fritzHoldsScoringFive?: boolean;
};

const key = (t: Tile) => `${t.low}-${t.high}`;
const hasFive = (t: Tile) => t.low === 5 || t.high === 5;

export function buildFiveFiveForcedDrawFixture(options: FiveFiveFixtureOptions): BotMatchState {
  const base = createBotMatch(60, 7);
  const boardTiles: Tile[] = [
    { low: 5, high: 5 },
    { low: 0, high: 5 },
    { low: 0, high: 1 },
    { low: 1, high: 5 },
  ];
  const finalFive = boardTiles[3];
  if (options.fritzHoldsScoringFive) boardTiles.pop();
  let board = placeTileOnBoard(null, boardTiles[0], 'left');
  board = placeTileOnBoard(board, boardTiles[1], 'right');
  board = placeTileOnBoard(board, boardTiles[2], 'right');
  if (!options.fritzHoldsScoringFive) board = placeTileOnBoard(board, finalFive, 'right');

  const onBoard = new Set(boardTiles.map(key));
  onBoard.add(key(finalFive));
  const remaining = generateDoubleSixSet().filter((t) => !onBoard.has(key(t)));
  const fives = remaining.filter(hasFive); // 2-5 3-5 4-5 5-6
  const nonFives = remaining.filter((t) => !hasFive(t));

  const humanFives = [...fives];
  let hidden: Tile | undefined;
  if (options.playableAtBoneyardIndex !== undefined) {
    hidden = humanFives.pop(); // 5-6 moves to the boneyard
  }

  const fritzPlain = options.fritzHoldsScoringFive ? 6 : 7;
  const fritzHand = [
    ...(options.fritzHoldsScoringFive ? [finalFive] : []),
    ...nonFives.slice(0, fritzPlain),
  ];
  const boneyardPlain = nonFives.slice(fritzPlain, fritzPlain + options.boneyardSize - (hidden ? 1 : 0));
  const extras = nonFives.slice(fritzPlain + boneyardPlain.length);
  const boneyard = [...boneyardPlain];
  if (hidden && options.playableAtBoneyardIndex !== undefined) {
    boneyard.splice(options.playableAtBoneyardIndex, 0, hidden);
  }
  const humanHand = [...humanFives, ...extras];

  const all = [...boardTiles, ...fritzHand, ...boneyard, ...humanHand];
  if (new Set(all.map(key)).size !== 28 || all.length !== 28) {
    throw new Error('fixture inventory is not a valid double-six set');
  }

  return {
    ...base,
    board,
    handOpen: true,
    boneyard,
    deadTiles: boneyard.slice(-2),
    players: {
      you: { ...base.players.you, hand: humanHand },
      bot: { ...base.players.bot, hand: fritzHand },
    },
    currentPlayer: options.currentPlayer ?? 'bot',
    consecutivePasses: 0,
    handOver: false,
    gameOver: false,
    turnIndex: 10,
    handNumber: 1,
  };
}
