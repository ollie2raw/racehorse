import type { PlayStatus } from './dailyPuzzleScreenTypes';

export type OneTurnHighScoreMoveOutcome =
  | { type: 'continue'; runningScore: number }
  | { type: 'terminal'; status: Extract<PlayStatus, 'SOLVED'>; runningScore: number };

export function isDominoDouble(tile: { low: number; high: number }): boolean {
  return tile.low === tile.high;
}

export function evaluateOneTurnHighScoreMoveOutcome(params: {
  pointsAwarded: number;
  isDouble: boolean;
  priorRunningScore: number;
  upcomingPlayMovesCount: number;
}): OneTurnHighScoreMoveOutcome {
  const newRunningScore = params.priorRunningScore + params.pointsAwarded;
  if (
    (params.pointsAwarded === 0 && !params.isDouble)
    || params.upcomingPlayMovesCount === 0
  ) {
    return { type: 'terminal', status: 'SOLVED', runningScore: newRunningScore };
  }
  return { type: 'continue', runningScore: newRunningScore };
}

export type TargetScoreMoveOutcome =
  | { type: 'continue' }
  | {
      type: 'terminal';
      status: Extract<PlayStatus, 'SOLVED' | 'FAILED'>;
      totalScore: number;
      nextMoves: number;
    };

export function evaluateTargetScoreMoveOutcome(params: {
  totalScore: number;
  nextMoves: number;
  targetScore: number;
  maxMoves: number;
  currentPlayer: string;
  upcomingPlayMovesCount: number;
}): TargetScoreMoveOutcome {
  if (params.totalScore >= params.targetScore && params.nextMoves <= params.maxMoves) {
    return {
      type: 'terminal',
      status: 'SOLVED',
      totalScore: params.totalScore,
      nextMoves: params.nextMoves,
    };
  }
  if (params.nextMoves >= params.maxMoves && params.totalScore < params.targetScore) {
    return {
      type: 'terminal',
      status: 'FAILED',
      totalScore: params.totalScore,
      nextMoves: params.nextMoves,
    };
  }
  if (params.currentPlayer !== 'you') {
    return {
      type: 'terminal',
      status: 'FAILED',
      totalScore: params.totalScore,
      nextMoves: params.nextMoves,
    };
  }
  if (params.upcomingPlayMovesCount === 0) {
    return {
      type: 'terminal',
      status: 'FAILED',
      totalScore: params.totalScore,
      nextMoves: params.nextMoves,
    };
  }
  return { type: 'continue' };
}

export function shouldAutoFailOneTurnHighScoreWithNoLegalMoves(legalMovesCount: number): boolean {
  return legalMovesCount === 0;
}