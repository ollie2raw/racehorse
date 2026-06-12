/**
 * Tier differentiation smoke tests — run via npm run test:bot:tier
 * Kept separate from botHeuristics.behaviorTests.ts so ladder sim work is not blocked
 * by unrelated strategic regression fixtures.
 */
import type { BoardState, Tile } from '../types.ts';
import { chooseBotMove, toBotVisibleState } from './botHeuristics.ts';
import { previewPlayMove, getLegalMoves, type BotMatchState } from './botEngine.ts';

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
  botScore?: number;
  youScore?: number;
}): BotMatchState {
  return {
    players: {
      bot: { hand: args.botHand, score: args.botScore ?? 0 },
      you: { hand: args.youHand ?? [], score: args.youScore ?? 0 },
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

  {
    const yard: Tile[] = [
      { low: 0, high: 2 },
      { low: 4, high: 5 },
      { low: 2, high: 6 },
      { low: 0, high: 6 },
    ];
    const state = mkState({
      leftEnd: 1,
      rightEnd: 6,
      botHand: [
        { low: 1, high: 1 },
        { low: 1, high: 4 },
        { low: 2, high: 3 },
      ],
      youHand: [
        { low: 3, high: 3 },
        { low: 3, high: 5 },
      ],
      boneyard: yard,
      botScore: 48,
      youScore: 57,
      handNumber: 4,
      turnIndex: 22,
    });
    const visible = toBotVisibleState(state);
    const master = chooseBotMove(visible, 'master');
    const elite = chooseBotMove(visible, 'hard');
    assert(Boolean(master?.move?.tile), 'master sacrifice fixture expected a move');
    assert(Boolean(elite?.move?.tile), 'elite sacrifice fixture expected a move');
    const masterImm = previewPlayMove(state, 'bot', master!.move!)?.immediateScore ?? 0;
    const eliteImm = previewPlayMove(state, 'bot', elite!.move!)?.immediateScore ?? 0;
    assert(sameTile(master!.move!.tile!, { low: 1, high: 1 }), 'master should sacrifice immediate points for control');
    assert(sameTile(elite!.move!.tile!, { low: 1, high: 4 }), 'elite should take the immediate scoring line');
    assert(eliteImm > masterImm, 'elite should score more immediately on sacrifice fixture');
    const legal = getLegalMoves(state, 'bot').filter((m) => m.type === 'play');
    assert(
      legal.some((m) => m.tile && master?.move?.tile && m.tile.low === master.move.tile.low && m.tile.high === master.move.tile.high),
      'master sacrifice move must be legal',
    );
    const reversed = mkState({
      leftEnd: 1,
      rightEnd: 6,
      botHand: state.players.bot.hand,
      youHand: state.players.you.hand,
      boneyard: [...yard].reverse(),
      botScore: 48,
      youScore: 57,
      handNumber: 4,
      turnIndex: 22,
    });
    const masterReversed = chooseBotMove(toBotVisibleState(reversed), 'master');
    assert(
      sameTile(masterReversed?.move?.tile, { low: 1, high: 1 }) &&
        masterReversed?.move?.position === master?.move?.position,
      'master sacrifice choice should be invariant to boneyard order',
    );
  }
}

runTierDifficultyBehaviorTests();
console.log('[tierDifficulty.behaviorTests] all tests passed');
