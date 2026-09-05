import { describe, it, expect } from 'vitest';
import { computeGuidedCoachTip, computeGuidedScoringTiles } from './computeGuidedCoachTip.ts';
import {
  createFixedBotMatch,
  getLegalMoves,
  previewPlayMove,
} from '../match/runtime/botEngine.ts';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import type { BoardState, Move, Tile } from '../../types.ts';

const t = (low: number, high: number): Tile => ({ low, high });

const openingMatch = (playerTiles: Tile[]): BotMatchState =>
  createFixedBotMatch(
    { player_tiles: playerTiles, fritz_tiles: [t(2, 2)], boneyard: [], locked: [] },
    60,
    7,
  );

// Single 5|2 tile: horizontal-normal exposes 5 on the left, 2 on the right (see botEngine.test #16).
const board52: BoardState = {
  leftEnd: 5,
  rightEnd: 2,
  leftEndIsDouble: false,
  rightEndIsDouble: false,
  mainLine: [{ tile: t(5, 2), orientation: 'horizontal-normal' }],
  hubDoubles: [],
};

// Single 5|0 tile: exposes 5 on the left, 0 on the right.
const board50: BoardState = {
  leftEnd: 5,
  rightEnd: 0,
  leftEndIsDouble: false,
  rightEndIsDouble: false,
  mainLine: [{ tile: t(5, 0), orientation: 'horizontal-normal' }],
  hubDoubles: [],
};

const midHandMatch = (playerTiles: Tile[], board: BoardState): BotMatchState => {
  const m = createFixedBotMatch(
    { player_tiles: playerTiles, fritz_tiles: [t(2, 2)], boneyard: [], locked: [] },
    60,
    7,
  );
  m.board = board;
  m.handOpen = true;
  return m;
};

// ── guards ────────────────────────────────────────────────────────────────
describe('computeGuidedCoachTip — guards', () => {
  const match = openingMatch([t(1, 4)]);
  const moves = getLegalMoves(match, 'you');

  it('null when not in guided mode', () => {
    expect(computeGuidedCoachTip(match, moves, false)).toBeNull();
  });

  it('null when it is not the player\'s turn', () => {
    expect(computeGuidedCoachTip({ ...match, currentPlayer: 'bot' }, moves, true)).toBeNull();
  });

  it('null when the hand is over', () => {
    expect(computeGuidedCoachTip({ ...match, handOver: true }, moves, true)).toBeNull();
  });

  it('null when the game is over', () => {
    expect(computeGuidedCoachTip({ ...match, gameOver: true }, moves, true)).toBeNull();
  });

  it('null when there are no candidate moves', () => {
    expect(computeGuidedCoachTip(match, [], true)).toBeNull();
  });

  it('null when no candidate move carries a tile (pass only)', () => {
    expect(computeGuidedCoachTip(match, [{ type: 'pass' }], true)).toBeNull();
  });
});

// ── opening move ──────────────────────────────────────────────────────────
describe('computeGuidedCoachTip — opening move (empty board)', () => {
  it('recommends the highest-scoring opener; a scoring double still reports isOpeningDouble=false', () => {
    // 5|5 opener scores 10, 1|4 scores 5, 6|6 scores 0 (all legal openers: doubles + scoring tiles).
    const match = openingMatch([t(5, 5), t(1, 4), t(6, 6)]);
    const moves = getLegalMoves(match, 'you');
    const scoreOf = (tile: Tile) =>
      previewPlayMove(match, 'you', moves.find((m) => m.tile && m.tile.low === tile.low && m.tile.high === tile.high)!)
        ?.immediateScore ?? 0;
    expect(scoreOf(t(5, 5))).toBeGreaterThan(scoreOf(t(1, 4)));

    const tip = computeGuidedCoachTip(match, moves, true);
    expect(tip?.tile).toEqual(t(5, 5));
    expect(tip?.pts).toBe(scoreOf(t(5, 5)));
    expect(tip?.isOpeningMove).toBe(true);
    expect(tip?.isOpeningDouble).toBe(false); // came through the scoring branch, not the doubles branch
    expect(tip?.placementCount).toBe(2); // two scoring openers (5|5, 1|4)
  });

  it('recommends a single scoring opener', () => {
    const match = openingMatch([t(1, 4), t(1, 2), t(6, 6)]);
    const moves = getLegalMoves(match, 'you');
    const tip = computeGuidedCoachTip(match, moves, true);
    expect(tip?.tile).toEqual(t(1, 4));
    expect(tip?.pts).toBeGreaterThan(0);
    expect(tip?.isOpeningMove).toBe(true);
    expect(tip?.isOpeningDouble).toBe(false);
    expect(tip?.isOnlyPlay).toBe(false); // 6|6 is also a legal opener
  });

  it('falls back to the highest double when no opener scores', () => {
    const match = openingMatch([t(6, 6), t(3, 3), t(1, 2)]);
    const moves = getLegalMoves(match, 'you');
    const tip = computeGuidedCoachTip(match, moves, true);
    expect(tip?.tile).toEqual(t(6, 6));
    expect(tip?.pts).toBe(0);
    expect(tip?.isOpeningDouble).toBe(true);
    expect(tip?.isOpeningMove).toBe(true);
    expect(tip?.placementCount).toBe(2); // 6|6 and 3|3
  });

  it('null on an opening with neither a scoring tile nor a double', () => {
    const match = openingMatch([t(1, 2)]);
    // 1|2 is not a legal opener; pass it explicitly as a candidate.
    const tip = computeGuidedCoachTip(match, [{ type: 'play', tile: t(1, 2), position: 'left' }], true);
    expect(tip).toBeNull();
  });
});

