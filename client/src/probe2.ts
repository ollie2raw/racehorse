import type { BoardState, Tile } from './types.ts';
import type { BotMatchState } from './bot/botEngine.ts';
import { buildMoveEvaluationResult } from './learning/moveAnalysis.ts';
import { DEFAULT_THRESHOLD_CONFIG } from './learning/types.ts';

function mkBoard(left: number, right: number): BoardState {
  return { mainLine: [{ tile: { low: Math.min(left,right), high: Math.max(left,right) }, orientation: 'horizontal-normal' }], leftEnd: left, rightEnd: right, leftEndIsDouble: left===right, rightEndIsDouble: left===right, hubDoubles: [] };
}
function mkState(L: number, R: number, youHand: Tile[], botHand: Tile[]): BotMatchState {
  return { players:{you:{hand:youHand,score:0},bot:{hand:botHand,score:0}}, board:mkBoard(L,R), boneyard:[], deadTiles:[], handOpen:true, currentPlayer:'you', consecutivePasses:0, handNumber:1, turnIndex:2, handOver:false, gameOver:false, winnerId:null, winningScore:60, lastHandWinner:null, lastHandReason:null, dealSize:7, opponentPassedOnEnds:[], opponentDrawCount:0, opponentKnownMissing:[], opponentMissingEvidence:[] };
}

const bot = [{ low:0, high:2 },{ low:5, high:6 },{ low:3, high:4 }];

const cases = [
  { label:'B1|2 [1|3]L vs [2|4]R (both→5)', L:1, R:2, h:[{low:1,high:3},{low:2,high:4},{low:0,high:0}] },
  { label:'B1|4 [1|6]L(→10) vs [4|6]R(→7) vs [4|1]R(→5)', L:1, R:4, h:[{low:1,high:6},{low:4,high:6},{low:1,high:4}] },
  { label:'B2|1 [2|3]L(→4) vs [1|4]R(→6) vs [1|3]R(→5)', L:2, R:1, h:[{low:2,high:3},{low:1,high:4},{low:1,high:3}] },
  { label:'B3|2 [3|3]L(→5) vs [2|2]R(→5) vs [2|4]L(→6)', L:3, R:2, h:[{low:3,high:3},{low:2,high:2},{low:2,high:4}] },
  { label:'B4|1 [4|1]L(→2) vs [1|6]R(→10) vs [4|6]L(→7) vs [1|4]R(→5)', L:4, R:1, h:[{low:4,high:1},{low:1,high:6},{low:4,high:6}] },
  { label:'B1|6 [1|4]L(→10) vs [6|4]R(→5)', L:1, R:6, h:[{low:1,high:4},{low:4,high:6},{low:0,high:1}] },
  { label:'B2|6 [2|2]L(→8) vs [6|3]R(→5)', L:2, R:6, h:[{low:2,high:2},{low:3,high:6},{low:0,high:2}] },
];

for (const c of cases) {
  const st = mkState(c.L, c.R, c.h, bot);
  const r = buildMoveEvaluationResult({ state:st, playerMove:undefined, thresholds:DEFAULT_THRESHOLD_CONFIG, playerLevel:'intermediate' });
  console.log(`\n${c.label}`);
  console.log(`  conf=${r.engineConfidence.toFixed(3)} ambig=${r.isAmbiguousPosition} neither=${r.neitherScores}`);
  for (const m of r.rankedMoves.slice(0,4)) {
    console.log(`  #${m.rank} ${m.moveNotation.padEnd(18)} s=${m.engineScore.toFixed(1).padStart(7)} Δ=${m.scoreDeltaFromBest.toFixed(1).padStart(5)} pts=${m.immediatePoints} [${m.category}]`);
  }
}
