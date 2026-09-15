import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, simulatePlacement, type GameState, type Tile } from '@racehorse/game-core';
import { searchGameTree, type GameTreeWalkConfig, type NodeBudget } from '../searchGameTree';

// Board: a single non-double tile (1,2), giving leftEnd=1, rightEnd=2. Both
// the actor's and the opponent's hands below are chosen to contain no tile
// matching pip 1 or 2, so neither side has a legal play against this board
// until forced draws intervene.
const BOARD = simulatePlacement(null, { low: 1, high: 2 }, 'left');

function makeState(boneyard: readonly Tile[]): GameState {
  return {
    config: { ...DEFAULT_CONFIG, deadTileCount: 0, winningScore: 1_000_000 },
    playerIds: ['you', 'bot'],
    players: {
      you: { id: 'you', hand: [{ low: 3, high: 4 }, { low: 5, high: 6 }], score: 0 },
      bot: { id: 'bot', hand: [], score: 0 },
    },
    board: BOARD,
    boneyard,
    deadTiles: [],
    currentPlayerIndex: 0,
    handNumber: 1,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 0,
  };
}

const NO_DEPTH_CUTOFF: GameTreeWalkConfig = {
  actorId: 'you',
  opponentId: 'bot',
  isCutoff: (state) => state.handOver || state.gameOver,
  leafValue: (state) => state.players.you.score - state.players.bot.score,
};

describe('searchGameTree -- forced-draw handling', () => {
  it('draws when the current player has no legal play and drawable tiles remain, rather than treating the position as a leaf', () => {
    // Trace: root entry (1) -> you draw (0,0) (2) -> you draw (3,3) (3) --
    // boneyard now empty, so no legal play still means pass is legal -- you
    // pass (bot's turn, entry 4) -> bot has no hand and no drawable tiles,
    // so bot also passes (entry 5) -- two consecutive passes block the hand,
    // which is the isCutoff condition here. Independently hand-traced exact
    // node count, not just a loose lower bound.
    const budget: NodeBudget = { count: 0, max: 1_000 };
    const result = searchGameTree(makeState([{ low: 0, high: 0 }, { low: 3, high: 3 }]), 0, NO_DEPTH_CUTOFF, budget);

    expect(result.finished).toBe(true);
    expect(budget.count).toBe(5);
  });

  it('respects the node budget inside a forced-draw chain -- stops mid-chain rather than overshooting maxNodes', () => {
    // maxNodes: 2. Trace: root entry (1) -> first draw (2) -- budget check
    // before the second draw now sees count(2) >= max(2) and stops without
    // drawing the remaining boneyard tiles.
    const budget: NodeBudget = { count: 0, max: 2 };
    const result = searchGameTree(
      makeState([{ low: 0, high: 0 }, { low: 3, high: 3 }, { low: 4, high: 4 }]),
      0,
      NO_DEPTH_CUTOFF,
      budget,
    );

    expect(result.finished).toBe(false);
    expect(budget.count).toBe(2);
    expect(budget.count).toBeLessThanOrEqual(2);
  });
});