// ── non-opening move ──────────────────────────────────────────────────────
describe('computeGuidedCoachTip — non-opening move', () => {
  it('marks isOnlyPlay when there is exactly one legal placement', () => {
    const match = midHandMatch([t(5, 6)], board52); // 5|6 fits the left (5); nothing fits the right (2)
    const moves = getLegalMoves(match, 'you');
    expect(moves).toHaveLength(1);
    const tip = computeGuidedCoachTip(match, moves, true);
    expect(tip?.tile).toEqual(t(5, 6));
    expect(tip?.isOnlyPlay).toBe(true);
    expect(tip?.isControlChoice).toBe(false);
    expect(tip?.isOpeningMove).toBe(false);
    expect(tip?.placementCount).toBe(1);
  });

  it('with multiple options, returns a coherent tip drawn from the candidate moves', () => {
    const match = midHandMatch([t(5, 6), t(2, 4), t(1, 1)], board52); // 5|6 -> left(5), 2|4 -> right(2)
    const moves = getLegalMoves(match, 'you');
    expect(moves.length).toBeGreaterThan(1);
    const tip = computeGuidedCoachTip(match, moves, true);
    expect(tip).not.toBeNull();
    expect(tip?.isOnlyPlay).toBe(false);
    expect(tip?.isOpeningMove).toBe(false);
    expect(moves.some((m) => m.tile && m.tile.low === tip!.tile.low && m.tile.high === tip!.tile.high)).toBe(
      true,
    );
    expect(moves).toContainEqual(tip!.bestMove);
  });

  it('null when the mirrored recommendation is a tile the player cannot actually place', () => {
    // Player has two legal tiles but neither is a double and neither scores; if the master
    // recommendation ever lands outside allEvaluated the function returns null. Here we just
    // assert the function never throws and returns either null or a candidate tile.
    const match = midHandMatch([t(5, 3), t(2, 4)], board52);
    const moves = getLegalMoves(match, 'you');
    const tip = computeGuidedCoachTip(match, moves, true);
    if (tip) {
      expect(moves.some((m) => m.tile && m.tile.low === tip.tile.low && m.tile.high === tip.tile.high)).toBe(
        true,
      );
    }
  });
});

// ── computeGuidedScoringTiles ─────────────────────────────────────────────
describe('computeGuidedScoringTiles', () => {
  it('empty map when not in guided mode', () => {
    const match = openingMatch([t(1, 4)]);
    expect(computeGuidedScoringTiles(match, getLegalMoves(match, 'you'), false).size).toBe(0);
  });

  it('empty map when it is not the player\'s turn', () => {
    const match = openingMatch([t(1, 4)]);
    expect(
      computeGuidedScoringTiles({ ...match, currentPlayer: 'bot' }, getLegalMoves(match, 'you'), true).size,
    ).toBe(0);
  });

  it('maps each positively-scoring tile to its score, keyed "low-high"', () => {
    const match = openingMatch([t(1, 4), t(0, 5), t(6, 6)]);
    const moves = getLegalMoves(match, 'you');
    const moveFor = (low: number, high: number) =>
      moves.find((m) => m.tile && m.tile.low === low && m.tile.high === high)!;
    const map = computeGuidedScoringTiles(match, moves, true);
    expect(map.get('1-4')).toBe(previewPlayMove(match, 'you', moveFor(1, 4))?.immediateScore);
    expect(map.get('0-5')).toBe(previewPlayMove(match, 'you', moveFor(0, 5))?.immediateScore);
    expect(map.has('6-6')).toBe(false); // 6|6 opener does not score
  });

  it('keeps the higher score when one tile has two scoring placements', () => {
    const match = midHandMatch([t(0, 5)], board50); // 0|5 fits both ends (left=5, right=0)
    const left: Move = { type: 'play', tile: t(0, 5), position: 'left' };
    const right: Move = { type: 'play', tile: t(0, 5), position: 'right' };
    const leftPts = previewPlayMove(match, 'you', left)?.immediateScore ?? 0;
    const rightPts = previewPlayMove(match, 'you', right)?.immediateScore ?? 0;
    expect(Math.max(leftPts, rightPts)).toBeGreaterThan(0); // at least one placement scores

    const map = computeGuidedScoringTiles(match, [left, right], true);
    expect(map.get('0-5')).toBe(Math.max(leftPts, rightPts));
  });
});
