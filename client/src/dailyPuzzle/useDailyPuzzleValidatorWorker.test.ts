// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { CuratedDailyPuzzle } from './types';
import type { PendingWorkerJob } from './dailyPuzzleScreenTypes';
import {
  buildValidatorWorkerRequest,
  dispatchValidatorWorkerMessage,
} from './useDailyPuzzleValidatorWorker';

const pendingValidate: PendingWorkerJob<unknown> = {
  expected: 'validateResult',
  puzzleDate: '2024-06-01',
  resolve: () => {},
  reject: () => {},
};

const pendingBestScore: PendingWorkerJob<unknown> = {
  expected: 'bestScoreResult',
  puzzleDate: '2024-06-01',
  resolve: () => {},
  reject: () => {},
};

describe('dispatchValidatorWorkerMessage', () => {
  it('ignores responses with no matching pending job', () => {
    expect(dispatchValidatorWorkerMessage({
      requestId: 1,
      type: 'validateResult',
      puzzleDate: '2024-06-01',
      result: { solvable: true, bestScore: 10, hasScoringMove: true, exploredStates: 1, reason: '' },
    }, undefined)).toEqual({ action: 'ignore' });
  });

  it('rejects worker error responses', () => {
    const outcome = dispatchValidatorWorkerMessage({
      requestId: 1,
      type: 'error',
      puzzleDate: '2024-06-01',
      error: 'boom',
    }, pendingValidate);
    expect(outcome).toEqual({ action: 'reject', error: new Error('boom') });
  });

  it('rejects stale puzzleDate mismatches', () => {
    const outcome = dispatchValidatorWorkerMessage({
      requestId: 1,
      type: 'validateResult',
      puzzleDate: '2024-06-02',
      result: { solvable: true, bestScore: 10, hasScoringMove: true, exploredStates: 1, reason: '' },
    }, pendingValidate);
    expect(outcome).toEqual({ action: 'reject', error: new Error('Stale validator response.') });
  });

  it('rejects unexpected response types', () => {
    const outcome = dispatchValidatorWorkerMessage({
      requestId: 1,
      type: 'bestScoreResult',
      puzzleDate: '2024-06-01',
      score: 42,
    }, pendingValidate);
    expect(outcome).toEqual({ action: 'reject', error: new Error('Unexpected validator response type.') });
  });

  it('resolves validate results', () => {
    const result = { solvable: true, bestScore: 10, hasScoringMove: true, exploredStates: 1, reason: 'ok' };
    expect(dispatchValidatorWorkerMessage({
      requestId: 1,
      type: 'validateResult',
      puzzleDate: '2024-06-01',
      result,
    }, pendingValidate)).toEqual({ action: 'resolve', value: result });
  });

  it('resolves best-score results', () => {
    expect(dispatchValidatorWorkerMessage({
      requestId: 1,
      type: 'bestScoreResult',
      puzzleDate: '2024-06-01',
      score: 55,
    }, pendingBestScore)).toEqual({ action: 'resolve', value: 55 });
  });
});

describe('buildValidatorWorkerRequest', () => {
  it('builds validate and bestScore request payloads', () => {
    const puzzle = { puzzleDate: '2024-06-01' } as CuratedDailyPuzzle;
    expect(buildValidatorWorkerRequest(7, 'validate', puzzle)).toEqual({
      requestId: 7,
      type: 'validate',
      puzzleDate: '2024-06-01',
      puzzle,
    });
    expect(buildValidatorWorkerRequest(8, 'bestScore', puzzle)).toEqual({
      requestId: 8,
      type: 'bestScore',
      puzzleDate: '2024-06-01',
      puzzle,
    });
  });
});