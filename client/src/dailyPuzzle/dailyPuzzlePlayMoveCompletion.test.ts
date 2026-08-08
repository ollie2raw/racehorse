import { describe, expect, it } from 'vitest';
import {
  evaluateOneTurnHighScoreMoveOutcome,
  evaluateTargetScoreMoveOutcome,
  isDominoDouble,
  shouldAutoFailOneTurnHighScoreWithNoLegalMoves,
} from './dailyPuzzlePlayMoveCompletion';

describe('evaluateOneTurnHighScoreMoveOutcome', () => {
  it('continues when points scored and moves remain', () => {
    expect(
      evaluateOneTurnHighScoreMoveOutcome({
        pointsAwarded: 5,
        isDouble: false,
        priorRunningScore: 10,
        nextCurrentPlayer: 'you',
        upcomingPlayMovesCount: 2,
      }),
    ).toEqual({ type: 'continue', runningScore: 15 });
  });

  it('completes when no upcoming play moves', () => {
    expect(
      evaluateOneTurnHighScoreMoveOutcome({
        pointsAwarded: 3,
        isDouble: false,
        priorRunningScore: 0,
        nextCurrentPlayer: 'you',
        upcomingPlayMovesCount: 0,
      }),
    ).toEqual({ type: 'terminal', status: 'SOLVED', runningScore: 3 });
  });

  it('completes on zero points when tile is not a double', () => {
    expect(
      evaluateOneTurnHighScoreMoveOutcome({
        pointsAwarded: 0,
        isDouble: false,
        priorRunningScore: 4,
        nextCurrentPlayer: 'you',
        upcomingPlayMovesCount: 1,
      }),
    ).toEqual({ type: 'terminal', status: 'SOLVED', runningScore: 4 });
  });

  it('continues on zero points when tile is a double', () => {
    expect(
      evaluateOneTurnHighScoreMoveOutcome({
        pointsAwarded: 0,
        isDouble: true,
        priorRunningScore: 4,
        nextCurrentPlayer: 'you',
        upcomingPlayMovesCount: 1,
      }),
    ).toEqual({ type: 'continue', runningScore: 4 });
  });

  it('completes when the move hands control away from the player', () => {
    expect(
      evaluateOneTurnHighScoreMoveOutcome({
        pointsAwarded: 7,
        isDouble: false,
        priorRunningScore: 4,
        nextCurrentPlayer: 'bot',
        upcomingPlayMovesCount: 3,
      }),
    ).toEqual({ type: 'terminal', status: 'SOLVED', runningScore: 11 });
  });
});

describe('evaluateTargetScoreMoveOutcome', () => {
  it('solves when target reached within max moves', () => {
    expect(
      evaluateTargetScoreMoveOutcome({
        totalScore: 30,
        nextMoves: 2,
        targetScore: 30,
        maxMoves: 3,
        currentPlayer: 'you',
        upcomingPlayMovesCount: 1,
      }),
    ).toEqual({ type: 'terminal', status: 'SOLVED', totalScore: 30, nextMoves: 2 });
  });

  it('fails when max moves reached below target', () => {
    expect(
      evaluateTargetScoreMoveOutcome({
        totalScore: 10,
        nextMoves: 3,
        targetScore: 30,
        maxMoves: 3,
        currentPlayer: 'you',
        upcomingPlayMovesCount: 0,
      }),
    ).toEqual({ type: 'terminal', status: 'FAILED', totalScore: 10, nextMoves: 3 });
  });

  it('fails when turn leaves player', () => {
    expect(
      evaluateTargetScoreMoveOutcome({
        totalScore: 15,
        nextMoves: 1,
        targetScore: 30,
        maxMoves: 3,
        currentPlayer: 'bot',
        upcomingPlayMovesCount: 2,
      }),
    ).toEqual({ type: 'terminal', status: 'FAILED', totalScore: 15, nextMoves: 1 });
  });

  it('continues when still in progress', () => {
    expect(
      evaluateTargetScoreMoveOutcome({
        totalScore: 10,
        nextMoves: 1,
        targetScore: 30,
        maxMoves: 3,
        currentPlayer: 'you',
        upcomingPlayMovesCount: 2,
      }),
    ).toEqual({ type: 'continue' });
  });
});

describe('helpers', () => {
  it('detects doubles', () => {
    expect(isDominoDouble({ low: 3, high: 3 })).toBe(true);
    expect(isDominoDouble({ low: 2, high: 5 })).toBe(false);
  });

  it('flags auto-fail when no legal moves', () => {
    expect(shouldAutoFailOneTurnHighScoreWithNoLegalMoves(0)).toBe(true);
    expect(shouldAutoFailOneTurnHighScoreWithNoLegalMoves(1)).toBe(false);
  });
});
