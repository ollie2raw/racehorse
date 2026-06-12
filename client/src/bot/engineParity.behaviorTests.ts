/**
 * Mirror of server/src/game/engineParity.test.ts for client botEngine.ts.
 * Scenario IDs must stay aligned for drift detection.
 */
import {
  applyPlayMove,
  computePlayScore,
  drawOne,
  drawUntilPlayableOrEmpty,
  getLegalMoves,
  passTurn,
  simulatePlacement,
  type BotMatchState,
} from './botEngine.ts';
import type { BoardState, Tile } from '../types.ts';

const t = (low: number, high: number): Tile => ({ low: Math.min(low, high), high: Math.max(low, high) });

function mkBoard(left: number, right: number): BoardState {
  return {
    mainLine: [{ tile: t(left, right), orientation: 'horizontal-normal' }],
    leftEnd: left,
    rightEnd: right,
    leftEndIsDouble: left === right,
    rightEndIsDouble: left === right,
    hubDoubles: [],
  };
}

function mkState(overrides: Partial<BotMatchState>): BotMatchState {
  return {
    players: {
      you: { hand: [], score: 0 },
      bot: { hand: [], score: 0 },
    },
    board: null,
    boneyard: [],
    deadTiles: [],
    handOpen: false,
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
    opponentPassedOnEnds: [],
    opponentDrawCount: 0,
    opponentKnownMissing: [],
    opponentMissingEvidence: [],
    ...overrides,
  };
}

