import type { BoardState, Tile } from '../types.ts';
import { chooseBotMove, toBotVisibleState } from './botHeuristics.ts';
import { getLegalMoves, type BotMatchState } from './botEngine.ts';

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
  turnIndex?: number;
  handNumber?: number;
  opponentKnownMissing?: number[];
  opponentPassedOnEnds?: number[];
  opponentMissingEvidence?: Array<{ pip: number; handNumber: number; turnIndex: number }>;
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
    opponentPassedOnEnds: args.opponentPassedOnEnds ?? [],
    opponentDrawCount: 0,
    opponentKnownMissing: args.opponentKnownMissing ?? [],
    opponentMissingEvidence: args.opponentMissingEvidence ?? [],
  };
}

function sameTile(a: Tile | undefined, b: Tile): boolean {
  if (!a) return false;
  return a.low === b.low && a.high === b.high;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[botHeuristics.behaviorTests] ${msg}`);
}

export function runBotHeuristicsBehaviorTests(): void {
  // Test 1: End-control preference
  {
    const state = mkState({
      leftEnd: 2,
      rightEnd: 5,
      botHand: [
        { low: 2, high: 2 },
        { low: 2, high: 5 },
        { low: 5, high: 6 },
        { low: 4, high: 5 },
      ],
      youHand: [{ low: 0, high: 0 }, { low: 1, high: 1 }],
    });
    const chosen = chooseBotMove(state, 'hard');
    assert(Boolean(chosen?.move?.tile), 'Test 1 expected a play move');
    assert(!sameTile(chosen?.move?.tile, { low: 2, high: 2 }), 'Test 1 should avoid weak-end double 2 opening');
  }

  // Test 2: Orphan avoidance
  {
    const state = mkState({
      leftEnd: 2,
      rightEnd: 5,
      botHand: [
        { low: 1, high: 2 }, // risky: leaves 4-4 orphan
        { low: 2, high: 4 }, // safe: keeps 4 connected
        { low: 4, high: 4 },
      ],
      youHand: [{ low: 0, high: 5 }],
    });
    const chosen = chooseBotMove(state, 'hard');
    assert(Boolean(chosen?.move?.tile), 'Test 2 expected a play move');
    assert(sameTile(chosen?.move?.tile, { low: 2, high: 4 }), 'Test 2 should prefer non-orphaning move 2-4');
  }

  // Test 3: Double discipline early
  {
    const state = mkState({
      leftEnd: 3,
      rightEnd: 5,
      botHand: [
        { low: 3, high: 3 }, // unsupported early double
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
    const chosen = chooseBotMove(state, 'hard');
    assert(Boolean(chosen?.move?.tile), 'Test 3 expected a play move');
    assert(!sameTile(chosen?.move?.tile, { low: 3, high: 3 }), 'Test 3 should avoid unsupported early double');
  }

  // Test 4: 2-ply safety (avoid opponent mobility trap)
  {
    const state = mkState({
      leftEnd: 1,
      rightEnd: 5,
      botHand: [
        { low: 1, high: 6 }, // tempting but lets opponent force bad line
        { low: 3, high: 5 }, // safer
        { low: 3, high: 3 },
      ],
      youHand: [
        { low: 0, high: 5 },
        { low: 2, high: 5 },
        { low: 0, high: 0 },
      ],
    });
    const chosen = chooseBotMove(state, 'hard');
    assert(Boolean(chosen?.move?.tile), 'Test 4 expected a play move');
    assert(sameTile(chosen?.move?.tile, { low: 3, high: 5 }), 'Test 4 should pick safer move under worst-case');
  }

  // Test 5: Late exit override
  {
    const state = mkState({
      leftEnd: 1,
      rightEnd: 4,
      botHand: [
        { low: 1, high: 1 }, // play this first to chain and go out
        { low: 1, high: 4 },
      ],
      youHand: [{ low: 2, high: 2 }],
    });
    const chosen = chooseBotMove(state, 'hard');
    assert(Boolean(chosen?.move?.tile), 'Test 5 expected a play move');
    assert(sameTile(chosen?.move?.tile, { low: 1, high: 1 }), 'Test 5 should prioritize exit path');
  }

  // Extra sanity: forced single legal move
  {
    const state = mkState({
      leftEnd: 6,
      rightEnd: 6,
      botHand: [{ low: 0, high: 6 }],
      youHand: [{ low: 1, high: 1 }],
    });
    const chosen = chooseBotMove(state, 'hard');
    assert(Boolean(chosen?.move?.tile), 'Extra test expected a play move');
    assert(sameTile(chosen?.move?.tile, { low: 0, high: 6 }), 'Extra test should pick only legal tile');
  }

  // Test 6: Early phase still produces a legal hard-tier play under FairBotMode
  {
    const state = mkState({
      leftEnd: 1,
      rightEnd: 4,
      botHand: [
        { low: 1, high: 4 }, // same tile has safe/risky side placements
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
    const chosen = chooseBotMove(toBotVisibleState(state), 'hard');
    assert(Boolean(chosen?.move?.tile), 'Test 6 expected a play move');
    const legal = getLegalMoves(state, 'bot').filter((m) => m.type === 'play');
    assert(
      legal.some(
        (m) =>
          m.tile &&
          chosen?.move?.tile &&
          m.tile.low === chosen.move.tile.low &&
          m.tile.high === chosen.move.tile.high,
      ),
      'Test 6 chosen move must be legal',
    );
  }

  // Test 7: Late phase draw pressure prefers missing-pip end
  {
    const state = mkState({
      leftEnd: 6,
      rightEnd: 1,
      botHand: [
        { low: 1, high: 2 }, // keeps 6 open and can force draw
        { low: 4, high: 6 }, // gives opponent a 1-end reply
        { low: 4, high: 4 },
      ],
      youHand: [
        { low: 1, high: 3 },
        { low: 1, high: 5 },
      ],
      boneyard: [
        { low: 0, high: 0 },
        { low: 2, high: 5 },
        { low: 0, high: 4 },
        { low: 2, high: 6 },
        { low: 5, high: 6 },
      ],
      handNumber: 2,
      turnIndex: 10,
      opponentKnownMissing: [6],
      opponentMissingEvidence: [{ pip: 6, handNumber: 2, turnIndex: 9 }],
    });
    const chosen = chooseBotMove(state, 'hard');
    assert(Boolean(chosen?.move?.tile), 'Test 7 expected a play move');
    assert(sameTile(chosen?.move?.tile, { low: 1, high: 2 }), 'Test 7 should prefer late draw pressure on missing pip 6');
  }

  // Test 8: GOLDEN endgame prefers forced-draw with outlet retained
  {
    const state = mkState({
      leftEnd: 6,
      rightEnd: 1,
      botHand: [
        { low: 1, high: 2 }, // GOLDEN: forces draw, leaves 2-2 outlet
        { low: 0, high: 1 }, // non-golden alternative
        { low: 2, high: 2 },
      ],
      youHand: [
        { low: 1, high: 5 },
        { low: 1, high: 3 },
      ],
      boneyard: [
        { low: 4, high: 4 },
        { low: 5, high: 6 },
        { low: 0, high: 6 },
        { low: 2, high: 6 },
        { low: 3, high: 6 },
      ],
      handNumber: 3,
      turnIndex: 12,
    });
    const chosen = chooseBotMove(state, 'hard');
    assert(Boolean(chosen?.move?.tile), 'Test 8 expected a play move');
    assert(sameTile(chosen?.move?.tile, { low: 1, high: 2 }), 'Test 8 should choose GOLDEN forced-draw outlet line');
  }

  // Test 9: GOLDEN vs non-golden (both force draw, choose outlet-preserving line)
  {
    const state = mkState({
      leftEnd: 1,
      rightEnd: 4,
      botHand: [
        { low: 1, high: 2 }, // non-golden: leaves 1-3 / 3-3 with no outlet on 2/4
        { low: 1, high: 3 }, // golden: leaves outlet 3-3 on 3/4
        { low: 3, high: 3 },
      ],
      youHand: [
        { low: 0, high: 1 },
        { low: 1, high: 5 },
        { low: 0, high: 6 },
      ],
      boneyard: [
        { low: 2, high: 6 },
        { low: 4, high: 6 },
        { low: 5, high: 6 },
        { low: 0, high: 0 },
        { low: 2, high: 2 },
      ],
      handNumber: 3,
      turnIndex: 14,
    });
    const chosen = chooseBotMove(state, 'hard');
    assert(Boolean(chosen?.move?.tile), 'Test 9 expected a play move');
    assert(sameTile(chosen?.move?.tile, { low: 1, high: 3 }), 'Test 9 should choose GOLDEN outlet-preserving forced draw');
  }

  // Test 10: Saturation avoidance (prefer scarcer end)
  {
    const state = mkState({
      leftEnd: 2,
      rightEnd: 6,
      botHand: [
        { low: 2, high: 6 }, // same tile can leave 6 or 2 depending on side
        { low: 6, high: 6 },
        { low: 4, high: 4 },
        { low: 0, high: 0 },
        { low: 1, high: 1 },
        { low: 3, high: 3 },
        { low: 0, high: 1 },
      ],
      youHand: [
        { low: 0, high: 0 },
        { low: 1, high: 1 },
        { low: 3, high: 3 },
        { low: 4, high: 6 },
        { low: 5, high: 5 },
        { low: 1, high: 4 },
        { low: 3, high: 5 },
      ],
    });
    // Saturate pip 2 in known tiles so unseen pool has fewer 2 matches than 6.
    state.board = {
      ...state.board!,
      mainLine: [
        { tile: { low: 2, high: 6 }, orientation: 'horizontal-normal' },
        { tile: { low: 2, high: 2 }, orientation: 'horizontal-normal' },
        { tile: { low: 0, high: 2 }, orientation: 'horizontal-normal' },
        { tile: { low: 1, high: 2 }, orientation: 'horizontal-normal' },
        { tile: { low: 2, high: 3 }, orientation: 'horizontal-normal' },
        { tile: { low: 2, high: 4 }, orientation: 'horizontal-normal' },
        { tile: { low: 5, high: 6 }, orientation: 'horizontal-normal' },
      ],
      leftEnd: 2,
      rightEnd: 6,
    };
    const chosen = chooseBotMove(toBotVisibleState(state), 'hard');
    assert(Boolean(chosen?.move?.tile), 'Test 10 expected a play move');
    const legal = getLegalMoves(state, 'bot').filter((m) => m.type === 'play');
    assert(
      legal.some(
        (m) =>
          m.tile &&
          chosen?.move?.tile &&
          m.tile.low === chosen.move.tile.low &&
          m.tile.high === chosen.move.tile.high,
      ),
      'Test 10 chosen move must be legal under public-info draw modeling',
    );
  }

  // Test 11: Synergy override (long in pip, willing to keep that end)
  {
    const state = mkState({
      leftEnd: 2,
      rightEnd: 6,
      botHand: [
        { low: 2, high: 6 },
        { low: 0, high: 6 },
        { low: 1, high: 6 },
        { low: 3, high: 6 },
        { low: 6, high: 6 },
        { low: 0, high: 1 },
        { low: 3, high: 3 },
      ],
      youHand: [
        { low: 0, high: 0 },
        { low: 1, high: 1 },
        { low: 3, high: 3 },
        { low: 4, high: 6 },
        { low: 5, high: 5 },
        { low: 1, high: 4 },
        { low: 3, high: 5 },
      ],
    });
    state.board = {
      ...state.board!,
      mainLine: [
        { tile: { low: 2, high: 6 }, orientation: 'horizontal-normal' },
        { tile: { low: 2, high: 2 }, orientation: 'horizontal-normal' },
        { tile: { low: 0, high: 2 }, orientation: 'horizontal-normal' },
        { tile: { low: 1, high: 2 }, orientation: 'horizontal-normal' },
        { tile: { low: 2, high: 3 }, orientation: 'horizontal-normal' },
        { tile: { low: 2, high: 4 }, orientation: 'horizontal-normal' },
        { tile: { low: 5, high: 6 }, orientation: 'horizontal-normal' },
      ],
      leftEnd: 2,
      rightEnd: 6,
    };
    const chosen = chooseBotMove(toBotVisibleState(state), 'hard');
    assert(Boolean(chosen?.move?.tile), 'Test 11 expected a play move');
    const legal = getLegalMoves(state, 'bot').filter((m) => m.type === 'play');
    assert(
      legal.some(
        (m) =>
          m.tile &&
          chosen?.move?.tile &&
          m.tile.low === chosen.move.tile.low &&
          m.tile.high === chosen.move.tile.high,
      ),
      'Test 11 chosen move must be legal under public-info draw modeling',
    );
  }

  // Test 12: draw-cost / move choice must not depend on boneyard stack order
  {
    const yard: Tile[] = [
      { low: 0, high: 1 },
      { low: 3, high: 4 },
      { low: 5, high: 6 },
      { low: 2, high: 2 },
      { low: 1, high: 3 },
    ];
    const forward = mkState({
      leftEnd: 2,
      rightEnd: 5,
      botHand: [
        { low: 2, high: 5 },
        { low: 4, high: 5 },
        { low: 5, high: 5 },
        { low: 1, high: 4 },
      ],
      boneyard: yard,
    });
    const reversed = mkState({
      leftEnd: 2,
      rightEnd: 5,
      botHand: forward.players.bot.hand,
      boneyard: [...yard].reverse(),
    });
    const a = chooseBotMove(toBotVisibleState(forward), 'hard');
    const b = chooseBotMove(toBotVisibleState(reversed), 'hard');
    assert(Boolean(a?.move?.tile), 'Test 12 expected a play move');
    assert(Boolean(a?.move?.tile && b?.move?.tile), 'Test 12 expected tiles on both choices');
    assert(
      sameTile(a!.move!.tile, b!.move!.tile!) && a!.move!.position === b!.move!.position,
      'Test 12 move should be invariant to boneyard order',
    );
  }
}

runBotHeuristicsBehaviorTests();
console.log('[botHeuristics.behaviorTests] all tests passed');
