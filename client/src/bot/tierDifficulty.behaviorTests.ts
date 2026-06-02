/**
 * Tier differentiation smoke tests — run via npm run test:bot:tier
 * Kept separate from botHeuristics.behaviorTests.ts so ladder sim work is not blocked
 * by unrelated strategic regression fixtures.
 */
import type { BoardState, Tile } from '../types.ts';
import { chooseBotMove } from './botHeuristics.ts';
import { previewPlayMove, type BotMatchState } from './botEngine.ts';

function mkBoard(left: number, right: number): BoardState {
  return {
    mainLine: [
      {
        tile: { low: Math.min(left, right), high: Math.max(left, right) },
        orientation: 'horizontal-normal',
      },
    ],
    leftEnd: left,
    rightEnd: right,
    leftEndIsDouble: left === right,
    rightEndIsDouble: left === right,
    hubDoubles: [],
  };
}

function mkState(args: {
  botHand: Tile[];
  youHand?: Tile[];
  leftEnd: number;
  rightEnd: number;
  boneyard?: Tile[];
  handNumber?: number;
  turnIndex?: number;
}): BotMatchState {
  return {
    players: {
      bot: { hand: args.botHand, score: 0 },
      you: { hand: args.youHand ?? [], score: 0 },
    },
    board: mkBoard(args.leftEnd, args.rightEnd),
    boneyard: args.boneyard ?? [],
    deadTiles: [],
    handOpen: true,
    currentPlayer: 'bot',
    consecutivePasses: 0,
    handNumber: args.handNumber ?? 1,
    turnIndex: args.turnIndex ?? 0,
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

function sameTile(a: Tile | undefined, b: Tile): boolean {
  if (!a) return false;
  return a.low === b.low && a.high === b.high;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[tierDifficulty.behaviorTests] ${msg}`);
}

function runTierDifficultyBehaviorTests(): void {
  {
    const state = mkState({
      leftEnd: 3,
      rightEnd: 5,
      botHand: [
        { low: 3, high: 3 },
        { low: 1, high: 5 },
        { low: 1, high: 6 },
        { low: 0, high: 2 },
        { low: 2, high: 4 },
        { low: 4, high: 6 },
      ],
      youHand: [
        { low: 0, high: 3 },
        { low: 0, high: 5 },
        { low: 2, high: 2 },
        { low: 4, high: 4 },
        { low: 1, high: 4 },
        { low: 2, high: 6 },
      ],
    });
    const rookie = chooseBotMove(state, 'casual');
    const elite = chooseBotMove(state, 'hard');
    assert(Boolean(rookie?.move?.tile), 'rookie expected a move');
    assert(Boolean(elite?.move?.tile), 'elite expected a move');
    assert(
      !sameTile(elite!.move!.tile!, { low: 3, high: 3 }),
      'elite should avoid unsupported 3-3 double on rookie fixture',
    );
  }

  {
    const state = mkState({
      leftEnd: 1,
      rightEnd: 4,
      botHand: [
        { low: 1, high: 4 },
        { low: 2, high: 4 },
        { low: 1, high: 3 },
        { low: 0, high: 4 },
        { low: 3, high: 3 },
        { low: 3, high: 5 },
      ],
      youHand: [
        { low: 2, high: 6 },
        { low: 3, high: 6 },
        { low: 3, high: 4 },
        { low: 2, high: 2 },
        { low: 0, high: 5 },
        { low: 0, high: 6 },
      ],
      boneyard: [
        { low: 3, high: 4 },
        { low: 4, high: 4 },
        { low: 4, high: 5 },
        { low: 2, high: 5 },
        { low: 4, high: 6 },
        { low: 5, high: 6 },
      ],
    });
    const standard = chooseBotMove(state, 'standard');
    const elite = chooseBotMove(state, 'hard');
    assert(Boolean(standard?.move?.tile), 'standard expected a move');
    assert(Boolean(elite?.move?.tile), 'elite expected a move');
    const stdImmediate = previewPlayMove(state, 'bot', standard!.move!)?.immediateScore ?? 0;
    const eliteImmediate = previewPlayMove(state, 'bot', elite!.move!)?.immediateScore ?? 0;
    const differs =
      !sameTile(standard!.move!.tile!, elite!.move!.tile!) ||
      standard!.move!.position !== elite!.move!.position ||
      stdImmediate !== eliteImmediate;
    assert(differs, 'standard and elite should not always pick identically on refill fixture');
  }

  {
    const state = mkState({
      leftEnd: 1,
      rightEnd: 4,
      botHand: [
        { low: 1, high: 1 },
        { low: 1, high: 4 },
      ],
      youHand: [
        { low: 2, high: 2 },
        { low: 0, high: 0 },
      ],
      handNumber: 4,
      turnIndex: 20,
    });
    const master = chooseBotMove(state, 'master');
    const elite = chooseBotMove(state, 'hard');
    assert(Boolean(master?.move?.tile), 'master endgame expected a move');
    assert(Boolean(elite?.move?.tile), 'elite endgame expected a move');
    const masterImm = previewPlayMove(state, 'bot', master!.move!)?.immediateScore ?? 0;
    const eliteImm = previewPlayMove(state, 'bot', elite!.move!)?.immediateScore ?? 0;
    assert(masterImm >= eliteImm, 'master endgame immediate should be >= elite on exit fixture');
  }
}

runTierDifficultyBehaviorTests();
console.log('[tierDifficulty.behaviorTests] all tests passed');
