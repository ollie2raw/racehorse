import { passTurn, type BotMatchState } from './botEngine.ts';
import type { Tile } from '../types.ts';

const t = (low: number, high: number): Tile => ({ low, high });

function mkBlockedTieState(): BotMatchState {
  return {
    players: {
      you: { hand: [t(1, 2)], score: 10 },
      bot: { hand: [t(0, 3)], score: 12 },
    },
    board: {
      mainLine: [{ tile: t(6, 6), orientation: 'horizontal-normal' }],
      leftEnd: 6,
      rightEnd: 6,
      leftEndIsDouble: true,
      rightEndIsDouble: true,
      hubDoubles: [],
    },
    boneyard: [t(4, 5), t(5, 5)],
    deadTiles: [t(4, 5), t(5, 5)],
    handOpen: true,
    currentPlayer: 'bot',
    consecutivePasses: 1,
    handNumber: 2,
    turnIndex: 4,
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
  };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[botEngine.blockedHand.behaviorTests] ${msg}`);
}

export function runBotEngineBlockedHandBehaviorTests(): void {
  const result = passTurn(mkBlockedTieState(), 'bot');
  assert(result.state.handOver === true, 'blocked tie should end hand');
  assert(result.state.lastHandWinner === null, 'blocked tie should have no hand winner');
  assert(result.handEnded?.winner === null, 'handEnded winner should be null on tie');
  assert(result.handEnded?.pointsAwarded === 0, 'blocked tie awards no points');
  assert(result.state.players.you.score === 10, 'player score unchanged on tie');
  assert(result.state.players.bot.score === 12, 'bot score unchanged on tie');
  console.log('[botEngine.blockedHand.behaviorTests] passed');
}
