// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  isDouble,
  generateDoubleSixSet,
  resolveHandStarter,
  createBotMatch,
  createFixedBotMatch,
  startNextBotHand,
  simulatePlacement,
  getMatchableOpenEnds,
  getPlacementTargetsForTile,
  computePlayScore,
  getLegalMoves,
  previewPlayMove,
  applyPlayMove,
  drawOne,
  passTurn,
} from './botEngine.ts';
import type { Tile, BoardState, Move } from '../../../types.ts';

describe('botEngine', () => {
  const dummyTile = (low: number, high: number): Tile => ({ low, high });

  it('1. isDouble identifies double and non-double tiles correctly', () => {
    expect(isDouble(dummyTile(5, 5))).toBe(true);
    expect(isDouble(dummyTile(0, 0))).toBe(true);
    expect(isDouble(dummyTile(3, 4))).toBe(false);
  });

  it('2. generateDoubleSixSet creates exactly 28 tiles', () => {
    const set = generateDoubleSixSet();
    expect(set.length).toBe(28);
    expect(set.some((t) => t.low === 0 && t.high === 0)).toBe(true);
    expect(set.some((t) => t.low === 6 && t.high === 6)).toBe(true);
  });

  it('3. resolveHandStarter alternates currentPlayer based on matchStarter and handNumber', () => {
    expect(resolveHandStarter('you', 1)).toBe('you');
    expect(resolveHandStarter('you', 2)).toBe('bot');
    expect(resolveHandStarter('bot', 1)).toBe('bot');
    expect(resolveHandStarter('bot', 2)).toBe('you');
  });

  it('4. createBotMatch sets up standard 7-tile game successfully', () => {
    const state = createBotMatch(60, 7);
    expect(state.dealSize).toBe(7);
    expect(state.players.you.hand.length).toBe(7);
    expect(state.players.bot.hand.length).toBe(7);
    expect(state.boneyard.length).toBe(14); // 28 - 14 = 14
    expect(state.deadTiles.length).toBe(2);
    expect(state.board).toBeNull();
  });

  it('5. createFixedBotMatch sets up game with specified hands', () => {
    const handDeal = {
      player_tiles: [dummyTile(0, 0), dummyTile(1, 1)],
      fritz_tiles: [dummyTile(2, 2), dummyTile(3, 3)],
      boneyard: [dummyTile(4, 4)],
      locked: [dummyTile(5, 5)],
    };
    const state = createFixedBotMatch(handDeal, 60, 7);
    expect(state.players.you.hand).toEqual(handDeal.player_tiles);
    expect(state.players.bot.hand).toEqual(handDeal.fritz_tiles);
    expect(state.boneyard).toEqual(handDeal.boneyard);
    expect(state.deadTiles).toEqual(handDeal.locked);
  });

  it('6. startNextBotHand rolls scores and increments handNumber', () => {
    const initial = createBotMatch(60, 7);
    initial.players.you.score = 25;
    initial.players.bot.score = 15;
    const next = startNextBotHand(initial);
    expect(next.handNumber).toBe(2);
    expect(next.players.you.score).toBe(25);
    expect(next.players.bot.score).toBe(15);
  });

  it('7. simulatePlacement handles first tile double properly', () => {
    const nextBoard = simulatePlacement(null, dummyTile(6, 6), 'left');
    expect(nextBoard.leftEnd).toBe(6);
    expect(nextBoard.rightEnd).toBe(6);
    expect(nextBoard.leftEndIsDouble).toBe(true);
    expect(nextBoard.rightEndIsDouble).toBe(true);
    expect(nextBoard.hubDoubles.length).toBe(1);
    expect(nextBoard.hubDoubles[0].hubValue).toBe(6);
  });

  it('8. simulatePlacement handles first tile non-double properly', () => {
    const nextBoard = simulatePlacement(null, dummyTile(3, 5), 'left');
    expect(nextBoard.leftEnd).toBe(3);
    expect(nextBoard.rightEnd).toBe(5);
    expect(nextBoard.leftEndIsDouble).toBe(false);
    expect(nextBoard.rightEndIsDouble).toBe(false);
    expect(nextBoard.hubDoubles.length).toBe(0);
  });

  it('9. getMatchableOpenEnds returns empty left end on null board', () => {
    expect(getMatchableOpenEnds(null)).toEqual([{ position: 'left', matchValue: -1 }]);
  });

  it('10. getMatchableOpenEnds returns correct open ends for mainline', () => {
    const board: BoardState = {
      leftEnd: 3,
      rightEnd: 5,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      mainLine: [
        { tile: dummyTile(3, 4), orientation: 'horizontal-normal' },
        { tile: dummyTile(4, 5), orientation: 'horizontal-normal' },
      ],
      hubDoubles: [],
    };
    const ends = getMatchableOpenEnds(board);
    expect(ends).toEqual([
      { position: 'left', matchValue: 3 },
      { position: 'right', matchValue: 5 },
    ]);
  });

  it('11. getPlacementTargetsForTile returns targets on matching ends', () => {
    const board: BoardState = {
      leftEnd: 3,
      rightEnd: 5,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      mainLine: [
        { tile: dummyTile(3, 4), orientation: 'horizontal-normal' },
        { tile: dummyTile(4, 5), orientation: 'horizontal-normal' },
      ],
      hubDoubles: [],
    };
    const targets1 = getPlacementTargetsForTile(board, dummyTile(3, 1));
    expect(targets1).toEqual(['left']);
    const targets2 = getPlacementTargetsForTile(board, dummyTile(5, 6));
    expect(targets2).toEqual(['right']);
    const targetsBoth = getPlacementTargetsForTile(board, dummyTile(3, 5));
    expect(targetsBoth).toEqual(['left', 'right']);
  });

  it('12. computePlayScore calculates score divided by 5 or 0', () => {
    // left = 3, right = 2, total = 5 -> score is 1
    const board1: BoardState = {
      leftEnd: 3,
      rightEnd: 2,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      mainLine: [
        { tile: dummyTile(3, 4), orientation: 'horizontal-normal' as const },
        { tile: dummyTile(4, 2), orientation: 'horizontal-normal' as const },
      ],
      hubDoubles: [],
    };
    expect(computePlayScore(board1)).toBe(1);

    // left = 4, right = 4 (double, right) -> total = 4 + 4*2 = 12 -> score is 0 (not multiple of 5)
    const board2: BoardState = {
      leftEnd: 4,
      rightEnd: 4,
      leftEndIsDouble: false,
      rightEndIsDouble: true,
      mainLine: [
        { tile: dummyTile(4, 4), orientation: 'vertical-normal' }
      ] as any,
      hubDoubles: [],
    };
    expect(computePlayScore(board2)).toBe(0);
  });

  it('13. getLegalMoves for starter turn returns all doubles + scoring tiles', () => {
    const state = createFixedBotMatch({
      player_tiles: [dummyTile(6, 6), dummyTile(1, 2), dummyTile(1, 4)], // 1-4 scores (5 pips)
      fritz_tiles: [],
      boneyard: [],
      locked: [],
    }, 60, 7);
    const moves = getLegalMoves(state, 'you');
    expect(moves.length).toBe(2);
    expect(moves.some((m) => m.tile && tEquals(m.tile, dummyTile(6, 6)))).toBe(true);
    expect(moves.some((m) => m.tile && tEquals(m.tile, dummyTile(1, 4)))).toBe(true);
  });

  it('14. getLegalMoves returns empty array if currentPlayer is different', () => {
    const state = createBotMatch(60, 7);
    state.currentPlayer = 'bot';
    expect(getLegalMoves(state, 'you')).toEqual([]);
  });

  it('15. getLegalMoves returns pass if player cannot play and boneyard is empty/locked', () => {
    // Locked tiles stay in `boneyard` but are counted via `locked`/`deadTiles`
    // (drawable = boneyard.length - deadTileCount). An empty `locked` list means
    // both remaining tiles are still drawable, so pass is illegal.
    const locked = [dummyTile(0, 1), dummyTile(0, 2)];
    const handDeal = {
      player_tiles: [dummyTile(3, 3)],
      fritz_tiles: [dummyTile(2, 2)],
      boneyard: locked,
      locked,
    };
    const state = createFixedBotMatch(handDeal, 60, 7);
    state.board = {
      leftEnd: 5,
      rightEnd: 5,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      mainLine: [{ tile: dummyTile(5, 5), orientation: 'vertical-normal' }],
      hubDoubles: [],
    };
    state.handOpen = true;
    const moves = getLegalMoves(state, 'you');
    expect(moves).toEqual([{ type: 'pass' }]);
  });

  it('16. previewPlayMove returns score, preview board, and next hand', () => {
    const handDeal = {
      player_tiles: [dummyTile(5, 6)],
      fritz_tiles: [],
      boneyard: [],
      locked: [],
    };
    const state = createFixedBotMatch(handDeal, 60, 7);
    state.board = {
      leftEnd: 5,
      rightEnd: 2,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      mainLine: [
        { tile: dummyTile(5, 2), orientation: 'horizontal-normal' }, // normal exposes 5 on left
      ],
      hubDoubles: [],
    };
    state.handOpen = true;
    const move: Move = { type: 'play', tile: dummyTile(5, 6), position: 'left' };
    const preview = previewPlayMove(state, 'you', move);
    expect(preview).not.toBeNull();
    expect(preview!.immediateScore).toBe(0);
    expect(preview!.nextHand).toEqual([]);
    expect(preview!.nextBoard.leftEnd).toBe(6);
  });

  it('17. applyPlayMove places tile and transitions turn', () => {
    const handDeal = {
      player_tiles: [dummyTile(5, 6), dummyTile(1, 1)],
      fritz_tiles: [dummyTile(2, 2)],
      boneyard: [],
      locked: [],
    };
    const state = createFixedBotMatch(handDeal, 60, 7);
    state.board = {
      leftEnd: 5,
      rightEnd: 2,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      mainLine: [{ tile: dummyTile(5, 2), orientation: 'horizontal-normal' }], // normal exposes 5 on left
      hubDoubles: [],
    };
    state.handOpen = true;
    const move: Move = { type: 'play', tile: dummyTile(5, 6), position: 'left' };
    const res = applyPlayMove(state, 'you', move);
    expect(res.state.currentPlayer).toBe('bot');
    expect(res.state.players.you.hand.length).toBe(1);
    expect(res.state.board!.leftEnd).toBe(6);
  });

  it('18. drawOne draws tile from boneyard', () => {
    const handDeal = {
      player_tiles: [dummyTile(1, 2)],
      fritz_tiles: [],
      boneyard: [dummyTile(5, 5), dummyTile(6, 6), dummyTile(0, 0)],
      locked: [],
    };
    const state = createFixedBotMatch(handDeal, 60, 7);
    const res = drawOne(state, 'you');
    expect(res.drew).toBeDefined();
    expect(res.drew!.player).toBe('you');
    expect(res.drew!.tile).toEqual(dummyTile(5, 5));
    expect(res.state.players.you.hand.length).toBe(2);
    expect(res.state.boneyard.length).toBe(2);
  });

  it('19. passTurn changes current player and handles consecutive passes', () => {
    const handDeal = {
      player_tiles: [dummyTile(1, 2)],
      fritz_tiles: [],
      boneyard: [],
      locked: [],
    };
    const state = createFixedBotMatch(handDeal, 60, 7);
    state.board = {
      leftEnd: 5,
      rightEnd: 5,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      mainLine: [{ tile: dummyTile(5, 5), orientation: 'vertical-normal' as const }],
      hubDoubles: [],
    };
    state.handOpen = true;
    const res = passTurn(state, 'you');
    expect(res.passed).toBeDefined();
    expect(res.passed!.player).toBe('you');
    expect(res.state.currentPlayer).toBe('bot');
    expect(res.state.consecutivePasses).toBe(1);
  });

  it('20. passTurn ends hand when consecutive passes reaches 2', () => {
    const handDeal = {
      player_tiles: [dummyTile(1, 2)],
      fritz_tiles: [],
      boneyard: [],
      locked: [],
    };
    const state = createFixedBotMatch(handDeal, 60, 7);
    state.consecutivePasses = 1;
    state.board = {
      leftEnd: 5,
      rightEnd: 5,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      mainLine: [{ tile: dummyTile(5, 5), orientation: 'vertical-normal' as const }],
      hubDoubles: [],
    };
    state.handOpen = true;
    const res = passTurn(state, 'you');
    expect(res.handEnded).toBeDefined();
    expect(res.handEnded!.reason).toBe('blocked');
    expect(res.state.handOver).toBe(true);
  });

  function tEquals(a: Tile, b: Tile) {
    return (a.low === b.low && a.high === b.high) || (a.low === b.high && a.high === b.low);
  }
});
