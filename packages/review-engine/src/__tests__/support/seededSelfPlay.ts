/**
 * Honest self-play from a deal seed, on the authoritative core engine only.
 *
 * This is the shape of a saved game record: a deal seed plus the ordered actions. It deals exactly as ranked Play vs
 * Fritz does (`<seed>:h<hand>`, 2 dead tiles for 7-tile deals and none for 14), so a record produced here must rebuild
 * to the same score on the client and replay to the same score on the server. The server has an independent copy of
 * this driver (`server/src/testing/rankedDealSelfPlay.ts`); `server/src/gameRecords/selfPlayParity.test.ts` pins the
 * two together so the client and server dealing contracts cannot drift apart unnoticed.
 *
 * Imports only `@racehorse/game-core`, so client tests may use it (client tests must not import server source).
 */
import {
  applyMove,
  canDraw,
  createDeterministicDoubleSixDeal,
  createInitialState,
  drawOne,
  getLegalMoves,
  startNewHand,
  type GameState,
  type Tile,
} from '@racehorse/game-core';

export type SeededGameInput = {
  seed: string;
  dealSize: 7 | 14;
  winningScore: number;
  matchStarter: 'you' | 'bot';
};

/** One action in the compact shape the client saves (`RecordMoveEntry`). */
export type SeededAction = {
  turn: number;
  hand_number: number;
  actor: 'you' | 'fritz';
  tile_played: string | null;
  branch: string | null;
  score_delta: number;
};

export type SeededGame = {
  moves: SeededAction[];
  playerScore: number;
  opponentScore: number;
  handCount: number;
};

const tileKey = (tile: Tile): string => `${Math.min(tile.low, tile.high)}|${Math.max(tile.low, tile.high)}`;

function deckForHand(input: SeededGameInput, handNumber: number): Tile[] {
  const deal = createDeterministicDoubleSixDeal({
    seed: `${input.seed}:h${handNumber}`,
    tilesPerPlayer: input.dealSize,
    deadTileCount: input.dealSize === 14 ? 0 : 2,
  });
  return [...deal.playerTiles, ...deal.opponentTiles, ...deal.boneyard];
}

function starterForHand(input: SeededGameInput, handNumber: number): 'you' | 'bot' {
  return handNumber % 2 === 1 ? input.matchStarter : input.matchStarter === 'you' ? 'bot' : 'you';
}

function openHand(input: SeededGameInput, previous: GameState | null, handNumber: number): GameState {
  const base = previous ?? createInitialState(['you', 'bot'], {
    tilesPerPlayer: input.dealSize,
    deadTileCount: input.dealSize === 14 ? 0 : 2,
    winningScore: input.winningScore,
    skipPregameDraw: true,
  });
  const carried = previous
    ? {
        ...base,
        players: {
          you: { ...base.players.you, score: previous.players.you.score, hand: [] },
          bot: { ...base.players.bot, score: previous.players.bot.score, hand: [] },
        },
        handOver: false,
        gameOver: false,
        winnerId: null,
      }
    : base;
  return startNewHand(carried, deckForHand(input, handNumber), starterForHand(input, handNumber));
}

/** Plays the first legal play, draws one tile at a time when it must, and passes when it can do nothing else. */
export function playSeededGame(input: SeededGameInput): SeededGame {
  let state = openHand(input, null, 1);
  const moves: SeededAction[] = [];
  let guard = 0;
  while (!state.gameOver && guard < 4000) {
    guard += 1;
    if (state.handOver) {
      state = openHand(input, state, state.handNumber + 1);
      continue;
    }
    const actorId = state.playerIds[state.currentPlayerIndex] as 'you' | 'bot';
    const actor = actorId === 'you' ? 'you' : 'fritz';
    const handNumber = state.handNumber;
    const play = getLegalMoves(state, actorId).find((move) => move.type === 'play');
    if (play && play.type === 'play') {
      moves.push({ turn: moves.length + 1, hand_number: handNumber, actor, tile_played: tileKey(play.tile), branch: play.position, score_delta: 0 });
      state = applyMove(state, actorId, play).state;
      continue;
    }
    if (canDraw(state, actorId)) {
      moves.push({ turn: moves.length + 1, hand_number: handNumber, actor, tile_played: null, branch: 'draw', score_delta: 0 });
      state = drawOne(state, actorId).state;
      continue;
    }
    moves.push({ turn: moves.length + 1, hand_number: handNumber, actor, tile_played: null, branch: 'pass', score_delta: 0 });
    state = applyMove(state, actorId, { type: 'pass' }).state;
  }
  if (!state.gameOver) throw new Error('Seeded self-play did not finish the game.');
  return {
    moves,
    playerScore: state.players.you.score,
    opponentScore: state.players.bot.score,
    handCount: state.handNumber,
  };
}
