import { analyzeMoveLog, type AnalyzedMove } from './moveAnalyzer.ts';
import { buildConsequenceChain } from './consequenceChain.ts';
import { segmentMoveLogByHand } from './handSegmentation.ts';
import { normalizeBoardRenderState, sameTileTuple } from './moveLogger.ts';
import type { MoveEntry } from './moveLogger.ts';
import { isRenderableNonNullBoard } from '../multiplayer/boardSnapshotGuards.ts';
import type { BoardState } from '../types.ts';

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`[analyzer.behaviorTests] ${msg}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`[analyzer.behaviorTests] ${msg}`);
}

function entry(partial: Partial<MoveEntry> & Pick<MoveEntry, 'moveNumber' | 'player'>): MoveEntry {
  return {
    action: 'place',
    boardEnds: [3, 2],
    handBefore: [],
    validMoves: [],
    pipDelta: 0,
    pointsScored: 0,
    boardState: [],
    boardRenderState: { mainLine: [], leftEnd: -1, rightEnd: -1, leftEndIsDouble: false, rightEndIsDouble: false, hubDoubles: [] },
    handSnapshot: [],
    engineBestMove: null,
    ...partial,
  };
}

function testSegmentByHandNumber() {
  const moves: MoveEntry[] = [
    entry({ moveNumber: 1, player: 'you', handNumber: 1, pointsScored: 10 }),
    entry({ moveNumber: 2, player: 'opponent', handNumber: 1, pointsScored: 5 }),
    entry({ moveNumber: 3, player: 'you', handNumber: 2, pointsScored: 15 }),
  ];
  const segments = segmentMoveLogByHand(moves);
  assertEqual(segments.length, 2, 'hand count');
  assertEqual(segments[0]!.entries.length, 2, 'hand 1 moves');
  assertEqual(segments[1]!.entries.length, 1, 'hand 2 moves');
}

function testConsequenceChainOpponentExploit() {
  const handEntries: MoveEntry[] = [
    entry({
      moveNumber: 1,
      player: 'you',
      tile: [3, 2],
      boardEnds: [3, 2],
      pointsScored: 0,
    }),
    entry({
      moveNumber: 2,
      player: 'opponent',
      pointsScored: 10,
    }),
  ];

  const chain = buildConsequenceChain(
    handEntries[0]!,
    {
      moveNumber: 1,
      action: 'place',
      playedTile: [3, 2],
      bestTile: [5, 0],
      score: 38,
      rating: 'Mistake',
      explanation: 'test',
      handBefore: [],
      validMoves: [],
      boardEnds: [3, 2],
      boardState: [],
      boardRenderState: null,
      handSnapshot: [],
      engineBestMove: null,
    },
    handEntries,
    'Fritz',
  );

  assert(chain != null, 'chain exists');
  assertEqual(chain!.opponentExploited, true, 'opponent exploited');
  assertEqual(chain!.opponentScore, 10, 'opponent score');
}

function testNormalizeBoardRenderStateForHubArms() {
  const raw = {
    mainLine: [
      {
        tile: { low: 3, high: 3 },
        orientation: 'vertical-normal' as const,
      },
      {
        tile: { low: 3, high: 2 },
        orientation: 'horizontal-normal' as const,
      },
    ],
    leftEnd: 3,
    rightEnd: 2,
    leftEndIsDouble: true,
    rightEndIsDouble: false,
    hubDoubles: [
      {
        hubId: 1,
        tileIndex: 0,
        hubValue: 3,
        isCrossed: false,
        branches: [],
      },
    ],
  };

  const normalized = normalizeBoardRenderState(raw as never);
  assert(normalized != null, 'normalized board exists');
  assert(isRenderableNonNullBoard(normalized!), 'normalized board passes render guard');
  assert(normalized!.mainLine.length === 2, 'main line preserved');
}

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

function testMoveTwoSixSixNotBlunderWhenThreeFourIllegal() {
  const preMoveBoard = mkBoard(6, 4);
  const validMoves: Array<[number, number]> = [
    [6, 6],
    [4, 2],
  ];
  const handBefore: Array<[number, number]> = [
    [6, 6],
    [4, 2],
    [1, 0],
  ];

  const log: MoveEntry[] = [
    entry({
      moveNumber: 1,
      player: 'opponent',
      tile: [6, 4],
      boardEnds: [6, 4],
      boardRenderState: preMoveBoard,
    }),
    entry({
      moveNumber: 2,
      player: 'you',
      tile: [6, 6],
      boardEnds: [6, 4],
      handBefore,
      validMoves,
      boardRenderState: preMoveBoard,
      engineBestMove: {
        tile: [6, 6],
        position: 'left',
        score: 120,
        breakdown: {
          immediate: 0,
          doubleBias: 0,
          mobility: 2,
          denial: 0,
          unload: 12,
          replyRisk: 2,
        },
      },
    }),
  ];

  const analysis = analyzeMoveLog(log, true, { oracleMode: 'tier', tierPlayed: 'standard' });
  const move = analysis.analyzedMoves.find((item) => item.moveNumber === 2);
  assert(Boolean(move), 'move 2 analyzed');
  assert(
    move!.rating !== 'Blunder' && move!.rating !== 'Mistake',
    `move 2 should not be blunder/mistake, got ${move!.rating}`,
  );
  assert(
    Boolean(move!.bestTile) && validMoves.some((tile) => sameTileTuple(tile, move!.bestTile)),
    'bestTile must be in validMoves',
  );
  assert(
    !validMoves.some((tile) => sameTileTuple(tile, [3, 4])),
    'fixture: 3-4 must not be in validMoves',
  );
}

function testForcedSingleLegalMoveRatedGood() {
  const board = mkBoard(3, 2);
  const only: [number, number] = [3, 1];
  const analysis = analyzeMoveLog(
    [
      entry({
        moveNumber: 1,
        player: 'you',
        tile: only,
        boardEnds: [3, 2],
        handBefore: [only],
        validMoves: [only],
        boardRenderState: board,
        engineBestMove: {
          tile: only,
          position: 'left',
          score: 50,
        },
      }),
    ],
    false,
  );
  const move = analysis.analyzedMoves[0]!;
  assertEqual(move.rating, 'Good', 'forced move rating');
  assertEqual(move.explanation, 'Only legal move available.', 'forced move explanation');
}

function testPointsLeftOnTableZeroWhenBestEqualsPlayed() {
  const tile: [number, number] = [3, 2];
  const boardEnds: [number, number] = [3, 2];
  const handEntries: MoveEntry[] = [
    entry({
      moveNumber: 1,
      player: 'you',
      tile,
      boardEnds,
      pointsScored: 0,
    }),
  ];
  const analyzedMove: AnalyzedMove = {
    moveNumber: 1,
    action: 'place',
    playedTile: tile,
    bestTile: tile,
    score: 80,
    rating: 'Good',
    explanation: 'test',
    handBefore: [tile],
    validMoves: [tile, [5, 5]],
    boardEnds,
    boardState: [],
    boardRenderState: null,
    handSnapshot: [tile],
    engineBestMove: { tile, score: 80 },
  };
  const chain = buildConsequenceChain(handEntries[0]!, analyzedMove, handEntries, 'Fritz');
  assert(chain != null, 'chain exists');
  assertEqual(chain!.pointsLeftOnTable, 0, 'pointsLeftOnTable when best equals played');
}

function run() {
  testSegmentByHandNumber();
  testConsequenceChainOpponentExploit();
  testNormalizeBoardRenderStateForHubArms();
  testMoveTwoSixSixNotBlunderWhenThreeFourIllegal();
  testForcedSingleLegalMoveRatedGood();
  testPointsLeftOnTableZeroWhenBestEqualsPlayed();
  console.log('analyzer behavior tests passed');
}

run();
