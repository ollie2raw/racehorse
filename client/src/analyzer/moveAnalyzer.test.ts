// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  analyzeMoveLog,
  analyzeMoveLogDeferred,
  loadGameAnalysisHistory,
  saveGameAnalysis,
  enrichMovesWithFritz,
} from './moveAnalyzer';
import type { MoveEntry } from '../game/moveLogger';
import type { BoardState } from '../types';

const HISTORY_KEY = 'racehorse_move_analysis_history_v1';

describe('moveAnalyzer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockBoardState = (low: number, high: number): BoardState => ({
    leftEnd: low,
    rightEnd: high,
    leftEndIsDouble: false,
    rightEndIsDouble: false,
    mainLine: [
      { tile: { low, high }, orientation: 'horizontal-normal' },
    ],
    hubDoubles: [],
  });

  const createPlaceEntry = (args: {
    moveNumber: number;
    playedTile: [number, number];
    handBefore: [number, number][];
    boardEnds: [number, number];
    boardRenderState: BoardState;
  }): MoveEntry => ({
    moveNumber: args.moveNumber,
    player: 'you',
    action: 'place',
    tile: args.playedTile,
    position: 'left',
    handBefore: args.handBefore,
    validMoves: args.handBefore,
    boardEnds: args.boardEnds,
    boardState: args.boardRenderState as any,
    boardRenderState: args.boardRenderState as any,
    handSnapshot: args.handBefore,
    engineBestMove: {
      tile: args.playedTile,
      position: 'left',
      score: 100,
      breakdown: {
        immediate: 10,
        replyRisk: 0,
        mobility: 5,
        denial: 0,
        unload: 10,
        doubleBias: 0,
      },
    },
  } as any);

  it('1. returns grade D and low accuracy for empty or poor move entries', () => {
    const analysis = analyzeMoveLog([]);
    expect(analysis.accuracy).toBe(0);
    expect(analysis.grade).toBe('D');
    expect(analysis.hands).toEqual([]);
    expect(analysis.evidence).toEqual({
      source: 'heuristic',
      confidence: 'low',
      displayLabel: 'Legacy heuristic estimate',
      reason: 'incomplete-v1-position-snapshot',
    });
  });

  it('2. correctly classifies single legal option as Good', () => {
    const board = mockBoardState(5, 5);
    const entry = createPlaceEntry({
      moveNumber: 1,
      playedTile: [5, 5],
      handBefore: [[5, 5]],
      boardEnds: [5, 5],
      boardRenderState: board,
    });
    const analysis = analyzeMoveLog([entry]);
    expect(analysis.accuracy).toBeGreaterThan(0);
    expect(analysis.analyzedMoves.length).toBe(1);
    expect(analysis.analyzedMoves[0].rating).toBe('Good');
  });

  it('3. identifies brilliant moves when matching fritz reference choice', () => {
    const board = mockBoardState(5, 5);
    const entry = createPlaceEntry({
      moveNumber: 1,
      playedTile: [5, 5],
      handBefore: [[5, 5], [1, 2]],
      boardEnds: [5, 5],
      boardRenderState: board,
    });
    const analysis = analyzeMoveLog([entry]);
    expect(analysis.analyzedMoves[0].rating).toBe('Brilliant');
  });

  it('4. identifies forced draws/passes as Good', () => {
     const board = mockBoardState(5, 5);
     const entry: any = {
       moveNumber: 1,
       player: 'you',
       action: 'draw',
       handBefore: [[1, 2]],
       validMoves: [], // no legal moves
       boardEnds: [5, 5],
       boardState: board as any,
       boardRenderState: board as any,
       handSnapshot: [[1, 2]],
     };
     const analysis = analyzeMoveLog([entry]);
     expect(analysis.analyzedMoves[0].rating).toBe('Good');
     expect(analysis.analyzedMoves[0].score).toBe(84);
   });

   it('5. classifies passing when plays are available as Blunder', () => {
     const board = mockBoardState(5, 5);
     const entry: any = {
       moveNumber: 1,
       player: 'you',
       action: 'pass',
       handBefore: [[5, 5]],
       validMoves: [[5, 5]],
       boardEnds: [5, 5],
       boardState: board as any,
       boardRenderState: board as any,
       handSnapshot: [[5, 5]],
     };
     const analysis = analyzeMoveLog([entry]);
     expect(analysis.analyzedMoves[0].rating).toBe('Blunder');
     expect(analysis.analyzedMoves[0].score).toBe(12);
   });

   it('6. classifies drawing/passing action when plays are available as Inaccuracy', () => {
     const board = mockBoardState(5, 5);
     const entry: any = {
       moveNumber: 1,
       player: 'you',
       action: 'draw',
       handBefore: [[5, 5]],
       validMoves: [[5, 5]],
       boardEnds: [5, 5],
       boardState: board as any,
       boardRenderState: board as any,
       handSnapshot: [[5, 5]],
     };
     const analysis = analyzeMoveLog([entry]);
     expect(analysis.analyzedMoves[0].rating).toBe('Inaccuracy');
     expect(analysis.analyzedMoves[0].score).toBe(46);
   });

  it('7. grades S class for high accuracy game log', () => {
    const board = mockBoardState(5, 5);
    const entry = createPlaceEntry({
      moveNumber: 1,
      playedTile: [5, 5],
      handBefore: [[5, 5]],
      boardEnds: [5, 5],
      boardRenderState: board,
    });
    const analysis = analyzeMoveLog([entry]);
    expect(analysis.accuracy).toBeGreaterThanOrEqual(80);
  });

  it('8. grades A, B, C, D appropriately depending on accuracy thresholds', () => {
    const board = mockBoardState(5, 5);
    const entry = createPlaceEntry({
      moveNumber: 1,
      playedTile: [5, 5],
      handBefore: [[5, 5]],
      boardEnds: [5, 5],
      boardRenderState: board,
    });
    const analysis = analyzeMoveLog([entry]);
    expect(analysis.timeline.length).toBe(1);
    expect(analysis.timeline[0].score).toBe(80);
  });

  it('9. calculates worst hand number correctly', () => {
    const board = mockBoardState(5, 5);
    const entry = createPlaceEntry({
      moveNumber: 1,
      playedTile: [5, 5],
      handBefore: [[5, 5]],
      boardEnds: [5, 5],
      boardRenderState: board,
    });
    const analysis = analyzeMoveLog([entry]);
    expect(analysis.worstHandNumber).toBe(1);
  });

  it('10. enriches moves with fritz evaluations', () => {
    const board = mockBoardState(5, 5);
    const entry = createPlaceEntry({
      moveNumber: 1,
      playedTile: [5, 5],
      handBefore: [[5, 5]],
      boardEnds: [5, 5],
      boardRenderState: board,
    });
    delete (entry as any).engineBestMove;
    const enriched = enrichMovesWithFritz([entry]);
    expect(enriched[0].engineBestMove).toBeDefined();
  });

  it('11. ignores fritz enrichment if move already has best move', () => {
    const board = mockBoardState(5, 5);
    const entry = createPlaceEntry({
      moveNumber: 1,
      playedTile: [5, 5],
      handBefore: [[5, 5]],
      boardEnds: [5, 5],
      boardRenderState: board,
    });
    const dummyBest = { tile: [5, 5] as [number, number], position: 'left' as const, score: 99, breakdown: {} as any };
    entry.engineBestMove = dummyBest;
    const enriched = enrichMovesWithFritz([entry]);
    expect(enriched[0].engineBestMove).toEqual(dummyBest);
  });

  it('12. ignores fritz enrichment if player is fritz/bot', () => {
    const board = mockBoardState(5, 5);
    const entry = createPlaceEntry({
      moveNumber: 1,
      playedTile: [5, 5],
      handBefore: [[5, 5]],
      boardEnds: [5, 5],
      boardRenderState: board,
    });
    delete (entry as any).engineBestMove;
    entry.player = 'opponent';
    const enriched = enrichMovesWithFritz([entry]);
    expect(enriched[0].engineBestMove).toBeUndefined();
  });

  it('13. performs deferred analysis via analyzeMoveLogDeferred', async () => {
    const board = mockBoardState(5, 5);
    const entry = createPlaceEntry({
      moveNumber: 1,
      playedTile: [5, 5],
      handBefore: [[5, 5]],
      boardEnds: [5, 5],
      boardRenderState: board,
    });
    const analysis = await analyzeMoveLogDeferred([entry]);
    expect(analysis.accuracy).toBeGreaterThan(0);
  });

  it('14. loadGameAnalysisHistory returns empty array when localstorage is missing/throws', () => {
    const spy = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('Storage missing');
    });
    expect(loadGameAnalysisHistory()).toEqual([]);
    spy.mockRestore();
  });

  it('15. saves game analysis and retrieves it successfully from localstorage', () => {
    const board = mockBoardState(5, 5);
    const entry = createPlaceEntry({
      moveNumber: 1,
      playedTile: [5, 5],
      handBefore: [[5, 5]],
      boardEnds: [5, 5],
      boardRenderState: board,
    });
    const analysis = analyzeMoveLog([entry]);
    const history = saveGameAnalysis('bot', analysis);
    expect(history.length).toBe(1);
    expect(history[0].analysis.accuracy).toBe(analysis.accuracy);

    const loaded = loadGameAnalysisHistory();
    expect(loaded.length).toBe(1);
    expect(loaded[0].analysis.accuracy).toBe(analysis.accuracy);
  });

  it('16. handles invalid json in game history load gracefully', () => {
    window.localStorage.setItem(HISTORY_KEY, 'invalid-json');
    expect(loadGameAnalysisHistory()).toEqual([]);
  });

  it('17. ignores fritz enrichment if boardRenderState is null', () => {
    const board = mockBoardState(5, 5);
    const entry = createPlaceEntry({
      moveNumber: 1,
      playedTile: [5, 5],
      handBefore: [[5, 5]],
      boardEnds: [5, 5],
      boardRenderState: board,
    });
    delete (entry as any).engineBestMove;
    (entry as any).boardRenderState = null;
    const enriched = enrichMovesWithFritz([entry]);
    expect(enriched[0].engineBestMove).toBeUndefined();
  });

  it('18. handles multiple hands segmentation during analysis', () => {
    const board = mockBoardState(5, 5);
    const entry1 = createPlaceEntry({
      moveNumber: 1,
      playedTile: [5, 5],
      handBefore: [[5, 5]],
      boardEnds: [5, 5],
      boardRenderState: board,
    });
    const entry2 = createPlaceEntry({
      moveNumber: 2,
      playedTile: [5, 5],
      handBefore: [[5, 5]],
      boardEnds: [5, 5],
      boardRenderState: board,
    });
    entry2.action = 'pass';
    const analysis = analyzeMoveLog([entry1, entry2]);
    expect(analysis.hands.length).toBeGreaterThanOrEqual(1);
  });

  it('19. ignores non-array history lists', () => {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify({ notAnArray: true }));
    expect(loadGameAnalysisHistory()).toEqual([]);
  });

  it('20. limits stored analyses to max size (40)', () => {
    const board = mockBoardState(5, 5);
    const entry = createPlaceEntry({
      moveNumber: 1,
      playedTile: [5, 5],
      handBefore: [[5, 5]],
      boardEnds: [5, 5],
      boardRenderState: board,
    });
    const analysis = analyzeMoveLog([entry]);
    // clear prior history first
    window.localStorage.setItem(HISTORY_KEY, '[]');
    for (let i = 0; i < 45; i++) {
      saveGameAnalysis('bot', analysis);
    }
    const history = loadGameAnalysisHistory();
    expect(history.length).toBeLessThanOrEqual(40);
  });
});