function moveKeys(moves: ReturnType<typeof getLegalMoves>): string[] {
  return moves.map((m) => {
    if (m.type === 'pass') return 'pass';
    return `${m.tile!.low}-${m.tile!.high}@${m.position ?? 'open'}`;
  });
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[engineParity.behaviorTests] ${msg}`);
}

export function runEngineParityBehaviorTests(): void {
  // parity-legal-moves
  {
    const state = mkState({
      board: mkBoard(3, 5),
      handOpen: true,
      currentPlayer: 'you',
      players: {
        you: { hand: [t(3, 4), t(0, 1)], score: 0 },
        bot: { hand: [t(2, 2)], score: 0 },
      },
      boneyard: [t(6, 6)],
    });
    const keys = moveKeys(getLegalMoves(state, 'you'));
    assert(keys.includes('3-4@left'), 'legal 3-4@left');
    assert(!keys.includes('0-1@left'), 'illegal 0-1@left');
    assert(!keys.includes('pass'), 'no pass while playable');
  }

  // parity-forced-draw / boneyard-lock boundary
  {
    const state = mkState({
      board: mkBoard(6, 6),
      handOpen: true,
      currentPlayer: 'you',
      players: {
        you: { hand: [t(0, 1)], score: 0 },
        bot: { hand: [t(2, 3)], score: 0 },
      },
      boneyard: [t(4, 5), t(1, 2), t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
    });
    assert(getLegalMoves(state, 'you').every((m) => m.type !== 'pass'), 'forced draw — no pass');
    const drawn = drawUntilPlayableOrEmpty(state, 'you');
    assert(Boolean(drawn.drew), 'draw chain occurred');
  }

  // parity-boneyard-lock + pass
  {
    const state = mkState({
      board: mkBoard(5, 6),
      handOpen: true,
      currentPlayer: 'you',
      players: {
        you: { hand: [t(1, 4)], score: 0 },
        bot: { hand: [t(2, 3)], score: 0 },
      },
      boneyard: [t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
    });
    assert(getLegalMoves(state, 'you').length === 1 && getLegalMoves(state, 'you')[0].type === 'pass', 'pass only');
  }

  // parity-blocked-hand + blocked-tie
  {
    const tie = mkState({
      board: mkBoard(6, 6),
      handOpen: true,
      currentPlayer: 'bot',
      consecutivePasses: 1,
      players: {
        you: { hand: [t(1, 2)], score: 10 },
        bot: { hand: [t(0, 3)], score: 12 },
      },
      boneyard: [t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
    });
    const tieResult = passTurn(tie, 'bot');
    assert(tieResult.state.handOver === true, 'blocked tie ends hand');
    assert(tieResult.state.lastHandWinner === null, 'blocked tie no winner');
    assert(tieResult.handEnded?.pointsAwarded === 0, 'blocked tie no points');

    const win = mkState({
      board: mkBoard(5, 6),
      handOpen: true,
      currentPlayer: 'bot',
      consecutivePasses: 1,
      players: {
        you: { hand: [t(1, 4)], score: 10 },
        bot: { hand: [t(0, 1)], score: 12 },
      },
      boneyard: [t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
    });
    const winResult = passTurn(win, 'bot');
    assert(winResult.state.lastHandWinner === 'bot', 'blocked hand lowest pips wins');
    assert((winResult.handEnded?.pointsAwarded ?? 0) > 0, 'blocked hand awards points');
  }

  // parity-multiples-of-five
  {
    const board = simulatePlacement(null, t(4, 6), 'left');
    assert(computePlayScore(board!) === 2, 'open ends 10 => 2 points');
  }

  // parity-end-of-hand domino out
  {
    const state = mkState({
      board: mkBoard(3, 5),
      handOpen: true,
      currentPlayer: 'you',
      players: {
        you: { hand: [t(3, 4)], score: 20 },
        bot: { hand: [t(1, 2), t(0, 0)], score: 18 },
      },
      boneyard: [t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
    });
    const result = applyPlayMove(state, 'you', { type: 'play', tile: t(3, 4), position: 'left' });
    assert(result.state.handOver === true, 'domino out ends hand');
    assert(result.state.players.you.score > 20, 'go-out bonus applied');
  }

  // parity-61-61 strict leader
  {
    const state = mkState({
      board: mkBoard(5, 6),
      handOpen: true,
      currentPlayer: 'you',
      winningScore: 60,
      players: {
        you: { hand: [t(1, 2)], score: 61 },
        bot: { hand: [t(0, 3)], score: 61 },
      },
      boneyard: [t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
    });
    let next = passTurn(state, 'you').state;
    next = passTurn(next, 'bot').state;
    assert(next.handOver === true, '61-61 hand ends');
    assert(next.gameOver === false, '61-61 game continues');
    assert(next.winnerId === null, '61-61 no winner');
  }

  // parity-winner-detection
  {
    const state = mkState({
      board: mkBoard(1, 4),
      handOpen: true,
      currentPlayer: 'you',
      players: {
        you: { hand: [t(1, 6), t(0, 0)], score: 58 },
        bot: { hand: [t(4, 5)], score: 65 },
      },
      boneyard: [t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
    });
    let afterYou = applyPlayMove(state, 'you', { type: 'play', tile: t(1, 6), position: 'left' }).state;
    assert(afterYou.players.you.score === 60, 'you reaches 60 mid-hand');
    assert(afterYou.handOver === false, 'hand continues');
    afterYou = { ...afterYou, currentPlayer: 'bot' };
    const afterBot = applyPlayMove(afterYou, 'bot', { type: 'play', tile: t(4, 5), position: 'right' }).state;
    assert(afterBot.gameOver === true, 'strict leader wins game');
    assert(afterBot.winnerId === 'bot', 'bot is winner');
  }

  // parity-fifo-draw
  {
    const state = mkState({
      board: mkBoard(6, 6),
      handOpen: true,
      currentPlayer: 'you',
      players: {
        you: { hand: [t(0, 1)], score: 0 },
        bot: { hand: [t(2, 3)], score: 0 },
      },
      boneyard: [t(4, 5), t(1, 2), t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
    });
    const result = drawOne(state, 'you');
    assert(result.drew?.tile.low === 4 && result.drew.tile.high === 5, 'FIFO front tile drawn');
    assert(result.state.boneyard[0].low === 1 && result.state.boneyard[0].high === 2, 'FIFO remainder');
  }

  console.log('[engineParity.behaviorTests] passed');
}

runEngineParityBehaviorTests();
