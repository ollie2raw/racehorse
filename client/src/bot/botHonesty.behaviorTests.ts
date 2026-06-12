/**
 * Permanent regression tests for Fritz hidden-info and move-legality invariants.
 */
import { chooseBotMove, toBotVisibleState } from './botHeuristics.ts';
import { getLegalMoves, type BotMatchState } from './botEngine.ts';
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

function mkEndgameState(humanHand: Tile[]): BotMatchState {
  return {
    players: {
      bot: { hand: [t(2, 5), t(5, 6)], score: 10 },
      you: { hand: humanHand, score: 8 },
    },
    board: mkBoard(2, 5),
    boneyard: [t(0, 1), t(1, 2), t(3, 3)],
    deadTiles: [t(4, 4), t(6, 6)],
    handOpen: true,
    currentPlayer: 'bot',
    consecutivePasses: 0,
    handNumber: 4,
    turnIndex: 12,
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

function moveKey(move: { type: string; tile?: Tile; position?: string } | null | undefined): string {
  if (!move || move.type !== 'play' || !move.tile) return move?.type ?? 'none';
  return `${move.tile.low}-${move.tile.high}@${move.position ?? 'open'}`;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[botHonesty.behaviorTests] ${msg}`);
}

export function runBotHonestyBehaviorTests(): void {
  // Hidden human hand must not change Fritz move when public state is unchanged.
  {
    let roll = 0;
    const randomSpy = () => {
      roll = (roll + 0.137) % 1;
      return roll;
    };
    const originalRandom = Math.random;
    Math.random = randomSpy;

    try {
      const trap = mkEndgameState([t(6, 6)]);
      const benign = mkEndgameState([t(0, 0)]);
      const trapMove = chooseBotMove(toBotVisibleState(trap), 'master');
      const benignMove = chooseBotMove(toBotVisibleState(benign), 'master');
      assert(trapMove?.move?.type === 'play', 'endgame returns play');
      assert(benignMove?.move?.type === 'play', 'endgame returns play');
      assert(moveKey(trapMove?.move) === moveKey(benignMove?.move), 'hidden hand invariant');
    } finally {
      Math.random = originalRandom;
    }
  }

  // Boneyard order must not change Fritz move when count/unseen pool unchanged.
  {
    const yard: Tile[] = [t(0, 1), t(3, 4), t(5, 6), t(2, 2), t(1, 3)];
    const base: BotMatchState = {
      players: {
        bot: { hand: [t(2, 5), t(4, 5), t(5, 5)], score: 0 },
        you: { hand: [t(0, 0), t(1, 1)], score: 0 },
      },
      board: mkBoard(2, 5),
      boneyard: yard,
      deadTiles: [],
      handOpen: true,
      currentPlayer: 'bot',
      consecutivePasses: 0,
      handNumber: 2,
      turnIndex: 3,
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
    const forward = chooseBotMove(toBotVisibleState(base), 'hard');
    const reversed = chooseBotMove(
      toBotVisibleState({ ...base, boneyard: [...yard].reverse() }),
      'hard',
    );
    assert(moveKey(forward?.move) === moveKey(reversed?.move), 'boneyard order invariant');
  }

  // Fritz never chooses illegal moves across representative endgame positions.
  {
    const scenarios: BotMatchState[] = [
      mkEndgameState([t(1, 3)]),
      mkEndgameState([t(0, 0)]),
      {
        ...mkEndgameState([t(2, 3)]),
        board: mkBoard(5, 6),
        players: {
          bot: { hand: [t(1, 4)], score: 0 },
          you: { hand: [t(2, 3)], score: 0 },
        },
        boneyard: [],
        deadTiles: [t(6, 6), t(4, 5)],
      },
    ];

    for (const state of scenarios) {
      const visible = toBotVisibleState(state);
      for (const tier of ['casual', 'standard', 'hard', 'master'] as const) {
        const chosen = chooseBotMove(visible, tier);
        if (!chosen?.move) continue;
        if (chosen.move.type === 'pass') {
          const legal = getLegalMoves(state, 'bot');
          assert(
            legal.every((m) => m.type !== 'play'),
            `${tier}: pass only when no legal play`,
          );
          continue;
        }
        const legal = getLegalMoves(state, 'bot').filter((m) => m.type === 'play');
        assert(
          legal.some(
            (m) =>
              m.tile &&
              chosen.move?.tile &&
              m.tile.low === chosen.move.tile.low &&
              m.tile.high === chosen.move.tile.high,
          ),
          `${tier}: chosen move must be legal`,
        );
      }
    }
  }

  // Fritz does not pass when a legal play exists.
  {
    const state = mkEndgameState([t(1, 3)]);
    const chosen = chooseBotMove(toBotVisibleState(state), 'hard');
    assert(chosen?.move?.type === 'play', 'play exists — no pass');
  }

  console.log('[botHonesty.behaviorTests] passed');
}

runBotHonestyBehaviorTests();
